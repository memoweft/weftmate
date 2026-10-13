import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { durableWrite } from '../personal-access/store.mjs';
import { failure,plainObject } from '../personal-access/common.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=/^[A-Za-z0-9_-]{1,128}$/;
/** The existing private desktop content store holds pending source fragments.
 * Offline metadata never contains source text. Partial acknowledgments are not
 * turn receipts. Reassembly survives restart and is discarded on erasure. */
export async function createTurnFragments(root){
  const file=path.join(root,'phone-turn-fragments.json');let state;
  try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={version:1,owners:{}};}
  if(state.version!==1||!plainObject(state.owners))throw failure('STORE_CORRUPT',500);
  const save=()=>durableWrite(file,state);
  return {
    owns(ownerId,deviceId,conversationId){return Object.entries(state.owners[ownerId]?.rows??{}).some(([key,row])=>row.conversationId===conversationId&&key===hash(deviceId+':'+row.id));},
    async accept(ownerId,deviceId,generation,parts){
      if(!Array.isArray(parts)||parts.length>50)throw failure('INVALID_REQUEST');
      // Validate the entire packet before persisting any part.
      for(const p of parts)if(!plainObject(p)||Object.keys(p).some(k=>!['id','conversationId','timestamp','index','count','sha256','data','encoding'].includes(k))||
        !id.test(p.id)||!id.test(p.conversationId)||!Number.isSafeInteger(p.timestamp)||p.timestamp<0||
        !Number.isSafeInteger(p.index)||!Number.isSafeInteger(p.count)||p.count<1||p.index<0||p.index>=p.count||
        !/^[a-f0-9]{64}$/.test(p.sha256)||p.encoding!=='json-utf8-base64'||typeof p.data!=='string'||Buffer.from(p.data,'base64').toString('base64')!==p.data)throw failure('INVALID_REQUEST');
      const owner=state.owners[ownerId]??={generation,rows:{}};
      if(owner.generation!==generation){owner.generation=generation;owner.rows={};}
      const receipts=[],complete=[];
      for(const part of parts){const key=hash(deviceId+':'+part.id),descriptor={id:part.id,conversationId:part.conversationId,timestamp:part.timestamp,count:part.count,sha256:part.sha256};
        const row=owner.rows[key]??={...descriptor,parts:{}};
        if(JSON.stringify(descriptor)!==JSON.stringify(Object.fromEntries(Object.keys(descriptor).map(k=>[k,row[k]])))||row.parts[part.index]!==undefined&&row.parts[part.index]!==part.data)throw failure('REQUEST_CONFLICT',409);
        row.parts[part.index]=part.data;receipts.push({id:part.id,index:part.index,state:'received'});
        if(Object.keys(row.parts).length!==row.count)continue;
        const raw=Buffer.concat(Array.from({length:row.count},(_,i)=>Buffer.from(row.parts[i],'base64')));
        if(hash(raw)!==row.sha256)throw failure('REQUEST_CONFLICT',409);
        let turn;try{turn=JSON.parse(raw.toString('utf8'));}catch{throw failure('INVALID_REQUEST');}
        if(turn.id!==row.id||turn.conversationId!==row.conversationId||turn.timestamp!==row.timestamp)throw failure('REQUEST_CONFLICT',409);
        if(!complete.some(t=>t.id===turn.id))complete.push(turn);
      }
      await save();return {complete,receipts};
    },
    async acknowledged(ownerId,deviceId,ids){const owner=state.owners[ownerId];if(!owner)return;for(const id of ids)delete owner.rows[hash(deviceId+':'+id)];await save();},
    async clear(ownerId){delete state.owners[ownerId];await save();},
  };
}
