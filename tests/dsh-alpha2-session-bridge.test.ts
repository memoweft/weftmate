import assert from 'node:assert/strict'
import test from 'node:test'
import { createAlpha2SessionBridge } from '../src/plugins/weftmate-alpha2-session-bridge.mjs'

test('alpha2 host bridge delegates every ordinary session action to the official gateway', async () => {
  const calls: Array<Record<string, unknown>> = []
  const gateway = {
    async invoke(request: Record<string, unknown>) {
      calls.push(request)
      if (request.namespace === 'session' && request.method === 'list') return { items: [{ sessionId: 'synthetic-session', running: false }] }
      if (request.namespace === 'permissionPresets') return { options: [{ value: 'workspace-write' }], defaultPreset: 'workspace-write' }
      return { accepted: true }
    },
    async stream(request: Record<string, unknown>) {
      calls.push(request)
      return (async function * () { yield { type: 'snapshot', cursor: -1, records: [] } })()
    },
  }
  const session = { id: 'synthetic-session' }
  const bridge = createAlpha2SessionBridge({
    gateway,
    sessionController: { async resolveAgent() { return { agent: { session } } } },
    permissionPresets: {
      names: ['workspace-write'],
      set(target: unknown, preset: string) { assert.equal(target, session); assert.equal(preset, 'workspace-write') },
      current() { return 'workspace-write' },
    },
  })

  assert.deepEqual(await bridge.list(), { items: [{ sessionId: 'synthetic-session', running: false }] })
  assert.deepEqual(await bridge.create({ cwd: 'D:/synthetic' }), { accepted: true })
  assert.deepEqual(await bridge.prompt({ sessionId: 'synthetic-session', requestId: 'request-1', mode: 'queue', content: [{ type: 'text', text: 'synthetic only' }] }), { accepted: true })
  assert.deepEqual(await bridge.cancel('synthetic-session'), { accepted: true })
  assert.deepEqual(await bridge.createWorkspace({ path: 'D:/synthetic' }), { accepted: true })
  assert.deepEqual(await bridge.setPermissionPreset('synthetic-session', 'workspace-write'), { accepted: true, preset: 'workspace-write' })
  const stream = await bridge.follow({ address: { kind: 'session', sessionId: 'synthetic-session' }, assistantStream: true })
  assert.deepEqual(await stream[Symbol.asyncIterator]().next(), { done: false, value: { type: 'snapshot', cursor: -1, records: [] } })
  const status = await bridge.status()
  assert.equal(status.sessionCount, 1)
  assert.deepEqual(bridge.capabilities, {
    transport: 'official-typert-remote-v4', sessionController: 'official', list: true, create: true,
    modelCatalog: true, prompt: true, cancel: true, follow: true, recover: true,
    permissionPresets: true, workspace: true, memoWeft: false, mods: false,
  })
  assert.deepEqual(calls.map(call => [call.namespace, call.method, call.args]), [
    ['session', 'list', { _request: {} }], ['session', 'create', { request: { cwd: 'D:/synthetic' } }],
    ['session', 'prompt', { request: { sessionId: 'synthetic-session', requestId: 'request-1', mode: 'queue', content: [{ type: 'text', text: 'synthetic only' }] } }],
    ['session', 'cancel', { request: { sessionId: 'synthetic-session' } }],
    ['workspace', 'create', { request: { path: 'D:/synthetic' } }],
    ['session', 'follow', { request: { address: { kind: 'session', sessionId: 'synthetic-session' }, assistantStream: true } }],
    ['session', 'list', { _request: {} }], ['permissionPresets', 'catalog', {}],
  ])
})

test('alpha2 host bridge refuses unknown permission presets before touching a session', async () => {
  let resolved = false
  const bridge = createAlpha2SessionBridge({
    gateway: { async invoke() { return {} }, async stream() { return (async function * () {})() } },
    sessionController: { async resolveAgent() { resolved = true; return { agent: { session: {} } } } },
    permissionPresets: { names: ['workspace-write'], set() {}, current() { return 'workspace-write' } },
  })
  await assert.rejects(bridge.setPermissionPreset('synthetic-session', 'not-a-preset'), /not available/)
  assert.equal(resolved, false)
})
