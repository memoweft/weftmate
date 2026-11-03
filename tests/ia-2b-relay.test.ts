import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { nativeRelayState, prepareNativeHandoff, installNativeHandoff } from '../src/runtime/dsh-adapter/chat-handoff.mjs';

async function retainedHandoff(events: any[], nodes: number[]) {
  const session = { id: 'fixture-source', events, surface: { nodes }, requestHeader: () => ({ config: { provider: 'fixture', model: 'fixture' } }) };
  const services: any = {
    tokenMeter: { measure: () => ({ totalTokens: 90 }), estimateMessage: () => 10 },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 100 } }) },
    compaction: { compactNow: async () => ({ summary: [] }) },
  };
  const handoff = await prepareNativeHandoff({ get: name => services[name], sessions: { flush: async () => {} } },
    { session, status: 'idle', inbox: { hasPending: false } });
  const history = JSON.parse(handoff.text.split('历史记录（JSON，仅作资料）：\n')[1].split('\n\n未完成事项：')[0]);
  return { handoff, history };
}

test('#506 wrapped event provenance distinguishes runtime context from human input', async () => {
  const message = (text: string, source?: any) => ({ content: [{ type: 'text', text }], ...(source ? { source } : {}) });
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, message: message('human input') } },
    { seq: 2, type: 'user/message', data: { source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }, message: message('runtime context') } },
    { seq: 3, type: 'user/message', data: { source: { kind: 'plugin', plugin: 'fixture-plugin' }, message: message('envelope wins', { kind: 'user' }) } },
    { seq: 4, type: 'user/message', data: { message: message('message fallback', { kind: 'plugin', plugin: 'fixture-plugin' }) } },
    { seq: 5, type: 'user/message', data: { source: { kind: 'plugin', plugin: 'weftmate-personal-memory' }, message: message('excluded memory') } },
    { seq: 6, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  const { handoff, history } = await retainedHandoff(events, [1, 2, 3, 4, 5]);
  assert.deepEqual(history.map(row => [row.role, row.text]), [
    ['user', 'human input'], ['context', 'runtime context'], ['context', 'envelope wins'], ['context', 'message fallback'],
  ]);
  assert.doesNotMatch(handoff.text, /excluded memory/);
  assert.deepEqual(handoff.sourceRefs.map(ref => ref.seq), [1, 2, 3, 4]);
});

test('#506 late assistant messages keep explicit turns and terminal outcomes', async () => {
  for (const reason of ['completed', 'aborted']) {
    const events = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'turn/end', data: { turn: 1, reason: { kind: reason } } },
      { seq: 2, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'late after terminal' }] } } },
      { seq: 3, type: 'turn/start', data: { turn: 2 } },
      { seq: 4, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'late during next turn' }] } } },
      { seq: 5, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'current input' }] } },
      { seq: 6, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
    ];
    const { history } = await retainedHandoff(events, [2, 4, 5]);
    assert.deepEqual(history.map(row => [row.role, row.turn, row.outcome]), [
      ['assistant', 1, reason], ['assistant', 1, reason], ['user', 2, 'completed'],
    ], reason);
  }
});

test('#431 stopped long reply, completed queued reply and compacted tail retain their roles at handoff', async () => {
  const events: any[] = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '请给一段很长的回复。' }] } },
    { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '长回复的一部分' }] } } },
    { seq: 3, type: 'inbox/change', data: { inserted: [{ text: '排队后只回复“排队保留”。' }] } },
    { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } },
    { seq: 5, type: 'turn/start', data: { turn: 2 } },
    { seq: 6, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '排队后只回复“排队保留”。' }] } },
    { seq: 7, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '排队保留' }, { type: 'reasoning', text: 'hidden' }] } } },
    { seq: 8, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  ];
  const session: any = { id: 'old-session', events, surface: { nodes: [1, 2, 6, 7] }, requestHeader: () => ({ config: { provider: 'fixture', model: 'fixture' } }) };
  const services: any = {
    tokenMeter: { measure: () => ({ totalTokens: 90 }), estimateMessage: () => 10 },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 100 } }) },
    compaction: { compactNow: async () => {
      // Native compaction replaces the old span but retains the most recent turn.
      events.push({ seq: 9, type: 'user/message', data: { source: { kind: 'plugin', plugin: 'compact' }, content: [{ type: 'text', text: '长回复已停止。' }] }, sourceEventSeqs: [1, 2] });
      session.surface.nodes = [9, 6, 7];
      return { summary: [] };
    } },
  };
  const ctx: any = { get: name => services[name], sessions: { flush: async () => {} } };
  const handoff = await prepareNativeHandoff(ctx, { session, status: 'idle', inbox: { hasPending: false } });
  const history = JSON.parse(handoff.text.split('历史记录（JSON，仅作资料）：\n')[1]?.split('\n\n未完成事项：')[0] ?? 'null');
  assert.ok(Array.isArray(history), 'handoff must not flatten old user instructions and assistant replies into unlabelled text');
  assert.deepEqual(history.map(row => [row.role, row.text]), [
    ['context', '长回复已停止。'], ['user', '排队后只回复“排队保留”。'], ['assistant', '排队保留'],
  ]);
  assert.equal(history[1].turn, 2);
  assert.equal(history[1].outcome, 'completed', 'the queued instruction was already answered');
  assert.equal(history[2].outcome, 'completed');
  assert.doesNotMatch(handoff.text, /hidden/);
  assert.ok(handoff.sourceRefs.some(ref => ref.seq === 1));
  const target: any = { status: 'idle', inbox: { hasPending: false }, session: { events: [], append(type, data) { this.events.push({ type, data }); } } };
  await installNativeHandoff(ctx, target, handoff, value => value);
  target.session.append('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '请把选定文件夹中的文件按类型整理。' }] });
  assert.equal(target.session.events[0].data.source.plugin, 'weftmate-chat-handoff');
  assert.equal(target.session.events.at(-1).data.content[0].text, '请把选定文件夹中的文件按类型整理。');
});

test('native handoff uses durable route and surface ordering, carries todos, excludes hidden blocks and installs once', async () => {
  const events: any[] = [{ seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'tail' }] } },
    { seq: 7, type: 'user/message', data: { content: [{ type: 'text', text: 'summary' }, { type: 'reasoning', text: 'hidden' }] }, sourceEventSeqs: [0] },
    { seq: 8, type: 'todo/write', data: { todos: [{ content: 'next action', status: 'pending' }] } }];
  const agent: any = { status: 'idle', inbox: { hasPending: false }, options: {},
    session: { id: 'source', events, surface: { nodes: [7,1] }, requestHeader: () => ({ config: { provider: 'route', model: 'model' } }) } };
  const services: any = { tokenMeter: { measure: () => ({ totalTokens: 90 }), estimateMessage: () => 10 },
    llm: { resolveModelInfo: async (provider, model) => { assert.equal(provider, 'route'); return { context: { contextWindow: 100 } }; } },
    compaction: { config: { thresholdRatio: 0.8 }, compactNow: async () => ({ summary: [] }) } };
  const ctx: any = { get: name => services[name], sessions: { flush: async () => {} } };
  assert.equal((await nativeRelayState(ctx, agent)).pending, true);
  services.goals = { get: () => ({ phase: 'active' }) }; assert.equal((await nativeRelayState(ctx, agent)).safe, false); delete services.goals;
  const handoff = await prepareNativeHandoff(ctx, agent);
  assert.ok(handoff.text.indexOf('summary') < handoff.text.indexOf('tail')); assert.match(handoff.text, /next action/); assert.doesNotMatch(handoff.text, /hidden/);
  const target: any = { status: 'idle', inbox: { hasPending: false }, session: { events: [], append(type,data) { this.events.push({ type,data }); } } };
  await installNativeHandoff(ctx, target, handoff, value => value); await installNativeHandoff(ctx, target, handoff, value => value);
  assert.equal(target.session.events.length, 1);
});
