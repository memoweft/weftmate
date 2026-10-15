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
import { stagePersonalPlugins } from './support/personal-plugins.ts';
import { pathToFileURL } from 'node:url';

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
  const calls: any[] = [], commands: any[] = [], recallCalls: any[] = [], revisions = new Map<string, number>(), facts = new Map<string, string>();
  let progress = 0;
  let host: any, ownerId: string, releaseRepeat: () => void = () => {}, repeatedStarted: () => void = () => {};
  const repeatGate = new Promise<void>(r => { releaseRepeat = r; });
  const repeatReady = new Promise<void>(r => { repeatedStarted = r; });
  const manager: any = {
    status: async () => ({ state: 'ready', capabilities: { correct: true, deleteWorldItem: true, deleteEvidence: true } }),
    recall: async (owner: string, input: any = {}) => {
      recallCalls.push(input);
      if (input.query === '进度') return { state: 'ready', worldRevision: 1, memories: [], contextText: `进度 ${++progress}` };
      return { state: 'ready', worldRevision: revisions.get(owner) ?? 1,
      contextText: facts.has(owner) ? `记忆：用户喜欢喝${facts.get(owner)}。` : '',
      memories: facts.has(owner) ? [{ kind: 'cognition', id: 'tea-fact', summary: `用户喜欢喝${facts.get(owner)}。` }] : [] };
    },
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
      const index = body.messages.findLastIndex((m: any) => m.role === 'user' && textOf(m).startsWith('FIX45_'));
      const input = index < 0 ? '' : textOf(body.messages[index]);
      if (index < 0) return { content: '合成对话' };
      const prior = body.messages.slice(index + 1).flatMap((m: any) => m.tool_calls ?? []);
      const step = prior.length;
      if (input.startsWith('FIX45_FOLLOWUP')) return { content: '排队的更正已处理。' };
      if (input.startsWith('FIX45_PRIVATE_QUERY')) {
        if (step === 0) return tool('load_tools', { names: ['memory_query'] }, step);
        if (step === 1) return tool('memory_query', { query: '茶' }, step);
        return { content: '已处理查询回执。' };
      }
      if (input.startsWith('FIX45_PRIVATE_WRITE')) {
        const action = input.includes('纠正') ? 'memory_correct' : 'memory_forget';
        if (step === 0) return tool('load_tools', { names: [action] }, step);
        if (step === 1) return tool(action, { kind: 'cognition', id: 'tea-fact', expectedWorldRevision: revisions.get(ownerId) ?? 1,
          ...(action === 'memory_correct' ? { text: '红茶' } : {}) }, step);
        return { content: '写入回执已处理。' };
      }
      if (input.startsWith('FIX45_PROGRESS')) {
        if (step === 0) return tool('load_tools', { names: ['memory_query'] }, step);
        if (step <= 12) return tool('memory_query', { query: '进度' }, step);
        return { content: `最后一次结果：${textOf(body.messages.findLast((m: any) => m.role === 'tool'))}` };
      }
      if (input.startsWith('FIX45_FINISH_REPEAT')) {
        if (step === 0) return tool('load_tools', { names: ['memory_query'] }, step);
        if (step <= REPEAT_TOOL_LIMIT) return tool('memory_query', { query: '茶的偏好' }, step);
        return { content: `${REPEAT_TOOL_MESSAGE} 最后一次结果：${textOf(body.messages.findLast((m: any) => m.role === 'tool'))}` };
      }
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
      const memoryPolicy = await host.memoryTurnPolicy(binding.ownerId, request.sessionId, request.turn);
      if (request.action === 'ingest') return { state: 'accepted' };
      if (request.action === 'recall') return memoryPolicy.recall ? manager.recall(binding.ownerId)
        : { state: 'withheld', reasonCode: 'RECALL_DISABLED', memoryPolicy };
      calls.push(request.tool);
      if (request.tool.name === 'memory_query' && request.tool.arguments.query === '茶' &&
          calls.filter(c => c.name === 'memory_query' && c.arguments.query === '茶').length === 2) {
        repeatedStarted(); await repeatGate;
      }
      return handlePersonalMemoryTool(manager, binding.ownerId, request.tool, { sessionId: request.sessionId, modelTier: 'cloud', memoryPolicy });
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
  const create = async (work = false, memoryOptions = {}) => {
    if (work) {
      const rootPath = join(root, randomUUID()); await mkdir(rootPath);
      const project = (await api('/projects', { requestId: randomUUID(), name: '合成项目', rootPath, permission: 'write' })).project;
      return (await accepted(await api(`/projects/${project.projectId}/sessions`, { requestId: randomUUID(), modelProfileId: 'synthetic' }))).sessionId;
    }
    return (await accepted(await api('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic', ...memoryOptions }))).sessionId;
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
  return { create, send, complete, api, facts, ownerId: () => ownerId, calls, commands, recallCalls, runtime, repeatReady, releaseRepeat };
}

test('recall-disabled conversations do not read or send memory through tools, while writes remain available', { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create(false, { temporary: true, recallEnabled: false });
  await f.complete(await f.send(session, 'FIX45_PRIVATE_QUERY 查询历史偏好'));
  assert.equal(f.recallCalls.length, 0, 'neither automatic recall nor memory_query may read Core');
  assert.doesNotMatch(JSON.stringify(f.runtime.requests), /乌龙茶/, 'memory content must not enter model requests');
  const results = f.runtime.requests.flatMap((r: any) => r.messages.filter((m: any) => m.role === 'tool').map(textOf));
  assert.ok(results.some((r: string) => r.includes('withheld') && r.includes('这段对话没开记忆')));
  assert.ok(results.every((r: string) => !r.includes('RECALL_DISABLED')), 'the setting state survives without exposing its internal reason code');
  await f.complete(await f.send(session, 'FIX45_PRIVATE_WRITE 纠正为红茶'));
  assert.equal(f.facts.get(f.ownerId()), '红茶');
  await f.complete(await f.send(session, 'FIX45_PRIVATE_WRITE 忘掉茶偏好'));
  assert.equal(f.facts.has(f.ownerId()), false);
  assert.deepEqual(f.commands.map(c => c.operation), ['correct_world_item', 'delete_world_item']);
});

test('changing results reset repetition and the model consumes the completed result', { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create();
  const completed = await f.complete(await f.send(session, 'FIX45_PROGRESS 连续查询更新的进度'));
  assert.equal(completed.terminal.data.reason, 'completed');
  assert.equal(f.calls.filter(c => c.name === 'memory_query').length, 12);
  assert.doesNotMatch(JSON.stringify(f.runtime.requests), /You are repeating the exact same tool call/,
    'the arguments-only reminder must not urge the model to stop changing results');
  const events = (await f.api(`/sessions/${session}/events`)).events;
  assert.match(events.filter((e: any) => e.type === 'assistant.message').at(-1).data.text, /最后一次结果.*进度 12/);
});

test('when an unchanged loop stops, its last result still reaches a final model response', { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create();
  const completed = await f.complete(await f.send(session, 'FIX45_FINISH_REPEAT 重复查询后说明最后一次结果'));
  assert.equal(completed.terminal.data.reason, 'completed');
  assert.equal(f.calls.filter(c => c.name === 'memory_query').length, REPEAT_TOOL_LIMIT);
  const finalRequest = f.runtime.requests.findLast((r: any) => r.messages.some((m: any) => textOf(m).startsWith('FIX45_FINISH_REPEAT')));
  assert.deepEqual(finalRequest.tools ?? [], [], 'the final result is summarized without exposing more tools');
  const events = (await f.api(`/sessions/${session}/events`)).events;
  assert.match(events.filter((e: any) => e.type === 'assistant.message').at(-1).data.text, /最后一次结果.*乌龙茶/);
});

test('native job_output waits are never stopped by counts, including constant progress and completion on the eighth wait', async t => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-fix45-wait-'));
  const stage = stagePersonalPlugins(root);
  const vendor = (name: string) => pathToFileURL(join(process.cwd(), 'vendor/dsh-runtime/node_modules/@deepseek-ai', name, 'lib/index.js')).href;
  const [{ Context }, prompt, sessions, tools, { createScope }, repeat, loop] = await Promise.all([
    import(vendor('cordis')), import(vendor('dsh-system-prompt')), import(vendor('dsh-session')),
    import(vendor('dsh-tools')), import(vendor('dsh-scope')), import(vendor('dsh-repeat-tool-reminder')),
    import(pathToFileURL(stage.stageFile(join(process.cwd(), 'src/plugins/weftmate-personal-tool-loop.mjs'))).href),
  ]);
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await removeLinks(root); await rm(root, { recursive: true, force: true }); });
  await ctx.plugin(prompt.default, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' });
  await ctx.plugin(sessions.default); await ctx.plugin(tools.default, { mode: 'native', maxParallelSubCalls: 1 });
  // Exercise the current deployment's original reminder alongside its wrapper.
  await ctx.plugin(repeat, { thresholds: [3, 5, 8], include: [], exclude: [], argumentsPreviewChars: 500 });
  await ctx.plugin(loop.default);
  for (const variant of ['constant', 'changing', 'complete-at-eight']) {
    let count = 0;
    const session = ctx.sessions.create(`wait-${variant}`, { meta: { agentPreset: 'personal-remote' } });
    const agent: any = { id: session.id, session, ctx: null, options: {}, status: 'running', inbox: { hasPending: false }, wakeDriver() {} };
    agent.ctx = createScope(ctx, agent).ctx;
    session.append('turn/start', { turn: 1 });
    agent.ctx.get('tools').register(tools.defineTool({ name: 'job_output', description: 'Wait for a synthetic owned job.',
      parameters: { job_id: { type: 'string', required: true }, wait: { type: 'boolean', required: true } },
      output: { schema: { type: 'json' }, render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: () => { count++; return { state: variant === 'complete-at-eight' && count >= 8 ? 'completed' : 'running',
        output: variant === 'changing' ? `进度 ${count}` : '同样的进度' }; } }));
    for (let i = 0; i < 12; i++) {
      const result = await ctx.get('tools').execute({ name: 'job_output', arguments: { job_id: 'owned-job', wait: true }, agent,
        callId: `${variant}-${i}`, signal: new AbortController().signal });
      assert.equal(result.isError, false, `normal wait ${i + 1} must execute`);
      if (variant === 'complete-at-eight' && i >= 7) assert.equal(result.value.state, 'completed');
      if (variant === 'changing') assert.equal(result.value.output, `进度 ${i + 1}`);
    }
    assert.equal(count, 12);
  }
});

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
