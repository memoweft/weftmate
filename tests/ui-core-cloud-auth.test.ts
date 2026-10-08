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
  const records = new Map<string, any>(), calls: any[] = [], timers: Array<() => unknown> = []
  const credentials = async (key: string, value?: any, remove = false) => { if (remove) records.delete(key); else if (value !== undefined) records.set(key, value); else return records.get(key) }
  const context: any = { WeftUiCore: { factories: {} }, btoa, atob, TextEncoder, TextDecoder, URL, URLSearchParams, AbortSignal,
    Uint8Array, setTimeout: (fn: () => unknown) => { timers.push(fn); return timers.length }, clearTimeout: () => {} }
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
  return { client, records, calls, timers, context, environment, credentials, advance: (ms: number) => { now += ms },
    nonce: (value: string) => { nonceOverride = value }, sub: (value: string) => { subOverride = value }, audience: (value: string) => { audienceOverride = value },
    callback: (value: string) => { callbackOverride = value }, rejectRefresh: () => { rejectRefresh = true }, allowRefresh: () => { rejectRefresh = false }, useClient: (value: any) => { client = value } }
}
const login = async (f: any) => f.client.begin({ email: 'synthetic@example.com', password: randomBytes(24).toString('base64url'), deviceName: 'Synthetic browser' })

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
  assert.equal(f.records.size, 1, 'only the key was persisted')
  assert.equal(core.cloudPasswordHint('short'), '至少 8 位'); assert.ok(paints.length)
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
})
test('rate limit deadline shows remaining seconds and invalid credentials never reveal account existence', async () => {
  const f = await fixture(), core: any = { state: {} }
  Object.assign(core, f.context.WeftUiCore.factories.cloudAccount(core, {}, f.environment))
  assert.equal(core.cloudError({ code: 'INVALID_CREDENTIALS' }), '邮箱或密码不对，请重试。')
  assert.match(core.cloudError({ code: 'RATE_LIMITED', retryAfter: 91 }), /91 秒/); f.advance(1001); assert.equal(core.cloudAuthView().retrySeconds, 90)
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
