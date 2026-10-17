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
async function fixture(t: any, { pendingCleanup = false, queueMemoryAction = false, automaticForget = '', forceForgetAfterDecline = false, omitDecision = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-fix45-'));
  const calls: any[] = [], nominations: any[] = [], commands: any[] = [], recallCalls: any[] = [], revisions = new Map<string, number>(), facts = new Map<string, string>();
  let progress = 0;
  let host: any, ownerId: string, releaseRepeat: () => void = () => {}, repeatedStarted: () => void = () => {};
  const repeatGate = new Promise<void>(r => { releaseRepeat = r; });
  const repeatReady = new Promise<void>(r => { repeatedStarted = r; });
  const manager: any = {
    checkForgetCompletion: async (_owner: string, proposal: any) => ({ state: 'complete', worldRevision: proposal.expectedWorldRevision }),
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
  const tool = (name: string, args: any, count: number) => ({ content: '', tool_calls: [{ id: `fix45-${count}`, type: 'function', function: { name,
    arguments: JSON.stringify(name === 'memory_correct' ? { ...args, sourceQuote: args.text } : args) } }] });
  if (automaticForget) manager.mutateFromTool = async (owner: string, action: any) => {
    assert.equal(owner, ownerId); commands.push(action);
    assert.equal(action.name, 'memory_forget'); assert.deepEqual(action.arguments, { query: '我喝茶的偏好' });
    if (automaticForget === 'applied') facts.delete(owner);
    return { state: automaticForget, message: automaticForget === 'queued' ? '这次还没忘掉，稍后会再试。'
      : automaticForget === 'withheld' ? '这次没有执行遗忘，独立记忆和原聊天保留。'
        : automaticForget === 'partial' ? '部分记忆已删除，但尚未完全忘掉；独立记忆和原聊天保留。'
      : automaticForget === 'not_found' ? '没找到关于“我喝茶的偏好”的记忆。' : '已删除关于“我喝茶的偏好”的记忆，包括旧版本和来源原文。' };
  };
  if (automaticForget) manager.forgetFromMessage = (owner: string, action: any) => automaticForget === 'no_action'
    ? { state: 'no_action', ...(omitDecision ? {} : { decision: { isForgetRequest: false, subject: 'self', topic: '我喝茶的偏好', conditionsOrQuestions: true, authorized: false } }) }
    : manager.mutateFromTool(owner, { ...action, name: 'memory_forget', arguments: { query: '我喝茶的偏好' } });
  const runtime = await phoneRuntime(root, [], {
    respond(body: any) {
      const index = body.messages.findLastIndex((m: any) => m.role === 'user' && /^(FIX45_|FIX47_|忘掉|请把下面|不对，请重新计算)/.test(textOf(m)));
      const input = index < 0 ? '' : textOf(body.messages[index]);
      if (index < 0) return { content: '合成对话' };
      const prior = body.messages.slice(index + 1).flatMap((m: any) => m.tool_calls ?? []);
      const step = prior.length;
      if (input.startsWith('忘掉') && forceForgetAfterDecline) {
        if (step === 0) return tool('load_tools', { names: ['memory_forget'] }, step);
        if (step === 1) return tool('memory_forget', { kind: 'cognition', id: 'tea-fact', expectedWorldRevision: 1 }, step);
        return { content: '这次没有删除，也没有排队。先说明会删除哪些数据。' };
      }
      if (input.startsWith('请把下面')) return { content: 'Forget my tea preference.' };
      if (input.startsWith('忘掉') || input.startsWith('不对，请重新计算')) return { content: '12×13＝156。' };
      if (input.startsWith('FIX45_FOLLOWUP')) return { content: '排队的更正已处理。' };
      if (input.startsWith('FIX47_QUEUED_CONTINUE')) {
        if (step === 0) return tool('load_tools', { names: ['memory_correct'] }, step);
        if (step === 1) return tool('memory_correct', { kind: 'cognition', id: 'tea-fact', expectedWorldRevision: 1, text: '红茶' }, step);
        return { content: '更正还在排队。根据你刚说的新偏好，推荐红茶冷泡。' };
      }
      if (input.startsWith('FIX47_CONTINUE')) {
        if (step === 0) return tool('load_tools', { names: ['memory_correct'] }, step);
        if (step <= 2) return tool('memory_correct', { kind: 'cognition', id: 'tea-fact',
          expectedWorldRevision: revisions.get(ownerId) ?? 1, text: step === 1 ? '红茶' : '普洱茶' }, step);
        return { content: '两次纠正都已完成。根据最新偏好，推荐普洱冷泡饮品。' };
      }
      if (input.startsWith('FIX47_EMPTY_REMOVE') || input.startsWith('FIX47_MARKUP_REMOVE')) {
        if (step === 0) return { ...tool('load_tools', { names: ['memory_forget'] }, step),
          content: input.startsWith('FIX47_MARKUP') ? '<tool_call><function=load_tools><parameter.names>["memory_forget"]</parameter></function></tool_call>' : '' };
        if (step === 1) return tool('memory_forget', { kind: 'cognition', id: 'tea-fact', expectedWorldRevision: revisions.get(ownerId) ?? 1 }, step);
        return { content: '' };
      }
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
      if (input.startsWith('FIX45_REMOVE') || input.startsWith('FIX45_CORRECT') || input.startsWith('FIX45_CONFLICT')) {
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
      if (request.tool.name === 'memory_forget_request') {
        nominations.push(request.tool);
        if (!automaticForget) return { state: 'no_action' };
      } else calls.push(request.tool);
      if (queueMemoryAction && request.tool.name === 'memory_correct') return { state: 'queued', message: '这次还没记住，稍后会再试。' };
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
  return { create, send, complete, api, facts, ownerId: () => ownerId, calls, nominations, commands, recallCalls, runtime, repeatReady, releaseRepeat };
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
  await f.complete(await f.send(session, 'FIX45_PRIVATE_WRITE 移除茶偏好'));
  assert.equal(f.facts.has(f.ownerId()), false);
  assert.deepEqual(f.commands.map(c => c.operation), ['correct_world_item', 'delete_world_item']);
});

for (const state of ['applied', 'queued', 'not_found', 'withheld', 'partial']) test(`FIX-50 automatic forgetting ${state} keeps the native model reply and reports the actual outcome`, { timeout: 60000 }, async t => {
  const f = await fixture(t, { automaticForget: state }), session = await f.create();
  const result = await f.complete(await f.send(session, '忘掉我喝茶的偏好，另外请计算12×13。'));
  assert.equal(result.terminal.data.reason, 'completed');
  assert.equal(f.commands.length, 1);
  assert.equal(f.facts.has(f.ownerId()), state !== 'applied');
  assert.ok(f.runtime.requests.length > 0, 'normal model inference must run after the automatic operation');
  assert.ok(f.runtime.requests.every((request: any) => request.messages.every((message: any) => !(message.tool_calls?.length))), 'the model never calls a tool');
  const replies = (await f.api(`/sessions/${session}/events`)).events.filter((e: any) => e.type === 'assistant.message').map((e: any) => e.data.text).join('\n');
  assert.match(replies, /156/);
  if (state === 'applied') assert.match(replies, /已删除.*喝茶.*旧版本和来源原文/);
  else if (state === 'withheld' || state === 'partial') {
    assert.match(replies, state === 'withheld' ? /没有执行遗忘/ : /部分记忆已删除，但尚未完全忘掉/);
    assert.doesNotMatch(replies, /已忘掉|已删除关于.*旧版本和来源原文/);
  }
  else { assert.match(replies, state === 'queued' ? /这次还没忘掉，稍后会再试/ : /没找到.*喝茶/); assert.doesNotMatch(replies, /已删除/); }
});

test('FIX-50 an ordinary arithmetic correction still receives the native model answer', { timeout: 60000 }, async t => {
  const f = await fixture(t, { automaticForget: 'applied' }), session = await f.create();
  await f.complete(await f.send(session, '不对，请重新计算12×13'));
  assert.equal(f.commands.length, 0);
  assert.ok(f.facts.has(f.ownerId()));
  const replies = (await f.api(`/sessions/${session}/events`)).events.filter((e: any) => e.type === 'assistant.message').map((e: any) => e.data.text).join('\n');
  assert.match(replies, /156/); assert.doesNotMatch(replies, /已删除|已忘掉/);
});

for (const input of ['忘掉我喝茶的偏好，如果会删除来源原文就先别执行。', '忘掉我喝茶的偏好，会删除哪些数据？',
  '请把下面这句话翻译成英文：\n忘掉我喝茶的偏好。']) test(`FIX-50 a declined nomination leaves memory intact and continues the native reply: ${input}`, { timeout: 60000 }, async t => {
  const f = await fixture(t, { automaticForget: 'no_action' }), session = await f.create();
  await f.complete(await f.send(session, input));
  assert.equal(f.commands.length, 0); assert.ok(f.facts.has(f.ownerId()));
  assert.equal(f.nominations.length, 1);
  assert.match(JSON.stringify(f.runtime.requests), /没有提交或排队/);
  const replies = (await f.api(`/sessions/${session}/events`)).events.filter((e: any) => e.type === 'assistant.message').map((e: any) => e.data.text).join('\n');
  assert.match(replies, input.startsWith('请把下面') ? /Forget my tea preference/ : /156/);
  assert.doesNotMatch(replies, /已删除|已忘掉/);
});

for (const omitDecision of [false, true]) test(`FIX-50 a native model forget call cannot override whole-message no-action${omitDecision ? ' without decision metadata' : ''}`, { timeout: 60000 }, async t => {
  const f = await fixture(t, { automaticForget: 'no_action', forceForgetAfterDecline: true, omitDecision }), session = await f.create();
  await f.complete(await f.send(session, '忘掉我喝茶的偏好，会删除哪些数据？'));
  assert.equal(f.commands.length, 0); assert.ok(f.facts.has(f.ownerId()));
  assert.equal(f.nominations.length, 1);
  assert.equal(f.calls.some(call => call.name === 'memory_forget'), false, 'the declined decision blocks a later native deletion before host mutation');
  const results = f.runtime.requests.flatMap((request: any) => request.messages.filter((message: any) => message.role === 'tool').map(textOf));
  assert.ok(results.some((text: string) => text.includes('没有删除记忆，也没有排队重试')));
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

test('a completed memory action has a final reply even when the model returns empty text', { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create();
  // These tool-path fixtures deliberately do not nominate automatic forgetting.
  // A synthetic no_action is a veto, never permission for a later tool call.
  const result = await f.complete(await f.send(session, 'FIX47_EMPTY_REMOVE 移除我的喝茶偏好'));
  assert.equal(result.terminal.data.reason, 'completed');
  assert.equal(f.facts.has(f.ownerId()), false);
  assert.ok(f.runtime.requests.some((request: any) => request.messages.some((message: any) =>
    message.role === 'tool' && textOf(message).includes('applied'))), 'the model must get an actual continuation attempt before fallback');
  const events = (await f.api(`/sessions/${session}/events`)).events;
  assert.match(events.filter((e: any) => e.type === 'assistant.message').at(-1)?.data.text ?? '', /已忘掉/);
});

test('memory call markup is hidden while the actual native memory tool still executes', { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create();
  const result = await f.complete(await f.send(session, 'FIX47_MARKUP_REMOVE 移除我的喝茶偏好'));
  assert.equal(result.terminal.data.reason, 'completed'); assert.equal(f.facts.has(f.ownerId()), false);
  const events = (await f.api(`/sessions/${session}/events`)).events;
  const replies = events.filter((e: any) => e.type === 'assistant.message').map((e: any) => e.data.text).join('\n');
  assert.match(replies, /已忘掉/); assert.doesNotMatch(replies, /tool_call|memory_forget/);
});

test('review-5 memory success lets the model finish later corrections and the requested recommendation', { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create();
  const result = await f.complete(await f.send(session, 'FIX47_CONTINUE 先纠正成红茶，再纠正成普洱茶，然后根据新偏好推荐饮品'));
  assert.equal(result.terminal.data.reason, 'completed');
  assert.equal(f.commands.length, 2, 'both requested corrections must execute before the turn ends');
  assert.equal(f.facts.get(f.ownerId()), '普洱茶');
  const replies = (await f.api(`/sessions/${session}/events`)).events.filter((e: any) => e.type === 'assistant.message').map((e: any) => e.data.text).join('\n');
  assert.match(replies, /推荐普洱冷泡饮品/);
});

test('review-5 a queued memory update still allows the requested recommendation', { timeout: 60000 }, async t => {
  const f = await fixture(t, { queueMemoryAction: true }), session = await f.create();
  const result = await f.complete(await f.send(session, 'FIX47_QUEUED_CONTINUE 更正为红茶，然后按这个新偏好推荐饮品'));
  assert.equal(result.terminal.data.reason, 'completed');
  const replies = (await f.api(`/sessions/${session}/events`)).events.filter((e: any) => e.type === 'assistant.message').map((e: any) => e.data.text).join('\n');
  assert.match(replies, /还在排队/); assert.match(replies, /推荐红茶冷泡/);
});

for (const work of [false, true]) test(`forget uses Core commands and no file tools in ${work ? 'work' : 'chat'} mode`, { timeout: 60000 }, async t => {
  const f = await fixture(t), session = await f.create(work);
  const forgotten = await f.complete(await f.send(session, 'FIX45_REMOVE 移除我喝茶的偏好'));
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
  const conflict = await f.complete(await f.send(session, 'FIX45_CONFLICT 移除茶偏好'));
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
  await f.complete(await f.send(session, 'FIX45_REMOVE 移除茶偏好'));
  await until(async () => f.calls.some(c => c.name === 'memory_cleanup'));
  const fresh = await f.create(); await f.complete(await f.send(fresh, 'FIX45_QUERY 我喜欢什么茶'));
  assert.equal(f.calls.filter(c => c.name === 'memory_cleanup').length, 1);
  assert.equal(f.facts.has(f.ownerId()), false);
});
