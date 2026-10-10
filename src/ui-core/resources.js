/* Shared resources state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.resources = (core, effects, environment) => {
    function capturedSourceText(raw) {
        const parse = value => { try { return JSON.parse(value); } catch { return null; } };
        const collect = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(collect)
            : value?.type === 'text' ? [value.text || ''] : value?.content ? collect(value.content) : [];
        const data = parse(raw), outputs = collect(data?.output);
        return outputs.map(text => {
            const source = parse(text);
            if (!source?.url || typeof source.text !== 'string') {
                const capture = text.match(/^Fetched[^\n]*\n\nTitle: ([^\n]+)\nURL: ([^\n]+)\nAccessed: ([^\n]+)\n([\s\S]*)$/);
                if (!capture) return text;
                const body = capture[4].replace(/\n\n(?:\[Partial page: segment |Captured source: |\(Content truncated\.)[\s\S]*$/, '')
                    .replace(/^\[Captured requested section #([^\n]*); this is not the entire page\.\]\n/, '所读章节：#$1\n\n');
                return `访问时间：${capture[3]}\n\n${body}${body !== capture[4] ? '\n\n[仅显示已读取的部分原文]' : ''}`;
            }
            return [source.title, source.url, source.capturedAt ? `访问时间：${source.capturedAt}` : '',
                source.query ? `原文片段 · ${source.query}` : '', source.text,
                source.captureTruncated || source.previewTruncated || source.truncated ? '[仅显示已读取的部分原文]' : ''].filter(Boolean).join('\n\n');
        }).join('\n\n') || raw;
    }
    async function capturedSourceForUrl(url) {
        const normalize = value => { try { const u = new URL(value); u.hash = ''; return u.href; } catch { return ''; } };
        const key = normalize(url); if (!key) return null;
        const resources = await core.loadConversationResources();
        const matches = resources.sources.filter(item => item.kind === 'webpage' && normalize(item.url) === key);
        if (!matches.length) return null;
        return { ...matches[0], uses: [...new Map(matches.flatMap(item => item.uses).map(use => [use.path, use])).values()]
            .sort((a, b) => Number(b.summary.startsWith('原文片段')) - Number(a.summary.startsWith('原文片段'))) };
    }
    function deduplicateOutputs(artifacts) {
        const groups = new Map(), seen = new Set();
        for (const artifact of artifacts) {
            if (!artifact?.artifactId || seen.has(artifact.artifactId)) continue;
            seen.add(artifact.artifactId);
            const location = artifact.filePath || artifact.relativePath || artifact.path;
            const key = location ? location.replace(/\\/g, '/') : `${artifact.sessionId || ''}/${artifact.fileName || artifact.artifactId}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(artifact);
        }
        return [...groups.values()].map(versions => {
            versions.reverse().sort((a, b) => (Date.parse(b.createdAt || b.at) || 0) - (Date.parse(a.createdAt || a.at) || 0));
            const artifact = versions[0];
            return { key: `artifact:${artifact.artifactId}`, kind: 'file', name: artifact.fileName || '成果文件', artifact, versions: versions.slice(1) };
        });
    }
    function timelineEventsForContext(context = core.conversationTaskContext()) {
        if (core.inMainChat?.()) return [...core.state.chatWindow.events.values()].filter(event => event.sourceRef?.kind === 'native' && event.sourceRef.sessionId === context.sessionId)
            .map(event => ({...event,seq:event.sourceRef.seq,sessionId:event.sourceRef.sessionId}));
        return context.source === 'phone' ? core.state.phoneHostEvents.get(context.conversationId) || [] : [...core.state.historyEvents.values()];
    }
    async function loadConversationResources(legacy = false) {
        if (!legacy && core.loadMainResources) return core.loadMainResources();
        const context = core.conversationTaskContext(), key = JSON.stringify(context);
        if (!core.conversationTaskCurrent(context) || !context.sessionId)
            return { outputs: [], sources: [] };
        if (core.resourceCache?.key !== key)
            core.resourceCache = { key, sources: new Map(), cursor: -1, outputs: [], versions: new Map() };
        const cache = core.resourceCache;
        if (cache.pending)
            return cache.pending;
        const read = async () => {
            let more;
            do {
                const page = await core.accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/resources?afterSeq=${cache.cursor}`);
                if (!core.conversationTaskCurrent(context) || core.resourceCache !== cache)
                    throw { code: 'STALE_CONTEXT' };
                const taskArtifacts = [...core.conversationTasks.entries.values()].filter(entry => entry.sessionId === context.sessionId).flatMap(entry => entry.payload?.artifacts || []);
                const eventArtifacts = core.timelineEventsForContext(context).filter(event => event.type === 'artifact.created').flatMap(event =>
                    (event.data?.artifacts || [event.data]).map(artifact => ({ ...artifact, at: event.at, sessionId: context.sessionId })));
                for (const artifact of [...eventArtifacts, ...taskArtifacts, ...page.outputs]) {
                    if (artifact?.artifactId) cache.versions.set(artifact.artifactId, { ...cache.versions.get(artifact.artifactId), ...artifact });
                }
                cache.outputs = core.deduplicateOutputs([...cache.versions.values()]);
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
            return { outputs: cache.outputs, sources: [...cache.sources.values()].map(item => ({ ...item, toolName: item.kind === 'tool' ? item.name : undefined, name: item.kind === 'tool' ? core.toolLabel(item.name) : item.name, uses: item.uses.map(use => ({ ...use, summary: item.kind === 'tool' && use.summary === item.name ? core.toolLabel(item.name) : core.interfaceText(use.summary) })) })) };
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
            for (const command of core.state.tasks)
                if (command.kind === 'session.message' && command.rootTaskId) core.conversationTasks.entries.delete(command.commandId);
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
        const optimisticCreate = core.handleOptimisticCreation?.(command);
        core.reconcileOptimistic?.(command);
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
        core.operation(command.state === 'accepted_by_dsh' && ['session.create', 'session.side.create', 'session.message', 'chat.message'].includes(command.kind) ? '' : core.commandStatus(command), locked, command.requestId, command.state === 'uncertain');
        if (command.kind === 'session.create' && command.state === 'accepted_by_dsh' && command.sessionId && !core.creatingOptimisticSession && !optimisticCreate) {
            void core.refreshSessions().then(() => core.selectSession(command.sessionId));
        }
    }
    async function lookupRequest(marker) {
        try {
            const payload = await core.accessApi(`/commands/by-request/${encodeURIComponent(marker.requestId)}`);
            if (!core.readMarkers().some((row) => row.requestId === marker.requestId))
                return;
            if (payload.command) {
                const index = core.state.tasks.findIndex(item => item.commandId === payload.command.commandId);
                if (index >= 0) core.state.tasks[index] = payload.command;
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
        if (kind === 'session.message') {
            const { mode, ...rest } = fields;
            fields = { ...rest, intent: fields.intent || mode || 'steer' };
        }
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
            if (core.state.submitting || core.state.unresolvedSubmission)
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
    return { capturedSourceText, capturedSourceForUrl, deduplicateOutputs, timelineEventsForContext, loadConversationResources, refreshTasks, updateFromCommand, lookupRequest, restoreRequests, submitCommand };
};
