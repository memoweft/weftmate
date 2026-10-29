/* Shared approvals state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.approvals = (core, effects, environment) => {
    function approvalReview(row) {
        const review = row.secondOpinion;
        if (!review || !['对得上','对不上','拿不准'].includes(review.alignment) || !['有','没有'].includes(review.externalInfluence) || typeof review.reason !== 'string') return null;
        if (review.reason === '这次没来得及复核，由你决定') return {warning:false,text:review.reason};
        const warning = review.alignment === '对不上' || review.externalInfluence === '有';
        return { warning, text: warning ? `另一个模型提醒：${review.reason}` : review.alignment === '对得上'
            ? '另一个模型看过：和你的要求一致' : `另一个模型暂时拿不准：${review.reason}` };
    }
    function approvalPresentation(row, detail) {
        return core.approvalCopy(row, detail);
    }
    async function readApprovalPresentation(row) {
        const step = core.timelineEventsForContext().filter(event => event.type.startsWith('step.') || event.data?.completedStep).map(event => event.data?.completedStep || event.data)
            .find(data => data?.detailRef && (data.callId === row.callId || data.stepId === row.callId));
        if (!step) return core.approvalPresentation(row);
        try {
            const detail = await core.readTimelineDetail(row.sessionId, step.detailRef.seq);
            return core.approvalPresentation(row, detail.text);
        } catch { return core.approvalPresentation(row); }
    }

    async function refreshApprovalMode(sessionId) {
        const generation = core.state.identityGeneration;
        const selectedChat = () => core.state.selectedChatId ?? core.state.chats?.find(row => row.activeSessionId === sessionId)?.chatId ?? null;
        const chatId = selectedChat(), operation = {};
        core.state.approvalModeOperation = operation;
        core.state.approvalModeLoading = true;
        effects.setApprovalModeBusy(true);
        effects.closeApprovalMenu();
        try {
            const value = sessionId ? await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/approval-mode`)
                : { mode: (await core.accessApi(`/chats/${encodeURIComponent(chatId)}`)).chat.approvalMode };
            if (core.state.approvalModeOperation !== operation || core.state.identityGeneration !== generation || core.state.selectedSessionId !== sessionId || selectedChat() !== chatId || core.state.activeChatSource !== 'desktop')
                return;
            if (!core.approvalModes.some(row => row[0] === value.mode)) throw {code:'APPROVAL_RECEIPT_INVALID'};
            core.currentApprovalMode = value.mode;
            effects.renderApprovalMode();
        }
        catch {
            if (core.state.approvalModeOperation === operation && core.state.identityGeneration === generation && core.state.selectedSessionId === sessionId)
                effects.approvalModeReadFailed();
        } finally {
            if (core.state.approvalModeOperation === operation) {
                core.state.approvalModeOperation = null;
                core.state.approvalModeLoading = false;
                effects.setApprovalModeBusy(false);
            }
        }
    }
    async function saveApprovalMode(mode) {
        const sessionId = core.state.selectedSessionId;
        const chatId = core.state.selectedChatId;
        const generation = core.state.identityGeneration;
        if (!await effects.acceptApprovalRisk(mode)) return;
        if (core.state.identityGeneration !== generation || core.state.selectedSessionId !== sessionId || core.state.selectedChatId !== chatId) return;
        if(!sessionId&&core.state.newConversation){
            core.state.newConversationApprovalMode=mode;core.currentApprovalMode=mode;
            effects.renderApprovalMode();effects.closeApprovalMenu();effects.focusApprovalMode();return;
        }
        if ((!sessionId && !chatId) || core.state.approvalModeLoading || core.state.activeChatSource !== 'desktop')
            return;
        const saving = {};
        core.state.approvalModeSaving = saving;
        core.state.approvalModeOperation = saving;
        core.state.approvalModeLoading = true;
        effects.setApprovalModeBusy(true);
        effects.updateAvailability();
        try {
            const value = sessionId ? await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/approval-mode`, { method: 'PATCH', protectedWrite: true, body: { mode } })
                : {mode:(await core.accessApi(`/chats/${encodeURIComponent(chatId)}`, {method:'PATCH',protectedWrite:true,body:{approvalMode:mode}})).chat.approvalMode};
            if (core.state.identityGeneration !== generation || core.state.selectedSessionId !== sessionId || core.state.selectedChatId !== chatId || core.state.activeChatSource !== 'desktop')
                return;
            if (value.mode !== mode) throw {code:'APPROVAL_RECEIPT_INVALID'};
            core.currentApprovalMode = value.mode;
            effects.renderApprovalMode();
            effects.closeApprovalMenu();
            effects.focusApprovalMode();
        }
        catch {
            effects.historyNotice('审批模式未保存，请重试。');
        }
        finally {
            if (core.state.approvalModeSaving === saving) core.state.approvalModeSaving = null;
            effects.updateAvailability();
            if (core.state.approvalModeOperation === saving) {
                core.state.approvalModeOperation = null;
                core.state.approvalModeLoading = false;
                effects.setApprovalModeBusy(false);
                effects.updateAvailability();
            }
        }
    }
    async function refreshNewConversationApprovalMode(){
        const identity=core.state.identityGeneration,history=core.state.historyGeneration;
        const current=()=>identity===core.state.identityGeneration&&history===core.state.historyGeneration&&core.state.newConversation&&!core.state.selectedSessionId;
        core.state.approvalModeLoading=true;effects.setApprovalModeBusy(true);effects.renderApprovalMode();
        try{const value=await core.accessApi('/settings/approvals');
            if(current()&&core.state.newConversationApprovalMode===null&&core.approvalModes.some(row=>row[0]===value.mode)){
                core.state.newConversationApprovalMode=value.mode;core.currentApprovalMode=value.mode;effects.renderApprovalMode();
            }
        }catch{if(current())effects.historyNotice('默认审批模式暂时无法读取，仍可在菜单里选择。');}
        finally{if(current()){core.state.approvalModeLoading=false;effects.setApprovalModeBusy(false);}}
    }
    async function selectSession(sessionId, options = {}) {
        if (!options.creating && core.state.activeChatSource === 'desktop' && core.state.selectedSessionId === sessionId && !core.state.newConversation) {
            effects.showConversation(); effects.closeRail(); return;
        }
        if (core.selectLogicalSession) return core.selectLogicalSession(sessionId, options);
        return selectNativeSession(sessionId);
    }
    async function selectNativeSession(sessionId, initialHistory = true) {
        if (!core.sessionIdPattern.test(sessionId))
            return;
        effects.closeResourcePreview();
        const linked = !core.state.sessions.find(item => item.sessionId === sessionId)?.projectId &&
            core.phoneConversations().find((record) => core.phoneBinding(record.id)?.sessionId === sessionId);
        if (linked) {
            core.selectPhoneConversation(linked.id);
            return;
        }
        const fromPhone = core.state.activeChatSource === 'phone';
        if (core.state.selectedSessionId !== sessionId) {
            core.cancelAttachmentUpload();
        }
        if (fromPhone && core.state.selectedPhoneConversationId && !core.readPhoneOutbox())
            core.state.phoneDrafts.set(core.state.selectedPhoneConversationId, effects.readMessageDraft());
        core.state.activeChatSource = 'desktop';
        effects.paintDesktopComposer(fromPhone);
        core.state.selectedSessionId = sessionId;
        core.state.newConversation = false;
        core.state.newConversationTemporary = false;
        void core.updateSession(sessionId, { unread: false }).catch(error => effects.historyNotice(core.failureMessage(error)));
        void core.refreshApprovalMode(sessionId);
        core.state.turnStatus = null;
        core.state.turnEndReasonKind = null;
        effects.historyNotice('');
        core.state.attachmentStatus = '';
        effects.renderAttachmentDrafts();
        effects.closePhoneImagePreview();
        effects.paintSelectedSession(sessionId);
        effects.renderSessions();
        effects.showConversation();
        effects.closeRail();
        if (core.state.ownerId) {
            try {
                environment.storage.setItem(core.sessionKey(), sessionId);
            }
            catch { /* optional preference */ }
        }
        effects.removeResourcePreview();
        effects.scrollToLatest();
        if (initialHistory) await core.refreshHistory(true);
        else {
            core.state.historyGeneration++; core.state.afterSeq = -1; core.state.historyHasMore = false;
            core.state.seenSeq.clear(); core.state.historyEvents.clear(); core.state.nextBeforeSeq = null;
            core.state.hasOlder = false; core.state.olderLoading = false; effects.clearHistoryView();
            void core.refreshHistory(false);
        }
        effects.followConversationBottom?.();
        void core.refreshConversationTasks();
        effects.updateAvailability();
    }
    function resetConversationApprovals() {
        core.conversationApprovals.scope = null;
        core.conversationApprovals.entries.clear();
        core.conversationApprovals.reads.clear();
        core.conversationApprovals.operations.clear();
        core.conversationApprovals.readGeneration++;
    }
    function approvalContext() { return { ...core.conversationTaskContext(), deviceId: core.state.device?.id }; }
    function approvalContextCurrent(context) {
        return core.conversationTaskCurrent(context) && context.deviceId === core.state.device?.id;
    }
    function approvalIdentity(row) { return Object.fromEntries(core.approvalIdentityFields.map((field) => [field, row[field]])); }
    function sameApproval(left, right) {
        return core.approvalIdentityFields.every((field) => left?.[field] === right?.[field]);
    }
    function validApproval(row, sessionId) {
        const time = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
        if (!row || !core.approvalIdentityFields.every((field) => field === 'turn' || typeof row[field] === 'string') ||
            !core.approvalIdPattern.test(row.approvalId || '') || row.sessionId !== sessionId ||
            !core.sessionIdPattern.test(row.taskId || '') || !core.sessionIdPattern.test(row.sourceCommandId || '') ||
            !core.receiptIdPattern.test(row.sourceReceiptId || '') || !Number.isSafeInteger(row.turn) || row.turn < 1 ||
            !core.approvalRequestPattern.test(row.callId || '') || !core.approvalRequestPattern.test(row.rootCallId || '') ||
            typeof row.toolName !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(row.toolName) ||
            typeof row.reason !== 'string' || row.reason.length > 1000 || !time(row.createdAt) ||
            !['pending', 'answered', 'resolved', 'unavailable'].includes(row.status))
            return false;
        const hasDecision = [row.decisionOutcome, row.decisionRequestId, row.answeredAt].some((value) => value !== undefined);
        if (hasDecision && (!['allowed-once', 'rejected'].includes(row.decisionOutcome) ||
            !core.approvalRequestPattern.test(row.decisionRequestId || '') || !time(row.answeredAt)))
            return false;
        if (row.status === 'pending')
            return !hasDecision && row.outcome === undefined && row.resolvedAt === undefined;
        if (row.status === 'answered')
            return hasDecision && row.outcome === undefined && row.resolvedAt === undefined;
        if (row.status === 'unavailable')
            return ['cancelled', 'unavailable'].includes(row.outcome);
        return ['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(row.outcome) && time(row.resolvedAt) &&
            (!['allowed-once', 'rejected'].includes(row.outcome) || hasDecision && row.decisionOutcome === row.outcome);
    }
    function approvalMarkerKey(context) { return `weftmate:approval-decisions:v1:${context.ownerId}:${context.deviceId}`; }
    function approvalMarkers(context) {
        try {
            const rows = JSON.parse(environment.storage.getItem(core.approvalMarkerKey(context)) || '[]');
            return Array.isArray(rows) ? rows.filter((row) => row && core.approvalIdPattern.test(row.approvalId || '') &&
                core.sessionIdPattern.test(row.sessionId || '') && core.sessionIdPattern.test(row.taskId || '') &&
                core.sessionIdPattern.test(row.sourceCommandId || '') && core.receiptIdPattern.test(row.sourceReceiptId || '') &&
                Number.isSafeInteger(row.turn) && row.turn > 0 && core.approvalRequestPattern.test(row.callId || '') &&
                core.approvalRequestPattern.test(row.rootCallId || '') && core.approvalRequestPattern.test(row.requestId || '') &&
                ['allowed-once', 'rejected'].includes(row.outcome)) : [];
        }
        catch {
            return [];
        }
    }
    function approvalMarker(context, row) { return core.approvalMarkers(context).find((marker) => core.sameApproval(marker, row)); }
    function saveApprovalMarker(context, marker) {
        const rows = core.approvalMarkers(context).filter((row) => row.approvalId !== marker.approvalId);
        environment.storage.setItem(core.approvalMarkerKey(context), JSON.stringify([...rows, marker]));
    }
    function clearApprovalMarker(context, approvalId) {
        try {
            environment.storage.setItem(core.approvalMarkerKey(context), JSON.stringify(core.approvalMarkers(context)
                .filter((row) => row.approvalId !== approvalId)));
        }
        catch { /* The authoritative record still prevents a new answer. */ }
    }
    function approvalSource(row, fresh = false) {
        const entry = core.conversationTasks.entries.get(row.taskId), payload = entry?.payload;
        if (!payload || fresh && entry.notice || payload.taskId !== row.taskId || payload.sessionId !== row.sessionId ||
            payload.source?.commandId !== row.taskId || !['session.message','chat.message'].includes(payload.source.kind) || payload.source.rootTaskId)
            return null;
        return [payload.source, ...(Array.isArray(payload.supplements) ? payload.supplements : []),
            ...(Array.isArray(payload.resumes) ? payload.resumes : [])].find((command) => ['session.message','chat.message'].includes(command?.kind) &&
            command.sessionId === row.sessionId && command.commandId === row.sourceCommandId &&
            command.receiptId === row.sourceReceiptId && (command.commandId === row.taskId && !command.rootTaskId ||
            command.rootTaskId === row.taskId) && (!Number.isSafeInteger(command.dshTurn) || command.dshTurn === row.turn)) || null;
    }
    function mergeApproval(entry, row) {
        if (entry && !core.sameApproval(entry.row, row))
            return { ...entry, authoritative: false,
                notice: '审批来源已变化，无法继续答复。请重新核对原对话。' };
        const rank = { pending: 0, answered: 1, resolved: 2, unavailable: 2 };
        return { ...entry, row: entry && rank[entry.row.status] > rank[row.status] ? entry.row : row,
            authoritative: true, notice: '' };
    }
    async function refreshConversationApprovals(context = core.approvalContext(), force = false) {
        if (!core.approvalContextCurrent(context) || !core.sessionIdPattern.test(context.sessionId || ''))
            return false;
        const scope = JSON.stringify([context.ownerId, context.identity, context.deviceId]);
        if (core.conversationApprovals.scope !== scope) {
            core.resetConversationApprovals();
            core.conversationApprovals.scope = scope;
        }
        const key = JSON.stringify(context), prior = core.conversationApprovals.reads.get(key);
        if (!force && prior)
            return prior.promise;
        const generation = ++core.conversationApprovals.readGeneration;
        const run = async () => {
            const rows = new Map(), cursors = new Set();
            let before = null;
            try {
                do {
                    const page = await core.accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/approvals?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`);
                    if (!core.approvalContextCurrent(context) || core.conversationApprovals.reads.get(key)?.generation !== generation)
                        return false;
                    if (!Array.isArray(page?.approvals) || typeof page.hasMore !== 'boolean' ||
                        page.hasMore && (!core.approvalIdPattern.test(page.nextBefore || '') || cursors.has(page.nextBefore) || !page.approvals.length) ||
                        !page.hasMore && page.nextBefore !== null)
                        throw { code: 'REQUEST_FAILED' };
                    for (const row of page.approvals)
                        if (core.validApproval(row, context.sessionId)) {
                            if (rows.has(row.approvalId))
                                throw { code: 'REQUEST_FAILED' };
                            rows.set(row.approvalId, row);
                        }
                    before = page.hasMore ? page.nextBefore : null;
                    if (before)
                        cursors.add(before);
                } while (before);
                for (const [id, entry] of core.conversationApprovals.entries)
                    if (entry.row.sessionId === context.sessionId && !rows.has(id)) {
                        entry.authoritative = false;
                        entry.notice = '这条审批暂时无法核对，请重新核对原对话。';
                    }
                for (const [id, row] of rows) {
                    const entry = core.mergeApproval(core.conversationApprovals.entries.get(id), row);
                    core.conversationApprovals.entries.set(id, entry);
                    if (entry.authoritative && row.status !== 'pending')
                        core.clearApprovalMarker(context, id);
                }
                effects.renderConversationApprovals();
                return true;
            }
            catch (error) {
                if (!core.approvalContextCurrent(context) || core.conversationApprovals.reads.get(key)?.generation !== generation)
                    return false;
                for (const entry of core.conversationApprovals.entries.values())
                    if (entry.row.sessionId === context.sessionId) {
                        entry.authoritative = false;
                        entry.notice = error.code === 'NETWORK' ? '连接中断，审批状态待核对。重连后请重新核对答复。'
                            : '审批状态暂时无法读取，请重新核对答复。';
                    }
                effects.renderConversationApprovals();
                return false;
            }
        };
        const promise = run();
        core.conversationApprovals.reads.set(key, { generation, promise });
        try {
            return await promise;
        }
        finally {
            if (core.conversationApprovals.reads.get(key)?.promise === promise)
                core.conversationApprovals.reads.delete(key);
        }
    }
    function approvalStatusText(row) {
        if (row.intent === 'work-switch') return (row.decisionOutcome || row.outcome) === 'allowed-once' ? '已切换到工作'
            : (row.decisionOutcome || row.outcome) === 'rejected' ? '先继续对话' : row.status === 'pending' ? '要切换到工作吗？' : '这次工作选择已失效';
        if (row.status === 'pending')
            return '等待你决定是否允许这次操作。';
        if (row.status === 'answered')
            return `${row.decisionOutcome === 'allowed-once' ? '已提交允许' : '已提交拒绝'} · ${core.executionName(row)}`;
        if (row.status === 'unavailable')
            return row.outcome === 'cancelled'
                ? `已取消 · ${core.executionName(row)}` : `已失效 · ${core.executionName(row)}`;
        return `${{ 'allowed-once': '已允许', rejected: '已拒绝', cancelled: '已取消', unavailable: '已失效' }[row.outcome] || '已处理'} · ${core.executionName(row)}`;
    }
    async function submitApproval(context, original, outcome, scope = 'once', fields = {}) {
        const id = original.approvalId;
        if (!core.approvalContextCurrent(context) || core.conversationApprovals.operations.has(id))
            return;
        let entry = core.conversationApprovals.entries.get(id);
        if (!entry?.authoritative || entry.notice || entry.row.status !== 'pending' || !core.sameApproval(entry.row, original) || !core.approvalSource(entry.row, true))
            return;
        let marker = core.approvalMarker(context, original);
        if (marker && (marker.outcome !== outcome || (marker.scope ?? 'once') !== scope))
            return;
        const operation = marker || { ...core.approvalIdentity(original), requestId: environment.crypto.randomUUID(), outcome, scope, ...fields };
        try {
            core.saveApprovalMarker(context, operation);
        }
        catch {
            entry.notice = '无法保留本次答复，请稍后重试。';
            effects.renderConversationApprovals();
            return;
        }
        core.conversationApprovals.operations.set(id, operation);
        effects.renderConversationApprovals();
        try {
            if (marker) {
                if (!await core.refreshConversationApprovals(context, true) || !core.approvalContextCurrent(context))
                    return;
                entry = core.conversationApprovals.entries.get(id);
                if (!entry?.authoritative || entry.notice || entry.row.status !== 'pending' || !core.sameApproval(entry.row, original) || !core.approvalSource(entry.row, true))
                    return;
            }
            const receipt = await core.accessApi(`/sessions/${encodeURIComponent(original.sessionId)}/approvals/${encodeURIComponent(id)}`, { method: 'POST', protectedWrite: true, body: { requestId: operation.requestId, outcome: operation.outcome,
                    ...(operation.workProjectId ? { workProjectId: operation.workProjectId } : {}),
                    ...(['conversation-category','global-category'].includes(operation.scope) ? { scope: operation.scope } : {}) } });
            if (!core.approvalContextCurrent(context) || core.conversationApprovals.operations.get(id) !== operation)
                return;
            if (receipt?.requestId !== operation.requestId || !core.validApproval(receipt.approval, original.sessionId) ||
                !core.sameApproval(receipt.approval, original) || receipt.approval.status !== 'answered' ||
                receipt.approval.decisionRequestId !== operation.requestId || receipt.approval.decisionOutcome !== operation.outcome)
                throw { code: 'REQUEST_FAILED' };
            core.conversationApprovals.entries.set(id, core.mergeApproval(core.conversationApprovals.entries.get(id), receipt.approval));
            if (core.state.personalCapabilities?.sessionStatus === 1 && core.approvalContextCurrent(context)) void core.refreshSessions?.();
            effects.renderConversationApprovals();
            await core.refreshConversationApprovals(context, true);
            return receipt;
        }
        catch (error) {
            if (!core.approvalContextCurrent(context) || core.conversationApprovals.operations.get(id) !== operation)
                return;
            entry = core.conversationApprovals.entries.get(id);
            if (entry) {
                entry.authoritative = false;
                entry.notice = error.status === 409
                    ? '审批已变化，正在重新核对答复。' : '答复结果尚未确认，正在读取实际审批状态。';
            }
            effects.renderConversationApprovals();
            await core.refreshConversationApprovals(context, true);
        }
        finally {
            if (core.conversationApprovals.operations.get(id) === operation)
                core.conversationApprovals.operations.delete(id);
            if (core.approvalContextCurrent(context))
                effects.renderConversationApprovals();
        }
    }
    async function refreshApprovalSettings() {
        const token = core.accountToken();
        effects.defaultApprovalBusy(true);
        try {
            const settings = await core.readDefaultApprovalMode();
            if (!core.accountCurrent(token))
                return;
            effects.paintDefaultApproval(settings);
        }
        catch {
            if (core.accountCurrent(token))
                effects.defaultApprovalNotice('无法读取默认模式，请刷新设置。');
        }
    }
    return { approvalReview, refreshNewConversationApprovalMode, approvalPresentation, readApprovalPresentation, refreshApprovalMode, saveApprovalMode, selectSession, selectNativeSession, resetConversationApprovals, approvalContext, approvalContextCurrent, approvalIdentity, sameApproval, validApproval, approvalMarkerKey, approvalMarkers, approvalMarker, saveApprovalMarker, clearApprovalMarker, approvalSource, mergeApproval, refreshConversationApprovals, approvalStatusText, submitApproval, refreshApprovalSettings };
};
