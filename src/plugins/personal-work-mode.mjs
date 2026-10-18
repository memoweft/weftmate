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
  ? '当前是对话模式，可以聊天、查记忆和健康数据，也可以用 web_search/web_fetch 查询公开资料，不需要项目。需要读写电脑文件、运行命令、打开应用、交互操作浏览器或下载到电脑时，实际调用所需工具，系统会暂停并询问是否切换到工作。尚未选择文件夹时，不要用 ask_user_question 索要路径或代替目录选择；先加载并实际调用所需电脑工具，路径可以使用相对路径（如 .）。系统会在执行前暂停，通过“切换到工作”卡片让用户选择电脑和文件夹，确认后在所选目录执行。不要自行执行，不要只回答做不了，不要用文字假称卡片已经出现。用户选择先不用后，本轮停止这件事，用一句话说明它需要进入工作；下一轮可以再询问。'
  : '当前是工作模式，在已选择的电脑与项目文件夹里工作，继续遵守原有工具权限与审批。';

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
