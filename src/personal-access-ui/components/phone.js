/* Desktop phone component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.phone = (core, ui) => {
    function closePhoneImagePreview() {
        if (!ui.phonePreview)
            return;
        const button = ui.phonePreview.returnFocus;
        const scope = ui.phonePreview.scope;
        ui.phonePreview.returnFocus = null;
        ui.phonePreview.scope = null;
        if (ui.phonePreview.dialog.open)
            ui.phonePreview.dialog.close();
        ui.phonePreview.dialog.hidden = true;
        ui.phonePreview.image.removeAttribute('src');
        ui.phonePreview.image.alt = '';
        if (button && button.isConnected !== false && scope?.ownerId === core.state.ownerId &&
            scope.identityGeneration === core.state.identityGeneration &&
            scope.source === core.state.activeChatSource && scope.conversationId ===
            (scope.source === 'phone' ? core.state.selectedPhoneConversationId : core.state.selectedSessionId))
            button.focus();
    }
    function ensurePhoneImagePreview() {
        if (ui.phonePreview)
            return ui.phonePreview;
        const dialog = ui.element('dialog', 'phone-image-preview');
        dialog.id = 'phone-image-preview';
        dialog.hidden = true;
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', '图片预览');
        const image = ui.element('img');
        const close = ui.element('button', 'phone-image-close');
        close.append(window.WeftIcons.create('deny', 20));
        close.type = 'button';
        close.setAttribute('aria-label', '关闭图片预览');
        close.addEventListener('click', ui.closePhoneImagePreview);
        dialog.append(image, close);
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog)
                ui.closePhoneImagePreview();
        });
        dialog.addEventListener('cancel', (event) => { event.preventDefault(); ui.closePhoneImagePreview(); });
        dialog.addEventListener('close', ui.closePhoneImagePreview);
        document.body.append(dialog);
        ui.phonePreview = { dialog, image, close, returnFocus: null, scope: null };
        return ui.phonePreview;
    }
    function openPhoneImagePreview(url, name, button, scope) {
        if (!scope || scope.ownerId !== core.state.ownerId || scope.identityGeneration !== core.state.identityGeneration ||
            scope.source !== core.state.activeChatSource || scope.conversationId !==
            (scope.source === 'phone' ? core.state.selectedPhoneConversationId : core.state.selectedSessionId))
            return;
        if (window.WeftDesktop) {
            window.WeftDesktop.showImage(url, name, button);
            return;
        }
        const preview = ui.ensurePhoneImagePreview();
        preview.returnFocus = button;
        preview.scope = scope;
        preview.image.src = url;
        preview.image.alt = name;
        preview.dialog.hidden = false;
        preview.dialog.showModal();
        preview.close.focus();
    }
    function phoneHandoffControls(list, record, view) {
        const row = ui.element('li', 'phone-handoff');
        const binding = core.phoneBinding(record.id);
        if (binding) {
            const model = core.state.models.find((item) => item.id === binding.modelProfileId);
            row.append(ui.element('strong', '', '这条对话已在电脑继续'), ui.element('span', '', `当前由${model?.name || '所选电脑模型'}处理。此前手机文字与图片保留在下方。`));
            const linkedTask = core.state.tasks.find((item) => item?.conversationId === record.id &&
                core.sessionIdPattern.test(item.taskId || item.commandId || ''));
            if (linkedTask) {
                const task = ui.element('button', '', '查看这段的事情与成果');
                row.append(task);
            }
        }
        else if (view?.status === 'creating' || view?.status === 'uncertain') {
            row.append(ui.element('strong', '', '正在核对电脑交接'), ui.element('span', '', '保留原请求编号，核对完成前不会创建第二段会话。'));
            const check = ui.element('button', '', '检查状态');
            check.addEventListener('click', () => { void core.refreshPhoneBinding(record.id); });
            row.append(check);
        }
        else if (view?.canAdopt === true && core.state.models.length) {
            row.append(ui.element('strong', '', '在电脑继续这条对话'));
            const original = view.originalModel;
            const matches = core.matchingOriginalPhoneModels(view, core.state.models);
            const modelLabel = typeof original?.displayName === 'string' ? original.displayName : '原手机模型';
            row.append(ui.element('span', '', !original
                ? '旧记录没有可核对的原模型身份。请在下方明确选择已配置的电脑模型；手机消息与图片仍保留。'
                : matches.length === 1
                    ? `手机原用：${modelLabel}。已找到同一电脑配置并优先选中；手机消息与图片仍保留。`
                    : matches.length > 1
                        ? `手机原用：${modelLabel}。找到多个可核对的相同配置，请明确选其中一个。`
                        : `手机原用：${modelLabel}。电脑模型目录尚无可核对的同一配置；此页不能添加模型密钥。请先在电脑主程序核对配置，再刷新目录，或明确选择另一模型。`));
            const label = ui.element('label', '', '电脑模型');
            const select = ui.element('select');
            const placeholder = ui.element('option', '', '请选择电脑模型');
            placeholder.value = '';
            select.append(placeholder);
            for (const model of core.state.models) {
                const option = ui.element('option', '', model.name);
                option.value = model.id;
                select.append(option);
            }
            let pending;
            try {
                pending = JSON.parse(localStorage.getItem(core.phoneHandoffKey(record.id)) || 'null');
            }
            catch {
                pending = null;
            }
            const manual = core.state.phoneHandoffSelections.get(record.id);
            select.value = core.state.phoneHandoffSelections.has(record.id)
                ? core.state.models.some((model) => model.id === manual) ? manual : ''
                : pending?.modelProfileId
                    ? core.state.models.some((model) => model.id === pending.modelProfileId) ? pending.modelProfileId : ''
                    : matches.length === 1 ? matches[0].id : '';
            label.append(select);
            const start = ui.element('button', '', core.state.phoneHandoffBusy ? '正在核对…' : '在电脑继续');
            start.disabled = core.state.phoneHandoffBusy || !select.value;
            select.addEventListener('change', () => {
                core.state.phoneHandoffSelections.set(record.id, select.value);
                start.disabled = core.state.phoneHandoffBusy || !select.value;
            });
            start.addEventListener('click', () => { void core.adoptPhoneConversation(record.id, select.value); });
            const refresh = ui.element('button', 'secondary', '刷新电脑模型目录');
            refresh.addEventListener('click', () => { void core.refreshModels().then(() => core.refreshPhoneBinding(record.id)); });
            row.append(label, start, refresh);
        }
        else {
            row.append(ui.element('strong', '', view?.canAdopt === true ? '电脑模型尚未配置' : '手机记录暂未准备好交接'), ui.element('span', '', view?.reasonCode === 'LOCAL_TURN_RUNNING' ? '等手机回复结束并同步后再试。'
                : view?.reasonCode === 'LOCAL_TURN_UNCONFIRMED' ? '手机回合状态待核对；原消息仍保留。'
                    : view?.reasonCode === 'SOURCE_DEVICE_UPGRADE_REQUIRED' ? '请先更新创建这条对话的手机应用。'
                        : view?.canAdopt === true ? `手机原用${view.originalModel?.displayName ? ` ${view.originalModel.displayName}` : '的模型'}；电脑目录没有已配置的可选模型。此页不能添加模型密钥，配置完成后刷新目录。`
                            : core.state.online ? '请先完成同步并配置可用的电脑模型。' : '重连电脑后可核对交接状态。'));
            if (view?.canAdopt === true) {
                const refresh = ui.element('button', 'secondary', '刷新电脑模型目录');
                refresh.addEventListener('click', () => { void core.refreshModels().then(() => core.refreshPhoneBinding(record.id)); });
                row.append(refresh);
            }
        }
        list.append(row);
    }
    function renderSelectedPhoneConversation() {
        if (core.state.activeChatSource !== 'phone' || core.state.phonePane)
            return;
        const record = core.phoneConversations().find((item) => item.id === core.state.selectedPhoneConversationId);
        if (!record) {
            ui.byId('transcript').replaceChildren();
            ui.byId('timeline-status').textContent = '这条手机对话尚未同步完成。';
            return;
        }
        ui.byId('assistant-title').textContent = core.phoneDisplayTitle(record);
        const list = ui.byId('transcript');
        list.replaceChildren();
        const previewScope = { ownerId: core.state.ownerId, identityGeneration: core.state.identityGeneration,
            source: 'phone', conversationId: core.state.selectedPhoneConversationId };
        const view = core.state.phoneBindings.get(record.id);
        const appendPhoneMessage = (event, receiptId = null) => {
            if (event.kind !== 'message.created' || !['user', 'assistant'].includes(event.payload?.role))
                return;
            const row = ui.element('li', `message ${event.payload.role}`);
            if (event.payload.role === 'user' && core.receiptIdPattern.test(receiptId || ''))
                row.dataset.receiptId = receiptId;
            row.dataset.seq = String(event.seq);
            row.append(ui.element('span', 'message-label', event.payload.role === 'user'
                ? event.sourceDeviceId === core.state.device?.id ? '你 · 电脑同步' : '你 · 手机 MiMo'
                : 'WeftMate · 手机 MiMo'));
            const display = core.phoneMessageText(event.payload.text);
            if (display.text)
                row.append(event.payload.role === 'assistant' && window.WeftDesktop
                    ? window.WeftDesktop.markdown(display.text, 'message-text markdown-body') : ui.element('span', 'message-text', display.text));
            const attachments = Array.isArray(event.payload.attachments) ? event.payload.attachments : [];
            const gallery = ui.element('div', 'synced-image-gallery');
            for (const attachment of attachments) {
                if (!core.syncIdPattern.test(attachment?.attachmentId) ||
                    !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(attachment?.contentType))
                    continue;
                const name = typeof attachment.name === 'string' ? attachment.name.slice(0, 128) : '图片';
                const url = core.syncAttachmentUrl(attachment.attachmentId);
                const displayUrl = `${url}?variant=display`;
                const safeSize = Number.isSafeInteger(attachment.size) && attachment.size > 0 ? attachment.size : null;
                const smallLegacy = safeSize !== null && safeSize <= 5 * 1024 * 1024;
                const safeOriginal = safeSize !== null && safeSize <= 20 * 1024 * 1024;
                const button = ui.element('button', 'synced-image');
                button.type = 'button';
                button.setAttribute('aria-label', `查看图片 ${name}`);
                const image = ui.element('img');
                image.src = displayUrl;
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                image.addEventListener('error', () => {
                    if (smallLegacy && image.src === displayUrl) {
                        image.src = url;
                        return;
                    }
                    image.hidden = true;
                    button.classList.add('is-unavailable');
                    button.disabled = true;
                });
                button.append(image);
                button.addEventListener('click', () => ui.openPhoneImagePreview(safeOriginal ? url : displayUrl, name, button, previewScope));
                gallery.append(button);
            }
            if (gallery.children.length) {
                row.classList.add('message-has-images');
                if (!display.text && !core.legacyFileNames(display.legacy))
                    row.classList.add('message-image-only');
                row.append(gallery);
            }
            const files = core.legacyFileNames(display.legacy);
            if (files)
                row.append(ui.element('small', 'truncated', `旧附件：${files}。`));
            list.append(row);
        };
        const binding = core.phoneBinding(record.id);
        if (!binding) {
            for (const event of record.events)
                appendPhoneMessage(event);
        }
        else {
            const cutover = binding.cutoverSyncSeq;
            for (const event of record.events)
                if (event.seq <= cutover)
                    appendPhoneMessage(event);
            const section = ui.element('li', 'phone-handoff-divider', '从这里起，由电脑模型接着处理');
            list.append(section);
            const adopted = new Map((Array.isArray(view?.adoptedMessages) ? view.adoptedMessages : [])
                .filter((item) => item?.state === 'accepted_by_dsh' &&
                typeof item.receiptId === 'string' && core.syncIdPattern.test(item.sourceSyncEventId || ''))
                .map((item) => [item.receiptId, item.sourceSyncEventId]));
            const shownSync = new Set();
            for (const event of core.state.phoneHostEvents.get(record.id) || []) {
                if (event.type === 'user.message') {
                    const exactId = adopted.get(event.data?.receiptId);
                    const original = exactId && record.events.find((item) => item.eventId === exactId);
                    if (original) {
                        appendPhoneMessage(original, event.data?.receiptId);
                        shownSync.add(exactId);
                        continue;
                    }
                }
                if (!['user.message', 'assistant.message'].includes(event.type))
                    continue;
                const text = typeof event.data?.text === 'string' ? event.data.text : '';
                const images = Array.isArray(event.data?.images) ? event.data.images : [];
                if (!text && !images.length)
                    continue;
                const row = ui.element('li', `message ${event.type === 'user.message' ? 'user' : 'assistant'}`);
                if (event.type === 'user.message' && core.receiptIdPattern.test(event.data?.receiptId || ''))
                    row.dataset.receiptId = event.data.receiptId;
                row.dataset.seq = String(event.seq);
                row.append(ui.element('span', 'message-label', event.type === 'user.message'
                    ? '你 · 电脑续聊' : 'WeftMate · 电脑模型'));
                if (text)
                    row.append(event.type === 'assistant.message' && window.WeftDesktop
                        ? window.WeftDesktop.markdown(text, 'message-text markdown-body') : ui.element('span', 'message-text', text));
                for (const image of images) {
                    const url = /^sha256:[a-f0-9]{64}$/.test(image?.attachmentId || '') &&
                        ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image?.contentType)
                        ? core.sessionAttachmentUrl(binding.sessionId, image.attachmentId) : null;
                    if (!url)
                        continue;
                    const button = ui.element('button', 'synced-image', '查看电脑会话图片');
                    button.addEventListener('click', () => ui.openPhoneImagePreview(url, image.name || '电脑会话图片', button, previewScope));
                    row.append(button);
                }
                list.append(row);
            }
            const late = record.events.filter((event) => event.seq > cutover &&
                event.kind === 'message.created' && !shownSync.has(event.eventId));
            if (late.length)
                list.append(ui.element('li', 'phone-handoff-divider', '交接后才同步的手机记录 · 已保留，尚未自动并入电脑上下文'));
            for (const event of late)
                appendPhoneMessage(event);
        }
        ui.phoneHandoffControls(list, record, view);
        if (binding) {
            const cursor = core.state.phoneHistoryCursors.get(record.id);
            core.state.hasOlder = cursor?.hasOlder === true;
            core.state.nextBeforeSeq = cursor?.nextBeforeSeq;
            ui.renderOlderControl();
            ui.renderTimeline(core.state.phoneHostEvents.get(record.id) || []);
        }
        ui.renderConversationTasks();
        void core.refreshConversationTasks();
        ui.byId('timeline-status').textContent = core.state.phoneHasMore ? '仍有手机同步记录未读完，连接后会继续读取。' : '';
        ui.updateAvailability();
    }
    function renderPhoneRecords() {
        const records = core.phoneConversations();
        if (!records.some((record) => record.id === core.state.selectedPhoneConversationId)) {
            core.state.selectedPhoneConversationId = records[0]?.id ?? null;
        }
        const list = ui.byId('phone-conversations');
        list.replaceChildren();
        for (const record of records) {
            const item = ui.element('li');
            const button = ui.element('button', record.id === core.state.selectedPhoneConversationId ? 'is-current' : '');
            button.type = 'button';
            button.append(ui.element('strong', '', core.phoneDisplayTitle(record)), ui.element('small', '', [...record.sources].map(core.phoneSource).join('、')));
            button.addEventListener('click', () => { core.state.selectedPhoneConversationId = record.id; ui.renderPhoneRecords(); });
            item.append(button);
            list.append(item);
        }
        const history = ui.byId('phone-history');
        history.replaceChildren();
        const selected = records.find((record) => record.id === core.state.selectedPhoneConversationId);
        for (const event of selected?.events ?? []) {
            const source = core.phoneSource(event.sourceDeviceId);
            let label, content;
            if (event.kind === 'message.created' && typeof event.payload?.text === 'string') {
                label = event.payload.role === 'assistant' ? `${source} · 手机助手` : `${source} · 你`;
                content = event.payload.text;
            }
            else if (event.kind === 'turn.finished') {
                label = `${source} · 本地回合`;
                content = ({ completed: '已结束', cancelled: '已取消', failed: '失败', interrupted: '中断' })[event.payload?.status];
            }
            else if (event.kind === 'tool.receipt') {
                label = `${source} · 手机工具回执`;
                const status = ({ dispatched: '已派发，结果待核对', observed: '已观察到结果', failed: '失败',
                    uncertain: '结果待确认' })[event.payload?.status];
                content = status ? `${status}。${event.payload.summary ?? ''}` : null;
            }
            if (!content)
                continue;
            const row = ui.element('li', 'message');
            row.dataset.seq = String(event.seq);
            row.append(ui.element('span', 'message-label', label), ui.element('span', 'message-text', content));
            history.append(row);
        }
        ui.byId('phone-status').textContent = records.length ? '' : '还没有来自手机的同步记录。';
        ui.byId('phone-more').hidden = !core.state.phoneHasMore;
    }
    async function showPhonePane() {
        if (!core.state.syncAvailable)
            return;
        core.state.phonePane = true;
        ui.byId('conversation-pane').hidden = true;
        ui.byId('phone-pane').hidden = false;
        ui.byId('assistant-title').textContent = '手机来源';
        ui.closeRail();
        try {
            const payload = await core.readDevices();
            if (Array.isArray(payload.devices))
                core.state.phoneDeviceNames = new Map(payload.devices
                    .filter((device) => typeof device?.id === 'string' && typeof device.name === 'string')
                    .map((device) => [device.id, device.name]));
        }
        catch { /* The source ID remains bound on the server if names are temporarily unavailable. */ }
        ui.renderPhoneRecords();
        await core.refreshPhoneRecords();
    }
    function closeRail() {
        ui.byId('session-rail').classList.remove('is-open');
        ui.byId('rail-backdrop').hidden = true;
        ui.byId('rail-open').setAttribute('aria-expanded', 'false');
    }
    function setMessageDraft(text) {
        ui.byId('message-text').value = text;
    }
    function phoneRecordsNotice(message) {
        ui.byId('phone-status').textContent = message;
    }
    function mountPhone() {
        ui.byId('show-phone').addEventListener('click', () => { void ui.showPhonePane(); });
        ui.byId('rail-phone').addEventListener('click', () => { void ui.showPhonePane(); });
        ui.byId('phone-back').addEventListener('click', () => ui.showConversation());
        ui.byId('phone-refresh').addEventListener('click', () => { void core.refreshPhoneRecords(); });
        ui.byId('phone-more').addEventListener('click', () => { void core.refreshPhoneRecords(); });
    }
    function phoneComposerPresentation() {
        ui.byId('message-text').placeholder = '补充到这条手机对话';
        ui.byId('conversation-pane').classList.add('is-phone');
        ui.byId('chat-intro').hidden = true;
        ui.byId('desktop-action').hidden = true;
    }
    return { closePhoneImagePreview, ensurePhoneImagePreview, openPhoneImagePreview, phoneHandoffControls, renderSelectedPhoneConversation, renderPhoneRecords, showPhonePane, closeRail, setMessageDraft, phoneRecordsNotice, mountPhone, phoneComposerPresentation };
};
