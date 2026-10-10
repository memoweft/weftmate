import { cloudPush } from './push.mjs';
import { Provider, interactionPolicy, errors } from 'oidc-provider';
import { calculateJwkThumbprint, createLocalJWKSet, jwtVerify } from 'jose';
import { createHosts } from './hosts.mjs';
import { createRelay } from './relay.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { sqliteAdapter } from './oidc-adapter.mjs';
import { Accounts } from './accounts.mjs';
import { loadKeys } from './keys.mjs';
import { CloudError, digest, equalDigest, transaction } from './security.mjs';
import { deviceProof } from './device-proof.mjs';
import { appAuthorization, widenAppResumeCookies } from './app-authorization.mjs';
import { accountLifecycle } from './account-lifecycle.mjs';

export const CLOUD_PATH = '/personal/v1/cloud';
const OIDC_PATH = `${CLOUD_PATH}/oidc`;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const formCss = 'body{font-family:system-ui,sans-serif;color:#202020;background:#f5f4f2;margin:0;padding:24px}main{max-width:380px;margin:8vh auto;background:white;padding:32px;border-radius:16px}h1{font-size:24px}p{color:#666;line-height:1.6}label{display:block;margin:16px 0}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;margin-top:8px;font:inherit}button{width:100%;padding:12px;border:0;border-radius:8px;background:#282828;color:white;font:inherit;cursor:pointer}';
const html = (body) =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WeftMate 云账号</title><style>${formCss}</style><body><main><h1>WeftMate 云账号</h1>${body}</main></body></html>`;
function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}
function formReply(res, body, redirectUri) {
  const callback = redirectUri ? new URL(redirectUri) : null;
  const target = callback ? callback.origin === 'null' ? callback.protocol : callback.origin : '';
  res.setHeader('content-security-policy', `default-src 'none'; style-src 'sha256-${createHash('sha256').update(formCss).digest('base64')}'; form-action 'self' ${target}; frame-ancestors 'none'; base-uri 'none'`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html(body));
}
const field = (name, value) => `<input type="hidden" name="${name}" value="${escape(value)}">`;
function confirmationForm(uid, csrfToken, challengeId) {
  return `<p>请查看邮箱并输入新设备确认验证码。此确认仅授权云账号。</p><form method="post" action="${CLOUD_PATH}/auth/device/confirm">${field('interactionUid', uid)}${field('csrfToken', csrfToken)}${field('challengeId', challengeId)}<label>验证码 <input name="code" inputmode="numeric" required></label><button>确认登录</button></form>`;
}
async function bodyOf(req) {
  const type = req.headers['content-type']?.split(';')[0];
  if (!['application/json', 'application/x-www-form-urlencoded'].includes(type))
    throw new CloudError(415, 'UNSUPPORTED_MEDIA_TYPE');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw new CloudError(413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    const text = Buffer.concat(chunks).toString('utf8');
    const body =
      type === 'application/json'
        ? JSON.parse(text)
        : Object.fromEntries(new URLSearchParams(text));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new CloudError(400, 'INVALID_REQUEST');
  }
}

export async function createIdentity({ database, config, mailer, logger, now = Date.now, relayDns = null }) {
  const keys = await loadKeys(config.dataDir);
  const accounts = new Accounts(database, mailer, keys.cookieSecret, { now, logger });
  const policy = interactionPolicy.base();
  // A browser SSO cookie cannot stand in for checking the current device.
  policy
    .get('login')
    .checks.add(
      new interactionPolicy.Check(
        'cloud_device_login',
        'Device login required',
        (ctx) => !ctx.oidc.result?.login,
      ),
    );
  const provider = new Provider(config.issuer, {
    adapter: sqliteAdapter(database, now),
    jwks: keys.privateJwks,
    clients: config.clients.map((client) => ({
      ...client,
      application_type: client.application_type || 'native',
      token_endpoint_auth_method: 'none',
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      id_token_signed_response_alg: 'RS256',
      subject_type: 'public',
    })),
    subjectTypes: ['public'],
    responseTypes: ['code'],
    scopes: ['openid', 'offline_access', 'cloud:account', 'host:session'],
    claims: { openid: ['sub'] },
    enabledJWA: { idTokenSigningAlgValues: ['RS256'], userinfoSigningAlgValues: ['RS256'] },
    cookies: {
      keys: [keys.cookieSecret],
      names: {
        session: 'wm_cloud_session',
        interaction: 'wm_cloud_interaction',
        resume: 'wm_cloud_resume',
      },
      long: {
        httpOnly: true,
        sameSite: config.issuer.startsWith('https:') ? 'none' : 'lax',
        secure: config.issuer.startsWith('https:'),
        path: CLOUD_PATH,
      },
      short: {
        httpOnly: true,
        sameSite: config.issuer.startsWith('https:') ? 'none' : 'lax',
        secure: config.issuer.startsWith('https:'),
        path: CLOUD_PATH,
      },
    },
    pkce: { required: () => true },
    extraParams: ['wm_device_id', 'wm_public_jwk', 'wm_app'],
    interactions: {
      policy,
      url: (_ctx, interaction) => `${CLOUD_PATH}/interactions/${interaction.uid}`,
    },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      revocation: { enabled: true },
      dPoP: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => config.audience,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resource) => {
          const hostId = resource.startsWith(`${config.audience}/hosts/`) ? resource.slice(`${config.audience}/hosts/`.length) : null;
          if (resource !== config.audience && (!hostId || !database.prepare('SELECT 1 FROM cloud_hosts WHERE host_id=?').get(hostId)))
            throw new errors.InvalidTarget();
          return {
            scope: hostId ? 'host:session' : 'cloud:account',
            audience: resource,
            accessTokenTTL: 300,
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'RS256', kid: keys.privateJwks.keys[0].kid } },
          };
        },
      },
    },
    ttl: {
      AccessToken: 300,
      IdToken: 300,
      AuthorizationCode: 60,
      RefreshToken: (_ctx, token) => Math.max(1, 2592000 - token.totalLifetime()),
      Grant: 2592000,
      Session: 2592000,
      Interaction: 600,
    },
    rotateRefreshToken: true,
    clientBasedCORS: (ctx, origin, client) => origin === new URL(config.issuer).origin ||
      (client ? client.redirectUris : config.clients.flatMap(c => c.redirect_uris))
        .some(uri => new URL(uri).origin !== 'null' && new URL(uri).origin === origin),
    findAccount: (_ctx, id, token) => {
      const account = accounts.get(id);
      if (!account?.active) return undefined;
      if (token?.grantId) {
        const binding = database
          .prepare('SELECT * FROM grant_bindings WHERE grant_id=?')
          .get(token.grantId);
        if (!binding || binding.auth_epoch !== account.auth_epoch) return undefined;
      }
      return { accountId: id, claims: () => ({ sub: id }) };
    },
    extraTokenClaims: async (_ctx, token) => {
      const binding = database
        .prepare('SELECT * FROM grant_bindings WHERE grant_id=?')
        .get(token.grantId);
      const account = binding ? accounts.get(binding.account_id) : undefined;
      if (!binding || !account?.active || account.auth_epoch !== binding.auth_epoch)
        throw new errors.InvalidGrant('grant revoked');
      const hostId = token.resourceServer?.audience?.startsWith(`${config.audience}/hosts/`)
        ? token.resourceServer.audience.slice(`${config.audience}/hosts/`.length) : null;
      if (hostId || binding.app_login || token.jkt) {
        const device = database.prepare('SELECT public_jwk FROM cloud_devices WHERE account_id=? AND fingerprint=?')
          .get(account.id, binding.fingerprint);
        if (hostId && !database.prepare('SELECT 1 FROM host_memberships WHERE host_id=? AND account_id=?').get(hostId, account.id) ||
            !device?.public_jwk || !token.jkt || token.jkt !== await calculateJwkThumbprint(JSON.parse(device.public_jwk)))
          throw new errors.InvalidGrant('host or device not authorized');
      }
      database.prepare('UPDATE cloud_devices SET last_seen=? WHERE account_id=? AND fingerprint=?')
        .run(now(), account.id, binding.fingerprint);
      return {
        device_id: binding.device_id,
        device_fingerprint: binding.fingerprint,
        auth_epoch: binding.auth_epoch,
        ...(hostId ? { host_id: hostId } : {}),
      };
    },
    renderError: (ctx) => {
      ctx.type = 'application/json';
      ctx.body = { error: 'invalid_request' };
    },
  });
  provider.proxy = config.trustProxy;
  provider.on('server_error', () => logger?.error('oidc.error', { code: 'OIDC_SERVER_ERROR' }));
  // Koa's default error handler prints error stacks; replace it with metadata only.
  provider.on('error', () => {});
  const callback = provider.callback();
  const jwks = createLocalJWKSet(keys.publicJwks);

  function source(req) {
    const remote = req.socket.remoteAddress ?? 'unknown';
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
    if (config.trustProxy && loopback) {
      const forwarded = req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string' && isIP(forwarded.trim())) return forwarded.trim();
    }
    return remote;
  }
  async function authenticate(req, requireDevice = false) {
    if (
      typeof req.headers.authorization !== 'string' ||
      !/^(Bearer|DPoP) [A-Za-z0-9_.-]+$/.test(req.headers.authorization)
    )
      throw new CloudError(401, 'UNAUTHORIZED');
    let payload;
    try {
      ({ payload } = await jwtVerify(req.headers.authorization.split(' ')[1], jwks, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ['RS256'],
        typ: 'at+jwt',
      }));
    } catch {
      throw new CloudError(401, 'UNAUTHORIZED');
    }
    const account = accounts.get(payload.sub);
    if (
      !account?.active ||
      account.auth_epoch !== payload.auth_epoch ||
      !payload.scope?.split(' ').includes('cloud:account') ||
      !database
        .prepare('SELECT 1 FROM cloud_devices WHERE account_id=? AND fingerprint=?')
        .get(account.id, payload.device_fingerprint)
    )
      throw new CloudError(401, 'UNAUTHORIZED');
    if (requireDevice) await deviceProof(req, req.headers.authorization.split(' ')[1], payload, { database, config, now });
    req.cloudToken = payload;
    database.prepare('UPDATE cloud_devices SET last_seen=? WHERE account_id=? AND fingerprint=?')
      .run(now(), account.id, payload.device_fingerprint);
    return account;
  }
  async function details(req, res, uid) {
    let interaction;
    try {
      interaction = await provider.interactionDetails(req, res);
    } catch {
      throw new CloudError(400, 'INTERACTION_INVALID');
    }
    if (interaction.uid !== uid) throw new CloudError(400, 'INTERACTION_INVALID');
    return interaction;
  }
  async function checkedInteraction(req, res, body) {
    const interaction = await details(req, res, body.interactionUid);
    const form = database
      .prepare('SELECT * FROM interaction_forms WHERE uid=?')
      .get(interaction.uid);
    if (
      !form ||
      form.expires_at <= now() ||
      typeof body.csrfToken !== 'string' ||
      !equalDigest(form.csrf_hash, digest(keys.cookieSecret, body.csrfToken))
    )
      throw new CloudError(403, 'CSRF_INVALID');
    return interaction;
  }
  async function complete(req, res, body, interaction, result) {
    const { account, device } = result;
    if (accounts.get(account.id)?.auth_epoch !== account.auth_epoch || !database.prepare('SELECT 1 FROM cloud_devices WHERE account_id=? AND fingerprint=?').get(account.id, device.fingerprint))
      throw new CloudError(401, 'UNAUTHORIZED');
    const grant = new provider.Grant({
      accountId: account.id,
      clientId: interaction.params.client_id,
    });
    grant.addOIDCScope(interaction.params.scope);
    const resources = interaction.params.resource ? [interaction.params.resource].flat() : [config.audience];
    for (const resource of resources) {
      if (resource === config.audience) grant.addResourceScope(resource, 'cloud:account');
      else {
        const hostId = resource.slice(`${config.audience}/hosts/`.length);
        if (!resource.startsWith(`${config.audience}/hosts/`) ||
            !database.prepare('SELECT 1 FROM host_memberships WHERE host_id=? AND account_id=?').get(hostId, account.id))
          throw new CloudError(403, 'FORBIDDEN');
        grant.addResourceScope(resource, 'host:session');
      }
    }
    const grantId = await grant.save();
    if (accounts.get(account.id)?.auth_epoch !== account.auth_epoch || !database.prepare('SELECT 1 FROM cloud_devices WHERE account_id=? AND fingerprint=?').get(account.id, device.fingerprint)) {
      await grant.destroy();
      throw new CloudError(401, 'UNAUTHORIZED');
    }
    database
      .prepare('INSERT INTO grant_bindings(grant_id,account_id,fingerprint,device_id,auth_epoch,app_login) VALUES(?,?,?,?,?,?)')
      .run(grantId, account.id, device.fingerprint, device.deviceId, account.auth_epoch, interaction.params.wm_app === '1' ? 1 : 0);
    const resumeUrl = await provider.interactionResult(
      req,
      res,
      {
        login: { accountId: account.id, amr: ['pwd', 'email'], remember: false },
        consent: { grantId },
      },
      { mergeWithLastSubmission: false },
    );
    database.prepare('DELETE FROM interaction_forms WHERE uid=?').run(interaction.uid);
    if (interaction.params.wm_app === '1') widenAppResumeCookies(res);
    if (req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
      res.writeHead(303, { location: resumeUrl });
      res.end();
    } else reply(res, 200, { account: accounts.public(account), resumeUrl });
  }
  const routes = new Map([
    [`${CLOUD_PATH}/auth/register`, 'register'],
    [`${CLOUD_PATH}/auth/register/resend`, 'resend'],
    [`${CLOUD_PATH}/auth/register/verify`, 'verify'],
    [`${CLOUD_PATH}/auth/login`, 'login'],
    [`${CLOUD_PATH}/auth/device/confirm`, 'device'],
    [`${CLOUD_PATH}/auth/password/request`, 'resetRequest'],
    [`${CLOUD_PATH}/auth/password/reset`, 'reset'],
    [`${CLOUD_PATH}/auth/email/request`, 'emailRequest'],
    [`${CLOUD_PATH}/auth/email/confirm`, 'emailConfirm'],
    [`${CLOUD_PATH}/auth/email/change/request`, 'appEmailRequest'],
    [`${CLOUD_PATH}/auth/email/change/confirm`, 'appEmailConfirm'],
    [`${CLOUD_PATH}/account`, 'account'],
    [`${CLOUD_PATH}/auth/devices/revoke`, 'deviceRevoke'],
    [`${CLOUD_PATH}/auth/registration/request`, 'appRegisterRequest'],
    [`${CLOUD_PATH}/auth/registration/verify`, 'appRegisterVerify'],
    [`${CLOUD_PATH}/auth/registration/complete`, 'appRegisterComplete'],
    [`${CLOUD_PATH}/auth/recovery/request`, 'appResetRequest'],
    [`${CLOUD_PATH}/auth/recovery/verify`, 'appResetVerify'],
    [`${CLOUD_PATH}/auth/recovery/complete`, 'appResetComplete'],
    [`${CLOUD_PATH}/auth/password/change`, 'passwordChange'],
    [`${CLOUD_PATH}/auth/logout`, 'logout'],
    [`${CLOUD_PATH}/auth/account/delete`, 'accountDelete'],
    [`${CLOUD_PATH}/auth/logout/others`, 'logoutOthers'],
    [`${CLOUD_PATH}/devices/rename`, 'deviceRename'],
    [`${CLOUD_PATH}/devices`, 'devices'],
    [`${CLOUD_PATH}/auth/push/registration`, 'push/registration'],
    [`${CLOUD_PATH}/auth/authorization`, 'appAuthorize'],
    [`${CLOUD_PATH}/auth/authorization/resume`, 'appResume'],
  ]);
  const relay = createRelay({ database, config, secret: keys.cookieSecret, now, dns: relayDns });
  const lifecycle = accountLifecycle({ database, accounts, relay });
  const hosts = createHosts({ database, config, keys, authenticate, now, relay, provider });
  const authorizeInApp = appAuthorization({ config });
  const allowedOrigin = origin => origin === new URL(config.issuer).origin || config.clients
    .some(c => c.redirect_uris.some(uri => new URL(uri).origin !== 'null' && new URL(uri).origin === origin));
  return {
    provider,
    relay,
    accounts,
    keys,
    async handle(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const trustedProxy =
        config.trustProxy &&
        ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      const host = trustedProxy
        ? (req.headers['x-forwarded-host'] ?? req.headers.host)
        : req.headers.host;
      if (host !== new URL(config.issuer).host) {
        reply(res, 400, { error: { code: 'HOST_NOT_ALLOWED' } });
        return true;
      }
      if (req.headers.origin && allowedOrigin(req.headers.origin)) {
        res.setHeader('access-control-allow-origin', req.headers.origin);
        res.setHeader('access-control-allow-credentials', 'true');
        res.setHeader('access-control-expose-headers', 'Location,DPoP-Nonce,Retry-After');
        res.setHeader('vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'access-control-allow-methods': 'GET,POST,OPTIONS',
            'access-control-allow-headers': 'Content-Type,Authorization,DPoP' }); res.end(); return true;
        }
      }
      if (url.pathname.startsWith(`${OIDC_PATH}/`)) {
        // A non-loopback caller must not inject proxy headers into Koa.
        if (!trustedProxy) {
          delete req.headers['x-forwarded-proto'];
          delete req.headers['x-forwarded-host'];
          delete req.headers['x-forwarded-for'];
        }
        req.originalUrl = req.url;
        req.url = req.url.slice(OIDC_PATH.length);
        callback(req, res);
        return true;
      }
      const match = new RegExp(`^${CLOUD_PATH}/interactions/([A-Za-z0-9_-]+)$`).exec(url.pathname);
      const route = routes.get(url.pathname);
      const hostRoute = url.pathname.startsWith(`${CLOUD_PATH}/hosts/`);
      if (!route && !match && !hostRoute) return false;
      try {
        if (req.headers.origin && !allowedOrigin(req.headers.origin))
          throw new CloudError(403, 'ORIGIN_NOT_ALLOWED');
        if (hostRoute) {
          if (req.method !== 'POST') throw new CloudError(405, 'METHOD_NOT_ALLOWED');
          if (url.search || !allowedOrigin(req.headers.origin)) throw new CloudError(403, 'ORIGIN_NOT_ALLOWED');
          reply(res, 200, await hosts.handle(url.pathname.slice(CLOUD_PATH.length), req, await bodyOf(req)));
          return true;
        }
        if (match) {
          if (req.method !== 'GET') throw new CloudError(405, 'METHOD_NOT_ALLOWED');
          const interaction = await details(req, res, match[1]);
          const csrfToken = randomBytes(32).toString('base64url');
          database
            .prepare(
              'INSERT INTO interaction_forms VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET csrf_hash=excluded.csrf_hash,expires_at=excluded.expires_at',
            )
            .run(interaction.uid, digest(keys.cookieSecret, csrfToken), now() + 600000);
          if (req.headers.accept?.includes('application/json'))
            reply(res, 200, {
              interactionUid: interaction.uid,
              csrfToken,
              clientId: interaction.params.client_id,
              appLogin: interaction.params.wm_app === '1',
              deviceId: interaction.params.wm_device_id,
            });
          else
            formReply(
              res,
              `<p>登录 WeftMate 账号</p><form method="post" action="${CLOUD_PATH}/auth/login">${field('interactionUid', interaction.uid)}${field('csrfToken', csrfToken)}${interaction.params.wm_device_id ? field('deviceId', interaction.params.wm_device_id) : '<p><label>设备标识 <input name="deviceId" required></label></p>'}${interaction.params.wm_public_jwk ? field('publicJwk', interaction.params.wm_public_jwk) : ''}<p><label>邮箱 <input type="email" name="email" required autocomplete="username"></label></p><p><label>密码 <input type="password" name="password" required autocomplete="current-password"></label></p><button>登录</button></form>`, interaction.params.redirect_uri,
            );
          return true;
        }
        if (route === 'account') {
          if (req.method !== 'GET') throw new CloudError(405, 'METHOD_NOT_ALLOWED');
          reply(res, 200, { account: accounts.public(await authenticate(req)) });
          return true;
        }
        if (route === 'push/registration') {
          if (url.search) throw new CloudError(400, 'INVALID_REQUEST');
          if (req.method !== 'GET' && !allowedOrigin(req.headers.origin)) throw new CloudError(403, 'ORIGIN_NOT_ALLOWED');
          const body = req.method === 'PUT' ? await bodyOf(req) : undefined;
          const account = await authenticate(req, true);
          reply(res, 200, await cloudPush(database, now).registration(account.id, req.cloudToken.device_fingerprint, req.method, body));
          return true;
        }
        if (route === 'devices') {
          if (req.method !== 'GET') throw new CloudError(405, 'METHOD_NOT_ALLOWED');
          if (url.search) throw new CloudError(400, 'INVALID_REQUEST');
          const account = await authenticate(req, true);
          const devices = database.prepare('SELECT * FROM cloud_devices WHERE account_id=? ORDER BY confirmed_at').all(account.id)
            .map(d => ({ id: d.device_id, name: d.name, type: d.type,
              online: d.last_seen !== null && now() - d.last_seen < 60000,
              lastUsedAt: new Date(d.last_seen ?? d.confirmed_at).toISOString(),
              isCurrent: d.fingerprint === req.cloudToken.device_fingerprint }));
          const computers = database.prepare(`SELECT h.* FROM cloud_hosts h JOIN host_memberships m ON m.host_id=h.host_id
            WHERE m.account_id=? ORDER BY h.host_id`).all(account.id).map(h => ({ id: h.host_id, hostId: h.host_id,
              name: h.name, type: 'computer', online: h.last_seen !== null && now() - h.last_seen < 90000,
              lastUsedAt: h.last_seen === null ? null : new Date(h.last_seen).toISOString(),
              isCurrent: !!database.prepare("SELECT 1 FROM host_device_status WHERE host_id=? AND account_id=? AND device_id=? AND jkt=? AND status='trusted'")
                .get(h.host_id, account.id, req.cloudToken.device_id, req.cloudToken.cnf.jkt) &&
                h.host_id === database.prepare('SELECT host_id FROM device_host_links WHERE account_id=? AND fingerprint=?')
                  .get(account.id, req.cloudToken.device_fingerprint)?.host_id }));
          reply(res, 200, { devices, hosts: computers, sharing: { supported: false } }); return true;
        }
        if (req.method !== 'POST') throw new CloudError(405, 'METHOD_NOT_ALLOWED');
        // All credential writes are same-origin, including native browser interactions.
        if (!allowedOrigin(req.headers.origin))
          throw new CloudError(403, 'ORIGIN_NOT_ALLOWED');
        const body = await bodyOf(req);
        if (url.search) throw new CloudError(400, 'INVALID_REQUEST');
        if (route === 'login' && typeof body.publicJwk === 'string') {
          try { body.publicJwk = JSON.parse(body.publicJwk); }
          catch { throw new CloudError(400, 'INVALID_DEVICE_KEY'); }
        }
        const from = source(req);
        if (route === 'login' || route === 'device') {
          const interaction = await checkedInteraction(req, res, body);
          if (route === 'login' && interaction.params.wm_app === '1') {
            await accounts.device(body);
            if (!body.publicJwk || body.deviceId !== interaction.params.wm_device_id ||
                await calculateJwkThumbprint(body.publicJwk) !== await calculateJwkThumbprint(JSON.parse(interaction.params.wm_public_jwk)))
              throw new CloudError(400, 'INVALID_DEVICE_KEY');
          }
          const result =
            route === 'login'
              ? await accounts.login(body, from, interaction.uid)
              : accounts.confirmDevice(body, from, interaction.uid);
          if (result.confirmationRequired) {
            if (req.headers['content-type'].startsWith('application/x-www-form-urlencoded'))
              formReply(res, confirmationForm(interaction.uid, body.csrfToken, result.challengeId), interaction.params.redirect_uri);
            else reply(res, 202, result);
          } else await complete(req, res, body, interaction, result);
        } else {
          let result;
          switch (route) {
            case 'appAuthorize':
              await accounts.device(body);
              result = await authorizeInApp(route, req, res, body); break;
            case 'appResume': result = await authorizeInApp(route, req, res, body); break;
            case 'appRegisterRequest': result = await accounts.requestPassword(body, 'register', from); break;
            case 'appResetRequest': result = await accounts.requestPassword(body, 'reset', from); break;
            case 'appRegisterVerify': result = accounts.verifyPasswordCode(body, 'register', from); break;
            case 'appResetVerify': result = accounts.verifyPasswordCode(body, 'reset', from); break;
            case 'appRegisterComplete': {
              // The registration email has just proved possession. Bind only the
              // device from this app's existing provider interaction cookie;
              // subsequent devices still require their own email confirmation.
              let registrationInteraction;
              try { registrationInteraction = await provider.interactionDetails(req, res); } catch { /* compatible standalone registration */ }
              result = await accounts.completePassword(body, 'register', from);
              if (registrationInteraction?.params.wm_app === '1') {
                const device = await accounts.device({ deviceId: registrationInteraction.params.wm_device_id,
                  publicJwk: JSON.parse(registrationInteraction.params.wm_public_jwk) });
                database.prepare('INSERT OR IGNORE INTO cloud_devices(account_id,fingerprint,device_id,public_jwk,confirmed_at,name,type,last_seen) VALUES(?,?,?,?,?,?,?,?)')
                  .run(result.account.cloudAccountId, device.fingerprint, device.deviceId, JSON.stringify(device.publicJwk), now(), 'WeftMate device', 'unknown', now());
              }
              break;
            }
            case 'appResetComplete': result = await accounts.completePassword(body, 'reset', from); break;
            case 'passwordChange': result = await accounts.changePassword(body, from, await authenticate(req, true)); break;
            case 'accountDelete': {
              const account = await authenticate(req, true);
              result = await lifecycle.remove(body, from, account, req.cloudToken); break;
            }
            case 'logoutOthers': {
              const account = await authenticate(req, true);
              result = await lifecycle.logoutOthers(body, account, req.cloudToken); break;
            }
            case 'deviceRename': result = await lifecycle.rename(body, await authenticate(req, true)); break;
            case 'logout': {
              const account = await authenticate(req, true);
              const grants = database.prepare('SELECT grant_id FROM grant_bindings WHERE account_id=? AND fingerprint=?')
                .all(account.id, req.cloudToken.device_fingerprint);
              transaction(database, () => {
                for (const grant of grants) {
                  database.prepare("DELETE FROM oidc_records WHERE grant_id=? OR (model='Grant' AND id=?)").run(grant.grant_id, grant.grant_id);
                  database.prepare('DELETE FROM grant_bindings WHERE grant_id=?').run(grant.grant_id);
                }
                database.prepare('DELETE FROM cloud_devices WHERE account_id=? AND fingerprint=?')
                  .run(account.id, req.cloudToken.device_fingerprint);
                database.prepare('DELETE FROM device_host_links WHERE account_id=? AND fingerprint=?')
                  .run(account.id, req.cloudToken.device_fingerprint);
                database.prepare("UPDATE host_device_status SET status='revoked' WHERE account_id=? AND device_id=? AND jkt=?")
                  .run(account.id, req.cloudToken.device_id, req.cloudToken.cnf.jkt);
                database.prepare('INSERT INTO cloud_revocations(account_id,kind,device_id,jkt) VALUES(?,?,?,?)')
                  .run(account.id, 'device', req.cloudToken.device_id, req.cloudToken.cnf.jkt);
              });
              result = { loggedOut: true }; break;
            }
            case 'deviceRevoke': {
              const account = await authenticate(req);
              if (Object.keys(body).join(',') !== 'deviceId' || typeof body.deviceId !== 'string')
                throw new CloudError(400, 'INVALID_REQUEST');
              database.exec('BEGIN IMMEDIATE');
              try {
                database.prepare('DELETE FROM device_host_links WHERE account_id=? AND fingerprint IN (SELECT fingerprint FROM cloud_devices WHERE account_id=? AND device_id=?)')
                  .run(account.id, account.id, body.deviceId);
                database.prepare('DELETE FROM cloud_devices WHERE account_id=? AND device_id=?').run(account.id, body.deviceId);
                database.prepare("UPDATE host_device_status SET status='revoked' WHERE account_id=? AND device_id=?")
                  .run(account.id, body.deviceId);
                const grants = database.prepare('SELECT grant_id FROM grant_bindings WHERE account_id=? AND device_id=?').all(account.id, body.deviceId);
                for (const grant of grants) {
                  database.prepare("DELETE FROM oidc_records WHERE grant_id=? OR (model='Grant' AND id=?)").run(grant.grant_id, grant.grant_id);
                  database.prepare('DELETE FROM grant_bindings WHERE grant_id=?').run(grant.grant_id);
                }
                database.prepare('INSERT INTO cloud_revocations(account_id,kind,device_id) VALUES(?,?,?)').run(account.id, 'device', body.deviceId);
                database.exec('COMMIT');
              } catch (error) { database.exec('ROLLBACK'); throw error; }
              result = { revoked: true }; break;
            }
            case 'register':
              result = await accounts.register(body, from);
              break;
            case 'resend':
              result = await accounts.requestCode(body, 'register', from);
              break;
            case 'verify':
              result = accounts.verifyRegistration(body, from);
              break;
            case 'resetRequest':
              result = await accounts.requestCode(body, 'reset', from);
              break;
            case 'reset':
              result = await accounts.reset(body, from);
              break;
            case 'emailRequest':
              result = await accounts.requestEmail(body, from, await authenticate(req), true);
              break;
            case 'emailConfirm':
              result = await accounts.confirmEmail(body, from, await authenticate(req));
              break;
            case 'appEmailRequest': result = await accounts.requestEmail(body, from, await authenticate(req, true)); break;
            case 'appEmailConfirm': result = await accounts.confirmEmail(body, from, await authenticate(req, true)); break;
          }
          reply(res, route === 'register' ? 201 : 200, result);
        }
      } catch (error) {
        const known = error instanceof CloudError;
        if (!known) logger?.error('identity.error', { code: 'IDENTITY_UNAVAILABLE' });
        if (!res.headersSent)
          reply(
            res,
            known ? error.status : 503,
            { error: { code: known ? error.code : 'SERVICE_UNAVAILABLE' } },
            error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {},
          );
        else res.end();
      }
      return true;
    },
  };
}
