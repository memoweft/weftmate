// Match the validated native IPC sender: this window's own main frame only.
export function nativeWindowRequest(details, window, origin) {
  if (details.webContentsId !== window.webContents.id || details.frame !== window.webContents.mainFrame ||
      details.initiatorOrigin && details.initiatorOrigin !== origin) return false;
  try {
    const frame = new URL(window.webContents.mainFrame.url), target = new URL(details.url);
    return frame.origin === origin && ['/personal/v1/ui', '/personal/v1/ui/'].includes(frame.pathname) &&
      target.origin === origin && target.pathname.startsWith('/personal/v1/');
  } catch { return false; }
}
