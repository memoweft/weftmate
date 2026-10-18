import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Run the complete production factory. Electron and local transport are doubles;
// this does not launch an Electron window or exercise native installation.
const profile = mkdtempSync(join(tmpdir(), 'weftmate-desktop-lifecycle-'));
const repository = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:31997', channel = 'wm:desktop:cloud-credentials-present';
const handlers = new Map<string, Function>(), windows: any[] = [], desktops: any[] = [];
const noop = () => {};
const generic = (target: any): any => new Proxy(target, {
  get: (value, key) => key in value ? typeof value[key] === 'function' ? value[key].bind(value) : value[key] : noop,
});
const localSession = { webRequest: { onBeforeSendHeaders() {} }, cookies: { flushStore: async () => {} },
  flushStorageData() {}, setCertificateVerifyProc() {}, fetch: async (url: string) => {
    const path = new URL(url).pathname;
    const body = path.endsWith('/auth/desktop') ? { accounts: [{ ownerId: 'synthetic-owner' }] }
      : path.endsWith('/auth/me') ? { account: { ownerId: 'synthetic-owner' }, device: { id: 'synthetic-device' } }
        : path.endsWith('/sessions') ? { sessions: [] } : { backend: { runtime: 'ready' } };
    return { ok: true, status: 200, json: async () => body };
  } };
class Window extends EventEmitter {
  webContents: any;
  constructor() {
    super();
    this.webContents = generic(Object.assign(new EventEmitter(), { id: windows.length + 1,
      mainFrame: { url: origin + '/personal/v1/ui' }, isDestroyed: () => false,
      getURL: () => origin + '/personal/v1/ui', executeJavaScript: async () => undefined, session: localSession }));
    windows.push(this); return generic(this);
  }
  loadURL() { return Promise.resolve(); }
  isDestroyed() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1200, height: 800 }; }
  isVisible() { return true; }
}
const electron = {
  app: Object.assign(new EventEmitter(), { isPackaged: false, getPath: () => profile, getAppPath: () => repository,
    getLoginItemSettings: () => ({ openAtLogin: false }), getVersion: () => '0.1.0' }),
  BrowserWindow: Window,
  ipcMain: { handle: (name: string, callback: Function) => {
    if (handlers.has(name)) throw new Error('duplicate handler: ' + name);
    handlers.set(name, callback);
  }, removeHandler: (name: string) => handlers.delete(name) },
  Notification: { isSupported: () => false }, screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] }, shell: {},
  session: { fromPartition: () => localSession }, nativeTheme: Object.assign(new EventEmitter(), { shouldUseDarkColors: false }),
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value).map(byte => byte ^ 0x79),
    decryptString: (value: Buffer) => Buffer.from(value).map(byte => byte ^ 0x79).toString() },
  dialog: {}, clipboard: {}, powerMonitor: {}, desktopCapturer: {}, nativeImage: {},
};
(globalThis as any).__weftmateDesktopLifecycleElectron = electron;
const electronUrl = 'data:text/javascript,' + encodeURIComponent(Object.keys(electron)
  .map(name => `export const ${name}=globalThis.__weftmateDesktopLifecycleElectron.${name};`).join('\n'));
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'electron' ? { url: electronUrl, shortCircuit: true } : next(specifier, context);
} });
const { createPersonalDesktop } = await import('../src/personal-desktop.mjs');
const create = () => {
  const desktop = createPersonalDesktop({ origin, libraryDesktopToken: 'synthetic-capability', isQuitting: () => false, startInTray: true });
  desktops.push(desktop); return desktop;
};
test.afterEach(async () => {
  for (const desktop of desktops.splice(0).reverse()) await desktop.close();
  handlers.clear();
});
test.after(() => {
  hooks.deregister(); delete (globalThis as any).__weftmateDesktopLifecycleElectron;
  rmSync(profile, { recursive: true, force: true });
});

test('closing a desktop releases its native cloud credential presence handler', async () => {
  const desktop = create(); await desktop.ready;
  assert.equal(handlers.has(channel), true);
  await desktop.close();
  assert.equal(handlers.has(channel), false, 'A closed desktop must not retain the native presence handler');
});

test('a desktop can be rebuilt after close without duplicate IPC registration or stale sender authority', async () => {
  const previous = create(); await previous.ready; await previous.close();
  const next = create(); await next.ready;
  const handler = handlers.get(channel)!;
  const event = { sender: next.window.webContents, senderFrame: next.window.webContents.mainFrame };
  assert.equal(await handler(event), false);
  assert.throws(() => handler({ sender: previous.window.webContents, senderFrame: previous.window.webContents.mainFrame }));
  await next.close();
  assert.equal(handlers.has(channel), false);
});
