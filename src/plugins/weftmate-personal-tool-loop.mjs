/** Turn DSH's highest repeat reminder into a terminal native step decision. */
export const name = 'weftmate-personal-tool-loop';
export const inject = ['tools'];
export const REPEAT_TOOL_LIMIT = 8;
export const REPEAT_TOOL_MESSAGE = '这一步一直在重复，没能继续完成，我已经停下来了。';
const personal = agent => ['personal-remote', 'personal-shared-chat'].includes(agent?.session?.header?.agentPreset);

export function apply(ctx) {
  const stopped = new WeakSet();
  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const decision = await next();
    if (personal(exec.agent) && decision.additionalContexts?.some(message =>
      message.source?.plugin === 'repeat-tool-reminder' &&
      message.source.summary?.endsWith(` × ${REPEAT_TOOL_LIMIT}`))) stopped.add(exec.agent);
    return decision;
  }, { prepend: true });
  ctx.on('tools/pre-execute', (exec, next) => stopped.has(exec.agent)
    ? { kind: 'deny', reason: REPEAT_TOOL_MESSAGE } : next(), { prepend: true });
  ctx.on('agent/pre-step', async (payload, next) => {
    if (!stopped.has(payload.agent)) return next();
    stopped.delete(payload.agent);
    // A steering input may already have been claimed for this boundary.
    // Return it to the native inbox rather than losing it with the rejected step.
    for (const message of [...payload.messages].reverse()) {
      if (message.source?.kind === 'user') payload.agent.inbox.prepend('next-turn', message);
    }
    if (payload.agent.inbox.hasPending) payload.agent.wakeDriver(true);
    const { createAssistantMessage } = await import('@deepseek-ai/dsh-llm/message');
    const source = payload.agent.session.events.findLast(event => event.type === 'assistant/message').data.message.source;
    payload.agent.session.append('step/start', { turn: payload.turn, step: payload.step });
    payload.agent.session.append('assistant/message', { turn: payload.turn, step: payload.step,
      message: createAssistantMessage({ content: [{ type: 'text', text: REPEAT_TOOL_MESSAGE }],
        source: { provider: source.provider, model: source.model } }) }, { surfaceOp: 'append' });
    payload.agent.session.append('step/end', { turn: payload.turn, step: payload.step });
    // DSH closes this turn as blocked and processes queued messages normally.
    return { kind: 'reject' };
  }, { prepend: true });
}
export default { name, inject, apply };
