/** Account-scoped notification policy. Clients consume this durable decision. */
export const notificationDefaults = Object.freeze({
  approval: 'sound', question: 'sound', task: 'sound', reminder: 'sound', memory: 'notify',
  memoryReport: 'notify', companion: 'notify', system: 'notify',
  dndEnabled: false, dndStart: '22:00', dndEnd: '08:00', approvalException: true,
  dailyLimit: 5, soundEnabled: true,
});
export function notificationSettings(account) { return {...notificationDefaults, ...account.notificationSettings}; }
export function validateNotificationSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) throw new TypeError('INVALID_REQUEST');
  for (const [key,value] of Object.entries(patch)) {
    if (!Object.hasOwn(notificationDefaults,key)) throw new TypeError('INVALID_REQUEST');
    if (key === 'dailyLimit') { if (![0,3,5,10,null].includes(value)) throw new TypeError('INVALID_REQUEST'); }
    else if (key === 'dndStart' || key === 'dndEnd') { if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new TypeError('INVALID_REQUEST'); }
    else if (typeof notificationDefaults[key] === 'boolean') { if (typeof value !== 'boolean') throw new TypeError('INVALID_REQUEST'); }
    else if (!['sound','notify','activity'].includes(value)) throw new TypeError('INVALID_REQUEST');
  }
  return {...patch};
}
export function localNotificationTime(now, timeZone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  return {day:`${parts.year}-${parts.month}-${parts.day}`, time:`${parts.hour}:${parts.minute}`};
}
export function inQuietHours(settings, now, timeZone) {
  if (!settings.dndEnabled) return false;
  const {time}=localNotificationTime(now,timeZone),start=settings.dndStart,end=settings.dndEnd;
  // Equal endpoints mean a full day, made explicit in the form.
  return start===end || (start<end ? time>=start&&time<end : time>=start||time<end);
}
export function notificationCategory(type) {
  if (type==='memory.report') return 'memoryReport';
  if (type.startsWith('companion.')) return 'companion';
  return type.split('.')[0];
}
export function decideNotification({type,level,settings=notificationDefaults,now=Date.now(),timeZone='UTC',dailyCount=0,initiatedBy='user',test=false}) {
  settings={...notificationDefaults,...settings};
  const mode=settings[notificationCategory(type)]??'activity';
  const result=(notify,reason)=>({notify,sound:notify&&(test||mode==='sound')&&settings.soundEnabled,decision:notify?(settings.soundEnabled&&(test||mode==='sound')?'notify':'silent'):'activity',reason});
  if (!test && level==='silent') return result(false,'silent');
  if (!test && mode==='activity') return result(false,'type_disabled');
  if (!test && inQuietHours(settings,now,timeZone) && !(type==='approval.pending'&&settings.approvalException)) return result(false,'dnd');
  if (!test && initiatedBy==='assistant' && settings.dailyLimit!==null && dailyCount>=settings.dailyLimit) return result(false,'daily_limit');
  return result(true,test?'test':'allowed');
}
export const notificationReasonText={dnd:'因勿扰未提醒',daily_limit:'已达每日主动提醒上限',type_disabled:'已设为只进动态',silent:'静默动态'};
