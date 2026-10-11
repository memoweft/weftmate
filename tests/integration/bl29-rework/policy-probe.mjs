import { outputPath } from './evidence.mjs';
import vm from 'node:vm';import {readFileSync,writeFileSync} from 'node:fs';
const report={firstRetry:[],secondRetry:[]};
for(const random of [0,.1,.3,.5,.7,.9,1]){
 const ctx={WeftUiCore:{factories:{}},Date,Math,URLSearchParams,AbortSignal,Promise,setTimeout,clearTimeout,setInterval,clearInterval};vm.createContext(ctx);
 for(const file of ['presence','shell'])vm.runInContext(readFileSync('src/ui-core/'+file+'.js','utf8'),ctx);
 const core={state:{identityGeneration:1,historyGeneration:1,selectedChatId:'c',personalCapabilities:{replyStreaming:1}}};
 const shell=ctx.WeftUiCore.factories.shell(core,{}, {random:()=>random});Object.assign(core,shell);
 report.firstRetry.push({random,ms:shell.historyReadResult('failed').retryAfter});
 report.secondRetry.push({random,ms:shell.historyReadResult('failed').retryAfter});
}
let now=0,id=0,online=false;const timers=new Map(),probes=[];
const clock={setTimeout(fn,delay){timers.set(++id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);}};
const ctx={WeftUiCore:{factories:{}},Date:{now:()=>now},Math};vm.createContext(ctx);vm.runInContext(readFileSync('src/ui-core/presence.js','utf8'),ctx);
const core={state:{identityGeneration:1},polling:{background:60000,presence:15000},accessBase:'',requestJson:async()=>{probes.push(now);if(!online)throw {code:'SERVICE_CLOSING',status:503};return {presence:{runtime:'ready'}};}};
Object.assign(core,ctx.WeftUiCore.factories.presence(core,{}, {clock,now:()=>now,random:()=>1}));
let recoveredAt;core.startConnection(async()=>{recoveredAt=now;});
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};await flush();
for(let n=0;n<6;n++){const [key,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(key);now=t.at;t.fn();await flush();}
const restoredAt=now+1;now=restoredAt;online=true;
const [key,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(key);now=t.at;t.fn();await flush();
report.fullHostRecovery={probeTimes:probes,restoredAt,recoveredAt,delay:recoveredAt-restoredAt,state:core.connectionView().kind};core.stopConnection();
writeFileSync(outputPath('policy-probe.json'),JSON.stringify(report,null,2));console.log(report);
