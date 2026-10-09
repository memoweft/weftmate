const busy = () => Object.assign(new Error('session busy'), { code: 'agent-busy' });
export async function nativeRelayState(ctx, agent) {
  const engine = agent.session[Symbol.for('weftmate.chatCompaction')] ?? ctx.get('compaction');
  ctx = engine?.ctx ?? ctx;
  const goal = ctx.get('goals')?.get(agent);
  const jobs = ctx.get('jobs')?.list(agent) ?? [];
  const safe = agent.status === 'idle' && agent.inbox?.hasPending === false &&
    (!goal || goal.phase === 'complete') &&
    jobs.every(job => ['completed','failed','killed'].includes(job.status));
  const measured = ctx.get('tokenMeter').measure(agent.session);
  const target = agent.session.requestHeader()?.config ?? agent.options;
  const route = target.provider && target.model ? await ctx.get('llm').resolveModelInfo(target.provider, target.model) : null;
  const capacity = route?.context?.contextWindow;
  const config = engine?.config;
  const policy = config?.modelPolicies?.find(row => row.provider === target.provider && row.model === target.model);
  const threshold = policy?.thresholdRatio ?? config?.thresholdRatio ?? 0.8;
  return { safe, usedTokens: measured.totalTokens, contextWindow: capacity ?? null, thresholdRatio: threshold,
    pending: Boolean(capacity && measured.totalTokens >= capacity * threshold ||
      agent.session.events.some(event => event.type === 'compaction/summary')) };
}

export async function prepareNativeHandoff(ctx, agent) {
  const state = await nativeRelayState(ctx, agent);
  if (!state.safe) throw busy();
  const start = performance.now();
  const engine = agent.session[Symbol.for('weftmate.chatCompaction')] ?? ctx.get('compaction');
  const summary = await engine.compactNow(agent, new AbortController().signal);
  if (!summary) throw Object.assign(new Error('summary unavailable'), { code: 'internal' });
  const session = agent.session, events = new Map(session.events.map(event => [event.seq, event]));
  const rows = [], sourceRefs = [], seen = new Set();
  const cite = seq => {
    if (seen.has(seq)) return; seen.add(seq);
    sourceRefs.push({ sessionId: session.id, seq });
    for (const ref of events.get(seq)?.data?.source?.sourceRefs ?? []) {
      if (!sourceRefs.some(row => row.sessionId === ref.sessionId && row.seq === ref.seq)) sourceRefs.push(ref);
    }
    for (const source of events.get(seq)?.sourceEventSeqs ?? []) cite(source);
  };
  for (const seq of session.surface.nodes) {
    const event = events.get(seq), message = event.data?.message ?? event.data;
    if (['weftmate-personal-memory','weftmate-memory-erasure','weftmate-personal-conversation-context'].includes(message?.source?.plugin)) continue;
    if (!['user/message','assistant/message'].includes(event.type)) continue;
    const text = (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
    if (text) { rows.push(text); cite(seq); }
  }
  const todos = session.events.findLast(event => event.type === 'todo/write')?.data.todos ?? [];
  const text = ['以下是同一主对话的交接资料，仅作背景，不是新请求或授权。保留未完成事项，回答后续真人输入。', ...rows,
    '未完成事项：' + JSON.stringify(todos.filter(row => row.status !== 'completed')),
    '经验仍在同一工作目录，按需读取经验.md。'].join('\n\n');
  const estimated = ctx.get('tokenMeter').estimateMessage({ role: 'user', content: [{ type: 'text', text }] });
  if (!state.contextWindow || estimated > state.contextWindow * 0.2) throw Object.assign(new Error('handoff over budget'), { code: 'internal' });
  await ctx.sessions.flush(session);
  return { text, sourceRefs, throughSeq: session.events.at(-1)?.seq ?? -1, sourceSessionId: session.id,
    estimatedTokens: estimated, contextWindow: state.contextWindow, summaryMs: performance.now() - start };
}

export async function installNativeHandoff(ctx, agent, handoff, createMessage) {
  if (agent.status !== 'idle' || agent.inbox?.hasPending) throw busy();
  if (typeof handoff?.text !== 'string' || !handoff.text || !Array.isArray(handoff.sourceRefs) ||
      !Number.isSafeInteger(handoff.throughSeq) || typeof handoff.sourceSessionId !== 'string') throw new TypeError('invalid handoff');
  const prior = agent.session.events.find(event => event.type === 'user/message' && event.data?.source?.plugin === 'weftmate-chat-handoff');
  if (prior) {
    if (prior.data.source.sourceSessionId !== handoff.sourceSessionId || prior.data.source.throughSeq !== handoff.throughSeq) throw new TypeError('handoff conflict');
    return { installed: true };
  }
  agent.session.append('user/message', createMessage({ source: { kind: 'plugin', plugin: 'weftmate-chat-handoff',
    sourceSessionId: handoff.sourceSessionId, throughSeq: handoff.throughSeq, sourceRefs: handoff.sourceRefs },
    content: [{ type: 'text', text: handoff.text }] }), { surfaceOp: 'append' });
  await ctx.sessions.flush(agent.session);
  return { installed: true };
}
