import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from '../../fx-16/runners/candidate.mjs';
import {localUiSession} from '../../../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/m3-1/states'),profile=await mkdtemp(join(tmpdir(),'weftmate-m31-visual-'));await mkdir(out,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|CLOUD_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
const fixture=await startTimelineCandidate({interactive:true,inlineProgress:true,historyCount:0,baseTime:Date.now()-2000});let app,browser;const checks=[];
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light'},cwd:resolve('.')});const desktop=await app.firstWindow();browser=await chromium.launch();const mobile=await browser.newPage({viewport:{width:390,height:844}});
 for(const [name,page,widths]of [['electron',desktop,[1200,480]],['phone-web',mobile,[390,360]]]){
  await page.route('**/personal/v1/ui/app.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('    ui.loadAttachmentHasher','    globalThis.m31Core=core;\n    ui.loadAttachmentHasher')});});
  if(name==='phone-web')await page.goto(fixture.origin+'/personal/v1/ui');else await page.reload();await localUiSession(page,fixture.credentials,'M3 visual states');await page.locator('#assistant-view').waitFor();if(await page.getByRole('button',{name:'停止回复',exact:true}).isVisible()){await page.getByRole('button',{name:'停止回复',exact:true}).click();await page.waitForTimeout(300);}await page.evaluate(()=>m31Core.stopAssistantRefresh());
  for(const width of widths){if(name==='electron')await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,800),width);else await page.setViewportSize({width,height:width===360?780:844});
   for(const theme of ['light','dark'])for(const kind of ['online','connecting','host_offline','network_unavailable','login_required','approval_required']){
    await page.evaluate(({theme,kind})=>{document.documentElement.dataset.theme=theme;m31Core.presence.success({runtime:'ready'});if(kind==='connecting')m31Core.presence.failure({code:'NETWORK'});else if(kind==='host_offline')m31Core.presence.failure({code:'HOST_OFFLINE'},{independent:true,cloudOffline:true});else if(kind==='network_unavailable')m31Core.presence.network(false);else if(kind!=='online')m31Core.presence.authorization(kind);},{theme,kind});
    await page.waitForTimeout(kind==='online'?3200:100);await page.screenshot({path:join(out,`${name}-${width}-${theme}-${kind}.png`)});
    const geometry=await page.evaluate(()=>{const bar=document.querySelector('.presence-bar'),field=document.getElementById('message-text');return {overflow:document.documentElement.scrollWidth>innerWidth,bar:bar.getBoundingClientRect().toJSON(),field:field.getBoundingClientRect().toJSON(),height:innerHeight,badgeVisible:document.querySelector('.presence-badge').getBoundingClientRect().height>0};});assert.equal(geometry.overflow,false);assert.ok(geometry.badgeVisible);assert.ok(geometry.bar.bottom<=geometry.field.top||kind==='online');checks.push({name,width,theme,kind,projection:true,...geometry});
   }
  }
 }
}finally{await browser?.close();await app?.close();await fixture.close();await rm(profile,{recursive:true,force:true});await writeFile(join(out,'verification.json'),JSON.stringify({realElectron:true,syntheticPresentation:true,checks},null,2));}
