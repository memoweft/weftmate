import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForCommand } from './helpers/wait-for-command.mjs'
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
  let service: any, desktopAuth: any, origin: string, hostId: string, timeOffset = 0
  const requests = async (method: string, route: string, body?: any, auth?: any, headers: any = {}) => {
    const response = await fetch(`${origin}${P}${route}`, { method, headers: {
      ...(body !== undefined ? { origin, 'content-type': 'application/json' } : {}),
      ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken,
        ...(auth.local ? { origin, 'x-weftmate-desktop': service.libraryDesktopToken } : {}) } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const value = await response.json()
    return { ...value, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  async function start(enabled = true) {
    desktopAuth = null;
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
    return new SignJWT({ sub, device_id: device, auth_epoch: 0, device_verified: true, host_id: hostId, scope: 'host:session',
      cnf: { jkt: await calculateJwkThumbprint(await exportJWK(key.publicKey)) }, ...overrides })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: jwk.kid }).setIssuer(issuer)
      .setAudience(audience ?? `${cloudBase}/hosts/${hostId}`).setIssuedAt().setJti(randomUUID())
      .setExpirationTime(overrides.exp ?? '300s').sign(signing.privateKey)
  }
  async function control(sub = 'cloud-a', epoch = 0) {
    return new SignJWT({ sub, device_id: 'test-control', auth_epoch: epoch, device_verified: true, scope: 'cloud:account' })
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
    if (route === '/auth/cloud-desktop' && !cookieAuth) cookieAuth = desktopAuth ?? await desktop();
    const nonce = await requests('POST', '/auth/cloud-nonce', {})
    const proof = await new SignJWT({ htm: 'POST', htu: `${origin}${P}${route}`, ath: hash(token), nonce: nonce.nonce,
      ...proofOverrides }).setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: await exportJWK(key.publicKey) })
      .setIssuedAt(Math.floor((Date.now() + timeOffset) / 1000)).setJti(proofOverrides.jti ?? randomUUID()).sign(key.privateKey)
    const result = await requests('POST', route, { accessToken: token, deviceName: 'New browser', ...extra }, cookieAuth,
      { dpop: proof, ...(route === '/auth/cloud-desktop' ? { 'x-weftmate-desktop': service.libraryDesktopToken } : {}) });
    // Native cloud login keeps the independently usable local Cookie.
    if (route === '/auth/cloud-desktop' && result.status === 200) result.cookie ??= cookieAuth.cookie;
    return { result, proof }
  }
  async function desktop(ownerId?: string) {
    const result = await requests('POST', '/auth/desktop', { ...(ownerId ? {ownerId} : {}), deviceName:'Synthetic desktop' },
      undefined, { 'x-weftmate-desktop': service.libraryDesktopToken });
    assert.equal(result.status, 200, JSON.stringify(result)); desktopAuth = result; return result;
  }
  async function seedDevice(sub: string, deviceId: string, key: any, status: string, ownerId = a.account.ownerId) {
    const file = join(root, 'cloud-identity', 'identity.json');
    await service.close();
    const state = JSON.parse(await readFile(file, 'utf8')), id = randomUUID(), publicJwk = await exportJWK(key.publicKey);
    state.devices[id] = { ownerId, bindingKey: JSON.stringify([issuer,sub]), cloudDeviceId:deviceId,
      jkt:await calculateJwkThumbprint(publicJwk), publicJwk, name:'Old synthetic device',
      requestedAt:new Date().toISOString(), status };
    await writeFile(file, JSON.stringify(state)); await start(); return id;
  }
  return { root, a, b, oldStore, oldSync, requests, access, control, bind, exchange, desktop, seedDevice, issuer, backend,
    stream: async (auth: any) => {
      const response = await fetch(`${origin}${P}/models/synthetic/chat/completions`, { method: 'POST',
        headers: { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken, origin, 'content-type': 'application/json',
          ...(auth.local ? { 'x-weftmate-desktop': service.libraryDesktopToken } : {}) },
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

test('AUTH-1 restored local owner binds only through its native desktop session and fresh verified cloud claim', async t => {
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
  assert.equal(other.status, 409, 'another cloud subject cannot replace the selected local owner');
  const stored = JSON.parse(await readFile(join(f.root, 'store.json'), 'utf8'));
  assert.equal(Object.values(stored.accounts).filter((row:any)=>row.account).length, 2, 'no replacement account is allocated');
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

test('AUTH-1 native selected owner resumes a partially committed binding without another device approval', async t => {
  const f = await fixture(t)
  f.interrupt()
  assert.equal((await f.bind()).result.status, 503)
  const key = await generateKeyPair('ES256')
  const token = await f.access('cloud-a', 'desktop', key, { scope: 'cloud:account' }, f.issuer.slice(0, -5))
  const resumed = (await f.exchange(token, key, '/auth/cloud-desktop')).result
  assert.equal(resumed.status, 200)
  assert.equal(resumed.account.ownerId, f.a.account.ownerId)
  assert.equal(resumed.local, true)
  assert.equal((await f.bind()).result.status, 200)
  const trusted = (await f.exchange(token, key, '/auth/cloud-desktop')).result
  assert.equal(trusted.status, 200)
  assert.equal(trusted.account.ownerId, f.a.account.ownerId)
  assert.equal((await f.requests('GET', '/auth/me', undefined, f.b)).account.ownerId, f.b.account.ownerId)
})

test('AUTH-1 desktop cloud login keeps the selected owner and requires native capability, local origin and CSRF', async t => {
  const f = await fixture(t)
  await f.bind(); await f.bind(f.b, 'cloud-b')
  const selected = await f.desktop(f.b.account.ownerId)
  const key = await generateKeyPair('ES256')
  const tokenA = await f.access('cloud-a', 'desktop-selected-b', key, {scope:'cloud:account'}, f.issuer.slice(0,-5))
  const conflict = (await f.exchange(tokenA, key, '/auth/cloud-desktop', {}, {}, selected)).result
  assert.equal(conflict.status, 409)
  assert.equal((await f.requests('GET', '/auth/me', undefined, selected)).account.ownerId, f.b.account.ownerId)
  const tokenB = await f.access('cloud-b', 'desktop-selected-b', key, {scope:'cloud:account'}, f.issuer.slice(0,-5))
  const loggedIn = (await f.exchange(tokenB, key, '/auth/cloud-desktop', {}, {}, selected)).result
  assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn))
  assert.equal(loggedIn.account.ownerId, f.b.account.ownerId)
  assert.equal(loggedIn.cookie, selected.cookie, 'cloud login retains the independently usable local cookie')
  assert.equal((await f.requests('GET', '/cloud/binding', undefined, loggedIn)).canManage, true)
  const body = {accessToken:tokenB,deviceName:'Synthetic desktop'}
  for (const headers of [
    {'x-weftmate-desktop':'wrong'},
    {'x-forwarded-for':'127.0.0.1'},
    {'forwarded':'for=127.0.0.1'},
    {origin:'https://public.synthetic.invalid'},
    {'x-weftmate-csrf':'wrong'},
  ]) {
    const rejected = await f.requests('POST', '/auth/cloud-desktop', body, selected, headers)
    assert.equal(rejected.status, 403, JSON.stringify(rejected))
    assert.equal(rejected.cookie, undefined)
  }
  assert.equal((await f.requests('POST','/auth/cloud-desktop',body,f.a,
    {'x-weftmate-desktop':f.service.libraryDesktopToken})).status,403,'password cookie does not establish native selected-owner authority')
})

test('M3-2 changing the computer account unbinds the old cloud account and preserves separate selected local owners', async t => {
  const f = await fixture(t);
  await f.bind();
  const oldLocal = await f.desktop(f.a.account.ownerId);
  assert.equal((await f.requests('DELETE', '/cloud/binding', {}, oldLocal)).status, 200);
  const oldKey = await generateKeyPair('ES256');
  const oldToken = await f.access('cloud-a', 'synthetic-old-phone', oldKey);
  assert.equal((await f.exchange(oldToken, oldKey)).result.status, 403, 'the previous cloud account has no content authority after unbinding');
  const nextLocal = await f.desktop(f.b.account.ownerId);
  const nextKey = await generateKeyPair('ES256');
  const nextToken = await f.access('cloud-b', 'synthetic-new-desktop', nextKey, {scope:'cloud:account'}, f.issuer.slice(0,-5));
  const next = (await f.exchange(nextToken, nextKey, '/auth/cloud-desktop', {}, {}, nextLocal)).result;
  assert.equal(next.status, 200, JSON.stringify(next));
  assert.equal(next.account.ownerId, f.b.account.ownerId);
  assert.equal((await f.requests('GET', '/auth/me', undefined, oldLocal)).account.ownerId, f.a.account.ownerId, 'the previous local account still works and its data is not reassigned');
});

test('AUTH-1 verified devices enter only their bound account; historical pending promotes on login; legacy deny remains durable', { timeout: 60_000 }, async t => {
  const f = await fixture(t)
  assert.equal((await f.bind()).result.status, 200)
  assert.equal((await f.bind(f.b, 'cloud-b', 1)).result.status, 200)
  const key = await generateKeyPair('ES256'), other = await generateKeyPair('ES256')
  const token = await f.access('cloud-a', 'phone-a', key)
  const pendingId = await f.seedDevice('cloud-a', 'phone-a', key, 'pending')
  assert.equal((await f.requests('GET', '/sessions', undefined, undefined, { authorization: `Bearer ${token}` })).status, 401)
  assert.equal((await f.requests('GET', '/cloud/devices/pending', undefined, f.a)).devices.length, 1)
  assert.equal((await f.requests('GET', '/cloud/devices/pending', undefined, f.b)).devices.length, 0)
  assert.equal((await f.requests('POST', `/cloud/devices/${pendingId}/decision`, { decision: 'allow' }, f.b)).status, 404)
  const session = (await f.exchange(token, key)).result
  assert.equal(session.status, 200); assert.equal(session.account.ownerId, f.a.account.ownerId)
  assert.ok(session.hostTrust?.trustToken, 'successful exchange delivers the host trust anchor under the content TLS boundary')
  assert.equal((await f.requests('GET', '/cloud/devices/pending', undefined, f.a)).devices.length, 0)
  const identity = JSON.parse(await readFile(join(f.root, 'cloud-identity', 'identity.json'), 'utf8'))
  assert.equal(identity.devices[pendingId].status, 'trusted')
  const notifications = (await f.requests('GET', '/activity', undefined, f.a)).items.filter((row:any)=>row.type==='system.device.signed_in')
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].actions[0].target.category, 'devices')
  assert.equal((await f.exchange(token, key)).result.status, 200)
  assert.equal((await f.requests('GET', '/activity', undefined, f.a)).items.filter((row:any)=>row.type==='system.device.signed_in').length, 1,
    'the same already verified device does not create another new-device notification')
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
  const deniedId = await f.seedDevice('cloud-b', 'phone-b', other, 'pending', f.b.account.ownerId)
  assert.equal((await f.requests('POST', `/cloud/devices/${deniedId}/decision`, { decision: 'deny' }, f.b)).status, 200)
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
  for (const device_verified of [undefined, false, 'true']) {
    const invalid = await f.access('cloud-a', 'phone-a', key, { device_verified })
    const rejected = (await f.exchange(invalid, key)).result
    assert.equal(rejected.status, 401)
    assert.equal(rejected.error.code, 'CLOUD_DEVICE_VERIFICATION_REQUIRED')
    assert.equal(rejected.cookie, undefined)
  }
  assert.equal((await f.exchange(await f.control(), key)).result.status, 401)
  assert.equal((await f.requests('POST', '/auth/cloud-session', { accessToken: token, deviceName: 'No key' })).status, 401)
  assert.equal((await f.requests('POST', '/auth/cloud-session', { accessToken: token, deviceName: 'Cookie alone' }, f.a)).error.code, 'DPOP_INVALID')
  assert.equal((await f.exchange(token, wrong)).result.status, 401)
  for (const override of [{ htm: 'GET' }, { htu: 'https://other.example.com/' }, { nonce: 'unknown' }, { ath: 'wrong' }])
    assert.equal((await f.exchange(token, key, '/auth/cloud-session', {}, override)).result.status, 401)
  const good = await f.exchange(token, key)
  assert.equal(good.result.status, 200)
  assert.equal((await f.requests('POST', '/auth/cloud-session', { accessToken: token, deviceName: 'Repeat' }, undefined, { dpop: good.proof })).status, 401)
  await f.restart()
  assert.equal((await f.requests('POST', '/auth/cloud-session', { accessToken: token, deviceName: 'Repeat' }, undefined, { dpop: good.proof })).status, 401)
})

const phoneNonce = () => createHash('sha256').update(randomUUID()).digest('base64url');
const phoneCommit = (p: any, deviceId: string, jkt: string, nonce: string) => hash(JSON.stringify(['wm-pair-phone-v2', p.challenge, deviceId, jkt, nonce]));
async function submitPairing(f: any, p: any, token: string, key: any, deviceId = 'phone') {
  p.transcript = [p.version,p.issuer,p.sub,p.hostId,p.tlsSpki,
    await calculateJwkThumbprint(p.publicJwk),p.challenge,p.expiresAt,p.origin,p.relay?.baseUrl || ''];
  const nonce = phoneNonce(), jkt = await calculateJwkThumbprint(await exportJWK(key.publicKey));
  const joined = (await f.exchange(token, key, '/cloud/pairings/join', {challenge:p.challenge, phoneCommitment:phoneCommit(p,deviceId,jkt,nonce)})).result;
  assert.equal(joined.status, 200, JSON.stringify(joined));
  assert.equal(joined.cookie, undefined);
  assert.equal(hash(JSON.stringify(['wm-pair-host-v2', ...p.transcript, joined.hostNonce])), p.hostCommitment);
  const revealed = (await f.exchange(token,key,'/cloud/pairings/reveal',{challenge:p.challenge,phoneNonce:nonce})).result;
  assert.equal(revealed.status,200,JSON.stringify(revealed)); assert.equal(revealed.cookie,undefined);
  const sas = (transcript = p.transcript, hn = joined.hostNonce, pn = nonce, did = deviceId, thumb = jkt) =>
    (createHash('sha256').update(JSON.stringify(['wm-pair-sas-v2',...transcript,hn,did,thumb,pn])).digest().readUInt32BE(0) % 1_000_000).toString().padStart(6,'0');
  return {nonce,jkt,joined,sas};
}
async function confirmPairing(f: any, p: any, token: string, key: any, deviceId = 'phone') {
  const submitted = await submitPairing(f,p,token,key,deviceId);
  const decision = await f.requests('POST','/cloud/pairings/decision',{challenge:p.challenge,decision:'confirm',verificationCode:submitted.sas()},f.a);
  assert.equal(decision.status,200,JSON.stringify(decision)); return submitted;
}

test('PAIR-CODE real requests require desktop comparison before redemption and bind every transcript contribution', async t => {
  const f=await fixture(t);await f.bind();const key=await generateKeyPair('ES256');const token=await f.access('cloud-a','phone',key);
  const existingKey=await generateKeyPair('ES256'),existingToken=await f.access('cloud-a','existing-phone',existingKey);
  assert.equal((await f.exchange(existingToken,existingKey)).result.status,200);
  const p=await f.requests('POST','/cloud/pairings',{},f.a);
  assert.equal(p.version,2); assert.equal(p.hostNonce,undefined,'host secret must stay hidden until phone commits');
  for(const route of ['/auth/cloud-session','/auth/cloud-channel']) {
    const bypass=(await f.exchange(token,key,route)).result;
    assert.equal(bypass.status,403,'new device cannot preempt join with ordinary login');assert.equal(bypass.cookie,undefined);assert.equal(bypass.token,undefined);
  }
  assert.equal((await f.exchange(existingToken,existingKey)).result.status,200,'existing trusted device remains usable');
  const before=await f.exchange(token,key,'/cloud/pairings/redeem',{challenge:p.challenge});assert.equal(before.result.status,401);
  const s=await submitPairing(f,p,token,key);
  const status=await f.requests('POST','/cloud/pairings/status',{challenge:p.challenge},f.a);
  assert.equal(status.verificationCode,s.sas());assert.equal(status.state,'comparing');assert.match(status.verificationCode,/^\d{6}$/);
  for(const route of ['/cloud/pairings/redeem','/auth/cloud-session','/auth/cloud-channel']) {
    const result=(await f.exchange(token,key,route,route.endsWith('redeem')?{challenge:p.challenge}:{})).result;
    assert.equal(result.status,403,JSON.stringify(result));assert.equal(result.cookie,undefined);assert.equal(result.token,undefined);
  }
  for(let i=0;i<p.transcript.length;i++){const changed=[...p.transcript];changed[i]=String(changed[i])+'x';assert.notEqual(s.sas(changed),s.sas());}
  assert.notEqual(s.sas(p.transcript,phoneNonce()),s.sas());assert.notEqual(s.sas(p.transcript,s.joined.hostNonce,phoneNonce()),s.sas());
  assert.notEqual(s.sas(p.transcript,s.joined.hostNonce,s.nonce,'other-device'),s.sas());
  assert.notEqual(s.sas(p.transcript,s.joined.hostNonce,s.nonce,'phone',phoneNonce()),s.sas());
  const second=await generateKeyPair('ES256'),other=await f.access('cloud-a','phone',second);
  assert.equal((await f.exchange(other,second)).result.status,403,'key rotation cannot bypass an in-progress pairing');
  assert.equal((await f.requests('POST','/cloud/pairings/decision',{challenge:p.challenge,decision:'confirm',verificationCode:'wrong'},f.a)).status,409);
  await f.restart();
  assert.equal((await f.requests('POST','/cloud/pairings/status',{challenge:p.challenge},f.a)).verificationCode,s.sas());
  assert.equal((await f.requests('POST','/cloud/pairings/decision',{challenge:p.challenge,decision:'confirm',verificationCode:s.sas()},f.a)).status,200);
  assert.equal((await f.exchange(other,second,'/cloud/pairings/redeem',{challenge:p.challenge})).result.status,401);
  const session=(await f.exchange(token,key,'/cloud/pairings/redeem',{challenge:p.challenge})).result;
  assert.equal(session.status,200);assert.ok(session.cookie);assert.equal((await f.requests('GET','/auth/me',undefined,session)).status,200);
  assert.equal((await f.exchange(token,key,'/cloud/pairings/redeem',{challenge:p.challenge})).result.status,401);
});

test('PAIR-CODE cancellation, expiry, replacement, account boundaries and commitment lock survive real requests', async t => {
  const f=await fixture(t);await f.bind();await f.bind(f.b,'cloud-b');
  const key=await generateKeyPair('ES256'),token=await f.access('cloud-a','phone',key);
  const p=await f.requests('POST','/cloud/pairings',{},f.a),s=await submitPairing(f,p,token,key);
  assert.equal((await f.requests('POST','/cloud/pairings/status',{challenge:p.challenge},f.b)).status,401);
  assert.equal((await f.requests('POST','/cloud/pairings/decision',{challenge:p.challenge,decision:'confirm',verificationCode:s.sas()},f.b)).status,401);
  const wrongAccount=await f.access('cloud-b','phone',key);
  assert.equal((await f.exchange(wrongAccount,key,'/cloud/pairings/reveal',{challenge:p.challenge,phoneNonce:s.nonce})).result.status,401);
  const different=phoneNonce();
  assert.equal((await f.exchange(token,key,'/cloud/pairings/join',{challenge:p.challenge,phoneCommitment:phoneCommit(p,'phone',s.jkt,different)})).result.status,409);
  assert.equal((await f.exchange(token,key,'/cloud/pairings/reveal',{challenge:p.challenge,phoneNonce:different})).result.status,401);
  assert.equal((await f.requests('POST','/cloud/pairings/decision',{challenge:p.challenge,decision:'cancel'},f.a)).state,'cancelled');
  await f.restart();
  assert.equal((await f.exchange(token,key,'/cloud/pairings/redeem',{challenge:p.challenge})).result.status,401);
  assert.equal((await f.exchange(token,key)).result.status,403,'cancellation cannot be bypassed by ordinary login');
  const expired=await f.requests('POST','/cloud/pairings',{},f.a);await submitPairing(f,expired,token,key);
  f.advance(120_001);
  assert.equal((await f.requests('POST','/cloud/pairings/status',{challenge:expired.challenge},f.a)).state,'expired');
  assert.equal((await f.requests('POST','/cloud/pairings/decision',{challenge:expired.challenge,decision:'confirm',verificationCode:'000000'},f.a)).status,401);
  assert.equal((await f.exchange(token,key,'/cloud/pairings/redeem',{challenge:expired.challenge})).result.status,401);
  assert.equal((await f.exchange(token,key)).result.status,403);
  const old=await f.requests('POST','/cloud/pairings',{},f.a),newer=await f.requests('POST','/cloud/pairings',{},f.a);
  assert.equal((await f.requests('POST','/cloud/pairings/status',{challenge:old.challenge},f.a)).state,'cancelled');
  await confirmPairing(f,newer,token,key);
  const results=await Promise.all([f.exchange(token,key,'/cloud/pairings/redeem',{challenge:newer.challenge}),f.exchange(token,key,'/cloud/pairings/redeem',{challenge:newer.challenge})]);
  assert.deepEqual(results.map(x=>x.result.status).sort(),[200,401]);
});

test('PAIR-CODE confirming a replacement key never authorizes cancelled or superseded keys', async t => {
  const f=await fixture(t);await f.bind();
  const a=await generateKeyPair('ES256'),at=await f.access('cloud-a','phone',a);
  const oldSession=(await f.exchange(at,a)).result;assert.equal(oldSession.status,200);
  const p1=await f.requests('POST','/cloud/pairings',{},f.a);await submitPairing(f,p1,at,a);
  await f.requests('POST','/cloud/pairings/decision',{challenge:p1.challenge,decision:'cancel'},f.a);
  assert.equal((await f.exchange(at,a)).result.status,403);
  const b=await generateKeyPair('ES256'),bt=await f.access('cloud-a','phone',b);
  const p2=await f.requests('POST','/cloud/pairings',{},f.a);await confirmPairing(f,p2,bt,b);
  const fresh=(await f.exchange(bt,b,'/cloud/pairings/redeem',{challenge:p2.challenge})).result;
  assert.equal(fresh.status,200);assert.equal((await f.exchange(bt,b)).result.status,200);
  assert.equal((await f.exchange(at,a)).result.status,403,'cancelled A cannot inherit B confirmation');
  assert.equal((await f.requests('GET','/sessions',undefined,oldSession)).status,401,'superseded key session is rejected');
  const c=await generateKeyPair('ES256');assert.equal((await f.exchange(await f.access('cloud-a','phone',c),c)).result.status,403);
  await f.restart();assert.equal((await f.exchange(at,a)).result.status,403);
});

test('pairing is local, owner-scoped, expires and consumes once; unlink preserves local login and all stored data', async t => {
  const f = await fixture(t); await f.bind(); await f.bind(f.b, 'cloud-b')
  const key = await generateKeyPair('ES256')
  const pairing = await f.requests('POST', '/cloud/pairings', {}, f.a)
  assert.equal(pairing.status, 201); assert.ok(pairing.tlsSpki); assert.ok(pairing.publicJwk)
  const bToken = await f.access('cloud-b', 'phone', key)
  assert.equal((await f.exchange(bToken, key, '/cloud/pairings/redeem', { challenge: pairing.challenge })).result.status, 401)
  const token = await f.access('cloud-a', 'phone', key)
  await confirmPairing(f,pairing,token,key)
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
  const rotated = await generateKeyPair('ES256')
  assert.equal((await f.exchange(await f.access('cloud-a', 'phone', rotated), rotated)).result.status, 403,
    'a new proof key cannot revive the same revoked cloud device ID')
  const revokedPair = await f.requests('POST', '/cloud/pairings', {}, f.a)
  assert.equal((await f.exchange(token, key, '/cloud/pairings/join', {challenge:revokedPair.challenge,
    phoneCommitment:phoneCommit(revokedPair,'phone',await calculateJwkThumbprint(await exportJWK(key.publicKey)),phoneNonce())})).result.status, 403,
    'an old pairing path cannot revive an offlined device')
  const fresh = await generateKeyPair('ES256'), freshToken = await f.access('cloud-a', 'second-phone', fresh)
  const pair = await f.requests('POST', '/cloud/pairings', {}, f.a)
  await confirmPairing(f,pair,freshToken,fresh,'second-phone')
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
  return (await waitForCommand(async () => {
    const found = await f.requests('GET', '/commands/' + sent.command.commandId, undefined, auth);
    assert.equal(found.status, 200, JSON.stringify(found));
    return found.command;
  })).sessionId;
}

test('AUTH-1 cloud login on a fresh native desktop keeps its durable local owner; another cloud identity cannot replace it', async t => {
  const f = await fixture(t, {fresh: true});
  const legacy = f.service.legacyOwnerId();
  const key = await generateKeyPair('ES256');
  const token = await f.access('first-cloud', 'desktop-first', key, {scope: 'cloud:account'}, f.issuer.slice(0, -5));
  const first = (await f.exchange(token, key, '/auth/cloud-desktop')).result;
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(first.account.ownerId, legacy, 'first local profile preserves the legacy data owner');
  assert.equal(first.device.authKind, 'desktop');
  assert.equal(first.cloudAuthenticated, true);
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
  assert.equal(second.status, 409, JSON.stringify(second));
  assert.equal(f.service.executionOwnerId(), first.account.ownerId);
  const localSessions = await f.requests('GET', '/sessions', undefined, again);
  assert.equal(localSessions.status, 200, JSON.stringify(localSessions));
  assert.ok(localSessions.sessions.some((row:any)=>row.sessionId===sessionId), 'the original conversation remains visible');
  assert.equal(second.account, undefined, 'conflicting cloud identity receives neither a local owner nor capability context');
  const stored = JSON.parse(await readFile(join(f.root, 'store.json'), 'utf8'));
  assert.equal(stored.accounts[first.account.ownerId].sessions[sessionId].origin, 'personal-remote');
  assert.equal(Object.values(stored.accounts).filter((row:any)=>row.account).length, 1, 'cloud subject conflict leaves no empty replacement owner');
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
  assert.equal(second.status,409);
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
        assert.equal(result.status, 200, JSON.stringify(result))
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
    assert.equal(account.devices[account.commands[source.commandId].sourceDeviceId].authKind,scenario==='phone'?'cloud':'desktop')
    const saved: any = Object.values(account.commands).find((row:any)=>row.artifactId===artifact.artifactId)
    assert.equal(saved.toolSource.sourceCommandId,source.commandId)
    assert.equal(saved.nativeFileObserved,true)
    assert.equal(saved.verification.method,'sha256_readback')
    assert.equal(stored.legacyOwnerId, desktop.account.ownerId, 'native login retains the original account storage owner')
    await assert.rejects(f.service.registerNativeFile({...identity,receiptId:'foreign-receipt',filePath:join(workspace,'first.txt'),sha256:createHash('sha256').update('FX11_FIRST_WRITE').digest('hex')}), (error:any)=>error.code==='TOOL_SOURCE_UNAVAILABLE')
    assert.equal((await f.requests('DELETE', `/auth/devices/${caller.device.id}`, {}, desktop)).status, 200)
    await assert.rejects(f.service.registerNativeFile({...identity,filePath:join(workspace,'first.txt'),sha256:createHash('sha256').update('FX11_FIRST_WRITE').digest('hex')}), (error:any)=>error.code==='TOOL_SOURCE_UNAVAILABLE')
  })
}
