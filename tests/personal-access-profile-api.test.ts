import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { servePersonalAccessUi } from '../src/personal-access-ui/index.mjs'

const assets = new URL('./fixtures/personal-access-profile/', import.meta.url)
const password = 'Synthetic-only-profile-API-2026!'

function backend() {
  return {
    async getStatus() { return { runtime: 'ready', referenceScan: 'ready', capabilities: { chat: { available: true } } } },
    async listModels() { return [] },
    async preflight() { return { ok: true } },
    async createSession({ sessionId }: { sessionId: string }) { return { sessionId } },
    async sendMessage() { return { accepted: true } },
    async cancelSession() { return { accepted: true } },
    async readEvents({ afterSeq }: { afterSeq: number }) { return { events: [], nextSeq: afterSeq, hasMore: false } },
    async describeSession() { return null },
  }
}

async function api(origin: string, method: string, path: string, body?: object,
  session?: { cookie: string; csrf: string }) {
  let response: Response
  try {
    response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { origin } : {}),
        ...(session ? { cookie: session.cookie, 'x-weftmate-csrf': session.csrf } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    throw new Error(`${method} ${path} failed: ${String(error)}`)
  }
  const text = await response.text()
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookie: response.headers.getSetCookie()[0]?.split(';')[0] ?? null,
    headers: response.headers,
  }
}

function sessionOf(result: Awaited<ReturnType<typeof api>>) {
  assert.equal(typeof result.body.csrfToken, 'string')
  assert.ok(result.cookie)
  return { cookie: result.cookie as string, csrf: result.body.csrfToken as string }
}

test('real account API preserves profile revision, avatar limits, device rename and revoke receipt', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'profile-ui-api-'))
  const apk = join(root, 'android-candidate.apk')
  writeFileSync(apk, Buffer.from('SYNTHETIC_FIXTURE_NOT_INSTALLABLE'))
  const service = await createPersonalAccessService({ root, port: 0, backend: backend(),
    uiHandler: servePersonalAccessUi, androidPackagePath: apk })
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  const { origin } = await service.start()

  const registeredA = await api(origin, 'POST', '/personal/v1/auth/register', {
    username: 'ProfileFixtureA', password, deviceName: '合成桌面 A', displayName: '合成账户 A',
  })
  assert.equal(registeredA.status, 201)
  const a = sessionOf(registeredA)
  const ownerA = registeredA.body.account.ownerId
  const registeredB = await api(origin, 'POST', '/personal/v1/auth/register', {
    username: 'ProfileFixtureB', password, deviceName: '合成桌面 B', displayName: '合成账户 B',
  })
  assert.equal(registeredB.status, 201)
  const ownerB = registeredB.body.account.ownerId
  assert.notEqual(ownerA, ownerB)

  const loginASecondDevice = await api(origin, 'POST', '/personal/v1/auth/login', {
    username: 'ProfileFixtureA', password, deviceName: '合成手机 A',
  })
  assert.equal(loginASecondDevice.status, 200)
  const aSecond = sessionOf(loginASecondDevice)

  const initial = await api(origin, 'GET', '/personal/v1/auth/me', undefined, a)
  assert.equal(initial.body.account.profileRevision, 0)
  assert.equal(initial.body.account.avatar, null)
  assert.equal(initial.body.account.ownerId, ownerA)
  assert.notEqual(initial.body.account.ownerId, ownerB)

  const png = readFileSync(new URL('synthetic-avatar.png', assets)).toString('base64')
  const changed = await api(origin, 'PATCH', '/personal/v1/auth/profile', {
    expectedRevision: 0, displayName: '新昵称 A', avatar: { mimeType: 'image/png', dataBase64: png },
  }, a)
  assert.equal(changed.status, 200)
  assert.deepEqual(changed.body.account.avatar, { mimeType: 'image/png', dataBase64: png })
  assert.equal(changed.body.account.displayName, '新昵称 A')
  assert.equal(changed.body.account.profileRevision, 1)

  const stale = await api(origin, 'PATCH', '/personal/v1/auth/profile', {
    expectedRevision: 0, displayName: '旧设备的过期昵称',
  }, aSecond)
  assert.equal(stale.status, 409)
  const readback = await api(origin, 'GET', '/personal/v1/auth/me', undefined, aSecond)
  assert.equal(readback.body.account.displayName, '新昵称 A')
  assert.equal(readback.body.account.profileRevision, 1)

  const removed = await api(origin, 'PATCH', '/personal/v1/auth/profile', {
    expectedRevision: 1, avatar: null,
  }, aSecond)
  assert.equal(removed.status, 200)
  assert.equal(removed.body.account.avatar, null)
  assert.equal(removed.body.account.profileRevision, 2)

  const renameId = registeredA.body.device.id
  const rename = await api(origin, 'PATCH', `/personal/v1/auth/devices/${renameId}`, { name: '改过名的合成桌面' }, a)
  assert.equal(rename.status, 200)
  assert.deepEqual(rename.body.device, { id: renameId, name: '改过名的合成桌面', revoked: false })
  const devices = await api(origin, 'GET', '/personal/v1/auth/devices', undefined, aSecond)
  assert.equal(devices.body.devices.find((device: { id: string }) => device.id === renameId).name, '改过名的合成桌面')

  const revokeId = loginASecondDevice.body.device.id
  const revoke = await api(origin, 'DELETE', `/personal/v1/auth/devices/${revokeId}`, undefined, a)
  assert.equal(revoke.status, 200)
  assert.deepEqual(revoke.body, { revoked: true })
  assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined, aSecond)).status, 401)

  const supportedTypes = ['image/jpeg', 'image/webp']
  let avatarRevision = 2
  for (const type of supportedTypes) {
    const bytes = readFileSync(new URL(`synthetic-avatar.${type === 'image/jpeg' ? 'jpg' : 'webp'}`, assets))
    const update = await api(origin, 'PATCH', '/personal/v1/auth/profile', {
      expectedRevision: avatarRevision, avatar: { mimeType: type, dataBase64: bytes.toString('base64') },
    }, a)
    assert.equal(update.status, 200, `${type} should be accepted`)
    assert.equal(update.body.account.avatar.mimeType, type)
    avatarRevision++
  }
  const unsupported = await api(origin, 'PATCH', '/personal/v1/auth/profile', {
    expectedRevision: avatarRevision, avatar: { mimeType: 'image/svg+xml',
      dataBase64: readFileSync(new URL('unsupported-avatar.svg', assets)).toString('base64') },
  }, a)
  assert.equal(unsupported.status, 400)
  const oversize = await api(origin, 'PATCH', '/personal/v1/auth/profile', {
    expectedRevision: avatarRevision, avatar: { mimeType: 'image/png',
      dataBase64: readFileSync(new URL('oversized-under-body-ceiling.png', assets)).toString('base64') },
  }, a)
  assert.equal(oversize.status, 400, 'avatar bytes above 128 KiB are rejected before decoding')

  const page = await fetch(`${origin}/personal/v1/ui`)
  assert.equal(page.status, 200)
  const csp = page.headers.get('content-security-policy') ?? ''
  assert.match(csp, /default-src 'none'/)
  assert.match(csp, /img-src 'self' data: blob:/)
  assert.equal((await fetch(`${origin}/personal/v1/downloads/android`, { headers: { cookie: a.cookie } })).status, 200)
})
