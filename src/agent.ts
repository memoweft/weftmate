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
 *   - 三档自主度：suggest 只建议（只出计划、一步不执行）/ ask 每次确认（改动与全部外部调用先批准）/
 *       auto 完全访问（自动跑但每步可见；命令与未信任外部工具仍强批）。
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
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { loadLLMConfig, type ChatMessage } from './memoweft.ts';
import { normalizeAutonomy, type Autonomy } from './agent-autonomy.ts';

export { DEFAULT_AUTONOMY, isAutonomy, normalizeAutonomy } from './agent-autonomy.ts';
export type { Autonomy } from './agent-autonomy.ts';

// ── 常量护栏 ──
const MAX_STEPS = 20;              // 单个任务最多几步（挡模型跑飞、无限循环）
const MAX_PARSE_FAILS = 3;         // 连续几次解析不出 JSON 就放弃（挡模型一直不按格式回）
const CMD_TIMEOUT_MS = 60_000;     // 单条命令最长跑多久
const OUT_CHARS = 4_000;           // 工具结果喂回模型时的截断上限（防撑爆上下文）
const READ_CHARS = 8_000;          // read_file / read_attachment 读回的字符上限
const MAX_ATTACHMENTS = 20;        // 单任务最多附几个参考文件
const MAX_ATTACH_CHARS = 200_000;  // 单个附件内容上限（前端也会截；后端兜底防超大）
const MAX_IMAGE_DATA_CHARS = 8_500_000; // 单张图片 data URL 上限（约 6MB 原图）
const MAX_IMAGE_TOTAL_CHARS = 26_000_000; // 单任务图片总量上限，防 loopback 请求把内存撑爆
const MAX_CONTEXT_TURNS = 16;      // 带入统一 Agent 的最近会话轮数
const MAX_CONTEXT_CHARS = 20_000;  // 单轮上下文上限（防历史异常撑爆请求）
const MAX_TASK_TEXT_BYTES = 64 * 1024;       // 单条原始任务上限；超限直接拒绝，不静默截用户意图
const MAX_TERMINAL_FIELD_BYTES = 64 * 1024;  // 终态摘要/备注/步骤文本单项上限
const MAX_TERMINAL_METADATA_BYTES = 4 * 1024 * 1024; // 全部终态轻量视图总上限
const MAX_BACKUP_FILE_BYTES = 8 * 1024 * 1024;       // 单个撤回备份上限
const MAX_TASK_BACKUP_BYTES = 32 * 1024 * 1024;      // 单任务撤回备份总上限
const MAX_GLOBAL_BACKUP_BYTES = 64 * 1024 * 1024;    // 活跃+终态全部撤回备份总上限
const TERMINAL_TASK_TTL_MS = 30 * 60_000; // 终态临时状态约保留 30 分钟，供最终轮询与撤回
const MAX_TERMINAL_TASKS = 50;             // 硬上限：任务多时最老终态会提前清理；活跃任务绝不参与
const TASK_CLEANUP_INTERVAL_MS = 60_000;
const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60_000;
const envApprovalTimeoutMs = Number(process.env.WEFTMATE_AGENT_APPROVAL_TIMEOUT_MS);
const CONFIGURED_APPROVAL_TIMEOUT_MS = Number.isFinite(envApprovalTimeoutMs) && envApprovalTimeoutMs > 0
  ? Math.max(1_000, Math.floor(envApprovalTimeoutMs))
  : DEFAULT_APPROVAL_TIMEOUT_MS;
let approvalTimeoutMs = CONFIGURED_APPROVAL_TIMEOUT_MS;

type AgentTextPart = { type: 'text'; text: string };
type AgentImagePart = { type: 'image_url'; image_url: { url: string; detail: 'auto' } };
type AgentMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<AgentTextPart | AgentImagePart>;
};
type TaskAttachment =
  | { kind: 'text'; name: string; content: string; origLen?: number }
  | { kind: 'image'; name: string; mime: string; dataUrl: string };

type FileState =
  | { exists: false }
  | { exists: true; digest: string; realPath: string };

interface FileBackup {
  prior: Buffer | null;
  before: FileState;
  after?: FileState;
}

// ── 对外类型 ──
export type StepStatus = 'proposed' | 'awaiting' | 'running' | 'done' | 'failed' | 'rejected';
export type TaskStatus = 'planning' | 'running' | 'awaiting' | 'done' | 'failed' | 'stopped';
export type AgentCompletionAttachment =
  | { kind: 'file'; name: string }
  | { kind: 'image'; name: string; mime: string; dataUrl: string };

export interface AgentStep {
  id: string;
  index: number;             // 第几步（0 起）
  tool: string;
  args: Record<string, unknown>;
  argsSummary?: string;        // 终态只留有限长度摘要，不长期保留文件正文/命令等原始参数
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
  undoHint?: string;         // 撤回临时窗口的诚实说明
  approvalExpiresAt?: number; // 等待批准的截止时间；页面刷新后据此恢复提示
  approvalTimeoutMs?: number; // 前端显示本次等待窗口，不自行猜配置
  ranCommand: boolean;       // 跑过命令（撤回不完全的提示）
  attachments: string[];     // 附的参考文件名（③·给前端显示；不回传内容）
  createdAt: string;
}

type ApprovalDecision = 'approve' | 'reject' | 'timeout';
interface ApprovalGate {
  finish: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── 内部任务态 ──
interface Task {
  id: string;
  task: string;
  workspace: string;         // 工作区绝对路径（已校验是存在的目录）；可为 '' = 这次没工作区、只读附件
  autonomy: Autonomy;
  status: TaskStatus;
  steps: AgentStep[];
  summary?: string;
  note?: string;
  createdAt: string;
  attachments: TaskAttachment[]; // 文本按需读取；图片作为多模态内容直接交给当前模型
  attachmentNames: string[];      // 轻量展示元数据；终态释放附件正文/dataUrl 后仍给最终 UI 看
  context: ChatMessage[];                  // 启动时所在会话的最近上下文（只含 user/assistant，不回传前端）
  // 内部：
  messages: AgentMessage[];              // agent 自己的对话历史（不进 memoweft）
  backups: Map<string, FileBackup>;      // 改前原文 + 改前/改后指纹；撤回只覆盖仍保持 Agent 改后状态的文件
  ranCommand: boolean;
  stopped: boolean;
  abortController?: AbortController;                 // 一次任务共用：叫停会同时中断模型、MCP 与命令
  gate?: ApprovalGate;                              // 等待批准的 resolver + 超时 timer
  approvalExpiresAt?: number;
  terminalAt?: number;                         // 进入终态的时刻；TTL/数量清理依据
}

// 活跃任务表（单用户单进程，模块级即可）。
const tasks = new Map<string, Task>();
const DEFAULT_TASK_RETENTION = {
  now: () => Date.now(),
  ttlMs: TERMINAL_TASK_TTL_MS,
  maxTerminalTasks: MAX_TERMINAL_TASKS,
};
let taskRetention = { ...DEFAULT_TASK_RETENTION };
const DEFAULT_TASK_BUDGETS = {
  taskTextBytes: MAX_TASK_TEXT_BYTES,
  terminalFieldBytes: MAX_TERMINAL_FIELD_BYTES,
  terminalMetadataBytes: MAX_TERMINAL_METADATA_BYTES,
  backupFileBytes: MAX_BACKUP_FILE_BYTES,
  taskBackupBytes: MAX_TASK_BACKUP_BYTES,
  globalBackupBytes: MAX_GLOBAL_BACKUP_BYTES,
};
let taskBudgets = { ...DEFAULT_TASK_BUDGETS };
let backupReader: (file: string) => Promise<Buffer> = (file) => readFile(file);

// ── 记忆接线 + MCP 工具接线（server 注入；不 import core/mcp，保持解耦 + 热重建自然跟随）──
/** MCP 工具（②·帮你干活）：延迟加载——只带 name/desc/极简签名，完整 schema 在 mcp.ts 手里、不进上下文。 */
export interface AgentMcpTool { fqName: string; description: string; signature: string; readOnly: boolean; }
interface AgentExperience { id: string; name: string; systemPrompt: string; }
interface AgentDeps {
  recall?: (query: string) => Promise<string>;               // 捞"关于用户"的背景，返回一段纯文本（空串=没有/失败）
  record?: (taskText: string, summary: string) => Promise<void>; // 干完把结果回写记忆
  recordChat?: (userText: string, reply: string) => Promise<void>; // 没调用工具的普通回答：按聊天证据入记忆，不伪装成"帮我干活"
  complete?: (taskId: string, taskText: string, summary: string, usedTools: boolean, attachments: AgentCompletionAttachment[]) => Promise<void>; // 宿主落当前会话历史/附件引用
  settled?: (taskId: string) => void;                               // 任意终态都通知宿主清理任务关联容器
  experience?: () => AgentExperience;                            // 当前人格（动态 getter；切换后下一任务立即读取新值）
  mcpTools?: () => AgentMcpTool[];                            // 当前可用的 MCP 工具（装的能力包）
  callMcp?: (fqName: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>; // 调一个 MCP 工具
  isMcpToolTrusted?: (fqName: string) => boolean;            // F1：用户是否已「信任」此 MCP 工具（仅 auto 档免批）
}
let deps: AgentDeps = {};
export function configureAgentDeps(d: AgentDeps): void { deps = d; }

function isTerminalStatus(status: TaskStatus): status is 'done' | 'failed' | 'stopped' {
  return status === 'done' || status === 'failed' || status === 'stopped';
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** UTF-8 字节级截断：不把多字节字符切成乱码，且截断标记也计入上限。 */
function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8Bytes(value) <= maxBytes) return value;
  const suffix = '…';
  const suffixBytes = utf8Bytes(suffix);
  if (maxBytes <= suffixBytes) return Buffer.from(suffix).subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '');
  return Buffer.from(value)
    .subarray(0, maxBytes - suffixBytes)
    .toString('utf8')
    .replace(/\uFFFD$/u, '') + suffix;
}

function backupBytes(task: Task): number {
  let total = 0;
  for (const backup of task.backups.values()) total += backup.prior?.byteLength ?? 0;
  return total;
}

function globalBackupBytes(): number {
  let total = 0;
  for (const task of tasks.values()) total += backupBytes(task);
  return total;
}

function terminalMetadataBytes(task: Task): number {
  return utf8Bytes(JSON.stringify(toView(task)));
}

function compactTerminalFields(task: Task): void {
  const cap = taskBudgets.terminalFieldBytes;
  if (task.summary !== undefined) task.summary = truncateUtf8(task.summary, cap);
  if (task.note !== undefined) task.note = truncateUtf8(task.note, cap);
  task.attachmentNames = task.attachmentNames.map((name) => truncateUtf8(name, cap));
  for (const step of task.steps) {
    if (step.argsSummary !== undefined) step.argsSummary = truncateUtf8(step.argsSummary, cap);
    if (step.thought !== undefined) step.thought = truncateUtf8(step.thought, cap);
    if (step.result !== undefined) step.result = truncateUtf8(step.result, cap);
    if (step.error !== undefined) step.error = truncateUtf8(step.error, cap);
  }
}

/** 只清理终态任务：依次执行 TTL、数量和总字节硬上限；planning/running/awaiting 永不参与。 */
function cleanupTerminalTasks(now = taskRetention.now()): void {
  const terminal = [...tasks.values()]
    .filter((task) => isTerminalStatus(task.status) && task.terminalAt !== undefined)
    .sort((a, b) => a.terminalAt! - b.terminalAt!);

  for (const task of terminal) {
    if (now - task.terminalAt! >= taskRetention.ttlMs) tasks.delete(task.id);
  }

  const survivors = terminal.filter((task) => tasks.has(task.id));
  while (survivors.length > taskRetention.maxTerminalTasks) {
    tasks.delete(survivors.shift()!.id);
  }
  let metadataBytes = survivors.reduce((sum, task) => tasks.has(task.id) ? sum + terminalMetadataBytes(task) : sum, 0);
  while (metadataBytes > taskBudgets.terminalMetadataBytes && survivors.length) {
    const oldest = survivors.shift()!;
    if (!tasks.has(oldest.id)) continue;
    metadataBytes -= terminalMetadataBytes(oldest);
    tasks.delete(oldest.id);
  }
}

/** 所有终态都走同一出口：先标终态，再释放模型上下文/附件正文，最后通知宿主清理关联容器。 */
function settleTask(task: Task, status: 'done' | 'failed' | 'stopped'): void {
  if (task.terminalAt !== undefined && isTerminalStatus(task.status)) return;
  task.status = status;
  task.terminalAt = taskRetention.now();
  for (const step of task.steps) {
    step.argsSummary = summarizeStepArgs(step.args);
    step.args = {};
  }
  compactTerminalFields(task);
  task.attachments = [];
  task.messages = [];
  task.context = [];
  // stopped 任务保留已中断 signal 到后台 driver 真正退出，避免 stop 恰好发生在 recall 阶段后又启动新请求。
  if (!task.stopped) task.abortController = undefined;
  if (task.gate) clearTimeout(task.gate.timer);
  task.gate = undefined;
  task.approvalExpiresAt = undefined;
  try { deps.settled?.(task.id); } catch { /* 宿主清理失败不能改变任务结果 */ }
  cleanupTerminalTasks(task.terminalAt);
}

const taskCleanupTimer = setInterval(() => cleanupTerminalTasks(), TASK_CLEANUP_INTERVAL_MS);
taskCleanupTimer.unref();

/** 解析工具名 → ToolDef：先内置四工具，再 MCP 工具（包成 ToolDef）。
 *  MCP 是第三方代码，且 readOnly 是【服务自报】的（annotations.readOnlyHint）——自报只读不可信：
 *  恶意/有 bug 的服务谎报 readOnlyHint=true 就能绕过审批、在 auto 档把用户画像/工作区文件当参数
 *  自动发往第三方。故【MCP 工具默认一律要用户点头】（F1·安全底线，同 run_command），不看自报只读。
 *  用户对信得过的具体工具显式「信任」(isMcpToolTrusted) 后，只能在 auto 档免批；ask 档仍确认每次外部调用。
 *  readOnly 只留作 UI 提示标，绝不作免批依据。 */
function resolveTool(name: string): ToolDef | null {
  if (TOOLS[name]) return TOOLS[name];
  const mt = (deps.mcpTools ? deps.mcpTools() : []).find((t) => t.fqName === name);
  if (!mt) return null;
  const trusted = deps.isMcpToolTrusted?.(name) ?? false;
  return {
    mutating: !mt.readOnly,               // 仅作展示/标注；审批由 external/alwaysApprove 与自主度共同决定
    external: true,                       // ask 档的边界：所有外部调用都逐次确认，不信任自报只读
    alwaysApprove: !trusted,              // 未信任工具在 auto 档也强批；信任只允许 auto 免批
    run: (args, task) => (deps.callMcp ? deps.callMcp(name, args, task.abortController?.signal) : Promise.reject(new Error('MCP 未接线'))),
  };
}

// ── 沙箱：把用户/模型给的路径锁死在工作区内 ──
/** 解析并校验路径必须落在工作区内，否则抛错。绝对路径 / .. 逃逸一律拒。 */
function safeResolve(workspace: string, p: unknown): string {
  if (!workspace) throw new Error('这次没有工作区，用不了文件/命令工具（只能读附件）'); // 护栏：空工作区时 resolve 会落到 cwd，绝不允许
  const raw = String(p ?? '').trim();
  const abs = resolve(workspace, raw);          // 相对工作区解析；raw 若是绝对路径会覆盖 workspace（下面 relative 会揪出来）
  const rel = relative(workspace, abs);
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error(`路径越出工作区：${raw}`);   // 字符串层越界（含跨盘符：Windows 下 relative 会返回带盘符的绝对路径）
  }
  // F2·symlink 硬化：字符串层过了还不够——工作区内一个指向区外的 symlink/junction 会让上面的纯路径判断失效
  //   （resolve/relative 不解析软链）。解析真实路径再复核：realpath 工作区根，再取 abs【最近的已存在祖先】
  //   做 realpath（目标可能还没建=新写文件），确认它落在真实根内；跟着软链逃到区外就拒。
  const realRoot = realpathSync(workspace);
  let probe = abs;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const realRel = relative(realRoot, realpathSync(probe));
  if (realRel !== '' && (realRel.startsWith('..') || isAbsolute(realRel))) {
    throw new Error(`路径经软链逃出工作区：${raw}`);
  }
  return abs;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n…（省略 ${s.length - n} 字）` : s;
}

// ── 工具集（内置四个·全部锁在工作区）──
interface ToolDef {
  mutating: boolean;
  external?: boolean;                             // 第三方/外部工具：ask 档无论只读或改动都要逐次确认
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
      const contentBytes = Buffer.from(content, 'utf8');
      await backupBeforeWrite(task, file);       // 撤回用：记下改前状态
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, contentBytes);
      recordAfterWrite(task, file, contentBytes); // 只记指纹，不复制保留改后正文
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
      return await runShell(command, task.workspace, task.abortController?.signal);
    },
  },
  // 读用户附上的参考文件（③·上下文附件）：只读、按名字从 task.attachments 取（不碰文件系统、不受沙箱限制——用户已显式附上）。
  read_attachment: {
    mutating: false,
    async run(args, task) {
      const name = String(args.name ?? '').trim();
      const att = task.attachments.find((a) => a.name === name);
      const readable = task.attachments.filter((a) => a.kind === 'text');
      if (!att) return `没有附件「${name}」。可读附件：${readable.map((a) => a.name).join('、') || '（无）'}`;
      if (att.kind === 'image') return `「${att.name}」是图片，已随用户消息直接提供给你，不需要 read_attachment。`;
      return truncate(att.content, READ_CHARS);
    },
  },
};

/** 写文件前备份原内容（同一任务内每个路径只备份第一次的状态，撤回还原到任务开始前）。 */
async function backupBeforeWrite(task: Task, file: string): Promise<void> {
  if (task.backups.has(file)) return;            // 已备份过原始态，别被后续写覆盖
  if (existsSync(file)) {
    const size = (await stat(file)).size;
    assertBackupCapacity(task, size);
    // C6：读 Buffer 原样备份（不预设 utf8）——二进制文件用 utf8 读会丢字节，撤回时写回就损坏原文件。
    try {
      const prior = await backupReader(file);
      // 读取期间其它进程可能把文件换大；入表前按真实 Buffer 再检查一次，全球预算不会被竞态穿透。
      assertBackupCapacity(task, prior.byteLength);
      task.backups.set(file, { prior, before: fileState(file, prior) });
    }
    catch (e) {
      // 已存在文件读不出来时绝不能把它当成“原先不存在”：否则继续覆盖后，撤回会把用户原文件删掉。
      throw new Error(`无法在修改前备份 ${relative(task.workspace, file)}，已取消写入：${errMsg(e)}`);
    }
  } else {
    task.backups.set(file, { prior: null, before: { exists: false } }); // 改前不存在 → 撤回时删除
  }
}

function assertBackupCapacity(task: Task, bytes: number): void {
  const mib = (value: number) => Math.max(1, Math.floor(value / 1024 / 1024));
  if (bytes > taskBudgets.backupFileBytes) {
    throw new Error(`原文件超过单个撤回备份上限（${mib(taskBudgets.backupFileBytes)} MB），为避免无法安全撤回，已取消写入`);
  }
  if (backupBytes(task) + bytes > taskBudgets.taskBackupBytes) {
    throw new Error(`本任务撤回备份将超过 ${mib(taskBudgets.taskBackupBytes)} MB，已取消这次写入`);
  }
  if (globalBackupBytes() + bytes > taskBudgets.globalBackupBytes) {
    throw new Error(`全部任务的撤回备份将超过 ${mib(taskBudgets.globalBackupBytes)} MB，请先撤回或等待旧任务过期`);
  }
}

function digest(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function fileState(file: string, content: Buffer): FileState {
  return { exists: true, digest: digest(content), realPath: realpathSync(file) };
}

function sameFileState(left: FileState, right: FileState): boolean {
  if (!left.exists || !right.exists) return left.exists === right.exists;
  return left.digest === right.digest && left.realPath === right.realPath;
}

async function readFileState(file: string): Promise<FileState> {
  try {
    const content = await readFile(file);
    return fileState(file, content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false };
    throw error;
  }
}

/** 同一路径可被 Agent 连续写多次；撤回只认可最后一次成功写入后的状态。 */
function recordAfterWrite(task: Task, file: string, content: Buffer): void {
  const backup = task.backups.get(file);
  if (backup) backup.after = fileState(file, content);
}

/** 杀掉命令启的【整棵进程树】（F7）：shell:true 下 shell 还会派生子/孙进程，只 child.kill() 会留后台孤儿
 *  （超时"已终止"是假象，孤儿可继续外联/占资源）。Windows 用 taskkill /T /F 收整棵树；
 *  POSIX 靠 detached 让子进程自成进程组、kill(-pid) 收整组。 */
function killTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (pid == null) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); }
    catch { try { child.kill(); } catch { /* 尽力 */ } }
  } else {
    try { process.kill(-pid, 'SIGKILL'); }              // 负 pid = 整个进程组（需 spawn 时 detached）
    catch { try { child.kill('SIGKILL'); } catch { /* 尽力 */ } }
  }
}

/** 在工作区里跑一条命令，收 stdout+stderr（合并截断），带超时和用户主动叫停。 */
function runShell(command: string, cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise) => {
    // detached（仅 POSIX）：让子进程自成进程组，超时能整组 kill 掉孙进程（F7）；Windows 走 taskkill /T。
    const child = spawn(command, { cwd, shell: true, detached: process.platform !== 'win32' });
    let out = '';
    let stopReason = '';
    let finished = false;
    const push = (b: Buffer) => { out += b.toString('utf8'); };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    const stop = (reason: string) => {
      if (stopReason) return;
      stopReason = reason;
      killTree(child);                                   // 用户叫停与超时都收整棵树
    };
    const finish = (text: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolvePromise(text);
    };
    const onAbort = () => stop('（用户已叫停，正在运行的命令进程树已终止）');
    const timer = setTimeout(() => {
      stop(`（超时 ${CMD_TIMEOUT_MS / 1000}s，已终止整棵进程树）`);
    }, CMD_TIMEOUT_MS);
    timer.unref();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.on('close', (code) => {
      const body = [out.trim(), stopReason].filter(Boolean).join('\n') || '（无输出）';
      finish(truncate(body, OUT_CHARS) + `\n[退出码 ${code ?? '?'}]`);
    });
    child.on('error', (e) => {
      finish(stopReason || `命令启动失败：${e.message}`);
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

// ── 系统提示（按"有无工作区/有无附件/有无 MCP"动态拼工具清单）──
function buildSystemPrompt(workspace: string, memoryNote: string, mcpTools: AgentMcpTool[], attachments: Task['attachments'], experience?: AgentExperience): string {
  const hasWs = !!workspace;
  const textAttachments = attachments.filter((a) => a.kind === 'text');
  const imageAttachments = attachments.filter((a) => a.kind === 'image');
  const mem = memoryNote ? `\n关于用户你已知道（供参考，别乱用）：\n${memoryNote}\n` : '';
  // 工具清单：工作区工具仅在有工作区时给；read_attachment 仅在有附件时给。
  const tools: string[] = [];
  if (hasWs) {
    tools.push('- list_dir(path)             列目录（path 省略=工作区根）');
    tools.push('- read_file(path)            读文件');
    tools.push('- write_file(path, content)  新建或覆盖文件');
    tools.push('- run_command(command)       在工作区里跑一条命令（如 npm test）');
  }
  if (textAttachments.length) tools.push('- read_attachment(name)      读用户附上的文本/代码文件');
  // 延迟加载（生死线）：外部工具只列 全名+签名+一句话，完整 schema 不进上下文；调用时 tool 用全名。
  const mcp = mcpTools.length
    ? `\n\n【外部工具·装的能力包】（调用时 tool 填下面的全名；非只读工具执行前会请用户确认）：\n` +
      mcpTools.map((t) => `- ${t.fqName}${t.signature}  ${t.description}`).join('\n')
    : '';
  // 参考文件清单（③·上下文附件）：只列名字+大小，让模型按需 read_attachment（不全量塞·检索由模型自己挑）。
  const textList = textAttachments.length
    ? `\n\n参考文件（用户附的·用 read_attachment 按名字读·别一次全读，按需读相关的）：\n` +
      textAttachments.map((a) => `- ${a.name}（${a.content.length} 字${a.origLen ? `·已从 ${a.origLen} 字截断，后半段不在` : ''}）`).join('\n')
    : '';
  const imageList = imageAttachments.length
    ? `\n\n参考图片（已直接随本条用户消息提供，可直接看图）：\n` +
      imageAttachments.map((a) => `- ${a.name}（${a.mime}）`).join('\n')
    : '';
  const attList = textList + imageList;
  const envLine = hasWs
    ? `工作区：${workspace}\n所有文件路径都相对工作区，且【不能超出工作区】（别用绝对路径、别用 .. 逃出去）。`
    : `这次没有工作区：你只能使用下面的参考文件或图片来回答，不能读写工作区文件、不能跑命令。`;
  const attachmentUseRules = [
    textAttachments.length ? '- 文本/代码文件按需用 read_attachment 读。' : '',
    imageAttachments.length ? '- 图片已经直接随用户消息提供给你，可以直接看图。' : '',
  ].filter(Boolean).join('\n');
  const rules = hasWs
    ? `- 用户只是在打招呼、闲聊，或问题不需要读取/改动外部内容时，直接回 done 正常回答，不要为了展示能力调用工具。
- 一次只回一个 action，等我把结果给你，再决定下一步。
- 改文件前先 read_file 看清楚，别凭空臆造内容。
- 路径必须在工作区内。
- 信息够了、任务完成了，就回 done，别画蛇添足。`
    : `- 用户只是在打招呼、闲聊，或问题不需要参考内容时，直接回 done 正常回答，不要为了展示能力调用工具。
- 一次只回一个 action，等我把结果给你，再决定下一步。
${attachmentUseRules}
- 信息够了就回 done 给出回答。
- 别臆造参考文件或图片里没有的内容。`;
  const persona = experience && experience.systemPrompt.trim()
    ? `【当前人格：${experience.name}（${experience.id}）】
${experience.systemPrompt.trim()}

保持上面人格的身份、称呼和语气。用户问“你是谁”时按当前人格回答，不要退回“我是 WeftMate 助手”。最终 done.summary 也必须使用当前人格的表达方式。

`
    : '';
  return `${persona}你现在工作在 WeftMate 的统一聊天与协作环境中：可以自然聊天，也能在需要时使用用户允许的工具完成任务。
${envLine}
${mem}
你能用这些工具，每次回复【只做一件事】：
${tools.join('\n')}${attList}${mcp}

【回复格式】每次只回一个 JSON 对象，别加任何其它文字、别加 markdown 围栏：
· 要执行一步：{"thought":"简短说明你要干嘛（用用户的语言）","action":{"tool":"工具名","args":{…}}}
· 任务做完：{"thought":"…","done":{"summary":"给用户的简短总结/回答（用用户的语言）"}}

规则：
${rules}`;
}

// ── 启动任务 ──
export function startTask(input: {
  task: string;
  workspace: string;
  autonomy?: Autonomy;
  attachments?: Array<{
    name: string;
    kind?: 'text' | 'image';
    content?: string;
    mime?: string;
    dataUrl?: string;
  }>;
  context?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): { id: string; attachments: AgentCompletionAttachment[] } {
  const task = String(input.task ?? '').trim();
  const workspace = String(input.workspace ?? '').trim();
  if (!task) throw new Error('任务描述不能为空');
  if (utf8Bytes(task) > taskBudgets.taskTextBytes) {
    throw new Error(`任务描述不能超过 ${Math.floor(taskBudgets.taskTextBytes / 1024)} KB，请拆成几次发送`);
  }
  // 附件清洗 + 兜底截断（前端也截；后端防超大/超多）。
  const attachments: TaskAttachment[] = [];
  let imageChars = 0;
  for (const rawAttachment of (Array.isArray(input.attachments) ? input.attachments : []).slice(0, MAX_ATTACHMENTS)) {
    if (!rawAttachment || typeof rawAttachment.name !== 'string') continue;
    const name = rawAttachment.name.slice(0, 200);
    if (rawAttachment.kind === 'image') {
      const mime = typeof rawAttachment.mime === 'string' ? rawAttachment.mime.toLowerCase() : '';
      const dataUrl = typeof rawAttachment.dataUrl === 'string' ? rawAttachment.dataUrl : '';
      const expectedPrefix = `data:${mime};base64,`;
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) continue;
      if (!dataUrl.startsWith(expectedPrefix) || dataUrl.length > MAX_IMAGE_DATA_CHARS) continue;
      if (imageChars + dataUrl.length > MAX_IMAGE_TOTAL_CHARS) continue;
      imageChars += dataUrl.length;
      attachments.push({ kind: 'image', name, mime, dataUrl });
      continue;
    }
    if (typeof rawAttachment.content !== 'string') continue;
    const raw = rawAttachment.content;
    // C5：超上限就截断，并记 origLen——buildSystemPrompt 在附件清单里标"已从 N 字截断"，不再静默丢后半段
    //   （否则模型拿半个文件当整份、给出看似完整实则漏读的结果，用户全程无感）。
    const truncated = raw.length > MAX_ATTACH_CHARS;
    attachments.push({
      kind: 'text', name,
      content: truncated ? raw.slice(0, MAX_ATTACH_CHARS) : raw,
      ...(truncated ? { origLen: raw.length } : {}),
    });
  }
  const context: ChatMessage[] = (Array.isArray(input.context) ? input.context : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_CONTEXT_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTEXT_CHARS) }));
  // 工作区可选：给了就必须是存在的目录；没给则必须至少有一个附件（否则 agent 无事可做）。
  if (workspace) {
    if (!existsSync(workspace) || !statSync(workspace).isDirectory()) throw new Error('工作区文件夹不存在或不是目录');
  } else if (!attachments.length) {
    throw new Error('先选个工作区，或附一个参考文件');
  }
  const autonomy = normalizeAutonomy(input.autonomy);
  const id = 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const t: Task = {
    id, task, workspace, autonomy, attachments, attachmentNames: attachments.map((attachment) => attachment.name), context,
    status: autonomy === 'suggest' ? 'planning' : 'running',
    steps: [], createdAt: new Date().toISOString(),
    messages: [], backups: new Map(), ranCommand: false, stopped: false, abortController: new AbortController(),
  };
  tasks.set(id, t);
  if (autonomy === 'suggest') void plan(t);       // 只建议：出方案、不执行
  else void drive(t);                             // 问一下 / 放手做：进执行循环
  return { id, attachments: completionAttachments(t) };
}

/** 用户任务消息：没有图片时保持纯文本协议；有图片时使用 OpenAI 兼容的 vision content parts。 */
function taskUserMessage(t: Task): AgentMessage {
  const images = t.attachments.filter((a) => a.kind === 'image');
  if (!images.length) return { role: 'user', content: t.task };
  return {
    role: 'user',
    content: [
      { type: 'text', text: t.task },
      ...images.map((image): AgentImagePart => ({
        type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' },
      })),
    ],
  };
}

/** 只建议模式：单次调用出一份计划（不执行任何工具），渲染成 proposed 步骤卡。 */
async function plan(t: Task): Promise<void> {
  try {
    const client = mkClient();
    const memNote = deps.recall ? await safeRecall(t.task) : '';
    const mtools = deps.mcpTools ? deps.mcpTools() : [];
    const experience = deps.experience ? deps.experience() : undefined;
    const sys = buildSystemPrompt(t.workspace, memNote, mtools, t.attachments, experience) +
      `\n\n【本次只出计划】用户选了"只建议"，所以你【不要执行】，只回一个 JSON：
{"summary":"整体思路（用用户的语言）","plan":[{"tool":"工具名","args":{…},"why":"这步为啥"}]}`;
    const reply = await client.chat([
      { role: 'system', content: sys },
      ...t.context,
      taskUserMessage(t),
    ], t.abortController?.signal);
    if (t.stopped) return;
    const obj = extractJson(reply);
    if (obj && Array.isArray(obj.plan)) {
      t.summary = String(obj.summary ?? '这是建议方案，没有执行任何操作。');
      (obj.plan as Array<Record<string, unknown>>).forEach((p, i) => {
        t.steps.push({
          id: `${t.id}-s${i}`, index: i,
          tool: String(p.tool ?? '?'), args: (p.args as Record<string, unknown>) ?? {},
          thought: typeof p.why === 'string' ? p.why : undefined,
          status: 'proposed', mutating: !!resolveTool(String(p.tool))?.mutating, ts: new Date().toISOString(),
        });
      });
    } else {
      t.summary = reply.trim();                    // 模型没按格式回 → 直接把它的话当方案展示
    }
    t.note = '这是建议方案，没有执行任何操作。要真做请换"问一下"或"放手做"。';
    await safeFinish(t);
    settleTask(t, t.stopped ? 'stopped' : 'done');
  } catch (e) {
    if (t.stopped) return;
    t.note = errMsg(e);
    settleTask(t, 'failed');
  }
}

/** 执行循环（ask / auto）：模型出一步 → 按自主度决定是否要批准 → 执行 → 结果喂回 → 循环到 done。 */
async function drive(t: Task): Promise<void> {
  try {
    const client = mkClient();
    const memNote = deps.recall ? await safeRecall(t.task) : '';
    const mtools = deps.mcpTools ? deps.mcpTools() : [];
    const experience = deps.experience ? deps.experience() : undefined;
    t.messages = [
      { role: 'system', content: buildSystemPrompt(t.workspace, memNote, mtools, t.attachments, experience) },
      ...t.context,
      taskUserMessage(t),
    ];
    let parseFails = 0;

    for (let i = 0; i < MAX_STEPS; i++) {
      if (t.stopped) { settleTask(t, 'stopped'); return; }

      const reply = await client.chat(t.messages, t.abortController?.signal);
      // client.chat 在途时用户可能已经叫停；返回后先收口，绝不能再解析/开启下一步工具动作。
      if (t.stopped) return;
      t.messages.push({ role: 'assistant', content: reply });
      const parsed = parseAction(reply);

      if (!parsed) {
        // 聊天/视觉通用兜底：WeftMate 是【统一聊天与协作环境】，纯自然语言回复本身就是合法的聊天回答，
        // 不该被当成“格式错误”。很多模型闲聊时（或视觉端点看图时）会忽略 system 里的 JSON 协议，直接说人话。
        // 只要还没进入任何工具步骤（首轮直答），这就是一条普通回答——直接展示给用户，别重试。
        //   为什么不重试：闲聊时塞“请只回 JSON”会逼模型下一轮向用户道歉“抱歉格式问题”，反而污染对话；
        //   机械重试三次后还会误报“模型没按格式回复，放弃”，把内部话术泄漏给用户。
        //   仅当执行中途（steps>0）模型才突然不按格式时，才保留重试→失败的跑飞保护。
        const directReply = reply.trim();
        if (t.steps.length === 0 && directReply) {
          t.summary = directReply;
          await safeFinish(t);
          settleTask(t, t.stopped ? 'stopped' : 'done');
          return;
        }
        if (++parseFails >= MAX_PARSE_FAILS) {
          t.note = '模型没按格式回复，放弃。';
          settleTask(t, 'failed');
          return;
        }
        t.messages.push({ role: 'user', content: '你的回复我解析不了。请【只回一个 JSON 对象】（action 或 done），别加其它文字。' });
        continue;
      }
      parseFails = 0;

      if (parsed.done) {
        t.summary = parsed.summary || '完成。';
        await safeFinish(t);                       // 普通回答/工具任务分别入记忆，并落宿主会话历史
        settleTask(t, t.stopped ? 'stopped' : 'done'); // 宿主落盘完成后再对前端宣告终态，避免刷新历史的竞态
        return;
      }

      const tool = resolveTool(parsed.tool ?? '');
      if (!tool) {
        // 未知工具：把可用清单喂回，让它改（不算失败）。
        t.messages.push({ role: 'user', content: `没有工具「${parsed.tool}」。可用：list_dir / read_file / write_file / run_command；外部工具请用系统提示里列出的全名。` });
        continue;
      }

      const step: AgentStep = {
        id: `${t.id}-s${i}`, index: i,
        tool: parsed.tool!, args: parsed.args ?? {},
        thought: parsed.thought, status: 'running',
        mutating: tool.mutating, ts: new Date().toISOString(),
      };
      t.steps.push(step);

      // 审批门：命令/未信任 MCP 永远要批；ask 档下所有改动与所有外部工具要批；仅内置只读自动。
      const needApprove = !!tool.alwaysApprove || (t.autonomy === 'ask' && (tool.mutating || tool.external === true));
      if (needApprove) {
        step.status = 'awaiting';
        t.status = 'awaiting';
        const decision = await waitGate(t);
        if (decision === 'timeout') {
          step.status = 'rejected';
          t.note = `等待确认超过 ${formatApprovalTimeout(approvalTimeoutMs)}，任务已自动停止。没有执行这一步。`;
          settleTask(t, 'stopped');
          return;
        }
        if (t.stopped || decision === 'reject') {
          step.status = 'rejected';
          if (t.stopped) { settleTask(t, 'stopped'); return; }
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
        if (t.stopped) return;
        step.result = truncate(result, OUT_CHARS);
        step.status = 'done';
        t.messages.push({ role: 'user', content: `[工具结果 ${parsed.tool}]\n${step.result}` });
      } catch (e) {
        if (t.stopped) return;
        step.error = errMsg(e);
        step.status = 'failed';
        t.messages.push({ role: 'user', content: `[工具出错 ${parsed.tool}] ${step.error}` });
      }
    }

    // 到步数上限还没 done
    if (!isTerminalStatus(t.status)) {
      t.note = `到达步数上限（${MAX_STEPS} 步）还没完成，先停下。`;
      settleTask(t, 'failed');
    }
  } catch (e) {
    if (t.stopped) return;
    t.note = errMsg(e);
    settleTask(t, 'failed');
  }
}

// ── 批准 / 停止 / 撤回 ──
function formatApprovalTimeout(ms: number): string {
  return ms < 60_000 ? `${Math.ceil(ms / 1_000)} 秒` : `${Math.ceil(ms / 60_000)} 分钟`;
}

/** 等待用户批准：到期自动返回 timeout；timer 不得阻止 Electron/测试进程退出。 */
function waitGate(t: Task): Promise<ApprovalDecision> {
  return new Promise((resolveDecision) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (decision: ApprovalDecision) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (t.gate?.finish === finish) t.gate = undefined;
      t.approvalExpiresAt = undefined;
      resolveDecision(decision);
    };
    t.approvalExpiresAt = Date.now() + approvalTimeoutMs;
    timer = setTimeout(() => finish('timeout'), approvalTimeoutMs);
    timer.unref();
    t.gate = { finish, timer };
  });
}

/** 批准/拒绝当前挂起的那一步。返回是否确实有挂起的步骤被处理。 */
export function decideStep(taskId: string, decision: 'approve' | 'reject'): boolean {
  const t = tasks.get(taskId);
  if (!t || !t.gate) return false;
  t.gate.finish(decision);
  return true;
}

/** 叫停任务：立刻收口 UI 状态，同时中断在途模型、MCP、命令并唤醒审批门。 */
export function stopTask(taskId: string): boolean {
  const t = tasks.get(taskId);
  if (!t || isTerminalStatus(t.status)) return false;
  t.stopped = true;
  const controller = t.abortController;
  if (controller && !controller.signal.aborted) controller.abort(new Error('用户已叫停任务'));
  if (t.gate) t.gate.finish('reject');
  for (const step of t.steps) {
    if (step.status === 'running' || step.status === 'awaiting') {
      step.status = 'rejected';
      step.error = '用户已叫停';
    }
  }
  t.note = '任务已停止；正在进行的模型请求、外部工具或命令也已发出中断。';
  settleTask(t, 'stopped');
  return true;
}

/** 一键撤回：还原本任务改过的所有文件（改前不存在的删掉）。命令副作用还原不了，ranCommand 已如实标注。 */
export async function undoTask(taskId: string): Promise<{
  ok: boolean;
  restored: number;
  failed: number;
  conflicted: number;
  ranCommand: boolean;
  error?: string;
}> {
  cleanupTerminalTasks();
  const t = tasks.get(taskId);
  if (!t) {
    return {
      ok: false, restored: 0, failed: 0, conflicted: 0, ranCommand: false,
      error: '撤回窗口已过期，或任务较多时临时状态已提前清理。已写入会话的内容不受影响。',
    };
  }
  if (!isTerminalStatus(t.status)) {
    return {
      ok: false, restored: 0, failed: 0, conflicted: 0, ranCommand: t.ranCommand,
      error: '任务还没结束，暂时不能撤回。请先停止任务并等待它结束。',
    };
  }
  let restored = 0;
  let failed = 0;
  let conflicted = 0;
  for (const [file, backup] of [...t.backups]) {
    try {
      // 路径可能在任务结束后被换成 symlink/junction；撤回前重新走沙箱校验，绝不借撤回写出工作区。
      const checked = safeResolve(t.workspace, relative(t.workspace, file));
      if (checked !== file) throw new Error('撤回路径与原路径不一致');
      const current = await readFileState(file);

      // 用户或其它程序已经把文件恢复成改前状态：无需再写，也算安全完成。
      if (sameFileState(current, backup.before)) {
        restored++;
        t.backups.delete(file);
        continue;
      }

      // 只有文件仍是本任务最后一次成功写完的样子，才允许还原。其它状态一律尊重用户的新内容。
      if (!backup.after || !sameFileState(current, backup.after)) {
        conflicted++;
        continue;
      }

      if (backup.prior === null) await rm(file);
      else await writeFile(file, backup.prior); // C6：Buffer 原样写回，文本/二进制都不损坏
      restored++;
      t.backups.delete(file);              // 只删成功项；失败项保留，允许用户稍后重试
    } catch { failed++; /* 单个文件还原失败不阻断其余（如父目录已删/文件锁定） */ }
  }
  if (failed > 0 || conflicted > 0) {
    const error = conflicted > 0
      ? (failed > 0
        ? '有些文件后来又被修改，另有文件还原失败；都没有被强行覆盖，未处理项仍保留，可稍后重试。'
        : '有文件后来又被修改，已跳过，未覆盖你的新内容。未处理项仍保留，可稍后重试。')
      : '部分文件还原失败；失败项仍保留，可稍后重试。';
    t.note = `已还原 ${restored} 个文件；${conflicted} 个检测到后续修改并跳过，${failed} 个还原失败。未处理项仍保留，可稍后重试。` +
      (t.ranCommand ? ' 注意：跑过命令，命令造成的其它变化撤不回。' : '');
    return { ok: false, restored, failed, conflicted, ranCommand: t.ranCommand, error };
  }
  t.note = `已撤回：还原 ${restored} 个文件${t.ranCommand ? '（注意：跑过命令，命令造成的其它变化撤不回）' : ''}。`;
  return { ok: true, restored, failed: 0, conflicted: 0, ranCommand: t.ranCommand };
}

// ── 视图 / 查询（给 server 端点）──
export function getTaskView(taskId: string): AgentTaskView | null {
  cleanupTerminalTasks();
  const t = tasks.get(taskId);
  return t ? toView(t) : null;
}
export function listTasks(): AgentTaskView[] {
  cleanupTerminalTasks();
  return [...tasks.values()].map(toView).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
function toView(t: Task): AgentTaskView {
  const canUndo = isTerminalStatus(t.status) && t.backups.size > 0;
  return {
    id: t.id, task: t.task, workspace: t.workspace, autonomy: t.autonomy,
    status: t.status, steps: t.steps, summary: t.summary, note: t.note,
    canUndo, ranCommand: t.ranCommand,
    undoHint: canUndo ? '任务结束后约 30 分钟内可撤回；任务较多时可能提前清理。' : undefined,
    approvalExpiresAt: t.status === 'awaiting' ? t.approvalExpiresAt : undefined,
    approvalTimeoutMs: t.status === 'awaiting' ? approvalTimeoutMs : undefined,
    attachments: t.attachmentNames, createdAt: t.createdAt,
  };
}

// ── 内部小工具 ──
type ChatClient = { chat(messages: AgentMessage[], signal?: AbortSignal): Promise<string> };

/**
 * Agent 专用的 OpenAI-compatible 客户端。Host 直发文字/图片，才能把任务级 AbortSignal 接到真实网络请求；
 * 不修改 MemoWeft 源码，也不让 MemoWeft 的记忆调用误共享 Agent 的停止信号。
 */
class AgentOpenAIClient implements ChatClient {
  private readonly config: ReturnType<typeof loadLLMConfig>;

  constructor() {
    this.config = { ...loadLLMConfig(), temperature: 0 };
  }

  async chat(messages: AgentMessage[], externalSignal?: AbortSignal): Promise<string> {
    const hasImages = messages.some((message) => typeof message.content !== 'string');
    const timeoutMs = Number(process.env.MEMOWEFT_LLM_TIMEOUT_MS ?? process.env.DLA_LLM_TIMEOUT_MS) || 120_000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model: this.config.model, messages, temperature: 0 }),
        signal,
      });
    } catch (error) {
      if (timeoutSignal.aborted && !externalSignal?.aborted) {
        throw new Error(`模型请求超时（超过 ${timeoutMs}ms）`);
      }
      throw error;
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      const visionHint = hasImages && (response.status === 400 || response.status === 404 || response.status === 415)
        ? '当前模型或接口可能不支持图片理解。请换用支持视觉的模型后重试。'
        : '';
      throw new Error(`模型请求失败 ${response.status}${visionHint ? `：${visionHint}` : ''}${detail ? `｜${detail}` : ''}`);
    }
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('模型返回格式不正确');
    return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }
}

// LLM 客户端工厂（可注入）：默认用当前激活模型（env 已由 configStore.injectEnv 保持最新），temperature=0 让工具调用更稳。
//   loadLLMConfig 缺配会抛（"没配模型"），由 driver/plan 的 try/catch 兜成任务失败、不崩进程。
let clientFactory: () => ChatClient = () => new AgentOpenAIClient();
/** 仅测试用：注入假模型确定性地驱动循环，冒烟沙箱/撤回等安全逻辑（不碰生产路径；生产永远走默认工厂）。 */
export function __setClientFactory(f: () => ChatClient): void { clientFactory = f; }
/** 仅测试用：缩短 TTL/数量边界并注入假时钟，避免真实等待半小时。 */
export function __setTaskRetentionForTests(input: {
  now?: () => number;
  ttlMs?: number;
  maxTerminalTasks?: number;
}): void {
  if (input.now) taskRetention.now = input.now;
  if (input.ttlMs !== undefined) taskRetention.ttlMs = input.ttlMs;
  if (input.maxTerminalTasks !== undefined) taskRetention.maxTerminalTasks = input.maxTerminalTasks;
}
export function __setTaskBudgetsForTests(input: Partial<typeof DEFAULT_TASK_BUDGETS>): void {
  taskBudgets = { ...taskBudgets, ...input };
}
export function __setApprovalTimeoutForTests(timeoutMs?: number): void {
  approvalTimeoutMs = timeoutMs === undefined ? CONFIGURED_APPROVAL_TIMEOUT_MS : Math.max(1, Math.floor(timeoutMs));
}
export function __runTaskCleanupForTests(): void { cleanupTerminalTasks(); }
export function __taskCleanupTimerHasRefForTests(): boolean { return taskCleanupTimer.hasRef(); }
export function __approvalTimerHasRefForTests(taskId: string): boolean | null {
  return tasks.get(taskId)?.gate?.timer.hasRef() ?? null;
}
export function __setBackupReaderForTests(reader?: (file: string) => Promise<Buffer>): void {
  backupReader = reader ?? ((file) => readFile(file));
}
export function __getTaskRetentionDebugForTests(taskId: string): {
  status: TaskStatus;
  terminalAt?: number;
  attachmentCount: number;
  messageCount: number;
  contextCount: number;
  backupCount: number;
  backupBytes: number;
  metadataBytes: number;
  stepArgs: Array<{ args: Record<string, unknown>; argsSummary?: string }>;
} | null {
  const task = tasks.get(taskId);
  return task ? {
    status: task.status,
    terminalAt: task.terminalAt,
    attachmentCount: task.attachments.length,
    messageCount: task.messages.length,
    contextCount: task.context.length,
    backupCount: task.backups.size,
    backupBytes: backupBytes(task),
    metadataBytes: isTerminalStatus(task.status) ? terminalMetadataBytes(task) : 0,
    stepArgs: task.steps.map((step) => ({ args: step.args, argsSummary: step.argsSummary })),
  } : null;
}
export function __resetAgentTasksForTests(): void {
  for (const task of tasks.values()) {
    if (task.gate) clearTimeout(task.gate.timer);
    if (task.abortController && !task.abortController.signal.aborted) task.abortController.abort();
  }
  tasks.clear();
  taskRetention = { ...DEFAULT_TASK_RETENTION };
  taskBudgets = { ...DEFAULT_TASK_BUDGETS };
  approvalTimeoutMs = CONFIGURED_APPROVAL_TIMEOUT_MS;
  backupReader = (file) => readFile(file);
  deps = {};
  clientFactory = () => new AgentOpenAIClient();
}
function mkClient(): ChatClient { return clientFactory(); }
async function safeRecall(query: string): Promise<string> {
  try { return (await deps.recall!(query)) || ''; } catch { return ''; }
}
async function safeRecord(t: Task): Promise<void> {
  if (!deps.record) return;
  try { await deps.record(t.task, t.summary ?? ''); } catch { /* 回写记忆失败不影响任务结果 */ }
}

async function safeFinish(t: Task): Promise<void> {
  // 只建议模式也会有 proposed 步骤，但没有真正调用工具。
  const usedTools = t.steps.some((step) => step.status !== 'proposed');
  if (usedTools) {
    await safeRecord(t);
  } else if (deps.recordChat) {
    try { await deps.recordChat(t.task, t.summary ?? ''); } catch { /* 普通回答入记忆失败不影响回复 */ }
  }
  if (deps.complete) {
    const attachments = completionAttachments(t);
    try { await deps.complete(t.id, t.task, t.summary ?? '', usedTools, attachments); } catch { /* 会话历史失败不影响任务结果 */ }
  }
}

function completionAttachments(t: Task): AgentCompletionAttachment[] {
  return t.attachments.map((attachment) => attachment.kind === 'image'
    ? { kind: 'image', name: attachment.name, mime: attachment.mime, dataUrl: attachment.dataUrl }
    : { kind: 'file', name: attachment.name });
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
function summarizeStepArgs(args: Record<string, unknown>): string | undefined {
  if (!args || Object.keys(args).length === 0) return undefined;
  if (typeof args.command === 'string') return truncate(`$ ${args.command}`, 500);
  if (typeof args.path === 'string' && typeof args.content === 'string') {
    return truncate(`${args.path}（${args.content.length} 字）`, 500);
  }
  if (typeof args.path === 'string') return truncate(args.path, 500);
  try {
    const summary = JSON.stringify(args);
    return summary && summary !== '{}' ? truncate(summary, 500) : undefined;
  } catch {
    return undefined;
  }
}
function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
