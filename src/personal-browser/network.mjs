import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import { resolveViaCloudflareDoh } from './doh.mjs';

const MAX_URL_BYTES = 2048;
const MAX_NETWORK_BYTES = 32 * 1024 * 1024;
const MAX_SOCKETS = 16;
const BLOCKED_SUFFIX = /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/i;

function fault(code) { return Object.assign(new Error(code), { code }); }

function ipv4Bytes(value) {
  if (net.isIP(value) !== 4) return null;
  return value.split('.').map(Number);
}
function isFakeIp(value) {
  const bytes = ipv4Bytes(value);
  return bytes?.[0] === 198 && [18, 19].includes(bytes[1]);
}

export function isPublicAddress(value) {
  const v4 = ipv4Bytes(value);
  if (v4) {
    const [a, b, c] = v4;
    if (a === 0 || a === 10 || a === 127 || a >= 224 ||
        a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
        a === 172 && b >= 16 && b <= 31 ||
        a === 192 && (b === 0 && (c === 0 || c === 2) || b === 168 || b === 88 && c === 99) ||
        a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
        a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (net.isIP(value) !== 6) return false;
  const raw = value.toLowerCase();
  if (raw.includes('.')) return false; // IPv4-mapped or translated address.
  const parts = raw.split('::');
  if (parts.length > 2) return false;
  const first = parts[0].split(':').filter(Boolean);
  const last = (parts[1] ?? '').split(':').filter(Boolean);
  const middle = parts.length === 2 ? Array(8 - first.length - last.length).fill('0') : [];
  const groups = [...first, ...middle, ...last].map((part) => Number.parseInt(part, 16));
  if (groups.length !== 8 || groups.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return false;
  const head = groups[0];
  if (head < 0x2000 || head > 0x3fff) return false; // Only global unicast.
  if (head === 0x2001 && (groups[1] === 0x0db8 || groups[1] === 0 || groups[1] === 0x0010)) return false;
  if (head === 0x2002) return false; // 6to4 embeds an arbitrary IPv4 destination.
  return true;
}

export function canonicalPublicUrl(input, syntheticFixture = null) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_URL_BYTES ||
      /[\p{Cc}\p{Cf}]/u.test(input)) throw fault('BROWSER_URL_INVALID');
  let url;
  try { url = new URL(input); } catch { throw fault('BROWSER_URL_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
      url.hostname.endsWith('.') || url.hostname.startsWith('[') || net.isIP(url.hostname)) {
    throw fault('BROWSER_URL_INVALID');
  }
  const fixture = syntheticFixture && url.hostname.endsWith(syntheticFixture.hostnameSuffix) &&
    Number(url.port) === syntheticFixture.allowedPort && url.protocol === 'http:';
  if ((!url.hostname.includes('.') || BLOCKED_SUFFIX.test(url.hostname)) && !fixture) {
    throw fault('BROWSER_TARGET_BLOCKED');
  }
  if (!fixture && ![80, 443].includes(Number(url.port || (url.protocol === 'https:' ? 443 : 80)))) {
    throw fault('BROWSER_TARGET_BLOCKED');
  }
  url.hash = '';
  return url.toString();
}

export function createPinnedProxy({ resolver = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
  dohResolver = (hostname, options) => resolveViaCloudflareDoh(hostname, options),
  connect = (options) => net.connect(options), syntheticFixture = null, signal } = {}) {
  const sockets = new Set();
  const clients = new Set();
  const requests = new Set();
  let server;
  let bytes = 0;
  let violation = null;
  let selectedAddress = null;
  let closed = false;
  const observe = (length) => {
    bytes += length;
    if (bytes > MAX_NETWORK_BYTES) {
      violation = 'BROWSER_NETWORK_LIMIT';
      closeSockets();
      return false;
    }
    return true;
  };
  const closeSockets = () => {
    for (const socket of sockets) socket.destroy();
    for (const request of requests) request.destroy();
  };
  const resolveTarget = async (hostname, port) => {
    if (closed || signal?.aborted) throw fault('BROWSER_CANCELLED');
    const fixture = syntheticFixture && hostname.endsWith(syntheticFixture.hostnameSuffix) &&
      port === syntheticFixture.allowedPort;
    let timer;
    let records;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      records = await Promise.race([Promise.resolve().then(async () => {
        const system = await resolver(hostname);
        if (closed || signal?.aborted || controller.signal.aborted) throw fault('BROWSER_CANCELLED');
        if (!fixture && Array.isArray(system) && system.length > 0 &&
            system.every((row) => row?.family === 4 && isFakeIp(row.address))) {
          return dohResolver(hostname, { signal: controller.signal });
        }
        return system;
      }), new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(fault('BROWSER_DNS_TIMEOUT'));
      }, 3_000); })]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    if (closed || signal?.aborted) throw fault('BROWSER_CANCELLED');
    if (!Array.isArray(records) || records.length < 1 || records.length > 32 ||
        records.some((row) => !row || ![4, 6].includes(row.family) ||
          typeof row.address !== 'string' ||
          !(isPublicAddress(row.address) || fixture && row.address === '127.0.0.1' && row.family === 4))) {
      throw fault('BROWSER_TARGET_BLOCKED');
    }
    const selected = records.find((row) => row.family === 4) ?? records[0];
    selectedAddress = selected.address;
    return selected;
  };
  const blocked = (response, code = 'BROWSER_TARGET_BLOCKED') => {
    violation ??= code;
    if (!response.headersSent) response.writeHead(403, { 'content-type': 'text/plain', connection: 'close' });
    response.end('Blocked');
  };
  const handleHttp = async (incoming, outgoing) => {
    try {
      if (closed || sockets.size + requests.size >= MAX_SOCKETS || !['GET', 'HEAD'].includes(incoming.method)) {
        return blocked(outgoing, 'BROWSER_NETWORK_LIMIT');
      }
      const target = new URL(canonicalPublicUrl(incoming.url, syntheticFixture));
      if (target.protocol !== 'http:') return blocked(outgoing);
      const port = Number(target.port || 80);
      const resolved = await resolveTarget(target.hostname, port);
      const headers = { ...incoming.headers, host: target.host };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const upstream = http.request({ host: resolved.address, family: resolved.family,
        port, method: incoming.method, path: `${target.pathname}${target.search}`, headers,
        agent: false, timeout: 10_000 },
      (response) => {
        if (Number(response.headers['content-length']) > MAX_NETWORK_BYTES - bytes) {
          upstream.destroy(); return blocked(outgoing, 'BROWSER_NETWORK_LIMIT');
        }
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.on('data', (chunk) => { if (observe(chunk.length)) outgoing.write(chunk); });
        response.on('end', () => outgoing.end());
      });
      requests.add(upstream);
      upstream.on('close', () => requests.delete(upstream));
      upstream.on('error', () => {
        if (!outgoing.writableEnded) blocked(outgoing, 'BROWSER_NETWORK_ERROR'); });
      outgoing.on('close', () => upstream.destroy());
      upstream.end();
    } catch (error) {
      blocked(outgoing, error?.code ?? 'BROWSER_NETWORK_ERROR'); }
  };
  const handleConnect = async (request, client, head) => {
    sockets.add(client);
    client.once('close', () => sockets.delete(client));
    try {
      if (closed || sockets.size > MAX_SOCKETS) throw fault('BROWSER_NETWORK_LIMIT');
      const target = new URL(`https://${request.url}`);
      canonicalPublicUrl(target.toString(), syntheticFixture);
      const port = Number(target.port || 443);
      const resolved = await resolveTarget(target.hostname, port);
      const upstream = connect({ host: resolved.address, family: resolved.family, port });
      sockets.add(upstream);
      upstream.once('close', () => sockets.delete(upstream));
      upstream.setTimeout(10_000, () => upstream.destroy());
      upstream.once('connect', () => {
        if (closed || signal?.aborted) { upstream.destroy(); client.destroy(); return; }
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) { if (observe(head.length)) upstream.write(head); }
        client.on('data', (chunk) => { if (!observe(chunk.length)) client.destroy(); });
        upstream.on('data', (chunk) => { if (!observe(chunk.length)) upstream.destroy(); });
        client.pipe(upstream); upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    } catch (error) {
      violation ??= error?.code ?? 'BROWSER_NETWORK_ERROR';
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  };
  return {
    async start() {
      if (server) throw fault('BROWSER_UNAVAILABLE');
      server = http.createServer((request, response) => { void handleHttp(request, response); });
      server.on('connect', (request, client, head) => { void handleConnect(request, client, head); });
      server.on('connection', (client) => {
        if (closed || clients.size >= MAX_SOCKETS) {
          violation ??= 'BROWSER_NETWORK_LIMIT';
          client.destroy();
          return;
        }
        clients.add(client);
        client.once('close', () => clients.delete(client));
      });
      server.on('clientError', (_error, socket) => socket.destroy());
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      return { port: server.address().port };
    },
    get violation() { return violation; },
    get selectedAddress() { return selectedAddress; },
    get bytes() { return bytes; },
    async close() {
      closed = true;
      closeSockets();
      for (const client of clients) client.destroy();
      server?.closeAllConnections?.();
      if (server) await new Promise((resolve) => server.close(resolve));
    },
  };
}
