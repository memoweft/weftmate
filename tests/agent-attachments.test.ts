/**
 * 套件3 · 上下文附件 —— 契约测试（对着 src/agent.ts 当前真实行为写）
 *
 * 跑法（在 D:\MemoWeft\weftmate 下）：
 *   node --test "tests/agent-attachments.test.ts"
 *
 * 只用 Node 内置 node:test + node:assert/strict，零测试框架依赖（Node 24 原生 type-stripping 直接跑 .ts）。
 * 不改产品源码；靠 __setClientFactory 注入"脚本化"假模型，按预设 JSON 序列确定性驱动 agent 循环。
 *
 * 覆盖不变量：
 *  - 无工作区但有附件 → startTask 成功；read_attachment 能取到附件内容；
 *    文件/命令工具不出现在系统提示、且真被调用时被空工作区护栏挡下。
 *  - 工作区和附件都没有 → startTask 报错。
 *  - 附件数>20 → 截断到 20；单附件>200K 字 → 内容截到 200000（名字截到 200）。
 *  - 工作区 + 附件并存 → 文件工具与 read_attachment 都可用。
 *  - buildSystemPrompt（经系统提示观察）：无工作区时只给 read_attachment、明说"这次没有工作区"。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  startTask,
  getTaskView,
  __setClientFactory,
  type AgentTaskView,
} from '../src/agent.ts';

// ── 脚本化假模型：每次 chat 从预设序列取一段 JSON 返回，并把当次收到的 messages 快照进 capture ──
type MsgSnap = { role: string; content: string | unknown[] };
interface Capture { calls: MsgSnap[][] }

/** 注入假模型工厂：replies 用尽后重复最后一句（务必让最后一句是 done，否则会跑到步数上限）。 */
function useScript(replies: string[], capture?: Capture): void {
  __setClientFactory(() => {
    let i = 0;
    return {
      async chat(messages: Array<{ role: string; content: string | unknown[] }>): Promise<string> {
        capture?.calls.push(messages.map((m) => ({ role: m.role, content: m.content })));
        const r = replies[Math.min(i, replies.length - 1)];
        i += 1;
        return r;
      },
    };
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 轮询等任务进入终态（done/failed/stopped）。附件套件全走只读工具，不会停在 awaiting。 */
async function waitDone(id: string, timeoutMs = 4000): Promise<AgentTaskView> {
  const start = Date.now();
  for (;;) {
    const v = getTaskView(id);
    if (v && (v.status === 'done' || v.status === 'failed' || v.status === 'stopped')) return v;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等任务超时，status=${v?.status ?? '(无此任务)'}`);
    }
    await delay(5);
  }
}

const doneReply = (summary = 'ok') => JSON.stringify({ thought: 'done', done: { summary } });
const actReply = (tool: string, args: Record<string, unknown> = {}) =>
  JSON.stringify({ thought: `调用 ${tool}`, action: { tool, args } });

describe('套件3 · 上下文附件（agent.ts）', () => {
  // 临时工作区（给"工作区+附件并存"用）
  let ws = '';
  before(() => {
    ws = mkdtempSync(join(tmpdir(), 'weftmate-attach-'));
    writeFileSync(join(ws, 'hello.txt'), 'workspace file body', 'utf8');
  });
  after(() => {
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
  });

  it('无工作区但有附件 → startTask 成功、read_attachment 取到内容、系统提示不含文件/命令工具', async () => {
    const cap: Capture = { calls: [] };
    useScript([actReply('read_attachment', { name: 'notes.txt' }), doneReply('已读附件')], cap);

    const { id } = startTask({
      task: '读一下 notes.txt 里的秘密数字',
      workspace: '',
      autonomy: 'auto',
      attachments: [{ name: 'notes.txt', content: '秘密数字是 42' }],
    });
    const v = await waitDone(id);

    // 无工作区也能起任务并跑完
    assert.equal(v.status, 'done');
    assert.deepEqual(v.attachments, ['notes.txt']);

    // read_attachment 从 task.attachments 取到内容（截断上限内原样返回）
    const step = v.steps.find((s) => s.tool === 'read_attachment');
    assert.ok(step, '应有 read_attachment 步骤');
    assert.equal(step!.status, 'done');
    assert.equal(step!.mutating, false, 'read_attachment 是只读工具');
    assert.match(step!.result ?? '', /秘密数字是 42/);

    // 系统提示（chat 第一次收到的 messages[0]）不列文件/命令工具，只给 read_attachment
    const sys = cap.calls[0][0].content;
    assert.equal(cap.calls[0][0].role, 'system');
    assert.match(sys, /read_attachment/);
    assert.doesNotMatch(sys, /list_dir/);
    assert.doesNotMatch(sys, /read_file/);
    assert.doesNotMatch(sys, /write_file/);
    assert.doesNotMatch(sys, /run_command/);
  });

  it('无工作区下即便模型调用文件工具，也被空工作区护栏挡下（步骤失败、任务仍能收尾）', async () => {
    // read_file 是只读工具（auto 档自动执行、无需批准），但 safeResolve 在空工作区直接抛错
    useScript([actReply('read_file', { path: 'anything.txt' }), doneReply('换个做法')]);

    const { id } = startTask({
      task: '试图读工作区文件',
      workspace: '',
      autonomy: 'auto',
      attachments: [{ name: 'ref.md', content: 'x' }],
    });
    const v = await waitDone(id);

    const step = v.steps.find((s) => s.tool === 'read_file');
    assert.ok(step, '应有 read_file 步骤（模型调用了它）');
    assert.equal(step!.status, 'failed', '空工作区护栏应让该步失败');
    assert.match(step!.error ?? '', /没有工作区/);
    // 错误喂回后模型回 done，任务照常收尾
    assert.equal(v.status, 'done');
  });

  it('工作区和附件都没有 → startTask 报错', () => {
    assert.throws(
      () => startTask({ task: '干点啥', workspace: '', autonomy: 'auto' }),
      /先选个工作区，或附一个参考文件/,
    );
    // 顺带：空任务描述也报错
    assert.throws(
      () => startTask({ task: '   ', workspace: '', autonomy: 'auto', attachments: [{ name: 'a', content: 'b' }] }),
      /任务描述不能为空/,
    );
  });

  it('附件数 > 20 → 截断到 20 个（保留前 20）', async () => {
    useScript([doneReply()]);
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `f${i}.txt`, content: `c${i}` }));

    const { id } = startTask({ task: '一堆附件', workspace: '', autonomy: 'auto', attachments: many });
    const v = await waitDone(id);

    assert.equal(v.attachments.length, 20);
    assert.equal(v.attachments[0], 'f0.txt');
    assert.equal(v.attachments[19], 'f19.txt');
    assert.ok(!v.attachments.includes('f20.txt'), '第 21 个应被丢弃');
  });

  it('单附件 > 200K 字 → 内容截到 200000；超长名字截到 200', async () => {
    const cap: Capture = { calls: [] };
    useScript([doneReply()], cap);

    const longName = 'n'.repeat(300);         // > 200
    const bigContent = 'a'.repeat(200_001);    // > MAX_ATTACH_CHARS(200000)

    const { id } = startTask({
      task: '超大附件',
      workspace: '',
      autonomy: 'auto',
      attachments: [{ name: longName, content: bigContent }],
    });
    await waitDone(id);

    // 名字截到 200（view 暴露名字）
    const v = getTaskView(id)!;
    assert.equal(v.attachments[0].length, 200);

    // C5：内容截到 200000，且系统提示的附件清单【显式标注】"已从 200001 字截断"（不再静默丢后半段）。
    const sys = cap.calls[0][0].content;
    assert.match(sys, /200000 字·已从 200001 字截断/);
  });

  it('工作区 + 附件并存 → 文件工具与 read_attachment 都可用', async () => {
    const cap: Capture = { calls: [] };
    useScript(
      [
        actReply('list_dir', {}),                     // 列工作区
        actReply('read_attachment', { name: 'spec.md' }), // 读附件
        doneReply('都读到了'),
      ],
      cap,
    );

    const { id } = startTask({
      task: '结合工作区和附件',
      workspace: ws,
      autonomy: 'auto',
      attachments: [{ name: 'spec.md', content: '这是附件规格说明' }],
    });
    const v = await waitDone(id);
    assert.equal(v.status, 'done');
    assert.equal(v.workspace, ws);

    const ls = v.steps.find((s) => s.tool === 'list_dir');
    assert.ok(ls, '应有 list_dir 步骤');
    assert.equal(ls!.status, 'done');
    assert.match(ls!.result ?? '', /hello\.txt/, 'list_dir 应看到工作区里的文件');

    const ra = v.steps.find((s) => s.tool === 'read_attachment');
    assert.ok(ra, '应有 read_attachment 步骤');
    assert.equal(ra!.status, 'done');
    assert.match(ra!.result ?? '', /这是附件规格说明/);

    // 系统提示应同时列出文件工具与 read_attachment
    const sys = cap.calls[0][0].content;
    assert.match(sys, /list_dir/);
    assert.match(sys, /read_file/);
    assert.match(sys, /write_file/);
    assert.match(sys, /run_command/);
    assert.match(sys, /read_attachment/);
    assert.match(sys, new RegExp(ws.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '应写明工作区路径');
  });

  it('buildSystemPrompt（经系统提示观察）：无工作区时只给 read_attachment、明说"这次没有工作区"', async () => {
    const cap: Capture = { calls: [] };
    useScript([doneReply()], cap);

    const { id } = startTask({
      task: '只看附件回答',
      workspace: '',
      autonomy: 'auto',
      attachments: [{ name: 'doc.txt', content: '内容若干' }],
    });
    await waitDone(id);

    const sys = cap.calls[0][0].content;
    assert.match(sys, /这次没有工作区/);
    assert.match(sys, /read_attachment/);
    // 明确不给文件/命令工具
    assert.doesNotMatch(sys, /list_dir/);
    assert.doesNotMatch(sys, /read_file/);
    assert.doesNotMatch(sys, /write_file/);
    assert.doesNotMatch(sys, /run_command/);
    // 附件清单里带上附件名与字数
    assert.match(sys, /doc\.txt/);
    assert.match(sys, /（4 字）/); // '内容若干' = 4 字
  });

  it('图片附件作为 vision content part 直接进入模型请求，不伪装成文本文件', async () => {
    const cap: Capture = { calls: [] };
    useScript([doneReply('看到了图片')], cap);
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    const { id } = startTask({
      task: '看看这张图',
      workspace: '',
      autonomy: 'auto',
      attachments: [{ name: 'screen.png', kind: 'image', mime: 'image/png', dataUrl }],
    });
    const view = await waitDone(id);

    assert.equal(view.status, 'done');
    assert.deepEqual(view.attachments, ['screen.png']);
    const firstCall = cap.calls[0];
    const sys = firstCall[0].content as string;
    assert.match(sys, /参考图片/);
    assert.match(sys, /screen\.png/);
    assert.doesNotMatch(sys, /read_attachment/, '只有图片时不应暴露文本附件工具');

    const user = firstCall.findLast((message) => message.role === 'user');
    assert.ok(user && Array.isArray(user.content), '图片任务的 user content 应是多模态 parts');
    const parts = user!.content as Array<Record<string, unknown>>;
    assert.equal(parts[0].type, 'text');
    assert.equal(parts[1].type, 'image_url');
    assert.deepEqual(parts[1].image_url, { url: dataUrl, detail: 'auto' });
  });

  it('视觉模型直接返回自然语言时按普通回答完成，不误报格式失败', async () => {
    const cap: Capture = { calls: [] };
    useScript(['这张图片是一段聊天记录，主要在讨论学习安排。'], cap);

    const { id } = startTask({
      task: '分析一下这张聊天截图',
      workspace: '',
      autonomy: 'auto',
      attachments: [{
        name: 'chat.png', kind: 'image', mime: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }],
    });
    const view = await waitDone(id);

    assert.equal(view.status, 'done');
    assert.equal(view.summary, '这张图片是一段聊天记录，主要在讨论学习安排。');
    assert.equal(view.note, undefined);
    assert.equal(view.steps.length, 0);
    assert.equal(cap.calls.length, 1, '自然语言图片回答不应再机械重试');
  });

  it('伪造或不支持格式的图片会被后端丢弃', () => {
    assert.throws(
      () => startTask({
        task: '看图', workspace: '', autonomy: 'auto',
        attachments: [{ name: 'bad.svg', kind: 'image', mime: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }],
      }),
      /先选个工作区，或附一个参考文件/,
    );
  });
});
