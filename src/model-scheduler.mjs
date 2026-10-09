import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openAICompatibleEndpoint } from './openai-compatible-client.ts';
import { usageResponse } from './personal-access/usage-response.mjs';

/** One inference slot, with foreground FIFO and native DSH turn-wide idle checks. */
export function createInferenceQueue({ isIdle = async () => true, pollMs = 100 } = {}) {
  const pending = [];
  let active = null, draining = false, timer = null, closed = false;
  function notify() {
    const foreground = pending.filter(row => row.priority === 'foreground');
    for (const row of foreground) row.onQueued?.(foreground.indexOf(row) + (active ? 1 : 0));
  }
  async function drain() {
    if (active || draining || closed) return;
    draining = true;
    try {
      let item = pending.find(row => row.priority === 'foreground');
      if (!item && pending.length && await isIdle()) item = pending.find(row => row.priority === 'foreground') ?? pending[0];
      if (item && pending.includes(item) && !active && !closed) {
        pending.splice(pending.indexOf(item), 1);
        active = item;
        notify();
        item.resolve(() => {
          if (active !== item) return;
          active = null; item.signal?.removeEventListener('abort', item.abort); notify(); void drain();
        });
      }
    } catch { /* A failed native idle probe cannot start background inference. */ }
    finally {
      draining = false;
      if (!active && pending.length && !closed) timer = setTimeout(drain, pollMs);
    }
  }
  return {
    acquire(priority, signal, onQueued = null) {
      if (closed) return Promise.reject(new Error('MODEL_QUEUE_CLOSED'));
      signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        const item = { priority, signal, resolve, reject, abort: null, onQueued };
        item.abort = () => {
          const index = pending.indexOf(item);
          if (index !== -1) { pending.splice(index, 1); notify(); reject(signal.reason); }
          else if (active === item) { active = null; void drain(); }
        };
        signal?.addEventListener('abort', item.abort, { once: true });
        pending.push(item); notify(); void drain();
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
  beginUsage = null, finishUsage = null,
  heartbeatMs = 15_000 }) {
  const queues = new Map();
  const progress = new Map();
  async function queueFor(destination) {
    const profile = profileFor(destination.profileId ?? destination.baseUrl);
    const baseUrl = profile?.baseUrl ?? destination.baseUrl;
    if (!baseUrl) return null;
    const endpoint = new URL(baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) return null;
    endpoint.pathname = endpoint.pathname.replace(/\/?(?:v1\/?)?$/, '/props');
    endpoint.search = ''; endpoint.hash = '';
    let slots;
    try {
      const key = profile && credentialFor(profile);
      const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(2000),
        headers: key ? { authorization: `Bearer ${key}` } : {} });
      if (response.ok) slots = (await response.json()).total_slots;
    } catch { /* Unknown capacity does not establish a single-slot service. */ }
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
      if (route === '/progress' && request.method === 'POST') {
        let raw = ''; for await (const part of request) raw += part;
        const input = JSON.parse(raw), current = progress.get(input.sessionId);
        if (current && ['reasoning', 'answering'].includes(input.phase)) current.phase = input.phase;
        response.writeHead(204).end(); return;
      }
      if ((route === '/usage/start' || route === '/usage/finish') && request.method === 'POST') {
        let raw = ''; for await (const part of request) raw += part;
        const input = JSON.parse(raw);
        let value = {};
        if (route === '/usage/start') {
          const profile = profileFor(input.profileId);
          if (profile && beginUsage) value = await beginUsage({ profileId: profile.id, sessionId: input.sessionId || null });
        } else if (finishUsage) await finishUsage(input);
        response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value ?? {})); return;
      }
      if (route === '/route' && request.method === 'GET') {
        const value = await backgroundRoute(url.searchParams.get('sessionId'), url.searchParams.get('profileId'));
        response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); return;
      }
      if (route === '/lease' && request.method === 'POST') {
        const priority = url.searchParams.get('priority') === 'background' ? 'background' : 'foreground';
        const sessionId = url.searchParams.get('sessionId');
        const state = { phase: 'waiting', profileId: url.searchParams.get('profileId') };
        if (priority === 'foreground' && sessionId) {
          progress.set(sessionId, state);
          response.once('close', () => { if (progress.get(sessionId) === state) progress.delete(sessionId); });
        }
        const selectedQueue = await queueFor({ profileId: url.searchParams.get('profileId'), baseUrl: url.searchParams.get('baseUrl') });
        if (!selectedQueue && !(priority === 'foreground' && sessionId)) { response.writeHead(204).end(); return; }
        release = await selectedQueue?.acquire(priority, controller.signal, ahead => {
          state.phase = 'queued'; state.ahead = ahead;
        });
        state.phase = 'waiting'; delete state.ahead;
        if (release) response.once('close', release);
        response.writeHead(200, { 'content-type': 'text/plain' }); response.write('granted\n');
        return; // Socket lifetime owns the lease, including a crashed DSH child.
      }
      const match = /^\/inference\/([A-Za-z0-9._-]+)(?:\/scope\/([A-Za-z0-9._:-]+)\/([A-Za-z0-9._:-]+))?\/(?:v1\/)?(chat\/completions|models|props)$/.exec(route);
      if (!match) { response.writeHead(404).end(); return; }
      const profile = profileFor(match[1]);
      const key = profile && credentialFor(profile);
      if (!profile || !key || request.headers.authorization !== `Bearer ${key}`) { response.writeHead(403).end(); return; }
      const operation = match[4];
      if (operation === 'chat/completions') {
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
      const endpoint = operation === 'props'
        ? new URL(profile.baseUrl.replace(/\/?v1\/?$/, '/props'))
        : openAICompatibleEndpoint(profile.baseUrl, operation);
      const usageTicket = operation === 'chat/completions' && beginUsage ? await beginUsage({ profileId: profile.id,
        ownerId: match[2] ?? null, sessionId: match[3] === 'none' ? null : match[3] ?? null }) : null;
      let upstream;
      try {
        upstream = await fetchImpl(endpoint, { method: request.method, signal: controller.signal,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body });
        if (usageTicket) upstream = await usageResponse(upstream, usage => finishUsage({ ...usageTicket, usage, source: 'openai' }));
      } catch (error) { if (usageTicket) await finishUsage({ ...usageTicket, usage: null }); throw error; }
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'x-modelswitcher-model': profile.model });
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
      else response.end();
    } catch (error) {
      if (!response.headersSent) { response.writeHead(error.code === 'USAGE_LIMIT_REACHED' ? 402 : 503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ code: error.code === 'USAGE_LIMIT_REACHED' ? error.code : 'MODEL_QUEUE_UNAVAILABLE' })); }
      else response.end();
    } finally {
      // A native lease remains open until its owner closes the response body.
      if (!request.url.includes('/lease?')) release?.();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/${token}`;
  return { url, queue,
    beginMemory(sessionId) {
      const state = { phase: 'memory' };
      progress.set(sessionId, state);
      return () => { if (progress.get(sessionId) === state) progress.delete(sessionId); };
    },
    async progress(sessionId) {
      const state = progress.get(sessionId);
      if (!state) return null;
      const profile = profileFor(state.profileId);
      const result = { phase: state.phase, ...(state.phase === 'queued' ? { ahead: state.ahead } : {}),
        modelName: profile?.name ?? null };
      if (state.phase === 'waiting' && profile?.baseUrl) {
        const endpoint = new URL(profile.baseUrl.replace(/\/?v1\/?$/, '/switch/status'));
        if (['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
          try {
            const key = credentialFor(profile);
            const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(1000),
              headers: key ? { authorization: `Bearer ${key}` } : {} });
            if (response.ok && (await response.json()).switching === true) result.phase = 'loading';
          } catch { /* An unavailable switcher is not evidence of loading. */ }
        }
      }
      return progress.get(sessionId) === state ? result : null;
    },
    memoryBaseUrl: (profileId, ownerId, sessionId) => `${url}/inference/${profileId}${ownerId ? `/scope/${ownerId}/${sessionId ?? 'none'}` : ''}/v1`,
    async close() { queue.close(); for (const controller of controllers) controller.abort();
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
