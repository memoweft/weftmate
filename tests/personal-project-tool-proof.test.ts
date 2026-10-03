import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'

const vendorTools = pathToFileURL(join(process.cwd(), 'vendor', 'dsh-runtime', 'node_modules',
  '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')).href
async function loadPlugin() {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-project-proof-'))
  const source = readFileSync(join(process.cwd(), 'src', 'plugins', 'weftmate-personal-desktop.mjs'), 'utf8')
    .replace("from '@deepseek-ai/dsh-tools'", `from '${vendorTools}'`)
  const file = join(root, 'weftmate-personal-desktop.mjs')
  writeFileSync(file, source)
  try { return await import(pathToFileURL(file).href) }
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
  } finally { bridge.close() }
})
