import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'
import { artifactContentType } from '../src/personal-artifacts/index.mjs'

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

test('generic execution IPC accepts only identity metadata from the managed child and projects no command body', async () => {
  const calls: any[] = [], sent: any[] = []
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home', workspaceDir: 'C:\\synthetic\\work',
    personalDesktopRequestHandler: async request => {
      calls.push(request); return { executionId: 'exec-' + 'a'.repeat(48),
        taskId: 'cmd-12345678-1234-1234-1234-123456789abc', state: (request as any).state ?? 'running', privateCommand: 'must-not-escape' }
    } }) as any
  const child = Object.assign(new EventEmitter(), { connected: true, send: (value: any) => sent.push(value) })
  runtime.registerChild(child); runtime.child = child
  const frame = { protocol: 'weftmate.personal-desktop.v1', id: 'personal-12345678-1234-1234-1234-123456789abc',
    action: 'authorize_execution', sessionId: 'session-safe', turn: 1, callId: 'call-safe', rootCallId: 'root-safe',
    receiptId: 'receipt-safe', messageHash: 'a'.repeat(64), toolName: 'pwsh', argumentsHash: 'b'.repeat(64) }
  runtime.handlePersonalDesktopMessage(child, { ...frame, ownerId: 'forged-owner' })
  runtime.handlePersonalDesktopMessage(child, { ...frame, command: 'private command' })
  runtime.handlePersonalDesktopMessage(child, { ...frame, toolName: 'invalid tool name' })
  assert.equal(calls.length, 0)
  runtime.handlePersonalDesktopMessage(child, frame)
  for (let i = 0; i < 20 && !sent.length; i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(calls[0].rootCallId, 'root-safe')
  assert.equal(calls[0].receiptId, 'receipt-safe')
  assert.equal(sent[0].command.state, 'running')
  assert.equal(JSON.stringify(sent).includes('must-not-escape'), false)
  const uncertain = { ...frame, action: 'finish_execution', executionId: 'exec-' + 'a'.repeat(48), state: 'uncertain' }
  for (const change of [{ resultHash: 'c'.repeat(64) }, { jobId: 'pwsh:1', jobState: 'running' }]) {
    runtime.handlePersonalDesktopMessage(child, { ...uncertain, ...change })
  }
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 1)
  runtime.handlePersonalDesktopMessage(child, uncertain)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls[1].state, 'uncertain'); assert.equal('resultHash' in calls[1], false)
  assert.equal(sent[1].command.state, 'uncertain')
  child.emit('close', 0); await runtime.close()
})

test('personal document IPC accepts bounded text and projects only verified artifact fields', async () => {
  const calls: unknown[] = []
  const sent: unknown[] = []
  let replyContentType: string | undefined
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home', workspaceDir: 'C:\\synthetic\\work',
    personalDesktopRequestHandler: async (request) => {
      calls.push(request)
      return { taskId: 'cmd-12345678-1234-1234-1234-123456789abc', artifactId: 'artifact-1',
        fileName: (request as any).fileName, size: 5, sha256: 'a'.repeat(64), state: 'observed',
        ...(replyContentType ? { contentType: replyContentType } : {}), privatePath: 'C:/private' }
    } }) as any
  const current = { connected: true, send: (value: unknown) => { sent.push(value) } }
  runtime.child = current
  const frame = { protocol: 'weftmate.personal-desktop.v1', id: 'personal-12345678-1234-1234-1234-123456789abc',
    action: 'write_document', sessionId: 'session-safe', turn: 1, callId: 'call-safe',
    messageHash: 'a'.repeat(64), fileName: '会议纪要.md', content: 'hello' }
  for (const fileName of ['../escape.md', 'a\\b.md', 'CON.md', 'a..b.md', 'a .md',
    'notes.', 'bad\nname.md', 'a'.repeat(161) + '.md', 'Cafe\u0301.md']) {
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
    artifactId: 'artifact-1', fileName: '会议纪要.md', size: 5, sha256: 'a'.repeat(64), state: 'observed',
    contentType: 'text/plain; charset=utf-8' })
  assert.equal(JSON.stringify(sent[0]).includes('C:/private'), false)
  for (const [index, fileName] of ['说明.txt', '表格.csv', 'rows.tsv', 'state.json', 'notes.pdf'].entries()) {
    replyContentType = artifactContentType(fileName)
    runtime.handlePersonalDesktopMessage(current, { ...frame, id: `personal-${randomUUID()}`,
      callId: `text-${index}`, fileName })
    for (let attempt = 0; attempt < 20 && sent.length < index + 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal((calls[index + 1] as any).fileName, fileName)
    assert.equal((calls[index + 1] as any).content, frame.content)
    assert.equal((sent[index + 1] as any).command.fileName, fileName)
    assert.equal((sent[index + 1] as any).command.contentType, artifactContentType(fileName))
  }
  replyContentType = 'application/octet-stream'
  runtime.handlePersonalDesktopMessage(current, { ...frame, id: `personal-${randomUUID()}`,
    callId: 'invalid-media-type', fileName: 'table.csv' })
  for (let attempt = 0; attempt < 20 && sent.length < 7; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal((sent[6] as any).ok, false)
  assert.equal((sent[6] as any).error, 'PERSONAL_TOOL_UNAVAILABLE')
})

test('approval IPC validates each action exactly, injects the parent runtime UUID and returns only the matching public row', async () => {
  const calls: any[] = [], sent: any[] = []
  const approvalId = '12345678-1234-4234-8234-123456789abc'
  const commandId = 'cmd-12345678-1234-4234-8234-123456789abc'
  const publicRow = { approvalId, sessionId: 'session-safe', taskId: commandId, sourceCommandId: commandId,
    sourceReceiptId: 'receipt-safe', turn: 1, callId: 'call-safe', rootCallId: 'root-safe', toolName: 'pwsh',
    reason: 'Allow this exact fixture command', createdAt: '2026-10-06T00:00:00.000Z', status: 'pending' }
  let reply: any = publicRow
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home', workspaceDir: 'C:\\synthetic\\work',
    personalDesktopRequestHandler: async request => {
      calls.push(request); return { ...reply, runtimeId: 'must-not-escape', messageHash: 'must-not-escape',
        argumentsHash: 'must-not-escape', privateCommand: 'must-not-escape' }
    } }) as any
  const child = Object.assign(new EventEmitter(), { connected: true, send: (value: any) => sent.push(value) })
  runtime.registerChild(child); runtime.child = child
  const base = { protocol: 'weftmate.personal-desktop.v1', id: 'personal-12345678-1234-4234-8234-123456789abc',
    sessionId: 'session-safe', turn: 1, callId: 'call-safe', rootCallId: 'root-safe', receiptId: 'receipt-safe',
    messageHash: 'a'.repeat(64), toolName: 'pwsh', argumentsHash: 'b'.repeat(64), approvalId }
  const register = { ...base, action: 'register_approval', reason: publicRow.reason }
  for (const change of [{ runtimeId: approvalId }, { ownerId: 'forged' }, { requestId: 'forged' },
    { command: 'private command' }, { approvalId: 'forged' }, { receiptId: undefined }, { rootCallId: undefined },
    { turn: 0 }, { reason: undefined }, { reason: 'x'.repeat(1001) }, { reason: '\0' },
    { outcome: 'allowed-once' }, { argumentsHash: 'bad' }, { messageHash: 'bad' }]) {
    runtime.handlePersonalDesktopMessage(child, { ...register, ...change })
  }
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'read_approval', reason: 'injected' })
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'resolve_approval', outcome: 'allow' })
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'resolve_approval' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 0); assert.equal(sent.length, 0)
  runtime.handlePersonalDesktopMessage(child, register)
  await new Promise(resolve => setImmediate(resolve))
  assert.match(calls[0].runtimeId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.ok(Object.isFrozen(calls[0])); assert.deepEqual(sent[0].command, publicRow)
  const runtimeId = calls[0].runtimeId
  reply = { ...publicRow, status: 'answered', decisionOutcome: 'allowed-once', decisionRequestId: 'answer-safe',
    answeredAt: '2026-10-06T00:00:01.000Z' }
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'read_approval' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls[1].runtimeId, runtimeId); assert.equal(sent[1].command.status, 'answered')
  reply = { ...reply, status: 'resolved', outcome: 'allowed-once', resolvedAt: '2026-10-06T00:00:02.000Z' }
  runtime.handlePersonalDesktopMessage(child, { ...base, action: 'resolve_approval', outcome: 'allowed-once' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls[2].runtimeId, runtimeId); assert.equal(sent[2].command.status, 'resolved')
  assert.equal(JSON.stringify(sent).includes('must-not-escape'), false)
  for (const change of [{ approvalId: '22345678-1234-4234-8234-123456789abc' }, { sourceReceiptId: 'other-receipt' },
    { sessionId: 'other-session' }, { turn: 2 }, { callId: 'other-call' }, { rootCallId: 'other-root' },
    { toolName: 'read' }, { status: 'answered', resolvedAt: undefined, outcome: undefined, decisionOutcome: undefined },
    { status: 'pending' }, { outcome: 'rejected' }]) {
    reply = { ...publicRow, status: 'resolved', outcome: 'allowed-once', resolvedAt: '2026-10-06T00:00:02.000Z', ...change }
    runtime.handlePersonalDesktopMessage(child, { ...base, action: 'resolve_approval', outcome: 'allowed-once' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(sent.at(-1).ok, false)
  }
  child.emit('close', 0); await runtime.close()
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
        contentSha256: createHash('sha256').update('rendered visible text').digest('hex'), truncated: false,
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

test('browser segment IPC keeps exact parent identity, byte range and bounded text', async () => {
  const calls: any[] = [], sent: any[] = []
  const parentSnapshotId = `source-${'a'.repeat(48)}`
  const text = '实际读取的第一段。'
  const bytes = Buffer.byteLength(text, 'utf8')
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home',
    workspaceDir: 'C:\\synthetic\\work', personalDesktopRequestHandler: async (request: any) => {
      calls.push(request)
      return { kind: 'webpage', snapshotId: `source-${'b'.repeat(48)}`,
        parentSnapshotId, segmentIndex: 0, segmentCount: 2, byteStart: 0, byteEnd: bytes,
        totalCapturedBytes: 16_000, captureTruncated: false, versionHash: 'c'.repeat(64),
        title: 'Synthetic', url: 'https://example.com/page', requestedUrl: 'https://example.com/page',
        text, contentSha256: createHash('sha256').update(text).digest('hex'),
        readAt: '2026-10-04T00:00:00.000Z', truncated: false, links: [],
        privateCapturePath: 'C:/private' }
    } }) as any
  const child = { connected: true, send: (value: any) => { sent.push(value) } }
  runtime.child = child
  const frame = { protocol: 'weftmate.personal-desktop.v1',
    id: 'personal-12345678-1234-1234-1234-123456789abc', sessionId: 'session-safe',
    turn: 1, callId: 'call-safe', messageHash: 'a'.repeat(64), receiptId: 'receipt-safe',
    action: 'read_segment', snapshotId: parentSnapshotId, segmentIndex: 0 }
  runtime.handlePersonalDesktopMessage(child, { ...frame, segmentIndex: 32 })
  runtime.handlePersonalDesktopMessage(child, { ...frame, snapshotId: 'https://example.com/page' })
  assert.equal(calls.length, 0)
  runtime.handlePersonalDesktopMessage(child, frame)
  for (let index = 0; index < 20 && sent.length < 1; index++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].snapshotId, parentSnapshotId)
  assert.equal(sent[0].ok, true)
  assert.equal(sent[0].command.text, text)
  assert.equal(sent[0].command.parentSnapshotId, parentSnapshotId)
  assert.equal(JSON.stringify(sent[0]).includes('privateCapturePath'), false)
})
