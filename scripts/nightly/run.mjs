import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, open, rm, copyFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { report, retention, previousRun } from './report.mjs';
const scripts = fileURLToPath(new URL('.', import.meta.url));
const value = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const repository = resolve(value('--repository', join(scripts, '../..')));
const worktree = resolve(value('--worktree', 'D:/AIProjects/WeftMate/Worktrees/nightly'));
const reports = resolve(value('--reports', 'D:/AIProjects/WeftMate/Runtime/Nightly'));
const orchestrator = resolve(value('--orchestrator', 'D:/AIProjects/WeftMate/Runtime/Orchestrator'));
const mac = value('--mac', 'mac'), minutes = Number(value('--minutes', 90)), threshold = Number(value('--threshold', 0.08));
const startedAt = new Date().toISOString(), deadline = Date.now() + minutes * 60_000;
const now = new Date(), date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const runId = startedAt.replace(/[-:.]/g, '') + '-' + randomUUID().slice(0, 8);
const out = join(reports, date, runId), gallery = join(out, 'gallery'), phases = [], children = new Set(), locks = [];
const cleanup = { windows: null, android: null, apple: null };
let sourceCommit = '', temp, cancelled = false;
if (!(minutes > 0 && minutes <= 240 && threshold >= 0 && threshold <= 1)) throw Error('Invalid deadline/difference threshold');
if (resolve(repository) === worktree || !/[\\/]nightly$/.test(worktree)) throw Error('Use a dedicated worktree named nightly');
await mkdir(reports, { recursive: true });
try { const handle = await open(join(reports, 'nightly.lock'), 'wx'); await handle.writeFile(JSON.stringify({ runId, startedAt, pid: process.pid })); await handle.close(); locks.push(join(reports, 'nightly.lock')); }
catch { console.error('Nightly is already running (nightly.lock); no resources taken.'); process.exit(2); }
await mkdir(gallery, { recursive: true });
await mkdir(join(out, 'logs'));
console.log(`Nightly ${runId}; reports: ${out}`);
process.on('SIGINT', () => { cancelled = true; for (const child of children) child.kill(); });
process.on('SIGTERM', () => { cancelled = true; for (const child of children) child.kill(); });

async function run(command, args, { cwd = worktree, env = {}, name = 'command', limit = deadline - Date.now(), allowFailure = false } = {}) {
  if ((cancelled || Date.now() >= deadline) && !allowFailure) throw Error('整晚总时长超时或已停止');
  const logPath = join(out, 'logs', name + '.log'), log = await open(logPath, 'a'); let output = '', timedOut = false;
  const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const completion = new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
  const consume = bytes => { output += bytes.toString(); void log.write(bytes); };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, Math.max(100, limit));
  try {
    const code = await completion;
    if (timedOut || (code !== 0 && !allowFailure)) throw Error(timedOut ? '整晚总时长超时' : `${name} 运行失败（退出 ${code}；见 logs/${name}.log）`);
    return { output, code };
  } finally { clearTimeout(timer); children.delete(child); await log.close(); }
}
async function phase(name, platforms, action) {
  const began = Date.now(), item = { name, platforms, status: 'passed' }; phases.push(item);
  console.log(`Start ${name}`);
  try { const result = await action(); if (result) Object.assign(item, result); }
  catch (error) { item.status = 'failed'; item.reason = error.message; }
  item.seconds = (Date.now() - began) / 1000;
  console.log(`${name}: ${item.status} (${item.seconds.toFixed(1)}s)${item.reason ? ' · ' + item.reason : ''}`);
  return item.status === 'passed';
}
async function isLocked(name) { try { await readFile(join(orchestrator, name)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function takeLock(name) {
  const path = join(orchestrator, name);
  try { const h = await open(path, 'wx'); await h.writeFile(JSON.stringify({ package: 'R0-3', runId, startedAt })); await h.close(); locks.push(path); return true; }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}
const skip = reason => ({ status: 'skipped', reason });
const adb = 'D:/Software/MuMuPlayer/nx_main/adb.exe', cli = 'D:/Software/MuMuPlayer/nx_main/mumu-cli.exe';
let ownsMuMu = false;
try {
  temp = await mkdtemp('C:/weftmate-nightly-');
  await writeFile(join(out, 'cleanup-roots.json'), JSON.stringify([temp, worktree]));
  // Do not inherit real model, cloud, personal-host or relay configuration.
  for (const name of Object.keys(process.env)) if (/^(WEFTMATE_|MEMOWEFT_|MIMO_|MODEL_SWITCH_|CLOUD_|ELECTRON_RUN_AS_NODE)/.test(name)) delete process.env[name];
  process.env.TEMP = temp; process.env.TMP = temp;
  const prepared = await phase('prepare', [], async () => {
    await run('git', ['fetch', 'origin', 'main'], { cwd: repository, name: 'fetch' });
    sourceCommit = execFileSync('git', ['rev-parse', process.argv.includes('--candidate') ? 'HEAD' : 'origin/main'], { cwd: repository, encoding: 'utf8' }).trim();
    try { await readFile(join(worktree, '.git')); }
    catch { await run('git', ['worktree', 'add', '--detach', worktree, sourceCommit], { cwd: repository, name: 'worktree-create' }); }
    const dirty = (await run('git', ['status', '--porcelain'], { name: 'worktree-status' })).output.trim();
    if (dirty) throw Error('专用回归工作树存在未提交修改，保留并退出');
    await run('git', ['checkout', '--detach', sourceCommit], { name: 'checkout' });
    // npm ci only if the exact lockfile changed. Local dependencies are not shared
    // with developer trees and never point to another package's node_modules.
    const lock = await readFile(join(worktree, 'package-lock.json'), 'utf8');
    let installed; try { installed = await readFile(join(worktree, '.local/nightly-lock.json'), 'utf8'); } catch {}
    if (installed !== lock) {
      await run('pwsh', ['-NoProfile', '-Command', 'npm ci'], { name: 'npm-ci' });
      await mkdir(join(worktree, '.local'), { recursive: true }); await writeFile(join(worktree, '.local/nightly-lock.json'), lock);
    }
    await run('node', [join(worktree, 'node_modules/electron/install.js')], { name: 'electron-install' });
    await run('node', [join(worktree, 'node_modules/playwright/cli.js'), 'install', 'chromium'], { name: 'chromium-install' });
    const signingKey = join(temp, 'synthetic-signing.pem');
    await writeFile(signingKey, generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }));
    await run('node', [join(worktree, 'scripts/build-mobile-ui.mjs'), '--output-dir', join(temp, 'mobile-release')], { name: 'build-mobile', env: { WEFTMATE_UPDATE_PRIVATE_KEY_PATH: signingKey } });
    await run('node', [join(worktree, 'node_modules/typescript/bin/tsc')], { name: 'typecheck' });
  });
  if (prepared) {
    await phase('windows', ['windows'], () => run('node', [join(worktree, 'tests/integration/review-capture-desktop.mjs'), '--out', gallery], { name: 'windows' }).then(() => null));
    await phase('mobile-web', ['mobile-web'], () => run('node', [join(worktree, 'tests/integration/review-capture-mobile.mjs'), '--out', gallery], { name: 'mobile-web' }).then(() => null));
    await phase('apple', ['mac', 'iphone', 'watch'], async () => {
      if (process.argv.includes('--skip-apple')) return skip('主动跳过，未拍');
      if (await isLocked('lan.lock')) return skip('被占用，未拍（LAN 锁）');
      const check = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', mac, 'test -f ~/.weftmate-orchestrator/a16.done && test ! -d ~/.weftmate-orchestrator/nightly.lock && test -z "$(xcrun simctl list devices booted | grep Booted)"'], { name: 'apple-idle', allowFailure: true, limit: 20000 });
      if (check.code !== 0) return skip('被占用，未拍（A16 未完成、模拟器已启动或 Mac 不可达）');
      const bundle = join(temp, 'candidate.bundle');
      if (process.argv.includes('--candidate')) await run('git', ['bundle', 'create', bundle, 'HEAD'], { cwd: repository, name: 'candidate-bundle' });
      const remoteRoot = `.weftmate-orchestrator/nightly-${runId}`;
      await run('ssh', ['-o', 'BatchMode=yes', mac, `mkdir -p ~/${remoteRoot}`], { name: 'apple-directory' });
      await run('scp', [join(scripts, 'apple.py'), `${mac}:${remoteRoot}/apple.py`], { name: 'apple-script' });
      if (process.argv.includes('--candidate')) await run('scp', [bundle, `${mac}:${remoteRoot}/candidate.bundle`], { name: 'apple-bundle' });
      await run('ssh', ['-o', 'BatchMode=yes', mac, `python3 ~/${remoteRoot}/apple.py --run-id ${runId} --commit ${sourceCommit} --seconds ${Math.max(30, Math.floor((deadline - Date.now()) / 1000) - 30)}${process.argv.includes('--candidate') ? ' --candidate' : ''}`], { name: 'apple' });
      await run('scp', ['-r', `${mac}:${remoteRoot}/gallery/.`, gallery], { name: 'apple-evidence' });
      cleanup.apple = JSON.parse((await run('ssh', ['-o', 'BatchMode=yes', mac, `cat ~/${remoteRoot}/cleanup.json`], { name: 'apple-cleanup-read' })).output);
      const status = JSON.parse((await run('ssh', ['-o', 'BatchMode=yes', mac, `cat ~/${remoteRoot}/status.json`], { name: 'apple-status' })).output);
      return status;
    });
    await phase('android', ['android'], async () => {
      if (process.argv.includes('--skip-android')) return skip('主动跳过，未拍');
      if (await isLocked('lan.lock') || !await takeLock('mumu.lock')) return skip('被占用，未拍（LAN / MuMu 锁）');
      const info = JSON.parse((await run(cli, ['info', '--vmindex', '0'], { name: 'mumu-info' })).output);
      if (info.is_process_started || info.is_android_started) {
        await run(adb, ['connect', '127.0.0.1:7555'], { name: 'adb-connect', allowFailure: true });
        const packages = await run(adb, ['-s', '127.0.0.1:7555', 'shell', 'pm', 'list', 'packages', 'weftmate'], { name: 'mumu-packages', allowFailure: true });
        return skip(`被占用，未拍（已有启动的 MuMu${packages.output.includes('weftmate') ? ' / WeftMate 测试包' : ''}；不关闭他人的模拟器）`);
      }
      await run('pwsh', ['-NoProfile', '-File', join(scripts, 'build-android.ps1'), '-Worktree', worktree], { name: 'android-build' });
      await run(cli, ['control', '--vmindex', '0', 'launch'], { name: 'mumu-launch' }); ownsMuMu = true;
      for (let i = 0; i < 90; i++) {
        await run(adb, ['connect', '127.0.0.1:7555'], { name: 'adb-connect', allowFailure: true, limit: 5000 });
        const ready = await run(adb, ['-s', '127.0.0.1:7555', 'shell', 'getprop', 'sys.boot_completed'], { name: 'android-boot', allowFailure: true, limit: 5000 });
        if (ready.output.trim() === '1') break;
        if (i === 89) throw Error('MuMu 启动超时');
        await new Promise(done => setTimeout(done, 1000));
      }
      const packages = (await run(adb, ['-s', '127.0.0.1:7555', 'shell', 'pm', 'list', 'packages', 'weftmate'], { name: 'android-packages' })).output;
      if (packages.includes('weftmate')) return skip('被占用，未拍（已有 WeftMate 测试包）');
      await run('node', [join(worktree, 'tests/integration/review-capture-mobile.mjs'), '--android', '--out', gallery, '--state', join(out, 'android-state.json')], { name: 'android' });
      cleanup.android = JSON.parse(await readFile(join(out, 'android-cleanup.json'), 'utf8'));
    });
  }
} catch (error) { phases.push({ name: 'controller', status: 'failed', reason: error.message }); }
finally {
  for (const child of children) child.kill();
  if (temp) {
    try {
      cleanup.windows = JSON.parse((await run('pwsh', ['-NoProfile', '-File', join(scripts, 'cleanup.ps1'), '-Since', startedAt, '-RootsJson', join(out, 'cleanup-roots.json')], { cwd: repository, name: 'cleanup', allowFailure: true, limit: 15000 })).output);
    } catch (error) { cleanup.windows = { error: error.message }; phases.push({ name: 'cleanup', status: 'failed', reason: 'Windows 清理失败' }); }
  }
  if (ownsMuMu) {
    // Handles an interrupted Android runner as well as its normal finally block.
    try {
      const state = JSON.parse(await readFile(join(out, 'android-state.json'), 'utf8'));
      for (const mapping of state.reverse || []) await run(adb, ['-s', '127.0.0.1:7555', 'reverse', '--remove', `tcp:${mapping}`], { name: 'android-clean-reverse', allowFailure: true, limit: 5000 });
      for (const mapping of state.forward || []) await run(adb, ['-s', '127.0.0.1:7555', 'forward', '--remove', `tcp:${mapping}`], { name: 'android-clean-forward', allowFailure: true, limit: 5000 });
      for (const pkg of state.installed || []) await run(adb, ['-s', '127.0.0.1:7555', 'uninstall', pkg], { name: 'android-clean-uninstall', allowFailure: true, limit: 10000 });
    } catch {}
    await run(cli, ['control', '--vmindex', '0', 'shutdown'], { name: 'mumu-shutdown', allowFailure: true, limit: 15000 }).catch(() => {});
    cleanup.android = { ...cleanup.android, ownedEmulatorShutdown: true };
  }
  if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
  const baseline = await previousRun(reports, gallery);
  try {
    const result = await report(out, { ...baseline, threshold, phases, commit: sourceCommit || 'unknown', startedAt, cleanup });
    await run('node', [join(repository, 'scripts/review-gallery/build.mjs'), '--out', gallery, '--fresh-only', '--outcomes', join(out, 'outcomes.json')], { cwd: repository, name: 'gallery', allowFailure: true, limit: 30000 });
    await writeFile(join(reports, date, 'nightly-report.md'), (await readFile(join(out, 'nightly-report.md'), 'utf8')).replace('(gallery/index.html)', `(${runId}/gallery/index.html)`));
    await writeFile(join(reports, date, 'latest.json'), JSON.stringify({ runId, gallery: `${runId}/gallery/index.html`, report: `${runId}/nightly-report.md` }) + '\n');
    if (result.alerts.length) {
      let electron = join(worktree, 'node_modules/electron/dist/electron.exe');
      try { await readFile(join(worktree, 'node_modules/electron/path.txt')); }
      catch { electron = join(repository, 'node_modules/electron/dist/electron.exe'); }
      await run(electron, [join(scripts, 'notify.mjs'), join(out, 'nightly-status.json'), join(out, 'notification-profile'), join(out, 'notification.json')], { cwd: repository, name: 'notification', allowFailure: true, limit: 10000 }).catch(() => {});
    }
    await retention(reports);
    process.exitCode = result.alerts.length ? 1 : 0;
    console.log(`Report: ${join(out, 'nightly-report.md')} (${result.alerts.length} alerts)`);
  } catch (error) {
    await writeFile(join(out, 'nightly-report.md'), `# WeftMate 夜间回归失败\n\n报告生成失败：${error.message}\n提交：${sourceCommit}\n`);
    process.exitCode = 1; console.error(error.message);
  }
  for (const path of locks.reverse()) await rm(path, { force: true });
}
