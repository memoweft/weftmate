// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Real production Electron/DSH/Core; deterministic seeded World for confirmation UX.
 * No inference/formation claim. Synthetic model only; isolated account and profile.
 */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

const repository = resolve(import.meta.dirname, '../..');
const core = 'D:/AIProjects/MemoWeft/Worktrees/fg-1-forget/py/src';
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const root = mkdtempSync(join(tmpdir(), 'weftmate-fg1-rework-'));
const profile = join(root, 'profile'), evidence = join(repository, 'tests/evidence/fg-1/rework');
mkdirSync(profile); mkdirSync(evidence, { recursive: true });
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const username = `fg1-${randomUUID()}`, password = `synthetic-${randomUUID()}-password`;
const backend = Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name=>[name,async()=>({})]));
const prep = await createPersonalAccessService({ root: join(profile,'personal-access'), port: 0, backend });
const started = await prep.start(), grant = await prep.issueSetupGrant();
const registered = await fetch(`${started.origin}/personal/v1/auth/setup`, {method:'POST',headers:{origin:started.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username,password,deviceName:'FG-1 isolated desktop'})});
assert.equal(registered.status,201); const ownerId = (await registered.json()).account.ownerId; await prep.close();
let syntheticRequests = 0;
const provider = createServer(async(request,response)=>{
  if (request.url.endsWith('/models')) { response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'fg1-synthetic',object:'model'}]})); return; }
  syntheticRequests++; response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{index:0,message:{role:'assistant',content:'合成模型回执'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const modelUrl = `http://127.0.0.1:${provider.address().port}/v1`;
const config = join(root,'memory-config.json');
writeFileSync(config,JSON.stringify({python,pythonPath:core,baseUrl:modelUrl,model:'@current',authRef:'fg1-rework'}));
const env = {...process.env};
for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
env.WEFTMATE_BASELINE_TRACE=join(root,'trace.jsonl');
let application, page, browser;
const report={realElectron:true,realDsh:true,realCore:true,seededWorld:true,formationClaim:false,paidRequests:0,checks:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const deadline=Date.now()+60000;while(Date.now()<deadline){const result=await fn();if(result)return result;await pause(100)}throw new Error('FG-1 condition timed out')}
async function api(target,path,body,method=body===undefined?'GET':'POST'){
  return target.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();
    const response=await fetch(`/personal/v1${path}`,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};},{path,body,method});
}
const db=join(profile,'personal-access/accounts',ownerId,'memory-home/memoweft/memoweft.sqlite3');
function seed(prefix,sessionId){
  const script=`import sys,json,sqlite3
sys.path.insert(0,sys.argv[1])
from memoweft.integrations.trust.revision import advance_world_revision
from memoweft.integrations.dsh_bridge import _origin_id
from memoweft.integrations.hermes.batch_adapter import owner_entity_id_for
db=sqlite3.connect(sys.argv[2],isolation_level=None)
owner,prefix,session=sys.argv[3:6]
t='2026-10-09T00:00:00Z'
text=prefix+' 原话：王小明是我的好兄弟'
turn={'role':'user','content':text,'message_id':prefix+'-msg','source_ref':'source:0'}
origin=_origin_id(message=turn,content=text,session_id=session,message_index=0,subject_id=owner,host_id='fg1-test',boundary_id=prefix)
db.execute('BEGIN IMMEDIATE')
db.execute("INSERT INTO evidence (id,subject_id,source_kind,host_id,origin_id,occurred_at,recorded_at,raw_content,summary,allow_local_read,allow_cloud_read,allow_inference) VALUES (?,?,'spoken','fg1-test',?,?,?,?,?,1,1,1)",(prefix+'-e',owner,origin,t,t,text,text))
db.execute("INSERT INTO entity (id,world_id,kind,canonical_name,created_at,updated_at) VALUES (?,?,'person','王小明',?,?)",(prefix+'-person',owner,t,t))
db.execute("INSERT INTO relationship (id,world_id,source_entity_id,target_entity_id,relation_type,content,formed_by,confidence,cred_status,created_at,updated_at) VALUES (?,?,?,?,'friend','好兄弟','stated',800,'trusted',?,?)",(prefix+'-rel',owner,owner_entity_id_for(owner),prefix+'-person',t,t))
db.execute("INSERT INTO relationship_evidence VALUES (?,?,'support')",(prefix+'-rel',prefix+'-e'))
db.execute("INSERT INTO cognition (id,subject_id,content,content_type,formed_by,confidence,cred_status,created_at,updated_at) VALUES (?,?,?,'decision','stated',800,'trusted',?,?)",(prefix+'-cog',owner,prefix+' 想组队时找王小明',t,t))
db.execute("INSERT INTO cognition_evidence VALUES (?,?,'support')",(prefix+'-cog',prefix+'-e'))
db.execute("INSERT INTO interaction_context (id,subject_id,conversation_id,episode_id,context_json,context_hash,created_at) VALUES (?,?,?,?,?,'test-only',?)",(prefix+'-ctx',owner,session,prefix,json.dumps([turn],ensure_ascii=False),t))
advance_world_revision(db)
db.execute('COMMIT')
db.close()`;
  execFileSync(python,['-c',script,core,db,ownerId,prefix,sessionId],{windowsHide:true});
}
async function memory(target,prefix){
  await target.getByRole('button',{name:'账户菜单',exact:true}).click();
  await target.getByRole('button',{name:'记忆',exact:true}).click();
  await target.getByRole('button',{name:new RegExp(prefix+' 想组队时找王小明')}).click();
  await target.getByRole('button',{name:'忘掉',exact:true}).click();
  const dialog=target.getByRole('dialog',{name:'理解详情'});
  await dialog.getByText('王小明（人物）',{exact:true}).waitFor();
  await dialog.getByText('好兄弟（关系）',{exact:true}).waitFor();
  await dialog.getByText(/将忘掉 3 项记忆/).waitFor();
  const checkbox=dialog.getByRole('checkbox',{name:'同时删除对话里含这句话的原话',exact:true});
  assert.equal(await checkbox.isChecked(),false); return {dialog,checkbox};
}
async function conversation(target,title){
  await target.getByRole('button',{name:`更多操作 ${title}`,exact:true}).click();
  await target.getByRole('dialog',{name:'对话操作'}).getByRole('button',{name:'删除对话',exact:true}).click();
  const dialog=target.getByRole('dialog',{name:'删除对话',exact:true});
  await dialog.getByRole('checkbox',{name:'同时忘掉从这段对话形成的记忆',exact:true}).check();
  await dialog.getByText(/将一起忘掉 3 项记忆/).waitFor();
  const checkbox=dialog.getByRole('checkbox',{name:'同时删除对话里含这句话的原话',exact:true});
  assert.equal(await checkbox.isChecked(),false);return {dialog,checkbox};
}
try{
  application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[join(import.meta.dirname,'m2-exit-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0',`--personal-memory-config=${config}`],cwd:repository,env,timeout:90000});
  page=await application.firstWindow({timeout:90000});page.setDefaultTimeout(20000);
  await page.waitForURL('**/personal/v1/ui',{timeout:90000}); await localUiSession(page,{username,password},'FG-1 desktop');
  const requestId=randomUUID();assert.equal((await api(page,'/account/models',{requestId,name:'fg1-rework',baseUrl:modelUrl,modelId:'fg1-synthetic',apiKey:'synthetic-test-key'})).status,202);
  await until(async()=>{const result=await api(page,`/account/models/by-request/${requestId}`);return result.body.operation?.status==='succeeded'});
  const model=(await api(page,'/models')).body.models.find(model=>model.name==='fg1-rework');
  assert.ok(model);assert.equal((await api(page,'/settings/models',{backgroundModelProfileId:model.id},'PATCH')).status,200);
  await until(async()=>['ready','degraded'].includes((await api(page,'/memory/status')).body.state));
  const created=await api(page,'/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:(await api(page,'/status')).body.hostId,modelProfileId:model.id});
  assert.equal(created.status,202);
  const command=await until(async()=>{const row=(await api(page,`/commands/${created.body.command.commandId}`)).body.command;return row.state==='accepted_by_dsh'&&row});
  seed('desktop',command.sessionId);await page.reload();await page.getByRole('button',{name:'账户菜单',exact:true}).waitFor();
  const first=await memory(page,'desktop');
  await page.screenshot({path:join(evidence,'desktop-cascade-original-option.png')});
  const pre=await api(page,'/memory/items/cognition/desktop-cog/forget-preview');assert.equal(pre.body.itemCount,3);
  const deletion=page.waitForRequest(request=>request.method()==='DELETE'&&request.url().endsWith('/memory/items/cognition/desktop-cog'));
  await first.dialog.getByRole('button',{name:'确认忘掉',exact:true}).click();assert.equal((await deletion).postDataJSON().deleteConversationSnippets,false);
  await until(async()=>!(await api(page,'/memory/items?kind=cognition&query=desktop')).body.items.length);
  report.checks.push('desktop: cascade names/count, default snippets false, actual Core deletion');
  seed('phone',command.sessionId);
  browser=await chromium.launch({headless:true});const phone=await browser.newPage({viewport:{width:390,height:844}});
  await phone.goto(page.url());await localUiSession(phone,{username,password},'FG-1 phone web');
  await phone.getByRole('button',{name:'切换会话侧栏',exact:true}).click();
  const mobile=await memory(phone,'phone');await mobile.checkbox.check();
  await phone.screenshot({path:join(evidence,'phone-cascade-original-option.png')});
  const phoneDeletion=phone.waitForRequest(request=>request.method()==='DELETE'&&request.url().endsWith('/memory/items/cognition/phone-cog'));
  await mobile.dialog.getByRole('button',{name:'确认忘掉',exact:true}).click();assert.equal((await phoneDeletion).postDataJSON().deleteConversationSnippets,true);
  await until(async()=>!(await api(phone,'/memory/items?kind=cognition&query=phone')).body.items.length);
  report.checks.push('phone web: cascade names/count, snippets true reaches DELETE, actual Core deletion');
  seed('session',command.sessionId);await page.reload();
  const sessions=(await api(page,'/sessions')).body.sessions, title=sessions.find(row=>row.sessionId===command.sessionId).title||'新对话';
  const last=await conversation(page,title);await last.checkbox.check();
  await page.screenshot({path:join(evidence,'desktop-conversation-forget.png')});
  const sessionDeletion=page.waitForRequest(request=>request.method()==='DELETE'&&request.url().endsWith(`/sessions/${command.sessionId}`));
  await last.dialog.getByRole('button',{name:'永久删除',exact:true}).click();const body=(await sessionDeletion).postDataJSON();
  assert.equal(body.forgetMemories,true);assert.equal(body.deleteConversationSnippets,true);assert.ok(Number.isSafeInteger(body.memoryWorldRevision));
  await until(async()=>!(await api(page,'/sessions')).body.sessions.some(row=>row.sessionId===command.sessionId));
  report.checks.push('desktop conversation: preview recovered context, aggregate count, optional snippets true, native deletion');
  report.syntheticRequests=syntheticRequests;
  report.completedAt=new Date().toISOString();writeFileSync(join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{
  await browser?.close();if(application){await application.evaluate(({app})=>app.quit()).catch(()=>{});await application.close().catch(()=>{});}
  await new Promise(resolve=>provider.close(resolve));
  console.log(`Isolated profile: ${root}`);
}
