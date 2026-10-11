/* Shared messages state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.messages = (core, effects, environment) => {
    function normalizedOriginalAttachment(item) {
        if (!item || typeof item.attachmentId !== 'string' || !core.syncIdPattern.test(item.attachmentId)
            || typeof item.name !== 'string' || item.name !== item.name.trim() || !item.name ||
            Array.from(item.name).length > 128 || /[\x00-\x1f\x7f\\/]/.test(item.name) || ['.', '..'].includes(item.name)
            || typeof item.contentType !== 'string' || item.contentType.length > 127 ||
            !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(item.contentType)
            || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 1024 * 1024 * 1024
            || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256))
            return null;
        return { attachmentId: item.attachmentId, name: item.name, contentType: item.contentType,
            size: item.size, sha256: item.sha256 };
    }
    function normalizedOriginalFile(item) {
        const attachment = core.normalizedOriginalAttachment(item);
        return attachment && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(attachment.contentType)
            ? attachment : null;
    }
    function originalFileSize(size) {
        if (size >= 1024 * 1024 * 1024)
            return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
        if (size >= 1024 * 1024)
            return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
        if (size >= 1024)
            return `${Math.ceil(size / 1024)} KB`;
        return `${size} B`;
    }
    function unpreviewedOriginalImages(event) {
        const ids = Array.isArray(event.data?.unpreviewedOriginalImageIds)
            ? [...new Set(event.data.unpreviewedOriginalImageIds.filter((id) => typeof id === 'string' && core.syncIdPattern.test(id)))].slice(0, 4)
            : [];
        if (!ids.length)
            return [];
        const originals = new Map((Array.isArray(event.data?.originalAttachments) ? event.data.originalAttachments : [])
            .map(core.normalizedOriginalAttachment).filter((item) => item &&
            ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.contentType))
            .map((item) => [item.attachmentId, item]));
        return ids.map((id) => originals.get(id)).filter(Boolean);
    }
    function appendHistory(events, liveEvents, liveSeq) {
        const accepted = [];
        const sessionId = core.state.selectedSessionId;
        const previousLive = new Map([...core.state.historyEvents].filter(([,event])=>event.data?.live));
        if (liveSeq !== undefined && liveSeq < (core.state.liveMessageSeq ?? -1)) liveEvents = undefined;
        if (liveEvents !== undefined) {
            core.state.liveMessageSeq = liveSeq ?? core.state.liveMessageSeq;
            for (const [seq, event] of core.state.historyEvents) if (event.data?.live) core.state.historyEvents.delete(seq);
        }
        for (const event of events) {
            if (!Number.isSafeInteger(event?.seq) || core.state.seenSeq.has(event.seq))
                continue;
            if (typeof event.sessionId === 'string' && event.sessionId !== sessionId)
                continue;
            core.state.seenSeq.add(event.seq);
            if (Number.isSafeInteger(event.data?.streamSeq)) core.state.historyEvents.delete(event.data.streamSeq);
            core.state.historyEvents.set(event.seq, event);
            accepted.push(event);
        }
        for (const event of liveEvents || []) {
            if ([...core.state.historyEvents.values()].some(row => row.data?.streamSeq === event.seq && !row.data?.live)) continue;
            const message = { ...event, type: 'assistant.message', data: { ...event.data, streamSeq: event.seq, live: true } };
            core.state.historyEvents.set(event.seq, message);
            if (JSON.stringify(previousLive.get(event.seq)) !== JSON.stringify(message)) accepted.push(message);
        }
        const terminal = [...core.state.historyEvents.values()].filter(e => ['turn.started', 'turn.ended'].includes(e.type)).sort((a, b) => a.seq - b.seq).at(-1);
        if (terminal) {
            core.state.turnStatus = terminal.type === 'turn.started' ? 'running' : ['completed', 'aborted', 'error', 'blocked'].includes(terminal.data?.reason) ? terminal.data.reason : 'unknown';
            core.state.turnEndReasonKind = core.state.turnStatus === 'error' && terminal.data?.endReasonKind === 'max-tokens' ? 'max-tokens' : null;
        }
        core.observeOptimistic?.(accepted);
        const removedLive=[...previousLive.keys()].some(seq=>!core.state.historyEvents.has(seq));
        if(accepted.length||removedLive)effects.paintHistoryMessages(accepted);
        if(accepted.some(event=>!event.data?.live)||removedLive||accepted.some(event=>!previousLive.has(event.seq)))effects.updateAvailability();
        if (accepted.some(event => ['approval.requested', 'approval.resolved', 'question.asked', 'question.answered'].includes(event.type)))
            void Promise.all([core.refreshConversationApprovals(), core.refreshConversationQuestions()]).catch(() => {});
        if (core.state.personalCapabilities?.replyStreaming===1 && accepted.some(event => !event.data?.live && /^(user\.|turn\.|task\.|step\.|tool\.|approval\.|question\.|artifact\.)/.test(event.type))) void core.refreshConversationFacts?.();
        return accepted.length>0||removedLive;
    }
    let nativeResetScope, nativeResetAttempted = false;
    async function refreshHistory(reset = false, legacy = false, waitForChange = false) {
        if (!legacy && core.refreshLogicalHistory) return core.refreshLogicalHistory(reset,waitForChange);
        if (!reset && !core.historyReadAllowed()) return core.state.historyReadResult;
        const sessionId = core.state.selectedSessionId;
        if (core.state.activeChatSource !== 'desktop' || !sessionId || !core.state.online)
            return core.historyReadResult('cancelled');
        if (reset) {
            core.state.historyGeneration++;
            core.state.afterSeq = -1;
            core.state.historyHasMore = false;
            core.state.seenSeq.clear();
            core.state.historyEvents.clear();
            core.state.liveMessageSeq = -1;
            core.state.nextBeforeSeq = null;
            core.state.hasOlder = false;
            core.state.olderLoading = false;
            core.state.turnStatus = null;
            core.state.turnEndReasonKind = null;
            effects.clearHistoryView();
            effects.renderTurnStatus();
        }
        const generation = core.state.historyGeneration;
        const ownerId = core.state.ownerId;
        const resetScope = `${core.state.identityGeneration}:${ownerId}:${sessionId}`;
        if (nativeResetScope !== resetScope) {nativeResetScope=resetScope;nativeResetAttempted=false;}
        if (!reset && core.state.historyInFlight?.generation === generation)
            return core.state.historyInFlight.promise;
        const stillCurrent = () => core.state.activeChatSource === 'desktop' && core.state.historyGeneration === generation && core.state.ownerId === ownerId &&
            core.state.selectedSessionId === sessionId && !!core.state.csrfToken;
        const run = async () => {
            let changed = false;
            try {
                const maxPages = reset ? 10 : 5;
                for (let pageNo = 0; pageNo < maxPages; pageNo++) {
                    const cursor = core.state.afterSeq;
                    const page = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/events?${reset && pageNo === 0 ? '' : `afterSeq=${cursor}&`}limit=100`);
                    if (!stillCurrent())
                        return core.historyReadResult('cancelled');
                    if (!Array.isArray(page.events) || !Number.isSafeInteger(page.nextSeq) || page.nextSeq < cursor)
                        throw { code: 'REQUEST_FAILED' };
                    core.state.historyHasMore = page.hasMore === true;
                    if (reset && pageNo === 0) {
                        core.state.nextBeforeSeq = page.nextBeforeSeq;
                        core.state.hasOlder = page.hasOlder === true;
                        effects.renderOlderControl();
                    }
                    changed = core.appendHistory(page.events, page.liveEvents, page.liveSeq) || changed;
                    core.state.afterSeq = page.nextSeq;
                    if (!page.hasMore) {
                        effects.renderTurnStatus();
                        break;
                    }
                    if (pageNo === maxPages - 1)
                        effects.historyNotice('历史仍在补读，当前只显示已读取的一部分。');
                }
                if (!reset) nativeResetAttempted = false;
                return core.historyReadResult(changed ? 'changed' : 'unchanged');
            }
            catch (error) {
                if (!stillCurrent())
                    return core.historyReadResult('cancelled');
                if (error.code === 'CURSOR_RESET_REQUIRED' || error.status === 409) {
                    if (!nativeResetAttempted) {nativeResetAttempted=true;await core.refreshHistory(true,true);}
                    return core.historyReadResult('reset', {error});
                }
                else if (error.code === 'NETWORK')
                    effects.historyNotice('连接中断，稍后将从原位置续读。');
                else if (error.code !== 'UNAUTHORIZED')
                    effects.historyNotice('历史暂时无法读取，请稍后重试。', 'read-failure');
                return core.historyReadResult('failed', {error,terminal:!!globalThis.WeftUiCore.Presence.authState(error)});
            }
        };
        const promise = run();
        core.state.historyInFlight = { generation, promise };
        try {
            return await promise;
        }
        finally {
            if (core.state.historyInFlight?.promise === promise)
                core.state.historyInFlight = null;
        }
    }
    async function loadOlderHistory(legacy = false) {
        if (!legacy && core.inMainChat?.()) return core.loadOlderLogicalHistory();
        if (!core.state.hasOlder || core.state.olderLoading)
            return;
        const context = core.conversationTaskContext(), generation = core.state.historyGeneration;
        effects.beginOlderHistory();
        core.state.olderLoading = true;
        effects.renderOlderControl();
        try {
            const page = await core.accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/events?beforeSeq=${core.state.nextBeforeSeq}&limit=100`);
            if (!core.conversationTaskCurrent(context) || generation !== core.state.historyGeneration)
                return;
            core.state.nextBeforeSeq = page.nextBeforeSeq;
            core.state.hasOlder = page.hasOlder === true;
            if (context.source === 'phone') {
                const merged = new Map((core.state.phoneHostEvents.get(context.conversationId) || []).map(e => [e.seq, e]));
                for (const e of page.events)
                    merged.set(e.seq, e);
                core.state.phoneHostEvents.set(context.conversationId, [...merged.values()].sort((a, b) => a.seq - b.seq));
                const cursor = core.state.phoneHistoryCursors.get(context.conversationId);
                if (cursor) {
                    cursor.nextBeforeSeq = page.nextBeforeSeq;
                    cursor.hasOlder = page.hasOlder;
                }
                effects.renderSelectedPhoneConversation();
            }
            else
                core.appendHistory(page.events);
            effects.renderOlderControl();
            effects.restoreOlderHistoryPosition();
            void core.refreshConversationTasks();
        }
        catch {
            if (core.conversationTaskCurrent(context))
                effects.historyNotice('更早内容暂时无法读取，请重试。', 'read-failure');
        }
        finally {
            if (generation === core.state.historyGeneration) {
                core.state.olderLoading = false;
                effects.renderOlderControl();
            }
        }
    }
    function turnStatusViewModel(now = Date.now()) {
        if (core.state.activeChatSource === 'phone')
            return null;
        const started = [...core.state.historyEvents.values()].filter(event => event.type === 'turn.started')
            .sort((a, b) => a.seq - b.seq).at(-1);
        const stop = core.taskStopView?.(started?.data?.turn);
        if (stop && !core.state.historyHasMore) return { isRunning: false,
            message: stop.terminal ? `${stop.text}。核对已执行的步骤与成果后，可写明下一步。` : stop.text };
        let message = '';
        const isRunning = core.state.turnStatus === 'running' && core.conversationRunning(core.state.selectedSessionId);
        if (core.state.historyHasMore) {
            message = '正在补读会话历史，尚未核对到本轮结束。';
            return { isRunning, message };
        }
        switch (core.state.turnStatus) {
            case 'running': {
                if (!isRunning) {
                    message = '这轮对话尚无结束记录。请核对结果后继续。';
                    break;
                }
                const events = [...core.state.historyEvents.values()].sort((a, b) => a.seq - b.seq);
                const started = events.filter(e => e.type === 'turn.started').at(-1);
                const elapsed = now - Date.parse(started?.at);
                const duration = Number.isFinite(elapsed) && elapsed >= 0 ? ` ${Math.floor(elapsed / 60000)}分${Math.floor(elapsed % 60000 / 1000)}秒` : '';
                const steps = new Map();
                for (const event of events) {
                    const data = event.type.startsWith('step.') ? event.data : event.data?.completedStep;
                    if (data?.stepId && (!started || event.seq > started.seq))
                        steps.set(data.stepId, data);
                }
                const currentStep = [...steps.values()].filter(step => step.state === 'running').at(-1);
                message = `正在处理…${duration}${currentStep?.summary ? ` · ${currentStep.summary}` : ''}`;
                break;
            }
            case 'aborted':
                message = '本轮已停止。如需继续，请重新发送。';
                break;
            case 'blocked':
                message = '本轮因执行受限而停止，目标尚未确认完成。';
                break;
            case 'error':
                message = core.state.turnEndReasonKind === 'max-tokens'
                    ? '回复达到长度限制。发送“继续”接着处理。' : '这次处理未完成。请重试，或到设置检查模型。';
                break;
            case 'unknown':
                message = '本轮结束状态尚不明确，请在电脑核对。';
                break;
            default: message = '';
        }
        return { isRunning, message };
    }
    return { normalizedOriginalAttachment, normalizedOriginalFile, originalFileSize, unpreviewedOriginalImages, appendHistory, refreshHistory, loadOlderHistory, turnStatusViewModel };
};
