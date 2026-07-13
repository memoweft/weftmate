/**
 * 契约测试 · 套件2 — agent 审批门 + 三档自主度
 *
 * 对着 src/agent.ts 的【当前真实行为】写。用注入的脚本化假模型（__setClientFactory）
 * 确定性驱动 agent 循环，覆盖信任框架的安全不变量（agent.ts:438 的 needApprove 逻辑）：
 *   ① run_command（alwaysApprove=true）永远要批准——即便 autonomy='auto' 也停在 awaiting、不自动跑。
 *   ② 拒绝(decideStep 'reject') → 该步不执行；批准('approve') → 才执行（用 write_file 的落盘副作用验证）。
 *   ③ autonomy='ask' 下 write_file(mutating) 要批准；'auto' 下只读工具(list_dir/read_file)不拦、直接跑完。
 *   ④ suggest 档只出计划(proposed 步骤)、不执行任何 mutating（工作区里不落任何文件）。
 *
 * 跑法（在 D:\MemoWeft\weftmate 下）：node --test "tests/agent-approval.test.ts"
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  __setClientFactory,
  configureAgentDeps,
  startTask,
  decideStep,
  stopTask,
  getTaskView,
} from '../src/agent.ts';

// ── 脚本化假模型：chat() 按预设序列依次返回一段 JSON；用尽后兜底返回 done（防循环跑飞）──
function scriptedFactory(responses: string[]): () => { chat: (m: unknown) => Promise<string> } {
  return () => {
    let i = 0;
    return {
      async chat() {
        const r = i < responses.length ? responses[i] : '{"done":{"summary":"fallback-done"}}';
        i++;
        return r;
      },
    };
  };
}

// ── 轮询辅助：drive/plan 是 fire-and-forget 的异步循环，靠轮询 view.status 等它到达目标态 ──
async function waitFor(
  id: string,
  pred: (v: NonNullable<ReturnType<typeof getTaskView>>) => boolean,
  timeoutMs = 3000,
): Promise<NonNullable<ReturnType<typeof getTaskView>>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = getTaskView(id);
    if (v && pred(v)) return v;
    if (Date.now() > deadline) {
      throw new Error(`waitFor 超时；当前 view=${JSON.stringify(v)}`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}
const terminal = (s: string) => s === 'done' || s === 'failed' || s === 'stopped';

let ws: string;
beforeEach(() => {
  // 每个用例一个干净的临时工作区；确保无 deps 干扰（recall/record/mcp 都不接）。
  configureAgentDeps({});
  ws = mkdtempSync(join(tmpdir(), 'weftmate-agent-'));
});
afterEach(() => {
  try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('agent 审批门 + 三档自主度', () => {
  // C1：干完把结果 summary 回写记忆（不只任务意图）——让"帮你干活"进"越用越懂"循环。
  it('C1·done 后 record 被调用，且带上任务的 summary（干成了啥）', async () => {
    const recordCalls: Array<{ task: string; summary: string }> = [];
    configureAgentDeps({ record: async (task, summary) => { recordCalls.push({ task, summary }); } });
    __setClientFactory(scriptedFactory([
      `{"thought":"看看","action":{"tool":"list_dir","args":{"path":"."}}}`,
      `{"done":{"summary":"建好了 3 个文件"}}`,
    ]));

    const { id } = startTask({ task: '帮我建脚手架', workspace: ws, autonomy: 'auto' });
    await waitFor(id, (x) => terminal(x.status));

    assert.equal(recordCalls.length, 1, 'done 后应回写一次记忆');
    assert.equal(recordCalls[0].task, '帮我建脚手架');
    assert.equal(recordCalls[0].summary, '建好了 3 个文件', 'summary(干成了啥) 必须传给 record，不能只记任务意图');
  });

  // 不变量①：run_command 永远要批准，即便 autonomy='auto' 也停在 awaiting、不自动执行。
  it('run_command 在 auto 档也停在 awaiting，且未执行（sentinel 未落盘）', async () => {
    const sentinel = join(ws, 'ran.txt');
    __setClientFactory(scriptedFactory([
      // 模型想跑一条会落盘 sentinel 的命令；因 alwaysApprove，会被审批门挡住不执行。
      `{"thought":"跑命令","action":{"tool":"run_command","args":{"command":"echo x > ran.txt"}}}`,
      `{"done":{"summary":"收尾"}}`,
    ]));

    const { id } = startTask({ task: '跑个命令', workspace: ws, autonomy: 'auto' });

    const v = await waitFor(id, (x) => x.status === 'awaiting');
    const step = v.steps[0];
    assert.equal(step.tool, 'run_command');
    assert.equal(step.status, 'awaiting', 'run_command 必须挂起在 awaiting');
    assert.equal(step.result, undefined, '挂起期间不该有执行结果');
    assert.equal(existsSync(sentinel), false, '命令尚未批准，绝不该已经执行落盘');
    // 存在挂起的门，decideStep 应能唤醒它。
    assert.equal(decideStep(id, 'reject'), true, '有挂起门时 decideStep 应返回 true');

    const done = await waitFor(id, (x) => terminal(x.status));
    assert.equal(done.status, 'done');
    assert.equal(done.steps[0].status, 'rejected', '拒绝后该步应为 rejected');
    assert.equal(existsSync(sentinel), false, '拒绝后命令仍不该执行');
  });

  // 不变量②a：批准 → 才执行（write_file 真落盘）。
  it('ask 档 write_file 批准后才执行、文件落盘', async () => {
    __setClientFactory(scriptedFactory([
      `{"thought":"写文件","action":{"tool":"write_file","args":{"path":"out.txt","content":"hello-approved"}}}`,
      `{"done":{"summary":"写好了"}}`,
    ]));

    const { id } = startTask({ task: '写个文件', workspace: ws, autonomy: 'ask' });

    // ask 档下 write_file 是 mutating → 必须先挂起等批准。
    const awaiting = await waitFor(id, (x) => x.status === 'awaiting');
    assert.equal(awaiting.steps[0].tool, 'write_file');
    assert.equal(awaiting.steps[0].status, 'awaiting');
    assert.equal(existsSync(join(ws, 'out.txt')), false, '批准前不该落盘');

    assert.equal(decideStep(id, 'approve'), true);

    const done = await waitFor(id, (x) => terminal(x.status));
    assert.equal(done.status, 'done');
    assert.equal(done.steps[0].status, 'done', '批准后该步应执行到 done');
    assert.equal(existsSync(join(ws, 'out.txt')), true, '批准后应落盘');
    const { readFileSync } = await import('node:fs');
    assert.equal(readFileSync(join(ws, 'out.txt'), 'utf8'), 'hello-approved');
    assert.equal(done.canUndo, true, '写过文件应有备份可撤回');
  });

  // 不变量②b：拒绝 → 该步不执行（文件不落盘），步骤记为 rejected，循环可继续到 done。
  it('ask 档 write_file 拒绝后不执行、文件不落盘', async () => {
    __setClientFactory(scriptedFactory([
      `{"thought":"写文件","action":{"tool":"write_file","args":{"path":"nope.txt","content":"should-not-exist"}}}`,
      `{"done":{"summary":"改用别的办法，收尾"}}`,
    ]));

    const { id } = startTask({ task: '写个文件', workspace: ws, autonomy: 'ask' });

    await waitFor(id, (x) => x.status === 'awaiting');
    assert.equal(decideStep(id, 'reject'), true);

    const done = await waitFor(id, (x) => terminal(x.status));
    assert.equal(done.status, 'done');
    assert.equal(done.steps[0].status, 'rejected', '拒绝的步应为 rejected');
    assert.equal(existsSync(join(ws, 'nope.txt')), false, '拒绝的写入绝不该落盘');
    assert.equal(done.canUndo, false, '没有真正写入 → 无备份可撤回');
  });

  // 不变量③：auto 档只读工具(list_dir)不拦——直接跑完、从不进 awaiting。
  it('auto 档只读工具(list_dir)不需批准、直接执行', async () => {
    // 工作区里放一个可列的文件，让 list_dir 有确定输出。
    mkdirSync(join(ws, 'sub'));
    __setClientFactory(scriptedFactory([
      `{"thought":"列目录","action":{"tool":"list_dir","args":{"path":"."}}}`,
      `{"done":{"summary":"看完了"}}`,
    ]));

    const { id } = startTask({ task: '看看有啥', workspace: ws, autonomy: 'auto' });

    const done = await waitFor(id, (x) => terminal(x.status));
    assert.equal(done.status, 'done', '只读工具应无需批准直接跑完');
    assert.equal(done.steps[0].tool, 'list_dir');
    assert.equal(done.steps[0].status, 'done', 'list_dir 应直接执行到 done、从不 awaiting');
    assert.ok(String(done.steps[0].result ?? '').includes('sub'), 'list_dir 结果应含子目录');
    // 全程无挂起门：done 后再 decideStep 无门可唤醒 → false。
    assert.equal(decideStep(id, 'approve'), false, '无挂起门时 decideStep 应返回 false');
    assert.equal(done.canUndo, false, '只读不产生备份');
  });

  // 不变量③补充：auto 档 read_file(只读)也不拦。
  it('auto 档 read_file(只读)不需批准、直接读', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(ws, 'a.txt'), 'file-body-here', 'utf8');
    __setClientFactory(scriptedFactory([
      `{"thought":"读文件","action":{"tool":"read_file","args":{"path":"a.txt"}}}`,
      `{"done":{"summary":"读完"}}`,
    ]));

    const { id } = startTask({ task: '读 a.txt', workspace: ws, autonomy: 'auto' });

    const done = await waitFor(id, (x) => terminal(x.status));
    assert.equal(done.status, 'done');
    assert.equal(done.steps[0].status, 'done', 'read_file 应直接执行、不 awaiting');
    assert.ok(String(done.steps[0].result ?? '').includes('file-body-here'));
  });

  // 不变量④：suggest 档只出计划(proposed 步骤)、不执行任何 mutating（工作区不落任何文件）。
  it('suggest 档只出计划、mutating 步骤保持 proposed、不落盘', async () => {
    __setClientFactory(scriptedFactory([
      // plan 模式期望的形状：{summary, plan:[{tool,args,why}]}
      `{"summary":"先建个文件再列目录","plan":[` +
        `{"tool":"write_file","args":{"path":"planned.txt","content":"x"},"why":"建立产物"},` +
        `{"tool":"list_dir","args":{"path":"."},"why":"确认结果"}` +
      `]}`,
    ]));

    const { id } = startTask({ task: '帮我建文件', workspace: ws, autonomy: 'suggest' });

    const done = await waitFor(id, (x) => terminal(x.status));
    assert.equal(done.status, 'done');
    assert.equal(done.summary, '先建个文件再列目录');
    assert.equal(done.steps.length, 2, '应把 plan 渲染成两步');
    // 全部只是"建议"——proposed，绝不执行。
    for (const s of done.steps) {
      assert.equal(s.status, 'proposed', 'suggest 档所有步骤只能是 proposed');
    }
    // mutating 标记应正确算出（write_file=true, list_dir=false）。
    assert.equal(done.steps[0].tool, 'write_file');
    assert.equal(done.steps[0].mutating, true);
    assert.equal(done.steps[1].tool, 'list_dir');
    assert.equal(done.steps[1].mutating, false);
    // 关键安全不变量：一步都没执行，mutating 步骤没落盘。
    assert.equal(existsSync(join(ws, 'planned.txt')), false, 'suggest 档绝不该真的写文件');
    assert.equal(done.canUndo, false, '没执行 → 无备份');
    assert.ok((done.note ?? '').includes('没有执行'), 'note 应声明未执行任何操作');
  });

  // 交叉验证：run_command 即便 autonomy='ask' 也一样挂起（与 write_file 的差别是 alwaysApprove 而非档位）。
  it('run_command 在 ask 档同样挂起，批准后才真正执行', async () => {
    __setClientFactory(scriptedFactory([
      `{"thought":"跑命令","action":{"tool":"run_command","args":{"command":"echo done > cmd.txt"}}}`,
      `{"done":{"summary":"跑完了"}}`,
    ]));

    const { id } = startTask({ task: '跑命令', workspace: ws, autonomy: 'ask' });

    const awaiting = await waitFor(id, (x) => x.status === 'awaiting');
    assert.equal(awaiting.steps[0].tool, 'run_command');
    assert.equal(existsSync(join(ws, 'cmd.txt')), false, '批准前命令不该执行');

    assert.equal(decideStep(id, 'approve'), true);
    const done = await waitFor(id, (x) => terminal(x.status));
    assert.equal(done.status, 'done');
    assert.equal(done.steps[0].status, 'done', '批准后 run_command 应执行到 done');
    assert.equal(done.ranCommand, true, '跑过命令应标记 ranCommand');
  });

  // stopTask 应唤醒挂起的审批门并把任务收成 stopped（不执行该步）。
  it('stopTask 唤醒挂起门、任务变 stopped、该步不执行', async () => {
    __setClientFactory(scriptedFactory([
      `{"thought":"写文件","action":{"tool":"write_file","args":{"path":"stopme.txt","content":"x"}}}`,
    ]));

    const { id } = startTask({ task: '写文件', workspace: ws, autonomy: 'ask' });

    await waitFor(id, (x) => x.status === 'awaiting');
    assert.equal(stopTask(id), true);

    const done = await waitFor(id, (x) => terminal(x.status));
    assert.equal(done.status, 'stopped');
    assert.equal(existsSync(join(ws, 'stopme.txt')), false, 'stop 后不该落盘');
  });
});
