import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService, explicitNotepadOpenIntent } from '../src/personal-access/index.mjs'

const password = 'synthetic owner password phrase'
const message = '请在这台电脑上打开记事本'

test('fixed Notepad tool requires an affirmative launch request in common Chinese or English', () => {
  for (const text of ['请打开电脑上的记事本', '请在这台电脑上启动记事本',
    'Open Notepad', 'Please launch Windows Notepad', 'Can you bring up the Notepad app?']) {
    assert.equal(explicitNotepadOpenIntent(text), true, text)
  }
  for (const text of ['Only confirm the existing file. Do not create another file.',
    'Do not open Notepad', '不要打开记事本', '如何打开记事本？',
    'How to open Notepad?', 'Open the existing file in Notepad',
    'Write the phrase "open Notepad" in the document', '把“打开记事本”写进文档']) {
    assert.equal(explicitNotepadOpenIntent(text), false, text)
  }
})

async function request(origin: string, cookie: string, csrf: string, kind: string, payload: object) {
  const response = await fetch(`${origin}/personal/v1/${kind}`, {
    method: 'POST', headers: { origin, cookie: cookie.split(';')[0], 'x-weftmate-csrf': csrf,
      'content-type': 'application/json' }, body: JSON.stringify(payload),
  })
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') }
}

async function waitCommand(origin: string, cookie: string, id: string) {
  for (let index = 0; index < 100; index++) {
    const response = await fetch(`${origin}/personal/v1/commands/${id}`, { headers: { cookie: cookie.split(';')[0] } })
    const value = await response.json()
    if (value.command.state === 'accepted_by_dsh') return value.command
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('message callback did not accept')
}

test('tool call source is one current authorized remote message and duplicate callId reuses its command', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-tool-source-'))
  const sessions = new Set<string>()
  let appCalls = 0
  let preset = 'personal-remote'
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }), listModels: async () => [],
    preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId }: { sessionId: string }) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async () => ({ accepted: true }), cancelSession: async () => ({ accepted: true }),
    readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, title: 'Remote', running: false, agentPreset: preset } : null,
    openDesktopApp: async () => { appCalls++; return { accepted: true, observed: true, outcome: 'opened' } },
  }
  const service = await createPersonalAccessService({ root, port: 0, backend })
  try {
    const { origin, hostId } = await service.start()
    const grant = await service.issueSetupGrant()
    const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: 'Owner', password, deviceName: 'Phone' }) })
    assert.equal(setup.status, 201)
    const credential = await setup.json()
    const cookie = setup.headers.get('set-cookie')!
    const created = await request(origin, cookie, credential.csrfToken, 'commands',
      { requestId: 'remote-create', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' })
    assert.equal(created.status, 202)
    const sessionId = created.body.command.sessionId
    await waitCommand(origin, cookie, created.body.command.commandId)
    const sent = await request(origin, cookie, credential.csrfToken, 'commands',
      { requestId: 'remote-message', kind: 'session.message', targetDeviceId: hostId, sessionId, text: message })
    assert.equal(sent.status, 202)
    await waitCommand(origin, cookie, sent.body.command.commandId)
    const args = { sessionId, turn: 1, callId: 'tool-1',
      messageHash: createHash('sha256').update(message).digest('hex'), appId: 'notepad' }
    const opened = await service.submitToolDesktop(args)
    assert.equal(opened.state, 'observed')
    assert.equal(opened.verification.outcome, 'opened')
    assert.equal(opened.taskId, sent.body.command.commandId)
    const detail = await fetch(`${origin}/personal/v1/tasks/${sent.body.command.commandId}`,
      { headers: { cookie: cookie.split(';')[0] } }).then((response) => response.json())
    assert.equal(detail.steps[0].commandId, opened.commandId)
    assert.equal(detail.steps[0].taskId, sent.body.command.commandId)
    assert.equal((await service.submitToolDesktop(args)).commandId, opened.commandId)
    assert.equal((await service.submitToolDesktop({ ...args, callId: 'tool-2' })).commandId, opened.commandId)
    assert.equal(appCalls, 1)
    const english = 'Please open Notepad on this computer'
    const second = await request(origin, cookie, credential.csrfToken, 'commands',
      { requestId: 'remote-message-english', kind: 'session.message', targetDeviceId: hostId,
        sessionId, text: english })
    await waitCommand(origin, cookie, second.body.command.commandId)
    const secondOpen = await service.submitToolDesktop({ sessionId, turn: 2, callId: 'tool-english',
      messageHash: createHash('sha256').update(english).digest('hex'), appId: 'notepad' })
    assert.equal(secondOpen.state, 'observed')
    assert.equal(secondOpen.taskId, second.body.command.commandId)
    assert.equal(appCalls, 2)
    preset = 'standard'
    await assert.rejects(service.submitToolDesktop({ ...args, callId: 'tool-3' }),
      (error: { code: string }) => error.code === 'SESSION_READ_ONLY')
    preset = 'personal-remote'
    await service.revokeDevice(credential.device.id)
    await assert.rejects(service.submitToolDesktop({ ...args, callId: 'tool-4', turn: 2 }),
      (error: { code: string }) => error.code === 'TOOL_SOURCE_UNAVAILABLE')
    assert.equal(appCalls, 2)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})
