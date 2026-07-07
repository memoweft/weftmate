/**
 * WeftMate · agent 干活后端核心（阶段2·「帮你干活」第①块 · 方案 B：Host 自建循环）
 *
 * 为什么是 Host 自己搭、而不是走 memoweft：库的聊天是【文字进文字出】的黑盒（LLMClient.chat(messages)→string），
 *   没有让模型"发起工具调用"的口子；插件系统也只能"交观察 / 读记忆"，不能执行工具。库 README 自己写死分工：
 *   "库给相关记忆，宿主决定怎么用（回话 / 调工具 / agent）"。所以 agent 循环整个在 Host（本文件），
 *   memoweft 只当记忆底座、源码一行不碰（红线）。
 *
 * 怎么让模型"调工具"而不依赖模型支持 tool_use 接口：用【文字协议】——系统提示里教模型每轮只回一个 JSON
 *   （{"action":{"tool","args"}} 或 {"done":{"summary"}}），我们解析这段 JSON 去执行工具、把结果当"观察"喂回，
 *   循环到 done。任何 OpenAI 兼容端点都能跑，不挑模型（守"面向大众 BYOK"）。LLM 用库导出的 OpenAICompatClient，
 *   读的是当前激活模型（injectEnv 保持 env 最新），与聊天/记忆链路互不干扰——agent 的中间对话不进 memoweft 的记忆。
 *
 * 信任框架（PRODUCT.md「agent 干活」四件套）：
 *   - 三档自主度：suggest 只建议（只出计划、一步不执行）/ ask 问一下（每个改动步骤先批准）/ auto 放手做（自动跑但每步可见）。
 *   - 沙箱：所有文件操作路径【锁死在工作区文件夹内】，逃逸路径直接拒（safeResolve）。run_command 无法完全沙箱
 *       （shell 能 cd 出去），故【不管哪档，跑命令一律要显式批准】——这是安全底线。
 *   - 每步可视：每个工具调用 = 一个 AgentStep，状态流转（awaiting/running/done/failed/rejected），前端轮询渲染步骤卡。
 *   - 一键撤回：改文件前先备份该文件原内容（不存在则记 null）；撤回=还原/删除。⚠ 跑命令的副作用（装包/删东西）撤不回，
 *       如实向用户标注（ranCommand）。
 *
 * 记忆接线（可选注入，见 configureAgentDeps）：开工前 recall 一点"关于用户"喂给 agent；干完把"你让我做了X"回写画像，
 *   让干活也进"越用越懂"的循环。两者都由 server 注入闭包（引用模块级 core，热重建后自然指向新实例），本文件不 import core。
 *
 * 隐私：工作区里的文件内容 / 命令输出会随请求发给【用户配置的模型】（可能是云端）——这是"帮你干活"绕不开的，
 *   由用户主动发起任务即视为同意（与"感知 observed 默认不上云"是两码事）。界面会写明。
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { OpenAICompatClient, loadLLMConfig, type ChatMessage } from 'memoweft';

// ── 常量护栏 ──
const MAX_STEPS = 20;              // 单个任务最多几步（挡模型跑飞、无限循环）
const MAX_PARSE_FAILS = 3;         // 连续几次解析不出 JSON 就放弃（挡模型一直不按格式回）
const CMD_TIMEOUT_MS = 60_000;     // 单条命令最长跑多久
const OUT_CHARS = 4_000;           // 工具结果喂回模型时的截断上限（防撑爆上下文）
const READ_CHARS = 8_000;          // read_file 读回的字符上限

// ── 对外类型 ──
export type Autonomy = 'suggest' | 'ask' | 'auto';
export type StepStatus = 'proposed' | 'awaiting' | 'running' | 'done' | 'failed' | 'rejected';
export type TaskStatus = 'planning' | 'running' | 'awaiting' | 'done' | 'failed' | 'stopped';

export interface AgentStep {
  id: string;
  index: number;             // 第几步（0 起）
  tool: string;
  args: Record<string, unknown>;
  thought?: string;          // 模型这步的想法（透明化，给用户看）
  status: StepStatus;
  mutating: boolean;         // 是否改动文件系统（决定要不要备份/能不能撤回）
  result?: string;           // 结果摘要（给用户看的精简版）
  error?: string;
  ts: string;
}

/** 给前端的安全视图（不含 messages/backups/gate 等内部状态）。 */
export interface AgentTaskView {
  id: string;
  task: string;
  workspace: string;
  autonomy: Autonomy;
  status: TaskStatus;
  steps: AgentStep[];
  summary?: string;          // done 时模型的总结 / suggest 的方案说明
  note?: string;             // 额外提示（到步数上限 / 撤回不完全等）
  canUndo: boolean;          // 有备份可还原
  ranCommand: boolean;       // 跑过命令（撤回不完全的提示）
  createdAt: string;
}

// ── 内部任务态 ──
interface Task {
  id: string;
  task: string;
  workspace: string;         // 绝对路径（已校验是存在的目录）
  autonomy: Autonomy;
  status: TaskStatus;
  steps: AgentStep[];
  summary?: string;
  note?: string;
  createdAt: string;
  // 内部：
  messages: ChatMessage[];               // agent 自己的对话历史（不进 memoweft）
  backups: Map<string, string | null>;   // 路径 → 改前内容（null=改前不存在）；撤回据此还原
  ranCommand: boolean;
  stopped: boolean;
  gate?: (decision: 'approve' | 'reject') => void;  // 等待批准时的 resolver
}

// 活跃任务表（单用户单进程，模块级即可）。
const tasks = new Map<string, Task>();

// ── 记忆接线（server 注入；不 import core，保持解耦 + 热重建自然跟随）──
interface AgentDeps {
  recall?: (query: string) => Promise<string>;               // 捞"关于用户"的背景，返回一段纯文本（空串=没有/失败）
  record?: (taskText: string, summary: string) => Promise<void>; // 干完把结果回写记忆
}
let deps: AgentDeps = {};
export function configureAgentDeps(d: AgentDeps): void { deps = d; }

// ── 沙箱：把用户/模型给的路径锁死在工作区内 ──
/** 解析并校验路径必须落在工作区内，否则抛错。绝对路径 / .. 逃逸一律拒。 */
function safeResolve(workspace: string, p: unknown): string {
  const raw = String(p ?? '').trim();
  const abs = resolve(workspace, raw);          // 相对工作区解析；raw 若是绝对路径会覆盖 workspace（下面 relative 会揪出来）
  const rel = relative(workspace, abs);
  if (rel === '' ) return abs;                   // 指向工作区根本身
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路径越出工作区：${raw}`);   // 越界（含跨盘符：Windows 下 relative 会返回带盘符的绝对路径）
  }
  return abs;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n…（省略 ${s.length - n} 字）` : s;
}

// ── 工具集（内置四个·全部锁在工作区）──
interface ToolDef {
  mutating: boolean;
  alwaysApprove?: boolean;                        // 不管哪档自主度都要显式批准（run_command）
  run(args: Record<string, unknown>, task: Task): Promise<string>;
}

const TOOLS: Record<string, ToolDef> = {
  // 列目录（只读）
  list_dir: {
    mutating: false,
    async run(args, task) {
      const dir = safeResolve(task.workspace, args.path ?? '.');
      const entries = await readdir(dir, { withFileTypes: true });
      if (entries.length === 0) return '（空目录）';
      return entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join('\n');
    },
  },
  // 读文件（只读）
  read_file: {
    mutating: false,
    async run(args, task) {
      const file = safeResolve(task.workspace, args.path);
      const content = await readFile(file, 'utf8');
      return truncate(content, READ_CHARS);
    },
  },
  // 写文件（改动 → 先备份原内容）
  write_file: {
    mutating: true,
    async run(args, task) {
      const file = safeResolve(task.workspace, args.path);
      const content = String(args.content ?? '');
      await backupBeforeWrite(task, file);       // 撤回用：记下改前状态
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
      return `已写入 ${relative(task.workspace, file) || args.path}（${content.length} 字）`;
    },
  },
  // 跑命令（改动 + 永远要批准）：cwd=工作区，但 shell 能 cd 出去，所以是"逃生口"、必须显式批准。
  run_command: {
    mutating: true,
    alwaysApprove: true,
    async run(args, task) {
      const command = String(args.command ?? '').trim();
      if (!command) throw new Error('命令为空');
      task.ranCommand = true;                    // 标记：撤回不完全（命令副作用还原不了）
      return await runShell(command, task.workspace);
    },
  },
};

/** 写文件前备份原内容（同一任务内每个路径只备份第一次的状态，撤回还原到任务开始前）。 */
async function backupBeforeWrite(task: Task, file: string): Promise<void> {
  if (task.backups.has(file)) return;            // 已备份过原始态，别被后续写覆盖
  if (existsSync(file)) {
    try { task.backups.set(file, await readFile(file, 'utf8')); }
    catch { task.backups.set(file, null); }       // 读不出（二进制/权限）→ 当作无法还原的新建，撤回时删掉
  } else {
    task.backups.set(file, null);                // 改前不存在 → 撤回时删除
  }
}

/** 在工作区里跑一条命令，收 stdout+stderr（合并截断），带超时。 */
function runShell(command: string, cwd: string): Promise<string> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, { cwd, shell: true });
    let out = '';
    const push = (b: Buffer) => { out += b.toString('utf8'); };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    const timer = setTimeout(() => {
      child.kill();
      out += `\n（超时 ${CMD_TIMEOUT_MS / 1000}s，已终止）`;
    }, CMD_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise(truncate(out.trim() || '（无输出）', OUT_CHARS) + `\n[退出码 ${code ?? '?'}]`);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolvePromise(`命令启动失败：${e.message}`);
    });
  });
}

// ── 文字协议：解析模型回的 JSON ──
interface Parsed {
  thought?: string;
  tool?: string;
  args?: Record<string, unknown>;
  done?: boolean;
  summary?: string;
}
/** 从模型回复里抠出第一个 JSON 对象并解析（容忍 ```json 围栏、前后废话）。解析不出返回 null。 */
function parseAction(reply: string): Parsed | null {
  let s = reply.trim();
  // 剥 ```json ... ``` 围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 取第一个 { 到最后一个 }（模型有时前后加话）
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(s.slice(first, last + 1)); }
  catch { return null; }
  const thought = typeof obj.thought === 'string' ? obj.thought : undefined;
  if (obj.done && typeof obj.done === 'object') {
    return { thought, done: true, summary: String((obj.done as Record<string, unknown>).summary ?? '') };
  }
  if (obj.action && typeof obj.action === 'object') {
    const a = obj.action as Record<string, unknown>;
    return { thought, tool: String(a.tool ?? ''), args: (a.args as Record<string, unknown>) ?? {} };
  }
  return null;
}

// ── 系统提示 ──
function buildSystemPrompt(workspace: string, memoryNote: string): string {
  const mem = memoryNote ? `\n关于用户你已知道（供参考，别乱用）：\n${memoryNote}\n` : '';
  return `你是 WeftMate 里的干活助手，在用户指定的【工作区文件夹】里帮 ta 完成任务。
工作区：${workspace}
所有文件路径都相对工作区，且【不能超出工作区】（别用绝对路径、别用 .. 逃出去）。
${mem}
你能用这些工具，每次回复【只做一件事】：
- list_dir(path)             列目录（path 省略=工作区根）
- read_file(path)            读文件
- write_file(path, content)  新建或覆盖文件
- run_command(command)       在工作区里跑一条命令（如 npm test）

【回复格式】每次只回一个 JSON 对象，别加任何其它文字、别加 markdown 围栏：
· 要执行一步：{"thought":"简短说明你要干嘛（用用户的语言）","action":{"tool":"工具名","args":{…}}}
· 任务做完：{"thought":"…","done":{"summary":"给用户的简短总结（用用户的语言）"}}

规则：
- 一次只回一个 action，等我把结果给你，再决定下一步。
- 改文件前先 read_file 看清楚，别凭空臆造内容。
- 路径必须在工作区内。
- 信息够了、任务完成了，就回 done，别画蛇添足。`;
}

// ── 启动任务 ──
export function startTask(input: { task: string; workspace: string; autonomy: Autonomy }): { id: string } {
  const task = String(input.task ?? '').trim();
  const workspace = String(input.workspace ?? '').trim();
  if (!task) throw new Error('任务描述不能为空');
  if (!workspace || !existsSync(workspace) || !statSync(workspace).isDirectory()) {
    throw new Error('工作区文件夹不存在或不是目录');
  }
  const autonomy: Autonomy = input.autonomy === 'ask' || input.autonomy === 'auto' ? input.autonomy : 'suggest';
  const id = 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const t: Task = {
    id, task, workspace, autonomy,
    status: autonomy === 'suggest' ? 'planning' : 'running',
    steps: [], createdAt: new Date().toISOString(),
    messages: [], backups: new Map(), ranCommand: false, stopped: false,
  };
  tasks.set(id, t);
  if (autonomy === 'suggest') void plan(t);       // 只建议：出方案、不执行
  else void drive(t);                             // 问一下 / 放手做：进执行循环
  return { id };
}

/** 只建议模式：单次调用出一份计划（不执行任何工具），渲染成 proposed 步骤卡。 */
async function plan(t: Task): Promise<void> {
  try {
    const client = mkClient();
    const memNote = deps.recall ? await safeRecall(t.task) : '';
    const sys = buildSystemPrompt(t.workspace, memNote) +
      `\n\n【本次只出计划】用户选了"只建议"，所以你【不要执行】，只回一个 JSON：
{"summary":"整体思路（用用户的语言）","plan":[{"tool":"工具名","args":{…},"why":"这步为啥"}]}`;
    const reply = await client.chat([
      { role: 'system', content: sys },
      { role: 'user', content: t.task },
    ]);
    const obj = extractJson(reply);
    if (obj && Array.isArray(obj.plan)) {
      t.summary = String(obj.summary ?? '这是建议方案，没有执行任何操作。');
      (obj.plan as Array<Record<string, unknown>>).forEach((p, i) => {
        t.steps.push({
          id: `${t.id}-s${i}`, index: i,
          tool: String(p.tool ?? '?'), args: (p.args as Record<string, unknown>) ?? {},
          thought: typeof p.why === 'string' ? p.why : undefined,
          status: 'proposed', mutating: !!TOOLS[String(p.tool)]?.mutating, ts: new Date().toISOString(),
        });
      });
    } else {
      t.summary = reply.trim();                    // 模型没按格式回 → 直接把它的话当方案展示
    }
    t.note = '这是建议方案，没有执行任何操作。要真做请换"问一下"或"放手做"。';
    t.status = 'done';
  } catch (e) {
    t.status = 'failed';
    t.note = errMsg(e);
  }
}

/** 执行循环（ask / auto）：模型出一步 → 按自主度决定是否要批准 → 执行 → 结果喂回 → 循环到 done。 */
async function drive(t: Task): Promise<void> {
  try {
    const client = mkClient();
    const memNote = deps.recall ? await safeRecall(t.task) : '';
    t.messages = [
      { role: 'system', content: buildSystemPrompt(t.workspace, memNote) },
      { role: 'user', content: t.task },
    ];
    let parseFails = 0;

    for (let i = 0; i < MAX_STEPS; i++) {
      if (t.stopped) { t.status = 'stopped'; return; }

      const reply = await client.chat(t.messages);
      t.messages.push({ role: 'assistant', content: reply });
      const parsed = parseAction(reply);

      if (!parsed) {
        if (++parseFails >= MAX_PARSE_FAILS) {
          t.status = 'failed'; t.note = '模型没按格式回复，放弃。'; return;
        }
        t.messages.push({ role: 'user', content: '你的回复我解析不了。请【只回一个 JSON 对象】（action 或 done），别加其它文字。' });
        continue;
      }
      parseFails = 0;

      if (parsed.done) {
        t.summary = parsed.summary || '完成。';
        t.status = 'done';
        await safeRecord(t);                       // 回写记忆：进"越用越懂"循环
        return;
      }

      const tool = TOOLS[parsed.tool ?? ''];
      if (!tool) {
        // 未知工具：把可用清单喂回，让它改（不算失败）。
        t.messages.push({ role: 'user', content: `没有工具「${parsed.tool}」。可用：list_dir / read_file / write_file / run_command。` });
        continue;
      }

      const step: AgentStep = {
        id: `${t.id}-s${i}`, index: i,
        tool: parsed.tool!, args: parsed.args ?? {},
        thought: parsed.thought, status: 'running',
        mutating: tool.mutating, ts: new Date().toISOString(),
      };
      t.steps.push(step);

      // 审批门：命令永远要批；ask 档下所有改动要批；只读永远自动。
      const needApprove = !!tool.alwaysApprove || (t.autonomy === 'ask' && tool.mutating);
      if (needApprove) {
        step.status = 'awaiting';
        t.status = 'awaiting';
        const decision = await waitGate(t);
        if (t.stopped || decision === 'reject') {
          step.status = 'rejected';
          if (t.stopped) { t.status = 'stopped'; return; }
          t.status = 'running';
          t.messages.push({ role: 'user', content: `用户拒绝了这步（${tool ? parsed.tool : ''}）。换个做法，或直接 done 收尾。` });
          continue;
        }
        t.status = 'running';
      }

      // 执行
      step.status = 'running';
      try {
        const result = await tool.run(step.args, t);
        step.result = truncate(result, OUT_CHARS);
        step.status = 'done';
        t.messages.push({ role: 'user', content: `[工具结果 ${parsed.tool}]\n${step.result}` });
      } catch (e) {
        step.error = errMsg(e);
        step.status = 'failed';
        t.messages.push({ role: 'user', content: `[工具出错 ${parsed.tool}] ${step.error}` });
      }
    }

    // 到步数上限还没 done
    if (t.status !== 'done') {
      t.status = 'failed';
      t.note = `到达步数上限（${MAX_STEPS} 步）还没完成，先停下。`;
    }
  } catch (e) {
    t.status = 'failed';
    t.note = errMsg(e);
  }
}

// ── 批准 / 停止 / 撤回 ──
/** 等待用户批准：把 resolver 挂到 task.gate，/approve 或 /stop 来唤醒。 */
function waitGate(t: Task): Promise<'approve' | 'reject'> {
  return new Promise((res) => { t.gate = res; });
}

/** 批准/拒绝当前挂起的那一步。返回是否确实有挂起的步骤被处理。 */
export function decideStep(taskId: string, decision: 'approve' | 'reject'): boolean {
  const t = tasks.get(taskId);
  if (!t || !t.gate) return false;
  const g = t.gate; t.gate = undefined;
  g(decision);
  return true;
}

/** 叫停任务：置 stopped，并唤醒可能挂起的审批门（当拒绝处理）。 */
export function stopTask(taskId: string): boolean {
  const t = tasks.get(taskId);
  if (!t) return false;
  t.stopped = true;
  if (t.gate) { const g = t.gate; t.gate = undefined; g('reject'); }
  return true;
}

/** 一键撤回：还原本任务改过的所有文件（改前不存在的删掉）。命令副作用还原不了，ranCommand 已如实标注。 */
export async function undoTask(taskId: string): Promise<{ ok: boolean; restored: number; ranCommand: boolean }> {
  const t = tasks.get(taskId);
  if (!t) return { ok: false, restored: 0, ranCommand: false };
  let restored = 0;
  for (const [file, prior] of t.backups) {
    try {
      if (prior === null) { if (existsSync(file)) { await rm(file); restored++; } }
      else { await writeFile(file, prior, 'utf8'); restored++; }
    } catch { /* 单个文件还原失败不阻断其余（如已被外部删/锁） */ }
  }
  t.backups.clear();
  t.note = `已撤回：还原 ${restored} 个文件${t.ranCommand ? '（注意：跑过命令，命令造成的其它变化撤不回）' : ''}。`;
  return { ok: true, restored, ranCommand: t.ranCommand };
}

// ── 视图 / 查询（给 server 端点）──
export function getTaskView(taskId: string): AgentTaskView | null {
  const t = tasks.get(taskId);
  return t ? toView(t) : null;
}
export function listTasks(): AgentTaskView[] {
  return [...tasks.values()].map(toView).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
function toView(t: Task): AgentTaskView {
  return {
    id: t.id, task: t.task, workspace: t.workspace, autonomy: t.autonomy,
    status: t.status, steps: t.steps, summary: t.summary, note: t.note,
    canUndo: t.backups.size > 0, ranCommand: t.ranCommand, createdAt: t.createdAt,
  };
}

// ── 内部小工具 ──
type ChatClient = { chat(messages: ChatMessage[]): Promise<string> };
// LLM 客户端工厂（可注入）：默认用当前激活模型（env 已由 configStore.injectEnv 保持最新），temperature=0 让工具调用更稳。
//   loadLLMConfig 缺配会抛（"没配模型"），由 driver/plan 的 try/catch 兜成任务失败、不崩进程。
let clientFactory: () => ChatClient = () => new OpenAICompatClient({ ...loadLLMConfig(), temperature: 0 });
/** 仅测试用：注入假模型确定性地驱动循环，冒烟沙箱/撤回等安全逻辑（不碰生产路径；生产永远走默认工厂）。 */
export function __setClientFactory(f: () => ChatClient): void { clientFactory = f; }
function mkClient(): ChatClient { return clientFactory(); }
async function safeRecall(query: string): Promise<string> {
  try { return (await deps.recall!(query)) || ''; } catch { return ''; }
}
async function safeRecord(t: Task): Promise<void> {
  if (!deps.record) return;
  try { await deps.record(t.task, t.summary ?? ''); } catch { /* 回写记忆失败不影响任务结果 */ }
}
/** plan 模式用的宽松 JSON 抠取（同 parseAction 的剥壳逻辑，但返回原始对象）。 */
function extractJson(reply: string): Record<string, unknown> | null {
  let s = reply.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{'), last = s.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(s.slice(first, last + 1)); } catch { return null; }
}
function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
