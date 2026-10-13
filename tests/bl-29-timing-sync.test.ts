import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {phasedTestProcess} from './helpers/phased-test-process.mjs';
import {cleanupOwnedProcesses} from './helpers/process-evidence.mjs';
const root=mkdtempSync(join(tmpdir(),'weftmate-bl29-sync-')),startedAt=Date.now();let probe;
before(async()=>{
  const env={...process.env,TMPDIR:root,TMP:root,TEMP:root,BL29_EVIDENCE_DIR:root,WEFTMATE_TEST_HOST_NAME:'synthetic-host'};
  delete env.ELECTRON_RUN_AS_NODE;
  probe=phasedTestProcess(process.execPath,[`--report-directory=${root}`,'tests/integration/bl29-rework/probe-latency.mjs','--phased'],{env,roots:[root]});
  await probe.ready();
});


test('BL-29b M4/S1 real Electron and mobile synchronize settings and regain foreground under 200ms transport', {timeout:60000}, async () => {
  const {report:r}=await probe.run(55000);
  assert.equal(r.failure, undefined);
  for (const row of r.rows) {
    assert.equal(row.error, undefined);
    if (row.kind === 'rename') {assert.ok(row.desktop<=6000, JSON.stringify(row));assert.ok(row.mobile<=6000, JSON.stringify(row));}
    else assert.ok(row.ms<=1000, JSON.stringify(row));
  }
  assert.equal(r.electronConfig.suggestions, false); assert.equal(r.mobileConfig.suggestions, false);
  assert.ok(r.electronConfig.models.includes('added-electron')); assert.ok(r.mobileConfig.models.includes('added-electron'));
  for (const row of r.configurationTimes) assert.ok(row.ms<=7000, JSON.stringify(row));
});
after(async()=>{
  try{
    const exit=await probe?.done;
    if(exit)console.log('BL-29 sync phases:',JSON.stringify({stages:exit.evidence.stages,lifecycle:exit.evidence.stdout.split('\n').filter(line=>line.startsWith('[probe-latency]')),exitCode:exit.code,signal:exit.signal}));
    if(exit)assert.equal(exit.code,0,JSON.stringify(exit.evidence));
  }finally{
    if(process.platform==='win32'){
      const cleanup=cleanupOwnedProcesses({startedAt,commandRoots:[root],executables:[process.execPath,createRequire(import.meta.url)('electron')]});
      assert.equal(cleanup.available,true);assert.equal(cleanup.failed,0);
    }
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
