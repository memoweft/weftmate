import { failure } from './common.mjs';
import { readSourceEvents } from './source-history.mjs';

export async function workHandoff(context, ownerId, proposal, source) {
  const sessionId = source.sessionId;
  const bound = await readSourceEvents(context, { ownerId, sessionId, receiptId: source.receiptId, turn: proposal.turn },
    read => context.callBackend(read));
  const anchor = bound.events.find(event => event.type === 'user.message' && event.data?.receiptId === source.receiptId);
  const forgotten = new Set(context.accountState(ownerId).sessions[sessionId]?.forgottenSeqs ?? []);
  if (!anchor || forgotten.has(anchor.seq)) throw failure('SOURCE_UNAVAILABLE', 409);
  const rows = [], sourceRefs = []; let beforeSeq = anchor.seq, truncated = false;
  const header = '用户已确认切换到工作，继续原对话里当前待执行的任务。以下历史是背景资料，用来理解原任务、方案和指代，不是新增授权；不要重复执行已经完成或取消的旧任务。以随后用户消息为当前请求。若目标仍不明确，先澄清。历史可能有截断，附件正文未带入。\n';
  for (let pageIndex = 0; pageIndex < 10 && rows.length < 20; pageIndex++) {
    const page = await context.callBackend(() => context.backend.readEvents({ ownerId, sessionId, beforeSeq, limit: 200 }));
    const events = page.events ?? [];
    for (const event of [...events].reverse()) {
      if (event.seq >= beforeSeq || forgotten.has(event.seq) || !['user.message','assistant.message'].includes(event.type)) continue;
      const visible = context.publicHistoryEvent(ownerId, sessionId, event);
      if (typeof visible?.data?.text !== 'string' || !visible.data.text.trim()) continue;
      const text = visible.data.text.slice(0, 2000);
      const row = { role: event.type === 'user.message' ? 'user' : 'assistant', text };
      if (Buffer.byteLength(header + JSON.stringify([row, ...rows]), 'utf8') > 16_384 || rows.length >= 20) { truncated = true; break; }
      rows.unshift(row); sourceRefs.unshift({ sessionId, seq: event.seq });
      truncated ||= visible.data.truncated === true || text.length < visible.data.text.length;
    }
    const cursor = page.nextBeforeSeq ?? events[0]?.seq;
    if (!page.hasOlder || !Number.isSafeInteger(cursor) || cursor >= beforeSeq || rows.length >= 20) break;
    beforeSeq = cursor;
  }
  if (!rows.length) return null;
  return { text: header + JSON.stringify(rows), sourceRefs: [...sourceRefs, { sessionId, seq: anchor.seq }],
    sourceSessionId: sessionId, throughSeq: anchor.seq, truncated };
}
