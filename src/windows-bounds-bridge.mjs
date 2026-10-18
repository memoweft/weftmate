import { createInterface } from 'node:readline';

// Normal isolated startup measured 437–618ms including Electron. Two seconds
// permits cold PowerShell compilation while bounding an invisible startup.
export const WINDOW_BOUNDS_BRIDGE_TIMEOUT_MS = 2000;

export function createWindowsBoundsBridge({ start, input, convert, verify, terminate, timeoutMs = WINDOW_BOUNDS_BRIDGE_TIMEOUT_MS }) {
  let child, lines, timer, settled = false, sent = false, stopping = Promise.resolve();
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const fail = error => {
    if (settled) return;
    settled = true; clearTimeout(timer); lines?.close();
    stopping = Promise.resolve().then(() => terminate(child));
    // Always handle pipe errors, including EPIPE after timeout/cancellation.
    child?.stdin?.destroy();
    rejectReady(error);
  };
  const complete = error => {
    if (settled) return;
    if (error) return fail(error);
    try {
      if (!sent || !verify()) throw Object.assign(new Error('WINDOW_BOUNDS_NOT_CONFIRMED'), { code: 'WINDOW_BOUNDS_NOT_CONFIRMED' });
      settled = true; clearTimeout(timer); lines?.close(); resolveReady();
    } catch (failure) { fail(failure); }
  };
  try {
    child = start(complete);
    const pipeError = error => fail(error);
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on('error', pipeError);
    lines = createInterface({ input: child.stdout }); lines.on('error', pipeError);
    lines.once('line', line => {
      if (settled) return;
      try { child.stdin.end(JSON.stringify(convert(JSON.parse(line))) + '\n'); sent = true; }
      catch (error) { fail(error); }
    });
    timer = setTimeout(() => fail(Object.assign(new Error('WINDOW_BOUNDS_TIMEOUT'), { code: 'WINDOW_BOUNDS_TIMEOUT' })), timeoutMs);
    child.stdin.write(JSON.stringify(input) + '\n');
  } catch (error) { fail(error); }
  return { ready, cancel() {
    fail(Object.assign(new Error('WINDOW_BOUNDS_CANCELLED'), { code: 'WINDOW_BOUNDS_CANCELLED' }));
    return stopping;
  } };
}
