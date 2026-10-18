import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { managedMkdtempSync, managedTempRoot, disposeManagedTemp } from './helpers/managed-temp.mjs';
import { DshWebRuntime } from '../src/dsh-web-runtime.ts';
function fixture(){
 const runtime:any=new DshWebRuntime({homeDir:'synthetic-home',workspaceDir:'synthetic-work'}),calls:string[]=[];
 const snapshot=Object.freeze({entries:Object.freeze([]),digest:'synthetic',nonce:'synthetic'});
 runtime.prepareProfile=async()=>{calls.push('files');};
 runtime.preflightSecureCredentialComposition=async()=>{calls.push('dump');return snapshot;};
 runtime.spawnOnce=async(value)=>{assert.equal(value,snapshot);calls.push('boot');return 'http://127.0.0.1:1';};
 return {runtime,calls,snapshot};
}
test('preparation composes once without booting, and the first start consumes that exact frozen snapshot',async()=>{
 const {runtime,calls}=fixture();
 await Promise.all([runtime.prepare(),runtime.prepare()]);
 assert.deepEqual(calls,['files','dump']);assert.equal(runtime.origin(),null);assert.equal(runtime.isRunning(),false);
 assert.equal(await runtime.start(),'http://127.0.0.1:1');assert.deepEqual(calls,['files','dump','boot']);
 // A later boot cannot reuse the consumed snapshot or bypass composition.
 await runtime.start();assert.deepEqual(calls,['files','dump','boot','files','dump','boot']);
 await runtime.close();
});
test('closing while preparation is pending prevents every subsequent boot',async()=>{
 const {runtime,calls}=fixture();let release;
 runtime.preflightSecureCredentialComposition=()=>new Promise(resolve=>{release=resolve;});
 const preparing=runtime.prepare();
 await new Promise(resolve=>setImmediate(resolve));
 const rejected=assert.rejects(preparing,{message:'DshWebRuntime is closed'});
 await runtime.close();release(undefined);await rejected;
 await assert.rejects(runtime.start(),{message:'DshWebRuntime is closed'});assert.deepEqual(calls,['files']);
});
test('a failed preparation is retained as a rejection without retry, listeners or boot',async()=>{
 const {runtime,calls}=fixture(),failure=Error('synthetic dump failure');
 runtime.preflightSecureCredentialComposition=async()=>{calls.push('dump');throw failure;};
 await assert.rejects(runtime.prepare(),error=>error===failure);
 await assert.rejects(runtime.prepare(),error=>error===failure);
 assert.deepEqual(calls,['files','dump']);assert.equal(runtime.origin(),null);await runtime.close();
});

test('close collects the live dump-config process without booting a runtime',{timeout:10000},async()=>{
 const root=managedMkdtempSync(join(managedTempRoot(),'dsh-prepare-close-'));
 const script=join(root,'dump.cjs');writeFileSync(script,"process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});setInterval(()=>{},1000);");
 const runtime:any=new DshWebRuntime({homeDir:root,workspaceDir:root,credentialRequestHandler:async()=>({})});
 runtime.prepareProfile=async()=>{};
 runtime.launchSpec=()=>({command:process.execPath,nodeArgs:[],bin:script,cwd:root});
 const preparing=runtime.prepare(),rejected=assert.rejects(preparing);
 try{
  // prepareProfile yields once before execFile. Observe its actual registration.
  while(runtime.preflightChildren.size===0)await new Promise(resolve=>setImmediate(resolve));
  const active:any=[...runtime.preflightChildren][0];
  assert.ok(active.pid);assert.equal(runtime.isRunning(),false);
  await runtime.close();await rejected;
  assert.ok(active.exitCode!==null||active.signalCode!==null);assert.equal(runtime.preflightChildren.size,0);
 }finally{await runtime.close();disposeManagedTemp(root,{log:()=>{}});}
});
