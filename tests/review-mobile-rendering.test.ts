import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { renderingSample } from './helpers/rendering-sample.mjs';
import { prepareMobileRendering } from '../scripts/review-gallery/mobile-rendering.mjs';

test('queued bottom scroll cannot re-enable following between cancelling and moving to the diagram', async () => {
  const frames:Function[]=[], events=new Map<string,Function>();
  const box:any={scrollTop:1900,scrollHeight:2500,clientHeight:600,
    addEventListener(name:string,fn:Function){events.set(name,fn);},
    dispatchEvent(event:any){events.get(event.type)?.(event);return true;}};
  const content={addEventListener(){}}, button={hidden:true,textContent:'',setAttribute(){},addEventListener(){}};
  const context:any={document:{hidden:false},matchMedia:()=>({matches:true}),
    requestAnimationFrame:(fn:Function)=>{frames.push(fn);return fn;},cancelAnimationFrame(){} };
  vm.runInNewContext(await readFile(new URL('../src/personal-access-ui/conversation-scroll.js',import.meta.url),'utf8'),context);
  const scroll=context.WeftConversationScroll(box,content,button);
  scroll.latest();
  let queuedScroll=true, cancelled=false;
  const deliveries:any[]=[];
  const wheel=events.get('wheel')!;
  events.set('wheel',event=>{wheel(event);cancelled=true;});
  // Each Playwright operation is an asynchronous boundary. Deliver the already
  // queued bottom scroll at the first such boundary after upward-input handling.
  const step=async (work:Function=()=>{})=>{
    const result=work();
    if(queuedScroll&&cancelled){
      const before=scroll.pinned;
      box.dispatchEvent({type:'scroll'});queuedScroll=false;
      deliveries.push({before,after:scroll.pinned,top:box.scrollTop});
    }
    return result;
  };
  const heading={scrollIntoView(){box.scrollTop=900;},closest(){return box;}};
  const page:any={
    getByRole(){return {
      waitFor:()=>step(),
      scrollIntoViewIfNeeded:()=>step(()=>heading.scrollIntoView()),
      evaluate:(callback:Function)=>step(()=>{
        // Run the actual preparation callback in the page realm, with DOM
        // primitives supplied by this controlled-layout fixture.
        const realm=vm.createContext({heading,WheelEvent:class{type:string;deltaY:number;constructor(type:string,init:any){this.type=type;this.deltaY=init.deltaY;}}});
        return vm.runInContext(`(${callback.toString()})(heading)`,realm);
      }),
    };},
    locator(selector:string){
      if(selector==='#chat-scroll')return {dispatchEvent:(type:string,init:any)=>step(()=>box.dispatchEvent({type,...init}))};
      if(selector==='.render-mermaid')return {first:()=>({scrollIntoViewIfNeeded:()=>step(()=>{box.scrollTop=900;})})};
      assert.equal(selector,'.render-diagram img');
      return {waitFor:()=>step(()=>{
        // The pending content-change follow runs as image readiness is awaited.
        scroll.changed();while(frames.length)frames.shift()!();
      })};
    },
  };
  await prepareMobileRendering(page);
  const afterPreparation={pinned:scroll.pinned,top:box.scrollTop};
  // Later image/content growth and its scroll notification must remain held.
  box.scrollHeight+=200;box.dispatchEvent({type:'scroll'});
  scroll.changed();while(frames.length)frames.shift()!();
  assert.deepEqual({deliveries,afterPreparation,afterGrowth:{pinned:scroll.pinned,top:box.scrollTop}},
    {deliveries:[{before:false,after:false,top:900}],afterPreparation:{pinned:false,top:900},afterGrowth:{pinned:false,top:900}});
});

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
        await page.locator('#chat-scroll').evaluate(box => {
          const touch=(clientY:number)=>new Touch({identifier:0,target:box,clientY});
          box.dispatchEvent(new TouchEvent('touchstart',{touches:[touch(100)]}));
          box.dispatchEvent(new TouchEvent('touchmove',{touches:[touch(120)]}));
          // Synthetic events have no default scrolling action. Model the
          // gesture's actual movement before queued scroll events can arrive.
          box.scrollTop-=20;
        });
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
