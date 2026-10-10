import { randomUUID } from 'node:crypto';
import { failure } from './common.mjs';
import { putActivity, activityState } from './activity-store.mjs';
import { notificationSettings, validateNotificationSettings, decideNotification, inQuietHours, localNotificationTime } from './notification-policy.mjs';
import { activityNotificationContent } from './notification-content.mjs';
export function finalizeNotifications(account, now, timeZone) {
  const state=activityState(account), settings=notificationSettings(account), quiet=inQuietHours(settings,now,timeZone);
  const day=localNotificationTime(now,timeZone).day;
  const ledger=account.notificationLedger??={day,count:0,suppressed:[]};
  if(ledger.day!==day){ledger.day=day;ledger.count=0;}
  ledger.suppressed=ledger.suppressed.filter(id=>state.items[id]);
  if(!quiet && ledger.suppressed.length){
    const count=ledger.suppressed.length;
    const initiatedBy=ledger.suppressed.some(id=>state.items[id].notification.initiatedBy==='user')?'user':'assistant';
    putActivity(account,`dnd-summary:${randomUUID()}`,{at:new Date(now).toISOString(),type:'system.dnd.summary',title:'勿扰已结束',summary:`勿扰期间有 ${count} 件事`,level:'normal',initiatedBy});
    ledger.suppressed=[];
  }
  for(const row of Object.values(state.items)){
    if(typeof row.notification.title!=='string'||typeof row.notification.body!=='string')Object.assign(row.notification,activityNotificationContent(account,row));
    if(Object.hasOwn(row.notification,'notify'))continue;
    const result=decideNotification({type:row.type,level:row.notification.level,settings,now,timeZone,dailyCount:ledger.count,initiatedBy:row.notification.initiatedBy,test:row.notification.test});
    Object.assign(row.notification,result,{decidedAt:new Date(now).toISOString()});
    if(result.reason==='dnd')ledger.suppressed.push(row.id);
    if(result.notify && row.notification.initiatedBy==='assistant' && !row.notification.test)ledger.count++;
  }
}
export async function handleNotificationSettings(context,request,response,url,ownerId){
  const test=url.pathname==='/personal/v1/settings/notifications/test';
  if(url.search || !(test?request.method==='POST':['GET','PATCH'].includes(request.method)))throw failure('INVALID_REQUEST');
  context.authenticate(request,request.method==='GET'?'sessions:read':'account:manage');
  let patch;
  if(request.method!=='GET'){
    const body=await context.readJson(request);
    if(test){if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length)throw failure('INVALID_REQUEST');}
    else try{patch=validateNotificationSettings(body);}catch{throw failure('INVALID_REQUEST');}
  }
  let activityId;
  if(request.method!=='GET')await context.serial(()=>context.mutate(ownerId,next=>{
    context.authenticate(request,'account:manage');
    if(patch){next.notificationSettings={...notificationSettings(next),...patch};next.notificationSettingsUpdatedAt=new Date(context.timestamp()).toISOString();}
    if(test)activityId=putActivity(next,`notification-test:${randomUUID()}`,{at:new Date(context.timestamp()).toISOString(),type:'system.notification.test',title:'测试通知',summary:'通知已连接。声音和音量按你的设置与系统设置播放。',level:'normal',test:true}).id;
  }));
  const account=context.accountState(ownerId);
  return context.json(response,200,{settings:notificationSettings(account),updatedAt:account.notificationSettingsUpdatedAt??null,synced:true,timeZone:context.usage.settings(ownerId).timeZone,...(test?{activityId}: {})});
}
