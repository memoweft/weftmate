const { contextBridge, ipcRenderer } = require('electron');

// The official DSH document is intentionally not given the legacy WeftMate
// renderer bridge. Its capabilities are bounded theme reporting and managed
// Mod view navigation; generated Mod frames never receive this bridge.
function normalizeSurfaceColor(value) {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  if (color.length < 4 || color.length > 32) return null;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;
  const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0\.\d{1,3}))?\s*\)$/i.exec(color);
  if (!match || (color.slice(0, 4).toLowerCase() === 'rgba' && match[4] === undefined)
    || (color.slice(0, 4).toLowerCase() === 'rgb(' && match[4] !== undefined)) return null;
  if ([match[1], match[2], match[3]].some((part) => Number(part) > 255)) return null;
  return color;
}

contextBridge.exposeInMainWorld('weftmateSurface', Object.freeze({
  syncTheme: (theme, color) => ipcRenderer.invoke('wm:dsh-surface:theme', {
    theme: theme === 'dark' ? 'dark' : 'light',
    color: normalizeSurfaceColor(color),
  }),
  openModWindow: (projectId, sessionId) => ipcRenderer.invoke('wm:mod-window:open', { projectId, sessionId }),
  onOpenModProject(callback) {
    if (typeof callback !== 'function') throw new TypeError('callback required')
    const listener = (_event, target) => callback({ projectId: target?.projectId, sessionId: target?.sessionId })
    ipcRenderer.on('wm:mod-window:open-project', listener)
    return () => ipcRenderer.removeListener('wm:mod-window:open-project', listener)
  },
}));
