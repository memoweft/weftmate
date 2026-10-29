/* Settings navigation and category placement. No domain requests or persistence here. */
globalThis.WeftUiComponents.factories.settingsNavigation = (core, ui) => {
    let registry, selected = 'general', dialog, search, navigation, content, picker, returnFocus, cloudNotice;
    const panels = new Map();
    const phoneSettings=()=>!globalThis.weftmateDesktop&&matchMedia('(max-width:600px) and (pointer:coarse)').matches;
    function showSettingsList(){
        const changed=dialog.dataset.mobilePage!=='list';
        dialog.dataset.mobilePage='list';ui.byId('settings-title').textContent='设置';
        if(changed)globalThis.WeftMotion.reveal(dialog.querySelector('.settings-sidebar'),'dur-1');
    }
    let transitions = [];
    function settleCategories() {
        const running=transitions;
        transitions = [];
        for (const animation of running) { animation.finish(); animation.cancel(); }
        for (const [key, panel] of panels) {
            panel.hidden = key !== selected; panel.inert = key !== selected;
            if (key === selected) panel.removeAttribute('aria-hidden'); else panel.setAttribute('aria-hidden','true');
        }
    }
    // view-enter / crossfade: both live pages occupy the same viewport during the turn.
    function transitionCategory(previous, next) {
        if (previous === next || !dialog.open || globalThis.WeftSettingsControls.reduced()) { settleCategories(); return; }
        const old = panels.get(previous), panel = panels.get(next);
        if (!old) { settleCategories(); return; }
        old.hidden = false; old.inert = true; old.setAttribute('aria-hidden','true');
        panel.hidden = false; panel.inert = false; panel.removeAttribute('aria-hidden');
        const order = registry.list({desktop:!!globalThis.weftmateDesktop}).map(item=>item.id);
        const direction = order.indexOf(next) > order.indexOf(previous) ? 1 : -1;
        const timing = { ...globalThis.WeftMotion.timing('dur-1'), fill:'none' };
        const outgoing = old.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:`translateY(${-direction * 8}px)`}],timing);
        const incoming = panel.animate([{opacity:0,transform:`translateY(${direction * 12}px)`},{opacity:1,transform:'translateY(0)'}],timing);
        transitions = [outgoing,incoming];
        incoming.finished.then(() => { if (transitions.includes(incoming)) settleCategories(); }, () => {});
    }
    let updateGeneration = 0;
    let usageScope = '';
    const mountedCategories = new Map();
    const mountAttempts=new Map();
    let searchObserver,searchFrame,searchTimer,searchHit;
    const node = (tag, className, text) => ui.element(tag, className, text);
    function locateSetting(panel) {
        searchObserver?.disconnect();cancelAnimationFrame(searchFrame);clearTimeout(searchTimer);searchHit?.removeAttribute('data-search-hit');
        const terms=search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);if(!terms.length)return;
        const locate=()=>{
            const match=[...panel.querySelectorAll('.settings-row,label,.capability-item')].find(row=>terms.every(term=>row.textContent.toLocaleLowerCase().includes(term)));
            if(!match)return false;
            searchObserver?.disconnect();
            for(let parent=match.parentElement;parent&&parent!==panel;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
            searchFrame=requestAnimationFrame(()=>{searchFrame=requestAnimationFrame(()=>{
                if(panel.hidden)return;match.scrollIntoView({block:'center',behavior:'instant'});match.dataset.searchHit='true';searchHit=match;
                searchTimer=setTimeout(()=>match.removeAttribute('data-search-hit'),1600);
            });});return true;
        };
        if(!locate()){searchObserver=new MutationObserver(locate);searchObserver.observe(panel,{childList:true,subtree:true});}
    }
    function mountCategory(category,panel,options) {
        const identity=core.state.identityGeneration;
        const attempt=(mountAttempts.get(category.id)||0)+1;mountAttempts.set(category.id,attempt);
        const current=()=>identity===core.state.identityGeneration&&mountAttempts.get(category.id)===attempt;
        const fail=()=>{
            if(!current())return;mountedCategories.delete(category.id);
            panel.querySelector('.settings-load-error')?.remove();
            const error=node('div','settings-load-error'),retry=node('button','button secondary small','重试');retry.type='button';
            error.setAttribute('role','status');error.append(node('p','muted',`${category.name}暂时无法打开，请重试。`),retry);panel.append(error);
            retry.onclick=()=>{error.remove();mountCategory(category,panel,options);};
        };
        try {
            const result=category.mount({...options,target:panel,core,ui});
            if(result?.then)result.then(()=>{if(current())mountedCategories.set(category.id,identity);},fail);
            else mountedCategories.set(category.id,identity);
        }catch{fail();}
    }
    function selectSettings(id, options = {}) {
        if (id === 'healthData') id = 'reviewHealth';
        const category = registry.get(id);
        if (!category || !registry.list({ desktop: !!globalThis.weftmateDesktop }).includes(category)) return;
        if(phoneSettings()){dialog.dataset.mobilePage='category';ui.byId('settings-title').textContent=category.name;}
        const sameScope = id !== 'usage' || usageScope === (options.sessionId || '');
        if (id === selected && sameScope && mountedCategories.get(id) === core.state.identityGeneration && !Object.keys(options).length && !search.value.trim()) return;
        if(id==='models')void core.refreshModelServices?.().catch(()=>ui.toast('模型服务暂时无法读取，请重试。'));
        if (!panels.has(id)) { const panel = node('section', 'settings-category'); panel.dataset.category = id; panels.set(id, panel); content.append(panel); }
        settleCategories();
        const previous = selected;
        const moveFocus=previous!==id&&panels.get(previous)?.contains(document.activeElement);
        if(id!=='about')clearTimeout(renderSettingsUpdates.timer);
        if (panels.get(selected)?.querySelector('.wm-skeleton,[aria-busy=true]')) mountedCategories.delete(selected);
        if (selected === 'devices' && id !== 'devices') ui.stopCloudPairing();
        selected = id;
        if (id !== 'memory' && core.state.currentView === 'memory') {
            core.show('account');
            void ui.paintAvatar?.(core.state.profileDraftAvatar === undefined ? core.state.account?.avatar : core.state.profileDraftAvatar,core.accountToken());
        }
        if (cloudNotice) cloudNotice.hidden = core.state.cloudAuth.mode !== 'authenticated' || !['account', 'devices'].includes(id);
        for (const [key, panel] of panels) { panel.hidden = key !== id; panel.inert = key !== id; }
        ui.byId('settings-title').textContent = category.name;
        if(moveFocus)ui.byId('settings-title').focus({preventScroll:true});
        picker.value = id; picker.dispatchEvent(new Event('weft:sync'));
        for (const button of navigation.querySelectorAll('button')) {
            button.classList.toggle('is-selected', button.dataset.category === id);
            if (button.dataset.category === id) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
        }
        const cached = mountedCategories.get(id) === core.state.identityGeneration;
        if (!cached || !sameScope || Object.keys(options).length || ['account', 'devices', 'memory', 'about', 'executionRecords', 'connectors'].includes(id))
            mountCategory(category,panels.get(id),options);
        if (id === 'usage') usageScope = options.sessionId || '';
        const panel = panels.get(id);
        if (id !== 'appearance') {
            globalThis.WeftSettingsControls.groupRows(panel, category.name);
            for (const form of panel.querySelectorAll('.personalization-form,.notification-settings')) globalThis.WeftSettingsControls.groupRows(form, category.name);
        }
        for (const heading of panel.querySelectorAll('h2')) {
            if (heading.textContent.trim() === category.name && !heading.closest('.settings-group')) heading.classList.add('settings-redundant-title');
        }
        registry.register({...category,keywords:[...new Set([...category.keywords,...[...panel.querySelectorAll('label,.row-label,h3')].map(item=>item.textContent.trim())])]});
        locateSetting(panel);
        transitionCategory(previous,id);
    }
    function renderSettingsNavigation() {
        navigation.replaceChildren(); picker.replaceChildren();
        let group;
        const matches=registry.list({desktop:!!globalThis.weftmateDesktop,query:search.value});
        for (const category of matches) {
            if (group !== category.group) { group = category.group; navigation.append(node('h2', 'settings-nav-group', group)); }
            const button = node('button', 'settings-nav-item', category.name); button.type = 'button'; button.dataset.category = category.id;
            button.prepend(globalThis.WeftIcons.create(category.icon, 16));
            button.addEventListener('click', () => selectSettings(category.id)); navigation.append(button);
            const option = new Option(`${category.group} · ${category.name}`, category.id); picker.append(option);
        }
        if (!navigation.children.length) navigation.append(node('p', 'muted settings-empty', '没有匹配的设置，试试“主题”或“费用”。'));
        picker.value = selected;
        for (const button of navigation.querySelectorAll('button')) if (button.dataset.category === selected) { button.classList.add('is-selected'); button.setAttribute('aria-current', 'page'); }
        if(search.value.trim()&&matches.length&&!(phoneSettings()&&dialog.dataset.mobilePage==='list')){if(!matches.some(category=>category.id===selected))selectSettings(matches[0].id);else locateSetting(panels.get(selected));}
    }
    function openSettings(id, options = {}) {
        if (!dialog.open) { returnFocus = document.activeElement; if (id === 'memory') { void core.openMemory(); return; } core.openAccount(); }
        selectSettings(id??selected, options);
        if(phoneSettings()&&id===undefined)showSettingsList();
    }
    function showSettingsDialog() {
        if (dialog?.open) return;
        if (dialog) { returnFocus = document.activeElement; dialog.inert = false; dialog.showModal(); }
        const strip = ui.byId('settings-usage-strip');
        const ready = WeftControls.loading(strip, { rows: 1, compact: true });
        void core.loadUsageStrip().then(text => { if (text && dialog.open && ready()) strip.textContent = text; }).catch(() => { if (dialog.open && ready()) strip.textContent = '本月用量暂时无法读取，点此重试。'; });
        selectSettings(selected);
        if(phoneSettings())showSettingsList();
        if(selected==='about')void renderSettingsUpdates();
    }
    function hideSettingsDialog() { if (dialog?.open) {
        settleCategories(); clearTimeout(renderSettingsUpdates.timer);
        for (const id of ['executionRecords', 'connectors']) mountedCategories.delete(id);
        dialog.inert = true; dialog.close();
    } }
    let updateView, updateIdentity;
    function updatesView() {
        const target = ui.byId('settings-updates');
        if (updateView && updateIdentity === core.state.identityGeneration) return updateView;
        updateIdentity = core.state.identityGeneration;
        const head = node('div','settings-update-head'), title = node('h2','settings-section-title','软件更新');
        const notice = node('p','settings-update-notice muted','正在读取更新状态…'); notice.setAttribute('role','status');
        const refresh = node('button','button secondary small','检查更新'); refresh.type='button';
        refresh.addEventListener('click',()=>void renderSettingsUpdates(true)); head.append(title,refresh);
        const layers = node('div','settings-update-layers');
        const channel = node('select'); channel.setAttribute('aria-label','更新通道');
        for (const [id,label] of [['stable','正式'],['preview','预览']]) channel.append(new Option(label,id));
        const channelRow = WeftSettingsControls.row('更新通道','正式版本适合日常使用；预览版本可提前体验新功能。',channel);channelRow.hidden=true;
        channel.addEventListener('change',async()=>{
            const view=updateView,token=core.accountToken(),previous=view.value?.channel; channel.disabled=true;
            try { await core.setUpdateChannel(channel.value); if(core.accountIdentityCurrent(token)&&view===updateView)await renderSettingsUpdates(); }
            catch { if(core.accountIdentityCurrent(token)&&view===updateView){notice.textContent='更新通道暂时无法切换，请等下载完成后重试。';channel.value=previous;channel.disabled=!view.value?.canChangeChannel;} }
        });
        const actions=node('div','settings-update-actions'), hint=node('p','muted'), restart=node('button','button primary small','重启并更新');restart.type='button';restart.hidden=true;
        restart.addEventListener('click',async()=>{
            const token=core.accountToken();restart.disabled=true;
            try { const result=await core.restartForUpdate();if(!core.accountIdentityCurrent(token))return;if(!result?.restarted)notice.textContent=result?.reason||'更新尚未就绪，请重新检查。'; }
            catch { if(core.accountIdentityCurrent(token))notice.textContent='更新未完成，请重新检查。'; }
            finally { if(core.accountIdentityCurrent(token))restart.disabled=false; }
        });actions.append(hint,restart);
        target.replaceChildren(head,notice,layers,channelRow,actions);
        updateView={target,notice,refresh,layers,channel,channelRow,actions,hint,restart,rows:new Map(),value:null};
        return updateView;
    }
    async function renderSettingsUpdates(check = false) {
        const view=updatesView(), token=core.accountToken(), generation=++updateGeneration;
        clearTimeout(renderSettingsUpdates.timer);
        const current=()=>core.accountIdentityCurrent(token)&&generation===updateGeneration&&dialog.open&&selected==='about';
        // First read and explicit checks have inline status. Polling retains the whole last snapshot.
        if(check){view.refresh.disabled=true;view.refresh.textContent='检查中…';view.notice.textContent='正在检查新版本，现有版本信息保留在下方。';}
        else if(!view.value)view.notice.textContent='正在读取更新状态…';
        let value;
        try {value=await(check?core.checkUpdates():core.readUpdateState());}
        catch {if(current()){view.refresh.disabled=false;view.refresh.textContent='重试读取';view.notice.textContent='暂时无法读取更新状态。请检查网络后重试；当前版本仍可使用。';}return;}
        if(!current())return;
        view.value=value;view.refresh.disabled=false;
        const names={ui:'电脑界面',app:'Windows 程序','mobile-ui':'手机界面'};
        const bytes=n=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.ceil(n/1024)} KB`;
        let failed=false,downloading=false;
        for(const layer of value.layers||[]){
            let item=view.rows.get(layer.layer);
            if(!item){
                const state=node('span','settings-update-state'),row=WeftSettingsControls.row(names[layer.layer]||'版本','',state);
                row.dataset.updateLayer=layer.layer;
                const progress=node('progress','settings-update-progress');progress.max=100;progress.setAttribute('aria-label',`${names[layer.layer]||'版本'}下载进度`);
                const detail=node('p','settings-update-detail muted');
                const notes=node('details','settings-update-notes'),summary=node('summary','','此次更新内容'),text=node('p','');notes.append(summary,text);
                row.append(progress,detail,notes);view.layers.append(row);
                item={row,state,copy:row.querySelector('.wm-description'),progress,detail,notes,text};
                if(!item.copy){item.copy=node('p','wm-description muted');row.firstElementChild.append(item.copy);}
                view.rows.set(layer.layer,item);
            }
            item.row.hidden=false;item.copy.textContent=`当前 ${layer.currentVersion||'版本未知'}${layer.availableVersion&&layer.availableVersion!==layer.currentVersion?` → ${layer.availableVersion}`:''}`;
            const error=!!layer.error||['failed','error'].includes(layer.status),active=['available','downloading'].includes(layer.status);
            failed ||= error;downloading ||= active;item.row.dataset.state=error?'error':active?'downloading':layer.status;
            item.state.textContent=core.updateStatusText(layer);
            item.progress.hidden=!active;
            const percent=layer.progress?.percent;
            if(Number.isFinite(percent))item.progress.value=Math.min(100,Math.max(0,percent));else item.progress.removeAttribute('value');
            const p=layer.progress;
            item.detail.textContent=active?(p?.total?`${bytes(p.transferred||0)} / ${bytes(p.total)}${p.bytesPerSecond?` · ${bytes(p.bytesPerSecond)}/s`:''}`:layer.downloadedBytes?`已下载 ${bytes(layer.downloadedBytes)}`:'正在获取更新文件，下载完成后会在这里提示。'):error?'检查网络连接后，可点“重试更新”。':layer.status==='downloaded'?'新版已下载并验证，准备好后即可更新。':'';
            item.detail.hidden=!item.detail.textContent;item.notes.hidden=!layer.releaseNotes;item.text.textContent=layer.releaseNotes||'';
        }
        for(const [key,item]of view.rows)item.row.hidden=!(value.layers||[]).some(layer=>layer.layer===key);
        view.refresh.textContent=failed?'重试更新':'检查更新';
        view.notice.textContent=failed?'更新未完成，当前版本仍可继续使用。':value.canRestart?'新版已准备好。':downloading?'更新正在下载，你可以继续使用 WeftMate。':value.layers?.length?'版本状态已同步。':'暂时没有可用的更新信息。你可以稍后重新检查。';
        view.channelRow.hidden=!value.channel;
        if(value.channel){if(document.activeElement!==view.channel)view.channel.value=value.channel;view.channel.disabled=!value.canChangeChannel;view.channel.dispatchEvent(new Event('weft:sync'));}
        view.restart.hidden=!value.canRestart;view.restart.textContent=value.manualInstall?'打开安装包':'重启并更新';
        view.hint.textContent=value.canRestart?(value.manualInstall?'打开安装包后按提示完成更新。':'重启前会等待进行中的任务结束，并创建备份。'):'';
        view.actions.hidden=!value.canRestart;
        if(value.layers?.some(layer=>['checking','available','downloading'].includes(layer.status)))renderSettingsUpdates.timer=setTimeout(()=>{if(current())void renderSettingsUpdates();},1500);
    }
    function mountSettingsNavigation() {
        for (const [id, name] of [['system-refresh', '刷新系统状态'], ['account-models-refresh', '刷新模型'], ['projects-refresh', '刷新项目'], ['browser-workspace-refresh', '刷新网页资料']]) {
            const button = ui.byId(id); if (!button) continue;
            button.className = 'icon-button'; button.replaceChildren(WeftIcons.create('sync', 18)); button.setAttribute('aria-label', name); button.title = name;
        }
        const account = ui.byId('account-view');
        dialog = node('dialog', 'settings-dialog'); dialog.id = 'settings-dialog'; dialog.setAttribute('aria-label', '设置');
        dialog.dataset.motionNativeClose='true';
        dialog.toggleAttribute('data-phone-settings',phoneSettings());
        const strip = node('button', 'settings-usage-strip'); strip.id = 'settings-usage-strip'; strip.type = 'button'; strip.setAttribute('aria-label', '用量详情'); strip.onclick = () => selectSettings('usage');
        const sidebar = node('aside', 'settings-sidebar');
        const sidebarTitle = node('p', 'settings-sidebar-title', '设置');
        search = node('input', 'settings-search'); search.type = 'search'; search.placeholder = '搜索设置'; search.setAttribute('aria-label', '搜索设置');
        const searchBox = node('div','settings-search-box'); searchBox.append(WeftIcons.create('search',16),search);
        navigation = node('nav', 'settings-navigation'); navigation.setAttribute('aria-label', '设置分类'); sidebar.append(sidebarTitle, searchBox, navigation);
        const main = node('div', 'settings-main'), head = node('header', 'settings-head');
        const title = node('h1', '', '常规'); title.id = 'settings-title'; title.tabIndex = -1;
        const close = node('button', 'icon-close'); close.type = 'button'; close.setAttribute('aria-label', '关闭设置'); close.append(globalThis.WeftIcons.create('deny', 24));
        const back=node('button','icon-button settings-list-back');back.type='button';back.setAttribute('aria-label','返回设置');back.append(WeftIcons.create('chevron',18));back.onclick=showSettingsList;
        head.append(back,title, close);
        picker = node('select', 'settings-category-picker'); picker.setAttribute('aria-label', '设置分类');
        content = node('div', 'settings-content');
        // The capability browser owns selection and DOM; its action runs first.
        content.addEventListener('click', event => {
            const tab=event.target.closest('.capability-tab');
            if(!tab||tab.getAttribute('aria-selected')==='true')return;
            const groups=tab.closest('.capabilities-browser').querySelector('.capabilities-groups');
            queueMicrotask(()=>globalThis.WeftMotion.reveal(groups,'dur-1'));
        },true);
        const bindDisclosures = () => content.querySelectorAll('details').forEach(globalThis.WeftSettingsControls.details);
        new MutationObserver(bindDisclosures).observe(content,{childList:true,subtree:true});
        addEventListener('weft-reply-motion-change', () => { if(globalThis.WeftSettingsControls.reduced())settleCategories(); });
        matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { if(globalThis.WeftSettingsControls.reduced())settleCategories(); });
        const originals = [...account.children]; account.append(content);
        for (const id of ['general', 'personalization', 'assistant', 'appearance', 'account', 'devices', 'usage', 'models', 'approvals', 'memory', 'schedules', 'resources', 'system', 'backups', 'about']) {
            const panel = node('section', 'settings-category'); panel.dataset.category = id; panel.hidden = true; panels.set(id, panel); content.append(panel);
        }
        const move = (id, element) => { if (element) panels.get(id).append(element); };
        move('approvals', ui.byId('approval-settings-heading').closest('section'));
        move('appearance', ui.byId('appearance-heading').closest('section'));

        move('account', ui.byId('account-heading').closest('section'));
        const accountSection = ui.byId('account-heading').closest('section');
        accountSection.classList.add('settings-profile');
        const profileTitle = node('h2','settings-section-title','个人资料');
        accountSection.prepend(profileTitle);
        const identity = node('div','settings-account-identity');
        const identityCopy = node('div','settings-account-identity-copy');
        const accountName = ui.byId('account-name'), accountRow = accountName.closest('.account-row');
        const avatar = accountSection.querySelector('.avatar-preview');
        identityCopy.append(accountName,node('span','muted','本机账户 · 对话和记忆保存在这台电脑'));
        identity.append(avatar,identityCopy); accountRow.replaceWith(identity);
        move('account', ui.byId('cloud-account'));
        move('devices', ui.byId('devices-heading').closest('section'));
        const cloud = ui.byId('cloud-settings');
        if (cloud) {
            cloudNotice = ui.byId('cloud-settings-status'); cloudNotice.classList.add('settings-cloud-status');
            cloud.querySelector('nav').hidden = true;
            move('account', cloud); move('devices', ui.byId('cloud-devices-panel'));
        }
        move('devices', document.querySelector('.account-downloads'));
        move('schedules', ui.byId('settings-schedules'));
        move('backups', document.querySelector('.backup-settings'));
        const system = ui.byId('system-heading').closest('section');
        const background = ui.byId('background-model-select');
        background.previousElementSibling.remove(); background.nextElementSibling.remove();
        const defaultModel = node('select'); defaultModel.id = 'default-model-select'; defaultModel.disabled=true; defaultModel.setAttribute('aria-label', '对话默认模型');
        panels.get('models').append(globalThis.WeftSettingsControls.row('对话默认模型', '用于新建对话；已有对话继续使用原模型。', defaultModel));
        const backgroundRow = globalThis.WeftSettingsControls.row('后台模型', '标题、记忆整理和关心使用此模型；本机模型共用一张显卡，后台等待所选模型已加载且聊天空闲，以免触发切换。', background);
        const currentModel = node('p', 'model-current'); currentModel.id = 'background-current-model';
        backgroundRow.firstElementChild.append(currentModel); panels.get('models').append(backgroundRow);
        move('models', ui.byId('background-model-notice'));
        move('system', system); move('models', ui.byId('account-model-section'));
        const form = ui.byId('account-model-form'), editor = node('dialog', 'dialog model-editor-dialog');
        editor.id = 'account-model-dialog'; editor.setAttribute('aria-labelledby', 'model-editor-title');
        editor.dataset.motionNativeClose='true';
        const editorHead = node('div', 'dialog-head'), editorTitle = node('h2', '', '添加模型'); editorTitle.id = 'model-editor-title';
        const editorClose = node('button', 'icon-close'); editorClose.type = 'button'; editorClose.setAttribute('aria-label', '关闭模型表单'); editorClose.append(globalThis.WeftIcons.create('deny', 24));
        editorClose.addEventListener('click', () => editor.close()); editorHead.append(editorTitle, editorClose);
        const test = node('button', 'button secondary small', '测试连接'); test.id = 'account-model-draft-test'; test.type = 'button';
        form.querySelector('.actions').prepend(test); form.classList.add('model-editor-form');
        ui.byId('account-model-cancel').hidden = false; ui.byId('account-model-cancel').textContent = '取消';
        const checks = node('div', 'model-check-result'); checks.id = 'account-model-draft-result'; checks.setAttribute('aria-live', 'polite');
        const actions = form.querySelector('.actions'), editorBody = node('div', 'model-editor-body');
        for (const child of [...form.children]) if (child !== actions) editorBody.append(child);
        editorBody.append(checks); actions.classList.add('dialog-footer'); form.append(editorBody, actions);
        editor.append(editorHead, form); document.body.append(editor);
        editor.addEventListener('close', () => { ui.byId('account-model-key').value = ''; core.state.accountModelEditing = null; });
        const tools = account.querySelector('.tool-settings');
        for (const section of [...tools.querySelectorAll('section')]) move('resources', section);
        move(globalThis.weftmateDesktop ? 'system' : 'general', ui.byId('connection-copy').closest('section'));
        for (const id of ['projects-status', 'browser-workspace-status']) ui.byId(id).replaceChildren(WeftControls.skeleton({rows:1,compact:true}));
        const nativeSettings = ui.byId('desktop-auto-start');
        if (nativeSettings) {
            const sendTo = ui.byId('desktop-send-to');
            if (sendTo) panels.get('general').append(sendTo.closest('.settings-row'));
            const original = nativeSettings.closest('section'); nativeSettings.remove();
            globalThis.WeftSettingsControls.toggle(nativeSettings);
            panels.get('general').append(globalThis.WeftSettingsControls.row('开机自启', '启动后留在托盘，随时继续对话。', nativeSettings)); original.remove();
        }
        const description = (id, name, help, value) => panels.get(id).append(globalThis.WeftSettingsControls.row(name, help, node('span', 'settings-value', value)));
        if (!nativeSettings) description('general', '开机自启', '在 WeftMate 桌面程序中设置。', '仅桌面程序');
        description('general', '关闭窗口时最小化到托盘', '关闭窗口后，WeftMate 继续在后台运行。', globalThis.weftmateDesktop ? '已启用' : '仅桌面程序');
        if (globalThis.weftmateDesktop?.openLogs) {
            const logs = node('button', 'button secondary small', '打开日志文件夹'); logs.type = 'button';
            logs.addEventListener('click', async () => { try { await globalThis.weftmateDesktop.openLogs(); } catch { ui.toast('日志文件夹暂时无法打开，请重试。'); } });
            panels.get('general').append(globalThis.WeftSettingsControls.row('运行日志', '保留最近 7 天的运行状态，不记录对话、记忆内容或密钥。', logs));
        }
        const language=node('select');language.setAttribute('aria-label','语言');language.dataset.searchable='true';language.dataset.checkSelection='true';language.append(new Option('简体中文','zh-CN'));
        panels.get('general').append(WeftSettingsControls.row('语言','目前提供简体中文。',language));WeftSettingsControls.select(language);
        panels.get('appearance').replaceChildren(node('p', 'muted', '保存到这台设备。'));
        WeftDesktopAppearanceControls.mount(panels.get('appearance'), { get: WeftDesktop.getAppearance, set: WeftDesktop.setAppearance, toast: ui.toast });
        ui.byId('conversation-pane').after(ui.byId('memory-view'));
        const memoryLink=node('button','button secondary','打开记忆');memoryLink.type='button';memoryLink.onclick=()=>core.openMemory();
        panels.get('memory').append(WeftSettingsControls.row('记忆','查看记住的事、原话与来源，纠正或忘掉内容。',memoryLink));

        const updates = node('section', 'settings-updates'); updates.id = 'settings-updates'; panels.get('about').append(updates);
        for (const [label,action] of [['更新内容',()=>ui.openReleases()],['帮助与小技巧',()=>ui.openHelp()]]) {
            const link=node('button','button secondary',label);link.type='button';link.onclick=()=>{ui.byId('account-back').click();action();};
            panels.get('about').append(globalThis.WeftSettingsControls.row(label,'在应用内阅读。',link));
        }
        const appVersion = node('span', 'settings-value');
        appVersion.append(WeftControls.skeleton({rows:1,compact:true}));
        const product=node('header','settings-product'),productCopy=node('div');
        productCopy.append(node('h2','','WeftMate'),appVersion,node('p','muted','对话、工作与记忆，在你的电脑上。'));
        product.append(WeftIcons.create('desktop',32),productCopy);panels.get('about').prepend(product);
        if(globalThis.weftmateDesktop)void globalThis.weftmateDesktop.settings().then(settings=>{appVersion.textContent='Windows · '+settings.version;}).catch(()=>{appVersion.textContent='Windows · 版本暂时无法读取';});
        else appVersion.textContent='远程网页';
        const version = node('span', 'settings-value'); version.id = 'settings-host-version'; version.append(WeftControls.skeleton({rows:1,compact:true}));
        panels.get('about').append(globalThis.WeftSettingsControls.row('宿主版本', '来自当前连接的宿主。', version));
        const feedback = node('a', 'button secondary', '反馈问题'); feedback.href = 'https://github.com/memoweft/weftmate/issues'; feedback.target = '_blank'; feedback.rel = 'noopener noreferrer';
        panels.get('about').append(globalThis.WeftSettingsControls.row('帮助与反馈', '描述问题时请勿包含密码或私人对话。', feedback));
        for (const [name, kind] of [['服务条款', 'terms'], ['隐私政策', 'privacy']]) {
            const button = node('button', 'button secondary', '阅读' + name); button.type = 'button';
            button.addEventListener('click', () => { void ui.openLegal(kind); });
            panels.get('about').append(globalThis.WeftSettingsControls.row(name, '在应用内阅读。', button));
        }
        for (const original of originals) if (original.parentNode === account) original.hidden = true;
        account.append(content); main.append(head, strip, picker); if (cloudNotice) main.append(cloudNotice); main.append(account); dialog.append(sidebar, main); document.body.append(dialog);
        registry = globalThis.WeftUiCore.settingsRegistry({
            approvals: () => { let target=panels.get('approvals').querySelector('.permission-settings'); if(!target){target=node('div','permission-settings');panels.get('approvals').prepend(target);}globalThis.WeftPermissionRulesView(core,target,{toast:ui.toast}); },
            connectors: ({target}) => globalThis.WeftConnectorsView(core,target,{desktop:!!globalThis.weftmateDesktop,toast:ui.toast}),
            executionRecords: ({target}) => globalThis.WeftExecutionRecordsView(core,target,{current:()=>dialog.open&&selected==='executionRecords',openConversation:async row=>{ui.byId('account-back').click();if(core.state.currentView!=='assistant')await core.enterAssistant();if(row)await core.selectSession(row.sessionId);}}),
            system: () => { void core.refreshSystem(); },
            models: () => core.refreshModelSettings(),
            data: ({target}) => globalThis.WeftDataView(core,target,{toast:ui.toast}),
            reviewHealth: () => globalThis.WeftNotificationsView(core, panels.get('reviewHealth'), {toast:ui.toast, section:'reviewHealth'}),
            notifications: () => globalThis.WeftNotificationsView(core, panels.get('notifications'), {toast:ui.toast}),
            personalization: () => globalThis.WeftPersonalizationView(core, panels.get('personalization'), 'personalization', {toast:ui.toast}),
            assistant: () => globalThis.WeftPersonalizationView(core, panels.get('assistant'), 'assistant', {toast:ui.toast}),
            account: () => { ui.selectCloudSettings?.('account'); ui.paintCloudSettings?.(); },
            devices: () => { ui.selectCloudSettings?.('devices'); ui.paintCloudSettings?.(); },
            memory: () => {},
            backups: () => ui.showSettingsBackups(),
            schedules: () => ui.showSettingsSchedules(),
            usage: options => ui.showSettingsUsage(options),
            archived: () => ui.showSettingsArchived(panels.get('archived')),
            about: () => { version.textContent = core.state.system?.host?.version || '版本未知'; void renderSettingsUpdates(); },
        });
        search.addEventListener('input', renderSettingsNavigation); picker.addEventListener('change', () => selectSettings(picker.value));
        close.addEventListener('click', () => ui.byId('account-back').click());
        dialog.addEventListener('keydown', event => {
            if (globalThis.WeftShortcuts.dispatch(event, { new: () => ui.byId('new-session').click() })) event.stopPropagation();
        });
        dialog.addEventListener('cancel', event => { event.preventDefault(); ui.byId('account-back').click(); });
        dialog.addEventListener('close', () => { ui.stopAccountPairing?.(); returnFocus?.focus(); });
        navigation.addEventListener('keydown', event => {
            if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
            const buttons = [...navigation.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
            if (index < 0) return; event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
            buttons[next].focus({preventScroll:true});buttons[next].click();buttons[next].scrollIntoView({block:'nearest'});
        });
        renderSettingsNavigation(); selectSettings(selected);
        globalThis.WeftPopover.bindSettings(dialog);
        globalThis.WeftPopover.bindSettings(editor);
        globalThis.WeftSettingsNavigation = { open: openSettings, register: entry => { registry.register(entry); renderSettingsNavigation(); } };
    }
    return { mountSettingsNavigation, openSettings, selectSettings, showSettingsDialog, hideSettingsDialog };
};
