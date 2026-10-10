import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto, randomBytes } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import * as jose from 'jose'
import { desktopAuthStorage } from '../src/personal-desktop-auth.mjs'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const source = ['cloud-auth.js', 'cloud-account.js'].map(file => readFileSync(new URL('../src/ui-core/' + file, import.meta.url), 'utf8')).join('\n;\n')
const signing = await jose.generateKeyPair('RS256', { extractable: true })
const publicJwk = { ...await jose.exportJWK(signing.publicKey), kid: 'synthetic-signing', alg: 'RS256', use: 'sig' }
const issuer = 'https://api.example.com/personal/v1/cloud/oidc', base = issuer.replace('/oidc', '')
const response = (value: any, status = 200, retry = '') => ({ ok: status < 400, status, headers: { get: () => retry }, json: async () => value })
async function fixture() {
  let now = Date.now(), authorization: any, sequence = 0, nonceOverride: string | null = null, subOverride: string | null = null, audienceOverride: string | null = null, callbackOverride: string | null = null, rejectRefresh = false
  const records = new Map<string, any>(), calls: any[] = [], timers: Array<() => unknown> = [], cleared: number[] = []
  const credentials = async (key: string, value?: any, remove = false) => { if (remove) records.delete(key); else if (value !== undefined) records.set(key, value); else return records.get(key) }
  const context: any = { WeftUiCore: { factories: {} }, btoa, atob, TextEncoder, TextDecoder, URL, URLSearchParams, AbortSignal,
    Uint8Array, setTimeout: (fn: () => unknown) => { timers.push(fn); return timers.length }, clearTimeout: (id: number) => { cleared.push(id) } }
  runInNewContext(source, context)
  let client: any
  const fetch = async (url: string, options: any = {}) => {
    const body = options.body && options.headers['content-type'] === 'application/json' ? JSON.parse(options.body) : undefined
    calls.push({ url, options, body })
    if (url.endsWith('/cloud/config')) return response({ issuer, clientId: 'weftmate-web', hostId: 'host-test' })
    if (url.endsWith('/jwks')) return response({ keys: [publicJwk] })
    if (url.endsWith('/auth/authorization')) { authorization = body; return response({ interactionUid: 'interaction-test', csrfToken: 'csrf-test' }) }
    if (url.endsWith('/auth/login')) return response({ account: { cloudAccountId: 'account-test', email: body.email }, resumeUrl: issuer + '/auth/resume/test' })
    if (url.endsWith('/auth/authorization/resume')) return response({ callbackUrl: callbackOverride || `https://host.example.com/personal/v1/ui/?code=synthetic-code&state=${authorization.state}&iss=${encodeURIComponent(issuer)}` })
    if (url.endsWith('/oidc/token')) {
      const form = new URLSearchParams(options.body)
      if (rejectRefresh && form.get('grant_type') === 'refresh_token') return response({ error: 'invalid_grant' }, 400)
      const key = await client.key(), jkt = await jose.calculateJwkThumbprint(key.publicJwk)
      const access = await new jose.SignJWT({ cnf: { jkt } }).setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid, typ: 'at+jwt' })
        .setIssuer(issuer).setAudience(audienceOverride || form.get('resource') || base).setSubject(subOverride || 'account-test').setIssuedAt().setExpirationTime('5m').sign(signing.privateKey)
      const id = await new jose.SignJWT({ nonce: nonceOverride || authorization?.nonce }).setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
        .setIssuer(issuer).setAudience('weftmate-web').setSubject('account-test').setIssuedAt().setExpirationTime('5m').sign(signing.privateKey)
      return response({ access_token: access, id_token: id, refresh_token: 'synthetic-rotation-' + ++sequence, token_type: 'DPoP', expires_in: 300 })
    }
    if (url.endsWith('/hosts/connect')) return response({ hostId: 'host-test', status: 'online', approval: 'trusted', resource: base + '/hosts/host-test', pairingRequired: false })
    if (url.endsWith('/auth/cloud-nonce')) return response({ nonce: randomBytes(24).toString('base64url') })
    if (url.endsWith('/auth/cloud-desktop') || url.endsWith('/auth/cloud-session')) return response({ account: { ownerId: 'owner-test', username: 'Synthetic' }, device: { id: 'device-test' }, csrfToken: 'csrf-session' })
    if (url.endsWith('/devices')) return response({ devices: [], hosts: [] })
    if (url.endsWith('/registration/request')) return response({ challengeId: 'challenge-test', expiresIn: 600 })
    if (url.endsWith('/registration/verify')) return response({ passwordTicket: 'synthetic-ticket' })
    return response({})
  }
  const environment = { fetch, crypto: webcrypto, cloudCredentials: credentials, cloudVendor: jose, hostOrigin: 'https://host.example.com', now: () => now, desktop: false }
  client = new context.WeftUiCore.CloudAuthClient({ fetch, crypto: webcrypto, credentials, vendor: jose, host: environment.hostOrigin, now: environment.now })
  await client.configure()
  return { client, records, calls, timers, cleared, context, environment, credentials, advance: (ms: number) => { now += ms },
    nonce: (value: string) => { nonceOverride = value }, sub: (value: string) => { subOverride = value }, audience: (value: string) => { audienceOverride = value },
    callback: (value: string) => { callbackOverride = value }, rejectRefresh: () => { rejectRefresh = true }, allowRefresh: () => { rejectRefresh = false }, useClient: (value: any) => { client = value } }
}
const login = async (f: any) => f.client.begin({ email: 'synthetic@example.com', password: randomBytes(24).toString('base64url'), deviceName: 'Synthetic browser' })

test('legacy local binding uses App login and preserves the current owner/session without desktop bootstrap', async () => {
  const f = await fixture(), writes: any[] = [], notices: string[] = []
  const account = { ownerId: 'legacy-owner', username: 'legacy-local' }
  let opened = 0, entered = 0
  const core: any = { state: { account }, show: () => {}, load: () => {}, clearSession: () => {}, sessionExpired: () => {},
    acceptSession: () => assert.fail('Binding must keep the original local session'), enterAssistant: async () => { entered++ }, openAccount: () => { opened++ },
    accessApi: async (path: string, options: any) => { writes.push({ path, options }); return path === '/cloud/claims' ? { claimId: 'legacy-claim' } : { bound: true } } }
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, { toast: (message: string) => notices.push(message) }, f.environment))
  const client = core.initializeCloudAccount(); f.useClient(client); await client.configure()
  await core.cloudBindDesktop(); core.startCloudJourney('registration'); core.startCloudJourney();
  await core.cloudLogin({ email: 'synthetic@example.com', password: randomBytes(24).toString('base64url') })
  assert.deepEqual(writes.map(row => row.path), ['/cloud/claims', '/cloud/binding'])
  assert.equal(writes[1].options.body.claimId, 'legacy-claim'); assert.ok(writes[1].options.body.accessToken)
  assert.ok(writes.every(row => row.options.protectedWrite === true))
  assert.equal(core.state.account, account); assert.equal(entered, 1); assert.equal(opened, 1)
  assert.equal(core.cloudAuthView().mode, 'offline'); assert.equal(await client.saved(), undefined)
  assert.equal(await f.credentials('offline-account'), undefined)
  assert.equal(f.calls.some(row => /auth\/cloud-(desktop|session)$/.test(row.url)), false)
  assert.ok(notices.includes('已绑定 WeftMate 账号。'))
})

test('failed legacy binding retains its claim for retry and cancellation does not bootstrap a local owner', async () => {
  const f = await fixture(); let failed = true; const claims: string[] = []
  const core: any = { state: { account: { ownerId: 'legacy-owner' } }, show: () => {}, load: () => {}, clearSession: () => {}, sessionExpired: () => {},
    acceptSession: () => assert.fail('A failed binding cannot replace the local session'), enterAssistant: async () => {}, openAccount: () => {},
    accessApi: async (path: string, options: any) => { if (path === '/cloud/claims') return { claimId: 'retry-claim' }; claims.push(options.body.claimId); if (failed) throw { code: 'CLOUD_UNAVAILABLE' }; return { bound: true } } }
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, { toast: () => {} }, f.environment))
  const client = core.initializeCloudAccount(); f.useClient(client); await client.configure()
  await core.cloudBindDesktop(); await core.cloudLogin({ email: 'synthetic@example.com', password: randomBytes(24).toString('base64url') })
  assert.equal(core.cloudAuthView().mode, 'login'); assert.equal(core.state.account.ownerId, 'legacy-owner')
  failed = false; await core.cloudLogin({ email: 'synthetic@example.com', password: randomBytes(24).toString('base64url') })
  assert.deepEqual(claims, ['retry-claim', 'retry-claim'])
  await core.cloudBindDesktop(); await core.cancelCloudJourney(); assert.equal(core.state.account.ownerId, 'legacy-owner')
  assert.equal(f.calls.some(row => row.url.endsWith('/auth/cloud-desktop')), false)
})

test('an explicit legacy username chooses local password login even when a cloud account was remembered', async () => {
  const f = await fixture(); await f.credentials('offline-account', { sub: 'remembered-cloud-sub' })
  const localCalls: any[] = []
  const core: any = { state: {}, show: () => {}, load: () => {}, clearSession: () => {}, sessionExpired: () => {}, acceptSession: () => {}, enterAssistant: async () => {},
    api: async (path: string, options: any) => { localCalls.push({ path, options }); return {} } }
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, {}, f.environment)); core.initializeCloudAccount()
  await core.cloudOfflineLogin({ username: 'legacy-local', password: randomBytes(24).toString('base64url') })
  assert.equal(localCalls[0].path, '/login'); assert.equal(localCalls[0].options.body.username, 'legacy-local')
  assert.equal('cloudAccountId' in localCalls[0].options.body, false)
})

test('app login produces PKCE S256, nonextractable key and exact DPoP method/URL/token digest without navigation', async () => {
  const f = await fixture(); await login(f)
  const bootstrap = f.calls.find(row => row.url.endsWith('/auth/authorization')).body
  assert.equal(bootstrap.codeChallenge.length, 43); assert.ok(bootstrap.state.length >= 16); assert.notEqual(bootstrap.nonce, bootstrap.state)
  const exchange = f.calls.find(row => row.url.endsWith('/oidc/token')), form = new URLSearchParams(exchange.options.body)
  assert.equal(await f.client.hash(form.get('code_verifier')), bootstrap.codeChallenge)
  assert.equal((await f.client.key()).privateKey.extractable, false)
  await f.client.authorized('/devices')
  const read = f.calls.at(-1), key = await jose.importJWK((await f.client.key()).publicJwk, 'ES256')
  const proof = (await jose.jwtVerify(read.options.headers.DPoP, key, { algorithms: ['ES256'], typ: 'dpop+jwt' })).payload
  assert.equal(proof.htm, 'GET'); assert.equal(proof.htu, base + '/devices')
  assert.equal(proof.ath, await f.client.hash(read.options.headers.Authorization.slice(5)))
  assert.ok(f.calls.filter(row => row.options.method === 'POST').every(row => row.options.credentials === 'include'))
})
test('callback rejects state, issuer and exact redirect mismatches before exchanging any code', async () => {
  for (const callback of ['https://host.example.com/personal/v1/ui/?code=x&state=wrong', 'https://other.example.com/personal/v1/ui/?code=x&state=wrong',
    'https://host.example.com/personal/v1/ui/?code=x&state=wrong&iss=https://other.example.com']) {
    const f = await fixture(); f.callback(callback); await assert.rejects(login(f)); assert.equal(f.calls.filter(row => row.url.endsWith('/token')).length, 0)
  }
  const native = await fixture(); native.client.redirectUri = 'com.example.weftmate:/callback';
  const original = native.client.fetch;
  native.client.fetch = async (...args: any[]) => {
    const reply = await original(...args);
    if (!args[0].endsWith('/auth/authorization/resume')) return reply;
    const state = native.calls.find(row => row.url.endsWith('/auth/authorization')).body.state;
    return response({ callbackUrl: `other.example.weftmate:/callback?code=synthetic-code&state=${state}&iss=${encodeURIComponent(issuer)}` });
  };
  await assert.rejects(login(native));
  assert.equal(native.calls.filter(row => row.url.endsWith('/token')).length, 0)
})
test('cancelled authorization cannot save late tokens, and an altered JWT never passes fixed JWKS verification', async () => {
  const f = await fixture(), original = f.client.fetch
  let release!: (value: any) => void, started!: () => void, reply: any
  const latch = new Promise<void>(resolve => { started = resolve }), delayed = new Promise(resolve => { release = resolve })
  f.client.fetch = async (...args: any[]) => { const result = await original(...args); if (args[0].endsWith('/token')) { reply = result; started(); return delayed } return result }
  const pending = login(f); await latch; await f.client.forget(); release(reply)
  await assert.rejects(pending); assert.equal(await f.client.saved(), undefined)
  f.client.fetch = original; await login(f); const token = (await f.client.saved()).cloud.token
  const pieces = token.split('.'); pieces[2] = (pieces[2][0] === 'A' ? 'B' : 'A') + pieces[2].slice(1)
  await assert.rejects(f.client.verify({ token_type: 'DPoP', access_token: pieces.join('.') }, { sub: 'account-test' }))
})
test('ID nonce, access subject and audience are independently verified against fixed JWKS', async () => {
  for (const change of ['nonce', 'sub', 'audience'] as const) { const f = await fixture(); f[change]('different'); await assert.rejects(login(f)); assert.equal(await f.client.saved(), undefined) }
})
test('cloud/host audiences share one atomic rotation family and simultaneous refresh is serialized', async () => {
  const f = await fixture(); await login(f); const first = await f.client.saved(); first.cloud.expiresAt = 0
  await Promise.all([f.client.access(), f.client.access()]);
  assert.equal(f.calls.filter(row => row.url.endsWith('/token')).length, 2)
  const cloudToken = (await f.client.saved()).cloud.token
  await f.client.exchange(); const saved = await f.client.saved()
  assert.equal(saved.cloud.token, cloudToken); assert.equal(saved.host.audience, base + '/hosts/host-test'); assert.equal(saved.refreshToken, 'synthetic-rotation-3')
  const proof = jose.decodeJwt(f.calls.find(row => row.url.endsWith('/auth/cloud-session')).options.headers.DPoP)
  assert.equal(proof.ath, await f.client.hash(saved.host.token)); assert.ok(proof.nonce)
})
test('registration state and 60 second resend deadline live in the shared core; credentials never save password/ticket', async () => {
  const f = await fixture(), paints: any[] = []
  const core: any = { state: { desktopDraft: '', cloudAuth: null }, show: () => {}, load: () => {}, sessionExpired: () => {} }
  const effects = { paintCloudAuth: (value: any) => paints.push(value) }
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, effects, f.environment)); const client = core.initializeCloudAccount(); f.useClient(client)
  core.startCloudJourney('registration'); await core.cloudRequestCode('synthetic@example.com')
  assert.equal(core.cloudAuthView().step, 'code'); assert.equal(core.cloudAuthView().resendSeconds, 60)
  await core.cloudRequestCode(); assert.equal(f.calls.filter(row => row.url.endsWith('/registration/request')).length, 1)
  f.advance(59001); assert.equal(core.cloudAuthView().resendSeconds, 1); f.advance(999); assert.equal(core.cloudAuthView().resendSeconds, 0)
  await core.cloudVerifyCode('123456'); assert.equal(core.cloudAuthView().step, 'password')
  const password = randomBytes(24).toString('base64url');
  await core.cloudComplete({ password, confirmation: password, deviceName: 'X'.repeat(129) });
  assert.equal(f.calls.filter(row => row.url.endsWith('/registration/complete')).length, 0, 'bad device names must not consume the password ticket')
  assert.match(core.cloudAuthView().error, /设备名称/)
  assert.equal(f.records.size, 2, 'only the key and public offline connection configuration were persisted')
  assert.equal([...f.records.keys()].filter(key => key.startsWith('offline-config:')).length, 1)
  assert.equal(JSON.stringify([...f.records.values()]).includes(password), false)
  assert.equal(JSON.stringify([...f.records.values()]).includes('passwordTicket'), false)
  assert.equal(core.cloudPasswordHint('short'), '至少 8 位'); assert.ok(paints.length)
})
test('pending approval exchanges share one request and stop polling after success without leaving Settings', async () => {
  const f = await fixture(), original = f.environment.fetch
  let pending = true, entries = 0
  f.environment.fetch = async (...args: any[]) => { const reply = await original(...args); return args[0].endsWith('/auth/cloud-session') && pending
    ? response({ status: 'pending_approval', requestId: 'request-test' }, 202) : reply }
  const core: any = { state: { currentView: 'login' }, show: (view: string) => { core.state.currentView = view }, load: () => {}, clearSession: () => {}, sessionExpired: () => {},
    acceptSession: () => {}, enterAssistant: async () => { entries++; core.state.currentView = 'assistant' }, refreshPendingDevices: async () => {} }
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, {}, f.environment))
  const client = core.initializeCloudAccount(); f.useClient(client); await client.configure()
  await core.cloudLogin({ email: 'synthetic@example.com', password: randomBytes(24).toString('base64url') }); assert.equal(core.cloudAuthView().mode, 'waiting')
  pending = false; await Promise.all([core.retryCloudApproval(), core.retryCloudApproval()])
  assert.equal(entries, 1); assert.equal(f.calls.filter(row => row.url.endsWith('/auth/cloud-session')).length, 2)
  assert.ok(f.cleared.includes(1), 'the pending timer was cancelled')
  core.state.currentView = 'account'; await core.retryCloudApproval(); await f.timers[0]()
  assert.equal(core.state.currentView, 'account'); assert.equal(entries, 1)
})
test('another host is selected through trusted native data transport; a failed exchange preserves the previous host', async () => {
  const f = await fixture(), activated: any[] = [], requested: any[] = []
  const core: any = { state: {}, accessBase: '/personal/v1', authBase: '/personal/v1/auth', show: () => {}, load: () => {}, clearSession: () => {}, sessionExpired: () => {},
    acceptSession: () => {}, enterAssistant: async () => {}, refreshPendingDevices: async () => {} }
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, { openCloudHost: async (target: any) => { requested.push(target); return target },
    activateCloudHost: async (target: any) => { activated.push(target) } }, f.environment))
  const client = core.initializeCloudAccount(); f.useClient(client); await client.configure(); await login(f)
  await assert.rejects(core.cloudConnectTrusted({ hostId: 'other-host', baseUrl: 'https://other.example.com' }))
  assert.equal(requested.length, 0, 'an account directory cannot establish a pin')
  await f.credentials('trusted-host:other-host', { tlsSpki: randomBytes(32).toString('base64url'), origin: 'https://other.example.com' })
  await core.cloudConnectTrusted({ hostId: 'other-host', baseUrl: 'https://other.example.com' })
  assert.equal(activated.length, 1); assert.equal(core.accessBase, 'https://other.example.com/personal/v1')
  assert.equal(client.config.hostId, 'other-host'); assert.equal((await client.saved()).host.audience, base + '/hosts/other-host')
  const original = client.fetch;
  client.fetch = async (...args: any[]) => { if (args[0].startsWith('https://offline.example.com')) throw new Error('Synthetic offline peer'); return original(...args) }
  await f.credentials('trusted-host:offline-host', { tlsSpki: randomBytes(32).toString('base64url'), origin: 'https://offline.example.com' })
  await assert.rejects(core.cloudConnectTrusted({ hostId: 'offline-host', baseUrl: 'https://offline.example.com' }))
  assert.equal(activated.length, 1); assert.equal(client.host, 'https://other.example.com'); assert.equal(client.config.hostId, 'other-host')
  assert.equal(core.accessBase, 'https://other.example.com/personal/v1')
})
test('expired refresh returns to login, clears host cookie, and restores a draft only for the same account', async () => {
  const f = await fixture(), restored: string[] = [], views: string[] = [], hostCalls: any[] = []
  const core: any = { state: { desktopDraft: '', cloudAuth: null }, show: (view: string) => views.push(view), load: () => {}, sessionExpired: () => {},
    acceptSession: () => {}, enterAssistant: async () => {}, refreshPendingDevices: async () => {}, clearSession: () => {}, api: async (...args: any[]) => { hostCalls.push(args) } }
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, { readMessageDraft: () => 'Synthetic unsent draft', restoreCloudDraft: (draft: string) => restored.push(draft) }, f.environment))
  const client = core.initializeCloudAccount(); f.useClient(client); await client.configure(); await core.cloudLogin({ email: 'synthetic@example.com', password: randomBytes(24).toString('base64url') })
  const saved = await client.saved(); saved.cloud.expiresAt = 0; f.rejectRefresh(); await core.renewCloudSession()
  assert.equal(views.at(-1), 'login'); assert.equal(await client.saved(), undefined); assert.equal(hostCalls.at(-1)[0], '/logout')
  assert.equal(f.records.get('draft:account-test'), 'Synthetic unsent draft')
  f.allowRefresh()
  await core.cloudLogin({ email: 'synthetic@example.com', password: randomBytes(24).toString('base64url') })
  assert.deepEqual(restored, ['Synthetic unsent draft']); assert.equal(f.records.has('draft:account-test'), false)
  const original = client.fetch;
  client.fetch = async (...args: any[]) => args[0].endsWith('/devices') ? response({ error: { code: 'UNAUTHORIZED' } }, 401) : original(...args);
  await assert.rejects(core.cloudDirectory()); assert.equal(views.at(-1), 'login'); assert.equal(await client.saved(), undefined)
})
test('rate limit deadline shows remaining seconds and invalid credentials never reveal account existence', async () => {
  const f = await fixture(), core: any = { state: {} }
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, {}, f.environment))
  assert.equal(core.cloudError({ code: 'INVALID_CREDENTIALS' }), '邮箱或密码不对，请重试。')
  core.state.cloudAuth.error = core.cloudError({ code: 'RATE_LIMITED', retryAfter: 91 })
  assert.match(core.cloudAuthView().error, /91 秒/); f.advance(1001); assert.equal(core.cloudAuthView().retrySeconds, 90)
  f.advance(90000); assert.equal(core.cloudAuthView().error, '等待已结束，可以重试。')
  assert.match(core.cloudError({ code: 'NETWORK' }), /重试/)
})
test('trusted-device delivery uses an external sender anchor and rejects another recipient, altered signature and expiry', async () => {
  const f = await fixture(), core: any = { state: {}, show: () => {}, load: () => {}, sessionExpired: () => {}, acceptSession: () => {},
    enterAssistant: async () => {}, refreshPendingDevices: async () => {} }
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, {}, f.environment))
  const client = core.initializeCloudAccount(); f.useClient(client); await client.configure(); await login(f)
  const key = await client.key(), host = await jose.generateKeyPair('ES256', { extractable: true }), anchor = await jose.exportJWK(host.publicKey)
  const jkt = await jose.calculateJwkThumbprint(key.publicJwk), pin = randomBytes(32).toString('base64url')
  const make = async (deviceId: string, expiry = '120s') => ({ hostId: 'host-test', publicJwk: anchor,
    trustToken: await new jose.SignJWT({ hostId: 'host-test', deviceId, jkt, tlsSpki: pin, publicJwk: anchor, origin: 'https://host.example.com' })
      .setProtectedHeader({ alg: 'ES256', typ: 'wm-host-trust+jwt' }).setIssuer('host-test').setSubject('account-test').setAudience(jkt)
      .setJti(randomBytes(16).toString('hex')).setIssuedAt(Math.floor(f.environment.now() / 1000))
      .setExpirationTime(Math.floor(f.environment.now() / 1000) + (expiry === '-1s' ? -1 : 120)).sign(host.privateKey) })
  await assert.rejects(core.cloudImportTrust(core.cloudTrustMaterial(await make('another-device'))), (error: any) => error.code === 'HOST_TRUST_INVALID')
  const expired = await make(key.deviceId, '-1s'); await assert.rejects(core.cloudImportTrust(core.cloudTrustMaterial(expired)))
  const wrongAnchor = await jose.generateKeyPair('ES256', { extractable: true }), valid = await make(key.deviceId)
  await assert.rejects(core.cloudImportTrust(core.cloudTrustMaterial({ ...valid, publicJwk: await jose.exportJWK(wrongAnchor.publicKey) })))
  await core.cloudImportTrust(core.cloudTrustMaterial(valid)); assert.equal(f.records.get('trusted-host:host-test').tlsSpki, pin)
})
test('packaged legal text matches docs and encrypted desktop key never exposes private material', () => {
  for (const kind of ['terms', 'privacy']) assert.equal(readFileSync(new URL(`../src/personal-access-ui/legal/${kind}-zh.md`, import.meta.url), 'utf8'), readFileSync(new URL(`../docs/legal/${kind}-zh.md`, import.meta.url), 'utf8'))
  const root = mkdtempSync(join(tmpdir(), 'weftmate-lg1-store-'))
  // A deterministic test encryption adapter exercises the bridge contract; real
  // Electron evidence verifies the OS safeStorage implementation.
  const encryption = { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(text).map(byte => byte ^ 0xa7), decryptString: (data: Buffer) => Buffer.from(data).map(byte => byte ^ 0xa7).toString() }
  try { const file = join(root, 'credentials.enc'), store = desktopAuthStorage(file, encryption), key = store.key('synthetic')
    assert.equal('privateJwk' in key, false); assert.equal(store.key('synthetic').deviceId, key.deviceId)
    store.credentials('test', { refreshToken: randomBytes(24).toString('base64url') }); assert.ok(existsSync(file)); assert.notEqual(readFileSync(file)[0], '{'.charCodeAt(0))
    store.credentials('test', undefined, true); assert.equal(store.credentials('test'), undefined)
    assert.ok(store.sign('synthetic', 'synthetic.proof'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('mobile cloud bootstrap with no-op effects does not read desktop installation state', async () => {
  const f = await fixture(); let view = '', reads = 0;
  const core: any = { state: {}, load() {}, clearSession() {}, sessionExpired() {},
    show(value: string) { view = value }, api: async () => { reads++; throw Error('No installation API on phone') } };
  const effects = new Proxy({}, { get: () => () => {} });
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, effects, f.environment));
  f.useClient(core.initializeCloudAccount()); await core.load();
  assert.equal(reads, 0); assert.equal(view, 'login');
});
