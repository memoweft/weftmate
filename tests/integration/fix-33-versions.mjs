// Actual 3062ea4a host modules, current cloud, and current phone code. Synthetic data only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, symlink, unlink, rm, readdir, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {chromium,_electron} from 'playwright';
import {readFile} from 'node:fs/promises';
import {fixture} from '../../services/cloud/test/identity-helpers.mjs';
import {registration, appDevice, control, refresh, proof} from '../../services/cloud/test/app-helpers.mjs';
import {createPersonalAccessService as currentService} from '../../src/personal-access/index.mjs';
import {servePersonalAccessUi} from '../../src/personal-access-ui/index.mjs';
import {phoneRuntime} from '../../services/cloud/test/relay-phone-runtime.mjs';

const root=await mkdtemp(join(tmpdir(),'weftmate-fix33-')), cleanup=[], trace=[];
const report={synthetic:true, model:'synthetic backend with durable user/assistant events', baseline:'3062ea4a', scenarios:[],trace};
const out=resolve('tests/evidence/fix-33');await mkdir(out,{recursive:true});
const baseline=process.env.FIX33_BASELINE==='1';report.baseline=baseline;
const sha=text=>createHash('sha256').update(text).digest('hex');
const wait=async(read,done)=>{const end=Date.now()+10000;while(Date.now()<end){const r=await read();if(done(r))return r;await new Promise(r=>setTimeout(r,30));}throw Error('synthetic receipt timed out');};
function backend(){const sessions=new Map(), starts=[],waiters=new Set();return {starts,
 getStatus:async()=>({runtime:'ready',referenceScan:'ready',capabilities:{chat:{available:true,inferenceVerified:false}}}),listModels:async()=>[{id:'synthetic',name:'合成模型',model:'synthetic',configured:true}],preflight:async()=>({ok:true}),
 createSession:async({sessionId})=>{sessions.set(sessionId,[]);return {sessionId};},
 sendMessage:async({sessionId,text})=>{starts.push(performance.now());const rows=sessions.get(sessionId),receiptId=randomUUID(),at=new Date().toISOString();
 const turn=starts.length;rows.push({seq:rows.length,type:'user.message',at,data:{text,receiptId,messageHash:sha(text),turn}});rows.push({seq:rows.length,type:'assistant.message',at,data:{text:'合成回复 '+text,turn}});rows.push({seq:rows.length,type:'turn.ended',at,data:{reason:'completed',turn}});for(const wake of waiters)wake(sessionId);return {accepted:true,receiptId,dshTurn:turn};},
 waitForEvents:async({sessionId,seq,timeoutMs,signal})=>{if((sessions.get(sessionId)?.at(-1)?.seq??-1)>seq)return;await new Promise(resolve=>{let timer;const wake=id=>{if(id!==sessionId)return;clearTimeout(timer);waiters.delete(wake);signal?.removeEventListener('abort',abort);resolve();},abort=()=>wake(sessionId);waiters.add(wake);timer=setTimeout(abort,timeoutMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});},
 chatRelayState:async()=>({safe:false,pending:false}),cancelSession:async()=>({accepted:true}),readEvents:async({sessionId,afterSeq=-1,limit=100})=>{const rows=sessions.get(sessionId)||[];return {events:rows.filter(r=>r.seq>afterSeq).slice(0,limit),nextSeq:rows.at(-1)?.seq??-1,hasMore:false};},
 describeSession:async sessionId=>sessions.has(sessionId)?{sessionId,title:'合成对话',running:false,agentPreset:'personal-remote',modelProfileId:'synthetic'}:null};}
try{
 const archive=join(root,'old.tar');execFileSync('git',['archive','--format=tar','--output',archive,'3062ea4a','src','package.json'],{windowsHide:true});
 const old=join(root,'old');await mkdir(old);execFileSync('tar',['-xf',archive,'-C',old],{windowsHide:true});await rm(archive);
 const link=join(old,'node_modules');await symlink(resolve('node_modules'),link,'junction');cleanup.push(()=>unlink(link));
 const oldService=(await import(pathToFileURL(join(old,'src/personal-access/index.mjs')).href)).createPersonalAccessService;
 const f=await fixture({after:fn=>cleanup.push(fn)});
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  const response=await originalFetch(url,options);
  if(String(url).startsWith(f.origin+'/')) {
   let fields=[];try{fields=Object.keys(JSON.parse(options.body||'{}'));}catch{fields=[...new URLSearchParams(options.body).keys()];}
   const data=await response.clone().json().catch(()=>({}));
   trace.push({host:'cloud',method:options.method||'GET',path:new URL(url).pathname,status:response.status,requestFields:fields,responseFields:Object.keys(data),code:data.error?.code||data.error});
  }
  return response;
 };cleanup.push(async()=>{globalThis.fetch=originalFetch;});await registration(f);
 const desktop=await appDevice(f,'desktop'), phone=await appDevice(f,'phone');
 for(const [version,create] of [['old',oldService],['current',currentService]]){
  const data=join(root,version+'-data');await mkdir(data);
  const runtime=process.env.FIX33_UI==='1'?await phoneRuntime(data,[]):null;
  if(runtime)cleanup.push(()=>runtime.close());
  const b=runtime?Object.assign(runtime.backend,{starts:[]}):backend();
  if(runtime){const push=runtime.requests.push.bind(runtime.requests);runtime.requests.push=(...rows)=>{for(const row of rows)b.starts.push(performance.now());return push(...rows);};}
  const desktopUi=version==='old'?(await import(pathToFileURL(join(old,'src/personal-access-ui/index.mjs')).href)).servePersonalAccessUi:servePersonalAccessUi;
  const host=await create({root:data,port:0,backend:b,uiHandler:desktopUi,cloudIdentity:{issuer:f.config.issuer,allowInsecureLoopback:true}});cleanup.push(()=>host.close());
  if(runtime){runtime.setHost(host);await runtime.start();}
  const started=await host.start();
  async function api(path,body,auth,headers={}){const begin=performance.now(),response=await fetch(started.origin+'/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:{origin:started.origin,'content-type':'application/json',...(auth?{cookie:auth.cookie,'x-weftmate-csrf':auth.csrfToken}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();trace.push({host:version,method:body===undefined?'GET':'POST',path,status:response.status,ms:Math.round(performance.now()-begin),requestFields:Object.keys(body||{}),responseFields:Object.keys(data),commandFields:Object.keys(data.command||{}),code:data.error?.code});return {...data,status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]||auth?.cookie};}
  const native=await api('/auth/desktop',{deviceName:'synthetic-host'},null,{'x-weftmate-desktop':host.libraryDesktopToken});assert.equal(native.status,200);
  const exchange=async(device,path,auth)=>{const nonce=await api('/auth/cloud-nonce',{});return api(path,{accessToken:device.tokens.access_token,deviceName:device.deviceId},auth,{dpop:await proof(device,started.origin+'/personal/v1'+path,device.tokens.access_token,{nonce:nonce.nonce}),...(auth?{'x-weftmate-desktop':host.libraryDesktopToken}:{})});};
  if(version==='current')await refresh(desktop,f.config.audience);
  const bound=await exchange(desktop,'/auth/cloud-desktop',native);assert.equal(bound.status,200,JSON.stringify(bound));await host.syncCloudRevocations();
  await refresh(phone,f.config.audience);await control(phone,'/hosts/connect',{hostId:started.hostId});await refresh(phone,f.config.audience+'/hosts/'+started.hostId);
  const auth=await exchange(phone,'/auth/cloud-session');assert.equal(auth.status,200,JSON.stringify(auth));
  const scenario={version,config:await api('/cloud/config'),status:await api('/status',undefined,auth),messages:[]};
  // Keep no credentials or account ids in evidence.
  scenario.config={fields:Object.keys(scenario.config),capabilities:scenario.config.capabilities};scenario.status={fields:Object.keys(scenario.status),personalCapabilities:scenario.status.personalCapabilities};
  const created=await api('/commands',{requestId:randomUUID(),targetDeviceId:started.hostId,kind:'session.create',modelProfileId:'synthetic'},auth);
  const complete=await wait(()=>api('/commands/by-request/'+created.command.requestId,undefined,auth),r=>r.command?.state==='accepted_by_dsh');
  const sessionId=complete.command.sessionId,main=(await api('/chats/main',undefined,auth)).chat,side=await api('/sessions/'+sessionId+'/chat',undefined,auth);
  for(const [kind,chat] of [['main',main],['side',side]]) {
  for(let i=0;i<4;i++){
   const requestId='native-'+randomUUID(),begin=performance.now(),start=b.starts.length;await api('/commands/by-request/'+requestId,undefined,auth);
   const payload=kind==='main'||baseline?{kind:'chat.message',chatId:chat.chatId,modelProfileId:'synthetic'}:{kind:'session.message',sessionId};
   const sent=await api('/commands',{requestId,targetDeviceId:started.hostId,...payload,text:'你好',mode:'queue'},auth);
   const result=sent.command?await wait(()=>api('/commands/by-request/'+requestId,undefined,auth),r=>['accepted_by_dsh','rejected','observed'].includes(r.command?.state)):sent;
   scenario.messages.push({kind,index:i+1,status:sent.status,state:result.command?.state,error:result.command?.errorCode||result.error?.code,commandFields:Object.keys(result.command||{}),toModelStartMs:b.starts[start]===undefined?null:Math.round(b.starts[start]-begin)});
   if(!baseline)assert.equal(result.command?.state,'accepted_by_dsh');
   if(baseline&&kind==='side')assert.equal(result.error?.code,'CHAT_UNAVAILABLE');
  }
  }
  report.scenarios.push(scenario);
  if(process.env.FIX33_UI==='1') {
   const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
   const electron=await _electron.launch({args:[resolve('tests/helpers/fix33-electron.cjs')],env:environment});
   const browser=await chromium.launch({headless:true}),phonePage=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),desktopPage=await electron.firstWindow();
   try {
    for(const [surface,page,identity] of [['desktop',desktopPage,auth],['phone',phonePage,auth]]) {
     page.on('response',async response=>{const request=response.request(),url=new URL(response.url());if(url.pathname.startsWith('/personal/v1/')&&!url.pathname.includes('/ui/'))trace.push({host:version,surface,method:request.method(),path:url.pathname,status:response.status(),requestFields:Object.keys(request.postDataJSON?.()||{})});});
     await page.addInitScript(()=>{let module;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>module,set:value=>{module=value;const original=value.create;value.create=(...args)=>{const core=original(...args);globalThis.__fix33Core=core;return core;};}});});
     await page.context().addCookies([{name:'wm_personal_session',value:identity.cookie.split('=')[1],url:started.origin}]);
     await page.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!==started.origin)return route.abort();
      if(surface==='phone'&&url.pathname.startsWith('/personal/v1/ui/')) {
       let file=url.pathname.slice('/personal/v1/ui/'.length)||'index.html';
       const target=file.startsWith('ui-core/')?resolve('src',file):resolve('src/personal-access-ui',file);
       try{return route.fulfill({status:200,body:await readFile(target),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':undefined});}catch{}
      }
      return route.continue(surface==='desktop'&&url.pathname.startsWith('/personal/v1/')?{headers:{...route.request().headers(),origin:started.origin,'x-weftmate-desktop':host.libraryDesktopToken}}:undefined);
     });
     await page.goto(started.origin+'/personal/v1/ui/');await page.waitForFunction(()=>globalThis.__fix33Core);
     await page.evaluate(async identity=>{const c=globalThis.__fix33Core;c.acceptSession(identity);await c.enterAssistant();},identity);
     await page.evaluate(async id=>{await globalThis.__fix33Core.selectSession(id);},sessionId);
     await page.screenshot({path:join(out,`${version}-${surface}-connected.png`)});
    }
    scenario.latency=[];
    const visible=async(page,text)=>page.waitForFunction(text=>document.getElementById('transcript')?.textContent.includes(text),text,{timeout:20000});
    for(const [source,target,label] of [[phonePage,desktopPage,'phone-to-desktop'],[desktopPage,phonePage,'desktop-to-phone']]) {
    for(let index=1;index<=4;index++) {
     const replies=await target.evaluate(()=>Array.from(globalThis.__fix33Core.state.historyEvents.values()).filter(e=>e.type==='assistant.message').length);
     const text='合成来回消息-'+randomUUID(),begin=performance.now();await source.locator('#message-text').fill(text);await source.locator('#send-message').click();
     await source.screenshot({path:join(out,`${version}-${label}-sending.png`)});
     await visible(target,text);const userMs=Math.round(performance.now()-begin);await target.waitForFunction(count=>Array.from(globalThis.__fix33Core.state.historyEvents.values()).filter(e=>e.type==='assistant.message').length>count,replies,{timeout:20000});
     scenario.latency.push({label,index,userMs,replyMs:Math.round(performance.now()-begin)});await target.screenshot({path:join(out,`${version}-${label}.png`)});
    }
    }
    const conversationId='conversation-'+randomUUID(),at=new Date().toISOString(),body={events:[{eventId:'event-'+randomUUID(),conversationId,clientSeq:1,kind:'conversation.created',occurredAt:at,payload:{title:'合成手机独立对话'}},{eventId:'event-'+randomUUID(),conversationId,clientSeq:2,kind:'message.created',occurredAt:at,payload:{messageId:'message-'+randomUUID(),role:'user',text:'合成手机独立消息'}},{eventId:'event-'+randomUUID(),conversationId,clientSeq:3,kind:'message.created',occurredAt:at,payload:{messageId:'message-'+randomUUID(),role:'assistant',text:'合成手机独立回复'}}]};
    const begin=performance.now();const uploaded=await api('/sync/events',body,auth);assert.equal(uploaded.status,200);
    try {
     await desktopPage.waitForFunction(id=>globalThis.__fix33Core.phoneConversations().some(c=>c.id===id),conversationId,{timeout:10000});
     scenario.latency.push({label:'phone-independent-upload-to-desktop-list',ms:Math.round(performance.now()-begin)});
    }catch(error){
     if(version!=='old')throw error;
     scenario.latency.push({label:'phone-independent-upload-to-desktop-list',ms:null,notVisibleWithinMs:10000,requiresDesktopUpdate:true});
     const refresh=performance.now();await desktopPage.evaluate(()=>globalThis.__fix33Core.refreshPhoneRecords());scenario.latency.push({label:'legacy-manual-phone-history-read',ms:Math.round(performance.now()-refresh)});
    }
    await desktopPage.evaluate(id=>globalThis.__fix33Core.selectPhoneConversation(id),conversationId);await desktopPage.screenshot({path:join(out,`${version}-phone-history.png`)});
   } finally {await browser.close();await electron.close();}
  }
  await host.close();cleanup.pop();if(runtime){await runtime.close();cleanup.pop();}
 }
}finally{
 for(const close of cleanup.reverse())await close();
 assert.ok(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'));
 async function detachLinks(directory){for(const entry of await readdir(directory)){const path=join(directory,entry),stat=await lstat(path);if(stat.isSymbolicLink())await unlink(path);else if(stat.isDirectory())await detachLinks(path);}}
 await detachLinks(root);await rm(root,{recursive:true,force:true});
 await writeFile(join(out,process.env.FIX33_UI==='1'?'versions-ui.json':baseline?'versions-before.json':'versions-after.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({scenarios:report.scenarios.map(s=>({version:s.version,messages:s.messages.map(m=>({kind:m.kind,index:m.index,state:m.state,error:m.error,toModelStartMs:m.toModelStartMs})),latency:s.latency})),requests:trace.length}));
}
