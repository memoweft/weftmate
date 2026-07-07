// WeftMate preload —— 只为自绘标题栏暴露窗口控制(最小化/最大化切换/关闭 + 最大化状态回调)。
// 用 .cjs:package.json 是 "type":"module",裸 .js 会被当 ESM;Electron 沙箱 preload 需 CommonJS。
// 安全:contextIsolation 下经 contextBridge 只暴露这四个薄封装,不暴露 ipcRenderer/Node 能力本身。
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
