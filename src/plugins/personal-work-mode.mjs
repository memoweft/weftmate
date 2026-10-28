// Classify the actual tool call. User text never participates in this decision.
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
  ? '当前是对话模式：聊天、记忆、健康和 web_search/web_fetch 公开查询无需项目。文件整理、读写或命令任务，先直接 load_tools 加载所需工具并调用；需要操作应用界面才用 weftmod。未选目录时用相对路径，不要 ask_user_question 索要路径。需要电脑的调用不会执行，本轮以“切换到工作”提议结束。用户确认后，新工作会在选定电脑和文件夹收到原请求；用户选择先不用则继续对话。'
  : '当前是工作模式，在已选择的电脑与项目文件夹里工作，继续遵守原有工具权限与审批。文件任务使用相对路径，不要 ask_user_question 索要路径，也不要再次切换到工作。';
