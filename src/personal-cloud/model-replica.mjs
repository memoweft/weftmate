import { randomUUID } from 'node:crypto';
import { failure } from '../personal-access/common.mjs';
import { newer, settingsHeads } from '../ui-core/settings-replica.mjs';

const cleanModels = models => models.map(({modelId,name,enabled,profileId,capabilities,deepThinking}) =>
  ({modelId,name,enabled,...(profileId?{profileId}:{}),...(capabilities?{capabilities}:{}),...(deepThinking?{deepThinking}:{})}));

export function createModelExchange(context,hostId,authorize,withCodec,persist) {
  const pending=new Map();
  return async(request,box)=>{
    const identity=authorize(request),{issuer,sub,ownerId,deviceId,keyId}=identity;
    const check=(permission='sessions:read')=>{
      const current=authorize(request,permission);
      if(current.issuer!==issuer || current.sub!==sub || current.ownerId!==ownerId || current.deviceId!==deviceId || current.keyId!==keyId)
        throw failure('UNAUTHORIZED',401);
      return current.binding;
    };
    return withCodec(issuer,sub,hostId,async codec=>{
      let query;
      try{query=await codec.open('models-request',box);}catch{throw failure('MODEL_SYNC_INVALID',403);}
      if(query?.deviceId!==deviceId || typeof query.requestId!=='string'|| !/^[\w-]{16,64}$/.test(query.requestId))throw failure('MODEL_SYNC_INVALID',403);
      if(!['sync','configure','remove','select','check','refresh'].includes(query.action)||!query.known||typeof query.known!=='object'||Array.isArray(query.known))throw failure('INVALID_REQUEST');
      const work=(pending.get(ownerId)||Promise.resolve()).catch(()=>{}).then(async()=>{
        let binding=check();
        const prior=binding.modelsBox?await codec.open('models-source',binding.modelsBox):{rows:{}};
        let next=await readModelSnapshot(context,ownerId,prior);
        if(query.action==='check'||query.action==='refresh'){
          check('account:manage');
          const result=query.action==='check'?await context.modelServices.check(ownerId,query.body):
            {service:await context.modelServices.refresh(ownerId,query.serviceId)};
          check();return {box:await codec.seal('models-response',{requestId:query.requestId,result})};
        }
        if(query.action!=='sync'){
          check('account:manage');
          if(query.serviceId && !next.rows[query.serviceId])throw failure('FORBIDDEN',403);
          const {at,id}=query.version??{};
          if(!Number.isSafeInteger(at)||at<0||at>8640000000000000||typeof id!=='string'||!/^[\w-]{16,64}$/.test(id))throw failure('INVALID_REQUEST');
          const rowId=query.action==='select'?'default':query.serviceId;
          const current=next.rows[rowId];
          if(!current || newer({at,id},current)){
            const body=query.body??{};
            const service=context.accountState(ownerId).modelServices?.[query.serviceId];
            const requestId='sync-'+id;
            if(context.accountState(ownerId).modelServiceOperations?.[requestId]){/* The normal model operation already committed before a lost sync reply. */}
            else if(query.action==='select')await context.modelServices.select(ownerId,query.serviceId,{modelId:body.modelId});
            else if(query.action==='remove'){
              if(service?.status==='active')await context.modelServices.remove(ownerId,query.serviceId,{requestId,expectedRevision:service.revision});
            }else{
              await context.modelServices.configure(ownerId,{...body,requestId,...(service?{expectedRevision:service.revision}:{})},
                service?query.serviceId:undefined,true);
            }
            next=await readModelSnapshot(context,ownerId,prior);
            if(next.rows[rowId])next.rows[rowId]={...next.rows[rowId],at,id};
          }
        }
        check();
        if(JSON.stringify(next.rows)!==JSON.stringify(prior.rows)){
          const sealed=await codec.seal('models-source',{rows:next.rows});
          await context.serial(async()=>{check();await persist(JSON.stringify([issuer,sub]),sealed);});
        }
        check();
        const rows=Object.fromEntries(Object.entries(next.rows).filter(([key,row])=>query.known[key]?.at!==row.at||query.known[key]?.id!==row.id));
        return {box:await codec.seal('models-response',{requestId:query.requestId,rows,heads:settingsHeads(next.rows),local:next.local})};
      });
      pending.set(ownerId,work);
      try{return await work;}finally{if(pending.get(ownerId)===work)pending.delete(ownerId);}
    });
  };
}

export async function readModelSnapshot(context,ownerId,prior={rows:{}}){
  const list=context.visibleModels(ownerId,await context.backend.listModels({ownerId})), kinds=new Map(list.map(row=>[row.id,row.sourceKind]));
  const local=list.filter(row=>row.sourceKind==='local').map(row=>({profileId:row.id,name:row.name,requiresOnline:true}));
  const account=context.accountState(ownerId),rows={},live=[];
  for(const service of Object.values(account.modelServices??{})){
    const cloud=service.models.some(row=>kinds.get(row.profileId)==='cloud') || kinds.get(service.credentialProfileId)==='cloud';
    if(service.status!=='removed'&&!cloud&&!prior.rows[service.serviceId])continue;
    let value;
    if(service.status==='removed'||!cloud)value={serviceId:service.serviceId,removed:true};
    else{
      const models=cleanModels(service.models.filter(row=>!row.profileId||kinds.get(row.profileId)==='cloud'));
      const apiKey=await context.modelServices.secretFor(ownerId,service);
      if(!apiKey)throw failure('STORAGE_UNAVAILABLE',503);
      value={serviceId:service.serviceId,name:service.name,baseUrl:service.baseUrl,interfaceType:service.interfaceType,
        models,selectedModelId:service.selectedModelId,apiKey};
      live.push(...models.filter(row=>row.enabled&&row.profileId).map(row=>row.profileId));
    }
    const old=prior.rows[service.serviceId];
    rows[service.serviceId]=old&&JSON.stringify(old.value)===JSON.stringify(value)?old:
      {value,at:Math.max(Date.parse(service.updatedAt)||context.timestamp(),(old?.at??0)+1),id:randomUUID()};
  }
  const selected=account.defaultModelProfileId;
  const value=live.includes(selected)||local.some(row=>row.profileId===selected)?selected:live[0]??null;
  const old=prior.rows.default;
  rows.default=old&&old.value===value?old:{value,at:Math.max(Date.parse(account.modelDefaultUpdatedAt)||0,(old?.at??0)+1),id:randomUUID()};
  return {rows,local};
}
