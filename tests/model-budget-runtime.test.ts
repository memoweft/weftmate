/** Real DSH + isolated metadata/inference fixture; never contacts a daily model. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DshWebRuntime } from '../src/dsh-web-runtime.ts';
import { createOfficialDshSettingsClient } from '../src/dsh-settings-migration.ts';

test('service context reaches native compaction and ten tool steps use changing wire budgets', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-budget-runtime-'));
  const home = join(root, 'home'), workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const file = join(workspace, 'fixture.txt');
  await writeFile(file, 'Read this isolated fixture ten times.\n');
  const requests: any[] = [];
  let metadataReads = 0;
  let serviceContext = 24000;
  const server = createServer((req, res) => {
    if (req.url === '/props') {
      metadataReads++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ default_generation_settings: { n_ctx: serviceContext } })); return;
    }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    let raw = '';
    req.on('data', part => { raw += part; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      body.outputBudget = body.max_tokens ?? body.max_completion_tokens;
      requests.push(body);
      const step = requests.length;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = step <= 10 ? { tool_calls: [{ index: 0, id: `read-${step}`, type: 'function',
        function: { name: 'read', arguments: JSON.stringify({ file_path: file }) } }] }
        : { content: 'ten reads completed' };
      res.write(`data: ${JSON.stringify({ id: `step-${step}`, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: `step-${step}`, choices: [{ index: 0, delta: {},
        finish_reason: step <= 10 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 16000,
        completion_tokens: 30, total_tokens: 16030 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
  await mkdir(home, { recursive: true });
  const patch = join(home, 'routes.yml');
  const observer = join(home, 'profiles', 'weftmate', 'plugins', 'budget-observer.mjs');
  await mkdir(join(home, 'profiles', 'weftmate', 'plugins'), { recursive: true });
  await writeFile(observer, `import { writeFileSync } from 'node:fs';
export const name = 'budget-observer';
export function apply(ctx) {
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (!payload.messages.some(message => message.content?.some(part => part.text === 'Budget memory exclusion'))) return decision;
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm/message');
    payload.agent.session[Symbol.for('weftmate.memoryRecall')] = { turn: payload.turn, memories: [{ id: 'budget-memory', summary: 'oversized' }] };
    return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: 'OVERSIZED_MEMORY'.repeat(20000) }], source: { kind: 'plugin', plugin: 'weftmate-personal-memory' } })] };
  });
  ctx.on('session/event', (session, event) => {
    if (event.type === 'request/context') writeFileSync(new URL('./capacity.json', import.meta.url), JSON.stringify(event.data));
  });
}
`);
  await writeFile(patch, `- id: llm-pi-ai
  config:
    providers:
      budget-fixture:
        api: openai-completions
        apiKeyEnv: FIXTURE_API_KEY
        baseURL: http://127.0.0.1:${addr.port}/v1
        models:
          - id: qwen
            contextWindow: 262144
            maxTokens: 32768
- id: credentials
  disabled: true
- insert:
    - id: weftmate-safe-credentials
      name: ./plugins/weftmate-credentials.mjs
    - id: budget-observer
      name: ./plugins/budget-observer.mjs
`);
  const logs: string[] = [];
  const runtime = new DshWebRuntime({ homeDir: home, workspaceDir: workspace,
    runtimePath: join(process.cwd(), 'vendor', 'dsh-runtime'), patchFiles: [patch],
    credentialRequestHandler: async ({ operation }) => operation === 'resolve'
      ? { value: 'isolated-fixture-key' } : { configured: true, writable: true }, log: line => logs.push(line) });
  let pumpAbort: AbortController | undefined;
  const call = async (origin: string, path: string, body?: unknown, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${origin}/weftmate/api/v1${path}`, { method,
      headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const value: any = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  try {
    const origin = await runtime.start();
    assert.ok(metadataReads >= 1, 'metadata is read at startup before a model request');
    const remote = await readFile(join(home, '.agent-presets', 'personal-remote', 'agent.cordis.yml'), 'utf8');
    assert.match(remote, /dsh-compaction-basic/);
    assert.match(remote, /thresholdRatio: 0.85/);
    const session = await call(origin, '/sessions', { agentPreset: 'minimal' });
    await call(origin, `/sessions/${session.sessionId}/models`, { provider: 'budget-fixture', model: 'qwen' }, 'PUT');
    pumpAbort = new AbortController();
    const response = await fetch(`${origin}/weftmate/api/v1/sessions/${session.sessionId}/events`, { signal: pumpAbort.signal });
    const events: any[] = [];
    const reader = response.body!.getReader();
    void (async () => {
      let pending = ''; const decoder = new TextDecoder();
      try { while (true) {
        const next = await reader.read(); if (next.done) break;
        pending += decoder.decode(next.value, { stream: true });
        const blocks = pending.split('\n\n'); pending = blocks.pop() ?? '';
        for (const block of blocks) {
          const data = block.split('\n').find(line => line.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      } } catch { /* expected abort */ }
    })();
    await call(origin, `/sessions/${session.sessionId}/messages`, { content: 'Read fixture.txt ten times, then report completion.', mode: 'queue' });
    const deadline = Date.now() + 30000;
    while (!events.some(event => JSON.stringify(event).includes('ten reads completed'))) {
      if (Date.now() > deadline) assert.fail(`steps=${requests.length}; events=${events.map(event => event.rawType ?? event.type).join(',')}; logs=${logs.join('\n')}`);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.equal(requests.length, 11);
    assert.ok(metadataReads >= 1, 'startup reads metadata');
    assert.ok(requests[0].outputBudget > 8192, `first request is no longer fixed at 8192: ${requests.map(body => body.outputBudget)}`);
    assert.ok(requests.slice(1).some(body => body.outputBudget < requests[0].outputBudget), 'provider usage reduces subsequent budgets');
    assert.ok(requests.every(body => body.outputBudget > 0 && body.outputBudget <= 19904), '24000 service window and 4096 safety bound every wire request');
    assert.ok(!events.some(event => JSON.stringify(event).includes('max-tokens')));
    // The persisted native request context is also what compaction resolves.
    const context = JSON.parse(await readFile(join(home, 'profiles', 'weftmate', 'plugins', 'capacity.json'), 'utf8'));
    assert.equal(context.contextWindow, 24000);
    assert.equal(Math.floor(context.contextWindow * 0.85), 20400);
    // A configuration commit probes again rather than retaining boot metadata.
    serviceContext = 32768;
    const settings = createOfficialDshSettingsClient({ origin });
    const snapshot = await settings.describeSettings();
    const beforeReads = metadataReads;
    await settings.mutateSettings([{ op: 'set', path: ['providers', 'budget-fixture'],
      value: { ...(snapshot.baseProviders['budget-fixture'] as object), displayName: 'Configured fixture' } }], snapshot.revision);
    const configDeadline = Date.now() + 5000;
    while (metadataReads === beforeReads) {
      if (Date.now() > configDeadline) assert.fail('configuration did not read metadata');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await call(origin, `/sessions/${session.sessionId}/messages`, { content: 'Report completion once more.', mode: 'queue' });
    while (requests.length < 12) {
      if (Date.now() > configDeadline) assert.fail('configuration did not reach a new request');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const refreshed = JSON.parse(await readFile(join(home, 'profiles', 'weftmate', 'plugins', 'capacity.json'), 'utf8'));
    assert.equal(refreshed.contextWindow, 32768);
    await call(origin, `/sessions/${session.sessionId}/messages`, { content: 'Budget memory exclusion', mode: 'queue' });
    const memoryDeadline = Date.now() + 5000;
    while (requests.length < 13) {
      if (Date.now() > memoryDeadline) assert.fail('memory budget request did not arrive');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(JSON.stringify(requests.at(-1).messages).includes('OVERSIZED_MEMORY'), false,
      'optional memory is removed from the actual wire request before it can overflow the service window');
    assert.ok(requests.at(-1).outputBudget > 0);
    const beforeCredentialRead = metadataReads;
    const credential = await fetch(`${origin}/api/credentials.set`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request',
        rpcId: 'budget-credential', method: 'credentials.set', payload: {
          ref: 'FIXTURE_API_KEY', value: 'updated-isolated-fixture-key' } }) });
    assert.equal((await credential.json() as any).result.ok, true);
    const credentialDeadline = Date.now() + 5000;
    while (metadataReads === beforeCredentialRead) {
      if (Date.now() > credentialDeadline) assert.fail('a newly saved credential did not refresh metadata');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  } finally {
    pumpAbort?.abort(); await runtime.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
