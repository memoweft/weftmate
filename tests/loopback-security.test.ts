import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createLoopbackToken,
  decideLoopbackRequest,
  loopbackPolicy,
  observationIngestionAllowed,
  secureHtmlDocument,
  withLoopbackSecurity,
  type LoopbackPolicy,
} from '../src/loopback-security.ts';

interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const token = createLoopbackToken();
let policy: LoopbackPolicy;
let port = 0;
let handlerCalls = 0;

const server = createServer(withLoopbackSecurity(() => policy, (req, res) => {
  handlerCalls++;
  const url = new URL(req.url ?? '/', policy.origin);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const secured = secureHtmlDocument('<!doctype html><script>one()</script><script type="module">two()</script>');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': secured.contentSecurityPolicy,
    });
    res.end(secured.html);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('{"ok":true}');
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/observe') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('{"stored":1}');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end('{"error":"not found"}');
}));

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
  policy = loopbackPolicy(port, token);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

function call(
  path: string,
  options: { method?: string; headers?: Record<string, string>; setHost?: boolean } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const requestOptions: RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: options.headers,
      setHost: options.setHost,
    };
    const req = request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Origin: policy.origin,
    'Sec-Fetch-Site': 'same-origin',
    ...extra,
  };
}

describe('loopback 纯安全决策', () => {
  it('每次生成不可预测、只含 base64url 的 32-byte token', () => {
    const a = createLoopbackToken();
    const b = createLoopbackToken();
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a, b);
  });

  it('允许合法 Electron 同源 API 请求', () => {
    const decision = decideLoopbackRequest('/api/health', {
      host: policy.host,
      authorization: `Bearer ${token}`,
      origin: policy.origin,
      'sec-fetch-site': 'same-origin',
    }, policy);
    assert.deepEqual(decision, { allowed: true, isApi: true });
  });

  it('允许携 token、但没有浏览器 Origin/Sec-Fetch 的 collector', () => {
    const decision = decideLoopbackRequest('/api/observe', {
      host: policy.host,
      authorization: `Bearer ${token}`,
    }, policy);
    assert.deepEqual(decision, { allowed: true, isApi: true });
  });

  it('缺失或错误 token 都拒绝', () => {
    for (const authorization of [undefined, 'Bearer wrong', `Bearer ${token.slice(0, -1)}`]) {
      const decision = decideLoopbackRequest('/api/health', {
        host: policy.host,
        origin: policy.origin,
        ...(authorization ? { authorization } : {}),
      }, policy);
      assert.equal(decision.allowed, false);
      if (!decision.allowed) {
        assert.equal(decision.status, 401);
        assert.equal(decision.reason, 'token');
      }
    }
  });

  it('错误 Host 在静态和 API 路径都拒绝', () => {
    for (const rawTarget of ['/', '/api/health']) {
      const decision = decideLoopbackRequest(rawTarget, {
        host: `localhost:${port}`,
        authorization: `Bearer ${token}`,
        origin: policy.origin,
      }, policy);
      assert.equal(decision.allowed, false);
      if (!decision.allowed) assert.deepEqual([decision.status, decision.reason], [403, 'host']);
    }
    const missing = decideLoopbackRequest('/api/health', {
      authorization: `Bearer ${token}`,
      origin: policy.origin,
    }, policy);
    assert.equal(missing.allowed, false);
    if (!missing.allowed) assert.deepEqual([missing.status, missing.reason], [403, 'host']);
  });

  it('恶意、null 与空 Origin 都拒绝', () => {
    for (const origin of ['https://evil.example', 'null', '']) {
      const decision = decideLoopbackRequest('/api/health', {
        host: policy.host,
        authorization: `Bearer ${token}`,
        origin,
      }, policy);
      assert.equal(decision.allowed, false);
      if (!decision.allowed) assert.deepEqual([decision.status, decision.reason], [403, 'origin']);
    }
  });

  it('Sec-Fetch-Site 存在时只允许 same-origin', () => {
    for (const fetchSite of ['cross-site', 'same-site', 'none', '']) {
      const decision = decideLoopbackRequest('/api/health', {
        host: policy.host,
        authorization: `Bearer ${token}`,
        origin: policy.origin,
        'sec-fetch-site': fetchSite,
      }, policy);
      assert.equal(decision.allowed, false);
      if (!decision.allowed) assert.deepEqual([decision.status, decision.reason], [403, 'fetch-site']);
    }
  });

  it('感知摄入必须同时满足部署开关与用户 opt-in', () => {
    assert.equal(observationIngestionAllowed(true, true), true);
    assert.equal(observationIngestionAllowed(true, false), false);
    assert.equal(observationIngestionAllowed(false, true), false);
    assert.equal(observationIngestionAllowed(false, false), false);
  });
});

describe('loopback HTTP guard', () => {
  it('合法同源 health 与无 Origin collector 都可进入业务 handler', async () => {
    const beforeCalls = handlerCalls;
    const health = await call('/api/health', { headers: apiHeaders() });
    const observe = await call('/api/observe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(health.status, 200);
    assert.equal(observe.status, 200);
    assert.equal(handlerCalls, beforeCalls + 2);
  });

  it('缺 token、错 token、恶意 Origin 与 cross-site 均在业务 handler 前拒绝', async () => {
    const beforeCalls = handlerCalls;
    const missing = await call('/api/health', { headers: { Origin: policy.origin } });
    const wrong = await call('/api/health', { headers: { Authorization: 'Bearer wrong', Origin: policy.origin } });
    const evil = await call('/api/health', { headers: apiHeaders({ Origin: 'https://evil.example' }) });
    const crossSite = await call('/api/health', { headers: apiHeaders({ 'Sec-Fetch-Site': 'cross-site' }) });
    assert.deepEqual([missing.status, wrong.status, evil.status, crossSite.status], [401, 401, 403, 403]);
    assert.equal(handlerCalls, beforeCalls);
  });

  it('错误 Host 拒绝，且不进入业务 handler', async () => {
    const beforeCalls = handlerCalls;
    const wrong = await call('/', { headers: { Host: `localhost:${port}` } });
    assert.equal(wrong.status, 403);
    assert.equal(handlerCalls, beforeCalls);
  });

  it('未授权未知 API 先返回 401；授权后才返回业务 404', async () => {
    const beforeCalls = handlerCalls;
    const unauthorized = await call('/api/not-real');
    assert.equal(unauthorized.status, 401);
    assert.equal(handlerCalls, beforeCalls);

    const authorized = await call('/api/not-real', { headers: apiHeaders() });
    assert.equal(authorized.status, 404);
    assert.equal(handlerCalls, beforeCalls + 1);
  });

  it('静态首页无需 token，但要求正确 Host，并带 nonce CSP', async () => {
    const home = await call('/');
    const index = await call('/index.html');
    assert.equal(home.status, 200);
    assert.equal(index.status, 200);

    const nonce = /<script nonce="([^"]+)"/.exec(home.body)?.[1];
    assert.ok(nonce);
    assert.equal(home.body.split(`nonce="${nonce}"`).length - 1, 2);
    const csp = String(home.headers['content-security-policy'] ?? '');
    assert.match(csp, new RegExp(`script-src 'nonce-${nonce.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    const scriptDirective = csp.split(';').find((part) => part.trim().startsWith('script-src')) ?? '';
    assert.doesNotMatch(scriptDirective, /unsafe-inline/);
  });

  it('成功与拒绝响应都有统一安全头，且没有启用 CORS', async () => {
    const responses = [
      await call('/'),
      await call('/api/health', { headers: apiHeaders() }),
      await call('/api/health'),
    ];
    for (const response of responses) {
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.headers['x-frame-options'], 'DENY');
      assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    }
  });
});
