/** Real DSH goal/todo/compaction driver with an isolated inference fixture. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DshWebRuntime, writeWebProfile } from '../src/dsh-web-runtime.ts';

const hasVendor = existsSync(join(process.cwd(), 'vendor', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
for (const pressure of [false, true]) test(`native ${pressure ? 'pre-step pressure' : 'output reserve recovery'} compacts before continuing and preserves goal/todos`, { timeout: 60000,
  skip: !hasVendor && 'Requires the pinned compiled DSH runtime (not supplied in CI)' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-long-task-'));
  const home = join(root, 'home'), workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, 'source.txt'), 'Verified source detail.\n'.repeat(230));
  const objective = 'Read the fixture and write a checked report without repeating completed work';
  const todos = [{ content: 'Read fixture', status: 'completed' }, { content: 'Write checked report', status: 'in_progress' }];
  const requests: any[] = [];
  let ordinary = 0, goal: any;
  const server = createServer(async (req, res) => {
    if (req.url === '/props') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ n_ctx: 32768 })); return; }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (!body.tools?.length) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ id: 'title', choices: [{ index: 0, delta: { content: 'Fixture' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'title', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    requests.push(body);
    const summary = JSON.stringify(body.messages.at(-1)).includes('acting as a compaction engine');
    let name: string | undefined, args: any, text = '';
    if (summary) text = 'Completed reading source.txt. Verified source detail. Next write report.txt. Reuse read/write; no effects should be repeated.';
    else {
      ordinary++;
      for (const message of body.messages.filter((row: any) => row.role === 'tool')) {
        try { const value = JSON.parse(message.content); if (value.goal) goal = value.goal; } catch { /* other tool text */ }
      }
      if (ordinary === 1) { name = 'create_goal'; args = { objective }; }
      if (ordinary === 2) { name = 'todo_write'; args = { todos }; }
      if (ordinary === 3) { name = 'read'; args = { file_path: 'source.txt' }; }
      if (ordinary === 4) { name = 'write'; args = { file_path: 'report.txt', content: 'Verified source detail. Checked report.' }; }
      if (ordinary === 5) { name = 'todo_write'; args = { todos: todos.map(row => ({ ...row, status: 'completed' })) }; }
      if (ordinary === 6) { name = 'get_goal'; args = {}; }
      if (ordinary === 7) { name = 'update_goal'; args = { goal_id: goal.id, revision: goal.revision, action: 'complete' }; }
      if (ordinary >= 8) text = 'Checked report complete.';
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = name ? { tool_calls: [{ index: 0, id: `tool-${ordinary}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content: text };
    res.write(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: name ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: ordinary === 3 && !summary ? (pressure ? 28500 : 25600) : 2000, completion_tokens: 30, total_tokens: 2030 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
  const plugins = join(home, 'profiles', 'weftmate', 'plugins');
  await mkdir(plugins, { recursive: true });
  await writeFile(join(plugins, 'long-task-observer.mjs'), `import { writeFileSync } from 'node:fs';
export const name = 'long-task-observer';
export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') writeFileSync(new URL('./events.json', import.meta.url), JSON.stringify(session.events));
  });
}
`);
  const patch = join(home, 'routes.yml');
  await writeFile(patch, `- id: llm-pi-ai
  config:
    providers:
      long-fixture:
        api: openai-completions
        apiKeyEnv: FIXTURE_KEY
        baseURL: http://127.0.0.1:${addr.port}/v1
        models:
          - id: fixture
            contextWindow: 262144
- id: credentials
  disabled: true
- insert:
    - id: weftmate-safe-credentials
      name: ./plugins/weftmate-credentials.mjs
    - id: long-task-observer
      name: ./plugins/long-task-observer.mjs
`);
  const logs: string[] = [];
  await writeWebProfile(home, 'weftmate');
  const preset = join(home, '.agent-presets', 'long-task-fixture');
  await mkdir(preset, { recursive: true });
  const personalComposition = await readFile(join(home, '.agent-presets', 'personal-remote', 'agent.cordis.yml'), 'utf8');
  // Exercise the generated native goal/todo/compactor composition without the
  // account tool bridge, which requires a real personal/v1 host receipt.
  await writeFile(join(preset, 'agent.cordis.yml'), personalComposition.replace(/^.*weftmate-personal-desktop-preset\.mjs\r?\n/gm, ''));
  await writeFile(join(preset, 'preset.yml'), 'name: Long task fixture\n');
  const runtime = new DshWebRuntime({ homeDir: home, workspaceDir: workspace,
    runtimePath: join(process.cwd(), 'vendor', 'dsh-runtime'), patchFiles: [patch],
    credentialRequestHandler: async ({ operation }) => operation === 'resolve' ? { value: 'fixture-only' } : { configured: true, writable: true },
    log: line => logs.push(line) });
  t.after(async () => { await runtime.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const origin = await runtime.start();
  const call = async (path: string, body: any, method = 'POST') => {
    const response = await fetch(`${origin}/weftmate/api/v1${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const value: any = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  const session = await call('/sessions', { agentPreset: 'long-task-fixture' });
  await call(`/sessions/${session.sessionId}/models`, { provider: 'long-fixture', model: 'fixture' }, 'PUT');
  await call(`/sessions/${session.sessionId}/messages`, { content: objective + '\n' + 'Prior verified fixture background. '.repeat(750), mode: 'queue' });
  let events: any[] = [];
  const deadline = Date.now() + 30000;
  while (!events.some(event => event.type === 'turn/end')) {
    try { events = JSON.parse(await readFile(join(plugins, 'events.json'), 'utf8')); } catch { /* wait for driver */ }
    if (Date.now() > deadline) assert.fail(`ordinary=${ordinary}; requests=${requests.length}; logs=${logs.slice(-15).join('\n')}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const diagnostic = JSON.stringify({ end: events.at(-1), budgets: requests.map(body => body.max_tokens ?? body.max_completion_tokens),
    compactions: events.filter(event => event.type.startsWith('compaction/')), requests: requests.map(body => ({ tool: body.tools?.length, last: JSON.stringify(body.messages.at(-1)).slice(0, 200) })) }) + '\n' + logs.slice(-15).join('\n');
  assert.equal(events.at(-1).data.reason.kind, 'completed', diagnostic);
  assert.equal(ordinary, 8);
  assert.ok(requests.every(body => (body.max_tokens ?? body.max_completion_tokens) >= 2048), diagnostic);
  const summaries = events.filter(event => event.type === 'compaction/summary');
  assert.equal(summaries.length, 1);
  const checkpoint = JSON.stringify(summaries[0].data.summary);
  assert.ok(checkpoint.includes(objective));
  assert.ok(checkpoint.includes('Read fixture'));
  assert.ok(checkpoint.includes('completed'));
  assert.ok(checkpoint.includes('in_progress'));
  const summaryIndex = requests.findIndex(body => JSON.stringify(body.messages.at(-1)).includes('acting as a compaction engine'));
  assert.equal(summaryIndex, 3, 'the summary occurs before the fourth ordinary model call');
  assert.match(JSON.stringify(requests[summaryIndex]), /reusable methods.*pitfalls/);
  assert.match(JSON.stringify(requests[summaryIndex + 1]), /Native continuation state/);
  assert.ok(JSON.stringify(requests[summaryIndex + 1]).includes(objective));
  assert.equal(events.filter(event => event.type === 'todo/write').length, 2);
  assert.ok(JSON.stringify(events.filter(event => event.type === 'goal/change').at(-1)).includes('complete'));
  assert.match(await readFile(join(workspace, 'report.txt'), 'utf8'), /Checked report/);
  const errors = events.filter(event => event.type === 'assistant/chunk' && event.data.chunk.type === 'finish' && event.data.chunk.reason?.kind === 'error');
  if (!pressure) assert.ok(JSON.stringify(events).includes('Context has no useful output reserve'), 'reserve recovery uses the native request-error path');
  assert.ok(!JSON.stringify(errors).includes('max-tokens'));
});
