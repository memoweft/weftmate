import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { renderingSample } from './helpers/rendering-sample.mjs';
import { prepareMobileRendering } from '../scripts/review-gallery/mobile-rendering.mjs';

test('mobile gallery preparation holds the diagram against a later follow-to-bottom', async t => {
  const root = resolve('.');
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname.replace('/src/render-vendor/', '/src/personal-access-ui/render-vendor/');
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) return res.writeHead(404).end();
    try {
      res.setHeader('content-type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css'} as Record<string,string>)[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const browser = await chromium.launch({headless:true});
  t.after(() => browser.close());
  for (const theme of ['light', 'dark']) for (const navigation of ['gallery', 'touch-revisit']) await t.test(`${theme} / ${navigation}`, async () => {
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    try {
      await page.goto(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/tests/helpers/rendering.html`);
      await page.addScriptTag({url:'/src/personal-access-ui/conversation-scroll.js'});
      await page.evaluate(theme => { document.documentElement.dataset.theme=theme; }, theme);
      await page.evaluate(sample => {
        // Use the production renderer and scroll controller, with a bounded
        // conversation viewport. No fake intersection entries or render library.
        document.body.innerHTML='<div id="chat-scroll" style="height:600px;overflow:auto"><div id="chat-content"></div></div><button id="jump-latest"></button>';
        const box=document.getElementById('chat-scroll')!, content=document.getElementById('chat-content')!;
        content.append((globalThis as any).WeftContent.create(sample));
        (globalThis as any).WeftReplyMotion={reduced:true};
        (globalThis as any).galleryScroll=(globalThis as any).WeftConversationScroll(box,content,document.getElementById('jump-latest'));
        (globalThis as any).galleryScroll.latest();
        // Deliver the gallery's heading jump and the pending follow in one
        // task, before native IntersectionObserver samples the new viewport.
        [...content.querySelectorAll('h2')].find(n=>n.textContent==='公式与图表')!.scrollIntoView({block:'center'});
        (globalThis as any).galleryScroll.follow();
      }, renderingSample);
      await page.locator('.diagram-failed').waitFor();
      const snapshot = () => page.evaluate(() => {
        const block=document.querySelector('.render-mermaid')!, box=document.getElementById('chat-scroll')!;
        const rect=block.getBoundingClientRect(), clip=box.getBoundingClientRect();
        return {status:!!block.querySelector('[role="status"]'),images:block.querySelectorAll('img').length,
          intersects:rect.bottom>clip.top&&rect.top<clip.bottom,above:rect.bottom<clip.top};
      });
      assert.deepEqual(await snapshot(),{status:true,images:0,intersects:false,above:true},'deterministic original failure: valid block above viewport, invalid block rendered');
      if (navigation === 'gallery') await prepareMobileRendering(page);
      else {
        // Normal upward touch intent cancels following, then revisiting the
        // previously skipped block must trigger the native observer and paint.
        await page.locator('#chat-scroll').dispatchEvent('touchstart', {touches:[{identifier:0,clientY:100}]});
        await page.locator('#chat-scroll').dispatchEvent('touchmove', {touches:[{identifier:0,clientY:120}]});
        await page.locator('.render-mermaid').first().scrollIntoViewIfNeeded();
        await page.locator('.render-diagram img').waitFor();
      }
      // A delayed content load/resize takes the same follow path. Preparation
      // must have left automatic bottom following, just as an upward gesture does.
      await page.evaluate(() => (globalThis as any).galleryScroll.follow());
      assert.equal((await snapshot()).intersects,true,'prepared valid diagram must stay in the viewport after a pending follow');
      await page.waitForFunction(() => {
        const image=document.querySelector<HTMLImageElement>('.render-mermaid img');
        return image?.complete && image.naturalWidth>0;
      });
      assert.equal(await page.locator('.diagram-failed').count(),1,'the invalid example still falls back');
    } finally { await page.close(); }
  });
});
