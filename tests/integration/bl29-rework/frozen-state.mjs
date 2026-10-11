import { outputPath } from './evidence.mjs';
import {startTimelineCandidate} from './fixture.mjs';import {rmSync,writeFileSync} from 'node:fs';
const f=await startTimelineCandidate({daily:true,inlineProgress:true,sidebar:true,historyCount:0}),c=f.debug.service.__reviewContext,report=[];
const freeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){for(const v of Object.values(o))freeze(v);Object.freeze(o);}return o;};
const step=async(name,fn)=>{const previousRoot=c.rootState;for(const a of Object.values(c.rootState.accounts))for(const k of ["sessions","chatIdentity","projects","personalization"])freeze(a[k]);const revision=c.accountRevision;await fn();report.push({name,before:revision,after:c.accountRevision,rootReplaced:c.rootState!==previousRoot});};
try{
 await step('read main/list/config',async()=>{await f.request('/chats/main');await f.request('/sessions?limit=100');await f.request('/models');await f.request('/settings/personalization');});
 await step('rename',()=>f.request('/sessions/'+f.sessionId+'/metadata',{title:'Frozen metadata change'},'PATCH'));
 await step('personalization',()=>f.request('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH'));
 await step('model settings',()=>f.request('/settings/models',{backgroundModelProfileId:'local'},'PATCH'));
 await step('device name',()=>f.request('/auth/devices/'+f.debug.auth.device.id,{name:'synthetic renamed'},'PATCH'));
 await step('new session',async()=>{const cmd=await f.request('/commands',{requestId:'frozen-create',kind:'session.create',modelProfileId:'local',targetDeviceId:(await f.request('/status')).hostId});for(let i=0;i<100;i++){const r=await f.request('/commands/'+cmd.command.commandId);if(r.command.state==='accepted_by_dsh')return;await new Promise(r=>setTimeout(r,5));}throw Error('create did not complete');});
 await step('close',()=>f.debug.service.close());
}finally{await f.close();rmSync(f.root,{recursive:true,force:true});writeFileSync(outputPath('frozen-state.json'),JSON.stringify(report,null,2));}console.log(report);
