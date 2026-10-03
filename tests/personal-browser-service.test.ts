import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const password = 'correct horse battery staple'
async function request(origin: string, auth: Record<string, string>, method: string, route: string, body?: object) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json() }
}
async function settled(origin: string, auth: Record<string, string>, commandId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const read = await request(origin, auth, 'GET', `/personal/v1/commands/${commandId}`)
    if (!['pending', 'dispatching'].includes(read.body.command.state)) return read.body.command
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('browser command did not settle')
}

test('browser workspace freezes human URLs, follows only observed links, and saves proven source', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'weft-browser-service-'))
  assert.ok(resolve(profile).startsWith(resolve(tmpdir())))
  const sessions = new Set<string>()
  const reads: string[] = []
  const cancelled: string[] = []
  const proofs: object[] = []
  let allowProof = true
  let receipt = 0
  const browserReader = {
    status: () => ({ available: true, activeReads: 0 }),
    canonicalUrl: (input: string) => new URL(input).toString(),
    cancelTask: (_ownerId: string, taskId: string) => { cancelled.push(taskId) },
    close: async () => {},
    read: async ({ url }: { url: string }) => {
      reads.push(url)
      return { requestedUrl: url, url, title: url.endsWith('/first') ? '第一页' : '第二页',
        text: url.endsWith('/first') ? '浏览器渲染后的第一页正文' : '第二页正文',
        truncated: false, links: url.endsWith('/first')
          ? [{ url: 'https://public.test-domain.com/second', label: '继续阅读' }] : [] }
    },
  }
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [{ id: 'local', name: 'Local', model: 'synthetic', configured: true }],
    preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId }: { sessionId: string }) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async () => ({ accepted: true, receiptId: `receipt-${++receipt}` }),
    cancelSession: async () => { throw new Error('session-wide cancel forbidden') },
    readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, agentPreset: 'personal-remote', modelProfileId: 'local', running: false } : null,
  }
  const verifyToolResult = async (input: object) => { proofs.push(input); return allowProof }
  let service = await createPersonalAccessService({ root: profile, port: 0, backend,
    browserReader, verifyToolResult })
  try {
    let { origin, hostId } = await service.start()
    const grant = await service.issueSetupGrant()
    assert.equal((await request(origin, { origin }, 'POST', '/personal/v1/auth/setup',
      { grant: grant.grant, username: 'Owner', password, deviceName: 'Desktop' })).status, 201)
    const login = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Owner', password, deviceName: 'Phone' }) })
    const auth = { origin, cookie: login.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': (await login.json()).csrfToken }
    const available = await request(origin, auth, 'GET', '/personal/v1/workspaces/browser')
    assert.equal(available.body.available, true)
    const created = await request(origin, auth, 'POST', '/personal/v1/workspaces/browser/sessions',
      { requestId: 'browser-session', modelProfileId: 'local' })
    assert.equal(created.status, 202, JSON.stringify(created.body))
    const session = await settled(origin, auth, created.body.command.commandId)
    assert.equal(session.workspaceKind, 'browser')
    const sessionId = session.sessionId
    const goal = '请阅读 https://public.test-domain.com/first。分别确认正文并沿页内链接继续。'
    const sent = await request(origin, auth, 'POST', '/personal/v1/commands',
      { requestId: 'browser-goal', kind: 'session.message', targetDeviceId: hostId,
        sessionId, text: goal })
    assert.equal(sent.status, 202, JSON.stringify(sent.body))
    const source = await settled(origin, auth, sent.body.command.commandId)
    assert.equal(source.workspaceKind, 'browser')
    assert.equal(source.receiptId, 'receipt-1')
    const first = await service.submitToolBrowser({ action: 'open_page', sessionId, turn: 1,
      callId: 'read-first', messageHash: sha(goal), receiptId: source.receiptId,
      url: 'https://public.test-domain.com/first' })
    assert.match(first.snapshotId, /^source-[a-f0-9]{48}$/)
    assert.equal(first.links.length, 1)
    assert.match(first.links[0].linkId, /^link-[a-f0-9]{40}$/)
    assert.equal((await service.submitToolBrowser({ action: 'open_page', sessionId, turn: 1,
      callId: 'read-first', messageHash: sha(goal), receiptId: source.receiptId,
      url: 'https://public.test-domain.com/first' })).snapshotId, first.snapshotId)
    assert.equal(reads.length, 1)
    await assert.rejects(service.submitToolBrowser({ action: 'open_page', sessionId, turn: 1,
      callId: 'unapproved', messageHash: sha(goal), receiptId: source.receiptId,
      url: 'https://public.test-domain.com/other' }),
    (error: { code?: string }) => error.code === 'BROWSER_SOURCE_UNVERIFIED')
    const second = await service.submitToolBrowser({ action: 'follow_link', sessionId, turn: 1,
      callId: 'read-second', messageHash: sha(goal), receiptId: source.receiptId,
      snapshotId: first.snapshotId, linkId: first.links[0].linkId })
    assert.match(second.text, /第二页正文/)
    assert.equal(reads.length, 2)
    allowProof = false
    await assert.rejects(service.submitToolArtifact({ sessionId, turn: 1, callId: 'save-unproven',
      messageHash: sha(goal), receiptId: source.receiptId,
      sourceSnapshotIds: [first.snapshotId, second.snapshotId],
      fileName: 'wrong.md', content: '# Wrong' }),
    (error: { code?: string }) => error.code === 'BROWSER_SOURCE_UNVERIFIED')
    allowProof = true
    const artifact = await service.submitToolArtifact({ sessionId, turn: 1, callId: 'save-proven',
      messageHash: sha(goal), receiptId: source.receiptId,
      sourceSnapshotIds: [first.snapshotId, second.snapshotId],
      fileName: 'summary.md', content: '# Summary\nTwo pages.' })
    assert.equal(artifact.state, 'observed')
    assert.deepEqual(new Set(artifact.sourceSnapshotIds), new Set([first.snapshotId, second.snapshotId]))
    assert.ok(proofs.some((input: any) => input.readTool === 'personal_browser_open'))
    assert.ok(proofs.some((input: any) => input.readTool === 'personal_browser_follow'))
    const detail = await request(origin, auth, 'GET', `/personal/v1/tasks/${source.commandId}`)
    assert.equal(detail.body.workspace.kind, 'browser')
    assert.equal(detail.body.sources.filter((item: any) => item.cited).length, 2)
    const opened = await request(origin, auth, 'GET',
      `/personal/v1/tasks/${source.commandId}/sources/${first.snapshotId}`)
    assert.match(opened.body.source.text, /渲染后/)
    assert.equal(opened.body.source.kind, 'webpage')
    assert.equal(opened.body.source.fileSha256, opened.body.source.contentSha256)
    assert.equal(opened.body.source.fileSha256, sha(opened.body.source.text))
    const preview = await request(origin, auth, 'GET',
      `/personal/v1/artifacts/${artifact.artifactId}/preview`)
    assert.match(preview.body.text, /已读取网页来源.*第一页.*第二页/s)
    const other = await request(origin, { origin }, 'POST', '/personal/v1/auth/register',
      { username: 'Other', password, deviceName: 'Other device' })
    assert.equal(other.status, 201)
    const otherLogin = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Other', password, deviceName: 'Other browser' }) })
    const otherAuth = { origin, cookie: otherLogin.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': (await otherLogin.json()).csrfToken }
    assert.equal((await request(origin, otherAuth, 'GET', '/personal/v1/workspaces/browser')).body.available, false)
    assert.equal((await request(origin, otherAuth, 'GET',
      `/personal/v1/tasks/${source.commandId}/sources/${first.snapshotId}`)).status, 404)
    const sameText = await request(origin, auth, 'POST', '/personal/v1/commands',
      { requestId: 'browser-same-text', kind: 'session.message', targetDeviceId: hostId, sessionId, text: goal })
    const secondSource = await settled(origin, auth, sameText.body.command.commandId)
    assert.equal(secondSource.receiptId, 'receipt-2')
    await assert.rejects(service.submitToolArtifact({ sessionId, turn: 2, callId: 'save-other-receipt',
      messageHash: sha(goal), receiptId: secondSource.receiptId, sourceSnapshotIds: [first.snapshotId],
      fileName: 'cross.md', content: '# Wrong root' }),
    (error: { code?: string }) => error.code === 'BROWSER_SOURCE_UNVERIFIED')
    const encodedUrl = 'https://public.test-domain.com/a%EF%BC%8Cb?x=1.2'
    const encodedGoal = `请阅读 ${encodedUrl}。分别说明路径。`
    const encodedSent = await request(origin, auth, 'POST', '/personal/v1/commands',
      { requestId: 'browser-encoded-url', kind: 'session.message', targetDeviceId: hostId,
        sessionId, text: encodedGoal })
    const encodedSource = await settled(origin, auth, encodedSent.body.command.commandId)
    await service.submitToolBrowser({ action: 'open_page', sessionId, turn: 3,
      callId: 'encoded-path', messageHash: sha(encodedGoal), receiptId: encodedSource.receiptId,
      url: encodedUrl })
    assert.equal(reads.at(-1), encodedUrl, 'URL path/query bytes remain intact beside Chinese prose')
    const stop = await request(origin, auth, 'POST', `/personal/v1/tasks/${source.commandId}/stop`,
      { requestId: 'stop-browser' })
    assert.equal(stop.status, 202)
    assert.deepEqual(cancelled, [source.commandId])
    await assert.rejects(service.submitToolBrowser({ action: 'open_page', sessionId, turn: 1,
      callId: 'after-stop', messageHash: sha(goal), receiptId: source.receiptId,
      url: 'https://public.test-domain.com/first' }),
    (error: { code?: string }) => error.code === 'TASK_NOT_READY')
    await service.close()
    service = await createPersonalAccessService({ root: profile, port: 0, backend,
      browserReader, verifyToolResult })
    origin = (await service.start()).origin; auth.origin = origin
    const recovered = await request(origin, auth, 'GET', `/personal/v1/tasks/${source.commandId}`)
    assert.equal(recovered.body.sources.filter((item: any) => item.cited).length, 2)
    assert.equal((await request(origin, auth, 'GET',
      `/personal/v1/tasks/${source.commandId}/sources/${first.snapshotId}`)).status, 200)
    await service.close()
    const storeFile = join(profile, 'store.json')
    const corrupted = JSON.parse(readFileSync(storeFile, 'utf8'))
    const owner = Object.values(corrupted.accounts)[0] as any
    owner.browserSources[first.snapshotId].readTool = 'personal_read_project_file'
    writeFileSync(storeFile, JSON.stringify(corrupted))
    await assert.rejects(createPersonalAccessService({ root: profile, port: 0, backend,
      browserReader, verifyToolResult }),
    (error: { code?: string }) => error.code === 'STORE_CORRUPT')
  } finally { await service.close(); rmSync(profile, { recursive: true, force: true }) }
})
