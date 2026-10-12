import { app, Notification } from 'electron';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
app.setPath('userData', process.env.REVIEW_PROFILE);
Notification.isSupported = () => false;
app.whenReady().then(async () => {
let quitting = false;
app.on('before-quit', () => { quitting = true; });
const desktop = createPersonalDesktop({ libraryDesktopToken: process.env.REVIEW_LIBRARY_TOKEN, origin: process.env.REVIEW_ORIGIN, startInTray: true, isQuitting: () => quitting });
await desktop.ready;
desktop.window.webContents.setBackgroundThrottling(false);
desktop.window.setPosition(-20000, -20000);
desktop.window.showInactive();
desktop.window.setContentSize(1200, 800);
globalThis.__ux2Desktop = desktop;
});
