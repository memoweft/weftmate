import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createGatewayV1 } from '../src/runtime/gateway/routes/v1.mjs';
const ok=value=>({result:{ok:true,value}});
test('model reads and writes claim the cold personal disposer before native agentFor runs',async()=>{
  let owned=false;const calls=[];
  const client={sessions:{history:async()=>ok({events:[]}),list:async()=>ok({items:[{sessionId:'session-cold',agentPreset:'personal-remote'}]}),
    models:async()=>{assert.equal(owned,true);calls.push('models');return ok({current:{provider:'test',model:'test'}})},
    selectModel:async()=>{assert.equal(owned,true);calls.push('select');return ok({selected:{provider:'test',model:'test'}})}},
    events:{},workspace:{},llm:{},settings:{}};
  const lifecycle={resume:async id=>{assert.equal(id,'session-cold');owned=true;calls.push('resume')}};
  const gateway=createGatewayV1({client,lifecycle});
  const server=createServer((req,res)=>gateway.handle(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const url=`http://127.0.0.1:${server.address().port}/weftmate/api/v1/sessions/session-cold/models`;
    assert.equal((await fetch(url)).status,200);assert.deepEqual(calls,['resume','models']);
    await fetch(url.replace('/models','/resume'),{method:'POST'});calls.length=0;owned=false;
    assert.equal((await fetch(url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'test',model:'test'})})).status,200);
    assert.deepEqual(calls,['resume','select']);
  }finally{gateway.close();server.close();server.closeAllConnections();await once(server,'close')}
});
