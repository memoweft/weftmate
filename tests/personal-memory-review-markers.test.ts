import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryCommandJournal } from '../src/personal-memory/journal.mjs';
import { createMemoryActions } from '../src/personal-memory/actions.mjs';

const owner = 'owner-00000000-0000-4000-8000-000000000001';
const secret = 'SYNTHETIC-PENDING-DELETE-SOURCE';
async function noCopies(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await noCopies(file);
    else { assert.equal((await readFile(file)).includes(Buffer.from(secret)), false, `plaintext in ${entry.name}`); assert.equal(entry.name.endsWith('.tmp'), false); }
  }
}

for (const scope of ['target', 'source', 'session']) test(`pending deletion marker loses withdrawn ${scope} text but keeps its command identity`, { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-delete-marker-'));
  let journal = createMemoryCommandJournal({ root });
  const deletion = { ownerId: owner, requestId: 'pending-delete', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'forgotten-target', expectedWorldRevision: 7, payload: {},
    cleanup: { sourceTexts: [secret], deleteConversationSnippets: true } };
  try {
    const original = await journal.reserve(deletion);
    await journal.reserve({ ownerId: owner, requestId: 'source-correction', operation: 'correct_world_item', targetKind: 'cognition', targetId: 'forgotten-target', expectedWorldRevision: 6,
      payload: { correction_text: secret, source: { session_id: 'withdrawn-session', content: secret } } });
    await journal.reserve({ ...deletion, requestId: 'unrelated-delete', targetId: 'unrelated-target', cleanup: { sourceTexts: ['UNRELATED-SOURCE'], deleteConversationSnippets: false } });
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
