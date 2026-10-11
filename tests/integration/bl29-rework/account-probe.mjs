import { outputPath } from './evidence.mjs';
import {startTimelineCandidate} from './fixture.mjs';
import {rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});
const c=f.debug.service.__reviewContext,owner=f.debug.auth.account.ownerId;
const report={};
const stats=a=>{a.sort((x,y)=>x-y);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1),n:a.length};};
try {
 const main=(await f.request('/chats/main')).chat;
 await f.request('/settings/personalization',{nextSuggestionsEnabled:true},'PATCH');
 report.base=await c.accountChanges(owner);
 const acct=c.accountState(owner),prior=acct.personalization;
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 report.guess={matches:hash(prior)===report.base.personalization,modelSettingsMatches:hash([acct.defaultModelProfileId,acct.backgroundModelProfileId])===report.base.modelSettings};
 acct.personalization=Object.fromEntries(Object.entries(prior).reverse());
 report.keyOrderOnly={before:report.base.personalization,after:(await c.accountChanges(owner)).personalization};acct.personalization=prior;
 const before=await c.accountChanges(owner);acct.sessions[f.sessionId].reviewUnrelated='synthetic';
 report.unrelatedFieldChangesSessions=(await c.accountChanges(owner)).sessions!==before.sessions;delete acct.sessions[f.sessionId].reviewUnrelated;
 report.cost=[];
 const seed=structuredClone(acct.sessions[f.sessionId]);
 for(const count of [500,2000]) {
  await c.serial(()=>c.mutate(owner,next=>{for(let i=0;i<count-1;i++)next.sessions['session-review-'+i]={...seed,title:'Synthetic session '+i};}));
  await c.accountChanges(owner);const samples=[];const cpu=process.cpuUsage();
  for(let i=0;i<250;i++){const at=performance.now();await c.accountChanges(owner);samples.push(performance.now()-at);}
  report.cost.push({count,actual:Object.keys(c.accountState(owner).sessions).length,bytes:Buffer.byteLength(JSON.stringify([c.accountState(owner).sessions,c.accountState(owner).chatIdentity,c.accountState(owner).projects])),...stats(samples),cpuMs:process.cpuUsage(cpu).user/1000});
 }
 const models=f.debug.backend.listModels;
 await c.serial(()=>c.mutate(owner,next=>{next.personalization.nextSuggestionsEnabled=!next.personalization.nextSuggestionsEnabled;}));
 f.debug.backend.listModels=async()=>{throw Object.assign(Error('SYNTHETIC_MODEL_CATALOG_FAILURE'),{code:'BACKEND_UNAVAILABLE',status:503});};
 let r=await fetch(f.origin+`/personal/v1/chats/${main.chatId}/events?limit=1`,{headers:{cookie:f.debug.cookie}});report.catalogFailure={status:r.status,body:await r.json()};
 f.debug.backend.listModels=models;
 let release,entered=false;const gate=new Promise(r=>release=r);
 await c.serial(()=>c.mutate(owner,next=>{next.personalization.nextSuggestionsEnabled=!next.personalization.nextSuggestionsEnabled;}));
 f.debug.backend.listModels=async()=>{const value=await models();entered=true;await gate;return value;};
 const pending=c.accountChanges(owner);while(!entered)await new Promise(r=>setTimeout(r,1));const oldRevision=c.accountRevision;
 await c.serial(()=>c.mutate(owner,next=>{next.personalization.nextSuggestionsEnabled=!next.personalization.nextSuggestionsEnabled;}));
 f.debug.backend.listModels=async()=>[...await models(),{id:'review-new',name:'Synthetic new',model:'synthetic',configured:true}];
 release();const stale=await pending,fresh=await c.accountChanges(owner);
 report.mixedRevision={oldRevision,staleRevision:stale.revision,currentRevision:fresh.revision,staleModels:stale.models,currentModels:fresh.models};
}finally{await f.close();rmSync(f.root,{recursive:true,force:true});writeFileSync(outputPath('account-probe.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
