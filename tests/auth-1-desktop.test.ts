import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { createAuthenticationOperations } from '../src/personal-access/authentication.mjs'
import { nativeWindowRequest } from '../src/personal-desktop-request.mjs'

test('AUTH-1 only the native own main frame receives its capability; subframes and foreign origins do not', () => {
  const origin = 'http://127.0.0.1:39111', frame = { url: origin + '/personal/v1/ui' }
  const window = { webContents: { id: 7, mainFrame: frame } }
  const details = { webContentsId: 7, frame, initiatorOrigin: origin, url: origin + '/personal/v1/auth/desktop' }
  assert.equal(nativeWindowRequest(details, window, origin), true)
  const terminal = origin.replace('http:', 'ws:') + '/personal/v1/terminals/terminal-00000000-0000-4000-8000-000000000001/connect'
  assert.equal(nativeWindowRequest({ ...details, url: terminal }, window, origin), true)
  assert.equal(nativeWindowRequest({ ...details, url: terminal, frame: null }, window, origin), false)
  assert.equal(nativeWindowRequest({ ...details, url: origin.replace('http:', 'ws:') + '/personal/v1/auth/desktop' }, window, origin), false)
  for (const changed of [{ frame: null }, { frame: { url: frame.url } }, { webContentsId: 8 },
    { initiatorOrigin: 'https://public.example.invalid' }, { url: 'https://public.example.invalid/personal/v1/auth/desktop' }])
    assert.equal(nativeWindowRequest({ ...details, ...changed }, window, origin), false)
})

test('native request queued during window teardown does not throw or receive a desktop capability', () => {
  const origin = 'http://127.0.0.1:39111', frame = { url: origin + '/personal/v1/ui' }
  const details = { webContentsId: 7, frame, initiatorOrigin: origin, url: origin + '/personal/v1/auth/desktop' }
  // Electron keeps the session listener alive while app.exit() destroys the
  // window. A request already queued by Chromium can then see null webContents.
  assert.equal(nativeWindowRequest(details, { webContents: null }, origin), false)
})

const backend = { getStatus: async () => ({ runtime: 'ready' }), listModels: async () => [],
  preflight: async () => ({ ok: true }), createSession: async () => ({}), sendMessage: async () => ({}),
  cancelSession: async () => ({}), readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }),
  describeSession: async (sessionId: string) => ({ sessionId, title: '保留的合成对话' }) }

test('AUTH-1 native window preserves original owner/data/password and remembers multi-account selection', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-auth1-local-')))
  let service = await createPersonalAccessService({ root, port: 0, backend,
    allowedOrigins: ['https://relay.example.invalid'], trustedProxy: true })
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }) })
  let started = await service.start()
  const api = async (path: string, body?: object, headers: Record<string, string> = {}) => {
    const response = await fetch(started.origin + '/personal/v1/auth' + path, {
      method: body ? 'POST' : 'GET', headers: { origin: started.origin,
        ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  const grant = await service.issueSetupGrant()
  const first = await api('/setup', { grant: grant.grant, username: 'original-owner', password: 'synthetic original password', deviceName: 'synthetic-old-desktop' })
  assert.equal(first.status, 201)
  const remote = { host: 'relay.example.invalid', origin: 'https://relay.example.invalid',
    'x-forwarded-host': 'relay.example.invalid', 'x-forwarded-proto': 'https' }
  assert.equal((await api('/login', { username: 'original-owner', password: 'synthetic original password', deviceName: 'Remote' }, remote)).status, 403)
  assert.equal((await api('/register', { username: 'remote-owner', password: 'synthetic original password', deviceName: 'Remote' }, remote)).status, 403)
  assert.equal((await api('/me', undefined, { ...remote, cookie: first.cookie! })).status, 403)
  await service.attachSession('preserved-session')
  const before = JSON.parse(await readFile(join(root, 'store.json'), 'utf8'))
  const second = await api('/register', { username: 'second-owner', password: 'synthetic second password', deviceName: 'synthetic-second' })
  assert.equal(second.status, 201)
  let native = { 'x-weftmate-desktop': service.libraryDesktopToken }
  const session = await api('/desktop', {}, native)
  assert.equal(session.status, 200)
  assert.equal(session.body.account.ownerId, first.body.account.ownerId)
  assert.equal(session.body.local, true)
  assert.equal(session.body.device.authKind, 'desktop')
  assert.equal((await api('/me', undefined, { ...native, cookie: session.cookie! })).status, 200)
  // Even an actual local-session Cookie is unusable in an ordinary webpage.
  assert.equal((await api('/me', undefined, { cookie: session.cookie! })).status, 403)
  for (const headers of [{}, { 'x-forwarded-for': '192.0.2.1' }, { forwarded: 'for=192.0.2.1' },
    { origin: 'https://public.example.invalid' }]) {
    assert.equal((await api('/desktop', {}, { ...native, ...headers, ...(Object.keys(headers).length ? {} : { 'x-weftmate-desktop': 'wrong' }) })).status, 403)
  }
  assert.equal((await api('/desktop', { ownerId: second.body.account.ownerId }, native)).body.account.ownerId, second.body.account.ownerId)
  assert.equal((await api('/desktop', undefined, native)).body.selectedOwnerId, second.body.account.ownerId)
  const after = JSON.parse(await readFile(join(root, 'store.json'), 'utf8'))
  assert.deepEqual(after.accounts[first.body.account.ownerId].account.password, before.accounts[first.body.account.ownerId].account.password)
  assert.ok(after.accounts[first.body.account.ownerId].sessions['preserved-session'])
  await service.close()
  service = await createPersonalAccessService({ root, port: 0, backend }); started = await service.start()
  native = { 'x-weftmate-desktop': service.libraryDesktopToken }
  assert.equal((await api('/desktop', {}, native)).body.account.ownerId, second.body.account.ownerId)
})

test('AUTH-1 native capability rejects non-loopback/public/relay/forwarded requests', () => {
  const origin = 'http://127.0.0.1:39111'
  const context: any = { origin, allowedOrigins: ['https://relay.example.invalid'], trustedProxy: true, libraryDesktopToken: 'synthetic-native-capability' }
  const { requireLocalDesktop } = createAuthenticationOperations(context)
  const request: any = { headers: { host: '127.0.0.1:39111', origin, 'x-weftmate-desktop': context.libraryDesktopToken }, socket: { remoteAddress: '127.0.0.1' } }
  requireLocalDesktop(request)
  for (const candidate of [
    { ...request, socket: { remoteAddress: '192.0.2.5' } },
    { ...request, headers: { ...request.headers, forwarded: 'for=192.0.2.5' } },
    { ...request, headers: { ...request.headers, 'x-forwarded-for': '192.0.2.5' } },
    { ...request, headers: { ...request.headers, host: 'relay.example.invalid', origin: 'https://relay.example.invalid', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'relay.example.invalid' } },
    { ...request, headers: { ...request.headers, origin: 'https://public.example.invalid' } },
    { ...request, headers: { ...request.headers, 'x-weftmate-desktop': undefined } },
  ]) assert.throws(() => requireLocalDesktop(candidate), (e: any) => e.status === 403)
})

test('AUTH-1 first native launch creates account in the existing legacy owner without a user password', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-auth1-first-')))
  const service = await createPersonalAccessService({ root, port: 0, backend })
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }) })
  const { origin, ownerId } = await service.start()
  await service.attachSession('legacy-content')
  const response = await fetch(origin + '/personal/v1/auth/desktop', { method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-weftmate-desktop': service.libraryDesktopToken }, body: '{}' })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).account.ownerId, ownerId)
  const state = JSON.parse(await readFile(join(root, 'store.json'), 'utf8'))
  assert.equal(Object.keys(state.accounts).length, 1)
  assert.ok(state.accounts[ownerId].sessions['legacy-content'])
})
