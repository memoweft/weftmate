import { boundedCommand } from './personal-update/watchdog-commands.mjs';
export const LOCAL_SERVICE_QUERY_TIMEOUT_MS = 5000;
export async function readLocalServiceKey({ exec, timeoutMs=LOCAL_SERVICE_QUERY_TIMEOUT_MS, onFailure=()=>{} }={}) {
  const script=["$ErrorActionPreference = 'Stop'", "$items = @(Get-CimInstance Win32_Process -Filter \"Name = 'llama-server.exe'\" | Where-Object { $_.CommandLine -match '--api[-_]key' })",
    'if ($items.Count -ne 1) { exit 41 }', "$match = [regex]::Match($items[0].CommandLine, '(?i)--api[-_]key\\s+(?:\\\"(?<key>[^\\\"]+)\\\"|(?<key>[^\\s]+))')",
    'if (!$match.Success) { exit 42 }', "[Console]::Out.Write($match.Groups['key'].Value)"].join('; ');
  try {
    const {stdout}=await boundedCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{exec,timeoutMs,timeoutCode:'SYSTEM_QUERY_TIMEOUT',failureCode:'SYSTEM_QUERY_FAILED',windowsHide:true,maxBuffer:8192});
    const key=String(stdout).trim(); if(!key||key.length>4096)throw Error(); return key;
  } catch(error) {
    const code=error?.code==='SYSTEM_QUERY_TIMEOUT'?'SYSTEM_QUERY_TIMEOUT':'SYSTEM_QUERY_FAILED';
    const safe=Object.assign(new Error(code==='SYSTEM_QUERY_TIMEOUT'?'系统查询没有响应，稍后再试。':'无法读取本机模型密钥，请手动填写或稍后再试。'),{code});
    onFailure(safe); throw safe;
  }
}
