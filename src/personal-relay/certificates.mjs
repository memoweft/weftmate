import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import ACME from '@root/acme';
import acmeRequests from '@root/acme/utils.js';
import { setTimeout as delay } from 'node:timers/promises';
import CSR from '@root/csr';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { tlsSpki } from './tls.mjs';

export const ACME_PRODUCTION = 'https://acme-v02.api.letsencrypt.org/directory';
export const ACME_STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory';
const DAY = 86_400_000;

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function atomic(file, data) {
  const temporary = `${file}.next`;
  try {
    await writeFile(temporary, data, { mode: 0o600 });
    await ensurePrivateFile(temporary);
    await rename(temporary, file);
    await ensurePrivateFile(file);
  } finally { await rm(temporary, { force: true }); }
}
export function certificateInfo(certificate, { domain, spki }) {
  const x509 = new X509Certificate(certificate);
  if (tlsSpki(certificate) !== spki || !x509.checkHost(domain))
    throw Object.assign(new Error('Certificate changed content key/domain'), { code: 'CERTIFICATE_KEY_DOMAIN_MISMATCH' });
  return { certificateExpiresAt: new Date(x509.validTo).toISOString() };
}

// Mature RFC8555 client. Our fetch transport avoids its optional maintainer
// registration (which sends locale/contact to Root), and keeps TLS verification.
export async function issueHostCertificate({ directoryUrl, email, accountKey, privateJwk, domain, relayRequest, signal, fetcher = fetch }) {
  const pending = new Set(), orderUrls = new Map();
  let account;
  async function remove(value) {
    await relayRequest('/hosts/relay/dns/cleanup', { value }); pending.delete(value);
  }
  const client = ACME.create({ maintainerEmail: 'acme@example.com', packageAgent: 'weftmate/0.1.0',
    notify: () => {},
    // Cloud checks all authoritative TXT servers. Dummy-name dry runs cannot
    // pass the cloud contract; the CA still performs real DNS-01 validation.
    skipChallengeTest: true, skipDryRun: true,
    __request: async options => {
      if (new URL(options.url).hostname === 'api.rootprojects.org') throw new Error('Optional maintainer registration disabled');
      const response = await fetcher(options.url, { method: options.method, headers: options.headers,
        body: options.body, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
      const text = await response.text();
      let body = text;
      if (response.headers.get('content-type')?.includes('json')) body = text ? JSON.parse(text) : null;
      if (!response.ok && body?.type) body = response.status === 400 ? { ...body, status: 400 }
        : { status: response.status, error: { type: body.type, detail: body.detail } };
      else if (!response.ok) throw Object.assign(new Error('ACME request failed'), { code: 'ACME_REQUEST_FAILED' });
      const headers = Object.fromEntries(response.headers);
      if (body?.finalize && headers.location) orderUrls.set(body.finalize, headers.location);
      // ACME.js 3.1 repeats finalize for processing orders. Strict RFC8555
      // servers (Pebble) reject that: poll the returned order URL with the
      // library's own signed POST-as-GET until ready, then return its result.
      if (options.url === body?.finalize && body.status === 'processing') {
        const url = orderUrls.get(body.finalize);
        if (!url) throw new Error('Missing ACME order URL');
        let polled = { body, headers };
        while (polled.body.status === 'processing') {
          await delay(Math.max(1, Number(polled.headers['retry-after']) || 1) * 1000, undefined, { signal });
          polled = await acmeRequests._jwsRequest(client, { accountKey, url, protected: { kid: account.key.kid }, payload: Buffer.alloc(0) });
        }
        // The internal request helper already cached this nonce.
        delete polled.headers['replay-nonce'];
        return polled;
      }
      return { statusCode: response.status, headers, body };
    },
  });
  const csr = await CSR.csr({ jwk: privateJwk, domains: [domain], encoding: 'pem' });
  try {
    await client.init(directoryUrl);
    account = await client.accounts.create({ accountKey, subscriberEmail: email, agreeToTerms: true });
    const result = await client.certificates.create({ account, accountKey, csr, domains: [domain], challenges: {
      'dns-01': {
        propagationDelay: 1,
        zones: async () => [domain],
        get: async ({ challenge }) => ({ dnsAuthorization: challenge.dnsAuthorization }),
        set: async ({ challenge }) => {
          if (challenge.dnsHost !== `_acme-challenge.${domain}`) throw new Error('Unexpected ACME domain');
          pending.add(challenge.dnsAuthorization);
          await relayRequest('/hosts/relay/dns/present', { value: challenge.dnsAuthorization });
        },
        // We await cleanup below: ACME.js invokes remove without awaiting it.
        remove: async () => {},
      },
    } });
    return `${result.cert}\n${result.chain}\n`;
  } finally {
    // Includes values whose present failed after DNS write/propagation timeout.
    for (const value of pending) await remove(value);
  }
}

export async function createCertificateManager({ root, domain, identity, certFile,
  directoryUrl = ACME_PRODUCTION, email, onInstalled = async () => {}, now = Date.now,
  issue = issueHostCertificate }) {
  const dir = path.join(root, 'relay-tls'); await ensurePrivateDirectory(dir);
  certFile ??= path.join(dir, 'host-fullchain.pem');
  await ensurePrivateDirectory(path.dirname(certFile));
  // Each CA directory gets its own account; only the content key is fixed.
  const suffix = createHash('sha256').update(directoryUrl).digest('hex').slice(0, 16);
  const accountFile = path.join(dir, `acme-account-${suffix}.json`);
  let accountKey = await readJson(accountFile, null);
  if (!accountKey) {
    accountKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
    await atomic(accountFile, JSON.stringify(accountKey));
  }
  const stateFile = path.join(dir, `certificate-state-${suffix}.json`);
  let state = await readJson(stateFile, { nextCheckAt: 0, certificateErrorCode: null });
  let certificateExpiresAt = null, running, timer, closed = false;
  const abort = new AbortController();
  const tls = identity.tls();
  async function inspect() {
    try {
      certificateExpiresAt = certificateInfo(await readFile(certFile), { domain, spki: tls.spki }).certificateExpiresAt;
    } catch (error) {
      certificateExpiresAt = null;
      if (error.code !== 'ENOENT') throw error;
    }
  }
  async function check() {
    if (closed) return;
    if (running) return running;
    running = (async () => {
      if (now() < state.nextCheckAt) return;
      state.nextCheckAt = now() + DAY;
      try {
        await inspect();
        if (!certificateExpiresAt || Date.parse(certificateExpiresAt) - now() < 30 * DAY) {
          // Persist the retry date before external work, including across restart.
          await atomic(stateFile, JSON.stringify(state));
          const certificate = await issue({ directoryUrl, email, domain, accountKey, ...tls,
            relayRequest: identity.relayRequest, signal: abort.signal });
          const info = certificateInfo(certificate, { domain, spki: tls.spki });
          const x509 = new X509Certificate(certificate);
          if (Date.parse(x509.validTo) <= Date.now() || Date.parse(x509.validFrom) > Date.now())
            throw Object.assign(new Error('CA returned invalid certificate dates'), { code: 'CERTIFICATE_INVALID_DATES' });
          if (closed) return;
          await atomic(certFile, certificate);
          await onInstalled();
          certificateExpiresAt = info.certificateExpiresAt;
        }
        state.certificateErrorCode = null;
      } catch (error) {
        // No CA response bodies, challenge values or credentials in /status.
        state.certificateErrorCode = ['DNS_NOT_CONFIGURED', 'DNS_PROVIDER_ERROR', 'DNS_PROPAGATION_TIMEOUT',
          'DNS_ZONE_MISMATCH', 'CLOUD_UNAVAILABLE', 'CERTIFICATE_KEY_DOMAIN_MISMATCH', 'CERTIFICATE_INVALID_DATES']
          .includes(error.code) ? error.code : 'CERTIFICATE_ISSUANCE_FAILED';
      }
      if (!closed) await atomic(stateFile, JSON.stringify(state));
    })().finally(() => { running = null; });
    return running;
  }
  try { await inspect(); } catch { state.certificateErrorCode = 'CERTIFICATE_KEY_DOMAIN_MISMATCH'; }
  return { certFile, check, refresh: inspect,
    start() { timer ??= setInterval(() => { void check().catch(() => {}); }, DAY); timer.unref(); },
    status: () => ({ certificateExpiresAt, certificateErrorCode: state.certificateErrorCode }),
    async close() { closed = true; clearInterval(timer); abort.abort(); await running; },
  };
}
