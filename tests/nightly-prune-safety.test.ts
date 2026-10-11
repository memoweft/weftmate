import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, unlinkSync, openSync, closeSync } from 'node:fs';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { managedMkdtempSync, disposeManagedTemp, startManagedTempLease } from './helpers/managed-temp.mjs';

const script = resolve('scripts/nightly/prune-temp.ps1');
const marker = '.weftmate-temp-owner.json';
const windows = { skip: process.platform !== 'win32' };
const old = () => new Date(Date.now() - 30 * 3600000).toISOString();
function owner(overrides = {}) {
  return { schemaVersion:1, pid:2147483647, processStartedAt:new Date(Date.now()-50*3600000).toISOString(),
    createdAt:new Date(Date.now()-40*3600000).toISOString(), heartbeatAt:old(), id:randomUUID(), ...overrides };
}
function fixture(root: string, name: string, record?: unknown) {
  const target = join(root,name); mkdirSync(target,{recursive:true});
  writeFileSync(join(target,'keep.txt'),'synthetic data');
  if (record) writeFileSync(join(target,marker),JSON.stringify(record));
  return target;
}
function prune(root: string, extra: string[] = ['-Apply']) {
  const result = spawnSync('pwsh',['-NoProfile','-File',script,'-Roots',root,...extra],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.error,undefined);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  return { code:result.status, stderr:result.stderr, lines, summary:lines.length ? JSON.parse(lines.at(-1)!) : null };
}
function age(target: string) {
  execFileSync('pwsh',['-NoProfile','-Command','$d=Get-Item -LiteralPath $env:PRUNE_FIXTURE; $d.CreationTime=(Get-Date).AddHours(-30); $d.LastWriteTime=(Get-Date).AddHours(-30)'],
    {env:{...process.env,PRUNE_FIXTURE:target},windowsHide:true});
}

test('automatic pruning retains similar prefixes, missing ownership, malformed records and open nested files', windows, () => {
  const root=managedMkdtempSync('weftmate-prune-unowned-');
  let fd;
  try {
    const backup=fixture(root,'weftmate-backup-important'), dotted=fixture(root,'weftmate-..-data'), malformed=fixture(root,'weftmate-invalid', {pid:process.pid});
    const active=fixture(root,'weftmate-open-file');
    mkdirSync(join(active,'sub'));const opened=join(active,'sub/open.txt');writeFileSync(opened,'synthetic active data');fd=openSync(opened,'r');
    for(const target of [backup,dotted,malformed,active]) age(target);
    const result=prune(root);
    assert.equal(result.code,0,result.stderr);assert.equal(result.summary.deleted,0);assert.equal(result.summary.keptUnowned,4);
    assert.deepEqual(result.summary.unowned.map((r: any)=>r.directory).sort(),['weftmate-backup-important','weftmate-..-data','weftmate-invalid','weftmate-open-file'].sort());
    for(const target of [backup,dotted,malformed,active,opened]) assert.ok(existsSync(target));
  } finally {if(fd!==undefined)closeSync(fd);disposeManagedTemp(root);}
});

test('automatic pruning rejects a root junction and an ancestor junction before deleting any candidate', windows, () => {
  const root=managedMkdtempSync('weftmate-prune-ancestor-');
  const alias=join(root,'alias');
  try {
    const real=join(root,'external'), parent=join(real,'container');mkdirSync(parent,{recursive:true});
    const target=fixture(parent,'weftmate-expired',owner());symlinkSync(real,alias,'junction');
    for(const unsafe of [alias,join(alias,'container')]) {
      const result=prune(unsafe);assert.notEqual(result.code,0);assert.match(result.stderr,/祖先|联接/);assert.ok(existsSync(target));
    }
  } finally {if(existsSync(alias))unlinkSync(alias);disposeManagedTemp(root);}
});

test('valid expired dead ownership deletes with per-item audit; live owner and fresh reused/tampered PID leases stay', windows, () => {
  const root=managedMkdtempSync('weftmate-prune-lease-');
  const link=join(root,'weftmate-expired','link');
  try {
    const external=join(root,'external');mkdirSync(external);writeFileSync(join(external,'keep.txt'),'outside');
    const expired=owner();fixture(root,'weftmate-expired',expired);symlinkSync(external,link,'junction');
    const live=JSON.parse(readFileSync(join(root,marker),'utf8'));fixture(root,'weftmate-live',live);
    fixture(root,'weftmate-reused-old',owner({pid:process.pid})); // A different creation time proves PID reuse.
    fixture(root,'weftmate-reused-fresh',owner({pid:process.pid,heartbeatAt:new Date().toISOString()}));
    fixture(root,'weftmate-changed-pid-fresh',owner({heartbeatAt:new Date().toISOString()}));
    fixture(root,'weftmate-malformed-time',owner({heartbeatAt:'bad date'}));
    const log=join(root,'audit.jsonl'), result=prune(root,['-Apply','-Log',log]);
    assert.equal(result.code,0,result.stderr);assert.equal(result.summary.deleted,2);assert.equal(result.summary.keptInUse,1);assert.equal(result.summary.keptRecent,2);assert.equal(result.summary.keptUnowned,1);
    const audit=readFileSync(log,'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
    const deleted=audit.filter(row=>row.result==='deleted');
    assert.deepEqual(deleted.map(row=>row.directory).sort(),['weftmate-expired','weftmate-reused-old']);
    assert.ok(deleted.every(row=>row.root===root&&row.bytes>0&&row.lastWriteTime&&row.owner.id));
    assert.equal(deleted.find(row=>row.directory==='weftmate-expired').owner.id,expired.id);
    assert.equal(readFileSync(join(external,'keep.txt'),'utf8'),'outside');
    assert.equal(existsSync(join(root,'weftmate-expired')),false);
    assert.equal(existsSync(join(root,'weftmate-reused-old')),false);
  } finally {disposeManagedTemp(root);}
});

test('denied, timed-out and empty process queries stop nonzero and delete nothing even with valid live/dead owners', windows, () => {
  const root=managedMkdtempSync('weftmate-prune-query-');
  try {
    const live=JSON.parse(readFileSync(join(root,marker),'utf8'));
    const targets=[fixture(root,'weftmate-live',live),fixture(root,'weftmate-dead',owner())];
    for(const body of ["Write-Error 'synthetic process query denied'","throw [TimeoutException]::new('synthetic timeout')",'return @()']) {
      const harness=join(root,'query.ps1');
      writeFileSync(harness,"function Get-CimInstance { "+body+" }\n& $env:PRUNER -Roots $env:PRUNE_ROOT -Apply\n");
      const result=spawnSync('pwsh',['-NoProfile','-File',harness],{encoding:'utf8',windowsHide:true,env:{...process.env,PRUNER:script,PRUNE_ROOT:root}});
      assert.notEqual(result.status,0);assert.match(result.stderr,/清理已停止/);
      for(const target of targets)assert.ok(existsSync(target));
    }
    // Also exercise the caller helper: it must propagate failure rather than report success.
    const wrapper=join(root,'bad-pwsh');
    mkdirSync(wrapper);
    writeFileSync(join(wrapper,'pwsh.cmd'),'@echo off\r\nexit /b 1\r\n');
    const source=readFileSync('tests/helpers/managed-temp.cjs','utf8');
    const context:any={module:{exports:{}},__dirname:resolve('tests/helpers'),console,process:{platform:'win32',pid:process.pid,env:{}},
      require:(name:string)=>name==='node:child_process'?{spawnSync:()=>({status:1,stderr:'synthetic denied'})}:name==='node:fs'?fs:requirePath(name)};
    vm.runInNewContext(source,context);
    assert.throws(()=>context.module.exports.pruneManagedTemps({root}),/prune failed/);
  } finally {disposeManagedTemp(root);}
});

function requirePath(name: string) { if(name==='node:path')return pathModule;throw Error('unexpected dependency '+name); }
import pathModule from 'node:path';

test('heartbeat is renewed while a runner uses a managed directory', async () => {
  const root=managedMkdtempSync('weftmate-prune-heartbeat-');
  const stop=startManagedTempLease(root,{intervalMs:20});
  try {
    const before=JSON.parse(readFileSync(join(root,marker),'utf8'));
    await new Promise(done=>setTimeout(done,100));
    const after=JSON.parse(readFileSync(join(root,marker),'utf8'));
    assert.equal(after.id,before.id);assert.equal(after.processStartedAt,before.processStartedAt);
    assert.ok(Date.parse(after.heartbeatAt)>Date.parse(before.heartbeatAt));
  } finally {stop();disposeManagedTemp(root);}
});

test('legacy plan requires an explicit list; apply only removes unchanged listed paths and rejects open files', windows, () => {
  const root=managedMkdtempSync('weftmate-prune-list-');
  let fd;
  try {
    const listed=fixture(root,'weftmate-legacy-listed'), unlisted=fixture(root,'weftmate-legacy-unlisted'), changed=fixture(root,'weftmate-legacy-changed'), active=fixture(root,'weftmate-legacy-open');
    for(const target of [listed,unlisted,changed,active])age(target);
    assert.notEqual(prune(root,['-Legacy','-Apply']).code,0);assert.ok(existsSync(listed));
    const list=join(root,'plan.json'), plan=prune(root,['-Plan','-List',list]);
    assert.equal(plan.code,0,plan.stderr);assert.equal(plan.summary.deleted,0);assert.equal(plan.summary.selected,4);
    const manifest=JSON.parse(readFileSync(list,'utf8').replace(/^\uFEFF/,''));manifest.items=manifest.items.filter((row:any)=>row.path!==unlisted);
    assert.ok(manifest.items.every((row:any)=>row.path&&row.bytes>0&&row.createdAt&&row.lastWriteTime));
    writeFileSync(list,JSON.stringify(manifest));writeFileSync(join(changed,'new.txt'),'changed after review');
    fd=openSync(join(active,'keep.txt'),'r');
    const applied=spawnSync('pwsh',['-NoProfile','-File',script,'-Apply','-List',list],{encoding:'utf8',windowsHide:true});
    const summary=JSON.parse(applied.stdout.trim().split(/\r?\n/).at(-1)!);
    assert.notEqual(applied.status,0,'open file must make the legacy deletion fail safely');
    assert.equal(summary.deleted,1,applied.stdout+applied.stderr);assert.equal(summary.keptRecent,1);assert.equal(summary.failed,1);
    assert.equal(existsSync(listed),false);for(const target of [unlisted,changed,active])assert.ok(existsSync(target));
  } finally {if(fd!==undefined)closeSync(fd);disposeManagedTemp(root);}
});

test('POSIX helper uses owner identity plus heartbeat and aborts on an incomplete process table', () => {
  const root=managedMkdtempSync('weftmate-prune-posix-');
  try {
    const expired=fixture(root,'weftmate-expired',owner()), unowned=fixture(root,'weftmate-backup-important');
    const source=readFileSync('tests/helpers/managed-temp.cjs','utf8'), audit:string[]=[];
    const context:any={module:{exports:{}},console,process:{platform:'linux',pid:77,env:{}},
      require:(name:string)=>name==='node:fs'?fs:name==='node:path'?pathModule:name==='node:child_process'?{spawnSync:()=>({status:0,stdout:'77 Sun Oct 11 07:00:00 2026\n'})}:{}};
    vm.runInNewContext(source,context);
    const result=context.module.exports.pruneManagedTemps({root,log:(line:string)=>audit.push(line)});
    assert.equal(result.deleted,1);assert.equal(result.keptUnowned,1);assert.ok(existsSync(unowned));assert.equal(existsSync(expired),false);assert.ok(audit.some(line=>JSON.parse(line).result==='deleted'));
    fixture(root,'weftmate-dead',owner());
    const emptyContext={...context,module:{exports:{}},require:(name:string)=>name==='node:fs'?fs:name==='node:path'?pathModule:name==='node:child_process'?{spawnSync:()=>({status:0,stdout:''})}:{}};
    vm.runInNewContext(source,emptyContext);
    assert.throws(()=>(emptyContext.module.exports as any).pruneManagedTemps({root}),/process query incomplete/);assert.ok(existsSync(join(root,'weftmate-dead')));
  } finally {disposeManagedTemp(root);}
});
