import { AsyncLocalStorage } from 'node:async_hooks';
const heldSlot = new AsyncLocalStorage();
export async function acquireModelSlot(priority, signal, scheduler = process.env.WEFTMATE_MODEL_SCHEDULER_URL, destination = {}) {
  if (heldSlot.getStore() === JSON.stringify(destination)) return () => {};
  if (!scheduler) return () => {};
  const query = new URLSearchParams({ priority, ...destination });
  const response = await fetch(`${scheduler}/lease?${query}`, { method: 'POST', signal });
  if (!response.ok) throw new Error('MODEL_QUEUE_UNAVAILABLE');
  return () => response.body?.cancel().catch(() => {});
}
export async function runWithModelSlot(priority, signal, work, scheduler = process.env.WEFTMATE_MODEL_SCHEDULER_URL, destination = {}) {
  const release = await acquireModelSlot(priority, signal, scheduler, destination);
  try { return await heldSlot.run(JSON.stringify(destination), work); } finally { await release(); }
}
export const isBackgroundPurpose = purpose => purpose === 'session-title' ||
  ['memory', 'companion', 'health', 'background'].some(prefix => purpose === prefix || purpose?.startsWith(`${prefix}-`));

export async function scheduledModelFetch(url, options, scheduler) {
  const release = await acquireModelSlot('foreground', options.signal, scheduler, { baseUrl: String(url).replace(/\/chat\/completions\/?$/, '') });
  try {
    const response = await fetch(url, options);
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
