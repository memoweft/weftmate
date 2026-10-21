import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import '../src/ui-core/phone-memory.js';
import '../src/ui-core/offline.js';
const W = (globalThis as any).WeftOffline;

test('MODE-1 decline after encrypted-vault reopen updates displayed history and queued or already synced work',async t=>{
  for(const synced of [false,true])await t.test(synced?'already synced':'pending sync',async()=>{
    const db=new IDBFactory(),scope='decline-reopen';
    let vault=await W.browserVault(scope,{indexedDB:db,crypto:webcrypto});
    vault.complete=async()=>({choices:[{message:{content:'',tool_calls:[{function:{name:'computer_work',arguments:JSON.stringify({description:'合成电脑工作'})}}]}}]});
    const options={identity:{},crypto:webcrypto,workRequests:true,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),host:()=>assert.fail('decline never executes a computer operation')};
    let engine=await W.create({...options,vault});const sent=await engine.send('合成请求');engine.close();
    vault=await W.browserVault(scope,{indexedDB:db,crypto:webcrypto});
    if(synced){const saved=await vault.load();saved.turns=[];saved.conversations[0].turns[0].synced=true;await vault.save(saved);}
    engine=await W.create({...options,vault});const turnId=engine.view().conversations[0].turns[0].id;
    await engine.declineWork(turnId);
    const shown=engine.view().conversations[0].turns[0];assert.equal(shown.workRequest.status,'declined');
    assert.match(shown.messages.at(-1).text,/需要进入工作/);assert.equal(shown.conversationId,sent.conversationId);
    assert.equal(engine.view().turns.length,synced?0:1);
    if(!synced)assert.deepEqual(engine.view().turns[0].messages,shown.messages);
    await engine.declineWork(turnId);assert.equal(shown.messages.filter((m:any)=>m.text.includes('需要进入工作')).length,1);
    engine.close();vault=await W.browserVault(scope,{indexedDB:db,crypto:webcrypto});engine=await W.create({...options,vault});
    assert.equal(engine.view().conversations[0].turns[0].workRequest.status,'declined');engine.close();
  });
});

test('MODE-1 phone work is a real tool call that persists a card and never executes or queues a computer operation', async () => {
  let saved: any = { snapshot: null, turns: [], conversations: [], tasks: [] }, requests = 0;
  const engine = await W.create({ workRequests: true, crypto: webcrypto, identity: {}, phoneModel: () => ({ modelId: 'synthetic' }),
    accountCheck: async () => ({}), host: () => assert.fail('no computer operation'),
    vault: { load: async () => saved, save: async (value: any) => { saved = value; }, close() {},
      complete: async (body: any) => { requests++; assert.equal(body.tools[0].function.name, 'computer_work');
        return { choices: [{ message: { content: '', tool_calls: [{ function: { name: 'computer_work', arguments: JSON.stringify({ description: '合成文件工作' }) } }] } }] }; } } });
  const first = await engine.send('合成请求'); assert.equal(first.workRequest.status, 'pending'); assert.equal(engine.view().tasks.length, 0);
  const turn = engine.view().turns[0]; await engine.declineWork(turn.id); assert.equal(turn.workRequest.status, 'declined');
  assert.match(turn.messages.at(-1).text, /需要进入工作/);
  await engine.send('下一条合成请求', first.conversationId); assert.equal(requests, 2); assert.equal(engine.view().turns.at(-1).workRequest.status, 'pending');
  engine.close();
});

test('MOB-4 starts without a computer or replica, streams, stops, regenerates, and persists encrypted account conversations', async () => {
  const db = new IDBFactory(); let model: any = null, requests = 0, authorized = true;
  const vault = await W.browserVault('phone:synthetic-a', { indexedDB: db, crypto: webcrypto });
  vault.complete = async (body: any, _snapshot: any, signal: any, progress: any) => {
    requests++; assert.equal(body.tools, undefined); assert.match(body.messages[0].content, /不能(?:读写电脑文件|操作电脑)/);
    progress('正在'); progress('完整回复'); return { choices: [{ message: { content: '完整回复' } }] };
  };
  const options = { vault, identity: {}, host: () => assert.fail('no computer request'), crypto: webcrypto,
    phoneModel: () => model, accountCheck: async () => { if (!authorized) throw Error('CLOUD_TOKEN_INVALID'); } };
  const engine = await W.create(options);
  assert.equal(engine.view().ready, false);
  await assert.rejects(engine.send('第一句话'), /MODEL_NOT_CONFIGURED/); assert.equal(requests, 0);
  model = { modelId: 'synthetic', baseUrl: 'https://model.example/v1' };
  const result = await engine.send('第一句话'); assert.equal(engine.view().turns.length, 1);
  assert.equal(engine.view().conversations[0].turns[0].messages.length, 2);
  await engine.regenerate(result.conversationId); assert.equal(requests, 2); assert.equal(engine.view().turns.length, 1);
  engine.close();
  const reopenedVault = await W.browserVault('phone:synthetic-a', { indexedDB: db, crypto: webcrypto });
  assert.equal((await reopenedVault.load()).conversations[0].turns[0].messages[1].text, '完整回复');
  const other = await W.browserVault('phone:synthetic-b', { indexedDB: db, crypto: webcrypto });
  assert.equal((await other.load()).conversations.length, 0);
  await reopenedVault.clear(); assert.equal((await reopenedVault.load()).turns.length, 0);
  reopenedVault.close(); other.close();
});

test('MOB-4 first computer sync preserves original phone IDs and uploads after applying its generation', async () => {
  let stored: any = { snapshot: null, turns: [], conversations: [] }, submitted: any, generation = 7;
  const vault = { load: async () => stored, save: async (v: any) => { stored = v; }, key: async () => ({}),
    open: async (v: any) => v, clear: async () => {}, close() {}, complete: async () => ({ choices: [{ message: { content: '手机回复' } }] }) };
  const engine = await W.create({ vault, identity: {}, crypto: webcrypto, phoneModel: () => ({ modelId: 'synthetic' }),
    accountCheck: async () => ({}), control: async () => ({}), host: async (path: string, body: any) => {
      if (path === '/offline/sync') return { generation, reset: true, remove: [], items: [], hashes: {}, model: { modelId: 'synthetic' },memoryAuthority:{ready:true,sourcePolicy:1} };
      submitted = structuredClone(body); return { receipts: body.turns.map((t: any) => ({ id: t.id,state:'synced',memoryPolicy:t.memoryPolicy })) };
    } });
  await engine.send('请记住我的新偏好'); const id = stored.turns[0].id;
  await engine.sync(); assert.equal(submitted.generation, generation); assert.equal(submitted.turns[0].id, id);assert.equal(submitted.turns[0].memoryPolicy.inference,'allowed');
  assert.equal(stored.turns.length, 0); assert.equal(stored.conversations[0].turns[0].synced, true);
});

test('MOB-4 browser streaming rejects truncated responses', async () => {
  const response = new Response('data: {"choices":[{"delta":{"content":"一半"}}]}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  await assert.rejects(W.readCompletion(response), /MODEL_STREAM_INCOMPLETE/);
  const valid = new Response('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  assert.equal((await W.readCompletion(valid)).choices[0].message.content, '你好');
});

test('MOB-4 stopping preserves partial text; changing account cancels and removes pending text', async () => {
  let stored:any={snapshot:null,turns:[],conversations:[]}, started:()=>void;
  const gate=new Promise<void>(done=>started=done);
  const vault={load:async()=>stored,save:async(v:any)=>{stored=v},clear:async()=>{stored={snapshot:null,turns:[],conversations:[]}},close(){},
    complete:async(_body:any,_snapshot:any,signal:any,progress:any)=>{progress('保留这段已生成的文字');started();return new Promise((_done,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('stopped'),{name:'AbortError'})),{once:true}))}};
  const engine=await W.create({vault,crypto:webcrypto,identity:{},phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({})});
  const send=engine.send('第一条');await gate;engine.stop();await assert.rejects(send,/stopped/);
  assert.equal(stored.conversations[0].turns[0].messages[1].text,'保留这段已生成的文字');
  await engine.clear();assert.equal(stored.conversations.length,0);assert.equal(stored.turns.length,0);
});

test('phone model switch during account authorization applies only to the next submitted turn', async () => {
  let selected = { modelId: 'first-chat', serviceId: 'first-service', baseUrl: 'https://first.example/v1' };
  let authorize: () => void, checked: () => void, checks = 0, stored: any = { snapshot: null, turns: [], conversations: [] };
  const entered = new Promise<void>(resolve => { checked = resolve; });
  const gate = new Promise<void>(resolve => { authorize = resolve; });
  const used: string[] = [];
  const vault = { load: async () => stored, save: async (value: any) => { stored = value; }, clear: async () => {}, close() {},
    complete: async (body: any, snapshot: any) => {
      assert.equal(snapshot.model.modelId, body.model); used.push(body.model);
      return { choices: [{ message: { content: '已完成' } }] };
    } };
  const engine = await W.create({ vault, crypto: webcrypto, identity: {}, phoneModel: () => selected,
    accountCheck: async () => { if (++checks === 1) { checked(); await gate; } return {}; } });
  const first = engine.send('已经提交的第一条'); await entered;
  selected = { modelId: 'second-chat', serviceId: 'second-service', baseUrl: 'https://second.example/v1' };
  authorize(); const result = await first;
  await engine.send('下一条', result.conversationId);
  assert.deepEqual(used, ['first-chat', 'second-chat']); engine.close();
});
