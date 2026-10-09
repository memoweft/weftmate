/* Desktop shell component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.shell = (core, ui) => {
    function paintConnection(online) {
        const badge = document.querySelector('.local-badge');
        badge.hidden = true;
        ui.byId('assistant-connection').hidden = true;
        ui.byId('connection-copy').textContent = online ? '已连接' : '连接中断，可稍后重试。';
        const banner = ui.byId('connection-banner');
        banner.hidden = online;
        banner.classList.toggle('is-offline', !online);
        banner.textContent = online ? '' : '连接中断，正在重试…';
    }
    function paintOperation(visibleMessage) {
        const output = ui.byId('operation-status');
        output.hidden = !visibleMessage;
        output.textContent = visibleMessage || '';
        ui.byId('reset-operation').hidden = core.state.reviewableRequests.size === 0;
    }
    function approvalModeReadFailed() {
        ui.byId('approval-mode-trigger').title = '无法读取审批模式，请重新打开对话';
    }
    function closeModelMenu(restoreFocus = false) {
        ui.byId('model-popover').hidden = true;
        ui.byId('model-trigger').setAttribute('aria-expanded', 'false');
        if (restoreFocus)
            ui.byId('model-trigger').focus();
    }
    function openModelMenu() {
        const trigger = ui.byId('model-trigger');
        if (trigger.disabled)
            return;
        if (!ui.byId('model-popover').hidden) {
            ui.closeModelMenu(true);
            return;
        }
        const list = ui.byId('model-options');
        list.replaceChildren();
        for (const model of core.state.models) {
            const selected = model.id === core.state.modelProfileId;
            const option = ui.element('button', `model-option${selected ? ' is-selected' : ''}`);
            option.type = 'button';
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(selected));
            option.tabIndex = selected ? 0 : -1;
            const icon = ui.element('span', 'model-option-icon');
            icon.append(window.WeftIcons.create('model', 16));
            icon.setAttribute('aria-hidden', 'true');
            const check = ui.element('span', 'model-option-check');
            check.append(window.WeftIcons.create('allow', 16));
            check.setAttribute('aria-hidden', 'true');
            option.append(icon, ui.element('span', 'model-option-name', model.name), check);
            option.addEventListener('click', () => {
                if (ui.byId('model-trigger').disabled || !core.state.models.some((item) => item.id === model.id))
                    return;
                core.selectModelProfile(model.id);
                ui.byId('model-select').value = model.id;
                ui.closeModelMenu(true);
                ui.updateAvailability();
            });
            list.append(option);
        }
        const popup = ui.byId('model-popover');
        popup.hidden = false;
        globalThis.WeftPopover?.position(popup, trigger);
        trigger.setAttribute('aria-expanded', 'true');
        const selected = [...list.children].find((item) => item.getAttribute('aria-selected') === 'true');
        const focusTarget = selected || list.children[0];
        focusTarget?.focus();
    }
    function stopVoiceInput() {
        if (ui.voiceInput) {
            const input = ui.voiceInput;
            ui.voiceInput = null;
            input.abort();
        }
        ui.byId('voice-input').classList.remove('is-recording');
        ui.byId('voice-input').setAttribute('aria-pressed', 'false');
        ui.byId('voice-input').setAttribute('aria-label', '语音输入');
    }
    function startVoiceInput() {
        if (ui.voiceInput) {
            ui.stopVoiceInput();
            return;
        }
        if (ui.byId('message-text').disabled)
            return;
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) {
            ui.toast('当前浏览器不支持语音输入');
            return;
        }
        const generation = core.state.identityGeneration, session = core.state.selectedSessionId;
        const source = core.state.activeChatSource, conversation = core.state.selectedPhoneConversationId;
        const input = new Recognition();
        ui.voiceInput = input;
        input.lang = 'zh-CN';
        input.interimResults = false;
        input.onresult = (event) => {
            if (ui.voiceInput !== input || generation !== core.state.identityGeneration || session !== core.state.selectedSessionId ||
                source !== core.state.activeChatSource || conversation !== core.state.selectedPhoneConversationId)
                return;
            const text = [...event.results].map((result) => result[0]?.transcript || '').join('');
            if (text) {
                const draft = ui.byId('message-text').value;
                ui.byId('message-text').value = `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${text}`;
                ui.updateAvailability();
            }
        };
        input.onerror = (event) => {
            if (ui.voiceInput === input && event.error !== 'aborted')
                ui.toast(event.error === 'not-allowed' ? '请允许浏览器使用麦克风后重试' : '语音输入未完成，请重试');
        };
        input.onend = () => {
            if (ui.voiceInput === input) {
                ui.voiceInput = null;
                ui.stopVoiceInput();
                ui.byId('message-text').focus();
            }
        };
        ui.byId('voice-input').classList.add('is-recording');
        ui.byId('voice-input').setAttribute('aria-pressed', 'true');
        ui.byId('voice-input').setAttribute('aria-label', '停止语音输入');
        try {
            input.start();
        }
        catch {
            ui.stopVoiceInput();
            ui.toast('无法开始语音输入，请重试');
        }
    }
    function takeSetupGrant() {
        const hash = window.location.hash;
        let grant = null;
        if (hash.startsWith('#setup=')) {
            try {
                grant = decodeURIComponent(hash.slice(7));
            }
            catch { /* Invalid grant remains unusable. */ }
        }
        if (hash.startsWith('#setup='))
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        return grant && /^[A-Za-z0-9_-]{16,256}$/.test(grant) ? grant : null;
    }
    function errorAt(id, message) {
        const element = ui.byId(id);
        element.textContent = message;
        element.hidden = !message;
    }
    function toast(message) {
        const element = ui.byId('toast');
        element.textContent = message;
        element.hidden = false;
        if (core.state.toastTimer)
            clearTimeout(core.state.toastTimer);
        core.state.toastTimer = setTimeout(() => { element.hidden = true; element.textContent = ''; }, 5000);
    }
    function clearPasswords(...ids) {
        for (const id of ids) {
            const input = ui.byId(id);
            input.value = '';
            input.type = 'password';
            const reveal = document.querySelector(`.reveal[data-target="${id}"]`);
            if (reveal) {
                reveal.textContent = '显示';
                reveal.setAttribute('aria-label', '显示密码');
            }
        }
    }
    function setBusy(form, busy) {
        for (const control of form.querySelectorAll('input, button'))
            control.disabled = busy;
    }
    function updateAvailability() {
        const value = core.composerState(ui.readMessageDraft());
        ui.byId('show-phone').hidden = true;
        ui.byId('rail-phone').hidden = true;
        ui.byId('chat-intro').hidden = value.phoneChat || ui.byId('transcript').children.length > 0;
        ui.byId('new-session').disabled = value.newSessionDisabled;
        ui.byId('model-select').disabled = value.modelDisabled;
        ui.byId('model-trigger').disabled = value.modelDisabled;
        ui.byId('model-label').textContent = value.modelName;
        if (value.modelDisabled)
            ui.closeModelMenu();
        ui.byId('message-text').disabled = value.messageDisabled;
        ui.byId('voice-input').disabled = value.voiceDisabled;
        ui.byId('message-attachments').disabled = value.attachmentsDisabled;
        ui.byId('attachment-add').hidden = value.phoneChat;
        ui.byId('attachment-add').classList.toggle('is-disabled', value.attachmentsDisabled);
        ui.byId('attachment-add').setAttribute('aria-disabled', String(value.attachmentsDisabled));
        ui.byId('attachment-cancel').hidden = !value.attachmentBusy;
        ui.byId('attachment-cancel').disabled = !value.attachmentBusy;
        ui.byId('open-notepad').textContent = value.desktopText;
        ui.byId('open-notepad').disabled = value.desktopDisabled;
        const send = ui.byId('send-message');
        const stop = value.running && !ui.readMessageDraft().trim() && !core.currentAttachmentDrafts().length;
        globalThis.WeftMotion?.changed(send, String(stop), '160ms');
        send.disabled = stop ? value.cancelDisabled : value.sendDisabled;
        send.classList.toggle('is-stop', stop);
        send.dataset.action = stop ? 'stop' : 'send';
        send.setAttribute('aria-label', stop ? '停止回复' : '发送');
        send.title = stop ? '停止回复 · Esc' : '发送 · Enter；排队 · Ctrl/Cmd+Enter';
        send.replaceChildren(window.WeftIcons.create(stop ? 'stop' : 'send', 20));
        ui.renderContextUsage();
        ui.renderOptimisticMessages();
        ui.byId('model-hint').textContent = value.hint;
        ui.byId('model-hint').setAttribute('role', 'status');
        ui.byId('model-hint').hidden = !value.hint || value.running || !ui.byId('approval-bar').hidden;
        ui.renderTimeline();
    }
    function startAssistantRefresh() {
        core.stopAssistantRefresh();
        core.state.refreshTimer = setInterval(() => {
            if (document.visibilityState === 'visible')
                void core.refreshAssistant();
        }, 6000);
    }
    function showRegistration() {
        ui.byId('setup-title').textContent = core.state.setupGrant ? '设置这台电脑的原账户' : '注册新账户';
        ui.byId('setup-intro').textContent = core.state.setupGrant
            ? '这份本机设置链接只可使用一次。旧会话与资料仍归原账户。'
            : '每个人使用自己的账户和设备，资料与对话分别保存。';
        core.show('setup');
    }
    function cancelCloudLogin() {
        ui.cloudUi?.cancel();
    }
    function resetAccountControls() {
        ui.byId('pending-device-list').replaceChildren();
        ui.byId('pending-devices').hidden = true;
        ui.byId('pending-device-badge').hidden = true;
        ui.byId('profile-display-name').value = '';
        ui.byId('profile-avatar-file').value = '';
        ui.byId('profile-avatar-image').removeAttribute?.('src');
        ui.byId('profile-avatar-image').hidden = true;
        ui.byId('profile-avatar-placeholder').hidden = false;
        ui.byId('profile-avatar-status').textContent = '支持 PNG、JPEG 或 WebP，最多 128 KiB。选择后先预览，再保存。';
        ui.byId('profile-status').textContent = '';
        ui.errorAt('profile-error', '');
        ui.errorAt('revoke-error', '');
        ui.byId('profile-reload').hidden = true;
        ui.byId('logout-button').disabled = false;
        ui.setBusy(ui.byId('password-form'), false);
        ui.byId('revoke-confirm').disabled = false;
    }
    function resetIdentityControls() {
        ui.byId('account-name').textContent = '';
        ui.byId('rail-account-name').textContent = '我的账户';
        ui.byId('rail-avatar-image').removeAttribute('src');
        ui.byId('rail-avatar-image').hidden = true;
        ui.byId('rail-avatar-initial').textContent = 'W';
        ui.byId('rail-avatar-initial').hidden = false;
        ui.byId('session-search').value = '';
        ui.byId('device-list').replaceChildren();
        if (ui.byId('password-dialog').open)
            ui.byId('password-dialog').close();
        if (ui.byId('revoke-dialog').open)
            ui.byId('revoke-dialog').close();
    }
    function resetConversationControls() {
        ui.byId('timeline-status').textContent = '';
        ui.byId('approval-bar').hidden = true; ui.byId('approval-bar').replaceChildren(); delete ui.byId('approval-bar').dataset.signature;
        ui.byId('transcript').replaceChildren();
        ui.byId('session-list').replaceChildren();
        ui.byId('assistant-title').textContent = '新对话';
        ui.byId('projects-list').replaceChildren();
        ui.byId('project-register-form').hidden = true;
        ui.byId('browser-workspace-form').hidden = true;
        ui.byId('phone-conversations').replaceChildren();
        ui.byId('phone-history').replaceChildren();
        ui.byId('phone-pane').hidden = true;
        ui.resetOtherDeviceInstall();
        ui.byId('message-text').value = '';
        ui.byId('message-attachments').value = '';
    }
    function closeAccountMenu() {
        ui.byId('account-menu').hidden = true;
    }
    function stopCloudPairing() {
        ui.cloudUi?.stopPairing();
        ui.stopAccountPairing?.();
    }
    function paintScreen(view) {
        for (const name of ui.views)
            ui.byId(`${name}-view`).hidden = name !== view && !(['account', 'memory'].includes(view) && name === 'assistant') && !(view === 'memory' && name === 'account');
        if (ui.motionView !== view) globalThis.WeftMotion?.reveal(ui.byId(`${view}-view`), 'base');
        ui.motionView = view;
        document.body.classList.toggle('assistant-active', ['assistant', 'account', 'memory'].includes(view));
        if (view === 'account' || view === 'memory') {
            ui.showSettingsDialog?.(); ui.byId('assistant-view').setAttribute('aria-hidden', 'true');
        } else {
            ui.byId('assistant-view').setAttribute('aria-hidden', 'false'); ui.hideSettingsDialog?.();
        }
        document.body.classList.toggle('cloud-auth-active', view === 'login' || view === 'cloud-wait');
    }
    function mountShell() {
        ui.byId('account-menu-trigger').setAttribute('aria-label', '账户菜单');
        core.state.setupGrant = ui.takeSetupGrant();
        ui.byId('account-back').addEventListener('click', () => { ui.resetProfileDraft(); core.state.deviceEditing = null; void core.enterAssistant(); });
        ui.byId('rail-account').addEventListener('click', core.openAccount);
        ui.byId('show-account').addEventListener('click', core.openAccount);
        ui.byId('rail-open').addEventListener('click', () => {
            if (window.WeftDesktop && !window.matchMedia?.('(max-width: 640px)').matches) {
                window.WeftDesktop.toggleRail();
                return;
            }
            window.WeftDesktop?.toggleRail(false);
            ui.byId('session-rail').classList.add('is-open');
            ui.byId('rail-backdrop').hidden = false;
            ui.byId('rail-open').setAttribute('aria-expanded', 'true');
        });
        ui.byId('chat-scroll').addEventListener('scroll', () => {
            if (!ui.conversationScroll?.pinned && ui.byId('chat-scroll').scrollTop < 40)
                void core.loadOlderHistory();
        });
        ui.byId('rail-close').addEventListener('click', () => { ui.closeRail(); window.WeftDesktop?.toggleRail(true); });
        ui.byId('rail-backdrop').addEventListener('click', ui.closeRail);
        window.WeftDesktop?.init({ renderSessions: ui.renderSessions, openAccount: core.openAccount, sendDraft: core.sendDraft, addFiles: core.addAttachmentFiles,
            stop: core.stopCurrentTurn, isAssistant: () => core.state.currentView === 'assistant', resources: core.loadConversationResources, openResource: ui.openConversationResource });
        if (window.WeftDesktop)
            setInterval(() => {
                if (core.state.currentView === 'assistant' && core.state.turnStatus === 'running')
                    ui.renderTurnStatus();
            }, 1000);
        ui.byId('open-notepad').addEventListener('click', async () => {
            const blocker = core.desktopBlocker();
            if (blocker) {
                ui.showConversation();
                if (blocker.commandId && !core.state.tasks.some((item) => item.commandId === blocker.commandId)) {
                    try {
                        const payload = await core.readCommand(blocker.commandId);
                        if (payload.command) {
                            core.state.tasks.unshift(payload.command);
                            ui.renderConversationTasks();
                            ui.updateAvailability();
                        }
                    }
                    catch { /* The task pane can still show its cached record or refresh state. */ }
                }
                return;
            }
            if (core.state.capabilities?.desktopOpenApp?.available !== true ||
                !core.state.capabilities.desktopOpenApp.appIds?.includes('notepad'))
                return;
            await core.submitCommand('desktop.open_app', { appId: 'notepad' });
        });
        ui.byId('reset-operation').addEventListener('click', () => {
            const requestId = core.state.reviewRequestId;
            if (!requestId)
                return;
            if (requestId)
                core.forgetMarker(requestId);
            ui.byId('message-text').value = '';
            core.operation('请先核对原请求，再重新输入你的目标。', false, requestId);
            ui.updateAvailability();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !ui.byId('assistant-view').hidden)
                void core.refreshAssistant();
            else if (document.visibilityState === 'visible' && !ui.byId('memory-view').hidden)
                void core.openMemory();
        });
        window.addEventListener('online', () => {
            if (!ui.byId('assistant-view').hidden)
                void core.refreshAssistant();
        });
        window.addEventListener('hashchange', () => {
            const grant = ui.takeSetupGrant();
            if (grant) {
                core.state.setupGrant = grant;
                void core.load();
            }
        });
        globalThis.WeftDesktopUI?.init({ error: ui.toast, openConversation: async (sessionId) => {
                await core.enterAssistant();
                await core.refreshSessions();
                await core.selectSession(sessionId);
            } });
        void core.load();
        setInterval(() => {
            if (core.state.account && document.visibilityState === 'visible')
                void core.refreshPendingDevices();
        }, 15000);
    }
    return { paintConnection, paintOperation, approvalModeReadFailed, closeModelMenu, openModelMenu, stopVoiceInput, startVoiceInput, takeSetupGrant, errorAt, toast, clearPasswords, setBusy, updateAvailability, startAssistantRefresh, showRegistration, cancelCloudLogin, resetAccountControls, resetIdentityControls, resetConversationControls, closeAccountMenu, stopCloudPairing, paintScreen, mountShell };
};
