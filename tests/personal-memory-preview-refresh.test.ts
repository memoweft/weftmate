import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

async function previewHarness() {
 const context:any={WeftUiCore:{factories:{}},AbortSignal,URL,setTimeout:(fn:any)=>setTimeout(fn,0),clearTimeout};
 runInNewContext(await readFile(new URL('../src/ui-core/memory.js',import.meta.url),'utf8'),context);
 const core:any={state:{identityGeneration:1,account:{ownerId:'owner'},device:{id:'device'},csrfToken:'csrf',currentView:'memory',hostId:'host'},
  memory:{viewGeneration:0,selectedGeneration:0,selected:{kind:'cognition',id:'tea',worldRevision:1},mode:'detail'},memoryKinds:{cognition:'理解'}};
 const effects=new Proxy({}, {get:()=>()=>{}});
 Object.assign(core,context.WeftUiCore.factories.memory(core,effects,{}));
 core.readMemoryItem=async()=>({item:{kind:'cognition',id:'tea'},worldRevision:2});
 core.readMemorySources=async()=>({sources:[],worldRevision:2});
 return core;
}

test('initial forget preview recovers formation and a new revision in the same confirmation flow without deleting',async()=>{
 const core=await previewHarness();let reads=0,writes=0;
 core.submitMemoryCommand=async()=>{writes++};
 core.readForgetPreview=async()=>{if(++reads===1)throw{code:'MEMORY_FORMATION_PENDING'};return{worldRevision:2,forgetScope:'fresh',items:[]}};
 await core.setMemoryMode('delete');
 assert.equal(reads,2);assert.equal(core.memory.selected.worldRevision,2);
 assert.equal(core.memory.forgetPreview?.forgetScope,'fresh');assert.equal(writes,0);
});

test('initial preview failure can be retried in place with fresh detail and sources',async()=>{
 const core=await previewHarness();let reads=0;
 core.readForgetPreview=async()=>{if(++reads===1)throw{code:'NETWORK'};return{worldRevision:2,forgetScope:'fresh',items:[]}};
 await core.setMemoryMode('delete');
 assert.equal(core.memory.forgetPreview,null);
 assert.match(core.memory.forgetPreviewError,/重新读取遗忘范围/);
 await core.setMemoryMode('delete');assert.equal(core.memory.forgetPreview?.forgetScope,'fresh');
});

for(const change of ['host','account','device','close','selection','new-read'])test(`pending preview cannot publish after ${change}`,async()=>{
 const core=await previewHarness();let resolve:any;
 core.readMemoryItem=async()=>({item:{kind:'cognition',id:'tea'},worldRevision:1});
 core.readMemorySources=async()=>({sources:[],worldRevision:1});
 core.readForgetPreview=()=>new Promise(r=>{resolve=r});
 const pending=core.setMemoryMode('delete');while(!resolve)await new Promise(r=>setTimeout(r,0));
 if(change==='host')core.state.hostId='other-host';
 if(change==='account')core.state.account.ownerId='other-owner';
 if(change==='device')core.state.device.id='other-device';
 if(change==='close')core.closeMemoryDetail();
 if(change==='selection')core.memory.selectedGeneration++;
 if(change==='new-read'){
   core.readForgetPreview=async()=>({worldRevision:1,forgetScope:'new-read',items:[]});await core.setMemoryMode('delete');
 }
 resolve({worldRevision:1,forgetScope:'old-host',items:[]});await pending;
 assert.equal(core.memory.forgetPreview?.forgetScope,change==='new-read'?'new-read':undefined);
});

test('formation preview read is bounded and leaves the same panel retryable with no credential',async()=>{
 const core=await previewHarness();let reads=0;
 core.readForgetPreview=async()=>{reads++;throw{code:'MEMORY_FORMATION_PENDING'}};
 await core.setMemoryMode('delete');assert.equal(reads,7);assert.equal(core.memory.forgetPreview,null);
 assert.equal(core.memory.forgetPreviewLoading,false);assert.match(core.memory.forgetPreviewError,/重新读取遗忘范围/);
});

test('a source revision mismatch never exposes a partial preview and rereads the entire range',async()=>{
 const core=await previewHarness();let sources=0,previews=0;
 core.readMemorySources=async()=>({sources:[],worldRevision:++sources===1?3:2});
 core.readForgetPreview=async()=>{previews++;return{worldRevision:2,forgetScope:'full',items:[]}};
 await core.setMemoryMode('delete');assert.equal(sources,2);assert.equal(previews,1);
 assert.equal(core.memory.forgetPreview?.forgetScope,'full');
});

for (const responseKind of ['preflight', 'scope-receipt'] as const) test(`stale preview (${responseKind}) is replaced read-only and needs a second confirmation`, async () => {
  const context: any = { WeftUiCore: { factories: {} }, AbortSignal, URL, setTimeout, clearTimeout };
  runInNewContext(await readFile(new URL('../src/ui-core/memory.js', import.meta.url), 'utf8'), context);
  const storage = new Map(), notices: string[] = [], writes: any[] = []; let sequence = 0, previewReads = 0;
  const core: any = { state: { identityGeneration: 1, account: { ownerId: 'owner' }, device: { id: 'device' },
    csrfToken: 'csrf', currentView: 'memory', hostId: 'host' }, memoryBase: 'http://synthetic/memory',
    memoryKinds: { cognition: '理解' }, memoryPreDispatchCodes: new Set(), memoryPathId: (id: string) => id,
    memory: { viewGeneration: 0, selectedGeneration: 0, operationGeneration: 0,
      selected: { kind: 'cognition', id: 'tea', worldRevision: 1 }, mode: 'delete',
      forgetPreview: { worldRevision: 1, forgetScope: 'old-scope' }, drafts: new Map(), activeOperation: null },
  };
  const effects = new Proxy({ paintMemoryReceipt: (message: string) => notices.push(message),
    detailError: (message: string) => notices.push(message) }, { get: (value, key) => value[key] ?? (() => {}) });
  const environment = { crypto: { randomUUID: () => `request-${++sequence}` }, storage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  } };
  Object.assign(core, context.WeftUiCore.factories.memory(core, effects, environment));
  core.memoryActionAllowed = () => true;
  core.readMemoryItem = async () => ({ item: { kind: 'cognition', id: 'tea', text: '用户更喜欢绿茶' }, worldRevision: 2 });
  core.readMemorySources = async () => ({ sources: [], worldRevision: 2 });
  core.readForgetPreview = async () => { previewReads++; return { worldRevision: 2, forgetScope: 'new-scope', items: [{ id: 'green' }] }; };
  core.submitMemoryCommand = async (_selected: any, _operation: string, body: any) => {
    writes.push(body);
    if (writes.length === 1) {
      if (responseKind === 'scope-receipt') return { receipt: { state: 'rejected', requestId: body.requestId, reasonCode: 'MEMORY_REVISION_CHANGED' } };
      throw { code: 'MEMORY_REVISION_CHANGED', status: 409, payload: { state: 'withheld' } };
    }
    return { receipt: { state: 'applied', requestId: body.requestId, storageCleanup: { state: 'complete' } } };
  };
  core.refreshMemoryStatus = async () => false;
  await core.submitMemoryAction();
  assert.equal(writes.length, 1, 'no automatic resubmission with a freshly obtained credential');
  assert.equal(core.memory.unresolvedMarker, null, 'the server explicitly said no submission occurred');
  assert.equal(previewReads, 1);
  assert.equal(core.memory.selected.worldRevision, 2);
  assert.equal(core.memory.forgetPreview.forgetScope, 'new-scope');
  assert.match(notices.join('\n'), /重新确认|再确认/);
  assert.doesNotMatch(notices.join('\n'), /已移除|待确认|稍后.*重试/);
  await core.submitMemoryAction();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].expectedWorldRevision, 2);
  assert.equal(writes[1].forgetScope, 'new-scope');
  assert.notEqual(writes[0].requestId, writes[1].requestId);
  assert.match(notices.join('\n'), /已移除/);
});

for (const receiptState of ['revision_conflict', 'rejected'] as const) test(`recovered delete ${receiptState} clears the pending marker and requires fresh confirmation`, async () => {
  const context: any = { WeftUiCore: { factories: {} }, AbortSignal, URL, setTimeout, clearTimeout };
  runInNewContext(await readFile(new URL('../src/ui-core/memory.js', import.meta.url), 'utf8'), context);
  const storage = new Map(), notices: string[] = []; let receiptReads = 0, previewReads = 0, writes = 0;
  const actions = { delete: { available: true }, correct: { available: true } };
  const marker = { requestId: 'memory-recover-conflict', kind: 'cognition', id: 'tea', operation: 'delete',
    selectedGeneration: 0, hostId: 'host' };
  const core: any = { state: { identityGeneration: 1, account: { ownerId: 'owner' }, device: { id: 'device' },
    csrfToken: 'csrf', currentView: 'memory', hostId: 'host' }, memoryBase: 'http://synthetic/memory',
    memoryKinds: { cognition: '理解' }, memoryPathId: (id: string) => id,
    memory: { viewGeneration: 0, selectedGeneration: 7, operationGeneration: 0,
      selected: { kind: 'cognition', id: 'tea', worldRevision: 1, availableActions: actions }, mode: 'delete',
      status: { state: 'ready', capabilities: { deleteWorldItem: true, correct: true } },
      forgetPreview: { worldRevision: 1, forgetScope: 'old-scope' }, drafts: new Map(),
      activeOperation: null, unresolvedMarker: marker },
  };
  const effects = new Proxy({ paintMemoryReceipt: (message: string) => notices.push(message),
    detailError: (message: string) => notices.push(message) }, { get: (value, key) => value[key] ?? (() => {}) });
  const environment = { storage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  } };
  Object.assign(core, context.WeftUiCore.factories.memory(core, effects, environment));
  core.memoryRequest = async (path: string) => {
    assert.equal(path, '/commands/by-request/memory-recover-conflict'); receiptReads++;
    return { receipt: { requestId: marker.requestId, state: receiptState,
      ...(receiptState === 'rejected' ? { reasonCode: 'MEMORY_REVISION_CHANGED' } : {}) } };
  };
  core.readMemoryItem = async () => ({ item: { kind: 'cognition', id: 'tea', text: '用户更喜欢绿茶' }, availableActions: actions, worldRevision: 2 });
  core.readMemorySources = async () => ({ sources: [], worldRevision: 2 });
  core.readForgetPreview = async () => { previewReads++; return { worldRevision: 2, forgetScope: 'new-scope', items: [{ id: 'green' }] }; };
  core.submitMemoryCommand = async () => { writes++; throw Error('Recovery must never submit a deletion'); };
  const key = core.memoryMarkerKey();
  assert.equal(core.persistMemoryMarker(marker, key), true);
  assert.equal(core.memoryActionAllowed('correct'), false, 'the unresolved deletion initially blocks further actions');
  await core.recoverMemoryReceipt();
  assert.equal(core.storedMemoryMarker(key), null, 'a definitive rejection clears the persistent request marker');
  assert.equal(storage.has(key), false);
  assert.equal(core.memory.unresolvedMarker, null);
  assert.equal(previewReads, 1, 'the current selection is refreshed read-only');
  assert.equal(core.memory.selectedGeneration, 8, 'recovery captures the current selection generation rather than the old marker generation');
  assert.equal(core.memory.selected.worldRevision, 2);
  assert.equal(core.memory.forgetPreview.forgetScope, 'new-scope');
  assert.match(core.memory.receiptNotice.message, /重新确认|再确认/);
  assert.doesNotMatch(notices.join('\n'), /尚未确认|已移除/);
  assert.equal(core.memoryActionAllowed('correct'), true);
  assert.equal(core.memoryActionAllowed('delete'), true);
  await core.recoverMemoryReceipt();
  assert.equal(receiptReads, 1, 'subsequent recovery does not revisit a cleared marker');
  assert.equal(writes, 0, 'new scope still requires the user to confirm; never retry automatically');
});

test('a confirmed non-submission while formation is active discards the old preview and never retries deletion',async()=>{
 const context:any={WeftUiCore:{factories:{}},AbortSignal,URL,setTimeout,clearTimeout};
 runInNewContext(await readFile(new URL('../src/ui-core/memory.js',import.meta.url),'utf8'),context);
 const storage=new Map(),notices:string[]=[];let writes=0;
 const core:any={state:{identityGeneration:1,account:{ownerId:'owner'},device:{id:'device'},csrfToken:'csrf',currentView:'memory',hostId:'host'},
  memoryBase:'http://synthetic/memory',memoryKinds:{cognition:'理解'},memoryPreDispatchCodes:new Set(),memoryPathId:(id:string)=>id,
  memory:{viewGeneration:0,selectedGeneration:0,operationGeneration:0,selected:{kind:'cognition',id:'tea',worldRevision:1},mode:'delete',
   forgetPreview:{worldRevision:1,forgetScope:'old-scope'},drafts:new Map(),activeOperation:null}};
 const effects=new Proxy({detailError:(m:string)=>notices.push(m),paintMemoryReceipt:(m:string)=>notices.push(m)}, {get:(v,k)=>v[k]??(()=>{})});
 const environment={crypto:{randomUUID:()=>`request-${writes}`},storage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}};
 Object.assign(core,context.WeftUiCore.factories.memory(core,effects,environment));core.memoryActionAllowed=()=>true;
 core.submitMemoryCommand=async()=>{writes++;throw{code:'MEMORY_FORMATION_PENDING',payload:{state:'withheld'}};};
 await core.submitMemoryAction();
 assert.equal(writes,1);assert.equal(core.memory.unresolvedMarker,null);assert.equal(core.memory.forgetPreview,null);
 assert.match(notices.join('\n'),/整理/);assert.match(notices.join('\n'),/没有删除/);assert.match(notices.join('\n'),/重新/);
 await core.submitMemoryAction();assert.equal(writes,1,'old confirmation cannot reuse its credential while waiting for a new preview');
});
