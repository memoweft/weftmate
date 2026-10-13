process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,readdir,unlink,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {fixture,EMAIL,PASSWORD} from '../../services/cloud/test/identity-helpers.mjs';
import {registration} from '../../services/cloud/test/app-helpers.mjs';
import {PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT} from '../../src/host-mode.mjs';
import {redactEvidenceText,cleanupOwnedProcesses,systemCommitMemory} from '../helpers/process-evidence.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=join(repo,'tests/evidence/m3-2'),startedAt=Date.now();
const root=await mkdtemp(join(tmpdir(),'weftmate-m3-2-'));await mkdir(out,{recursive:true});
const key=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim();assert.ok(key,'Machine model key required');
const pause=ms=>new Promise(done=>setTimeout(done,ms)),apps=[],cleanups=[];
const modelCounters=new Map();
const report={realElectron:2,syntheticCloud:true,modelRequests:0,checks:[],errors:[],screenshots:[],systemBarsVerified:false};
let browser,phone,cloud,stage='prepare';
async function port(){const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));const number=server.address().port;await new Promise(done=>server.close(done));return number;}
const ports=[await port(),await port()],origins=ports.map(number=>`http://127.0.0.1:${number}`),names=['synthetic-desk','synthetic-laptop'];
const address=new Map();
async function until(check,label,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await pause(250);}throw Error('Timed out: '+label);}
async function login(page){
  const previous=cloud.db.prepare('SELECT id FROM email_challenges WHERE email=? ORDER BY rowid DESC LIMIT 1').get(EMAIL)?.id;
  await page.locator('#cloud-auth-form').getByLabel('邮箱',{exact:true}).fill(EMAIL);
  await page.locator('#cloud-auth-form').getByLabel('密码',{exact:true}).fill(PASSWORD);
  await page.locator('#cloud-auth-form [type=submit]').click();
  await until(async()=>{const id=cloud.db.prepare('SELECT id FROM email_challenges WHERE email=? ORDER BY rowid DESC LIMIT 1').get(EMAIL)?.id;return id&&id!==previous;},'new email challenge');
  const row=cloud.db.prepare('SELECT id FROM email_challenges WHERE email=? ORDER BY rowid DESC LIMIT 1').get(EMAIL);
  const code=await until(async()=>{try{return await cloud.mailCode(row.id);}catch{return null;}},'synthetic mail delivery',10000);
  await page.getByLabel(/^(邮箱)?验证码$/,{exact:true}).fill(code);
  await page.locator('#cloud-auth-form [type=submit]').click();
  await page.locator('#assistant-view').waitFor({state:'visible',timeout:90000});
}
async function launch(index,restart=false){
  const profile=join(root,'computer-'+index);await mkdir(profile,{recursive:true});await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const env={...process.env};for(const name of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|CLOUD_)/.test(name)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(name))delete env[name];
  Object.assign(env,{WEFTMATE_M3_MODEL_KEY:key,WEFTMATE_TEST_HOST_NAME:names[index],WEFTMATE_CLOUD_ISSUER:cloud.config.issuer,
    WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK:'true',WEFTMATE_CLOUD_DESKTOP_CLIENT_ID:'test-native',WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI:'com.example.weftmate:/callback',WEFTMATE_CLOUD_WEB_CLIENT_ID:'test-web'});
  if(restart)env.WEFTMATE_M3_CREDENTIAL_IDS=JSON.stringify(apps.find(entry=>entry.index===index)?.credentialIds || []);
  const app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:[join(repo,'tests/integration/m3-2-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host',`--access-port=${ports[index]}`,'--force-device-scale-factor=1'],env,timeout:90000});
  const entry={app,index,profile};apps.push(entry);entry.page=await app.firstWindow({timeout:90000});entry.page.setDefaultTimeout(25000);
  entry.page.on('pageerror',error=>report.errors.push(redactEvidenceText(error.message,[root])));
  entry.page.on('response',response=>{if(response.status()>=400&&response.url().includes('/personal/v1/')){report.httpFailures??=[];report.httpFailures.push(`${index} ${response.status()} ${new URL(response.url()).pathname}`);}});
  await entry.page.addInitScript(()=>{let value;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>value,set:next=>{value=next;const create=next.create;next.create=(...args)=>{const core=create(...args);globalThis.m3Core=core;return core;};}});});
  await entry.page.waitForURL('**/personal/v1/ui');await entry.page.reload();
  // Native first-run remains the product path; skip its model tour only after
  // configuring the actual account through the same authenticated model API.
  await until(()=>entry.page.evaluate(()=>!!globalThis.m3Core?.state.csrfToken),'native local session');
  if(restart){await entry.page.locator('#assistant-view').waitFor({state:'visible'});entry.hostId=await entry.page.evaluate(()=>m3Core.state.hostId);address.set(entry.hostId,{baseUrl:origins[index],status:'online'});return entry;}
  const requestId=randomUUID();const configured=await entry.page.evaluate(async({requestId,key})=>{
    return m3Core.accessApi('/account/models',{method:'POST',protectedWrite:true,body:{requestId,name:'Synthetic MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:key}});
  },{requestId,key});assert.ok(configured);
  await until(()=>entry.page.evaluate(async requestId=>{const row=await m3Core.accessApi('/account/models/by-request/'+requestId);if(row.operation.status==='failed')throw Error(row.operation.errorCode);return row.operation.status==='succeeded';},requestId),'model configuration');
  entry.credentialIds=await app.evaluate(()=>globalThis.m3CredentialIds());
  await entry.page.evaluate(async()=>{const id=(await m3Core.accessApi('/models')).models.find(row=>row.name==='Synthetic MiMo').id;await m3Core.accessApi('/settings/models',{method:'PATCH',protectedWrite:true,body:{defaultModelProfileId:id,backgroundModelProfileId:id}});await m3Core.accessApi('/onboarding',{method:'PATCH',protectedWrite:true,body:{step:'first',completed:true}});});
  await entry.page.reload();await until(()=>entry.page.evaluate(()=>!!globalThis.m3Core?.state.csrfToken),'configured local session');
  await entry.page.evaluate(()=>m3Core.startCloudJourney());await login(entry.page);
  entry.hostId=await entry.page.evaluate(()=>m3Core.state.hostId);address.set(entry.hostId,{baseUrl:origins[index],status:'online'});
  return entry;
}
async function screenshot(page,description,desktop){
  for(const theme of ['light','dark'])for(const width of desktop?[1200,480]:[360,390]){
    const height=desktop?900:width===360?780:844;
    if(desktop)await desktop.app.evaluate(({BrowserWindow,nativeTheme},{width,height,theme})=>{nativeTheme.themeSource=theme;BrowserWindow.getAllWindows()[0].setContentSize(width,height);},{width,height,theme});
    else await page.setViewportSize({width,height});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;},theme);await pause(160);
    const file=`${desktop?'desktop':'phone-web'}-${width}-${theme}-${description}.png`;
    if(desktop){const encoded=await desktop.app.evaluate(async({BrowserWindow,desktopCapturer})=>{const win=BrowserWindow.getAllWindows()[0],handle=win.getNativeWindowHandle(),id=handle.length===8?handle.readBigUInt64LE().toString():handle.readUInt32LE().toString();const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1600,height:1200}});const source=sources.find(source=>source.id.split(':')[1]===id);if(!source||source.thumbnail.isEmpty())throw Error('Native window capture unavailable');return source.thumbnail.toPNG().toString('base64');});await writeFile(join(out,file),Buffer.from(encoded,'base64'));}
    else await page.screenshot({path:join(out,file)});report.screenshots.push({file,width,height,pageTheme:theme,systemBars:desktop?'native window overlay included':'browser viewport only'});
  }
}
async function send(page,text){await page.fill('#message-text',text);await page.locator('#send-message').click();
  await until(()=>page.evaluate(()=>m3Core.optimisticMessages?.().length>0||[...m3Core.state.historyEvents.values()].some(event=>event.type==='user.message')),'first message accepted by presentation',15000);
  await until(()=>page.evaluate(async()=>{const id=m3Core.state.selectedSessionId;if(!id)return false;const page=await m3Core.accessApi('/sessions/'+id+'/events?limit=100');return page.events?.some(event=>event.type==='turn.ended');}),'native reply ended',180000);await page.evaluate(()=>m3Core.refreshHistory());}
async function count(entry){const usage=await entry.page.evaluate(()=>m3Core.accessApi('/usage')).catch(()=>null);if(!usage)return;const count=usage.total?.requests || 0,previous=modelCounters.get(entry.index)||0;report.modelRequests+=Math.max(0,count-previous);modelCounters.set(entry.index,count);report.requestCountSource='authenticated model usage ledger, per-computer restart deltas';}
async function removeLinks(directory){for(const row of await readdir(directory,{withFileTypes:true})){const file=join(directory,row.name);if(row.isSymbolicLink())await unlink(file);else if(row.isDirectory())await removeLinks(file);}}
try {
  const relayEnv={CLOUD_RELAY_DOMAIN:'synthetic.example.com'};
  for(const field of ['CONTROL_PORT','CONTENT_PORT','PLUGIN_PORT','FRPS_PORT','FRPS_HTTPS_PORT'])relayEnv['CLOUD_RELAY_'+field]=String(await port());
  cloud=await fixture({after:fn=>cleanups.push(fn)},{env:{...relayEnv,CLOUD_OIDC_CLIENTS:JSON.stringify([{client_id:'test-native',redirect_uris:['com.example.weftmate:/callback']},{client_id:'test-web',application_type:'web',redirect_uris:origins.map(origin=>origin+'/personal/v1/ui/')}])}});
  await registration(cloud);
  const clock=setInterval(()=>cloud.advance(Math.max(0,Date.now()-cloud.now)),500);cleanups.push(()=>clearInterval(clock));
  // The local transport directory substitutes only frp/DNS. The real account,
  // nonce, token family, DPoP, host verification and command routes are used.
  cloud.identity.relay.discover=(hostId,accountId)=>{
    assert.ok(cloud.db.prepare('SELECT 1 FROM host_memberships WHERE host_id=? AND account_id=?').get(hostId,accountId));return {hostId,...(address.get(hostId)||{baseUrl:null,status:'offline'})};
  };
  stage='first-computer';const a=await launch(0);
  browser=await chromium.launch({headless:true,channel:'chrome'});phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await phone.addInitScript(()=>{let value;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>value,set:next=>{value=next;const create=next.create;next.create=(...args)=>{const core=create(...args);globalThis.m3Core=core;globalThis.m3Errors=[];globalThis.m3Sends=[];const send=core.sendDraft;core.sendDraft=(...args)=>{m3Sends.push({draftLength:document.getElementById('message-text').value.length,source:core.state.activeChatSource,main:core.inMainChat?.(),folder:!!core.folderMutationPending?.(),submitting:core.state.submitting,unresolved:core.state.unresolvedSubmission,chatAvailable:core.state.capabilities?.chat?.available,sendAvailable:core.state.sessions.find(row=>row.sessionId===core.state.selectedSessionId)?.sendAvailable});return send(...args);};const access=core.accessApi;core.accessApi=async(path,options)=>{try{return await access(path,options);}catch(error){m3Errors.push({path,code:error.code,status:error.status});throw error;}};return core;};}});
    for(const [property,method,target] of [['WeftOffline','create','m3Offline'],['WeftOfflineView','mount','m3OfflineView']]){let module;Object.defineProperty(globalThis,property,{configurable:true,get:()=>module,set:next=>{module=next;const original=next[method];next[method]=(...args)=>{const result=original(...args);if(result?.then)return result.then(value=>{globalThis[target]=value;return value;});globalThis[target]=result;return result;};}});}
  });
  phone.on('pageerror',error=>report.errors.push(redactEvidenceText(error.message,[root])));await phone.goto(origins[0]+'/personal/v1/ui/');await login(phone);
  const watcher=setInterval(async()=>{try{const view=await phone.evaluate(()=>({selectedSessionId:m3Core.state.selectedSessionId,selectedChatId:m3Core.state.selectedChatId,newConversation:m3Core.state.newConversation,unresolved:m3Core.state.unresolvedSubmission,submitting:m3Core.state.submitting,selecting:m3Core.state.sessionSelecting,sideCreating:!!m3Core.state.sideCreating,button:document.getElementById('send-message').dataset.action,textLength:document.getElementById('message-text').value.length,session:m3Core.state.sessions.find(row=>row.sessionId===m3Core.state.selectedSessionId),pending:m3Core.optimisticMessages?.().map(row=>({status:row.status,sessionId:row.sessionId})),errors:m3Errors.slice(-8)}));await writeFile(join(repo,'.local/m3-2/live-state.json'),redactEvidenceText(JSON.stringify({stage,view},null,2),[root]));}catch{}},3000);cleanups.push(()=>clearInterval(watcher));
  assert.equal(await phone.locator('#computer-choice').isVisible(),false);await screenshot(phone,'single-computer');report.checks.push('one computer: selector hidden');
  if(process.env.M3_2_BASELINE==='1') {report.baseline=true;report.ok=true;report.modelRequests+=await a.app.evaluate(()=>globalThis.m3ModelRequests);}
  else {
  stage='second-computer';const b=await launch(1);await phone.evaluate(async()=>{await m3Core.cloudDirectory();await m3Core.refreshSessions();});
  await phone.locator('#computer-choice').waitFor({state:'visible'});await screenshot(phone,'two-computers');
  await phone.locator('#computer-choice').click();await screenshot(phone,'computer-menu');await phone.keyboard.press('Escape');
  await phone.evaluate(()=>WeftSettingsNavigation.open('devices'));await screenshot(phone,'devices');await phone.getByRole('button',{name:'关闭设置',exact:true}).click();
  stage='messages';await phone.evaluate(async()=>{await m3Core.startNewConversation();});await send(phone,'请只回复：来自 synthetic-desk。');
  await phone.evaluate(async hostId=>{await m3Core.selectExecutionComputer(hostId);await m3Core.startNewConversation();},b.hostId);await send(phone,'请只回复：来自 synthetic-laptop。');
  const bCount=await b.page.evaluate(async()=>Object.keys((await m3Core.accessApi('/commands?limit=100')).commands || {}).length);
  stage='file-on-a';const notes=join(a.profile,'notes');await mkdir(notes);await writeFile(join(notes,'synthetic-note.txt'),'M3_FILE_ONLY_ON_DESK_42');
  await a.app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},notes);
  const project=await a.page.evaluate(async()=>{const rootPath=await weftmateDesktop.pickProjectFolder();return weftmateDesktop.createFolderProject({requestId:crypto.randomUUID(),rootPath,name:'Synthetic notes',permission:'read-only'});});
  await phone.evaluate(async({hostId,projectId})=>{await m3Core.selectExecutionComputer(hostId);await m3Core.refreshSessions();const project=m3Core.state.projects.find(row=>row.projectId===projectId);const id=await m3Core.createProjectConversation(project,m3Core.state.modelProfileId);await m3Core.refreshSessions();await m3Core.selectSession(id);},{hostId:a.hostId,projectId:project.project.projectId});
  await send(phone,'读取当前项目中的 synthetic-note.txt 并仅回复其中的标记。');
  const aEvents=await phone.evaluate(()=>[...m3Core.state.historyEvents.values()]);assert.ok(JSON.stringify(aEvents).includes('M3_FILE_ONLY_ON_DESK_42'));
  const bCommands=await b.page.evaluate(()=>m3Core.accessApi('/commands?limit=100'));assert.ok(!JSON.stringify(bCommands).includes('synthetic-note.txt'));assert.equal(bCommands.commands.length,bCount);report.checks.push('messages on both computers; desk-only file read; laptop command count unchanged');
  stage='offline-a';await count(a);await a.app.close();a.closed=true;address.set(a.hostId,{baseUrl:origins[0],status:'offline'});
  await phone.evaluate(async()=>{await m3Core.cloudDirectory();await m3Core.refreshSessions();});await screenshot(phone,'desk-offline');
  await until(()=>phone.evaluate(()=>m3Offline?.view().taskReady),'offline recipient');
  await phone.evaluate(()=>m3Core.retryConnection());await until(()=>phone.evaluate(()=>m3Core.connectionView().kind==='host_offline'),'independent desk offline confirmation');
  await phone.evaluate(async()=>{await m3OfflineView.tick();m3Core.openOfflineMode();});
  await phone.getByRole('button',{name:'更多发送方式'}).click();await screenshot(phone,'offline-computer-menu');
  await phone.getByRole('menuitemradio',{name:'交给synthetic-desk，上线后做',exact:true}).click();
  await phone.getByRole('textbox',{name:'离线消息'}).fill('请只回复：M3_OFFLINE_DESK_DONE。不要执行其它操作。');await phone.getByRole('button',{name:'记下来',exact:true}).click();
  await until(()=>cloud.db.prepare("SELECT count(*) AS n FROM offline_tasks WHERE host_id=? AND state='waiting'").get(a.hostId).n===1,'desk task queued');await screenshot(phone,'offline-task-waiting');
  stage='restart-a';const recovered=await launch(0,true);assert.equal(recovered.hostId,a.hostId);
  await until(()=>cloud.db.prepare("SELECT count(*) AS n FROM offline_tasks WHERE host_id=? AND state='completed'").get(a.hostId).n===1,'desk task completed',180000);
  await count(recovered);report.checks.push('desk offline task queued to desk and completed after restart with stable identity');
  await phone.evaluate(async()=>{await m3Core.cloudDirectory();await m3OfflineView.tick();});await screenshot(phone,'offline-task-completed');
  stage='remove-b';await phone.evaluate(hostId=>m3Core.cloudRemoveComputer(hostId),b.hostId);await screenshot(phone,'computer-removed');
  await b.page.reload();await until(()=>b.page.evaluate(()=>!!m3Core.state.csrfToken),'removed computer local use');report.checks.push('removed computer remains locally usable');
  await screenshot(b.page,'local-after-removal',b);await count(b);
  assert.deepEqual(report.errors,[]);report.ok=true;
  }
}catch(error){report.ok=false;report.stage=stage;report.failure=redactEvidenceText(error.stack,[root]).replaceAll(key,'[private]');report.systemCommit=systemCommitMemory();
  report.states=[];for(const entry of apps){try{report.states.push(await entry.page.evaluate(()=>({auth:m3Core.cloudAuthView(),status:m3Core.state.currentView,text:document.body.innerText.slice(-3000)})));}catch{}}
  if(phone)try{report.phone=await phone.evaluate(()=>({hostId:m3Core.state.hostId,ownerId:m3Core.state.ownerId,selectedSessionId:m3Core.state.selectedSessionId,model:m3Core.state.modelProfileId,online:m3Core.state.online,pending:m3Core.optimisticMessages?.(),errors:m3Errors,sends:m3Sends,form:{valid:document.getElementById('message-form').checkValidity(),invalid:[...document.getElementById('message-form').elements].filter(el=>!el.checkValidity()).map(el=>({id:el.id,message:el.validationMessage})),type:document.getElementById('send-message').type,form:document.getElementById('send-message').form?.id},text:document.body.innerText.slice(-4000)}));}catch{}
  if(phone)await phone.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw error;}
finally {
  for(const entry of apps)if(!entry.closed){try{await count(entry);await entry.app.close();}catch{}}
  await browser?.close();for(const cleanup of cleanups.reverse())await cleanup();
  report.cleanup=cleanupOwnedProcesses({startedAt,executables:[process.execPath,createRequire(import.meta.url)('electron')],commandRoots:[root,join(repo,'tests/integration/m3-2-bootstrap.mjs')]});await removeLinks(root);await rm(root,{recursive:true,force:true});
  await writeFile(join(out,'electron-report.json'),redactEvidenceText(JSON.stringify(report,null,2),[root,cloud?.root].filter(Boolean)).replaceAll(key,'[private]')+'\n');
}
