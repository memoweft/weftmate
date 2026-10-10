import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { MAIL_MARK_PATH } from './mail-templates.mjs';

const mailMark = readFileSync(new URL('../assets/weftmate-mark.png', import.meta.url));

export function createCloudServer({ database, schemaVersion, logger, identity }) {
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = performance.now();
    // Do not log raw paths/query strings: future auth URLs may contain codes.
    const route = request.url === '/healthz' ? '/healthz' : request.url === MAIL_MARK_PATH ? 'mail-mark' : 'unmatched';
    if (route === 'mail-mark') {
      const allowed = request.method === 'GET' || request.method === 'HEAD';
      response.writeHead(allowed ? 200 : 405, {
        'content-type': 'image/png',
        'content-length': allowed ? mailMark.length : 0,
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
        ...(allowed ? {} : { allow: 'GET, HEAD' }),
      });
      response.end(allowed && request.method === 'GET' ? mailMark : undefined);
      // This shared public brand asset carries no per-message identifier or access log.
      return;
    }
    if (identity && request.url.startsWith('/personal/v1/cloud/')) {
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('x-request-id', requestId);
      response.setHeader(
        'content-security-policy',
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      );
      response.once('finish', () =>
        logger.info('http.response', {
          requestId,
          route: 'cloud',
          status: response.statusCode,
          durationMs: Math.round(performance.now() - started),
        }),
      );
      try {
        if (await identity.handle(request, response)) return;
      } catch {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }));
        return;
      }
    }
    let status = 404;
    let body = { error: { code: 'NOT_FOUND' } };
    let headers = {};
    if (route === '/healthz') {
      if (request.method !== 'GET') {
        status = 405;
        headers = { allow: 'GET' };
        body = { error: { code: 'METHOD_NOT_ALLOWED' } };
      } else {
        try {
          database
            .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
            .get();
          status = 200;
          body = { status: 'ok', service: 'weftmate-cloud', schemaVersion };
        } catch {
          status = 503;
          body = { status: 'unavailable', service: 'weftmate-cloud' };
          logger.error('health.failed', { requestId, code: 'DATABASE_UNAVAILABLE' });
        }
      }
    }
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-request-id': requestId,
      ...headers,
    });
    response.end(JSON.stringify(body));
    logger.info('http.response', {
      requestId,
      route,
      status,
      durationMs: Math.round(performance.now() - started),
    });
  });
}
