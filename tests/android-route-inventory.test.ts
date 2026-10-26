import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleRoute, inventory } from '../scripts/android-route-inventory.mjs';

test('Android inventory discovers interface paths and runs the shipped native dispatcher', async () => {
  const rows = await inventory();
  for (const path of ['/personal/v1/execution-records', '/personal/v1/settings/health', '/personal/v1/health/overview', '/personal/v1/account/models']) {
    const row = rows.find(row => row.path === path);
    assert.ok(row, path); assert.equal(row.transport, 'business', path);
  }
  assert.equal(rows.find(row => row.path === '/personal/v1/models')?.transport, 'models.host');
  assert.equal(rows.find(row => row.path === '/personal/v1/auth/desktop')?.transport, 'specialized-or-desktop');
  assert.ok(rows.some(row => row.sources.some(source => source.startsWith('apps/mobile-ui/'))));
  assert.ok(rows.filter(row => row.transport === 'business').length > 60);
  assert.ok(rows.every(row => row.transport !== 'unclassified'));
  assert.equal(rows.find(row => row.path === '/personal/v1/cloud/auth/login/code/request')?.transport, 'cloud-account');
});
test('Android inventory resolves opaque IDs, dates, numeric detail anchors and health identifiers', () => {
  assert.equal(exampleRoute('/personal/v1/sessions/${encodeURIComponent(sessionId)}/events/{seq}/detail'), '/personal/v1/sessions/sample-one/events/1/detail');
  assert.equal(exampleRoute('/personal/v1/daily-summaries/:day/health'), '/personal/v1/daily-summaries/2026-10-12/health');
  assert.equal(exampleRoute('/personal/v1/health/metrics/:id'), '/personal/v1/health/metrics/sleep');
  const service = '/personal/v1/model-services/model-service-00000000-0000-4000-8000-000000000001';
  assert.equal(exampleRoute('/personal/v1/model-services/${encodeURIComponent(serviceId)}'), service);
  assert.equal(exampleRoute('/personal/v1/model-services/:id/refresh'), service + '/refresh');
  assert.equal(exampleRoute('/personal/v1/model-services/{id}/select'), service + '/select');
});

test('model service inventory uses the native service identity shape and preserves callable methods', async () => {
  const rows = (await inventory()).filter(row => row.path.startsWith('/personal/v1/model-services'));
  const service = '/personal/v1/model-services/model-service-00000000-0000-4000-8000-000000000001';
  assert.deepEqual(rows.map(row => row.method + ' ' + row.path).sort(), [
    'GET /personal/v1/model-services', 'POST /personal/v1/model-services/check',
    'POST ' + service + '/refresh', 'POST ' + service + '/select',
  ].sort());
  assert.ok(rows.every(row => row.transport === 'business'));
});

test('offline phone task inventory covers all four exact cloud POST calls', async () => {
  const rows = await inventory();
  const taskRows = rows.filter(row => row.path.includes('/hosts/offline/tasks/'));
  assert.ok(!rows.some(row => row.path.startsWith('/personal/v1/hosts/')));
  assert.equal(rows.find(row => row.path === '/personal/v1/cloud/hosts/offline/status')?.transport, 'cloud-account');
  for (const action of ['submit', 'list', 'cancel', 'clear']) {
    const path = '/personal/v1/cloud/hosts/offline/tasks/' + action;
    const row = taskRows.find(row => row.path === path);
    assert.ok(row, path); assert.equal(row.method, 'POST'); assert.equal(row.transport, 'cloud-account');
    for (const source of ['src/ui-core/cloud-account.js', 'apps/mobile-ui/www/ui-core/cloud-account.js'])
      assert.ok(row.sources.includes(source), source + ': ' + path);
  }
  assert.equal(taskRows.length, 4); assert.ok(taskRows.every(row => row.method === 'POST'));
});
