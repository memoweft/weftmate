import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { uiCoreAssets } from '../src/ui-core/manifest.mjs'

function bridgeFixture() {
  const messages: any[] = [], events: any[] = []
  const context: any = { URL, Map, Promise, Error, setTimeout, clearTimeout }
  runInNewContext(readFileSync(new URL('../src/ui-core/store.js', import.meta.url), 'utf8') + '\n' +
    readFileSync(new URL('../src/ui-core/adapters/android-bridge.js', import.meta.url), 'utf8'), context)
  const bridge = context.WeftUiCore.createAndroidBridge({ postMessage: (text: string) => messages.push(JSON.parse(text)),
    onEvent: (event: any) => events.push(event) })
  const reply = (index: number, result: any, error?: string) => bridge.receive({ data: JSON.stringify(error
    ? { id: messages[index].id, ok: false, error: { code: error } }
    : { id: messages[index].id, ok: true, result }) })
  return { bridge, messages, events, reply }
}

test('Android bridge maps core history tail, older and detail requests to native cache routes', async () => {
  const h = bridgeFixture(), tail = h.bridge.fetch('/personal/v1/sessions/s1/events?limit=100')
  assert.deepEqual(h.messages[0].params, { sessionId: 's1' })
  h.reply(0, { source: 'host', sessionId: 's1', events: [], nextSeq: 24, hasMore: false, hasOlder: true, nextBeforeSeq: 20, cached: true })
  assert.equal((await (await tail).json()).cached, true)
  const older = h.bridge.fetch('/personal/v1/sessions/s1/events?beforeSeq=20&limit=100')
  assert.deepEqual(h.messages[1].params, { sessionId: 's1', beforeSeq: 20 })
  h.reply(1, { source: 'host', sessionId: 'different', events: [] })
  assert.equal((await older).ok, false)
  const detail = h.bridge.fetch('/personal/v1/sessions/s1/events/8/detail')
  assert.equal(h.messages[2].method, 'shared.sessions.eventDetail')
  h.reply(2, { text: 'synthetic detail' })
  assert.equal((await (await detail).json()).text, 'synthetic detail')
})

test('Android bridge forwards decisions with the same request ID and keeps credentials native', async () => {
  const h = bridgeFixture(), response = h.bridge.fetch('/personal/v1/sessions/s1/approvals/a1', {
    method: 'POST', headers: { 'X-WeftMate-CSRF': 'native:3' }, credentials: 'same-origin',
    body: JSON.stringify({ requestId: 'saved-request', outcome: 'allowed-once', scope: 'conversation-category' }),
  })
  assert.equal(h.messages[0].method, 'shared.approvals.decide')
  assert.deepEqual(h.messages[0].params, { sessionId: 's1', approvalId: 'a1', requestId: 'saved-request', outcome: 'allowed-once', scope: 'conversation-category' })
  assert.equal(JSON.stringify(h.messages).includes('native:3'), false)
  h.reply(0, { requestId: 'saved-request', approval: { status: 'answered' } })
  assert.equal((await response).ok, true)
  const restart = h.bridge.fetch('/personal/v1/system/local-model/restart', { method: 'POST', body: '{}' })
  assert.equal(h.messages[1].method, 'host.business')
  h.reply(1, { restarted: true })
  assert.equal((await restart).ok, true)
  const stop = h.bridge.fetch('/personal/v1/tasks/task-test/stop', { method: 'POST',
    body: JSON.stringify(JSON.stringify({ requestId: 'saved-stop-request' })) })
  assert.deepEqual(h.messages[2].params, { taskId: 'task-test', requestId: 'saved-stop-request' })
  assert.equal(h.messages[2].method, 'shared.tasks.stop')
  h.reply(2, { stopped: true })
  assert.equal((await stop).ok, true)
})

test('Android bridge correlates out-of-order replies and separately delivers native events', async () => {
  const h = bridgeFixture(), a = h.bridge.call('conversations.list'), b = h.bridge.call('settings.appearance')
  h.reply(1, { value: 'dark' })
  h.bridge.receive({ data: JSON.stringify({ event: 'chat.finished', data: { conversationId: 'synthetic' } }) })
  h.reply(0, { conversations: [] })
  assert.equal((await b).value, 'dark')
  assert.equal((await a).conversations.length, 0)
  assert.equal(h.events[0].event, 'chat.finished')
})

test('Android bridge maps account/model shapes and preserves native error codes', async () => {
  const h = bridgeFixture(), profile = h.bridge.fetch('/personal/v1/auth/me')
  h.reply(0, { owner: 'synthetic-owner', username: 'phone', device: { id: 'device-test' } })
  const value = await (await profile).json()
  assert.equal(value.account.ownerId, 'synthetic-owner')
  assert.equal(value.device.id, 'device-test')
  const models = h.bridge.fetch('/personal/v1/models')
  h.reply(1, { models: [{ profileId: 'cloud-model', modelId: 'synthetic', displayName: '合成模型' }] })
  assert.equal((await (await models).json()).models[0].id, 'cloud-model')
  const unavailable = h.bridge.fetch('/personal/v1/memory/status')
  h.reply(2, null, 'UNAUTHORIZED')
  assert.equal((await unavailable).status, 401)
  assert.equal((await (await unavailable).json()).error.code, 'UNAUTHORIZED')
})

test('expired native login preserves phone scope and draft without invoking desktop login controls', async () => {
  const context: any = { URL, Map, Set, Promise, Error, Date, AbortSignal, setTimeout, clearTimeout }
  for (const name of uiCoreAssets) runInNewContext(readFileSync(new URL(`../src/ui-core/${name}`, import.meta.url), 'utf8'), context)
  const mobile: any = { owner: 'synthetic-scope', username: 'phone', deviceId: 'device-test', loggedIn: true,
    authEpoch: 1, sharedGeneration: 0, chatSource: 'host', page: 'settings', sharedSessions: [],
    sharedEvents: [], handoffViews: new Map(), linkedEvents: new Map(), sharedHostAvailable: true, draft: '仍在草稿里' }
  const core = context.WeftUiCore.create({ mobileState: mobile,
    storage: { getItem: () => null }, effects: { updateComposer() {} },
    fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 'UNAUTHORIZED' } }) }),
  })
  core.syncMobileIdentity()
  await assert.rejects(core.readMobileSystem(), (error: any) => error.code === 'UNAUTHORIZED')
  assert.equal(mobile.connection, 'expired')
  assert.equal(mobile.owner, 'synthetic-scope')
  assert.equal(mobile.draft, '仍在草稿里')
})
