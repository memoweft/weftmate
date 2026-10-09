/* Shared sessions state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.sessions = (core, effects, environment) => {
    async function refreshSessions() {
        const identity = core.state.identityGeneration;
        const payload = await core.accessApi('/sessions?archived=all');
        if (identity !== core.state.identityGeneration) return;
        core.state.sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
        core.state.sessionGroups = payload.groups || [];
        if (!core.state.selectedSessionId && core.state.sessions.length && core.state.ownerId) {
            let saved = null;
            try {
                saved = environment.storage.getItem(core.sessionKey());
            }
            catch { /* no preference storage */ }
            const chosen = core.state.sessions.find((item) => item.sessionId === saved && !item.archived) ?? core.state.sessions.find(item => !item.archived);
            if (chosen?.sessionId)
                await core.selectSession(chosen.sessionId);
        }
        else
            effects.renderSessions();
        if (core.state.turnStatus === 'running')
            effects.renderTurnStatus();
        effects.updateAvailability();
    }
    function sessionList(archived = false) { return core.state.sessions.filter(item => (item.archived === true) === archived).sort((a,b) => Number(b.pinned) - Number(a.pinned)); }
    async function updateSession(sessionId, patch) {
        const identity = core.state.identityGeneration;
        const result = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/metadata`, { method: 'PATCH', body: patch, protectedWrite: true });
        if (identity !== core.state.identityGeneration) return false;
        for (const item of core.state.sessions) if (item.sessionId === sessionId) Object.assign(item, result);
        effects.renderSessions();
        if (environment.mobileState) for (const item of environment.mobileState.sharedSessions) if (item.sessionId === sessionId) Object.assign(item, result);
        return result;
    }
    async function sessionGroupAction(method, groupId, name) {
        const identity = core.state.identityGeneration;
        const result = await core.accessApi('/session-groups' + (groupId ? '/' + encodeURIComponent(groupId) : ''), {method, body: method === 'DELETE' ? {} : {name}, protectedWrite: true});
        const payload = await core.accessApi('/session-groups');
        if (identity !== core.state.identityGeneration) return null;
        core.state.sessionGroups = payload.groups;
        effects.renderSessions(); return result;
    }
    async function forkSession(sessionId) {
        const identity = core.state.identityGeneration;
        const result = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/fork`, {method: 'POST', body: {}, protectedWrite: true, timeoutMs: 120000});
        return identity === core.state.identityGeneration ? result : null;
    }
    function sessionLifecycleMessage(error) {
        return { SESSION_BUSY: '对话还在停止或核对执行结果，请稍后重试。', SESSION_ARCHIVED: '请先恢复对话，再发送消息。',
            MEMORY_DELETE_UNAVAILABLE: '记忆暂时无法遗忘，对话仍保留。请稍后重试，或取消勾选。',
            MEMORY_DELETE_CONFLICT: '记忆遗忘尚未完成，对话仍保留。请稍后重试。' }[error?.code] || core.failureMessage(error);
    }
    async function archiveSession(sessionId, archived = true) {
        const identity = core.state.identityGeneration;
        await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST', body: {}, protectedWrite: true });
        if (identity !== core.state.identityGeneration) return false;
        const payload = await core.accessApi('/sessions?archived=all');
        if (identity !== core.state.identityGeneration) return false;
        core.state.sessions = payload.sessions;
        effects.renderSessions(); effects.updateAvailability();
        return true;
    }
    async function deleteSession(sessionId, forgetMemories = false) {
        const identity = core.state.identityGeneration;
        const result = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', body: { forgetMemories }, protectedWrite: true, timeoutMs: 120000 });
        if (identity !== core.state.identityGeneration) return false;
        core.state.sessions = core.state.sessions.filter(item => item.sessionId !== sessionId);
        if (core.state.selectedSessionId === sessionId) {
            core.state.selectedSessionId = null; core.state.historyEvents.clear(); core.state.seenSeq.clear();
            core.state.historyGeneration++; core.state.afterSeq = -1; core.state.turnStatus = 'idle';
            core.resetConversationApprovals(); core.resetConversationQuestions();
            effects.clearHistoryView(); effects.removeResourcePreview();
            environment.storage.removeItem(core.sessionKey());
            const next = core.sessionList()[0]; if (next && !environment.mobileState) await core.selectSession(next.sessionId);
        }
        effects.renderSessions(); effects.updateAvailability();
        return result;
    }
    return { refreshSessions, sessionList, updateSession, sessionGroupAction, forkSession, archiveSession, deleteSession, sessionLifecycleMessage };
};
globalThis.WeftUiCore.sessionMenuItems = session => [
    {id:'pin',label:session.pinned?'取消置顶':'置顶',key:'P'},
    {id:'unread',label:session.unread?'标记为已读':'标记为未读',key:'U'},
    {id:'rename',label:'重命名',key:'R'}, {id:'fork',label:'分叉',key:'F'},
    {id:'group',label:'移至分组',submenu:true,separator:true},
    {id:'archive',label:session.archived?'恢复对话':'归档',key:'A',separator:true},
    {id:'delete',label:'删除',key:'D',danger:true},
];
globalThis.WeftUiCore.sessionMenuKey = key => ({p:'pin',u:'unread',r:'rename',f:'fork',a:'archive',d:'delete'})[key.toLowerCase()];
