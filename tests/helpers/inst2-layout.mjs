/** Layout-only fixture: reuse the separately verified downloaded state in an isolated installed app. */
import {chromium} from 'playwright';
import WebSocket from 'ws';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const [main,renderer,evidence]=process.argv.slice(2);
const resume=process.argv[5]==='--resume';
const state=JSON.parse(await readFile(join(evidence,'all-users-update.json'),'utf8')).state;
const until=async fn=>{const end=Date.now()+90000;while(Date.now()<end){const value=await fn().catch(()=>null);if(value)return value;await new Promise(ok=>setTimeout(ok,100));}throw Error('LAYOUT_TIMEOUT');};
let browser,socket;
try {
 browser=await until(()=>chromium.connectOverCDP(`http://127.0.0.1:${renderer}`));
 const page=await until(async()=>browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().includes('/personal/v1/ui')));
 if(!resume){const seeded=await page.evaluate(async()=>{const base=location.origin+'/personal/v1';const account=await weftmateDesktop.fetchPersonal(base+'/auth/desktop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceName:'synthetic-host'})});const onboarding=await weftmateDesktop.fetchPersonal(base+'/onboarding',{method:'PATCH',headers:{'content-type':'application/json','x-weftmate-csrf':account.body.csrfToken},body:JSON.stringify({step:'first',completed:true})});return [account.status,onboarding.status];});
 assert.deepEqual(seeded,[200,200]);
 await page.route('**/components/settings-navigation.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('(core, ui) => {','(core, ui) => { globalThis.__inst2LayoutCore = core;')});});
 await page.reload();}
 await page.waitForFunction(()=>!!globalThis.__inst2LayoutCore?.state.account?.ownerId);
 await page.evaluate(state=>{__inst2LayoutCore.readUpdateState=async()=>state;WeftSettingsNavigation.open('about');},state);
 await page.getByRole('button',{name:'打开安装包',exact:true}).waitFor();
 const target=(await fetch(`http://127.0.0.1:${main}/json/list`).then(response=>response.json())).find(row=>row.type==='node');assert.ok(target);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.once('open',ok);socket.once('error',no);});
 const resize=await new Promise((ok,no)=>{socket.on('message',raw=>{const row=JSON.parse(raw);if(row.id===1){if(row.error||row.result.exceptionDetails)no(Error('RESIZE_FAILED'));else ok(row.result.result.value);}});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`(()=>{const require=process.getBuiltinModule('module').createRequire(process.execPath);const {BrowserWindow}=require('electron');const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('/personal/v1/ui'));window.setContentSize(480,900);return window.getContentSize();})()`,returnByValue:true}}));});
 assert.equal(resize[0],480);await page.waitForFunction(()=>innerWidth===480);
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.getByText('新版已下载。打开安装包后按提示完成更新。',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(evidence,`all-users-update-${theme}-480.png`)});}
 const layout=await page.evaluate(()=>{const content=document.querySelector('.settings-content');return {width:innerWidth,height:innerHeight,contentWidth:content?.clientWidth,contentScrollWidth:content?.scrollWidth};});
 assert.ok(layout.contentScrollWidth<=layout.contentWidth+1);
 await writeFile(join(evidence,'narrow-layout.json'),JSON.stringify({actualInstalledElectron:true,downloadedStateFixture:true,downloadAlreadyVerifiedSeparately:true,nativeContentSize:resize,layout},null,2)+'\n');
 console.log('Installed 480px light/dark layout passed.');
}finally{socket?.close();await browser?.close();}
