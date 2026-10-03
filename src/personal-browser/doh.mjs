import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { isPublicAddress } from './network.mjs';

const DNS_HOST = 'cloudflare-dns.com';
const DNS_ADDRESS = '1.1.1.1';
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_CNAME_DEPTH = 8;
function fault(code) { return Object.assign(new Error(code), { code }); }
function dnsName(value) {
  if (typeof value !== 'string' || value.length > 253 || !/^[A-Za-z0-9.-]+\.?$/.test(value)) {
    throw fault('BROWSER_DNS_ERROR');
  }
  return value.replace(/\.$/, '').toLowerCase();
}

function addressesFromAnswer(body, hostname, type) {
  if (body?.Status !== 0 || body?.TC !== false || !Array.isArray(body.Question) ||
      body.Question.length !== 1 || body.Question[0]?.type !== type ||
      dnsName(body.Question[0]?.name) !== hostname ||
      (body.Answer !== undefined && (!Array.isArray(body.Answer) || body.Answer.length > 64))) {
    throw fault('BROWSER_DNS_ERROR');
  }
  const answers = body.Answer ?? [];
  const allowed = new Set([hostname]);
  for (let depth = 0; depth < MAX_CNAME_DEPTH; depth++) {
    let changed = false;
    for (const answer of answers) {
      if (answer?.type !== 5 || !allowed.has(dnsName(answer.name))) continue;
      const next = dnsName(answer.data);
      if (!allowed.has(next)) { allowed.add(next); changed = true; }
    }
    if (!changed) break;
  }
  const found = [];
  for (const answer of answers) {
    if (![1, 28].includes(answer?.type)) continue;
    if (!allowed.has(dnsName(answer.name))) throw fault('BROWSER_DNS_ERROR');
    const family = answer.type === 1 ? 4 : 6;
    if (typeof answer.data !== 'string' || net.isIP(answer.data) !== family ||
        !isPublicAddress(answer.data)) throw fault('BROWSER_TARGET_BLOCKED');
    if (answer.type === type) found.push({ address: answer.data, family });
  }
  return found;
}

function query(hostname, type, { signal, requestImpl, budget }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(fault('BROWSER_DNS_TIMEOUT'));
    const path = `/dns-query?name=${encodeURIComponent(hostname)}&type=${type === 1 ? 'A' : 'AAAA'}`;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };
    let req;
    const abort = () => req?.destroy(fault('BROWSER_DNS_TIMEOUT'));
    try {
      req = requestImpl({ protocol: 'https:', hostname: DNS_ADDRESS, port: 443,
        method: 'GET', path, servername: DNS_HOST, rejectUnauthorized: true,
        checkServerIdentity: (_name, certificate) => tls.checkServerIdentity(DNS_HOST, certificate),
        headers: { host: DNS_HOST, accept: 'application/dns-json' },
        agent: false, signal }, (response) => {
        if (response.statusCode !== 200 ||
            !/^application\/dns-json(?:\s*;|$)/i.test(response.headers['content-type'] ?? '')) {
          response.resume(); finish(fault('BROWSER_DNS_ERROR')); return;
        }
        const chunks = [];
        response.on('data', (chunk) => {
          budget.used += chunk.length;
          if (budget.used > MAX_RESPONSE_BYTES) {
            req.destroy(fault('BROWSER_DNS_ERROR'));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on('end', () => {
          if (settled) return;
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { finish(fault('BROWSER_DNS_ERROR')); return; }
          try { finish(null, addressesFromAnswer(body, hostname, type)); }
          catch (error) { finish(error); }
        });
        response.on('error', () => finish(fault('BROWSER_DNS_ERROR')));
      });
    } catch { finish(fault('BROWSER_DNS_ERROR')); return; }
    signal.addEventListener('abort', abort, { once: true });
    req.on('error', (error) => finish(error?.code === 'BROWSER_DNS_TIMEOUT'
      ? error : fault('BROWSER_DNS_ERROR')));
    req.end();
  });
}

/** Fixed public resolver for system VPN Fake-IP responses; never uses system DNS for its own peer. */
export async function resolveViaCloudflareDoh(hostname, { signal, requestImpl = https.request } = {}) {
  const name = dnsName(hostname);
  if (!name.includes('.')) throw fault('BROWSER_DNS_ERROR');
  const controller = new AbortController();
  const abortParent = () => controller.abort();
  if (signal?.aborted) throw fault('BROWSER_CANCELLED');
  signal?.addEventListener('abort', abortParent, { once: true });
  const timer = setTimeout(() => controller.abort(), 3_000);
  const budget = { used: 0 };
  try {
    const all = await Promise.all([1, 28].map((type) => query(name, type,
      { signal: controller.signal, requestImpl, budget })));
    const unique = [...new Map(all.flat().map((entry) => [`${entry.family}|${entry.address}`, entry])).values()];
    if (unique.length < 1 || unique.length > 32) throw fault('BROWSER_DNS_ERROR');
    if (signal?.aborted) throw fault('BROWSER_CANCELLED');
    return unique;
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal?.removeEventListener('abort', abortParent);
  }
}
