/* Desktop backup controls, using the existing settings form and token styles. */
globalThis.WeftUiComponents.factories.backup = (core, ui) => {
    let showSettingsBackups;
    function mountBackup() {
        const section = ui.element('section', 'card group backup-settings'); section.setAttribute('aria-label', '备份与恢复'); section.dataset.settingsGroup = '此电脑'; section.dataset.settingsCategory = 'backups';
        section.append(ui.element('h2', '', '备份与恢复'));
        for (const text of ['每天空闲时自动备份，程序保持打开。有任务正在运行时，自动备份会等任务完成。',
            '包含账号与设置、对话与经验、成果、用量和记忆。模型密钥、云令牌、设备私钥与登录会话不进包；恢复后请重新登录，换电脑后重新填写模型密钥。',
            '本地备份未加密，包含私人内容，请保存在你信任的磁盘。']) section.append(ui.element('p', 'field-help', text));
        const form = ui.element('form'), inputs = {};
        function field(parent, name, text, type = 'text') {
            const label = ui.element('label'), input = ui.element('input'); input.name = name; input.type = type;
            input.setAttribute('aria-label', text); input.required = type !== 'checkbox'; if (type === 'number') input.min = '1';
            if (type === 'checkbox') label.append(ui.element('span', '', text), input);
            else label.append(ui.element('span', '', text), input);
            parent.append(label); return input;
        }
        inputs.enabled = field(form, 'enabled', '每日自动备份', 'checkbox');
        globalThis.WeftSettingsControls.toggle(inputs.enabled);
        inputs.directory = field(form, 'directory', '备份目录');
        inputs.dailyDays = field(form, 'dailyDays', '最近保留天数', 'number');
        inputs.weeklyCopies = field(form, 'weeklyCopies', '每周保留份数', 'number');
        const save = ui.element('button', 'button secondary', '保存备份设置'); save.type = 'submit'; form.append(save);
        const actions = ui.element('div', 'actions'), create = ui.element('button', 'button primary', '立即备份'), reload = ui.element('button', 'button secondary', '刷新备份列表');
        reload.className = 'icon-button'; reload.replaceChildren(WeftIcons.create('sync',18)); reload.setAttribute('aria-label','刷新备份列表'); reload.title='刷新备份列表';
        create.type = reload.type = 'button'; actions.append(create, reload);
        const importForm = ui.element('form'); importForm.dataset.import = '';
        const importPath = field(importForm, 'path', '另一台电脑的备份路径'); importPath.placeholder = '填写这台宿主电脑上 .wmb 文件的完整路径';
        const importButton = ui.element('button', 'button secondary', '导入备份'); importButton.type = 'submit'; importForm.append(importButton);
        const notice = ui.element('p'), list = ui.element('ul', 'system-services'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); list.setAttribute('aria-label', '备份列表');
        section.append(form, actions, importForm, notice, list);
        const cloud=globalThis.weftmateDesktop?mountCloudBackup(section):null;
        globalThis.WeftUiLayout.mountBackup(section);
        let busy = false;
        async function run(action) {
            if (busy) return; busy = true;
            const token = core.accountToken();
            section.querySelectorAll('button').forEach(button => { button.disabled = true; });
            notice.textContent = '正在处理…';
            try { await action(); }
            catch (error) { if (core.accountCurrent(token)) notice.textContent = core.backupErrorText(error); }
            finally { busy = false; section.querySelectorAll('button').forEach(button => { button.disabled = button.dataset.invalid === 'true'; }); }
        }
        async function refresh() {
            const token = core.accountToken(), value = await core.readBackups();
            if (!core.accountCurrent(token)) return;
            for (const key of ['directory', 'dailyDays', 'weeklyCopies']) inputs[key].value = value.settings[key];
            inputs.enabled.checked = value.settings.enabled; list.replaceChildren();
            for (const backup of value.backups) {
                const row = ui.element('li', 'system-service'), details = ui.element('div', 'system-service-detail');
                const label = core.dateText(backup.createdAt, { year: true });
                details.append(ui.element('strong', '', label), ui.element('small', 'muted', `${(backup.size / 1048576).toFixed(2)} MB · ${backup.verification === 'valid' ? '校验通过' : '校验失败'}`));
                const restore = ui.element('button', 'button secondary small', '恢复'); restore.setAttribute('aria-label', `恢复 ${label}`);
                restore.dataset.invalid = String(backup.verification !== 'valid'); restore.disabled = backup.verification !== 'valid';
                restore.addEventListener('click', () => {
                    const dialog = ui.element('dialog', 'dialog'); dialog.setAttribute('aria-label', '恢复备份');
                    dialog.append(ui.element('h2', '', '恢复备份'), ui.element('p', '', `恢复到 ${label}？当前状态会先自动备份，随后程序重启；恢复后需重新登录。`));
                    const cancel = ui.element('button', 'button secondary', '取消'), confirm = ui.element('button', 'button danger', '确认恢复');
                    cancel.addEventListener('click', () => { dialog.close(); dialog.remove(); });
                    confirm.addEventListener('click', () => { dialog.close(); dialog.remove(); void run(async () => { await core.restoreBackup(backup.id); notice.textContent = '已开始恢复，程序将重新打开。'; }); });
                    dialog.append(cancel, confirm); document.body.append(dialog); dialog.showModal(); cancel.focus();
                }); row.append(details, restore); list.append(row);
            }
            if (!value.backups.length) list.append(ui.element('li', 'muted', '还没有备份。点击「立即备份」保存当前状态。'));
            notice.textContent = value.status?.state === 'succeeded' && value.status?.restored ? '恢复已完成。请核对你的对话、记忆和设置。' : value.status?.state === 'failed' ? '上次备份未完成，请检查磁盘与目录后重试。'
                : value.status?.state === 'rolled-back' ? '恢复未成功，已自动回到恢复前的状态。' : value.status?.state === 'succeeded' ? '上次操作已完成。' : '';
        }
        reload.addEventListener('click', () => void run(refresh));
        create.addEventListener('click', () => void run(async () => { await core.createBackup(); await refresh(); notice.textContent = '备份已完成。'; }));
        form.addEventListener('submit', event => { event.preventDefault(); void run(async () => { await core.saveBackupSettings({ enabled: inputs.enabled.checked, directory: inputs.directory.value, dailyDays: Number(inputs.dailyDays.value), weeklyCopies: Number(inputs.weeklyCopies.value) }); notice.textContent = '备份设置已保存。'; }); });
        importForm.addEventListener('submit', event => { event.preventDefault(); void run(async () => { await core.importBackup(importPath.value); await refresh(); notice.textContent = '备份已导入并通过校验，请在列表中选择恢复。'; }); });
        showSettingsBackups = () => { void run(refresh); void cloud?.refresh(); };
    }
    let checkCloudBackupPrompt=()=>{};
    function mountCloudBackup(section) {
        const region=ui.element('section','cloud-backup-settings');region.setAttribute('aria-label','云端备份');
        const head=ui.element('div','group-heading');head.append(ui.element('h3','','云端备份'));
        const status=ui.element('div','field-help');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.append(WeftControls.skeleton({rows:1,compact:true,tag:'span'}));
        const details=ui.element('p','field-help'),actions=ui.element('div','actions'),list=ui.element('ul','system-services');list.setAttribute('aria-label','云端备份列表');
        region.append(head,status,details,actions,list);section.append(region);
        let value,busy=false,checking=false,promptId=null,promptOwner=null;
        const button=(label,handler,kind='secondary')=>{const node=ui.element('button',`button ${kind}`,label);node.type='button';node.addEventListener('click',handler);return node;};
        const size=bytes=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:`${Math.ceil((bytes||0)/1024)} KB`;
        async function run(work,notice=status) {
            if(busy)return;busy=true;region.setAttribute('aria-busy','true');region.querySelectorAll('button').forEach(b=>b.disabled=true);
            const token=core.accountToken();notice.textContent='正在处理…';
            try{await work();}catch(error){if(core.accountCurrent(token))notice.textContent=core.cloudBackupErrorText(error);}
            finally{busy=false;region.setAttribute('aria-busy','false');region.querySelectorAll('button').forEach(b=>b.disabled=false);}
        }
        function modal(title) {
            const dialog=ui.element('dialog','dialog cloud-backup-dialog');dialog.setAttribute('aria-label',title);
            const heading=ui.element('div','dialog-head');heading.append(ui.element('h2','',title));
            const close=button('关闭',()=>dialog.close());heading.append(close);
            const body=ui.element('div','dialog-body'),foot=ui.element('div','dialog-actions');dialog.append(heading,body,foot);
            dialog.addEventListener('close',()=>{dialog.replaceChildren();dialog.remove();});document.body.append(dialog);dialog.showModal();close.focus();
            return {dialog,body,foot};
        }
        function input(parent,label,type='text') {
            const wrapper=ui.element('label'),field=ui.element('input');field.type=type;field.setAttribute('aria-label',label);field.autocomplete=type==='password'?'current-password':'off';
            wrapper.append(ui.element('span','',label),field);parent.append(wrapper);return field;
        }
        function codeActions(body,code) {
            const groups=ui.element('div','cloud-recovery-code');groups.setAttribute('aria-label','恢复码');
            for(const [index,group]of code.split('-').entries()){const row=ui.element('span');row.append(ui.element('small','muted',String(index+1)),ui.element('code','',group));groups.append(row);}
            const tools=ui.element('div','actions');
            tools.append(button('复制',()=>void navigator.clipboard.writeText(code).then(()=>ui.toast('恢复码已复制')).catch(()=>ui.toast('复制未完成，请手动抄写。'))),
                button('保存成文件',()=>void globalThis.weftmateDesktop.exportRecoveryCode({recoveryCode:code,ownerId:core.state.account.ownerId}).then(result=>{if(result.exported)ui.toast('恢复码已保存。');}).catch(()=>ui.toast('保存未完成，请重试或手动抄写。'))),
                button('打印',()=>{const frame=ui.element('iframe','cloud-recovery-print');document.body.append(frame);const doc=frame.contentDocument;doc.title='WeftMate 恢复码';doc.body.textContent=`WeftMate 恢复码\n\n${code.split('-').join('\n')}\n\n换电脑时要用它；我们没有它的副本，丢了就找不回备份。`;doc.body.style.whiteSpace='pre-wrap';frame.contentWindow.print();setTimeout(()=>frame.remove(),1000);}));
            body.append(groups,tools);
        }
        function codeDialog(draft) {
            const {dialog,body,foot}=modal(draft.purpose==='rotate'?'更换恢复码':'保存恢复码');
            body.append(ui.element('p','','换电脑时要用它；我们没有它的副本，丢了就找不回备份。'),ui.element('p','field-help','包含你保存的密钥，同样只有你能解开。成果、附件和项目文件夹里的文件不上传，请在原处另行保管。'));
            codeActions(body,draft.recoveryCode);
            const confirmation=input(body,`输入第 ${draft.confirmGroup} 组，确认已经存下`),notice=ui.element('p','field-help');notice.setAttribute('role','status');body.append(notice);
            const confirm=button(draft.purpose==='rotate'?'确认更换':'已保存，开启备份',async()=>{
                confirm.disabled=true;notice.textContent='正在保存…';
                try{await core.cloudBackupAction('enable',{draftId:draft.draftId,confirmation:confirmation.value});dialog.close();await refresh();ui.toast(draft.purpose==='rotate'?'恢复码已更换，旧码已作废。':'云端备份已开启。电脑空闲时会自动备份。');}
                catch(error){notice.textContent=core.cloudBackupErrorText(error);confirm.disabled=false;}
            },'primary');foot.append(confirm);confirmation.focus();
        }
        function passwordDialog(purpose) {
            const {dialog,body,foot}=modal(purpose==='rotate'?'更换恢复码':'查看恢复码');body.append(ui.element('p','','请输入账号密码，确认是你本人。'));
            const password=input(body,'账号密码','password'),notice=ui.element('p','field-help');notice.setAttribute('role','status');body.append(notice);
            const confirm=button('确认',async()=>{confirm.disabled=true;notice.textContent='正在确认…';
                try{const result=await core.cloudBackupAction(purpose,{password:password.value});password.value='';dialog.close();if(purpose==='rotate')codeDialog(result);else{const view=modal('查看恢复码');view.body.append(ui.element('p','','请保存在安全的地方。我们没有它的副本。'));codeActions(view.body,result.recoveryCode);}}
                catch(error){password.value='';notice.textContent=core.cloudBackupErrorText(error);confirm.disabled=false;}
            },'primary');foot.append(confirm);password.focus();
        }
        function restoreDialog(backup) {
            const {dialog,body,foot}=modal('恢复云端备份');
            body.append(ui.element('p','',`恢复 ${core.dateText(backup.createdAt,{year:true})} 的备份（${size(backup.totalBytes)}）？`),
                ui.element('p','field-help','会替换这个账号在这台电脑上的对话、记忆、设置、目标、定时任务、健康和模型配置，其他账号数据保留。替换前会自动做一份本机备份；程序将重新打开，请重新登录。项目与成果文件请在原处保管。'));
            const field=input(body,'恢复码'),notice=ui.element('p','field-help');field.spellcheck=false;notice.setAttribute('role','status');body.append(notice);
            const confirm=button('确认恢复',async()=>{confirm.disabled=true;notice.textContent='正在下载并检查备份…';
                try{await core.cloudBackupAction('restore',{id:backup.id,recoveryCode:field.value,confirm:true});field.value='';notice.textContent='检查通过，正在恢复。程序将重新打开。';}
                catch(error){notice.textContent=core.cloudBackupErrorText(error);confirm.disabled=false;}
            },'primary');foot.append(confirm);field.focus();
        }
        function deleteDialog() {
            const {dialog,body,foot}=modal('删除云端备份');body.append(ui.element('p','','将删除这个账号的全部云端备份和恢复码，并停止这台电脑的云端备份。删除后无法恢复；电脑现有数据和本机备份保留。'));
            const notice=ui.element('p','field-help');notice.setAttribute('role','status');body.append(notice);
            const confirm=button('删除全部云端备份',async()=>{confirm.disabled=true;try{await core.cloudBackupAction('delete',{confirm:true});dialog.close();await refresh();ui.toast('云端备份已删除，已核对没有剩余备份。');}catch(e){notice.textContent=core.cloudBackupErrorText(e);confirm.disabled=false;}},'danger');foot.append(confirm);
        }
        async function refresh() {
            const token=core.accountToken();region.setAttribute('aria-busy','true');
            try{const next=await core.readCloudBackups();if(!core.accountCurrent(token))return;value=next;paint();}
            catch(e){if(core.accountCurrent(token)){status.textContent=core.cloudBackupErrorText(e);actions.replaceChildren(button('重试',()=>void refresh()));}}
            finally{region.setAttribute('aria-busy','false');}
        }
        function paint() {
            actions.replaceChildren();list.replaceChildren();
            if(!value.available){status.textContent=value.reason==='CLOUD_NOT_BOUND'?'登录 WeftMate 账号后可开启云端备份。':'暂不可用';details.textContent='';return;}
            const usage=value.usage;details.textContent=usage?`已占用 ${size(usage.usedBytes+usage.reservedBytes)} / ${size(usage.limitBytes)} · 保留最近 3 份`:'只有你能解开。';
            status.textContent=value.status?.state==='failed'||value.status?.state==='deferred'?core.cloudBackupErrorText(value.status):value.status?.state==='uploading'?`正在备份 ${value.status.uploaded} / ${value.status.total}`:
                value.lastBackupAt?`上次云端备份：${core.dateText(value.lastBackupAt,{year:true})}`:value.enabled?'已开启，每天空闲时备份。':'尚未开启。换电脑后可用恢复码找回。';
            if(!value.enabled)actions.append(button('开启云端备份',()=>void run(async()=>codeDialog(await core.cloudBackupAction('prepare'))),'primary'));
            else actions.append(button('立即云端备份',()=>void run(async()=>{const result=await core.cloudBackupAction('run');await refresh();ui.toast(result.state==='unchanged'?'内容没有变化，无需再上传。':'云端备份已完成。');}),'primary'),button('查看恢复码',()=>passwordDialog('reveal')));
            if(value.enabled||value.keyAvailable){
                const more=button('更多',()=>{const box=modal('云端备份操作');if(value.enabled)box.body.append(button('更换恢复码',()=>{box.dialog.close();passwordDialog('rotate');}));box.body.append(button('删除云端备份',()=>{box.dialog.close();deleteDialog();},'danger'));});actions.append(more);
            }
            for(const backup of value.items??[]){
                const row=ui.element('li','system-service'),label=ui.element('div','system-service-detail');label.append(ui.element('strong','',core.dateText(backup.createdAt,{year:true})),ui.element('small','muted',size(backup.totalBytes)));
                const more=button('备份操作',()=>{
                    const box=modal('这份云端备份');box.body.append(ui.element('p','',`${core.dateText(backup.createdAt,{year:true})} · ${size(backup.totalBytes)}`));
                    box.body.append(button('删除这份备份',()=>{box.dialog.close();const confirmBox=modal('删除这份备份');confirmBox.body.append(ui.element('p','','这份备份将无法恢复。其他云端备份和电脑现有数据保留。'));
                        const notice=ui.element('p','field-help');notice.setAttribute('role','status');confirmBox.body.append(notice);const confirm=button('确认删除',async()=>{confirm.disabled=true;try{await core.cloudBackupAction('remove',{id:backup.id,confirm:true});confirmBox.dialog.close();await refresh();ui.toast('这份备份已删除，空间已释放。');}catch(e){notice.textContent=core.cloudBackupErrorText(e);confirm.disabled=false;}},'danger');confirmBox.foot.append(confirm);
                    },'danger'));
                });more.className='icon-button';more.setAttribute('aria-label','备份操作');more.replaceChildren(WeftIcons.create('more',18));
                row.append(label,button('恢复',()=>restoreDialog(backup)),more);list.append(row);
            }
        }
        const prompt=ui.element('aside','cloud-backup-prompt');prompt.hidden=true;prompt.setAttribute('aria-label','发现云端备份');document.body.append(prompt);
        checkCloudBackupPrompt=async()=>{
            if(!core.state.account||core.state.currentView!=='assistant'){prompt.hidden=true;return;}
            if(promptOwner!==core.state.account.ownerId)prompt.hidden=true;
            if(checking)return;checking=true;const token=core.accountToken();
            try{const next=await core.readCloudBackups();if(!core.accountIdentityCurrent(token)||core.state.currentView!=='assistant')return;
                if(!next.restoreSuggested){prompt.hidden=true;return;}const backup=next.items[0];if(promptId===backup.id&&!prompt.hidden)return;promptId=backup.id;
                promptOwner=core.state.account.ownerId;
                prompt.replaceChildren(ui.element('p','',`发现这个账号的云端备份（${core.dateText(backup.createdAt,{year:true})}，${size(backup.totalBytes)}），要恢复吗？`),
                    button('恢复',()=>restoreDialog(backup),'primary'),button('稍后',()=>{prompt.hidden=true;void core.cloudBackupAction('dismiss',{id:backup.id});}));prompt.hidden=false;
            }catch{/* The restore suggestion must not interrupt normal use. */}finally{checking=false;}
        };
        setInterval(()=>{void checkCloudBackupPrompt();},15000);
        return {refresh};
    }
    return { mountBackup, showSettingsBackups: () => showSettingsBackups(), checkCloudBackupPrompt:()=>checkCloudBackupPrompt() };
};
