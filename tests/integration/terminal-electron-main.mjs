import { app, BrowserWindow, session } from 'electron';
import { terminalService } from '../helpers/terminal-service.mjs';
import { nativeWindowRequest } from '../../src/personal-desktop-request.mjs';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

app.setName('WeftMate UI05 terminal test');
app.setAppUserModelId('com.memoweft.weftmate.test.ui05terminal');
app.setPath('userData', process.env.WEFTMATE_TERMINAL_TEST_DATA);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
const fullShell = process.env.WEFTMATE_TERMINAL_FULL_SHELL === '1';
let quitting = false;
const fixture = await terminalService(process.env.WEFTMATE_TERMINAL_TEST_DATA + '/host', { panelHarness: !fullShell });
const browserSession = session.fromPartition('ui05-terminal-test');
const colors = JSON.parse(readFileSync(new URL('../../design/tokens/tokens.json', import.meta.url), 'utf8')).surfaces.desktop.themes[0].variables;
const win = new BrowserWindow({ show: false, width: 1120, height: 780,
  ...(fullShell ? { titleBarStyle: 'hidden', titleBarOverlay: { color: colors['--canvas'], symbolColor: colors['--ink'], height:44 } } : {}),
  webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
    session: browserSession, ...(fullShell ? { preload: join(import.meta.dirname, '../../src/personal-desktop-preload.cjs'), sandbox: true } : {}) } });
win.webContents.setFrameRate(60);
const [name, value] = fixture.cookie.split('=');
await browserSession.cookies.set({ url: fixture.origin, path: '/personal/v1', name, value, httpOnly: true, sameSite: 'strict' });
let desktop;
if (fullShell) {
  desktop = createPersonalDesktop({ origin: fixture.origin, libraryDesktopToken: fixture.service.libraryDesktopToken,
    isQuitting: () => quitting, startInTray: true, preparedWindow: { window: win, desktopSession: browserSession,
      palette: () => ({ color: colors['--canvas'], symbolColor: colors['--ink'], height: 44 }),
      stateFile: join(process.env.WEFTMATE_TERMINAL_TEST_DATA, 'desktop-window.json'), saved: {},
      lifecycle: { stopped: false, maximizeOnShow: false }, restoreBounds: Promise.resolve(true), close: async () => {} } });
  await desktop.ready;
  win.setMinimumSize(320,480);
  globalThis.ui05Fixture = { workDir: fixture.workDir, ownerId: fixture.me.account.ownerId };
  globalThis.ui05FixtureService = fixture.service;
} else {
browserSession.webRequest.onBeforeSendHeaders({ urls: [fixture.origin + '/personal/v1/*', fixture.origin.replace('http:', 'ws:') + '/personal/v1/*'] }, (details, callback) => {
  callback({ requestHeaders: { ...details.requestHeaders,
    ...(nativeWindowRequest(details, win, fixture.origin) ? { Origin: fixture.origin, 'X-WeftMate-Desktop': fixture.service.libraryDesktopToken } : {}) } });
});
await win.loadURL(fixture.origin + '/personal/v1/ui/');
}
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  Promise.resolve(desktop?.close()).then(() => fixture.close()).finally(() => app.exit());
});
}).catch(error => { console.error(error); app.exit(1); });
