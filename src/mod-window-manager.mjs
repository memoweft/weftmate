/**
 * Main-process ownership for one durable Mod view per project.
 *
 * This manager intentionally owns only a view: it never starts or stops a
 * child process on close, and it never gives the generated iframe Electron
 * APIs.  The main process refreshes the host-owned detail snapshot and the
 * renderer talks back through a narrowly scoped IPC boundary.
 */
// Keep a stopped Mod's cover in sync with the existing main-panel cadence.
// The token itself is renewed by the server without replacing the iframe.
import { deriveModState, MOD_DISPLAY_STATES } from './plugins/weftmate-client/mod-state.mjs'
import { MOD_WINDOW_CSS } from './plugins/weftmate-client/mod-window/assets.mjs'

const REFRESH_MS = 1_500

const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)

// Entirely host-authored disconnected document: no business frame, network,
// dynamic code or privileged operation besides returning to the main window.
const disconnectedUrl = () => 'data:text/html;charset=UTF-8,' + encodeURIComponent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>${MOD_WINDOW_CSS}</style></head><body><header class="host-bar disconnected" data-tone="neutral"><span class="hb-dot"></span><span><b id="name">Mod</b> · 已断连</span><span class="hb-tag">WeftMate Mod · 数据保存在本机</span><a id="back" href="#">← 回到工作台</a></header><main class="mod-stage"><section class="cover show"><div class="cover-card"><h1>已断连</h1><p>与 WeftMate 的连接已断开</p></div></section></main><script>const api=window.weftmateModWindow; const paint=s=>{document.getElementById('name').textContent=s.project.name;document.body.classList.toggle('dark',s.theme==='dark')};api.snapshot().then(paint);api.onStatus(paint);document.getElementById('back').onclick=e=>{e.preventDefault();api.returnWorkspace()};</script></body></html>`)

export { deriveModState, MOD_DISPLAY_STATES }

function required(value, message) {
  if (!value) throw new Error(message)
  return value
}

export function modWindowUrl(origin, projectId, sessionId) {
  const url = new URL('/weftmate/mods/window.html', required(origin, 'Mod runtime is unavailable'))
  url.searchParams.set('project_id', projectId)
  url.searchParams.set('session_id', sessionId)
  return url.toString()
}

export function runningModSnapshot(snapshot) {
  return Boolean(snapshot?.connected !== false
    && snapshot?.controls?.canInvoke === true
    && typeof snapshot?.ui?.assetUrl === 'string'
    && typeof snapshot?.ui?.frameToken === 'string')
}

export function publicModWindowSnapshot(snapshot, { connected = true, error = null } = {}) {
  const project = snapshot?.project ?? {}
  const controls = snapshot?.controls ?? {}
  const run = snapshot?.run ?? null
  const ui = snapshot?.ui ?? {}
  const publicProject = {
    projectId: typeof project.projectId === 'string' ? project.projectId : null,
    name: typeof project.name === 'string' ? project.name.slice(0, 120) : 'Mod',
    activeVersionId: typeof project.activeVersionId === 'string' ? project.activeVersionId : null,
    desiredState: typeof project.desiredState === 'string' ? project.desiredState : null,
    health: typeof project.health === 'string' ? project.health : null,
  }
  const publicUpdate = {
    status: typeof snapshot?.update?.status === 'string' ? snapshot.update.status : null,
    hasError: Boolean(snapshot?.update?.lastError),
  }
  const display = deriveModState(publicProject, { update: { status: publicUpdate.status, lastError: publicUpdate.hasError }, run, hasRecentError: Boolean(snapshot?.recentError) })
  return Object.freeze({
    connected: connected === true,
    error: error === null ? null : String(error).slice(0, 240),
    project: publicProject,
    run: run && typeof run === 'object' ? { status: typeof run.status === 'string' ? run.status : 'unknown' } : null,
    controls: {
      canStart: controls.canStart === true,
      canStop: controls.canStop === true,
      canInvoke: controls.canInvoke === true,
      startBlockedReason: typeof controls.startBlockedReason === 'string' ? controls.startBlockedReason : null,
      publishing: controls.publishing === true,
    },
    update: publicUpdate,
    state: display,
    ui: {
      assetUrl: typeof ui.assetUrl === 'string' ? ui.assetUrl : null,
      frameToken: typeof ui.frameToken === 'string' ? ui.frameToken : null,
    },
  })
}

/**
 * BrowserWindow is injected so the lifecycle and trust boundary remain unit
 * testable without importing Electron into the test process.
 */
export class ModWindowManager {
  constructor(options) {
    this.BrowserWindow = required(options.BrowserWindow, 'BrowserWindow is required')
    this.ipcMain = options.ipcMain ?? null
    this.getOrigin = required(options.getOrigin, 'getOrigin is required')
    this.getTheme = typeof options.getTheme === 'function' ? options.getTheme : () => 'light'
    this.fetchSnapshot = required(options.fetchSnapshot, 'fetchSnapshot is required')
    this.invoke = required(options.invoke, 'invoke is required')
    this.control = required(options.control, 'control is required')
    this.showWorkspace = typeof options.showWorkspace === 'function' ? options.showWorkspace : () => {}
    this.onOpenWorkspace = typeof options.onOpenWorkspace === 'function' ? options.onOpenWorkspace : () => {}
    this.preload = required(options.preload, 'preload is required')
    this.parent = typeof options.parent === 'function' ? options.parent : () => null
    this.records = new Map()
    this.opening = new Map()
    this.generation = 0
    this.disposed = false
    this.timer = null
    if (this.ipcMain) this.#registerIpc()
  }

  async open({ projectId, sessionId }) {
    if (!validId(projectId) || !validId(sessionId)) throw new Error('Invalid Mod window target')
    if (this.disposed) throw new Error('Mod window manager is closed')
    // Serialize the entire admission, including asynchronous access lookup.
    const prior = this.opening.get(projectId) ?? Promise.resolve()
    const operation = prior.catch(() => {}).then(() => this.#open(projectId, sessionId))
    this.opening.set(projectId, operation)
    try { return await operation } finally { if (this.opening.get(projectId) === operation) this.opening.delete(projectId) }
  }

  async #open(projectId, sessionId) {
    if (this.disposed) throw new Error('Mod window manager is closed')
    const generation = this.generation
    let snapshot = await this.fetchSnapshot({ projectId, sessionId })
    if (this.disposed || generation !== this.generation) throw new Error('Mod runtime binding changed')
    const existing = this.records.get(projectId)
    if (existing && !existing.window.isDestroyed()) {
      if (existing.sessionId !== sessionId) snapshot = await this.fetchSnapshot({ projectId, sessionId: existing.sessionId })
      if (this.disposed || generation !== this.generation || this.records.get(projectId) !== existing) throw new Error('Mod runtime binding changed')
      existing.snapshot = this.#snapshot(snapshot)
      if (existing.wrapperUrl?.startsWith('data:')) await this.#load(existing)
      if (this.disposed || generation !== this.generation || this.records.get(projectId) !== existing || existing.window.isDestroyed()) throw new Error('Mod runtime binding changed')
      existing.window.webContents.send('wm:mod-window:status', existing.snapshot)
      this.#focus(existing.window)
      return { opened: false, focused: true }
    }
    if (!runningModSnapshot(snapshot)) throw new Error('Only a healthy running Mod can open an independent window')
    const window = new this.BrowserWindow({
      width: 960,
      height: 720,
      minWidth: 560,
      minHeight: 420,
      show: false,
      autoHideMenuBar: true,
      parent: this.parent() ?? undefined,
      webPreferences: {
        preload: this.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    const record = { projectId, sessionId, window, snapshot: this.#snapshot(snapshot), wrapperUrl: null, navigatingUrl: null, navigation: Promise.resolve(), closing: false, rebinding: false, refresh: null }
    this.records.set(projectId, record)
    this.#attach(record)
    try {
      await this.#load(record)
      if (this.disposed || generation !== this.generation || this.records.get(projectId) !== record) throw new Error('Mod runtime binding changed')
      if (!window.isDestroyed()) window.show()
      this.#ensureRefreshTimer()
      return { opened: true, focused: false }
    } catch (error) {
      if (generation === this.generation && this.records.get(projectId) === record) {
        this.records.delete(projectId)
        record.closing = true
        try { window.destroy() } catch {}
      }
      throw error
    }
  }

  async refresh(projectId) {
    const record = this.records.get(projectId)
    if (!record || this.disposed || record.window.isDestroyed() || record.rebinding || !this.getOrigin() || record.wrapperUrl?.startsWith('data:')) return null
    if (record.refresh) return record.refresh
    const generation = this.generation
    const current = () => !this.disposed && this.generation === generation && this.records.get(projectId) === record && !record.window.isDestroyed() && !record.rebinding
    const operation = (async () => { try {
      const snapshot = await this.fetchSnapshot({ projectId: record.projectId, sessionId: record.sessionId, frameToken: record.snapshot.ui.frameToken })
      if (!current()) return null
      record.snapshot = this.#snapshot(snapshot)
      record.window.webContents.send('wm:mod-window:status', record.snapshot)
      return record.snapshot
    } catch {
      if (!current()) return null
      record.snapshot = this.#snapshot(record.snapshot, { connected: false, error: '与 WeftMate 的连接已断开' })
      record.window.webContents.send('wm:mod-window:status', record.snapshot)
      return record.snapshot
    } })()
    record.refresh = operation
    try { return await operation } finally { if (record.refresh === operation) record.refresh = null }
  }

  async rebind(origin) {
    const generation = ++this.generation
    for (const record of this.records.values()) this.#disconnect(record)
    if (this.disposed) return
    if (!origin) {
      for (const record of this.records.values()) this.#disconnect(record)
      return
    }
    await Promise.all([...this.records.values()].map(async record => {
      if (record.window.isDestroyed()) return
      record.rebinding = true
      try {
        const snapshot = await this.fetchSnapshot({ projectId: record.projectId, sessionId: record.sessionId })
        if (this.disposed || generation !== this.generation || record.window.isDestroyed()) return
        record.snapshot = this.#snapshot(snapshot)
        await this.#load(record, origin)
        if (generation === this.generation && !record.window.isDestroyed()) record.window.show()
      } catch {
        if (!this.disposed && generation === this.generation && this.records.get(record.projectId) === record && !record.window.isDestroyed()) this.#disconnect(record)
      } finally { if (generation === this.generation) record.rebinding = false }
    }))
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    ++this.generation
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const record of this.records.values()) {
      record.closing = true
      try { record.window.destroy() } catch {}
    }
    this.records.clear()
    for (const name of ['snapshot', 'invoke', 'control', 'return-workspace']) this.ipcMain?.removeHandler?.('wm:mod-window:' + name)
  }

  #snapshot(snapshot, options) { return { ...publicModWindowSnapshot(snapshot, options), theme: this.getTheme() === 'dark' ? 'dark' : 'light' } }

  syncTheme() {
    for (const record of this.records.values()) {
      record.snapshot = { ...record.snapshot, theme: this.getTheme() === 'dark' ? 'dark' : 'light' }
      if (!record.window.isDestroyed()) record.window.webContents.send('wm:mod-window:status', record.snapshot)
    }
  }

  #attach(record) {
    const { window } = record
    window.on('closed', () => {
      if (this.records.get(record.projectId) === record) this.records.delete(record.projectId)
      if (this.records.size === 0 && this.timer) { clearInterval(this.timer); this.timer = null }
    })
    window.webContents.on('will-navigate', (event, targetUrl) => {
      if (targetUrl !== record.wrapperUrl && targetUrl !== record.navigatingUrl) event.preventDefault()
    })
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  async #load(record, explicitOrigin = null) {
    const origin = explicitOrigin ?? this.getOrigin()
    const target = modWindowUrl(origin, record.projectId, record.sessionId)
    const generation = this.generation
    const alive = () => !this.disposed && !record.window.isDestroyed() && this.records.get(record.projectId) === record && generation === this.generation
    const operation = record.navigation.catch(() => {}).then(async () => {
      if (!alive()) throw new Error('Mod runtime binding changed')
      record.navigatingUrl = target
      try {
        await record.window.loadURL(target)
        if (!alive()) throw new Error('Mod runtime binding changed')
        if (record.window.webContents.getURL() !== target) throw new Error('Mod window did not finish at its trusted wrapper route')
        record.wrapperUrl = target
      } catch (error) {
        if (!alive()) throw error
        this.#disconnect(record)
        const fallback = disconnectedUrl()
        record.navigatingUrl = fallback
        await record.window.loadURL(fallback)
        if (!alive()) throw new Error('Mod runtime binding changed')
        record.wrapperUrl = fallback
      } finally { if (generation === this.generation) record.navigatingUrl = null }
    })
    record.navigation = operation
    return operation
  }

  #focus(window) {
    if (window.isMinimized?.()) window.restore()
    window.show()
    window.focus()
  }

  #disconnect(record) {
    record.snapshot = this.#snapshot(record.snapshot, { connected: false, error: '与 WeftMate 的连接已断开' })
    if (!record.window.isDestroyed()) record.window.webContents.send('wm:mod-window:status', record.snapshot)
  }

  #ensureRefreshTimer() {
    if (this.timer || this.disposed) return
    this.timer = setInterval(() => { void Promise.allSettled([...this.records.keys()].map(projectId => this.refresh(projectId))) }, REFRESH_MS)
    this.timer.unref?.()
  }

  #recordForEvent(event) {
    for (const record of this.records.values()) {
      if (record.window.isDestroyed()) continue
      if (event.sender !== record.window.webContents || event.senderFrame !== record.window.webContents.mainFrame) continue
      if (event.senderFrame?.url !== record.wrapperUrl && event.senderFrame?.url !== record.navigatingUrl) continue
      return record
    }
    return null
  }

  #registerIpc() {
    this.ipcMain.handle('wm:mod-window:snapshot', event => {
      const record = this.#recordForEvent(event)
      return record?.snapshot ?? publicModWindowSnapshot(null, { connected: false, error: '请求来源不可信。' })
    })
    this.ipcMain.handle('wm:mod-window:invoke', async (event, request) => {
      const record = this.#recordForEvent(event)
      if (!record || record.rebinding || !record.snapshot.connected || !record.snapshot.controls.canInvoke) throw new Error('Mod 业务当前不可用')
      try { return await this.invoke({ projectId: record.projectId, sessionId: record.sessionId, frameToken: record.snapshot.ui.frameToken, request }) }
      finally { await this.refresh(record.projectId) }
    })
    this.ipcMain.handle('wm:mod-window:control', async (event, action) => {
      const record = this.#recordForEvent(event)
      if (!record || record.rebinding || action !== 'start' || !record.snapshot.connected || !record.snapshot.controls.canStart) throw new Error('当前不能启动此 Mod')
      try { return await this.control({ projectId: record.projectId, sessionId: record.sessionId, action }) }
      finally { await this.refresh(record.projectId) }
    })
    this.ipcMain.handle('wm:mod-window:return-workspace', event => {
      const record = this.#recordForEvent(event)
      if (!record) return { ok: false }
      this.showWorkspace()
      this.onOpenWorkspace({ projectId: record.projectId, sessionId: record.sessionId })
      return { ok: true }
    })
  }
}
