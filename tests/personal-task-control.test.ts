import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const password = 'correct horse battery staple'

async function request(origin: string, method: string, route: string, body?: object,
  headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json() }
}

async function settled(origin: string, headers: Record<string, string>, commandId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await request(origin, 'GET', `/personal/v1/commands/${commandId}`, undefined, headers)
    if (!['pending', 'dispatching'].includes(result.body.command.state)) return result.body.command
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('command did not settle')
}

test('task supplement, stop intent and observed resume keep one root across restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-task-control-'))
  const sessions = new Set<string>()
  const sends: string[] = []
  let appCalls = 0
  let events: object[] = []
  let running = false
  let racingPreflights = 0
  let failNextSend = false
  let unblockRace: (() => void) | null = null
  let sawRace: (() => void) | null = null
  const raceGate = new Promise<void>((resolve) => { unblockRace = resolve })
  const raceStarted = new Promise<void>((resolve) => { sawRace = resolve })
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [{ id: 'local', name: 'Local', model: 'synthetic', configured: true }],
    preflight: async ({ text }: { text?: string }) => {
      if (text === 'racing' && ++racingPreflights === 2) { sawRace?.(); await raceGate }
      return { ok: true }
    },
    createSession: async ({ sessionId }: { sessionId: string }) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async ({ text }: { text: string }) => {
      sends.push(text)
      if (failNextSend) { failNextSend = false; return { accepted: false } }
      return { accepted: true }
    },
    cancelSession: async () => { throw new Error('task stop must not use session-wide cancel') },
    openDesktopApp: async () => { appCalls++; return { accepted: true, observed: true, outcome: 'opened' } },
    readEvents: async ({ afterSeq }: { afterSeq: number }) => ({
      events: events.filter((event: any) => event.seq > afterSeq),
      nextSeq: events.length ? (events.at(-1) as any).seq : afterSeq, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, title: 'Synthetic', running, agentPreset: 'personal-remote' } : null,
  }
  let service = await createPersonalAccessService({ root, port: 0, backend })
  try {
    let { origin, hostId } = await service.start()
    const grant = await service.issueSetupGrant()
    const setup = await request(origin, 'POST', '/personal/v1/auth/setup',
      { grant: grant.grant, username: 'Owner', password, deviceName: 'Desktop' }, { origin })
    assert.equal(setup.status, 201)
    const login = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Owner', password, deviceName: 'Phone' }) })
    const phone = await login.json()
    const auth = { cookie: login.headers.get('set-cookie')!.split(';')[0], origin,
      'x-weftmate-csrf': phone.csrfToken }
    const created = await request(origin, 'POST', '/personal/v1/commands',
      { requestId: 'create-task-control', kind: 'session.create', targetDeviceId: hostId,
        modelProfileId: 'local' }, auth)
    assert.equal(created.status, 202)
    const sessionId = created.body.command.sessionId
    await settled(origin, auth, created.body.command.commandId)
    const sourceText = 'Create a document'
    const source = await request(origin, 'POST', '/personal/v1/commands',
      { requestId: 'source-task-control', kind: 'session.message', targetDeviceId: hostId,
        sessionId, text: sourceText }, auth)
    const taskId = source.body.command.commandId
    await settled(origin, auth, taskId)
    const supplementText = 'Add a second section'
    const route = `/personal/v1/tasks/${taskId}`
    const supplement = await request(origin, 'POST', `${route}/supplements`,
      { requestId: 'supplement-once', text: supplementText }, auth)
    assert.equal(supplement.status, 202)
    assert.equal(supplement.body.command.rootTaskId, taskId)
    await settled(origin, auth, supplement.body.command.commandId)
    const duplicate = await request(origin, 'POST', `${route}/supplements`,
      { requestId: 'supplement-once', text: supplementText }, auth)
    assert.equal(duplicate.body.command.commandId, supplement.body.command.commandId)
    assert.equal((await request(origin, 'POST', `${route}/supplements`,
      { requestId: 'supplement-once', text: 'changed' }, auth)).status, 409)
    const artifact = await service.submitToolArtifact({ sessionId, turn: 1, callId: 'supplement-file',
      messageHash: sha(supplementText), fileName: 'result.md', content: '# Result\nDone.\n' })
    assert.equal(artifact.taskId, taskId)
    assert.equal((await request(origin, 'GET', route, undefined, auth)).body.artifacts[0].taskId, taskId)
    const stopped = await request(origin, 'POST', `${route}/stop`, { requestId: 'stop-once' }, auth)
    assert.equal(stopped.status, 202)
    assert.equal(stopped.body.task.control.state, 'stop_requested')
    assert.equal(stopped.body.task.control.canResume, false)
    assert.equal((await request(origin, 'POST', `${route}/stop`, { requestId: 'stop-once' }, auth)).status, 202)
    assert.equal((await request(origin, 'POST', `${route}/supplements`,
      { requestId: 'supplement-blocked', text: 'again' }, auth)).status, 409)
    assert.equal((await request(origin, 'POST', `${route}/resume`,
      { requestId: 'resume-once', text: 'Only confirm the existing file. Do not create another file.' }, auth)).status, 409)
    await assert.rejects(service.submitToolArtifact({ sessionId, turn: 1, callId: 'late-file',
      messageHash: sha(supplementText), fileName: 'late.md', content: 'late' }),
    (error: { code: string }) => error.code === 'TASK_NOT_READY')
    await service.close()
    service = await createPersonalAccessService({ root, port: 0, backend })
    origin = (await service.start()).origin
    auth.origin = origin
    assert.equal((await request(origin, 'GET', route, undefined, auth)).body.control.state, 'stop_requested')
    events = [
      // Official rc.5 history starts the turn before recording the user message.
      { seq: 888, type: 'turn.started', data: {} },
      { seq: 891, type: 'user.message', data: { text: supplementText } },
      { seq: 1376, type: 'turn.ended', data: { reason: 'completed' } },
    ]
    const observed = await request(origin, 'GET', route, undefined, auth)
    assert.equal(observed.body.control.canResume, true)
    assert.equal(observed.body.control.state, 'stop_requested')
    assert.equal(observed.body.control.reasonCode, 'TURN_ENDED_AFTER_STOP_REQUEST')
    const resumeText = 'Only confirm the existing file. Do not create another file.'
    const resumed = await request(origin, 'POST', `${route}/resume`,
      { requestId: 'resume-once', text: resumeText }, auth)
    assert.equal(resumed.status, 202)
    assert.equal(resumed.body.task.control.state, 'active')
    assert.equal(resumed.body.command.rootTaskId, taskId)
    await settled(origin, auth, resumed.body.command.commandId)
    assert.equal(sends.length, 3)
    await assert.rejects(service.submitToolDesktop({ sessionId, turn: 2, callId: 'unrelated-notepad',
      messageHash: sha(resumeText), appId: 'notepad' }),
    (error: { code: string }) => error.code === 'TOOL_INTENT_UNCONFIRMED')
    assert.equal(appCalls, 0)
    assert.deepEqual((await request(origin, 'GET', route, undefined, auth)).body.steps, [])
    assert.equal((await request(origin, 'POST', `${route}/resume`,
      { requestId: 'resume-once', text: resumeText }, auth)).body.command.commandId, resumed.body.command.commandId)
    assert.equal((await request(origin, 'POST', `${route}/resume`,
      { requestId: 'resume-once', text: 'changed' }, auth)).status, 409)
    assert.equal(sends.length, 3)
    running = true
    const racing = await request(origin, 'POST', `${route}/supplements`,
      { requestId: 'racing-supplement', text: 'racing' }, auth)
    assert.equal(racing.status, 202)
    await raceStarted
    const stopAgain = await request(origin, 'POST', `${route}/stop`, { requestId: 'stop-again' }, auth)
    assert.equal(stopAgain.status, 202)
    assert.equal(stopAgain.body.task.control.canResume, false)
    unblockRace?.()
    assert.equal((await settled(origin, auth, racing.body.command.commandId)).state, 'rejected')
    running = false
    assert.equal((await request(origin, 'GET', route, undefined, auth)).body.control.canResume, false)
    events = [
      ...events,
      { seq: 1377, type: 'user.message', data: { text: resumeText } },
      { seq: 1378, type: 'turn.started', data: {} },
      { seq: 1379, type: 'turn.ended', data: { reason: 'completed' } },
    ]
    assert.equal((await request(origin, 'GET', route, undefined, auth)).body.control.canResume, true)
    assert.equal((await service.submitToolArtifact({ sessionId, turn: 1, callId: 'supplement-file',
      messageHash: sha(supplementText), fileName: 'result.md', content: '# Result\nDone.\n' })).artifactId,
    artifact.artifactId)
    assert.equal((await request(origin, 'POST', `${route}/supplements`,
      { requestId: 'stop-again', text: 'collision' }, auth)).status, 409)
    failNextSend = true
    const uncertainResume = await request(origin, 'POST', `${route}/resume`,
      { requestId: 'resume-uncertain', text: 'Review the result once more' }, auth)
    assert.equal(uncertainResume.status, 202)
    assert.equal((await settled(origin, auth, uncertainResume.body.command.commandId)).state, 'uncertain')
    const uncertainDetail = await request(origin, 'GET', route, undefined, auth)
    assert.equal(uncertainDetail.body.control.state, 'uncertain')
    assert.equal(uncertainDetail.body.control.canSupplement, false)
    assert.equal((await request(origin, 'POST', `${route}/supplements`,
      { requestId: 'do-not-replay', text: 'repeat' }, auth)).status, 409)
    const other = await request(origin, 'POST', '/personal/v1/auth/register',
      { username: 'Other', password, deviceName: 'Other phone' }, { origin })
    assert.equal(other.status, 201)
    const otherLogin = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Other', password, deviceName: 'Other browser' }) })
    const otherAuth = { cookie: otherLogin.headers.get('set-cookie')!.split(';')[0], origin,
      'x-weftmate-csrf': (await otherLogin.json()).csrfToken }
    assert.equal((await request(origin, 'GET', route, undefined, otherAuth)).status, 404)
    assert.equal((await request(origin, 'POST', `${route}/stop`, { requestId: 'other-stop' }, otherAuth)).status, 404)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})
