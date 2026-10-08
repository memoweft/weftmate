/* Desktop composition entry. Feature behavior lives in ../ui-core; DOM belongs to components. */
(() => {
    const ui = globalThis.WeftUiComponents.createContext();
    const native = globalThis.weftmateDesktop;
    const core = globalThis.WeftUiCore.create({ effects: ui, fetch: (...args) => fetch(...args), storage: localStorage, crypto: globalThis.crypto,
        hostOrigin: globalThis.location?.origin, desktop: !!native, cloudVendor: globalThis.WeftCloudVendor,
        nativeIdentity: native ? () => native.identity() : undefined,
        cloudCredentials: native ? (...args) => native.credentials(...args) : (...args) => globalThis.WeftCloud.storage(...args),
        nativeCloudKey: native ? { get: scope => native.cloudKey(scope), sign: (scope, input) => native.cloudProof(scope, input), clear: scope => native.resetCloudKey(scope) } : undefined });
    ui.loadAttachmentHasher = () => import('./file-sha256.js');
    for (const factory of Object.values(globalThis.WeftUiComponents.factories))
        Object.assign(ui, factory(core, ui));
    for (const mount of ["mountAuth", "mountAccount", "mountSettings", "mountMemory", "mountApprovals", "mountComposer", "mountPhone", "mountSessions", "mountCloudSettings", "mountShell"])
        ui[mount]();
})();
