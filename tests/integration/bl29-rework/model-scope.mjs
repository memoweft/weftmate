import { outputPath } from './evidence.mjs';
import {startTimelineCandidate} from './fixture.mjs';
import {privateProfileId} from '../../../src/personal-account-models/index.mjs';
import {randomUUID} from 'node:crypto';
import {modelRouteFingerprint} from '../../../src/model-route-fingerprint.mjs';
import {rmSync,writeFileSync} from 'node:fs';
const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0}),c=f.debug.service.__reviewContext,owner=f.debug.auth.account.ownerId,report={};
try{
 // This probe measures catalog/account isolation, not periodic activity writes.
 // Drain the real sampler before capturing a revision on slower Windows runners.
 await c.activity.close();
 const other=await c.registerAccount({username:'review-other-'+randomUUID().slice(0,8),password:'Synthetic-password-234567',deviceName:'synthetic-host'});
 const otherOwner=other.account.ownerId;
 const original=f.debug.backend.listModels,hiddenId=privateProfileId(otherOwner,'account-model-'+randomUUID(),1);
 let hidden={id:hiddenId,name:'Other account private model',model:'synthetic',configured:false};
 f.debug.backend.listModels=async()=>[...await original(),hidden];
 const before=await c.accountChanges(owner),otherBefore=await c.accountChanges(otherOwner),visible=(await f.request('/models')).models;
 hidden={...hidden,configured:true};
 await c.serial(()=>c.mutate(otherOwner,next=>{next.account.displayName='Other account updated';next.account.profileRevision++;}));
 const after=await c.accountChanges(owner),visibleAfter=(await f.request('/models')).models;
 report.scope={hiddenVisible:visible.some(m=>m.id===hiddenId),visibleUnchanged:JSON.stringify(visible)===JSON.stringify(visibleAfter),sameDigestAcrossAccounts:before.models===otherBefore.models,ownDigestChangedOnOtherModel:before.models!==after.models,ownRevisionBefore:before.revision,ownRevisionAfter:after.revision};
 const id='account-model-'+randomUUID(),profileId=privateProfileId(owner,id,1),at=new Date().toISOString();
 await c.serial(()=>c.mutate(owner,next=>{next.accountModels??={};next.accountModels[id]={accountModelId:id,ownerId:owner,revision:1,runtimeRevision:1,name:'Visible old name',status:'active',createdAt:at,updatedAt:at,revisions:{'1':{revision:1,profileId,baseUrl:f.origin+'/v1',modelId:'synthetic',routeFingerprint:modelRouteFingerprint('http://synthetic.invalid/v1/chat/completions','synthetic'),createdAt:at}}};}));
 f.debug.backend.listModels=async()=>[...await original(),hidden,{id:profileId,name:'Native name unchanged',model:'synthetic',configured:true}];
 const old=await c.accountChanges(owner),oldList=(await f.request('/models')).models;
 await c.serial(()=>c.mutate(owner,next=>{next.accountModels[id].name='Visible new name';next.accountModels[id].revision++;next.accountModels[id].updatedAt=new Date().toISOString();}));
 const latest=await c.accountChanges(owner),newList=(await f.request('/models')).models;
 report.rename={oldName:oldList.find(m=>m.id===profileId)?.name,newName:newList.find(m=>m.id===profileId)?.name,changedHashes:Object.keys(latest).filter(k=>k!=='revision'&&old[k]!==latest[k]),oldRevision:old.revision,newRevision:latest.revision};
 const account=c.accountState(owner),session=account.sessions[f.sessionId],oldHash=(await c.accountChanges(owner)).sessions;
 account.sessions[f.sessionId]=Object.fromEntries(Object.entries(session).reverse());
 report.keyOrderOnlyChangesSessions=(await c.accountChanges(owner)).sessions!==oldHash;account.sessions[f.sessionId]=session;
}finally{await f.close();rmSync(f.root,{recursive:true,force:true});writeFileSync(outputPath('model-scope.json'),JSON.stringify(report,null,2));}
console.log(report);
