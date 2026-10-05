/** Explicit isolated 0.8.0/code13 Android Weave shell acceptance; no model requests. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE15_RELEASE_UI_ANDROID !== '1') {
  throw new Error('Set WEFTMATE_STAGE15_RELEASE_UI_ANDROID=1 for isolated Android release UI acceptance.');
}
const adb = process.env.WEFTMATE_STAGE15_ADB;
const serial = process.env.WEFTMATE_STAGE15_ANDROID_SERIAL;
const appApk = process.env.WEFTMATE_STAGE15_ANDROID_APP_APK;
const testApk = process.env.WEFTMATE_STAGE15_ANDROID_TEST_APK;
if (![adb, appApk, testApk].every((value) => typeof value === 'string' && existsSync(value)) ||
    typeof serial !== 'string' || !serial) throw new Error('Existing adb, serial, app APK and test APK are required.');

const root = mkdtempSync(join(tmpdir(), 'weftmate-stage15-release-ui-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }), listModels: async () => [],
  preflight: async () => ({ ok: true }), createSession: async ({ sessionId }) => ({ sessionId }),
  sendMessage: async () => ({ accepted: true }), cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
  describeSession: async () => null,
};
const service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend });
const run = (...args) => execFileSync(adb, ['-s', serial, ...args],
  { windowsHide: true, encoding: 'utf8', timeout: 60_000 });
const runAsync = (...args) => promisify(execFile)(adb, ['-s', serial, ...args],
  { windowsHide: true, encoding: 'utf8', timeout: 180_000 });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const accounts = [{ username: `stage15releasea${suffix}`, password: `Stage15-A-${randomUUID()}-release` },
  { username: `stage15releaseb${suffix}`, password: `Stage15-B-${randomUUID()}-release` }];
let reversePort = null;
async function register(origin, account, deviceName) {
  const response = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ ...account, deviceName }) });
  assert.equal(response.status, 201);
}
try {
  const { origin } = await service.start();
  await register(origin, accounts[0], 'Stage15 Release A host');
  await register(origin, accounts[1], 'Stage15 Release B host');
  const port = Number(new URL(origin).port);
  run('reverse', `tcp:${port}`, `tcp:${port}`); reversePort = port;
  try { run('uninstall', 'com.memoweft.weftmate.mobile.stage15releaseqa.test'); } catch {}
  try { run('uninstall', 'com.memoweft.weftmate.mobile.stage15releaseqa'); } catch {}
  run('install', '-r', appApk); run('install', '-r', testApk);
  const { stdout } = await runAsync('shell', 'am', 'instrument', '-w', '-r',
    '-e', 'class', 'com.memoweft.weftmate.mobile.Stage15ReleaseUiInstrumentedTest',
    '-e', 'stage15ReleaseUi', '1', '-e', 'origin', `http://127.0.0.1:${port}`,
    '-e', 'userA', accounts[0].username, '-e', 'passwordA', accounts[0].password,
    '-e', 'userB', accounts[1].username, '-e', 'passwordB', accounts[1].password,
    'com.memoweft.weftmate.mobile.stage15releaseqa.test/androidx.test.runner.AndroidJUnitRunner');
  assert.match(stdout, /OK \(1 test\)/);
  console.log(JSON.stringify({ packageId: 'com.memoweft.weftmate.mobile.stage15releaseqa',
    nativeVersion: '0.8.0', versionCode: 13, accountSwitchIsolation: true,
    draftActivityRestartRestored: true,
    screenshots: ['stage15-release-shell-light.png', 'stage15-release-profile-light.png',
      'stage15-release-appearance-dark.png', 'stage15-release-models-light.png',
      'stage15-release-notifications-light.png', 'stage15-release-devices-light.png',
      'stage15-release-updates-light.png', 'stage15-release-update-install-light.png'] }));
} finally {
  if (reversePort !== null) try { run('reverse', '--remove', `tcp:${reversePort}`); } catch {}
  await service.close().catch(() => {});
  if (realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) rmSync(root, { recursive: true, force: true });
}
