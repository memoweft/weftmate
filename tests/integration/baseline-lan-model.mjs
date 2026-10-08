// Test-only serial bridge. The private destination and credential never reach Electron.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function createLanBaselineBridge({ baseUrl, key, contextWindow, fetchImpl = fetch }) {
  const destination = new URL(baseUrl.replace(/\/+$/, '') + '/');
  const token = randomUUID();
  let tail = Promise.resolve(), active = 0, maxActive = 0, closed = false;
  const controllers = new Set(), requests = [];
  const server = createServer(async (request, response) => {
    const controller = new AbortController(); controllers.add(controller);
    response.once('close', () => controller.abort());
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    const record = { method: request.method, queuedAt: new Date().toISOString() };
    let heartbeat;
    try {
      if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return; }
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      // A long-task acceptance run deliberately uses a smaller configured
      // envelope than the server capacity, without changing the server itself.
      if (contextWindow && (path.endsWith('/props') || path.endsWith('/models'))) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(path.endsWith('/props') ? { n_ctx: contextWindow, total_slots: 1 }
          : { data: [{ id: 'local-quality', context_window: contextWindow }] }));
        return;
      }
      record.kind = path.endsWith('/chat/completions') ? 'inference' : 'metadata';
      requests.push(record);
      const parts = []; for await (const part of request) parts.push(part);
      const body = parts.length ? Buffer.concat(parts) : undefined;
      if (body && record.kind === 'inference') {
        const value = JSON.parse(body);
        if (value.model !== 'local-quality') throw new Error('LAN_BASELINE_MODEL_MISMATCH');
      }
      heartbeat = setInterval(() => { if (!response.headersSent && !response.destroyed) response.writeProcessing(); }, 15000);
      await previous;
      controller.signal.throwIfAborted();
      if (closed) throw new Error('LAN_BASELINE_CLOSED');
      active++; maxActive = Math.max(maxActive, active);
      record.startedAt = new Date().toISOString();
      const endpoint = path.endsWith('/props')
        ? new URL(destination.href.replace(/\/?v1\/$/, '/props'))
        : new URL(path.replace(/^\/v1\//, ''), destination);
      const upstream = await fetchImpl(endpoint, { method: request.method, body,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: controller.signal });
      record.status = upstream.status;
      clearInterval(heartbeat);
      if (!upstream.ok) {
        // Drain without forwarding private diagnostics; retain the slot until EOF.
        await upstream.arrayBuffer();
        response.writeHead(upstream.status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'LAN_MODEL_UPSTREAM_ERROR' } }));
      } else {
        response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
        else response.end();
      }
    } catch {
      record.cancelled = controller.signal.aborted;
      if (!response.headersSent) response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'LAN_MODEL_REQUEST_INCOMPLETE' } }));
    } finally {
      clearInterval(heartbeat);
      if (record.startedAt) active--;
      record.endedAt = new Date().toISOString();
      controllers.delete(controller);
      // Preserve FIFO even when a later queued client disconnects first.
      await previous;
      release();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  return { url, token, metrics: () => ({ maxActive, requests }),
    async warmup() {
      const start = Date.now();
      const response = await fetch(url + '/chat/completions', { method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'local-quality', messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 16, stream: false }),
        signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error('LAN_MODEL_WARMUP_FAILED');
      await response.json();
      return { model: 'lan/local-quality', durationMs: Date.now() - start, status: 'passed' };
    },
    async close() {
      closed = true;
      for (const controller of controllers) controller.abort();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await tail;
    },
  };
}
