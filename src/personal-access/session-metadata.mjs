import { randomUUID } from 'node:crypto';
import { failure, plainObject, validId } from './common.mjs';

export function createSessionMetadata(context) {
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
    async metadata(ownerId, sessionId, patch) {
      if (!plainObject(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !['pinned', 'unread', 'title', 'groupId', 'projectId'].includes(key)) ||
          ['pinned', 'unread'].some(key => patch[key] !== undefined && typeof patch[key] !== 'boolean') ||
          patch.groupId !== undefined && patch.groupId !== null && !validId(patch.groupId) ||
          patch.projectId !== undefined && patch.projectId !== null && !validId(patch.projectId) ||
          patch.projectId && patch.groupId) throw failure('INVALID_REQUEST');
      if (patch.title !== undefined) patch = { ...patch, title: name(patch.title) };
      return context.serial(async () => {
        const session = requireSession(ownerId, sessionId);
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
      return context.serial(async () => {
        const source = requireSession(ownerId, sessionId);
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
      const history = await context.callBackend(() => context.backend.readEvents({ ownerId, sessionId, limit: 200 }));
      const latestMessageSeq = Math.max(-1, ...(history.events ?? []).filter(event => event.type === 'assistant.message').map(event => event.seq));
      return { pinned: metadata.pinned === true, unread: metadata.unread === true || latestMessageSeq > (metadata.readMessageSeq ?? -1),
        groupId: metadata.groupId ?? null, ...(metadata.title ? { title: metadata.title } : {}),
        ...(metadata.parentSessionId ? { parentSessionId: metadata.parentSessionId } : {}) };
    },
  };
}
