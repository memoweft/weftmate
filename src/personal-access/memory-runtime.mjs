import { handlePersonalMemoryHttp } from '../personal-memory/http.mjs';

const failure = code => Object.assign(new Error(code), { code });

/** The parent resolves owner and model permissions before dispatching model output. */
export async function handlePersonalMemoryTool(manager, ownerId, tool, { sessionId, modelTier, memoryPolicy } = {}) {
  const args = tool?.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw failure('MEMORY_REQUEST_INVALID');
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
      }))], contextText: recalled.contextText };
  }
  const correct = tool.name === 'memory_correct';
  if (!correct && tool.name !== 'memory_forget' ||
      !['cognition', 'entity', 'relationship', 'event', ...(correct ? [] : ['evidence'])].includes(args.kind) ||
      typeof args.id !== 'string' || !/^[A-Za-z0-9._:-]{1,512}$/.test(args.id) ||
      Object.keys(args).some(key => !['kind', 'id', 'expectedWorldRevision', ...(correct ? ['text'] : [])].includes(key))) {
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
