import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { createMemoryCommandJournal } from '../src/personal-memory/journal.mjs';
import { eraseSessionMemoryArtifact } from '../src/runtime/dsh-adapter/memory-erasure.mjs';

const owner = 'owner-00000000-0000-4000-8000-000000000001', secret = 'SYNTHETIC-486-NATIVE-ERASE';
const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
for (const blocked of [false, true]) test(`legacy pending native cleanup ${blocked ? 'stays pending until writable' : 'erases before withdrawing its locator'}`, { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-native-erasure-')), native = join(root, 'native');
  await mkdir(native); const file = join(native, 'session.jsonl');
  await writeFile(file, [{ id: 'session' }, { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: 'message-a', content: [{ type: 'text', text: secret }] } },
    { seq: 3, type: 'turn/end', data: { turn: 1 } },
    { seq: 4, type: 'user/message', data: { id: 'message-b', content: [{ type: 'text', text: 'KEPT-OTHER-SESSION-TEXT' }] } }].map(JSON.stringify).join('\n') + '\n');
  let unwritable = blocked, submissions = 0;
  const persistence = { config: { root: native }, locate: () => {
    if (unwritable) throw Object.assign(Error('synthetic locked session'), { code: 'EBUSY' });
    return { path: file };
  }, readRaw: async () => ({ meta: { id: 'session' }, content: await readFile(file, 'utf8') }) };
  const journal = createMemoryCommandJournal({ root });
  const marker = await journal.reserve({ ownerId: owner, requestId: 'legacy-delete', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'deleted-target', expectedWorldRevision: 1, payload: {},
    cleanup: { sourceTexts: [secret], deleteConversationSnippets: true } });
  await journal.close();
  const create = () => createPersonalMemoryManager({ root, enabled: true, python: join(root, 'synthetic-python'), pythonPath: root, baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic',
    cleanupDeletedMemory: async (_owner, options) => {
      const result = await eraseSessionMemoryArtifact(persistence, 'session', { ...options,
        snippetTargets: options.conversationTargets?.find(row => row.sessionId === 'session')?.snippetTargets });
      return options.prepareOnly ? { conversationTargets: [{ sessionId: 'session', snippetTargets: result.snippetTargets }] }
        : { cleaned: true, snippetsVerified: result?.snippetsVerified };
    }, rpcFactory: () => ({ child: {}, async close() {}, async request(method, params = {}) {
      if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods };
      if (method === 'initialize') return { runtime: { subject_id: owner, db_path: join(params.dsh_home, 'memoweft/memoweft.sqlite3') }, capabilities: { subject_id: owner, methods, services: { command: { operations: ['delete_world_item'] } } } };
      if (method === 'health') return { runtime: { subject_id: owner, route_ready: true } };
      if (method === 'submit_command') submissions++;
      return { receipt: { command_id: marker.command.command_id, result_state: 'applied', affected_ids: [], storage_cleanup: { state: 'complete' } } };
    } }) });
  let manager = create();
  try {
    await manager.discardPendingSources(owner, { sessionId: 'withdrawn-session' });
    await manager.close(); manager = create();
    const result = await manager.retryCleanupByRequest(owner, marker.requestId);
    if (blocked) {
      assert.equal(result.receipt.storage_cleanup.state, 'pending');
      const pending = JSON.parse(await readFile(join(root, 'accounts', owner, 'memory-home/command-journal.json'), 'utf8')).records[marker.requestId];
      assert.ok(pending.cleanup); assert.equal(JSON.stringify(pending).includes(secret), false);
      unwritable = false;
      assert.equal((await manager.retryCleanupByRequest(owner, marker.requestId)).receipt.storage_cleanup.state, 'complete');
    } else assert.equal(result.receipt.storage_cleanup.state, 'complete');
    await manager.close();
    const hits = [];
    async function scan(dir) { for (const row of await readdir(dir, { withFileTypes: true })) {
      const item = join(dir, row.name); if (row.isDirectory()) await scan(item);
      else if ((await readFile(item)).includes(Buffer.from(secret))) hits.push(row.name);
    } }
    await scan(root); assert.deepEqual(hits, []); assert.equal(submissions, 0);
    assert.match(await readFile(file, 'utf8'), /KEPT-OTHER-SESSION-TEXT/);
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});
