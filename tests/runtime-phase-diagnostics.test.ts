import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimePhaseDiagnostics } from './helpers/runtime-phase-diagnostics.mjs';

test('runtime test diagnostics capture the actual failing stage and fixed process result without payloads', () => {
  const records: any[] = []; let clock=100;
  const diagnostic=createRuntimePhaseDiagnostics({publish:(record: any)=>records.push(record),now:()=>clock});
  diagnostic.phase('runtime-start','start'); clock=125;
  const original=Object.assign(Error('synthetic-private-message'),{code:'ECONNRESET',path:'synthetic-private-path'});
  assert.throws(()=>{try{throw original;}catch(error){diagnostic.phase('runtime-start','failed',error);throw error;}},error=>error===original);
  diagnostic.processEvent({reason:'startup-failed',action:'startup-abandoned',exitCode:-1073740791,signal:null,stderr:'synthetic-private-stderr'});
  assert.equal(records.length,3);
  assert.deepEqual(records[1],{version:1,kind:'phase',phase:'runtime-start',state:'failed',elapsedMs:25,errorCode:'ECONNRESET'});
  assert.equal(records[2].reason,'startup-failed');assert.equal(records[2].action,'startup-abandoned');
  assert.equal(records[2].exitCode,-1073740791);assert.equal(records[2].exitUnsigned,3221226505);assert.equal(records[2].exitHex,'0xC0000409');
  assert.equal(records[2].signal,null);assert.equal(records[2].elapsedMs,25);
  assert.equal(records.every(record=>Object.isFrozen(record)),true);
  assert.equal(JSON.stringify(records).includes('synthetic-private'),false);
});

test('runtime test diagnostic publishers cannot replace a result or an original error', async () => {
  for(const publish of [()=>{throw Error('synthetic-private-observer');},()=>Promise.reject(Error('synthetic-private-observer'))]){
    const diagnostic=createRuntimePhaseDiagnostics({publish});
    const result={original:true},original=Error('synthetic-private-original');let calls=0;
    const operation=()=>{calls++;diagnostic.phase('direct-write','complete');return result;};
    assert.equal(operation(),result);assert.equal(calls,1);
    assert.throws(()=>{try{throw original;}catch(error){diagnostic.phase('direct-write','failed',error);throw error;}},error=>error===original);
    assert.doesNotThrow(()=>diagnostic.processEvent({reason:'unexpected-exit',action:'respawn-scheduled',exitCode:1,signal:null}));
  }
  await new Promise(resolve=>setImmediate(resolve));
});

test('runtime test diagnostics reject arbitrary strings and keep a broken diagnostic clock observational',()=>{
  const records:any[]=[],hidden='synthetic-private-value';
  const hostile=new Proxy({},{get(){throw Error(hidden);}});
  const diagnostic=createRuntimePhaseDiagnostics({publish:(record:any)=>records.push(record),now:()=>{throw Error(hidden);}});
  assert.doesNotThrow(()=>diagnostic.phase(hidden,hidden,hostile));
  assert.doesNotThrow(()=>diagnostic.processEvent({reason:hidden,action:hidden,exitCode:Infinity,signal:hidden,stdout:hidden}));
  assert.equal(records.length,2);assert.equal(records[0].phase,'unknown');assert.equal(records[0].state,'unknown');
  assert.equal(records[0].elapsedMs,null);assert.equal(records[0].errorCode,'unknown');
  assert.equal(records[1].reason,'unknown');assert.equal(records[1].action,'unknown');assert.equal(records[1].exitCode,null);assert.equal(records[1].signal,'unknown');
  assert.equal(JSON.stringify(records).includes(hidden),false);
});
