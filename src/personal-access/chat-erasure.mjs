import { digest } from './common.mjs';
import { removeActivity } from './activity-store.mjs';

/** Erasure owns all derived chat copies. Unknown/mixed provenance is discarded.
 * Source identities remain only as tombstones, never as a reconstruction source. */
export function eraseChatCopies(account, { sessionId = null, forgotten = false } = {}) {
  removeActivity(account, row => forgotten || row.source.sessionId === sessionId);
  if (account.activity) {
    account.activity.erasedBefore ??= {};
    for (const id of Object.keys(account.sessions)) if (forgotten || id === sessionId) account.activity.erasedBefore[id] = new Date().toISOString();
    for (const [id, scan] of Object.entries(account.activity.sources)) if (forgotten || id === sessionId) {
      delete scan.summary; scan.executed = false;
      delete scan.terminals;
    }
  }
  const touches = refs => forgotten || refs?.some(ref => ref.sessionId === sessionId);
  const changed = new Set();
  const identity = account.chatIdentity;
  const sourceChatId = identity?.segments[identity.sessionSegments[sessionId]]?.chatId;
  for (const operation of Object.values(account.chatOperations ?? {})) {
    const snapshot = operation.response?.chat;
    if (!snapshot) continue;
    if (sourceChatId && snapshot.chatId === sourceChatId) operation.response = { chatId: sourceChatId, deleted: true };
    else if (forgotten) { delete snapshot.originRefs; delete snapshot.contextTransfer; }
  }
  for (const result of Object.values(account.chatResults ?? {})) {
    if (!forgotten && result.sourceChatId !== sourceChatId && result.sourceRef?.native?.sessionId !== sessionId) continue;
    result.deleted = true; result.summary = ''; result.artifactRefs = []; result.requiresResponse = false;
    delete result.contentHash;
    result.resultRevision++; result.notificationRevision = result.resultRevision;
    if (forgotten) result.forgotten = true;
    changed.add(identity.mainChatId);
  }
  const clearTransfer = side => {
    if (!side?.contextTransfer || !touches(side.contextTransfer.sourceRefs)) return false;
    side.contextTransfer = { state: 'references_only', sourceRefs: [], truncated: false, sourceDeleted: true };
    return true;
  };
  for (const [id, session] of Object.entries(account.sessions)) {
    if (clearTransfer(session.sideChat)) changed.add(identity?.segments[identity.sessionSegments[id]]?.chatId);
  }
  for (const command of Object.values(account.commands)) {
    if (clearTransfer(command.payload?.sideChat)) command.payloadHash = digest(JSON.stringify(command.payload));
  }
  for (const segment of Object.values(identity?.segments ?? {})) {
    if (touches(segment.handoffSourceRefs)) {
      delete segment.handoff; delete segment.handoffSourceRefs;
      changed.add(segment.chatId);
    }
  }
  // Native cleanup can change any segment (including old injected memory).
  if (forgotten) for (const id of Object.keys(identity?.chats ?? {})) changed.add(id);
  else if (sourceChatId) changed.add(sourceChatId);
  for (const id of changed) if (identity?.chats[id]) {
    if (identity.chats[id].relay) delete identity.chats[id].relay.handoff;
    identity.chats[id].contentRevision++; identity.chats[id].revision++;
  }
  return [...changed].filter(Boolean);
}
