import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {createCipheriv} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {persistedWindowsStorageKey} from '../src/windows-vault-storage.mjs';

test('cold proof startup overlaps Chromium delayed Local State commit within the original 15s',async()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'weftmate-readiness-overlap-'));
  const originals={spawnSync:childProcess.spawnSync,execFile:childProcess.execFile,read:fs.readFileSync,now:Date.now,timer:globalThis.setTimeout};
  const key=Buffer.alloc(32,7),iv=Buffer.alloc(12,9),cipher=createCipheriv('aes-256-gcm',key,iv);
  const probe=Buffer.concat([Buffer.from('v10'),iv,cipher.update('weftmate-storage-persistence-check'),cipher.final(),cipher.getAuthTag()]);
  const file=join(root,'Local State'),state=JSON.stringify({os_crypt:{encrypted_key:'synthetic-wrapped-key'}});
  let clock=0,calls=0;const starts:number[]=[],reports:any[]=[];
  try{
    Date.now=()=>clock;
    // Chromium is an independent writer: its pending commit becomes visible at
    // t=10s. Polling and the child's cold bootstrap share a controlled clock.
    fs.readFileSync=((target:any,...args:any[])=>{
      if(target===file && clock>=10000 && !fs.existsSync(file))fs.writeFileSync(file,state);
      return (originals.read as any)(target,...args);
    }) as any;
    globalThis.setTimeout=((fn:any,delay:number)=>setImmediate(()=>{clock+=delay;fn();})) as any;
    const result=(started:number,options:any)=>{
      const completesAt=Math.max(clock,started+6000),expiresAt=started+options.timeout;
      clock=Math.min(completesAt,expiresAt);
      return completesAt<=expiresAt
        ? {status:0,signal:null,stdout:Buffer.from(key),stderr:Buffer.alloc(0)}
        : {status:null,signal:'SIGTERM',error:Object.assign(Error(),{code:'ETIMEDOUT'}),stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};
    };
    childProcess.spawnSync=((_command:any,_args:any,options:any)=>{calls++;starts.push(clock);return result(clock,options);}) as any;
    childProcess.execFile=((_command:any,_args:any,options:any,callback:any)=>{
      assert.equal(options.timeout,15000);assert.equal(options.maxBuffer,8192);
      assert.equal(JSON.stringify([_command,_args,options]).includes('synthetic-wrapped-key'),false);
      calls++;starts.push(clock);const started=clock,child:any=new EventEmitter();
      child.stdin=new EventEmitter();child.stdin.end=(input:string)=>{
        assert.equal(input,'synthetic-wrapped-key');
        const value=result(started,options);
        queueMicrotask(()=>callback(value.error??null,value.stdout,value.stderr));
      };
      child.kill=()=>true;
      return child;
    }) as any;
    syncBuiltinESMExports();
    await persistedWindowsStorageKey({isEncryptionAvailable:()=>true,encryptString:()=>Buffer.from(probe)},root,{onDiagnostic:value=>reports.push(value)});
    assert.deepEqual(starts,[0],'one proof process starts while Chromium is still committing');
    assert.equal(calls,1,'no retry or prewarming process');
    assert.equal(clock,10000,'6s child bootstrap overlaps the 10s commit instead of adding to it');
    assert.equal(reports[0].authResult,'matched');assert.equal(reports[0].fsyncSucceeded,true);
    assert.equal(fs.readFileSync(file,'utf8'),state,'only Chromium writes Local State');
  }finally{
    childProcess.spawnSync=originals.spawnSync;childProcess.execFile=originals.execFile;fs.readFileSync=originals.read;
    Date.now=originals.now;globalThis.setTimeout=originals.timer;syncBuiltinESMExports();key.fill(0);probe.fill(0);
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('a proof launch exception keeps the public readiness error and never changes Local State',async()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'weftmate-proof-launch-')),exec=childProcess.execFile;
  const file=join(root,'Local State'),state='{"os_crypt":{"encrypted_key":"synthetic"}}',reports:any[]=[];
  try{
    fs.writeFileSync(file,state);
    childProcess.execFile=(()=>{throw Object.assign(Error('synthetic-private-detail'),{code:'EACCES'});}) as any;
    syncBuiltinESMExports();
    await assert.rejects(persistedWindowsStorageKey({isEncryptionAvailable:()=>true,encryptString:()=>Buffer.from('synthetic')},root,{onDiagnostic:value=>reports.push(value)}),{code:'CREDENTIAL_STORAGE_NOT_READY'});
    assert.equal(reports[0].phase,'proof-child');assert.equal(reports[0].childError,'EACCES');
    assert.equal(reports[0].fsyncAttempted,false);assert.equal(fs.readFileSync(file,'utf8'),state);
  }finally{childProcess.execFile=exec;syncBuiltinESMExports();fs.rmSync(root,{recursive:true,force:true});}
});

test('missing Local State closes the actual waiting proof child before readiness rejects',async()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'weftmate-proof-close-')),exec=childProcess.execFile;
  let child:any,completed=false,output:Buffer|undefined;
  try{
    // Use a real Node process in place of PowerShell; it waits for stdin just
    // like the proof helper. No Electron or native encryption is needed here.
    childProcess.execFile=((_command:any,_args:any,options:any,callback:any)=>{
      child=exec(process.execPath,['-e','process.stdout.write(Buffer.alloc(32,7));process.stdin.resume();'],options,(error,stdout,stderr)=>{
        completed=true;output=stdout as unknown as Buffer;callback(error,stdout,stderr);
      });return child;
    }) as any;syncBuiltinESMExports();
    await assert.rejects(persistedWindowsStorageKey({isEncryptionAvailable:()=>true,encryptString:()=>Buffer.from('synthetic')},root,{timeoutMs:100}),{code:'CREDENTIAL_STORAGE_NOT_READY'});
    assert.equal(completed,true,'readiness must await process close even when no key was supplied');
    assert.ok(child.exitCode!==null||child.signalCode!==null);
    assert.equal(output?.every(byte=>byte===0),true,'even unused child output is wiped');
    assert.deepEqual(fs.readdirSync(root),[]);
  }finally{child?.kill();childProcess.execFile=exec;syncBuiltinESMExports();fs.rmSync(root,{recursive:true,force:true});}
});

for(const mode of ['bad-auth','late-proof'] as const)test(`${mode} cannot authorize a credential commit`,async()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'weftmate-proof-refusal-')),exec=childProcess.execFile,now=Date.now;
  const key=Buffer.alloc(32,7),iv=Buffer.alloc(12,9),cipher=createCipheriv('aes-256-gcm',key,iv);
  const probe=Buffer.concat([Buffer.from('v10'),iv,cipher.update('weftmate-storage-persistence-check'),cipher.final(),cipher.getAuthTag()]);
  let clock=0,output:Buffer|undefined;const reports:any[]=[];
  try{
    const state='{"os_crypt":{"encrypted_key":"synthetic"}}';
    fs.writeFileSync(join(root,'Local State'),state);fs.writeFileSync(join(root,'weftmate-model.enc'),'synthetic-existing-ciphertext');
    Date.now=()=>clock;
    childProcess.execFile=((_command:any,_args:any,_options:any,callback:any)=>{
      const child:any=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>true;
      child.stdin.end=()=>queueMicrotask(()=>{
        clock=15000;output=mode==='bad-auth'?Buffer.alloc(32,8):Buffer.from(key);
        callback(null,output,Buffer.alloc(0));
      });return child;
    }) as any;syncBuiltinESMExports();
    await assert.rejects(persistedWindowsStorageKey({isEncryptionAvailable:()=>true,encryptString:()=>Buffer.from(probe)},root,{onDiagnostic:value=>reports.push(value)}),{code:'CREDENTIAL_STORAGE_NOT_READY'});
    assert.equal(reports[0].authResult,mode==='bad-auth'?'failed':'matched');
    assert.equal(reports[0].fsyncAttempted,false);assert.equal(reports[0].proofAttempts,1);
    assert.equal(output?.every(byte=>byte===0),true);
    assert.equal(fs.readFileSync(join(root,'Local State'),'utf8'),state);
    assert.equal(fs.readFileSync(join(root,'weftmate-model.enc'),'utf8'),'synthetic-existing-ciphertext');
  }finally{Date.now=now;childProcess.execFile=exec;syncBuiltinESMExports();key.fill(0);probe.fill(0);fs.rmSync(root,{recursive:true,force:true});}
});
