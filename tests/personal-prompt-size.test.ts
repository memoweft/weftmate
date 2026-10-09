import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { getEncoding } from 'js-tiktoken';
import { presentPersonalPrompt } from '../src/plugins/personal-prompt.mjs';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pf1-prompt.json', import.meta.url), 'utf8'));
const encoder = getEncoding('cl100k_base');
const count = (value: any) => encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
const loader = fixture.greeting.tools[0].function;
const assembly = { ...fixture.assembly, tools: [...fixture.assembly.tools, loader] };

test('ordinary greeting stays below 3000 tokens with the captured production tool catalog', () => {
  const projected = presentPersonalPrompt(assembly);
  const messages = fixture.greeting.messages.map((message: any) => message.role === 'system'
    ? { ...message, content: projected.sections.map((section: any) => section.text).filter(Boolean).join('\n\n') } : message);
  const wire = { messages, tools: projected.tools.map((tool: any) => ({ type: 'function', function: tool })) };
  const tokens = messages.reduce((sum: number, message: any) => sum + count(message.content) + 4, 0) + count(wire.tools);
  assert.ok(tokens <= 3000, `actual schema projection plus synthetic request context: ${tokens}`);
  assert.deepEqual(projected.tools.map((tool: any) => tool.name), ['load_tools']);
  for (const tool of fixture.assembly.tools) assert.ok(projected.sections.some((section: any) => section.text.includes(`${tool.name}:`)), tool.name);
});

test('loading tools preserves exact schemas and relevant workflow guidance', () => {
  const names = new Set(['read', 'write', 'create_goal', 'subagent']);
  const projected = presentPersonalPrompt(assembly, names);
  for (const name of names) assert.deepEqual(projected.tools.find((tool: any) => tool.name === name),
    assembly.tools.find((tool: any) => tool.name === name));
  assert.ok(projected.sections.some((section: any) => section.name === 'tool:read'));
  assert.ok(projected.sections.some((section: any) => section.name === 'tool:goal'));
  assert.ok(projected.sections.some((section: any) => section.name === 'weftmate:delegation-guidance'));
  assert.equal(projected.sections.some((section: any) => section.name === 'tool:grep'), false);
  const repeated = presentPersonalPrompt(projected, names);
  assert.equal(new Set(repeated.sections.map((section: any) => section.name)).size, repeated.sections.length,
    'projection must not duplicate guidance');
});

test('automatic recall includes only complete bounded claims and matching source metadata', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pf1-memory-limit-'));
  const owner = 'owner-00000000-0000-4000-8000-000000000001';
  const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall',
    'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
  const create = (limits = {}) => createPersonalMemoryManager({ root, enabled: true,
    python: join(root, 'python.exe'), pythonPath: join(root, 'py'), baseUrl: 'http://127.0.0.1:12345/v1', model: '@current',
    credential: () => 'synthetic', ...limits, rpcFactory: () => ({ child: {}, async close() {}, async request(method: string, params: any) {
      if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods };
      if (method === 'initialize') return { runtime: { subject_id: owner, db_path: join(params.dsh_home, 'memoweft/memoweft.sqlite3') },
        capabilities: { subject_id: owner, methods, services: { command: { operations: [] } } } };
      if (method === 'health') return { runtime: { subject_id: owner, route_ready: true } };
      if (method === 'preview_recall') return { preview: { selected_item_ids: Array.from({ length: 40 }, (_, i) => ['cognition', `c-${i}`]),
        rendered_recall: Array.from({ length: 40 }, (_, i) => `记忆：相关条目${i}完整内容。`).join('\n') } };
      if (method === 'query_interactions') return { rendered_context: '不相关的过长交互'.repeat(500) };
      return {};
    } }) });
  const manager = create({ recallMaxItems: 3, recallMaxChars: 100 });
  t.after(async () => { await manager.close(); rmSync(root, { recursive: true, force: true }); });
  const result = await manager.recall(owner, { query: '相关条目', sessionId: 'synthetic-session' });
  assert.equal(result.sourceCount, 3); assert.ok(result.contextText.length <= 100);
  for (const source of result.memories) assert.ok(result.contextText.includes(source.summary));
  assert.doesNotMatch(result.contextText, /过长交互|条目3/);
  assert.throws(() => create({ recallMaxChars: 0 }), /MEMORY_CONFIGURATION_INVALID/);
});

test('real pinned DSH greeting wire obeys the token ceiling', {
  skip: !existsSync('vendor/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js') ? 'Pinned DSH vendor required; pure projection runs in CI' : false,
  timeout: 60_000,
}, () => {
  const env = { ...process.env, PF1_ASSERT_LIMIT: '1', PF1_QUIET: '1' };
  for (const key of ['PF1_LAN', 'PF1_SOURCE_ROOT', 'PF1_INPUT', 'PF1_CAPTURE_FILE', 'PF1_TIMING_FILE', 'PF1_ASSEMBLY_FILE']) delete env[key];
  execFileSync(process.execPath, ['tests/integration/personal-prompt-size.mjs'], { env, windowsHide: true, timeout: 55_000 });
  execFileSync(process.execPath, ['tests/integration/personal-prompt-size.mjs'], {
    env: { ...env, PF1_SCRIPTED_TASK: '1', PF1_INPUT: '读取 pf1-input.txt' }, windowsHide: true, timeout: 55_000 });
});
