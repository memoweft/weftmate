import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

test('native desktop disclosure, section states and switch inventory use interruptible shared motion', {timeout:240000,skip:process.platform!=='win32'},()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const output=resolve(env.WEFTMATE_MOTION2_OUTPUT||'.local/evidence/ui-motion-2');mkdirSync(output,{recursive:true});
  const startedAt=new Date().toISOString();writeFileSync(join(output,'runner.json'),JSON.stringify({startedAt,status:'starting',node:process.version,cwd:process.cwd()}));
  const run=spawnSync(process.execPath,['tests/integration/ui-motion-2.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:230000,maxBuffer:2*1024*1024});
  writeFileSync(join(output,'runner.json'),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),node:process.version,status:run.status,signal:run.signal,error:run.error?.message,stdout:run.stdout,stderr:run.stderr},null,2));
  assert.ifError(run.error);assert.equal(run.status,0,run.stderr||run.stdout);
});
