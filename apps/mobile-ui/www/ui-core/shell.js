/* Shared shell state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.shell = (core, effects, environment) => {
    function failureMessage(error, context) {
        switch (error?.code) {
            case 'USAGE_LIMIT_REACHED': return '本月用量已达到上限，云端模型请求已暂停。请在设置 → 用量提高本月上限，或切换本地模型。';
            case 'INVALID_CREDENTIALS': return '账户名或密码不正确。';
            case 'LOGIN_RATE_LIMITED': return '登录尝试过于频繁，请稍后再试。';
            case 'INVALID_SETUP_GRANT': return '设置链接已失效，请在这台电脑上重新发起设置。';
            case 'ACCOUNT_ALREADY_CONFIGURED': return '账户已设置，请直接登录。';
            case 'ACCOUNT_ALREADY_EXISTS': return '这个账户名已经有人使用，请换一个名称或直接登录。';
            case 'FORBIDDEN': return '当前登录没有执行这项操作的权限。';
            case 'UNAUTHORIZED': return '登录已失效，请重新登录。';
            case 'BROWSER_DNS_TIMEOUT': return '网页域名解析超时，本次没有取得可引用的页面正文。';
            case 'BROWSER_DOWNGRADE_BLOCKED': return '网页从 HTTPS 跳到不安全的 HTTP，已阻止继续读取。';
            case 'BROWSER_PAGE_CHANGED': return '网页读取时发生跳转或变化，本次正文不能作为来源，请重试。';
            case 'BROWSER_CLEANUP_FAILED': return '隔离浏览会话清理未能确认，请稍后重新核对网页任务。';
            default: return context === 'network' ? '暂时无法连接宿主，请稍后重试。' : '操作未完成，请重试。';
        }
    }
    async function requestJson(url, { method = 'GET', body, protectedWrite = false, timeoutMs = 15000, signal } = {}) {
        const headers = {};
        if (body !== undefined)
            headers['content-type'] = 'application/json';
        if (protectedWrite) {
            if (!core.state.csrfToken)
                throw { code: 'UNAUTHORIZED' };
            headers['X-WeftMate-CSRF'] = core.state.csrfToken;
        }
        let response;
        try {
            response = await environment.fetch(url, {
                method, headers, credentials: 'same-origin', cache: 'no-store',
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            });
        }
        catch {
            if (signal?.aborted) throw { code: 'ABORTED' };
            throw { code: 'NETWORK' };
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
            throw { code: payload?.error?.code || 'REQUEST_FAILED', status: response.status };
        return payload;
    }
    async function accessApi(path, options) {
        const identityAtStart = core.state.csrfToken;
        try {
            const value = await core.requestJson(`${core.accessBase}${path}`, options);
            const reachable = !environment.nativeMobile || path === '/status' || value.hostAvailable === true || value.connectionVerified === true;
            if (reachable && core.state.csrfToken === identityAtStart && identityAtStart && value.hostAvailable !== false && value.cached !== true && value.connectionVerified !== false)
                core.setOnline(true);
            return value;
        }
        catch (error) {
            if (core.state.csrfToken === identityAtStart)
                core.connectionFailed?.(error);
            if (error.code === 'UNAUTHORIZED' && core.state.csrfToken === identityAtStart)
                core.sessionExpired();
            throw error;
        }
    }
    function acceptSession(payload) {
        if (typeof payload?.account?.username !== 'string' || typeof payload?.device?.id !== 'string'
            || typeof payload?.csrfToken !== 'string' || !payload.csrfToken)
            throw { code: 'REQUEST_FAILED' };
        core.state.identityGeneration++;
        core.state.allModels = []; core.state.modelChecks = {}; core.state.modelSettings = null;
        core.state.modelCheckGeneration = (core.state.modelCheckGeneration || 0) + 1;
        core.resetConversationApprovals();
        core.resetConversationQuestions();
        core.resetMemoryIdentity();
        core.state.avatarGeneration++;
        core.state.avatarSelectionGeneration++;
        core.state.deviceFetchGeneration++;
        core.state.profileFetchGeneration++;
        core.state.profileOperationGeneration++;
        core.state.profileSaving = false;
        core.state.avatarChecking = false;
        effects.releaseAvatarUrl();
        core.state.profileDraftAvatar = undefined;
        core.state.profileDraftGeneration++;
        core.state.profileConflict = false;
        core.state.deviceEditing = null;
        core.state.account = payload.account;
        core.state.device = payload.device;
        core.state.csrfToken = payload.csrfToken;
        void core.refreshPendingDevices();
        effects.paintIdentity(payload);
        if (core.state.currentView === 'account')
            effects.resetProfileDraft();
    }
    function accountToken() {
        return { generation: core.state.identityGeneration, view: core.state.accountViewGeneration,
            ownerId: core.state.account?.ownerId, deviceId: core.state.device?.id, csrf: core.state.csrfToken };
    }
    function accountCurrent(token) {
        return core.state.currentView === 'account' && token.generation === core.state.identityGeneration
            && token.view === core.state.accountViewGeneration && token.ownerId === core.state.account?.ownerId
            && token.deviceId === core.state.device?.id && token.csrf === core.state.csrfToken;
    }
    function setOnline(online) {
        if (core.presence) {
            if (online) core.connectionSucceeded();
            else core.connectionFailed({ code: 'NETWORK' });
            return;
        }
        core.state.online = online;
        effects.paintConnection(online);
        effects.updateAvailability();
    }
    function operation(message, locked = false, requestId = null, reviewable = locked) {
        if (requestId) {
            if (locked) {
                core.state.unresolvedRequests.add(requestId);
                if (reviewable) {
                    core.state.reviewableRequests.add(requestId);
                    core.state.reviewRequestId = requestId;
                }
                else
                    core.state.reviewableRequests.delete(requestId);
            }
            else {
                core.state.unresolvedRequests.delete(requestId);
                core.state.reviewableRequests.delete(requestId);
            }
            if (!core.state.reviewableRequests.has(core.state.reviewRequestId)) {
                core.state.reviewRequestId = [...core.state.reviewableRequests].at(-1) ?? null;
            }
        }
        core.state.unresolvedSubmission = core.state.unresolvedRequests.size > 0;
        const visibleMessage = core.state.unresolvedSubmission && !locked
            ? core.state.reviewableRequests.size ? '仍有请求结果待核对；不会自动重复发送。请查看事情记录后确认。'
                : '仍有请求正在处理；会继续核对原请求。' : message;
        effects.paintOperation(visibleMessage);
        effects.updateAvailability();
    }
    async function refreshStatus() {
        let payload;
        try {
            payload = await core.accessApi('/status');
        }
        catch (error) {
            throw error;
        }
        if (typeof payload.ownerId !== 'string' || typeof payload.hostId !== 'string')
            throw { code: 'REQUEST_FAILED' };
        if (core.state.ownerId !== payload.ownerId) {
            core.state.ownerId = payload.ownerId;
            core.state.unresolvedRequests = new Set(core.readMarkers().filter((marker) => marker.kind !== 'desktop.open_app' || !marker.commandId).map((marker) => marker.requestId));
            core.state.reviewableRequests.clear();
            core.state.reviewRequestId = null;
            core.state.acknowledgedDesktop = new Set(core.readDesktopAcknowledgements());
            core.state.unresolvedSubmission = core.state.unresolvedRequests.size > 0;
            if (core.state.unresolvedSubmission)
                core.operation('正在核对上次请求。');
        }
        core.state.hostId = payload.hostId;
        core.state.hostName = payload.hostName;
        core.state.personalCapabilities = payload.personalCapabilities ?? {};
        core.state.capabilities = payload.backend?.capabilities ?? null;
        core.state.executionAccount = payload.executionAccount;
        core.state.executionAccountName = payload.executionAccountName;
        core.state.syncAvailable = payload.sync?.available === true;
        core.connectionSucceeded?.(payload.presence || { runtime: payload.backend?.runtime === 'unavailable' ? 'unavailable' : 'ready' });
        effects.paintMemoryAvailability?.(payload.memory ?? { state: payload.backend?.modules?.memory });
        if (!core.state.syncAvailable && core.state.phonePane)
            effects.showConversation();
        effects.updateAvailability();
    }
    async function refreshModels() {
        const identity = core.state.identityGeneration;
        const payload = await core.accessApi('/models');
        if (identity !== core.state.identityGeneration) return;
        core.state.modelsKnown=Array.isArray(payload.models);
        core.state.allModels = Array.isArray(payload.models) ? payload.models : [];
        const modelSettings = await core.accessApi('/settings/models').catch(() => ({}));
        if (identity !== core.state.identityGeneration) return;
        core.state.modelSettings = modelSettings;
        core.state.models = Array.isArray(payload.models) ? payload.models.filter((item) => item?.configured === true &&
            typeof item.id === 'string' && typeof item.name === 'string') : [];
        core.state.modelProfileId = core.state.models.some(item => item.id === core.state.modelProfileId) ? core.state.modelProfileId : modelSettings.defaultModelProfileId ?? core.state.models[0]?.id ?? null;
        effects.paintModels();
        effects.renderAccountModels?.();
        effects.updateAvailability();
        if (core.state.currentView === 'account' && core.state.browserAvailable)
            effects.renderBrowserModels();
    }
    function stopAssistantRefresh() {
        core.stopConnection?.();
        if (core.state.refreshTimer)
            clearInterval(core.state.refreshTimer);
        core.state.refreshTimer = null;
        clearInterval(core.state.liveRefreshTimer);
        core.state.liveRefreshTimer = null;
    }
    async function refreshLiveConversation() {
        if (core.state.liveRefreshing || !core.state.csrfToken || !core.state.online) return;
        core.state.liveRefreshing = true;
        try {
            // Receipts and native history control the composer. Model settings,
            // host diagnostics and the complete session list must not delay them.
            await Promise.all([core.refreshHistory(), ...core.readMarkers()
                .filter(marker => ['session.create', 'session.message', 'session.cancel', 'chat.message', 'session.side.create'].includes(marker.kind))
                .map(marker => core.lookupRequest(marker))]);
        } finally { core.state.liveRefreshing = false; }
    }
    async function refreshAssistant(personalizationLoaded = false) {
        if (core.state.refreshing || !core.state.csrfToken || core.state.connection && core.state.connection.kind !== 'online' && (core.state.connection.failures > 0 || core.state.connection.kind !== 'connecting'))
            return;
        core.state.refreshing = true;
        try {
            await core.refreshStatus();
            if (!personalizationLoaded) await core.loadPersonalization().catch(() => {});
            await core.refreshActivity?.();
            await core.refreshModels();
            // The session selector owns its initial history and decisions.
            // On later refreshes this routine owns those reads instead.
            await core.refreshTasks(false, false);
            const history = core.state.historyGeneration;
            await core.refreshSessions();
            const selected = history !== core.state.historyGeneration;
            if (!selected) await core.refreshHistory();
            void core.refreshUsageBudget?.();
            if (core.state.syncAvailable)
                await core.refreshPhoneRecords();
            if (!selected) await core.refreshConversationTasks();
            else await core.conversationTasks.inFlight?.promise;
            await core.restoreRequests();
        }
        catch (error) {
            if (error.code === 'NETWORK') {
                for (const entry of core.conversationTasks.entries.values())
                    entry.notice = '连接中断，执行进展待更新。重连后可重新核对。';
                effects.renderConversationTasks();
            }
            else if (error.code !== 'UNAUTHORIZED')
                effects.toast('部分状态暂时无法读取，稍后会重试。');
        }
        finally {
            core.state.refreshing = false;
        }
    }
    async function enterAssistant() {
        core.show('assistant');
        effects.closeRail();
        await core.loadMessageModePreference();
        await core.refreshAssistant(true);
        effects.startAssistantRefresh();
        await effects.resumeOnboarding?.();
    }
    async function load() {
        core.show('loading');
        try {
            const accountState = await core.api('/state');
            if (await effects.startOnboarding?.(accountState)) return;
            if (core.state.setupGrant) {
                core.clearSession();
                effects.showRegistration();
                return;
            }
            try {
                core.acceptSession(await core.api('/me'));
                await core.enterAssistant();
            }
            catch (error) {
                if (error.code === 'UNAUTHORIZED') {
                    core.clearSession();
                    if (core.state.setupGrant || accountState.configured !== true)
                        effects.showRegistration();
                    else
                        core.show('login');
                }
                else
                    throw error;
            }
        }
        catch (error) {
            core.show('owner');
            effects.setupError('');
            effects.toast(core.failureMessage(error, 'network'));
        }
    }
    function clearSession() {
        core.presence?.reset();
        core.resetMessageBodies?.();
        core.resetActivity?.();
        core.resetLogicalSession?.();
        effects.cancelCloudLogin();
        effects.removeResourcePreview();
        core.cancelAttachmentUpload();
        core.stopAssistantRefresh();
        core.conversationTasks.generation++;
        core.conversationTasks.entries.clear();
        core.conversationTasks.inFlight = null;
        core.resetConversationApprovals();
        core.resetConversationQuestions();
        core.resetMemoryIdentity();
        core.state.identityGeneration++;
        core.state.allModels = []; core.state.modelChecks = {}; core.state.modelSettings = null;
        core.state.modelCheckGeneration = (core.state.modelCheckGeneration || 0) + 1;
        core.state.avatarGeneration++;
        core.state.avatarSelectionGeneration++;
        core.state.deviceFetchGeneration++;
        core.state.profileFetchGeneration++;
        core.state.profileDraftAvatar = undefined;
        core.state.profileDraftGeneration++;
        core.state.profileConflict = false;
        core.state.profileSaving = false;
        core.state.profileOperationGeneration++;
        core.state.avatarChecking = false;
        effects.releaseAvatarUrl();
        core.state.deviceEditing = null;
        core.state.deviceNotice = '';
        core.state.cachedDevices = [];
        effects.resetAccountControls();
        core.state.csrfToken = null;
        core.state.account = null;
        core.state.device = null;
        effects.resetIdentityControls();
        core.state.revokeId = null;
        core.state.ownerId = null;
        core.state.unresolvedRequests.clear();
        core.state.reviewableRequests.clear();
        core.state.reviewRequestId = null;
        core.state.acknowledgedDesktop.clear();
        core.state.syncAvailable = false;
        core.state.phonePane = false;
        core.state.phoneEvents = [];
        core.state.phoneAfterSeq = 0;
        core.state.phoneHasMore = true;
        core.state.phoneLoading = false;
        core.state.selectedPhoneConversationId = null;
        core.state.activeChatSource = 'desktop';
        core.state.phoneSending = false;
        core.state.phoneSendNotice = '';
        core.state.phoneDrafts.clear();
        core.state.phoneBindings.clear();
        core.state.phoneHostEvents.clear();
        core.state.phoneHistoryCursors.clear();
        core.state.phoneHandoffBusy = false;
        core.state.phoneHandoffSelections.clear();
        core.state.accountModels = [];
        core.state.accountModelsCanManage = false;
        core.state.accountModelFetchGeneration++;
        core.state.accountModelEditing = null;
        core.state.accountModelBusy = false;
        effects.showAccountModels(false);
        core.state.desktopDraft = '';
        core.state.attachmentDrafts.clear();
        core.state.attachmentGroups.clear();
        core.state.attachmentAttempts.clear();
        core.state.attachmentStatus = '';
        effects.closePhoneImagePreview();
        core.state.phoneDeviceNames.clear();
        core.state.hostId = null;
        core.state.online = false;
        core.state.submitting = false;
        core.state.cancelSubmitting = false;
        core.state.capabilities = null;
        core.state.executionAccount = undefined;
        core.state.executionAccountName = undefined;
        core.state.sessions = [];
        core.state.sessionGroups = [];
        core.state.models = []; core.state.modelsKnown=false;
        core.state.tasks = [];
        core.state.projects = [];
        core.state.projectCanManage = false;
        core.state.projectPending = null;
        core.state.projectFetchGeneration++;
        core.state.browserHostId = null;
        core.state.browserAvailable = false;
        core.state.browserFetchGeneration++;
        core.state.selectedSessionId = null;
        core.state.newConversation = false;
        core.state.afterSeq = -1;
        core.state.historyGeneration++;
        core.state.historyInFlight = null;
        core.state.historyHasMore = false;
        core.state.turnStatus = null;
        core.state.turnEndReasonKind = null;
        core.state.seenSeq.clear();
        effects.resetConversationControls();
        effects.renderAttachmentDrafts();
        core.operation('');
    }
    function show(view) {
        if (view !== core.state.currentView)
            effects.closeResourcePreview();
        effects.closeAccountMenu();
        effects.closeModelMenu();
        if (view !== 'assistant')
            effects.stopVoiceInput();
        if (view !== 'assistant' && core.state.currentView === 'assistant')
            core.cancelAttachmentUpload();
        if (core.state.currentView === 'memory' && view !== 'memory') {
            core.memory.viewGeneration++;
            core.closeMemoryDetail();
        }
        if (view === 'memory' && core.state.currentView !== 'memory')
            core.memory.viewGeneration++;
        if (core.state.currentView === 'account' && view !== 'account') {
            effects.stopCloudPairing();
            effects.resetOtherDeviceInstall();
            core.state.profileOperationGeneration++;
            core.state.profileSaving = false;
            core.state.avatarSelectionGeneration++;
            core.state.avatarChecking = false;
            effects.releaseAvatarUrl();
        }
        if (core.state.currentView !== view) {
            core.state.currentView = view;
            core.state.accountViewGeneration++;
            core.state.avatarGeneration++;
        }
        effects.paintScreen(view);
    }
    return { failureMessage, requestJson, accessApi, acceptSession, accountToken, accountCurrent, setOnline, operation, refreshStatus, refreshModels, stopAssistantRefresh, refreshLiveConversation, refreshAssistant, enterAssistant, load, clearSession, show };
};
