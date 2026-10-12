import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream,statSync} from 'node:fs';
import {resolve,join,basename,dirname} from 'node:path';
import {chromium} from 'playwright';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
const [root,feed,uiManifest,evidence]=process.argv.slice(2).map(value=>resolve(value));
await mkdir(join(root,'data'),{recursive:true});
await writeFile(join(root,'data/.weftmate-personal-host-profile.json'),JSON.stringify({schemaVersion:1,purpose:'isolated-personal-host'}));
const server=createServer((req,res)=>{let file=resolve(feed,decodeURIComponent(req.url.split('?')[0]).replace(/^\/preview\//,''));if(!file.startsWith(feed)){res.writeHead(403);return res.end()};if(basename(file)==='manifest-ui.json')file=uiManifest;try{const size=statSync(file).size;const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');if(range){const start=+range[1],end=range[2]?+range[2]:size-1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});createReadStream(file,{start,end}).pipe(res)}else{res.writeHead(200,{'Content-Length':size});createReadStream(file).pipe(res)}}catch{res.writeHead(404);res.end()}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const config=join(root,'desktop.json');await writeFile(config,JSON.stringify({schemaVersion:1,dataDirectory:join(root,'data'),accessPort:0,production:{relayEnabled:false,acmeEnabled:false},updates:{channel:'preview',baseUrl:`http://127.0.0.1:${server.address().port}/`}}));await writeFile(join(root,'feed-ready.json'),JSON.stringify({config}));
const until=async(fn,ms=180000)=>{const end=Date.now()+ms;while(Date.now()<end){const value=await fn().catch(()=>null);if(value)return value;await new Promise(ok=>setTimeout(ok,100))}throw Error('MANUAL_UPDATE_TIMEOUT')};
let browser,socket,page;
try{
 const ports=await until(()=>readFile(join(root,'app-started.json'),'utf8').then(JSON.parse));
 browser=await until(()=>chromium.connectOverCDP(`http://127.0.0.1:${ports.renderer}`),90000);
 page=await until(async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/personal/v1/ui')));
 await until(()=>page.evaluate(async()=>typeof weftmateDesktop!=='undefined'&&await weftmateDesktop.updateState()));
 const seeded=await page.evaluate(async()=>{const base=location.origin+'/personal/v1';const account=await weftmateDesktop.fetchPersonal(base+'/auth/desktop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceName:'synthetic-host'})});if(account.status!==200)return {status:account.status};const onboarding=await weftmateDesktop.fetchPersonal(base+'/onboarding',{method:'PATCH',headers:{'content-type':'application/json','x-weftmate-csrf':account.body.csrfToken},body:JSON.stringify({step:'first',completed:true})});return {status:account.status,onboarding:onboarding.status}});assert.equal(seeded.status,200);assert.equal(seeded.onboarding,200);await page.reload();
 const state=await until(async()=>{const state=await page.evaluate(()=>weftmateDesktop.updateState());const app=state.layers.find(l=>l.layer==='app');if(app.status==='error')throw Error(app.error);return app.status==='downloaded'?state:null},240000);
 assert.equal(state.manualInstall,true);assert.match(state.layers.find(l=>l.layer==='app').error,/以管理员身份运行/);
 const target=(await fetch(`http://127.0.0.1:${ports.main}/json/list`).then(r=>r.json())).find(r=>r.type==='node');assert.ok(target);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.once('open',ok);socket.once('error',no)});
 let sequence=0;const evaluate=expression=>new Promise((ok,no)=>{const id=++sequence;const handler=raw=>{const row=JSON.parse(raw);if(row.id===id){socket.off('message',handler);if(row.error||row.result?.exceptionDetails)no(Error('MAIN_EVALUATION_FAILED'));else ok(row.result?.result?.value)}};socket.on('message',handler);socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))});
 await evaluate(`(()=>{const require=process.getBuiltinModule('module').createRequire(process.execPath);require('electron').shell.showItemInFolder=file=>{globalThis.inst2ShownInstaller=file};return true})()`);
 await until(()=>page.evaluate(()=>!!globalThis.WeftSettingsNavigation));await page.evaluate(()=>WeftSettingsNavigation.open('about'));
 await page.getByRole('button',{name:'打开安装包',exact:true}).waitFor();
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`all-users-update-${theme}.png`)});}
 await page.getByRole('button',{name:'打开安装包',exact:true}).click();
 const outcome=await evaluate(`(()=>{const require=process.getBuiltinModule('module').createRequire(process.execPath);const {app}=require('electron');const {join,basename}=require('node:path');const {existsSync}=require('node:fs');return {running:true,shown:!!globalThis.inst2ShownInstaller,filename:globalThis.inst2ShownInstaller?basename(globalThis.inst2ShownInstaller):null,pending:existsSync(join(app.getPath('appData'),'WeftMate inst2qa','WeftMate/app-recovery/pending.json')),cacheFile:globalThis.inst2ShownInstaller}})()`);
 assert.equal(outcome.shown,true);assert.equal(outcome.pending,false);assert.ok(!page.isClosed());
 await writeFile(join(root,'download-cache.json'),JSON.stringify({file:outcome.cacheFile}));delete outcome.cacheFile;
 await writeFile(join(evidence,'all-users-update.json'),JSON.stringify({syntheticScopeMetadata:true,actualHKLMInstall:false,realDownloadVerified:true,state,outcome},null,2)+'\n');await writeFile(join(root,'manual-done.json'),JSON.stringify({success:true}));
}catch(error){if(page){await page.screenshot({path:resolve('.local/inst2-manual-debug.png')}).catch(()=>{});await writeFile(resolve('.local/inst2-manual-debug.html'),await page.content()).catch(()=>{});}await writeFile(join(root,'manual-done.json'),JSON.stringify({success:false,error:error.message}));throw error}finally{socket?.close();await browser?.close();await new Promise(ok=>server.close(ok));}




