const { contextBridge, ipcRenderer } = require('electron');

// Deliberately narrow product bridge.  The renderer receives no Node APIs,
// filesystem paths, runtime origin, or credential values after initial entry.
contextBridge.exposeInMainWorld('weftmate', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('wm:stage1:bootstrap'),
  setup: (value) => ipcRenderer.invoke('wm:stage1:setup', value),
  importCurrentLocalModel: () => ipcRenderer.invoke('wm:stage1:import-current-local-model'),
  discoverModels: (value) => ipcRenderer.invoke('wm:stage2:discover-models', value),
  saveModel: (value) => ipcRenderer.invoke('wm:stage2:save-model', value),
  testModel: (id) => ipcRenderer.invoke('wm:stage2:test-model', id),
  setActiveModel: (id) => ipcRenderer.invoke('wm:stage2:set-active-model', id),
  deleteModel: (id) => ipcRenderer.invoke('wm:stage2:delete-model', id),
  setTheme: (theme) => ipcRenderer.invoke('wm:stage2:set-theme', theme),
  exportDiagnostics: () => ipcRenderer.invoke('wm:stage2:export-diagnostics'),
  sessions: () => ipcRenderer.invoke('wm:stage1:sessions'),
  create: () => ipcRenderer.invoke('wm:stage1:create'),
  select: (sessionId) => ipcRenderer.invoke('wm:stage1:select', sessionId),
  send: (value) => ipcRenderer.invoke('wm:stage1:send', value),
  cancel: (sessionId) => ipcRenderer.invoke('wm:stage1:cancel', sessionId),
  approval: (value) => ipcRenderer.invoke('wm:stage1:approval', value),
  onEvent: (listener) => ipcRenderer.on('wm:stage1:event', (_event, value) => listener(value)),
  onRuntimeError: (listener) => ipcRenderer.on('wm:stage1:runtime-error', (_event, value) => listener(value)),
  onRuntimeReady: (listener) => ipcRenderer.on('wm:stage1:runtime-ready', () => listener()),
}));
