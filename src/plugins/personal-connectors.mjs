const registrations = new WeakMap();
export function connectorToolFor(agent, name) { return registrations.get(agent)?.tools.get(name); }
function calendarTime(value, accountZone) {
  if (!value) return '';
  const input=String(value), wall=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(input);
  if (wall&&!/(?:Z|[+-]\d{2}:?\d{2})$/.test(input)) return `${Number(wall[2])}月${Number(wall[3])}日 ${wall[4]}:${wall[5]}`;
  const instant=new Date(input);
  return Number.isFinite(instant.getTime()) ? new Intl.DateTimeFormat('zh-CN',{timeZone:accountZone||Intl.DateTimeFormat().resolvedOptions().timeZone,month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant) : input.slice(0,40);
}
export function connectorCallSummary(tool, args = {}) {
  const title = `${tool.connectorName} · ${tool.displayName || tool.rawName}`;
  if (tool.builtinId==='mail' && /^mail_(send|reply|forward)$/.test(tool.rawName)) return `${title} · 收件人：${(args.to ?? []).join('、').slice(0,170)} · 主题：${String(args.subject ?? '').slice(0,100)} · 正文：${String(args.body ?? '').replace(/\s+/g,' ').slice(0,140)}`.slice(0,500);
  if (tool.builtinId==='calendar' && /^calendar_(create|update|delete)$/.test(tool.rawName)) return `${title} · ${String(args.title ?? args.approvalTitle ?? '').slice(0,120)} · ${calendarTime(args.start ?? args.approvalStart,tool.timeZone)} 至 ${calendarTime(args.end ?? args.approvalEnd,tool.timeZone)} · 日历：${String(args.calendarName ?? args.calendarId ?? '').slice(0,80)}`.replace(/\s+/g,' ').slice(0,500);
  return `${title} · ${JSON.stringify(args).slice(0,300)}`;
}
/** Agent-scoped tools retain DSH native load_tools and Code Mode presentation. */
export function syncConnectorTools(agent, policy, bridge, identityFor) {
  const tools = new Map((policy.connectorTools ?? []).map(tool => [tool.name, tool]));
  const old = registrations.get(agent), fingerprint = JSON.stringify([...tools.values()]);
  if (old?.fingerprint === fingerprint) return;
  for (const dispose of old?.disposers ?? []) dispose();
  const disposers = [];
  for (const tool of tools.values()) disposers.push(agent.ctx.tools.register({ name: tool.name, description: `${tool.connectorName}：${tool.description}`,
    presentCall: () => ({ card: 'generic', title: `${tool.connectorName} · ${tool.displayName || tool.rawName}`, kind: tool.category === 'read' ? 'read' : 'execute' }),
    parameters: tool.parameters, output: { schema: { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {} }, required: ['content'], additionalProperties: false },
      render: (_args, result) => result.content.filter(block => block.type === 'text') },
    execute: (args, exec) => {
      if (exec.agent.session.header.origin === 'subagent') throw new Error('请在原对话使用这个连接器。');
      return bridge.request({ ...identityFor(exec), action: 'connector_call', connectorId: tool.connectorId, toolName: tool.name, arguments: args }, exec.signal);
    } }));
  registrations.set(agent, { tools, disposers, fingerprint });
}
