/* Desktop composition entry. Feature behavior lives in ../ui-core; DOM belongs to components. */
(() => {
    const ui = globalThis.WeftUiComponents.createContext();
    const core = globalThis.WeftUiCore.create({ effects: ui, fetch: (...args) => fetch(...args), storage: localStorage, crypto: globalThis.crypto });
    ui.loadAttachmentHasher = () => import('./file-sha256.js');
    for (const factory of Object.values(globalThis.WeftUiComponents.factories))
        Object.assign(ui, factory(core, ui));
    for (const mount of ["mountAuth", "mountAccount", "mountSettings", "mountMemory", "mountApprovals", "mountComposer", "mountPhone", "mountSessions", "mountShell"])
        ui[mount]();
})();
