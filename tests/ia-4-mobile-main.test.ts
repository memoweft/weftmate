import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {uiCoreAssets} from '../src/ui-core/manifest.mjs';
const source=uiCoreAssets.map(path=>readFileSync(new URL(`../src/ui-core/${path}`,import.meta.url),'utf8')).join('\n;\n');
const versions={chats:1,chatTimeline:1,chatSearch:1,chatSend:1,sideChats:1,chatResources:1};
function fixture(capabilities:object){
  const paths:string[]=[],storage=new Map<string,string>(),state:any={loggedIn:true,owner:'synthetic-owner',username:'Synthetic',deviceId:'device-a',authEpoch:1,page:'chat',chatSource:'phone',sharedSessionId:null,sharedSessions:[],sharedEvents:[],sharedGeneration:0,handoffViews:new Map(),linkedEvents:new Map()};
  const effects=new Proxy({}, {get:(_target,key)=>()=>key==='readMessageDraft'?'':key==='isVisible'?true:undefined});
  const scope:any={Intl,URL,URLSearchParams,AbortSignal,TextEncoder,Blob,DOMException,setTimeout,clearTimeout,crypto:webcrypto};runInNewContext(source,scope);
  const core=scope.WeftUiCore.create({mobileState:state,logicalChats:true,effects,crypto:webcrypto,storage:{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},fetch:async(path:string)=>{paths.push(path);let body:any={};
    if(path.endsWith('/status'))body={hostId:'host-a',personalCapabilities:capabilities};
    else if(path.endsWith('/models'))body={models:[{id:'model-a',name:'Synthetic model',configured:true}]};
    else if(path.endsWith('/chats/main'))body={chat:{chatId:'chat-main',kind:'main',sendAvailable:true,activeSessionId:null}};
    else if(path.includes('/chats/chat-main/events'))body={items:[],contentRevision:1,syncCursor:'independent-live',timeZone:'Asia/Shanghai',indexState:'ready'};
    else if(path.includes('/sessions?'))body={sessions:[{sessionId:'legacy-side',source:'host',sendAvailable:true}],source:'host',hostAvailable:true};
    else if(path.includes('/chats?'))body={items:[],hasMore:false};
    else if(path.endsWith('/projects'))body={projects:[]};
    return {ok:true,status:200,json:async()=>body};}});
  return {core,state,paths};
}
test('mobile opens the fixed main through the complete supported native contract',async()=>{
  const f=fixture(versions);await f.core.listMobileSessions();assert.equal(f.state.logicalChats,true);assert.equal(f.core.inMainChat(),true);
  assert.equal(f.core.state.chatWindow.syncCursor,'independent-live');assert.equal(f.core.state.selectedChatId,'chat-main');
});
test('missing, boolean and unknown mobile capability versions retain the existing session list',async()=>{
  for(const version of [undefined,true,2]){const f=fixture({...versions,chatSearch:version});await f.core.listMobileSessions();assert.equal(f.state.logicalChats,undefined);assert.equal(f.paths.some(path=>path.endsWith('/chats/main')),false);assert.equal(f.state.sharedSessions[0].sessionId,'legacy-side');}
});
