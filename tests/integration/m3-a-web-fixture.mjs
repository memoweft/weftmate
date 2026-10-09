import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sealReplica } from '../../src/personal-offline/crypto.mjs';
const directory = resolve('tests/evidence/m3-a'); await mkdir(directory, { recursive: true });
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/personal-access-ui/tokens.css"><link rel="stylesheet" href="/src/personal-access-ui/offline.css"><script src="/src/personal-access-ui/format-vendor.js"></script><script src="/src/ui-core/offline.js"></script><script src="/src/personal-access-ui/components/offline.js"></script>'); return; }
  response.setHeader('content-type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
  response.end(await readFile(resolve('.' + request.url)));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const identity = { ownerId: 'owner-fixture', hostId: 'host-fixture', deviceId: 'device-fixture' };
let online = true;
try {
  await page.route('https://model.example/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '你喝咖啡时加**肉桂粉**。' } }] }) }));
  await page.exposeFunction('syntheticSync', body => {
    if (!online) throw Error('NETWORK');
    return sealReplica({ generation: 1, reset: body.generation !== 1, items: [{ id: 'c1', text: '用户喝咖啡加肉桂粉', sources: [{ id: 'e1' }] }],
      remove: [], hashes: {}, model: { baseUrl: 'https://model.example/v1', modelId: 'test', apiKey: 'synthetic' }, recent: [] }, body.publicJwk, identity);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async identity => {
    window.controller = WeftOfflineView.mount({ core: { cloudOfflineStatus: async () => ({ authorized: true, generation: 1 }) }, identity: async () => identity,
      host: (_path, body) => syntheticSync(body) });
    await window.controller.tick();
  }, identity);
  await page.getByRole('button', { name: '离线对话 · 已同步' }).waitFor(); online = false;
  await page.evaluate(() => controller.tick());
  await page.getByRole('textbox', { name: '离线消息' }).fill('我喝咖啡时加什么？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('你喝咖啡时加肉桂粉。', { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await page.locator('.offline-message strong').textContent(), '肉桂粉');
  await page.screenshot({ path: resolve(directory, 'synthetic-web-offline.png') });
  assert.equal(await page.locator('.offline-message').count(), 2); console.log('offline browser UI passed');
} catch (error) { await page.screenshot({ path: resolve(directory, 'synthetic-web-failure.png') }); console.log(await page.locator('body').innerText()); throw error; }
finally { await browser.close(); await new Promise(done => server.close(done)); }
