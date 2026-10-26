import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import '../src/ui-core/offline.js';

const W = (globalThis as any).WeftOffline;
const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), 'queue transition completed');
};
async function fixture(initial?: any, options:any = {}) {
  let saved = initial || { snapshot: null, turns: [], conversations: [] };
  const calls: any[] = [], releases: (() => void)[] = [];
  const engine = await W.create({
    identity: {}, crypto: webcrypto, accountCheck: options.accountCheck || (async () => {}), phoneModel: options.phoneModel || (() => ({ modelId: 'test-model' })),
    vault: { load: async () => structuredClone(saved), save: async (value: any) => { saved = structuredClone(value); }, close() {},
      complete: async (body: any, _snapshot: any, signal: AbortSignal, progress: any) => {
        const text = body.messages.at(-1).content; calls.push(body); progress(`partial:${text}`);
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) return reject(new DOMException('Stopped', 'AbortError'));
          signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
          releases.push(resolve);
        });
        return options.response ? options.response(text) : { choices: [{ message: { content: `answer:${text}` } }] };
      } },
  });
  return { engine, calls, releases, saved: () => saved };
}

test('phone accepts three inputs immediately, persists queued messages, and replies in order in one conversation', async () => {
  const f = await fixture();
  const first = await f.engine.enqueue('one'); await until(() => f.calls.length === 1);
  await f.engine.enqueue('two', first.conversationId);
  await f.engine.enqueue('three', first.conversationId);
  assert.deepEqual(f.saved().pendingMessages.map((m: any) => m.text), ['two', 'three']);
  assert.equal(f.calls.length, 1);
  f.releases.shift()!(); await until(() => f.calls.length === 2);
  assert.deepEqual(f.calls[1].messages.slice(-3).map((m: any) => m.content), ['one', 'answer:one', 'two']);
  f.releases.shift()!(); await until(() => f.calls.length === 3);
  f.releases.shift()!(); await until(() => !f.engine.view().running);
  const conversations = f.engine.view().conversations;
  assert.equal(conversations.length, 1);
  assert.deepEqual(conversations[0].turns.flatMap((t: any) => t.messages.map((m: any) => m.text)),
    ['one', 'answer:one', 'two', 'answer:two', 'three', 'answer:three']);
  assert.equal(f.saved().pendingMessages.length, 0); f.engine.close();
});

for (const failure of ['transport','validation']) test(`generation ${failure} failure pauses the queue and keeps all later inputs in order`,async()=>{
  const f=await fixture(undefined,{response:()=>{
    if(failure==='transport')throw Object.assign(new Error('NETWORK'),{code:'NETWORK'});
    return {choices:[{message:{content:''}}]};
  }});
  try {
    const first=await f.engine.enqueue('one');await until(()=>f.calls.length===1);
    await f.engine.enqueue('two',first.conversationId);await f.engine.enqueue('three',first.conversationId);
    f.releases.shift()!();await until(()=>!!f.engine.view().queueError);
    assert.equal(f.calls.length,1,'later messages must not reach the failed transport');
    assert.deepEqual(f.engine.view().pendingMessages.map((m:any)=>m.text),['two','three']);
    assert.deepEqual(f.saved().pendingMessages.map((m:any)=>m.text),['two','three']);
    assert.equal(f.engine.view().conversations[0].turns.length,1);
    assert.equal(f.engine.view().conversations[0].turns[0].messages[1].text,'partial:one');
    await f.engine.enqueue('four',first.conversationId);
    assert.equal(f.calls.length,1,'a new input must not implicitly restart a failed queue');
    assert.deepEqual(f.engine.view().pendingMessages.map((m:any)=>m.text),['two','three','four']);
  } finally { f.engine.close(); }
});

test('adding an input to a paused failed reply keeps it pending and explains the visible retry action',async()=>{
  const f=await fixture(undefined,{response:()=>{throw Error('NETWORK');}});
  try {
    const first=await f.engine.enqueue('one');await until(()=>f.calls.length===1);
    f.releases.shift()!();await until(()=>!!f.engine.view().queueError&&!f.engine.view().running);
    assert.equal(f.engine.view().queueRetryAvailable,false);
    await f.engine.enqueue('two',first.conversationId);
    assert.equal(f.calls.length,1);assert.equal(f.engine.view().queueRetryAvailable,true);
    assert.match(f.engine.view().queueError,/重试排队消息/);
  }finally{f.engine.close();}
});

for (const failure of ['account','model']) test(`explicit retry recovers a preserved ${failure} preflight failure without another input`,async()=>{
  let broken=true;
  const value={snapshot:null,turns:[],conversations:[{id:'preserved-chat',turns:[]}],pendingMessages:['one','two'].map((text,i)=>({id:`pending-${i}`,conversationId:'preserved-chat',text,timestamp:i}))};
  const f=await fixture(value,{
    accountCheck:async()=>{if(failure==='account'&&broken)throw Error('NETWORK');},
    phoneModel:()=>failure==='model'&&broken?null:{modelId:'test-model'},
  });
  try {
    f.engine.resumeQueue();await until(()=>!!f.engine.view().queueError&&!f.engine.view().running);
    assert.deepEqual(f.engine.view().pendingMessages.map((m:any)=>m.text),['one','two']);
    assert.equal(f.engine.view().queueRetryAvailable,true);
    broken=false;f.engine.retryQueue();f.engine.retryQueue();await until(()=>f.calls.length===1);
    assert.equal(f.calls[0].messages.at(-1).content,'one');
    assert.equal(f.engine.view().queueRetryAvailable,false);
    f.releases.shift()!();await until(()=>f.calls.length===2);
    assert.equal(f.calls[1].messages.at(-1).content,'two');
    f.releases.shift()!();await until(()=>!f.engine.view().running);
    assert.equal(f.engine.view().pendingMessages.length,0);
  } finally { f.engine.close(); }
});

test('stop cancels the active transport immediately and continues the queued input without losing partial text', async () => {
  const f = await fixture(); const first = await f.engine.enqueue('one'); await until(() => f.calls.length === 1);
  await f.engine.enqueue('two', first.conversationId); f.engine.stop();
  await until(() => f.calls.length === 2);
  assert.equal(f.engine.view().conversations[0].turns[0].messages[1].text, 'partial:one');
  f.releases.at(-1)!(); await until(() => !f.engine.view().running); f.engine.close();
});

test('encrypted vault payload restores pending messages to their original conversation after restart', async () => {
  const first = await fixture(); const receipt = await first.engine.enqueue('one'); await until(() => first.calls.length === 1);
  await first.engine.enqueue('two', receipt.conversationId); first.engine.close();
  const second = await fixture(first.saved()); second.engine.resumeQueue();
  await until(() => second.calls.length === 1);
  second.releases.shift()!(); await until(() => !second.engine.view().running);
  assert.equal(second.engine.view().conversations[0].id, receipt.conversationId);
  assert.equal(second.engine.view().conversations[0].turns.at(-1).messages[0].text, 'two'); second.engine.close();
});

test('steer interrupts the active phone response and handles the follow-up before queued messages', async () => {
  const f = await fixture(); const first = await f.engine.enqueue('one'); await until(() => f.calls.length === 1);
  await f.engine.enqueue('later', first.conversationId);
  await f.engine.enqueue('adjust', first.conversationId, 'steer'); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].messages.at(-1).content, 'adjust');
  f.releases.at(-1)!(); await until(() => f.calls.length === 3);
  assert.equal(f.calls[2].messages.at(-1).content, 'later');
  f.releases.at(-1)!(); await until(() => !f.engine.view().running); f.engine.close();
});

test('native phone presentation reads the current account message preference before enqueueing', async () => {
  const info = { origin:'https://synthetic.example', accountId:'account-a' };
  let preferenceOwner='previous-account', submitted:any;
  const state:any = {booted:true, loggedIn:true, owner:'account-a', connection:'phone', model:{modelId:'synthetic',endpoint:'https://model.example/v1'}};
  const engine={view:()=>({running:true,conversations:[],pendingMessages:[]}),enqueue:async(text:string,id:string,intent:string)=>{submitted={text,id,intent};return{conversationId:'original-chat'};}};
  const context:any={window:{weftNative:true},state,document:{addEventListener(){}},addEventListener(){},clearTimeout,
    androidBridge:{call:async()=>info},WeftOffline:{create:async()=>engine},
    uiCore:{syncMobileIdentity:()=>{preferenceOwner=state.owner;},messageModePreference:()=>preferenceOwner==='account-a'?'steer':'queue'}};
  runInNewContext(readFileSync(new URL('../apps/mobile-ui/www/components/phone-standalone.js',import.meta.url),'utf8'),context);
  await context.WeftPhone.restoreArchive(info,{});
  const receipt=await context.WeftPhone.presentation('send',{text:'补充当前回复',conversationId:'original-chat'});
  assert.equal(submitted.intent,'steer');assert.equal(receipt.selectedId,'original-chat');
});
