/* Desktop settings component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.settings = (core, ui) => {
    function paintSystem(system, settings, catalog, token) {
        for (const [key, label] of [['model', '模型服务'], ['host', '宿主'], ['memory', '记忆']]) {
            const value = system[key], item = ui.element('li', 'system-service');
            const details = ui.element('div', 'system-service-detail');
            details.append(ui.element('strong', '', label), ui.element('span', '', core.serviceStateLabels[value.state] ?? '状态未知'));
            const info = [value.currentModelId ? `当前模型 ${value.currentModelId}` : '',
                value.version ? `版本 ${value.version}` : ['disabled', 'unconfigured', 'stopped'].includes(value.state) ? '' : '版本未知',
                value.contextWindow ? `上下文 ${value.contextWindow.toLocaleString()}` : '',
                value.slots ? `槽数 ${value.slots}` : '',
                value.lastSwitch?.at ? `最近切换 ${new Date(value.lastSwitch.at).toLocaleString()}${value.lastSwitch.ok ? '' : '（未成功）'}` : '',
                value.lastError ? `最近错误：${value.lastError}` : ''].filter(Boolean).join(' · ');
            details.append(ui.element('small', 'muted', info));
            const restart = ui.element('button', 'button secondary small', '重启');
            restart.disabled = !system.canRestart || !value.canRestart;
            restart.addEventListener('click', async () => {
                restart.disabled = true;
                restart.textContent = '重启中…';
                try {
                    await core.restartService(key);
                    if (core.accountCurrent(token))
                        await core.refreshSystem();
                }
                catch {
                    if (core.accountCurrent(token)) {
                        ui.byId('system-notice').textContent = '重启未确认，请刷新查看实际状态。';
                        restart.disabled = false;
                        restart.textContent = '重启';
                    }
                }
            });
            item.append(details, restart);
            ui.byId('system-services').append(item);
        }
        const select = ui.byId('background-model-select');
        select.replaceChildren(new Option('跟随主模型', ''));
        for (const model of catalog.models.filter(model => model.configured))
            select.append(new Option(model.name, model.id));
        if (settings.backgroundModelProfileId && ![...select.options].some(option => option.value === settings.backgroundModelProfileId)) {
            select.append(new Option('原后台模型不可用，请重新选择', settings.backgroundModelProfileId));
        }
        select.value = settings.backgroundModelProfileId ?? '';
        select.disabled = false;
        ui.byId('system-notice').textContent = system.queue?.backgroundPending
            ? `${system.queue.backgroundPending} 项后台请求排队中` : '已更新';
    }
    function systemLoading() {
        ui.byId('system-notice').textContent = '正在读取…';
        ui.byId('system-services').replaceChildren();
        ui.byId('background-model-select').disabled = true;
    }
    function systemNotice(message) {
        ui.byId('system-notice').textContent = message;
    }
    function updateOtherDeviceInstall() {
        const platformId = ui.byId('other-device-platform').value;
        const platform = ui.installPlatforms[platformId] || ui.installPlatforms.android;
        const link = ui.byId('other-device-platform-link');
        const image = ui.byId('other-device-qr');
        const qrStatus = ui.byId('other-device-qr-status');
        const platformStatus = ui.byId('other-device-platform-status');
        qrStatus.hidden = true;
        platformStatus.hidden = !platform.preparing && platformId !== 'windows';
        platformStatus.textContent = platform.preparing ? `${platform.name}安装方式准备中，可扫码查看官网信息。`
            : platformId === 'windows' ? 'Windows 请使用网页版，前往官网查看。' : '';
        if (!platform.qr) {
            link.hidden = true;
            image.hidden = true;
            link.setAttribute('href', 'https://www.weftmate.com/downloads/');
            link.setAttribute('aria-label', '打开官网查看 Windows 网页版');
            return;
        }
        link.hidden = false;
        image.hidden = false;
        link.setAttribute('href', `https://www.weftmate.com/downloads/?platform=${platform.qr}`);
        link.setAttribute('aria-label', `打开${platform.name}下载页面`);
        image.alt = `${platform.name}下载页面二维码`;
        image.src = ui.publicPlatformQrData[platform.qr];
    }
    function resetOtherDeviceInstall() {
        const details = ui.byId('other-device-install');
        if (details.open)
            details.open = false;
        ui.byId('other-device-platform').value = 'android';
        ui.updateOtherDeviceInstall();
    }
    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className)
            node.className = className;
        if (text !== undefined)
            node.textContent = text;
        return node;
    }
    function mountSettings() {
        ui.mountBackup();
        ui.mountUsage();
        ui.mountSchedules();
        ui.byId('other-device-platform').addEventListener('change', ui.updateOtherDeviceInstall);
        ui.byId('other-device-qr').addEventListener('error', () => {
            ui.byId('other-device-qr').hidden = true;
            ui.byId('other-device-qr-status').hidden = false;
        });
        ui.byId('projects-refresh').addEventListener('click', () => { void core.refreshProjects(); });
        ui.byId('browser-workspace-refresh').addEventListener('click', () => { void core.refreshBrowserWorkspace(); });
        ui.byId('browser-model-select').addEventListener('change', ui.renderBrowserModels);
        ui.byId('browser-workspace-form').addEventListener('submit', event => { event.preventDefault(); void core.startBrowserDraft({ urls: ui.byId('browser-url-list').value, goal: ui.byId('browser-goal').value, modelProfileId: ui.byId('browser-model-select').value }); });
        ui.byId('project-register-form').addEventListener('submit', event => { event.preventDefault(); void core.registerProjectDraft({ name: ui.byId('project-name').value, rootPath: ui.byId('project-root').value }); });
        ui.byId('system-refresh').addEventListener('click', () => { void core.refreshSystem(); });
        ui.byId('background-model-select').addEventListener('change', async (event) => {
            const token = core.accountToken(), select = event.target;
            select.disabled = true;
            try {
                await core.saveBackgroundModel(select.value || null);
                if (core.accountCurrent(token))
                    ui.byId('background-model-notice').textContent = '后台模型已保存';
            }
            catch {
                if (core.accountCurrent(token))
                    ui.byId('background-model-notice').textContent = '保存失败，请刷新后重试。';
            }
            finally {
                if (core.accountCurrent(token))
                    select.disabled = false;
            }
        });
        ui.byId('account-models-refresh').addEventListener('click', () => { void core.refreshAccountModels(); });
        ui.byId('account-model-cancel').addEventListener('click', () => {
            core.state.accountModelEditing = null;
            ui.byId('account-model-form').reset();
            ui.byId('account-model-submit').textContent = '保存到电脑账户';
            ui.byId('account-model-cancel').hidden = true;
            ui.byId('account-model-form-status').textContent = '';
        });
        ui.byId('account-model-form').addEventListener('submit', event => { event.preventDefault(); void core.saveAccountModelDraft({ name: ui.byId('account-model-name').value, baseUrl: ui.byId('account-model-base-url').value, modelId: ui.byId('account-model-id').value, modelTier: ui.byId('account-model-tier').value, apiKey: ui.byId('account-model-key').value }); });
    }
    function accountModelFormNotice(message) { ui.byId('account-model-form-status').textContent = message; }
    function accountModelFormBusy(busy) { ui.byId('account-model-submit').disabled = busy; }
    function resetAccountModelForm() { ui.byId('account-model-form').reset(); ui.byId('account-model-submit').textContent = '保存到电脑账户'; ui.byId('account-model-cancel').hidden = true; }
    function projectDraftNotice(message) { ui.byId('project-register-status').textContent = message; }
    function projectDraftBusy(busy) { ui.byId('project-register-form').querySelector('button[type="submit"]').disabled = busy; }
    function resetProjectDraft() { ui.byId('project-name').value = ''; ui.byId('project-root').value = ''; }
    function browserDraftBusy(busy) { ui.byId('browser-workspace-form').querySelector('button[type="submit"]').disabled = busy; }
    function showBrowserNotice() { ui.byId('browser-workspace-status').hidden = false; }
    return { paintSystem, systemLoading, systemNotice, updateOtherDeviceInstall, resetOtherDeviceInstall, element, mountSettings, accountModelFormNotice, accountModelFormBusy, resetAccountModelForm, projectDraftNotice, projectDraftBusy, resetProjectDraft, browserDraftBusy, showBrowserNotice };
};
