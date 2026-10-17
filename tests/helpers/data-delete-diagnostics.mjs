import { channel } from 'node:diagnostics_channel';

// Keep phase data in the test process, outside the public /personal/v1 contract.
// A frozen copy at the original final poll must survive subsequent cleanup.
export function observeErasure() {
  const records = [], started = new Map(), diagnostics = channel('weftmate.data-erasure');
  const observe = row => {
    records.push(row);
    if (row.event === 'start') started.set(row.step, performance.now());
  };
  diagnostics.subscribe(observe);
  return {
    snapshot(operationId) {
      const events = records.filter(row => row.operationId === operationId);
      const ended = new Set(events.filter(row => row.event === 'end').map(row => row.step));
      return { lastReached: events.at(-1) ?? null,
        waiting: events.filter(row => row.event === 'start' && !ended.has(row.step))
          .map(row => ({ ...row, durationMs: Math.round(performance.now() - started.get(row.step)) })), events };
    },
    close() { diagnostics.unsubscribe(observe); },
  };
}
