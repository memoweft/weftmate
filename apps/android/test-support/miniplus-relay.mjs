/** Opt-in, loopback-only emulator bridge to the already-authorized local MiniPlus catalog. */
import { createServer } from 'node:http';
import { once } from 'node:events';

const enabled = process.argv.slice(2).length === 1 && process.argv[2] === '--enable-real-model-relay';
const key = process.env.MODEL_SWITCH_UNIFIED_KEY;
if (!enabled || typeof key !== 'string' || key.length < 8) {
  process.stderr.write('relay refused: explicit enable flag and process credential required\n');
  process.exit(2);
}

const HOST = '127.0.0.1';
const PORT = 18189;
const MODEL = 'occamy-miniplus-v21';
const UPSTREAM = 'http://127.0.0.1:8081/v1/chat/completions';
const MAX_REQUEST = 256 * 1024;
const MAX_REPLY = 8 * 1024 * 1024;
const active = new Set();

function json(response, status, value) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  const host = request.headers.host;
  if (host !== `${HOST}:${PORT}` && host !== `localhost:${PORT}`) return json(response, 403, { error: 'host_refused' });
  if (request.method === 'GET' && request.url === '/health') {
    return json(response, 200, { ready: true, model: MODEL });
  }
  if (request.method === 'GET' && request.url === '/v1/models') {
    try {
      const upstream = await fetch('http://127.0.0.1:8081/v1/models', {
        headers: { authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      if (!upstream.ok) return json(response, 502, { error: 'catalog_unavailable' });
      const catalog = await upstream.json();
      const match = Array.isArray(catalog?.data) ? catalog.data.find((item) => item?.id === MODEL) : null;
      if (!match) return json(response, 503, { error: 'model_not_listed' });
      return json(response, 200, { data: [{ id: MODEL, display_name: match.display_name ?? match.name ?? MODEL }] });
    } catch { return json(response, 503, { error: 'catalog_unavailable' }); }
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    return json(response, 404, { error: 'not_found' });
  }
  const abort = new AbortController();
  active.add(abort);
  response.on('close', () => { if (!response.writableEnded) abort.abort(); });
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_REQUEST) return json(response, 413, { error: 'request_too_large' });
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return json(response, 400, { error: 'invalid_json' }); }
    const names = Array.isArray(body?.tools) ? body.tools.map((item) => item?.function?.name) : [];
    if (body?.model !== MODEL || typeof body.stream !== 'boolean' || !Array.isArray(body?.messages) ||
        names.some((name) => !['list_launchable_apps', 'open_app', 'open_settings'].includes(name))) {
      return json(response, 400, { error: 'unsupported_request' });
    }
    const timer = setTimeout(() => abort.abort(), 15 * 60 * 1000);
    try {
      const upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body), signal: abort.signal, redirect: 'error',
      });
      if (!upstream.ok) return json(response, 502, { error: 'model_unavailable', upstreamStatus: upstream.status });
      const contentLength = Number(upstream.headers.get('content-length') ?? 0);
      if (contentLength > MAX_REPLY) return json(response, 502, { error: 'reply_too_large' });
      const reader = upstream.body?.getReader();
      if (!reader) return json(response, 502, { error: 'empty_reply' });
      const streaming = body.stream === true;
      if (streaming && !upstream.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
        return json(response, 502, { error: 'stream_unavailable' });
      }
      if (streaming) response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store', connection: 'keep-alive' });
      const reply = [];
      let total = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_REPLY) {
          abort.abort();
          if (streaming) response.destroy(); else json(response, 502, { error: 'reply_too_large' });
          return;
        }
        if (streaming) {
          if (!response.write(Buffer.from(part.value))) await once(response, 'drain');
        } else reply.push(Buffer.from(part.value));
      }
      if (streaming) { if (!response.destroyed) response.end(); }
      else if (!response.destroyed) {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(Buffer.concat(reply));
      }
    } finally { clearTimeout(timer); }
  } catch {
    if (response.headersSent) response.destroy();
    else json(response, 502, { error: abort.signal.aborted ? 'request_cancelled' : 'model_unavailable' });
  } finally { active.delete(abort); }
});

server.listen(PORT, HOST, () => process.stdout.write(`relay ready origin=http://${HOST}:${PORT} model=${MODEL}\n`));
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (!chunk.split(/\r?\n/).some((line) => line.trim() === 'q')) return;
  for (const controller of active) controller.abort();
  server.close(() => process.exit(0));
});
