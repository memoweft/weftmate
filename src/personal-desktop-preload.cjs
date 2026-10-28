const { contextBridge, ipcRenderer, webUtils } = require('electron');
const pendingNotices = [];
let noticeListener;
ipcRenderer.on('wm:ui:notice', (_event, notice) => { if (noticeListener) noticeListener(notice); else pendingNotices.push(notice); });
function onNotice(callback) { noticeListener = callback; for (const notice of pendingNotices.splice(0)) callback(notice); return () => { if (noticeListener === callback) noticeListener = null; }; }

contextBridge.exposeInMainWorld('weftmateDesktop', {
  platform: process.platform,
  onNotice,
  browser: (action, input) => ipcRenderer.invoke('wm:desktop:browser', action, input),
  onBrowserState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('wm:desktop:browser-state', listener);
    return () => ipcRenderer.removeListener('wm:desktop:browser-state', listener);
  },
  closeNotice: id => ipcRenderer.send('wm:ui:notice-closed', id),
  clipboardImage: () => ipcRenderer.invoke('wm:desktop:clipboard-image'),
  captureRegion: () => ipcRenderer.invoke('wm:desktop:capture-region'),
  updateState: () => ipcRenderer.invoke('wm:desktop:update-state'),
  onUpdateState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('wm:update-state', listener); return () => ipcRenderer.removeListener('wm:update-state', listener); },
  checkUpdates: () => ipcRenderer.invoke('wm:desktop:update-check'),
  setUpdateChannel: channel => ipcRenderer.invoke('wm:desktop:update-channel', channel),
  restartForUpdate: () => ipcRenderer.invoke('wm:desktop:update-restart'),
  openLogs: () => ipcRenderer.invoke('wm:desktop:open-logs'),
  repairSystem: id => ipcRenderer.invoke('wm:desktop:system-repair', id),
  exportSystemDiagnostics: () => ipcRenderer.invoke('wm:desktop:system-export'),
  exportRecoveryCode: input => ipcRenderer.invoke('wm:desktop:recovery-export', input),
  notificationPermission: () => ipcRenderer.invoke('wm:desktop:notification-permission'),
  openNotificationSettings: () => ipcRenderer.invoke('wm:desktop:notification-settings'),
  settings: () => ipcRenderer.invoke('wm:desktop:settings'),
  setSendToEnabled: enabled => ipcRenderer.invoke('wm:desktop:send-to-setting', enabled),
  takeSendTo: () => ipcRenderer.invoke('wm:desktop:take-send-to'),
  onSendTo: callback => { const listener = () => callback(); ipcRenderer.on('wm:desktop:send-to', listener); return () => ipcRenderer.removeListener('wm:desktop:send-to', listener); },
  pickProjectFolder: () => ipcRenderer.invoke('wm:desktop:project-folder'),
  inspectProjectFolder: path => ipcRenderer.invoke('wm:desktop:project-choice', path),
  createFolderProject: fields => ipcRenderer.invoke('wm:desktop:project-create', fields),
  projectFolderInfo: id => ipcRenderer.invoke('wm:desktop:project-info', id),
  relocateProjectFolder: (id, fields) => ipcRenderer.invoke('wm:desktop:project-relocate', id, fields),
  showProjectFolder: id => ipcRenderer.invoke('wm:desktop:project-show', id),
  droppedProjectFolder: file => { const path = webUtils.getPathForFile(file); return path ? ipcRenderer.invoke('wm:desktop:project-drop', path) : Promise.resolve(null); },
  identity: () => ipcRenderer.invoke('wm:desktop:identity'),
  credentials: (key, value, remove) => ipcRenderer.invoke('wm:desktop:credentials', key, value, remove),
  cloudCredentialsPresent: () => ipcRenderer.invoke('wm:desktop:cloud-credentials-present'),
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
  previewHistoryImport: app => ipcRenderer.invoke('wm:desktop:history-import', app),
  exportAllData: id => ipcRenderer.invoke('wm:desktop:data-export', { id }),
  dataOperation: id => ipcRenderer.invoke('wm:desktop:data-status', id),
  showDataExport: id => ipcRenderer.invoke('wm:desktop:data-show-export', { id }),
  exportConversation: payload => ipcRenderer.invoke('wm:desktop:conversation-export', payload),
  onConversation: (callback) => {
    const listener = (_event, sessionId) => callback(sessionId);
    ipcRenderer.on('wm:desktop:conversation', listener);
    return () => ipcRenderer.removeListener('wm:desktop:conversation', listener);
  },
  onVisibility: (callback) => {
    const listener = (_event, hidden) => callback(hidden === true);
    ipcRenderer.on('wm:desktop:visibility', listener);
    return () => ipcRenderer.removeListener('wm:desktop:visibility', listener);
  },
});
