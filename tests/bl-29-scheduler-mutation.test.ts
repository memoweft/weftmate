import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('BL-29c S6 zero-delay-only and full request-storm mutations both fail the production mobile budget',()=>{
  const root=mkdtempSync(join(tmpdir(),'weftmate-bl29-mutation-'));
  try {
    for (const fullStorm of [false,true]) {
      const env={...process.env,BL29_EVIDENCE_DIR:root};
      delete env.NODE_TEST_CONTEXT;
      const generate=spawnSync(process.execPath,['tests/integration/bl29-rework/make-mutation.mjs',...(fullStorm?['--old-storm']:[])],{env,encoding:'utf8',windowsHide:true});
      assert.equal(generate.status,0,generate.stderr);
      const run=spawnSync(process.execPath,['--test','--test-name-pattern=BL-29b full empty logical',join(root,'zero-delay.test.mjs')],{env,encoding:'utf8',windowsHide:true,timeout:15000});
      assert.equal(run.status,1,run.stdout+run.stderr);
      assert.match(run.stdout+run.stderr,fullStorm?/BACKEND_UNAVAILABLE: 600 changes \/ 30s/:/BACKEND_UNAVAILABLE: scheduler 600 executions \/ 30s/);
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
