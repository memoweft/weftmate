import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, randomBytes, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import * as jose from 'jose';

const sources = await Promise.all(['cloud-auth.js', 'cloud-account.js'].map(name =>
  readFile(new URL('../src/ui-core/' + name, import.meta.url), 'utf8')));
const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...await jose.exportJWK(signing.publicKey), alg: 'RS256', use: 'sig', kid: 'desktop-restore-test' };
const issuer = 'https://cloud.example.test/personal/v1/cloud/oidc';
const base = issuer.replace('/oidc', '');
const reply = (body: any, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body });
function deferred() { let resolve: (value?: any) => void = () => {}; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; }

/** Real client, cryptography and account factory; only transport/storage/UI are synthetic. */
async function fixture({ saved = true, coldOrigin = 'http://127.0.0.1:31001', native = true, phone = false } = {}) {
  const records = new Map<string, any>(), reads: string[] = [], calls: string[] = [], events: string[] = [];
  const bindings = new Map<string, string>();
  const issued = new Map<string, string>();
  const material = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', material.publicKey);
  const nativeKey = { get: async () => ({ deviceId: 'synthetic-desktop', publicJwk: jwk }),
    sign: async (_scope: string, input: string) => Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, material.privateKey, new TextEncoder().encode(input))).toString('base64url'),
    credentialsPresent: async () => [...records.keys()].some(key => key.startsWith('app-tokens:') || key.startsWith('tokens:')),
    clear: async () => { events.push('key-cleared'); } };
  let owner = 'owner-a', authorization: any, now = Date.now(), networkFailure = false, serverUnavailable = false, invalidRefresh = false;
  let configureGate: ReturnType<typeof deferred> | undefined, exchangeGate: ReturnType<typeof deferred> | undefined;
  let resultOwner: string | undefined, failCredentialRead = false, failCredentialRemoval = false;
  const credentials = async (key: string, value?: any, remove = false) => {
    if (key.startsWith('app-tokens:') && (remove && failCredentialRemoval || value === undefined && !remove && failCredentialRead))
      throw { code: 'STORAGE_UNAVAILABLE' };
    if (remove) records.delete(key); else if (value !== undefined) records.set(key, structuredClone(value));
    else { reads.push(key); return records.has(key) ? structuredClone(records.get(key)) : undefined; }
  };
  const context: any = { WeftUiCore: { factories: {} }, btoa, atob, TextEncoder, TextDecoder, URL, URLSearchParams,
    AbortSignal, Uint8Array, setTimeout: () => 1, clearTimeout: () => {} };
  for (const source of sources) runInNewContext(source, context);
  const fetch = async (url: string, options: any = {}) => {
    calls.push(url); const body = options.body && options.headers['content-type'] === 'application/json' ? JSON.parse(options.body) : {};
    if (url.endsWith('/cloud/config')) { if (configureGate) await configureGate.promise; return reply({ issuer, clientId: 'weftmate-desktop', hostId: 'host-test' }); }
    if (networkFailure && url.startsWith(base)) throw Error('synthetic disconnected network');
    if (url.endsWith('/jwks')) return reply({ keys: [publicJwk] });
    if (url.endsWith('/auth/authorization')) { authorization = body; return reply({ interactionUid: 'synthetic-interaction', csrfToken: 'synthetic-csrf' }); }
    if (url.endsWith('/auth/login')) return reply({ account: { email: body.email }, resumeUrl: issuer + '/auth/resume/test' });
    if (url.endsWith('/auth/authorization/resume')) {
      const callback = new URL(authorization.redirectUri);
      for (const [key, value] of Object.entries({ code: 'synthetic-code', state: authorization.state, iss: issuer })) callback.searchParams.set(key, String(value));
      return reply({ callbackUrl: callback.href });
    }
    if (url.endsWith('/oidc/token')) {
      const form = new URLSearchParams(options.body);
      if (serverUnavailable) return reply({ error: { code: 'CLOUD_UNAVAILABLE' } }, 503);
      if (invalidRefresh && form.get('grant_type') === 'refresh_token') return reply({ error: 'invalid_grant' }, 400);
      const token = await new jose.SignJWT({ cnf: { jkt: await jose.calculateJwkThumbprint(jose.decodeProtectedHeader(options.headers.DPoP).jwk!) }, device_verified: true })
        .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid, typ: 'at+jwt' }).setIssuer(issuer)
        .setAudience(form.get('resource') || base).setSubject('cloud-a').setIssuedAt(Math.floor(now / 1000)).setExpirationTime(Math.floor(now / 1000) + 300).sign(signing.privateKey);
      issued.set(token, 'cloud-a');
      const id = await new jose.SignJWT({ nonce: authorization?.nonce }).setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
        .setIssuer(issuer).setAudience('weftmate-desktop').setSubject('cloud-a').setIssuedAt().setExpirationTime('5m').sign(signing.privateKey);
      return reply({ access_token: token, id_token: id, refresh_token: 'synthetic-refresh-' + randomBytes(8).toString('hex'), token_type: 'DPoP', expires_in: 300 });
    }
    if (url.endsWith('/auth/cloud-nonce')) return reply({ nonce: 'synthetic-nonce' });
    if (url.endsWith('/auth/cloud-desktop')) {
      if (exchangeGate) await exchangeGate.promise;
      const sub = issued.get(body.accessToken);
      if (bindings.has(owner) && bindings.get(owner) !== sub || [...bindings].some(([id, value]) => value === sub && id !== owner))
        return reply({ error: { code: 'CLOUD_BINDING_CONFLICT' } }, 409);
      if (options.headers['X-WeftMate-CSRF'] !== 'csrf:' + owner) return reply({ error: { code: 'FORBIDDEN' } }, 403);
      bindings.set(owner, sub!);
      return reply({ account: { ownerId: resultOwner || owner, username: 'Synthetic local' }, device: { id: 'desktop-device' }, csrfToken: 'csrf:' + owner });
    }
    if (url.endsWith('/auth/cloud-session')) return reply(phone ? { status: 'cloud_only' } : { account: { ownerId: owner }, device: { id: 'web-device' }, csrfToken: 'web-csrf' });
    if (url.endsWith('/hosts/connect')) return reply({ hostId: 'host-test', status: 'online' });
    if (url.endsWith('/devices')) return reply({ devices: [], hosts: [] });
    if (url.endsWith('/auth/logout')) return reply({ loggedOut: true });
    return reply({});
  };
  const warm = new context.WeftUiCore.CloudAuthClient({ fetch, crypto: webcrypto, credentials, vendor: jose,
    host: 'http://127.0.0.1:31001', nativeKey: native || phone ? nativeKey : undefined, localCsrf: () => 'csrf:' + owner });
  if (saved) {
    await warm.begin({ email: 'synthetic@example.test', password: 'synthetic-password', deviceName: 'Synthetic desktop' });
    await warm.exchange(true);
  }
  const tokenKey = warm.tokenId || 'app-tokens:' + issuer + ':weftmate-desktop';
  calls.length = 0; reads.length = 0; events.length = 0;
  const core: any = { state: { currentView: 'loading', identityGeneration: 0 }, load: async () => {}, sessionExpired: () => {},
    show: (view: string) => { events.push('show:' + view); core.state.currentView = view; },
    acceptSession: (session: any) => { events.push('local-session'); core.state.identityGeneration++; Object.assign(core.state, { account: session.account, device: session.device, csrfToken: session.csrfToken }); },
    enterAssistant: async () => { events.push('assistant'); core.state.currentView = 'assistant'; },
    clearSession: () => { events.push('clear-local'); core.state.identityGeneration++; core.state.account = null; },
    refreshPendingDevices: async () => {},
    api: async (path: string, options: any) => {
      if (path === '/state') return { configured: true };
      if (path === '/desktop') {
        if (options?.body.ownerId) owner = options.body.ownerId;
        return { account: { ownerId: owner, username: 'Synthetic local' }, device: { id: 'local-device', authKind: 'desktop' }, csrfToken: 'csrf:' + owner, local: true };
      }
      throw Error('Unexpected local auth path ' + path);
    },
    accessApi: async (path: string, options: any) => {
      if (path === '/cloud/binding') { if (options?.method === 'DELETE') bindings.delete(owner); return { status: bindings.has(owner) ? 'active' : 'unbound' }; }
      throw Error('Unexpected local business path ' + path);
    } };
  const environment: any = { fetch, crypto: webcrypto, cloudCredentials: credentials, cloudVendor: jose,
    hostOrigin: coldOrigin, desktop: native, now: () => now,
    ...(phone ? { nativeCloudKey: nativeKey, deviceType: 'android' } : {}),
    ...(native ? { nativeCloudKey: nativeKey, nativeIdentity: async () => ({ localOrigin: coldOrigin, deviceName: 'Synthetic desktop', clientId: 'weftmate-desktop' }) } : {}) };
  Object.assign(core, context.WeftUiCore.factories.cloudAccount(core, { toast: () => {}, paintCloudAuth: () => {}, enterCloudOnly: async () => { events.push('phone-cloud-only'); } }, environment));
  const client = core.initializeCloudAccount();
  const settle = async () => {
    const end = Date.now() + 2000;
    while (Date.now() < end && core.cloudAuthView().restoreState === 'checking') await new Promise(resolve => setImmediate(resolve));
    assert.notEqual(core.cloudAuthView().restoreState, 'checking', 'Background restore did not settle');
  };
  return { core, client, records, reads, calls, events, bindings, tokenKey, settle,
    disconnect: () => { now += 400000; networkFailure = true; }, reconnect: () => { networkFailure = false; },
    unavailable: () => { now += 400000; serverUnavailable = true; }, rejectRefresh: () => { now += 400000; invalidRefresh = true; },
    blockConfiguration: () => { configureGate = deferred(); return configureGate; },
    blockExchange: () => { exchangeGate = deferred(); return exchangeGate; },
    selectOwner: (value: string) => { owner = value; }, returnedOwner: (value: string) => { resultOwner = value; },
    failCredentialRead: () => { failCredentialRead = true; }, failCredentialRemoval: () => { failCredentialRemoval = true; } };
}

test('native desktop cold start restores saved cloud login on both fixed and changed ports', async () => {
  for (const origin of ['http://127.0.0.1:31001', 'http://127.0.0.1:31002']) {
    const f = await fixture({ coldOrigin: origin });
    await f.core.load(); await f.settle();
    assert.equal(f.core.state.currentView, 'assistant');
    assert.equal(f.core.state.account.ownerId, 'owner-a');
    assert.equal(f.core.state.csrfToken, 'csrf:owner-a');
    assert.equal(f.core.cloudAuthView().mode, 'authenticated');
    assert.ok(f.reads.includes(f.tokenKey));
    assert.equal(f.calls.filter(url => url.endsWith('/auth/cloud-desktop')).length, 1);
    assert.equal(f.events.includes('clear-local'), false);
  }
});

test('unbound or unsaved native desktop remains local without an external cloud request', async () => {
  for (const bound of [false, true]) {
    const f = await fixture({ saved: false }); if (bound) f.bindings.set('owner-a', 'cloud-a');
    await f.core.load(); await f.settle();
    assert.equal(f.core.state.currentView, 'assistant');
    assert.equal(f.core.cloudAuthView().mode, 'offline');
    assert.equal(f.core.cloudAuthView().restoreState, bound ? 'none' : 'unbound');
    assert.equal(f.calls.some(url => url.startsWith(base)), false);
    assert.equal(f.core.cloudAuthView().error, '');
    assert.equal(f.events.includes('clear-local'), false);
  }
});

test('a desktop without cloud configuration can switch local accounts before or after the optional restore settles', async () => {
  for (const waitForRestore of [false, true]) {
    const f = await fixture({ saved: false }), fetch = f.client.fetch;
    f.client.fetch = (url: string, options: any) => url.endsWith('/cloud/config') ? reply({ error: { code: 'NOT_FOUND' } }, 404) : fetch(url, options);
    f.core.accessApi = async () => { throw { code: 'NOT_FOUND', status: 404 }; };
    await f.core.load(); if (waitForRestore) await f.settle();
    await f.core.switchLocalAccount('owner-b');
    assert.equal(f.core.state.account.ownerId, 'owner-b');
    assert.equal(f.core.state.currentView, 'assistant');
    assert.equal(f.core.cloudAuthView().mode, 'offline');
    assert.equal(f.records.has(f.tokenKey), false);
    assert.equal(f.calls.some(url => url.startsWith(base)), false);
  }
});

test('missing cloud routes do not let an unknown native credential scope escape cleanup', async () => {
  const f = await fixture(), fetch = f.client.fetch;
  f.client.fetch = (url: string, options: any) => url.endsWith('/cloud/config') ? reply({ error: { code: 'NOT_FOUND' } }, 404) : fetch(url, options);
  f.core.accessApi = async () => { throw { code: 'NOT_FOUND', status: 404 }; };
  await f.core.load(); await f.settle();
  await assert.rejects(f.core.switchLocalAccount('owner-b'), (error: any) => error.code === 'CLOUD_CREDENTIAL_CLEANUP_REQUIRED');
  assert.equal(f.core.state.account.ownerId, 'owner-a');
  assert.equal(f.core.state.csrfToken, 'csrf:owner-a');
  assert.equal(f.records.has(f.tokenKey), true);
});

test('missing or failed native credential presence checks cannot report a completed local switch', async () => {
  for (const missing of [false, true]) {
    const f = await fixture({ saved: false }), fetch = f.client.fetch;
    f.client.fetch = (url: string, options: any) => url.endsWith('/cloud/config') ? reply({ error: { code: 'NOT_FOUND' } }, 404) : fetch(url, options);
    f.core.accessApi = async () => { throw { code: 'NOT_FOUND', status: 404 }; };
    f.client.nativeKey.credentialsPresent = missing ? undefined : async () => { throw { code: 'STORAGE_UNAVAILABLE' }; };
    await f.core.load(); await f.settle();
    await assert.rejects(f.core.switchLocalAccount('owner-b'), (error: any) => error.code === (missing ? 'NATIVE_CREDENTIAL_CHECK_REQUIRED' : 'STORAGE_UNAVAILABLE'));
    assert.equal(f.core.state.account.ownerId, 'owner-a');
    assert.equal(f.core.state.csrfToken, 'csrf:owner-a');
    if (missing) assert.match(f.core.cloudError({ code: 'NATIVE_CREDENTIAL_CHECK_REQUIRED' }), /更新电脑上的 WeftMate/);
  }
});

test('an older desktop bridge can still clear known cloud credentials without the new presence query', async () => {
  const f = await fixture(); f.client.nativeKey.credentialsPresent = undefined; f.bindings.delete('owner-a');
  await f.core.load(); await f.settle();
  await f.core.switchLocalAccount('owner-b');
  assert.equal(f.core.state.account.ownerId, 'owner-b');
  assert.equal(f.records.has(f.tokenKey), false);
});

test('pending cloud configuration never delays local load or opens a login page', async () => {
  const f = await fixture(), gate = f.blockConfiguration();
  await f.core.load();
  assert.equal(f.core.state.currentView, 'assistant');
  assert.equal(f.core.state.csrfToken, 'csrf:owner-a');
  assert.equal(f.core.cloudAuthView().mode, 'offline');
  assert.equal(f.core.cloudAuthView().restoreState, 'checking');
  gate.resolve(); await f.settle();
  assert.equal(f.core.cloudAuthView().mode, 'authenticated');
  assert.equal(f.events.includes('show:login'), false);
});

test('network and server outages preserve saved credentials and the local owner', async () => {
  for (const outage of ['disconnect', 'unavailable'] as const) {
    const f = await fixture(); f[outage]();
    await f.core.load(); await f.settle();
    assert.equal(f.core.cloudAuthView().restoreState, 'unavailable');
    assert.equal(f.core.cloudAuthView().mode, 'offline');
    assert.equal(f.core.state.currentView, 'assistant');
    assert.equal(f.core.state.account.ownerId, 'owner-a');
    assert.equal(f.records.has(f.tokenKey), true);
    assert.equal(f.events.includes('show:login'), false);
    assert.ok(f.core.cloudAuthView().error);
    if (outage === 'disconnect') {
      f.reconnect(); await f.core.load(); await f.settle();
      assert.equal(f.core.cloudAuthView().mode, 'authenticated');
    }
  }
});

test('a rejected refresh drops cloud authority while preserving local contents and navigation', async () => {
  const f = await fixture(); f.rejectRefresh();
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'expired');
  assert.equal(f.core.cloudAuthView().mode, 'offline');
  assert.equal(f.records.has(f.tokenKey), false);
  assert.equal(f.core.state.account.ownerId, 'owner-a');
  assert.equal(f.core.state.currentView, 'assistant');
  assert.equal(f.events.includes('clear-local'), false);
});

test('a native credential read failure preserves unread credentials and local usability', async () => {
  const f = await fixture(); f.failCredentialRead();
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'unavailable');
  assert.equal(f.records.has(f.tokenKey), true);
  assert.equal(f.core.cloudAuthView().mode, 'offline');
  assert.equal(f.core.state.account.ownerId, 'owner-a');
});

test('a credential cleanup failure remains an unavailable optional restore, not an unhandled task', async () => {
  const f = await fixture(); f.rejectRefresh(); f.failCredentialRemoval();
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'unavailable');
  assert.equal(f.core.cloudAuthView().mode, 'offline');
  assert.equal(f.records.has(f.tokenKey), true);
  assert.equal(f.core.state.currentView, 'assistant');
});

test('a saved cloud subject cannot bind itself to a different selected local owner', async () => {
  const f = await fixture(); f.bindings.set('owner-b', 'cloud-b'); f.selectOwner('owner-b');
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'conflict');
  assert.equal(f.core.cloudAuthView().mode, 'offline');
  assert.equal(f.core.state.account.ownerId, 'owner-b');
  assert.equal(f.core.state.csrfToken, 'csrf:owner-b');
  assert.equal(f.records.has(f.tokenKey), false);
  assert.deepEqual([...f.bindings], [['owner-a', 'cloud-a'], ['owner-b', 'cloud-b']]);
});

test('existing saved credentials do not automatically claim an unbound local account', async () => {
  const f = await fixture(); f.bindings.delete('owner-a');
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'unbound');
  assert.equal(f.calls.length, 0); assert.equal(f.reads.length, 0);
  assert.equal(f.bindings.size, 0); assert.equal(f.records.has(f.tokenKey), true);
});

test('restore rejects a returned host owner that differs from the local session', async () => {
  const f = await fixture(); f.returnedOwner('owner-b');
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'conflict');
  assert.equal(f.core.cloudAuthView().restoreAccountMatched, false);
  assert.equal(f.core.state.account.ownerId, 'owner-a');
  assert.equal(f.core.state.csrfToken, 'csrf:owner-a');
  assert.equal(f.records.has(f.tokenKey), false);
});

test('explicit logout cannot be undone by a later load', async () => {
  const f = await fixture(); await f.core.load(); await f.settle();
  await f.core.cloudLogout(); const exchanges = f.calls.filter(url => url.endsWith('/auth/cloud-desktop')).length;
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().mode, 'offline');
  assert.equal(f.core.cloudAuthView().restoreState, 'none');
  assert.equal(f.calls.filter(url => url.endsWith('/auth/cloud-desktop')).length, exchanges);
  assert.equal(f.records.has(f.tokenKey), false);
  assert.equal(f.core.state.account.ownerId, 'owner-a');
});

function failConfigurationCacheWrites(f: any, persistent = false) {
  const credentials = f.client.credentials; let failed = false;
  f.client.credentials = async (key: string, value: any, remove: boolean) => {
    if (key.startsWith('offline-config:') && value !== undefined && (persistent || !failed)) {
      failed = true; throw { code: 'STORAGE_UNAVAILABLE' };
    }
    return credentials(key, value, remove);
  };
}

test('saved credential lookup retries configuration after its cache write failed', async () => {
  const f = await fixture(); failConfigurationCacheWrites(f);
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'unavailable');
  assert.ok(await f.client.saved(), 'An incomplete configuration must not read an undefined storage key');
  assert.equal(f.calls.filter(url => url.endsWith('/cloud/config')).length, 2);
  assert.ok(f.reads.includes(f.tokenKey));
});

test('logout retries incomplete configuration after a temporary cache write failure and cannot revive the login', async () => {
  const f = await fixture(); failConfigurationCacheWrites(f);
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'unavailable');
  assert.equal(f.records.has(f.tokenKey), true);
  await f.core.cloudLogout();
  assert.equal(f.records.has(f.tokenKey), false, 'Completed logout must remove the saved native credential');
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().mode, 'offline');
  assert.equal(f.core.state.account.ownerId, 'owner-a');
});

test('switching away and back after a temporary configuration cache failure cannot restore the old login', async () => {
  const f = await fixture(); failConfigurationCacheWrites(f);
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'unavailable');
  await f.core.switchLocalAccount('owner-b');
  assert.equal(f.core.state.account.ownerId, 'owner-b');
  assert.equal(f.records.has(f.tokenKey), false, 'Completed owner switch must remove the previous cloud credential');
  await f.core.switchLocalAccount('owner-a'); await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().mode, 'offline');
  assert.equal(f.core.state.account.ownerId, 'owner-a');
});

test('an unbound owner on a cloud-configured desktop still clears saved credentials when switching', async () => {
  const f = await fixture(); f.bindings.delete('owner-a');
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'unbound');
  assert.equal(f.records.has(f.tokenKey), true);
  await f.core.switchLocalAccount('owner-b');
  assert.equal(f.core.state.account.ownerId, 'owner-b');
  assert.equal(f.records.has(f.tokenKey), false);
});

test('a previously observed cloud scope cannot skip required cleanup when its local routes later disappear', async () => {
  const f = await fixture(); failConfigurationCacheWrites(f);
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().restoreState, 'unavailable');
  const fetch = f.client.fetch;
  f.client.fetch = (url: string, options: any) => url.endsWith('/cloud/config') ? reply({ error: { code: 'NOT_FOUND' } }, 404) : fetch(url, options);
  f.core.accessApi = async () => { throw { code: 'NOT_FOUND', status: 404 }; };
  await assert.rejects(f.core.switchLocalAccount('owner-b'), (error: any) => error.status === 404);
  assert.equal(f.core.state.account.ownerId, 'owner-a');
  assert.equal(f.core.state.csrfToken, 'csrf:owner-a');
  assert.equal(f.records.has(f.tokenKey), true);
});

test('unavailable configuration prevents logout or switching from reporting credential cleanup as complete', async () => {
  for (const action of ['logout', 'switch']) {
    const f = await fixture(); failConfigurationCacheWrites(f, true);
    await f.core.load(); await f.settle();
    await assert.rejects(action === 'logout' ? f.core.cloudLogout() : f.core.switchLocalAccount('owner-b'),
      (error: any) => error.code === 'STORAGE_UNAVAILABLE');
    assert.equal(f.records.has(f.tokenKey), true);
    assert.equal(f.core.state.account.ownerId, 'owner-a');
    assert.equal(f.core.state.csrfToken, 'csrf:owner-a');
  }
});

test('a newer login survives the late response from an older logout request', async () => {
  const f = await fixture(); await f.core.load(); await f.settle();
  const gate = deferred(), entered = deferred(), fetch = f.client.fetch;
  f.client.fetch = async (url: string, options: any) => {
    if (url.endsWith('/auth/logout')) { entered.resolve(); await gate.promise; }
    return fetch(url, options);
  };
  const loggedOut = f.core.cloudLogout(); await entered.promise;
  f.core.startCloudJourney(); await f.core.cloudLogin({ email: 'synthetic@example.test', password: 'synthetic-password' });
  assert.equal(f.core.cloudAuthView().mode, 'authenticated');
  gate.resolve(); await loggedOut;
  assert.equal(f.core.cloudAuthView().mode, 'authenticated');
  assert.equal(f.records.has(f.tokenKey), true);
  assert.equal(f.events.includes('key-cleared'), false);
  assert.equal(f.core.state.csrfToken, 'csrf:owner-a');
});

test('a superseded logout cannot transmit after waiting for its native proof signature', async () => {
  const f = await fixture(); await f.core.load(); await f.settle();
  const gate = deferred(), entered = deferred(), sign = f.client.nativeKey.sign;
  let blocked = false;
  f.client.nativeKey.sign = async (scope: string, input: string) => {
    const payload = JSON.parse(Buffer.from(input.split('.')[1], 'base64url').toString());
    if (!blocked && payload.htu.endsWith('/auth/logout')) { blocked = true; entered.resolve(); await gate.promise; }
    return sign(scope, input);
  };
  const loggedOut = f.core.cloudLogout(); await entered.promise;
  assert.equal(f.calls.some(url => url.endsWith('/auth/logout')), false);
  f.core.startCloudJourney(); await f.core.cloudLogin({ email: 'synthetic@example.test', password: 'synthetic-password' });
  assert.equal(f.core.cloudAuthView().mode, 'authenticated');
  gate.resolve(); await loggedOut;
  assert.equal(f.calls.some(url => url.endsWith('/auth/logout')), false, 'A stale logout must stop before any device-revoking HTTP request');
  assert.equal(f.core.cloudAuthView().mode, 'authenticated');
  assert.equal(f.records.has(f.tokenKey), true);
  assert.equal(f.events.includes('key-cleared'), false);
});

test('a newer login supersedes logout while its local binding removal response is pending', async () => {
  const f = await fixture(); await f.core.load(); await f.settle();
  f.core.state.cloudAuth.multiHostSupported = true;
  const gate = deferred(), entered = deferred(), accessApi = f.core.accessApi;
  f.core.accessApi = async (path: string, options: any) => {
    const result = await accessApi(path, options);
    if (path === '/cloud/binding' && options?.method === 'DELETE') { entered.resolve(); await gate.promise; }
    return result;
  };
  const loggedOut = f.core.cloudLogout(); await entered.promise;
  f.core.startCloudJourney(); await f.core.cloudLogin({ email: 'synthetic@example.test', password: 'synthetic-password' });
  gate.resolve(); await loggedOut;
  assert.equal(f.core.cloudAuthView().mode, 'authenticated');
  assert.equal(f.records.has(f.tokenKey), true);
  assert.equal(f.events.includes('key-cleared'), false);
  assert.equal(f.calls.some(url => url.endsWith('/auth/logout')), false);
});

test('a changed local session generation supersedes an older logout response', async () => {
  const f = await fixture(); await f.core.load(); await f.settle();
  const gate = deferred(), entered = deferred(), fetch = f.client.fetch;
  f.client.fetch = async (url: string, options: any) => {
    if (url.endsWith('/auth/logout')) { entered.resolve(); await gate.promise; }
    return fetch(url, options);
  };
  const loggedOut = f.core.cloudLogout(); await entered.promise;
  f.core.acceptSession({ account: { ownerId: 'owner-a' }, device: { id: 'new-local-session' }, csrfToken: 'new-local-csrf' });
  gate.resolve(); await loggedOut;
  assert.equal(f.core.cloudAuthView().mode, 'authenticated');
  assert.equal(f.records.has(f.tokenKey), true);
  assert.equal(f.events.includes('key-cleared'), false);
  assert.equal(f.core.state.device.id, 'new-local-session');
  assert.equal(f.core.state.csrfToken, 'new-local-csrf');
});

test('a newer login survives a late native key reset or credential removal acknowledgement', async () => {
  for (const stage of ['resetKey', 'forget']) {
    const f = await fixture(); await f.core.load(); await f.settle();
    const gate = deferred(), entered = deferred(), original = f.client[stage];
    f.client[stage] = async () => { await original.call(f.client); entered.resolve(); await gate.promise; };
    const loggedOut = f.core.cloudLogout(); await entered.promise;
    f.core.startCloudJourney(); await f.core.cloudLogin({ email: 'synthetic@example.test', password: 'synthetic-password' });
    assert.equal(f.core.cloudAuthView().mode, 'authenticated');
    gate.resolve(); await loggedOut;
    assert.equal(f.core.cloudAuthView().mode, 'authenticated', 'An old cleanup acknowledgement must not publish offline');
    assert.equal(f.records.has(f.tokenKey), true);
    assert.equal(f.core.state.csrfToken, 'csrf:owner-a');
  }
});

test('logout during initial configuration removes the saved native credential before resolving', async () => {
  const f = await fixture(), gate = f.blockConfiguration(); await f.core.load();
  const loggedOut = f.core.cloudLogout(); gate.resolve(); await loggedOut; await f.settle();
  assert.equal(f.records.has(f.tokenKey), false);
  await f.core.load(); await f.settle();
  assert.equal(f.core.cloudAuthView().mode, 'offline');
  assert.equal(f.core.cloudAuthView().restoreState, 'none');
});

test('switching owners during initial configuration cannot retain the previous cloud credential', async () => {
  const f = await fixture(), gate = f.blockConfiguration(); await f.core.load();
  const switched = f.core.switchLocalAccount('owner-b'); gate.resolve(); await switched; await f.settle();
  assert.equal(f.records.has(f.tokenKey), false);
  assert.equal(f.core.state.account.ownerId, 'owner-b');
  assert.equal(f.core.cloudAuthView().mode, 'offline');
});

test('logout or account switch during a restore rejects its delayed result', async () => {
  for (const action of ['logout', 'switch']) {
    const f = await fixture(), gate = f.blockExchange(); await f.core.load();
    const end = Date.now() + 2000;
    while (!f.calls.some(url => url.endsWith('/auth/cloud-desktop')) && Date.now() < end) await new Promise(resolve => setImmediate(resolve));
    assert.ok(f.calls.some(url => url.endsWith('/auth/cloud-desktop')));
    if (action === 'logout') await f.core.cloudLogout(); else await f.core.switchLocalAccount('owner-b');
    gate.resolve(); await f.settle();
    assert.equal(f.core.cloudAuthView().mode, 'offline');
    assert.equal(f.core.cloudAuthView().restoreState, 'cancelled');
    assert.equal(f.core.state.account.ownerId, action === 'logout' ? 'owner-a' : 'owner-b');
    assert.equal(f.records.has(f.tokenKey), false);
  }
});

test('the normal browser and phone paths continue their original cloud session flow', async () => {
  for (const phone of [false, true]) {
    const f = await fixture({ native: false, phone });
    await f.core.load();
    assert.equal(f.core.cloudAuthView().mode, 'authenticated');
    assert.equal(f.core.cloudAuthView().restoreState, undefined);
    assert.equal(f.calls.some(url => url.endsWith('/auth/cloud-desktop')), false);
    assert.equal(f.calls.some(url => url.endsWith('/auth/cloud-session')), true);
    assert.equal(f.events.includes('phone-cloud-only'), phone);
  }
});
