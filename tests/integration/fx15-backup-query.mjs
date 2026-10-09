// Private backup diagnostics: never export account identifiers, names, text or credentials.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { hashPassword } from '../../src/personal-access/password.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { validateStore } from '../../src/personal-access/store.mjs';

const repository = resolve(import.meta.dirname, '../..');
const source = process.argv[2];
assert.ok(source, 'Pass an explicitly authorized BACKUP directory');
const root = await mkdtemp(join(tmpdir(), 'weftmate-fx15-backup-query-'));
const profile = join(root, 'profile');
let app;
let startupLog = '';
const report = { backupReadOnly: true, vaultExcluded: true, paidModelRequests: 0, probes: [] };
try {
  await cp(source, profile, { recursive: true, filter: file => !/node_modules|vault|credentials|keychain/i.test(basename(file)) });
  // Generated DSH configuration may reference the original installation. Rebuild
  // only this disposable generated cache; authoritative account memory stays put.
  await rm(join(profile, 'dsh-home'), { recursive: true, force: true });
  async function rebase(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, item.name);
      if (item.isDirectory()) await rebase(file);
      else if (/\.(json|jsonl|ya?ml)$/.test(item.name)) {
        const text = await readFile(file, 'utf8');
        const replaced = text.replaceAll('D:\\\\AIProjects\\\\WeftMate\\\\Runtime\\\\UnifiedAssistant\\\\personal-account-20260926', profile.replaceAll('\\', '\\\\'))
          .replaceAll('D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/personal-account-20260926', profile.replaceAll('\\', '/'));
        if (replaced !== text) await writeFile(file, replaced);
      }
    }
  }
  await rebase(profile);
  await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const file = join(profile, 'personal-access/store.json');
  const store = JSON.parse(await readFile(file, 'utf8'));
  const password = 'FX15-private-copy-test-password';
  const accounts = Object.entries(store.accounts).map(([ownerId, value], index) => {
    const username = `fx15copy${index}`;
    Object.assign(value.account, { username, displayName: username });
    value.account.avatar ??= null; value.account.profileRevision ??= 0;
    if ('usernameCanonical' in value.account) value.account.usernameCanonical = username;
    if ('usernameDisplay' in value.account) value.account.usernameDisplay = username;
    return { ownerId, username, value };
  });
  for (const account of accounts) account.value.account.password = await hashPassword(password);
  report.storeVersion = store.version;
  try { validateStore(store); report.storeValid = true; }
  catch (error) { report.storeValid = false; report.validationLine = Number(String(error.stack).match(/store\.mjs:(\d+)/)?.[1] ?? 0); }
  await writeFile(file, JSON.stringify(store));
  await mkdir(join(profile, 'personal-backup'), { recursive: true });
  await writeFile(join(profile, 'personal-backup/settings.json'), JSON.stringify({ enabled: false, directory: join(root, 'Backups') }));
  const config = join(root, 'memory.json');
  await writeFile(config, JSON.stringify({ python: process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON,
    pythonPath: process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE, baseUrl: 'http://127.0.0.1:1/v1', model: '@current', authRef: 'fx15-unavailable' }));
  const env = { ...process.env, NODE_OPTIONS: `--require=${join(repository, 'tests/integration/r0-1-offline.cjs')}` };
  for (const name of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(name)) delete env[name];
  env.WEFTMATE_BASELINE_TRACE = join(root, 'trace.jsonl');
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
    args: [join(repository, 'tests/integration/m2-exit-bootstrap.mjs'), `--user-data-dir=${profile}`,
      '--personal-host', '--access-port=0', `--personal-memory-config=${config}`], cwd: repository, env, timeout: 90000 });
  app.process().stdout?.on('data', chunk => { startupLog += String(chunk); });
  app.process().stderr?.on('data', chunk => { startupLog += String(chunk); });
  const page = await app.firstWindow(); await page.waitForURL('**/personal/v1/ui*');
  assert.ok(!['18186','8081'].includes(new URL(page.url()).port));
  for (const [seedPrivate, selectAvailableModel] of [[false, false], [true, false], [true, true]]) {
    await app.evaluate((_, seedPrivate) => globalThis.fx15SeedSyntheticRoutes(seedPrivate), seedPrivate);
    const results = await page.evaluate(async ({ accounts, password, selectAvailableModel }) => {
      const results = [];
      for (const [index, account] of accounts.entries()) {
        const login = await fetch('/personal/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: account.username, password, deviceName: 'FX15 copy' }) });
        const models = await (await fetch('/personal/v1/models')).json();
        let selectionStatus = null;
        if (selectAvailableModel && models.models?.some(model => model.configured)) {
          const me = await (await fetch('/personal/v1/auth/me')).json();
          selectionStatus = (await fetch('/personal/v1/settings/models', { method: 'PATCH',
            headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken },
            body: JSON.stringify({ backgroundModelProfileId: models.models.find(model => model.configured).id }) })).status;
        }
        const rows = [];
        const memoryStatus = await (await fetch('/personal/v1/memory/status')).json();
        for (const kind of ['entity','relationship','cognition']) {
          const response = await fetch(`/personal/v1/memory/items?kind=${kind}&limit=1`);
          const value = await response.json();
          rows.push({ httpStatus: response.status, count: value.items?.length ?? null,
            modelUnavailable: JSON.stringify(value).includes('MEMORY_MODEL_UNAVAILABLE') });
        }
        results.push({ index, loginStatus: login.status, rows,
          selectionStatus,
          memoryModelUnavailable: memoryStatus.reasonCode === 'MEMORY_MODEL_UNAVAILABLE',
          modelCount: models.models?.length ?? 0,
          configuredModelCount: models.models?.filter(model => model.configured === true).length ?? 0 });
      }
      return results;
    }, { accounts: accounts.map(({ username }) => ({ username })), password, selectAvailableModel });
    report.probes.push({ syntheticPrivateCredentials: seedPrivate, selectAvailableModel, results });
  }
  const trace = (await readFile(join(root, 'trace.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  report.httpModelUnavailableCount = trace.filter(row => row.kind === 'http-error' && row.code === 'MEMORY_MODEL_UNAVAILABLE').length;
} finally {
  report.startupCodes = Object.fromEntries(['STORE_CORRUPT','MEMORY_CONFIGURATION_INVALID','R01_REHEARSAL_NETWORK_BLOCKED',
    'ENOENT','ERR_MODULE_NOT_FOUND','BACKUP_','profile marker','single instance','EACCES','TypeError','SyntaxError'].map(code => [code, startupLog.includes(code)]));
  await app?.close().catch(() => {});
  assert.equal(resolve(root, '..'), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('weftmate-fx15-backup-query-'));
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
  report.backupCopyDeleted = true;
  await writeFile(join(repository, 'tests/evidence/fx-15/backup-query.json'), JSON.stringify(report, null, 2));
}
