import assert from 'node:assert/strict'
import test from 'node:test'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'

test('personal desktop IPC accepts only a frame from the current managed child and projects a safe receipt', async () => {
  const calls: unknown[] = []
  const sent: unknown[] = []
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home', workspaceDir: 'C:\\synthetic\\work',
    personalDesktopRequestHandler: async (request) => {
      calls.push(request)
      return { commandId: 'cmd-12345678-1234-1234-1234-123456789abc', state: 'observed',
        verification: { status: 'observed', method: 'visible_window', outcome: 'opened',
          observedAt: '2026-09-26T00:00:00.000Z', privatePath: 'C:/private' }, secret: 'must-not-escape' }
    } }) as any
  const current = { connected: true, send: (value: unknown) => { sent.push(value) } }
  const stale = { connected: true, send: (value: unknown) => { sent.push(value) } }
  runtime.child = current
  const frame = { protocol: 'weftmate.personal-desktop.v1', id: 'personal-12345678-1234-1234-1234-123456789abc',
    sessionId: 'session-safe', turn: 1, callId: 'call-safe', messageHash: 'a'.repeat(64), appId: 'notepad' }
  runtime.handlePersonalDesktopMessage(stale, frame)
  assert.equal((sent[0] as any).ok, false)
  assert.equal(calls.length, 0)
  runtime.handlePersonalDesktopMessage(current, { ...frame, appId: 'cmd' })
  assert.equal(calls.length, 0)
  runtime.handlePersonalDesktopMessage(current, frame)
  for (let index = 0; index < 20 && sent.length < 2; index++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls.length, 1)
  assert.equal((sent[1] as any).ok, true)
  assert.equal((sent[1] as any).command.commandId, 'cmd-12345678-1234-1234-1234-123456789abc')
  assert.equal(JSON.stringify(sent[1]).includes('must-not-escape'), false)
  assert.equal(JSON.stringify(sent[1]).includes('C:/private'), false)
})

test('personal document IPC accepts bounded text and projects only verified artifact fields', async () => {
  const calls: unknown[] = []
  const sent: unknown[] = []
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home', workspaceDir: 'C:\\synthetic\\work',
    personalDesktopRequestHandler: async (request) => {
      calls.push(request)
      return { taskId: 'cmd-12345678-1234-1234-1234-123456789abc', artifactId: 'artifact-1',
        fileName: '会议纪要.md', size: 5, sha256: 'a'.repeat(64), state: 'observed', privatePath: 'C:/private' }
    } }) as any
  const current = { connected: true, send: (value: unknown) => { sent.push(value) } }
  runtime.child = current
  const frame = { protocol: 'weftmate.personal-desktop.v1', id: 'personal-12345678-1234-1234-1234-123456789abc',
    action: 'write_document', sessionId: 'session-safe', turn: 1, callId: 'call-safe',
    messageHash: 'a'.repeat(64), fileName: '会议纪要.md', content: 'hello' }
  for (const fileName of ['../escape.md', 'a\\b.md', 'CON.md', 'a..b.md', 'a .md',
    'notes.pdf', 'bad\nname.md', 'a'.repeat(161) + '.md', 'Cafe\u0301.md']) {
    runtime.handlePersonalDesktopMessage(current, { ...frame, fileName })
  }
  runtime.handlePersonalDesktopMessage(current, { ...frame, content: 'x'.repeat(128 * 1024 + 1) })
  runtime.handlePersonalDesktopMessage(current, { ...frame, command: 'pwsh' })
  assert.equal(calls.length, 0)
  runtime.handlePersonalDesktopMessage(current, frame)
  for (let index = 0; index < 20 && sent.length < 1; index++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls.length, 1)
  assert.equal((sent[0] as any).ok, true)
  assert.deepEqual((sent[0] as any).command, { taskId: 'cmd-12345678-1234-1234-1234-123456789abc',
    artifactId: 'artifact-1', fileName: '会议纪要.md', size: 5, sha256: 'a'.repeat(64), state: 'observed' })
  assert.equal(JSON.stringify(sent[0]).includes('C:/private'), false)
})
