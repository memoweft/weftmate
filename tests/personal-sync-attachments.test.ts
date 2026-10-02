import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { canonicalAttachmentMetadata, createAttachmentStore, MAX_ATTACHMENT_BYTES } from '../src/personal-sync/attachments.mjs'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const bytes = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const backend = { getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [], preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }: { sessionId: string }) => ({ sessionId }),
  sendMessage: async () => ({ accepted: true }), cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
  describeSession: async () => null, openDesktopApp: async () => ({ accepted: true }) }

test('owner-scoped image needs its exact message reference; retries, conflicts and restart stay safe', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-sync-images-'))
  let service = await createPersonalAccessService({ root, port: 0, backend })
  try {
    let { origin } = await service.start()
    const register = async (username: string) => {
      const response = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'synthetic owner password 123', deviceName: 'Phone' }) })
      assert.equal(response.status, 201)
      return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: (await response.json()).csrfToken }
    }
    const a = await register('OwnerA')
    const b = await register('OwnerB')
    const attachmentId = `attachment-${uuid(1)}`
    const conversationId = `conversation-${uuid(2)}`
    const messageId = `message-${uuid(3)}`
    const name = 'image one.png'
    const url = () => `${origin}/personal/v1/sync/attachments/${attachmentId}`
    const query = `?conversationId=${conversationId}&messageId=${messageId}&name=${encodeURIComponent(name)}`
    const upload = (account: typeof a, body = bytes, extra = '') => fetch(url() + query + extra, {
      method: 'PUT', headers: { origin, cookie: account.cookie, 'x-weftmate-csrf': account.csrf,
        'content-type': 'image/png', 'x-weftmate-sha256': sha256 }, body })
    const read = (account: typeof a) => fetch(url(), { headers: { cookie: account.cookie } })
    assert.equal((await read(a)).status, 404)
    assert.equal((await read(b)).status, 404)
    const first = await upload(a)
    assert.equal(first.status, 201)
    const attachment = (await first.json()).attachment
    assert.deepEqual(attachment, { attachmentId, name, contentType: 'image/png', size: bytes.length, sha256 })
    assert.equal((await read(a)).status, 404, 'unreferenced binary stays private')
    assert.equal((await upload(a)).status, 200, 'exact retry is idempotent')
    const displayBytes = Buffer.from('ffd8ff00ffd9', 'hex')
    const displayHash = createHash('sha256').update(displayBytes).digest('hex')
    const displayUrl = url() + `?conversationId=${conversationId}&messageId=${messageId}&variant=display`
    const displayUpload = (account: typeof a, body = displayBytes, target = displayUrl,
      hash = displayHash) => fetch(target, {
      method: 'PUT', headers: { origin, cookie: account.cookie, 'x-weftmate-csrf': account.csrf,
        'content-type': 'image/jpeg', 'x-weftmate-sha256': hash }, body })
    assert.equal((await displayUpload(b)).status, 404, 'another account cannot attach a display image')
    const firstDisplay = await displayUpload(a)
    assert.equal(firstDisplay.status, 201, 'display PUT works without name')
    assert.deepEqual((await firstDisplay.json()).display,
      { attachmentId, contentType: 'image/jpeg', size: displayBytes.length, sha256: displayHash })
    assert.equal((await displayUpload(a)).status, 200, 'display image retry is idempotent')
    assert.equal((await displayUpload(a, displayBytes, displayUrl + '&name=image%20one.png')).status,
      200, 'older display PUT with name stays compatible')
    const changedDisplay = Buffer.from('ffd8ff01ffd9', 'hex')
    assert.equal((await displayUpload(a, changedDisplay, displayUrl,
      createHash('sha256').update(changedDisplay).digest('hex'))).status, 409,
    'valid but different display bytes conflict')
    assert.equal((await displayUpload(a, displayBytes, displayUrl + '&unexpected=1')).status, 400)
    assert.equal((await displayUpload(a, displayBytes, displayUrl + '&name=a&name=b')).status, 400)
    assert.equal((await fetch(url() + `?conversationId=${conversationId}&messageId=${messageId}`, {
      method: 'PUT', headers: { origin, cookie: a.cookie, 'x-weftmate-csrf': a.csrf,
        'content-type': 'image/png', 'x-weftmate-sha256': sha256 }, body: bytes })).status,
    400, 'original PUT still requires name')
    const displayRead = (account: typeof a) => fetch(url() + '?variant=display',
      { headers: { cookie: account.cookie } })
    assert.equal((await displayRead(a)).status, 404, 'unreferenced display image stays private')
    assert.equal((await displayUpload(a, Buffer.from('ffd8ff01ffd9', 'hex'))).status, 400)
    const oversizedDisplay = await fetch(displayUrl, { method: 'PUT',
      headers: { origin, cookie: a.cookie, 'x-weftmate-csrf': a.csrf,
        'content-type': 'image/jpeg', 'x-weftmate-sha256': displayHash },
      body: Buffer.alloc(512 * 1024 + 1) })
    assert.equal(oversizedDisplay.status, 413)
    const wrongType = await fetch(url() + query, { method: 'PUT',
      headers: { origin, cookie: a.cookie, 'x-weftmate-csrf': a.csrf,
        'content-type': 'image/jpeg', 'x-weftmate-sha256': sha256 }, body: bytes })
    assert.equal(wrongType.status, 400, 'declared MIME must match image signature')
    const noCsrf = await fetch(url() + query, { method: 'PUT',
      headers: { origin, cookie: a.cookie, 'content-type': 'image/png',
        'x-weftmate-sha256': sha256 }, body: bytes })
    assert.equal(noCsrf.status, 403)
    assert.equal((await upload(a, Buffer.from('89504e470d0a1a0a01', 'hex'))).status, 400)
    const conflict = await fetch(url() + `?conversationId=${conversationId}&messageId=${messageId}&name=other.png`, {
      method: 'PUT', headers: { origin, cookie: a.cookie, 'x-weftmate-csrf': a.csrf,
        'content-type': 'image/png', 'x-weftmate-sha256': sha256 }, body: bytes })
    assert.equal(conflict.status, 409)
    const post = (account: typeof a, attachments: object[], id = messageId) =>
      fetch(`${origin}/personal/v1/sync/events`, { method: 'POST',
        headers: { origin, cookie: account.cookie, 'x-weftmate-csrf': account.csrf,
          'content-type': 'application/json' },
        body: JSON.stringify({ events: [{ eventId: `event-${uuid(4)}`, conversationId,
          clientSeq: 1, kind: 'message.created', occurredAt: '2026-09-27T10:00:00.000Z',
          payload: { messageId: id, role: 'user', text: '', attachments } }] }) })
    assert.equal((await post(a, [attachment], `message-${uuid(5)}`)).status, 400,
      'wrong message cannot claim uploaded binary')
    assert.equal((await post(b, [attachment])).status, 400, 'another account cannot claim binary')
    const accepted = await post(a, [attachment])
    assert.equal(accepted.status, 200)
    assert.equal((await post(a, [attachment])).status, 200, 'event retry succeeds')
    const shown = await read(a)
    assert.equal(shown.status, 200)
    assert.equal(shown.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await shown.arrayBuffer()), bytes)
    assert.equal((await read(b)).status, 404)
    const shownDisplay = await displayRead(a)
    assert.equal(shownDisplay.status, 200)
    assert.equal(shownDisplay.headers.get('content-length'), String(displayBytes.length))
    assert.deepEqual(Buffer.from(await shownDisplay.arrayBuffer()), displayBytes)
    assert.equal((await displayRead(b)).status, 404)
    const larger = Buffer.alloc(6 * 1024 * 1024)
    bytes.copy(larger)
    bytes.subarray(-12).copy(larger, larger.length - 12)
    const largeId = `attachment-${uuid(7)}`
    const largeMessageId = `message-${uuid(8)}`
    const largeQuery = `?conversationId=${conversationId}&messageId=${largeMessageId}&name=large.png`
    const largeUrl = `${origin}/personal/v1/sync/attachments/${largeId}`
    const largeHash = createHash('sha256').update(larger).digest('hex')
    const largeUpload = await fetch(largeUrl + largeQuery, {
      method: 'PUT', headers: { origin, cookie: a.cookie, 'x-weftmate-csrf': a.csrf,
        'content-type': 'image/png', 'x-weftmate-sha256': largeHash },
      body: larger })
    assert.equal(largeUpload.status, 201, 'image larger than the old 5 MiB cap uploads')
    const largeAttachment = (await largeUpload.json()).attachment
    assert.equal(largeAttachment.size, larger.length)
    assert.equal((await fetch(largeUrl + largeQuery, { method: 'PUT',
      headers: { origin, cookie: a.cookie, 'x-weftmate-csrf': a.csrf,
        'content-type': 'image/png', 'x-weftmate-sha256': largeHash }, body: larger })).status, 200)
    const largeEvent = await fetch(`${origin}/personal/v1/sync/events`, { method: 'POST',
      headers: { origin, cookie: a.cookie, 'x-weftmate-csrf': a.csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ eventId: `event-${uuid(9)}`, conversationId,
        clientSeq: 2, kind: 'message.created', occurredAt: '2026-09-27T10:00:01.000Z',
        payload: { messageId: largeMessageId, role: 'user', text: '', attachments: [largeAttachment] } }] }) })
    assert.equal(largeEvent.status, 200)
    const largeDownload = await fetch(largeUrl, { headers: { cookie: a.cookie } })
    assert.equal(largeDownload.status, 200)
    assert.equal(createHash('sha256').update(Buffer.from(await largeDownload.arrayBuffer())).digest('hex'), largeHash)
    assert.equal((await fetch(largeUrl + '?variant=display', { headers: { cookie: a.cookie } })).status, 404)
    assert.equal((await fetch(largeUrl, { headers: { cookie: b.cookie } })).status, 404)
    const partialId = `attachment-${uuid(6)}`
    const partialUrl = `${origin}/personal/v1/sync/attachments/${partialId}${query}`
    await new Promise<void>((resolve) => {
      const request = httpRequest(partialUrl, { method: 'PUT', headers: {
        origin, cookie: a.cookie, 'x-weftmate-csrf': a.csrf, 'content-type': 'image/png',
        'x-weftmate-sha256': sha256, 'content-length': String(bytes.length),
      } })
      request.on('error', () => resolve())
      request.write(bytes.subarray(0, 7), () => { request.destroy(); resolve() })
    })
    await service.close()
    service = await createPersonalAccessService({ root, port: 0, backend })
    origin = (await service.start()).origin
    assert.equal((await read(a)).status, 200, 'referenced image survives restart')
    assert.equal((await read(b)).status, 404)
    const completeAfterPartial = await fetch(`${origin}/personal/v1/sync/attachments/${partialId}${query}`, {
      method: 'PUT', headers: { origin, cookie: a.cookie, 'x-weftmate-csrf': a.csrf,
        'content-type': 'image/png', 'x-weftmate-sha256': sha256 }, body: bytes })
    assert.equal(completeAfterPartial.status, 201, 'incomplete request left no committed image')
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('legacy small image remains readable and failed stream leaves no temp file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-sync-legacy-'))
  try {
    const store = await createAttachmentStore({ root })
    const attachmentId = `attachment-${uuid(30)}`
    const conversationId = `conversation-${uuid(31)}`
    const messageId = `message-${uuid(32)}`
    const meta = { attachmentId, name: 'old.png', contentType: 'image/png', size: bytes.length, sha256 }
    const header = Buffer.from(JSON.stringify({ ...meta, conversationId, messageId }))
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length)
    writeFileSync(join(root, `${attachmentId}.image`), Buffer.concat([prefix, header, bytes]))
    const found = await store.get(attachmentId)
    assert.deepEqual(found.meta, meta)
    assert.equal(found.offset, 4 + header.length)
    const interruptedId = `attachment-${uuid(33)}`
    async function* interrupted() {
      yield bytes.subarray(0, 8)
      throw Error('client disconnected')
    }
    await assert.rejects(store.put({ attachmentId: interruptedId, conversationId, messageId,
      name: 'partial.png', contentType: 'image/png', sha256, stream: interrupted() }))
    assert.equal(readdirSync(root).some((entry) => entry.includes(interruptedId)), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('attachment metadata permits exactly 1 GiB and rejects the next byte', () => {
  const meta = { attachmentId: `attachment-${uuid(20)}`, name: 'original.png',
    contentType: 'image/png', size: MAX_ATTACHMENT_BYTES, sha256 }
  assert.equal(canonicalAttachmentMetadata(meta).size, 1024 * 1024 * 1024)
  assert.throws(() => canonicalAttachmentMetadata({ ...meta, size: MAX_ATTACHMENT_BYTES + 1 }))
})
