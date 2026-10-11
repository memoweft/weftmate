import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { durableReplace, persistedWindowsStorageKey, cleanupVaultTemporaries } from '../src/windows-vault-storage.mjs';
test('storage readiness timeout preserves Local State, ciphertext and residual old recovery files', async () => {
  const root=fs.mkdtempSync(join(tmpdir(),'weftmate-rob1-state-'));
  try {
    const state=Buffer.from('{"os_crypt":{"encrypted_key":"UNKNOWN_FORMAT"},"preference":42}');
    fs.writeFileSync(join(root,'Local State'),state);
    fs.writeFileSync(join(root,'weftmate-model.enc'), 'synthetic opaque bytes');
    fs.writeFileSync(join(root,'weftmate-storage-key.json'), '{"version":1,"wrappedKey":"old"}');
    const names=fs.readdirSync(root), before=names.map(name=>fs.readFileSync(join(root,name)));
    await assert.rejects(persistedWindowsStorageKey({encryptString:()=>Buffer.from('v10synthetic')},root,{timeoutMs:25}),{code:'CREDENTIAL_STORAGE_NOT_READY'});
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
