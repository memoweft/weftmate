/** Private backup is read-only; only its disposable copy is started, then restored and hashed. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, cp, readdir, lstat, readFile, writeFile, rm, mkdir, readlink } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { productionConfigFromTask } from '../../scripts/migrate-desktop-config.mjs';
import { saveDesktopConfig } from '../../src/desktop-config.mjs';
import { hashPassword } from '../../src/personal-access/password.mjs';

const run = promisify(execFile), repository = resolve(import.meta.dirname, '../..');
const source = process.argv[2]; if (!source) throw new Error('Pass the explicitly authorized backup directory');
const releaseRoot = resolve(process.argv[3] || '.local/r0-1/final-releases');
const root = await mkdtemp(join(tmpdir(), 'weftmate-r01-migration-')), profile = join(root, 'profile');
const evidence = join(repository, 'tests/evidence/r0-1'); await mkdir(evidence, { recursive: true });
const control = join(process.env.APPDATA, 'WeftMate r01qa'), configFile = join(control, 'WeftMate/desktop-config.json');
const installer = join(releaseRoot, '0.1.1-preview.2/build/WeftMate-Setup-0.1.1-preview.2.exe');
const installation = join(root, 'Programs/WeftMate'), executable = join(installation, 'WeftMate.exe');
let application, privateHostLog = '';
const report = { backupReadOnly: true, sourceTaskUntouched: true, randomPort: true, publicOrigin: null,
  rehearsalAccountPassword: 'temporary synthetic password on the copy only', paidModelRequests: 0, networkBoundary: 'loopback only; 8081 and 18186 denied' };
async function hashes(dir) {
  const entries = new Map(), files = [];
  async function walk(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const file = join(current, item.name);
      if (item.isSymbolicLink()) entries.set(relative(dir, file).replaceAll('\\', '/'), 'link:' + await readlink(file));
      else if (item.isDirectory()) await walk(file);
      else if (item.isFile()) files.push(file);
    }
  }
  await walk(dir);
  for (let offset = 0; offset < files.length; offset += 32) await Promise.all(files.slice(offset, offset + 32).map(async file =>
    entries.set(relative(dir, file).replaceAll('\\', '/'), createHash('sha256').update(await readFile(file)).digest('hex'))));
  return entries;
}
const difference = (a, b) => ({ added: [...b.keys()].filter(key => !a.has(key)).length, removed: [...a.keys()].filter(key => !b.has(key)).length,
  changed: [...a.keys()].filter(key => b.has(key) && a.get(key) !== b.get(key)).length });
const env = { ...process.env, NODE_OPTIONS: `--require=${join(repository, 'tests/integration/r0-1-offline.cjs')}` };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(key)) delete env[key];
env.LOCALAPPDATA = join(root, 'Local'); await mkdir(env.LOCALAPPDATA);
async function start(installed) {
  application = await _electron.launch({ executablePath: installed ? executable : createRequire(import.meta.url)('electron'),
    args: installed ? [] : [repository, `--desktop-config=${configFile}`], cwd: root, env, timeout: 600000 });
  application.process().stdout?.on('data', bytes => privateHostLog += String(bytes));
  application.process().stderr?.on('data', bytes => privateHostLog += String(bytes));
  await application.evaluate((_electron, input) => {
    process.env.NODE_OPTIONS = input.nodeOptions;
    process.getBuiltinModule('module').createRequire(process.execPath)(input.file);
  }, { nodeOptions: env.NODE_OPTIONS, file: join(repository, 'tests/integration/r0-1-offline.cjs') });
  const page = await application.firstWindow({ timeout: 600000 }); await page.waitForURL('**/personal/v1/ui*');
  await page.waitForFunction(() => globalThis.__WeftUiStarted === true);
  const login = await page.evaluate(async input => (await fetch('/personal/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).status,
    { username: 'R01Migration', password, deviceName: installed ? 'Installed rehearsal' : 'Source rehearsal' });
  assert.equal(login, 200); await page.reload();
  const status = await page.evaluate(async () => (await fetch('/personal/v1/status')).json());
  return { origin: new URL(page.url()).origin, status, settings: await page.evaluate(() => weftmateDesktop.settings()) };
}
const password = `rehearsal-${randomUUID()}-password`;
try {
  console.log('Hashing authorized backup (contents never printed)');
  const before = await hashes(source); report.originalFileCount = before.size;
  await cp(source, profile, { recursive: true, errorOnExist: true });
  console.log('Backup copied; verifying every file');
  assert.deepEqual(difference(before, await hashes(profile)), { added: 0, removed: 0, changed: 0 });
  // Rebase embedded source-data paths, and substitute only the copied account's login for automation.
  async function rebase(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const file = join(current, item.name); if (item.isDirectory()) await rebase(file);
      else if (/\.(json|jsonl|yml|yaml)$/.test(item.name) && (await lstat(file)).size < 10_000_000) {
        const text = await readFile(file, 'utf8');
        const patched = text.replaceAll('D:\\\\AIProjects\\\\WeftMate\\\\Runtime\\\\UnifiedAssistant\\\\personal-account-20260926', profile.replaceAll('\\','\\\\'))
          .replaceAll('D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/personal-account-20260926', profile.replaceAll('\\','/'));
        if (patched !== text) await writeFile(file, patched);
      }
    }
  }
  await rebase(profile);
  // The backup expanded DSH's generated junction fallback into real directories.
  // Recreate only this installation-owned cache; never follow its links into a source tree.
  await rm(join(profile, 'dsh-home/profiles/node_modules'), { recursive: true, force: true });
  report.generatedModuleFallbackRecreated = true;
  const backupSettings = join(profile, 'personal-backup/settings.json');
  const copiedSettings = JSON.parse(await readFile(backupSettings, 'utf8').catch(() => '{}'));
  await writeFile(backupSettings, JSON.stringify({ ...copiedSettings, directory: join(root, 'Backups') }));
  const storeFile = join(profile, 'personal-access/store.json'), store = JSON.parse(await readFile(storeFile, 'utf8'));
  const states = store.accounts ? Object.values(store.accounts) : [store];
  const target = states.find(value => value.account?.password); if (!target) throw new Error('Expected copied local account');
  target.account.username = 'r01migration'; target.account.displayName = 'R01Migration';
  target.account.avatar ??= null; target.account.profileRevision ??= 0;
  target.account.password = await hashPassword(password);
  // Username may be stored as a canonical/display pair in legacy versions.
  if (target.account.usernameCanonical !== undefined) target.account.usernameCanonical = 'r01migration';
  if (target.account.usernameDisplay !== undefined) target.account.usernameDisplay = 'R01Migration';
  await writeFile(storeFile, JSON.stringify(store));
  report.accountIdentityRetained = true;
  if (process.argv.includes('--wait-native')) {
    console.log('Copy prepared; waiting for the separate installer cycle to release its QA identity');
    const deadline = Date.now() + 1800000;
    while (!await readFile(join(repository, '.local/r0-1/native-cycle-finished'), 'utf8').catch(() => false)) {
      if (Date.now() > deadline) throw new Error('Native installer cycle has not finished');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  const config = await productionConfigFromTask({ sourceTaskScript: join(repository, 'scripts/run-personal-host-task.ps1'), dataDirectory: profile, rehearsal: true });
  saveDesktopConfig(configFile, config);
  console.log('Starting source rehearsal, with offline network boundary');
  const sourceRun = await start(false); report.sourceRuntimeReady = sourceRun.status.backend?.runtime;
  await application.close(); application = null;
  await run(installer, ['/S','/currentuser',`/D=${installation}`], { env, windowsHide: true, timeout: 600000 });
  const installedRun = await start(true);
  console.log('Installed rehearsal loaded');
  assert.equal(installedRun.status.backend?.runtime, 'ready');
  assert.notEqual(new URL(installedRun.origin).port, '18186'); assert.notEqual(new URL(installedRun.origin).port, '8081');
  report.installedRuntimeReady = true; report.localLogin = true; report.sameDataDirectory = true;
  report.components = { port: 'random loopback, reachable', login: 'copied owner with temporary local password, passed',
    memoryBridge: 'disabled for the offline rehearsal; original Production reference parsed and preserved',
    relay: 'disabled for the offline rehearsal', certificate: 'ACME disabled; existing certificate files preserved in the backup' };
  await application.close(); application = null;
  report.startupFileChanges = difference(before, await hashes(profile));
  // Source rollback uses the same data directory; no production task is controlled by this runner.
  const revertedRun = await start(false); assert.equal(revertedRun.status.backend?.runtime, 'ready'); report.sourceRollback = true;
  await application.close(); application = null;
  await run(join(installation, 'Uninstall WeftMate.exe'), ['/S'], { env, windowsHide: true, timeout: 600000 });
  // Restore the disposable rehearsal copy, then compare every file; this is explicitly not a claim that a running host writes no files.
  await rm(profile, { recursive: true, force: true }); await cp(source, profile, { recursive: true });
  report.restoredCopy = difference(before, await hashes(profile));
  report.backupAfter = difference(before, await hashes(source));
  assert.deepEqual(report.restoredCopy, { added: 0, removed: 0, changed: 0 }); assert.deepEqual(report.backupAfter, { added: 0, removed: 0, changed: 0 });
  report.hashesMatchAfterRehearsalRestore = true; report.passed = true;
  await writeFile(join(evidence, 'migration-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(join(repository, '.local/r0-1/rehearsal-host-private.log'), privateHostLog);
  await application?.close().catch(() => {});
  if (await readFile(join(installation, 'Uninstall WeftMate.exe')).then(() => true).catch(() => false))
    await run(join(installation, 'Uninstall WeftMate.exe'), ['/S'], { env, windowsHide: true, timeout: 600000 }).catch(() => {});
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); await rm(control, { recursive: true, force: true });
  await rm(join(process.env.LOCALAPPDATA, 'weftmate-r01qa-updater'), { recursive: true, force: true });
}
