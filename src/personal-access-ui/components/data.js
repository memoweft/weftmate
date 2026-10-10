/* Shared settings surface for Electron, remote web and the Android UI package. */
globalThis.WeftDataView = (core, target, { toast = () => {}, desktop = !!globalThis.weftmateDesktop } = {}) => {
    if (target.dataView) { target.dataView.refresh(); return; }
    const node = (tag, cls, text) => { const item = document.createElement(tag); item.className = cls || ''; if (text !== undefined) item.textContent = text; return item; };
    const button = (text, action, cls = 'secondary') => { const item = node('button', `button ${cls}`, text); item.type = 'button'; item.addEventListener('click', () => void action()); return item; };
    let snapshot, operation, accountName = '', canManage = false, timer, generation = 0, completionId, trackedOperation, cloudPassword;
    const header = node('div','data-heading'), refreshButton = button('', () => refresh(true)); refreshButton.className = 'icon-button'; refreshButton.setAttribute('aria-label','重新统计占用'); refreshButton.title = '重新统计占用'; refreshButton.append(WeftIcons.create('sync',18));
    const measured = node('p','muted'), total = node('p','data-total'), bar = node('div','data-storage-bar'), list = node('div','data-categories'), progress = node('div','data-progress'), actions = node('div','data-actions');
    const accounting=node('p','muted data-accounting');
    const error = node('p','form-error'); error.setAttribute('role','alert'); progress.setAttribute('role','status'); progress.setAttribute('aria-live','polite');
    header.append(measured,refreshButton); bar.setAttribute('role','img');
    const exportButton = button('导出全部数据', () => perform(() => core.exportAllData()), 'secondary');
    actions.append(node('h2','','带走你的数据'),node('p','muted',desktop ? '选择保存位置。对话、记忆、成果、附件、设置与用量一起导出；不包含密钥和临时对话。' : '请在电脑上导出。可在这里发起，电脑确认并保存后会通知你。'),exportButton);
    const danger = node('section','data-danger'); danger.append(node('h2','','危险操作'),node('p','muted','删除无法撤销。建议先导出；程序、其他账户和项目原件会保留。'));
    const deleteButton = button('删除本账户的全部数据', () => confirmDanger('delete'), 'danger'), closeButton = button('注销账号', () => confirmDanger('close-account'), 'danger'); danger.append(deleteButton,closeButton);
    target.classList.add('data-settings'); target.replaceChildren(header,total,bar,list,accounting,progress,error,actions,danger);
    const identity = () => core.state?.auth?.ownerId ?? core.state?.ownerId ?? core.state?.owner;
    const initialIdentity = identity();
    const current = () => identity() === initialIdentity && target.isConnected;
    function dialog(title) {
        const returnFocus = document.activeElement, box = node('dialog',core.android?.call ? 'session-action-dialog data-dialog' : 'dialog confirm-dialog data-dialog'); box.setAttribute('aria-label',title); box.append(node('h2','',title));
        box.addEventListener('cancel',()=>{cloudPassword=undefined;});
        box.addEventListener('close',() => { box.remove(); returnFocus?.focus(); }); document.body.append(box); return box;
    }
    function open(box) { globalThis.WeftPopover?.bindSettings(box); box.showModal(); box.querySelector('button')?.focus(); }
    function confirmClean(row) {
        const box = dialog(`清理${row.name}`); box.append(node('p','',`${row.description} 不会改动对话、记忆、成果和附件原件。`));
        box.append(button('取消',() => {cloudPassword=undefined;box.close();}),button('确认清理',async () => { box.close(); await perform(() => core.cleanData(row.id,true)); })); open(box);
    }
    function confirmDanger(kind, pendingId) {
        cloudPassword=undefined;
        const title = kind === 'delete' ? '删除本账户的全部数据' : '注销账号';
        const box = dialog(title); box.append(node('p','',`仅处理账户「${accountName}」。会先停止正在运行的任务，再逐类删除。`));
        const rows = node('div','data-delete-list');
        for (const row of snapshot?.categories || []) rows.append(node('p','',`${row.name} · ${core.dataSize(row.bytes)}`));
        box.append(rows,node('p','muted','还包括设置、用量和设备上的离线副本。其他设备下次连接时退出并清理；电脑无法擦除关机设备、整机备份或你已导出的文件。项目原始文件只解除登记。'));
        if (kind === 'close-account') box.append(node('p','muted','本机账户与设备绑定一并移除。若使用云账号，还需在账户页输入密码完成云身份注销；未完成前云端邮箱与身份仍保留。'));
        if (kind === 'close-account' && desktop && core.state.cloudAuth?.mode === 'authenticated') { const passwordLabel=node('label','','云账号密码'), passwordInput=node('input'); passwordInput.type='password'; passwordInput.autocomplete='current-password'; passwordInput.setAttribute('aria-label','云账号密码'); passwordInput.addEventListener('input',()=>{cloudPassword=passwordInput.value;}); passwordLabel.append(passwordInput); box.append(passwordLabel); }
        box.append(button('先导出全部数据',async () => { box.close(); await perform(() => core.exportAllData()); }));
        const label = node('label','','输入账户名确认'), input = node('input'); input.setAttribute('aria-label','输入账户名确认'); input.autocomplete = 'off'; label.append(input); box.append(label);
        const next = button('继续',() => {
            box.close(); const final = dialog('最后确认'); final.append(node('p','',`确定${kind === 'delete' ? '删除' : '注销'}「${accountName}」？删除开始后无法恢复。${desktop ? '' : '还需要在电脑上再次确认。'}`));
            final.append(button('取消',() => {cloudPassword=undefined;final.close();}),button(desktop ? kind === 'close-account' ? '确认注销' : '确认删除' : '请求电脑确认',async () => { final.close(); await perform(() => core.deleteAllData(kind,accountName,pendingId)); },'danger')); open(final);
        },'danger'); next.disabled = true; input.addEventListener('input',() => { next.disabled = input.value !== accountName; });
        box.append(button('取消',() => {cloudPassword=undefined;box.close();}),next); open(box);
    }
    async function perform(action) { error.textContent = ''; try { const result = await action(); if (result?.operation) { trackedOperation=result.operation.id; operation=result.operation; } if (current()) await refresh(); } catch (failure) { if (current()) error.textContent = failure.code === 'FORBIDDEN' ? '请用这台电脑的账户所有者操作。受限设备不能执行。' : '操作未完成，请检查电脑连接和磁盘后重试。'; } }
    function paint() {
        const running = ['running','pending_confirmation'].includes(operation?.state);
        refreshButton.disabled = exportButton.disabled = deleteButton.disabled = closeButton.disabled = running || !canManage;
        total.textContent = snapshot ? `本账户共占用 ${core.dataSize(snapshot.totalBytes)}` : '正在统计本账户占用…';
        measured.textContent = snapshot ? `${Math.max(0,Math.floor((Date.now()-Date.parse(snapshot.measuredAt))/60000))} 分钟前统计` : '后台统计中，可以继续使用界面。';
        accounting.textContent=snapshot?.accounting || '';
        list.replaceChildren(); bar.replaceChildren();
        if (snapshot) for (const row of snapshot.categories) {
            const line = node('div','settings-row data-category'), icon = WeftIcons.create(row.icon,20), info = node('div','settings-row-copy'), controls = node('div','data-row-controls');
            info.append(node('strong','',row.name),node('p','muted',row.description)); controls.append(node('span','data-size',core.dataSize(row.bytes)));
            if (row.cleanable) { const clean = button('清理',() => row.pureCache ? perform(() => core.cleanData(row.id,false)) : confirmClean(row)); clean.disabled = running || !canManage || !row.bytes; controls.append(clean); }
            line.append(icon,info,controls); list.append(line);
            if (row.bytes) { const segment = node('span',`data-storage-segment data-${row.id}`); segment.style.flexGrow = String(row.bytes / Math.max(1,snapshot.totalBytes)); segment.title = `${row.name} ${core.dataSize(row.bytes)}`; bar.append(segment); }
        } else for (let index=0;index<7;index++) list.append(node('div','data-skeleton'));
        bar.setAttribute('aria-label',snapshot ? `总量 ${core.dataSize(snapshot.totalBytes)}，按类别比例显示` : '正在统计');
        progress.replaceChildren();
        if (!canManage) progress.append(node('p','muted','当前账户或设备只可查看。请由这台电脑的账户所有者管理数据。'));
        if (operation?.state === 'pending_confirmation') {
            progress.append(node('p','',desktop ? '另一设备请求数据操作，请在这台电脑核对。' : '已请求电脑确认。可以在确认前取消。'));
            if (desktop) progress.append(button('核对并确认',() => operation.kind === 'export' ? perform(() => core.exportAllData(operation.id)) : confirmDanger(operation.kind,operation.id)));
        }
        if (operation?.state === 'running') progress.append(node('p','',`${operation.kind === 'scan' ? '正在统计' : operation.kind === 'export' ? '正在导出' : operation.kind === 'clean' ? '正在清理' : '正在删除'}${snapshot?.categories.find(row=>row.id===operation.category)?.name || '账户数据'}…${operation.bytes ? ` ${core.dataSize(operation.bytes)}` : ''}`));
        if (operation?.canCancel) progress.append(button('取消操作',() => perform(() => core.cancelData(operation.id))));
        if (operation?.state === 'failed') {
            const category = snapshot?.categories.find(row=>row.id===operation.error?.category)?.name || '账户数据';
            progress.append(node('p','form-error',`${category}未完成。已完成的删除不能恢复；修复原因后可重试。${operation.error?.code === 'DATA_PATH_OUTSIDE_ACCOUNT' ? '发现文件链接指向账户外，已拒绝删除。' : ''}`),button('重试',() => operation.kind === 'scan' ? refresh(true) : operation.kind === 'export' ? perform(() => core.exportAllData()) : operation.kind === 'clean' ? perform(() => core.cleanData(operation.category,true)) : confirmDanger(operation.kind)));
        }
        if (operation?.state === 'completed' && operation.kind === 'export' && desktop) progress.append(button('在文件夹中显示',() => core.showDataExport(operation.id)));
        if (operation?.state === 'completed' && completionId !== operation.id) {
            completionId = operation.id;
            if (operation.kind === 'clean') toast(`已腾出 ${core.dataSize(operation.result?.freedBytes)}`);
            if (operation.kind === 'export') toast('全部数据已保存到电脑');
            if (['delete','close-account'].includes(operation.kind)) { void finishDeletion(operation); }
        }
    }
    async function finishDeletion(op) {
        await core.clearLocalData(initialIdentity);
        if (op.kind === 'close-account' && cloudPassword) { try { await core.cloudDeleteAccount(cloudPassword,{prepareBackup:false}); cloudPassword=undefined; } catch { error.replaceChildren(node('span','','本机数据已删除，云账号注销未完成。检查密码与连接后重试；未完成前云端邮箱与身份仍保留。'),button('重试云账号注销',()=>finishDeletion(op))); return; } }
        toast(op.kind==='delete'?'数据已删除，重新开始':'本机账户已注销'); globalThis.location.reload();
    }
    async function refresh(force = false) {
        const ticket = ++generation; clearTimeout(timer);
        try { if (trackedOperation && desktop && globalThis.weftmateDesktop?.dataOperation) { const native=await globalThis.weftmateDesktop.dataOperation(trackedOperation); if(native && ['close-account','delete'].includes(native.kind)) { operation=native; if(operation.state==='completed'){paint();return;} } } if (force) await core.scanData(); const value = await core.readData(); if (!current() || ticket !== generation) return;
            snapshot = value.statistics; operation = value.operation; canManage = value.canManage; accountName = value.accountName; error.textContent = ''; paint();
            timer = setTimeout(() => { if (current() && !target.hidden && !target.closest('[hidden]')) void refresh(); }, ['running','pending_confirmation'].includes(operation?.state) ? 700 : 5000);
        } catch { if (!current() || ticket !== generation) return; total.textContent='占用暂时无法读取'; error.replaceChildren(node('span','','检查电脑连接后重试。'),button('重试',() => refresh())); }
    }
    target.dataView = { refresh }; void refresh();
};
