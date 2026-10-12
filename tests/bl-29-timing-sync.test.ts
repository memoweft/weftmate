import test from 'node:test';
import assert from 'node:assert/strict';
import { probe } from './helpers/bl-29-probe.mjs';


test('BL-29b M4/S1 real Electron and mobile synchronize settings and regain foreground under 200ms transport', {timeout:60000}, () => {
  const r = probe('probe-latency', 'latency.json', 55000);
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
