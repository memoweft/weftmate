/** 60-second Windows regression: actual Electron + synthetic stuck model, no daily services. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

if (process.platform !== 'win32') throw new Error('This opt-in acceptance measures Windows Electron');
const repository = resolve(import.meta.dirname, '../..'), root = await mkdtemp(join(tmpdir(), 'weftmate-hf2-'));
const baseline = process.argv.includes('--baseline'), label = baseline ? 'before' : 'after';
const output = resolve(process.env.HF2_OUTPUT ?? '.local/hf2');
await mkdir(output, { recursive: true });
const env = { ...process.env, HF2_PROFILE: root };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key === 'ELECTRON_RUN_AS_NODE' ||
    /API_KEY|MODEL_SWITCH_UNIFIED_KEY/.test(key)) delete env[key];
if (baseline) {
  const sources = {};
  for (const file of ['src/private-host-storage.mjs', 'src/personal-access/store.mjs', 'src/personal-access/index.mjs',
    'src/personal-access/tasks.mjs', 'src/personal-desktop.mjs']) {
    sources[pathToFileURL(join(repository, file)).href] = (await promisify(execFile)('git', ['show', `f787c3c:${file}`], { cwd: repository, maxBuffer: 8 * 1024 * 1024 })).stdout;
  }
  env.HF2_BASELINE = join(root, 'baseline-sources.json');
  await writeFile(env.HF2_BASELINE, JSON.stringify(sources));
}
let modelRequests = 0;
const model = createServer(async (request, response) => { for await (const _ of request) {} modelRequests++; /* Deliberately no response. */ });
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
env.HF2_MODEL_URL = `http://127.0.0.1:${model.address().port}/v1/chat/completions`;
const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
  args: [join(repository, 'tests/integration/hf-2-stalls-bootstrap.mjs')], cwd: repository, env, timeout: 90_000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 90_000) { const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await pause(100); }
  throw new Error('HF2 fixture timeout'); }
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(90_000);
  const info = await until(() => app.evaluate(() => globalThis.hf2 && { origin: globalThis.hf2.origin, hostId: globalThis.hf2.hostId }));
  await page.locator('#assistant-view').waitFor({ state: 'visible' });
  console.log(`${label}: authenticated Electron window ready`);
  async function api(path, body) { return page.evaluate(async ({ path, body }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body }); }
  async function command(body) { const submitted = await api('/commands', body); assert.equal(submitted.status, 202, JSON.stringify(submitted));
    return until(async () => { const r = await api(`/commands/${submitted.body.command.commandId}`);
      return r.body.command.state === 'accepted_by_dsh' && r.body.command; }); }
  const tasks = [];
  for (let n = 0; n < 3; n++) {
    const session = await command({ requestId: `create-${n}`, kind: 'session.create', modelProfileId: 'local', targetDeviceId: info.hostId });
    const message = await command({ requestId: `message-${n}`, kind: 'session.message', targetDeviceId: info.hostId,
      sessionId: session.sessionId, text: `HF2 synthetic stuck turn ${n}. ` + 'synthetic '.repeat(100) });
    tasks.push(message);
    for (let child = 0; child < 3; child++) {
      const supplement = await api(`/tasks/${message.commandId}/supplements`, { requestId: `supplement-${n}-${child}`, text: 'synthetic '.repeat(400) });
      assert.equal(supplement.status, 202, JSON.stringify(supplement));
      await until(async () => (await api(`/commands/${supplement.body.command.commandId}`)).body.command.state === 'accepted_by_dsh');
    }
  }
  await until(() => modelRequests === 12);
  await app.evaluate((_electron, id) => globalThis.hf2.show(id), tasks.at(-1).sessionId);
  await page.locator(`.session-row[data-session-id="${tasks.at(-1).sessionId}"] button.is-current`).waitFor({ state: 'visible' });
  await page.locator('#send-message[data-action=stop]').waitFor({ state: 'visible' });
  console.log(`${label}: three hanging turns (12 frozen receipts) accepted, measuring 60 seconds`);
  await app.evaluate(() => globalThis.hf2.begin());
  const start = Date.now(), ipc = [], movement = [];
  const clickStart = Date.now();
  const stopResponse = page.waitForResponse(response => response.url().endsWith(`/tasks/${tasks.at(-1).commandId}/stop`));
  await page.locator('#send-message[data-action=stop]').click();
  const clickDispatchMs = Date.now() - clickStart;
  const stopped = await stopResponse;
  assert.equal(stopped.status(), 202);
  const clickAckMs = Date.now() - clickStart;
  for (const task of tasks.slice(0, 2)) assert.equal((await api(`/tasks/${task.commandId}/stop`, { requestId: `stop-${task.commandId}` })).status, 202);
  const movementWork = (async () => {
    while (Date.now() - start < 60_000) {
      const at = Date.now();
      await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0], bounds = win.getBounds();
        win.setBounds({ ...bounds, x: bounds.x + (bounds.x % 2 ? -1 : 1) }); });
      movement.push(Date.now() - at);
      await pause(100);
    }
  })();
  while (Date.now() - start < 60_000) {
    const samples = await page.evaluate(async () => {
      const result = [];
      for (let i = 0; i < 5; i++) { const at = performance.now(); await window.weftmateDesktop.settings(); result.push(performance.now() - at);
        await new Promise(resolve => setTimeout(resolve, 25)); }
      return result;
    });
    ipc.push(...samples);
    await pause(25);
  }
  await movementWork;
  const result = await app.evaluate(() => globalThis.hf2.metrics());
  Object.assign(result, { label, baselineCommit: baseline ? 'f787c3c' : null, modelRequests, clickDispatchMs, clickAckMs,
    ipc: { samples: ipc.length, p99Ms: percentile(ipc, .99), maxMs: Math.max(...ipc) },
    movement: { samples: movement.length, p99Ms: percentile(movement, .99), maxMs: Math.max(...movement) } });
  await writeFile(join(output, `${label}.json`), JSON.stringify(result, null, 2));
  await app.evaluate(() => globalThis.hf2.finish());
  for (const task of tasks) { const terminal = await api(`/tasks/${task.commandId}`); assert.equal(terminal.body.control.stopStatus, 'stopped', JSON.stringify(terminal)); }
  const calls = (await app.evaluate(() => globalThis.hf2.metrics())).stopCalls;
  await pause(2_000);
  result.retriesAfterTerminal = (await app.evaluate(() => globalThis.hf2.metrics())).stopCalls - calls;
  if (!baseline) assert.equal(result.retriesAfterTerminal, 0, 'ended turns stop retrying');
  result.terminalStopObserved = true;
  await writeFile(join(output, `${label}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!baseline) { assert.ok(result.p99Ms < 50, `event loop p99 ${result.p99Ms}`); assert.ok(result.storeWrites <= 6, `writes ${result.storeWrites}`);
    assert.equal(result.syncSpawns, 0); assert.ok(result.ipc.p99Ms < 50, `IPC p99 ${result.ipc.p99Ms}`); }
} finally {
  await app.evaluate(() => globalThis.hf2?.close()).catch(() => {}); await app.close();
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  console.log(`Synthetic profile retained for ACL inspection: ${root}`);
}
