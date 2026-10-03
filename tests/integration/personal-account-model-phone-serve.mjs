/** Opt-in Stage13 phone UI host. The private seed is consumed only by the test APK. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { decryptStage12Dpapi } from './stage12-dpapi-loader.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE13_PHONE_SERVE !== '1')
  throw new Error('Explicit Windows Stage13 phone fixture opt-in is required.');
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const mobileUiDir = process.env.WEFTMATE_STAGE13_MOBILE_UI_DIR;
const androidApk = process.env.WEFTMATE_STAGE13_ANDROID_APK;
const privateKeyPath = process.env.WEFTMATE_STAGE13_MIMO_DPAPI_PATH;
const privateRoot = realpathSync(join(repository, '..', 'Runtime', 'UnifiedAssistant', 'private-model-tests'));
if (!mobileUiDir || !androidApk || !privateKeyPath || !isAbsolute(mobileUiDir) ||
    !isAbsolute(androidApk) || !isAbsolute(privateKeyPath) ||
    basename(androidApk).toLowerCase() !== 'android-candidate.apk' ||
    basename(privateKeyPath) !== 'mimo-v2.6-flash.dpapi' ||
    !realpathSync(privateKeyPath).startsWith(privateRoot + sep))
  throw new Error('Stage13 owned UI, APK and private MiMo fixture paths are required.');
realpathSync(mobileUiDir);
realpathSync(androidApk);
const electron = createRequire(import.meta.url)('electron');
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-stage13-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'),
  JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' }), { flag: 'wx', mode: 0o600 });
const login = { username: 'Stage13SyntheticOwner', password: `synthetic-${randomUUID()}-password` };
const seedFile = join(profile, 'stage13-private-seed.json');
let privateKey = await decryptStage12Dpapi(privateKeyPath);
assert.ok(typeof privateKey === 'string' && privateKey.length > 10);
writeFileSync(seedFile, JSON.stringify({ ...login, modelEndpoint: 'https://api.xiaomimimo.com/v1',
  modelId: 'mimo-v2.6-flash', modelName: 'MiMo V2.6 Flash', apiKey: privateKey }) + '\n',
{ flag: 'wx', mode: 0o600 });
privateKey = null;

const child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host',
  '--access-port=18188', `--mobile-ui-dir=${mobileUiDir}`, `--android-package-path=${androidApk}`], {
  cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: { ...process.env, WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1' },
});
let output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
  output = (output + String(chunk)).slice(-32 * 1024);
});
function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function until(check, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const found = await check();
    if (found) return found;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Stage13 owned host exited');
    await pause(100);
  }
  throw new Error('Stage13 owned host timed out');
}
function manage(action) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { child.off('message', listener); reject(new Error('management timeout')); }, 30_000);
    const listener = (frame) => {
      if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
      child.off('message', listener); clearTimeout(timer);
      frame.ok === true ? resolve(frame.result) : reject(new Error(`management failed: ${frame.code}`));
    };
    child.on('message', listener);
    child.send({ type: 'weftmate:manage', requestId, action }, (error) => {
      if (error) { child.off('message', listener); clearTimeout(timer); reject(error); }
    });
  });
}
async function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.send({ type: 'weftmate:quit' });
  if (!await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]))
    throw new Error(`Stage13 owned host did not quit; pid=${child.pid}`);
  assert.equal(child.exitCode, 0);
}
async function json(origin, method, route, body) {
  const response = await fetch(origin + route, { method, redirect: 'error',
    headers: method === 'GET' ? {} : { origin, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
  return { status: response.status, body: await response.json() };
}
try {
  const origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:18188)/
    .exec(output)?.[1]);
  const grant = await manage('account.setup');
  const setup = await json(origin, 'POST', '/personal/v1/auth/setup',
    { grant: grant.grant, ...login, deviceName: 'Stage13 owned desktop' });
  assert.equal(setup.status, 201);
  console.log(`[stage13-phone-serve] ready origin=${origin} profile=${profile} seedFile=${seedFile}`);
  const input = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
  await new Promise((resolve) => {
    const done = () => { process.off('SIGINT', done); process.off('SIGTERM', done); input.close(); resolve(); };
    process.once('SIGINT', done); process.once('SIGTERM', done);
    input.on('line', (line) => { if (line.trim().toLowerCase() === 'q') done(); });
  });
} finally {
  await stop();
  console.log(`[stage13-phone-serve] stopped profile=${profile}`);
}
