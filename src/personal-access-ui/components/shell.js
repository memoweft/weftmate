/* Desktop shell component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.shell = (core, ui) => {
    function paintConnection(online) {
        const badge = document.querySelector('.local-badge');
        badge.hidden = true;
        ui.byId('assistant-connection').hidden = false;
        ui.byId('connection-copy').textContent = online ? '已连接' : '连接中断，可稍后重试。';
        const banner = ui.byId('connection-banner');
        banner.hidden = true;
        banner.classList.toggle('is-offline', !online);
        banner.textContent = online ? '' : '连接中断，正在重试…';
    }
    function paintOperation(visibleMessage) {
        const output = ui.byId('operation-status');
        output.hidden = !visibleMessage;
        output.textContent = visibleMessage || '';
    }
    function clearOperation() {
        ui.byId('operation-status').replaceChildren();
        ui.byId('operation-status').hidden = true;
    }
    function approvalModeReadFailed() {
        ui.byId('approval-mode-trigger').title = '无法读取审批模式，请重新打开对话';
    }
    let modelPicker;
    function getModelPicker() {
        return modelPicker ||= globalThis.WeftModelPicker.mount({
            trigger: ui.byId('model-trigger'), popup: ui.byId('model-popover'),
            view: () => {
                const value = core.modelServicesView();
                if (core.state.modelServices === undefined) {
                    value.services = [{ serviceId:'legacy',name:'模型',models:core.state.models.map(m => ({...m,modelId:m.id,profileId:m.id})) }];
                    value.selected = {serviceId:'legacy',modelId:core.state.modelProfileId};
                }
                return value;
            },
            select: async item => item.serviceId === 'legacy' ? core.selectModelProfile(item.profileId) : core.selectServiceModel(item),
            refresh: () => core.refreshModelServices(true),
            add: () => { ui.openSettings('models'); ui.openModelServiceEditor?.(); },
            thinking: () => core.thinkingView(), toggleThinking: value => core.setDeepThinking(value), toast: ui.toast,
        });
    }
    function updateModelPicker() { getModelPicker().update(); }
    function closeModelMenu(restoreFocus = false) {
        if (modelPicker) return modelPicker.close(restoreFocus);
        ui.byId('model-popover').hidden = true;
        ui.byId('model-trigger').setAttribute('aria-expanded', 'false');
        if (restoreFocus)
            ui.byId('model-trigger').focus();
    }
    function openModelMenu() {
        return getModelPicker().open();
    }
    function openLegacyModelMenu() {
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
        if (message && core.state.ownerId && ui.messageActions) {
            const feedback = ui.element('button', 'button secondary small', '反馈问题'); feedback.type = 'button';
            feedback.onclick = () => ui.messageActions.openFeedback(feedback); element.append(feedback);
        }
    }
    function toast(message, undo) {
        const element = ui.byId('toast');
        element.textContent = message;
        element.hidden = false;
        if (undo) {
            const button = ui.element('button', 'toast-undo', '撤销归档'); button.type = 'button';
            button.onclick = async () => { button.disabled = true; try { await undo(); element.hidden = true; }
                catch (error) { ui.toast(core.failureMessage(error)); } };
            element.append(button);
        }
        if (core.state.toastTimer)
            clearTimeout(core.state.toastTimer);
        core.state.toastTimer = setTimeout(() => { element.hidden = true; element.textContent = ''; }, undo ? 10000 : 5000);
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
        const operation = ui.byId('operation-status');
        ui.byId('reset-operation').hidden = operation.hidden || !operation.textContent || core.state.reviewableRequests.size === 0;
        globalThis.WeftPanels?.update(workspaceContext());
        ui.messageActions?.refresh();
        const value = core.composerState(ui.readMessageDraft());
        ui.renderConversationUsage?.();
        ui.byId('show-phone').hidden = true;
        ui.byId('rail-phone').hidden = true;
        ui.byId('chat-intro').hidden = value.phoneChat || [...ui.byId('transcript').children].some(row=>!row.classList.contains('chat-spacer'));
        ui.byId('new-session').disabled = value.newSessionDisabled;
        ui.byId('new-temporary-session').disabled = value.newSessionDisabled;
        if (value.phoneChat) {
            ui.byId('temporary-chat-notice')?.setAttribute('hidden', '');
            ui.byId('temporary-composer-hint')?.setAttribute('hidden', '');
        }
        ui.byId('model-select').disabled = value.modelDisabled;
        ui.byId('model-trigger').disabled = !core.state.account || core.state.activeChatSource === 'phone';
        WeftModelLabel(ui.byId('model-label'), value.modelName);
        ui.byId('model-trigger').setAttribute('aria-label', `模型：${core.modelServicesView?.().modelName || value.modelName}`);
        if (ui.byId('model-trigger').disabled)
            ui.closeModelMenu();
        ui.byId('message-text').disabled = value.messageDisabled;
        ui.byId('message-text').placeholder = value.placeholder;
        ui.paintComposerExtras?.(value);
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
        renderModelHint(value);
        ui.renderTimeline();
        for (const waiting of ui.byId('transcript').querySelectorAll('.inline-waiting .inline-progress-text')) {
            waiting.textContent = core.processingStageLabel(core.state.mainChat?.processing || core.state.sessions.find(row => row.sessionId === core.state.selectedSessionId)?.processing);
            waiting.classList.toggle('is-running', core.state.online);
        }
        WeftPopover.modelGate({missing:!!core.state.account && core.state.modelsKnown===true && !core.state.models.some(model=>model.configured!==false&&model.available!==false),
          field:ui.byId('message-text'),send,empty:!ui.byId('transcript').querySelector('.message'),content:ui.byId('chat-scroll'),composer:ui.byId('message-form').parentElement,openSettings:()=>ui.openSettings('models')});
        if (ui.byId('chat-scroll').classList.contains('needs-model-empty')) ui.byId('chat-intro').hidden=true;
    }
    function renderModelHint(value = core.composerState(ui.readMessageDraft())) {
        const hint=ui.byId('model-hint');
        hint.textContent=value.hint;
        hint.setAttribute('role','status');
        hint.hidden=!core.state.online || !value.hint || !ui.byId('approval-bar').hidden;
    }
    function startAssistantRefresh() {
        core.stopAssistantRefresh();
        core.startConnection(async () => {
            await core.refreshAssistant();
            await Promise.all([core.refreshHistory(), core.reconcileMainRequests(), core.refreshConversationTasks(), core.refreshConversationApprovals(), core.refreshConversationQuestions()]);
            await core.offlineConnectionRestored?.();
        });
        core.state.refreshTimer = setInterval(() => {
            if (document.visibilityState === 'visible' && core.foreground() && core.state.currentView === 'assistant')
                void core.refreshAssistantOverview();
        }, core.polling.overview);
        let lastLiveRead=0;
        let ownedLiveTimer;
        const readLive = () => {
            lastLiveRead = Date.now();
            void core.refreshLiveConversation().then(result => {
                // A normal long wait renews without an idle gap. The timer
                // identity prevents a stopped/replaced loop from renewing.
                if (result?.immediateRenew && ['changed','unchanged'].includes(result.kind) &&
                    core.state.liveRefreshTimer === ownedLiveTimer && core.foreground() &&
                    document.visibilityState === 'visible' && core.state.currentView === 'assistant') readLive();
            }).catch(() => {});
        };
        core.state.liveRefreshTimer = setInterval(() => {
            if (document.visibilityState === 'visible' && core.foreground() && core.historyReadAllowed() && core.state.currentView === 'assistant' && !ui.byId('conversation-pane').hidden && (core.state.personalCapabilities?.replyStreaming===1 && (core.mainReplyActive?.() || core.state.turnStatus==='running' || (core.state.selectedChatId||core.state.selectedSessionId)&&Date.now()-lastLiveRead>=core.polling.idle) || core.state.unresolvedSubmission ||
                core.state.submitting || core.conversationRunning(core.state.selectedSessionId) ||
                core.optimisticMessages().some(row => ['sending', 'accepted'].includes(row.status))))
                readLive();
        }, core.polling.stream);
        ownedLiveTimer = core.state.liveRefreshTimer;
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
        ui.byId('account-model-key').value = '';
        if (ui.byId('account-model-dialog')?.open) ui.byId('account-model-dialog').close();
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
        globalThis.WeftPanels?.reset();
        globalThis.WeftMotion?.resetIdentity();
        ui.byId('account-name').textContent = '';
        ui.byId('rail-account-name').textContent = '我的账户';
        ui.byId('rail-avatar-image').removeAttribute('src');
        ui.byId('rail-avatar-image').hidden = true;
        ui.byId('rail-avatar-initial').textContent = 'W';
        ui.byId('rail-avatar-initial').hidden = false;
        ui.byId('account-menu-name').textContent = '';
        ui.byId('account-menu-email').textContent = '';
        ui.byId('account-menu-usage').textContent = '';
        ui.byId('settings-usage-strip')?.replaceChildren();
        ui.byId('device-list').replaceChildren();
        if (ui.byId('password-dialog').open)
            ui.byId('password-dialog').close();
        if (ui.byId('revoke-dialog').open)
            ui.byId('revoke-dialog').close();
    }
    function resetConversationControls() {
        ui.byId('timeline-status').textContent = '';
        if (ui.byId('question-bar')) { ui.byId('question-bar').hidden = true; ui.byId('question-bar').replaceChildren(); delete ui.byId('question-bar').dataset.signature; }
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
    let accountHelp;
    function closeAccountMenu() {
        accountHelp?.close(false); accountHelp = null;
        globalThis.WeftPopover.hide(ui.byId('account-menu'));
        ui.byId('account-menu-trigger').setAttribute('aria-expanded', 'false');
    }
    function stopCloudPairing() {
        ui.cloudUi?.stopPairing();
        ui.stopAccountPairing?.();
    }
    function paintScreen(view) {
        void ui.checkCloudBackupPrompt?.();
        const wasMemory=ui.motionView==='memory';
        for (const name of ui.views)
            ui.byId(`${name}-view`).hidden = name !== view && !(['account', 'memory'].includes(view) && name === 'assistant');
        const retainedWorkspace=view==='assistant'&&['account','memory'].includes(ui.motionView);
        if (ui.motionView !== view&&!retainedWorkspace) globalThis.WeftMotion?.enter(ui.byId(`${view}-view`), view === 'account' || view === 'memory' ? 'enter-fade' : 'view-enter');
        ui.motionView = view;
        document.body.classList.toggle('assistant-active', ['assistant', 'account', 'memory'].includes(view));
        if (view === 'account') {
            ui.showSettingsDialog?.(); ui.byId('assistant-view').setAttribute('aria-hidden', 'true');
        } else {
            ui.byId('assistant-view').setAttribute('aria-hidden', 'false'); ui.hideSettingsDialog?.();
        }
        document.body.classList.toggle('memory-open',view==='memory');
        ui.byId('rail-memory').setAttribute('aria-current',view==='memory'?'page':'false');
        if(view==='memory'){
            document.dispatchEvent(new CustomEvent('weftmate:fixed-page',{detail:'memory'}));
            ui.byId('conversation-pane').hidden=true;ui.byId('assistant-title').textContent='记忆';
        }else if(wasMemory)ui.byId('conversation-pane').hidden=false;
        document.body.classList.toggle('cloud-auth-active', view === 'login' || view === 'cloud-wait');
    }
    let workspaceFolderKey, workspaceFolderPath;
    function workspaceContext() {
        const selected = core.state.sessions.find(row => row.sessionId === core.state.selectedSessionId);
        const project = core.currentFolderProject?.();
        const folderKey = `${core.state.identityGeneration}/${project?.projectId}/${project?.revision}`;
        if(folderKey !== workspaceFolderKey) {
            workspaceFolderKey = folderKey; workspaceFolderPath = project?.rootPath || null;
            if(project && globalThis.weftmateDesktop?.projectFolderInfo && !core.remoteComputerSelected?.())
                void globalThis.weftmateDesktop.projectFolderInfo(project.projectId).then(info => {
                    if(folderKey === workspaceFolderKey) {workspaceFolderPath=info?.rootPath || null;globalThis.WeftPanels.update(workspaceContext());}
                }).catch(()=>{});
        }
        return { ownerId: core.state.ownerId, identityGeneration: core.state.identityGeneration,
            conversationId: core.state.newConversation ? `draft:${core.state.newConversationId}` : core.state.activeChatSource === 'phone' ? `phone:${core.state.selectedPhoneConversationId}` : core.state.selectedChatId || selected?.chatId || core.state.selectedSessionId || null, sessionId: core.state.selectedSessionId,
            mode: core.currentConversationMode?.() || 'chat', computerId: core.currentExecutionComputer?.() || core.state.hostId,
            projectId: project?.projectId || null, workDir: workspaceFolderPath };
    }
    function mountShell() {
        ui.byId('account-menu-trigger').setAttribute('aria-label', '账户菜单');
        const menu = ui.byId('account-menu');
        menu.setAttribute('aria-label', '账户选项'); menu.setAttribute('role', 'region');
        const identity = ui.element('div', 'account-menu-identity');
        const name = ui.element('strong'), email = ui.element('span', 'muted'); name.id = 'account-menu-name'; email.id = 'account-menu-email'; identity.append(name, email);
        const usage = ui.element('div', 'account-usage-strip'); usage.setAttribute('role', 'status');
        usage.id = 'account-menu-usage';
        menu.prepend(identity, usage);
        ui.byId('rail-account').append(ui.element('kbd', 'account-menu-key', 'Ctrl+,'));
        ui.byId('rail-account').setAttribute('aria-label', '设置');
        const add = (label, icon, run) => { const button = ui.element('button', 'rail-link'); button.type = 'button';
            button.append(globalThis.WeftIcons.create(icon, 16), ui.element('span', '', label));
            button.onclick = () => { closeAccountMenu(); run(); }; menu.append(button); return button; };
        const usageLink = add('用量详情', 'chart', () => ui.openSettings('usage'));
        identity.after(usageLink); usageLink.append(usage);
        const help = ui.element('button', 'rail-link account-help', '帮助'); help.type = 'button';
        help.prepend(globalThis.WeftIcons.create('info', 16)); help.append(globalThis.WeftIcons.create('right', 16)); menu.append(help);
        help.setAttribute('aria-label', '帮助'); help.setAttribute('aria-haspopup', 'menu'); help.setAttribute('aria-expanded', 'false');
        const openHelp = () => {
            if (accountHelp) { accountHelp.close(); accountHelp = null; return; }
            accountHelp = globalThis.WeftPopover.openMenu(help, [
                {name:'新功能',icon:'sync',action:()=>{closeAccountMenu();ui.openReleases();}},
                {name:'键盘快捷键',icon:'keyboard',action:()=>{closeAccountMenu();ui.openShortcuts();}},
                {name:'用户指南',icon:'info',action:()=>{closeAccountMenu();ui.openHelp();}},
            ], {label:'帮助',onClose:()=>{accountHelp=null;}});
            accountHelp.menu.classList.add('account-help-menu');
            globalThis.WeftPopover.position(accountHelp.menu, help, {side:'right'});
        };
        help.addEventListener('click', openHelp);
        help.addEventListener('keydown', event => { if (event.key === 'ArrowRight') { event.preventDefault(); openHelp(); } });
        new MutationObserver(() => { if (menu.hidden) { accountHelp?.close(false); accountHelp = null; } }).observe(menu, {attributes:true,attributeFilter:['hidden']});
        // Memory moves into the fixed navigation; devices stay in settings.
        ui.byId('rail-devices').hidden = true;
        const logout = add('退出登录', 'logout', () => {
            const token = core.accountToken(), dialog = ui.element('dialog', 'dialog confirm-dialog'); dialog.setAttribute('aria-label', '退出登录');
            const body = ui.element('div', 'dialog-body'); body.append(ui.element('h2', '', '退出当前设备？'), ui.element('p', '', '退出后需要重新登录。电脑上的对话与文件会保留。'));
            const cancel = ui.element('button', 'button secondary', '取消'); cancel.onclick = () => dialog.close();
            const confirm = ui.element('button', 'button primary', '确认退出'); confirm.onclick = () => {
                dialog.close();
                if (!core.accountIdentityCurrent(token)) return;
                if (core.state.cloudAuth?.mode === 'authenticated') void core.cloudLogout().catch(error => ui.toast(core.cloudError(error)));
                else ui.byId('logout-button').click();
            };
            const footer = ui.element('div', 'dialog-footer'); footer.append(cancel, confirm); dialog.append(body, footer);
            dialog.onclose = () => { dialog.remove(); ui.byId('account-menu-trigger').focus(); }; document.body.append(dialog); dialog.showModal(); cancel.focus();
        });
        const login = add('登录以使用远程访问', 'account', () => core.startCloudJourney());
        ui.byId('account-menu-trigger').addEventListener('click', async () => {
            accountHelp?.close(false); accountHelp = null;
            const authenticated = core.state.cloudAuth?.mode === 'authenticated' || core.state.device?.authKind !== 'desktop';
            logout.hidden = !authenticated; login.hidden = authenticated;
            name.textContent = core.profileName();
            email.textContent = WeftUiCore.accountLabel(core.state.account || {},core.state.cloudAuth?.mode === 'authenticated' ? core.state.cloudAuth.email : '');
            usage.replaceChildren(WeftControls.skeleton({rows:1,compact:true}));
            const token = core.accountToken();
            try { const text = await core.loadUsageStrip(); if (text && core.accountIdentityCurrent(token) && !menu.hidden) usage.textContent = text.split(' · ')[0]; }
            catch { if (core.accountIdentityCurrent(token) && !menu.hidden) usage.textContent = '暂不可用'; }
        });
        menu.addEventListener('keydown', event => {
            const buttons = [...menu.querySelectorAll('button,summary')].filter(button => button.getClientRects().length), index = buttons.indexOf(document.activeElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }
        });
        core.state.setupGrant = ui.takeSetupGrant();
        ui.byId('account-back').addEventListener('click', () => { ui.resetProfileDraft(); core.state.deviceEditing = null; void core.enterAssistant(); });
        ui.byId('rail-account').addEventListener('click', core.openAccount);
        ui.byId('show-account').addEventListener('click', core.openAccount);
        ui.byId('rail-open').addEventListener('click', () => {
            if (window.WeftDesktop) {
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

        ui.byId('rail-backdrop').addEventListener('click', ui.closeRail);
        window.WeftDesktop?.init({ renderSessions: ui.renderSessions, openAccount: core.openAccount, sendDraft: core.sendDraft, addFiles: core.addAttachmentFiles,
            stop: core.stopCurrentTurn, isAssistant: () => core.state.currentView === 'assistant', openSearch: () => ui.openSearch?.(), openShortcuts: () => ui.openShortcuts?.(), resources: core.loadConversationResources, openResource: ui.openConversationResource });
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
                void core.refreshAssistantOverview();
            else if (document.visibilityState === 'visible' && !ui.byId('memory-view').hidden)
                void core.openMemory();
        });
        window.addEventListener('online', () => {
            if (!ui.byId('assistant-view').hidden)
                void core.refreshAssistantOverview();
        });
        window.addEventListener('hashchange', () => {
            const grant = ui.takeSetupGrant();
            if (grant) {
                core.state.setupGrant = grant;
                void core.load();
            }
        });
        globalThis.WeftDesktopUI?.init({ error: ui.toast, readyForFiles: () => !!core.state.account && !!core.state.csrfToken && !core.state.submitting,
            receiveFiles: payload => ui.receiveWindowsSendTo(payload), openConversation: async (sessionId, approvalId) => {
                await core.enterAssistant();
                await core.refreshSessions();
                await core.selectSession(sessionId);
                if (approvalId) {
                    await core.refreshConversationApprovals();
                    const card = ui.byId('approval-bar').querySelector(`[data-conversation-approval="${CSS.escape(approvalId)}"]`);
                    const detail = card?.querySelector('details'); if (detail) detail.open = true;
                    card?.querySelector('summary')?.focus({preventScroll:true});
                }
            } });
        void core.load();
        setInterval(() => {
            if (core.state.account && document.visibilityState === 'visible' && core.foreground())
                void core.refreshPendingDevices();
        }, core.polling.presence);
    }
    return { workspaceContext, updateModelPicker, paintConnection, paintOperation, clearOperation, approvalModeReadFailed, closeModelMenu, openModelMenu, stopVoiceInput, startVoiceInput, takeSetupGrant, errorAt, toast, clearPasswords, setBusy, updateAvailability, renderModelHint, startAssistantRefresh, showRegistration, cancelCloudLogin, resetAccountControls, resetIdentityControls, resetConversationControls, closeAccountMenu, stopCloudPairing, paintScreen, mountShell };
};
