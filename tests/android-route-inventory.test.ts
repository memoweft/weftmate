import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleRoute, inventory } from '../scripts/android-route-inventory.mjs';

test('Android inventory discovers interface and contract paths and runs the shipped native dispatcher', async () => {
  const rows = await inventory();
  for (const path of ['/personal/v1/execution-records', '/personal/v1/settings/health', '/personal/v1/health/overview', '/personal/v1/account/models', '/personal/v1/daily-summaries']) {
    const row = rows.find(row => row.path === path);
    assert.ok(row, path); assert.equal(row.transport, 'business', path);
  }
  assert.equal(rows.find(row => row.path === '/personal/v1/models')?.transport, 'models.host');
  assert.equal(rows.find(row => row.path === '/personal/v1/auth/desktop')?.transport, 'specialized-or-desktop');
  assert.ok(rows.some(row => row.sources.some(source => source.startsWith('apps/mobile-ui/'))));
  assert.ok(rows.some(row => row.sources.includes('docs/CLIENT_API.md')));
  assert.ok(rows.filter(row => row.transport === 'business').length > 60);
  assert.ok(rows.every(row => row.transport !== 'unclassified'));
  assert.equal(rows.find(row => row.path === '/personal/v1/cloud/auth/login/code/request')?.transport, 'cloud-account');
});
test('Android inventory resolves opaque IDs, dates, numeric detail anchors and health identifiers', () => {
  assert.equal(exampleRoute('/personal/v1/sessions/${encodeURIComponent(sessionId)}/events/{seq}/detail'), '/personal/v1/sessions/sample-one/events/1/detail');
  assert.equal(exampleRoute('/personal/v1/daily-summaries/:day/health'), '/personal/v1/daily-summaries/2026-10-12/health');
  assert.equal(exampleRoute('/personal/v1/health/metrics/:id'), '/personal/v1/health/metrics/sleep');
});
