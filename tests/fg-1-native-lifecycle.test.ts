import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='@deepseek-ai/dsh-llm')return {url:'data:text/javascript,export const createUserMessage = value => value',shortCircuit:true};return next(specifier,context)}});
const {nativeSessionLifecycle}=await import('../src/runtime/dsh-adapter/session-lifecycle.mjs');hooks.deregister();
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('deletion removes disposed native subagent logs recursively while retaining independent forks',async()=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-mem2-children-'));
  const headers=[{id:'parent',origin:'user'},{id:'child',origin:'subagent',parentSession:'parent'},
    {id:'nested',origin:'subagent',parentSession:'child'},{id:'fork',origin:'user',parentSession:'parent'}];
  const deleted=[];
  try {
    for(const header of headers){await mkdir(join(root,header.id));await writeFile(join(root,header.id,'events'),'synthetic');}
    const persistence={config:{root},inspect:async()=>({meta:headers[0]}),locate:header=>({kind:'jsonl',path:join(root,header.id,'events')}),
      listSnapshots:async()=>headers.map(header=>({header}))};
    const ctx={get:name=>({sessionPersistence:persistence,sessions:{get:()=>null},agents:{get:()=>null},
      storageDomain:{get:()=>({table:()=>({delete:async id=>deleted.push(id)})})}}[name])};
    assert.equal((await nativeSessionLifecycle(ctx).remove('parent')).deleted,true);
    for(const id of ['parent','child','nested'])await assert.rejects(stat(join(root,id)),{code:'ENOENT'});
    assert.ok(await stat(join(root,'fork')));assert.deepEqual(deleted,['nested','child','parent']);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('concurrent cold resumes share a native handle and model reads finish before forgetting disposes it',async()=>{
  let agent,starts=0,release;const calls=[];
  const started=new Promise(resolve=>release=resolve);
  const persistence={config:{root:'C:/synthetic'},inspect:async()=>({meta:{id:'session',agentPreset:'personal-remote'}}),readRaw:async()=>({meta:{id:'session'},content:'{"kind":"header"}\n'})};
  const ctx={get(name){return {sessionPersistence:persistence,agents:{get:()=>agent},sessions:{get:()=>undefined},
    agentPresets:{resolve:async()=>({id:'personal-remote'})},storageDomain:{get:()=>({table:()=>({delete:async()=>calls.push('cache-delete')})})}}[name]},
    agents:{resume:async()=>{starts++;await started;agent={session:{id:'session',events:[],surface:{nodes:[]}},status:'idle',inbox:{hasPending:false}};return {agent,dispose:async()=>{calls.push('dispose');agent=undefined}}}},
    sessions:{flush:async()=>calls.push('flush')}};
  const lifecycle=nativeSessionLifecycle(ctx),one=lifecycle.resume('session'),two=lifecycle.resume('session');
  await tick();assert.equal(starts,1);release();await Promise.all([one,two]);assert.equal(starts,1);
  let finish;const model=lifecycle.use('session',()=>new Promise(resolve=>{finish=()=>{calls.push('model-read');resolve()}}));
  await tick();const forgetting=lifecycle.cleanupMemory('session');await tick();assert.deepEqual(calls,[]);
  finish();await Promise.all([model,forgetting]);assert.deepEqual(calls,['model-read','flush','dispose','cache-delete']);
});
