import { createChatTimeline } from '../../src/personal-access/chat-timeline.mjs';
import { reconcileChatIdentity } from '../../src/personal-access/chat-identity.mjs';
import { createChatOperations } from '../../src/personal-access/chats.mjs';

export function fixture(count = 120) {
  const account = { sessions: {}, commands: {} }, logs = new Map(), reads = { calls: 0, rows: 0, bytes: 0 };
  for (let s = 0; s < 3; s++) {
    const id = `native-${s}`; account.sessions[id] = {};
    logs.set(id, Array.from({ length: Math.ceil(count / 3) }, (_, i) => ({ seq: i * 2, at: new Date(Date.UTC(2026,9,8+s,0,0,i)).toISOString(),
      type: i % 10 === 3 ? 'step.completed' : i % 2 ? 'assistant.message' : 'user.message',
      data: { text: i % 10 === 3 ? '隐藏工具文字' : `合成中文纸船 ${s}-${i}`, ...(i % 7 === 0 ? { artifacts: [{ artifactId: `artifact-${i}` }] } : {}) } })));
  }
  reconcileChatIdentity(account, 'host', '2026-10-08T00:00:00.000Z');
  const identity = account.chatIdentity, mainId = identity.mainChatId;
  Object.values(identity.segments).forEach((segment, ordinal) => {
    delete identity.chats[segment.chatId]; segment.chatId = mainId; segment.ordinal = ordinal;
    segment.state = ordinal === 2 ? 'active' : 'sealed'; identity.chats[mainId].activeSegmentId = segment.segmentId;
  });
  const backend = { async readEvents({ sessionId, afterSeq, beforeSeq, limit = 50 }) {
    const all = logs.get(sessionId), forward = afterSeq !== undefined;
    const bound = value => { let lo = 0, hi = all.length; while (lo < hi) { const mid = (lo+hi)>>>1; if (all[mid].seq < value) lo = mid+1; else hi = mid; } return lo; };
    const start = forward ? bound(afterSeq + 1) : 0, end = forward || beforeSeq === undefined ? all.length : bound(beforeSeq);
    const events = forward ? all.slice(start, start + limit) : all.slice(Math.max(0, end - limit), end);
    reads.calls++; reads.rows += events.length; reads.bytes += Buffer.byteLength(JSON.stringify(events));
    return { events, nextSeq: forward ? events.at(-1)?.seq ?? afterSeq : all.at(-1)?.seq ?? -1,
      nextBeforeSeq: events[0]?.seq ?? null, hasMore: forward && end - start > limit, hasOlder: !forward && end - start > limit };
  } };
  const context = { accountState(owner) { if (owner !== 'owner') throw Object.assign(new Error(), { code: 'CHAT_UNAVAILABLE' }); return account; },
    backend, callBackend: fn => fn(), publicHistoryEvent: (_owner, _session, event) => event };
  context.chats = createChatOperations(context);
  const timeline = createChatTimeline(context);
  return { account, logs, reads, context, timeline, mainId,
    query: (action, params = {}) => timeline.query('owner', mainId, action, new URLSearchParams(params)) };
}
