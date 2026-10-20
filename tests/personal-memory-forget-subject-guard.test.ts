import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createMemoryActions } from '../src/personal-memory/actions.mjs';
import { scopedForgetPlan, checkForgetCompletion } from '../src/personal-memory/forget-model.mjs';

const owner = 'synthetic-subject-guard-owner';
const scope = { authorized: true, subject: 'self', topic: '我喝茶的偏好' };
const request = { requestId: 'subject-guard-forget', name: 'memory_forget', scope,
  arguments: { query: scope.topic }, source: { text: '请忘掉我喝茶的偏好。' } };
// Actual e9dd planner output for the independent graph-conflict input, retained
// in review-e9dd/e9dd-graph-conflict-result.json. Do not invent a missing marker.
const e9ddPlan = { version: 2, completionVersion: 1, completionState: 'complete', worldRevision: 7,
  authorizedEvidenceIds: ['green-source'], evidenceIds: [], sourceTexts: ['用户喜欢喝绿茶。'],
  worldTargets: [{ kind: 'cognition', id: 'green' }], affectedIds: ['green', 'green-source'],
  authorization: scope, retainedOtherCount: 2, retainedUncertainCount: 0 };

type Scenario = 'self-conflict' | 'evidence-conflict' | 'other-conflict' | 'other-safe' | 'negative';
async function fixture(t: any, scenario: Scenario) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-subject-guard-'));
  let revision = 7;
  const commands: any[] = [], receipts = new Map(), inputs: any[] = [];
  const permissions = { allow_inference: true, allow_local_read: true, allow_cloud_read: true };
  const green = scenario === 'negative' ? '用户不喜欢喝红茶。' : '用户喜欢喝绿茶。';
  const own = scenario === 'self-conflict' || scenario === 'evidence-conflict';
  const mixed = own ? '用户喜欢喝红茶。妈妈周末喜欢散步。' : '妈妈喜欢喝红茶。我周末喜欢散步。';
  const source = (id: string, text: string) => ({ evidence_id: id, raw_content: text, summary: text, content_available: true, permissions });
  const sources = new Map([['green-source', source('green-source', green)], ['mixed-source', source('mixed-source', mixed)]]);
  const cognition = (id: string, text: string, sourceId: string, target?: string) => ({ item_id: id, object_kind: 'cognition', current_state: 'current',
    value: { content: text, ...(target ? { target_entity_id: target } : {}) },
    provenance: [{ evidence_id: sourceId, evidence: sources.get(sourceId), permissions }] });
  let rows = [cognition('green', green, 'green-source'), ...(own ? [cognition('self-red', '用户喜欢喝红茶。', 'mixed-source')]
    : [cognition('mother-tea', '妈妈喜欢喝红茶。', 'mixed-source', 'mother'), cognition('walking', '用户周末喜欢散步。', 'mixed-source')]),
    { item_id: 'mother', object_kind: 'entity', value: { kind: 'person', canonical_name: '妈妈' }, provenance: [] }];
  const originalChat = [green, mixed];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const part of req) text += part;
    const body = JSON.parse(text), input = JSON.parse(body.messages.at(-1).content);
    inputs.push(input);
    const items = input.candidates.map((candidate: any) => {
      const inMixed = candidate.sourceTexts.includes(mixed), fact = candidate.text.includes('茶');
      const wrong = scenario === 'self-conflict' || scenario === 'other-conflict' || scenario === 'evidence-conflict' && candidate.kind === 'evidence';
      const realSubject = own ? 'self' : 'other:妈妈';
      const targetSubjects = !fact ? [] : !inMixed ? ['self'] : [wrong ? realSubject === 'self' ? 'other:妈妈' : 'self' : realSubject];
      return { key: candidate.key, matchesTopic: fact, hasTargetFact: fact,
        subjects: inMixed ? ['self', 'other:妈妈'] : ['self'], targetSubjects, sourceFullyAuthorized: !inMixed };
    });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: {
      name: body.tools[0].function.name, arguments: JSON.stringify({ items }) } }] } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const route = { baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, model: 'synthetic', credential: 'synthetic', modelTier: 'cloud' };
  const manager: any = {
    async revalidateForget(_owner: string, action: any) { return action.scope ?? action.plan?.authorization; },
    async query(account: string, method: string, params: any) {
      assert.equal(account, owner);
      if (method === 'query_world') return { world_revision: revision, items: rows.filter(row => row.object_kind === params.object_kind) };
      if (method === 'query_evidence') return { world_revision: revision, evidence: sources.get(params.evidence_id) };
      if (method === 'preview_recall') return { preview: { recent_evidence: [], pending_corrections: [] } };
      if (method === 'query_jobs') return { world_revision: revision, formation_requests: [] };
      if (method === 'preview_forget') return { world_revision: revision,
        items: rows.filter(row => row.item_id === params.target_id).map(row => ({ ...row, name: row.value.content })),
        evidence_ids: [params.target_id === 'green' ? 'green-source' : 'mixed-source'] };
      throw Error(method);
    },
    planForget(account: string, action: any) { return scopedForgetPlan(manager, account, action, route); },
    async submitCommand(account: string, command: any) {
      assert.equal(account, owner); commands.push(structuredClone(command)); const before = revision++;
      rows = rows.filter(row => row.item_id !== 'green'); sources.delete('green-source');
      const result = { receipt: { command_id: command.requestId, result_state: 'applied', before_revision: before, after_revision: revision } };
      receipts.set(command.requestId, result); return result;
    },
    async receiptForAction(account: string, command: any) { assert.equal(account, owner); return receipts.get(command.requestId); }
  };
  const actions = createMemoryActions({ root, manager: () => manager, schedule() {} });
  const file = join(root, 'accounts', owner, 'memory-home', 'pending-actions.json');
  async function seed(extra = {}) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify({ records: {
    [request.requestId]: { ...request, plan: structuredClone(e9ddPlan), ...extra } } })); }
  t.after(async () => { await actions.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  return { actions, manager, route, sources, commands, receipts, inputs, mixed, originalChat, file, seed,
    withoutWitnessSource() { rows.find(row => row.item_id === 'self-red').provenance = []; },
    get revision() { return revision; } };
}

for (const scenario of ['self-conflict', 'evidence-conflict', 'other-conflict'] as const) test(`${scenario} cannot hide a known target fact from natural or page completion`, async t => {
  const f = await fixture(t, scenario), chat = f.originalChat.slice();
  const page = await checkForgetCompletion(f.manager, owner, { targetKind: 'cognition', targetId: 'green', expectedWorldRevision: 7 }, f.route);
  assert.equal(page.state, 'withheld');
  assert.equal((await f.actions.submit(owner, request)).state, 'withheld');
  assert.equal(f.commands.length, 0); assert.equal(f.revision, 7);
  assert.equal(f.sources.get('mixed-source').raw_content, f.mixed); assert.deepEqual(f.originalChat, chat);
});

for (const scenario of ['other-safe', 'negative'] as const) test(`${scenario} keeps the other subject source without promoting its unrelated self fact`, async t => {
  const f = await fixture(t, scenario);
  assert.equal((await checkForgetCompletion(f.manager, owner, { targetKind: 'cognition', targetId: 'green', expectedWorldRevision: 7 }, f.route)).state, 'complete');
  assert.equal((await f.actions.submit(owner, request)).state, 'applied');
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].targetId, 'green'); assert.equal(f.commands[0].expectedWorldRevision, 7);
  assert.equal(f.sources.get('mixed-source').raw_content, f.mixed);
});

test('a World witness without readable provenance is not sent to the processing model', async t => {
  const f = await fixture(t, 'self-conflict'); f.withoutWitnessSource();
  assert.equal((await checkForgetCompletion(f.manager, owner, { targetKind: 'cognition', targetId: 'green', expectedWorldRevision: 7 }, f.route)).state, 'withheld');
  assert.equal(f.inputs.length, 0); assert.equal(f.commands.length, 0); assert.equal(f.revision, 7);
});

test('cancelling an old e9dd proof upgrade cannot leave a retryable deletion', async t => {
  const f = await fixture(t, 'other-safe'); await f.seed();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const planForget = f.manager.planForget;
  f.manager.planForget = async (account: string, action: any) => { enter(); await gate; return planForget(account, action); };
  const controller = new AbortController();
  const result = f.actions.submit(owner, { ...request, signal: controller.signal });
  try { await entered; controller.abort(); }
  finally { release(); }
  assert.equal((await result).state, 'cancelled');
  await f.actions.resume(owner);
  assert.equal(f.commands.length, 0); assert.equal(f.revision, 7); assert.equal(await f.actions.pending(owner), false);
});

for (const state of ['unsubmitted', 'applied', 'unknown'] as const) test(`an actual e9dd proof with ${state} command cannot bypass the upgraded subject check`, async t => {
  const f = await fixture(t, 'self-conflict'), command = { requestId: 'original-e9dd-command', operation: 'delete_world_item',
    targetKind: 'cognition', targetId: 'green', expectedWorldRevision: 7, payload: {} };
  if (state === 'applied') await f.manager.submitCommand(owner, command);
  await f.seed(state === 'unsubmitted' ? {} : { commands: { 'cognition:green': command }, ...(state === 'applied' ? { finished: ['cognition:green'] } : {}) });
  const result = await f.actions.submit(owner, request);
  assert.equal(result.state, state === 'unsubmitted' ? 'withheld' : state === 'applied' ? 'partial' : 'queued');
  assert.equal(f.commands.length, state === 'applied' ? 1 : 0); assert.equal(f.revision, state === 'applied' ? 8 : 7);
  if (state === 'unknown') {
    assert.doesNotMatch(result.message, /没有执行遗忘|没有删除记忆/);
    const pending = JSON.parse(await readFile(f.file, 'utf8')).records[request.requestId];
    assert.deepEqual(pending.commands['cognition:green'], command);
    assert.deepEqual(pending.plan.worldTargets, e9ddPlan.worldTargets); assert.equal(pending.plan.worldRevision, 7);
    await f.manager.submitCommand(owner, command); await f.actions.resume(owner);
    assert.equal((await f.actions.submit(owner, request)).state, 'partial'); assert.equal(f.commands.length, 1);
  }
  assert.equal(f.sources.get('mixed-source').raw_content, f.mixed);
});
