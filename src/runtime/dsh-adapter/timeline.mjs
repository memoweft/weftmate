/** Read the native immutable log without cloning it or activating an agent.
 * session-query.readEvent currently clones the whole source before slicing;
 * persistence.inspect uses DSH's revision-aware prepared-session cache instead.
 */
export function nativeTimelineLog(ctx) {
  return async (sessionId) => {
    const live = ctx.get('sessions')?.get(sessionId)
    if (live) return live.events
    const persistence = ctx.get('sessionPersistence')
    if (!persistence) throw Object.assign(new Error('session not found'), { code: 'session-not-found' })
    return (await persistence.inspect(sessionId)).events
  }
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
    glob: '查找文件', grep: '搜索内容', todo: '更新计划', subagent: '启动子任务',
    personal_save_document: '保存成果文件', ask_user_question: '请求补充信息' })[name] ?? `执行工具 ${short(name)}`
}
