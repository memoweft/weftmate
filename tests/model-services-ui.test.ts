import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function setup(chatScope = false) {
  const WeftUiCore:any={factories:{}};
  let now=0;
  runInNewContext(readFileSync(new URL('../src/ui-core/model-services.js',import.meta.url),'utf8'),{globalThis:{WeftUiCore},Date:{now:()=>now}});
  const calls:any[]=[],storage=new Map(),state:any={ownerId:'synthetic-a',identityGeneration:1,personalCapabilities:{modelServices:1},models:[],modelProfileId:null,selectedSessionId:'synthetic-session'};
  const service={serviceId:'synthetic-service',name:'Synthetic',models:[{modelId:'a',name:'A',profileId:'route-a'},{modelId:'b',name:'B',profileId:'route-b',capabilities:{vision:false}}]};
  const core:any={state,async accessApi(path:string,options:any){calls.push({path,options});return path.endsWith('/select')?{profileId:'route-b',service,models:[{id:'route-b',name:'B',configured:true}]}:{services:[service],canManage:true};},async refreshModels(){},currentAttachmentDrafts:()=>[{mimeType:'image/png'}]};
  Object.assign(core,WeftUiCore.factories.modelServices(core,{}, {chatScope,storage:{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v)},crypto:{randomUUID:()=>crypto.randomUUID()}}));
  return {core,calls,storage,service,advance:(ms:number)=>now+=ms};
}
test('model picker reads cached services and selection submits conversation plus persistent default',async()=>{
  const {core,calls,storage}=setup();await core.refreshModelServices();
  assert.equal(core.modelServicesView().requiresVision,true);
  assert.equal(await core.selectServiceModel({serviceId:'synthetic-service',modelId:'b'}),true);
  const call=calls.find(c=>c.path.endsWith('/select'));
  assert.equal(call.options.body.sessionId,'synthetic-session');assert.equal(call.options.body.modelId,'b');
  assert.equal(core.state.modelProfileId,'route-b');assert.equal(core.state.modelSettings.defaultModelProfileId,'route-b');
  assert.deepEqual(JSON.parse(storage.get('weftmate:model-recent:synthetic-a')),['synthetic-service/b']);
  assert.equal(core.modelServicesView().selected.modelId,'b');
});

test('old computer without a directory declaration keeps legacy models and makes no service request',async()=>{
  const {core,calls}=setup();core.state.personalCapabilities={};
  assert.equal(await core.refreshModelServices(),null);assert.equal(calls.length,0);
  await assert.rejects(core.selectServiceModel({serviceId:'synthetic-service',modelId:'b'}),error=>error.code==='COMPUTER_UPDATE_REQUIRED');assert.equal(calls.length,0);
});

test('side draft materializes its model without changing the persistent default',async()=>{
  const {core,calls}=setup(true);core.state.newConversation=true;core.state.selectedSessionId=null;core.state.modelSettings={defaultModelProfileId:'route-a'};
  await core.refreshModelServices();await core.selectServiceModel({serviceId:'synthetic-service',modelId:'b'});
  const body=calls.find(c=>c.path.endsWith('/select')).options.body;
  assert.equal(body.preference,'conversation');assert.equal(body.sessionId,undefined);
  assert.equal(core.state.modelProfileId,'route-b');assert.equal(core.state.modelSettings.defaultModelProfileId,'route-a');
});
test('late service list from previous account cannot appear after account switch',async()=>{
  const {core}=setup();let complete:any;
  core.accessApi=()=>new Promise(resolve=>complete=resolve);
  const reading=core.refreshModelServices();core.state.ownerId='synthetic-b';core.state.identityGeneration++;
  complete({services:[{serviceId:'previous-account',models:[]}],canManage:true});await reading;
  assert.equal(core.state.modelServices,undefined);
});
test('selection resolves a logical chat still loading before setting its next-message model',async()=>{
  const {core,calls}=setup();core.state.selectedSessionId=null;core.state.newConversation=false;
  core.readMainChat=async()=>({chat:{chatId:'synthetic-main',activeSessionId:'existing-main-session'}});
  await core.refreshModelServices();await core.selectServiceModel({serviceId:'synthetic-service',modelId:'b'});
  assert.equal(calls.find(c=>c.path.endsWith('/select')).options.body.sessionId,'existing-main-session');
});
test('historical phone images require vision even after the draft has no attachments',()=>{
  const {core}=setup();core.currentAttachmentDrafts=()=>[];core.timelineEventsForContext=()=>[{data:{images:[{name:'synthetic-picture'}]}}];
  assert.equal(core.modelServicesView().requiresVision,true);
});
test('refresh leaves the current list usable while the network response is pending',async()=>{
  const {core,service}=setup();core.state.modelServices=[service];let complete:any;
  core.accessApi=(path:string)=>path.endsWith('/refresh')?new Promise(resolve=>complete=resolve):Promise.resolve({services:[service],canManage:true});
  const reading=core.refreshModelServices(true);assert.equal(core.modelServicesView().services[0].models.length,2);
  complete({service});await reading;assert.equal(core.state.modelServices[0].serviceId,'synthetic-service');
});

test('unavailable model directory backs off automatic reads while preserving cached models and permits explicit retry',async()=>{
  const {core,service,advance}=setup();core.state.modelServices=[service];let attempts=0,unavailable=true;
  core.accessApi=async()=>{attempts++;if(unavailable)throw {code:'BACKEND_UNAVAILABLE'};return {services:[service],canManage:true};};
  await assert.rejects(core.refreshModelServices(),error=>error.code==='BACKEND_UNAVAILABLE');
  for(let i=0;i<10;i++){advance(1500);await core.refreshModelServices();}
  assert.equal(attempts,1,'automatic refresh does not immediately retry the failed endpoint');
  assert.equal(core.state.modelServices[0].serviceId,service.serviceId);
  advance(15000);unavailable=false;await core.refreshModelServices();assert.equal(attempts,2,'configuration retry resumes after 30 seconds');
  unavailable=true;await assert.rejects(core.refreshModelServices(),error=>error.code==='BACKEND_UNAVAILABLE');
  unavailable=false;await core.refreshModelServices(true);assert.equal(attempts,5,'an explicit retry may refresh the saved service and then read its directory');
});
