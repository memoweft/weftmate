/** Wrap native DSH usage chunks; the private host bridge owns persistence/budgets. */
import { isBackgroundPurpose } from '../model-scheduler-client.mjs';
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
  let phase = null;
  let phaseReport = Promise.resolve();
  try {
    for await (const chunk of stream(options)) {
      const next = chunk?.type === 'reasoning-delta' ? 'reasoning' : chunk?.type === 'text-delta' ? 'answering' : null;
      if (next && next !== phase && !isBackgroundPurpose(options.purpose)) {
        phase = next;
        const body = JSON.stringify({ sessionId: options.sessionId, phase });
        phaseReport = phaseReport.then(() => fetch(`${scheduler}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body, signal: AbortSignal.timeout(1000) })).then(() => {}, () => {});
      }
      if (chunk?.type === 'usage') usage = chunk.usage;
      yield chunk;
    }
  } finally { if (ticket.requestId) await post('finish', { ...ticket, usage, source: 'dsh' }); }
}
