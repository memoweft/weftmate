/* Shared settings state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.settings = (core, effects, environment) => {
    let writes = Promise.resolve();
    let settingsGeneration = 0;
    let systemRefreshTimer;
    let systemReadGeneration = 0;
    const owner = () => core.state.account?.ownerId || core.state.ownerId;
    function acceptPersonalization(value, identity) {
        if (identity !== core.state.identityGeneration || !value?.settings) return value;
        const old = core.state.personalization;
        const changed = JSON.stringify(old) !== JSON.stringify(value.settings);
        const oldDisplay = core.state.personalization?.thinkingDisplay;
        if (core.state.personalizationOwner !== owner() || old?.messageMode !== value.settings.messageMode) {
            core.state.messageModeOwner = owner();
            core.state.messageMode = value.settings.messageMode;
        }
        core.state.personalization = value.settings;
        core.state.personalizationOwner = owner();
        if (changed) effects.updateAvailability?.();
        if (oldDisplay !== value.settings.thinkingDisplay) globalThis.document?.dispatchEvent(new Event('weft:personalization'));
        return value;
    }
    async function loadPersonalization() {
        const identity = core.state.identityGeneration;
        const generation = settingsGeneration;
        const value = await core.accessApi('/settings/personalization');
        if (identity !== core.state.identityGeneration || generation !== settingsGeneration || !value?.settings) return value;
        // Adopt a pre-ST-1 device preference once; subsequent devices read the account value.
        if (!value.updatedAt) {
            let prior;
            try { prior = environment.storage?.getItem(`weftmate:message-mode:${owner()}`); } catch {}
            if (!prior && environment.messageModeStorage) try { prior = await environment.messageModeStorage(`weftmate:message-mode:${owner()}`); } catch {}
            if (identity !== core.state.identityGeneration || generation !== settingsGeneration) return value;
            if (prior === 'steer') return savePersonalization({messageMode: prior});
        }
        return acceptPersonalization(value, identity);
    }
    function savePersonalization(patch, extract = false) {
        const identity = core.state.identityGeneration, account = owner();
        const action = writes.catch(() => {}).then(async () => {
            if (identity !== core.state.identityGeneration || account !== owner()) throw new Error('ACCOUNT_CHANGED');
            const value = await core.accessApi('/settings/personalization' + (extract ? '/style' : ''),
                { method: extract ? 'POST' : 'PATCH', protectedWrite: true, body: extract ? {} : patch });
            settingsGeneration++;
            return acceptPersonalization(value, identity);
        });
        writes = action;
        return action;
    }
    let notificationWrites=Promise.resolve();
    async function loadNotificationSettings(){return core.accessApi('/settings/notifications');}
    let healthWrites=Promise.resolve();
    const loadHealthSettings=()=>core.accessApi('/settings/health');
    function saveHealthSettings(patch){const identity=core.state.identityGeneration,account=owner();const action=healthWrites.catch(()=>{}).then(()=>{if(identity!==core.state.identityGeneration||account!==owner())throw new Error('ACCOUNT_CHANGED');return core.accessApi('/settings/health',{method:'PATCH',protectedWrite:true,body:patch});});healthWrites=action;return action;}
    function saveNotificationSettings(patch){
        const identity=core.state.identityGeneration,account=owner();
        const action=notificationWrites.catch(()=>{}).then(()=>{
            if(identity!==core.state.identityGeneration||account!==owner())throw new Error('ACCOUNT_CHANGED');
            return core.accessApi('/settings/notifications',{method:'PATCH',protectedWrite:true,body:patch});
        });notificationWrites=action;return action;
    }
    async function sendTestNotification(){return core.accessApi('/settings/notifications/test',{method:'POST',protectedWrite:true,body:{}});}
    function sessionExpired() {
        core.clearSession();
        core.show('login');
        effects.toast('登录已失效，请重新登录。');
    }
    function formatDate(value) { return core.dateText(value, { year: true }); }
    async function refreshSystem(quiet = false) {
        clearTimeout(systemRefreshTimer);
        const generation = ++systemReadGeneration;
        void core.refreshApprovalSettings();
        const token = core.accountToken();
        if (!quiet) effects.systemLoading();
        try {
            const [system, settings, catalog] = await Promise.all([core.accessApi('/system'),
                core.accessApi('/settings/models'), core.accessApi('/models')]);
            if (!core.accountCurrent(token) || generation !== systemReadGeneration)
                return;
            core.state.system = system;
            core.state.modelSettings = settings;
            effects.paintSystem(system, settings, catalog, token);
            if (effects.systemVisible?.() && system.components?.some(row => row.state === 'problem' || row.pending || row.semanticRecall?.state === 'preparing')) {
                systemRefreshTimer = setTimeout(() => { if (core.accountCurrent(token) && effects.systemVisible?.()) void refreshSystem(true); }, 2000);
            }
        }
        catch {
            if (core.accountCurrent(token) && generation === systemReadGeneration)
                effects.systemNotice('系统状态暂时无法读取，请刷新重试。');
        }
    }
    async function refreshModelSettings() {
        const token=core.accountToken();
        const [settings,catalog]=await Promise.all([core.accessApi('/settings/models'),core.accessApi('/models')]);
        if(!core.accountCurrent(token))return;
        core.state.modelSettings=settings;effects.paintModelSettings(settings,catalog);
    }
    core.refreshModelSettings=refreshModelSettings;
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
    return { saveSecondOpinion: secondOpinionEnabled => core.accessApi('/settings/approvals', { method: 'PATCH', protectedWrite: true, body: { secondOpinionEnabled } }), readPermissionRules: () => core.accessApi('/settings/approvals'), savePermissionRules: rules => core.accessApi('/settings/approvals', { method: 'PATCH', protectedWrite: true, body: { rules } }), readExecutionRecords: params => core.accessApi('/execution-records?' + params), loadNotificationSettings, saveNotificationSettings, loadHealthSettings, saveHealthSettings, persistHealthSettings: saveHealthSettings, sendTestNotification, loadPersonalization, savePersonalization, sessionExpired, formatDate, refreshSystem, openAccount };
};
