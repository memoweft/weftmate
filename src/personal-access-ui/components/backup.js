/* Desktop backup controls, using the existing settings form and token styles. */
globalThis.WeftUiComponents.factories.backup = (core, ui) => {
    function mountBackup() {
        const section = ui.element('section', 'card group backup-settings'); section.setAttribute('aria-label', '备份');
        section.append(ui.element('h2', '', '备份'));
        for (const text of ['每天空闲时自动备份。备份会短暂关闭并重新打开程序，请先完成当前任务。',
            '包含账号与设置、对话与经验、成果、用量和记忆。模型密钥、云令牌、设备私钥与登录会话不进包；恢复后请重新登录，换电脑后重新填写模型密钥。',
            '本地备份未加密，包含私人内容，请保存在你信任的磁盘。云端加密备份尚未启用。']) section.append(ui.element('p', 'field-help', text));
        const form = ui.element('form'), inputs = {};
        function field(parent, name, text, type = 'text') {
            const label = ui.element('label'), input = ui.element('input'); input.name = name; input.type = type;
            input.required = type !== 'checkbox'; if (type === 'number') input.min = '1';
            if (type === 'checkbox') label.append(input, ui.element('span', '', text));
            else label.append(ui.element('span', '', text), input);
            parent.append(label); return input;
        }
        inputs.enabled = field(form, 'enabled', '每日自动备份', 'checkbox');
        inputs.directory = field(form, 'directory', '备份目录');
        inputs.dailyDays = field(form, 'dailyDays', '最近保留天数', 'number');
        inputs.weeklyCopies = field(form, 'weeklyCopies', '每周保留份数', 'number');
        const save = ui.element('button', 'button secondary', '保存备份设置'); save.type = 'submit'; form.append(save);
        const actions = ui.element('div', 'actions'), create = ui.element('button', 'button primary', '立即备份'), reload = ui.element('button', 'button secondary', '刷新备份列表');
        create.type = reload.type = 'button'; actions.append(create, reload);
        const importForm = ui.element('form'); importForm.dataset.import = '';
        const importPath = field(importForm, 'path', '另一台电脑的备份路径'); importPath.placeholder = '填写这台宿主电脑上 .wmb 文件的完整路径';
        const importButton = ui.element('button', 'button secondary', '导入备份'); importButton.type = 'submit'; importForm.append(importButton);
        const notice = ui.element('p'), list = ui.element('ul', 'system-services'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); list.setAttribute('aria-label', '备份列表');
        section.append(form, actions, importForm, notice, list);
        globalThis.WeftUiLayout.mountBackup(section);
        let busy = false;
        async function run(action) {
            if (busy) return; busy = true;
            const token = core.accountToken();
            section.querySelectorAll('button').forEach(button => { button.disabled = true; });
            notice.textContent = '正在处理…';
            try { await action(); }
            catch (error) { if (core.accountCurrent(token)) notice.textContent = core.backupErrorText(error); }
            finally { busy = false; section.querySelectorAll('button').forEach(button => { button.disabled = button.dataset.invalid === 'true'; }); }
        }
        async function refresh() {
            const token = core.accountToken(), value = await core.readBackups();
            if (!core.accountCurrent(token)) return;
            for (const key of ['directory', 'dailyDays', 'weeklyCopies']) inputs[key].value = value.settings[key];
            inputs.enabled.checked = value.settings.enabled; list.replaceChildren();
            for (const backup of value.backups) {
                const row = ui.element('li', 'system-service'), details = ui.element('div', 'system-service-detail');
                const label = new Date(backup.createdAt).toLocaleString();
                details.append(ui.element('strong', '', label), ui.element('small', 'muted', `${(backup.size / 1048576).toFixed(2)} MB · ${backup.verification === 'valid' ? '校验通过' : '校验失败'}`));
                const restore = ui.element('button', 'button secondary small', '恢复'); restore.setAttribute('aria-label', `恢复 ${label}`);
                restore.dataset.invalid = String(backup.verification !== 'valid'); restore.disabled = backup.verification !== 'valid';
                restore.addEventListener('click', () => {
                    const dialog = ui.element('dialog', 'dialog'); dialog.setAttribute('aria-label', '恢复备份');
                    dialog.append(ui.element('h2', '', '恢复备份'), ui.element('p', '', `恢复到 ${label}？当前状态会先自动备份，随后程序重启；恢复后需重新登录。`));
                    const cancel = ui.element('button', 'button secondary', '取消'), confirm = ui.element('button', 'button danger', '确认恢复');
                    cancel.addEventListener('click', () => { dialog.close(); dialog.remove(); });
                    confirm.addEventListener('click', () => { dialog.close(); dialog.remove(); void run(async () => { await core.restoreBackup(backup.id); notice.textContent = '已开始恢复，程序将重新打开。'; }); });
                    dialog.append(cancel, confirm); document.body.append(dialog); dialog.showModal(); cancel.focus();
                }); row.append(details, restore); list.append(row);
            }
            if (!value.backups.length) list.append(ui.element('li', 'muted', '还没有备份。点击「立即备份」保存当前状态。'));
            notice.textContent = value.status?.state === 'failed' ? '上次备份未完成，请检查磁盘与目录后重试。'
                : value.status?.state === 'rolled-back' ? '恢复未成功，已自动回到恢复前的状态。' : value.status?.state === 'succeeded' ? '上次操作已完成。' : '';
        }
        reload.addEventListener('click', () => void run(refresh));
        create.addEventListener('click', () => void run(async () => { await core.createBackup(); notice.textContent = '已开始备份，程序将重新打开。'; }));
        form.addEventListener('submit', event => { event.preventDefault(); void run(async () => { await core.saveBackupSettings({ enabled: inputs.enabled.checked, directory: inputs.directory.value, dailyDays: Number(inputs.dailyDays.value), weeklyCopies: Number(inputs.weeklyCopies.value) }); notice.textContent = '备份设置已保存。'; }); });
        importForm.addEventListener('submit', event => { event.preventDefault(); void run(async () => { await core.importBackup(importPath.value); await refresh(); notice.textContent = '备份已导入并通过校验，请在列表中选择恢复。'; }); });
        // Read only when the settings surface becomes visible, after authentication.
        new MutationObserver(() => { if (!ui.byId('account-view').hidden) void run(refresh); }).observe(ui.byId('account-view'), { attributes: true, attributeFilter: ['hidden'] });
    }
    return { mountBackup };
};
