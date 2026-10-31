import { handlePersonalMemoryHttp } from '../personal-memory/http.mjs';
import { forgetSourceText } from '../personal-memory/forget-model.mjs';

const failure = code => Object.assign(new Error(code), { code });

/** The parent resolves owner and model permissions before dispatching model output. */
export async function handlePersonalMemoryTool(manager, ownerId, tool, { sessionId, modelTier, memoryPolicy, signal } = {}) {
  const args = tool?.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw failure('MEMORY_REQUEST_INVALID');
  if (tool.name === 'memory_resume') {
    if (Object.keys(args).length) throw failure('MEMORY_REQUEST_INVALID');
    return manager.resumeAfterTurn(ownerId);
  }
  if (tool.name === 'memory_forget_request') {
    if (Object.keys(args).length || typeof tool.source?.text !== 'string' || !tool.source.text.trim() ||
        tool.source.text.length > 16000 || typeof tool.requestId !== 'string' || !/^memory-tool:[a-f0-9]{64}$/.test(tool.requestId)) throw failure('MEMORY_REQUEST_INVALID');
    if (memoryPolicy?.recall !== true) return { state: 'withheld', message: '这段对话没开记忆，这次没有按内容删除。' };
    return manager.forgetFromMessage(ownerId, { requestId: tool.requestId, source: tool.source, sessionId, modelTier, signal });
  }
  if (tool.name === 'memory_cleanup') {
    // Internal completion hook, not a registered model-facing tool. The durable
    // command journal already owns retrying cleanup after the active turn ends.
    if (Object.keys(args).some(key => key !== 'requestId') || typeof args.requestId !== 'string' ||
        !/^memory-tool:[a-f0-9]{64}$/.test(args.requestId)) throw failure('MEMORY_REQUEST_INVALID');
    const pathname = `/personal/v1/memory/commands/by-request/${args.requestId}/retry-cleanup`;
    return (await handlePersonalMemoryHttp({ manager, ownerId, pathname,
      url: new URL(pathname, 'http://memory'), request: { method: 'POST' }, readJson: async () => ({}) })).body;
  }
  if (tool.name === 'memory_query') {
    if (Object.keys(args).some(key => key !== 'query') || typeof args.query !== 'string' ||
        !args.query.trim() || args.query.length > 500) throw failure('MEMORY_REQUEST_INVALID');
    if (memoryPolicy?.recall !== true) return { state: 'withheld', reasonCode: 'RECALL_DISABLED',
      message: '这段对话没开记忆。' };
    const recalled = await manager.recall(ownerId, { query: args.query, sessionId, modelTier });
    return { state: recalled.state, reasonCode: recalled.reasonCode, worldRevision: recalled.worldRevision,
      items: [...(recalled.memories ?? []), ...(recalled.recentEvidence ?? []).map(item => ({
        id: item.id, kind: 'evidence', summary: item.summary,
      }))], contextText: recalled.contextText,
      ...(recalled.model_context_dependencies ? { model_context_dependencies: recalled.model_context_dependencies } : {}) };
  }
  const correct = tool.name === 'memory_correct';
  if (manager.mutateFromTool && ['memory_correct', 'memory_forget'].includes(tool.name)) {
    const byQuery = typeof args.query === 'string' && args.query.trim() && args.query.length <= 500;
    const byId = ['cognition', 'relationship', 'event', ...(correct ? [] : ['entity', 'evidence'])].includes(args.kind) &&
      typeof args.id === 'string' && /^[A-Za-z0-9._:-]{1,512}$/.test(args.id) &&
      Number.isSafeInteger(args.expectedWorldRevision) && args.expectedWorldRevision >= 0;
    if ((!byQuery && !byId) || byQuery && (args.id !== undefined || args.kind !== undefined) ||
        Object.keys(args).some(key => !['kind', 'id', 'expectedWorldRevision', 'query', ...(correct ? ['text', 'sourceQuote'] : [])].includes(key)) ||
        correct && (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 16000) ||
        correct && args.sourceQuote !== undefined && (typeof args.sourceQuote !== 'string' || !args.sourceQuote.trim() || args.sourceQuote.length > 16000) ||
        typeof tool.requestId !== 'string' || !/^memory-tool:[a-f0-9]{64}$/.test(tool.requestId)) throw failure('MEMORY_REQUEST_INVALID');
    // Subject classification reads candidates. An exact id must not bypass the
    // conversation's no-recall choice and send those facts to a model either.
    if (!correct && memoryPolicy?.recall !== true) return { state: 'withheld',
      message: '这段对话没开记忆，这次没有删除；你可以到记忆页选择要删除的内容。' };
    if (byQuery && memoryPolicy?.recall !== true) return { state: 'withheld', message: '这段对话没开记忆，请先开启记忆再按内容查找。' };
    if (!correct && forgetSourceText(tool.source) === null)
      return { state: 'withheld', message: '无法完整核对这条消息，这次没有执行遗忘；请单独发一条简短、明确的遗忘请求。' };
    return manager.mutateFromTool(ownerId, { requestId: tool.requestId, name: tool.name, arguments: args,
      sessionId, modelTier, source: tool.source, signal });
  }
  if (!correct && tool.name !== 'memory_forget' ||
      !['cognition', 'entity', 'relationship', 'event', ...(correct ? [] : ['evidence'])].includes(args.kind) ||
      typeof args.id !== 'string' || !/^[A-Za-z0-9._:-]{1,512}$/.test(args.id) ||
      Object.keys(args).some(key => !['kind', 'id', 'expectedWorldRevision', ...(correct ? ['text', 'sourceQuote'] : [])].includes(key))) {
    throw failure('MEMORY_REQUEST_INVALID');
  }
  const pathname = `/personal/v1/memory/${args.kind === 'evidence' ? 'evidence' : 'items/' + args.kind}/${args.id}${correct ? '/correct' : ''}`;
  // Reuse Core's established command, validation, conflict and receipt path.
  // Retain the user's original conversation; Core deletes the memory sources.
  const result = await handlePersonalMemoryHttp({ manager, ownerId, pathname,
    url: new URL(pathname, 'http://memory'), request: { method: correct ? 'POST' : 'DELETE' },
    readJson: async () => ({ requestId: tool.requestId, expectedWorldRevision: args.expectedWorldRevision,
      ...(correct ? { text: args.text } : {}) }),
  });
  return result.body;
}
