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

export function createHosts({ database: db, config, keys, authenticate, now }) {
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
        db.prepare('INSERT OR IGNORE INTO cloud_hosts VALUES(?,?,?,?)').run(claim.host_id, claim.public_jwk, claim.jkt, claim.tls_spki);
        db.prepare(`INSERT INTO host_memberships(host_id,account_id,claim_id) VALUES(?,?,?)
          ON CONFLICT(host_id,account_id) DO UPDATE SET claim_id=excluded.claim_id`).run(claim.host_id, account.id, claim.claim_id);
        db.prepare("UPDATE host_claims SET status='active',account_id=? WHERE claim_id=?").run(account.id, body.claimId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { confirmed: true, hostId: claim.host_id, sub: account.id };
    }
    const payload = await signed(body);
    if (payload.action !== route) throw new CloudError(401, 'UNAUTHORIZED');
    if (route === '/hosts/memberships/unbind') {
      if (typeof payload.sub !== 'string' || !validId(payload.claimId)) throw new CloudError(400, 'INVALID_REQUEST');
      db.prepare('DELETE FROM host_memberships WHERE host_id=? AND account_id=? AND claim_id=?')
        .run(body.hostId, payload.sub, payload.claimId);
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
      if (!Number.isSafeInteger(payload.afterSeq) || payload.afterSeq < 0) throw new CloudError(400, 'INVALID_REQUEST');
      const rows = db.prepare(`SELECT r.* FROM cloud_revocations r JOIN host_memberships m ON m.account_id=r.account_id
        WHERE m.host_id=? AND (r.host_id IS NULL OR r.host_id=?) AND r.seq>? ORDER BY r.seq LIMIT 1000`)
        .all(body.hostId, body.hostId, payload.afterSeq);
      // Include current epochs, even if the host joined after an older reset event.
      const watermark = rows.length === 1000 ? rows.at(-1).seq : db.prepare('SELECT coalesce(max(seq),0) AS seq FROM cloud_revocations').get().seq;
      const events = rows.map(r => ({ seq: r.seq, sub: r.account_id, kind: r.kind,
        ...(r.kind === 'epoch' ? { epoch: r.epoch } : { deviceId: r.device_id, ...(r.jkt ? { jkt: r.jkt } : {}) }) }));
      const eventToken = await new SignJWT({ events, watermark }).setProtectedHeader({ alg: 'RS256', typ: 'wm-cloud-revocations+jwt', kid: keys.privateJwks.keys[0].kid })
        .setIssuer(config.issuer).setAudience(`${config.audience}/hosts/${body.hostId}`).setIssuedAt()
        .setExpirationTime('300s').sign(await importJWK(keys.privateJwks.keys[0], 'RS256'));
      return { eventToken };
    }
    throw new CloudError(404, 'NOT_FOUND');
  } };
}
