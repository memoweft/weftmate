/* Desktop memory component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.memory = (core, ui) => {
    let resetIngestion = () => {};
    function paintMemoryAvailability(status) {
        let node = ui.byId('chat-memory-notice');
        if (!node) {
            node = ui.element('p', 'connection-banner'); node.id = 'chat-memory-notice';
            node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
            ui.byId('connection-banner').after(node);
        }
        node.hidden = status?.state !== 'unavailable';
        node.textContent = node.hidden ? '' : '记忆暂时不可用，普通对话已保存，恢复后会自动补交。';
    }
    async function exportMemories(format) {
        const button = ui.byId(`memory-export-${format}`); button.disabled = true;
        try {
            const identity = core.memoryIdentity();
            if (globalThis.weftmateDesktop?.exportMemories) {
                const result = await globalThis.weftmateDesktop.exportMemories(format, identity.ownerId);
                if (!core.memoryIdentityCurrent(identity)) return;
                if (result.canceled) { ui.toast('已取消导出。'); return; }
            } else {
                const result = await core.memoryRequest(`/export?format=${format}`);
                const url = URL.createObjectURL(new Blob([result.content], { type: `${result.contentType};charset=utf-8` }));
                const link = ui.element('a'); link.href = url; link.download = result.filename;
                document.body.append(link); link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            memoryStatus('我的记忆已导出，包含来源摘要。');
            if (core.state.currentView !== 'memory') ui.toast('我的记忆已导出，包含来源摘要。');
        } catch (error) { memoryStatus(core.memoryFailure(error), true); if (core.state.currentView !== 'memory') ui.toast(core.memoryFailure(error)); }
        finally { button.disabled = false; }
    }
    function memoryStatus(message, error = false) {
        const node = ui.byId('memory-status');
        const health = ui.byId('memory-health');
        if (health) health.textContent = core.memoryHealthText(core.memory.status);
        const degraded = core.memory.status?.state === 'degraded';
        const modelNote = degraded && core.memory.status?.capabilities?.inject === false
            ? (core.memory.status?.reasonCode === 'MEMORY_MODEL_UNAVAILABLE'
                ? '模型路线暂不可用，当前记忆未用于模型回复。 ' : '当前记忆未用于模型回复。 ')
            : '';
        const processingNote = core.memory.status?.blockedBoundaryCount > 0
            ? '部分来源已阻断，当前不会自动重试。 '
            : core.memory.status?.pendingBoundaryCount > 0 ? '有来源待处理。 ' : '';
        node.textContent = `${modelNote}${processingNote}${message}`;
        node.classList.toggle('is-error', error);
    }
    function detailStatus(message, error = false) {
        const node = ui.byId('memory-detail-status');
        node.textContent = message;
        node.classList.toggle('is-error', error);
    }
    function detailError(message) { ui.errorAt('memory-detail-error', message); }
    function paintMemoryReceipt(message, requestId, action = 'none') {
        ui.byId('memory-receipt-text').textContent = message;
        ui.byId('memory-receipt-id').textContent = requestId;
        ui.byId('memory-receipt-check').hidden = action === 'none';
        ui.byId('memory-receipt-check').textContent = action === 'retry-cleanup' ? '重试底层清理' : '核对处理结果';
        ui.byId('memory-receipt').hidden = false;
    }
    function renderMemoryItems() {
        const list = ui.byId('memory-list');
        list.replaceChildren();
        for (const item of core.memory.items) {
            const row = ui.element('li', 'memory-item');
            const button = ui.element('button', 'memory-item-button');
            button.type = 'button';
            button.append(ui.element('span', 'memory-item-text', typeof item.text === 'string'
                ? `${item.text}${item.truncated === true ? '\n（仅显示片段）' : ''}` : '内容暂不可用'));
            button.append(ui.element('span', 'memory-item-meta', `${core.memoryKinds[item.kind] ?? '记忆'} · ${core.memoryLifecycle(item)}${item.updatedAt ? ` · 更新于 ${core.formatDate(item.updatedAt)}` : ''}`));
            if (!core.memoryPathId(item.id)) {
                button.disabled = true;
                button.append(ui.element('span', 'memory-item-meta', '此标识无法安全打开详情，暂可在列表查看。'));
            }
            else
                button.addEventListener('click', () => { void core.openMemoryDetail(item.kind, item.id); });
            row.append(button);
            list.append(row);
        }
        ui.byId('memory-more').hidden = !core.memory.hasMore;
    }
    function renderMemorySources(sources) {
        const list = ui.byId('memory-sources');
        list.replaceChildren();
        if (!sources.length) {
            ui.byId('memory-sources-status').textContent = '当前没有可展示的来源。';
            return;
        }
        ui.byId('memory-sources-status').textContent = '';
        const currentnessLabels = new Map([
            ['current', '当前来源'],
            ['not_current', '来源不再支持当前理解'],
            ['evidence_deleted', '来源已删除'],
            ['evidence_local_read_denied', '来源未允许本机模型读取'],
            ['evidence_cloud_read_denied', '来源未允许云端模型读取'],
            ['evidence_not_model_readable', '来源当前不可供模型读取'],
            ['evidence_missing', '来源记录未找到'],
            ['evidence_subject_mismatch', '来源账户不匹配'],
        ]);
        for (const source of sources) {
            const row = ui.element('li', 'memory-source');
            const currentness = currentnessLabels.get(source.currentnessState) ?? '来源状态待确认';
            const meta = ui.element('p', 'memory-source-meta', `${currentness}${source.recordedAt ? ` · 记录于 ${core.formatDate(source.recordedAt)}` : ''}`);
            const summary = ui.element('p', 'memory-source-summary', typeof source.summary === 'string' && source.summary.trim()
                ? source.summary : source.contentAvailable === false ? '此来源当前不可读。' : '摘要当前不可用。');
            const raw = ui.element('p', 'memory-source-raw', source.contentAvailable === true && typeof source.rawContent === 'string'
                ? `${source.rawContent}${source.rawContentTruncated === true ? '\n（仅显示可读片段）' : ''}` : '原文当前不可用。');
            row.append(meta, summary, raw);
            list.append(row);
        }
    }
    function renderMemoryMode() {
        const mode = core.memory.mode;
        ui.byId('memory-detail-body').hidden = false;
        ui.byId('memory-correct-panel').hidden = mode !== 'correct';
        ui.byId('memory-confirm-panel').hidden = !['mute', 'delete'].includes(mode);
        ui.byId('memory-detail-back').hidden = mode === 'detail';
        ui.byId('memory-detail-check').hidden = !core.memory.unresolvedMarker && !core.memory.cleanupMarker;
        ui.byId('memory-detail-check').textContent = core.memory.cleanupMarker?.cleanupState === 'pending'
            && core.memory.cleanupMarker?.retryUnknown !== true
            && !core.memory.unresolvedMarker ? '重试底层清理' : '核对处理结果';
        ui.byId('memory-detail-check').disabled = core.memory.cleanupRetrying;
        ui.byId('memory-correct-action').hidden = mode !== 'detail' || !core.memoryActionAllowed('correct');
        ui.byId('memory-mute-action').hidden = mode !== 'detail' || !core.memoryActionAllowed('mute');
        ui.byId('memory-delete-action').hidden = mode !== 'detail' || !core.memoryActionAllowed('delete');
        ui.byId('memory-confirm-action').hidden = mode === 'detail';
        ui.byId('memory-delete-boundary').hidden = mode !== 'delete';
        if (mode === 'correct') {
            ui.byId('memory-confirm-action').textContent = '保存纠正';
            ui.byId('memory-correct-text').value = core.memory.drafts.get(`${core.memory.selected.kind}|${core.memory.selected.id}`) ?? '';
        }
        else if (mode === 'mute') {
            ui.byId('memory-confirm-action').textContent = '确认停用';
            ui.byId('memory-confirm-copy').textContent = '停用后仍可查看记忆和来源，但不再用于后续召回。';
        }
        else if (mode === 'delete') {
            ui.byId('memory-confirm-action').textContent = '确认忘掉';
            ui.byId('memory-confirm-copy').textContent = '忘掉会清除来源及以下记忆，之后的记忆导出不再包含它们。';
            let scope = document.getElementById('memory-forget-scope');
            if (!scope) { scope = ui.element('div'); scope.id = 'memory-forget-scope'; ui.byId('memory-confirm-panel').append(scope); }
            scope.replaceChildren(); scope.hidden = false;
            const preview = core.memory.forgetPreview;
            const status = ui.element('p', '', preview ? `将忘掉 ${preview.itemCount} 项记忆，清除 ${preview.evidenceCount} 条来源。以下内容会一起忘掉：`
                : core.memory.forgetPreviewError || '正在读取将一起忘掉的记忆…');
            status.setAttribute('role', 'status'); scope.append(status);
            if (preview) {
                const list = ui.element('ul', 'memory-sources');
                for (const item of preview.items) list.append(ui.element('li', '', core.forgetItemSummary(item)));
                scope.append(list);
            }
            const label = ui.element('label', 'memory-forget-option'), checkbox = ui.element('input'); checkbox.type = 'checkbox';
            checkbox.checked = core.memory.deleteConversationSnippets === true;
            checkbox.addEventListener('change', () => { core.memory.deleteConversationSnippets = checkbox.checked; });
            label.append(checkbox, document.createTextNode('同时删除对话里含这句话的原话')); scope.append(label);
            ui.byId('memory-delete-boundary').textContent = '默认保留对话原文；勾选后删除对应原生对话片段及个人命令副本。以前的备份仍保留。';
        }
        const scope = document.getElementById('memory-forget-scope'); if (scope) scope.hidden = mode !== 'delete';
        ui.byId('memory-confirm-action').disabled = !!core.memory.activeOperation || !!core.memory.unresolvedMarker || !!core.memory.selected?.stale
            || mode === 'delete' && !core.memory.forgetPreview;
    }
    function handleMemoryReceiptAction() {
        const unknown = core.storedMemoryMarker(core.memoryMarkerKey()) ?? core.memory.unresolvedMarker;
        if (unknown) {
            void core.recoverMemoryReceipt();
            return;
        }
        const cleanup = core.storedCleanupMarkers(core.memoryCleanupKey()).find((entry) => entry.requestId === ui.byId('memory-receipt-id').textContent) ?? core.memory.cleanupMarker;
        if (cleanup?.cleanupOnly && cleanup.cleanupState === 'pending' && cleanup.retryUnknown !== true)
            void core.retryMemoryCleanup();
        else
            void core.recoverMemoryReceipt();
    }
    function resetMemoryControls() {
        resetIngestion();
        ui.byId('memory-kind').value = 'cognition';
        ui.byId('memory-query').value = '';
        ui.byId('memory-list').replaceChildren();
        ui.byId('memory-more').hidden = true;
        ui.byId('memory-receipt').hidden = true;
        ui.byId('memory-detail-text').textContent = '';
        ui.byId('memory-sources').replaceChildren();
        ui.byId('memory-correct-text').value = '';
        ui.detailError('');
        ui.detailStatus('');
        ui.memoryStatus('登录后可查看当前账户的记忆。');
        if (ui.byId('memory-detail-dialog').open)
            ui.byId('memory-detail-dialog').close();
    }
    function clearMemoryList() {
        ui.byId('memory-list').replaceChildren();
        ui.byId('memory-more').hidden = true;
    }
    function setMemoryMoreBusy(busy) {
        ui.byId('memory-more').disabled = busy;
    }
    function beginMemoryDetail(kind) {
        ui.byId('memory-detail-title').textContent = `${core.memoryKinds[kind]}详情`;
        ui.byId('memory-detail-text').textContent = '';
        ui.byId('memory-detail-meta').textContent = '';
        ui.byId('memory-sources').replaceChildren();
        ui.byId('memory-sources-status').textContent = '';
        ui.detailError('');
        ui.detailStatus('正在读取记忆详情…');
        ui.renderMemoryMode();
        if (!ui.byId('memory-detail-dialog').open)
            ui.byId('memory-detail-dialog').showModal();
    }
    function paintMemoryDetail(result) {
        ui.byId('memory-detail-text').textContent = typeof result.item.text === 'string'
            ? `${result.item.text}${result.item.truncated === true ? '\n（仅显示片段）' : ''}` : '内容当前不可用。';
        ui.byId('memory-detail-meta').textContent = `${core.memoryLifecycle(result.item)}${result.item.updatedAt ? ` · 更新于 ${core.formatDate(result.item.updatedAt)}` : ''}`;
    }
    function memoryCommandText() {
        return ui.byId('memory-correct-text').value.trim();
    }
    function setMemoryConfirmBusy(busy) {
        ui.byId('memory-confirm-action').disabled = busy;
    }
    function setMemoryCleanupBusy(busy) {
        ui.byId('memory-receipt-check').disabled = busy;
        ui.byId('memory-detail-check').disabled = busy;
    }
    function readMemoryReceiptId() {
        return ui.byId('memory-receipt-id').textContent;
    }
    function clearMemoryDetailView() {
        ui.byId('memory-detail-text').textContent = '';
        ui.byId('memory-detail-meta').textContent = '';
        ui.byId('memory-sources').replaceChildren();
        ui.byId('memory-correct-text').value = '';
        ui.detailError('');
        ui.detailStatus('');
        if (ui.byId('memory-detail-dialog').open)
            ui.byId('memory-detail-dialog').close();
    }
    function mountIngestion() {
        const section = ui.element('section', 'memory-ingestion');
        section.setAttribute('aria-label', '记忆健康与过去的对话');
        const health = ui.element('p', 'muted', '正在检查记忆健康…'); health.id = 'memory-health'; health.setAttribute('role', 'status');
        const progress = ui.element('p', 'muted'); progress.setAttribute('role', 'status');
        const explanation = ui.element('p', 'muted');
        const actions = ui.element('div', 'form-actions');
        const preview = ui.element('button', 'button secondary small', '整理过去的对话'); preview.type = 'button';
        const confirm = ui.element('button', 'button primary small', '确认开始整理'); confirm.type = 'button'; confirm.hidden = true;
        const pause = ui.element('button', 'button secondary small', '暂停整理'); pause.type = 'button'; pause.hidden = true;
        const cancel = ui.element('button', 'button secondary small', '取消整理'); cancel.type = 'button'; cancel.hidden = true;
        let prepared = null, identity = null, job = null, busy = false;
        resetIngestion = () => { prepared = null; identity = null; job = null; explanation.textContent = ''; progress.textContent = ''; confirm.hidden = pause.hidden = cancel.hidden = true; health.textContent = '正在检查记忆健康…'; };
        function paint(status) {
            health.textContent = core.memoryHealthText(status);
            job = status?.backfill;
            const active = job && ['running', 'paused'].includes(job.state);
            preview.disabled = busy || !!active;
            pause.hidden = cancel.hidden = !active;
            pause.textContent = job?.state === 'paused' ? '继续整理' : '暂停整理';
            progress.textContent = job ? `${({running:'正在补整理',paused:'已暂停',cancelled:'已取消',completed:'补交完成'})[job.state] ?? '整理中'}：已提交 ${job.submittedTurns - job.skippedTurns} / ${job.totalTurns} 回合${job.skippedTurns ? `，已跳过 ${job.skippedTurns} 回合` : ''}。${active ? '暂停或取消后不再提交后续回合；已提交的回合继续整理。' : ''}` : '';
        }
        async function refresh() {
            if (core.state.currentView !== 'memory' || busy) return;
            const token = core.memoryIdentity();
            try { const status = await core.memoryRequest('/status'); if (!core.memoryViewCurrent(token)) return;
                core.memory.status = status; paint(status);
            } catch { if (core.memoryViewCurrent(token)) health.textContent = '记忆状态暂时无法读取，请刷新重试。'; }
        }
        preview.addEventListener('click', async () => {
            const previewIdentity = core.memoryIdentity(); identity = previewIdentity; busy = true; preview.disabled = true;
            explanation.textContent = '正在统计可整理的过去对话…';
            try { prepared = await core.memoryRequest('/backfill'); if (!core.memoryIdentityCurrent(previewIdentity)) return;
                explanation.textContent = !prepared.turnCount ? '过去的对话已全部补交，没有需要重复整理的回合。' : `可整理 ${prepared.sessionCount} 个会话、${prepared.turnCount} 个回合。预计输入约 ${prepared.estimatedUsage.inputTokens.toLocaleString()}、输出约 ${prepared.estimatedUsage.outputTokens.toLocaleString()} 个词元；实际用量取决于模型与重试。跳过临时对话、已关闭记忆的对话及已遗忘内容。`;
                confirm.hidden = !prepared.turnCount;
            } catch { if (core.memoryIdentityCurrent(previewIdentity)) explanation.textContent = '统计失败，请检查连接后重试。'; }
            finally { busy = false; preview.disabled = false; }
        });
        async function change(input) {
            const token = core.memoryIdentity(); busy = true;
            for (const button of [preview, confirm, pause, cancel]) button.disabled = true;
            try { await core.memoryRequest('/backfill', { method: 'POST', body: input }); if (!core.memoryIdentityCurrent(token)) return;
                confirm.hidden = true; explanation.textContent = ''; prepared = null;
            } catch { if (core.memoryIdentityCurrent(token)) explanation.textContent = '操作未确认，请刷新核对进度后重试。'; }
            finally { busy = false; for (const button of [confirm, pause, cancel]) button.disabled = false; await refresh(); }
        }
        confirm.addEventListener('click', () => { if (prepared && core.memoryIdentityCurrent(identity)) void change({action:'start',previewId:prepared.previewId,confirm:true}); });
        pause.addEventListener('click', () => { if(job) void change({action:job.state==='paused'?'resume':'pause',jobId:job.id}); });
        cancel.addEventListener('click', () => { if(job) void change({action:'cancel',jobId:job.id}); });
        actions.append(preview, confirm, pause, cancel); section.append(health, actions, explanation, progress);
        ui.byId('memory-search-form').before(section);
        setInterval(() => { void refresh(); }, 3000);
        ui.byId('memory-refresh').addEventListener('click', () => { void refresh(); });
    }
    function mountMemory() {
        mountIngestion();
        ui.byId('memory-delete-action').textContent = '忘掉';
        ui.byId('rail-memory').addEventListener('click', () => { void core.openMemory(); });
        ui.byId('memory-back').addEventListener('click', () => { core.closeMemoryDetail(); void core.enterAssistant(); });
        ui.byId('memory-search-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const kind = ui.byId('memory-kind').value;
            const query = ui.byId('memory-query').value.trim().normalize('NFKC');
            if (!core.memoryKinds[kind] || query.length > 120)
                return ui.memoryStatus('请输入不超过 120 个字符的关键词。', true);
            core.setMemoryFilters(kind, query);
            void core.loadMemoryPage();
        });
        ui.byId('memory-kind').addEventListener('change', () => {
            const filters = ui.memoryFilterInput();
            core.setMemoryFilters(filters.kind, filters.query);
            if (core.memoryKinds[core.memory.kind] && core.memory.query.length <= 120)
                void core.loadMemoryPage();
        });
        const exports = ui.element('div', 'form-actions');
        for (const format of ['json', 'markdown']) {
            const button = ui.element('button', 'button secondary small', `导出我的记忆 · ${format === 'json' ? 'JSON' : 'Markdown'}`);
            button.type = 'button'; button.id = `memory-export-${format}`;
            button.addEventListener('click', () => { void exportMemories(format); });
            exports.append(button);
        }
        ui.byId('memory-search-form').before(exports);
        ui.byId('memory-refresh').addEventListener('click', () => { void core.openMemory(); });
        ui.byId('memory-more').addEventListener('click', () => { void core.loadMemoryPage({ more: true }); });
        ui.byId('memory-receipt-check').addEventListener('click', ui.handleMemoryReceiptAction);
        ui.byId('memory-detail-close').addEventListener('click', core.closeMemoryDetail);
        ui.byId('memory-detail-dialog').addEventListener('close', () => {
            if (core.memory.selected)
                core.closeMemoryDetail();
        });
        ui.byId('memory-detail-back').addEventListener('click', () => { core.setMemoryMode('detail'); ui.detailError(''); ui.renderMemoryMode(); });
        ui.byId('memory-detail-check').addEventListener('click', ui.handleMemoryReceiptAction);
        ui.byId('memory-correct-action').addEventListener('click', () => {
            if (!core.memoryActionAllowed('correct'))
                return;
            core.setMemoryMode('correct');
            ui.detailError('');
            ui.renderMemoryMode();
            ui.byId('memory-correct-text').focus();
        });
        ui.byId('memory-mute-action').addEventListener('click', () => {
            if (!core.memoryActionAllowed('mute'))
                return;
            core.setMemoryMode('mute');
            ui.detailError('');
            ui.renderMemoryMode();
        });
        ui.byId('memory-delete-action').addEventListener('click', () => {
            if (!core.memoryActionAllowed('delete'))
                return;
            core.setMemoryMode('delete');
            ui.detailError('');
            ui.renderMemoryMode();
        });
        ui.byId('memory-correct-text').addEventListener('input', () => {
            if (!core.memory.selected)
                return;
            core.setMemoryCorrectionText(ui.byId('memory-correct-text').value);
            ui.detailError('');
        });
        ui.byId('memory-confirm-action').addEventListener('click', () => { void core.submitMemoryAction(); });
        window.addEventListener('online', () => {
            if (!ui.byId('memory-view').hidden)
                void core.openMemory();
        });
    }
    function memoryFilterInput() {
        return { kind: ui.byId('memory-kind').value, query: ui.byId('memory-query').value.trim().normalize('NFKC') };
    }
    return { paintMemoryAvailability, exportMemories, memoryStatus, detailStatus, detailError, paintMemoryReceipt, renderMemoryItems, renderMemorySources, renderMemoryMode, handleMemoryReceiptAction, resetMemoryControls, clearMemoryList, setMemoryMoreBusy, beginMemoryDetail, paintMemoryDetail, memoryCommandText, setMemoryConfirmBusy, setMemoryCleanupBusy, readMemoryReceiptId, clearMemoryDetailView, mountMemory, memoryFilterInput };
};
