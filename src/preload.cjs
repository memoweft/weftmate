// WeftMate preload —— 只为自绘标题栏暴露窗口控制(最小化/最大化切换/关闭 + 最大化状态回调)。
// 用 .cjs:package.json 是 "type":"module",裸 .js 会被当 ESM;Electron 沙箱 preload 需 CommonJS。
// 安全:contextIsolation 下经 contextBridge 只暴露窗口控制和一个窄数据擦除封装,不暴露 ipcRenderer/Node 能力本身。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wmWindow', {
  minimize: () => ipcRenderer.send('wm:minimize'),
  toggleMaximize: () => ipcRenderer.send('wm:toggle-maximize'),
  close: () => ipcRenderer.send('wm:close'),
  // 主进程 maximize/unmaximize 时回调 (isMax:boolean),供前端切换"最大化/还原"图标。
  onMaximizeChange: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('wm:maximized', (_e, isMax) => cb(!!isMax));
  },
});

// 唯一的数据擦除能力：只允许传确认短语，renderer 拿不到 ipcRenderer、路径、marker 或 token。
contextBridge.exposeInMainWorld('wmData', {
  deleteAllLocalData: (confirmation) => ipcRenderer.invoke('wm:delete-all-local-data', confirmation),
});

// 桌面宠物只接受一份已裁剪的显示状态；主进程会再次严格校验，不暴露通用 IPC。
contextBridge.exposeInMainWorld('wmPet', {
  toggle: (state) => ipcRenderer.invoke('wm:pet-toggle', state),
  visibility: () => ipcRenderer.invoke('wm:pet-visibility'),
  setFreeActivity: (enabled) => ipcRenderer.invoke('wm:pet-free-activity', enabled === true),
  composerActivity: () => ipcRenderer.send('wm:pet-composer-activity'),
  sync: (state) => ipcRenderer.send('wm:pet-sync', state),
  onVisibility: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('wm:pet-visibility', (_event, state) => callback(state));
  },
  onOpenPets: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('wm:open-pets', () => callback());
  },
});
