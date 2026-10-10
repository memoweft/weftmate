import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { exposeUx7Desktop, mockUx7Requests } from './ux-7-scenes.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const out=resolve(import.meta.dirname,'../evidence/ux-7'),f=await startTimelineCandidate({historyCount:0,interactive:true,composer:true});await f.complete();
const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[];
try{for(const width of [390,360])for(const surface of ['mobile-web','android-bundle'])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:width===390?844:780},isMobile:true,hasTouch:true});page.setDefaultTimeout(15000);
 console.log('Gestures',surface,width,theme);if(surface==='mobile-web'){await exposeUx7Desktop(page);await page.goto(f.origin+'/personal/v1/ui');await localUiSession(page,f.credentials);await mockUx7Requests(page,undefined,{legacy:true});await page.reload();await page.waitForFunction(()=>globalThis.__ux7core?.state.account);await page.evaluate(id=>__ux7core.selectSession(id),f.sessionId);}
 else {await mockUx7Requests(page);await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted);await page.evaluate(async id=>{await selectSharedSession(id);closeDrawer()},f.sessionId);}
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);const field=page.locator('#message-text,#draft');
 await page.evaluate(()=>{const core=globalThis.__ux7core||uiCore;core.state.personalCapabilities={...core.state.personalCapabilities,nextSuggestions:1};core.state.personalization={...core.state.personalization,nextSuggestionsEnabled:true};core.syncNextSuggestions();});
 for(const gesture of ['gray-click','swipe']){await field.focus();await field.fill('');await field.fill('请把它');await field.evaluate(n=>n.setSelectionRange(n.value.length,n.value.length));await page.locator('.composer-completion:not([hidden])').waitFor();
  assert.equal(await page.locator('.composer-completion-hint').isVisible(),false);assert.equal(await page.locator('.composer-completion').getAttribute('aria-hidden'),'true');
  if(gesture==='gray-click')await page.locator('.composer-completion-text').click();else {const box=await field.boundingBox();await field.dispatchEvent('pointerdown',{pointerType:'touch',clientX:box.x+20,clientY:box.y+20});await field.dispatchEvent('pointerup',{pointerType:'touch',clientX:box.x+90,clientY:box.y+20});}
  assert.equal(await field.inputValue(),'请把它保存成文件');const screenshot=`${surface}-${width}-${theme}-completion-${gesture}.png`;await page.screenshot({path:join(out,screenshot)});checks.push({surface,width,theme,gesture,screenshot,accepted:true});}
 await page.close();}
 await writeFile(join(out,'mobile-gestures-checks.json'),JSON.stringify({synthetic:true,modelRequests:0,checks},null,2));console.log('UX-7 mobile completion gestures passed');
}finally{await browser.close();await f.close();await rm(f.root,{recursive:true,force:true});}
