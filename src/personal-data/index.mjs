import path from 'node:path';
import { mkdir, readdir, readFile, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DATA_CATEGORIES, scanStatistics } from './statistics.mjs';
import { accountFiles, assertAccountPath, removeAccountPath, dataError } from './paths.mjs';
import { exportAccountFolder } from './export.mjs';
import { exactKeys, failure } from '../personal-access/common.mjs';
import { hasPrivateContent } from '../personal-access/temporary-chats.mjs';
import { reconcileChatIdentity } from '../personal-access/chat-identity.mjs';
import { activityState } from '../personal-access/activity-store.mjs';
import { createPersonalSyncStore } from '../personal-sync/index.mjs';
import { createAttachmentStore } from '../personal-sync/attachments.mjs';
import { createSharedAttachmentStore } from '../personal-access/shared-attachments.mjs';
import { durableWrite } from '../personal-access/store.mjs';

const TTL = 5 * 60 * 1000;
export function createDataControls(context) {
  const operations = new Map(), cached = new Map(), erasing = new Set();
  const accountRoot = owner => path.join(context.root, 'accounts', owner);
  const event = (owner, title, category, result) => context.activity.record(owner, { key: randomUUID(), type: 'system.data.operation', title,
    summary: `${DATA_CATEGORIES.find(row => row.id === category)?.name ?? '账户'} · ${result}`, level: result === '等待电脑确认' || title === '全部数据已导出' ? 'normal' : 'silent', initiatedBy: 'user', actions: [{kind:'view_settings',label:'查看数据与存储',target:{category:'data'}}] });
  const publicOperation = op => op ? { id: op.id, kind: op.kind, state: op.state, category: op.category, bytes: op.bytes ?? 0, completed: op.completed ?? 0,
    createdAt: op.createdAt, error: op.error, result: op.result, canCancel: ['pending_confirmation','running'].includes(op.state) && !op.committed } : null;
  const current = owner => operations.get(owner);
  function start(owner, kind, work, { pending = false, fields = {} } = {}) {
    if (['running','pending_confirmation'].includes(current(owner)?.state)) throw failure('CONFLICT', 409);
    const op = { id: randomUUID(), kind, state: pending ? 'pending_confirmation' : 'running', controller: new AbortController(), createdAt: new Date(context.timestamp()).toISOString(), ...fields };
    operations.set(owner, op);
    if (pending) void event(owner, '请在电脑确认数据操作', null, '等待电脑确认').catch(() => {});
    if (work) execute(owner, op, work);
    return publicOperation(op);
  }
  function execute(owner, op, work) {
    op.state = 'running';
    op.flight = (async () => {
      try {
        op.result = await work(op, op.controller.signal);
        if (['clean','delete'].includes(op.kind)) await scan(owner, op.controller.signal);
        op.state = 'completed';
        if (context.rootState.accounts[owner]?.account && op.kind !== 'scan') await event(owner, op.kind === 'export' ? '全部数据已导出' : op.kind === 'delete' ? '本账户数据已删除' : op.kind === 'close-account' ? '本机账户已移除' : '数据操作已完成', op.category, '完成');
      } catch (error) {
        op.state = op.controller.signal.aborted ? 'cancelled' : 'failed'; op.error = { code: error.code || 'STORAGE_UNAVAILABLE', category: op.category };
        if (context.rootState.accounts[owner]) await event(owner, '数据操作未完成', op.category, op.state === 'cancelled' ? '已取消' : '可重试').catch(() => {});
      } finally { erasing.delete(owner); }
    })();
  }
  async function sources(owner, { native = true, signal } = {}) {
    const root = accountRoot(owner); await mkdir(root, { recursive: true, mode: 0o700 });
    const result = [];
    for (const name of await readdir(root)) {
      await assertAccountPath(context.root, path.join(root,name));
      const category = ({ cache: 'cache', thumbnails: 'cache', offline: 'offline', logs: 'logs', diagnostics: 'logs', backups: 'backups', temporary: 'temporary', sync: 'files' })[name] ?? 'memory';
      result.push({ category, path: path.join(root, name), accountRoot: root });
    }
    const state = context.accountState(owner);
    result.push({ category: 'conversations', bytes: Buffer.byteLength(JSON.stringify(state)) });
    result.push({ category: 'memory', bytes: Buffer.byteLength(JSON.stringify(context.usage.exportAccount(owner))) });
    for (const name of ['artifacts','outputs']) { await assertAccountPath(context.root,path.join(context.root,name,owner)); result.push({ category: 'files', path: path.join(context.root, name, owner), accountRoot: path.join(context.root, name, owner) }); }
    const sync = context.syncRoot(owner);
    await assertAccountPath(context.root,sync);
    if (sync !== path.join(root, 'sync')) result.push({ category: 'files', path: sync, accountRoot: sync });
    const workspace = context.backend.accountWorkspaceRoot?.(owner);
    if (workspace) await assertAccountPath(path.dirname(context.root),workspace);
    if (workspace) result.push({ category: 'conversations', path: workspace, accountRoot: workspace });
    if (native && context.backend.sessionStorage) for (const sessionId of Object.keys(state.sessions)) {
      signal?.throwIfAborted();
      const storage = await context.backend.sessionStorage({ sessionId, ownerId: owner });
      result.push({ category: 'conversations', path: storage.root, accountRoot: storage.root, native: true });
    }
    return result;
  }
  async function scan(owner, signal) {
    const started = performance.now(), list = await sources(owner,{signal});
    const totals = await scanStatistics(list, signal);
    const snapshot = { measuredAt: new Date(context.timestamp()).toISOString(), durationMs: Math.round(performance.now() - started),
      categories: DATA_CATEGORIES.map(row => ({ ...row, ...totals[row.id] })), totalBytes: Object.values(totals).reduce((sum, row) => sum + row.bytes, 0),
      accounting: '按文件内容大小统计，与磁盘实际分配的空间可能不同。设置与用量只计本账户内容；整机日志、整机备份和外部项目原件不计入。' };
    cached.set(owner, snapshot); return snapshot;
  }
  async function clean(owner, category, signal) {
    const row = DATA_CATEGORIES.find(row => row.id === category && row.cleanable); if (!row) throw failure('INVALID_REQUEST');
    let bytes = 0;
    const now = context.timestamp();
    for (const source of await sources(owner, { native: false })) if (source.path) {
      for (const file of await accountFiles(source.accountRoot, source.path, signal)) {
        const effectiveCategory = file.path.endsWith('.display') ? 'cache' : file.path.endsWith('.tmp') ? 'temporary' : source.category;
        if (effectiveCategory !== category) continue;
        if (category === 'offline') {
          const metadata = file.path.endsWith('.json') ? await readFile(file.path,'utf8').then(JSON.parse).catch(()=>null) : null;
          if (!metadata?.expiresAt || Date.parse(metadata.expiresAt) > now || !Number.isFinite(Date.parse(metadata.expiresAt))) continue;
        }
        if (!row.pureCache && file.modifiedAt > now - (category === 'logs' ? 7 : 1) * 86400000) continue;
        signal.throwIfAborted(); await removeAccountPath(source.accountRoot, file.path); bytes += file.size;
      }
    }
    await event(owner, '清理已完成', category, '完成'); return { freedBytes: bytes };
  }
  async function* entries(owner, signal, op) {
    const state = context.accountState(owner), excluded = new Set(Object.entries(state.sessions).filter(([, row]) => hasPrivateContent(row) || row.deleting).map(([id]) => id));
    const exportedAttachments=new Set(), exportName=value=>path.basename(value).replace(/[<>:"|?*\x00-\x1f]/g,'_');
    yield { name: 'README.md', content: '# WeftMate 全部数据\n\nconversations：可读对话与结构化消息。\nmemory：MemoWeft Portable v4 记忆包。\nfiles：成果与附件原件。\nsettings：个性化与账户设置（不含密码）。\nusage：数值用量账本。\nmanifest.json：版本、排除类别及每个文件的大小和 SHA-256。manifest.sha256 校验清单。\n\n本地包未加密，请保存在可信磁盘。临时对话、已遗忘内容、凭据、其他账户和旧备份不在包内。项目原件仍留原处；有登记的成果会复制一份。旧备份和已经导出的文件需在原位置自行删除。\n', category: 'files' };
    for (const [sessionId, session] of Object.entries(state.sessions)) {
      if (excluded.has(sessionId)) continue;
      signal.throwIfAborted(); op.category = 'conversations';
      let afterSeq = -1; const messages = [];
      while (true) {
        const page = await context.backend.readEvents({ ownerId: owner, sessionId, afterSeq, limit: 200 });
        // Only visible user/assistant text. Tool parameters, injected context and thinking can contain credentials.
        messages.push(...(page.events ?? []).filter(row => ['user.message','assistant.message'].includes(row.type) && !session.forgottenSeqs?.includes(row.seq)).map(row => ({ seq: row.seq, type: row.type, at: row.at, text: row.data?.text ?? '', attachments: row.data?.attachments ?? [] })));
        signal.throwIfAborted(); if (!page.hasMore) break;
        if (page.nextSeq <= afterSeq) throw failure('MEMORY_RESPONSE_INVALID', 503); afterSeq = page.nextSeq;
      }
      yield { name: `conversations/${sessionId}.json`, content: { sessionId, title: session.title ?? '', messages }, category: 'conversations' };
      yield { name: `conversations/${sessionId}.md`, content: [`# ${session.title || '对话'}`, ...messages.map(row => `\n## ${row.type === 'user.message' ? '我' : 'WeftMate'}\n\n${row.text}`)].join('\n'), category: 'conversations' };
      for (const message of messages) for (const attachment of message.attachments) {
        if (!context.backend.readAttachment) continue;
        const attachmentKey=`${sessionId}/${attachment.id ?? attachment.attachmentId}`;if(exportedAttachments.has(attachmentKey))continue;exportedAttachments.add(attachmentKey);
        const original = await context.backend.readAttachment({ sessionId, ownerId: owner, attachmentId: attachment.id ?? attachment.attachmentId });
        if (original?.bytes) yield { name: `files/attachments/${sessionId}/${exportName((attachment.id ?? attachment.attachmentId) + '-' + (attachment.name || 'image'))}`, chunks: [original.bytes], category: 'files' };
      }
    }
    op.category = 'memory';
    if (context.memoryManager?.enabled) yield { name: 'memory/portable-v4.json', content: await context.memoryManager.portableExport(owner), category: 'memory' };
    const syncEvents = []; let syncAfter=0;
    while(true){const page=context.syncStores.get(owner).page({afterSeq:syncAfter,limit:200});syncEvents.push(...page.events);if(!page.hasMore)break;syncAfter=page.nextSeq;}
    const phoneIds=[...new Set(syncEvents.map(row=>row.conversationId))];
    for(const id of phoneIds){if(excluded.has(id))continue;const events=syncEvents.filter(row=>row.conversationId===id),title=events.find(row=>row.kind==='conversation.created')?.payload.title ?? '手机对话';
      yield {name:`conversations/phone-${id}.json`,content:{conversationId:id,title,events},category:'conversations'};
      yield {name:`conversations/phone-${id}.md`,content:[`# ${title}`,...events.filter(row=>row.kind==='message.created').map(row=>`\n## ${row.payload.role==='user'?'我':'WeftMate'}\n\n${row.payload.text}`)].join('\n'),category:'conversations'};
    }
    const settings = Object.fromEntries(['personalization','appearance','defaultApprovalMode','defaultModelProfileId','backgroundModelProfileId','notificationSettings'].filter(key => state[key] !== undefined).map(key => [key, state[key]]));
    settings.models=Object.values(state.accountModels ?? {}).map(row=>({name:row.name,...Object.fromEntries(['baseUrl','modelId'].map(key=>[key,row.revisions[String(row.runtimeRevision)]?.[key]]))}));
    settings.profile={username:state.account.username,displayName:state.account.displayName,avatar:state.account.avatar};
    yield { name: 'settings/settings.json', content: settings, category: 'memory' };
    yield { name: 'usage/ledger.json', content: context.usage.exportAccount(owner), category: 'memory' };
    let cursor;
    do {
      const params = new URLSearchParams({ limit: '200', ...(cursor ? { cursor } : {}) }), page = await context.library.list(owner, params);
      for (const item of page.items ?? []) if (item.exists && !excluded.has(item.source.sessionId)) {
        // Library already verifies source ownership and inode. Never delete these external originals.
        const detail = await context.library.detail(owner, item.id);
        if (detail.item?.exists !== false) yield { name: `files/results/${item.id}/${exportName(item.fileName)}`, chunks: createReadStream(item.location), category: 'files' };
      }
      cursor = page.nextCursor;
    } while (cursor);
    // Uploaded originals are in a header-framed store, not ordinary files.
    const attachments = context.attachmentStores.get(owner), syncRoot = context.syncRoot(owner);
    for (const name of await readdir(path.join(syncRoot, 'attachments')).catch(() => [])) if (name.endsWith('.image')) {
      const original = await attachments.get(name.slice(0, -6));
      if (excluded.has(original.conversationId)) continue;
      yield { name: `files/uploads/${original.meta.attachmentId}/${exportName(original.meta.name)}`, chunks: createReadStream(original.file, { start: original.offset }), category: 'files' };
    }
  }
  async function exportWork(owner,op,signal,destination,authorize=()=>{}) {
    const contentStamp = () => JSON.stringify([Object.keys(context.accountState(owner).commands),Object.entries(context.accountState(owner).sessions).map(([id,row])=>[id,row.temporary,row.hasTemporaryContent,row.forgottenSeqs]),context.accountState(owner).chatIdentity?.chats]);
    const before = contentStamp(), revision = context.memoryManager?.enabled ? (await context.memoryManager.query(owner,'query_world',{operation:'revision'})).world_revision : null;
    return exportAccountFolder({destination,entries:entries(owner,signal,op),signal,
      progress:value=>{op.bytes=value.bytes;op.category=value.category;},validate:async({publish=false}={})=>{
        authorize();if(context.accountState(owner).memoryCleanupPending || context.accountState(owner).dataErasure)throw failure('SESSION_BUSY',409);
        if(publish && (contentStamp()!==before || revision!==null && (await context.memoryManager.query(owner,'query_world',{operation:'revision'})).world_revision!==revision))throw failure('DATA_CHANGED',409);
      }});
  }
  async function erase(owner, kind, op, signal) {
    let state = context.accountState(owner);const inventory = await sources(owner,{signal});
    for (const source of inventory) if (source.path) await accountFiles(source.accountRoot, source.path, signal);
    signal.throwIfAborted(); erasing.add(owner);
    await context.serial(() => context.mutate(owner, next => {
      next.dataErasure = { operationId: op.id, kind, startedAt: new Date(context.timestamp()).toISOString() };
      if (next.memoryBackfillJob) next.memoryBackfillJob.state = 'cancelled';
      for (const command of Object.values(next.commands)) if (command.state==='pending') {command.state='rejected';command.errorCode='SESSION_UNAVAILABLE';command.updatedAt=new Date(context.timestamp()).toISOString();}
    }));
    await Promise.allSettled([...context.activeByCommand].filter(([key])=>key.startsWith(`${owner}|`)).map(([,flight])=>flight));
    await Promise.allSettled([...context.activeModelOperations].filter(([key])=>key.startsWith(`${owner}|`)).map(([,flight])=>flight));
    state=context.accountState(owner);
    // From here cancellation stops after a category, never reports partial erasure as success.
    op.committed = true; op.category = 'conversations';
    await event(owner,'开始删除',op.category,'处理中');
    for (const sessionId of Object.keys(state.sessions)) {
      await context.sessionOperations.deleteSession(owner, sessionId, { accountErasure: true }); op.completed++;
    }
    op.category = 'memory';
    await event(owner,'开始删除',op.category,'处理中');
    await context.memoryManager?.healthStore?.delete(owner);
    await context.memoryManager?.eraseAccount(owner, value => { op.completed += value.completed; });
    await context.offline.invalidate(owner);
    op.category = 'files';
    await event(owner,'开始删除',op.category,'处理中');
    await context.syncStores.get(owner)?.close();
    for (const source of inventory) if (source.path && !source.native) await removeAccountPath(source.accountRoot, source.path);
    // Revoke before resetting content. Offline generation is retained as a purge tombstone.
    for (const deviceId of Object.keys(state.devices)) if (deviceId !== op.deviceId) await context.cloudIdentity?.revokeLocalDevice(owner, deviceId);
    await context.cloudIdentity?.eraseLocalAccount?.(owner, kind === 'close-account', op.deviceId);
    op.category = 'memory'; await context.usage.eraseAccount(owner);
    const profileIds = Object.values(state.accountModels ?? {}).flatMap(row => Object.values(row.revisions ?? {}).map(revision => revision.profileId));
    const stageRefs=Object.values(state.modelOperations ?? {}).map(row=>row.stageRef).filter(Boolean);
    if (profileIds.length || stageRefs.length) await context.accountModelManager.disable({ownerId:owner,profileIds,stageRefs});
    // Shared migration preimages are rewritten by owner, never removed wholesale.
    const preimageFile=path.join(context.root,'chat-identity-v1.before.json');
    const preimage=await readFile(preimageFile,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(preimage?.accounts?.[owner]) {preimage.accounts[owner]={account:null,devices:{},sessions:{},commands:{},setupGrant:null,authLimits:{failures:0,lastFailureAt:0,lockUntil:0}};await durableWrite(preimageFile,preimage);}
    await context.clearRestoredCloudOwner(owner);
    await context.serial(() => context.mutateRoot(nextRoot => {
      if (kind === 'close-account') {
        delete nextRoot.accounts[owner];
        if (nextRoot.executionOwnerId === owner) delete nextRoot.executionOwnerId;
        // validateStore requires the legacy owner slot. Keep an empty non-login slot.
        if (nextRoot.legacyOwnerId === owner) nextRoot.accounts[owner] = { account: null, devices: {}, sessions: {}, commands: {}, setupGrant: null, authLimits: { failures: 0, lastFailureAt: 0, lockUntil: 0 } };
      } else {
        const profile = {...nextRoot.accounts[owner].account, avatar:null, displayName:nextRoot.accounts[owner].account.username}, devices = nextRoot.accounts[owner].devices;
        for (const id of Object.keys(devices)) if (id !== op.deviceId) delete devices[id];
        nextRoot.accounts[owner] = { account: profile, devices, sessions: {}, commands: {}, setupGrant: null, authLimits: { failures: 0, lastFailureAt: 0, lockUntil: 0 } };
        reconcileChatIdentity(nextRoot.accounts[owner], nextRoot.hostId, new Date(context.timestamp()).toISOString()); activityState(nextRoot.accounts[owner]);
      }
      nextRoot.onboarding = { step: 'welcome', completed: false, started: false, ...(kind === 'close-account' ? {} : {ownerId:owner}) };
    }));
    if (kind !== 'close-account') {
      await context.memoryManager?.markAccountErased(owner);
      context.syncStores.set(owner, await createPersonalSyncStore({ root: context.syncRoot(owner), ownerId: owner }));
      context.attachmentStores.set(owner, await createAttachmentStore({ root: path.join(context.syncRoot(owner), 'attachments') }));
      context.sharedAttachmentStores.set(owner, await createSharedAttachmentStore({ root: path.join(context.syncRoot(owner), 'shared-attachments') }));
    }
    return { deleted: true, requiresLogin: kind === 'close-account', onboarding: true,
      cloud: context.cloudIdentity ? '本机绑定已撤销；云账号身份需通过账户页输入密码注销，未执行前邮箱与云身份仍保留。' : '没有云端绑定。',
      external: '程序、其他账户、项目原件、整机备份及已经导出的外部文件保留。其他设备下次连接时清理离线副本。' };
  }
  async function handle(request, response, url, owner) {
    if (!/^\/personal\/v1\/data(?:\/|$)/.test(url.pathname)) return false;
    const auth = context.authenticate(request, request.method === 'GET' ? 'sessions:read' : 'account:manage');
    const desktop = request.headers['x-weftmate-desktop'] === context.libraryDesktopToken;
    if (url.search) throw failure('INVALID_REQUEST');
    const canManage = context.hostOwner(owner) && auth.via === 'cookie' && auth.device.scopes.includes('account:manage');
    const route = url.pathname.slice('/personal/v1/data'.length);
    const reply = (status, value) => { context.json(response, status, value); return true; };
    if (request.method === 'GET' && route === '') {
      const value = cached.get(owner);
      if ((!value || context.timestamp() - Date.parse(value.measuredAt) > TTL) && !['running','pending_confirmation'].includes(current(owner)?.state)) start(owner, 'scan', (op, signal) => scan(owner, signal));
      return reply(200, { statistics: value ?? null, operation: publicOperation(current(owner)), canManage, desktop, accountName: context.accountState(owner).account?.username ?? '', remoteConfirmation: !desktop });
    }
    if (request.method === 'GET' && route === '/operations') return reply(200, { operation: publicOperation(current(owner)), statistics: cached.get(owner) ?? null });
    if (request.method !== 'POST') throw failure('NOT_FOUND', 404);
    const body = await context.readJson(request);
    if (!canManage) throw failure('FORBIDDEN', 403);
    if (route === '/cancel') {
      exactKeys(body, ['id'], ['id']); const op = current(owner);
      if (!op || op.id !== body.id || op.committed) throw failure('CONFLICT', 409);
      op.controller.abort(); if (op.state === 'pending_confirmation') op.state = 'cancelled';
      return reply(200, { operation: publicOperation(op) });
    }
    if (route === '/scan') { exactKeys(body, [], []); return reply(202, { operation: start(owner, 'scan', (op, signal) => scan(owner, signal)) }); }
    if (route === '/clean') { exactKeys(body, ['category','confirm'], ['category']); const row = DATA_CATEGORIES.find(row => row.id === body.category && row.cleanable);
      if (!row || !row.pureCache && body.confirm !== true) throw failure('INVALID_REQUEST');
      return reply(202, { operation: start(owner, 'clean', (op, signal) => clean(owner, body.category, signal), { fields: { category: body.category } }) }); }
    if (['/export','/delete','/close-account'].includes(route)) {
      const kind = route.slice(1); exactKeys(body, ['accountName','confirm','destination'], kind === 'export' ? [] : ['accountName','confirm']);
      if (kind !== 'export' && (body.confirm !== true || body.accountName !== context.accountState(owner).account?.username)) throw failure('INVALID_REQUEST');
      if (!desktop) { if(body.destination!==undefined)throw failure('FORBIDDEN',403);return reply(202, { operation: start(owner, kind, null, { pending: true, fields: { deviceId: auth.deviceId } }) }); }
      const work = kind === 'export' ? (op, signal) => exportWork(owner,op,signal,body.destination,()=>context.authenticate(request,'account:manage'))
        : (op, signal) => erase(owner, kind, op, signal);
      return reply(202, { operation: start(owner, kind, work, { fields: { deviceId: auth.deviceId, bytes: 0, destination: body.destination } }) });
    }
    if (route === '/confirm') {
      exactKeys(body, ['id','accountName','confirm','destination'], ['id','confirm']);
      const op = current(owner);
      if (!desktop || !op || op.id !== body.id || op.state !== 'pending_confirmation' || body.confirm !== true) throw failure('FORBIDDEN',403);
      if (op.kind !== 'export' && body.accountName !== context.accountState(owner).account?.username) throw failure('INVALID_REQUEST');
      op.deviceId = auth.deviceId; op.bytes = 0; op.destination = body.destination;
      execute(owner, op, op.kind === 'export' ? (job, signal) => exportWork(owner,job,signal,body.destination,()=>context.authenticate(request,'account:manage')) : (job, signal) => erase(owner, op.kind, job, signal));
      return reply(202, { operation: publicOperation(op) });
    }
    throw failure('NOT_FOUND',404);
  }
  return { handle, sources, scan, clean, entries, nativeOperation: (owner,id) => id===undefined || current(owner)?.id === id ? publicOperation(current(owner)) : null, isErasing: owner => erasing.has(owner), isLocked: owner => erasing.has(owner) || Boolean(context.rootState.accounts[owner]?.dataErasure),
    invalidate: owner => cached.delete(owner), async close() { for (const op of operations.values()) if (!op.committed) op.controller.abort(); await Promise.allSettled([...operations.values()].map(op => op.flight)); } };
}
