/* Desktop composition entry. Feature behavior lives in ../ui-core; DOM belongs to components. */
(() => {
    const ui = globalThis.WeftUiComponents.createContext();
    const native = globalThis.weftmateDesktop;
    const initialPairing = globalThis.location?.hash.startsWith('#pair=') ? 'wm1.' + globalThis.location.hash.slice(6) : null;
    ui.pairingJourney = !!initialPairing;
    if (initialPairing) history.replaceState(null, '', location.pathname + location.search);
    const request = async (url, options = {}) => {
        if (!native) return fetch(url,options);
        const target = new URL(url, globalThis.location.href || globalThis.location.origin);
        const desktopData = native && target.origin === globalThis.location.origin && /^\/personal\/v1\/data(?:\/|$)/.test(target.pathname);
        if (!native || !desktopData && (!/^https?:/.test(String(url)) || target.origin === globalThis.location?.origin)) return fetch(url, options);
        if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
        const id = crypto.randomUUID(), abort = () => void native.abortPersonalFetch(id).catch(() => {});
        options.signal?.addEventListener('abort', abort, { once: true });
        try {
            const body = options.body instanceof Blob ? await options.body.arrayBuffer() : options.body;
            const result = await native.fetchPersonal(target.href, { method: options.method, headers: options.headers, body }, id);
            return { status: result.status, ok: result.status >= 200 && result.status < 300, json: async () => result.body,
                headers: { get: name => result.headers[name.toLowerCase()] || null } };
        } finally { options.signal?.removeEventListener('abort', abort); }
    };
    const core = globalThis.WeftUiCore.create({ effects: ui, fetch: request, storage: localStorage, crypto: globalThis.crypto,
        hostOrigin: globalThis.location?.origin, desktop: !!native, cloudVendor: globalThis.WeftCloudVendor,
        networkAvailable: () => globalThis.navigator?.onLine,
        initialPairing,
        messageModeStorage: native ? (...args) => native.credentials(...args) : undefined,
        feedbackStorage: native ? (...args) => native.credentials(...args) : undefined,
        nativeIdentity: native ? () => native.identity() : undefined,
        cloudCredentials: native ? (...args) => native.credentials(...args) : (...args) => globalThis.WeftCloud.storage(...args),
        nativeCloudKey: native ? { get: scope => native.cloudKey(scope), sign: (scope, input) => native.cloudProof(scope, input), clear: scope => native.resetCloudKey(scope) } : undefined });
    ui.loadAttachmentHasher = () => import('./file-sha256.js');
    for (const factory of Object.values(globalThis.WeftUiComponents.factories))
        Object.assign(ui, factory(core, ui));
    ui.cloudUi = globalThis.WeftCloudUi.create({ acceptSession: core.acceptSession, enterAssistant: core.enterAssistant,
        openAccount: core.openAccount, show: core.show, accessApi: core.accessApi, toast: ui.toast,
        bindDesktop: core.cloudBindDesktop });
    for (const mount of ["mountAuth", "mountAccount", "mountSettings", "mountMemory", "mountApprovals", "mountComposer", "mountPhone", "mountSessions", "mountCloudSettings", "mountShell", "mountSettingsNavigation", "mountMainChat", "mountActivity", "mountGoals", "mountLibrary", "mountSearch"])
        ui[mount]();
    ui.mountOnboarding();
    globalThis.WeftPresenceView.mount({core, badgeTarget:ui.byId('assistant-connection'),
        composerTarget:ui.byId('message-form').parentElement, toast:ui.toast,
        openLogin:()=>core.startCloudJourney(), openDevices:()=>{core.openAccount();ui.openSettings('devices');}});
    document.addEventListener('visibilitychange',()=>core.connectionVisibility(document.visibilityState==='hidden'));
    window.addEventListener('offline',()=>core.connectionNetwork(false));
    window.addEventListener('online',()=>core.connectionNetwork(true));
    window.addEventListener('focus',()=>core.connectionVisibility(false));
    globalThis.__WeftUiStarted = true;
    if (!native && globalThis.navigator?.serviceWorker) void globalThis.navigator.serviceWorker.register('/personal/v1/ui/offline-worker.js').catch(() => {});
    if (globalThis.indexedDB && globalThis.matchMedia?.('(max-width: 720px)')?.matches) globalThis.WeftOfflineView?.mount({ core, desktop: !!native,
        openConversation: () => ui.showConversation(),
        identity: async () => core.cloudOfflineIdentity(),
        host: (path, body) => core.accessApi(path, { method: 'POST', body, protectedWrite: true }) });
})();
