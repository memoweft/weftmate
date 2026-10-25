/* Desktop settings component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.settings = (core, ui) => {
    let serviceEditing = null, draftCatalog = null, queryGeneration = 0, serviceSelectPopup;
    function selectorLabel(button,text){button.replaceChildren(document.createTextNode(text),WeftIcons.create('chevron',18));}
    function serviceSelectMenu(trigger,entries){
        WeftPopover.closeMenu();serviceSelectPopup?.close(false);
        const opened=WeftPopover.openMenu(trigger,entries,{onClose:()=>{serviceSelectPopup=null;}});serviceSelectPopup=opened;opened.menu.classList.add('wm-model-service-select-menu');
        for(const [index,item] of [...opened.menu.querySelectorAll(':scope > button')].entries()){
            for(const svg of item.querySelectorAll(':scope > svg'))svg.remove();
            const check=ui.element('span','wm-model-service-choice-check');if(entries[index].checked)check.append(WeftIcons.create('allow',18));item.append(check);
        }
        return opened;
    }
    function serviceFields() {
        const name = ui.byId('account-model-name').value.trim(), baseUrl = ui.byId('account-model-base-url').value.trim();
        const key = ui.byId('account-model-key').value;
        return {name,baseUrl,interfaceType:ui.byId('account-model-form').dataset.interfaceType || 'openai-compatible',...(key ? {apiKey:key} : {})};
    }
    function serviceModelChoices(models = []) {
        const list = ui.byId('service-model-choices'); list.replaceChildren();
        for (const model of models) {
            const label = ui.element('label','wm-model-service-check'), check = ui.element('input'); check.type = 'checkbox'; check.checked = model.enabled !== false; check.dataset.modelId = model.modelId;
            label.append(check,ui.element('span','',model.name || model.modelId)); list.append(label);
        }
        ui.byId('account-model-id').parentElement.dataset.catalogStatus = draftCatalog?.status || serviceEditing?.catalog?.status || '';
    }
    async function queryModelServiceDraft() {
        const generation = ++queryGeneration, token = core.accountToken(), fields = serviceFields();
        const result = ui.byId('account-model-draft-result'); result.replaceChildren(WeftControls.skeleton({rows:1,compact:true,tag:'span'}));
        try {
            const value = await core.checkModelService({...fields,...(serviceEditing ? {serviceId:serviceEditing.serviceId} : {})});
            if (generation !== queryGeneration || !core.accountCurrent(token) || !ui.byId('account-model-dialog').open) return;
            draftCatalog = value.catalog || value; serviceModelChoices(draftCatalog.models || []);
            result.textContent = draftCatalog.message || (draftCatalog.status === 'available' ? `找到 ${draftCatalog.models?.length || 0} 个模型` : '暂时读不到模型清单，可以填写一个模型名称。');
            ui.byId('service-manual-model').hidden = draftCatalog.status === 'available' && draftCatalog.models?.length > 0;
        } catch {
            if (generation === queryGeneration && core.accountCurrent(token)) { result.textContent = '暂时连不上这个模型服务。检查地址后重试，也可以填写模型名称。'; ui.byId('service-manual-model').hidden = false; }
        }
    }
    function ensureServiceEditor() {
        const form = ui.byId('account-model-form'); if (ui.byId('service-model-choices')) return;
        const dialog = ui.byId('account-model-dialog'); dialog.classList.add('wm-model-service-editor');
        const body = form.querySelector('.model-editor-body');
        const preset = ui.element('button','button secondary small','选择模型服务'); preset.type='button';preset.id='service-preset';preset.setAttribute('aria-haspopup','menu');
        const choices = ui.element('div','wm-model-service-models'); choices.id='service-model-choices';choices.setAttribute('aria-label','显示的模型');
        const manual = ui.element('div');manual.id='service-manual-model';manual.hidden=true;
        const input = ui.byId('account-model-id'), label = body.querySelector('label[for="account-model-id"]'); label.textContent='模型名称（这个服务不提供清单时填写）'; manual.append(label,input);
        const type = ui.element('button','button secondary small','接口：OpenAI 兼容');type.type='button';type.id='service-interface-type';type.setAttribute('aria-haspopup','menu');
        selectorLabel(preset,'选择模型服务');selectorLabel(type,'接口：OpenAI 兼容');
        type.addEventListener('click',()=>serviceSelectMenu(type,[['openai-compatible','OpenAI 兼容'],['anthropic','Claude']].map(([id,name])=>({name,checked:(form.dataset.interfaceType||'openai-compatible')===id,action:()=>{form.dataset.interfaceType=id;selectorLabel(type,`接口：${name}`);draftCatalog=null;}}))));
        preset.addEventListener('click',()=>serviceSelectMenu(preset,[...globalThis.WeftOnboardingCopy.presets,{id:'custom',name:'自定义',baseUrl:'',help:''}].map(p=>({name:p.name,checked:(form.dataset.servicePreset||'custom')===p.id,action:()=>{
            ui.byId('account-model-name').value=p.name;ui.byId('account-model-base-url').value=p.baseUrl;ui.byId('account-model-key').value='';ui.byId('account-model-id').value='';form.dataset.interfaceType=p.id==='anthropic'?'anthropic':'openai-compatible';form.dataset.servicePreset=p.id;selectorLabel(type,`接口：${p.id==='anthropic'?'Claude':'OpenAI 兼容'}`);selectorLabel(preset,p.name);draftCatalog=null;choices.replaceChildren();ui.byId('account-model-key').focus();
        }}))));
        body.prepend(preset);body.insertBefore(type,body.querySelector('label[for="account-model-key"]'));body.append(choices,manual);
        const tier = ui.byId('account-model-tier');tier.dataset.controlHidden='true';tier.dispatchEvent(new Event('weft:sync'));
        for (const el of [tier,body.querySelector('label[for="account-model-tier"]')]) el.hidden=true;
        for(const help of body.querySelectorAll('.field-help'))if(help.textContent.includes('本机和局域网地址'))help.hidden=true;
        body.querySelector('label[for="account-model-base-url"]').textContent='服务地址';body.querySelector('label[for="account-model-name"]').textContent='服务名称';
        ui.byId('account-model-draft-test').textContent='重新查询模型';
        ui.byId('account-model-key').addEventListener('blur',()=>{if(ui.byId('account-model-key').value&&ui.byId('account-model-base-url').value)void queryModelServiceDraft();});
    }
    function openModelServiceEditor(service = null) {
        ensureServiceEditor();serviceEditing=service;draftCatalog=null;queryGeneration++;
        const form=ui.byId('account-model-form');form.hidden=false;form.reset();form.dataset.interfaceType=service?.interfaceType||'openai-compatible';
        ui.byId('account-model-name').value=service?.name||'';ui.byId('account-model-base-url').value=service?.baseUrl||'';ui.byId('account-model-key').placeholder=service?'留空沿用已保存的密钥':'填写这个服务的密钥';ui.byId('account-model-id').value='';
        ui.byId('model-editor-title').textContent=service?'编辑模型服务':'添加模型服务';ui.byId('account-model-submit').textContent=service?'保存修改':'保存并使用';ui.byId('account-model-form-status').textContent='';ui.byId('account-model-draft-result').textContent=service?.catalog?.message||'';
        selectorLabel(ui.byId('service-interface-type'),`接口：${service?.interfaceType==='anthropic'?'Claude':'OpenAI 兼容'}`);
        form.dataset.servicePreset=globalThis.WeftOnboardingCopy.presets.find(p=>p.baseUrl===service?.baseUrl)?.id||'custom';selectorLabel(ui.byId('service-preset'),service?.name||'选择模型服务');
        serviceModelChoices(service?.models||[]);ui.byId('service-manual-model').hidden=!service||!!service.models?.length;
        ui.byId('account-model-dialog').showModal();ui.byId(service?'account-model-name':'service-preset').focus();
    }
    async function saveModelServiceDraft() {
        const token=core.accountToken(),fields=serviceFields();if(!fields.name||!fields.baseUrl){accountModelFormNotice('请填写服务名称和地址。');return;}
        accountModelFormBusy(true);accountModelFormNotice('正在保存模型服务…');
        try {
            if (!draftCatalog && !serviceEditing) await queryModelServiceDraft();
            const models=[...ui.byId('service-model-choices').querySelectorAll('input')].map(c=>({modelId:c.dataset.modelId,enabled:c.checked}));
            const manual=ui.byId('account-model-id').value.trim();
            const result=await core.writeModelService(serviceEditing?.serviceId,{...fields,...(serviceEditing?{expectedRevision:serviceEditing.revision}:{}),...(models.length?{models}:{}),...(manual?{modelId:manual}:{})});
            if(!core.accountCurrent(token))return;
            if (!serviceEditing && result.service?.models?.length) {
                const selected=core.preferredServiceModel(result.service);
                if(selected)await core.selectServiceModel({serviceId:result.service.serviceId,modelId:selected.modelId});
            }
            if(core.accountCurrent(token)){ui.byId('account-model-key').value='';ui.byId('account-model-dialog').close();ui.toast('模型服务已保存');}
        } catch {if(core.accountCurrent(token))accountModelFormNotice('模型服务没保存成功，原来的设置仍可使用。请检查地址和密钥后重试。');}
        finally {if(core.accountCurrent(token))accountModelFormBusy(false);}
    }
    function renderModelServices() {
        const heading=ui.byId('account-model-section').querySelector('h2');heading.textContent='模型服务';
        heading.nextElementSibling.textContent='填一个地址和密钥，自动列出可用模型。';
        const list=ui.byId('account-models-list');list.replaceChildren();list.classList.add('wm-model-service-list');
        ui.byId('account-model-add').hidden=!core.state.modelServicesCanManage;ui.byId('account-models-status').textContent='';
        if(!core.state.modelServices.length){list.append(ui.element('li','wm-model-empty','添加一个模型服务，就可以开始聊天。'));return;}
        for(const service of core.state.modelServices){
            const row=ui.element('li','wm-model-service-card'),open=ui.element('button','wm-model-service-open');open.type='button';
            const main=ui.element('span','wm-model-service-main');main.append(ui.element('strong','',service.name),ui.element('small','',service.baseUrl),ui.element('small','',`${service.models.filter(m=>m.enabled!==false).length} / ${service.models.length} 个模型 · ${service.catalog?.message||'尚未查询'}`));
            if(service.catalog?.checkedAt)main.append(ui.element('small','',`上次查询：${core.dateText(service.catalog.checkedAt)}`));open.append(main);open.addEventListener('click',()=>openModelServiceEditor(service));row.append(open);
            const more=ui.element('button','icon-button');more.type='button';more.setAttribute('aria-label',`更多${service.name}操作`);more.setAttribute('aria-haspopup','menu');more.append(WeftIcons.create('more',18));more.disabled=!core.state.modelServicesCanManage;
            more.addEventListener('click',()=>WeftPopover.menu(more,[{name:'重新查询模型',icon:'sync',action:async()=>{await core.accessApi(`/model-services/${encodeURIComponent(service.serviceId)}/refresh`,{method:'POST',protectedWrite:true,body:{}});await core.refreshModelServices();}},{name:more.dataset.confirm?'确认删除模型服务':'删除模型服务',icon:'trash',danger:true,action:async()=>{if(!more.dataset.confirm){more.dataset.confirm='yes';ui.toast('再次打开菜单并确认删除此模型服务');return;}try{await core.writeModelService(service.serviceId,{expectedRevision:service.revision},'DELETE');ui.toast('模型服务已删除');}catch{ui.toast('删除未完成，请稍后重试。');}}}]));row.append(more);list.append(row);
        }
    }
    let runRecords;
    function records() { return runRecords ||= globalThis.WeftRunRecords?.mount(ui.byId('system-heading').closest('section'), {core,toast:ui.toast,retry:()=>core.refreshSystem()}); }
    function paintSystem(system, settings, catalog, token) {
        ui.byId('background-model-notice').textContent = system.backgroundModelFallback
            ? '后台模型不可用，暂时用聊天模型代替' : '';
        records()?.paint(system.runRecord || {state:'error'});
        const list = ui.byId('system-services'); list.replaceChildren();
        const rows = system.components || [['host', '对话与工具'], ['memory', '记忆'], ['model', '回复模型'],
            ['relay', '远程连接'], ['certificate', '安全连接']].map(([id, name]) => {
            const value = system[id] || {state:'disabled'};
            const state = ['ready','connected','online'].includes(value.state) ? 'healthy' :
                ['disabled','unconfigured'].includes(value.state) ? 'disabled' : 'problem';
            return {id,name,state,label:{healthy:'正常',problem:'有问题',disabled:'未启用'}[state],
                description:state === 'healthy' ? '连接正常。' : state === 'disabled' ? '尚未启用。' : '暂时无法连接，请检查设置。',
                repairable: !!value.canRestart, nextStep:{target:id === 'model' ? 'models' : id === 'memory' ? 'memory' : 'devices',label:'查看相关设置'}};
        });
        for (const value of rows) {
            const item = ui.element('li', 'system-service'); item.dataset.component = value.id; item.dataset.state = value.state;
            const details = ui.element('div', 'system-service-detail'), title = ui.element('div', 'system-service-title');
            title.append(ui.element('strong', '', value.name), ui.element('span', 'system-status-label', value.label));
            details.append(title, ui.element('small', 'muted', value.description));
            if (value.semanticRecall) details.append(ui.element('small', 'muted system-semantic',
                `按意思找 · ${value.semanticRecall.label} · ${value.semanticRecall.description}`));
            item.append(details);
            if (value.state === 'problem') {
                const native = globalThis.weftmateDesktop;
                const restart = ui.element('button', 'button secondary small', '修复'); restart.type = 'button';
                restart.setAttribute('aria-label', `修复${value.name}`);
                restart.disabled = !native?.repairSystem || !system.canRestart || value.repairable === false;
                if (native?.repairSystem) {
                    restart.addEventListener('click', async () => {
                        restart.disabled = true; restart.textContent = '修复中…'; item.setAttribute('aria-busy', 'true');
                        let repaired = false;
                        try { await native.repairSystem(value.id); repaired = true; }
                        catch { /* The next status read tells the actual result; retain the specific next step. */ }
                        if (core.accountCurrent(token)) {
                            await core.refreshSystem();
                            const row = core.state.system?.components?.find(row => row.id === value.id);
                            ui.toast(repaired && row?.state === 'healthy' ? `${value.name}已恢复` : '暂时没有恢复，请按说明检查相关设置。');
                        }
                    }); item.append(restart);
                }
                if (value.nextStep) {
                    const next = ui.element('button', 'button secondary small system-next-step', value.nextStep.label); next.type = 'button';
                    next.addEventListener('click', () => {
                        const destination = {connections:'devices',diagnostics:'system'}[value.nextStep.target] || value.nextStep.target;
                        if (destination === 'system') ui.byId('system-heading').closest('section').querySelector('.run-records')?.scrollIntoView({block:'center'});
                        else ui.openSettings(destination);
                    }); details.append(next);
                }
            }
            list.append(item);
        }
        if (system.backgroundModelFallback) {
            const item = ui.element('li', 'system-service'); item.dataset.component = 'background-model';
            const details = ui.element('div', 'system-service-detail');
            details.append(ui.element('small', 'muted', '后台模型不可用，暂时用聊天模型代替'));
            const restore = ui.element('button', 'button secondary small', '改回原后台模型'); restore.type = 'button';
            restore.addEventListener('click', async () => {
                restore.disabled = true;
                try { await core.accessApi('/settings/models', { method: 'PATCH', protectedWrite: true, body: { backgroundModelProfileId: system.backgroundModelFallback.profileId } }); await core.refreshSystem(); }
                catch { ui.toast('原来的模型还不可用，可以在下方重新选择。'); }
                finally { if (core.accountCurrent(token)) restore.disabled = false; }
            });
            item.append(details, restore); list.append(item);
        }
        paintPerformance(system.metrics);
        paintDiagnosticExport(system);
        const services=core.state.modelServices||[];
        catalog={...catalog,models:catalog.models.map(model=>{const found=services.flatMap(s=>s.models).find(row=>row.profileId===model.id||row.profileIds?.includes(model.id));return found?{...model,name:found.name}:model;})};
        const select = ui.byId('background-model-select');
        const currentId = settings.currentChatModelProfileId ?? core.state.sessions.find(row => row.sessionId === core.state.selectedSessionId)?.modelProfileId;
        const currentName = catalog.models.find(row => row.id === currentId)?.name;
        ui.byId('background-current-model').textContent = currentName ? `当前主模型：${currentName}` : '当前主模型：最近聊天的模型（尚无可用记录）';
        select.replaceChildren(new Option(currentName ? `跟随主模型（当前：${currentName}）` : '跟随主模型（最近聊天的模型）', ''));
        const defaults = ui.byId('default-model-select');
        defaults.replaceChildren(new Option('沿用对话选择', ''));
        for (const model of catalog.models.filter(model => model.configured)) defaults.append(new Option(model.name, model.id));
        defaults.value = settings.defaultModelProfileId ?? '';
        defaults.disabled = false;
        core.state.allModels = catalog.models;
        ui.renderAccountModels();
        for (const model of catalog.models.filter(model => model.configured))
            select.append(new Option(model.name, model.id));
        if (settings.backgroundModelProfileId && ![...select.options].some(option => option.value === settings.backgroundModelProfileId)) {
            select.append(new Option('原后台模型不可用，请重新选择', settings.backgroundModelProfileId));
        }
        select.value = settings.backgroundModelProfileId ?? '';
        select.disabled = false;
        ui.byId('system-notice').textContent = system.queue?.backgroundPending
            ? `${system.queue.backgroundPending} 项后台请求排队中` : '';
    }
    function paintPerformance(metrics) {
        const section = ui.byId('system-metrics'); section.replaceChildren(ui.element('h3', '', '运行表现'));
        for (const [id, name, help] of [['startup', '启动用时', '本次打开程序到界面就绪'],
            ['firstToken', '回复首字', '最近 20 次回复的中位时间，包含等待与思考'], ['memory', '当前内存', '程序各进程正在使用的内存']]) {
            const metric = metrics?.[id], value = metric?.value;
            const formatted = typeof value !== 'number' ? '—' : id === 'memory' ? `${Math.round(value / 1024 ** 2)} MB` : `${(value / 1000).toFixed(1)} 秒`;
            const row = ui.element('div', 'system-metric'); row.dataset.metric = id;
            const text = ui.element('div'); text.append(ui.element('strong', '', name), ui.element('small', 'muted', help));
            const figure = ui.element('div', 'system-metric-value'); figure.append(ui.element('strong', '', formatted),
                ui.element('small', 'muted', metric?.reference || '尚未记录'));
            row.append(text, figure); section.append(row);
        }
    }
    function paintDiagnosticExport(system) {
        const section = ui.byId('system-diagnostic-export');
        section.hidden = !globalThis.weftmateDesktop?.exportSystemDiagnostics;
        ui.byId('system-diagnostic-save').disabled = !system.canRestart;
    }
    function mountDiagnosticTools() {
        const section = ui.byId('system-heading').closest('section');
        const metrics = ui.element('section', 'system-metrics'); metrics.id = 'system-metrics'; section.append(metrics);
        const exporter = ui.element('section', 'system-diagnostic-export'); exporter.id = 'system-diagnostic-export';
        exporter.hidden = !globalThis.weftmateDesktop?.exportSystemDiagnostics;
        exporter.append(ui.element('h3', '', '诊断包'), ui.element('p', 'muted', '遇到问题时，保存一份不含私人内容的诊断记录。'));
        const open = ui.element('button', 'button secondary small', '导出诊断包…'); open.type = 'button';
        const preview = ui.element('div', 'system-export-preview'); preview.id = 'system-export-preview'; preview.hidden = true;
        preview.append(ui.element('p', '', '包含：脱敏运行记录、诊断摘要、连接状态、版本信息，以及启动、首字和内存指标。'),
            ui.element('p', 'muted', '不包含：对话正文、记忆内容、密钥、登录凭据、账号信息、电脑名称或崩溃内存文件。'));
        const actions = ui.element('div', 'actions'), save = ui.element('button', 'button primary small', '选择保存位置');
        save.id = 'system-diagnostic-save'; save.type = 'button';
        const cancel = ui.element('button', 'button secondary small', '取消'); cancel.type = 'button';
        cancel.addEventListener('click', () => { preview.hidden = true; open.hidden = false; open.focus(); });
        open.addEventListener('click', () => { preview.hidden = false; open.hidden = true; save.focus(); });
        save.addEventListener('click', async () => {
            save.disabled = true; save.textContent = '正在导出…';
            try { const result = await globalThis.weftmateDesktop.exportSystemDiagnostics();
                if (result.saved) { ui.toast('诊断包已保存'); preview.hidden = true; open.hidden = false; }
            } catch { ui.toast('诊断包未保存，请重新选择一个可写的位置。'); }
            finally { save.disabled = false; save.textContent = '选择保存位置'; }
        });
        actions.append(save, cancel); preview.append(actions); exporter.append(open, preview); section.append(exporter);
    }
    function systemVisible() {
        const panel = ui.byId('system-heading').closest('.settings-category');
        return panel?.hidden === false && ui.byId('settings-dialog')?.open;
    }
    function systemLoading() {
        records()?.paint(null);
        ui.byId('system-notice').replaceChildren(WeftControls.skeleton({rows:1,compact:true,tag:'span'}));
        ui.byId('system-services').replaceChildren();
        ui.byId('background-model-select').disabled = true;
    }
    function systemNotice(message) {
        records()?.paint({state:"error"});
        ui.byId('system-notice').textContent = message;
    }
    function updateOtherDeviceInstall() {
        const platformId = ui.byId('other-device-platform').value;
        const platform = ui.installPlatforms[platformId] || ui.installPlatforms.android;
        const link = ui.byId('other-device-platform-link');
        const image = ui.byId('other-device-qr');
        const qrStatus = ui.byId('other-device-qr-status');
        const platformStatus = ui.byId('other-device-platform-status');
        qrStatus.hidden = true;
        platformStatus.hidden = !platform.preparing && platformId !== 'windows';
        platformStatus.textContent = platform.preparing ? `${platform.name}安装方式准备中，可扫码查看官网信息。`
            : platformId === 'windows' ? 'Windows 请使用网页版，前往官网查看。' : '';
        if (!platform.qr) {
            link.hidden = true;
            image.hidden = true;
            link.setAttribute('href', 'https://www.weftmate.com/downloads/');
            link.setAttribute('aria-label', '打开官网查看 Windows 网页版');
            return;
        }
        link.hidden = false;
        image.hidden = false;
        link.setAttribute('href', `https://www.weftmate.com/downloads/?platform=${platform.qr}`);
        link.setAttribute('aria-label', `打开${platform.name}下载页面`);
        image.alt = `${platform.name}下载页面二维码`;
        image.src = ui.publicPlatformQrData[platform.qr];
    }
    function resetOtherDeviceInstall() {
        const details = ui.byId('other-device-install');
        if (details.open)
            details.open = false;
        ui.byId('other-device-platform').value = 'android';
        ui.updateOtherDeviceInstall();
    }
    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className)
            node.className = className;
        if (text !== undefined)
            node.textContent = text;
        return node;
    }
    function mountSettings() {
        mountDiagnosticTools();
        ui.mountBackup();
        ui.mountUsage();
        ui.mountSchedules();
        ui.byId('other-device-platform').addEventListener('change', ui.updateOtherDeviceInstall);
        ui.byId('other-device-qr').addEventListener('error', () => {
            ui.byId('other-device-qr').hidden = true;
            ui.byId('other-device-qr-status').hidden = false;
        });
        ui.byId('projects-refresh').addEventListener('click', () => { void core.refreshProjects(); });
        ui.byId('browser-workspace-refresh').addEventListener('click', () => { void core.refreshBrowserWorkspace(); });
        ui.byId('browser-model-select').addEventListener('change', ui.renderBrowserModels);
        ui.byId('browser-workspace-form').addEventListener('submit', event => { event.preventDefault(); void core.startBrowserDraft({ urls: ui.byId('browser-url-list').value, goal: ui.byId('browser-goal').value, modelProfileId: ui.byId('browser-model-select').value }); });
        ui.byId('project-register-form').addEventListener('submit', event => { event.preventDefault(); void core.registerProjectDraft({ name: ui.byId('project-name').value, rootPath: ui.byId('project-root').value }); });
        ui.byId('system-refresh').addEventListener('click', () => { void core.refreshSystem(); });
        ui.byId('background-model-select').addEventListener('change', async (event) => {
            const token = core.accountToken(), select = event.target;
            select.disabled = true;
            try {
                await core.saveBackgroundModel(select.value || null);
                if (core.accountCurrent(token))
                    ui.byId('background-model-notice').textContent = '后台模型已保存';
            }
            catch {
                if (core.accountCurrent(token))
                    ui.byId('background-model-notice').textContent = '保存失败，请刷新后重试。';
            }
            finally {
                if (core.accountCurrent(token))
                    select.disabled = false;
            }
        });
        ui.byId('account-models-refresh').addEventListener('click', () => { void core.refreshModelServices(true).catch(()=>ui.toast('模型服务暂时无法读取，请重试。')); });
        document.addEventListener('change', async event => {
            if (event.target.id !== 'default-model-select') return;
            const token = core.accountToken(); event.target.disabled = true;
            try { await core.saveDefaultModel(event.target.value || null); if (core.accountCurrent(token)) ui.byId('background-model-notice').textContent = '对话默认模型已保存'; }
            catch { if (core.accountCurrent(token)) ui.byId('background-model-notice').textContent = '保存失败，请刷新后重试。'; }
            finally { if (core.accountCurrent(token)) event.target.disabled = false; }
        });
        ui.byId('account-model-add').addEventListener('click', () => { openModelServiceEditor(); });
        ui.byId('account-model-cancel').addEventListener('click', () => ui.byId('account-model-dialog').close());
        document.addEventListener('click', event => { if (event.target.closest('#account-model-draft-test')) void queryModelServiceDraft(); });
        ui.byId('account-model-form').addEventListener('submit', event => { event.preventDefault(); void saveModelServiceDraft(); });
    }
    function modelDraft() {
        const draft = { baseUrl: ui.byId('account-model-base-url').value.trim(), modelId: ui.byId('account-model-id').value.trim() };
        const key = ui.byId('account-model-key').value;
        if (key) draft.apiKey = key;
        const model = core.state.accountModels.find(row => row.accountModelId === core.state.accountModelEditing?.id);
        if (model) draft.profileId = model.profileId;
        return draft;
    }
    function modelDraftCheckResult(result) {
        const target = ui.byId('account-model-draft-result'); target.replaceChildren();
        for (const [name, detail] of core.modelConnectionSteps(result)) { const row = ui.element('p'); row.append(ui.element('strong', '', name + '：'), document.createTextNode(detail)); target.append(row); }
        if (result.requiresTestMessage && !result.inferenceVerified && result.authentication !== 'rejected') {
            const send = ui.element('button', 'button secondary small', '发送测试消息'); send.type = 'button';
            send.addEventListener('click', () => { send.disabled = true; void core.checkModelDraft(modelDraft(), true); }); target.append(send);
        }
    }
    function accountModelFormNotice(message) { const status = ui.byId('account-model-form-status'); status.textContent = message; status.classList.toggle('form-error', /失败|无法|未完成|请输入|请填写|不明|冲突|已变化/.test(message)); }
    function accountModelFormBusy(busy) { ui.byId('account-model-submit').disabled = busy; }
    function resetAccountModelForm() { ui.byId('account-model-form').reset(); ui.byId('account-model-submit').textContent = '保存模型'; ui.byId('account-model-cancel').hidden = false; ui.byId('account-model-form-status').textContent = ''; ui.byId('account-model-draft-result').replaceChildren(); if (ui.byId('account-model-dialog').open) ui.byId('account-model-dialog').close(); }
    function projectDraftNotice(message) { ui.byId('project-register-status').textContent = message; }
    function projectDraftBusy(busy) { ui.byId('project-register-form').querySelector('button[type="submit"]').disabled = busy; }
    function resetProjectDraft() { ui.byId('project-name').value = ''; ui.byId('project-root').value = ''; }
    function browserDraftBusy(busy) { ui.byId('browser-workspace-form').querySelector('button[type="submit"]').disabled = busy; }
    function showBrowserNotice() { ui.byId('browser-workspace-status').hidden = false; }
    return { renderModelServices, openModelServiceEditor, modelDraftCheckResult, paintSystem, systemVisible, systemLoading, systemNotice, updateOtherDeviceInstall, resetOtherDeviceInstall, element, mountSettings, accountModelFormNotice, accountModelFormBusy, resetAccountModelForm, projectDraftNotice, projectDraftBusy, resetProjectDraft, browserDraftBusy, showBrowserNotice };
};
