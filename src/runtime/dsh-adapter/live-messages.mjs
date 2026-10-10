/** Rebuild display snapshots from the authoritative native log. No second cache
 * or durable copy: native chunks retain their seq/time across reconnects.
 * Final messages replace snapshots and remain the transcript authority. */
export function liveMessages(entries, redact) {
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
        row = { seq: event.seq, time: event.time, text: '', cursor: event.seq, turn: data.turn, step: data.step };
        pending.set(key, row);
      }
      if (data.chunk?.type === 'text-delta' && typeof data.chunk.text === 'string') row.text += data.chunk.text;
      row.cursor = event.seq;
      if (data.chunk?.type === 'finish') row.finished = true;
    }
    if (event.type === 'assistant/message') { pending.delete(key); sources.push(event.seq); }
    if (event.type === 'turn/end') ended = true;
  }
  return [...pending.values()].filter(row => row.text).map(row => ({ seq: row.seq, type: 'assistant.delta',
    ...(Number.isFinite(row.time) ? { at: new Date(row.time).toISOString() } : {}),
    data: { text: redact(row.text), cursor: row.cursor, turn: row.turn, step: row.step, streaming: !ended,
      sourceSeqs: sources } }));
}
