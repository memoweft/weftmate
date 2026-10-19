// Drives the isolated, actually installed candidate. Local mode never starts a sandbox.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {generateKeyPairSync,privateDecrypt,constants} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [input,output,mode='local']=process.argv.slice(2);
if(!['local','dev'].includes(mode))throw Error('Only an isolated local installation or explicit-Core development host is supported');
const local=true,development=mode==='dev';
const {_electron}=createRequire(join(input,'package.json'))('playwright');
let key='',email='',app,page;
const redact=s=>String(s).replaceAll(key||'\0','[redacted]').replaceAll(email||'\0','[test mailbox]').replace(/((?:csrf|access_token|refresh_token|setupGrant|token)["'=:\s]+)[A-Za-z0-9._~-]{12,}/gi,'$1[redacted]');
for(const stream of [process.stdout,process.stderr])stream.on('error',e=>{if(e.code!=='EPIPE')throw e;});
const save=async(name,value)=>writeFile(join(output,name),redact(typeof value==='string'?value:JSON.stringify(value,null,2)));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,timeout=90000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await pause(250);}throw Error('STATE_TIMEOUT');};
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
await writeFile(join(output,'operator-public.pem'),pair.publicKey.export({type:'spki',format:'pem'}));
key=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::Out.Write([Environment]::GetEnvironmentVariable("MIMO_API_KEY","Machine"))'],{windowsHide:true,encoding:'utf8',timeout:10000}).trim();email=process.env.B1_TEST_EMAIL||'';
const installation=JSON.parse(await readFile(join(output,'installation.json'),'utf8'));
if(!installation.installedExecutable||!installation.profile||(!development&&installation.exeExists!==true))throw Error('A successfully verified isolated installation is required');
const exe=installation.installedExecutable;
if(!existsSync(exe))throw Error('The explicitly selected Electron executable is unavailable');
async function launch(){
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^ELECTRON_RUN_AS_NODE|^(?:WEFTMATE_|MEMOWEFT_)|API_KEY|TOKEN|SECRET|PASSWORD/i.test(k)));
 env.WEFTMATE_TEST_HOST_NAME='baseline-synthetic-host';
 Object.assign(env,installation?.environmentVariables??{});
 const args=[...(development?[input,'--personal-host']:[]),'--disable-gpu','--access-port=0',...(installation?.desktopConfig?[`--desktop-config=${installation.desktopConfig}`]:[])];
 app=await _electron.launch({executablePath:exe,args,env,timeout:90000});
 app.process().stdout?.resume();app.process().stderr?.resume();
 page=await until(async()=>app.windows().find(p=>p.url().includes('/personal/v1/ui')),90000);page.setDefaultTimeout(15000);
 if(local){const actual=await app.evaluate(({app})=>({packaged:app.isPackaged,exe:app.getPath('exe'),profile:app.getPath('userData')}));if(actual.packaged===development||actual.exe.toLowerCase()!==exe.toLowerCase()||actual.profile.toLowerCase()!==installation.profile.toLowerCase())throw Error('Running installation identity mismatch');}
 await app.evaluate(({app,desktopCapturer},directory)=>{globalThis.baselineNotices=[];globalThis.baselineShown=[];app.on('weftmate-desktop-notification',e=>globalThis.baselineNotices.push({...e,observedAt:new Date().toISOString()}));app.on('weftmate-desktop-notification-shown',e=>{globalThis.baselineShown.push({...e,observedAt:new Date().toISOString()});setTimeout(async()=>{try{const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1920,height:1080}});const fs=await import('node:fs/promises');await fs.writeFile(directory+'/notification-'+Date.now()+'.png',sources[0].thumbnail.toPNG());}catch{}},500);});},output);
 await save('startup.json',await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,exe:app.getPath('exe'),profile:app.getPath('userData'),pid:process.pid})));
}
async function api(path,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};},{path,body,method});
}
async function snapshot(){return {text:await page.locator('body').innerText(),buttons:await page.getByRole('button').allTextContents(),inputs:await page.locator('input,textarea,select').evaluateAll(es=>es.map(e=>({tag:e.tagName,id:e.id,type:e.type,label:e.getAttribute('aria-label'),placeholder:e.getAttribute('placeholder')})))};}
async function shot(name){
 await page.evaluate(mail=>{const rows=[];if(mail){const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(node.textContent.includes(mail)){rows.push([node,node.textContent]);node.textContent=node.textContent.replaceAll(mail,'[test mailbox]');}}globalThis.baselineEvidenceMasks=rows;},email);
 try{
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const capture=await app.evaluate(async({desktopCapturer,BrowserWindow})=>{const target=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/personal/v1/ui'));const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1920,height:1080}});const source=sources.find(s=>s.id===target.getMediaSourceId());if(!source)throw Error('Installed application capture unavailable');return source.thumbnail.toPNG().toString('base64');});
 await writeFile(join(output,name+'.png'),Buffer.from(capture,'base64'));
 }finally{await page.evaluate(()=>{for(const[node,text]of globalThis.baselineEvidenceMasks??[])if(node.isConnected)node.textContent=text;delete globalThis.baselineEvidenceMasks;}).catch(()=>{});}
}
async function send(text){const inputBox=page.getByRole('textbox',{name:'输入消息',exact:true});await inputBox.waitFor();await until(()=>inputBox.isEnabled(),45000);await inputBox.fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();}
const ctx={get app(){return app;},get page(){return page;},api,save,shot,snapshot,send,until,pause,launch,output,input,fillCode:async(locator,envelope)=>{const code=privateDecrypt({key:pair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope,'base64')).toString();await locator.fill(code);},fillEmail:locator=>locator.fill(email),fillKey:async locator=>{if(await locator.getAttribute('type')!=='password')throw Error('Key field must be masked');await locator.fill(key);},notices:()=>app.evaluate(()=>({requested:globalThis.baselineNotices,shown:globalThis.baselineShown}))};
try{
 await launch();await shot('00-fresh-installed');await save('snapshot.json',await snapshot());await save('ready.json',{ready:true,at:new Date().toISOString()});
 let last=await readFile(join(output,'response.json'),'utf8').then(JSON.parse).then(value=>value.id).catch(()=>'');const deadline=Date.now()+(local?90:28)*60000;
 while(Date.now()<deadline){
  if(existsSync(join(output,'stop.json')))break;
  const request=await readFile(join(output,'request.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(!request||request.id===last){await pause(300);continue;}last=request.id;
  try{await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(v=>v.webContents.getURL().includes('/personal/v1/ui'));if(w?.isMinimized()){w.restore();w.show();w.focus();}});const value=await new Function('ctx',`return (async()=>{${request.code}\n})()`)(ctx);await save('response.json',{id:last,ok:true,value});}
  catch(e){const windowState=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),minimized:w.isMinimized()}))).catch(()=>null);await save('response.json',{id:last,ok:false,error:redact(e.stack),windowState});}
  await save('snapshot.json',await snapshot());await save('notifications.json',await ctx.notices());
 }
}catch(e){await save('fatal.json',{error:redact(e.stack)});}
finally{if(app){const pid=app.process().pid;await app.close().catch(()=>{});try{execFileSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}key='';await save('controller-done.json',{at:new Date().toISOString()});}
