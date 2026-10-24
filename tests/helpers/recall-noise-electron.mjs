import { app, BrowserWindow, Notification } from 'electron';
import { resolve } from 'node:path';
// Real application, with an isolated test identity and no visible windows.
app.setName('WeftMate Recall Noise Test');
app.getAppPath = () => resolve(import.meta.dirname, '../..');
app.setAppUserModelId('com.memoweft.weftmate.test.recall-noise');
app.setPath('userData', process.env.WEFTMATE_RECALL_TEST_PROFILE);
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.showInactive = function () {};
Notification.prototype.show = function () {};
process.stdout?.on('error', error => { if (error.code !== 'EPIPE') throw error; });
process.stderr?.on('error', error => { if (error.code !== 'EPIPE') throw error; });
app.whenReady().then(async () => {
    const { createPersonalDesktop } = await import('../../src/personal-desktop.mjs');
    createPersonalDesktop({ origin: process.env.WEFTMATE_RECALL_TEST_ORIGIN,
        libraryDesktopToken: process.env.WEFTMATE_RECALL_TEST_TOKEN, isQuitting: () => false, startInTray: true });
});
