/** Keep a yielded installed Electron peer active without showing or focusing it. */
export async function prepareInvisiblePeer(app) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => {
    const before = { id: window.id, visible: window.isVisible(), opacity: window.getOpacity() };
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.setSkipTaskbar(true);
    window.webContents.setBackgroundThrottling(false);
    window.showInactive();
    return { before, after: { visible: window.isVisible(), opacity: window.getOpacity(), focused: window.isFocused() } };
  }));
}
