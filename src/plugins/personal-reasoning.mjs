/** One native turn owns its preference; neither model selection nor defaults are written. */
export function installConversationReasoning(ctx, policyFor) {
  const turns = new WeakMap();
  ctx.on('agent/request', async (request, next) => {
    const config = await next(), agent = request.agent;
    if (!['personal-remote','personal-shared-chat'].includes(agent?.session?.header?.agentPreset) ||
        agent.session.header.origin === 'subagent') return config;
    let preference = turns.get(agent);
    if (!preference || preference.turn !== request.turn) {
      preference = {turn:request.turn,enabled:(await policyFor(agent)).deepThinking === true};
      turns.set(agent,preference);
    }
    return preference.enabled ? {...config,reasoningEffort:'high'} : config;
  }, {global:true,prepend:true});
}
