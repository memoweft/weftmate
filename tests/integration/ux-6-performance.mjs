// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** 500 synthetic native sessions, real isolated authenticated HTTP host. No model. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPersonalAccessService} from '../../src/personal-access/index.mjs';
import {servePersonalAccessUi} from '../../src/personal-access-ui/index.mjs';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const root=await mkdtemp(join(tmpdir(),'weftmate-ux6-perf-')),ids=Array.from({length:500},(_,index)=>`synthetic-${index}`);
const backend={getStatus:async()=>({}),listModels:async()=>[],preflight:async()=>({}),createSession:async()=>({}),sendMessage:async()=>({}),cancelSession:async()=>({}),
  describeSession:async sessionId=>({sessionId,title:`合成计划 ${sessionId}`,running:false}),
  describeSessions:async(sessionIds)=>sessionIds.map(sessionId=>({sessionId,title:`合成计划 ${sessionId}`,running:false})),
  readEvents:async({sessionId,afterSeq})=>({events:afterSeq===undefined?[{seq:0,type:'user.message',at:'2026-10-10T06:00:00Z',data:{text:`周末纸船 ${sessionId}`}}]:[],nextSeq:0,hasMore:false,hasOlder:false})};
let service,app,profile;
try{
  service=await createPersonalAccessService({root,port:0,backend,uiHandler:servePersonalAccessUi});const device=await service.enrollDevice({name:'UX6 synthetic performance'});
  for(const id of ids)await service.attachSession(id);
  const {origin}=await service.start();
  async function read(query){const start=performance.now();const response=await fetch(`${origin}/personal/v1/chats?${query}`,{headers:{authorization:`Bearer ${device.token}`}});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return {ms:performance.now()-start,result};}
  const coldEmpty=await read('scope=search&limit=30'),coldQuery=await read('scope=search&limit=200&q='+encodeURIComponent('纸船'));
  const empty=[],query=[];for(let index=0;index<20;index++){empty.push((await read('scope=search&limit=30')).ms);query.push((await read('scope=search&limit=200&q='+encodeURIComponent('纸船'))).ms);}
  const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
  const report={sessions:500,syntheticNative:true,realHttp:true,modelRequests:0,samples:20,coldEmptyMs:coldEmpty.ms,coldQueryMs:coldQuery.ms,emptyP95Ms:p95(empty),queryP95Ms:p95(query),queryIncludingDebounceP95Ms:p95(query)+160,empty,query,bodyHits:coldQuery.result.total};

  const credentials={username:'SearchPerformance',password:'synthetic-'+randomUUID()+'-password',deviceName:'UX6 synthetic UI performance'},grant=await service.issueSetupGrant();
  const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...credentials,grant:grant.grant})});assert.equal(setup.status,201);
  const auth=await setup.json(),cookie=setup.headers.get('set-cookie').split(';')[0];await fetch(origin+'/personal/v1/onboarding',{method:'PATCH',headers:{origin,cookie,'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},body:JSON.stringify({step:'first',completed:true})});
  profile=await mkdtemp(join(tmpdir(),'weftmate-ux6-perf-electron-'));const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:origin,REVIEW_THEME:'light'}});
  const page=await app.firstWindow();page.setDefaultTimeout(20000);await localUiSession(page,credentials,undefined,{mainChat:true});await page.getByRole('button',{name:'搜索',exact:true}).waitFor();await page.waitForTimeout(300);
  const uiEmpty=[],uiQuery=[];for(let index=0;index<10;index++){
    let start=performance.now();await page.keyboard.press('Control+k');await page.waitForFunction(()=>document.querySelector('#search-results')?.getAttribute('aria-busy')==='false');uiEmpty.push(performance.now()-start);
    start=performance.now();await page.getByRole('combobox',{name:'搜索内容'}).fill('纸船');await page.waitForFunction(()=>document.querySelector('#search-results')?.getAttribute('aria-busy')==='false');uiQuery.push(performance.now()-start);
    await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'搜索',exact:true}).waitFor({state:'hidden'});
  }
  Object.assign(report,{uiSamples:10,uiEmpty,uiQuery,uiEmptyP95Ms:p95(uiEmpty),uiQueryP95Ms:p95(uiQuery),realElectron:true});
  const out=resolve('tests/evidence/ux-6');await mkdir(out,{recursive:true});await writeFile(join(out,'performance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,empty:undefined,query:undefined,uiEmpty:undefined,uiQuery:undefined},null,2));
  assert.equal(report.bodyHits,500);assert.ok(report.coldEmptyMs<150);assert.ok(report.queryIncludingDebounceP95Ms<300);
  assert.ok(report.uiEmptyP95Ms<150);assert.ok(report.uiQueryP95Ms<300);
}finally{await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await service?.close();await rm(root,{recursive:true,force:true});if(profile)await rm(profile,{recursive:true,force:true});}
