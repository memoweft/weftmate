/** Status facts only: no titles, arguments, questions or temporary content. */
export const terminalOutcome = event => ['turn.ended', 'task.ended'].includes(event?.type)
  ? ({ completed: 'completed', failed: 'failed', error: 'failed', blocked: 'failed', aborted: 'stopped', stopped: 'stopped' }[event.data?.reason] ?? null) : null;
export function readSnapshotSeq(page, knownSeq = -1) {
  if (Number.isSafeInteger(page?.nextSeq) && page.nextSeq >= -1) return page.nextSeq;
  return Math.max(knownSeq, -1, ...(page?.events ?? []).filter(event => event.type === 'assistant.message' || terminalOutcome(event))
    .map(event => event.seq).filter(Number.isSafeInteger));
}
export const statusRank = row => row?.attention === 'approval' ? 5 : row?.attention === 'question' ? 4 : row?.running ? 3 : row?.unread ? row.lastOutcome === 'failed' ? 2 : 1 : 0;
export function aggregateStatus(rows) {
  const row = rows.reduce((best, item) => statusRank(item) > statusRank(best) ? item : best, null);
  return { attention: row?.attention ?? null, running: row?.running === true, unread: row?.unread === true, lastOutcome: row?.lastOutcome ?? null };
}
