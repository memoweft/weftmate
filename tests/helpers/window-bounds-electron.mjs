import { app } from 'electron';
import { createPersonalDesktop, restoreDesktopBounds } from '../../src/personal-desktop.mjs';
import { restoreWindowsDesktopBounds } from '../../src/windows-desktop-bounds.mjs';

app.setPath('userData', process.env.WINDOW_BOUNDS_PROFILE);
app.whenReady().then(() => {
  globalThis.windowBoundsDesktop = createPersonalDesktop({
    origin: process.env.WINDOW_BOUNDS_ORIGIN, libraryDesktopToken: process.env.WINDOW_BOUNDS_TOKEN,
    isQuitting: () => true, startInTray: process.env.WINDOW_BOUNDS_TRAY === 'true',
  });
  globalThis.restoreDesktopBounds = restoreDesktopBounds;
  globalThis.restoreWindowsDesktopBounds = restoreWindowsDesktopBounds;
});
