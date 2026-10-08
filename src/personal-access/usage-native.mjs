/** Wrap native DSH usage chunks; the private host bridge owns persistence/budgets. */
export function usageSessionId(sessionId, sessions) {
  let session = sessionId ? sessions?.get(sessionId) : null;
  while (session?.header?.parentSession) { sessionId = session.header.parentSession; session = sessions.get(sessionId); }
  return sessionId;
}
export async function* meteredNativeStream(options, stream, scheduler = process.env.WEFTMATE_MODEL_SCHEDULER_URL, sessionId = options.sessionId) {
  if (!scheduler) { yield* stream(options); return; }
  const post = async (route, body) => {
    const response = await fetch(`${scheduler}/usage/${route}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      if (response.status === 402) throw Object.assign(new Error('本月用量已达到上限，云端模型请求已暂停。请在设置 → 用量提高本月上限，或切换本地模型。'), { code: 'USAGE_LIMIT_REACHED' });
      throw new Error('用量记录服务不可用，请稍后重试。');
    }
    return response.json();
  };
  const ticket = await post('start', { profileId: options.provider, sessionId });
  let usage = null;
  try {
    for await (const chunk of stream(options)) {
      if (chunk?.type === 'usage') usage = chunk.usage;
      yield chunk;
    }
  } finally { if (ticket.requestId) await post('finish', { ...ticket, usage, source: 'dsh' }); }
}
