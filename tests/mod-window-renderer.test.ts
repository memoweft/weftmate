import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { MOD_WINDOW_JS } from '../src/plugins/weftmate-client/mod-window/assets.mjs'

test('status refresh preserves in-flight bridge, stop blocks focus and restart reuses the mounted page', async () => {
  const elements: any = {}
  for (const id of ['modFrame','hostBar','name','state','cover','coverTitle','coverText','start','back']) {
    elements[id] = { textContent: '', style: {}, dataset: {}, contentWindow: {}, src: '', classList: { toggle() {} }, events: {},
      addEventListener(name: string, fn: any) { this.events[name] = fn }, focus() { document.activeElement = this } }
  }
  const document: any = { getElementById: (id: string) => elements[id], body: { classList: { toggle(_key: string, dark: boolean) { document.dark = dark } } }, activeElement: elements.modFrame }
  let paint: (snapshot: any) => void = () => {}
  let created = 0, disposed = 0
  const window = { addEventListener() {}, weftmateModWindow: { onStatus(fn: any) { paint = fn; return () => {} },
    snapshot: async () => ({ connected: false }), invoke: async () => ({}), returnWorkspace: async () => ({}), control: async () => { throw new Error('private raw error') } } }
  vm.runInNewContext(MOD_WINDOW_JS.replace(/^import[^\n]+\n/, ''), { document, window, createModFrameBridge: () => { ++created; return { dispose() { ++disposed }, requestHandshake() {}, receiveWindowMessage() {} } } })
  await new Promise(resolve => setImmediate(resolve))
  const snapshot = { connected: true, theme: 'dark', project: { name: '资料收藏', activeVersionId: 'v1' }, state: { label: '运行中' }, controls: { canInvoke: true }, ui: { frameToken: 'token-1', assetUrl: '/asset/v1' } }
  paint(snapshot)
  elements.modFrame.events.load()
  assert.equal(created, 1)
  paint(snapshot); paint(snapshot)
  assert.equal(created, 1, 'stable lease must not reconnect every poll')
  assert.equal(disposed, 0)
  assert.equal(document.dark, true)
  for (const tone of ['warn', 'err', 'neutral']) { paint({ ...snapshot, state: { label: '测试状态', tone } }); assert.equal(elements.hostBar.dataset.tone, tone) }
  const stopped = { ...snapshot, state: { label: '已停止' }, controls: { canInvoke: false, canStart: true } }
  paint(stopped)
  assert.equal(elements.modFrame.inert, true)
  assert.equal(elements.modFrame.tabIndex, -1)
  assert.equal(document.activeElement, elements.back)
  assert.equal(disposed, 1)
  await elements.start.events.click()
  assert.match(elements.coverText.textContent, /启动失败/)
  assert.doesNotMatch(elements.coverText.textContent, /private/)
  paint(snapshot)
  assert.equal(created, 2, 'same-version restart reestablishes the bridge')
  assert.equal(elements.modFrame.src, '/asset/v1')
  assert.equal(elements.modFrame.inert, false)
  paint({ connected: false })
  assert.equal(elements.start.hidden, true)
  assert.equal(elements.coverText.textContent, '与 WeftMate 的连接已断开')
})
