/* Quiet connection indicator and an inline composer notice; no overlay. */
globalThis.WeftPresenceView = {
    acknowledgedRuns: new Set(),
    mount({ core, badgeTarget, composerTarget, toast = () => {}, openLogin = () => {}, openDevices = () => {}, openRunRecords = () => {}, readLocalDiagnostics = null }) {
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
        const diagnostic = make('button','button secondary presence-action','查看详情'); diagnostic.type='button'; diagnostic.hidden=true;
        diagnostic.addEventListener('click',()=>{
            for(const [source,run] of [['host',diagnosticRun],['local',localRun]])if(run?.runId)WeftPresenceView.acknowledgedRuns.add(`${source}:${run.runId}`);
            openRunRecords();diagnosticRun=null;localRun=null;diagnostic.hidden=true;paint(core.connectionView());
        }); actions.append(diagnostic);
        const feedback = make('button','button secondary presence-action','反馈问题'); feedback.type='button';
        feedback.onclick=()=>globalThis.WeftProblemFeedback?.(feedback); actions.append(feedback);
        let diagnosticRun=null, localRun=null, closed=false, requestedScope=null, requestEpoch=0;
        let disconnected = false, lastKind;
        const paint = value => {
            const scope=core.state ? `${core.state.ownerId || core.state.auth?.ownerId || ''}/${core.state.identityGeneration || 0}` : null;
            if (requestedScope && requestedScope!==scope) { diagnosticRun=null;requestedScope=null;requestEpoch++; }
            if (value.kind==='online' && scope && requestedScope!==scope && (core.readMobileSystem || core.accessApi)) {
                requestedScope=scope; const epoch=++requestEpoch;
                // This optional diagnostics read must not change conversation
                // connectivity if its own request fails. Status probes own that.
                Promise.resolve().then(()=>{
                    core.syncMobileIdentity?.();
                    return core.requestJson ? core.requestJson(`${core.accessBase}/system`)
                        : core.readMobileSystem ? core.readMobileSystem() : core.accessApi('/system');
                }).then(system=>{
                    if(epoch!==requestEpoch)return;
                    const previous=system.runRecord?.previous;
                    diagnosticRun=previous?.normal===false && !WeftPresenceView.acknowledgedRuns.has(`host:${previous.runId}`) ? previous : null;
                    paint(core.connectionView());
                }).catch(()=>{if(epoch===requestEpoch)requestedScope=null;});
            }
            badge.dataset.state = bar.dataset.state = value.kind;
            badge.title = value.description || value.label; badge.setAttribute('aria-label', value.label);
            label.textContent = value.kind === 'online' ? '' : value.label;
            const runtime = value.kind === 'online' && ['restarting','unavailable'].includes(value.host?.runtime);
            const model = value.kind === 'online' && value.host?.model === 'unavailable';
            const activeDiagnostic=localRun || diagnosticRun;
            const showDiagnostic=!!localRun || value.kind==='online' && !runtime && !!diagnosticRun;
            bar.hidden = value.kind === 'phone' || value.kind === 'online' && !runtime && !model && !showDiagnostic;
            copy.textContent = showDiagnostic ? (localRun?'这部手机上次未正常结束 · ':'上次没有正常退出 · ')+WeftRunRecords.reason(activeDiagnostic,localRun?'android':null)
                : runtime ? value.host.runtime==='restarting' ? '助手正在重启 · 草稿会保留' : '助手暂不可用 · 草稿会保留'
                : model ? '模型暂不可用 · 请检查设置' : ({connecting:'正在连接 · 草稿会保留',host_offline:'电脑离线 · 等待接续',network_unavailable:'网络不可用 · 草稿会保留',login_required:'请重新登录 · 草稿会保留',approval_required:'请在已登录设备批准访问'})[value.kind] || '';
            copy.title = showDiagnostic ? copy.textContent : value.description || copy.textContent;
            if(core.hasMultipleComputers?.()&&value.kind==='host_offline')copy.textContent=`${core.computerName(core.currentExecutionComputer())} 不在线 · 等待接续`;
            diagnostic.hidden=!showDiagnostic; retry.hidden=showDiagnostic;
            feedback.hidden=!core.state?.ownerId || value.kind==='connecting';
            retry.textContent = value.kind === 'login_required' ? '重新登录' : value.kind === 'approval_required' ? '查看设备' : '重试';
            offline.hidden = showDiagnostic || value.kind !== 'host_offline' || typeof core.openOfflineMode !== 'function';
            if (['login_required','approval_required'].includes(value.kind)) disconnected = false;
            else if (['host_offline','network_unavailable'].includes(value.kind) || value.kind === 'connecting' && value.failures > 0) disconnected = true;
            else if (value.kind === 'online' && disconnected && lastKind && lastKind !== 'online') { disconnected = false; toast('连接已恢复，正在接续。'); }
            // Only explicitly classified read/sync notices join connection state.
            for(const notice of document.querySelectorAll('.offline-notice,[data-notice-kind="read-failure"]'))notice.hidden=!notice.textContent||value.kind!=='online';
            lastKind = value.kind;
        };
        const unsubscribe = core.observeConnection(paint); paint(core.connectionView());
        // The existing strip can show local failures before login or while the
        // host is unreachable; it never adds another row to the composer.
        if(readLocalDiagnostics)Promise.resolve().then(readLocalDiagnostics).then(value=>{
            if(closed||value?.state!=='ready'||value.previous?.normal!==false||WeftPresenceView.acknowledgedRuns.has(`local:${value.previous.runId}`))return;
            localRun=value.previous;paint(core.connectionView());
        }).catch(()=>{});
        return { paint, close() { closed=true;unsubscribe(); badge.remove(); bar.remove(); } };
    },
};

/* Read-only diagnostics use the existing settings surface, on both clients. */
globalThis.WeftRunRecords = {
    reason(previous, platform = null) {
        if (!previous) return '首次启动';
        const androidReasons={crash:'程序崩溃',native_crash:'原生组件崩溃',anr:'程序无响应',low_memory:'系统因内存不足回收',
            user_requested:'使用者划掉或强行停止',user_stopped:'使用者停止应用',system_update:'系统更新',permission_change:'权限变化',
            terminated_in_background:'系统在后台回收',activity_finished:'已关闭应用界面',unknown:'原因未知',system_other:'其它系统退出原因',other:'其它系统退出原因'};
        const android=platform==='android'||typeof previous.exitTimeKnown==='boolean';
        if(Object.hasOwn(androidReasons,previous.reason)&&(previous.reason!=='unknown'||android))return androidReasons[previous.reason];
        if (previous.reason==='single-instance') return '已有程序正在运行，本次让位';
        if (previous.reason==='startup-failure') return '上次启动失败，可在诊断摘要中核对错误位置';
        if (!previous.normal && previous.reason==='system-shutdown') return '检测到系统关机或注销，收尾未完成';
        if (!previous.normal && Number.isFinite(previous.exitCode)) return previous.exitCode===0 ? '退出收尾未完成' : `程序以错误码 ${previous.exitCode} 结束`;
        if (!previous.normal) return previous.dumps?.length ? '检测到崩溃转储，原因待核对' : '可能崩溃、被强制结束或断电';
        return ({'user-quit':'使用者退出','update-restart':'重启并更新','system-shutdown':'系统关机或注销','single-instance':'已有程序正在运行','startup-failure':'启动失败','unknown':'退出原因未记录'})[previous.reason] || '退出原因未记录';
    },
    mount(target, { core, toast = () => {}, retry = () => {}, desktop = globalThis.weftmateDesktop, title = '运行记录',
        local = false, browser = false, copySummary = text => navigator.clipboard.writeText(text), shareLogs = null } = {}) {
        const node = (tag, cls, text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
        const section = node('section', 'run-records'); section.setAttribute('aria-label','运行记录');
        section.append(node('h3', '', title)); const body = node('div'); section.append(body); target.append(section);
        const button = (text, action) => { const value=node('button','button secondary small',text); value.type='button'; value.addEventListener('click',action); return value; };
        function paint(value) {
            body.replaceChildren(); section.dataset.state = value?.state || 'loading';
            if (!value) { const loading=node('div','run-record-loading'); loading.setAttribute('role','status'); loading.append(WeftControls.skeleton()); body.append(loading); return; }
            if (value.state !== 'ready') { body.append(node('p','muted','运行记录暂时无法读取，请重试。'),button('重试读取',retry)); return; }
            const list=node('dl','run-record-facts');
            const fact=(label,text)=>{list.append(node('dt','',label),node('dd','',text));};
            fact('本次启动',core.dateText(value.startedAt));
            const previous=value.previous;
            if (previous?.normal === false && !browser) body.append(node('p','muted run-record-unclean',
                local ? '上次没有正常退出，记录已保存在这台设备上。' : '上次没有正常退出，记录已保存在电脑上。'));
            const exitKnown=previous && (previous.exitTimeKnown===true || Number.isFinite(previous.exitCode));
            if(!browser)fact('上次退出',previous ? `${exitKnown ? core.dateText(previous.at) : '结束时间未知'} · ${previous.normal ? '正常结束' : '未正常结束'}` : '首次启动，还没有上一轮记录');
            if (previous && !exitKnown && previous.lastAt) fact('最后记录',core.dateText(previous.lastAt));
            if (previous) fact('退出原因',WeftRunRecords.reason(previous,local?'android':null));
            if (Number.isFinite(previous?.exitCode)) fact('退出码',`${previous.exitCode} · 0x${(previous.exitCode>>>0).toString(16).toUpperCase().padStart(8,'0')}`);
            const abnormalCount=local ? Object.values(value.abnormalCountsLast7Days || {}).reduce((sum,count)=>sum+(Number.isFinite(count)?count:0),0) : value.uncleanCount7Days || 0;
            fact(browser?'最近 7 天保留':'最近 7 天',local ? `${abnormalCount} 条异常记录` : `${abnormalCount} 次未正常结束`); body.append(list);
            if (!abnormalCount) { const empty=node('p','run-record-empty'); empty.append(WeftIcons.create('info',20),node('span','',local?'没有异常记录。需要排查时可复制诊断摘要。':'没有异常退出记录。今后可在这里查看。')); body.append(empty); }
            if(browser && value.records?.length){const recent=node('div','run-record-preview');
                recent.append(node('p','muted','本机保留最近 20 条，只记错误类型与程序脚本位置。'));
                for(const record of value.records)recent.append(node('p','hint',`${core.dateText(record.at)} · ${record.name}${record.script?' · '+record.script+(record.line?':'+record.line:'')+(record.column?':'+record.column:''):''}`));body.append(recent);}
            const actions=node('div','run-record-actions');
            if (desktop?.openLogs) actions.append(button('打开日志文件夹',async()=>{try{await desktop.openLogs();}catch{toast('日志文件夹暂时无法打开，请重试。');}}));
            if(shareLogs)actions.append(button('分享日志文件',async()=>{try{await shareLogs();}catch{toast('日志文件暂时无法分享，请重试。');}}));
            const preview=node('section','run-record-preview'); preview.hidden=true; preview.setAttribute('aria-label','诊断摘要预览');
            const text=node('pre','run-record-summary',value.summaryPreview || value.summary || '没有异常记录');
            const copy=button('复制摘要',async()=>{copy.disabled=true;try{await copySummary(value.summary || '{}');toast('诊断摘要已复制。');}catch{toast('复制未完成，请重试。');}finally{copy.disabled=false;}});
            preview.append(node('p','muted',local?'下方为摘要预览，复制后是结构化诊断信息。运行记录只保存在本机。':'下方为摘要预览，复制后是结构化诊断信息。日志与转储只保存在电脑上。'),text,copy);
            const reveal=button('复制诊断摘要',()=>{preview.hidden=!preview.hidden;reveal.setAttribute('aria-expanded',String(!preview.hidden));}); reveal.setAttribute('aria-expanded','false');
            actions.append(reveal);body.append(actions,preview);
        }
        paint(null); return { paint, section };
    }
};
