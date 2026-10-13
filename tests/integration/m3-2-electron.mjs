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
  await page.getByLabel(/^(邮箱)?验证码$/,{exact:true}).fill(await cloud.mailCode(row.id));
  await page.locator('#cloud-auth-form [type=submit]').click();
  await page.locator('#assistant-view').waitFor({state:'visible',timeout:90000});
}
async function launch(index){
  const profile=join(root,'computer-'+index);await mkdir(profile,{recursive:true});await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const env={...process.env};for(const name of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|CLOUD_)/.test(name)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(name))delete env[name];
  Object.assign(env,{WEFTMATE_M3_MODEL_KEY:key,WEFTMATE_TEST_HOST_NAME:names[index],WEFTMATE_CLOUD_ISSUER:cloud.config.issuer,
    WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK:'true',WEFTMATE_CLOUD_DESKTOP_CLIENT_ID:'test-native',WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI:'com.example.weftmate:/callback',WEFTMATE_CLOUD_WEB_CLIENT_ID:'test-web'});
  const app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:[join(repo,'tests/integration/m3-2-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host',`--access-port=${ports[index]}`,'--force-device-scale-factor=1'],env,timeout:90000});
  const entry={app,index,profile};apps.push(entry);entry.page=await app.firstWindow({timeout:90000});entry.page.setDefaultTimeout(25000);
  entry.page.on('pageerror',error=>report.errors.push(redactEvidenceText(error.message,[root])));
  await entry.page.addInitScript(()=>{let value;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>value,set:next=>{value=next;const create=next.create;next.create=(...args)=>{const core=create(...args);globalThis.m3Core=core;return core;};}});});
  await entry.page.waitForURL('**/personal/v1/ui');await entry.page.reload();
  // Native first-run remains the product path; skip its model tour only after
  // configuring the actual account through the same authenticated model API.
  await until(()=>entry.page.evaluate(()=>!!globalThis.m3Core?.state.csrfToken),'native local session');
  const requestId=randomUUID();const configured=await entry.page.evaluate(async({requestId,key})=>{
    return m3Core.accessApi('/account/models',{method:'POST',protectedWrite:true,body:{requestId,name:'Synthetic MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:key}});
  },{requestId,key});assert.ok(configured);
  await until(()=>entry.page.evaluate(async requestId=>{const row=await m3Core.accessApi('/account/models/by-request/'+requestId);if(row.operation.status==='failed')throw Error(row.operation.errorCode);return row.operation.status==='succeeded';},requestId),'model configuration');
  await entry.page.evaluate(async()=>{const id=(await m3Core.accessApi('/models')).models.find(row=>row.name==='Synthetic MiMo').id;await m3Core.accessApi('/settings/models',{method:'PATCH',protectedWrite:true,body:{defaultModelProfileId:id,backgroundModelProfileId:id}});});
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
async function send(page,text){await page.fill('#message-text',text);await page.locator('#send-message').click();await until(()=>page.evaluate(()=>!m3Core.state.submitting&&!m3Core.mainReplyActive()&&!m3Core.conversationRunning(m3Core.state.selectedSessionId)),'reply ended',180000);}
async function removeLinks(directory){for(const row of await readdir(directory,{withFileTypes:true})){const file=join(directory,row.name);if(row.isSymbolicLink())await unlink(file);else if(row.isDirectory())await removeLinks(file);}}
try {
  const relayEnv={CLOUD_RELAY_DOMAIN:'synthetic.example.com'};
  for(const field of ['CONTROL_PORT','CONTENT_PORT','PLUGIN_PORT','FRPS_PORT','FRPS_HTTPS_PORT'])relayEnv['CLOUD_RELAY_'+field]=String(await port());
  cloud=await fixture({after:fn=>cleanups.push(fn)},{env:{...relayEnv,CLOUD_OIDC_CLIENTS:JSON.stringify([{client_id:'test-native',redirect_uris:['com.example.weftmate:/callback']},{client_id:'test-web',application_type:'web',redirect_uris:origins.map(origin=>origin+'/personal/v1/ui/')}])}});
  await registration(cloud);
  // The local transport directory substitutes only frp/DNS. The real account,
  // nonce, token family, DPoP, host verification and command routes are used.
  cloud.identity.relay.discover=(hostId,accountId)=>{
    assert.ok(cloud.db.prepare('SELECT 1 FROM host_memberships WHERE host_id=? AND account_id=?').get(hostId,accountId));return {hostId,...(address.get(hostId)||{baseUrl:null,status:'offline'})};
  };
  stage='first-computer';const a=await launch(0);
  browser=await chromium.launch({headless:true,channel:'chrome'});phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await phone.addInitScript(()=>{let value;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>value,set:next=>{value=next;const create=next.create;next.create=(...args)=>{const core=create(...args);globalThis.m3Core=core;return core;};}});});
  phone.on('pageerror',error=>report.errors.push(redactEvidenceText(error.message,[root])));await phone.goto(origins[0]+'/personal/v1/ui/');await login(phone);
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
  stage='file-on-a';await writeFile(join(a.profile,'synthetic-note.txt'),'M3_FILE_ONLY_ON_DESK_42');
  await phone.evaluate(async hostId=>{await m3Core.selectExecutionComputer(hostId);await m3Core.startNewConversation();},a.hostId);
  const publicPath=join(a.profile,'synthetic-note.txt');await send(phone,'读取这个合成文件并仅回复其中的标记：'+publicPath);
  const aEvents=await phone.evaluate(()=>[...m3Core.state.historyEvents.values()]);assert.ok(JSON.stringify(aEvents).includes('M3_FILE_ONLY_ON_DESK_42'));
  const bCommands=await b.page.evaluate(()=>m3Core.accessApi('/commands?limit=100'));assert.ok(!JSON.stringify(bCommands).includes('synthetic-note.txt'));report.checks.push('messages on both computers; desk-only file read; laptop has no file execution');
  stage='offline-a';report.modelRequests+=await a.app.evaluate(()=>globalThis.m3ModelRequests);await a.app.close();a.closed=true;address.set(a.hostId,{baseUrl:origins[0],status:'offline'});
  await phone.evaluate(async()=>{await m3Core.cloudDirectory();await m3Core.refreshSessions();});await screenshot(phone,'desk-offline');
  // Further offline/restart assertions are added with the refreshed M3-A view.
  stage='remove-b';await phone.evaluate(hostId=>m3Core.cloudRemoveComputer(hostId),b.hostId);await screenshot(phone,'computer-removed');
  await b.page.reload();await until(()=>b.page.evaluate(()=>!!m3Core.state.csrfToken),'removed computer local use');report.checks.push('removed computer remains locally usable');
  await screenshot(b.page,'local-after-removal',b);report.modelRequests+=await b.app.evaluate(()=>globalThis.m3ModelRequests);
  assert.deepEqual(report.errors,[]);report.ok=true;
  }
}catch(error){report.ok=false;report.stage=stage;report.failure=redactEvidenceText(error.stack,[root]).replaceAll(key,'[private]');report.systemCommit=systemCommitMemory();
  report.states=[];for(const entry of apps){try{report.states.push(await entry.page.evaluate(()=>({auth:m3Core.cloudAuthView(),status:m3Core.state.currentView,text:document.body.innerText.slice(-3000)})));}catch{}}
  if(phone)await phone.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw error;}
finally {
  for(const entry of apps)if(!entry.closed){try{report.modelRequests+=report.ok?0:await entry.app.evaluate(()=>globalThis.m3ModelRequests);await entry.app.close();}catch{}}
  await browser?.close();for(const cleanup of cleanups.reverse())await cleanup();
  report.cleanup=cleanupOwnedProcesses({startedAt,executables:[process.execPath,createRequire(import.meta.url)('electron')],commandRoots:[root,join(repo,'tests/integration/m3-2-bootstrap.mjs')]});await removeLinks(root);await rm(root,{recursive:true,force:true});
  await writeFile(join(out,'electron-report.json'),JSON.stringify(report,null,2)+'\n');
}
