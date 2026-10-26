import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHistoryImport } from '../src/personal-access/history-import.mjs';
import { createPhoneHistory } from '../src/personal-access/phone-history.mjs';
import { createOfflineService } from '../src/personal-offline/index.mjs';
import { openTask, taskRecipient } from '../src/personal-offline/crypto.mjs';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs';

const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON;
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE;
const live = process.env.AND2_MIMO_LIVE === '1';
const owner = 'owner-00000000-0000-4000-8000-000000000002';
const identity = { ownerId: owner, hostId: 'synthetic-host', deviceId: 'synthetic-phone' };
// CI has the base Core dependencies. Script only semantic similarity scores,
// just as personal-memory-core-upgrade does; Core still owns all source,
// permission, currentness, recall projection and deletion decisions.
// The live acceptance uses the actual bundled E5 encoder without this fixture.
const scriptedScores = `
import runpy
import memoweft.integrations.hermes.recall as recall
from memoweft.semantic.config import SemanticConfig
from memoweft.semantic.runtime import SemanticCandidate
from memoweft.semantic.store import content_hash
class Provider:
    config = SemanticConfig()
    def candidates(self, db, subject_id, query):
        return [SemanticCandidate('cognition', row[0], 0.98, content_hash(row[1]))
                for row in db.execute('SELECT id, content FROM cognition WHERE subject_id=?', (subject_id,))]
    def score_texts(self, query, texts): return [0.98 for text in texts]
recall.provider_for = lambda db: Provider()
runpy.run_module('memoweft.integrations.dsh_bridge', run_name='__main__')
`;

test(`phone originals through real E2: formation, correction, fresh desktop recall and replica forgetting (${live ? 'MiMo' : 'scripted model'})`, {
  skip: !python || !pythonPath ? 'observed-core supplies the pinned real Core' : false, timeout: 180000,
}, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-phone-core-')));
  let manager: ReturnType<typeof createPersonalMemoryManager>;
  let offline: Awaited<ReturnType<typeof createOfflineService>>;
  let imports: ReturnType<typeof createHistoryImport>;
  const modelErrors: unknown[] = [];
  let calls = 0;
  const model = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw); calls++;
      if (live) {
        assert.ok(process.env.MIMO_API_KEY, 'live run requires a process-only MiMo credential');
        const reply = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.MIMO_API_KEY}` },
          body: JSON.stringify({ ...body, model: 'mimo-v2.6-flash' }), signal: AbortSignal.timeout(60000),
        });
        assert.equal(reply.status, 200);
        res.writeHead(200, { 'content-type': 'application/json' }).end(await reply.text());
        return;
      }
      const payload = body.messages.map(m => { try { return JSON.parse(m.content); } catch { return null; } })
        .find(value => Array.isArray(value?.evidence));
      assert.ok(payload, 'formation request includes real evidence');
      const evidence = payload.evidence[0];
      const correction = evidence.text.includes('绿茶');
      const item = { action: 'form', target: 'owner_self', statement_kind: 'preference', formed_by: 'stated',
        proposition: correction ? '现在只喝绿茶' : '我只喝红茶',
        supports: [{ evidence_id: evidence.id, quote: correction ? '现在只喝绿茶' : '我只喝红茶' }],
        ...(correction ? { supersedes_cognition_id: payload.current_cognitions[0].id } : {}) };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: {
        content: JSON.stringify({ schema_version: 8, result: 'cognitions', cognitions: [item] }),
      }, finish_reason: 'stop' }] }));
    } catch (error) { modelErrors.push(error); res.writeHead(500).end('{}'); }
  });
  const host = createServer(async (req, res) => {
    try { await offline.handle(req, res, new URL(req.url!, 'http://127.0.0.1'), owner); }
    catch (error) { res.writeHead(error.status ?? 500).end(JSON.stringify({ code: error.code ?? error.message })); }
  });
  try {
    await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(model.address() as any).port}/v1`;
    manager = createPersonalMemoryManager({ root, enabled: true, python, pythonPath, baseUrl, model: '@current',
      credential: () => 'synthetic', processingRoute: () => ({ profileId: 'chat', baseUrl, model: 'synthetic',
        credential: 'synthetic', routeFingerprint: null, modelTier: 'cloud' }),
      rpcFactory: options => new MemoWeftRpc({ ...options,
        ...(!live ? { pythonArgs: ['-B', '-c', scriptedScores] } : {}), env: { ...options.env,
        MEMOWEFT_SEMANTIC_ENABLED: live ? '1' : '0', PYTHONDONTWRITEBYTECODE: '1' } }) });
    const account: any = { sessions: {}, commands: {}, defaultModelProfileId: 'chat' };
    const context: any = { root, rootState: { hostId: identity.hostId, accounts: { [owner]: account } },
      timestamp: Date.now, accountState: () => account, serial: async fn => fn(), mutate: async (_owner, fn) => fn(account),
      active: new Set(), pendingPreflights: new Set(), memoryManager: manager,
      authenticate: () => ({ ...identity, via: 'cookie', device: { authKind: 'cloud', name: '合成手机', scopes: ['account:manage'] } }),
      readJson: async req => { let raw = ''; for await (const part of req) raw += part; return JSON.parse(raw); },
      json: (res, status, value) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value)),
      backend: { listModels: async () => [{ id: 'chat', sourceKind: 'local', configured: true, name: '聊天模型' }] },
      modelSelectable: () => true, service: { currentChatModelProfile: () => 'chat' },
      cloudIdentity: { publishOffline: async (_owner, generation) => ({ generation, accountId: 'synthetic-account', hostId: identity.hostId,
        capabilities: { offlineTasks: 1 } }) },
      usage: { settings: () => ({ prices: {} }), assertAllowed() {}, exportAccount: () => ({ records: [] }) } };
    context.phoneHistory = createPhoneHistory(context, context.backend);
    context.backend = context.phoneHistory.backend;
    imports = context.historyImport = createHistoryImport(context);
    offline = context.offline = await createOfflineService(context);
    await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${(host.address() as any).port}/personal/v1/offline`;
    const post = async (path: string, body: any) => {
      const response = await fetch(address + path, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
    };
    const recipient = taskRecipient();
    const sync = async (previous: any = { generation: 0, hashes: {} }, phoneFirst = true) => openTask(await post('/sync', {
      publicJwk: recipient.publicJwk, generation: previous.generation, hashes: previous.hashes, taskSupport: 1,
      ...(phoneFirst ? { phoneFirst: true } : {}),
    }), recipient, identity);
    let replica = await sync(undefined, false);
    assert.equal(replica.memoryAuthority.ready, true, 'a legacy phone can discover the cold real Core before uploading originals');
    if (live) {
      await manager.recall(owner, { query: '我平时喝什么茶', sessionId: 'semantic-startup', modelTier: 'cloud' });
      const deadline = Date.now() + 45000;
      let status;
      do { status = await manager.status(owner); if (status.semanticRecall?.state === 'ready') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      assert.equal(status.semanticRecall?.state, 'ready', 'live acceptance requires the actual semantic model');
    }
    const submit = async (id: string, text: string, timestamp: number) => {
      const result = await post('/turns', { generation: replica.generation, turns: [{ id, conversationId: 'tea', timestamp,
        messages: [{ role: 'user', text }, { role: 'assistant', text: '知道了。' }], memoryRefs: [], dependencyComplete: true }] });
      assert.equal(result.receipts[0].memoryState, 'running');
      const deadline = Date.now() + 65000;
      while (Date.now() < deadline) {
        await imports.tick();
        const job = imports.list(owner).imports.find(j => j.id === result.receipts[0].importId);
        assert.ok(!['paused', 'awaiting_confirmation'].includes(job.state), JSON.stringify(job));
        if (job.state === 'completed') { assert.ok(job.memoryCount > 0, 'real worker formed a formal memory'); return; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('phone import did not settle: ' + JSON.stringify(imports.list(owner)));
    };
    const recallTea = async (sessionId: string, tea: string) => {
      // Formation is durable before the asynchronous E5 index refresh finishes.
      const deadline = Date.now() + 15000;
      let result;
      do { result = await manager.recall(owner, { query: '我平时喝什么茶', sessionId, modelTier: 'cloud' });
        if (result.contextText.includes(tea)) return result;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      assert.fail(`fresh desktop recall missing ${tea}: ` + JSON.stringify(result));
    };
    await submit('red-tea', '请记住，我只喝红茶', Date.UTC(2026, 9, 25, 9));
    const firstRecall = await recallTea('fresh-red', '红茶');
    assert.match(firstRecall.contextText, /红茶/);
    replica = await sync(replica);
    assert.ok(replica.items.some(item => item.text.includes('红茶')), JSON.stringify(replica.items));
    const red = replica.items.find(item => item.text.includes('红茶')).id;
    await submit('green-tea', '我改口了，现在只喝绿茶', Date.UTC(2026, 9, 25, 10));
    const corrected = await recallTea('fresh-green', '绿茶');
    assert.match(corrected.contextText, /绿茶/);
    assert.doesNotMatch(corrected.contextText, /红茶/);
    replica = await sync(replica);
    assert.ok(replica.items.some(item => item.text.includes('绿茶')), JSON.stringify(replica.items));
    assert.ok(replica.remove.includes(red));
    assert.ok(!replica.items.some(item => item.text.includes('红茶')));
    const green = replica.items.find(item => item.text.includes('绿茶'));
    const preview = await manager.query(owner, 'preview_forget', { target_kind: green.kind, target_id: green.id });
    const forgotten = await manager.submit(owner, { schema_version: 1, command_id: 'synthetic-forget-tea', subject_id: owner,
      actor: 'owner', expected_world_revision: preview.world_revision, operation: 'delete_world_item', target_kind: green.kind,
      target_id: green.id, payload: { forget_scope: preview.forget_scope }, submitted_at: new Date().toISOString() });
    assert.equal(forgotten.receipt.result_state, 'applied');
    replica = await sync(replica);
    assert.ok(replica.remove.includes(green.id));
    assert.ok(!replica.items.some(item => /红茶|绿茶/.test(item.text)));
    assert.doesNotMatch((await manager.recall(owner, { query: '我平时喝什么茶', sessionId: 'fresh-forgotten', modelTier: 'cloud' })).contextText, /红茶|绿茶/);
    assert.deepEqual(modelErrors, []);
    t.diagnostic(JSON.stringify({ formation: 'red', correction: 'green', forgotten: true, modelCalls: calls, model: live ? 'MiMo' : 'scripted' }));
  } finally {
    await imports?.close(); await offline?.close(); await manager?.close();
    host.closeAllConnections(); model.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => host.close(() => resolve())), new Promise<void>(resolve => model.close(() => resolve()))]);
    await rm(root, { recursive: true, force: true });
  }
});
