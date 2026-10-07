import { calculateJwkThumbprint, createRemoteJWKSet, importJWK, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import { failure } from '../personal-access/common.mjs';

export const hash = value => createHash('sha256').update(value).digest('base64url');
export const publicKey = jwk => jwk && typeof jwk === 'object' && !Array.isArray(jwk) &&
  !['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(key => key in jwk) &&
  jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string';

export function cloudConfiguration(options) {
  const issuer = options?.issuer;
  let url;
  try { url = new URL(issuer); } catch { throw failure('INVALID_CONFIGURATION'); }
  if (url.username || url.password || url.search || url.hash ||
      !url.pathname.endsWith('/personal/v1/cloud/oidc') ||
      (url.protocol !== 'https:' && !(options.allowInsecureLoopback === true &&
        url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw failure('INVALID_CONFIGURATION');
  }
  return { issuer, base: issuer.slice(0, -5), jwksUri: `${issuer}/jwks` };
}

export function createCloudVerifier(config, hostId, clock) {
  // Only this configured URL may supply keys. Token jku/x5u are never followed.
  const keys = createRemoteJWKSet(new URL(config.jwksUri), { cooldownDuration: 0, timeoutDuration: 5000 });
  const hostAudience = `${config.base}/hosts/${hostId}`;
  async function verify(token, audience = hostAudience, scope = 'host:session') {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: config.issuer, audience, algorithms: ['RS256'], typ: 'at+jwt',
        requiredClaims: ['sub', 'iat', 'exp', 'jti', 'device_id', 'auth_epoch'],
        currentDate: new Date(clock()),
      });
      if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.device_id !== 'string' ||
          !/^[A-Za-z0-9_.:-]{1,128}$/.test(payload.device_id) ||
          !Number.isSafeInteger(payload.auth_epoch) || payload.auth_epoch < 0 ||
          typeof payload.scope !== 'string' || !payload.scope.split(' ').includes(scope) ||
          payload.iat > Math.floor(clock() / 1000) + 30 ||
          (scope === 'host:session' && (payload.host_id !== hostId || typeof payload.cnf?.jkt !== 'string'))) {
        throw new Error();
      }
      return payload;
    } catch { throw failure('CLOUD_TOKEN_INVALID', 401); }
  }
  async function proof(token, encoded, method, url) {
    try {
      let jwk;
      const { payload } = await jwtVerify(encoded, async header => {
        if (!publicKey(header.jwk) || header.alg !== 'ES256') throw new Error();
        jwk = header.jwk;
        return importJWK(jwk, 'ES256');
      }, { algorithms: ['ES256'], typ: 'dpop+jwt', requiredClaims: ['jti', 'iat', 'htm', 'htu', 'nonce', 'ath'] });
      const jkt = await calculateJwkThumbprint(jwk);
      if (payload.htm !== method || payload.htu !== url || payload.ath !== hash(token) ||
          !Number.isSafeInteger(payload.iat) || Math.abs(payload.iat * 1000 - clock()) > 60_000 ||
          typeof payload.jti !== 'string' || !payload.jti || typeof payload.nonce !== 'string') throw new Error();
      return { jwk, jkt, nonce: payload.nonce, replayId: hash(`${jkt}:${payload.jti}`) };
    } catch { throw failure('DPOP_INVALID', 401); }
  }
  async function events(token) {
    try {
      return (await jwtVerify(token, keys, { issuer: config.issuer, audience: hostAudience,
        algorithms: ['RS256'], typ: 'wm-cloud-revocations+jwt',
        requiredClaims: ['iat', 'exp', 'events', 'watermark'], currentDate: new Date(clock()) })).payload;
    } catch { throw failure('CLOUD_TOKEN_INVALID', 401); }
  }
  return { verify, proof, events, hostAudience };
}
