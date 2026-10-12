import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {managedMkdtemp as mkdtemp,managedTempRoot as tmpdir} from '../helpers/managed-temp.mjs';
import {join,resolve} from 'node:path';
import {createPersonalAccessService} from '../../src/personal-access/index.mjs';
import {PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT} from '../../src/host-mode.mjs';
import {disposeHealthFixture} from '../helpers/health-5-temp.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {redactEvidenceText,systemCommitMemory,describeExit,cleanupOwnedProcesses} from '../helpers/process-evidence.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=join(repo,'tests/evidence/data-2'),root=await mkdtemp(join(tmpdir(),'weftmate-data2-')),profile=join(root,'profile'),startedAt=Date.now(),electron=createRequire(import.meta.url)('electron');
await mkdir(out,{recursive:true});await mkdir(profile);await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const key=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim();assert.ok(key);
const credentials={username:'data2-synthetic',password:'synthetic-'+randomUUID(),deviceName:'Synthetic usage test'};
const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(n=>[n,async()=>({})]))});
try{const {origin}=await prep.start(),grant=await prep.issueSetupGrant();assert.equal((await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})})).status,201);}finally{await prep.close();}
const env={...process.env};for(const name of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(name)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(name))delete env[name];
Object.assign(env,{WEFTMATE_TEST_HOST_NAME:'synthetic-host',WEFTMATE_BASELINE_TRACE:join(root,'requests.jsonl')});
let app,page,appProcess,stage='launch',log='';const report={realElectron:true,realNativeDSH:true,syntheticAccount:true,hostName:'synthetic-host',checks:[],screenshots:[],mimoRequests:0,errors:[],cleanedProcesses:0};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=120000){stage=label;console.log('DATA-2: '+label);const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await pause(200);}throw Error('Timeout: '+label);}
const api=async(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const me=await fetch('/personal/v1/auth/me').then(r=>r.json()),r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{path,body,method});
try {
  app=await _electron.launch({executablePath:electron,cwd:repo,args:[join(repo,'tests/integration/data-2-bootstrap.mjs'),'--user-data-dir='+profile,'--personal-host','--access-port=0','--force-device-scale-factor=1'],env,timeout:90000});
  appProcess=app.process();
  const capture=v=>log+=redactEvidenceText(String(v).replaceAll(key,'[private]'),[root]);appProcess.stdout?.on('data',capture);appProcess.stderr?.on('data',capture);
  page=await app.firstWindow({timeout:90000});page.on('pageerror',e=>report.errors.push(redactEvidenceText(e.message)));await page.waitForURL('**/personal/v1/ui');
  await app.evaluate(async()=>{await globalThis.data2LiveSampler?.close();});
  await localUiSession(page,credentials,'DATA-2',{mainChat:true});await page.locator('#assistant-view').waitFor({state:'visible'});
  await api('/settings/usage',{timeZone:'Asia/Shanghai'},'PATCH');await api('/settings/health',{modelInsightsEnabled:false},'PATCH');
  const status=(await api('/status')).body,ownerId=status.ownerId,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),days=[shift(today,-2),shift(today,-1),today];
  assert.equal(await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.hide();return win.isVisible();}),false);
  await app.evaluate((_,today)=>{globalThis.data2HostNow=Date.parse(today+'T12:00:00+08:00');},today);
  await app.evaluate((_,{ownerId,days})=>{globalThis.data2Time=Date.parse(days[0]+'T01:45:00+08:00');globalThis.data2StartSynthetic(ownerId);},{ownerId,days});
  for(const day of days){await app.evaluate(async(_,{day})=>{globalThis.data2Time=Date.parse(day+'T01:45:00+08:00');await globalThis.data2Synthetic.tick();for(let n=0;n<15;n++){globalThis.data2Time+=60000;await globalThis.data2Synthetic.tick();}await globalThis.data2Synthetic.flush();},{day});}
  await app.evaluate(async()=>{await globalThis.data2Synthetic.close();});
  const daily=(await api('/daily-summaries')).body;report.daily=daily;
  const overview=(await api('/health/overview?day='+today)).body;assert.equal(overview.usage.source,'computer');assert.equal(overview.usage.activeMinutes,15);assert.equal(overview.usage.lastUsedAt,new Date(today+'T02:00:00+08:00').toISOString());report.usage=overview.usage;
  assert.equal(JSON.stringify(daily).includes('this-computer'),true);assert.equal((await api('/health/metrics/usageLateNightMinutes?days=7')).body.points.at(-1).value,15);report.checks.push('three-local-days-tray-hidden-real-sampler-real-store-daily-devices-overview-and-trend');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  const requestId=randomUUID();assert.equal((await api('/account/models',{requestId,name:'Synthetic MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:key})).status,202);
  await until(async()=>{const op=(await api('/account/models/by-request/'+requestId)).body.operation;if(op?.status==='failed')throw Error('Model setup failed');return op?.status==='succeeded';},'configure MiMo');
  const modelId=(await api('/models')).body.models.find(r=>r.name==='Synthetic MiMo').id;await api('/settings/models',{defaultModelProfileId:modelId},'PATCH');
  // The query may combine usage with an intentionally small synthetic health partition.
  await api('/health/records/batch',{items:days.map(day=>({day,health:{version:1,status:'available',steps:1000,sleepMinutes:420,restingHeartRateBpm:60,exerciseMinutes:10,workouts:[]}}))},'PUT');
  const main=(await api('/chats/main')).body.chat,question='我昨晚几点还在用电脑？';
  const created=await api('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:main.chatId,targetDeviceId:status.hostId,modelProfileId:modelId,text:question,mode:'queue'});assert.equal(created.status,202);
  const accepted=await until(async()=>{const r=(await api('/commands/'+created.body.command.commandId)).body.command;if(['rejected','uncertain'].includes(r.state))throw Error(r.errorCode??r.state);return r.state==='accepted_by_dsh'&&r;},'native chat accepted');
  const events=await until(async()=>{const events=(await api('/sessions/'+accepted.sessionId+'/events?limit=100')).body.events??[];return events.some(e=>e.type==='turn.ended')&&events;},'MiMo health_query answer',180000);
  assert.ok(events.some(e=>e.type==='step.completed'&&e.data?.toolName==='health_query'&&e.data?.state==='completed'));const reply=events.filter(e=>e.type==='assistant.message').map(e=>e.data.text).join('\n');report.answer={question,reply,tool:'health_query'};assert.match(reply,/(?:^|[^0-9])(?:02:00|2:00)(?![0-9])|凌晨(?:两|二|2|02)\s*点/);report.checks.push('real-cloud-mimo-native-health-query-answers-last-computer-use');
  await page.keyboard.press('Control+,');await page.getByRole('button',{name:'通知',exact:true}).click();const toggle=page.getByRole('switch',{name:'记录这台电脑的使用时段',exact:true});await toggle.waitFor();await page.waitForFunction(()=>!document.getElementById('notifications-computerUsageEnabled').disabled);assert.equal(await toggle.isChecked(),true);
  for(const width of [1200,480])for(const theme of ['light','dark']){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,1000),width);await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;},theme);await toggle.scrollIntoViewIfNeeded();await pause(200);const name=`electron-${width}-${theme}-settings.png`;await page.screenshot({path:join(out,name)});report.screenshots.push(name);}
  await toggle.uncheck();await page.waitForFunction(()=>!document.getElementById('notifications-computerUsageEnabled').disabled);assert.equal((await api('/settings/notifications')).body.settings.computerUsageEnabled,false);report.checks.push('default-on-shared-setting-persists-off-and-four-theme-width-captures');
  await toggle.check();await page.waitForFunction(()=>!document.getElementById('notifications-computerUsageEnabled').disabled);
  // Use the real Windows idle source and the same account policy/store for three minutes; publish only aggregate minutes.
  report.realSampling=await app.evaluate(async({powerMonitor},ownerId)=>{const createComputerUsageSampler=globalThis.data2CreateSampler;let buckets=[],samples=0;const real=createComputerUsageSampler({powerMonitor,owner:()=>ownerId,policy:owner=>globalThis.health2.service.computerUsagePolicy(owner),persist:async(owner,generation,rows)=>{buckets.push(...rows);await globalThis.health2.service.recordComputerUsage(owner,generation,rows);},setTimer:(fn,ms)=>{const timer=setInterval(()=>{samples++;fn();},ms);timer.unref();return timer;}});await new Promise(r=>setTimeout(r,180100));await real.close();return {samples,activeMinutes:buckets.reduce((n,r)=>n+r.activeMinutes,0),observedMinutes:buckets.reduce((n,r)=>n+r.observedMinutes,0)};},ownerId);
  assert.ok(report.realSampling.samples>=3);assert.ok(report.realSampling.observedMinutes>=3);report.checks.push('three-minutes-real-windows-idle-source-no-local-identity-or-time-evidence');
  assert.deepEqual(report.errors,[]);report.completed=true;
} catch(error){report.completed=false;report.failure=redactEvidenceText(String(error.message).replaceAll(key,'[private]'),[root]);report.lastStage=stage;report.commitMemory=systemCommitMemory();report.electronExit=appProcess?describeExit(appProcess.exitCode,appProcess.signalCode):null;report.logTail=log.slice(-4000);report.hostLogs=await Promise.all((await readdir(join(profile,'logs')).catch(()=>[])).filter(n=>n.endsWith('.jsonl')).map(n=>readFile(join(profile,'logs',n),'utf8')));throw error;}
finally {
  const trace=await readFile(join(root,'requests.jsonl'),'utf8').catch(()=> '');report.mimoRequests=trace.split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='model'&&r.phase==='start'&&r.origin==='https://api.xiaomimimo.com').length;
  if(app){await app.close().catch(()=>{});report.cleanedProcesses++;}const cleanup=cleanupOwnedProcesses({startedAt,executables:[electron,process.execPath],commandRoots:[root]});report.cleanedProcesses+=cleanup.cleaned;report.cleanup=cleanup;
  await disposeHealthFixture(root);await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
}
