import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { personalization as P, accountPersonalization } from '../src/personal-access/personalization.mjs';
import { installPersonalization } from '../src/plugins/personal-personalization.mjs';
import { projectHistoryEvent } from '../src/runtime/dsh-adapter/sessions.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';

test('account defaults migrate without changing history; prompt handles empty values and every combination', () => {
  assert.deepEqual(accountPersonalization({}), P.defaults); assert.equal(P.prompt({}), '');
  for (const tone of ['natural','concise','detailed','formal','casual']) for (const verbosity of ['short','medium','thorough']) {
    const value = { preferredName:'小合成',bio:'合成职业',tone,verbosity,fixedInstructions:'末尾加 —WM',toneInstructions:'先结论',useWritingStyle:true,writingStyle:'短句' };
    assert.doesNotThrow(() => P.validate(value));
    const prompt=P.prompt(value); for (const text of ['小合成','合成职业','末尾加 —WM','先结论','短句']) assert.ok(prompt.includes(text));
  }
  assert.doesNotMatch(P.prompt({useWritingStyle:false,writingStyle:'STYLE_SENTINEL'}),/STYLE_SENTINEL/);
  assert.equal(P.prompt({preferredName:'  ',fixedInstructions:'\n',writingStyle:''}), '');
  for (const [key,limit] of Object.entries(P.limits) as [string,number][]) {
    assert.doesNotThrow(()=>P.validate({[key]:'字'.repeat(limit)}));
    assert.doesNotThrow(()=>P.validate({[key]:'😀'.repeat(limit)}));
    assert.throws(()=>P.validate({[key]:'字'.repeat(limit+1)})); assert.throws(()=>P.validate({[key]:null}));
  }
  for (const patch of [{},{unknown:true},{constructor:'queue'},{tone:'bad'},{webSearch:'true'},{thinkingDisplay:'bad'}]) assert.throws(()=>P.validate(patch));
  assert.equal(P.extractStyle([]),''); assert.match(P.extractStyle(['你好？','短句？']),/短句/);
});

test('native system prompt snapshots settings per turn, filters and denies disabled web tools, and inherits to children', async () => {
  const hooks:any={},agent:any={session:{id:'session',header:{agentPreset:'personal-remote'}}};
  let settings:any={preferredName:'第一回合',webSearch:false};
  installPersonalization({on:(name:string,fn:any)=>{hooks[name]=fn},get:()=>({get:()=>agent})},async()=>({personalization:settings}));
  const assembly={sections:[{name:'weftmate:tools-catalog',text:'web_fetch: network\nread: local'}],tools:[{name:'web_fetch'},{name:'read'}]};
  await hooks['agent/pre-step']({agent,turn:1},async()=>({kind:'enter'}));
  settings={preferredName:'第二回合',webSearch:true};
  const first=await hooks['system-prompt/assemble'](null,{scope:agent},async()=>assembly);
  assert.match(first.sections.at(-1).text,/第一回合/); assert.deepEqual(first.tools,[{name:'read'}]);
  assert.doesNotMatch(first.sections[0].text,/web_fetch/);assert.match(assembly.sections[0].text,/web_fetch/);
  assert.equal((await hooks['tools/pre-execute']({agent,name:'web_fetch'},async()=>({kind:'allow'}))).kind,'deny');
  const child={session:{header:{agentPreset:'personal-remote',origin:'subagent',parentSession:'session'}}};
  assert.equal((await hooks['tools/pre-execute']({agent:child,name:'browser'},async()=>({kind:'allow'}))).kind,'deny');
  await hooks['agent/pre-step']({agent,turn:2},async()=>({kind:'enter'}));
  const second=await hooks['system-prompt/assemble'](null,{scope:agent},async()=>assembly);
  assert.match(second.sections.at(-1).text,/第二回合/);assert.equal(second.tools.length,2);
});

test('thinking content is opt-in presentation data and never part of source projection', () => {
  const event={seq:1,type:'assistant/message',data:{content:[{type:'reasoning',text:'模型返回的思考'},{type:'text',text:'答案'}]}};
  assert.equal(projectHistoryEvent(event).data.modelThinking,undefined);
  assert.equal(projectHistoryEvent(event,null,null,null,null,true).data.modelThinking,'模型返回的思考');
  assert.equal(projectHistoryEvent(event,null,null,null,null,true).data.text,'答案');
});

test('settings API is account isolated, last-write wins per field, persists and validates; fixed instructions never read or ingest memory', async t => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-st1-unit-'));let service:any;
  const backend:any={getStatus:async()=>({runtime:'ready'}),listModels:async()=>[],preflight:async()=>({ok:true}),createSession:async({sessionId}:any)=>({sessionId}),sendMessage:async()=>({accepted:true}),cancelSession:async()=>({accepted:true}),readEvents:async()=>({events:[]}),describeSession:async()=>null};
  service=await createPersonalAccessService({root,port:0,backend});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true})});
  let origin=(await service.start()).origin;
  async function api(path:string,session:any,body?:any,method=body?'PATCH':'GET') {
    const response=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,...(session?{cookie:session.cookie,'x-weftmate-csrf':session.csrf}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json(),cookie:response.headers.getSetCookie()[0]?.split(';')[0]};
  }
  const register=async(username:string)=>{const r=await api('/auth/register',null,{username,password:'Synthetic-ST1-password-2026!',deviceName:'合成设备'},'POST');assert.equal(r.status,201);return {cookie:r.cookie,csrf:r.body.csrfToken}};
  const a=await register('SyntheticST1A'),b=await register('SyntheticST1B');
  assert.deepEqual((await api('/settings/personalization',a)).body.settings,P.defaults);
  assert.equal((await api('/settings/personalization',a,{preferredName:'小合成',fixedInstructions:'末尾加 —WM'})).status,200);
  await api('/settings/personalization',a,{tone:'concise'});await api('/settings/personalization',a,{tone:'formal'});
  const saved=(await api('/settings/personalization',a)).body;assert.equal(saved.settings.preferredName,'小合成');assert.equal(saved.settings.tone,'formal');assert.equal(saved.synced,true);
  assert.equal((await api('/settings/personalization',b)).body.settings.preferredName,'');
  assert.equal((await api('/settings/personalization',a,{fixedInstructions:'字'.repeat(4001)})).status,400);
  assert.equal((await api('/settings/personalization',null)).status,401);
  assert.equal((await api('/settings/personalization/style',a,{},'POST')).body.settings.writingStyle,'');
  await service.close();service=await createPersonalAccessService({root,port:0,backend});origin=(await service.start()).origin;
  const login=await api('/auth/login',null,{username:'SyntheticST1A',password:'Synthetic-ST1-password-2026!',deviceName:'合成设备二'},'POST');
  assert.equal((await api('/settings/personalization',{cookie:login.cookie,csrf:login.body.csrfToken})).body.settings.fixedInstructions,'末尾加 —WM');
});

test('old queue preference migrates once, account changes ignore late reads and writes', async () => {
  const environment:any={WeftUiCore:{factories:{}}};runInNewContext(readFileSync(new URL('../src/ui-core/settings.js',import.meta.url),'utf8'),environment);
  const core:any={state:{identityGeneration:1,ownerId:'a'},accessApi:async(_path:string,options:any)=>({settings:{...P.defaults,...options?.body},updatedAt:options?'saved':null})};
  Object.assign(core,environment.WeftUiCore.factories.settings(core,{}, {storage:{getItem:()=> 'steer'}}));
  assert.equal((await core.loadPersonalization()).settings.messageMode,'steer');
  let resolve:any;core.accessApi=()=>new Promise(done=>resolve=done);const read=core.loadPersonalization();core.state.identityGeneration++;core.state.ownerId='b';resolve({settings:{preferredName:'OLD'},updatedAt:'saved'});await read;assert.notEqual(core.state.personalization.preferredName,'OLD');
});
