import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {boundedCommand,relevantProcesses} from '../../src/personal-update/watchdog-commands.mjs';
import {cleanupOwnedProcesses} from '../../tests/helpers/process-evidence.mjs';
mkdirSync(resolve('.local/rob-1-command-fixed'),{recursive:true});
const execute=promisify(execFile),root=mkdtempSync(join(tmpdir(),'weftmate-rev-rob1-command-'));
const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const startedAt=Date.now(),report=[];let cleaned=0;
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
try{
 writeFileSync(join(root,'child.ps1'),'Start-Sleep -Seconds 120');
 writeFileSync(join(root,'parent.ps1'),`$p=Start-Process -FilePath '${powershell.replaceAll("'","''")}' -ArgumentList '-NoProfile','-NonInteractive','-File',('"'+$PSScriptRoot+'\\child.ps1"') -WindowStyle Hidden -PassThru; [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'child.pid'),[string]$p.Id); Start-Sleep -Seconds 120`);
 for(let repeat=0;repeat<3;repeat++){
  let parentPid,code;const at=Date.now();
  try{await boundedCommand(powershell,['-NoProfile','-NonInteractive','-File',join(root,'parent.ps1')],{timeoutMs:2000,windowsHide:true,exec:(...args)=>{const p=execute(...args);parentPid=p.child.pid;return p;}});}catch(e){code=e.code;}
  const childPid=existsSync(join(root,'child.pid'))?Number(readFileSync(join(root,'child.pid'),'utf8')):null;
  report.push({repeat,code,elapsedMs:Date.now()-at,parentAlive:alive(parentPid),childCreated:!!childPid,childAlive:childPid?alive(childPid):null});
  assert.equal(report.at(-1).childCreated,true); assert.equal(report.at(-1).parentAlive,false); assert.equal(report.at(-1).childAlive,false);
  const c=cleanupOwnedProcesses({startedAt,executables:[powershell],commandRoots:[root]});cleaned+=c.cleaned;report.push({cleanup:c});
 }
 for(const delayMs of [3000,6000,8000]){
  const at=Date.now();let code='OK';try{await relevantProcesses(['C:\\synthetic\\WeftMate.exe'],{exec:()=>new Promise(r=>setTimeout(()=>r({stdout:'[]'}),delayMs))});}catch(e){code=e.code;}
  report.push({delayMs,code,elapsedMs:Date.now()-at}); assert.equal(code,'OK');
 }
}finally{
 const c=cleanupOwnedProcesses({startedAt,executables:[powershell],commandRoots:[root]});cleaned+=c.cleaned;
 writeFileSync(resolve('.local/rob-1-command-fixed/commands.json'),JSON.stringify({report,cleaned},null,2));console.log(JSON.stringify({report,cleaned},null,2));
 if(c.available&&!c.failed&&root.startsWith(join(tmpdir(),'weftmate-rev-rob1-command-')))rmSync(root,{recursive:true,force:true});
}