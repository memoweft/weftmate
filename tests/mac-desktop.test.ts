import assert from 'node:assert/strict';
import test from 'node:test';
import { macApplicationMenu, desktopLoginOptions, macFilePermissionHelp } from '../src/mac-desktop.mjs';
import { applyDesktopConfig, desktopConfigPath } from '../src/desktop-config.mjs';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('Mac roles preserve native editing, settings and graceful quit handlers', () => {
  const called: string[] = [];
  const menu = macApplicationMenu({ show: () => called.push('show'), settings: () => called.push('settings'), quit: () => called.push('quit') });
  const items = menu.flatMap(row => row.submenu);
  for (const key of ['undo','redo','cut','copy','paste','selectAll','minimize','hide','about']) assert.ok(items.some(item => item.role === key));
  items.find(item => item.accelerator === 'Command+,')!.click!();
  items.find(item => item.accelerator === 'Command+Q')!.click!();
  assert.deepEqual(called, ['settings', 'quit']); assert.match(macFilePermissionHelp, /文件与文件夹/);
});
test('Mac login registers the bundle while Windows preserves its command arguments', () => {
  const input = { packaged: true, executable: '/trial/App', args: ['--start-in-tray'], name: 'WeftMate' };
  assert.deepEqual(desktopLoginOptions({ ...input, platform: 'darwin' }), { path: input.executable, name: input.name, openAsHidden: true });
  assert.deepEqual(desktopLoginOptions({ ...input, platform: 'win32' }), { path: input.executable, name: input.name, args: input.args });
});
test('Mac installed first open is local and separate; synthetic override never creates the real profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm3-3b-config-'));
  try {
    assert.equal(applyDesktopConfig({ appData: root, packaged: true, platform: 'darwin', argv: ['app','--user-data-dir=/synthetic'], env: {} }), null);
    await assert.rejects(access(desktopConfigPath(root, 'darwin')));
    const argv: string[] = [], env: Record<string,string> = {};
    applyDesktopConfig({ appData: root, packaged: true, platform: 'darwin', argv, env });
    const config = JSON.parse(await readFile(desktopConfigPath(root, 'darwin'), 'utf8'));
    assert.equal(config.dataDirectory, join(root, 'WeftMate Trial/Data'));
    assert.equal(config.production.relayEnabled, false); assert.equal(config.production.acmeEnabled, false);
    assert.equal(config.production.cloudDesktopClientId, 'weftmate-desktop');
    assert.equal(config.production.cloudIssuer, 'https://api.weftmate.com/personal/v1/cloud/oidc');
    assert.deepEqual(config.updates, { channel: 'preview' });
    assert.equal(env.WEFTMATE_UPDATE_FEED, undefined);
    const winArgs: string[] = [];
    applyDesktopConfig({ appData: root, packaged: true, platform: 'win32', argv: winArgs, env: {} });
    const win = JSON.parse(await readFile(desktopConfigPath(root, 'win32'), 'utf8'));
    assert.equal(win.dataDirectory, join(root, 'com.memoweft.weftmate'));
    assert.equal(win.production.relayEnabled, true); assert.match(win.updates.baseUrl, /windows\/x64/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
