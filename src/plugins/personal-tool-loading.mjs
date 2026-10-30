/** Recover one failed catalog load through the native agent step, with corrected model arguments. */
const TOOL_LOADING_UNAVAILABLE = '这次未能加载所需工具，任务还没有完成。';
const LOAD = 'load_tools';
const openTurn = agent => agent.session.events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end');

export function installToolLoadingRecovery(ctx) {
  const states = new WeakMap(), requests = new WeakMap();
  const active = agent => {
    const state = states.get(agent), turn = agent && openTurn(agent);
    return turn?.type === 'turn/start' && state?.turn === turn.data.turn ? state : null;
  };
  // Observe the authoritative result, including argument validation failures
  // which happen before the loader body and errors sanitized for model display.
  ctx.on('tools/result', (exec, result) => {
    if (exec.name !== LOAD || exec.signal.aborted || exec.agent?.session?.header?.agentPreset !== 'personal-remote') return;
    if (!result.isError && !result.value?.error) { states.delete(exec.agent); return; }
    const turn = openTurn(exec.agent);
    if (turn?.type !== 'turn/start') return;
    const previous = active(exec.agent);
    states.set(exec.agent, { turn: turn.data.turn, failures: (previous?.failures ?? 0) + 1 });
  });
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next(), state = active(payload.agent);
    if (!state || state.failures !== 1 || decision.kind !== 'enter') return decision;
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm/message');
    return { ...decision, messages: [...decision.messages, createUserMessage({
      source: { kind: 'plugin', plugin: 'weftmate-tool-loading' },
      content: [{ type: 'text', text: '刚才准备工具失败，系统正在自动重试一次。请根据用户原请求，从当前工具目录选择准确名称，重新调用 load_tools，必须传非空 names 数组，例如 {"names":["write"]}。不要让用户自己切模式，也不要改用别的操作；加载成功后实际调用所需工具，系统会询问是否切换到工作。' }],
    })] };
  });
  ctx.on('agent/request', async (payload, next) => {
    const config = await next();
    if (active(payload.agent)) requests.set(payload.signal, payload.agent);
    return config;
  });
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next();
    return active(context.scope) ? { ...assembly, tools: assembly.tools.filter(tool => tool.name === LOAD) } : assembly;
  }, { prepend: true });
  ctx.on('llm/stream', (options, next) => {
    const agent = options.signal && requests.get(options.signal), state = agent && active(agent);
    if (!state || options.sessionId !== agent.id || options.purpose !== undefined) return next();
    return (async function* () {
      const { isAgentLoopRequest } = await import('@deepseek-ai/dsh-llm');
      if (!isAgentLoopRequest(options)) { yield* next(); return; }
      options.signal.throwIfAborted();
      if (state.failures === 1) {
        // Hold the correction reply so a text-only refusal cannot masquerade
        // as a switch card. The native loop still owns the retried tool call.
        const chunks = [];
        for await (const chunk of next()) chunks.push(chunk);
        options.signal.throwIfAborted();
        // Only normal completion may use the presentation fallback; preserve all
        // other native outcomes (including output limits) and their partial reply.
        const finish = chunks.findLast(chunk => chunk.type === 'finish')?.reason.kind;
        if (!['stop', 'tool-calls', 'completed'].includes(finish)
          || chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call' && chunk.block.name === LOAD)) {
          yield* chunks; return;
        }
      }
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: TOOL_LOADING_UNAVAILABLE };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: TOOL_LOADING_UNAVAILABLE } };
      yield { type: 'finish', reason: { kind: 'completed' } };
    })();
  }, { global: true });
}
