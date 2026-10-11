import test from 'node:test';
import assert from 'node:assert/strict';
import { superviseExit } from './integration/bl29-rework/exit-supervisor.mjs';

test('BL-29b M5 real tray/update shutdown and both runtime orders drain protocol waits', {timeout:120000}, async t => {
    const run = await superviseExit();
    t.diagnostic(JSON.stringify({kind:'exit-five',rows:run.rows,registeredProcesses:run.registeredProcesses,
      cleanup:run.cleanup,remaining:run.remaining,lastStage:run.lastStage,resources:run.resources}));
    assert.equal(run.status, 0, JSON.stringify(run));
    const rows = run.rows;
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
    assert.equal(run.remaining,0);assert.equal(run.rootRemoved,true);
    assert.equal(run.registeredProcesses.length,5,'each launch records PID, executable, creation time and owned profile');
    for(const row of run.registeredProcesses){assert.ok(row.pid>0);assert.ok(row.createdAt);assert.ok(row.executable);assert.ok(row.profile.startsWith('%TEMP%/weftmate-'));}
});

test('BL-29c N5 parent cleans the whole owned Electron set when the driver is terminated after first window', {timeout:60000}, async t => {
  const run = await superviseExit({args:['--head-only','--methods=tray-exit'],abortAtStage:'first-window',timeout:45000});
  assert.notEqual(run.status,0,JSON.stringify(run));
  assert.equal(run.lastStage.stage,'first-window');
  assert.ok(run.cleanup.killed.length>0,'forced termination leaves real Electron children for parent cleanup');
  assert.equal(run.remaining,0);assert.equal(run.rootRemoved,true);
  assert.ok(run.resources.memory);assert.ok(run.resources.tcp);
  if(process.platform==='win32')assert.ok(run.resources.memory.committedBytes>0&&run.resources.memory.limitBytes>run.resources.memory.committedBytes);
  t.diagnostic(JSON.stringify({kind:'exit-driver-killed',status:run.status,hex:run.hex,signal:run.signal,lastStage:run.lastStage,resources:run.resources,cleanup:run.cleanup,remaining:run.remaining}));
});

test('BL-29c N5 parent deadline cleans owned children without retrying or changing product limits', {timeout:60000}, async t => {
  const run=await superviseExit({args:['--head-only','--methods=tray-exit'],abortAtStage:'first-window',timeoutAfterStage:20,timeout:45000});
  assert.equal(run.timedOut,true);assert.notEqual(run.status,0);
  assert.ok(run.cleanup.killed.length>0);assert.equal(run.remaining,0);assert.equal(run.rootRemoved,true);
  t.diagnostic(JSON.stringify({kind:'exit-driver-timeout',status:run.status,hex:run.hex,signal:run.signal,lastStage:run.lastStage,resources:run.resources,cleanup:run.cleanup,remaining:run.remaining}));
});
