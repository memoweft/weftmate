/** Resolve both UI chat IDs and Agent execution IDs to one account-owned browser. */
export function browserConversationScope(account, id, allowDeleting = false) {
  const segments = Object.values(account.chatIdentity?.segments ?? {});
  const segment = segments.find(row => row.sessionId === id);
  const chatId = segment?.chatId ?? (Object.hasOwn(account.chatIdentity?.chats ?? {}, id) ? id : null);
  const sessions = chatId ? segments.filter(row => row.chatId === chatId).map(row => account.sessions[row.sessionId])
    : [Object.hasOwn(account.sessions, id) ? account.sessions[id] : null];
  if (!sessions.length || sessions.some(row => !row || !allowDeleting && row.deleting || row.phoneHistory)) {
    throw Object.assign(new Error('BROWSER_CONVERSATION_UNAVAILABLE'), { code: 'BROWSER_CONVERSATION_UNAVAILABLE' });
  }
  return chatId ?? id;
}
