// 透明桌面宠物窗口的最小桥：只收主进程给的外观状态，只能唤起主窗口或隐藏自己。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wmDesktopPet', {
  onState: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('wm:pet-state', (_event, state) => callback(state));
  },
  onBehavior: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('wm:pet-behavior', (_event, state) => callback(state));
  },
  showMain: () => ipcRenderer.send('wm:pet-show-main'),
  openPage: () => ipcRenderer.send('wm:pet-open-page'),
  hide: () => ipcRenderer.send('wm:pet-hide'),
  openContextMenu: () => ipcRenderer.send('wm:pet-context-menu'),
  setHitTest: (interactive, hovering) => ipcRenderer.send('wm:pet-hit-test', {
    interactive: interactive === true,
    hovering: hovering === true,
  }),
  setPointerInside: (inside) => ipcRenderer.send('wm:pet-pointer', inside === true),
  interact: (kind) => ipcRenderer.send('wm:pet-interact', kind),
  dragStart: (point) => ipcRenderer.send('wm:pet-drag-start', point),
  dragMove: (point) => ipcRenderer.send('wm:pet-drag-move', point),
  dragEnd: () => ipcRenderer.send('wm:pet-drag-end'),
  // ImageForm：图片形态按内容尺寸收窄窗口（脚底锚定）。
  requestResize: (size) => ipcRenderer.send('wm:pet-resize', size),
  // Sprite 图集（R6-02）：沙箱渲染器不能 fetch(file://)，由 main 从 asar 读图集回传 ArrayBuffer。
  loadSpriteAtlas: (name) => ipcRenderer.invoke('wm:pet-sprite', name),
});
