import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalAccessBackend} from '../src/personal-access-backend.mjs';

function fixture(error:any, disappearAfterCreate=false) {
  let exists=false, created=0;
  const backend=createPersonalAccessBackend({currentOrigin:()=> 'http://synthetic',profiles:()=>[{id:'m',model:'synthetic'}],hasCredential:()=>true,
    routeForProfile:()=>({provider:'p'}),queue:(fn:any)=>fn(),bindSession:()=>{},resolveSession:async()=>({profile:{id:'m',model:'synthetic'}}),
    gateway:async(path:string,init:any)=>{
      if(path==='/models')return {groups:[{id:'p',models:[{id:'synthetic'}]}]};
      if(path==='/sessions'&&init?.method==='POST'){created++;exists=true;return {sessionId:'main'};}
      if(path==='/sessions/main'){if(!exists||disappearAfterCreate)throw error;return {sessionId:'main',agentPreset:'personal-remote'};}
      return {};
    }} as any);
  return {backend,count:()=>created};
}
test('wrapped native missing session allows creation and all single lookups retain missing semantics',async()=>{
  const error=Object.assign(new Error('gateway request failed'),{code:'BACKEND_UNAVAILABLE',status:503,nativeStatus:404,nativeCode:'session-not-found'});
  const f=fixture(error);
  await assert.rejects(f.backend.describeSession('main'),{code:'SESSION_UNAVAILABLE'});
  await assert.rejects(f.backend.describeSessions(['main']),{code:'SESSION_UNAVAILABLE'});
  await assert.rejects(f.backend.preflight({kind:'session.message',sessionId:'main'}),{code:'SESSION_UNAVAILABLE'});
  await f.backend.createSession({sessionId:'main',workspaceChatId:'chat',modelProfileId:'m'});
  assert.equal(f.count(),1);assert.equal((await f.backend.describeSession('main')).sessionId,'main');
  const vanished=fixture(error,true);
  await assert.rejects(vanished.backend.createSession({sessionId:'main',workspaceChatId:'chat',modelProfileId:'m'}),{code:'SESSION_UNAVAILABLE'});
});
test('native server errors and transport failures cannot create a missing-looking main session',async()=>{
  for(const nativeStatus of [404,500,503]){
    const error=Object.assign(new Error('unavailable'),{code:'BACKEND_UNAVAILABLE',nativeStatus,nativeCode:'unknown'}),f=fixture(error);
    for(const invoke of [()=>f.backend.describeSession('main'),()=>f.backend.describeSessions(['main']),()=>f.backend.preflight({kind:'session.message',sessionId:'main'}),()=>f.backend.createSession({sessionId:'main',workspaceChatId:'chat',modelProfileId:'m'})])await assert.rejects(invoke(),e=>e===error);
    assert.equal(f.count(),0);
  }
});
