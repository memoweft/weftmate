import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tamperCiphertext } from './helpers/tamper-ciphertext.mjs';
import { openTask } from '../src/personal-offline/crypto.mjs';
import { invokeProjectReader } from '../src/personal-projects/index.mjs';
import { managedMkdtempSync, disposeManagedTemp } from './helpers/managed-temp.mjs';
import { waitForCommand } from './helpers/wait-for-command.mjs';
import { runManagedTestProcess } from './helpers/managed-test-process.mjs';
import { phasedTestProcess } from './helpers/phased-test-process.mjs';
import {waitForPublishedText} from './helpers/wait-for-published-text.mjs';

test('foreground timing waits for the exact published reply instead of a synthetic append or old projection',async()=>{
  let reads=0;
  const page=await waitForPublishedText(async()=>({upserts:[{data:{content:[{text:++reads<3?'old reply':'exact new reply'}]}}]}),'exact new reply');
  assert.equal(reads,3);assert.equal(page.upserts[0].data.content[0].text,'exact new reply');
});

test('fixed authenticated ciphertext survives the old A/B replacement but byte tampering always rejects', () => {
  const {envelope,recipient,identity,payload}=JSON.parse(readFileSync('tests/fixtures/ci-3/fixed-ciphertext.json','utf8'));
  const old='A'+envelope.ciphertext.slice(1,-1)+'B';
  assert.deepEqual(Buffer.from(old,'base64url'),Buffer.from(envelope.ciphertext,'base64url'));
  assert.deepEqual(openTask({...envelope,ciphertext:old},recipient,identity),payload);
  const changed=tamperCiphertext(envelope.ciphertext);
  assert.notDeepEqual(Buffer.from(changed,'base64url'),Buffer.from(envelope.ciphertext,'base64url'));
  assert.throws(()=>openTask({...envelope,ciphertext:changed},recipient,identity),{code:'OFFLINE_TASK_INVALID'});
});

function readerFixture(){
  const child:any=new EventEmitter(); child.stdin=new Writable({write(_chunk,_enc,next){next();}});
  child.stdout=new PassThrough();child.stderr=new PassThrough();let killed=false,clock=0;
  child.kill=()=>{killed=true;};const timers:any[]=[];
  const work=invokeProjectReader({}, {spawnProcess:()=>child,now:()=>clock,
    setTimer:(fn,ms)=>{const timer={fn,at:clock+ms,active:true};timers.push(timer);return timer;},clearTimer:t=>{t.active=false;}});
  const advance=(ms:number)=>{clock+=ms;for(const timer of timers)if(timer.active&&timer.at<=clock){timer.active=false;timer.fn();}};
  return {child,work,advance,get killed(){return killed}};
}
test('project reader excludes initialization from its existing 15s operation budget and never retries', async()=>{
  const f=readerFixture();f.advance(10000);f.child.stdout.write('WEFTMATE_PROJECT_');
  f.child.stdout.write('READER_READY\r\n');f.advance(10000);
  assert.equal(f.killed,false,'20s combined work with each phase below 15s must still be running');
  f.child.stdout.write(JSON.stringify({ok:true,value:'exact bounded read'}));f.child.emit('close',0);
  assert.equal(await f.work,'exact bounded read');
});
test('a 16s cold initialization does not fail before the exact project operation starts',async()=>{
  const f=readerFixture();f.advance(16000);assert.equal(f.killed,false);
  f.child.stdout.write('WEFTMATE_PROJECT_READER_READY\n');f.advance(1000);
  f.child.stdout.write(JSON.stringify({ok:true,value:'exact bounded read'}));f.child.emit('close',0);
  assert.equal(await f.work,'exact bounded read');
});
test('project reader still terminates bounded initialization or 15s operation with phase evidence',async()=>{
  for(const ready of [false,true]){
    const f=readerFixture();if(ready)f.child.stdout.write('WEFTMATE_PROJECT_READER_READY\n');
    const rejected=assert.rejects(f.work,(error:any)=>error.code==='PROJECT_READER_TIMEOUT'&&error.readerEvidence.phase===(ready?'operation':'initialization'));
    f.advance(ready?15000:30000);await rejected;assert.equal(f.killed,true);
  }
});
test('inherited managed temp scopes never overwrite the creator heartbeat',()=>{
  const root=managedMkdtempSync('ci3-single-heartbeat-');
  try{
    const owner=resolve(root,'.weftmate-temp-owner.json'),before=readFileSync(owner,'utf8');
    const script=`import {startManagedTempLease} from ${JSON.stringify(pathToFileURL(resolve('tests/helpers/managed-temp.mjs')).href)}; const stop=startManagedTempLease(${JSON.stringify(root)},{intervalMs:1}); stop();`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,WEFTMATE_MANAGED_TEMP_ROOT:dirname(root),WEFTMATE_TEST_TEMP_SCOPE:root},encoding:'utf8',windowsHide:true});
    assert.equal(child.status,0,child.stderr);assert.equal(readFileSync(owner,'utf8'),before);
  }finally{disposeManagedTemp(root);}
});

test('owned temp disposal cannot expose partial asynchronous deletion to its heartbeat',()=>{
  const helper=pathToFileURL(resolve('tests/helpers/managed-temp.mjs')).href;
  for(const partial of [true,false]){
    const script=`import fs from 'node:fs';import {join} from 'node:path';
      import {managedMkdtempSync,startManagedTempLease,disposeManagedTemp} from ${JSON.stringify(helper)};
      const root=managedMkdtempSync('ci3-partial-delete-');startManagedTempLease(root,{intervalMs:1});
      if(${partial}){
        const failed=new Promise(resolve=>{const error=console.error;console.error=(...args)=>{error(...args);if(String(args[0]).startsWith('Managed temp heartbeat failed:'))resolve();};});
        const hold=setInterval(()=>{},10000);
        fs.unlinkSync(join(root,'.weftmate-temp-owner.json'));await failed;clearInterval(hold);fs.rmdirSync(root);
      }else disposeManagedTemp(root);`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true,timeout:20000,killSignal:'SIGKILL'});
    assert.ifError(child.error);assert.equal(child.status,partial?1:0,child.stderr);
    if(partial)assert.match(child.stderr,/Managed temp lease ownership changed/);
  }
});
test('synthetic command acceptance waits through more than 100 observations and fails on terminal rejection',async()=>{
  let reads=0;
  const row=await waitForCommand(async()=>({state:++reads>100?'accepted_by_dsh':'pending'}));
  assert.equal(row.state,'accepted_by_dsh');assert.equal(reads,101);
  await assert.rejects(waitForCommand(async()=>({state:'rejected',code:'synthetic-failure'})),/terminal state.*synthetic-failure/);
});
test('a child with no assertion output retains nonzero exit and its final stderr in process evidence',async()=>{
  const result=await runManagedTestProcess(process.execPath,['-e','process.stderr.write("synthetic last cause");process.exit(7)']);
  assert.equal(result.status,7);assert.equal(result.evidence.decimal,7);assert.equal(result.evidence.signal,null);
  assert.equal(result.evidence.stderrTail,'synthetic last cause');assert.ok(result.evidence.systemCommit);
});
test('a prepared probe ignoring SIGTERM still returns a hard deadline failure and closes its pipes', {timeout:4000}, async t=>{
  const probe=phasedTestProcess(process.execPath,['-e',`process.on('SIGTERM',()=>{});process.send({phase:'ready'});process.on('message',()=>{});setInterval(()=>{},1000);`]);
  t.after(async()=>{if(probe.child.exitCode===null&&probe.child.signalCode===null)probe.child.kill('SIGKILL');await probe.done;});
  await probe.ready();
  await assert.rejects(probe.run(100),/SIGKILL/);
  const exit=await probe.done;assert.equal(exit.signal,'SIGKILL');
});
