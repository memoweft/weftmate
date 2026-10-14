import { evidencePath } from '../helpers/evidence-path.mjs';
// Local cloud + production Electron/DSH + phone web. No installed app or production cloud.
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {mkdir,writeFile,readFile,readdir,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {managedMkdtemp,managedTempRoot,disposeManagedTemp} from '../helpers/managed-temp.mjs';
import {redactEvidenceText,cleanupOwnedProcesses,systemCommitMemory} from '../helpers/process-evidence.mjs';
import {PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT} from '../../src/host-mode.mjs';
import {sessionWorkspace} from '../../src/personal-access/session-workspace.mjs';
import {fixture,P,EMAIL,PASSWORD} from '../../services/cloud/test/identity-helpers.mjs';
import {registration,appDevice,control,refresh,proof} from '../../services/cloud/test/app-helpers.mjs';
import {s7Phone} from '../helpers/s7-phone.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=evidencePath('s7'),startedAt=Date.now(),root=await managedMkdtemp(join(managedTempRoot(),'wm-s7-')),profile=join(root,'desktop');
await mkdir(profile);await mkdir(out,{recursive:true});await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const key=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim();assert.ok(key,'MiMo machine environment key is required');
const cleanups=[],errors=[],report={syntheticCloud:true,realElectron:true,realDSH:true,model:'mimo-v2.6-flash',modelRequests:0,checks:[],screenshots:[],systemBars:'Browser viewport evidence; native system bars require the follow-up shell.'};
let f,desktop,phone,app,page,browser,mobile,auth,hostId,sessionId,clock,diagnostics='';
const proxyControllers=new Set(),proxyRequests={model:0,catalog:0};
const modelProxy=httpServer(async(request,response)=>{
  if(!['/v1/chat/completions','/v1/models'].includes(request.url)){response.writeHead(404).end();return;}
  const abort=new AbortController();proxyControllers.add(abort);response.on('close',()=>{if(!response.writableEnded)abort.abort();});
  try{
    const body=request.method==='POST'?Buffer.concat(await Array.fromAsync(request)):undefined;
    proxyRequests[body?'model':'catalog']++;
    const upstream=await fetch('https://api.xiaomimimo.com'+request.url,{method:request.method,headers:{'content-type':'application/json',authorization:'Bearer '+key},body,signal:abort.signal});
    response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json'});
    if(upstream.body)await pipeline(Readable.fromWeb(upstream.body),response);else response.end();
  }catch{if(!response.headersSent)response.writeHead(502);response.end();}finally{proxyControllers.delete(abort);}
});
await new Promise(done=>modelProxy.listen(0,'127.0.0.1',done));
const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));const origin=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function until(fn,label,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await sleep(350);}throw Error(label);}
const sanitize=text=>redactEvidenceText(String(text).replaceAll(key,'[redacted]'),[root]);
function env(){return {...Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('WEFTMATE_')&&!name.startsWith('MEMOWEFT_')&&!['MIMO_API_KEY','ELECTRON_RUN_AS_NODE'].includes(name))),WEFTMATE_TEST_HOST_NAME:'synthetic-host',WEFTMATE_CLOUD_ISSUER:f.config.issuer,WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK:'true',WEFTMATE_CLOUD_WEB_CLIENT_ID:'test-native'};}
async function launch(){
  console.log('S7: starting isolated Electron');
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:[repo,`--user-data-dir=${profile}`,'--personal-host',`--access-port=${port}`],env:env(),timeout:90000});
  app.process().stdout?.on('data',part=>diagnostics=(diagnostics+sanitize(part)).slice(-40000));app.process().stderr?.on('data',part=>diagnostics=(diagnostics+sanitize(part)).slice(-40000));
  app.process().on('exit',(code,signal)=>{report.electronExit={code,signal};});
  await app.context().addInitScript(()=>{let api;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set:value=>{api=value;const create=value.create;value.create=options=>{const core=create(options);globalThis.__s7core=core;return core;};}});});
  page=await until(()=>app.windows().find(window=>window.url().includes('/personal/v1/ui')),'main Electron window',90000);page.on('pageerror',error=>errors.push(sanitize(error.message)));
  await page.waitForLoadState('load');await page.waitForFunction(()=>globalThis.__WeftUiStarted,{timeout:90000});
  if(!await page.evaluate(()=>!!globalThis.__s7core))await page.reload();
  await page.waitForFunction(()=>globalThis.__s7core?.state.account,{timeout:90000});
}
async function api(path,body,method=body===undefined?'GET':'POST'){
  return page.evaluate(async({path,body,method})=>globalThis.__s7core.accessApi(path,{method,...(body===undefined?{}:{body,protectedWrite:true})}),{path,body,method});
}
async function exchange(device,route){
  const nonce=await api('/auth/cloud-nonce',{});const dpop=await proof(device,origin+'/personal/v1'+route,device.tokens.access_token,{nonce:nonce.nonce});
  if(route==='/auth/cloud-desktop')return page.evaluate(async({origin,dpop,token})=>{
    const response=await weftmateDesktop.fetchPersonal(origin+'/personal/v1/auth/cloud-desktop',{method:'POST',headers:{'content-type':'application/json',dpop,'x-weftmate-csrf':__s7core.state.csrfToken},body:JSON.stringify({accessToken:token,deviceName:'synthetic-host'})},crypto.randomUUID());
    if(response.status!==200)throw Error(JSON.stringify(response.body));__s7core.acceptSession(response.body);return response.body;
  },{origin,dpop,token:device.tokens.access_token});
  const response=await fetch(origin+'/personal/v1'+route,{method:'POST',headers:{origin,dpop,'content-type':'application/json'},body:JSON.stringify({accessToken:device.tokens.access_token,deviceName:'synthetic-phone'})});
  return {...await response.json(),status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function command(body){const {command}=await api('/commands',{requestId:randomUUID(),targetDeviceId:hostId,...body});return until(async()=>{const result=(await api('/commands/'+command.commandId)).command;return ['pending','dispatching'].includes(result.state)?null:result;},'command receipt');}
async function cloud(action,body){if(phone.tokens.resource!==f.config.audience)await refresh(phone,f.config.audience);const response=await control(phone,'/hosts/offline/tasks/'+action,body,null);if(response.status!==200)throw Object.assign(Error(response.data.error?.code),{code:response.data.error?.code,status:response.status});return response.data;}
async function mountPhone(){
  await mobile.waitForFunction(()=>globalThis.__s7view);
  await mobile.evaluate(()=>__s7view.tick());
  await mobile.waitForFunction(()=>globalThis.__s7offline?.view().taskReady);
  await mobile.evaluate(()=>__s7offline.refreshTasks());
}
async function mobileShots(state,prepare=async()=>{}){
  for(const theme of browser.theme?[browser.theme]:['light','dark'])for(const width of browser.theme?[390]:[360,390]){
    await mobile.evaluate(async hostId=>{const status=await __s7core.cloudOfflineStatus(hostId);if(!status.authorized)throw Error('phone authorization is unavailable');},hostId);
    await mobile.waitForFunction(()=>document.getElementById('toast')?.hidden!==false);
    if(!browser.theme)await mobile.setViewportSize({width,height:width===360?780:844});await mobile.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await prepare();await sleep(120);
    const expected={ 'waiting-message':'已记下，等电脑上线','computer-started':'电脑已开始',completed:'做完了',failed:'没做成' }[state];
    if(expected)await mobile.evaluate(expected=>{const node=[...document.querySelectorAll('.offline-task-state')].filter(n=>n.textContent.includes(expected)).at(-1);if(!node)throw Error('Expected visible status '+expected);node.scrollIntoView({block:'nearest'});},expected);
    if(browser.capture)await browser.capture(state);else{const file=`mobile-${width}-${theme}-${state}.png`;await mobile.screenshot({path:join(out,file)});report.screenshots.push(file);}if(['offline-entry','cancel-confirm'].includes(state))await mobile.keyboard.press('Escape');
    assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'phone must not overflow');
  }
}
try{
  f=await fixture({after:fn=>cleanups.push(fn)},{env:{CLOUD_OIDC_CLIENTS:JSON.stringify([{client_id:'test-native',redirect_uris:['com.example.weftmate:/callback',origin+'/personal/v1/ui/']},{client_id:'weftmate-web',application_type:'web',redirect_uris:[origin+'/personal/v1/ui/'] }])}});await registration(f);desktop=await appDevice(f,'desktop');phone=await appDevice(f,'phone');clock=setInterval(()=>f.advance(Math.max(0,Date.now()-f.now)),500);
  await launch();await exchange(desktop,'/auth/cloud-desktop');hostId=(await api('/status')).hostId;
  const connected=(await control(phone,'/hosts/connect',{hostId})).data;await refresh(phone,connected.resource);auth=await exchange(phone,'/auth/cloud-session');
  if(auth.status===202){await api(`/cloud/devices/${auth.requestId}/decision`,{decision:'allow'});auth=await exchange(phone,'/auth/cloud-session');}assert.equal(auth.status,200);await refresh(phone,f.config.audience);
  const requestId=randomUUID();await api('/account/models',{requestId,name:'Synthetic S7 MiMo',baseUrl:`http://127.0.0.1:${modelProxy.address().port}/v1`,modelId:'mimo-v2.6-flash',apiKey:'synthetic-'+randomUUID(),modelTier:'cloud'});
  await until(async()=> (await api('/account/models/by-request/'+requestId)).operation?.status==='succeeded','MiMo account configuration');
  const model=(await api('/models')).models.find(row=>row.name==='Synthetic S7 MiMo');await api('/settings/models',{defaultModelProfileId:model.id,backgroundModelProfileId:model.id},'PATCH');
  await api('/settings/notifications',{dndEnabled:false,dailyLimit:null},'PATCH');await api('/settings/approvals',{mode:'auto',rules:{read:'allow',write:'ask'},secondOpinionEnabled:false},'PATCH');await api('/onboarding',{step:'first',completed:true},'PATCH');
  await api('/settings/personalization',{nextSuggestionsEnabled:false,inlineCompletionEnabled:false},'PATCH');
  const created=await command({kind:'session.create',modelProfileId:model.id});sessionId=created.sessionId;
  const workspace=sessionWorkspace(join(profile,'conversations'),auth.account.ownerId,sessionId);await mkdir(workspace,{recursive:true});await writeFile(join(workspace,'s7-notes.txt'),'合成说明：先读，再保存。');
  await command({kind:'session.message',sessionId,text:'请只回复“准备好了”，不要调用工具。'});report.modelRequests++;
  await until(async()=> (await api(`/sessions/${sessionId}/events?limit=100`)).events?.some(e=>e.type==='turn.ended'),'warm-up reply');
  report.usage=await api('/usage');report.modelRequests=report.usage.total?.requests??report.modelRequests;
  await page.reload();await page.waitForFunction(()=>globalThis.__s7core?.state.account);await page.evaluate(sessionId=>__s7core.selectSession(sessionId),sessionId);
  browser=process.env.WEFTMATE_S7_PHONE_THEME?await s7Phone(origin,f.config.issuer,out,report,process.env.WEFTMATE_S7_PHONE_THEME):await chromium.launchPersistentContext(join(root,'phone'),{headless:true,viewport:{width:390,height:844}});
  if(browser.theme)report.systemBars='Android remote webpage; full system-bar capture pending.';
  await browser.addInitScript(()=>{let api;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set:value=>{api=value;const create=value.create;value.create=options=>{const core=create(options);globalThis.__s7core=core;globalThis.__s7taskErrors=[];const tasks=core.cloudOfflineTasks;core.cloudOfflineTasks=async(...args)=>{try{return await tasks(...args);}catch(error){__s7taskErrors.push({code:error.code||'NETWORK',status:error.status});throw error;}};return core;};}});});
  await browser.addInitScript(()=>{for(const name of ['WeftOffline','WeftOfflineView']){let api;Object.defineProperty(globalThis,name,{configurable:true,get:()=>api,set:value=>{api=value;if(name==='WeftOffline'){const create=value.create;value.create=async options=>globalThis.__s7offline=await create(options);}else{const mount=value.mount;value.mount=options=>globalThis.__s7view=mount(options);}}});}});
  mobile=await browser.newPage();await mobile.goto(origin+'/personal/v1/ui/');await mobile.waitForFunction(()=>globalThis.__s7core?.state.cloudAuth?.mode==='login');
  await mobile.evaluate(({email,password})=>__s7core.cloudLogin({email,password}),{email:EMAIL,password:PASSWORD});
  if(await mobile.evaluate(()=>__s7core.state.cloudAuth.mode==='confirm')){
    const challenge=f.db.prepare("SELECT id FROM email_challenges WHERE purpose='device' AND consumed=0 ORDER BY expires_at DESC LIMIT 1").get();assert.ok(challenge);
    await mobile.evaluate(code=>__s7core.cloudVerifyCode(code),await f.mailCode(challenge.id));
  }
  const pending=(await api('/cloud/devices/pending')).devices;for(const row of pending)await api(`/cloud/devices/${row.id}/decision`,{decision:'allow'});
  await mobile.waitForFunction(()=>globalThis.__s7core?.state.cloudAuth?.mode==='authenticated');await mountPhone();
  console.log('S7: stopping computer, submitting from phone');await app.close();app=null;
  await mobile.evaluate(async()=>{__s7core.presence.failure({code:'HOST_OFFLINE'});await __s7view.tick();__s7core.openOfflineMode();});
  await mobileShots('offline-entry',()=>mobile.getByRole('button',{name:'更多发送方式'}).click());
  const submit=async text=>{const before=await mobile.locator('.offline-task-state').filter({hasText:'已记下，等电脑上线'}).count();await mobile.getByRole('textbox',{name:'离线消息'}).fill(text);await mobile.getByRole('button',{name:'更多发送方式'}).click();await mobile.getByRole('menuitemradio',{name:'交给电脑，上线后做',exact:true}).click();await mobile.getByRole('button',{name:'记下来',exact:true}).click();await until(async()=>await mobile.locator('.offline-task-state').filter({hasText:'已记下，等电脑上线'}).count()>before,'phone submission receipt');};
  await mobile.getByRole('combobox',{name:'离线对话列表'}).click();await mobile.getByRole('option').filter({hasText:'最近对话'}).first().click();
  await submit('只读取当前目录的 s7-notes.txt，用 read 工具读取，告诉我第一行是什么。不要写文件。');await submit('在当前目录新建 s7-canceled.txt，写入“这件事已取消”。');
  await mobileShots('waiting-message');await mobile.getByRole('button',{name:'切换会话侧栏',exact:true}).click();await mobile.getByRole('button',{name:'目标',exact:true}).last().click();await until(()=>mobile.getByRole('region',{name:'等电脑上线',exact:true}).isVisible(),'waiting group');await mobileShots('waiting-goals');
  await mobileShots('cancel-confirm',async()=>{await mobile.getByRole('button',{name:/更多操作 .*s7-canceled/}).click();await mobile.getByRole('menuitem',{name:'取消这件事',exact:true}).click();});
  await mobile.getByRole('button',{name:/更多操作 .*s7-canceled/}).click();await mobile.getByRole('menuitem',{name:'取消这件事',exact:true}).click();await mobile.getByRole('button',{name:'取消这件事',exact:true}).click();await until(()=>mobile.locator('.goals-confirm').count().then(n=>n===0),'cancel receipt');
  assert.equal(f.db.prepare("SELECT ciphertext FROM offline_tasks WHERE state='canceled'").get().ciphertext,null);
  await mobile.getByRole('button',{name:/查看 .*只读取/}).click();await submit('在当前目录新建 s7-approved.txt，用 write 工具写入“已经批准”，然后读回确认。需要批准时等我批准。');
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM offline_tasks WHERE state='waiting'").get().n,2);
  assert.equal(await mobile.evaluate(()=>__s7offline.view().tasks.filter(t=>t.state==='waiting').length),2,'phone keeps accepted task references');
  await mobile.close();mobile=null;
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM offline_tasks').all()).includes('s7-notes.txt'));assert.ok(!f.logs().includes('s7-notes.txt'));
  console.log('S7: phone closed; restarting computer');await launch();report.checks.push('phone closed after two accepted tasks; cloud retained ciphertext only; cancellation deleted ciphertext');
  await until(async()=>f.db.prepare("SELECT count(*) AS n FROM offline_tasks WHERE ciphertext IS NOT NULL").get().n===0,'computer did not delete received ciphertext');
  await until(async()=> (await api(`/sessions/${sessionId}/approvals`)).approvals?.some(row=>row.status==='pending'),'native write approval',180000);
  await assert.rejects(readFile(join(workspace,'s7-approved.txt')),{code:'ENOENT'});report.modelRequests+=2;
  mobile=await browser.newPage();await mobile.goto(origin+'/personal/v1/ui/');await mobile.waitForFunction(()=>globalThis.__s7core?.state.cloudAuth?.mode==='authenticated');await mountPhone();
  await mobile.evaluate(()=>__s7core.openOfflineMode());
  await mobile.getByRole('combobox',{name:'离线对话列表'}).click();await mobile.getByRole('option').filter({hasText:'最近对话'}).first().click();await mobileShots('computer-started');
  assert.ok(await mobile.locator('.offline-task-state').filter({hasText:'电脑已开始'}).count());
  if(await mobile.getByRole('button',{name:'返回',exact:true}).last().isVisible())await mobile.getByRole('button',{name:'返回',exact:true}).last().click();await mobile.evaluate(sessionId=>__s7core.selectSession(sessionId),sessionId);
  await until(()=>mobile.getByRole('button',{name:'批准',exact:true}).isVisible(),'phone approval visible');await mobileShots('approval');await mobile.getByRole('button',{name:'批准',exact:true}).click();
  await until(async()=>readFile(join(workspace,'s7-approved.txt'),'utf8').catch(()=>null),'approved file not created');
  assert.equal((await readFile(join(workspace,'s7-approved.txt'),'utf8')).trim(),'已经批准');
  await until(()=>f.db.prepare("SELECT count(*) AS n FROM offline_tasks WHERE state='completed'").get().n===2,'task completions',180000);
  assert.equal((await readdir(workspace)).includes('s7-canceled.txt'),false);
  await mobile.evaluate(async()=>{await __s7view.tick();__s7core.openOfflineMode();});assert.ok(await mobile.locator('.offline-task-state').filter({hasText:'做完了'}).count());await mobileShots('completed');
  const activity=await api('/activity');const notices=activity.items.filter(row=>row.type.startsWith('task.')||row.type==='approval.pending');assert.ok(notices.length>=2);assert.ok(notices.every(row=>!JSON.stringify(row.notification).includes('s7-notes')&&!JSON.stringify(row.notification).includes('s7-approved')));
  report.notifications=notices.map(row=>({type:row.type,notification:row.notification,hasConversation:!!row.source.sessionId}));
  report.checks.push('tasks executed in original session and order; write waited for original approval; canceled task never ran; generic notifications point to conversation');
  await page.evaluate(async sessionId=>{await __s7core.selectSession(sessionId);await __s7core.refreshConversationTasks();},sessionId);
  await until(()=>page.locator('.message-task-label').filter({hasText:'在手机上离线交代'}).count(),'desktop provenance');
  for(const theme of ['light','dark'])for(const width of [1200,480]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await sleep(150);const file=`desktop-${width}-${theme}-source.png`;await page.screenshot({path:join(out,file)});report.screenshots.push(file);}
  // A real dispatch failure after the synthetic account removes its model, without any extra model call.
  const deletion=randomUUID();await api('/account/models/'+model.accountModelId,{requestId:deletion,expectedRevision:model.revision},'DELETE');await until(async()=> (await api('/account/models/by-request/'+deletion)).operation?.status==='succeeded','synthetic model removal');
  await app.close();app=null;await mobile.evaluate(async()=>{__s7core.presence.failure({code:'HOST_OFFLINE'});await __s7view.tick();__s7core.openOfflineMode();});
  await submit('电脑上线后，请读取 s7-notes.txt。这是模型已移除的合成失败验证。');await launch();
  await until(()=>f.db.prepare("SELECT count(*) AS n FROM offline_tasks WHERE state='failed'").get().n===1,'normal model-unavailable failure');
  await mobile.evaluate(async()=>{await __s7view.tick();await __s7offline.refreshTasks();__s7core.openOfflineMode();});
  await until(()=>mobile.locator('.offline-task-state').filter({hasText:'没做成'}).count(),'phone failure status');await mobileShots('failed');
  const finalActivity=await api('/activity'),failure=finalActivity.items.find(row=>row.type==='task.failed');assert.ok(failure?.notification.body.includes('没做成'));assert.ok(!JSON.stringify(failure.notification).includes('s7-notes.txt'));
  await mobile.evaluate(id=>document.dispatchEvent(new CustomEvent('weftmate:activity',{detail:id})),failure.id);
  await mobile.locator(`[data-activity-id="${failure.id}"]`).getByRole('button',{name:'打开对话',exact:true}).click();await mobile.waitForFunction(id=>__s7core.state.selectedSessionId===id,sessionId);
  report.checks.push('model removal failed through original dispatch; generic failure notice opened the original conversation');
  report.notifications=finalActivity.items.filter(row=>row.type.startsWith('task.')||row.type==='approval.pending').map(row=>({type:row.type,notification:row.notification,hasConversation:!!row.source.sessionId}));
  report.usage=await api('/usage');report.modelRequests=report.usage.total?.requests??report.modelRequests;report.status='passed';assert.deepEqual(errors,[]);
}catch(error){report.status='failed';report.error=sanitize(error.message);report.commitMemory=systemCommitMemory();if(page&&!page.isClosed())try{report.usage=await api('/usage');report.modelRequests=report.usage.total?.requests??report.modelRequests;}catch{}await writeFile(join(out,'failure-diagnostics.log'),diagnostics);if(mobile){report.phoneFailure=await mobile.evaluate(()=>{const v=globalThis.__s7offline?.view();return {taskErrors:globalThis.__s7taskErrors,ready:v?.ready,taskReady:v?.taskReady,snapshotKeys:Object.keys(v?.snapshot||{}),tasks:v?.tasks?.map(t=>({id:t.id,state:t.state,conversationId:t.conversationId})),generation:v?.snapshot?.generation,status:document.querySelector('.offline-composer [role=status]')?.textContent,body:document.body.innerText.slice(-3000)};}).catch(()=>null);await mobile.screenshot({path:join(out,'failure-browser.png')}).catch(()=>{});}console.error('S7:',report.error);process.exitCode=1;}
finally{
  clearInterval(clock);await browser?.close().catch(()=>{});await app?.close().catch(()=>{});for(const fn of cleanups.reverse())await fn();
  for(const abort of proxyControllers)abort.abort();modelProxy.closeAllConnections();await new Promise(done=>modelProxy.close(done));report.proxyRequests=proxyRequests;report.ledgerModelRequests=report.modelRequests;report.modelRequests=proxyRequests.model;
  report.pageErrors=errors;report.cleanup=cleanupOwnedProcesses({startedAt,executables:[process.execPath,createRequire(import.meta.url)('electron')],commandRoots:[root]});
  await appendFile(join(repo,'.local/s7-attempts.jsonl'),JSON.stringify({at:new Date().toISOString(),phoneTheme:browser?.theme??null,status:report.status,modelRequests:report.modelRequests,error:report.error??null})+'\n');
  await writeFile(join(out,browser?.theme?`verification-android-${browser.theme}.json`:'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,modelRequests:report.modelRequests,checks:report.checks}));
  if(report.status==='passed')await disposeManagedTemp(root);
}
