import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Writable} from 'node:stream';
const {safeFixtureFailure,reportFixtureFailure}=createRequire(import.meta.url)('./helpers/rob-1-safe-diagnostics.cjs');

test('ROB1 failure metadata accepts only fixed enums and finite safe numbers',()=>{
 const hidden='synthetic-do-not-emit';
 const value=safeFixtureFailure({name:hidden,code:hidden,message:hidden,stack:hidden},{action:hidden,timing:hidden,fixturePhase:hidden,
  readiness:{phase:hidden,outcome:hidden,key:hidden,probe:hidden,stdout:hidden,stderr:hidden,path:hidden,childStatus:Infinity,
   childError:hidden,exceptionCode:hidden,childStdoutBytes:NaN,lastAvailability:hidden,childTimedOut:true},versions:{electron:hidden,node:hidden}});
 assert.equal(JSON.stringify(value).includes(hidden),false);
 assert.equal(value.name,'unknown');assert.equal(value.code,'unknown');assert.equal(value.readiness.phase,'unknown');
 assert.equal(value.readiness.childStatus,null);assert.equal(value.readiness.childStdoutBytes,null);
 assert.equal(value.readiness.lastAvailability,null);assert.equal(value.readiness.childTimedOut,true);
 assert.deepEqual(value.versions,{electron:null,node:null});
});

test('ROB1 diagnostic output failure preserves the original safe failure report',async()=>{
 const error=Object.assign(new Error('synthetic-do-not-emit'),{code:'CREDENTIAL_STORAGE_NOT_READY'});
 const context={action:'readiness-race',timing:'none',fixturePhase:'initialize'};
 const expected=safeFixtureFailure(error,context);
 assert.deepEqual(reportFixtureFailure(error,context,{write(){throw Error('synthetic-output-unavailable');}}),expected);
 const stream=new Writable({write(_chunk,_encoding,done){done(Object.assign(Error(),{code:'EPIPE'}));}});
 assert.deepEqual(reportFixtureFailure(error,context,stream),expected);
 await new Promise(resolve=>setImmediate(resolve));
});
