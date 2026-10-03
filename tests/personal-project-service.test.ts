import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const password = 'correct horse battery staple'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const pause = () => new Promise((resolve) => setTimeout(resolve, 20))
async function request(origin: string, method: string, route: string, auth: Record<string, string>, body?: object) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json() }
}
async function settled(origin: string, auth: Record<string, string>, commandId: string) {
  for (let i = 0; i < 100; i++) {
    const result = await request(origin, 'GET', `/personal/v1/commands/${commandId}`, auth)
    if (!['pending', 'dispatching'].includes(result.body.command.state)) return result.body.command
    await pause()
  }
  throw new Error('command did not settle')
}

test('project grant, exact read snapshot, cited artifact, revoke and restart stay owner-bound',
  { skip: process.platform !== 'win32' }, async () => {
  const profileRoot = mkdtempSync(join(tmpdir(), 'weft-project-profile-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'weft-project-data-'))
  assert.ok(resolve(profileRoot).startsWith(resolve(tmpdir())))
  assert.ok(resolve(projectRoot).startsWith(resolve(tmpdir())))
  writeFileSync(join(projectRoot, 'notes.md'), '# Original\nA fact.\n', 'utf8')
  const sessions = new Set<string>()
  const proofCalls: object[] = []
  let nextReceipt = 0
  let holdSecond = false
  let releaseSecond!: () => void
  let secondEntered!: () => void
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve })
  const secondStarted = new Promise<void>((resolve) => { secondEntered = resolve })
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [{ id: 'local', name: 'Local', model: 'synthetic', configured: true }],
    preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId }: { sessionId: string }) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async () => {
      const receiptId = `receipt-${++nextReceipt}`
      if (holdSecond) { secondEntered(); await secondGate }
      return { accepted: true, receiptId }
    },
    cancelSession: async () => ({ accepted: true }),
    readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, agentPreset: 'personal-remote', modelProfileId: 'local', running: false } : null,
  }
  const verifyToolResult = async (args: object) => { proofCalls.push(args); return true }
  let service = await createPersonalAccessService({ root: profileRoot, port: 0, backend, verifyToolResult })
  try {
    let { origin, hostId } = await service.start()
    const grant = await service.issueSetupGrant()
    assert.equal((await request(origin, 'POST', '/personal/v1/auth/setup', { origin },
      { grant: grant.grant, username: 'Owner', password, deviceName: 'Desktop' })).status, 201)
    const login = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Owner', password, deviceName: 'Phone' }) })
    const auth = { origin, cookie: login.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': (await login.json()).csrfToken }
    const registration = await request(origin, 'POST', '/personal/v1/projects', auth,
      { requestId: 'register-project', name: '合成资料', rootPath: projectRoot })
    assert.equal(registration.status, 201, JSON.stringify(registration.body))
    const projectId = registration.body.project.projectId
    assert.equal(registration.body.project.name, '合成资料')
    assert.equal((await request(origin, 'GET', '/personal/v1/projects', auth)).body.projects.length, 1)
    assert.equal((await request(origin, 'POST', '/personal/v1/projects', auth,
      { requestId: 'register-project', name: '合成资料', rootPath: projectRoot })).body.project.projectId, projectId)
    const created = await request(origin, 'POST', `/personal/v1/projects/${projectId}/sessions`, auth,
      { requestId: 'project-session', modelProfileId: 'local' })
    assert.equal(created.status, 202, JSON.stringify(created.body))
    const createCommand = await settled(origin, auth, created.body.command.commandId)
    const sessionId = createCommand.sessionId
    assert.equal(createCommand.projectId, projectId)
    const duplicate = await request(origin, 'POST', `/personal/v1/projects/${projectId}/sessions`, auth,
      { requestId: 'project-session', modelProfileId: 'local' })
    assert.equal(duplicate.body.command.commandId, createCommand.commandId)
    const goal = '读取资料并整理摘要'
    const sent = await request(origin, 'POST', '/personal/v1/commands', auth,
      { requestId: 'project-goal', kind: 'session.message', targetDeviceId: hostId, sessionId, text: goal })
    assert.equal(sent.status, 202, JSON.stringify(sent.body))
    const source = await settled(origin, auth, sent.body.command.commandId)
    assert.equal(source.projectId, projectId)
    assert.equal(source.receiptId, 'receipt-1')
    const list = await service.submitToolProject({ action: 'list_project', sessionId, turn: 1,
      callId: 'list-1', messageHash: sha(goal), receiptId: source.receiptId })
    assert.equal(list.files.length, 1)
    assert.equal(list.files[0].relativePath, 'notes.md')
    const read = await service.submitToolProject({ action: 'read_project', sessionId, turn: 1,
      callId: 'read-1', messageHash: sha(goal), receiptId: source.receiptId, fileId: list.files[0].fileId })
    assert.match(read.text, /A fact/)
    assert.equal(read.lineStart, 1)
    const artifact = await service.submitToolArtifact({ sessionId, turn: 1, callId: 'save-1',
      messageHash: sha(goal), receiptId: source.receiptId, sourceSnapshotIds: [read.snapshotId],
      fileName: 'summary.md', content: '# Summary\nA fact.\n' })
    assert.equal(artifact.state, 'observed')
    assert.deepEqual(artifact.sourceSnapshotIds, [read.snapshotId])
    assert.equal(proofCalls.length, 1)
    const detail = await request(origin, 'GET', `/personal/v1/tasks/${source.commandId}`, auth)
    assert.equal(detail.body.project.projectId, projectId)
    assert.equal(detail.body.sources[0].cited, true)
    const sourcePage = await request(origin, 'GET', `/personal/v1/tasks/${source.commandId}/sources/${read.snapshotId}`, auth)
    assert.equal(sourcePage.body.source.text, read.text)
    const preview = await request(origin, 'GET', `/personal/v1/artifacts/${artifact.artifactId}/preview`, auth)
    assert.match(preview.body.text, /已读取来源.*notes\.md/s)
    holdSecond = true
    const sameText = await request(origin, 'POST', '/personal/v1/commands', auth,
      { requestId: 'same-text-second', kind: 'session.message', targetDeviceId: hostId, sessionId, text: goal })
    await secondStarted
    const earlyTool = service.submitToolProject({ action: 'list_project', sessionId, turn: 2,
      callId: 'list-before-receipt-write', messageHash: sha(goal), receiptId: 'receipt-2' })
    await new Promise((resolve) => setTimeout(resolve, 120))
    releaseSecond()
    assert.equal((await earlyTool).files.length, 1)
    assert.equal((await settled(origin, auth, sameText.body.command.commandId)).receiptId, 'receipt-2')
    await assert.rejects(service.submitToolArtifact({ sessionId, turn: 2, callId: 'save-wrong-source',
      messageHash: sha(goal), receiptId: 'receipt-2', sourceSnapshotIds: [read.snapshotId],
      fileName: 'wrong.md', content: '# Wrong source' }),
    (error: { code?: string }) => error.code === 'PROJECT_SOURCE_UNVERIFIED')
    const other = await request(origin, 'POST', '/personal/v1/auth/register', { origin },
      { username: 'Other', password, deviceName: 'Other device' })
    assert.equal(other.status, 201)
    const otherLogin = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Other', password, deviceName: 'Other browser' }) })
    const otherAuth = { origin, cookie: otherLogin.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': (await otherLogin.json()).csrfToken }
    assert.equal((await request(origin, 'GET', '/personal/v1/projects', otherAuth)).body.projects.length, 0)
    assert.equal((await request(origin, 'GET', `/personal/v1/tasks/${source.commandId}`, otherAuth)).status, 404)
    assert.equal((await request(origin, 'GET', `/personal/v1/tasks/${source.commandId}/sources/${read.snapshotId}`, otherAuth)).status, 404)
    const revoked = await request(origin, 'POST', `/personal/v1/projects/${projectId}/revoke`, auth,
      { requestId: 'revoke-project' })
    assert.equal(revoked.status, 200)
    assert.equal(revoked.body.project.revoked, true)
    await assert.rejects(service.submitToolProject({ action: 'list_project', sessionId, turn: 1,
      callId: 'list-after-revoke', messageHash: sha(goal), receiptId: source.receiptId }),
    (error: { code?: string }) => error.code === 'PROJECT_REVOKED')
    assert.equal((await request(origin, 'GET', `/personal/v1/tasks/${source.commandId}/sources/${read.snapshotId}`, auth)).status, 200)
    await service.close()
    service = await createPersonalAccessService({ root: profileRoot, port: 0, backend, verifyToolResult })
    origin = (await service.start()).origin; auth.origin = origin
    assert.equal((await request(origin, 'GET', `/personal/v1/tasks/${source.commandId}`, auth)).body.sources[0].snapshotId, read.snapshotId)
  } finally {
    await service.close()
    rmSync(profileRoot, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
  }
})
