/* Account/device presentation; all requests and credential handling live in ui-core. */
globalThis.WeftMobileCloudSettings = (core, ui) => {
    let pairingTimer, directoryTimer, tab = 'account', editingId = null, editingGeneration = -1, directoryGeneration = 0, pairingGeneration = 0;
    const button = (label, action, style = 'secondary') => { const node = ui.element('button', `button ${style}`, label); node.type = 'button'; node.addEventListener('click', action); return node; };
    function error(error) { const message = core.cloudError(error); ui.byId('cloud-settings-status').textContent = message; const local = document.getElementById('cloud-confirm-error'); if (local) local.textContent = message; }
    async function act(action) { try { ui.byId('cloud-settings-status').textContent = ''; await action(); return true; } catch (failure) { error(failure); return false; } }
    function mountCloudSettings() {
        const panel = ui.byId('cloud-settings-view');
        panel.innerHTML = '<nav class="actions" aria-label="设置分类"><button class="button secondary" type="button" id="cloud-account-tab">账户</button><button class="button secondary" type="button" id="cloud-devices-tab">设备</button></nav><p id="cloud-settings-status" class="form-error" role="status"></p><section id="cloud-account-panel" aria-label="账户"><h2>账户</h2><p class="account-row"><span>邮箱</span><strong id="cloud-email"></strong></p><div class="actions" id="cloud-account-actions"></div><div id="cloud-account-flow"></div></section><section id="cloud-devices-panel" aria-label="设备" hidden><div class="group-heading"><h2>设备</h2><button class="button secondary" type="button" id="cloud-directory-refresh">刷新设备</button></div><p id="cloud-directory-status" class="muted" role="status"></p><ul id="cloud-directory" class="device-list" aria-live="polite"></ul></section>';

        panel.querySelector('nav').hidden = true;
        const help=ui.element('p','muted','在电脑上安装 WeftMate 并用同一个账号登录，就会出现在这里。');
        const website=ui.element('a','button secondary','WeftMate 官网');website.href='https://weftmate.com';website.target='_blank';website.rel='noopener';
        ui.byId('cloud-devices-panel').append(help,website);
        const pairing = ui.element('form', 'cloud-account-form'); pairing.id = 'cloud-pairing-form';
        pairing.innerHTML = '<h3>连接电脑</h3><p class="muted">扫描电脑上的二维码，或粘贴 wm1. 配对码，然后核对两边的六位数字。</p><label for="cloud-pairing-input">输入电脑的配对码</label><textarea id="cloud-pairing-input" rows="3" spellcheck="false" autocapitalize="off" required></textarea><div class="actions"><button type="button" class="button secondary" id="cloud-pairing-scan">扫描二维码</button><button type="submit" class="button primary" id="cloud-pairing-connect">配对连接</button></div><p class="form-error" role="alert" id="cloud-pairing-error"></p>';
        ui.byId('cloud-devices-panel').append(pairing);
        ui.byId('cloud-pairing-scan').addEventListener('click', () => void ui.scanPairing());
        pairing.addEventListener('submit', async event => {
            event.preventDefault(); ui.byId('cloud-pairing-error').textContent = ''; ui.setBusy(pairing, true);
            try { await core.cloudRedeemPairing(ui.byId('cloud-pairing-input').value); ui.byId('cloud-pairing-input').value = ''; await core.enterAssistant(); }
            catch (failure) { ui.byId('cloud-pairing-error').textContent = core.cloudError(failure); }
            finally { ui.setBusy(pairing, false); }
        });
        const refresh = ui.byId('cloud-directory-refresh'); refresh.className = 'icon-button'; refresh.replaceChildren(WeftIcons.create('sync', 18)); refresh.setAttribute('aria-label', '刷新设备');
        ui.byId('cloud-account-tab').addEventListener('click', () => select('account'));
        ui.byId('cloud-devices-tab').addEventListener('click', () => { select('devices'); void refreshDirectory(); });
        ui.byId('cloud-directory-refresh').addEventListener('click', () => void refreshDirectory());
        const actions = ui.byId('cloud-account-actions');
        actions.append(button('换绑邮箱', () => accountFlow('email')), button('修改密码', () => accountFlow('password')),
            button('退出登录', () => void act(core.cloudLogout)), button('退出所有其他设备', () => confirmAction('退出所有其他设备', '其他设备将退出登录，当前设备继续可用。', async () => { await core.cloudLogoutOthers(); await refreshDirectory(); })),
            button('注销账号', () => page('data'), 'danger'));
        directoryTimer = setInterval(() => { if (document.visibilityState === 'visible' && core.state.cloudAuth.mode === 'authenticated') { void refreshDirectory(false); void core.refreshPendingDevices(); } }, 30000);
    }
    function select(value) {
        tab = value; ui.byId('cloud-account-panel').hidden = tab !== 'account'; ui.byId('cloud-devices-panel').hidden = tab !== 'devices';
        ui.byId('cloud-account-tab').setAttribute('aria-pressed', String(tab === 'account')); ui.byId('cloud-devices-tab').setAttribute('aria-pressed', String(tab === 'devices'));
        if (tab !== 'devices') stopPairing();
    }
    function paintCloudSettings(value = tab) {
        ui.byId('cloud-email').textContent = core.state.cloudAuth.email;
        select(value); void refreshDirectory(); void core.refreshPendingDevices();
    }
    async function refreshDirectory(showError = true) {
        if (core.state.cloudAuth.mode !== 'authenticated') return;
        const generation = core.state.identityGeneration, request = ++directoryGeneration;
        const status = ui.byId('cloud-directory-status'), list = ui.byId('cloud-directory'); list.setAttribute('aria-busy', 'true');
        if (!list.children.length) { status.textContent = '正在读取设备…'; for (let index = 0; index < 3; index++) { const row = ui.element('li', 'library-skeleton-row'); row.setAttribute('aria-hidden', 'true'); row.append(ui.element('span', 'library-skeleton-icon'), ui.element('span', 'library-skeleton-line')); list.append(row); } }
        try { const directory = await core.cloudDirectory(); if (generation !== core.state.identityGeneration || request !== directoryGeneration) return; status.textContent = ''; list.setAttribute('aria-busy', 'false'); renderDirectory(directory); }
        catch (failure) { if (generation === core.state.identityGeneration && request === directoryGeneration) { list.setAttribute('aria-busy', 'false'); for (const row of list.querySelectorAll('.library-skeleton-row')) row.remove(); status.textContent = '设备暂时无法读取。请点刷新重试。'; if (showError) error(failure); } }
    }
    function deviceTime(value) { return core.cloudDeviceTime(value); }
    function logoutDevice(device) {
        confirmAction('让设备下线', `“${device.name}”将立即退出登录。再次使用时需要重新登录。`, async () => {
            if (core.state.cloudAuth.mode !== 'authenticated') await core.logoutLocalDevice(device.id);
            else if(device.hostId&&core.state.cloudAuth.multiHostSupported)await core.cloudRemoveComputer(device.hostId);
            else { await core.cloudRemove(device.id); if (device.isCurrent) await core.cloudLogout(); }
            await refreshDirectory();
            ui.toast('设备已下线。');
        });
    }
    function renameDevice(device) {
        editingId = device.id; editingGeneration = core.state.identityGeneration;
        const dialog = ui.element('dialog', 'dialog confirm-dialog cloud-device-dialog'); dialog.setAttribute('aria-label', '修改设备名称');
        const form = ui.element('form'), head = ui.element('div', 'dialog-head'), body = ui.element('div', 'dialog-body'), footer = ui.element('div', 'dialog-footer');
        head.append(ui.element('h2', '', '修改设备名称'));
        const label = ui.element('label', '', '设备名称'), input = ui.element('input'); input.value = device.name; input.maxLength = 128; input.required = true; label.append(input); body.append(label);
        const feedback = ui.element('p', 'form-error'); feedback.setAttribute('role', 'alert'); body.append(feedback);
        const save = ui.element('button', 'button primary', '保存名称'); save.type = 'submit'; footer.append(button('取消', () => dialog.close()), save);
        form.append(head, body, footer); dialog.append(form);
        form.addEventListener('submit', async event => { event.preventDefault(); if (editingGeneration !== core.state.identityGeneration) { dialog.close(); return; } const identity = editingGeneration; save.disabled = true; try { const directory = await (device.hostId&&core.state.cloudAuth.multiHostSupported?core.cloudRenameComputer(device.hostId,input.value):core.cloudRename(device.id, input.value)); if (identity !== core.state.identityGeneration) { dialog.close(); return; } editingId = null; renderDirectory(directory); dialog.close(); ui.toast('设备名称已保存。'); } catch (failure) { feedback.textContent = core.cloudError(failure); } finally { save.disabled = false; } });
        dialog.addEventListener('close', () => { editingId = null; dialog.remove(); }); document.body.append(dialog); dialog.showModal(); input.focus();
    }
    function showDevice(device) {
        const identity = core.state.identityGeneration;
        const dialog = ui.element('dialog', 'dialog confirm-dialog cloud-device-dialog'); dialog.setAttribute('aria-label', '设备详情');
        const head = ui.element('div', 'dialog-head'), body = ui.element('div', 'dialog-body'), footer = ui.element('div', 'dialog-footer');
        head.append(ui.element('h2', '', device.name));
        body.append(ui.element('p', 'muted', device.isCurrent ? '这是你正在使用的设备。' : '如果不认识这台设备，可以让它立即下线。'),
            ui.element('p', 'device-meta', `首次登录 ${deviceTime(device.firstUsedAt || device.firstLoginAt || device.createdAt || device.confirmedAt || device.enrolledAt)}`),
            ui.element('p', 'device-meta', `最近使用 ${deviceTime(device.lastUsedAt || device.lastSeenAt)}`));
        footer.append(button('关闭', () => dialog.close()));
        if (!device.hostOnly) footer.append(button('让设备下线', () => { dialog.close(); if (identity === core.state.identityGeneration) logoutDevice(device); }, 'danger'));
        dialog.append(head, body, footer); dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
    }
    function renderDirectory({ devices = [], hosts = [] }) {
        if (editingId && editingGeneration === core.state.identityGeneration) return;
        editingId = null;
        const identity = core.state.identityGeneration, list = ui.byId('cloud-directory'); list.replaceChildren();
        ui.byId('cloud-directory-status').textContent = core.state.cloudAuth.mode === 'authenticated' && !hosts.length ? '这个账号还没有连上电脑。在电脑上用同一个账号登录后，这里会出现。' : '';
        const currentHost = hosts.find(host => host.isCurrent), currentDevice = devices.find(device => device.isCurrent), linked = new Set();
        const rows = devices.map(device => {
            const matches = hosts.filter(host => host.name === device.name);
            const host = hosts.length>1&&core.state.cloudAuth.multiHostSupported ? hosts.find(host=>host.hostId===device.hostId) : device === currentDevice ? currentHost : ['windows', 'macos'].includes(device.type) && matches.length === 1 ? matches[0] : null;
            if (host) linked.add(host.hostId);
            return host ? { ...device, name:host.displayName||host.name,hostId: host.hostId, type: 'computer', online: host.online } : device;
        });
        for (const device of [...rows.filter(device => !device.revoked), ...hosts.filter(host => !linked.has(host.hostId)).map(host => ({ ...host, hostOnly: true }))]) {
            const row = ui.element('li', 'device-item cloud-device-row'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', device.name);
            const summary = ui.element('button', 'cloud-device-summary'); summary.type = 'button'; summary.setAttribute('aria-label', `查看 ${device.name}`);
            const icon = globalThis.WeftIcons.create(device.type === 'computer' || ['windows', 'macos'].includes(device.type) ? 'desktop' : ['android', 'ios'].includes(device.type) ? 'phone' : device.type === 'watch' ? 'watch' : 'web', 24);
            const content = ui.element('div', 'device-content'), title = ui.element('div', 'device-title'); title.append(ui.element('strong', '', device.name));
            if (device.isCurrent) title.append(ui.element('span', 'badge', '这台设备'));
            content.append(title, ui.element('p', 'device-meta', `首次登录 ${deviceTime(device.firstUsedAt || device.firstLoginAt || device.createdAt || device.confirmedAt || device.enrolledAt)}`),
                ui.element('p', 'device-meta', `最近使用 ${deviceTime(device.lastUsedAt || device.lastSeenAt)}${device.hostId ? device.online ? ' · 电脑在线' : ' · 电脑离线' : ''}`));
            summary.append(icon, content); summary.addEventListener('click', () => showDevice(device));
            const actions = ui.element('div', 'actions cloud-device-actions');
            if (device.type === 'computer' && !device.isCurrent) actions.append(button('连接', () => void act(async () => {
                const result = await core.cloudConnect(device.hostId);
                if (result.status !== 'online') { ui.byId('cloud-settings-status').textContent = '这台电脑离线，请稍后重试。'; return; }
                if (result.pairingRequired) { ui.byId('cloud-settings-status').textContent = '请扫描这台电脑上的二维码，核对六位数字后连接。'; ui.byId('cloud-pairing-input').focus(); return; }
                await core.cloudConnectTrusted(result); await core.enterAssistant();
            })));
            if (!device.hostOnly || device.hostId&&core.state.cloudAuth.multiHostSupported) {
                const more = ui.element('button', 'icon-button'); more.type = 'button'; more.setAttribute('aria-label', `${device.name}的更多操作`); more.setAttribute('aria-haspopup', 'menu'); more.append(globalThis.WeftIcons.create('more', 18));
                more.addEventListener('click', () => globalThis.WeftPopover.menu(more, [
                    ...(core.state.cloudAuth.mode === 'authenticated' ? [{ name: '修改名称', icon: 'edit', action: () => { if (identity === core.state.identityGeneration) renameDevice(device); } }] : []),
                    { name: '让设备下线', icon: 'logout', danger: true, action: () => { if (identity === core.state.identityGeneration) logoutDevice(device); } },
                ], failure => error(failure))); actions.append(more);
            }
            row.append(summary, actions); list.append(row);
        }
        if (!list.children.length) {
            const empty = ui.element('li', 'cloud-device-empty'); empty.append(globalThis.WeftIcons.create('desktop', 28), ui.element('p', 'muted', '还没有其他已登录设备。')); list.append(empty);
        }
    }
    function confirmAction(title, description, action) {
        const identity = core.state.identityGeneration;
        const dialog = ui.element('dialog', 'dialog confirm-dialog cloud-device-dialog'); dialog.setAttribute('aria-label', title);
        const head = ui.element('div', 'dialog-head'), body = ui.element('div', 'dialog-body'), footer = ui.element('div', 'dialog-footer'), feedback = ui.element('p', 'form-error'); feedback.setAttribute('role', 'alert');
        head.append(ui.element('h2', '', title)); body.append(ui.element('p', '', description), feedback);
        const cancel = button('取消', () => dialog.close()), confirm = button('确认下线', async () => { if (identity !== core.state.identityGeneration) { dialog.close(); return; } confirm.disabled = cancel.disabled = true; try { await action(); dialog.close(); } catch (failure) { feedback.textContent = core.cloudError(failure); } finally { confirm.disabled = cancel.disabled = false; } }, 'danger');
        footer.append(cancel, confirm); dialog.append(head, body, footer);
        dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal(); cancel.focus();
    }
    function accountFlow(kind) {
        const container = kind === 'delete' ? ui.element('dialog', 'cloud-settings') : ui.byId('cloud-account-flow'), form = ui.element('form', 'cloud-account-form');
        container.replaceChildren(form);
        if (kind === 'delete') { container.setAttribute('aria-label', '注销账号'); container.addEventListener('close', () => container.remove()); document.body.append(container); container.showModal(); }
        const finish = () => { if (kind === 'delete') container.close(); else container.replaceChildren(); };
        const input = (label, type = 'text') => { const node = ui.element('input'); node.type = type; node.required = true; const lab = ui.element('label', '', label); lab.append(node); form.append(lab); return node; };
        const title = { email: '换绑邮箱', password: '修改密码', delete: '注销账号' }[kind]; form.append(ui.element('h3', '', title));
        const email = kind === 'email' ? input('新邮箱', 'email') : null;
        const current = ['password', 'delete'].includes(kind) ? input(kind === 'delete' ? '密码' : '当前密码', 'password') : null;
        const password = kind === 'password' ? input('新密码', 'password') : null;
        const confirmation = password ? input('确认密码', 'password') : null;
        if (kind === 'delete') { form.append(ui.element('p', 'form-error', '云端账号数据全部删除且不可恢复，本机的对话与记忆仍留在设备上')); const status = ui.element('p', 'form-error'); status.id = 'cloud-confirm-error'; status.setAttribute('role', 'alert'); form.append(status); }
        const submit = ui.element('button', 'button primary', kind === 'email' ? '发送验证码' : kind === 'delete' ? '确认注销' : '保存'); submit.type = 'submit'; form.append(submit, button('取消', finish));
        let code;
        form.addEventListener('submit', event => { event.preventDefault(); submit.disabled = true; void act(async () => {
            if (kind === 'email' && !code) { await core.cloudEmailRequest(email.value); code = input('验证码'); form.insertBefore(code.parentNode, submit); code.inputMode = 'numeric'; code.maxLength = 6; email.disabled = true; submit.textContent = '确认换绑'; code.focus(); return; }
            if (kind === 'email') await core.cloudEmailConfirm(code.value);
            if (kind === 'password') await core.cloudChangePassword(current.value, password.value, confirmation.value);
            if (kind === 'delete') await core.cloudDeleteAccount(current.value);
            finish();
        }).finally(() => { submit.disabled = false; if (current) current.value = ''; if (password) password.value = ''; if (confirmation) confirmation.value = ''; }); });
    }
    function stopPairing() { pairingGeneration++; clearTimeout(pairingTimer); }
    function paintCloudPending() {
        // Device login notifications use the shared activity/notification feed.
        const banner = ui.byId('cloud-access-banner'); if (banner) { banner.hidden = true; banner.replaceChildren(); }
        const pending = ui.byId('pending-devices'); if (pending) pending.hidden = true;
    }
    async function decideCloudDevice(device, decision) { await core.decideDevice(device.id, decision); }
    return { mount: mountCloudSettings, open: paintCloudSettings, pending: paintCloudPending };
};
