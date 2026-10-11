// Private-desktop window capture. Never switches desktops or sends global input.
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class InstallerDesktop : IDisposable {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved, desktop, title; public int x,y,w,h,cx,cy,fill,flags;
    public short show, reservedSize; public IntPtr reserved2, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread;public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left,top,right,bottom; }
  [StructLayout(LayoutKind.Sequential)] struct Point {public int x,y;}
  delegate bool EnumProc(IntPtr hwnd,IntPtr arg);
  [DllImport("user32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateDesktop(string name,IntPtr device,IntPtr mode,int flags,uint access,IntPtr security);
  [DllImport("user32")] static extern bool SetThreadDesktop(IntPtr desktop);
  [DllImport("user32")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
  [DllImport("user32")] static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
  [DllImport("user32")] static extern bool PhysicalToLogicalPointForPerMonitorDPI(IntPtr hwnd,ref Point point);
  [DllImport("dwmapi")] static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out Rect rect,int size);
  [DllImport("user32",CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr wp,StringBuilder lp);
  [DllImport("user32")] static extern bool EnumDesktopWindows(IntPtr desktop,EnumProc cb,IntPtr arg);
  [DllImport("user32")] static extern bool EnumChildWindows(IntPtr hwnd,EnumProc cb,IntPtr arg);
  [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out int pid);
  [DllImport("user32")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder text,int length);
  [DllImport("user32",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int length);
  [DllImport("user32")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32")] static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
  [DllImport("user32")] static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr wp,IntPtr lp);
  [DllImport("user32")] static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr wp,IntPtr lp);
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr processAttr,IntPtr threadAttr,bool inherit,uint flags,IntPtr environment,string cwd,ref Startup startup,out ProcessInfo info);
  [DllImport("kernel32")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32")] static extern bool GetExitCodeProcess(IntPtr handle,out int code);
  [DllImport("kernel32")] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32")] static extern IntPtr VirtualAllocEx(IntPtr process,IntPtr address,UIntPtr size,uint type,uint protect);
  [DllImport("kernel32")] static extern bool VirtualFreeEx(IntPtr process,IntPtr address,UIntPtr size,uint type);
  [DllImport("kernel32")] static extern bool WriteProcessMemory(IntPtr process,IntPtr address,byte[] bytes,int size,out IntPtr written);
  [DllImport("kernel32")] static extern bool ReadProcessMemory(IntPtr process,IntPtr address,byte[] bytes,int size,out IntPtr read);
  readonly Dictionary<int,IntPtr> processHandles=new Dictionary<int,IntPtr>();
  readonly List<string> captureMeasurements=new List<string>();
  string[] ListRows(IntPtr hwnd) {
    int pid;GetWindowThreadProcessId(hwnd,out pid);var process=OpenProcess(0x38,false,pid);var rows=new List<string>();
    if(process==IntPtr.Zero)return rows.ToArray();var memory=VirtualAllocEx(process,IntPtr.Zero,new UIntPtr(8192),0x3000,4);
    try{if(memory==IntPtr.Zero)return rows.ToArray();int count=SendMessage(hwnd,0x1004,IntPtr.Zero,IntPtr.Zero).ToInt32();for(int i=0;i<count;i++){var item=new byte[64];Array.Copy(BitConverter.GetBytes(memory.ToInt64()+64),0,item,20,4);Array.Copy(BitConverter.GetBytes(4000),0,item,24,4);IntPtr n;WriteProcessMemory(process,memory,item,item.Length,out n);SendMessage(hwnd,0x1073,new IntPtr(i),memory);var text=new byte[8000];ReadProcessMemory(process,new IntPtr(memory.ToInt64()+64),text,text.Length,out n);rows.Add(Encoding.Unicode.GetString(text).Split('\0')[0]);}}finally{if(memory!=IntPtr.Zero)VirtualFreeEx(process,memory,UIntPtr.Zero,0x8000);CloseHandle(process);}return rows.ToArray();
  }
  readonly BlockingCollection<Action> queue=new BlockingCollection<Action>();
  readonly Thread worker; readonly string name; IntPtr desktop;
  public InstallerDesktop(string desktopName) {
    name=desktopName;var ready=new ManualResetEvent(false);Exception failed=null;
    worker=new Thread(()=>{try{SetThreadDpiAwarenessContext(new IntPtr(-4));desktop=CreateDesktop(name,IntPtr.Zero,IntPtr.Zero,0,0x01ff,IntPtr.Zero);if(desktop==IntPtr.Zero||!SetThreadDesktop(desktop))throw new System.ComponentModel.Win32Exception();}catch(Exception e){failed=e;}ready.Set();foreach(var action in queue.GetConsumingEnumerable())action();CloseDesktop(desktop);});
    worker.IsBackground=true;worker.Start();ready.WaitOne();if(failed!=null)throw failed;
  }
  T Run<T>(Func<T> fn) {T result=default(T);Exception failed=null;var done=new ManualResetEvent(false);queue.Add(()=>{try{result=fn();}catch(Exception e){failed=e;}finally{done.Set();}});done.WaitOne();if(failed!=null)throw failed;return result;}
  public int Launch(string exe,string args,string cwd) {return Run(()=>{Startup s=new Startup();s.cb=Marshal.SizeOf(typeof(Startup));s.desktop="WinSta0\\"+name;s.flags=1;s.show=4;ProcessInfo info;if(!CreateProcess(exe,new StringBuilder("\""+exe+"\" "+args),IntPtr.Zero,IntPtr.Zero,false,0,IntPtr.Zero,cwd,ref s,out info))throw new System.ComponentModel.Win32Exception();processHandles[info.pid]=info.process;CloseHandle(info.thread);return info.pid;});}
  public int ExitCode(int pid){return Run(()=>{int code;if(!GetExitCodeProcess(processHandles[pid],out code))throw new System.ComponentModel.Win32Exception();return code;});}
  public int WindowProcess(long handle){return Run(()=>{int pid;GetWindowThreadProcessId(new IntPtr(handle),out pid);if(!processHandles.ContainsKey(pid)){var process=OpenProcess(0x101000,false,pid);if(process==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();processHandles[pid]=process;}return pid;});}
  public string[] DetailText(long handle) {return Run(()=>{var rows=new List<string>();rows.Add(Class(new IntPtr(handle))+" "+Title(new IntPtr(handle)));EnumChildWindows(new IntPtr(handle),(h,p)=>{rows.Add(Class(h)+" "+Title(h));if(Class(h)=="SysListView32")rows.AddRange(ListRows(h));return true;},IntPtr.Zero);return rows.ToArray();});}
  static string Class(IntPtr h){var b=new StringBuilder(256);GetClassName(h,b,256);return b.ToString();}
  static string Title(IntPtr h){var b=new StringBuilder(1024);GetWindowText(h,b,1024);return b.ToString();}
  public long Find(string kind,string title) {return Run(()=>{IntPtr found=IntPtr.Zero;EnumDesktopWindows(desktop,(h,p)=>{if(!IsWindowVisible(h))return true;if(kind=="dialog"&&Class(h)=="#32770"){found=h;return false;}if(kind=="prompt"&&Class(h)=="WeftMateInstallerPrompt"){found=h;return false;}if(kind=="app"&&Class(h).StartsWith("Chrome_WidgetWin")&&Title(h).Contains("WeftMate")){found=h;return false;}if(kind=="progress"){bool has=false;EnumChildWindows(h,(c,q)=>{if(Class(c)=="WeftMateInstallerSurface"&&(title.Length==0||Title(c)==title))has=true;return true;},IntPtr.Zero);if(has){found=h;return false;}}return true;},IntPtr.Zero);return found.ToInt64();});}
  public string[] Windows() {return Run(()=>{var rows=new List<string>();EnumDesktopWindows(desktop,(h,p)=>{if(IsWindowVisible(h)){int pid;GetWindowThreadProcessId(h,out pid);rows.Add(pid+" "+Class(h)+" "+Title(h));}return true;},IntPtr.Zero);return rows.ToArray();});}
  public string[] CaptureMeasurements(){return Run(()=>captureMeasurements.ToArray());}
  public void Capture(long handle,string file) {Run(()=>{
    var hwnd=new IntPtr(handle);var context=GetWindowDpiAwarenessContext(hwnd);
    var prior=SetThreadDpiAwarenessContext(context);
    try {
      Rect r;if(!GetWindowRect(hwnd,out r))throw new Exception("Window rectangle unavailable");
      Rect visible;int x=0,y=0,fullWidth=r.right-r.left,fullHeight=r.bottom-r.top,w=fullWidth,h=fullHeight;
      if(DwmGetWindowAttribute(hwnd,9,out visible,Marshal.SizeOf(typeof(Rect)))==0) {
        Point a=new Point{x=visible.left,y=visible.top},b=new Point{x=visible.right,y=visible.bottom};
        PhysicalToLogicalPointForPerMonitorDPI(hwnd,ref a);PhysicalToLogicalPointForPerMonitorDPI(hwnd,ref b);
        if(a.x>=r.left&&a.y>=r.top&&b.x<=r.right&&b.y<=r.bottom) {
          x=a.x-r.left;y=a.y-r.top;w=b.x-a.x;h=b.y-a.y;
        }
      }
      using(var bitmap=new Bitmap(fullWidth,fullHeight)) {
        using(var g=Graphics.FromImage(bitmap)) {
          IntPtr dc=g.GetHdc();try{if(!PrintWindow(hwnd,dc,2))throw new Exception("PrintWindow failed");}finally{g.ReleaseHdc(dc);}
        }
        // Keep the complete original. DWM's visible rectangle only excludes
        // invisible resize borders, never a mismatch in DPI or app content.
        string raw=System.IO.Path.Combine(System.IO.Path.GetDirectoryName(file),"raw");
        System.IO.Directory.CreateDirectory(raw);bitmap.Save(System.IO.Path.Combine(raw,System.IO.Path.GetFileName(file)),ImageFormat.Png);
        using(var frame=bitmap.Clone(new Rectangle(x,y,w,h),bitmap.PixelFormat))frame.Save(file,ImageFormat.Png);
      }
      captureMeasurements.Add("{\"file\":\""+System.IO.Path.GetFileName(file)+"\",\"dpi\":"+GetDpiForWindow(hwnd)+",\"awareness\":"+GetAwarenessFromDpiAwarenessContext(context)+",\"rawWidth\":"+fullWidth+",\"rawHeight\":"+fullHeight+",\"x\":"+x+",\"y\":"+y+",\"width\":"+w+",\"height\":"+h+"}");
    } finally {SetThreadDpiAwarenessContext(prior);}return true;
  });}
  public void Button(long handle,int id) {Run(()=>{if(!PostMessage(new IntPtr(handle),0x111,new IntPtr(id),IntPtr.Zero))throw new System.ComponentModel.Win32Exception();return true;});}
  public void Dispose(){Run(()=>{foreach(var handle in processHandles.Values)CloseHandle(handle);processHandles.Clear();return true;});queue.CompleteAdding();worker.Join();queue.Dispose();}
}
