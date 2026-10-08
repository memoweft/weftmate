/* Device appearance preferences; applying them to a DOM is the renderer's job. */
(() => {
    const defaults = { theme: 'system', accent: 'neutral', fontSize: '15' };
    function createAppearance(storage = globalThis.localStorage) {
        const key = 'weftmate.desktop.appearance.v1';
        let value;
        try {
            value = { ...defaults, ...JSON.parse(storage.getItem(key) || 'null') };
        }
        catch {
            value = { ...defaults };
        }
        return { get value() { return { ...value }; }, set(next, persist = true) {
                value = { ...defaults, ...next };
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
