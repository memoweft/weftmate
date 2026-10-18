import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:os';
import ACME from '@root/acme';
import acmeRequests from '@root/acme/utils.js';
import { setTimeout as delay } from 'node:timers/promises';
import { createCsr } from './csr.mjs';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { tlsSpki } from './tls.mjs';

export const ACME_PRODUCTION = 'https://acme-v02.api.letsencrypt.org/directory';
export const ACME_STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory';
const DAY = 86_400_000;
const diagnosticCodes = new Set([...Object.keys(constants.errno), 'E_ACME', 'E_ACME_CHALLENGE', 'E_ACME_UNKNOWN',
  'ACME_REQUEST_FAILED', 'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED', 'CSR_PATCH_INVALID', 'DNS_NOT_CONFIGURED', 'DNS_PROVIDER_ERROR', 'DNS_PROPAGATION_TIMEOUT', 'DNS_ZONE_MISMATCH',
  'CLOUD_UNAVAILABLE', 'CERTIFICATE_KEY_DOMAIN_MISMATCH', 'CERTIFICATE_INVALID_DATES']);
const acmeProblems = new Set(['accountDoesNotExist', 'alreadyRevoked', 'badCSR', 'badNonce', 'badPublicKey',
  'badRevocationReason', 'badSignatureAlgorithm', 'caa', 'compound', 'connection', 'dns', 'externalAccountRequired',
  'incorrectResponse', 'invalidContact', 'malformed', 'orderNotReady', 'rateLimited', 'rejectedIdentifier',
  'serverInternal', 'tls', 'unauthorized', 'unsupportedContact', 'unsupportedIdentifier', 'userActionRequired']);
const acmeStatuses = new Set(['pending', 'ready', 'processing', 'valid', 'invalid', 'deactivated', 'expired', 'revoked']);
function reportCertificateFailure(diagnostic, { stage, target, httpStatus, acmeProblem, acmeStatus }, error) {
  // Never forward an Error/body/URL from the network or library: even codes can
  // reflect credentials. Only these fixed fields and known enums leave here.
  const problem = typeof acmeProblem === 'string' ? acmeProblem.replace(/^urn:ietf:params:acme:error:/, '') : undefined;
  const fields = { code: 'CERTIFICATE_ISSUANCE_FAILED', stage, target,
    errorCode: diagnosticCodes.has(error?.code) ? error.code : undefined,
    causeCode: diagnosticCodes.has(error?.cause?.code) ? error.cause.code : undefined,
    errorName: ['Error', 'TypeError', 'SyntaxError', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : undefined,
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : undefined,
    acmeProblem: acmeProblems.has(problem) ? problem : undefined,
    acmeStatus: acmeStatuses.has(acmeStatus) ? acmeStatus : undefined };
  try { diagnostic?.(Object.assign(new Error('Certificate operation failed'), fields)); }
  catch { /* Diagnostics must not change issuance or the daily retry date. */ }
}

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
export async function issueHostCertificate({ directoryUrl, email, accountKey, privateJwk, domain, relayRequest, signal, fetcher = fetch, diagnostic }) {
  const pending = new Set(), orderUrls = new Map();
  const stages = new Map([[directoryUrl, 'directory']]), validChallenges = new Set();
  const reportedFailures = new WeakSet(), challengeFailures = new Map();
  let account, context = { stage: 'csr', target: 'local' };
  function markReported(failure) {
    if (failure !== null && (typeof failure === 'object' || typeof failure === 'function')) reportedFailures.add(failure);
  }
  function report(error, failureContext = context) {
    // ACME.js wraps an HTTP problem in a new Error, retaining this exact body
    // as _rawBody. Track failure identities, never a previous request's state:
    // the library may recover badNonce and then encounter a different failure.
    // Challenge errors lose _rawBody in ACME.js's transformError, retaining
    // only auth.url. Link that wrapper to the reported response of its attempt.
    const challengeFailure = challengeFailures.get(error?.auth?.url);
    if (reportedFailures.has(error) || reportedFailures.has(error?._rawBody) || reportedFailures.has(challengeFailure)) {
      markReported(error); return;
    }
    markReported(error);
    reportCertificateFailure(diagnostic, failureContext, error);
  }
  async function postAsGet(url, nonce) {
    if (nonce) acmeRequests._setNonce(client, nonce);
    const result = await acmeRequests._jwsRequest(client, { accountKey, url,
      protected: { kid: account.key.kid }, payload: Buffer.alloc(0) });
    // The internal helper already cached this nonce; the outer request must
    // not cache it a second time.
    delete result.headers['replay-nonce'];
    return result;
  }
  async function remove(value) {
    context = { stage: 'dns_cleanup', target: 'cloud_dns' };
    await relayRequest('/hosts/relay/dns/cleanup', { value }); pending.delete(value);
  }
  const client = ACME.create({ maintainerEmail: 'acme@example.com', packageAgent: 'weftmate/0.1.0',
    notify: () => {},
    // Cloud checks all authoritative TXT servers. Dummy-name dry runs cannot
    // pass the cloud contract; the CA still performs real DNS-01 validation.
    skipChallengeTest: true, skipDryRun: true,
    __request: async options => {
      // Keep response metadata and reporting state with this request: another
      // request can start while fetch/text or a signed POST-as-GET is pending.
      const requestContext = { stage: stages.get(options.url) ?? 'unknown', target: 'acme' };
      let requestReported = false;
      context = requestContext;
      // A retry is a new attempt, including retries of the same challenge.
      challengeFailures.delete(options.url);
      // ACME.js 3.1 adds already-valid challenges to its presentation list and
      // accepts them again. Strict servers reject that update. Read the known
      // valid challenge with the library's signed POST-as-GET instead (RFC8555).
      if (validChallenges.has(options.url) && JSON.parse(options.body).payload) {
        // The original signed update was never sent, so reuse its reserved
        // nonce when signing the read; do not consume another cached nonce.
        const protectedHeader = JSON.parse(Buffer.from(JSON.parse(options.body).protected, 'base64url'));
        return postAsGet(options.url, protectedHeader.nonce);
      }
      try {
        if (new URL(options.url).hostname === 'api.rootprojects.org') throw new Error('Optional maintainer registration disabled');
        const response = await fetcher(options.url, { method: options.method, headers: options.headers,
          body: options.body, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
        requestContext.httpStatus = response.status;
        const text = await response.text();
        let body = text;
        if (response.headers.get('content-type')?.includes('json')) body = text ? JSON.parse(text) : null;
        requestContext.acmeProblem = body?.type ?? body?.error?.type;
        requestContext.acmeStatus = body?.status;
        if (!response.ok) { report({ code: 'E_ACME' }, requestContext); requestReported = true; }
        if (!response.ok && body?.type) body = response.status === 400 ? { ...body, status: 400 }
          : { status: response.status, error: { type: body.type, detail: body.detail } };
        else if (!response.ok) throw Object.assign(new Error('ACME request failed'), { code: 'ACME_REQUEST_FAILED' });
        if (requestReported) {
          markReported(body);
          if (requestContext.stage === 'validation') challengeFailures.set(options.url, body);
        }
        const headers = Object.fromEntries(response.headers);
        if (requestContext.stage === 'directory') for (const [field, stage] of [['newNonce', 'nonce'], ['newAccount', 'account'], ['newOrder', 'order']]) {
          if (body?.[field]) stages.set(body[field], stage);
        }
        for (const url of body?.authorizations ?? []) stages.set(url, 'authorization');
        for (const challenge of body?.challenges ?? []) {
          stages.set(challenge.url, 'validation');
          if (body.status === 'valid' && challenge.status === 'valid') validChallenges.add(challenge.url);
        }
        if (body?.finalize) stages.set(body.finalize, 'finalize');
        if (body?.certificate) stages.set(body.certificate, 'download');
        if (body?.finalize && headers.location) stages.set(headers.location, 'order_poll');
        if (body?.finalize && headers.location) orderUrls.set(body.finalize, headers.location);
        // ACME.js 3.1 repeats finalize for processing orders. Strict RFC8555
        // servers (Pebble) reject that: poll the returned order URL with the
        // library's own signed POST-as-GET until ready, then return its result.
        if (options.url === body?.finalize && body.status === 'processing') {
          const url = orderUrls.get(body.finalize);
          if (!url) throw new Error('Missing ACME order URL');
          // The outer helper has not received/cached finalize's nonce yet.
          if (headers['replay-nonce']) acmeRequests._setNonce(client, headers['replay-nonce']);
          let polled = { body, headers };
          while (polled.body.status === 'processing') {
            await delay(Math.max(1, Number(polled.headers['retry-after']) || 1) * 1000, undefined, { signal });
            polled = await postAsGet(url);
          }
          return polled;
        }
        return { statusCode: response.status, headers, body };
      } catch (error) {
        if (requestReported) markReported(error);
        else report(error, requestContext);
        throw error;
      }
    },
  });
  try {
    const csr = await createCsr({ jwk: privateJwk, domains: [domain], encoding: 'pem' });
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
          context = { stage: 'dns_publish', target: 'cloud_dns' };
          await relayRequest('/hosts/relay/dns/present', { value: challenge.dnsAuthorization });
        },
        // We await cleanup below: ACME.js invokes remove without awaiting it.
        remove: async () => {},
      },
    } });
    return `${result.cert}\n${result.chain}\n`;
  } catch (error) {
    if (error.code === 'DNS_PROPAGATION_TIMEOUT') context = { stage: 'dns_propagation', target: 'cloud_dns' };
    report(error);
    throw error;
  } finally {
    // Includes values whose present failed after DNS write/propagation timeout.
    for (const value of pending) {
      try { await remove(value); } catch (error) { report(error); throw error; }
    }
  }
}

export async function createCertificateManager({ root, domain, identity, certFile,
  directoryUrl = ACME_PRODUCTION, email, onInstalled = async () => {}, now = Date.now,
  issue = issueHostCertificate, diagnostic }) {
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
      let stage = 'inspect', issuanceReported = false;
      try {
        await inspect();
        if (!certificateExpiresAt || Date.parse(certificateExpiresAt) - now() < 30 * DAY) {
          // Persist the retry date before external work, including across restart.
          await atomic(stateFile, JSON.stringify(state));
          stage = 'issuance';
          const certificate = await issue({ directoryUrl, email, domain, accountKey, ...tls,
            relayRequest: identity.relayRequest, signal: abort.signal,
            diagnostic: error => { issuanceReported = true; diagnostic?.(error); } });
          stage = 'validate_certificate';
          const info = certificateInfo(certificate, { domain, spki: tls.spki });
          const x509 = new X509Certificate(certificate);
          if (Date.parse(x509.validTo) <= Date.now() || Date.parse(x509.validFrom) > Date.now())
            throw Object.assign(new Error('CA returned invalid certificate dates'), { code: 'CERTIFICATE_INVALID_DATES' });
          if (closed) return;
          stage = 'install';
          await atomic(certFile, certificate);
          stage = 'reload';
          await onInstalled();
          certificateExpiresAt = info.certificateExpiresAt;
        }
        state.certificateErrorCode = null;
      } catch (error) {
        if (stage !== 'issuance' || !issuanceReported) reportCertificateFailure(diagnostic, { stage, target: 'local' }, error);
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
    async retry() { await running; state.nextCheckAt = 0; await check(); },
    start() { timer ??= setInterval(() => { void check().catch(() => {}); }, DAY); timer.unref(); },
    status: () => ({ certificateExpiresAt, certificateErrorCode: state.certificateErrorCode }),
    async close() { closed = true; clearInterval(timer); abort.abort(); await running; },
  };
}
