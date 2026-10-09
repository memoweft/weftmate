/* Shared composer state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.composer = (core, effects, environment) => {
    const messages = new Map();
    const thinkingWrites = new Map();
    async function refreshThinkingModels() {
        const identity = core.state.identityGeneration;
        const value = await core.accessApi('/models');
        if (identity === core.state.identityGeneration) core.state.models = (value.models || []).filter(row => row.configured);
    }
    function thinkingView() {
        const session = core.state.sessions.find(row => row.sessionId === core.state.selectedSessionId);
        const model = core.state.models.find(row => row.id === (session?.modelProfileId || core.state.modelProfileId));
        return { supported: model?.deepThinking?.supported === true,
            enabled: core.state.newConversation ? core.state.newConversationThinking === true : session?.deepThinking === true,
            busy: thinkingWrites.has(`${core.state.ownerId}/${core.state.selectedSessionId}`) };
    }
    async function setDeepThinking(enabled) {
        if (typeof enabled !== 'boolean' || !thinkingView().supported || thinkingView().busy) return;
        if (core.state.newConversation) { core.state.newConversationThinking = enabled; effects.updateAvailability(); return; }
        const context = core.conversationTaskContext(), key = `${context.ownerId}/${context.sessionId}`;
        const write = core.accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/thinking`,
            { method: 'PATCH', protectedWrite: true, body: { enabled } });
        thinkingWrites.set(key, write); effects.updateAvailability();
        try {
            const saved = await write;
            if (core.conversationTaskCurrent(context)) {
                const row = core.state.sessions.find(row => row.sessionId === context.sessionId);
                if (row) row.deepThinking = saved.enabled === true;
            }
        } catch { if (core.conversationTaskCurrent(context)) effects.toast('深入思考未保存，请重试'); }
        finally { thinkingWrites.delete(key); effects.updateAvailability(); }
    }
    function beginOptimistic(fields) {
        const row = {ownerId: core.state.ownerId, identity: core.state.identityGeneration, status:'sending', ...fields};
        messages.set(row.requestId, row);
        effects.renderOptimisticMessages?.();
        return row;
    }
    function optimisticMessages(legacy = false) {
        if (!legacy && core.mainOptimisticMessages) return core.mainOptimisticMessages();
        return [...messages.values()].filter(row => row.ownerId === core.state.ownerId &&
            row.identity === core.state.identityGeneration && row.sessionId === core.state.selectedSessionId &&
            (row.sessionId !== null || row.draftId === core.state.newConversationId));
    }
    function reconcileOptimistic(command) {
        const row = messages.get(command?.requestId);
        if (!row || row.ownerId !== core.state.ownerId || row.identity !== core.state.identityGeneration) return;
        row.command = command;
        row.receiptId = command.receiptId;
        row.status = ['accepted_by_dsh', 'observed'].includes(command.state) ? 'accepted' :
            ['failed', 'rejected', 'blocked', 'uncertain'].includes(command.state) ? 'failed' : 'sending';
        if (row.status === 'accepted' && row.sessionId === core.state.selectedSessionId && effects.readMessageDraft() === row.text)
            effects.clearMessageDraft();
        effects.renderOptimisticMessages?.();
    }
    function observeOptimistic(events, legacy = false) {
        if (!legacy && core.observeMainOptimistic) return core.observeMainOptimistic(events);
        for (const event of events) if (event.type === 'user.message' && event.data?.receiptId) {
            for (const row of optimisticMessages()) if (row.receiptId === event.data.receiptId) {
                row.status = 'accepted';
                if (effects.readMessageDraft() === row.text) effects.clearMessageDraft();
                messages.delete(row.requestId);
            }
        }
    }
    function startNewConversation(legacy = false, temporary = false) {
        if (!legacy && !temporary && core.startChatConversation) return core.startChatConversation();
        if (temporary) core.state.selectedChatId = null;
        if (core.state.submitting || core.state.unresolvedSubmission) return;
        const fromPhone = core.state.activeChatSource === 'phone';
        if (fromPhone && core.state.selectedPhoneConversationId && !core.readPhoneOutbox())
            core.state.phoneDrafts.set(core.state.selectedPhoneConversationId, effects.readMessageDraft());
        core.cancelAttachmentUpload();
        core.state.activeChatSource = 'desktop';
        core.state.selectedPhoneConversationId = null;
        effects.paintDesktopComposer(fromPhone);
        const defaultProfile = core.state.modelSettings?.defaultModelProfileId;
        if (defaultProfile && core.state.models.some(model => model.id === defaultProfile)) {
            core.state.modelProfileId = defaultProfile; effects.paintModels();
        }
        core.state.newConversation = true;
        core.state.newConversationTemporary = temporary;
        core.state.newConversationId = environment.crypto.randomUUID();
        core.state.newConversationApprovalMode = null;
        core.state.newConversationThinking = false;
        core.state.selectedSessionId = null;
        core.state.historyGeneration++;
        core.state.historyEvents.clear(); core.state.seenSeq.clear(); core.state.afterSeq = -1;
        core.state.nextBeforeSeq = null; core.state.hasOlder = false; core.state.olderLoading = false;
        core.state.historyHasMore = false; core.state.turnEndReasonKind = null;
        core.state.turnStatus = null;
        core.resetConversationApprovals(); core.resetConversationQuestions();
        effects.renderConversationApprovals();effects.renderConversationQuestions();effects.renderConversationTasks();
        effects.paintSelectedSession(null);
        effects.renderOlderControl(); effects.closePhoneImagePreview(); effects.removeResourcePreview();
        effects.clearHistoryView(); effects.renderSessions(); effects.updateAvailability();
        effects.showConversation(); effects.closeRail();
        effects.scrollToLatest();
        void core.refreshNewConversationApprovalMode();
    }
    async function deliverOptimistic(row) {
        const current = () => row.ownerId === core.state.ownerId && row.identity === core.state.identityGeneration;
        if(!current())return;
        row.status = 'sending'; effects.renderOptimisticMessages?.();
        if (!row.sessionId) {
            row.creating = true;
            core.creatingOptimisticSession = true;
            const submitted = row.creationCommand?.state === 'accepted_by_dsh' ? row.creationCommand
                : await core.submitCommand('session.create', {modelProfileId: row.modelProfileId, ...(row.temporary ? {temporary: true} : {})}, null, row.createRequestId);
            const created = row.creationCommand || core.state.tasks.find(command=>command.requestId===row.createRequestId) || submitted;
            core.creatingOptimisticSession = false;
            row.creating = false;
            if (!current()) return;
            if (!created?.sessionId || created.state !== 'accepted_by_dsh') { row.status = created && ['pending','dispatching'].includes(created.state) ? 'sending' : 'failed'; effects.renderOptimisticMessages?.(); return; }
            row.sessionId = created.sessionId;
            if (row.attachments) {
                const oldKey = `${row.ownerId}|new`;
                const drafts = core.state.attachmentDrafts.get(oldKey);
                if (drafts) { core.state.attachmentDrafts.set(`${row.ownerId}|${row.sessionId}`, drafts); core.state.attachmentDrafts.delete(oldKey); }
            }
            // The creation receipt already identifies the durable session.
            // Reading every older conversation is not a prerequisite for
            // delivering its first message or observing the native turn.
            void core.refreshSessions().catch(() => {});
            if (core.state.newConversation && core.state.selectedSessionId === null && core.state.newConversationId === row.draftId) await core.selectSession(row.sessionId);
        }
        if(row.approvalMode){
            await core.accessApi(`/sessions/${encodeURIComponent(row.sessionId)}/approval-mode`,{method:'PATCH',protectedWrite:true,body:{mode:row.approvalMode}});
            if(!current())return;
            if(core.state.selectedSessionId===row.sessionId)void core.refreshApprovalMode(row.sessionId);
        }
        if (row.deepThinking === true) {
            await core.accessApi(`/sessions/${encodeURIComponent(row.sessionId)}/thinking`,
                {method:'PATCH', protectedWrite:true, body:{enabled:true}});
            if (!current()) return;
            const session = core.state.sessions.find(item => item.sessionId === row.sessionId);
            if (session) session.deepThinking = true;
        }
        const submitted = row.attachments ? await sendIntentAction(() => core.sendDesktopMessageWithAttachments(row.text, row.requestId), row.intent)
            : await core.submitCommand('session.message', {sessionId: row.sessionId, text: row.text, intent: row.intent}, row.sessionId, row.requestId);
        const sent = core.state.tasks.find(command=>command.requestId===row.requestId) || submitted;
        if (!current()) return;
        if (sent) reconcileOptimistic(sent); else row.status = 'failed';
        if (sent?.state === 'accepted_by_dsh' && core.state.selectedSessionId === row.sessionId) {
            if (effects.readMessageDraft() === row.text) effects.clearMessageDraft();
            await core.refreshHistory();
            observeOptimistic([...core.state.historyEvents.values()]);
        }
        effects.renderOptimisticMessages?.(); effects.updateAvailability();
    }
    function deliverSafely(row) {
        return deliverOptimistic(row).catch(()=>{
            row.creating=false;
            if(row.ownerId!==core.state.ownerId||row.identity!==core.state.identityGeneration)return;
            if(row.status!=='accepted')row.status='failed';
            effects.renderOptimisticMessages?.();effects.updateAvailability();
        });
    }
    function handleOptimisticCreation(command) {
        const row = [...messages.values()].find(row=>row.createRequestId===command?.requestId && row.ownerId===core.state.ownerId && row.identity===core.state.identityGeneration);
        if (!row) return false;
        if (row.creationCommand?.state !== 'accepted_by_dsh' || !['pending','dispatching'].includes(command.state)) row.creationCommand = command;
        if (!row.creating && !row.sessionId && command.state==='accepted_by_dsh') {
            row.creating=true;
            void deliverSafely(row);
        } else if (['rejected','failed','uncertain'].includes(command.state)) {row.status='failed';effects.renderOptimisticMessages?.();}
        return true;
    }
    async function retryOptimistic(requestId) {
        const row = optimisticMessages().find(row => row.requestId === requestId);
        if (!row || row.status !== 'failed' || core.state.submitting) return;
        const current=()=>row.ownerId===core.state.ownerId&&row.identity===core.state.identityGeneration;
        row.status='sending';effects.renderOptimisticMessages?.();
        const lookupId = row.sessionId ? requestId : row.createRequestId;
        // Query the original durable receipt before replaying the exact same request.
        try {
            const result = await core.accessApi(`/commands/by-request/${encodeURIComponent(lookupId)}`);
            if(!current())return;
            if (result.command) {
                if (row.sessionId) reconcileOptimistic(result.command);
                if (row.sessionId && result.command.state === 'accepted_by_dsh') { await core.refreshHistory(); return; }
                if (['failed', 'rejected', 'blocked'].includes(result.command.state)) {
                    // A definitive rejection did not deliver a message. A new attempt is safe.
                    core.forgetMarker(lookupId);
                    if (!row.sessionId) row.createRequestId = environment.crypto.randomUUID();
                    else { messages.delete(requestId); row.requestId = environment.crypto.randomUUID(); messages.set(row.requestId, row); }
                }
            }
        } catch (error) { if(!current())return;if (error.code !== 'NOT_FOUND') { row.status = 'failed'; effects.renderOptimisticMessages?.(); return; } core.setOnline(true); }
        core.state.unresolvedRequests.delete(lookupId);
        core.state.unresolvedSubmission = core.state.unresolvedRequests.size > 0;
        return row.retry ? row.retry(row) : deliverSafely(row);
    }
    function addAttachmentFiles(selected) {
        const key = core.attachmentDraftKey();
        if (!key || core.state.activeChatSource !== 'desktop' || core.state.attachmentUpload || selected.length === 0)
            return;
        const drafts = [...core.currentAttachmentDrafts()];
        let rejected = 0;
        for (const file of selected) {
            if (drafts.length >= 4 || !(file instanceof Blob) || !core.validAttachmentName(file.name) ||
                !Number.isSafeInteger(file.size) || file.size < 1 || file.size > core.originalAttachmentBytes) {
                rejected++;
                continue;
            }
            const contentType = core.attachmentMime(file);
            const duplicate = drafts.some((item) => item.file.name === file.name && item.file.size === file.size &&
                item.file.lastModified === file.lastModified && item.contentType === contentType);
            if (duplicate) {
                rejected++;
                continue;
            }
            drafts.push({ attachmentId: `attachment-${environment.crypto.randomUUID()}`, file, contentType, sha256: null });
        }
        if (drafts.length)
            core.state.attachmentDrafts.set(key, drafts);
        core.invalidateAttachmentAttempt(key);
        core.state.attachmentStatus = rejected ? '部分文件未添加：每次最多 4 个，单个须为 1 B–1 GiB，名称不能含路径字符。' : '';
        effects.renderAttachmentDrafts();
        effects.updateAvailability();
    }
    function composerInputMode(sessionId) {
        return conversationRunning(sessionId) ? messageModePreference() : 'queue';
    }
    function conversationRunning(sessionId) {
        // The selected conversation's native turn events can arrive before the
        // slower session-list projection. Never infer running from acceptance:
        // an accepted message may still be queued behind another task.
        if (core.state.activeChatSource === 'desktop' && sessionId === core.state.selectedSessionId && core.state.turnStatus) {
            const boundary = [...core.state.historyEvents.values()].filter(event => ['turn.started', 'turn.ended'].includes(event.type)).sort((a,b) => a.seq-b.seq).at(-1);
            const snapshot = Date.parse(core.state.sessionSnapshotAt);
            if (Number.isFinite(snapshot) && Date.parse(boundary?.at) > snapshot)
                return core.state.turnStatus === 'running';
            if (!Number.isFinite(snapshot) && core.state.turnStatus !== 'running') return false;
        }
        return core.state.sessions.find(item => item.sessionId === sessionId)?.running === true;
    }
    function messageModePreference() {
        const owner = core.state.account?.ownerId || core.state.ownerId;
        if (core.state.messageModeOwner !== owner) {
            core.state.messageModeOwner = owner;
            let saved;
            try { saved = owner && environment.storage.getItem(`weftmate:message-mode:${owner}`); } catch { /* unavailable device storage */ }
            core.state.messageMode = saved === 'steer' ? 'steer' : 'queue';
        }
        return core.state.messageMode === 'steer' ? 'steer' : 'queue';
    }
    async function sendIntentAction(action, intent) {
        const previous = messageModePreference(), context = core.conversationTaskContext();
        if (intent) core.state.messageMode = intent;
        try { return await action(); }
        finally { if (intent && core.conversationTaskCurrent(context)) core.state.messageMode = previous; }
    }
    async function sendDraft(text = effects.readMessageDraft(), intent, legacy = false) {
        if (!legacy && core.sendMainDraft) return core.sendMainDraft(text, intent);
        if (core.state.activeChatSource === 'phone')
            return sendIntentAction(() => core.sendPhoneMessage(), intent);
        const attachments = core.currentAttachmentDrafts();
        if (optimisticMessages().some(row=>row.text===text && row.status==='sending')) return;
        if ((!text.trim() && attachments.length === 0) || core.state.submitting || core.state.attachmentUpload || core.state.unresolvedSubmission ||
            core.state.capabilities?.chat?.available !== true ||
            (!core.state.newConversation && core.state.sessions.find((item) => item.sessionId === core.state.selectedSessionId)?.sendAvailable !== true))
            return;
        const row = {ownerId: core.state.ownerId, identity: core.state.identityGeneration,
            sessionId: core.state.selectedSessionId, modelProfileId: core.state.modelProfileId,
            draftId: core.state.newConversationId,
            temporary: core.state.newConversation && core.state.newConversationTemporary === true,
            requestId: attachments.length ? core.attachmentAttempt(core.attachmentDraftKey(), text, attachments).requestId : environment.crypto.randomUUID(), createRequestId: environment.crypto.randomUUID(),
            text, attachments: attachments.length > 0, files: attachments.map(item => item.file?.name || '附件'),
            deepThinking: core.state.newConversation ? thinkingView().supported && thinkingView().enabled : undefined,
            approvalMode: core.state.newConversation ? core.state.newConversationApprovalMode : null,
            intent: intent === 'queue' || intent === 'steer' ? intent : core.composerInputMode(core.state.selectedSessionId), status: 'sending'};
        messages.set(row.requestId, row);
        effects.renderOptimisticMessages?.(); effects.scrollToLatest();
        return deliverSafely(row);
    }
    async function stopCurrentTurn() {
        const session = core.state.activeChatSource === 'phone' ? core.phoneBinding()?.sessionId : core.state.selectedSessionId;
        const context = core.conversationTaskContext();
        const current = core.taskQueue().filter(row => row.state === 'running').at(-1);
        if (session && conversationRunning(session) && !core.state.cancelSubmitting) {
            const stoppedNotice = () => {
                if (!core.conversationTaskCurrent(context)) return;
                const queued = core.taskQueue().filter(row => row.state === 'queued').length;
                effects.toast(queued ? `已停止当前回复，还有 ${queued} 条排队消息会继续` : '已停止');
            };
            if (!current?.taskId || current.taskId.startsWith('turn-')) {
                const result = await core.submitCommand('session.cancel', { sessionId: session }, session);
                if (result?.state === 'accepted_by_dsh') stoppedNotice();
                return result;
            }
            core.state.cancelSubmitting = true;
            effects.updateAvailability();
            try {
                const key = `${context.ownerId}/${context.identity}/${session}/${current.taskId}`;
                if (core.stopAttempt?.key !== key)
                    core.stopAttempt = { key, requestId: environment.crypto.randomUUID() };
                await core.accessApi(`/tasks/${encodeURIComponent(current.taskId)}/stop`, {
                    method: 'POST', protectedWrite: true, body: { requestId: core.stopAttempt.requestId } });
                stoppedNotice();
            } catch (error) {
                if (core.conversationTaskCurrent(context)) effects.toast(core.taskControlError(error));
            } finally {
                core.state.cancelSubmitting = false;
                effects.updateAvailability();
            }
        }
    }
    function composerState(text, legacy = false) {
        if (!legacy && core.mainComposerState) return core.mainComposerState(text);
        const phoneChat = core.state.activeChatSource === 'phone';
        const pendingPhone = phoneChat ? core.readPhoneOutbox() : null;
        const recovery = phoneChat && !pendingPhone ? core.readPhoneRecovery() : null;
        const pendingHere = pendingPhone?.event.conversationId === core.state.selectedPhoneConversationId;
        const recoveryHere = recovery?.event.conversationId === core.state.selectedPhoneConversationId;
        const bound = phoneChat ? core.phoneBinding() : null;
        const boundSession = bound && core.state.sessions.find(item => item.sessionId === bound.sessionId);
        const phoneReady = core.state.online && !!core.state.ownerId && !!core.state.selectedPhoneConversationId && !core.state.phoneSending &&
            (bound ? boundSession?.sendAvailable === true : core.state.syncAvailable && !!core.state.device?.id);
        const chat = core.state.online && core.state.capabilities?.chat?.available === true;
        const model = core.state.models.some(item => item.id === core.state.modelProfileId);
        const selected = core.state.sessions.find(item => item.sessionId === core.state.selectedSessionId);
        const canSendHere = selected?.sendAvailable === true || core.state.newConversation === true;
        const attachmentCount = phoneChat ? 0 : core.currentAttachmentDrafts().length;
        const attachmentBusy = !!core.state.attachmentUpload;
        const messageDisabled = phoneChat ? !phoneReady || !!pendingPhone || !!recovery : !chat || !model || !canSendHere || attachmentBusy;
        const running = phoneChat ? boundSession?.running === true : conversationRunning(core.state.selectedSessionId);
        const blockedDesktop = core.desktopBlocker();
        const hint = phoneChat && bound ? core.state.phoneSendNotice || '' : phoneChat
            ? pendingPhone && !pendingHere ? '另一条手机对话有未确认的同步请求。请先切回原对话核对。'
                : pendingHere ? core.state.phoneSendNotice || '这条文字的同步结果待核对。重试会沿用同一个消息编号。'
                    : recovery && !recoveryHere ? '旧设备有未确认文字，请先切回原手机对话核对。'
                        : recoveryHere ? '重新登录后保留了旧文字。先核对服务器是否已接收，再决定是否重新同步。' : core.state.phoneSendNotice || ''
            : !core.state.online ? '等待重新连接电脑。'
                : core.state.executionAccount === false ? '这台电脑已有执行账号。当前账号仅可聊天，不能操作电脑或读取原账号资料；请退出后登录这台电脑的原账号。'
                : selected?.archived ? '这段对话已归档，请在会话菜单中恢复后继续。'
                    : selected && !canSendHere ? '旧会话历史可读；要继续聊天或在对话中执行，请新建受限远端会话。'
                    : !chat || !model ? '电脑尚无可用模型。历史可阅读，聊天请先在电脑设置中配置模型。' : '';
        return {
            placeholder: running ? globalThis.WeftUiCore.runningPlaceholder(messageModePreference()) : phoneChat ? '补充到这条手机对话' : '向 WeftMate 说说你的目标',
            phoneChat, running, hint: hint || (running ? processingLabel((phoneChat ? boundSession : selected)?.processing) : ''), attachmentBusy,
            newSessionDisabled: !chat || !model || core.state.submitting || attachmentBusy || core.state.unresolvedSubmission,
            modelDisabled: phoneChat || !chat || !core.state.models.length,
            modelName: core.state.models.find(item => item.id === core.state.modelProfileId)?.name || '选择模型',
            messageDisabled, voiceDisabled: messageDisabled || core.state.submitting || core.state.phoneSending,
            sendDisabled: phoneChat
                ? !phoneReady || (!!pendingPhone && !pendingHere) || (!!recovery && !recoveryHere) || (!pendingPhone && !recovery && !text.trim())
                : !chat || !model || !canSendHere || core.state.submitting || attachmentBusy || (!text.trim() && attachmentCount === 0) || core.state.unresolvedSubmission || thinkingView().busy,
            sendText: phoneChat ? bound ? '发送到电脑' : recoveryHere && !pendingPhone ? '核对旧请求' : pendingHere ? '核对并重试' : '同步文字' : '发送',
            attachmentsDisabled: phoneChat || !chat || !model || !canSendHere || core.state.submitting || attachmentBusy || core.state.unresolvedSubmission || attachmentCount >= 4,
            desktopText: blockedDesktop ? '查看原事情' : '打开记事本',
            desktopDisabled: blockedDesktop ? false : !core.state.online || core.state.capabilities?.desktopOpenApp?.available !== true || !core.state.capabilities.desktopOpenApp.appIds?.includes('notepad') || core.state.submitting || core.state.unresolvedSubmission,
            cancelHidden: phoneChat || !running,
            cancelDisabled: !core.state.online || !running || core.state.cancelSubmitting,
        };
    }
    function selectModelProfile(id) {
        if (!core.state.models.some(model => model.id === id))
            return false;
        core.state.modelProfileId = id;
        effects.updateAvailability();
        return true;
    }
    function setMessageMode(mode) {
        messageModePreference();
        core.state.messageMode = mode === 'steer' ? 'steer' : 'queue';
        if (core.state.messageModeOwner) try { environment.storage.setItem(`weftmate:message-mode:${core.state.messageModeOwner}`, core.state.messageMode); } catch { /* unavailable device storage */ }
        if (core.state.messageModeOwner && environment.messageModeStorage) void environment.messageModeStorage(`weftmate:message-mode:${core.state.messageModeOwner}`, core.state.messageMode).catch(() => {});
        effects.updateAvailability();
    }
    async function loadMessageModePreference() {
        const value = messageModePreference(), owner = core.state.messageModeOwner, identity = core.state.identityGeneration;
        if (!owner || !environment.messageModeStorage) return value;
        try {
            const saved = await environment.messageModeStorage(`weftmate:message-mode:${owner}`);
            if (identity === core.state.identityGeneration && owner === core.state.messageModeOwner && ['steer', 'queue'].includes(saved)) core.state.messageMode = saved;
        } catch { /* keep this origin's account preference when native storage is unavailable */ }
        return core.state.messageMode;
    }
    function processingStageLabel(value, events = [...core.state.historyEvents.values()], now = Date.now()) {
        const started = [...events].filter(event => event.type === 'turn.started').sort((a, b) => a.seq - b.seq).at(-1);
        const elapsed = now - Date.parse(started?.at);
        return processingLabel(value) + (Number.isFinite(elapsed) && elapsed >= 0 ? ` ${Math.floor(elapsed / 1000)} 秒` : '');
    }
    function processingLabel(value) {
        if (value?.phase === 'loading') return `正在加载模型${value.modelName ? ` ${value.modelName}` : ''}…`;
        if (value?.phase === 'queued' && Number.isSafeInteger(value.ahead) && value.ahead > 0) return `模型排队中，前面还有 ${value.ahead} 个请求`;
        return { memory: '正在读取记忆…', reasoning: '正在思考…', answering: '正在回复…' }[value?.phase] || '等待模型回复…';
    }
    return { refreshThinkingModels, thinkingView, setDeepThinking, handleOptimisticCreation, beginOptimistic, optimisticMessages, reconcileOptimistic, observeOptimistic, startNewConversation, retryOptimistic,
        addAttachmentFiles, composerInputMode, conversationRunning, messageModePreference, loadMessageModePreference, sendDraft, stopCurrentTurn, composerState, selectModelProfile, setMessageMode, processingLabel, processingStageLabel };
};

globalThis.WeftUiCore.contextUsageView = value => {
    const used = Number.isSafeInteger(value?.usedTokens) && value.usedTokens >= 0 ? value.usedTokens : null;
    const limit = Number.isSafeInteger(value?.contextWindow) && value.contextWindow > 0 ? value.contextWindow : null;
    const compact = number => number >= 1e6 ? `${Number((number / 1e6).toFixed(1))}M` : number >= 1e3 ? `${Number((number / 1e3).toFixed(1))}k` : String(number);
    const ratio = used !== null && limit !== null ? used / limit : null;
    return {ratio, warning: ratio !== null && ratio >= .8,
        label: ratio !== null ? `背景信息窗口：${Math.round(ratio * 100)}% 已用` : '背景信息窗口：用量待确认',
        detail: used !== null ? `已用 ${compact(used)} 标记${limit !== null ? `，共 ${compact(limit)}` : '，上限未知'}` : '当前占用尚未提供'};
};

globalThis.WeftUiCore.runningPlaceholder = mode => mode === 'queue' ? '排队到下一条…' : mode === 'steer' ? '引导当前回复…' : '补充或跟进…';
