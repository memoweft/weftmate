import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createHistoryImport } from '../src/personal-access/history-import.mjs';
import { createPhoneHistory } from '../src/personal-access/phone-history.mjs';
import { reconcileChatIdentity } from '../src/personal-access/chat-identity.mjs';
import { createOfflineService } from '../src/personal-offline/index.mjs';
import { durableWrite } from '../src/personal-access/store.mjs';
import '../src/ui-core/phone-memory.js';
import '../src/ui-core/offline.js';

const W = (globalThis as any).WeftOffline;

export async function createPhoneHandoverFixture(t: any, clientCrypto: any = webcrypto) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-phone-handover-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const accounts: any = { a: { sessions: {}, commands: {}, defaultModelProfileId: 'local' }, b: { sessions: {}, commands: {}, defaultModelProfileId: 'local' } };
  const boundaries: any[] = [], ledger: any[] = [];
  let requestOwner = 'a', requestDevice = 'phone-a';
  const ctx: any = {
    root, rootState: { hostId: 'synthetic-host', accounts }, timestamp: Date.now,
    accountState: (id: string) => accounts[id], serial: async (work: any) => work(),
    mutate: async (id: string, work: any) => { work(accounts[id]); reconcileChatIdentity(accounts[id], 'synthetic-host', new Date().toISOString()); await durableWrite(join(root, 'accounts.json'), accounts); },
    active: new Set(), pendingPreflights: new Set(),
    authenticate: () => ({ ownerId: requestOwner, deviceId: requestDevice, via: 'cookie', device: { authKind: 'cloud', name: requestDevice, scopes: ['account:manage', 'sessions:read'] } }),
    readJson: (request: any) => request.body, json: (_request: any, _status: number, value: any) => value,
    modelSelectable: () => true, service: { currentChatModelProfile: () => null },
    backend: { listModels: async () => [{ id: 'local', sourceKind: 'local', configured: true, name: 'local model' }], describeSession: async () => null, readEvents: async () => ({ events: [] }) },
    usage: { settings: () => ({ prices: {} }), assertAllowed() {}, exportAccount: () => ({ records: [] }) },
    activity: { record: async () => {} },
    cloudIdentity: { publishOffline: async (_id: string, generation: number) => ({ hostId: 'synthetic-host', accountId: 'synthetic-account', generation }) },
    memoryManager: {
      enabled: true, peek: () => 'connected',
      query: async (_id: string, method: string, params: any) => method === 'query_jobs' ? { jobs: ledger } : method === 'query_world' && params.operation === 'revision' ? { world_revision: 1 } : { world_revision: 1, items: [] },
      ingestImport: async (_id: string, boundary: any) => { boundaries.push(boundary); ledger.push({ acceptance: { boundary_event_id: boundary.event_id, evidence_ids: [`e${boundaries.length}`] }, worker: { state: 'applied' } }); },
      submitCommand: async () => ({ receipt: { result_state: 'applied', storage_cleanup: { state: 'complete' } } }),
      eraseConversationContext: async () => ({ storage_cleanup: { state: 'complete' } }), discardOfflinePending: async () => {},
    },
  };
  ctx.phoneHistory = createPhoneHistory(ctx, ctx.backend); ctx.backend = ctx.phoneHistory.backend;
  ctx.historyImport = createHistoryImport(ctx); ctx.offline = await createOfflineService(ctx);
  t.after(async () => { await ctx.historyImport.close(); await ctx.offline.close(); });
  const database = new IDBFactory(), vaultName = 'handover-policy';
  const complete = async (body: any) => {
      if (body.max_tokens) {
        const request = JSON.parse(body.messages[1].content);
        if (request.request) return { choices: [{ message: { content: JSON.stringify({ intent: 'forget', request: request.request, ids: [request.items[0].id] }) } }] };
        const source = request['原话'][0];
        const subject = source.text.includes('荔枝') ? '荔枝' : source.text.includes('绿茶') ? '绿茶' : source.text.includes('红茶') ? '红茶' : '白茶';
        const text = subject === '荔枝' ? '最喜欢的水果是荔枝' : `喜欢${subject}`;
        const evidence = subject;
        const previousTea = subject === '绿茶' ? request['已有记忆'].find((item: any) => item.text.includes('红茶')) : null;
        return { choices: [{ message: { content: JSON.stringify({ upsert: [{ id: previousTea?.id ?? null, text, evidence, sourceIDs: [source.id] }], invalidate: [] }) } }] };
      }
      const user = body.messages.at(-1)?.content ?? '';
      return { choices: [{ message: { content: user.includes('长白茶') ? '合成回复'.repeat(9000) : '收到。' } }] };
    };
  const call = (path: string, body: any) => ctx.offline.handle({ method: 'POST', body }, {}, new URL(`http://synthetic/personal/v1${path}`), requestOwner);
  const requests: any[] = []; let transform = (_path: string, _body: any, result: any) => result;
  const host = async (path: string, body: any) => { requests.push(structuredClone({ path, body })); return transform(path, body, await call(path, body)); };
  const buildEngine = async (vault: any) => { vault.complete = complete; return W.create({ vault, identity: { ownerId: 'a', hostId: 'synthetic-host', deviceId: 'phone-a' }, crypto: clientCrypto,
    phoneModel: () => ({ modelId: 'synthetic' }), accountCheck: async () => ({}), hostCapabilities: () => ({ offlinePhoneFirst: 1 }),
    host, control: async () => ({ authorized: true, accountId: 'synthetic-account', hostId: 'synthetic-host', generation: accounts.a.generation ?? 1 }) }); };
  let engine: any = await buildEngine(await W.browserVault(vaultName, { indexedDB: database, crypto: webcrypto }));
  t.after(() => engine.close());
  const f: any = { ctx, boundaries, ledger, requests, call, setRequestIdentity: (owner: string, device: string) => { requestOwner = owner; requestDevice = device; }, setResponseTransform: (next: any) => { transform = next; }, get engine() { return engine; },
    async restart() { engine.close(); engine = await buildEngine(await W.browserVault(vaultName, { indexedDB: database, crypto: webcrypto })); return engine; },
    async restartServer() {
      await ctx.historyImport.close(); await ctx.offline.close();
      const restored=JSON.parse(await readFile(join(root, 'accounts.json'), 'utf8'));
      for(const key of Object.keys(accounts))delete accounts[key];Object.assign(accounts,restored);
      ctx.phoneHistory=createPhoneHistory(ctx,ctx.backend);ctx.backend=ctx.phoneHistory.backend;
      ctx.historyImport=createHistoryImport(ctx);ctx.offline=await createOfflineService(ctx);
    } };
  return f;
}

test('HANDOVER-POLICY red: explicitly forgotten white-tea source remains readable history but never enters Core formation; independent lychee still imports', async t => {
  const f = await createPhoneHandoverFixture(t);
  const white = await f.engine.send('请记住，我喜欢白茶。');
  assert.equal(await f.engine.extractMemory(white.conversationId), true);
  const whiteItem = f.engine.view().phoneMemory.items.find((item: any) => item.text.includes('白茶'));
  assert.ok(whiteItem, 'the phone must actually form white tea before the user forgets it');
  const forgotten = await f.engine.send('请忘掉我喜欢白茶这项记忆。', white.conversationId);
  assert.match(forgotten.text, /已经忘掉/);
  assert.equal(f.engine.view().phoneMemory.items.some((item: any) => item.text.includes('白茶')), false);
  const lychee = await f.engine.send('请记住，我最喜欢的水果是荔枝。');
  assert.equal(await f.engine.extractMemory(lychee.conversationId), true);
  assert.ok(f.engine.view().phoneMemory.items.some((item: any) => item.text.includes('荔枝')));

  await f.engine.sync();
  for (let i = 0; i < 16; i++) await f.ctx.historyImport.tick();

  const storedWhite = Object.values(f.ctx.accountState('a').phoneHistory).some((conversation: any) => conversation.turns.some((turn: any) => turn.messages.some((message: any) => message.text.includes('白茶'))));
  assert.equal(storedWhite, true, 'handover keeps the original chat as readable history');
  const formed = f.boundaries.map(boundary => boundary.source_messages.map((message: any) => message.content).join('\n')).join('\n');
  assert.doesNotMatch(formed, /白茶/, 'a source blocked by confirmed phone forgetting must not be submitted to Core');
  assert.match(formed, /荔枝/, 'an independent, unblocked source still reaches Core formation');
});

test('HANDOVER-POLICY red: page-forgotten red-to-green correction sources do not re-form after handover', async t => {
  const f = await createPhoneHandoverFixture(t);
  const red = await f.engine.send('请记住，我喜欢红茶。');
  assert.equal(await f.engine.extractMemory(red.conversationId), true);
  const green = await f.engine.send('我现在更喜欢绿茶，不是红茶。', red.conversationId);
  assert.equal(await f.engine.extractMemory(green.conversationId), true);
  const items = f.engine.view().phoneMemory.items;
  assert.equal(items.length, 1, 'a normal correction updates the same phone item');
  assert.match(items[0].text, /绿茶/);
  assert.equal(items[0].sourceIDs.length, 2, 'the revision retains both original and correcting sources');
  await f.engine.memoryChange('forget', items[0].id);
  assert.equal(f.engine.view().phoneMemory.items.some((item: any) => /红茶|绿茶/.test(item.text)), false);

  await f.engine.sync();
  for (let i = 0; i < 16; i++) await f.ctx.historyImport.tick();
  const formed = f.boundaries.map(boundary => boundary.source_messages.map((message: any) => message.content).join('\n')).join('\n');
  assert.doesNotMatch(formed, /红茶|绿茶/, 'confirmed page forgetting blocks both the original and correction source from Core formation');
});

test('HANDOVER-POLICY preserves an ordinary correction: unblocked green-tea source still reaches Core', async t => {
  const f = await createPhoneHandoverFixture(t);
  const red = await f.engine.send('请记住，我喜欢红茶。');
  await f.engine.extractMemory(red.conversationId);
  const green = await f.engine.send('我现在更喜欢绿茶，不是红茶。', red.conversationId);
  await f.engine.extractMemory(green.conversationId);
  await f.engine.sync();
  for (let i = 0; i < 16; i++) await f.ctx.historyImport.tick();
  const formed = f.boundaries.map(boundary => boundary.source_messages.map((message: any) => message.content).join('\n')).join('\n');
  assert.match(formed, /绿茶/, 'a normal correction is not a deletion command and must still be handed over');
});

test('HANDOVER-POLICY red: an edited live item that still depends on a blocked source keeps phone authority pending', async t => {
  const f = await createPhoneHandoverFixture(t);
  const red = await f.engine.send('请记住，我喜欢红茶。');
  await f.engine.extractMemory(red.conversationId);
  const item = f.engine.view().phoneMemory.items[0];
  await f.engine.memoryChange('edit', item.id, '我喜欢绿茶');
  assert.ok(f.engine.view().phoneMemory.suppressedSources.includes(red.conversationId ? f.engine.view().conversations[0].turns[0].id : ''), 'editing marks its old source as not eligible for re-formation');
  assert.equal(await f.engine.sync(), false);
  assert.equal(f.engine.view().handover.blockedReason, 'mixed-source');
  assert.equal(f.requests.some((request: any) => request.path === '/offline/turns'), false, 'the source policy must stop before sending a mixed source');
  assert.equal(f.engine.view().phoneMemory.transferred, false, 'mixed live understanding must not be cleared while its blocked source cannot be legally formed');
  assert.ok(f.engine.view().phoneMemory.items.some((row: any) => row.text.includes('绿茶')), 'the only retained phone understanding remains available until a lawful handover exists');
});

test('HANDOVER-POLICY red: a missing source-policy receipt retains the queued phone state', async t => {
  const f = await createPhoneHandoverFixture(t);
  const white = await f.engine.send('请记住，我喜欢白茶。');
  await f.engine.extractMemory(white.conversationId);
  const id = f.engine.view().phoneMemory.items[0].id;
  await f.engine.memoryChange('forget', id);
  f.setResponseTransform((path: string, _body: any, result: any) => path === '/offline/turns'
    ? { ...result, receipts: result.receipts.map((receipt: any) => ({ ...receipt, memoryPolicy: undefined })) } : result);
  await assert.rejects(f.engine.sync(), { code: 'OFFLINE_RECEIPT_REQUIRED' });
  const turnRequest = f.requests.find((request: any) => request.path === '/offline/turns');
  assert.ok(turnRequest.body.turns.every((turn: any) => turn.memoryPolicy?.version === 1), 'all phone-first handover turns carry a versioned source policy');
  assert.equal(f.engine.view().phoneMemory.transferred, false, 'a receipt without policy acceptance cannot clear local suppression state');
});

test('HANDOVER-POLICY persists the frozen source policy across an actual encrypted-vault restart', async t => {
  const f = await createPhoneHandoverFixture(t);
  const white = await f.engine.send('请记住，我喜欢白茶。');
  await f.engine.extractMemory(white.conversationId);
  await f.engine.memoryChange('forget', f.engine.view().phoneMemory.items[0].id);
  f.setResponseTransform((path: string, _body: any, result: any) => path === '/offline/turns'
    ? { ...result, receipts: result.receipts.map((receipt: any) => ({ ...receipt, memoryPolicy: undefined })) } : result);
  await assert.rejects(f.engine.sync(), { code: 'OFFLINE_RECEIPT_REQUIRED' });
  const expected = f.engine.view().turns.map((turn: any) => ({ id: turn.id, memoryPolicy: turn.memoryPolicy }));
  const expectedBlocked = [...f.engine.view().phoneMemory.suppressedSources];
  await f.restart();
  assert.deepEqual(f.engine.view().turns.map((turn: any) => ({ id: turn.id, memoryPolicy: turn.memoryPolicy })), expected,
    'restart reads the same frozen per-turn policy instead of recalculating an allow policy');
  assert.deepEqual(f.engine.view().phoneMemory.suppressedSources, expectedBlocked, 'restart keeps the local source suppression until a matching receipt arrives');
  assert.equal(f.engine.view().phoneMemory.transferred, false);
});

test('HANDOVER-POLICY rejects a new explicit forget before any model request once first handover is pending', async t => {
  const f = await createPhoneHandoverFixture(t);
  const white = await f.engine.send('请记住，我喜欢白茶。');
  await f.engine.extractMemory(white.conversationId);
  f.setResponseTransform((path: string, _body: any, result: any) => path === '/offline/turns'
    ? { ...result, receipts: result.receipts.map((receipt: any) => ({ ...receipt, memoryPolicy: undefined })) } : result);
  await assert.rejects(f.engine.sync(), { code: 'OFFLINE_RECEIPT_REQUIRED' });
  const requestCount = f.requests.length;
  await assert.rejects(f.engine.send('请忘掉我喜欢白茶这项记忆。', white.conversationId), { code: 'MEMORY_HANDOVER_PENDING' });
  assert.equal(f.requests.length, requestCount, 'the rejected deletion does not make a model request or return a deletion receipt');
  assert.equal(f.engine.view().handover.blockedReason, 'memory-change');
  assert.ok(f.engine.view().phoneMemory.items.some((item: any) => item.text.includes('白茶')));
});

test('HANDOVER-POLICY rejects a changed source policy from another device and scopes a same-id source to its account', async t => {
  const f = await createPhoneHandoverFixture(t);
  const tea = await f.engine.send('请记住，我喜欢红茶。');
  await f.engine.extractMemory(tea.conversationId);
  await f.engine.sync();
  const syncRequest = structuredClone(f.requests.find((request: any) => request.path === '/offline/sync').body);
  const accepted = structuredClone(f.requests.find((request: any) => request.path === '/offline/turns').body);
  const changed = structuredClone(accepted);
  changed.turns[0].memoryPolicy = { version: 1, inference: 'blocked', reason: 'forgotten' };
  await assert.rejects(f.call('/offline/turns', changed), { code: 'REQUEST_CONFLICT' }, 'the original device cannot rewrite a stored source policy');

  f.setRequestIdentity('a', 'phone-b');
  await f.call('/offline/sync', syncRequest);
  await assert.rejects(f.call('/offline/turns', changed), { code: 'REQUEST_CONFLICT' }, 'a second phone cannot rewrite another phone source policy');

  const historyA = structuredClone(f.ctx.accountState('a').phoneHistory);
  f.setRequestIdentity('b', 'phone-b');
  await f.call('/offline/sync', syncRequest);
  await f.call('/offline/turns', changed);
  assert.deepEqual(f.ctx.accountState('a').phoneHistory, historyA, 'a source-policy packet in another account cannot suppress or delete account A history');
  assert.ok(Object.keys(f.ctx.accountState('b').phoneHistory).length > 0, 'the same source ID is stored only under account B when that account authorizes it');
});

test('HANDOVER-POLICY carries a blocked source policy inside a reassembled turn fragment and skips only formation', async t => {
  const f = await createPhoneHandoverFixture(t);
  const long = await f.engine.send('请记住，我喜欢长白茶。');
  assert.equal(await f.engine.extractMemory(long.conversationId), true);
  await f.engine.memoryChange('forget', f.engine.view().phoneMemory.items[0].id);
  for (let i = 0; i < 3 && f.engine.view().turns.length; i++) await f.engine.sync();
  for (let i = 0; i < 16; i++) await f.ctx.historyImport.tick();
  assert.ok(f.requests.some((request: any) => request.path === '/offline/turns' && request.body.turnFragments?.length), 'the actual engine used the fragment route');
  assert.ok(f.ctx.accountState('a').phoneHistory, 'fragment completion must create read-only history before the client removes its outbox turn');
  const stored = Object.values(f.ctx.accountState('a').phoneHistory).flatMap((conversation: any) => conversation.turns).find((turn: any) => turn.id === f.engine.view().conversations[0].turns[0].id);
  assert.ok(stored, 'the long original remains in read-only phone history after reassembly');
  assert.deepEqual(stored.memoryPolicy, { version: 1, inference: 'blocked', reason: 'forgotten' });
  assert.doesNotMatch(f.boundaries.map(boundary => JSON.stringify(boundary)).join('\n'), /长白茶/, 'the reassembled blocked source never enters Core formation');
});


test('HANDOVER-POLICY persists received qualification and skips across a real server account snapshot reload', async t => {
  const f=await createPhoneHandoverFixture(t);
  const white=await f.engine.send('请记住，我喜欢白茶。');await f.engine.extractMemory(white.conversationId);
  await f.engine.memoryChange('forget',f.engine.view().phoneMemory.items[0].id);
  const fruit=await f.engine.send('请记住，我最喜欢的水果是荔枝。');await f.engine.extractMemory(fruit.conversationId);
  await f.engine.sync();
  const oldAccount=f.ctx.accountState('a');await f.restartServer();assert.notEqual(f.ctx.accountState('a'),oldAccount);
  for(let i=0;i<16;i++)await f.ctx.historyImport.tick();
  const body=f.boundaries.map((b:any)=>JSON.stringify(b)).join('');assert.doesNotMatch(body,/白茶/);assert.match(body,/荔枝/);
  const job=f.ctx.historyImport.list('a').imports[0];assert.equal(job.state,'completed');assert.equal(job.received,2);assert.equal(job.processed,1);assert.equal(job.skipped,1);
  await f.restartServer();const restored=f.ctx.historyImport.list('a').imports[0];assert.equal(restored.skipped,1);assert.equal(restored.processed,1);
  const blocked=Object.values(f.ctx.accountState('a').phoneHistory).flatMap((c:any)=>c.turns).find((row:any)=>row.memoryPolicy?.inference==='blocked');assert.ok(blocked);
  const history=await f.ctx.backend.readEvents({ownerId:'a',sessionId:Object.values(f.ctx.accountState('a').phoneHistory).find((c:any)=>c.turns.includes(blocked)).sessionId,limit:100});
  assert.ok(history.events.some((event:any)=>event.data.text.includes('白茶')),'the forbidden source is still ordinary readable history after restart');
});

test('HANDOVER-POLICY fails closed against an old computer without transmitting an unqualified fallback', async t => {
  const W=(globalThis as any).WeftOffline,M=(globalThis as any).WeftPhoneMemory;
  let sent=0,stored:any;const turn={id:'legacy-probe',conversationId:'legacy-conversation',timestamp:1,messages:[{role:'user',text:'喜欢红茶'}]};
  const state={snapshot:null,turns:[turn],conversations:[{id:turn.conversationId,turns:[turn]}],phoneMemory:M.fresh()};
  const e=await W.create({identity:{},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),vault:{load:async()=>structuredClone(state),save:async(v:any)=>{stored=structuredClone(v)},key:async()=>({}),open:async(v:any)=>v,close(){}},host:async(path:string)=>{if(path==='/offline/turns'){sent++;throw Error('INVALID_REQUEST')}return{generation:1,reset:false,items:[],remove:[],hashes:{},control:{accountId:'a'},memoryAuthority:{ready:true}};}});t.after(()=>e.close());
  await assert.rejects(e.sync(),{code:'COMPUTER_UPDATE_REQUIRED'});assert.equal(sent,0);assert.equal(e.view().turns.length,1);assert.equal(stored.phoneMemory.transferred,false);
});

test('HANDOVER-POLICY old phones and malformed policies cannot enqueue formation or write phone history', async t => {
  const f=await createPhoneHandoverFixture(t);const fruit=await f.engine.send('请记住，我最喜欢的水果是荔枝。');await f.engine.extractMemory(fruit.conversationId);await f.engine.sync();
  const packet=structuredClone(f.requests.find((r:any)=>r.path==='/offline/turns').body);
  for(const policy of [undefined,{version:2,inference:'blocked',reason:'forgotten'},{version:1,inference:'blocked',reason:'arbitrary'},{version:1,inference:'allowed',ownerId:'another-account'}]){
    const next=structuredClone(packet);next.turns[0].id='new-policy-probe';next.turns[0].memoryPolicy=policy;
    await assert.rejects(f.call('/offline/turns',next),{code:policy===undefined?'PHONE_MEMORY_POLICY_REQUIRED':'INVALID_REQUEST'});
  }
  assert.equal(Object.values(f.ctx.accountState('a').phoneHistory).flatMap((c:any)=>c.turns).length,1);
});


test('HANDOVER-POLICY stops a not-yet-sent fragment after forgetting pauses a digest in flight', async t => {
  let armed=false,entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args:any[])=>{if(armed){armed=false;entered();await gate;}return (webcrypto.subtle.digest as any)(...args);}}};
  const f=await createPhoneHandoverFixture(t,crypto);
  const white=await f.engine.send('请记住，我喜欢长白茶。');await f.engine.extractMemory(white.conversationId);
  armed=true;const syncing=f.engine.sync();await ready;
  assert.equal(f.requests.filter((r:any)=>r.path==='/offline/turns').length,0);
  await assert.rejects(f.engine.send('请忘掉白茶偏好。'),{code:'MEMORY_HANDOVER_PENDING'});
  release();await syncing;
  assert.equal(f.requests.filter((r:any)=>r.path==='/offline/turns').length,0,'a pause must stop a packet that was not yet submitted');
  assert.equal(f.engine.view().phoneMemory.transferred,false);
});

test('HANDOVER-POLICY can replay all fragments after the final policy acknowledgement was missing', async t => {
  const f=await createPhoneHandoverFixture(t);
  const white=await f.engine.send('请记住，我喜欢长白茶。');await f.engine.extractMemory(white.conversationId);
  await f.engine.memoryChange('forget',f.engine.view().phoneMemory.items[0].id);
  f.setResponseTransform((path:string,_body:any,result:any)=>path==='/offline/turns'?{...result,receipts:result.receipts.map((r:any)=>({...r,memoryPolicy:undefined}))}:result);
  await f.engine.sync();
  await assert.rejects(f.engine.sync(),{code:'OFFLINE_RECEIPT_REQUIRED'});
  assert.equal(f.engine.view().turns.length,1);
  f.setResponseTransform((_p:any,_b:any,result:any)=>result);
  for(let i=0;i<4&&f.engine.view().turns.length;i++)await f.engine.sync();
  assert.equal(f.engine.view().turns.length,0,'a full authenticated policy receipt can finish the retried source');
  assert.equal(f.engine.view().phoneMemory.transferred,true);
  for(let i=0;i<5;i++)await f.ctx.historyImport.tick();
  assert.equal(f.boundaries.length,0,'replay never forms the blocked source');
});


test('HANDOVER-POLICY cannot replay a blocked phone source through later legacy replica registration', async t => {
  const f=await createPhoneHandoverFixture(t);
  const tea=await f.engine.send('请记住，我喜欢白茶。');await f.engine.extractMemory(tea.conversationId);await f.engine.memoryChange('forget',f.engine.view().phoneMemory.items[0].id);await f.engine.sync();
  for(let i=0;i<5;i++)await f.ctx.historyImport.tick();assert.equal(f.boundaries.length,0);
  const packet=structuredClone(f.requests.find((r:any)=>r.path==='/offline/turns').body),sync=structuredClone(f.requests.find((r:any)=>r.path==='/offline/sync').body);
  f.ctx.backend.listModels=async()=>[{id:'cloud',sourceKind:'cloud',configured:true}];
  f.ctx.accountModelManager={readOfflineModel:async()=>({baseUrl:'https://synthetic.invalid/v1',modelId:'synthetic',apiKey:'synthetic-only'})};
  delete sync.phoneFirst;await f.call('/offline/sync',sync);
  let ingested=0;f.ctx.memoryManager.ingest=async()=>{ingested++;return{state:'accepted'}};
  const source=structuredClone(packet.turns[0]);delete source.memoryPolicy;
  await assert.rejects(f.call('/offline/turns',{generation:packet.generation,turns:[source]}));
  assert.equal(ingested,0,'an established blocked phone source must be checked before legacy Core ingest too');
  // Reusing an id with the same blocked policy must not bypass qualification either.
  await assert.rejects(f.call('/offline/turns',{generation:packet.generation,turns:[packet.turns[0]]}));
  assert.equal(ingested,0);
});
