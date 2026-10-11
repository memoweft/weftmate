/* Device appearance preferences; applying them to a DOM is the renderer's job. */
(() => {
    const defaults = { theme: 'system', accent: 'neutral', fontSize: '15', accentLight: 'neutral', accentDark: 'neutral', codeFontSize: '13' };
    function normalize(value = {}) {
        const next = { ...defaults, ...value };
        const color = value => ['neutral', 'blue', 'green', 'purple'].includes(value);
        if (!['system', 'light', 'dark'].includes(next.theme)) next.theme = defaults.theme;
        if (!['14', '15', '17', '19'].includes(next.fontSize)) next.fontSize = defaults.fontSize;
        if (!['12', '13', '15', '17'].includes(next.codeFontSize)) next.codeFontSize = defaults.codeFontSize;
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
