/* Desktop composition entry. Feature behavior lives in ../ui-core; DOM belongs to components. */
(() => {
    const ui = globalThis.WeftUiComponents.createContext();
    const native = globalThis.weftmateDesktop;
    const initialPairing = globalThis.location?.hash.startsWith('#pair=') ? 'wm1.' + globalThis.location.hash.slice(6) : null;
    if (initialPairing) history.replaceState(null, '', location.pathname + location.search);
    const request = async (url, options = {}) => {
        if (!native || !/^https?:/.test(String(url)) || new URL(url).origin === globalThis.location?.origin) return fetch(url, options);
        if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
        const id = crypto.randomUUID(), abort = () => void native.abortPersonalFetch(id).catch(() => {});
        options.signal?.addEventListener('abort', abort, { once: true });
        try {
            const body = options.body instanceof Blob ? await options.body.arrayBuffer() : options.body;
            const result = await native.fetchPersonal(String(url), { method: options.method, headers: options.headers, body }, id);
            return { status: result.status, ok: result.status >= 200 && result.status < 300, json: async () => result.body,
                headers: { get: name => result.headers[name.toLowerCase()] || null } };
        } finally { options.signal?.removeEventListener('abort', abort); }
    };
    const core = globalThis.WeftUiCore.create({ effects: ui, fetch: request, storage: localStorage, crypto: globalThis.crypto,
        hostOrigin: globalThis.location?.origin, desktop: !!native, cloudVendor: globalThis.WeftCloudVendor,
        initialPairing,
        messageModeStorage: native ? (...args) => native.credentials(...args) : undefined,
        nativeIdentity: native ? () => native.identity() : undefined,
        cloudCredentials: native ? (...args) => native.credentials(...args) : (...args) => globalThis.WeftCloud.storage(...args),
        nativeCloudKey: native ? { get: scope => native.cloudKey(scope), sign: (scope, input) => native.cloudProof(scope, input), clear: scope => native.resetCloudKey(scope) } : undefined });
    ui.loadAttachmentHasher = () => import('./file-sha256.js');
    for (const factory of Object.values(globalThis.WeftUiComponents.factories))
        Object.assign(ui, factory(core, ui));
    ui.cloudUi = globalThis.WeftCloudUi.create({ acceptSession: core.acceptSession, enterAssistant: core.enterAssistant,
        openAccount: core.openAccount, show: core.show, accessApi: core.accessApi, toast: ui.toast,
        bindDesktop: core.cloudBindDesktop });
    for (const mount of ["mountAuth", "mountAccount", "mountSettings", "mountMemory", "mountApprovals", "mountComposer", "mountPhone", "mountSessions", "mountCloudSettings", "mountShell", "mountSettingsNavigation", "mountMainChat"])
        ui[mount]();
    globalThis.__WeftUiStarted = true;
    if (!native && globalThis.navigator?.serviceWorker) void globalThis.navigator.serviceWorker.register('/personal/v1/ui/offline-worker.js').catch(() => {});
    if (globalThis.indexedDB && globalThis.matchMedia?.('(max-width: 720px)')?.matches) globalThis.WeftOfflineView?.mount({ core, desktop: !!native,
        identity: async () => core.cloudOfflineIdentity(),
        host: (path, body) => core.accessApi(path, { method: 'POST', body: JSON.stringify(body) }) });
})();
