import { randomUUID } from 'node:crypto';
import { bounded, digest, exactKeys, failure, validId } from './common.mjs';
import { chatForSession } from './chat-identity.mjs';
import { REQUEST_ID } from './constants.mjs';

export function createChatOperations(context) {
  const pages = new Map();
  function requireChat(ownerId, chatId) {
    const account = context.accountState(ownerId);
    if (!account.chatIdentity) throw failure('CHAT_INITIALIZING', 503);
    const chat = account.chatIdentity.chats[chatId];
    if (!validId(chatId) || !chat) throw failure('CHAT_UNAVAILABLE', 404);
    return chat;
  }
  async function view(ownerId, chatId) {
    const chat = requireChat(ownerId, chatId), account = context.accountState(ownerId), identity = account.chatIdentity;
    const segment = identity.segments[chat.activeSegmentId], session = account.sessions[segment?.sessionId];
    const base = { chatId, kind: chat.kind, revision: chat.revision, contentRevision: chat.contentRevision,
      activeSegmentId: segment?.segmentId ?? null, activeSessionId: segment?.sessionId ?? null,
      timeZone: identity.timeZone, memoryMode: session?.memoryMode ?? 'on',
      parent: chat.kind === 'main' ? null : session?.projectId
        ? { kind: 'project', id: session.projectId } : { kind: 'main', id: identity.mainChatId } };
    if (!session) return { ...base, title: 'WeftMate', pinned: true, archived: false,
      unread: chat.unread, groupId: null, projectId: null, running: false, sendAvailable: false,
      taskAvailable: false };
    let described, summary;
    try {
      described = await context.callBackend(() => context.backend.describeSession(segment.sessionId, ownerId));
      if (!described) throw failure('SESSION_UNAVAILABLE', 404);
      summary = await context.sessionOperations.summary(ownerId, segment.sessionId);
    } catch { return { ...base, title: session.title ?? '', pinned: chat.kind === 'main' || session.pinned === true,
      archived: session.archived === true, unread: session.unread === true, groupId: session.groupId ?? null,
      projectId: session.projectId ?? null, running: false, sendAvailable: false, taskAvailable: false, unavailable: true }; }
    const project = account.projects?.[session.projectId];
    const canSend = !session.deleting && !session.archived && context.messageModelUsable(ownerId, session) &&
      (session.origin === 'personal-remote' && described.agentPreset === 'personal-remote' &&
        (!session.projectId || project?.revoked === false && project.revision === session.projectRevision &&
          described.modelProfileId === session.modelProfileId) &&
        (!session.workspaceKind || context.browserReader?.status()?.available === true && described.modelProfileId === session.modelProfileId) ||
       session.origin === 'shared-chat' && described.agentPreset === 'personal-shared-chat');
    return { ...base, ...summary, title: chat.kind === 'main' ? 'WeftMate' : summary.title ?? bounded(described.title, 256) ?? '',
      pinned: chat.kind === 'main' || summary.pinned, archived: session.archived === true,
      projectId: session.projectId ?? null, ...(project ? { projectName: project.name, projectRevoked: project.revoked } : {}),
      ...(session.projectNotice ? { projectNotice: session.projectNotice } : {}),
      ...(session.conversationId ? { conversationId: session.conversationId } : {}),
      ...(session.workspaceKind ? { workspaceKind: session.workspaceKind } : {}),
      modelProfileId: session.modelProfileId ?? described.modelProfileId ?? null,
      running: described.running === true, sendAvailable: Boolean(canSend), taskAvailable: session.origin === 'personal-remote',
      ...(described.contextUsage ? { contextUsage: described.contextUsage } : {}),
      ...(described.running && described.processing ? { processing: described.processing } : {}) };
  }
  return {
    requireChat, view,
    async metadata(ownerId, chatId, body) {
      exactKeys(body, ['requestId', 'expectedRevision', 'unread', 'title', 'pinned', 'groupId', 'projectId'], ['requestId', 'expectedRevision']);
      if (!REQUEST_ID.test(body.requestId ?? '') || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) throw failure('INVALID_REQUEST');
      const fingerprint = digest(JSON.stringify({ chatId, ...Object.fromEntries(Object.entries(body).sort(([a], [b]) => a.localeCompare(b))) }));
      return context.serial(async () => {
        const account = context.accountState(ownerId), prior = account.chatOperations?.[body.requestId];
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw failure('REQUEST_CONFLICT', 409);
          return structuredClone(prior.response);
        }
        if (context.requestIdUsed(account, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
        const chat = requireChat(ownerId, chatId);
        if (chat.kind !== 'main') throw failure('NOT_FOUND', 404); // Side writes retain the original session routes in 2.1.
        if (Object.keys(body).some(key => !['requestId', 'expectedRevision', 'unread'].includes(key))) throw failure('MAIN_CHAT_PROTECTED', 409);
        if (typeof body.unread !== 'boolean') throw failure('INVALID_REQUEST');
        if (body.expectedRevision !== chat.revision) throw failure('REVISION_CHANGED', 409);
        const projected = await view(ownerId, chatId);
        const response = { chat: { ...projected, unread: body.unread, revision: chat.revision + 1 } };
        await context.mutate(ownerId, next => {
          const current = next.chatIdentity.chats[chatId]; current.unread = body.unread; current.revision++;
          next.chatOperations ??= {};
          next.chatOperations[body.requestId] = { fingerprint, response };
        });
        return response;
      });
    },
    async main(ownerId) { return { chat: await view(ownerId, context.accountState(ownerId).chatIdentity?.mainChatId) }; },
    resolveSession(ownerId, sessionId) {
      const account = context.accountState(ownerId), chat = chatForSession(account, sessionId);
      if (!chat) throw failure('SESSION_UNAVAILABLE', 404);
      return { chatId: chat.chatId, segmentId: account.chatIdentity.sessionSegments[sessionId],
        kind: chat.kind, archived: account.sessions[sessionId].archived === true };
    },
    async list(ownerId, params) {
      const allowed = ['kind', 'parentKind', 'parentId', 'archived', 'q', 'cursor', 'limit'];
      if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw failure('INVALID_REQUEST');
      const limit = params.get('limit') ?? '50', kind = params.get('kind') ?? 'side', archived = params.get('archived') ?? 'false';
      const parentKind = params.get('parentKind'), parentId = params.get('parentId'), q = params.get('q') ?? '';
      if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 200 || kind !== 'side' ||
          !['true', 'false', 'all'].includes(archived) || parentKind && !['main', 'project'].includes(parentKind) ||
          parentId && !validId(parentId) || q.length > 256) throw failure('INVALID_REQUEST');
      const filter = JSON.stringify({ kind, archived, parentKind, parentId, q, limit }), account = context.accountState(ownerId);
      const cursor = params.get('cursor');
      let ids;
      if (cursor) {
        const page = pages.get(cursor);
        if (!page || page.ownerId !== ownerId || page.filter !== filter) throw failure('CURSOR_RESET_REQUIRED', 409);
        ids = page.ids;
      } else {
        const candidates = Object.values(account.chatIdentity.chats).filter(chat => chat.kind === 'side');
        const rows = [];
        for (const chat of candidates) {
          const segment = account.chatIdentity.segments[chat.activeSegmentId], session = account.sessions[segment.sessionId];
          if (archived !== 'all' && (session.archived === true) !== (archived === 'true') ||
              parentKind && parentKind !== (session.projectId ? 'project' : 'main') ||
              parentId && parentId !== (session.projectId ?? account.chatIdentity.mainChatId)) continue;
          // Titles remain native; only title search needs description of every candidate.
          const title = q ? session.title ?? (await view(ownerId, chat.chatId)).title : '';
          if (q && !title.toLocaleLowerCase().includes(q.toLocaleLowerCase())) continue;
          const activity = Object.values(account.commands).filter(command => command.sessionId === segment.sessionId)
            .reduce((latest, command) => command.updatedAt > latest ? command.updatedAt : latest, chat.createdAt);
          rows.push({ id: chat.chatId, pinned: session.pinned === true, activity });
        }
        rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.activity.localeCompare(a.activity) || a.id.localeCompare(b.id));
        ids = rows.map(row => row.id);
      }
      const selected = ids.slice(0, Number(limit)), remaining = ids.slice(Number(limit));
      const items = [];
      for (const chatId of selected) if (context.accountState(ownerId).chatIdentity.chats[chatId]) items.push(await view(ownerId, chatId));
      const nextCursor = remaining.length ? `chat-page-${randomUUID()}` : null;
      if (nextCursor) pages.set(nextCursor, { ownerId, filter, ids: remaining });
      return { items, nextCursor, hasMore: remaining.length > 0,
        groups: Object.values(account.sessionGroups ?? {}), indexState: 'ready' };
    },
  };
}
