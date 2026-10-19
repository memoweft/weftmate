// Classify the actual tool call. User text never participates in this decision.
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
export const WORK_SWITCH_REASON = '[weftmate:work-switch] 这件事需要在电脑上做。要切换到工作吗？';
const dataTools = new Set(['load_tools', 'web_fetch', 'web_search', 'health_query', 'memory_query', 'memory_search', 'memory_recall',
  'memory_forget', 'memory_correct',
  'get_goal', 'create_goal', 'update_goal', 'ask_user_question', 'exit_plan_mode', 'todo_write',
  'current_time', 'get_current_time', 'sleep', 'wait', 'run_code', 'schedule_list', 'schedule_delete']);

export function toolNeedsComputer(name, args = {}, connector = null) {
  if (connector) return connector.category !== 'read';
  if (name === 'schedule_create') {
    try { const prompt = typeof args.prompt === 'string' ? JSON.parse(args.prompt) : args.prompt;
      return prompt?.weftmate !== 1 || prompt.kind !== 'reminder'; } catch { return true; }
  }
  if (name === 'schedule_manage') return args.action === 'run';
  return !dataTools.has(name);
}

export const chatModePrompt = mode => mode === 'chat'
  ? '当前是对话模式：聊天、记忆、健康和 web_search/web_fetch 公开查询无需项目。文件整理、读写或命令任务，先直接 load_tools 加载 glob/read/write/pwsh 等所需文件或命令工具并调用；需要操作应用界面才用 weftmod，普通文件任务不必创建应用自动化脚本。未选目录时用相对路径（如 .），不要 ask_user_question 索要路径。实际电脑调用会在执行前暂停，显示“切换到工作”卡片，让用户选电脑和文件夹；确认后在所选目录接着完成原请求，权限审批照旧。不要只给计划、声称做不了或假称卡片已出现。选择先不用后本轮停止，下一轮才可再询问。'
  : '当前是工作模式，在已选择的电脑与项目文件夹里工作，继续遵守原有工具权限与审批。';

/** A discovery tool can open the card without completing the user's task.
 * Keep the acknowledgement in this native turn, including after tool loading
 * or a recoverable error, without resending the original user message. */
export function workContinuationPrompt(session, policy) {
  if (policy.conversationMode !== 'work' || !policy.project) return null;
  const events = session.events, start = events.findLastIndex(event => event.type === 'turn/start' || event.type === 'turn/end');
  if (start < 0 || events[start].type !== 'turn/start') return null;
  const current = events.slice(start + 1);
  const switched = current.some(event => event.type === 'approval/asked' && event.data.reason === WORK_SWITCH_REASON &&
    current.some(answer => answer.type === 'approval/decided' && answer.data.id === event.data.id && answer.data.outcome === 'allowed-once'));
  if (!switched) return null;
  return `用户已批准切换到工作，电脑和文件夹选择已完成：${policy.project.name}（${policy.project.rootPath}）。这就是用户刚选定的目标目录，以此路径为准，不要再按名称到别处寻找这个文件夹。这只是完成了工作准备，不代表原任务已完成。请在本轮接着实际执行用户原请求，核对结果后再报告；不要停在口头计划、再次索要文件夹或等待用户重发指令。需要别的工具时继续用 load_tools 加载后调用；文件整理使用文件工具或命令工具（如 glob、pwsh），不需要操作应用界面。只操作所选文件夹，继续遵守原有权限、审批、拒绝和停止决定。`;
}

/** Recover the observed normal stop after a failed post-switch operation.
 * Native request failures/output limits and user refusals keep their outcomes. */
export function workFailureNeedsContinuation(session, policy) {
  if (!workContinuationPrompt(session, policy)) return false;
  const start = session.events.findLastIndex(event => event.type === 'turn/start');
  const current = session.events.slice(start + 1);
  if (current.filter(event => event.type === 'user/message' && event.data.source?.kind === 'user').length !== 1 ||
      current.some(event => event.type === 'approval/decided' && event.data.outcome !== 'allowed-once')) return false;
  const finish = current.findLast(event => event.type === 'assistant/chunk' && event.data.chunk?.type === 'finish');
  if (!['stop', 'completed'].includes(finish?.data.chunk.reason.kind)) return false;
  const result = current.findLast(event => event.type === 'tool/result');
  const failed = result?.data.message.content.find(part => part.type === 'tool-result' && part.isError);
  const call = failed && current.findLast(event => event.type === 'tool/call' && event.data.callId === failed.toolCallId);
  // The catalog loader has its own bounded native recovery.
  return !!call && call.data.name !== 'load_tools';
}

// A model may have expanded a new relative file against the old chat directory.
// Choosing a project changes that default location; existing historical files stay put.
export function applyWorkDirectoryChoice(exec, previousDirectory, directory) {
  if (!previousDirectory || !directory || previousDirectory === directory) return;
  const keys = ['read','write','edit'].includes(exec.name) ? ['file_path'] : ['glob','grep'].includes(exec.name) ? ['path'] : ['pwsh','bash','shell'].includes(exec.name) ? ['workdir'] : [];
  const args = { ...exec.arguments };
  for (const key of keys) {
    if (typeof args[key] !== 'string' || !isAbsolute(args[key])) continue;
    const rel = relative(previousDirectory, args[key]);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) continue;
    if (!rel || !existsSync(args[key])) args[key] = resolve(directory, rel);
  }
  exec.arguments = args;
}
