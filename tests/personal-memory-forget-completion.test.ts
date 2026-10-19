import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMemoryActions } from '../src/personal-memory/actions.mjs';
import { scopedForgetPlan, checkForgetCompletion } from '../src/personal-memory/forget-model.mjs';
import { handlePersonalMemoryHttp } from '../src/personal-memory/http.mjs';

const owner = 'synthetic-completion-owner';
const scope = { authorized: true, subject: 'self', topic: '我喝茶的偏好' };
const request = { requestId: 'synthetic-forget', name: 'memory_forget', scope, arguments: { query: scope.topic },
  source: { text: '请忘掉我喝茶的偏好。' } };
const mixed = '我喜欢喝红茶。另记一件独立的事：我周末喜欢散步。';
async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-forget-completion-'));
  let revision = 7, scheduled = 0, cleanupReceiptReads = 0, maxInputChars = Infinity;
  let terminalJobs: any[] = [];
  const commands: any[] = [], receipts = new Map(), judgeInputs: any[] = [], originalChat = [mixed, '记住我喜欢喝红茶', '我其实更喜欢绿茶。'];
  const permissions = { allow_local_read: true, allow_cloud_read: true, allow_inference: true };
  const sources = new Map(['old', 'green', 'mixed'].map((id, index) => [id, { evidence_id: id,
    raw_content: ['记住我喜欢喝红茶', '我其实更喜欢绿茶。', mixed][index], summary: ['记住我喜欢喝红茶', '我其实更喜欢绿茶。', mixed][index],
    content_available: true, permissions }]));
  const item = (id: string, content: string, evidence: string, current = true) => ({ item_id: id, object_kind: 'cognition',
    current_state: current ? 'current' : 'not_current', value: { content },
    provenance: [{ evidence_id: evidence, evidence: sources.get(evidence), permissions }] });
  let worlds = [item('old', '用户记住我喜欢喝红茶', 'old', false), item('green', '用户其实更喜欢绿茶。', 'green'),
    item('independent-red', '用户喜欢喝红茶。', 'mixed'), item('walking', '用户周末喜欢散步。', 'mixed')];
  worlds[0].transition_history = [{ prior_item_id: 'old', replacement_item_id: 'green', transition_kind: 'corrects' }];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const part of req) text += part;
    const body = JSON.parse(text), input = JSON.parse(body.messages.at(-1).content), name = body.tools[0].function.name;
    judgeInputs.push(input);
    if (body.messages.at(-1).content.length > maxInputChars) { res.writeHead(400).end('{}'); return; }
    const items = input.candidates.map((row: any) => ({ key: row.key, subjects: ['self'], targetSubjects: /红茶|绿茶/.test(row.text) ? ['self'] : [],
      matchesTopic: /红茶|绿茶/.test(row.text), hasTargetFact: /红茶|绿茶/.test(row.text),
      sourceFullyAuthorized: !row.sourceTexts.some((source: string) => source.includes('散步')) }));
    res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name, arguments: JSON.stringify({ items }) } }] } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const route = { baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, model: 'synthetic', credential: 'synthetic', modelTier: 'cloud' };
  const manager: any = {
    async revalidateForget(_owner: string, action: any) { return action.scope ?? action.plan?.authorization; },
    status: async () => ({ state: 'ready', capabilities: { deleteWorldItem: true, deleteEvidence: true } }),
    async query(_owner: string, method: string, params: any) {
      assert.equal(_owner, owner);
      if (method === 'query_world') return params.operation === 'get'
        ? { world_revision: revision, item: worlds.find(row => row.item_id === params.item_id) }
        : { world_revision: revision, items: params.object_kind === 'cognition' ? worlds : [] };
      if (method === 'query_evidence') return { world_revision: revision, evidence: sources.get(params.evidence_id) };
      if (method === 'preview_recall') return { preview: { recent_evidence: [], pending_corrections: [] } };
      if (method === 'query_jobs') return { world_revision: revision, formation_requests: [], jobs: terminalJobs };
      if (method === 'preview_forget') {
        const items = worlds.filter(row => ['old', 'green'].includes(row.item_id)).map(row => ({ ...row, name: row.value.content }));
        return { world_revision: revision, items, item_count: items.length, evidence_ids: ['old', 'green'], evidence_count: 2 };
      }
      throw Error(method);
    },
    async planForget(_owner: string, action: any) { return scopedForgetPlan(manager, _owner, action, route); },
    async checkForgetCompletion(_owner: string, proposal: any) { return checkForgetCompletion(manager, _owner, proposal, route); },
    async submitCommand(_owner: string, command: any) {
      commands.push(command); const before = revision;
      worlds = worlds.filter(row => !['old', 'green'].includes(row.item_id));
      sources.delete('old'); sources.delete('green'); revision++;
      const result = { receipt: { result_state: 'applied', command_id: command.requestId, before_revision: before,
        after_revision: revision, storage_cleanup: { state: 'complete', detail_code: 'current_journal_committed' } } };
      receipts.set(command.requestId, result); return result;
    },
    async receiptByRequest(_owner: string, id: string) { cleanupReceiptReads++; return receipts.get(id); },
    async receiptForAction(_owner: string, command: any) {
      const stored = commands.find(row => row.requestId === command.requestId);
      if (!stored || ['operation', 'targetKind', 'targetId', 'expectedWorldRevision'].some(key => stored[key] !== command[key])) throw Error('MEMORY_REQUEST_CONFLICT');
      return receipts.get(command.requestId);
    },
  };
  const actions = createMemoryActions({ root, manager: () => manager, schedule: () => { scheduled++; } });
  t.after(async () => { await actions.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  return { root, actions, manager, sources, commands, receipts, originalChat, route, judgeInputs, get revision() { return revision; },
    get scheduled() { return scheduled; }, world: () => worlds,
    get cleanupReceiptReads() { return cleanupReceiptReads; },
    terminalSource(mode: 'local-only' | 'no-inference' | 'deleted' | 'long') {
      worlds = [item('green', '用户其实更喜欢绿茶。', 'green')];
      const text = mode === 'long' ? '另一项合成资料：' + 'x'.repeat(5000) : '我喜欢喝红茶。';
      sources.set('terminal', { evidence_id: 'terminal', raw_content: mode === 'deleted' ? null : text,
        summary: mode === 'deleted' ? null : text, content_available: mode !== 'deleted',
        currentness_state: mode === 'deleted' ? 'evidence_deleted' : 'current',
        permissions: { allow_local_read: true, allow_cloud_read: mode !== 'local-only', allow_inference: mode !== 'no-inference' } });
      terminalJobs = [{ acceptance: { evidence_ids: ['terminal'] }, worker: { state: 'no_change' } }];
      maxInputChars = 16384;
    },
    walkingOnly(summary = mixed) {
      worlds = worlds.filter(row => row.item_id !== 'independent-red');
      sources.get('mixed').raw_content = '我周末喜欢散步。'; sources.get('mixed').summary = summary;
    },
    privateSource() {
      const blocked = { ...permissions, allow_cloud_read: false };
      sources.get('mixed').permissions = blocked;
      for (const row of worlds) for (const source of row.provenance) if (source.evidence_id === 'mixed') source.permissions = blocked;
    } };
}

for (const mode of ['local-only', 'no-inference', 'long'] as const)
test(`retained job source ${mode} withholds before any model classification or deletion`, async t => {
  const f = await fixture(t); f.terminalSource(mode);
  const result = await f.actions.submit(owner, request);
  assert.equal(result.state, 'withheld');
  assert.equal(f.judgeInputs.length, 0);
  assert.equal(f.commands.length, 0);
  assert.equal(f.scheduled, 1, 'only the existing initial submission wakeup is registered');
  await f.actions.resume(owner);
  assert.equal(await f.actions.pending(owner), false);
  assert.equal(f.scheduled, 1, 'an uncheckable source must not add a retry wakeup');
  assert.equal(f.judgeInputs.length, 0);
  assert.equal(f.commands.length, 0);
  assert.equal(f.world().length, 1);
  assert.equal(f.sources.get('terminal').content_available, true);
});

test('an already deleted terminal source does not block an otherwise complete forget', async t => {
  const f = await fixture(t); f.terminalSource('deleted');
  const result = await f.actions.submit(owner, request);
  assert.equal(result.state, 'applied');
  assert.equal(f.commands.length, 1);
  assert.ok(f.judgeInputs.every(input => input.candidates.every(row => row.key !== 'evidence:terminal')));
});

test('known retained mixed sources withhold the whole topic action before any Core delete', async t => {
  const f = await fixture(t), before = f.originalChat.slice();
  const result = await f.actions.submit(owner, request);
  assert.equal(result.state, 'withheld');
  assert.doesNotMatch(result.message, /已忘掉|已经忘了|已删除关于/);
  assert.equal(f.commands.length, 0); assert.equal(f.revision, 7);
  assert.equal(f.sources.get('mixed')?.raw_content, mixed);
  assert.ok(f.world().some(row => row.item_id === 'walking'));
  assert.deepEqual(f.originalChat, before);
  const scheduled = f.scheduled;
  await f.actions.resume(owner); await f.actions.submit(owner, request);
  assert.equal(f.commands.length, 0); assert.equal(f.revision, 7);
  assert.equal(await f.actions.pending(owner), false, 'Withheld must be terminal rather than queued deletion');
  assert.equal(f.scheduled, scheduled + 1, 'Only the existing submission wakeup runs; no retained-source retry is added');
});

test('an already applied legacy command is reported partial without another deletion or receipt rewriting', async t => {
  const f = await fixture(t);
  const command = { requestId: 'completed-old-command', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'old', expectedWorldRevision: 7, payload: {} };
  const applied = await f.manager.submitCommand(owner, command), savedReceipt = structuredClone(applied);
  const plan = { version: 2, worldRevision: 7, nextRevision: 8, authorization: scope, retainedUncertainCount: 1,
    evidenceIds: [], worldTargets: [{ kind: 'cognition', id: 'old' }], affectedIds: ['old', 'green'] };
  const action = { ...request, plan, finished: ['cognition:old'], commands: { 'cognition:old': command } };
  const file = join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json');
  await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, JSON.stringify({ records: { [request.requestId]: action } }));
  await f.actions.resume(owner);
  const result = await f.actions.submit(owner, request);
  assert.equal(result.state, 'partial'); assert.match(result.message, /原请求已执行.*不能确认完全忘掉/);
  assert.doesNotMatch(result.message, /^已忘掉|已经忘了/);
  await f.actions.resume(owner);
  assert.equal(f.commands.length, 1); assert.equal(f.revision, 8);
  assert.deepEqual(f.receipts.get(command.requestId), savedReceipt);
  assert.equal(f.cleanupReceiptReads, 0, 'Completion proof must not invoke a receipt getter that performs cleanup');
  assert.equal(f.sources.get('mixed')?.raw_content, mixed);
  assert.ok(f.world().some(row => row.item_id === 'walking'));
  const persisted = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(persisted.records[request.requestId].result.state, 'partial');
});

test('an earlier command without a verifiable receipt keeps its original uncertainty until the actual receipt arrives', async t => {
  const f = await fixture(t);
  const command = { requestId: 'unconfirmed-old-command', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'old', expectedWorldRevision: 7, payload: {} };
  const plan = { version: 2, worldRevision: 7, authorization: scope, retainedUncertainCount: 1,
    evidenceIds: [], worldTargets: [{ kind: 'cognition', id: 'old' }], affectedIds: ['old', 'green'] };
  const action = { ...request, plan, commands: { 'cognition:old': command } };
  const file = join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json');
  await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, JSON.stringify({ records: { [request.requestId]: action } }));
  const unknown = await f.actions.submit(owner, request);
  assert.equal(unknown.state, 'queued');
  assert.match(unknown.message, /未能确认|待确认/);
  assert.doesNotMatch(unknown.message, /没有执行遗忘|没有删除记忆/);
  assert.equal(f.commands.length, 0); assert.equal(f.revision, 7);
  assert.equal(await f.actions.pending(owner), true);
  const pending = JSON.parse(await readFile(file, 'utf8')).records[request.requestId];
  assert.equal(pending.commands['cognition:old'].requestId, command.requestId);
  assert.equal(pending.result, undefined);
  // The earlier request finally commits. Recovery may inspect this receipt,
  // but must never submit a second deletion to obtain evidence of completion.
  await f.manager.submitCommand(owner, command); await f.actions.resume(owner);
  const settled = await f.actions.submit(owner, request);
  assert.equal(settled.state, 'partial'); assert.equal(f.commands.length, 1); assert.equal(f.revision, 8);
});

test('the memory-page DELETE refuses known incomplete coverage without an applied receipt for old clients', async t => {
  const f = await fixture(t); let checked = false;
  f.manager.checkForgetCompletion = async (_owner: string, target: any) => {
    checked = true; assert.equal(_owner, owner); assert.equal(target.targetKind, 'cognition');
    assert.equal(target.targetId, 'green'); assert.equal(target.expectedWorldRevision, 7);
    return checkForgetCompletion(f.manager, _owner, target, f.route);
  };
  const path = '/personal/v1/memory/items/cognition/green';
  const response = await handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname: path,
    url: new URL(path, 'http://synthetic'), request: { method: 'DELETE' },
    readJson: async () => ({ requestId: 'page-forget', expectedWorldRevision: 7 }) });
  assert.equal(checked, true); assert.equal(response.status, 409);
  assert.equal(response.body.state, 'withheld'); assert.equal(response.body.receipt, undefined);
  assert.equal(f.commands.length, 0); assert.equal(f.revision, 7);
  assert.ok(f.world().some(row => row.item_id === 'walking'));
  assert.equal(f.sources.get('mixed')?.summary, mixed);
});

test('a formed walking source with target text only in its summary still withholds topic and page deletion', async t => {
  const f = await fixture(t); f.walkingOnly();
  const result = await f.actions.submit(owner, request);
  assert.equal(result.state, 'withheld');
  assert.ok(f.judgeInputs.some(input => input.candidates.some((row: any) => row.key === 'evidence:mixed' && row.sourceTexts.includes(mixed))));
  const completion = await f.manager.checkForgetCompletion(owner, { targetKind: 'cognition', targetId: 'green', expectedWorldRevision: 7 });
  assert.equal(completion.state, 'withheld');
  assert.equal(f.commands.length, 0); assert.equal(f.revision, 7);
  assert.equal(f.sources.get('mixed').summary, mixed);
});

test('missing model permission refuses completion without sending protected source text to the judge', async t => {
  const f = await fixture(t); f.privateSource();
  const result = await f.actions.submit(owner, request);
  assert.equal(result.state, 'withheld');
  assert.match(result.message, /权限/);
  const completion = await f.manager.checkForgetCompletion(owner, { targetKind: 'cognition', targetId: 'green', expectedWorldRevision: 7 });
  assert.equal(completion.state, 'withheld'); assert.equal(f.judgeInputs.length, 0);
  assert.equal(f.commands.length, 0); assert.equal(f.revision, 7);
});

test('a complete selected chain can proceed while unrelated walking and the original chat remain', async t => {
  const f = await fixture(t); f.walkingOnly('我周末喜欢散步。');
  const path = '/personal/v1/memory/items/cognition/green';
  const response = await handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname: path,
    url: new URL(path, 'http://synthetic'), request: { method: 'DELETE' },
    readJson: async () => ({ requestId: 'page-complete', expectedWorldRevision: 7 }) });
  assert.equal(response.status, 200); assert.equal(response.body.receipt.state, 'applied');
  assert.equal(f.commands.length, 1); assert.equal(f.revision, 8);
  assert.equal(f.sources.get('mixed').raw_content, '我周末喜欢散步。');
  assert.ok(f.world().some(row => row.item_id === 'walking'));
  assert.deepEqual(f.originalChat, [mixed, '记住我喜欢喝红茶', '我其实更喜欢绿茶。']);
});

for (const path of ['topic-plan', 'page-confirmation']) test(`${path} rejects a selection whose revision changed before completion`, async t => {
  const f = await fixture(t); f.walkingOnly('我周末喜欢散步。');
  let entered, release;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const resumed = new Promise<void>(resolve => { release = resolve; });
  const query = f.manager.query.bind(f.manager);
  t.mock.method(f.manager, 'query', async (...args) => {
    if (args[1] === 'query_world' && args[2].operation === 'revision') { entered(); await resumed; }
    return query(...args);
  });
  let pending;
  try {
    pending = path === 'topic-plan' ? f.manager.planForget(owner, request)
      : f.manager.checkForgetCompletion(owner, { targetKind: 'cognition', targetId: 'green', expectedWorldRevision: 7 });
    await started;
    await f.manager.submitCommand(owner, { requestId: 'other-deletion', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'green', expectedWorldRevision: 7, payload: {} });
    release(); const result = await pending;
    assert.equal(path === 'topic-plan' ? result.completionState : result.state, 'withheld');
    assert.equal(f.commands.length, 1, 'the stale selection never submits another deletion');
  } finally { release(); await pending; }
});
