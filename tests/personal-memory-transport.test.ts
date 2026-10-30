import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoWeftRpc} from '../src/personal-memory/rpc.mjs';

test('an asynchronous worker stdin pipe error rejects pending RPC instead of escaping as an uncaught exception',async()=>{
  const rpc=new MemoWeftRpc({python:process.execPath,pythonPath:process.cwd(),pythonArgs:['-e','process.stdin.resume()'],requestTimeoutMs:1000});
  try{
    const pending=rpc.request('initialize');pending.catch(()=>{});
    // Node reports write failures on the stream, not as a synchronous write throw.
    // Inject the same EPIPE event observed in the real disconnect/retry fixture.
    assert.doesNotThrow(()=>rpc.child.stdin.emit('error',Object.assign(new Error('write EPIPE'),{code:'EPIPE'})));
    await assert.rejects(pending,{code:'MEMORY_PROCESS_UNAVAILABLE'});
    assert.equal(rpc.pending.size,0);
  }finally{await rpc.close();}
});
