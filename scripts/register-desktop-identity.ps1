<#
.SYNOPSIS
Registers the per-user WeftMate development shortcut; requires no administrator.
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-desktop-identity.ps1
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-desktop-identity.ps1 -Undo
.NOTES
ProgramsDirectory allows offline validation in a temporary directory. Such a
shortcut is not registered with Windows notifications until installed in Start Menu.
Existing shortcuts are backed up once and restored by -Undo.
Microsoft: https://learn.microsoft.com/windows/win32/shell/enable-desktop-toast-with-appusermodelid
#>
[CmdletBinding()]
param(
    [switch]$Undo,
    [string]$Repository = '',
    [string]$ProgramsDirectory = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
)
$ErrorActionPreference = 'Stop'
if (-not $Repository) { $Repository = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
$Repository = [IO.Path]::GetFullPath($Repository)
$ProgramsDirectory = [IO.Path]::GetFullPath($ProgramsDirectory)
$shortcutPath = Join-Path $ProgramsDirectory 'WeftMate.lnk'
$backupPath = Join-Path $ProgramsDirectory 'WeftMate.lnk.weftmate-identity-backup'
$markerPath = Join-Path $ProgramsDirectory 'WeftMate.lnk.weftmate-identity-installed'
if ($Undo) {
    if (Test-Path -LiteralPath $backupPath) { Move-Item -LiteralPath $backupPath -Destination $shortcutPath -Force }
    elseif (Test-Path -LiteralPath $markerPath) { Remove-Item -LiteralPath $shortcutPath -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $markerPath -ErrorAction SilentlyContinue
    Write-Output 'WeftMate development shortcut registration undone.'
    return
}
$electronPath = Join-Path $Repository 'node_modules\electron\dist\electron.exe'
$iconPath = Join-Path $Repository 'build\icon.ico'
foreach ($requiredPath in @($electronPath, $iconPath, (Join-Path $Repository 'package.json'))) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Missing development asset: $requiredPath" }
}
if (-not ('WeftMateShortcutProperty' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WeftMateShortcutProperty {
    [StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid Format; public uint Id; }
    [StructLayout(LayoutKind.Explicit, Size=24)] public struct PropVariant {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Pointer;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
    static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr context, uint flags, ref Guid iid, out IPropertyStore store);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
    public static string SetAndRead(string path, string appId) {
        var iid = typeof(IPropertyStore).GUID;
        IPropertyStore store;
        SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2, ref iid, out store);
        var key = new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 };
        var value = new PropVariant { Type = 31, Pointer = Marshal.StringToCoTaskMemUni(appId) };
        try {
            store.SetValue(ref key, ref value); store.Commit();
            PropVariant actual; store.GetValue(ref key, out actual);
            try { return Marshal.PtrToStringUni(actual.Pointer); }
            finally { PropVariantClear(ref actual); }
        } finally { PropVariantClear(ref value); Marshal.FinalReleaseComObject(store); }
    }
}
'@
}
New-Item -ItemType Directory -Path $ProgramsDirectory -Force | Out-Null
if ((Test-Path -LiteralPath $shortcutPath) -and -not (Test-Path -LiteralPath $markerPath) -and -not (Test-Path -LiteralPath $backupPath)) {
    Copy-Item -LiteralPath $shortcutPath -Destination $backupPath
}
$shell = New-Object -ComObject WScript.Shell
try {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $electronPath
    $shortcut.Arguments = '"' + $Repository + '"'
    $shortcut.WorkingDirectory = $Repository
    $shortcut.IconLocation = $iconPath + ',0'
    $shortcut.Description = 'WeftMate'
    $shortcut.Save()
} finally { if ($shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
$appId = [WeftMateShortcutProperty]::SetAndRead($shortcutPath, 'com.memoweft.weftmate')
if ($appId -ne 'com.memoweft.weftmate') { throw 'Shortcut AppUserModelID verification failed.' }
Set-Content -LiteralPath $markerPath -Value 'WeftMate development identity v1' -Encoding UTF8
Write-Output "WeftMate shortcut registered: $shortcutPath"
Write-Output "AppUserModelID: $appId"
