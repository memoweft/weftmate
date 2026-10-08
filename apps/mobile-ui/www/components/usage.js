/* Mobile placement and navigation; all requests and calculations are in ui-core. */
function usagePage(target, sessionId = '') {
    const selected = sessionId; state.usageSessionId = '';
    const body = el('section', 'group usage-body'); target.append(body);
    WeftUsageView(uiCore, body, { sessionId: selected, current: () => body.isConnected && state.page === 'usage' });
}

const conversationUsage = $('conversation-usage');
conversationUsage.type = 'button';
conversationUsage.addEventListener('click', () => { state.usageSessionId = state.sharedSessionId || uiCore.mobile?.selectedBinding()?.sessionId || ''; page('usage'); });
