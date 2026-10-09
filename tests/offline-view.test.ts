import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { uiCoreAssets } from '../src/ui-core/manifest.mjs';

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
  return { environment, body, fail(error: any) { failure = error; } };
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
test('polling never navigates over approvals; return stays closed on repeated offline ticks', async () => {
  const f = fixture();
  const mounted = f.environment.WeftOfflineView.mount({ core: {}, identity: async () => ({ origin:'synthetic',ownerId:'owner',deviceId:'phone',hostId:'host' }) });
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
  const mounted = f.environment.WeftOfflineView.mount({ core: {}, openConversation: () => opened++,
    identity: async () => ({origin:'synthetic',ownerId:'owner',deviceId:'phone',hostId:'host'}) });
  await new Promise(resolve => setImmediate(resolve));f.fail({code:'NETWORK'});await mounted.tick();
  const [launcher] = f.body.children;launcher.listeners.click();
  assert.equal(opened,1);assert.equal(scroller.children[0].hidden,false);
  assert.ok(!f.body.children.includes(scroller.children[0]));mounted.close();
});
test('both production mount transports pass objects and protected writes through requestJson', async () => {
  const context: any = { AbortSignal, URL, URLSearchParams };
  runInNewContext(uiCoreAssets.map(name => readFileSync(new URL(`../src/ui-core/${name}`,import.meta.url),'utf8')).join('\n;\n'),context);
  const requests: any[] = [];
  const core = context.WeftUiCore.create({ effects: new Proxy({}, {get:()=>()=>{}}), crypto:{randomUUID:()=> 'synthetic'},
    storage:{getItem:()=>null,setItem(){},removeItem(){}}, fetch:async (url: string,options: any) => {
      requests.push({ url, options }); return {ok:true,json:async()=>({})}; } });
  core.state.csrfToken='synthetic-csrf';
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
