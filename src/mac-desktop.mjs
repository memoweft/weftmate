/** Native macOS shell; callers keep the Windows menu and lifecycle unchanged. */
export function macApplicationMenu({ show, settings, quit }) {
  return [
    { label: 'WeftMate', submenu: [
      { role: 'about', label: '关于 WeftMate' }, { type: 'separator' },
      { label: '设置…', accelerator: 'Command+,', click: settings }, { type: 'separator' },
      { role: 'services', label: '服务' }, { type: 'separator' },
      { role: 'hide', label: '隐藏 WeftMate' }, { role: 'hideOthers', label: '隐藏其他应用' },
      { role: 'unhide', label: '显示全部' }, { type: 'separator' },
      { label: '退出 WeftMate', accelerator: 'Command+Q', click: quit },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
    ] },
    { label: '窗口', submenu: [
      { role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' },
      { label: '显示 WeftMate', click: show }, { type: 'separator' }, { role: 'front', label: '全部置于前面' },
    ] },
  ];
}
export const macFilePermissionHelp = '如果无法读取或保存，请打开「系统设置 → 隐私与安全性 → 文件与文件夹」，允许 WeftMate 访问相应文件夹，再重试。';
export function desktopLoginOptions({ platform = process.platform, packaged, executable, args, name }) {
  // macOS registers the app bundle, not a Windows command line. Its normal
  // launch reads the stable installed configuration; login starts hidden.
  return platform === 'darwin' && packaged
    ? { path: executable, name, openAsHidden: true }
    : { path: executable, name, args };
}
