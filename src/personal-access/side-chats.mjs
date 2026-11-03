import { digest, exactKeys, failure, modelProfileId, validId } from './common.mjs';
import { REQUEST_ID } from './constants.mjs';
import { chatForSession } from './chat-identity.mjs';
import { hasPrivateContent } from './temporary-chats.mjs';
import { randomUUID } from 'node:crypto';


/** Side creation uses the existing durable session.create command internally. */
export function createSideChats(context) {
  function sourceSession(ownerId, chatId) {
    const account = context.accountState(ownerId), chat = context.chats.requireChat(ownerId, chatId);
    if (account.memoryCleanupPending) throw failure('SOURCE_UNAVAILABLE', 404);
    const segment = account.chatIdentity.segments[chat.activeSegmentId], session = account.sessions[segment?.sessionId];
    if (hasPrivateContent(session)) throw failure('TEMPORARY_CONTEXT_CONFIRMATION_REQUIRED', 409);
    if (session?.conversationId || session?.origin === 'shared-chat') throw failure('SHARED_CONTEXT_UNAVAILABLE', 409);
    if (session?.deleting) throw failure('SOURCE_UNAVAILABLE', 404);
    return { account, chat, segment, session };
  }
  async function source(ownerId, chatId, eventId) {
    sourceSession(ownerId, chatId);
    await context.chatTimeline.ready(ownerId, chatId);
    const page = await context.chatTimeline.query(ownerId, chatId, 'events', new URLSearchParams({ around: eventId, limit: '1' }));
    const event = page.items.find(item => item.eventId === eventId);
    if (!event || !['user.message','assistant.message'].includes(event.type) || event.sourceRef.kind !== 'native') throw failure('SOURCE_UNAVAILABLE', 404);
    const account = context.accountState(ownerId), session = account.sessions[event.sourceRef.sessionId];
    if (!session || session.deleting || hasPrivateContent(session) || session.conversationId || session.origin === 'shared-chat') throw failure('SOURCE_UNAVAILABLE', 404);
    if (session.forgottenSeqs?.includes(event.sourceRef.seq)) throw failure('SOURCE_UNAVAILABLE', 404);
    return event;
  }
  function validatePrepared(ownerId, prepared) {
    const account = context.accountState(ownerId);
    if (prepared.parent) {
      const project = account.projects?.[prepared.parent.id];
      if (!context.hostOwner(ownerId) || !project || project.revoked) throw failure('PROJECT_REVOKED', 409);
    }
    for (const ref of prepared.contextTransfer.sourceRefs) {
      const { chat } = sourceSession(ownerId, ref.chatId);
      if (chat.contentRevision !== ref.contentRevision) throw failure('SOURCE_UNAVAILABLE', 404);
      if (chatForSession(account, ref.sessionId)?.chatId !== ref.chatId) throw failure('SOURCE_UNAVAILABLE', 404);
    }
  }
  return {
    validatePrepared,
    async prepare(ownerId, body) {
      exactKeys(body, ['requestId','kind','targetDeviceId','parent','modelProfileId','originChatId','originEventId','title','entry','confirmed'],
        ['requestId','kind','targetDeviceId','modelProfileId']);
      if (!REQUEST_ID.test(body.requestId ?? '') || body.kind !== 'session.side.create') throw failure('INVALID_REQUEST');
      const account = context.accountState(ownerId);
      if (body.targetDeviceId !== account.hostId) throw failure('TARGET_UNAVAILABLE', 409);
      if (body.parent !== undefined) {
        exactKeys(body.parent, ['kind','id'], ['kind','id']);
        if (!['main','project'].includes(body.parent.kind) || !validId(body.parent.id)) throw failure('INVALID_REQUEST');
        if (body.parent.kind === 'main' && body.parent.id !== account.chatIdentity.mainChatId) throw failure('CHAT_UNAVAILABLE', 404);
      }
      modelProfileId(body.modelProfileId);
      if ((body.originChatId === undefined) !== (body.originEventId === undefined) || body.originChatId !== undefined &&
          (!validId(body.originChatId) || !validId(body.originEventId)) ||
          body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 256) ||
          body.entry !== undefined && !['composer','message','suggestion'].includes(body.entry) ||
          body.confirmed !== undefined && body.confirmed !== true) throw failure('INVALID_REQUEST');
      if (body.entry === 'suggestion' && body.confirmed !== true) throw failure('SIDE_CHAT_CONFIRMATION_REQUIRED', 409);
      if (body.entry === 'message' && !body.originEventId) throw failure('INVALID_REQUEST');
      const canonical = { requestId: body.requestId, kind: body.kind, targetDeviceId: body.targetDeviceId,
        ...(body.parent ? {parent:{kind:body.parent.kind,id:body.parent.id}} : {}), modelProfileId: body.modelProfileId,
        ...(body.originChatId ? { originChatId: body.originChatId, originEventId: body.originEventId } : {}),
        ...(body.title ? { title: body.title.trim() } : {}), entry: body.entry ?? (body.originChatId ? 'message' : 'composer'),
        ...(body.confirmed ? { confirmed: true } : {}) };
      const requestHash = digest(JSON.stringify(canonical));
      const prior = Object.values(account.commands).find(row => row.requestId === body.requestId);
      if (prior) { if (prior.payload.sideChat?.requestHash !== requestHash) throw failure('REQUEST_CONFLICT', 409); return prior.payload; }
      const prepared = { chatId: `chat-${randomUUID()}`, requestHash,
        ...(canonical.parent?.kind === 'project' ? {parent:canonical.parent} : {}), ...(canonical.title ? { title: canonical.title } : {}),
        contextTransfer: { state: 'references_only', sourceRefs: [], truncated: false } };
      if (body.originChatId) {
        const event = await source(ownerId, body.originChatId, body.originEventId);
        prepared.contextTransfer.sourceRefs = [{ chatId: body.originChatId, eventId: body.originEventId,
          ...event.sourceRef, contentRevision: context.chats.requireChat(ownerId, body.originChatId).contentRevision }];
      }
      validatePrepared(ownerId, prepared);
      const project = prepared.parent && account.projects[prepared.parent.id];
      return { requestId: body.requestId, kind: 'session.create', targetDeviceId: body.targetDeviceId, modelProfileId: body.modelProfileId,
        ...(project ? { projectId: prepared.parent.id, projectRevision: project.revision } : {}), sideChat: prepared };
    },
  };
}
