import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { carrierOrigin, DshViewCarrier } from '../src/dsh-view-carrier.mjs'

class Contents extends EventEmitter {
  mainFrame = { url: 'about:blank' }
  destroyed = false
  sent: any[] = []
  loaded: string[] = []
  opener: any
  async loadURL(url: string) { this.loaded.push(url); this.mainFrame.url = url }
  getURL() { return this.mainFrame.url }
  setWindowOpenHandler(fn: any) { this.opener = fn }
  send(...args: any[]) { this.sent.push(args) }
  isDestroyed() { return this.destroyed }
  close() { this.destroyed = true }
  focus() {}
}
class View {
  webContents = new Contents()
  bounds: any
  visible = true
  options: any
  constructor(options: any) { this.options = options }
  setBounds(value: any) { this.bounds = value }
  setVisible(value: boolean) { this.visible = value }
}
function fixture() {
  const ipc = new EventEmitter()
  const parent = Object.assign(new EventEmitter(), { isDestroyed: () => false, contentView: { addChildView() {}, removeChildView() {} } })
  const carrier = new DshViewCarrier({ WebContentsView: View, ipcMain: ipc, parent })
  const wc = carrier.view.webContents as Contents
  const report = (value: any, event = { sender: wc, senderFrame: wc.mainFrame }) => ipc.emit('wm:chat-carrier:report', event, value)
  return { carrier, ipc, parent, wc, report }
}

test('carrier rejects remote/credential origins and keeps sandbox, exact main-frame IPC admission', async () => {
  for (const value of ['https://example.com', 'http://localhost:80/', 'http://x@127.0.0.1:8000/', 'http://127.0.0.1:8000/path', 'http://127.0.0.1:8000/?key=x']) assert.throws(() => carrierOrigin(value))
  const { carrier, wc, report } = fixture()
  try {
    await carrier.bind('http://127.0.0.1:8000/')
    assert.deepEqual(wc.loaded, ['about:blank', 'http://127.0.0.1:8000'])
    assert.equal(carrier.view.options.webPreferences.sandbox, true)
    assert.equal(carrier.view.options.webPreferences.nodeIntegration, false)
    assert.deepEqual(wc.opener(), { action: 'deny' })
    report({ kind: 'state', sessionId: 'forged' }, { sender: wc, senderFrame: { url: wc.getURL() } })
    assert.equal(carrier.state, null)
    report({ kind: 'state', sessionId: 'owner', theme: 'dark' })
    assert.deepEqual(carrier.state, { sessionId: 'owner', theme: 'dark' })
    let prevented = false
    wc.emit('will-navigate', { preventDefault() { prevented = true } }, 'https://example.com')
    assert.equal(prevented, true)
  } finally { carrier.dispose() }
})

test('carrier commands acknowledge actual official state and reject stale commands on rebind', async () => {
  const { carrier, wc, report } = fixture()
  try {
    await carrier.bind('http://127.0.0.1:8001/')
    report({ kind: 'state', sessionId: 'one', theme: 'light' })
    await assert.rejects(carrier.command({ type: 'execute', source: 'evil' }), /Invalid/)
    const selected = carrier.command({ type: 'select-session', sessionId: 'two' })
    const id = wc.sent.at(-1)[1].id
    report({ kind: 'state', sessionId: 'two', theme: 'light' })
    report({ kind: 'reply', id, ok: true })
    assert.equal((await selected).sessionId, 'two')
    const pending = carrier.command({ type: 'theme', theme: 'dark' })
    const rejected = assert.rejects(pending, /binding changed/)
    await carrier.bind('http://127.0.0.1:8002/')
    await rejected
    assert.equal(carrier.state, null)
    report({ kind: 'state', sessionId: 'old' }, { sender: wc, senderFrame: { url: 'http://127.0.0.1:8001/' } })
    assert.equal(carrier.state, null)
    assert.equal(carrier.origin, 'http://127.0.0.1:8002')
  } finally { carrier.dispose() }
})

test('carrier hide keeps contents; close disposes listeners, pending replies and contents', async () => {
  const { carrier, parent, ipc, wc, report } = fixture()
  await carrier.bind('http://127.0.0.1:8003/')
  carrier.setVisible(false)
  carrier.setVisible(true)
  assert.equal(wc.isDestroyed(), false)
  carrier.setBounds({ x: -1, y: 44, width: 760.3, height: 500 })
  assert.deepEqual(carrier.view.bounds, { x: 0, y: 44, width: 760, height: 500 })
  report({ kind: 'state', sessionId: 'one' })
  const pending = carrier.command({ type: 'theme', theme: 'dark' })
  const rejected = assert.rejects(pending, /closed/)
  parent.emit('closed')
  await rejected
  assert.equal(wc.isDestroyed(), true)
  assert.equal(ipc.listenerCount('wm:chat-carrier:report'), 0)
  carrier.dispose()
})
