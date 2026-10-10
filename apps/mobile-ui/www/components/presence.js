/* Quiet connection indicator and an inline composer notice; no overlay. */
globalThis.WeftPresenceView = {
    mount({ core, badgeTarget, composerTarget, toast = () => {}, openLogin = () => {}, openDevices = () => {} }) {
        const make = (tag, className, text = '') => Object.assign(document.createElement(tag), { className, textContent: text });
        const badge = make('span', 'presence-badge'), dot = make('span', 'presence-dot'), label = make('span', 'presence-label');
        dot.setAttribute('aria-hidden', 'true'); badge.setAttribute('role', 'status'); badge.append(dot, label); badgeTarget?.append(badge);
        const bar = make('section', 'presence-bar'), copy = make('span', 'presence-copy'), actions = make('div', 'presence-actions');
        bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite');
        const retry = make('button', 'button secondary presence-action', '重试'), offline = make('button', 'button secondary presence-action', '离线模式');
        retry.type = offline.type = 'button'; retry.addEventListener('click', () => {
            const kind = core.connectionView().kind;
            if (kind === 'login_required') openLogin();
            else if (kind === 'approval_required') openDevices();
            else { retry.disabled = true; void core.retryConnection().finally(() => { retry.disabled = false; }); }
        });
        offline.addEventListener('click', () => core.openOfflineMode?.());
        bar.dataset.composerAbove = 'connection';
        const barDot = make('span', 'presence-dot'); barDot.setAttribute('aria-hidden', 'true');
        actions.append(retry, offline); bar.append(barDot, copy, actions); composerTarget?.prepend(bar);
        let disconnected = false, lastKind;
        const paint = value => {
            badge.dataset.state = bar.dataset.state = value.kind;
            badge.title = value.description || value.label; badge.setAttribute('aria-label', value.label);
            label.textContent = value.kind === 'online' ? '' : value.label;
            const runtime = value.kind === 'online' && ['restarting','unavailable'].includes(value.host?.runtime);
            const model = value.kind === 'online' && value.host?.model === 'unavailable';
            bar.hidden = value.kind === 'online' && !runtime && !model;
            copy.textContent = runtime ? value.host.runtime==='restarting' ? '助手正在重启 · 草稿会保留' : '助手暂不可用 · 草稿会保留'
                : model ? '模型暂不可用 · 请检查设置' : ({connecting:'正在连接 · 草稿会保留',host_offline:'电脑离线 · 可用云端聊天，不能操作电脑',network_unavailable:'网络不可用 · 草稿会保留',login_required:'请重新登录 · 草稿会保留',approval_required:'请在已登录设备批准访问'})[value.kind] || '';
            copy.title = value.description || copy.textContent;
            retry.textContent = value.kind === 'login_required' ? '重新登录' : value.kind === 'approval_required' ? '查看设备' : '重试';
            offline.hidden = value.kind !== 'host_offline' || typeof core.openOfflineMode !== 'function';
            if (value.kind !== 'online' && (value.failures > 0 || value.kind !== 'connecting')) disconnected = true;
            else if (disconnected && lastKind && lastKind !== 'online') { disconnected = false; toast('连接已恢复，正在接续。'); }
            if(value.kind!=='online') for(const notice of document.querySelectorAll('.offline-notice,#timeline-status')) { if(/暂时无法读取|同步未完成/.test(notice.textContent))notice.hidden=true; }
            lastKind = value.kind;
        };
        const unsubscribe = core.observeConnection(paint); paint(core.connectionView());
        return { paint, close() { unsubscribe(); badge.remove(); bar.remove(); } };
    },
};
