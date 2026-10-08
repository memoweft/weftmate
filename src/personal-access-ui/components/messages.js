/* Desktop messages component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.messages = (core, ui) => {
    function clearHistoryView() {
        ui.byId('transcript').replaceChildren();
    }
    function historyNotice(message) {
        ui.byId('timeline-status').textContent = message;
    }
    function beginOlderHistory() {
        ui.olderPosition = { top: ui.byId('chat-scroll').scrollTop, height: ui.byId('chat-scroll').scrollHeight };
    }
    function restoreOlderHistoryPosition() {
        const scroll = ui.byId('chat-scroll');
        scroll.scrollTop = ui.olderPosition.top + scroll.scrollHeight - ui.olderPosition.height;
    }
    function scrollToLatest() {
        ui.byId('chat-scroll').scrollTop = ui.byId('chat-scroll').scrollHeight;
    }
    function paintHistoryMessages(events) {
        const list = ui.byId('transcript'), sessionId = core.state.selectedSessionId;
        for (const event of events) {
            if (!['user.message', 'assistant.message'].includes(event.type))
                continue;
            const images = event.type === 'user.message' && Array.isArray(event.data?.images) ? event.data.images : [];
            const files = event.type === 'user.message' && Array.isArray(event.data?.originalAttachments)
                ? event.data.originalAttachments.map(core.normalizedOriginalFile).filter(Boolean) : [];
            const originalImages = event.type === 'user.message' ? core.unpreviewedOriginalImages(event) : [];
            if (typeof event.data?.text !== 'string' && images.length === 0 && files.length === 0 && originalImages.length === 0)
                continue;
            const row = ui.element('li', `message ${event.type === 'user.message' ? 'user' : 'assistant'}`);
            if (event.type === 'user.message' && core.receiptIdPattern.test(event.data?.receiptId || ''))
                row.dataset.receiptId = event.data.receiptId;
            row.dataset.seq = String(event.seq);
            if (typeof event.data?.text === 'string' && event.data.text)
                row.append(event.type === 'assistant.message' && window.WeftDesktop
                    ? window.WeftDesktop.markdown(event.data.text, 'message-text markdown-body') : ui.element('span', 'message-text', event.data.text));
            if (images.length) {
                const gallery = ui.element('div', 'synced-image-gallery');
                const previewScope = { ownerId: core.state.ownerId, identityGeneration: core.state.identityGeneration,
                    source: 'desktop', conversationId: sessionId };
                let unavailable = 0;
                for (const image of images) {
                    if (!core.sessionIdPattern.test(sessionId) || !/^sha256:[a-f0-9]{64}$/.test(image?.attachmentId) ||
                        !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image?.contentType) ||
                        !Number.isSafeInteger(image?.size) || image.size < 1 || image.size > 5 * 1024 * 1024 ||
                        image?.sessionId !== undefined && image.sessionId !== sessionId) {
                        unavailable++;
                        continue;
                    }
                    const name = typeof image.name === 'string' && image.name.trim() ? image.name.slice(0, 128) : '图片';
                    const url = core.historyImageUrl(sessionId, image.attachmentId);
                    const button = ui.element('button', 'synced-image');
                    button.type = 'button';
                    button.setAttribute('aria-label', `查看原图 ${name}`);
                    const thumb = ui.element('img');
                    thumb.src = url;
                    thumb.alt = '';
                    thumb.loading = 'lazy';
                    thumb.decoding = 'async';
                    button.append(thumb);
                    button.addEventListener('click', () => ui.openPhoneImagePreview(url, name, button, previewScope));
                    gallery.append(button);
                }
                if (gallery.children.length) {
                    row.classList.add('message-has-images');
                    if (!event.data?.text)
                        row.classList.add('message-image-only');
                    row.append(gallery);
                }
                if (unavailable)
                    row.append(ui.element('small', 'truncated', `${unavailable} 张历史图片暂无法查看。`));
            }
            if (files.length)
                ui.appendOriginalFiles(row, event);
            if (originalImages.length)
                ui.appendUnpreviewedOriginalImages(row, originalImages);
            if (event.type === 'assistant.message')
                ui.appendReplyMemory(row, event);
            const taskLabel = core.messageTaskLabel(event);
            if (event.type === 'user.message' && taskLabel) row.append(ui.element('small', 'message-task-label', taskLabel));
            if (event.data.truncated === true)
                row.append(ui.element('span', 'truncated', '这条记录已截断，可在电脑查看完整来源。'));
            const next = [...list.children].find(n => Number(n.dataset.seq) > event.seq);
            if (next)
                list.insertBefore(row, next);
            else
                list.append(row);
        }
        ui.renderTimeline();
        ui.renderTurnStatus();
        ui.renderConversationTasks();
    }
    function appendOriginalFiles(row, event) {
        const files = (Array.isArray(event.data?.originalAttachments) ? event.data.originalAttachments : [])
            .map(core.normalizedOriginalFile).filter(Boolean);
        if (!files.length)
            return 0;
        const list = ui.element('div', 'synced-file-list');
        for (const file of files) {
            const link = ui.element('a', 'synced-file');
            link.href = core.syncAttachmentUrl(file.attachmentId);
            link.setAttribute('download', file.name);
            link.setAttribute('aria-label', `下载文件 ${file.name}`);
            link.append(ui.element('strong', '', file.name), ui.element('small', '', core.originalFileSize(file.size)), ui.element('span', '', '下载'));
            list.append(link);
        }
        row.append(list);
        return files.length;
    }
    function appendUnpreviewedOriginalImages(row, images) {
        if (!images.length)
            return 0;
        const list = ui.element('div', 'synced-image-original-list');
        for (const image of images) {
            const link = ui.element('a', 'synced-image-original');
            link.href = core.syncAttachmentUrl(image.attachmentId);
            link.setAttribute('download', image.name);
            link.setAttribute('aria-label', `下载图片原件，${core.originalFileSize(image.size)}`);
            link.append(ui.element('strong', '', '下载图片原件'), ui.element('small', '', core.originalFileSize(image.size)));
            list.append(link);
        }
        row.append(list);
        return images.length;
    }
    function appendReplyMemory(row, event) {
        const memories = Array.isArray(event.data?.memoryUsed) ? event.data.memoryUsed : [];
        if (!memories.length || !window.WeftDesktop)
            return;
        const button = ui.element('button', 'button quiet small reply-memory', `用到了 ${memories.length} 条记忆`);
        button.type = 'button';
        button.setAttribute('aria-label', `查看这条回复采用的 ${memories.length} 条记忆来源`);
        button.addEventListener('click', async () => {
            const context = core.conversationTaskContext();
            const target = window.WeftDesktop.openPreview('记忆来源', button, `reply-memory:${context.sessionId}:${event.seq}`, 'source');
            target.content.replaceChildren(ui.element('h2', '', '这条回复的记忆来源'));
            for (const item of memories) {
                const section = ui.element('section', 'reply-memory-source');
                section.append(ui.element('p', '', item.summary));
                const status = ui.element('p', 'muted', '正在读取来源…');
                section.append(status);
                target.content.append(section);
                try {
                    const data = await core.readMemorySources(item.kind, item.id);
                    if (!core.conversationTaskCurrent(context) || !target.content.isConnected)
                        return;
                    status.remove();
                    if (!data.sources?.length)
                        section.append(ui.element('p', 'muted', '当前没有可展示的来源。'));
                    for (const source of data.sources ?? []) {
                        section.append(ui.element('p', 'muted', source.recordedAt ? `记录于 ${core.formatDate(source.recordedAt)}` : '对话来源'));
                        section.append(ui.element('p', 'memory-source-text', source.contentAvailable
                            ? source.rawContent || source.summary || '此来源没有可显示的原文。' : '此来源已删除或当前不可读取。'));
                    }
                }
                catch {
                    if (core.conversationTaskCurrent(context) && target.content.isConnected) {
                        status.textContent = '来源暂时无法读取，请重新打开。';
                    }
                }
            }
        });
        row.append(button);
    }
    function renderTurnStatus() {
        const value = core.turnStatusViewModel();
        if (!value)
            return;
        const status = ui.byId('timeline-status');
        status.classList.toggle('is-running', value.isRunning);
        status.textContent = value.message;
    }
    function renderOlderControl() {
        const button = ui.byId('load-older');
        button.hidden = !core.state.hasOlder;
        button.disabled = core.state.olderLoading;
        button.textContent = core.state.olderLoading ? '正在读取…' : '加载更早内容';
    }
    return { clearHistoryView, historyNotice, beginOlderHistory, restoreOlderHistoryPosition, scrollToLatest, paintHistoryMessages, appendOriginalFiles, appendUnpreviewedOriginalImages, appendReplyMemory, renderTurnStatus, renderOlderControl };
};
