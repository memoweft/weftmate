import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { keyId, sha256, signManifest } from '../../src/personal-update/manifest.mjs';
import { managedMkdtempSync, disposeManagedTemp } from '../helpers/managed-temp.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { until } from '../helpers/migration-host.mjs';
import { setPersonalAccessUiResourceReader } from '../../src/personal-access-ui/index.mjs';
const out = process.env.WEFTMATE_EVIDENCE_DIR; assert.ok(out); mkdirSync(out, { recursive: true });
const root = managedMkdtempSync('weftmate-upfg-ui-', { prune: false }), keys = join(root, 'keys.json');
const pair = generateKeyPairSync('ed25519'), pub = pair.publicKey.export({ type: 'spki', format: 'pem' });
writeFileSync(keys, JSON.stringify({ [keyId(pub)]: pub }));
const asset = Buffer.concat([readFileSync('src/personal-access-ui/tokens.css'), Buffer.from('\n:root{--upfg-proof:1}\n')]);
const manifest = signManifest({ schemaVersion: 1, layer: 'ui', version: '0.1.1', channel: 'stable',
  minAppVersion: '0.1.0', publishedAt: new Date().toISOString(), files: [{ path: 'personal-access-ui/tokens.css', size: asset.length, sha256: sha256(asset) }] }, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
let available = false, assets = 0;
const server = createServer((req, res) => {
  if (!available) return res.writeHead(404).end();
  if (req.url === '/manifest-ui.json') return res.end(JSON.stringify(manifest));
  assets++; res.end(asset);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixture = await startTimelineCandidate({ historyCount: 0 });
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE)/.test(key)) delete env[key];
Object.assign(env, { UPFG_PROFILE: root, UPFG_KEYS: keys, UPFG_FEED: `http://127.0.0.1:${server.address().port}/manifest-ui.json`,
  UPFG_ORIGIN: fixture.origin, UPFG_TOKEN: fixture.libraryDesktopToken, WEFTMATE_TEST_HOST_NAME: 'synthetic-host' });
const report = {}; let app, readUpdatedResources = false;
// The synthetic account HTTP service lives in this test process. Forward its
// static-resource reads to the real desktop UpdateStore, as main normally does
// in-process; activation and signature validation still run in Electron.
setPersonalAccessUiResourceReader(async name => {
  if (!readUpdatedResources) return null;
  const value = await app.evaluate(async (_electron, name) => (await globalThis.upfg.updates.store.resource(name))?.toString('base64') ?? null, name);
  return value ? Buffer.from(value, 'base64') : null;
});
const state = () => app.evaluate(() => {
  const win = globalThis.upfg.desktop.window;
  return { visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused(), version: globalThis.upfg.updates.store.state.currentVersion,
    status: globalThis.upfg.updates.store.state.status };
});
try {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: resolve('.'), args: [resolve('tests/helpers/update-foreground-ui-electron.mjs')], env });
  const page = await app.firstWindow(); await page.waitForFunction(() => globalThis.__WeftUiStarted === true);
  report.before = await state(); assert.equal(report.before.visible, false);
  available = true;
  await app.evaluate(() => globalThis.upfg.updates.check());
  report.downloaded = await state(); assert.equal(report.downloaded.status, 'ready'); assert.equal(report.downloaded.visible, false); assert.ok(assets > 0);
  readUpdatedResources = true;
  await app.evaluate(() => globalThis.upfg.desktop.show());
  await until(async () => (await state()).status === 'current');
  report.applied = await state(); assert.equal(report.applied.version, '0.1.1');
  assert.equal(report.applied.visible, true); assert.equal(report.applied.minimized, false); assert.equal(report.applied.focused, true);
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--upfg-proof').trim() === '1');
  await page.screenshot({ path: join(out, 'ui-applied.png') });
  await app.evaluate(() => globalThis.upfg.desktop.window.hide());
  await app.evaluate(() => globalThis.upfg.updates.check());
  report.laterBackgroundCheck = await state(); assert.equal(report.laterBackgroundCheck.visible, false);
  report.passed = true;
} finally {
  readUpdatedResources = false; setPersonalAccessUiResourceReader(null);
  await app?.evaluate(() => globalThis.upfg.close()); await app?.close(); await fixture.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); disposeManagedTemp(root);
  writeFileSync(join(out, 'ui.json'), JSON.stringify(report, null, 2));
}
console.log('UPDATE-FOREGROUND: real UI download stays hidden; reopening applies in the focused window');
