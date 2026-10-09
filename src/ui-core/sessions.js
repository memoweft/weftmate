/* Shared sessions state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.sessions = (core, effects, environment) => {
    const expansionKey = projectId => `weftmate-project-expanded:${core.state.ownerId}:${projectId}`;
    const expandedProjects = new Map();
    function projectExpanded(projectId) {
        if (expandedProjects.has(expansionKey(projectId))) return expandedProjects.get(expansionKey(projectId));
        try { return environment.storage.getItem(expansionKey(projectId)) === 'true'; } catch { return false; }
    }
    function setProjectExpanded(projectId, expanded) {
        expandedProjects.set(expansionKey(projectId), expanded);
        try { environment.storage.setItem(expansionKey(projectId), String(expanded)); } catch { /* Device storage may be unavailable. */ }
    }
    function projectConversations(projectId, sessions = core.sessionList()) {
        return sessions.filter(row => !row.archived && row.projectId === projectId).sort((a, b) =>
            (Date.parse(b.updatedAt || b.lastMessageAt || b.createdAt || b.attachedAt) || 0) - (Date.parse(a.updatedAt || a.lastMessageAt || a.createdAt || a.attachedAt) || 0));
    }
    function sessionHoverDetails(session) {
        const project = core.state.projects?.find(row => row.projectId === session.projectId);
        const group = core.state.sessionGroups?.find(row => row.id === session.groupId);
        const device = core.state.cachedDevices?.find(row => row.id === (session.hostId || core.state.hostId));
        return { title: session.title || '新对话', location: [project?.name, group?.name].filter(Boolean).join(' / ') || '未分组',
            activity: session.updatedAt || session.lastMessageAt || session.createdAt || session.attachedAt, device: device?.name || session.deviceName || '当前连接的电脑' };
    }
    async function refreshSessions(legacy = false) {
        if (!legacy && core.refreshLogicalSessions) return core.refreshLogicalSessions();
        const identity = core.state.identityGeneration;
        const payload = await core.accessApi('/sessions?archived=all');
        if (identity !== core.state.identityGeneration) return;
        core.state.sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
        core.state.sessionSnapshotAt = payload.snapshotAt ?? null;
        core.state.sessionGroups = payload.groups || [];
        await refreshSessionProjects();
        if (!core.state.selectedSessionId && !core.state.newConversation && core.state.sessions.length && core.state.ownerId) {
            let saved = null;
            try {
                saved = environment.storage.getItem(core.sessionKey());
            }
            catch { /* no preference storage */ }
            const chosen = core.state.sessions.find((item) => item.sessionId === saved && !item.archived) ?? core.state.sessions.find(item => !item.archived);
            if (chosen?.sessionId)
                await core.selectSession(chosen.sessionId);
        }
        else {
            effects.renderSessions();
            if (core.state.activeChatSource === 'desktop' && core.state.selectedSessionId)
                effects.paintSelectedSession(core.state.selectedSessionId);
        }
        if (core.state.turnStatus === 'running')
            effects.renderTurnStatus();
        effects.updateAvailability();
    }
    function sessionList(archived = false) { return core.state.sessions.filter(item => item.kind !== 'main' && (item.archived === true) === archived).sort((a,b) => Number(b.pinned) - Number(a.pinned)); }
    async function refreshSessionProjects() {
        const identity = core.state.identityGeneration;
        try {
            const payload = await core.accessApi('/projects');
            if (identity !== core.state.identityGeneration) return;
            core.state.projects = payload.projects || [];
            core.state.projectCanManage = payload.canManage === true;
            core.state.projectsError = '';
        } catch (error) {
            if (identity !== core.state.identityGeneration) return;
            core.state.projectsError = '项目暂时无法读取，重新连接后再试。';
        }
    }
    async function saveProject(project, fields) {
        const identity = core.state.identityGeneration;
        const result = await core.accessApi('/projects' + (project ? '/' + encodeURIComponent(project.projectId) : ''), {
            method: project ? 'PATCH' : 'POST', protectedWrite: true,
            body: project ? { ...fields, expectedRevision: project.revision } : fields });
        if (identity !== core.state.identityGeneration) return null;
        await core.refreshSessions(); return result;
    }
    async function removeProject(project) {
        const identity = core.state.identityGeneration;
        const result = await core.accessApi('/projects/' + encodeURIComponent(project.projectId), {
            method: 'DELETE', protectedWrite: true, body: { expectedRevision: project.revision } });
        if (identity !== core.state.identityGeneration) return null;
        await core.refreshSessions(); return result;
    }
    async function createProjectConversation(project, modelProfileId) {
        const identity = core.state.identityGeneration, owner = core.state.ownerId;
        const key = `weftmate-project-conversation:${owner}:${project.projectId}`;
        let intent;
        try { intent = JSON.parse(environment.storage.getItem(key)); } catch {}
        if (!intent) {
            intent = { requestId: environment.crypto.randomUUID(), modelProfileId };
            environment.storage.setItem(key, JSON.stringify(intent));
        }
        let command;
        try {
            command = (await core.accessApi(`/projects/${encodeURIComponent(project.projectId)}/sessions`, {
                method: 'POST', protectedWrite: true, body: intent })).command;
        } catch (error) {
            if (identity === core.state.identityGeneration && error.status >= 400 && error.status < 500 && error.code !== 'REQUEST_CONFLICT') environment.storage.removeItem(key);
            throw error;
        }
        const deadline = Date.now() + 45000;
        while (identity === core.state.identityGeneration && Date.now() < deadline) {
            if (command?.state === 'accepted_by_dsh') {
                environment.storage.removeItem(key); return command.sessionId;
            }
            if (['rejected', 'uncertain'].includes(command?.state)) {
                if (command.state === 'rejected') environment.storage.removeItem(key);
                throw { code: command.errorCode || 'REQUEST_FAILED' };
            }
            await new Promise(resolve => setTimeout(resolve, 250));
            command = (await core.accessApi(`/commands/by-request/${encodeURIComponent(intent.requestId)}`)).command;
        }
        throw { code: 'NETWORK' };
    }
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
            MEMORY_REVISION_CHANGED: '记忆已变更，请重新打开确认框，核对新的遗忘范围。',
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
    const previewSessionForget = sessionId => core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/forget-preview`);
    async function deleteSession(sessionId, forgetMemories = false, options = {}) {
        const identity = core.state.identityGeneration;
        const result = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', body: { forgetMemories,
            ...(forgetMemories ? { deleteConversationSnippets: options.deleteConversationSnippets === true,
                ...(options.worldRevision !== undefined ? { memoryWorldRevision: options.worldRevision } : {}) } : {}) }, protectedWrite: true, timeoutMs: 120000 });
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
    return { projectExpanded, setProjectExpanded, projectConversations, sessionHoverDetails, refreshSessionProjects, saveProject, removeProject, createProjectConversation, refreshSessions, sessionList, updateSession, sessionGroupAction, forkSession, archiveSession, previewSessionForget, deleteSession, sessionLifecycleMessage };
};
globalThis.WeftUiCore.sessionMenuItems = session => [
    {id:'pin',label:session.pinned?'取消置顶':'置顶',key:'P'},
    {id:'unread',label:session.unread?'标记为已读':'标记为未读',key:'U'},
    {id:'rename',label:'重命名',key:'R'}, {id:'fork',label:'分叉',key:'F'},
    {id:'project',label:'移至项目',submenu:true,separator:true},
    {id:'group',label:'移至分组',submenu:true},
    {id:'archive',label:session.archived?'恢复对话':'归档',key:'A',separator:true},
    {id:'delete',label:'删除',key:'D',danger:true},
];
globalThis.WeftUiCore.sessionMenuKey = key => ({p:'pin',u:'unread',r:'rename',f:'fork',a:'archive',d:'delete'})[key.toLowerCase()];
globalThis.WeftUiCore.compareSessionGroups = (a, b) => Number(b.pinned === true) - Number(a.pinned === true) ||
    Number(!!b.groupId) - Number(!!a.groupId) || (a.groupId || '').localeCompare(b.groupId || '');
