import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { protectProcessOutput } from '../src/process-output.mjs';
test('broken console streams swallow EPIPE, ERR_STREAM_DESTROYED, EOF and synchronous write failures',()=>{
  const target:any=new EventEmitter();target.stdout=new EventEmitter();target.stderr=new EventEmitter();target.stdout.write=()=>{throw Object.assign(new Error('broken'),{code:'EPIPE'});};target.stderr.write=()=>false;
  protectProcessOutput(target);assert.equal(target.stdout.write('ignored'),false);
  for(const code of ['EPIPE','ERR_STREAM_DESTROYED','EOF'])for(const stream of [target.stdout,target.stderr])assert.doesNotThrow(()=>stream.emit('error',{code}));
});
test('Node warning console listener is replaced and warning logs contain only canonical name and code',()=>{
  const target:any=new EventEmitter();target.stdout=target.stderr=null;let consoleCalls=0;
  target.on('warning',function onWarning(){consoleCalls++;});const log:any[]=[];const sink=protectProcessOutput(target);
  target.emit('warning',{name:'DeprecationWarning',code:'DEP_TEST',message:'private path',stack:'private stack'});sink((event:any,data:any)=>log.push({event,data}));
  assert.equal(consoleCalls,0);assert.deepEqual(log,[{event:'process.warning',data:{name:'DeprecationWarning',code:'DEP_TEST'}}]);
  target.emit('warning',{name:'C:\\private',code:'C:\\private'});assert.deepEqual(log.at(-1).data,{name:'unknown',code:'unknown'});
});
test('main and copied update monitor install output protection before application imports',()=>{
  for(const file of ['src/main.mjs','src/personal-update/app-watchdog.mjs'])assert.match(readFileSync(file,'utf8').split('\n').find(line=>line.startsWith('import ')),/process-output/);
  assert.match(readFileSync('src/personal-update/app-rollback.mjs','utf8'),/join\(snapshot, 'process-output.mjs'\)/);
});
