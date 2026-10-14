/** Reuse DSH's detector for unchanged calls AND outcomes; waits have no count limit. */
export const name = 'weftmate-personal-tool-loop';
export const inject = ['tools'];
export const REPEAT_TOOL_LIMIT = 8;
export const REPEAT_TOOL_MESSAGE = '这一步一直在重复，没能继续完成，我已经停下来了。';
const personal = agent => ['personal-remote', 'personal-shared-chat'].includes(agent?.session?.header?.agentPreset);
// Code Mode is a transport: its nested native calls carry the actual progress.
const waiting = new Set(['job_output', 'wait', 'sleep', 'wait_agent', 'run_code']);
const openTurn = agent => {
  const event = agent?.session?.events?.findLast(event => event.type === 'turn/start' || event.type === 'turn/end');
  return event?.type === 'turn/start' ? event.data.turn : null;
};

export async function apply(ctx) {
  const [{ apply: repeat }, { createUserMessage, createAssistantMessage }] = await Promise.all([
    import('@deepseek-ai/dsh-repeat-tool-reminder'), import('@deepseek-ai/dsh-llm/message'),
  ]);
  const stopped = new WeakMap();
  const activeStop = agent => {
    const state = stopped.get(agent);
    return state?.turn === openTurn(agent) ? state : null;
  };
  // Only the observer sees this envelope. Actual arguments, results and audit
  // events stay intact; DSH owns canonicalization, chains, thresholds and resets.
  repeat({ on(event, listener) {
    if (event !== 'tools/post-execute') return ctx.on(event, listener);
    return ctx.on(event, async (exec, result, next) => {
      const downstream = await next();
      if (!personal(exec.agent) || waiting.has(exec.name)) return downstream;
      const previous = new Set((downstream.additionalContexts ?? []).map(message => message.id));
      const outcome = downstream.kind === 'block' ? { isError: true, content: downstream.feedback }
        : { isError: result.isError, error: result.error, value: Object.hasOwn(downstream, 'value') ? downstream.value : result.value,
          content: downstream.content ?? result.content };
      const decision = await listener({ ...exec, arguments: { input: exec.arguments, output: outcome } }, result,
        () => Promise.resolve(downstream));
      const additionalContexts = decision.additionalContexts?.map(message => {
        if (previous.has(message.id) || message.source?.plugin !== 'repeat-tool-reminder') return message;
        const limit = message.source.summary?.endsWith(` × ${REPEAT_TOOL_LIMIT}`);
        if (limit && !activeStop(exec.agent)) stopped.set(exec.agent, { turn: openTurn(exec.agent), delivered: false });
        return createUserMessage({ source: { ...message.source, plugin: name }, content: [{ type: 'text',
          text: limit ? '同样的调用和同样的结果已反复出现。不要再调用工具；先处理最后一次返回的结果，用文字简短说明查到了什么、还有什么没完成，并说明已经停止重复。'
            : '这个调用和返回结果都没有变化。先阅读上次结果，再决定是否换一种办法或结束，不要继续重复。' }] });
      });
      return additionalContexts ? { ...decision, additionalContexts } : decision;
    }, { prepend: true });
  } }, { thresholds: [3, 5, REPEAT_TOOL_LIMIT], include: [], exclude: [], argumentsPreviewChars: 500 });
  ctx.on('tools/pre-execute', (exec, next) => activeStop(exec.agent)
    ? { kind: 'deny', reason: REPEAT_TOOL_MESSAGE } : next(), { prepend: true });
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next();
    return activeStop(context.scope) ? { ...assembly, tools: [] } : assembly;
  }, { prepend: true });
  ctx.on('agent/pre-step', async (payload, next) => {
    const state = activeStop(payload.agent);
    if (!state) { stopped.delete(payload.agent); return next(); }
    // Claimed steering input belongs to a later turn, not the final summary.
    const users = payload.messages.filter(message => message.source?.kind === 'user');
    for (const message of [...users].reverse()) {
      payload.agent.inbox.prepend('next-turn', message);
    }
    if (payload.agent.inbox.hasPending) payload.agent.wakeDriver(true);
    if (!state.delivered) {
      state.delivered = true;
      // One text-only model step sees the last committed result. Ignoring it
      // cannot execute another action; the next step closes the native turn.
      const decision = users.length ? { kind: 'enter', messages: payload.messages.filter(message => message.source?.kind !== 'user') }
        : await next();
      if (decision.kind !== 'enter') return decision;
      return { ...decision, messages: [...decision.messages, createUserMessage({ source: { kind: 'plugin', plugin: name },
        content: [{ type: 'text', text: '重复操作已经停止。请根据刚返回的最后一次工具结果，用文字说明结果和未完成的部分，不再调用工具。' }] })] };
    }
    stopped.delete(payload.agent);
    const source = payload.agent.session.events.findLast(event => event.type === 'assistant/message').data.message.source;
    payload.agent.session.append('step/start', { turn: payload.turn, step: payload.step });
    payload.agent.session.append('assistant/message', { turn: payload.turn, step: payload.step,
      message: createAssistantMessage({ content: [{ type: 'text', text: REPEAT_TOOL_MESSAGE }],
        source: { provider: source.provider, model: source.model } }) }, { surfaceOp: 'append' });
    payload.agent.session.append('step/end', { turn: payload.turn, step: payload.step });
    return { kind: 'reject' };
  }, { prepend: true });
}
export default { name, inject, apply };
