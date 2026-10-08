import { createHash } from 'node:crypto';
import { importJWK, jwtVerify, calculateJwkThumbprint } from 'jose';
import { CloudError } from './security.mjs';

export async function deviceProof(req, token, claims, { database, config, now }) {
  try {
    let jwk;
    const { payload } = await jwtVerify(req.headers.dpop, async header => {
      jwk = header.jwk;
      if (header.alg !== 'ES256' || jwk?.kty !== 'EC' || jwk.crv !== 'P-256' ||
          ['d','p','q','dp','dq','qi','oth','k'].some(k => k in jwk)) throw new Error();
      return importJWK(jwk, 'ES256');
    }, { algorithms: ['ES256'], typ: 'dpop+jwt', requiredClaims: ['iat','jti','htm','htu','ath'] });
    if (await calculateJwkThumbprint(jwk) !== claims.cnf?.jkt ||
        payload.htm !== req.method || payload.htu !== new URL(config.issuer).origin + req.url.split('?')[0] ||
        payload.ath !== createHash('sha256').update(token).digest('base64url') ||
        !Number.isSafeInteger(payload.iat) || Math.abs(payload.iat * 1000 - now()) > 60000 ||
        typeof payload.jti !== 'string' || !payload.jti) throw new Error();
    const replay = `dpop:${createHash('sha256').update(`${claims.cnf.jkt}:${payload.jti}`).digest('hex')}`;
    database.prepare('DELETE FROM host_proof_replays WHERE expires_at<=?').run(now());
    if (database.prepare('SELECT 1 FROM host_proof_replays WHERE jti=?').get(replay)) throw new Error();
    database.prepare('INSERT INTO host_proof_replays VALUES(?,?)').run(replay, now() + 120000);
  } catch { throw new CloudError(401, 'DPOP_INVALID'); }
}
