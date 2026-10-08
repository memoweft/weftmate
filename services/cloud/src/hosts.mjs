import { randomBytes } from 'node:crypto';
import { calculateJwkThumbprint, importJWK, jwtVerify, SignJWT } from 'jose';
import { CloudError } from './security.mjs';

const publicKey = jwk => jwk && typeof jwk === 'object' && !Array.isArray(jwk) &&
  !['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(key => key in jwk) &&
  jwk.kty === 'EC' && jwk.crv === 'P-256';
const requireFields = (body, fields) => {
  if (Object.keys(body).sort().join(',') !== [...fields].sort().join(',')) throw new CloudError(400, 'INVALID_REQUEST');
};
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function createHosts({ database: db, config, keys, authenticate, now, relay, provider }) {
  async function revocations(hostId, afterSeq) {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new CloudError(400, 'INVALID_REQUEST');
    const rows = db.prepare(`SELECT r.* FROM cloud_revocations r JOIN host_memberships m ON m.account_id=r.account_id
      WHERE m.host_id=? AND (r.host_id IS NULL OR r.host_id=?) AND r.seq>? ORDER BY r.seq LIMIT 1000`).all(hostId, hostId, afterSeq);
    // AUTOINCREMENT survives account deletion; max(seq) could move backwards.
    const watermark = rows.length === 1000 ? rows.at(-1).seq : db.prepare("SELECT coalesce((SELECT seq FROM sqlite_sequence WHERE name='cloud_revocations'),0) AS seq").get().seq;
    const events = rows.map(r => ({ seq: r.seq, sub: r.account_id, kind: r.kind,
      ...(r.kind === 'epoch' ? { epoch: r.epoch } : { deviceId: r.device_id, ...(r.jkt ? { jkt: r.jkt } : {}) }) }));
    const memberships = db.prepare('SELECT a.id AS sub,a.auth_epoch AS epoch FROM cloud_accounts a JOIN host_memberships m ON m.account_id=a.id WHERE m.host_id=?').all(hostId);
    const eventToken = await new SignJWT({ events, watermark, memberships }).setProtectedHeader({ alg: 'RS256', typ: 'wm-cloud-revocations+jwt', kid: keys.privateJwks.keys[0].kid })
      .setIssuer(config.issuer).setAudience(`${config.audience}/hosts/${hostId}`).setIssuedAt()
      .setExpirationTime('300s').sign(await importJWK(keys.privateJwks.keys[0], 'RS256'));
    return { eventToken };
  }
  async function signed(body) {
    requireFields(body, ['hostId', 'proof']);
    const host = db.prepare('SELECT * FROM cloud_hosts WHERE host_id=?').get(body.hostId);
    if (!host) throw new CloudError(401, 'UNAUTHORIZED');
    let payload;
    try {
      ({ payload } = await jwtVerify(body.proof, await importJWK(JSON.parse(host.public_jwk), 'ES256'), {
        algorithms: ['ES256'], typ: 'wm-host-request+jwt', issuer: body.hostId, audience: config.issuer,
        maxTokenAge: '60s', clockTolerance: 30, requiredClaims: ['iat', 'exp', 'jti'], currentDate: new Date(now()),
      }));
    } catch { throw new CloudError(401, 'UNAUTHORIZED'); }
    db.prepare('DELETE FROM host_proof_replays WHERE expires_at<=?').run(now());
    if (typeof payload.jti !== 'string' || db.prepare('SELECT 1 FROM host_proof_replays WHERE jti=?').get(payload.jti))
      throw new CloudError(401, 'UNAUTHORIZED');
    db.prepare('INSERT INTO host_proof_replays VALUES(?,?)').run(payload.jti, now() + 120_000);
    return payload;
  }
  return { async handle(route, req, body) {
    if (route === '/hosts/claims') {
      requireFields(body, ['claimId', 'hostId', 'publicJwk', 'tlsSpki']);
      if (!validId(body.hostId) || !validId(body.claimId) || !publicKey(body.publicJwk) ||
          typeof body.tlsSpki !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.tlsSpki))
        throw new CloudError(400, 'INVALID_REQUEST');
      let jkt;
      try { await importJWK(body.publicJwk, 'ES256'); jkt = await calculateJwkThumbprint(body.publicJwk); }
      catch { throw new CloudError(400, 'INVALID_DEVICE_KEY'); }
      const host = db.prepare('SELECT * FROM cloud_hosts WHERE host_id=?').get(body.hostId);
      let claim = db.prepare('SELECT * FROM host_claims WHERE claim_id=?').get(body.claimId);
      if (host && (host.jkt !== jkt || host.tls_spki !== body.tlsSpki) ||
          claim && (claim.host_id !== body.hostId || claim.jkt !== jkt || claim.tls_spki !== body.tlsSpki))
        throw new CloudError(409, 'CLAIM_CONFLICT');
      if (!claim) {
        db.prepare('INSERT INTO host_claims VALUES(?,?,?,?,?,?,?,NULL,?)').run(body.claimId, body.hostId,
          JSON.stringify(body.publicJwk), jkt, body.tlsSpki, randomBytes(32).toString('base64url'), now() + 600_000, 'pending');
      } else if (claim.status === 'pending' && claim.expires_at <= now()) {
        db.prepare('UPDATE host_claims SET challenge=?,expires_at=? WHERE claim_id=?')
          .run(randomBytes(32).toString('base64url'), now() + 600_000, body.claimId);
      }
      claim = db.prepare('SELECT * FROM host_claims WHERE claim_id=?').get(body.claimId);
      return { claimId: body.claimId, challenge: claim.challenge, status: claim.status };
    }
    if (route === '/hosts/claims/confirm') {
      requireFields(body, ['claimId', 'proof']);
      const account = await authenticate(req);
      const claim = db.prepare('SELECT * FROM host_claims WHERE claim_id=?').get(body.claimId);
      if (!claim || claim.status === 'pending' && claim.expires_at <= now()) throw new CloudError(400, 'CLAIM_INVALID');
      let payload;
      try {
        ({ payload } = await jwtVerify(body.proof, await importJWK(JSON.parse(claim.public_jwk), 'ES256'), {
          algorithms: ['ES256'], typ: 'wm-host-claim+jwt', issuer: claim.host_id, audience: config.issuer,
          maxTokenAge: '60s', clockTolerance: 30, currentDate: new Date(now()), requiredClaims: ['iat', 'exp'],
        }));
      } catch { throw new CloudError(401, 'UNAUTHORIZED'); }
      if (payload.claimId !== body.claimId || payload.challenge !== claim.challenge || payload.sub !== account.id ||
          claim.account_id && claim.account_id !== account.id) throw new CloudError(409, 'CLAIM_CONFLICT');
      db.exec('BEGIN IMMEDIATE');
      try {
        const host = db.prepare('SELECT * FROM cloud_hosts WHERE host_id=?').get(claim.host_id);
        if (host && host.jkt !== claim.jkt) throw new CloudError(409, 'CLAIM_CONFLICT');
        db.prepare('INSERT OR IGNORE INTO cloud_hosts(host_id,public_jwk,jkt,tls_spki) VALUES(?,?,?,?)').run(claim.host_id, claim.public_jwk, claim.jkt, claim.tls_spki);
        const firstMember = !db.prepare('SELECT 1 FROM host_memberships WHERE host_id=?').get(claim.host_id);
        db.prepare(`INSERT INTO host_memberships(host_id,account_id,claim_id) VALUES(?,?,?)
          ON CONFLICT(host_id,account_id) DO UPDATE SET claim_id=excluded.claim_id`).run(claim.host_id, account.id, claim.claim_id);
        if (firstMember) db.prepare("UPDATE host_memberships SET role='owner' WHERE host_id=? AND account_id=?").run(claim.host_id, account.id);
        db.prepare("UPDATE host_claims SET status='active',account_id=? WHERE claim_id=?").run(account.id, body.claimId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { confirmed: true, hostId: claim.host_id, sub: account.id };
    }
    if (route === '/hosts/connect') {
      requireFields(body, ['hostId']);
      const account = await authenticate(req, true);
      if (!db.prepare('SELECT 1 FROM host_memberships WHERE host_id=? AND account_id=?').get(body.hostId, account.id))
        throw new CloudError(404, 'NOT_FOUND');
      const resource = `${config.audience}/hosts/${body.hostId}`;
      // Extend the existing provider grant, never mint a parallel token family.
      const grants = db.prepare('SELECT grant_id FROM grant_bindings WHERE account_id=? AND fingerprint=? AND auth_epoch=? AND app_login=1')
        .all(account.id, req.cloudToken.device_fingerprint, account.auth_epoch);
      if (!grants.length) throw new CloudError(403, 'APP_LOGIN_REQUIRED');
      for (const row of grants) {
        const grant = await provider.Grant.find(row.grant_id);
        if (grant) { grant.addResourceScope(resource, 'host:session'); await grant.save(); }
        // Resource indicators are also recorded on the provider's refresh
        // model. Keep its key, absolute lifetime and consumed/replay state.
        for (const stored of db.prepare("SELECT id FROM oidc_records WHERE model='RefreshToken' AND grant_id=? AND consumed IS NULL")
          .all(row.grant_id)) {
          const token = await provider.RefreshToken.find(stored.id);
          if (token?.isValid && token.jkt === req.cloudToken.cnf.jkt) {
            token.resource = [...new Set([...[token.resource ?? []].flat(), resource])];
            await token.save();
          }
        }
      }
      const device = db.prepare('SELECT status FROM host_device_status WHERE host_id=? AND account_id=? AND device_id=? AND jkt=?')
        .get(body.hostId, account.id, req.cloudToken.device_id, req.cloudToken.cnf.jkt);
      let directory = { hostId: body.hostId, status: 'offline', baseUrl: null };
      if (config.relay) directory = relay.discover(body.hostId, account.id);
      return { ...directory, resource, approval: device?.status ?? 'pending',
        pairingRequired: device?.status !== 'trusted' };
    }
    if (['/hosts/relay/discover', '/hosts/relay/account-revoke'].includes(route)) {
      requireFields(body, ['hostId']);
      const account = await authenticate(req);
      const result = relay.discover(body.hostId, account.id);
      if (route.endsWith('/account-revoke')) {
        const membership = db.prepare('SELECT role FROM host_memberships WHERE host_id=? AND account_id=?').get(body.hostId, account.id);
        if (membership.role !== 'owner') throw new CloudError(403, 'FORBIDDEN');
        return relay.revoke(body.hostId);
      }
      return result;
    }
    // A deleted installation has no public key left to authenticate. Its empty
    // signed snapshot is public, contains no account IDs, and only revokes access.
    if (route === '/hosts/revocations' && validId(body.hostId) && !db.prepare('SELECT 1 FROM cloud_hosts WHERE host_id=?').get(body.hostId)) {
      requireFields(body, ['hostId','proof']);
      return revocations(body.hostId, 0);
    }
    const payload = await signed(body);
    if (payload.action !== route) throw new CloudError(401, 'UNAUTHORIZED');
    db.prepare('UPDATE cloud_hosts SET last_seen=? WHERE host_id=?').run(now(), body.hostId);
    if (route === '/hosts/status') {
      if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 128 ||
          typeof payload.sub !== 'string' || !db.prepare('SELECT 1 FROM host_memberships WHERE host_id=? AND account_id=?')
            .get(body.hostId, payload.sub)) throw new CloudError(400, 'INVALID_REQUEST');
      db.prepare("UPDATE cloud_hosts SET name=? WHERE host_id=? AND name='WeftMate computer'").run(payload.name.trim(), body.hostId);
      return { updated: true };
    }
    if (route === '/hosts/devices/status') {
      if (typeof payload.sub !== 'string' || typeof payload.deviceId !== 'string' ||
          typeof payload.jkt !== 'string' || !['pending','trusted','denied','revoked'].includes(payload.status) ||
          !db.prepare('SELECT 1 FROM host_memberships WHERE host_id=? AND account_id=?').get(body.hostId, payload.sub))
        throw new CloudError(400, 'INVALID_REQUEST');
      db.prepare(`INSERT INTO host_device_status VALUES(?,?,?,?,?) ON CONFLICT(host_id,account_id,device_id,jkt)
        DO UPDATE SET status=excluded.status`).run(body.hostId, payload.sub, payload.deviceId, payload.jkt, payload.status);
      if (payload.isHost === true) {
        const devices = db.prepare('SELECT fingerprint,public_jwk FROM cloud_devices WHERE account_id=? AND device_id=?')
          .all(payload.sub, payload.deviceId);
        for (const device of devices) if (device.public_jwk && await calculateJwkThumbprint(JSON.parse(device.public_jwk)) === payload.jkt)
          db.prepare('INSERT INTO device_host_links VALUES(?,?,?) ON CONFLICT(account_id,fingerprint) DO UPDATE SET host_id=excluded.host_id')
            .run(payload.sub, device.fingerprint, body.hostId);
      }
      return { updated: true };
    }
    if (route.startsWith('/hosts/relay/')) return relay.hostRequest(route, body.hostId, payload);
    if (route === '/hosts/memberships/unbind') {
      if (typeof payload.sub !== 'string' || !validId(payload.claimId)) throw new CloudError(400, 'INVALID_REQUEST');
      db.prepare('DELETE FROM host_memberships WHERE host_id=? AND account_id=? AND claim_id=?')
        .run(body.hostId, payload.sub, payload.claimId);
      if (!db.prepare('SELECT 1 FROM host_memberships WHERE host_id=?').get(body.hostId)) relay.revoke(body.hostId);
      return { unbound: true };
    }
    if (route === '/hosts/devices/revoke') {
      if (!validId(payload.deviceId) || typeof payload.sub !== 'string' || typeof payload.jkt !== 'string' ||
          !validId(payload.requestId) || !db.prepare('SELECT 1 FROM host_memberships WHERE host_id=? AND account_id=?')
            .get(body.hostId, payload.sub)) throw new CloudError(400, 'INVALID_REQUEST');
      db.prepare('INSERT OR IGNORE INTO cloud_revocations(account_id,host_id,kind,device_id,jkt,request_id) VALUES(?,?,?,?,?,?)')
        .run(payload.sub, body.hostId, 'device', payload.deviceId, payload.jkt, payload.requestId);
      return { revoked: true };
    }
    if (route === '/hosts/revocations') {
      return revocations(body.hostId, payload.afterSeq);
    }
    throw new CloudError(404, 'NOT_FOUND');
  } };
}
