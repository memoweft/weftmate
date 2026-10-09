import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {startMainChatCandidate} from './main-chat-candidate.mjs';
const out=resolve(import.meta.dirname,'../evidence/ia-4');await mkdir(out,{recursive:true});const samples=[];
for(const count of [1000,10000]){
  const f=await startMainChatCandidate(count,{logicalMobile:true});let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome',args:['--js-flags=--expose-gc']});
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await page.goto(f.mobileUrl);await page.getByRole('button',{name:'搜索主对话',exact:true}).waitFor();
    await page.waitForFunction(()=>state.booted&&document.querySelector('.main-chat-row.message'));await page.waitForTimeout(300);
    await page.evaluate(async()=>{await uiCore.selectMainChat();for(let n=0;n<5;n++)await uiCore.loadOlderLogicalHistory();for(const day of uiCore.mainChatDays())uiCore.expandChatDay(day.date);mobileEffects.scrollToLatest();});
    await page.mouse.move(190,350);for(let n=0;n<30;n++){await page.mouse.wheel(0,n%2?-300:300);await page.waitForTimeout(30);}
    const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const heap=await cdp.send('Runtime.getHeapUsage');
    const system=await browser.newBrowserCDPSession(),processes=(await system.send('SystemInfo.getProcessInfo')).processInfo.filter(row=>row.type==='renderer');
    const ids=processes.map(row=>row.id);assert.ok(ids.length);const privateBytes=Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Console]::Out.Write((Get-Process -Id ${ids.join(',')} | Measure-Object PrivateMemorySize64 -Sum).Sum)`],{encoding:'utf8',windowsHide:true}).trim());
    samples.push({historyMessages:count,heapBytes:heap.usedSize,rendererPrivateBytes:privateBytes,rendererCount:ids.length,cacheEvents:await page.evaluate(()=>uiCore.state.chatWindow.events.size),mountedRows:await page.locator('.main-chat-row').count()});
  }finally{await browser?.close();await f.close();await rm(f.root,{recursive:true,force:true});}
}
const report={samples,heapDeltaMiB:(samples[1].heapBytes-samples[0].heapBytes)/1048576,rendererPrivateDeltaMiB:(samples[1].rendererPrivateBytes-samples[0].rendererPrivateBytes)/1048576,
  comparison:'Separate Chromium renderer processes; identical phone UI, viewport, 5 history reads and 30 wheel gestures; forced JS GC before sampling. Chrome renderer private bytes only, excluding browser and synthetic host. Image decoder cache cannot be separately observed.'};
assert.ok(report.rendererPrivateDeltaMiB<=50);await writeFile(join(out,'memory.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
