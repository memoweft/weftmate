// Owned desktop identity; the production window and preload run unchanged.
import { app, Notification } from 'electron';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
app.setName('WeftMate WORK-SWITCH Test');
app.setAppUserModelId('com.memoweft.weftmate.work-switch.test');
app.setPath('userData', process.env.REVIEW_PROFILE);
Notification.isSupported = () => false;
const { createPersonalDesktop } = await import(pathToFileURL(join(process.env.WORK_SWITCH_SOURCE || process.cwd(), 'src/personal-desktop.mjs')).href);
let quitting = false;
app.on('before-quit', () => { quitting = true; });
app.whenReady().then(async () => {
const desktop = createPersonalDesktop({ startInTray:true, libraryDesktopToken:process.env.REVIEW_LIBRARY_TOKEN, origin:process.env.REVIEW_ORIGIN, isQuitting:()=>quitting });
await desktop.ready;
desktop.window.setContentSize(1200,800);
desktop.window.webContents.setBackgroundThrottling(false);
});
