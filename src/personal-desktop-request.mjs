// Match the validated native IPC sender: this window's own main frame only.
export function nativeWindowRequest(details, window, origin) {
  try {
    // A queued session request can arrive while app.exit() destroys the window.
    if (details.webContentsId !== window.webContents.id || details.frame !== window.webContents.mainFrame ||
        details.initiatorOrigin && details.initiatorOrigin !== origin) return false;
    const frame = new URL(window.webContents.mainFrame.url), target = new URL(details.url);
    if (target.protocol === 'ws:' && /^\/personal\/v1\/terminals\/terminal-[0-9a-f-]{36}\/connect$/.test(target.pathname)) target.protocol = 'http:';
    return frame.origin === origin && ['/personal/v1/ui', '/personal/v1/ui/'].includes(frame.pathname) &&
      target.origin === origin && target.pathname.startsWith('/personal/v1/');
  } catch { return false; }
}
