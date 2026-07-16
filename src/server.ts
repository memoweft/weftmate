/**
 * @memoweft/host —— 用户产品运行壳（Host）。
 *
 * node:http 起服，经【公开入口】`import 'memoweft'` 调 Core。层层叠加：
 *   基础入口：GET /api/health、GET /api/chat-history、GET /api/bg-status、GET /（产品前端）。
 *   用户消息统一走 /api/agent/*；模型配置统一走 /api/model-config/*，密钥由 safeStorage 加密保存。
 *   步3：记忆管理页——GET /api/cognition、GET /api/evidence（列取）、
 *        POST /api/cognition/{invalidate,delete}、POST /api/evidence/{authorization,delete}（受控管理）。
 *   步4：多对话——POST /api/reset（新建）、GET /api/sessions（列表）、
 *        POST /api/session/open（切换+续聊种子重建）、POST /api/session/archive（软归档）。
 *   步5：数据/备份——GET /api/export-bundle（导出记忆包）、POST /api/import-bundle（dryRun 试算 / merge 导入）、
 *        POST /api/factory-reset（恢复出厂·破坏性·清空全部记忆）。全走 core.portable.* / core.memory.resetSubject。
 *   步6：S0/S1 用户正门——GET /api/cognition/count（记忆胶囊数）、POST /api/refresh（用户"立即整理记忆"，
 *        走 core.updateProfile；与后台调度共用单飞锁不并发）；S1 新理解信号经 bg-status 的 lastUpdate.newCognitions 透出。
 *   步5-G2：记忆图谱——GET /api/memory-graph（走 core.graph.buildMemoryGraph 产 { nodes, edges, stats } payload，
 *        供前端"记忆图谱" tab 手搓力导向图渲染；query 支持 includeEvidence/includeInvalid/includeArchived）。
 * 后台画像更新调度、聊天历史落盘、多对话编排 = Host 自实现（蓝图 §3.3）。
 * 记忆管理【全走 core.memory.*】（步0 已补齐的受控 API），绝不直接摸 store（Host 边界红线）。
 *
 * 多对话状态（蓝图 §3.3）：会话册（列表/新建/切换/归档）是【Host 的持久数据】，扫 sessions 目录的 jsonl 得来。
 *   currentConvId 记录当前活跃对话；每次统一 Agent 任务从该会话历史提取最近几轮作为上下文。
 *
 * 红线：只经 `import 'memoweft'` 调 Core，任何 `import '../../src/*'` 都算越界。
 * 数据隔离：Host 用自己独立的库（默认 apps/memoweft-host/data/host.db，env MEMOWEFT_HOST_DB 覆盖），
 *   聊天历史落【库同目录下的 sessions/】（跟随库路径：隔离库时聊天历史也隔离），与 testbench 互不污染。
 * 只绑 127.0.0.1，并以每进程 bearer token + Host/Origin/Sec-Fetch-Site 守住全部 API。
 */
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createMemoWeftCore, config, type MemoryBundle, type Observation } from './memoweft.ts';
import { createProfileScheduler } from './scheduler.ts';
import { createChatHistory, type HistoryTurn, type HistoryAttachment } from './chatHistory.ts';
import { credBand } from './confBand.ts';
import { listBuiltinPersonas, listPlugins, ALL_PLUGINS, DEFAULT_EXPERIENCE_ID } from './experiences/index.ts';
import { PersonaStore, PersonaStoreError, filterPersonaHistory } from './personas/store.ts';
import * as configStore from './config-store.ts';
import * as collector from './collector.ts';
import { getPerceptionEnabled, setPerceptionEnabled, getPerceptionCloudAllowed, setPerceptionCloudAllowed, setDesktopCapture, readPerceptionView, getLanguage, setLanguage, getTheme, setTheme, getAgentAutonomy, setAgentAutonomy, resolvedLang, getTrustedMcpTools, setMcpToolTrust, getFirstInterviewState, setFirstInterviewState, resetFirstInterviewState } from './settings.ts';
import * as agent from './agent.ts';
import * as mcp from './mcp.ts';
import * as mcpStore from './mcp-store.ts';
import { ensureDefaultAgentWorkspace as ensureWorkspaceInDocuments } from './agent-workspace.ts';
import { createLoopbackToken, loopbackPolicy, observationIngestionAllowed, secureHtmlDocument, withLoopbackSecurity } from './loopback-security.ts';
import { ProfileOverrideStore } from './profile-overrides.ts';
import { cognitionCorrectionOriginId } from './cognition-correction.ts';
import { dialog, BrowserWindow, app } from 'electron';
import {
  FIRST_INTERVIEW_TOTAL_STEPS,
  advanceFirstInterview,
  ensureFirstInterviewRunId,
  firstInterviewCopy,
  newFirstInterviewState,
  transitionFirstInterview,
  type FirstInterviewState,
} from './first-interview.ts';

// 先读 .env（Node 不加 --env-file 不会自动读）：确保下面 DB_PATH / 纯库开关 / Core 构造都拿得到 .env 配置。
//   loadEnvFile 幂等；没有 .env 抛错忽略。放在最顶部——否则 DB_PATH（下面就求值）读不到 .env 里的 MEMOWEFT_HOST_DB。
try { process.loadEnvFile(); } catch { /* 没有 .env 或已加载，忽略 */ }

// 纯库模式（MEMOWEFT_EXPERIENCE_UI=off）：Host 被当库 import 时不起网页——【在建任何库/目录之前】就退出，
//   不 createMemoWeftCore、不建 host.db、不建 data 目录（纯库模式不该在磁盘留 Host 残留）。
if (process.env.MEMOWEFT_EXPERIENCE_UI === 'off') {
  console.log('\n  纯库模式：未启动网页；作为库使用请直接 import \'memoweft\'（MEMOWEFT_EXPERIENCE_UI=off）。');
  console.log('  想起网页请把该行改回 on 或删掉，再启动 Host。\n');
  // 提前退出：不 createMemoWeftCore、不建 host.db/data 目录（纯库模式不该在磁盘留 Host 残留）。
  //   真实终端下干净退 0；仅当 stdout 被管道捕获（如自动化冒烟 2>&1）时，Windows 偶报一句无害的
  //   libuv 退出竞态 assertion（stdout 异步 flush 未完就 exit），不影响"不起网页/不建库"这两件正事。
  process.exit(0);
}

// 端口：standalone 无 env 时保留 7788；Electron main 默认显式传 0，让 OS 分配空闲端口。
function readRequestedPort(): number {
  if (process.env.PORT === undefined) return 7788;
  const parsed = Number(process.env.PORT);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new RangeError(`PORT 必须是 0–65535 的整数，收到：${process.env.PORT}`);
  }
  return parsed;
}
const REQUESTED_PORT = readRequestedPort();
const LOOPBACK_TOKEN = createLoopbackToken();
let boundPort: number | null = null;

function currentLoopbackPolicy() {
  if (boundPort === null) throw new Error('loopback 尚未监听');
  return loopbackPolicy(boundPort, LOOPBACK_TOKEN);
}

/** 只给同一 Electron 主进程中的可信客户端接线；不得记录、持久化或暴露给页面。 */
export function getLoopbackToken(): string {
  return LOOPBACK_TOKEN;
}

// 库路径：默认 data/host.db（相对本脚本位置，不受 cwd 影响）；env MEMOWEFT_HOST_DB 覆盖。
const DB_PATH = process.env.MEMOWEFT_HOST_DB ?? join(import.meta.dirname, '..', 'data', 'host.db');
mkdirSync(dirname(DB_PATH), { recursive: true }); // 目录不存在则建（首启即可写库）

// 聊天历史目录：Host 自己的对话日志，【跟随库路径】——落在库文件同目录下的 sessions/。
//   这样用 MEMOWEFT_HOST_DB 指到隔离库时，聊天历史也一并隔离、不落默认 data/sessions（步3 遗留 TODO 收口）。
const SESSIONS_DIR = join(dirname(DB_PATH), 'sessions');

// 采集摄入（/api/observe）：采集插件 → Host 审核 → Core（架构归位路线 §3）。
//   COLLECTOR_ENABLED：部署级 kill-switch；env MEMOWEFT_HOST_COLLECTOR=off 时 UI 也不能绕过。缺省 on。
//   MAX_OBSERVE_BATCH：单次 POST 最多几条 observation（挡异常客户端一次灌爆）。
const COLLECTOR_ENABLED = (process.env.MEMOWEFT_HOST_COLLECTOR ?? 'on').toLowerCase() !== 'off';
const MAX_OBSERVE_BATCH = 200;

// 前端单文件（同目录 web/index.html）。
const INDEX_HTML = join(import.meta.dirname, 'web', 'index.html');

// ── 当前激活的体验插件（批次5「做插件」v1）──
// 回话人设不再硬编码，改由【当前激活的体验插件】提供 systemPrompt（普通助手 / 星瑶，见 experiences/）。
//   MemoWeft 本体冷静克制、不拟人（naming.md §6）；"知道自己有长期记忆、会自然想起用户过往"的注入
//   归宿主这一层，且现在按体验分家——各体验的语气 / 拟人度写在各自插件的 systemPrompt 里。
// Persona Store 独立于 MemoWeft：内置人格来自编译期 registry，用户人格与当前选择原子保存到 userData。
//   没有 Store 时沿用旧默认（Electron=xingyao、standalone=env/plain）；损坏/未知引用安全回退 plain。
const personaStore = new PersonaStore(
  join(app.getPath('userData'), 'weftmate-personas.json'),
  listBuiltinPersonas(),
  DEFAULT_EXPERIENCE_ID,
);

// plugins：把已注册插件传给 Core 让它烧 hook（experience 类无 hook 是 no-op；tool/collector 类在此生效）。
// let（非 const）：切模型档/改配置时【进程内热重建】——库在构造 core 时读死 env 里的 key/模型，改配置要重建 core
//   才生效（作者拍板"不重启进程、窗口不闪"，见 rebuildCore + weftmate-config-apply 记忆）。scheduler/handler 都经
//   模块级 core 引用,重建后自然指向新实例。
let core = createMemoWeftCore({ dbPath: DB_PATH, plugins: ALL_PLUGINS });
const profileOverrides = new ProfileOverrideStore(join(app.getPath('userData'), 'profile-overrides.json'));

// 聊天历史（Host 自建落盘）：目录级多对话管理器（一对话一 jsonl，见 chatHistory.ts）。
const history = createChatHistory(SESSIONS_DIR);

// ── 多对话状态（Host 自实现，蓝图 §3.3）──
// currentConvId：当前活跃对话（模块级，单用户单进程）。首启从磁盘拣一条【未归档且最近活跃】的续上；
//   没有历史对话 → 直接 newId 起一条新的。这样重启后能接着上次那条聊，不每次从空白开始。
let currentConvId: string = (() => {
  const existing = history.list().filter((s) => !s.archived);
  return existing[0]?.id ?? history.newId();
})();

// Agent 任务不跨进程恢复；若应用在采访中退出，重启时把流程明确收口为“可继续”，不伪装仍在进行。
const firstInterviewAtStartup = getFirstInterviewState();
if (firstInterviewAtStartup?.status === 'in_progress') {
  setFirstInterviewState(transitionFirstInterview(firstInterviewAtStartup, 'pause'));
}

/** 切换只有在 Persona Store 成功写盘后才改变运行态；Store 同次持久化全会话上下文边界。 */
function activatePersona(id: string) {
  return personaStore.setCurrent(id);
}

// 后台画像更新调度器（Host 自建）：注入 core.updateProfile，其余状态自持。
//   闭包取模块级 core（let）——热重建 core 后自然调新实例（无需重建 scheduler、pending 计数得以保留）。
const scheduler = createProfileScheduler({ updateProfile: () => core.updateProfile() });

// Agent 在后台完成时仍要落回它启动时所在的对话；用户可能在任务期间切到另一段对话，不能误写当前全局会话。
const agentTaskConversations = new Map<string, string>();
const agentTaskUserPersisted = new Set<string>();
const firstInterviewTasks = new Map<string, { conversationId: string; step: number; runId: string }>();
const ACTIVE_AGENT_STATUSES = new Set(['planning', 'running', 'awaiting']);

function activeAgentTask() {
  const activeTask = agent.listTasks().find((task) => ACTIVE_AGENT_STATUSES.has(task.status));
  return activeTask;
}

/** 旧人格任务结束前不能改变当前人格语义；守卫必须先于任何 Persona Store 写入。 */
function rejectPersonaChangeDuringActiveTask(
  res: import('node:http').ServerResponse,
  id?: string,
  onlyWhenCurrent = false,
  message?: string,
): boolean {
  if (!activeAgentTask()) return false;
  if (onlyWhenCurrent && id !== personaStore.currentId()) return false;
  sendJson(res, 409, { error: message ?? '当前回复结束后再切换人格' });
  return true;
}

function activeFirstInterviewTask() {
  return agent.listTasks().find((task) => ACTIVE_AGENT_STATUSES.has(task.status) && firstInterviewTasks.has(task.id));
}

let localDataWipePrepared = false;
let inFlightMutations = 0;
const mutationDrainWaiters = new Set<() => void>();

function finishMutation(): void {
  inFlightMutations = Math.max(0, inFlightMutations - 1);
  if (inFlightMutations === 0) {
    for (const resolve of mutationDrainWaiters) resolve();
    mutationDrainWaiters.clear();
  }
}

function waitForMutationDrain(timeoutMs = 3_000): Promise<boolean> {
  if (inFlightMutations === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const done = () => { clearTimeout(timer); mutationDrainWaiters.delete(done); resolve(true); };
    timer = setTimeout(() => { mutationDrainWaiters.delete(done); resolve(false); }, timeoutMs);
    mutationDrainWaiters.add(done);
  });
}

type WipePrepareResult = { ok: true } | { ok: false; status: 409; code: string; error: string };

/** 仅供 Electron 主进程在创建一次性擦除 marker 前调用。 */
export async function prepareLocalDataWipe(): Promise<WipePrepareResult> {
  if (localDataWipePrepared) return { ok: false, status: 409, code: 'WIPE_ALREADY_PREPARING', error: '删除全部本机数据已经在准备中。' };
  if (activeAgentTask()) return { ok: false, status: 409, code: 'WIPE_ACTIVE_AGENT', error: '还有任务没有结束，请等它结束后再删除本机数据。' };
  if (scheduler.status().profileUpdating) return { ok: false, status: 409, code: 'WIPE_PROFILE_UPDATING', error: '记忆还在整理中，请等整理结束后再删除本机数据。' };
  localDataWipePrepared = true;
  scheduler.freeze();
  const drained = await waitForMutationDrain();
  const activeAfterDrain = activeAgentTask();
  const profileUpdatingAfterDrain = scheduler.status().profileUpdating;
  if (!drained || activeAfterDrain || profileUpdatingAfterDrain) {
    localDataWipePrepared = false;
    scheduler.resume();
    if (!drained) return { ok: false, status: 409, code: 'WIPE_MUTATION_TIMEOUT', error: '仍有本机数据更改没有结束，请稍后再试。' };
    if (activeAfterDrain) return { ok: false, status: 409, code: 'WIPE_ACTIVE_AGENT', error: '还有任务没有结束，请等它结束后再删除本机数据。' };
    return { ok: false, status: 409, code: 'WIPE_PROFILE_UPDATING', error: '记忆还在整理中，请等整理结束后再删除本机数据。' };
  }
  return { ok: true };
}

/** marker 创建失败时由主进程撤销闸门；正常删除流程会立即退出，不会撤销。 */
export function cancelPreparedLocalDataWipe(): void {
  localDataWipePrepared = false;
  scheduler.resume();
}

function hasRealConversationHistory(): boolean {
  return history.list({ includeArchived: true }).some((session) => history.read(session.id).length > 0);
}

function firstInterviewIsFresh(): boolean {
  return core.memory.listEvidence().length === 0 && !hasRealConversationHistory();
}

function firstInterviewView() {
  const stored = getFirstInterviewState();
  const state = stored ?? newFirstInterviewState('');
  const modelReady = core.health().llmReady;
  const fresh = stored === null && firstInterviewIsFresh();
  const canOffer = fresh || (stored !== null && ['new', 'in_progress', 'paused', 'skipped'].includes(stored.status));
  // 首次安装要求“无持久状态 + 无真实数据”；恢复出厂会显式写回 new，也重新允许选择。
  const eligible = modelReady && (fresh || stored?.status === 'new');
  const modelBlocked = !modelReady && canOffer;
  const copy = firstInterviewCopy(state.step, resolvedLang());
  return {
    status: state.status,
    step: state.step,
    total: FIRST_INTERVIEW_TOTAL_STEPS,
    conversationId: state.conversationId,
    eligible,
    modelReady,
    modelBlocked,
    canContinue: modelReady && state.status === 'paused' && !!state.conversationId,
    question: copy.question,
  };
}

function refreshProfileAfterInterview(): void {
  // 与手动“立即整理”共用 scheduler 单飞锁；不阻塞采访收尾，也不制造第二条写画像路径。
  void scheduler.refreshNow().catch((error) => {
    console.error('首次认识结束后的记忆整理失败（不影响对话）：', error instanceof Error ? error.message : error);
  });
}

function persistAgentAttachments(convId: string, attachments: agent.AgentCompletionAttachment[]): HistoryAttachment[] {
  const savedAttachments: HistoryAttachment[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === 'file') {
      savedAttachments.push({ kind: 'file', name: attachment.name });
      continue;
    }
    try {
      const saved = history.saveImage(convId, attachment);
      savedAttachments.push(saved ?? { kind: 'file', name: attachment.name });
    } catch {
      // 资源落盘失败不吞掉整条消息，至少留下附件名。
      savedAttachments.push({ kind: 'file', name: attachment.name });
    }
  }
  return savedAttachments;
}

function persistAgentUserTurn(convId: string, taskText: string, attachments: agent.AgentCompletionAttachment[]): void {
  const savedAttachments = persistAgentAttachments(convId, attachments);
  history.append(convId, {
    role: 'user', content: taskText, ts: new Date().toISOString(),
    ...(savedAttachments.length ? { attachments: savedAttachments } : {}),
  });
}

// agent 干活（阶段2·帮你干活 第①块 · 方案B：Host 自建循环，见 agent.ts）：注入记忆接线。
//   闭包引用模块级 core（let）——热重建 core 后自然指向新实例，无需重配（同 scheduler 的路数）。
//   recall：开工前捞点"关于你"喂给 agent 当背景；record：干完把任务回写画像，让干活也进"越用越懂"循环。
//   agent 的中间对话（工具往返）只在 agent.ts 内部，不进 memoweft 的记忆/聊天链路。
agent.configureAgentDeps({
  // 必须动态读取 Persona Store：切换或编辑当前人格后，下一条统一 Agent 消息立即拿到最新角色。
  experience: () => {
    const current = personaStore.current();
    return {
      id: current.id,
      name: current.name,
      systemPrompt: current.systemPrompt,
      memoryReadEnabled: current.memoryReadEnabled,
    };
  },
  recall: async (query) => {
    // 二次硬守卫：即使 Agent 调用方未来漏判断，也必须在任何 MemoWeft / 本地画像读取前返回。
    if (!personaStore.current().memoryReadEnabled) return '';
    const sourceCognitions = core.memory.listCognitions();
    const recalled = profileOverrides.applyRecall(await core.recall({ query }), sourceCognitions).slice(0, 6);
    const seen = new Set(recalled.flatMap((item) => item.id ? [item.id] : []));
    // Core 的索引仍保存原 cognition 文案；用户改写后的关键词另做最多 6 条的本地命中补充。
    const supplemental = profileOverrides.matchingOverrides(
      sourceCognitions, query, seen, 6 - recalled.length,
    );
    return [...recalled, ...supplemental].map((r) => '· ' + r.content).join('\n');
  },
  record: async (taskText, summary) => {
    // C1：把 agent 真正干成了啥(summary) 也回写，别只记任务意图——让"帮你干活"真进"越用越懂"闭环。
    const done = summary && summary.trim() ? `\n结果：${summary.trim()}` : '';
    await core.ingestUserMessage({ content: `（让 WeftMate 帮我干活）${taskText}${done}` });
  },
  // 没调用任何工具就是普通聊天回答：只把用户原话作为证据，不加"帮我干活"标签。
  recordChat: async (userText, _reply, taskId) => {
    const interview = firstInterviewTasks.get(taskId);
    const originId = interview
      ? `weftmate-first-interview:${interview.runId}:${interview.step}`
      : `weftmate-agent:${taskId}`;
    await core.ingestUserMessage({ content: userText, originId });
  },
  // 无论是否用了工具，都把用户话和最终回答落进启动时的会话，刷新后仍能接着聊。
  complete: async (taskId, taskText, summary, usedTools, attachments, memoryRecorded) => {
    const convId = agentTaskConversations.get(taskId) ?? currentConvId;
    // 正常在 start 接受任务时就落用户轮；这里只是防竞态/写盘失败的兜底。
    if (!agentTaskUserPersisted.has(taskId)) persistAgentUserTurn(convId, taskText, attachments);
    history.append(convId, { role: 'assistant', content: summary || '完成。', ts: new Date().toISOString() });
    scheduler.onTurn();
    const interview = firstInterviewTasks.get(taskId);
    if (interview && !usedTools && memoryRecorded && interview.conversationId === convId) {
      const state = getFirstInterviewState();
      // 只有仍处于启动时那一轮才推进；暂停/跳过/切状态后的迟到回调不能越权改回来。
      if (
        state?.status === 'in_progress'
        && state.conversationId === convId
        && state.runId === interview.runId
        && state.step === interview.step
      ) {
        const next = advanceFirstInterview(state);
        setFirstInterviewState(next);
        if (next.status === 'completed') refreshProfileAfterInterview();
      }
    }
    agentTaskUserPersisted.delete(taskId);
    agentTaskConversations.delete(taskId);
    firstInterviewTasks.delete(taskId);
  },
  // done / failed / stopped 都会走这个终态回调；complete 只覆盖正常完成，不能让失败/叫停任务的会话映射常驻内存。
  settled: (taskId) => {
    agentTaskUserPersisted.delete(taskId);
    agentTaskConversations.delete(taskId);
    firstInterviewTasks.delete(taskId);
  },
  // MCP 工具接线（②·帮你干活）：延迟加载——只把 name/desc/签名交给 agent，完整 schema 留 mcp.ts。
  mcpTools: () => mcp.listAllTools().map((t) => ({ fqName: t.fqName, description: t.description, signature: t.signature, readOnly: t.readOnly })),
  callMcp: (fqName, args, signal) => mcp.callTool(fqName, args, signal),
  isMcpToolTrusted: (fqName) => getTrustedMcpTools().includes(fqName),   // F1：读明文信任列表；仅 auto 档据此免批
});

// 启动时连上所有【已启用】的 MCP 服务（后台·不阻塞起服；单个坏不拖累其余，见 mcp.reconcile）。
//   配置读 mcpStore（safeStorage 解密·app 已 ready）；连接是 fire-and-forget，起服不等它。
void mcp.reconcile(mcpStore.listServers());

/**
 * 进程内热重建 core（切模型档 / 改配置时调）。不重启进程、窗口不闪（作者二次拍板）。
 * 步骤：injectEnv 强刷 env=当前 active 档 → 建新 core → 关旧 core。
 * 旧 core 上若正好有在飞写路径，close 会抛 → try/catch 吞（少见、不致命）。
 */
function rebuildCore(): void {
  const old = core;
  configStore.injectEnv();                 // 先清后设：env 精确等于当前 active 档（切到没配 write/embed 的档时清掉旧残留）
  core = createMemoWeftCore({ dbPath: DB_PATH, plugins: ALL_PLUGINS });
  try { old.close(); } catch { /* 旧 core 若有在飞写路径会抛，吞掉——进程不重启、连接由新 core 接管 */ }
}

/**
 * 续聊上下文：把一条对话历史的最近几轮转成统一 Agent 使用的 {role, content}（剥掉 ts）。
 * 只取最近 config.workingMemory.maxTurns 条，避免旧会话无限撑大模型上下文。
 * 历史里 user/assistant 已是分开的两条，直接映射即可（无需像 testbench 从一条 run 记录拆两条）。
 */
function seedFor(conversationId: string): Array<{ role: HistoryTurn['role']; content: string }> {
  // 人格边界属于持久产品状态：所有会话、包括重启后的旧会话，都保留用户原话，只过滤边界前 assistant；
  // 边界后的新人格回复继续参与上下文，避免每一轮都退化成“只有用户消息”。
  const turns = filterPersonaHistory(history.read(conversationId), personaStore.assistantHistoryBoundaryAt());
  const recent = turns.slice(-config.workingMemory.maxTurns);
  return recent.map((t) => ({ role: t.role, content: t.content }));
}

// ── 小工具 ──

class RequestBodyTooLargeError extends Error {}

/** 读请求体为 JSON。UTF-8 护栏（testbench readJson 教训）：非法 UTF-8 解码出 U+FFFD → 拒收，防乱码入库。 */
function readJson(req: IncomingMessage, maxBytes = Number.POSITIVE_INFINITY): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let rejected = false;
    req.on('data', (c: Buffer) => {
      if (rejected) return;
      bytes += c.length;
      if (bytes > maxBytes) {
        rejected = true;
        chunks.length = 0;
        reject(new RequestBodyTooLargeError('请求体过大'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        if (body.includes('�')) {
          reject(new Error('请求体不是合法 UTF-8（Windows cmd 的 curl 会按 GBK 发中文；请改用界面，或以 UTF-8 编码发送）'));
          return;
        }
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: import('node:http').ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** Persona 错误只按稳定类别映射 HTTP；storage 绝不把底层系统错误或文件路径返回页面。 */
function personaErrorResponse(res: import('node:http').ServerResponse, error: unknown): void {
  if (error instanceof PersonaStoreError) {
    const status = error.code === 'storage' ? 500 : error.code === 'not_found' ? 404 : 400;
    sendJson(res, status, { error: error.message });
    return;
  }
  sendJson(res, 500, { error: '人格设置暂时无法处理' });
}

/**
 * 采集观察审核·清洗一条外来 observation（采集插件 POST 来的，不可信）。
 * 只保留 generic Observation 的安全字段；【强制剥掉所有授权位】——observed 数据默认不上云，
 *   插件无权自行放行 allowCloudRead（路线 §7「插件不能直接改 allowCloudRead」）。剥空后 Core
 *   ingestObservations 会套 observedDefaults（本地可读 / 不上云 / 可推画像），这是隐私红线。
 * kind / content 缺失 → 返回 null（丢弃这条）。occurredAt 非法/缺失 → 补成现在（防时间窗比较错位）。
 */
function sanitizeObservation(raw: unknown): Observation | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = String(o.kind ?? '').trim();
  const content = String(o.content ?? '').trim();
  if (!kind || !content) return null;
  const parsed = o.occurredAt ? new Date(String(o.occurredAt)) : new Date();
  const occurredAt = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  const clean: Observation = { kind, occurredAt, content };
  if (o.originId != null) clean.originId = String(o.originId);
  if (o.meta && typeof o.meta === 'object') clean.meta = o.meta as Record<string, unknown>;
  // 注意：不复制任何 allowCloudRead/allowLocalRead/allowInference —— 一律走 Core observedDefaults（不上云红线）。
  return clean;
}

// 配置向导·拼 .env 的纯字符串函数已抽到 ./genEnv.ts（便于单测：server.ts 顶层会 listen，不宜在测试里 import）。

// MCP 预置清单（②「一键装」·点一下预填表单，用户仍需确认）。都经 npx 运行（首次会下载·需 Node+网络）。
//   Windows spawn shell:false → npx 类必须走 command:'cmd' args:['/c','npx',...]（见 mcp.ts 说明）。
const DEFAULT_FS_DIR = app.getPath('documents'); // 文件系统预置默认开放"文档"夹（真实存在·避免占位目录连不上；用户可编辑收窄）

/**
 * 用户没选工作区时的安全默认值：文档/WeftMate。
 * 不放 userData——那里有数据库、会话与加密配置，不该暴露给 Agent；也不直接开放整个 Documents。
 */
function ensureDefaultAgentWorkspace(): string {
  return ensureWorkspaceInDocuments(DEFAULT_FS_DIR);
}

/** 会话是工作区的唯一真源；旧会话没有元数据时平滑归入默认工作区。 */
function workspaceForConversation(conversationId: string): string {
  return history.getWorkspace(conversationId) || ensureDefaultAgentWorkspace();
}
const MCP_CATALOG = [
  { key: 'filesystem', name: '文件系统', desc: '读写你指定的文件夹（默认你的"文档"夹，可在 args 末尾改）', command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-filesystem', DEFAULT_FS_DIR] },
  { key: 'memory', name: '知识记忆图', desc: '一个简单的知识图谱记忆库', command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-memory'] },
  { key: 'sequential-thinking', name: '分步思考', desc: '帮模型把复杂问题拆成一步步想', command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-sequential-thinking'] },
  { key: 'everything', name: '测试服务 everything', desc: 'MCP 官方测试服务，含各种示例工具（拿来试装最省事）', command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-everything'] },
];

const server = createServer(withLoopbackSecurity(currentLoopbackPolicy, async (req, res) => {
  let countedMutation = false;
  try {
    const url = new URL(req.url ?? '/', currentLoopbackPolicy().origin);
    const mutating = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (localDataWipePrepared && mutating) {
      sendJson(res, 423, { code: 'WIPE_PREPARING', error: '正在准备删除全部本机数据，已停止新的更改。' });
      return;
    }
    if (mutating) {
      inFlightMutations++;
      countedMutation = true;
    }
    // 前端：干净单文件 html（只含用户模式聊天）。
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const source = readFileSync(INDEX_HTML, 'utf-8')
        .replaceAll('__WEFTMATE_THEME__', getTheme())
        .replaceAll('__WEFTMATE_UI_LANG__', resolvedLang());
      const secured = secureHtmlDocument(source);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': secured.contentSecurityPolicy,
      });
      res.end(secured.html);
      return;
    }

    // 首启门（S3）：模型/嵌入器配没配 —— 前端据此决定先提示配置还是直接聊天。不需要 .env 也不崩。
    if (req.method === 'GET' && url.pathname === '/api/health') {
      // C7：附带本机是否有加密后端——Linux 无 keyring 时前端好提前警示"存不了模型密钥"，别到保存才崩。
      sendJson(res, 200, { ...core.health(), encryptionAvailable: configStore.encryptionAvailable(), uiLang: resolvedLang() });
      return;
    }

    // token 用量累计（步8·观测/计费）：宿主拿累计计数（llm/embed 分桶 + 合计）乘单价算钱——库只给原料、不内置价目表。
    //   端点常不回 usage（本地模型多见）时对应桶为 0；宿主要按对话/画像切分，自己在调用前后取差值即可。只读、不碰库。
    if (req.method === 'GET' && url.pathname === '/api/usage') {
      sendJson(res, 200, core.usage());
      return;
    }

    // 聊天历史：读回【当前对话】的轮列表，前端加载时渲染。空对话返回空列表、不报错。
    if (req.method === 'GET' && url.pathname === '/api/chat-history') {
      sendJson(res, 200, { turns: history.read(currentConvId), conversationId: currentConvId });
      return;
    }

    // ── 首次认识用户：流程端点只管理游标，不接收回答；回答仍唯一走 /api/agent/start。 ──
    if (req.method === 'GET' && url.pathname === '/api/first-interview') {
      sendJson(res, 200, firstInterviewView());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/first-interview/action') {
      const body = await readJson(req);
      const keys = Object.keys(body);
      if (keys.some((key) => !['action', 'expectedStep'].includes(key))) {
        sendJson(res, 400, { error: '首次认识流程端点只接受 action 和 expectedStep，不接受回答内容' });
        return;
      }
      const action = typeof body.action === 'string' ? body.action : '';
      if (!['start', 'pause', 'resume', 'skip', 'skip_step'].includes(action)) {
        sendJson(res, 400, { error: '不支持的首次认识操作' });
        return;
      }
      if (!Number.isInteger(body.expectedStep)) {
        sendJson(res, 400, { error: '首次认识操作缺少当前步骤' });
        return;
      }
      const activeInterview = activeFirstInterviewTask();
      if (activeInterview) {
        sendJson(res, 409, { error: '请先等当前回复结束，再调整这次认识。', taskId: activeInterview.id });
        return;
      }

      const stored = getFirstInterviewState();
      const current = stored ?? newFirstInterviewState();
      if (body.expectedStep !== current.step) {
        sendJson(res, 409, { error: '这次认识的进度已经变化，请按最新进度操作' });
        return;
      }
      if (action === 'resume' && !core.health().llmReady) {
        sendJson(res, 409, { error: '请先配置对话模型，再继续这次认识' });
        return;
      }
      try {
        let next: FirstInterviewState;
        if (action === 'start') {
          const canStart = core.health().llmReady && (
            stored?.status === 'skipped'
            || stored?.status === 'new'
            || (stored === null && firstInterviewIsFresh())
          );
          if (!canStart) {
            sendJson(res, 409, { error: core.health().llmReady ? '这不是空白的新用户状态' : '请先配置对话模型' });
            return;
          }
          next = transitionFirstInterview(current, 'start', { conversationId: currentConvId });
        } else {
          const canSkipFresh = action === 'skip' && stored === null && core.health().llmReady && firstInterviewIsFresh();
          if (!stored && !canSkipFresh) { sendJson(res, 409, { error: '还没有可操作的首次认识流程' }); return; }
          next = transitionFirstInterview(current, action as 'pause' | 'resume' | 'skip' | 'skip_step');
          if (action === 'resume') currentConvId = next.conversationId!;
        }
        setFirstInterviewState(next);
        if (next.status === 'completed') refreshProfileAfterInterview();
        sendJson(res, 200, { ok: true, ...firstInterviewView(), conversationId: next.conversationId });
      } catch (error) {
        sendJson(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    // 后台整理状态：前端顶栏轮询显示"正在整理记忆…/已整理"。
    if (req.method === 'GET' && url.pathname === '/api/bg-status') {
      sendJson(res, 200, scheduler.status());
      return;
    }

    // ── Persona API ──
    // 兼容列表：保留旧路径与 id/name/current 主字段，追加来源/只读摘要；完整 systemPrompt 只走详情接口。
    if (req.method === 'GET' && url.pathname === '/api/experiences') {
      const experiences = personaStore.listSummaries().map((persona) => ({
        ...persona,
        current: persona.id === personaStore.currentId(),
      }));
      sendJson(res, 200, { experiences, current: personaStore.currentId() });
      return;
    }

    // 新列表同样只给摘要，避免所有人格的完整提示词无条件进入页面。
    if (req.method === 'GET' && url.pathname === '/api/personas') {
      sendJson(res, 200, { personas: personaStore.listSummaries(), current: personaStore.currentId() });
      return;
    }

    // 单项详情：编辑器明确点开后才读取完整 systemPrompt；内置项也返回 editable=false 供 UI 只读提示。
    if (req.method === 'GET' && url.pathname === '/api/persona') {
      const id = (url.searchParams.get('id') ?? '').trim();
      if (!id) { sendJson(res, 400, { error: '缺少人格 id' }); return; }
      const persona = personaStore.get(id);
      if (!persona) { sendJson(res, 404, { error: '没有这个人格' }); return; }
      sendJson(res, 200, { persona, current: personaStore.currentId() });
      return;
    }

    // 人格包就是严格五字段 Manifest 根对象；只扫描这五字段是否疑似夹带密钥或本机路径。
    if (req.method === 'GET' && url.pathname === '/api/persona/export') {
      const id = (url.searchParams.get('id') ?? '').trim();
      if (!id) { sendJson(res, 400, { error: '缺少人格 id' }); return; }
      try {
        sendJson(res, 200, personaStore.exportManifest(id));
      } catch (error) {
        personaErrorResponse(res, error);
      }
      return;
    }

    // 导入不覆盖、不切换；64KB UTF-8 JSON 根对象由严格 Manifest 解析器逐字段验证。
    if (req.method === 'POST' && url.pathname === '/api/persona/import') {
      try {
        const body = await readJson(req, 64 * 1024);
        const persona = personaStore.importManifest(body);
        sendJson(res, 200, {
          ok: true,
          persona,
          current: personaStore.currentId(),
          personas: personaStore.listSummaries(),
        });
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) sendJson(res, 413, { error: '人格包不能超过 64KB' });
        else if (error instanceof PersonaStoreError) personaErrorResponse(res, error);
        else sendJson(res, 400, { error: '人格包不是合法的 UTF-8 JSON' });
      }
      return;
    }

    // 记忆读取权限只影响召回；当前人格切换时先切历史边界，旧 assistant 不能把召回内容绕回来。
    if (req.method === 'POST' && url.pathname === '/api/persona/memory-read') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少人格 id' }); return; }
      if (typeof body.enabled !== 'boolean') { sendJson(res, 400, { error: '记忆读取权限格式不正确' }); return; }
      if (rejectPersonaChangeDuringActiveTask(
        res,
        id,
        true,
        '当前回复结束后再调整这个人格的记忆权限',
      )) return;
      try {
        const persona = personaStore.setMemoryRead(id, body.enabled);
        sendJson(res, 200, {
          ok: true,
          persona,
          current: personaStore.currentId(),
          personas: personaStore.listSummaries(),
        });
      } catch (error) {
        personaErrorResponse(res, error);
      }
      return;
    }

    // 创建/编辑用户人格：服务端只抽取 Manifest 白名单字段；Store 内置项只读，且先写盘再更新运行态。
    if (req.method === 'POST' && url.pathname === '/api/persona') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (id && rejectPersonaChangeDuringActiveTask(res, id, true)) return;
      try {
        const saved = personaStore.save({
          id: id || undefined,
          name: body.name,
          description: body.description,
          systemPrompt: body.systemPrompt,
        });
        // Store 在编辑当前人格的同一次原子写中推进持久上下文边界；Agent 下一任务动态读取最新提示词。
        sendJson(res, 200, { ok: true, persona: saved, current: personaStore.currentId() });
      } catch (error) {
        personaErrorResponse(res, error);
      }
      return;
    }

    // 名称是独立的产品层设置：自定义人格更新 Manifest 名称；内置人格只写本机显示名覆盖，源码提示词不改。
    if (req.method === 'POST' && url.pathname === '/api/persona/name') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少人格 id' }); return; }
      if (rejectPersonaChangeDuringActiveTask(res, id, true)) return;
      try {
        const persona = personaStore.renamePersona(id, body.name);
        sendJson(res, 200, {
          ok: true,
          persona,
          current: personaStore.currentId(),
          personas: personaStore.listSummaries(),
        });
      } catch (error) {
        personaErrorResponse(res, error);
      }
      return;
    }

    // 内置人格删除写本机墓碑；自定义人格硬删除。删当前项时 Store 同一次原子写回退 plain 并推进历史边界。
    if (req.method === 'POST' && url.pathname === '/api/persona/delete') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少人格 id' }); return; }
      if (rejectPersonaChangeDuringActiveTask(res, id, true)) return;
      try {
        const removed = personaStore.removePersona(id);
        sendJson(res, 200, {
          ok: true,
          removed,
          current: personaStore.currentId(),
          personas: personaStore.listSummaries(),
        });
      } catch (error) {
        personaErrorResponse(res, error);
      }
      return;
    }

    // canonical 当前人格入口。
    if (req.method === 'POST' && url.pathname === '/api/persona/active') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要切换的人格 id' }); return; }
      if (rejectPersonaChangeDuringActiveTask(res)) return;
      try {
        const persona = activatePersona(id);
        sendJson(res, 200, { ok: true, current: persona.id });
      } catch (error) {
        personaErrorResponse(res, error);
      }
      return;
    }

    // 旧切换入口保留为同一 Persona Store 的兼容别名。
    if (req.method === 'POST' && url.pathname === '/api/experience') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要切换的人格 id' }); return; }
      if (rejectPersonaChangeDuringActiveTask(res)) return;
      try {
        const persona = activatePersona(id);
        sendJson(res, 200, { ok: true, current: persona.id });
      } catch (error) {
        personaErrorResponse(res, error);
      }
      return;
    }

    // 插件管理（第 7 步 v2）：列出全部已注册插件 + 类型 + 声明的权限（供插件管理面板只读展示）。
    //   experience 类的"启用"= 当前 Persona Store 选择；tool/collector 类注册即启用（v2 不做运行时装卸）。
    if (req.method === 'GET' && url.pathname === '/api/plugins') {
      const plugins = listPlugins().map((p) => ({
        ...p,
        // experience 的"启用"跟随当前人设；非 experience 注册即启用。
        active: p.type === 'experience' ? p.id === personaStore.currentId() : true,
      }));
      sendJson(res, 200, { plugins, activeExperience: personaStore.currentId() });
      return;
    }

    // 立即整理记忆（S1 · 用户主动，不等攒批）：用户点"立即整理记忆"按钮走这里。
    //   分歧点1 拍板：用户版"立即整理"进 Host，走 core.updateProfile（开发者版 genProfile 留 testbench）。
    //   【不并发】：refreshNow 走调度器【同一把单飞锁】——后台正忙则 ran:false（不抢、不排队），
    //   前端提示"正在整理中，稍等"。成功则回本轮新增/强化等摘要，前端据此刷胶囊/抽屉、织 S1 气泡。
    if (req.method === 'POST' && url.pathname === '/api/refresh') {
      const r = await scheduler.refreshNow();
      if (!r.ran) {
        // 后台正在整理 → 这次不重复跑；回 200 带 busy 标记（不是错误，是"已有一趟在跑"）。
        sendJson(res, 200, { ran: false, updating: true });
        return;
      }
      // 成功：回本轮摘要（含 newCognitions 供前端织 S1 气泡；created 数供提示"新记住 N 件"）。
      sendJson(res, 200, { ran: true, summary: r.summary });
      return;
    }

    // ── 采集观察摄入（采集器插件 → Host 审核 → Core，架构归位路线 §3）──
    // 采集插件（如 @memoweft/collector-active-window）把窗口样本映射成 generic Observation 后 POST 这里。
    // Host 审核三件事：① 部署 kill-switch 与用户实时 opt-in 必须同时开启，否则 403；
    //   ② 隐私红线——sanitizeObservation 强制剥掉授权位，observed 数据默认不上云（插件无权自行放行上云）；
    //   ③ 调 core.ingestObservation（插件绝不直穿 Core / Store）。前端无需入口——采集器直接 POST。
    if (req.method === 'POST' && url.pathname === '/api/observe') {
      if (!observationIngestionAllowed(COLLECTOR_ENABLED, getPerceptionEnabled())) {
        sendJson(res, 403, { error: '感知采集未开启' });
        return;
      }
      const body = await readJson(req);
      const rawList = Array.isArray(body.observations) ? body.observations : [];
      if (rawList.length === 0) {
        sendJson(res, 400, { error: '缺 observations（generic Observation 数组）' });
        return;
      }
      if (rawList.length > MAX_OBSERVE_BATCH) {
        sendJson(res, 400, { error: `一次最多 ${MAX_OBSERVE_BATCH} 条 observation` });
        return;
      }
      const observations = rawList.map(sanitizeObservation).filter((o): o is Observation => o !== null);
      if (observations.length === 0) {
        sendJson(res, 400, { error: 'observation 都不合法（需至少 kind + content）' });
        return;
      }
      // 上云授权（用户拍板的全局 opt-in）：sanitizeObservation 已剥掉所有授权位（插件/采集器无权自授权上云）。
      //   仅当【用户】在设置里显式开了"允许感知数据上云"时，server 才给每条显式加 allowCloudRead=true——
      //   ingestObservation 认"授权位显式 > observedDefaults"，于是这些 observed 可上云。默认关=不加=不上云（红线）。
      //   这是【用户授权】而非【插件自授权】，是隐私模型允许的口子。
      if (getPerceptionCloudAllowed()) {
        for (const o of observations) o.allowCloudRead = true;
      }
      // 审核通过 → 交 Core 落 observed 证据（subjectId 缺省=库主人；默认不带授权位=observedDefaults 不上云）。
      const stored = await core.ingestObservation({ observations });
      // stored=真新落库条数；其余=幂等命中（同 originId 重复采集）跳过。
      sendJson(res, 200, { stored: stored.length, skipped: observations.length - stored.length });
      return;
    }

    // ── 多对话（批次5 步4） ──
    // 会话册是 Host 的持久数据（扫 sessions 目录 jsonl），不从 Core 掏（蓝图 §3.3）。
    // 新建 = 换当前对话 id；列表 = history.list()；切换 = 改 currentConvId + 标未激活以触发 seed 重建；
    // 归档 = 文件加 .archived（数据不删）。

    // 新建对话：继承当前工作区并立即写入会话元数据，所以空白对话也会出现在对应工作区分组里。
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const workspace = workspaceForConversation(currentConvId);
      currentConvId = history.newId();
      history.setWorkspace(currentConvId, workspace);
      sendJson(res, 200, { ok: true, conversationId: currentConvId, workspace });
      return;
    }

    // 会话图片资源：只按 chatHistory 生成的安全 assetId 读取，拒绝任意路径与符号链接。
    if (req.method === 'GET' && url.pathname === '/api/session-image') {
      const session = url.searchParams.get('session') ?? '';
      const asset = url.searchParams.get('asset') ?? '';
      const image = history.readImage(session, asset);
      if (!image) { sendJson(res, 404, { error: '图片不存在' }); return; }
      res.writeHead(200, {
        'Content-Type': image.mime,
        'Content-Length': image.data.length,
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
      res.end(image.data);
      return;
    }

    // 会话列表：列所有未归档对话（供侧栏渲染），标出当前是哪条。按最后活跃倒序。
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const defaultWorkspace = ensureDefaultAgentWorkspace();
      const sessions = history.list().map((s) => {
        const workspace = s.workspace || defaultWorkspace;
        return {
        id: s.id,
        preview: s.preview,
        lastActiveMs: s.lastActiveMs,
        current: s.id === currentConvId,
          workspace,
          workspaceName: basename(workspace),
        };
      });
      sendJson(res, 200, {
        sessions,
        currentId: currentConvId,
        currentWorkspace: workspaceForConversation(currentConvId),
      });
      return;
    }

    // 打开一条对话：切换当前会话，并把它的历史与工作区返回前端。
    // 下一次统一 Agent 任务会直接从这条会话历史提取上下文。
    if (req.method === 'POST' && url.pathname === '/api/session/open') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要打开的对话 id' }); return; }
      // 白名单：只接受确实存在的对话 id（含已归档）——挡住 sanitizeId 多对一碰撞/非规范 id，
      //   也保证 currentConvId 与 /api/sessions 列出的 id 口径一致（否则侧栏当前高亮会错位）。
      const known = history.list({ includeArchived: true }).some((s) => s.id === id);
      if (!known) { sendJson(res, 404, { error: '没有这条对话' }); return; }
      currentConvId = id; // id 来自 list、已是规范安全形态
      sendJson(res, 200, {
        ok: true,
        conversationId: id,
        turns: history.read(id),
        workspace: workspaceForConversation(id),
      });
      return;
    }

    // 归档一条对话（软移除）：jsonl 加 .archived 后缀，数据不删、可恢复。
    //   归档的若是当前对话，自动切到另一条未归档的（没有就新建一条），避免 current 悬空。
    if (req.method === 'POST' && url.pathname === '/api/session/archive') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要归档的对话 id' }); return; }
      const archivedWorkspace = workspaceForConversation(id);
      history.archive(id);
      let archivedCurrent = false;
      if (id === currentConvId) {
        const rest = history.list().filter((s) => !s.archived);
        if (rest[0]) {
          currentConvId = rest[0].id;
        } else {
          currentConvId = history.newId();
          history.setWorkspace(currentConvId, archivedWorkspace);
        }
        archivedCurrent = true;
      }
      sendJson(res, 200, {
        ok: true,
        currentId: currentConvId,
        archivedCurrent,
        workspace: workspaceForConversation(currentConvId),
      });
      return;
    }

    // ── 模型配置(阶段1·②③ · 多模型档 + safeStorage 加密落盘 + 进程内热重建) ──
    // key 走 Electron safeStorage 加密存 userData(不明文)。设置弹窗里管理多个模型档(增删改),底部下拉切 active 档。
    // 生效=【进程内热重建 core】(不重启进程、窗口不闪,见 rebuildCore / 记忆 weftmate-config-apply)。
    //   ⚠ 隐私:所有 POST 的 body 含 apiKey,只在 handler 栈内流过(交 config-store 加密),不 console.log(body)、不入模块级变量。

    // 读【安全视图】:profiles(每档剥掉 apiKey,只留 name/baseUrl/model + hasKey) + activeId + configured。前端据此渲染下拉/设置。
    if (req.method === 'GET' && url.pathname === '/api/model-config') {
      sendJson(res, 200, configStore.readPublicView());
      return;
    }

    // 增/改一个模型档:body {id?, name, llm*, write*, embed*}。id 缺=新建;带 id=改(空 key 沿用旧 key)。
    //   对话组 baseUrl/model 恒必填;apiKey 仅"新档 / 该档此前没存过 key"时必填。存完若该档是 active → 热重建 core 生效。
    if (req.method === 'POST' && url.pathname === '/api/model-config/profile') {
      const body = await readJson(req);
      const s = (v: unknown): string => String(v ?? '').trim();
      const id = s(body.id) || undefined;
      const llmBase = s(body.llmBaseUrl), llmKey = s(body.llmApiKey), llmModel = s(body.llmModel);
      const view = configStore.readPublicView();
      const existing = id ? view.profiles.find((p) => p.id === id) : null;
      const missing: string[] = [];
      if (!llmBase) missing.push('接口地址');
      if (!llmModel) missing.push('模型名');
      if (!llmKey && !existing?.llm?.hasKey) missing.push('密钥');
      if (missing.length) { sendJson(res, 400, { error: '对话模型必填:' + missing.join('、') }); return; }

      const wBase = s(body.writeBaseUrl), wKey = s(body.writeApiKey), wModel = s(body.writeModel);
      const eBase = s(body.embedBaseUrl), eKey = s(body.embedApiKey), eModel = s(body.embedModel);
      let savedId: string;
      try {
        savedId = configStore.upsertProfile({
          id, name: s(body.name),
          llm: { baseUrl: llmBase, apiKey: llmKey, model: llmModel },
          write: (wBase || wKey || wModel) ? { baseUrl: wBase, apiKey: wKey, model: wModel, tier: s(body.writeTier).toLowerCase() === 'local' ? 'local' : 'cloud' } : null,
          embed: (eBase || eKey || eModel) ? { baseUrl: eBase, apiKey: eKey, model: eModel } : null,
        });
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
      const activeId = configStore.readPublicView().activeId;
      if (activeId === savedId) rebuildCore(); // 改的正是当前生效档 → 热重建让新 key/模型即刻生效
      sendJson(res, 200, { ok: true, id: savedId, activeId });
      return;
    }

    // 切 active 档:body {id} → setActive → 热重建 core（底部下拉切模型走这，不重启不闪）。
    if (req.method === 'POST' && url.pathname === '/api/model-config/active') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id || !configStore.setActive(id)) { sendJson(res, 404, { error: '没有这个模型档' }); return; }
      rebuildCore();
      sendJson(res, 200, { ok: true, activeId: id });
      return;
    }

    // 删一个档:body {id} → deleteProfile（若删的是 active，activeId 落到剩下第一个或 null）→ 热重建。
    if (req.method === 'POST' && url.pathname === '/api/model-config/delete') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要删除的模型档 id' }); return; }
      const activeId = configStore.deleteProfile(id);
      rebuildCore(); // active 可能已变(或清空)→ 重建让 core 对齐当前 active（没有档则回落未配态）
      sendJson(res, 200, { ok: true, activeId });
      return;
    }

    // ── 设置 · 感知开关（阶段2·感知→画像）──
    // 感知采集 opt-in（默认关，见 settings.ts）。GET 读当前开关；POST 切换 → 写设置 + 启/停采集器。
    //   采集器采到的样本仍走 /api/observe 审核层（sanitizeObservation 强制 observed 不上云，隐私红线）。
    if (req.method === 'GET' && url.pathname === '/api/settings') {
      sendJson(res, 200, {
        // 多源结构 + 全局 cloudAllowed（默认不上云红线）+ running（采集器当前是否在跑）。
        perception: { ...readPerceptionView(), running: collector.isCollectorRunning() },
        language: { setting: getLanguage(), resolved: resolvedLang() }, // setting=auto/zh/en(用户选)·resolved=实际生效 zh/en
        appearance: { theme: getTheme() },
        agent: { autonomy: getAgentAutonomy() },
      });
      return;
    }

    // 库产出语言(认知/摘要)：body {lang:'auto'|'zh'|'en'} → 存设置 + 【运行期直接改 memoweft config.language】即刻生效、不重启。
    //   consolidate/distill 调用时读 config.language(共享单例·引用),改了下次整理就出对应语言。聊天回复本就跟用户语言、不受影响。
    if (req.method === 'POST' && url.pathname === '/api/settings/language') {
      const body = await readJson(req);
      const lang = body.lang === 'zh' || body.lang === 'en' ? body.lang : 'auto';
      setLanguage(lang);
      config.language = resolvedLang(); // 运行期改共享单例 → 下次消化即生效(无需重建 core)
      sendJson(res, 200, { ok: true, setting: getLanguage(), resolved: config.language });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/settings/theme') {
      const body = await readJson(req);
      const theme = body.theme === 'light' ? 'light' : 'dark';
      setTheme(theme);
      sendJson(res, 200, { ok: true, theme: getTheme() });
      return;
    }
    // Agent 自主度由持久化设置唯一授权。非法值 400 且 setAgentAutonomy 不会改写旧值。
    if (req.method === 'POST' && url.pathname === '/api/settings/agent-autonomy') {
      const body = await readJson(req);
      const autonomy = setAgentAutonomy(body.autonomy);
      if (!autonomy) { sendJson(res, 400, { error: 'autonomy 必须是 suggest、ask 或 auto' }); return; }
      sendJson(res, 200, { ok: true, autonomy });
      return;
    }
    // 感知设置（部分更新：只改 body 里带的字段）——桌面开关 / 全局上云 / 采集内容。
    if (req.method === 'POST' && url.pathname === '/api/settings/perception') {
      const body = await readJson(req);
      if (typeof body.enabled === 'boolean') {
        setPerceptionEnabled(body.enabled);
        if (body.enabled && COLLECTOR_ENABLED) collector.startCollector(boundPort!, LOOPBACK_TOKEN);
        else collector.stopCollector(); // 桌面源启停；env off 是不可被 UI 绕过的 kill-switch
      }
      if (typeof body.cloudAllowed === 'boolean') {
        setPerceptionCloudAllowed(body.cloudAllowed); // 上云在摄入时应用,无需重启采集器
      }
      if (body.capture === 'app_title' || body.capture === 'app_only') {
        setDesktopCapture(body.capture); // 采集器每次采样读它,即时生效
      }
      sendJson(res, 200, { ok: true, perception: { ...readPerceptionView(), running: collector.isCollectorRunning() } });
      return;
    }

    // ── 记忆管理页（批次5 步3） ──
    // 全走 core.memory.*（步0 已补齐的受控 API），绝不直接摸 store（Host 边界红线）。
    // 只做【列取 / 标失效 / 改授权 / 删除】，不做内容编辑（用户拍板：编辑记忆文案留 testbench）。
    // 管理操作都带 reason，进审计表 management_log，留"我的记忆被怎么了"的痕迹。

    // 列"对你的理解"（认知）：每条含 sources 溯源 + 读时算的有效把握度。前端据此渲染理解列表。
    if (req.method === 'GET' && url.pathname === '/api/cognition') {
      // 每条附 confBand：按【有效把握度】(effectiveConfidence，衰减后)定的用户档，让前端如实反映"会变淡"。
      //   阈值取自 Core config（不硬编码、不漂移）；档位逻辑抽在 confBand.ts、有单测护栏。
      const thresholds = config.consolidation.credThresholds;
      const cognitions = profileOverrides.applyCognitions(core.memory.listCognitions())
        .map((c) => c.overridden || c.rejectedByUser ? c : ({ ...c, confBand: credBand(c, thresholds) }));
      sendJson(res, 200, { cognitions });
      return;
    }

    // 记忆胶囊数（S0）：聊天页顶栏「它记住我 N 件事」的 N = 当前【活跃理解】条数（未失效且未归档）。
    //   单开一个轻量端点，让聊天页顶栏轮询它就够——不必在聊天页拉整份 /api/cognition 列表（那是记忆管理页/抽屉的活）。
    //   口径与记忆抽屉列表里"活跃"的过滤一致（!invalidAt && !archivedAt），胶囊数和抽屉里看到的对得上。
    if (req.method === 'GET' && url.pathname === '/api/cognition/count') {
      const active = profileOverrides.applyCognitions(core.memory.listCognitions())
        .filter((c) => !c.invalidAt && !c.archivedAt && !c.needsReview);
      sendJson(res, 200, { count: active.length });
      return;
    }

    // 列"记忆线索"（证据）：原话/摘要 + 来源 + 授权位。前端据此渲染证据列表。
    if (req.method === 'GET' && url.pathname === '/api/evidence') {
      sendJson(res, 200, { evidences: core.memory.listEvidence() });
      return;
    }

    // 记忆图谱（步5-G2）：产 { nodes, edges, stats } payload，供"记忆图谱" tab 手搓力导向图渲染。
    //   全走 core.graph.buildMemoryGraph（门面收口，绝不直接摸 store）。
    //   后端默认不含失效/归档；前端勾"也显示"时带 includeInvalid=true/includeArchived=true 重新 fetch。
    if (req.method === 'GET' && url.pathname === '/api/memory-graph') {
      const sp = url.searchParams;
      const graph = core.graph.buildMemoryGraph({
        includeEvidence: sp.get('includeEvidence') !== 'false',
        includeInvalid: sp.get('includeInvalid') === 'true',
        includeArchived: sp.get('includeArchived') === 'true',
      });
      const cognitionViews = profileOverrides.applyCognitions(core.memory.listCognitions());
      const viewById = new Map(cognitionViews.map((item) => [item.id, item]));
      graph.nodes = graph.nodes.map((node) => {
        if (node.kind !== 'cognition') return node;
        const view = viewById.get(node.id);
        if (!view || view.needsReview || (!view.overridden && !view.rejectedByUser)) return node;
        const { confidence: _confidence, credStatus: _credStatus, ...rest } = node;
        const content = view.overridden ? view.content : (node.summary ?? node.label);
        return {
          ...rest,
          summary: content,
          label: content.length > 40 ? `${content.slice(0, 39)}…` : content,
          val: 8,
          ...(view.overridden ? { userConfirmed: true } : {}),
          ...(view.rejectedByUser ? { userRejected: true } : {}),
          ...(view.restoredFromRejection ? { userRestored: true } : {}),
        } as typeof node;
      });
      const graphIds = new Set(graph.nodes.map((node) => node.id));
      for (const view of cognitionViews) {
        if (!view.independent || view.needsReview || graphIds.has(view.id)) continue;
        graph.nodes.push({
          id: view.id,
          kind: 'cognition',
          label: view.content.length > 40 ? `${view.content.slice(0, 39)}…` : view.content,
          summary: view.content,
          contentType: view.contentType,
          formedBy: view.formedBy,
          createdAt: view.createdAt,
          updatedAt: view.updatedAt,
          val: 8,
          colorKey: 'cognition',
          userConfirmed: true,
          ...(view.restoredFromRejection ? { userRestored: true } : {}),
        } as (typeof graph.nodes)[number]);
        graph.stats.nodeCount++;
        graph.stats.activeCognitionCount++;
      }
      sendJson(res, 200, graph);
      return;
    }

    // 修改画像只写 WeftMate 覆盖层；MemoWeft cognition/evidence/export 均保持原样。
    if (req.method === 'POST' && url.pathname === '/api/cognition/override') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!id || !content) { sendJson(res, 400, { error: '修改画像需要条目和新内容' }); return; }
      if (content.length > 4_000) { sendJson(res, 400, { error: '画像内容过长，请缩短后再保存' }); return; }
      const existingOverride = profileOverrides.get(id);
      const original = core.memory.listCognitions().find((item) => item.id === id);
      if (!existingOverride?.independent && (!original || original.invalidAt || original.archivedAt)) {
        sendJson(res, 409, { error: '底层理解已经变化，请先选择继续采用或放弃修改' });
        return;
      }
      const record = profileOverrides.set(id, content, original);
      const cognition = profileOverrides.applyCognitions(core.memory.listCognitions()).find((item) => item.id === id);
      sendJson(res, 200, { ok: true, cognition: cognition ?? { id, content: record.content, overridden: true, independent: true } });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/cognition/override/keep') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要继续采用的条目 id' }); return; }
      const views = profileOverrides.applyCognitions(core.memory.listCognitions());
      const view = views.find((item) => item.id === id);
      if (!view?.needsReview) { sendJson(res, 409, { error: '这条修改当前不需要确认' }); return; }
      const kept = profileOverrides.keepIndependent(id);
      sendJson(res, kept ? 200 : 404, { ok: !!kept, cognition: kept ? profileOverrides.applyCognitions(core.memory.listCognitions()).find((item) => item.id === id) : null });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/cognition/override/restore') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要恢复的条目 id' }); return; }
      const original = core.memory.listCognitions().find((item) => item.id === id);
      const restored = profileOverrides.remove(id);
      profileOverrides.removeRejection(id);
      sendJson(res, 200, { ok: true, restored, cognition: original ? { ...original, overridden: false } : null });
      return;
    }

    // 暂时不用只调公开 muteCognition：仍是 active 画像、保留演化与溯源，但不再进入 recall。
    if (req.method === 'POST' && url.pathname === '/api/cognition/mute') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id || typeof body.muted !== 'boolean') { sendJson(res, 400, { error: '静音操作缺少条目或状态' }); return; }
      const override = profileOverrides.get(id);
      const updated = override?.independent
        ? profileOverrides.setIndependentMuted(id, body.muted)
        : core.memory.muteCognition({
          cognitionId: id,
          muted: body.muted,
          reason: body.muted ? 'host:用户暂时不用这条画像' : 'host:用户恢复使用这条画像',
        });
      sendJson(res, updated ? 200 : 404, { updated: !!updated, cognition: updated, ...(!updated ? { error: '这条理解已经不在了' } : {}) });
      return;
    }

    // 指正只接受 active inferred。正确内容先幂等摄入，再走 scheduler 的公开 updateProfile 路径；旧推断仍 active 则公开失效兜底。
    if (req.method === 'POST' && url.pathname === '/api/cognition/correct') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要指正的条目 id' }); return; }
      if (content.length > 4_000) { sendJson(res, 400, { error: '指正内容过长，请缩短后再提交' }); return; }
      const cognition = core.memory.listCognitions().find((item) => item.id === id);
      if (!cognition) { sendJson(res, 404, { error: '这条理解已经不在了' }); return; }
      if (cognition.invalidAt || cognition.archivedAt || cognition.formedBy !== 'inferred') {
        sendJson(res, 409, { error: '只有仍在使用中的推断可以指正' });
        return;
      }

      if (!content) {
        const invalidated = core.memory.invalidateCognition({ cognitionId: id, reason: 'host:用户否定推断且未提供正确内容' });
        if (invalidated) profileOverrides.markRejected(id);
        sendJson(res, invalidated ? 200 : 404, { ok: !!invalidated, status: 'applied', invalidated: !!invalidated });
        return;
      }

      const originId = cognitionCorrectionOriginId(id, content);
      const evidence = await core.ingestUserMessage({ content, originId });
      let status: 'applied' | 'pending' = 'applied';
      try {
        const refresh = await scheduler.refreshNow();
        if (!refresh.ran) {
          status = 'pending';
          scheduler.onTurn();
        }
      } catch {
        status = 'pending';
        scheduler.onTurn();
      }
      const stillActive = core.memory.listCognitions().find((item) => item.id === id && !item.invalidAt && !item.archivedAt);
      const invalidated = stillActive
        ? core.memory.invalidateCognition({ cognitionId: id, reason: 'host:用户指正推断后的旧项兜底失效' })
        : null;
      profileOverrides.remove(id);
      profileOverrides.removeRejection(id);
      sendJson(res, status === 'pending' ? 202 : 200, {
        ok: true,
        status,
        evidenceId: evidence.id,
        invalidatedOld: !stillActive || !!invalidated,
        message: status === 'pending' ? '指正已记下，画像仍待后台整理' : '指正已记下并完成整理',
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/cognition/rejection/undo') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要撤销否定的条目 id' }); return; }
      if (!profileOverrides.hasRejection(id)) { sendJson(res, 404, { error: '没有找到这条否定记录' }); return; }
      const source = core.memory.listCognitions().find((item) => item.id === id) ?? null;
      if (!source) { sendJson(res, 404, { error: '原理解已经被永久删除，无法恢复' }); return; }
      const restored = profileOverrides.restoreRejected(source);
      const cognition = restored
        ? profileOverrides.applyCognitions(core.memory.listCognitions()).find((item) => item.id === id)
        : null;
      sendJson(res, restored && cognition ? 200 : 409, { ok: !!restored && !!cognition, cognition, ...(!restored || !cognition ? { error: '撤销否定没有完成，请重试' } : {}) });
      return;
    }

    // 标失效一条理解（invalidAt=now，条目与溯源都保留、召回跳过；不是删除）。
    if (req.method === 'POST' && url.pathname === '/api/cognition/invalidate') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要标失效的条目 id' }); return; }
      const override = profileOverrides.get(id);
      const independent = override?.independent === true;
      const updated = independent ? { id } : core.memory.invalidateCognition({ cognitionId: id, reason: 'host:用户在记忆管理页标失效' });
      const overrideRemoved = override ? profileOverrides.remove(id) : false;
      profileOverrides.removeRejection(id);
      // 不存在返回 null（受控 API 口径）：如实回 removed=false，别假报成功。
      sendJson(res, 200, { invalidated: !!updated, overrideRemoved, cognition: updated });
      return;
    }

    // 删一条理解（连溯源链一起删，挂着的原话证据本身不动）+ 审计。
    if (req.method === 'POST' && url.pathname === '/api/cognition/delete') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要删除的条目 id' }); return; }
      const override = profileOverrides.get(id);
      const independent = override?.independent === true;
      const r = independent
        ? { removed: profileOverrides.remove(id), cognitionId: id, productLayer: true }
        : core.memory.removeCognitionSafely({ cognitionId: id, reason: 'host:用户删除' });
      const overrideRemoved = !independent && override ? profileOverrides.remove(id) : false;
      profileOverrides.removeRejection(id);
      // removed=false = 目标早已不存在（别处/后台先删了）：如实回传，前端刷新同步。
      sendJson(res, 200, { ...r, removed: r.removed || overrideRemoved, sourceRemoved: r.removed, overrideRemoved });
      return;
    }

    // 改一条记忆线索的授权位（能否用于云端 allowCloudRead / 能否据此推测 allowInference）+ 审计。
    if (req.method === 'POST' && url.pathname === '/api/evidence/authorization') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要改授权的条目 id' }); return; }
      // 授权位只收布尔；没传的位不动（受控 API 用 undefined 表示"不改这一位"）。
      const allowCloudRead = typeof body.allowCloudRead === 'boolean' ? body.allowCloudRead : undefined;
      const allowInference = typeof body.allowInference === 'boolean' ? body.allowInference : undefined;
      const updated = core.memory.updateEvidenceAuthorization({
        evidenceId: id, allowCloudRead, allowInference, reason: 'host:用户改授权',
      });
      sendJson(res, 200, { updated: !!updated, evidence: updated });
      return;
    }

    // 删一条记忆线索（证据）。默认【先不 force】：若被事件/认知引用 → 返回 removed=false + blockers 影响面，
    //   前端提示"这条被 N 处用到"后，用户确认再带 force=true 重试（此时断链一并删）。
    if (req.method === 'POST' && url.pathname === '/api/evidence/delete') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要删除的条目 id' }); return; }
      const force = body.force === true; // 只有显式 true 才强删；缺省/其它值都当作先探路（不 force）
      const r = core.memory.removeEvidenceSafely({ evidenceId: id, force, reason: 'host:用户删除' });
      // r = { removed, blockers }：removed=false 且 blockers 非空 = 有引用被拦（原样回传给前端提示影响面）。
      sendJson(res, 200, r);
      return;
    }

    // ── 数据 / 备份（批次5 步5） ──
    // 导出/导入/恢复出厂全走 core.portable.* / core.memory.resetSubject——不让 Host 自己遍历 store、不自己拼/解 bundle。

    // 导出记忆包：core.portable.exportBundle() 组三层数据 + 溯源为 MemoryBundle（缺 subjectId 用 Core 缺省 subject）。
    //   取舍：这里【返回 JSON（{ bundle }）由前端存盘】，不设 Content-Disposition 让后端直吐文件。
    //   理由——同源 fetch 拿到的响应体不会触发浏览器"下载"，得靠前端 Blob + a[download] 存盘；后端多设一个下载头
    //   反而在 fetch 场景没用、还得处理文件名编码。前端已有 Blob 存盘路径（见 web/index.html memExport），后端只管给数据最简。
    //   不需要 LLM / .env，不碰会话；向量索引不入包（派生物，导入后重建）。
    if (req.method === 'GET' && url.pathname === '/api/export-bundle') {
      const bundle = core.portable.exportBundle();
      sendJson(res, 200, { bundle });
      return;
    }

    // 导入记忆包：body = { bundle, mode:'dryRun'|'merge' }。
    //   先 validateBundle 拦非法包（非对象/格式错/引用悬空）→ 400 带 errors；合法才 importBundle。
    //   dryRun：只校验+试算将写入/重复条数、【不写库】；merge：真导（走 Core 内 transaction 原子化）。
    //   merge 成功建议前端提示"更新画像"重建召回（向量索引不入包，需重建才能语义想起导入的旧事）。
    if (req.method === 'POST' && url.pathname === '/api/import-bundle') {
      const body = await readJson(req);
      const mode = body.mode === 'merge' ? 'merge' : 'dryRun'; // 只认 merge，其余（含缺省/非法）一律当安全的 dryRun
      const bundle = body.bundle; // 可能是任意 JSON——先交给 validateBundle 严格把关，别信任

      // 先校验：非法包绝不进 importBundle、绝不写库；把 errors 摆给前端友好报错。
      const validation = core.portable.validateBundle(bundle);
      if (!validation.valid) {
        sendJson(res, 400, { error: '这个记忆包不能用', errors: validation.errors, warnings: validation.warnings });
        return;
      }
      // 合法：dryRun 试算不写 / merge 真导，返回 ImportPlan（counts=将写入或已写入；duplicates=已存在跳过）。
      const plan = core.portable.importBundle(bundle as MemoryBundle, { mode });
      const out: { plan: typeof plan; needsReindex?: boolean } = { plan };
      if (mode === 'merge' && plan.valid) out.needsReindex = true; // 向量索引不入包 → 建议重建召回
      sendJson(res, 200, out);
      return;
    }

    // ── 恢复出厂 · 清空全部记忆（批次5 步5 · ⚠⚠⚠ 破坏性极强 · 红线）──
    // ⚠ 红线（MEMORY 有误删事故教训）：resetSubject 会清空【全部记忆】——三层记忆(证据/经历/理解) + 审计表 + 向量索引，
    //   不可逆。冒烟/自测这条【绝对只对临时库/副本库跑】（env MEMOWEFT_HOST_DB 指临时路径），绝不碰默认 data/host.db 或真实库。
    // 全走 core.memory.resetSubject（步0 已收口：清三层 + 清审计 + 清索引，缺省 subject；库内四张表包在一个事务里）——
    //   不让 Host 自己遍历 store 逐条删（那样容易漏 indexAll([]) / managementLog.clear() 某一步）。
    // 对 Host 自己的会话历史（sessions/*.jsonl）的处理【本 handler 额外做】：
    //   resetSubject 只清 Core 的记忆库、【不碰 Host 的 sessions 文件】（那是 Host 职责、Core 够不着也不该碰）。
    //   "清空全部记忆·重新开始"对用户的语义是从头开始，若把满屏旧对话留着、只清了背后的记忆，体验割裂。
    //   所以出厂后 Host 顺手：① 归档当前所有未归档会话（archive=加 .archived 后缀，不硬删——留一线可挖回，合 MemoWeft 不毁历史的调性）；
    //     ② newSession() 开一条全新空对话作当前。这样用户回到聊天页是干净空白，旧对话文件仍在磁盘（归档态），不是永久抹除。
    if (req.method === 'POST' && url.pathname === '/api/factory-reset') {
      // 纵深防御（防 CSRF / 误触发直连）：要求 body 带确认词「清空」。
      //   恶意网页对本地服务发的 simple-request（无 body）到不了这一步 → 400；而带 JSON body 会触发
      //   CORS preflight，本地无鉴权服务不响应 preflight → 浏览器挡下跨源清库。CORS 只挡"读响应"、不挡
      //   "请求到达并执行"，所以裸端点直连就能清库——这里加一道服务端确认兜底。前端另有"输入清空二字"强确认。
      const body = await readJson(req);
      if (body.confirm !== '清空' && body.confirm !== 'Clear') { sendJson(res, 400, { error: '清空记忆需要确认（body 缺 confirm）' }); return; }
      // 确认正文读完后再做最终闸门；从这里到同步清库之间不再 await，避免检查通过后又启动在途写入。
      const activeTask = activeAgentTask();
      if (activeTask) {
        sendJson(res, 409, { error: '还有任务没有结束，请等它结束后再清空记忆。', taskId: activeTask.id });
        return;
      }
      if (scheduler.status().profileUpdating) {
        sendJson(res, 409, { error: '记忆还在整理中，请等整理结束后再清空记忆。' });
        return;
      }
      // 破坏性收口：清 Core 记忆库（三层 + 审计 + 向量索引）。返回四个清除计数。
      const counts = core.memory.resetSubject({ reason: 'host:用户在记忆管理页清空记忆' });
      profileOverrides.clear();

      // Host 会话历史：归档所有未归档对话（软移除、不硬删），再开一条空对话作当前 → 用户回到干净空白。
      //   history.list() 默认只列未归档，逐个 archive（加 .archived 后缀，数据留盘可挖回）。
      const active = history.list();
      for (const s of active) {
        history.archive(s.id);
      }
      const sessionsArchived = active.length;
      currentConvId = history.newId(); // 全新空对话作当前
      resetFirstInterviewState(); // 清空记忆后重新提供“聊两三句 / 先跳过”的选择

      sendJson(res, 200, { ok: true, ...counts, sessionsArchived, conversationId: currentConvId });
      return;
    }

    // ── agent 干活（阶段2·帮你干活 第①块 · 方案B：Host 自建循环，见 agent.ts）──
    // 信任框架：计划→确认(三档自主度)→执行(沙箱)→每步可视→一键撤回。任务后台跑，前端轮询 status 刷步骤卡。
    // 隐私：工作区文件/命令输出会发给用户配置的模型（可能云端），由用户主动发起任务视为同意（前端写明）。

    // 工作区跟随当前会话；旧会话首次进入时绑定到专用默认工作区。
    if (req.method === 'GET' && url.pathname === '/api/agent/workspace') {
      const defaultWorkspace = ensureDefaultAgentWorkspace();
      const workspace = history.getWorkspace(currentConvId) || defaultWorkspace;
      if (!history.getWorkspace(currentConvId)) history.setWorkspace(currentConvId, workspace);
      sendJson(res, 200, {
        path: workspace,
        name: basename(workspace),
        isDefault: workspace === defaultWorkspace,
      });
      return;
    }
    // 选工作区文件夹：Electron 目录选择框（server 在主进程，可直接用 dialog）。返回选中的绝对路径。
    if (req.method === 'POST' && url.pathname === '/api/agent/pick-workspace') {
      const currentWorkspace = workspaceForConversation(currentConvId);
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
      const r = win
        ? await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: currentWorkspace })
        : await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: currentWorkspace });
      const workspace = r.filePaths[0] ?? null;
      if (workspace) history.setWorkspace(currentConvId, workspace);
      sendJson(res, 200, { canceled: r.canceled, path: workspace });
      return;
    }

    // 开工：body {task, workspace, attachments} → 返回 taskId（后台跑，前端轮询）。
    //   安全边界：忽略请求体里的 autonomy；只读用户持久化设置，避免调用方随任务临时提权到 auto。
    //   startTask 会校验工作区存在/是目录、任务非空，非法则抛 → 400。
    if (req.method === 'POST' && url.pathname === '/api/agent/start') {
      try {
        // 4 张×6MB 图片经 base64 后约 24MB；32MB 留出 JSON/文本附件余量，同时拒绝无上限堆内存。
        const body = await readJson(req, 32 * 1024 * 1024);
        const activeTask = activeAgentTask();
        if (activeTask) {
          sendJson(res, 409, {
            error: '还有一个任务没有结束，已重新接回原任务；不能同时启动第二个任务。',
            taskId: activeTask.id,
          });
          return;
        }
        // 不信任窗口缓存里的旧路径：切会话后，任务只能使用该会话已绑定的工作区。
        const convId = currentConvId;
        const workspace = workspaceForConversation(convId);
        if (!history.getWorkspace(convId)) history.setWorkspace(convId, workspace);
        // 统一 Agent 续上当前对话；Persona Store 的持久边界会滤掉旧人格 assistant，并保留全部用户话与新人格回复。
        const context = seedFor(convId);
        const firstInterviewRequested = body.firstInterview === true;
        if (firstInterviewRequested && !core.health().llmReady) {
          sendJson(res, 409, { error: '请先配置对话模型，再发送这次认识的回答' });
          return;
        }
        let interviewState = firstInterviewRequested ? getFirstInterviewState() : null;
        if (firstInterviewRequested && !(
          interviewState?.status === 'in_progress'
          && interviewState.conversationId === convId
          && interviewState.step >= 0
          && interviewState.step < FIRST_INTERVIEW_TOTAL_STEPS
        )) {
          sendJson(res, 409, { error: '这条对话当前不在首次认识流程中' });
          return;
        }
        // 兼容旧版本留下的进行中状态：首条新回答进入前只补幂等 runId，不改步骤、会话或用户内容。
        if (interviewState && !interviewState.runId) {
          interviewState = ensureFirstInterviewRunId(interviewState);
          setFirstInterviewState(interviewState);
        }
        const interviewCopy = interviewState ? firstInterviewCopy(interviewState.step, resolvedLang()) : null;
        const started = agent.startTask({
          task: typeof body.task === 'string' ? body.task : '',
          workspace,
          autonomy: getAgentAutonomy(),
          attachments: Array.isArray(body.attachments) ? body.attachments : [], // ③·上下文附件 {name,content}[]
          context,
          // 请求体只能表达“这是采访回答”；是否真进入纯对话由持久状态+绑定会话决定，guidance 永不信客户端。
          conversationOnly: firstInterviewRequested,
          ...(interviewCopy ? { guidance: interviewCopy.guidance } : {}),
        });
        agentTaskConversations.set(started.id, convId);
        if (interviewState) {
          if (!interviewState.runId) throw new Error('首次认识缺少运行标识');
          firstInterviewTasks.set(started.id, { conversationId: convId, step: interviewState.step, runId: interviewState.runId });
        }
        // 先落用户消息与图片引用，任务还在跑时重开应用也能恢复。
        try {
          persistAgentUserTurn(convId, typeof body.task === 'string' ? body.task.trim() : '', started.attachments);
          agentTaskUserPersisted.add(started.id);
        } catch {
          // 任务已经启动，不能因为一次历史写盘失败对前端伪报“没发送”；完成回调会再兜底一次。
        }
        sendJson(res, 200, { ok: true, id: started.id, workspace });
      } catch (e) {
        sendJson(res, e instanceof RequestBodyTooLargeError ? 413 : 400, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // 查状态：?id=xxx 查单个任务（前端轮询这个刷步骤卡）；无 id 列全部任务。
    if (req.method === 'GET' && url.pathname === '/api/agent/status') {
      const id = url.searchParams.get('id');
      if (id) {
        const view = agent.getTaskView(id);
        if (!view) { sendJson(res, 404, { error: '没有这个任务' }); return; }
        sendJson(res, 200, view);
      } else {
        sendJson(res, 200, {
          tasks: agent.listTasks().map((task) => ({
            ...task,
            conversationId: agentTaskConversations.get(task.id) ?? null,
          })),
        });
      }
      return;
    }

    // 批准/拒绝当前挂起的那一步：body {id, decision:'approve'|'reject'}。ok=false 表示当前没有挂起的步骤。
    if (req.method === 'POST' && url.pathname === '/api/agent/decide') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const decision = body.decision === 'approve' ? 'approve' : 'reject';
      sendJson(res, 200, { ok: agent.decideStep(id, decision) });
      return;
    }

    // 叫停任务：body {id}。置 stopped、唤醒可能挂起的审批门。
    if (req.method === 'POST' && url.pathname === '/api/agent/stop') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      sendJson(res, 200, { ok: agent.stopTask(id) });
      return;
    }

    // 一键撤回：body {id}。只还原仍保持本任务改后状态的文件；外部二次修改一律跳过，命令副作用仍撤不回。
    if (req.method === 'POST' && url.pathname === '/api/agent/undo') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const r = await agent.undoTask(id);
      sendJson(res, 200, r);
      return;
    }

    // ── MCP 一键装（阶段2·帮你干活②·官方 SDK 当客户端，见 mcp.ts / mcp-store.ts）──
    // 装的 MCP 服务 = 一批新工具，塞进①的 agent 循环。配置走 safeStorage 加密（env 常含密钥）。
    // 安全：MCP 跑第三方代码 —— agent 里非只读工具一律要用户批准（agent.ts resolveTool）；前端装服务时警示。

    // 服务清单：配置公开视图（env 剥值）+ 实时连接状态/工具数 合并。
    if (req.method === 'GET' && url.pathname === '/api/mcp/servers') {
      const st = new Map(mcp.statusView().map((s) => [s.id, s]));
      const trusted = new Set(getTrustedMcpTools());
      const servers = mcpStore.publicView().servers.map((s) => {
        const live = st.get(s.id);
        return {
          ...s,
          status: live ? live.status : (s.enabled ? 'disconnected' : 'disabled'),
          toolCount: live ? live.toolCount : 0,
          error: live ? live.error : undefined,
          tools: live ? live.tools.map((t) => ({ ...t, trusted: trusted.has(t.fqName) })) : [],  // F1：带每个工具的信任态
        };
      });
      sendJson(res, 200, { servers });
      return;
    }

    // 预置清单（常用 MCP 服务·点一下预填表单）。
    if (req.method === 'GET' && url.pathname === '/api/mcp/catalog') {
      sendJson(res, 200, { catalog: MCP_CATALOG });
      return;
    }

    // 增/改一个服务：body {id?, name, command, args?, env?, enabled?}。存完按 enabled 连/断。
    //   ⚠ 隐私：env 可能含密钥，只在栈内流过交 mcpStore 加密落盘，不 log body、不进模块级变量。
    if (req.method === 'POST' && url.pathname === '/api/mcp/server') {
      const body = await readJson(req);
      const command = typeof body.command === 'string' ? body.command.trim() : '';
      if (!command) { sendJson(res, 400, { error: '缺少启动命令（command）' }); return; }
      const args = Array.isArray(body.args) ? body.args.map((a) => String(a)) : [];
      const env = (body.env && typeof body.env === 'object' && !Array.isArray(body.env)) ? body.env as Record<string, string> : undefined;
      let id: string;
      try {
        id = mcpStore.upsertServer({
          id: typeof body.id === 'string' ? body.id : undefined,
          name: typeof body.name === 'string' ? body.name : '',
          command, args, env,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        });
      } catch (e) { sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }); return; }
      const srv = mcpStore.getServer(id);
      if (srv && srv.enabled) await mcp.connectServer(srv); else await mcp.disconnectServer(id);
      sendJson(res, 200, { ok: true, id });
      return;
    }

    // 开/关一个服务：body {id, enabled}。开=连、关=断。
    if (req.method === 'POST' && url.pathname === '/api/mcp/server/toggle') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const enabled = body.enabled === true;
      if (!id || !mcpStore.setEnabled(id, enabled)) { sendJson(res, 404, { error: '没有这个服务' }); return; }
      const srv = mcpStore.getServer(id);
      if (enabled && srv) await mcp.connectServer(srv); else await mcp.disconnectServer(id);
      sendJson(res, 200, { ok: true });
      return;
    }

    // 删一个服务：body {id}。先断连再删配置。
    if (req.method === 'POST' && url.pathname === '/api/mcp/server/delete') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) { sendJson(res, 400, { error: '缺少要删除的服务 id' }); return; }
      await mcp.disconnectServer(id);
      mcpStore.deleteServer(id);
      sendJson(res, 200, { ok: true });
      return;
    }

    // 重连一个服务（重试出错的 / 外部改过配置后）：body {id}。
    if (req.method === 'POST' && url.pathname === '/api/mcp/server/reconnect') {
      const body = await readJson(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const srv = id ? mcpStore.getServer(id) : null;
      if (!srv) { sendJson(res, 404, { error: '没有这个服务' }); return; }
      if (srv.enabled) await mcp.connectServer(srv);
      sendJson(res, 200, { ok: true });
      return;
    }

    // 设某个 MCP 工具的「信任·auto 免批」(F1)：body {fqName, trusted}。ask 档仍确认每次外部调用。
    if (req.method === 'POST' && url.pathname === '/api/mcp/tool/trust') {
      const body = await readJson(req);
      const fqName = typeof body.fqName === 'string' ? body.fqName.trim() : '';
      if (!fqName) { sendJson(res, 400, { error: '缺少 fqName' }); return; }
      setMcpToolTrust(fqName, body.trusted === true);
      sendJson(res, 200, { ok: true });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    // 兜底：任何 handler 抛错（如非法 UTF-8 请求体）都返回 400，不崩服务。
    sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (countedMutation) finishMutation();
  }
}));

// 优雅收尾（幂等）：清调度器计时、关 Core 库连接、关 loopback。
//   两条触发路径共用：① Electron 主进程 before-quit（桌面常驻退出，见 main.mjs）；② SIGINT/SIGTERM（CLI/冒烟被 kill）。
//   都可能触发，故用 shuttingDown 守一次；shutdown() 只做清理【不 process.exit】——退出交给调用方（Electron 让 app 退，信号路径自己 exit）。
//   纯库模式（EXPERIENCE_UI=off）已在文件顶部提前 exit、根本走不到这里。
let shuttingDown = false;
export async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  scheduler.dispose(); // 停后台整理计时器（别留悬挂 timer；在飞的那次由 trigger 的兜底 catch 吞掉）
  try { await mcp.shutdownAll(); } catch { /* 关 MCP 子进程失败不阻断退出 */ } // 关所有 MCP 服务子进程
  core.close();        // 关 sqlite 连接（flush WAL）——最要紧的一步
  // 关 loopback：先强断残留连接再 close。退出时渲染进程的 keep-alive 连接还没拆，光 server.close() 会一直
  //   等它们关完 → 卡死退出。closeAllConnections 强断（Node 18.2+），再套 1.5s 超时兜底，绝不让退出挂住。
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 1500);
    server.close(() => { clearTimeout(t); resolve(); });
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { void shutdown().then(() => process.exit(0)); });
}

export interface LoopbackReady {
  port: number;
  origin: string;
}

/** Resolves only after the OS has assigned the final port and the guard policy is usable. */
export const ready = new Promise<LoopbackReady>((resolve, reject) => {
  const onStartupError = (error: Error) => reject(error);
  server.once('error', onStartupError);
  server.listen(REQUESTED_PORT, '127.0.0.1', () => {
    server.off('error', onStartupError);
    server.on('error', (error) => {
      console.error('[weftmate] loopback 运行时错误:', error instanceof Error ? error.message : String(error));
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('loopback 未返回 TCP 监听地址'));
      return;
    }
    boundPort = address.port;
    const { origin } = currentLoopbackPolicy();

    console.log(`\n  MemoWeft Host（批次5 步6·S0/S1 用户正门）→ ${origin}`);
    console.log(`  记忆库 → ${DB_PATH}`);
    console.log(`  聊天历史 → ${SESSIONS_DIR}（跟随库路径）`);
    console.log(`  当前对话 → ${currentConvId}`);
    console.log(`  当前人格 → ${personaStore.current().name}（${personaStore.currentId()}）`);
    console.log('  端点 → GET / · GET /api/health · GET /api/usage · GET /api/chat-history · GET /api/bg-status · /api/agent/*');
    console.log('  模型配置(多档·热重建) → GET /api/model-config · POST /api/model-config/{profile,active,delete}');
    console.log('  设置 → GET /api/settings · POST /api/settings/{perception,language,theme,agent-autonomy} · POST /api/observe(采集·不上云)');
    console.log('  记忆管理 → GET /api/cognition · GET /api/evidence · POST /api/cognition/{invalidate,delete} · POST /api/evidence/{authorization,delete}');
    console.log('  多对话 → POST /api/reset · GET /api/sessions · POST /api/session/{open,archive}');
    console.log('  人格 → GET /api/experiences · POST /api/persona/active（旧 /api/experience 兼容）');
    console.log('  数据/备份 → GET /api/export-bundle · POST /api/import-bundle · POST /api/factory-reset');
    console.log('  用户正门 → GET /api/cognition/count · POST /api/refresh（立即整理记忆）');
    console.log('  记忆图谱 → GET /api/memory-graph\n');
    resolve({ port: boundPort, origin });
  });
});
