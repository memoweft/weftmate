/* Shared settings state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.settings = (core, effects, environment) => {
    function sessionExpired() {
        core.clearSession();
        core.show('login');
        effects.toast('登录已失效，请重新登录。');
    }
    function formatDate(value) {
        if (typeof value !== 'string')
            return '未记录';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '未记录' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    }
    async function refreshSystem() {
        void core.refreshApprovalSettings();
        const token = core.accountToken();
        effects.systemLoading();
        try {
            const [system, settings, catalog] = await Promise.all([core.accessApi('/system'),
                core.accessApi('/settings/models'), core.accessApi('/models')]);
            if (!core.accountCurrent(token))
                return;
            core.state.system = system;
            core.state.modelSettings = settings;
            effects.paintSystem(system, settings, catalog, token);
        }
        catch {
            if (core.accountCurrent(token))
                effects.systemNotice('系统状态暂时无法读取，请刷新重试。');
        }
    }
    function openAccount() {
        core.stopAssistantRefresh();
        effects.closeRail();
        core.show('account');
        core.state.deviceEditing = null;
        effects.resetProfileDraft();
        void effects.cloudUi?.refreshBinding();
        void core.refreshProfile();
        void core.refreshDevices();
        effects.resetOtherDeviceInstall();
        void core.refreshAccountModels();
        void core.refreshSystem();
        void core.refreshProjects();
        void core.refreshModels();
        void core.refreshBrowserWorkspace();
    }
    return { sessionExpired, formatDate, refreshSystem, openAccount };
};
