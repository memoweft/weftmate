import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { uiCoreAssets } from '../src/ui-core/manifest.mjs';
import '../src/ui-core/offline.js';

const component = readFileSync(new URL('../src/personal-access-ui/components/offline.js', import.meta.url), 'utf8');
class Node {
  textContent = ''; className = ''; hidden = false; value = ''; disabled = false;
  children: any[] = []; listeners: Record<string, Function> = {}; attributes: Record<string,string> = {};
  get firstChild() { return this.children[0]; }
  get options() { return this.children; }
  append(...nodes: any[]) { if (this.textContent && !this.children.length) this.children.push({ textContent: this.textContent }); this.children.push(...nodes); }
  replaceChildren(...nodes: any[]) { this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, fn: Function) { this.listeners[name] = fn; }
  remove() {} focus() {}
}
function fixture() {
  const body = new Node(), values = new Map(); let failure: any = null;
  const view = { ready: true, conversations: [], turns: [], snapshot: { recent: [] } };
  const environment: any = { document: { body, createElement: () => new Node(), addEventListener() {}, visibilityState: 'visible' },
    setInterval() {}, clearInterval() {}, localStorage: { getItem: (k: string) => values.get(k), setItem: (k: string,v: string) => values.set(k,v) },
    WeftOffline: { browserVault: async () => ({}), create: async () => ({ view: () => view, sync: async () => { if (failure) throw failure; return true; }, check: async () => ({}), clear: async () => {}, close() {} }) } };
  runInNewContext(component, environment);
  const core: any = { foreground:()=>true, accessApi: async () => { throw {code:'NETWORK'}; } };
  return { environment, body, core, fail(error: any) { failure = error; } };
}
test('sync errors distinguish connectivity from permission, request and replica errors', () => {
  const { environment } = fixture(), classify = environment.WeftOfflineView.syncFailure;
  for (const code of ['NETWORK','HOST_UNAVAILABLE','HOST_OFFLINE']) assert.equal(classify({ code }).unreachable, true);
  for (const error of [{code:'FORBIDDEN',status:403},{code:'INVALID_REQUEST',status:400},{code:'OFFLINE_MODEL_REQUIRED'},
    {code:'OFFLINE_CLOUD_REQUIRED'},{code:'OFFLINE_RESET_REQUIRED'},{code:'OFFLINE_ENVELOPE_INVALID'}, {status:500}, {code:'TIMEOUT'}]) {
    assert.equal(classify(error).unreachable, false, JSON.stringify(error)); assert.ok(classify(error).message);
  }
  assert.equal(classify({code:'UNAUTHORIZED',status:401}).clear,true);
});

test('phone plus menu and goals expose no task feature without support and appear after refreshed support',async()=>{
  const f=fixture();let supported=false,entries:any[]=[];
  const pending={id:'cached',state:'waiting',text:'合成事项',conversationId:'tasks'};
  const view=()=>({ready:true,chatReady:true,taskReady:supported,tasks:[pending],targets:[],conversations:[],turns:[],snapshot:{recent:[]}});
  f.environment.WeftOffline.create=async()=>({view,sync:async()=>true,check:async()=>({}),close(){}});
  f.environment.WeftPopover={menu:(_anchor:any,values:any[])=>entries=values};f.core.connectionView=()=>({kind:'host_offline'});
  const mounted=f.environment.WeftOfflineView.mount({core:f.core,identity:async()=>({origin:'synthetic',ownerId:'owner',deviceId:'phone',hostId:'host'})});
  await new Promise(resolve=>setImmediate(resolve));const more=f.body.children[0].children.at(-1).children.at(-1);more.listeners.click();
  assert.equal(JSON.stringify(entries.map(e=>e.name)),JSON.stringify(['继续聊聊']));assert.equal(f.core.offlineTasksView().length,0);
  supported=true;await mounted.tick();more.listeners.click();assert.ok(entries.some(e=>e.name==='交给电脑，上线后做'));assert.equal(f.core.offlineTasksView().length,1);
  supported=false;await mounted.tick();more.listeners.click();assert.equal(entries.some(e=>e.name.includes('交给电脑')),false);assert.equal(f.core.offlineTasksView().length,0);mounted.close();
});

test('restoring a cached phone waits for host login before replica sync and keeps accepted tasks', async () => {
  const f=fixture(), cached={origin:'synthetic',ownerId:'owner',deviceId:'phone',hostId:'host'};
  f.environment.localStorage.setItem('weftmate-offline-identity',JSON.stringify(cached));
  let connected=false,syncs=0,checks=0,clears=0;
  const accepted=[{id:'task',state:'waiting',conversationId:'tasks',text:'合成事项'}];
  f.environment.WeftOffline.create=async()=>({view:()=>({ready:true,conversations:[],turns:[],tasks:accepted,snapshot:{recent:[]}}),
    sync:async()=>{syncs++;if(!connected)throw {code:'UNAUTHORIZED',status:401};return true;},
    check:async()=>{checks++;return {authorized:true};},clear:async()=>{clears++;accepted.splice(0);},close(){}});
  const mounted=f.environment.WeftOfflineView.mount({core:f.core,identity:async()=>connected?cached:null});
  await new Promise(resolve=>setImmediate(resolve));await mounted.tick();
  assert.equal(syncs,0);assert.ok(checks>0);assert.equal(clears,0);assert.equal(accepted.length,1);
  connected=true;await mounted.tick();assert.equal(syncs,1);assert.equal(accepted.length,1);mounted.close();
});

test('native phone vault without seal keeps cloud-supported tasks hidden and offline chat working without bridge errors', async () => {
  const f=fixture(),calls:string[]=[],entries:any[]=[];
  const current={origin:'synthetic',ownerId:'owner',deviceId:'phone',hostId:'host'};
  const status={authorized:true,accountId:'account',hostId:'host',generation:1,capabilities:{offlineTasks:1}};
  const value={snapshot:{generation:1,items:[],recent:[],taskRecipient:{kty:'RSA'},model:{modelId:'synthetic-chat'},control:status},tasks:[],turns:[],conversations:[]};
  const W=(globalThis as any).WeftOffline;let engine:any;
  f.environment.WeftOffline={...W,create:async(options:any)=>engine=await W.create(options)};
  f.environment.WeftPopover={menu:(_anchor:any,values:any[])=>entries.splice(0,entries.length,...values)};
  f.core.connectionView=()=>({kind:'host_offline'});f.core.cloudOfflineStatus=async()=>status;
  f.core.cloudOfflineTasks=async(action:string)=>{assert.equal(action,'list');return {items:[]};};
  const nativeCall=async(method:string)=>{
    calls.push(method);
    if(method==='offline.load')return value;if(method==='offline.key')return {};
    if(method==='offline.save')return {};if(method==='offline.complete')return {choices:[{message:{content:'合成聊天回复'}}]};
    throw Error('Unsupported native call: '+method);
  };
  const mounted=f.environment.WeftOfflineView.mount({core:f.core,identity:async()=>current,nativeCall,host:async()=>{throw {code:'HOST_OFFLINE'};}});
  await new Promise(resolve=>setImmediate(resolve));await mounted.tick();f.core.openOfflineMode();
  assert.equal(engine.view().taskReady,false);assert.equal(engine.view().chatReady,true);
  const more=f.body.children[0].children.at(-1).children.at(-1);more.listeners.click();
  assert.equal(JSON.stringify(entries.map(e=>e.name)),JSON.stringify(['继续聊聊']));assert.equal(f.core.offlineTasksView().length,0);
  await engine.send('继续聊天');assert.ok(calls.includes('offline.complete'));
  assert.ok(!calls.some(method=>['offline.seal','offline.targets','offline.clearAccount'].includes(method)));
  const text=(node:any):string=>node.textContent+' '+(node.children||[]).map(text).join(' ');
  assert.ok(!/失败|错误|暂时无法|回复未完成/.test(text(f.body)));mounted.close();
});
test('a capable native vault exposes offline computer tasks, seals them natively and keeps queue cancellation usable',async()=>{
  const f=fixture(),calls:any[]=[],cancelEntries:any[]=[];
  f.environment.WeftPopover={menu:(_anchor:any,entries:any[])=>cancelEntries.splice(0,cancelEntries.length,...entries)};
  const current={origin:'synthetic',ownerId:'owner',deviceId:'cookie',hostId:'host'};
  const control={authorized:true,accountId:'cloud-account',hostId:'host',generation:1,capabilities:{offlineTasks:1}};
  const target={generation:1,taskRecipient:{kty:'RSA',n:'synthetic-public-key',e:'AQAB'},control};
  let value:any={snapshot:{...target,items:[],recent:[],model:null},tasks:[],turns:[],conversations:[]},engine:any;
  const W=(globalThis as any).WeftOffline;
  f.environment.WeftOffline={...W,create:async(options:any)=>engine=await W.create(options)};
  f.core.connectionView=()=>({kind:'host_offline'});f.core.cloudOfflineStatus=async()=>control;
  f.core.cloudOfflineTaskDevice=async()=> 'physical-phone';
  f.core.cloudOfflineTasks=async(action:string,body:any)=>{
    if(action==='list')return {items:value.tasks.filter((t:any)=>t.state!=='sending')};
    return {id:body.id,hostId:'host',state:action==='cancel'?'canceled':'waiting',expiresAt:Date.now()+60000};
  };
  const nativeCall=async(method:string,params:any={})=>{
    calls.push({method,params});
    if(method==='offline.load')return value;
    if(method==='offline.save'){value=params.value;return {saved:true};}
    if(method==='offline.targets')return {targets:[target]};
    if(method==='offline.seal')return {version:1,ciphertext:'native-sealed-synthetic'};
    throw Error('Unexpected native call: '+method);
  };
  const mounted=f.environment.WeftOfflineView.mount({core:f.core,identity:async()=>current,nativeCall,nativeTaskVault:true,host:async()=>{throw {code:'HOST_OFFLINE'};}});
  try{
    await new Promise(resolve=>setImmediate(resolve));await mounted.tick();
    assert.equal(f.core.offlineWorkReady(),true,'authenticated recipient plus native task capability must enable the task entry');
    assert.equal(engine.view().chatReady,false,'computer tasks must not need a phone chat model');
    const task=await engine.submitTask('读取合成目录里的说明');
    assert.equal(task.state,'waiting');
    const sealed=calls.find(call=>call.method==='offline.seal');
    assert.equal(sealed.params.identity.hostId,'host');assert.equal(sealed.params.identity.accountId,'cloud-account');
    assert.equal(sealed.params.identity.deviceId,'physical-phone');assert.equal(sealed.params.payload.text,'读取合成目录里的说明');
    const descendants=(node:any):any[]=>[node,...(node.children||[]).flatMap(descendants)];
    const cancel=descendants(f.body).find(node=>node.textContent==='取消这件事');
    assert.ok(cancel,'the queued task exposes its cancellation action');cancel.onclick();
    assert.equal(engine.view().tasks[0].state,'waiting','opening confirmation does not cancel');
    await cancelEntries.find(entry=>entry.name==='确认取消').action();
    assert.equal(engine.view().tasks[0].state,'canceled');
  }finally{mounted.close();}
});
test('explicit offline work entry remains editable while content transport is reconnecting',async()=>{
  const f=fixture();
  const view={ready:true,chatReady:false,taskReady:true,running:false,tasks:[],targets:[],conversations:[],turns:[],snapshot:{recent:[]}};
  f.environment.WeftOffline.create=async()=>({view:()=>view,sync:async()=>true,check:async()=>({}),close(){}});
  f.core.connectionView=()=>({kind:'connecting'});
  const mounted=f.environment.WeftOfflineView.mount({core:f.core,identity:async()=>({origin:'synthetic',ownerId:'owner',deviceId:'phone',hostId:'host'})});
  try{
    await new Promise(resolve=>setImmediate(resolve));
    f.core.openOfflineWorkMode('电脑上线后读一下说明');
    const form=f.body.children[0].children.at(-1),input=form.children[0].children.at(-1);
    assert.equal(input.disabled,false,'cloud task submission must not wait for the unavailable content transport');
    assert.equal(form.children[2].disabled,false);
  }finally{mounted.close();}
});
test('polling never navigates over approvals; return stays closed on repeated offline ticks', async () => {
  const f = fixture();
  const mounted = f.environment.WeftOfflineView.mount({ core: f.core, identity: async () => ({ origin:'synthetic',ownerId:'owner',deviceId:'phone',hostId:'host' }) });
  await new Promise(resolve => setImmediate(resolve));
  const [section, launcher, notice] = f.body.children;
  f.fail({code:'NETWORK'}); await mounted.tick(); assert.equal(section.hidden,true); assert.equal(launcher.hidden,false);
  launcher.listeners.click(); assert.equal(section.hidden,false);
  section.children[0].children[0].listeners.click(); assert.equal(section.hidden,true);
  await mounted.tick(); await mounted.tick(); assert.equal(section.hidden,true);
  f.fail({code:'FORBIDDEN',status:403}); await mounted.tick();
  assert.equal(section.hidden,true); assert.equal(launcher.hidden,true); assert.equal(notice.hidden,false);
  f.fail(null); await mounted.tick(); assert.equal(notice.hidden,true); mounted.close();
});
test('manually opened offline content belongs to the chat scroller, outside approval and settings layers', async () => {
  const f = fixture(), scroller = new Node();
  f.environment.document.getElementById = (id: string) => id === 'chat-scroll' ? scroller : null;
  let opened = 0;
  const mounted = f.environment.WeftOfflineView.mount({ core: f.core, openConversation: () => opened++,
    identity: async () => ({origin:'synthetic',ownerId:'owner',deviceId:'phone',hostId:'host'}) });
  await new Promise(resolve => setImmediate(resolve));f.fail({code:'NETWORK'});await mounted.tick();
  const [launcher] = f.body.children;launcher.listeners.click();
  assert.equal(opened,1);assert.equal(scroller.children[0].hidden,false);
  assert.ok(!f.body.children.includes(scroller.children[0]));mounted.close();
});
test('a replica transport timeout does not declare a responsive host offline',async()=>{
  const f=fixture();f.core.accessApi=async()=>({hostId:'host'} as any);
  const mounted=f.environment.WeftOfflineView.mount({core:f.core,identity:async()=>({origin:'synthetic',ownerId:'owner',deviceId:'phone',hostId:'host'})});
  await new Promise(resolve=>setImmediate(resolve));f.fail({code:'NETWORK'});await mounted.tick();
  const [section,launcher,notice]=f.body.children;assert.equal(section.hidden,true);assert.equal(launcher.hidden,true);assert.equal(notice.hidden,false);
  mounted.close();
});

test('offline repaints preserve the unified picker hiding its original select',async()=>{
  const f=fixture(),mounted=f.environment.WeftOfflineView.mount({core:f.core,identity:async()=>({origin:'synthetic',ownerId:'owner',deviceId:'phone',hostId:'host'})});
  await new Promise(resolve=>setImmediate(resolve));
  const selector=f.body.children[0].children[0].children.at(-1).children[0];selector.hidden=true;
  await mounted.tick();assert.equal(selector.hidden,true,'only the picker container may control visibility');mounted.close();
});
test('both production mount transports pass objects and protected writes through requestJson', async () => {
  const context: any = { AbortSignal, URL, URLSearchParams };
  runInNewContext(uiCoreAssets.map(name => readFileSync(new URL(`../src/ui-core/${name}`,import.meta.url),'utf8')).join('\n;\n'),context);
  const requests: any[] = [];
  const core = context.WeftUiCore.create({ effects: new Proxy({}, {get:()=>()=>{}}), crypto:{randomUUID:()=> 'synthetic'},
    storage:{getItem:()=>null,setItem(){},removeItem(){}}, fetch:async (url: string,options: any) => {
      requests.push({ url, options }); return {ok:true,json:async()=>({})}; } });
  core.state.csrfToken='synthetic-csrf';core.presence.success();
  assert.equal(core.processingLabel({phase:'retrying'}),'模型响应慢，正在重试…');
  for (const file of ['src/personal-access-ui/app.js','apps/mobile-ui/www/components/cloud-account.js']) {
    const source = readFileSync(new URL('../'+file,import.meta.url),'utf8');
    const transport = source.match(/host: (\(path, body\) => core\.accessApi\(path, \{[^\n]+?\}\))/)?.[1]; assert.ok(transport,file);
    const host = runInNewContext('('+transport+')',{core});
    for (const path of ['/offline/sync','/offline/turns']) {
      const payload={generation:1,hashes:{},turns:[]}; await host(path,payload);
      const {options}=requests.at(-1); assert.deepEqual(JSON.parse(options.body),payload);
      assert.equal(options.headers['X-WeftMate-CSRF'],'synthetic-csrf'); assert.equal(options.headers['content-type'],'application/json');
    }
  }
});
