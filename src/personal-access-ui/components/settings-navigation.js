/* Settings navigation and category placement. No domain requests or persistence here. */
globalThis.WeftUiComponents.factories.settingsNavigation = (core, ui) => {
    let registry, selected = 'general', dialog, search, navigation, content, picker, returnFocus;
    const panels = new Map(), positions = new Map();
    const node = (tag, className, text) => ui.element(tag, className, text);
    function selectSettings(id, options = {}) {
        const category = registry.get(id);
        if (!category || !registry.list({ desktop: !!globalThis.weftmateDesktop }).includes(category)) return;
        if (!panels.has(id)) { const panel = node('section', 'settings-category'); panel.dataset.category = id; panels.set(id, panel); content.append(panel); }
        if (content) positions.set(selected, content.scrollTop);
        if (selected === 'devices' && id !== 'devices') ui.stopCloudPairing();
        selected = id;
        for (const [key, panel] of panels) panel.hidden = key !== id;
        ui.byId('settings-title').textContent = category.name;
        picker.value = id;
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
        if (!dialog.open) { returnFocus = document.activeElement; core.openAccount(); }
        selectSettings(id, options);
    }
    function showSettingsDialog() {
        if (!dialog?.open) { returnFocus = document.activeElement; dialog.showModal(); globalThis.WeftMotion?.reveal(dialog, '240ms'); }
        selectSettings(selected);
    }
    function hideSettingsDialog() { if (dialog?.open) dialog.close(); }
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
        for (const id of ['general', 'appearance', 'account', 'devices', 'usage', 'models', 'approvals', 'memory', 'resources', 'system', 'about']) {
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
            cloud.querySelector('nav').hidden = true;
            move('account', cloud); move('devices', ui.byId('cloud-devices-panel'));
        }
        move('devices', document.querySelector('.account-downloads'));
        const system = ui.byId('system-heading').closest('section');
        for (const id of ['background-model-select', 'background-model-notice']) {
            const element = ui.byId(id); if (id === 'background-model-select') { move('models', element.previousElementSibling); move('models', element.nextElementSibling); }
            move('models', element);
        }
        move(globalThis.weftmateDesktop ? 'system' : 'general', system); move('models', ui.byId('account-model-section'));
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
        description('general', '通知', '审批、提问与任务完成会通过系统通知提醒。', globalThis.weftmateDesktop ? '由系统管理' : '在桌面程序中管理');
        description('general', '关闭窗口时最小化到托盘', '关闭窗口后，WeftMate 继续在后台运行。', globalThis.weftmateDesktop ? '已启用' : '仅桌面程序');
        description('general', '语言', '当前界面使用简体中文。', '简体中文');
        const descriptions = { theme: '选择适合当前环境的颜色模式。', accent: '用于按钮、选中状态和交互提示。', fontSize: '调整阅读与输入的文字大小。' };
        for (const [key, help] of Object.entries(descriptions)) {
            const control = ui.byId('appearance-' + key), label = control.closest('label'), name = label.childNodes[0].textContent;
            control.setAttribute('aria-label', name); control.remove(); label.remove();
            const row = globalThis.WeftSettingsControls.row(name, help, control); panels.get('appearance').append(row);
            if (key === 'theme') { const segmented = globalThis.WeftSettingsControls.segmented(control); row.append(segmented); }
        }
        description('appearance', '界面密度', '当前布局使用标准间距。', '标准');
        const memory = node('button', 'button secondary', '管理记忆'); memory.type = 'button'; memory.addEventListener('click', () => { hideSettingsDialog(); void core.openMemory(); });
        panels.get('memory').append(globalThis.WeftSettingsControls.row('记忆管理', '查看理解与来源，纠正或移除已有记忆。', memory));
        description('models', '主模型', '每段对话在输入区单独选择主模型。', '在对话中选择');
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
        account.append(content); main.append(head, picker, account); dialog.append(sidebar, main); document.body.append(dialog);
        registry = globalThis.WeftUiCore.settingsRegistry({
            account: () => { ui.selectCloudSettings?.('account'); ui.paintCloudSettings?.(); },
            devices: () => { ui.selectCloudSettings?.('devices'); ui.paintCloudSettings?.(); },
            usage: options => ui.showSettingsUsage(options),
            about: () => { version.textContent = core.state.system?.host?.version || '版本未知'; },
        });
        search.addEventListener('input', renderSettingsNavigation); picker.addEventListener('change', () => selectSettings(picker.value));
        close.addEventListener('click', () => ui.byId('account-back').click());
        dialog.addEventListener('cancel', event => { event.preventDefault(); ui.byId('account-back').click(); });
        dialog.addEventListener('close', () => { ui.stopAccountPairing?.(); returnFocus?.focus(); });
        renderSettingsNavigation(); selectSettings(selected);
        globalThis.WeftSettingsNavigation = { open: openSettings, register: entry => { registry.register(entry); renderSettingsNavigation(); } };
    }
    return { mountSettingsNavigation, openSettings, selectSettings, showSettingsDialog, hideSettingsDialog };
};
