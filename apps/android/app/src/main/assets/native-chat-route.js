/* Native shell entry: select the same conversation before exposing its web page. */
globalThis.WeftNativeChatRoute = function (entry) {
  window.weftNativeRoute = entry;
  async function apply() {
    if (window.weftNativeRoute !== entry) return;
    if (typeof page !== 'function' || !state.booted) { setTimeout(apply, 100); return; }
    document.querySelectorAll('.topbar,#mobile-bottom-tabs').forEach(el => el.style.setProperty('display', entry.embedded ? 'none' : '', 'important'));
    document.getElementById('app')?.style.setProperty('padding', entry.embedded ? '0' : '', 'important');
    for (const edge of ['top', 'bottom', 'left', 'right']) document.documentElement.style.setProperty('--safe-' + edge, entry.embedded ? '0px' : '', 'important');
    if (entry.name === 'login') return;
    try {
      if (entry.name === 'chat') {
        const content = document.getElementById('chat-content');
        if (content) content.textContent = '正在打开这段对话…';
        // uiCore is a top-level lexical const, not a property of globalThis.
        if (entry.phone) {
          state.conversationId = entry.phoneId;
          state.chatSource = 'phone';
        } else if (entry.kind === 'main') {
          // Native has already observed the first main session. The covered web
          // core may still hold null (or the previous session), so install that
          // identity before the shared selector reads history and paints the page.
          uiCore.state.mainChat = { ...uiCore.state.mainChat, kind: 'main', chatId: entry.chatId, activeSessionId: entry.sessionId || null };
          await uiCore.selectMainChat();
        } else if (entry.sessionId) {
          await uiCore.selectLogicalSession(entry.sessionId);
        } else {
          throw new Error('CHAT_UNAVAILABLE');
        }
      }
      if (window.weftNativeRoute === entry) page(entry.name);
    } catch (_) {
      if (window.weftNativeRoute !== entry) return;
      const content = document.getElementById('chat-content');
      if (content) content.textContent = '这段对话暂时无法打开，请返回后重试。';
    }
  }
  return apply();
};
