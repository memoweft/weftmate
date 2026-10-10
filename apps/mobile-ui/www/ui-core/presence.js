/* One connection policy for desktop, remote web and the Android UI bundle. */
(() => {
    const labels = { online: '在线', connecting: '正在连接', host_offline: '电脑离线', network_unavailable: '网络不可用', login_required: '需要重新登录', approval_required: '需要批准这台设备' };
    const descriptions = {
        connecting: '正在连接：可以继续写草稿、查看已读取的内容；暂时不能发送或操作电脑。连接后会从原位置接续。',
        host_offline: '电脑离线：可以用云端模型聊天并用上已同步的记忆，不能操作电脑。电脑上线后会自动同步。',
        network_unavailable: '网络不可用：可以继续写草稿、查看已读取的内容；联网后会自动接续，暂时不能发送消息。',
        login_required: '需要重新登录：草稿已保留。登录后才能发送消息和读取最新内容。',
        approval_required: '需要批准这台设备：请在已登录设备的「设置 → 设备」允许访问，批准前不能读取或发送电脑内容。',
    };
    const transportFailure = error => ['NETWORK', 'NETWORK_UNAVAILABLE', 'HOST_OFFLINE', 'HOST_UNAVAILABLE', 'TIMEOUT', 'CONNECTION_FAILED'].includes(error?.code || error?.message);
    const authState = error => ['DEVICE_NOT_TRUSTED', 'PAIRING_REQUIRED', 'PENDING_APPROVAL'].includes(error?.code || error?.message) ? 'approval_required'
        : ['UNAUTHORIZED', 'AUTH_REQUIRED', 'LOGIN_REQUIRED', 'CLOUD_TOKEN_INVALID', 'ACCOUNT_REVOKED'].includes(error?.code || error?.message) || error?.status === 401 ? 'login_required' : null;
    function create({ now = Date.now, random = Math.random, notify = () => {} } = {}) {
        let value = { kind: 'connecting', failures: 0, firstFailureAt: null, lastFailureAt: null, attempt: 0, host: null };
        const view = () => ({ ...value, label: labels[value.kind], description: descriptions[value.kind] || '', canSend: value.kind === 'online' && !['restarting','unavailable'].includes(value.host?.runtime) && value.host?.model !== 'unavailable' });
        function update(fields) { const previous = value.kind; value = { ...value, ...fields }; notify(view(), previous); return view(); }
        return { view,
            reset: () => update({ kind: 'connecting', failures: 0, firstFailureAt: null, lastFailureAt: null, attempt: 0, host: null }),
            success: host => update({ kind: 'online', failures: 0, firstFailureAt: null, lastFailureAt: null, attempt: 0, host: host || value.host }),
            network: online => online === false ? update({ kind: 'network_unavailable' }) : update({ kind: 'connecting', attempt: 0 }),
            authorization: kind => update({ kind, attempt: 0 }),
            failure(error, { independent = false, cloudOffline = false } = {}) {
                if ((error?.code || error?.message) === 'NETWORK_UNAVAILABLE') return update({kind:'network_unavailable'});
                const auth = authState(error); if (auth) return update({ kind: auth });
                if (!transportFailure(error)) return view(); // Model, replica and permission failures are not transport loss.
                const time = now(), count = value.lastFailureAt === null || time - value.lastFailureAt >= 1000 ? value.failures + 1 : value.failures;
                const first = value.firstFailureAt ?? time;
                const confirmed = independent && (cloudOffline || count >= 3 && time - first >= 2000);
                return update({ failures: count, firstFailureAt: first, lastFailureAt: count > value.failures ? time : value.lastFailureAt,
                    kind: value.kind === 'network_unavailable' ? value.kind : confirmed ? 'host_offline' : 'connecting' });
            },
            delay(background = false) {
                const cap = background ? 120000 : 30000, base = background ? 15000 : 1000;
                const delay = Math.min(cap, base * 2 ** Math.min(value.attempt++, 10));
                return Math.round(delay * (0.8 + random() * 0.2)); // Bounded jitter; never exceeds the cap.
            },
        };
    }
    globalThis.WeftUiCore.Presence = { create, labels, descriptions, transportFailure, authState };
    globalThis.WeftUiCore.factories.presence = (core, effects, environment) => {
        const timerApi = environment.clock || globalThis;
        let timer = null, running = null, active = false, generation = 0, background = false, needsRecovery = false, recover = async () => {};
        const listeners = new Set();
        const model = create({ now: environment.now || Date.now, random: environment.random || Math.random, notify(view, previous) {
            if (['login_required','approval_required'].includes(view.kind)) needsRecovery = false;
            else if (['host_offline','network_unavailable'].includes(view.kind) || view.kind === 'connecting' && view.failures > 0) needsRecovery = true;
            core.state.connection = view; core.state.online = view.kind === 'online';
            if (environment.mobileState) environment.mobileState.sharedHostAvailable = core.state.online;
            effects.paintPresence?.(view); effects.paintConnection?.(core.state.online); effects.updateAvailability?.();
            for (const listener of listeners) listener(view);
        } });
        core.state.connection = model.view();
        const clear = () => { if (timer !== null) timerApi.clearTimeout(timer); timer = null; };
        const schedule = delay => { clear(); if (active) timer = timerApi.setTimeout(() => { timer = null; void retryConnection(); }, delay); };
        async function retryConnection() {
            if (running) return running;
            clear(); const ticket = generation, identity = core.state.identityGeneration;
            const current = () => ticket === generation && identity === core.state.identityGeneration;
            running = (async () => {
                if (environment.networkAvailable?.() === false) { model.network(false); return; }
                let status;
                try {
                    // Bypass accessApi: this is an independent probe, not another chat/replica request.
                    status = await core.requestJson(core.accessBase + '/status', { timeoutMs: 5000 });
                    if (!current()) return;
                    const wasDisconnected = needsRecovery;
                    needsRecovery = false;
                    model.success(status.presence || { runtime: status.backend?.runtime === 'unavailable' ? 'unavailable' : 'ready' });
                    if (wasDisconnected) await recover();
                } catch (error) {
                    if (!current()) return;
                    if (authState(error)) { model.authorization(authState(error)); return; }
                    // The relay TLS endpoint may still answer while its host
                    // content listener is down. Only the independent status
                    // probe interprets this transport-level 503 as unreachable.
                    const probeFailure = [502,503,504].includes(error.status) && ['SERVICE_UNAVAILABLE','SERVICE_CLOSING','HOST_UNAVAILABLE','REQUEST_FAILED','HTTP_502','HTTP_503','HTTP_504'].includes(error.code)
                        ? {code:'HOST_UNAVAILABLE',status:error.status} : error;
                    if (!transportFailure(probeFailure)) return;
                    let cloudOffline = false;
                    try {
                        const cloud = await core.probeCloudPresence?.();
                        if (!current()) return;
                        cloudOffline = cloud?.status === 'offline';
                    } catch (cloudError) {
                        if (!current()) return;
                        if (authState(cloudError)) { model.authorization(authState(cloudError)); return; }
                    }
                    model.failure(probeFailure, { independent: true, cloudOffline });
                }
            })().catch(() => {}).finally(() => {
                running = null;
                if (!current() && active) { schedule(0);return; }
                if (current() && active && !['login_required', 'approval_required'].includes(model.view().kind))
                    schedule(model.view().kind === 'online' ? background ? 60000 : 15000 : model.delay(background));
            });
            return running;
        }
        return {
            presence: model,
            connectionView: () => model.view(),
            observeConnection: listener => { listeners.add(listener); return () => listeners.delete(listener); },
            connectionSucceeded: host => { if (!['network_unavailable', 'login_required', 'approval_required'].includes(model.view().kind) || host) model.success(host); },
            connectionFailed: error => { const previous=model.view().kind;model.failure(error);if(active&&!running&&(timer===null||previous==='online'&&model.view().kind!=='online'))schedule(model.delay(background)); },
            connectionReady: () => model.view().canSend,
            retryConnection,
            startConnection: callback => { active = true; recover = callback || recover; if (model.view().kind === 'online' && !needsRecovery) schedule(background ? 60000 : 15000); else void retryConnection(); },
            stopConnection: () => { active = false; needsRecovery = false; generation++; clear(); },
            connectionVisibility: hidden => { background = hidden; if (!hidden) { clear(); void retryConnection(); } else schedule(60000); },
            connectionNetwork: online => { model.network(online); if (online) { clear(); void retryConnection(); } else schedule(60000); },
        };
    };
})();
