import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __approvalTimerHasRefForTests,
  __getTaskRetentionDebugForTests,
  __resetAgentTasksForTests,
  __runTaskCleanupForTests,
  __setBackupReaderForTests,
  __setApprovalTimeoutForTests,
  __setClientFactory,
  __setTaskBudgetsForTests,
  __setTaskRetentionForTests,
  __taskCleanupTimerHasRefForTests,
  configureAgentDeps,
  decideStep,
  getTaskView,
  startTask,
  stopTask,
  undoTask,
  type AgentTaskView,
} from '../src/agent.ts';

const done = (summary = 'ok') => JSON.stringify({ done: { summary } });
const action = (tool: string, args: Record<string, unknown>) => JSON.stringify({ action: { tool, args } });
const terminal = (view: AgentTaskView) => ['done', 'failed', 'stopped'].includes(view.status);

function scriptedFactory(replies: Array<string | Promise<string>>): () => { chat(): Promise<string> } {
  return () => {
    let index = 0;
    return { chat: async () => await (replies[index++] ?? done('fallback')) };
  };
}

async function waitFor(id: string, predicate: (view: AgentTaskView) => boolean, timeoutMs = 3000): Promise<AgentTaskView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const view = getTaskView(id);
    if (view && predicate(view)) return view;
    if (Date.now() > deadline) throw new Error(`等待任务状态超时：${JSON.stringify(view)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let workspace: string;
let now: number;

beforeEach(() => {
  __resetAgentTasksForTests();
  workspace = mkdtempSync(join(tmpdir(), 'weftmate-retention-'));
  now = 1_000;
  __setTaskRetentionForTests({ now: () => now, ttlMs: 10_000, maxTerminalTasks: 50 });
});

afterEach(() => {
  __resetAgentTasksForTests();
  rmSync(workspace, { recursive: true, force: true });
});

describe('Agent 终态留存与重资源释放', () => {
  it('叫停会立刻中断在途模型请求，而不是等模型自己返回', async () => {
    let started!: () => void;
    let aborted!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const didAbort = new Promise<void>((resolve) => { aborted = resolve; });
    let receivedSignal: AbortSignal | undefined;
    __setClientFactory(() => ({
      chat: async (_messages, signal) => {
        receivedSignal = signal;
        started();
        return await new Promise<string>((_resolve, reject) => {
          const onAbort = () => { aborted(); reject(new Error('aborted')); };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
    }));
    const { id } = startTask({ task: '等待模型', workspace, autonomy: 'auto' });
    await didStart;

    assert.equal(stopTask(id), true);
    assert.equal(getTaskView(id)?.status, 'stopped', '停止接口应立即给 UI 终态');
    await didAbort;
    assert.equal(receivedSignal?.aborted, true);
  });

  it('叫停会把同一个停止信号传给正在运行的 MCP 调用', async () => {
    let mcpStarted!: () => void;
    let mcpAborted!: () => void;
    const didStart = new Promise<void>((resolve) => { mcpStarted = resolve; });
    const didAbort = new Promise<void>((resolve) => { mcpAborted = resolve; });
    configureAgentDeps({
      mcpTools: () => [{ fqName: 'mcp_61__wait', description: 'wait', signature: '()', readOnly: true }],
      isMcpToolTrusted: () => true,
      callMcp: async (_name, _args, signal) => {
        mcpStarted();
        return await new Promise<string>((_resolve, reject) => {
          const onAbort = () => { mcpAborted(); reject(new Error('aborted')); };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
    });
    __setClientFactory(scriptedFactory([action('mcp_61__wait', {}), done()]));
    const { id } = startTask({ task: '等待外部工具', workspace, autonomy: 'auto' });
    await didStart;

    assert.equal(stopTask(id), true);
    await didAbort;
    const view = getTaskView(id)!;
    assert.equal(view.status, 'stopped');
    assert.equal(view.steps[0].status, 'rejected');
    assert.match(view.steps[0].error ?? '', /叫停/);
  });

  it('叫停会终止命令进程树，命令后续动作不会继续发生', async () => {
    writeFileSync(join(workspace, 'long-command.cjs'), [
      "require('fs').writeFileSync('started.flag', '1');",
      "setTimeout(() => { require('fs').writeFileSync('finished.flag', '1'); process.exit(0); }, 700);",
    ].join('\n'));
    const command = `"${process.execPath}" long-command.cjs`;
    __setClientFactory(scriptedFactory([action('run_command', { command }), done()]));
    const { id } = startTask({ task: '跑长命令', workspace, autonomy: 'auto' });
    await waitFor(id, (view) => view.status === 'awaiting');
    assert.equal(decideStep(id, 'approve'), true);
    const deadline = Date.now() + 2_000;
    while (!existsSync(join(workspace, 'started.flag')) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(existsSync(join(workspace, 'started.flag')), true, '命令应已真实启动');

    assert.equal(stopTask(id), true);
    assert.equal(getTaskView(id)?.status, 'stopped');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.equal(existsSync(join(workspace, 'finished.flag')), false, '被叫停的子进程不能继续写完成标记');
  });

  it('planning/running/awaiting 永不清理，且 chat 在途叫停后不再执行新动作', async () => {
    let resolveRunning!: (value: string) => void;
    let resolvePlanning!: (value: string) => void;
    const runningReply = new Promise<string>((resolve) => { resolveRunning = resolve; });
    const planningReply = new Promise<string>((resolve) => { resolvePlanning = resolve; });
    let factoryIndex = 0;
    __setClientFactory(() => {
      const index = factoryIndex++;
      if (index === 0) return { chat: async () => await runningReply };
      if (index === 1) return { chat: async () => await planningReply };
      let called = false;
      return { chat: async () => called ? done() : (called = true, action('write_file', { path: 'awaiting.txt', content: 'x' })) };
    });
    let settled = 0;
    configureAgentDeps({ settled: () => { settled++; } });

    const running = startTask({ task: '运行中', workspace, autonomy: 'auto' }).id;
    const planning = startTask({ task: '规划中', workspace, autonomy: 'suggest' }).id;
    const awaiting = startTask({ task: '等待批准', workspace, autonomy: 'ask' }).id;
    await waitFor(awaiting, (view) => view.status === 'awaiting');

    now = 100_000;
    __setTaskRetentionForTests({ ttlMs: 1, maxTerminalTasks: 0 });
    __runTaskCleanupForTests();
    assert.equal(getTaskView(running)?.status, 'running');
    assert.equal(getTaskView(planning)?.status, 'planning');
    assert.equal(getTaskView(awaiting)?.status, 'awaiting');
    assert.equal(getTaskView(awaiting)?.canUndo, false);

    __setTaskRetentionForTests({ ttlMs: 10_000, maxTerminalTasks: 50 });
    assert.equal(stopTask(running), true);
    assert.equal(stopTask(planning), true);
    assert.equal(stopTask(awaiting), true);
    resolveRunning(action('write_file', { path: 'must-not-run.txt', content: 'bad' }));
    resolvePlanning(JSON.stringify({ summary: 'plan', plan: [] }));
    await Promise.all([
      waitFor(running, (view) => view.status === 'stopped'),
      waitFor(planning, (view) => view.status === 'stopped'),
      waitFor(awaiting, (view) => view.status === 'stopped'),
    ]);
    assert.equal(existsSync(join(workspace, 'must-not-run.txt')), false);
    assert.equal(settled, 3, '每个终态只回调一次');
  });

  it('complete 先消费图片，再释放附件/模型上下文/原始 step.args；回调抛错也照常收口', async () => {
    const imageDataUrl = 'data:image/png;base64,aGVsbG8=';
    let consumedImage = '';
    let settled = 0;
    configureAgentDeps({
      complete: async (_id, _task, _summary, _usedTools, attachments) => {
        const image = attachments.find((attachment) => attachment.kind === 'image');
        consumedImage = image?.kind === 'image' ? image.dataUrl : '';
        throw new Error('模拟宿主落盘失败');
      },
      settled: () => { settled++; },
    });
    __setClientFactory(scriptedFactory([
      action('write_file', { path: 'large.txt', content: 'x'.repeat(2_000) }),
      done('完成'),
    ]));

    const { id } = startTask({
      task: '带图写文件', workspace, autonomy: 'auto',
      attachments: [{ name: 'ref.png', kind: 'image', mime: 'image/png', dataUrl: imageDataUrl }],
      context: [{ role: 'user', content: '旧上下文' }],
    });
    const view = await waitFor(id, terminal);
    const debug = __getTaskRetentionDebugForTests(id)!;
    assert.equal(view.status, 'done');
    assert.equal(consumedImage, imageDataUrl, '图片必须先交给 completion callback');
    assert.deepEqual(view.attachments, ['ref.png'], '终态只留附件名');
    assert.equal(debug.attachmentCount, 0);
    assert.equal(debug.messageCount, 0);
    assert.equal(debug.contextCount, 0);
    assert.deepEqual(debug.stepArgs[0].args, {});
    assert.match(debug.stepArgs[0].argsSummary ?? '', /large\.txt.*2000/);
    assert.equal(settled, 1);
  });

  it('failed 也释放附件和上下文，并且 settled 只触发一次', async () => {
    let settled = 0;
    configureAgentDeps({ settled: () => { settled++; throw new Error('模拟宿主清理失败'); } });
    __setClientFactory(() => ({ chat: async () => { throw new Error('模型失败'); } }));
    const { id } = startTask({
      task: '失败任务', workspace, autonomy: 'auto',
      attachments: [{ name: 'secret.txt', content: 'sensitive' }],
      context: [{ role: 'assistant', content: 'history' }],
    });
    const view = await waitFor(id, terminal);
    const debug = __getTaskRetentionDebugForTests(id)!;
    assert.equal(view.status, 'failed');
    assert.equal(debug.attachmentCount, 0);
    assert.equal(debug.messageCount, 0);
    assert.equal(debug.contextCount, 0);
    assert.equal(settled, 1);
  });

  it('规划失败、连续解析失败和步数耗尽都进入同一个 settled 出口', async () => {
    let settled = 0;
    configureAgentDeps({ settled: () => { settled++; } });

    __setClientFactory(() => ({ chat: async () => { throw new Error('规划模型失败'); } }));
    const planFailed = startTask({ task: '规划失败', workspace, autonomy: 'suggest' }).id;
    assert.equal((await waitFor(planFailed, terminal)).status, 'failed');

    __setClientFactory(scriptedFactory([
      action('read_file', { path: 'missing.txt' }),
      '无法解析一', '无法解析二', '无法解析三',
    ]));
    const parseFailed = startTask({ task: '解析失败', workspace, autonomy: 'auto' }).id;
    const parseView = await waitFor(parseFailed, terminal);
    assert.equal(parseView.status, 'failed');
    assert.match(parseView.note ?? '', /模型没按格式回复/);

    __setClientFactory(scriptedFactory(
      Array.from({ length: 20 }, () => action('read_file', { path: 'missing.txt' })),
    ));
    const stepLimited = startTask({ task: '步数耗尽', workspace, autonomy: 'auto' }).id;
    const limitView = await waitFor(stepLimited, terminal);
    assert.equal(limitView.status, 'failed');
    assert.match(limitView.note ?? '', /步数上限/);
    assert.equal(settled, 3);
  });

  it('终态数量硬上限淘汰最老项，TTL 在精确边界生效', async () => {
    __setTaskRetentionForTests({ ttlMs: 1_000, maxTerminalTasks: 2 });
    __setClientFactory(scriptedFactory([done()]));
    const first = startTask({ task: '一', workspace, autonomy: 'auto' }).id;
    await waitFor(first, terminal);
    now = 1_010;
    const second = startTask({ task: '二', workspace, autonomy: 'auto' }).id;
    await waitFor(second, terminal);
    assert.ok(getTaskView(first));
    assert.ok(getTaskView(second));
    now = 1_020;
    const third = startTask({ task: '三', workspace, autonomy: 'auto' }).id;
    await waitFor(third, terminal);
    assert.equal(getTaskView(first), null, '第 3 个终态使最老项提前清理');
    assert.ok(getTaskView(second));
    assert.ok(getTaskView(third));

    now = 2_010;
    __runTaskCleanupForTests();
    assert.equal(getTaskView(second), null, 'age === TTL 时清理');
    assert.ok(getTaskView(third), '未到 TTL 的较新任务保留');
  });

  it('原始任务、终态字段和全部终态元数据都受字节预算约束', async () => {
    __setTaskBudgetsForTests({ taskTextBytes: 10 });
    assert.throws(
      () => startTask({ task: '这段任务肯定超过十字节', workspace, autonomy: 'auto' }),
      /任务描述不能超过/,
    );

    __setTaskBudgetsForTests({ taskTextBytes: 64 * 1024, terminalFieldBytes: 20 });
    __setClientFactory(scriptedFactory([done('好'.repeat(100))]));
    const first = startTask({ task: '第一项', workspace, autonomy: 'auto' }).id;
    const firstView = await waitFor(first, terminal);
    assert.ok(Buffer.byteLength(firstView.summary ?? '', 'utf8') <= 20, '摘要截断标记也必须计入单项预算');
    assert.doesNotMatch(firstView.summary ?? '', /�/);

    const firstBytes = __getTaskRetentionDebugForTests(first)!.metadataBytes;
    __setTaskBudgetsForTests({ terminalMetadataBytes: firstBytes + 32 });
    __setClientFactory(scriptedFactory([done('第二项')]))
    const second = startTask({ task: '第二项', workspace, autonomy: 'auto' }).id;
    await waitFor(second, terminal);
    assert.equal(getTaskView(first), null, '超过全局字节预算时淘汰最老终态');
    assert.ok(getTaskView(second), '保留较新的终态');
  });

  it('撤回备份有单文件、单任务和全局字节上限，超限时不覆盖原文件', async () => {
    const large = join(workspace, 'large.txt');
    writeFileSync(large, '12345');
    __setTaskBudgetsForTests({ backupFileBytes: 4, taskBackupBytes: 100, globalBackupBytes: 100 });
    __setClientFactory(scriptedFactory([action('write_file', { path: 'large.txt', content: 'changed' }), done()]));
    const perFile = startTask({ task: '单文件上限', workspace, autonomy: 'auto' }).id;
    const perFileView = await waitFor(perFile, terminal);
    assert.equal(readFileSync(large, 'utf8'), '12345');
    assert.match(perFileView.steps[0].error ?? '', /单个撤回备份上限/);

    __setTaskBudgetsForTests({ backupFileBytes: 100, taskBackupBytes: 6, globalBackupBytes: 100 });
    writeFileSync(join(workspace, 'one.txt'), '1111');
    writeFileSync(join(workspace, 'two.txt'), '2222');
    __setClientFactory(scriptedFactory([
      action('write_file', { path: 'one.txt', content: 'new-one' }),
      action('write_file', { path: 'two.txt', content: 'new-two' }),
      done(),
    ]));
    const perTask = startTask({ task: '单任务上限', workspace, autonomy: 'auto' }).id;
    const perTaskView = await waitFor(perTask, terminal);
    assert.equal(readFileSync(join(workspace, 'one.txt'), 'utf8'), 'new-one');
    assert.equal(readFileSync(join(workspace, 'two.txt'), 'utf8'), '2222');
    assert.match(perTaskView.steps[1].error ?? '', /本任务撤回备份/);
    assert.equal(__getTaskRetentionDebugForTests(perTask)?.backupBytes, 4);

    __setTaskBudgetsForTests({ taskBackupBytes: 100, globalBackupBytes: 6 });
    writeFileSync(join(workspace, 'three.txt'), '3333');
    __setClientFactory(scriptedFactory([action('write_file', { path: 'three.txt', content: 'new-three' }), done()]));
    const global = startTask({ task: '全局上限', workspace, autonomy: 'auto' }).id;
    const globalView = await waitFor(global, terminal);
    assert.equal(readFileSync(join(workspace, 'three.txt'), 'utf8'), '3333');
    assert.match(globalView.steps[0].error ?? '', /全部任务的撤回备份/);
  });

  it('有备份的非终态也不可撤回；到 TTL 后返回诚实过期错误', async () => {
    writeFileSync(join(workspace, 'before.txt'), 'old');
    let resolveDone!: (value: string) => void;
    const doneReply = new Promise<string>((resolve) => { resolveDone = resolve; });
    __setClientFactory(scriptedFactory([
      action('write_file', { path: 'before.txt', content: 'new' }),
      doneReply,
    ]));
    const { id } = startTask({ task: '改文件', workspace, autonomy: 'ask' });
    await waitFor(id, (view) => view.status === 'awaiting');
    assert.equal(decideStep(id, 'approve'), true);
    await waitFor(id, (view) => view.status === 'running' && readFileSync(join(workspace, 'before.txt'), 'utf8') === 'new');
    assert.equal(getTaskView(id)?.canUndo, false, '活跃任务即使已有备份也不可撤回');
    const activeUndo = await undoTask(id);
    assert.equal(activeUndo.ok, false);
    assert.match(activeUndo.error ?? '', /任务还没结束/);
    assert.equal(readFileSync(join(workspace, 'before.txt'), 'utf8'), 'new');

    resolveDone(done());
    await waitFor(id, terminal);
    __setTaskRetentionForTests({ ttlMs: 100 });
    now += 100;
    const expired = await undoTask(id);
    assert.equal(expired.ok, false);
    assert.match(expired.error ?? '', /撤回窗口已过期/);
    assert.equal(readFileSync(join(workspace, 'before.txt'), 'utf8'), 'new');
  });

  it('等待批准超时会自动停止，不执行动作，且计时器不阻止进程退出', async () => {
    __setApprovalTimeoutForTests(25);
    let chatCalls = 0;
    let settled = 0;
    __setClientFactory(() => ({
      chat: async () => {
        chatCalls++;
        return action('write_file', { path: 'must-not-write.txt', content: 'blocked' });
      },
    }));
    configureAgentDeps({ settled: () => { settled++; } });

    const { id } = startTask({ task: '等待后超时', workspace, autonomy: 'ask' });
    const awaiting = await waitFor(id, (view) => view.status === 'awaiting');
    assert.equal(awaiting.approvalTimeoutMs, 25);
    assert.equal(typeof awaiting.approvalExpiresAt, 'number');
    assert.equal(__approvalTimerHasRefForTests(id), false);

    const stopped = await waitFor(id, terminal);
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.steps[0].status, 'rejected');
    assert.match(stopped.note ?? '', /等待确认超过.*自动停止/);
    assert.equal(existsSync(join(workspace, 'must-not-write.txt')), false);
    assert.equal(chatCalls, 1, '超时后不再请求模型继续规划');
    assert.equal(settled, 1);
    assert.equal(decideStep(id, 'approve'), false, '超时后的旧批准不能复活任务');
  });

  it('部分撤回只删除成功备份，后续删除视为冲突并保留重试', async () => {
    const subdir = join(workspace, 'sub');
    mkdirSync(subdir);
    writeFileSync(join(workspace, 'a.txt'), 'old-a');
    writeFileSync(join(subdir, 'b.txt'), 'old-b');
    __setClientFactory(scriptedFactory([
      action('write_file', { path: 'a.txt', content: 'new-a' }),
      action('write_file', { path: 'sub/b.txt', content: 'new-b' }),
      done(),
    ]));
    const { id } = startTask({ task: '改两个文件', workspace, autonomy: 'auto' });
    await waitFor(id, terminal);
    rmSync(subdir, { recursive: true, force: true });

    const partial = await undoTask(id);
    assert.equal(partial.ok, false);
    assert.equal(partial.restored, 1);
    assert.equal(partial.failed, 0);
    assert.equal(partial.conflicted, 1);
    assert.equal(readFileSync(join(workspace, 'a.txt'), 'utf8'), 'old-a');
    assert.equal(getTaskView(id)?.canUndo, true, '冲突备份仍可重试');

    mkdirSync(subdir);
    writeFileSync(join(subdir, 'b.txt'), 'new-b');
    const retry = await undoTask(id);
    assert.equal(retry.ok, true);
    assert.equal(retry.restored, 1);
    assert.equal(retry.failed, 0);
    assert.equal(readFileSync(join(subdir, 'b.txt'), 'utf8'), 'old-b');
    assert.equal(getTaskView(id)?.canUndo, false);
  });

  it('已有文件和新文件被用户再次修改后，撤回不会覆盖或删除', async () => {
    const existing = join(workspace, 'existing.txt');
    const created = join(workspace, 'created.txt');
    writeFileSync(existing, 'old');
    __setClientFactory(scriptedFactory([
      action('write_file', { path: 'existing.txt', content: 'agent-existing' }),
      action('write_file', { path: 'created.txt', content: 'agent-created' }),
      done(),
    ]));
    const { id } = startTask({ task: '改文件', workspace, autonomy: 'auto' });
    await waitFor(id, terminal);

    writeFileSync(existing, 'user-existing');
    writeFileSync(created, 'user-created');
    const result = await undoTask(id);

    assert.equal(result.ok, false);
    assert.equal(result.restored, 0);
    assert.equal(result.failed, 0);
    assert.equal(result.conflicted, 2);
    assert.match(result.error ?? '', /未覆盖你的新内容/);
    assert.equal(readFileSync(existing, 'utf8'), 'user-existing');
    assert.equal(readFileSync(created, 'utf8'), 'user-created');
    assert.equal(getTaskView(id)?.canUndo, true, '冲突项保留，允许之后重试');
  });

  it('混合撤回先还原安全项，冲突项恢复到 Agent 改后状态后可重试', async () => {
    const safe = join(workspace, 'safe.txt');
    const conflict = join(workspace, 'conflict.txt');
    writeFileSync(safe, 'old-safe');
    writeFileSync(conflict, 'old-conflict');
    __setClientFactory(scriptedFactory([
      action('write_file', { path: 'safe.txt', content: 'new-safe' }),
      action('write_file', { path: 'conflict.txt', content: 'new-conflict' }),
      done(),
    ]));
    const { id } = startTask({ task: '改两个文件', workspace, autonomy: 'auto' });
    await waitFor(id, terminal);
    writeFileSync(conflict, 'user-conflict');

    const partial = await undoTask(id);
    assert.equal(partial.ok, false);
    assert.equal(partial.restored, 1);
    assert.equal(partial.failed, 0);
    assert.equal(partial.conflicted, 1);
    assert.equal(readFileSync(safe, 'utf8'), 'old-safe');
    assert.equal(readFileSync(conflict, 'utf8'), 'user-conflict');

    writeFileSync(conflict, 'new-conflict');
    const retry = await undoTask(id);
    assert.equal(retry.ok, true);
    assert.equal(retry.restored, 1);
    assert.equal(retry.conflicted, 0);
    assert.equal(readFileSync(conflict, 'utf8'), 'old-conflict');
    assert.equal(getTaskView(id)?.canUndo, false);
  });

  it('文件已经回到改前状态时按已还原处理，不再强行写入', async () => {
    const file = join(workspace, 'already-restored.txt');
    writeFileSync(file, 'old');
    __setClientFactory(scriptedFactory([
      action('write_file', { path: 'already-restored.txt', content: 'new' }),
      done(),
    ]));
    const { id } = startTask({ task: '改文件', workspace, autonomy: 'auto' });
    await waitFor(id, terminal);
    writeFileSync(file, 'old');

    const result = await undoTask(id);
    assert.equal(result.ok, true);
    assert.equal(result.restored, 1);
    assert.equal(result.conflicted, 0);
    assert.equal(readFileSync(file, 'utf8'), 'old');
    assert.equal(getTaskView(id)?.canUndo, false);
  });

  it('同一路径连续写入只认可最后一次成功写入状态', async () => {
    const file = join(workspace, 'multi.txt');
    writeFileSync(file, 'old');
    __setClientFactory(scriptedFactory([
      action('write_file', { path: 'multi.txt', content: 'first' }),
      action('write_file', { path: 'multi.txt', content: 'final' }),
      done(),
    ]));
    const { id } = startTask({ task: '连续写', workspace, autonomy: 'auto' });
    await waitFor(id, terminal);

    writeFileSync(file, 'first');
    const conflict = await undoTask(id);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.conflicted, 1);
    assert.equal(readFileSync(file, 'utf8'), 'first');

    writeFileSync(file, 'final');
    const retry = await undoTask(id);
    assert.equal(retry.ok, true);
    assert.equal(readFileSync(file, 'utf8'), 'old');
  });

  it('任务后路径被换成指向工作区外的链接时，撤回安全失败且不触碰外部文件', async () => {
    const subdir = join(workspace, 'linked');
    const outside = mkdtempSync(join(tmpdir(), 'weftmate-retention-outside-'));
    try {
      __setClientFactory(scriptedFactory([
        action('write_file', { path: 'linked/file.txt', content: 'agent' }),
        done(),
      ]));
      const { id } = startTask({ task: '新建文件', workspace, autonomy: 'auto' });
      await waitFor(id, terminal);
      rmSync(subdir, { recursive: true, force: true });
      writeFileSync(join(outside, 'file.txt'), 'outside');
      symlinkSync(outside, subdir, process.platform === 'win32' ? 'junction' : 'dir');

      const result = await undoTask(id);
      assert.equal(result.ok, false);
      assert.equal(result.failed, 1);
      assert.equal(result.conflicted, 0);
      assert.equal(readFileSync(join(outside, 'file.txt'), 'utf8'), 'outside');
      assert.equal(getTaskView(id)?.canUndo, true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('已有文件备份读取失败时中止覆盖，不把原文件误记成不存在', async () => {
    const file = join(workspace, 'protected.txt');
    writeFileSync(file, 'original');
    __setBackupReaderForTests(async () => { throw new Error('denied'); });
    __setClientFactory(scriptedFactory([
      action('write_file', { path: 'protected.txt', content: 'must-not-write' }),
      done(),
    ]));
    const { id } = startTask({ task: '尝试覆盖', workspace, autonomy: 'auto' });
    const view = await waitFor(id, terminal);
    assert.equal(readFileSync(file, 'utf8'), 'original');
    assert.equal(view.steps[0].status, 'failed');
    assert.match(view.steps[0].error ?? '', /无法在修改前备份/);
    assert.equal(view.canUndo, false);
  });

  it('清理 timer 不阻止进程退出，UI 会处理 404、诚实撤回并主动刷新终态卡', () => {
    assert.equal(__taskCleanupTimerHasRefForTests(), false);
    const testDir = dirname(fileURLToPath(import.meta.url));
    const html = readFileSync(join(testDir, '..', 'src', 'web', 'index.html'), 'utf8');
    assert.match(html, /response\.status === 404/);
    assert.match(html, /setAgentComposerBusy\(false\)/);
    assert.match(html, /await Promise\.all\(\[loadSessions\(\), loadHistory\(\)\]\)/);
    assert.match(html, /if \(!response\.ok \|\| !r\.ok\)/);
    assert.match(html, /await refreshAgentTaskAfterUndo\(taskId\)/);
    assert.match(html, /renderAgentTask\(view\)/);
    assert.match(html, /s\.argsSummary \|\| agArgsSummary\(s\.args\)/);
    assert.match(html, /async function restoreAgentTask\(/);
    assert.match(html, /localStorage\.setItem\(ACTIVE_AGENT_STORAGE_KEY/);
    assert.match(html, /await restoreAgentTask\(\)/);
    assert.match(html, /setAgentComposerBusy\(true\)/);
    for (const key of [
      '任务临时状态已清理；若任务已完成，结果可在会话记录中查看。',
      '任务结束后约 30 分钟内可撤回；任务较多时可能提前清理。',
      '撤回窗口已过期，或任务较多时临时状态已提前清理。已写入会话的内容不受影响。',
      '部分文件还原失败；失败项仍保留，可稍后重试。',
      '还有一个任务没有结束，已重新接回原任务；不能同时启动第二个任务。',
      '已重新接回未完成的任务。',
      '上次任务因应用重启或临时状态清理而中断，请重新发送。',
      '请在 10 分钟内确认；超时后任务会自动停止。',
    ]) {
      assert.match(html, new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': '[^']+'`));
    }

    const server = readFileSync(join(testDir, '..', 'src', 'server.ts'), 'utf8');
    const settledBlock = server.slice(server.indexOf('settled: (taskId)'), server.indexOf('mcpTools:', server.indexOf('settled: (taskId)')));
    assert.match(settledBlock, /agentTaskUserPersisted\.delete\(taskId\)/);
    assert.match(settledBlock, /agentTaskConversations\.delete\(taskId\)/);
    assert.match(server, /const activeTask = agent\.listTasks\(\)\.find/);
    assert.match(server, /sendJson\(res, 409/);
    assert.match(server, /conversationId: agentTaskConversations\.get\(task\.id\)/);
  });
});
