/** Isolated production Electron/DSH, real MiMo and the pinned MemoWeft Core. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, open, unlink, readdir, lstat, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { harness, until } from './ia-2b-harness.mjs';
import { redactEvidenceText } from '../helpers/process-evidence.mjs';
import { managedTempRoot } from '../helpers/managed-temp.mjs';

const out = process.env.WEFTMATE_FIX50_EVIDENCE;
assert.ok(out && resolve(out).endsWith(`${sep}evidence${sep}FIX-50`));
await mkdir(out, { recursive: true });
const report = { realElectron: true, realDsh: true, realCore: true, model: 'mimo-v2.6-flash', steps: [] };
let lease, h;
const clean = value => redactEvidenceText(value, h ? [h.base] : []).replace(/https?:\/\/[^\s"'<>\\]+/g, '[URL]');
const save = () => writeFile(join(out, 'mimo-report.json'), clean(JSON.stringify(report, null, 2)) + '\n');
async function removeLinks(directory) {
  for (const row of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, row.name);
    if ((await lstat(file)).isSymbolicLink()) await unlink(file);
    else if (row.isDirectory()) await removeLinks(file);
  }
}
async function settled() {
  return until(async () => {
    const state = (await h.api('/memory/status')).body;
    return !state.pendingFormationCount && !state.pendingBoundaryCount && state;
  }, 240000);
}
try {
  while (!lease) {
    for (const id of [1, 2, 3]) {
      const file = `D:/AIProjects/WeftMate/Runtime/Orchestrator/locks/heavy-${id}.lock`;
      try { const handle = await open(file, 'wx'); await handle.writeFile(`FIX-50 ${new Date().toISOString()} isolated Electron MiMo/Core`); await handle.close(); lease = file; break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!lease) { console.log('FIX-50 waiting for a heavy slot'); await new Promise(resolve => setTimeout(resolve, 30000)); }
  }
  h = await harness('fix50-mimo', { memory: true, mainChat: true, modelTrace: true });
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFocusable(false));
  async function create() {
    const result = await until(async () => {
      const response = await h.api('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: h.hostId, modelProfileId: h.modelProfileId });
      if (response.status === 409 && response.body.error?.code === 'SESSION_BUSY') return null;
      assert.equal(response.status, 202, JSON.stringify(response.body)); return response.body.command;
    }, 30000);
    return (await until(async () => { const c = (await h.api(`/commands/${result.commandId}`)).body.command; return c.state === 'accepted_by_dsh' && c; })).sessionId;
  }
  async function sources(items) {
    const rows = [];
    for (const item of items) rows.push({ id: item.id, kind: item.kind,
      ...await h.api(`/memory/items/${item.kind}/${item.id}/sources`) });
    return rows;
  }
  let sessionId = await create(), retained = [];
  const inputs = ['记住：我喜欢喝乌龙茶。', '我喜欢喝什么茶？',
    '不对，纠正我喝茶的偏好：我现在喜欢红茶，不是乌龙茶。请更新这条记忆。', '我喜欢喝什么茶？',
    '忘掉我喝茶的偏好，另外请计算12×13。', '我喜欢喝什么茶？', '不对，请重新计算12×13'];
  for (let i = 0; i < inputs.length; i++) {
    if ([1, 3, 5].includes(i)) sessionId = await create();
    const before = (await h.api(`/sessions/${sessionId}/events`)).body.events ?? [];
    const previous = new Set(before.map(event => event.seq ?? event.eventId));
    const command = await h.command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: h.hostId, sessionId, text: inputs[i] });
    const step = { input: inputs[i], sessionId }; report.steps.push(step); await save();
    const task = await h.complete(command);
    step.status = task.replyEvidence?.status; step.executionSteps = task.executionSteps;
    const events = (await h.api(`/sessions/${sessionId}/events`)).body.events ?? [];
    step.reply = events.filter(event => event.type === 'assistant.message' && !previous.has(event.seq ?? event.eventId))
      .map(event => event.data?.text ?? '').join('\n');
    step.memoryStatus = await settled();
    step.items = (await h.api('/memory/items?kind=all&includeSources=true')).body;
    step.sources = await sources(step.items.items ?? []);
    step.coreJobs = await h.app.evaluate(async (_, ownerId) => ia2b.context.memoryManager.query(ownerId, 'query_jobs', { operation: 'list' }), h.ownerId);
    if (i === 3) retained = (step.items.items ?? []).filter(item => item.kind === 'cognition');
    if (i === 4) {
      step.deletedSources = await sources(retained);
      step.originalConversation = (await h.api(`/sessions/${report.steps[0].sessionId}/events`)).body.events
        .filter(event => event.type === 'user.message').map(event => event.data?.text);
    }
    await save(); console.log(JSON.stringify({ step: i + 1, status: step.status, reply: step.reply,
      memoryState: step.memoryStatus.state, memoryCount: step.items.items?.length }));
  }
  assert.match(report.steps[1].reply, /乌龙茶/);
  assert.match(report.steps[3].reply, /红茶/);
  assert.match(report.steps[4].reply, /156/);
  assert.match(report.steps[4].reply, /已删除.*喝茶/);
  assert.equal(report.steps[4].executionSteps.some(step => step.toolName === 'memory_forget'), false,
    'the real model did not invoke forgetting; the host still deleted everything');
  assert.ok(retained.length >= 2, 'a genuine correction chain existed before forgetting');
  assert.ok(report.steps[4].deletedSources.every(row => row.status === 404), 'every old source route must be unreadable');
  assert.equal((report.steps[4].items.items ?? []).some(item => /乌龙茶|红茶/.test(item.text)), false);
  assert.ok(report.steps[4].originalConversation.some(text => /乌龙茶/.test(text)), 'original conversation remains readable');
  assert.doesNotMatch(report.steps[5].reply, /乌龙茶|红茶/);
  assert.match(report.steps[6].reply, /156/);
  for (const step of report.steps) assert.ok(step.reply.trim(), 'each step has a final reply');
  report.passed = true;
} catch (error) { report.failure = clean(error.stack ?? String(error)); throw error; }
finally {
  if (h) {
    await h.close();
    for (const name of ['host.log', 'model-messages.jsonl', 'requests.jsonl'])
      await writeFile(join(out, 'mimo-' + name), clean(await readFile(join(h.base, name), 'utf8').catch(() => '')));
    await save();
    assert.ok(resolve(h.base).startsWith(resolve(managedTempRoot()) + sep));
    await removeLinks(h.base); await rm(h.base, { recursive: true, force: true });
  }
  if (lease) await unlink(lease);
  await save();
}
