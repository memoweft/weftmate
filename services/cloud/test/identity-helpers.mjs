import './dependencies.mjs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';
import { openDatabase } from '../src/database.mjs';
import { createMailer } from '../src/mail.mjs';
import { createLogger } from '../src/log.mjs';
import { createCloudServer } from '../src/server.mjs';
const { createIdentity } = await import('../src/identity.mjs');
export const { loadKeys } = await import('../src/keys.mjs');
export const {
  createLocalJWKSet,
  jwtVerify,
  decodeProtectedHeader,
  generateKeyPair,
  exportJWK,
  importJWK,
  SignJWT,
} = await import('jose');
export const PASSWORD = 'a test password with 20 chars';
export const NEXT_PASSWORD = 'another test password 20 chars';
export const EMAIL = 'account@example.com';
export const P = '/personal/v1/cloud';
export async function fixture(t, { env = {}, relayDns, realProcess = false, listenHost = '127.0.0.1' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-identity-'));
  let server,
    child,
    childExit,
    opened,
    identity,
    config,
    logs = '',
    port = 0,
    clock = Date.now();
  const logger = createLogger({
    stream: {
      write: (line) => {
        logs += line;
      },
    },
  });
  async function start() {
    opened = await openDatabase(path.join(root, 'cloud.sqlite'));
    server = createCloudServer({
      ...opened,
      logger,
      identity: { handle: (...args) => identity.handle(...args) },
    });
    server.listen(port, listenHost);
    await once(server, 'listening');
    port = server.address().port;
    config = loadConfig({
      CLOUD_DATA_DIR: root,
      CLOUD_PORT: String(port),
      CLOUD_ISSUER: `http://127.0.0.1:${port}${P}/oidc`,
      CLOUD_OIDC_CLIENTS: JSON.stringify([
        { client_id: 'test-native', redirect_uris: ['com.example.weftmate:/callback'] },
      ]),
      ...env,
    });
    if (realProcess) {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      server = null;
      child = spawn(process.execPath, ['src/main.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, CLOUD_DATA_DIR: root, CLOUD_PORT: String(port), CLOUD_HOST: '127.0.0.1',
          CLOUD_ISSUER: config.issuer, CLOUD_MAIL_TRANSPORT: 'file', CLOUD_OIDC_CLIENTS: JSON.stringify(config.clients), ...env } });
      childExit = once(child, 'exit');
      child.stderr.resume();
      const lines = createInterface({ input: child.stdout });
      await Promise.race([new Promise((resolve, reject) => {
        lines.on('line', line => {
          logs += line + '\n';
          const data = JSON.parse(line);
          if (data.event === 'service.started') resolve();
          if (data.event === 'service.start_failed') reject(new Error(line));
        });
      }), childExit.then(() => { throw new Error('cloud exited before readiness'); })]);
      const state = JSON.parse(await readFile(path.join(root, 'identity-keys', 'keys.json'), 'utf8'));
      identity = { keys: { cookieSecret: state.cookieSecret } };
      return;
    }
    identity = await createIdentity({
      database: opened.database,
      relayDns: typeof relayDns === 'function' ? relayDns(opened.database) : relayDns,
      config,
      mailer: createMailer(config, { logger }),
      logger,
      now: () => clock,
    });
  }
  async function stop() {
    await identity?.relay?.close();
    if (child) { child.kill('SIGTERM'); await childExit; child = null; }
    if (server)
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    opened?.database.close();
    server = null;
    opened = null;
  }
  t.after(async () => {
    await stop();
    await rm(root, { recursive: true, force: true });
  });
  await start();
  const origin = `http://127.0.0.1:${port}`;
  function browser() {
    const cookies = new Map();
    return async (route, { method = 'GET', body, form, headers = {}, status } = {}) => {
      const response = await fetch(route.startsWith('http') ? route : origin + route, {
        method,
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
          ...(method === 'POST'
            ? {
                origin,
                'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
              }
            : {}),
          ...headers,
        },
        body: form ? new URLSearchParams(form) : body ? JSON.stringify(body) : undefined,
      });
      for (const cookie of response.headers.getSetCookie()) {
        const first = cookie.split(';')[0];
        const split = first.indexOf('=');
        cookies.set(first.slice(0, split), first.slice(split + 1));
      }
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      if (status !== undefined)
        assert.equal(response.status, status, `${method} ${route}: ${text}`);
      return { status: response.status, data, headers: response.headers };
    };
  }
  const api = browser();
  async function mailCode(challengeId) {
    const challenge = opened.database
      .prepare('SELECT * FROM email_challenges WHERE id=?')
      .get(challengeId);
    const files = await readdir(config.mailDir);
    const mails = await Promise.all(
      files.map(async (name) =>
        JSON.parse(await readFile(path.join(config.mailDir, name), 'utf8')),
      ),
    );
    const matching = mails.filter(
      (mail) => mail.to === challenge.email && /验证码：\d{6}/.test(mail.text),
    );
    const { digest } = await import('../src/security.mjs');
    for (const mail of matching) {
      const code = /验证码：(\d{6})/.exec(mail.text)[1];
      if (digest(identity.keys.cookieSecret, `${challengeId}:${code}`) === challenge.code_hash)
        return code;
    }
    throw new Error('No development mail for challenge');
  }
  async function register(email = EMAIL) {
    const { data } = await api(`${P}/auth/register`, {
      method: 'POST',
      body: { email, password: PASSWORD },
      status: 201,
    });
    return data;
  }
  async function verified(email = EMAIL) {
    const challenge = await register(email);
    return (
      await api(`${P}/auth/register/verify`, {
        method: 'POST',
        body: { challengeId: challenge.challengeId, code: await mailCode(challenge.challengeId) },
        status: 200,
      })
    ).data.account;
  }
  async function begin(client = browser(), extra = {}) {
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(16).toString('hex'),
      nonce = randomBytes(16).toString('hex');
    const query = new URLSearchParams({
      client_id: 'test-native',
      redirect_uri: 'com.example.weftmate:/callback',
      response_type: 'code',
      scope: 'openid offline_access cloud:account',
      prompt: 'consent',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state,
      nonce,
      ...extra,
    });
    const response = await client(`${P}/oidc/auth?${query}`, { status: 303 });
    const location = response.headers.get('location');
    const interaction = await client(location, { status: 200 });
    return { client, verifier, state, nonce, ...interaction.data };
  }
  async function login(
    interaction,
    { email = EMAIL, password = PASSWORD, deviceId = 'test-device', publicJwk } = {},
  ) {
    return interaction.client(`${P}/auth/login`, {
      method: 'POST',
      body: {
        interactionUid: interaction.interactionUid,
        csrfToken: interaction.csrfToken,
        email,
        password,
        deviceId,
        ...(publicJwk ? { publicJwk } : {}),
      },
    });
  }
  async function confirm(interaction, challengeId, code) {
    return interaction.client(`${P}/auth/device/confirm`, {
      method: 'POST',
      body: {
        interactionUid: interaction.interactionUid,
        csrfToken: interaction.csrfToken,
        challengeId,
        code: code ?? (await mailCode(challengeId)),
      },
    });
  }
  async function tokens(interaction, completed) {
    const resumed = await interaction.client(completed.data.resumeUrl, { status: 303 });
    const callback = new URL(resumed.headers.get('location'));
    assert.equal(callback.searchParams.get('state'), interaction.state);
    assert.equal(callback.searchParams.get('error'), null, callback.href);
    const code = callback.searchParams.get('code');
    assert.ok(code);
    const exchanged = await api(`${P}/oidc/token`, {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        client_id: 'test-native',
        redirect_uri: 'com.example.weftmate:/callback',
        code,
        code_verifier: interaction.verifier,
      },
      status: 200,
    });
    return { ...exchanged.data, code };
  }
  async function signedIn(options = {}) {
    const interaction = await begin();
    let result = await login(interaction, options);
    if (result.status === 202) result = await confirm(interaction, result.data.challengeId);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { interaction, ...(await tokens(interaction, result)) };
  }
  async function refresh(token, status = 200) {
    return api(`${P}/oidc/token`, {
      method: 'POST',
      form: { grant_type: 'refresh_token', client_id: 'test-native', refresh_token: token },
      ...(status === null ? {} : { status }),
    });
  }
  return {
    root,
    origin,
    api,
    browser,
    register,
    verified,
    begin,
    login,
    confirm,
    tokens,
    signedIn,
    refresh,
    mailCode,
    get db() {
      return opened.database;
    },
    get identity() {
      return identity;
    },
    get config() {
      return config;
    },
    logs: () => logs,
    advance: (ms) => {
      clock += ms;
    },
    restart: async ({ rotate = false } = {}) => {
      await stop();
      if (rotate) await loadKeys(root, { rotate: true });
      await start();
    },
    get now() { return realProcess ? Date.now() : clock; },
    offline: stop,
  };
}
