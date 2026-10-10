/* Shared memory state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.memory = (core, effects, environment) => {
    function memoryHealthText(status) {
        if (!status) return '正在检查记忆健康…';
        const code = status.reasonCode ?? status.lastError ?? status.lastFailureCode;
        const waiting = status.pendingBoundaryCount ?? 0;
        if (status.state === 'disabled') return '记忆暂停：尚未启用';
        if (code === 'MEMORY_MODEL_UNAVAILABLE') return `记忆暂停：记忆模型不可用${waiting ? `，已保存 ${waiting} 条待补交` : ''}`;
        if (code === 'MEMORY_MODEL_WAITING') return `记忆等待：模型切换中${waiting ? `，已保存 ${waiting} 条待补交` : ''}`;
        if (status.blockedBoundaryCount > 0) return `记忆暂停：${status.blockedBoundaryCount} 条来源需要处理`;
        if (status.failedFormationCount > 0) return `记忆暂停：${status.failedFormationCount} 条整理失败，请检查模型服务`;
        if (waiting) return `正在补交 ${waiting} 条${code === 'MEMORY_BUSY' ? '，服务忙，稍后自动重试' : ''}`;
        if (status.pendingFormationCount > 0) return `正在整理 ${status.pendingFormationCount} 条已提交的对话`;
        if (status.state === 'unavailable' || status.captureError) return '记忆暂停：服务暂不可用，恢复后自动补交';
        return status.state === 'ready' ? '记忆正常' : '记忆暂停：请检查模型与宿主连接';
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
        return core.memoryIdentityCurrent(token) && core.state.currentView === 'memory' && token.view === core.memory.viewGeneration;
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
            return '当前账户记忆超过搜索上限，未返回局部结果。请稍后再试。';
        if (error?.code === 'MEMORY_REVISION_CHANGED')
            return '记忆已变更，旧页已清除。保留了搜索条件，请重新查询。';
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
            labels.push('已停用，不参与召回');
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
            if (!['ready', 'degraded', 'disabled', 'unavailable'].includes(payload?.state) || !payload?.capabilities)
                throw { code: 'REQUEST_FAILED' };
            core.memory.status = payload;
            if (!['ready', 'degraded'].includes(payload.state) || payload.capabilities.list !== true) {
                core.invalidateMemorySnapshot(payload.state === 'disabled' ? '记忆尚未接入当前宿主。'
                    : ['ready', 'degraded'].includes(payload.state) ? '当前账户没有记忆列表权限。' : '记忆服务暂时不可用，请稍后刷新。', payload.state !== 'disabled');
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
        if (!selected || selected.stale || !['ready', 'degraded'].includes(core.memory.status?.state)
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
        if (receipt.state === 'no_change')
            return '宿主确认没有发生变更。';
        if (operation === 'correct')
            return '纠正已应用，当前记忆已更新。';
        if (operation === 'mute')
            return '记忆已停用，不再参与后续召回；原内容和来源仍可查看。';
        if (receipt.storageCleanup?.state === 'pending')
            return '已从当前有效记忆与召回移除，底层清理待完成。可稍后查询回执。';
        if (receipt.storageCleanup?.state === 'complete')
            return '已从当前有效记忆与召回移除，当前存储清理已完成。原聊天、会话存档、过去备份和文件系统快照仍保留。';
        return '已从当前有效记忆与召回移除，底层清理状态待确认；原聊天、会话存档、过去备份和文件系统快照仍保留。';
    }
    function applyMemoryReceipt(receipt, marker, key, token) {
        if (!receipt || !['applied', 'no_change', 'revision_conflict', 'rejected'].includes(receipt.state)
            || receipt.requestId !== marker.requestId)
            return false;
        const needsCleanupCheck = marker.operation === 'delete' && receipt.state === 'applied'
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
            core.showMemoryReceipt('记忆版本已变化，本次未应用；纠正草稿仍保留。请重新查询后明确提交。', marker.requestId);
            return true;
        }
        const code = receipt.reasonCode;
        const message = code === 'MEMORY_DELETE_CONFLICT'
            ? '来源仍被其他记忆使用，本次未删除。可查看来源或选择停用。'
            : code === 'MEMORY_SOURCE_UNRECOVERABLE'
                ? '旧来源身份已不可恢复，本次未删除；需要单独处理旧资料。'
                : '宿主拒绝了本次操作，记忆未确认更改。请核对状态后重试。';
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
        core.showMemoryReceipt(marker.cleanupOnly ? '逻辑删除已确认，正在核对底层清理回执…'
            : '上次操作的结果待确认，正在查询持久回执…', marker.requestId, marker.cleanupOnly && marker.cleanupState === 'pending' && marker.retryUnknown !== true ? 'retry-cleanup' : 'check');
        try {
            const result = await core.memoryRequest(`/commands/by-request/${encodeURIComponent(marker.requestId)}`);
            if (!core.memoryIdentityCurrent(token))
                return;
            if (!core.applyMemoryReceipt(result?.receipt, marker, key, token) && core.memoryViewCurrent(token)) {
                core.showMemoryReceipt(marker.cleanupOnly ? '逻辑删除已确认，但底层清理回执仍无法确认。'
                    : '仍无法确认上次操作的结果。不会自动重发，请稍后查询。', marker.requestId, marker.cleanupOnly && marker.cleanupState === 'pending' && marker.retryUnknown !== true ? 'retry-cleanup' : 'check');
            }
        }
        catch (error) {
            if (!core.memoryViewCurrent(token))
                return;
            if (error.code === 'UNAUTHORIZED' || error.status === 401)
                return core.sessionExpired();
            core.showMemoryReceipt(marker.cleanupOnly ? '逻辑删除已确认，底层清理状态暂无法查询。'
                : '上次操作的结果待确认。不会自动重发；请稍后查询回执。', marker.requestId, marker.cleanupOnly && marker.cleanupState === 'pending' && marker.retryUnknown !== true ? 'retry-cleanup' : 'check');
        }
        finally {
            if (core.memoryViewCurrent(token))
                effects.renderMemoryMode();
        }
    }
    function resetMemoryIdentity() {
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
        if (!core.memoryViewCurrent(token) || !['ready', 'degraded'].includes(core.memory.status?.state) || core.memory.status.capabilities.list !== true)
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
                : query ? '当前类型没有匹配的已形成记忆。'
                    : core.memory.status?.pendingBoundaryCount > 0
                        ? '尚无已形成记忆；有待处理来源。'
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
            return effects.detailError('当前账户有一条待核对操作。请刷新查询原回执后再提交新操作。');
        }
        if (!core.persistMemoryMarker(marker, key))
            return effects.detailError('暂时无法保存回执查询标识；为避免结果不明，本次没有提交。');
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
                core.showMemoryReceipt('回执内容无法确认，原请求仍待核对；不会自动重发。', marker.requestId, 'check');
                effects.detailStatus('本次执行结果待确认。');
                effects.detailError('请点“核对处理结果”查询原请求，不会自动重发。');
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
                        effects.memoryStatus('这条记忆已不在当前账户的有效库中，旧列表已清除；请刷新查询。', true);
                        core.showMemoryReceipt('记忆已不存在，本次未提交。请刷新列表后重新核对。', marker.requestId);
                        return;
                    }
                    const message = error.code === 'INVALID_REQUEST' ? '请求内容未通过检查，本次未提交。请核对更正说明后重新提交。'
                        : error.code === 'MEMORY_DELETE_UNAVAILABLE' ? '删除能力暂不可用，本次未提交。'
                            : '当前账户或记忆能力不允许这项操作，本次未提交。请刷新状态后核对。';
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
                        ? '原请求标识与已保存内容冲突，本次未提交。请重新核对后再决定。'
                        : '旧请求正文已不可重放，本次未提交。请重新核对后再决定。';
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
                    core.showMemoryReceipt('结果待确认，原请求已保留；不会自动重发。', marker.requestId, 'check');
                    effects.detailStatus('本次执行结果待确认。');
                    effects.detailError('请点“核对处理结果”查询原请求，不会自动重发。');
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
        core.showMemoryReceipt('正在请求底层清理并等待结果…', marker.requestId, 'retry-cleanup');
        effects.setMemoryCleanupBusy(true);
        try {
            const result = await core.requestMemoryCleanup(marker.requestId);
            if (!core.memoryIdentityCurrent(token))
                return;
            if (!(result?.receipt?.state === 'applied' && core.applyMemoryReceipt(result.receipt, marker, core.memoryMarkerKey(token.ownerId, marker.hostId), token))
                && core.memoryViewCurrent(token)) {
                const uncertain = { ...marker, retryUnknown: true };
                core.setCleanupMarker(uncertain, cleanupKey);
                core.memory.cleanupMarker = uncertain;
                core.showMemoryReceipt('本次清理结果暂无法确认。请先核对原回执；不会自动再次重试。', marker.requestId, 'check');
            }
        }
        catch (error) {
            if (!core.memoryIdentityCurrent(token))
                return;
            if (error?.payload?.receipt?.state === 'applied'
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
                    ? '当前账户无权重试底层清理，本次未执行；请核对权限后再决定。'
                    : '本次清理结果待确认。请先核对原回执；不会自动再次重试。';
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
        core.memory.selectedGeneration++;
        core.memory.selected = null;
        core.memory.sources = [];
        core.memory.mode = 'detail';
        effects.clearMemoryDetailView();
    }
    async function openMemory() {
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
        const filters = effects.memoryFilterInput();
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
                core.invalidateMemorySnapshot('暂时无法确认宿主身份，管理操作不可用。请重试。');
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
    function showMemoryReceipt(message, requestId, action = 'none') {
        core.memory.receiptNotice = { message, requestId, action };
        effects.paintMemoryReceipt(message, requestId, action);
    }
    return { memoryHealthText, memoryIdentity, memoryIdentityCurrent, memoryViewCurrent, memoryRequest, memoryFailure, memoryLifecycle, refreshMemoryStatus, memoryActionAllowed, memoryMarkerKey, persistMemoryMarker, clearMemoryMarker, storedMemoryMarker, memoryCleanupKey, storedCleanupMarkers, setCleanupMarker, clearCleanupMarker, memoryReceiptMessage, applyMemoryReceipt, recoverMemoryReceipt, resetMemoryIdentity, invalidateMemorySnapshot, loadMemoryPage, openMemoryDetail, staleMemoryProjection, submitMemoryAction, retryMemoryCleanup, closeMemoryDetail, openMemory, setMemoryFilters, setMemoryMode, setMemoryCorrectionText, showMemoryReceipt };
};
