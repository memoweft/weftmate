import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {managedMkdtempSync,disposeManagedTemp} from './helpers/managed-temp.mjs';

test('owned temporary cleanup detaches nested directory links and preserves their external target',()=>{
  const target=mkdtempSync(join(tmpdir(),'wm-link-target-'));
  const root=managedMkdtempSync('weftmate-link-cleanup-');
  const sentinel=join(target,'keep.txt');writeFileSync(sentinel,'synthetic external target');
  const nested=join(root,'nested');mkdirSync(nested);
  symlinkSync(target,join(nested,'target'),process.platform==='win32'?'junction':'dir');
  const vanished=join(target,'gone');mkdirSync(vanished);
  symlinkSync(vanished,join(nested,'dangling'),process.platform==='win32'?'junction':'dir');
  rmSync(vanished,{recursive:true,force:true});
  try{disposeManagedTemp(root,{log:()=>{}});assert.equal(existsSync(root),false);assert.equal(readFileSync(sentinel,'utf8'),'synthetic external target');}
  finally{if(existsSync(root))disposeManagedTemp(root,{log:()=>{}});rmSync(target,{recursive:true,force:true});}
});
