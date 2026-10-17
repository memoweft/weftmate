import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage();
const observers = new Set(), writers = new WeakMap();
let nextStep = 0;
let observationFailed = false;

export function observeSafely(work, fallback) {
  try { return work(); }
  catch { observationFailed = true; return fallback; }
}

// diagnostics_channel turns subscriber throws into uncaught nextTick errors;
// catch around publish cannot isolate them. Keep delivery inside our own guard.
export function subscribeErasure(observer) {
  observeSafely(() => observers.add(observer));
  return () => { observeSafely(() => observers.delete(observer)); };
}

export function erasureObservationFailed() { return observationFailed; }

function writeDiagnostic(row) {
  observeSafely(() => {
    const text = `DATA_DELETE_435 ${JSON.stringify(row)}\n`, stream = process.stderr;
    let writer = writers.get(stream);
    if (!writer) {
      writer = { pending: 0, listening: false, onError: () => { observationFailed = true; } };
      writers.set(stream, writer);
    }
    if (!writer.listening) { stream.on('error', writer.onError); writer.listening = true; }
    writer.pending++;
    let finished = false;
    const finish = error => observeSafely(() => {
      if (finished) return;
      finished = true;
      if (error) observationFailed = true;
      writer.pending--;
      // Writable emits error after its write callback. Keep our one listener
      // through that emission, then remove it when our writes have drained.
      queueMicrotask(() => observeSafely(() => {
        if (writer.pending === 0 && writer.listening) {
          stream.removeListener('error', writer.onError); writer.listening = false;
        }
      }));
    });
    try { stream.write(text, finish); }
    catch (error) { finish(error); throw error; }
  });
}

function publish(row) {
  writeDiagnostic(row);
  observeSafely(() => {
    for (const observer of [...observers]) observeSafely(() => {
      const result = observer(row);
      if (result?.then) Promise.resolve(result).catch(() => { observationFailed = true; });
    });
  });
}

function runInScope(store, work) {
  let invoked = false, value, failed = false, failure;
  observeSafely(() => scope.run(store, () => {
    invoked = true;
    try { value = work(); }
    catch (error) { failed = true; failure = error; }
  }));
  // A broken observation context must never prevent or repeat the actual work.
  if (!invoked) return work();
  if (failed) throw failure;
  return value;
}

// Only fixed phase names, timings, enums and a random operation id leave this
// scope. Never pass dependency messages, owner ids, file names or paths here.
export function traceErasure(operationId, work) {
  return runInScope({ operationId, parentStep: null }, work);
}

export function erasureTraceId() { return observeSafely(() => scope.getStore()?.operationId); }

export function beginErasurePhase(phase) {
  return observeSafely(() => {
    const active = scope.getStore();
    if (!active) return () => {};
    const started = performance.now(), step = ++nextStep;
    const record = (event, result, errorCode) => observeSafely(() => publish(Object.freeze({
      operationId: active.operationId, step, parentStep: active.parentStep,
      phase, event, durationMs: Math.round(performance.now() - started), result, errorCode,
    })));
    record('start', 'running', null);
    const end = (error, result = 'ok', errorCode = () => error?.code) => observeSafely(() => {
      const code = error ? errorCode() : null;
      record('end', error ? 'error' : result,
        error ? (/^[A-Z][A-Z0-9_]{1,63}$/.test(code ?? '') ? code : 'UNKNOWN') : null);
    });
    end.step = step;
    return end;
  }, () => {});
}

export async function erasurePhase(phase, work, { skip = false } = {}) {
  const active = observeSafely(() => scope.getStore());
  const end = beginErasurePhase(phase);
  if (skip) { end(null, 'skipped'); return; }
  try {
    const store = observeSafely(() => active && ({ ...active, parentStep: end.step }));
    const result = await (store ? runInScope(store, work) : work());
    end();
    return result;
  } catch (error) { end(error); throw error; }
}

export function erasureCheck(phase, work, { result = 'ok' } = {}) {
  const end = beginErasurePhase(phase);
  try { const value = work(); end(null, result); return value; }
  catch (error) { end(error); throw error; }
}
