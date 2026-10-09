import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const repository = resolve(import.meta.dirname, '../../../..'), baseline = process.argv.includes('--baseline');
const label = baseline ? 'before' : 'after', root = await mkdtemp(join(tmpdir(), 'weftmate-fx12-'));
const output = join(repository, 'tests/evidence/qa-3/orphan-stop');
await mkdir(output, { recursive: true });
const env = { ...process.env, FX12_PROFILE: root };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key === 'ELECTRON_RUN_AS_NODE' || /API_KEY|MODEL_SWITCH_UNIFIED_KEY/.test(key)) delete env[key];
if (baseline) {
  const file = 'src/personal-access/tasks.mjs';
  env.FX12_BASELINE = join(root, 'baseline.json');
  const source = (await promisify(execFile)('git', ['show', `8e3f0ed7afb95c476ec2d23b8ad0c913e5efb582:${file}`], { cwd: repository })).stdout;
  const resources = {};
  for (const file of ['src/ui-core/tasks.js', 'src/ui-core/messages.js', 'src/personal-access-ui/components/resources.js', 'src/personal-access-ui/timeline.js']) {
    resources[file.slice(4)] = (await promisify(execFile)('git', ['show', `8e3f0ed7afb95c476ec2d23b8ad0c913e5efb582:${file}`], { cwd: repository })).stdout;
  }
  await writeFile(env.FX12_BASELINE, JSON.stringify({ modules: { [pathToFileURL(join(repository, file)).href]: source }, resources }));
}
const electron = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
  args: [join(repository, 'tests/integration/fx-12-orphan-bootstrap.mjs')], cwd: repository, env, timeout: 90_000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { const end = Date.now() + 30_000; while (Date.now() < end) { const value = await check(); if (value) return value; await pause(100); } throw new Error('FX12 fixture timeout'); }
try {
  const page = await electron.firstWindow();
  const info = await until(() => electron.evaluate(() => globalThis.fx12 && { origin: globalThis.fx12.origin, hostId: globalThis.fx12.hostId }));
  await page.locator('#assistant-view').waitFor({ state: 'visible' });
  async function api(path, body) { return page.evaluate(async ({ path, body }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body }); }
  async function command(body) { const submitted = await api('/commands', body); assert.equal(submitted.status, 202);
    return until(async () => { const r = await api(`/commands/${submitted.body.command.commandId}`); return r.body.command.state === 'accepted_by_dsh' && r.body.command; }); }
  const tasks = [];
  for (const scenario of ['runtime-restart', 'missing-turn', 'model-switch-failed', 'upstream-disconnect']) {
    const session = await command({ requestId: `create-${scenario}`, kind: 'session.create', targetDeviceId: info.hostId, modelProfileId: 'local' });
    const message = await command({ requestId: `message-${scenario}`, kind: 'session.message', targetDeviceId: info.hostId,
      sessionId: session.sessionId, text: `合成停止核对：${scenario}。保留原任务，核对回合实际状态。` });
    assert.equal((await api(`/tasks/${message.commandId}/stop`, { requestId: `stop-${scenario}` })).status, 202);
    await electron.evaluate((_electron, input) => globalThis.fx12.orphan(input.id, input.scenario), { id: session.sessionId, scenario });
    tasks.push({ ...message, scenario });
  }
  await electron.evaluate(() => globalThis.fx12.restartAccess());
  const result = { label, scenarios: [], metrics: null };
  for (const task of tasks) {
    const detail = await until(async () => { const r = await api(`/tasks/${task.commandId}`);
      return r.status === 200 && r.body.control.stopStatus === (baseline ? 'unconfirmed' : 'completed') && r.body; });
    assert.equal(detail.control.canResume, !baseline);
    await electron.evaluate((_electron, id) => globalThis.fx12.show(id), task.sessionId);
    await page.locator(`.session-row[data-session-id="${task.sessionId}"] button.is-current`).waitFor();
    try { await until(async () => (await page.locator('body').innerText()).includes(baseline ? '尚无结束记录' : '已结束')); }
    catch (error) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: join(output, `${label}-debug.png`) }); throw error; }
    await page.screenshot({ path: join(output, `${label}-${task.scenario}.png`) });
    result.scenarios.push({ scenario: task.scenario, control: detail.control });
  }
  if (!baseline) {
    const task = tasks[0], before = await electron.evaluate(() => globalThis.fx12.metrics());
    const resume = await api(`/tasks/${task.commandId}/resume`, { requestId: 'resume-once', text: '只执行明确的新步骤，不重做已执行步骤。' });
    assert.equal(resume.status, 202, JSON.stringify(resume));
    await until(async () => (await api(`/commands/${resume.body.command.commandId}`)).body.command.state === 'accepted_by_dsh');
    const repeated = await api(`/tasks/${task.commandId}/resume`, { requestId: 'resume-once', text: '只执行明确的新步骤，不重做已执行步骤。' });
    assert.equal(repeated.body.command.commandId, resume.body.command.commandId);
    const after = await electron.evaluate(() => globalThis.fx12.metrics());
    assert.equal(after.sends - before.sends, 1, 'replayed resume does not dispatch twice');
    result.resumeDispatchedOnce = true;
    const calls = after.stopCalls;
    await pause(2_000);
    assert.equal((await electron.evaluate(() => globalThis.fx12.metrics())).stopCalls, calls);
    result.retriesAfterTerminal = 0;
  }
  result.metrics = await electron.evaluate(() => globalThis.fx12.metrics());
  await writeFile(join(output, `${label}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await electron.evaluate(() => globalThis.fx12?.close()).catch(() => {});
  await electron.close();
  await rm(root, { recursive: true, force: true });
}
