/** Owned Electron + production DSH + real MiMo and MemoWeft Core. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, open, unlink, readdir, lstat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { harness, until } from './ia-2b-harness.mjs';
import { redactEvidenceText } from '../helpers/process-evidence.mjs';
import { managedTempRoot } from '../helpers/managed-temp.mjs';

const out = process.env.WEFTMATE_FIX47_EVIDENCE;
assert.ok(out && resolve(out).startsWith('D:\\AIProjects\\WeftMate\\Runtime\\Orchestrator\\evidence\\FIX-47'));
await mkdir(out, { recursive: true });
const baseline = process.env.WEFTMATE_FIX47_BASELINE === '1';
const report = { baseline, realElectron: true, realDsh: true, realCore: true, model: 'mimo-v2.6-flash', modes: [] };
let lease, h;
async function removeLinks(directory) {
  for (const row of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, row.name);
    if ((await lstat(path)).isSymbolicLink()) await unlink(path);
    else if (row.isDirectory()) await removeLinks(path);
  }
}
async function removeFixture(root) {
  assert.ok(resolve(root).startsWith(resolve(managedTempRoot()) + '\\'));
  await removeLinks(root); await rm(root, { recursive: true, force: true });
}
const clean = value => redactEvidenceText(value, h ? [h.base] : []);
try {
  while (!lease) {
  for (const id of [1, 2, 3]) {
    const path = `D:/AIProjects/WeftMate/Runtime/Orchestrator/locks/heavy-${id}.lock`;
    try { const file = await open(path, 'wx'); await file.writeFile(`FIX-47 ${new Date().toISOString()} isolated Electron MiMo/Core`); await file.close(); lease = path; break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!lease) { console.log('FIX-47 waiting for a heavy slot'); await new Promise(resolve => setTimeout(resolve, 120000)); }
  }
  for (const mode of (process.env.WEFTMATE_FIX47_MODE ? [process.env.WEFTMATE_FIX47_MODE] : ['chat', 'work'])) {
    h = await harness(`fix47-${baseline ? 'main' : 'fixed'}-${mode}`, { memory: true, mainChat: true, modelTrace: true });
    await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFocusable(false));
    h.page.setDefaultTimeout(30000);
    const row = { mode, steps: [] }; report.modes.push(row);
    const origin = new URL(h.page.url()).origin;
    const login = await fetch(origin + '/personal/v1/auth/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ ...h.credentials, deviceName: 'Synthetic second client' }) });
    assert.equal(login.status, 200);
    const auth = await login.json(), cookie = login.headers.get('set-cookie').split(';')[0];
    const secondApi = async (path, body) => {
      const response = await fetch(origin + '/personal/v1' + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    console.log(JSON.stringify({ stage: 'configured', mode, hostId: h.hostId, modelProfileId: h.modelProfileId }));
    let projectId;
    if (mode === 'work') {
      const rootPath = join(h.base, 'synthetic-work'); await mkdir(rootPath);
      projectId = (await h.api('/projects', { requestId: randomUUID(), name: '合成记忆验收', rootPath, permission: 'write' })).body.project.projectId;
    }
    const create = async (remote = false) => {
      const api = remote ? secondApi : h.api;
      if (projectId) {
        const input = { requestId: randomUUID(), modelProfileId: h.modelProfileId };
        const result = await until(async () => {
          const response = await api(`/projects/${projectId}/sessions`, input);
          return response.status === 409 && response.body.error?.code === 'SESSION_BUSY' ? null : response;
        }, 30000);
        assert.equal(result.status, 202, JSON.stringify(result.body));
        return (await until(async () => { const c = (await api(`/commands/${result.body.command.commandId}`)).body.command; return c.state === 'accepted_by_dsh' && c; })).sessionId;
      }
      const input = { requestId: randomUUID(), kind: 'session.create', targetDeviceId: h.hostId, modelProfileId: h.modelProfileId };
      const result = await until(async () => {
        const response = await api('/commands', input);
        if (response.status === 409 && response.body.error?.code === 'SESSION_BUSY') return null;
        assert.equal(response.status, 202, JSON.stringify(response.body)); return response.body;
      }, 30000);
      return (await until(async () => { const c = (await api(`/commands/${result.command.commandId}`)).body.command; return c.state === 'accepted_by_dsh' && c; })).sessionId;
    };
    let sessionId = await create();
    const inputs = ['记住：我喜欢喝乌龙茶', '我喜欢喝什么茶', '不对，纠正我喝茶的偏好：我现在喜欢红茶，不是乌龙茶。请更新这条记忆。', '我喜欢喝什么茶', '忘掉我喝茶的偏好', '我喜欢喝什么茶'];
    for (let i = 0; i < inputs.length; i++) {
      const remote = i === 1 || i === 3 || i === 5;
      if (remote) sessionId = await create(true);
      const prior = (await h.api(`/sessions/${sessionId}/events`)).body.events ?? [];
      const previousIds = new Set(prior.map(event => event.seq ?? event.eventId));
      const message = { requestId: randomUUID(), kind: 'session.message', targetDeviceId: h.hostId, sessionId, text: inputs[i] };
      const sent = remote ? await secondApi('/commands', message) : null;
      if (sent) assert.equal(sent.status, 202, JSON.stringify(sent.body));
      const command = remote ? await until(async () => {
        const current = (await secondApi(`/commands/${sent.body.command.commandId}`)).body.command;
        if (['rejected', 'uncertain'].includes(current.state)) throw Error(current.errorCode);
        return current.state === 'accepted_by_dsh' && current;
      }) : await h.command(message);
      const step = { input: inputs[i], client: remote ? 'independent-http-client' : 'desktop', sessionId, commandId: command.commandId }; row.steps.push(step);
      const terminal = await until(async () => {
        const task = (await h.api(`/tasks/${command.commandId}`)).body;
        const approvals = (await h.api(`/sessions/${sessionId}/approvals`)).body.approvals;
        const pending = approvals.find(a => a.status === 'pending');
        if (pending) return { task, pending };
        if (['completed', 'failed', 'aborted'].includes((task.task ?? task).replyEvidence?.status)) return { task };
      }, 240000);
      const task = terminal.task.task ?? terminal.task;
      step.status = task.replyEvidence?.status;
      step.executionSteps = task.executionSteps;
      if (terminal.pending) {
        step.pending = { intent: terminal.pending.intent, toolName: terminal.pending.toolName };
        await h.api(`/sessions/${sessionId}/approvals/${terminal.pending.approvalId}`, { requestId: randomUUID(), outcome: 'rejected' });
        await h.complete(command).catch(() => {});
      }
      const detail = (await h.api(`/sessions/${sessionId}/events`)).body;
      step.reply = (detail.events ?? []).filter(e => e.type === 'assistant.message' && !previousIds.has(e.seq ?? e.eventId)).map(e => e.data?.text ?? '').join('\n');
      await h.page.evaluate(async id => {
        await fix45Core.refreshModels(); await fix45Core.refreshMemoryStatus();
        await fix45Core.refreshLogicalSessions();
        await fix45Core.selectSession(id);
      }, sessionId);
      await h.page.waitForTimeout(400);
      const screenshot = await h.app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
        const window = BrowserWindow.getAllWindows()[0], handle = window.getNativeWindowHandle();
        const id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1800, height: 1400 } });
        const own = sources.find(source => source.id.split(':')[1] === id);
        if (!own || own.thumbnail.isEmpty()) throw Error('Owned Electron screenshot unavailable');
        return own.thumbnail.toPNG().toString('base64');
      });
      await writeFile(join(out, `${baseline ? 'main' : 'fixed'}-${mode}-${i + 1}.png`), Buffer.from(screenshot, 'base64'));
      console.log(JSON.stringify({ mode, step: i + 1, status: step.status, pending: step.pending, reply: step.reply }));
      step.memoryStatus = (await h.api('/memory/status')).body;
      step.items = (await h.api('/memory/items?kind=all')).body;
      step.coreJobs = await h.app.evaluate(async (_, ownerId) => ia2b.context.memoryManager.query(ownerId, 'query_jobs', { operation: 'list' }), h.ownerId);
      if ([0, 2, 4].includes(i)) step.settledStatus = await until(async () => {
        const status = (await h.api('/memory/status')).body;
        return !status.pendingFormationCount && !status.pendingBoundaryCount && status;
      }, 240000);
      if (i === 0) await until(async () => {
        const items = (await h.api('/memory/items?kind=all&query=乌龙茶')).body.items;
        return items?.some(item => item.currentState === 'current');
      }, 240000);
    }
    row.remainingTea = (await h.api('/memory/items?kind=all&query=乌龙茶')).body.items;
    await h.close();
    row.usage = await h.usage();
    await writeFile(join(out, `${baseline ? 'main' : 'fixed'}-${mode}-model-trace.jsonl`), clean(await readFile(join(h.base, 'model-messages.jsonl'), 'utf8')));
    await writeFile(join(out, `${baseline ? 'main' : 'fixed'}-${mode}-host.log`), clean(await readFile(join(h.base, 'host.log'), 'utf8')));
    if (!baseline) {
      assert.match(row.steps[1].reply, /乌龙茶/);
      assert.equal(row.steps[2].pending, undefined);
      assert.equal(row.steps[2].status, 'completed');
      assert.ok(row.steps[4].executionSteps.some(s => s.toolName === 'memory_forget'));
      assert.equal(row.steps[2].executionSteps.some(s => ['glob', 'grep', 'read', 'write', 'edit', 'pwsh', 'bash'].includes(s.toolName)), false);
      assert.match(row.steps[3].reply, /红茶/);
      assert.doesNotMatch(row.steps[5].reply, /乌龙茶|红茶/);
      for (const step of row.steps) assert.ok(step.reply.trim(), 'Every turn has a final reply');
    }
    await removeFixture(h.base); h = null;
  }
} catch (error) {
  report.failure = clean(error.stack ?? String(error));
  if (h) for (const file of ['host.log', 'requests.jsonl', 'model-messages.jsonl']) {
    await writeFile(join(out, 'failure-' + file), clean(await readFile(join(h.base, file), 'utf8').catch(() => '')));
  }
  throw error;
}
finally {
  if (h) { await h.close(); await removeFixture(h.base); }
  if (lease) await unlink(lease);
  await writeFile(join(out, `${baseline ? 'main' : 'fixed'}-report.json`), clean(JSON.stringify(report, null, 2)) + '\n');
}
