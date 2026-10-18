import { appendFileSync } from 'node:fs';

export const startupPhases = new Set(['module-entry', 'main-imports-ready', 'app-ready',
  'desktop-config-start', 'desktop-config-ready', 'single-instance-start', 'single-instance-acquired',
  'single-instance-denied', 'bootstrap', 'profile-private-ready', 'backup-ready',
  'config-import-start', 'config-import-ready', 'credential-storage-start', 'credential-storage-ready',
  'cloud-vault-ready', 'config-ready', 'memory-config-start', 'memory-config-ready',
  'runtime-start', 'runtime-spawn-requested', 'runtime-spawned', 'runtime-ready',
  'personal-access-start', 'personal-access-ready', 'window-prepare', 'window-create',
  'window-created', 'window-ready-to-show', 'window-dom-ready', 'window-load-finished', 'host-ready']);

/** Opt-in harness trace. No user data or host marker; a unique file per launch.
 * Every operation is best effort, including injected clocks/sinks and listeners. */
export function createStartupObservation({ file, write = appendFileSync, now = Date.now,
  elapsed = () => Math.round(process.uptime() * 1000), pid = process.pid } = {}) {
  return phase => {
    try {
      if (file && startupPhases.has(phase)) write(file, JSON.stringify({ phase, at: now(), elapsedMs: elapsed(), pid }) + '\n');
    } catch { /* Observation cannot change startup. */ }
  };
}

export const observeStartup = createStartupObservation({ file: process.env.WEFTMATE_FIRST_WINDOW_TRACE });

export function observeStartupEvents(app, record = observeStartup) {
  const mark = phase => { try { Promise.resolve(record(phase)).catch(() => {}); } catch {} };
  try {
    mark('module-entry');
    if (app.isReady()) mark('app-ready');
    else app.once('ready', () => mark('app-ready'));
    let first = true;
    app.on('browser-window-created', (_event, window) => {
      try {
        if (!first) return;
        first = false;
        mark('window-created');
        window.once('ready-to-show', () => mark('window-ready-to-show'));
        window.webContents.once('dom-ready', () => mark('window-dom-ready'));
        window.webContents.once('did-finish-load', () => mark('window-load-finished'));
      } catch { /* Optional listeners must not escape EventEmitter.emit. */ }
    });
  } catch { /* No effect on the caller's return value or exception. */ }
}
