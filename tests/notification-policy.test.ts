import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { notificationDefaults as defaults, decideNotification, inQuietHours, validateNotificationSettings, localNotificationTime, notificationCategory } from '../src/personal-access/notification-policy.mjs';
import { finalizeNotifications } from '../src/personal-access/notification-settings.mjs';
import { putActivity, removeActivity } from '../src/personal-access/activity-store.mjs';
import { startTimelineCandidate } from './integration/timeline-ui-candidate.mjs';

test('decision matrix: every event category × level × mode × quiet hours × exception × cap × timezone × origin × sound',()=>{
  let cases=0;
  for(const type of ['approval.pending','question.pending','task.completed','task.failed','task.stopped','reminder.triggered','memory.paused','memory.submission.completed','memory.report','companion.greeting','system.update.available','system.reconnected'])
  for(const level of ['important','normal','silent'])for(const mode of ['sound','notify','activity'])
  for(const quiet of [false,true])for(const exception of [false,true])for(const limit of [0,3,5,10,null])
  for(const count of [0,5,10])for(const timeZone of ['UTC','Asia/Shanghai','America/New_York','Pacific/Kiritimati'])
  for(const initiatedBy of ['user','assistant'])for(const sound of [false,true]){
    const now=Date.parse('2026-10-10T15:30:00Z');
    const settings={...defaults,[notificationCategory(type)]:mode,dndEnabled:quiet,dndStart:'00:00',dndEnd:'00:00',approvalException:exception,dailyLimit:limit,soundEnabled:sound};
    const reason=level==='silent'?'silent':mode==='activity'?'type_disabled':quiet&&!(exception&&type==='approval.pending')?'dnd':initiatedBy==='assistant'&&limit!==null&&count>=limit?'daily_limit':'allowed';
    const value=decideNotification({type,level,settings,now,timeZone,dailyCount:count,initiatedBy});
    assert.equal(value.reason,reason,JSON.stringify({type,level,mode,quiet,exception,limit,count,timeZone,initiatedBy}));
    assert.equal(value.notify,reason==='allowed');assert.equal(value.sound,reason==='allowed'&&sound&&mode==='sound');cases++;
  }
  assert.equal(cases,103680);
});

test('quiet intervals include start, exclude end, cross midnight, use account timezone and DST',()=>{
  const settings={...defaults,dndEnabled:true};
  for(const [instant,expected]of [['2026-10-10T13:59Z',false],['2026-10-10T14:00Z',true],['2026-10-10T23:59Z',true],['2026-10-11T00:00Z',false]])assert.equal(inQuietHours(settings,Date.parse(instant),'Asia/Shanghai'),expected);
  const daytime={...settings,dndStart:'09:00',dndEnd:'17:00'};
  assert.equal(inQuietHours(daytime,Date.parse('2026-10-10T09:00Z'),'UTC'),true);assert.equal(inQuietHours(daytime,Date.parse('2026-10-10T17:00Z'),'UTC'),false);
  const dst={...settings,dndStart:'01:00',dndEnd:'02:00'};
  for(const instant of ['2026-11-01T05:30Z','2026-11-01T06:30Z'])assert.equal(inQuietHours(dst,Date.parse(instant),'America/New_York'),true);
  assert.equal(localNotificationTime(Date.parse('2026-10-10T10:00Z'),'Pacific/Kiritimati').day,'2026-10-11');
});

test('durable decisions count only delivered proactive events, survive replay/restart, coalesce quiet events, honor erasure and daily rollover',()=>{
  const account:any={sessions:{},commands:{},notificationSettings:{...defaults,dndEnabled:true,dailyLimit:0}};
  const now=Date.parse('2026-10-10T23:00Z');
  for(let n=0;n<3;n++)putActivity(account,'task:'+n,{at:new Date(now).toISOString(),type:'task.completed',title:'完成',summary:'合成结果'});
  putActivity(account,'approval',{at:new Date(now).toISOString(),type:'approval.pending',title:'审批',state:'pending',level:'important'});
  finalizeNotifications(account,now,'UTC');assert.equal(account.notificationLedger.suppressed.length,3);assert.equal(account.notificationLedger.count,0);
  assert.equal(Object.values(account.activity.items).find((r:any)=>r.type==='approval.pending').notification.notify,true);
  finalizeNotifications(account,now,'UTC');assert.equal(account.notificationLedger.suppressed.length,3);
  const restored=structuredClone(account);finalizeNotifications(restored,Date.parse('2026-10-11T08:00Z'),'UTC');
  const summary:any=Object.values(restored.activity.items).find((r:any)=>r.type==='system.dnd.summary');assert.equal(summary.summary,'勿扰期间有 3 件事');assert.equal(summary.notification.notify,true);
  finalizeNotifications(restored,Date.parse('2026-10-11T08:01Z'),'UTC');assert.equal(Object.values(restored.activity.items).filter((r:any)=>r.type==='system.dnd.summary').length,1);
  restored.notificationSettings.dailyLimit=3;
  for(let n=0;n<4;n++){putActivity(restored,'active:'+n,{at:new Date(now).toISOString(),type:'companion.greeting',title:'主动合成',initiatedBy:'assistant'});finalizeNotifications(restored,Date.parse('2026-10-11T10:00Z'),'UTC');}
  assert.equal(restored.notificationLedger.count,3);assert.equal(Object.values(restored.activity.items).filter((r:any)=>r.notification.reason==='daily_limit').length,1);
  putActivity(restored,'user-result',{at:new Date(now).toISOString(),type:'task.failed',title:'失败',initiatedBy:'user'});finalizeNotifications(restored,Date.parse('2026-10-11T10:00Z'),'UTC');assert.equal(restored.notificationLedger.count,3);
  finalizeNotifications(restored,Date.parse('2026-10-12T10:00Z'),'UTC');assert.equal(restored.notificationLedger.count,0);
  removeActivity(account,(r:any)=>r.type==='task.completed');finalizeNotifications(account,Date.parse('2026-10-11T08:00Z'),'UTC');assert.equal(Object.values(account.activity.items).some((r:any)=>r.type==='system.dnd.summary'),false);
});

test('settings migration/defaults, strict validation, account persistence/sync, test notification bypass and restart',async t=>{
  let now=Date.now();const f=await startTimelineCandidate({historyCount:0,interactive:true,clock:()=>now});t.after(async()=>{await f.close();await rm(f.root,{recursive:true,force:true});});
  const initial=await f.request('/settings/notifications');assert.deepEqual(initial.settings,defaults);assert.equal(initial.updatedAt,null);
  for(const invalid of [{dailyLimit:2},{dndStart:'24:00'},{dndEnd:'8:00'},{soundEnabled:'true'},{approval:'yes'},{secret:'x'},{}])assert.throws(()=>validateNotificationSettings(invalid));
  assert.equal((await fetch(f.origin+'/personal/v1/settings/notifications')).status,401);
  await f.request('/settings/notifications',{task:'activity',dndEnabled:true,dndStart:'00:00',dndEnd:'00:00',soundEnabled:false,dailyLimit:0},'PATCH');
  const first=await f.request('/settings/notifications');assert.equal(first.settings.task,'activity');assert.ok(first.updatedAt);assert.equal(first.synced,true);
  await f.request('/settings/notifications',{reminder:'notify'},'PATCH');assert.equal((await f.request('/settings/notifications')).settings.task,'activity');
  const test=await f.request('/settings/notifications/test',{});const row=(await f.request('/activity')).items.find((r:any)=>r.id===test.activityId);assert.equal(row.notification.notify,true);assert.equal(row.notification.sound,false);assert.equal(row.notification.reason,'test');
  const store=JSON.parse(await readFile(join(f.root,'store.json'),'utf8'));const account:any=Object.values(store.accounts)[0];assert.equal(account.notificationSettings.task,'activity');
  await f.restartWithCloud(null);assert.equal((await f.request('/settings/notifications')).settings.reminder,'notify');
  const restored=(await f.request('/activity')).items.find((r:any)=>r.id===test.activityId);assert.deepEqual(restored.notification,row.notification);
});


test('two accounts and two devices share only their own settings; missing CSRF and cross-account fields are rejected',async t=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-st6-accounts-'));
  const backend:any={getStatus:async()=>({runtime:'ready'}),listModels:async()=>[],preflight:async()=>({ok:true}),createSession:async({sessionId}:any)=>({sessionId}),sendMessage:async()=>({accepted:true}),cancelSession:async()=>({accepted:true}),readEvents:async()=>({events:[]}),describeSession:async()=>null};
  const service=await createPersonalAccessService({root,port:0,backend});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
  const {origin}=await service.start();
  async function api(path:string,session:any,body?:any,method=body?'PATCH':'GET'){
    const response=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,...(session?{cookie:session.cookie,...(session.csrf?{'x-weftmate-csrf':session.csrf}:{})}:{}),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json(),cookie:response.headers.getSetCookie()[0]?.split(';')[0]};
  }
  const register=async(username:string)=>{const result=await api('/auth/register',null,{username,password:'Synthetic-ST6-password-2026!',deviceName:'合成设备'},'POST');assert.equal(result.status,201);return {cookie:result.cookie,csrf:result.body.csrfToken};};
  const a=await register('SyntheticST6A'),b=await register('SyntheticST6B');
  assert.equal((await api('/settings/notifications',a,{dailyLimit:0,reminder:'activity'})).status,200);
  assert.equal((await api('/settings/notifications',b)).body.settings.dailyLimit,5);
  const otherDevice=await api('/auth/login',null,{username:'SyntheticST6A',password:'Synthetic-ST6-password-2026!',deviceName:'另一合成设备'},'POST');
  const a2={cookie:otherDevice.cookie,csrf:otherDevice.body.csrfToken};assert.equal((await api('/settings/notifications',a2)).body.settings.dailyLimit,0);
  await api('/settings/notifications',a2,{question:'notify'});const synced=(await api('/settings/notifications',a)).body.settings;assert.equal(synced.reminder,'activity');assert.equal(synced.question,'notify');
  assert.equal((await api('/settings/notifications',{cookie:a.cookie},{soundEnabled:false})).status,403);
  assert.equal((await api('/settings/notifications',a,{ownerId:'other'})).status,400);
  assert.equal((await api('/settings/notifications/test',a,[],'POST')).status,400);
  assert.equal((await api('/settings/notifications',b)).body.settings.question,'sound');
});

test('queued notification setting writes retain identity and late view responses cannot change another account',async()=>{
  const context:any={WeftUiCore:{factories:{}}};runInNewContext(readFileSync(new URL('../src/ui-core/settings.js',import.meta.url),'utf8'),context);
  let resolve:any,calls=0;
  const core:any={state:{identityGeneration:1,ownerId:'a'},accessApi:async()=>{calls++;return new Promise(r=>{resolve=r;});}};
  Object.assign(core,context.WeftUiCore.factories.settings(core,{},{}));
  const first=core.saveNotificationSettings({dailyLimit:0});await Promise.resolve();await Promise.resolve();
  const queued=core.saveNotificationSettings({soundEnabled:false});core.state.identityGeneration++;core.state.ownerId='b';
  resolve({settings:{...defaults,dailyLimit:0}});await first;await assert.rejects(queued,/ACCOUNT_CHANGED/);assert.equal(calls,1);
});
