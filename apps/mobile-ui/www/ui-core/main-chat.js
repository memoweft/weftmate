/* Main chat integration. Execution, approvals and receipts remain native session facts. */
globalThis.WeftUiCore.factories.mainChat = (core, effects, environment) => {
    // IA-4 opts in after supplying logical-chat presentation effects.
    if (environment.mobileState && environment.logicalChats !== true) return {};
    const legacy = Object.fromEntries(['refreshSessions', 'refreshHistory', 'loadOlderHistory', 'startNewConversation',
        'sendDraft', 'optimisticMessages', 'observeOptimistic', 'composerState', 'attachmentDraftKey', 'loadConversationResources', 'clearSession'].map(key => [key, core[key]]));
    const historyWindow = globalThis.WeftUiCore.ChatWindow.create();
    const pending = new Map(), drafts = new Map();
    let sideWaitScope,sideWaitCursor,sideWaitRevision=0,sideWaitRead;
    let selectionGeneration = 0, unavailableChatId;
    core.state.chatWindow = historyWindow.state;
    const supports = name => core.state.personalCapabilities?.[name] === 1;
    const inHome = () => !!core.state.mainChat && core.state.selectedChatId === core.state.mainChat.chatId && core.state.activeChatSource === 'desktop';
    const timelineChat = () => core.state.workTimeline || core.state.mainChat;
    const inMain = () => inHome() || !!core.state.workTimeline && core.state.selectedChatId === core.state.workTimeline.chatId && core.state.activeChatSource === 'desktop';
    const scope = () => `${core.state.identityGeneration}:${core.state.ownerId}:${core.state.historyGeneration}:${core.state.selectedChatId}`;
    const notify = () => { effects.renderMainChat?.(); effects.renderOlderControl(); effects.updateAvailability(); };
    function rememberConversationDraft() {
        if (!core.state.sessionSelecting && !core.state.sideCreating)
            drafts.set(core.state.selectedChatId || core.state.selectedSessionId, effects.readMessageDraft());
    }
    function clearLogical(purge = false) {
        core.historyWaitAbort?.abort();
        sideWaitScope=null;sideWaitCursor=null;sideWaitRevision=0;
        if (purge) {
            for (const row of pending.values()) {
                if (row.status === 'accepted' && drafts.get(row.chatId) === row.text) drafts.set(row.chatId,'');
                if (row.status === 'accepted' && inMain() && effects.readMessageDraft() === row.text) effects.clearMessageDraft();
            }
            pending.clear();core.resetMessageProcesses?.();core.state.tasks=[];
            effects.removeResourcePreview();effects.closePhoneImagePreview();
        }
        historyWindow.reset(); core.state.historyGeneration++; core.resourceCache = null;
        core.resetConversationApprovals(); core.resetConversationQuestions();
        core.conversationTasks.generation++;core.conversationTasks.entries.clear();core.conversationTasks.inFlight=null;
        effects.clearHistoryView(); effects.resetMainChatView?.();
        effects.renderConversationApprovals();effects.renderConversationQuestions();
    }
    async function logicalRead(read) {
        const token = scope(), generation = historyWindow.state.generation;
        try {
            const result = await read();
            if (token !== scope() || generation !== historyWindow.state.generation) return null;
            if (historyWindow.state.contentRevision !== null && result.contentRevision !== undefined && result.contentRevision !== historyWindow.state.contentRevision) {
                clearLogical(true); notify(); await readPage({}, 'tail'); return null;
            }
            return result;
        } catch (error) {
            if (token !== scope() || generation !== historyWindow.state.generation) return null;
            if (error.code === 'CURSOR_RESET_REQUIRED') { clearLogical(true); notify(); await readPage({}, 'tail'); return null; }
            throw error;
        }
    }
    function installMain(chat) {
        core.state.mainChat = chat;
        core.state.sessions = core.state.sessions.filter(row => row.kind !== 'main');
        if (chat.activeSessionId) core.state.sessions.push({ ...chat, kind: 'main', sessionId: chat.activeSessionId,
            title: core.supportsWorkModes?.() ? chat.displayTitle || '小纬' : 'WeftMate', pinned: !core.supportsWorkModes?.(), taskAvailable: true });
        if (inHome()) core.state.selectedSessionId = chat.activeSessionId;
    }
    let readingLatest = false;
    async function markLatestChatRead() {
        if (!inHome() || !supports('sessionStatus') || historyWindow.state.hasNewer || !core.state.mainChat.unread || readingLatest) return;
        const token = scope(), chat = core.state.mainChat; readingLatest = true;
        try {
            const result = await core.accessApi(`/chats/${encodeURIComponent(chat.chatId)}/metadata`, {method:'PATCH',protectedWrite:true,
                body:{requestId:environment.crypto.randomUUID(),expectedRevision:chat.revision,unread:false}});
            if (scope() !== token) return;
            installMain(result.chat); await refreshSessions();
        } catch { /* A stale revision/connection preserves unread until the next latest-position read. */ }
        finally { readingLatest = false; }
    }
    async function refreshSessions() {
        if (!supports('chats')) return legacy.refreshSessions(true);
        const identity = core.state.identityGeneration;
        const main = await core.readMainChat();
        if (identity !== core.state.identityGeneration) return;
        installMain(main.chat);
        // Readable/input-ready main tail is independent of the complete sidebar.
        if (!core.state.selectedChatId && !core.state.selectedSessionId && !core.state.newConversation && main.chat.chatId !== unavailableChatId) {
            if (core.supportsWorkModes?.()) await core.startSidebarConversation(true);
            else await selectMainChat();
        }
        const listGeneration = core.state.sessionListGeneration || 0;
        const params = new URLSearchParams({archived:'all',limit:100,...(core.state.sessionListQuery ? {q:core.state.sessionListQuery} : {})});
        const sessionParams = new URLSearchParams(params), chatParams = new URLSearchParams(params);
        if (core.state.sessionListCursor) sessionParams.set('cursor',core.state.sessionListCursor);
        if (core.state.chatListCursor) chatParams.set('cursor',core.state.chatListCursor);
        let sessions, chats;
        try { [sessions, chats] = await Promise.all([core.accessApi('/sessions?'+sessionParams), core.accessApi('/chats?'+chatParams)]); }
        catch(error) {
            if (identity === core.state.identityGeneration && listGeneration === (core.state.sessionListGeneration || 0) && error.code === 'CURSOR_RESET_REQUIRED') {
                core.state.sessionListCursor=null;core.state.chatListCursor=null;return refreshSessions();
            }
            throw error;
        }
        if (listGeneration !== (core.state.sessionListGeneration || 0)) return;
        if (identity !== core.state.identityGeneration) return;
        core.state.chats = chats.items || [];
        if (core.state.workTimeline || core.state.chats.some(row => row.chatId === core.state.selectedChatId && row.logicalHistory))
            core.state.workTimeline = core.state.chats.find(row => row.chatId === core.state.selectedChatId && row.logicalHistory) || null;
        core.state.sessionListNextCursor = sessions.nextCursor;
        core.state.chatListNextCursor = chats.nextCursor;
        // Keep the native snapshot clock when projecting logical chats. The
        // composer compares newer native turn events against this clock so a
        // sidebar poll is not a prerequisite for showing the stop button.
        core.state.sessionSnapshotAt = sessions.snapshotAt ?? null;
        core.state.sessionStatusSummary = sessions.statusSummary ?? chats.statusSummary ?? null;
        const bySession = new Map(core.state.chats.map(chat => [chat.activeSessionId, chat]));
        const selected = core.state.sessions.find(row => row.sessionId === core.state.selectedSessionId);
        core.state.sessions = (sessions.sessions || []).map(row => ({ ...row, ...bySession.get(row.sessionId) }));
        if (selected && !core.state.sessions.some(row => row.sessionId === selected.sessionId)) core.state.sessions.push(selected);
        core.state.sessionGroups = sessions.groups || []; installMain(main.chat);
        await core.refreshSessionProjects(); effects.renderSessions(); effects.paintSelectedSession(core.state.selectedSessionId); notify();
    }
    async function pageSessions(older = true) {
        core.state.sessionListGeneration = (core.state.sessionListGeneration || 0) + 1;
        core.state.sessionListCursor = older ? core.state.sessionListNextCursor : null;
        core.state.chatListCursor = older ? core.state.chatListNextCursor : null;
        await refreshSessions();
    }
    async function searchSessions(query) {
        core.state.sessionListQuery = query.trim();
        await pageSessions(false);
    }
    function cancelSessionSelection() { selectionGeneration++;core.state.sessionSelecting=false;core.state.sideCreating=null;effects.updateAvailability(); }
    async function selectMainChat(anchor) {
        if (!supports('chats') || !core.state.mainChat) return;
        if (!anchor && core.state.activeChatSource === 'desktop' && core.state.selectedChatId === core.state.mainChat.chatId && !core.state.newConversation) {
            effects.showConversation(); effects.closeRail(); return;
        }
        core.state.workTimeline = null;
        unavailableChatId = null;
        rememberConversationDraft();
        selectionGeneration++; core.state.sessionSelecting = false;core.state.sideCreating=null;
        core.cancelAttachmentUpload(); core.state.activeChatSource = 'desktop'; core.state.selectedPhoneConversationId = null;
        core.state.selectedChatId = core.state.mainChat.chatId; core.state.selectedSessionId = core.state.mainChat.activeSessionId;
        if (core.state.mainChat.selectedModelProfileId || core.state.mainChat.modelProfileId) { core.state.modelProfileId = core.state.mainChat.selectedModelProfileId || core.state.mainChat.modelProfileId; effects.paintModels(); }
        core.state.newConversation = false; core.state.newConversationTemporary = false; core.state.historyGeneration++; core.state.historyEvents.clear(); core.state.seenSeq.clear();
        core.resetConversationApprovals(); core.resetConversationQuestions(); core.state.turnStatus = null;
        clearLogical(); effects.restoreMainChatDraft?.(drafts.get(core.state.selectedChatId) || '');
        effects.paintSelectedSession(core.state.selectedSessionId); effects.renderSessions(); effects.showConversation(); effects.closeRail();
        notify();
        if (supports('chatTimeline')) await readPage(anchor ? { around: anchor } : {}, 'tail');
        else effects.historyNotice('这台电脑尚不支持主对话历史，请更新电脑程序。');
        if (anchor) {
            const event = historyWindow.state.events.get(anchor);
            if (event) { historyWindow.state.expanded.add(globalThis.WeftUiCore.ChatWindow.day(event.at,historyWindow.state.timeZone)); notify(); }
            effects.focusMainEvent?.(anchor);
        } else { effects.scrollToLatest(); void markLatestChatRead(); }
        await core.refreshConversationTasks();
        void core.refreshApprovalMode(core.state.selectedSessionId);
    }
    async function selectSession(id, {empty = false, creating = false} = {}) {
        if (!creating && core.state.activeChatSource === 'desktop' && core.state.selectedSessionId === id && !core.state.newConversation) {
            effects.showConversation(); effects.closeRail(); return;
        }
        if (core.state.mainChat?.activeSessionId === id) return selectMainChat();
        rememberConversationDraft();
        const logical = core.state.chats?.find(row => row.activeSessionId === id && row.logicalHistory);
        if (logical) {
            const generation = ++selectionGeneration, identity = core.state.identityGeneration;
            core.state.sessionSelecting = false; core.state.sideCreating = null;
            core.cancelAttachmentUpload(); core.state.workTimeline = logical; core.state.activeChatSource = 'desktop';
            core.state.selectedPhoneConversationId = null; core.state.selectedSessionId = id; core.state.selectedChatId = logical.chatId;
            core.state.modelProfileId = logical.modelProfileId || logical.selectedModelProfileId || core.state.modelProfileId;
            core.state.newConversation = false; core.state.historyEvents.clear(); core.state.seenSeq.clear(); clearLogical();
            effects.paintSelectedSession(id); effects.renderSessions(); effects.showConversation(); effects.closeRail();
            await readPage({}, 'tail');
            if (generation !== selectionGeneration || identity !== core.state.identityGeneration) return;
            effects.restoreMainChatDraft?.(drafts.get(logical.chatId) || '');
            effects.scrollToLatest(); await core.refreshConversationTasks(); return;
        }
        core.state.workTimeline = null;
        if(!creating)core.state.sideCreating=null;
        const generation = ++selectionGeneration, identity = core.state.identityGeneration;
        core.state.sessionSelecting = true; core.cancelAttachmentUpload(); notify();
        core.state.selectedChatId = null; clearLogical();
        try {
            if (supports('chats') && !core.state.chats?.some(row => row.activeSessionId === id)) {
                const resolved = await core.accessApi(`/sessions/${encodeURIComponent(id)}/chat`);
                const chat = (await core.readChat(resolved.chatId)).chat;
                if (generation !== selectionGeneration || identity !== core.state.identityGeneration) return;
                core.state.chats.push(chat);
            }
            if (environment.mobileState) await effects.selectNativeSideSession(id, empty, () => generation === selectionGeneration && identity === core.state.identityGeneration);
            else await core.selectNativeSession(id, !empty);
            if (generation !== selectionGeneration || identity !== core.state.identityGeneration) return;
            const chat = core.state.chats?.find(row => row.activeSessionId === id);
            core.state.selectedChatId = chat?.chatId || null;
            if (!creating) effects.restoreMainChatDraft?.(drafts.get(chat?.chatId || id) || '');
            effects.renderChatOrigin?.(chat);
        } finally {
            if (generation === selectionGeneration && identity === core.state.identityGeneration) { core.state.sessionSelecting = false; notify(); }
        }
    }
    async function readPage(params, direction) {
        const token = scope(), generation = historyWindow.state.generation;
        core.state.logicalHistoryLoading = !historyWindow.state.events.size;
        notify();
        try {
            const page = await core.readChatEvents(core.state.selectedChatId, { limit: 200, ...params });
            if (token !== scope() || generation !== historyWindow.state.generation) return {kind:'cancelled'};
            if (historyWindow.state.contentRevision !== null && historyWindow.state.contentRevision !== page.contentRevision)
                return failedRead({code:'CURSOR_RESET_REQUIRED',status:409}, token);
            if (page.items?.some(event => event.data?.truncated))
                page.items = await core.completeHistoryEvents(page.items, historyWindow.state.events);
            if (token !== scope() || generation !== historyWindow.state.generation) return {kind:'cancelled'};
            core.acceptAccountChanges?.(page.accountChanges);
            await reconcileMainRequests();
            if (token !== scope() || generation !== historyWindow.state.generation) return {kind:'cancelled'};
            historyWindow.merge(page, direction); core.observeOptimistic(page.items || []); notify();
            void Promise.all([core.refreshConversationApprovals(),core.refreshConversationQuestions()]).catch(()=>{});
            void refreshChatDates().catch(() => {});
            if (page.deletedAnchor) effects.historyNotice('原消息已删除，已显示邻近内容。');
            return core.historyReadResult('changed');
        } catch (error) {
            if (token !== scope() || generation !== historyWindow.state.generation) return {kind:'cancelled'};
            effects.historyNotice('历史暂时无法读取，请重试。', 'read-failure');
            return failedRead(error, token);
        } finally {
            if (token === scope() && generation === historyWindow.state.generation) { core.state.logicalHistoryLoading = false; notify(); }
        }
    }
    async function refreshChatDates() {
        const events = historyWindow.ordered(); if (!events.length) return;
        const token = scope(), generation = historyWindow.state.generation;
        const first = globalThis.WeftUiCore.ChatWindow.day(events[0].at, historyWindow.state.timeZone), last = globalThis.WeftUiCore.ChatWindow.day(events.at(-1).at, historyWindow.state.timeZone);
        // Read each visible month independently; the API accepts at most 31 days.
        const months = [...new Set([first.slice(0, 7), last.slice(0, 7)])];
        for (const month of months) {
            const [year, number] = month.split('-').map(Number), end = new Date(Date.UTC(year, number, 0)).getUTCDate();
            const page = await logicalRead(() => core.readChatDates(core.state.selectedChatId, `${month}-01`, `${month}-${end}`));
            if (!page) return;
            if (token !== scope() || generation !== historyWindow.state.generation) return;
            if (historyWindow.state.contentRevision !== page.contentRevision) { clearLogical(true); await readPage({}, 'tail'); return; }
            for (const date of page.days) historyWindow.state.dayCounts.set(date.date, date.count);
        }
        notify();
    }
    let resetAttempted = false, resetScope;
    async function failedRead(error, token) {
        if (token !== scope() || error.code === 'ABORTED' || error.name === 'AbortError') return core.historyReadResult('cancelled');
        if (error.code === 'CURSOR_RESET_REQUIRED' || error.status === 409) {
            // A continuous 409 may rebuild the tail once, never on every retry.
            if (resetScope !== token) { resetScope = token; resetAttempted = false; }
            if (!resetAttempted) {
                resetAttempted = true;
                if (inMain()) { clearLogical(true); resetScope = scope(); notify(); await readPage({}, 'tail'); }
                else sideWaitCursor = null;
            }
            return core.historyReadResult('reset', { error });
        }
        if (error.status === 404 || ['NOT_FOUND','CHAT_UNAVAILABLE','SESSION_UNAVAILABLE'].includes(error.code)) {
            unavailableChatId = core.state.selectedChatId;
            clearLogical(true);
            core.state.selectedChatId = null; core.state.selectedSessionId = null;
            notify();
        }
        core.connectionFailed?.(error);
        return core.historyReadResult('failed', { error, terminal:!!globalThis.WeftUiCore.Presence.authState(error) });
    }
    async function refreshHistory(reset = false, waitForChange = false) {
        if (!reset && !core.historyReadAllowed()) return core.state.historyReadResult;
        if (!inMain()) {
            if (waitForChange && core.canWaitForReply() && core.state.selectedChatId && !reset) {
                if (sideWaitRead) return sideWaitRead;
                const token = scope(), chatId = core.state.selectedChatId, controller = new AbortController();
                core.historyWaitAbort = controller;
                sideWaitRead = (async () => {
                    if (sideWaitScope !== token || !sideWaitCursor) {
                        const page = await core.readChatEvents(chatId, {limit:1}, {signal:controller.signal});
                        if (token !== scope() || controller.signal.aborted) return core.historyReadResult('cancelled');
                        core.acceptAccountChanges?.(page.accountChanges);
                        // The baseline cursor already includes changes since the
                        // initial session read. Catch up native history before
                        // waiting for changes *after* that cursor, or an existing
                        // message/approval can stay hidden for the whole wait.
                        if (core.state.historyInFlight?.generation === core.state.historyGeneration) await core.state.historyInFlight.promise;
                        if (token !== scope() || controller.signal.aborted) return core.historyReadResult('cancelled');
                        const history = await legacy.refreshHistory(false, true);
                        if (token !== scope() || controller.signal.aborted) return core.historyReadResult('cancelled');
                        if (['failed','reset','cancelled'].includes(history?.kind)) return history;
                        sideWaitScope = token; sideWaitCursor = page.syncCursor; sideWaitRevision = page.liveRevision ?? 0;
                        return core.historyReadResult(history.kind, {immediateRenew:true});
                    }
                    const page = await core.readChatChanges(chatId, sideWaitCursor, 200,
                        {ms:core.replyWaitMilliseconds(), liveRevision:sideWaitRevision, signal:controller.signal});
                    if (token !== scope() || controller.signal.aborted) return core.historyReadResult('cancelled');
                    sideWaitCursor = page.nextCursor; sideWaitRevision = page.liveRevision;
                    core.acceptAccountChanges?.(page.accountChanges);
                    const history = await legacy.refreshHistory(false, true);
                    if (['failed','reset','cancelled'].includes(history?.kind)) return history;
                    resetAttempted = false;
                    return core.historyReadResult(page.upserts?.length || page.removals?.length ? 'changed' : 'unchanged',
                        {immediateRenew:['timeout','changed'].includes(page.waitOutcome)});
                })().catch(error => failedRead(error, token)).finally(() => {
                    if (core.historyWaitAbort === controller) core.historyWaitAbort = null;
                    sideWaitRead = null;
                });
                return sideWaitRead;
            }
            if (sideWaitRead) { core.historyWaitAbort?.abort(); await sideWaitRead; }
            return legacy.refreshHistory(reset, true);
        }
        if (!supports('chatTimeline')) return core.historyReadResult('cancelled');
        if (reset || !historyWindow.state.syncCursor) {
            if (reset) clearLogical(true);
            return readPage({}, 'tail');
        }
        if (core.mainChatRefreshing) {
            if (!waitForChange && core.historyWaitAbort) {
                core.historyWaitAbort.abort(); await core.mainChatRefreshPromise; return refreshHistory(reset, false);
            }
            return core.mainChatRefreshPromise;
        }
        let release;
        core.mainChatRefreshPromise = new Promise(resolve => { release = resolve; });
        core.mainChatRefreshing = true;
        const token = scope(), generation = historyWindow.state.generation;
        let outcome;
        try {
            const waiting = waitForChange && core.canWaitForReply() && !core.state.submitting && !core.state.unresolvedSubmission;
            const controller = waiting ? new AbortController() : null;
            if (controller) core.historyWaitAbort = controller;
            const page = await core.readChatChanges(core.state.selectedChatId, historyWindow.state.syncCursor, 200,
                controller ? {ms:core.replyWaitMilliseconds(),liveRevision:historyWindow.state.liveRevision ?? 0,signal:controller.signal} : undefined);
            if (token !== scope() || generation !== historyWindow.state.generation || controller?.signal.aborted)
                return outcome = core.historyReadResult('cancelled');
            if (historyWindow.state.contentRevision !== page.contentRevision)
                return outcome = await failedRead({code:'CURSOR_RESET_REQUIRED',status:409}, token);
            historyWindow.state.anchorId = effects.mainChatAnchor?.() || null;
            if (page.upserts?.some(event => event.data?.truncated))
                page.upserts = await core.completeHistoryEvents(page.upserts, historyWindow.state.events);
            if (token !== scope() || generation !== historyWindow.state.generation) return outcome = core.historyReadResult('cancelled');
            const before = JSON.stringify(historyWindow.ordered());
            await reconcileMainRequests();
            if (token !== scope()) return core.historyReadResult('cancelled');
            historyWindow.merge(page, 'changes'); core.observeOptimistic(page.upserts || []);
            if (before !== JSON.stringify(historyWindow.ordered())) {
                if (!(page.upserts?.length || page.removals?.length)) { if (effects.paintLiveChatMessages?.() !== true) effects.renderMainChat?.(); }
                else notify();
            }
            core.acceptAccountChanges?.(page.accountChanges);
            if (page.upserts?.length || page.removals?.length) void core.refreshConversationFacts?.();
            if (page.upserts?.length || page.removals?.length) {
                const main = core.state.workTimeline ? await core.readChat(core.state.selectedChatId) : await core.readMainChat();
                if (token === scope()) { const changed = JSON.stringify(timelineChat()) !== JSON.stringify(main.chat);
                    if (core.state.workTimeline) core.state.workTimeline = main.chat; else installMain(main.chat); if (changed) notify(); }
            }
            resetAttempted = false;
            return outcome = core.historyReadResult(before !== JSON.stringify(historyWindow.ordered()) ? 'changed' : 'unchanged',
                {immediateRenew:waiting && ['timeout','changed'].includes(page.waitOutcome)});
        } catch (error) { return outcome = await failedRead(error, token); }
        finally { core.mainChatRefreshing = false; core.historyWaitAbort = null; release(outcome); }
    }
    async function loadOlderHistory(direction = 'older') {
        if (!inMain()) return legacy.loadOlderHistory(true);
        if (core.state.olderLoading || !historyWindow.state[direction === 'older' ? 'hasOlder' : 'hasNewer']) return;
        const events = historyWindow.ordered(), cursor = historyWindow.state[direction === 'older' ? 'olderCursor' : 'newerCursor'];
        if (!events.length) return;
        core.state.olderLoading = true; effects.beginOlderHistory();
        try {
            await readPage(cursor ? { [direction === 'older' ? 'before' : 'after']: cursor } : { around: (direction === 'older' ? events[0] : events.at(-1)).eventId }, direction);
            effects.restoreOlderHistoryPosition();
        } finally { core.state.olderLoading = false; notify(); }
    }
    async function jumpChatDate(date) {
        if (!supports('chatTimeline')) return effects.historyNotice('请更新电脑程序以跳转主对话日期。');
        const token = scope(); const result = await logicalRead(() => core.locateChatDate(core.state.selectedChatId, date));
        if (!result) return;
        if (token !== scope()) return;
        historyWindow.state.indexState = result.indexState;
        if (!result.eventId) { effects.historyNotice(result.indexState === 'building' ? '仍在整理历史，请稍后再试。' : result.indexState === 'failed' ? '历史整理失败，请重新打开主对话。' : '这一天没有记录。'); return; }
        historyWindow.state.events.clear(); historyWindow.state.expanded.add(date); await readPage({ around: result.eventId }, 'tail'); effects.focusMainEvent?.(result.eventId);
    }
    async function searchMainChat(query, more = false) {
        if (!supports('chatSearch')) return effects.historyNotice('请更新电脑程序以搜索主对话。');
        const token = scope(), generation = historyWindow.state.generation;
        const search = historyWindow.state.search;
        if (!more) historyWindow.state.search = { query, hits: [], index: -1 };
        if (!query.trim()) { notify(); return; }
        const result = await logicalRead(() => core.searchChat(core.state.selectedChatId, { q: query, limit: 100, ...(more && search.nextCursor ? { cursor: search.nextCursor } : {}) }));
        if (!result) return;
        if (token !== scope() || generation !== historyWindow.state.generation || historyWindow.state.search.query !== query) return;
        historyWindow.state.search.hits = more ? [...search.hits, ...result.hits] : result.hits;
        historyWindow.state.search.nextCursor = result.nextCursor; historyWindow.state.search.hasMore = result.hasMore;
        historyWindow.state.indexState = result.indexState; notify();
        if (historyWindow.state.search.hits.length) await moveSearchHit(1);
    }
    async function moveSearchHit(delta) {
        const search = historyWindow.state.search; if (!search.hits.length) return;
        search.index = (search.index + delta + search.hits.length) % search.hits.length;
        const hit = search.hits[search.index];
        historyWindow.state.expanded.add(globalThis.WeftUiCore.ChatWindow.day(hit.at, historyWindow.state.timeZone));
        if (!historyWindow.state.events.has(hit.eventId)) { historyWindow.state.events.clear(); await readPage({ around: hit.eventId }, 'tail'); }
        notify(); effects.focusMainEvent?.(hit.eventId);
    }
    async function openSideChat(fields = {}) {
        if (!supports('sideChats')) return legacy.startNewConversation(true);
        if (core.state.unresolvedSubmission && !core.sideCreateIntent) return effects.toast('请先核对原请求，再开对话。');
        const token = scope(), source = core.state.chats?.find(chat => chat.chatId === core.state.selectedChatId);
        const sourceDraftId = core.state.selectedChatId || core.state.selectedSessionId, sourceAttachmentKey = core.attachmentDraftKey();
        const draft = effects.readMessageDraft(), files = [...core.currentAttachmentDrafts()];
        drafts.set(sourceDraftId,draft);
        core.sideCreateIntent ||= { requestId: environment.crypto.randomUUID(), kind: 'session.side.create', targetDeviceId: core.state.hostId,
            parent: source?.projectId ? { kind: 'project', id: source.projectId } : { kind: 'main', id: core.state.mainChat.chatId },
            modelProfileId: core.state.modelProfileId, ...fields };
        const intent = core.sideCreateIntent;
        const creating=core.state.sideCreating ||= {requestId:intent.requestId,identity:core.state.identityGeneration};notify();
        try {
        core.rememberMarker({requestId:intent.requestId,kind:'session.side.create'});
        core.trackRequestState(true,intent.requestId);
        let command;
        try { command = (await core.accessApi(`/commands/by-request/${encodeURIComponent(intent.requestId)}`)).command; }
        catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
        if (!command) {
            try { command = (await core.createSideChat(intent)).command; }
            catch (error) {
                if (error.status >= 400 && error.status < 500 && error.code !== 'REQUEST_CONFLICT') {core.sideCreateIntent=null;core.forgetMarker(intent.requestId);core.operation('对话未创建，请核对后重试。',false,intent.requestId);}
                throw error;
            }
        }
        for (let n = 0; n < 180 && ['pending', 'dispatching'].includes(command?.state); n++) {
            await new Promise(resolve => setTimeout(resolve, 250)); command = (await core.accessApi(`/commands/by-request/${encodeURIComponent(intent.requestId)}`)).command;
            if (token !== scope()) return;
        }
        if (command?.state !== 'accepted_by_dsh') {
            if (['rejected','failed'].includes(command?.state)) {core.sideCreateIntent=null;core.forgetMarker(intent.requestId);core.operation('对话未创建，请重试。',false,intent.requestId);}
            throw { code: command?.errorCode || 'NETWORK' };
        }
        if (token !== scope()) return;
        core.updateFromCommand(command);
        core.sideCreateIntent = null;
        if (token !== scope()) return;
        // Read just the accepted entity; the sidebar poll is independent of input readiness.
        const created = (await core.readChat(command.chatId)).chat;
        if (token !== scope()) return;
        core.state.chats = [created, ...core.state.chats.filter(row => row.chatId !== created.chatId)].slice(0,100);
        core.state.sessions = [{ ...created, sessionId: command.sessionId }, ...core.state.sessions.filter(row => row.sessionId !== command.sessionId && row.kind !== 'main')].slice(0,100);
        installMain(core.state.mainChat);
        const identity = core.state.identityGeneration;
        await selectSession(command.sessionId, {empty:!created.originRefs?.length,creating:true});
        if (identity !== core.state.identityGeneration || core.state.selectedSessionId !== command.sessionId) return;
        const selectedScope=scope();core.state.sessionSelecting=true;notify();
        try {
            effects.restoreMainChatDraft?.(draft);
            if (files.length && environment.mobileState) await effects.transferNativeAttachments(sourceAttachmentKey, core.attachmentDraftKey(), files);
            else if (files.length) core.state.attachmentDrafts.set(core.attachmentDraftKey(), files);
            if (selectedScope !== scope()) return;
            drafts.set(sourceDraftId,'');if(sourceAttachmentKey)core.state.attachmentDrafts.delete(sourceAttachmentKey);
            effects.renderAttachmentDrafts(); effects.renderChatOrigin?.(created);
        } finally { if(selectedScope===scope()){core.state.sessionSelecting=false;notify();} }
        } catch(error) {
            if(creating.identity===core.state.identityGeneration && core.sideCreateIntent===intent)
                core.operation('对话创建结果尚未确认，请核对后重试。',true,intent.requestId);
            throw error;
        } finally {if(core.state.sideCreating===creating){core.state.sideCreating=null;notify();}}
    }
    async function checkMainRequest(row) {
        const token = core.state.identityGeneration;
        let result;
        try { result = await core.accessApi(`/commands/by-request/${encodeURIComponent(row.requestId)}`); }
        catch (error) {
            if (token !== core.state.identityGeneration || row.ownerId !== core.state.ownerId) return;
            row.status = error.code === 'NOT_FOUND' ? 'undelivered' : 'confirming';
            notify();return;
        }
        if (token !== core.state.identityGeneration || row.ownerId !== core.state.ownerId) return;
        row.command = result.command; row.receiptId = row.command?.receiptId; row.sessionId = row.command?.sessionId || row.sessionId;
        core.rememberTurnRequest(row);
        row.status = ['accepted_by_dsh', 'observed'].includes(row.command?.state) ? 'accepted' : ['rejected', 'failed', 'uncertain'].includes(row.command?.state) ? 'failed' : 'sending';
        core.updateFromCommand(row.command);
        if (row.receiptId) observeOptimistic(historyWindow.ordered());
        if (row.status === 'accepted' && drafts.get(row.chatId) === row.text) drafts.set(row.chatId,'');
        if (row.status === 'accepted' && inMain() && row.command?.sessionId && core.state.selectedSessionId !== row.command.sessionId) {
            const chat = await core.readMainChat();
            if (token !== core.state.identityGeneration || !inMain()) return;
            installMain(chat.chat);
            void Promise.all([core.refreshApprovalMode(core.state.selectedSessionId), core.refreshConversationApprovals(), core.refreshConversationQuestions()]).catch(() => {});
        }
        if (row.status === 'accepted' && inMain() && effects.readMessageDraft() === row.text) effects.clearMessageDraft();
        notify();
    }
    async function reconcileMainRequests() {
        for (const row of pending.values()) if (row.ownerId === core.state.ownerId && ['sending','confirming','failed'].includes(row.status)) await checkMainRequest(row);
    }
    async function retryMainRequest(requestId) {
        const row = pending.get(requestId);
        if (!row || row.retrying || row.ownerId !== core.state.ownerId || core.state.submitting) return;
        row.retrying = true;
        const token = core.state.identityGeneration;
        try {
            await checkMainRequest(row); // Always query before replay; never generate a new request ID.
            if (token !== core.state.identityGeneration || row.status !== 'undelivered') return;
            row.status = 'sending';notify();
            core.trackRequestState(true,requestId,false);
            const command = core.originalMessageBody(requestId) ? await core.replayOriginalMessage(requestId)
                : environment.mobileState && row.nativeFields ? await effects.sendMainNativeMessage(row.nativeFields)
                : row.attachmentSnapshot && inMain() && row.chatId === core.state.selectedChatId
                    ? (core.trackRequestState(false,requestId), await core.sendDesktopMessageWithAttachments(row.text,requestId,row.nativeFields.intent,row.attachmentSnapshot)) : null;
            if (!command) row.status = 'undelivered';
            else await checkMainRequest(row);
            await refreshHistory();
        } catch { if (token === core.state.identityGeneration) row.status = 'confirming'; }
        finally { row.retrying = false;notify(); }
    }
    async function sendDraft(text = effects.readMessageDraft(), intent) {
        if (!inMain() || core.state.workTimeline) return legacy.sendDraft(text, intent, true);
        const blocker = core.sendBlocker(text, true);
        if (blocker) return core.explainSendBlocker(blocker);
        const attachments = core.currentAttachmentDrafts();
        const row = { ownerId: core.state.ownerId, chatId: core.state.selectedChatId, sessionId:core.state.selectedSessionId, requestId: attachments.length ? core.attachmentAttempt(core.attachmentDraftKey(), text, attachments).requestId : environment.crypto.randomUUID(), text, at:new Date().toISOString(), status: 'sending', files: attachments.map(item => item.file.name) };
        core.rememberTurnRequest(row);
        pending.set(row.requestId, row); notify(); effects.scrollToLatest();
        row.nativeFields = {chatId:row.chatId,text,requestId:row.requestId,modelProfileId:core.state.modelProfileId,intent:intent || core.composerInputMode(core.state.selectedSessionId),attachmentIds:attachments.map(item=>item.attachmentId)};
        if(attachments.length && !environment.mobileState)row.attachmentSnapshot={drafts:[...attachments],modelProfileId:row.nativeFields.modelProfileId};
        if(environment.mobileState && environment.logicalChats) {
            core.rememberMarker({requestId:row.requestId,kind:'chat.message'});
        }
        try {
            if (historyWindow.state.hasNewer) {
                historyWindow.state.events.clear(); historyWindow.state.hasNewer = false;
                await readPage({}, 'tail'); notify(); effects.scrollToLatest();
            }
            const command = environment.mobileState ? await effects.sendMainNativeMessage(row.nativeFields) : attachments.length ? await core.sendDesktopMessageWithAttachments(text, row.requestId, row.nativeFields.intent,row.attachmentSnapshot)
                : await core.submitCommand('chat.message', { chatId: row.chatId, text, modelProfileId: core.state.modelProfileId, mode: intent || core.composerInputMode(core.state.selectedSessionId) }, null, row.requestId);
            await checkMainRequest(row);
            await refreshHistory(false,true);
        } catch { row.status = 'confirming'; } finally { notify(); }
    }
    function observeOptimistic(events) {
        if (core.state.workTimeline) return legacy.observeOptimistic(events, true);
        legacy.observeOptimistic(events, true);
        for (const event of events) if (['task.queued','task.started'].includes(event.type)) for (const data of event.data?.tasks || [event.data || {}]) {
            if(event.type==='task.queued' && event.data?.inherited)continue;
            const row=pending.get(data.requestId);
            if (row && row.ownerId===core.state.ownerId && row.chatId===core.state.selectedChatId) {
                row.receiptId=data.receiptId || row.receiptId;row.sessionId=event.sessionId || event.sourceRef?.sessionId || row.sessionId;
                core.rememberTurnRequest(row);
            }
        }
        for (const event of events) if (event.type === 'user.message' && event.data?.receiptId) for (const row of pending.values()) if (row.receiptId === event.data.receiptId) {
            if (row.ownerId === core.state.ownerId && inMain() && (effects.readMessageDraft() === row.text || effects.readMessageDraft() === event.data.text)) effects.clearMessageDraft(); if(drafts.get(row.chatId) === row.text)drafts.set(row.chatId,'');pending.delete(row.requestId);
        }
    }
    function composerState(text) {
        const view = legacy.composerState(text, true);
        if (core.state.sessionSelecting || core.state.sideCreating) return { ...view, messageDisabled: true, sendDisabled: true, attachmentsDisabled: true, voiceDisabled: true, hint: core.state.sideCreating?'正在创建对话…':'' };
        if (!inMain() || core.state.workTimeline) return view;
        const available = supports('chatSend') && core.state.mainChat.sendAvailable && core.state.models.some(model => model.id === core.state.modelProfileId);
        return { ...view, messageDisabled: !available || !!core.state.attachmentUpload, attachmentsDisabled: !available || !!core.state.attachmentUpload || core.state.submitting,
            modelDisabled: view.modelDisabled || !!core.state.mainChat.activeSessionId,
            sendDisabled: !!core.sendBlocker(text, true),
            hint: core.executionAccountHint?.() || (core.state.mainChat.contextOrganizing ? '正在整理上下文，消息将继续排队。' : !supports('chatSend') ? '请更新电脑程序以发送主对话消息。' : !core.state.modelProfileId ? '选择模型后开始聊天。' : '') };
    }
    async function loadConversationResources() {
        if (!inMain()) return legacy.loadConversationResources(true);
        if (!supports('chatResources')) throw {code:'CAPABILITY_UNAVAILABLE'};
        const token = scope(), generation = historyWindow.state.generation;
        const outputs = new Map(), sources = new Map(); let cursor;
        do {
            const page = await logicalRead(() => core.accessApi(`/chats/${encodeURIComponent(core.state.selectedChatId)}/resources?${new URLSearchParams({ limit: 200, ...(cursor ? { cursor } : {}) })}`));
            if (!page) throw {code:'STALE_CONTEXT'};
            if (token !== scope() || generation !== historyWindow.state.generation) throw { code: 'STALE_CONTEXT' };
            if (historyWindow.state.contentRevision !== null && page.contentRevision !== historyWindow.state.contentRevision) { clearLogical(true); await readPage({}, 'tail'); throw { code: 'STALE_CONTEXT' }; }
            for (const output of page.outputs) outputs.set(output.artifactId, output);
            for (const source of page.sources) {
                const prior = sources.get(source.key), uses = new Map([...(prior?.uses || []), ...(source.uses || [])].map(use => [use.callId || use.id, use]));
                sources.set(source.key, { ...source, uses: [...uses.values()] });
            }
            cursor = page.hasMore ? page.nextCursor : null;
        } while (cursor);
        return { outputs: core.deduplicateOutputs([...outputs.values()]), sources: [...sources.values()] };
    }
    return { rememberConversationDraft, markLatestChatRead, cancelSessionSelection, pageSessions, searchSessions, supportsChat: supports, inMainChat: inHome, inLogicalTimeline: inMain, currentTimelineChat: timelineChat, refreshLogicalSessions: refreshSessions, selectLogicalSession: selectSession, selectMainChat, refreshLogicalHistory: refreshHistory, loadOlderLogicalHistory: loadOlderHistory, jumpChatDate, searchMainChat, moveSearchHit,
        mainChatDays: () => historyWindow.days(),
        mainReplyActive: () => {const last=historyWindow.ordered().filter(event=>['user.message','assistant.message','turn.started','turn.ended'].includes(event.type)).at(-1);return inMain()&&(timelineChat().running||last?.data?.live===true||['user.message','turn.started'].includes(last?.type));}, expandChatDay: date => { historyWindow.state.expanded.add(date); notify(); }, openSideChat,
        startChatConversation: () => supports('sideChats') && core.state.mainChat ? openSideChat({ entry: 'composer', parent: {kind:'main',id:core.state.mainChat.chatId} }).catch(error => effects.toast(core.failureMessage(error))) : (core.state.selectedChatId = null, legacy.startNewConversation(true)),
        sendMainDraft: sendDraft, observeMainOptimistic: observeOptimistic, mainComposerState: composerState, loadMainResources: loadConversationResources,
        mainOptimisticMessages: () => inHome() ? [...pending.values()].filter(row => row.ownerId === core.state.ownerId && row.chatId === core.state.selectedChatId) : legacy.optimisticMessages(true),
        retryMainRequest, reconcileMainRequests,
        restoreMainRequests: rows => { for (const row of rows) {
            if(row.kind!=='chat.message'||!row.chatId||!row.requestId||pending.has(row.requestId)||row.state==='rejected')continue;
            const restored={...row,at:row.at || row.createdAt || new Date().toISOString(),ownerId:core.state.ownerId,text:row.text||'',status:row.state==='accepted'?'accepted':'failed',receiptId:row.command?.receiptId,sessionId:row.command?.sessionId || row.sessionId};
            core.rememberTurnRequest(restored);pending.set(row.requestId,restored);
        } observeOptimistic(historyWindow.ordered());notify(); },
        mainAttachmentDraftKey: id => inMain() ? `${core.state.ownerId}|${core.state.mainChat.chatId}` : legacy.attachmentDraftKey(id, true),
        resetLogicalSession: () => { selectionGeneration++;core.state.sessionSelecting=false;core.state.sideCreating=null;core.state.sessionListCursor=null;core.state.chatListCursor=null;core.state.sessionListQuery='';core.state.sessionListGeneration=(core.state.sessionListGeneration||0)+1;historyWindow.reset();core.resourceCache=null;effects.resetMainChatView?.(); pending.clear(); drafts.clear(); core.state.mainChat = null; core.state.workTimeline = null; core.state.selectedChatId = null; core.state.chats = []; core.state.sessionStatusSummary = null; }
    };
};
