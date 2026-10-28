/* Desktop memory component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.memory = (core, ui) => {
    let resetIngestion = () => {};
    let importsView, importsOwner, importsTools;
    const memoryRows = new Map();
    let renderedScope;
    let deviceCleanup,deviceCleanupGeneration=0;
    async function readDeviceCleanup(){
        if(!deviceCleanup||!core.readDeviceSync)return;
        const token=core.memoryIdentity(),generation=++deviceCleanupGeneration;
        try{
            const payload=await core.readDeviceSync();
            if(generation!==deviceCleanupGeneration||!core.memoryIdentityCurrent(token))return;
            const cleanups=payload.devices.filter(row=>row.sync?.cleanup),waiting=cleanups.filter(row=>row.sync.cleanup.state==='waiting_device');
            deviceCleanup.hidden=!cleanups.length;
            deviceCleanup.querySelector('strong').textContent=waiting.length?'等待设备回执':'设备已确认清理';
            deviceCleanup.querySelector('p').textContent=waiting.length?`${waiting.length} 台设备尚未确认遗忘清理。设备重新连接并完成同步后，这里会更新。`:'已收到设备对本次遗忘清理的确认。';
        }catch{
            if(generation!==deviceCleanupGeneration||!core.memoryIdentityCurrent(token))return;
            deviceCleanup.hidden=false;deviceCleanup.querySelector('strong').textContent='设备清理状态暂时无法读取';
            deviceCleanup.querySelector('p').textContent='请检查连接后重试。';
        }
    }
    const listScope = () => `${core.state.identityGeneration}|${core.state.account?.ownerId ?? core.state.ownerId}|${core.memory.kind}|${core.memory.query}|${JSON.stringify(core.memory.weekFilter)}`;
    function mountHistoryImports() {
        const owner = core.state.account?.ownerId;
        if (!globalThis.WeftHistoryImportView || !owner) return;
        if (importsView && importsOwner === owner) return;
        importsView?.destroy(); importsTools?.remove(); importsOwner = owner;
        importsView = WeftHistoryImportView({ target: ui.byId('memory-view'), owner: () => core.state.account?.ownerId,
            request: core.accessApi, desktop: globalThis.weftmateDesktop?.previewHistoryImport ? globalThis.weftmateDesktop : null,
            refreshMemory: () => void core.loadMemoryPage() });
        const tools = ui.element('details', 'memory-import-tools'); tools.dataset.motion = 'unfold';
        importsTools = tools;
        tools.append(ui.element('summary', '', '导入已有对话'), importsView.element);
        const panelTools = ui.byId('memory-panel-tools');
        if (panelTools) panelTools.append(tools); else ui.byId('memory-search-form').before(tools);
    }
    function paintMemoryAvailability(status) {
        let node = ui.byId('chat-memory-notice');
        if (!node) {
            node = ui.element('p', 'connection-banner'); node.id = 'chat-memory-notice';
            node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
            ui.byId('connection-banner').after(node);
        }
        const issues=status?.formationIssues??[];
        for(const old of document.querySelectorAll('[data-formation-notice]'))if(!issues.some(issue=>issue.jobId===old.dataset.formationNotice))old.remove();
        for(const issue of issues){const row=[...document.querySelectorAll('.message.user')].find(row=>row.dataset.memorySession===issue.sessionId&&row.textContent.includes(issue.text));if(!row)continue;
          let target=row;for(let next=row.nextElementSibling;next&&!next.classList.contains('user');next=next.nextElementSibling)if(next.classList.contains('assistant')){target=next;break;}
          if(target.querySelector(`[data-formation-notice="${CSS.escape(issue.jobId)}"]`))continue;
          const hint=ui.element('div','memory-issue-bar');hint.dataset.formationNotice=issue.jobId;hint.setAttribute('role','status');hint.append(WeftIcons.create('warn',16),ui.element('span','',issue.intent==='correction'?'这条纠正没有生效':'这条内容尚未记住'));
          const action=ui.element('button','message-action','查看');action.type='button';action.onclick=()=>core.openMemory();hint.append(action);target.append(hint);

        }
        node.hidden = status?.state !== 'unavailable';
        node.textContent = node.hidden ? '' : '记忆暂时不可用，普通对话已保存，恢复后会自动整理。';
    }
    async function exportMemories(format) {
        const button = ui.byId(`memory-export-${format}`); if(button) button.disabled = true;
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
        finally { if(button) button.disabled = false; }
    }
    function memoryStatus(message, error = false) {
        const node = ui.byId('memory-status');
        ui.paintMemoryHealth?.(core.memory.status);
        if (core.memory.status?.state === 'disabled') {
            // Rich status content must not inherit the plain-text loading animation.
            node.classList.remove('reply-status', 'reply-working');
            node.textContent = '这台电脑尚未启用记忆，暂时不能跨对话记住你告诉它的事。请在这台电脑';
            const download = ui.element('a', '', '下载并安装最新版');
            download.href = 'https://weftmate.com/downloads/';
            download.target = '_blank'; download.rel = 'noopener noreferrer';
            node.append(download, ' WeftMate，然后重新打开应用。聊天仍可使用。');
            node.classList.toggle('is-error', false);
            return;
        }
        if (['unavailable', 'degraded'].includes(core.memory.status?.state) &&
            core.memory.status.reasonCode === 'MEMORY_MODEL_UNAVAILABLE') {
            node.textContent = '记忆要用的模型还没设置好或暂时连不上，请检查模型设置。';
            const setup = ui.element('button', 'button secondary small', '设置模型');
            setup.type = 'button';
            setup.addEventListener('click', () => ui.openSettings('models'));
            node.append(setup);
            node.classList.toggle('is-error', true);
            return;
        }
        if (core.memory.status?.state === 'unavailable') {
            node.textContent = '记忆暂时没开，聊天仍可用；请';
            const repair = ui.element('a', '', '下载并重新安装');
            repair.href = 'https://weftmate.com/downloads/';
            repair.target = '_blank'; repair.rel = 'noopener noreferrer';
            node.append(repair, '，已有记忆会保留。');
            if (globalThis.weftmateDesktop?.repairSystem) {
                const retry = ui.element('button', 'button secondary small', '修复记忆');
                retry.type = 'button';
                retry.addEventListener('click', async () => {
                    retry.disabled = true;
                    try { await globalThis.weftmateDesktop.repairSystem('memory'); }
                    catch { /* Keep the download repair action available on failure. */ }
                    finally { retry.disabled = false; await core.openMemory(); }
                });
                node.append(retry);
            }
            node.classList.toggle('is-error', true);
            return;
        }
        const degraded = core.memory.status?.state === 'degraded';
        const modelNote = degraded && core.memory.status?.capabilities?.inject === false
            ? '当前记忆未用于模型回复。 '
            : '';
        const processingNote = core.memory.status?.blockedBoundaryCount > 0
            ? '部分内容未能处理，已暂停自动重试。 '
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
        ui.byId('memory-receipt-check').textContent = action === 'retry-cleanup' ? '重试清理' : '核对处理结果';
        ui.byId('memory-receipt').hidden = false;
    }
    function renderMemoryItems() {
        mountHistoryImports();
        let week=ui.byId('memory-week-filter');
        if(!week){week=ui.element('button','button secondary small');week.id='memory-week-filter';week.type='button';week.textContent='正在查看这一周的记忆 · 查看全部';week.onclick=()=>{core.memory.weekFilter=null;void core.loadMemoryPage();};ui.byId('memory-search-form').before(week);}
        week.hidden=!core.memory.weekFilter;
        const list = ui.byId('memory-list');
        const rows = [], owner = core.state.account?.ownerId ?? core.state.ownerId;
        for (const item of core.memory.items) {
            const key = `${owner}|${item.kind}|${item.id}`;
            const signature = JSON.stringify([item, core.memoryLifecycle(item)]);
            const previous = memoryRows.get(key);
            if (previous?.signature === signature) { rows.push(previous.row); continue; }
            const row = ui.element('li', 'memory-item');
            row.dataset.memoryId = item.id;
            const button = ui.element('button', 'memory-item-button');
            button.type = 'button';
            button.append(ui.element('span', 'memory-item-text', typeof item.text === 'string'
                ? `${item.text}${item.truncated === true ? '\n（仅显示片段）' : ''}` : '内容暂不可用'));
            button.append(ui.element('span', 'memory-item-meta', `${core.memoryKinds[item.kind] ?? '记忆'} · ${core.memoryLifecycle(item)}${item.updatedAt ? ` · 更新于 ${core.formatDate(item.updatedAt)}` : ''}`));
            if (!core.memoryPathId(item.id)) {
                button.disabled = true;
                button.append(ui.element('span', 'memory-item-meta', '暂时无法打开这条记忆的详情，可以先在列表中查看。'));
            }
            else
                button.addEventListener('click', () => { void core.openMemoryDetail(item.kind, item.id); });
            row.append(button);
            const ids = item.sourceConversationIds ?? (item.sourceSessionId ? [item.sourceSessionId] : []);
            for (const id of ids) { const source = ui.element('button','memory-source-link','来源对话'); source.type='button'; source.setAttribute('aria-label',`查看来源对话：${item.text}`); source.addEventListener('click',async()=>{ui.hideSettingsDialog();try { await core.selectSession(id); } catch(error) { ui.toast(core.failureMessage(error)); }}); source.prepend(WeftIcons.create('chat',16));row.append(source); }
            if (!ids.length) { const source=ui.element('button','memory-source-link',item.importSources?.length ? `来自 ${item.importSources[0].appName}${item.importSources[0].originalAt ? '，' + new Intl.DateTimeFormat('zh-CN', {year:'numeric',month:'long'}).format(new Date(item.importSources[0].originalAt)) : ''}的一段对话` : item.sourceCount ? '查看原话' : '查看来源'); source.type='button'; source.addEventListener('click',()=>{void core.openMemoryDetail(item.kind,item.id)});source.prepend(WeftIcons.create('chat',16));row.append(source); }
            rows.push(row); memoryRows.set(key, { signature, row });
        }
        if (!rows.length) {
            const empty = ui.element('li', 'memory-empty', core.memory.query ? '没有找到相关记忆，试试更短的关键词。' : '还没有记忆。聊聊你的习惯和想法，之后可以在这里查看、纠正或忘掉。');
            rows.push(empty);
        }
        WeftControls.reconcile(list, rows);
        renderedScope = listScope(); list.removeAttribute('aria-busy');
        for (const [key, value] of memoryRows) if (!rows.includes(value.row)) memoryRows.delete(key);
        ui.byId('memory-more').hidden = !core.memory.hasMore;
        ui.paintMemoryHealth?.(core.memory.status);
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
            const currentness = source.relation === 'superseded_by' ? '取代这条理解的纠正原话' : currentnessLabels.get(source.currentnessState) ?? '来源状态待确认';
            const imported = source.importSource;
            const meta = ui.element('p', 'memory-source-meta', imported
                ? `来自 ${imported.appName}，${imported.originalAt ? new Intl.DateTimeFormat('zh-CN', {year:'numeric',month:'long'}).format(new Date(imported.originalAt)) : '日期不明'}的一段对话`
                : `${currentness}${source.recordedAt ? ` · 记录于 ${core.formatDate(source.recordedAt)}` : ''}`);
            const summary = ui.element('p', 'memory-source-summary', typeof source.summary === 'string' && source.summary.trim()
                ? source.summary : source.contentAvailable === false ? '此来源当前不可读。' : '摘要当前不可用。');
            const raw = ui.element('p', 'memory-source-raw', source.contentAvailable === true && typeof source.rawContent === 'string'
                ? `${globalThis.WeftImportSourceText?.(source) ?? source.rawContent}${source.rawContentTruncated === true ? '\n（仅显示可读片段）' : ''}` : '原文当前不可用。');
            if (imported) row.append(meta, raw);
            else row.append(meta, summary, raw);
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
            && !core.memory.unresolvedMarker ? '重试清理' : '核对处理结果';
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
            ui.byId('memory-confirm-copy').textContent = '停用后仍可查看记忆和来源，但不再用于之后的回答。';
        }
        else if (mode === 'delete') {
            ui.byId('memory-confirm-action').textContent = '确认忘掉';
            ui.byId('memory-confirm-copy').textContent = '忘掉会清除来源及以下记忆，之后的记忆导出不再包含它们。';
            let scope = document.getElementById('memory-forget-scope');
            if (!scope) { scope = ui.element('div'); scope.id = 'memory-forget-scope'; ui.byId('memory-confirm-panel').append(scope); }
            scope.replaceChildren(); scope.hidden = false;
            const preview = core.memory.forgetPreview;
            const status = ui.element('p', '', preview ? `将忘掉 ${preview.itemCount} 项记忆，清除 ${preview.evidenceCount} 条来源。以下内容会一起忘掉：`
                : core.memory.forgetPreviewError || '');
            if (!preview && !core.memory.forgetPreviewError) status.append(WeftControls.skeleton({rows:1,compact:true,tag:'span'}));
            status.setAttribute('role', 'status'); scope.append(status);
            if (preview) {
                const list = ui.element('ul', 'memory-sources');
                for (const item of preview.items) list.append(ui.element('li', '', core.forgetItemSummary(item)));
                scope.append(list);
            }
            else if (core.memory.forgetPreviewError && !core.memory.forgetPreviewLoading) {
                const retry = ui.element('button', 'button secondary small', '重新读取遗忘范围');
                retry.type = 'button';
                retry.addEventListener('click', () => { void core.setMemoryMode('delete'); });
                scope.append(retry);
            }
            const label = ui.element('label', 'memory-forget-option'), checkbox = ui.element('input'); checkbox.type = 'checkbox';
            checkbox.checked = core.memory.deleteConversationSnippets === true;
            checkbox.addEventListener('change', () => { core.memory.deleteConversationSnippets = checkbox.checked; });
            label.append(checkbox, document.createTextNode('同时删除对话里含这句话的原话')); scope.append(label);
            ui.byId('memory-delete-boundary').textContent = '默认保留聊天原话；勾选后，同时删除聊天记录里的这几句原话。以前的备份不受影响。';
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
        deviceCleanupGeneration++;if(deviceCleanup)deviceCleanup.hidden=true;
        memoryRows.clear();
        resetIngestion();
        ui.byId('memory-kind').value = 'all'; ui.syncMemoryFilters?.();
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
        if (core.memory.revision != null && renderedScope === listScope()) {
            ui.byId('memory-list').setAttribute('aria-busy', 'true'); return;
        }
        memoryRows.clear(); renderedScope = undefined;
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
        ui.detailStatus(''); ui.byId('memory-detail-status').replaceChildren(WeftControls.skeleton({rows:1,compact:true,tag:'span'}));
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
        const health = ui.element('div', 'memory-health', '正在检查记忆健康…'); health.id = 'memory-health'; health.setAttribute('role', 'status');
        const progress = ui.element('p', 'muted'); progress.setAttribute('role', 'status');
        const explanation = ui.element('p', 'muted');
        const actions = ui.element('div', 'form-actions');
        const preview = ui.element('button', 'button secondary small', '整理过去的对话'); preview.type = 'button';
        const confirm = ui.element('button', 'button primary small', '确认开始整理'); confirm.type = 'button'; confirm.hidden = true;
        const pause = ui.element('button', 'button secondary small', '暂停整理'); pause.type = 'button'; pause.hidden = true;
        const cancel = ui.element('button', 'button secondary small', '取消整理'); cancel.type = 'button'; cancel.hidden = true;
        const card=ui.element('section','memory-backfill-confirm'); card.hidden=true; card.setAttribute('aria-label','确认整理过去的对话');
        const cancelPreview=ui.element('button','button secondary small','取消'); cancelPreview.type='button';
        card.append(ui.element('h3','','整理过去的对话'),explanation,confirm,cancelPreview);
        let prepared = null, identity = null, job = null, busy = false;
        resetIngestion = () => { prepared = null; identity = null; job = null; delete health.dataset.signature; explanation.textContent = ''; progress.textContent = ''; card.hidden=true; preview.hidden=false; confirm.hidden = pause.hidden = cancel.hidden = true; health.textContent = '正在检查记忆健康…'; };
        ui.paintMemoryHealth = status => {
            WeftPopover.memoryHealth(health,status,{text:core.memoryHealthText(status),count:status?.formedMemoryCount??core.memory.totalCount,
              onSource:async id=>{ui.hideSettingsDialog();await core.selectSession(id)},
              onRetry:async(issue,requestId)=>{const token=core.memoryIdentity();await core.memoryRequest(`/formation/${encodeURIComponent(issue.jobId)}/retry`,{method:'POST',body:{requestId}});if(core.memoryIdentityCurrent(token))await refresh();}});

        };
        function paint(status) {
            ui.paintMemoryHealth(status);
            job = status?.backfill;
            const active = job && ['running', 'paused'].includes(job.state);
            preview.disabled = busy || !!active; preview.hidden=!!active || !card.hidden;
            pause.hidden = cancel.hidden = !active;
            pause.textContent = job?.state === 'paused' ? '继续整理' : '暂停整理';
            progress.textContent = job ? `${({running:'正在整理过去的对话',paused:'已暂停',cancelled:'已取消',completed:'对话已送去整理'})[job.state] ?? '整理中'}：已送去整理 ${job.submittedTurns - job.skippedTurns} / ${job.totalTurns} 轮对话${job.skippedTurns ? `，已跳过 ${job.skippedTurns} 轮` : ''}。${active ? '暂停或取消后不再处理后续对话；已送去整理的内容会继续处理。' : ''}` : '';
        }
        async function refresh() {
            if (core.state.currentView !== 'memory' || busy) return;
            const token = core.memoryIdentity();
            try { const status = await core.memoryRequest('/status'); if (!core.memoryViewCurrent(token)) return;
                const changed = Number.isInteger(core.memory.status?.worldRevision) && core.memory.status.worldRevision !== status.worldRevision;
                core.memory.status = status; paint(status);
                if (changed && !core.memory.loading) void core.loadMemoryPage();
            } catch { if (core.memoryViewCurrent(token)) health.textContent = '记忆状态暂时无法读取，请刷新重试。'; }
        }
        preview.addEventListener('click', async () => {
            const previewIdentity = core.memoryIdentity(); identity = previewIdentity; busy = true; preview.disabled = true;
            explanation.textContent = '正在统计可整理的过去对话…';
            try { prepared = await core.memoryRequest('/backfill'); if (!core.memoryIdentityCurrent(previewIdentity)) return;
                explanation.textContent = !prepared.turnCount ? '过去的对话都已送去整理，没有需要重复处理的内容。' : `可整理 ${prepared.sessionCount} 段对话，共 ${prepared.turnCount} 轮。预计输入约 ${prepared.estimatedUsage.inputTokens.toLocaleString()}、输出约 ${prepared.estimatedUsage.outputTokens.toLocaleString()} 个词元；实际用量取决于模型与重试。跳过临时对话、已关闭记忆的对话及已遗忘内容。`;
                confirm.hidden = !prepared.turnCount; card.hidden=false; preview.hidden=true;
            } catch { if (core.memoryIdentityCurrent(previewIdentity)) explanation.textContent = '统计失败，请检查连接后重试。'; }
            finally { busy = false; preview.disabled = false; }
        });
        async function change(input) {
            const token = core.memoryIdentity(); busy = true;
            for (const button of [preview, confirm, pause, cancel]) button.disabled = true;
            try { await core.memoryRequest('/backfill', { method: 'POST', body: input }); if (!core.memoryIdentityCurrent(token)) return;
                confirm.hidden = true; card.hidden=true; preview.hidden=false; explanation.textContent = ''; prepared = null;
            } catch { if (core.memoryIdentityCurrent(token)) explanation.textContent = '操作未确认，请刷新核对进度后重试。'; }
            finally { busy = false; for (const button of [confirm, pause, cancel]) button.disabled = false; await refresh(); }
        }
        confirm.addEventListener('click', () => { if (prepared && core.memoryIdentityCurrent(identity)) void change({action:'start',previewId:prepared.previewId,confirm:true}); });
        pause.addEventListener('click', () => { if(job) void change({action:job.state==='paused'?'resume':'pause',jobId:job.id}); });
        cancel.addEventListener('click', () => { if(job) void change({action:'cancel',jobId:job.id}); });
        cancelPreview.addEventListener('click',()=>{prepared=null;card.hidden=true;preview.hidden=false;explanation.textContent='';preview.focus();});
        const tools = ui.element('details', 'memory-maintenance'); tools.dataset.motion = 'unfold';
        const summary = ui.element('summary', '', '整理过去的对话'), body = ui.element('div');
        actions.append(preview, pause, cancel); body.append(actions, card, progress); tools.append(summary, body); section.append(health, tools);
        const panelTools = ui.element('div', 'memory-tools'); panelTools.id = 'memory-panel-tools';
        panelTools.append(section); ui.byId('memory-list').after(panelTools);
        setInterval(() => { void refresh(); }, 3000);
        ui.byId('memory-refresh').addEventListener('click', () => { void refresh(); });
    }
    function mountMemory() {
        deviceCleanup=ui.element('section','memory-device-cleanup');deviceCleanup.hidden=true;deviceCleanup.setAttribute('aria-label','设备遗忘清理');deviceCleanup.setAttribute('role','status');
        const copy=ui.element('div');copy.append(ui.element('strong'),ui.element('p'));
        const retry=ui.element('button','button secondary small','检查状态');retry.type='button';retry.onclick=async()=>{retry.disabled=true;try{await readDeviceCleanup();}finally{retry.disabled=false;}};
        const devices=ui.element('button','button quiet small','查看设备');devices.type='button';devices.onclick=()=>ui.openSettings('devices');
        deviceCleanup.append(WeftIcons.create('sync',18),copy,retry,devices);ui.byId('memory-search-form').before(deviceCleanup);
        const refreshStatus=core.refreshMemoryStatus;core.refreshMemoryStatus=async(...args)=>{const result=await refreshStatus(...args);if(core.state.currentView==='memory')await readDeviceCleanup();return result;};
        mountIngestion();
        ui.byId('memory-view').classList.add('auxiliary-memory-page');
        const understanding = ui.element('h3', 'memory-understanding-title', '当前理解');
        ui.byId('memory-detail-text').before(understanding);
        ui.byId('memory-detail-body').querySelector('h3:not(.memory-understanding-title)').textContent = '原话与来源';
        const refreshButton = ui.byId('memory-refresh'); refreshButton.className = 'icon-button'; refreshButton.hidden = true;
        refreshButton.replaceChildren(WeftIcons.create('sync', 18)); refreshButton.setAttribute('aria-label', '刷新记忆'); refreshButton.title = '刷新记忆';
        const searchButton = ui.byId('memory-search-form').querySelector('button[type=submit]');
        if (searchButton) { searchButton.className = 'icon-button memory-search-submit'; searchButton.replaceChildren(WeftIcons.create('search', 18)); searchButton.setAttribute('aria-label', '搜索记忆'); ui.byId('memory-query').parentElement.append(searchButton); }
        const select=ui.byId('memory-kind'); select.prepend(new Option('全部','all')); select.value='all'; select.parentElement.hidden=true;
        const filters=ui.element('div','memory-type-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','记忆类型');
        for (const [kind,name] of [['all','全部'],...Object.entries(core.memoryKinds)]) { const button=ui.element('button','memory-type-filter',name); button.type='button';button.dataset.kind=kind;button.addEventListener('click',()=>{select.value=kind;select.dispatchEvent(new Event('change'));ui.syncMemoryFilters();});filters.append(button); }
        ui.syncMemoryFilters=()=>{for(const button of filters.children)button.setAttribute('aria-pressed',String(button.dataset.kind===select.value))};ui.syncMemoryFilters();
        ui.byId('memory-search-form').before(filters);
        ui.byId('memory-delete-action').textContent = '忘掉';
        ui.byId('rail-memory').addEventListener('click', () => { void core.openMemory(); });
        ui.byId('memory-back').addEventListener('click', () => { core.closeMemoryDetail(); void core.enterAssistant(); });
        ui.byId('memory-search-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const kind = ui.byId('memory-kind').value;
            const query = ui.byId('memory-query').value.trim().normalize('NFKC');
            if (!(core.memoryKinds[kind] || kind==='all') || query.length > 120)
                return ui.memoryStatus('请输入不超过 120 个字符的关键词。', true);
            core.setMemoryFilters(kind, query);
            void core.loadMemoryPage();
        });
        ui.byId('memory-kind').addEventListener('change', () => {
            const filters = ui.memoryFilterInput();
            core.setMemoryFilters(filters.kind, filters.query);
            if ((core.memoryKinds[core.memory.kind] || core.memory.kind==='all') && core.memory.query.length <= 120)
                void core.loadMemoryPage();
        });
        const exportTrigger=ui.element('button','button secondary small');exportTrigger.type='button';exportTrigger.setAttribute('aria-label','更多记忆操作');exportTrigger.append(WeftIcons.create('more',20));
        exportTrigger.addEventListener('click',()=>WeftPopover.menu(exportTrigger,[{name:'刷新',icon:'sync',action:()=>core.openMemory()},...['json','markdown'].map(format=>({name:`导出我的记忆 · ${format==='json'?'JSON':'Markdown'}`,icon:'download',action:()=>exportMemories(format)}))]));
        ui.byId('memory-refresh').after(exportTrigger);
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
