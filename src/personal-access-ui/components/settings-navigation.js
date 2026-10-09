/* Settings navigation and category placement. No domain requests or persistence here. */
globalThis.WeftUiComponents.factories.settingsNavigation = (core, ui) => {
    let registry, selected = 'general', dialog, search, navigation, content, picker, returnFocus, cloudNotice;
    const panels = new Map(), positions = new Map();
    let updateGeneration = 0;
    const node = (tag, className, text) => ui.element(tag, className, text);
    function selectSettings(id, options = {}) {
        const category = registry.get(id);
        if (!category || !registry.list({ desktop: !!globalThis.weftmateDesktop }).includes(category)) return;
        if (!panels.has(id)) { const panel = node('section', 'settings-category'); panel.dataset.category = id; panels.set(id, panel); content.append(panel); }
        if (content) positions.set(selected, content.scrollTop);
        if (selected === 'devices' && id !== 'devices') ui.stopCloudPairing();
        selected = id;
        if (id !== 'memory' && core.state.currentView === 'memory') core.openAccount();
        if (cloudNotice) cloudNotice.hidden = core.state.cloudAuth.mode !== 'authenticated' || !['account', 'devices'].includes(id);
        for (const [key, panel] of panels) panel.hidden = key !== id;
        ui.byId('settings-title').textContent = category.name;
        picker.value = id; picker.dispatchEvent(new Event('weft:sync'));
        for (const button of navigation.querySelectorAll('button')) {
            button.classList.toggle('is-selected', button.dataset.category === id);
            if (button.dataset.category === id) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
        }
        content.scrollTop = positions.get(id) || 0;
        category.mount({ ...options, target: panels.get(id), core, ui });
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            for (const animation of dialog.getAnimations({ subtree: true })) animation.cancel();
        } else globalThis.WeftMotion?.reveal(panels.get(id), 'base');
    }
    function renderSettingsNavigation() {
        navigation.replaceChildren(); picker.replaceChildren();
        let group;
        for (const category of registry.list({ desktop: !!globalThis.weftmateDesktop, query: search.value })) {
            if (group !== category.group) { group = category.group; navigation.append(node('h2', 'settings-nav-group', group)); }
            const button = node('button', 'settings-nav-item', category.name); button.type = 'button'; button.dataset.category = category.id;
            button.prepend(globalThis.WeftIcons.create(category.icon, 20));
            button.addEventListener('click', () => selectSettings(category.id)); navigation.append(button);
            const option = new Option(`${category.group} · ${category.name}`, category.id); picker.append(option);
        }
        if (!navigation.children.length) navigation.append(node('p', 'muted settings-empty', '没有匹配的设置，试试“主题”或“费用”。'));
        picker.value = selected;
        for (const button of navigation.querySelectorAll('button')) if (button.dataset.category === selected) { button.classList.add('is-selected'); button.setAttribute('aria-current', 'page'); }
    }
    function openSettings(id = selected, options = {}) {
        if (!dialog.open) { returnFocus = document.activeElement; if (id === 'memory') { void core.openMemory(); return; } core.openAccount(); }
        selectSettings(id, options);
    }
    function showSettingsDialog() {
        if (!dialog?.open) { returnFocus = document.activeElement; dialog.showModal(); globalThis.WeftMotion?.reveal(dialog, '240ms'); }
        selectSettings(core.state.currentView === 'memory' ? 'memory' : selected);
    }
    function hideSettingsDialog() { if (dialog?.open) dialog.close(); }
    async function renderSettingsUpdates(check = false) {
        const target = ui.byId('settings-updates'), token = core.accountToken(), generation = ++updateGeneration;
        const current = () => core.accountIdentityCurrent(token) && generation === updateGeneration && dialog.open && selected === 'about';
        const loading = node('p', 'muted', check ? '正在检查更新…' : '正在读取版本…'); loading.setAttribute('role', 'status'); target.replaceChildren(loading);
        let value;
        try { value = await (check ? core.checkUpdates() : core.readUpdateState()); }
        catch { if (current()) loading.textContent = '更新状态暂时无法读取，请重试。'; }
        if (!current()) return;
        const names = {ui:'电脑界面',app:'程序版本','mobile-ui':'手机界面'};
        if(value) {target.replaceChildren();for(const layer of value.layers) target.append(globalThis.WeftSettingsControls.row(names[layer.layer] || '版本',
            `当前 ${layer.currentVersion || '版本未知'}${layer.availableVersion ? ` · 可用 ${layer.availableVersion}` : ''}`,node('span','settings-value',core.updateStatusText(layer))));}
        const actions=node('div','actions'), refresh=node('button','button secondary','检查更新');refresh.type='button';refresh.addEventListener('click',()=>{void renderSettingsUpdates(true)});actions.append(refresh);
        if(value?.canRestart){const restart=node('button','button primary','重启并更新');restart.type='button';restart.addEventListener('click',async()=>{restart.disabled=true;try{const result=await core.restartForUpdate();if(!current())return;if(!result?.restarted){loading.textContent=result?.reason||'更新尚未就绪，请重新检查。';target.prepend(loading);restart.disabled=false}}catch{if(current()){loading.textContent='更新未完成，请重新检查。';target.prepend(loading);restart.disabled=false}}});actions.append(restart)}
        target.append(actions);
    }
    function mountSettingsNavigation() {
        const account = ui.byId('account-view');
        dialog = node('dialog', 'settings-dialog'); dialog.id = 'settings-dialog'; dialog.setAttribute('aria-label', '设置');
        const sidebar = node('aside', 'settings-sidebar');
        search = node('input', 'settings-search'); search.type = 'search'; search.placeholder = '搜索设置'; search.setAttribute('aria-label', '搜索设置');
        navigation = node('nav', 'settings-navigation'); navigation.setAttribute('aria-label', '设置分类'); sidebar.append(search, navigation);
        const main = node('div', 'settings-main'), head = node('header', 'settings-head');
        const title = node('h1', '', '常规'); title.id = 'settings-title'; title.tabIndex = -1;
        const close = node('button', 'icon-close'); close.type = 'button'; close.setAttribute('aria-label', '关闭设置'); close.append(globalThis.WeftIcons.create('deny', 24));
        head.append(title, close);
        picker = node('select', 'settings-category-picker'); picker.setAttribute('aria-label', '设置分类');
        content = node('div', 'settings-content');
        const originals = [...account.children]; account.append(content);
        for (const id of ['general', 'appearance', 'account', 'devices', 'usage', 'models', 'approvals', 'memory', 'schedules', 'resources', 'system', 'backups', 'about']) {
            const panel = node('section', 'settings-category'); panel.dataset.category = id; panel.hidden = true; panels.set(id, panel); content.append(panel);
        }
        const move = (id, element) => { if (element) panels.get(id).append(element); };
        move('approvals', ui.byId('approval-settings-heading').closest('section'));
        move('appearance', ui.byId('appearance-heading').closest('section'));
        move('account', ui.byId('account-heading').closest('section'));
        move('account', ui.byId('cloud-account'));
        move('devices', ui.byId('devices-heading').closest('section'));
        const cloud = ui.byId('cloud-settings');
        if (cloud) {
            cloudNotice = ui.byId('cloud-settings-status'); cloudNotice.classList.add('settings-cloud-status');
            cloud.querySelector('nav').hidden = true;
            move('account', cloud); move('devices', ui.byId('cloud-devices-panel'));
        }
        move('devices', document.querySelector('.account-downloads'));
        move('schedules', ui.byId('settings-schedules'));
        move('backups', document.querySelector('.backup-settings'));
        const system = ui.byId('system-heading').closest('section');
        const background = ui.byId('background-model-select');
        background.previousElementSibling.remove(); background.nextElementSibling.remove();
        const defaultModel = node('select'); defaultModel.id = 'default-model-select'; defaultModel.setAttribute('aria-label', '对话默认模型');
        panels.get('models').append(globalThis.WeftSettingsControls.row('对话默认模型', '用于新建对话；已有对话继续使用原模型。', defaultModel));
        const backgroundRow = globalThis.WeftSettingsControls.row('后台模型', '标题、记忆整理和关心使用此模型；本机模型共用一张显卡，后台等待所选模型已加载且聊天空闲，以免触发切换。', background);
        const currentModel = node('p', 'model-current'); currentModel.id = 'background-current-model';
        backgroundRow.firstElementChild.append(currentModel); panels.get('models').append(backgroundRow);
        move('models', ui.byId('background-model-notice'));
        move(globalThis.weftmateDesktop ? 'system' : 'general', system); move('models', ui.byId('account-model-section'));
        const form = ui.byId('account-model-form'), editor = node('dialog', 'dialog model-editor-dialog');
        editor.id = 'account-model-dialog'; editor.setAttribute('aria-labelledby', 'model-editor-title');
        const editorHead = node('div', 'dialog-head'), editorTitle = node('h2', '', '添加模型'); editorTitle.id = 'model-editor-title';
        const editorClose = node('button', 'icon-close'); editorClose.type = 'button'; editorClose.setAttribute('aria-label', '关闭模型表单'); editorClose.append(globalThis.WeftIcons.create('deny', 24));
        editorClose.addEventListener('click', () => editor.close()); editorHead.append(editorTitle, editorClose);
        const test = node('button', 'button secondary small', '测试连接'); test.id = 'account-model-draft-test'; test.type = 'button';
        form.querySelector('.actions').prepend(test); form.classList.add('model-editor-form');
        ui.byId('account-model-cancel').hidden = false; ui.byId('account-model-cancel').textContent = '取消';
        const checks = node('div', 'model-check-result'); checks.id = 'account-model-draft-result'; checks.setAttribute('aria-live', 'polite');
        editor.append(editorHead, form, checks); document.body.append(editor);
        editor.addEventListener('close', () => { ui.byId('account-model-key').value = ''; core.state.accountModelEditing = null; });
        const tools = account.querySelector('.tool-settings');
        for (const section of [...tools.querySelectorAll('section')]) move('resources', section);
        move(globalThis.weftmateDesktop ? 'system' : 'general', ui.byId('connection-copy').closest('section'));
        const nativeSettings = ui.byId('desktop-auto-start');
        if (nativeSettings) {
            const original = nativeSettings.closest('section'); nativeSettings.remove();
            globalThis.WeftSettingsControls.toggle(nativeSettings);
            panels.get('general').append(globalThis.WeftSettingsControls.row('开机自启', '启动后留在托盘，随时继续对话。', nativeSettings)); original.remove();
        }
        const description = (id, name, help, value) => panels.get(id).append(globalThis.WeftSettingsControls.row(name, help, node('span', 'settings-value', value)));
        if (!nativeSettings) description('general', '开机自启', '在 WeftMate 桌面程序中设置。', '仅桌面程序');
        description('general', '关闭窗口时最小化到托盘', '关闭窗口后，WeftMate 继续在后台运行。', globalThis.weftmateDesktop ? '已启用' : '仅桌面程序');
        if (globalThis.weftmateDesktop?.openLogs) {
            const logs = node('button', 'button secondary small', '打开日志文件夹'); logs.type = 'button';
            logs.addEventListener('click', async () => { try { await globalThis.weftmateDesktop.openLogs(); } catch { ui.toast('日志文件夹暂时无法打开，请重试。'); } });
            panels.get('general').append(globalThis.WeftSettingsControls.row('运行日志', '保留最近 7 天的运行状态，不记录对话、记忆内容或密钥。', logs));
        }
        description('general', '语言', '当前界面使用简体中文。', '简体中文');
        const messageSetting = globalThis.WeftUiCore.messageModeSetting;
        const messageMode = node('select'); messageMode.id = 'settings-message-mode'; messageMode.setAttribute('aria-label', messageSetting.name);
        for (const [value, label] of messageSetting.options) messageMode.append(new Option(label, value));
        const messageHelp = messageSetting.options.map(([, label, help]) => `${label}：${help}`).join(' ');
        panels.get('general').append(globalThis.WeftSettingsControls.row(messageSetting.name, messageHelp, messageMode));
        messageMode.addEventListener('change', () => core.setMessageMode(messageMode.value));
        const descriptions = { theme: '选择适合当前环境的颜色模式。', accent: '用于按钮、选中状态和交互提示。', fontSize: '调整阅读与输入的文字大小。' };
        for (const [key, help] of Object.entries(descriptions)) {
            const control = ui.byId('appearance-' + key), label = control.closest('label'), name = label.childNodes[0].textContent;
            control.setAttribute('aria-label', name); control.remove(); label.remove();
            const row = globalThis.WeftSettingsControls.row(name, help, control); panels.get('appearance').append(row);
            if (key === 'theme') { const segmented = globalThis.WeftSettingsControls.segmented(control); row.append(segmented); }
        }
        move('memory', ui.byId('memory-view'));

        const updates = node('section', 'settings-updates'); updates.id = 'settings-updates'; panels.get('about').append(updates);
        description('about', 'WeftMate', '跨设备、跨对话的个人助手。', globalThis.weftmateDesktop ? '桌面程序' : '远程网页');
        const appVersion = node('span', 'settings-value', '正在读取…');
        if (globalThis.weftmateDesktop) { panels.get('about').append(globalThis.WeftSettingsControls.row('版本', '当前桌面程序。', appVersion)); void globalThis.weftmateDesktop.settings().then(settings => { appVersion.textContent = settings.version; }); }
        const version = node('span', 'settings-value', '正在读取…'); version.id = 'settings-host-version';
        panels.get('about').append(globalThis.WeftSettingsControls.row('宿主版本', '来自当前连接的宿主。', version));
        for (const [name, kind] of [['服务条款', 'terms'], ['隐私政策', 'privacy']]) {
            const button = node('button', 'button secondary', '阅读' + name); button.type = 'button';
            button.addEventListener('click', () => { void ui.openLegal(kind); });
            panels.get('about').append(globalThis.WeftSettingsControls.row(name, '在应用内阅读。', button));
        }
        for (const original of originals) if (original.parentNode === account) original.hidden = true;
        account.append(content); main.append(head, picker); if (cloudNotice) main.append(cloudNotice); main.append(account); dialog.append(sidebar, main); document.body.append(dialog);
        registry = globalThis.WeftUiCore.settingsRegistry({
            general: () => { messageMode.value = core.messageModePreference(); messageMode.dispatchEvent(new Event('weft:sync')); },
            account: () => { ui.selectCloudSettings?.('account'); ui.paintCloudSettings?.(); },
            devices: () => { ui.selectCloudSettings?.('devices'); ui.paintCloudSettings?.(); },
            memory: () => { if (core.state.currentView !== 'memory') void core.openMemory(); },
            backups: () => ui.showSettingsBackups(),
            schedules: () => ui.showSettingsSchedules(),
            usage: options => ui.showSettingsUsage(options),
            archived: () => ui.showSettingsArchived(panels.get('archived')),
            about: () => { version.textContent = core.state.system?.host?.version || '版本未知'; void renderSettingsUpdates(); },
        });
        search.addEventListener('input', renderSettingsNavigation); picker.addEventListener('change', () => selectSettings(picker.value));
        close.addEventListener('click', () => ui.byId('account-back').click());
        dialog.addEventListener('cancel', event => { event.preventDefault(); ui.byId('account-back').click(); });
        dialog.addEventListener('close', () => { ui.stopAccountPairing?.(); returnFocus?.focus(); });
        renderSettingsNavigation(); selectSettings(selected);
        globalThis.WeftPopover.bindSettings(dialog);
        globalThis.WeftPopover.bindSettings(editor);
        globalThis.WeftSettingsNavigation = { open: openSettings, register: entry => { registry.register(entry); renderSettingsNavigation(); } };
    }
    return { mountSettingsNavigation, openSettings, selectSettings, showSettingsDialog, hideSettingsDialog };
};
