import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { report, retention, previousRun } from './report.mjs';
import { androidBusyReason, nightlyPackage } from './android-packages.mjs';
const scripts = fileURLToPath(new URL('.', import.meta.url));
const value = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const repository = resolve(value('--repository', join(scripts, '../..')));
const worktree = resolve(value('--worktree', 'D:/AIProjects/WeftMate/Worktrees/nightly'));
const reports = resolve(value('--reports', 'D:/AIProjects/WeftMate/Runtime/Nightly'));
const orchestrator = resolve(value('--orchestrator', 'D:/AIProjects/WeftMate/Runtime/Orchestrator'));
const mac = value('--mac', 'mac'), minutes = Number(value('--minutes', 90)), threshold = Number(value('--threshold', 0.08));
const context = JSON.parse(await readFile(value('--nightly-engine'), 'utf8'));
const { startedAt, deadline, runId, out, date, bootstrapCommit } = context;
const gallery = join(out, 'gallery'), phases = [], children = new Set(), locks = [];
const cleanup = { windows: null, android: null, apple: null };
let sourceCommit = context.sourceCommit, temp, cancelled = false;
const engineScripts = scripts, reporting = { report, retention, previousRun };
if (resolve(context.worktree) !== resolve(join(scripts, '../..'))) throw Error('Engine must run from the tested worktree');
await mkdir(gallery, { recursive: true });
await mkdir(join(out, 'logs'), { recursive: true });
console.log(`Nightly ${runId}; reports: ${out}`);
process.on('SIGINT', () => { cancelled = true; for (const child of children) child.kill(); });
process.on('SIGTERM', () => { cancelled = true; for (const child of children) child.kill(); });

async function run(command, args, { cwd = worktree, env = {}, name = 'command', limit = deadline - Date.now(), allowFailure = false } = {}) {
  if ((cancelled || Date.now() >= deadline) && !allowFailure) throw Error('整晚总时长超时或已停止');
  const logPath = join(out, 'logs', name + '.log'), log = await open(logPath, 'a'); let output = '', timedOut = false;
  const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, ...env, WEFTMATE_TEST_HOST_NAME: 'synthetic-host' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const completion = new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
  const consume = bytes => { output += bytes.toString(); void log.write(bytes); };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, Math.max(100, limit));
  try {
    const code = await completion;
    if (!allowFailure && (timedOut || code !== 0)) throw Error(timedOut ? `${name} 超时（整晚截止时间或本命令时限）` : `${name} 运行失败（退出 ${code}；见 logs/${name}.log）`);
    return { output, code: timedOut ? -1 : code, timedOut };
  } finally { clearTimeout(timer); children.delete(child); await log.close(); }
}
async function phase(name, platforms, action) {
  const began = Date.now(), item = { name, platforms, status: 'passed' }; phases.push(item);
  console.log(`Start ${name}`);
  try {
    if (cancelled || Date.now() >= deadline) return Object.assign(item, { status:'not-run', reason:'整晚截止时间已到或已停止，未执行', seconds:0 }).status === 'passed';
    const result = await action(); if (result) Object.assign(item, result); }
  catch (error) { item.status = 'failed'; item.reason = error.message.replace(/[A-Z]:[\\/][^\s"']+/gi, '[local artifact]'); }
  item.seconds = (Date.now() - began) / 1000;
  console.log(`${name}: ${item.status} (${item.seconds.toFixed(1)}s)${item.reason ? ' · ' + item.reason : ''}`);
  return item.status === 'passed';
}
async function isLocked(name) { try { await readFile(join(orchestrator, name)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function takeLock(name) {
  const path = join(orchestrator, name);
  try { const h = await open(path, 'wx'); await h.writeFile(JSON.stringify({ package: 'NIGHT-2', runId, startedAt })); await h.close(); locks.push(path); return true; }
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
    const vendorRunner = await import(pathToFileURL(join(engineScripts, 'vendor-tests.mjs')).href);
    await phase('vendor-tests', [], () => vendorRunner.runVendorTests(run, worktree, out));
    await phase('installed-smoke', [], async () => {
      const execution = await run('node', [join(worktree,'scripts/nightly/installed-smoke.mjs'),'--out',join(out,'installed-smoke')], {name:'installed-smoke', allowFailure:true});
      const result = JSON.parse(await readFile(join(out,'installed-smoke/results.json'),'utf8'));
      return { status: execution.code === 0 && result.passed ? 'passed' : 'failed', checks: result.checks,
        reason: result.passed ? '' : '安装版冒烟失败，见 installed-smoke/results.json' };
    });
    const sceneArgs = value('--scene') ? ['--scene', value('--scene')] : [];
    await phase('windows', ['windows'], () => process.argv.includes('--devices-only') ? skip('设备专项，未拍') : run('node', [join(worktree, 'tests/integration/review-capture-desktop.mjs'), '--out', gallery, ...sceneArgs], { name: 'windows' }).then(() => null));
    await phase('mobile-web', ['mobile-web'], () => process.argv.includes('--devices-only') ? skip('设备专项，未拍') : run('node', [join(worktree, 'tests/integration/review-capture-mobile.mjs'), '--out', gallery, ...sceneArgs], { name: 'mobile-web' }).then(() => null));
    await phase('apple', ['mac', 'iphone', 'watch'], async () => {
      if (process.argv.includes('--skip-apple')) return skip('主动跳过，未拍');
      if (await isLocked('lan.lock')) return skip('被占用，未拍（LAN 锁）');
      const check = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', mac, '! pgrep -f "codex -m" >/dev/null && ! pgrep -x xcodebuild >/dev/null && test ! -d ~/.weftmate-orchestrator/nightly.lock && test -z "$(xcrun simctl list devices booted | grep Booted)"'], { name: 'apple-idle', allowFailure: true, limit: 20000 });
      if (check.code !== 0) return skip('被占用，未拍（A16 未完成、模拟器已启动或 Mac 不可达）');
      const bundle = join(temp, 'candidate.bundle');
      if (process.argv.includes('--candidate')) await run('git', ['bundle', 'create', bundle, 'HEAD'], { cwd: repository, name: 'candidate-bundle' });
      const remoteRoot = `.weftmate-orchestrator/nightly-${runId}`;
      await run('ssh', ['-o', 'BatchMode=yes', mac, `mkdir -p ~/${remoteRoot}`], { name: 'apple-directory' });
      await run('scp', [join(engineScripts, 'apple.py'), `${mac}:${remoteRoot}/apple.py`], { name: 'apple-script' });
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
      const alreadyRunning = info.is_process_started || info.is_android_started;
      const assess = async () => {
        await run(adb, ['connect','127.0.0.1:7555'], {name:'adb-connect'});
        const packages = (await run(adb,['-s','127.0.0.1:7555','shell','pm','list','packages','weftmate'],{name:'android-packages'})).output;
        const processes = (await run(adb,['-s','127.0.0.1:7555','shell','ps','-A','-o','NAME'],{name:'android-processes'})).output;
        const instrumentation = (await run(adb,['-s','127.0.0.1:7555','shell','dumpsys','activity'],{name:'android-instrumentation'})).output;
        const host = await run('pwsh',['-NoProfile','-Command', `[bool]@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -notin @($PID,${process.pid},${context.bootstrapPid}) -and $_.CommandLine -match 'review-capture-mobile[^\r\n]*--android|weftmateApplicationId|NightlyWebViewProbeTest|adb[^\r\n]*\bam\s+instrument|weftmate[^\r\n]*android[^\r\n]*(?:test|probe)' }).Count`], {name:'android-host-occupancy'});
        const reason = androidBusyReason(packages,processes,instrumentation,host.output.trim() === 'True' ? ['review-capture-mobile --android'] : []);
        cleanup.android = { ...cleanup.android, reusedEmulator:!!alreadyRunning, occupancyChecked:true, occupancyReason:reason || 'MuMu 锁已持有；设备无 WeftMate / UI 测试进程和活动仪器测试；Windows 无安卓测试命令' };
        return reason;
      };
      if (alreadyRunning) { const reason = await assess(); if (reason) return skip('被占用，未拍（'+reason+'）'); }
      await run('pwsh', ['-NoProfile', '-File', join(engineScripts, 'build-android.ps1'), '-Worktree', worktree], { name: 'android-build' });
      if (!alreadyRunning) {
        const beforeLaunch = JSON.parse((await run(cli, ['info', '--vmindex', '0'], { name: 'mumu-recheck' })).output);
        if (beforeLaunch.is_process_started || beforeLaunch.is_android_started) return skip('被占用，未拍（构建期间他人启动 MuMu）');
        await run(cli, ['control', '--vmindex', '0', 'launch'], { name: 'mumu-launch' }); ownsMuMu = true;
      }
      for (let i = 0; i < 90; i++) {
        if (Date.now() >= deadline || cancelled) throw Error('整晚总时长超时或已停止');
        await run(adb, ['connect', '127.0.0.1:7555'], { name: 'adb-connect', allowFailure: true, limit: 5000 });
        const ready = await run(adb, ['-s', '127.0.0.1:7555', 'shell', 'getprop', 'sys.boot_completed'], { name: 'android-boot', allowFailure: true, limit: 5000 });
        if (ready.output.trim() === '1') break;
        if (i === 89) throw Error('MuMu 启动超时');
        await new Promise(done => setTimeout(done, 1000));
      }
      const occupied = await assess(); if (occupied) return skip('被占用，未拍（'+occupied+'）');
      await run('node', [join(worktree, 'tests/integration/review-capture-mobile.mjs'), '--android', '--out', gallery, '--state', join(out, 'android-state.json'), ...sceneArgs], { name: 'android' });
      cleanup.android = { ...cleanup.android, ...JSON.parse(await readFile(join(out, 'android-cleanup.json'), 'utf8')) };
    });
  }
} catch (error) { phases.push({ name: 'controller', status: 'failed', reason: error.message }); }
finally {
  const cleanupStarted = Date.now();
  for (const child of children) child.kill();
  if (temp) {
    try {
      cleanup.windows = JSON.parse((await run('pwsh', ['-NoProfile', '-File', join(scripts, 'cleanup.ps1'), '-Since', startedAt, '-RootsJson', join(out, 'cleanup-roots.json'), '-OwnerPid', String(process.pid), '-BootstrapPid', String(context.bootstrapPid)], { cwd: repository, name: 'cleanup', allowFailure: true, limit: 15000 })).output);
    } catch (error) { cleanup.windows = { error: error.message };  }
  }
  {
    try { cleanup.android = { ...cleanup.android, ...JSON.parse(await readFile(join(out,'android-cleanup.json'),'utf8')) }; } catch {}
    // Handles an interrupted Android runner as well as its normal finally block.
    try {
      const state = JSON.parse(await readFile(join(out, 'android-state.json'), 'utf8'));
      for (const mapping of state.reverse || []) await run(adb, ['-s', '127.0.0.1:7555', 'reverse', '--remove', `tcp:${mapping}`], { name: 'android-clean-reverse', allowFailure: true, limit: 5000 });
      for (const mapping of state.forward || []) await run(adb, ['-s', '127.0.0.1:7555', 'forward', '--remove', `tcp:${mapping}`], { name: 'android-clean-forward', allowFailure: true, limit: 5000 });
      for (const pkg of state.installed || []) { if (![nightlyPackage,nightlyPackage+'.test'].includes(pkg)) throw Error('拒绝清理非本轮夜间包'); const removed = await run(adb, ['-s', '127.0.0.1:7555', 'uninstall', pkg], { name: 'android-clean-uninstall', allowFailure: true, limit: 10000 }); if (removed.code !== 0 || !removed.output.includes('Success')) throw Error('夜间包卸载未确认'); cleanup.android = { ...cleanup.android, uninstalled:[...(cleanup.android?.uninstalled || []),pkg] }; }
      if (state.installed?.length) cleanup.android.packageRemoved = !(await run(adb, ['-s','127.0.0.1:7555','shell','pm','list','packages',nightlyPackage], {name:'android-clean-confirm',allowFailure:true,limit:10000})).output.includes(nightlyPackage);
    } catch (error) { if (error.code !== 'ENOENT') cleanup.android = {...cleanup.android, error:error.message}; }
    if (ownsMuMu) {
    await run(cli, ['control', '--vmindex', '0', 'shutdown'], { name: 'mumu-shutdown', allowFailure: true, limit: 15000 }).catch(() => {});
    let info;
    for (let attempt = 0; attempt < 15; attempt++) {
      const after = await run(cli, ['info', '--vmindex', '0'], { name: 'mumu-cleanup-info', allowFailure: true, limit: 5000 }).catch(() => null);
      try { info = JSON.parse(after?.output); } catch {}
      if (info && !info.is_process_started && !info.is_android_started) break;
      await new Promise(done => setTimeout(done, 1000));
    }
    cleanup.android = { ...cleanup.android, ownedEmulatorShutdown: !!info && !info.is_process_started && !info.is_android_started };
    if (!cleanup.android.ownedEmulatorShutdown) phases.push({ name: 'android-cleanup', status: 'failed', reason: 'MuMu 关闭未得到确认' });
  }
  }
  if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
  // Owner-approved housekeeping: prune synthetic test temp directories older than 48 hours.
  try {
    const pruned = await run('pwsh', ['-NoProfile', '-File', join(engineScripts, 'prune-temp.ps1'), '-Hours', '48', '-Repository', repository, '-Apply'], { cwd: repository, name: 'prune-temp', allowFailure: true, limit: 600000 });
    cleanup.staleTemp = JSON.parse(pruned.output.trim().split(/\r?\n/).pop());
  } catch (error) { cleanup.staleTemp = { error: error.message }; }
  phases.push({ name: 'cleanup', status: cleanup.windows?.error || cleanup.staleTemp?.error || cleanup.staleTemp?.failed || cleanup.android?.error || cleanup.android?.packageRemoved === false || cleanup.android?.reverseRemoved === false || cleanup.android?.forwardRemoved === false || cleanup.apple?.bootedOwnedRemaining?.length ? 'failed' : 'passed', reason: cleanup.windows?.error || cleanup.staleTemp?.error || cleanup.android?.error || '', seconds: (Date.now()-cleanupStarted)/1000 });
  try {
    const baseline = await reporting.previousRun(reports, gallery);
    const result = await reporting.report(out, { ...baseline, threshold, phases, bootstrapCommit, commit: sourceCommit || 'unknown', startedAt, cleanup });
    await run('node', [join(engineScripts, '../review-gallery/build.mjs'), '--out', gallery, '--fresh-only', '--outcomes', join(out, 'outcomes.json')], { cwd: repository, name: 'gallery', allowFailure: true, limit: 30000 });
    await writeFile(join(reports, date, 'nightly-report.md'), (await readFile(join(out, 'nightly-report.md'), 'utf8')).replace('(gallery/index.html)', `(${runId}/gallery/index.html)`));
    await writeFile(join(reports, date, 'latest.json'), JSON.stringify({ runId, gallery: `${runId}/gallery/index.html`, report: `${runId}/nightly-report.md` }) + '\n');
    if (result.alerts.length) {
      let electron = join(worktree, 'node_modules/electron/dist/electron.exe');
      try { await readFile(join(worktree, 'node_modules/electron/path.txt')); }
      catch { electron = join(repository, 'node_modules/electron/dist/electron.exe'); }
      await run(electron, [join(engineScripts, 'notify.mjs'), join(out, 'nightly-status.json'), join(out, 'notification-profile'), join(out, 'notification.json')], { cwd: repository, name: 'notification', allowFailure: true, limit: 10000 }).catch(() => {});
      let notification;
      try { notification = JSON.parse(await readFile(join(out, 'notification.json'), 'utf8')); } catch {}
      if (!notification?.supported) await run('pwsh', ['-NoProfile', '-File', join(engineScripts, 'notify.ps1'), '-StatusPath', join(out, 'nightly-status.json'), '-ReceiptPath', join(out, 'notification.json')], { cwd: repository, name: 'notification-fallback', allowFailure: true, limit: 10000 });
    }
    await reporting.retention(reports);
    process.exitCode = result.alerts.length ? 1 : 0;
    console.log(`Report: ${join(out, 'nightly-report.md')} (${result.alerts.length} alerts)`);
  } catch (error) {
    await writeFile(join(out, 'nightly-report.md'), `# WeftMate 夜间回归失败\n\n报告生成失败：${error.message}\n提交：${sourceCommit}\n`);
    process.exitCode = 1; console.error(error.message);
  }
  for (const path of locks.reverse()) await rm(path, { force: true });
}
