/* Desktop memory component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.memory = (core, ui) => {
    function memoryStatus(message, error = false) {
        const node = ui.byId('memory-status');
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
            ui.byId('memory-confirm-action').textContent = '确认删除';
            ui.byId('memory-confirm-copy').textContent = '请确认删除这项当前账户记忆。共享或不明来源可能使删除被拒绝；停用可单独选择。';
        }
        ui.byId('memory-confirm-action').disabled = !!core.memory.activeOperation || !!core.memory.unresolvedMarker || !!core.memory.selected?.stale;
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
    function mountMemory() {
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
    return { memoryStatus, detailStatus, detailError, paintMemoryReceipt, renderMemoryItems, renderMemorySources, renderMemoryMode, handleMemoryReceiptAction, resetMemoryControls, clearMemoryList, setMemoryMoreBusy, beginMemoryDetail, paintMemoryDetail, memoryCommandText, setMemoryConfirmBusy, setMemoryCleanupBusy, readMemoryReceiptId, clearMemoryDetailView, mountMemory, memoryFilterInput };
};
