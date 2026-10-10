import { hasPrivateContent, memorySettings, validateMemorySettings } from './temporary-chats.mjs';
import { randomUUID } from 'node:crypto';
import { protectMainSession } from './chat-identity.mjs';
import { failure, plainObject, validId } from './common.mjs';
import { createMessageBranches } from './message-branches.mjs';

export function createSessionMetadata(context) {
  const index = new Map(), initializing = new Map(), descriptions = new Map();
  const key = (ownerId, sessionId) => `${ownerId}|${sessionId}`;
  function observe(ownerId, sessionId, events) {
    if (context.closing) return;
    let metadata;
    try { metadata = context.accountState(ownerId).sessions[sessionId]; } catch { return; }
    if (!metadata) return;
    const row = index.get(key(ownerId, sessionId)) ?? { latestMessageSeq: -1, updatedAt: null };
    for (const event of events) {
      if (metadata.forgottenSeqs?.includes(event.seq)) continue;
      if (event.type === 'assistant.message' && Number.isSafeInteger(event.seq)) row.latestMessageSeq = Math.max(row.latestMessageSeq, event.seq);
      if (Number.isFinite(Date.parse(event.at)) && (!row.updatedAt || event.at > row.updatedAt)) row.updatedAt = event.at;
    }
    index.set(key(ownerId, sessionId), row);
  }
  const requireSession = (ownerId, sessionId) => {
    const sessions = context.accountState(ownerId).sessions;
    if (!Object.hasOwn(sessions, sessionId)) throw failure('SESSION_UNAVAILABLE', 404);
    const session = sessions[sessionId];
    if (session.deleting) throw failure('SESSION_BUSY', 409);
    return session;
  };
  const name = value => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) throw failure('INVALID_REQUEST');
    return value.trim();
  };
  return {
    observe,
    // One startup pass, outside list requests. Native history observations then
    // maintain the index; metadata is always overlaid from the current account.
    initialize(ownerId) {
      if (initializing.has(ownerId)) return initializing.get(ownerId);
      const work = (async () => {
        for (const sessionId of Object.keys(context.accountState(ownerId).sessions)) {
          if (context.closing) break;
          if (index.has(key(ownerId, sessionId))) continue;
          try { const history = await context.callBackend(() => context.backend.readEvents({ownerId, sessionId, limit:200})); observe(ownerId, sessionId, history.events ?? []); }
          catch { /* The selected history read can repair an unavailable startup entry. */ }
        }
      })();
      initializing.set(ownerId, work); return work;
    },
    invalidate(ownerId, sessionId) { index.delete(key(ownerId, sessionId)); descriptions.delete(ownerId); },
    activityTime(ownerId, sessionId) { return index.get(key(ownerId,sessionId))?.updatedAt ?? context.accountState(ownerId).sessions[sessionId]?.attachedAt ?? ''; },
    async describe(ownerId, sessionIds) {
      const prior = descriptions.get(ownerId), now = Date.now();
      if (prior && now - prior.at < 250 && sessionIds.every(id => prior.ids.has(id))) return prior.promise;
      const ids = new Set(Object.keys(context.accountState(ownerId).sessions));
      const promise = context.callBackend(async () => typeof context.backend.describeSessions === 'function'
        ? context.backend.describeSessions([...ids], ownerId)
        : Promise.all(sessionIds.map(async id => { try { return await context.backend.describeSession(id, ownerId); } catch { return {sessionId:id,unavailable:true}; } })))
        .then(rows => new Map(rows.map(row => [row.sessionId,row])));
      descriptions.set(ownerId, {at:now,ids:typeof context.backend.describeSessions === 'function' ? ids : new Set(sessionIds),promise});
      try { return await promise; } catch (error) { descriptions.delete(ownerId); throw error; }
    },
    messageBranches: createMessageBranches(context),
    async metadata(ownerId, sessionId, patch) {
      protectMainSession(context.accountState(ownerId), sessionId);
      if (!plainObject(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !['pinned', 'unread', 'title', 'groupId', 'projectId', 'memoryMode', 'recallEnabled', 'autoDeleteDays'].includes(key)) ||
          ['pinned', 'unread'].some(key => patch[key] !== undefined && typeof patch[key] !== 'boolean') ||
          patch.groupId !== undefined && patch.groupId !== null && !validId(patch.groupId) ||
          patch.projectId !== undefined && patch.projectId !== null && !validId(patch.projectId) ||
          patch.projectId && patch.groupId) throw failure('INVALID_REQUEST');
      validateMemorySettings(patch);
      if (patch.title !== undefined) patch = { ...patch, title: name(patch.title) };
      return context.serial(async () => {
        const session = requireSession(ownerId, sessionId);
        if (patch.memoryMode !== undefined || patch.recallEnabled !== undefined || patch.autoDeleteDays !== undefined) {
          if (!['personal-remote', 'shared-chat'].includes(session.origin)) throw failure('SESSION_READ_ONLY', 409);
          if (patch.memoryMode === 'off') patch = { ...patch, hasTemporaryContent: true };
          if (patch.autoDeleteDays !== undefined || patch.memoryMode === 'off' && session.memoryMode !== 'off') {
            const days = patch.autoDeleteDays === undefined ? (session.autoDeleteDays === undefined ? 30 : session.autoDeleteDays) : patch.autoDeleteDays;
            patch = { ...patch, autoDeleteDays: days, expiresAt: days === null ? null : new Date(context.timestamp() + days * 86400000).toISOString() };
          }
          if (patch.memoryMode === 'on') patch = { ...patch, temporary: false, expiresAt: null };
        }
        if (patch.projectId !== undefined || patch.groupId && session.projectId) {
          if (!context.hostOwner(ownerId) || session.origin !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
          const project = patch.projectId ? context.accountState(ownerId).projects?.[patch.projectId] : null;
          if (patch.projectId && (!project || project.revoked)) throw failure('PROJECT_REVOKED', 409);
          const described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
          if (described?.running || Object.values(context.accountState(ownerId).commands).some(command =>
              command.sessionId === sessionId && ['pending', 'dispatching', 'uncertain'].includes(command.state))) throw failure('SESSION_BUSY', 409);
          patch = { ...patch, projectId: project?.projectId ?? null, projectRevision: project?.revision ?? null,
            ...(project ? { groupId: null } : {}),
            projectNotice: project ? `已移至项目「${project.name}」。从下一回合使用项目文件夹；之前的文件与经验留在原目录。`
              : '已移出项目。从下一回合使用本对话的独立工作目录；项目文件仍保留。' };
        }
        if (patch.groupId && !Object.hasOwn(context.accountState(ownerId).sessionGroups ?? {}, patch.groupId)) throw failure('NOT_FOUND', 404);
        validateMemorySettings(patch);
      if (patch.title !== undefined) {
          if (!context.backend.renameSession) throw failure('BACKEND_UNAVAILABLE', 503);
          const accepted = await context.callBackend(() => context.backend.renameSession({ ownerId, sessionId, title: patch.title }));
          patch = { ...patch, title: accepted.title };
        }
        // Snapshot the newest message while marking read, so a later completion
        // remains unread even when the running turn was opened earlier.
        if (patch.unread === false) {
          const history = await context.callBackend(() => context.backend.readEvents({ ownerId, sessionId, limit: 200 }));
          patch = { ...patch, readMessageSeq: Math.max(-1, ...(history.events ?? []).filter(event => event.type === 'assistant.message').map(event => event.seq)) };
        }
        await context.mutate(ownerId, next => {
          Object.assign(next.sessions[sessionId], patch);
          if (patch.projectId === null) { delete next.sessions[sessionId].projectId; delete next.sessions[sessionId].projectRevision; }
          if (patch.projectId) delete next.sessions[sessionId].workspaceKind;
        });
        return { sessionId, ...patch };
      });
    },
    async groups(ownerId, method, groupId, body) {
      if (method === 'GET') return { groups: Object.values(context.accountState(ownerId).sessionGroups ?? {}) };
      if (!plainObject(body) || Object.keys(body).some(key => key !== 'name') || method === 'DELETE' && Object.keys(body).length || method !== 'DELETE' && body.name === undefined) throw failure('INVALID_REQUEST');
      const label = method === 'DELETE' ? null : name(body.name);
      return context.serial(async () => {
        const groups = context.accountState(ownerId).sessionGroups ?? {};
        if (method !== 'POST' && !Object.hasOwn(groups, groupId)) throw failure('NOT_FOUND', 404);
        const key = method === 'POST' ? `group-${randomUUID()}` : groupId;
        await context.mutate(ownerId, next => {
          next.sessionGroups ??= {};
          if (method === 'DELETE') {
            delete next.sessionGroups[key];
            for (const session of Object.values(next.sessions)) if (session.groupId === key) session.groupId = null;
          } else next.sessionGroups[key] = { id: key, name: label };
        });
        return method === 'DELETE' ? { deleted: true, id: key } : { group: { id: key, name: label } };
      });
    },
    async fork(ownerId, sessionId) {
      protectMainSession(context.accountState(ownerId), sessionId);
      return context.serial(async () => {
        const source = requireSession(ownerId, sessionId);
        if (hasPrivateContent(source)) throw failure('TEMPORARY_CONTEXT_CONFIRMATION_REQUIRED', 409);
        if (!context.backend.forkSession) throw failure('BACKEND_UNAVAILABLE', 503);
        const described = await context.callBackend(() => context.backend.describeSession?.(sessionId, ownerId));
        if (described?.running || Object.values(context.accountState(ownerId).commands ?? {}).some(command => command.sessionId === sessionId &&
            ['pending', 'preflight', 'dispatching', 'uncertain'].includes(command.state))) throw failure('SESSION_BUSY', 409);
        const childId = `session-${randomUUID()}`;
        const result = await context.callBackend(() => context.backend.forkSession({ ownerId, sessionId, childId, modelProfileId: source.modelProfileId, title: source.title }));
        await context.mutate(ownerId, next => {
          next.sessions[childId] = { ownerId, origin: source.origin, modelProfileId: result.modelProfileId ?? source.modelProfileId,
            title: result.title, parentSessionId: sessionId, pinned: false, unread: false, readMessageSeq: result.latestSeq ?? -1,
            ...(source.groupId ? { groupId: source.groupId } : {}) };
          if (source.projectId) Object.assign(next.sessions[childId], { projectId: source.projectId, projectRevision: source.projectRevision });
        });
        return { sessionId: childId, title: result.title };
      });
    },
    async summary(ownerId, sessionId) {
      const metadata = requireSession(ownerId, sessionId);
      const row = index.get(key(ownerId, sessionId));
      const latestMessageSeq = row?.latestMessageSeq ?? -1;
      const activityTimes = [metadata.attachedAt, row?.updatedAt].map(value => Date.parse(value)).filter(Number.isFinite);
      return { ...memorySettings(metadata), pinned: metadata.pinned === true, unread: metadata.unread === true || latestMessageSeq > (metadata.readMessageSeq ?? -1),
        ...(activityTimes.length ? { updatedAt: new Date(Math.max(...activityTimes)).toISOString() } : {}),
        groupId: metadata.groupId ?? null, ...(metadata.title ? { title: metadata.title } : {}),
        ...(metadata.parentSessionId ? { parentSessionId: metadata.parentSessionId } : {}) };
    },
  };
}
