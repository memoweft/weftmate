import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stagePersonalPlugins } from './support/personal-plugins.ts';

const vendor = (name: string) => pathToFileURL(resolve('vendor/dsh-runtime/node_modules/@deepseek-ai', name, 'lib/index.js')).href;
type Stage = 'gate' | 'body';

async function fixture(t: any, stage: Stage = 'gate', outcome = 'rejected', toolsMode: 'native' | 'both' = 'native') {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-approval-rejection-'));
  const staged = stagePersonalPlugins(root);
  const [{ Context }, { default: SystemPrompt }, { default: Sessions }, tools, llm,
    { default: ApprovalService }, { createScope }, plugin] = await Promise.all([
    import(vendor('cordis')), import(vendor('dsh-system-prompt')), import(vendor('dsh-session')),
    import(vendor('dsh-tools')), import(vendor('dsh-llm')), import(vendor('dsh-user-approval')),
    import(vendor('dsh-scope')),
    import(pathToFileURL(staged.stageFile(resolve('src/plugins/weftmate-personal-reply-content.mjs'))).href),
  ]);
  const ctx = new Context();
  Object.defineProperty(ctx, 'logger', { value: { warn() {} }, configurable: true });
  t.after(async () => { await ctx.fiber.dispose(); rmSync(root, { recursive: true, force: true }); });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(Sessions);
  await ctx.plugin(llm.default);
  if (toolsMode === 'both') await ctx.plugin((await import(vendor('dsh-code-runtime-worker-thread'))).default,
    { computeMs: 5000, maxWallMs: 10000, maxOutputBytes: 1024 * 1024, maxOldGenerationSizeMb: 128 });
  await ctx.plugin(tools.default, { mode: toolsMode });
  await ctx.plugin(ApprovalService, { policy: 'ask' });
  await ctx.plugin(plugin.default);
  const session = ctx.sessions.create('approval-rejection', { meta: { agentPreset: 'personal-remote' } });
  const agent: any = { id: session.id, session, options: {} };
  const scope = createScope(ctx, agent); agent.ctx = scope.ctx;
  t.after(() => scope.dispose());
  const target = join(root, 'synthetic-user-file.txt');
  writeFileSync(target, 'synthetic content to preserve on rejection');
  let bodyCalls = 0, effects = 0, requests = 0, turn = 1;
  ctx.on('approval/request', async () => { requests++; return outcome; });
  ctx.on('tools/pre-execute', (exec: any, next: any) => stage === 'gate' && exec.name === 'fixture_remove'
    ? { kind: 'ask', reason: 'Delete the isolated synthetic file' } : next());
  const output = { schema: { type: 'json' }, render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }] };
  ctx.tools.register(tools.defineTool({ name: 'fixture_remove', description: 'Delete one isolated synthetic file', parameters: {}, output,
    execute: async (_args: any, exec: any) => {
      bodyCalls++;
      if (stage === 'body') {
        const decision = await ctx.approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.callId,
          reason: 'Delete the isolated synthetic file', signal: exec.signal });
        // The refusal must come from the native audit pair, even when the body emits an ordinary error.
        if (decision !== 'allowed-once') throw new Error('Fixture permission was not granted');
      }
      unlinkSync(target); effects++; return { deleted: true };
    } }));
  ctx.tools.register(tools.defineTool({ name: 'fixture_read', description: 'Read an isolated missing file', parameters: {}, output,
    execute: async () => ({ content: readFileSync(join(root, 'missing-file.txt'), 'utf8') }) }));
  ctx.tools.register(tools.defineTool({ name: 'fixture_error', description: 'Fail with misleading ordinary error text', parameters: {}, output,
    execute: async () => { throw new Error('the user rejected tool "fixture_error"'); } }));
  session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 });
  async function invoke(name: string, callId: string, args: object = {}) {
    const call = session.append('tool/call', { turn, step: 1, name, callId, arguments: JSON.stringify(args) });
    const result = await ctx.tools.execute({ name, callId, arguments: args, agent,
      signal: AbortSignal.timeout(toolsMode === 'both' ? 12000 : 5000) });
    // Match the native loop: persist the already-presented result, then derive the next model input.
    const logged = session.append('tool/result', { turn, step: 1, ...(result.isError ? { error: result.error } : {}),
      message: llm.createToolResultMessage({ callId, content: result.content, isError: result.isError }) },
    { surfaceOp: 'append', sourceEventSeqs: [call.seq] });
    const derived = session.deriveMessages().filter((message: any) => message.source?.callId === callId ||
      message.content?.some((part: any) => part.type === 'tool-result' && part.toolCallId === callId));
    assert.ok(derived.length > 0, 'the persisted result reaches the next model input');
    return { result, channels: { returned: JSON.stringify(result.content),
      appended: JSON.stringify(logged.data.message.content), derived: JSON.stringify(derived) } };
  }
  function assertAudit(callId: string, expected: string) {
    const asked = session.events.filter((event: any) => event.type === 'approval/asked' && event.data.callId === callId);
    assert.equal(asked.length, 1, 'exactly one native approval request for this call');
    const decided = session.events.filter((event: any) => event.type === 'approval/decided' && event.data.id === asked[0].data.id);
    assert.equal(decided.length, 1); assert.equal(decided[0].data.outcome, expected);
  }
  function nextTurn() {
    session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'stop' } });
    turn++; session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 });
  }
  return { session, target, invoke, assertAudit, nextTurn, counts: () => ({ bodyCalls, effects, requests }) };
}

function assertRefusal(channels: Record<string, string>) {
  for (const [channel, text] of Object.entries(channels)) {
    assert.match(text, /你已拒绝|用户.*拒绝/, `${channel} preserves the user's rejection`);
    assert.match(text, /不要.*(?:重试|再次申请)/, `${channel} tells the model to stop retrying`);
    assert.doesNotMatch(text, /必要时换一种办法再试/, `${channel} must not encourage bypassing rejection`);
  }
}

for (const stage of ['gate', 'body'] as const) {
  test(`native ${stage} approval rejection survives returned content, session append and derived model history`, { timeout: 15000 }, async t => {
    const f = await fixture(t, stage);
    const { result, channels } = await f.invoke('fixture_remove', 'rejected-call');
    f.assertAudit('rejected-call', 'rejected');
    assert.equal(result.isError, true); assert.equal(existsSync(f.target), true);
    assert.equal(readFileSync(f.target, 'utf8'), 'synthetic content to preserve on rejection');
    assert.deepEqual(f.counts(), { bodyCalls: stage === 'gate' ? 0 : 1, effects: 0, requests: 1 });
    assertRefusal(channels);
  });
}

test('native gate and body approval grants execute the isolated deletion once', { timeout: 15000 }, async t => {
  for (const stage of ['gate', 'body'] as const) {
    const f = await fixture(t, stage, 'allowed-once');
    const { result, channels } = await f.invoke('fixture_remove', 'approved-call');
    f.assertAudit('approved-call', 'allowed-once');
    assert.equal(result.isError, false); assert.equal(existsSync(f.target), false);
    assert.deepEqual(f.counts(), { bodyCalls: 1, effects: 1, requests: 1 });
    for (const text of Object.values(channels)) assert.doesNotMatch(text, /你已拒绝|用户.*拒绝|不要.*(?:重试|再次申请)/);
  }
});

test('ordinary native file errors without approval do not claim user rejection', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const { result, channels } = await f.invoke('fixture_read', 'ordinary-error');
  assert.equal(result.isError, true); assert.equal(existsSync(f.target), true);
  assert.equal(f.counts().requests, 0);
  assert.equal(f.session.events.filter((event: any) => event.type.startsWith('approval/')).length, 0);
  for (const text of Object.values(channels)) assert.doesNotMatch(text, /你已拒绝|用户.*拒绝|不要.*(?:重试|再次申请)/);
});

test('a rejected approval in a completed turn does not contaminate the next turn file error', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  await f.invoke('fixture_remove', 'previous-rejection'); f.assertAudit('previous-rejection', 'rejected');
  f.nextTurn();
  // Reuse the call id to verify the turn boundary rather than relying on globally unique fixture ids.
  const { result, channels } = await f.invoke('fixture_read', 'previous-rejection');
  assert.equal(result.isError, true); assert.equal(existsSync(f.target), true);
  assert.equal(f.counts().requests, 1);
  // Earlier history must retain its refusal; inspect only the newly appended model result here.
  const newest = f.session.deriveMessages().at(-1);
  for (const text of [channels.returned, channels.appended, JSON.stringify(newest)])
    assert.doesNotMatch(text, /你已拒绝|用户.*拒绝|不要.*(?:重试|再次申请)/);
});

function assertNestedRejection(f: Awaited<ReturnType<typeof fixture>>, rootCallId: string) {
  const started = f.session.events.filter((event: any) => event.type === 'tool/code-dispatch-start');
  assert.equal(started.length, 1, 'one native Code Mode subcall was actually dispatched');
  const child = started[0].data;
  assert.equal(child.rootCallId, rootCallId); assert.equal(child.parentCallId, rootCallId);
  assert.equal(child.name, 'fixture_remove'); assert.notEqual(child.subCallId, rootCallId);
  f.assertAudit(child.subCallId, 'rejected');
  const finished = f.session.events.filter((event: any) => event.type === 'tool/code-dispatch' && event.data.subCallId === child.subCallId);
  assert.equal(finished.length, 1); assert.equal(finished[0].data.isError, true);
  assert.equal(existsSync(f.target), true);
  assert.equal(readFileSync(f.target, 'utf8'), 'synthetic content to preserve on rejection');
  assert.deepEqual(f.counts(), { bodyCalls: 0, effects: 0, requests: 1 });
}

test('native Code Mode nested rejection survives outer failure, append and derived model history', { timeout: 20000 }, async t => {
  const f = await fixture(t, 'gate', 'rejected', 'both');
  const { result, channels } = await f.invoke('run_code', 'nested-rejection', {
    code: 'return await tools.fixture_remove({});', description: 'Delete one isolated synthetic file',
  });
  assertNestedRejection(f, 'nested-rejection');
  assert.equal(result.isError, true);
  assertRefusal(channels);
});

test('native Code Mode catching a nested rejection keeps the outer result successful', { timeout: 20000 }, async t => {
  const f = await fixture(t, 'gate', 'rejected', 'both');
  const { result, channels } = await f.invoke('run_code', 'caught-nested-rejection', {
    code: 'try { await tools.fixture_remove({}); } catch { return { skipped: true }; } return { skipped: false };',
    description: 'Skip the synthetic deletion when approval is refused',
  });
  assertNestedRejection(f, 'caught-nested-rejection');
  assert.equal(result.isError, false);
  assert.deepEqual(result.value.result, { skipped: true });
  for (const text of Object.values(channels)) {
    assert.match(text, /skipped/);
    assert.doesNotMatch(text, /你已拒绝|用户.*拒绝|不要.*(?:重试|再次申请)/);
  }
});

test('a rejected approval does not contaminate a different call in the same turn', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const rejection = await f.invoke('fixture_remove', 'same-turn-rejection');
  f.assertAudit('same-turn-rejection', 'rejected');
  assertRefusal(rejection.channels);
  const { result, channels } = await f.invoke('fixture_read', 'same-turn-read-error');
  assert.equal(result.isError, true); assert.equal(existsSync(f.target), true);
  assert.equal(f.counts().requests, 1);
  assert.equal(f.session.events.filter((event: any) => event.type === 'turn/start').length, 1);
  assert.equal(f.session.events.filter((event: any) => event.type === 'approval/asked').length, 1);
  for (const [channel, text] of Object.entries(channels))
    assert.doesNotMatch(text, /你已拒绝|用户.*拒绝|不要.*(?:重试|再次申请)/, `${channel} keeps unrelated failures separate`);
});

test('ordinary error wording about user rejection does not replace native approval audit', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const { result, channels } = await f.invoke('fixture_error', 'misleading-error');
  assert.equal(result.isError, true); assert.equal(existsSync(f.target), true);
  assert.equal(f.counts().requests, 0);
  assert.equal(f.session.events.filter((event: any) => event.type.startsWith('approval/')).length, 0);
  for (const [channel, text] of Object.entries(channels))
    assert.doesNotMatch(text, /你已拒绝|用户.*拒绝|不要.*(?:重试|再次申请)|the user rejected tool/,
      `${channel} does not infer approval rejection from ordinary error text`);
});

test('native Code Mode caught rejection does not relabel a later unrelated read failure', { timeout: 20000 }, async t => {
  const f = await fixture(t, 'gate', 'rejected', 'both');
  const rootCallId = 'caught-rejection-then-read-error';
  const { result, channels } = await f.invoke('run_code', rootCallId, {
    code: 'try { await tools.fixture_remove({}); } catch {} return await tools.fixture_read({});',
    description: 'Keep the refused deletion skipped while attempting a separate read',
  });
  const started = f.session.events.filter((event: any) => event.type === 'tool/code-dispatch-start');
  assert.deepEqual(started.map((event: any) => event.data.name), ['fixture_remove', 'fixture_read']);
  assert.notEqual(started[0].data.subCallId, started[1].data.subCallId);
  for (const event of started) {
    assert.equal(event.data.rootCallId, rootCallId); assert.equal(event.data.parentCallId, rootCallId);
  }
  f.assertAudit(started[0].data.subCallId, 'rejected');
  assert.equal(f.session.events.filter((event: any) => event.type === 'approval/asked').length, 1,
    'the separate read never requested approval');
  const finished = f.session.events.filter((event: any) => event.type === 'tool/code-dispatch');
  assert.deepEqual(finished.map((event: any) => [event.data.subCallId, event.data.isError]),
    started.map((event: any) => [event.data.subCallId, true]));
  assert.equal(existsSync(f.target), true);
  assert.equal(readFileSync(f.target, 'utf8'), 'synthetic content to preserve on rejection');
  assert.deepEqual(f.counts(), { bodyCalls: 0, effects: 0, requests: 1 });
  assert.equal(result.isError, true);
  function textParts(value: any): string[] {
    if (Array.isArray(value)) return value.flatMap(textParts);
    if (value && typeof value === 'object') return value.type === 'text' && typeof value.text === 'string'
      ? [value.text] : Object.values(value).flatMap(textParts);
    return [];
  }
  for (const [channel, serialized] of Object.entries(channels)) {
    const texts = textParts(JSON.parse(serialized));
    assert.match(texts[0], /没能完成/, `${channel} explains the ordinary failure first`);
    assert.doesNotMatch(texts[0], /你已拒绝这项操作/, `${channel} does not attribute the whole failure to rejection`);
    assert.ok(texts.length >= 2, `${channel} separates the ordinary failure from the refused suboperation`);
    assert.ok(texts.slice(1).some(text => /你已拒绝其中一项操作/.test(text) && /其他步骤.*不代表被你拒绝/.test(text)),
      `${channel} separately preserves the refusal without relabeling other failures`);
  }
});
