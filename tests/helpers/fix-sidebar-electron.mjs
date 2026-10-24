import { app, Notification } from 'electron';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') throw error; });
app.setName('WeftMate FIX-SIDEBAR Test');
app.setAppUserModelId('com.memoweft.weftmate.test.fix-sidebar');
app.setPath('userData', process.env.FIX_SIDEBAR_PROFILE);
Notification.isSupported = () => false;
app.whenReady().then(async () => {
  let quitting = false;
  app.on('before-quit', () => { quitting = true; });
  const desktop = createPersonalDesktop({ startInTray: true, origin: process.env.FIX_SIDEBAR_ORIGIN,
    libraryDesktopToken: process.env.FIX_SIDEBAR_DESKTOP_TOKEN, isQuitting: () => quitting });
  await desktop.ready;
  desktop.window.webContents.setBackgroundThrottling(false);
});
