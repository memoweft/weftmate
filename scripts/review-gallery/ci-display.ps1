# Only the disposable GitHub runner's display is changed; never the developer desktop.
# https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-enumdisplaysettingsw
# https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-changedisplaysettingsw
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This display setup is only for GitHub Actions runners.' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ReviewDisplay {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Mode {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string deviceName;
        public ushort specVersion, driverVersion, size, driverExtra;
        public uint fields;
        public int positionX, positionY;
        public uint orientation, fixedOutput;
        public short color, duplex, yResolution, ttOption, collate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string formName;
        public ushort logPixels;
        public uint bitsPerPel, width, height, displayFlags, frequency;
        public uint icmMethod, icmIntent, mediaType, ditherType, reserved1, reserved2, panningWidth, panningHeight;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplaySettings(string device, int index, ref Mode mode);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int ChangeDisplaySettings(ref Mode mode, uint flags);
    static Mode Empty() { return new Mode { size = (ushort)Marshal.SizeOf(typeof(Mode)) }; }
    public static string Ensure() {
        Mode current = Empty();
        if (!EnumDisplaySettings(null, -1, ref current)) throw new Exception("Cannot read runner display mode.");
        if (current.width >= 1280 && current.height >= 900) return "Runner display already fits: " + current.width + "x" + current.height;
        Mode chosen = Empty(); bool found = false;
        for (int index = 0; ; index++) {
            Mode candidate = Empty();
            if (!EnumDisplaySettings(null, index, ref candidate)) break;
            if (candidate.width < 1280 || candidate.height < 900 || candidate.bitsPerPel < 24) continue;
            if (!found || (long)candidate.width * candidate.height < (long)chosen.width * chosen.height) { chosen = candidate; found = true; }
        }
        if (!found) throw new Exception("Runner has no display mode that fits a 1200x800 Electron window.");
        int result = ChangeDisplaySettings(ref chosen, 0);
        if (result != 0) throw new Exception("Runner display change failed: " + result);
        current = Empty();
        if (!EnumDisplaySettings(null, -1, ref current) || current.width < 1280 || current.height < 900) throw new Exception("Runner display did not reach the requested size.");
        return "Runner display prepared: " + current.width + "x" + current.height;
    }
}
'@
[ReviewDisplay]::Ensure()
