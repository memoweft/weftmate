/** Original action-04, three fresh accounts, real Electron/DSH/MiMo. Keys in memory. */
import assert from 'node:assert/strict';
import {_electron} from 'playwright';import {createRequire} from 'node:module';
import {promisify} from 'node:util';import {execFile} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';import {join,resolve} from 'node:path';
import {createPersonalAccessService} from '../../../../src/personal-access/index.mjs';
import {PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT} from '../../../../src/host-mode.mjs';
import {runEvaluation,loadScenarios} from '../../../../scripts/eval.mjs';
import {localUiSession} from '../../../helpers/local-ui-session.mjs';
const repository=resolve('.'),evidence=resolve('tests/evidence/fx-13/mimo');mkdirSync(evidence,{recursive:true});
process.env.TEMP=process.env.TMP='C:/Temp';
const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{windowsHide:true});const key=stdout.trim();assert.ok(key,'Machine MIMO_API_KEY required');
const scenario=(await loadScenarios('eval/scenarios/*.yaml')).find(s=>s.id==='action-04-research-script');assert.ok(scenario);
const report={startedAt:new Date().toISOString(),originalScenario:true,freshAccounts:true,realElectron:true,realDsh:true,runs:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const safe=s=>String(s).replaceAll(key,'[redacted]');
for(let iteration=1;iteration<=3;iteration++){
 const root=mkdtempSync('C:/Temp/weftmate-fx13-mimo-'),profile=join(root,'profile'),out=join(root,'eval'),dest=join(evidence,'run-'+iteration);mkdirSync(profile);mkdirSync(out);mkdirSync(dest,{recursive:true});
 writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
 const username='eval-'+randomUUID(),password='synthetic-'+randomUUID()+'-password';
 const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(n=>[n,async()=>({})]))});
 const prepared=await prep.start(),grant=await prep.issueSetupGrant();assert.equal((await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username,password,deviceName:'FX13 synthetic desktop'})})).status,201);await prep.close();
 const env={...process.env};for(const n of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(n)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(n))delete env[n];env.WEFTMATE_BASELINE_TRACE=join(root,'requests.jsonl');
 let app,page;
 const api=async(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
 const run={iteration,root,runnerPid:process.pid};
 try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:[join(repository,'tests/integration/personal-baseline-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});run.electronPid=app.process().pid;page=await app.firstWindow();page.setDefaultTimeout(90000);await page.waitForURL('**/personal/v1/ui');await localUiSession(page,{username,password});await page.locator('#assistant-view').waitFor();
  assert.equal((await api('/account/models',{requestId:'fx13-mimo',name:'mimo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:key})).status,202);
  const deadline=Date.now()+90000;let operation;while(Date.now()<deadline){operation=(await api('/account/models/by-request/fx13-mimo')).body.operation;if(!['pending','applying'].includes(operation?.status))break;await pause(250);}assert.equal(operation?.status,'succeeded');
  run.runtimePluginHashes={};for(const name of ['personal-native-files.mjs','personal-write-targets.mjs','personal-approval-policy.mjs']){const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');const expected=sha(join(repository,'src/plugins',name)),actual=sha(join(profile,'dsh-home/profiles/weftmate/plugins',name));assert.equal(actual,expected,'Runtime copy must include FX13: '+name);run.runtimePluginHashes[name]=actual;}
  writeFileSync(join(out,'credentials.json'),JSON.stringify({host:new URL(page.url()).origin,username,password,deviceName:'FX13 evaluator',provisioned:true}));
  const evaluated=await runEvaluation({host:new URL(page.url()).origin,out,model:'mimo',scenarioList:[scenario],onScenarioResult:async result=>{
   result.toolDetails=[];
   for(const turn of result.turns||[]){let cursor=-1,more=true;while(more){const h=(await api(`/sessions/${turn.sessionId}/events?afterSeq=${cursor}&limit=200`)).body;if(!Array.isArray(h.events))break;cursor=h.nextSeq;more=h.hasMore;for(const event of h.events.filter(e=>['step.started','step.completed','artifact.created'].includes(e.type))){const detail=(await api(`/sessions/${turn.sessionId}/events/${event.seq}/detail`)).body;result.toolDetails.push({seq:event.seq,type:event.type,at:event.at,toolName:event.data?.toolName,text:detail.text});}}}
   const id=result.turns?.at(-1)?.sessionId;if(id)await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>/personal\/v1\/ui/.test(w.webContents.getURL()))?.webContents.send('wm:desktop:conversation',id),id);await pause(1200);await page.screenshot({path:join(dest,'desktop-light.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:join(dest,'desktop-dark.png')});
   for(const name of ['sum.mjs','result.json'])try{writeFileSync(join(dest,name),safe(readFileSync(join(result.scratchDir,name),'utf8')));}catch{}
  }});
  writeFileSync(join(dest,'results.json'),safe(JSON.stringify(evaluated,null,2)));run.status=evaluated.results.every(r=>r.status==='passed')?'passed':'failed';run.durationMs=evaluated.results[0]?.durationMs;run.unexpectedApprovals=evaluated.results.filter(r=>r.turns?.some(t=>t.unexpectedApproval)).length;
 }catch(error){run.status='failed';run.error=safe(error.message);await page?.screenshot({path:join(dest,'failure.png')}).catch(()=>{});}
 finally{
  rmSync(join(out,'credentials.json'),{force:true});await app?.close();run.cleaned=true;
  const trace=join(root,'requests.jsonl');if((await import('node:fs')).existsSync(trace))writeFileSync(join(dest,'requests.jsonl'),safe(readFileSync(trace,'utf8')));
  writeFileSync(join(dest,'run.json'),JSON.stringify(run,null,2));report.runs.push(run);writeFileSync(join(evidence,'summary.json'),JSON.stringify(report,null,2));
 }
 console.log('FX13 MiMo',iteration,run.status,run.durationMs);
}
report.finishedAt=new Date().toISOString();const modelRecords=report.runs.flatMap(r=>{try{return readFileSync(join(evidence,'run-'+r.iteration,'requests.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return [];}});const requests=modelRecords.filter(r=>r.kind==='model'&&r.origin==='https://api.xiaomimimo.com'&&r.phase==='start'),ends=modelRecords.filter(r=>r.kind==='model'&&r.origin==='https://api.xiaomimimo.com'&&r.phase==='end');report.usage={requests:requests.length,withUsage:ends.filter(r=>r.usage).length,missingUsage:requests.length-ends.filter(r=>r.usage).length,promptTokens:0,completionTokens:0,cachedTokens:0};for(const r of ends.filter(r=>r.usage)){report.usage.promptTokens+=r.usage.prompt_tokens??0;report.usage.completionTokens+=r.usage.completion_tokens??0;report.usage.cachedTokens+=r.usage.prompt_tokens_details?.cached_tokens??r.usage.prompt_cache_hit_tokens??0;}
writeFileSync(join(evidence,'summary.json'),JSON.stringify(report,null,2));if(report.runs.some(r=>r.status!=='passed'))process.exitCode=1;
