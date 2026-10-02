import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, renameSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const PASSWORD = 'correct horse battery staple'
const NEXT_PASSWORD = 'a different long passphrase'

function backend() {
  const sessions = new Set<string>()
  const calls = { create: 0, message: 0 }
  return {
    sessions, calls,
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [{ id: 'local', name: 'Local', model: 'synthetic', configured: true }],
    preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId }: { sessionId: string }) => {
      calls.create++; sessions.add(sessionId); return { sessionId }
    },
    sendMessage: async () => { calls.message++; return { accepted: true } },
    cancelSession: async () => ({ accepted: true }),
    readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, title: 'Synthetic session', running: false } : null,
  }
}

async function api(origin: string, method: string, path: string, body?: object,
  headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') }
}

async function proxyApi(origin: string, method: string, path: string, body?: object,
  headers: Record<string, string> = {}) {
  return new Promise<{ status: number, body: any, cookie: string | null }>((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined
    const request = httpRequest(new URL(path, origin), {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    }, (response) => {
      const parts: Buffer[] = []
      response.on('data', (part) => parts.push(part))
      response.on('end', () => resolve({ status: response.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(parts).toString('utf8')),
        cookie: response.headers['set-cookie']?.[0] ?? null }))
    })
    request.on('error', reject)
    request.end(payload)
  })
}

function browser(origin: string, cookie: string, csrf?: string) {
  return { cookie: cookie.split(';')[0], origin, ...(csrf ? { 'x-weftmate-csrf': csrf } : {}) }
}

test('local setup grants one owner account and password sessions share data across devices and restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-flow-'))
  const f = backend()
  f.sessions.add('old-session')
  const service = await createPersonalAccessService({ root, port: 0, backend: f })
  try {
    const { origin, ownerId, hostId } = await service.start()
    const legacy = await service.enrollDevice({ name: 'old-phone' })
    await service.attachSession('old-session')
    assert.deepEqual((await api(origin, 'GET', '/personal/v1/auth/state')).body,
      { configured: false, registrationAvailable: true })
    const firstGrant = await service.issueSetupGrant()
    const grant = await service.issueSetupGrant()
    assert.notEqual(grant.grant, firstGrant.grant)
    const setupBody = { grant: firstGrant.grant, username: '  Alice  ', password: PASSWORD, deviceName: 'Laptop' }
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/setup', setupBody, { origin })).status, 401)
    const setup = await api(origin, 'POST', '/personal/v1/auth/setup', { ...setupBody, grant: grant.grant }, { origin })
    assert.equal(setup.status, 201)
    assert.equal(setup.body.account.username, 'Alice')
    assert.ok(setup.cookie?.includes('HttpOnly'))
    assert.ok(setup.cookie?.includes('SameSite=Strict'))
    assert.equal(JSON.stringify(setup.body).includes('token'), false)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/state')).body.configured, true)
    assert.equal((await api(origin, 'GET', '/personal/v1/status', undefined,
      { authorization: `Bearer ${legacy.token}` })).status, 401)
    await assert.rejects(service.enrollDevice({ name: 'bypass' }),
      (error: { code: string }) => error.code === 'ACCOUNT_LOGIN_REQUIRED')
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/setup', { ...setupBody, grant: grant.grant }, { origin })).status, 409)

    const login = await api(origin, 'POST', '/personal/v1/auth/login',
      { username: 'alice', password: PASSWORD, deviceName: 'Phone' }, { origin })
    assert.equal(login.status, 200)
    assert.notEqual(login.body.device.id, setup.body.device.id)
    const first = browser(origin, setup.cookie!, setup.body.csrfToken)
    const second = browser(origin, login.cookie!, login.body.csrfToken)
    assert.equal((await api(origin, 'POST', '/personal/v1/commands',
      { requestId: 'no-csrf', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' },
      browser(origin, login.cookie!))).status, 403)
    assert.equal(f.calls.create, 0)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined, first)).body.device.id,
      setup.body.device.id)
    const listed = await api(origin, 'GET', '/personal/v1/auth/devices', undefined, second)
    assert.equal(listed.body.devices.filter((device: { revoked: boolean }) => !device.revoked).length, 2)
    assert.equal(listed.body.devices.some((device: { id: string, revoked: boolean }) =>
      device.id === legacy.deviceId && device.revoked), true)
    assert.equal(listed.body.devices.some((device: { online?: unknown }) => 'online' in device), false)
    assert.equal((await api(origin, 'GET', '/personal/v1/sessions', undefined, second)).body.sessions[0].sessionId,
      'old-session')
    const created = await api(origin, 'POST', '/personal/v1/commands',
      { requestId: 'cross-device', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' }, second)
    assert.equal(created.status, 202)
    assert.equal((await api(origin, 'GET', `/personal/v1/commands/${created.body.command.commandId}`, undefined, first)).status, 200)
    assert.equal((await api(origin, 'DELETE', `/personal/v1/auth/devices/${setup.body.device.id}`, undefined, second)).status, 200)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined, first)).status, 401)
    const changed = await api(origin, 'POST', '/personal/v1/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEXT_PASSWORD }, second)
    assert.equal(changed.status, 200)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined, second)).status, 401)
    const current = browser(origin, changed.cookie!, changed.body.csrfToken)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined, current)).status, 200)
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/login',
      { username: 'Alice', password: PASSWORD, deviceName: 'Old password' }, { origin })).status, 401)
    const newest = await api(origin, 'POST', '/personal/v1/auth/login',
      { username: 'Alice', password: NEXT_PASSWORD, deviceName: 'New phone' }, { origin })
    assert.equal(newest.status, 200)
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/logout', undefined,
      browser(origin, newest.cookie!, newest.body.csrfToken))).status, 200)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined,
      browser(origin, newest.cookie!))).status, 401)
    assert.equal(service.status().ownerId, ownerId)
    const stored = readFileSync(join(root, 'store.json'), 'utf8')
    assert.equal(stored.includes(PASSWORD), false)
    assert.equal(stored.includes(NEXT_PASSWORD), false)
    assert.equal(stored.includes(grant.grant), false)
    assert.equal(stored.includes(setup.cookie!.split(';')[0].split('=')[1]), false)
    await service.close()
    const restarted = await createPersonalAccessService({ root, port: 0, backend: f })
    try {
      const next = await restarted.start()
      assert.equal(next.ownerId, ownerId)
      assert.equal(next.hostId, hostId)
      assert.equal((await api(next.origin, 'GET', '/personal/v1/sessions', undefined,
        { cookie: current.cookie })).status, 200)
      assert.equal((await api(next.origin, 'GET', '/personal/v1/auth/me', undefined,
        { cookie: current.cookie })).status, 200)
    } finally { await restarted.close() }
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('cross-site, missing CSRF, bearer management, setup proxy and expired grant are rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-guards-'))
  let now = Date.now()
  const f = backend()
  const service = await createPersonalAccessService({ root, port: 0, backend: f, clock: () => now })
  try {
    const { origin } = await service.start()
    const grant = await service.issueSetupGrant()
    const setupBody = { grant: grant.grant, username: 'Owner', password: PASSWORD, deviceName: 'Browser' }
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/setup', setupBody,
      { origin, 'x-forwarded-host': 'example.com' })).status, 403)
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/setup', setupBody,
      { origin: 'https://evil.example' })).status, 403)
    now += 10 * 60 * 1000 + 1
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/setup', setupBody, { origin })).status, 401)
    const fresh = await service.issueSetupGrant()
    const setup = await api(origin, 'POST', '/personal/v1/auth/setup', { ...setupBody, grant: fresh.grant }, { origin })
    assert.equal(setup.status, 201)
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/login',
      { username: 'Owner', password: PASSWORD, deviceName: 'Phone' })).status, 403)
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/login',
      { username: 'Owner', password: PASSWORD, deviceName: 'Phone' },
      { origin: 'https://evil.example' })).status, 403)
    const cookieOnly = browser(origin, setup.cookie!)
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/logout', undefined, cookieOnly)).status, 403)
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/logout', undefined,
      { ...browser(origin, setup.cookie!, setup.body.csrfToken), origin: 'https://evil.example' })).status, 403)
    const bearerValue = setup.cookie!.split(';')[0].split('=')[1]
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/devices', undefined,
      { authorization: `Bearer ${bearerValue}` })).status, 403)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/devices', undefined,
      { authorization: `Bearer ${bearerValue}`, cookie: cookieOnly.cookie })).status, 400)
    now += 30 * 24 * 60 * 60 * 1000 + 1
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined, cookieOnly)).status, 401)
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('failed login limit persists and a successful login resumes after the lock window', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-limit-'))
  let now = Date.now()
  const f = backend()
  const first = await createPersonalAccessService({ root, port: 0, backend: f, clock: () => now })
  const { origin } = await first.start()
  const grant = await first.issueSetupGrant()
  await api(origin, 'POST', '/personal/v1/auth/setup',
    { grant: grant.grant, username: 'Owner', password: PASSWORD, deviceName: 'Browser' }, { origin })
  for (let index = 0; index < 5; index++) {
    const failed = await api(origin, 'POST', '/personal/v1/auth/login',
      { username: 'Owner', password: 'wrong password phrase', deviceName: 'Other' }, { origin })
    assert.equal(failed.status, 401)
    assert.deepEqual(failed.body, { error: { code: 'INVALID_CREDENTIALS' } })
  }
  assert.equal((await api(origin, 'POST', '/personal/v1/auth/login',
    { username: 'Owner', password: PASSWORD, deviceName: 'Other' }, { origin })).status, 429)
  await first.close()
  const restarted = await createPersonalAccessService({ root, port: 0, backend: f, clock: () => now })
  try {
    const next = await restarted.start()
    assert.equal((await api(next.origin, 'POST', '/personal/v1/auth/login',
      { username: 'Owner', password: PASSWORD, deviceName: 'Other' }, { origin: next.origin })).status, 429)
    now += 31_000
    assert.equal((await api(next.origin, 'POST', '/personal/v1/auth/login',
      { username: 'Owner', password: PASSWORD, deviceName: 'Other' }, { origin: next.origin })).status, 200)
  } finally {
    await restarted.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('strict v1 migration preserves owner, sessions, commands and devices until setup revokes legacy tokens', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-migration-'))
  const f = backend()
  f.sessions.add('existing-session')
  const initial = await createPersonalAccessService({ root, port: 0, backend: f })
  const { origin, ownerId, hostId } = await initial.start()
  const legacy = await initial.enrollDevice({ name: 'legacy' })
  await initial.attachSession('existing-session')
  await initial.close()
  const storePath = join(root, 'store.json')
  const persisted = JSON.parse(readFileSync(storePath, 'utf8'))
  const v1 = { version: 1, hostId, ownerId, ...persisted.accounts[ownerId] }
  v1.version = 1
  delete v1.account; delete v1.setupGrant; delete v1.authLimits
  for (const device of Object.values(v1.devices) as any[]) delete device.authKind
  const payload = { requestId: 'legacy-request', kind: 'session.cancel', targetDeviceId: hostId,
    sessionId: 'existing-session' }
  v1.commands['cmd-legacy'] = { commandId: 'cmd-legacy', ownerId, requestId: payload.requestId,
    payloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), payload,
    sourceDeviceId: legacy.deviceId, targetDeviceId: hostId, kind: payload.kind,
    sessionId: 'existing-session', state: 'uncertain', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  writeFileSync(storePath, JSON.stringify(v1))
  const migrated = await createPersonalAccessService({ root, port: 0, backend: f })
  try {
    const next = await migrated.start()
    assert.equal(next.ownerId, ownerId)
    assert.equal(next.hostId, hostId)
    assert.equal(JSON.parse(readFileSync(storePath, 'utf8')).version, 3)
    assert.equal((await api(next.origin, 'GET', '/personal/v1/commands/cmd-legacy', undefined,
      { authorization: `Bearer ${legacy.token}` })).status, 200)
    const grant = await migrated.issueSetupGrant()
    assert.equal((await api(next.origin, 'POST', '/personal/v1/auth/setup',
      { grant: grant.grant, username: 'Owner', password: PASSWORD, deviceName: 'Phone' },
      { origin: next.origin })).status, 201)
    assert.equal((await api(next.origin, 'GET', '/personal/v1/commands/cmd-legacy', undefined,
      { authorization: `Bearer ${legacy.token}` })).status, 401)
    assert.equal(JSON.parse(readFileSync(storePath, 'utf8')).accounts[ownerId]
      .commands['cmd-legacy'].requestId, 'legacy-request')
  } finally {
    await migrated.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('concurrent setup, login and password change respect the committed account epoch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-races-'))
  const f = backend()
  const service = await createPersonalAccessService({ root, port: 0, backend: f })
  try {
    const { origin } = await service.start()
    const grant = await service.issueSetupGrant()
    const request = { grant: grant.grant, username: 'Owner', password: PASSWORD, deviceName: 'Browser' }
    const setups = await Promise.all([
      api(origin, 'POST', '/personal/v1/auth/setup', request, { origin }),
      api(origin, 'POST', '/personal/v1/auth/setup', request, { origin }),
    ])
    assert.deepEqual(setups.map((item) => item.status).sort(), [201, 409])
    const first = setups.find((item) => item.status === 201)!
    const current = browser(origin, first.cookie!, first.body.csrfToken)
    const [changing, racingLogin] = await Promise.all([
      api(origin, 'POST', '/personal/v1/auth/change-password',
        { currentPassword: PASSWORD, newPassword: NEXT_PASSWORD }, current),
      api(origin, 'POST', '/personal/v1/auth/login',
        { username: 'Owner', password: PASSWORD, deviceName: 'Racing phone' }, { origin }),
    ])
    assert.equal(changing.status, 200)
    assert.ok([200, 401].includes(racingLogin.status))
    if (racingLogin.cookie) assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined,
      browser(origin, racingLogin.cookie))).status, 401)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined, current)).status, 401)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined,
      browser(origin, changing.cookie!))).status, 200)
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('store and hash corruption fail closed; failed login persistence never issues a cookie', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-store-fault-'))
  const f = backend()
  const service = await createPersonalAccessService({ root, port: 0, backend: f })
  const { origin } = await service.start()
  const grant = await service.issueSetupGrant()
  assert.equal((await api(origin, 'POST', '/personal/v1/auth/setup',
    { grant: grant.grant, username: 'Owner', password: PASSWORD, deviceName: 'Browser' }, { origin })).status, 201)
  const storePath = join(root, 'store.json')
  const backup = join(root, 'backup.json')
  renameSync(storePath, backup)
  mkdirSync(storePath)
  try {
    const failed = await api(origin, 'POST', '/personal/v1/auth/login',
      { username: 'Owner', password: PASSWORD, deviceName: 'Phone' }, { origin })
    assert.equal(failed.status, 503)
    assert.equal(failed.cookie, null)
    assert.equal(service.status().state, 'storage_fault')
  } finally {
    rmSync(storePath, { recursive: true, force: true })
    renameSync(backup, storePath)
    await service.close()
  }
  const tampered = JSON.parse(readFileSync(storePath, 'utf8'))
  tampered.accounts[tampered.legacyOwnerId].account.password.N = 2 ** 24
  writeFileSync(storePath, JSON.stringify(tampered))
  await assert.rejects(createPersonalAccessService({ root, port: 0, backend: f }),
    (error: { code: string }) => error.code === 'STORE_CORRUPT')
  rmSync(root, { recursive: true, force: true })
})

test('active password devices have a finite cap while device history remains queryable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-device-cap-'))
  const f = backend()
  const first = await createPersonalAccessService({ root, port: 0, backend: f })
  const { origin } = await first.start()
  const grant = await first.issueSetupGrant()
  const setup = await api(origin, 'POST', '/personal/v1/auth/setup',
    { grant: grant.grant, username: 'Owner', password: PASSWORD, deviceName: 'Browser' }, { origin })
  assert.equal(setup.status, 201)
  await first.close()
  const storePath = join(root, 'store.json')
  const stored = JSON.parse(readFileSync(storePath, 'utf8'))
  const account = stored.accounts[setup.body.account.ownerId]
  const sample = account.devices[setup.body.device.id]
  for (let index = 0; index < 31; index++) {
    account.devices[`device-synthetic-${index}`] = { ...sample, name: `Synthetic ${index}`,
      tokenHash: createHash('sha256').update(`synthetic-${index}`).digest('hex') }
  }
  writeFileSync(storePath, JSON.stringify(stored))
  const capped = await createPersonalAccessService({ root, port: 0, backend: f })
  try {
    const next = await capped.start()
    const refused = await api(next.origin, 'POST', '/personal/v1/auth/login',
      { username: 'Owner', password: PASSWORD, deviceName: 'Extra' }, { origin: next.origin })
    assert.deepEqual(refused, { status: 429, body: { error: { code: 'DEVICE_LIMIT' } }, cookie: null })
    assert.equal((await api(next.origin, 'GET', '/personal/v1/auth/devices', undefined,
      { cookie: setup.cookie!.split(';')[0] })).body.devices.length, 32)
  } finally {
    await capped.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('static UI hook is called before authentication only for exact public assets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-static-'))
  const seen: string[] = []
  const service = await createPersonalAccessService({ root, port: 0, backend: backend(),
    uiHandler: async (request: { url: string }, response: { writeHead: Function, end: Function }) => {
      seen.push(request.url)
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('synthetic UI')
      return true
    } })
  try {
    const { origin } = await service.start()
    assert.equal(await (await fetch(`${origin}/personal/v1/ui/app.js`)).text(), 'synthetic UI')
    assert.equal((await fetch(`${origin}/personal/v1/ui/private-file`)).status, 401)
    assert.deepEqual(seen, ['/personal/v1/ui/app.js'])
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('configured HTTPS origin requires an explicit trusted loopback proxy and matching forwarded protocol', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-proxy-'))
  const f = backend()
  await assert.rejects(createPersonalAccessService({ root, port: 0, backend: f,
    allowedOrigins: ['https://personal.example'] }), (error: { code: string }) => error.code === 'INVALID_CONFIGURATION')
  const service = await createPersonalAccessService({ root, port: 0, backend: f,
    allowedOrigins: ['https://personal.example'], trustedProxy: true })
  try {
    const { origin } = await service.start()
    const publicHeaders = { host: 'personal.example', origin: 'https://personal.example',
      'x-forwarded-host': 'personal.example', 'x-forwarded-proto': 'https' }
    assert.equal((await proxyApi(origin, 'GET', '/personal/v1/auth/state', undefined,
      { ...publicHeaders, 'x-forwarded-proto': 'http' })).status, 403)
    assert.equal((await proxyApi(origin, 'GET', '/personal/v1/auth/state', undefined,
      { host: publicHeaders.host, origin: publicHeaders.origin })).status, 403)
    assert.equal((await proxyApi(origin, 'GET', '/personal/v1/auth/state', undefined,
      { ...publicHeaders, 'x-forwarded-host': 'different.example' })).status, 403)
    assert.equal((await proxyApi(origin, 'GET', '/personal/v1/auth/state', undefined,
      publicHeaders)).status, 200)
    const grant = await service.issueSetupGrant()
    assert.equal((await proxyApi(origin, 'POST', '/personal/v1/auth/setup',
      { grant: grant.grant, username: 'Owner', password: PASSWORD, deviceName: 'Browser' }, publicHeaders)).status, 403)
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/setup',
      { grant: grant.grant, username: 'Owner', password: PASSWORD, deviceName: 'Browser' }, { origin })).status, 201)
    const login = await proxyApi(origin, 'POST', '/personal/v1/auth/login',
      { username: 'Owner', password: PASSWORD, deviceName: 'Phone' }, publicHeaders)
    assert.equal(login.status, 200)
    assert.match(login.cookie!, /; Secure(?:;|$)/)
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('password change rotates the same device and rejects its old pending command', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-rotate-'))
  const f = backend()
  const originalPreflight = f.preflight
  let count = 0
  let release: (() => void) | undefined
  let entered: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
  f.preflight = async () => {
    count++
    if (count === 2) { entered?.(); await gate }
    return originalPreflight()
  }
  const service = await createPersonalAccessService({ root, port: 0, backend: f })
  try {
    const { origin, hostId } = await service.start()
    const grant = await service.issueSetupGrant()
    const setup = await api(origin, 'POST', '/personal/v1/auth/setup',
      { grant: grant.grant, username: 'Owner', password: PASSWORD, deviceName: 'Laptop' }, { origin })
    assert.equal(setup.status, 201)
    const other = await api(origin, 'POST', '/personal/v1/auth/login',
      { username: 'Owner', password: PASSWORD, deviceName: 'Phone' }, { origin })
    const current = browser(origin, setup.cookie!, setup.body.csrfToken)
    const accepted = await api(origin, 'POST', '/personal/v1/commands',
      { requestId: 'before-change', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' }, current)
    assert.equal(accepted.status, 202)
    await enteredPromise
    const before = JSON.parse(readFileSync(join(root, 'store.json'), 'utf8'))
      .accounts[setup.body.account.ownerId].devices[setup.body.device.id].enrolledAt
    const changed = await api(origin, 'POST', '/personal/v1/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEXT_PASSWORD }, current)
    assert.equal(changed.status, 200)
    assert.equal(changed.body.device.id, setup.body.device.id)
    assert.equal(JSON.parse(readFileSync(join(root, 'store.json'), 'utf8'))
      .accounts[setup.body.account.ownerId].devices[setup.body.device.id].enrolledAt, before)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined, current)).status, 401)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined,
      browser(origin, other.cookie!))).status, 401)
    release?.()
    const fresh = browser(origin, changed.cookie!, changed.body.csrfToken)
    const command = await api(origin, 'GET', `/personal/v1/commands/${accepted.body.command.commandId}`, undefined, fresh)
    assert.equal(command.body.command.state, 'rejected')
    assert.equal(command.body.command.errorCode, 'SESSION_REPLACED')
    assert.equal(f.calls.create, 0)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/devices', undefined, fresh)).body.devices
      .filter((device: { id: string, revoked: boolean }) => device.id === setup.body.device.id && !device.revoked).length, 1)
  } finally {
    release?.()
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('direct first registration, bounded profile image and device rename preserve one account across restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-profile-'))
  const f = backend()
  const publicOrigin = 'https://personal.example'
  const publicHeaders = { host: 'personal.example', origin: publicOrigin,
    'x-forwarded-host': 'personal.example', 'x-forwarded-proto': 'https' }
  let service = await createPersonalAccessService({ root, port: 0, backend: f,
    allowedOrigins: [publicOrigin], trustedProxy: true })
  try {
    let { origin } = await service.start()
    const registered = await proxyApi(origin, 'POST', '/personal/v1/auth/register',
      { username: 'Owner', password: PASSWORD, deviceName: 'First phone', displayName: '织语主人' }, publicHeaders)
    assert.equal(registered.status, 201)
    assert.equal(registered.body.account.displayName, '织语主人')
    assert.deepEqual(registered.body.account.avatar, null)
    assert.equal(registered.body.account.profileRevision, 0)
    assert.match(registered.cookie!, /; Secure(?:;|$)/)
    const another = await proxyApi(origin, 'POST', '/personal/v1/auth/register',
      { username: 'Another', password: PASSWORD, deviceName: 'Other' }, publicHeaders)
    assert.equal(another.status, 201)
    assert.notEqual(another.body.account.ownerId, registered.body.account.ownerId)
    const first = browser(origin, registered.cookie!, registered.body.csrfToken)
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='
    const changed = await api(origin, 'PATCH', '/personal/v1/auth/profile', {
      expectedRevision: 0, displayName: '我的 WeftMate', avatar: { mimeType: 'image/png', dataBase64: tinyPng },
    }, first)
    assert.equal(changed.status, 200)
    assert.equal(changed.body.account.displayName, '我的 WeftMate')
    assert.equal(changed.body.account.avatar.dataBase64, tinyPng)
    assert.equal(changed.body.account.profileRevision, 1)
    assert.equal((await api(origin, 'PATCH', '/personal/v1/auth/profile',
      { expectedRevision: 0, displayName: 'stale' }, first)).status, 409)
    assert.equal((await api(origin, 'PATCH', '/personal/v1/auth/profile',
      { expectedRevision: 1, avatar: { mimeType: 'image/png', dataBase64: Buffer.from('not an image').toString('base64') } }, first)).status, 400)
    const login = await api(origin, 'POST', '/personal/v1/auth/login',
      { username: 'Owner', password: PASSWORD, deviceName: 'Second phone' }, { origin })
    assert.equal(login.status, 200)
    const rename = await api(origin, 'PATCH', `/personal/v1/auth/devices/${login.body.device.id}`,
      { name: '随身手机' }, first)
    assert.equal(rename.status, 200)
    assert.equal(rename.body.device.name, '随身手机')
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/devices', undefined, first))
      .body.devices.find((device: { id: string }) => device.id === login.body.device.id).name, '随身手机')
    await service.close()
    service = await createPersonalAccessService({ root, port: 0, backend: f,
      allowedOrigins: [publicOrigin], trustedProxy: true })
    origin = (await service.start()).origin
    const me = await api(origin, 'GET', '/personal/v1/auth/me', undefined,
      { cookie: registered.cookie!.split(';')[0] })
    assert.equal(me.status, 200)
    assert.equal(me.body.account.displayName, '我的 WeftMate')
    assert.equal(me.body.account.profileRevision, 1)
    assert.equal(me.body.account.avatar.dataBase64, tinyPng)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('existing v2 account without profile fields keeps its login and gains default profile on read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-old-profile-'))
  const f = backend()
  let service = await createPersonalAccessService({ root, port: 0, backend: f })
  try {
    let { origin } = await service.start()
    const registered = await api(origin, 'POST', '/personal/v1/auth/register',
      { username: 'OldOwner', password: PASSWORD, deviceName: 'Original' }, { origin })
    assert.equal(registered.status, 201)
    await service.close()
    const file = join(root, 'store.json')
    const current = JSON.parse(readFileSync(file, 'utf8'))
    const ownerId = registered.body.account.ownerId
    const prior = { version: 2, hostId: current.hostId, ownerId, ...current.accounts[ownerId] }
    delete prior.account.displayName
    delete prior.account.avatar
    delete prior.account.profileRevision
    writeFileSync(file, JSON.stringify(prior))
    const oldSyncFile = join(root, 'sync', 'events.json')
    const oldSync = JSON.parse(readFileSync(oldSyncFile, 'utf8'))
    oldSync.ownerId = ownerId
    writeFileSync(oldSyncFile, JSON.stringify(oldSync))
    service = await createPersonalAccessService({ root, port: 0, backend: f })
    origin = (await service.start()).origin
    const me = await api(origin, 'GET', '/personal/v1/auth/me', undefined,
      { cookie: registered.cookie!.split(';')[0] })
    assert.equal(me.status, 200)
    assert.deepEqual(me.body.account, { username: 'OldOwner', ownerId,
      displayName: 'OldOwner', avatar: null, profileRevision: 0 })
    const changed = await api(origin, 'PATCH', '/personal/v1/auth/profile',
      { expectedRevision: 0, displayName: '新昵称' }, browser(origin, registered.cookie!, registered.body.csrfToken))
    assert.equal(changed.status, 200)
    assert.equal(changed.body.account.profileRevision, 1)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})
