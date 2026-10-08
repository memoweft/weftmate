/* Shared auth state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.auth = (core, effects, environment) => {
    function accountIdentityCurrent(token) {
        return token.generation === core.state.identityGeneration && token.ownerId === core.state.account?.ownerId
            && token.deviceId === core.state.device?.id && token.csrf === core.state.csrfToken;
    }
    async function setupAccount({ username, password, confirmation, deviceName }) {
        effects.setupError('');
        if (!username || !deviceName)
            return effects.setupError('请填写账户名和设备名称。');
        const normalizedName = username.normalize('NFKC');
        if (Array.from(normalizedName).length < 3 || Array.from(normalizedName).length > 64 || !/^[\p{L}\p{N}_.-]+$/u.test(normalizedName)) {
            return effects.setupError('账户名须为 3–64 个文字、数字、下划线、点或短横线。');
        }
        if (Array.from(password).length < 15 || Array.from(password).length > 128)
            return effects.setupError('密码须为 15–128 个字符。');
        if (password !== confirmation)
            return effects.setupError('两次输入的密码不一致。');
        effects.setupBusy(true);
        try {
            const ownerSetup = !!core.state.setupGrant;
            core.acceptSession(await core.api(ownerSetup ? '/setup' : '/register', { method: 'POST',
                body: ownerSetup ? { grant: core.state.setupGrant, username, password, deviceName }
                    : { username, password, deviceName } }));
            core.state.setupGrant = null;
            effects.toast(ownerSetup ? '原账户已设置。' : '账户已注册。');
            await core.enterAssistant();
        }
        catch (error) {
            if (error.code === 'INVALID_SETUP_GRANT' || error.code === 'ACCOUNT_ALREADY_CONFIGURED') {
                core.state.setupGrant = null;
                if (error.code === 'ACCOUNT_ALREADY_CONFIGURED')
                    core.show('login');
                else
                    effects.showRegistration();
            }
            effects.setupError(core.failureMessage(error));
            effects.toast(core.failureMessage(error));
        }
        finally {
            effects.setupClearPasswords();
            effects.setupBusy(false);
        }
    }
    async function loginAccount({ username, password, deviceName }) {
        effects.loginError('');
        if (!username || !password || !deviceName)
            return effects.loginError('请填写账户名、密码和设备名称。');
        effects.loginBusy(true);
        try {
            core.acceptSession(await core.api('/login', { method: 'POST', body: { username, password, deviceName } }));
            effects.toast('已登录。');
            await core.enterAssistant();
        }
        catch (error) {
            effects.loginError(core.failureMessage(error));
        }
        finally {
            effects.loginClearPasswords();
            effects.loginBusy(false);
        }
    }
    return { accountIdentityCurrent, setupAccount, loginAccount };
};
