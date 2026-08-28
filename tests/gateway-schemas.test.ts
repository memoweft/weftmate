import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// P1-01 契约：WeftMate API v1 schemas（src/runtime/gateway/schemas）。
// L1 契约测试：目录完备性（每个声明的事件类型都有可过校验的合法样本）+
// 信封/各面 data 的负样本拒收 + bootstrap 握手 + health 快照。
import {
  EVENT_TYPES,
  PROTOCOL_VERSION,
  checkBootstrapRequest,
  checkBootstrapResponse,
  checkHealth,
  validateEvent,
  type EventType,
  type HealthPayload,
} from '../src/runtime/gateway/schemas/index.ts';

const AT = '2026-08-20T10:00:00.000Z';
const DSH_PIN = '47f943859bef60e4160492346772ded9b24f765a';

function env(type: string, data: unknown): Record<string, unknown> {
  return { v: 1, id: `evt-${type}`, type, at: AT, data };
}

function validHealth(): HealthPayload {
  return {
    app: { name: 'WeftMate', version: '0.1.0' },
    gateway: { protocolVersion: PROTOCOL_VERSION, startedAt: AT },
    runtime: { state: 'running' },
    dsh: { pin: DSH_PIN, pinned: true },
    sessions: { active: 1 },
    memory: { available: true, version: '0.7.0.dev0' },
    update: { status: 'unknown', version: null },
  };
}

/** 每个 v1 事件类型的合法 data 样本（完备性断言的数据源）。 */
function validData(type: EventType): Record<string, unknown> {
  switch (type) {
    case 'workspace.activated':
      return { id: 'ws-1', name: 'MemoWeft', root: 'D:\\MemoWeft' };
    case 'session.created':
      return { id: 's-1', workspaceId: 'ws-1', title: 'P1-01', createdAt: AT };
    case 'session.activated':
      return { id: 's-1', workspaceId: 'ws-1' };
    case 'session.compacted':
      return { id: 's-1', summaryChars: 1234 };
    case 'session.closed':
      return { id: 's-1', reason: null };
    case 'model.list':
      return {
        models: [{ id: 'qwen3.8-27b', label: null, contextWindow: 262144 }],
        active: 'qwen3.8-27b',
      };
    case 'model.call.started':
      return { callId: 'c-1', sessionId: 's-1', model: 'qwen3.8-27b' };
    case 'model.call.completed':
      return {
        callId: 'c-1', sessionId: 's-1', model: 'qwen3.8-27b',
        tokens: { input: 10, output: 20 }, durationMs: 1500,
      };
    case 'model.call.failed':
      return {
        callId: 'c-1', sessionId: 's-1', model: 'qwen3.8-27b',
        error: { code: 'TIMEOUT', message: 'model timed out' },
      };
    case 'permission.requested':
      return { requestId: 'r-1', sessionId: 's-1', tool: 'pwsh', scope: null, description: 'run test' };
    case 'permission.decided':
      return { requestId: 'r-1', sessionId: 's-1', tool: 'pwsh', decision: 'allow', decidedBy: 'user' };
    case 'coding.toolCall':
      return { sessionId: 's-1', tool: 'edit', status: 'completed', durationMs: 12, error: null };
    case 'coding.fileChange':
      return { sessionId: 's-1', path: 'src/x.ts', change: 'modified' };
    case 'coding.command':
      return { sessionId: 's-1', command: 'npm test', exitCode: 0, durationMs: 4321 };
    case 'coding.testRun':
      return { sessionId: 's-1', total: 66, passed: 65, failed: 1 };
    case 'coding.commit':
      return { sessionId: 's-1', sha: 'b5fecf5', message: 'docs: baseline' };
    case 'user.message':
    case 'assistant.delta':
    case 'assistant.completed':
      return { sessionId: 's-1', turn: 1, text: 'safe text' };
    case 'agent.status':
      return { sessionId: 's-1', turn: null, status: 'idle' };
    case 'tool.started':
    case 'tool.completed':
    case 'tool.failed':
      return { sessionId: 's-1', turn: 1, callId: 'c-1', tool: 'shell' };
    case 'turn.stopped':
      return { sessionId: 's-1', turn: 1, reason: 'cancelled' };
    case 'error':
      return { sessionId: 's-1', turn: 1, code: 'dsh-turn-error', message: 'Gateway request failed', details: { digest: 'a'.repeat(64) } };
  }
}

function assertValidEvent(type: EventType): void {
  const r = validateEvent(env(type, validData(type)));
  assert.ok(r.ok, `${type} valid fixture rejected: ${JSON.stringify(r.ok ? null : r.errors)}`);
}

function assertInvalidEvent(type: string, data: unknown, needle: string): void {
  const r = validateEvent(env(type, data));
  assert.ok(!r.ok, `${type} invalid fixture accepted: ${JSON.stringify(data)}`);
  if (!r.ok) {
    assert.ok(
      r.errors.some((e) => e.includes(needle)),
      `expected error mentioning "${needle}", got: ${r.errors.join('; ')}`,
    );
  }
}

describe('P1-01 · WeftMate API v1 schemas', () => {
  it('目录完备：旧目录 + P1-03 流式事件，无重复、每个都有合法样本过 validateEvent', () => {
    assert.equal(EVENT_TYPES.length, 25);
    assert.equal(new Set(EVENT_TYPES).size, EVENT_TYPES.length, 'duplicate event types');
    for (const t of EVENT_TYPES) assertValidEvent(t);
  });

  it('信封：合法事件放行；v/id/type/at/data 逐字段负样本拒收', () => {
    assertValidEvent('session.activated');
    const d = validData('session.activated');
    // v/id/type/at/data 在信封层，直接构造信封负样本
    const badV = validateEvent({ ...env('session.activated', d), v: 2 });
    assert.ok(!badV.ok);
    if (!badV.ok) assert.ok(badV.errors.some((e) => e.includes('envelope.v')), badV.errors.join('; '));
    assert.ok(!validateEvent({ ...env('session.activated', d), id: '' }).ok);
    assert.ok(!validateEvent({ ...env('session.activated', d), at: 'yesterday' }).ok);
    const noData = { ...env('session.activated', d) };
    delete noData.data;
    assert.ok(!validateEvent(noData).ok);
    assert.ok(!validateEvent('not-an-object').ok);
  });

  it('未知事件类型拒收（不猜测、不静默放行）', () => {
    const r = validateEvent(env('session.exploded', { id: 's-1' }));
    assert.ok(!r.ok);
    if (!r.ok) assert.match(r.errors[0], /unknown "session\.exploded"/);
  });

  it('workspace 面：root 必填、name 可空', () => {
    assertValidEvent('workspace.activated');
    assertInvalidEvent('workspace.activated', { id: 'ws-1', name: 'x' }, 'workspace.root');
    assertInvalidEvent('workspace.activated', { id: '', name: null, root: 'D:\\x' }, 'workspace.id');
  });

  it('session 面：created 需 ISO createdAt；title 不可为数字', () => {
    assertValidEvent('session.created');
    assertInvalidEvent('session.created', { id: 's-1', workspaceId: 'ws-1', title: 42, createdAt: AT }, 'title');
    assertInvalidEvent('session.created', { id: 's-1', workspaceId: 'ws-1', title: null, createdAt: 'soon' }, 'createdAt');
    assertValidEvent('session.compacted');
    assertInvalidEvent('session.compacted', { id: 's-1', summaryChars: -1 }, 'summaryChars');
  });

  it('model 面：tokens 内层 int|null；failed 需结构化 error', () => {
    assertValidEvent('model.call.completed');
    assertInvalidEvent(
      'model.call.completed',
      { callId: 'c-1', sessionId: 's-1', model: 'm', tokens: { input: 'many', output: null }, durationMs: null },
      'tokens.input',
    );
    assertInvalidEvent('model.call.failed', { callId: 'c-1', sessionId: 's-1', model: 'm' }, 'error');
    assertValidEvent('model.list');
    assertInvalidEvent('model.list', { models: 'nope', active: null }, 'models');
  });

  it('permission 面：decision/decidedBy 枚举拒收越界值', () => {
    assertValidEvent('permission.decided');
    assertInvalidEvent(
      'permission.decided',
      { requestId: 'r-1', sessionId: 's-1', tool: 'pwsh', decision: 'maybe', decidedBy: 'user' },
      'decision',
    );
    assertInvalidEvent(
      'permission.decided',
      { requestId: 'r-1', sessionId: 's-1', tool: 'pwsh', decision: 'allow', decidedBy: 'admin' },
      'decidedBy',
    );
  });

  it('coding 面：status/change 枚举；计数非负；path 相对非空', () => {
    assertValidEvent('coding.toolCall');
    assertInvalidEvent(
      'coding.toolCall',
      { sessionId: 's-1', tool: 'edit', status: 'done', durationMs: null, error: null },
      'status',
    );
    assertValidEvent('coding.testRun');
    assertInvalidEvent('coding.testRun', { sessionId: 's-1', total: 2, passed: 2, failed: -1 }, 'failed');
    assertInvalidEvent('coding.fileChange', { sessionId: 's-1', path: '', change: 'modified' }, 'path');
  });

  it('P1-03 流式面：文本/工具/取消/红错均有稳定最小结构', () => {
    assertValidEvent('assistant.delta');
    assertInvalidEvent('assistant.delta', { sessionId: 's-1', turn: 1, text: '' }, 'text');
    assertValidEvent('tool.failed');
    assertInvalidEvent('tool.failed', { sessionId: 's-1', turn: 1, callId: 'c', tool: '' }, 'tool');
    assertValidEvent('turn.stopped');
    assertInvalidEvent('turn.stopped', { sessionId: 's-1', turn: 1, reason: 'completed' }, 'reason');
    assertValidEvent('error');
    assertInvalidEvent('error', { sessionId: 's-1', turn: 1, code: 'x', message: 'safe', details: {} }, 'digest');
  });

  it('bootstrap 握手：请求/响应正负样本', () => {
    const req = checkBootstrapRequest({ client: { name: 'probe-cli', version: '0.1.0' } });
    assert.ok(req.ok, JSON.stringify(req.ok ? null : req.errors));
    assert.ok(checkBootstrapRequest({ client: { name: 'probe-cli', version: '0.1.0' }, capabilities: { streaming: true } }).ok);
    assert.ok(!checkBootstrapRequest({ capabilities: {} }).ok);
    assert.ok(!checkBootstrapRequest({ client: { name: 'x' } }).ok);
    assert.ok(!checkBootstrapRequest({ client: { name: 'x', version: '1' }, capabilities: 'yes' }).ok);

    const resp = checkBootstrapResponse({ protocolVersion: 1, health: validHealth(), events: [...EVENT_TYPES] });
    assert.ok(resp.ok, JSON.stringify(resp.ok ? null : resp.errors));
    assert.ok(!checkBootstrapResponse({ protocolVersion: 2, health: validHealth(), events: [] }).ok);
    assert.ok(
      !checkBootstrapResponse({ protocolVersion: 1, health: validHealth(), events: ['nope.event'] }).ok,
      'unknown event in bootstrap response must be rejected',
    );
  });

  it('health 快照：正样本放行；runtime.state / sessions.active / dsh.pinned 负样本拒收', () => {
    assert.ok(checkHealth(validHealth()).ok);
    const bad1 = { ...validHealth(), runtime: { state: 'sleeping' } } as unknown;
    assert.ok(!checkHealth(bad1).ok);
    const bad2 = { ...validHealth(), sessions: { active: 1.5 } } as unknown;
    assert.ok(!checkHealth(bad2).ok);
    const bad3 = { ...validHealth(), dsh: { pin: DSH_PIN } } as unknown;
    assert.ok(!checkHealth(bad3).ok);
    const bad4 = { ...validHealth(), update: { status: 'soon', version: null } } as unknown;
    assert.ok(!checkHealth(bad4).ok);
  });
});
