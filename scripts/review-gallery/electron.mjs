// Launch the production desktop shell against the isolated FE-1a personal host.
// No alternate BrowserWindow implementation, daily profile, or DSH vendor is needed.
import { app, nativeTheme } from 'electron';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
app.setPath('userData', process.env.REVIEW_PROFILE);
app.whenReady().then(async () => {
  nativeTheme.themeSource = process.env.REVIEW_THEME;
  let quitting = false;
  const desktop = createPersonalDesktop({ libraryDesktopToken:process.env.REVIEW_LIBRARY_TOKEN, origin: process.env.REVIEW_ORIGIN, isQuitting: () => quitting });
  await desktop.ready;
  desktop.window.setContentSize(1200, 800);
  desktop.window.webContents.setBackgroundThrottling(false);
  app.on('before-quit', () => { quitting = true; });
});
