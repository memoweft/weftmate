// Real Electron + DSH evaluation. All files/accounts/ports are isolated.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { runEvaluation } from '../../scripts/eval.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { createLanBaselineBridge } from './baseline-lan-model.mjs';
const repo=resolve(import.meta.dirname,'../..');
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const phase=arg('--phase','after'), model=arg('--model','mimo'), repetitions=Number(arg('--repeat','2'));
assert.ok(['before','after'].includes(phase)&&['mimo','lan'].includes(model));
const fixture=JSON.parse(readFileSync(join(repo,'tests/fixtures/fact-1/topics.json')));
const topics=fixture.topics.filter(t=>!arg('--only','')||arg('--only','').split(',').includes(t.id));
const evidence=resolve(arg('--out',`tests/evidence/fact-1/${phase}/${model}`));mkdirSync(evidence,{recursive:true});
process.env.TEMP=process.env.TMP='C:/Temp';
const root=join('C:/Temp','weftmate-fact1-'+randomUUID()),profile=join(root,'profile');mkdirSync(profile,{recursive:true});
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const envValue=(name,scope='User')=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`],{encoding:'utf8',windowsHide:true}).trim();
const key=envValue(model==='mimo'?'MIMO_API_KEY':'WEFTMATE_LAN_MODEL_KEY',model==='mimo'?'Machine':'User');assert.ok(key,'Model credential missing');
const privateUrl=model==='lan'?envValue('WEFTMATE_LAN_MODEL_BASE_URL'):null;
const redact=value=>{let text=String(value);for(const secret of [key,privateUrl,privateUrl&&new URL(privateUrl).host].filter(Boolean))text=text.replaceAll(secret,'[redacted]');return text;};
const username='eval-'+randomUUID(),password='test-'+randomUUID();
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(k=>[k,async()=>({})]));
const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
const prepared=await prep.start(),setup=await prep.issueSetupGrant();
assert.equal((await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:setup.grant,username,password,deviceName:'FACT-1 synthetic'})})).status,201);await prep.close();
const env={...process.env};for(const name of Object.keys(env))if(name.startsWith('WEFTMATE_')||name.startsWith('MEMOWEFT_')||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(name))delete env[name];
env.FACT1_PHASE=phase;env.WEFTMATE_BASELINE_TRACE=join(root,'requests.jsonl');
const lock='D:/AIProjects/WeftMate/Runtime/Orchestrator/lan.lock';let ownsLock=false,bridge,app,page;
const results=[],startedAt=new Date().toISOString();
const persist=()=>writeFileSync(join(evidence,'results.json'),redact(JSON.stringify({phase,model,baselineCommit:fixture.baselineCommit,startedAt,root,results},null,2)));
async function api(path,body,method=body?'POST':'GET') {return page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});}
async function until(check){const end=Date.now()+90000;while(Date.now()<end){const v=await check();if(v)return v;await new Promise(r=>setTimeout(r,250));}throw Error('FACT1_SETUP_TIMEOUT');}
try {
  if(model==='lan') {
    // An occupied lock ends this invocation so the orchestrator can continue MiMo work.
    if(existsSync(lock)&&Date.now()-statSync(lock).mtimeMs>3*3600000)unlinkSync(lock);
    const fd=openSync(lock,'wx');writeFileSync(fd,`FACT-1 ${startedAt}`);closeSync(fd);ownsLock=true;
    bridge=await createLanBaselineBridge({baseUrl:privateUrl,key});
    writeFileSync(join(evidence,'warmup.json'),JSON.stringify(await bridge.warmup()));
  }
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[join(repo,'tests/integration/fact-1-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],cwd:repo,env,timeout:90000});
  writeFileSync(join(evidence,'process.json'),JSON.stringify({root,startedAt,pid:app.process().pid,executable:app.process().spawnfile}));
  let log='';const capture=chunk=>{log+=redact(chunk);writeFileSync(join(root,'host.log'),log);};app.process().stdout?.on('data',capture);app.process().stderr?.on('data',capture);
  page=await app.firstWindow();page.setDefaultTimeout(60000);await page.waitForURL('**/personal/v1/ui');await localUiSession(page,{username,password},'FACT-1');
  await page.locator('#assistant-view').waitFor({state:'visible'});
  const requestId='fact1-'+randomUUID();assert.equal((await api('/account/models',{requestId,name:model,baseUrl:bridge?bridge.url:'https://api.xiaomimimo.com/v1',modelId:bridge?'local-quality':'mimo-v2.6-flash',apiKey:bridge?bridge.token:key})).status,202);
  const op=await until(async()=>{const v=(await api('/account/models/by-request/'+requestId)).body.operation;return v&&!['pending','applying'].includes(v.status)&&v;});assert.equal(op.status,'succeeded');
  const selected=(await api('/models')).body.models.find(m=>m.name===model);assert.ok(selected);
  assert.equal((await api('/settings/models',{backgroundModelProfileId:selected.id},'PATCH')).status,200);
  const out=join(root,'eval');mkdirSync(out);writeFileSync(join(out,'credentials.json'),JSON.stringify({host:new URL(page.url()).origin,username,password,deviceName:'FACT-1 runner',provisioned:true}));
  for(let repeat=1;repeat<=repetitions;repeat++) for(const topic of topics) {
    console.log(`FACT-1 ${phase}/${model} ${topic.id} ${repeat} started`);
    const scenario={id:'fact-'+topic.id,category:'action',title:topic.title,setup:{files:[],memories:[],devices:['isolated Electron']},turns:[{user:`请查官方资料，用中文写一份简短说明，附上来源链接，存到 {{testDir}}/说明.md。主题：${topic.question}\n可从以下官方资料开始：\n${topic.sources.join('\n')}`}],checks:[{type:'file_exists',path:'说明.md'},{type:'turn_status',status:'completed'}],timeoutSec:900,notes:'FACT-1 fixed topic; rubric not sent to model'};
    if(process.argv.includes('--original')) {
      assert.equal(topic.id,'node24','--original requires --only node24');
      const original=JSON.parse(readFileSync(join(repo,'eval/scenarios/action-02-web-document.yaml'),'utf8'));
      Object.assign(scenario,original);
    }
    await runEvaluation({host:new URL(page.url()).origin,out,model,scenarioList:[scenario],onScenarioResult:async result=>{
      result.repeat=repeat;result.topicId=topic.id;result.toolDetails=[];
      for(const turn of result.turns||[]) {let cursor=-1,more=true;while(more){const h=(await api(`/sessions/${turn.sessionId}/events?afterSeq=${cursor}&limit=200`)).body;if(!h.events)break;cursor=h.nextSeq;more=h.hasMore;
        for(const e of h.events.filter(e=>['step.completed','assistant.message'].includes(e.type))) {
          if(e.type==='assistant.message'){(result.messages??=[]).push(e);continue;}
          const d=(await api(`/sessions/${turn.sessionId}/events/${e.seq}/detail`)).body;result.toolDetails.push({seq:e.seq,at:e.at,toolName:e.data?.toolName,text:d.text});
        }
      }}
      try{result.document=readFileSync(join(result.scratchDir,process.argv.includes('--original')?'node24说明.md':'说明.md'),'utf8');writeFileSync(join(evidence,`${topic.id}-${repeat}.md`),result.document);}catch{}
      results.push(result);persist();console.log(`FACT-1 ${topic.id} ${repeat}: ${result.status}, ${(result.durationMs/1000).toFixed(3)}s`);
    }});
  }
  if(arg('--visual','')==='yes') { const {verifyFactUi}=await import('./fact-1-ui.mjs');await verifyFactUi({app,page,api,results,evidence,credentials:{username,password}}); }
} catch(error){writeFileSync(join(evidence,'failure.json'),redact(JSON.stringify({message:error.message,stack:error.stack})));throw Error(redact(error.message));}
finally {
  if(app)await app.close().catch(()=>{});
  if(bridge)await bridge.close();
  if(ownsLock&&readFileSync(lock,'utf8')===`FACT-1 ${startedAt}`)unlinkSync(lock);
  if(existsSync(env.WEFTMATE_BASELINE_TRACE))writeFileSync(join(evidence,'requests.jsonl'),redact(readFileSync(env.WEFTMATE_BASELINE_TRACE,'utf8')));
  persist();
}
