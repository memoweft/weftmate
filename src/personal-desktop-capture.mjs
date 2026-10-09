import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron';
import { join } from 'node:path';

/** In-memory screenshot selection; only the selected region crosses the bridge. */
export async function captureScreenRegion(parent) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
    width: Math.ceil(display.size.width * display.scaleFactor), height: Math.ceil(display.size.height * display.scaleFactor) } });
  const source = sources.find(row => row.display_id === String(display.id));
  if (!source || source.thumbnail.isEmpty()) throw new Error('SCREEN_CAPTURE_UNAVAILABLE');
  const capture = source.thumbnail, size = capture.getSize();
  const overlay = new BrowserWindow({ ...display.bounds, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, show: false, webPreferences: { nodeIntegration: false,
      contextIsolation: true, sandbox: true, preload: join(import.meta.dirname, 'personal-capture-preload.cjs') } });
  return new Promise((resolve, reject) => {
    const channel = `wm:capture:${overlay.id}`;
    let settled = false;
    const finish = (value, error) => {
      if (settled) return; settled = true; ipcMain.removeHandler(channel); parent.removeListener('closed', parentClosed);
      if (!overlay.isDestroyed()) overlay.destroy();
      if (!parent.isDestroyed()) parent.focus();
      if (error) reject(error); else resolve(value);
    };
    ipcMain.handle(channel, (event, rectangle) => {
      if (event.sender !== overlay.webContents || event.senderFrame !== overlay.webContents.mainFrame) return;
      if (!rectangle) return finish(null);
      if (!['x','y','width','height'].every(key => Number.isFinite(rectangle[key]))) return;
      const sx = size.width / display.bounds.width, sy = size.height / display.bounds.height;
      const x = Math.max(0, Math.min(size.width - 1, Math.round(rectangle.x * sx)));
      const y = Math.max(0, Math.min(size.height - 1, Math.round(rectangle.y * sy)));
      const width = Math.max(1, Math.min(size.width - x, Math.round(rectangle.width * sx)));
      const height = Math.max(1, Math.min(size.height - y, Math.round(rectangle.height * sy)));
      finish({ name: '屏幕截图.png', contentType: 'image/png', dataUrl: capture.crop({x,y,width,height}).toDataURL() });
    });
    overlay.on('closed', () => finish(null));
    const parentClosed = () => finish(null);
    parent.once('closed', parentClosed);
    overlay.webContents.once('did-finish-load', () => { overlay.webContents.send('wm:capture:ready',
      { channel, dataUrl: capture.toDataURL() }); overlay.show(); overlay.focus(); });
    overlay.loadFile(join(import.meta.dirname, 'personal-capture.html')).catch(error => finish(null,error));
  });
}
