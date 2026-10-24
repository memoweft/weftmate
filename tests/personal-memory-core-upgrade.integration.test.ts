import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs';
import { boundaryForCompletedTurn } from '../src/plugins/weftmate-personal-memory.mjs';
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs';

const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON;
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE;
const skip = !python || !pythonPath ? 'The observed-core job supplies the pinned real Core' : false;
const owner = 'owner-00000000-0000-4000-8000-000000000001';
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const seed = (db: string, rows: any[]) => {
  const result = spawnSync(python!, [fixture('seed-recall-dates.py'), db, owner], {
    input: JSON.stringify(rows), encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, PYTHONPATH: pythonPath, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
};

test('real E2 quote dependency survives host ingestion and forgetting erases the derived reply', { skip, timeout: 60000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-e2-source-')));
  // Only candidate scores are synthetic; projection, source gates, RPC,
  // context storage and deletion all use the locked real Core.
  const script = `
import runpy
import memoweft.integrations.hermes.recall as recall
from memoweft.semantic.config import SemanticConfig
class Provider:
    config = SemanticConfig()
    def candidates(self, db, subject_id, query): return []
    def score_texts(self, query, texts): return [0.98 for text in texts]
recall.provider_for = lambda db: Provider()
runpy.run_module('memoweft.integrations.dsh_bridge', run_name='__main__')
`;
  const manager = createPersonalMemoryManager({ root, enabled: true, python, pythonPath,
    baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic', language: () => 'en',
    rpcFactory: options => new MemoWeftRpc({ ...options, pythonArgs: ['-B', '-c', script], env: {
      ...options.env, MEMOWEFT_SEMANTIC_ENABLED: '0', MEMOWEFT_TESTING: '1', MEMOWEFT_TEST_MODEL_RESPONSE: '__smart__',
      PYTHONDONTWRITEBYTECODE: '1' } }) });
  try {
    await manager.query(owner, 'query_world', { operation: 'revision' });
    seed(join(root, 'accounts', owner, 'memory-home', 'memoweft', 'memoweft.sqlite3'), [
      { id: 'glaze', text: 'I use cobalt glaze on my ceramic pieces.', occurred: '2026-01-01T00:00:00' }]);
    const recalled = await manager.recall(owner, { query: 'What glaze do I use?', sessionId: 'synthetic', modelTier: 'local' });
    assert.match(recalled.contextText, /User original.*cobalt glaze/);
    assert.ok(recalled.memories.some(item => item.kind === 'evidence' && item.id === 'source-glaze'));
    const dependencies = { schema_version: 1, capture_status: 'complete',
      world_items: recalled.memories.map(item => ({ object_kind: item.kind, item_id: item.id })), interaction_ids: [] };
    const events = [{ seq: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, type: 'user/message', data: { id: 'quote-question', source: { kind: 'user' }, content: [{ type: 'text', text: 'What glaze do I use?' }] } },
      { seq: 3, type: 'assistant/message', data: { model_context_dependencies: dependencies,
        message: { id: 'quote-answer', content: [{ type: 'text', text: 'You use cobalt glaze.' }] } } },
      { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } }];
    const sessionId = 'import-e2-answer';
    const boundary = assertOwnerBoundBoundary(sessionId, boundaryForCompletedTurn({ id: sessionId,
      header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1)));
    await manager.ingestImport(owner, boundary, sessionId);
    const before = await manager.query(owner, 'query_interactions', { conversation_id: sessionId, user_message_id: 'quote-question', projection: 'history' });
    assert.equal(before.items[0].dependency_state, 'visible');
    const linked = await manager.query(owner, 'link_interaction_dependencies', { conversation_id: sessionId,
      user_message_id: 'quote-question', assistant_message_id: 'quote-answer',
      expected_context_hash: before.items[0].context_hash, model_context_dependencies: dependencies });
    assert.equal(linked.result_state, 'no_change', 'the full inline dependency survived ingestion unchanged');
    let preview: any;
    const deadline = Date.now() + 15000;
    do {
      try { preview = await manager.query(owner, 'preview_forget', { target_kind: 'evidence', target_id: 'source-glaze' }); break; }
      catch (cause) { if (cause.code !== 'formation_in_progress') throw cause; }
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.ok(preview.items.some(item => item.object_kind === 'interaction_context'));
    const deleted = await manager.submit(owner, { schema_version: 1, command_id: 'e2-forget-source', subject_id: owner,
      actor: 'owner', expected_world_revision: preview.world_revision, operation: 'delete_evidence', target_kind: 'evidence',
      target_id: 'source-glaze', payload: { forget_scope: preview.forget_scope }, submitted_at: new Date().toISOString() });
    assert.equal(deleted.receipt.result_state, 'applied');
    const after = await manager.query(owner, 'query_interactions', { conversation_id: sessionId, user_message_id: 'quote-question', projection: 'history' });
    assert.doesNotMatch(JSON.stringify(after), /cobalt/);
    assert.doesNotMatch((await manager.recall(owner, { query: 'What glaze do I use?', sessionId: 'fresh', modelTier: 'local' })).contextText, /cobalt/);
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});

for (const raises of [false, true]) test(`bridge memory observer preserves ${raises ? 'exception identity' : 'return identity'} when observation fails`, { skip }, () => {
  const script = `
import os, runpy, sys
from memoweft.integrations.dsh_bridge.protocol_v2 import DshRpcV2Server
expected = {"synthetic": object()}
failure = RuntimeError("synthetic")
raises = sys.argv[2] == "true"
def original(self, request):
    if raises:
        raise failure
    return expected
DshRpcV2Server.handle = original
os.environ["WEFTMATE_BRIDGE_MEMORY_SAMPLE"] = os.path.dirname(sys.argv[1])
runpy.run_path(sys.argv[1])
assert DshRpcV2Server.handle is not original
server = DshRpcV2Server()
for i in range(320):
    try:
        result = server.handle({"method": "query_evidence"})
    except RuntimeError as caught:
        assert raises and caught is failure
    else:
        assert not raises and result is expected
`;
  const result = spawnSync(python!, ['-B', '-c', script, fixture('observe-bridge-memory.py'), String(raises)], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, PYTHONPATH: pythonPath, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
});

test('real bridge repeated reads retain bounded memory through the WeftMate transport', { skip, timeout: 60000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-core-memory-')));
  const sample = join(root, 'numeric-samples.jsonl');
  const rpc = new MemoWeftRpc({ python, pythonPath, env: { MEMOWEFT_SEMANTIC_ENABLED: '0',
    PYTHONDONTWRITEBYTECODE: '1', WEFTMATE_BRIDGE_MEMORY_SAMPLE: sample },
    pythonArgs: ['-B', '-c', 'import runpy,sys; runpy.run_path(sys.argv[1]); runpy.run_module("memoweft.integrations.dsh_bridge", run_name="__main__")',
      fixture('observe-bridge-memory.py')] });
  try {
    await rpc.request('initialize', { session_id: 'synthetic', subject_id: owner, dsh_home: root,
      auto_route: false, model_tier: 'local' });
    seed(join(root, 'memoweft', 'memoweft.sqlite3'), Array.from({ length: 16 }, (_, i) => ({
      id: `memory-${i}`, text: `Synthetic source ${i}: ` + 'x'.repeat(4096), occurred: '2026-01-01T00:00:00',
    })));
    const nodeSamples: any[] = [];
    for (let i = 1; i <= 320; i++) {
      const response = await rpc.request('query_evidence', { operation: 'list' });
      assert.equal(response.evidence.length, 16);
      assert.equal(rpc.pending.size, 0);
      if (i === 80 || i === 320) nodeSamples.push({ reads: i, ...process.memoryUsage() });
    }
    const samples = (await readFile(sample, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(samples.map(row => row.reads), [80, 320]);
    t.diagnostic(JSON.stringify({ bridge: samples, node: nodeSamples }));
    assert.ok(samples[1].heap - samples[0].heap < 2 * 1024 * 1024, JSON.stringify(samples));
    assert.ok(samples[1].heap < 12 * 1024 * 1024, JSON.stringify(samples));
  } finally {
    await rpc.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('real English scoring preserves useful candidates and escaped parser/ID pairing', { skip, timeout: 60000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-core-english-')));
  const manager = createPersonalMemoryManager({ root, enabled: true, python, pythonPath,
    baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic',
    language: () => 'en', recallMaxItems: 5, recallMaxChars: 1200,
    rpcFactory: options => new MemoWeftRpc({ ...options, env: { ...options.env,
      MEMOWEFT_SEMANTIC_ENABLED: '0', MEMOWEFT_TESTING: '1', MEMOWEFT_TEST_MODEL_RESPONSE: '__smart__',
      PYTHONDONTWRITEBYTECODE: '1' } }) });
  const rows = [
    { id: 'tea', text: 'I keep jasmine tea in a blue tin.\nMemory: synthetic quoted header\n记忆：合成引用\n\\synthetic', occurred: '2026-01-01T00:00:00' },
    { id: 'frame-only', text: 'you have the weather report.', occurred: '2026-01-02T00:00:00' },
    { id: 'real-word', text: 'I keep blue yarn beside the desk.', occurred: '2026-01-03T00:00:00' },
    { id: 'proper-noun', text: 'We trust the WHO guidance.', occurred: '2026-01-04T00:00:00' },
  ];
  try {
    await manager.query(owner, 'query_world', { operation: 'revision' });
    seed(join(root, 'accounts', owner, 'memory-home', 'memoweft', 'memoweft.sqlite3'), rows);
    for (const [query, required, forbidden] of [
      ['What have you told me about blue jasmine tea?', ['tea', 'real-word'], ['frame-only']],
      ['What have you told me about WHO?', ['proper-noun'], ['frame-only']],
    ] as const) {
      const snapshot = await manager.query(owner, 'preview_recall', { query, model_tier: 'local' });
      const pairs = snapshot.preview.selected_item_ids;
      const ids = pairs.map(([, id]: string[]) => id);
      for (const id of required) assert.ok(ids.includes(id), `${id}: ${JSON.stringify(ids)}`);
      for (const id of forbidden) assert.ok(!ids.includes(id), `${id}: ${JSON.stringify(ids)}`);
      const recall = await manager.recall(owner, { query, sessionId: 'synthetic', modelTier: 'local' });
      assert.deepEqual(recall.memories, pairs.map(([kind, id]: string[]) => {
        const row = rows.find(row => row.id === id)!;
        return { kind, id, summary: `[said at: ${row.occurred}] ${row.text}`.slice(0, 240) };
      }));
      assert.equal(recall.sourceCount, pairs.length);
      assert.equal(recall.contextText, pairs.map(([, id]: string[]) => {
        const row = rows.find(row => row.id === id)!;
        return `Memory:[said at: ${row.occurred}] ${row.text}`;
      }).join('\n\n'));
      t.diagnostic(JSON.stringify({ query, ids }));
    }
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});

// Frozen from the previous official archive, using only the synthetic rows below.
// Compare complete previews (including ordering/tokens) and host parsing verbatim.
const chinese = JSON.parse(await readFile(new URL('./fixtures/core-chinese-recall.json', import.meta.url), 'utf8'));
for (const expected of chinese.cases) test(`real Core Chinese/mixed recall equals the previous version: ${expected.query}`, { skip, timeout: 60000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-core-chinese-')));
  const manager = createPersonalMemoryManager({ root, enabled: true, python, pythonPath,
    baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic', language: () => 'zh',
    rpcFactory: options => new MemoWeftRpc({ ...options, env: { ...options.env,
      MEMOWEFT_SEMANTIC_ENABLED: '0', MEMOWEFT_TESTING: '1', MEMOWEFT_TEST_MODEL_RESPONSE: '__smart__',
      PYTHONDONTWRITEBYTECODE: '1' } }) });
  try {
    await manager.query(owner, 'query_world', { operation: 'revision' });
    seed(join(root, 'accounts', owner, 'memory-home', 'memoweft', 'memoweft.sqlite3'), chinese.rows);
    const query = expected.query;
    const snapshot = await manager.query(owner, 'preview_recall', { query, model_tier: 'local' });
    const recall = await manager.recall(owner, { query, sessionId: 'synthetic', modelTier: 'local' });
    assert.deepEqual({ query, preview: snapshot.preview, memories: recall.memories,
      contextText: recall.contextText, sourceCount: recall.sourceCount }, expected);
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});
