import { accountPersonalization } from '../personal-access/personalization.mjs';
import { hasPrivateContent } from '../personal-access/temporary-chats.mjs';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { failure, plainObject } from '../personal-access/common.mjs';
import { durableWrite } from '../personal-access/store.mjs';
import { hash, publicDeviceKey, sealReplica, taskRecipient } from './crypto.mjs';
import { createOfflineTaskReceiver } from './tasks.mjs';
import { createTurnFragments } from './turn-fragments.mjs';
import { phoneTurnDigest } from '../personal-access/phone-history.mjs';
import { memorySnapshot, offlineBoundary, replicaDelta, REPLICA_LIMITS } from './snapshot.mjs';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
export async function createOfflineService(context) {
  const file = path.join(context.root, 'offline-metadata.json');
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { version: 1, owners: {} }; }
  if (state.version !== 1 || !state.owners) throw failure('STORE_CORRUPT', 500);
  const recipientFile=path.join(context.root,'cloud-identity','offline-task-recipient.json');
  let recipientWork;
  function recipient(){return recipientWork??=(async()=>{
    try{return JSON.parse(await readFile(recipientFile,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;const key=taskRecipient();await mkdir(path.dirname(recipientFile),{recursive:true,mode:0o700});await durableWrite(recipientFile,key);return key;}
  })();}
  const tasks=createOfflineTaskReceiver(context,recipient);
  const fragments=await createTurnFragments(context.root);
  let queue = Promise.resolve();
  const serial = fn => { const work = queue.then(fn); queue = work.catch(() => {}); return work; };
  const owner = id => state.owners[id] ??= { generation: 1, devices: {}, receipts: {} };
  const save = () => durableWrite(file, state);
  const publish = async ownerId => {
    const current = owner(ownerId);
    // An unavailable control plane must not issue an offline replica whose purge state cannot be checked.
    if (!context.cloudIdentity) throw failure('OFFLINE_CLOUD_REQUIRED', 409);
    return context.cloudIdentity.publishOffline(ownerId, current.generation);
  };
  async function cloudModel(ownerId) {
    const models = await context.backend.listModels();
    const preferred = context.service.currentChatModelProfile(ownerId);
    const selected = models.filter(m => m.configured && m.sourceKind === 'cloud' && context.modelSelectable(ownerId, m.id))
      .sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred))[0];
    if (!selected) throw failure('OFFLINE_MODEL_REQUIRED', 409);
    const model = await context.accountModelManager?.readOfflineModel?.({ ownerId, profileId: selected.id });
    if (!model?.apiKey || !model.baseUrl || !model.modelId) throw failure('OFFLINE_MODEL_REQUIRED', 409);
    return { ...model, profileId: selected.id, name: selected.name };
  }
  async function recent(ownerId) {
    const result = [];
    const cloudProfiles = new Set((await context.backend.listModels()).filter(model => model.sourceKind === 'cloud').map(model => model.id));
    for (const [sessionId, session] of Object.entries(context.accountState(ownerId).sessions).reverse()) {
      if (hasPrivateContent(session) || session.deleting || session.archived || !cloudProfiles.has(session.modelProfileId)) continue;
      const page = await context.backend.readEvents({ ownerId, sessionId, limit: 20 }).catch(() => null);
      const currentSession = context.accountState(ownerId).sessions[sessionId];
      if (!currentSession || hasPrivateContent(currentSession)) continue;
      const messages = (page?.events ?? []).filter(e => ['user.message', 'assistant.message'].includes(e.type) && typeof e.data?.text === 'string' &&
        (!owner(ownerId).purgedAt || Date.parse(e.at ?? e.timestamp ?? '') > owner(ownerId).purgedAt))
        .slice(-20).map(e => {
          const source=e.type==='user.message'&&Object.values(context.accountState(ownerId).commands??{}).find(c=>c.sessionId===sessionId&&c.receiptId===e.data.receiptId&&c.offlineSource);
          return {role:e.type==='user.message'?'user':'assistant',text:e.data.text.slice(0,4000),...(source?{offlineTaskId:source.offlineSource.id}:{})};
        });
      if (messages.length) result.push({ id: sessionId, messages, title:session.title||'最近对话', ...(session.projectId?{projectId:session.projectId}:{}) });
      if (result.length === REPLICA_LIMITS.conversations) break;
    }
    return result;
  }
  return {
    deviceStatus(ownerId,deviceId) {
      const account=state.owners[ownerId],device=account?.devices[deviceId];if(!device)return null;
      const imports=context.accountState(ownerId).historyImports??[];
      const originals=new Map(Object.entries(device.originals??{}));
      const partial=device.originalsPartial===true||device.originals===undefined;
      const hasPhoneHistory=device.phoneFirst&&Object.values(account.phoneOwners??{}).some(ids=>ids.includes(deviceId));
      if(partial&&hasPhoneHistory)for(const job of imports.filter(job=>job.app==='phone'))for(const item of job.items){
        if(!item.deleted&&account.phoneOwners[item.id]?.includes(deviceId))originals.set(item.turnId,{conversationId:item.id,importId:job.id});
      }
      const received=[...originals.values()];
      const jobs=imports.filter(job=>received.some(item=>item.importId===job.id));
      const pending=jobs.find(job=>!['completed','forgotten','cancelled'].includes(job.state));
      return {receivedOriginals:!partial||hasPhoneHistory?received.length:null,lastReceivedAt:device.lastReceivedAt??null,
        memoryState:pending?.state??(jobs.some(job=>job.state==='cancelled')?'cancelled':jobs.length?'completed':received.length?'submitted':'idle'),
        processed:jobs.reduce((n,job)=>n+job.items.filter(item=>item.done&&!item.deleted&&originals.has(item.turnId)).length,0),
        replicaPublishedAt:device.replicaPublishedAt??null};
    },
    generation: ownerId => owner(ownerId).generation,
    canDispatch:tasks.canDispatch,
    start: tasks.start,
    tasksTick: tasks.tick,
    async close(){await tasks.close();await queue;},
    invalidate(ownerId) { return serial(async () => {
      const current = owner(ownerId); current.generation++; current.receipts = {}; current.purgedAt = context.timestamp();
      for(const command of Object.values(context.accountState(ownerId).commands??{}))if(command.offlineSource&&command.receiptId&&context.backend.stopTask){
        await context.backend.stopTask({ownerId,sessionId:command.sessionId,requestId:'offline-forget-'+hash(command.commandId).slice(0,40),receiptIds:[command.receiptId],queuedOnly:true});
      }
      if(context.serial)await context.serial(()=>context.mutate(ownerId,next=>{
        for(const [id,command] of Object.entries(next.commands))if(command.offlineSource&&command.state==='pending')delete next.commands[id];
      }));
      // No recalled text or source text is kept here, including failed cleanup retries.
      for (const device of Object.values(current.devices)) { device.hashes = {}; device.originals={};device.originalsPartial=false; device.lastReceivedAt=null; device.replicaPublishedAt=null; }
      await save();
      await fragments.clear(ownerId);
      await context.memoryManager?.discardOfflinePending?.(ownerId);
      if (Object.keys(current.devices).length ||
          context.cloudIdentity?.cloudBackupSupported?.() === true && context.cloudIdentity.backupAccount?.(ownerId)) await publish(ownerId);
      return { generation: current.generation };
    }); },
    async handle(request, response, url, ownerId) {
      const route = url.pathname.slice('/personal/v1/offline'.length);
      if (request.method !== 'POST' || url.search || !['/sync', '/turns'].includes(route)) throw failure('NOT_FOUND', 404);
      const authorize=()=>{
        const auth=context.authenticate(request,request.headers?.authorization?'sessions:read':'account:manage');
        const channel=auth.via==='bearer'&&auth.device.authKind==='cloud'&&context.cloudIdentity?.validSession(ownerId,auth.deviceId);
        if(auth.ownerId!==ownerId||!auth.device.scopes.includes('account:manage')||auth.via!=='cookie'&&!channel||!['cloud','password','desktop'].includes(auth.device.authKind))throw failure('FORBIDDEN',403);
        return auth;
      };
      const current = authorize();
      // authenticate() enforces the native desktop boundary on every request;
      // offline publication must remain available when cloud login keeps the
      // independently usable local desktop Cookie.
      const body = await context.readJson(request, 256 * 1024);
      if (!plainObject(body)) throw failure('INVALID_REQUEST');
      const result = await serial(async () => {
        authorize();
        const account = owner(ownerId), deviceId = context.cloudIdentity?.offlineDeviceId?.(ownerId, current.deviceId) ?? current.deviceId;
        if (route === '/sync') {
          if (Object.keys(body).some(k => !['publicJwk', 'generation', 'hashes', 'taskSupport', 'phoneFirst'].includes(k)) || body.taskSupport !== undefined && body.taskSupport !== 1 || body.phoneFirst !== undefined && typeof body.phoneFirst !== 'boolean') throw failure('INVALID_REQUEST');
          if (!Number.isSafeInteger(body.generation) || body.generation < 0) throw failure('INVALID_REQUEST');
          if(body.phoneFirst===true&&!context.memoryManager?.enabled)throw failure('MEMORY_UNAVAILABLE',503);
          const publicJwk = publicDeviceKey(body.publicJwk);
          const control = await publish(ownerId);
          const taskSupport=body.taskSupport===1&&control.capabilities?.offlineTasks===1;
          let model;
          try { model = await cloudModel(ownerId); }
          catch (error) { if ((taskSupport || body.phoneFirst === true) && error.code === 'OFFLINE_MODEL_REQUIRED') model = null; else throw error; }
          const snapshot = model || body.phoneFirst === true ? await memorySnapshot(context.memoryManager, ownerId) : {worldRevision:null,items:[],truncated:false};
          // A legacy task-capable phone waits for memoryAuthority before it
          // uploads originals. Without a cloud model the snapshot read above
          // is skipped, so a cold worker otherwise never gets initialized.
          if (taskSupport && !model && context.memoryManager?.enabled) await context.memoryManager.status(ownerId);
          const generation = account.generation;
          const known = body.generation === generation ? body.hashes ?? {} : {};
          const recentMessages = model?await recent(ownerId):[];
          const taskReferences=body.taskSupport===1?Object.entries(context.accountState(ownerId).sessions).filter(([,s])=>s.origin==='personal-remote'&&!s.archived&&!s.deleting&&!hasPrivateContent(s)).slice(-100).map(([id,s])=>({id,title:s.title||'电脑上的对话',...(s.projectId?{projectId:s.projectId}:{})})):undefined;
          const metadata = { generation, reset: body.generation !== generation, model, recent: recentMessages,
            memoryAuthority: { ready: context.memoryManager?.enabled === true && context.memoryManager.peek?.(ownerId) === 'connected', hostId: context.rootState.hostId },
            phoneImports: (context.historyImport?.list(ownerId).imports??[]).filter(j=>j.app==='phone').map(j=>({id:j.id,handoverId:j.handoverId,state:j.state})),
            taskRecipient:(await recipient()).publicJwk,
            ...(taskReferences?{taskReferences}:{}),
            personalization: accountPersonalization(context.accountState(ownerId)), control, syncedAt: new Date(context.timestamp()).toISOString() };
          let payload = { ...replicaDelta(snapshot, known), ...metadata };
          // Bound the resulting replica, not just this delta; otherwise small
          // incremental responses could grow an unbounded on-device snapshot.
          while (Buffer.byteLength(JSON.stringify({ ...payload, items: snapshot.items })) > REPLICA_LIMITS.bytes) {
            if (recentMessages.length) recentMessages.pop();
            else if (snapshot.items.length) snapshot.items.pop();
            else throw failure('BODY_TOO_LARGE', 413);
            snapshot.truncated = true;
            payload = { ...replicaDelta(snapshot, known), ...metadata };
          }
          authorize();
          account.devices[deviceId] = { ...account.devices[deviceId], publicJwk, keyId: hash(publicJwk), phoneFirst:body.phoneFirst === true || model === null,
            originals:account.devices[deviceId]?.originals??{},originalsPartial:account.devices[deviceId]?account.devices[deviceId].originalsPartial??!account.devices[deviceId].originals:false,replicaPublishedAt:metadata.syncedAt };
          await save();
          return sealReplica(payload, publicJwk, { ownerId, hostId: context.rootState.hostId, deviceId: current.deviceId });
        }
        if (Object.keys(body).some(k => !['generation', 'turns', 'handover', 'forgetConversations', 'turnFragments'].includes(k)) || !Array.isArray(body.turns) || body.turns.length > 50) throw failure('INVALID_REQUEST');
        if (!account.devices[deviceId] || body.generation !== account.generation) throw failure('OFFLINE_RESET_REQUIRED', 409);
        await publish(ownerId);
        if((body.turns.length||body.turnFragments?.length)&&!context.memoryManager?.enabled)throw failure('MEMORY_UNAVAILABLE',503);
        if(body.forgetConversations!==undefined){
          if(!Array.isArray(body.forgetConversations)||body.forgetConversations.length>50||body.forgetConversations.some(id=>!ID.test(id)))throw failure('INVALID_REQUEST');
          const ids=body.forgetConversations;
          // A phone can erase only conversations it previously submitted.
          if(ids.some(id=>!account.phoneOwners?.[id]?.includes(deviceId)&&!fragments.owns(ownerId,deviceId,id)))throw failure('FORBIDDEN',403);
          account.forgottenConversations??=[];
          for(const id of ids)if(!account.forgottenConversations.includes(id))account.forgottenConversations.push(id);
          for(const device of Object.values(account.devices))for(const [key,item]of Object.entries(device.originals??{}))if(ids.includes(item.conversationId))delete device.originals[key];
          await save();
          await context.historyImport.forgetPhone(ownerId,ids);
          // Publish the same erasure generation as every other memory mutation.
          account.generation++;account.purgedAt=context.timestamp();await fragments.clear(ownerId);await save();await publish(ownerId);
        }
        const handover=body.handover;
        if(handover!==undefined&&(!plainObject(handover)||!ID.test(handover.id)||!Number.isSafeInteger(handover.totalTurns)||handover.totalTurns<0||
          !Number.isSafeInteger(handover.conversationCount)||handover.conversationCount<0||typeof handover.complete!=='boolean'||
          handover.bytes!==undefined&&(!Number.isSafeInteger(handover.bytes)||handover.bytes<0)||
          Object.keys(handover).some(k=>!['id','totalTurns','conversationCount','bytes','complete'].includes(k))))throw failure('INVALID_REQUEST');
        const forgottenFragments=(body.turnFragments??[]).filter(p=>account.forgottenConversations?.includes(p.conversationId));
        const assembled=body.turnFragments?await fragments.accept(ownerId,deviceId,account.generation,body.turnFragments.filter(p=>!forgottenFragments.includes(p))):{complete:[],receipts:[]};
        for(const part of body.turnFragments??[]){account.phoneOwners??={};const owners=account.phoneOwners[part.conversationId]??=[];if(!owners.includes(deviceId))owners.push(deviceId);}
        if(body.turnFragments?.length)await save();
        body.turns.push(...assembled.complete);
        if(body.turns.length>50)throw failure('INVALID_REQUEST');
        const receipts = forgottenFragments.map(p=>({id:p.id,state:'forgotten'}));
        for (const turn of body.turns) {
          if (!turn || !ID.test(turn.id) || !ID.test(turn.conversationId) || !Number.isSafeInteger(turn.timestamp) || turn.timestamp < 0 ||
              !Array.isArray(turn.messages) || turn.messages.length < 1 || turn.messages.length > 2 || turn.messages[0]?.role !== 'user' ||
              turn.messages.some((m, i) => m.role !== (i === 0 ? 'user' : 'assistant') || typeof m.text !== 'string' || !m.text.trim() || m.text.length > 16384&&!assembled.complete.includes(turn))) throw failure('INVALID_REQUEST');
          if (turn.dependencyComplete !== undefined && typeof turn.dependencyComplete !== 'boolean' ||
              turn.memoryRefs !== undefined && (!Array.isArray(turn.memoryRefs) || turn.memoryRefs.length > 64 ||
                turn.memoryRefs.some(ref => !['cognition', 'entity', 'relationship', 'event', 'evidence'].includes(ref?.kind) ||
                  typeof ref.id !== 'string' || !/^[A-Za-z0-9._:-]{1,512}$/.test(ref.id)))) throw failure('INVALID_REQUEST');
          if (new Set((turn.memoryRefs ?? []).map(ref => `${ref.kind}:${ref.id}`)).size !== (turn.memoryRefs ?? []).length) throw failure('INVALID_REQUEST');
          if(account.forgottenConversations?.includes(turn.conversationId)){receipts.push({id:turn.id,state:'forgotten'});continue;}
          const phoneFirst=account.devices[deviceId].phoneFirst===true||!!handover||!!body.turnFragments;
          const receiptId = hash(phoneFirst?`phone:${turn.id}`:`${deviceId}:${turn.id}`), digest = phoneFirst?phoneTurnDigest(turn):hash(turn), prior = account.receipts[receiptId];
          if (prior && prior !== digest && prior !== hash(turn)) throw failure('REQUEST_CONFLICT', 409);
          if (!prior) {
            if (!context.memoryManager?.enabled) throw failure('MEMORY_UNAVAILABLE', 503);
            if(!phoneFirst){
              const ingest = await context.memoryManager.ingest(ownerId, offlineBoundary(deviceId, turn), { offline: true });
              if (ingest.state !== 'accepted') throw failure('MEMORY_UNAVAILABLE', 503);
              account.receipts[receiptId] = digest; await save();
            }
          }
          receipts.push({ id: turn.id, state: 'synced' });
        }
        const submitted=body.turns.filter(turn=>!account.forgottenConversations?.includes(turn.conversationId));
        if(submitted.length&&(account.devices[deviceId].phoneFirst===true||handover||body.turnFragments)){
          if(!context.memoryManager?.enabled)throw failure('MEMORY_UNAVAILABLE',503);
          const mapping=await context.phoneHistory.receive(ownerId,current.device.name||'手机',submitted);
          const batch=handover??{id:`legacy-${hash(deviceId+JSON.stringify(submitted.map(t=>t.id))).slice(0,48)}`,totalTurns:submitted.length,conversationCount:new Set(submitted.map(t=>t.conversationId)).size,complete:true};
          const imported=await context.historyImport.receivePhone(ownerId,current.device.name||'手机',submitted,batch);
          for(const turn of submitted){account.receipts[hash(`phone:${turn.id}`)]=phoneTurnDigest(turn);account.phoneOwners??={};
            const owners=account.phoneOwners[turn.conversationId]??=[];if(!owners.includes(deviceId))owners.push(deviceId);}
          await save();
          for(const receipt of receipts){const map=mapping.find(m=>m.id===receipt.id);if(map)Object.assign(receipt,map,{importId:imported.importId,memoryState:imported.state});}
        }
        const device=account.devices[deviceId];
        for(const turn of submitted){
          const receipt=receipts.find(item=>item.id===turn.id&&item.state==='synced');if(!receipt)continue;
          device.originals??={};
          if(!device.originals[turn.id]){device.originals[turn.id]={conversationId:turn.conversationId,...(receipt.importId?{importId:receipt.importId}:{})};device.lastReceivedAt=new Date(context.timestamp()).toISOString();}
        }
        await save();
        await fragments.acknowledged(ownerId,deviceId,receipts.map(r=>r.id));
        authorize();
        return { generation: account.generation, receipts, ...(assembled.receipts.length?{fragmentReceipts:assembled.receipts}:{}), ...(body.forgetConversations?{forgottenConversations:body.forgetConversations}:{}) };
      });
      authorize();
      if (route !== '/sync' && !result.receipts?.some(r=>r.importId)) for (const receipt of result.receipts ?? []) await context.activity?.record(ownerId, {
        key: `offline:${current.deviceId}:${receipt.id}`, type: 'memory.submission.completed', title: '手机对话已保存到电脑',
        summary: '离线对话已同步到电脑。', level: 'silent',
      });
      return context.json(response, 200, result);
    },
  };
}
