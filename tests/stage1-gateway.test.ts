import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import { createGatewayV1 } from '../src/runtime/gateway/routes/v1.mjs';
import { normalizeDshEvent } from '../src/runtime/dsh-adapter/agents.mjs';

function ok(value: unknown) { return { result: { ok: true, value } }; }

describe('阶段 1 Gateway 会话恢复与逐次工具许可', () => {
  it('把 Gateway 兼容的文本块收束成适配器需要的单条文本', async () => {
    const prompts: unknown[] = [];
    const client = {
      sessions: {
        create: async () => ok({ sessionId: 's-1' }), list: async () => ok({ items: [{ sessionId: 's-1' }] }), history: async () => ok({ events: [] }),
        prompt: async (value: unknown) => { prompts.push(value); return ok({ accepted: true }); }, cancel: async () => ok({ accepted: true }),
      }, events: { mux: async function* () {}, host: async function* () {} },
      workspace: { list: async () => ok({}), create: async () => ok({}), rename: async () => ok({}), remove: async () => ok({}) },
      llm: { catalog: async () => ok({}), sessionModels: async () => ok({}), selectSessionModel: async () => ok({}) },
      settings: { describe: async () => ok({ namespaces: [] }), update: async () => ok({}), replace: async () => ok({}) }, respond: async () => ({ accepted: true }),
    };
    const gateway = createGatewayV1({ client }); const server = createServer((req, res) => void gateway.handle(req, res));
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = (server.address() as any).port; const base = `http://127.0.0.1:${port}/weftmate/api/v1`;
    try {
      await fetch(`${base}/sessions`, { method: 'POST' });
      const response = await fetch(`${base}/sessions/s-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: [{ type: 'text', text: 'compatible' }] }) });
      assert.equal(response.status, 202);
      assert.deepEqual(prompts, [{ sessionId: 's-1', mode: 'queue', content: [{ type: 'text', text: 'compatible' }] }]);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('只投影普通会话，并把 approval 当前 rpcId 传回 DSH', async () => {
    const responses: unknown[] = [];
    const modelReads: unknown[] = [];
    const client = {
      sessions: {
        create: async () => ok({ sessionId: 's-1' }),
        list: async () => ok({ items: [{ sessionId: 's-1', title: '保留的对话' }, { sessionId: 'sub', origin: 'subagent', title: '不可见' }] }),
        history: async () => ok({ events: [] }), prompt: async () => ok({ accepted: true }), cancel: async () => ok({ accepted: true }),
        models: async (value: unknown) => {
          modelReads.push(value); return ok({ current: { provider: 'cold-provider', model: 'cold-model' }, routable: true });
        },
      },
      events: { mux: async function* () {}, host: async function* () {} },
      workspace: { list: async () => ok({}), create: async () => ok({}), rename: async () => ok({}), remove: async () => ok({}) },
      llm: { catalog: async () => ok({}), sessionModels: async () => ok({}), selectSessionModel: async () => ok({}) },
      settings: { describe: async () => ok({ namespaces: [] }), update: async () => ok({}), replace: async () => ok({}) },
      respond: async (value: unknown) => { responses.push(value); return { accepted: true }; },
    };
    const gateway = createGatewayV1({ client }); const server = createServer((req, res) => void gateway.handle(req, res));
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = (server.address() as any).port; const base = `http://127.0.0.1:${port}/weftmate/api/v1`;
    try {
      const listed = await (await fetch(`${base}/sessions`)).json();
      assert.deepEqual(listed.items, [{ sessionId: 's-1', title: '保留的对话', running: false }]);
      const coldModels = await fetch(`${base}/sessions/s-1/models`);
      assert.equal(coldModels.status, 200);
      assert.deepEqual((await coldModels.json()).current, { provider: 'cold-provider', model: 'cold-model' });
      assert.deepEqual(modelReads, [{ sessionId: 's-1' }]);
      await fetch(`${base}/sessions`, { method: 'POST' });
      const approved = await (await fetch(`${base}/sessions/s-1/approval`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rpcId: 'current-rpc', approvalId: 'approval-1', outcome: 'rejected' }) })).json();
      assert.equal(approved.accepted, true);
      assert.deepEqual(responses, [{ type: 'client-response', rpcId: 'current-rpc', result: { ok: true, value: { sessionId: 's-1', approvalId: 'approval-1', outcome: 'rejected' } } }]);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('保留实时许可帧的安全标识，不投影原始工具参数', async () => {
    const event = await normalizeDshEvent({ rpcId: 'current-rpc', payload: { type: 'approval/requested', sessionId: 's-1', approvalId: 'approval-1', toolName: 'write', reason: 'write a test file', arguments: { secret: 'must-not-leak' } } });
    assert.deepEqual(event?.data, { rpcId: 'current-rpc', approvalId: 'approval-1', tool: 'write', reason: 'write a test file' });
  });

  it('只读停止核对调用原生生命周期，不启动或取消缺失的历史会话', async () => {
    const calls: any[] = [];
    const client = { sessions: {}, events: {}, workspace: {}, llm: {}, settings: {} };
    const gateway = createGatewayV1({ client, lifecycle: { taskStopState: async (input: any) => {
      calls.push(input); return { status: 'not_running', observedAt: '2026-10-09T00:00:01.000Z' };
    } } });
    const server = createServer((req, res) => void gateway.handle(req, res));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as any).port}/weftmate/api/v1/sessions/missing/stop-state`;
    try {
      const query = '?receiptId=receipt&turn=1&stopRequestedAt=2026-10-09T00%3A00%3A00.000Z';
      const response = await fetch(url + query);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'not_running');
      assert.deepEqual(calls, [{ sessionId: 'missing', receiptId: 'receipt', turn: 1, stopRequestedAt: '2026-10-09T00:00:00.000Z' }]);
      assert.equal((await fetch(url + '?receiptId=receipt&turn=invalid')).status, 400);
      assert.equal(calls.length, 1);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
