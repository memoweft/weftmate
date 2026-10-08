import { CloudError } from './security.mjs';

// Drive the provider's ordinary HTTP endpoints inside the app's credentialed
// transport. No password grant, custom token issuer, or external navigation.
export function appAuthorization({ config }) {
  async function call(req, res, path, accept) {
    const response = await fetch(`http://127.0.0.1:${req.socket.localPort}${path}`, {
      redirect: 'manual', signal: AbortSignal.timeout(5000), headers: {
        host: new URL(config.issuer).host, cookie: req.headers.cookie ?? '', accept,
        ...(config.trustProxy ? { 'x-forwarded-proto': new URL(config.issuer).protocol.slice(0, -1),
          'x-forwarded-host': new URL(config.issuer).host } : {}),
      },
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) {
      res.setHeader('set-cookie', [...(res.getHeader('set-cookie') ?? []), ...cookies]);
      const jar = new Map((req.headers.cookie ?? '').split(';').filter(Boolean).map(s => {
        const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1)];
      }));
      for (const cookie of cookies) { const first = cookie.split(';')[0], i = first.indexOf('=');
        jar.set(first.slice(0, i), first.slice(i + 1)); }
      req.headers.cookie = [...jar].map(([k,v]) => `${k}=${v}`).join('; ');
    }
    return response;
  }
  return async (route, req, res, body) => {
    if (route === 'appAuthorize') {
      const client = config.clients.find(c => c.client_id === body.clientId && c.redirect_uris.includes(body.redirectUri));
      if (!client || typeof body.deviceId !== 'string' || body.publicJwk?.kty !== 'EC' || body.publicJwk.crv !== 'P-256' ||
          typeof body.codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge) ||
          ![body.state,body.nonce].every(v => typeof v === 'string' && v.length >= 16 && v.length <= 256))
        throw new CloudError(400, 'INVALID_REQUEST');
      const query = new URLSearchParams({ client_id: body.clientId, redirect_uri: body.redirectUri,
        response_type: 'code', scope: 'openid offline_access cloud:account host:session', resource: config.audience,
        prompt: 'consent', code_challenge: body.codeChallenge, code_challenge_method: 'S256',
        state: body.state, nonce: body.nonce, wm_app: '1', wm_device_id: body.deviceId,
        wm_public_jwk: JSON.stringify(body.publicJwk) });
      const started = await call(req, res, `/personal/v1/cloud/oidc/auth?${query}`, 'application/json');
      const location = started.headers.get('location');
      if (started.status !== 303 || !location) throw new CloudError(400, 'INTERACTION_INVALID');
      const url = new URL(location, config.issuer);
      if (!/^\/personal\/v1\/cloud\/interactions\/[A-Za-z0-9_-]+$/.test(url.pathname))
        throw new CloudError(400, 'INTERACTION_INVALID');
      const interaction = await call(req, res, url.pathname, 'application/json');
      if (!interaction.ok) throw new CloudError(400, 'INTERACTION_INVALID');
      return interaction.json();
    }
    let url;
    try { url = new URL(body.resumeUrl); } catch { throw new CloudError(400, 'INTERACTION_INVALID'); }
    if (url.origin !== new URL(config.issuer).origin || url.search || url.hash ||
        !/^\/personal\/v1\/cloud\/oidc\/auth\/[A-Za-z0-9_-]+$/.test(url.pathname))
      throw new CloudError(400, 'INTERACTION_INVALID');
    const resumed = await call(req, res, url.pathname, 'application/json');
    const callbackUrl = resumed.headers.get('location');
    if (resumed.status !== 303 || !callbackUrl) throw new CloudError(400, 'INTERACTION_INVALID');
    return { callbackUrl };
  };
}
