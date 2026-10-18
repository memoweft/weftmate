import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { createMemoryCommandJournal } from '../src/personal-memory/journal.mjs';
import { eraseSessionMemoryArtifact } from '../src/runtime/dsh-adapter/memory-erasure.mjs';
import { runInNewContext } from 'node:vm';

const owner = 'owner-00000000-0000-4000-8000-000000000001', secret = 'SYNTHETIC-486-NATIVE-ERASE';
const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
for (const legacy of [true, false]) for (const blocked of [false, true]) test(`${legacy ? 'legacy' : 'new'} pending native cleanup ${blocked ? 'stays pending until writable' : 'erases before withdrawing its locator'}`, { timeout: 30000 }, async () => {
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
  const proposal = { requestId: 'legacy-delete', operation: 'delete_world_item', targetKind: 'cognition', targetId: 'deleted-target', expectedWorldRevision: 1, payload: {} };
  let marker = legacy ? await journal.reserve({ ownerId: owner, ...proposal,
    cleanup: { sourceTexts: [secret], deleteConversationSnippets: true } }) : null;
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
      if (method === 'ingest_boundary') throw Object.assign(Error('synthetic source delivery unavailable'), { code: 'MEMORY_BUSY' });
      if (method === 'query_provenance') return { provenance: [{ evidence: { evidence_id: 'source-a', raw_content: secret } }] };
      if (!marker && method === 'query_command_receipt') throw Object.assign(Error('not submitted'), { code: 'command_receipt_not_found' });
      if (method === 'submit_command') {
        submissions++;
        marker = JSON.parse(await readFile(join(root, 'accounts', owner, 'memory-home/command-journal.json'), 'utf8')).records[proposal.requestId];
        assert.equal(marker.cleanup.conversationTargets[0].snippetTargets[0].seq, 2, 'event locator must be durable before Core submission');
        assert.equal(JSON.stringify(marker.cleanup.conversationTargets).includes(secret), false);
      }
      return { receipt: { command_id: marker.command.command_id, result_state: 'applied', affected_ids: [], storage_cleanup: { state: 'complete' } } };
    } }) });
  let manager = create();
  try {
    await manager.ingest(owner, { event_id: 'source-a', parent_session_id: 'session', source_messages: [{ role: 'user', content: secret }] }, { defer: true });
    assert.equal((await manager.pendingStatus(owner)).pendingBoundaryCount, 1);
    if (!legacy) await manager.submitCommand(owner, { ...proposal, deleteConversationSnippets: true });
    await manager.discardPendingSources(owner, { sessionId: 'withdrawn-session' });
    await manager.close(); manager = create();
    const result = await manager.retryCleanupByRequest(owner, marker.requestId);
    if (blocked) {
      assert.equal(result.receipt.storage_cleanup.state, 'pending');
      const pending = JSON.parse(await readFile(join(root, 'accounts', owner, 'memory-home/command-journal.json'), 'utf8')).records[marker.requestId];
      assert.ok(pending.cleanup); assert.equal(JSON.stringify(pending).includes(secret), false);
      assert.equal((await manager.status(owner)).pendingCleanup[0].requestId, marker.requestId);
      unwritable = false;
      assert.equal((await manager.retryCleanupByRequest(owner, marker.requestId)).receipt.storage_cleanup.state, 'complete');
      assert.deepEqual((await manager.status(owner)).pendingCleanup, []);
    } else assert.equal(result.receipt.storage_cleanup.state, 'complete');
    await manager.close();
    const hits = [];
    async function scan(dir) { for (const row of await readdir(dir, { withFileTypes: true })) {
      const item = join(dir, row.name); if (row.isDirectory()) await scan(item);
      else if ((await readFile(item)).includes(Buffer.from(secret))) hits.push(row.name);
    } }
    await scan(root); assert.deepEqual(hits, []); assert.equal(submissions, legacy ? 0 : 1);
    assert.match(await readFile(file, 'utf8'), /KEPT-OTHER-SESSION-TEXT/);
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});

test('a fresh memory page restores the existing cleanup control from host status, including no_change receipts', async () => {
  const context = { WeftUiCore: { factories: {} } }, notices = [], storage = new Map();
  runInNewContext(await readFile(new URL('../src/ui-core/memory.js', import.meta.url), 'utf8'), context);
  const core: any = { state: { account: { ownerId: owner }, hostId: 'synthetic-host' }, memory: {}, memoryKinds: { cognition: '记忆' } };
  Object.assign(core, context.WeftUiCore.factories.memory(core, { memoryStatus() {}, paintMemoryReceipt(...args) { notices.push(args); },
    readMemoryReceiptId: () => 'pending-delete', setMemoryCleanupBusy() {}, renderMemoryMode() {} }, { storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } }));
  core.memoryIdentity = () => ({ ownerId: owner }); core.memoryViewCurrent = core.memoryIdentityCurrent = () => true;
  core.memoryRequest = async () => ({ state: 'degraded', capabilities: { list: true }, pendingCleanup: [{ requestId: 'pending-delete', kind: 'cognition', id: 'target' }] });
  assert.equal(await core.refreshMemoryStatus(), true);
  assert.equal(core.memory.cleanupMarker.requestId, 'pending-delete'); assert.equal(notices.at(-1)[2], 'retry-cleanup');
  assert.match(notices.at(-1)[0], /还有删除未清理完/);
  let posts = 0;
  core.requestMemoryCleanup = async () => { posts++; return { receipt: { requestId: 'pending-delete', state: 'no_change', storageCleanup: { state: posts === 1 ? 'pending' : 'complete' } } }; };
  await core.retryMemoryCleanup(); assert.equal(notices.at(-1)[2], 'retry-cleanup'); assert.match(notices.at(-1)[0], /删除清理还未完成/);
  await core.retryMemoryCleanup(); assert.equal(notices.at(-1)[2], 'none'); assert.equal(core.memory.cleanupMarker, null); assert.equal(posts, 2);
});

test('native cleanup rejects a successful write when its verification read still contains source text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-native-verify-')), file = join(root, 'session.jsonl');
  const content = JSON.stringify({ id: 'session' }) + '\n' + JSON.stringify({ seq: 1, type: 'user/message', data: { content: secret } }) + '\n';
  await writeFile(file, content);
  const persistence = { config: { root }, locate: () => ({ path: file }), readRaw: async () => ({ meta: { id: 'session' }, content }) };
  try { await assert.rejects(eraseSessionMemoryArtifact(persistence, 'session', { sourceTexts: [secret], deleteConversationSnippets: true }), /verification failed/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
