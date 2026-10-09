/* Shared attachments state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.attachments = (core, effects, environment) => {
    function attachmentDraftKey(sessionId = core.state.selectedSessionId) {
        return core.state.ownerId && (sessionId || core.state.newConversation) ? `${core.state.ownerId}|${sessionId || 'new'}` : null;
    }
    function currentAttachmentDrafts() {
        const key = core.attachmentDraftKey();
        return key ? core.state.attachmentDrafts.get(key) ?? [] : [];
    }
    function attachmentScope(sessionId = core.state.selectedSessionId) {
        return { generation: core.state.identityGeneration, ownerId: core.state.ownerId, deviceId: core.state.device?.id,
            csrf: core.state.csrfToken, sessionId, view: core.state.currentView };
    }
    function attachmentScopeCurrent(scope) {
        return scope.generation === core.state.identityGeneration && scope.ownerId === core.state.ownerId &&
            scope.deviceId === core.state.device?.id && scope.csrf === core.state.csrfToken && !!scope.csrf &&
            scope.sessionId === core.state.selectedSessionId && core.state.activeChatSource === 'desktop' &&
            scope.view === 'assistant' && core.state.currentView === 'assistant';
    }
    function attachmentMime(file) {
        const supplied = String(file?.type || '').trim().toLowerCase();
        if (core.attachmentTypePattern.test(supplied))
            return supplied;
        const extension = String(file?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
        return ({ txt: 'text/plain', text: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
            csv: 'text/csv', json: 'application/json', ndjson: 'application/x-ndjson', jsonl: 'application/x-ndjson',
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
            pdf: 'application/pdf' })[extension] || 'application/octet-stream';
    }
    function validAttachmentName(value) {
        return typeof value === 'string' && value === value.trim() && value.length > 0 &&
            Array.from(value).length <= 128 && !/[\\/\x00-\x1f\x7f]/.test(value) && !['.', '..'].includes(value);
    }
    function attachmentHint(item) {
        if (core.attachmentTextTypes.has(item.contentType))
            return '原件可下载 · 最多 16 KB 内容供模型读取';
        if (core.attachmentImageTypes.has(item.contentType) && item.file.size <= core.sharedImageBytes)
            return '原图可下载 · 图片会发送给模型';
        if (core.attachmentImageTypes.has(item.contentType))
            return '原图可下载 · 超过模型图片大小限制';
        if (item.contentType === 'application/pdf')
            return '原件可下载 · 当前不读取 PDF 内容';
        return '原件可下载 · 当前类型不读取内容';
    }
    function invalidateAttachmentAttempt(key = core.attachmentDraftKey()) {
        if (key)
            core.state.attachmentAttempts.delete(key);
    }
    function removeAttachmentDraft(attachmentId) {
        if (core.state.attachmentUpload)
            return;
        const key = core.attachmentDraftKey();
        if (!key)
            return;
        const remaining = core.currentAttachmentDrafts().filter((item) => item.attachmentId !== attachmentId);
        if (remaining.length)
            core.state.attachmentDrafts.set(key, remaining);
        else {
            core.state.attachmentDrafts.delete(key);
            core.state.attachmentGroups.delete(key);
        }
        core.invalidateAttachmentAttempt(key);
        core.state.attachmentStatus = '';
        effects.renderAttachmentDrafts();
        effects.updateAvailability();
    }
    function cancelAttachmentUpload(announce = false) {
        const upload = core.state.attachmentUpload;
        if (!upload)
            return;
        upload.controller.abort();
        core.state.attachmentUpload = null;
        if (announce && core.attachmentScopeCurrent(upload.scope))
            core.setAttachmentStatus('已取消上传，所选文件仍保留，可重新发送。');
        effects.renderAttachmentDrafts();
        effects.updateAvailability();
    }
    async function attachmentHasher() {
        if (!core.state.attachmentHasher)
            core.state.attachmentHasher = effects.loadAttachmentHasher().then((module) => {
                if (typeof module.hashBlobSha256 !== 'function')
                    throw new Error('FILE_HASH_UNAVAILABLE');
                return module.hashBlobSha256;
            });
        return core.state.attachmentHasher;
    }
    async function uploadAttachmentBlob(path, blob, contentType, sha256, scope, signal) {
        if (!core.attachmentScopeCurrent(scope))
            throw new DOMException('Upload cancelled', 'AbortError');
        let response;
        try {
            response = await environment.fetch(`${core.accessBase}${path}`, { method: 'PUT', credentials: 'same-origin', cache: 'no-store', signal,
                headers: { 'content-type': contentType, 'x-weftmate-sha256': sha256, 'X-WeftMate-CSRF': scope.csrf }, body: blob });
        }
        catch (error) {
            if (signal.aborted || error?.name === 'AbortError')
                throw new DOMException('Upload cancelled', 'AbortError');
            throw { code: 'NETWORK' };
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = { code: payload?.error?.code || 'REQUEST_FAILED', status: response.status };
            if (error.code === 'UNAUTHORIZED' && core.attachmentScopeCurrent(scope))
                core.sessionExpired();
            throw error;
        }
        if (!core.attachmentScopeCurrent(scope))
            throw new DOMException('Upload cancelled', 'AbortError');
        core.setOnline(true);
        return payload?.attachment;
    }
    function exactAttachmentMeta(value, expected) {
        return value && value.attachmentId === expected.attachmentId && value.name === expected.file.name &&
            value.contentType === expected.contentType && value.size === expected.size && value.sha256 === expected.sha256
            ? { attachmentId: value.attachmentId, name: value.name, contentType: value.contentType,
                size: value.size, sha256: value.sha256 } : null;
    }
    async function textStageBlob(file, maximum, signal) {
        const limit = Math.min(file.size, maximum);
        if (limit < 1)
            return null;
        const probe = new Uint8Array(await file.slice(0, Math.min(file.size, limit + 3)).arrayBuffer());
        if (signal.aborted)
            throw new DOMException('Upload cancelled', 'AbortError');
        for (let end = Math.min(limit, probe.length); end >= Math.max(0, Math.min(limit, probe.length) - 3); end--) {
            try {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(probe.subarray(0, end));
                if (!text || text.includes('\u0000'))
                    return null;
                return new Blob([probe.subarray(0, end)], { type: core.attachmentMime(file) });
            }
            catch { /* Try the previous UTF-8 boundary. */ }
        }
        return null;
    }
    function attachmentAttempt(key, text, drafts) {
        const signature = JSON.stringify([text, ...drafts.map((item) => [item.attachmentId, item.file.name,
                item.file.size, item.file.lastModified, item.contentType])]);
        const old = core.state.attachmentAttempts.get(key);
        if (old?.signature === signature)
            return old;
        const attempt = { signature, requestId: `attachment-send-${environment.crypto.randomUUID()}`, text };
        core.state.attachmentAttempts.set(key, attempt);
        return attempt;
    }
    async function sendDesktopMessageWithAttachments(text, requestId) {
        const sessionId = core.state.selectedSessionId;
        const key = core.attachmentDraftKey(sessionId);
        const drafts = key ? [...core.currentAttachmentDrafts()] : [];
        if (!key || drafts.length < 1 || drafts.length > 4 || core.state.attachmentUpload)
            return null;
        const scope = core.attachmentScope(sessionId);
        const controller = new AbortController();
        const attempt = core.attachmentAttempt(key, text, drafts);
        if (requestId) attempt.requestId = requestId;
        const messageId = core.state.attachmentGroups.get(key) || `message-${environment.crypto.randomUUID()}`;
        core.state.attachmentGroups.set(key, messageId);
        const upload = { controller, scope, key, requestId: attempt.requestId };
        core.state.attachmentUpload = upload;
        core.setAttachmentStatus('正在核对文件并保存原件…');
        effects.renderAttachmentDrafts();
        effects.updateAvailability();
        try {
            const hashBlob = await core.attachmentHasher();
            const originals = [];
            let completedBytes = 0;
            const totalBytes = drafts.reduce((sum, item) => sum + item.file.size, 0);
            for (const item of drafts) {
                if (!core.attachmentScopeCurrent(scope) || controller.signal.aborted)
                    throw new DOMException('Upload cancelled', 'AbortError');
                item.sha256 ||= await hashBlob(item.file, { signal: controller.signal, onProgress: (done) => {
                        if (core.attachmentScopeCurrent(scope))
                            core.setAttachmentStatus(`正在核对文件 ${core.originalFileSize(completedBytes + done)} / ${core.originalFileSize(totalBytes)}`);
                    } });
                const expected = { ...item, size: item.file.size };
                core.setAttachmentStatus(`正在保存原件 ${originals.length + 1} / ${drafts.length}…`);
                const uploaded = await core.uploadAttachmentBlob(`/sync/attachments/${encodeURIComponent(item.attachmentId)}` +
                    `?conversationId=${encodeURIComponent(sessionId)}&messageId=${encodeURIComponent(messageId)}` +
                    `&name=${encodeURIComponent(item.file.name)}`, item.file, item.contentType, item.sha256, scope, controller.signal);
                const exact = core.exactAttachmentMeta(uploaded, expected);
                if (!exact)
                    throw { code: 'REQUEST_FAILED' };
                originals.push(exact);
                completedBytes += item.file.size;
            }
            const staged = [];
            let stagedBytes = 0;
            let stagedTextBytes = 0;
            for (const item of drafts) {
                let blob = null;
                if (core.attachmentImageTypes.has(item.contentType) && item.file.size <= core.sharedImageBytes &&
                    stagedBytes + item.file.size <= core.sharedMessageBytes)
                    blob = item.file;
                else if (core.attachmentTextTypes.has(item.contentType) && stagedTextBytes < core.sharedTextBytes) {
                    blob = await core.textStageBlob(item.file, core.sharedTextBytes - stagedTextBytes, controller.signal);
                }
                if (!blob || staged.length >= 4 || stagedBytes + blob.size > core.sharedMessageBytes)
                    continue;
                const stagedHash = blob === item.file ? item.sha256 : await hashBlob(blob, { signal: controller.signal });
                const expected = { ...item, size: blob.size, sha256: stagedHash };
                core.setAttachmentStatus(`正在准备模型可读内容 ${staged.length + 1} / ${drafts.length}…`);
                const uploaded = await core.uploadAttachmentBlob(`/sessions/${encodeURIComponent(sessionId)}/attachments/` +
                    `${encodeURIComponent(item.attachmentId)}?requestId=${encodeURIComponent(attempt.requestId)}` +
                    `&name=${encodeURIComponent(item.file.name)}`, blob, item.contentType, stagedHash, scope, controller.signal);
                const exact = core.exactAttachmentMeta(uploaded, expected);
                if (!exact)
                    throw { code: 'REQUEST_FAILED' };
                staged.push(exact);
                stagedBytes += blob.size;
                if (core.attachmentTextTypes.has(item.contentType))
                    stagedTextBytes += blob.size;
            }
            if (!core.attachmentScopeCurrent(scope))
                throw new DOMException('Upload cancelled', 'AbortError');
            core.state.attachmentUpload = null;
            core.setAttachmentStatus('原件已保存，正在发送消息…');
            effects.updateAvailability();
            return await core.submitCommand('session.message', { sessionId, text, mode: core.composerInputMode(sessionId),
                ...(staged.length ? { attachments: staged } : {}), attachmentMessageId: messageId,
                originalAttachments: originals }, sessionId, attempt.requestId);
        }
        catch (error) {
            if (core.attachmentScopeCurrent(scope)) {
                if (error?.name === 'AbortError')
                    core.setAttachmentStatus('已取消上传，所选文件仍保留，可重新发送。');
                else
                    core.setAttachmentStatus(error?.code === 'BODY_TOO_LARGE' ? '文件超过可保存大小，请移除后重试。'
                        : error?.code === 'CAPACITY_LIMIT' ? '附件存储空间不足，所选文件仍保留。'
                            : error?.code === 'INVALID_REQUEST' ? '文件内容或名称未通过检查，请移除后重新选择。'
                                : '文件发送未完成，所选文件仍保留，可重试。');
            }
            return null;
        }
        finally {
            if (core.state.attachmentUpload === upload)
                core.state.attachmentUpload = null;
            if (core.attachmentScopeCurrent(scope)) {
                effects.renderAttachmentDrafts();
                effects.updateAvailability();
            }
        }
    }
    function phoneOutboxKey() {
        return core.state.ownerId && core.state.device?.id
            ? `weftmate:phone-sync-outbox:v1:${core.state.ownerId}:${core.state.device.id}` : null;
    }
    function phoneSequenceKey() {
        return core.state.ownerId && core.state.device?.id
            ? `weftmate:phone-sync-seq:v1:${core.state.ownerId}:${core.state.device.id}` : null;
    }
    function phoneRecoveryKey() { return core.state.ownerId ? `weftmate:phone-sync-recovery:v1:${core.state.ownerId}` : null; }
    function readPhoneRecovery() {
        try {
            const row = JSON.parse(environment.storage.getItem(core.phoneRecoveryKey()) || 'null');
            return row?.ownerId === core.state.ownerId && core.sessionIdPattern.test(row.deviceId) &&
                core.syncIdPattern.test(row.event?.eventId) && core.syncIdPattern.test(row.event?.conversationId) &&
                typeof row.event?.payload?.text === 'string' ? row : null;
        }
        catch {
            return null;
        }
    }
    function readPhoneOutbox() {
        const key = core.phoneOutboxKey();
        if (!key)
            return null;
        try {
            const row = JSON.parse(environment.storage.getItem(key) || 'null');
            const event = row?.event;
            return row?.ownerId === core.state.ownerId && row?.deviceId === core.state.device.id &&
                core.syncIdPattern.test(event?.eventId) && core.syncIdPattern.test(event?.conversationId) &&
                core.syncIdPattern.test(event?.payload?.messageId) && event.kind === 'message.created' &&
                event.payload.role === 'user' && typeof event.payload.text === 'string' &&
                event.payload.text.trim() && Number.isSafeInteger(event.clientSeq) && event.clientSeq > 0
                ? row : null;
        }
        catch {
            return null;
        }
    }
    function writePhoneOutbox(row) {
        const key = core.phoneOutboxKey();
        if (!key)
            return false;
        try {
            environment.storage.setItem(key, JSON.stringify(row));
            environment.storage.setItem(core.phoneRecoveryKey(), JSON.stringify(row));
            return true;
        }
        catch {
            try {
                environment.storage.removeItem(key);
            }
            catch { /* Retain any already durable record. */ }
            return false;
        }
    }
    function clearPhoneOutbox() {
        const key = core.phoneOutboxKey();
        if (!key)
            return;
        try {
            environment.storage.removeItem(key);
        }
        catch { /* A later reconciliation can still clear the receipt. */ }
        if (core.readPhoneRecovery()?.deviceId === core.state.device?.id) {
            try {
                environment.storage.removeItem(core.phoneRecoveryKey());
            }
            catch { /* no further send while outbox remains */ }
        }
    }
    function nextPhoneClientSeq() {
        let saved = 0;
        try {
            saved = Number(environment.storage.getItem(core.phoneSequenceKey()) || '0');
        }
        catch { /* use server events */ }
        const server = core.state.phoneEvents.filter((event) => event.sourceDeviceId === core.state.device?.id)
            .reduce((maximum, event) => Math.max(maximum, Number.isSafeInteger(event.clientSeq) ? event.clientSeq : 0), 0);
        const next = Math.max(Number.isSafeInteger(saved) && saved > 0 ? saved : 0, server, Number.isSafeInteger(Date.now()) ? Date.now() - 1 : 0) + 1;
        return Number.isSafeInteger(next) ? next : null;
    }
    function rememberPhoneClientSeq(value) {
        try {
            environment.storage.setItem(core.phoneSequenceKey(), String(value));
        }
        catch { /* receipt remains in the outbox */ }
    }
    function markerKey() { return core.state.ownerId ? `weftmate:requests:v1:${core.state.ownerId}` : null; }
    function sessionKey() { return core.state.ownerId ? `weftmate:last-session:v1:${core.state.ownerId}` : null; }
    function desktopAckKey() { return core.state.ownerId ? `weftmate:desktop-ack:v1:${core.state.ownerId}` : null; }
    function readDesktopAcknowledgements() {
        try {
            const value = JSON.parse(environment.storage.getItem(core.desktopAckKey()) || '[]');
            return Array.isArray(value) ? value.filter((id) => typeof id === 'string' && core.sessionIdPattern.test(id)).slice(-5000) : [];
        }
        catch {
            return [];
        }
    }
    function acknowledgeDesktop(command) {
        if (command.kind !== 'desktop.open_app' || !['accepted_by_host', 'uncertain'].includes(command.state))
            return;
        core.state.acknowledgedDesktop.add(command.commandId);
        try {
            environment.storage.setItem(core.desktopAckKey(), JSON.stringify([...core.state.acknowledgedDesktop].slice(-5000)));
        }
        catch { /* In private browsing the current page still records the acknowledgement. */ }
        core.forgetMarker(command.requestId);
        core.operation('已记录你的核对，可重新发起记事本动作。', false, command.requestId);
        effects.renderConversationTasks();
        effects.updateAvailability();
    }
    function readMarkers() {
        const key = core.markerKey();
        if (!key)
            return [];
        try {
            const value = JSON.parse(environment.storage.getItem(key) || '[]');
            return Array.isArray(value) ? value.filter((row) => typeof row?.requestId === 'string' && core.markerId.test(row.requestId) &&
                ['session.create', 'session.message', 'session.cancel', 'desktop.open_app'].includes(row?.kind) &&
                (row.sessionId === undefined || core.sessionIdPattern.test(row.sessionId)) &&
                (row.commandId === undefined || core.sessionIdPattern.test(row.commandId)))
                .slice(-30) : [];
        }
        catch {
            return [];
        }
    }
    function writeMarkers(rows) {
        const key = core.markerKey();
        if (!key)
            return;
        try {
            environment.storage.setItem(key, JSON.stringify(rows.slice(-30)));
        }
        catch { /* Private browsing can refuse storage. */ }
    }
    function rememberMarker(row) {
        const rows = core.readMarkers().filter((item) => item.requestId !== row.requestId);
        rows.push({ requestId: row.requestId, kind: row.kind,
            ...(row.commandId ? { commandId: row.commandId } : {}),
            ...(row.sessionId ? { sessionId: row.sessionId } : {}) });
        core.writeMarkers(rows);
    }
    function forgetMarker(requestId) { core.writeMarkers(core.readMarkers().filter((row) => row.requestId !== requestId)); }
    function desktopBlocker() {
        const active = (command) => command?.kind === 'desktop.open_app' && command.appId === 'notepad' &&
            ['pending', 'dispatching', 'accepted_by_host', 'uncertain'].includes(command.state) &&
            !core.state.acknowledgedDesktop.has(command.commandId);
        const task = core.state.tasks.find(active);
        if (task)
            return task;
        return core.readMarkers().find((marker) => marker.kind === 'desktop.open_app' && marker.commandId &&
            !core.state.acknowledgedDesktop.has(marker.commandId)) ?? null;
    }
    function finishAttachmentCommand(command) {
        if (command?.state !== 'accepted_by_dsh') return;
        if (command?.kind !== 'session.message' || typeof command.requestId !== 'string')
            return;
        for (const [key, attempt] of core.state.attachmentAttempts) {
            if (attempt.requestId !== command.requestId)
                continue;
            core.state.attachmentAttempts.delete(key);
            core.state.attachmentDrafts.delete(key);
            core.state.attachmentGroups.delete(key);
            if (key === core.attachmentDraftKey(command.sessionId)) {
                if (effects.readMessageDraft() === attempt.text)
                    effects.clearMessageDraft();
                core.state.attachmentStatus = '';
                effects.renderAttachmentDrafts();
                effects.updateAvailability();
            }
            break;
        }
    }
    function setAttachmentStatus(message) {
        core.state.attachmentStatus = message;
        effects.paintAttachmentStatus(message);
    }
    return { attachmentDraftKey, currentAttachmentDrafts, attachmentScope, attachmentScopeCurrent, attachmentMime, validAttachmentName, attachmentHint, invalidateAttachmentAttempt, removeAttachmentDraft, cancelAttachmentUpload, attachmentHasher, uploadAttachmentBlob, exactAttachmentMeta, textStageBlob, attachmentAttempt, sendDesktopMessageWithAttachments, phoneOutboxKey, phoneSequenceKey, phoneRecoveryKey, readPhoneRecovery, readPhoneOutbox, writePhoneOutbox, clearPhoneOutbox, nextPhoneClientSeq, rememberPhoneClientSeq, markerKey, sessionKey, desktopAckKey, readDesktopAcknowledgements, acknowledgeDesktop, readMarkers, writeMarkers, rememberMarker, forgetMarker, desktopBlocker, finishAttachmentCommand, setAttachmentStatus };
};
