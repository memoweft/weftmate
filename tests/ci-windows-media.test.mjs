import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { managedMkdtempSync, disposeManagedTemp } from './helpers/managed-temp.mjs';
import { runManagedTestProcess } from './helpers/managed-test-process.mjs';
import { cleanupOwnedProcesses } from './helpers/process-evidence.mjs';

test('Windows media setup runs in background, waits for completion and propagates installer failure', async()=>{
  const root=managedMkdtempSync('weftmate-ci-media-proof-'), startedAt=Date.now();
  const exe=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source=readFileSync('.github/scripts/ci-windows-media.ps1','utf8').replace('$os = Get-CimInstance Win32_OperatingSystem','$os = @{ProductType=3}');
  try {
    for(const success of [true,false]) {
      const scope=join(root,success?'success':'failure'), script=join(root,success?'success.ps1':'failure.ps1');
      const mock=`while (-not (Test-Path -LiteralPath (Join-Path $Scope 'release'))) { Start-Sleep -Milliseconds 20 }; $installed = @{Success=$${success}}`;
      writeFileSync(script,source.replace('$installed = Install-WindowsFeature Server-Media-Foundation',mock));
      const env={...process.env};delete env.GITHUB_STEP_SUMMARY;
      const run=action=>runManagedTestProcess(exe,['-NoProfile','-NonInteractive','-File',script,'-Action',action,'-Scope',scope],{env,timeoutMs:10000,commandRoots:[scope],executables:[exe]});
      // The starter's cleanup must not kill its background worker; use the
      // already existing managed runner only for the completion wait below.
      const {spawn}=await import('node:child_process');
      const starter=spawn(exe,['-NoProfile','-NonInteractive','-File',script,'-Action','start','-Scope',scope],{env,windowsHide:true,stdio:'ignore'});
      const status=await new Promise((resolve,reject)=>{starter.once('close',resolve);starter.once('error',reject);});
      assert.equal(status,0);assert.equal(existsSync(join(scope,'result.json')),false,'start returns while the controlled installer is still waiting');
      writeFileSync(join(scope,'other-work-completed'),'synthetic parallel preparation');
      writeFileSync(join(scope,'release'),'synthetic condition fulfilled');
      const finished=await run('wait');
      assert.equal(finished.timedOut,false);assert.equal(finished.status,success?0:1);
      assert.equal(JSON.parse(readFileSync(join(scope,'result.json'),'utf8')).exitCode,success?0:1);
    }
  } finally {
    cleanupOwnedProcesses({startedAt,executables:[exe],commandRoots:[root]});
    disposeManagedTemp(root,{log:()=>{}});
  }
});
