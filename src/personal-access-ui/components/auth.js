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
        ui.byId('owner-refresh').addEventListener('click', core.load);
        ui.byId('setup-to-login').addEventListener('click', () => core.show('login'));
        ui.byId('login-to-register').addEventListener('click', ui.showRegistration);
        ui.byId('setup-form').addEventListener('submit', event => { event.preventDefault(); void core.setupAccount({ username: ui.byId('setup-name').value.trim(), password: ui.byId('setup-password').value, confirmation: ui.byId('setup-confirm').value, deviceName: ui.byId('setup-device').value.trim() }); });
        ui.byId('login-form').addEventListener('submit', event => { event.preventDefault(); void core.loginAccount({ username: ui.byId('login-name').value.trim(), password: ui.byId('login-password').value, deviceName: ui.byId('login-device').value.trim() }); });
    }
    return { paintIdentity, loginBusy, setupBusy, loginError, setupError, loginClearPasswords, setupClearPasswords, mountAuth };
};
