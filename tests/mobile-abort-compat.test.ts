import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { uiCoreAssets } from '../src/ui-core/manifest.mjs';

function legacyCore(fetch) {
  const deadline = new AbortController();
  const context = { URL, Map, Set, Promise, Error, Date, AbortController,
    AbortSignal:{timeout:()=>deadline.signal}, setTimeout, clearTimeout };
  for (const name of uiCoreAssets) runInNewContext(readFileSync(new URL(`../src/ui-core/${name}`, import.meta.url),'utf8'), context);
  return {deadline,core:context.WeftUiCore.create({fetch,storage:{getItem:()=>null}})};
}
test('old Android WebView sends reply reads when AbortSignal.any is unavailable', async () => {
  let requested = false;
  const {core} = legacyCore(async (url, options) => {
    requested = true; assert.equal(url,'/personal/v1/chats/main/changes'); assert.equal(options.signal.aborted,false);
    return {ok:true,json:async()=>({upserts:[{type:'assistant.message',data:{text:'合成回复'}}]})};
  });
  const response = await core.requestJson('/personal/v1/chats/main/changes',{signal:new AbortController().signal});
  assert.equal(requested,true); assert.equal(response.upserts[0].data.text,'合成回复');
});
test('old WebView keeps caller cancellation and deadline failures distinct', async () => {
  for (const cancelled of [true,false]) {
    const caller = new AbortController(); let received;
    const {core,deadline} = legacyCore((_url, options) => new Promise((_resolve,reject) => {
      received=options.signal; received.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
    }));
    const read = core.requestJson('/personal/v1/chats/main/changes',{signal:caller.signal});
    (cancelled?caller:deadline).abort();
    await assert.rejects(read, error=>error.code===(cancelled?'ABORTED':'NETWORK'));
    assert.equal(received.aborted,true);
  }
});
