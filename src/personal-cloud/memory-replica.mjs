import { createHash } from 'node:crypto';
import { failure } from '../personal-access/common.mjs';
import { hasPrivateContent } from '../personal-access/temporary-chats.mjs';
import { shareableMemory } from '../personal-offline/snapshot.mjs';
import { forgetPreviewView } from '../personal-memory/http.mjs';

const kinds = ['cognition','entity','relationship','event'];
const keyOf = (kind,id) => kind + ':' + id;
const stamp = value => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const validKey = key => typeof key === 'string' && /^(cognition|entity|relationship|event):[A-Za-z0-9._:-]{1,512}$/.test(key);
const changed = () => failure('MEMORY_REVISION_CHANGED',409);
const validNonce = value => typeof value === 'string' && /^[\w-]{16,64}$/.test(value);

function privateSessions(account) {
  return Object.entries(account.sessions ?? {}).filter(([,session])=>hasPrivateContent(session)).map(([id])=>id).sort();
}
async function readWorld(context, ownerId) {
  const manager = context.memoryManager;
  if (!manager?.enabled || context.dataControls?.isLocked(ownerId)) throw failure('MEMORY_UNAVAILABLE',503);
  const lists = await Promise.all(kinds.map(object_kind => manager.query(ownerId,'query_world',{operation:'list',object_kind,include_history:false})));
  const revision = lists[0].world_revision;
  if (!Number.isSafeInteger(revision) || lists.some(list => list.world_revision !== revision || !Array.isArray(list.items) || list.truncated || list.has_more || list.next_cursor || list.total>list.items.length)) throw changed();
  const account = context.accountState(ownerId);
  const privateIds=privateSessions(account), privateEvidence=new Set();
  if (privateIds.length) {
    const jobs=await manager.query(ownerId,'query_jobs',{operation:'list'});
    if (!Array.isArray(jobs.jobs) || jobs.world_revision!==revision) throw changed();
    for (const {acceptance} of jobs.jobs) {
      if (privateIds.includes(acceptance?.parent_session_id) || privateIds.includes(acceptance?.result_session_id))
        for (const id of acceptance.evidence_ids ?? []) privateEvidence.add(id);
    }
  }
  const rows = new Map();
  const retired = new Set((account.activity?.memoryDigest?.changes ?? []).filter(x => x.operation === 'delete').flatMap(x => x.keys).filter(validKey));
  for (const list of lists) for (const item of list.items) {
    const key = keyOf(item.object_kind,item.item_id);
    if (!validKey(key) || retired.has(key) || !shareableMemory(item)) continue;
    if (item.provenance.some(source => privateEvidence.has(source.evidence_id) || privateIds.includes(source.evidence?.conversation_id))) continue;
    const text = item.value.content ?? item.value.canonical_name;
    if (typeof text !== 'string' || !text.trim()) continue;
    const row = {key,text,updatedAt:item.updated_at};
    rows.set(key,{...row,stamp:stamp(row)});
  }
  return {revision,rows,retired:[...retired],privateIds};
}

async function preview(manager, ownerId, key) {
  const separator = key.indexOf(':');
  const raw = await manager.query(ownerId,'preview_forget',{target_kind:key.slice(0,separator),target_id:key.slice(separator+1)});
  const result = forgetPreviewView(raw);
  return {scope:result.forgetScope, keys:[...new Set([key,...result.items.map(row => keyOf(row.kind,row.id))])],
    evidenceCount:result.evidenceCount,revision:result.worldRevision};
}

function sharedPlan(plan,world) {
  const keys=plan.keys.filter(key=>!validKey(key) || world.rows.has(key));
  const scope=keys.length===plan.keys.length ? plan.scope : null;
  // A scope can keep the same IDs while a statement or a related fact changes.
  const impact=stamp([scope,keys.filter(validKey).sort().map(key=>[key,world.rows.get(key).stamp])]);
  return {scope,impact,keys,evidenceCount:plan.evidenceCount};
}
async function forgetFromReplica(context,identity,hostId,query,world,check,checkRevision) {
  const {issuer,sub,ownerId,deviceId}=identity;
  const manager=context.memoryManager;
  const {key,scope,impact,intentId} = query;
  if (!validKey(key) || typeof scope!=='string' || !/^forget-scope-v1:[a-f0-9]{64}$/.test(scope) || typeof impact!=='string' || !/^[\w-]{43}$/.test(impact) || !validNonce(intentId)) throw failure('INVALID_REQUEST');
  // Bind a retry to this account, source, target and originally confirmed impact.
  const requestId='sync-forget-'+stamp([issuer,sub,hostId,deviceId,key,scope,impact,intentId]);
  const separator=key.indexOf(':'),kind=key.slice(0,separator),id=key.slice(separator+1);
  const perform=(action,body)=>context.syncedMemoryCommand(ownerId,action,kind,id,requestId,body,()=>check('account:manage'));
  let receipt;
  try { receipt = (await perform('receipt')).body.receipt; }
  catch (error) { if (error.code!=='NOT_FOUND') throw error; }
  if (!receipt) {
    if (world.retired.includes(key)) {
      check('account:manage');
      return {state:'already-removed'};
    }
    if (!world.rows.has(key)) {
      // A private or muted item is not proof of deletion. Ask the owning store.
      try { await manager.query(ownerId,'query_world',{operation:'get',object_kind:kind,item_id:id,include_history:true}); }
      catch (error) {
        if (error.code!=='world_item_not_found') throw error;
        await checkRevision();check('account:manage');
        return {state:'already-removed'};
      }
      throw failure('MEMORY_SCOPE_REVIEW',409);
    }
    const plan=await preview(manager,ownerId,key);
    if (plan.revision!==world.revision) throw changed();
    const shared=sharedPlan(plan,world);
    if (shared.scope!==scope || shared.impact!==impact)
      throw failure('MEMORY_SCOPE_REVIEW',409);
    await checkRevision();
    const action=await perform('delete',{requestId,expectedWorldRevision:world.revision,forgetScope:scope});
    receipt=action.body?.receipt;
    if (!receipt) throw failure(action.body?.error?.code || 'MEMORY_UNAVAILABLE',action.status);
  }
  if (receipt.storageCleanup?.state==='pending') receipt=(await perform('cleanup')).body.receipt;
  if (!['applied','no_change'].includes(receipt.state)) throw failure('MEMORY_SCOPE_REVIEW',409);
  if (receipt.storageCleanup?.state!=='complete') throw failure('MEMORY_UNAVAILABLE',503);
  return {state:'applied'};
}

// The memory service owns revision checks, deletion, physical cleanup and command receipts.
export function createMemoryExchange(context, hostId, authorize, withCodec) {
  const pending=new Map();
  return async function exchange(request,box) {
    const identity = authorize(request);
    const {issuer,sub,ownerId,deviceId,keyId} = identity;
    let world;
    const check = (scope='sessions:read') => {
      const now = authorize(request,scope);
      if (context.dataControls?.isLocked(ownerId) || world && JSON.stringify(privateSessions(context.accountState(ownerId)))!==JSON.stringify(world.privateIds)) throw changed();
      if (now.issuer !== issuer || now.sub !== sub || now.ownerId !== ownerId || now.deviceId !== deviceId || now.keyId !== keyId) throw failure('UNAUTHORIZED',401);
    };
    return withCodec(issuer,sub,hostId,async codec => {
      let query;
      try { query = await codec.open('memory-request',box); } catch { throw failure('MEMORY_SYNC_INVALID',403); }
      if (query?.deviceId !== deviceId || !validNonce(query.requestId)) throw failure('MEMORY_SYNC_INVALID',403);
      const {op} = query;
      if (!['manifest','items','forget'].includes(op)) throw failure('INVALID_REQUEST');
      const manager = context.memoryManager;
      world = await readWorld(context,ownerId);
      let result;
      const checkRevision = async () => {
        const head = await manager.query(ownerId,'query_world',{operation:'revision'});
        if (head.world_revision !== world.revision) throw changed();
        check();
      };
      if (op === 'manifest') {
        result = {revision:world.revision,index:[...world.rows.values()].map(({key,stamp})=>({key,stamp})),retired:world.retired};
      } else if (op === 'items') {
        if (query.revision !== world.revision) throw changed();
        if (!Array.isArray(query.keys) || !query.keys.length || query.keys.length>16 || !query.keys.every(validKey)) throw failure('INVALID_REQUEST');
        const items=[];
        for (const key of query.keys) {
          const row=world.rows.get(key);
          if (!row) throw changed();
          const plan=await preview(manager,ownerId,key);
          if (plan.revision!==world.revision) throw changed();
          items.push({...row,plan:sharedPlan(plan,world)});
        }
        result={revision:world.revision,items};
      } else {
        const work=(pending.get(ownerId) ?? Promise.resolve()).catch(()=>{}).then(async()=>{
          check('account:manage');
          return forgetFromReplica(context,identity,hostId,query,world,check,checkRevision);
        });
        pending.set(ownerId,work);
        try { result=await work; }
        finally { if (pending.get(ownerId)===work) pending.delete(ownerId); }
      }
      if (op!=='forget') await checkRevision();
      check(op==='forget'?'account:manage':'sessions:read');
      return {box:await codec.seal('memory-response',{op,requestId:query.requestId,result})};
    });
  };
}
