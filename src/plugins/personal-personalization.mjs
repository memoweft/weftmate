import '../ui-core/personalization.js';
const webTools = new Set(['web_search', 'web_fetch', 'browser']);
export function installPersonalization(ctx, policyFor) {
  const turns = new WeakMap();
  const root = agent => {
    while (agent?.session?.header?.origin === 'subagent') {
      const parent = ctx.get('agents')?.get(agent.session.header.parentSession);
      if (!parent) break;
      agent = parent;
    }
    return agent;
  };
  const settingsFor = async agent => turns.get(root(agent))?.settings ?? (await policyFor(root(agent))).personalization ?? {};
  const personal = agent => ['personal-remote', 'personal-shared-chat'].includes(agent?.session?.header?.agentPreset);
  ctx.on('agent/pre-step', async (step, next) => {
    if (personal(step.agent) && step.agent.session.header.origin !== 'subagent' && turns.get(step.agent)?.turn !== step.turn)
      turns.set(step.agent, { turn: step.turn, settings: (await policyFor(step.agent)).personalization ?? {} });
    return next();
  }, { global: true, prepend: true });
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next(); if (!personal(context.scope)) return assembly;
    const settings = await settingsFor(context.scope), text = globalThis.WeftPersonalization.prompt(settings);
    const sections = assembly.sections.filter(section => section.name !== 'weftmate:personalization').map(section => ({ ...section }));
    // Preset catalog must not advertise disabled tools, including previously loaded ones.
    if (settings.webSearch === false) for (const section of sections) if (section.name === 'weftmate:tools-catalog')
      section.text = section.text.split('\n').filter(line => ![...webTools].some(name => line.startsWith(name + ':'))).join('\n');
    return { ...assembly, sections: [...sections, ...(text ? [{ name: 'weftmate:personalization', text }] : [])],
      tools: settings.webSearch === false ? assembly.tools.filter(tool => !webTools.has(tool.name)) : assembly.tools };
  }, { global: true, prepend: true });
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (personal(exec.agent) && webTools.has(exec.name) && (await settingsFor(exec.agent)).webSearch === false)
      return { kind: 'deny', reason: '网页搜索已在助手设置中关闭。' };
    return next();
  }, { global: true, prepend: true });
}
