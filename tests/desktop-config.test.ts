import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { applyDesktopConfig, saveDesktopConfig, desktopConfigPath, validateDesktopConfig } from '../src/desktop-config.mjs';
import { productionConfigFromTask } from '../scripts/migrate-desktop-config.mjs';
import { uninstallDesktopData } from '../src/desktop-uninstall.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../src/host-mode.mjs';
import { assertReleaseVersion } from '../scripts/release/windows.mjs';

test('installed startup reads configuration and channel without source launcher arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-config-'));
  try {
    const file = desktopConfigPath(root), profile = join(root, 'account');
    const config = { schemaVersion: 1, dataDirectory: profile, accessPort: 19222,
      publicOrigin: 'https://example.invalid', trustLoopbackProxy: true,
      production: { cloudIssuer: 'https://example.invalid/oidc', relayEnabled: false },
      updates: { channel: 'preview', baseUrl: 'https://example.invalid/updates/windows/x64/' } };
    saveDesktopConfig(file, config);
    const argv = ['app', '--access-port=0'], env: Record<string,string> = {};
    const result = applyDesktopConfig({ appData: root, packaged: true, argv, env });
    assert.equal(result.file, file);
    assert.ok(argv.includes(`--user-data-dir=${profile}`)); assert.ok(argv.includes('--access-port=0'));
    assert.equal(argv.filter(item => item.startsWith('--access-port')).length, 1);
    assert.equal(env.WEFTMATE_RELAY_ENABLED, 'false');
    assert.equal(env.WEFTMATE_UPDATE_FEED, 'https://example.invalid/updates/windows/x64/preview/');
    assert.equal(env.WEFTMATE_UI_UPDATE_FEED, 'https://example.invalid/updates/windows/x64/preview/manifest-ui.json');
    assert.throws(() => validateDesktopConfig({ ...config, dataDirectory: 'relative' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('migration parses Production values without executing task and rehearsal disables public access', async () => {
  const sourceTaskScript = resolve('scripts/run-personal-host-task.ps1');
  const config = await productionConfigFromTask({ sourceTaskScript });
  assert.equal(config.accessPort, 18186); assert.equal(config.publicOrigin, 'https://home.weftmate.com:8443');
  assert.match(config.mobileUiDirectory, /mobile-ui-releases$/);
  assert.match(config.personalMemoryConfig, /personal-memory-config-20260927.json$/);
  assert.equal(config.production.relayEnabled, true);
  const rehearsal = await productionConfigFromTask({ sourceTaskScript, dataDirectory: resolve('test-profile'), rehearsal: true });
  assert.equal(rehearsal.accessPort, 0); assert.equal(rehearsal.publicOrigin, undefined);
  assert.equal(rehearsal.production.relayEnabled, false); assert.equal(rehearsal.updates.baseUrl, undefined);
});
test('uninstall preserves configured account unless explicit deletion is requested', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-uninstall-')), profile = join(root, 'profile');
  try {
    await mkdir(profile); await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
    await writeFile(join(profile, 'retained.txt'), 'data');
    saveDesktopConfig(desktopConfigPath(root), { schemaVersion: 1, dataDirectory: profile, accessPort: 0, updates: { channel: 'stable' } });
    await uninstallDesktopData({ appData: root }); assert.equal(await readFile(join(profile, 'retained.txt'), 'utf8'), 'data');
    await uninstallDesktopData({ appData: root, deleteData: true });
    await assert.rejects(readFile(join(profile, 'retained.txt')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('release channels require stable or numbered preview versions', () => {
  assert.equal(assertReleaseVersion('1.2.3', 'stable'), '1.2.3');
  assert.equal(assertReleaseVersion('1.2.3-preview.2', 'preview'), '1.2.3-preview.2');
  assert.throws(() => assertReleaseVersion('1.2.3-beta.2', 'preview'));
  assert.throws(() => assertReleaseVersion('1.2.3-preview.2', 'stable'));
});
