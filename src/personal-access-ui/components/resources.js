/* Desktop resources component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.resources = (core, ui) => {
    function closeResourcePreview() {
        window.WeftDesktop?.closePreview(false);
    }
    function removeResourcePreview() {
        document.querySelector('.timeline-preview')?.remove();
    }
    function inlineTaskInfo(taskId, button) {
        const context = core.conversationTaskContext(), entry = core.conversationTasks.entries.get(taskId);
        if (!core.conversationTaskCurrent(context) || !entry?.payload)
            return;
        if (window.WeftDesktop) {
            void window.WeftDesktop.openCollection(null, button);
            return;
        }
        const card = button.closest('[data-conversation-task], [data-conversation-approval], [data-conversation-question]') || button.parentNode;
        const existing = card.querySelector('.timeline-task-info');
        if (existing) {
            existing.remove();
            return;
        }
        const payload = entry.payload, info = ui.element('section', 'timeline-task-info');
        info.append(ui.element('p', '', payload.sourceText || payload.source?.taskLabel || ''));
        for (const source of payload.sources || []) {
            const read = ui.element('button', 'button quiet small', `查看来源 ${source.relativePath || source.fileName || source.title || source.snapshotId}`);
            read.type = 'button';
            read.addEventListener('click', () => {
                void ui.openTimelinePreview(context, core.taskSourcePath(taskId, source.snapshotId), source.fileName || source.title || '读取的来源');
            });
            info.append(read);
        }
        for (const artifact of payload.artifacts || [])
            ui.appendTimelineArtifact(info, artifact, context);
        if (payload.control?.canStop) {
            const stop = ui.element('button', 'button secondary small', '请求停止这件事');
            stop.type = 'button';
            stop.addEventListener('click', async () => {
                if (!core.conversationTaskCurrent(context) || stop.disabled)
                    return;
                stop.disabled = true;
                entry.stopRequestId ||= crypto.randomUUID();
                try {
                    await core.stopTask(taskId, entry.stopRequestId);
                    if (core.conversationTaskCurrent(context)) {
                        stop.textContent = '停止请求已记录';
                        void core.refreshConversationTasks();
                    }
                }
                catch {
                    if (core.conversationTaskCurrent(context)) {
                        stop.textContent = '重试停止请求';
                        stop.disabled = false;
                    }
                }
            });
            info.append(stop);
        }
        card.append(info);
    }
    function appendTimelineArtifact(parent, artifact, context = core.conversationTaskContext()) {
        const line = ui.element('div', 'timeline-artifact'), open = ui.element('button', 'artifact-action', artifact.fileName || '打开成果');
        open.type = 'button';
        open.addEventListener('click', () => {
            void ui.openTimelinePreview(context, core.artifactPreviewPath(artifact.artifactId), artifact.fileName || '成果文件');
        });
        const download = ui.element('a', 'artifact-action', '下载');
        download.href = core.artifactDownloadUrl(artifact.artifactId);
        download.download = artifact.fileName || '成果文件';
        line.append(open, ui.element('small', '', window.WeftDesktop?.fileLabel(artifact) || `文件 · ${artifact.size || 0} 字节`), download);
        globalThis.WeftDesktopUI?.appendArtifactActions(line, artifact, ui.toast);
        parent.append(line);
    }
    async function openTimelinePreview(context, path, title, versions = []) {
        if (!core.conversationTaskCurrent(context))
            return;
        if (window.WeftDesktop) {
            const preview = window.WeftDesktop.openPreview(title, document.activeElement, path);
            try {
                const data = await core.readResource(path);
                if (!core.conversationTaskCurrent(context) || !preview.content.isConnected)
                    return;
                const text = data.text || data.preview?.text || data.source?.text || '暂时没有可预览内容';
                preview.content.replaceChildren();
                const artifact = data.artifact || data.preview?.artifact;
                if (artifact?.artifactId)
                    ui.appendResourceArtifactActions(preview.content, artifact);
                preview.content.append(window.WeftDesktop.markdown(text));
                if (versions.length) {
                    const older = ui.element('details', 'resource-usage');
                    older.append(ui.element('summary', '', `旧版 · ${versions.length} 个`));
                    for (const artifact of versions) ui.appendTimelineArtifact(older, artifact, context);
                    preview.content.append(older);
                }
            }
            catch {
                if (preview.content.isConnected)
                    preview.content.textContent = '暂时无法读取。关闭后重试。';
            }
            return;
        }
        document.querySelector('.timeline-preview')?.remove();
        const panel = ui.element('aside', 'timeline-preview'), close = ui.element('button', 'button quiet small', '关闭预览'), text = ui.element('pre', 'timeline-raw', '正在读取…');
        close.type = 'button';
        close.addEventListener('click', () => panel.remove());
        panel.append(close, ui.element('h2', '', title), text);
        ui.byId('conversation-pane').append(panel);
        try {
            const data = await core.readResource(path);
            if (!core.conversationTaskCurrent(context) || !panel.isConnected) {
                panel.remove();
                return;
            }
            text.textContent = data.text || data.preview?.text || data.source?.text || '暂时没有可预览内容';
        }
        catch {
            if (panel.isConnected)
                text.textContent = '暂时无法读取，请关闭后重试。';
        }
    }
    function appendResourceArtifactActions(parent, artifact) {
        const actions = ui.element('div', 'resource-actions'), download = ui.element('a', 'artifact-action', '下载');
        download.href = core.artifactDownloadUrl(artifact.artifactId);
        download.download = artifact.fileName || '成果文件';
        actions.append(download);
        globalThis.WeftDesktopUI?.appendArtifactActions(actions, artifact, ui.toast);
        parent.append(actions);
    }
    function openConversationResource(item, trigger = document.activeElement) {
        const context = core.conversationTaskContext();
        if (!core.conversationTaskCurrent(context))
            return;
        if (item.artifact) {
            void ui.openTimelinePreview(context, core.artifactPreviewPath(item.artifact.artifactId), item.name, item.versions);
            return;
        }
        const target = window.WeftDesktop.openPreview(item.name, trigger, item.key, item.kind);
        target.content.replaceChildren(ui.element('h2', '', item.name), ui.element('p', 'muted', window.WeftDesktop.usageText(item)));
        if (item.location)
            target.content.append(ui.element('p', 'muted resource-location', item.location));
        if (item.url) {
            const address = ui.element('input');
            address.readOnly = true;
            address.value = item.url;
            address.setAttribute('aria-label', '网页地址');
            target.content.append(address);
        }
        for (const use of item.uses) {
            const line = ui.element('details', 'resource-usage');
            const time = use.at && Number.isFinite(Date.parse(use.at)) ? new Date(use.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            line.append(ui.element('summary', '', `${use.summary}${time ? ` · ${time}` : ''}`));
            line.addEventListener('toggle', async () => {
                if (!line.open || line.dataset.loaded || !core.conversationTaskCurrent(context))
                    return;
                line.dataset.loaded = 'loading';
                line.querySelector('pre')?.remove();
                const content = ui.element('pre', 'timeline-raw', '正在读取…');
                content.tabIndex = 0;
                line.append(content);
                try {
                    const data = await core.readResource(use.path);
                    if (!core.conversationTaskCurrent(context) || !line.isConnected)
                        return;
                    const text = data.source?.text || data.text || '暂时没有可预览内容';
                    content.textContent = `${text}${data.truncated || data.source?.truncated ? '\n[内容已截断]' : ''}`;
                    if (!data.source && core.sourcePresentation(item.kind === 'tool' ? item.name : item.kind === 'webpage' ? 'web_fetch' : use.verb === '写入' ? 'write' : 'read', text).hasArguments) {
                        const presentation = core.sourcePresentation(item.kind === 'tool' ? item.name : item.kind === 'webpage' ? 'web_fetch' : use.verb === '写入' ? 'write' : 'read', text);
                        const raw = ui.element('details', 'resource-usage');
                        raw.append(ui.element('summary', '', '详情'), content);
                        line.append(ui.element('p', 'resource-tool-summary', presentation.summary), raw);
                    }
                    const copy = ui.element('button', 'timeline-action', '复制');
                    copy.type = 'button';
                    copy.addEventListener('click', async () => {
                        try {
                            await navigator.clipboard.writeText(content.textContent);
                            copy.textContent = '已复制';
                        }
                        catch {
                            copy.textContent = '请选择文字复制';
                        }
                    });
                    line.append(copy);
                    line.dataset.loaded = 'true';
                }
                catch {
                    if (line.isConnected) {
                        content.textContent = '暂时无法读取，收起后可重试。';
                        delete line.dataset.loaded;
                    }
                }
            });
            target.content.append(line);
        }
    }
    function renderTimeline(events = core.timelineEventsForContext()) {
        if (!window.WeftTimeline)
            return;
        const context = core.conversationTaskContext(), sessionId = context.sessionId;
        window.WeftTimeline.render(events.filter(event => event.type !== 'task.queued'), ui.byId('transcript'), {
            stopViews: Object.fromEntries(events.filter(event => event.type === 'turn.started')
                .map(event => [`turn-${event.data?.turn}`, core.taskStopView(event.data?.turn)]).filter(([, view]) => view)),
            waiting: core.state.turnStatus === 'running' ? core.processingStageLabel(core.state.sessions.find(row => row.sessionId === sessionId)?.processing) : '',
            artifacts: [...core.conversationTasks.entries.values()].flatMap(entry => entry.payload?.artifacts || []),
            approvals: [...core.conversationApprovals.entries.values()].filter(entry => entry.row.sessionId === sessionId).map(entry => entry.row),
            fileLabel: window.WeftDesktop?.fileLabel,
            mobile: window.matchMedia?.('(max-width: 640px)').matches === true,
            readDetail: seq => core.readTimelineDetail(sessionId, seq),
            openStep: async (step, trigger) => {
                try {
                    const items = await core.loadConversationResources();
                    if (!core.conversationTaskCurrent(context))
                        return;
                    window.WeftDesktop?.openCollection({ outputs: [], sources: items.sources.filter(item => item.uses.some(use => use.id === `${step.taskId}/${step.stepId}`)) }, trigger);
                }
                catch {
                    if (core.conversationTaskCurrent(context))
                        ui.toast('暂时无法读取来源，请重试。');
                }
            },
            openReference: async (key, trigger) => {
                try {
                    const items = await core.loadConversationResources();
                    if (!core.conversationTaskCurrent(context))
                        return;
                    const item = items.sources.find(item => item.key === key);
                    if (item)
                        ui.openConversationResource(item, trigger);
                }
                catch {
                    if (core.conversationTaskCurrent(context))
                        ui.toast('暂时无法读取来源，请重试。');
                }
            },
            openArtifact: artifact => ui.openTimelinePreview(context, core.artifactPreviewPath(artifact.artifactId), artifact.fileName || '成果文件'),
            appendArtifactActions: (parent, artifact) => globalThis.WeftDesktopUI?.appendArtifactActions(parent, artifact, ui.toast),
            downloadArtifact: artifact => { const link = ui.element('a'); link.href = core.artifactDownloadUrl(artifact.artifactId); link.download = artifact.fileName || '成果文件'; link.click(); },
        });
    }
    function showConversation() {
        core.state.phonePane = false;
        ui.byId('conversation-pane').hidden = false;
        ui.byId('phone-pane').hidden = true;
        ui.closeRail();
        if (core.state.activeChatSource === 'phone')
            ui.renderSelectedPhoneConversation();
    }
    return { closeResourcePreview, removeResourcePreview, inlineTaskInfo, appendTimelineArtifact, openTimelinePreview, appendResourceArtifactActions, openConversationResource, renderTimeline, showConversation };
};
