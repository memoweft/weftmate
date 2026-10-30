/** Opt-in actual MiMo + pinned DSH + production account/tool/approval pipeline. */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,readdir,lstat,unlink,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {zstdDecompressSync} from 'node:zlib';
import {createServer} from 'node:http';
import {phoneRuntime} from '../../services/cloud/test/relay-phone-runtime.mjs';
import {createPersonalAccessService} from '../../src/personal-access/index.mjs';
import {createConnectorVault} from '../../src/personal-connectors/vault.mjs';
import {canonicalPublicUrl} from '../../src/personal-browser/network.mjs';
import {createRequire} from 'node:module';
import {_electron} from 'playwright';

process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
assert.ok(process.env.MIMO_API_KEY,'MIMO_API_KEY must be supplied in the process environment');
const out=resolve(process.env.WEFTMATE_TOOL_EVIDENCE ?? '.local/tool-reliability');await mkdir(out,{recursive:true});
const root=await mkdtemp(join(tmpdir(),'weftmate-tools-mimo-'));
const report={model:'mimo-v2.6-flash',realModel:true,realDsh:true,syntheticAccount:true,cases:[],root,usage:[],injections:[]};
const sourceFiles=['src/plugins/personal-native-files.mjs','src/plugins/personal-reply-content.mjs','src/plugins/weftmate-personal-reply-content.mjs','src/plugins/personal-connectors.mjs','src/plugins/weftmate-weftmod.mjs','src/plugins/personal-desktop-schema.mjs','src/plugins/personal-schedule-query.mjs','src/plugins/weftmate-personal-schedules.mjs','src/personal-access/schedules-native.mjs','src/personal-access/schedules.mjs','src/dsh-web-runtime.ts'];
report.sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
report.toolSchemas={};
const logs=[];let runtime,host,browserApp,browserServer,browserLock;
let injectDesktop=true,injectLoader=false;
const extended=process.env.WEFTMATE_TOOL_EXTENDED==='1';
const selected=new Set((process.env.WEFTMATE_TOOL_CASES??'scripts,goal,connector,cancellation,browser,jobs').split(','));
// Test-only transport fault: one real model call is made invalid before native
// argument validation. Every later decision and correction comes from MiMo.
const proxy=createServer(async(req,res)=>{
 try{const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());
  for(const tool of body.tools??[])if(tool.function)report.toolSchemas[tool.function.name]=tool.function.parameters;
  const upstream=await fetch('https://api.xiaomimimo.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${process.env.MIMO_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({...body,stream:false})});
  if(!upstream.ok){res.writeHead(upstream.status,{'content-type':'application/json'});res.end(await upstream.text());return;}
  const answer=await upstream.json();if(answer.usage)report.usage.push(answer.usage);
  const message=answer.choices[0].message;
  for(const call of message.tool_calls??[])if(injectLoader&&call.function.name==='load_tools'){
    call.function.arguments='{}';injectLoader=false;report.injections.push({kind:'missing-loader-names',callId:call.id});
  }
  for(const call of message.tool_calls??[])if(injectDesktop&&call.function.name==='weftmod'){
    const args=JSON.parse(call.function.arguments);if(args.action==='desktop'){args.desktop=17;call.function.arguments=JSON.stringify(args);injectDesktop=false;report.injections.push({kind:'invalid-desktop-object',callId:call.id});}
  }
  if(!body.stream){res.setHeader('content-type','application/json');res.end(JSON.stringify(answer));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  const delta={...message,...(message.tool_calls?{tool_calls:message.tool_calls.map((call,index)=>({index,...call}))}:{})};
  res.write(`data: ${JSON.stringify({id:answer.id,choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
  res.write(`data: ${JSON.stringify({id:answer.id,choices:[{index:0,delta:{},finish_reason:answer.choices[0].finish_reason}],usage:answer.usage})}\n\n`);res.end('data: [DONE]\n\n');
 }catch(error){res.writeHead(502);res.end(JSON.stringify({error:{message:'Synthetic model proxy failed'}}));}
});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
async function until(read,label,timeout=240000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(value)return value;await new Promise(r=>setTimeout(r,300));}throw Error('Timeout: '+label);}
async function removeLinks(dir){for(const item of await readdir(dir,{withFileTypes:true})){const file=join(dir,item.name);if((await lstat(file)).isSymbolicLink())await unlink(file);else if(item.isDirectory())await removeLinks(file);}}
async function nativeEvents(id){const dir=join(root,'dsh-home','sessions');const files=await readdir(dir,{recursive:true});const file=files.find(f=>f.includes(id)&&f.endsWith('session.jsonl.zstd'));if(!file)return [];
 const b=await readFile(join(dir,file)),rows=[];let offset=0;while(offset<b.length){const part=zstdDecompressSync(b.subarray(offset),{info:true});offset+=part.engine.bytesWritten;rows.push(...part.buffer.toString().trim().split('\n').filter(Boolean).map(JSON.parse));}return rows;}
try{
 runtime=await phoneRuntime(root,logs,{apiKey:process.env.MIMO_API_KEY,baseUrl:`http://127.0.0.1:${proxy.address().port}/v1`,modelId:report.model,nativeTaskStop:true});
 const secrets=new Map();const connectorVault=createConnectorVault({getCredential:id=>secrets.get(id)??null,saveCredential:(id,value)=>secrets.set(id,value),removeCredential:id=>secrets.delete(id),listCredentialIds:()=>[...secrets.keys()]});
 let browserReader=null,browserUrl;
 if(extended&&selected.has('browser')){
   const locks=process.env.WEFTMATE_TOOL_LOCKS;assert.ok(locks,'Provide the heavy-slot lock directory for the real browser test');
   for(const number of [1,2,3]){const file=join(locks,`heavy-${number}.lock`);try{const lease=await open(file,'wx');await lease.writeFile('TOOL-RELIABILITY '+new Date().toISOString());await lease.close();browserLock=file;break;}catch(error){if(error.code!=='EEXIST')throw error;}}
   assert.ok(browserLock,'No heavy slot available');
   browserServer=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<html><head><title>Synthetic browser page</title></head><body><h1>Tool Reliability</h1><p>SYNTHETIC_BROWSER_TOKEN</p><a href="/next">Next</a></body></html>');});await new Promise(r=>browserServer.listen(0,'127.0.0.1',r));
   const port=browserServer.address().port,fixture={hostnameSuffix:'.tool-reliability.invalid',allowedPort:port};browserUrl=`http://source.tool-reliability.invalid:${port}/`;
   const env={...process.env,WEFTMATE_TOOL_BROWSER_PROFILE:join(root,'browser-profile'),WEFTMATE_TOOL_BROWSER_PORT:String(port)};delete env.MIMO_API_KEY;delete env.ELECTRON_RUN_AS_NODE;
   browserApp=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[resolve('tests/integration/tool-reliability-browser.mjs')],env,timeout:30000});
   let state=await browserApp.evaluate(()=>globalThis.toolReader.status());
   browserReader={canonicalUrl:url=>canonicalPublicUrl(url,fixture),status:()=>state,cancelTask:(ownerId,taskId)=>{void browserApp.evaluate((_,args)=>globalThis.toolReader.cancelTask(...args),[ownerId,taskId]);},
     read:async({signal,...input})=>{const result=await browserApp.evaluate(async(_,input)=>({value:await globalThis.toolReader.read(input),status:globalThis.toolReader.status()}),input);state=result.status;return result.value;},
     close:()=>browserApp.evaluate(()=>globalThis.toolReader.close())};
 }
 host=await createPersonalAccessService({root:join(root,'account'),port:0,backend:runtime.backend,connectorVault,connectorRuntime:resolve('vendor/dsh-runtime'),browserReader});runtime.setHost(host);await runtime.start();
 const {origin,hostId}=await host.start(),grant=await host.issueSetupGrant();
 const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'SyntheticTools'+randomUUID(),password:'Synthetic-tools-password',deviceName:'synthetic-tools'})});
 assert.equal(setup.status,201);await setup.json();
 const desktopAuth=await fetch(origin+'/personal/v1/auth/desktop',{method:'POST',headers:{origin,'content-type':'application/json','x-weftmate-desktop':host.libraryDesktopToken},body:'{}'});assert.equal(desktopAuth.status,200);
 const auth=await desktopAuth.json(),cookie=desktopAuth.headers.get('set-cookie').split(';')[0];
 const api=async(path,body,method=body===undefined?'GET':'POST')=>{const response=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,cookie,'content-type':'application/json','x-weftmate-desktop':host.libraryDesktopToken,'x-weftmate-csrf':auth.csrfToken},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,error:result.error}));return result;};
 const accepted=async result=>until(async()=>{const c=(await api('/commands/'+result.command.commandId)).command;if(c.state==='rejected')throw Error(c.errorCode);return c.state==='accepted_by_dsh'&&c;},'command accepted');
 async function session(label){const folder=join(root,label);await mkdir(folder);const project=(await api('/projects',{requestId:randomUUID(),name:'Synthetic '+label,rootPath:folder,permission:'write'})).project;
   const c=await accepted(await api(`/projects/${project.projectId}/sessions`,{requestId:randomUUID(),modelProfileId:'synthetic'}));await api(`/sessions/${c.sessionId}/approval-mode`,{mode:'allow-all'},'PATCH');return {id:c.sessionId,folder};}
 async function send(s,text,{reject=false,cancel=false,answerQuestion=false}={}){const c=await accepted(await api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:hostId,sessionId:s.id,text,intent:'queue'}));let decided=false;
   await until(async()=>{if(reject){for(const a of (await api(`/sessions/${s.id}/approvals`)).approvals.filter(a=>a.status==='pending')){assert.equal(decided,false,'model retried after refusal');await api(`/sessions/${s.id}/approvals/${a.approvalId}`,{requestId:randomUUID(),outcome:'rejected'});decided=true;}}
     if(answerQuestion&&!decided){const pending=(await api(`/sessions/${s.id}/questions`)).questions.find(q=>q.status==='pending');if(pending){await api(`/sessions/${s.id}/questions/${pending.questionRpcId}`,{requestId:randomUUID(),answer:{answers:pending.questions.map(q=>({id:q.id,selected:[q.options[0].label]}))}});decided=true;}}
     if(cancel&&!decided){const rows=await nativeEvents(s.id);if(rows.some(r=>r.type==='tool/call'&&r.data.name==='pwsh')){await api(`/tasks/${c.commandId}/stop`,{requestId:randomUUID()});decided=true;}}
     const events=await nativeEvents(s.id);return events.some(e=>e.type==='turn/end');},'model turn '+s.id);
   const rows=await nativeEvents(s.id),calls=rows.filter(r=>r.type==='tool/call'),results=rows.filter(r=>r.type==='tool/result');
   const record={label:s.label??s.id,calls:calls.map(r=>({seq:r.seq,name:r.data.name,arguments:JSON.parse(r.data.arguments)})),results:results.map(r=>({seq:r.seq,content:r.data.message.content})),decided,
     final:rows.filter(r=>r.type==='assistant/message').flatMap(r=>r.data.message.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('\n')};
   report.cases.push(record);await writeFile(join(out,'progress.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({case:s.label,calls:record.calls.map(c=>c.name),completed:true}));return record;
 }
 if(!extended){
 const files=await session('files');files.label='file-search-command-and-error-recovery';await writeFile(join(files.folder,'source.txt'),'SYNTHETIC_ALPHA\n');
 const f=await send(files,'这是隔离验收。先实际 read missing.txt，遇到文件不存在后用 glob 找到 txt 文件，用 grep 查找 SYNTHETIC_ALPHA，然后 read source.txt。将它用 write 保存为 result.txt，再用 edit 将 ALPHA 改成 BETA，最后用 pwsh 读取 result.txt 核对并汇报。不要创建 missing.txt。每一步必须实际执行。');
 assert.equal((await readFile(join(files.folder,'result.txt'),'utf8')).trim(),'SYNTHETIC_BETA');for(const name of ['read','glob','grep','write','edit','pwsh'])assert.ok(f.calls.some(c=>c.name===name),name);
 assert.ok(f.results.some(r=>r.content.some(c=>c.isError)),'missing-file failure must be observed');
 const desktop=await session('desktop');desktop.label='desktop-schema-correction';
 const d=await send(desktop,'请通过 weftmod 的 windows 查询标题包含 WEFTMATE_SYNTHETIC_NO_WINDOW 的窗口。这里只做只读查询；若工具报告参数错误，请按实际反馈纠正并重试，最后如实告诉我查到了几个窗口。');
 assert.ok(d.calls.some(c=>c.name==='weftmod'&&c.arguments.desktop===17));assert.ok(d.calls.some(c=>c.name==='weftmod'&&c.arguments.desktop?.action==='windows'));
 assert.ok(d.results.some(r=>JSON.stringify(r).includes('invalid_arguments')));
 const old=await session('old-reminder');old.label='create-old-reminder';await send(old,'请在明天早上07:20提醒我：SYNTHETIC_OLD_REMINDER。实际创建一次。');
 const current=await session('new-reminder');current.label='cross-conversation-reminder-management';
 const rem=await send(current,'请先在明天早上07:00创建提醒：SYNTHETIC_NEW_REMINDER。然后查询账号所有提醒，删除另一个对话里内容为 SYNTHETIC_OLD_REMINDER 的那条，保留刚创建的新提醒。必须实际操作并重新查询核对，别要求我手动删除。');
 const schedules=(await api('/schedules')).items;assert.ok(schedules.some(r=>r.text==='SYNTHETIC_NEW_REMINDER'));assert.ok(!schedules.some(r=>r.text==='SYNTHETIC_OLD_REMINDER'));
 assert.ok(rem.calls.some(c=>['schedule_manage','schedule_delete'].includes(c.name)&&c.arguments.sessionId===old.id));
 const denied=await session('refusal');denied.label='native-approval-refusal';await writeFile(join(denied.folder,'keep.txt'),'KEEP');await api(`/sessions/${denied.id}/approval-mode`,{mode:'ask'},'PATCH');
 const refusal=await send(denied,'请用 pwsh 删除当前项目中的 keep.txt。若审批被拒绝，停止这项操作，不换工具重试。',{reject:true});assert.ok(refusal.decided);assert.equal(await readFile(join(denied.folder,'keep.txt'),'utf8'),'KEEP');
 }else{
 if(selected.has('delegation')){
 const child=await session('delegation');child.label='actual-model-native-subagent';
 const sub=await send(child,'请实际用 subagent 委派一个独立合成子任务：计算 13*17，并返回 SYNTHETIC_CHILD_221。使用前台子任务，等收到真实结果后报告，不要自己代算。');
 assert.ok(sub.calls.some(c=>c.name==='subagent'));assert.match(sub.final,/221/);
 }
 if(selected.has('question')){
 const ask=await session('question');ask.label='native-question-answer-continuation';
 const q=await send(ask,'请用 ask_user_question 让我在 SYNTHETIC_OPTION_A 和 SYNTHETIC_OPTION_B 中选一个。收到答案后告诉我最终选项，不要创建文件。',{answerQuestion:true});
 assert.ok(q.calls.some(c=>c.name==='ask_user_question'));assert.ok(q.decided);assert.match(q.final,/SYNTHETIC_OPTION_A/);
 }
 if(selected.has('browser')){
 const web=await session('browser');web.label='actual-chromium-browser-and-web-fetch';
 const w=await send(web,`请先使用 web_fetch 读取隔离测试页面 ${browserUrl}，再使用 browser 打开同一页面并通过读取返回的 snapshotId 查询 SYNTHETIC_BROWSER_TOKEN。只读这张合成页面，核对页面标题和标记，不需要研究报告或文件。`);
 for(const name of ['web_fetch','browser'])assert.ok(w.calls.some(c=>c.name===name),name);assert.match(w.final,/SYNTHETIC_BROWSER_TOKEN/);
 assert.ok(browserReader.status().readsCompleted>=2);report.browserStatus=browserReader.status();
 }
 if(selected.has('jobs')){
 const jobs=await session('jobs');jobs.label='background-job-collection';
 const j=await send(jobs,'请用 pwsh 的 run_in_background=true 启动合成命令 Start-Sleep -Seconds 2; Write-Output SYNTHETIC_JOB_DONE。然后用 job_list 和 job_output 核对并收集这个任务的输出，最后报告实际结果，不创建文件。');
 for(const name of ['pwsh','job_list','job_output'])assert.ok(j.calls.some(c=>c.name===name),name);assert.match(j.final,/SYNTHETIC_JOB_DONE/);
 }
 if(selected.has('scripts')){
 const scripts=await session('scripts');scripts.label='loader-correction-and-saved-script';injectLoader=true;
 const script=await send(scripts,'请用 weftmod_script 保存一个合成脚本，代码 return {answer:params.value+1}; ，再用参数 value=41 执行一次并核对答案。若加载工具或参数失败，请根据返回内容纠正。不要用口算代替实际脚本执行。');
 assert.ok(script.calls.filter(c=>c.name==='load_tools').length>=2);assert.ok(script.calls.some(c=>c.name==='weftmod_script'&&c.arguments.action==='run'));assert.match(script.final,/42/);
 }
 if(selected.has('goal')){
 const goal=await session('goal');goal.label='native-goal-and-todo';
 const g=await send(goal,'这是隔离工具验收。请用 create_goal 建立“核对六乘七”这个单步目标，用 todo_write 列出计算和核对步骤，实际用 pwsh 算出 6*7，再读取 get_goal 的当前状态并用 update_goal 标为完成，最后报告结果。不需要后台继续，也不创建文件。');
 for(const name of ['create_goal','get_goal','update_goal','todo_write','pwsh'])assert.ok(g.calls.some(c=>c.name===name),name);
 }
 if(selected.has('connector')){
 await api('/settings/approvals',{connector:{action:'add',name:'Synthetic structured invoices',transport:'stdio',command:process.execPath,args:[resolve('tests/fixtures/tool-reliability-connector.mjs')]}},'PATCH');
 const con=await session('connector');con.label='structured-only-native-mcp';
 const c=await send(con,'请使用 Synthetic structured invoices 连接器读取合成发票，告诉我发票标识和总金额。必须实际调用，不要猜。');assert.ok(c.calls.some(c=>c.name.startsWith('mcp__')));assert.match(c.final,/137/);assert.match(c.final,/SYNTHETIC_INVOICE/);
 }
 if(selected.has('cancellation')){
 const cancel=await session('cancellation');cancel.label='native-task-cancellation';
 const cancelled=await send(cancel,'请用 pwsh 执行 Start-Sleep -Seconds 60; Write-Output SYNTHETIC_FINISHED，等待完成后汇报。',{cancel:true});assert.ok(cancelled.decided);assert.ok(!cancelled.results.some(r=>JSON.stringify(r).includes('SYNTHETIC_FINISHED')&&!r.content.some(c=>c.isError)));
 }
 }
 report.passed=true;
}catch(error){report.passed=false;report.error={name:error.name,message:error.message};throw error;}
finally{await runtime?.close();await host?.close();await browserApp?.close();if(browserServer)await new Promise(r=>{browserServer.close(r);browserServer.closeAllConnections();});if(browserLock)await unlink(browserLock);await new Promise(r=>{proxy.close(r);proxy.closeAllConnections();});await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));await writeFile(join(out,'runtime.log'),logs.join('\n').replaceAll(process.env.MIMO_API_KEY,'[redacted]'));
 if(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/')){await removeLinks(root);await rm(root,{recursive:true,force:true});}}
