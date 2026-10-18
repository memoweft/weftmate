import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { report, retention, previousRun } from './report.mjs';
import { androidBusyReason, androidHostUsesDevice, nightlyPackage } from './android-packages.mjs';
import { connectMuMu, assertAndroidDevice, adbExecutable as adb, AndroidEnvironmentError } from './mumu.mjs';
import { managedMkdtemp, disposeManagedTemp, managedTempParent, startManagedTempLease } from '../../tests/helpers/managed-temp.mjs';
import { commandBudget } from './command-budget.mjs';
import { acquireHeavySlot } from './heavy-slot.mjs';
import { redactEvidenceText, systemCommitMemory, describeExit } from '../../tests/helpers/process-evidence.mjs';
const scripts = fileURLToPath(new URL('.', import.meta.url));
const value = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const repository = resolve(value('--repository', join(scripts, '../..')));
if (!value('--worktree') || !value('--reports') || !value('--orchestrator'))
  throw Error('--worktree, --reports and --orchestrator are required');
const worktree = resolve(value('--worktree'));
const reports = resolve(value('--reports'));
const orchestrator = resolve(value('--orchestrator'));
const mac = value('--mac', 'mac'), minutes = Number(value('--minutes', 90)), threshold = Number(value('--threshold', 0.08));
const context = JSON.parse(await readFile(value('--nightly-engine'), 'utf8'));
const { startedAt, deadline, runId, out, date, bootstrapCommit } = context;
const gallery = join(out, 'gallery'), phases = [], children = new Set(), locks = [];
const cleanup = { windows: null, android: null, apple: null };
let sourceCommit = context.sourceCommit, temp, stopLease, tempParent, cancelled = false, phaseDeadline = Infinity, slotDeadline = Infinity, androidSerial;
const selectedPhases = value('--phases')?.split(',');
if (selectedPhases?.some(name => !['prepare','vendor-tests','installed-smoke','windows','mobile-web','android','apple','cleanup'].includes(name))) throw Error('Unknown --phases selection');
const engineScripts = scripts, reporting = { report, retention, previousRun };
if (resolve(context.worktree) !== resolve(join(scripts, '../..'))) throw Error('Engine must run from the tested worktree');
await mkdir(gallery, { recursive: true });
await mkdir(join(out, 'logs'), { recursive: true });
console.log(`Nightly ${runId}; reports: ${out}`);
const cancelPoll = setInterval(() => { void readFile(join(out,'cancel.request')).then(() => { cancelled=true; for (const child of children) child.kill(); }).catch(()=>{}); },500);
cancelPoll.unref();
process.on('SIGINT', () => { cancelled = true; for (const child of children) child.kill(); });
process.on('SIGTERM', () => { cancelled = true; for (const child of children) child.kill(); });

async function run(command, args, { cwd = worktree, env = {}, name = 'command', limit = deadline - Date.now(), allowFailure = false } = {}) {
  if ((cancelled || Date.now() >= deadline) && !allowFailure) throw Error('整晚总时长超时或已停止');
  limit = commandBudget(limit, {allowFailure, phaseDeadline:phaseDeadline-60000, slotDeadline});
  const logPath = join(out, 'logs', name + '.log'), log = await open(logPath, 'a'); let output = '', timedOut = false, writes = Promise.resolve();
  const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, ...env, WEFTMATE_TEST_HOST_NAME: 'synthetic-host' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const completion = new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
  const consume = bytes => { const text = redactEvidenceText(bytes.toString()); output += text; writes = writes.then(() => log.write(text)); };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, Math.max(100, limit));
  try {
    const code = await completion;
    if (code !== 0 || timedOut) {
      let tcp;
      try { tcp = JSON.parse((await import('node:child_process')).execFileSync('pwsh', ['-NoProfile','-Command', '@{total=@(Get-NetTCPConnection -ErrorAction SilentlyContinue).Count} | ConvertTo-Json -Compress'], { encoding:'utf8', windowsHide:true, timeout:10000 })); } catch { tcp = { available:false }; }
      await writeFile(join(out,'logs',name+'-failure.json'), JSON.stringify({name,lastPhase:phases.at(-1)?.name, ...describeExit(code,child.signalCode), timedOut, systemCommit:systemCommitMemory(), tcp},null,2));
    }
    if (!allowFailure && (timedOut || code !== 0)) throw Error(timedOut ? `${name} 超时（整晚截止时间或本命令时限）` : `${name} 运行失败（退出 ${code}；见 logs/${name}.log）`);
    return { output, code: timedOut ? -1 : code, timedOut };
  } finally { clearTimeout(timer); children.delete(child); await writes; await log.close(); }
}
async function phase(name, platforms, action) {
  const began = Date.now(), item = { name, platforms, status: 'passed' }; phases.push(item);
  console.log(`Start ${name}`);
  let slot;
  try {
    if (selectedPhases && !['prepare','cleanup'].includes(name) && !selectedPhases.includes(name)) return Object.assign(item, {status:'skipped',reason:'阶段专项，未执行',seconds:0}).status === 'passed';
    if (cancelled || Date.now() >= deadline) return Object.assign(item, { status:'not-run', reason:'整晚截止时间已到或已停止，未执行', seconds:0 }).status === 'passed';
    const skipped = (name === 'apple' && process.argv.includes('--skip-apple')) || (name === 'android' && process.argv.includes('--skip-android')) || (process.argv.includes('--devices-only') && ['vendor-tests','installed-smoke','windows','mobile-web'].includes(name));
    if (skipped) Object.assign(item, {status:'skipped',reason:'专项或主动跳过，未执行'});
    else {
      slot = await acquireHeavySlot(orchestrator, `nightly ${runId} / ${name}`, {deadline,cancelled:()=>cancelled});
      item.heavySlot = slot.index; item.slotTakenAt = new Date(slot.takenAt).toISOString();
      // A stage must release its slot within 30 minutes, including owned cleanup.
      phaseDeadline = Math.min(deadline, slot.takenAt + 29 * 60000); slotDeadline=slot.takenAt+30*60000;
      const result = await action(); if (result) Object.assign(item, result);
    }
  } catch (error) { item.status = error instanceof AndroidEnvironmentError ? 'environment' : 'failed'; item.reason = redactEvidenceText(error.message).replace(/[A-Z]:[\\/][^\s"']+/gi, '[local artifact]'); }
  finally {
    if (slot && item.status === 'failed' && temp) {
      try { item.processCleanup = JSON.parse((await run('pwsh', ['-NoProfile','-File',join(scripts,'cleanup.ps1'),'-Since',new Date(began).toISOString(),'-RootsJson',join(out,'cleanup-roots.json'),'-OwnerPid',String(process.pid),'-BootstrapPid',String(context.bootstrapPid)],{name:name+'-process-cleanup',allowFailure:true,limit:15000})).output); } catch(error) { item.processCleanup={error:redactEvidenceText(error.message)}; }
    }
    phaseDeadline=Infinity; slotDeadline=Infinity; if (slot) { item.slotSeconds=(Date.now()-slot.takenAt)/1000; await slot.release(); }
  }
  item.seconds = (Date.now() - began) / 1000;
  console.log(`${name}: ${item.status} (${item.seconds.toFixed(1)}s)${item.reason ? ' · ' + item.reason : ''}`);
  return item.status === 'passed';
}
async function isLocked(name) { try { await readFile(join(orchestrator, name)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function takeLock(name) {
  const path = join(orchestrator, name);
  try { const h = await open(path, 'wx'); await h.writeFile(JSON.stringify({ package: 'NIGHT-3a', runId, startedAt })); await h.close(); locks.push(path); return true; }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}
async function cleanupAndroid() {
    try { cleanup.android = { ...cleanup.android, ...JSON.parse(await readFile(join(out,'android-cleanup.json'),'utf8')) }; } catch {}
    // Handles an interrupted Android runner as well as its normal finally block.
    try {
      if (!androidSerial) return;
      const state = JSON.parse(await readFile(join(out, 'android-state.json'), 'utf8'));
      if (state.serial !== androidSerial) throw new AndroidEnvironmentError('安卓清理地址与本轮管理工具地址不符');
      // A successful collector already removed everything and disconnected.
      if (![...(state.reverse || []), ...(state.forward || []), ...(state.installed || [])].length) return;
      await assertAndroidDevice(androidSerial, run);
      for (const mapping of state.reverse || []) await run(adb, ['-s', androidSerial, 'reverse', '--remove', `tcp:${mapping}`], { name: 'android-clean-reverse', allowFailure: true, limit: 5000 });
      for (const mapping of state.forward || []) await run(adb, ['-s', androidSerial, 'forward', '--remove', `tcp:${mapping}`], { name: 'android-clean-forward', allowFailure: true, limit: 5000 });
      for (const pkg of state.installed || []) { if (![nightlyPackage,nightlyPackage+'.test'].includes(pkg)) throw Error('拒绝清理非本轮夜间包'); const removed = await run(adb, ['-s', androidSerial, 'uninstall', pkg], { name: 'android-clean-uninstall', allowFailure: true, limit: 10000 }); if (removed.code !== 0 || !removed.output.includes('Success')) throw Error('夜间包卸载未确认'); cleanup.android = { ...cleanup.android, uninstalled:[...(cleanup.android?.uninstalled || []),pkg] }; }
      if (state.installed?.length) cleanup.android.packageRemoved = !(await run(adb, ['-s',androidSerial,'shell','pm','list','packages',nightlyPackage], {name:'android-clean-confirm',allowFailure:true,limit:10000})).output.includes(nightlyPackage);
    } catch (error) { if (error.code !== 'ENOENT') cleanup.android = {...cleanup.android, error:error.message}; }
}
const skip = reason => ({ status: 'skipped', reason });

try {
  tempParent = managedTempParent();
  // The owner paused nightly reclamation; startup must not bypass the final preview.
  temp = await managedMkdtemp('weftmate-nightly-', {prune:false});
  stopLease = startManagedTempLease(temp);
  await writeFile(join(out, 'cleanup-roots.json'), JSON.stringify([temp, worktree, out]));
  // Do not inherit real model, cloud, personal-host or relay configuration.
  for (const name of Object.keys(process.env)) if (/^(WEFTMATE_|MEMOWEFT_|MIMO_|MODEL_SWITCH_|CLOUD_|ELECTRON_RUN_AS_NODE)/.test(name)) delete process.env[name];
  process.env.TEMP = temp; process.env.TMP = temp; process.env.WEFTMATE_TEST_TEMP_SCOPE = temp;
  process.env.WEFTMATE_MANAGED_TEMP_ROOT = tempParent;
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
        reason: result.buildPassed === false ? `打包校验失败（保留红灯）；隔离程序原生检查完成 ${result.checks.length} 项，见 installed-smoke/results.json` : result.passed ? '' : '安装版冒烟失败，见 installed-smoke/results.json' };
    });
    const sceneArgs = value('--scene') ? ['--scene', value('--scene')] : [];
    await phase('windows', ['windows'], () => process.argv.includes('--devices-only') ? skip('设备专项，未拍') : run('node', [join(worktree, 'tests/integration/review-capture-desktop.mjs'), '--out', gallery, ...sceneArgs], { name: 'windows' }).then(() => null));
    await phase('mobile-web', ['mobile-web'], () => process.argv.includes('--devices-only') ? skip('设备专项，未拍') : run('node', [join(worktree, 'tests/integration/review-capture-mobile.mjs'), '--out', gallery, ...sceneArgs], { name: 'mobile-web' }).then(() => null));
    await phase('android', ['android'], async () => {
      if (await isLocked('lan.lock') || !await takeLock('mumu.lock')) return skip('被占用，未拍（LAN / MuMu 锁）');
      const deviceLock = locks.at(-1);
      try {
        const info = await connectMuMu(run); androidSerial = info.serial;
        const deviceInfo = join(out, 'android-device.json');
        await writeFile(deviceInfo, JSON.stringify(info));
        const assess = async () => {
          await assertAndroidDevice(androidSerial, run);
          const packages = (await run(adb,['-s',androidSerial,'shell','pm','list','packages','weftmate'],{name:'android-packages'})).output;
          const processes = (await run(adb,['-s',androidSerial,'shell','ps','-A','-o','NAME'],{name:'android-processes'})).output;
          const instrumentation = (await run(adb,['-s',androidSerial,'shell','dumpsys','activity'],{name:'android-instrumentation'})).output;
          const hostRows = JSON.parse((await import('node:child_process')).execFileSync('pwsh',['-NoProfile','-Command','ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine) -Compress'],{encoding:'utf8',windowsHide:true,timeout:10000}));
          const hostCommands = hostRows.filter(row => ![process.pid,context.bootstrapPid].includes(row.ProcessId)
            && /(?:^|[\\/])(?:node|java|adb|pwsh|powershell)\.exe$/i.test(row.ExecutablePath || '')
            && androidHostUsesDevice(row.CommandLine || ''));
          await writeFile(join(out,'logs/android-host-occupancy.json'), JSON.stringify(hostCommands.map(row=>({pid:row.ProcessId,executable:row.ExecutablePath.split(/[\\/]/).at(-1)}))));
          const reason = androidBusyReason(packages,processes,instrumentation,hostCommands.map(row=>row.CommandLine));
          cleanup.android = { ...cleanup.android, reusedEmulator:true, androidVersion:info.androidVersion, occupancyChecked:true, occupancyReason:reason || 'MuMu 锁已持有；设备无 WeftMate / UI 测试进程和活动仪器测试；Windows 无安卓测试命令' };
          return reason;
        };
        const busy = await assess(); if (busy) return skip('被占用，未拍（'+busy+'）');
        await run('pwsh', ['-NoProfile', '-File', join(engineScripts, 'build-android.ps1'), '-Worktree', worktree], { name: 'android-build' });
        const occupied = await assess(); if (occupied) return skip('被占用，未拍（'+occupied+'）');
        const captured = await run('node', [join(worktree, 'tests/integration/review-capture-mobile.mjs'), '--android', '--android-device', deviceInfo, '--out', gallery, '--state', join(out, 'android-state.json'), ...sceneArgs], { name: 'android', allowFailure:true });
        if (captured.code !== 0) {
          if (captured.output.includes('环境问题：未拍')) throw new AndroidEnvironmentError('采集器发现设备身份或连接已变化；见 logs/android.log');
          throw Error(`android 运行失败（退出 ${captured.code}；见 logs/android.log）`);
        }
      } finally {
        await cleanupAndroid();
        if (androidSerial) await run(adb,['disconnect',androidSerial],{name:'adb-disconnect',allowFailure:true,limit:5000}).catch(()=>{});
        await rm(deviceLock,{force:true}); locks.splice(locks.indexOf(deviceLock),1);
        androidSerial = undefined;
      }
    });
    await phase('apple', ['mac', 'iphone', 'watch'], async () => {
      if (process.argv.includes('--skip-apple')) return skip('主动跳过，未拍');
      const macWorktree = process.env.WEFTMATE_NIGHTLY_MAC_WORKTREE;
      const macRepository = process.env.WEFTMATE_NIGHTLY_MAC_REPOSITORY;
      if (!macWorktree?.startsWith('/') || !macRepository?.startsWith('/'))
        throw Error('WEFTMATE_NIGHTLY_MAC_WORKTREE and WEFTMATE_NIGHTLY_MAC_REPOSITORY must be explicit absolute paths');
      const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
      if (await isLocked('lan.lock')) return skip('被占用，未拍（LAN 锁）');
      const check = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', mac, '! pgrep -f "codex -m" >/dev/null && ! pgrep -x xcodebuild >/dev/null && test ! -d ~/.weftmate-orchestrator/nightly.lock && test -z "$(xcrun simctl list devices booted | grep Booted)"'], { name: 'apple-idle', allowFailure: true, limit: 20000 });
      if (check.code !== 0) return skip('被占用，未拍（A16 未完成、模拟器已启动或 Mac 不可达）');
      const bundle = join(temp, 'candidate.bundle');
      if (process.argv.includes('--candidate')) await run('git', ['bundle', 'create', bundle, 'HEAD'], { cwd: repository, name: 'candidate-bundle' });
      const remoteRoot = `.weftmate-orchestrator/nightly-${runId}`;
      await run('ssh', ['-o', 'BatchMode=yes', mac, `mkdir -p ~/${remoteRoot}`], { name: 'apple-directory' });
      await run('scp', [join(engineScripts, 'apple.py'), `${mac}:${remoteRoot}/apple.py`], { name: 'apple-script' });
      if (process.argv.includes('--candidate')) await run('scp', [bundle, `${mac}:${remoteRoot}/candidate.bundle`], { name: 'apple-bundle' });
      await run('ssh', ['-o', 'BatchMode=yes', mac, `python3 ~/${remoteRoot}/apple.py --run-id ${runId} --commit ${sourceCommit} --worktree ${quote(macWorktree)} --repository ${quote(macRepository)} --seconds ${Math.max(30, Math.floor((deadline - Date.now()) / 1000) - 30)}${process.argv.includes('--candidate') ? ' --candidate' : ''}`], { name: 'apple' });
      await run('scp', ['-r', `${mac}:${remoteRoot}/gallery/.`, gallery], { name: 'apple-evidence' });
      cleanup.apple = JSON.parse((await run('ssh', ['-o', 'BatchMode=yes', mac, `cat ~/${remoteRoot}/cleanup.json`], { name: 'apple-cleanup-read' })).output);
      const status = JSON.parse((await run('ssh', ['-o', 'BatchMode=yes', mac, `cat ~/${remoteRoot}/status.json`], { name: 'apple-status' })).output);
      return status;
    });
  }
} catch (error) { phases.push({ name: 'controller', status: 'failed', reason: error.message }); }
finally {
  clearInterval(cancelPoll);
  const cleanupStarted = Date.now();
  for (const child of children) child.kill();
  if (temp) {
    try {
      cleanup.windows = JSON.parse((await run('pwsh', ['-NoProfile', '-File', join(scripts, 'cleanup.ps1'), '-Since', startedAt, '-RootsJson', join(out, 'cleanup-roots.json'), '-OwnerPid', String(process.pid), '-BootstrapPid', String(context.bootstrapPid)], { cwd: repository, name: 'cleanup', allowFailure: true, limit: 15000 })).output);
    } catch (error) { cleanup.windows = { error: error.message };  }
  }
  if (temp) {
    stopLease?.();
    // Later PowerShell/Electron processes must not recreate the disposed TEMP scope.
    process.env.TEMP = tempParent; process.env.TMP = tempParent; process.env.TMPDIR = tempParent;
    delete process.env.WEFTMATE_TEST_TEMP_SCOPE;
    try {
      disposeManagedTemp(temp, {log: line => {
        const redacted = redactEvidenceText(line);
        appendFileSync(join(out, 'logs/prune-temp-audit.jsonl'), redacted + '\n'); console.log(redacted);
      }});
      cleanup.temp = {removed:true};
    }
    catch (error) { cleanup.temp = {removed:false,error:redactEvidenceText(error.message)}; }
  }
  // This replaces the prefix-only collector: only registered managed directories with
  // expired leases and dead owner identities are candidates.
  // Deletion stays paused by the owner (2026-10-11): this runs as a preview and reports
  // what it would remove. Add '-Apply' only after the owner agrees to resume cleanup.
  try {
    const pruned = await run('pwsh', ['-NoProfile', '-File', join(engineScripts, 'prune-temp.ps1'), '-Hours', '24', '-Roots', tempParent || managedTempParent(), '-Repository', repository, '-Log', join(out, 'logs/prune-temp-audit.jsonl')], { cwd: repository, name: 'prune-temp', allowFailure: true, limit: 600000 });
    if (pruned.code !== 0) throw Error(`清理器非零退出（${pruned.code}）；见 logs/prune-temp.log`);
    cleanup.staleTemp = JSON.parse(pruned.output.trim().split(/\r?\n/).pop());
  } catch (error) { cleanup.staleTemp = { error: error.message }; }
  phases.push({ name: 'cleanup', status: cleanup.temp?.removed === false || cleanup.windows?.error || cleanup.staleTemp?.error || cleanup.staleTemp?.failed || cleanup.android?.error || cleanup.android?.packageRemoved === false || cleanup.android?.reverseRemoved === false || cleanup.android?.forwardRemoved === false || cleanup.apple?.bootedOwnedRemaining?.length ? 'failed' : 'passed', reason: cleanup.temp?.error || cleanup.windows?.error || cleanup.staleTemp?.error || cleanup.android?.error || '', seconds: (Date.now()-cleanupStarted)/1000 });
  try {
    const baseline = await reporting.previousRun(reports, gallery);
    const result = await reporting.report(out, { ...baseline, threshold, phases, bootstrapCommit, commit: sourceCommit || 'unknown', startedAt, cleanup });
    await run('node', [join(engineScripts, '../review-gallery/build.mjs'), '--out', gallery, '--fresh-only', '--outcomes', join(out, 'outcomes.json')], { cwd: repository, name: 'gallery', allowFailure: true, limit: 30000 });
    await writeFile(join(reports, date, 'nightly-report.md'), (await readFile(join(out, 'nightly-report.md'), 'utf8')).replace('(gallery/index.html)', `(${runId}/gallery/index.html)`));
    await writeFile(join(reports, date, 'latest.json'), JSON.stringify({ runId, gallery: `${runId}/gallery/index.html`, report: `${runId}/nightly-report.md` }) + '\n');
    if (result.alerts.length) {
      const notificationSlot=await acquireHeavySlot(orchestrator,`nightly ${runId} / notification`,{deadline:Date.now()+120000});
      try {
      let electron = join(worktree, 'node_modules/electron/dist/electron.exe');
      try { await readFile(join(worktree, 'node_modules/electron/path.txt')); }
      catch { electron = join(repository, 'node_modules/electron/dist/electron.exe'); }
      await run(electron, [join(engineScripts, 'notify.mjs'), join(out, 'nightly-status.json'), join(out, 'notification-profile'), join(out, 'notification.json')], { cwd: repository, name: 'notification', allowFailure: true, limit: 10000 }).catch(() => {});
      let notification;
      try { notification = JSON.parse(await readFile(join(out, 'notification.json'), 'utf8')); } catch {}
      if (!notification?.supported) await run('pwsh', ['-NoProfile', '-File', join(engineScripts, 'notify.ps1'), '-StatusPath', join(out, 'nightly-status.json'), '-ReceiptPath', join(out, 'notification.json')], { cwd: repository, name: 'notification-fallback', allowFailure: true, limit: 10000 });
      } finally { await notificationSlot.release(); }
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
