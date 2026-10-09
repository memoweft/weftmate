/** Capture actual pinned DSH requests using a synthetic account and random loopback ports. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { getEncoding } from 'js-tiktoken';
const sourceRoot = process.env.PF1_SOURCE_ROOT ?? process.cwd();
const { DshWebRuntime } = await import(pathToFileURL(join(sourceRoot, 'src/dsh-web-runtime.ts')));
const { createPersonalMemoryManager } = await import(pathToFileURL(join(sourceRoot, 'src/personal-memory/index.mjs')));
import { routeForProfile, writeModelRoutesPatch } from '../../src/harness-model-routes.ts';

const root = await mkdtemp(join(tmpdir(), 'weftmate-pf1-'));
const requests = [];
const timings = [];
let turnStarted = 0;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', async () => {
    if (!req.url?.endsWith('/chat/completions')) return res.writeHead(404).end();
    const requestBody = JSON.parse(raw);
    if (requestBody.tools?.length) requests.push(requestBody);
    if (process.env.PF1_LAN === '1') {
      const started = performance.now();
      try {
        const upstream = await fetch(`${process.env.WEFTMATE_LAN_MODEL_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST', headers: { authorization: `Bearer ${process.env.WEFTMATE_LAN_MODEL_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ...requestBody, model: 'local-quality', max_tokens: 1500, stream_options: { include_usage: true } }), signal: AbortSignal.timeout(240_000) });
        if (!upstream.ok) throw new Error(`LAN status ${upstream.status}`);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        let pending = '', firstTextMs = null, firstDeltaMs = null, text = '', tools = [], usage;
        for await (const chunk of upstream.body) {
          res.write(chunk); pending += new TextDecoder().decode(chunk);
          const blocks = pending.split('\n\n'); pending = blocks.pop() ?? '';
          for (const block of blocks) for (const line of block.split('\n')) {
            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
            const frame = JSON.parse(line.slice(6)); usage = frame.usage ?? usage;
            const delta = frame.choices?.[0]?.delta;
            if (delta?.content || delta?.reasoning_content || delta?.tool_calls) firstDeltaMs ??= performance.now() - started;
            if (delta?.content) { firstTextMs ??= performance.now() - started; text += delta.content; }
            for (const tool of delta?.tool_calls ?? []) if (tool.function?.name) tools.push(tool.function.name);
          }
        }
        timings.push({ foreground: requests.some(body => body.messages?.some(m => typeof m.content === 'string' && m.content === (process.env.PF1_INPUT ?? '你好'))) &&
          JSON.parse(raw).messages?.some(m => typeof m.content === 'string' && m.content === (process.env.PF1_INPUT ?? '你好')),
          firstTextMs, firstDeltaMs, turnFirstTextMs: firstTextMs === null ? null : started - turnStarted + firstTextMs,
          turnFirstDeltaMs: firstDeltaMs === null ? null : started - turnStarted + firstDeltaMs,
          totalMs: performance.now() - started, text, tools, usage });
        res.end();
      } catch (error) { res.writeHead(502).end(); console.log(error.message); }
      return;
    }
    if (process.env.PF1_SCRIPTED_TASK === '1' && requestBody.tools?.length) {
      const body = requestBody;
      const finished = body.messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes('PF1_SYNTHETIC_OK'));
      const name = body.tools.some(t => t.function.name === 'read') ? 'read' : 'load_tools';
      const delta = finished ? { content: 'PF1_SYNTHETIC_OK' } : { tool_calls: [{ index: 0, id: `synthetic-call-${requests.length}`,
        type: 'function', function: { name, arguments: JSON.stringify(name === 'read' ? { file_path: 'pf1-input.txt' } : { names: ['read'] }) } }] };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ id: 'synthetic', choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'synthetic', choices: [{ index: 0, delta: {}, finish_reason: finished ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'synthetic', choices: [{ index: 0, delta: { content: '你好！' }, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ id: 'synthetic', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const home = join(root, 'home');
const patch = join(home, 'routes.yml');
writeModelRoutesPatch(patch, [{ id: 'pf1-synthetic', name: 'Synthetic', provider: 'openai-compatible',
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'synthetic' }]);
const security = join(home, 'credentials.yml');
await writeFile(security, '- id: credentials\n  disabled: true\n- id: weftmate-credentials\n  disabled: true\n- insert:\n    - id: weftmate-safe-credentials\n      name: ./plugins/weftmate-credentials.mjs\n');
await writeFile(join(home, 'debug.mjs'), "export default ctx => { ctx.on('session/event', (s,e) => { if(e.type === 'turn/end') console.log('PF1-END', JSON.stringify(e.data)); }, {global:true}); ctx.on('system-prompt/assemble', async(a,c,next) => { const result=await next(); console.log('PF1-ASSEMBLY', JSON.stringify(result)); return result; }, {global:true}); };\n");
const debug = join(home, 'debug.yml');
 await writeFile(debug, '- insert:\n    - name: ../../debug.mjs\n');
process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED = '1';
const logs = [];
await mkdir(join(root, 'workspace'), { recursive: true });
await writeFile(join(root, 'workspace', 'pf1-input.txt'), 'PF1_SYNTHETIC_OK');
const owner = 'owner-00000000-0000-4000-8000-000000000001';
const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall',
  'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
const manager = createPersonalMemoryManager({ root: join(root, 'account-memory'), enabled: true,
  python: join(root, 'python.exe'), pythonPath: join(root, 'py'), baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
  model: '@current', credential: () => 'synthetic', rpcFactory: () => ({ child: {}, async close() {}, async request(method, params = {}) {
    if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods };
    if (method === 'initialize') return { runtime: { subject_id: owner, db_path: join(params.dsh_home, 'memoweft/memoweft.sqlite3') },
      capabilities: { subject_id: owner, methods, services: { command: { operations: [] } } } };
    if (method === 'health') return { runtime: { subject_id: owner, route_ready: true } };
    if (method === 'preview_recall') return { world_revision: 1, preview: {
      selected_item_ids: Array.from({ length: 40 }, (_, i) => ['cognition', `synthetic-${i}`]),
      rendered_recall: Array.from({ length: 40 }, (_, i) => `记忆：合成用户的项目${i}偏好：周末整理笔记，使用简洁中文解释，喜欢散步和阅读。`).join('\n') } };
    if (method === 'query_interactions') return { rendered_context: '' };
    return {};
  } }) });
const runtime = new DshWebRuntime({ homeDir: home, workspaceDir: join(root, 'workspace'),
  runtimePath: join(process.cwd(), 'vendor', 'dsh-runtime'), patchFiles: [patch, security, debug],
  credentialRequestHandler: async ({ operation }) => operation === 'resolve' ? { value: 'synthetic-only' } : { configured: true },
  personalDesktopRequestHandler: async request => request.action === 'approval_policy'
    ? { mode: 'auto', allowedCategories: [] }
    : { executionId: request.executionId ?? `exec-${'a'.repeat(48)}`, taskId: `cmd-${'b'.repeat(8)}-0000-4000-8000-000000000001`, state: request.state ?? 'running' },
  personalConversationContextHandler: async () => ({ state: 'none' }),
  personalScheduleHandler: async () => ({ timeZone: 'Asia/Shanghai', schedules: [] }),
  personalMemoryRequestHandler: async ({ action, query, sessionId }) => action === 'recall'
    ? manager.recall(owner, { query, sessionId }) : { state: 'accepted' },
  log: line => { if (!line.includes('PF1-ASSEMBLY')) logs.push(line);
    else if (process.env.PF1_ASSEMBLY_FILE) { const value = line.slice(line.indexOf('PF1-ASSEMBLY') + 13).trim(); writeFile(process.env.PF1_ASSEMBLY_FILE, value); } },
});
let controller;
try {
  const origin = await runtime.start();
  const api = async (path, method = 'GET', body) => {
    const res = await fetch(`${origin}/weftmate/api/v1${path}`, { method,
      headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const value = await res.json(); assert.equal(res.ok, true, JSON.stringify(value)); return value;
  };
  const session = await api('/sessions', 'POST', { sessionId: randomUUID(), agentPreset: 'personal-remote', cwd: join(root, 'workspace') });
  await new Promise(resolve => setTimeout(resolve, 500));
  await api(`/sessions/${session.sessionId}/models`, 'PUT', { provider: routeForProfile('pf1-synthetic').provider, model: 'synthetic' });
  controller = new AbortController();
  const pump = await fetch(`${origin}/weftmate/api/v1/sessions/${session.sessionId}/events`, { signal: controller.signal });
  let events = '';
  void (async () => { try { for await (const chunk of pump.body) events += new TextDecoder().decode(chunk); } catch {} })();
  turnStarted = performance.now();
  await api(`/sessions/${session.sessionId}/messages`, 'POST', { content: process.env.PF1_INPUT ?? '你好', mode: 'queue' });
  const deadline = Date.now() + (process.env.PF1_LAN === '1' ? 600_000 : 30_000);
  while (!(requests.length && (process.env.PF1_LAN !== '1' && process.env.PF1_SCRIPTED_TASK !== '1' || /"rawType":"turn\/end"/.test(events))) && !events.includes('dsh-turn-error') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(requests.length, logs.slice(-10).join('\n') + events.slice(-7000));
  if (process.env.PF1_SCRIPTED_TASK === '1') {
    assert.equal(requests.length, 3);
    assert.ok(requests[1].tools.some(t => t.function.name === 'read'));
    assert.ok(requests[2].messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes('PF1_SYNTHETIC_OK')));
  }
  if (process.env.PF1_LAN === '1') {
    assert.ok(!events.includes('dsh-turn-error'), logs.slice(-10).join('\n'));
    if (process.env.PF1_INPUT) assert.ok(timings.some(item => item.tools.includes('read')) && timings.at(-1)?.text.includes('PF1_SYNTHETIC_OK'), 'task must read and return the synthetic file content');
    if (process.env.PF1_TIMING_FILE) await writeFile(process.env.PF1_TIMING_FILE, JSON.stringify(timings, null, 2));
    console.log(JSON.stringify({ timings }));
  }
  if (process.env.PF1_CAPTURE_FILE) await writeFile(process.env.PF1_CAPTURE_FILE, JSON.stringify(requests[0], null, 2));
  const encoding = getEncoding('cl100k_base');
  const count = value => encoding.encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
  const tokens = requests[0].messages.reduce((sum, message) => sum + count(message.content) + 4, 0) + count(requests[0].tools ?? []);
  if (process.env.PF1_ASSERT_LIMIT === '1') assert.ok(tokens <= 3000, `greeting request: ${tokens} cl100k tokens`);
  console.log(JSON.stringify({ tokenizer: 'cl100k_base (cross-model estimate)', tokens,
    messageTokens: requests[0].messages.map(m => count(m.content)), toolTokens: (requests[0].tools ?? []).map(t => ({ name: t.function.name, tokens: count(t) })) }));
  if (process.env.PF1_QUIET !== '1') console.log(JSON.stringify({ messages: requests[0].messages.map(m => ({ role: m.role, chars: JSON.stringify(m.content).length, lead: JSON.stringify(m.content).slice(0, 90) })),
    tools: (requests[0].tools ?? []).map(t => ({ name: t.function.name, chars: JSON.stringify(t).length })) }, null, 2));
} finally {
  controller?.abort(); await runtime.close(); await manager.close(); await new Promise(resolve => server.close(resolve));
  if (!requests.length) {
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.zstd') ? [join(dir, e.name)] : []);
    for (const file of walk(home)) try { console.log(zstdDecompressSync(readFileSync(file)).toString().split('\n').filter(line => line.includes('turn/end')).join('\n')); } catch {}
  }
  await rm(root, { recursive: true, force: true });
}
