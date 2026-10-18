import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createMemoryActions } from '../src/personal-memory/actions.mjs';
import { scopedForgetPlan } from '../src/personal-memory/forget-model.mjs';
import { birthdayFacts, birthdayForgetDecisions } from './helpers/birthday-forget-decisions.mjs';

const owner = 'synthetic-forget-count-owner';
// Actual 18af output in m3-core-regression-readonly/birthday-contract-results.json.
const oldPlan = { version: 2, completionVersion: 2, completionState: 'complete', worldRevision: 7,
  authorizedEvidenceIds: ['self-source'], evidenceIds: [], sourceTexts: ['我的生日是五月一日。'],
  worldTargets: [{ kind: 'cognition', id: 'self' }], affectedIds: ['self', 'self-source'],
  authorization: { authorized: true, subject: 'self', topic: '我的生日' }, retainedOtherCount: 4, retainedUncertainCount: 0 };

async function fixture(t: any, { subject = 'self', oneOther = false, shared = false, sharedWithSelf = false, orphan = false, evidenceOnly = false, misattribute = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-forget-count-'));
  const file = join(root, 'accounts', owner, 'memory-home', 'pending-actions.json');
  let revision = 7, beforeCommand: any;
  const commands: any[] = [], receipts = new Map(), exchanges: any[] = [];
  const permissions = { allow_inference: true, allow_cloud_read: true, allow_local_read: true };
  const source = (id: string, text: string) => ({ evidence_id: id, raw_content: text, summary: text, content_available: true, permissions });
  const sources = new Map([['self-source', source('self-source', sharedWithSelf ? '我的生日是五月一日。妈妈的生日是六月一日。' : '我的生日是五月一日。')],
    ...(!evidenceOnly && !sharedWithSelf ? [['mother-source', source('mother-source', '妈妈的生日是六月一日。')]] : []),
    ...(!evidenceOnly && !sharedWithSelf && !oneOther && !shared ? [['coworker-source', source('coworker-source', '同事小王的生日是七月一日。')]] : []),
    ...(orphan || evidenceOnly ? [['orphan-source', source('orphan-source', '妈妈的生日是六月一日。')]] : [])]);
  const cognition = (id: string, sourceId: string, person?: string, text?: string) => ({ item_id: id, object_kind: 'cognition', current_state: 'current',
    value: { content: text ?? sources.get(sourceId).raw_content, ...(person ? { target_entity_id: person } : {}) },
    provenance: [{ evidence_id: sourceId, evidence: sources.get(sourceId), permissions }] });
  let rows: any[] = [cognition('self', 'self-source', undefined, '我的生日是五月一日。'), ...(sharedWithSelf
    ? [cognition('mother', 'self-source', 'person-mother', '妈妈的生日是六月一日。')]
    : !evidenceOnly ? [cognition('mother', 'mother-source', 'person-mother'),
    ...(!oneOther ? [shared ? cognition('second-mother', 'mother-source', 'person-mother') : cognition('coworker', 'coworker-source', 'person-coworker')] : [])] : [])];
  const entities = [{ item_id: 'person-mother', object_kind: 'entity', value: { kind: 'person', canonical_name: '妈妈' }, provenance: [] },
    { item_id: 'person-coworker', object_kind: 'entity', value: { kind: 'person', canonical_name: '同事小王' }, provenance: [] }];
  const originalChat = birthdayFacts.map(fact => fact.text);
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw), input = JSON.parse(body.messages.at(-1).content);
    const items = birthdayForgetDecisions(input, { misattribute }); exchanges.push({ input, items });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: {
      name: body.tools[0].function.name, arguments: JSON.stringify({ items }) } }] } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const route = { baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, model: 'synthetic', credential: 'synthetic', modelTier: 'cloud' };
  const manager: any = {
    async revalidateForget(_owner: string, action: any) { return action.scope ?? action.plan?.authorization; },
    async query(account: string, method: string, params: any) {
      assert.equal(account, owner);
      if (method === 'query_world') return { world_revision: revision, items: params.object_kind === 'cognition' ? rows : params.object_kind === 'entity' ? entities : [] };
      if (method === 'query_evidence') return { world_revision: revision, evidence: sources.get(params.evidence_id) };
      if (method === 'preview_recall') return { preview: { recent_evidence: orphan || evidenceOnly ? [{ id: 'orphan-source', text: sources.get('orphan-source').raw_content }] : [], pending_corrections: [] } };
      if (method === 'query_jobs') return { formation_requests: [] };
      if (method === 'preview_forget') {
        const items = rows.filter(row => params.target_kind === 'evidence' ? row.provenance.some(source => source.evidence_id === params.target_id) : row.item_id === params.target_id);
        return { world_revision: revision, items, evidence_ids: [...new Set(items.flatMap(row => row.provenance.map(source => source.evidence_id)))] };
      }
      throw Error(method);
    },
    planForget(account: string, action: any) { return scopedForgetPlan(manager, account, action, route); },
    async submitCommand(account: string, command: any) {
      assert.equal(account, owner);
      beforeCommand = await readFile(file, 'utf8').then(value => JSON.parse(value).records[request.requestId]).catch(() => undefined);
      commands.push(structuredClone(command)); const before = revision++;
      const sourceIds = command.targetKind === 'evidence' ? [command.targetId] : rows.find(row => row.item_id === command.targetId).provenance.map(source => source.evidence_id);
      rows = rows.filter(row => !row.provenance.some(source => sourceIds.includes(source.evidence_id)));
      for (const id of sourceIds) sources.delete(id);
      const result = { receipt: { command_id: command.requestId, result_state: 'applied', before_revision: before, after_revision: revision } };
      receipts.set(command.requestId, result); return result;
    },
    async receiptForAction(account: string, command: any) { assert.equal(account, owner); return receipts.get(command.requestId); }
  };
  const request: any = { requestId: 'count-forget', name: 'memory_forget', arguments: { query: subject === 'self' ? '我的生日' : '妈妈的生日' },
    scope: { authorized: true, subject, topic: subject === 'self' ? '我的生日' : '妈妈的生日' }, source: { text: subject === 'self' ? '忘掉我的生日' : '忘掉妈妈的生日' } };
  const actions = createMemoryActions({ root, manager: () => manager, schedule() {} });
  async function seed(extra = {}, plan: any = oldPlan) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify({ records: {
    [request.requestId]: { ...request, plan: structuredClone(plan), ...extra } } })); }
  t.after(async () => { await actions.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  return { actions, manager, request, seed, file, commands, receipts, sources, exchanges, originalChat,
    world: () => rows, get revision() { return revision; }, get beforeCommand() { return beforeCommand; } };
}

for (const subject of ['self', 'other:妈妈']) test(`three birthdays retain two records for authorized ${subject}`, async t => {
  const f = await fixture(t, { subject });
  const result = await f.actions.submit(owner, f.request);
  assert.equal(result.state, 'applied'); assert.match(result.message, /还有 2 条关于别人的没动/);
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].targetId, subject === 'self' ? 'self' : 'mother');
  assert.equal(f.revision, 8); assert.equal(f.world().length, 2);
});

test('an unscoped old action stops and explicit reconfirmation still completes with two retained records', async t => {
  const f = await fixture(t);
  await f.seed({}, { evidenceIds: ['self-source', 'mother-source', 'coworker-source'], worldTargets: [], affectedIds: [], sourceTexts: [] });
  assert.equal((await f.actions.submit(owner, f.request)).state, 'withheld'); assert.equal(f.commands.length, 0);
  const result = await f.actions.submit(owner, { ...f.request, requestId: 'reconfirmed-count' });
  assert.equal(result.state, 'applied'); assert.match(result.message, /还有 2 条关于别人的没动/);
  assert.equal(f.commands.length, 1); assert.equal(f.world().length, 2);
});

for (const [name, options, expected] of [
  ['one World and its Evidence', { oneOther: true }, 1],
  ['independent Evidence without a World', { evidenceOnly: true }, 1],
  ['two World records sharing one source', { shared: true }, 2],
  ['independent identical text with a different Evidence id', { orphan: true }, 3]
] as const) test(`retained count preserves identities: ${name}`, async t => {
  const f = await fixture(t, options);
  const plan = await f.manager.planForget(owner, f.request);
  assert.equal(plan.retainedOtherCount, expected); assert.equal(plan.retainedUncertainCount, 0);
  assert.deepEqual(plan.worldTargets, [{ kind: 'cognition', id: 'self' }]); assert.deepEqual(plan.evidenceIds, []);
  const result = await f.actions.submit(owner, f.request);
  assert.equal(result.state, 'applied'); assert.equal(f.commands.length, 1); assert.equal(f.revision, 8);
});

test('a true semantic misattribution remains a fault and stops with every fact and source retained', async t => {
  const f = await fixture(t, { misattribute: true }), before = structuredClone(f.world()), sources = [...f.sources], chat = f.originalChat.slice();
  assert.equal((await f.actions.submit(owner, f.request)).state, 'withheld');
  assert.equal(f.commands.length, 0); assert.equal(f.revision, 7);
  assert.deepEqual(f.world(), before); assert.deepEqual([...f.sources], sources); assert.deepEqual(f.originalChat, chat);
  const bad = f.exchanges.flatMap(exchange => exchange.items).find(item => item.key === 'cognition:mother');
  assert.deepEqual(bad.subjects, ['self']); assert.deepEqual(bad.targetSubjects, ['self']); assert.equal(bad.sourceFullyAuthorized, true);
});

test('the correct birthday fixture preserves a source shared by self and another subject', async t => {
  const f = await fixture(t, { sharedWithSelf: true }), before = structuredClone(f.world()), original = [...f.sources];
  const result = await f.actions.submit(owner, f.request);
  assert.equal(result.state, 'withheld'); assert.match(result.message, /没有执行遗忘.*独立记忆和原聊天保留/);
  assert.equal(f.commands.length, 0); assert.equal(f.revision, 7); assert.deepEqual(f.world(), before); assert.deepEqual([...f.sources], original);
  const own = f.exchanges.flatMap(exchange => exchange.items).find(item => item.key === 'cognition:self');
  assert.deepEqual(own.subjects, ['self', 'other:妈妈']); assert.deepEqual(own.targetSubjects, ['self']); assert.equal(own.sourceFullyAuthorized, false);
});

test('a genuine 18af proof2 refreshes only its count and keeps the frozen command identity', async t => {
  const f = await fixture(t); await f.seed();
  const result = await f.actions.submit(owner, f.request);
  assert.equal(result.state, 'applied'); assert.match(result.message, /还有 2 条关于别人的没动/);
  const saved = f.beforeCommand.plan;
  for (const key of ['authorization', 'worldTargets', 'evidenceIds', 'authorizedEvidenceIds', 'affectedIds', 'worldRevision', 'nextRevision']) assert.deepEqual(saved[key], oldPlan[key]);
  assert.equal(saved.retainedOtherCount, 2); assert.equal(f.commands.length, 1); assert.equal(f.commands[0].expectedWorldRevision, 7);
  assert.equal(f.commands[0].requestId, 'forget:' + createHash('sha256').update(`${f.request.requestId}|cognition:self|7`).digest('hex'));
});

for (const state of ['applied', 'unknown'] as const) test(`old proof2 with ${state} command only inspects the original receipt`, async t => {
  const f = await fixture(t), command = { requestId: 'original-count-command', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'self', expectedWorldRevision: 7, payload: {} };
  if (state === 'applied') await f.manager.submitCommand(owner, command);
  const originalReceipt = structuredClone(f.receipts.get(command.requestId));
  await f.seed({ commands: { 'cognition:self': command }, ...(state === 'applied' ? { finished: ['cognition:self'] } : {}) });
  const result = await f.actions.submit(owner, f.request);
  assert.equal(result.state, state === 'applied' ? 'partial' : 'queued');
  assert.equal(f.commands.length, state === 'applied' ? 1 : 0); assert.equal(f.revision, state === 'applied' ? 8 : 7);
  assert.equal(f.exchanges.length, 0, 'An already reserved legacy command does not launch a new plan');
  if (state === 'applied') assert.deepEqual(f.receipts.get(command.requestId), originalReceipt);
  else {
    assert.doesNotMatch(result.message, /没有执行遗忘|没有删除记忆/);
    const pending = JSON.parse(await readFile(f.file, 'utf8')).records[f.request.requestId];
    assert.deepEqual(pending.commands['cognition:self'], command);
    for (const key of ['authorization', 'worldTargets', 'evidenceIds', 'authorizedEvidenceIds', 'worldRevision', 'nextRevision']) assert.deepEqual(pending.plan[key], oldPlan[key]);
    await f.manager.submitCommand(owner, command); await f.actions.resume(owner);
    assert.equal((await f.actions.submit(owner, f.request)).state, 'partial'); assert.equal(f.commands.length, 1);
  }
});
