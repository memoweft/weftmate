import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createCipheriv } from 'node:crypto';
import childProcess from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { durableReplace, persistedWindowsStorageKey, cleanupVaultTemporaries } from '../src/windows-vault-storage.mjs';

test('a valid DPAPI proof taking over 3s uses the remaining 15s readiness budget once',async()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'weftmate-rob1-slow-proof-'));
  const exec=childProcess.execFile,now=Date.now,key=Buffer.alloc(32,7),iv=Buffer.alloc(12,9);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const probe=Buffer.concat([Buffer.from('v10'),iv,cipher.update('weftmate-storage-persistence-check'),cipher.final(),cipher.getAuthTag()]);
  let clock=0,calls=0;
  try{
    fs.writeFileSync(join(root,'Local State'),JSON.stringify({os_crypt:{encrypted_key:'synthetic-wrapped-key'}}));
    Date.now=()=>clock;
    childProcess.execFile=((_cmd,_args,options:any,callback:any)=>{calls++;
      const child:any=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>true;
      child.stdin.end=()=>queueMicrotask(()=>{clock+=3001;
        callback(options.timeout>=3001?null:Object.assign(Error(),{killed:true,signal:'SIGTERM'}),Buffer.from(key),Buffer.alloc(0));
      });
      return child;
    }) as any;syncBuiltinESMExports();
    await persistedWindowsStorageKey({isEncryptionAvailable:()=>true,encryptString:()=>Buffer.from(probe)},root);
    assert.equal(calls,1,'the valid proof must complete once rather than being killed every 3 seconds');
    assert.equal(clock,3001);
  }finally{childProcess.execFile=exec;Date.now=now;syncBuiltinESMExports();key.fill(0);fs.rmSync(root,{recursive:true,force:true});}
});
test('storage readiness timeout preserves Local State, ciphertext and residual old recovery files', async () => {
  const root=fs.mkdtempSync(join(tmpdir(),'weftmate-rob1-state-'));
  try {
    const state=Buffer.from('{"os_crypt":{"encrypted_key":"UNKNOWN_FORMAT"},"preference":42}');
    fs.writeFileSync(join(root,'Local State'),state);
    fs.writeFileSync(join(root,'weftmate-model.enc'), 'synthetic opaque bytes');
    fs.writeFileSync(join(root,'weftmate-storage-key.json'), '{"version":1,"wrappedKey":"old"}');
    const names=fs.readdirSync(root), before=names.map(name=>fs.readFileSync(join(root,name)));
    await assert.rejects(persistedWindowsStorageKey({isEncryptionAvailable:()=>true,encryptString:()=>Buffer.from('v10synthetic')},root,{timeoutMs:25}),{code:'CREDENTIAL_STORAGE_NOT_READY'});
    assert.deepEqual(fs.readdirSync(root),names);
    names.forEach((name,i)=>assert.deepEqual(fs.readFileSync(join(root,name)),before[i]));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('abandoned ciphertext temporary cleanup only removes this module old regular files', () => {
  const root=fs.mkdtempSync(join(tmpdir(),'weftmate-rob1-tmp-')), now=Date.now();
  try {
    const old=`weftmate-model.enc.123.${randomUUID()}.tmp`, fresh=`weftmate-model.enc.456.${randomUUID()}.tmp`;
    for (const name of [old,fresh,'weftmate-model.enc.foreign.tmp','other.enc.123.tmp','weftmate-model.enc']) fs.writeFileSync(join(root,name),'synthetic');
    fs.utimesSync(join(root,old),(now-7200000)/1000,(now-7200000)/1000);
    cleanupVaultTemporaries(root,now);
    assert.deepEqual(fs.readdirSync(root).sort(),[fresh,'weftmate-model.enc.foreign.tmp','other.enc.123.tmp','weftmate-model.enc'].sort());
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('ciphertext atomic replacement keeps old complete bytes on partial write or rename failure', () => {
  const root=fs.mkdtempSync(join(tmpdir(),'weftmate-rob1-atomic-')), file=join(root,'weftmate-model.enc');
  const write=fs.writeFileSync, rename=fs.renameSync;
  try {
    write(file,'synthetic old complete bytes');
    for(const code of ['ENOSPC','EACCES']) {
      if(code==='ENOSPC') fs.writeFileSync=((target,bytes,options)=>{write(target,Buffer.from(bytes as any).subarray(0,2),options);throw Object.assign(Error(),{code});}) as typeof fs.writeFileSync;
      else fs.renameSync=(()=>{throw Object.assign(Error(),{code});}) as typeof fs.renameSync;
      syncBuiltinESMExports();
      assert.throws(()=>durableReplace(file,Buffer.from('synthetic new complete bytes')),{code});
      fs.writeFileSync=write;fs.renameSync=rename;syncBuiltinESMExports();
      assert.equal(fs.readFileSync(file,'utf8'),'synthetic old complete bytes'); assert.deepEqual(fs.readdirSync(root),['weftmate-model.enc']);
    }
  } finally {fs.writeFileSync=write;fs.renameSync=rename;syncBuiltinESMExports();fs.rmSync(root,{recursive:true,force:true});}
});
