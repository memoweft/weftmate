import { externalConnectorContent } from '../personal-connectors/policy.mjs';
const registrations = new WeakMap();
export function connectorToolFor(agent, name) { return registrations.get(agent)?.tools.get(name); }
function calendarTime(value, accountZone, sourceZone) {
  if (!value) return '';
  const input=String(value), wall=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(input);
  if (wall&&!/(?:Z|[+-]\d{2}:?\d{2})$/.test(input)) {
    if(sourceZone&&accountZone&&sourceZone!==accountZone)try{
      const target=Date.UTC(+wall[1],+wall[2]-1,+wall[3],+wall[4],+wall[5]);let epoch=target;
      const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:sourceZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
      for(let i=0;i<5;i++){const p=Object.fromEntries(formatter.formatToParts(new Date(epoch)).filter(part=>part.type!=='literal').map(part=>[part.type,+part.value]));const delta=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);if(!delta)break;epoch+=delta;}
      return new Intl.DateTimeFormat('zh-CN',{timeZone:accountZone,month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(epoch));
    }catch{}
    return `${Number(wall[2])}月${Number(wall[3])}日 ${wall[4]}:${wall[5]}`;
  }
  const instant=new Date(input);
  return Number.isFinite(instant.getTime()) ? new Intl.DateTimeFormat('zh-CN',{timeZone:accountZone||Intl.DateTimeFormat().resolvedOptions().timeZone,month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant) : input.slice(0,40);
}
export function connectorCallSummary(tool, args = {}) {
  const title = `${tool.connectorName} · ${tool.displayName || tool.rawName}`;
  if (tool.builtinId==='mail' && /^mail_(send|reply|forward)$/.test(tool.rawName)) return `${title} · 收件人：${(args.to ?? []).join('、').slice(0,170)} · 主题：${String(args.subject ?? '').slice(0,100)} · 正文：${String(args.body ?? '').replace(/\s+/g,' ').slice(0,140)}`.slice(0,500);
  if (tool.builtinId==='calendar' && /^calendar_(create|update|delete)$/.test(tool.rawName)) return `${title} · ${String(args.title ?? args.approvalTitle ?? '').slice(0,120)} · ${calendarTime(args.start ?? args.approvalStart,tool.timeZone,args.timeZone)} 至 ${calendarTime(args.end ?? args.approvalEnd,tool.timeZone,args.timeZone)} · 日历：${String(args.calendarName ?? args.calendarId ?? '').slice(0,80)}`.replace(/\s+/g,' ').slice(0,500);
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
      render: (_args, result) => [...result.content.filter(block => block.type === 'text'),
        ...(result.structuredContent === undefined ? [] : [{type:'text',text:externalConnectorContent(tool.connectorName,JSON.stringify({structuredContent:result.structuredContent}))}])] },
    execute: (args, exec) => {
      if (exec.agent.session.header.origin === 'subagent') throw new Error('请在原对话使用这个连接器。');
      return bridge.request({ ...identityFor(exec), action: 'connector_call', connectorId: tool.connectorId, toolName: tool.name, arguments: args }, exec.signal);
    } }));
  registrations.set(agent, { tools, disposers, fingerprint });
}
