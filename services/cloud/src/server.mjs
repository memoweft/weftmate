import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export function createCloudServer({ database, schemaVersion, logger }) {
  return createServer((request, response) => {
    const requestId = randomUUID();
    const started = performance.now();
    // Do not log raw paths/query strings: future auth URLs may contain codes.
    const route = request.url === '/healthz' ? '/healthz' : 'unmatched';
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
          database.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
          status = 200;
          body = { status: 'ok', service: 'weftmate-cloud', schemaVersion };
        } catch {
          status = 503;
          body = { status: 'unavailable', service: 'weftmate-cloud' };
          logger.error('health.failed', { requestId, code: 'DATABASE_UNAVAILABLE' });
        }
      }
    }
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId, ...headers });
    response.end(JSON.stringify(body));
    logger.info('http.response', { requestId, route, status, durationMs: Math.round(performance.now() - started) });
  });
}
