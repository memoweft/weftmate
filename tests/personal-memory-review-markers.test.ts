import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryCommandJournal } from '../src/personal-memory/journal.mjs';
import { createMemoryActions } from '../src/personal-memory/actions.mjs';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { createHash } from 'node:crypto';

const owner = 'owner-00000000-0000-4000-8000-000000000001';
const secret = 'SYNTHETIC-PENDING-DELETE-SOURCE';
const sourceRef = (text, sessionId) => ({ textHash: createHash('sha256').update(text).digest('hex'), evidenceId: `evidence-${sessionId}`, sessionIds: [sessionId] });
async function noCopies(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await noCopies(file);
    else { assert.equal((await readFile(file)).includes(Buffer.from(secret)), false, `plaintext in ${entry.name}`); assert.equal(entry.name.endsWith('.tmp'), false); }
  }
}

test('review scope: an uncorrected pending deletion loses session text across restart and retry', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-uncorrected-marker-'));
  let journal = createMemoryCommandJournal({ root });
  const proposal = { ownerId: owner, requestId: 'ordinary-delete', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'ordinary-target', expectedWorldRevision: 1, payload: {},
    cleanup: { sourceTexts: [secret], sourceRefs: [sourceRef(secret, 'session-a')], deleteConversationSnippets: true } };
  try {
    const before = await journal.reserve(proposal);
    await journal.redactTargets(owner, [], { sessionId: 'session-a' });
    await journal.close(); journal = createMemoryCommandJournal({ root });
    const after = await journal.reserve(proposal);
    assert.deepEqual(after.command, before.command); assert.deepEqual(after.cleanup.sourceTexts, []);
    await noCopies(root);
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});

for (const scope of ['session', 'source', 'context']) test(`review scope: ${scope} withdrawal preserves another session's correction and pending deletion on the same target`, { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-marker-local-scope-'));
  const kept = 'SYNTHETIC-RETAINED-SESSION-B', journal = createMemoryCommandJournal({ root });
  const correction = (sessionId, text) => ({ ownerId: owner, requestId: `correct-${sessionId}`, operation: 'correct_world_item', targetKind: 'cognition', targetId: 'shared-target', expectedWorldRevision: 1,
    payload: { correction_text: text, source: { session_id: sessionId, content: text } } });
  const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup', 'erase_conversation_context'];
  const submitted = [], cleanupInputs = [];
  let blocked = true;
  const manager = createPersonalMemoryManager({ root, enabled: true, python: join(root, 'synthetic-python'), pythonPath: root,
    baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic',
    cleanupDeletedMemory: async (_owner, input) => { cleanupInputs.push(input); },
    rpcFactory: () => ({ child: {}, async close() {}, async request(method, params = {}) {
      if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods };
      if (method === 'initialize') return { runtime: { subject_id: owner, db_path: join(params.dsh_home, 'memoweft/memoweft.sqlite3') }, capabilities: { subject_id: owner, methods, services: { command: { correction_source: true, operations: ['correct_world_item', 'delete_world_item'] } } } };
      if (method === 'health') return { runtime: { subject_id: owner, route_ready: true } };
      if (method === 'query_world') return { world_revision: 1 };
      if (method === 'erase_conversation_context') return { affected_ids: [] };
      if (method === 'query_command_receipt') throw Object.assign(Error('no receipt'), { code: 'command_receipt_not_found' });
      if (method === 'submit_command') {
        if (blocked && params.command.operation === 'correct_world_item') throw Object.assign(Error('synthetic write unavailable'), { code: 'MEMORY_BUSY' });
        submitted.push(params.command); return { receipt: { result_state: 'applied', affected_ids: [] } };
      }
      return {};
    } }) });
  const actionB = { requestId: 'queued-b', name: 'memory_correct', sessionId: 'session-b', arguments: { kind: 'cognition', id: 'shared-target', text: kept, sourceQuote: kept },
    source: { text: kept, message: { message_id: 'message-b', content: kept } } };
  const pendingFile = join(root, 'accounts', owner, 'memory-home/pending-actions.json');
  try {
    await journal.reserve(correction('session-a', secret));
    assert.equal((await manager.mutateFromTool(owner, actionB)).state, 'queued');
    const commandB = JSON.parse(await readFile(pendingFile, 'utf8')).records['queued-b'].command;
    await journal.reserve({ ownerId: owner, requestId: 'mixed-delete', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'shared-target', expectedWorldRevision: 1, payload: {},
      cleanup: { sourceTexts: [secret, kept], sourceRefs: [sourceRef(secret, 'session-a'), sourceRef(kept, 'session-b')], deleteConversationSnippets: true } });
    if (scope === 'context') await manager.eraseConversationContext(owner, 'session-a');
    else await manager.discardPendingSources(owner, scope === 'session' ? { sessionId: 'session-a' } : { sourceTexts: [secret] });
    assert.deepEqual((await journal.get(owner, 'mixed-delete')).cleanup.sourceTexts, [kept]);
    assert.deepEqual((await journal.get(owner, 'correct-session-a')).command.payload, {});
    assert.deepEqual((await journal.get(owner, commandB.requestId)).command.payload, commandB.payload);
    assert.equal(JSON.parse(await readFile(pendingFile, 'utf8')).records['queued-b'].arguments.text, kept);
    await noCopies(root);
    blocked = false;
    assert.equal((await manager.mutateFromTool(owner, actionB)).state, 'applied');
    assert.equal(submitted.length, 1);
    const deletion = await journal.get(owner, 'mixed-delete');
    await manager.submitCommand(owner, { requestId: deletion.requestId, operation: 'delete_world_item', targetKind: 'cognition', targetId: 'shared-target', expectedWorldRevision: 1, payload: {} });
    assert.equal(submitted.length, 2); assert.deepEqual(cleanupInputs.at(-1).sourceTexts, [kept]);
    await noCopies(root);
  } finally { await manager.close(); await journal.close(); await rm(root, { recursive: true, force: true }); }
});

for (const legacy of [true, false]) test(`review scope: ${legacy ? 'legacy' : 'unresolved'} source provenance is scrubbed without losing the deletion receipt`, { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-unknown-source-')), journal = createMemoryCommandJournal({ root });
  try {
    const before = await journal.reserve({ ownerId: owner, requestId: 'unknown-source', operation: 'delete_evidence', targetKind: 'evidence', targetId: 'unknown-evidence', expectedWorldRevision: 1, payload: {},
      cleanup: { sourceTexts: [secret], ...(legacy ? {} : { sourceRefs: [{ ...sourceRef(secret, 'unused'), sessionIds: [] }] }), deleteConversationSnippets: true } });
    await journal.redactTargets(owner, [], { sessionId: 'withdrawn-session' });
    const after = await journal.get(owner, before.requestId);
    assert.deepEqual(after.command, before.command); assert.deepEqual(after.cleanup.sourceTexts, []);
    assert.equal(after.cleanup.deleteConversationSnippets, true); await noCopies(root);
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});

for (const scope of ['target', 'source', 'session']) test(`pending deletion marker loses withdrawn ${scope} text but keeps its command identity`, { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-delete-marker-'));
  let journal = createMemoryCommandJournal({ root });
  const deletion = { ownerId: owner, requestId: 'pending-delete', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'forgotten-target', expectedWorldRevision: 7, payload: {},
    cleanup: { sourceTexts: [secret], deleteConversationSnippets: true } };
  try {
    const original = await journal.reserve(deletion);
    await journal.reserve({ ownerId: owner, requestId: 'source-correction', operation: 'correct_world_item', targetKind: 'cognition', targetId: 'forgotten-target', expectedWorldRevision: 6,
      payload: { correction_text: secret, source: { session_id: 'withdrawn-session', content: secret } } });
    await journal.reserve({ ...deletion, requestId: 'unrelated-delete', targetId: 'unrelated-target', cleanup: { sourceTexts: ['UNRELATED-SOURCE'], sourceRefs: [sourceRef('UNRELATED-SOURCE', 'unrelated-session')], deleteConversationSnippets: false } });
    await journal.redactTargets(owner, scope === 'target' ? ['forgotten-target'] : [],
      scope === 'source' ? { sourceTexts: [secret] } : scope === 'session' ? { sessionId: 'withdrawn-session' } : {});
    const redacted = await journal.get(owner, deletion.requestId);
    assert.deepEqual(redacted.command, original.command);
    assert.deepEqual(redacted.cleanup, { sourceTexts: [], deleteConversationSnippets: true });
    assert.deepEqual((await journal.get(owner, 'unrelated-delete')).cleanup.sourceTexts, ['UNRELATED-SOURCE']);
    await noCopies(root);
    await journal.close(); journal = createMemoryCommandJournal({ root });
    const replay = await journal.reserve(deletion);
    assert.deepEqual(replay.command, original.command); assert.deepEqual(replay.cleanup.sourceTexts, []);
    await noCopies(root);
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});

test('a target-only scrub preserves a different correction even when its text is identical', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-marker-scope-')), journal = createMemoryCommandJournal({ root });
  const command = { ownerId: owner, operation: 'correct_world_item', targetKind: 'cognition', expectedWorldRevision: 1, payload: { correction_text: secret } };
  try {
    await journal.reserve({ ...command, requestId: 'selected', targetId: 'selected-target' });
    await journal.reserve({ ...command, requestId: 'independent', targetId: 'independent-target' });
    await journal.redactTargets(owner, ['selected-target']);
    assert.deepEqual((await journal.get(owner, 'selected')).command.payload, {});
    assert.deepEqual((await journal.get(owner, 'independent')).command.payload, command.payload);
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});

test('real manager withdrawal and cleanup retry retain the original deletion with no source text', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-marker-retry-'));
  const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
  let submitted = 0, originalCommand, receipt;
  const cleanupInputs = [];
  const create = () => createPersonalMemoryManager({ root, enabled: true, python: join(root, 'synthetic-python'), pythonPath: root,
    baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic',
    cleanupDeletedMemory: async (_owner, input) => { cleanupInputs.push(input); throw Error('synthetic cleanup remains unavailable'); },
    rpcFactory: () => ({ child: {}, async close() {}, async request(method, params = {}) {
      if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods };
      if (method === 'initialize') return { runtime: { subject_id: owner, db_path: join(params.dsh_home, 'memoweft/memoweft.sqlite3') }, capabilities: { subject_id: owner, methods, services: { command: { operations: ['delete_world_item'] } } } };
      if (method === 'health') return { runtime: { subject_id: owner, route_ready: true } };
      if (method === 'query_provenance') return { provenance: [{ evidence: { raw_content: secret } }] };
      if (method === 'query_command_receipt') { if (receipt) return receipt; throw Object.assign(Error('no receipt'), { code: 'command_receipt_not_found' }); }
      if (method === 'submit_command') {
        submitted++; originalCommand = structuredClone(params.command);
        receipt = { receipt: { command_id: originalCommand.command_id, result_state: 'applied', affected_ids: ['target'], storage_cleanup: { state: 'complete' } } };
        return receipt;
      }
      return {};
    } }) });
  let manager = create();
  try {
    const result = await manager.submitCommand(owner, { requestId: 'pending-delete', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'target', expectedWorldRevision: 1, payload: {} });
    assert.equal(result.receipt.storage_cleanup.state, 'pending');
    await manager.discardPendingSources(owner, { sourceTexts: [secret] }); await noCopies(root);
    await manager.close(); manager = create();
    const retried = await manager.retryCleanupByRequest(owner, 'pending-delete');
    assert.equal(retried.receipt.command_id, originalCommand.command_id); assert.equal(retried.receipt.storage_cleanup.state, 'pending');
    assert.equal(submitted, 1); assert.deepEqual(cleanupInputs.at(-1).sourceTexts, []); await noCopies(root);
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});

const action = { requestId: 'multi-target-forget', name: 'memory_forget', arguments: { query: secret },
  source: { text: secret }, scope: { authorized: true, subject: 'self', topic: secret } };
const plan = { version: 2, completionVersion: 3, completionState: 'complete', worldRevision: 1,
  authorization: action.scope, worldTargets: [{ kind: 'cognition', id: 'first' }, { kind: 'cognition', id: 'second' }], sourceTexts: [secret] };

for (const missing of ['world_item_not_found', 'evidence_not_found']) test(`a committed deletion followed by ${missing} retains receipt identities after scrubbing and restart`, { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-forget-receipts-'));
  const submitted = [], receiptReads = [];
  let known = false;
  const manager = {
    async planForget() { return structuredClone(plan); },
    async submitCommand(_owner, command) {
      submitted.push(structuredClone(command));
      if (submitted.length === 1) return { result_state: 'applied', after_revision: 2, storage_cleanup: { state: 'pending' } };
      throw Object.assign(Error(missing), { code: missing });
    },
    async retryCleanupByRequest() { return { result_state: 'applied', storage_cleanup: { state: 'pending' } }; },
    async receiptForAction(_owner, command) {
      receiptReads.push(command.requestId);
      if (!known) throw Error('synthetic receipt unavailable');
      return { result_state: command.targetId === 'first' ? 'applied' : 'rejected' };
    },
  };
  let actions = createMemoryActions({ root, manager: () => manager, schedule() {} });
  const file = join(root, 'accounts', owner, 'memory-home/pending-actions.json');
  try {
    await actions.submit(owner, structuredClone(action));
    let row = JSON.parse(await readFile(file, 'utf8')).records[action.requestId];
    assert.deepEqual(row.commands?.['cognition:first'], submitted[0]);
    assert.deepEqual(row.finished, ['cognition:first']);
    assert.deepEqual(row.cleanupPending, [submitted[0].requestId]);
    assert.notEqual(row.result?.state, 'not_found'); await noCopies(root);
    await actions.close(); actions = createMemoryActions({ root, manager: () => manager, schedule() {} });
    await actions.resume(owner);
    assert.equal(submitted.length, 2); assert.equal((await actions.submit(owner, action)).state, 'queued');
    known = true; await actions.resume(owner);
    assert.equal((await actions.submit(owner, action)).state, 'partial'); assert.equal(submitted.length, 2);
    row = JSON.parse(await readFile(file, 'utf8')).records[action.requestId];
    assert.deepEqual(row.commands['cognition:first'], submitted[0]); assert.deepEqual(row.finished, ['cognition:first']);
    assert.ok(receiptReads.includes(submitted[0].requestId)); await noCopies(root);
  } finally { await actions.close(); await rm(root, { recursive: true, force: true }); }
});

test('legacy not_found forget records preserve submitted identities and resolve by original receipt only', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-legacy-forget-receipt-'));
  const command = { requestId: 'already-submitted', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'first', expectedWorldRevision: 1, payload: {} };
  const row = { ...structuredClone(action), plan: structuredClone(plan), commands: { 'cognition:first': command }, finished: ['cognition:first'],
    result: { state: 'not_found', message: '没找到这条记忆。' } };
  const file = join(root, 'accounts', owner, 'memory-home/pending-actions.json');
  await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, JSON.stringify({ records: { [row.requestId]: row } }));
  let reads = 0;
  const actions = createMemoryActions({ root, schedule() {}, manager: () => ({
    async receiptForAction(_owner, selected) { assert.deepEqual(selected, command); reads++; return { result_state: 'applied' }; },
    async submitCommand() { assert.fail('must not replay the submitted deletion'); },
  }) });
  try {
    await actions.resume(owner);
    const saved = JSON.parse(await readFile(file, 'utf8')).records[row.requestId];
    assert.deepEqual(saved.commands, row.commands); assert.deepEqual(saved.finished, row.finished);
    assert.equal(saved.result.state, 'partial'); assert.equal(reads, 1); await noCopies(root);
  } finally { await actions.close(); await rm(root, { recursive: true, force: true }); }
});
