/* Desktop auth component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.auth = (core, ui) => {
    function paintIdentity(payload) {
        ui.byId('account-name').textContent = WeftUiCore.accountLabel(payload.account,core.cloudAuthView?.().email);
        const name = [payload.account.displayName,payload.account.username].find(value=>value&&value!=='local-owner') || '我的账户';
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
    let screenKey = '', loginDialog, loginHome, loginNext, loginReturnFocus;
    const field = (id, label, type = 'text', autocomplete = 'off') => `<label for="${id}">${label}</label><input id="${id}" type="${type}" autocomplete="${autocomplete}" required>`;
    function mountCloudForms() {
        ui.byId('login-view').classList.add('cloud-auth-card');
        ui.byId('cloud-wait-cancel').replaceWith(ui.byId('cloud-wait-cancel').cloneNode(true));
        ui.byId('cloud-wait-cancel').textContent = '取消并换账号';
        ui.byId('cloud-wait-cancel').addEventListener('click', () => void core.cancelCloudJourney());
        ui.byId('cloud-wait-retry').textContent = '重新登录';
        ui.byId('cloud-wait-retry').addEventListener('click', () => core.startCloudJourney());
        const legal = document.createElement('dialog'); legal.id = 'legal-reader'; legal.className = 'legal-reader';
        legal.innerHTML = '<div class="group-heading"><h2 id="legal-title"></h2><button class="button quiet" type="button">关闭</button></div><article id="legal-text"></article>';
        legal.setAttribute('aria-labelledby', 'legal-title'); legal.querySelector('button').addEventListener('click', () => legal.close()); document.body.append(legal);
        setInterval(() => { const value = core.cloudAuthView(); if (core.state.currentView === 'login' || value.modal) paintCloudAuth(value); }, 1000);
        if (globalThis.weftmateDesktop) void globalThis.weftmateDesktop.identity().then(identity => { core.state.cloudAuth.deviceName = identity.deviceName; });
        paintCloudAuth(core.cloudAuthView());
    }
    function paintLoginDialog(open) {
        const view = ui.byId('login-view');
        if (open) {
            if (!loginDialog) {
                loginDialog = ui.element('dialog', 'dialog cloud-login-dialog'); loginDialog.id = 'cloud-login-dialog';
                loginDialog.setAttribute('aria-labelledby', 'cloud-login-dialog-title');
                const head = ui.element('div', 'dialog-head'), title = ui.element('h2', '', '登录以使用云端功能'); title.id = 'cloud-login-dialog-title';
                const close = ui.element('button', 'icon-close'); close.type = 'button'; close.setAttribute('aria-label', '关闭登录'); close.append(globalThis.WeftIcons.create('deny', 24));
                close.addEventListener('click', () => core.dismissCloudLogin()); head.append(title, close);
                const body = ui.element('div', 'dialog-body'); body.id = 'cloud-login-dialog-body'; loginDialog.append(head, body);
                loginDialog.addEventListener('cancel', event => { event.preventDefault(); core.dismissCloudLogin(); });
                document.body.append(loginDialog);
            }
            if (!loginDialog.open) {
                loginHome = view.parentNode; loginNext = view.nextSibling; loginReturnFocus = document.activeElement;
                ui.byId('cloud-login-dialog-body').append(view); view.hidden = false; loginDialog.inert = false; loginDialog.showModal();
            }
        } else if (loginDialog?.open) {
            loginDialog.close();
            if (loginNext?.parentNode === loginHome) loginHome.insertBefore(view, loginNext); else loginHome.append(view);
            view.hidden = true; loginReturnFocus?.focus?.({ preventScroll: true });
        }
    }
    async function showLegal(kind) {
        ui.byId('legal-title').textContent = kind === 'terms' ? '服务条款' : '隐私政策';
        const response = await fetch(`/personal/v1/ui/legal/${kind}-zh.md`);
        if (response.ok) ui.byId('legal-text').replaceChildren(globalThis.WeftDesktop.markdown(await response.text(), 'markdown-body'));
        else ui.byId('legal-text').textContent = '内容暂时无法读取，请重试。';
        ui.byId('legal-reader').inert = false; ui.byId('legal-reader').showModal();
    }
    function paintCloudAuth(value) {
        paintLoginDialog(!!value.modal);
        if (value.localDesktop) {
            for (const id of ['setup-password', 'setup-confirm']) {
                const input = ui.byId(id); if (!input) continue;
                input.required = false; input.value = ''; input.hidden = true;
                const label = document.querySelector(`label[for="${id}"]`); if (label) label.hidden = true;
                const row = input.closest('.password-row'); if (row) { row.hidden = true; if (row.nextElementSibling?.classList.contains('field-help')) row.nextElementSibling.hidden = true; }
            }
            ui.byId('setup-to-login').hidden = true;
        }
        if (value.mode === 'authenticated' || value.mode === 'offline') { screenKey = ''; if (core.state.currentView === 'account') ui.paintCloudSettings?.(); return; }
        if (value.mode === 'waiting') {
            screenKey = '';
            ui.byId('cloud-wait-title').textContent = '请重新登录';
            ui.byId('cloud-wait-status').textContent = value.error || '这台电脑需要更新后才能完成登录。更新后重新登录即可。';
            return;
        }
        const key = `${value.mode}:${value.step}`;
        if (key !== screenKey) {
            screenKey = key;
            const registration = value.mode === 'registration', recovery = value.mode === 'recovery', codeLogin = value.mode === 'code-login';
            const title = registration ? '注册 WeftMate' : recovery ? '找回密码' : value.mode === 'confirm' ? '确认是你在登录' : '登录 WeftMate';
            let controls;
            if (value.step === 'code') controls = `<p class="muted auth-code-help">${value.mode === 'confirm' ? '首次在这台设备登录，请用邮箱验证码确认是你本人。' : '请输入邮箱收到的 6 位验证码。'}</p><p id="auth-code-email" class="field-help"></p>${recovery ? `<p class="field-help">${value.recoveryHelp}</p><button type="button" class="button secondary" id="auth-register">去注册</button>` : ''}${field('auth-code', '邮箱验证码', 'text', 'one-time-code')}<button type="submit" class="button primary submit">${registration || recovery ? '验证邮箱' : '确认并登录'}</button>${value.mode !== 'confirm' ? '<button type="button" id="auth-resend" class="button secondary auth-resend">重新发送验证码</button>' : ''}`;
            else if (value.step === 'password') controls = `${field('auth-password', recovery ? '新密码' : '设置密码', 'password', 'new-password')}<p class="field-help" id="auth-strength">至少 8 位</p>${field('auth-confirm', '确认密码', 'password', 'new-password')}${registration ? field('auth-device', '设备名称') : ''}<button type="submit" class="button primary submit">${recovery ? '重设密码' : '完成注册'}</button>`;
            else if (registration || recovery || codeLogin) controls = `${field('auth-email', '邮箱', 'email', 'email')}<button type="submit" class="button primary submit">发送验证码</button>`;
            else controls = `${field('auth-email', '邮箱', 'email', 'username')}<label for="auth-password">密码</label><div class="password-row"><input id="auth-password" type="password" autocomplete="current-password" required><button type="button" id="auth-reveal" class="text-button" aria-label="显示密码">显示</button></div><button type="submit" class="button primary submit">登录</button><button type="button" class="button secondary auth-code-login" id="auth-code-login">用邮箱验证码登录</button><div class="auth-links"><button type="button" class="button quiet" id="auth-recovery">忘记密码？</button><button type="button" class="button quiet" id="auth-register">注册账号</button></div>`;
            ui.byId('login-view').innerHTML = `<span class="wm-brand auth-brand" aria-hidden="true"></span><h1>${title}</h1>${value.modal ? '<p class="muted auth-local-help">本机的对话和设置随时可用。登录后可以使用远程访问等云端功能。</p>' : ''}<form id="cloud-auth-form">${controls}<p class="form-error" id="cloud-auth-error" role="alert" hidden></p></form>${registration ? '<p class="auth-legal">注册即表示同意<button type="button" class="text-button" id="auth-terms">《服务条款》</button><button type="button" class="text-button" id="auth-privacy">《隐私政策》</button></p>' : ''}${value.mode !== 'login' ? '<button type="button" class="button secondary auth-back" id="auth-back">返回密码登录</button>' : ''}`;
            if (ui.pairingJourney) ui.byId('login-view').querySelector('h1').after(ui.element('p', 'muted', globalThis.WeftOnboardingCopy.mobileHelp));
            const email = ui.byId('auth-email'); if (email) email.value = value.email;
            const device = ui.byId('auth-device'); if (device) device.value = value.deviceName;
            if (ui.byId('auth-code-email')) ui.byId('auth-code-email').textContent = value.email;
            ui.byId('auth-code')?.setAttribute('inputmode', 'numeric'); ui.byId('auth-code')?.setAttribute('maxlength', '6'); ui.byId('auth-code')?.setAttribute('pattern', '[0-9]{6}');
            ui.byId('auth-reveal')?.addEventListener('click', () => { const input = ui.byId('auth-password'), revealed = input.type === 'password'; input.type = revealed ? 'text' : 'password'; ui.byId('auth-reveal').textContent = revealed ? '隐藏' : '显示'; ui.byId('auth-reveal').setAttribute('aria-label', revealed ? '隐藏密码' : '显示密码'); });
            ui.byId('auth-register')?.addEventListener('click', () => core.startCloudJourney('registration'));
            ui.byId('auth-recovery')?.addEventListener('click', () => core.startCloudJourney('recovery'));
            ui.byId('auth-back')?.addEventListener('click', () => core.startCloudJourney());
            ui.byId('auth-code-login')?.addEventListener('click', () => core.startCloudJourney('code-login'));
            ui.byId('auth-resend')?.addEventListener('click', () => void core.cloudRequestCode());
            ui.byId('auth-terms')?.addEventListener('click', () => void showLegal('terms'));
            ui.byId('auth-privacy')?.addEventListener('click', () => void showLegal('privacy'));
            ui.byId('auth-password')?.addEventListener('input', () => { if (ui.byId('auth-strength')) ui.byId('auth-strength').textContent = core.cloudPasswordHint(ui.byId('auth-password').value); });
            ui.byId('cloud-auth-form').addEventListener('submit', async event => {
                event.preventDefault(); const input = id => ui.byId(id)?.value || '';
                if (value.step === 'code') await core.cloudVerifyCode(input('auth-code'));
                else if (value.step === 'password') await core.cloudComplete({ password: input('auth-password'), confirmation: input('auth-confirm'), deviceName: input('auth-device') });
                else if (registration || recovery || codeLogin) await core.cloudRequestCode(input('auth-email'));
                else await core.cloudLogin({ email: input('auth-email'), password: input('auth-password') });
                const password = ui.byId('auth-password'); if (password) password.value = '';
            });
        }
        globalThis.WeftMotion?.changed(ui.byId('login-view'), `${value.mode}:${value.step}`, 'base');
        ui.errorAt('cloud-auth-error', value.error);
        ui.setBusy(ui.byId('cloud-auth-form'), value.busy);
        const codeLogin = ui.byId('auth-code-login'); if (codeLogin) { codeLogin.disabled = value.busy || value.codeLoginSupported === false; codeLogin.title = value.codeLoginSupported === false ? '验证码登录需要更新手机程序' : ''; }
        const resend = ui.byId('auth-resend'); if (resend) { resend.disabled = value.busy || value.resendSeconds > 0; resend.textContent = value.resendSeconds ? `${value.resendSeconds} 秒后可重发` : '重新发送验证码'; }
        const submit = ui.byId('cloud-auth-form').querySelector('[type=submit]'); if (value.retrySeconds) submit.disabled = true;
        if (value.retrySeconds) ui.errorAt('cloud-auth-error', `尝试太多次，请等待 ${value.retrySeconds} 秒后重试。`);
    }
    function restoreCloudDraft(draft) { if (draft) { ui.byId('message-text').value = draft; ui.updateAvailability(); } }
    return { openLegal: showLegal, paintIdentity, loginBusy, setupBusy, loginError, setupError, loginClearPasswords, setupClearPasswords, mountAuth, paintCloudAuth, restoreCloudDraft };
};
