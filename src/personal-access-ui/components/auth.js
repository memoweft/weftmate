/* Desktop auth component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.auth = (core, ui) => {
    function paintIdentity(payload) {
        ui.byId('account-name').textContent = payload.account.username;
        const name = payload.account.displayName || payload.account.username;
        ui.byId('rail-account-name').textContent = name;
        ui.byId('rail-avatar-initial').textContent = Array.from(name)[0] || 'W';
        const avatar = payload.account.avatar, image = ui.byId('rail-avatar-image');
        image.hidden = !avatar;
        ui.byId('rail-avatar-initial').hidden = !!avatar;
        if (avatar)
            image.src = `data:${avatar.mimeType};base64,${avatar.dataBase64}`;
        else
            image.removeAttribute('src');
    }
    function loginBusy(busy) {
        ui.setBusy(ui.byId('login-form'), busy);
    }
    function setupBusy(busy) {
        ui.setBusy(ui.byId('setup-form'), busy);
    }
    function loginError(message) {
        ui.errorAt('login-error', message);
    }
    function setupError(message) {
        ui.errorAt('setup-error', message);
    }
    function loginClearPasswords() {
        ui.clearPasswords('login-password');
    }
    function setupClearPasswords() {
        ui.clearPasswords('setup-password', 'setup-confirm');
    }
    function mountAuth() {
        if (globalThis.location?.origin) { core.initializeCloudAccount(); mountCloudForms(); }
        else ui.byId('login-form').addEventListener('submit', event => { event.preventDefault(); void core.loginAccount({ username: ui.byId('login-name').value.trim(), password: ui.byId('login-password').value, deviceName: ui.byId('login-device').value.trim() }); });
        ui.byId('owner-refresh').addEventListener('click', core.load);
        ui.byId('setup-to-login').addEventListener('click', () => core.show('login'));
        ui.byId('login-to-register')?.addEventListener('click', ui.showRegistration);
        ui.byId('setup-form').addEventListener('submit', event => { event.preventDefault(); void core.setupAccount({ username: ui.byId('setup-name').value.trim(), password: ui.byId('setup-password').value, confirmation: ui.byId('setup-confirm').value, deviceName: ui.byId('setup-device').value.trim() }); });
        // The legacy setup grant stays available for existing local accounts.
    }
    let screenKey = '';
    const field = (id, label, type = 'text', autocomplete = 'off') => `<label for="${id}">${label}</label><input id="${id}" type="${type}" autocomplete="${autocomplete}" required>`;
    function mountCloudForms() {
        ui.byId('login-view').classList.add('cloud-auth-card');
        ui.byId('cloud-wait-cancel').replaceWith(ui.byId('cloud-wait-cancel').cloneNode(true));
        ui.byId('cloud-wait-cancel').textContent = '取消并换账号';
        ui.byId('cloud-wait-cancel').addEventListener('click', () => void core.cancelCloudJourney());
        ui.byId('cloud-wait-retry').addEventListener('click', () => void core.retryCloudApproval());
        const trustForm = ui.element('form');
        trustForm.innerHTML = '<label for="auth-trust-input">已登录设备的可信交付码</label><textarea id="auth-trust-input"></textarea><button class="button secondary" type="submit">接收可信交付</button>';
        trustForm.addEventListener('submit', async event => { event.preventDefault(); try { await core.cloudImportTrust(ui.byId('auth-trust-input').value); } catch (failure) { ui.byId('cloud-wait-status').textContent = core.cloudError(failure); } });
        ui.byId('cloud-wait-view').append(trustForm);
        if (globalThis.weftmateDesktop) {
            const offline = ui.element('form'); offline.innerHTML = '<label for="auth-offline-approve">离线密码</label><input id="auth-offline-approve" type="password" autocomplete="current-password"><button class="button secondary" type="submit">用离线密码允许这台电脑</button>';
            offline.addEventListener('submit', async event => { event.preventDefault(); const input = ui.byId('auth-offline-approve'); try { await core.cloudApproveOffline(input.value); } catch (failure) { ui.byId('cloud-wait-status').textContent = core.cloudError(failure); } finally { input.value = ''; } });
            ui.byId('cloud-wait-view').append(offline);
        }
        const legal = document.createElement('dialog'); legal.id = 'legal-reader'; legal.className = 'legal-reader';
        legal.innerHTML = '<div class="group-heading"><h2 id="legal-title"></h2><button class="button quiet" type="button">关闭</button></div><article id="legal-text"></article>';
        legal.setAttribute('aria-labelledby', 'legal-title'); legal.querySelector('button').addEventListener('click', () => legal.close()); document.body.append(legal);
        setInterval(() => { if (core.state.currentView === 'login') paintCloudAuth(core.cloudAuthView()); }, 1000);
        if (globalThis.weftmateDesktop) void globalThis.weftmateDesktop.identity().then(identity => { core.state.cloudAuth.deviceName = identity.deviceName; });
        paintCloudAuth(core.cloudAuthView());
    }
    async function showLegal(kind) {
        ui.byId('legal-title').textContent = kind === 'terms' ? '服务条款' : '隐私政策';
        const response = await fetch(`/personal/v1/ui/legal/${kind}-zh.md`);
        if (response.ok) ui.byId('legal-text').replaceChildren(globalThis.WeftDesktop.markdown(await response.text(), 'markdown-body'));
        else ui.byId('legal-text').textContent = '内容暂时无法读取，请重试。';
        ui.byId('legal-reader').showModal();
    }
    function paintCloudAuth(value) {
        if (value.mode === 'authenticated' || value.mode === 'offline') { screenKey = ''; return; }
        if (value.mode === 'waiting') {
            ui.byId('cloud-wait-title').textContent = '在你已登录的设备上允许这台设备';
            ui.byId('cloud-wait-status').textContent = value.error || `可以批准的设备：${[...new Set([...value.devices, ...value.hosts].filter(device => !device.isCurrent).map(device => device.name))].join('、') || '已登录的电脑或手机'}。批准后会自动进入。`;
            return;
        }
        const key = `${value.mode}:${value.step}`;
        if (key !== screenKey) {
            screenKey = key;
            const registration = value.mode === 'registration', recovery = value.mode === 'recovery', offline = value.mode === 'offline-login';
            const title = registration ? '注册 WeftMate' : recovery ? '找回密码' : value.mode === 'confirm' ? '确认新设备' : offline ? '离线使用这台电脑' : '登录 WeftMate';
            let controls;
            if (value.step === 'code') controls = `<p class="muted">请输入邮箱收到的 6 位验证码。</p>${field('auth-code', '验证码')}<button type="submit" class="button primary submit">验证</button>${value.mode !== 'confirm' ? '<button type="button" id="auth-resend" class="button quiet">重新发送验证码</button>' : ''}`;
            else if (value.step === 'password') controls = `${field('auth-password', recovery ? '新密码' : '设置密码', 'password', 'new-password')}<p class="field-help" id="auth-strength">至少 8 位</p>${field('auth-confirm', '确认密码', 'password', 'new-password')}${registration ? field('auth-device', '设备名称') : ''}<button type="submit" class="button primary submit">${recovery ? '重设密码' : '完成注册'}</button>`;
            else if (registration || recovery) controls = `${field('auth-email', '邮箱', 'email', 'email')}<button type="submit" class="button primary submit">发送验证码</button>`;
            else if (offline) controls = `${value.offlineKnown ? '' : field('auth-offline-account', value.localOnly ? '本地账户名' : '云端账号')}${field('auth-password', '离线密码', 'password', 'current-password')}<button type="submit" class="button primary submit">登录</button>`;
            else controls = `${field('auth-email', '邮箱', 'email', 'username')}<label for="auth-password">密码</label><div class="password-row"><input id="auth-password" type="password" autocomplete="current-password" required><button type="button" id="auth-reveal" class="text-button" aria-label="显示密码">显示</button></div><button type="submit" class="button primary submit">登录</button><div class="auth-links"><button type="button" class="button quiet" id="auth-recovery">忘记密码？</button><button type="button" class="button quiet" id="auth-register">还没有账号？注册</button></div>`;
            ui.byId('login-view').innerHTML = `<span class="wm-brand auth-brand" aria-hidden="true"></span><h1>${title}</h1><form id="cloud-auth-form">${controls}<p class="form-error" id="cloud-auth-error" role="alert" hidden></p></form>${registration ? '<p class="auth-legal">注册即表示同意<button type="button" class="text-button" id="auth-terms">《服务条款》</button><button type="button" class="text-button" id="auth-privacy">《隐私政策》</button></p>' : ''}${value.mode !== 'login' ? '<button type="button" class="button quiet" id="auth-back">返回登录</button>' : globalThis.weftmateDesktop ? '<button type="button" class="button quiet auth-offline" id="auth-offline">离线使用这台电脑</button>' : ''}`;
            const email = ui.byId('auth-email'); if (email) email.value = value.email;
            const device = ui.byId('auth-device'); if (device) device.value = value.deviceName;
            ui.byId('auth-code')?.setAttribute('inputmode', 'numeric'); ui.byId('auth-code')?.setAttribute('maxlength', '6');
            ui.byId('auth-reveal')?.addEventListener('click', () => { const input = ui.byId('auth-password'), revealed = input.type === 'password'; input.type = revealed ? 'text' : 'password'; ui.byId('auth-reveal').textContent = revealed ? '隐藏' : '显示'; ui.byId('auth-reveal').setAttribute('aria-label', revealed ? '隐藏密码' : '显示密码'); });
            ui.byId('auth-register')?.addEventListener('click', () => core.startCloudJourney('registration'));
            ui.byId('auth-recovery')?.addEventListener('click', () => core.startCloudJourney('recovery'));
            ui.byId('auth-back')?.addEventListener('click', () => core.startCloudJourney());
            ui.byId('auth-offline')?.addEventListener('click', () => core.startCloudJourney('offline-login'));
            ui.byId('auth-resend')?.addEventListener('click', () => void core.cloudRequestCode());
            ui.byId('auth-terms')?.addEventListener('click', () => void showLegal('terms'));
            ui.byId('auth-privacy')?.addEventListener('click', () => void showLegal('privacy'));
            ui.byId('auth-password')?.addEventListener('input', () => { if (ui.byId('auth-strength')) ui.byId('auth-strength').textContent = core.cloudPasswordHint(ui.byId('auth-password').value); });
            ui.byId('cloud-auth-form').addEventListener('submit', async event => {
                event.preventDefault(); const input = id => ui.byId(id)?.value || '';
                if (value.step === 'code') await core.cloudVerifyCode(input('auth-code'));
                else if (value.step === 'password') await core.cloudComplete({ password: input('auth-password'), confirmation: input('auth-confirm'), deviceName: input('auth-device') });
                else if (registration || recovery) await core.cloudRequestCode(input('auth-email'));
                else if (offline) await core.cloudOfflineLogin({ password: input('auth-password'), ...(value.localOnly ? { username: input('auth-offline-account') } : { cloudAccountId: input('auth-offline-account') }) });
                else await core.cloudLogin({ email: input('auth-email'), password: input('auth-password') });
                const password = ui.byId('auth-password'); if (password) password.value = '';
            });
        }
        globalThis.WeftMotion?.changed(ui.byId('login-view'), `${value.mode}:${value.step}`, 'base');
        ui.errorAt('cloud-auth-error', value.error);
        ui.setBusy(ui.byId('cloud-auth-form'), value.busy);
        const resend = ui.byId('auth-resend'); if (resend) { resend.disabled = value.busy || value.resendSeconds > 0; resend.textContent = value.resendSeconds ? `${value.resendSeconds} 秒后可重发` : '重新发送验证码'; }
        const submit = ui.byId('cloud-auth-form').querySelector('[type=submit]'); if (value.retrySeconds) submit.disabled = true;
        if (value.retrySeconds) ui.errorAt('cloud-auth-error', `尝试太多次，请等待 ${value.retrySeconds} 秒后重试。`);
    }
    function restoreCloudDraft(draft) { if (draft) { ui.byId('message-text').value = draft; ui.updateAvailability(); } }
    return { paintIdentity, loginBusy, setupBusy, loginError, setupError, loginClearPasswords, setupClearPasswords, mountAuth, paintCloudAuth, restoreCloudDraft };
};
