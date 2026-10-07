import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openAICompatibleEndpoint } from './openai-compatible-client.ts';

/** One inference slot, with foreground FIFO and native DSH turn-wide idle checks. */
export function createInferenceQueue({ isIdle = async () => true, pollMs = 100 } = {}) {
  const pending = [];
  let active = null, draining = false, timer = null, closed = false;
  async function drain() {
    if (active || draining || closed) return;
    draining = true;
    try {
      let item = pending.find(row => row.priority === 'foreground');
      if (!item && pending.length && await isIdle()) item = pending.find(row => row.priority === 'foreground') ?? pending[0];
      if (item && pending.includes(item) && !active && !closed) {
        pending.splice(pending.indexOf(item), 1);
        active = item;
        item.resolve(() => {
          if (active !== item) return;
          active = null; item.signal?.removeEventListener('abort', item.abort); void drain();
        });
      }
    } catch { /* A failed native idle probe cannot start background inference. */ }
    finally {
      draining = false;
      if (!active && pending.length && !closed) timer = setTimeout(drain, pollMs);
    }
  }
  return {
    acquire(priority, signal) {
      if (closed) return Promise.reject(new Error('MODEL_QUEUE_CLOSED'));
      signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        const item = { priority, signal, resolve, reject, abort: null };
        item.abort = () => {
          const index = pending.indexOf(item);
          if (index !== -1) { pending.splice(index, 1); reject(signal.reason); }
          else if (active === item) { active = null; void drain(); }
        };
        signal?.addEventListener('abort', item.abort, { once: true });
        pending.push(item); void drain();
      });
    },
    status: () => ({ active: active?.priority ?? null,
      foregroundPending: pending.filter(row => row.priority === 'foreground').length,
      backgroundPending: pending.filter(row => row.priority === 'background').length }),
    close() { closed = true; clearTimeout(timer); for (const item of pending.splice(0)) {
      item.signal?.removeEventListener('abort', item.abort); item.reject(new Error('MODEL_QUEUE_CLOSED'));
    } },
  };
}

/** Private loopback bridge shared by native DSH streams and MemoWeft workers. */
export async function createModelScheduler({ isIdle, profileFor, backgroundRoute, credentialFor, fetchImpl = fetch,
  localSlotsFor = async () => undefined, heartbeatMs = 15_000 }) {
  const queues = new Map();
  async function queueFor(destination) {
    const profile = destination.profileId ? profileFor(destination.profileId) : undefined;
    const baseUrl = profile?.baseUrl ?? destination.baseUrl;
    if (!baseUrl) return null;
    const endpoint = new URL(baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) && profile?.modelTier !== 'local') return null;
    endpoint.pathname = endpoint.pathname.replace(/\/?(?:v1\/?)?$/, '/props');
    endpoint.search = ''; endpoint.hash = '';
    let slots;
    try {
      const key = profile && credentialFor(profile);
      const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(2000),
        headers: key ? { authorization: `Bearer ${key}` } : {} });
      if (response.ok) slots = (await response.json()).total_slots;
    } catch { /* A managed service's configuration also identifies its single slot. */ }
    if (!Number.isInteger(slots) || slots < 1) slots = await localSlotsFor(endpoint);
    if (slots !== 1) return null;
    const identity = endpoint.href;
    if (!queues.has(identity)) queues.set(identity, createInferenceQueue({ isIdle }));
    return queues.get(identity);
  }
  const queue = { status: () => {
    const rows = [...queues.values()].map(value => value.status());
    return { active: rows.find(row => row.active === 'foreground')?.active ?? rows.find(row => row.active)?.active ?? null,
      foregroundPending: rows.reduce((sum, row) => sum + row.foregroundPending, 0),
      backgroundPending: rows.reduce((sum, row) => sum + row.backgroundPending, 0) };
  }, close: () => { for (const value of queues.values()) value.close(); } };
  const token = randomBytes(24).toString('hex');
  const controllers = new Set();
  const server = createServer(async (request, response) => {
    const controller = new AbortController(); controllers.add(controller);
    response.once('close', () => { controller.abort(); controllers.delete(controller); });
    let release;
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const prefix = `/${token}`;
      if (!url.pathname.startsWith(`${prefix}/`)) { response.writeHead(404).end(); return; }
      const route = url.pathname.slice(prefix.length);
      if (route === '/route' && request.method === 'GET') {
        const value = await backgroundRoute(url.searchParams.get('sessionId'), url.searchParams.get('profileId'));
        response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); return;
      }
      if (route === '/lease' && request.method === 'POST') {
        const priority = url.searchParams.get('priority') === 'background' ? 'background' : 'foreground';
        const selectedQueue = await queueFor({ profileId: url.searchParams.get('profileId'), baseUrl: url.searchParams.get('baseUrl') });
        if (!selectedQueue) { response.writeHead(204).end(); return; }
        release = await selectedQueue.acquire(priority, controller.signal);
        response.once('close', release);
        response.writeHead(200, { 'content-type': 'text/plain' }); response.write('granted\n');
        return; // Socket lifetime owns the lease, including a crashed DSH child.
      }
      const match = /^\/inference\/([A-Za-z0-9._-]+)\/(?:v1\/)?(chat\/completions|models|props)$/.exec(route);
      if (!match) { response.writeHead(404).end(); return; }
      const profile = profileFor(match[1]);
      const key = profile && credentialFor(profile);
      if (!profile || !key || request.headers.authorization !== `Bearer ${key}`) { response.writeHead(403).end(); return; }
      if (match[2] === 'chat/completions') {
        // MemoWeft's HTTP timeout measures transport inactivity. Informational
        // responses keep queued work alive without changing the final status/body.
        const heartbeat = setInterval(() => { if (!response.headersSent) response.writeProcessing(); }, heartbeatMs);
        try { const selectedQueue = await queueFor({ profileId: match[1] });
          if (selectedQueue) release = await selectedQueue.acquire('background', controller.signal); }
        finally { clearInterval(heartbeat); }
      }
      let body;
      if (request.method === 'POST') {
        const parts = []; for await (const part of request) parts.push(part);
        const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
        body = JSON.stringify({ ...value, model: profile.model });
      }
      const endpoint = match[2] === 'props'
        ? new URL(profile.baseUrl.replace(/\/?v1\/?$/, '/props'))
        : openAICompatibleEndpoint(profile.baseUrl, match[2]);
      const upstream = await fetchImpl(endpoint, { method: request.method, signal: controller.signal,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body });
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'x-modelswitcher-model': profile.model });
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
      else response.end();
    } catch {
      if (!response.headersSent) response.writeHead(503);
      response.end();
    } finally {
      // A native lease remains open until its owner closes the response body.
      if (!request.url.includes('/lease?')) release?.();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/${token}`;
  return { url, queue,
    memoryBaseUrl: profileId => `${url}/inference/${profileId}/v1`,
    async close() { queue.close(); for (const controller of controllers) controller.abort();
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
