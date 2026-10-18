import { app, dialog } from 'electron';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

app.setPath('userData', process.env.WINDOW_BOUNDS_PROFILE);
const fail = error => {
  try { appendFileSync(join(app.getPath('userData'), 'fixture-error.log'), String(error?.stack || error) + '\n'); } catch {}
  app.exit(1);
};
dialog.showErrorBox = (_title, message) => fail(message);
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') fail(error); });
if (process.env.WINDOW_BOUNDS_FAULT === 'hung') {
  const execFile = childProcess.execFile;
  childProcess.execFile = (command, args, options, callback) => {
    if (command !== 'powershell.exe') return execFile(command, args, options, callback);
    // An owned, inert bridge and descendant, each bounded independently too.
    const script = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const {join}=require('node:path');
      const leaf=spawn(process.execPath,['--eval','setTimeout(()=>process.exit(0),30000)'],{windowsHide:true,timeout:30000,stdio:'ignore',env:process.env});
      writeFileSync(join(process.env.WINDOW_BOUNDS_PROFILE,'bridge-pids.json'),JSON.stringify([process.pid,leaf.pid]));setTimeout(()=>process.exit(0),30000);`;
    const child = execFile(process.execPath, ['--eval', script], { ...options,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, callback);
    child.stdin?.on('error', () => {});
    globalThis.windowBoundsBridgePid = child.pid;
    return child;
  };
  syncBuiltinESMExports();
}
app.whenReady().then(async () => {
  const { createPersonalDesktop, restoreDesktopBounds } = await import('../../src/personal-desktop.mjs');
  const { restoreWindowsDesktopBounds } = await import('../../src/windows-desktop-bounds.mjs');
  const createdAt = performance.now();
  let quitting = true;
  globalThis.windowBoundsDesktop = createPersonalDesktop({
    origin: process.env.WINDOW_BOUNDS_ORIGIN, libraryDesktopToken: process.env.WINDOW_BOUNDS_TOKEN,
    isQuitting: () => quitting, startInTray: process.env.WINDOW_BOUNDS_TRAY === 'true',
  });
  globalThis.restoreDesktopBounds = restoreDesktopBounds;
  globalThis.restoreWindowsDesktopBounds = restoreWindowsDesktopBounds;
  globalThis.windowBoundsReady = false;
  globalThis.windowBoundsDesktop.ready.then(() => { globalThis.windowBoundsReady = true; }, () => {});
  if (process.env.WINDOW_BOUNDS_EARLY_SHOW === 'true') {
    globalThis.windowBoundsDesktop.show();
    if (process.env.WINDOW_BOUNDS_EARLY_ACTION === 'settings') globalThis.windowBoundsDesktop.openSettings();
    if (process.env.WINDOW_BOUNDS_EARLY_ACTION === 'send-to') {
      globalThis.windowBoundsDesktop.sendTo([]);
      globalThis.windowBoundsDesktop.show({ sessionId: 'early-first' });
      // Exercise the actual close-to-tray save path before native restoration,
      // then issue another activation. Its constructor size must not be saved.
      quitting = false;
      try { globalThis.windowBoundsDesktop.window.close(); } finally { quitting = true; }
      globalThis.windowBoundsDesktop.show({ sessionId: 'early-last' });
    }
    const win = globalThis.windowBoundsDesktop.window;
    globalThis.windowBoundsEarlyShow = { visible: win.isVisible(), maximized: win.isMaximized() };
  }
  if (process.send) {
    const send = value => { try { process.send(value, () => {}); } catch {} };
    process.on('message', async ({ id, command }) => {
      try {
        const commandStarted = performance.now();
        const desktop = globalThis.windowBoundsDesktop;
        let closed;
        if (command === 'close') {
          closed = false;
          const closing = desktop.close().then(() => { closed = true; });
          await Promise.race([closing, new Promise(resolve => setTimeout(resolve, 750))]);
        } else await Promise.race([desktop.ready, new Promise(resolve => setTimeout(resolve, 3100))]);
        send({ id, value: { closed, ready: globalThis.windowBoundsReady, visible: desktop.window.isVisible(),
          bounds: desktop.window.getBounds(), bridgePid: globalThis.windowBoundsBridgePid,
          commandMs: Math.round(performance.now() - commandStarted), startupMs: Math.round(performance.now() - createdAt) } });
      } catch (error) { send({ id, error: String(error) }); }
    });
    send({ started: true });
  }
}).catch(fail);
