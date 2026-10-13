import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { cleanupOwnedProcesses } from './helpers/process-evidence.mjs';
import { phasedTestProcess } from './helpers/phased-test-process.mjs';


const root=mkdtempSync(join(tmpdir(),'weftmate-bl29-decision-')),startedAt=Date.now();
let probe;
before(async () => {
    const env={...process.env,TMPDIR:root,TMP:root,TEMP:root,WEFTMATE_TEST_HOST_NAME:'synthetic-host',WEFTMATE_BL29_EVIDENCE_DIR:root};
    delete env.ELECTRON_RUN_AS_NODE;
    probe=phasedTestProcess(process.execPath,[`--report-directory=${root}`,'tests/integration/bl-29-requests.mjs','--logical','--latency','--approval-commit-delay','--phased'],{env,roots:[root]});
    await probe.ready();
});
test('BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s', {timeout:30000}, async () => {
    const {report:r}=await probe.run(25000);
    assert.equal(r.failure,undefined);
    for(const name of ['approval-visible','approval-accepted','question-visible','question-accepted']){
      const check=r.checks.find(row=>row.name===name);assert.ok(check,`${name} really ran`);assert.ok(check.ms<=2000,JSON.stringify(check));
    }
});
after(async () => {
  try {
    const exit=await probe?.done;
    if(exit)console.log('BL-29 phased process:',JSON.stringify({stages:exit.evidence.stages,exitCode:exit.code,signal:exit.signal}));
    if(exit)assert.equal(exit.code,0,JSON.stringify(exit.evidence));
  } finally {
    if(process.platform==='win32') {
      const cleanup=cleanupOwnedProcesses({startedAt,commandRoots:[root],executables:[process.execPath,createRequire(import.meta.url)('electron')]});
      assert.equal(cleanup.available,true,'approval probe process cleanup must be available');
      assert.equal(cleanup.failed,0,'approval probe must not leave its owned processes running');
    }
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
