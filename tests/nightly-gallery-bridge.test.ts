import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryBridge } from '../scripts/nightly/gallery-bridge.mjs';

test('Android suggestion fixture advertises the same capability on every status poll that its bridge implements', async () => {
  const calls:unknown[]=[];
  const status={hostAvailable:true,personalCapabilities:{chats:0,nextSuggestions:0,projects:1}};
  const fixture={mobileBridge:async (payload:unknown)=>{calls.push(payload);return status;}};
  const suggestions=['继续整理','保存成文件'];
  const bridge=galleryBridge(fixture,'dark',{suggestions});
  for(const payload of [{method:'host.status'},{method:'host.business',params:{path:'/personal/v1/status'}}]) {
    const result=await bridge(payload);
    assert.equal(result.personalCapabilities.nextSuggestions,1);
    assert.equal(result.personalCapabilities.chats,0); assert.equal(result.hostAvailable,true);
  }
  assert.equal(status.personalCapabilities.nextSuggestions,0,'fixture backend is not mutated');
  assert.deepEqual(await bridge({method:'host.business',params:{path:'/personal/v1/sessions/synthetic/suggestions',body:{requestId:'synthetic-request',kind:'completion'}}}),
    {requestId:'synthetic-request',suggestions,completion:'保存成文件',available:true});
  assert.equal(calls.length,2,'generation is synthetic and never reaches the model backend');
  assert.deepEqual(await bridge({method:'settings.appearance'}),{value:'dark'});
  assert.equal(await galleryBridge(fixture,'light')({method:'host.status'}),status,'ordinary scene capabilities remain truthful');
});
