/** Rebuild display snapshots from the authoritative native log. No second cache
 * or durable copy: native chunks retain their seq/time across reconnects.
 * Final messages replace snapshots and remain the transcript authority. */
export function liveMessages(entries, redact, includeThinking = false) {
  const tail = entries.at(-1)?.event ?? entries.at(-1);
  // A complete message/tool exchange has already sealed its preceding stream.
  // Bootstrap/cold transcript pages need no backward scan of old messages.
  if (!['assistant/chunk','step/end','turn/end'].includes(tail?.type) ||
      tail.type === 'turn/end' && tail.data?.reason?.kind === 'completed') return [];
  let start = entries.length - 1;
  for (; start >= 0; start--) if ((entries[start].event ?? entries[start]).type === 'turn/start') break;
  if (start < 0) return [];
  const pending = new Map(), sources = []; let ended = false;
  for (let i = start; i < entries.length; i++) {
    const event = entries[i].event ?? entries[i], data = event.data ?? {};
    const key = `${data.turn}:${data.step}`;
    if (event.type === 'user/message' && data.source?.kind === 'user') sources.push(event.seq);
    if (event.type === 'assistant/chunk') {
      let row = pending.get(key);
      if (!row || row.finished && data.chunk?.type !== 'finish') {
        row = { seq: event.seq, time: event.time, text: '', modelThinking: '', cursor: event.seq, turn: data.turn, step: data.step };
        pending.set(key, row);
      }
      if (data.chunk?.type === 'reasoning-delta' && typeof data.chunk.text === 'string' && includeThinking) {
        row.modelThinking += data.chunk.text;
        row.thinkingStart ??= event.time;
        row.thinkingEnd = event.time;
      }
      if (data.chunk?.type === 'text-delta' && typeof data.chunk.text === 'string') {
        if (!row.text && row.modelThinking) row.thinkingEnd = event.time;
        row.text += data.chunk.text;
      }
      row.cursor = event.seq;
      if (data.chunk?.type === 'finish') row.finished = true;
    }
    if (event.type === 'assistant/message') { pending.delete(key); sources.push(event.seq); }
    if (event.type === 'turn/end') ended = true;
  }
  return [...pending.values()].filter(row => row.text || row.modelThinking).map(row => ({ seq: row.seq, type: 'assistant.delta',
    ...(Number.isFinite(row.time) ? { at: new Date(row.time).toISOString() } : {}),
    data: { text: redact(row.text), cursor: row.cursor, turn: row.turn, step: row.step, streaming: !ended,
      sourceSeqs: sources, ...(row.modelThinking ? { modelThinking: redact(row.modelThinking),
        thinkingActive: !row.text && !row.finished && !ended,
        thinkingMs: Math.max(0, row.thinkingEnd - row.thinkingStart) } : {}) } }));
}

/** Duration from native timestamps; absent timestamps remain unknown. */
export function thinkingDuration(entries, message, endIndex = entries.length) {
  const seqs = message.sourceEventSeqs;
  if (!seqs?.length) return undefined;
  let start, end;
  for (let i = endIndex - 1; i >= 0; i--) {
    const event = entries[i].event ?? entries[i];
    if (event.seq < seqs[0]) break;
    if (event.seq > seqs.at(-1) || event.type !== 'assistant/chunk') continue;
    if (event.data?.chunk?.type === 'text-delta') end = event.time;
    if (event.data?.chunk?.type === 'reasoning-delta') { start = event.time; end ??= event.time; }
  }
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined;
}
