import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.mjs';
import { createLogger } from '../src/log.mjs';
import { createCloudServer } from '../src/server.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-http-'));
  const opened = await openDatabase(path.join(root, 'cloud.sqlite'));
  let logs = '';
  const logger = createLogger({ stream: { write: (line) => { logs += line; } } });
  const server = createCloudServer({ ...opened, logger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let dbClosed = false;
  t.after(async () => {
    await new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
    if (!dbClosed) opened.database.close();
    await rm(root, { recursive: true, force: true });
  });
  return { url: `http://127.0.0.1:${server.address().port}`, logs: () => logs,
    closeDatabase: () => { opened.database.close(); dbClosed = true; } };
}

test('health is public, reports the initialized schema, and never caches', async (t) => {
  const app = await fixture(t);
  const response = await fetch(`${app.url}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'weftmate-cloud', schemaVersion: 6 });
});

test('method errors and unknown routes expose no credentials in logs', async (t) => {
  const app = await fixture(t);
  const wrongMethod = await fetch(`${app.url}/healthz`, { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');
  await wrongMethod.text();
  const response = await fetch(`${app.url}/personal/v1/auth/login?code=fixture-secret`, {
    headers: { authorization: 'Bearer fixture-token', cookie: 'fixture-cookie', origin: 'https://example.com' },
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND' } });
  assert.doesNotMatch(app.logs(), /fixture-secret|fixture-token|fixture-cookie|example\.com|auth\/login/);
  assert.equal(JSON.parse(app.logs().trim().split('\n').at(-1)).route, 'unmatched');
});

test('shared mail PNG is public, cacheable, parameter-free and never logged per recipient', async (t) => {
  const app = await fixture(t);
  const url = `${app.url}/assets/mail/weftmate-mark.png`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(response.headers.get('set-cookie'), null);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), 128);
  assert.equal(bytes.readUInt32BE(20), 128);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal(await head.text(), '');
  const post = await fetch(url, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal(app.logs(), '');
  assert.equal((await fetch(`${url}?recipient=synthetic`)).status, 404);
});

test('database failure changes readiness to 503 without leaking internal details', async (t) => {
  const app = await fixture(t);
  app.closeDatabase();
  const response = await fetch(`${app.url}/healthz`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'unavailable', service: 'weftmate-cloud' });
  assert.match(app.logs(), /DATABASE_UNAVAILABLE/);
  assert.doesNotMatch(app.logs(), /sqlite|stack|cloud-http-/);
});
