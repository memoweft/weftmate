import assert from 'node:assert/strict';
import test from 'node:test';
import { PERMISSION_TYPES, decidePermission, validPermissionRules, mergePermissionRules, permissionCategories, permissionApprovalCategories } from '../src/plugins/personal-permission-rules.mjs';
import { approvalRequired } from '../src/plugins/personal-approval-policy.mjs';
import { executionRecords } from '../src/personal-access/execution-records.mjs';
import { createProjectOperations } from '../src/personal-projects/projects.mjs';

for (const type of PERMISSION_TYPES) for (const value of ['allow','ask','deny']) test(`${type.id}: ${value} validates and decides at the host gate`, () => {
  assert.equal(validPermissionRules({[type.id]:value}), !(type.restricted && value === 'allow'));
  if (type.restricted && value === 'allow') return;
  for(const mode of ['auto','ask','accept-edits','plan','allow-all']) {
    const decision=decidePermission({mode,permissionRules:{[type.id]:value}},[type.id], type.id==='write'?['overwrite']:[]);
    assert.equal(decision.decision,value);
    assert.equal(decision.source,'global');
  }
});
test('untouched rules preserve every mode, risky overwrite vs new file and conversation grants',()=>{
  for(const mode of ['auto','ask','accept-edits','plan','allow-all']) for(const risks of [[],['overwrite'],['delete','external'],['install','system','spend']]) for(const allowedCategories of [[],risks]) {
    const expected=approvalRequired(mode,risks,allowedCategories);
    assert.deepEqual(decidePermission({mode,allowedCategories},permissionCategories('write',{file_path:'note.txt'},risks),risks).required,expected);
  }
  assert.equal(decidePermission({mode:'auto'},['write'],[]).decision,'allow');
  assert.equal(decidePermission({mode:'auto'},['write'],['overwrite']).decision,'ask');
});
test('project overrides one category, inherits the rest, and reset restores inheritance',()=>{
  const policy={mode:'auto',permissionRules:{write:'deny',command:'ask'},projectPermissionRules:{write:'allow'}};
  assert.equal(decidePermission(policy,['write'],['overwrite']).decision,'allow');
  assert.equal(decidePermission(policy,['command']).decision,'ask');
  assert.equal(decidePermission({...policy,projectPermissionRules:{}},['write'],['overwrite']).decision,'deny');
  assert.deepEqual(mergePermissionRules({write:'allow',command:'deny'},{write:null,read:'ask'}),{command:'deny',read:'ask'});
});
test('composite operations retain dangerous approval, deny wins, and printed arrows are not writes',()=>{
  assert.equal(decidePermission({mode:'auto',permissionRules:{command:'allow'}},['command','delete'],['delete']).decision,'ask');
  assert.equal(decidePermission({mode:'allow-all',permissionRules:{network:'deny'}},['network','external'],['external']).decision,'deny');
  assert.deepEqual(permissionCategories('pwsh',{command:"Write-Output 'result -> ok'"}),['command']);
  assert.ok(permissionCategories('pwsh',{command:"Set-Content report.txt ok"}).includes('write'));
  assert.ok(permissionCategories('web_fetch',{url:'https://example.test'}).includes('network'));
  assert.equal(validPermissionRules({unknown:'ask'}),false);
  assert.equal(validPermissionRules({write:null}),false);
  assert.equal(validPermissionRules({write:null},{patch:true}),true);
});
test('project settings save rules through existing revision storage and public projection',async()=>{
  const account:any={sessions:{},projects:{'project-test':{projectId:'project-test',name:'Synthetic',revision:1,permission:'write',rootPath:'C:\\Synthetic',revoked:false}}};
  const update=createProjectOperations({serial:async fn=>fn(),accountState:()=>account,mutate:async(_,fn)=>fn(account),timestamp:()=>Date.now()});
  const result=await update('owner','project-test','PATCH',{expectedRevision:1,permissionRules:{write:'allow',command:'deny'}});
  assert.deepEqual(result.project.permissionRules,{write:'allow',command:'deny'});
  assert.equal(result.project.revision,2);
  await assert.rejects(update('owner','project-test','PATCH',{expectedRevision:2,permissionRules:{spend:'allow'}}),e=>e.code==='INVALID_REQUEST');
  await update('owner','project-test','PATCH',{expectedRevision:2,permissionRules:{}});
  assert.deepEqual(account.projects['project-test'].permissionRules,{});
});
test('execution records merge native approvals and tools, filter, page and preserve exact conversation targets',()=>{
  const account:any={sessions:{s:{title:'Synthetic chat',projectId:'p'}},projects:{p:{projectId:'p',name:'Synthetic project'}},commands:{c:{sessionId:'s',payload:{projectId:'p'},toolApprovals:[{approvalId:'a',callId:'ask-call',createdAt:'2026-10-10T09:00:00Z',reason:'[weftmate:overwrite] write note.txt',riskCategories:['overwrite'],decisionOutcome:'rejected'}],toolExecutions:[
    {executionId:'x',callId:'write',startedAt:'2026-10-11T09:00:00Z',toolName:'write',state:'completed',permission:{types:['write'],summary:'write note.txt',decision:'allow',source:'project'}},
    {executionId:'y',callId:'shell',startedAt:'2026-10-11T10:00:00Z',toolName:'pwsh',state:'cancelled',permission:{types:['command'],summary:'pwsh blocked command',decision:'deny',source:'global'}}]}}};
  const all=executionRecords(account);assert.deepEqual(all.items.map(row=>row.result),['blocked','automatic','rejected']);
  assert.equal(all.items[0].sessionId,'s');assert.equal(all.items[0].projectId,'p');
  const write=executionRecords(account,new URLSearchParams({type:'write',projectId:'p',since:'2026-10-11',until:'2026-10-12'}));assert.deepEqual(write.items.map(row=>row.id),['x']);
  const first=executionRecords(account,new URLSearchParams({limit:'1'}));assert.equal(first.hasMore,true);
  assert.deepEqual(executionRecords(account,new URLSearchParams({before:first.nextBefore,limit:'1'})).items.map(row=>row.id),['x']);
  assert.equal(executionRecords(account,new URLSearchParams({projectId:'none'})).items.length,0);
  for(const query of ['type=bad','since=bad','limit=201','type=read&type=write','before=bad'])assert.throws(()=>executionRecords(account,new URLSearchParams(query)));
  delete account.commands.c.payload.projectId;account.sessions.s.projectId='p';
  assert.equal(executionRecords(account).items[0].projectId,null,'moving a conversation later does not relabel earlier operations as project work');
  delete account.sessions.s;assert.equal(executionRecords(account).items.length,0);
});

test('ask-mode shortcuts describe the actual file/network category instead of granting all commands',()=>{
  for(const type of ['read','network','write']){
    const selected=decidePermission({mode:'ask'},[type],[]);
    assert.deepEqual(permissionApprovalCategories(selected),[type==='write'?'overwrite':type]);
  }
  assert.deepEqual(permissionApprovalCategories(decidePermission({mode:'ask'},['command','delete'],['delete'])),['delete','execute']);
});


test('execution approval summaries show paths instead of file contents and prefer execution metadata',()=>{
  const approval={approvalId:'a',callId:'call',createdAt:'2026-10-11T12:00:00.000Z',status:'pending',riskCategories:['overwrite'],reason:'[weftmate:overwrite] 修改文件。操作：write\n'+JSON.stringify({file_path:'note.txt',content:'synthetic file body'})};
  const account:any={sessions:{s:{}},commands:{c:{sessionId:'s',toolApprovals:[approval]}}};
  assert.equal(executionRecords(account).items[0].summary,'write · note.txt');
  account.commands.c.toolExecutions=[{callId:'call',state:'completed',permission:{summary:'write · actual-note.txt'}}];
  assert.equal(executionRecords(account).items[0].summary,'write · actual-note.txt');
});
