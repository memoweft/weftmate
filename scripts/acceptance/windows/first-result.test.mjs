import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {recordFirst} from './first-result.mjs';
test('a failed or completed first trial cannot be replaced by a rescue attempt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'weft-first-'));
 try{
  let calls=0;
  const first=await recordFirst(root,'M1-1',async()=>{calls++;throw Error('first answer unknown');});
  assert.equal(first.state,'failed');
  await assert.rejects(recordFirst(root,'M1-1',async()=>{calls++;return 'red tea';}),{code:'EEXIST'});
  assert.equal(calls,1);assert.match(await readFile(join(root,'first-M1-1.json'),'utf8'),/first answer unknown/);
  await recordFirst(root,'M1-2',async()=>{calls++;return 'independent trial';});assert.equal(calls,2);
 }finally{
  const target=await realpath(root);assert.equal(dirname(target),await realpath(tmpdir()));assert.match(basename(target),/^weft-first-[\w-]+$/);
  await rm(target,{recursive:true,force:true});
 }
});
