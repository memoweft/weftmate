import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { ModWindowManager, deriveModState, modWindowUrl } from '../src/mod-window-manager.mjs'

class FakeWebContents extends EventEmitter {
  url = ''
  mainFrame = { url: '' }
  sent: Array<[string, unknown]> = []
  getURL() { return this.url }
  send(channel: string, value: unknown) { this.sent.push([channel, value]) }
  setWindowOpenHandler(_handler: unknown) {}
}

class FakeWindow extends EventEmitter {
  webContents = new FakeWebContents()
  destroyed = false
  shown = false
  focused = false
  minimized = false
  options: Record<string, unknown>
  constructor(options: Record<string, unknown>) { super(); this.options = options }
  async loadURL(url: string) { this.webContents.url = url; this.webContents.mainFrame.url = url }
  isDestroyed() { return this.destroyed }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('closed') }
  show() { this.shown = true }
  focus() { this.focused = true }
  isMinimized() { return this.minimized }
  restore() { this.minimized = false }
}

const running = () => ({
  project: { projectId: 'project-a', name: '资料收藏', activeVersionId: 'version-a', desiredState: 'running', health: 'running' },
  run: { status: 'running' }, update: { status: 'ready', lastError: null }, recentError: null,
  controls: { canStart: false, canStop: true, canInvoke: true, startBlockedReason: 'ALREADY_RUNNING', publishing: false },
  ui: { assetUrl: '/weftmate/mods/assets/project-a/session-a/token-a/index.html', frameToken: 'token-a' },
})

test('single Mod window stays a view, trusts only its exact wrapper frame, and refreshes controls', async () => {
  const handlers = new Map<string, Function>()
  const ipcMain = { handle: (name: string, handler: Function) => handlers.set(name, handler) }
  const windows: FakeWindow[] = []
  let snapshot: any = running()
  const invokes: any[] = []
  const workspaces: any[] = []
  const manager = new ModWindowManager({
    BrowserWindow: class { constructor(options: Record<string, unknown>) { const win = new FakeWindow(options); windows.push(win); return win } },
    ipcMain,
    getOrigin: () => 'http://127.0.0.1:49991',
    fetchSnapshot: async () => snapshot,
    invoke: async (value: unknown) => { invokes.push(value); return { ok: true } },
    control: async () => ({ ok: true }),
    preload: 'C:/test/mod-window-preload.cjs',
    onOpenWorkspace: value => workspaces.push(value),
  })
  assert.equal(modWindowUrl('http://127.0.0.1:49991', 'project-a', 'session-a'), 'http://127.0.0.1:49991/weftmate/mods/window.html?project_id=project-a&session_id=session-a')
  assert.deepEqual(await manager.open({ projectId: 'project-a', sessionId: 'session-a' }), { opened: true, focused: false })
  const win = windows[0]
  assert.equal(win.options.webPreferences && (win.options.webPreferences as any).nodeIntegration, false)
  assert.equal((win.options.webPreferences as any).contextIsolation, true)
  assert.equal((win.options.webPreferences as any).sandbox, true)
  assert.equal((win.options.webPreferences as any).webSecurity, true)
  assert.equal(await manager.open({ projectId: 'project-a', sessionId: 'session-a' }).then(value => value.focused), true)
  assert.equal(windows.length, 1, 'one project never opens a second view')
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
  await handlers.get('wm:mod-window:invoke')!(event, { action: 'append', payload: { title: 'one' } })
  assert.deepEqual(invokes[0], { projectId: 'project-a', sessionId: 'session-a', frameToken: 'token-a', request: { action: 'append', payload: { title: 'one' } } })
  assert.equal((await handlers.get('wm:mod-window:return-workspace')!(event)).ok, true)
  assert.deepEqual(workspaces, [{ projectId: 'project-a', sessionId: 'session-a' }])
  await assert.rejects(handlers.get('wm:mod-window:invoke')!({ sender: {}, senderFrame: {} }, { action: 'append' }), /不可用/)
  snapshot = { ...running(), project: { ...running().project, desiredState: 'stopped', health: 'stopped' }, run: { status: 'stopped' }, controls: { canStart: true, canStop: false, canInvoke: false, startBlockedReason: null, publishing: false }, ui: { assetUrl: '/weftmate/mods/assets/project-a/session-a/token-a/index.html', frameToken: 'token-a' } }
  await manager.refresh('project-a')
  assert.equal(win.webContents.sent.at(-1)?.[1]?.state?.id, 'stopped')
  await assert.rejects(handlers.get('wm:mod-window:invoke')!(event, { action: 'append' }), /不可用/)
  await manager.rebind('http://127.0.0.1:49992')
  assert.match(win.webContents.getURL(), /127\.0\.0\.1:49992/)
  await manager.dispose()
  assert.equal(win.destroyed, true)
})

test('V1 state derivation is a single priority-ordered source', () => {
  assert.equal(deriveModState({ activeVersionId: null }, { update: { status: 'running' } }).id, 'creating')
  assert.equal(deriveModState({ activeVersionId: 'v1', health: 'running' }, { update: { status: 'running' } }).id, 'updating')
  assert.equal(deriveModState({ health: 'stopping', desiredState: 'stopped' }).id, 'stopping')
  assert.equal(deriveModState({ health: 'running', desiredState: 'stopped' }).id, 'running')
  assert.equal(deriveModState({ desiredState: 'stopped' }).id, 'stopped')
  assert.equal(deriveModState({ health: 'failed' }).id, 'failed')
  assert.equal(deriveModState({ health: 'interrupted' }).id, 'interrupted')
  assert.equal(deriveModState({}).id, 'uncreated')
})

test('concurrent opens serialize admission; closing during lookup cannot resurrect a window', async () => {
  const windows: FakeWindow[] = []
  let release: (value: any) => void = () => {}
  let lookups = 0
  const manager = new ModWindowManager({
    BrowserWindow: class { constructor(options: any) { const win = new FakeWindow(options); windows.push(win); return win } },
    getOrigin: () => 'http://127.0.0.1:40001', preload: 'test.cjs',
    fetchSnapshot: async () => { if (++lookups === 1) return new Promise(resolve => { release = resolve }); return running() },
    invoke: async () => ({}), control: async () => ({}),
  })
  const first = manager.open({ projectId: 'project-a', sessionId: 'session-a' })
  const second = manager.open({ projectId: 'project-a', sessionId: 'session-a' })
  await new Promise(resolve => setImmediate(resolve))
  release(running())
  assert.equal((await first).opened, true)
  assert.equal((await second).focused, true)
  assert.equal(windows.length, 1)
  await manager.dispose()
  const dead = new ModWindowManager({ BrowserWindow: FakeWindow, getOrigin: () => 'http://127.0.0.1:40002', preload: 'test.cjs',
    fetchSnapshot: () => new Promise(resolve => { release = resolve }), invoke: async () => ({}), control: async () => ({}) })
  const opening = dead.open({ projectId: 'project-a', sessionId: 'session-a' })
  const rejected = assert.rejects(opening, /binding changed/)
  await new Promise(resolve => setImmediate(resolve))
  await dead.dispose()
  release(running())
  await rejected
  assert.equal(dead.records.size, 0)
})

test('late refresh after close is ignored and existing expired lease is passed to renewal', async () => {
  let release: (value: any) => void = () => {}
  let slow = false
  const requests: any[] = []
  const handlers = new Map()
  const manager = new ModWindowManager({ BrowserWindow: FakeWindow, getOrigin: () => 'http://127.0.0.1:40003', preload: 'test.cjs',
    ipcMain: { handle: (key: string, fn: any) => handlers.set(key, fn), removeHandler: (key: string) => handlers.delete(key) },
    fetchSnapshot: (request: any) => { requests.push(request); return slow ? new Promise(resolve => { release = resolve }) : Promise.resolve(running()) },
    invoke: async () => ({}), control: async () => ({}) })
  await manager.open({ projectId: 'project-a', sessionId: 'session-a' })
  const win = manager.records.get('project-a').window
  slow = true
  const refreshing = manager.refresh('project-a')
  win.destroy()
  release(running())
  assert.equal(await refreshing, null)
  assert.equal(win.webContents.sent.length, 0)
  assert.equal(requests.at(-1).frameToken, 'token-a')
  await manager.dispose()
  assert.equal(handlers.size, 0)
})

test('runtime rebind serializes behind a pending open navigation and retains window ownership', async () => {
  let release: () => void = () => {}
  let first = true
  class SlowWindow extends FakeWindow {
    async loadURL(url: string) {
      if (first) { first = false; await new Promise<void>(resolve => { release = resolve }) }
      await super.loadURL(url)
    }
  }
  let origin = 'http://127.0.0.1:40101'
  const manager = new ModWindowManager({ BrowserWindow: SlowWindow, getOrigin: () => origin, preload: 'test.cjs',
    fetchSnapshot: async () => running(), invoke: async () => ({}), control: async () => ({}) })
  const opening = manager.open({ projectId: 'project-a', sessionId: 'session-a' })
  const rejected = assert.rejects(opening, /binding changed/)
  await new Promise(resolve => setImmediate(resolve))
  const win = manager.records.get('project-a').window
  origin = 'http://127.0.0.1:40102'
  const rebound = manager.rebind(origin)
  release()
  await Promise.all([rejected, rebound])
  assert.equal(win.isDestroyed(), false)
  assert.equal(manager.records.get('project-a').window, win)
  assert.match(win.webContents.getURL(), /40102/)
  assert.equal(win.shown, true)
  await manager.dispose()
})

test('failed runtime navigation retains a trusted disconnected return path without business capability', async () => {
  const handlers = new Map<string, Function>()
  let fail = false, returns = 0
  class FailingWindow extends FakeWindow {
    async loadURL(url: string) { if (fail && url.startsWith('http:')) throw new Error('runtime offline'); await super.loadURL(url) }
  }
  const manager = new ModWindowManager({ BrowserWindow: FailingWindow, getOrigin: () => 'http://127.0.0.1:40201', preload: 'test.cjs',
    ipcMain: { handle: (key: string, fn: Function) => handlers.set(key, fn) }, fetchSnapshot: async () => running(),
    invoke: async () => ({}), control: async () => ({}), onOpenWorkspace: () => { ++returns } })
  await manager.open({ projectId: 'project-a', sessionId: 'session-a' })
  fail = true
  await manager.rebind('http://127.0.0.1:40202')
  const win = manager.records.get('project-a').window
  assert.match(win.webContents.getURL(), /^data:text\/html/)
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
  assert.equal(handlers.get('wm:mod-window:snapshot')!(event).connected, false)
  assert.equal((await handlers.get('wm:mod-window:return-workspace')!(event)).ok, true)
  await assert.rejects(handlers.get('wm:mod-window:invoke')!(event, { action: 'append' }), /不可用/)
  assert.equal(returns, 1)
  fail = false
  assert.equal((await manager.open({ projectId: 'project-a', sessionId: 'session-a' })).focused, true)
  assert.equal(manager.records.get('project-a').window, win)
  assert.match(win.webContents.getURL(), /^http:/)
  assert.equal(handlers.get('wm:mod-window:snapshot')!(event).connected, true)
  await manager.dispose()
})

test('late failed rebind cannot overwrite the newer successful snapshot', async () => {
  let rejectOld: (reason: Error) => void = () => {}
  class RacingWindow extends FakeWindow {
    async loadURL(url: string) {
      if (url.includes(':40302/')) await new Promise<void>((_resolve, reject) => { rejectOld = reject })
      await super.loadURL(url)
    }
  }
  const manager = new ModWindowManager({ BrowserWindow: RacingWindow, getOrigin: () => 'http://127.0.0.1:40301', preload: 'test.cjs',
    fetchSnapshot: async () => running(), invoke: async () => ({}), control: async () => ({}) })
  await manager.open({ projectId: 'project-a', sessionId: 'session-a' })
  const old = manager.rebind('http://127.0.0.1:40302')
  await new Promise(resolve => setImmediate(resolve))
  const fresh = manager.rebind('http://127.0.0.1:40303')
  await new Promise(resolve => setImmediate(resolve))
  rejectOld(new Error('aborted old load'))
  await Promise.all([old, fresh])
  const record = manager.records.get('project-a')
  assert.equal(record.snapshot.connected, true)
  assert.match(record.window.webContents.getURL(), /40303/)
  await manager.dispose()
})
