const { contextBridge, ipcRenderer } = require('electron')

// The host wrapper receives only the minimum window-local control surface.
// The sandboxed Mod iframe has no preload, no Node integration and no IPC.
contextBridge.exposeInMainWorld('weftmateModWindow', Object.freeze({
  snapshot: () => ipcRenderer.invoke('wm:mod-window:snapshot'),
  invoke: request => ipcRenderer.invoke('wm:mod-window:invoke', request),
  control: action => ipcRenderer.invoke('wm:mod-window:control', action),
  returnWorkspace: () => ipcRenderer.invoke('wm:mod-window:return-workspace'),
  onStatus(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener required')
    const handler = (_event, value) => listener(value)
    ipcRenderer.on('wm:mod-window:status', handler)
    return () => ipcRenderer.removeListener('wm:mod-window:status', handler)
  },
}))
