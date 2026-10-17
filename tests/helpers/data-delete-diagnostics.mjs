import { observeSafely, subscribeErasure } from '../../src/personal-data/diagnostics.mjs';

// Keep phase data in the test process, outside the public /personal/v1 contract.
// A frozen copy at the original final poll must survive subsequent cleanup.
export function observeErasure() {
  const records = [], started = new Map();
  const observe = row => {
    const at = row.event === 'start' ? performance.now() : null;
    records.push(row);
    if (row.event === 'start') started.set(row.step, at);
  };
  const unsubscribe = subscribeErasure(observe);
  return {
    snapshot(operationId) {
      return observeSafely(() => {
        const events = records.filter(row => row.operationId === operationId);
        const ended = new Set(events.filter(row => row.event === 'end').map(row => row.step));
        return { lastReached: events.at(-1) ?? null,
          waiting: events.filter(row => row.event === 'start' && !ended.has(row.step))
            .map(row => ({ ...row, durationMs: Math.round(performance.now() - started.get(row.step)) })), events };
      }, { observationFailed: true });
    },
    close() { unsubscribe(); },
  };
}

export function erasureFailureMessage(operation, diagnostics) {
  return observeSafely(() => JSON.stringify({ operation, diagnostics }), 'observationFailed=true');
}
