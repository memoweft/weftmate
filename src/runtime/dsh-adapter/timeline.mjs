import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createHistoryCache } from './history-cache.mjs';

/** Read the native immutable log without cloning it or activating an agent.
 * session-query.readEvent currently clones the whole source before slicing;
 * persistence.inspect uses DSH's revision-aware prepared-session cache instead.
 */
export function nativeTimelineLog(ctx, { cache = true } = {}) {
  const index = new Map(), changed = new Map(); let initialized;
  const summary = (session, prior = {}) => ({ ...prior, sessionId:session.id,
    agentPreset:session.header.agentPreset, ...(session.header.origin ? {origin:session.header.origin} : {}),
    ...(session.header.parentSession ? {parentSessionId:session.header.parentSession} : {}),
    title:ctx.get('sessionTitle')?.get(session)?.title ?? prior.title ?? '新对话',
    running:ctx.get('agents')?.get(session.id)?.status === 'running',
    projections:ctx.get('sessionProjections')?.snapshot(session) ?? prior.projections });
  ctx.on?.('session/created', session => { const row=summary(session);index.set(session.id,row);changed.set(session.id,row); });
  ctx.on?.('session/disposed', session => { const row=index.get(session.id);if(row){row.running=false;changed.set(session.id,row);} });
  const ensureIndex = async load => {
    initialized ||= Promise.resolve().then(load).then(value => {
      for (const row of value.items ?? []) index.set(row.sessionId,row);
      for (const [id,row] of changed) row ? index.set(id,row) : index.delete(id);
    }).catch(error => { initialized=null;throw error; });
    await initialized;
  };
  const one = id => {const row=index.get(id),live=ctx.get('sessions')?.get(id);return live?summary(live,row):row;};
  const listSessions = async load => {
    await ensureIndex(load);
    const rows=[];
    for (const id of index.keys()) rows.push(one(id));
    return {items:rows};
  };
  const read = async (sessionId) => {
    const live = ctx.get('sessions')?.get(sessionId)
    if (live) return live.events
    const persistence = ctx.get('sessionPersistence')
    if (!persistence) throw Object.assign(new Error('session not found'), { code: 'session-not-found' })
    return (await persistence.inspect(sessionId)).events
  }
  read.listSessions=listSessions;
  read.sessionSummary=async(id,load)=>{await ensureIndex(load);return one(id);};
  read.removeSession=id=>{index.delete(id);changed.set(id,null);};
  const persistence = ctx.get('sessionPersistence');
  if (!cache || !persistence?.config?.root || !persistence.listSnapshots) return read;
  const history = createHistoryCache({ file: resolve(persistence.config.root, '..', 'weftmate-history.sqlite'), readNative: read,
    async source(id) {
      const live = ctx.get('sessions')?.get(id);
      const artifact = live ? {meta:live.header,events:live.events} : await persistence.inspect(id);
      // Native inspection owns decoding/recovery. Hash this one immutable source
      // instead of listing/stat-ing every stored session for each history page.
      const revision=createHash('sha256').update(JSON.stringify(artifact)).digest('hex');
      return {revision,events:artifact.events};
    } });
  read.historyPage = (id, options, project) => history.read(id, options, project);
  read.invalidate = id => history.invalidate(id);
  read.close = () => history.close();
  read.setProjector = project => {
    ctx.on?.('agent/status', ({ agent, status }) => {
      if (status !== 'idle' || agent.session.header.agentPreset !== 'personal-remote') return;
      // Native idle boundaries incrementally maintain a restart-ready cache.
      void history.read(agent.session.id, { limit: 1 }, (entries, options) => project(agent.session.id, entries, options)).catch(() => {});
    });
  };
  ctx.effect?.(() => () => history.close(), 'weftmate public history cache');
  return read;
}

export function toolArguments(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value ?? {} } catch { return {} }
}

export function describeTool(name, value) {
  const args = toolArguments(value)
  const short = (text) => String(text ?? '').replace(/\s+/g, ' ').slice(0, 100)
  if (/^(read|read_file|personal_read_project_file)$/.test(name)) {
    return Array.isArray(args.paths) ? `读取 ${args.paths.length} 个文件` : '读取文件'
  }
  if (/^(shell|bash|pwsh|exec_command)$/.test(name)) return `运行命令 ${short(args.command ?? args.cmd ?? args.script)}`.trim()
  if (/browser|web_fetch|web_search/.test(name)) {
    let host = ''; try { host = new URL(args.url).host } catch { /* Search has no URL. */ }
    return host ? `打开网页 ${host}` : /search/.test(name) ? '搜索网页' : '读取网页'
  }
  return ({ write: '写入文件', write_file: '写入文件', edit: '修改文件', str_replace_editor: '修改文件',
    glob: '查找文件', grep: '搜索内容', todo: '更新计划', todo_write: '更新计划', subagent: '启动子任务',
    ask_user_question: '请求补充信息', load_tools: '准备可用工具',
    get_goal: '查看任务目标', create_goal: '建立任务目标', update_goal: '更新任务目标',
    run_code: '运行脚本', job_output: '查看后台命令输出', job_list: '查看后台命令', job_kill: '结束后台命令',
    schedule_create: '建立定时安排', schedule_list: '查看定时安排', schedule_delete: '删除定时安排', schedule_manage: '管理定时安排',
    enter_plan_mode: '开始规划', exit_plan_mode: '提交执行计划', weftmod_script: '操作电脑应用' })[name] ?? '调用扩展服务'
}
