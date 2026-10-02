// An isolated carrier for the complete official DSH page. It is deliberately
// not a replacement chat renderer or an assertion that the V2 layout exists.
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'

export function carrierOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('A credential-free loopback runtime origin is required')
  }
  return url.origin
}

export class DshViewCarrier extends EventEmitter {
  constructor({ WebContentsView, ipcMain, parent, partition }) {
    super()
    this.parent = parent
    this.ipcMain = ipcMain
    this.origin = null
    this.disposed = false
    this.sequence = 0
    this.pending = new Map()
    this.state = null
    this.navigation = Promise.resolve()
    this.view = new WebContentsView({ webPreferences: {
      preload: fileURLToPath(new URL('./dsh-carrier-preload.cjs', import.meta.url)),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, ...(partition ? { partition } : {}),
    } })
    parent.contentView.addChildView(this.view)
    this.receive = (event, message) => {
      if (!this.authorized(event) || !message || typeof message !== 'object') return
      if (message.kind === 'state') {
        this.state = { sessionId: typeof message.sessionId === 'string' ? message.sessionId.slice(0, 128) : null,
          theme: message.theme === 'dark' ? 'dark' : 'light' }
        this.emit('state', this.state)
      } else if (message.kind === 'reply' && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        message.ok === true ? pending.resolve(this.state) : pending.reject(new Error(String(message.error || 'Carrier command failed').slice(0, 240)))
      }
    }
    ipcMain.on('wm:chat-carrier:report', this.receive)
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.view.webContents.on('will-navigate', (event, url) => {
      if (!this.allowedUrl(url)) event.preventDefault()
    })
    this.view.webContents.on('will-redirect', (event, url) => {
      if (!this.allowedUrl(url)) event.preventDefault()
    })
    this.view.webContents.on('render-process-gone', () => { this.state = null; this.rejectPending('DSH renderer disconnected') })
    this.onClosed = () => this.dispose()
    parent.once('closed', this.onClosed)
  }

  allowedUrl(value) {
    try { const url = new URL(value); return this.origin !== null && url.origin === this.origin && url.pathname === '/' && !url.username && !url.password } catch { return false }
  }

  authorized(event) {
    const wc = this.view.webContents
    return !this.disposed && !wc.isDestroyed() && event.sender === wc
      && event.senderFrame === wc.mainFrame && this.allowedUrl(event.senderFrame.url)
  }

  bind(value) {
    const origin = carrierOrigin(value)
    const operation = async () => {
      if (this.disposed) throw new Error('Carrier is closed')
      this.origin = null
      this.state = null
      this.rejectPending('Runtime binding changed')
      await this.view.webContents.loadURL('about:blank')
      if (this.disposed) throw new Error('Carrier is closed')
      this.origin = origin
      try { await this.view.webContents.loadURL(origin) }
      catch (error) { this.origin = null; throw error }
      if (!this.allowedUrl(this.view.webContents.getURL())) { this.origin = null; throw new Error('Unexpected runtime navigation') }
    }
    const result = this.navigation.then(operation)
    this.navigation = result.catch(() => {})
    return result
  }

  command(command) {
    if (this.disposed || !this.state || !this.origin) return Promise.reject(new Error('DSH carrier is not ready'))
    if (!(command?.type === 'select-session' && typeof command.sessionId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(command.sessionId))
      && !(command?.type === 'theme' && ['light', 'dark', 'system'].includes(command.theme))) return Promise.reject(new Error('Invalid carrier command'))
    const id = String(++this.sequence)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('DSH carrier command timed out')) }, 10_000)
      this.pending.set(id, { resolve, reject, timer })
      this.view.webContents.send('wm:chat-carrier:command', { ...command, id })
    })
  }

  setBounds(bounds) {
    const clean = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.max(0, Math.round(Number(bounds[key]) || 0))]))
    this.view.setBounds(clean)
  }
  setVisible(visible) { this.view.setVisible(Boolean(visible)) }
  focus() { if (!this.disposed) this.view.webContents.focus() }
  rejectPending(message) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)) }
    this.pending.clear()
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.origin = null
    this.state = null
    this.rejectPending('Carrier is closed')
    this.ipcMain.removeListener('wm:chat-carrier:report', this.receive)
    this.parent.removeListener('closed', this.onClosed)
    if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
    this.removeAllListeners()
  }
}
