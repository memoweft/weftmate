/* Desktop account component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.account = (core, ui) => {
    function profileDirty() {
        return core.profileDraftDirty(ui.byId('profile-display-name').value);
    }
    function profileControls() {
        ui.byId('profile-save').disabled = core.state.profileSaving || core.state.avatarChecking || core.state.profileConflict || !ui.profileDirty();
        ui.byId('profile-cancel').disabled = core.state.profileSaving || (!ui.profileDirty() && !core.state.avatarChecking);
        ui.byId('profile-display-name').disabled = core.state.profileSaving;
        ui.byId('profile-avatar-file').disabled = core.state.profileSaving;
        ui.byId('profile-avatar-remove').disabled = core.state.profileSaving || !(core.state.profileDraftAvatar === undefined ? core.state.account?.avatar : core.state.profileDraftAvatar);
    }
    function releaseAvatarUrl() {
        if (core.state.avatarObjectUrl)
            URL.revokeObjectURL(core.state.avatarObjectUrl);
        core.state.avatarObjectUrl = null;
    }
    async function paintAvatar(avatar, token, file = null) {
        const generation = ++core.state.avatarGeneration;
        const current = () => core.accountCurrent(token) && generation === core.state.avatarGeneration;
        const image = ui.byId('profile-avatar-image');
        const placeholder = ui.byId('profile-avatar-placeholder');
        ui.releaseAvatarUrl();
        image.removeAttribute?.('src');
        image.hidden = true;
        placeholder.hidden = false;
        if (!current())
            return false;
        if (!avatar) {
            placeholder.textContent = Array.from(ui.byId('profile-display-name').value.trim() || core.state.account?.username || '?')[0] || '?';
            return true;
        }
        try {
            const url = file ? URL.createObjectURL(file) : `data:${avatar.mimeType};base64,${avatar.dataBase64}`;
            if (file)
                core.state.avatarObjectUrl = url;
            image.src = url;
            if (typeof image.decode === 'function')
                await image.decode();
            else
                await new Promise((resolve, reject) => {
                    image.addEventListener('load', resolve, { once: true });
                    image.addEventListener('error', reject, { once: true });
                });
            if (!current())
                return false;
            image.hidden = false;
            placeholder.hidden = true;
            return true;
        }
        catch {
            if (current()) {
                ui.byId('profile-avatar-status').textContent = '头像无法预览，请重新选择有效图片。';
                ui.releaseAvatarUrl();
                image.removeAttribute?.('src');
            }
            return false;
        }
    }
    function resetProfileDraft() {
        core.state.profileDraftGeneration++;
        core.state.avatarSelectionGeneration++;
        core.state.avatarChecking = false;
        core.state.profileDraftAvatar = undefined;
        core.state.profileConflict = false;
        ui.byId('profile-display-name').value = core.profileName();
        ui.byId('profile-avatar-file').value = '';
        ui.byId('profile-avatar-status').textContent = core.state.account?.avatar ? '当前头像。选择新图片或移除后再保存。' : '未设置头像。支持 PNG、JPEG 或 WebP，最多 128 KiB。';
        ui.byId('profile-reload').hidden = true;
        ui.errorAt('profile-error', '');
        ui.byId('profile-status').textContent = '';
        if (core.state.currentView === 'account')
            void ui.paintAvatar(core.state.account?.avatar ?? null, core.accountToken());
        ui.profileControls();
    }
    function renderDevices(devices) {
        const list = ui.byId('device-list');
        list.replaceChildren();
        if (!devices.length) {
            list.append(ui.element('li', 'device-item muted', '没有可显示的设备记录。'));
            return;
        }
        for (const device of devices) {
            const item = ui.element('li', 'device-item');
            if (typeof device.id === 'string')
                item.dataset.deviceId = device.id;
            const content = ui.element('div', 'device-content');
            const title = ui.element('div', 'device-title');
            title.append(ui.element('strong', '', typeof device.name === 'string' ? device.name : '未命名设备'));
            if (device.current === true)
                title.append(ui.element('span', 'badge', '当前设备'));
            if (device.revoked === true)
                title.append(ui.element('span', 'badge revoked', '已撤销'));
            const meta = ui.element('div', 'device-meta');
            meta.append(ui.element('span', '', `加入于 ${core.formatDate(device.createdAt)}`));
            if (device.lastSeenAt)
                meta.append(ui.element('span', '', `最近使用 ${core.formatDate(device.lastSeenAt)}`));
            meta.append(ui.element('span', '', `会话有效期至 ${core.formatDate(device.expiresAt)}`));
            content.append(title, meta);
            const editing = core.state.deviceEditing?.id === device.id ? core.state.deviceEditing : null;
            if (editing) {
                const form = ui.element('form', 'device-edit');
                const input = ui.element('input');
                input.type = 'text';
                input.maxLength = 128;
                input.value = editing.draft;
                input.setAttribute('aria-label', `修改${device.name || '未命名设备'}的名称`);
                const save = ui.element('button', 'button primary small', '保存名称');
                save.type = 'submit';
                save.disabled = editing.busy;
                const cancel = ui.element('button', 'button quiet small', '取消');
                cancel.type = 'button';
                cancel.disabled = editing.busy;
                const feedback = ui.element('p', `device-feedback${editing.error ? ' is-error' : ''}`, editing.error || (editing.busy ? '正在保存设备名称…' : '修改只影响这台设备的显示名称。'));
                feedback.setAttribute('role', editing.error ? 'alert' : 'status');
                input.disabled = editing.busy;
                input.addEventListener('input', () => { editing.draft = input.value; editing.error = ''; feedback.textContent = '修改只影响这台设备的显示名称。'; feedback.className = 'device-feedback'; });
                cancel.addEventListener('click', () => { core.state.deviceEditing = null; ui.renderDevices(core.state.cachedDevices); });
                form.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    if (editing.busy)
                        return;
                    const name = input.value.trim();
                    if (!name || name.length > 128) {
                        editing.error = '设备名称须为 1–128 个字符。';
                        feedback.textContent = editing.error;
                        feedback.className = 'device-feedback is-error';
                        return;
                    }
                    const token = core.accountToken();
                    editing.busy = true;
                    input.disabled = save.disabled = cancel.disabled = true;
                    feedback.textContent = '正在保存设备名称…';
                    try {
                        const result = await core.renameDevice(device.id, name);
                        if (!core.accountCurrent(token) || core.state.deviceEditing !== editing)
                            return;
                        if (result?.device?.id !== device.id || result.device.name !== name)
                            throw { code: 'REQUEST_FAILED' };
                        core.state.deviceEditing = null;
                        core.state.deviceNotice = '设备名称已保存。';
                        await core.refreshDevices();
                    }
                    catch (error) {
                        if (!core.accountCurrent(token) || core.state.deviceEditing !== editing)
                            return;
                        if (error.code === 'UNAUTHORIZED')
                            return core.sessionExpired();
                        editing.error = error.code === 'NOT_FOUND' ? '设备已不在当前账户中，请取消后刷新列表。' : '设备名称未确认保存，请检查连接并重试。';
                        feedback.textContent = editing.error;
                        feedback.className = 'device-feedback is-error';
                    }
                    finally {
                        if (core.accountCurrent(token) && core.state.deviceEditing === editing) {
                            editing.busy = false;
                            input.disabled = save.disabled = cancel.disabled = false;
                        }
                    }
                });
                form.append(input, save, cancel, feedback);
                content.append(form);
            }
            item.append(content);
            if (device.revoked !== true && typeof device.id === 'string' && !editing) {
                const actions = ui.element('div', 'device-actions');
                const rename = ui.element('button', 'button secondary small', '改名');
                rename.type = 'button';
                rename.addEventListener('click', () => {
                    core.state.deviceEditing = { id: device.id, draft: typeof device.name === 'string' ? device.name : '', error: '', busy: false };
                    ui.renderDevices(core.state.cachedDevices);
                    ui.byId('device-list').querySelector?.(`[data-device-id="${device.id}"] input`)?.focus();
                });
                actions.append(rename);
                if (device.current !== true && device.revoked !== true && typeof device.id === 'string') {
                    const button = ui.element('button', 'button secondary small', '撤销');
                    button.type = 'button';
                    button.addEventListener('click', () => {
                        core.state.revokeId = device.id;
                        ui.errorAt('revoke-error', '');
                        ui.byId('revoke-description').textContent = `确定撤销“${device.name || '未命名设备'}”吗？`;
                        ui.byId('revoke-dialog').showModal();
                    });
                    actions.append(button);
                }
                item.append(actions);
            }
            list.append(item);
        }
    }
    function accountModelStatus(text, error = false) {
        const node = ui.byId('account-models-status');
        node.textContent = text;
        node.classList.toggle('form-error', error);
    }
    function renderAccountModels() {
        const list = ui.byId('account-models-list');
        list.replaceChildren();
        const marker = core.savedAccountModelMarker();
        const form = ui.byId('account-model-form');
        form.hidden = !core.state.accountModelsCanManage;
        ui.byId('account-model-add').hidden = !core.state.accountModelsCanManage;
        const models = (core.state.allModels || []).filter(row => !row.id.startsWith('private-model-')).map(row => ({ ...row, modelId: row.model, status: 'active' }));
        models.push(...core.state.accountModels.map(row=>({...row,deepThinking:core.state.allModels?.find(model=>model.id===row.profileId)?.deepThinking ?? row.deepThinking})));
        const location = model => model.location || (model.sourceKind === 'cloud' ? 'cloud' : model.baseUrl && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(model.baseUrl).hostname) ? 'lan' : 'computer');
        for (const [group, label] of [['computer', '本机模型'], ['lan', '局域网模型'], ['cloud', '云端模型']]) {
            const heading = ui.element('li', 'model-list-heading', label); list.append(heading);
            const rows = models.filter(model => location(model) === group);
            if (!rows.length) list.append(ui.element('li', 'model-list-empty muted', '暂无模型'));
            for (const model of rows) {
            const row = ui.element('li', 'project-row');
            const main = ui.element('div', 'project-row-main');
            const checked = core.state.modelChecks?.[model.id ?? model.profileId];
            const loaded = group === 'computer' && core.state.system?.model?.currentModelId === model.modelId;
            const available = model.status === 'active' && model.configured;
            const failed = checked && (!checked.reachable || checked.authentication === 'rejected' || checked.model === 'missing' || checked.model === 'test_failed' || ['failed', 'invalid'].includes(checked.catalog) || checked.catalog === 'unsupported' && !checked.inferenceVerified);
            const status = loaded ? '已加载' : !model.configured ? '需要密钥' : !available || failed ? '不可用' : '可用';
            main.append(ui.element('small','muted',model.deepThinking?.supported?'支持深入思考':'此模型未声明深入思考能力'));
            main.append(ui.element('strong', '', model.name || model.modelId), ui.element('small', 'muted', `${model.modelId} · ${label}`), ui.element('span', 'model-status' + (loaded ? ' is-loaded' : ''), status));
            const actions = ui.element('div', 'actions');
            const edit = ui.element('button', 'button quiet small', '编辑');
            edit.disabled = core.state.accountModelBusy || !!marker || model.status !== 'active';
            edit.addEventListener('click', () => {
                core.state.accountModelEditing = { id: model.accountModelId, revision: model.revision };
                ui.byId('account-model-name').value = model.name || '';
                ui.byId('account-model-base-url').value = model.baseUrl || '';
                ui.byId('account-model-id').value = model.modelId || '';
                ui.byId('account-model-tier').value = model.modelTier || 'auto';
                ui.byId('account-model-tier').dispatchEvent(new Event('weft:sync'));
                ui.byId('account-model-key').value = '';
                ui.byId('account-model-submit').textContent = '保存修改';
                ui.byId('account-model-cancel').hidden = false;
                ui.accountModelFormNotice('留空密钥表示沿用原地址已保存的密钥；换地址需输入新地址的密钥。');
                ui.byId('model-editor-title').textContent = '编辑模型';
                ui.byId('account-model-draft-result').replaceChildren();
                ui.byId('account-model-dialog').showModal();
                ui.byId('account-model-name').focus();
            });
            if (model.accountModelId && core.state.accountModelsCanManage) actions.append(edit);
            else if (!model.accountModelId) actions.append(ui.element('span', 'muted model-host-note', '宿主目录'));
            if (model.status === 'active') {
                const test = ui.element('button', 'button secondary small', '测试连接');
                test.disabled = core.state.accountModelBusy || !!marker;
                test.addEventListener('click', () => { test.disabled = true; void core.checkModelDraft({ profileId: model.id ?? model.profileId }, false, model); });
                const stop = ui.element('button', 'button quiet small', '停止使用');
                stop.disabled = core.state.accountModelBusy || !!marker;
                stop.addEventListener('click', () => {
                    if (stop.dataset.confirm !== 'yes') {
                        stop.dataset.confirm = 'yes';
                        stop.textContent = '确认停止';
                        return;
                    }
                    void core.submitAccountModelControl(model, 'stop_using');
                });
                if (core.state.accountModelsCanManage) actions.append(test);
                if (model.accountModelId && core.state.accountModelsCanManage) actions.append(stop);
            }
            else if (model.status === 'stopped' || model.status === 'failed') {
                const remove = ui.element('button', 'button danger small', '移除配置');
                remove.disabled = core.state.accountModelBusy || !!marker;
                remove.addEventListener('click', () => {
                    if (remove.dataset.confirm !== 'yes') {
                        remove.dataset.confirm = 'yes';
                        remove.textContent = '确认移除';
                        return;
                    }
                    void core.submitAccountModelControl(model, 'remove');
                });
                actions.append(remove);
            }
            row.append(main, actions);
            if (checked) {
                const checks = ui.element('div', 'model-check-result');
                for (const [name, detail] of core.modelConnectionSteps(checked)) checks.append(ui.element('p', '', `${name}：${detail}`));
                if (checked.requiresTestMessage && !checked.inferenceVerified && checked.authentication !== 'rejected') {
                    const send = ui.element('button', 'button secondary small', '发送测试消息'); send.type = 'button';
                    send.addEventListener('click', () => { send.disabled = true; void core.checkModelDraft({ profileId: model.id ?? model.profileId }, true, model); }); checks.append(send);
                }
                row.append(checks);
            }
            list.append(row);
        }
        }
    }
    function renderProjects() {
        ui.renderSessions();
        const list = ui.byId('projects-list'); list.replaceChildren();
        ui.byId('project-register-form').hidden = true;
        ui.byId('projects-status').textContent = '项目与对话统一在侧栏管理。移除登记不会删除电脑文件。';
        if (ui.canManageProjectFolders()) {
            const create = ui.element('button', 'button secondary', '新建项目'); create.type = 'button'; create.onclick = () => ui.editProject(); list.append(create);
        }
        for (const project of core.state.projects.filter(project => !project.revoked)) {
            const row = ui.element('li', 'project-row'); row.append(ui.element('strong', '', project.name));
            if (ui.canManageProjectFolders()) { const settings = ui.element('button', 'button secondary', '项目设置'); settings.onclick = () => ui.editProject(project); row.append(settings); } list.append(row);
        }
    }
    function renderBrowserModels() {
        const select = ui.byId('browser-model-select');
        const previous = select.value || core.savedBrowserIntent()?.modelProfileId || core.state.modelProfileId;
        select.replaceChildren();
        for (const model of core.state.models) {
            const option = ui.element('option', '', `${model.name} · ${model.sourceKind === 'local' ? '电脑本机' : '电脑云端'}`);
            option.value = model.id;
            select.append(option);
        }
        select.value = core.state.models.some((item) => item.id === previous) ? previous : core.state.models[0]?.id || '';
        select.disabled = !core.state.models.length || !core.state.browserAvailable;
        const selected = core.state.models.find((item) => item.id === select.value);
        ui.byId('browser-destination').textContent = selected
            ? `网页实际读取的正文将交给${selected.sourceKind === 'local' ? '电脑本机' : '电脑云端'}模型“${selected.name}”。`
            : '电脑尚无已配置模型，网页任务暂不能开始。';
        ui.byId('browser-workspace-form').querySelector('button[type="submit"]').disabled = !selected || !core.state.browserAvailable;
    }
    function showAccountModels(visible) {
        ui.byId('account-model-section').hidden = !visible;
    }
    function projectNotice(message) {
        ui.byId('projects-status').textContent = message;
    }
    function clearProjectView() {
        ui.byId('projects-list').replaceChildren();
        ui.byId('project-register-form').hidden = true;
    }
    function browserWorkspaceNotice(message) {
        const status = ui.byId('browser-workspace-status');
        status.hidden = false;
        status.textContent = message;
    }
    function mountAccount() {
        ui.byId('profile-display-name').addEventListener('input', () => {
            core.state.profileDraftGeneration++;
            ui.byId('profile-status').textContent = '';
            ui.errorAt('profile-error', '');
            ui.profileControls();
        });
        ui.byId('profile-avatar-file').addEventListener('change', async (event) => {
            const file = event.currentTarget.files?.[0];
            if (!file)
                return;
            const token = core.accountToken();
            const selection = ++core.state.avatarSelectionGeneration;
            core.state.profileDraftGeneration++;
            core.state.avatarGeneration++;
            ui.releaseAvatarUrl();
            ui.byId('profile-avatar-image').removeAttribute?.('src');
            ui.byId('profile-avatar-image').hidden = true;
            ui.byId('profile-avatar-placeholder').hidden = false;
            core.state.avatarChecking = true;
            core.state.profileDraftAvatar = undefined;
            ui.profileControls();
            ui.byId('profile-status').textContent = '';
            ui.byId('profile-avatar-status').textContent = '正在检查并预览头像…';
            ui.errorAt('profile-error', '');
            try {
                if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
                    throw new Error('头像仅支持 PNG、JPEG 或 WebP。');
                if (file.size < 16 || file.size > 128 * 1024)
                    throw new Error('头像不能超过 128 KiB，且须为有效图片。');
                const bytes = new Uint8Array(await file.arrayBuffer());
                if (!core.accountCurrent(token) || selection !== core.state.avatarSelectionGeneration)
                    return;
                if (!core.avatarSignature(bytes, file.type))
                    throw new Error('图片格式与文件内容不符，请选择有效图片。');
                let binary = '';
                for (let index = 0; index < bytes.length; index += 8192)
                    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
                const avatar = { mimeType: file.type, dataBase64: btoa(binary) };
                if (!core.accountCurrent(token) || selection !== core.state.avatarSelectionGeneration)
                    return;
                const previewed = await ui.paintAvatar(avatar, token, file);
                if (!core.accountCurrent(token) || selection !== core.state.avatarSelectionGeneration)
                    return;
                if (!previewed)
                    throw new Error('图片无法解码，请重新选择有效图片。');
                core.state.profileDraftAvatar = avatar;
                ui.byId('profile-avatar-status').textContent = '新头像待保存。';
            }
            catch (error) {
                if (!core.accountCurrent(token) || selection !== core.state.avatarSelectionGeneration)
                    return;
                ui.byId('profile-avatar-status').textContent = error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? core.interfaceText(error.message) : '无法读取这张图片，请重新选择。';
                ui.byId('profile-avatar-file').value = '';
                void ui.paintAvatar(core.state.account?.avatar ?? null, token);
            }
            finally {
                if (core.accountCurrent(token) && selection === core.state.avatarSelectionGeneration) {
                    core.state.avatarChecking = false;
                    ui.profileControls();
                }
            }
        });
        ui.byId('profile-avatar-remove').addEventListener('click', () => {
            if (core.state.currentView !== 'account')
                return;
            if (!(core.state.profileDraftAvatar === undefined ? core.state.account?.avatar : core.state.profileDraftAvatar))
                return;
            core.state.avatarSelectionGeneration++;
            core.state.profileDraftGeneration++;
            core.state.avatarChecking = false;
            core.state.profileDraftAvatar = null;
            ui.byId('profile-status').textContent = '';
            ui.byId('profile-avatar-file').value = '';
            ui.byId('profile-avatar-status').textContent = '头像将在保存后移除。';
            ui.errorAt('profile-error', '');
            void ui.paintAvatar(null, core.accountToken());
            ui.profileControls();
        });
        ui.byId('profile-cancel').addEventListener('click', () => {
            if (core.state.currentView !== 'account')
                return;
            ui.resetProfileDraft();
            ui.byId('profile-status').textContent = '已取消未保存的修改。';
        });
        ui.byId('profile-reload').addEventListener('click', () => { void core.refreshProfile({ preserveDraft: true }); });
        ui.byId('profile-form').addEventListener('submit', event => { event.preventDefault(); void core.saveProfileDraft({ displayName: ui.byId('profile-display-name').value }); });
        ui.byId('devices-refresh').addEventListener('click', core.refreshDevices);
        for (const [id, name] of [['devices-refresh', '刷新设备'], ['profile-reload', '重新读取资料']]) {
            const button = ui.byId(id); button.className = 'icon-button'; button.replaceChildren(WeftIcons.create('sync', 18)); button.setAttribute('aria-label', name); button.title = name;
        }
        ui.byId('logout-button').addEventListener('click', async () => {
            const button = ui.byId('logout-button');
            const token = core.accountToken();
            button.disabled = true;
            try {
                await core.logout();
                if (!core.accountIdentityCurrent(token))
                    return;
                core.clearSession();
                core.show('login');
                ui.toast('已退出当前设备。');
            }
            catch (error) {
                if (!core.accountIdentityCurrent(token))
                    return;
                if (error.code === 'UNAUTHORIZED')
                    core.sessionExpired();
                else
                    ui.toast(core.failureMessage(error));
            }
            finally {
                button.disabled = false;
            }
        });
        ui.byId('password-open').addEventListener('click', () => ui.byId('password-dialog').showModal());
        ui.byId('password-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const token = core.accountToken();
            let completionToken = null;
            ui.errorAt('password-error', '');
            const currentPassword = ui.byId('current-password').value;
            const newPassword = ui.byId('new-password').value;
            const confirmation = ui.byId('new-confirm').value;
            if (Array.from(newPassword).length < 15 || Array.from(newPassword).length > 128)
                return ui.errorAt('password-error', '新密码须为 15–128 个字符。');
            if (newPassword !== confirmation)
                return ui.errorAt('password-error', '两次输入的新密码不一致。');
            if (!currentPassword)
                return ui.errorAt('password-error', '请输入当前密码。');
            ui.setBusy(form, true);
            try {
                const changed = await core.changePassword(currentPassword, newPassword);
                if (!core.accountIdentityCurrent(token))
                    return;
                core.acceptSession(changed);
                completionToken = core.accountToken();
                ui.byId('password-dialog').close();
                ui.toast('密码已修改，其他设备需要重新登录。');
                await core.refreshDevices();
            }
            catch (error) {
                if (!core.accountIdentityCurrent(token))
                    return;
                if (error.code === 'UNAUTHORIZED')
                    core.sessionExpired();
                else
                    ui.errorAt('password-error', core.failureMessage(error));
            }
            finally {
                if (core.accountIdentityCurrent(completionToken ?? token)) {
                    ui.clearPasswords('current-password', 'new-password', 'new-confirm');
                    ui.setBusy(form, false);
                }
            }
        });
        ui.byId('revoke-confirm').addEventListener('click', async () => {
            if (!core.state.revokeId)
                return;
            const button = ui.byId('revoke-confirm');
            const token = core.accountToken();
            const revokeId = core.state.revokeId;
            button.disabled = true;
            ui.errorAt('revoke-error', '');
            try {
                const result = await core.revokeDevice(revokeId);
                if (!core.accountCurrent(token) || core.state.revokeId !== revokeId)
                    return;
                if (result?.revoked !== true)
                    throw { code: 'REQUEST_FAILED' };
                ui.byId('revoke-dialog').close();
                core.state.revokeId = null;
                core.state.deviceNotice = '设备撤销已收到宿主回执。';
                await core.refreshDevices();
            }
            catch (error) {
                if (!core.accountCurrent(token) || core.state.revokeId !== revokeId)
                    return;
                if (error.code === 'UNAUTHORIZED')
                    core.sessionExpired();
                else
                    ui.errorAt('revoke-error', '撤销未确认成功，请检查连接后重试。');
            }
            finally {
                button.disabled = false;
            }
        });
        for (const button of document.querySelectorAll('[data-close]'))
            button.addEventListener('click', () => ui.byId(button.dataset.close).close());
        ui.byId('password-dialog').addEventListener('close', () => ui.clearPasswords('current-password', 'new-password', 'new-confirm'));
        for (const button of document.querySelectorAll('.reveal'))
            button.addEventListener('click', () => {
                const input = ui.byId(button.dataset.target);
                const revealed = input.type === 'password';
                input.type = revealed ? 'text' : 'password';
                button.textContent = revealed ? '隐藏' : '显示';
                button.setAttribute('aria-label', revealed ? '隐藏密码' : '显示密码');
            });
    }
    function profileStatus(message) { ui.byId('profile-status').textContent = message; }
    function profileError(message) { ui.errorAt('profile-error', message); }
    function showProfileReload(visible) { ui.byId('profile-reload').hidden = !visible; }
    function paintPendingDevices(payload, current) {
        ui.paintCloudPending?.(payload);
        const list = ui.byId('pending-device-list');
        list.replaceChildren();
        ui.byId('pending-devices').hidden = payload.devices.length === 0;
        ui.byId('pending-device-badge').hidden = payload.devices.length === 0;
        ui.errorAt('pending-device-error', '');
        for (const device of payload.devices) {
            const item = ui.element('li', 'device-item');
            const content = ui.element('div', 'device-content');
            content.append(ui.element('strong', '', device.name || '新设备'), ui.element('p', 'device-meta', `请求于 ${core.formatDate(device.requestedAt)}`), ui.element('code', 'device-meta', device.fingerprint));
            const actions = ui.element('div', 'actions');
            for (const [decision, label] of [['allow', '允许'], ['deny', '拒绝']]) {
                const button = ui.element('button', decision === 'allow' ? 'button primary small' : 'button secondary small', label);
                button.type = 'button';
                button.addEventListener('click', async () => {
                    for (const control of actions.children)
                        control.disabled = true;
                    try {
                        if (ui.decideCloudDevice) await ui.decideCloudDevice(device, decision);
                        else await core.decideDevice(device.id, decision);
                        if (current())
                            await core.refreshPendingDevices();
                    }
                    catch (error) {
                        if (!current())
                            return;
                        ui.errorAt('pending-device-error', core.failureMessage(error));
                        for (const control of actions.children)
                            control.disabled = false;
                    }
                });
                actions.append(button);
            }
            item.append(content, actions);
            list.append(item);
        }
    }
    function pendingDevicesError(message) {
        ui.errorAt('pending-device-error', message);
    }
    function profileNameInput() {
        return ui.byId('profile-display-name').value;
    }
    function paintProfileReadFields(nameWasChanged, avatarWasChanged, token) {
        if (!nameWasChanged)
            ui.byId('profile-display-name').value = core.profileName();
        if (!avatarWasChanged) {
            ui.byId('profile-avatar-status').textContent = core.state.account.avatar ? '已更新为账户当前头像。' : '账户当前未设置头像。';
            void ui.paintAvatar(core.state.account.avatar ?? null, token);
        }
    }
    function devicesNotice(message) {
        ui.byId('devices-loading').textContent = message;
    }
    function devicesNoticeHidden(hidden) {
        ui.byId('devices-loading').hidden = hidden;
    }
    function browserWorkspaceText(message) {
        ui.byId('browser-workspace-status').textContent = message;
    }
    function browserWorkspaceHidden(hidden) {
        ui.byId('browser-workspace-status').hidden = hidden;
    }
    function browserWorkspaceAvailable(available) {
        ui.byId('browser-workspace-form').hidden = !available;
    }
    function browserUrlDraft(value) {
        ui.byId('browser-url-list').value = value;
    }
    function browserGoalDraft(value) {
        ui.byId('browser-goal').value = value;
    }
    return { profileDirty, profileControls, releaseAvatarUrl, paintAvatar, resetProfileDraft, renderDevices, accountModelStatus, renderAccountModels, renderProjects, renderBrowserModels, showAccountModels, projectNotice, clearProjectView, browserWorkspaceNotice, mountAccount, profileStatus, profileError, showProfileReload, paintPendingDevices, pendingDevicesError, profileNameInput, paintProfileReadFields, devicesNotice, devicesNoticeHidden, browserWorkspaceText, browserWorkspaceHidden, browserWorkspaceAvailable, browserUrlDraft, browserGoalDraft };
};
