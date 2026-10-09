/* Desktop composer component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.composer = (core, ui) => {
    function closeComposerMenu(focus = false) {
        ui.byId('composer-menu').hidden = true;
        ui.byId('attachment-add').setAttribute('aria-expanded', 'false');
        if (focus) ui.byId('attachment-add').focus();
    }
    async function nativeImage(action) {
        const context = core.attachmentScope(), draftId = core.state.newConversationId;
        closeComposerMenu(true);
        try {
            const image = await action();
            if (!core.attachmentScopeCurrent(context) || draftId !== core.state.newConversationId) return;
            if (!image) { ui.toast('没有选择图片'); return; }
            const bytes = Uint8Array.from(atob(image.dataUrl.split(',')[1]), char => char.charCodeAt(0));
            const blob = new Blob([bytes], {type:image.contentType});
            if (core.attachmentScopeCurrent(context) && draftId === core.state.newConversationId)
                core.addAttachmentFiles([new File([blob], image.name, {type:image.contentType})]);
        } catch { ui.toast('图片未添加，请重试'); }
    }
    function openComposerMenu() {
        if (!ui.byId('composer-menu').hidden) return closeComposerMenu(true);
        if (ui.byId('message-attachments').disabled) return;
        ui.closeModelMenu();
        const menu = ui.byId('composer-menu'); menu.replaceChildren();
        const item = (name, icon, action, checked) => {
            const button = ui.element('button', 'model-option'); button.type = 'button';
            button.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
            button.append(window.WeftIcons.create(icon, 20), ui.element('span', '', name));
            if (checked !== undefined) { button.setAttribute('aria-checked', String(checked));
                if (checked) button.append(window.WeftIcons.create('allow', 16)); }
            button.addEventListener('click', action); menu.append(button); return button;
        };
        const pick = id => { closeComposerMenu(true); ui.byId(id).click(); };
        const native = globalThis.weftmateDesktop;
        const phone = !native && matchMedia('(pointer:coarse)').matches;
        if (phone) {
            item('相机', 'camera', () => pick('composer-camera'));
            item('照片', 'image', () => pick('composer-photos'));
        }
        item(phone ? '文件' : '添加文件', 'attach', () => pick('message-attachments'));
        if (native?.captureRegion) item('截图', 'camera', () => nativeImage(() => native.captureRegion()));
        if (native?.clipboardImage) item('粘贴剪贴板图片', 'image', () => nativeImage(() => native.clipboardImage()));
        else if (!phone && navigator.clipboard?.read) item('粘贴剪贴板图片', 'image', async () => {
            const context = core.conversationTaskContext(); closeComposerMenu(true);
            try { const images = [];
                for (const row of await navigator.clipboard.read()) for (const type of row.types.filter(type => type.startsWith('image/')))
                    images.push(new File([await row.getType(type)], '剪贴板图片.png', {type}));
                if (core.conversationTaskCurrent(context)) { if (images.length) core.addAttachmentFiles(images); else ui.toast('剪贴板中没有图片'); }
            } catch { ui.toast('无法读取剪贴板，请直接粘贴图片'); }
        });
        const thinking = core.thinkingView();
        if (thinking.supported) {
            const toggle = item('深入思考', 'model', async () => { closeComposerMenu(true); await core.setDeepThinking(!thinking.enabled); }, thinking.enabled);
            toggle.disabled = thinking.busy;
        }
        menu.hidden = false; ui.byId('attachment-add').setAttribute('aria-expanded', 'true');
        globalThis.WeftPopover.position(menu, ui.byId('attachment-add'));
        menu.querySelector('button')?.focus();
    }
    function paintComposerExtras(value) {
        const thinking = core.thinkingView();
        ui.byId('thinking-badge').hidden = !thinking.supported || !thinking.enabled;
        if (value.attachmentsDisabled) closeComposerMenu();
        globalThis.WeftComposerSubtasks?.paint(ui.byId('composer-subtasks'),
            globalThis.WeftUiCore.composerSubtasks([...core.state.historyEvents.values()]),
            {scope:`${core.state.ownerId}/${core.state.identityGeneration}/${core.state.selectedSessionId}`, root:ui.byId('transcript')});
    }
    function paintModels() {
        const select = ui.byId('model-select');
        select.replaceChildren();
        if (core.state.models.length === 0) {
            select.append(ui.element('option', '', '没有可用模型'));
        }
        else {
            for (const model of core.state.models) {
                const option = ui.element('option', '', model.name);
                option.value = model.id;
                select.append(option);
            }
            select.value = core.state.modelProfileId;
        }
    }
    function readMessageDraft() {
        return ui.byId('message-text').value;
    }
    function clearMessageDraft() {
        ui.byId('message-text').value = '';
    }
    function paintDesktopComposer(fromPhone) {
        ui.byId('conversation-pane').classList.remove('is-phone');
        if (fromPhone)
            ui.byId('message-text').value = core.state.desktopDraft;
        ui.byId('message-text').placeholder = '向 WeftMate 说说你的目标';
    }
    function mountComposer() {
        ui.byId('attachment-add').addEventListener('click', openComposerMenu);
        const menu = ui.byId('composer-menu');
        menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();closeComposerMenu(true);return;}
            const items = [...menu.querySelectorAll('button:not(:disabled)')];
            if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
            event.preventDefault(); const index = items.indexOf(document.activeElement);
            items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        });
        document.addEventListener('click', event => {if (!menu.contains(event.target) && !ui.byId('attachment-add').contains(event.target)) closeComposerMenu();});
        document.addEventListener('keydown', event => {if(event.key==='Escape'&&!menu.hidden){event.preventDefault();closeComposerMenu(true);}},true);
        for (const id of ['composer-camera','composer-photos']) ui.byId(id).addEventListener('change', event => {
            const files = [...event.target.files]; event.target.value = ''; core.addAttachmentFiles(files);
        });
        const context = ui.byId('context-usage');
        const tooltip = ui.byId('context-tooltip');
        const show = () => { tooltip.hidden = false; globalThis.WeftPopover.position(tooltip, context); };
        const hide = () => { tooltip.hidden = true; };
        context.addEventListener('mouseenter', show); context.addEventListener('mouseleave', hide);
        context.addEventListener('focus', show); context.addEventListener('blur', hide);
        context.addEventListener('click', show);
        document.addEventListener('click', event => { if (!context.contains(event.target)) hide(); });
        context.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); hide(); } });
        ui.byId('model-select').addEventListener('change', (event) => { core.state.modelProfileId = event.target.value; ui.updateAvailability(); });
        ui.byId('model-trigger').addEventListener('click', ui.openModelMenu);
        ui.byId('model-trigger').addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (ui.byId('model-popover').hidden)
                    ui.openModelMenu();
            }
        });
        ui.byId('model-options').addEventListener('keydown', (event) => {
            const options = [...ui.byId('model-options').children], index = options.indexOf(event.target);
            if (event.key === 'Escape') {
                event.preventDefault();
                ui.closeModelMenu(true);
                return;
            }
            if (!options.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
                return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            options[next].focus();
        });
        ui.byId('model-configure').addEventListener('click', () => { ui.closeModelMenu(); ui.openSettings("models"); });
        ui.byId('voice-input').addEventListener('click', ui.startVoiceInput);
        document.addEventListener('click', (event) => {
            if (!ui.byId('model-popover').hidden && !ui.byId('model-picker').contains(event.target))
                ui.closeModelMenu();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !ui.byId('model-popover').hidden) {
                event.preventDefault();
                ui.closeModelMenu(true);
            }
        });
        ui.byId('message-text').addEventListener('input', ui.updateAvailability);
        ui.byId('message-attachments').addEventListener('change', (event) => {
            const input = event.currentTarget, selected = [...(input.files || [])];
            input.value = '';
            core.addAttachmentFiles(selected);
        });
        ui.byId('attachment-cancel').addEventListener('click', () => core.cancelAttachmentUpload(true));
        ui.byId('new-temporary-session').addEventListener('click', () => {
            if (core.state.capabilities?.chat?.available === true) core.startNewConversation(true);
        });
        ui.byId('new-session').addEventListener('click', async () => {
            if (!core.state.modelProfileId || core.state.capabilities?.chat?.available !== true)
                return;
            ui.closeRail();
            core.startNewConversation();
        });
        ui.byId('message-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            if (event.submitter?.id === 'send-message' && ui.byId('send-message').dataset.action === 'stop')
                return core.stopCurrentTurn();
            return core.sendDraft();
        });
        ui.mountConversationScroll();
    }
    function renderContextUsage() {
        const session = core.state.sessions.find(row => row.sessionId === core.state.selectedSessionId);
        const value = globalThis.WeftUiCore.contextUsageView(session?.contextUsage);
        const button = ui.byId('context-usage');
        button.setAttribute('aria-label', value.label); button.classList.toggle('is-warning', value.warning);
        button.classList.toggle('is-indeterminate', value.ratio === null);
        const fill = button.querySelector('.context-fill');
        if (fill) fill.style.strokeDasharray = `${Math.min(1, Math.max(0, value.ratio || 0)) * 100} 100`;
        ui.byId('context-tooltip-label').textContent = value.label;
        ui.byId('context-tooltip-detail').textContent = value.detail;
    }
    return { paintComposerExtras, closeComposerMenu, renderContextUsage, paintModels, readMessageDraft, clearMessageDraft, paintDesktopComposer, mountComposer };
};
