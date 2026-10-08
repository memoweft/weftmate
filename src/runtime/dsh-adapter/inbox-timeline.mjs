/** Lazy metadata from native inbox splices. Reads only the requested timeline suffix. */
const raw = entry => entry?.event ?? entry;
const messageMeta = message => ({ receiptId: message?.source?.kind === 'user' ? message.source.rpcId : null,
  text: (message?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('') });

// Reverse the normalized splice coordinates to locate the insertion of one
// removed message. No live inbox or separate queue state is reconstructed.
function removedMessage(entries, before, target, position) {
  for (let i = before - 1; i >= 0; i--) {
    const event = raw(entries[i]), data = event.data ?? {};
    if (event.type !== 'agent/inbox/spliced' || data.target !== target) continue;
    const inserted = data.inserted ?? [];
    if (position >= data.start && position < data.start + inserted.length) return messageMeta(inserted[position - data.start]);
    if (position >= data.start + inserted.length) position += (data.removedCount ?? 0) - inserted.length;
  }
  return null;
}

/** Receipt owning the open turn at one native input insertion, even before user/message commits. */
export function turnReceiptAt(entries, position) {
  let receiptId = null;
  for (let i = position - 1; i >= 0; i--) {
    const event = raw(entries[i]), data = event.data ?? {};
    if (event.type === 'turn/end') return null;
    if (event.type === 'turn/start') return receiptId;
    if (event.type === 'user/message' && data.source?.kind === 'user') receiptId = data.source.rpcId;
    if (event.type === 'agent/inbox/spliced' && data.removedCount && data.outcome !== 'canceled') {
      if (data.target === 'next-turn') receiptId = removedMessage(entries, i, data.target, data.start)?.receiptId ?? receiptId;
      else if (data.target === 'next-step') for (let offset = data.removedCount - 1; offset >= 0; offset--) {
        receiptId = removedMessage(entries, i, data.target, data.start + offset)?.receiptId ?? receiptId;
      }
    }
  }
  return null;
}

export function indexInboxTimeline(entries, cache, position) {
  cache.inboxEvents ??= new Map();
  const metadata = cache.inboxEvents;
  const at = index => {
    const event = raw(entries[index]), data = event.data ?? {};
    if (metadata.has(event.seq)) return metadata.get(event.seq);
    let result = null;
    if (event.type === 'agent/inbox/spliced' && data.target === 'next-turn') {
      if (data.inserted?.length) result = { type: 'task.queued', tasks: data.inserted.map(messageMeta) };
      else if (data.outcome === 'canceled' && data.removedCount) result = { type: 'task.ended', reason: 'canceled',
        tasks: Array.from({ length: data.removedCount }, (_, offset) => removedMessage(entries, index, data.target, data.start + offset)).filter(Boolean) };
    }
    if (event.type === 'step/start' || event.type === 'step/end') {
      let receiptId = null;
      for (let i = index - 1; i >= 0; i--) {
        const earlier = raw(entries[i]), splice = earlier.data ?? {};
        const cached = metadata.get(earlier.seq);
        if (cached?.receiptId) { receiptId = cached.receiptId; break; }
        if (earlier.type === 'turn/start') break;
        if (earlier.type === 'user/message' && splice.source?.kind === 'user') receiptId = splice.source.rpcId;
        if (earlier.type === 'agent/inbox/spliced' && splice.target === 'next-turn' &&
            splice.removedCount && splice.outcome !== 'canceled') {
          receiptId = removedMessage(entries, i, splice.target, splice.start)?.receiptId ?? receiptId;
          break;
        }
      }
      result = { receiptId: receiptId ?? turnReceiptAt(entries, index) };
    }
    metadata.set(event.seq, result);
    return result;
  };
  if (position !== undefined) return at(position);
  for (let i = 0; i < entries.length; i++) at(i);
  return metadata;
}
