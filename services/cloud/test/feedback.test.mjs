import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedback, cleanFeedbackText } from '../src/feedback.mjs';
import { FailureLimiter } from '../src/security.mjs';
import { DatabaseSync } from 'node:sqlite';
import { fixture, P } from './identity-helpers.mjs';
import { registration, appDevice, control } from './app-helpers.mjs';

const payload = { title: '应用反馈：回答缺了一步', body: '请补上最后一步。\n\n诊断摘要\n没有异常。' };
test('feedback requires authenticated device, posts exact approved text, returns number, and never logs or stores content', async t => {
  const received = [];
  const f = await fixture(t, { env: { CLOUD_FEEDBACK_REPOSITORY: 'synthetic/feedback', CLOUD_FEEDBACK_TOKEN: 'synthetic-token' },
    feedbackFetch: async (url, options) => { received.push({ url, ...JSON.parse(options.body) }); return { ok: true, json: async () => ({ number: 42 }) }; } });
  await f.api(P + '/feedback', { method: 'POST', body: payload, status: 401 });
  await registration(f); const device = await appDevice(f, 'desktop');
  const response = await control(device, '/feedback', payload, 201);
  assert.deepEqual(response.data, { number: 42 });
  assert.deepEqual(received, [{ url: 'https://api.github.com/repos/synthetic/feedback/issues', ...payload }]);
  assert.doesNotMatch(f.logs(), /回答缺了一步|请补上|synthetic-token/);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE '%feedback%'").get().n, 0);
  await control(device, '/feedback', { ...payload, body: '中'.repeat(20001) }, 413);
  await control(device, '/feedback', { ...payload, body: '<script>alert(1)</script> @someone' }, 400);
  for (let i = 0; i < 4; i++) await control(device, '/feedback', payload, 201);
  const limited = await control(device, '/feedback', payload, 429);
  assert.equal(limited.data.error.code, 'RATE_LIMITED');
  assert.equal(received.length, 5);
});
test('unconfigured cloud explicitly reports not opened after login', async t => {
  const f = await fixture(t); await registration(f); const device = await appDevice(f, 'desktop');
  assert.equal((await control(device, '/feedback', payload, 503)).data.error.code, 'FEEDBACK_NOT_CONFIGURED');
});
test('cleaning is plain text; upstream failures preserve reason without returning credentials', async t => {
  const database = new DatabaseSync(':memory:'); t.after(() => database.close());
  database.exec('CREATE TABLE failure_limits(key TEXT PRIMARY KEY,failures INTEGER,window_start INTEGER,blocked_until INTEGER)');
  const config = { feedbackRepository: 'synthetic/feedback', feedbackToken: 'server-only-token' };
  const limiter = new FailureLimiter(database, 'synthetic-secret');
  assert.equal(cleanFeedbackText('<b>@user</b>\r\n\u0000text'), '＜b＞＠user＜/b＞\ntext');
  const denied = createFeedback({ config, limiter, fetch: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(denied({ id: 'account' }, payload), { code: 'FEEDBACK_GITHUB_403' });
  const offline = createFeedback({ config, limiter, fetch: async () => { throw Error('private secret details'); } });
  await assert.rejects(offline({ id: 'other' }, payload), { code: 'FEEDBACK_NETWORK_FAILED' });
});
