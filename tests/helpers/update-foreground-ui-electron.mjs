import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
import { createDesktopUpdates } from '../../src/personal-update/desktop.mjs';
app.setPath('userData', process.env.UPFG_PROFILE);
app.setAppUserModelId('com.memoweft.weftmate.upfguiqa');
let quitting = false;
app.on('before-quit', () => { quitting = true; });
app.whenReady().then(async () => {
const updates = await createDesktopUpdates({ appVersion: '0.1.0', isIdle: async () => true,
  root: join(process.env.UPFG_PROFILE, 'updates/ui'), feed: process.env.UPFG_FEED,
  trustedKeys: JSON.parse(await readFile(process.env.UPFG_KEYS, 'utf8')) });
const desktop = createPersonalDesktop({ origin: process.env.UPFG_ORIGIN, libraryDesktopToken: process.env.UPFG_TOKEN,
  startInTray: true, isQuitting: () => quitting });
updates.attach(desktop.window); await desktop.ready;
globalThis.upfg = { updates, desktop, async close() { updates.close(); await desktop.close(); } };
}).catch(error => { console.error(error); app.exit(1); });
