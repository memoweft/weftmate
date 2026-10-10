// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {exposeUx7Desktop,mockUx7Requests,prepareUx7Suggestions} from './ux-7-scenes.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-7'),f=await startTimelineCandidate({historyCount:0,interactive:true,composer:true});await f.complete();
const profile=await mkdtemp(join(tmpdir(),'weftmate-ux7-extra-')),env={...process.env};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||k==='ELECTRON_RUN_AS_NODE')delete env[k];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let app,browser;const checks=[];let requests=0;
function contrast(foreground,background){const parse=value=>value.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});const light=value=>parse(value).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);const a=light(foreground),b=light(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});const desktop=await app.firstWindow();await exposeUx7Desktop(desktop);await localUiSession(desktop,f.credentials);await mockUx7Requests(desktop,undefined,{legacy:true});
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const surface of ['electron','android-bundle'])for(const theme of ['light','dark']){
 const p=surface==='electron'?desktop:await browser.newPage({viewport:{width:360,height:780},isMobile:true,hasTouch:true});p.setDefaultTimeout(15000);p.on('request',r=>{if(r.method()==='POST'&&(r.url().includes('/suggestions')||r.url().endsWith('/bridge')&&r.postData()?.includes('/suggestions')))requests++;});
 if(surface==='electron'){await p.reload();await p.waitForFunction(()=>globalThis.__ux7core?.state.account);await p.evaluate(id=>__ux7core.selectSession(id),f.sessionId);}else {await mockUx7Requests(p);await p.goto(f.mobileUrl);await p.waitForFunction(()=>state.booted);await p.evaluate(async id=>{await selectSharedSession(id);closeDrawer()},f.sessionId);}
 await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await prepareUx7Suggestions(p);const field=p.locator('#message-text,#draft'),bar=p.locator('#next-suggestions');
 const metrics=await p.evaluate(()=>{const chip=document.querySelector('.next-suggestion-chip'),field=document.querySelector('#message-text,#draft'),slot=document.querySelector('#composer-above-slot'),ghost=document.querySelector('.composer-completion'),card=field.closest('.message-form,.composer-card'),s=getComputedStyle(field);return{chipColor:getComputedStyle(chip).color,chipBackground:getComputedStyle(chip).backgroundColor,ghostColor:getComputedStyle(ghost).color,fieldBackground:getComputedStyle(card).backgroundColor,alignmentDeltaPx:slot.getBoundingClientRect().left-(field.getBoundingClientRect().left+parseFloat(s.paddingLeft)+parseFloat(s.borderLeftWidth)),gapPx:card.getBoundingClientRect().top-slot.getBoundingClientRect().bottom};});metrics.chipContrast=contrast(metrics.chipColor,metrics.chipBackground);metrics.ghostContrast=contrast(metrics.ghostColor,metrics.fieldBackground);assert.ok(metrics.chipContrast>=4.5);assert.ok(metrics.ghostContrast>=4.5);assert.ok(Math.abs(metrics.alignmentDeltaPx)<=1);
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await bar.evaluate(n=>getComputedStyle(n).animationName),'none');await p.emulateMedia({reducedMotion:'no-preference'});
 await field.fill('请继续');await bar.waitFor({state:'hidden'});assert.equal(await bar.isVisible(),false);await p.screenshot({path:join(out,`${surface}-${theme}-draft-only.png`)});await field.fill('');await prepareUx7Suggestions(p);
 await p.evaluate(()=>{const c=globalThis.__ux7core||uiCore;globalThis.__ux7ConversationRunning=c.conversationRunning;c.conversationRunning=()=>true;c.syncNextSuggestions();});await bar.waitFor({state:'hidden'});await p.screenshot({path:join(out,`${surface}-${theme}-running.png`)});await p.evaluate(()=>{const c=globalThis.__ux7core||uiCore;c.conversationRunning=globalThis.__ux7ConversationRunning;});
 if(surface==='electron')await p.evaluate(()=>__ux7ui.openSettings('assistant'));else await p.evaluate(()=>page('assistant'));
 const toggle=p.getByRole('switch',{name:'下一步建议',exact:true});await toggle.waitFor();await p.screenshot({path:join(out,`${surface}-${theme}-assistant-setting.png`)});assert.equal(await toggle.isChecked(),true);await toggle.click();assert.equal(await toggle.isChecked(),false);await p.waitForFunction(()=>(globalThis.__ux7core||uiCore).state.personalization.nextSuggestionsEnabled===false);const before=requests;
 await p.evaluate(async()=>{const c=globalThis.__ux7core||uiCore;await c.requestNextSuggestions('completion','请把它');await c.requestNextSuggestions('replies');});assert.equal(requests,before);await p.screenshot({path:join(out,`${surface}-${theme}-assistant-setting-off.png`)});
 checks.push({surface,theme,...metrics,reducedMotion:true,draftHidesChips:true,runningHidesChips:true,settingOffRequests:requests-before});await toggle.click();await p.waitForFunction(()=>(globalThis.__ux7core||uiCore).state.personalization.nextSuggestionsEnabled===true);if(surface!=='electron')await p.close();}
 await writeFile(join(out,'ui-extra-checks.json'),JSON.stringify({synthetic:true,checks},null,2));console.log('UX-7 extra UI checks passed');
}finally{await browser?.close();await app?.close();await f.close();await rm(profile,{recursive:true,force:true});await rm(f.root,{recursive:true,force:true});}
