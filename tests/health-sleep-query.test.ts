import assert from 'node:assert/strict';
import test from 'node:test';
import { createHealthOperations } from '../src/personal-health/records-http.mjs';
import { EMPTY_HEALTH, HEALTH_DEFAULTS } from '../src/personal-health/records-schema.mjs';
import { healthShiftDay } from '../src/personal-health/analysis.mjs';

test('health tool separates five nights of duration from missing scores and genuine no data', async () => {
  const to = '2026-10-16', days: any = {};
  for (let n = 0; n < 5; n++) days[healthShiftDay(to, -n)] = { health: { ...EMPTY_HEALTH, status: 'available', sleepMinutes: 450 } };
  const state = { settings: { ...HEALTH_DEFAULTS }, days };
  const operations = createHealthOperations({
    healthRecords: { read: async (owner: string) => structuredClone(owner === 'mine' ? state : { ...state, days: {} }) },
    usage: { settings: () => ({ timeZone: 'Asia/Shanghai' }) },
    accountState: () => ({}), timestamp: () => Date.parse(to + 'T12:00:00+08:00'),
  });
  for (const metric of ['sleep', 'sleepMinutes', 'overview']) {
    const result = await operations.query('mine', { metric });
    assert.equal(result.connected, true);
    assert.equal(result.sleepSummary.recordedDays, 5, metric);
    assert.equal(result.sleepSummary.missingDays, 2);
    assert.equal(result.sleepSummary.averageMinutes, 450);
    assert.equal(result.sleepSummary.scoreRecordedDays, 0);
    assert.equal(result.sleepSummary.unit, 'min');
    assert.deepEqual(result.sleepSummary.items.map((row: any) => row.minutes), [null, null, 450, 450, 450, 450, 450]);
    assert.ok(result.sleepSummary.items.every((row: any) => row.score === null && row.scoreMissing.includes('baselineNights')));
    assert.ok(result.sleepSummary.items.at(-1).scoreMissing.includes('deepMinutes'));
    assert.equal(result.sleepSummary.items.at(-1).baselineNights, 4);
    if (metric === 'sleep') assert.ok(result.items.every((row: any) => row.value === null), 'sleep remains the score');
  }
  const empty = await operations.query('other', { metric: 'sleep' });
  assert.equal(empty.connected, false);
  assert.deepEqual(empty.items, []);
  // Other health measurements do not become fabricated sleep measurements.
  for (const row of Object.values(days) as any[]) { row.health.sleepMinutes = null; row.health.steps = 1000; }
  const noSleep = await operations.query('mine', { metric: 'overview' });
  assert.equal(noSleep.connected, true);
  assert.equal(noSleep.sleepSummary.recordedDays, 0);
  assert.equal(noSleep.sleepSummary.averageMinutes, null);
  // Recorded zero is a measured value, while missing dates stay missing.
  days[to].health.sleepMinutes = 0;
  const zero = await operations.query('mine', { metric: 'sleep' });
  assert.equal(zero.sleepSummary.recordedDays, 1);
  assert.equal(zero.sleepSummary.averageMinutes, 0);
});
