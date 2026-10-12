// A GUI-subsystem launcher: the Electron parent has no inherited console.
// Only reads window/process metadata. It never focuses, moves or clicks windows.
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Globalization;

public static class ConsoleWindowMonitor {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Entry {
    public uint size, usage, id; public IntPtr heap; public uint module, threads, parent; public int priority; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string name;
  }
  delegate bool Callback(IntPtr window, IntPtr value);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StartupInfo {
    public int size;public string reserved,desktop,title;public int x,y,width,height,xChars,yChars,fill,flags;public short show,reservedSize;public IntPtr reserved2,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr process,thread;public uint id,threadId;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref StartupInfo startup,out ProcessInfo process);
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AttachConsole(uint process);
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetConsoleTitleW(StringBuilder title,uint length);
  [DllImport("kernel32.dll")] static extern uint GetConsoleProcessList([Out] uint[] processes, uint count);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr value);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window,StringBuilder text,int length);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  static string Json(string text) { return "\"" + text.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
  static long Birth(uint process,Dictionary<uint,long> cache){if(cache.ContainsKey(process))return cache[process];try{long birth=Process.GetProcessById((int)process).StartTime.ToUniversalTime().Ticks;cache[process]=birth;return birth;}catch{return 0;}}
  public static void Main(string[] args) {
    // A GUI executable can inherit an existing console association from its
    // launcher. Detach this probe process before starting the application.
    FreeConsole();
    string directory=args[0], executable=File.ReadAllText(Path.Combine(directory,"executable.txt")), arguments=File.ReadAllText(Path.Combine(directory,"arguments.txt"));
    var removeKeys=new List<string>();foreach(string key in Environment.GetEnvironmentVariables().Keys){if(key.StartsWith("WEFTMATE_",StringComparison.OrdinalIgnoreCase)||key.StartsWith("MEMOWEFT_",StringComparison.OrdinalIgnoreCase)||key.StartsWith("DSH_",StringComparison.OrdinalIgnoreCase)||key.EndsWith("_API_KEY",StringComparison.OrdinalIgnoreCase)||key.EndsWith("_API_TOKEN",StringComparison.OrdinalIgnoreCase)||key=="MODEL_SWITCH_UNIFIED_KEY")removeKeys.Add(key);}foreach(string key in removeKeys)Environment.SetEnvironmentVariable(key,null);
    Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE",null);
    Environment.SetEnvironmentVariable("ELECTRON_NO_ATTACH_CONSOLE","1");
    Environment.SetEnvironmentVariable("WEFTMATE_TEST_HOST_NAME","synthetic-host");
    Environment.SetEnvironmentVariable("UX2_CONSOLE_PROBE_ROOT",directory);
    Environment.SetEnvironmentVariable("PYTHONDONTWRITEBYTECODE","1");
    string marker=File.ReadAllText(Path.Combine(directory,"marker.txt"));Environment.SetEnvironmentVariable("UX2_CONSOLE_MARKER",marker);
    // GUI subsystem already supplies no console. SW_SHOWNORMAL matches an
    // ordinary Explorer launch. The test's own app uses tray/off-screen mode
    // so it never activates a window on the user's working desktop.
    var startup=new StartupInfo();startup.size=Marshal.SizeOf(typeof(StartupInfo));startup.flags=1;startup.show=1;
    ProcessInfo launched;if(!CreateProcessW(executable,new StringBuilder("\""+executable+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,false,0,IntPtr.Zero,null,ref startup,out launched))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    CloseHandle(launched.thread);CloseHandle(launched.process);var child=Process.GetProcessById((int)launched.id);
    long rootBirth=child.StartTime.ToUniversalTime().Ticks;var births=new Dictionary<uint,long>();births[(uint)child.Id]=rootBirth;bool nativePositiveStarted=false;
    File.WriteAllText(Path.Combine(directory,"pid.txt"),child.Id.ToString());
    var known=new Dictionary<uint,Entry>(); var reported=new HashSet<string>(); var timer=Stopwatch.StartNew(); int samples=0;long previousSample=0,maxGap=0,totalGap=0;
    bool attached=AttachConsole((uint)child.Id); int attachError=attached?0:Marshal.GetLastWin32Error();bool hadConsole=attached && GetConsoleWindow()!=IntPtr.Zero; if(attached)FreeConsole();
    File.WriteAllText(Path.Combine(directory,"parent-console.json"),"{\"guiLauncher\":true,\"launcherDetached\":true,\"consoleAttached\":"+attached.ToString().ToLower()+",\"attachError\":"+attachError+",\"consoleWindow\":"+hadConsole.ToString().ToLower()+"}");
    using(var evidence=new StreamWriter(Path.Combine(directory,"windows.ndjson")))
    using(var processEvidence=new StreamWriter(Path.Combine(directory,"processes.ndjson")))
    using(var unmatchedEvidence=new StreamWriter(Path.Combine(directory,"unmatched-windows.ndjson")))
    using(var consoleEvidence=new StreamWriter(Path.Combine(directory,"console-clients.ndjson"))) {
      var unmatched=new HashSet<string>();
      var consoleReported=new HashSet<string>();
      while(!child.HasExited && !File.Exists(Path.Combine(directory,"stop")) && timer.ElapsedMilliseconds<240000) {
        long sampleAt=timer.ElapsedMilliseconds;if(samples>0){long gap=sampleAt-previousSample;totalGap+=gap;maxGap=Math.Max(maxGap,gap);}previousSample=sampleAt;
        string phase="startup";try{phase=File.ReadAllText(Path.Combine(directory,"phase.txt"));}catch{}
        if(!nativePositiveStarted&&File.Exists(Path.Combine(directory,"native-positive-request"))){
          nativePositiveStarted=true;var positiveStartup=new StartupInfo();positiveStartup.size=Marshal.SizeOf(typeof(StartupInfo));positiveStartup.flags=1|4;positiveStartup.show=7;positiveStartup.x=-20000;positiveStartup.y=-20000;
          string powershell=Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"),"System32","WindowsPowerShell","v1.0","powershell.exe");
          string positiveArgs="\""+powershell+"\" -NoProfile -NonInteractive -Command \"$Host.UI.RawUI.WindowTitle='"+marker+"-native-positive'; Start-Sleep -Milliseconds 1200\"";
          ProcessInfo positive;if(!CreateProcessW(powershell,new StringBuilder(positiveArgs),IntPtr.Zero,IntPtr.Zero,false,0x10,IntPtr.Zero,null,ref positiveStartup,out positive))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
          CloseHandle(positive.thread);CloseHandle(positive.process);var nativeEntry=new Entry();nativeEntry.id=positive.id;nativeEntry.parent=(uint)Process.GetCurrentProcess().Id;nativeEntry.name="powershell.exe";known[nativeEntry.id]=nativeEntry;births[nativeEntry.id]=Birth(nativeEntry.id,new Dictionary<uint,long>());
          processEvidence.WriteLine("{\"elapsedMs\":"+sampleAt+",\"pid\":"+nativeEntry.id+",\"parentPid\":"+nativeEntry.parent+",\"process\":\"powershell.exe\",\"phase\":\"native-positive-control\",\"creationFlags\":16,\"showWindow\":7}");processEvidence.Flush();
        }
        var entries=new List<Entry>(); var snapshot=CreateToolhelp32Snapshot(2,0);
        try { var entry=new Entry(); entry.size=(uint)Marshal.SizeOf(typeof(Entry)); if(Process32FirstW(snapshot,ref entry)) { do { entries.Add(entry); } while(Process32NextW(snapshot,ref entry)); } } finally {CloseHandle(snapshot);}
        var currentEntries=new Dictionary<uint,Entry>();var currentBirths=new Dictionary<uint,long>();
        foreach(var entry in entries)currentEntries[entry.id]=entry;
        var stale=new List<uint>();foreach(var entry in known)if(!currentEntries.ContainsKey(entry.Key)||!births.ContainsKey(entry.Key)||Birth(entry.Key,currentBirths)!=births[entry.Key])stale.Add(entry.Key);foreach(uint id in stale){known.Remove(id);births.Remove(id);}
        foreach(var entry in entries)if(entry.id==(uint)child.Id){known[entry.id]=entry;births[entry.id]=rootBirth;}
        bool changed=true; while(changed) {changed=false;foreach(var entry in entries)if(!known.ContainsKey(entry.id)&&known.ContainsKey(entry.parent)){
          long birth=Birth(entry.id,currentBirths);if(birth<rootBirth||birth<births[entry.parent])continue;
          known[entry.id]=entry;births[entry.id]=birth;changed=true;processEvidence.WriteLine("{\"elapsedMs\":"+sampleAt+",\"pid\":"+entry.id+",\"parentPid\":"+entry.parent+",\"process\":"+Json(entry.name)+",\"phase\":"+Json(phase)+"}");processEvidence.Flush();
        }}
        // A delegated console's conhost/OpenConsole or an already running
        // Windows Terminal need not descend from Electron. Attach only to our
        // own client processes, then verify the console client list and follow
        // its host's process ancestry back to WindowsTerminal.exe.
        var consoleWindows=new Dictionary<IntPtr,uint>();var terminalOwners=new Dictionary<uint,uint>();var titledClients=new Dictionary<string,uint>();
        foreach(var row in entries){
          if(!known.ContainsKey(row.id)||row.id==(uint)child.Id)continue;
          if(!AttachConsole(row.id))continue;
          try{
            var clients=new uint[512];uint count=GetConsoleProcessList(clients,(uint)clients.Length);bool owns=false;
            for(int n=0;n<Math.Min(count,(uint)clients.Length);n++)if(clients[n]==row.id)owns=true;
            if(!owns)continue;
            var ownTitle=new StringBuilder(512);GetConsoleTitleW(ownTitle,(uint)ownTitle.Capacity);bool syntheticTitle=ownTitle.ToString().Contains(marker);if(syntheticTitle)titledClients[ownTitle.ToString()]=row.id;
            var console=GetConsoleWindow();if(console==IntPtr.Zero)continue;consoleWindows[console]=row.id;
            var consoleClass=new StringBuilder(260);GetClassNameW(console,consoleClass,consoleClass.Capacity);bool consoleVisible=IsWindowVisible(console);
            string consoleKey=row.id+":"+consoleVisible+":"+syntheticTitle;if(consoleReported.Add(consoleKey)){consoleEvidence.WriteLine("{\"elapsedMs\":"+sampleAt+",\"phase\":"+Json(phase)+",\"clientPid\":"+row.id+",\"clientProcess\":"+Json(row.name)+",\"windowClass\":"+Json(consoleClass.ToString())+",\"visible\":"+consoleVisible.ToString().ToLower()+",\"syntheticTitle\":"+syntheticTitle.ToString().ToLower()+"}");consoleEvidence.Flush();}
            uint host;GetWindowThreadProcessId(console,out host);var visited=new HashSet<uint>();
            while(currentEntries.ContainsKey(host)&&visited.Add(host)){
              var hostEntry=currentEntries[host];
              if(hostEntry.name.Equals("WindowsTerminal.exe",StringComparison.OrdinalIgnoreCase)||hostEntry.name.Equals("OpenConsole.exe",StringComparison.OrdinalIgnoreCase)||hostEntry.name.Equals("conhost.exe",StringComparison.OrdinalIgnoreCase))terminalOwners[host]=row.id;
              host=hostEntry.parent;
            }
          }finally{FreeConsole();}
        }
        EnumWindows((window,value)=> {
          if(!IsWindowVisible(window))return true;
          var text=new StringBuilder(260); GetClassNameW(window,text,text.Capacity); string kind=text.ToString();
          if(kind!="ConsoleWindowClass" && kind!="CASCADIA_HOSTING_WINDOW_CLASS" && kind!="PseudoConsoleWindow")return true;
          uint owner;GetWindowThreadProcessId(window,out owner);
          uint client=0;if(consoleWindows.ContainsKey(window))client=consoleWindows[window];else if(terminalOwners.ContainsKey(owner))client=terminalOwners[owner];else if(known.ContainsKey(owner))client=owner;
          bool matchedSyntheticTitle=false;
          if(client==0&&titledClients.Count>0){var title=new StringBuilder(1024);GetWindowTextW(window,title,title.Capacity);foreach(var ownTitle in titledClients)if(title.ToString().Contains(ownTitle.Key)){client=ownTitle.Value;matchedSyntheticTitle=true;break;}}
          if(client==0){string unmatchedKey=window.ToInt64().ToString()+":"+owner;if(unmatched.Add(unmatchedKey)){unmatchedEvidence.WriteLine("{\"elapsedMs\":"+timer.ElapsedMilliseconds+",\"phase\":"+Json(phase)+",\"windowClass\":"+Json(kind)+",\"pid\":"+owner+"}");unmatchedEvidence.Flush();}return true;}
          string key=window.ToInt64().ToString()+":"+owner; if(!reported.Add(key))return true;
          Entry entry;if(!currentEntries.TryGetValue(owner,out entry)){entry=new Entry();entry.id=owner;entry.name="console-host";}var chain=new List<string>();uint cursor=client;var seen=new HashSet<uint>();
          while(known.ContainsKey(cursor)&&seen.Add(cursor)){var row=known[cursor];chain.Add("{\"pid\":"+row.id+",\"name\":"+Json(row.name)+",\"parentPid\":"+row.parent+"}");cursor=row.parent;}
          evidence.WriteLine("{\"elapsedMs\":"+timer.ElapsedMilliseconds+",\"phase\":"+Json(phase)+",\"windowClass\":"+Json(kind)+",\"pid\":"+owner+",\"process\":"+Json(entry.name)+",\"consoleClientPid\":"+client+",\"matchedSyntheticTitle\":"+matchedSyntheticTitle.ToString().ToLower()+",\"ancestry\":["+String.Join(",",chain.ToArray())+"]}");evidence.Flush();return true;
        },IntPtr.Zero); samples++;Thread.Sleep(1);
      }
    }
    File.WriteAllText(Path.Combine(directory,"sampling.json"),"{\"sleepMs\":1,\"meanSampleGapMs\":"+((double)totalGap/Math.Max(1,samples-1)).ToString("F2",CultureInfo.InvariantCulture)+",\"maxSampleGapMs\":"+maxGap+",\"samples\":"+samples+",\"elapsedMs\":"+timer.ElapsedMilliseconds+",\"visibleConsoleWindows\":"+reported.Count+"}");
    // The driver closes its own Electron via the debug channel before stopping.
  }
}
