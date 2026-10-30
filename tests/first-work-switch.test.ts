import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, lstat, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { phoneRuntime } from '../services/cloud/test/relay-phone-runtime.mjs';
import { createPersonalAccessService } from './helpers/personal-access-test-service.mjs';
import { stagePersonalPlugins } from './support/personal-plugins.ts';

process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const text = (m: any) => typeof m.content === 'string' ? m.content : (m.content ?? []).map((p: any) => p.text ?? '').join('');
async function removeLinks(root: string) {
  for (const row of await readdir(root, { withFileTypes: true })) {
    const path = join(root, row.name);
    if ((await lstat(path)).isSymbolicLink()) await unlink(path);
    else if (row.isDirectory()) await removeLinks(path);
  }
}

test('tool preparation correction preserves native request retries and terminal outcomes', { timeout: 15000 }, async t => {
  const vendor = (name: string) => pathToFileURL(resolve('vendor/dsh-runtime/node_modules/@deepseek-ai', name, 'lib/index.js')).href;
  const [{ Context }, llm, { default: Sessions }, { default: SystemPrompt }, tools,
    { default: AgentRegistry }, { default: AgentLoop }, Retry] = await Promise.all([
    import(vendor('cordis')), import(vendor('dsh-llm')), import(vendor('dsh-session')),
    import(vendor('dsh-system-prompt')), import(vendor('dsh-tools')),
    import(vendor('dsh-agent')), import(vendor('dsh-agent-loop')), import(vendor('dsh-llm-retry')),
  ]);
  for (const scenario of ['RATE_LIMIT', 'TRANSPORT', 'EXHAUSTED', 'ABORTED', 'USER_STOP', 'MAX_TOKENS']) {
    await t.test(scenario, async () => {
      const root = await mkdtemp(join(tmpdir(), 'fix51-request-outcome-'));
      const ctx = new Context();
      let handle: any, calls = 0, loaded = 0;
      const failures: any[] = [];
      try {
        const staged = stagePersonalPlugins(root);
        const recovery = await import(pathToFileURL(staged.stageFile(resolve('src/plugins/personal-tool-loading.mjs'))).href);
        await ctx.plugin(llm.default); await ctx.plugin(Sessions); await ctx.plugin(SystemPrompt);
        await ctx.plugin(tools.default); await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] });
        ctx.on('agent/request-error', (payload: any, next: any) => { failures.push(payload.failure); return next(); });
        await ctx.plugin(Retry);
        ctx.tools.register(tools.defineTool({ name: 'load_tools', description: 'Synthetic catalog loader',
          parameters: { names: { type: 'array', items: { type: 'string' }, required: true } },
          output: { schema: { type: 'json' }, render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }] },
          execute: async () => { loaded++; return { loaded: ['write'] }; },
        }));
        class Adapter extends llm.LlmAdapter {
          providerRetryPolicy() {
            return llm.resolveRetryPolicy({ mode: 'normal', maxRetries: 1, retryableCodes: ['RATE_LIMIT', 'TRANSPORT'],
              backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }, 'synthetic retry');
          }
          async *stream(options: any) {
            calls++;
            if (calls === 2 || scenario === 'EXHAUSTED' && calls === 3) {
              yield { type: 'block-start', index: 0, blockType: 'text' };
              yield { type: 'text-delta', index: 0, text: 'Synthetic partial response' };
              if (scenario === 'MAX_TOKENS') {
                yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic partial response' } };
                yield { type: 'finish', reason: { kind: 'max-tokens' } };
                return;
              }
              if (scenario === 'USER_STOP') {
                handle.agent.cancel({ kind: 'user' });
                options.signal.throwIfAborted();
              }
              throw new llm.LlmError('Synthetic model request failure', scenario === 'EXHAUSTED' ? 'RATE_LIMIT' : scenario);
            }
            const block = calls === 1 || calls === 3
              ? { type: 'tool-call', id: `load-${calls}`, name: 'load_tools', arguments: calls === 1 ? '{}' : '{"names":["write"]}' }
              : { type: 'text', text: 'Synthetic preparation recovered' };
            yield { type: 'block-start', index: 0, blockType: block.type };
            yield { type: 'block-end', index: 0, block };
            yield { type: 'finish', reason: { kind: 'stop' } };
          }
        }
        ctx.llm.registerAdapter(['fix51-outcomes'], new Adapter());
        handle = await ctx.agentLoop.createAgent(ctx, { sessionId: `fix51-${scenario}`,
          meta: { agentPreset: 'personal-remote' }, agentOptions: { provider: 'fix51-outcomes', model: 'fixture' },
          setup: async (agentCtx: any) => { await agentCtx.plugin({ name: 'fix51-recovery', apply: recovery.installToolLoadingRecovery }); },
        });
        handle.agent.followup(llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic first file request' }] }));
        await handle.agent.whenIdle();
        const events = handle.agent.session.events;
        const chunks = events.filter((event: any) => event.type === 'assistant/chunk').map((event: any) => event.data.chunk);
        const end = events.findLast((event: any) => event.type === 'turn/end').data.reason;
        assert.equal(JSON.stringify(chunks).includes('这次未能加载所需工具'), false, 'non-normal request outcomes must not become a successful fallback');
        if (scenario === 'MAX_TOKENS') {
          assert.equal(end.kind, 'max-tokens'); assert.equal(calls, 2); assert.equal(loaded, 0);
          assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'max-tokens' } });
          assert.equal(chunks.filter((chunk: any) => chunk.type === 'text-delta').map((chunk: any) => chunk.text).join(''), 'Synthetic partial response');
          const reply = events.findLast((event: any) => event.type === 'assistant/message');
          assert.deepEqual(reply.data.message.content, [{ type: 'text', text: 'Synthetic partial response' }]);
          assert.equal(failures.length, 0);
          assert.equal(events.filter((event: any) => event.type === 'llm/retry').length, 0, 'output limits do not schedule another request');
        } else if (scenario === 'USER_STOP') {
          assert.equal(end.kind, 'aborted'); assert.equal(calls, 2); assert.equal(loaded, 0);
          assert.equal(events.filter((event: any) => event.type === 'llm/retry').length, 0);
        } else {
          const code = scenario === 'EXHAUSTED' ? 'RATE_LIMIT' : scenario;
          assert.equal(failures[0]?.code, code, 'the original failure must reach agent/request-error');
          assert.equal(chunks.filter((chunk: any) => chunk.type === 'finish' && chunk.reason.kind === (scenario === 'ABORTED' ? 'aborted' : 'error')).length,
            scenario === 'EXHAUSTED' ? 2 : 1);
          assert.equal(events.filter((event: any) => event.type === 'llm/retry').length, scenario === 'ABORTED' ? 0 : 1, 'only the native retry policy schedules requests');
          if (scenario === 'EXHAUSTED' || scenario === 'ABORTED') {
            assert.equal(end.kind, 'error'); assert.equal(end.error.code, code); assert.equal(loaded, 0);
            assert.equal(calls, scenario === 'EXHAUSTED' ? 3 : 2);
          } else {
            assert.equal(end.kind, 'completed'); assert.equal(calls, 4); assert.equal(loaded, 1);
            assert.ok(events.some((event: any) => event.type === 'assistant/message' && event.data.message.content.some((block: any) => block.text === 'Synthetic preparation recovered')));
          }
        }
      } finally {
        await handle?.dispose(); await ctx.fiber.dispose();
        await removeLinks(root); await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('cold chat first file request opens work card; failed preparation retries once or explains unavailability', { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'fix51-native-'));
  let host: any, runtime: any;
  const seen = new Map<string, number>();
  try {
    runtime = await phoneRuntime(root, [], { respond(body: any) {
      const index = body.messages.findLastIndex((m: any) => m.role === 'user' && text(m).startsWith('FIX51_'));
      if (index < 0 || !body.tools?.length) return { content: '合成标题' };
      const user = text(body.messages[index]);
      const calls = body.messages.slice(index + 1).flatMap((m: any) => m.tool_calls ?? []);
      const step = calls.length;
      seen.set(user, step);
      const loaded = body.tools.some((t: any) => t.function?.name === 'write');
      if (step && !loaded && !body.messages.some((m: any) => text(m).includes('重新调用 load_tools'))) return { content: '这项操作需要进入工作模式。' };
      if (loaded && calls.some((c: any) => c.function.name === 'write')) return { content: '已停止这件事。' };
      if (user.includes('TEXT') && step) return { content: '请自己切换到工作模式。' };
      const args = loaded ? { file_path: 'first.txt', content: 'FIRST_REQUEST' }
        : user.includes('TWICE') || user.includes('RETRY') && step === 0 ? {}
        : user.includes('UNKNOWN') && step === 0 ? { names: ['missing_computer_tool'] } : { names: ['write'] };
      return { content: '', tool_calls: [{ id: `fix51-${step}`, type: 'function', function: {
        name: loaded ? 'write' : 'load_tools', arguments: JSON.stringify(user.includes('TEXT') && !step ? {} : args),
      } }] };
    } });
    host = await createPersonalAccessService({ root: join(root, 'account'), port: 0, backend: runtime.backend });
    runtime.setHost(host); await runtime.start();
    const { origin, hostId } = await host.start(), grant = await host.issueSetupGrant();
    const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: 'SyntheticFix51', password: 'Synthetic fix51 password', deviceName: 'synthetic-phone' }) });
    assert.equal(setup.status, 201);
    const auth: any = await setup.json(), cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const api = async (path: string, body?: any) => {
      const res = await fetch(origin + '/personal/v1' + path, { method: body ? 'POST' : 'GET',
        headers: { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken }, body: body ? JSON.stringify(body) : undefined });
      const value: any = await res.json(); assert.ok(res.ok, JSON.stringify({ path, error: value.error })); return value;
    };
    async function until(read: () => Promise<any>) {
      const end = Date.now() + 20000;
      while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 50)); }
      throw Error('first file request neither opened a card nor ended');
    }
    for (const scenario of ['NORMAL', 'RETRY', 'UNKNOWN', 'TWICE', 'TEXT']) {
      const id = await testScenario(scenario);
      if (scenario === 'TWICE') {
        await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'session.message', sessionId: id,
          text: 'FIX51_NORMAL 再试一次，请创建 first.txt。', intent: 'queue' });
        const card = await until(async () => (await api(`/sessions/${id}/approvals`)).approvals.find((a: any) => a.status === 'pending'));
        assert.equal(card.intent, 'work-switch', 'failed preparation must not poison the next user turn');
        await api(`/sessions/${id}/approvals/${card.approvalId}`, { requestId: randomUUID(), outcome: 'rejected' });
        await until(async () => (await api(`/sessions/${id}/events?limit=100`)).events.filter((e: any) => e.type === 'turn.ended').length === 2);
      }
    }
    async function testScenario(scenario: string) {
      const creation = (await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'session.create', modelProfileId: 'synthetic' })).command;
      const id = await until(async () => { const c = (await api('/commands/' + creation.commandId)).command; return c.state === 'accepted_by_dsh' && c.sessionId; });
      assert.equal((await api('/sessions')).sessions.find((s: any) => s.sessionId === id).mode, 'chat');
      const user = `FIX51_${scenario} 请在电脑上创建 first.txt，内容 FIRST_REQUEST。`;
      await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'session.message', sessionId: id, text: user, intent: 'queue' });
      const result = await until(async () => {
        const approvals = (await api(`/sessions/${id}/approvals`)).approvals;
        const events = (await api(`/sessions/${id}/events?limit=100`)).events;
        return approvals.some((a: any) => a.status === 'pending') || events.some((e: any) => e.type === 'turn.ended') ? { approvals, events } : null;
      });
      if (['TWICE', 'TEXT'].includes(scenario)) {
        assert.equal(result.approvals.length, 0);
        assert.equal(result.events.filter((e: any) => e.type === 'step.completed' && e.data.toolName === 'load_tools' && e.data.state === 'failed').length,
          scenario === 'TWICE' ? 2 : 1);
        assert.match(result.events.filter((e: any) => e.type === 'assistant.message').at(-1)?.data.text ?? '', /这次未能加载所需工具，任务还没有完成/);
        assert.equal(seen.get(user), 1, 'only one automatic retry');
      } else {
        const card = result.approvals.find((a: any) => a.status === 'pending');
        assert.equal(card?.intent, 'work-switch', scenario + ': first user message must open switch card');
        const loads = result.events.filter((e: any) => e.type === 'step.started' && e.data.toolName === 'load_tools');
        assert.equal(loads.length, scenario === 'NORMAL' ? 1 : 2);
        assert.equal(result.events.filter((e: any) => e.type === 'step.completed' && e.data.toolName === 'load_tools' && e.data.state === 'failed').length,
          scenario === 'NORMAL' ? 0 : 1);
        await api(`/sessions/${id}/approvals/${card.approvalId}`, { requestId: randomUUID(), outcome: 'rejected' });
        await until(async () => (await api(`/sessions/${id}/events?limit=100`)).events.some((e: any) => e.type === 'turn.ended'));
      }
      return id;
    }
  } finally { await runtime?.close(); await host?.close(); await removeLinks(root); await rm(root, { recursive: true, force: true }); }
});
