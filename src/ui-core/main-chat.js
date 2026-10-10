/* Main chat integration. Execution, approvals and receipts remain native session facts. */
globalThis.WeftUiCore.factories.mainChat = (core, effects, environment) => {
    // IA-4 opts in after supplying logical-chat presentation effects.
    if (environment.mobileState && environment.logicalChats !== true) return {};
    const legacy = Object.fromEntries(['refreshSessions', 'selectSession', 'refreshHistory', 'loadOlderHistory', 'startNewConversation',
        'sendDraft', 'optimisticMessages', 'observeOptimistic', 'composerState', 'attachmentDraftKey', 'loadConversationResources', 'clearSession'].map(key => [key, core[key]]));
    const historyWindow = globalThis.WeftUiCore.ChatWindow.create();
    const pending = new Map(), drafts = new Map();
    let selectionGeneration = 0;
    core.state.chatWindow = historyWindow.state;
    const supports = name => core.state.personalCapabilities?.[name] === 1;
    const inMain = () => !!core.state.mainChat && core.state.selectedChatId === core.state.mainChat.chatId && core.state.activeChatSource === 'desktop';
    const scope = () => `${core.state.identityGeneration}:${core.state.ownerId}:${core.state.historyGeneration}:${core.state.selectedChatId}`;
    const notify = () => { effects.renderMainChat?.(); effects.renderOlderControl(); effects.updateAvailability(); };
    function clearLogical(purge = false) {
        if (purge) {
            for (const row of pending.values()) {
                if (row.status === 'accepted' && drafts.get(row.chatId) === row.text) drafts.set(row.chatId,'');
                if (row.status === 'accepted' && inMain() && effects.readMessageDraft() === row.text) effects.clearMessageDraft();
            }
            pending.clear();core.state.tasks=[];
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
        if (chat.activeSessionId) core.state.sessions.push({ ...chat, kind: 'main', sessionId: chat.activeSessionId, title: 'WeftMate', taskAvailable: true });
        if (inMain()) core.state.selectedSessionId = chat.activeSessionId;
    }
    let readingLatest = false;
    async function markLatestChatRead() {
        if (!inMain() || !supports('sessionStatus') || historyWindow.state.hasNewer || !core.state.mainChat.unread || readingLatest) return;
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
        if (!core.state.selectedChatId && !core.state.selectedSessionId && !core.state.newConversation) await selectMainChat();
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
        if (!core.state.sessionSelecting && !core.state.sideCreating) drafts.set(core.state.selectedChatId || core.state.selectedSessionId, effects.readMessageDraft());
        selectionGeneration++; core.state.sessionSelecting = false;core.state.sideCreating=null;
        core.cancelAttachmentUpload(); core.state.activeChatSource = 'desktop'; core.state.selectedPhoneConversationId = null;
        core.state.selectedChatId = core.state.mainChat.chatId; core.state.selectedSessionId = core.state.mainChat.activeSessionId;
        if (core.state.mainChat.modelProfileId) { core.state.modelProfileId = core.state.mainChat.modelProfileId; effects.paintModels(); }
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
        if (core.state.selectedSessionId) void core.refreshApprovalMode(core.state.selectedSessionId);
    }
    async function selectSession(id, {empty = false, creating = false} = {}) {
        if (core.state.mainChat?.activeSessionId === id) return selectMainChat();
        if (!core.state.sessionSelecting && !core.state.sideCreating) drafts.set(core.state.selectedChatId || core.state.selectedSessionId, effects.readMessageDraft());
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
            else await legacy.selectSession(id, true, !empty);
            if (generation !== selectionGeneration || identity !== core.state.identityGeneration) return;
            const chat = core.state.chats?.find(row => row.activeSessionId === id);
            core.state.selectedChatId = chat?.chatId || null;
            effects.restoreMainChatDraft?.(drafts.get(chat?.chatId || id) || ''); effects.renderChatOrigin?.(chat);
        } finally {
            if (generation === selectionGeneration && identity === core.state.identityGeneration) { core.state.sessionSelecting = false; notify(); }
        }
    }
    async function readPage(params, direction) {
        const token = scope(), generation = historyWindow.state.generation;
        try {
            const page = await core.readChatEvents(core.state.selectedChatId, { limit: 200, ...params });
            if (token !== scope() || generation !== historyWindow.state.generation) return;
            if (historyWindow.state.contentRevision !== null && historyWindow.state.contentRevision !== page.contentRevision) { clearLogical(true); return readPage({}, 'tail'); }
            historyWindow.merge(page, direction); core.observeOptimistic(page.items || []); notify();
            void Promise.all([core.refreshConversationApprovals(),core.refreshConversationQuestions()]).catch(()=>{});
            void refreshChatDates().catch(() => {});
            if (page.deletedAnchor) effects.historyNotice('原消息已删除，已显示邻近内容。');
        } catch (error) {
            if (token !== scope() || generation !== historyWindow.state.generation) return;
            if (error.code === 'CURSOR_RESET_REQUIRED') { clearLogical(true); notify(); return readPage({}, 'tail'); }
            effects.historyNotice('历史暂时无法读取，请重试。', 'read-failure');
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
    async function refreshHistory(reset = false) {
        if (!inMain()) return legacy.refreshHistory(reset, true);
        if (!supports('chatTimeline')) return;
        if (reset || !historyWindow.state.syncCursor) { if (reset) clearLogical(true); return readPage({}, 'tail'); }
        if (core.mainChatRefreshing) return;
        core.mainChatRefreshing = true; const token = scope(), generation = historyWindow.state.generation;
        try {
            const page = await core.readChatChanges(core.state.selectedChatId, historyWindow.state.syncCursor, 200);
            if (token !== scope() || generation !== historyWindow.state.generation) return;
            if (historyWindow.state.contentRevision !== page.contentRevision) { clearLogical(true); notify(); return readPage({}, 'tail'); }
            historyWindow.state.anchorId=effects.mainChatAnchor?.() || null;
            const before=JSON.stringify(historyWindow.ordered());
            historyWindow.merge(page, 'changes'); core.observeOptimistic(page.upserts || []);
            if(before!==JSON.stringify(historyWindow.ordered())){
                if(!(page.upserts?.length||page.removals?.length)){if(effects.paintLiveChatMessages?.()!==true)effects.renderMainChat?.();}else notify();
            }
            if(environment.mobileState) await Promise.all([core.refreshConversationTasks(),core.refreshConversationApprovals(),core.refreshConversationQuestions()]);
        await reconcileMainRequests();
            const main = await core.readMainChat(); if (token === scope()) { const changed=JSON.stringify(core.state.mainChat)!==JSON.stringify(main.chat);installMain(main.chat);if(changed)notify(); }
        } catch (error) {
            if (token === scope() && generation === historyWindow.state.generation && error.code === 'CURSOR_RESET_REQUIRED') { clearLogical(true); notify(); await readPage({}, 'tail'); }
        } finally { core.mainChatRefreshing = false; }
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
        if (core.state.unresolvedSubmission && !core.sideCreateIntent) return effects.toast('请先核对原请求，再开旁聊。');
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
        core.operation('正在创建旁聊。',true,intent.requestId);
        let command;
        try { command = (await core.accessApi(`/commands/by-request/${encodeURIComponent(intent.requestId)}`)).command; }
        catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
        if (!command) {
            try { command = (await core.createSideChat(intent)).command; }
            catch (error) {
                if (error.status >= 400 && error.status < 500 && error.code !== 'REQUEST_CONFLICT') {core.sideCreateIntent=null;core.forgetMarker(intent.requestId);core.operation('旁聊未创建，请核对后重试。',false,intent.requestId);}
                throw error;
            }
        }
        for (let n = 0; n < 180 && ['pending', 'dispatching'].includes(command?.state); n++) {
            await new Promise(resolve => setTimeout(resolve, 250)); command = (await core.accessApi(`/commands/by-request/${encodeURIComponent(intent.requestId)}`)).command;
            if (token !== scope()) return;
        }
        if (command?.state !== 'accepted_by_dsh') {
            if (['rejected','failed'].includes(command?.state)) {core.sideCreateIntent=null;core.forgetMarker(intent.requestId);core.operation('旁聊未创建，请重试。',false,intent.requestId);}
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
        row.command = result.command; row.receiptId = row.command?.receiptId;
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
            core.operation('正在重试原消息。',true,requestId,false);
            const command = core.originalMessageBody(requestId) ? await core.replayOriginalMessage(requestId)
                : environment.mobileState && row.nativeFields ? await effects.sendMainNativeMessage(row.nativeFields)
                : row.attachmentSnapshot && inMain() && row.chatId === core.state.selectedChatId
                    ? (core.operation('正在重试原附件。',false,requestId), await core.sendDesktopMessageWithAttachments(row.text,requestId,row.nativeFields.intent,row.attachmentSnapshot)) : null;
            if (!command) row.status = 'undelivered';
            else await checkMainRequest(row);
            await refreshHistory();
        } catch { if (token === core.state.identityGeneration) row.status = 'confirming'; }
        finally { row.retrying = false;notify(); }
    }
    async function sendDraft(text = effects.readMessageDraft(), intent) {
        if (core.state.sessionSelecting || core.state.sideCreating) return;
        if (!inMain()) return legacy.sendDraft(text, intent, true);
        if (!core.state.online || !supports('chatSend') || core.folderMutationPending?.() || core.state.submitting || core.state.unresolvedSubmission || !core.state.modelProfileId || (!text.trim() && !core.currentAttachmentDrafts().length)) return;
        const attachments = core.currentAttachmentDrafts();
        const row = { ownerId: core.state.ownerId, chatId: core.state.selectedChatId, requestId: attachments.length ? core.attachmentAttempt(core.attachmentDraftKey(), text, attachments).requestId : environment.crypto.randomUUID(), text, status: 'sending', files: attachments.map(item => item.file.name) };
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
            await refreshHistory();
        } catch { row.status = 'confirming'; } finally { notify(); }
    }
    function observeOptimistic(events) {
        legacy.observeOptimistic(events, true);
        for (const event of events) if (event.type === 'user.message' && event.data?.receiptId) for (const row of pending.values()) if (row.receiptId === event.data.receiptId) {
            if (row.ownerId === core.state.ownerId && inMain() && (effects.readMessageDraft() === row.text || effects.readMessageDraft() === event.data.text)) effects.clearMessageDraft(); if(drafts.get(row.chatId) === row.text)drafts.set(row.chatId,'');pending.delete(row.requestId);
        }
    }
    function composerState(text) {
        const view = legacy.composerState(text, true);
        if (core.state.sessionSelecting || core.state.sideCreating) return { ...view, messageDisabled: true, sendDisabled: true, attachmentsDisabled: true, voiceDisabled: true, hint: core.state.sideCreating?'正在创建旁聊…':'正在打开对话…' };
        if (!inMain()) return view;
        const available = supports('chatSend') && core.state.mainChat.sendAvailable && core.state.models.some(model => model.id === core.state.modelProfileId);
        return { ...view, messageDisabled: !available || !!core.state.attachmentUpload, attachmentsDisabled: !available || !!core.state.attachmentUpload || core.state.submitting,
            modelDisabled: view.modelDisabled || !!core.state.mainChat.activeSessionId,
            sendDisabled: !core.state.online || ['restarting','unavailable'].includes(core.state.connection?.host?.runtime) || core.state.capabilities?.chat?.available === false || !available || core.folderMutationPending?.() || core.state.submitting || core.state.unresolvedSubmission || (!text.trim() && !core.currentAttachmentDrafts().length),
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
    return { markLatestChatRead, cancelSessionSelection, pageSessions, searchSessions, supportsChat: supports, inMainChat: inMain, refreshLogicalSessions: refreshSessions, selectLogicalSession: selectSession, selectMainChat, refreshLogicalHistory: refreshHistory, loadOlderLogicalHistory: loadOlderHistory, jumpChatDate, searchMainChat, moveSearchHit,
        mainChatDays: () => historyWindow.days(),
        mainReplyActive: () => {const last=historyWindow.ordered().filter(event=>['user.message','assistant.message','turn.started','turn.ended'].includes(event.type)).at(-1);return inMain()&&(core.state.mainChat.running||last?.data?.live===true||['user.message','turn.started'].includes(last?.type));}, expandChatDay: date => { historyWindow.state.expanded.add(date); notify(); }, openSideChat,
        startChatConversation: () => supports('sideChats') && core.state.mainChat ? openSideChat({ entry: 'composer', ...((core.currentFolderProject?.() || core.defaultFolderProject?.()) ? {parent:{kind:'project',id:(core.currentFolderProject?.() || core.defaultFolderProject()).projectId}} : {}) }).catch(error => effects.toast(core.failureMessage(error))) : (core.state.selectedChatId = null, legacy.startNewConversation(true)),
        sendMainDraft: sendDraft, observeMainOptimistic: observeOptimistic, mainComposerState: composerState, loadMainResources: loadConversationResources,
        mainOptimisticMessages: () => inMain() ? [...pending.values()].filter(row => row.ownerId === core.state.ownerId && row.chatId === core.state.selectedChatId) : legacy.optimisticMessages(true),
        retryMainRequest, reconcileMainRequests,
        restoreMainRequests: rows => { for (const row of rows) {
            if(row.kind!=='chat.message'||!row.chatId||!row.requestId||pending.has(row.requestId)||row.state==='rejected')continue;
            pending.set(row.requestId,{...row,ownerId:core.state.ownerId,text:row.text||'',status:row.state==='accepted'?'accepted':'failed',receiptId:row.command?.receiptId});
        } observeOptimistic(historyWindow.ordered());notify(); },
        mainAttachmentDraftKey: id => inMain() ? `${core.state.ownerId}|${core.state.mainChat.chatId}` : legacy.attachmentDraftKey(id, true),
        resetLogicalSession: () => { selectionGeneration++;core.state.sessionSelecting=false;core.state.sideCreating=null;core.state.sessionListCursor=null;core.state.chatListCursor=null;core.state.sessionListQuery='';core.state.sessionListGeneration=(core.state.sessionListGeneration||0)+1;historyWindow.reset();core.resourceCache=null;effects.resetMainChatView?.(); pending.clear(); drafts.clear(); core.state.mainChat = null; core.state.selectedChatId = null; core.state.chats = []; core.state.sessionStatusSummary = null; }
    };
};
