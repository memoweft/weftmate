import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { durableReplace, readWrappedStorageKey, persistWrappedStorageKey, restoreVaultLocalState } from '../src/windows-vault-storage.mjs';
test('interrupted Chromium state can be restored from the prior durable protected key without discarding preferences or changing ciphertext',{skip:process.platform!=='win32'},()=>{
  const root=mkdtempSync(join(tmpdir(),'weftmate-rob1-state-'));
  try {
    const wrapped=Buffer.from('DPAPIsynthetic-wrapped-material').toString('base64');
    const ciphertext=Buffer.from('v10synthetic-encrypted-material');
    persistWrappedStorageKey(root,wrapped);assert.equal(readWrappedStorageKey(root),wrapped);
    durableReplace(join(root,'weftmate-model.enc'),ciphertext);
    writeFileSync(join(root,'Local State'),JSON.stringify({syntheticPreference:42,os_crypt:{encrypted_key:'stale'}}));
    restoreVaultLocalState(root);const state=JSON.parse(readFileSync(join(root,'Local State'),'utf8'));
    assert.equal(state.syntheticPreference,42);assert.equal(state.os_crypt.encrypted_key,wrapped);
    rmSync(join(root,'Local State'));restoreVaultLocalState(root);
    assert.equal(JSON.parse(readFileSync(join(root,'Local State'),'utf8')).os_crypt.encrypted_key,wrapped);
    assert.deepEqual(readFileSync(join(root,'weftmate-model.enc')),ciphertext);
    const original=readFileSync(join(root,'weftmate-storage-key.json'));
    const next=Buffer.from('DPAPIsynthetic-next-material').toString('base64');
    persistWrappedStorageKey(root,next);
    assert.equal(readWrappedStorageKey(root),next);
    const previous=readdirSync(root).filter(name=>name.startsWith('weftmate-storage-key.json.previous-'));
    assert.equal(previous.length,1);assert.deepEqual(readFileSync(join(root,previous[0])),original);
    writeFileSync(join(root,'weftmate-storage-key.json'),'{}');assert.throws(()=>readWrappedStorageKey(root));
  } finally {rmSync(root,{recursive:true,force:true});}
});
