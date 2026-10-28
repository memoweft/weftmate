/* Connector settings share the established rows, selects and confirmation. */
(() => {
  const node = (tag, cls = '', text = '') => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; };
  const button = (text, action, cls = 'secondary') => { const el = node('button', `button ${cls}`, text); el.type = 'button'; el.onclick = action; return el; };
  globalThis.WeftConnectorsView = (core, target, { desktop = false, toast = () => {} } = {}) => {
    if(target.connectorView?.identity===core.state.identityGeneration){target.connectorView.resume();return;}
    const identity = core.state.identityGeneration, generation = target.connectorGeneration = (target.connectorGeneration ?? 0) + 1;
    const current = () => target.isConnected && identity === core.state.identityGeneration && generation === target.connectorGeneration;
    let saved, selected, editor, timer, reads=0, catalogRead=0, browseTab='connectors', query='', filter='all', catalog, catalogError=false, modelsError=false, projects;
    const body = node('div','connectors-view'); target.replaceChildren(body);
    const browser=node('div','capabilities-browser'),tabs=node('div','capabilities-tabs'),toolbar=node('div','capabilities-toolbar'),groups=node('div','capabilities-groups');
    tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','能力类型');
    for(const [value,label]of [['connectors','连接器'],['skills','技能']]){
      const tab=button(label,()=>{browseTab=value;paintCatalog();});tab.className='capability-tab';tab.setAttribute('role','tab');tab.dataset.tab=value;tabs.append(tab);
      tab.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=[...tabs.children].find(item=>item!==tab);next.focus();next.click();};
    }
    const search=node('input','capabilities-search');search.type='search';search.placeholder='搜索连接器、模型与技能';search.setAttribute('aria-label','搜索能力');
    search.oninput=()=>{query=search.value.trim().toLocaleLowerCase();paintCatalog();};
    const statusFilter=node('select');statusFilter.setAttribute('aria-label','筛选能力');for(const [value,label]of [['all','全部'],['enabled','已启用'],['disabled','已停用'],['configured','已配置']])statusFilter.append(new Option(label,value));
    statusFilter.onchange=()=>{filter=statusFilter.value;paintCatalog();};
    toolbar.append(search,statusFilter);WeftSettingsControls.select(statusFilter);browser.append(tabs,toolbar,groups);
    const openSettings=id=>globalThis.WeftSettingsNavigation?.open(id);
    async function readCatalog(){
      const sessionId=core.state.selectedSessionId,read=++catalogRead;
      catalogError=false;
      if(!sessionId){catalog={items:[]};paintCatalog();return;}
      const scoped=()=>current()&&read===catalogRead&&sessionId===core.state.selectedSessionId;
      try{const value=await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/slash-commands`);if(scoped())catalog=value;}
      catch{if(scoped())catalogError=true;}
      if(current())paintCatalog();
    }
    async function readModels(){try{await core.refreshModelServices?.();modelsError=false;}catch{modelsError=true;}if(current())paintCatalog();}
    void readCatalog();void readModels();
    void core.readProjects?.().then(value=>{if(current()){projects=value.projects;paintCatalog();}}).catch(()=>{});
    async function load() {
      clearTimeout(timer);const read=++reads;
      body.replaceChildren(WeftControls.skeleton({rows:2}));
      try { const result = await core.readConnectors(); if (current()&&read===reads) { saved = {connectors:[],builtinConnectors:[],canManageConnectors:false,...result}; draw();watch(); } }
      catch { if(current()&&read===reads) body.replaceChildren(node('p','muted','暂时无法读取，请重试。'),button('重试',load)); }
    }
    function watch() {
      clearTimeout(timer);timer=setTimeout(async()=>{
        const ownerDialog=target.closest('dialog');
        if(!current()||ownerDialog&& !ownerDialog.open||!target.getClientRects().length)return;
        if(!editor?.open&&!document.querySelector('.wm-menu,.settings-select-menu:not([hidden])')){
          const read=++reads;try{const result=await core.readConnectors(),next={connectors:[],builtinConnectors:[],canManageConnectors:false,...result};if(current()&&read===reads&&JSON.stringify(next)!==JSON.stringify(saved)){saved=next;draw();}}catch{}
        }
        if(current())watch();
      },5000);
    }
    async function act(operation) { await core.changeConnector(operation); if(current()) await load(); }
    function draw() {
      if(selected){body.replaceChildren();return detail(selected);}
      if(body.firstChild!==browser)body.replaceChildren(browser);paintCatalog();
    }
    function paintCatalog(){
      if(!saved||selected)return;
      for(const tab of tabs.children){const active=tab.dataset.tab===browseTab;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
      groups.replaceChildren();
      const matches=item=>(!query||query.split(/\s+/).every(term=>`${item.name} ${item.description||''} ${item.state||''}`.toLocaleLowerCase().includes(term)))&&(filter==='all'||filter==='enabled'&&item.enabled===true||filter==='disabled'&&item.enabled===false||filter==='configured'&&item.configured===true);
      let count=0;
      function group(title,items){
        const shown=items.filter(matches);if(!shown.length)return;
        const section=node('section','capability-group'),list=node('div','capability-list');section.append(node('h2','settings-group-title',title),list);groups.append(section);
        for(const item of shown){count++;const row=node('article','capability-item'),copy=node('div','capability-copy');
          const open=button(item.name,item.open||(()=>{}),'quiet capability-open');open.disabled=!item.open;
          copy.append(open,node('p','muted',item.description||''),node('span','capability-state',item.state));
          row.append(WeftIcons.create(item.icon||'tool',22),copy);
          if(item.actions?.length){const more=button('',()=>WeftPopover.openMenu(more,item.actions),'quiet icon-button');more.setAttribute('aria-label',`${item.name}的更多操作`);more.setAttribute('aria-haspopup','menu');more.append(WeftIcons.create('more',18));row.append(more);}
          list.append(row);
        }
      }
      if(browseTab==='connectors'){
        group('已添加的连接器',saved.connectors.map(item=>({name:item.name,description:item.message||`${item.activeToolCount} / ${item.totalToolCount} 个工具可用`,state:item.enabled?'已添加 · 已启用':'已添加 · 已停用',enabled:item.enabled,configured:true,open:()=>{selected=item.id;draw();},actions:[{name:'查看工具与设置',action:()=>{selected=item.id;draw();}},{name:item.enabled?'停用连接器':'启用连接器',action:async()=>{try{await act({action:'toggle',id:item.id,enabled:!item.enabled});}catch{toast('开关未保存，请重试。');}}},...(desktop&&saved.canManageConnectors?[{name:'更新凭据',action:()=>credentialForm(item)},{name:'移除连接器',danger:true,action:()=>remove(item)}]:[])]})));
        group('模型服务',(core.state.modelServices||[]).map(item=>({name:item.name,description:`${item.models.filter(model=>model.enabled!==false).length} / ${item.models.length} 个模型 · ${item.catalog?.message||'尚未查询'}`,state:'已配置',configured:true,enabled:item.models.some(model=>model.enabled!==false),icon:'model',open:()=>openSettings('models'),actions:[{name:'管理模型服务',action:()=>openSettings('models')}]})));
        const serviceProfiles=new Set((core.state.modelServices||[]).flatMap(service=>service.models.flatMap(model=>[model.profileId,...(model.profileIds||[])])));
        group('电脑上的模型',(core.state.models||[]).filter(model=>!serviceProfiles.has(model.id)).map(model=>({name:model.name||model.model,description:model.model,state:model.configured?'已配置':'尚未配置',configured:model.configured===true,enabled:model.configured===true,icon:'model',open:()=>openSettings('models'),actions:[{name:'管理模型设置',action:()=>openSettings('models')}]})));
        if(modelsError)groups.append(node('p','muted','模型服务暂时无法读取。'),button('重试模型服务',readModels));
        group('资料访问',[{name:'项目与网页资料',description:projects?`已登记 ${projects.length} 个项目；查看目录与网页资料访问设置。`:'管理电脑上的项目与网页资料。',state:projects?'已读取':'按需读取',configured:!!projects?.length,icon:'folder',open:()=>openSettings('resources'),actions:[{name:'管理资料访问',action:()=>openSettings('resources')}]}]);
        if(desktop&&saved.canManageConnectors){
          group('可配置的连接器',saved.builtinConnectors.filter(item=>!saved.connectors.some(connector=>connector.builtinId===item.id)).map(item=>({name:item.name,description:item.description,state:'未配置',configured:false,icon:'tool',open:()=>addBuiltin(item),actions:[{name:'配置连接器',action:()=>addBuiltin(item)}]})));
          groups.append(button('添加自定义连接器',()=>form(),'secondary small'));
        }
      }else{
        const connectorNames=new Set(saved.connectors.flatMap(connector=>connector.tools.map(tool=>tool.name)));
        group('DSH 工具',(catalog?.tools||[]).filter(tool=>!connectorNames.has(tool.name)).map(tool=>({name:tool.name,description:tool.description,state:'当前对话可用',enabled:true,configured:true,open:()=>skillDetail({...tool,kind:'tool'}),actions:[{name:'查看工具说明',action:()=>skillDetail({...tool,kind:'tool'})}]})));
        group('DSH 技能',(catalog?.items||[]).filter(item=>item.kind==='skill').map(item=>({name:item.name,description:item.description,state:'已安装 · 当前对话可用',enabled:true,configured:true,icon:'folder',open:()=>skillDetail(item),actions:[{name:'查看技能说明',action:()=>skillDetail(item)}]})));
        group('DSH 命令',(catalog?.items||[]).filter(item=>item.kind==='command').map(item=>({name:`/${item.name}`,description:item.description,state:'当前对话可用',enabled:true,configured:true,open:()=>skillDetail(item),actions:[{name:'查看命令说明',action:()=>skillDetail(item)}]})));
        group('连接器工具',saved.connectors.flatMap(connector=>connector.tools.map(tool=>({name:tool.displayName||tool.rawName,description:tool.description,state:`${connector.name} · ${!connector.enabled?'已停用':tool.rule==='deny'?'已禁止':tool.rule==='ask'?'使用前询问':'已启用'}`,enabled:connector.enabled&&tool.rule!=='deny',configured:true,open:()=>{selected=connector.id;draw();},actions:[{name:'查看工具规则',action:()=>{selected=connector.id;draw();}}]}))));
        if(catalogError)groups.append(node('p','muted','当前对话的技能暂时无法读取。'),button('重试技能',readCatalog));
        else if(!core.state.selectedSessionId)groups.append(node('p','muted','打开一段电脑对话后，这里会列出该对话实际可用的 DSH 技能与命令。'));
      }
      if(!count)groups.prepend(node('p','capability-empty muted',query||filter!=='all'?'没有匹配的能力，试试其他名称或筛选条件。':'这里还没有可用项目。'));
    }
    async function addBuiltin(item){if(item.fields.length)return form(item);try{await act({action:'add',builtinId:item.id});toast('连接器已添加');}catch{toast('添加未完成，请重试。');}}
    function skillDetail(item){const view=dialog(item.name);view.content.append(node('p','',item.description||'此项由 DSH 在当前对话中提供。'),node('p','muted',item.kind==='tool'?'助手会按你的请求使用此工具，并遵循当前权限设置。':item.kind==='skill'?'在对话输入 / 后选择这个技能即可使用。':'在对话输入完整命令后发送即可使用。'));view.actions.append(button('关闭',()=>editor.close()));view.form.onsubmit=event=>event.preventDefault();}
    function detail(id) {
      const item=saved.connectors.find(row=>row.id===id);if(!item){selected=null;return draw();}
      body.append(button('返回连接器',()=>{selected=null;draw();}),node('h2','',item.name));if(item.message)body.append(node('p','connector-problem',item.message));
      body.append(node('p','muted',`默认提供前 ${item.activeToolCount} 个工具，共 ${item.totalToolCount} 个。多出的工具不会占用聊天上下文。`));
      if(desktop&&saved.canManageConnectors){const actions=node('div','actions');actions.append(button('测试连接',async()=>{try{const result=await core.changeConnector({action:'test',id});if(current())body.prepend(node('p',result.connectionTest.ok?'muted':'connector-problem',result.connectionTest.ok?'连接成功，已读取工具。':result.connectionTest.message));}catch{toast('测试未完成，请重试。');}}));
        const more=button('更多',()=>WeftPopover.openMenu(more,[{name:'更新凭据',action:()=>credentialForm(item)},{name:'移除连接器',danger:true,action:()=>remove(item)}]));more.setAttribute('aria-label','连接器更多操作');actions.append(more);body.append(actions);}
      for(const credential of item.credentials)body.append(WeftSettingsControls.row(credential.label||credential.name,'已安全保存',node('span','settings-value',credential.last4?`已保存 · ${credential.last4}`:'已保存')));
      for(const tool of item.tools){const label=tool.displayName||tool.rawName,select=node('select');select.setAttribute('aria-label',`${label}的规则`);for(const [value,text]of [['',({allow:'总是允许',ask:'每次问',deny:'禁止'}[tool.defaultRule??tool.rule??(tool.category==='read'?'allow':'ask')])+'（默认）'],['allow','总是允许'],['ask','每次问'],['deny','禁止']]){const option=node('option','',text);option.value=value;select.append(option);}
        select.value=saved.rules?.[tool.name]??'';select.disabled=!desktop||!saved.canManageConnectors;body.append(WeftSettingsControls.row(label,tool.description,select));WeftSettingsControls.select(select);
        select.onchange=async()=>{select.disabled=true;try{const next=await core.savePermissionRules({[tool.name]:select.value||null});if(current()){saved.rules=next.rules;toast('已保存');}}catch{if(current()){select.value=saved.rules?.[tool.name]??'';toast('规则未保存，已恢复原来的选择。请重试。');}}finally{if(current()){select.disabled=false;select.dispatchEvent(new Event('weft:sync'));}}};}
    }
    async function remove(item){if(await WeftDialogs.request({title:'移除连接器？',message:`移除“${item.name}”，同时删除它的凭据和工具规则。`,confirmLabel:'移除',danger:true})){try{selected=null;await act({action:'remove',id:item.id});toast('连接器已移除');}catch{toast('移除未完成，请重试。');}}}
    function dialog(title){editor?.remove();editor=node('dialog','dialog model-editor-dialog connector-editor');editor.setAttribute('aria-label',title);const head=node('div','dialog-head');head.append(node('h2','',title),button('关闭',()=>editor.close()));const form=node('form','model-editor-form'),content=node('div','model-editor-body'),actions=node('div','dialog-footer');form.append(content,actions);editor.append(head,form);document.body.append(editor);editor.onclose=()=>{for(const input of editor.querySelectorAll('input[type=password]'))input.value='';editor.remove();};editor.showModal();return {form,content,actions};}
    function field(target,label,type='text'){const wrap=node('label','connector-field',label),input=node(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.setAttribute('aria-label',label);wrap.append(input);target.append(wrap);return input;}
    function credentialInputs(content,existing=[]){const container=node('div','connector-credentials');content.append(container);const rows=[];function add(name=''){const line=node('div','connector-credential'),slot=field(line,'凭据名称'),value=field(line,'凭据值','password');slot.value=name;value.autocomplete='new-password';const row={slot,value};rows.push(row);line.append(button('删除这项',()=>{line.remove();rows.splice(rows.indexOf(row),1);},'secondary small'));container.append(line);}for(const name of existing)add(name);content.append(button('添加凭据',()=>add(),'secondary small'));return ()=>Object.fromEntries([...existing.filter(name=>!rows.some(row=>row.slot.value.trim()===name)).map(name=>[name,null]),...rows.filter(row=>row.value.value).map(row=>[row.slot.value.trim(),row.value.value])]);}
    function credentialForm(item){const view=dialog(item.builtinId==='calendar-ics'?'更新订阅地址':item.builtinId?'更新授权码':'更新凭据');view.content.append(node('p','muted','已有内容不会显示；填写新的值以替换。'));let credentials;
      if(item.builtinId){const inputs=item.credentials.map(row=>({name:row.name,input:field(view.content,row.label||'授权码','password')}));for(const row of inputs)row.input.autocomplete='new-password';credentials=()=>Object.fromEntries(inputs.filter(row=>row.input.value).map(row=>[row.name,row.input.value]));}
      else credentials=credentialInputs(view.content,item.credentials.map(row=>row.name));
      view.actions.append(button('取消',()=>editor.close()),button('保存',async()=>{try{await core.changeConnector({action:'rotate',id:item.id,credentials:credentials()});editor.close();await load();toast('已保存');}catch{toast('保存未完成，请重试。');}},'primary'));}
    function form(builtin){const view=dialog(builtin?`添加${builtin.name}`:'添加自定义连接器');let name,kind,command,args,url,credentials=()=>({});const fields={};
      if(builtin){
        view.content.append(node('p','muted',builtin.description));
        const wrappers={},help=node('div','connector-provider-help');
        for(const def of builtin.fields){
          const wrap=node('label','connector-field',def.label);wrappers[def.name]=wrap;
          let input;
          if(def.options){input=node('select');for(const choice of def.options){const option=node('option','',choice.label);option.value=choice.value;input.append(option);}}
          else {input=node('input');input.type=def.secret?'password':def.type==='number'?'text':def.type||'text';if(def.type==='number')input.inputMode='numeric';if(def.secret)input.autocomplete='new-password';}
          input.setAttribute('aria-label',def.label);input.value=def.default||'';wrap.append(input);view.content.append(wrap);fields[def.name]=input;
          if(def.options)WeftSettingsControls.select(input);
          if(def.hidden)wrap.hidden=true;
        }
        view.content.append(help);
        const updateFields=()=>{
          for(const def of builtin.fields)if(def.visibleWhen)wrappers[def.name].hidden=!def.visibleWhen.values.includes(fields[def.visibleWhen.field]?.value);
          help.replaceChildren();for(const def of builtin.fields){const choice=def.options?.find(option=>option.value===fields[def.name].value);if(!choice?.help)continue;help.append(node('p','muted',choice.help));if(choice.helpUrl){const link=node('a','button secondary small','查看官方说明');link.href=choice.helpUrl;link.target='_blank';link.rel='noopener noreferrer';help.append(link);}}
        };
        for(const def of builtin.fields)if(def.options)fields[def.name].addEventListener('change',updateFields);updateFields();
      }
      else{view.content.append(node('p','muted','自定义连接器会在本机运行别人编写的程序，请只添加你信任的来源。'));name=field(view.content,'名称');const wrap=node('label','connector-field','连接方式');kind=node('select');kind.setAttribute('aria-label','连接方式');for(const [value,text]of [['stdio','启动程序'],['streamable-http','连接地址']]){const option=node('option','',text);option.value=value;kind.append(option);}wrap.append(kind);view.content.append(wrap);const local=node('div'),remote=node('div');view.content.append(local,remote);command=field(local,'启动命令');args=field(local,'参数（每行一个）','textarea');url=field(remote,'地址','url');remote.hidden=true;kind.onchange=()=>{local.hidden=kind.value!=='stdio';remote.hidden=kind.value==='stdio';};WeftSettingsControls.select(kind);view.content.append(node('p','muted','凭据按名称传给程序；连接地址时作为请求头发送。不要把密钥填进命令、参数或地址。'));credentials=credentialInputs(view.content);}
      const notice=node('div','connector-test-result');notice.setAttribute('aria-live','polite');view.content.append(notice);let tested=null;
      const draft=()=>builtin?{builtinId:builtin.id,fields:Object.fromEntries(Object.entries(fields).filter(([key])=>!builtin.fields.find(row=>row.name===key).secret).map(([key,input])=>[key,input.value])),credentials:Object.fromEntries(Object.entries(fields).filter(([key])=>builtin.fields.find(row=>row.name===key).secret).map(([key,input])=>[key,input.value]))}:{name:name.value,transport:kind.value,command:command.value,args:args.value.split('\n').filter(Boolean),url:url.value,credentials:credentials()};
      const test=button('测试连接',async()=>{test.disabled=true;save.disabled=true;notice.textContent='正在测试连接…';try{const input=draft(),result=await core.changeConnector({action:'test',...input});if(!current())return;notice.replaceChildren(node('p',result.connectionTest.ok?'':'connector-problem',result.connectionTest.ok?'连接成功':result.connectionTest.message));if(builtin&&result.connectionTest.ok)notice.append(node('p','muted',builtin.id==='mail'?'收件和发件都可以使用；需要发信或整理时会先问你。':'日历已可以读取；添加后可以查看可用操作。'));else for(const tool of result.connectionTest.tools)notice.append(node('p','muted',`${tool.displayName||tool.rawName} · ${tool.description}`));tested=result.connectionTest.ok?JSON.stringify(input):null;save.disabled=!tested;notice.scrollIntoView({block:'nearest'});}catch{notice.textContent='连接未成功，请检查填写内容后重试。';}finally{test.disabled=false;}});
      const save=button('添加',async()=>{if(tested!==JSON.stringify(draft())){notice.textContent='填写内容已变化，请先测试连接。';save.disabled=true;return;}save.disabled=true;try{await core.changeConnector({action:'add',...draft()});editor.close();await load();toast('连接器已添加');}catch{notice.textContent='添加未完成，请重新测试连接。';test.disabled=false;}},'primary');save.disabled=true;view.actions.append(button('取消',()=>editor.close()),test,save);view.form.onsubmit=event=>event.preventDefault();view.form.addEventListener('input',()=>{save.disabled=true;tested=null;});}
    target.connectorView={identity,resume:()=>{if(saved){watch();void readModels();void readCatalog();}else void load();}};
    void load();
  };
})();
