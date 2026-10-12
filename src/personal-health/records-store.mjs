import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { durableWrite } from '../personal-access/store.mjs';
import { failure } from '../personal-access/common.mjs';
import { localNotificationTime } from '../personal-access/notification-policy.mjs';
import { HEALTH_DEFAULTS, validHealthDay, validateHealthRecord, healthSettingsPatch } from './records-schema.mjs';
import { healthShiftDay } from './analysis.mjs';

/** Independent owner file; the existing fsync/atomic-write and backup barrier apply. */
export function createHealthRecordsStore({root,clock=Date.now,timeZone=()=> 'UTC'}) {
  const queues=new Map();
  function file(ownerId){if(!/^owner-[0-9a-f-]{36}$/i.test(ownerId))throw failure('UNAUTHORIZED',401);return path.join(root,'accounts',ownerId,'health','daily-records.json');}
  const fresh=ownerId=>({version:1,ownerId,settings:{...HEALTH_DEFAULTS},settingsUpdatedAt:null,generation:0,modelClaims:null,days:{}});
  function serial(ownerId,fn){file(ownerId);const job=(queues.get(ownerId)??Promise.resolve()).catch(()=>{}).then(fn);queues.set(ownerId,job.catch(()=>{}));return job;}
  async function load(ownerId){try{await ensurePrivateFile(file(ownerId));const s=JSON.parse(await readFile(file(ownerId),'utf8'));if(s.version!==1||s.ownerId!==ownerId||!s.days||!s.settings)throw Error();return s;}catch(e){if(e.code==='ENOENT')return fresh(ownerId);throw failure('STORAGE_UNAVAILABLE',503);}}
  async function save(ownerId,state){await ensurePrivateDirectory(path.dirname(file(ownerId)));await durableWrite(file(ownerId),state);}
  function prune(state,ownerId){const retention=state.settings.retentionDays;if(retention===null)return false;const cutoff=healthShiftDay(localNotificationTime(clock(),timeZone(ownerId)).day,1-retention);let changed=false;for(const day of Object.keys(state.days))if(day<cutoff){delete state.days[day];changed=true;}return changed;}
  const api={
    read(ownerId){return serial(ownerId,async()=>{const s=await load(ownerId);if(prune(s,ownerId))await save(ownerId,s);return s;});},
    update(ownerId,fn,authorize=()=>{}){return serial(ownerId,async()=>{await authorize();const s=await load(ownerId);prune(s,ownerId);const value=await fn(s);await save(ownerId,s);return value;});},
    async migrate(ownerId,legacy){if(!Object.keys(legacy??{}).length)return;await api.update(ownerId,s=>{for(const [day,health]of Object.entries(legacy)){if(!s.days[day])s.days[validHealthDay(day)]={health:validateHealthRecord(health),updatedAt:new Date(clock()).toISOString()};}prune(s,ownerId);});},
    async upsert(ownerId,items,authorize=()=>{}){
      if(!Array.isArray(items)||items.length<1||items.length>100||new Set(items.map(i=>i?.day)).size!==items.length)throw failure('INVALID_REQUEST');
      const normalized=items.map(row=>{if(!row||Object.keys(row).sort().join(',')!=='day,health'||Buffer.byteLength(JSON.stringify(row.health))>12*1024)throw failure('INVALID_REQUEST');return {day:validHealthDay(row.day),health:validateHealthRecord(row.health)};});
      return api.update(ownerId,s=>{
        const today=localNotificationTime(clock(),timeZone(ownerId)).day,cutoff=s.settings.retentionDays===null?null:healthShiftDay(today,1-s.settings.retentionDays);
        for(const row of normalized)if(row.day>today||cutoff&&row.day<cutoff)throw failure('INVALID_REQUEST');
        const changedDays=[];
        for(const {day,health}of normalized)if(!isDeepStrictEqual(s.days[day]?.health,health)){const previous=s.days[day];s.days[day]={health,updatedAt:new Date(clock()).toISOString(),claims:previous?.claims??0};changedDays.push(day);}
        if(changedDays.length){s.generation++;if(s.days[today])delete s.days[today].insight;}
        return {items:normalized,changedDays};
      },authorize);
    },
    async settings(ownerId,input,authorize=()=>{}){const patch=healthSettingsPatch(input);return api.update(ownerId,s=>{const {clear,...settings}=patch;Object.assign(s.settings,settings);s.settingsUpdatedAt=new Date(clock()).toISOString();s.generation++;if(clear)s.days={};else for(const row of Object.values(s.days))delete row.insight;prune(s,ownerId);return {settings:s.settings,updatedAt:s.settingsUpdatedAt};},authorize);},
    async close(){await Promise.allSettled([...queues.values()]);queues.clear();}
  };return api;
}
