import { setTimeout as delay } from 'node:timers/promises';
import { canonicalProviderModelId } from './model-connection-check.mjs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openAICompatibleEndpoint } from './openai-compatible-client.ts';
import { usageResponse } from './personal-access/usage-response.mjs';

const suggestionBusy = () => Object.assign(new Error('MODEL_SUGGESTION_BUSY'), { code: 'MODEL_SUGGESTION_BUSY' });

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
    acquire(priority, signal, onQueued = null, onPreempt = null) {
      if (closed) return Promise.reject(new Error('MODEL_QUEUE_CLOSED'));
      signal?.throwIfAborted();
      if (priority === 'suggestion') {
        // Reserve synchronously before the native idle probe: two simultaneous
        // suggestions must never both observe an empty slot and enter inference.
        if (active || pending.length || draining) return Promise.reject(suggestionBusy());
        const item = { priority, signal, onPreempt, abort: null };
        active = item;
        const release = () => {
          signal?.removeEventListener('abort', item.abort);
          if (active !== item) return;
          active = null; notify(); void drain();
        };
        item.abort = release;
        signal?.addEventListener('abort', item.abort, { once: true });
        return (async () => {
          try {
            if (!await isIdle()) throw suggestionBusy();
            signal?.throwIfAborted();
            if (closed || active !== item || pending.length) throw suggestionBusy();
            return release;
          } catch (error) { release(); throw error; }
        })();
      }
      return new Promise((resolve, reject) => {
        const item = { priority, signal, resolve, reject, abort: null, onQueued, onPreempt };
        item.abort = () => {
          const index = pending.indexOf(item);
          if (index !== -1) { pending.splice(index, 1); notify(); reject(signal.reason); }
          else if (active === item) { active = null; void drain(); }
        };
        signal?.addEventListener('abort', item.abort, { once: true });
        pending.push(item); notify();
        if (priority === 'foreground' && ['background', 'suggestion'].includes(active?.priority)) active.onPreempt?.();
        void drain();
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

/** A formation request owns no World writes until its complete reply reaches Core.
 * Yield its unfinished generation to chat, then retry the same immutable request
 * at the next idle slot. Do not send partial output from a cancelled attempt.
 */
export async function runPreemptibleFormation(queue, signal, work,
  acquire = onPreempt => queue.acquire('background', signal, null, onPreempt)) {
  while (true) {
    signal.throwIfAborted();
    const attempt = new AbortController();
    const combined = AbortSignal.any([signal, attempt.signal]);
    let yielded = false;
    const release = await acquire(() => {
      yielded = true; attempt.abort(new Error('MODEL_BACKGROUND_YIELD'));
    });
    try {
      combined.throwIfAborted();
      return await work(combined);
    } catch (error) {
      if (!yielded || signal.aborted) throw error;
    } finally { release?.(); }
  }
}

/** Private loopback bridge shared by native DSH streams and MemoWeft workers. */
export async function createModelScheduler({ isIdle, profileFor, backgroundRoute, credentialFor, fetchImpl = fetch,
  beginUsage = null, finishUsage = null, backgroundReady = null, suggestionReady = null, onEvent = () => {},
  heartbeatMs = 15_000, memoryProfileFor = null }) {
  const queues = new Map();
  const progress = new Map();
  async function queueFor(destination, signal = null) {
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
      const timeout = AbortSignal.timeout(2000);
      const response = await fetchImpl(endpoint, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: key ? { authorization: `Bearer ${key}` } : {} });
      if (response.ok) slots = (await response.json()).total_slots;
    } catch { /* Unknown capacity does not establish a single-slot service. */ }
    if (slots !== 1) return slots === undefined ? queues.get(endpoint.href) ?? null : null;
    const identity = endpoint.href;
    if (!queues.has(identity)) queues.set(identity, createInferenceQueue({ isIdle }));
    return queues.get(identity);
  }
  const queue = { status: () => {
    const rows = [...queues.values()].map(value => value.status());
    return { active: rows.find(row => row.active === 'foreground')?.active ?? rows.find(row => row.active)?.active ?? null,
      foregroundPending: rows.reduce((sum, row) => sum + row.foregroundPending, 0),
      backgroundPending: rows.reduce((sum, row) => sum + row.backgroundPending, 0) + switchPending };
  }, close: () => { for (const value of queues.values()) value.close(); } };
  let switchPending = 0;
  async function acquireBackground(profile, selectedQueue, signal, onPreempt = null, refresh = null) {
    let waiting = false;
    try {
      while (true) {
        signal.throwIfAborted();
        if (refresh) profile = refresh();
        if (!backgroundReady || await backgroundReady(profile)) {
          const release = await selectedQueue?.acquire('background', signal, null, onPreempt);
          if (refresh) { try { profile = refresh(); } catch (error) { release?.(); throw error; } }
          // Foreground may have switched models while this request waited for idle.
          if (!backgroundReady || await backgroundReady(profile)) return release;
          release?.();
        }
        if (!waiting) { waiting = true; switchPending++; onEvent('model.switch_wait', { profileId: profile.id, priority: 'background' }); }
        await delay(1000, undefined, { signal });
      }
    } finally { if (waiting) switchPending--; }
  }
  const token = randomBytes(24).toString('hex');
  const memoryTokens = new Map();
  const memoryCredential = ownerId => {
    if (!memoryTokens.has(ownerId)) memoryTokens.set(ownerId, randomBytes(24).toString('hex'));
    return memoryTokens.get(ownerId);
  };
  const controllers = new Set();
  const suggestionLeases = new Set();
  const server = createServer(async (request, response) => {
    const controller = new AbortController(); controllers.add(controller);
    response.once('close', () => { controller.abort(); controllers.delete(controller); });
    let release;
    const started = Date.now(); let metadata = null;
    response.once('close', () => { if (metadata) onEvent('model.end', { ...metadata, durationMs: Date.now() - started, status: response.statusCode }); });
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const prefix = `/${token}`;
      if (!url.pathname.startsWith(`${prefix}/`)) { response.writeHead(404).end(); return; }
      const route = url.pathname.slice(prefix.length);
      if (route === '/progress' && request.method === 'POST') {
        let raw = ''; for await (const part of request) raw += part;
        const input = JSON.parse(raw), current = progress.get(input.sessionId);
        if (current && ['reasoning', 'answering', 'retrying'].includes(input.phase)) current.phase = input.phase;
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
        const requestedPriority = url.searchParams.get('priority');
        const priority = ['background', 'suggestion'].includes(requestedPriority) ? requestedPriority : 'foreground';
        const sessionId = url.searchParams.get('sessionId');
        const state = { phase: 'waiting', profileId: url.searchParams.get('profileId') };
        metadata = { profileId: state.profileId, sessionId, priority };
        onEvent('model.start', metadata);
        if (priority === 'foreground' && sessionId) {
          progress.set(sessionId, state);
          response.once('close', () => { if (progress.get(sessionId) === state) progress.delete(sessionId); });
        }
        const destinationProfile = profileFor(url.searchParams.get('profileId') ?? url.searchParams.get('baseUrl'));
        const destinationUrl = (destinationProfile?.baseUrl ?? url.searchParams.get('baseUrl'))?.replace(/\/+$/, '');
        if (priority === 'foreground') {
          for (const lease of suggestionLeases) if (lease.destinationUrl === destinationUrl) lease.preempt();
        }
        let preemptSuggestion = null;
        const readyForSuggestion = suggestionReady ?? backgroundReady;
        if (priority === 'suggestion') {
          preemptSuggestion = () => { controller.abort(suggestionBusy()); response.destroy(); };
          // Track the readiness probe as well as the granted socket so a new
          // foreground request cannot race model switching or the idle check.
          const lease = { destinationUrl, preempt: preemptSuggestion };
          suggestionLeases.add(lease);
          response.once('close', () => suggestionLeases.delete(lease));
          if (destinationProfile && readyForSuggestion && !await readyForSuggestion(destinationProfile, { signal: controller.signal })) throw suggestionBusy();
        }
        const selectedQueue = await queueFor({ profileId: url.searchParams.get('profileId'), baseUrl: url.searchParams.get('baseUrl') }, controller.signal);
        if (priority === 'suggestion') {
          controller.signal.throwIfAborted();
          if (selectedQueue) release = await selectedQueue.acquire('suggestion', controller.signal, null, preemptSuggestion);
          else if (isIdle && !await isIdle()) throw suggestionBusy();
          // No retry or model switch after an idle slot was acquired.
          if (destinationProfile && readyForSuggestion && !await readyForSuggestion(destinationProfile, { signal: controller.signal })) {
            release?.(); throw suggestionBusy();
          }
          controller.signal.throwIfAborted();
        } else if (priority === 'background' && destinationProfile) {
          release = await acquireBackground(destinationProfile, selectedQueue, controller.signal);
        } else release = await selectedQueue?.acquire(priority, controller.signal, ahead => {
          onEvent('model.queued', { ...metadata, ahead });
          state.phase = 'queued'; state.ahead = ahead;
        });
        if (!selectedQueue && priority !== 'suggestion' && !(priority === 'foreground' && sessionId)) { response.writeHead(204).end(); return; }
        state.phase = 'waiting'; delete state.ahead;
        if (release) response.once('close', release);
        response.writeHead(200, { 'content-type': 'text/plain' }); response.write('granted\n');
        return; // Socket lifetime owns the lease, including a crashed DSH child.
      }
      const match = /^\/inference\/([A-Za-z0-9._-]+)(?:\/scope\/([A-Za-z0-9._:-]+)\/([A-Za-z0-9._:-]+))?\/(?:v1\/)?(chat\/completions|models|props)$/.exec(route);
      if (!match) { response.writeHead(404).end(); return; }
      const dynamicLocal = match[1] === 'current-local' && !!match[2] && memoryProfileFor;
      let profile = dynamicLocal ? memoryProfileFor(match[2]) : profileFor(match[1]);
      let key = profile && credentialFor(profile);
      const expectedKey = dynamicLocal ? memoryTokens.get(match[2]) : key;
      if (!profile || !key || !expectedKey || request.headers.authorization !== `Bearer ${expectedKey}`) { response.writeHead(403).end(); return; }
      const operation = match[4];
      let selectedQueue;
      if (operation === 'chat/completions') {
        metadata = { profileId: profile.id, sessionId: match[3], priority: 'background' }; onEvent('model.start', metadata);
        onEvent('model.queued', metadata);
        // MemoWeft's HTTP timeout measures transport inactivity. Informational
        // responses keep queued work alive without changing the final status/body.
        selectedQueue = await queueFor({ profileId: profile.id });
      }
      let body, originalInput;
      if (request.method === 'POST') {
        const parts = []; for await (const part of request) parts.push(part);
        originalInput = JSON.parse(Buffer.concat(parts).toString('utf8'));
        body = JSON.stringify({ ...originalInput, model: canonicalProviderModelId(profile.baseUrl, profile.model) });
      }
      let endpoint = operation === 'props'
        ? new URL(profile.baseUrl.replace(/\/?v1\/?$/, '/props'))
        : openAICompatibleEndpoint(profile.baseUrl, operation);
      const refreshLocal = dynamicLocal ? () => {
        const next = memoryProfileFor(match[2]);
        // A different endpoint needs its own capacity lease. Core's local retry
        // re-enters this handler; never send local-only evidence to a cloud route.
        if (!next || next.baseUrl !== profile.baseUrl) throw new Error('MODEL_BACKGROUND_CHANGED');
        profile = next; key = credentialFor(profile);
        if (!key) throw new Error('MODEL_UNAVAILABLE');
        endpoint = openAICompatibleEndpoint(profile.baseUrl, operation);
        if (originalInput) body = JSON.stringify({ ...originalInput, model: canonicalProviderModelId(profile.baseUrl, profile.model) });
        return profile;
      } : null;
      if (operation === 'chat/completions' && !selectedQueue) {
        const heartbeat = setInterval(() => { if (!response.headersSent) response.writeProcessing(); }, heartbeatMs);
        try { release = await acquireBackground(profile, null, controller.signal, null, refreshLocal); }
        finally { clearInterval(heartbeat); }
        // Loading can temporarily hide /props. Recheck capacity after readiness.
        selectedQueue = await queueFor({ profileId: profile.id });
      }
      if (selectedQueue) {
        const heartbeat = setInterval(() => { if (!response.headersSent) response.writeProcessing(); }, heartbeatMs);
        try {
          const completed = await runPreemptibleFormation(selectedQueue, controller.signal, async signal => {
            const ticket = beginUsage ? await beginUsage({ profileId: profile.id,
              ownerId: match[2] ?? null, sessionId: match[3] === 'none' ? null : match[3] ?? null }) : null;
            let settled = false;
            try {
              let upstream = await fetchImpl(endpoint, { method: request.method, signal,
                headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body });
              if (ticket) upstream = await usageResponse(upstream, async usage => {
                settled = true; await finishUsage({ ...ticket, usage, source: 'openai' });
              });
              const bytes = await upstream.arrayBuffer();
              signal.throwIfAborted();
              return { status: upstream.status, contentType: upstream.headers.get('content-type'), bytes };
            } catch (error) {
              if (ticket && !settled) await finishUsage({ ...ticket, usage: null });
              throw error;
            }
          }, onPreempt => acquireBackground(profile, selectedQueue, controller.signal, onPreempt, refreshLocal));
          response.writeHead(completed.status, { 'content-type': completed.contentType ?? 'application/json',
            'x-modelswitcher-model': profile.model });
          response.end(Buffer.from(completed.bytes));
        } finally { clearInterval(heartbeat); }
        return;
      }
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
      const code = ['USAGE_LIMIT_REACHED', 'MODEL_SUGGESTION_BUSY'].includes(error?.code) ? error.code : 'MODEL_QUEUE_UNAVAILABLE';
      onEvent('model.failure', { ...metadata, code });
      if (!response.headersSent) { response.writeHead(code === 'USAGE_LIMIT_REACHED' ? 402 : code === 'MODEL_SUGGESTION_BUSY' ? 409 : 503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ code })); }
      else response.end();
    } finally {
      // A native lease remains open until its owner closes the response body.
      if (!request.url.includes('/lease?') || !response.headersSent || response.statusCode !== 200) release?.();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/${token}`;
  return { url, queue, memoryCredential,
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
            if (response.ok && (await response.json()).switching === true) { result.phase = 'loading';
              if (!state.loadingLogged) { state.loadingLogged = true; onEvent('model.loading', { profileId: profile.id, sessionId, priority: 'foreground' }); } }
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
