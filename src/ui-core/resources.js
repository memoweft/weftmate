/* Shared resources state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.resources = (core, effects, environment) => {
    function timelineEventsForContext(context = core.conversationTaskContext()) { return context.source === 'phone' ? core.state.phoneHostEvents.get(context.conversationId) || [] : [...core.state.historyEvents.values()]; }
    async function loadConversationResources() {
        const context = core.conversationTaskContext(), key = JSON.stringify(context);
        if (!core.conversationTaskCurrent(context) || !context.sessionId)
            return { outputs: [], sources: [] };
        if (core.resourceCache?.key !== key)
            core.resourceCache = { key, sources: new Map(), cursor: -1, outputs: [] };
        const cache = core.resourceCache;
        if (cache.pending)
            return cache.pending;
        const read = async () => {
            let more;
            do {
                const page = await core.accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/resources?afterSeq=${cache.cursor}`);
                if (!core.conversationTaskCurrent(context) || core.resourceCache !== cache)
                    throw { code: 'STALE_CONTEXT' };
                cache.outputs = page.outputs.map(artifact => ({ key: `artifact:${artifact.artifactId}`, kind: 'file', name: artifact.fileName || '成果文件', artifact }));
                for (const source of page.sources) {
                    const prior = cache.sources.get(source.key) || { ...source, uses: [] };
                    const uses = new Map(prior.uses.map(use => [use.callId || use.id, use]));
                    for (const use of source.uses) {
                        const id = use.callId || use.id, previous = uses.get(id);
                        // Prefer captured content over a raw invocation for the same read.
                        uses.set(id, previous?.path.startsWith('/tasks/') && !use.path.startsWith('/tasks/') ? { ...use, path: previous.path } : use);
                    }
                    cache.sources.set(source.key, { ...prior, ...source, uses: [...uses.values()] });
                }
                more = page.hasMore;
                if (more && page.nextSeq <= cache.cursor)
                    throw { code: 'REQUEST_FAILED' };
                cache.cursor = page.nextSeq;
            } while (more);
            return { outputs: cache.outputs, sources: [...cache.sources.values()] };
        };
        cache.pending = read();
        try {
            return await cache.pending;
        }
        finally {
            cache.pending = null;
        }
    }
    async function refreshTasks(append = false) {
        const identity = core.state.identityGeneration;
        const ownerId = core.state.ownerId;
        try {
            const before = append && core.state.nextBefore ? `&before=${encodeURIComponent(core.state.nextBefore)}` : '';
            const payload = await core.accessApi(`/commands?limit=50${before}`);
            if (identity !== core.state.identityGeneration || ownerId !== core.state.ownerId)
                return;
            if (!Array.isArray(payload.commands))
                throw { code: 'REQUEST_FAILED' };
            core.state.tasks = append ? [...core.state.tasks, ...payload.commands.filter((item) => !core.state.tasks.some((previous) => previous.commandId === item.commandId))] : payload.commands;
            core.state.nextBefore = typeof payload.nextBefore === 'string' ? payload.nextBefore : null;
            effects.renderConversationTasks();
            for (const marker of core.readMarkers()) {
                const found = core.state.tasks.find((item) => item.requestId === marker.requestId);
                if (found)
                    core.updateFromCommand(found);
            }
            effects.updateAvailability();
            await core.conversationTasks.inFlight?.promise;
            if (identity === core.state.identityGeneration && ownerId === core.state.ownerId)
                void core.refreshConversationTasks();
        }
        catch (error) {
            if (identity !== core.state.identityGeneration || ownerId !== core.state.ownerId)
                return;
            if (error.code === 'UNAUTHORIZED')
                return;
            effects.historyNotice(error.code === 'NETWORK'
                ? '连接中断，重连后会查询原有事情记录。' : '事情记录暂时无法读取，请点击刷新。');
        }
    }
    function updateFromCommand(command) {
        core.finishAttachmentCommand(command);
        if (!command || typeof command.requestId !== 'string')
            return;
        const marker = core.readMarkers().find((item) => item.requestId === command.requestId);
        if (!marker)
            return;
        const pending = ['pending', 'dispatching'].includes(command.state);
        const activeDesktop = command.kind === 'desktop.open_app' &&
            ['pending', 'dispatching', 'accepted_by_host', 'uncertain'].includes(command.state) &&
            !core.state.acknowledgedDesktop.has(command.commandId);
        if (pending || activeDesktop || command.state === 'uncertain') {
            core.rememberMarker({ ...marker, commandId: command.commandId, sessionId: command.sessionId ?? marker.sessionId });
        }
        else {
            // Keep pending work until the later durable receipt can be observed after refresh or restart.
            core.forgetMarker(command.requestId);
        }
        const locked = command.kind !== 'desktop.open_app' && (pending || command.state === 'uncertain');
        core.operation(command.state === 'accepted_by_dsh' && ['session.create', 'session.message'].includes(command.kind) ? '' : core.commandStatus(command), locked, command.requestId, command.state === 'uncertain');
        if (command.kind === 'session.create' && command.state === 'accepted_by_dsh' && command.sessionId) {
            void core.refreshSessions().then(() => core.selectSession(command.sessionId));
        }
    }
    async function lookupRequest(marker) {
        try {
            const payload = await core.accessApi(`/commands/by-request/${encodeURIComponent(marker.requestId)}`);
            if (!core.readMarkers().some((row) => row.requestId === marker.requestId))
                return;
            if (payload.command) {
                core.updateFromCommand(payload.command);
                if (!core.state.tasks.some((item) => item.commandId === payload.command.commandId)) {
                    core.state.tasks.unshift(payload.command);
                    effects.renderConversationTasks();
                }
            }
        }
        catch (error) {
            if (!core.readMarkers().some((row) => row.requestId === marker.requestId))
                return;
            if (error.code === 'NOT_FOUND')
                core.operation('上次请求尚无宿主记录；不会自动再次发送。请核对后重新输入。', true, marker.requestId);
            else if (error.code === 'NETWORK')
                core.operation('连接中断，请重连后查询原请求，不会自动重复发送。', true, marker.requestId);
        }
    }
    async function restoreRequests() {
        for (const marker of core.readMarkers())
            await core.lookupRequest(marker);
    }
    async function submitCommand(kind, fields = {}, sessionId = null, fixedRequestId = null) {
        if (!core.state.online || !core.state.hostId) {
            core.setOnline(false);
            return;
        }
        const cancelling = kind === 'session.cancel';
        if (cancelling) {
            if (core.state.cancelSubmitting)
                return null;
            core.state.cancelSubmitting = true;
        }
        else {
            if (core.state.submitting || core.state.unresolvedSubmission || Date.now() - core.state.lastSubmissionMs < 800)
                return null;
            core.state.submitting = true;
            core.state.lastSubmissionMs = Date.now();
        }
        effects.updateAvailability();
        try {
            const requestId = fixedRequestId || environment.crypto.randomUUID();
            const marker = { requestId, kind, ...(sessionId ? { sessionId } : {}) };
            core.rememberMarker(marker); // Durable ID before the network request; body stays in memory.
            core.operation('正在提交请求。');
            try {
                const payload = await core.accessApi('/commands', { method: 'POST', protectedWrite: true,
                    body: { requestId, kind, targetDeviceId: core.state.hostId, ...fields } });
                if (!payload.command)
                    throw { code: 'REQUEST_FAILED' };
                core.updateFromCommand(payload.command);
                await core.refreshTasks();
                return payload.command;
            }
            catch (error) {
                if (error.code === 'NETWORK' || error.code === 'REQUEST_FAILED') {
                    core.operation('送达状态尚未确认，正在查询原请求；不会自动重复发送。', true, requestId);
                    await core.lookupRequest(marker);
                }
                else if (error.code !== 'UNAUTHORIZED') {
                    core.forgetMarker(requestId);
                    core.operation(error.code === 'MODEL_UNAVAILABLE' ? '电脑尚无可用模型，消息未发送。'
                        : error.code === 'SESSION_READ_ONLY' ? '旧会话只供阅读，请新建受限远端会话。'
                            : error.code === 'CAPABILITY_UNAVAILABLE' ? '这项电脑能力目前不可用，请稍后再试。'
                                : '请求未受理，请检查状态后重试。', false, requestId);
                }
                return null;
            }
        }
        finally {
            if (cancelling)
                core.state.cancelSubmitting = false;
            else
                core.state.submitting = false;
            effects.updateAvailability();
        }
    }
    return { timelineEventsForContext, loadConversationResources, refreshTasks, updateFromCommand, lookupRequest, restoreRequests, submitCommand };
};
