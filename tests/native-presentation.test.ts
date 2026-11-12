// Protects account changes, notification field contracts and native memory/login actions during presentation migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

async function fixture(){
  const sandbox=vm.createContext({URLSearchParams,URL,TextEncoder,console});
  vm.runInContext('globalThis.WeftUiCore={factories:{}}',sandbox);
  for(const file of ['personalization.js',...['base','preferences','information','memory','account','tools'].map(x=>`native-presentation/${x}.js`)])vm.runInContext(await readFile(new URL('../src/ui-core/'+file,import.meta.url),'utf8'),sandbox);
  const c={state:{authEpoch:1,owner:'owner-a'},core:{state:{identityGeneration:1},syncMobileIdentity(){}}};
  return {n:sandbox.WeftUiCore.nativePresentation,c,sandbox};
}
const plain=x=>JSON.parse(JSON.stringify(x));
const rows=view=>view.sections.flatMap(s=>s.rows);

test('a late native page read cannot expose a previous account',async()=>{
  const {n,c}=await fixture();let finish;
  n.register('deferred',{read:()=>new Promise(resolve=>finish=resolve)});
  const pending=n.request(c,'deferred');c.state.authEpoch++;c.state.owner='owner-b';
  finish({title:'previous account'});await assert.rejects(pending,/账户已切换/);
});
test('account changes during an action stop the following read',async()=>{
  const {n,c}=await fixture();let reads=0;
  n.register('write',{act:async()=>{c.core.state.identityGeneration++;return {};},read:async()=>{reads++;return {};}});
  await assert.rejects(n.request(c,'write','save'),/账户已切换/);assert.equal(reads,0);
});
test('a form from A is rejected before a local operation under stable B',async()=>{
  const {n,c}=await fixture();let writes=0;
  c.expectedOwner='owner-a';c.state.owner='owner-b';
  n.register('local',{act:async()=>{writes++;return {};},read:async()=>({})});
  await assert.rejects(n.request(c,'local','save'),/账户已切换/);assert.equal(writes,0);
});
test('unknown native destinations fail locally',async()=>{
  const {n,c}=await fixture();await assert.rejects(n.request(c,'missing'),/页面暂时无法打开/);
});
test('notification drafts use the existing DND keys and preserve explicit off values',async()=>{
  const {n,c}=await fixture();const writes=[];
  c.call=async()=>({systemAllowed:true});c.core.loadNotificationSettings=async()=>({settings:{dndEnabled:false,dndStart:'22:00',dndEnd:'08:00',approvalException:false,dailyLimit:null}});
  c.core.saveNotificationSettings=async patch=>writes.push(plain(patch));
  const page=await n.request(c,'notifications');assert.equal(rows(page.view).find(x=>x.key==='dndEnabled').value,false);
  assert.equal(rows(page.view).find(x=>x.key==='dndStart').value,'22:00');
  await n.request(c,'notifications','quiet',{}, {dndStart:'23:15',dndEnd:'07:30'});
  await n.request(c,'notifications','notification',{key:'approvalException',value:false});
  assert.deepEqual(writes,[{dndStart:'23:15',dndEnd:'07:30'},{approvalException:false}]);
});
test('permission defaults still follow global ask and restricted allow-all rules',async()=>{
  const {n,c}=await fixture();let mode='ask';
  c.core.readPermissionRules=async()=>({mode,types:[{id:'read',label:'读取',default:'allow'},{id:'send',label:'发送',default:'ask',restricted:true}]});
  let view=(await n.request(c,'approvals')).view;
  assert.equal(rows(view).find(x=>x.key==='read').value,'ask');
  mode='allow-all';view=(await n.request(c,'approvals')).view;
  assert.equal(rows(view).find(x=>x.key==='read').value,'allow');assert.equal(rows(view).find(x=>x.key==='send').value,'ask');
});
test('login errors stay visible and credentials never enter a returned view',async()=>{
  const {n,c}=await fixture();const state={mode:'login',step:'email',email:'',error:''};let received;
  c.accountCore={cloudAuthView:()=>state,cloudLogin:async values=>{received=values;state.error='邮箱或密码不对，请重试。';}};
  const result=await n.request(c,'login','submit',{}, {email:'person@example.test',password:'test-only-secret'});
  assert.equal(received.password,'test-only-secret');assert.match(JSON.stringify(result),/邮箱或密码不对/);
  assert.doesNotMatch(JSON.stringify(result),/test-only-secret/);assert.equal(result.effect,undefined);
});
test('offline login enters the password journey and countdown reads become actionable',async()=>{
  const {n,c}=await fixture();let started=0;
  const state={mode:'offline',step:'email',email:'person@example.test',resendSeconds:0,retrySeconds:0};
  c.accountCore={cloudAuthView:()=>state,startCloudJourney:mode=>{started++;state.mode=mode;}};
  let result=await n.request(c,'login');assert.equal(started,1);
  assert.equal(rows(result.view).find(x=>x.action==='submit').label,'登录');
  state.mode='code-login';state.step='code';state.resendSeconds=2;state.retrySeconds=2;
  result=await n.request(c,'login');assert.equal(result.view.refreshAfterMs,1000);
  assert.equal(rows(result.view).find(x=>x.action==='resend').enabled,false);
  state.resendSeconds=0;state.retrySeconds=0;
  result=await n.request(c,'login');assert.equal(result.view.refreshAfterMs,0);
  assert.equal(rows(result.view).find(x=>x.action==='submit').enabled,true);
  assert.equal(rows(result.view).find(x=>x.action==='resend').enabled,true);assert.equal(started,1);
});
test('shared password validation reaches the native form as a specific business error',async()=>{
  const {n,c,sandbox}=await fixture();
  vm.runInContext(await readFile(new URL('../src/ui-core/cloud-account.js',import.meta.url),'utf8'),sandbox);
  c.accountCore=sandbox.WeftUiCore.factories.cloudAccount(c.core,{},{});
  c.humanError=error=>c.accountCore.cloudError(error);
  await assert.rejects(n.request(c,'accountPassword','save',{}, {current:'ignored',password:'abc',confirmation:'abc'}),/密码须为 8–128/);
  await assert.rejects(n.request(c,'accountPassword','save',{}, {current:'ignored',password:'12345678',confirmation:'87654321'}),/两次输入的密码不一致/);
});
test('memory deletion retains the reviewed scope and human confirmation',async()=>{
  const {n,c}=await fixture();let submitted;
  c.state.memory={detail:{item:{id:'item-a'}},confirmation:{preview:{forgetScope:'reviewed-scope'},deleteConversationSnippets:false},detailError:'',receiptMessage:'已处理'};
  c.core.mobile={submitMemoryAction:async(op,id)=>{submitted={op,id,confirmation:plain(c.state.memory.confirmation)};}};
  await assert.rejects(n.request(c,'memoryForget','forget',{id:'item-a'}, {confirmation:'不删除'}),/请输入“删除”/);
  const result=await n.request(c,'memoryForget','forget',{id:'item-a'}, {confirmation:'删除'});
  assert.equal(submitted.confirmation.preview.forgetScope,'reviewed-scope');assert.equal(submitted.confirmation.confirmText,'删除');assert.equal(submitted.confirmation.deleteConversationSnippets,false);
  assert.equal(result.effect.page,'memory');
});
test('a rejected memory revision cannot be presented as completed',async()=>{
  const {n,c}=await fixture();c.state.memory={detail:{item:{id:'item-a'}},confirmation:{preview:{}},detailError:''};
  c.core.mobile={submitMemoryAction:async()=>{c.state.memory.detailError='记忆有更新，请重新核对遗忘范围。';}};
  await assert.rejects(n.request(c,'memoryForget','forget',{id:'item-a'},{confirmation:'删除'}),/记忆有更新/);
});
test('a failed account model check keeps its error in the native destination',async()=>{
  const {n,c}=await fixture();c.prepareSettings=()=>{};c.core.mobileSettings={testAccountModel:async()=>({error:true,message:'连接检查尚未通过'})};
  await assert.rejects(n.request(c,'cloudModels','test',{row:{accountModelId:'model-a'}}),/连接检查尚未通过/);
});
test('real model replacement keeps one request through timeout and pending recovery until verified success',async()=>{
  const {n,c,sandbox}=await fixture();const item={accountModelId:'model-a',revision:2},storage=new Map(),calls=[];
  c.prepareSettings=()=>{};Object.assign(c.state,{page:'models',generation:7});let phase='conflict';
  c.core.android={call:async(method,params)=>{assert.equal(method,'models.account.transfer');calls.push(plain(params));if(phase==='timeout')throw Error('TIMEOUT');return {requestId:params.requestId,status:phase==='conflict'?'credential_conflict':phase==='pending'?'pending':'saved'};}};
  vm.runInContext(await readFile(new URL('../src/ui-core/adapters/mobile-settings.js',import.meta.url),'utf8'),sandbox);
  Object.assign(c.core,sandbox.WeftUiCore.factories.mobileSettings(c.core,{toast(){},page(){},safeError:()=> '取回结果待核对'}, {mobileState:c.state,crypto:{randomUUID},storage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}}));
  const conflict=await n.request(c,'cloudModels','transfer',{row:item});assert.equal(conflict.effect.page,'modelConflict');
  const markerKey=c.core.mobileSettings.accountModelIntentKey('transfer','model-a:2');assert.equal(storage.has(markerKey),false);
  phase='timeout';await assert.rejects(n.request(c,'modelConflict','replace',{row:item}),/待核对/);
  const marker=JSON.parse(storage.get(markerKey));assert.equal(marker.replaceExistingKey,true);assert.notEqual(marker.requestId,calls[0].requestId);
  assert.equal(c.state.accountModelCredentialConflict.item,item);
  phase='pending';await assert.rejects(n.request(c,'modelConflict','replace',{row:item}),/待核对/);
  assert.equal(JSON.parse(storage.get(markerKey)).requestId,marker.requestId);
  const attempts=calls.length;const differentChoice=await c.core.mobileSettings.transferAccountModel(item,false);
  assert.equal(differentChoice.error,true);assert.equal(calls.length,attempts);
  phase='saved';const result=await n.request(c,'modelConflict','replace',{row:item});assert.equal(result.effect.page,'cloudModels');
  assert.equal(storage.has(markerKey),false);assert.equal(c.state.accountModelCredentialConflict,null);
  assert.equal(calls.slice(1).length,3);assert.ok(calls.slice(1).every(x=>x.requestId===marker.requestId&&x.replaceExistingKey===true));
});
test('a disappeared project cannot start or replace its pending request',async()=>{
  const {n,c}=await fixture();c.prepareSettings=()=>{};
  const pending={projectId:'removed-project',modelProfileId:'model-a',requestId:'original-request'};
  c.core.mobileSettings={savedProjectIntent:()=>pending};
  c.call=async method=>{assert.equal(method,'shared.projects.list');return {hostId:'host-a',projects:[]};};
  const missing=await n.request(c,'project','read',{hostId:'host-a'});
  assert.match(JSON.stringify(missing.view),/已移除或撤销/);assert.equal(rows(missing.view).some(x=>x.action==='start'),false);
  await assert.rejects(n.request(c,'project','start',{hostId:'host-a',project:{projectId:'removed-project'}},{modelProfileId:'model-a'}),/项目或连接的电脑已改变/);
  assert.equal(pending.requestId,'original-request');
});
test('remote data deletion requests desktop confirmation and never confirms it from mobile',async()=>{
  const {n,c}=await fixture();const writes=[];c.core.readData=async()=>({accountName:'test-account'});c.core.dataSize=()=>'0 B';c.core.deleteAllData=async(...args)=>{writes.push(args);return {operation:{state:'pending_confirmation',id:'operation-a'}};};
  const result=await n.request(c,'data','delete',{kind:'delete'},{accountName:'test-account'});
  assert.equal(writes.length,1);assert.deepEqual(writes[0],['delete','test-account']);
  assert.equal(result.view.title,'数据与存储');assert.match(result.message,/在电脑上核对并确认/);
  assert.equal(result.effect,undefined);
});

test('Android UTC offsets become named zones for usage reads and budget writes',async()=>{
  const {sandbox,c}=await fixture();const paths=[],bodies=[];
  sandbox.Intl={DateTimeFormat:()=>({resolvedOptions:()=>({timeZone:'+00:00'})})};
  sandbox.WeftHumanFormat={formatMoney:String};
  vm.runInContext(await readFile(new URL('../src/ui-core/usage.js',import.meta.url),'utf8'),sandbox);
  c.core.accountToken=()=>({ownerId:'owner-a'});
  c.core.accessApi=async(path,options)=>{paths.push(path);if(options?.body)bodies.push(options.body);return path==='/settings/usage'?{models:[]}:path==='/sessions'?{sessions:[]}:{sessions:[],models:[],budget:{}};};
  const usage=sandbox.WeftUiCore.factories.usage(c.core,{});await usage.loadUsage();await usage.saveUsageSettings({monthlyLimit:1});
  assert.equal(new URL(paths[0],'https://example.test').searchParams.get('timeZone'),'UTC');assert.equal(bodies.at(-1).timeZone,'UTC');
});
