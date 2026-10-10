/* Account operations live here; all clients use the same request and cancellation behavior. */
globalThis.WeftUiCore.factories.data = (core,effects,environment) => {
    const request = (route, body) => { core.syncMobileIdentity?.(); return core.accessApi('/data' + route, body === undefined ? {} : { method: 'POST', protectedWrite: true, body }); };
    return {
        readData: () => request(''), readDataOperation: () => request('/operations'),
        scanData: () => request('/scan', {}), cleanData: (category, confirm) => request('/clean', { category, confirm }),
        cancelData: id => request('/cancel', { id }),
        async exportAllData(id) { if (globalThis.weftmateDesktop?.exportAllData) return globalThis.weftmateDesktop.exportAllData(id); return request('/export', {}); },
        deleteAllData: (kind, accountName, id) => request(id ? '/confirm' : '/' + kind, { ...(id ? { id } : {}), accountName, confirm: true }),
        showDataExport: id => globalThis.weftmateDesktop?.showDataExport(id),
        async clearLocalData(owner=core.state.ownerId) {
            if(owner && environment.storage) for(let index=environment.storage.length-1;index>=0;index--){const key=environment.storage.key(index);if(key?.startsWith('weftmate')&&(key.includes(`:${owner}`)||key.includes(`${owner}:`)))environment.storage.removeItem(key);}
            if(owner) {await environment.feedbackStorage?.(`weftmate:message-feedback:${owner}`,null,true);await environment.messageModeStorage?.(`weftmate:message-mode:${owner}`,null,true);}
            await core.clearOfflineData?.();
        },
        dataSize: bytes => { if (!bytes) return '0 B'; const units = ['B','KB','MB','GB','TB'], exponent = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024))); return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: exponent > 0 ? 1 : 0 }).format(bytes / 1024 ** exponent)} ${units[exponent]}`; },
    };
};
