import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { apply, modelIdleSnapshot, PROTOCOL } from '../src/plugins/weftmate-personal-model-idle.mjs'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'

test('the pinned primary SDK exposes live Agent[] status and Inbox.hasPending', () => {
  const agentTypes = readFileSync('vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-agent/lib/types/index.d.ts', 'utf8')
  const runtimeTypes = readFileSync('vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts', 'utf8')
  const inboxTypes = readFileSync('vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-agent/lib/types/inbox.d.ts', 'utf8')
  const implementation = readFileSync('vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-agent/lib/index.js', 'utf8')
  assert.match(agentTypes, /list\(\): Agent\[\]/)
  assert.match(runtimeTypes, /export type AgentStatus = 'idle' \| 'running'/)
  assert.match(runtimeTypes, /readonly inbox: Inbox/)
  assert.match(inboxTypes, /get hasPending\(\): boolean/)
  assert.match(implementation, /list\(\) \{\s*return \[\.\.\.this\.store\.values\(\)\]\.map\(\(entry\) => entry\.agent\)/)
})

test('model idle reason is finite and fails closed for malformed live agent views', () => {
  assert.deepEqual(modelIdleSnapshot([]), { idle: true, reason: 'idle' })
  assert.deepEqual(modelIdleSnapshot([{ status: 'running', inbox: { hasPending: false } }]),
    { idle: false, reason: 'agent_running' })
  assert.deepEqual(modelIdleSnapshot([{ status: 'idle', inbox: { hasPending: true } }]),
    { idle: false, reason: 'inbox_pending' })
  for (const value of [null, {}, [{ status: 'paused', inbox: { hasPending: false } }],
    [{ status: 'idle', inbox: {} }]]) {
    assert.equal(modelIdleSnapshot(value as any).idle, false)
    assert.match(modelIdleSnapshot(value as any).reason, /_unknown$/)
  }
})

test('route reload fence treats a queued or running DSH agent as busy without reading message text', () => {
  const originalSend = process.send
  const replies: any[] = []
  let cleanup = () => {}
  let agents: any[] = []
  ;(process as any).send = (value: unknown) => { replies.push(value) }
  try {
    apply({ agents: { list: () => agents }, effect: (dispose: () => () => void) => { cleanup = dispose() } })
    const ask = () => {
      const id = `model-idle-${randomUUID()}`
      process.emit('message', { protocol: PROTOCOL, id })
      return replies.at(-1)
    }
    const first = ask()
    assert.deepEqual(first, { protocol: PROTOCOL, id: first.id, idle: true, reason: 'idle' })
    agents = [{ status: 'idle', inbox: { hasPending: true,
      nextTurn: [{ content: [{ type: 'text', text: 'synthetic private goal' }] }] } }]
    assert.equal(ask().reason, 'inbox_pending')
    agents = [{ status: 'running', inbox: { hasPending: false } }]
    assert.equal(ask().reason, 'agent_running')
    agents = [{ status: 'idle', inbox: { hasPending: false } }]
    assert.equal(ask().reason, 'idle')
    assert.equal(JSON.stringify(replies).includes('synthetic private goal'), false)
  } finally { cleanup(); (process as any).send = originalSend }
})

test('parent IPC preserves only a current-child finite reason and treats malformed replies as unknown', async () => {
  const runtime = new DshWebRuntime({ homeDir: process.cwd(), workspaceDir: process.cwd(),
    personalHostApiProxy: true }) as any
  let request: any = null
  const child = { connected: true, send(value: unknown, callback: (error?: Error) => void) {
    request = value; callback()
  } }
  runtime.child = child
  runtime.originValue = 'http://127.0.0.1:1'
  const pending = runtime.personalModelQueueIdle()
  runtime.handleModelIdleMessage(child, { ...request, idle: false, reason: 'inbox_pending' })
  assert.deepEqual(await pending, { idle: false, reason: 'inbox_pending' })

  const malformed = runtime.personalModelQueueIdle()
  runtime.handleModelIdleMessage(child, { ...request, idle: true, reason: 'agent_running' })
  assert.deepEqual(await malformed, { idle: false, reason: 'invalid_response' })
  runtime.child = undefined
  assert.deepEqual(await runtime.personalModelQueueIdle(),
    { idle: false, reason: 'runtime_unavailable' })
})

test('main publishes one local gate state and suppresses repeated reason logs', () => {
  const main = readFileSync('src/main.mjs', 'utf8')
  assert.match(main, /accountModelRouteGate: \{ \.\.\.accountModelRouteGate \}/)
  assert.match(main, /accountModelRouteGate\.idle === idle && accountModelRouteGate\.reasonCode === reasonCode\) return/)
  assert.match(main, /account-model route gate blocked reason=\$\{reasonCode\}/)
  assert.match(main, /account-model route gate idle previous=\$\{previous\}/)
  for (const reason of ['host_command_pending', 'session_state_busy', 'agent_running',
    'inbox_pending', 'agent_state_unknown', 'agent_list_unknown', 'runtime_unavailable',
    'timeout', 'ipc_unavailable', 'invalid_response', 'reference_scan_incomplete',
    'reference_scan_failed']) assert.ok(main.includes(`'${reason}'`), reason)
  assert.match(main, /try \{ assertSessionReferenceScanComplete\(\); \}\s*catch \{\s*noteAccountModelGate\(sessionReferenceScan\.state === 'failed'\s*\? 'reference_scan_failed' : 'reference_scan_incomplete'\)/)
})
