import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

const APP_ID = 'notepad';
const OBSERVATION_ATTEMPTS = 16;
const OBSERVATION_INTERVAL_MS = 200;

function unavailable() {
  const error = new Error('desktop action unavailable');
  error.code = 'CAPABILITY_UNAVAILABLE';
  return error;
}

function isNotepadWindow(window, systemRoot, programFilesRoot) {
  // get-windows' Win32 enumerator filters invisible/cloaked top-level windows.
  // A minimized window can still enumerate with an off-screen placement.
  const bounds = window?.bounds;
  const ownerPath = typeof window?.owner?.path === 'string'
    ? path.win32.normalize(window.owner.path).toLowerCase() : '';
  const systemNotepad = path.win32.join(systemRoot, 'System32', 'notepad.exe').toLowerCase();
  const storeRoot = path.win32.join(programFilesRoot, 'WindowsApps').toLowerCase();
  const trustedOwner = ownerPath === systemNotepad ||
    (ownerPath.startsWith(`${storeRoot}\\microsoft.windowsnotepad_`) && ownerPath.endsWith('\\notepad.exe'));
  return window?.platform === 'windows' && typeof window.owner?.path === 'string' &&
    trustedOwner &&
    Number.isSafeInteger(window.id) && window.id > 0 &&
    Number.isFinite(bounds?.x) && Number.isFinite(bounds?.y) &&
    Number.isFinite(bounds?.width) && Number.isFinite(bounds?.height) &&
    bounds.x > -10_000 && bounds.y > -10_000 && bounds.width >= 100 && bounds.height >= 50;
}

/** Only opens the Windows Notepad binary; caller text never becomes a path or argument. */
export function createPersonalDesktopTask({
  platform = process.platform,
  systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
  programFilesRoot = process.env.ProgramFiles ?? path.win32.join(path.win32.parse(systemRoot).root, 'Program Files'),
  listWindows = async () => (await import('get-windows')).openWindows(),
  spawnProcess = spawn,
  checkExecutable = (file) => access(file),
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const executable = path.win32.join(systemRoot, 'System32', 'notepad.exe');
  async function preflight(appId) {
    if (appId !== APP_ID || platform !== 'win32' || !path.win32.isAbsolute(systemRoot)) throw unavailable();
    try {
      await checkExecutable(executable);
      const windows = await listWindows();
      if (!Array.isArray(windows)) throw unavailable();
    } catch { throw unavailable(); }
  }

  async function open({ appId }) {
    await preflight(appId);
    const before = (await listWindows()).filter((window) => isNotepadWindow(window, systemRoot, programFilesRoot));
    if (before.length) return { accepted: true, observed: true, outcome: 'already_open' };
    const child = spawnProcess(executable, [], {
      shell: false, detached: true, stdio: 'ignore', windowsHide: false,
    });
    try {
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref?.();
    } catch { throw unavailable(); }
    for (let attempt = 0; attempt < OBSERVATION_ATTEMPTS; attempt++) {
      try {
        if ((await listWindows()).some((window) => isNotepadWindow(window, systemRoot, programFilesRoot))) {
          return { accepted: true, observed: true, outcome: 'opened' };
        }
      } catch { /* An observation failure cannot be reported as completion. */ }
      if (attempt + 1 < OBSERVATION_ATTEMPTS) await pause(OBSERVATION_INTERVAL_MS);
    }
    return { accepted: true, observed: false };
  }

  return { appIds: [APP_ID], preflight, open };
}
