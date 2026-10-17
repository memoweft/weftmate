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
