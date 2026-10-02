import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalSyncStore } from '../src/personal-sync/index.mjs'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const event = (n: number, clientSeq = n) => ({ eventId: `event-${uuid(n)}`,
  conversationId: `conversation-${uuid(100)}`, clientSeq, kind: 'message.created',
  occurredAt: '2026-09-26T13:00:00.000Z',
  payload: { messageId: `message-${uuid(n)}`, role: n % 2 ? 'user' : 'assistant', text: `synthetic ${n}` } })

test('offline events can attach later without reordering server seq; duplicates and conflicts survive restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-sync-store-'))
  try {
    const store = await createPersonalSyncStore({ root, ownerId: 'owner-test' })
    assert.deepEqual((await store.append({ events: [event(4), event(5)], sourceDeviceId: 'device-one' })).accepted
      .map((item: { seq: number }) => item.seq), [1, 2])
    assert.deepEqual((await store.append({ events: [event(1), event(2), event(3)], sourceDeviceId: 'device-one' })).accepted
      .map((item: { seq: number }) => item.seq), [3, 4, 5])
    assert.deepEqual(store.page({ afterSeq: 0, limit: 2 }), {
      events: [
        { seq: 1, sourceDeviceId: 'device-one', ...event(4) },
        { seq: 2, sourceDeviceId: 'device-one', ...event(5) },
      ], nextSeq: 2, hasMore: true,
    })
    assert.equal(store.page({ afterSeq: 2, limit: 3 }).events.at(-1).eventId, event(3).eventId)
    await store.close()

    const restored = await createPersonalSyncStore({ root, ownerId: 'owner-test' })
    const duplicate = await restored.append({ events: [event(1)], sourceDeviceId: 'device-two' })
    assert.deepEqual(duplicate, { accepted: [{ eventId: event(1).eventId, seq: 3, duplicate: true }], lastSeq: 5 })
    assert.equal(restored.page({ afterSeq: 2, limit: 1 }).events[0].sourceDeviceId, 'device-one')
    await assert.rejects(restored.append({ events: [event(6, 6), { ...event(1),
      payload: { ...event(1).payload, text: 'changed' } }], sourceDeviceId: 'device-one' }),
    (error: { code: string; status: number }) => error.code === 'REQUEST_CONFLICT' && error.status === 409)
    await assert.rejects(restored.append({ events: [event(7, 4)], sourceDeviceId: 'device-one' }),
      (error: { code: string; status: number }) => error.code === 'REQUEST_CONFLICT' && error.status === 409)
    assert.equal(restored.page({ afterSeq: 0, limit: 20 }).events.length, 5, 'conflicting batches write nothing')
    await restored.close()
    await assert.rejects(createPersonalSyncStore({ root, ownerId: 'different-owner' }),
      (error: { code: string }) => error.code === 'SYNC_STORE_CORRUPT')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('sync payload validation refuses execution fields and oversized text', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-sync-invalid-'))
  try {
    const store = await createPersonalSyncStore({ root, ownerId: 'owner-test' })
    await assert.rejects(store.append({ events: [{ ...event(1), targetDeviceId: 'host' }], sourceDeviceId: 'device-one' }),
      (error: { code: string }) => error.code === 'INVALID_REQUEST')
    await assert.rejects(store.append({ events: [{ ...event(1), kind: 'desktop.open_app' }], sourceDeviceId: 'device-one' }),
      (error: { code: string }) => error.code === 'INVALID_REQUEST')
    await assert.rejects(store.append({ events: [{ ...event(1), payload: { ...event(1).payload, text: 'x'.repeat(16_385) } }],
      sourceDeviceId: 'device-one' }), (error: { code: string }) => error.code === 'INVALID_REQUEST')
    assert.equal(store.page().events.length, 0)
    await store.close()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('authorization lost immediately before atomic commit does not poison sync storage for another device', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-sync-reauth-'))
  try {
    const store = await createPersonalSyncStore({ root, ownerId: 'owner-test' })
    let checks = 0
    await assert.rejects(store.append({ events: [event(1)], sourceDeviceId: 'device-revoked', authorize: () => {
      checks++
      if (checks === 3) throw Object.assign(new Error('authorization expired'), { code: 'UNAUTHORIZED', status: 401 })
    } }), (error: { code: string }) => error.code === 'UNAUTHORIZED')
    assert.equal(checks, 3, 'the last authorization check is inside the atomic replacement boundary')
    assert.equal(store.page().events.length, 0)
    const active = await store.append({ events: [event(2)], sourceDeviceId: 'device-active' })
    assert.equal(active.accepted[0].seq, 1)
    await store.close()
    const recovered = await createPersonalSyncStore({ root, ownerId: 'owner-test' })
    assert.equal(recovered.page().events[0].sourceDeviceId, 'device-active')
    await recovered.close()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('authenticated sync is shared by account devices, refuses revoked devices and never dispatches model actions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-sync-http-'))
  let dispatched = 0
  const packagePath = join(root, 'android-candidate.apk')
  writeFileSync(packagePath, Buffer.from('synthetic APK fixture'))
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [], preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId }: { sessionId: string }) => ({ sessionId }),
    sendMessage: async () => { dispatched++; return { accepted: true } },
    cancelSession: async () => ({ accepted: true }),
    readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async () => null,
    openDesktopApp: async () => { dispatched++; return { accepted: true } },
  }
  let service = await createPersonalAccessService({ root, port: 0, backend, androidPackagePath: packagePath })
  try {
    let { origin } = await service.start()
    const grant = await service.issueSetupGrant()
    const account = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: 'Synthetic', password: 'synthetic owner password 123', deviceName: 'PC' }) })
    assert.equal(account.status, 201)
    const one = { cookie: account.headers.get('set-cookie')!.split(';')[0], body: await account.json() }
    assert.equal((await fetch(`${origin}/personal/v1/downloads/android`)).status, 401)
    const download = await fetch(`${origin}/personal/v1/downloads/android`, { headers: { cookie: one.cookie } })
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('content-type'), 'application/vnd.android.package-archive')
    assert.equal(await download.text(), 'synthetic APK fixture')
    const login = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Synthetic', password: 'synthetic owner password 123', deviceName: 'Phone' }) })
    assert.equal(login.status, 200)
    const two = { cookie: login.headers.get('set-cookie')!.split(';')[0], body: await login.json() }
    const post = (cookie: string, csrf: string, events: object[]) => fetch(`${origin}/personal/v1/sync/events`, {
      method: 'POST', headers: { origin, cookie, 'x-weftmate-csrf': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
    })
    const posted = await post(two.cookie, two.body.csrfToken, [event(4), event(5)])
    assert.equal(posted.status, 200)
    assert.deepEqual((await posted.json()).accepted.map((row: { duplicate: boolean }) => row.duplicate), [false, false])
    const later = await post(two.cookie, two.body.csrfToken, [event(1), event(2), event(3)])
    assert.equal(later.status, 200)
    const get = (cookie: string, after = 0) => fetch(`${origin}/personal/v1/sync/events?afterSeq=${after}&limit=2`, { headers: { cookie } })
    const first = await get(one.cookie)
    assert.equal(first.status, 200)
    const page = await first.json()
    assert.deepEqual(page.events.map((row: { sourceDeviceId: string }) => row.sourceDeviceId),
      [two.body.device.id, two.body.device.id])
    assert.equal(page.nextSeq, 2)
    assert.equal(page.hasMore, true)
    assert.equal((await (await get(one.cookie, 4)).json()).events[0].eventId, event(3).eventId)
    const conflict = await post(two.cookie, two.body.csrfToken, [event(6), { ...event(2),
      payload: { ...event(2).payload, text: 'changed' } }])
    assert.equal(conflict.status, 409)
    assert.equal((await conflict.json()).error.code, 'REQUEST_CONFLICT')
    assert.equal((await (await get(one.cookie, 4)).json()).events.length, 1)
    assert.equal(dispatched, 0)
    let finishSlow!: () => void
    const slowResponse = new Promise<{ status: number; body: any }>((resolve, reject) => {
      const upload = httpRequest(`${origin}/personal/v1/sync/events`, { method: 'POST',
        headers: { origin, cookie: two.cookie, 'x-weftmate-csrf': two.body.csrfToken,
          'content-type': 'application/json' } }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
      })
      upload.on('error', reject)
      upload.write('{"events":[')
      finishSlow = () => upload.end(`${JSON.stringify(event(6))}]}`)
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await service.revokeDevice(two.body.device.id)
    finishSlow()
    const slow = await slowResponse
    assert.equal(slow.status, 401, 'a device revoked while its upload body is incomplete cannot commit later')
    assert.equal((await (await get(one.cookie, 4)).json()).events.length, 1)
    assert.equal((await get(two.cookie)).status, 401)
    rmSync(packagePath)
    assert.equal((await fetch(`${origin}/personal/v1/downloads/android`, { headers: { cookie: one.cookie } })).status, 404)
    const status = await fetch(`${origin}/personal/v1/status`, { headers: { cookie: one.cookie } })
    assert.deepEqual((await status.json()).downloads, { android: false })
    await service.close()
    service = await createPersonalAccessService({ root, port: 0, backend, androidPackagePath: packagePath })
    origin = (await service.start()).origin
    assert.equal((await (await get(one.cookie, 4)).json()).events[0].eventId, event(3).eventId)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})
