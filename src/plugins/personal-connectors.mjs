const registrations = new WeakMap();
export function connectorToolFor(agent, name) { return registrations.get(agent)?.tools.get(name); }
/** Agent-scoped tools retain DSH native load_tools and Code Mode presentation. */
export function syncConnectorTools(agent, policy, bridge, identityFor) {
  const tools = new Map((policy.connectorTools ?? []).map(tool => [tool.name, tool]));
  const old = registrations.get(agent), fingerprint = JSON.stringify([...tools.values()]);
  if (old?.fingerprint === fingerprint) return;
  for (const dispose of old?.disposers ?? []) dispose();
  const disposers = [];
  for (const tool of tools.values()) disposers.push(agent.ctx.tools.register({ name: tool.name, description: `${tool.connectorName}：${tool.description}`,
    presentCall: () => ({ card: 'generic', title: `${tool.connectorName} · ${tool.rawName}`, kind: tool.category === 'read' ? 'read' : 'execute' }),
    parameters: tool.parameters, output: { schema: { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {} }, required: ['content'], additionalProperties: false },
      render: (_args, result) => result.content.filter(block => block.type === 'text') },
    execute: (args, exec) => {
      if (exec.agent.session.header.origin === 'subagent') throw new Error('请在原对话使用这个连接器。');
      return bridge.request({ ...identityFor(exec), action: 'connector_call', connectorId: tool.connectorId, toolName: tool.name, arguments: args }, exec.signal);
    } }));
  registrations.set(agent, { tools, disposers, fingerprint });
}
