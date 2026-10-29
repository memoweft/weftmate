import { join } from 'node:path';
import { boundedCommand } from './personal-update/watchdog-commands.mjs';

// The same brief input-queue attachment used by the Windows desktop adapter.
// Only the ready, explicitly updated window calls this; no input is generated.
const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WeftUpdatedWindow {
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr window; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; public uint privateData; }
  [DllImport("user32.dll")] static extern bool PeekMessage(out Message message, IntPtr window, uint first, uint last, uint remove);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  public static bool Activate(IntPtr window, uint expectedPid) {
    uint owner;
    GetWindowThreadProcessId(window, out owner);
    if (owner != expectedPid || !IsWindowVisible(window)) return false;
    if (GetForegroundWindow() == window) return true;
    // AttachThreadInput requires a message queue on the short-lived helper.
    Message message; PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
    uint ours = GetCurrentThreadId();
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out owner);
    bool attached = foreground != 0 && foreground != ours && AttachThreadInput(ours, foreground, true);
    try {
      GetWindowThreadProcessId(window, out owner);
      if (owner != expectedPid || !IsWindowVisible(window)) return false;
      BringWindowToTop(window);
      SetForegroundWindow(window);
      return GetForegroundWindow() == window;
    } finally { if (attached) AttachThreadInput(ours, foreground, false); }
  }
}
'@
$request = $env:WEFTMATE_UPDATED_WINDOW | ConvertFrom-Json
[Console]::Out.Write([WeftUpdatedWindow]::Activate([IntPtr]::new([long]$request.handle), [uint32]$request.pid).ToString())
`;

export async function activateWindowsDesktopWindow(window, { execute = boundedCommand } = {}) {
  const handle = window.getNativeWindowHandle();
  const request = { handle: handle.readBigUInt64LE().toString(), pid: process.pid };
  const result = await execute(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeoutMs: 5000, maxBuffer: 8192, env: { ...process.env, WEFTMATE_UPDATED_WINDOW: JSON.stringify(request) } });
  return result.stdout.trim() === 'True';
}
