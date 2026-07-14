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

  it('普通回答未调用工具：走 recordChat + complete，不伪装成干活记忆', async () => {
    const workRecords: string[] = [];
    const chatRecords: Array<{ user: string; reply: string }> = [];
    const completions: Array<{ id: string; usedTools: boolean }> = [];
    configureAgentDeps({
      record: async (task) => { workRecords.push(task); },
      recordChat: async (user, reply) => { chatRecords.push({ user, reply }); },
      complete: async (id, _task, _summary, usedTools) => { completions.push({ id, usedTools }); },
    });
    __setClientFactory(scriptedFactory([
      `{"done":{"summary":"你好，有什么想聊的？"}}`,
    ]));

    const { id } = startTask({ task: '你好', workspace: ws, autonomy: 'auto' });
    const done = await waitFor(id, (x) => terminal(x.status));

    assert.equal(done.status, 'done');
    assert.equal(done.steps.length, 0);
    assert.deepEqual(workRecords, [], '没用工具不该写成“帮我干活”记忆');
    assert.deepEqual(chatRecords, [{ user: '你好', reply: '你好，有什么想聊的？' }]);
    assert.deepEqual(completions, [{ id, usedTools: false }]);
  });

  // 回归：纯文本闲聊时模型忽略 JSON 协议、直接说人话，是合法聊天回答，不能当“格式错误”。
  //   旧行为：无图片 → 不走视觉兜底 → 机械重试三次 → 泄漏“模型没按格式回复，放弃。”给用户
  //   （重试提示还会逼模型下一轮向用户道歉“抱歉格式问题”，污染对话）。
  it('纯文本闲聊：模型不按 JSON 直接说人话，按普通回答完成，不重试也不误报格式失败', async () => {
    let calls = 0;
    __setClientFactory(() => ({
      async chat() { calls++; return '就是模型回复没按我们约定的 JSON 格式，其实不影响～'; },
    }));

    const { id } = startTask({ task: '什么格式问题?', workspace: ws, autonomy: 'auto' });
    const done = await waitFor(id, (x) => terminal(x.status));

    assert.equal(done.status, 'done', '闲聊的自然语言回复应正常完成，而不是 failed');
    assert.equal(done.summary, '就是模型回复没按我们约定的 JSON 格式，其实不影响～');
    assert.equal(done.note, undefined, '不该把“模型没按格式回复，放弃”之类内部话术泄漏给用户');
    assert.equal(done.steps.length, 0);
    assert.equal(calls, 1, '首轮自然语言直接当聊天回答，不该机械重试');
  });

  it('人格 getter 每个任务动态读取：切换后下一句话立即使用新人格', async () => {
    const prompts: string[] = [];
    let current = { id: 'plain', name: '普通助手', systemPrompt: '你是普通助手。' };
    configureAgentDeps({ experience: () => current });
    __setClientFactory(() => ({
      async chat(messages: Array<{ role: string; content: string }>) {
        prompts.push(messages[0]?.content ?? '');
        return `{"done":{"summary":"ok"}}`;
      },
    }));

    const first = startTask({ task: '你是谁', workspace: ws, autonomy: 'auto' });
    await waitFor(first.id, (x) => terminal(x.status));
    current = { id: 'xingyao', name: '星瑶', systemPrompt: '你是星瑶，一个温柔的长期伙伴。' };
    const second = startTask({ task: '现在你是谁', workspace: ws, autonomy: 'auto' });
    await waitFor(second.id, (x) => terminal(x.status));

    assert.match(prompts[0], /当前人格：普通助手（plain）/);
    assert.match(prompts[0], /你是普通助手/);
    assert.match(prompts[1], /当前人格：星瑶（xingyao）/);
    assert.match(prompts[1], /你是星瑶，一个温柔的长期伙伴/);
    assert.doesNotMatch(prompts[1], /当前人格：普通助手/);
  });

  it('统一 Agent 会带入当前对话的最近上下文', async () => {
    const calls: Array<Array<{ role: string; content: string }>> = [];
    __setClientFactory(() => ({
      async chat(messages: Array<{ role: string; content: string }>) {
        calls.push(messages.map((m) => ({ role: m.role, content: m.content })));
        return `{"done":{"summary":"我是星瑶。"}}`;
      },
    }));

    const { id } = startTask({
      task: '现在呢？', workspace: ws, autonomy: 'auto',
      context: [
        { role: 'user', content: '你是谁？' },
        { role: 'assistant', content: '我是普通助手。' },
      ],
    });
    await waitFor(id, (x) => terminal(x.status));

    assert.deepEqual(calls[0].slice(1).map((m) => [m.role, m.content]), [
      ['user', '你是谁？'],
      ['assistant', '我是普通助手。'],
      ['user', '现在呢？'],
    ]);
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
    const completions: Array<{ summary: string; usedTools: boolean }> = [];
    configureAgentDeps({
      complete: async (_id, _task, summary, usedTools) => { completions.push({ summary, usedTools }); },
    });
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
    assert.deepEqual(completions, [{ summary: '先建个文件再列目录', usedTools: false }], '建议回复也应持久化，但不能冒充已调用工具');
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
