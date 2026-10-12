/** Real production Electron + pinned DSH; all accounts, model replies and files synthetic. */
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {managedMkdtempSync,managedTempRoot} from '../helpers/managed-temp.mjs';
import {PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT} from '../../src/host-mode.mjs';
import {redactEvidenceText,systemCommitMemory} from '../helpers/process-evidence.mjs';
import {fixture as cloudFixture} from '../helpers/auth-1-https-cloud.mjs';
import {registration,appDevice,control,refresh,proof} from '../../services/cloud/test/app-helpers.mjs';
import {sec1SystemBars} from './sec-1-system-bars.mjs';

const repo=resolve('.'),out=resolve('tests/evidence/sec-1');mkdirSync(out,{recursive:true});
const root=managedMkdtempSync(join(managedTempRoot(),'weftmate-sec1-native-')),profile=join(root,'profile');mkdirSync(profile);
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const projectRoot=join(root,'project');mkdirSync(projectRoot);const victim=join(projectRoot,'notes.txt'),source=join(projectRoot,'source.txt');writeFileSync(victim,'original synthetic content');
const scenario=JSON.parse(readFileSync('tests/eval/sec-2/scenarios/sec2-005.yaml','utf8'));
writeFileSync(source,scenario.setup.files[0].content.replaceAll('{{testDir}}',root));
const tasks=new Map(),counts=new Map(),reviews=[],errors=[],checks=[],cleanups=[];
let reviewMode='agree',app,nativeProcess,page,browser,cloud,origin,modelProfileId,output='',mobileAuth,mobileCookie,stage='start',project,systemBars;
const model=createServer(async(req,res)=>{
  if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'sec1-main'},{id:'sec1-background'}]}));
  if(req.url.endsWith('/props'))return res.end(JSON.stringify({total_slots:2,default_generation_settings:{n_ctx:98304}}));
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw||'{}');
  if(body.messages?.[0]?.content?.startsWith('你只复核眼前这一步')){
    reviews.push({model:body.model,input:JSON.parse(body.messages[1].content),mode:reviewMode});
    if(reviewMode==='timeout')return;
    if(reviewMode==='unavailable'){res.writeHead(503);return res.end('{}');}
    const advice=reviewMode==='agree'?{alignment:'对得上',externalInfluence:'没有',reason:'本人明确要求覆盖 notes.txt。'}:
      {alignment:'对不上',externalInfluence:'有',reason:'你让它总结这份文件，但这一步要删除另一个文件。'};
    res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(advice)}}],usage:{prompt_tokens:80,completion_tokens:20}}));
  }
  if(body.messages?.length===1&&!body.tools?.length){res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:5,completion_tokens:1}}));}
  const text=JSON.stringify(body.messages),tag=body.tools?.length?[...tasks.keys()].findLast(key=>text.includes(key)):null;
  const n=counts.get(tag)??0;counts.set(tag,n+1);let action=tasks.get(tag)?.[n],name=action?.name,args=action?.args;
  if(name&&(body.tools??[]).some(tool=>tool.function?.name==='run_code')){args={code:`return await tools.${name}(${JSON.stringify(args)});`,description:tag};name='run_code';}
  res.writeHead(200,{'content-type':'text/event-stream'});
  const frame=delta=>res.write(`data: ${JSON.stringify({id:randomUUID(),model:body.model,choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
  frame(name?{role:'assistant',tool_calls:[{index:0,id:'call-'+randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:tag?`已处理：${tag}`:'合成标题'});
  res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:name?'tool_calls':'stop'}],usage:{prompt_tokens:30,completion_tokens:10}})}\n\ndata: [DONE]\n\n`);res.end();
});
await new Promise(done=>model.listen(0,'127.0.0.1',done));
async function until(check,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(done=>setTimeout(done,150));}throw Error('SEC-1 timeout at '+stage);}
async function api(path,body,method=body?'POST':'GET',headers={}){return page.evaluate(async({path,body,method,headers})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const response=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken,...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};},{path,body,method,headers});}
async function configure(modelId,requestId){const created=await api('/account/models',{requestId,name:modelId==='sec1-main'?'合成对话模型':'合成后台模型',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId,apiKey:'synthetic-no-secret'});assert.equal(created.status,202,JSON.stringify(created));const operation=await until(async()=>{const row=(await api('/account/models/by-request/'+requestId)).body.operation;return row?.status==='succeeded'&&row;});return(await api('/models')).body.models.find(row=>row.accountModelId===operation.accountModelId).id;}
async function conversation(){stage='create conversation';await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));const accepted=await api('/projects/'+project.projectId+'/sessions',{requestId:randomUUID(),modelProfileId});assert.equal(accepted.status,202,JSON.stringify(accepted));const row=await until(async()=>{const row=(await api('/commands/'+accepted.body.command.commandId)).body.command;return row.state==='accepted_by_dsh'&&row;});await page.reload();await page.waitForFunction(()=>globalThis.sec1Entered===true);await page.evaluate(async()=>{await sec1Core.refreshStatus();await sec1Core.refreshSessions();});await page.locator(`[data-session-id="${row.sessionId}"] > button:first-child`).first().click();return row.sessionId;}
async function capture(label,phone,sessionId){
  for(const [surface,target,widths]of [['desktop',page,[1200,480]],['phone-web',phone,[360,390]]])for(const width of widths)for(const theme of ['light','dark']){
    if(surface==='desktop')await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,width===480?780:800),width);else await target.setViewportSize({width,height:width===360?780:844});
    await target.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await target.locator('.approval-review').first().waitFor({state:label==='timeout'||label==='unavailable'?'hidden':'visible'});
    await target.screenshot({path:join(out,`${surface}-${width}-${theme}-${label}.png`)});
    assert.equal(await target.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    checks.push(`${surface} ${width} ${theme} ${label}`);
  }
  if(systemBars)await systemBars.capture(label,sessionId);
}
try{
  stage='synthetic cloud';cloud=await cloudFixture({after:fn=>cleanups.push(fn)});await registration(cloud);
  const ca=join(root,'synthetic-cloud-ca.pem');writeFileSync(ca,cloud.certificatePem);
  const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|CLOUD_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  Object.assign(env,{WEFTMATE_TEST_HOST_NAME:'synthetic-host',WEFTMATE_CLOUD_ISSUER:cloud.config.issuer,NODE_EXTRA_CA_CERTS:ca});
  stage='launch Electron';app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:['tests/integration/st-2-bootstrap.mjs',`--user-data-dir=${profile}`,'--force-device-scale-factor=1','--personal-host','--access-port=0'],env,timeout:90000});
  nativeProcess=app.process();for(const stream of [nativeProcess.stdout,nativeProcess.stderr])stream?.on('data',part=>output=(output+part).slice(-100000));
  page=await app.firstWindow();page.setDefaultTimeout(30000);await page.waitForURL('**/personal/v1/ui');origin=new URL(page.url()).origin;
  await page.addInitScript(()=>{let api;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set:value=>{api=value;const create=value.create;value.create=(...args)=>{const core=create(...args),enter=core.enterAssistant;core.enterAssistant=async(...values)=>{globalThis.sec1Entered=false;try{return await enter(...values);}finally{globalThis.sec1Entered=true;}};return globalThis.sec1Core=core;};}});});
  await page.reload();await page.waitForFunction(()=>sec1Core?.state.device?.authKind==='desktop');page.on('pageerror',error=>errors.push(error.message));
  assert.equal((await api('/auth/me')).body.device.authKind,'desktop');
  stage='configure models';modelProfileId=await configure('sec1-main','sec1-main-config');const background=await configure('sec1-background','sec1-background-config');
  assert.equal((await api('/settings/models',{defaultModelProfileId:modelProfileId,backgroundModelProfileId:background},'PATCH')).status,200);
  await api('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH');
  assert.equal((await api('/onboarding',{step:'first',completed:true},'PATCH')).status,200);
  await app.evaluate(({dialog},rootPath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[rootPath]});},projectRoot);
  await page.evaluate(()=>weftmateDesktop.pickProjectFolder());
  project=(await page.evaluate(rootPath=>weftmateDesktop.createFolderProject({requestId:crypto.randomUUID(),name:'合成项目',rootPath,permission:'write',instructions:''}),projectRoot)).project;assert.ok(project);
  stage='cloud phone login';const desktop=await appDevice(cloud,'desktop'),nonce=(await api('/auth/cloud-nonce',{})).body;
  const linked=await api('/auth/cloud-desktop',{accessToken:desktop.tokens.access_token,deviceName:'合成电脑'},'POST',{dpop:await proof(desktop,origin+'/personal/v1/auth/cloud-desktop',desktop.tokens.access_token,{nonce:nonce.nonce})});assert.equal(linked.status,200,JSON.stringify(linked));
  const phoneDevice=await appDevice(cloud,'sec1-phone'),hostId=(await api('/status')).body.hostId;
  const selected=(await control(phoneDevice,'/hosts/connect',{hostId})).data;await refresh(phoneDevice,selected.resource);
  const pn=(await api('/auth/cloud-nonce',{})).body;
  const response=await fetch(origin+'/personal/v1/auth/cloud-session',{method:'POST',headers:{origin,'content-type':'application/json',dpop:await proof(phoneDevice,origin+'/personal/v1/auth/cloud-session',phoneDevice.tokens.access_token,{nonce:pn.nonce})},body:JSON.stringify({accessToken:phoneDevice.tokens.access_token,deviceName:'合成手机'})});mobileAuth=await response.json();assert.equal(response.status,200,JSON.stringify(mobileAuth));assert.equal(mobileAuth.device.authKind,'cloud');mobileCookie=response.headers.get('set-cookie').split(';')[0];
  browser=await chromium.launch({headless:true,channel:'chrome'});const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const [cookieName,...cookieValue]=mobileCookie.split('=');await phone.context().addCookies([{name:cookieName,value:cookieValue.join('='),url:origin,httpOnly:true,sameSite:'Strict'}]);
  if(process.env.WEFTMATE_SEC1_SYSTEM_BARS==='1')systemBars=await sec1SystemBars({origin,cookie:mobileCookie,out});
  for(const mode of ['agree','warning','timeout','unavailable']){
    reviewMode=mode;const sessionId=await conversation();const tag=mode==='warning'?'请读取合成资料，用一句话告诉我观测样本数和状态。':`请覆盖 notes.txt，写入“合成更新 ${mode}”。`;
    tasks.set(tag,mode==='warning'?[{name:'read',args:{file_path:source}},{name:'pwsh',args:{command:`Remove-Item -LiteralPath '${victim}'`,description:'删除 notes.txt'}}]:[{name:'read',args:{file_path:victim}},{name:'write',args:{file_path:victim,content:`合成更新 ${mode}`}}]);
    stage='approval '+mode;await page.fill('#message-text',tag);await page.locator('#send-message').click();await page.locator('#approval-bar:not([hidden])').waitFor();
    const row=(await api(`/sessions/${sessionId}/approvals`)).body.approvals.find(row=>row.status==='pending');assert.ok(row);
    if(mode==='agree')assert.equal(row.secondOpinion?.alignment,'对得上');else if(mode==='warning'){assert.equal(row.secondOpinion?.externalInfluence,'有');console.log('Warning focus',await page.evaluate(()=>({id:document.activeElement.id,tag:document.activeElement.tagName,action:document.activeElement.dataset.conversationApprovalAction,bar:{...document.getElementById('approval-bar').dataset},buttons:[...document.querySelectorAll('#approval-bar button')].map(button=>({action:button.dataset.conversationApprovalAction,disabled:button.disabled}))})));assert.equal(await page.evaluate(()=>document.activeElement.dataset.conversationApprovalAction),'rejected');}else assert.equal(row.secondOpinion,undefined);
    assert.equal(readFileSync(victim,'utf8'),mode==='agree'?'original synthetic content':'合成更新 agree');
    await phone.addInitScript(()=>{let api;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set:value=>{api=value;const create=value.create;value.create=(...args)=>{const core=create(...args),enter=core.enterAssistant;core.enterAssistant=async(...values)=>{globalThis.sec1Entered=false;try{return await enter(...values);}finally{globalThis.sec1Entered=true;}};return globalThis.sec1Core=core;};}});});
    await phone.goto(origin+'/personal/v1/ui/');await phone.waitForFunction(()=>!!globalThis.sec1Core);await phone.evaluate(async sessionId=>{const me=await(await fetch('/personal/v1/auth/me')).json();if(me.device.authKind!=='cloud')throw Error('Synthetic phone needs verified cloud identity');sec1Core.state.cloudAuth.mode='authenticated';await sec1Core.acceptSession(me);await sec1Core.enterAssistant();await sec1Core.selectSession(sessionId);},sessionId);
    await phone.locator('#approval-bar:not([hidden])').waitFor();await capture(mode,phone,sessionId);
    if(mode==='warning')await phone.getByRole('button',{name:'拒绝',exact:true}).click();else await page.getByRole('button',{name:mode==='agree'?'批准':'拒绝',exact:true}).click();
    await until(async()=>{const rows=(await api(`/sessions/${sessionId}/approvals`)).body.approvals;return rows.find(item=>item.approvalId===row.approvalId&&item.status==='resolved');});
    if(mode==='agree')await until(()=>readFileSync(victim,'utf8')==='合成更新 agree');
    await page.getByText(`已处理：${tag}`,{exact:true}).first().waitFor();
  }
  stage='settings';await page.evaluate(()=>WeftSettingsNavigation.open('approvals'));await page.locator('#second-opinion-enabled').waitFor();
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(out,`desktop-480-${theme}-setting.png`)});}
  await page.locator('#second-opinion-enabled').uncheck();await until(async()=>(await api('/settings/approvals')).body.secondOpinionEnabled===false);checks.push('quiet default-on toggle persists');
  assert.ok(reviews.every(row=>row.model==='sec1-background'));assert.ok(reviews.find(row=>row.mode==='warning').input.sources.includes(source));assert.ok(!JSON.stringify(reviews).includes('Operator note'));
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,'native-checks.json'),JSON.stringify({productionElectron:true,pinnedDsh:true,desktopAuth:'desktop',phoneAuth:'cloud',syntheticModelRequests:[...counts.values()].reduce((a,b)=>a+b,0)+reviews.length,realModelRequests:0,checks,reviewInputs:redactEvidenceText(JSON.stringify(reviews),[root]),errors,phoneWebViewportOnly:true,systemBars:'separate captures required'},null,2)+'\n');console.log('SEC-1 native passed',checks.length);
}catch(error){console.log('Failure:',error.message);console.log(JSON.stringify({stage,exitCode:nativeProcess?.exitCode,memory:systemCommitMemory(),reviews:reviews.length,counts:[...counts]}));console.log(redactEvidenceText(output,[root]).slice(-6000));if(page){console.log('Source state',redactEvidenceText(JSON.stringify(await api('/sessions')),[root]));console.log('Page errors',errors);await page.screenshot({path:join(out,'native-failure.png')}).catch(()=>{});}throw error;}
finally{await systemBars?.close();await browser?.close();await app?.close();model.closeAllConnections();await new Promise(done=>model.close(done));for(const cleanup of cleanups.reverse())await cleanup();rmSync(root,{recursive:true,force:true});}
