/** The monitor runs from a copy of the trusted old program, outside the install tree. */
import { app } from 'electron';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { atomicJson } from './store.mjs';
import { copyPhysicalTree, removePhysicalTree, copyPhysicalFile } from './physical-copy.mjs';
import packageInfo from '../../package.json' with { type: 'json' };
const controlAppData = () => packageInfo.desktopIdentity ? join(app.getPath('appData'), packageInfo.desktopIdentity) : app.getPath('appData');

export const rollbackRoot = appData => join(appData, 'WeftMate', 'app-recovery');
export async function prepareAppRollback({ configFile, nextVersion, appData = app.getPath('appData'),
  timeoutMs = 180000, cacheDirectory, installer, installerSha256 }) {
  if (!app.isPackaged || process.platform !== 'win32') throw new Error('APP_RECOVERY_REQUIRES_WINDOWS_PACKAGE');
  const root = rollbackRoot(appData), snapshot = join(root, randomUUID());
  await mkdir(snapshot, { recursive: true });
  const installation = dirname(process.execPath);
  try {
    await copyPhysicalTree(installation, join(snapshot, 'program'));
    if (cacheDirectory) await copyPhysicalTree(cacheDirectory, join(snapshot, 'cache'));
    await writeFile(join(snapshot, 'monitor.mjs'), await readFile(new URL('./app-watchdog.mjs', import.meta.url)));
    await writeFile(join(snapshot, 'physical-copy.mjs'), await readFile(new URL('./physical-copy.mjs', import.meta.url)));
    const recoveryExe = join(snapshot, 'program', 'WeftMateRecovery.exe');
    await copyPhysicalFile(process.execPath, recoveryExe);
    const registryResult = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$target=$env:WEFTMATE_RECOVERY_EXE; Get-ChildItem HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall | Where-Object { $value=$_.GetValue('UninstallString'); $value -and $value -match '^\"([^\"]+)\"' -and [IO.Path]::GetDirectoryName($matches[1]) -eq [IO.Path]::GetDirectoryName($target) } | ForEach-Object { @{key=$_.Name;version=$_.GetValue('DisplayVersion')} } | ConvertTo-Json -Compress"],
    { windowsHide: true, env: { ...process.env, WEFTMATE_RECOVERY_EXE: process.execPath } });
    const uninstallRegistry = registryResult.stdout.trim() ? JSON.parse(registryResult.stdout) : null;
    const state = { schemaVersion: 1, token: randomUUID(), oldVersion: app.getVersion(), nextVersion, installer, installerSha256, uninstallRegistry,
      installation, executable: process.execPath, configFile, snapshot, cacheDirectory, oldPid: process.pid,
      timeoutMs, phase: 'installing', createdAt: new Date().toISOString() };
    await atomicJson(join(root, 'pending.json'), state);
    const child = spawn(recoveryExe, [join(snapshot, 'monitor.mjs'), root], {
      detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    // Acknowledgement proves the helper can run independently before exiting this app.
    for (let i = 0; i < 100; i++) {
      const ack = await readFile(join(root, 'monitor-ready.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (ack?.token === state.token) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('APP_RECOVERY_MONITOR_NOT_READY');
  } catch (error) {
    await rm(join(root, 'pending.json'), { force: true });
    await new Promise(resolve => setTimeout(resolve, 300));
    await removePhysicalTree(snapshot).catch(() => {});
    throw error;
  }
}
export async function appBootSignal(phase, appData = controlAppData()) {
  if (!app.isPackaged) return;
  const root = rollbackRoot(appData);
  const pending = await readFile(join(root, 'pending.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (!pending || pending.nextVersion !== app.getVersion() || pending.executable.toLowerCase() !== process.execPath.toLowerCase()) return;
  await atomicJson(join(root, `${phase}.json`), { token: pending.token, version: app.getVersion(), pid: process.pid });
}
export async function rejectedAppVersion(version, appData = controlAppData()) {
  const value = await readFile(join(rollbackRoot(appData), 'rejected.json'), 'utf8').then(JSON.parse).catch(() => []);
  return value.includes(version);
}
export async function cancelAppRollback(appData = controlAppData()) {
  await rm(join(rollbackRoot(appData), 'pending.json'), { force: true });
}
