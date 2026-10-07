const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weftmateDesktop', {
  platform: process.platform,
  settings: () => ipcRenderer.invoke('wm:desktop:settings'),
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
