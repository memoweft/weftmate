// Production Electron shell and update IPC with a synthetic updater transport.
import { app, nativeTheme, Notification } from 'electron';
import { registerHooks } from 'node:module';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
app.setPath('userData', process.env.FIX_UPDATE_PROFILE);
app.setAppUserModelId('com.memoweft.weftmate.fixupdate');
app.getVersion = () => '0.2.0-preview.13';
Notification.isSupported = () => false;
globalThis.fixUpdateState = { enabled: true, status: 'not-available', version: null, error: null };
registerHooks({ resolve(specifier, context, next) {
  const resolved = next(specifier, context);
  if (resolved.url !== new URL('../../src/update.ts', import.meta.url).href) return resolved;
  return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
    export const updateState=()=>({...globalThis.fixUpdateState});
    export const checkForUpdates=async()=>updateState();
    export const quitAndInstall=()=>false;
    export const changeUpdateChannel=()=>{};
    export const requiresManualAppInstall=()=>false;
    export const showPreparedInstaller=()=>false;
  `) };
} });
app.whenReady().then(async () => {
nativeTheme.themeSource = 'light';
let quitting = false;
app.on('before-quit', () => { quitting = true; });
const { createDesktopUpdates } = await import('../../src/personal-update/desktop.mjs');
const updates = await createDesktopUpdates({ isIdle: async () => true, feed: null });
const desktop = createPersonalDesktop({ origin: process.env.FIX_UPDATE_ORIGIN, libraryDesktopToken: process.env.FIX_UPDATE_TOKEN,
  startInTray: true, isQuitting: () => quitting });
updates.attach(desktop.window);
await desktop.ready;
desktop.window.setContentSize(1200, 800);
desktop.window.webContents.setBackgroundThrottling(false);
globalThis.fixUpdateFixture = { desktop, updates, publish(state) {
  globalThis.fixUpdateState = { ...globalThis.fixUpdateState, ...state };
  desktop.window.webContents.send('wm:update-state', globalThis.fixUpdateState);
}, async close() { updates.close(); await desktop.close(); } };
}).catch(error => { console.error(error); app.exit(1); });
