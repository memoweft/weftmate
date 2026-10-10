// Test instrumentation of the installed Electron notification events, preserving show().
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pause,until} from './harness.mjs';
const out=resolve('tests/evidence/qa-5/smoke');
const review=process.argv.includes('--review'),resultFile=review?'reminder-delivery-review.json':'native-notifications.json';
const install=readFileSync(join(out,'install-root.txt'),'utf8').trim();
const report={nativeElectronEvents:true,preserveOriginalShow:true,events:[]};let ws;
try{
 const pid=await until(()=>{const v=execFileSync('powershell.exe',['-NoProfile','-Command',"Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'WeftMate.exe' -and $_.ExecutablePath.StartsWith($env:QA5_INSTALL) -and $_.CommandLine -match '--inspect=0' } | Select-Object -First 1 -ExpandProperty ProcessId"],{encoding:'utf8',windowsHide:true,env:{...process.env,QA5_INSTALL:install}}).trim();return v&&Number(v);});
 const ports=execFileSync('powershell.exe',['-NoProfile','-Command',`Get-NetTCPConnection -State Listen -OwningProcess ${pid} | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -ExpandProperty LocalPort`],{encoding:'utf8',windowsHide:true}).trim().split(/\s+/).map(Number).filter(p=>p>0&&![8081,18186].includes(p));
 let target;for(const port of ports){try{const rows=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)})).json();target=Array.isArray(rows)&&rows.find(r=>r.type==='node');if(target)break;}catch{}}
 if(!target)throw Error('Installed main inspector unavailable');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=0;const pending=new Map();ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id&&pending.has(v.id)){pending.get(v.id)(v);pending.delete(v.id);}};
 const evaluate=expression=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});
 if(review){const value=await evaluate(`(async()=>{const {BrowserWindow}=process.getBuiltinModule('module').createRequire(process.execPath)('electron');const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/personal/v1/ui'));return {native:globalThis.qa5NativeNotificationEvents,requested:globalThis.qa5Notifications,activity:await window.webContents.executeJavaScript("fetch('/personal/v1/activity?type=reminder').then(r=>r.json())")};})()`);report.review=value.result?.result?.value;report.passed=report.review?.native.some(e=>e.event==='show'&&e.body?.includes('QA5日用冒烟活动'))&&report.review?.activity.items.some(e=>e.type==='reminder.triggered'&&JSON.stringify(e).includes('QA5日用冒烟活动'));report.note='Original smoke assertion checked before asynchronous native dispatch. Raw failure preserved; this read-only review requires both persisted reminder activity and native Electron show event.';}
 else {
 const installed=await evaluate(`(()=>{const {Notification}=process.getBuiltinModule('module').createRequire(process.execPath)('electron');globalThis.qa5NativeNotificationEvents=[];const original=Notification.prototype.show;Notification.prototype.show=function(){const title=this.title,body=this.body;this.once('show',()=>globalThis.qa5NativeNotificationEvents.push({event:'show',title,body,at:new Date().toISOString()}));this.once('failed',()=>globalThis.qa5NativeNotificationEvents.push({event:'failed',title,at:new Date().toISOString()}));return original.call(this);};return true;})()`);
 if(installed.result?.exceptionDetails)throw Error('Notification probe installation failed');report.installedAt=new Date().toISOString();
 const end=Date.now()+12*60*1000;while(Date.now()<end&&ws.readyState===WebSocket.OPEN){const value=await evaluate('globalThis.qa5NativeNotificationEvents');report.events=value.result?.result?.value??[];writeFileSync(join(out,resultFile),JSON.stringify(report,null,2));if(report.events.some(e=>e.event==='show'&&e.body?.includes('QA5日用冒烟活动')))break;await pause(3000);}
 }
}catch(e){report.error=e.message;}finally{ws?.close();report.finishedAt=new Date().toISOString();writeFileSync(join(out,resultFile),JSON.stringify(report,null,2));}
