import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { screen } from 'electron';
import { physicalDesktopBounds } from './desktop-window-bounds.mjs';
import { createWindowsBoundsBridge } from './windows-bounds-bridge.mjs';

// Electron 43's frameless Windows setter rounds the resize frame in DIP before
// Windows scales it, while its getter encloses the physical HWND before removing
// that frame. At fractional scale these operations are not inverses. Restore the
// physical rectangle whose conversion is exactly the saved DIP rectangle.
// This is a pure inverse calculation; the HWND is positioned only once.
const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WeftWindowBounds {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@
$v = [Console]::In.ReadLine() | ConvertFrom-Json
$window = [IntPtr]::new([long]$v.handle)
[uint32]$owner = 0
[void][WeftWindowBounds]::GetWindowThreadProcessId($window, [ref]$owner)
if ($owner -ne $v.pid) { throw 'Window owner changed' }
$previous = [WeftWindowBounds]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
try {
  $rect = New-Object WeftWindowBounds+Rect
  if (-not [WeftWindowBounds]::GetWindowRect($window, [ref]$rect)) { throw 'Window bounds unavailable' }
  [Console]::WriteLine((@{x=$rect.Left;y=$rect.Top;width=($rect.Right-$rect.Left);height=($rect.Bottom-$rect.Top)} | ConvertTo-Json -Compress))
  $target = [Console]::In.ReadLine() | ConvertFrom-Json
  if ($null -eq $target) { throw 'Window restore cancelled' }
  [void][WeftWindowBounds]::GetWindowThreadProcessId($window, [ref]$owner)
  if ($owner -ne $v.pid) { throw 'Window owner changed' }
  if (-not [WeftWindowBounds]::SetWindowPos($window, [IntPtr]::Zero, $target.x, $target.y, $target.width, $target.height, 0x14)) { throw 'Window restore failed' }
} finally { [void][WeftWindowBounds]::SetThreadDpiAwarenessContext($previous) }
`;


export function createWindowsDesktopBoundsRestore(win, target, display) {
  const handle = win.getNativeWindowHandle();
  const input = { handle: (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(), pid: process.pid };
  return createWindowsBoundsBridge({ input,
    start: complete => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, maxBuffer: 8192 }, complete),
    convert: raw => physicalDesktopBounds(raw, win.getBounds(), target, display.scaleFactor,
      rect => screen.screenToDipRect(win, rect), rect => screen.dipToScreenRect(win, rect)),
    verify: () => !win.isDestroyed() && Object.entries(target).every(([key, value]) => win.getNormalBounds()[key] === value),
    terminate: child => new Promise(resolve => {
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return resolve();
      // Kill the owned bridge's entire tree (PowerShell can invoke a compiler).
      execFile(join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 1000 }, error => { if (error && child.exitCode === null) child.kill('SIGKILL'); resolve(); });
    }),
  });
}

export function restoreWindowsDesktopBounds(win, target, display) {
  return createWindowsDesktopBoundsRestore(win, target, display).ready;
}
