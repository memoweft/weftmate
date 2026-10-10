import { stagePersonalPlugins } from './support/personal-plugins.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'
import { sourceRange } from '../src/runtime/dsh-adapter/source-range.mjs'

async function loadPlugin() {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-project-proof-'))
  const file = stagePersonalPlugins(root).plugin
  try { return await import(file) }
  finally { rmSync(root, { recursive: true, force: true }) }
}
const proof = { sessionId: 'session-a', turn: 1, readCallId: 'read-a',
  snapshotId: 'snapshot-a', sourceReceiptId: 'receipt-a', beforeCallId: 'save-a' }
function storedEvents() {
  return [
    { type: 'session', version: 0, id: 'session-a', agentPreset: 'personal-remote' },
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId: 'receipt-a' },
      content: [{ type: 'text', text: 'same text' }] } },
    { seq: 3, type: 'tool/call', data: { turn: 1, callId: 'read-a', name: 'personal_read_project_file' } },
    { seq: 4, type: 'tool/result', data: { turn: 1, message: { source: { kind: 'tool', callId: 'read-a' },
      content: [{ type: 'tool-result', toolCallId: 'read-a', content: [{ type: 'text',
        text: JSON.stringify({ snapshotId: 'snapshot-a', fileSha256: 'a'.repeat(64), text: 'actual read' }) }] }] } } },
    { seq: 5, type: 'tool/call', data: { turn: 1, callId: 'save-a', name: 'personal_save_document' } },
  ]
}
const encoded = (events: any[]) => `${events.map((event) => JSON.stringify(event)).join('\n')}\n`

test('artifact provenance in a 23000+ event history reads only its bound native turn', async () => {
  const plugin = await loadPlugin(), events: any[] = []
  const push = (type: string, data: object) => events.push({ seq: events.length, type, data })
  for (let turn = 1; turn <= 1000; turn++) {
    push('turn/start', { turn })
    push('user/message', { source: { kind: 'user', rpcId: `old-${turn}` } })
    for (let step = 1; step <= 10; step++) { push('step/start', { turn, step }); push('step/end', { turn, step }) }
    push('turn/end', { turn, reason: { kind: 'completed' } })
  }
  const start = events.length
  for (const event of storedEvents().slice(1)) events.push({ ...event, seq: events.length,
    data: { ...event.data, ...(event.data.turn === undefined ? {} : { turn: 1001 }) } })
  const visited: number[] = []
  const log = new Proxy(events, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) visited.push(Number(key))
    return Reflect.get(target, key, receiver)
  } })
  const range = sourceRange(log, { turn: 1001 })!
  assert.equal(range.start, start); assert.equal(range.events.length, 5)
  assert.ok(visited.length < 80, `${visited.length} lookups, no old turn replay`)
  assert.equal(plugin.verifyStoredProjectRead(range.events, { ...proof, turn: 1001 }), true)
  assert.equal(plugin.verifyStoredProjectRead(range.events, { ...proof, turn: 1001, sourceReceiptId: 'old-1' }), false)
})

test('physical DSH read result proves only its exact source receipt, snapshot and earlier call', async () => {
  const plugin = await loadPlugin()
  const events = storedEvents()
  assert.equal(plugin.verifyStoredProjectRead(encoded(events), proof), true)
  assert.equal(plugin.verifyStoredProjectRead(encoded(events), { ...proof, sourceReceiptId: 'receipt-b' }), false)
  assert.equal(plugin.verifyStoredProjectRead(encoded(events), { ...proof, snapshotId: 'snapshot-b' }), false)
  assert.equal(plugin.verifyStoredProjectRead(encoded(events), { ...proof, turn: 2 }), false)
  assert.equal(plugin.verifyStoredProjectRead(encoded(events), { ...proof, readCallId: 'read-b' }), false)
  assert.equal(plugin.verifyStoredProjectRead(encoded(events), { ...proof, beforeCallId: 'save-b' }), false)
  assert.equal(plugin.verifyStoredProjectRead(encoded(events.slice(0, 4)), proof), false,
    'a live-only result that is absent from the committed artifact cannot prove a source')
  assert.equal(plugin.verifyStoredProjectRead(encoded(events.slice(0, 5)), proof), false,
    'the save call itself must also be committed')
  const failed = structuredClone(events)
  failed[4].data.message.content[0].isError = true
  assert.equal(plugin.verifyStoredProjectRead(encoded(failed), proof), false)
  const wrongOrder = structuredClone(events)
  ;[wrongOrder[4], wrongOrder[5]] = [wrongOrder[5], wrongOrder[4]]
  wrongOrder[4].seq = 4; wrongOrder[5].seq = 5
  assert.equal(plugin.verifyStoredProjectRead(encoded(wrongOrder), proof), false)
  const mixed = structuredClone(events)
  mixed.splice(4, 0, { seq: 4, type: 'user/message', data: { source: { kind: 'user', rpcId: 'receipt-b' } } })
  mixed[5].seq = 5; mixed[6].seq = 6
  assert.equal(plugin.verifyStoredProjectRead(encoded(mixed), proof), false)
  const onlyList = structuredClone(events)
  onlyList[3].data.name = 'personal_list_project_files'
  assert.equal(plugin.verifyStoredProjectRead(encoded(onlyList), proof), false)
})

test('physical proof admits only the requested successful browser read tool before save', async () => {
  const plugin = await loadPlugin()
  const events = storedEvents()
  const webId = `source-${'b'.repeat(48)}`
  events[3].data.name = 'personal_browser_open'
  events[4].data.message.content[0].content[0].text = JSON.stringify({
    snapshotId: webId, contentSha256: 'a'.repeat(64), url: 'https://example.com/page',
    text: 'rendered visible content', links: [] })
  const webProof = { ...proof, snapshotId: webId, readTool: 'personal_browser_open' }
  assert.equal(plugin.verifyStoredProjectRead(encoded(events), webProof), true)
  assert.equal(plugin.verifyStoredProjectRead(encoded(events), { ...webProof, readTool: 'personal_browser_follow' }), false)
  assert.equal(plugin.verifyStoredProjectRead(encoded(events), { ...webProof, sourceReceiptId: 'other' }), false)
  assert.equal(plugin.verifyStoredProjectRead(encoded(events), { ...webProof, snapshotId: `source-${'c'.repeat(48)}` }), false)
  const onlyObservedLink = structuredClone(events)
  onlyObservedLink[3].data.name = 'personal_browser_follow'
  onlyObservedLink.splice(4, 1)
  onlyObservedLink[4].seq = 4
  assert.equal(plugin.verifyStoredProjectRead(encoded(onlyObservedLink),
    { ...webProof, readTool: 'personal_browser_follow' }), false)
  const failed = structuredClone(events)
  failed[4].data.error = { code: 'BROWSER_NETWORK_ERROR', name: 'Error' }
  assert.equal(plugin.verifyStoredProjectRead(encoded(failed), webProof), false)
  const follow = structuredClone(events)
  follow[3].data.name = 'personal_browser_follow'
  assert.equal(plugin.verifyStoredProjectRead(encoded(follow),
    { ...webProof, readTool: 'personal_browser_follow' }), true)
  const priorReadBeforeFollow = structuredClone(events)
  priorReadBeforeFollow[5].data.name = 'personal_browser_follow'
  assert.equal(plugin.verifyStoredProjectRead(encoded(priorReadBeforeFollow), webProof), false)
  assert.equal(plugin.verifyStoredProjectRead(encoded(priorReadBeforeFollow),
    { ...webProof, beforeTool: 'personal_browser_follow' }), true)
  const priorReadBeforeSegment = structuredClone(events)
  priorReadBeforeSegment[5].data.name = 'personal_browser_read_segment'
  assert.equal(plugin.verifyStoredProjectRead(encoded(priorReadBeforeSegment), webProof), false)
  assert.equal(plugin.verifyStoredProjectRead(encoded(priorReadBeforeSegment),
    { ...webProof, beforeTool: 'personal_browser_read_segment' }), true)
  const segment = structuredClone(events)
  segment[3].data.name = 'personal_browser_read_segment'
  segment[4].data.message.content[0].content[0].text = JSON.stringify({
    snapshotId: webId, parentSnapshotId: `source-${'c'.repeat(48)}`,
    contentSha256: 'a'.repeat(64), url: 'https://example.com/page',
    text: 'actually read segment', segmentIndex: 0, segmentCount: 2 })
  assert.equal(plugin.verifyStoredProjectRead(encoded(segment),
    { ...webProof, readTool: 'personal_browser_read_segment' }), true)
  assert.equal(plugin.verifyStoredProjectRead(encoded(segment), webProof), false)
})

test('parent proof IPC accepts only current child, strict reply and bounded timeout', async () => {
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\home', workspaceDir: 'C:\\synthetic\\work' }) as any
  const sent: any[] = []
  const child = { connected: true, send: (frame: any, callback: any) => { sent.push(frame); callback?.(null) } }
  const stale = { connected: true, send: () => {} }
  runtime.child = child
  runtime.originValue = 'http://127.0.0.1:12345'
  const first = runtime.verifyPersonalToolResult(proof)
  runtime.handleProjectProofMessage(stale, { protocol: sent[0].protocol, id: sent[0].id, verified: true })
  assert.equal(runtime.projectProofPending.size, 1)
  runtime.handleProjectProofMessage(child, { protocol: sent[0].protocol, id: sent[0].id,
    verified: true, leaked: 'body' })
  assert.equal(await first, false)
  const second = runtime.verifyPersonalToolResult(proof)
  runtime.handleProjectProofMessage(child, { protocol: sent[1].protocol, id: sent[1].id, verified: true })
  assert.equal(await second, true)
  const replaced = runtime.verifyPersonalToolResult(proof)
  runtime.child = stale
  runtime.failProjectProofRequests(child)
  assert.equal(await replaced, false)
  runtime.child = child
  const disconnected = runtime.verifyPersonalToolResult(proof)
  child.connected = false
  runtime.failProjectProofRequests(child)
  assert.equal(await disconnected, false)
  child.connected = true
  assert.equal(await runtime.verifyPersonalToolResult(proof), false, 'missing response times out closed')
  assert.equal(runtime.projectProofPending.size, 0)
})

test('project reader failure survives the actual child bridge without losing the UTF8 code', async () => {
  const plugin = await loadPlugin()
  class Transport extends EventEmitter {
    connected = true
    sent: any[] = []
    send(frame: any, callback: any) { this.sent.push(frame); callback?.(null) }
  }
  const transport = new Transport()
  const bridge = new plugin.PersonalDesktopBridge(transport)
  try {
    const result = bridge.request({ action: 'read_project', sessionId: 'session-a' })
    assert.equal(transport.sent.length, 1)
    transport.emit('message', { protocol: plugin.PERSONAL_DESKTOP_PROTOCOL,
      id: transport.sent[0].id, ok: false, error: 'PROJECT_INVALID_UTF8' })
    await assert.rejects(result, (error: any) => error?.code === 'PROJECT_INVALID_UTF8')
    for (const code of ['BROWSER_DNS_TIMEOUT', 'BROWSER_DOWNGRADE_BLOCKED',
      'BROWSER_PAGE_CHANGED', 'BROWSER_CLEANUP_FAILED']) {
      const pending = bridge.request({ action: 'open_page', sessionId: 'session-a' })
      const frame = transport.sent.at(-1)
      transport.emit('message', { protocol: plugin.PERSONAL_DESKTOP_PROTOCOL,
        id: frame.id, ok: false, error: code })
      await assert.rejects(pending, (error: any) => error?.code === code)
    }
  } finally { bridge.close() }
})
