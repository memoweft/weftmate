import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { keyId, sha256, signManifest } from '../src/personal-update/manifest.mjs';

const root = await mkdtemp(join(tmpdir(), 'weftmate-update-unit-'));
const electron = { app: { isPackaged: true, getVersion: () => '0.2.0-preview.12', getPath: () => root, quit() {} },
  ipcMain: { handle() {}, removeHandler() {} }, BrowserWindow: class {}, shell: { showItemInFolder() {} } };
const updater: any = Object.assign(new EventEmitter(), { setFeedURL() {}, checkForUpdates: async () => {
  updater.emit('update-available', { version: '0.2.0-preview.13' });
}, downloadUpdate: async () => { updater.emit('download-progress', { percent: 37.5, transferred: 375, total: 1000, bytesPerSecond: 100 }); } });
(globalThis as any).__updateTest = { electron, updater };
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'original-fs') return next('node:fs', context);
  if (specifier === 'electron') return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(
    Object.keys(electron).map(name => `export const ${name}=globalThis.__updateTest.electron.${name};`).join('\n')) };
  if (specifier === 'electron-updater') return { shortCircuit: true, url: 'data:text/javascript,export const autoUpdater=globalThis.__updateTest.updater;' };
  return next(specifier, context);
} });
const previousResources = (process as any).resourcesPath;
(process as any).resourcesPath = root;
const pair = generateKeyPairSync('ed25519'), publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
const trustedKeys = { [keyId(publicKey)]: publicKey };
await writeFile(join(root, 'update-trusted-keys.json'), JSON.stringify(trustedKeys));
const installer = Buffer.from('synthetic verified installer'), installerFile = join(root, 'setup.exe');
await writeFile(installerFile, installer);
const manifest = signManifest({ schemaVersion: 1, layer: 'app', version: '0.2.0-preview.13', channel: 'preview',
  publishedAt: new Date().toISOString(), files: [{ path: 'setup.exe', size: installer.length, sha256: sha256(installer) }] }, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
let empty = true;
const server = createServer((_req, res) => { res.writeHead(empty ? 404 : 200); res.end(empty ? '' : JSON.stringify(manifest)); });
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.WEFTMATE_UPDATE_FEED = `http://127.0.0.1:${(server.address() as any).port}/`;
process.env.WEFTMATE_UPDATE_CHANNEL = 'preview';
const updates = await import('../src/update.ts');
const { createDesktopUpdates } = await import('../src/personal-update/desktop.mjs');
test.after(async () => {
  hooks.deregister(); delete (globalThis as any).__updateTest; (process as any).resourcesPath = previousResources;
  await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true });
});

test('an empty signed app channel reports no releases, not a network error', async () => {
  const state = await updates.checkForUpdates(() => null);
  assert.equal(state.status, 'empty'); assert.equal(state.error, null);
});

test('a signed newer app downloads in background and publishes measured progress', async () => {
  empty = false;
  await updates.checkForUpdates(() => null);
  const state: any = updates.updateState();
  assert.equal(updater.autoDownload, false, 'authorization still precedes downloading');
  assert.equal(state.status, 'available');
  assert.deepEqual(state.progress, { percent: 37.5, transferred: 375, total: 1000, bytesPerSecond: 100 });
  await updater.listeners('update-downloaded')[0]({ version: manifest.version, downloadedFile: installerFile });
  assert.equal(updates.updateState().status, 'downloaded');
  assert.equal(updates.preparedInstallerPath(), installerFile);
});

test('desktop first boot uses preview by version; rollback throwing cannot reject window reopen', async () => {
  delete process.env.WEFTMATE_UPDATE_CHANNEL;
  const desktop = await createDesktopUpdates({ root: join(root, 'ui'), feed: null, trustedKeys, isIdle: async () => true });
  try {
    assert.equal((await desktop.state()).channel, 'preview');
    const contents = Object.assign(new EventEmitter(), { isLoading: () => true, executeJavaScript: async () => false, reload() {} });
    const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: contents });
    desktop.attach(window);
    desktop.store.pointer.staged = 'a'.repeat(64);
    desktop.store.activate = async () => { throw new Error('broken trial'); };
    desktop.store.rollback = async () => { throw new Error('rollback failed'); };
    assert.equal(await desktop.reopen(), false);
    assert.equal(desktop.store.pointer.active, null);
    assert.equal(desktop.store.pointer.staged, null);
  } finally { desktop.close(); }
});

test('old watchdog startup authorization supplies the updated version before its pending file is removed', async () => {
  const recovery = join(root, 'WeftMate', 'app-recovery'); await mkdir(recovery, { recursive: true });
  const file = join(recovery, 'pending.json');
  await writeFile(file, JSON.stringify({ nextVersion: electron.app.getVersion(), executable: process.execPath }));
  const { appUpdateVersionAtBoot } = await import('../src/personal-update/app-rollback.mjs');
  electron.app.isPackaged = false;
  try { assert.equal(await appUpdateVersionAtBoot(), null, 'source-mode launches do not consult installed recovery state'); }
  finally { electron.app.isPackaged = true; }
  const desktop = await createDesktopUpdates({ root: join(root, 'ui-complete'), feed: null, trustedKeys, isIdle: async () => true });
  try {
    await rm(file);
    assert.equal((await desktop.state()).completedVersion, electron.app.getVersion());
    const contents = Object.assign(new EventEmitter(), { isLoading: () => true, executeJavaScript: async () => true });
    desktop.attach(Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: contents }));
    let shown = 0;
    await desktop.confirmAppStartup(() => shown++);
    assert.equal(shown, 1, 'an older watchdog remains eligible after removing its pending authorization');
  } finally { desktop.close(); }
});

test('successful app startup shows once after UI health, while ordinary tray startup and UI reloads stay hidden', async () => {
  for (const updated of [true, false]) {
    if (updated) process.argv.push('--updated');
    let healthy = false, shown = 0;
    const desktop = await createDesktopUpdates({ root: join(root, `foreground-${updated}`), feed: null, trustedKeys, isIdle: async () => true });
    const contents = Object.assign(new EventEmitter(), { isLoading: () => true, executeJavaScript: async () => healthy });
    const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: contents });
    desktop.attach(window);
    try {
      assert.equal(await desktop.confirmAppStartup(() => shown++), false);
      assert.equal(shown, 0, 'an unready version cannot surface as an update success');
      healthy = true;
      assert.equal(await desktop.confirmAppStartup(() => shown++), true);
      assert.equal(shown, updated ? 1 : 0);
      assert.equal(await desktop.confirmAppStartup(() => shown++), false);
      contents.emit('did-finish-load');
      assert.equal(shown, updated ? 1 : 0, 'later loads cannot repeatedly steal focus');
    } finally {
      desktop.close();
      if (updated) process.argv.splice(process.argv.lastIndexOf('--updated'), 1);
    }
  }
});

test('the watchdog health receipt waits for the single asynchronous update activation', async () => {
  const recovery = join(root, 'WeftMate', 'app-recovery'); await mkdir(recovery, { recursive: true });
  const token = 'synthetic-activation', pending = join(recovery, 'pending.json'), healthy = join(recovery, 'healthy.json');
  await writeFile(pending, JSON.stringify({ token, nextVersion: electron.app.getVersion(), executable: process.execPath }));
  const desktop = await createDesktopUpdates({ root: join(root, 'activation-checkpoint'), feed: null, trustedKeys, isIdle: async () => true });
  desktop.attach(Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: Object.assign(new EventEmitter(), { isLoading: () => true, executeJavaScript: async () => true }) }));
  let activate;
  try {
    const confirming = desktop.confirmAppStartup(() => new Promise(resolve => { activate = resolve; }));
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(readFile(healthy), { code: 'ENOENT' });
    assert.equal(await desktop.confirmAppStartup(() => assert.fail('activation repeated')), false);
    activate(); await confirming;
    assert.equal(JSON.parse(await readFile(healthy, 'utf8')).token, token);
  } finally { desktop.close(); await rm(pending, { force: true }); await rm(healthy, { force: true }); }
});
