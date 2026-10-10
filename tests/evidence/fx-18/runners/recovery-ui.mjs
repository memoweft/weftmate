import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness,pause,until} from './harness.mjs';
import {localUiSession} from '../../../helpers/local-ui-session.mjs';
const h=await harness('recovery-ui-final'),report={realElectron:true,realCore:true,syntheticModel:true,shots:[]};
let browser,phone,release=()=>{};
try {
 const id=await h.session();h.formationGate=new Promise(r=>release=r);
 await h.send(id,'我偏好第918种合成茶加两片柠檬。');await until(()=>h.formationActive>0);
 await h.app.close();h.app=null;await h.launch();
 await until(async()=>(await h.api('/memory/status')).body.state==='recovering');
 report.status=(await h.api('/memory/status')).body;
 const openMemory=async p=>{await p.evaluate(()=>document.getElementById('rail-memory').click());await p.locator('#memory-health').getByText('正在继续整理上次没做完的记忆',{exact:true}).waitFor();};
 await openMemory(h.page);
 for(const width of [1120,480])for(const theme of ['light','dark']) {
  await h.app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,820),width);
  await h.page.emulateMedia({colorScheme:theme});await pause(250);
  const file=`desktop-${width}-${theme}.png`;await h.page.screenshot({path:join(h.out,file)});report.shots.push(file);
 }
 browser=await chromium.launch({channel:'msedge',headless:true});
 phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await phone.goto(h.origin+'/personal/v1/ui');await localUiSession(phone,h.credentials,'FX18 phone',{mainChat:true});await phone.locator('#assistant-view').waitFor({state:'visible'});await openMemory(phone);
 for(const [width,height] of [[360,780],[390,844]])for(const theme of ['light','dark']) {
  await phone.setViewportSize({width,height});await phone.emulateMedia({colorScheme:theme});await pause(150);
  const file=`phone-${width}-${theme}.png`;await phone.screenshot({path:join(h.out,file)});report.shots.push(file);
 }
 report.activityDuring=(await h.api('/activity?type=memory')).body.items;
 assert.ok(report.activityDuring.some(i=>i.title==='正在继续整理上次没做完的记忆'));
 release();await h.healthy(30000);
 report.finalStatus=(await h.api('/memory/status')).body;
 report.activityAfter=(await h.api('/activity?type=memory')).body.items;
 assert.ok(report.activityAfter.some(i=>i.title==='上次没做完的记忆已整理完成'));
 await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1120,820));
 await h.page.emulateMedia({colorScheme:'light'});await pause(3000);
 await h.page.screenshot({path:join(h.out,'completed.png')});report.passed=true;
} catch(e){report.error=e.stack;if(phone){report.phoneBody=await phone.locator('body').innerText();report.phoneHealth=await phone.evaluate(async()=>await(await fetch('/personal/v1/memory/status')).json());await phone.screenshot({path:join(h.out,'phone-failure.png')});}throw e} finally {release();await browser?.close();await h.close();writeFileSync(join(h.out,'results.json'),JSON.stringify(report,null,2));}
