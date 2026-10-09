import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='@deepseek-ai/dsh-llm')return {url:'data:text/javascript,export const createUserMessage = value => value',shortCircuit:true};return next(specifier,context)}});
const {nativeSessionLifecycle}=await import('../src/runtime/dsh-adapter/session-lifecycle.mjs');hooks.deregister();
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('concurrent cold resumes share a native handle and model reads finish before forgetting disposes it',async()=>{
  let agent,starts=0,release;const calls=[];
  const started=new Promise(resolve=>release=resolve);
  const persistence={config:{root:'C:/synthetic'},inspect:async()=>({meta:{id:'session',agentPreset:'personal-remote'}}),readRaw:async()=>({meta:{id:'session'},content:'{"kind":"header"}\n'})};
  const ctx={get(name){return {sessionPersistence:persistence,agents:{get:()=>agent},sessions:{get:()=>undefined},
    agentPresets:{resolve:async()=>({id:'personal-remote'})},storageDomain:{get:()=>({table:()=>({delete:async()=>calls.push('cache-delete')})})}}[name]},
    agents:{resume:async()=>{starts++;await started;agent={session:{id:'session'},status:'idle',inbox:{hasPending:false}};return {agent,dispose:async()=>{calls.push('dispose');agent=undefined}}}},
    sessions:{flush:async()=>calls.push('flush')}};
  const lifecycle=nativeSessionLifecycle(ctx),one=lifecycle.resume('session'),two=lifecycle.resume('session');
  await tick();assert.equal(starts,1);release();await Promise.all([one,two]);assert.equal(starts,1);
  let finish;const model=lifecycle.use('session',()=>new Promise(resolve=>{finish=()=>{calls.push('model-read');resolve()}}));
  await tick();const forgetting=lifecycle.cleanupMemory('session');await tick();assert.deepEqual(calls,[]);
  finish();await Promise.all([model,forgetting]);assert.deepEqual(calls,['model-read','flush','dispose','cache-delete']);
});
