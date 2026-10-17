import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';

const scope = new AsyncLocalStorage();
const diagnostics = channel('weftmate.data-erasure');
let nextStep = 0;

// Only fixed phase names, timings, enums and a random operation id leave this
// scope. Never pass dependency messages, owner ids, file names or paths here.
export function traceErasure(operationId, work) {
  return scope.run({ operationId, parentStep: null }, work);
}

export function erasureTraceId() { return scope.getStore()?.operationId; }

export function beginErasurePhase(phase) {
  const active = scope.getStore();
  if (!active) return () => {};
  const started = performance.now(), step = ++nextStep;
  const publish = (event, result, errorCode) => {
    const row = { operationId: active.operationId, step, parentStep: active.parentStep,
      phase, event, durationMs: Math.round(performance.now() - started), result, errorCode };
    process.stderr.write(`DATA_DELETE_435 ${JSON.stringify(row)}\n`);
    diagnostics.publish(row);
  };
  publish('start', 'running', null);
  const end = (error, result = 'ok') => publish('end', error ? 'error' : result,
    error ? (/^[A-Z][A-Z0-9_]{1,63}$/.test(error.code ?? '') ? error.code : 'UNKNOWN') : null);
  end.step = step;
  return end;
}

export async function erasurePhase(phase, work, { skip = false } = {}) {
  const active = scope.getStore();
  const end = beginErasurePhase(phase);
  if (skip) { end(null, 'skipped'); return; }
  try {
    const result = await (active
      ? scope.run({ ...active, parentStep: end.step }, work) : work());
    end();
    return result;
  } catch (error) { end(error); throw error; }
}

export function erasureCheck(phase, work, { result = 'ok' } = {}) {
  const end = beginErasurePhase(phase);
  try { const value = work(); end(null, result); return value; }
  catch (error) { end(error); throw error; }
}
