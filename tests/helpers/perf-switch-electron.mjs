import { app, BrowserWindow, Notification, session } from 'electron';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
app.setName('WeftMate Switch Test');
app.setAppUserModelId('com.memoweft.weftmate.test.perfswitch');
app.setPath('userData', process.env.PERF_SWITCH_PROFILE);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
Notification.isSupported = () => false;
app.whenReady().then(async () => {
const desktopSession = session.fromPartition('persist:weftmate-desktop');
const colors = JSON.parse(readFileSync(new URL('../../design/tokens/tokens.json', import.meta.url), 'utf8')).surfaces.desktop.themes[0].variables;
const palette = () => ({ color: colors['--canvas'], symbolColor: colors['--ink'], height: 44 });
const window = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false,
  titleBarStyle: 'hidden', titleBarOverlay: palette(), backgroundColor: colors['--canvas'], webPreferences: {
    session: desktopSession, preload: join(import.meta.dirname, '../../src/personal-desktop-preload.cjs'),
    nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false,
  } });
window.webContents.setFrameRate(60); window.webContents.startPainting(); window.webContents.on('paint', () => {});
let quitting = false; app.on('before-quit', () => { quitting = true; });
const desktop = createPersonalDesktop({ startInTray: true, origin: process.env.PERF_SWITCH_ORIGIN,
  libraryDesktopToken: process.env.PERF_SWITCH_TOKEN, isQuitting: () => quitting,
  preparedWindow: { window, desktopSession, palette, stateFile: join(process.env.PERF_SWITCH_PROFILE, 'window.json'),
    saved: {}, lifecycle: { stopped: false, maximizeOnShow: false }, restoreBounds: Promise.resolve(true), close: async () => {} } });
await desktop.ready;
});
