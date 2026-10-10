import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { generateKeyPair, exportJWK, SignJWT, calculateJwkThumbprint } from 'jose'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { hash } from '../src/personal-cloud/proofs.mjs'
import { createPersonalSyncStore } from '../src/personal-sync/index.mjs'
import { trackNativeFiles, appendNativeArtifacts } from '../src/plugins/personal-native-files.mjs'

const P = '/personal/v1'
const PASSWORD = 'synthetic local account password'
async function fixture(t: any, { fresh = false } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-host-cloud-')))
  const signing = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(signing.publicKey), kid: 'test-cloud-key', alg: 'RS256', use: 'sig' }
  const claims = new Map<string, any>()
  let interrupted = false
  let revocationResponse: (() => Promise<{ events: any[], watermark: number, status?: number }>) | undefined
  let cloudOrigin: string, issuer: string, cloudBase: string
  const cloud = createServer(async (req, res) => {
    if (req.url?.endsWith('/jwks')) { res.end(JSON.stringify({ keys: [jwk] })); return }
    const parts = []
    for await (const c of req) parts.push(c)
    const body = JSON.parse(Buffer.concat(parts).toString())
    if (req.url?.endsWith('/hosts/claims')) {
      if (!claims.has(body.claimId)) claims.set(body.claimId, { ...body, challenge: randomUUID() })
      res.end(JSON.stringify(claims.get(body.claimId))); return
    }
    if (req.url?.endsWith('/confirm')) {
      claims.get(body.claimId).confirmed = true
      if (interrupted) { interrupted = false; res.writeHead(503); res.end('{}'); return }
      res.end('{"confirmed":true}'); return
    }
    if (req.url?.endsWith('/hosts/revocations')) {
      const response = revocationResponse ? await revocationResponse() : { events: [], watermark: 0 };
      if (response.status && response.status >= 400) { res.writeHead(response.status); res.end('{}'); return }
      const eventToken = await new SignJWT({ events: response.events, watermark: response.watermark })
        .setProtectedHeader({ alg: 'RS256', typ: 'wm-cloud-revocations+jwt', kid: jwk.kid })
        .setIssuer(issuer).setAudience(`${cloudBase}/hosts/${hostId}`).setIssuedAt().setExpirationTime('300s').sign(signing.privateKey)
      res.end(JSON.stringify({ eventToken })); return
    }
    res.end('{}')
  })
  await new Promise<void>(resolve => cloud.listen(0, '127.0.0.1', resolve))
  cloudOrigin = `http://127.0.0.1:${(cloud.address() as any).port}`
  cloudBase = `${cloudOrigin}${P}/cloud`; issuer = `${cloudBase}/oidc`
  const backend = { getStatus: async () => ({ runtime: 'ready' }),
    listModels: async () => [{ id: 'synthetic', model: 'synthetic', name: 'Synthetic cloud', configured: true, sourceKind: 'cloud' }],
    preflight: async () => ({ ok: true }), createSession: async ({ sessionId }: any) => ({ sessionId }), sendMessage: async () => ({}),
    openDesktopApp: async () => ({}), cancelSession: async () => ({}), readEvents: async ({ afterSeq }: any) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async (sessionId: string) => ({ sessionId, title: 'synthetic', running: false }),
    modelCompletion: async ({ signal }: any) => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'))
      signal.addEventListener('abort', () => controller.error(new Error('revoked')), { once: true })
    } }), { headers: { 'content-type': 'text/event-stream' } }) }
  let service: any, origin: string, hostId: string, timeOffset = 0
  const requests = async (method: string, route: string, body?: any, auth?: any, headers: any = {}) => {
    const response = await fetch(`${origin}${P}${route}`, { method, headers: {
      ...(body !== undefined ? { origin, 'content-type': 'application/json' } : {}),
      ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const value = await response.json()
    return { ...value, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  async function start(enabled = true) {
    service = await createPersonalAccessService({ root, port: 0, backend, clock: () => Date.now() + timeOffset,
      cloudIdentity: enabled ? { issuer, allowInsecureLoopback: true } : null })
    const started = await service.start(); origin = started.origin; hostId = started.hostId
  }
  t.after(async () => {
    await service?.close()
    if (cloud.listening) await new Promise<void>(resolve => { cloud.close(resolve); cloud.closeAllConnections() })
    await rm(root, { recursive: true, force: true })
  })
  let a: any, b: any, oldStore = '', oldSync = '';
  if (!fresh) {
  await start(false)
  a = await requests('POST', '/auth/setup', { grant: (await service.issueSetupGrant()).grant, username: 'account-a', password: PASSWORD, deviceName: 'Computer A' })
  b = await requests('POST', '/auth/register', { username: 'account-b', password: PASSWORD, deviceName: 'Computer B' })
  assert.equal(a.status, 201, JSON.stringify(a))
  assert.equal(b.status, 201, JSON.stringify(b))
  await service.close()
  const sync = await createPersonalSyncStore({ root: join(root, 'sync'), ownerId: a.account.ownerId })
  await sync.append({ sourceDeviceId: a.device.id, events: [{ eventId: randomUUID(), conversationId: randomUUID(),
    clientSeq: 1, kind: 'conversation.created', occurredAt: new Date().toISOString(), payload: { title: 'Private synthetic conversation' } }] })
  await sync.close()
  await mkdir(join(root, 'accounts', a.account.ownerId, 'health'), { recursive: true })
  await writeFile(join(root, 'accounts', a.account.ownerId, 'health', 'synthetic.txt'), 'health fixture')
  await mkdir(join(root, 'memory-fixture'))
  await writeFile(join(root, 'memory-fixture', 'evidence'), 'private synthetic memory')
  oldStore = await readFile(join(root, 'store.json'), 'utf8')
  oldSync = await readFile(join(root, 'sync', 'events.json'), 'utf8')
  }
  await start()
  async function access(sub: string, device: string, key: any, overrides: any = {}, audience?: string) {
    return new SignJWT({ sub, device_id: device, auth_epoch: 0, host_id: hostId, scope: 'host:session',
      cnf: { jkt: await calculateJwkThumbprint(await exportJWK(key.publicKey)) }, ...overrides })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: jwk.kid }).setIssuer(issuer)
      .setAudience(audience ?? `${cloudBase}/hosts/${hostId}`).setIssuedAt().setJti(randomUUID())
      .setExpirationTime(overrides.exp ?? '300s').sign(signing.privateKey)
  }
  async function control(sub = 'cloud-a', epoch = 0) {
    return new SignJWT({ sub, device_id: 'test-control', auth_epoch: epoch, scope: 'cloud:account' })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: jwk.kid }).setIssuer(issuer)
      .setAudience(cloudBase).setIssuedAt().setJti(randomUUID()).setExpirationTime('300s').sign(signing.privateKey)
  }
  async function bind(auth = a, sub = 'cloud-a', epoch = 0) {
    const claim = await requests('POST', '/cloud/claims', {}, auth)
    assert.equal(claim.status, 200)
    const result = await requests('POST', '/cloud/binding', { claimId: claim.claimId, accessToken: await control(sub, epoch) }, auth)
    return { claim, result }
  }
  async function exchange(token: string, key: any, route = '/auth/cloud-session', extra: any = {}, proofOverrides: any = {}, cookieAuth: any = undefined) {
    const nonce = await requests('POST', '/auth/cloud-nonce', {})
    const proof = await new SignJWT({ htm: 'POST', htu: `${origin}${P}${route}`, ath: hash(token), nonce: nonce.nonce,
      ...proofOverrides }).setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: await exportJWK(key.publicKey) })
      .setIssuedAt(Math.floor((Date.now() + timeOffset) / 1000)).setJti(proofOverrides.jti ?? randomUUID()).sign(key.privateKey)
    return { result: await requests('POST', route, { accessToken: token, deviceName: 'New browser', ...extra }, cookieAuth, { dpop: proof }), proof }
  }
  return { root, a, b, oldStore, oldSync, requests, access, control, bind, exchange, issuer, backend,
    stream: async (auth: any) => {
      const response = await fetch(`${origin}${P}/models/synthetic/chat/completions`, { method: 'POST',
        headers: { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'synthetic', messages: [{ role: 'user', content: 'synthetic' }], stream: true }) })
      assert.equal(response.status, 200)
      const reader = response.body!.getReader()
      await reader.read()
      return reader
    },
    get origin() { return origin }, get hostId() { return hostId }, get service() { return service },
    interrupt: () => { interrupted = true }, claims,
    onRevocations: (handler: typeof revocationResponse) => { revocationResponse = handler },
    advance: (ms: number) => { timeOffset += ms },
    restart: async () => { await service.close(); await start() },
    offline: async () => { await new Promise<void>(resolve => { cloud.close(resolve); cloud.closeAllConnections() }) },
    event: async (events: any[], watermark: number) => new SignJWT({ events, watermark })
      .setProtectedHeader({ alg: 'RS256', typ: 'wm-cloud-revocations+jwt', kid: jwk.kid })
      .setIssuer(issuer).setAudience(`${cloudBase}/hosts/${hostId}`).setIssuedAt().setExpirationTime('300s').sign(signing.privateKey),
  }
}

test('BK-1 portable cloud ownership reconnects only after verified subject and fresh desktop claim', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'backup-cloud-owners.json'), JSON.stringify([{ issuer: f.issuer, sub: 'restored-cloud', ownerId: f.a.account.ownerId }]));
  await f.restart();
  const key = await generateKeyPair('ES256');
  const token = await f.access('restored-cloud', 'new-desktop', key, { scope: 'cloud:account' }, f.issuer.slice(0, -5));
  const result = (await f.exchange(token, key, '/auth/cloud-desktop')).result;
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.account.ownerId, f.a.account.ownerId);
  assert.ok(f.claims.size > 0, 'new installation claim is verified instead of importing private keys');
  const strangerKey = await generateKeyPair('ES256');
  const stranger = await f.access('other-cloud', 'other-desktop', strangerKey, { scope: 'cloud:account' }, f.issuer.slice(0, -5));
  const other = (await f.exchange(stranger, strangerKey, '/auth/cloud-desktop')).result;
  assert.notEqual(other.account?.ownerId, f.a.account.ownerId);
});

test('claim interruption resumes the same claimId after restart; backup and all existing identifiers/passwords/cookies/sync/data remain intact', async t => {
  const f = await fixture(t)
  const assertBusinessStore = async () => {
    const current = JSON.parse(await readFile(join(f.root, 'store.json'), 'utf8')), before = JSON.parse(f.oldStore)
    // Activity is an independent observation of the restart, never a cloud claim mutation.
    for (const [ownerId, account] of Object.entries(current.accounts) as [string, any][]) {
      assert.equal(account.activity.secret, before.accounts[ownerId].activity.secret)
      assert.ok(Object.values(account.activity.items).every((row: any) => row.type === 'system.reconnected' && row.notification.level === 'silent'))
      delete account.activity; delete before.accounts[ownerId].activity
    }
    assert.deepEqual(current, before)
  }
  assert.equal(await readFile(join(f.root, 'cloud-identity', 'backup', 'store.json'), 'utf8'), f.oldStore)
  await assertBusinessStore()
  f.interrupt()
  const first = await f.bind()
  assert.equal(first.result.status, 503)
  assert.equal(f.claims.get(first.claim.claimId).confirmed, true)
  await f.restart()
  const next = await f.bind()
  assert.equal(next.claim.claimId, first.claim.claimId)
  assert.equal(next.result.status, 200)
  assert.equal((await f.bind()).claim.claimId, first.claim.claimId)
  await assertBusinessStore()
  assert.equal(await readFile(join(f.root, 'sync', 'events.json'), 'utf8'), f.oldSync)
  assert.equal(JSON.parse(f.oldSync).lastSeq, 1)
  assert.equal(await readFile(join(f.root, 'memory-fixture', 'evidence'), 'utf8'), 'private synthetic memory')
  assert.equal((await f.requests('GET', '/auth/me', undefined, f.a)).account.ownerId, f.a.account.ownerId)
  assert.equal((await f.requests('GET', '/auth/me', undefined, f.b)).status, 200)
})

test('binding requires local Cookie/CSRF; unknown subjects cannot select an owner or take over another local account', async t => {
  const f = await fixture(t)
  assert.equal((await f.requests('POST', '/cloud/claims', {})).status, 401)
  assert.equal((await f.requests('POST', '/cloud/claims', {}, { ...f.a, csrfToken: 'wrong' })).status, 403)
  const { claim } = await f.bind()
  assert.equal((await f.requests('POST', '/cloud/binding', { claimId: claim.claimId, accessToken: await f.control('stranger'), ownerId: f.a.account.ownerId }, f.a)).status, 400)
  assert.equal((await f.requests('POST', '/cloud/binding', { claimId: claim.claimId, accessToken: await f.control('stranger') }, f.a)).status, 409)
  assert.equal((await f.bind(f.b, 'cloud-a')).result.status, 409)
  const key = await generateKeyPair('ES256')
  assert.equal((await f.exchange(await f.access('stranger', 'unknown', key), key)).result.status, 403)
})

test('desktop login cannot bootstrap a key into a partially committed legacy binding', async t => {
  const f = await fixture(t)
  f.interrupt()
  assert.equal((await f.bind()).result.status, 503)
  const key = await generateKeyPair('ES256')
  const token = await f.access('cloud-a', 'desktop', key, { scope: 'cloud:account' }, f.issuer.slice(0, -5))
  const pending = (await f.exchange(token, key, '/auth/cloud-desktop')).result
  assert.equal(pending.status, 202)
  assert.equal(pending.cookie, undefined)
  assert.equal((await f.requests('POST', `/cloud/devices/${pending.requestId}/decision`, { decision: 'allow' }, f.a)).status, 200)
  assert.equal((await f.bind()).result.status, 200)
  const trusted = (await f.exchange(token, key, '/auth/cloud-desktop')).result
  assert.equal(trusted.status, 200)
  assert.equal(trusted.account.ownerId, f.a.account.ownerId)
  assert.equal((await f.requests('GET', '/auth/me', undefined, f.b)).account.ownerId, f.b.account.ownerId)
})

test('two local accounts bind independently; pending devices cannot see content; only their own account can approve; deny is durable', { timeout: 60_000 }, async t => {
  const f = await fixture(t)
  assert.equal((await f.bind()).result.status, 200)
  assert.equal((await f.bind(f.b, 'cloud-b', 1)).result.status, 200)
  const key = await generateKeyPair('ES256'), other = await generateKeyPair('ES256')
  const token = await f.access('cloud-a', 'phone-a', key)
  const pending = (await f.exchange(token, key)).result
  assert.equal(pending.status, 202); assert.equal(pending.cookie, undefined)
  assert.equal((await f.requests('GET', '/sessions', undefined, undefined, { authorization: `Bearer ${token}` })).status, 401)
  assert.equal((await f.requests('GET', '/cloud/devices/pending', undefined, f.a)).devices.length, 1)
  assert.equal((await f.requests('GET', '/cloud/devices/pending', undefined, f.b)).devices.length, 0)
  assert.equal((await f.requests('POST', `/cloud/devices/${pending.requestId}/decision`, { decision: 'allow' }, f.b)).status, 404)
  assert.equal((await f.requests('POST', `/cloud/devices/${pending.requestId}/decision`, { decision: 'allow' }, f.a)).status, 200)
  const session = (await f.exchange(token, key)).result
  assert.equal(session.status, 200); assert.equal(session.account.ownerId, f.a.account.ownerId)
  assert.equal((await f.requests('GET', '/sessions', undefined, session)).status, 200)
  const aSync = await f.requests('GET', '/sync/events?afterSeq=0', undefined, session)
  assert.equal(aSync.status, 200)
  assert.equal(aSync.events.length, 1)
  assert.equal((await f.requests('GET', '/sync/events?afterSeq=0', undefined, f.b)).events.length, 0)
  assert.equal((await f.requests('POST', '/cloud/claims', {}, session)).status, 403)
  const created = await f.requests('POST', '/commands', { requestId: randomUUID(), kind: 'session.create',
    targetDeviceId: f.hostId, modelProfileId: 'synthetic' }, session)
  assert.equal(created.status, 202, JSON.stringify(created))
  // A Windows durable commit includes ACL verification. The HTTP operation
  // state is the completion boundary; 500 ms of disk polling is not one.
  let operation: any
  do {
    if (t.signal.aborted) throw t.signal.reason
    operation = await f.requests('GET', `/commands/${created.command.commandId}`, undefined, session)
    assert.equal(operation.status, 200)
  } while (['pending', 'dispatching'].includes(operation.command.state))
  assert.equal(operation.command.state, 'accepted_by_dsh', JSON.stringify(operation.command))
  const stored = JSON.parse(await readFile(join(f.root, 'store.json'), 'utf8'))
  assert.equal(stored.accounts[f.a.account.ownerId].sessions[created.command.sessionId].origin, 'personal-remote')
  assert.equal(stored.accounts[f.a.account.ownerId].commands[created.command.commandId].sourceAuthEpoch,
    stored.accounts[f.a.account.ownerId].account.authEpoch)

  assert.equal((await f.exchange(await f.access('cloud-b', 'phone-b', other), other)).result.status, 401, 'fresh binding checkpoints cloud epoch before the next revocation poll')
  const deniedToken = await f.access('cloud-b', 'phone-b', other, { auth_epoch: 1 })
  const denied = (await f.exchange(deniedToken, other)).result
  assert.equal((await f.requests('POST', `/cloud/devices/${denied.requestId}/decision`, { decision: 'deny' }, f.b)).status, 200)
  await f.restart()
  assert.equal((await f.exchange(deniedToken, other)).result.status, 403)
  assert.equal((await f.requests('GET', '/auth/me', undefined, session)).status, 200)
})

test('JWT signature/audience/algorithm/expiry/type and DPoP possession/method/URL/nonce/hash/replay are checked', async t => {
  const f = await fixture(t); await f.bind()
  const key = await generateKeyPair('ES256'), wrong = await generateKeyPair('ES256')
  const token = await f.access('cloud-a', 'phone-a', key)
  for (const invalid of [token.slice(0, -8) + 'invalidx', await f.access('cloud-a', 'phone-a', key, {}, 'wrong-audience'),
    await f.access('cloud-a', 'phone-a', key, { exp: Math.floor(Date.now() / 1000) - 10 })]) {
    assert.equal((await f.exchange(invalid, key)).result.status, 401)
  }
  const fake = await new SignJWT({ sub: 'cloud-a' }).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
    .sign(new TextEncoder().encode('synthetic secret with enough entropy 0000'))
  assert.equal((await f.exchange(fake, key)).result.status, 401)
  assert.equal((await f.exchange(await f.control(), key)).result.status, 401)
  assert.equal((await f.requests('POST', '/auth/cloud-session', { accessToken: token, deviceName: 'No key' })).status, 401)
  assert.equal((await f.requests('POST', '/auth/cloud-session', { accessToken: token, deviceName: 'Cookie alone' }, f.a)).error.code, 'DPOP_INVALID')
  assert.equal((await f.exchange(token, wrong)).result.status, 401)
  for (const override of [{ htm: 'GET' }, { htu: 'https://other.example.com/' }, { nonce: 'unknown' }, { ath: 'wrong' }])
    assert.equal((await f.exchange(token, key, '/auth/cloud-session', {}, override)).result.status, 401)
  const good = await f.exchange(token, key)
  assert.equal(good.result.status, 202)
  assert.equal((await f.requests('POST', '/auth/cloud-session', { accessToken: token, deviceName: 'Repeat' }, undefined, { dpop: good.proof })).status, 401)
  await f.restart()
  assert.equal((await f.requests('POST', '/auth/cloud-session', { accessToken: token, deviceName: 'Repeat' }, undefined, { dpop: good.proof })).status, 401)
})

test('pairing is local, owner-scoped, expires and consumes once; unlink preserves local login and all stored data', async t => {
  const f = await fixture(t); await f.bind(); await f.bind(f.b, 'cloud-b')
  const key = await generateKeyPair('ES256')
  const pairing = await f.requests('POST', '/cloud/pairings', {}, f.a)
  assert.equal(pairing.status, 201); assert.ok(pairing.tlsSpki); assert.ok(pairing.publicJwk)
  const bToken = await f.access('cloud-b', 'phone', key)
  assert.equal((await f.exchange(bToken, key, '/cloud/pairings/redeem', { challenge: pairing.challenge })).result.status, 401)
  const token = await f.access('cloud-a', 'phone', key)
  const session = (await f.exchange(token, key, '/cloud/pairings/redeem', { challenge: pairing.challenge })).result
  assert.equal(session.status, 200)
  assert.equal((await f.exchange(token, key, '/cloud/pairings/redeem', { challenge: pairing.challenge })).result.status, 401)
  const expiredPair = await f.requests('POST', '/cloud/pairings', {}, f.a)
  f.advance(121_000)
  const expired = (await f.exchange(token, key, '/cloud/pairings/redeem', { challenge: expiredPair.challenge })).result
  assert.equal(expired.error.code, 'PAIRING_INVALID')
  assert.equal((await f.requests('DELETE', '/cloud/binding', {}, f.a)).status, 200)
  assert.equal((await f.requests('GET', '/sessions', undefined, session)).status, 401)
  assert.equal((await f.requests('GET', '/auth/me', undefined, f.a)).status, 200)
  const stored = JSON.parse(await readFile(join(f.root, 'store.json'), 'utf8')), old = JSON.parse(f.oldStore)
  for (const ownerId of Object.keys(old.accounts)) assert.deepEqual(stored.accounts[ownerId].account, old.accounts[ownerId].account)
})

test('local device revoke closes active responses; signed cloud epoch/device revocation rejects cloud sessions without affecting local sessions', async t => {
  const f = await fixture(t); await f.bind()
  const key = await generateKeyPair('ES256')
  const token = await f.access('cloud-a', 'phone', key)
  const pending = (await f.exchange(token, key)).result
  await f.requests('POST', `/cloud/devices/${pending.requestId}/decision`, { decision: 'allow' }, f.a)
  const session = (await f.exchange(token, key)).result
  const localStream = await f.stream(session)
  const localClosed = assert.rejects(localStream.read())
  const response = await f.requests('DELETE', `/auth/devices/${session.device.id}`, {}, f.a)
  assert.equal(response.status, 200)
  await localClosed
  assert.equal((await f.requests('GET', '/usage', undefined, f.a)).total.unknownRequests, 1,
    'revoked stream without provider usage remains an unknown request')
  assert.equal((await f.requests('GET', '/sessions', undefined, session)).status, 401)
  assert.equal((await f.exchange(token, key)).result.status, 403)
  const fresh = await generateKeyPair('ES256'), freshToken = await f.access('cloud-a', 'second-phone', fresh)
  const pair = await f.requests('POST', '/cloud/pairings', {}, f.a)
  const second = (await f.exchange(freshToken, fresh, '/cloud/pairings/redeem', { challenge: pair.challenge })).result
  const epochStream = await f.stream(second)
  const epochClosed = assert.rejects(epochStream.read())
  await assert.rejects(f.service.receiveCloudRevocations('forged'), /CLOUD_TOKEN_INVALID/)
  await f.service.receiveCloudRevocations(await f.event([{ seq: 1, kind: 'epoch', sub: 'cloud-a', epoch: 1 }], 1))
  await epochClosed
  assert.equal((await f.requests('GET', '/usage', undefined, f.a)).total.unknownRequests, 2)
  assert.equal((await f.requests('GET', '/sessions', undefined, second)).status, 401)
  assert.equal((await f.requests('GET', '/auth/me', undefined, f.a)).status, 200)
  assert.equal((await f.requests('GET', '/auth/me', undefined, f.b)).status, 200)
  const refreshed = (await f.exchange(await f.access('cloud-a', 'second-phone', fresh, { auth_epoch: 1 }), fresh,
    '/auth/cloud-session', {}, {}, second)).result
  assert.equal(refreshed.status, 200, 'epoch update preserves the existing approved device key')
  assert.notEqual(refreshed.cookie, second.cookie, 'revoked HttpOnly Cookie does not prevent browser sign-in')
  await f.offline()
  const login = await f.requests('POST', '/auth/login', { username: 'account-a', password: PASSWORD, deviceName: 'Offline computer' })
  assert.equal(login.status, 200)
})


async function assertFreshOverlappingRevocation(t: any, oldStatus = 200) {
  const f = await fixture(t);
  await f.bind();
  const key = await generateKeyPair('ES256'), token = await f.access('cloud-a', 'phone', key);
  const pending = (await f.exchange(token, key)).result;
  await f.requests('POST', `/cloud/devices/${pending.requestId}/decision`, { decision: 'allow' }, f.a);
  const session = (await f.exchange(token, key)).result;
  assert.equal(session.status, 200);
  await f.service.syncCloudRevocations();
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve });
  const released = new Promise<void>(resolve => { release = resolve });
  f.onRevocations(async () => {
    if (++calls === 1) { entered(); await released; return { events: [], watermark: 0, status: oldStatus }; }
    return { events: [{ seq: 1, kind: 'epoch', sub: 'cloud-a', epoch: 1 }], watermark: 1 };
  });
  const older = f.service.syncCloudRevocations();
  const priorResult = older.then(() => null, (error: any) => error);
  await started;
  const newer = f.service.syncCloudRevocations();
  release();
  const [priorError] = await Promise.all([priorResult, newer]);
  if (oldStatus >= 400) assert.equal(priorError.code, 'CLOUD_UNAVAILABLE');
  else assert.equal(priorError, null);
  assert.equal(calls, 2);
  assert.equal((await f.requests('GET', '/sessions', undefined, session)).status, 401);
  assert.equal((await f.requests('GET', '/auth/me', undefined, f.a)).status, 200);
}

test('a revocation sync requested during an older response fetches the new epoch before returning', { timeout: 30_000 }, t => assertFreshOverlappingRevocation(t));
test('a new revocation sync reads fresh membership even if the older sync failed', { timeout: 30_000 }, t => assertFreshOverlappingRevocation(t, 503));

test('cloud initialization backs up legacy v1 before existing migration and preserves old host/owner IDs and legal Bearer access', async t => {
  const f = await fixture(t)
  const root = join(f.root, 'legacy-fixture')
  await mkdir(root)
  const token = 'synthetic-legacy-device-token'
  const old = { version: 1, ownerId: 'owner-legacy-synthetic', hostId: 'host-legacy-synthetic',
    devices: { 'device-legacy-synthetic': { name: 'Old device', tokenHash: createHash('sha256').update(token).digest('hex'),
      scopes: ['sessions:read', 'commands:write'], revoked: false, enrolledAt: new Date().toISOString() } },
    sessions: {}, commands: {} }
  await writeFile(join(root, 'store.json'), JSON.stringify(old))
  const host = await createPersonalAccessService({ root, port: 0, backend: f.backend,
    cloudIdentity: { issuer: f.issuer, allowInsecureLoopback: true } })
  try {
    const started = await host.start()
    assert.equal(started.hostId, old.hostId)
    assert.equal(started.ownerId, old.ownerId)
    const response = await fetch(`${started.origin}/personal/v1/sessions`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(response.status, 200)
    const claim = await fetch(`${started.origin}/personal/v1/cloud/claims`, { method: 'POST',
      headers: { origin: started.origin, 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' })
    assert.equal(claim.status, 403, 'legacy Bearer cannot approve a binding instead of local setup')
    assert.deepEqual(JSON.parse(await readFile(join(root, 'cloud-identity', 'backup', 'store.json'), 'utf8')), old)
    const migrated = JSON.parse(await readFile(join(root, 'store.json'), 'utf8'))
    assert.equal(migrated.version, 3)
    assert.equal(migrated.accounts[old.ownerId].devices['device-legacy-synthetic'].tokenHash, old.devices['device-legacy-synthetic'].tokenHash)
  } finally { await host.close() }
})

async function createdCloudSession(f: any, auth: any) {
  const sent = await f.requests('POST', '/commands', {requestId: randomUUID(), kind: 'session.create',
    targetDeviceId: f.hostId, modelProfileId: 'synthetic'}, auth);
  assert.equal(sent.status, 202, JSON.stringify(sent));
  for (let i = 0; i < 100; i++) {
    const found = await f.requests('GET', '/commands/' + sent.command.commandId, undefined, auth);
    if (found.command.state === 'accepted_by_dsh') return found.command.sessionId;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('session was not accepted');
}

test('FX-9 first cloud desktop on a fresh host becomes the durable execution account; a second identity stays isolated', async t => {
  const f = await fixture(t, {fresh: true});
  const legacy = f.service.legacyOwnerId();
  const key = await generateKeyPair('ES256');
  const token = await f.access('first-cloud', 'desktop-first', key, {scope: 'cloud:account'}, f.issuer.slice(0, -5));
  const first = (await f.exchange(token, key, '/auth/cloud-desktop')).result;
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.notEqual(first.account.ownerId, legacy);
  assert.equal(f.service.executionOwnerId(), first.account.ownerId);
  const sessionId = await createdCloudSession(f, first);
  assert.equal((await f.requests('PATCH', '/sessions/' + sessionId + '/approval-mode', {mode: 'ask'}, first)).status, 200);
  assert.equal((await f.requests('GET', '/sessions/' + sessionId + '/approval-mode', undefined, first)).mode, 'ask');
  await f.restart();
  assert.equal(f.service.executionOwnerId(), first.account.ownerId);
  assert.equal(f.service.legacyOwnerId(), legacy, 'legacy storage paths are preserved');
  const again = (await f.exchange(token, key, '/auth/cloud-desktop')).result;
  assert.equal(again.account.ownerId, first.account.ownerId);
  const otherKey = await generateKeyPair('ES256');
  const otherToken = await f.access('second-cloud', 'desktop-second', otherKey, {scope: 'cloud:account'}, f.issuer.slice(0, -5));
  const second = (await f.exchange(otherToken, otherKey, '/auth/cloud-desktop')).result;
  assert.equal(second.status, 200, JSON.stringify(second));
  assert.notEqual(second.account.ownerId, first.account.ownerId);
  assert.equal(f.service.executionOwnerId(), first.account.ownerId);
  assert.equal((await f.requests('GET', '/sessions/' + sessionId + '/events', undefined, second)).status, 404);
  assert.equal((await f.requests('GET', '/status', undefined, second)).backend.capabilities.naturalLanguageDesktop.available, false);
  assert.equal((await f.requests('POST', '/commands', {requestId:randomUUID(),kind:'desktop.open_app',targetDeviceId:f.hostId,appId:'notepad'},second)).status,403);
  const stored = JSON.parse(await readFile(join(f.root, 'store.json'), 'utf8'));
  assert.equal(stored.accounts[first.account.ownerId].sessions[sessionId].origin, 'personal-remote');
  assert.deepEqual(stored.accounts[second.account.ownerId].sessions, {});
});

test('FX-9 legacy account binding retains execution and data; another desktop identity cannot claim it', async t => {
  const f = await fixture(t);
  const owner = f.a.account.ownerId;
  assert.equal(f.service.executionOwnerId(), owner);
  assert.equal((await f.bind()).result.status, 200);
  const sessionId = await createdCloudSession(f, f.a);
  assert.equal((await f.requests('PATCH', '/sessions/' + sessionId + '/approval-mode', {mode:'ask'}, f.a)).status, 200);
  const key = await generateKeyPair('ES256');
  const token = await f.access('different-cloud', 'second-desktop', key, {scope:'cloud:account'}, f.issuer.slice(0,-5));
  const second = (await f.exchange(token,key,'/auth/cloud-desktop')).result;
  assert.equal(second.status,200);
  assert.notEqual(second.account.ownerId, owner);
  assert.equal(f.service.executionOwnerId(), owner);
  assert.equal(await readFile(join(f.root,'sync','events.json'),'utf8'), f.oldSync);
  await f.restart();
  assert.equal(f.service.executionOwnerId(), owner);
});

for (const scenario of ['ordinary', 'project', 'phone'] as const) {
  // The current project-folder reader is a Windows native capability, like the
  // existing project service tests; ordinary/phone source receipts are portable.
  test(`FX-11 first native write registers a cloud owner's artifact in ${scenario} conversation`,
    {skip:scenario === 'project' && process.platform !== 'win32', timeout: 60_000}, async t => {
    const f = await fixture(t, { fresh: true })
    const key = await generateKeyPair('ES256')
    const token = await f.access('fx11-owner', 'fx11-desktop', key, {scope:'cloud:account'}, f.issuer.slice(0,-5))
    const desktop = (await f.exchange(token, key, '/auth/cloud-desktop')).result
    assert.equal(desktop.status, 200)
    let caller = desktop
    if (scenario === 'phone') {
      const phoneKey = await generateKeyPair('ES256')
      const phoneToken = await f.access('fx11-owner', 'fx11-phone', phoneKey)
      const pending = (await f.exchange(phoneToken, phoneKey)).result
      assert.equal(pending.status, 202)
      assert.equal((await f.requests('POST', `/cloud/devices/${pending.requestId}/decision`, {decision:'allow'}, desktop)).status, 200)
      caller = (await f.exchange(phoneToken, phoneKey)).result
      assert.equal(caller.status, 200)
      assert.notEqual(caller.device.id, desktop.device.id)
    }
    f.backend.describeSession = async sessionId => ({sessionId, title:'FX-11', running:true, agentPreset:'personal-remote', modelProfileId:'synthetic'} as any)
    f.backend.sendMessage = async () => ({accepted:true, receiptId:randomUUID()} as any)
    const workspace = join(f.root, 'first-write-workspace')
    await mkdir(workspace)
    let created: any
    if (scenario === 'project') {
      const project = await f.requests('POST', '/projects', {requestId:randomUUID(), name:'合成项目', rootPath:workspace, permission:'write'}, desktop)
      assert.equal(project.status, 201, JSON.stringify(project))
      created = await f.requests('POST', `/projects/${project.project.projectId}/sessions`, {requestId:randomUUID(), modelProfileId:'synthetic'}, desktop)
    } else {
      created = await f.requests('POST', '/commands', {requestId:randomUUID(), kind:'session.create', targetDeviceId:f.hostId, modelProfileId:'synthetic'}, desktop)
    }
    assert.equal(created.status, 202, JSON.stringify(created))
    const settled = async (id: string) => {
      // Cold Windows ACL/project setup is real I/O, not a one-second promise.
      // Wait for the authoritative receipt; the test's signal bounds the wait.
      while (!t.signal.aborted) {
        const result = await f.requests('GET', `/commands/${id}`, undefined, caller)
        if (result.command.state === 'accepted_by_dsh') return result.command
        assert.ok(['pending','dispatching'].includes(result.command.state), JSON.stringify(result))
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw Error('synthetic command not accepted')
    }
    const sessionId = (await settled(created.command.commandId)).sessionId
    const text = '直接创建 first.txt，内容 FX11_FIRST_WRITE'
    const sent = await f.requests('POST', '/commands', {requestId:randomUUID(),kind:'session.message',targetDeviceId:f.hostId,sessionId,text}, caller)
    assert.equal(sent.status, 202)
    const source = await settled(sent.command.commandId)
    const identity = {sessionId, turn:1, callId:'first-write', rootCallId:'first-write', receiptId:source.receiptId,
      messageHash:createHash('sha256').update(text).digest('hex')}
    const exec = {name:'write', arguments:{file_path:'first.txt'}, agent:{session:{header:{agentPreset:'personal-remote',cwd:workspace}}}}
    const native = {isError:false,content:[{type:'text',text:'Created file'}]}
    const frames: any[] = []
    const bridge = {request: async frame => {
      frames.push(frame)
      const {action, ...payload} = frame
      assert.equal(action, 'register_file')
      return f.service.registerNativeFile(payload)
    }}
    const result = await trackNativeFiles(bridge, exec, async () => {
      const grant = await f.service.trackToolExecution({...identity,action:'authorize_execution',toolName:'write',argumentsHash:createHash('sha256').update('first write arguments').digest('hex')})
      await writeFile(join(workspace,'first.txt'),'FX11_FIRST_WRITE')
      await f.service.trackToolExecution({...identity,action:'finish_execution',toolName:'write',argumentsHash:createHash('sha256').update('first write arguments').digest('hex'),executionId:grant.executionId,state:'completed',resultHash:createHash('sha256').update('created').digest('hex')})
      return native
    }, () => identity)
    assert.equal(result,native)
    const post = await appendNativeArtifacts(exec,result,async()=>({kind:'accept'}))
    const artifact = JSON.parse(post.content.find(part=>part.text.startsWith('{')).text).artifact
    assert.equal(artifact.state,'observed')
    assert.equal(artifact.taskId,source.commandId)
    assert.equal(frames.length,1)
    assert.equal(await readFile(join(workspace,'first.txt'),'utf8'),'FX11_FIRST_WRITE')
    const detail = await f.requests('GET', `/tasks/${source.commandId}`, undefined, caller)
    assert.equal(detail.status,200)
    assert.equal(detail.executionSteps[0].state,'completed')
    const stored = JSON.parse(await readFile(join(f.root,'store.json'),'utf8'))
    const account = stored.accounts[desktop.account.ownerId]
    assert.equal(account.devices[account.commands[source.commandId].sourceDeviceId].authKind,'cloud')
    const saved: any = Object.values(account.commands).find((row:any)=>row.artifactId===artifact.artifactId)
    assert.equal(saved.toolSource.sourceCommandId,source.commandId)
    assert.equal(saved.nativeFileObserved,true)
    assert.equal(saved.verification.method,'sha256_readback')
    assert.deepEqual(stored.accounts[stored.legacyOwnerId].commands,{})
    await assert.rejects(f.service.registerNativeFile({...identity,receiptId:'foreign-receipt',filePath:join(workspace,'first.txt'),sha256:createHash('sha256').update('FX11_FIRST_WRITE').digest('hex')}), (error:any)=>error.code==='TOOL_SOURCE_UNAVAILABLE')
    assert.equal((await f.requests('DELETE', `/auth/devices/${caller.device.id}`, {}, desktop)).status, 200)
    await assert.rejects(f.service.registerNativeFile({...identity,filePath:join(workspace,'first.txt'),sha256:createHash('sha256').update('FX11_FIRST_WRITE').digest('hex')}), (error:any)=>error.code==='TOOL_SOURCE_UNAVAILABLE')
  })
}
