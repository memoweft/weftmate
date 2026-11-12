// 用法：node scripts/daily/install.mjs --builds <builds> --version 0.2.0-preview.N --previous 0.2.0-preview.P
// 先复制并核验回滚材料，再等待空闲、退出、备份、静默安装和核对原有数据。
// 报告写入版本目录；失败且日用进程已退出时恢复旧安装并正常拉起日用版。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { copyFile, readFile, writeFile, mkdir, readdir, lstat, readlink, access } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { retained, verifyRetained } from './retained.mjs';
import { parseOptions, json, sha, shaFile, pause, until, dailyPaths, dailyEnv, processes, startDaily } from './common.mjs';

const { version, previous, output, previousDirectory } = parseOptions('install', ['previous']);
const repo = join(output, 'source-final');
const asar = createRequire(join(repo, 'package.json'))('@electron/asar');
const { snapshot, verify } = await import(pathToFileURL(join(repo, 'src/personal-backup/archive.mjs')).href);
const { installation, exe, archive, configFile } = dailyPaths();
const root = resolve((await json(configFile)).dataDirectory), hostFile = join(root, 'dsh-home/weftmate-host-state.json');
const env = dailyEnv(), pids = () => processes(exe, env), start = () => startDaily(exe, configFile, env);
const report = { version, ready: false, steps: [] };
const save = () => writeFile(join(output, 'install-report.json'), JSON.stringify(report, null, 2));
const stage = async name => { report.steps.push({ name, at: new Date().toISOString() }); await save(); console.log(name); };
const appVersion = () => { asar.uncache(archive); return JSON.parse(asar.extractFile(archive, 'package.json').toString()).version; };
const store = () => json(join(root, 'personal-access/store.json'));
const exists = async file => access(file).then(() => true, () => false);

async function makeRollback() {
  const target = join(output, 'rollback');
  assert.ok(!await exists(target), 'never overwrite an earlier rollback copy');
  const old = await json(join(previousDirectory, 'daily-build.json'));
  const cfg = await json(join(installation, 'resources/runtime-components.json'));
  const plan = [[installation, join(target, 'WeftMate')]];
  for (const [name, hash] of Object.entries(cfg.components)) {
    assert.ok(/^[a-f0-9]{64}$/.test(hash) && ['dsh-runtime', 'memory-runtime'].includes(name));
    const rel = join(name === 'dsh-runtime' ? 'dsh' : 'memory', hash.slice(0, 16));
    plan.push([join(installation + '.components', rel), join(target, 'WeftMate.components', rel)]);
  }
  const rollback = { previous: old.version, components: cfg.components, checkedFiles: 0, root: target };
  async function verifyDirectory(src, dst) {
    const [a, b] = await Promise.all([readdir(src), readdir(dst)]);
    assert.deepEqual(a.sort(), b.sort(), 'rollback file set');
    for (let i = 0; i < a.length; i += 8) await Promise.all(a.slice(i, i + 8).map(async name => {
      const p = join(src, name), q = join(dst, name), s = await lstat(p), t = await lstat(q);
      if (s.isSymbolicLink()) { assert.ok(t.isSymbolicLink()); assert.equal(await readlink(p), await readlink(q)); }
      else if (s.isDirectory()) { assert.ok(t.isDirectory()); await verifyDirectory(p, q); }
      else {
        assert.ok(s.isFile() && t.isFile()); assert.equal(s.size, t.size);
        assert.equal(await shaFile(p), await shaFile(q)); rollback.checkedFiles++;
      }
    }));
  }
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  for (const [src, dst] of plan) {
    const result = spawnSync('robocopy', [src, dst, '/E', '/SL', '/SJ', '/MT:12', '/R:1', '/W:1',
      '/NFL', '/NDL', '/NP', '/NJH', '/NJS'], { windowsHide: true, encoding: 'utf8' });
    assert.ok(result.status !== null && result.status < 8, 'rollback copy ' + result.status);
    await verifyDirectory(src, dst);
    if (src !== installation && await exists(src + '.complete')) {
      await copyFile(src + '.complete', dst + '.complete');
      assert.equal(await shaFile(src + '.complete'), await shaFile(dst + '.complete'));
      rollback.checkedFiles++;
    }
  }
  rollback.appHash = await shaFile(archive);
  const installer = join(target, 'WeftMate-Setup-' + old.version + '.exe');
  await copyFile(old.installer, installer);
  assert.equal(await shaFile(installer), old.sha256);
  rollback.installer = installer; rollback.sha256 = old.sha256;
  await writeFile(join(output, 'rollback-verified.json'), JSON.stringify(rollback, null, 2));
  return rollback;
}

async function identity() {
  const state = await store(), accounts = Object.values(state.accounts);
  const ids = accounts.flatMap(account => Object.keys(account.sessions)).sort();
  return { accounts: accounts.length, ownersHash: sha(JSON.stringify(Object.keys(state.accounts).sort())),
    sessions: ids.length, sessionsHash: sha(JSON.stringify(ids)),
    modelsHash: sha(JSON.stringify(accounts.map(account => account.accountModels ?? {}))),
    models: accounts.reduce((sum, account) => sum + Object.keys(account.accountModels ?? {}).length, 0),
    configHash: sha(await readFile(configFile)) };
}

async function isIdle() {
  const state = await json(hostFile);
  assert.equal(resolve(state.dataDirs.userData), root);
  if (pids().length) {
    try {
      const response = await fetch(state.runtime.origin + '/weftmate/api/v1/sessions', { signal: AbortSignal.timeout(5000) });
      if (!response.ok || (await response.json()).items.some(session => session.running)) return false;
    } catch { return false; }
  }
  const commands = Object.values((await store()).accounts).flatMap(account => Object.values(account.commands));
  return !commands.some(command => ['pending', 'dispatching', 'preflight'].includes(command.state));
}

let quitRequested = false, installationAttempted = false, rollback;
try {
  await stage('copying-rollback');
  await makeRollback();
  rollback = await json(join(output, 'rollback-verified.json'));
  await stage('rollback-verified');
  const build = await json(join(output, 'daily-build.json'));
  report.sourceCommit = build.sourceCommit;
  assert.equal(build.version, version);
  const smoke = await json(join(output, 'packaged-smoke.json'));
  assert.ok(smoke.passed && smoke.app.version === version);
  assert.equal(rollback.previous, previous); assert.ok(rollback.checkedFiles > 0);
  assert.equal(appVersion(), previous);
  assert.equal(await shaFile(archive), rollback.appHash);
  assert.equal(await shaFile(build.installer), build.sha256);
  await stage('checked-installer-and-rollback');
  const idleDeadline = Date.now() + 30 * 60 * 1000;
  await until(isIdle, 'daily work remains active', idleDeadline - Date.now());
  await pause(1200);
  await until(isIdle, 'daily work remains active', idleDeadline - Date.now());
  report.priorRun = (await json(join(root, 'logs/current-run.json'))).runId;
  if (pids().length) {
    quitRequested = true;
    const result = spawnSync(exe, ['--quit', '--desktop-config=' + configFile], { env, windowsHide: true, timeout: 40000 });
    report.quitExitCode = result.status;
    await until(() => !pids().length, 'daily window did not exit normally', 40000);
  }
  await stage('old-daily-exited-normally');
  report.before = await identity();
  await copyFile(configFile, join(rollback.root, 'desktop-config.json'));
  const backupDirectory = join(dirname(root), 'Backups');
  const backup = await snapshot({ root, directory: backupDirectory, reason: 'before-daily-update' });
  report.backupPath = join(backupDirectory, backup.id);
  const checked = await verify(report.backupPath);
  report.backupVerifiedFiles = checked.files.length;
  report.originalData = await retained(root);
  report.originalLengths = {};
  for (const row of checked.files) if (row.path.startsWith('dsh-home/sessions/')) {
    const id = sha(relative('dsh-home/sessions', row.path));
    if (Object.hasOwn(report.originalData.native, id)) {
      assert.equal(row.sha256, report.originalData.native[id]);
      report.originalLengths[id] = row.size;
    }
  }
  assert.equal(Object.keys(report.originalLengths).length, Object.keys(report.originalData.native).length);
  await stage('data-backup-verified');
  assert.equal(pids().length, 0, 'daily window was reopened during backup');
  installationAttempted = true;
  const install = spawnSync(build.installer, ['/S', '/currentuser', '--updated', '/D=' + resolve(installation)],
    { env, windowsHide: true, timeout: 600000 });
  assert.equal(install.status, 0, install.error?.message || 'installer failed');
  assert.equal(appVersion(), version);
  report.appArchiveHash = await shaFile(archive);
  assert.equal(report.appArchiveHash, await shaFile(join(dirname(build.installer), 'win-unpacked/resources/app.asar')));
  await stage('installer-verified');
  start();
  report.host = await until(async () => {
    try {
      const host = await json(hostFile), run = await json(join(root, 'logs/current-run.json'));
      if (host.app.version !== version || run.runId === report.priorRun ||
          host.runtime.state !== 'listening' || host.personalAccess.state !== 'listening') return false;
      const response = await fetch(host.runtime.origin + '/weftmate/api/v1/sessions', { signal: AbortSignal.timeout(5000) });
      return response.status === 200 && { version: host.app.version, runId: run.runId, runtimeStatus: response.status };
    } catch { return false; }
  }, 'updated daily window did not become ready', 180000);
  report.after = await identity();
  assert.deepEqual(report.after, report.before);
  report.retained = await verifyRetained(root, report.originalData, report.originalLengths);
  const ui = await json(join(root, 'updates/ui/current.json'));
  assert.equal(ui.builtInVersion, version); assert.ok(!ui.active);
  report.ready = true;
  await stage('daily-window-and-data-verified');
} catch (error) {
  report.error = error.stack; process.exitCode = 1; console.error(error.message);
} finally {
  try {
    if (!report.ready && (quitRequested || installationAttempted) && !pids().length) {
      try {
        if (installationAttempted && await shaFile(rollback.installer) === rollback.sha256) {
          const prior = spawnSync(rollback.installer, ['/S', '/currentuser', '--updated', '/D=' + resolve(installation)],
            { env, windowsHide: true, timeout: 600000 });
          report.rollbackRestored = prior.status === 0 && appVersion() === previous;
        }
      } catch (error) {
        report.rollbackError = error.stack;
      } finally {
        start();
      }
    }
  } finally {
    await save();
  }
}
