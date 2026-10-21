import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stagePersonalPlugins } from './support/personal-plugins.ts';

const vendor = (name: string) => pathToFileURL(resolve('vendor/dsh-runtime/node_modules/@deepseek-ai', name, 'lib/index.js')).href;

async function fixture(t: any, project = true) {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-offline-fs-context-'));
  const staged = stagePersonalPlugins(root);
  const [{ Context }, { default: SystemPrompt }, { default: Sessions }, tools, llm,
    { default: LocalFileSystem }, fsTools, { FsError }, { createScope }, plugin] = await Promise.all([
    import(vendor('cordis')), import(vendor('dsh-system-prompt')), import(vendor('dsh-session')),
    import(vendor('dsh-tools')), import(vendor('dsh-llm')), import(vendor('dsh-fs-local')),
    import(vendor('dsh-tool-fs')), import(vendor('dsh-fs')), import(vendor('dsh-scope')),
    import(pathToFileURL(staged.stageFile(resolve('src/plugins/weftmate-personal-reply-content.mjs'))).href),
  ]);
  const ctx = new Context();
  Object.defineProperty(ctx, 'logger', { value: { warn() {} }, configurable: true });
  t.after(async () => { await ctx.fiber.dispose(); rmSync(root, { recursive: true, force: true }); });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(Sessions);
  await ctx.plugin(llm.default);
  await ctx.plugin(tools.default, { mode: 'native' });
  await ctx.plugin(LocalFileSystem, { cwd: root });
  await ctx.plugin(fsTools);
  if (project) await ctx.plugin(plugin.default);
  const session = ctx.sessions.create('offline-fs-context', { cwd: root, meta: { agentPreset: 'personal-remote' } });
  const agent: any = { id: session.id, session, options: {} };
  const scope = createScope(ctx, agent); agent.ctx = scope.ctx;
  t.after(() => scope.dispose());
  writeFileSync(join(root, 'existing.txt'), 'first line\nsecond line\n');
  let executions = 0;
  ctx.on('tools/execute', async (_exec: any, next: any) => { executions++; return next(); });
  session.append('turn/start', { turn: 1 });
  session.append('step/start', { turn: 1, step: 1 });
  async function invoke(name: string, args: object, callId = 'fs-context-call') {
    const call = session.append('tool/call', { turn: 1, step: 1, name, callId, arguments: JSON.stringify(args) });
    const result = await ctx.tools.execute({ name, callId, arguments: args, agent, signal: AbortSignal.timeout(5000) });
    const logged = session.append('tool/result', { turn: 1, step: 1, ...(result.error?.info ? { error: result.error.info } : {}),
      message: llm.createToolResultMessage({ callId, content: result.content, isError: result.isError }) },
    { surfaceOp: 'append', sourceEventSeqs: [call.seq] });
    const derived = session.deriveMessages().filter((message: any) => message.content?.some(
      (part: any) => part.type === 'tool-result' && part.toolCallId === callId));
    assert.ok(derived.length > 0, 'the actual native result reaches the next model input');
    assert.equal(executions, 1, 'presentation does not invoke another operation or retry');
    return { result, channels: {
      returned: JSON.stringify(result.content), persisted: JSON.stringify(logged.data.message.content), derived: JSON.stringify(derived),
    } };
  }
  return { ctx, root, session, tools, FsError, invoke };
}

test('native filesystem distinguishes absent paths and out-of-range lines even though both use FS_NOT_FOUND', { timeout: 15000 }, async t => {
  const missing = await fixture(t, false);
  const absent = await missing.invoke('read', { file_path: 'missing.txt' });
  const range = await fixture(t, false);
  const beyond = await range.invoke('read', { file_path: 'existing.txt', offset: 9 });
  assert.equal(absent.result.error.info.name, 'FsError');
  assert.equal(beyond.result.error.info.name, 'FsError');
  assert.equal(absent.result.error.info.code, 'FS_NOT_FOUND');
  assert.equal(beyond.result.error.info.code, 'FS_NOT_FOUND');
  assert.match(absent.channels.returned, /not found/);
  assert.match(beyond.channels.returned, /offset 9 is out of range/);
  assert.equal(existsSync(join(missing.root, 'missing.txt')), false);
  assert.equal(readFileSync(join(range.root, 'existing.txt'), 'utf8'), 'first line\nsecond line\n');
});

test('offline task read result retains real path absence through production hooks and derived model history', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const { result, channels } = await f.invoke('read', { file_path: 'missing.txt' });
  assert.equal(result.isError, true);
  assert.equal(result.error.info.code, 'FS_NOT_FOUND');
  assert.equal(existsSync(join(f.root, 'missing.txt')), false, 'presentation must never create the missing target');
  assert.equal(f.session.events.filter((event: any) => event.type.startsWith('approval/')).length, 0);
  assert.deepEqual(Object.fromEntries(Object.entries(channels).map(([channel, text]) => [channel, /不存在|not found/i.test(text)])),
    { returned: true, persisted: true, derived: true }, 'all model-facing channels retain path absence instead of a generic failure');
  for (const [channel, text] of Object.entries(channels)) {
    assert.doesNotMatch(text, /用户.{0,4}拒绝|你已拒绝/, `${channel} does not invent a refusal`);
  }
});

test('offline task read result retains line-range failure without treating the same code as an absent file', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const { result, channels } = await f.invoke('read', { file_path: 'existing.txt', offset: 9 });
  assert.equal(result.isError, true);
  assert.equal(result.error.info.code, 'FS_NOT_FOUND');
  assert.equal(readFileSync(join(f.root, 'existing.txt'), 'utf8'), 'first line\nsecond line\n');
  assert.deepEqual(Object.fromEntries(Object.entries(channels).map(([channel, text]) => [channel, /行号|范围|out of range/i.test(text)])),
    { returned: true, persisted: true, derived: true }, 'all model-facing channels retain the failing read range');
  for (const [channel, text] of Object.entries(channels)) {
    assert.doesNotMatch(text, /文件不存在|(?:可以|请|直接|应当|建议|尝试).{0,8}(?:新建|创建)|create (?:the |a )?file/i,
      `${channel} must not infer file absence or creation from FS_NOT_FOUND alone`);
  }
});

test('typed sandbox denial stays an error and never becomes missing-file creation or retry advice', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  let bodyCalls = 0;
  f.ctx.tools.register(f.tools.defineTool({ name: 'fixture_fs_denied', description: 'Replay a typed provider denial', parameters: {},
    output: { schema: { type: 'json' }, render: () => [] }, execute: async () => {
      bodyCalls++;
      throw new f.FsError('The active read-only sandbox denies this write', 'FS_SANDBOX_DENIED');
    } }));
  const { result, channels } = await f.invoke('fixture_fs_denied', {});
  assert.equal(result.error.info.code, 'FS_SANDBOX_DENIED');
  assert.equal(result.isError, true);
  assert.equal(bodyCalls, 1, 'presentation must not retry or bypass a denied operation');
  for (const [channel, text] of Object.entries(channels)) {
    assert.doesNotMatch(text, /文件不存在|可以.{0,8}(?:新建|创建)|必要时换一种办法再试/i,
      `${channel} must not turn a permission failure into recoverable absence or bypass advice`);
  }
});
