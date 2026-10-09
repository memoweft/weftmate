import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

const evidence=resolve('tests/evidence/mem-2/mobile');mkdirSync(evidence,{recursive:true});
const fixture=await startTimelineCandidate({daily:true,inlineProgress:true,interactive:true,historyCount:0});
let browser;
try {
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const errors=[];
 for (const surface of ['phone-web','android-package']) {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  page.on('response',async r=>{if(r.url().endsWith('/bridge')&&/models.host|temporary|byRequest/.test(r.request().postData()||''))console.log('BRIDGE',r.request().postData(),await r.text());});
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE',e.message)});
  if(surface==='phone-web'){
   await page.goto(fixture.origin+'/personal/v1/ui');await localUiSession(page,fixture.credentials);
   await page.getByRole('button',{name:'切换会话侧栏',exact:true}).click();
   await page.getByRole('button',{name:'临时对话',exact:true}).click();console.log(surface, await page.locator('body').innerText());
   await page.getByText('临时对话 · 不会形成记忆，30 天后自动删除',{exact:true}).waitFor();
  } else {
   await page.goto(fixture.mobileUrl);await page.getByRole('button',{name:'打开导航',exact:true}).click();
   await page.getByRole('button',{name:'临时对话',exact:true}).click();console.log(surface, await page.locator('body').innerText());
   await page.getByText('临时对话 · 不会形成记忆，30 天后自动删除',{exact:true}).waitFor();
   assert.equal((await fixture.request('/sessions')).sessions.filter(s=>s.memoryMode==='off').length,1);
  }
  await page.waitForTimeout(600);
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:join(evidence,`${surface}-${theme}.png`)});}
  await page.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(join(evidence,'verification.json'),JSON.stringify({phoneWeb:true,androidPackage:true,nativeBridge:'synthetic transport to real isolated host',errors},null,2));
}catch(e){for(const p of browser?.contexts().flatMap(c=>c.pages())??[]){console.log('FAIL BODY',await p.locator('body').innerText());await p.screenshot({path:join(evidence,'failure.png')});}throw e;}finally{await browser?.close();await fixture.close();}
