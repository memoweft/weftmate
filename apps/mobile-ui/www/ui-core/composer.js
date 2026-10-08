/* Shared composer state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.composer = (core, effects, environment) => {
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
        return core.state.sessions.find(item => item.sessionId === sessionId)?.running ? core.state.messageMode || 'steer' : 'queue';
    }
    async function sendIntentAction(action, intent) {
        const previous = core.state.messageMode, context = core.conversationTaskContext();
        if (intent) core.setMessageMode(intent);
        try { return await action(); }
        finally { if (intent && core.conversationTaskCurrent(context)) core.setMessageMode(previous); }
    }
    async function sendDraft(text = effects.readMessageDraft(), intent) {
        if (core.state.activeChatSource === 'phone')
            return sendIntentAction(() => core.sendPhoneMessage(), intent);
        const attachments = core.currentAttachmentDrafts();
        if ((!text.trim() && attachments.length === 0) || !core.state.selectedSessionId || core.state.unresolvedSubmission ||
            core.state.capabilities?.chat?.available !== true ||
            core.state.sessions.find((item) => item.sessionId === core.state.selectedSessionId)?.sendAvailable !== true)
            return;
        if (attachments.length)
            return sendIntentAction(() => core.sendDesktopMessageWithAttachments(text), intent);
        const sent = await core.submitCommand('session.message', { sessionId: core.state.selectedSessionId, text,
            intent: intent === 'queue' || intent === 'steer' ? intent : core.composerInputMode(core.state.selectedSessionId) }, core.state.selectedSessionId);
        if (sent) {
            effects.clearMessageDraft();
            effects.updateAvailability();
        }
    }
    async function stopCurrentTurn() {
        const session = core.state.activeChatSource === 'phone' ? core.phoneBinding()?.sessionId : core.state.selectedSessionId;
        const context = core.conversationTaskContext();
        const current = core.taskQueue().filter(row => row.state === 'running').at(-1);
        if (session && core.state.sessions.find(item => item.sessionId === session)?.running && !core.state.cancelSubmitting) {
            if (!current?.taskId || current.taskId.startsWith('turn-'))
                return core.submitCommand('session.cancel', { sessionId: session }, session);
            core.state.cancelSubmitting = true;
            effects.updateAvailability();
            try {
                const key = `${context.ownerId}/${context.identity}/${session}/${current.taskId}`;
                if (core.stopAttempt?.key !== key)
                    core.stopAttempt = { key, requestId: environment.crypto.randomUUID() };
                await core.accessApi(`/tasks/${encodeURIComponent(current.taskId)}/stop`, {
                    method: 'POST', protectedWrite: true, body: { requestId: core.stopAttempt.requestId } });
                if (core.conversationTaskCurrent(context))
                    effects.toast('停止请求已提交，排队任务会继续执行。');
            } catch (error) {
                if (core.conversationTaskCurrent(context)) effects.toast(core.taskControlError(error));
            } finally {
                core.state.cancelSubmitting = false;
                effects.updateAvailability();
            }
        }
    }
    function composerState(text) {
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
        const canSendHere = selected?.sendAvailable === true;
        const attachmentCount = phoneChat ? 0 : core.currentAttachmentDrafts().length;
        const attachmentBusy = !!core.state.attachmentUpload;
        const messageDisabled = phoneChat ? !phoneReady || !!pendingPhone || !!recovery : !chat || !model || !canSendHere || attachmentBusy;
        const running = (phoneChat ? boundSession : selected)?.running === true;
        const blockedDesktop = core.desktopBlocker();
        const hint = phoneChat && bound ? core.state.phoneSendNotice || '' : phoneChat
            ? pendingPhone && !pendingHere ? '另一条手机对话有未确认的同步请求。请先切回原对话核对。'
                : pendingHere ? core.state.phoneSendNotice || '这条文字的同步结果待核对。重试会沿用同一个消息编号。'
                    : recovery && !recoveryHere ? '旧设备有未确认文字，请先切回原手机对话核对。'
                        : recoveryHere ? '重新登录后保留了旧文字。先核对服务器是否已接收，再决定是否重新同步。' : core.state.phoneSendNotice || ''
            : !core.state.online ? '等待重新连接电脑。'
                : selected?.archived ? '这段对话已归档，请在会话菜单中恢复后继续。'
                    : selected && !canSendHere ? '旧会话历史可读；要继续聊天或在对话中执行，请新建受限远端会话。'
                    : !chat || !model ? '电脑尚无可用模型。历史可阅读，聊天请先在电脑设置中配置模型。' : '';
        return {
            phoneChat, running, hint, attachmentBusy,
            newSessionDisabled: !chat || !model || core.state.submitting || attachmentBusy || core.state.unresolvedSubmission,
            modelDisabled: phoneChat || !chat || !core.state.models.length,
            modelName: core.state.models.find(item => item.id === core.state.modelProfileId)?.name || '选择模型',
            messageDisabled, voiceDisabled: messageDisabled || core.state.submitting || core.state.phoneSending,
            sendDisabled: phoneChat
                ? !phoneReady || (!!pendingPhone && !pendingHere) || (!!recovery && !recoveryHere) || (!pendingPhone && !recovery && !text.trim())
                : !chat || !model || !canSendHere || core.state.submitting || attachmentBusy || (!text.trim() && attachmentCount === 0) || core.state.unresolvedSubmission,
            sendText: phoneChat ? bound ? '发送到电脑' : recoveryHere && !pendingPhone ? '核对旧请求' : pendingHere ? '核对并重试' : '同步文字' : '发送',
            attachmentsDisabled: phoneChat || !chat || !model || !canSendHere || core.state.submitting || attachmentBusy || core.state.unresolvedSubmission || attachmentCount >= 4,
            desktopText: blockedDesktop ? '查看原事情' : '打开记事本',
            desktopDisabled: blockedDesktop ? false : !core.state.online || core.state.capabilities?.desktopOpenApp?.available !== true || !core.state.capabilities.desktopOpenApp.appIds?.includes('notepad') || core.state.submitting || core.state.unresolvedSubmission,
            cancelHidden: phoneChat || !selected?.running,
            cancelDisabled: !core.state.online || !selected?.running || core.state.cancelSubmitting,
        };
    }
    function selectModelProfile(id) {
        if (!core.state.models.some(model => model.id === id))
            return false;
        core.state.modelProfileId = id;
        effects.updateAvailability();
        return true;
    }
    function setMessageMode(mode) { core.state.messageMode = mode === 'queue' ? 'queue' : 'steer'; effects.updateAvailability(); }
    return { addAttachmentFiles, composerInputMode, sendDraft, stopCurrentTurn, composerState, selectModelProfile, setMessageMode };
};
