param([Parameter(Mandatory=$true)][string]$Executable,[string]$Screenshot)
$ErrorActionPreference='Stop'
$target=[IO.Path]::GetFullPath($Executable)
if([IO.Path]::GetFileName($target)-ne 'WeftMate-upfgqa.exe'){throw 'Only isolated upfgqa windows may be inspected'}
$owned=@(Get-Process -Name 'WeftMate-upfgqa' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $target} | ForEach-Object Id)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Drawing; using System.Drawing.Imaging;
public class UpdateForegroundProbe {
 delegate bool Callback(IntPtr w,IntPtr p);
 [DllImport("user32")] static extern bool EnumWindows(Callback cb,IntPtr p);
 [DllImport("user32")] static extern int GetWindowThreadProcessId(IntPtr w,out int pid);
 [DllImport("user32",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr w,StringBuilder text,int n);
 [DllImport("user32")] static extern bool IsWindowVisible(IntPtr w);
 [DllImport("user32")] static extern bool IsIconic(IntPtr w);
 [DllImport("user32")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32")] static extern bool PrintWindow(IntPtr w,IntPtr dc,uint flags);
 [DllImport("user32")] static extern bool GetWindowRect(IntPtr w,out Rect rect);
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int x,y,right,bottom;}
 public class Row {public int pid; public long handle; public bool visible,minimized,foreground;}
 public static Row[] Read(int[] pids,string screenshot) {
  var rows=new List<Row>(); EnumWindows((w,p)=>{int pid;GetWindowThreadProcessId(w,out pid);if(Array.IndexOf(pids,pid)<0)return true;
   var title=new StringBuilder(256);GetWindowText(w,title,256);if(title.ToString()!="WeftMate")return true;
   var row=new Row{pid=pid,handle=w.ToInt64(),visible=IsWindowVisible(w),minimized=IsIconic(w),foreground=GetForegroundWindow()==w};rows.Add(row);
   if(!String.IsNullOrEmpty(screenshot)&&row.visible&&!row.minimized){Rect rect;GetWindowRect(w,out rect);using(var bitmap=new Bitmap(rect.right-rect.x,rect.bottom-rect.y)){using(var graphics=Graphics.FromImage(bitmap)){var dc=graphics.GetHdc();try{if(!PrintWindow(w,dc,2))throw new Exception("PrintWindow failed");}finally{graphics.ReleaseHdc(dc);}}bitmap.Save(screenshot,ImageFormat.Png);}}
   return true;},IntPtr.Zero);return rows.ToArray();
 }
}
'@
ConvertTo-Json -InputObject @([UpdateForegroundProbe]::Read([int[]]$owned,$Screenshot)) -Compress
