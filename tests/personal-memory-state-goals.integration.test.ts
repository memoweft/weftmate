import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs';
import { boundaryForCompletedTurn } from '../src/plugins/weftmate-personal-memory.mjs';
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs';

const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON;
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE;
const skip = !python || !pythonPath ? 'The observed-core job supplies the pinned real Core' : false;
const owner = 'owner-00000000-0000-4000-8000-000000000001';

function boundary(text: string, session: string) {
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: session + '-user', source: { kind: 'user' }, content: [{ type: 'text', text }] } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
  ];
  return assertOwnerBoundBoundary(session, boundaryForCompletedTurn({ id: session,
    header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1)));
}

async function settled(manager: ReturnType<typeof createPersonalMemoryManager>) {
  const deadline = Date.now() + 15000;
  do {
    const result = await manager.query(owner, 'query_jobs', { operation: 'list' });
    if (!result.jobs.some(job => ['pending', 'processing', 'retry'].includes(job.worker?.state))) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('Synthetic formation worker did not settle');
}

// Only model interpretation is scripted. Ingest, worker, source rules, revision
// chain, currentness and recall all run in the official bridge; no SQLite seed.
for (const lang of ['zh', 'en'] as const) for (const scenario of ['state', 'goal', 'other-owner-goal'] as const) {
  test(`real bridge ${lang} ${scenario}: formation, sources and cross-session recall`, { skip, timeout: 60000 }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-state-goals-')));
    const errors: unknown[] = [];
    const calls: any[] = [];
    let modelCalls = 0;
    let prior: string | undefined;
    const rows = scenario === 'state'
      ? (lang === 'zh' ? ['我住在北港。', '我现在住在南港。', '我住在北港。']
        : ['I live in Northport.', 'I now live in Southport.', 'I live in Northport.'])
      : scenario === 'goal'
        ? [lang === 'zh' ? '我不打算中断训练，但是我的长期目标是建一座社区图书馆。'
          : "I do not plan to stop training, but my long-term goal is to build a community library."]
        : [lang === 'zh' ? '我的目标是资助我女儿的教育。' : "My goal is to fund my daughter's education."];
    const goalQuote = lang === 'zh' ? '我的长期目标是建一座社区图书馆。' : 'my long-term goal is to build a community library.';
    const server = createServer(async (request, response) => {
      try {
        let body = ''; for await (const part of request) body += part;
        const messages = JSON.parse(body).messages;
        // Core may ask for one interpretation repair after rejecting a goal.
        // Always repeat the same form proposal; never fake a no_change result.
        const payload = messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
          .find(value => Array.isArray(value?.evidence));
        modelCalls++;
        const repair = messages.length > 2;
        if (!repair) calls.push(payload);
        const evidence = payload.evidence[0];
        assert.equal(evidence.text, rows[calls.length - 1]);
        if (prior) assert.deepEqual(payload.current_cognitions.map(row => row.id), [prior]);
        const item = { action: 'form', target: 'owner_self', statement_kind: scenario === 'state' ? 'attribute' : 'preference',
          formed_by: 'stated', proposition: scenario === 'goal' ? goalQuote : evidence.text,
          supports: [{ evidence_id: evidence.id, quote: scenario === 'goal' ? goalQuote : evidence.text }],
          ...(prior ? { supersedes_cognition_id: prior } : {}),
          ...(scenario !== 'state' ? { is_long_term_goal: true } : {}) };
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{
          message: { content: JSON.stringify({ schema_version: 8, result: 'cognitions', cognitions: [item] }) }, finish_reason: 'stop',
        }] }));
      } catch (error) { errors.push(error); response.writeHead(500).end('{}'); }
    });
    let manager;
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`;
      const create = () => createPersonalMemoryManager({ root, enabled: true, python, pythonPath, baseUrl,
        model: '@current', credential: () => 'synthetic', language: () => lang,
        processingRoute: () => ({ profileId: 'synthetic', baseUrl, model: 'synthetic', credential: 'synthetic', routeFingerprint: null, modelTier: 'local' }),
        rpcFactory: options => new MemoWeftRpc({ ...options, env: { ...options.env,
          MEMOWEFT_SEMANTIC_ENABLED: '0', PYTHONDONTWRITEBYTECODE: '1' } }) });
      manager = create();
      const ids: string[] = [];
      for (const [i, raw] of rows.entries()) {
        assert.equal((await manager.ingest(owner, boundary(raw, `synthetic-${i}`))).state, 'accepted');
        await settled(manager);
        assert.deepEqual(errors, []);
        assert.equal(calls.length, i + 1);
        const world = await manager.query(owner, 'query_world', { operation: 'list', object_kind: 'cognition', include_history: true });
        const query = scenario === 'state' ? raw : (lang === 'zh' ? '图书馆 目标 教育' : 'library goal education');
        const recall = await manager.recall(owner, { query, sessionId: `new-session-${i}`, modelTier: 'local' });
        if (scenario === 'other-owner-goal') {
          assert.deepEqual(world.items, []);
          assert.deepEqual(recall.memories, [], 'raw evidence must not masquerade as a formed goal');
        } else {
          assert.equal(world.items.length, i + 1);
          // Catalog lifecycle labels are separate from supersession. Prove
          // current recall below, and inspect the persisted transition chain.
          const current = world.items.filter(item => !ids.includes(item.item_id));
          assert.equal(current.length, 1);
          prior = current[0].item_id;
          ids.push(prior!);
          assert.equal(new Set(ids).size, i + 1, 'returning to A creates a new occurrence instead of reviving old A');
          assert.deepEqual(recall.memories.map(item => item.id), [prior]);
          assert.match(recall.contextText, scenario === 'state'
            ? new RegExp(lang === 'zh' ? (i === 1 ? '南港' : '北港') : (i === 1 ? 'Southport' : 'Northport'))
            : new RegExp(lang === 'zh' ? '社区图书馆' : 'community library'));
          const provenance = await manager.query(owner, 'query_provenance', { object_kind: 'cognition', item_id: prior, projection: 'history' });
          assert.ok(provenance.provenance.some(source => source.evidence.raw_content === raw));
          const inspect = spawnSync(python!, ['-B', '-c',
            'import json,sqlite3,sys; db=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(json.dumps(db.execute("SELECT prior_cognition_id,replacement_cognition_id FROM cognition_transitions ORDER BY revision").fetchall())); db.close()',
            join(root, 'accounts', owner, 'memory-home', 'memoweft', 'memoweft.sqlite3')],
            { encoding: 'utf8', windowsHide: true, timeout: 10000 });
          assert.equal(inspect.status, 0, inspect.stderr);
          assert.deepEqual(JSON.parse(inspect.stdout), ids.slice(1).map((id, index) => [ids[index], id]));
        }
      }
      const evidence = await manager.query(owner, 'query_evidence', { operation: 'list' });
      assert.deepEqual(evidence.evidence.map(row => row.raw_content).sort(), [...rows].sort());
      const beforeRestart = modelCalls;
      await manager.close(); manager = create();
      const restored = await manager.recall(owner, { query: rows.at(-1), sessionId: 'after-restart', modelTier: 'local' });
      assert.deepEqual(restored.memories.map(item => item.id), prior ? [prior] : []);
      assert.equal(calls.length, rows.length, 'recall and restart do not generate more model calls');
      assert.equal(modelCalls, beforeRestart);
    } finally {
      await manager?.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
}
