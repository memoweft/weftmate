import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadDesktopMemoryConfig } from '../src/personal-memory/config.mjs';
import { bundledMemoryRpcFactory } from '../src/personal-memory/bundled-runtime.mjs';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { applyDesktopConfig } from '../src/desktop-config.mjs';
import { createModelScheduler } from '../src/model-scheduler.mjs';
import { boundaryForCompletedTurn } from '../src/plugins/weftmate-personal-memory.mjs';

const runtime = process.env.WEFTMATE_TEST_MEMORY_RUNTIME;
const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON;
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE;
const available = runtime || python && pythonPath;
const owner = 'owner-00000000-0000-4000-8000-000000000001';

test('managed transport forms and recalls a synthetic fact through the existing local model scheduler and real Core',
  { skip: !available && 'The observed-core job supplies the pinned real Core; Windows may supply its bundled runtime' }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-auto-core-')));
  const fact = '以后请叫我小禾。';
  let requests = 0, transport, manager, scheduler;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') { response.writeHead(404).end(); return; }
    let body = ''; for await (const part of request) body += part;
    const evidence = JSON.parse(JSON.parse(body).messages.at(-1).content).evidence[0];
    requests++;
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{
      message: { content: JSON.stringify({ schema_version: 8, result: 'cognitions', cognitions: [{
        action: 'form', target: 'owner_self', statement_kind: 'naming', formed_by: 'stated',
        proposition: evidence.text, entity: { canonical_name: '小禾', kind: 'person' },
        supports: [{ evidence_id: evidence.id, sentence_id: 't0' }],
      }] }) }, finish_reason: 'stop',
    }] }));
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const profile = { id: 'synthetic-memory', model: 'synthetic-memory', baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1` };
    scheduler = await createModelScheduler({ profileFor: () => profile, credentialFor: () => 'synthetic',
      isIdle: async () => true, backgroundRoute: () => ({}), backgroundReady: async () => true });
    let config: any = { python, pythonPath, semanticCacheDirectory: null };
    let data = root;
    if (runtime) {
      const startup = applyDesktopConfig({ appData: join(root, 'user'), packaged: true, platform: 'win32',
        resourcesPath: dirname(runtime), argv: ['app'], env: {} });
      assert.equal(startup.memoryRuntimeDirectory, runtime);
      const manifest = await readFile(join(runtime, 'MEMORY-RUNTIME.json'));
      config = (await loadDesktopMemoryConfig({ directory: startup.memoryRuntimeDirectory,
        mode: JSON.parse(manifest.toString()).mode, manifestSha256: createHash('sha256').update(manifest).digest('hex') })).config;
      assert.ok(config); data = startup.config.dataDirectory;
    }
    const factory = bundledMemoryRpcFactory(config);
    const route = sessionId => ({ profileId: profile.id, baseUrl: scheduler.memoryBaseUrl(profile.id, owner, sessionId),
      model: profile.model, credential: 'synthetic', routeFingerprint: null, modelTier: 'cloud' });
    manager = createPersonalMemoryManager({ root: join(data, 'personal-access'), enabled: true,
      python: config.python, pythonPath: config.pythonPath, baseUrl: scheduler.memoryBaseUrl(profile.id), model: '@current',
      processingRoute: (_owner, sessionId) => route(sessionId), defaultProcessingRoute: () => route(null),
      rpcFactory: options => (transport = factory(options)) });
    assert.equal((await manager.status(owner)).state, 'ready');
    assert.equal(transport.child.spawnargs[0], config.python);
    assert.deepEqual(transport.child.spawnargs.slice(1), ['-B', '-m', 'memoweft.integrations.dsh_bridge']);
    const events = [{ seq: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, type: 'user/message', data: { id: 'synthetic-user', source: { kind: 'user' }, content: [{ type: 'text', text: fact }] } },
      { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } }];
    await manager.ingest(owner, boundaryForCompletedTurn({ id: 'synthetic-source', header: { agentPreset: 'personal-remote' }, events }, events.at(-1)));
    let recalled: any;
    const deadline = Date.now() + 30000;
    do {
      recalled = await manager.recall(owner, { query: '怎么称呼我？', sessionId: 'synthetic-new-session', modelTier: 'cloud' });
      if (recalled.memories?.length) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(requests > 0, 'formation must use the synthetic provider through the scheduler');
    assert.equal(recalled.state, 'ready');
    assert.ok(recalled.memories.length > 0, 'a raw evidence fallback is not a formed memory');
    assert.match(recalled.contextText, /小禾/);
    assert.ok((await readFile(join(data, 'personal-access/accounts', owner, 'memory-home/memoweft/memoweft.sqlite3'))).length > 0);
  } finally {
    await manager?.close(); await scheduler?.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
