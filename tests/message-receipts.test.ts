// 保护：任务列表变慢不能锁住已经受理的消息，旧回执不能清空下一条草稿或污染切换后的账户。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {uiCoreAssets} from '../src/ui-core/manifest.mjs';

const source=uiCoreAssets.map(name=>readFileSync(new URL('../src/ui-core/'+name,import.meta.url),'utf8')).join('\n;');
function deferred(){let resolve:any;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
function fixture(){
  const context:any={AbortSignal,URL,URLSearchParams,TextEncoder,Blob,Intl,setTimeout,clearTimeout,setInterval,clearInterval};
  runInNewContext(source,context);
  let draft='已经发送的原文';const storage=new Map(),receipt=deferred(),list=deferred();
  const effects=new Proxy({readMessageDraft:()=>draft,clearMessageDraft:()=>{draft='';}},{get:(o:any,k)=>o[k]||(()=>{})});
  const core=context.WeftUiCore.create({effects,crypto:{randomUUID:()=> 'request-one'},storage:{getItem:(k)=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
  Object.assign(core.state,{identityGeneration:1,ownerId:'owner',account:{ownerId:'owner'},hostId:'host',online:true,
    selectedSessionId:'session',activeChatSource:'desktop',newConversation:false,modelProfileId:'model',models:[{id:'model'}],
    capabilities:{chat:{available:true}},sessions:[{sessionId:'session',sendAvailable:true}]});
  const pending={commandId:'command',requestId:'request-one',kind:'session.message',sessionId:'session',state:'pending'};
  core.accessApi=async(path)=>path==='/commands'?{command:pending}:receipt.promise;
  core.refreshTasks=()=>list.promise;
  core.refreshHistory=async()=>{};
  return {core,receipt,list,setDraft:text=>{draft=text;},draft:()=>draft,accept(state='accepted_by_dsh'){
    receipt.resolve({command:{...pending,state,receiptId:'receipt-one'}});
  }};
}

test('accepted receipt clears the sent draft while the task list is still waiting',async()=>{
  const f=fixture();let returned=false;
  const sending=f.core.sendDraft().then(()=>{returned=true;});
  await flush();f.accept();await flush();
  try{assert.deepEqual([returned,f.draft(),f.core.state.submitting,f.core.state.unresolvedSubmission],[true,'',false,false]);}
  finally{f.list.resolve();await sending;}
});
test('a late acceptance preserves text typed after sending',async()=>{
  const f=fixture(),sending=f.core.sendDraft();await flush();f.setDraft('下一条新草稿');f.accept();await flush();
  try{assert.equal(f.draft(),'下一条新草稿');assert.equal(f.core.state.unresolvedSubmission,false);}
  finally{f.list.resolve();await sending;}
});
test('a rejected message retains its draft and becomes retryable',async()=>{
  const f=fixture(),sending=f.core.sendDraft();await flush();f.accept('rejected');await flush();
  try{assert.equal(f.draft(),'已经发送的原文');assert.equal(f.core.optimisticMessages()[0].status,'failed');assert.equal(f.core.state.submitting,false);}
  finally{f.list.resolve();await sending;}
});
test('a receipt from the previous identity cannot mutate the current account',async()=>{
  const f=fixture(),sending=f.core.sendDraft();await flush();
  f.core.state.identityGeneration++;f.core.state.tasks=[];f.accept();await flush();
  try{assert.equal(f.core.state.tasks.length,0);assert.equal(f.draft(),'已经发送的原文');}
  finally{f.list.resolve();await sending;}
});
