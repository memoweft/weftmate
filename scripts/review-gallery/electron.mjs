// Launch the production desktop shell against the isolated FE-1a personal host.
// No alternate BrowserWindow implementation, daily profile, or DSH vendor is needed.
import { app, nativeTheme, Notification } from 'electron';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
app.setPath('userData', process.env.REVIEW_PROFILE);
// The gallery captures application UI. Native OS delivery has dedicated tests;
// synthetic approvals and activities must not create desktop Toast resources.
Notification.isSupported = () => false;
app.whenReady().then(async () => {
  nativeTheme.themeSource = process.env.REVIEW_THEME;
  let quitting = false;
  // Register before the first window can be navigated or its load interrupted.
  app.on('before-quit', () => { quitting = true; console.log('Review desktop before-quit.'); });
  const desktop = createPersonalDesktop({ startInTray:process.env.REVIEW_HIDDEN === '1', libraryDesktopToken:process.env.REVIEW_LIBRARY_TOKEN, origin: process.env.REVIEW_ORIGIN, isQuitting: () => quitting });
  globalThis.__reviewDesktop = desktop;
  await desktop.ready;
  console.log('Review desktop ready.');
  desktop.window.setContentSize(1200, 800);
  desktop.window.webContents.setBackgroundThrottling(false);
});
