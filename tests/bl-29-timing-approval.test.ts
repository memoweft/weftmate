import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { cleanupOwnedProcesses, redactEvidenceText } from './helpers/process-evidence.mjs';


test('BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s', {timeout:30000}, () => {
  const root=mkdtempSync(join(tmpdir(),'weftmate-bl29-decision-')),startedAt=Date.now();
  try {
    const env={...process.env,TMPDIR:root,TMP:root,TEMP:root,WEFTMATE_TEST_HOST_NAME:'synthetic-host',WEFTMATE_BL29_EVIDENCE_DIR:root};
    delete env.ELECTRON_RUN_AS_NODE;
    const run=spawnSync(process.execPath,[`--report-directory=${root}`,'tests/integration/bl-29-requests.mjs','--logical','--latency','--approval-commit-delay'],{
      env,encoding:'utf8',windowsHide:true,timeout:25000,maxBuffer:4*1024*1024,
    });
    assert.equal(run.status,0,JSON.stringify({status:run.status,signal:run.signal,
      error:run.error?.message?redactEvidenceText(run.error.message):undefined,
      stdout:redactEvidenceText(run.stdout||''),stderr:redactEvidenceText(run.stderr||'')},null,2));
    const r=JSON.parse(readFileSync(join(root,'responsiveness.json'),'utf8'));
    assert.equal(r.failure,undefined);
    for(const name of ['approval-visible','approval-accepted','question-visible','question-accepted']){
      const check=r.checks.find(row=>row.name===name);assert.ok(check,`${name} really ran`);assert.ok(check.ms<=2000,JSON.stringify(check));
    }
  } finally {
    if(process.platform==='win32') {
      const cleanup=cleanupOwnedProcesses({startedAt,commandRoots:[root],executables:[process.execPath,createRequire(import.meta.url)('electron')]});
      assert.equal(cleanup.available,true,'approval probe process cleanup must be available');
      assert.equal(cleanup.failed,0,'approval probe must not leave its owned processes running');
    }
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
