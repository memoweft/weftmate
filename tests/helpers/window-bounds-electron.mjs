import { app } from 'electron';
import { createPersonalDesktop, restoreDesktopBounds } from '../../src/personal-desktop.mjs';
import { restoreWindowsDesktopBounds } from '../../src/windows-desktop-bounds.mjs';

app.setPath('userData', process.env.WINDOW_BOUNDS_PROFILE);
app.whenReady().then(() => {
  let quitting = true;
  globalThis.windowBoundsDesktop = createPersonalDesktop({
    origin: process.env.WINDOW_BOUNDS_ORIGIN, libraryDesktopToken: process.env.WINDOW_BOUNDS_TOKEN,
    isQuitting: () => quitting, startInTray: process.env.WINDOW_BOUNDS_TRAY === 'true',
  });
  globalThis.restoreDesktopBounds = restoreDesktopBounds;
  globalThis.restoreWindowsDesktopBounds = restoreWindowsDesktopBounds;
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
});
