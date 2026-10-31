// 保护：运行回合结束后必须完成原遗忘清理并解除发送门禁，不能重新删除或重复清理。
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryCommandJournal } from '../src/personal-memory/journal.mjs';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';

const owner = 'owner-00000000-0000-4000-8000-000000000001';
const proposal = { ownerId: owner, requestId: 'forget-tea', operation: 'delete_world_item',
  targetKind: 'cognition', targetId: 'tea', expectedWorldRevision: 1, payload: {} };

for (const mode of ['receipt', 'core-storage-retry', 'turn-idle']) test(`${mode} after host cleanup cannot make a new conversation return SESSION_BUSY`, { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-forget-send-'));
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const receipts = new Map(), sessions = new Map();
  let service: any, repeated: Promise<any> | undefined, cleanups = 0;
  const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall',
    'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
  const manager = createPersonalMemoryManager({ root: join(root, 'memory'), enabled: true,
    python: join(root, 'synthetic-python'), pythonPath: root, baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic',
    cleanupDeletedMemory: (ownerId, options) => service.cleanupMemoryCopies(ownerId, options),
    rpcFactory: () => { let subject; return { child: {}, async close() {}, async request(method, params = {}) {
      if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods };
      if (method === 'initialize') { subject = params.subject_id; return { runtime: { subject_id: subject, db_path: join(params.dsh_home, 'memoweft/memoweft.sqlite3') },
        capabilities: { subject_id: subject, methods, services: { command: { operations: ['delete_world_item'] } } } }; }
      if (method === 'health') return { runtime: { subject_id: subject, route_ready: true } };
      if (method === 'query_world') return { items: [], world_revision: 1 };
      if (method === 'query_provenance') return { provenance: [{ evidence: { evidence_id: 'tea-source', raw_content: 'synthetic tea' } }] };
      if (method === 'submit_command') receipts.set(params.command.command_id, { command_id: params.command.command_id,
        result_state: 'applied', after_revision: 2, affected_ids: ['tea'], storage_cleanup: { state: mode === 'core-storage-retry' ? 'pending' : 'complete' } });
      if (method === 'retry_delete_storage_cleanup') receipts.get(params.command_id).storage_cleanup.state = 'complete';
      if (['submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'].includes(method)) {
        const receipt = receipts.get(params.command?.command_id ?? params.command_id);
        if (!receipt) throw Object.assign(Error('missing'), { code: 'command_receipt_not_found' });
        return { receipt };
      }
      return {};
    } }; },
  });
  try {
    const backend = { getStatus: async () => ({ runtime: 'ready' }), listModels: async () => [{ id: 'local', model: 'synthetic', configured: true }],
      preflight: async () => ({ ok: true }), sendMessage: async () => ({ accepted: true }), cancelSession: async () => ({ accepted: true }),
      createSession: async ({ sessionId }) => { sessions.set(sessionId, { sessionId, agentPreset: 'personal-remote', running: false }); return { sessionId }; },
      describeSessions: async ids => ids.map(id => sessions.get(id)).filter(Boolean), describeSession: async id => sessions.get(id),
      readEvents: async () => ({ events: [] }), cleanupMemoryCopies: async () => {
        cleanups++;
        if (mode === 'turn-idle' && cleanups === 1) throw Error('agent-busy');
        if (mode !== 'turn-idle' && cleanups > 1) { entered.resolve(); await release.promise; }
        return { cleaned: true };
      },
    };
    service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend, memoryManager: manager });
    const started = await service.start(), device = await service.enrollDevice({ name: 'synthetic' });
    const headers = { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' };
    const create = requestId => fetch(started.origin + '/personal/v1/commands', { method: 'POST', headers,
      body: JSON.stringify({ requestId, kind: 'session.create', targetDeviceId: started.hostId, modelProfileId: 'local' }) });
    const seeded = await (await create('before-forget')).json();
    for (let i = 0; i < 100; i++) {
      const command = await fetch(started.origin + '/personal/v1/commands/' + seeded.command.commandId, { headers }).then(r => r.json());
      if (command.command.state === 'accepted_by_dsh') break;
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(sessions.size, 1);
    const { ownerId: _ownerId, ...command } = proposal;
    const result = await manager.submitCommand(started.ownerId, command);
    assert.equal(result.receipt.storage_cleanup.state, mode === 'receipt' ? 'complete' : 'pending');
    if (mode === 'turn-idle') assert.equal((await create('while-forgetting')).status,409);
    repeated = mode === 'turn-idle' ? manager.resumeAfterTurn(started.ownerId) : mode === 'receipt' ? manager.receiptByRequest(started.ownerId, proposal.requestId)
      : manager.retryCleanupByRequest(started.ownerId, proposal.requestId);
    await Promise.race([repeated, entered.promise]);
    const response = await create('after-forget');
    assert.equal(response.status, 202, JSON.stringify(await response.json()));
    assert.equal(cleanups, mode === 'turn-idle' ? 2 : 1);
    assert.equal(mode === 'turn-idle' ? (await repeated).pending : (await repeated).receipt.storage_cleanup.state, mode === 'turn-idle' ? false : 'complete');
  } finally {
    release.resolve(); await repeated?.catch(() => {});
    await service?.close(); await manager.close(); await rm(root, { recursive: true, force: true });
  }
});

test('completed forget cleanup is not repeated by concurrent receipt reads or after restart', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-cleanup-once-'));
  let journal = createMemoryCommandJournal({ root }), calls = 0;
  const clean = async () => { calls++; return { snippetsVerified: true }; };
  try {
    await journal.reserve({ ...proposal, cleanup: { sourceTexts: ['synthetic tea'], deleteConversationSnippets: true } });
    // Locators are already prepared, as in a newly submitted deletion.
    // Original conversation erasure is checked by the existing cleanup contract.
    await journal.close();
    journal = createMemoryCommandJournal({ root, prepareCleanup: async () => ({ conversationTargets: [] }) });
    await journal.finishCleanup(owner, proposal.requestId, clean);
    await Promise.all([journal.finishCleanup(owner, proposal.requestId, clean), journal.finishCleanup(owner, proposal.requestId, clean)]);
    await journal.close(); journal = createMemoryCommandJournal({ root });
    await journal.finishCleanup(owner, proposal.requestId, clean);
    assert.equal(calls, 1, 'receipt reads must not reopen the account send gate after successful cleanup');
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});

test('failed cleanup remains retryable and a legacy receipt without completion proof is cleaned once', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-cleanup-retry-'));
  let journal = createMemoryCommandJournal({ root }), calls = 0;
  try {
    await journal.reserve({ ...proposal, cleanup: { sourceTexts: ['synthetic tea'], deleteConversationSnippets: false } });
    await assert.rejects(journal.finishCleanup(owner, proposal.requestId, async () => { calls++; throw Error('synthetic busy'); }), /synthetic busy/);
    assert.equal((await journal.get(owner, proposal.requestId)).cleanup.snippetsPending, true);
    await journal.close(); journal = createMemoryCommandJournal({ root });
    const clean = async () => { calls++; return { snippetsVerified: true }; };
    await journal.finishCleanup(owner, proposal.requestId, clean);
    await journal.finishCleanup(owner, proposal.requestId, clean);
    assert.equal(calls, 2, 'a failed attempt must be retried, but a successful attempt must not');
    await journal.reserve({ ...proposal, requestId: 'legacy-without-cleanup' });
    await journal.finishCleanup(owner, 'legacy-without-cleanup', clean);
    await journal.finishCleanup(owner, 'legacy-without-cleanup', clean);
    assert.equal(calls, 3, 'absence of legacy locators alone is not completion proof');
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});
