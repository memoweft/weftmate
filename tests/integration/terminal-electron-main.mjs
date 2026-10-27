import { app, BrowserWindow, session } from 'electron';
import { terminalService } from '../helpers/terminal-service.mjs';
import { nativeWindowRequest } from '../../src/personal-desktop-request.mjs';

app.setName('WeftMate UI05 terminal test');
app.setPath('userData', process.env.WEFTMATE_TERMINAL_TEST_DATA);
app.whenReady().then(async () => {
const fixture = await terminalService(process.env.WEFTMATE_TERMINAL_TEST_DATA + '/host', { panelHarness: true });
const win = new BrowserWindow({ show: false, width: 1120, height: 780,
  webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false, partition: 'ui05-terminal-test' } });
win.webContents.setFrameRate(60);
const browserSession = session.fromPartition('ui05-terminal-test');
const [name, value] = fixture.cookie.split('=');
await browserSession.cookies.set({ url: fixture.origin, name, value, httpOnly: true, sameSite: 'strict' });
browserSession.webRequest.onBeforeSendHeaders({ urls: [fixture.origin + '/personal/v1/*', fixture.origin.replace('http:', 'ws:') + '/personal/v1/*'] }, (details, callback) => {
  callback({ requestHeaders: { ...details.requestHeaders,
    ...(nativeWindowRequest(details, win, fixture.origin) ? { Origin: fixture.origin, 'X-WeftMate-Desktop': fixture.service.libraryDesktopToken } : {}) } });
});
await win.loadURL(fixture.origin + '/personal/v1/ui/');
let quitting = false;
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  fixture.close().finally(() => app.exit());
});
}).catch(error => { console.error(error); app.exit(1); });
