import { failure } from './common.mjs';

/** Older backend compositions expose only timeline pages. Read backwards to
 * the requested binding, stopping at its start rather than the session start.
 * Production uses the native source reader and skips steps entirely.
 */
export async function readSourceEvents(context, input, observe) {
  if (typeof context.backend.readSourceEvents === 'function') {
    return observe(() => context.backend.readSourceEvents(input));
  }
  let beforeSeq, suffix = [], current = true;
  while (true) {
    const page = await observe(() => context.backend.readEvents({ sessionId: input.sessionId,
      ownerId: input.ownerId, ...(beforeSeq === undefined ? {} : { beforeSeq }), limit: 200 }));
    if (!Array.isArray(page?.events) || page.events.length > 200 ||
        typeof page.hasMore !== 'boolean' || !Number.isSafeInteger(page.nextSeq)) throw failure('BACKEND_UNAVAILABLE', 503);
    let last = -1;
    for (const event of page.events) {
      if (!Number.isSafeInteger(event?.seq) || event.seq <= last || beforeSeq !== undefined && event.seq >= beforeSeq) {
        throw failure('BACKEND_UNAVAILABLE', 503);
      }
      last = event.seq;
    }
    for (let i = page.events.length - 1; i >= 0; i--) {
      const event = page.events[i];
      suffix.push(event);
      if (event.type !== 'turn.started') continue;
      if ((input.turn === undefined || event.data?.turn === input.turn) &&
          suffix.some(row => row.type === 'user.message' && row.data?.receiptId === input.receiptId)) {
        return { current, events: suffix.reverse() };
      }
      // Approval callers already know the turn. A newer boundary cannot
      // make that earlier turn live, nor can an older turn supply its receipt.
      if (input.turn !== undefined && event.data?.turn <= input.turn) return { current: false, events: [] };
      suffix = []; current = false;
    }
    const older = page.hasOlder ?? page.hasMore;
    if (!older) return { current: false, events: [] };
    const cursor = page.nextBeforeSeq ?? page.events[0]?.seq;
    if (!Number.isSafeInteger(cursor) || beforeSeq !== undefined && cursor >= beforeSeq) throw failure('BACKEND_UNAVAILABLE', 503);
    beforeSeq = cursor;
  }
}
