const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weftmateDesktop', {
  platform: process.platform,
  clipboardImage: () => ipcRenderer.invoke('wm:desktop:clipboard-image'),
  captureRegion: () => ipcRenderer.invoke('wm:desktop:capture-region'),
  updateState: () => ipcRenderer.invoke('wm:desktop:update-state'),
  checkUpdates: () => ipcRenderer.invoke('wm:desktop:update-check'),
  setUpdateChannel: channel => ipcRenderer.invoke('wm:desktop:update-channel', channel),
  restartForUpdate: () => ipcRenderer.invoke('wm:desktop:update-restart'),
  openLogs: () => ipcRenderer.invoke('wm:desktop:open-logs'),
  settings: () => ipcRenderer.invoke('wm:desktop:settings'),
  pickProjectFolder: () => ipcRenderer.invoke('wm:desktop:project-folder'),
  identity: () => ipcRenderer.invoke('wm:desktop:identity'),
  credentials: (key, value, remove) => ipcRenderer.invoke('wm:desktop:credentials', key, value, remove),
  cloudKey: (scope) => ipcRenderer.invoke('wm:desktop:key', scope),
  cloudProof: (scope, input) => ipcRenderer.invoke('wm:desktop:proof', scope, input),
  resetCloudKey: scope => ipcRenderer.invoke('wm:desktop:key-reset', scope),
  connectHost: connection => ipcRenderer.invoke('wm:desktop:connect-host', connection),
  activateHost: connection => ipcRenderer.invoke('wm:desktop:activate-host', connection),
  clearHostSessions: () => ipcRenderer.invoke('wm:desktop:clear-sessions'),
  fetchPersonal: (url, options, id) => ipcRenderer.invoke('wm:desktop:fetch', url, options, id),
  abortPersonalFetch: id => ipcRenderer.invoke('wm:desktop:fetch-abort', id),
  setTheme: (palette) => ipcRenderer.invoke('wm:desktop:theme', palette),
  setModelName: (name) => ipcRenderer.invoke('wm:desktop:model', name),
  setAutoStart: (enabled) => ipcRenderer.invoke('wm:desktop:auto-start', enabled),
  artifact: (artifactId, action) => ipcRenderer.invoke('wm:desktop:artifact', { artifactId, action }),
  exportMemories: (format, ownerId) => ipcRenderer.invoke('wm:desktop:memory-export', { format, ownerId }),
  onConversation: (callback) => {
    const listener = (_event, sessionId) => callback(sessionId);
    ipcRenderer.on('wm:desktop:conversation', listener);
    return () => ipcRenderer.removeListener('wm:desktop:conversation', listener);
  },
});
