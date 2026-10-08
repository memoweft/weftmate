/* About-page data and actions. Presentation is registered by UI-4. */
globalThis.WeftUiCore.factories.update = (core, effects, environment) => {
    const desktop = environment.updateAdapter || globalThis.weftmateDesktop;
    const labels = { disabled: '尚未配置', idle: '尚未检查', checking: '检查中', downloading: '下载中',
        available: '下载中', downloaded: '已就绪，重启后完成更新', ready: '已就绪，下次打开窗口时更新',
        starting: '正在验证新界面', current: '已是最新版本', 'not-available': '已是最新版本',
        failed: '更新失败', error: '更新失败', 'device-managed': '在手机上检查' };
    async function readUpdateState() {
        if (desktop?.updateState) return desktop.updateState();
        if (environment.mobileState && effects.nativeCall) {
            const details = await effects.nativeCall('updates.status');
            return { layers: [
                { layer: 'mobile-ui', currentVersion: details.activeVersion, availableVersion: details.stagedVersion || null,
                    status: details.lastError ? 'failed' : details.stagedVersion ? 'ready' : 'current', error: details.lastError || null },
                { layer: 'app', currentVersion: details.nativeVersion, availableVersion: null, status: 'device-managed' },
                { layer: 'ui', currentVersion: null, availableVersion: null, status: 'device-managed' },
            ], canRestart: false };
        }
        const manifest = await core.accessApi('/app/manifest');
        return { layers: [{ layer: 'mobile-ui', currentVersion: environment.uiVersion || null,
            availableVersion: manifest.version || manifest.uiVersion, status: 'device-managed', channel: manifest.channel || 'stable' }], canRestart: false };
    }
    async function checkUpdates() {
        if (desktop?.checkUpdates) return desktop.checkUpdates();
        if (environment.mobileState && effects.nativeCall) await effects.nativeCall('updates.check');
        if (environment.checkUiUpdate) await environment.checkUiUpdate();
        return readUpdateState();
    }
    async function restartForUpdate() {
        if (!desktop?.restartForUpdate) return { restarted: false };
        return desktop.restartForUpdate();
    }
    return { readUpdateState, checkUpdates, restartForUpdate,
        updateStatusText: layer => layer.error || labels[layer.status] || '尚未检查' };
};
