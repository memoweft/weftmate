import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { boundedCommand, relevantProcesses, readNotificationPermission, readUninstallRegistry } from '../src/personal-update/watchdog-commands.mjs';
import { createHostRelay } from '../src/personal-relay/index.mjs';
import { readLocalServiceKey } from '../src/local-service-key.mjs';
import { SYSTEM_QUERY_TIMEOUT_MS, REGISTRY_TIMEOUT_MS } from '../src/personal-update/watchdog-commands.mjs';
import { LOCAL_SERVICE_QUERY_TIMEOUT_MS } from '../src/local-service-key.mjs';
import { createProcessEvidence } from './helpers/process-evidence.mjs';
const never=()=>new Promise(()=>{});
test('background query budgets are 15 seconds while local key query remains short and retryable',()=>{
  assert.equal(SYSTEM_QUERY_TIMEOUT_MS,15000); assert.equal(REGISTRY_TIMEOUT_MS,15000); assert.equal(LOCAL_SERVICE_QUERY_TIMEOUT_MS,5000);
});
test('review command trees leave no descendants in three runs and 6/8-second background successes remain usable',{skip:process.platform!=='win32',timeout:60000},async()=>{
  const evidence=createProcessEvidence({outputDir:resolve('.local/rob-1-command-runner'),executables:[process.execPath],commandRoots:[resolve('tests/integration')],startedAt:Date.now()});
  const {done}=evidence.spawn(process.execPath,[resolve('tests/integration/rob-1-command-probe.mjs')]);
  try {assert.equal((await done).decimal,0);} finally {assert.equal((await evidence.finalize()).stillRunning,false);}
});
test('notification query timeout preserves unknown permission and logs the fixed failure',async()=>{
  const failures=[];
  assert.equal(await readNotificationPermission({exec:never,timeoutMs:20,onFailure:error=>failures.push(error.code)}),null);
  assert.deepEqual(failures,['EXTERNAL_COMMAND_TIMEOUT']);
});
test('update preparation registry timeout refuses to continue',async()=>{
  await assert.rejects(readUninstallRegistry('C:\\synthetic\\WeftMate.exe',{exec:never,timeoutMs:20}),{code:'EXTERNAL_COMMAND_TIMEOUT'});
});
test('relay version query timeout refuses an unverified executable and reports failure',async()=>{
  const failures=[];
  await assert.rejects(createHostRelay({root:'synthetic-unused-root',identity:{},options:{binary:'synthetic-frpc',transportCaFile:'synthetic-ca',certFile:'synthetic-cert',diagnostic:error=>failures.push(error.code)},executeCommand:(command,args,options)=>boundedCommand(command,args,{...options,exec:never,timeoutMs:20})}),{code:'EXTERNAL_COMMAND_TIMEOUT'});
  assert.deepEqual(failures,['EXTERNAL_COMMAND_TIMEOUT']);
});
test('local service query deadline gives a refill/retry message and a fixed failure without child material',async()=>{
  const failures:any[]=[]; const at=Date.now();
  await assert.rejects(readLocalServiceKey({exec:never,timeoutMs:20,onFailure:error=>failures.push(error)}),error=>error.code==='SYSTEM_QUERY_TIMEOUT' && error.message==='系统查询没有响应，稍后再试。');
  assert.ok(Date.now()-at<1000); assert.equal(failures.length,1);
  const dangerous=Object.assign(new Error('synthetic-private-key'),{stdout:'synthetic-private-key',stderr:'synthetic-private-key'});
  await assert.rejects(readLocalServiceKey({exec:()=>Promise.reject(dangerous)}),error=>!JSON.stringify(error).includes('synthetic-private-key') && !error.message.includes('synthetic-private-key'));
  await assert.rejects(readLocalServiceKey({exec:()=>Promise.reject({code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',killed:true,stdout:'synthetic-private-key'})}),{code:'SYSTEM_QUERY_FAILED'});
});
test('watchdog query hang is unknown, never an empty process list',async()=>{
  await assert.rejects(relevantProcesses(['C:\\synthetic\\WeftMate.exe'],{exec:never,timeoutMs:20}),{code:'SYSTEM_QUERY_TIMEOUT'});
  await assert.rejects(relevantProcesses(['C:\\synthetic\\WeftMate.exe'],{exec:async()=>({stdout:'null'})}),{code:'SYSTEM_QUERY_FAILED'});
  assert.deepEqual(await relevantProcesses(['C:\\synthetic\\WeftMate.exe'],{exec:async()=>({stdout:'[]'})}),[]);
});
for(const command of ['taskkill.exe','reg.exe','openssl']) test(`${command} hang has a deadline and a sanitized failure`,async()=>{
  await assert.rejects(boundedCommand(command,[],{exec:never,timeoutMs:20}),{code:'EXTERNAL_COMMAND_TIMEOUT'});
});
for(const phase of ['before-install','before-rollback']) test(`real standalone watchdog retains pending state and installation on a query hang ${phase}`,async()=>{
  const root=mkdtempSync(join(tmpdir(),'weftmate-rob1-watchdog-')), snapshot=join(root,'snapshot'), installation=join(root,'installation');
  mkdirSync(snapshot);mkdirSync(installation); const marker=join(installation,'original.txt');writeFileSync(marker,'synthetic original');
  const source=resolve('src/personal-update/app-watchdog.mjs');
  const monitor=join(snapshot,'monitor.mjs');
  writeFileSync(monitor,readFileSync(source,'utf8'));
  writeFileSync(join(snapshot,'physical-copy.mjs'),`export async function copyPhysicalTree(){throw Error('unexpected installation write')}; export async function removePhysicalTree(){throw Error('unexpected installation removal')};`);
  writeFileSync(join(snapshot,'watchdog-host-log.mjs'),readFileSync('src/host-log.mjs'));
  const executor=phase==='before-install'?'()=>new Promise(()=>{})':"()=> (++globalThis.rob1QueryCalls===1?Promise.resolve({stdout:'[]'}):new Promise(()=>{}))";
  writeFileSync(join(snapshot,'watchdog-commands.mjs'),'globalThis.rob1QueryCalls=0;\n'+readFileSync('src/personal-update/watchdog-commands.mjs','utf8').replace('{ exec, timeoutMs=SYSTEM_QUERY_TIMEOUT_MS',`{ exec=${executor}, timeoutMs=20`));
  writeFileSync(join(root,'pending.json'),JSON.stringify({installation,snapshot,token:'synthetic-rob1',oldPid:2147483647,oldVersion:'1.0.0',executable:join(installation,'synthetic.exe'),dataDirectory:root}));
  const evidence=createProcessEvidence({outputDir:resolve('.local/rob-1-watchdog-test'),profileDirectory:root,commandRoots:[root],executables:[process.execPath]});
  try {
    const {done}=evidence.spawn(process.execPath,[monitor,root]);const exit=await done;
    assert.equal(exit.decimal,1);assert.equal(readFileSync(marker,'utf8'),'synthetic original');assert.equal(existsSync(join(root,'pending.json')),true);
    const result=JSON.parse(readFileSync(join(root,'last-result.json'),'utf8'));
    assert.equal(result.step,phase==='before-install'?'check-closed-program':'stop-new-process');assert.equal(result.code,'SYSTEM_QUERY_TIMEOUT');
    const logs=(await import('node:fs')).readdirSync(join(root,'logs')).filter(name=>name.endsWith('.jsonl')).map(name=>readFileSync(join(root,'logs',name),'utf8')).join('');
    assert.ok(logs.includes('"event":"host.failure"'));assert.ok(logs.includes('SYSTEM_QUERY_TIMEOUT'));
  } finally {const cleanup=await evidence.finalize();if(!cleanup.stillRunning&&!cleanup.preservationError)rmSync(root,{recursive:true,force:true});}
});
