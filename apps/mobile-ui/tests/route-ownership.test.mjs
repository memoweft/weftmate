import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { observedRoutes } from './observed-routes.mjs';

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

test('route teardown stops admission and completes while slower-than-interval polling continues', async t => {
  const entered = gate();
  let received = 0, timer;
  const server = createServer((req, res) => {
    if (req.url === '/') return res.end('<title>continuous polling</title>');
    if (++received === 3) entered.release();
    setTimeout(() => res.end('synthetic response'), 250);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(), routes = observedRoutes(page);
  let closing;
  try {
    await page.goto(origin);
    await routes.route('**/poll', 'poll', async route => {
      const response = await route.fetch();
      await route.fulfill({ response });
    });
    await page.evaluate(() => {
      window.pollTimer = setInterval(() => { fetch('/poll').catch(() => {}); }, 50);
    });
    await entered.promise;
    closing = routes.close({ timeoutMs: 800 });
    const result = await Promise.race([
      closing.then(() => 'closed'),
      new Promise(resolve => { timer = setTimeout(() => resolve('over limit'), 1800); }),
    ]);
    const teardown = routes.events.find(row => row.phase === 'teardown.start');
    const startedAfter = routes.events.filter(row => row.phase === 'handler.start' && row.seq > teardown.seq).length;
    t.diagnostic(JSON.stringify({ result, startedAfter, received,
      started: routes.events.filter(row => row.phase === 'handler.start').length,
      done: routes.events.filter(row => row.phase === 'handler.done').length }));
    assert.equal(result, 'closed', 'continuous slow polling must not keep teardown draining forever');
    assert.equal(startedAfter, 0, 'new requests must not enter our business handler after teardown starts');
    assert.ok(routes.events.some(row => row.phase === 'intake.rejected'));
    assert.ok(routes.events.some(row => row.phase === 'unroute.done'));
  } finally {
    clearTimeout(timer);
    try { await page.evaluate(() => clearInterval(window.pollTimer)); }
    finally {
      try { await closing; }
      finally {
        await browser.close(); server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    }
  }
});

test('route teardown fails at its total deadline and still removes routes and closes the browser', async () => {
  const entered = gate(), stalled = gate();
  const server = createServer((req, res) => res.end('<title>bounded teardown</title>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(), routes = observedRoutes(page);
  let pageClosed = false;
  page.on('close', () => { pageClosed = true; });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    await routes.route('**/stalled', 'stalled', async () => { entered.release(); await stalled.promise; });
    await page.evaluate(() => { window.stalledFetch = fetch('/stalled').then(r => r.text()); });
    await entered.promise;
    await assert.rejects(routes.close({ timeoutMs: 100 }), error => {
      assert.equal(error.code, 'ROUTE_TEARDOWN_TIMEOUT');
      assert.match(error.message, /100ms/);
      return true;
    });
    assert.ok(routes.events.some(row => row.phase === 'teardown.timeout'));
    assert.ok(routes.events.some(row => row.phase === 'cleanup.unroute.done'));
    assert.equal(routes.events.some(row => row.phase === 'handlers.drained'), false);
    // Removal lets this request reach HTTP without re-entering the stalled handler.
    assert.match(await page.evaluate(() => fetch('/stalled').then(r => r.text())), /bounded teardown/);
    assert.equal(routes.events.filter(row => row.phase === 'handler.start').length, 1);
  } finally {
    try { await browser.close(); }
    finally { stalled.release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  assert.equal(pageClosed, true);
  assert.equal(browser.isConnected(), false);
});

test('route teardown preserves a slow proxy while a second handler finishes', async t => {
  const slow = gate(), fast = gate(), both = gate();
  let received = 0, directSlow = 0;
  const server = createServer(async (req, res) => {
    if (req.url === '/') return res.end('<title>route ownership</title>');
    if (req.url === '/slow' && !req.headers['x-synthetic-proxy']) directSlow++;
    if (req.headers['x-synthetic-proxy'] && ++received === 2) both.release();
    await (req.url === '/slow' ? slow : fast).promise;
    res.end(req.url);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(), routes = observedRoutes(page);
  try {
    await page.goto(origin);
    await routes.route(/\/(?:slow|fast)$/, 'proxy', async route => {
      const response = await route.fetch({ headers: { ...route.request().headers(), 'x-synthetic-proxy': '1' } });
      await route.fulfill({ response });
    });
    const responses = page.evaluate(() => Promise.all(['/slow', '/fast'].map(path => fetch(path).then(r => r.text()))));
    await both.promise;
    const fastResponse = page.waitForResponse(origin + '/fast');
    const closing = routes.close();
    fast.release();
    await fastResponse;
    // Finish client microtasks, then flush the protocol command queue. No timer
    // decides when the slow HTTP response is delivered.
    await new Promise(resolve => setImmediate(resolve));
    await page.title();
    slow.release();
    await closing;
    assert.deepEqual(await responses, ['/slow', '/fast']);
    assert.equal(directSlow, 0, 'teardown must not continue a route still owned by the proxy');
    assert.equal(routes.events.filter(row => row.phase === 'fulfill.done').length, 2);
    assert.equal(routes.events.some(row => row.phase.endsWith('.error')), false);
    const unroute = routes.events.find(row => row.phase === 'unroute.start').seq;
    assert.ok(routes.events.filter(row => row.phase === 'handler.done').every(row => row.seq < unroute));
  } finally {
    slow.release(); fast.release();
    t.diagnostic('route lifecycle=' + JSON.stringify(routes.events));
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
