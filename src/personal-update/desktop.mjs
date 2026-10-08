import { app, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UpdateStore, updateSource } from './store.mjs';
import { personalAccessUiResources, setPersonalAccessUiResourceReader } from '../personal-access-ui/index.mjs';
import { updateState, checkForUpdates, quitAndInstall } from '../update.ts';
import { createMobileUiPublisher } from '../personal-access/mobile-ui-release.mjs';

export async function updateTrustedKeys({ development = false, feed = null } = {}) {
  // Packaged applications never accept an environment-provided trust root.
  const file = development && feed && updateSource(feed).protocol === 'http:' && process.env.WEFTMATE_UPDATE_TEST_PUBLIC_KEYS_PATH
    ? process.env.WEFTMATE_UPDATE_TEST_PUBLIC_KEYS_PATH : new URL('./trusted-keys.json', import.meta.url);
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function createDesktopUpdates({ isIdle, appVersion = app.getVersion(), getWindow = () => null,
  root = join(app.getPath('userData'), 'updates', 'ui'), feed = process.env.WEFTMATE_UI_UPDATE_FEED,
  trustedKeys = null, selfCheckTimeout = 10000, mobileUiDir = null, beforeAppInstall = async () => {} } = {}) {
  const channel = process.env.WEFTMATE_UPDATE_CHANNEL || 'stable';
  const store = await new UpdateStore({ root, trustedKeys: trustedKeys || await updateTrustedKeys({ development: !app.isPackaged, feed }),
    versions: { app: appVersion, host: appVersion, bridge: 1 }, channel, builtInVersion: appVersion,
    allowedPaths: new Set(personalAccessUiResources.keys()), builtInFile: name => personalAccessUiResources.get(name) }).init();
  setPersonalAccessUiResourceReader(name => store.resource(name));
  const mobile = mobileUiDir ? createMobileUiPublisher({ root: mobileUiDir, trustedKeys: store.trustedKeys, hostVersion: appVersion }) : null;
  let window = null, switching = false, checkTimer = null, healthTimer = null, startFailed = false;
  const state = async () => {
    let mobileManifest = null, mobileError = null;
    try { mobileManifest = await mobile?.current(); } catch { mobileError = '手机界面包清单校验失败'; }
    return { layers: [
    { ...store.state, enabled: !!feed, channel },
    { layer: 'app', currentVersion: appVersion, availableVersion: updateState().version, ...updateState(), channel },
    { layer: 'mobile-ui', currentVersion: mobileManifest?.version || mobileManifest?.uiVersion || null,
      availableVersion: mobileManifest?.version || mobileManifest?.uiVersion || null, scope: 'host-published',
      status: mobileError ? 'failed' : mobileManifest ? 'device-managed' : 'disabled', error: mobileError, enabled: !!mobile, channel },
  ], canRestart: updateState().status === 'downloaded' };
  };
  async function check() {
    await Promise.all([feed ? store.check(feed) : undefined, checkForUpdates(getWindow)]);
    return state();
  }
  async function failed() {
    if (!store.pointer.trial || switching) return;
    switching = true; clearTimeout(healthTimer);
    try { await store.rollback(); if (window && !window.isDestroyed()) window.webContents.reload(); }
    finally { switching = false; }
  }
  async function loaded() {
    if (!store.pointer.trial || !window || window.isDestroyed()) return;
    try {
      const healthy = await window.webContents.executeJavaScript(`globalThis.__WeftUiStarted === true`);
      if (!healthy || startFailed) return await failed();
      await store.healthy();
      clearTimeout(healthTimer);
    } catch { await failed(); }
  }
  async function reopen() {
    if (!window || window.isDestroyed() || switching || !store.pointer.staged || store.pointer.trial) return false;
    if (!await isIdle()) return false;
    // Reopening must also preserve an unsent local or remotely hosted draft.
    try {
      if (await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('textarea')).some(node => node.offsetParent && node.value.trim()) || Array.from(document.querySelectorAll('button')).some(node => !node.hidden && node.offsetParent && node.textContent.trim() === '停止' && !node.disabled)`)) return false;
    } catch { return false; }
    switching = true;
    try {
      if (!await store.activate({ idle: true })) return false;
      startFailed = false;
      healthTimer = setTimeout(() => void failed(), selfCheckTimeout);
      window.webContents.reload(); return true;
    } catch { await store.rollback(); return false; }
    finally { switching = false; }
  }
  function attach(win) {
    window = win;
    win.on('show', () => void reopen());
    win.webContents.on('did-finish-load', () => void loaded());
    win.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => { if (isMainFrame) void failed(); });
    win.webContents.on('render-process-gone', () => void failed());
    win.webContents.on('console-message', (_event, details) => {
      if (store.pointer.trial && /Uncaught|SyntaxError/.test(details?.message || '')) { startFailed = true; void failed(); }
    });
    if (store.pointer.trial) { healthTimer = setTimeout(() => void failed(), selfCheckTimeout); if (!win.webContents.isLoading()) void loaded(); }
  }
  const trusted = event => window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === window.webContents.getURL() && ['/personal/v1/ui', '/personal/v1/ui/'].includes(new URL(event.senderFrame.url).pathname);
  async function restart() {
    if (updateState().status !== 'downloaded' || !await isIdle()) return false;
    try { await beforeAppInstall(); } catch { return false; }
    return await isIdle() && quitAndInstall();
  }
  for (const [channelName, handler] of [['wm:desktop:update-state', state], ['wm:desktop:update-check', check],
    ['wm:desktop:update-restart', async () => { const restarted = await restart(); return { restarted, ...(restarted ? {} : { reason: '更新尚未就绪、任务仍在运行或更新前备份未完成，请稍后重试' }) }; }]]) {
    ipcMain.handle(channelName, (event) => { if (!trusted(event)) throw new Error('Desktop update unavailable'); return handler(); });
  }
  if (feed || updateState().enabled) { checkTimer = setInterval(() => void check(), 60 * 60 * 1000); checkTimer.unref(); void check(); }
  return { store, state, check, reopen, attach, restart, async prepareWindow() { if (await isIdle()) await store.activate({ idle: true }); },
    close() { clearInterval(checkTimer); clearTimeout(healthTimer); setPersonalAccessUiResourceReader(null);
      for (const name of ['wm:desktop:update-state', 'wm:desktop:update-check', 'wm:desktop:update-restart']) ipcMain.removeHandler(name); } };
}
