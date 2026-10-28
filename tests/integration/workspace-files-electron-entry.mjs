// Production desktop with a separate test identity and profile.
import { app, nativeTheme, Notification } from 'electron';
import packageInfo from '../../package.json' with { type: 'json' };
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
app.setName('WeftMate UI04 Test');
app.setAppUserModelId('com.memoweft.weftmate.ui04-test');
app.setPath('userData', process.env.UI04_PROFILE);
packageInfo.desktopAppId = 'com.memoweft.weftmate.ui04-test';
Notification.isSupported = () => false;
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  let quitting = false;
  app.on('before-quit', () => { quitting = true; });
  const desktop = createPersonalDesktop({ origin: process.env.UI04_ORIGIN, libraryDesktopToken: process.env.UI04_DESKTOP_TOKEN,
    startInTray: true, isQuitting: () => quitting });
  await desktop.ready;
  desktop.window.setContentSize(1360, 960);
  desktop.window.webContents.setBackgroundThrottling(false);
});
