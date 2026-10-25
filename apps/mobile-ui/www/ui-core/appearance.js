/* Device appearance preferences; applying them to a DOM is the renderer's job. */
(() => {
    const defaults = { theme: 'system', accent: 'neutral', fontSize: '14', accentLight: 'neutral', accentDark: 'neutral', codeFontSize: '12',
        uiFontSize: '13', themePreset: 'default', themePresetLight: 'default', themePresetDark: 'default', font: 'system', fontLight: 'system', fontDark: 'system',
        backgroundLight: '', backgroundDark: '', foregroundLight: '', foregroundDark: '',
        separateModes: true, contrast: '60', translucentSidebar: false, fullWidth: false };
    function normalize(value = {}) {
        const next = { ...defaults, ...value };
        const color = value => ['neutral', 'blue', 'green', 'purple'].includes(value);
        if (!['system', 'light', 'dark'].includes(next.theme)) next.theme = defaults.theme;
        for (const key of ['fontSize', 'uiFontSize', 'codeFontSize']) {
            const size = Number(next[key]);
            next[key] = Number.isInteger(size) && size >= 10 && size <= 24 ? String(size) : defaults[key];
        }
        for (const key of ['backgroundLight','backgroundDark','foregroundLight','foregroundDark']) if (!/^#[\da-f]{6}$/i.test(next[key])) next[key] = '';
        for (const key of ['font','fontLight','fontDark']) if (!['system','serif','mono'].includes(next[key])) next[key] = 'system';
        if (!['default','paper'].includes(next.themePreset)) next.themePreset = 'default';
        for (const key of ['themePresetLight','themePresetDark']) if (!['default','paper'].includes(next[key])) next[key] = next.themePreset;
        for (const key of ['separateModes','translucentSidebar','fullWidth']) if (typeof next[key] !== 'boolean') next[key] = defaults[key];
        next.contrast = Number.isFinite(Number(next.contrast)) ? String(Math.min(100, Math.max(0, Math.round(Number(next.contrast))))) : defaults.contrast;
        if (!color(next.accent)) next.accent = defaults.accent;
        for (const key of ['accentLight', 'accentDark']) next[key] = color(value[key]) ? value[key] : next.accent;
        return next;
    }
    function createAppearance(storage = globalThis.localStorage, key = 'weftmate.desktop.appearance.v1') {
        let value;
        try {
            value = normalize(JSON.parse(storage.getItem(key) || 'null') || {});
        }
        catch {
            value = { ...defaults };
        }
        return { get value() { return { ...value }; }, set(next, persist = true) {
                value = normalize(next);
                if (persist)
                    try {
                        storage.setItem(key, JSON.stringify(value));
                    }
                    catch { /* Device storage can be unavailable. */ }
                return { ...value };
            } };
    }
    globalThis.WeftUiCore.appearanceDefaults = defaults;
    globalThis.WeftUiCore.createAppearance = createAppearance;
    globalThis.WeftUiCore.factories.appearance = (_core, _effects, environment) => ({ appearance: createAppearance(environment.storage) });
})();
