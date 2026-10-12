param([int]$TargetProcessId)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ErrorWindows {
 delegate bool Callback(IntPtr h,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback,IntPtr data);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder value,int size);
 public static int Count(int pid){int count=0;EnumWindows((h,data)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid){var name=new StringBuilder(80);GetClassName(h,name,80);if(name.ToString()=="#32770")count++;}return true;},IntPtr.Zero);return count;}
}
'@
[ErrorWindows]::Count($TargetProcessId)
