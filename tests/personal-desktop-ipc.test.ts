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

test('project IPC requires an exact receipt and returns only bounded list/read results', async () => {
  const calls: any[] = []
  const sent: any[] = []
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home', workspaceDir: 'C:\\synthetic\\work',
    personalDesktopRequestHandler: async (request: any) => {
      calls.push(request)
      return request.action === 'list_project'
        ? { files: [{ fileId: `file-${'a'.repeat(48)}`, relativePath: 'brief.md', size: 12 }],
          truncated: false, scannedCount: 1, skippedCount: 0, rootPath: 'C:/secret' }
        : { snapshotId: `source-${'b'.repeat(48)}`, relativePath: 'brief.md',
          lineStart: 1, lineEnd: 2, totalLines: 2, fileSha256: 'c'.repeat(64),
          text: 'bounded read', readAt: '2026-10-03T00:00:00.000Z', hasMore: false,
          privatePath: 'C:/secret' }
    } }) as any
  const child = { connected: true, send: (value: any) => { sent.push(value) } }
  runtime.child = child
  const base = { protocol: 'weftmate.personal-desktop.v1',
    id: 'personal-12345678-1234-1234-1234-123456789abc', sessionId: 'session-safe',
    turn: 1, callId: 'call-safe', messageHash: 'a'.repeat(64), receiptId: 'receipt-safe' }
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'list_project', query: '', rootPath: 'C:/secret' })
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'list_project', query: '', receiptId: undefined })
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'read_project', fileId: 'C:/secret' })
  assert.equal(calls.length, 0)
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'list_project', query: '' })
  for (let index = 0; index < 20 && sent.length < 1; index++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls.length, 1)
  assert.equal(sent[0].command.files[0].relativePath, 'brief.md')
  assert.equal(sent[0].command.skippedCount, 0)
  assert.equal(JSON.stringify(sent[0]).includes('C:/secret'), false)
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'read_project',
    fileId: `file-${'a'.repeat(48)}`, startLine: 1 })
  for (let index = 0; index < 20 && sent.length < 2; index++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls.length, 2)
  assert.equal(sent[1].command.snapshotId, `source-${'b'.repeat(48)}`)
  assert.equal(sent[1].command.text, 'bounded read')
  assert.equal(JSON.stringify(sent[1]).includes('C:/secret'), false)
})

test('browser IPC accepts only bounded open/follow frames and redacts host-only result fields', async () => {
  const calls: any[] = []
  const sent: any[] = []
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home', workspaceDir: 'C:\\synthetic\\work',
    personalDesktopRequestHandler: async (request: any) => {
      calls.push(request)
      return { snapshotId: `source-${'a'.repeat(48)}`, title: 'Public page',
        url: 'https://example.com/final', requestedUrl: 'https://example.com/start',
        text: 'rendered visible text', readAt: '2026-10-03T00:00:00.000Z',
        contentSha256: 'b'.repeat(64), truncated: false,
        links: [{ linkId: `link-${'c'.repeat(40)}`, label: 'Next', url: 'https://example.com/next' }],
        privateProxy: '127.0.0.1:1', cookie: 'must-not-escape' }
    } }) as any
  const child = { connected: true, send: (value: any) => { sent.push(value) } }
  runtime.child = child
  const base = { protocol: 'weftmate.personal-desktop.v1',
    id: 'personal-12345678-1234-1234-1234-123456789abc', sessionId: 'session-safe',
    turn: 1, callId: 'call-safe', messageHash: 'a'.repeat(64), receiptId: 'receipt-safe' }
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'open_page', url: 'javascript:alert(1)' })
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'open_page', url: 'https://example.com/', script: 'x' })
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'follow_link', snapshotId: `source-${'a'.repeat(48)}`,
    linkId: 'https://example.com/next' })
  assert.equal(calls.length, 0)
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'open_page', url: 'https://example.com/start' })
  for (let index = 0; index < 20 && sent.length < 1; index++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls.length, 1)
  assert.equal(sent[0].command.links.length, 1)
  assert.equal(sent[0].command.snapshotId, `source-${'a'.repeat(48)}`)
  assert.equal(JSON.stringify(sent[0]).includes('must-not-escape'), false)
  assert.equal(JSON.stringify(sent[0]).includes('privateProxy'), false)
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'follow_link',
    snapshotId: `source-${'a'.repeat(48)}`, linkId: `link-${'c'.repeat(40)}` })
  for (let index = 0; index < 20 && sent.length < 2; index++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls.length, 2)
  assert.equal(calls[1].linkId, `link-${'c'.repeat(40)}`)
})

test('browser IPC preserves closed timeout and safety failures without exposing exception text', async () => {
  const sent: any[] = []
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home', workspaceDir: 'C:\\synthetic\\work',
    personalDesktopRequestHandler: async () => {
      throw Object.assign(new Error('secret page body'), { code: 'BROWSER_DNS_TIMEOUT' })
    } }) as any
  const child = { connected: true, send: (value: any) => { sent.push(value) } }
  runtime.child = child
  runtime.handlePersonalDesktopMessage(child, { protocol: 'weftmate.personal-desktop.v1',
    id: 'personal-12345678-1234-1234-1234-123456789abc', sessionId: 'session-safe',
    turn: 1, callId: 'call-safe', messageHash: 'a'.repeat(64), receiptId: 'receipt-safe',
    action: 'open_page', url: 'https://example.com/' })
  for (let index = 0; index < 20 && sent.length < 1; index++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(sent[0], { protocol: 'weftmate.personal-desktop.v1',
    id: 'personal-12345678-1234-1234-1234-123456789abc', ok: false, error: 'BROWSER_DNS_TIMEOUT' })
  assert.equal(JSON.stringify(sent).includes('secret page body'), false)
})
