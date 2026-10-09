import { cp, readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyPhysicalTree, removePhysicalTree } from './physical-copy.mjs';
const run = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function moveDirectory(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 10) throw error;
      await pause(100 * (attempt + 1));
    }
  }
}
const root = process.argv[2];
const json = file => readFile(join(root, file), 'utf8').then(JSON.parse).catch(() => null);
async function save(name, value) { const file = join(root, name), temp = file + '.tmp'; await writeFile(temp, JSON.stringify(value)); await rename(temp, file); }
const state = await json('pending.json');
if (!state || !isAbsolute(root) || !isAbsolute(state.installation) || state.snapshot !== join(root, state.snapshot.split(/[\\/]/).at(-1))) process.exit(2);
await save('monitor-ready.json', { token: state.token, pid: process.pid });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
// Installation must start only after the previous host has completed shutdown.
while (alive(state.oldPid)) {
  if ((await json('pending.json'))?.token !== state.token) process.exit(0);
  await pause(200);
}
let installResult = 1;
const replacedProgram = `${state.installation}.previous-${state.token}`;
let movedProgram = false;
try {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(state.installer)) hash.update(chunk);
  if (hash.digest('hex') !== state.installerSha256) throw new Error('installer integrity changed');
  // NSIS may fail to rename individual files even after Electron exits. Move
  // the closed tree as a unit; keep it beside the new installation until healthy.
  await moveDirectory(state.installation, replacedProgram); movedProgram = true;
  await mkdir(state.installation);
  await save('monitor-state.json', { phase: 'installing', token: state.token });
  const installerEnv = { ...process.env,
    PSModulePath: join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') };
  delete installerEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(state.installer, ['--updated', '/S', '/currentuser', `/D=${state.installation}`], { windowsHide: true, stdio: 'ignore', env: installerEnv });
  installResult = await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(1); }, 600000);
    child.once('error', () => { clearTimeout(timer); resolve(1); });
    child.once('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
} catch { /* Restore the old installation on launch or integrity failure. */ }
const psEnv = { ...process.env, WEFTMATE_RECOVERY_EXE: state.executable, WEFTMATE_RECOVERY_INSTALLER: state.installer || '',
  PSModulePath: join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') };
async function relevantProcesses() {
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$targets=@($env:WEFTMATE_RECOVERY_EXE,$env:WEFTMATE_RECOVERY_INSTALLER); @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -in $targets } | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress'],
    { windowsHide: true, env: psEnv });
  const value = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return Array.isArray(value) ? value : [value];
}
// Separate installer extraction from startup health: a cold install can take minutes.
const installDeadline = Date.now() + state.timeoutMs;
let newAppPid = null;
if (installResult === 0) {
  try {
    const metadata = JSON.parse(await readFile(join(state.installation, 'resources/app.asar/package.json'), 'utf8'));
    if (metadata.version !== state.nextVersion) throw new Error('installed version mismatch');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(state.executable, [`--desktop-config=${state.configFile}`], { cwd: state.snapshot, detached: true, windowsHide: true, stdio: 'ignore', env });
    newAppPid = child.pid;
    child.on('error', () => {}); child.unref();
    await save('monitor-state.json', { phase: 'checking-startup', token: state.token });
  } catch { installResult = 1; }
}
while (installResult === 0 && Date.now() < installDeadline) {
  const healthy = await json('healthy.json');
  if (healthy?.token === state.token && healthy.version === state.nextVersion) {
    await save('last-result.json', { phase: 'healthy', version: state.nextVersion, previousVersion: state.oldVersion });
    await rm(join(root, 'pending.json'), { force: true });
    if (movedProgram) await removePhysicalTree(replacedProgram).catch(() => {});
    process.exit(0);
  }
  await pause(1000);
}
let recoveryStep = 'stop-new-process';
try {
  // Native failures may occur before main can write its PID. Select only this exact executable.
  if (newAppPid && alive(newAppPid)) await run('taskkill.exe', ['/pid', String(newAppPid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  for (const row of await relevantProcesses()) await run('taskkill.exe', ['/pid', String(row.ProcessId), '/T', '/F'], { windowsHide: true }).catch(() => {});
  await pause(500);
  const failedProgram = `${state.installation}.failed-${state.token}`;
  recoveryStep = 'move-failed-program';
  let movedFailedProgram = false;
  try { await moveDirectory(state.installation, failedProgram); movedFailedProgram = true; }
  catch (error) {
    // An open directory handle can outlive the stopped process. The signed
    // previous ASAR and complete runtime can still be restored in that directory.
    if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
  }
  recoveryStep = 'restore-program';
  await copyPhysicalTree(join(state.snapshot, 'program'), state.installation, ['WeftMateRecovery.exe']);
  if (state.cacheDirectory) {
    recoveryStep = 'restore-cache';
    await copyPhysicalTree(join(state.snapshot, 'cache'), state.cacheDirectory);
  }
  if (state.uninstallRegistry) {
    recoveryStep = 'restore-system-version';
    const rows = Array.isArray(state.uninstallRegistry) ? state.uninstallRegistry : [state.uninstallRegistry];
    for (const row of rows) if (row.key?.startsWith('HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'))
      await run('reg.exe', ['add', row.key, '/v', 'DisplayVersion', '/t', 'REG_SZ', '/d', state.oldVersion, '/f'], { windowsHide: true });
  }
  const rejected = (await json('rejected.json')) || [];
  await save('rejected.json', [...new Set([...rejected, state.nextVersion])]);
  await save('last-result.json', { phase: 'rolled-back', version: state.oldVersion, rejectedVersion: state.nextVersion });
  await rm(join(root, 'pending.json'), { force: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(state.executable, [`--desktop-config=${state.configFile}`, '--start-in-tray'], { detached: true, windowsHide: true, stdio: 'ignore', env });
  child.unref();
  if (movedFailedProgram) await removePhysicalTree(failedProgram).catch(() => {});
  if (movedProgram) await removePhysicalTree(replacedProgram).catch(() => {});
} catch (error) {
  await save('last-result.json', { phase: 'recovery-failed', version: state.oldVersion, rejectedVersion: state.nextVersion,
    step: recoveryStep, code: error.code || 'RECOVERY_ERROR' });
  process.exitCode = 1;
}
