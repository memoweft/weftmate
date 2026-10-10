import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startMainChatCandidate} from '../../../tests/integration/main-chat-candidate.mjs';
import {localUiSession} from '../../../tests/helpers/local-ui-session.mjs';

test('remote phone composer remains inside the visual viewport with folders, suggestions, connection bar and keyboard',async()=>{
  const f=await startMainChatCandidate(10),browser=await chromium.launch({headless:true});
  const out=process.env.FX21_EVIDENCE,geometry=[];
  if(out)await mkdir(out,{recursive:true});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await page.goto(f.origin+'/personal/v1/ui/');await localUiSession(page,f.credentials,'Viewport',{mainChat:true});
    await page.locator('#message-text').waitFor({state:'visible'});
    for(const size of [{width:390,height:844},{width:360,height:780},{width:480,height:780}]) {
      await page.setViewportSize(size);
      for(const theme of ['light','dark'])for(const keyboard of [false,true])for(const extras of [false,true]) {
        await page.evaluate(({theme,extras})=>{
          document.documentElement.dataset.theme=theme;
          const composer=document.querySelector('.composer-area');
          let extra=document.querySelector('#viewport-fixture');
          if(extra)extra.remove();
          if(extras){extra=document.createElement('div');extra.id='viewport-fixture';extra.innerHTML='<div class="folder-choice"><button class="folder-chip">合成文件夹</button></div><div class="composer-top-slot"><div class="next-suggestions">下一步建议 · 整理项目记录</div></div><div class="connection-banner is-offline">电脑离线，正在重新连接</div>';composer.prepend(extra);}
        },{theme,extras});
        // Mobile keyboards resize visualViewport while retaining the layout viewport.
        await page.evaluate(keyboard=>{
          const vv=window.visualViewport;
          if(!window.viewportFixtureOriginal)window.viewportFixtureOriginal=vv.height;
          Object.defineProperty(vv,'height',{configurable:true,value:keyboard?window.innerHeight-300:window.innerHeight});
          vv.dispatchEvent(new Event('resize'));
        },keyboard);
        await page.waitForTimeout(100);
        const g=await page.evaluate(()=>({height:visualViewport.height,layoutHeight:innerHeight,pageHeight:document.documentElement.scrollHeight,send:document.querySelector('#send-message').getBoundingClientRect().toJSON(),composer:document.querySelector('.composer-area').getBoundingClientRect().toJSON(),shell:document.querySelector('.assistant-shell').getBoundingClientRect().toJSON()}));
        geometry.push({size,theme,keyboard,extras,...g});
        if(out){await writeFile(resolve(out,'phone-geometry.json'),JSON.stringify(geometry,null,2));await page.screenshot({path:resolve(out,`phone-${size.width}-${theme}-${keyboard?'keyboard':'full'}-${extras?'extras':'plain'}.png`)});}
        assert.ok(g.send.bottom<=g.height+1,JSON.stringify(geometry.at(-1)));
        assert.ok(g.pageHeight<=g.layoutHeight+1,JSON.stringify(geometry.at(-1)));
      }
    }
  } finally {await browser.close();await f.close();}
});

test('mobile bundle keeps the composer and bottom tabs inside safe areas and above the keyboard',async()=>{
  const f=await startMainChatCandidate(10,{logicalMobile:true}),browser=await chromium.launch({headless:true});
  const out=process.env.FX21_EVIDENCE,geometry=[];
  try {
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await page.route('**/bridge.js',r=>r.fulfill({contentType:'text/javascript',body:'// authenticated HTTP test'}));
    await page.route('**/personal/v1/**',async r=>{const u=new URL(r.request().url());const response=await r.fetch({url:f.origin+u.pathname+u.search,headers:{...r.request().headers(),origin:f.origin}});await r.fulfill({response});});
    await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted);
    const login=await page.request.post(f.origin+'/personal/v1/auth/login',{data:f.credentials,headers:{origin:f.origin}});assert.equal(login.status(),200);
    const identity=await login.json();
    await page.evaluate(async identity=>{state.loggedIn=true;state.owner=identity.account.ownerId;state.username=identity.account.username;state.deviceId=identity.device.id;state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();},identity);
    await page.locator('#draft').waitFor({state:'visible'});
    for(const size of [{width:390,height:844},{width:360,height:780}])for(const theme of ['light','dark'])for(const keyboard of [false,true]) {
      await page.setViewportSize(size);
      await page.evaluate(({theme,keyboard})=>{
        applyTheme(theme);document.documentElement.style.setProperty('--native-safe-top','24px');document.documentElement.style.setProperty('--native-safe-bottom','16px');
        if(keyboard){$('draft').focus();viewportRestHeight=innerHeight;}
        Object.defineProperty(visualViewport,'height',{configurable:true,value:keyboard?innerHeight-300:innerHeight});visualViewport.dispatchEvent(new Event('resize'));
        syncMobileKeyboard(keyboard);
      },{theme,keyboard});
      await page.waitForTimeout(100);
      const g=await page.evaluate(()=>({height:visualViewport.height,pageHeight:document.documentElement.scrollHeight,layoutHeight:innerHeight,send:document.querySelector('#send-button').getBoundingClientRect().toJSON(),tabs:document.querySelector('#mobile-bottom-tabs').getBoundingClientRect().toJSON()}));
      geometry.push({size,theme,keyboard,...g});
      if(out){await writeFile(resolve(out,'bundle-geometry.json'),JSON.stringify(geometry,null,2));await page.screenshot({path:resolve(out,`bundle-${size.width}-${theme}-${keyboard?'keyboard':'tabs'}.png`)});}
      assert.ok(g.send.bottom<=g.height+1,JSON.stringify(geometry.at(-1)));assert.ok(g.pageHeight<=g.layoutHeight+1);
      if(!keyboard)assert.ok(g.tabs.bottom<=g.height+1&&g.tabs.height>0,JSON.stringify(geometry.at(-1)));
    }
  }finally{await browser.close();await f.close();}
});
