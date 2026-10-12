import { failure } from './common.mjs';
import { handlePersonalMemoryHttp } from '../personal-memory/http.mjs';
import { memoryDigestState, recordDigestMutation } from './memory-digest.mjs';

export function createMemoryHttpHandler(context) {
  async function handleMemoryHttp(request, response, url, pathname, ownerId, deviceId) {
    const mutation = ['POST', 'PATCH', 'DELETE'].includes(request.method);
    const current = context.authenticate(request, mutation ? 'account:manage' : 'sessions:read');
    if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
    if (context.memoryManager === null) {
      if (request.method === 'GET' && !url.search && pathname === '/personal/v1/memory/status') {
        return context.json(response, 200, { state: 'disabled', worldRevision: null,
          ownerId,
          ...context.historyImport.list(ownerId),
          capabilities: { list: false, source: false, correct: false, mute: false,
            inject: false, deleteEvidence: false, deleteWorldItem: false } });
      }
      throw failure('MEMORY_DISABLED', 503);
    }
    if (pathname === '/personal/v1/memory/backfill') {
      if (url.search) throw failure('INVALID_REQUEST');
      if (request.method === 'GET') return context.json(response, 200, { ownerId, ...await context.memoryIngestion.preview(ownerId) });
      if (request.method === 'POST') {
        const body = await context.readJson(request, context.historyImport.requestLimit(ownerId));
        if (body.action === 'import-preview') {
          if (request.headers['x-weftmate-desktop'] !== context.libraryDesktopToken) throw failure('IMPORT_NATIVE_SELECTION_REQUIRED', 403);
          const preview = await context.historyImport.preview(ownerId, body.app, body.paths);
          const current = context.authenticate(request, 'account:manage');
          if (current.ownerId !== ownerId) throw failure('UNAUTHORIZED', 401);
          return context.json(response, 200, { ownerId, ...preview });
        }
        if (body.action?.startsWith('import-')) return context.json(response, 202, { ownerId,
          ...await context.historyImport.action(ownerId, { ...body, action: body.action.slice(7) }) });
        return context.json(response, 202, { ownerId, ...await context.memoryIngestion.action(ownerId, body) });
      }
      throw failure('METHOD_NOT_ALLOWED', 405);
    }
    if (request.method === 'DELETE') await context.offline?.invalidate(ownerId);
    const match=/\/memory\/(?:items\/(?<kind>cognition|entity|relationship|event)|(?<evidence>evidence))\/(?<id>[^/]+)(?:\/(?<action>correct))?$/.exec(pathname);
    const target=match?{...match.groups,kind:match.groups.kind??'evidence'}:null;
    let body, pending;
    if(target && (request.method==='DELETE'||request.method==='POST'&&target.action==='correct')){
      body=await context.readJson(request);
      const keys=target.kind==='evidence'?[]:[`${target.kind}:${decodeURIComponent(target.id)}`];
      if(request.method==='DELETE')try{const preview=await context.memoryManager.query(ownerId,'preview_forget',{target_kind:target.kind,target_id:decodeURIComponent(target.id)});
        if(Array.isArray(preview.items))keys.push(...preview.items.map(row=>`${row.object_kind}:${row.item_id}`));
      }catch{/* The established command path decides availability. */}
      pending={requestId:body?.requestId,operation:request.method==='DELETE'?'delete':'correct',keys,at:new Date(context.timestamp()).toISOString()};
    }
    let result;
    try{result = await handlePersonalMemoryHttp({ manager: context.memoryManager,
      ownerId, request, pathname, url, readJson:pending?async()=>body:context.readJson });}
    finally{if(pending&&typeof pending.requestId==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(pending.requestId))await context.serial(()=>context.mutate(ownerId,next=>{
      const state=memoryDigestState(next);state.pending??={};state.pending[pending.requestId]??=pending;
    }));}
    const receipt=result.body?.receipt;
    if(receipt){context.activity.memoryDigest.invalidate(ownerId);await context.serial(()=>context.mutate(ownerId,next=>{
      const state=memoryDigestState(next),operation=state.pending?.[receipt.requestId];
      if(operation&&receipt.state==='applied')recordDigestMutation(next,operation);
      if(['applied','no_change','revision_conflict','rejected'].includes(receipt.state)&&state.pending)delete state.pending[receipt.requestId];
    }));}
    if(mutation&&receipt?.state==='applied')await context.activity.refresh(ownerId);
    if (mutation && /\/(correct|mute)$/.test(pathname) && result.status < 300) await context.offline?.invalidate(ownerId);
    if (result.body?.sources) for (const source of result.body.sources) {
      const imported = context.historyImport.source(ownerId, source.evidenceId);
      if (imported) source.importSource = imported;
    }
    if (result.body?.items) for (const item of result.body.items) {
      item.importSources = (item.sourceEvidenceIds ?? []).map(id=>context.historyImport.source(ownerId,id)).filter(Boolean);
      delete item.sourceEvidenceIds;
      item.sourceConversationIds = item.sourceConversationIds?.filter(id => !id.startsWith('import-'));
    }
    return context.json(response, result.status, { ownerId, ...result.body,
      ...(pathname === '/personal/v1/memory/status' ? { ...context.memoryIngestion.status(ownerId), ...context.historyImport.list(ownerId) } : {}) });
  }
  return { handleMemoryHttp };
}
