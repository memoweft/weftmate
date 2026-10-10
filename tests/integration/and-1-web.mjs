import assert from 'node:assert/strict';
import { chromium, _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { assertPublicText } from '../../scripts/review-gallery/common.mjs';

const out=new URL('../evidence/and-1/',import.meta.url),records=[];
const browser=await chromium.launch({headless:true});
try {
  for(const theme of ['light','dark']) {
    const fixture=await startTimelineCandidate({daily:true,logicalMobile:true,goals:true,interactive:true,historyCount:0});
    let application,profile;
    try {
      for(const [width,height] of [[390,844],[360,780],[480,800]]) {
        const context=await browser.newContext({viewport:{width,height},colorScheme:theme,isMobile:true,hasTouch:true});
        try {
          await context.addInitScript(theme=>localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme,accent:'neutral',fontSize:'15'})),theme);
          const page=await context.newPage();await page.goto(fixture.origin+'/personal/v1/ui');await localUiSession(page,fixture.credentials,'AND-1 合成远程浏览器',{mainChat:true});
          await page.waitForFunction(()=>document.querySelector('meta[name="theme-color"]')?.content);
          await page.waitForTimeout(350);
          const metadata=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,themeColor:document.querySelector('meta[name="theme-color"]').content,surface:getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),viewport:document.querySelector('meta[name="viewport"]').content}));
          assert.equal(metadata.theme,theme);assert.equal(metadata.themeColor,theme==='dark'?'#262724':'#ffffff');assert.match(metadata.viewport,/viewport-fit=cover/);
          assertPublicText(await page.locator('body').innerText());
          console.log('Web screenshot',theme,width);const file=`web-${width}-${theme}.png`;await page.screenshot({path:new URL(file,out).pathname.replace(/^\/([A-Z]:)/,'$1'),animations:'disabled'});records.push({file,width,height,...metadata,toolbarEvidence:false});
          await page.emulateMedia({colorScheme:theme==='dark'?'light':'dark'});
          await page.evaluate(()=>{const store=WeftUiCore.createAppearance(localStorage);store.set({...store.value,theme:'system'});document.querySelector('[data-theme]');});
        } finally {await context.close();}
      }
      profile=await mkdtemp(join(tmpdir(),'weftmate-and1-desktop-'));
      const env={...process.env,REVIEW_PROFILE:profile,REVIEW_THEME:theme,REVIEW_ORIGIN:fixture.origin};delete env.ELECTRON_RUN_AS_NODE;
      application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env,timeout:60000});
      const page=await application.firstWindow();await page.addInitScript(theme=>localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme,accent:'neutral',fontSize:'15'})),theme);await page.reload();await localUiSession(page,fixture.credentials,'AND-1 合成桌面',{mainChat:true});
      await application.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(480,800);w.show();w.focus()});await page.waitForTimeout(350);
      assertPublicText(await page.locator('body').innerText());
      const png=await application.evaluate(async({BrowserWindow,desktopCapturer})=>{const w=BrowserWindow.getAllWindows()[0],h=w.getNativeWindowHandle(),id=h.length===8?h.readBigUInt64LE().toString():h.readUInt32LE().toString();const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1800,height:1200}});const source=sources.find(s=>s.id.split(':')[1]===id);return source.thumbnail.toPNG().toString('base64')});
      await writeFile(new URL(`desktop-480-${theme}.png`,out),Buffer.from(png,'base64'));console.log('Desktop screenshot',theme);
    } finally {if(application){await application.evaluate(()=>process.exit(0)).catch(()=>{});await application.close().catch(()=>{});}if(profile)await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});console.log('Closing fixture',theme);await fixture.close();console.log('Fixture closed',theme);await rm(fixture.root,{recursive:true,force:true});}
  }
} finally {await browser.close();await writeFile(new URL('web-measurements.json',out),JSON.stringify(records,null,2)+'\n');}
