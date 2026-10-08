import { calculateJwkThumbprint, importJWK, jwtVerify } from 'jose';
import { failure } from '../personal-access/common.mjs';

// The anchor is supplied by an already trusted device/channel, never by the
// account directory or the unverified envelope itself.
export async function verifyHostTrust({ trustToken, trustedPublicJwk, hostId, sub, deviceId, jkt, now = Date.now() }) {
  try {
    const { payload } = await jwtVerify(trustToken, await importJWK(trustedPublicJwk, 'ES256'), {
      algorithms: ['ES256'], typ: 'wm-host-trust+jwt', issuer: hostId, audience: jkt,
      requiredClaims: ['iat','exp','jti','sub','hostId','deviceId','jkt','tlsSpki','publicJwk'],
      maxTokenAge: '120s', currentDate: new Date(now),
    });
    if (payload.sub !== sub || payload.hostId !== hostId || payload.deviceId !== deviceId || payload.jkt !== jkt ||
        payload.exp - payload.iat > 120 || payload.iat * 1000 > now + 30000 ||
        typeof payload.tlsSpki !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.tlsSpki) ||
        await calculateJwkThumbprint(payload.publicJwk) !== await calculateJwkThumbprint(trustedPublicJwk)) throw new Error();
    return payload;
  } catch { throw failure('HOST_TRUST_INVALID', 401); }
}
