param([long]$WindowHandle, [int]$ExpectedProcessId, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EmptyChatWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
}
'@
$handle = [IntPtr]::new($WindowHandle)
# PrintWindow renders physical pixels; request matching bounds on scaled displays.
$previousDpi = [EmptyChatWindowCapture]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
if ($previousDpi -eq [IntPtr]::Zero) { throw 'Cannot establish physical-pixel window capture' }
[uint32]$actualProcessId = 0
$null = [EmptyChatWindowCapture]::GetWindowThreadProcessId($handle, [ref]$actualProcessId)
if ($actualProcessId -ne $ExpectedProcessId) { throw "Owned window process mismatch: expected $ExpectedProcessId, actual $actualProcessId" }
if (-not [EmptyChatWindowCapture]::IsWindowVisible($handle)) { throw 'The test window is not visible' }
$rect = [EmptyChatWindowCapture+Rect]::new()
if (-not [EmptyChatWindowCapture]::GetWindowRect($handle, [ref]$rect)) { throw 'Cannot read the owned window bounds' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 200 -or $height -lt 200 -or $width -gt 8192 -or $height -gt 8192) { throw 'Unexpected owned window dimensions' }
$bitmap = [Drawing.Bitmap]::new($width, $height)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
  $dc = $graphics.GetHdc()
  try { if (-not [EmptyChatWindowCapture]::PrintWindow($handle, $dc, 2)) { throw 'Owned window capture failed' } }
  finally { $graphics.ReleaseHdc($dc) }
  $bitmap.Save($OutputPath, [Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
$title = [Text.StringBuilder]::new(256)
$null = [EmptyChatWindowCapture]::GetWindowText($handle, $title, 256)
@{ processId=$actualProcessId; visible=$true; title=$title.ToString(); width=$width; height=$height; capture='PrintWindow of verified application HWND' } | ConvertTo-Json -Compress
