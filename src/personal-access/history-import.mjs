import { randomUUID, createHash } from 'node:crypto';
import { importApps, sourceFiles, readHistory, importKey } from './history-parsers.mjs';
import { defaultUsagePrice, usageCost } from './usage.mjs';
import { currentChatProfile } from '../background-model-selection.mjs';
import { failure } from './common.mjs';
import { MAX_BODY } from './constants.mjs';
import { phoneTurnKey } from './phone-history.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const terminal = state => ['applied', 'completed', 'no_change', 'done', 'succeeded'].includes(state);
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
export function importChunks(c) {
  const chunks = []; let text = '';
  for (const m of c.messages) {
    const label = `\n[${m.at ?? c.at ?? '日期不明'} · ${m.role === 'user' ? '用户' : '助手'}]\n`, room=16000-label.length;
    for (let p = 0; p < m.content.length; p += room) {
      const part = label+m.content.slice(p,p+room);
      if (text.length + part.length > 16000 && text) { chunks.push(text); text = ''; }
      text += part;
    }
  }
  if (text && c.messages.some(m => m.role === 'user')) chunks.push(text);
  return c.messages.some(m => m.role === 'user') ? chunks : [];
}
export function importBoundary(c, job, chunk, index) {
  const content = `[WeftMate 历史导入；来源 ${importApps[c.app]}${c.deviceName ? `（${c.deviceName}）` : ''}；原对话 ${c.id}；原始时间 ${c.at ?? '日期不明'}]\n` +
    '以下是过去的聊天记录，仅整理用户本人说过的事实、偏好与决定。助手的话只是上下文。相对日期以原始时间为准；过去的计划与行程不能当作今天的事实或新任务。日期不明时不要推定发生时间。\n' + chunk;
  const payload = { schema_version: 1, provider_name: 'memoweft', parent_session_id: job.routeId,
    result_session_id: job.routeId, mode: 'turn', source_messages: [{ role: 'user', content, source_ref: 'source:0',
      message_id: `${job.id}:${(c.app === 'phone' ? phoneTurnKey({id:c.turnId}) : importKey(c)).slice(0, 32)}:${index}`, ...(c.at ? { timestamp: Math.floor(Date.parse(c.at) / 1000) } : {}) }] };
  // A native phone turn already supplies its human/assistant roles. Keep those
  // roles on bounded turns rather than describing both as one new human speech.
  // Source app/device/date remain in the same import provenance map and receipts.
  if(c.app==='phone'&&importChunks(c).length===1)payload.source_messages=c.messages.map((m,i)=>({
    role:m.role,content:m.content,source_ref:`source:${i}`,message_id:`${job.id}:${phoneTurnKey({id:c.turnId}).slice(0,32)}:${index}:${i}`,
    timestamp:Math.floor(Date.parse(m.at??c.at)/1000),...(m.role==='assistant'?{model_context_dependencies:{schema_version:1,
      capture_status:c.dependencyComplete?(c.memoryRefs?.length?'complete':'complete_empty'):'unavailable',
      world_items:(c.memoryRefs??[]).map(ref=>({object_kind:ref.kind,item_id:ref.id})),interaction_ids:[]}}:{})
  }));
  const payload_hash = digest(canonical(payload));
  return { ...payload, payload_hash, event_id: `weftmate-turn-boundary-v1:${digest(payload.source_messages[0].message_id).slice(0, 32)}:${payload_hash}` };
}
export function estimateImport(items, model, price = defaultUsagePrice(model)) {
  const characters = items.reduce((n, c) => n + c.characters, 0), chunks = items.reduce((n, c) => n + c.chunks, 0);
  const low = { inputTokens: Math.ceil(characters * .4) + chunks * 6000,
    cachedInputTokens: price && price.cachedInput < price.input ? chunks * 6000 : 0, outputTokens: chunks * 600 };
  const high = { inputTokens: Math.ceil(characters * 1.5) + chunks * 18000, cachedInputTokens: 0, outputTokens: chunks * 3000 };
  const local = model?.sourceKind === 'local' || model?.modelTier === 'local';
  return { characters, modelName: model?.name ?? model?.model ?? '尚未选择模型', profileId: model?.id ?? null,
    local, approximate: true, inputTokens: [low.inputTokens, high.inputTokens], outputTokens: [low.outputTokens, high.outputTokens],
    cost: price ? [usageCost(low, price), usageCost(high, price)] : null,
    seconds: [Math.ceil(low.outputTokens / 50), Math.ceil((high.inputTokens + high.outputTokens) / 50)], price };
}
/** Persistent refs and receipts only. The selected source is reread immediately before submission. */
export function createHistoryImport(context, { pollMs = 1000, read = readHistory } = {}) {
  const previews = new Map(); let timer, flight, closed = false;
  const jobs = ownerId => context.accountState(ownerId).historyImports ?? [];
  const now = () => new Date(context.timestamp()).toISOString();
  const save = (ownerId, work) => context.serial(() => context.mutate(ownerId, next => work(next.historyImports ??= [], next)));
  const stats = (ownerId, job) => {
    const records = context.usage.exportAccount(ownerId).records.filter(r => r.sessionId === job.routeId);
    const unpricedRequests=records.filter(r=>r.cost===null).length;
    return { requests: records.length, inputTokens: records.reduce((n, r) => n + (r.tokens?.inputTokens ?? 0), 0),
      outputTokens: records.reduce((n, r) => n + (r.tokens?.outputTokens ?? 0), 0),
      cost: unpricedRequests ? null : records.reduce((n, r) => n + (r.cost ?? 0), 0), unpricedRequests, unknownRequests: records.filter(r => !r.tokens).length };
  };
  const publicJob = (ownerId, job) => ({ id: job.id, app: job.app, appName: importApps[job.app], createdAt: job.createdAt,
    state: job.state, total: job.items.length, processed: job.items.filter(i => i.done).length,
    memoryCount: job.memoryCount ?? 0, skipped: job.skipped, error: job.error ?? null,
    waitingForChat: job.waitingForChat ?? false, usage: stats(ownerId, job),
    ...(job.app === 'phone' ? { deviceName: job.deviceName, handoverId: job.handoverId, from: job.from, to: job.to,
      conversationCount: new Set(job.items.map(i => i.id)).size, estimate: job.estimate,
      received: job.items.length, expectedTurns: job.expectedTurns, confirmationRequired: job.confirmationRequired } : {}) });
  const duplicates = ownerId => new Set(jobs(ownerId).filter(j => j.state !== 'forgotten').flatMap(j => j.items.filter(i => i.done || i.receipts.length).map(i => i.key)));
  async function modelFor(ownerId) {
    const catalog = (await context.backend.listModels({ ownerId })).filter(m => m.configured !== false);
    const state = context.accountState(ownerId), id = catalog.some(m => m.id === state.backgroundModelProfileId)
      ? state.backgroundModelProfileId : currentChatProfile(state, id => catalog.some(m => m.id === id));
    return catalog.find(m => m.id === id) ?? null;
  }
  const missingPhoneModel = (ownerId, job) => context.activity?.record(ownerId, {
    key: `phone-import:${job.id}:model-required`, type: 'memory.paused',
    title: '手机对话已保存，等电脑配好聊天模型后自动整理',
    summary: '去设置 → 模型服务添加聊天模型，配好后会自动继续。', level: 'silent',
  });
  async function preview(ownerId, app, paths) {
    const files = await sourceFiles(app, paths), imported = duplicates(ownerId), seen = new Set(), items = [];
    for (const file of files) for (const c of await read(app, file)) {
      const key = importKey(c); if (seen.has(key)) continue; seen.add(key);
      items.push({ key, file, id: c.id, fingerprint: c.fingerprint, title: c.title, at: c.at, until: c.until,
        ...(c.locator ? {locator:c.locator} : {}),
        characters: c.characters, chunks: importChunks(c).length, duplicate: imported.has(key) || imported.has(importKey({...c,fingerprint:c.legacyFingerprint})) });
    }
    const model = await modelFor(ownerId), id = randomUUID(), estimate = estimateImport(items.filter(i => !i.duplicate && i.chunks), model, context.usage.settings(ownerId).prices[model?.id] ?? defaultUsagePrice(model));
    previews.set(ownerId, { id, app, items, estimate });
    return { previewId: id, app, appName: importApps[app], conversationCount: items.length,
      duplicateCount: items.filter(i => i.duplicate).length, emptyCount: items.filter(i => !i.chunks).length,
      from: items.map(i => i.at).filter(Boolean).sort()[0] ?? null, to: items.map(i => i.until).filter(Boolean).sort().at(-1) ?? null,
      estimate, items: items.map(({ file: _file, fingerprint: _fingerprint, locator: _locator, ...i }) => i) };
  }
  async function action(ownerId, input) {
    if (!input || typeof input !== 'object' || !['start', 'confirm', 'pause', 'resume', 'cancel', 'forget-preview', 'forget'].includes(input.action) ||
        Object.keys(input).some(k => !['action', 'previewId', 'selected', 'confirm', 'jobId', 'forgetToken'].includes(k))) throw failure('INVALID_REQUEST');
    if (input.action === 'start') {
      if (jobs(ownerId).some(j => j.previewId === input.previewId)) return list(ownerId);
      const p = previews.get(ownerId);
      if (!p || p.id !== input.previewId || input.confirm !== true) throw failure('MEMORY_PREVIEW_REQUIRED', 409);
      let keys = input.selected;
      if (typeof keys === 'string') {
        const bytes = Buffer.from(keys, 'base64');
        if (bytes.length !== Math.ceil(p.items.length / 8) || bytes.toString('base64') !== keys ||
            p.items.length % 8 && bytes.at(-1) >>> (p.items.length % 8)) throw failure('INVALID_REQUEST');
        keys = p.items.filter((_, index) => bytes[index >> 3] & (1 << (index % 8))).map(item => item.key);
      }
      const knownKeys = new Set(p.items.map(item => item.key));
      if (!Array.isArray(keys) || keys.some(key => !knownKeys.has(key))) throw failure('MEMORY_PREVIEW_REQUIRED', 409);
      const selected = new Set(keys), model = await modelFor(ownerId);
      if (!model || model.id !== p.estimate.profileId) throw failure('IMPORT_MODEL_CHANGED', 409);
      context.usage.assertAllowed(ownerId, model);
      await save(ownerId, records => {
        if (records.some(j => ['running', 'paused', 'forgetting'].includes(j.state))) throw failure('IMPORT_JOB_ACTIVE', 409);
        const liveKeys=new Set(records.filter(j=>j.state!=='forgotten').flatMap(j=>j.items.filter(i=>i.done||i.receipts.length).map(i=>i.key)));
        const items = p.items.filter(i => selected.has(i.key) && !i.duplicate && !liveKeys.has(i.key) && i.chunks).map(({ title: _title, ...i }) => ({ ...i, cursor: 0, done: false, receipts: [] }));
        const id = randomUUID(); records.push({ id, previewId: p.id, routeId: `import-${id}`, app: p.app, createdAt: now(),
          state: items.length ? 'running' : 'completed', items, skipped: p.items.filter(i => selected.has(i.key) && (i.duplicate||liveKeys.has(i.key))).length,
          estimate: p.estimate, memoryCount: 0, failures: 0 });
      });
      previews.delete(ownerId); void tick().catch(() => {}); return list(ownerId);
    }
    const job = jobs(ownerId).find(j => j.id === input.jobId);
    if (!job) throw failure('MEMORY_JOB_NOT_FOUND', 404);
    if (input.action === 'confirm') {
      if (job.app !== 'phone' || job.state !== 'awaiting_confirmation' || input.confirm !== true) throw failure('MEMORY_PREVIEW_REQUIRED', 409);
      const model = await modelFor(ownerId); if (!model) throw failure('MODEL_UNAVAILABLE', 409);
      context.usage.assertAllowed(ownerId, model);
      await save(ownerId, records => { const j=records.find(j=>j.id===job.id); j.state='running'; j.confirmationRequired=false;
        j.estimate=estimateImport(j.items,model,context.usage.settings(ownerId).prices[model.id]??defaultUsagePrice(model)); });
      void tick().catch(()=>{}); return list(ownerId);
    }
    if (input.action === 'forget-preview') {
      if (['running', 'forgetting'].includes(job.state)) throw failure('IMPORT_PAUSE_REQUIRED', 409);
      const evidenceIds = job.items.flatMap(i => i.receipts.flatMap(r => r.evidenceIds ?? [])), items = new Map();
      const revision=await context.memoryManager.query(ownerId,'query_world',{operation:'revision'});
      for (const id of evidenceIds) try {
        const p = await context.memoryManager.query(ownerId, 'preview_forget', { target_kind: 'evidence', target_id: id });
        for (const i of p.items ?? []) items.set(`${i.object_kind}:${i.item_id}`, { kind: i.object_kind, id: i.item_id, text: i.name });
      } catch (e) { if (e.code !== 'evidence_not_found') throw e; }
      const token = digest(JSON.stringify([evidenceIds,revision.world_revision]));
      await save(ownerId, records => { const j=records.find(j => j.id === job.id);j.forgetToken = token;j.forgetWorldRevision=revision.world_revision; });
      return { jobId: job.id, forgetToken: token, items: [...items.values()], evidenceCount: evidenceIds.length };
    }
    if (input.action === 'forget') {
      if (input.confirm !== true || !job.forgetToken || input.forgetToken !== job.forgetToken || job.state === 'running') throw failure('MEMORY_PREVIEW_REQUIRED', 409);
      const revision=await context.memoryManager.query(ownerId,'query_world',{operation:'revision'});
      if(revision.world_revision!==job.forgetWorldRevision)throw failure('MEMORY_REVISION_CHANGED',409);
      await context.offline?.invalidate(ownerId);
      await save(ownerId, records => { const j=records.find(j => j.id === job.id);j.state = 'forgetting';j.forgetRequested=true; });
      void tick().catch(() => {}); return list(ownerId);
    }
    await save(ownerId, records => {
      const j = records.find(j => j.id === job.id);
      if (!['running', 'paused'].includes(j.state)) return;
      j.state = input.action === 'pause' ? 'paused' : input.action === 'cancel' ? 'cancelled' : j.forgetRequested ? 'forgetting' : 'running';
      if (input.action === 'resume') { j.failures = 0; j.error = null; j.retryAt = null; j.attemptLimit=(j.retryBaseline??0)+3;
        if(j.coreRetryJob)j.coreRetryRequestId??=`import-retry-${randomUUID()}`; }
    });
    void tick().catch(() => {}); return list(ownerId);
  }
  function list(ownerId) { return { imports: jobs(ownerId).filter(j=>!j.phoneErasure).map(j => publicJob(ownerId, j)) }; }
  function source(ownerId, evidenceId) {
    for (const j of jobs(ownerId)) for (const i of j.items) if (i.receipts.some(r => r.evidenceIds?.includes(evidenceId)))
      return { kind: 'import', app: j.app, appName: importApps[j.app], conversationId: i.id, originalAt: i.at, importId: j.id,
        ...(j.app==='phone'?{deviceName:j.deviceName,turnId:i.turnId}: {}) };
    return null;
  }
  function permit(ownerId, routeId) {
    if (!routeId?.startsWith('import-')) return true;
    const j = jobs(ownerId).find(j => j.routeId === routeId);
    return !closed && j?.state === 'running' && !context.dataControls?.isLocked(ownerId);
  }
  async function process(ownerId, job) {
    if (context.dataControls?.isLocked(ownerId) || context.accountState(ownerId).memoryCleanupPending) return;
    if (job.retryAt && Date.parse(job.retryAt) > context.timestamp()) return;
    if (job.state === 'forgetting') {
      for (const i of job.items) for (const r of i.receipts) for (const evidenceId of r.evidenceIds ?? []) {
        if (job.forgottenEvidence?.includes(evidenceId)) continue;
        const requestId = job.deleteRequests?.[evidenceId] ?? `import-forget-${digest(job.id + evidenceId).slice(0, 48)}`;
        let result;
        try { result=await context.memoryManager.receiptByRequest?.(ownerId,requestId); }
        catch(e) { if(e.code!=='command_receipt_not_found')throw e; }
        if(!result?.receipt) {
          const revision = await context.memoryManager.query(ownerId, 'query_world', { operation: 'revision' });
          result = await context.memoryManager.submitCommand(ownerId, { requestId,
            expectedWorldRevision: revision.world_revision, operation: 'delete_evidence', targetKind: 'evidence', targetId: evidenceId, payload: {}, deleteConversationSnippets: false });
        }
        if(result.receipt?.result_state==='revision_conflict') {
          await save(ownerId,records=>{(records.find(j=>j.id===job.id).deleteRequests??={})[evidenceId]=`import-forget-${randomUUID()}`;});return;
        }
        if(result.receipt?.storage_cleanup?.state==='pending')result=await context.memoryManager.retryCleanupByRequest(ownerId,requestId);
        const receipt = result.receipt;
        if (!['applied', 'no_change'].includes(receipt?.result_state)) throw failure('IMPORT_FORGET_FAILED', 409);
        if (receipt.storage_cleanup?.state === 'pending') throw failure('IMPORT_FORGET_CLEANUP_PENDING', 503);
        await save(ownerId, records => { (records.find(j => j.id === job.id).forgottenEvidence ??= []).push(evidenceId); });
      }
      const cleanup=await context.memoryManager.eraseConversationContext?.(ownerId, job.routeId);
      if(cleanup?.storage_cleanup?.state==='pending')throw failure('IMPORT_FORGET_CLEANUP_PENDING',503);
      await save(ownerId, records => { const j = records.find(j => j.id === job.id); if(j.state!=='forgetting')return;j.state = 'forgotten'; j.memoryCount = 0; j.error = null; });
      if(job.phoneErasure && job.originalImportId){
        await refreshCount(ownerId,job.originalImportId);
        await save(ownerId,records=>{const original=records.find(j=>j.id===job.originalImportId);if(original?.items.every(i=>i.deleted))original.state='forgotten';});
      }
      return;
    }
    if (job.countPending) await refreshCount(ownerId, job.id);
    const selectedModel = await modelFor(ownerId);
    if (job.app === 'phone') {
      if (!selectedModel) {
        if (job.state !== 'awaiting_confirmation' || job.confirmationRequired) {
          await save(ownerId, records => { const j=records.find(j=>j.id===job.id);
            if(!['running','awaiting_confirmation'].includes(j.state))return;
            j.state='awaiting_confirmation';j.confirmationRequired=false;j.error='电脑还没有可用的聊天模型，配好后会自动整理。'; });
          await missingPhoneModel(ownerId, job);
        }
        return;
      }
      if (job.state === 'awaiting_confirmation' || selectedModel.id !== job.estimate?.profileId) {
        await save(ownerId, records => { const j=records.find(j=>j.id===job.id);
          if(!['running','awaiting_confirmation'].includes(j.state))return;
          j.state='running';j.confirmationRequired=false;j.error=null;
          j.estimate=estimateImport(j.items.filter(i=>!i.done),selectedModel,context.usage.settings(ownerId).prices[selectedModel.id]??defaultUsagePrice(selectedModel)); });
      }
      if(!permit(ownerId,job.routeId))return;
    } else if (!selectedModel || selectedModel.id !== job.estimate.profileId) {
      await save(ownerId, records => { const j=records.find(j=>j.id===job.id);if(j.state!=='running')return;
        j.state='paused';j.error='后台模型已改变，请取消这次导入，重新选择文件查看用量后开始。'; });
      return;
    }
    const item = job.items.find(i => !i.done && !i.deleted);
    if (!item) {
      await save(ownerId, records => { const j=records.find(j=>j.id===job.id);if(j.state==='running')j.state = 'completed'; });
      if(job.app==='phone')await context.activity?.record(ownerId,{key:`phone-import:${job.id}:completed`,type:'memory.submission.completed',
        title:`已把手机上的 ${new Set(job.items.filter(i=>!i.deleted).map(i=>i.id)).size} 段对话整理进记忆`,summary:'原对话仍可查看。',level:'silent'});
      return;
    }
    // Chat has priority even before Core acceptance; the native scheduler also preempts formation.
    if (context.active.size || context.pendingPreflights?.size) {
      if (!job.waitingForChat) await save(ownerId, records => { records.find(j => j.id === job.id).waitingForChat = true; }); return;
    }
    if (job.waitingForChat) await save(ownerId, records => { records.find(j => j.id === job.id).waitingForChat = false; });
    const ledger = await context.memoryManager.query(ownerId, 'query_jobs', { operation: 'list' });
    if (job.coreRetryJob) {
      if(!permit(ownerId,job.routeId))return;
      const receipt=await context.memoryManager.query(ownerId, 'retry_formation', { job_id: job.coreRetryJob, request_id: job.coreRetryRequestId });
      if(typeof receipt.event_id!=='string')throw failure('IMPORT_RECEIPT_UNAVAILABLE',503);
      await save(ownerId, records => { const j=records.find(j=>j.id===job.id),r=j.items.find(i=>i.key===item.key).receipts.find(r=>!r.done);
        r.sourceEventId??=r.eventId;r.eventId=receipt.event_id;j.attemptLimit=3;delete j.coreRetryJob;delete j.coreRetryRequestId; }); return;
    }
    const pending = item.receipts.find(r => !r.done);
    if (pending) {
      const coreJob = (ledger.jobs ?? []).find(j => j.acceptance?.boundary_event_id === pending.eventId);
      if (!coreJob) throw failure('IMPORT_RECEIPT_UNAVAILABLE', 503);
      if (!pending.evidenceIds?.length && coreJob.acceptance?.evidence_ids?.length) await save(ownerId, records => {
        records.find(j => j.id === job.id).items.find(i => i.key === item.key).receipts.find(r => r.eventId === pending.eventId).evidenceIds = coreJob.acceptance.evidence_ids;
      });
      const state = coreJob.worker?.state;
      if (terminal(state)) {
        await save(ownerId, records => {
          const j = records.find(j => j.id === job.id), i = j.items.find(i => i.key === item.key), r = i.receipts.find(r => r.eventId === pending.eventId);
          r.done = true; i.cursor++; i.done = i.cursor >= i.chunks; j.countPending = true; j.failures = 0; j.error = null;j.attemptLimit=3;j.retryBaseline=0;
        });
        await refreshCount(ownerId, job.id); return;
      }
      if (['dead', 'failed', 'blocked', 'uncertain'].includes(state) || state==='retry' && coreJob.worker?.attempts >= (job.attemptLimit??3)) {
        await save(ownerId, records => { const j = records.find(j => j.id === job.id); if(j.state!=='running')return;j.state = 'paused'; j.error = '模型连续未能读完，已暂停。检查模型后可继续。';j.retryBaseline=coreJob.worker?.attempts??0;
          if(state==='dead'){j.coreRetryJob = coreJob.job_id;delete j.coreRetryRequestId;} });
      }
      return;
    }
    // A source edit requires another preview and explicit start; never silently import a changed file.
    const c = job.app === 'phone' ? context.phoneHistory.read(ownerId,item.key)
      : (await read(job.app, item.file, item.locator)).find(c => importKey(c) === item.key || importKey({...c,fingerprint:c.legacyFingerprint})===item.key);
    if (!c) throw failure('IMPORT_SOURCE_CHANGED', 409);
    const chunks = importChunks(c), boundary = importBoundary({...c,fingerprint:item.fingerprint}, job, chunks[item.cursor], item.cursor);
    const accepted = (ledger.jobs ?? []).find(j => j.acceptance?.boundary_event_id === boundary.event_id);
    if (!permit(ownerId, job.routeId) || jobs(ownerId).find(j=>j.id===job.id)?.items.find(i=>i.key===item.key)?.deleted) return;
    if (!accepted) await context.memoryManager.ingestImport(ownerId, boundary, job.routeId);
    const confirmed = accepted ?? (await context.memoryManager.query(ownerId, 'query_jobs', { operation: 'list' })).jobs?.find(j => j.acceptance?.boundary_event_id === boundary.event_id);
    if (!confirmed) throw failure('IMPORT_RECEIPT_UNAVAILABLE', 503);
    await save(ownerId, records => {
      const j = records.find(j => j.id === job.id), i = j.items.find(i => i.key === item.key);
      if (!i.receipts.some(r => r.eventId === boundary.event_id)) i.receipts.push({ eventId: boundary.event_id, evidenceIds: confirmed.acceptance.evidence_ids ?? [], done: false });
      j.failures = 0; j.error = null;
    });
  }
  async function refreshCount(ownerId, id) {
    const job = jobs(ownerId).find(j => j.id === id), evidence = new Set(job.items.flatMap(i => i.receipts.flatMap(r => r.evidenceIds ?? [])));
    let count = 0;
    for (const kind of ['cognition', 'entity', 'relationship', 'event']) {
      const world = await context.memoryManager.query(ownerId, 'query_world', { operation: 'list', object_kind: kind, include_history: true });
      count += (world.items ?? []).filter(i => i.provenance?.some(p => evidence.has(p.evidence_id))).length;
    }
    await save(ownerId, records => { const job=records.find(j => j.id === id);job.memoryCount = count;delete job.countPending; });
  }
  // A request already sent may finish after pause/cancel. Reconcile its receipt
  // without accepting another chunk or sending any model request.
  async function reconcileStopped(ownerId, job) {
    if (context.dataControls?.isLocked(ownerId) || context.accountState(ownerId).memoryCleanupPending) return;
    if (job.countPending) await refreshCount(ownerId, job.id);
    const ledger = await context.memoryManager.query(ownerId, 'query_jobs', { operation: 'list' });
    const completed = new Map((ledger.jobs ?? []).filter(j => terminal(j.worker?.state)).map(j => [j.acceptance?.boundary_event_id, j]));
    if (!job.items.some(i => i.receipts.some(r => !r.done && completed.has(r.eventId)))) return;
    let changed = false;
    await save(ownerId, records => {
      const current = records.find(j => j.id === job.id);
      if (!current || !['paused', 'cancelled'].includes(current.state)) return;
      for (const item of current.items) for (const receipt of item.receipts.filter(r => !r.done)) {
        const accepted = completed.get(receipt.eventId);
        if (!accepted) continue;
        receipt.evidenceIds = accepted.acceptance.evidence_ids ?? receipt.evidenceIds;
        receipt.done = true; item.cursor++; item.done = item.cursor >= item.chunks; current.countPending = true; changed = true;
      }
    });
    if (changed) await refreshCount(ownerId, job.id);
  }
  async function tick() {
    if (closed || !context.memoryManager) return;
    if (flight) return flight;
    flight = (async () => {
      for (const ownerId of Object.keys(context.rootState.accounts)) for (const j of jobs(ownerId).filter(j =>
        ['paused', 'cancelled'].includes(j.state) && (j.countPending || j.items.some(i => i.receipts.some(r => !r.done))))) {
        if (closed) break;
        await reconcileStopped(ownerId, structuredClone(j)).catch(() => {});
      }
      for (const ownerId of Object.keys(context.rootState.accounts)) for (const j of jobs(ownerId).filter(j => ['running', 'forgetting'].includes(j.state) || j.app==='phone' && j.state==='awaiting_confirmation')) {
        if (closed) break;
        const processingState=j.state;
        try { await process(ownerId, structuredClone(j)); }
        catch (e) {
          if (closed || context.closing) break;
          await save(ownerId, records => {
            const job = records.find(job => job.id === j.id);
            if(job.state!==processingState)return;
            job.failures = (job.failures ?? 0) + 1;
            job.failureCode = e.code ?? e.name ?? 'IMPORT_PROCESS_FAILED';
            job.retryAt = new Date(context.timestamp() + 2000 * 2 ** Math.min(job.failures, 6)).toISOString();
            job.error = job.forgetRequested ? '暂时未能彻底忘掉，正在重试。' : ['IMPORT_SOURCE_CHANGED', 'IMPORT_SOURCE_UNAVAILABLE'].includes(e.code) ? '原文件已移动或更改，请放回原文件后继续；也可以取消并重新选择。' : '暂时未能读完，正在等模型恢复。';
            if (job.failures >= 3 || ['IMPORT_SOURCE_CHANGED', 'IMPORT_SOURCE_UNAVAILABLE'].includes(e.code)) { job.state = 'paused'; job.error += ' 已暂停，可稍后继续。'; }
          });
        }
      }
    })().finally(() => { flight = null; });
    await flight;
  }
  async function receivePhone(ownerId, deviceName, turns, handover) {
    const model=await modelFor(ownerId), items=turns.map(turn=>{const c=context.phoneHistory.read(ownerId,phoneTurnKey(turn));return {
      key:phoneTurnKey(turn),id:turn.conversationId,turnId:turn.id,at:c.at,until:c.until,characters:c.characters,bytes:Buffer.byteLength(JSON.stringify(turn)),
      chunks:importChunks(c).length,cursor:0,done:false,receipts:[] };});
    let jobId;
    await save(ownerId,records=>{
      const seen=new Set(records.filter(j=>j.app==='phone').flatMap(j=>j.items.map(i=>i.key)));
      let job=records.find(j=>j.app==='phone'&&j.handoverId===handover.id);
      if (!job) { const id=randomUUID();job={id,routeId:`import-${id}`,app:'phone',deviceName,handoverId:handover.id,
        expectedTurns:handover.totalTurns,createdAt:now(),state:'receiving',items:[],skipped:0,memoryCount:0,failures:0};records.push(job); }
      for(const item of items)if(!seen.has(item.key)){job.items.push(item);seen.add(item.key);}else if(!job.items.some(i=>i.key===item.key))job.skipped++;
      jobId=job.id;
      if(job.state!=='receiving')return;
      job.estimate=estimateImport(job.items,model,context.usage.settings(ownerId).prices[model?.id]??defaultUsagePrice(model));
      job.from=job.items.map(i=>i.at).sort()[0]??null;job.to=job.items.map(i=>i.at).sort().at(-1)??null;
      if(handover.complete || job.items.length+job.skipped>=job.expectedTurns){
        job.items.sort((a,b)=>a.at.localeCompare(b.at)||a.turnId.localeCompare(b.turnId));
        job.confirmationRequired=false;
        job.state=!job.items.length?'completed':!model?'awaiting_confirmation':'running';
        if(!model)job.error='电脑还没有可用的聊天模型，配好后会自动整理。';
      }
    });
    const job=jobs(ownerId).find(j=>j.id===jobId);
    if(job.state==='awaiting_confirmation')await missingPhoneModel(ownerId,job);
    return {importId:jobId,state:job.state};
  }
  async function forgetPhone(ownerId, conversationIds) {
    // Stop new formation before collecting the already accepted durable sources.
    await save(ownerId,records=>{for(const j of records.filter(j=>j.app==='phone'))for(const i of j.items)if(conversationIds.includes(i.id))i.deleted=true;});
    await flight?.catch(()=>{});
    await save(ownerId,records=>{
      for(const original of [...records].filter(j=>j.app==='phone'&&!j.phoneErasure)) {
        const items=original.items.filter(i=>i.deleted&&conversationIds.includes(i.id));if(!items.length)continue;
        const id=`phone-forget-${digest(original.id+JSON.stringify(conversationIds)).slice(0,40)}`;
        if(records.some(j=>j.id===id))continue;
        records.push({...structuredClone(original),id,items:structuredClone(items),state:'forgetting',phoneErasure:true,originalImportId:original.id,forgetRequested:true,
          forgottenEvidence:[],deleteRequests:{},memoryCount:0,createdAt:now()});
        for(const item of items)item.done=true;
      }
    });
    await context.phoneHistory.remove(ownerId,conversationIds);
    void tick().catch(()=>{});
  }
  return { preview, action, list, source, permit, receivePhone, forgetPhone,
    requestLimit: ownerId => MAX_BODY + 2 * Math.ceil((previews.get(ownerId)?.items.length ?? 0) / 8),
    owns: (ownerId, routeId) => jobs(ownerId).some(j => j.routeId === routeId),
    async start() { timer = setInterval(() => void tick().catch(() => {}), pollMs); timer.unref?.(); },
    async close() { closed = true; previews.clear(); clearInterval(timer); await flight?.catch(() => {}); }, tick };
}
