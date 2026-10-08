const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weftmateDesktop', {
  platform: process.platform,
  settings: () => ipcRenderer.invoke('wm:desktop:settings'),
  identity: () => ipcRenderer.invoke('wm:desktop:identity'),
  credentials: (key, value, remove) => ipcRenderer.invoke('wm:desktop:credentials', key, value, remove),
  cloudKey: (scope) => ipcRenderer.invoke('wm:desktop:key', scope),
  cloudProof: (scope, input) => ipcRenderer.invoke('wm:desktop:proof', scope, input),
  resetCloudKey: scope => ipcRenderer.invoke('wm:desktop:key-reset', scope),
  connectHost: connection => ipcRenderer.invoke('wm:desktop:connect-host', connection),
  setTheme: (palette) => ipcRenderer.invoke('wm:desktop:theme', palette),
  setModelName: (name) => ipcRenderer.invoke('wm:desktop:model', name),
  setAutoStart: (enabled) => ipcRenderer.invoke('wm:desktop:auto-start', enabled),
  artifact: (artifactId, action) => ipcRenderer.invoke('wm:desktop:artifact', { artifactId, action }),
  onConversation: (callback) => {
    const listener = (_event, sessionId) => callback(sessionId);
    ipcRenderer.on('wm:desktop:conversation', listener);
    return () => ipcRenderer.removeListener('wm:desktop:conversation', listener);
  },
});
