import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('BL-29b M5 real tray/update shutdown and both runtime orders drain protocol waits', {timeout:120000}, () => {
  const root = mkdtempSync(join(tmpdir(), 'bl29-runtime-close-'));
  try {
    const env = {...process.env, BL29_EVIDENCE_DIR:root, WEFTMATE_TEST_HOST_NAME:'synthetic-host'};
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(process.execPath, ['tests/integration/bl29-rework/probe-exit.mjs','--head-only'], {
      env, windowsHide:true, encoding:'utf8',timeout:110000,maxBuffer:8*1024*1024,
    });
    assert.equal(run.status, 0, [run.error?.message,run.stderr,run.stdout].filter(Boolean).join('\n'));
    const rows = JSON.parse(readFileSync(join(root, 'exit.json'), 'utf8'));
    assert.equal(rows.length, 5);
    for (const row of rows) {
      assert.equal(row.error, undefined, JSON.stringify(row));
      assert.equal(row.exitCode, 0); assert.ok(row.ms<1000, JSON.stringify(row));
      if (row.method.endsWith('first')) {
        assert.ok(row.accessCloseMs<500, JSON.stringify(row));assert.ok(row.runtimeCloseMs<1000, JSON.stringify(row));
        assert.equal(row.gatewayWait.status, 503, JSON.stringify(row));
        assert.equal(row.gatewayWait.body.error.code, 'SERVICE_CLOSING');
        assert.ok(row.pendingWaitRequests>0, 'host UI really held a reply wait');
      }
    }
  } finally {rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
