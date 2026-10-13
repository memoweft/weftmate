import { createHash } from 'node:crypto';
import { importJWK, jwtVerify } from 'jose';
import { CloudError, transaction, verifyPassword } from './security.mjs';

export const BACKUP_LIMITS = Object.freeze({ accountBytes: 300 * 1024 * 1024, globalBytes: 6 * 1024 * 1024 * 1024,
  chunkBytes: 1024 * 1024 + 16, chunkCount: 512, retained: 3, pendingTtl: 7 * 86400000,
  requestBytes: 2 * 1024 * 1024, manifestBytes: 128 * 1024 });
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fields = (body, names) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join() !== [...names].sort().join())
    throw new CloudError(400, 'INVALID_REQUEST');
};
const binary = (value, size) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) &&
  Buffer.from(value, 'base64url').toString('base64url') === value && (!size || Buffer.from(value, 'base64url').length === size);
const sha = value => createHash('sha256').update(value).digest('hex');
const projection = row => ({ ...JSON.parse(row.descriptor), state: row.state, completedAt: row.completed_at });
function reconcile(db, accountId) {
  const row = db.prepare(`SELECT coalesce(sum(CASE WHEN state='complete' THEN total_bytes ELSE 0 END),0) AS used,
    coalesce(sum(CASE WHEN state='uploading' THEN total_bytes ELSE 0 END),0) AS reserved FROM cloud_backups WHERE account_id=?`).get(accountId);
  if (!row.used && !row.reserved) db.prepare('DELETE FROM cloud_backup_quota WHERE account_id=?').run(accountId);
  else db.prepare(`INSERT INTO cloud_backup_quota VALUES(?,?,?) ON CONFLICT(account_id)
    DO UPDATE SET used_bytes=excluded.used_bytes,reserved_bytes=excluded.reserved_bytes`).run(accountId, row.used, row.reserved);
}
export function backupDeletionVerification(db, accountId) {
  return {
    backups: db.prepare('SELECT count(*) AS n FROM cloud_backups WHERE account_id=?').get(accountId).n,
    chunks: db.prepare('SELECT count(*) AS n FROM cloud_backup_chunks c JOIN cloud_backups b ON b.id=c.backup_id WHERE b.account_id=?').get(accountId).n,
    keys: db.prepare('SELECT count(*) AS n FROM cloud_backup_keys WHERE account_id=?').get(accountId).n,
    quotaBytes: db.prepare('SELECT coalesce(sum(used_bytes+reserved_bytes),0) AS n FROM cloud_backup_quota WHERE account_id=?').get(accountId).n,
  };
}
export function pruneCloudBackups(db, now) {
  transaction(db, () => {
    const accounts = db.prepare('SELECT DISTINCT account_id FROM cloud_backups').all();
    db.prepare("DELETE FROM cloud_backups WHERE state='uploading' AND expires_at<=?").run(now);
    for (const { account_id: accountId } of accounts) {
      db.prepare(`DELETE FROM cloud_backups WHERE account_id=? AND state='complete' AND id NOT IN
        (SELECT id FROM cloud_backups WHERE account_id=? AND state='complete' ORDER BY completed_at DESC,rowid DESC LIMIT ?)`)
        .run(accountId, accountId, BACKUP_LIMITS.retained);
      reconcile(db, accountId);
    }
  });
}
export function createCloudBackups({ database: db, config = {}, authenticate, accounts, now = Date.now }) {
  const accountBytes = config.backupAccountBytes ?? BACKUP_LIMITS.accountBytes;
  const globalBytes = config.backupGlobalBytes ?? BACKUP_LIMITS.globalBytes;
  function usage(accountId) {
    const row = db.prepare('SELECT * FROM cloud_backup_quota WHERE account_id=?').get(accountId);
    return { usedBytes: row?.used_bytes ?? 0, reservedBytes: row?.reserved_bytes ?? 0, limitBytes: accountBytes, globalLimitBytes: globalBytes };
  }
  function limit(accountId, chunk = false) {
    const key = `cloud-backups:${chunk ? 'chunks' : 'metadata'}:${accountId}`, window = Math.floor(now() / 60000) * 60000;
    const old = db.prepare('SELECT * FROM failure_limits WHERE key=?').get(key);
    const n = old?.window_start === window ? old.failures + 1 : 1;
    if (n > (chunk ? 600 : 120)) throw new CloudError(429, 'RATE_LIMITED', 60);
    db.prepare(`INSERT INTO failure_limits VALUES(?,?,?,0) ON CONFLICT(key) DO UPDATE SET
      failures=excluded.failures,window_start=excluded.window_start,blocked_until=0`).run(key, n, window);
  }
  async function identity(route, req, body) {
    if (!body?.proof || !body?.hostId) return { account: await authenticate(req, true), body };
    fields(body, ['hostId', 'proof']);
    const host = id(body.hostId) && db.prepare('SELECT * FROM cloud_hosts WHERE host_id=?').get(body.hostId);
    if (!host) throw new CloudError(401, 'UNAUTHORIZED');
    let payload;
    try {
      ({ payload } = await jwtVerify(body.proof, await importJWK(JSON.parse(host.public_jwk), 'ES256'), {
        algorithms: ['ES256'], typ: 'wm-host-request+jwt', issuer: body.hostId, audience: config.issuer,
        maxTokenAge: '60s', clockTolerance: 30, currentDate: new Date(now()), requiredClaims: ['iat', 'exp', 'jti'],
      }));
    } catch { throw new CloudError(401, 'UNAUTHORIZED'); }
    const account = typeof payload.sub === 'string' && db.prepare('SELECT * FROM cloud_accounts WHERE id=? AND active=1').get(payload.sub);
    if (!account || payload.action !== route || typeof payload.jti !== 'string' ||
        !db.prepare('SELECT 1 FROM host_memberships WHERE host_id=? AND account_id=?').get(body.hostId, account.id))
      throw new CloudError(401, 'UNAUTHORIZED');
    db.prepare('DELETE FROM host_proof_replays WHERE expires_at<=?').run(now());
    if (db.prepare('SELECT 1 FROM host_proof_replays WHERE jti=?').get(payload.jti)) throw new CloudError(401, 'UNAUTHORIZED');
    db.prepare('INSERT INTO host_proof_replays VALUES(?,?)').run(payload.jti, now() + 120000);
    const business = Object.fromEntries(Object.entries(payload).filter(([key]) => !['sub','action','iat','exp','jti','iss','aud'].includes(key)));
    return { account, body: business };
  }
  function owned(accountId, backupId) {
    if (!id(backupId)) throw new CloudError(400, 'INVALID_REQUEST');
    const row = db.prepare('SELECT * FROM cloud_backups WHERE id=? AND account_id=?').get(backupId, accountId);
    if (!row) throw new CloudError(404, 'NOT_FOUND');
    return row;
  }
  function quotaError(code, accountId) {
    const error = new CloudError(409, code);
    error.details = { usage: usage(accountId) };
    return error;
  }
  return { async handle(route, req, input) {
    const { account, body } = await identity(route, req, input), accountId = account.id;
    const action = route.slice('/backups/'.length);
    limit(accountId, action.startsWith('chunk/')); pruneCloudBackups(db, now());
    if (action === 'key/read') {
      fields(body, Object.hasOwn(body, 'password') ? ['password'] : []);
      let sensitiveAuthorized;
      if (Object.hasOwn(body, 'password')) {
        const limits = accounts?.check(account.email, req.socket?.remoteAddress ?? 'host');
        if (!await verifyPassword(body.password, JSON.parse(account.password))) {
          if (limits) accounts.limiter.fail(limits);
          throw new CloudError(401, 'INVALID_CREDENTIALS');
        }
        const live = db.prepare('SELECT * FROM cloud_accounts WHERE id=? AND active=1').get(accountId);
        if (!live || live.auth_epoch !== account.auth_epoch || live.password !== account.password) throw new CloudError(401, 'UNAUTHORIZED');
        sensitiveAuthorized = true;
      }
      const key = db.prepare('SELECT * FROM cloud_backup_keys WHERE account_id=?').get(accountId);
      return { key: key ? JSON.parse(key.envelope) : null, revision: key?.revision ?? 0,
        generation:db.prepare('SELECT generation FROM cloud_backup_controls WHERE account_id=?').get(accountId)?.generation??0,
        ...(sensitiveAuthorized ? { sensitiveAuthorized } : {}) };
    }
    if (action === 'key/write') {
      fields(body, ['key', 'expectedRevision']);
      const key = body.key;
      fields(key, ['protocol','version','keyId','salt','iv','ciphertext','tag']);
      if (key.protocol !== 'wm-cloud-key/1' || key.version !== 1 || !id(key.keyId) || !binary(key.salt,32) ||
          !binary(key.iv,12) || !binary(key.ciphertext,32) || !binary(key.tag,16) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
        throw new CloudError(400, 'INVALID_REQUEST');
      return transaction(db, () => {
        const prior = db.prepare('SELECT * FROM cloud_backup_keys WHERE account_id=?').get(accountId);
        if ((prior?.revision ?? 0) !== body.expectedRevision) throw new CloudError(409, 'KEY_CHANGED');
        if (prior && prior.key_id !== key.keyId && db.prepare('SELECT 1 FROM cloud_backups WHERE account_id=?').get(accountId))
          throw new CloudError(409, 'KEY_IN_USE');
        const revision = body.expectedRevision + 1;
        db.prepare(`INSERT INTO cloud_backup_keys VALUES(?,?,?,?,?) ON CONFLICT(account_id)
          DO UPDATE SET key_id=excluded.key_id,envelope=excluded.envelope,revision=excluded.revision,updated_at=excluded.updated_at`)
          .run(accountId, key.keyId, JSON.stringify(key), revision, now());
        return { revision };
      });
    }
    if (action === 'list') {
      fields(body, []);
      return { items: db.prepare("SELECT * FROM cloud_backups WHERE account_id=? AND state='complete' ORDER BY completed_at DESC,rowid DESC").all(accountId).map(projection),
        usage: usage(accountId), keyAvailable: Boolean(db.prepare('SELECT 1 FROM cloud_backup_keys WHERE account_id=?').get(accountId)) };
    }
    if (action === 'start') {
      fields(body, ['id','version','keyId','createdAt','totalBytes','chunkCount','packageHash','chunks',...(Object.hasOwn(body,'generation')?['generation']:[])]);
      const generation=db.prepare('SELECT generation FROM cloud_backup_controls WHERE account_id=?').get(accountId)?.generation??0;
      if((body.generation??0)!==generation)throw new CloudError(409,'BACKUP_GENERATION_CHANGED');
      const createdAt=typeof body.createdAt==='string'?Date.parse(body.createdAt):NaN;
      if (!id(body.id) || body.version !== 1 || !id(body.keyId) || !Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > now() + 300000 ||
          !Number.isSafeInteger(body.totalBytes) || body.totalBytes < 17 || !Number.isSafeInteger(body.chunkCount) ||
          body.chunkCount < 1 || body.chunkCount > BACKUP_LIMITS.chunkCount || !hash(body.packageHash) || !Array.isArray(body.chunks) || body.chunks.length !== body.chunkCount)
        throw new CloudError(400, 'INVALID_REQUEST');
      let total = 0;
      for (const [index, chunk] of body.chunks.entries()) {
        fields(chunk, ['index','size','hash','iv']);
        if (chunk.index !== index || !Number.isSafeInteger(chunk.size) || chunk.size < 17 || chunk.size > BACKUP_LIMITS.chunkBytes || !hash(chunk.hash) || !binary(chunk.iv,12))
          throw new CloudError(400, 'INVALID_REQUEST');
        total += chunk.size;
      }
      if (total !== body.totalBytes) throw new CloudError(400, 'INVALID_REQUEST');
      const descriptor = JSON.stringify(body);
      return transaction(db, () => {
        const prior = db.prepare('SELECT * FROM cloud_backups WHERE id=?').get(body.id);
        if (prior && (prior.account_id !== accountId || prior.descriptor !== descriptor)) throw new CloudError(409, 'REQUEST_CONFLICT');
        if (!prior) {
          if (db.prepare('SELECT key_id FROM cloud_backup_keys WHERE account_id=?').get(accountId)?.key_id !== body.keyId)
            throw new CloudError(409, 'KEY_REQUIRED');
          if (db.prepare("SELECT 1 FROM cloud_backups WHERE account_id=? AND state='uploading'").get(accountId)) throw new CloudError(409, 'UPLOAD_IN_PROGRESS');
          const own = usage(accountId), global = db.prepare('SELECT coalesce(sum(used_bytes+reserved_bytes),0) AS bytes FROM cloud_backup_quota').get().bytes;
          if (own.usedBytes + own.reservedBytes + body.totalBytes > accountBytes) throw quotaError('BACKUP_QUOTA_EXCEEDED', accountId);
          if (global + body.totalBytes > globalBytes) throw quotaError('BACKUP_GLOBAL_QUOTA_EXCEEDED', accountId);
          db.prepare("INSERT INTO cloud_backups VALUES(?,?,?,?,?,?,?,?,NULL,'uploading')")
            .run(body.id, accountId, body.keyId, descriptor, body.totalBytes, body.chunkCount, createdAt, now() + BACKUP_LIMITS.pendingTtl);
          reconcile(db, accountId);
        }
        return { id: body.id, state: prior?.state ?? 'uploading', received: db.prepare('SELECT chunk_index FROM cloud_backup_chunks WHERE backup_id=? ORDER BY chunk_index').all(body.id).map(c => c.chunk_index), usage: usage(accountId) };
      });
    }
    if (action === 'chunk/upload') {
      fields(body, ['id','index','ciphertext','hash']);
      const row = owned(accountId, body.id), descriptor = JSON.parse(row.descriptor);
      if (!Number.isSafeInteger(body.index) || body.index < 0 || body.index >= row.chunk_count || !hash(body.hash) ||
          typeof body.ciphertext !== 'string' || body.ciphertext.length > Math.ceil(BACKUP_LIMITS.chunkBytes * 4 / 3) || !binary(body.ciphertext))
        throw new CloudError(400, 'INVALID_REQUEST');
      const bytes = Buffer.from(body.ciphertext,'base64url'), chunk = descriptor.chunks[body.index];
      if (bytes.length !== chunk.size || sha(bytes) !== body.hash || body.hash !== chunk.hash) throw new CloudError(409, 'CHUNK_MISMATCH');
      const prior = db.prepare('SELECT hash FROM cloud_backup_chunks WHERE backup_id=? AND chunk_index=?').get(body.id, body.index);
      if (prior) {
        if (prior.hash !== body.hash) throw new CloudError(409, 'REQUEST_CONFLICT');
      } else {
        if (row.state !== 'uploading') throw new CloudError(409, 'BACKUP_COMPLETE');
        db.prepare('INSERT INTO cloud_backup_chunks VALUES(?,?,?,?,?)').run(body.id, body.index, bytes, bytes.length, body.hash);
      }
      return { id: body.id, index: body.index, accepted: true };
    }
    if (action === 'complete') {
      fields(body, ['id']);
      return transaction(db, () => {
        const row = owned(accountId, body.id), descriptor = JSON.parse(row.descriptor);
        if (row.state === 'uploading') {
          if (db.prepare('SELECT count(*) AS n FROM cloud_backup_chunks WHERE backup_id=?').get(body.id).n !== row.chunk_count)
            throw new CloudError(409, 'BACKUP_INCOMPLETE');
          const packageHash = createHash('sha256');
          let index = 0;
          for (const chunk of db.prepare('SELECT * FROM cloud_backup_chunks WHERE backup_id=? ORDER BY chunk_index').iterate(body.id)) {
            if (chunk.chunk_index !== index || sha(chunk.ciphertext) !== descriptor.chunks[index].hash) throw new CloudError(409, 'CHUNK_MISMATCH');
            packageHash.update(chunk.ciphertext);
            index++;
          }
          if (packageHash.digest('hex') !== descriptor.packageHash) throw new CloudError(409, 'BACKUP_MISMATCH');
          db.prepare("UPDATE cloud_backups SET state='complete',completed_at=? WHERE id=?").run(now(), body.id);
          db.prepare(`DELETE FROM cloud_backups WHERE account_id=? AND state='complete' AND id NOT IN
            (SELECT id FROM cloud_backups WHERE account_id=? AND state='complete' ORDER BY completed_at DESC,rowid DESC LIMIT ?)`)
            .run(accountId, accountId, BACKUP_LIMITS.retained);
          reconcile(db, accountId);
        }
        return { backup: projection(owned(accountId, body.id)), usage: usage(accountId) };
      });
    }
    if (action === 'chunk/download') {
      fields(body, ['id','index']);
      const row = owned(accountId, body.id);
      if (!Number.isSafeInteger(body.index) || body.index < 0 || body.index >= row.chunk_count) throw new CloudError(400, 'INVALID_REQUEST');
      if (row.state !== 'complete') throw new CloudError(409, 'BACKUP_INCOMPLETE');
      const chunk = db.prepare('SELECT * FROM cloud_backup_chunks WHERE backup_id=? AND chunk_index=?').get(body.id, body.index);
      if (!chunk) throw new CloudError(404, 'NOT_FOUND');
      return { id: body.id, index: body.index, ciphertext: Buffer.from(chunk.ciphertext).toString('base64url'), hash: chunk.hash };
    }
    if (action === 'delete') {
      fields(body, ['id']); owned(accountId, body.id);
      transaction(db, () => { db.prepare('DELETE FROM cloud_backups WHERE id=? AND account_id=?').run(body.id, accountId); reconcile(db, accountId); });
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      return { deleted: true, verification: { backups: db.prepare('SELECT count(*) AS n FROM cloud_backups WHERE id=?').get(body.id).n,
        chunks: db.prepare('SELECT count(*) AS n FROM cloud_backup_chunks WHERE backup_id=?').get(body.id).n }, usage: usage(accountId) };
    }
    if (action === 'clear') {
      fields(body, []);
      transaction(db, () => {
        for (const table of ['cloud_backups','cloud_backup_keys','cloud_backup_quota']) db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(accountId);
      });
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      return { deleted: true, verification: backupDeletionVerification(db, accountId), usage: usage(accountId) };
    }
    throw new CloudError(404, 'NOT_FOUND');
  } };
}
