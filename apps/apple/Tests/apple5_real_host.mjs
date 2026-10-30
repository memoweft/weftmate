// Real /personal/v1 router, authentication, stores, algorithms and account projections.
// Only the DSH/model adapter and native event data are synthetic. No cloud/HealthKit access.
import {createPersonalAccessService} from '../../../src/personal-access/index.mjs';
import {generateHealthV3Fixture,generateHealthV3Sequence} from '../../../tests/helpers/health-sequence.mjs';
import {INTERNAL_ARTIFACT_KIND} from '../../../src/personal-access/constants.mjs';
import {mkdtemp,readFile,writeFile,rm,lstat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {canonicalCommand} from '../../../src/personal-access/command-policy.mjs';
import {putActivity} from '../../../src/personal-access/activity-store.mjs';
import {reconcileChatIdentity} from '../../../src/personal-access/chat-identity.mjs';
import {createPagesMemoryFixture} from './ios_ui_pages_memory_fixture.mjs';
import {validateStore} from '../../../src/personal-access/store.mjs';
const root=await realpath(await mkdtemp(join(tmpdir(),'weftmate-apple5-')));
const healthZone=process.env.WEFTMATE_APPLE6_HEALTH_ZONE ?? 'UTC';
const day='2026-10-12', now=Date.parse(day+'T12:00:00Z'), goals=new Map(), schedules=new Map();
const sessionId='apple5-session', goalId='apple5-goal', scheduleId='apple5-reminder';
let modelCalls=0, sends=0, scheduleCreates=0;
const nativeEvents=[{seq:0,type:'user.message',timestamp:day+'T08:00:00.000Z',data:{text:'整理周末计划'}},{seq:1,type:'artifact.created',timestamp:day+'T08:10:00.000Z',data:{artifactId:'apple5-file'}}];
const backend={
    getStatus:async()=>({runtime:'ready',capabilities:{chat:{available:true}}}),
    listModels:async()=>[{id:'local',name:'合成模型',model:'synthetic',configured:true}],preflight:async()=>({ok:true}),
    createSession:async({sessionId})=>({sessionId}),sendMessage:async()=>({accepted:true,receiptId:'synthetic-'+(++sends)}),cancelSession:async()=>({accepted:true}),
    readEvents:async()=>({events:nativeEvents,nextSeq:1,hasMore:false}),
    listUserQuestions:async()=>({runtimeId:'apple5-synthetic-runtime',questions:[]}),
    describeSession:async id=>({sessionId:id,title:'合成周末计划',agentPreset:'personal-remote',modelProfileId:'local'}),
    goals:async input=>{
        if(input.action==='list')return {goal:goals.get(input.sessionId)??null};
        if(input.action==='create'){const goal={id:goalId,revision:1,objective:input.objective,phase:'active',roundsStarted:2,maxGoalRounds:20,createdAt:now,updatedAt:now};goals.set(input.sessionId,goal);return {ref:{id:goal.id,revision:goal.revision}};}
        const goal=goals.get(input.sessionId);if(input.action==='archive'){goals.delete(input.sessionId);return {archived:true,ref:input.ref};}if(goal){goal.phase='complete';goal.revision++;}return {ref:{id:goalId,revision:goal?.revision??2}};
    },
    schedules:async input=>{
        if(input.action==='list')return {items:[...schedules.values()].filter(x=>x.sessionId===input.sessionId)};
        if(input.action==='notifications')return {items:[]};
        if(input.action==='create'){const prompt=JSON.parse(input.prompt);const item={id:'apple5-health-reminder-'+(++scheduleCreates),sessionId:input.sessionId,text:prompt.text,kind:prompt.kind,timeZone:'UTC',state:'active',createdAt:day+'T08:00:00.000Z',nextRunAt:day+'T15:00:00Z',revision:1,lastResult:{state:'delivered'}};schedules.set(item.id,item);return {item};}
        const item=schedules.get(input.id);if(item&&input.action==='pause')item.state='paused';if(item&&input.action==='resume')item.state='active';if(input.action==='delete')schedules.delete(input.id);return {ok:true};
    },
    modelCompletion:async input=>{modelCalls++;if(JSON.parse(input.body.messages[1].content).scope==='vital:hrvSdnnMs')await new Promise(resolve=>setTimeout(resolve,800));return Response.json({choices:[{message:{content:JSON.stringify({text:'汇总数字已整理，可以按自己的节奏安排。',points:[],basis:JSON.parse(input.body.messages[1].content).basis})}}]});},
};
const memoryManager=process.env.WEFTMATE_IOS_UI_PAGES==='1'?createPagesMemoryFixture():null;
let service=await createPersonalAccessService({root,port:0,backend,memoryManager,clock:()=>now});
let {origin}=await service.start();const grant=await service.issueSetupGrant();
const username='Apple5Synthetic',password='Synthetic-'+randomUUID()+randomUUID();
const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username,password,deviceName:'合成电脑'})});
if(setup.status!==201)throw Error('synthetic setup failed');
const auth=await setup.json(),cookie=setup.headers.get('set-cookie').split(';')[0];
const req=async(path,method='GET',body)=>{const response=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,cookie,'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(response.status>=400)throw Error(path+' '+response.status+' '+data.error?.code);return data;};
await req('/settings/usage','PATCH',{timeZone:healthZone});await req('/settings/models','PATCH',{defaultModelProfileId:'local',backgroundModelProfileId:'local'});await req('/settings/health','PATCH',{modelInsightsEnabled:false});
const fixture=generateHealthV3Fixture({to:day,timeZone:healthZone}),sequence=generateHealthV3Sequence({to:day,timeZone:healthZone});
await req('/health/profile','PUT',sequence.profile);await req('/health/records/batch','PUT',{items:sequence.items});
// Seed isolated native receipts using the real persisted schema, then restart before reading.
await service.close();const storeFile=join(root,'store.json'),store=JSON.parse(await readFile(storeFile,'utf8')),account=store.accounts[auth.account.ownerId];
account.sessions[sessionId]={ownerId:auth.account.ownerId,sessionId,title:'合成周末计划',origin:'personal-remote',modelProfileId:'local',createdAt:day+'T08:00:00.000Z',updatedAt:day+'T08:10:00.000Z'};
const file=join(root,'synthetic-plan.md');await writeFile(file,'# 合成周末计划\n\n散步半小时，读几页书。\n');const stat=await lstat(file),identity=await lstat(file,{bigint:true});
const sha256=createHash('sha256').update(await readFile(file)).digest('hex');
function command(id,input,extra={}) { const payload=canonicalCommand({requestId:id+'-request',targetDeviceId:store.hostId,...input},store.hostId,true);return {commandId:id,ownerId:auth.account.ownerId,sourceDeviceId:auth.device.id,targetDeviceId:store.hostId,requestId:payload.requestId,kind:payload.kind,payload,payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),state:'observed',sessionId,createdAt:day+'T08:10:00.000Z',updatedAt:day+'T08:10:00.000Z',...extra}; }
account.commands['apple5-task']=command('apple5-task',{kind:'session.message',sessionId,text:'整理周末计划'},{dshTurn:1,receiptId:'apple5-receipt'});
account.commands['apple5-file']=command('apple5-file',{kind:INTERNAL_ARTIFACT_KIND,sessionId,taskId:'apple5-task',artifactId:'apple5-file',fileName:'周末计划.md',size:stat.size,sha256,nativeFile:true},{nativeFileObserved:true,verification:{status:'observed',method:'sha256_readback',observedAt:day+'T08:10:00.000Z'},artifactId:'apple5-file',fileName:'周末计划.md',size:stat.size,sha256,taskId:'apple5-task',nativeFile:{path:file,device:String(identity.dev),inode:String(identity.ino),createdAt:stat.birthtime.toISOString(),modifiedAt:stat.mtime.toISOString(),size:stat.size,sha256,snapshot:false},toolSource:{sessionId,sourceCommandId:'apple5-task',turn:1,callId:'write'}});
for(const [id,type,title,summary,source,actions,extra] of [
    ['apple5-complete','task.completed','周末计划已整理','做好了一份可以带走的计划。',{sessionId,taskId:'apple5-task'},[{kind:'view_library',label:'查看成果',target:{id:'apple5-file'}},{kind:'open_chat',label:'打开对话',target:{sessionId}}],{}],
    ['apple5-week','memory.report','这周回顾','睡眠和活动已经有了连续记录。',{sessionId},[{kind:'open_chat',label:'打开对话',target:{sessionId}}],{weeklyInsight:{from:'2026-10-05',to:day,timeZone:'UTC',text:'完成了周末计划，留了时间散步。',health:{text:'这周睡眠和运动已有记录。'}}}],
    ['apple5-memory','memory.report','记忆周报','这周记下了新的阅读计划。',{sessionId},[{kind:'view_memory',label:'查看记忆',target:{}}],{memoryDigest:{summary:'这周的记忆变化',corrected:[],review:[],added:[{kind:'claim',id:'synthetic-memory',text:'周末留一点时间阅读。'}]}}],
    ['apple5-remind','reminder.triggered','出去走走','提醒你下午留点时间散步。',{sessionId,scheduleId},[{kind:'open_chat',label:'打开对话',target:{sessionId}}],{}],
])putActivity(account,id,{id,at:day+'T10:00:00.000Z',type,title,summary,source,actions,...extra});
reconcileChatIdentity(account,store.hostId,day+"T08:00:00.000Z");
validateStore(store);
await writeFile(storeFile,JSON.stringify(store));
service=await createPersonalAccessService({root,port:0,backend,memoryManager,clock:()=>now});({origin}=await service.start());
goals.set(sessionId,{id:goalId,revision:1,objective:'每周留出阅读时间\n先完成这周的计划',phase:'active',roundsStarted:2,maxGoalRounds:20,createdAt:now,updatedAt:now});
schedules.set(scheduleId,{id:scheduleId,sessionId,text:'下午出去走走',kind:'reminder',timeZone:'UTC',state:'active',createdAt:day+'T08:00:00.000Z',nextRunAt:day+'T15:00:00Z',revision:1,lastResult:{state:'delivered'}});
const output=resolve(process.argv[2]);await writeFile(output,JSON.stringify({origin,username,password,day,sessionId,fixture,records:sequence.items,profile:sequence.profile}),{mode:0o600});
console.log(JSON.stringify({ready:true,syntheticOnly:true,realPersonalHost:true}));
let closing=false;const close=async()=>{if(closing)return;closing=true;await service.close();await rm(root,{recursive:true,force:true});await rm(output,{force:true});process.exit(0);};process.on('SIGTERM',close);process.on('SIGINT',close);

if(process.env.WEFTMATE_IOS_UI_PAGES==='1'){process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{if(value.trim()==='stop')void close();});}
