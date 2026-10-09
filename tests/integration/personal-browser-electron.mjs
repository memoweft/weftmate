/** Opt-in hidden Electron browser reader against owned synthetic .invalid pages only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.env.WEFTMATE_SYNTHETIC_BROWSER_E2E !== '1') {
  throw new Error('Set WEFTMATE_SYNTHETIC_BROWSER_E2E=1 on Windows for the owned fixture.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const electron = createRequire(import.meta.url)('electron');
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-stage11-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, 'stage11-browser-fixture.json'),
  JSON.stringify({ purpose: 'stage11-owned-browser-fixture' }), { flag: 'wx', mode: 0o600 });
let secretHits = 0;
const fixtureHits = [];
let fixturePort;
const fixture = createServer((request, response) => {
  fixtureHits.push(request.url);
  response.on('finish', () => fixtureHits.push(`finish:${request.url}`));
  response.on('close', () => fixtureHits.push(`close:${request.url}`));
  const base = `http://page-a.weftmate.invalid:${fixturePort}`;
  const requestPath = new URL(request.url, base).pathname;
  if (requestPath === '/tiny') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><title>Tiny</title><main id="result"></main><script>
      const owner = new URLSearchParams(location.search).get('owner');
      const priorStorage = localStorage.getItem('owner') || 'none';
      const priorCookie = document.cookie || 'none';
      document.getElementById('result').textContent = 'owner=' + owner + ';priorStorage=' + priorStorage + ';priorCookie=' + priorCookie;
      localStorage.setItem('owner', owner); document.cookie = 'viewer=' + owner;
    </script></html>`);
  } else if (request.url === '/first') {
    const navigation = Array.from({ length: 120 }, (_, index) =>
      `<a href="${base}/nav-${index}">navigation ${index}</a>`).join('');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><title>合成第一页</title></head><body>
      <nav>${navigation}</nav><main id="content"></main>
      <script>setTimeout(() => {
        document.getElementById('content').innerHTML = '<p>动态渲染后才出现的蓝色风筝。</p><a href="${base}/second">继续第二页</a>';
      }, 100)</script></body></html>`);
  } else if (request.url === '/api-content') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>API reference</title><nav>${'Unrelated module menu '.repeat(600)}</nav>
      <div id="apicontent"><h1>Current API facts</h1><p>Supported reference content.</p></div>`);
  } else if (request.url === '/second') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><title>合成第二页</title><main>第二页橙色时钟。</main></html>');
  } else if (request.url === '/private-subresource') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<html><main>不得当作成功阅读</main><img src="http://127.0.0.1:${fixturePort}/secret"></html>`);
  } else if (request.url === '/redirect-private') {
    response.writeHead(302, { location: `http://127.0.0.1:${fixturePort}/secret` }); response.end();
  } else if (request.url === '/long') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<html><main>${'正文'.repeat(30_000)}</main></html>`);
  } else if (request.url === '/login') {
    response.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<html><main>请先登录<input type="password"></main></html>');
  } else if (request.url === '/slow') {
    // Deliberately keep this owned response open until task cancellation.
  } else if (request.url === '/secret') {
    secretHits++;
    response.writeHead(200); response.end('private fixture endpoint');
  } else { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
fixturePort = fixture.address().port;
if ([443, 8443, 8080, 8081, 18186, 18188].includes(fixturePort)) {
  throw new Error('owned fixture selected a reserved port; rerun after closing it');
}
const child = spawn(electron, [join(repository, 'tests', 'fixtures', 'personal-browser-child.mjs'),
  `--user-data-dir=${profile}`], {
  cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: { ...process.env, WEFTMATE_BROWSER_SYNTHETIC_FIXTURE: '1',
    WEFTMATE_BROWSER_FIXTURE_PORT: String(fixturePort) },
});
let output = '';
child.on('error', (error) => { output = (output + `\n[child-error:${error.code ?? 'unknown'}]`).slice(-16_000) });
for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
  output = (output + String(chunk)).slice(-16_000);
});
const waiters = new Map();
let ready;
const readyPromise = new Promise((resolve) => { ready = resolve });
const startupDiagnostic = () => ({ exitCode: child.exitCode, signalCode: child.signalCode,
  fixtureHits: fixtureHits.slice(-10),
  outputTail: output.slice(-1600).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(?:token|secret|password)\s*[:=]\s*\S+/gi, '[redacted]') });
child.on('message', (frame) => {
  if (frame?.type === 'ready') { ready(); return; }
  const pending = waiters.get(frame?.id);
  if (!pending) return;
  if (frame.type === 'started') pending.started();
  if (frame.type === 'result' || frame.type === 'status') {
    clearTimeout(pending.timer); waiters.delete(frame.id); pending.finished(frame);
  }
});
function read(url, taskId = 'task-fixture', ownerId = 'owner-fixture') {
  const id = `call-${randomUUID()}`;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve });
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(id);
      reject(new Error(`browser fixture timeout: ${JSON.stringify({ id, route: new URL(url).pathname,
        startup: startupDiagnostic() })}`)); }, 20_000);
    waiters.set(id, { timer, started, finished: resolve });
    child.send({ type: 'read', id, taskId, ownerId, url }, (error) => {
      if (error) { clearTimeout(timer); waiters.delete(id); reject(error); }
    });
  });
  return { started: startedPromise, result };
}
async function status() {
  const id = `status-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(id); reject(new Error('status timeout')); }, 5_000);
    waiters.set(id, { timer, started() {}, finished: resolve });
    child.send({ type: 'status', id });
  });
}
async function stopOwned() {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode === 0;
  const closed = new Promise((resolve) => child.once('close', resolve));
  if (child.connected) {
    try { child.send({ type: 'close' }, () => {}); } catch { /* bounded fallback */ }
  }
  const graceful = await Promise.race([closed.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 8_000))]);
  if (!graceful) { child.kill(); await closed; }
  return child.exitCode === 0;
}
let completed = false;
try {
  await Promise.race([readyPromise,
    new Promise((_, reject) => child.once('close', () => reject(new Error(`Electron fixture exited before ready: ${JSON.stringify(startupDiagnostic())}`)))),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Electron fixture did not start: ${JSON.stringify(startupDiagnostic())}`)), 20_000))]);
  const base = `http://page-a.weftmate.invalid:${fixturePort}`;
  const first = await read(`${base}/first`).result;
  assert.equal(first.ok, true, first.code);
  assert.match(first.value.text, /动态渲染后才出现的蓝色风筝/);
  assert.equal(first.value.title, '合成第一页');
  assert.ok(first.value.links.some((link) => link.url === `${base}/second`));
  const reference = await read(`${base}/api-content`).result;
  assert.equal(reference.ok, true, reference.code);
  assert.match(reference.value.text, /Current API facts.*Supported reference content/s);
  assert.doesNotMatch(reference.value.capturedText, /Unrelated module menu/);
  const second = await read(`${base}/second`).result;
  assert.equal(second.ok, true, second.code);
  assert.match(second.value.text, /橙色时钟/);
  const long = await read(`${base}/long`).result;
  assert.equal(long.ok, true, long.code);
  assert.equal(long.value.truncated, true);
  assert.ok(Buffer.byteLength(long.value.text, 'utf8') <= 32 * 1024);
  const login = await read(`${base}/login`).result;
  assert.equal(login.ok, false);
  assert.equal(login.code, 'BROWSER_LOGIN_REQUIRED');
  const privateResource = await read(`${base}/private-subresource`).result;
  assert.equal(privateResource.ok, false);
  const redirect = await read(`${base}/redirect-private`).result;
  assert.equal(redirect.ok, false);
  assert.equal(secretHits, 0, 'private redirect/subresource must never reach the fixture endpoint');
  const rebind = await read('http://rebind.public-domain.com/').result;
  assert.equal(rebind.ok, false);
  const slow = read(`${base}/slow`, 'task-resume');
  await slow.started;
  child.send({ type: 'cancel', ownerId: 'owner-fixture', taskId: 'task-resume' });
  const cancelled = await slow.result;
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.code, 'BROWSER_CANCELLED');
  const resumed = await read(`${base}/first`, 'task-resume').result;
  assert.equal(resumed.ok, true, resumed.code);
  if (process.env.WEFTMATE_BROWSER_REUSE_SWEEP === '1') {
    for (let index = 0; index < 136; index++) {
      const ownerId = index % 2 === 0 ? 'owner-A' : 'owner-B';
      const shown = await read(`${base}/tiny?owner=${ownerId}`, `task-sweep-${index}`, ownerId).result;
      assert.equal(shown.ok, true, `sweep index ${index}: ${shown.code}`);
      assert.match(shown.value.text, /priorStorage=none;priorCookie=none/,
        `session data leaked at sweep index ${index}`);
      if (index === 67) {
        const interrupted = read(`${base}/slow`, 'task-sweep-resume', 'owner-A');
        await interrupted.started;
        child.send({ type: 'cancel', ownerId: 'owner-A', taskId: 'task-sweep-resume' });
        assert.equal((await interrupted.result).code, 'BROWSER_CANCELLED');
        const resumedSweep = await read(`${base}/tiny?owner=owner-A`, 'task-sweep-resume', 'owner-A').result;
        assert.equal(resumedSweep.ok, true);
        assert.match(resumedSweep.value.text, /priorStorage=none;priorCookie=none/);
      }
    }
    const usage = await status();
    assert.equal(usage.status.available, true);
    assert.ok(usage.status.readsCompleted > 128);
    assert.ok(usage.status.sessionsCreated <= 2);
    assert.equal(usage.status.quarantinedSessions, 0);
    assert.equal(usage.status.activeReads, 0);
    assert.equal(usage.windowCount, 0);
    console.log(`[stage11-browser-electron] reuse sweep reads=${usage.status.readsCompleted} partitions=${usage.status.sessionsCreated} quarantined=${usage.status.quarantinedSessions} windows=${usage.windowCount}`);
  }
  completed = true;
  console.log('[stage11-browser-electron] rendered text/link, bounds, private redirect/subresource, DNS, cancel/resume passed');
} catch (error) {
  throw new Error(`${error?.message ?? 'fixture failed'}; diagnostic=${JSON.stringify(startupDiagnostic())}`);
} finally {
  const clean = await stopOwned();
  fixture.closeAllConnections?.();
  await new Promise((resolve) => fixture.close(resolve));
  if (completed && clean && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
    rmSync(root, { recursive: true, force: true });
  }
}
