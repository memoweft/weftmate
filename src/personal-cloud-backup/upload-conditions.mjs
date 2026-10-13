import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
export async function privateNetworkOnPower(powerMonitor) {
  if(powerMonitor.isOnBatteryPower())return false;
  if(process.platform!=='win32')return false; // Other desktop platforms will use their native network classification.
  try {
    const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      "$taskProfiles=@(Get-NetConnectionProfile -ErrorAction Stop | Where-Object {$_.IPv4Connectivity -eq 'Internet' -or $_.IPv6Connectivity -eq 'Internet'}); [Console]::Out.Write(($taskProfiles.Count -gt 0 -and @($taskProfiles | Where-Object {$_.NetworkCategory -ne 'Private' -and $_.NetworkCategory -ne 'DomainAuthenticated'}).Count -eq 0))"],{windowsHide:true,timeout:5000});
    return stdout.trim()==='True';
  }catch{return false;}
}
