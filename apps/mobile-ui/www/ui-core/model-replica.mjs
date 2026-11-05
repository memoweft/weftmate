import {newer,settingsHeads} from './settings-replica.mjs';
const invalid=()=>Object.assign(new Error('MODEL_SYNC_INVALID'),{code:'MODEL_SYNC_INVALID'});
const copy=rows=>structuredClone(rows);
export function modelView(cache) {
  const services=Object.entries(cache?.rows??{}).filter(([id,row])=>id!=='default'&&!row.value.removed).map(([,row])=>row.value);
  const profiles=services.flatMap(service=>service.models.filter(model=>model.enabled&&model.profileId).map(model=>({service,model})));
  const selected=profiles.find(row=>row.model.profileId===cache?.rows.default?.value)||
    ((cache?.local??[]).some(row=>row.profileId===cache?.rows.default?.value)?null:profiles[0]);
  const current=selected?{...selected.model,modelId:selected.model.modelId,serviceId:selected.service.serviceId,
    baseUrl:selected.service.baseUrl,interfaceType:selected.service.interfaceType,apiKey:selected.service.apiKey}:null;
  return {services,local:cache?.local??[],current,defaultProfileId:selected?.model.profileId??null};
}
export function openModelReplica({codec,read,write,current,exchange,deviceId,random,now=Date.now}) {
  async function load(){
    const box=await read(),cache=box===undefined?null:await codec.open('models-cache',box);current();
    return {box,cache};
  }
  async function sync(action='sync',serviceId,body) {
    const before=await load(),rows=before.cache?.rows??{};
    const row=rows[action==='select'?'default':serviceId],version={at:Math.max(now(),(row?.at??0)+1),id:random()};
    const requestId=random(),box=await codec.seal('models-request',{action,serviceId,body,version,
      deviceId,requestId,known:settingsHeads(rows)});
    current();const reply=await exchange({box}),payload=await codec.open('models-response',reply.box);current();
    if(payload.requestId!==requestId)throw invalid();
    if(action==='check'||action==='refresh')return payload.result;
    if(!payload.rows||!payload.heads||!Array.isArray(payload.local))throw invalid();
    const latest=await load(),merged=copy(latest.cache?.rows??{});
    for(const [id,row] of Object.entries(payload.rows)){
      if(!row||!Number.isSafeInteger(row.at)||typeof row.id!=='string'||!row.value&&id!=='default')throw invalid();
      if(!merged[id]||newer(row,merged[id]))merged[id]=row;
    }
    for(const [id,head] of Object.entries(payload.heads))if(!merged[id]||newer(head,merged[id]))throw invalid();
    const cache={rows:merged,local:payload.local};
    if(JSON.stringify(cache)!==JSON.stringify(latest.cache))await write(latest.box,await codec.seal('models-cache',cache));
    current();return modelView(cache);
  }
  return {read:async()=>modelView((await load()).cache),sync,
    check:body=>sync('check',body.serviceId,body),refresh:serviceId=>sync('refresh',serviceId),
    configure:(serviceId,body)=>sync('configure',serviceId,body),
    remove:serviceId=>sync('remove',serviceId),
    select:(serviceId,modelId)=>sync('select',serviceId,{modelId})};
}
