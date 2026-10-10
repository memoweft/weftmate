/* Account/device presentation; all requests and credential handling live in ui-core. */
globalThis.WeftUiComponents.factories.cloudSettings = (core, ui) => {
    let pairingTimer, directoryTimer, tab = 'account', editingId = null, editingGeneration = -1, directoryGeneration = 0, pairingGeneration = 0;
    const button = (label, action, style = 'secondary') => { const node = ui.element('button', `button ${style}`, label); node.type = 'button'; node.addEventListener('click', action); return node; };
    function error(error) { ui.byId('cloud-settings-status').textContent = core.cloudError(error); }
    async function act(action) { try { ui.byId('cloud-settings-status').textContent = ''; await action(); return true; } catch (failure) { error(failure); return false; } }
    function mountCloudSettings() {
        if (!globalThis.location?.origin) return;
        const account = ui.byId('account-view');
        const panel = ui.element('section', 'card group cloud-settings'); panel.id = 'cloud-settings'; panel.hidden = true;
        panel.innerHTML = '<nav class="actions" aria-label="设置分类"><button class="button secondary" type="button" id="cloud-account-tab">账户</button><button class="button secondary" type="button" id="cloud-devices-tab">设备</button></nav><p id="cloud-settings-status" class="form-error" role="status"></p><section id="cloud-account-panel" aria-label="账户"><h2>账户</h2><p class="account-row"><span>邮箱</span><strong id="cloud-email"></strong></p><div class="actions" id="cloud-account-actions"></div><div id="cloud-account-flow"></div></section><section id="cloud-devices-panel" aria-label="设备" hidden><div class="group-heading"><h2>设备</h2><button class="button secondary" type="button" id="cloud-directory-refresh">刷新设备</button></div><ul id="cloud-directory" class="device-list"></ul><div class="actions" id="cloud-device-actions"></div><div id="cloud-pairing" hidden><img alt="一次性设备配对二维码" id="cloud-pairing-qr" hidden><p class="muted">用新设备扫码或输入配对码。两分钟自动刷新。</p><label for="cloud-pairing-code">配对码</label><textarea id="cloud-pairing-code" readonly></textarea><button class="button quiet" id="cloud-pairing-close" type="button">关闭配对码</button></div><label for="cloud-pairing-input">输入电脑的配对码</label><textarea id="cloud-pairing-input"></textarea><button type="button" class="button secondary" id="cloud-pairing-connect">配对连接</button><p class="field-help">共享给其他账号：S5 后续开放，须主设备确认。</p></section>';
        const refresh = panel.querySelector('#cloud-directory-refresh'); refresh.className='icon-button'; refresh.replaceChildren(WeftIcons.create('sync',18)); refresh.setAttribute('aria-label','刷新设备'); refresh.title='刷新设备';
        account.prepend(panel);
        ui.byId('cloud-account-tab').addEventListener('click', () => select('account'));
        ui.byId('cloud-devices-tab').addEventListener('click', () => { select('devices'); void refreshDirectory(); });
        ui.byId('cloud-directory-refresh').addEventListener('click', () => void refreshDirectory());
        ui.byId('cloud-pairing-close').addEventListener('click', stopPairing);
        ui.byId('cloud-pairing-connect').addEventListener('click', () => void act(async () => { await core.cloudRedeemPairing(ui.byId('cloud-pairing-input').value); await core.enterAssistant(); }));
        const actions = ui.byId('cloud-account-actions');
        actions.append(button('换绑邮箱', () => accountFlow('email')), button('修改密码', () => accountFlow('password')),
            button('退出登录', () => void act(core.cloudLogout)), button('退出所有其他设备', () => confirmAction('退出所有其他设备', '其他设备将退出登录，当前设备继续可用。', async () => { await core.cloudLogoutOthers(); await refreshDirectory(); })),
            button('注销账号', () => accountFlow('delete'), 'danger'));
        if (globalThis.weftmateDesktop) {
            actions.append(button('设置离线密码', () => accountFlow('emergency')));
            ui.byId('cloud-device-actions').append(button('添加设备', () => void showPairing()));
        }
        const original = core.openAccount;
        core.openAccount = () => { original(); paintCloudSettings(); };
        ui.byId('rail-devices').addEventListener('click', () => { ui.openSettings('devices'); });
        const banner = ui.element('div', 'cloud-access-banner'); banner.id = 'cloud-access-banner'; banner.hidden = true;
        ui.byId('connection-banner').before(banner);
        directoryTimer = setInterval(() => { if (document.visibilityState === 'visible' && core.state.cloudAuth.mode === 'authenticated') void refreshDirectory(false); }, 30000);
    }
    function select(value) {
        tab = value; ui.byId('cloud-account-panel').hidden = tab !== 'account'; ui.byId('cloud-devices-panel').hidden = tab !== 'devices';
        ui.byId('cloud-account-tab').setAttribute('aria-pressed', String(tab === 'account')); ui.byId('cloud-devices-tab').setAttribute('aria-pressed', String(tab === 'devices'));
        if (tab !== 'devices') stopPairing();
    }
    function paintCloudSettings() {
        if (!ui.byId('cloud-settings')) return;
        const active = core.state.cloudAuth.mode === 'authenticated';
        ui.byId('cloud-settings').hidden = !active;
        ui.byId('cloud-devices-panel').hidden = !active || tab !== 'devices';
        if (!active) ui.byId('devices-heading').closest('section').append(ui.byId('pending-devices'));
        for (const id of ['account-heading', 'devices-heading']) ui.byId(id).closest('section').hidden = active;
        ui.byId('cloud-account').hidden = true;
        if (!active) { void ui.cloudUi?.refreshBinding(); return; }
        ui.byId('cloud-email').textContent = core.state.cloudAuth.email;
        select(tab); void refreshDirectory();
    }
    async function refreshDirectory(showError = true) {
        if (core.state.cloudAuth.mode !== 'authenticated') return;
        const generation = core.state.identityGeneration, request = ++directoryGeneration;
        try { const directory = await core.cloudDirectory(); if (generation !== core.state.identityGeneration || request !== directoryGeneration) return; renderDirectory(directory); }
        catch (failure) { if (showError) error(failure); }
    }
    function renderDirectory({ devices, hosts }) {
        if (editingId && editingGeneration === core.state.identityGeneration) return;
        editingId = null;
        const list = ui.byId('cloud-directory'); list.replaceChildren();
        const currentHost = hosts.find(host => host.isCurrent), currentDevice = devices.find(device => device.isCurrent);
        const linked = new Set();
        const rows = devices.map(device => {
            const matches = hosts.filter(host => host.name === device.name);
            const host = device === currentDevice ? currentHost : ['windows', 'macos'].includes(device.type) && matches.length === 1 ? matches[0] : null;
            if (host) linked.add(host.hostId);
            return host ? { ...device, hostId: host.hostId, type: 'computer', online: host.online } : device;
        });
        for (const device of [...rows, ...hosts.filter(host => !linked.has(host.hostId)).map(host => ({ ...host, hostOnly: true }))]) {
            const row = ui.element('li', 'device-item'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', device.name);
            const icon = globalThis.WeftIcons.create(device.type === 'computer' || ['windows', 'macos'].includes(device.type) ? 'desktop' : ['android', 'ios'].includes(device.type) ? 'phone' : device.type === 'watch' ? 'watch' : 'web', 24);
            const content = ui.element('div', 'device-content'); content.append(ui.element('strong', '', device.name),
                ui.element('p', 'device-meta', `${device.online ? '在线' : '离线'} · 最近使用 ${core.formatDate(device.lastUsedAt)}${device.isCurrent ? ' · 这台设备' : ''}${device.type === 'computer' ? ' · 可执行任务' : ''}`));
            const actions = ui.element('div', 'actions');
            if (!device.hostOnly) actions.append(button('改名', () => {
                editingId = device.id; editingGeneration = core.state.identityGeneration;
                const form = ui.element('form', 'device-edit'), input = ui.element('input'); input.value = device.name; input.maxLength = 128; input.setAttribute('aria-label', '设备名称');
                const save = ui.element('button', 'button primary', '保存名称'); save.type = 'submit'; form.append(input, save, button('取消', () => { editingId = null; void refreshDirectory(); }));
                form.addEventListener('submit', event => { event.preventDefault(); save.disabled = true; void act(async () => { const directory = await core.cloudRename(device.id, input.value); editingId = null; renderDirectory(directory); }).finally(() => { save.disabled = false; }); });
                actions.replaceChildren(form); input.focus();
            }), button('移除', () => confirmAction('移除设备', `移除“${device.name}”后，该设备立即退出，需重新登录。`, async () => { await core.cloudRemove(device.id); if (device.isCurrent) await core.cancelCloudJourney(); else await refreshDirectory(); })));
            if (device.type === 'computer') actions.append(button('连接', () => void act(async () => {
                const result = await core.cloudConnect(device.hostId);
                if (result.status !== 'online') { ui.byId('cloud-settings-status').textContent = '这台电脑离线，请稍后重试。'; return; }
                if (result.pairingRequired) { ui.byId('cloud-settings-status').textContent = '请在这台电脑上显示二维码，或在下方输入配对码。'; return; }
                await core.cloudConnectTrusted(result); await core.enterAssistant();
            })));
            row.append(icon, content, actions); list.append(row);
        }
        if (!list.children.length) list.append(ui.element('li', 'muted', '还没有其他已登录设备。'));
    }
    function confirmAction(title, description, action) {
        const dialog = ui.element('dialog', 'card group'); dialog.setAttribute('aria-label', title);
        dialog.append(ui.element('h2', '', title), ui.element('p', '', description), button('取消', () => dialog.close()), button('确认', () => { void act(action).then(ok => { if (ok) dialog.close(); }); }, 'danger'));
        dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
    }
    function accountFlow(kind) {
        const container = ui.byId('cloud-account-flow'), form = ui.element('form', 'cloud-account-form');
        container.replaceChildren(form);
        const input = (label, type = 'text') => { const node = ui.element('input'); node.type = type; node.required = true; const lab = ui.element('label', '', label); lab.append(node); form.append(lab); return node; };
        const title = { email: '换绑邮箱', password: '修改密码', delete: '注销账号', emergency: '设置离线密码' }[kind]; form.append(ui.element('h3', '', title));
        const email = kind === 'email' ? input('新邮箱', 'email') : null;
        const current = ['password', 'delete'].includes(kind) ? input(kind === 'delete' ? '密码' : '当前密码', 'password') : null;
        const password = ['password', 'emergency'].includes(kind) ? input(kind === 'emergency' ? '离线密码' : '新密码', 'password') : null;
        const confirmation = password ? input('确认密码', 'password') : null;
        if (kind === 'delete') form.append(ui.element('p', 'form-error', '云端账号数据全部删除且不可恢复，本机的对话与记忆仍留在设备上'));
        if (kind === 'emergency') form.append(ui.element('p', 'field-help', '这是本机独立应急密码，须为 15–128 位。云不可用时用它离线登录。'));
        const submit = ui.element('button', 'button primary', kind === 'email' ? '发送验证码' : kind === 'delete' ? '确认注销' : '保存'); submit.type = 'submit'; form.append(submit, button('取消', () => container.replaceChildren()));
        let code;
        form.addEventListener('submit', event => { event.preventDefault(); submit.disabled = true; void act(async () => {
            if (kind === 'email' && !code) { await core.cloudEmailRequest(email.value); code = input('验证码'); form.insertBefore(code.parentNode, submit); code.inputMode = 'numeric'; code.maxLength = 6; email.disabled = true; submit.textContent = '确认换绑'; code.focus(); return; }
            if (kind === 'email') await core.cloudEmailConfirm(code.value);
            if (kind === 'password') await core.cloudChangePassword(current.value, password.value, confirmation.value);
            if (kind === 'delete') await core.cloudDeleteAccount(current.value);
            if (kind === 'emergency') { await core.cloudEmergencyPassword(password.value, confirmation.value); ui.toast('离线密码已设置。'); }
            container.replaceChildren();
        }).finally(() => { submit.disabled = false; if (current) current.value = ''; if (password) password.value = ''; if (confirmation) confirmation.value = ''; }); });
    }
    async function showPairing() {
        const generation = ++pairingGeneration;
        clearTimeout(pairingTimer); ui.byId('cloud-pairing').hidden = false;
        ui.byId('cloud-pairing-qr').hidden = true;
        await act(async () => {
            const result = await core.cloudPairing();
            if (generation !== pairingGeneration) return;
            const code = globalThis.WeftCloud.pairingCode(result);
            ui.byId('cloud-pairing-code').value = code;
            const qr = await globalThis.WeftCloudVendor.QRCode.toDataURL((result.relay?.baseUrl || result.origin) + '/personal/v1/ui/#pair=' + code.slice(4));
            if (generation !== pairingGeneration) return;
            ui.byId('cloud-pairing-qr').src = qr;
            ui.byId('cloud-pairing-qr').hidden = false;
            pairingTimer = setTimeout(() => { if (core.state.currentView === 'account' && tab === 'devices') void showPairing(); }, 120000);
        });
    }
    function stopPairing() { pairingGeneration++; clearTimeout(pairingTimer); if (ui.byId('cloud-pairing')) { ui.byId('cloud-pairing').hidden = true; ui.byId('cloud-pairing-code').value = ''; ui.byId('cloud-pairing-qr').removeAttribute('src'); } }
    function paintCloudPending(payload) {
        if (!ui.byId('cloud-access-banner')) return;
        const banner = ui.byId('cloud-access-banner'); banner.hidden = !payload.devices.length; banner.replaceChildren();
        for (const device of payload.devices) {
            const row = ui.element('div', 'actions'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', device.name);
            row.append(ui.element('span', '', `新设备 ${device.name} 请求访问`));
            for (const [decision, label] of [['allow', '允许'], ['deny', '拒绝']]) row.append(button(label, () => void act(async () => {
                await decideCloudDevice(device, decision);
                await core.refreshPendingDevices();
            }), decision === 'allow' ? 'primary' : 'secondary'));
            banner.append(row);
        }
        // The same pending rows are available in Settings → Devices.
        const pending = ui.byId('pending-devices');
        if (core.state.cloudAuth.mode === 'authenticated') ui.byId('cloud-devices-panel').append(pending);
    }
    function showTrust(trust, name) {
        const dialog = ui.element('dialog', 'card group cloud-trust-dialog'); dialog.setAttribute('aria-label', '可信交付');
        dialog.append(ui.element('h2', '', '可信交付'), ui.element('p', '', `“${name}”已获允许。可把此码通过你的可信设备通道交给它，120 秒有效。`));
        const code = ui.element('textarea'); code.readOnly = true; code.value = core.cloudTrustMaterial(trust); code.setAttribute('aria-label', '可信交付码');
        const qr = ui.element('img'); qr.alt = '可信交付二维码';
        qr.hidden = true;
        void globalThis.WeftCloudVendor.QRCode.toDataURL(code.value).then(url => { qr.src = url; qr.hidden = false; });
        dialog.append(qr, code, button('复制可信交付码', () => void navigator.clipboard.writeText(code.value)), button('关闭', () => dialog.close()));
        const deadline = setTimeout(() => dialog.close(), 120000);
        dialog.addEventListener('close', () => { clearTimeout(deadline); dialog.remove(); }); document.body.append(dialog); dialog.showModal();
    }
    async function decideCloudDevice(device, decision) {
        await core.decideDevice(device.id, decision);
        if (decision === 'allow' && core.state.cloudAuth.mode === 'authenticated') {
            const trust = await core.cloudTrust(device.id); showTrust(trust, device.name);
            ui.toast(`已允许 ${device.name}。可信交付有效 ${trust.expiresIn} 秒。`);
        }
    }
    async function openCloudHost(connection) {
        if (globalThis.weftmateDesktop) return globalThis.weftmateDesktop.connectHost(connection);
        const url = new URL(connection.baseUrl);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw { code: 'HOST_TRUST_INVALID' };
        location.assign(new URL('/personal/v1/ui/', url.origin).href);
    }
    const activateCloudHost = target => globalThis.weftmateDesktop?.activateHost(target);
    const clearNativeHostSessions = () => globalThis.weftmateDesktop?.clearHostSessions();
    return { mountCloudSettings, paintCloudSettings, paintCloudPending, decideCloudDevice, openCloudHost, activateCloudHost, clearNativeHostSessions, selectCloudSettings: select, stopAccountPairing: stopPairing };
};
