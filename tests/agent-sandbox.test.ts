/**
 * 契约测试 · 套件1 · agent 沙箱 safeResolve + 快照撤回
 *
 * 对着 src/agent.ts 的【当前真实行为】写。safeResolve 未导出，故全部经 agent 驱动路径：
 *   __setClientFactory 注入「脚本化假模型」，按预设 JSON 序列驱动 drive() 走确定性路径，
 *   再用 getTaskView / undoTask 观察结果。
 *
 * 覆盖不变量：
 *  ① 路径逃逸全拒：'..'（读/写）、绝对路径、跨盘符 → 工具抛「越出工作区」，工作区外不留文件。
 *  ② 空工作区调文件工具 → safeResolve 抛护栏错（不落 cwd），cwd 里不留文件。
 *  ③ 工作区内正常写成功；快照撤回：还原被改文件旧内容 + 删掉新建文件。
 *  ④ 指向工作区根本身的路径（绝对=根）合法，list_dir 能列。
 *
 * 跑法：node --test "tests/agent-sandbox.test.ts"（在 D:\MemoWeft\weftmate 下）。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  __setClientFactory,
  startTask,
  getTaskView,
  undoTask,
  type AgentTaskView,
} from '../src/agent.ts';

// ── 脚本化假模型 ─────────────────────────────────────────────
// agent 循环每轮调 client.chat(messages)，我们无视 messages、按预设序列吐 JSON。
// drive() 在启动时同步调用一次 clientFactory()（第一个 await 之前），因此每个 task
// 拿到一份独立、下标从 0 起的 client；序列耗尽后兜底回 done，避免卡到步数上限。
type Reply = string;
function scriptFactory(replies: Reply[]): () => { chat(): Promise<string> } {
  return () => {
    let i = 0;
    return {
      chat: async () =>
        replies[i++] ?? JSON.stringify({ thought: 'end', done: { summary: '兜底结束' } }),
    };
  };
}
const act = (tool: string, args: Record<string, unknown>): Reply =>
  JSON.stringify({ thought: 't', action: { tool, args } });
const done = (summary = 'ok'): Reply => JSON.stringify({ thought: 't', done: { summary } });

// ── 轮询直到任务落终态 ───────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settle(id: string, timeoutMs = 5000): Promise<AgentTaskView> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = getTaskView(id);
    if (v && (v.status === 'done' || v.status === 'failed' || v.status === 'stopped')) return v;
    await sleep(10);
  }
  throw new Error(`任务未落终态：${getTaskView(id)?.status ?? '(无)'}`);
}

// ── 临时工作区管理 ───────────────────────────────────────────
const roots: string[] = [];
function mkWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'weftmate-agent-'));
  roots.push(ws);
  return ws;
}

describe('agent 沙箱 safeResolve + 快照撤回', () => {
  after(() => {
    for (const r of roots) {
      try { rmSync(r, { recursive: true, force: true }); } catch { /* 尽力清理 */ }
    }
  });

  it("'..' 相对逃逸：写文件被拒，工作区外不留文件", async () => {
    __setClientFactory(scriptFactory([act('write_file', { path: '../escape-write.txt', content: 'x' }), done()]));
    const ws = mkWorkspace();
    const outside = join(dirname(ws), 'escape-write.txt'); // resolve(ws,'..') = 父目录

    const { id } = startTask({ task: '写越界文件', workspace: ws, autonomy: 'auto' });
    const v = await settle(id);

    assert.equal(v.status, 'done'); // 逃逸这步失败但 drive 不崩，续到 done
    const step = v.steps[0];
    assert.equal(step.tool, 'write_file');
    assert.equal(step.status, 'failed', '越界写应判失败');
    assert.match(String(step.error), /越出工作区/);
    assert.equal(existsSync(outside), false, '工作区外不该出现文件');
    assert.equal(v.canUndo, false, '被拒的写不产生备份');
  });

  it("'..' 相对逃逸：读文件同样被拒", async () => {
    __setClientFactory(scriptFactory([act('read_file', { path: '../secret.txt' }), done()]));
    const ws = mkWorkspace();

    const { id } = startTask({ task: '读越界文件', workspace: ws, autonomy: 'auto' });
    const v = await settle(id);

    const step = v.steps[0];
    assert.equal(step.tool, 'read_file');
    assert.equal(step.status, 'failed');
    assert.match(String(step.error), /越出工作区/);
  });

  it('绝对路径逃逸：指向工作区外的绝对路径被拒，且不写出文件', async () => {
    const ws = mkWorkspace();
    const absOutside = join(dirname(ws), 'abs-escape.txt'); // 与 ws 同盘、在其父目录（绝对路径）
    __setClientFactory(scriptFactory([act('write_file', { path: absOutside, content: 'nope' }), done()]));

    const { id } = startTask({ task: '绝对路径逃逸', workspace: ws, autonomy: 'auto' });
    const v = await settle(id);

    const step = v.steps[0];
    assert.equal(step.status, 'failed');
    assert.match(String(step.error), /越出工作区/);
    assert.equal(existsSync(absOutside), false);
  });

  it('跨盘符逃逸：另一盘符的绝对路径被拒（Windows relative 带盘符）', async () => {
    const ws = mkWorkspace();
    const wsDrive = /^([A-Za-z]):/.exec(ws)?.[1]?.toUpperCase() ?? 'C';
    const otherDrive = wsDrive === 'C' ? 'D' : 'C';
    const crossDrive = `${otherDrive}:\\weftmate-cross-drive-escape.txt`;
    __setClientFactory(scriptFactory([act('write_file', { path: crossDrive, content: 'nope' }), done()]));

    const { id } = startTask({ task: '跨盘符逃逸', workspace: ws, autonomy: 'auto' });
    const v = await settle(id);

    const step = v.steps[0];
    assert.equal(step.status, 'failed', '跨盘符绝对路径应被拒');
    assert.match(String(step.error), /越出工作区/);
    assert.equal(existsSync(crossDrive), false, '别盘符上不该落文件');
  });

  it('空工作区调文件工具：护栏抛错（不落 cwd）', async () => {
    // 空工作区需至少一个附件才能建任务（否则 startTask 直接抛）。
    __setClientFactory(scriptFactory([act('write_file', { path: 'pwned.txt', content: 'x' }), done()]));
    const cwdTarget = join(process.cwd(), 'pwned.txt');
    assert.equal(existsSync(cwdTarget), false, '前置：cwd 里本不该有 pwned.txt');

    const { id } = startTask({
      task: '没工作区也想写文件',
      workspace: '',
      autonomy: 'auto',
      attachments: [{ name: 'ref.txt', content: '参考内容' }],
    });
    const v = await settle(id);

    assert.equal(v.workspace, '');
    const step = v.steps[0];
    assert.equal(step.status, 'failed');
    assert.match(String(step.error), /没有工作区/);
    assert.equal(existsSync(cwdTarget), false, '护栏必须挡住落到 cwd');
  });

  it('工作区内正常写：成功 + 快照撤回还原旧内容 / 删除新建文件', async () => {
    const ws = mkWorkspace();
    const existing = join(ws, 'existing.txt');
    writeFileSync(existing, 'OLD', 'utf8'); // 改前已存在
    const created = join(ws, 'sub', 'created.txt'); // 新建（含新建子目录）

    __setClientFactory(
      scriptFactory([
        act('write_file', { path: 'existing.txt', content: 'NEW' }),
        act('write_file', { path: 'sub/created.txt', content: 'CREATED' }),
        done('写完了'),
      ]),
    );

    const { id } = startTask({ task: '在工作区里写文件', workspace: ws, autonomy: 'auto' });
    const v = await settle(id);

    assert.equal(v.status, 'done');
    assert.equal(v.steps.length, 2);
    assert.ok(v.steps.every((s) => s.status === 'done'), '两步都应成功');
    assert.equal(readFileSync(existing, 'utf8'), 'NEW', '覆盖生效');
    assert.equal(readFileSync(created, 'utf8'), 'CREATED', '新建生效');
    assert.equal(v.canUndo, true, '有备份 → 可撤回');

    const undo = await undoTask(id);
    assert.equal(undo.ok, true);
    assert.equal(undo.restored, 2, '还原 1 个 + 删除 1 个 = 2');
    assert.equal(undo.ranCommand, false);
    assert.equal(readFileSync(existing, 'utf8'), 'OLD', '被改文件还原到旧内容');
    assert.equal(existsSync(created), false, '新建文件被删除');
    // 撤回后备份已清空 → canUndo 转 false
    assert.equal(getTaskView(id)?.canUndo, false);
  });

  it('指向工作区根本身的路径合法（绝对=根，list_dir 能列）', async () => {
    const ws = mkWorkspace();
    writeFileSync(join(ws, 'inside.txt'), 'hi', 'utf8');
    // 传入等于工作区根的绝对路径：safeResolve 的 rel==='' 分支应放行（不判逃逸）。
    __setClientFactory(scriptFactory([act('list_dir', { path: ws }), done()]));

    const { id } = startTask({ task: '列根目录', workspace: ws, autonomy: 'auto' });
    const v = await settle(id);

    const step = v.steps[0];
    assert.equal(step.tool, 'list_dir');
    assert.equal(step.status, 'done', '根路径应合法、不抛越界');
    assert.match(String(step.result), /inside\.txt/);
  });
});
