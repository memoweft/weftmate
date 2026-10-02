const { contextBridge, ipcRenderer } = require('electron')

// Only the trusted official top-level page receives this bridge. No arbitrary
// IPC, filesystem, script execution or conversation-content copying is exposed.
contextBridge.exposeInMainWorld('weftmateConversation', Object.freeze({
  onCommand(callback) {
    if (typeof callback !== 'function') throw new TypeError('callback required')
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('wm:chat-carrier:command', listener)
    return () => ipcRenderer.removeListener('wm:chat-carrier:command', listener)
  },
  reportState: (sessionId, theme) => ipcRenderer.send('wm:chat-carrier:report', { kind: 'state', sessionId, theme }),
  reply: (id, ok, error) => ipcRenderer.send('wm:chat-carrier:report', { kind: 'reply', id, ok: ok === true, error: typeof error === 'string' ? error.slice(0, 240) : null }),
}))
