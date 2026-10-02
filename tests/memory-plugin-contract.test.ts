import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// R7 记忆宿主插件契约（源码锁）：
//  - 边界源（compaction/end 门控 + user Evidence 组装 + 信封哈希绑定 + 跨语言规范化字节一致）
//  - 桥传输（env 注入 + JSON-Lines）
//  - Recall 注入门（命中才注入、查询上限、plugin 名可核验）
//  - 管理面路由（world/search/export 只读）
const plugin = readFileSync(new URL('../src/plugins/weftmate-memory.mjs', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/dsh-web-runtime.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8');
const CORE_PYTHON = process.env.WEFTMATE_MEMOWEFT_PYTHON ?? 'D:\\AIProjects\\MemoWeft\\Core\\py\\.venv\\Scripts\\python.exe';
const CORE_PYTHONPATH = process.env.WEFTMATE_MEMOWEFT_PYTHONPATH ?? 'D:\\AIProjects\\MemoWeft\\Core\\py\\src';
const coreAvailable = existsSync(CORE_PYTHON) && existsSync(join(CORE_PYTHONPATH, 'memoweft', 'integrations', 'dsh_bridge', '__main__.py'));
const stagedMemoryRoot = mkdtempSync(join(tmpdir(), 'weftmate-memory-module-'));
const stagedMemoryPath = join(stagedMemoryRoot, 'weftmate-memory.mjs');
const vendorTools = pathToFileURL(join(fileURLToPath(new URL('../', import.meta.url)), 'vendor', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')).href;
writeFileSync(stagedMemoryPath, plugin.replace("from '@deepseek-ai/dsh-tools'", `from ${JSON.stringify(vendorTools)}`), 'utf8');
const importMemoryPlugin = () => import(pathToFileURL(stagedMemoryPath).href);
process.on('exit', () => rmSync(stagedMemoryRoot, { recursive: true, force: true }));

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return source.slice(from, to);
}

// 与 Python json.dumps(ensure_ascii=True, separators=(',',':'), sort_keys=True) 一致的 JS 实现
// （从插件源码抽取同款逻辑用于字节级对照）。
function canonicalJson(value) {
  const sorted = (item) => {
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) return item.map(sorted);
    const out = {};
    for (const key of Object.keys(item).sort()) out[key] = sorted(item[key]);
    return out;
  };
  return JSON.stringify(sorted(value)).replace(/[\u007f-\uffff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

describe('R7 记忆宿主插件契约', () => {
  it('world adapter exposes the formal Core subject_id for V2 command construction without inventing one', async () => {
    const { adaptWorldForLegacyPanel } = await importMemoryPlugin();
    const core = { subject_id: 'owner-actual', world_revision: 1, items: [] };
    assert.equal(adaptWorldForLegacyPanel(core, { subject_id: 'owner-capability' }).subject_id, 'owner-actual');
    assert.equal(adaptWorldForLegacyPanel({ world_revision: 1, items: [] }, { subject_id: 'owner-capability' }).subject_id, 'owner-capability');
    assert.equal(adaptWorldForLegacyPanel({ world_revision: 1, items: [] }, {}).subject_id, null);
  });
  it('registered memory handler serves world and normalizes command receipts without leaking instance state', async () => {
    const { apply } = await importMemoryPlugin();
    const oldEnabled = process.env.WEFTMATE_MEMOWEFT_ENABLED; process.env.WEFTMATE_MEMOWEFT_ENABLED = '1';
    let handler: any; const submitted: any[] = [];
    const capabilities = { subject_id: 'owner-1', world_revision: 4 };
    const bridge: any = { child: {}, generation: 0, capabilities, acceptCapabilities(value) { this.capabilities = value; }, close: async () => {}, async request(method: string, params: any) {
      if (method === 'capabilities') return capabilities; if (method === 'initialize') return { capabilities };
      if (method === 'query_world') return { subject_id: 'owner-1', world_revision: 4, cognitions: [] };
      if (method === 'submit_command') { submitted.push(params.command); return params.command.command_id === 'conflict' ? { receipt: { result_state: 'revision_conflict', world_revision: 5 } } : { receipt: { result_state: 'applied', world_revision: 5 } }; }
      return {};
    } };
    const ctx: any = { logger: { info() {} }, get(name: string) { if (name === 'credentials') return { resolve: async () => undefined }; if (name === 'webServer') return { register(route: any) { handler = route.handler; return () => {} } }; if (name === 'settings') return { get: () => ({ providers: {} }) }; }, on() {}, effect(run: Function) { run(); } };
    const call = async (url: string, body?: any) => { const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]; const req: any = { method: body === undefined ? 'GET' : 'POST', url, headers: body === undefined ? {} : { host: '127.0.0.1:9', origin: 'http://127.0.0.1:9', 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield* chunks } }; let status = 0, text = ''; const res: any = { writeHead(code: number) { status = code }, end(value?: string) { text = value ?? '' } }; await handler(req, res); return { status, json: JSON.parse(text) }; };
    try {
      apply(ctx, { bridge }); const world = await call('/weftmate/memory/world.json'); assert.equal(world.status, 200); assert.equal(world.json.subject_id, 'owner-1'); assert.equal(world.json.world_revision, 4);
      const short = await call('/weftmate/memory/command.json', { command: { command_id: 'applied', operation: 'correct_world_item', target_id: 'c1', payload: { correction_text: '改正' } } }); assert.equal(short.status, 200); assert.equal(short.json.accepted, true); assert.equal(submitted[0].subject_id, 'owner-1'); assert.equal(submitted[0].expected_world_revision, 4); assert.equal(submitted[0].schema_version, 1);
      const conflict = await call('/weftmate/memory/command.json', { command: { command_id: 'conflict', operation: 'retract_world_item', target_id: 'c1' } }); assert.equal(conflict.status, 409); assert.equal(conflict.json.accepted, false);
      const invalid = await call('/weftmate/memory/command.json', { command: { command_id: 'bad' } }); assert.equal(invalid.status, 400);
    } finally { if (oldEnabled === undefined) delete process.env.WEFTMATE_MEMOWEFT_ENABLED; else process.env.WEFTMATE_MEMOWEFT_ENABLED = oldEnabled; }
  });
  it('跨语言规范化与 Python 字节一致（中文 ensure_ascii 转义）', () => {
    const payload = {
      schema_version: 1, provider_name: 'memoweft', parent_session_id: 's1',
      result_session_id: 's1', mode: 'in_place',
      source_messages: [{ role: 'user', content: '我喜欢喝茉莉花茶', timestamp: 1786000000, source_ref: 'source:0' }],
    };
    const hash = createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
    assert.equal(hash, '30c45f75af3f218069ffb0d539e7947d361d405f21992e3ca32b9381a7f9f840');
    assert.match(canonicalJson(payload), /\\u559c\\u6b22/); // 茉莉花茶等非 ASCII 被 \u 转义
  });

  it('边界源：compaction/end 门控、user Evidence 组装、信封哈希与 event_id 绑定', () => {
    assert.match(plugin, /ctx\.on\('session\/event', \(session, event\) =>/);
    const boundary = between(plugin, "if (event.type === 'compaction/summary')", "// ── Recall 注入");
    assert.match(boundary, /if \(event\.type !== 'compaction\/end'\) return/);
    assert.match(boundary, /if \(event\.data\?\.error\) return/);
    assert.match(plugin, /fresh\.some\(\(message\) => message\.role === 'user'\)/);
    assert.match(plugin, /source_ref: `source:\$\{index\}`/);
    assert.match(plugin, /const payloadHash = sha256Hex\(canonicalJson\(payload\)\)/);
    assert.match(plugin, /`\$\{prefix\}:\$\{occurrence\}:\$\{payloadHash\}`/);
    assert.match(boundary, /mode: 'in_place'/);
    assert.match(plugin, /bridge\.request\('ingest_boundary', \{ boundary: item\.boundary \}\)/);
    assert.match(plugin, /Number\.isFinite\(eventTime\) && eventTime > 0/);
  });

  it('普通聊天交接：turn/end 独立信封、真实用户来源、持久重试与压缩去重', () => {
    assert.match(plugin, /TURN_BOUNDARY_PREFIX = 'weftmate-turn-boundary-v1'/);
    assert.match(plugin, /if \(event\.type === 'turn\/end'\)/);
    assert.match(plugin, /mode: 'turn'/);
    assert.match(plugin, /event\.data\?\.source\?\.kind !== 'user'/);
    assert.match(plugin, /event\.data\?\.message\?\.content/);
    assert.match(plugin, /HANDOFF_STATE_FILE/);
    assert.match(plugin, /delivered_refs/);
    assert.match(plugin, /queuedRefs\.has\(ref\)/);
    assert.match(plugin, /scheduleRetry\(\)/);
  });

  it('普通聊天行为：只交接真人文本，失败落盘后重启恢复且不重复', async () => {
    const { apply } = await importMemoryPlugin();
    const home = mkdtempSync(join(tmpdir(), 'weftmate-memory-'));
    const previousEnabled = process.env.WEFTMATE_MEMOWEFT_ENABLED;
    const previousHome = process.env.DSH_HOME;
    process.env.WEFTMATE_MEMOWEFT_ENABLED = '1';
    process.env.DSH_HOME = home;
    const capabilities = {
      protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1,
      methods: ['initialize', 'capabilities', 'ingest_boundary', 'prefetch', 'query_world', 'query_evidence', 'query_jobs', 'query_provenance', 'preview_recall', 'query_interactions', 'query_interaction', 'submit_command', 'portable_export', 'health', 'shutdown'],
    };
    const makeCtx = () => {
      const handlers = new Map<string, Function[]>();
      return {
        handlers,
        logger: { info() {} },
        get(name: string) { return name === 'credentials' ? { resolve: async () => undefined } : name === 'settings' ? { get: () => ({ providers: { local: { baseURL: 'http://127.0.0.1:8080/v1' } } }) } : undefined; },
        on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
        effect() {},
      };
    };
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 1500;
      while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(predicate(), 'timed out waiting for handoff');
    };
    try {
      const firstCtx = makeCtx();
      const failing = {
        child: {}, generation: 0, acceptCapabilities(value) { return value; }, close: async () => {},
        async request(method: string) {
          if (method === 'capabilities') return capabilities;
          if (method === 'initialize') return { capabilities };
          if (method === 'ingest_boundary') throw new Error('offline');
          return {};
        },
      };
      apply(firstCtx, { bridge: failing });
      const session = { header: { id: 's1' }, events: [
        { type: 'user/message', seq: 1, time: 1000, data: { id: 'user-message-1', source: { kind: 'user' }, content: [{ type: 'text', text: '真人原话' }] } },
        { type: 'user/message', seq: 2, time: 1001, data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '注入文字' }] } },
        { type: 'assistant/message', seq: 3, time: 1002, data: { message: { id: 'assistant-message-1', content: [{ type: 'reasoning', text: '隐藏思考' }, { type: 'text', text: 'AI回答' }] } } },
        { type: 'turn/end', seq: 4, data: { turn: 1 } },
      ] };
      firstCtx.handlers.get('session/event')?.[0](session, session.events[3]);
      const statePath = join(home, 'memoweft', 'weftmate-handoff-v1.json');
      await waitFor(() => { try { return JSON.parse(readFileSync(statePath, 'utf8')).pending.length === 1; } catch { return false; } });
      await firstCtx.handlers.get('dispose')?.[0]();

      const accepted: any[] = [];
      const secondCtx = makeCtx();
      const healthy = {
        child: {}, generation: 0, acceptCapabilities(value) { return value; }, close: async () => {},
        async request(method: string, params: any) {
          if (method === 'capabilities') return capabilities;
          if (method === 'initialize') return { capabilities };
          if (method === 'ingest_boundary') { accepted.push(params.boundary); return { job_state: 'queued', eligible: true }; }
          return {};
        },
      };
      apply(secondCtx, { bridge: healthy });
      await waitFor(() => accepted.length === 1);
      assert.deepEqual(accepted[0].source_messages.map((item) => [item.role, item.content]), [['user', '真人原话'], ['assistant', 'AI回答']]);
      assert.deepEqual(accepted[0].source_messages.map((item) => item.message_id), ['user-message-1', 'assistant-message-1']);
      assert.equal(JSON.stringify(accepted[0]).includes('隐藏思考'), false);
      secondCtx.handlers.get('session/event')?.[0](session, session.events[3]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(accepted.length, 1);
      await secondCtx.handlers.get('dispose')?.[0]();
    } finally {
      if (previousEnabled === undefined) delete process.env.WEFTMATE_MEMOWEFT_ENABLED; else process.env.WEFTMATE_MEMOWEFT_ENABLED = previousEnabled;
      if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('真实 Core RPC：capability、精确 history、启动对账、完整 capture 与 stale model 过滤往返', { skip: coreAvailable ? false : 'MemoWeft Core venv unavailable', timeout: 60_000 }, async () => {
    const { MemoWeftBridge, apply } = await importMemoryPlugin();
    const home = mkdtempSync(join(tmpdir(), 'weftmate-memory-actual-core-'));
    const oldEnabled = process.env.WEFTMATE_MEMOWEFT_ENABLED;
    const oldHome = process.env.DSH_HOME;
    const canonical = (value: any): string => {
      const sorted = (item: any): any => {
        if (item === null || typeof item !== 'object') return item;
        if (Array.isArray(item)) return item.map(sorted);
        return Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted(item[key])]));
      };
      return JSON.stringify(sorted(value)).replace(/[\u007f-\uffff]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
    };
    const makeBoundary = (sessionId: string, occurrence: number, messages: any[]) => {
      const payload = {
        schema_version: 1,
        provider_name: 'memoweft',
        parent_session_id: sessionId,
        result_session_id: sessionId,
        mode: 'turn',
        source_messages: messages.map((message, index) => ({ ...message, source_ref: `source:${index}` })),
      };
      const payloadHash = createHash('sha256').update(canonical(payload), 'utf8').digest('hex');
      return { ...payload, payload_hash: payloadHash, event_id: `weftmate-turn-boundary-v1:${occurrence.toString(16).padStart(32, '0')}:${payloadHash}` };
    };
    const initial = new MemoWeftBridge({ python: CORE_PYTHON, pythonPath: CORE_PYTHONPATH, requestTimeoutMs: 20_000 });
    const cleanup: Function[] = [];
    try {
      const capabilities = await initial.request('capabilities');
      initial.acceptCapabilities(capabilities);
      assert.equal(capabilities.interaction_dependency_projection, 1);
      assert.ok(capabilities.methods.includes('link_interaction_dependencies'));
      const initialized = await initial.request('initialize', { session_id: 'host-actual', dsh_home: home, auto_route: false, model_tier: 'local' });
      assert.equal(initialized.capabilities.interaction_dependency_projection, 1);

      const legacyBoundary = makeBoundary('legacy-actual', 1, [
        { role: 'user', content: '回顾矩阵规划。', message_id: 'legacy-user' },
        { role: 'assistant', content: '矩阵规划先采用旧版说明。', message_id: 'legacy-assistant' },
      ]);
      await initial.request('ingest_boundary', { boundary: legacyBoundary });

      const fullCapture = {
        schema_version: 1, capture_status: 'complete_empty', world_items: [], interaction_ids: [], world_revision: 0,
        recall_snapshot_token: 'world-zero', interaction_snapshot_token: 'interaction-zero',
        world_context_hash: 'world-hash-zero', interaction_context_hash: 'interaction-hash-zero', context_hash: 'combined-hash-zero',
      };
      const capturedBoundary = makeBoundary('capture-actual', 2, [
        { role: 'user', content: '回顾独立排期。', message_id: 'capture-user' },
        { role: 'assistant', content: '独立排期建议先做短评审。', message_id: 'capture-assistant', model_context_dependencies: fullCapture },
      ]);
      await initial.request('ingest_boundary', { boundary: capturedBoundary });
      const capturedHistory = await initial.request('query_interactions', { conversation_id: 'capture-actual', user_message_id: 'capture-user', projection: 'history' });
      assert.equal(capturedHistory.items.length, 1);
      assert.equal(capturedHistory.items[0].dependency_state, 'visible');
      const noChange = await initial.request('link_interaction_dependencies', {
        conversation_id: 'capture-actual', user_message_id: 'capture-user', assistant_message_id: 'capture-assistant',
        expected_context_hash: capturedHistory.items[0].context_hash, model_context_dependencies: fullCapture,
      });
      assert.equal(noChange.result_state, 'no_change', 'full inline metadata survived Core boundary ingestion exactly');
      await initial.close();

      const statePath = join(home, 'memoweft', 'weftmate-handoff-v1.json');
      writeFileSync(statePath, `${JSON.stringify({
        schema_version: 1,
        pending: [],
        delivered_refs: ['legacy-actual:1', 'legacy-actual:2'],
        recall_adoptions: [
          { session_id: 'legacy-actual', user_message_id: 'legacy-user', user_seq: 7, selected_item_ids: [['cognition', 'missing-world-a']], interaction_ids: [], recall_snapshot_token: 'legacy-world-token', context_hash: 'step-a', adopted_at: '2026-09-20T01:02:03.000Z' },
          { session_id: 'legacy-actual', user_message_id: 'legacy-user', user_seq: 7, selected_item_ids: [], interaction_ids: [capturedHistory.items[0].id], interaction_context_hash: 'legacy-interaction-hash', context_hash: 'step-b', adopted_at: '2026-09-20T01:02:04.000Z' },
          { session_id: 'invalid-legacy', user_message_id: 'invalid-user', selected_item_ids: [], interaction_ids: [], context_hash: 'invalid-step', adopted_at: '2026-09-20T01:02:05.000Z' },
        ],
      })}\n`, 'utf8');

      process.env.WEFTMATE_MEMOWEFT_ENABLED = '1';
      process.env.DSH_HOME = home;
      const live = new MemoWeftBridge({ python: CORE_PYTHON, pythonPath: CORE_PYTHONPATH, requestTimeoutMs: 20_000 });
      const calls: any[] = [];
      const request = live.request.bind(live);
      live.request = async (method: string, params: any = {}, options: any = {}) => { calls.push({ method, params }); return request(method, params, options); };
      const handlers = new Map<string, Function[]>();
      const ctx: any = {
        logger: { info() {} },
        get(name: string) {
          if (name === 'credentials') return { resolve: async () => undefined };
          if (name === 'settings') return { get: () => ({ providers: { local: { baseURL: 'http://127.0.0.1:8080/v1' } } }) };
          if (name === 'tools') return { register() {} };
          return undefined;
        },
        on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
        effect(run: Function) { const disposer = run(); if (typeof disposer === 'function') cleanup.push(disposer); },
      };
      apply(ctx, { bridge: live, createUserMessage: (value: any) => value });
      const deadline = Date.now() + 20_000;
      let linkedState: any;
      while (Date.now() < deadline) {
        linkedState = JSON.parse(readFileSync(statePath, 'utf8'));
        if (linkedState.recall_adoptions.slice(0, 2).every(item => item.link_state === 'linked') && linkedState.recall_adoptions[2]?.link_state === 'unresolved') break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(linkedState.recall_adoptions.slice(0, 2).every(item => item.link_state === 'linked'), JSON.stringify(linkedState));
      assert.equal(new Set(linkedState.recall_adoptions.slice(0, 2).map(item => item.interaction_id)).size, 1);
      assert.equal(linkedState.recall_adoptions[0].capture_status, 'complete');
      assert.equal(linkedState.recall_adoptions[1].capture_status, 'complete');
      assert.equal(linkedState.recall_adoptions[0].context_hash, 'step-a');
      assert.equal(linkedState.recall_adoptions[0].adopted_at, '2026-09-20T01:02:03.000Z');
      assert.equal(typeof linkedState.recall_adoptions[0].linked_context_hash, 'string');
      assert.equal(linkedState.recall_adoptions[2].capture_status, 'unavailable');
      assert.equal(linkedState.recall_adoptions[2].link_state, 'unresolved');
      assert.equal(linkedState.recall_adoptions[2].context_hash, 'invalid-step');
      assert.equal(calls.some(call => call.method === 'initialize'), true);
      assert.equal(calls.some(call => call.method === 'query_interactions' && call.params.projection === 'history' && call.params.conversation_id === 'legacy-actual' && call.params.user_message_id === 'legacy-user'), true);
      const linkCall = calls.find(call => call.method === 'link_interaction_dependencies');
      assert.deepEqual(linkCall.params.model_context_dependencies.world_items, [
        { object_kind: 'cognition', item_id: 'missing-world-a' },
      ]);
      assert.deepEqual(linkCall.params.model_context_dependencies.interaction_ids, [capturedHistory.items[0].id]);
      assert.equal(calls.some(call => call.method === 'ingest_boundary'), false, 'metadata reconciliation never resends an already accepted boundary or Evidence');
      for (const dispose of cleanup.reverse()) await dispose();
      cleanup.length = 0;

      const verify = new MemoWeftBridge({ python: CORE_PYTHON, pythonPath: CORE_PYTHONPATH, requestTimeoutMs: 20_000 });
      await verify.request('initialize', { session_id: 'verify-actual', dsh_home: home, auto_route: false, model_tier: 'local' });
      const history = await verify.request('query_interactions', { conversation_id: 'legacy-actual', user_message_id: 'legacy-user', projection: 'history' });
      assert.equal(history.items[0].turns[1].content, '矩阵规划先采用旧版说明。');
      assert.equal(history.items[0].dependency_state, 'missing');
      const model = await verify.request('query_interactions', { query: '回忆之前的矩阵规划', session_id: 'fresh', projection: 'model' });
      assert.equal(model.count, 0, 'history remains readable while stale/missing dependencies remove the AI text from model projection');
      await verify.close();
    } finally {
      for (const dispose of cleanup.reverse()) { try { await dispose(); } catch { /* cleanup best effort */ } }
      await initial.close().catch(() => {});
      if (oldEnabled === undefined) delete process.env.WEFTMATE_MEMOWEFT_ENABLED; else process.env.WEFTMATE_MEMOWEFT_ENABLED = oldEnabled;
      if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('桥传输：env 注入 python/PYTHONPATH、stdio JSON-Lines、fail-closed', () => {
    assert.match(plugin, /export const inject = \['webServer', 'credentials', 'settings'\]/);
    assert.match(plugin, /WEFTMATE_MEMOWEFT_PYTHON \|\| 'python'/);
    assert.match(plugin, /PYTHONPATH: this\.pythonPath/);
    assert.match(plugin, /spawn\(this\.python, \['-m', 'memoweft\.integrations\.dsh_bridge'\]/);
    assert.match(plugin, /this\.child\.stdin\.write\(line, 'utf8'\)/);
    assert.match(plugin, /failAll/);
    // 初始化 dsh_home 走运行时 DSH_HOME（产品数据目录内）。
    assert.match(plugin, /dsh_home: DSH_HOME\(\)/);
    assert.match(plugin, /credentials\.resolve\(credentialRef\(authRef\)\)/);
    assert.match(plugin, /model_tier: process\.env\.WEFTMATE_MEMOWEFT_MODEL_TIER \|\| 'local'/);
  });

  it('Recall 注入门：真实当前用户、revision 感知 snapshot、plugin 名可核验（0 生成调用）', () => {
    const recall = between(plugin, "ctx.on('agent/pre-step'", '}, { prepend: true })');
    assert.ok(recall.indexOf('const decision = await next()') < recall.indexOf('bridge.request'));
    assert.match(recall, /RECALL_QUERY_MAX_CHARS/);
    assert.match(recall, /payload\?\.messages/);
    assert.match(recall, /message\?\.source\?\.kind === 'user'/);
    assert.match(recall, /latestUserBySessionId\.get\(sessionId\)/);
    assert.match(recall, /bridge\.request\('preview_recall', \{ query \}\)/);
    assert.match(recall, /worldResult\.value\?\.world_revision/);
    assert.match(recall, /selected_item_ids/);
    assert.match(recall, /RECALL_CLEARED/);
    assert.match(recall, /MEMORY_HOST_BEHAVIOR/);
    assert.match(plugin, /用户原话会自动提交给本地记忆后台处理/);
    assert.match(plugin, /以真实记忆面板或命令回执为准/);
    assert.match(plugin, /不要因为本轮未调用工具就声称记忆无法更新/);
    assert.match(plugin, /不要提前声称已经持久化完成/);
    assert.match(recall, /plugin: 'weftmate-memory'/);
    assert.match(recall, /form: 'snapshot'/);
  });

  it('Recall 行为：同问跨会话和新用户序号重新查询，无命中清空旧 snapshot', async () => {
    const { apply } = await importMemoryPlugin();
    const home = mkdtempSync(join(tmpdir(), 'weftmate-recall-'));
    const oldEnabled = process.env.WEFTMATE_MEMOWEFT_ENABLED;
    const oldHome = process.env.DSH_HOME;
    process.env.WEFTMATE_MEMOWEFT_ENABLED = '1';
    process.env.DSH_HOME = home;
    const handlers = new Map<string, Function[]>();
    const ctx = {
      logger: { info() {} }, effect() {},
      get(name: string) { return name === 'credentials' ? { resolve: async () => undefined } : name === 'settings' ? { get: () => ({ providers: { local: { baseURL: 'http://127.0.0.1:8080/v1' } } }) } : undefined; },
      on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    };
    const queries: string[] = [];
    const previews = [
      { world_revision: 1, preview: { rendered_recall: '记忆A', selected_item_ids: [['cognition', 'c1']], recall_snapshot_token: 't1' } },
      { world_revision: 1, preview: { rendered_recall: '记忆A', selected_item_ids: [['cognition', 'c1']], recall_snapshot_token: 't1' } },
      { world_revision: 1, preview: { rendered_recall: '记忆A', selected_item_ids: [['cognition', 'c1']], recall_snapshot_token: 't1' } },
      { world_revision: 1, preview: { rendered_recall: '记忆A', selected_item_ids: [['cognition', 'c1']], recall_snapshot_token: 't1' } },
      { world_revision: 2, preview: { rendered_recall: '', selected_item_ids: [], recall_snapshot_token: 't2' } },
      { world_revision: 3, preview: { rendered_recall: '', selected_item_ids: [], recall_snapshot_token: 't3' } },
      new Error('world unavailable'),
      { world_revision: 4, preview: { rendered_recall: '', selected_item_ids: [], recall_snapshot_token: 't4' } },
    ];
    const capabilities = { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, interaction_dependency_projection: 1, permissions: { allow_inference: true, allow_cloud_read: false },
      methods: ['initialize', 'capabilities', 'ingest_boundary', 'prefetch', 'query_world', 'query_evidence', 'query_jobs', 'query_provenance', 'preview_recall', 'query_interactions', 'query_interaction', 'link_interaction_dependencies', 'submit_command', 'portable_export', 'health', 'shutdown'] };
    const bridge = { child: {}, generation: 0, acceptCapabilities(v) { return v; }, close: async () => {}, async request(method: string, params: any) {
      if (method === 'capabilities') return capabilities;
      if (method === 'initialize') return { capabilities };
      if (method === 'preview_recall') {
        queries.push(params.query);
        const result = previews.shift();
        if (result instanceof Error) throw result;
        return result;
      }
      if (method === 'query_interactions') {
        const call = queries.length;
        if (call === 8) throw new Error('interactions unavailable');
        return call === 6
          ? { items: [{ id: 'interaction-1' }], rendered_context: '用户曾问健康案例，AI建议先记录一周再决定；用户当时说以后再看。', count: 1, snapshot_token: 'i1' }
          : { items: [], rendered_context: '', count: 0, snapshot_token: 'i-empty' };
      }
      return {};
    } };
    const createUserMessage = (value) => value;
    try {
      apply(ctx, { bridge, createUserMessage });
      const sessionA: any = { header: { id: 'a' }, events: [{ type: 'turn/start', seq: 1, data: { turn: 1 } }] };
      const sessionB: any = { header: { id: 'b' }, events: [{ type: 'turn/start', seq: 1, data: { turn: 1 } }] };
      const agentA = { session: sessionA };
      const agentB = { session: sessionB };
      for (const agent of [agentA, agentB]) agent.options = { provider: 'local', model: 'test' };
      const directUser = (id) => ({ id, source: { kind: 'user' }, content: [{ type: 'text', text: '同一句问题' }] });
      const emitUser = (session, seq, id) => {
        const event = { type: 'user/message', seq, data: directUser(id) };
        session.events.push(event);
        handlers.get('session/event')?.[0](session, event);
      };
      const step = (agent, turn, stepNumber, messages = []) => handlers.get('agent/pre-step')?.[0]({ agent, messages, turn, step: stepNumber }, async () => ({ kind: 'enter', messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'AI污染' }] },
        { source: { kind: 'plugin' }, content: [{ type: 'text', text: '插件污染' }] },
      ] }));
      // 固定 DSH 时序：turn/start -> pre-step(payload.messages 已领取) -> user/message append。
      const first = await step(agentA, 1, 1, [directUser('m-a1')]);
      emitUser(sessionA, 2, 'm-a1');
      await step(agentA, 1, 2); // 工具后的同轮 step 明确无新输入，回退同 turn cache。
      sessionA.events.push({ type: 'turn/start', seq: 3, data: { turn: 2 } });
      await step(agentA, 2, 1, [directUser('m-a2')]);
      await step(agentB, 1, 1, [directUser('m-b1')]);
      sessionA.events.push({ type: 'turn/start', seq: 4, data: { turn: 3 } });
      const cleared = await step(agentA, 3, 1, [directUser('m-a3')]);
      sessionB.events.push({ type: 'turn/start', seq: 2, data: { turn: 2 } });
      const historyOnly = await step(agentB, 2, 1, [directUser('m-b2')]);
      sessionA.events.push({ type: 'turn/start', seq: 5, data: { turn: 4 } });
      const failedWorld = await step(agentA, 4, 1, [directUser('m-a4')]);
      sessionB.events.push({ type: 'turn/start', seq: 3, data: { turn: 3 } });
      const failedHistory = await step(agentB, 3, 1, [directUser('m-b3')]);
      assert.deepEqual(queries, Array(8).fill('同一句问题'));
      assert.match(first.messages.at(-1).content[0].text, /^记忆A/);
      assert.match(first.messages.at(-1).content[0].text, /WeftMate 宿主行为/);
      assert.match(first.messages.at(-1).content[0].text, /不要提前声称已经持久化完成/);
      assert.equal(first.messages.at(-1).source.kind, 'plugin');
      assert.equal(first.messages.at(-1).source.sections[0].text, '记忆A');
      assert.match(cleared.messages.at(-1).content[0].text, /Earlier formal World sections/);
      assert.match(cleared.messages.at(-1).content[0].text, /用户原话会自动提交给本地记忆后台处理/);
      assert.equal(cleared.messages.at(-1).source.form, undefined);
      assert.equal(cleared.messages.at(-1).source.kind, 'plugin');
      assert.match(historyOnly.messages.at(-1).content[0].text, /用户曾问健康案例/);
      assert.match(historyOnly.messages.at(-1).content[0].text, /历史讨论记录，仅供延续共同经历/);
      assert.match(historyOnly.messages.at(-1).content[0].text, /不代表用户已经授权实施/);
      assert.equal(historyOnly.messages.at(-1).source.sections.some((section) => section.name === 'weftmate-memory-interactions'), true);
      assert.match(failedWorld.messages.at(-1).content[0].text, /formal World memory could not be read/);
      assert.equal(failedWorld.messages.at(-1).content[0].text.includes('记忆A'), false);
      assert.match(failedHistory.messages.at(-1).content[0].text, /shared interactions could not be read/);
      assert.equal(failedHistory.messages.at(-1).content[0].text.includes('用户曾问健康案例'), false);
      const state = JSON.parse(readFileSync(join(home, 'memoweft', 'weftmate-handoff-v1.json'), 'utf8'));
      assert.equal(state.recall_adoptions.length, 7, 'every actual pre-step records an auditable dependency capture, including empty/error results');
      assert.equal(state.recall_adoptions.some(item => item.capture_status === 'complete_empty'), true, 'a successful zero-hit lookup is recorded as complete_empty');
      assert.equal(state.recall_adoptions.some(item => item.capture_status === 'unavailable'), true, 'a partial/failed lookup is recorded as unavailable instead of a false empty capture');
      const interactionAdoption = state.recall_adoptions.find((item) => Array.isArray(item.interaction_ids) && item.interaction_ids.includes('interaction-1'));
      assert.deepEqual(interactionAdoption.interaction_ids, ['interaction-1']);
      assert.equal(typeof interactionAdoption.interaction_context_hash, 'string');
      assert.equal(JSON.stringify(state.recall_adoptions).includes('同一句问题'), false);
      assert.equal(JSON.stringify(state.recall_adoptions).includes('记忆A'), false);
    } finally {
      if (oldEnabled === undefined) delete process.env.WEFTMATE_MEMOWEFT_ENABLED; else process.env.WEFTMATE_MEMOWEFT_ENABLED = oldEnabled;
      if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('管理面：world/search/export 只读路由注册', () => {
    assert.match(plugin, /pathname === '\/weftmate\/memory\/world\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/search\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/export\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/evidence\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/jobs\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/recall-preview\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/provenance\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/adoptions\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/interactions\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/command\.json'/);
    assert.match(plugin, /requestIsSameLoopbackOrigin\(req\)/);
    assert.match(plugin, /bridge\.request\('list_world'|bridge\.request\('export_world'|bridge\.request\('prefetch'/);
    assert.match(plugin, /kind: 'prefix', path: '\/weftmate\/memory'/);
  });

  it('纠正写入口只接受精确同源 loopback Origin', async () => {
    const { requestIsSameLoopbackOrigin } = await importMemoryPlugin();
    assert.equal(requestIsSameLoopbackOrigin({ headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310' } }), true);
    assert.equal(requestIsSameLoopbackOrigin({ headers: { host: '[::1]:4310', origin: 'http://[::1]:4310' } }), true);
    assert.equal(requestIsSameLoopbackOrigin({ headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4311' } }), false);
    assert.equal(requestIsSameLoopbackOrigin({ headers: { host: 'localhost:4310', origin: 'http://localhost:4310' } }), false);
    assert.equal(requestIsSameLoopbackOrigin({ headers: { host: 'evil.example', origin: 'http://evil.example' } }), false);
    assert.equal(requestIsSameLoopbackOrigin({ headers: { host: '127.0.0.1:4310' } }), false);
  });

  it('recall_memory uses the real registered tool, fails closed for an unknown/cloud raw route, and reports bridge partial failure', async () => {
    const { apply } = await importMemoryPlugin();
    const oldEnabled = process.env.WEFTMATE_MEMOWEFT_ENABLED;
    const oldHome = process.env.DSH_HOME;
    const home = mkdtempSync(join(tmpdir(), 'weftmate-tool-capture-'));
    process.env.WEFTMATE_MEMOWEFT_ENABLED = '1';
    process.env.DSH_HOME = home;
    const registered = new Map<string, any>(); const handlers = new Map<string, Function[]>(); const calls: string[] = [];
    const capabilities = { permissions: { allow_inference: true, allow_cloud_read: false } };
    const bridge: any = { child: {}, generation: 0, capabilities, acceptCapabilities(value) { this.capabilities = value; }, close: async () => {}, async request(method: string) {
      calls.push(method); if (method === 'capabilities') return capabilities; if (method === 'initialize') return { capabilities };
      if (method === 'preview_recall') return { preview: { rendered_recall: '用户偏好简洁回答', selected_item_ids: [['cognition', 'c1']] } };
      throw new Error('bridge unavailable');
    } };
    const tools = { register(tool) { registered.set(tool.name, tool); } };
    const ctx: any = { logger: { info() {} }, get(name) { return name === 'tools' ? tools : name === 'credentials' ? { resolve: async () => undefined } : name === 'settings' ? { get: () => ({ providers: { local: { baseURL: 'http://127.0.0.1:8080/v1' } } }) } : undefined; }, on(name, fn) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); }, effect() {} };
    try {
      apply(ctx, { bridge }); const tool = registered.get('recall_memory'); assert.ok(tool, 'the plugin registers the real recall tool');
      const cloud = await tool.execute({ query: '偏好', level: 'all' }, { agent: { session: { id: 'cloud', requestHeader() { return { config: { provider: 'cloud', model: 'test' } }; } } } });
      assert.equal(cloud.status, 'failed'); assert.deepEqual(cloud.evidence, []); assert.equal(cloud.sources[0].status, 'withheld'); assert.equal(calls.includes('query_provenance'), false);
      bridge.capabilities = { permissions: { allow_inference: true, allow_cloud_read: true } };
      const partial = await tool.execute({ query: '偏好', level: 'all' }, { agent: { session: { id: 'local', requestHeader() { return { config: { provider: 'local', model: 'test' } }; } } } });
      assert.equal(partial.status, 'partial'); assert.equal(partial.ok, false); assert.equal(partial.count, 1); assert.ok(partial.errors.length > 0, 'a bridge source failure is not rewritten as zero matches');
      bridge.request = async (method: string) => {
        if (method === 'preview_recall') return { world_revision: 9, preview: { rendered_recall: '用户偏好简洁回答', selected_item_ids: [['cognition', 'c1']], recall_snapshot_token: 'world-token' } };
        if (method === 'query_provenance') return { provenance: [{ evidence_id: 'e1', currentness_state: 'current', model_content_available: true, linked_world_items: [{ object_kind: 'cognition', item_id: 'c1' }, { object_kind: 'cognition', item_id: 'c2' }], permissions: { allow_inference: true, allow_local_read: true }, evidence: { currentness_state: 'current', content_available: true, raw_content: '原话', permissions: { allow_inference: true, allow_local_read: true } } }] };
        if (method === 'query_interactions') return { items: [{ id: 'interaction-1' }], rendered_context: '历史讨论', snapshot_token: 'interaction-token', commitments: [] };
        return {};
      };
      const session: any = { id: 'local', header: { id: 'local' }, events: [] };
      const userEvent = { type: 'user/message', seq: 8, data: { id: 'tool-user', source: { kind: 'user' }, content: [{ type: 'text', text: '请查过去偏好' }] } };
      session.events.push(userEvent); handlers.get('session/event')?.[0](session, userEvent);
      const success = await tool.execute({ query: '偏好', level: 'all' }, { agent: { session: Object.assign(session, { requestHeader() { return { config: { provider: 'local', model: 'test' } } } }) } });
      assert.equal(success.status, 'success');
      const stored = JSON.parse(readFileSync(join(home, 'memoweft', 'weftmate-handoff-v1.json'), 'utf8'));
      const capture = stored.recall_adoptions.find(item => item.capture_source === 'recall_memory');
      assert.deepEqual(capture.selected_item_ids, [['cognition', 'c1'], ['cognition', 'c2']]);
      assert.deepEqual(capture.interaction_ids, ['interaction-1']);
      assert.equal(capture.capture_status, 'complete');
    } finally {
      if (oldEnabled === undefined) delete process.env.WEFTMATE_MEMOWEFT_ENABLED; else process.env.WEFTMATE_MEMOWEFT_ENABLED = oldEnabled;
      if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('recall_memory compiles through the real vendor ToolRuntime with required query and canonical output', async () => {
    const repository = fileURLToPath(new URL('../', import.meta.url));
    const vendor = (name: string) => pathToFileURL(join(repository, 'vendor', 'dsh-runtime', 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')).href;
    const [{ Context }, { default: SystemPrompt }, { default: Sessions }, toolsModule] = await Promise.all([import(vendor('cordis')), import(vendor('dsh-system-prompt')), import(vendor('dsh-session')), import(vendor('dsh-tools'))]);
    const ctx: any = new Context();
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' });
    await ctx.plugin(Sessions);
    await ctx.plugin(toolsModule.default, { mode: 'native', maxParallelSubCalls: 1 });
    const oldEnabled = process.env.WEFTMATE_MEMOWEFT_ENABLED;
    process.env.WEFTMATE_MEMOWEFT_ENABLED = '1';
    const bridge: any = { child: {}, generation: 0, capabilities: {}, acceptCapabilities(value) { this.capabilities = value }, close: async () => {}, request: async method => method === 'capabilities' ? { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods: ['initialize', 'capabilities', 'ingest_boundary', 'prefetch', 'query_world', 'query_evidence', 'query_jobs', 'query_provenance', 'preview_recall', 'query_interactions', 'query_interaction', 'submit_command', 'portable_export', 'health', 'shutdown'] } : method === 'initialize' ? { capabilities: {} } : {} };
    try {
      const { apply } = await importMemoryPlugin();
      apply(ctx, { bridge });
      const toolService = ctx.tools;
      const schema = toolService.schemas().find((item: any) => item.name === 'recall_memory');
      assert.ok(schema);
      assert.deepEqual(schema.parameters.required, ['query']);
      assert.deepEqual(schema.parameters.properties.level.enum, ['cognition', 'evidence', 'all']);
      const agent: any = { id: 'tool-agent', session: { id: 'tool-session' }, ctx, options: {} };
      const invalid = await toolService.execute({ name: 'recall_memory', arguments: {}, agent, callId: 'invalid', signal: new AbortController().signal });
      assert.equal(invalid.isError, true, 'missing query is rejected before plugin execute');
      const valid = await toolService.execute({ name: 'recall_memory', arguments: { query: '过去偏好', level: 'all' }, agent, callId: 'valid', signal: new AbortController().signal });
      assert.equal(valid.isError, false);
      assert.deepEqual(JSON.parse(JSON.stringify(valid.value)), valid.value, 'canonical output is lossless JSON');
      const definition = toolService.get('recall_memory');
      assert.equal(Array.isArray(definition.output.render({ query: '过去偏好' }, valid.value)), true);
    } finally {
      await ctx.fiber.dispose();
      if (oldEnabled === undefined) delete process.env.WEFTMATE_MEMOWEFT_ENABLED; else process.env.WEFTMATE_MEMOWEFT_ENABLED = oldEnabled;
    }
  });

  it('dependency capture fails closed when malformed or merged references exceed 64', () => {
    const source = plugin.slice(plugin.indexOf('function normalizeModelContextDependencies('), plugin.indexOf('export const MEMOWEFT_RPC_PROTOCOL')) + '\nreturn ({ normalizeModelContextDependencies, mergeModelContextDependencies })';
    const helpers = Function(source)();
    const tooMany = { schema_version: 1, capture_status: 'complete', world_items: Array.from({ length: 65 }, (_, index) => ({ object_kind: 'cognition', item_id: `c-${index}` })), interaction_ids: [] };
    assert.equal(helpers.normalizeModelContextDependencies(tooMany).capture_status, 'unavailable');
    assert.equal(helpers.normalizeModelContextDependencies({ ...tooMany, world_items: [{ object_kind: 'wrong', item_id: 'x' }] }).capture_status, 'unavailable');
    const first = { schema_version: 1, capture_status: 'complete', world_items: [], interaction_ids: Array.from({ length: 40 }, (_, index) => `i-${index}`) };
    const second = { schema_version: 1, capture_status: 'complete', world_items: [], interaction_ids: Array.from({ length: 40 }, (_, index) => `i-${index + 40}`) };
    const merged = helpers.mergeModelContextDependencies(first, second);
    assert.equal(merged.capture_status, 'unavailable'); assert.deepEqual(merged.interaction_ids, []);
  });

  it('profile 接线：补丁层保留试验行、默认关闭、资产复制、main 不注入开发机绝对路径', () => {
    assert.match(runtime, /- id: weftmate-memory\s*\n\s*name: \.\/plugins\/weftmate-memory\.mjs/);
    assert.match(runtime, /PROFILE_PATCH_TEMPLATE_R3_PICKER/);
    const upgrade = between(runtime, 'if (existing === PROFILE_PATCH_TEMPLATE) return false', 'return false // owner 手改');
    assert.match(upgrade, /PROFILE_PATCH_TEMPLATE_R3_PICKER/);
    assert.match(runtime, /\[join\(PLUGINS_DIR, 'weftmate-memory\.mjs'\), memoryDest\]/);
    assert.match(plugin, /process\.env\.WEFTMATE_MEMOWEFT_ENABLED !== '1'/);
    assert.ok(plugin.indexOf("WEFTMATE_MEMOWEFT_ENABLED !== '1'") < plugin.indexOf('new MemoWeftBridge'));
    assert.match(main, /WEFTMATE_MEMOWEFT_ENABLED: process\.env\.WEFTMATE_MEMOWEFT_ENABLED === '1' \? '1' : '0'/);
    assert.doesNotMatch(main, /D:\\\\MemoWeft\\\\\.venv-memoweft/);
  });

  it('管理页统一进入 Weave 记忆导航，不再注册旧胶囊或弹窗入口', () => {
    assert.doesNotMatch(client, /id: 'weftmate-memory'/);
    assert.doesNotMatch(client, /function MemoryBadge\(|React\.createElement\(MemoryPanel/);
    assert.match(client, /function V2MemoryWorkspace\(props\)/);
    assert.match(client, /function deriveMemoryUiSummary\(host, health, world, jobs, phase\)/);
    assert.match(client, /onClick: function \(\) \{ choose\('memory'\) \}/);
    assert.match(client, /\/weftmate\/memory\/search\.json\?q=' \+ encodeURIComponent/);
    assert.match(client, /没有命中的记忆（未找到）/);
    assert.match(client, /fetch\('\/weftmate\/memory\/export\.json'/);
    assert.match(client, /a\.download = 'weftmate-memory-export\.json'/);
    assert.match(client, /'修改'/);
    assert.match(client, /'来源依据'/);
    assert.match(client, /'停用'/);
  });
});
