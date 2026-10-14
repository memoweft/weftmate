import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const app=fs.readFileSync('apps/mobile-ui/www/app.js','utf8');
const code=app.slice(app.indexOf('async function openNativeLibraryFile('),app.indexOf('async function libraryPage('));
test('FIX-35 native library waits for restored identity before opening the exact file',async()=>{
  let reads=0,selected;
  const state={booted:true,loggedIn:false,restorePending:true,authBusy:false};
  const context=vm.createContext({state,window:{},document:{activeElement:null},$:()=>({}),setTimeout,Date,Error,
    page:()=>{reads++},libraryPage:async()=>{},libraryView:{preview:async item=>{selected=item.id}},
    uiCore:{library:{items:[{id:'synthetic-md'}]},accessApi:async()=>{reads++;if(!state.loggedIn)throw Error('UNAUTHORIZED');return {item:{id:'synthetic-md'}}}}});
  vm.runInContext(code,context);
  const opening=vm.runInContext("openNativeLibraryFile('synthetic-md')",context);
  await new Promise(r=>setTimeout(r,10));assert.equal(reads,0,'must wait for cloud restore');
  state.loggedIn=true;state.restorePending=false;
  await opening;assert.equal(selected,'synthetic-md');
});
for(const generation of ['preview.6','current']) test(`FIX-35 exact library fallback accepts ${generation} item shape without scanning source history`,async()=>{
  const item={id:'synthetic-code',fileName:'example.ts',type:'code',source:{sessionId:'synthetic-session'},...(generation==='current'?{versions:[],sourceRef:{chatId:'synthetic-chat'}}:{})};
  let opened,details=0;
  const context=vm.createContext({state:{booted:true,loggedIn:true},window:{},Date,document:{activeElement:null},$:()=>({}),page:()=>{},libraryPage:async()=>{},libraryView:{preview:async selected=>{opened=selected}},uiCore:{library:{items:[item]},accessApi:async()=>{details++;throw Error('unnecessary source history scan')}}});
  vm.runInContext(code,context);await vm.runInContext("openNativeLibraryFile('synthetic-code')",context);
  assert.equal(opened,item);assert.equal(details,0);assert.equal(context.window.weftNativeLibraryEntry,true);
});
test('FIX-35 original file back finishes only the temporary library activity',()=>{
  const source=fs.readFileSync('apps/mobile-ui/www/components/resources.js','utf8');
  const close=source.slice(source.indexOf('function closeResourcePage('),source.indexOf('function showResourcePage('));
  const calls=[];const context=vm.createContext({state:{resourceView:{context:{kind:'library'}}},window:{weftNativeLibraryEntry:true},call:method=>{calls.push(method);return Promise.resolve()}});
  vm.runInContext(close,context);vm.runInContext('closeResourcePage()',context);
  assert.deepEqual(calls,['native.library.close']);
});
test('FIX-35 pinned PDF main and worker entrypoints support the old WebView Promise',async()=>{
  for(const name of ['pdf.js','pdf.worker.js']){
    const source=fs.readFileSync('apps/mobile-ui/www/render-vendor/pdfjs/'+name,'utf8');
    const context=vm.createContext({});vm.runInContext('delete Promise.withResolvers',context);
    vm.runInContext(source.slice(0,source.indexOf('/**')),context);
    assert.equal(vm.runInContext('typeof Promise.withResolvers',context),'function',name);
    const promise=vm.runInContext('globalThis.task=Promise.withResolvers();task.resolve(7);task.promise',context);
    assert.equal(await promise,7);
    const reason=vm.runInContext('globalThis.failed=Promise.withResolvers();failed.reject(new Error("synthetic failure"));failed.promise',context);
    await assert.rejects(reason,/synthetic failure/);
  }
});
test('FIX-35 pinned PDF entrypoints iterate streams in the old WebView and release readers',async()=>{
  for(const name of ['pdf.js','pdf.worker.js']){
    const source=fs.readFileSync('apps/mobile-ui/www/render-vendor/pdfjs/'+name,'utf8');
    const context=vm.createContext({});
    vm.runInContext(`class ReadableStream { getReader(){let n=0;return {read:async()=>n<2?{value:++n,done:false}:{done:true},cancel:async()=>{globalThis.cancelled=true},releaseLock:()=>{globalThis.released=true}}} };globalThis.ReadableStream=ReadableStream`,context);
    vm.runInContext(source.slice(0,source.indexOf('/**')),context);
    const result=await vm.runInContext('(async()=>{const values=[];for await(const x of new ReadableStream())values.push(x);return values.join(",")})()',context);
    assert.equal(result,'1,2');assert.equal(context.released,true);
    context.released=false;await vm.runInContext('(async()=>{for await(const x of new ReadableStream())break})()',context);
    assert.equal(context.cancelled,true);assert.equal(context.released,true);
  }
});
