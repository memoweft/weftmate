// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtemp,mkdir,writeFile,readFile,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root=await mkdtemp(join(tmpdir(),'weftmate-st4-native-')),profile=join(root,'profile'),out=resolve('tests/evidence/st-4');await mkdir(profile);await mkdir(out,{recursive:true});
let wroteArtifact=false;
const model=createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part;res.setHeader('content-type','application/json');
 if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'synthetic-st4-model'}]}));
 if(!req.url?.endsWith('/chat/completions')){res.writeHead(404);return res.end('{}');}
 const body=raw?JSON.parse(raw):{};const write=body.tools?.some(row=>(row.function?.name ?? row.name)==='write')&&!wroteArtifact;
 const load=!write&&!wroteArtifact&&body.tools?.some(row=>(row.function?.name ?? row.name)==='load_tools');
 if(write)wroteArtifact=true;
 const tool=load?{id:'st4-load-write',type:'function',function:{name:'load_tools',arguments:JSON.stringify({names:['write']})}}:{id:'st4-write-result',type:'function',function:{name:'write',arguments:JSON.stringify({file_path:'st4-result.md',content:'# 合成 A 成果\n\n合成成果原件。\n'})}};
 const delta=write||load?{role:'assistant',tool_calls:[{index:0,...tool}]}:{role:'assistant',content:'收到合成消息。'},reason=write||load?'tool_calls':'stop';
 if(body.stream){res.setHeader('content-type','text/event-stream');return res.end('data: '+JSON.stringify({id:'synthetic-st4',choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'synthetic-st4',choices:[{index:0,delta:{},finish_reason:reason}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})+'\n\ndata: [DONE]\n\n');}
 return res.end(JSON.stringify({id:'synthetic-st4',object:'chat.completion',model:'synthetic-st4-model',choices:[{index:0,message:write||load?{role:'assistant',tool_calls:[tool]}:{role:'assistant',content:'收到合成消息。'},finish_reason:reason}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));
});await new Promise(r=>model.listen(0,'127.0.0.1',r));
const baseUrl=`http://127.0.0.1:${model.address().port}/v1`,username='ST4SyntheticA',password='synthetic-'+randomUUID();
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name=>[name,async()=>({})]));
await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
await writeFile(join(profile,'weftmate-settings.json'),JSON.stringify({schemaVersion:3,models:{activeId:'synthetic-st4',profiles:[{id:'synthetic-st4',name:'合成 ST-4 模型',provider:'openai-compatible',baseUrl,model:'synthetic-st4-model'}]}}));
const memoryConfig=join(root,'memory-config.json');await writeFile(memoryConfig,JSON.stringify({python:'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',pythonPath:'D:/AIProjects/MemoWeft/Core/py/src',baseUrl,model:'@current',authRef:'synthetic-st4'}));
const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});const prepared=await prep.start(),grant=await prep.issueSetupGrant();
const setup=await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username,password,deviceName:'ST4 A'})});assert.equal(setup.status,201);const a=(await setup.json()).account.ownerId;
const register=await fetch(prepared.origin+'/personal/v1/auth/register',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({username:'ST4SyntheticB',password,deviceName:'ST4 B'})});assert.equal(register.status,201);const b=(await register.json()).account.ownerId;await prep.close();
const bRoot=join(profile,'personal-access','accounts',b);await mkdir(bRoot,{recursive:true});await writeFile(join(bRoot,'untouched.txt'),'Synthetic B remains unchanged');
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');const bHash=await hash(join(bRoot,'untouched.txt'));
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];env.WEFTMATE_BASELINE_TRACE=join(root,'requests.jsonl');
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let app,page,hostLog='';
async function until(check,ms=60000){const end=Date.now()+ms;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,150));}throw Error('ST4 native timeout');}
async function api(path,body,method=body?'POST':'GET'){return page.evaluate(async({path,body,method})=>{const auth=await(await fetch('/personal/v1/auth/me')).json();return window.weftmateDesktop.fetchPersonal(location.origin+'/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},body:body?JSON.stringify(body):undefined},crypto.randomUUID());},{path,body,method});}
async function launch(){app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[resolve('tests/integration/st-4-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0',`--personal-memory-config=${memoryConfig}`],env,timeout:90000});app.process().stdout?.on('data',part=>{hostLog+=String(part)});app.process().stderr?.on('data',part=>{hostLog+=String(part)});page=await app.firstWindow({timeout:90000});await page.waitForURL('**/personal/v1/ui');await app.evaluate(()=>globalThis.st4SeedCredentials());await localUiSession(page,{username,password});}
try{
 await launch();const status=await until(async()=>{const value=await api('/status');return value.status===200&&value.body;});console.log('native host logged in');
 const created=await api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:status.hostId,modelProfileId:'synthetic-st4'});assert.equal(created.status,202,JSON.stringify(created.body));
 const command=await until(async()=>{const value=(await api('/commands/'+created.body.command.commandId)).body.command;return value.state==='accepted_by_dsh'&&value;});
 const uploaded=await page.evaluate(async input=>{const auth=await(await fetch('/personal/v1/auth/me')).json();const response=await fetch('/personal/v1/sync/attachments/'+input.id+'?conversationId='+input.sessionId+'&messageId='+input.messageId+'&name=st4-note.txt',{method:'PUT',headers:{'content-type':'text/plain','x-weftmate-csrf':auth.csrfToken,'x-weftmate-sha256':input.sha},body:input.text});return {status:response.status,body:await response.json()};},{id:randomUUID(),sessionId:command.sessionId,messageId:(globalThis.st4MessageId=randomUUID()),text:'合成附件原件',sha:createHash('sha256').update('合成附件原件').digest('hex')});assert.equal(uploaded.status,201,JSON.stringify(uploaded.body));
 const sent=await api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:status.hostId,sessionId:command.sessionId,text:'S'.repeat(5000)+'合成 A 的对话内容，喜欢蓝色织物。',originalAttachments:[uploaded.body.attachment],attachmentMessageId:globalThis.st4MessageId});assert.equal(sent.status,202);
 await until(async()=>{const events=(await api(`/sessions/${command.sessionId}/events?limit=200`)).body.events;return events?.some(row=>row.type==='turn.ended');});
 const sources=await until(async()=>{const result=await app.evaluate((_,id)=>globalThis.st4Memory.query(id,'query_evidence',{operation:'list'}),a);return result.evidence?.find(row=>row.raw_content?.includes('蓝色织物'));});
 const seed="import sqlite3,sys\ndb=sqlite3.connect(sys.argv[1])\ndb.execute(\"INSERT INTO cognition(id,subject_id,content,content_type,formed_by,confidence,cred_status,created_at,updated_at) VALUES(?,?,?,'preference','stated',80,'stable','2026-10-10T00:00:00Z','2026-10-10T00:00:00Z')\",('cognition-st4-native',sys.argv[2],'合成 A 喜欢蓝色织物'))\ndb.execute(\"INSERT INTO cognition_evidence(cognition_id,evidence_id,relation) VALUES(?,?,'support')\",('cognition-st4-native',sys.argv[3]))\ndb.commit()\ndb.close()";execFileSync('D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',['-c',seed,join(profile,'personal-access','accounts',a,'memory-home','memoweft','memoweft.sqlite3'),a,sources.evidence_id],{windowsHide:true});
 const storage=await until(async()=>{const value=(await api('/data')).body;return value.statistics&&value;});assert.ok(storage.statistics.totalBytes>0);
 const exportPath=join(root,'export');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},exportPath);
 const exported=await page.evaluate(()=>window.weftmateDesktop.exportAllData());assert.equal(exported.operation.kind,'export');
 const exportResult=await until(async()=>{const op=(await api('/data/operations')).body.operation;if(op.state==='failed')throw Error(JSON.stringify(op));return op.state==='completed'&&op;});
 const manifest=JSON.parse(await readFile(join(exportPath,'manifest.json'),'utf8'));for(const file of manifest.files)assert.equal(await hash(join(exportPath,file.path)),file.sha256);assert.ok(manifest.files.some(row=>row.path.startsWith('conversations/')));assert.ok(manifest.files.some(row=>row.path==='memory/portable-v4.json'));
 assert.ok(manifest.files.some(row=>row.path.startsWith('files/results/')),'native artifact original is exported');assert.ok(manifest.files.some(row=>row.path.startsWith('files/uploads/')),'uploaded original is exported');assert.ok((await readFile(join(exportPath,'conversations',command.sessionId+'.md'),'utf8')).includes('S'.repeat(5000)),'long message is complete');
 const portable=JSON.parse(await readFile(join(exportPath,'memory/portable-v4.json'),'utf8'));assert.equal((await app.evaluate((_,value)=>globalThis.st4Memory.query(value.owner,'portable_plan',{bundle:value.bundle}),{owner:a,bundle:portable})).valid,true);
 const deleted=await api('/data/delete',{accountName:username,confirm:true});assert.equal(deleted.status,202);
 const result=await until(async()=>{const op=await page.evaluate(id=>window.weftmateDesktop.dataOperation(id),deleted.body.operation.id);if(op?.state==='failed')throw Error(JSON.stringify(op));return op?.state==='completed'&&op;});
 assert.equal((await api('/sessions')).body.sessions.length,0);assert.equal((await api('/library')).body.items.length,0);assert.equal((await api('/usage')).body.total.requests,0);
 assert.equal(await hash(join(bRoot,'untouched.txt')),bHash);
 await app.close();app=null;await launch();assert.equal((await api('/sessions')).body.sessions.length,0);assert.equal((await api('/library')).body.items.length,0);
 const close=await api('/data/close-account',{accountName:username,confirm:true});assert.equal(close.status,202);
 await until(async()=>{const op=await page.evaluate(id=>window.weftmateDesktop.dataOperation(id),close.body.operation.id);if(op?.state==='failed')throw Error(JSON.stringify(op));return op?.state==='completed';});
 const disk=JSON.parse(await readFile(join(profile,'personal-access','store.json'),'utf8'));assert.equal(disk.accounts[a].account,null);assert.equal(disk.accounts[b].account.username,'ST4SyntheticB');assert.equal(await hash(join(bRoot,'untouched.txt')),bHash);
 await writeFile(join(out,'native-checks.json'),JSON.stringify({realElectron:true,realDsh:true,realCore:true,syntheticModel:true,syntheticAccounts:2,randomPorts:true,nativeSaveDialogStub:true,manifestHashes:true,emptyInterfaces:true,restartEmpty:true,localClosure:true,otherAccountUnchanged:true,exportFileCount:manifest.files.length,artifactAndAttachmentOriginals:true,completeLongMessage:true,portableImportValidated:true},null,2)+'\n');console.log('ST4 real native lifecycle passed');
}catch(error){console.log(hostLog.slice(-8000));if(page)await page.screenshot({path:join(out,'native-failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();model.closeAllConnections();await new Promise(r=>model.close(r));await rm(root,{recursive:true,force:true});}
