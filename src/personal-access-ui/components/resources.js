/* Desktop resources component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.resources = (core, ui) => {
    globalThis.WeftOpenCapturedSource = async (url, trigger) => {
        const context = core.conversationTaskContext();
        if (trigger?.getAttribute('aria-busy') === 'true') return true;
        const label = trigger?.textContent;
        if (trigger) { trigger.setAttribute('aria-busy', 'true'); trigger.replaceChildren(WeftControls.skeleton({rows:1,compact:true,tag:'span'})); }
        try {
            const source = await core.capturedSourceForUrl(url);
            if (!core.conversationTaskCurrent(context)) return true;
            if (!source) return false;
            if (source.name === source.url && label?.trim()) source.name = label.trim();
            ui.openConversationResource(source, trigger, true);
        } catch {
            if (core.conversationTaskCurrent(context)) ui.toast('暂时无法读取出处，请重试。');
        } finally {
            if (trigger) { trigger.removeAttribute('aria-busy'); trigger.textContent = label; }
        }
        return true;
    };
    function closeResourcePreview() {
        globalThis.WeftPanels?.update(ui.workspaceContext());
    }
    function removeResourcePreview() {
        if(globalThis.WeftPhoneUnify?.isPhone())globalThis.WeftPhoneFiles?.close(false);
        globalThis.WeftPanels?.update(ui.workspaceContext());
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
    async function openTimelinePreview(context, path, title, versions = [], target = null) {
        if (!core.conversationTaskCurrent(context))
            return;
        if (window.WeftDesktop) {
            const preview = target || window.WeftDesktop.openPreview(title, document.activeElement, path);
            const phone=globalThis.WeftPhoneUnify?.isPhone();
            const configurePhoneFile=artifact=>{if(!phone)return;const menu=preview.panel.querySelector('.phone-file-topbar button:last-child'),id=artifact?.artifactId||artifact?.id||String(path).match(/\/(?:artifacts|library)\/([^/]+)\/preview$/)?.[1];
                if(menu)WeftPhoneFiles.attach({menu,name:title,getBlob:id?()=>WeftPhoneFiles.readBlob(core.artifactDownloadUrl(id)):undefined,
                    library:id?()=>{WeftPhoneFiles.close(false);ui.openLibrary();}:undefined,
                    versions:versions.filter(version=>version.artifactId!==id).map(version=>({...version,open:()=>ui.openTimelinePreview(core.conversationTaskContext(),core.artifactPreviewPath(version.artifactId),version.fileName,version.versions||[])}))});};
            try {
                const data = await core.readResource(path);
                if (!core.conversationTaskCurrent(context) || !preview.content.isConnected)
                    return;
                if(data.kind){preview.content.replaceChildren();configurePhoneFile(data.item);WeftContent.preview(preview.content,data,{name:title,artifactId:data.item?.id,desktop:core.state.personalCapabilities?.libraryDesktopActions===1});return;}
                const text = data.text || data.preview?.text || data.source?.text || '暂时没有可预览内容';
                preview.content.replaceChildren();
                const artifact = data.artifact || data.preview?.artifact;
                configurePhoneFile(artifact);
                if (artifact?.artifactId&&!phone)
                    ui.appendResourceArtifactActions(preview.content, artifact);
                preview.content.append(window.WeftDesktop.markdown(text));
                if (versions.length&&!phone) {
                    const older = ui.element('details', 'resource-usage');
                    older.append(ui.element('summary', '', `旧版 · ${versions.length} 个`));
                    for (const artifact of versions) ui.appendTimelineArtifact(older, artifact, context);
                    preview.content.append(older);
                }
            }
            catch {
                if (core.conversationTaskCurrent(context) && preview.content.isConnected)
                    preview.content.textContent = '暂时无法读取。关闭后重试。';
            }
            return;
        }
        document.querySelector('.timeline-preview')?.remove();
        const panel = ui.element('aside', 'timeline-preview'), close = ui.element('button', 'button quiet small', '关闭预览'), text = ui.element('pre', 'timeline-raw'); text.append(WeftControls.skeleton({rows:1,compact:true,tag:'span'}));
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
    async function openMemorySource(memory,content,context) {
        const pending=ui.element('div');pending.append(WeftControls.skeleton({rows:2}));content.append(pending);
        try {
            const [detail,data]=await Promise.all([core.readMemoryItem(memory.kind,memory.id),core.readMemorySources(memory.kind,memory.id)]);
            if(!core.conversationTaskCurrent(context) || !content.isConnected)return;
            pending.remove();content.append(ui.element('p','',detail.item?.text ? `${detail.item.text}${detail.item.truncated?'\n（仅显示片段）':''}`:'记忆内容当前不可用。'));
            if(!data.sources?.length)content.append(ui.element('p','muted','当前没有可展示的来源。'));
            const seen=new Set();
            for(const source of data.sources || []) {
                const key=JSON.stringify([source.evidenceId,source.role || 'user',source.conversationId,source.messageId,
                    ...(source.evidenceId?[]:[source.recordedAt,source.rawContent,source.summary,source.contentAvailable])]);
                if(seen.has(key))continue;seen.add(key);
                content.append(ui.element('p','muted',source.recordedAt?`记录于 ${core.formatDate(source.recordedAt)}`:'对话来源'));
                content.append(ui.element('p','memory-source-text',source.contentAvailable ? source.rawContent || source.summary || '此来源没有可显示的原文。':'此来源已删除或当前不可读取。'));
            }
        } catch {if(core.conversationTaskCurrent(context) && pending.isConnected)pending.textContent='来源暂时无法读取，请重新打开。'}
    }
    function openConversationResource(item, trigger = document.activeElement, showExcerpt = false, previewTarget = null) {
        const context = core.conversationTaskContext();
        if (!core.conversationTaskCurrent(context))
            return;
        if (item.artifact) {
            return ui.openTimelinePreview(context, core.artifactPreviewPath(item.artifact.artifactId), item.name, item.versions, previewTarget);
        }
        const target = previewTarget || window.WeftDesktop.openPreview(item.name, trigger, item.key, item.kind);
        target.content.replaceChildren(ui.element('h2', '', item.name), ui.element('p', 'muted', window.WeftDesktop.usageText(item)));
        if(item.memory)return openMemorySource(item.memory,target.content,context);
        if (item.location)
            target.content.append(ui.element('p', 'muted resource-location', item.location));
        if (item.url) {
            const address = ui.element('input');
            address.readOnly = true;
            address.value = item.url;
            address.setAttribute('aria-label', '网页地址');
            target.content.append(address);
        }
        for (const use of item.uses || []) {
            const line = ui.element('details', 'resource-usage');
            const time = use.at && Number.isFinite(Date.parse(use.at)) ? core.dateText(use.at) : '';
            const summary = ui.element('summary', '', `${use.summary}${time ? ` · ${time}` : ''}`);
            const arrow = ui.element('span', 'progress-chevron'); arrow.setAttribute('aria-hidden', 'true');
            arrow.append(window.WeftIcons.create('chevron', 16)); summary.append(arrow); line.append(summary);
            line.addEventListener('toggle', async () => {
                if (!line.open || line.dataset.loaded || !core.conversationTaskCurrent(context))
                    return;
                line.dataset.loaded = 'loading';
                line.querySelector('pre')?.remove();
                const content = ui.element('pre', 'timeline-raw'); content.append(WeftControls.skeleton({rows:1,compact:true,tag:'span'}));
                content.tabIndex = 0;
                line.append(content);
                try {
                    const data = await core.readResource(use.path);
                    if (!core.conversationTaskCurrent(context) || !line.isConnected)
                        return;
                    const text = data.source?.text || data.text || '暂时没有可预览内容';
                    content.textContent = `${data.source ? text : item.kind === 'webpage' ? core.capturedSourceText(text) : core.executionDetailText(text)}${data.truncated || data.source?.truncated ? '\n[内容已截断]' : ''}`;
                    if (item.kind !== 'webpage' && !data.source && core.sourcePresentation(item.kind === 'tool' ? item.toolName || item.name : use.verb === '写入' ? 'write' : 'read', text).hasArguments) {
                        const presentation = core.sourcePresentation(item.kind === 'tool' ? item.toolName || item.name : item.kind === 'webpage' ? 'web_fetch' : use.verb === '写入' ? 'write' : 'read', text);
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
            if (showExcerpt && use === item.uses[0]) line.open = true;
        }
    }
    async function openFileChange(file, trigger) {
        const context=core.conversationTaskContext();
        if(globalThis.WeftPanels?.entries.some(entry=>entry.kind==='review') && globalThis.WeftWorkspacePanel) {
            WeftPanels.open('review',trigger);return;
        }
        const key=JSON.stringify([context.sessionId,file.path,file.steps.map(step=>[step.sessionId,step.detailRef.seq])]);
        const preview=WeftDesktop.openPreview(file.path.split(/[\\/]/).at(-1),trigger,`change:${key}`,'file');
        const render=async()=>{
            const ticket=Symbol();preview.content.changeLoad=ticket;
            const current=()=>core.conversationTaskCurrent(context) && preview.content.isConnected && preview.content.changeLoad===ticket;
            preview.content.textContent='正在读取改动…';
            try {
                const details=await Promise.all(file.steps.map(step=>core.readTimelineDetail(step.sessionId || context.sessionId,step.detailRef.seq)));
                if(!current())return;
                preview.content.replaceChildren();
                for(const detail of details) {
                    const hunks=(detail.fileDiffs || []).filter(diff=>diff.path===file.path);
                    for(const hunk of hunks) {
                        const section=ui.element('section','file-change-preview');
                        section.append(ui.element('h3','','改动前'),ui.element('pre','timeline-raw',hunk.oldText ?? '（空）'),ui.element('h3','','改动后'),ui.element('pre','timeline-raw',hunk.newText));preview.content.append(section);
                        if(hunk.truncated)section.append(ui.element('p','muted','内容较长，仅显示部分改动。'));
                    }
                }
                if(!preview.content.children.length)preview.content.append(ui.element('p','','这次改动的详情未记录。'));
            } catch {
                if(!current())return;
                const retry=ui.element('button','button secondary','重试');retry.type='button';retry.onclick=render;
                preview.content.replaceChildren(ui.element('p','','改动暂时无法读取。'),retry);
            }
        };
        await render();
    }
    function renderTimeline(events = core.timelineEventsForContext()) {
        if (!window.WeftTimeline)
            return;
        const context = core.conversationTaskContext(), sessionId = context.sessionId;
        window.WeftTimeline.render(events.filter(event => event.type !== 'task.queued'), ui.byId('transcript'), {
            processes:core.messageProcesses(WeftTimeline.prepare(events,core.state.personalization?.thinkingDisplay),core.optimisticMessages()),
            thinkingDisplay:core.state.personalization?.thinkingDisplay,
            stopViews: Object.fromEntries(events.filter(event => event.type === 'turn.started')
                .map(event => [`${sessionId}:turn-${event.data?.turn}`, core.taskStopView(event.data?.turn)]).filter(([, view]) => view)),
            waiting: core.state.turnStatus === 'running' ? core.processingStageLabel(core.state.sessions.find(row => row.sessionId === sessionId)?.processing) : '',
            executions:[...core.conversationTasks.entries.values()].flatMap(entry=>entry.payload?core.relatedExecutionSteps(entry.payload).map(row=>({...row,sessionId:entry.sessionId})):[]),
            artifacts: [...core.conversationTasks.entries.values()].flatMap(entry => entry.payload?.artifacts || []),
            approvals: [...core.conversationApprovals.entries.values()].filter(entry => entry.row.sessionId === sessionId).map(entry => entry.row),
            questions: [...core.conversationQuestions.entries.values()].filter(entry => entry.row.sessionId === sessionId).map(entry => entry.row),
            fileLabel: window.WeftDesktop?.fileLabel,
            mobile: window.matchMedia?.('(max-width: 640px)').matches === true,
            readDetail: seq => core.readTimelineDetail(sessionId, seq),
            readOutput:(seq,offset)=>core.readTimelineOutput(sessionId,seq,offset),
            openChange:openFileChange,
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
            readArtifact:id=>core.accessApi(`/library/${encodeURIComponent(id)}`),
                openAllArtifacts: () => ui.openLibrary(),
            onError: () => ui.toast('文件操作未完成，请重试。'),
            openArtifact: artifact => ui.openTimelinePreview(context, core.artifactPreviewPath(artifact.artifactId), artifact.fileName || '成果文件'),
            appendArtifactActions: (parent, artifact) => globalThis.WeftDesktopUI?.appendArtifactActions(parent, artifact, ui.toast),
            downloadArtifact: artifact => { const link = ui.element('a'); link.href = core.artifactDownloadUrl(artifact.artifactId); link.download = artifact.fileName || '成果文件'; link.click(); },
        });
    }
    function showConversation() {
        if (core.state.activeChatSource !== 'phone' && core.state.currentView === 'assistant' && !ui.byId('conversation-pane').hidden) { ui.closeRail(); return; }
        core.show('assistant');
        document.dispatchEvent(new CustomEvent('weftmate:fixed-page', { detail: 'conversation' }));
        core.state.phonePane = false;
        ui.byId('conversation-pane').hidden = false;
        ui.byId('phone-pane').hidden = true;
        ui.closeRail();
        if (core.state.activeChatSource === 'phone')
            ui.renderSelectedPhoneConversation();
    }
    if (globalThis.WeftPanels) Object.assign(WeftPanels.services, {
        workspaceRequest(ctx, action, body) {
            const route = `/workspaces/${encodeURIComponent(ctx.sessionId)}/${action}`;
            const options = body === undefined ? {} : { method: 'POST', body, protectedWrite: true };
            if (ctx.computerId && core.canUseComputerChannel?.()) return core.computerApi(ctx.computerId, route, options);
            if (ctx.computerId && ctx.computerId !== core.state.hostId) throw { code: 'COMPUTER_OFFLINE' };
            return core.accessApi(route, options);
        },
        resources: core.loadConversationResources,
        previewResource: (item, content) => openConversationResource(item, undefined, true, { content, panel: content }),
    });
    return { closeResourcePreview, removeResourcePreview, inlineTaskInfo, appendTimelineArtifact, openTimelinePreview, openFileChange, appendResourceArtifactActions, openConversationResource, renderTimeline, showConversation };
};
