import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export const SYSTEM_QUERY_TIMEOUT_MS = 5000;
export const STOP_PROCESS_TIMEOUT_MS = 5000;
export const REGISTRY_TIMEOUT_MS = 5000;
export async function readNotificationPermission({exec,timeoutMs=SYSTEM_QUERY_TIMEOUT_MS,onFailure=()=>{}}={}) {
  const script="$globalEnabled=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications' -Name ToastEnabled -ErrorAction SilentlyContinue).ToastEnabled; $appEnabled=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\com.memoweft.weftmate' -Name Enabled -ErrorAction SilentlyContinue).Enabled; if($globalEnabled -eq 0 -or $appEnabled -eq 0){'disabled'}elseif($globalEnabled -eq 1){'enabled'}else{'unknown'}";
  try {
    const {stdout}=await boundedCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{exec,timeoutMs,windowsHide:true});
    return stdout.trim()==='disabled'?false:stdout.trim()==='enabled'?true:null;
  } catch(error) {onFailure(error);return null;}
}
export async function readUninstallRegistry(executable,{exec,timeoutMs=REGISTRY_TIMEOUT_MS}={}) {
  const script="$target=$env:WEFTMATE_RECOVERY_EXE; Get-ChildItem HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall | Where-Object { $value=$_.GetValue('UninstallString'); $value -and $value -match '^\"([^\"]+)\"' -and [IO.Path]::GetDirectoryName($matches[1]) -eq [IO.Path]::GetDirectoryName($target) } | ForEach-Object { @{key=$_.Name;version=$_.GetValue('DisplayVersion')} } | ConvertTo-Json -Compress";
  const result=await boundedCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{exec,timeoutMs,windowsHide:true,env:{...process.env,WEFTMATE_RECOVERY_EXE:executable}});
  try {return result.stdout.trim()?JSON.parse(result.stdout):null;}
  catch {throw Object.assign(new Error('EXTERNAL_COMMAND_FAILED'),{code:'EXTERNAL_COMMAND_FAILED'});}
}
/** The deadline also covers an injected executor that never settles. Child
 * errors/stdout/stderr never escape through the public error object. */
export async function boundedCommand(command, args, { exec=execute, timeoutMs, timeoutCode='EXTERNAL_COMMAND_TIMEOUT', failureCode='EXTERNAL_COMMAND_FAILED', ...options }) {
  let task, timer;
  try {
    task=exec(command,args,{...options,timeout:timeoutMs,killSignal:'SIGKILL'});
    return await Promise.race([task,new Promise((_,reject)=>{
      timer=setTimeout(()=>{try {task?.child?.kill('SIGKILL');} catch {} reject(Object.assign(new Error(timeoutCode),{code:timeoutCode}));},timeoutMs);
    })]);
  } catch(error) {
    const code=error?.code===timeoutCode || error?.killed && error?.code!=='ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? timeoutCode : failureCode;
    throw Object.assign(new Error(code),{code});
  } finally {clearTimeout(timer);}
}
// Get-Process uses native process enumeration, not the CIM/WMI service.
// A candidate with an unreadable path is UNKNOWN, never an absent process.
export async function relevantProcesses(targets, { exec, timeoutMs=SYSTEM_QUERY_TIMEOUT_MS, env=process.env }={}) {
  const script="$ErrorActionPreference='Stop'; $targets=ConvertFrom-Json $env:WEFTMATE_RECOVERY_TARGETS; $names=@($targets | ForEach-Object {[IO.Path]::GetFileNameWithoutExtension($_)}); $rows=@(Get-Process | Where-Object {$_.ProcessName -in $names} | ForEach-Object { $path=$_.Path; if(-not $path){throw 'PROCESS_PATH_UNKNOWN'}; if($path -in $targets){@{ProcessId=$_.Id; ExecutablePath=$path}} }); ConvertTo-Json -InputObject $rows -Compress";
  const result=await boundedCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
    {exec,timeoutMs,timeoutCode:'SYSTEM_QUERY_TIMEOUT',failureCode:'SYSTEM_QUERY_FAILED',windowsHide:true,maxBuffer:64*1024,env:{...env,WEFTMATE_RECOVERY_TARGETS:JSON.stringify(targets.filter(Boolean))}});
  try {
    const rows=JSON.parse(result.stdout);
    if(!Array.isArray(rows)||rows.some(row=>!Number.isInteger(row.ProcessId)||row.ProcessId<1||!targets.some(target=>String(target).toLowerCase()===String(row.ExecutablePath).toLowerCase()))) throw Error();
    return rows;
  } catch {throw Object.assign(new Error('SYSTEM_QUERY_FAILED'),{code:'SYSTEM_QUERY_FAILED'});}
}
