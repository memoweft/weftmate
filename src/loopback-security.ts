/**
 * WeftMate loopback HTTP boundary.
 *
 * Host/Origin/Sec-Fetch-Site are defence-in-depth against browser attacks. The
 * per-process bearer token is the actual local-client credential: another local
 * process can forge HTTP headers, but it cannot guess this token.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, RequestListener, ServerResponse } from 'node:http';

export const LOOPBACK_HOST = '127.0.0.1';

export interface LoopbackPolicy {
  token: string;
  host: string;
  origin: string;
}

export type LoopbackDecision =
  | { allowed: true; isApi: boolean }
  | { allowed: false; isApi: boolean; status: 401 | 403; reason: 'host' | 'origin' | 'fetch-site' | 'token' };

type PolicyProvider = LoopbackPolicy | (() => LoopbackPolicy);

const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

/** A fresh credential for each process start. Never persist or log this value. */
export function createLoopbackToken(): string {
  return randomBytes(32).toString('base64url');
}

export function loopbackPolicy(port: number, token: string): LoopbackPolicy {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`invalid bound loopback port: ${port}`);
  }
  return {
    token,
    host: `${LOOPBACK_HOST}:${port}`,
    origin: `http://${LOOPBACK_HOST}:${port}`,
  };
}

/** Both the deployment kill-switch and the user's live opt-in must agree. */
export function observationIngestionAllowed(killSwitchEnabled: boolean, userEnabled: boolean): boolean {
  return killSwitchEnabled && userEnabled;
}

function oneHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isApiTarget(rawTarget: string | undefined, expectedOrigin: string): boolean {
  try {
    const pathname = new URL(rawTarget ?? '/', expectedOrigin).pathname;
    return pathname === '/api' || pathname.startsWith('/api/');
  } catch {
    // A malformed request target is not an API capability and will be handled by
    // the normal router after the mandatory Host check.
    return false;
  }
}

function tokenMatches(authorization: string | undefined, expected: string): boolean {
  if (!authorization) return false;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization);
  if (!match) return false;
  const actualBytes = Buffer.from(match[1], 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** Pure request decision used by both the HTTP wrapper and the test matrix. */
export function decideLoopbackRequest(
  rawTarget: string | undefined,
  headers: IncomingHttpHeaders,
  policy: LoopbackPolicy,
): LoopbackDecision {
  const isApi = isApiTarget(rawTarget, policy.origin);

  if (oneHeader(headers.host) !== policy.host) {
    return { allowed: false, isApi, status: 403, reason: 'host' };
  }

  // Static documents deliberately remain token-free so BrowserWindow can make
  // its first navigation. Every API path, including unknown ones, is protected.
  if (!isApi) return { allowed: true, isApi };

  const origin = oneHeader(headers.origin);
  if (headers.origin !== undefined && origin !== policy.origin) {
    return { allowed: false, isApi, status: 403, reason: 'origin' };
  }

  const fetchSite = oneHeader(headers['sec-fetch-site']);
  if (headers['sec-fetch-site'] !== undefined && fetchSite !== 'same-origin') {
    return { allowed: false, isApi, status: 403, reason: 'fetch-site' };
  }

  if (!tokenMatches(oneHeader(headers.authorization), policy.token)) {
    return { allowed: false, isApi, status: 401, reason: 'token' };
  }

  return { allowed: true, isApi };
}

/** Apply headers shared by HTML, JSON, images and rejection responses. */
export function applyBaseSecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) res.setHeader(name, value);
}

/**
 * Add a per-response nonce to every inline script and return its matching CSP.
 * Styles are still inline in the current single-file UI, so style-src keeps the
 * narrow unsafe-inline exception; script-src does not.
 */
export function secureHtmlDocument(source: string): { html: string; contentSecurityPolicy: string; nonce: string } {
  const nonce = randomBytes(18).toString('base64');
  const html = source.replace(/<script\b(?![^>]*\bnonce=)([^>]*)>/gi, `<script nonce="${nonce}"$1>`);
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
  return { html, contentSecurityPolicy, nonce };
}

/** Guard every request before the business router sees it. */
export function withLoopbackSecurity(policyProvider: PolicyProvider, next: RequestListener): RequestListener {
  return (req: IncomingMessage, res: ServerResponse): void => {
    applyBaseSecurityHeaders(res);
    const policy = typeof policyProvider === 'function' ? policyProvider() : policyProvider;
    const decision = decideLoopbackRequest(req.url, req.headers, policy);
    if (!decision.allowed) {
      res.writeHead(decision.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: decision.status === 401 ? 'unauthorized' : 'forbidden' }));
      return;
    }
    next(req, res);
  };
}
