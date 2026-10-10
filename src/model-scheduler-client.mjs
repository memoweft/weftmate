import { AsyncLocalStorage } from 'node:async_hooks';
const heldSlot = new AsyncLocalStorage();
export async function acquireModelSlot(priority, signal, scheduler = process.env.WEFTMATE_MODEL_SCHEDULER_URL, destination = {}, { onPreempt } = {}) {
  if (heldSlot.getStore() === JSON.stringify(destination)) return () => {};
  if (!scheduler) return () => {};
  const query = new URLSearchParams({ priority, ...destination });
  const response = await fetch(`${scheduler}/lease?${query}`, { method: 'POST', signal });
  if (!response.ok) {
    let code = 'MODEL_QUEUE_UNAVAILABLE';
    try { code = (await response.json()).code ?? code; } catch { /* Keep transport failures private. */ }
    throw Object.assign(new Error(code), { code });
  }
  if (onPreempt && response.body) {
    const reader = response.body.getReader();
    let released = false;
    // The server closes this socket when foreground work takes precedence.
    // Observing the lease through its lifetime propagates cancellation to the
    // actual inference request, even after its response headers have arrived.
    void (async () => {
      try { while (!(await reader.read()).done) {} }
      catch { /* Socket errors and an early EOF both cancel the suggestion. */ }
      finally { if (!released) onPreempt(); }
    })();
    return async () => { if (released) return; released = true; await reader.cancel().catch(() => {}); };
  }
  return () => response.body?.cancel().catch(() => {});
}
export async function runWithModelSlot(priority, signal, work, scheduler = process.env.WEFTMATE_MODEL_SCHEDULER_URL, destination = {}) {
  const release = await acquireModelSlot(priority, signal, scheduler, destination);
  try { return await heldSlot.run(JSON.stringify(destination), work); } finally { await release(); }
}
export const isBackgroundPurpose = purpose => purpose === 'session-title' ||
  ['memory', 'companion', 'health', 'background'].some(prefix => purpose === prefix || purpose?.startsWith(`${prefix}-`));

export async function scheduledModelFetch(url, options, scheduler) {
  const { priority = 'foreground', onStart, ...requestOptions } = options;
  const interrupted = new AbortController();
  const signal = priority === 'suggestion'
    ? options.signal ? AbortSignal.any([options.signal, interrupted.signal]) : interrupted.signal
    : options.signal;
  const release = await acquireModelSlot(priority, signal, scheduler,
    { baseUrl: String(url).replace(/\/chat\/completions\/?$/, '') },
    priority === 'suggestion' ? { onPreempt: () => interrupted.abort(Object.assign(new Error('MODEL_SUGGESTION_BUSY'), { code: 'MODEL_SUGGESTION_BUSY' })) } : {});
  try {
    signal?.throwIfAborted();
    await onStart?.();
    signal?.throwIfAborted();
    const response = await fetch(url, { ...requestOptions, signal });
    if (!response.body) { await release(); return response; }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const value = await reader.read();
          if (value.done) { await release(); controller.close(); }
          else controller.enqueue(value.value);
        } catch (error) { await release(); controller.error(error); }
      },
      async cancel(reason) { try { await reader.cancel(reason); } finally { await release(); } },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { await release(); throw error; }
}
