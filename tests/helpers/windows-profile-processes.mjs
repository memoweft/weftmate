import {execFileSync} from 'node:child_process';

/** Query command lines directly: WMI/CIM can hang while its provider is busy. */
export function windowsProfileProcesses(profile){
  const script=`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ProfileProcessCommand {
 [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int kind,IntPtr data,int size,out int needed);
 [StructLayout(LayoutKind.Sequential)] struct Text {public ushort length;public ushort maximum;public IntPtr buffer;}
 public static string Read(IntPtr handle){int n;NtQueryInformationProcess(handle,60,IntPtr.Zero,0,out n);if(n<=0)return null;var p=Marshal.AllocHGlobal(n);try{if(NtQueryInformationProcess(handle,60,p,n,out n)!=0)return null;var t=Marshal.PtrToStructure<Text>(p);return Marshal.PtrToStringUni(t.buffer,t.length/2);}finally{Marshal.FreeHGlobal(p);}}
}
"@
if([string]::IsNullOrEmpty([ProfileProcessCommand]::Read((Get-Process -Id $PID).Handle))){throw 'Native process command-line query unavailable'}
$scope='${profile.replaceAll("'","''")}'
$found=@(foreach($p in Get-Process){if($p.ProcessName -notmatch '^(node|electron|python|python3)$'){continue};try{if(!$p.Path){continue};$line=[ProfileProcessCommand]::Read($p.Handle);if($line -and $line.Contains($scope)){$p.Id}}catch{}})
ConvertTo-Json -InputObject $found -Compress
`;
  return JSON.parse(execFileSync('pwsh',['-NoProfile','-Command',script],{encoding:'utf8',timeout:15000}).trim()||'[]');
}
