import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createModFrameBridge, modRequestPayload } from '../src/plugins/weftmate-client/mod-projects-client.js'
import { deriveModState } from '../src/plugins/weftmate-client/mod-state.mjs'
import { EXTERNAL_AGENT_TEMPLATE } from '../src/runtime/mod-projects/template.mjs'

const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

class FakePort {
  closed = false
  onmessage: ((event: any) => void) | null = null
  messages: any[] = []
  postMessage(value: any) { this.messages.push(value) }
  close() { this.closed = true }
}
class FakeChannel {
  static all: FakeChannel[] = []
  port1 = new FakePort()
  port2 = new FakePort()
  constructor() { FakeChannel.all.push(this) }
}

test('V2 Mods workspace subscribes to the official session list, remains opt-in, and preserves DSH conversation entrances', () => {
  assert.match(client, /sessions\.list\.subscribe/)
  assert.match(client, /sessions\.list\.getSnapshot/)
  assert.match(client, /React\.useSyncExternalStore/)
  assert.doesNotMatch(client, /useSessions: ctx\.sessions/)
  const sessionList = { current: 'official-session-1' }
  assert.equal(sessionList.current, 'official-session-1')
  assert.match(client, /React\.useEffect\(function \(\) \{ if \(opened\) list\(\) \}, \[opened, ownerSessionId\]\)/)
  assert.match(client, /if \(opened\) list\(\)/)
  assert.doesNotMatch(client.slice(client.indexOf('React\.useEffect(function \(\) { if (opened) list() }'), client.indexOf('var chosen =')), /act\('start'/)
  assert.match(client, /register\(\{ name: 'tool\.call\.toolview', key: 'phone_execution' \}, PhoneExecutionRow\)/)
  assert.match(client, /register\(\{ name: 'conversation\.details\.supplement', key: 'phone_execution' \}, AiGameExecutionDetails\)/)
  assert.match(client, /\/weftmate\/mods\/projects\.json\?session_id=/)
  assert.match(client, /name: 'shell\.overlay',\s*id: 'weftmate-v2-shell'/)
  assert.doesNotMatch(client, /name: 'sidebar\.footer\.action', id: 'weftmate-mods'/)
  assert.match(client, /处理进度/)
  assert.doesNotMatch(client, /创建候选|验证最新候选|选择最新版本|记录需求/)
  assert.doesNotMatch(client, /complete-update/)
  assert.match(client, /maintainer === ownerSessionId \? old/)
  assert.match(client, /直接在本项目专属对话提出修改/)
  assert.match(client, /old\.versionKey === versionKey \? old/)
  assert.match(client, /onReady: function \(\) \{ handshakeRef\.current = true; if \(handshakeTimerRef\.current\)/)
  assert.match(client, /if \(!opened \|\| !chosenId\) return undefined/)
  assert.match(client, /import\('\/weftmate\/mods\/bridge\.mjs'\)/)
  assert.match(client, /业务界面桥接加载失败。/)
  assert.doesNotMatch(client, /import\('\.\/mod-projects-client\.js'\)/)
})

test('Mod request payloads retain the real session, explicit user start, and frame-scoped invoke', () => {
  assert.deepEqual(modRequestPayload('owner-1', 'start', { project_id: 'mod-1', user_initiated: true }).body, {
    session_id: 'owner-1', action: 'start', project_id: 'mod-1', user_initiated: true,
  })
  assert.deepEqual(modRequestPayload('owner-1', 'invoke', {
    project_id: 'mod-1', frame_token: 'frame-token', request: { action: 'increment', payload: { by: 1 } },
  }).body, {
    session_id: 'owner-1', action: 'invoke', project_id: 'mod-1', frame_token: 'frame-token', request: { action: 'increment', payload: { by: 1 } },
  })
  assert.throws(() => modRequestPayload('', 'list'), /real session id/)
  assert.match(client, /modRequest\(ownerSessionId, 'invoke', \{ project_id: chosenId, frame_token: frameToken, request:/)
})

test('blocked capability health takes precedence over a stopped desired state in Mod controls', () => {
  const state = deriveModState({ health: 'blocked', desiredState: 'stopped', stopReason: 'blocked_missing_capabilities' })
  assert.deepEqual({ id: state.id, label: state.label, tone: state.tone, transient: state.transient }, {
    id: 'blocked', label: '缺少必需能力', tone: 'err', transient: false,
  })
})

test('external-agent template uses CSP-compatible external UI assets', () => {
  const files = EXTERNAL_AGENT_TEMPLATE.files
  assert.match(files['ui/index.html'], /<link rel="stylesheet" href="\.\/style\.css">/)
  assert.match(files['ui/index.html'], /<script defer src="\.\/app\.js"><\/script>/)
  assert.doesNotMatch(files['ui/index.html'], /<script>/)
  assert.doesNotMatch(files['ui/app.js'], /\b(?:import|export)\b/)
  assert.match(files['ui/app.js'], /weftmate-mod-ready/)
  assert.match(files['ui/app.js'], /weftmate-mod-action/)
  assert.match(files['ui/app.js'], /send\('status'\)/)
  assert.match(files['src/main.mjs'], /request\?\.action === 'status'\) return state/)
  assert.match(files['ui/index.html'], /加 1/)
  assert.match(files['ui/style.css'], /main \{/)
})

test('opaque frame bridge rejects foreign source and token, survives load handshake, returns action result, and closes ports', async () => {
  FakeChannel.all = []
  const sent: any[] = []
  const childWindow = { postMessage: (...args: any[]) => sent.push(args) }
  const frame = { contentWindow: childWindow }
  const received: any[] = []
  const bridge = createModFrameBridge({ frame, token: 'token-1', MessageChannel: FakeChannel, onAction: value => { received.push(value); if (value.action === 'fail') throw new Error('业务暂不可用'); return { count: 1 } } })

  assert.equal(bridge.requestHandshake(), true)
  assert.equal(sent[0][0].type, 'weftmate-mod-init', 'iframe receives token only after bridge has been created')
  assert.equal(bridge.receiveWindowMessage({ source: {}, data: { type: 'weftmate-mod-ready', token: 'token-1' } }), false)
  assert.equal(bridge.receiveWindowMessage({ source: childWindow, data: { type: 'weftmate-mod-ready', token: 'wrong' } }), false)
  assert.equal(sent.length, 1, 'foreign or wrong-token ready messages cannot create a port')
  assert.equal(bridge.receiveWindowMessage({ source: childWindow, data: { type: 'weftmate-mod-ready', token: 'token-1' } }), true)
  assert.equal(sent.length, 2)
  assert.equal(sent[1][0].type, 'weftmate-mod-connect')
  assert.equal(sent[1][1], '*', 'opaque iframe is addressed only after exact source/token admission')

  const port = FakeChannel.all[0].port1
  port.onmessage!({ data: { type: 'weftmate-mod-action', token: 'wrong', requestId: 'r-wrong', action: 'increment' } })
  port.onmessage!({ data: { type: 'weftmate-mod-action', token: 'token-1', requestId: 'r-1', action: 'increment', payload: { by: 1 } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(received, [{ requestId: 'r-1', action: 'increment', payload: { by: 1 } }])
  assert.deepEqual(port.messages, [{ type: 'weftmate-mod-result', token: 'token-1', requestId: 'r-1', result: { count: 1 } }])
  port.onmessage!({ data: { type: 'weftmate-mod-action', token: 'token-1', requestId: 'r-2', action: 'fail' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(port.messages.at(-1), { type: 'weftmate-mod-error', token: 'token-1', requestId: 'r-2', error: '业务暂不可用' })
  bridge.dispose()
  assert.equal(port.closed, true)
  assert.equal(FakeChannel.all[0].port2.closed, true)
  assert.equal(bridge.receiveWindowMessage({ source: childWindow, data: { type: 'weftmate-mod-ready', token: 'token-1' } }), false)
})
