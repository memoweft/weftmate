/* Shared phone state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.phone = (core, effects, environment) => {
    function phoneSource(deviceId) {
        return core.state.phoneDeviceNames.get(deviceId) ?? '同步设备（名称未读取）';
    }
    function phoneDisplayTitle(record) {
        if (!['新对话', '手机对话'].includes(record.title.trim()))
            return record.title;
        const first = record.events.find((event) => event.kind === 'message.created' &&
            event.payload?.role === 'user' && typeof event.payload.text === 'string');
        const summary = first?.payload.text.replace(/\s+/gu, ' ').trim();
        if (!summary)
            return record.title;
        const characters = Array.from(summary);
        return characters.slice(0, 26).join('') + (characters.length > 26 ? '…' : '');
    }
    function phoneConversations() {
        const conversations = new Map();
        for (const event of [...core.state.phoneEvents].sort((a, b) => a.seq - b.seq)) {
            if (typeof event?.conversationId !== 'string' || !core.syncIdPattern.test(event.conversationId))
                continue;
            if (!conversations.has(event.conversationId))
                conversations.set(event.conversationId, { id: event.conversationId, title: '手机对话', sources: new Set(), events: [] });
            const record = conversations.get(event.conversationId);
            if (event.kind === 'conversation.created' && typeof event.payload?.title === 'string')
                record.title = event.payload.title;
            record.sources.add(event.sourceDeviceId);
            record.events.push(event);
        }
        return [...conversations.values()];
    }
    function phoneBinding(conversationId = core.state.selectedPhoneConversationId) {
        const view = core.state.phoneBindings.get(conversationId);
        return view?.status === 'active' && core.sessionIdPattern.test(view.binding?.sessionId || '')
            ? view.binding : null;
    }
    function matchingOriginalPhoneModels(view, models) {
        const original = view?.originalModel;
        if (!original || typeof original.modelId !== 'string')
            return [];
        if (typeof original.hostProfileId === 'string')
            return models.filter((model) => model.id === original.hostProfileId && model.model === original.modelId);
        if (typeof original.routeFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(original.routeFingerprint))
            return [];
        return models.filter((model) => model.model === original.modelId &&
            model.routeFingerprint === original.routeFingerprint);
    }
    async function refreshPhoneBinding(conversationId) {
        if (!core.state.online || !core.state.syncAvailable || !core.syncIdPattern.test(conversationId))
            return null;
        const owner = core.state.ownerId, generation = core.state.identityGeneration;
        try {
            const view = await core.requestJson(`${core.accessBase}/sync/conversations/${encodeURIComponent(conversationId)}/shared`);
            if (core.state.ownerId !== owner || core.state.identityGeneration !== generation ||
                view?.conversationId !== conversationId || view?.hostId !== core.state.hostId || view?.source !== 'host')
                return null;
            core.state.phoneBindings.set(conversationId, view);
            effects.renderSessions();
            if (core.state.activeChatSource === 'desktop' && core.state.selectedSessionId === view.binding?.sessionId &&
                view.status === 'active')
                core.selectPhoneConversation(conversationId);
            if (core.state.activeChatSource === 'phone' && core.state.selectedPhoneConversationId === conversationId) {
                effects.updateAvailability();
                effects.renderSelectedPhoneConversation();
                if (core.phoneBinding(conversationId))
                    void core.refreshPhoneHostEvents(conversationId);
            }
            return view;
        }
        catch {
            return null;
        }
    }
    async function refreshPhoneHostEvents(conversationId) {
        const binding = core.phoneBinding(conversationId);
        if (!binding || !core.state.online)
            return;
        const owner = core.state.ownerId, generation = core.state.identityGeneration, sessionId = binding.sessionId;
        const events = [...(core.state.phoneHostEvents.get(conversationId) || [])];
        let afterSeq = core.state.phoneHistoryCursors.get(conversationId)?.nextSeq ?? -1;
        try {
            for (let pageNo = 0; pageNo < 20; pageNo++) {
                const page = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/events?${afterSeq === -1 ? '' : `afterSeq=${afterSeq}&`}limit=100`);
                if (core.state.ownerId !== owner || core.state.identityGeneration !== generation ||
                    core.phoneBinding(conversationId)?.sessionId !== sessionId || !Array.isArray(page?.events) ||
                    !Number.isSafeInteger(page.nextSeq) || page.nextSeq < afterSeq)
                    return;
                events.push(...page.events.filter((event) => Number.isSafeInteger(event?.seq) &&
                    typeof event.type === 'string'));
                const cursor = core.state.phoneHistoryCursors.get(conversationId) || {};
                if (afterSeq === -1) {
                    cursor.nextBeforeSeq = page.nextBeforeSeq;
                    cursor.hasOlder = page.hasOlder === true;
                }
                cursor.nextSeq = page.nextSeq;
                core.state.phoneHistoryCursors.set(conversationId, cursor);
                if (page.hasMore !== true)
                    break;
                if (page.nextSeq <= afterSeq)
                    return;
                afterSeq = page.nextSeq;
            }
            core.state.phoneHostEvents.set(conversationId, events);
            if (core.state.activeChatSource === 'phone' && core.state.selectedPhoneConversationId === conversationId)
                effects.renderSelectedPhoneConversation();
        }
        catch { /* The verified phone history remains visible. */ }
    }
    async function findPhoneSyncEvent(outbox, current) {
        let afterSeq = 0;
        for (let pageNo = 0; pageNo < 101; pageNo++) {
            const page = await core.accessApi(`/sync/events?afterSeq=${afterSeq}&limit=200`);
            if (!current())
                return null;
            if (!Array.isArray(page.events) || !Number.isSafeInteger(page.nextSeq) ||
                page.nextSeq < afterSeq || typeof page.hasMore !== 'boolean')
                throw { code: 'REQUEST_FAILED' };
            const found = page.events.find((row) => row.eventId === outbox.event.eventId);
            if (found) {
                const expected = outbox.event;
                if (found.sourceDeviceId !== outbox.deviceId || found.conversationId !== expected.conversationId ||
                    found.clientSeq !== expected.clientSeq || found.kind !== expected.kind ||
                    found.occurredAt !== expected.occurredAt || JSON.stringify(found.payload) !== JSON.stringify(expected.payload)) {
                    throw { code: 'REQUEST_CONFLICT' };
                }
                return found;
            }
            if (!page.hasMore)
                return null;
            if (page.nextSeq === afterSeq)
                throw { code: 'REQUEST_FAILED' };
            afterSeq = page.nextSeq;
        }
        throw { code: 'CAPACITY_LIMIT' };
    }
    function phoneMessageText(value) {
        const text = typeof value === 'string' ? value : '';
        const marker = /(?:^|\n)\[本机附件：([^\n]*)；跨端暂不可见\]$/.exec(text);
        return marker ? { text: text.slice(0, marker.index).trimEnd(), legacy: marker[1] } : { text, legacy: null };
    }
    function legacyFileNames(value) {
        return typeof value === 'string' ? value.split('、').map((name) => name.trim()).filter((name) => name && !/\.(?:png|jpe?g|webp|gif)$/i.test(name)).join('、') : '';
    }
    function phoneHandoffKey(conversationId) {
        return `weftmate:phone-handoff:v1:${core.state.ownerId}:${conversationId}`;
    }
    async function adoptPhoneConversation(conversationId, modelProfileId) {
        if (core.state.phoneHandoffBusy || !core.state.online || !core.syncIdPattern.test(conversationId) ||
            !core.state.models.some((model) => model.id === modelProfileId))
            return;
        const view = core.state.phoneBindings.get(conversationId);
        if (!view || view.status === 'active' || view.canAdopt !== true ||
            !Number.isSafeInteger(view.syncThroughSeq))
            return;
        const owner = core.state.ownerId, generation = core.state.identityGeneration;
        const key = core.phoneHandoffKey(conversationId);
        let intent;
        try {
            intent = JSON.parse(environment.storage.getItem(key) || 'null');
        }
        catch {
            intent = null;
        }
        if (intent && (intent.modelProfileId !== modelProfileId ||
            intent.expectedSyncSeq !== view.syncThroughSeq || !/^[0-9a-f-]{36}$/.test(intent.requestId || ''))) {
            core.state.phoneSendNotice = '原交接请求仍待核对，请保持原模型选择并重试。';
            effects.renderSelectedPhoneConversation();
            return;
        }
        intent ||= { requestId: environment.crypto.randomUUID(), modelProfileId, expectedSyncSeq: view.syncThroughSeq };
        try {
            environment.storage.setItem(key, JSON.stringify(intent));
        }
        catch {
            core.state.phoneSendNotice = '无法保存交接编号。本次没有提交，请检查浏览器存储。';
            effects.renderSelectedPhoneConversation();
            return;
        }
        core.state.phoneHandoffBusy = true;
        effects.renderSelectedPhoneConversation();
        const current = () => core.state.ownerId === owner && core.state.identityGeneration === generation &&
            core.state.selectedPhoneConversationId === conversationId;
        try {
            let command = null;
            try {
                const prior = await core.accessApi(`/commands/by-request/${encodeURIComponent(intent.requestId)}`);
                command = prior.command;
            }
            catch (error) {
                if (error?.code !== 'NOT_FOUND')
                    throw error;
            }
            if (!current())
                return;
            if (!command) {
                const result = await core.accessApi(`/sync/conversations/${encodeURIComponent(conversationId)}/shared`, {
                    method: 'POST', protectedWrite: true, body: intent
                });
                command = result.command;
            }
            if (!current() || command?.requestId !== intent.requestId || command?.kind !== 'session.create')
                throw { code: 'REQUEST_FAILED' };
            core.state.phoneSendNotice = '电脑正在接上原对话，完成后可在这里继续发送。';
            for (let attempt = 0; attempt < 10 && current(); attempt++) {
                const latest = await core.refreshPhoneBinding(conversationId);
                if (latest?.status === 'active' && latest.binding?.sessionId === command.sessionId) {
                    environment.storage.removeItem(key);
                    core.state.phoneSendNotice = '已接上电脑模型。原手机记录和图片仍在这条对话里。';
                    await core.refreshSessions();
                    await core.refreshPhoneHostEvents(conversationId);
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 400));
            }
        }
        catch (error) {
            const existing = current() ? await core.refreshPhoneBinding(conversationId) : null;
            if (current() && existing?.status === 'active') {
                if (existing.binding?.modelProfileId === modelProfileId) {
                    environment.storage.removeItem(key);
                    core.state.phoneSendNotice = '这条原对话已有电脑接续，已显示现有会话。';
                }
                else
                    core.state.phoneSendNotice = '这条对话已绑定另一台电脑模型；请查看原交接。';
            }
            else if (current())
                core.state.phoneSendNotice = error?.code === 'LOCAL_TURN_RUNNING'
                    ? '手机仍在回复，等这轮结束并同步后再接到电脑。'
                    : error?.code === 'LOCAL_TURN_UNCONFIRMED'
                        ? '手机回合状态待核对；只能按已同步的记录明确交接。'
                        : error?.code === 'SOURCE_DEVICE_UPGRADE_REQUIRED'
                            ? '请先更新创建这条对话的手机应用，再从原对话接到电脑。'
                            : '交接结果待核对。原编号已保留，不会另建会话。';
        }
        finally {
            if (core.state.ownerId === owner && core.state.identityGeneration === generation) {
                core.state.phoneHandoffBusy = false;
                if (current())
                    effects.renderSelectedPhoneConversation();
            }
        }
    }
    function completePhoneSend(outbox, row) {
        if (!core.state.phoneEvents.some((event) => event.eventId === row.eventId)) {
            core.state.phoneEvents.push(row);
            core.state.phoneEvents.sort((a, b) => a.seq - b.seq);
        }
        core.rememberPhoneClientSeq(outbox.event.clientSeq);
        core.clearPhoneOutbox();
        core.state.phoneDrafts.delete(outbox.event.conversationId);
        if (core.state.activeChatSource === 'phone' && core.state.selectedPhoneConversationId === outbox.event.conversationId) {
            if (effects.readMessageDraft() === outbox.event.payload.text)
                effects.clearMessageDraft();
            core.state.phoneSendNotice = '文字已同步到原手机对话。MiMo 回复需在手机端继续，电脑没有运行模型。';
            effects.renderSelectedPhoneConversation();
        }
        effects.renderSessions();
        effects.updateAvailability();
    }
    async function sendPhoneMessage() {
        const bound = core.phoneBinding();
        if (bound) {
            if (core.state.phoneSending || !core.state.online ||
                core.state.sessions.find((item) => item.sessionId === bound.sessionId)?.sendAvailable !== true)
                return;
            const conversationId = core.state.selectedPhoneConversationId, text = effects.readMessageDraft().trim(), owner = core.state.ownerId, generation = core.state.identityGeneration;
            if (!text)
                return;
            core.state.phoneSending = true;
            effects.updateAvailability();
            try {
                const command = await core.submitCommand('session.message', { sessionId: bound.sessionId, text, mode: core.composerInputMode(bound.sessionId) }, bound.sessionId);
                if (core.state.ownerId !== owner || core.state.identityGeneration !== generation ||
                    core.state.selectedPhoneConversationId !== conversationId || core.state.activeChatSource !== 'phone')
                    return;
                if (command?.state === 'accepted_by_dsh') {
                    core.state.phoneDrafts.delete(conversationId);
                    if (effects.readMessageDraft().trim() === text)
                        effects.clearMessageDraft();
                    core.state.phoneSendNotice = '电脑已受理，正在等待真实会话记录。';
                    await Promise.all([core.refreshPhoneBinding(conversationId), core.refreshPhoneHostEvents(conversationId)]);
                }
                else
                    core.state.phoneSendNotice = '结果待核对。原请求编号和草稿已保留。';
            }
            finally {
                if (core.state.ownerId === owner && core.state.identityGeneration === generation) {
                    core.state.phoneSending = false;
                    effects.updateAvailability();
                }
            }
            return;
        }
        if (core.state.phoneSending || core.state.activeChatSource !== 'phone' || !core.state.online || !core.state.syncAvailable ||
            !core.state.ownerId || !core.state.device?.id || !core.syncIdPattern.test(core.state.selectedPhoneConversationId))
            return;
        const ownerId = core.state.ownerId, deviceId = core.state.device.id, generation = core.state.identityGeneration, conversationId = core.state.selectedPhoneConversationId;
        const current = () => core.state.ownerId === ownerId && core.state.device?.id === deviceId &&
            core.state.identityGeneration === generation && core.state.activeChatSource === 'phone' &&
            core.state.selectedPhoneConversationId === conversationId && !!core.state.csrfToken;
        let outbox = core.readPhoneOutbox();
        if (outbox && outbox.event.conversationId !== conversationId)
            return;
        const recovery = !outbox ? core.readPhoneRecovery() : null;
        if (recovery) {
            if (recovery.event.conversationId !== conversationId)
                return;
            core.state.phoneSending = true;
            effects.updateAvailability();
            try {
                const saved = await core.findPhoneSyncEvent(recovery, current);
                if (!current())
                    return;
                if (saved && !core.state.phoneEvents.some((event) => event.eventId === saved.eventId)) {
                    core.state.phoneEvents.push(saved);
                    core.state.phoneEvents.sort((a, b) => a.seq - b.seq);
                }
                try {
                    environment.storage.removeItem(`weftmate:phone-sync-outbox:v1:${ownerId}:${recovery.deviceId}`);
                    environment.storage.removeItem(core.phoneRecoveryKey());
                }
                catch { /* A later check may still see the old record. */ }
                if (saved) {
                    effects.clearMessageDraft();
                    core.state.phoneSendNotice = '旧文字已在原对话中找到，没有再次发送。MiMo 回复需在手机端继续。';
                    effects.renderSelectedPhoneConversation();
                }
                else {
                    core.state.phoneDrafts.set(conversationId, recovery.event.payload.text);
                    effects.setMessageDraft(recovery.event.payload.text);
                    core.state.phoneSendNotice = '未找到旧文字，草稿已恢复。确认内容后可用新设备会话同步。';
                }
            }
            catch {
                if (current())
                    core.state.phoneSendNotice = '旧请求暂时无法核对。原文仍保留，请重连后重试。';
            }
            finally {
                if (core.state.ownerId === ownerId && core.state.device?.id === deviceId && core.state.identityGeneration === generation) {
                    core.state.phoneSending = false;
                    if (current())
                        effects.updateAvailability();
                }
            }
            return;
        }
        const wasPending = !!outbox;
        if (!outbox) {
            const text = effects.readMessageDraft().trim();
            const clientSeq = core.nextPhoneClientSeq();
            const eventId = `event-${environment.crypto.randomUUID()}`, messageId = `message-${environment.crypto.randomUUID()}`;
            if (!text || text.length > 8192 || !clientSeq || !core.syncIdPattern.test(eventId) ||
                !core.syncIdPattern.test(messageId))
                return;
            outbox = { ownerId, deviceId, event: { eventId, conversationId, clientSeq,
                    kind: 'message.created', occurredAt: new Date().toISOString(),
                    payload: { messageId, role: 'user', text } } };
            if (!core.writePhoneOutbox(outbox)) {
                core.state.phoneSendNotice = '浏览器未能保存待发送文字。本次没有提交，请检查浏览器存储后重试。';
                effects.updateAvailability();
                return;
            }
        }
        core.state.phoneSending = true;
        core.state.phoneSendNotice = '正在核对并同步这条文字…';
        effects.updateAvailability();
        try {
            if (wasPending) {
                const existing = await core.findPhoneSyncEvent(outbox, current);
                if (!current())
                    return;
                if (existing)
                    return core.completePhoneSend(outbox, existing);
            }
            const result = await core.writePhoneEvents([outbox.event]);
            if (!current())
                return;
            const receipt = result?.accepted?.find((item) => item.eventId === outbox.event.eventId);
            if (!Number.isSafeInteger(receipt?.seq) || receipt.seq < 1)
                throw { code: 'REQUEST_FAILED' };
            const saved = await core.findPhoneSyncEvent(outbox, current);
            if (!current())
                return;
            if (!saved)
                throw { code: 'REQUEST_FAILED' };
            core.completePhoneSend(outbox, saved);
        }
        catch (error) {
            if (!current())
                return;
            if (['NETWORK', 'REQUEST_CONFLICT', 'REQUEST_FAILED'].includes(error?.code)) {
                try {
                    const saved = await core.findPhoneSyncEvent(outbox, current);
                    if (!current())
                        return;
                    if (saved)
                        return core.completePhoneSend(outbox, saved);
                }
                catch { /* Keep the exact event for the next explicit reconciliation. */ }
            }
            core.state.phoneSendNotice = error?.code === 'UNAUTHORIZED' ? '登录已失效。重新登录后请核对这条文字。'
                : error?.code === 'REQUEST_CONFLICT' ? '同步编号发生冲突，原文已保留。请重新登录以生成新设备会话，先核对旧消息再发送。'
                    : '同步结果未确认。文字已保留；重连后点“核对并重试”，不会生成第二条消息。';
        }
        finally {
            if (core.state.ownerId === ownerId && core.state.device?.id === deviceId && core.state.identityGeneration === generation) {
                core.state.phoneSending = false;
                if (current())
                    effects.updateAvailability();
            }
        }
    }
    async function refreshPhoneRecords(reset = false) {
        if (!core.state.syncAvailable || core.state.phoneLoading)
            return;
        if (reset) {
            core.state.phoneEvents = [];
            core.state.phoneAfterSeq = 0;
            core.state.phoneHasMore = true;
        }
        const owner = core.state.ownerId, identity = core.state.csrfToken;
        core.state.phoneLoading = true;
        try {
            let shouldRead = true;
            for (let pageNo = 0; pageNo < 5 && shouldRead; pageNo++) {
                const page = await core.readPhoneEvents(core.state.phoneAfterSeq);
                if (core.state.ownerId !== owner || core.state.csrfToken !== identity)
                    return;
                if (!Array.isArray(page.events) || !Number.isSafeInteger(page.nextSeq) ||
                    page.nextSeq < core.state.phoneAfterSeq || typeof page.hasMore !== 'boolean')
                    throw { code: 'REQUEST_FAILED' };
                let previous = core.state.phoneAfterSeq;
                for (const event of page.events) {
                    if (!Number.isSafeInteger(event?.seq) || event.seq <= previous || event.seq > page.nextSeq)
                        throw { code: 'REQUEST_FAILED' };
                    previous = event.seq;
                    if (!core.state.phoneEvents.some((known) => known.seq === event.seq))
                        core.state.phoneEvents.push(event);
                }
                if (page.hasMore && page.nextSeq === core.state.phoneAfterSeq)
                    throw { code: 'REQUEST_FAILED' };
                core.state.phoneAfterSeq = page.nextSeq;
                core.state.phoneHasMore = page.hasMore;
                shouldRead = page.hasMore;
            }
            effects.renderPhoneRecords();
            effects.renderSessions();
            if (core.state.activeChatSource === 'phone')
                effects.renderSelectedPhoneConversation();
            const candidates = core.phoneConversations().slice(0, 30).map((record) => record.id);
            void Promise.allSettled(candidates.map((id) => core.refreshPhoneBinding(id)));
            if (core.state.phoneHasMore)
                effects.phoneRecordsNotice('还有同步记录未读完，可继续读取。');
        }
        catch (error) {
            if (error.code !== 'UNAUTHORIZED')
                effects.phoneRecordsNotice(error.code === 'NETWORK' ? '连接中断，重连后从原位置补读手机记录。' : '手机记录暂时无法读取，请刷新重试。');
        }
        finally {
            core.state.phoneLoading = false;
        }
    }
    function selectPhoneConversation(conversationId) {
        effects.closeResourcePreview();
        if (!core.syncIdPattern.test(conversationId) || !core.phoneConversations().some((item) => item.id === conversationId))
            return;
        if (core.state.activeChatSource === 'desktop') {
            core.state.desktopDraft = effects.readMessageDraft();
            core.cancelAttachmentUpload();
        }
        else if (core.state.selectedPhoneConversationId && !core.readPhoneOutbox())
            core.state.phoneDrafts.set(core.state.selectedPhoneConversationId, effects.readMessageDraft());
        core.state.activeChatSource = 'phone';
        core.state.turnStatus = null;
        core.state.turnEndReasonKind = null;
        core.state.selectedPhoneConversationId = conversationId;
        core.state.phoneSendNotice = '';
        const pending = core.readPhoneOutbox();
        const recovery = !pending ? core.readPhoneRecovery() : null;
        effects.setMessageDraft(pending?.event.conversationId === conversationId
            ? pending.event.payload.text : recovery?.event.conversationId === conversationId
            ? recovery.event.payload.text : core.state.phoneDrafts.get(conversationId) || '');
        effects.phoneComposerPresentation();
        core.state.attachmentStatus = '';
        effects.renderAttachmentDrafts();
        core.state.historyGeneration++;
        effects.closePhoneImagePreview();
        effects.showConversation();
        effects.renderSessions();
        effects.closeRail();
        void core.refreshPhoneBinding(conversationId);
    }
    return { phoneSource, phoneDisplayTitle, phoneConversations, phoneBinding, matchingOriginalPhoneModels, refreshPhoneBinding, refreshPhoneHostEvents, findPhoneSyncEvent, phoneMessageText, legacyFileNames, phoneHandoffKey, adoptPhoneConversation, completePhoneSend, sendPhoneMessage, refreshPhoneRecords, selectPhoneConversation };
};
