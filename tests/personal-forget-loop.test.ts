import './helpers/posix-project-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, lstat, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { phoneRuntime } from '../services/cloud/test/relay-phone-runtime.mjs';
import { handlePersonalMemoryTool } from '../src/personal-access/memory-runtime.mjs';
import { REPEAT_TOOL_LIMIT, REPEAT_TOOL_MESSAGE } from '../src/plugins/weftmate-personal-tool-loop.mjs';

// Load after the Linux folder-selection fixture installs its real POSIX reader.
const { createPersonalAccessService } = await import('../src/personal-access/index.mjs');

process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED = '1';
const textOf = (m: any) => typeof m.content === 'string' ? m.content : (m.content ?? []).map((p: any) => p.text ?? '').join('\n');
async function until(read: () => Promise<any>) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { const result = await read(); if (result) return result; await new Promise(r => setTimeout(r, 30)); }
  throw Error('isolated host did not settle');
}
async function removeLinks(directory: string) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if ((await lstat(file)).isSymbolicLink()) await unlink(file);
    else if (item.isDirectory()) await removeLinks(file);
  }
}

/** Real HTTP host, managed DSH process, native tools and model requests. Only inference and Core replies are scripted. */
async function fixture(t: any, { pendingCleanup = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-fix45-'));
  const calls: any[] = [], commands: any[] = [], revisions = new Map<string, number>(), facts = new Map<string, string>();
  let host: any, ownerId: string, releaseRepeat: () => void = () => {}, repeatedStarted: () => void = () => {};
  const repeatGate = new Promise<void>(r => { releaseRepeat = r; });
  const repeatReady = new Promise<void>(r => { repeatedStarted = r; });
  const manager: any = {
    status: async () => ({ state: 'ready', capabilities: { correct: true, deleteWorldItem: true, deleteEvidence: true } }),
    recall: async (owner: string) => ({ state: 'ready', worldRevision: revisions.get(owner) ?? 1,
      contextText: facts.has(owner) ? `记忆：用户喜欢喝${facts.get(owner)}。` : '',
      memories: facts.has(owner) ? [{ kind: 'cognition', id: 'tea-fact', summary: `用户喜欢喝${facts.get(owner)}。` }] : [] }),
    query: async (owner: string, method: string, args: any) => {
      assert.equal(owner, ownerId); assert.equal(method, 'query_world'); assert.equal(args.item_id, 'tea-fact');
      return { world_revision: revisions.get(owner) ?? 1, item: { object_kind: 'cognition', item_id: 'tea-fact', value: { content: facts.get(owner) } } };
    },
    submitCommand: async (owner: string, proposal: any) => {
      assert.equal(owner, ownerId); commands.push(proposal);
      const revision = revisions.get(owner) ?? 1;
      if (proposal.expectedWorldRevision !== revision) return { receipt: { command_id: proposal.requestId, result_state: 'revision_conflict', after_revision: revision } };
      if (proposal.operation === 'delete_world_item') facts.delete(owner);
      else { assert.equal(proposal.operation, 'correct_world_item'); facts.set(owner, proposal.payload.correction_text); }
      revisions.set(owner, revision + 1);
      return { receipt: { command_id: proposal.requestId, result_state: 'applied', after_revision: revision + 1,
        ...(pendingCleanup ? { storage_cleanup: { state: 'pending', detail_code: 'host_journal_cleanup_pending' } } : {}) } };
    },
    retryCleanupByRequest: async (owner: string, requestId: string) => {
      assert.equal(owner, ownerId); assert.match(requestId, /^memory-tool:[a-f0-9]{64}$/);
      return { receipt: { command_id: requestId, result_state: 'applied', after_revision: revisions.get(owner),
        storage_cleanup: { state: 'complete', detail_code: 'current_journal_committed' } } };
    },
  };
  const tool = (name: string, args: any, count: number) => ({ content: '', tool_calls: [{ id: `fix45-${count}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const runtime = await phoneRuntime(root, [], {
    respond(body: any) {
      if (!body.tools?.length) return { content: '合成对话' };
      const index = body.messages.findLastIndex((m: any) => m.role === 'user' && textOf(m).startsWith('FIX45_'));
      const input = index < 0 ? '' : textOf(body.messages[index]);
      const prior = body.messages.slice(index + 1).flatMap((m: any) => m.tool_calls ?? []);
      const step = prior.length;
      if (input.startsWith('FIX45_FOLLOWUP')) return { content: '排队的更正已处理。' };
      if (input.startsWith('FIX45_REPEAT_FILES')) {
        if (step === 0) return tool('load_tools', { names: ['glob'] }, step);
        if (step >= REPEAT_TOOL_LIMIT + 2) throw Error('file repeat limit was bypassed');
        const args = step % 2 ? { pattern: '**/*.fix45-missing', path: runtime.project }
          : { path: runtime.project, pattern: '**/*.fix45-missing' };
        return tool('glob', args, step);
      }
      if (input.startsWith('FIX45_REPEAT')) {
        if (step === 0) return tool('load_tools', { names: ['memory_query'] }, step);
        // Deliberately ignore every DSH reminder.
        if (step >= REPEAT_TOOL_LIMIT + 2) throw Error('repeat limit was bypassed');
        return tool('memory_query', { query: '茶' }, step);
      }
      if (input.startsWith('FIX45_FORGET') || input.startsWith('FIX45_CORRECT') || input.startsWith('FIX45_CONFLICT')) {
        const action = input.startsWith('FIX45_CORRECT') ? 'memory_correct' : 'memory_forget';
        if (step === 0) return tool('load_tools', { names: ['memory_query', action] }, step);
        if (step === 1) return tool('memory_query', { query: '茶的偏好' }, step);
        if (step === 2) return tool(action, { kind: 'cognition', id: 'tea-fact', expectedWorldRevision: input.startsWith('FIX45_CONFLICT') ? 0 : revisions.get(ownerId) ?? 1,
          ...(action === 'memory_correct' ? { text: '红茶' } : {}) }, step);
        const result = body.messages.findLast((m: any) => m.role === 'tool');
        return { content: textOf(result).includes('revision_conflict') ? '记忆刚刚有变化，这次还没忘掉。' : action === 'memory_correct' ? '已纠正。' : '已忘掉。' };
      }
      return { content: facts.has(ownerId) ? `你喜欢${facts.get(ownerId)}。` : '我目前不知道你的茶偏好。' };
    },
    memoryRequestHandler: async (request: any) => {
      const binding = host.ownerForSession(request.sessionId); assert.ok(binding); assert.equal(binding.ownerId, ownerId);
      if (request.action === 'ingest') return { state: 'accepted' };
      if (request.action === 'recall') return manager.recall(binding.ownerId);
      calls.push(request.tool);
      if (request.tool.name === 'memory_query' && request.tool.arguments.query === '茶' &&
          calls.filter(c => c.name === 'memory_query' && c.arguments.query === '茶').length === 2) {
        repeatedStarted(); await repeatGate;
      }
      return handlePersonalMemoryTool(manager, binding.ownerId, request.tool, { sessionId: request.sessionId, modelTier: 'cloud' });
    },
  });
  host = await createPersonalAccessService({ root: join(root, 'account'), port: 0, backend: runtime.backend }); runtime.setHost(host);
  t.after(async () => { releaseRepeat(); await runtime.close(); await host.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await removeLinks(root); await rm(root, { recursive: true, force: true }); });
  await runtime.start(); const { origin, hostId } = await host.start(), grant = await host.issueSetupGrant();
  const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username: 'SyntheticForget', password: 'synthetic forget loop password', deviceName: 'Fixture' }) });
  assert.equal(setup.status, 201); const auth = await setup.json(); ownerId = auth.account.ownerId; facts.set(ownerId, '乌龙茶');
  const cookie = setup.headers.get('set-cookie')!.split(';')[0];
  const api = async (path: string, body?: any) => {
    const res = await fetch(origin + '/personal/v1' + path, { method: body ? 'POST' : 'GET', headers: { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    const value = await res.json(); assert.ok(res.ok, JSON.stringify({ path, status: res.status, value })); return value;
  };
  const accepted = async (result: any) => until(async () => { const c = (await api('/commands/' + result.command.commandId)).command; return c.state === 'accepted_by_dsh' && c; });
  const create = async (work = false) => {
    if (work) {
      const rootPath = join(root, randomUUID()); await mkdir(rootPath);
      const project = (await api('/projects', { requestId: randomUUID(), name: '合成项目', rootPath, permission: 'write' })).project;
      return (await accepted(await api(`/projects/${project.projectId}/sessions`, { requestId: randomUUID(), modelProfileId: 'synthetic' }))).sessionId;
    }
    return (await accepted(await api('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic' }))).sessionId;
  };
  const send = async (sessionId: string, text: string, intent = 'queue') => accepted(await api('/commands', { requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId, text, intent }));
  const complete = async (command: any) => {
    try { return await until(async () => {
      const history = await api(`/sessions/${command.sessionId}/events`);
      const terminal = history.events?.find((e: any) => e.type === 'task.ended' && e.data.receiptId === command.receiptId);
      return terminal && { ...await api(`/tasks/${command.commandId}`), terminal };
    }); }
    catch { const task = await api(`/tasks/${command.commandId}`); const history = await api(`/sessions/${command.sessionId}/events`);
      throw Error(JSON.stringify({ evidence: task.replyEvidence, calls: calls.map(c => c.name), history: history.events?.slice(-5), taskKeys: Object.keys(task) })); }
  };
  return { create, send, complete, api, facts, ownerId: () => ownerId, calls, commands, runtime, repeatReady, releaseRepeat };
}

for (const work of [false, true]) test(`forget uses Core commands and no file tools in ${work ? 'work' : 'chat'} mode`, { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create(work);
  const forgotten = await f.complete(await f.send(session, 'FIX45_FORGET 忘掉我喝茶的偏好'));
  assert.equal(forgotten.terminal.data.reason, 'completed');
  assert.deepEqual(f.calls.map(c => c.name), ['memory_query', 'memory_forget']);
  assert.equal(f.commands[0].operation, 'delete_world_item');
  assert.equal(f.commands[0].deleteConversationSnippets, false);
  assert.equal(forgotten.executionSteps.some((s: any) => ['glob', 'grep', 'read', 'write', 'edit', 'pwsh', 'bash'].includes(s.toolName)), false);
  assert.equal((await f.api(`/sessions/${session}/approvals`)).approvals.some((a: any) => a.intent === 'work-switch'), false);
  const fresh = await f.create(work), answer = await f.complete(await f.send(fresh, 'FIX45_QUERY 我喜欢喝什么茶'));
  assert.equal(answer.terminal.data.reason, 'completed');
  const events = (await f.api(`/sessions/${fresh}/events`)).events;
  assert.doesNotMatch(events.filter((e: any) => e.type === 'assistant.message').map((e: any) => e.data.text).join('\n'), /乌龙茶/);
});

test('correction uses the latest Core revision and conflict does not claim forgetting', { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create();
  await f.complete(await f.send(session, 'FIX45_CORRECT 纠正：我现在喜欢红茶'));
  assert.equal(f.commands[0].operation, 'correct_world_item'); assert.equal(f.facts.get(f.ownerId()), '红茶');
  const conflict = await f.complete(await f.send(session, 'FIX45_CONFLICT 忘掉茶偏好'));
  assert.equal(conflict.terminal.data.reason, 'completed'); assert.equal(f.facts.get(f.ownerId()), '红茶');
  const events = (await f.api(`/sessions/${session}/events`)).events;
  assert.match(events.filter((e: any) => e.type === 'assistant.message').at(-1).data.text, /还没忘掉/);
});

test('DSH repeats stop at the limit and a queued correction proceeds', { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create();
  const repeated = await f.send(session, 'FIX45_REPEAT 一直重复查询');
  await f.repeatReady;
  const followup = await f.send(session, 'FIX45_FOLLOWUP 后面补发的更正');
  f.releaseRepeat();
  const stopped = await f.complete(repeated);
  assert.equal(stopped.terminal.data.reason, 'blocked');
  assert.equal(f.calls.filter(c => c.name === 'memory_query').length, REPEAT_TOOL_LIMIT);
  const continued = await f.complete(followup);
  assert.equal(continued.terminal.data.reason, 'completed');
  const events = (await f.api(`/sessions/${session}/events`)).events;
  assert.ok(events.some((e: any) => e.type === 'assistant.message' && e.data.text === REPEAT_TOOL_MESSAGE));
  assert.ok(events.some((e: any) => e.type === 'assistant.message' && e.data.text === '排队的更正已处理。'));
});

test('DSH stops actual glob repeats even when model argument keys change order', { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create(true);
  const stopped = await f.complete(await f.send(session, 'FIX45_REPEAT_FILES 一直搜文件'));
  assert.equal(stopped.terminal.data.reason, 'blocked');
  assert.equal(stopped.executionSteps.filter((s: any) => s.toolName === 'glob').length, REPEAT_TOOL_LIMIT);
  const events = (await f.api(`/sessions/${session}/events`)).events;
  assert.ok(events.some((e: any) => e.type === 'assistant.message' && e.data.text === REPEAT_TOOL_MESSAGE));
});

test('pending Core deletion cleanup retries on native idle and does not keep repeating', { timeout: 60000 }, async t => {
  const f = await fixture(t, { pendingCleanup: true }), session = await f.create();
  await f.complete(await f.send(session, 'FIX45_FORGET 忘掉茶偏好'));
  await until(async () => f.calls.some(c => c.name === 'memory_cleanup'));
  const fresh = await f.create(); await f.complete(await f.send(fresh, 'FIX45_QUERY 我喜欢什么茶'));
  assert.equal(f.calls.filter(c => c.name === 'memory_cleanup').length, 1);
  assert.equal(f.facts.has(f.ownerId()), false);
});
