import { randomUUID } from 'node:crypto';
import { digest, failure, plainObject, validId } from './common.mjs';
import { REQUEST_ID } from './constants.mjs';
import { APPROVAL_MODES } from '../plugins/personal-approval-policy.mjs';

// This is an identity map, not a second session store. Execution, permissions,
// titles, groups, projects and memory provenance remain in their original stores.
const sessionRevision = session => digest(JSON.stringify(session));
const makeId = prefix => `${prefix}-${randomUUID()}`;

export function retireMainChatResults(account, now) {
  const identity = account.chatIdentity;
  if (identity?.version !== 1) return false;
  for (const session of Object.values(account.sessions)) {
    if (session.sideChat?.parent?.kind === 'main') delete session.sideChat.parent;
  }
  for (const command of Object.values(account.commands)) {
    if (command.payload?.sideChat?.parent?.kind !== 'main') continue;
    if (digest(JSON.stringify(command.payload)) !== command.payloadHash) throw failure('STORE_CORRUPT', 500);
    delete command.payload.sideChat.parent;
    command.payloadHash = digest(JSON.stringify(command.payload));
  }
  delete account.chatResults;
  delete account.chatResultCounter;
  delete account.sideOperations;
  identity.version = 2;
  reconcileChatIdentity(account, account.hostId, now);
  return true;
}

export function reconcileChatIdentity(account, hostId, now) {
  if (!account.chatIdentity) {
    const mainChatId = makeId('chat');
    account.chatIdentity = { version: 2, mainChatId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      chats: { [mainChatId]: { chatId: mainChatId, kind: 'main', revision: 1, contentRevision: 1,
        createdAt: now, unread: false, activeSegmentId: null } }, segments: {}, sessionSegments: {} };
  }
  const identity = account.chatIdentity;
  for (const [sessionId, session] of Object.entries(account.sessions)) {
    let segment = identity.segments[identity.sessionSegments[sessionId]];
    if (!segment) {
      const chatId = session.sideChat?.chatId ?? makeId('chat'), segmentId = makeId('segment');
      identity.chats[chatId] = { chatId, kind: 'side', revision: 1, contentRevision: 1,
        createdAt: session.attachedAt ?? now, activeSegmentId: segmentId, sessionRevision: sessionRevision(session) };
      segment = { segmentId, chatId, ordinal: 0, hostId, sessionId, state: 'active', startedAt: session.attachedAt ?? now };
      identity.segments[segmentId] = segment;
      identity.sessionSegments[sessionId] = segmentId;
    }
    const chat = identity.chats[segment.chatId], revision = sessionRevision(session);
    if (chat.activeSegmentId === segment.segmentId && chat.sessionRevision !== revision) {
      chat.sessionRevision = revision;
      chat.revision++;
    }
  }
  for (const [sessionId, segmentId] of Object.entries(identity.sessionSegments)) {
    if (account.sessions[sessionId]) continue;
    const segment = identity.segments[segmentId], chat = identity.chats[segment.chatId];
    // IA-2a only has single-segment side chats. Keep a main entity even empty.
    delete identity.sessionSegments[sessionId];
    delete identity.segments[segmentId];
    const remaining = Object.values(identity.segments).filter(row => row.chatId === chat.chatId).sort((a,b)=>a.ordinal-b.ordinal);
    if (chat.kind === 'side' && !remaining.length) delete identity.chats[chat.chatId];
    else if (chat.activeSegmentId === segmentId) { chat.activeSegmentId = remaining.at(-1)?.segmentId ?? null; chat.revision++; }
  }

}

export function validateChatIdentity(account) {
  const identity = account.chatIdentity;
  if (identity === undefined) return; // Old stores are read before migration.
  const corrupt = () => { throw failure('STORE_CORRUPT', 500); };
  if (!plainObject(identity) || identity.version !== 2 || !validId(identity.mainChatId) ||
      !plainObject(identity.chats) || !plainObject(identity.segments) || !plainObject(identity.sessionSegments)) corrupt();
  try { new Intl.DateTimeFormat('en', { timeZone: identity.timeZone }).format(); } catch { corrupt(); }
  if (typeof identity.timeZone !== 'string' || identity.chats[identity.mainChatId]?.kind !== 'main' ||
      Object.values(identity.chats).filter(chat => chat.kind === 'main').length !== 1) corrupt();
  for (const [id, chat] of Object.entries(identity.chats)) {
    if (chat.deepThinking !== undefined && typeof chat.deepThinking !== 'boolean') corrupt();
    if (chat.approvalMode !== undefined && !APPROVAL_MODES.includes(chat.approvalMode)) corrupt();
    if (chat.wasMain !== undefined && typeof chat.wasMain !== 'boolean') corrupt();
    if (!validId(id) || !plainObject(chat) || chat.chatId !== id || !['main', 'side'].includes(chat.kind) ||
        !Number.isSafeInteger(chat.revision) || chat.revision < 1 ||
        !Number.isSafeInteger(chat.contentRevision) || chat.contentRevision < 1 ||
        !Number.isFinite(Date.parse(chat.createdAt)) ||
        (chat.activeSegmentId !== null && identity.segments[chat.activeSegmentId]?.chatId !== id) ||
        chat.kind === 'side' && chat.activeSegmentId === null) corrupt();
  }
  const sessionIds = new Set();
  for (const [id, segment] of Object.entries(identity.segments)) {
    if (!validId(id) || !plainObject(segment) || segment.segmentId !== id || !identity.chats[segment.chatId] ||
        !validId(segment.hostId) || !validId(segment.sessionId) || !account.sessions[segment.sessionId] ||
        !Number.isSafeInteger(segment.ordinal) || segment.ordinal < 0 ||
        !['active', 'sealed'].includes(segment.state) || !Number.isFinite(Date.parse(segment.startedAt)) ||
        identity.sessionSegments[segment.sessionId] !== id || sessionIds.has(segment.sessionId)) corrupt();
    sessionIds.add(segment.sessionId);
  }
  if (Object.keys(identity.sessionSegments).length !== sessionIds.size ||
      Object.keys(account.sessions).some(id => !sessionIds.has(id))) corrupt();
  for (const [sessionId, session] of Object.entries(account.sessions)) {
    if (!session.sideChat) continue;
    const creation = Object.values(account.commands).find(command => command.kind === 'session.create' && command.sessionId === sessionId);
    if (chatForSession(account, sessionId)?.chatId !== session.sideChat.chatId ||
        JSON.stringify(creation?.payload?.sideChat) !== JSON.stringify(session.sideChat)) corrupt();
  }
  if (account.chatOperations !== undefined) {
    if (!plainObject(account.chatOperations)) corrupt();
    for (const [requestId, operation] of Object.entries(account.chatOperations)) {
      if (!REQUEST_ID.test(requestId) || !plainObject(operation) || !/^[a-f0-9]{64}$/.test(operation.fingerprint ?? '') ||
          (operation.phase === 'pending' ? !validId(operation.chatId) || !Array.isArray(operation.sessionIds) || !operation.sessionIds.every(validId)
            : !plainObject(operation.response) || !(validId(operation.response.chat?.chatId) || validId(operation.response.chatId) && (operation.response.deleted === true || operation.response.completed === true))) ||
          Object.values(account.commands).some(command => command.requestId === requestId)) corrupt();
    }
  }

}

export function chatForSession(account, sessionId) {
  const identity = account.chatIdentity;
  const segment = identity?.segments[identity.sessionSegments[sessionId]];
  return segment ? identity.chats[segment.chatId] : null;
}

export function protectMainSession(account, sessionId, code = 'MAIN_CHAT_PROTECTED') {
  if (chatForSession(account, sessionId)?.kind === 'main') throw failure(code, 409);
}
