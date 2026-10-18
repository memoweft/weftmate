import { requireMemoWeftPath } from '../helpers/memoweft-environment.mjs';
import { evidencePath } from '../helpers/evidence-path.mjs';
// Synthetic local cloud + actual production Electron/DSH, with a durable Windows vault.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, writeFile, readFile, appendFile, readdir, rm, stat, cp, mkdtemp, lstat, unlink } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { managedTempRoot } from '../helpers/managed-temp.mjs';
import { redactEvidenceText, cleanupOwnedProcesses, systemCommitMemory, describeExit } from '../helpers/process-evidence.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { fixture, P, PASSWORD } from '../../services/cloud/test/identity-helpers.mjs';
import { openDatabase } from '../../services/cloud/src/database.mjs';
import { loadConfig } from '../../services/cloud/src/config.mjs';
import { createIdentity } from '../../services/cloud/src/identity.mjs';
import { createCloudServer } from '../../services/cloud/src/server.mjs';
import { createMailer } from '../../services/cloud/src/mail.mjs';
import { createLogger } from '../../services/cloud/src/log.mjs';
import { digest } from '../../services/cloud/src/security.mjs';
import { registration, appDevice, proof, refresh } from '../../services/cloud/test/app-helpers.mjs';
const repo = resolve(import.meta.dirname, '../..'), evidence = evidencePath('s4'), startedAt = Date.now();
const root = process.env.WEFTMATE_S4_RESUME_ROOT ? resolve(process.env.WEFTMATE_S4_RESUME_ROOT) : await mkdtemp(join(managedTempRoot(), 'wm-s4-')), originalProfile = join(root, 'original'), newProfile = join(root, 'new-computer');
const electron = createRequire(import.meta.url)('electron'), orchestrator = 'D:/AIProjects/WeftMate/Runtime/Orchestrator';
const key = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command', "[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"], {encoding:'utf8',windowsHide:true}).trim();
assert.ok(key, 'MiMo machine environment credential is required');
let secret = 'S4_SYNTHETIC_SAVED_MODEL_KEY_' + randomUUID();
const distinctive = '我每周星期二早餐一直吃蒸紫薯。';
const report = { syntheticCloud:true,realElectron:true,realDSH:true,durableSystemVault:true,model:'mimo-v2.6-flash',checks:[],screenshots:[],pageErrors:[],modelRequests:0 };
const cleanups = [], controllers = new Set(), proxyRequests = { model:0,catalog:0,upstreamCatalog:0,statuses:{} };
let catalogCache=null;
const backupWire=[];
let f, device, newDevice, app, page, activeProfile, origin, hostId, clock, recoveryCode, sessionId, model, heavyLock, diagnostics='', uploadGate=null, blockedUploads=0, uploadIndices=[];
let cloudRequests=0, downloadFault=false;
const pause = ms => new Promise(done=>setTimeout(done,ms));
const sanitize = text => redactEvidenceText(String(text).replaceAll(key,'[private-model]').replaceAll(secret,'[synthetic-model-credential]'),[root]);
async function until(fn,label,timeout=120000) {
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=await fn();if(value)return value;await pause(350);}
  throw Error(label);
}
async function acquireHeavy() {
  const tag = `S4 ${randomUUID()} ${new Date().toISOString()} real Electron cloud backup\n`;
  while(!heavyLock) {
    for(let index=1;index<=3;index++) {
      const file=join(orchestrator,`heavy-${index}.lock`);
      try {await writeFile(file,tag,{flag:'wx'});heavyLock={file,tag,acquiredAt:Date.now()};break;}
      catch(error){if(error.code!=='EEXIST')throw error;const info=await stat(file).catch(()=>null);if(info&&Date.now()-info.mtimeMs>45*60000)await rm(file,{force:true});}
    }
    if(!heavyLock){console.log('S4: waiting for a heavy-work slot');await pause(120000);}
  }
  report.heavySlot=heavyLock.file.match(/heavy-\d+/)[0];console.log('S4: heavy-work slot acquired');
}
async function releaseHeavy() {
  if(!heavyLock)return;
  if(await readFile(heavyLock.file,'utf8').catch(()=>null)===heavyLock.tag)await rm(heavyLock.file,{force:true});
  report.heavyMinutes=Math.round((Date.now()-heavyLock.acquiredAt)/6000)/10;heavyLock=null;
}
async function removeOwnRoot() {
  if(!resolve(root).startsWith(resolve(managedTempRoot())+sep)||(await lstat(root)).isSymbolicLink())throw Error('S4 fixture cleanup boundary changed');
  async function detach(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const target=join(directory,entry.name),info=await lstat(target);if(info.isSymbolicLink())await unlink(target);else if(info.isDirectory())await detach(target);}}
  await detach(root);await rm(root,{recursive:true,force:true});
}
const modelProxy=createServer(async(req,res)=>{
  if(!['/v1/chat/completions','/v1/models'].includes(req.url)){res.writeHead(404).end();return;}
  if(req.url==='/v1/models'&&catalogCache){proxyRequests.catalog++;res.writeHead(catalogCache.status,{'content-type':catalogCache.type});res.end(catalogCache.bytes);return;}
  const controller=new AbortController();controllers.add(controller);res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try {
    const body=req.method==='POST'?Buffer.concat(await Array.fromAsync(req)):undefined;
    proxyRequests[body?'model':'catalog']++;
    const upstream=await fetch('https://api.xiaomimimo.com'+req.url,{method:req.method,headers:{'content-type':'application/json',authorization:'Bearer '+key},body,signal:controller.signal});
    proxyRequests.statuses[upstream.status]=(proxyRequests.statuses[upstream.status]??0)+1;
    if(!body){proxyRequests.upstreamCatalog++;catalogCache={status:upstream.status,type:upstream.headers.get('content-type')??'application/json',bytes:Buffer.from(await upstream.arrayBuffer())};res.writeHead(catalogCache.status,{'content-type':catalogCache.type});res.end(catalogCache.bytes);return;}
    res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});
    if(upstream.body)await pipeline(Readable.fromWeb(upstream.body),res);else res.end();
  }catch{if(!res.headersSent)res.writeHead(502);res.end();}finally{controllers.delete(controller);}
});
await mkdir(evidence,{recursive:true});await mkdir(join(repo,'.local'),{recursive:true});
const previousMemoryConfig=process.env.WEFTMATE_S4_RESUME_ROOT?JSON.parse(await readFile(join(root,'memory-config.json'),'utf8')):null;
await new Promise((done,reject)=>{modelProxy.once('error',reject);modelProxy.listen(previousMemoryConfig?Number(new URL(previousMemoryConfig.baseUrl).port):0,'127.0.0.1',done);});
const memoryConfig=join(root,'memory-config.json');
await writeFile(memoryConfig,JSON.stringify({python:requireMemoWeftPath('python'),pythonPath:requireMemoWeftPath('source'),baseUrl:`http://127.0.0.1:${modelProxy.address().port}/v1`,model:'@current',authRef:'fixture'}));
function environment(cloud=f) {
  return {...Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('WEFTMATE_')&&!name.startsWith('MEMOWEFT_')&&!['MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY','ELECTRON_RUN_AS_NODE'].includes(name))),WEFTMATE_TEST_HOST_NAME:'synthetic-host',WEFTMATE_S4_FIXTURE_ROOT:root,WEFTMATE_S4_DIAGNOSTICS:join(root,'diagnostics.jsonl'),WEFTMATE_CLOUD_ISSUER:cloud.config.issuer,WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK:'true',WEFTMATE_CLOUD_WEB_CLIENT_ID:'test-native'};
}
async function launch(profile=originalProfile,cloud=f) {
  if(heavyLock&&Date.now()-heavyLock.acquiredAt>26*60000)throw Error('S4 heavy-work run reached its 26 minute budget');
  await mkdir(profile,{recursive:true});await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));activeProfile=profile;
  console.log('S4: launching '+(profile===originalProfile?'original computer':profile===newProfile?'new computer':'compatibility computer'));
  app=await _electron.launch({executablePath:electron,cwd:repo,args:[join(repo,'tests/integration/s4-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0',`--personal-memory-config=${memoryConfig}`],env:environment(cloud),timeout:90000});
  app.process().stdout?.on('data',value=>diagnostics=(diagnostics+sanitize(value)).slice(-50000));app.process().stderr?.on('data',value=>diagnostics=(diagnostics+sanitize(value)).slice(-50000));
  app.process().on('exit',(code,signal)=>report.lastElectronExit=describeExit(code,signal));
  await app.context().addInitScript(()=>{
    let api;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set:value=>{api=value;const create=value.create;value.create=options=>{const core=create(options);globalThis.__s4core=core;globalThis.__s4ui=options.effects;return core;};}});
    window.print=()=>{};
    const append=Element.prototype.append;
    Element.prototype.append=function(...nodes){const result=append.apply(this,nodes);for(const node of nodes)if(node?.tagName==='IFRAME'&&node.classList.contains('cloud-recovery-print')&&node.contentWindow)node.contentWindow.print=()=>{globalThis.__s4Printed=true;};return result;};
  });
  page=await until(()=>app.windows().find(window=>window.url().includes('/personal/v1/ui')),'Electron did not reach the application',90000);
  await app.evaluate(({BrowserWindow},root)=>{globalThis.__s4downloads=[];for(const window of BrowserWindow.getAllWindows())window.webContents.session.on('will-download',(_event,item)=>{globalThis.__s4downloads.push({filename:item.getFilename(),state:'started'});item.setSavePath(root+'/synthetic-recovery-code.txt');item.once('done',(_event,state)=>globalThis.__s4downloads.at(-1).state=state);});},root.replaceAll('\\','/'));
  page.on('pageerror',error=>report.pageErrors.push(sanitize(error.message)));
  await page.waitForFunction(()=>globalThis.__WeftUiStarted,{timeout:90000});
  if(!await page.evaluate(()=>!!globalThis.__s4core))await page.reload();
  await page.waitForFunction(()=>globalThis.__s4core?.state.account,{timeout:90000});
  origin=new URL(page.url()).origin;hostId=(await api('/status')).hostId;
}
async function api(path,body,method=body===undefined?'GET':'POST') {
  return page.evaluate(async({path,body,method})=>{try{return await __s4core.accessApi(path,{method,...(body===undefined?{}:{body,protectedWrite:true})});}catch(error){throw Error(JSON.stringify({code:error?.code,status:error?.status,details:error?.details,path}));}},{path,body,method});
}
async function bind(cloud=f,current=device) {
  if(decodeJwt(current.tokens.access_token).exp*1000-cloud.now<60000)await refresh(current,cloud.config.audience);
  if(process.env.WEFTMATE_S4_RESUME_ROOT&&activeProfile===originalProfile){const claim=await api('/cloud/claims',{});await api('/cloud/binding',{claimId:claim.claimId,accessToken:current.tokens.access_token});await page.evaluate(()=>__s4core.enterAssistant());await until(async()=>{const state=await api('/backups/cloud');return state.available;},'explicit synthetic rebind failed');return{bound:true};}
  const nonce=await api('/auth/cloud-nonce',{}),dpop=await proof(current,origin+'/personal/v1/auth/cloud-desktop',current.tokens.access_token,{nonce:nonce.nonce},'POST',cloud.now);
  const response=await page.evaluate(async({origin,dpop,token})=>{
    const reply=await weftmateDesktop.fetchPersonal(origin+'/personal/v1/auth/cloud-desktop',{method:'POST',headers:{'content-type':'application/json',dpop,'x-weftmate-csrf':__s4core.state.csrfToken},body:JSON.stringify({accessToken:token,deviceName:'synthetic-host'})},crypto.randomUUID());
    if(reply.status!==200)throw Error(JSON.stringify(reply.body));__s4core.acceptSession(reply.body);return reply.body;
  },{origin,dpop,token:current.tokens.access_token});
  await until(async()=>{const result=await api('/backups/cloud');return result.available===true||result.reason==='CLOUD_BACKUP_UNAVAILABLE';},'cloud backup capability did not settle');
  return response;
}
async function command(body) {
  const {command}=await api('/commands',{requestId:randomUUID(),targetDeviceId:hostId,...body});
  return until(async()=>{const row=(await api('/commands/'+command.commandId)).command;return ['pending','dispatching'].includes(row.state)?null:row;},'native command did not finish dispatching');
}
async function message(text) {
  const before=(await api(`/sessions/${sessionId}/events?limit=200`)).events.filter(row=>row.type==='turn.ended').length;
  const result=await command({kind:'session.message',sessionId,text});assert.equal(result.state,'accepted_by_dsh');
  await until(async()=>{const events=(await api(`/sessions/${sessionId}/events?limit=200`)).events;return events.filter(row=>row.type==='turn.ended').length>before&&events;},'MiMo turn did not complete',180000);
  await until(async()=>!(await api('/sessions')).sessions.some(row=>row.sessionId===sessionId&&row.running),'native turn still busy',30000);
}
async function settings() {
  await page.evaluate(()=>{__s4ui.openSettings('backups');__s4ui.showSettingsBackups();});
  await page.getByRole('region',{name:'云端备份',exact:true}).scrollIntoViewIfNeeded();
  await until(()=>page.getByRole('region',{name:'云端备份',exact:true}).getAttribute('aria-busy').then(v=>v==='false'),'backup state did not refresh');
}
async function closeSettings() {
  await page.evaluate(()=>__s4ui.hideSettingsDialog());
  await page.evaluate(()=>__s4core.enterAssistant());
}
async function shots(state,prepare=async()=>{}) {
  for(const theme of ['light','dark'])for(const width of [1200,480]) {
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await prepare();await pause(250);
    const file=`desktop-${width}-${theme}-${state}.png`;await page.screenshot({path:join(evidence,file)});report.screenshots.push(file);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow in '+state);
  }
}
async function enableFromUI() {
  await settings();await page.getByRole('button',{name:'开启云端备份',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'保存恢复码',exact:true});await dialog.waitFor();
  const groups=await dialog.locator('.cloud-recovery-code code').allTextContents();assert.equal(groups.length,8);recoveryCode=groups.join('-');
  await shots('enable-recovery-code');
  await dialog.getByRole('button',{name:'复制',exact:true}).click();
  await dialog.getByRole('button',{name:'保存成文件',exact:true}).click();
  try {await until(async()=>readFile(join(root,'synthetic-recovery-code.txt'),'utf8').then(text=>text.includes(recoveryCode)).catch(()=>false),'synthetic recovery code was not saved',10000);}
  catch(error){report.downloadDiagnostics=await app.evaluate(()=>globalThis.__s4downloads);throw error;}
  await dialog.getByRole('button',{name:'打印',exact:true}).click();assert.equal(await page.evaluate(()=>__s4Printed),true);
  const field=dialog.getByRole('textbox'),label=await field.getAttribute('aria-label'),group=Number(/第 (\d+) 组/.exec(label)[1]);
  await field.fill(groups[group-1]);await dialog.getByRole('button',{name:'已保存，开启备份',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal((await api('/backups/cloud')).enabled,true);
}
async function restoreDialog(backupId) {
  const prompt=page.getByRole('complementary',{name:'发现云端备份',exact:true});
  if(await prompt.isVisible())await prompt.getByRole('button',{name:'恢复',exact:true}).click();
  else {await settings();await page.getByRole('list',{name:'云端备份列表',exact:true}).getByRole('button',{name:'恢复',exact:true}).first().click();}
  const dialog=page.getByRole('dialog',{name:'恢复云端备份',exact:true});await dialog.waitFor();return dialog;
}
async function finishRun() {
  await until(async()=>{await pause(1000);const result=await api('/backups/cloud');if(!result.busy&&result.status?.state==='failed')throw Error('cloud upload failed: '+result.status.code);return !result.busy&&result.status?.state==='succeeded'&&result;},'cloud upload did not finish',180000);
}
async function persistentCloud() {
  const directory=join(root,'synthetic-cloud'),portFile=join(root,'cloud-port.json');await mkdir(directory,{recursive:true});
  const priorPort=await readFile(portFile,'utf8').then(JSON.parse).catch(()=>0),opened=await openDatabase(join(directory,'cloud.sqlite'));
  let identity,clockValue=Date.now(),logs='';const logger=createLogger({stream:{write:value=>logs+=value}});
  const server=createCloudServer({...opened,logger,identity:{handle:(...args)=>identity.handle(...args)}});
  server.on('request',request=>{if(request.url.startsWith(P+'/backups/'))cloudRequests++;});
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(priorPort,'127.0.0.1',done);});const port=server.address().port;await writeFile(portFile,JSON.stringify(port));
  const config=loadConfig({CLOUD_DATA_DIR:directory,CLOUD_PORT:String(port),CLOUD_ISSUER:`http://127.0.0.1:${port}${P}/oidc`,CLOUD_BACKUP_ACCOUNT_BYTES:String(5*1024*1024),CLOUD_OIDC_CLIENTS:JSON.stringify([{client_id:'test-native',redirect_uris:['com.example.weftmate:/callback']}])});
  identity=await createIdentity({database:opened.database,config,mailer:createMailer(config,{logger}),logger,now:()=>clockValue});const origin=`http://127.0.0.1:${port}`;
  if(process.env.WEFTMATE_S4_RESUME_ROOT){assert.equal(config.mailTransport,'file');assert.ok(opened.database.prepare("SELECT count(*) AS n FROM cloud_accounts WHERE active=1 AND email<>'account@example.com'").get().n===0);opened.database.prepare("DELETE FROM failure_limits WHERE key LIKE 'delivery:%'").run();report.syntheticFileMailCountersReset=true;}
  function browser(){const cookies=new Map();return async(route,{method='GET',body,form,headers={},status}={})=>{const response=await fetch(route.startsWith('http')?route:origin+route,{method,redirect:'manual',headers:{accept:'application/json',cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...(method==='POST'?{origin,'content-type':form?'application/x-www-form-urlencoded':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:form?{body:new URLSearchParams(form)}:{})});for(const cookie of response.headers.getSetCookie()){const head=cookie.split(';')[0],i=head.indexOf('=');cookies.set(head.slice(0,i),head.slice(i+1));}const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}if(status!==undefined&&status!==null)assert.equal(response.status,status,`${method} ${route}: ${text}`);return{status:response.status,data,headers:response.headers};};}
  cleanups.push(async()=>{await identity.relay?.close();await identity.accounts.settleMail();await new Promise(done=>{server.close(done);server.closeAllConnections();});opened.database.close();});
  return{root:directory,origin,config,identity,db:opened.database,browser,api:browser(),get now(){return clockValue;},advance:ms=>clockValue+=ms,logs:()=>logs,
    confirm:async(interaction,id)=>interaction.client(P+'/auth/device/confirm',{method:'POST',body:{interactionUid:interaction.interactionUid,csrfToken:interaction.csrfToken,challengeId:id,code:await f.mailCode(id)}}),
    mailCode:async id=>{await identity.accounts.settleMail();const challenge=opened.database.prepare('SELECT * FROM email_challenges WHERE id=?').get(id);for(const name of await readdir(config.mailDir)){if(!name.endsWith('.json'))continue;const mail=JSON.parse(await readFile(join(config.mailDir,name),'utf8'));if(mail.to!==challenge.email)continue;const code=/验证码：(\d{6})/.exec(mail.text)?.[1];if(code&&digest(identity.keys.cookieSecret,`${id}:${code}`)===challenge.code_hash)return code;}throw Error('Synthetic login mail is missing');}};
}
async function compatibility() {
  const baseline='c1e96a36', checkout=join(root,'old-cloud'), prefix='services/cloud/';
  const files=execFileSync('git',['ls-tree','-r','--name-only',baseline,'services/cloud'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(name=>name.startsWith(prefix));
  for(const name of files){const target=join(checkout,name.slice(prefix.length));await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',`${baseline}:${name}`],{cwd:repo,maxBuffer:4*1024*1024}));}
  await cp(join(repo,'services/cloud/node_modules'),join(checkout,'node_modules'),{recursive:true,dereference:true});
  const oldHelpers=await import(pathToFileURL(join(checkout,'test/identity-helpers.mjs')).href),oldApp=await import(pathToFileURL(join(checkout,'test/app-helpers.mjs')).href);
  let requests=0;
  f=await oldHelpers.fixture({after:fn=>cleanups.push(fn)},{observeRequest:url=>{if(url.startsWith(P+'/backups/'))requests++;}});
  await oldApp.registration(f);device=await oldApp.appDevice(f,'compatibility-desktop');clock=setInterval(()=>f.advance(Math.max(0,Date.now()-f.now)),500);
  await acquireHeavy();await launch(join(root,'old-cloud-computer'));await bind();
  await api('/onboarding',{step:'first',completed:true},'PATCH');await page.reload();await page.waitForFunction(()=>globalThis.__s4core?.state.account);
  const health=(await f.api('/healthz')).data;assert.equal(health.schemaVersion,9);assert.equal(health.capabilities?.cloudBackup,undefined);
  const status=await api('/backups/cloud');assert.equal(status.available,false);assert.equal(status.reason,'CLOUD_BACKUP_UNAVAILABLE');
  await settings();await page.getByRole('region',{name:'云端备份',exact:true}).getByRole('status').filter({hasText:'暂不可用'}).waitFor();await shots('old-cloud-unavailable',settings);
  await pause(1500);assert.equal(requests,0);assert.deepEqual(report.pageErrors,[]);
  report.oldCloud={baseline,schemaVersion:health.schemaVersion,backupRequests:requests,showsUnavailable:true};report.checks.push('actual schema 9 cloud source: authenticated desktop shows unavailable, sends zero backup endpoint requests and emits no UI errors');report.status='passed';
}
async function diagnoseExisting() {
  f=await fixture({after:fn=>cleanups.push(fn)},{env:{CLOUD_BACKUP_ACCOUNT_BYTES:String(5*1024*1024)}});await registration(f);device=await appDevice(f,'desktop');clock=setInterval(()=>f.advance(Math.max(0,Date.now()-f.now)),500);
  await acquireHeavy();await launch(originalProfile);await api('/cloud/binding',{},'DELETE');await bind();
  await page.evaluate(()=>__s4core.enterAssistant());await enableFromUI();
  try{await api('/backups/cloud/run',{});report.checks.push('existing synthetic profile captured and uploaded successfully');report.status='passed';}
  catch(error){report.captureDiagnostics=await readFile(join(root,'diagnostics.jsonl'),'utf8').then(sanitize).catch(()=>null);throw error;}
}
async function resumeTail() {
  const previous=JSON.parse(await readFile(join(evidence,'verification.json'),'utf8'));for(const name of ['before','after','firstBackup','wireScan'])report[name]=previous[name];report.checks=[...(previous.checks??[])];
  f=await persistentCloud();newDevice=await appDevice(f,'new-desktop');clock=setInterval(()=>f.advance(Math.max(0,Date.now()-f.now)),500);
  const handler=f.identity.handle;f.identity.handle=async(req,res)=>{if(req.url===P+'/backups/chunk/upload'){const bytes=Buffer.concat(await Array.fromAsync(req));const payload=decodeJwt(JSON.parse(bytes.toString()).proof);uploadIndices.push(payload.index);const stream=Readable.from([bytes]);stream.headers=req.headers;stream.socket=req.socket;stream.url=req.url;stream.method=req.method;return handler.call(f.identity,stream,res);}return handler.call(f.identity,req,res);};
  await acquireHeavy();await launch(newProfile);await bind(f,newDevice);await finishTail();assert.deepEqual(report.pageErrors,[]);report.status='passed';
}
async function wireOnly() {
  f=await persistentCloud();await registration(f);device=await appDevice(f,'desktop');clock=setInterval(()=>f.advance(Math.max(0,Date.now()-f.now)),500);
  const decodedBodies=[],uploadedCiphertexts=[],handler=f.identity.handle;
  f.identity.handle=async(req,res)=>{if(req.url.startsWith(P+'/backups/')){const parts=[];req.on('data',bytes=>{const data=Buffer.from(bytes);parts.push(data);backupWire.push(data);});req.on('end',()=>{const body=JSON.parse(Buffer.concat(parts).toString());const payload=body.proof?decodeJwt(body.proof):body;decodedBodies.push(Buffer.from(JSON.stringify(payload)));if(req.url===P+'/backups/chunk/upload')uploadedCiphertexts.push(Buffer.from(payload.ciphertext,'base64url'));});}return handler.call(f.identity,req,res);};
  await acquireHeavy();await launch();await bind();
  await api('/onboarding',{step:'first',completed:true},'PATCH');await api('/settings/personalization',{nextSuggestionsEnabled:false,inlineCompletionEnabled:false},'PATCH');
  await api('/settings/notifications',{memoryDigestEnabled:false,reviewEnabled:false},'PATCH');await api('/backups/settings',{enabled:false,directory:join(root,'local-backups'),dailyDays:7,weeklyCopies:4},'PATCH');
  const requestId=randomUUID();await api('/account/models',{requestId,name:'Synthetic S4 MiMo',baseUrl:`http://127.0.0.1:${modelProxy.address().port}/v1`,modelId:'mimo-v2.6-flash',apiKey:secret,modelTier:'cloud'});
  await until(async()=>{const row=(await api('/account/models/by-request/'+requestId)).operation;return row?.status==='succeeded';},'wire fixture model configuration failed');
  model=(await api('/models')).models.find(row=>row.name==='Synthetic S4 MiMo');await api('/settings/models',{defaultModelProfileId:model.id,backgroundModelProfileId:model.id},'PATCH');
  sessionId=(await command({kind:'session.create',modelProfileId:model.id})).sessionId;await api(`/sessions/${sessionId}/metadata`,{title:distinctive},'PATCH');
  await page.reload();await page.waitForFunction(()=>globalThis.__s4core?.state.account);await enableFromUI();await api('/backups/cloud/run',{});
  const listing=await api('/backups/cloud'),backup=listing.items[0];assert.ok(backup);await shots('backup-status',settings);
  const raw=Buffer.concat(backupWire),decoded=Buffer.concat(decodedBodies),upload=Buffer.concat(uploadedCiphertexts),stored=Buffer.concat(f.db.prepare('SELECT ciphertext FROM cloud_backup_chunks').all().map(row=>Buffer.from(row.ciphertext)));
  for(const [name,bytes]of Object.entries({rawRequestBodies:raw,decodedSignedPayloads:decoded,uploadedCiphertext:upload,storedCiphertext:stored})){assert.ok(!bytes.includes(Buffer.from(distinctive)),name+' contains the synthetic sentence');assert.ok(!bytes.includes(Buffer.from(secret)),name+' contains the synthetic model credential');assert.ok(!bytes.includes(Buffer.from(recoveryCode)),name+' contains the synthetic recovery code');}
  assert.equal(upload.length,backup.totalBytes);assert.equal(stored.length,backup.totalBytes);assert.equal(uploadedCiphertexts.length,backup.chunkCount);assert.equal(proxyRequests.model,0);
  report.wireScan={rawRequestBodyBytes:raw.length,decodedSignedPayloadBytes:decoded.length,uploadedCiphertextBytes:upload.length,storedCiphertextBytes:stored.length,chunks:backup.chunkCount,containsUploadedCiphertext:true,conversationPlaintextAbsent:true,syntheticModelCredentialAbsent:true,recoveryCodeAbsent:true};
  report.visualSupplement=true;report.replacesMimoRestoreProof=false;report.checks.push('complete real Electron upload: all raw backup request bodies, decoded signed payloads, uploaded ciphertext and stored ciphertext scanned with exact byte counts; zero model inference');
  await app.close();app=null;await launch(newProfile);const second=await appDevice(f,'wire-new-desktop');await bind(f,second);await api('/onboarding',{step:'first',completed:true},'PATCH');await page.reload();await page.waitForFunction(()=>globalThis.__s4core?.state.account);await page.evaluate(async()=>{await __s4core.enterAssistant();await __s4ui.checkCloudBackupPrompt();});
  await page.getByRole('complementary',{name:'发现云端备份',exact:true}).waitFor();await shots('new-computer-restore-prompt');await restoreDialog(backup.id);await shots('restore-code-input');
  assert.deepEqual(report.pageErrors,[]);assert.equal(proxyRequests.model,0);report.status='passed';
}
async function finishTail(){
  // Deliberately include a small random fixture under the selected account memory root.
  const account=(await api('/auth/me')).account;await mkdir(join(newProfile,'personal-access/accounts',account.ownerId,'memory-home'),{recursive:true});
  const existingPartial=f.db.prepare("SELECT id,chunk_count FROM cloud_backups WHERE state='uploading'").get();
  let partial=existingPartial;
  if(!existingPartial){
  await writeFile(join(newProfile,'personal-access/accounts',account.ownerId,'memory-home/s4-synthetic-random.bin'),randomBytes(2300000));
  uploadGate={};uploadGate.promise=new Promise(done=>uploadGate.release=done);blockedUploads=0;uploadIndices=[];
  await settings();await page.getByRole('button',{name:'立即云端备份',exact:true}).click();
  await until(()=>blockedUploads>0,'synthetic upload did not reach its second chunk');
  partial=f.db.prepare("SELECT id,chunk_count FROM cloud_backups WHERE state='uploading'").get();assert.ok(partial.chunk_count>1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_backup_chunks WHERE backup_id=?').get(partial.id).n,1);
  await shots('upload-interrupted');const killed=app.process();killed.kill('SIGKILL');await until(()=>killed.exitCode!==null||killed.signalCode!==null,'isolated interrupted Electron did not exit',20000);app=null;
  const gate=uploadGate;uploadGate=null;gate.release();await pause(300);
  await launch(newProfile);await bind(f,newDevice);
  }
  uploadIndices=[];
  await settings();await page.getByRole('button',{name:'立即云端备份',exact:true}).click();await finishRun();
  assert.equal(uploadIndices.includes(0),false,'restart must not upload the already acknowledged first chunk');
  assert.equal(f.db.prepare("SELECT state FROM cloud_backups WHERE id=?").get(partial.id).state,'complete');
  await shots('upload-resumed',settings);report.checks.push('actual Electron killed with one chunk acknowledged; next launch resumed the same manifest without resending chunk zero');
  // A genuine small configured quota plus another included random file exercises ordinary accounting.
  await writeFile(join(newProfile,'personal-access/accounts',account.ownerId,'memory-home/s4-quota-random.bin'),randomBytes(1024*1024));
  report.quotaFixture={accountLimitBytes:5*1024*1024,additionalRandomBytes:1024*1024};
  await api('/settings/notifications',{dndEnabled:false,dailyLimit:10},'PATCH');
  await settings();await page.getByRole('button',{name:'立即云端备份',exact:true}).click();
  await until(()=>page.getByRole('region',{name:'云端备份',exact:true}).textContent().then(text=>text.includes('备份超过了可用空间')),'quota error was not understandable');
  await shots('quota-exceeded',settings);
  report.checks.push('synthetic cloud quota refusal surfaced in backup settings with current occupied space');
  await page.getByRole('list',{name:'云端备份列表',exact:true}).getByRole('button',{name:'备份操作',exact:true}).first().click();await shots('single-backup-actions');
  await page.getByRole('button',{name:'删除这份备份',exact:true}).click();await shots('single-backup-delete-confirmation');await page.getByRole('dialog',{name:'删除这份备份',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
  const cloudStateFiles=(await readdir(join(newProfile,'personal-backup/cloud'))).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
  const stalePending=JSON.parse(await readFile(join(newProfile,'personal-backup/cloud',cloudStateFiles[0]),'utf8')).pending.manifest;
  const deletionMarker=Buffer.from(f.db.prepare('SELECT ciphertext FROM cloud_backup_chunks LIMIT 1').get().ciphertext).subarray(64,96);assert.equal(deletionMarker.length,32);
  const oldBackupIds=(await api('/backups/cloud')).items.map(row=>row.id),forgetItem=(await api('/memory/items?kind=cognition')).items[0];
  const forgetPath=`/memory/items/cognition/${encodeURIComponent(forgetItem.id)}`,preview=await api(forgetPath+'/forget-preview');
  const forgetId=randomUUID();await api(forgetPath,{requestId:forgetId,expectedWorldRevision:preview.worldRevision},'DELETE');
  await until(async()=>{const result=await api('/memory/commands/by-request/'+forgetId);return result.receipt?.state==='applied';},'real memory forget command did not apply',30000);
  await until(()=>f.db.prepare('SELECT count(*) AS n FROM cloud_backups').get().n===0,'desktop-only forget did not purge older cloud snapshots',30000);
  const residueFiles=[f.config.databasePath,f.config.databasePath+'-wal',f.config.databasePath+'-shm'];let residueChecked=0;
  for(const file of residueFiles){const bytes=await readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(bytes){residueChecked++;assert.ok(!bytes.includes(deletionMarker),'deleted ciphertext marker remains in application-accessible database storage');}}
  report.deletionResidueScan={markerBytes:deletionMarker.length,filesChecked:residueChecked,matches:0};
  const fresh=await api('/backups/cloud/run',{});assert.equal(fresh.state,'succeeded');assert.notEqual(fresh.backup.id,stalePending.id);assert.ok(!oldBackupIds.includes(fresh.backup.id));
  assert.ok(!(await api('/memory/items?kind=cognition')).items.some(row=>row.id===forgetItem.id));
  report.forgetting={noPhone:true,oldSnapshotsRemoved:true,stalePendingDiscarded:true,remainingMemoryItems:(await api('/memory/items?kind=cognition')).items.length};
  report.checks.push('actual desktop-only memory forget purged earlier cloud snapshots; quota-failed pending snapshot was discarded and a new snapshot used the updated memory state');
  await settings();await shots('forget-protected-status',settings);
  await page.getByRole('region',{name:'云端备份',exact:true}).getByRole('button',{name:'更多',exact:true}).click();
  await page.getByRole('dialog',{name:'云端备份操作',exact:true}).getByRole('button',{name:'删除云端备份',exact:true}).click();await shots('delete-confirmation');
  await page.getByRole('button',{name:'删除全部云端备份',exact:true}).click();
  await until(()=>f.db.prepare('SELECT count(*) AS n FROM cloud_backup_keys').get().n===0,'cloud deletion did not remove wrapped key');
  for(const table of ['cloud_backups','cloud_backup_chunks','cloud_backup_quota'])assert.equal(f.db.prepare('SELECT count(*) AS n FROM '+table).get().n,0);
  await shots('deleted-status',settings);report.checks.push('UI deleted all cloud ciphertext, wrapped keys and quota; database counts are zero');
}
try {
  if(process.env.WEFTMATE_S4_WIRE_ONLY==='true')await wireOnly();
  else if(process.env.WEFTMATE_S4_TAIL_ONLY==='true')await resumeTail();
  else if(process.env.WEFTMATE_S4_DIAG_ONLY==='true')await diagnoseExisting();
  else if(process.env.WEFTMATE_S4_COMPAT_ONLY==='true')await compatibility();
  else {
  f=await persistentCloud();if(!f.db.prepare('SELECT 1 FROM cloud_accounts WHERE active=1').get())await registration(f);device=await appDevice(f,'desktop');
  const originalHandler=f.identity.handle;
  f.identity.handle=async(req,res)=>{
    if(req.url.startsWith(P+'/backups/'))req.on('data',bytes=>backupWire.push(Buffer.from(bytes)));
    if(downloadFault&&req.url===P+'/backups/chunk/download'){req.socket.destroy();return true;}
    if(req.url===P+'/backups/chunk/upload') {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks),body=JSON.parse(bytes.toString());
      const payload=body.proof?decodeJwt(body.proof):body;uploadIndices.push(payload.index);
      if(uploadGate&&payload.index===1){blockedUploads++;await uploadGate.promise;}
      const stream=Readable.from([bytes]);Object.defineProperty(stream,'headers',{value:req.headers});Object.defineProperty(stream,'socket',{value:req.socket});stream.url=req.url;stream.method=req.method;
      return originalHandler.call(f.identity,stream,res);
    }
    return originalHandler.call(f.identity,req,res);
  };
  clock=setInterval(()=>f.advance(Math.max(0,Date.now()-f.now)),500);
  await acquireHeavy();await launch();
  if(process.env.WEFTMATE_S4_RESUME_ROOT){const binding=await api('/cloud/binding');if(!binding.bindings?.some?.(row=>row.status==='active'&&row.issuer===f.config.issuer))await api('/cloud/binding',{},'DELETE');}
  await bind();const originalHostId=hostId;
  const sourceAlreadyBackedUp=process.env.WEFTMATE_S4_RESUME_ROOT&&f.db.prepare("SELECT 1 FROM cloud_backups WHERE state='complete'").get();
  if(!sourceAlreadyBackedUp){
  await api('/backups/settings',{enabled:false,directory:join(root,'local-backups'),dailyDays:7,weeklyCopies:4},'PATCH');
  await api('/settings/personalization',{nextSuggestionsEnabled:false,inlineCompletionEnabled:false},'PATCH');
  await api('/settings/notifications',{dndEnabled:true,dailyLimit:10},'PATCH');
  await api('/settings/approvals',{mode:'auto',secondOpinionEnabled:false},'PATCH');
  await api('/onboarding',{step:'first',completed:true},'PATCH');
  await page.reload();await page.waitForFunction(()=>globalThis.__s4core?.state.account);
  }
  if(!process.env.WEFTMATE_S4_RESUME_ROOT){const requestId=randomUUID();await api('/account/models',{requestId,name:'Synthetic S4 MiMo',baseUrl:`http://127.0.0.1:${modelProxy.address().port}/v1`,modelId:'mimo-v2.6-flash',apiKey:secret,modelTier:'cloud'});await until(async()=>{const row=(await api('/account/models/by-request/'+requestId)).operation;return row?.status==='succeeded'&&row;},'synthetic model setup failed');}
  else secret=await app.evaluate(()=>globalThis.s4SyntheticModelCredential());
  model=(await api('/models')).models.find(row=>row.name==='Synthetic S4 MiMo');assert.ok(model);
  if(!sourceAlreadyBackedUp)await api('/settings/models',{defaultModelProfileId:model.id,backgroundModelProfileId:model.id},'PATCH');
  await until(async()=>{const status=await api('/status');return status.memory?.state==='ready';},'configured personal memory is not ready',60000);
  const existingCloud=await api('/backups/cloud');
  if(existingCloud.enabled){const saved=await readFile(join(root,'synthetic-recovery-code.txt'),'utf8');recoveryCode=saved.match(/[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{10}(?:-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{10}){7}/)[0];}
  else await enableFromUI();if(!sourceAlreadyBackedUp)await shots('enabled-status',settings);await closeSettings();
  sessionId=process.env.WEFTMATE_S4_RESUME_ROOT?(await api('/sessions')).sessions[0]?.sessionId:(await command({kind:'session.create',modelProfileId:model.id})).sessionId;assert.ok(sessionId);
  if(!process.env.WEFTMATE_S4_RESUME_ROOT){await message('记住我的长期早餐偏好：我一直喜欢蒸紫薯。'+distinctive+'请长期保留这条偏好，不要创建文件。');await message('记住我的长期安排：我每周六下午固定去游泳。请长期保留这条安排，不要创建文件。');}
  await until(async()=>{const status=await api('/memory/status');return status.state==='ready'&&status.pendingFormationCount===0;},'real memory formation did not settle before snapshot',180000);
  const memories=await until(async()=>{const result=await api('/memory/items?kind=cognition');return result.items?.some(row=>/紫薯|游泳/.test(row.text))&&result;},'real MiMo conversation did not form memories',180000);
  assert.ok(JSON.stringify((await api(`/sessions/${sessionId}/events?limit=200`)).events).includes(distinctive),'original conversation must retain its synthetic feature sentence');
  report.before={sessions:(await api('/sessions')).sessions.length,memoryItems:memories.items.length,notificationSettings:await api('/settings/notifications'),personalizationSettings:await api('/settings/personalization'),modelPresent:true};
  if(!sourceAlreadyBackedUp){await settings();await page.getByRole('button',{name:'立即云端备份',exact:true}).click();await finishRun();await shots('backup-status',settings);}
  const first=(await api('/backups/cloud')).items[0];assert.ok(first);report.firstBackup={bytes:first.totalBytes,chunks:first.chunkCount};
  const cloudBytes=Buffer.concat(f.db.prepare('SELECT ciphertext FROM cloud_backup_chunks').all().map(row=>Buffer.from(row.ciphertext)));
  assert.ok(!cloudBytes.includes(Buffer.from(distinctive)));assert.ok(!cloudBytes.includes(Buffer.from(secret)));
  const wireBytes=Buffer.concat(backupWire);assert.ok(!wireBytes.includes(Buffer.from(distinctive)));assert.ok(!wireBytes.includes(Buffer.from(secret)));assert.ok(!wireBytes.includes(Buffer.from(recoveryCode)));report.wireScan={bytes:wireBytes.length,conversationPlaintextAbsent:true,syntheticModelCredentialAbsent:true,recoveryCodeAbsent:true};
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM cloud_backup_keys').all()).includes(secret));
  report.checks.push('UI enabled backup; grouped synthetic recovery code copied and saved; real conversations and memories uploaded as ciphertext including saved model credential');
  await app.close();app=null;await launch(newProfile);newDevice=await appDevice(f,'new-desktop');await bind(f,newDevice);
  await api('/onboarding',{step:'first',completed:true},'PATCH');await page.reload();await page.waitForFunction(()=>globalThis.__s4core?.state.account);await page.evaluate(async()=>{await __s4core.enterAssistant();await __s4ui.checkCloudBackupPrompt();});
  await until(async()=>{await page.evaluate(()=>__s4ui.checkCloudBackupPrompt());return page.getByRole('complementary',{name:'发现云端备份',exact:true}).isVisible();},'new-computer restore suggestion missing',25000);
  assert.notEqual(hostId,originalHostId);await shots('new-computer-restore-prompt');
  let dialog=await restoreDialog(first.id);await shots('restore-code-input');
  const wrong=recoveryCode.slice(0,-1)+(recoveryCode.endsWith('A')?'B':'A');await dialog.getByRole('textbox',{name:'恢复码',exact:true}).fill(wrong);
  await dialog.getByRole('button',{name:'确认恢复',exact:true}).click();await until(()=>dialog.getByRole('status').textContent().then(text=>text.includes('第 8 组')),'wrong recovery code did not locate the invalid group');
  await shots('wrong-recovery-code');assert.equal((await api('/sessions')).sessions.length,0);
  await dialog.getByRole('textbox',{name:'恢复码',exact:true}).fill(recoveryCode);
  const originalChunk=f.db.prepare('SELECT ciphertext FROM cloud_backup_chunks WHERE backup_id=? AND chunk_index=0').get(first.id).ciphertext;
  const damaged=Buffer.from(originalChunk);damaged[0]^=1;f.db.prepare('UPDATE cloud_backup_chunks SET ciphertext=? WHERE backup_id=? AND chunk_index=0').run(damaged,first.id);
  await dialog.getByRole('button',{name:'确认恢复',exact:true}).click();await until(()=>dialog.getByRole('status').textContent().then(text=>text.includes('损坏')),'damaged backup did not preserve current data');await shots('corrupted-backup');assert.equal((await api('/sessions')).sessions.length,0);
  f.db.prepare('UPDATE cloud_backup_chunks SET ciphertext=? WHERE backup_id=? AND chunk_index=0').run(originalChunk,first.id);
  downloadFault=true;await dialog.getByRole('button',{name:'确认恢复',exact:true}).click();await until(()=>dialog.getByRole('status').textContent().then(text=>text.includes('网络中断')),'download interruption did not offer retry');await shots('download-interrupted');downloadFault=false;
  const descriptor=f.db.prepare('SELECT descriptor FROM cloud_backups WHERE id=?').get(first.id).descriptor;
  f.db.prepare('UPDATE cloud_backups SET descriptor=? WHERE id=?').run(JSON.stringify({...JSON.parse(descriptor),version:2}),first.id);
  await dialog.getByRole('button',{name:'确认恢复',exact:true}).click();await until(()=>dialog.getByRole('status').textContent().then(text=>text.includes('更新')),'newer backup version did not ask for app update');await shots('newer-version');assert.equal((await api('/sessions')).sessions.length,0);
  f.db.prepare('UPDATE cloud_backups SET descriptor=? WHERE id=?').run(descriptor,first.id);
  const child=app.process();await dialog.getByRole('button',{name:'确认恢复',exact:true}).click();
  await until(()=>child.exitCode!==null,'restore did not shut down the actual Electron',120000);app=null;
  await launch(newProfile);await bind(f,newDevice);
  const restored=(await api('/backups')).status;assert.equal(restored.restored,true,JSON.stringify(restored));assert.equal(restored.state,'succeeded');
  assert.ok((await api('/sessions')).sessions.some(row=>row.sessionId===sessionId));
  assert.ok(JSON.stringify((await api(`/sessions/${sessionId}/events?limit=200`)).events).includes(distinctive),'restored conversation must retain the exact synthetic feature sentence');
  const restoredMemories=(await api('/memory/items?kind=cognition')).items;assert.equal(restoredMemories.length,report.before.memoryItems);assert.deepEqual(restoredMemories.map(row=>({id:row.id,text:row.text})),memories.items.map(row=>({id:row.id,text:row.text})));
  assert.deepEqual(await api('/settings/notifications'),report.before.notificationSettings);assert.deepEqual(await api('/settings/personalization'),report.before.personalizationSettings);
  assert.ok((await api('/models')).models.some(row=>row.name==='Synthetic S4 MiMo'));
  const credentialPresent=await app.evaluate((_,expected)=>globalThis.s4CredentialMatches(expected),secret);assert.equal(credentialPresent,true);
  await message('只回复“恢复后可以继续聊了”，不要调用工具。');await shots('restore-completed',settings);
  report.after={sessions:(await api('/sessions')).sessions.length,memoryItems:restoredMemories.length,modelCredentialRestored:credentialPresent,canContinueConversation:true};
  report.checks.push('new empty computer logged in without old-device approval; restore suggestion stayed inside app; wrong group preserved empty data; restore recovered conversation, memories, settings and durable model credential; real MiMo conversation continued');
  await closeSettings();
  await finishTail();
  assert.deepEqual(report.pageErrors,[]);report.status='passed';report.cloudBackupRequests=cloudRequests;
  }
} catch(error) {
  report.status='failed';report.error=sanitize(error.message);report.commitMemory=systemCommitMemory();
  if(page&&!page.isClosed()) {
    report.failureCloud=await api('/backups/cloud').catch(error=>({error:sanitize(error.message)}));report.failureView=await page.evaluate(()=>__s4core?.state.currentView).catch(()=>null);
    report.failureBody=await page.locator('body').innerText().then(sanitize).catch(()=>null);
    await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});
  }
  await writeFile(join(evidence,'failure-diagnostics.log'),diagnostics);console.error('S4:',report.error);process.exitCode=1;
} finally {
  uploadGate?.release();clearInterval(clock);await app?.close().catch(()=>{});for(const cleanup of cleanups.reverse())await cleanup();
  for(const controller of controllers)controller.abort();modelProxy.closeAllConnections();await new Promise(done=>modelProxy.close(done));
  report.proxyRequests=proxyRequests;report.modelRequests=proxyRequests.model;report.cleanup=cleanupOwnedProcesses({startedAt,executables:[process.execPath,electron,resolve(requireMemoWeftPath('python'))],commandRoots:[root]});
  await releaseHeavy();await appendFile(join(repo,'.local/s4-attempts.jsonl'),JSON.stringify({at:new Date().toISOString(),status:report.status,modelRequests:report.modelRequests,error:report.error??null})+'\n');
  await writeFile(join(evidence,process.env.WEFTMATE_S4_WIRE_ONLY==='true'?'verification-wire.json':process.env.WEFTMATE_S4_COMPAT_ONLY==='true'?'verification-old-cloud.json':'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,modelRequests:report.modelRequests,checks:report.checks}));
  if(report.status==='passed'&&process.env.WEFTMATE_S4_DIAG_ONLY!=='true')await removeOwnRoot();
  else await writeFile(join(repo,'.local/s4-last-failed-root.json'),JSON.stringify({root,status:report.status,at:new Date().toISOString()})+'\n');
}
