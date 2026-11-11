import {failure} from '../personal-access/common.mjs';
const ID=/^[A-Za-z0-9_-]{1,128}$/;
export function phoneTurnIds(input) {
  if(!Array.isArray(input)||input.length>1000||input.some(id=>typeof id!=='string'||!ID.test(id))||new Set(input).size!==input.length)throw failure('INVALID_REQUEST');
  return input;
}
export function phoneMemoryState(context,ownerId,account,deviceId,requested=[]) {
  const wanted=new Set(phoneTurnIds(requested)),completed=[],sources=[];
  for(const job of context.accountState(ownerId).historyImports??[]) {
    if(job.app!=='phone'||job.phoneErasure)continue;
    for(const item of job.items) {
      if(!wanted.has(item.turnId)||!account.phoneOwners?.[item.id]?.includes(deviceId))continue;
      const row={turnId:item.turnId,sources:[...new Set(item.receipts.flatMap(r=>r.evidenceIds??[]))]};
      sources.push(row);
      if(job.state==='completed'&&item.done&&!item.deleted&&(!item.sourceRemoved||item.receipts.length>0)&&item.receipts.every(r=>r.done))completed.push(row);
    }
  }
  return {completed,sources,forgotten:(account.forgottenPhoneTurns??[]).filter(id=>wanted.has(id))};
}
export function authorizePhoneForget(context,ownerId,account,deviceId,ids,ownsFragment=()=>false) {
  phoneTurnIds(ids);if(ids.length>50)throw failure('INVALID_REQUEST');
  const owned=new Set(Object.keys(account.devices[deviceId]?.originals??{}));
  for(const job of context.accountState(ownerId).historyImports??[])for(const item of job.app==='phone'?job.items:[])
    if(account.phoneOwners?.[item.id]?.includes(deviceId))owned.add(item.turnId);
  if(ids.some(id=>!owned.has(id)&&!ownsFragment(id)))throw failure('FORBIDDEN',403);
}
