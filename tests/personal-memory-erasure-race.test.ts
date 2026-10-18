import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryActions } from '../src/personal-memory/actions.mjs';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { createMemoryCommandJournal } from '../src/personal-memory/journal.mjs';

const owner = 'synthetic-owner', secret = 'SYNTHETIC-ERASED-484-CORRECTION';
const gate = () => { let resolve; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const correction = () => ({ requestId: 'queued-correction', name: 'memory_correct', sessionId: 'synthetic-session',
  arguments: { kind: 'cognition', id: 'old-target', text: secret, sourceQuote: secret },
  source: { text: secret, message: { message_id: 'synthetic-message', content: secret } } });

async function assertNoCopies(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) await assertNoCopies(file);
    else assert.equal((await readFile(file)).includes(Buffer.from(secret)), false, `erased text remains in ${entry.name}`);
  }
}

for (const step of ['revision', 'selection', 'reserved-command', 'forget-plan']) test(`deletion retires a recovery paused at ${step} without rewriting erased text`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-erase-race-'));
  const entered = gate(), release = gate();
  let offline = true, submissions = 0;
  const manager = {
    async correctionSourceSupported() {
      if (offline) throw Object.assign(Error('synthetic unavailable'), { code: 'MEMORY_BUSY' });
      if (step === 'reserved-command') { entered.resolve(); await release.promise; }
      return true;
    },
    async query(_owner, method) {
      if (method === 'preview_recall' && step === 'selection' || method === 'query_world' && step === 'revision') {
        entered.resolve(); await release.promise;
      }
      return method === 'preview_recall' ? { preview: { selected_item_ids: [['cognition', 'old-target']] } } : { world_revision: 1 };
    },
    async revalidateForget() { return { authorized: true, subject: 'self', topic: 'synthetic' }; },
    async planForget() {
      if (offline) throw Object.assign(Error('synthetic unavailable'), { code: 'MEMORY_BUSY' });
      entered.resolve(); await release.promise;
      return { version: 2, worldRevision: 1, worldTargets: [{ kind: 'cognition', id: 'old-target' }], sourceTexts: [secret] };
    },
    async submitCommand(_owner, command) {
      submissions++;
      // A journal substitute makes any late command copy observable on disk.
      await writeFile(join(root, 'late-command.json'), JSON.stringify(command));
      return { result_state: 'applied', affected_ids: ['old-target'], after_revision: 2 };
    },
  };
  const actions = createMemoryActions({ root, manager: () => manager, schedule() {} });
  let recovery;
  try {
    const action: any = correction();
    if (step === 'selection') { delete action.arguments.id; action.arguments.query = 'synthetic'; }
    if (step === 'reserved-command') action.command = { requestId: 'old-command', operation: 'correct_world_item', targetId: 'old-target', payload: { correction_text: secret } };
    if (step === 'forget-plan') { action.name = 'memory_forget'; action.arguments = { query: secret }; }
    assert.equal((await actions.submit(owner, action)).state, 'queued');
    if (step === 'revision') assert.equal((await actions.submit(owner, { ...correction(), requestId: 'second-queued-correction' })).state, 'queued');
    offline = false; recovery = actions.resume(owner); await entered.promise;
    await actions.redact(owner, { affectedIds: ['old-target'], sourceTexts: [secret] });
    await assertNoCopies(root);
    release.resolve(); await recovery;
    const state = JSON.parse(await readFile(join(root, 'accounts', owner, 'memory-home/pending-actions.json'), 'utf8'));
    const row = state.records[action.requestId];
    assert.equal(row.result.state, 'not_found'); assert.deepEqual(row.arguments, {});
    assert.equal(row.command, undefined); assert.equal(row.target, undefined); assert.equal(row.plan, undefined);
    assert.equal(submissions, 0, 'retired recovery must not submit another command');
    for (const retired of Object.values(state.records) as any[]) {
      assert.equal(retired.result.state, 'not_found'); assert.deepEqual(retired.arguments, {}); assert.equal(retired.command, undefined);
    }
    await assertNoCopies(root);
    await actions.resume(owner); await actions.close();
    const restarted = createMemoryActions({ root, manager: () => manager, schedule() {} });
    try { await restarted.resume(owner); assert.equal(submissions, 0); await assertNoCopies(root); }
    finally { await restarted.close(); }
  } finally { release.resolve(); await recovery; await actions.close(); await rm(root, { recursive: true, force: true }); }
});

test('restart scrubs a legacy terminal record without replaying its stale command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-erase-legacy-'));
  const directory = join(root, 'accounts', owner, 'memory-home');
  await mkdir(directory, { recursive: true });
  const old = { ...correction(), command: { payload: { correction_text: secret } }, result: { state: 'not_found' } };
  await writeFile(join(directory, 'pending-actions.json'), JSON.stringify({ records: { [old.requestId]: old } }));
  const actions = createMemoryActions({ root, manager: () => { throw Error('terminal action executed'); }, schedule() {} });
  try { await actions.resume(owner); await assertNoCopies(root); }
  finally { await actions.close(); await rm(root, { recursive: true, force: true }); }
});

test('real manager removes both legacy action and journal copies before returning its terminal result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-erase-legacy-journal-'));
  const journal = createMemoryCommandJournal({ root });
  const command = { requestId: 'stale-legacy-command', operation: 'correct_world_item', targetKind: 'cognition', targetId: 'old-target',
    expectedWorldRevision: 1, payload: { correction_text: secret } };
  await journal.reserve({ ownerId: managerOwner, ...command }); await journal.close();
  const old = { ...correction(), command, result: { state: 'not_found' } };
  await writeFile(join(root, 'accounts', managerOwner, 'memory-home/pending-actions.json'), JSON.stringify({ records: { [old.requestId]: old } }));
  const manager = createPersonalMemoryManager({ root, enabled: true, python: join(root, 'synthetic-python'), pythonPath: root,
    baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic',
    rpcFactory: () => { throw Error('terminal legacy action must not reach Core'); } });
  try { assert.equal((await manager.mutateFromTool(managerOwner, correction())).state, 'not_found'); await assertNoCopies(root); }
  finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});

for (const stage of ['opened', 'written']) test(`revoked journal reservation removes its ${stage} temporary file before it can commit plaintext`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-erase-journal-'));
  const entered = gate(), release = gate(), original = fs.open;
  let active = true, held = false, temporary;
  const hook = t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args);
    if (!held && String(args[0]).includes('command-journal.json.') && String(args[0]).endsWith('.tmp')) {
      held = true; temporary = String(args[0]);
      if (stage === 'opened') { entered.resolve(); await release.promise; }
      else {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => { await sync(); entered.resolve(); await release.promise; };
      }
    }
    return handle;
  });
  syncBuiltinESMExports();
  const journal = createMemoryCommandJournal({ root });
  let reservation;
  try {
    reservation = journal.reserve({ ownerId: 'owner-00000000-0000-4000-8000-000000000001', requestId: 'late-reservation',
      operation: 'correct_world_item', targetKind: 'cognition', targetId: 'old-target', expectedWorldRevision: 1,
      payload: { correction_text: secret } }, () => { if (!active) throw Error('retired'); }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    if (stage === 'written') assert.equal((await readFile(temporary)).includes(Buffer.from(secret)), true, 'the preimage actually contains the correction before retirement');
    active = false; release.resolve();
    assert.equal((await reservation).error?.message, 'retired');
    await assertNoCopies(root);
    const names = await readdir(root, { recursive: true });
    assert.equal(names.some(name => name.endsWith('.tmp')), false);
  } finally { release.resolve(); await reservation; await journal.close(); hook.mock.restore(); syncBuiltinESMExports(); await rm(root, { recursive: true, force: true }); }
});

const managerOwner = 'owner-00000000-0000-4000-8000-000000000001';
const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall',
  'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
for (const operation of ['delete_world_item', 'delete_evidence', 'conversation', 'source-text', 'source-session', 'late-dispatch'])
test(`real manager ${operation} retires the queued correction and leaves no file copy`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-erase-manager-'));
  const entered = gate(), release = gate();
  let corrected = 0;
  const manager = createPersonalMemoryManager({ root, enabled: true, python: join(root, 'synthetic-python'), pythonPath: root,
    baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic', rpcFactory: () => ({ child: {}, async close() {},
      async request(method, params = {}) {
        if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods };
        if (method === 'initialize') return { runtime: { subject_id: managerOwner, db_path: join(params.dsh_home, 'memoweft/memoweft.sqlite3') },
          capabilities: { subject_id: managerOwner, methods, services: { command: { correction_source: true, operations: ['correct_world_item', 'delete_world_item', 'delete_evidence'] } } } };
        if (method === 'health') return { runtime: { subject_id: managerOwner, route_ready: true } };
        if (method === 'query_world') return { world_revision: 1 };
        if (method === 'query_evidence') return { evidence: { raw_content: secret } };
        if (method === 'query_provenance') return { provenance: [{ evidence: { raw_content: secret } }] };
        if (method === 'query_command_receipt') throw Object.assign(Error('missing receipt'), { code: 'command_receipt_not_found' });
        if (method === 'submit_command') {
          if (params.command.operation === 'correct_world_item') corrected++;
          return { receipt: { result_state: 'applied', affected_ids: ['old-target', 'old-revision', 'source-evidence'], storage_cleanup: { state: 'complete' } } };
        }
        if (method === 'erase_conversation_context') return { result_state: 'applied', affected_ids: [] };
        return {};
      } }) });
  const query = manager.query.bind(manager), submit = manager.submitCommand.bind(manager);
  if (operation === 'late-dispatch') manager.submitCommand = async (...args) => {
    if (args[1].operation === 'correct_world_item') { entered.resolve(); await release.promise; }
    return submit(...args);
  };
  else manager.query = async (...args) => { entered.resolve(); await release.promise; return query(...args); };
  let pending;
  try {
    const journal = createMemoryCommandJournal({ root });
    await journal.reserve({ ownerId: managerOwner, requestId: 'previous-correction', operation: 'correct_world_item',
      targetKind: 'cognition', targetId: 'old-target', expectedWorldRevision: 1,
      payload: { correction_text: secret, source: { session_id: 'synthetic-session', content: secret } } });
    await journal.close();
    pending = manager.mutateFromTool(managerOwner, correction()); await entered.promise;
    if (operation === 'conversation') await manager.eraseConversationContext(managerOwner, 'synthetic-session');
    else if (operation === 'source-text') await manager.discardPendingSources(managerOwner, { sourceTexts: [secret] });
    else if (operation === 'source-session') await manager.discardPendingSources(managerOwner, { sessionId: 'synthetic-session' });
    else await manager.submitCommand(managerOwner, { requestId: 'delete-target', operation: operation === 'delete_evidence' ? operation : 'delete_world_item',
      targetKind: operation === 'delete_evidence' ? 'evidence' : 'cognition', targetId: operation === 'delete_evidence' ? 'source-evidence' : 'old-target', expectedWorldRevision: 1, payload: {} });
    await assertNoCopies(root); release.resolve();
    assert.equal((await pending).state, 'not_found'); assert.equal(corrected, 0);
    await assertNoCopies(root);
  } finally { release.resolve(); await pending; await manager.close(); await rm(root, { recursive: true, force: true }); }
});
