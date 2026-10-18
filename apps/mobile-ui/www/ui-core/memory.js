/* Shared memory state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.memory = (core, effects, environment) => {
    function memoryHealthText(status) {
        if (!status) return '正在检查记忆健康…';
        if (status.pendingCleanup?.length) return '还有删除未清理完，请重试清理。';
        const code = status.reasonCode ?? status.lastError ?? status.lastFailureCode;
        const waiting = status.pendingBoundaryCount ?? 0;
        if (status.state === 'disabled') return '记忆暂停：尚未启用';
        if (code === 'MEMORY_MODEL_UNAVAILABLE') return `记忆暂停：需要的模型暂时无法使用${waiting ? `，${waiting} 条内容已保存，等待处理` : ''}`;
        if (code === 'MEMORY_MODEL_WAITING') return `记忆等待：模型切换中${waiting ? `，${waiting} 条内容已保存，等待处理` : ''}`;
        if (status.failedCorrectionCount > 0) return `有 ${status.failedCorrectionCount} 条纠正没有生效，请查看原话并重新整理`;
        if (status.formationIssues?.length > 0) return `有 ${status.formationIssues.length} 条内容尚未记住，请查看原话并重新整理`;
        if (status.blockedBoundaryCount > 0) return `记忆暂停：${status.blockedBoundaryCount} 条来源需要处理`;
        if (status.failedFormationCount > 0) return `记忆暂停：${status.failedFormationCount} 条整理失败，请检查模型服务`;
        if (waiting) return `正在处理 ${waiting} 条已保存的内容${code === 'MEMORY_BUSY' ? '，服务忙，稍后自动重试' : ''}`;
        if (code === 'MEMORY_FORMATION_RECOVERING') return '正在继续整理上次没做完的记忆';
        if (status.pendingFormationCount > 0) return `正在整理 ${status.pendingFormationCount} 条已提交的对话`;
        if (status.state === 'unavailable' || status.captureError) return '记忆暂时不可用，恢复后会自动处理已保存的内容';
        return status.state === 'ready' ? '记忆正常' : '记忆暂停：请检查模型服务和电脑连接';
    }
    function memoryIdentity() {
        return { generation: core.state.identityGeneration, ownerId: core.state.account?.ownerId,
            deviceId: core.state.device?.id, csrf: core.state.csrfToken, view: core.memory.viewGeneration };
    }
    function memoryIdentityCurrent(token) {
        return token.generation === core.state.identityGeneration && token.ownerId === core.state.account?.ownerId
            && token.deviceId === core.state.device?.id && token.csrf === core.state.csrfToken && !!token.csrf;
    }
    function memoryViewCurrent(token) {
        return core.memoryIdentityCurrent(token) && (core.state.currentView === 'memory'||core.memory.activityContext===true) && token.view === core.memory.viewGeneration;
    }
    async function memoryRequest(path, { method = 'GET', body } = {}) {
        const identity = core.memoryIdentity();
        const headers = {};
        if (body !== undefined)
            headers['content-type'] = 'application/json';
        if (method !== 'GET') {
            if (!core.state.csrfToken)
                throw { code: 'UNAUTHORIZED', status: 401 };
            headers['X-WeftMate-CSRF'] = core.state.csrfToken;
        }
        let response;
        try {
            response = await environment.fetch(`${core.memoryBase}${path}`, { method, headers, credentials: 'same-origin', cache: 'no-store',
                signal: AbortSignal.timeout(15000), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        }
        catch {
            throw { code: 'NETWORK', status: 0 };
        }
        const payload = await response.json().catch(() => ({}));
        if (!core.memoryIdentityCurrent(identity))
            throw { code: 'STALE_MEMORY_RESPONSE', status: 0 };
        if ((response.ok || Object.hasOwn(payload, 'ownerId')) && payload.ownerId !== identity.ownerId) {
            core.clearSession();
            core.show('login');
            effects.toast('登录账户已在其他页面改变，请重新登录核对账户。');
            throw { code: 'MEMORY_OWNER_MISMATCH', status: 401 };
        }
        if (!response.ok)
            throw { code: payload?.error?.code ?? 'REQUEST_FAILED', status: response.status, payload };
        return payload;
    }
    function memoryFailure(error) {
        if (error?.status === 403 || error?.code === 'FORBIDDEN')
            return '当前账户没有查看这项记忆的权限。';
        if (error?.code === 'MEMORY_SEARCH_LIMIT')
            return '当前账户的记忆太多，暂时无法完整搜索。为避免遗漏，本次没有显示部分结果，请稍后再试。';
        if (error?.code === 'MEMORY_REVISION_CHANGED')
            return '记忆已更新，页面上的旧内容已清除。搜索条件已保留，请重新查询。';
        if (error?.code === 'MEMORY_FORGET_INCOMPLETE')
            return '这次没有执行遗忘：相关来源仍无法完整处理。独立记忆和原聊天保留。';
        if (error?.code === 'NETWORK')
            return '连接中断，记忆状态暂时无法确认。请重试。';
        return '记忆暂时无法读取。请检查连接并重试。';
    }
    function memoryLifecycle(item) {
        const life = item?.lifecycle ?? {};
        const labels = [];
        if (life.invalidAt)
            labels.push('已失效');
        if (life.archivedAt)
            labels.push('已归档');
        if (life.mutedAt)
            labels.push('已停用，回答时不再使用');
        if (labels.length)
            return labels.join(' · ');
        return item?.currentState === 'current' ? '当前有效' : '状态待确认';
    }
    async function refreshMemoryStatus() {
        const token = core.memoryIdentity();
        if (!core.memoryViewCurrent(token))
            return false;
        effects.memoryStatus('正在检查记忆服务…');
        try {
            const payload = await core.memoryRequest('/status');
            if (!core.memoryViewCurrent(token))
                return false;
            if (!['ready', 'recovering', 'degraded', 'disabled', 'unavailable'].includes(payload?.state) || !payload?.capabilities)
                throw { code: 'REQUEST_FAILED' };
            core.memory.status = payload;
            if (!core.memory.cleanupMarker && !core.memory.unresolvedMarker && payload.pendingCleanup?.length) {
                const pending = payload.pendingCleanup[0];
                const marker = { ...pending, operation: 'delete', cleanupOnly: true, cleanupState: 'pending', hostId: core.state.hostId };
                core.setCleanupMarker(marker, core.memoryCleanupKey(token.ownerId, marker.hostId));
                core.memory.cleanupMarker = marker;
                core.showMemoryReceipt('还有删除未清理完，请点“重试清理”继续。', marker.requestId, 'retry-cleanup');
            }
            if (!['ready', 'recovering', 'degraded'].includes(payload.state) || payload.capabilities.list !== true) {
                core.invalidateMemorySnapshot(payload.state === 'disabled' ? '这台电脑尚未开启记忆。'
                    : ['ready', 'recovering', 'degraded'].includes(payload.state) ? '当前账户没有记忆列表权限。' : '记忆服务暂时不可用，请稍后刷新。', payload.state !== 'disabled');
                return false;
            }
            return true;
        }
        catch (error) {
            if (!core.memoryViewCurrent(token))
                return false;
            if (error.code === 'UNAUTHORIZED' || error.status === 401) {
                core.sessionExpired();
                return false;
            }
            core.memory.status = null;
            core.invalidateMemorySnapshot(core.memoryFailure(error));
            return false;
        }
    }
    function memoryActionAllowed(action) {
        const global = core.memory.status?.capabilities;
        const selected = core.memory.selected;
        if (!selected || selected.stale || !['ready', 'recovering', 'degraded'].includes(core.memory.status?.state)
            || core.memory.activeOperation || core.memory.unresolvedMarker)
            return false;
        if (action === 'correct' && selected.kind === 'entity')
            return false;
        const globalKey = action === 'delete' ? 'deleteWorldItem' : action;
        return global?.[globalKey] === true && selected.availableActions?.[action]?.available === true;
    }
    function memoryMarkerKey(ownerId = core.state.account?.ownerId, hostId = core.state.hostId) {
        return typeof ownerId === 'string' && ownerId && typeof hostId === 'string' && hostId
            ? `weftmate:memory-request:v1:${hostId}:${ownerId}` : null;
    }
    function persistMemoryMarker(marker, key) {
        if (!key)
            return false;
        try {
            environment.storage.setItem(key, JSON.stringify(marker));
            return true;
        }
        catch {
            return false;
        }
    }
    function clearMemoryMarker(key) {
        if (!key)
            return;
        try {
            environment.storage.removeItem(key);
        }
        catch { /* Best effort; a later lookup is safe. */ }
    }
    function storedMemoryMarker(key) {
        if (!key)
            return null;
        try {
            const value = JSON.parse(environment.storage.getItem(key) || 'null');
            return value && /^[A-Za-z0-9_.:-]{1,128}$/.test(value.requestId)
                && core.memoryKinds[value.kind] && typeof value.id === 'string' && value.id.length > 0
                && ['correct', 'mute', 'delete'].includes(value.operation) ? value : null;
        }
        catch {
            return null;
        }
    }
    function memoryCleanupKey(ownerId = core.state.account?.ownerId, hostId = core.state.hostId) {
        return typeof ownerId === 'string' && ownerId && typeof hostId === 'string' && hostId
            ? `weftmate:memory-cleanup:v1:${hostId}:${ownerId}` : null;
    }
    function storedCleanupMarkers(key) {
        if (!key)
            return [];
        try {
            const values = JSON.parse(environment.storage.getItem(key) || '[]');
            return Array.isArray(values) ? values.filter((value) => value && value.operation === 'delete'
                && /^[A-Za-z0-9_.:-]{1,128}$/.test(value.requestId) && typeof value.id === 'string'
                && core.memoryKinds[value.kind]).slice(-100) : [];
        }
        catch {
            return [];
        }
    }
    function setCleanupMarker(marker, key) {
        if (!key)
            return;
        try {
            const values = core.storedCleanupMarkers(key).filter((value) => value.requestId !== marker.requestId);
            values.push(marker);
            environment.storage.setItem(key, JSON.stringify(values.slice(-100)));
        }
        catch { /* Current tab can still query the receipt. */ }
    }
    function clearCleanupMarker(requestId, key) {
        if (!key)
            return;
        try {
            environment.storage.setItem(key, JSON.stringify(core.storedCleanupMarkers(key).filter((value) => value.requestId !== requestId)));
        }
        catch { /* Best effort. */ }
    }
    function memoryReceiptMessage(receipt, operation) {
        if (receipt.state === 'no_change' && operation !== 'delete')
            return '这次没有更改记忆。';
        if (operation === 'correct')
            return '纠正已应用，当前记忆已更新。';
        if (operation === 'mute')
            return '记忆已停用，之后的回答不再使用；原内容和来源仍可查看。';
        if (receipt.storageCleanup?.state === 'pending')
            return '记忆已移除，但删除清理还未完成。请点“重试清理”继续。';
        if (receipt.storageCleanup?.state === 'complete')
            return '记忆已移除，本次清理已完成。未勾选删除的聊天原话、过去的备份和系统保存的旧副本仍保留。';
        return '记忆已移除，但是否清理完还需确认。聊天记录和过去的备份仍可能保留，请核对处理结果。';
    }
    function applyMemoryReceipt(receipt, marker, key, token) {
        if (!receipt || !['applied', 'no_change', 'revision_conflict', 'rejected'].includes(receipt.state)
            || receipt.requestId !== marker.requestId)
            return false;
        const needsCleanupCheck = marker.operation === 'delete' && ['applied', 'no_change'].includes(receipt.state)
            && receipt.storageCleanup?.state !== 'complete';
        const cleanupState = receipt.storageCleanup?.state === 'pending' ? 'pending' : 'unknown';
        const cleanupMarker = needsCleanupCheck ? { ...marker, cleanupOnly: true, cleanupState, retryUnknown: false } : null;
        const cleanupKey = core.memoryCleanupKey(token.ownerId, marker.hostId ?? core.state.hostId);
        if (!marker.cleanupOnly && core.storedMemoryMarker(key)?.requestId === marker.requestId)
            core.clearMemoryMarker(key);
        if (cleanupMarker)
            core.setCleanupMarker(cleanupMarker, cleanupKey);
        else
            core.clearCleanupMarker(marker.requestId, cleanupKey);
        if (!core.memoryIdentityCurrent(token))
            return true;
        if (core.memory.unresolvedMarker?.requestId === marker.requestId)
            core.memory.unresolvedMarker = null;
        core.memory.cleanupMarker = cleanupMarker;
        if (receipt.state === 'applied' || receipt.state === 'no_change') {
            if(core.memory.activityContext)void core.readActivity?.();
            core.showMemoryReceipt(core.memoryReceiptMessage(receipt, marker.operation), marker.requestId, cleanupMarker ? cleanupMarker.cleanupState === 'pending' ? 'retry-cleanup' : 'check' : 'none');
            if (marker.operation === 'correct')
                core.memory.drafts.delete(`${marker.kind}|${marker.id}`);
            if (!marker.cleanupOnly)
                core.staleMemoryProjection(marker);
            if (!marker.cleanupOnly && core.memoryViewCurrent(token)) {
                void core.refreshMemoryStatus().then((ready) => {
                    if (ready && core.memoryViewCurrent(token))
                        void core.loadMemoryPage();
                });
            }
            return true;
        }
        if (!core.memoryViewCurrent(token))
            return true;
        if (receipt.state === 'revision_conflict') {
            core.staleMemoryProjection(marker);
            effects.memoryStatus('记忆在操作前发生变化，旧页已清除；请重新查询，未自动重试。', true);
            core.showMemoryReceipt('这条记忆已被修改，本次操作没有生效；纠正草稿仍保留。请刷新后确认是否继续。', marker.requestId);
            return true;
        }
        const code = receipt.reasonCode;
        const message = code === 'MEMORY_DELETE_CONFLICT'
            ? '这条记忆暂时无法删除，本次没有执行；请查看来源，或先停用。'
            : code === 'MEMORY_SOURCE_UNRECOVERABLE'
                ? '无法再确认旧记忆对应的原话，本次没有删除；请查看原来的资料。'
                : '这次操作未被接受，尚未确认记忆是否更改。请核对处理结果后再试。';
        core.showMemoryReceipt(message, marker.requestId);
        if (core.memory.selected && core.memory.selected.kind === marker.kind && core.memory.selected.id === marker.id
            && core.memory.selectedGeneration === marker.selectedGeneration)
            effects.detailError(message);
        return true;
    }
    async function recoverMemoryReceipt() {
        const token = core.memoryIdentity();
        const key = core.memoryMarkerKey();
        const unknown = core.storedMemoryMarker(key) ?? core.memory.unresolvedMarker;
        const cleanup = core.storedCleanupMarkers(core.memoryCleanupKey()).at(0) ?? core.memory.cleanupMarker;
        const marker = unknown ?? cleanup;
        if (!core.memoryViewCurrent(token) || !marker || core.memory.activeOperation)
            return;
        core.memory.unresolvedMarker = unknown ?? null;
        core.memory.cleanupMarker = cleanup ?? null;
        core.showMemoryReceipt(marker.cleanupOnly ? '记忆已移除，正在核对是否已清理完…'
            : '正在核对上次操作的结果…', marker.requestId, marker.cleanupOnly && marker.cleanupState === 'pending' && marker.retryUnknown !== true ? 'retry-cleanup' : 'check');
        try {
            const result = await core.memoryRequest(`/commands/by-request/${encodeURIComponent(marker.requestId)}`);
            if (!core.memoryIdentityCurrent(token))
                return;
            if (!core.applyMemoryReceipt(result?.receipt, marker, key, token) && core.memoryViewCurrent(token)) {
                core.showMemoryReceipt(marker.cleanupOnly ? '记忆已移除，但清理是否完成尚未确认。请稍后核对处理结果。'
                    : '仍无法确认上次操作的结果。不会自动重发，请稍后查询。', marker.requestId, marker.cleanupOnly && marker.cleanupState === 'pending' && marker.retryUnknown !== true ? 'retry-cleanup' : 'check');
            }
        }
        catch (error) {
            if (!core.memoryViewCurrent(token))
                return;
            if (error.code === 'UNAUTHORIZED' || error.status === 401)
                return core.sessionExpired();
            core.showMemoryReceipt(marker.cleanupOnly ? '记忆已移除，但暂时无法查询清理进度。请稍后核对处理结果。'
                : '上次操作是否完成尚未确认。请稍后核对处理结果，不会自动重复执行。', marker.requestId, marker.cleanupOnly && marker.cleanupState === 'pending' && marker.retryUnknown !== true ? 'retry-cleanup' : 'check');
        }
        finally {
            if (core.memoryViewCurrent(token))
                effects.renderMemoryMode();
        }
    }
    function resetMemoryIdentity() {
        core.memory.activityContext=false;core.memory.weekFilter=null;
        core.memory.viewGeneration++;
        core.memory.entryGeneration++;
        core.memory.queryGeneration++;
        core.memory.selectedGeneration++;
        core.memory.operationGeneration++;
        core.memory.status = null;
        core.memory.items = [];
        core.memory.revision = null;
        core.memory.cursor = null;
        core.memory.hasMore = false;
        core.memory.query = '';
        core.memory.kind = 'all'; core.memory.totalCount = null;
        core.memory.selected = null;
        core.memory.sources = [];
        core.memory.mode = 'detail';
        core.memory.drafts.clear();
        core.memory.activeOperation = null;
        core.memory.unresolvedMarker = null;
        core.memory.cleanupMarker = null;
        core.memory.cleanupRetrying = false;
        core.memory.receiptNotice = null;
        effects.resetMemoryControls();
    }
    function invalidateMemorySnapshot(message, error = true) {
        core.closeMemoryDetail();
        core.memory.items = [];
        core.memory.revision = null;
        core.memory.cursor = null;
        core.memory.hasMore = false;
        effects.clearMemoryList();
        effects.memoryStatus(message, error);
    }
    async function loadMemoryPage({ more = false } = {}) {
        const token = core.memoryIdentity();
        if (!core.memoryViewCurrent(token) || !['ready', 'recovering', 'degraded'].includes(core.memory.status?.state) || core.memory.status.capabilities.list !== true)
            return;
        const queryGeneration = more ? core.memory.queryGeneration : ++core.memory.queryGeneration;
        const kind = core.memory.kind;
        const query = core.memory.query;
        const after = more ? core.memory.cursor : null;
        if (more && (!core.memory.hasMore || !after))
            return;
        if (!more) {
            core.memory.items = [];
            core.memory.cursor = null;
            core.memory.hasMore = false;
            effects.clearMemoryList();
        }
        effects.memoryStatus(more ? '正在读取更多记忆…' : '正在读取记忆…');
        effects.setMemoryMoreBusy(true);
        try {
            const params = new URLSearchParams({ kind, limit: '20', includeSources:'true' });
            if(core.memory.weekFilter){params.set('from',core.memory.weekFilter.from);params.set('to',core.memory.weekFilter.to);}
            if (query)
                params.set('query', query);
            if (after)
                params.set('after', after);
            const page = await core.readMemoryPage(params);
            if (!core.memoryViewCurrent(token) || queryGeneration !== core.memory.queryGeneration)
                return;
            if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.worldRevision)
                || page.searchScope !== 'account_snapshot' || typeof page.hasMore !== 'boolean'
                || (page.hasMore && (typeof page.nextCursor !== 'string' || !page.nextCursor))
                || (more && core.memory.revision !== page.worldRevision)
                || page.items.some((item) => !core.memoryKinds[item?.kind] || kind !== 'all' && item.kind !== kind || typeof item.id !== 'string'))
                throw { code: 'MEMORY_REVISION_CHANGED' };
            core.memory.items = more ? [...core.memory.items, ...page.items] : page.items;
            core.memory.revision = page.worldRevision;
            core.memory.cursor = page.nextCursor ?? null;
            core.memory.hasMore = page.hasMore;
            if (kind === 'all') core.memory.totalCount = Number.isSafeInteger(page.totalCount) ? page.totalCount : null;
            effects.renderMemoryItems();
            effects.memoryStatus(core.memory.items.length ? `已读取${kind === 'all' ? '全部类型记忆' : core.memoryKinds[kind]}。${core.memory.hasMore ? '可继续读取更多。' : ''}`
                : query ? '这一类记忆中没有匹配的内容。'
                    : core.memory.status?.pendingBoundaryCount > 0
                        ? '还没有记住内容，有一些资料正在等待处理。'
                        : '当前账户的这一类记忆为空。');
        }
        catch (error) {
            if (!core.memoryViewCurrent(token) || queryGeneration !== core.memory.queryGeneration)
                return;
            if (error.code === 'UNAUTHORIZED' || error.status === 401)
                return core.sessionExpired();
            core.invalidateMemorySnapshot(core.memoryFailure(error));
        }
        finally {
            if (core.memoryViewCurrent(token) && queryGeneration === core.memory.queryGeneration)
                effects.setMemoryMoreBusy(false);
        }
    }
    async function openMemoryDetail(kind, id) {
        const token = core.memoryIdentity();
        if (!core.memoryViewCurrent(token) || !core.memoryKinds[kind] || !core.memoryPathId(id))
            return;
        const selectedGeneration = ++core.memory.selectedGeneration;
        core.memory.selected = null;
        core.memory.sources = [];
        core.memory.mode = 'detail';
        effects.beginMemoryDetail(kind);
        try {
            const result = await core.readMemoryItem(kind, id);
            if (!core.memoryViewCurrent(token) || selectedGeneration !== core.memory.selectedGeneration)
                return;
            if (result?.item?.id !== id || result.item.kind !== kind || !Number.isSafeInteger(result.worldRevision))
                throw { code: 'REQUEST_FAILED' };
            core.memory.selected = { kind, id, item: result.item, worldRevision: result.worldRevision, availableActions: result.availableActions ?? {} };
            effects.paintMemoryDetail(result);
            effects.detailStatus('正在读取来源…');
            effects.renderMemoryMode();
            const sourceResult = await core.readMemorySources(kind, id);
            if (!core.memoryViewCurrent(token) || selectedGeneration !== core.memory.selectedGeneration)
                return;
            if (!Array.isArray(sourceResult?.sources) || sourceResult.worldRevision !== result.worldRevision)
                throw { code: 'MEMORY_REVISION_CHANGED' };
            core.memory.sources = sourceResult.sources;
            effects.renderMemorySources(core.memory.sources);
            effects.detailStatus('详情与来源已读取。');
        }
        catch (error) {
            if (!core.memoryViewCurrent(token) || selectedGeneration !== core.memory.selectedGeneration)
                return;
            if (error.code === 'UNAUTHORIZED' || error.status === 401)
                return core.sessionExpired();
            core.invalidateMemorySnapshot(core.memoryFailure(error));
        }
    }
    function staleMemoryProjection(marker) {
        core.memory.items = [];
        core.memory.revision = null;
        core.memory.cursor = null;
        core.memory.hasMore = false;
        effects.clearMemoryList();
        if (core.memory.selected && core.memory.selected.kind === marker.kind && core.memory.selected.id === marker.id
            && core.memory.selectedGeneration === marker.selectedGeneration)
            core.closeMemoryDetail();
        else if (core.memory.selected) {
            core.memory.selected.stale = true;
            effects.detailStatus('记忆已变更；当前详情请关闭后重新打开，暂不可继续操作。');
            effects.renderMemoryMode();
        }
    }
    async function submitMemoryAction() {
        const selected = core.memory.selected;
        const operation = core.memory.mode;
        const token = core.memoryIdentity();
        if (!core.memoryViewCurrent(token) || !selected || !['correct', 'mute', 'delete'].includes(operation)
            || !core.memoryActionAllowed(operation))
            return;
        if (operation === 'delete' && core.memory.forgetPreview?.worldRevision !== selected.worldRevision)
            return effects.detailError('请先读取遗忘范围，再确认忘掉。');
        const selectedGeneration = core.memory.selectedGeneration;
        let textValue = null;
        if (operation === 'correct') {
            textValue = effects.memoryCommandText();
            if (!textValue || textValue.length > 4000)
                return effects.detailError('纠正内容须为 1–4000 个字符。');
            core.memory.drafts.set(`${selected.kind}|${selected.id}`, textValue);
        }
        const requestId = `memory-${typeof environment.crypto?.randomUUID === 'function' ? environment.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
        const marker = { requestId, kind: selected.kind, id: selected.id, operation, selectedGeneration, hostId: core.state.hostId };
        const key = core.memoryMarkerKey(token.ownerId, core.state.hostId);
        const existing = core.storedMemoryMarker(key);
        if (existing) {
            core.memory.unresolvedMarker = existing;
            return effects.detailError('还有一条操作尚未确认结果。请先核对处理结果，再进行新操作。');
        }
        if (!core.persistMemoryMarker(marker, key))
            return effects.detailError('暂时无法保存这次操作的记录，本次没有提交。请稍后再试。');
        core.memory.activeOperation = marker;
        const operationGeneration = ++core.memory.operationGeneration;
        effects.setMemoryConfirmBusy(true);
        effects.detailError('');
        effects.detailStatus('正在提交并等待处理结果…');
        const path = `/items/${selected.kind}/${core.memoryPathId(selected.id)}/${operation}`;
        const body = { requestId, expectedWorldRevision: selected.worldRevision, ...(operation === 'correct' ? { text: textValue } : {}),
            ...(operation === 'delete' ? { deleteConversationSnippets: core.memory.deleteConversationSnippets === true } : {}) };
        try {
            const result = await core.submitMemoryCommand(selected, operation, body);
            if (!core.memoryIdentityCurrent(token) || operationGeneration !== core.memory.operationGeneration)
                return;
            if (!core.applyMemoryReceipt(result?.receipt, marker, key, token) && core.memoryViewCurrent(token)) {
                core.memory.unresolvedMarker = marker;
                core.showMemoryReceipt('暂时无法确认这次操作是否完成。操作记录已保留，不会自动重复执行。', marker.requestId, 'check');
                effects.detailStatus('本次执行结果待确认。');
                effects.detailError('请点“核对处理结果”查看这次操作是否完成，不会自动重复执行。');
            }
        }
        catch (error) {
            if (!core.memoryIdentityCurrent(token) || operationGeneration !== core.memory.operationGeneration)
                return;
            const receipt = error?.payload?.receipt;
            if (core.applyMemoryReceipt(receipt, marker, key, token))
                return;
            if (core.memoryPreDispatchCodes.has(error.code)) {
                core.clearMemoryMarker(key);
                core.memory.unresolvedMarker = null;
                if (error.code === 'UNAUTHORIZED')
                    return core.sessionExpired();
                if (core.memoryViewCurrent(token)) {
                    if (error.code === 'NOT_FOUND') {
                        core.staleMemoryProjection(marker);
                        effects.memoryStatus('这条记忆当前无法查看，页面上的旧内容已清除；请刷新。', true);
                        core.showMemoryReceipt('这条记忆当前无法查看，本次没有执行。请刷新列表后核对。', marker.requestId);
                        return;
                    }
                    const message = error.code === 'MEMORY_FORGET_INCOMPLETE' ? core.memoryFailure(error)
                        : error.code === 'INVALID_REQUEST' ? '这次操作的信息不完整或不正确，本次没有执行。请检查后再试。'
                        : error.code === 'MEMORY_DELETE_UNAVAILABLE' ? '暂时无法删除记忆，本次没有执行。请稍后再试。'
                            : '当前无法进行这项操作，本次没有执行。请刷新后查看可用操作。';
                    effects.detailStatus('本次未提交。');
                    core.showMemoryReceipt(message, marker.requestId);
                    effects.detailError(message);
                }
            }
            else if (error.code === 'MEMORY_REQUEST_CONFLICT' || error.code === 'MEMORY_REPLAY_REDACTED') {
                core.clearMemoryMarker(key);
                core.memory.unresolvedMarker = null;
                if (core.memoryViewCurrent(token)) {
                    const message = error.code === 'MEMORY_REQUEST_CONFLICT'
                        ? '这次操作与之前保存的内容不一致，本次没有执行。请刷新后重新操作。'
                        : '这次操作的内容已经清除，无法再执行。请重新操作。';
                    effects.detailStatus('本次未提交。');
                    core.showMemoryReceipt(message, marker.requestId);
                    effects.detailError(message);
                    if (core.memory.selected)
                        core.memory.selected.stale = true;
                }
            }
            else {
                core.memory.unresolvedMarker = marker;
                if (core.memoryViewCurrent(token)) {
                    core.showMemoryReceipt('这次操作是否完成还需确认。操作记录已保留，不会自动重复执行。', marker.requestId, 'check');
                    effects.detailStatus('本次执行结果待确认。');
                    effects.detailError('请点“核对处理结果”查看这次操作是否完成，不会自动重复执行。');
                }
            }
        }
        finally {
            if (core.memoryIdentityCurrent(token) && operationGeneration === core.memory.operationGeneration) {
                if (core.memory.activeOperation === marker)
                    core.memory.activeOperation = null;
                if (core.memoryViewCurrent(token) && selectedGeneration === core.memory.selectedGeneration) {
                    effects.setMemoryConfirmBusy(false);
                    effects.renderMemoryMode();
                }
            }
        }
    }
    async function retryMemoryCleanup() {
        const token = core.memoryIdentity();
        if (!core.memoryViewCurrent(token) || core.memory.cleanupRetrying || core.memory.activeOperation)
            return;
        const cleanupKey = core.memoryCleanupKey();
        const displayedId = effects.readMemoryReceiptId();
        const marker = core.storedCleanupMarkers(cleanupKey).find((entry) => entry.requestId === displayedId)
            ?? core.memory.cleanupMarker;
        if (!marker?.cleanupOnly || marker.operation !== 'delete' || marker.cleanupState !== 'pending'
            || marker.retryUnknown === true) {
            void core.recoverMemoryReceipt();
            return;
        }
        core.memory.cleanupRetrying = true;
        effects.setMemoryCleanupBusy(true);
        core.showMemoryReceipt('正在清理，请稍候…', marker.requestId, 'retry-cleanup');
        effects.setMemoryCleanupBusy(true);
        try {
            const result = await core.requestMemoryCleanup(marker.requestId);
            if (!core.memoryIdentityCurrent(token))
                return;
            if (!(['applied', 'no_change'].includes(result?.receipt?.state) && core.applyMemoryReceipt(result.receipt, marker, core.memoryMarkerKey(token.ownerId, marker.hostId), token))
                && core.memoryViewCurrent(token)) {
                const uncertain = { ...marker, retryUnknown: true };
                core.setCleanupMarker(uncertain, cleanupKey);
                core.memory.cleanupMarker = uncertain;
                core.showMemoryReceipt('暂时无法确认这次清理是否完成。请先核对处理结果，不会自动再次清理。', marker.requestId, 'check');
            }
        }
        catch (error) {
            if (!core.memoryIdentityCurrent(token))
                return;
            if (['applied', 'no_change'].includes(error?.payload?.receipt?.state)
                && core.applyMemoryReceipt(error.payload.receipt, marker, core.memoryMarkerKey(token.ownerId, marker.hostId), token))
                return;
            if (error.code === 'UNAUTHORIZED' || error.status === 401)
                return core.sessionExpired();
            if (core.memoryViewCurrent(token)) {
                const refused = error.code === 'FORBIDDEN' || error.status === 403;
                if (!refused) {
                    const uncertain = { ...marker, retryUnknown: true };
                    core.setCleanupMarker(uncertain, cleanupKey);
                    core.memory.cleanupMarker = uncertain;
                }
                const message = refused
                    ? '当前账户没有清理权限，本次未执行。请确认使用的是有权限的账户后再试。'
                    : '这次清理是否完成尚未确认。请先核对处理结果，不会自动再次清理。';
                core.showMemoryReceipt(message, marker.requestId, refused ? 'retry-cleanup' : 'check');
            }
        }
        finally {
            if (core.memoryIdentityCurrent(token)) {
                core.memory.cleanupRetrying = false;
                if (core.memoryViewCurrent(token)) {
                    effects.setMemoryCleanupBusy(false);
                    effects.renderMemoryMode();
                }
            }
        }
    }
    function closeMemoryDetail() {
        core.memory.activityContext=false;
        core.memory.selectedGeneration++;
        core.memory.selected = null;
        core.memory.sources = [];
        core.memory.mode = 'detail';
        effects.clearMemoryDetailView();
    }
    async function openMemory(options={}) {
        core.memory.activityContext=false;
        if(options.from&&options.to)core.memory.weekFilter={from:options.from,to:options.to};
        if (core.state.currentView === 'memory') {
            core.memory.viewGeneration++;
            core.closeMemoryDetail();
        }
        core.memory.queryGeneration++;
        const entryGeneration = ++core.memory.entryGeneration;
        core.stopAssistantRefresh();
        effects.closeRail();
        core.show('memory');
        const token = core.memoryIdentity();
        const filters = options.from?{kind:'all',query:''}:effects.memoryFilterInput();
        core.setMemoryFilters(filters.kind, filters.query);
        core.invalidateMemorySnapshot('正在读取记忆…', false);
        if (!core.state.hostId) {
            try {
                const host = await core.readHostStatus();
                if (!core.memoryViewCurrent(token) || entryGeneration !== core.memory.entryGeneration)
                    return;
                if (host?.ownerId !== token.ownerId || typeof host.hostId !== 'string') {
                    core.clearSession();
                    core.show('login');
                    effects.toast('账户身份已变化，请重新登录核对。');
                    return;
                }
                core.state.hostId = host.hostId;
            }
            catch (error) {
                if (!core.memoryViewCurrent(token))
                    return;
                core.invalidateMemorySnapshot('暂时无法确认连接的电脑，记忆管理暂不可用。请重试。');
                return;
            }
        }
        const initialQueryGeneration = core.memory.queryGeneration;
        const ready = await core.refreshMemoryStatus();
        if (!core.memoryViewCurrent(token) || entryGeneration !== core.memory.entryGeneration)
            return;
        if (ready && initialQueryGeneration === core.memory.queryGeneration)
            await core.loadMemoryPage();
        if (!core.memoryViewCurrent(token) || entryGeneration !== core.memory.entryGeneration)
            return;
        await core.recoverMemoryReceipt();
    }
    function setMemoryFilters(kind, query) {
        core.memory.kind = kind;
        core.memory.query = query;
    }
    async function openDigestMemoryDetail(target,mode){
        core.memory.activityContext=true;core.memory.viewGeneration++;
        if(!await core.refreshMemoryStatus()){core.memory.activityContext=false;return;}
        await core.openMemoryDetail(target.kind,target.id);
        if(mode&&core.memory.selected&&core.memoryActionAllowed(mode)){await core.setMemoryMode(mode);effects.renderMemoryMode();}
    }
    async function setMemoryMode(mode) {
        core.memory.mode = mode;
        core.memory.forgetPreview = null;
        core.memory.deleteConversationSnippets = false;
        if (mode !== 'delete') return;
        const selected = core.memory.selected, generation = core.memory.selectedGeneration, token = core.memoryIdentity();
        core.memory.forgetPreviewError = '';
        effects.renderMemoryMode();
        try {
            const preview = await core.readForgetPreview(selected.kind, selected.id);
            if (!core.memoryViewCurrent(token) || core.memory.selectedGeneration !== generation || core.memory.mode !== 'delete') return;
            if (preview.worldRevision !== selected.worldRevision) throw { code: 'MEMORY_REVISION_CHANGED' };
            core.memory.forgetPreview = preview;
        } catch (error) {
            if (!core.memoryViewCurrent(token) || core.memory.selectedGeneration !== generation || core.memory.mode !== 'delete') return;
            core.memory.forgetPreviewError = '无法读取遗忘范围，请返回详情并重新打开。';
            effects.detailError(core.memoryFailure(error));
        }
        effects.renderMemoryMode();
    }
    function setMemoryCorrectionText(text) {
        if (core.memory.selected)
            core.memory.drafts.set(`${core.memory.selected.kind}|${core.memory.selected.id}`, text);
    }
    function forgetItemSummary(item) {
        const label = { entity: '人物与事物', relationship: '关系', event: '经历', cognition: '理解',
            person: '人物', evaluation: '评价', decision: '决定', preference: '偏好',
            commitment: '交互承诺', recommendation: '交互建议', agreement: '共同约定' }[item.itemType ?? item.kind] ?? core.memoryKinds[item.kind];
        return `${item.text.length > 160 ? item.text.slice(0, 160) + '…' : item.text}（${label}）`;
    }
    core.forgetItemSummary = forgetItemSummary;
    core.openDigestMemoryDetail = openDigestMemoryDetail;
    function showMemoryReceipt(message, requestId, action = 'none') {
        core.memory.receiptNotice = { message, requestId, action };
        effects.paintMemoryReceipt(message, requestId, action);
    }
    return { memoryHealthText, memoryIdentity, memoryIdentityCurrent, memoryViewCurrent, memoryRequest, memoryFailure, memoryLifecycle, refreshMemoryStatus, memoryActionAllowed, memoryMarkerKey, persistMemoryMarker, clearMemoryMarker, storedMemoryMarker, memoryCleanupKey, storedCleanupMarkers, setCleanupMarker, clearCleanupMarker, memoryReceiptMessage, applyMemoryReceipt, recoverMemoryReceipt, resetMemoryIdentity, invalidateMemorySnapshot, loadMemoryPage, openMemoryDetail, staleMemoryProjection, submitMemoryAction, retryMemoryCleanup, closeMemoryDetail, openMemory, setMemoryFilters, setMemoryMode, setMemoryCorrectionText, showMemoryReceipt };
};
