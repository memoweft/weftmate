import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createCipheriv} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {persistedWindowsStorageKey} from '../src/windows-vault-storage.mjs';

async function scenario(mode:'child-timeout'|'fsync-denied'|'success'|'first-false',body:(value:any)=>Promise<void>){
  const root=fs.mkdtempSync(join(tmpdir(),'weftmate-readiness-diagnostic-')),file=join(root,'Local State');
  const exec=childProcess.execFile,fsync=fs.fsyncSync,now=Date.now;
  const key=Buffer.alloc(32,7),iv=Buffer.alloc(12,9),cipher=createCipheriv('aes-256-gcm',key,iv);
  const probe=Buffer.concat([Buffer.from('v10'),iv,cipher.update('weftmate-storage-persistence-check'),cipher.final(),cipher.getAuthTag()]);
  const wrapped='synthetic-private-wrapped-material',childText='synthetic-private-child-text';
  const original=Buffer.from(JSON.stringify({os_crypt:{encrypted_key:wrapped}}));
  const counts={available:0,encrypt:0,child:0,fsync:0},records:any[]=[];let clock=0,childTimeout=0;
  try{
    fs.writeFileSync(file,original);Date.now=()=>clock;
    childProcess.execFile=((_command,_args,options:any,callback:any)=>{
      counts.child++;childTimeout=options.timeout;
      const child:any=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>true;
      child.stdin.end=()=>queueMicrotask(()=>{
        if(mode==='child-timeout'){
          clock+=options.timeout;
          callback(Object.assign(new Error(childText),{killed:true,signal:'SIGTERM'}),Buffer.alloc(0),Buffer.from(childText));
        }else callback(null,Buffer.from(key),Buffer.from(childText));
      });
      return child;
    }) as any;
    fs.fsyncSync=((fd:number)=>{counts.fsync++;if(mode==='fsync-denied')throw Object.assign(new Error(childText),{code:'EACCES'});return fsync(fd);}) as any;
    syncBuiltinESMExports();
    const storage={isEncryptionAvailable:()=>{counts.available++;return mode!=='first-false'||counts.available>1;},encryptString:()=>{counts.encrypt++;return Buffer.from(probe);}};
    await body({run:(onDiagnostic=(value:any)=>records.push(value))=>persistedWindowsStorageKey(storage,root,{onDiagnostic} as any),records,counts,get childTimeout(){return childTimeout;},wrapped,childText});
    assert.equal(fs.readFileSync(file).equals(original),true,'readiness must not change Local State');
  }finally{childProcess.execFile=exec;fs.fsyncSync=fsync;Date.now=now;syncBuiltinESMExports();key.fill(0);probe.fill(0);fs.rmSync(root,{recursive:true,force:true});}
}

test('readiness diagnostics identify a child timeout without exposing child text',async()=>{
  await scenario('child-timeout',async value=>{
    await assert.rejects(value.run(),{code:'CREDENTIAL_STORAGE_NOT_READY'});
    assert.equal(value.records.length,1,'the original failure needs one safe terminal diagnostic');
    const report=value.records[0];
    assert.equal(report.phase,'proof-child');assert.equal(report.outcome,'deadline');
    assert.equal(report.childError,'ETIMEDOUT');assert.equal(report.childTimedOut,true);
    assert.equal(report.childTimeoutMs,15000);assert.equal(value.childTimeout,15000);
    assert.equal(report.childStatus,null);assert.equal(report.childSignal,'SIGTERM');
    assert.equal(report.childStderrBytes>0,true);
    assert.equal([value.wrapped,value.childText].some(text=>JSON.stringify(report).includes(text)),false);
    assert.deepEqual(value.counts,{available:1,encrypt:1,child:1,fsync:0});
  });
});

test('readiness diagnostics do not consume an additional availability or crypto call',async()=>{
  await scenario('first-false',async value=>{
    await value.run();const report=value.records[0];
    assert.equal(report.outcome,'ready');assert.equal(report.phase,'complete');
    assert.equal(report.availabilityChecks,2);assert.equal(report.lastAvailability,true);
    assert.equal(report.authResult,'matched');assert.equal(report.fsyncSucceeded,true);assert.equal(report.closeSucceeded,true);
    assert.deepEqual(value.counts,{available:2,encrypt:1,child:1,fsync:1});
    assert.equal(Object.isFrozen(report),true);
  });
});

test('readiness observer failures cannot replace success or the original failure',async()=>{
  for(const mode of ['success','child-timeout'] as const)await scenario(mode,async value=>{
    let called=0;const run=value.run(()=>{called++;throw Error('synthetic-output-unavailable');});
    if(mode==='success')await run;else await assert.rejects(run,{code:'CREDENTIAL_STORAGE_NOT_READY'});
    assert.equal(called,1);assert.equal(value.counts.child,1);
  });
  await scenario('success',async value=>{
    await value.run(()=>Promise.reject(Error('synthetic-output-unavailable')));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(value.counts.child,1);
  });
});

test('readiness diagnostics identify fsync refusal after a valid proof without changing the public error',async()=>{
  await scenario('fsync-denied',async value=>{
    await assert.rejects(value.run(),{code:'CREDENTIAL_STORAGE_NOT_READY'});
    assert.equal(value.records.length,1,'the original failure needs one safe terminal diagnostic');
    const report=value.records[0];
    assert.equal(report.phase,'local-state-fsync');assert.equal(report.outcome,'exception');
    assert.equal(report.exceptionCode,'EACCES');assert.equal(report.authResult,'matched');
    assert.equal(report.fsyncAttempted,true);assert.equal(report.fsyncSucceeded,false);assert.equal(report.closeSucceeded,true);
    assert.equal([value.wrapped,value.childText].some(text=>JSON.stringify(report).includes(text)),false);
    assert.deepEqual(value.counts,{available:1,encrypt:1,child:1,fsync:1});
  });
});
