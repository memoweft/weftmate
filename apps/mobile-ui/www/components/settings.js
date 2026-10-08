/* Mobile settings presentation and named ui-core actions. */
async function openModels(){
  closeApprovalModeMenu();
  if(state.busy)return;
  if(state.menu){closeModelMenu();return}
  closeAttachmentMenu();
  state.menu=true;state.directoryError=false;$('model-popover').hidden=false;$('model-button').setAttribute('aria-expanded','true');
  placeModelMenu();
  const list=$('model-options');clear(list);list.append(el('p','muted','正在读取已保存模型…'));
  try{const result=await call('models.list');if(!state.menu)return;state.models=result.models||[];renderModels();
    if(result.selected?.source==='phone'){try{const found=await call('models.discover');if(!state.menu)return;
      const ids=new Set(state.models.map(v=>`${v.endpoint}|${v.modelId}`));for(const item of found.models||[]){const key=`${result.selected.endpoint}|${item.id}`;
        if(!ids.has(key)){state.models.push({source:'phone',endpoint:result.selected.endpoint,modelId:item.id,displayName:item.displayName,selected:false,discovered:true});ids.add(key)}
        else{const saved=state.models.find(v=>`${v.endpoint}|${v.modelId}`===key);saved.displayName=item.displayName||saved.displayName;saved.discovered=true}}
      renderModels();}catch{if(state.menu){state.directoryError=true;renderModels()}}}
    if(state.loggedIn){try{const host=await call('models.host');if(!state.menu)return;
      state.models.push(...(host.models||[]).filter(item=>item.configured));renderModels()}
      catch{if(state.menu)list.append(el('p','muted','电脑模型暂不可用'))}}
  }catch(e){list.replaceChildren(el('p','muted',safeError(e)))}
}

function renderModels(){const list=$('model-options');clear(list);if(!state.models.length)list.append(el('p','muted','先在设置中配置一个手机模型'));
  for(const item of state.models){const button=el('button',item.selected?'selected':'');const title=el('span','',item.displayName||item.modelId||item.profileId);
    const left=el('span','model-option-main');left.append(title);
    const subtitle=item.source==='host'?`电脑 · ${item.sourceKind==='local'?'本机模型':'云模型'}`:
      (item.displayName&&item.displayName!==item.modelId?item.modelId:'');
    if(subtitle)left.append(el('small','',subtitle));button.append(left);
    if(item.selected)button.append(el('span','icon icon-check'));
    button.setAttribute('aria-label',`${item.displayName||item.modelId||item.profileId}${item.selected?'，已选择':''}`);
    button.addEventListener('click',async()=>{closeModelMenu();state.modelSwitching=true;updateComposer();
      status(item.source==='host'?'正在核对电脑模型…':'正在保存模型选择…');
      try{const method=item.source==='host'?'models.selectHost':item.discovered?'models.chooseDiscovered':'models.select';
      const selected=await call(method,item.source==='host'?{profileId:item.profileId}:item.discovered?{modelId:item.modelId}:{endpoint:item.endpoint,modelId:item.modelId});
      state.model=selected;$('model-label').textContent=selected.displayName||selected.modelId;status(`已选择 ${selected.displayName||selected.modelId}`)}
      catch(e){status(safeError(e),true)}finally{state.modelSwitching=false;updateComposer()}});
    list.append(button)}
  if(state.directoryError){const note=el('button','hint','当前目录暂不可用 · 点此重试');note.addEventListener('click',()=>{closeModelMenu();openModels()});list.append(note)}
  const manage=el('button','hint','管理手机与账户模型');manage.addEventListener('click',()=>{
    closeModelMenu();page('models')});list.append(manage)
}

function subNotice(title,text){const target=$('page-content');clear(target);target.append(heading(title),notice(text,'尚未接入'))}

function connectionLabel(){return {connected:'电脑连接正常',checking:'已保存登录，待核对',offline:'电脑暂不可达，可离线使用',
  expired:'登录已失效，请重新登录',local:'未登录'}[state.connection]||'连接状态待确认'}

function settingsPage(target){target.append(heading('设置'),group('个人空间',[
  row('我的资料',state.loggedIn?`${state.username} · ${connectionLabel()}`:'未登录',()=>page('account')),
  row('电脑账户与连接',state.loggedIn?connectionLabel():'可以登录或注册',()=>page('connect')),
  row('设备',state.loggedIn?'查看或移除已登录设备':'登录后可管理设备',()=>page('devices'))]),
  group('使用偏好',[row('用量','本月费用、用量与月度上限',()=>page('usage')),row('对话模型',state.model?.displayName||'尚未配置手机模型',()=>page('models')),
    row('外观','跟随系统、浅色或深色',()=>page('appearance')),
    row('通知','回复、动作和同步状态',()=>page('notifications')),
    row('离线与同步',state.loggedIn?'当前账户的记录与状态':'登录后查看本机与同步状态',()=>page('sync'))]),
  group('应用',[row('界面更新',state.ui?.activeVersion||'内置页面',()=>page('updates')),
    row('原生兼容界面','仅供排查当前系统网页组件',()=>call('compat.openNative').catch(e=>toast(safeError(e),true)))]));
  void systemStatusSection(target);
  const section=el('section','group');section.append(el('h2','','审批'));
  const button=el('button','secondary','设置默认审批模式');button.type='button';button.disabled=!state.loggedIn;
  button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-controls','approval-mode-popover');
  button.addEventListener('click',()=>{void openApprovalModes(true,button)});
  section.append(el('p','hint','用于新电脑对话，已有对话可在输入区单独设置。'),button);target.append(section);
}

async function systemStatusSection(target){const owner=state.owner,epoch=state.authEpoch;
  const section=el('section','group');section.append(el('h2','','系统状态'));
  const status=el('p','hint','正在读取…');section.append(status);target.append(section);
  const current=()=>state.owner===owner&&state.authEpoch===epoch&&target.isConnected&&state.page==='settings';
  try{const [system,settings]=await Promise.all([
    uiCore.readMobileSystem(),
    uiCore.readMobileModelSettings()]);
    if(!current())return;
    const labels={ready:'运行中',connected:'运行中',stopped:'已停止',starting:'启动中',disabled:'未启用',
      unavailable:'不可用',unconfigured:'尚未配置',degraded:'需要处理'};
    status.textContent=system.queue?.backgroundPending?`${system.queue.backgroundPending} 项后台请求排队中`:'已更新';
    for(const [key,name] of [['model','模型服务'],['host','宿主'],['memory','记忆']]){const value=system[key];
      const detail=[labels[value.state]||'状态未知',value.currentModelId?`当前模型 ${value.currentModelId}`:'',
        value.version?`版本 ${value.version}`:['disabled','unconfigured','stopped'].includes(value.state)?'':'版本未知',
        value.contextWindow?`上下文 ${value.contextWindow.toLocaleString()}`:'',
        value.slots?`槽数 ${value.slots}`:'',
        value.lastSwitch?.at?`最近切换 ${new Date(value.lastSwitch.at).toLocaleString()}${value.lastSwitch.ok?'':'（未成功）'}`:'',
        value.lastError?`最近错误：${value.lastError}`:''].filter(Boolean).join(' · ');
      const item=el('div','row'),text=el('span');text.append(el('strong','',name),el('small','',detail));item.append(text);section.append(item);
      const button=el('button','secondary',`重启${name}`);button.disabled=!system.canRestart||!value.canRestart;
      button.addEventListener('click',async()=>{button.disabled=true;button.textContent='重启中…';
        try{await uiCore.restartService(key);
          if(current())page('settings')
        }catch(e){if(current()){status.textContent='重启未确认，请刷新查看实际状态。';button.disabled=false;button.textContent=`重启${name}`}}});
      section.append(button)
    }
    const background=el('p','hint',settings.backgroundModelProfileId?'后台模型已单独配置 · 在电脑设置中修改':'后台模型跟随主模型 · 在电脑设置中修改');section.append(background);
    const refresh=el('button','secondary','刷新状态');refresh.addEventListener('click',()=>page('settings'));section.append(refresh);
  }catch(e){if(current())status.textContent=state.loggedIn?'系统状态暂时无法读取，请重新连接电脑后刷新。':'登录并连接电脑后查看系统状态。'}
}

function capabilitiesPage(target){target.append(heading('能力与扩展','手机能执行的动作与电脑已有组件清楚分开。'),
  group('这台手机',[row('打开应用','选择系统列出的可启动应用',()=>state.loggedIn?phoneAction('apps'):page('connect')),
    row('打开系统设置','向 Android 请求打开设置，结果保留在原对话',()=>state.loggedIn?phoneAction('settings'):page('connect'))]));
  const section=group('电脑组件',[]);const body=section.querySelector('.group-body');body.append(el('p','muted','正在读取连接状态…'));target.append(section);
  if(!state.loggedIn){body.textContent='连接个人账户后可查看电脑组件状态。';return}
  const gen=state.generation;call('host.modules').then(modules=>{if(state.page!=='capabilities'||state.generation!==gen)return;clear(body);
    for(const [key,title,description] of [['mods','Mod 与能力','发现、配置和复用业务能力'],
      ['capabilities','设备执行','跨端动作与可用能力'],['memory','记忆','查看理解与来源'],
      ['workspaces','项目与成果','电脑文件与任务结果']]){
      const status=moduleLabel(modules[key]);body.append(row(title,`${description} · ${status}`,()=>capabilityDetail(key,title,status)))}
  }).catch(()=>{body.textContent='电脑暂时不可达；手机动作仍可使用。'});
}

function moduleLabel(value){return {connected:'已连接',disabled:'未启用',unknown:'状态待确认'}[value]||'状态待确认'}

function capabilityDetail(key,title,status){const target=$('page-content');clear(target);target.append(heading(title));
  target.append(notice(status==='已连接'?'电脑组件已连接，手机操作入口与业务数据仍按实际服务逐项开放。':
    status==='未启用'?'此组件尚未启用；不会在手机上显示虚构操作。':'当前还无法确认服务状态。',status));
  if(key==='memory')target.append(action('查看记忆页面',()=>page('memory'),false));
  if(key==='workspaces')target.append(action('查看项目与成果',()=>page('workspaces'),false));
  if(key==='mods')target.append(group('目录与详情',[row('已安装能力','接通 Mod 目录后在这里查看版本、设置和权限',()=>subNotice('Mod 目录','当前没有可展示的已安装列表'))]));
}

function projectIntentKey(...args){return uiCore.mobileSettings.projectIntentKey(...args)}

function savedProjectIntent(...args){return uiCore.mobileSettings.savedProjectIntent(...args)}

function projectIntentCurrent(...args){return uiCore.mobileSettings.projectIntentCurrent(...args)}

function browserIntentKey(...args){return uiCore.mobileSettings.browserIntentKey(...args)}

function savedBrowserIntent(...args){return uiCore.mobileSettings.savedBrowserIntent(...args)}

function resolveBrowserIntent(intent,message){const id=registerWorkspaceNotice(message);return uiCore.mobileSettings.resolveBrowserIntent(intent,id)}

function resolveProjectSessionIntent(intent,message){const id=registerWorkspaceNotice(message);return uiCore.mobileSettings.resolveProjectSessionIntent(intent,id)}

function workspacesPage(target){target.append(heading('项目与成果'));
  if(!state.loggedIn){target.append(notice('请先连接自己的电脑账户。项目目录只能由原电脑账户登记。'),
    action('连接账户',()=>page('connect')));return}
  const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
  const current=()=>projectIntentCurrent(owner,epoch,generation);
  const statusNode=el('p','workspace-status','正在读取账户项目与电脑模型…');target.append(statusNode);
  const projectGroup=group('已登记项目',[]),projectBody=projectGroup.querySelector('.group-body');
  const modelGroup=group('使用的模型',[]),modelBody=modelGroup.querySelector('.group-body');
  const browserGroup=group('网页资料',[]),browserBody=browserGroup.querySelector('.group-body');
  target.append(browserGroup,projectGroup,modelGroup);
  void Promise.allSettled([call('shared.projects.list'),call('models.host'),
    uiCore.readBrowserWorkspace()])
    .then(([projectResult,modelResult,browserResult])=>{
    if(!current())return;
    const candidate=projectResult.status==='fulfilled'?projectResult.value:null;
    const listed=candidate?.source==='host'&&hostIdPattern.test(candidate.hostId||'')&&
      Array.isArray(candidate.projects)?candidate:null;
    const catalog=modelResult.status==='fulfilled'?modelResult.value:null;
    const browser=browserResult.status==='fulfilled'?browserResult.value:null;
    const browserError=browserResult.status==='rejected'?browserResult.reason:null;
    clear(projectBody);clear(modelBody);clear(browserBody);
    const projects=listed?listed.projects.filter(item=>projectIdPattern.test(item?.projectId||'')&&
      typeof item.name==='string'):[],models=(Array.isArray(catalog?.models)?catalog.models:[]).filter(item=>item?.configured===true&&
      profileIdPattern.test(item.profileId||'')&&typeof item.displayName==='string');
    const intent=listed?savedProjectIntent(listed.hostId):null;
    let selectedProject=projects.find(item=>item.projectId===intent?.projectId&&!item.revoked)||
      projects.find(item=>!item.revoked)||null;
    let selectedModel=models.find(item=>item.profileId===intent?.modelProfileId)||models[0]||null;
    if(!listed)projectBody.append(notice(projectResult.status==='rejected'&&projectResult.reason?.message==='NOT_FOUND'?
      '当前电脑服务还没有项目目录入口；网页资料仍可单独使用。':'项目列表暂时无法核对；网页资料仍可单独使用。'));
    else if(!projects.length){projectBody.append(notice('此账户还没有登记项目。请先在电脑账户页的“项目与成果”选择资料目录。'))}
    else for(const item of projects){const button=row(item.name,
      item.revoked?'已撤销 · 历史成果仍可查看':'电脑登记',()=>{
        if(item.revoked)return;selectedProject=item;renderSelection()});button.disabled=item.revoked;
      button.dataset.projectId=item.projectId;projectBody.append(button)}
    modelGroup.hidden=!listed||!selectedProject;
    const select=el('select','workspace-model-select');select.setAttribute('aria-label','项目资料使用的电脑模型');
    if(!models.length){select.append(el('option','','电脑没有已配置模型'));select.disabled=true;
      modelBody.append(notice('请先在电脑设置中配置模型；项目目录登记不会自动选择资料目的地。'))}
    else {for(const item of models){const option=el('option','',`${item.displayName} · ${item.sourceKind==='local'?'电脑本机':'电脑云端'}`);
        option.value=item.profileId;select.append(option)}
      select.value=selectedModel.profileId;select.addEventListener('change',()=>{
        selectedModel=models.find(item=>item.profileId===select.value)||null;renderSelection()});modelBody.append(select)}
    const disclosure=el('p','workspace-disclosure'),send=action('在此项目开始对话',async()=>{
      if(!current()||!selectedProject||!selectedModel)return;
      statusNode.hidden=false;
      const prior=savedProjectIntent(listed.hostId);
      if(prior&&(prior.projectId!==selectedProject.projectId||prior.modelProfileId!==selectedModel.profileId)){
        statusNode.textContent='上一次项目会话仍待核对。请先恢复原选择，避免重复创建。';return}
      const next=prior||{owner,hostId:listed.hostId,projectId:selectedProject.projectId,
        modelProfileId:selectedModel.profileId,requestId:crypto.randomUUID()};
      try{const verified=await call('models.verifyHost',{profileId:next.modelProfileId});
        if(!current())return;
        if(verified?.available!==true){statusNode.textContent='所选电脑模型当前不可用。请选择其他已配置模型或稍后重试。';return}}
      catch{if(current())statusNode.textContent='暂时无法核对所选模型，请检查电脑连接后重试。';return}
      try{localStorage.setItem(projectIntentKey(listed.hostId),JSON.stringify(next))}
      catch{statusNode.textContent='无法安全保存请求编号，暂不能创建会话。';return}
      send.disabled=true;
      try{await resolveProjectSessionIntent(next,statusNode)}finally{if(current())send.disabled=false}
    });
    modelBody.append(disclosure,send);
    function renderSelection(){for(const button of projectBody.querySelectorAll('[data-project-id]')){
        button.classList.toggle('is-selected',button.dataset.projectId===selectedProject?.projectId)}
      disclosure.textContent=selectedProject&&selectedModel?`“${selectedProject.name}”中实际读取的资料将交给${
        selectedModel.sourceKind==='local'?'电脑本机':'电脑云端'}模型“${selectedModel.displayName}”。仅当前项目的已读正文进入该会话。`:
        '选择一个未撤销项目和已配置模型后，才能开始项目对话。';
      send.disabled=!selectedProject||!selectedModel}
    renderSelection();
    if(browser?.available!==true||!hostIdPattern.test(browser?.hostId||'')||
      browser.workspaceKind!=='browser'||listed&&browser.hostId!==listed.hostId){
      const missing=browserError?.message==='NOT_FOUND'||browserError?.status===404;
      browserBody.append(notice(missing?'当前电脑服务还没有网页资料入口；已有项目和聊天仍可使用。':
        browserError?'网页阅读暂时无法连接，请稍后刷新；原请求会保留。':
          '网页阅读目前不可用，请检查电脑连接与账户权限。'))}
    else{const priorBrowser=savedBrowserIntent(browser.hostId);
      const urlBox=el('label','field'),urlInput=el('textarea');urlInput.rows=3;
      urlInput.value=priorBrowser?.urls.join('\n')||'';
      urlInput.placeholder='https://example.org/article';
      urlBox.append(el('span','','公共网页链接（每行一个，1–5条）'),urlInput);
      const goalBox=el('label','field'),goalInput=el('textarea');goalInput.rows=3;
      goalInput.maxLength=6000;goalInput.value=priorBrowser?.goal||'';
      goalInput.placeholder='例如：比较两篇文章的主要观点并保存摘要';
      goalBox.append(el('span','','希望整理什么'),goalInput);
      const browserModel=el('select','workspace-model-select');browserModel.setAttribute('aria-label','网页资料使用的电脑模型');
      for(const item of models){const option=el('option','',`${item.displayName} · ${item.sourceKind==='local'?'电脑本机':'电脑云端'}`);
        option.value=item.profileId;browserModel.append(option)}
      browserModel.value=models.some(item=>item.profileId===priorBrowser?.modelProfileId)?priorBrowser.modelProfileId:
        models[0]?.profileId||'';
      browserModel.disabled=!models.length;
      const disclosureWeb=el('p','workspace-disclosure'),webStatus=el('p','workspace-status',
        priorBrowser?'发现上次未确认的网页任务，正在按原编号核对。':'');
      webStatus.hidden=!webStatus.textContent;
      const start=action('开始网页任务',async()=>{
        if(!current())return;
        webStatus.hidden=false;
        const profile=models.find(item=>item.profileId===browserModel.value);
        const goal=goalInput.value.trim(),urls=urlInput.value.split(/\r?\n/u).map(value=>value.trim()).filter(Boolean);
        if(!profile||!goal||goal.length>6000||/https?:\/\//iu.test(goal)||urls.length<1||urls.length>5){
          webStatus.textContent='请填写目标和1–5条单独列出的公共链接；目标文字中不要重复贴链接。';return}
        if(urls.some(value=>{try{const parsed=new URL(value);return !['http:','https:'].includes(parsed.protocol)||
            parsed.username||parsed.password||new TextEncoder().encode(value).length>2048}
          catch{return true}})){
          webStatus.textContent='链接须是完整的公共 HTTP/HTTPS 地址，且不能包含账号密码。';return}
        const composed=`${goal}\n\n网页链接：\n${urls.join('\n')}`;
        if(new TextEncoder().encode(composed).length>8192){webStatus.textContent='目标与链接合计过长，请缩短后重试。';return}
        const previous=savedBrowserIntent(browser.hostId);
        if(previous&&(previous.modelProfileId!==profile.profileId||previous.goal!==goal||
            JSON.stringify(previous.urls)!==JSON.stringify(urls))){
          webStatus.textContent='上一项网页任务仍待核对，请先按原选择恢复，避免重复派发。';return}
        const intent=previous||{owner,hostId:browser.hostId,modelProfileId:profile.profileId,goal,urls,
          sessionRequestId:crypto.randomUUID(),messageRequestId:crypto.randomUUID()};
        try{const check=await call('models.verifyHost',{profileId:intent.modelProfileId});if(!current())return;
          if(check?.available!==true){webStatus.textContent='所选电脑模型当前不可用，请核对后再试。';return}}
        catch{if(current())webStatus.textContent='暂时无法核对所选模型；请检查连接后重试。';return}
        try{localStorage.setItem(browserIntentKey(browser.hostId),JSON.stringify(intent))}
        catch{webStatus.textContent='无法安全保存任务编号，暂不能发送。';return}
        start.disabled=true;
        try{await resolveBrowserIntent(intent,webStatus)}finally{if(current())start.disabled=false}
      });
      const updateWebDisclosure=()=>{const selected=models.find(item=>item.profileId===browserModel.value);
        disclosureWeb.textContent=selected?`实际读取的公共网页正文将交给${
          selected.sourceKind==='local'?'电脑本机':'电脑云端'}模型“${selected.displayName}”。链接会由电脑逐一核对。`:
          '请先在电脑配置可用模型，再发起网页任务。';start.disabled=!selected};
      browserModel.addEventListener('change',updateWebDisclosure);
      browserBody.append(urlBox,goalBox,browserModel,disclosureWeb,start,webStatus);
      updateWebDisclosure();
      if(priorBrowser)void resolveBrowserIntent(priorBrowser,webStatus)
    }
    statusNode.textContent=!listed?projectResult.status==='rejected'&&projectResult.reason?.message==='NOT_FOUND'?
      '项目目录入口尚未接入；网页资料可独立使用。':'项目列表暂时无法读取；网页资料可独立使用。':
      intent?'发现上次未完成的会话请求，正在用原编号核对。':
        projects.length>0&&!selectedProject?'项目均已撤销；请在电脑重新登记。':'';
    statusNode.hidden=!statusNode.textContent;
    if(intent)void resolveProjectSessionIntent(intent,statusNode)
  }).catch(error=>{if(!current())return;statusNode.textContent=['NOT_FOUND','OPERATION_FAILED'].includes(error?.message)?
    '当前电脑服务还没有项目目录入口，原有聊天和历史仍可使用。':'电脑暂时不可达；原项目会话请求会保留，重连后继续核对。';
    clear(projectBody);clear(modelBody)})
}

function connectPage(target){globalThis.WeftCloudMobile?.mount(target,{call,loggedIn:state.loggedIn});target.append(heading('电脑账户与连接','手机离线时仍可使用本机对话；连接后可同步记录和管理设备。'));
  if(state.loggedIn){target.append(notice(`当前账户：${state.username}。${connectionLabel()}。`,
    state.connection==='connected'?'连接正常':'登录已保存'),group('连接操作',[
    row('检查账户','核对当前会话是否仍有效',async()=>{
      const epoch=state.authEpoch,owner=state.owner;
      try{
        const profile=await call('auth.me');
        if(epoch!==state.authEpoch||owner!==state.owner)return;
        state.profile=profile;
        state.connection=profile.connectionVerified?'connected':'offline';
        showProfile(profile);
        if(state.page==='connect'||state.page==='settings')page(state.page);
        else if(state.page==='chat'&&!state.conversationId)showWelcome();
        toast(profile.connectionVerified?'账户连接正常':'电脑暂不可达，正在使用当前账户的本机资料',!profile.connectionVerified);
      }catch(error){
        if(epoch!==state.authEpoch||owner!==state.owner)return;
        state.connection=error.message==='UNAUTHORIZED'||error.message==='AUTH_REQUIRED'?'expired':'offline';
        if(state.page==='connect'||state.page==='settings')page(state.page);
        else if(state.page==='chat'&&!state.conversationId)showWelcome();
        toast(state.connection==='expired'?'登录已失效，请重新登录':'电脑暂不可达，本机资料仍保留',true);
      }
    }),
     row('退出登录','本机对话保留；当前设备的服务器会话将撤销',async()=>{try{await call('auth.logout');state.authEpoch++;state.accountModelCredentialConflict=null;state.handoffViews.clear();state.linkedEvents.clear();state.handoffModelNames.clear();state.handoffPickerOpen.clear();state.handoffSelections.clear();state.handoffModelLastCheck=0;clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;state.loggedIn=false;state.connection='local';state.username='';state.owner='';state.profile=null;state.model=null;state.conversationId=null;
       resetMemoryForAuthBoundary('已退出电脑账户；记忆内容已清除。');
      state.backgroundSync='not_scheduled';
      $('model-label').textContent='选择模型';try{applyTheme((await uiCore.mobileAppearance()).value)}catch{applyTheme('system')}
      showProfile({displayName:'未登录'});page('connect');await listConversations();loadDraft()}catch(e){toast(safeError(e),true)}})]));return}
  const origin=field('个人服务地址','url','https://home.weftmate.com:8443');const user=field('账户名（3–64个字符）','text');
  const password=field('密码（注册时15–128个字符）','password');
  const device=field('设备名称','text','这台手机');const display=field('昵称（首次注册时可填）','text');
  const root=group('连接个人账户',[]);const body=root.querySelector('.group-body');body.append(origin.box,user.box,password.box,device.box,display.box);
  const result=el('div','muted','先检查服务连接。已有账户可登录，也可以注册自己的账户。');body.append(result);
  const buttons=el('div','form-actions');let authenticating=false,probeEpoch=0;const login=action('登录',async()=>authenticate('auth.login'));
  const register=action('注册新账户',async()=>authenticate('auth.register'),false);register.hidden=true;
  async function authenticate(method){if(authenticating)return;
    if(method==='auth.register'&&[...password.input.value].length<15||
      method==='auth.register'&&[...password.input.value].length>128){result.textContent='注册密码需为15–128个字符，可使用密码短语。';result.className='inline-error';return}
    authenticating=true;login.disabled=true;register.disabled=true;probe.disabled=true;
    result.textContent=method==='auth.register'?'正在注册账户…':'正在登录…';result.className='muted';
    try{const account=await call(method,{origin:origin.input.value,username:user.input.value,
      password:password.input.value,deviceName:device.input.value,displayName:display.input.value});password.input.value='';
      state.authEpoch++;state.accountModelCredentialConflict=null;state.handoffViews.clear();state.linkedEvents.clear();state.handoffModelNames.clear();state.handoffPickerOpen.clear();state.handoffSelections.clear();state.handoffModelLastCheck=0;clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;state.loggedIn=true;state.connection=account.connectionVerified?'connected':'checking';state.username=account.username;state.owner=account.owner||'';state.deviceId=account.deviceId||account.device?.id||'';state.profile=account;state.conversationId=null;
      resetMemoryForAuthBoundary('账户已切换。请重新读取新账户的记忆。');
      const current=await call('app.bootstrap');state.model=current.model?.source?current.model:null;
      state.backgroundSync=account.backgroundSync||current.backgroundSync||'unknown';
      $('model-label').textContent=state.model?.displayName||'选择模型';
      try{applyTheme((await uiCore.mobileAppearance()).value)}catch{applyTheme('system')}
      showProfile(account);
      page('connect');await listConversations();loadDraft();
      await call('app.ready',{owner:state.owner,hasDraft:hasAnyDraft()});
      let outcome=account.connectionVerified?(method==='auth.register'?'账户已建立':'已登录账户'):
        '登录已保存，连接待核对';
      if(state.backgroundSync==='not_scheduled')outcome+='；后台同步未启用，仍可手动同步';
      else if(state.backgroundSync==='unknown')outcome+='；后台同步状态待确认';
      toast(outcome,state.backgroundSync!=='scheduled')}
    catch(e){password.input.value='';result.textContent=safeError(e);result.className='inline-error'}
    finally{authenticating=false;login.disabled=false;register.disabled=false;probe.disabled=false}}
  buttons.append(login,register);body.append(buttons);target.append(root);
  const probe=action('检查服务连接',async()=>{const current=++probeEpoch,originValue=origin.input.value;
    result.textContent='正在检查连接…';result.className='muted';try{const service=await call('auth.state',{origin:originValue});
    if(current!==probeEpoch||origin.input.value!==originValue||authenticating)return;
    if(service.configured){result.textContent=service.registrationAvailable?'可登录现有账户，也可注册新账户。':'服务已有账户，请登录。';
      login.hidden=false;register.hidden=!service.registrationAvailable}
    else{result.textContent=service.registrationAvailable?'此服务尚无账户，可以注册自己的账户。':'服务当前不开放注册。';
      login.hidden=true;register.hidden=!service.registrationAvailable}}
    catch(e){if(current!==probeEpoch||authenticating)return;result.textContent=safeError(e);result.className='inline-error';login.hidden=true;register.hidden=true}},false);
  root.querySelector('.group-body').insertBefore(probe,result);
}

function accountModelIntentKey(...args){return uiCore.mobileSettings.accountModelIntentKey(...args)}

function savedAccountModelIntent(...args){return uiCore.mobileSettings.savedAccountModelIntent(...args)}

function clearAccountModelIntent(...args){return uiCore.mobileSettings.clearAccountModelIntent(...args)}

function modelPageCurrent(...args){return uiCore.mobileSettings.modelPageCurrent(...args)}

function publishSavedPhoneModel(...args){return uiCore.mobileSettings.publishSavedPhoneModel(...args)}

function transferAccountModel(...args){return uiCore.mobileSettings.transferAccountModel(...args)}

function testAccountModel(...args){return uiCore.mobileSettings.testAccountModel(...args)}

function modelsPage(target){target.append(heading('对话模型','手机直连模型与电脑模型分开列出；密钥不会出现在账户模型目录中。'));
  if(!state.loggedIn){target.append(notice('请登录或注册账户后选择模型。原有未绑定的模型配置会原样保留，不会自动交给新账户。'),
    action('连接账户',()=>page('connect')));return}
  const pageOwner=state.owner,pageEpoch=state.authEpoch,pageGeneration=state.generation;
  const current=()=>modelPageCurrent(pageOwner,pageEpoch,pageGeneration);
  const list=group('手机已保存模型',[]);target.append(list);const body=list.querySelector('.group-body');
  call('models.list').then(result=>{if(!current())return;clear(body);
    if(!result.models?.length)body.append(el('p','muted','尚未保存手机模型'));
    for(const item of result.models){const card=el('div','model-library-entry');
      card.append(el('strong','',`${item.displayName||item.modelId}${item.selected?' · 当前':''}`),
        el('small','',`${item.endpoint.startsWith('http://')?'本地服务':'手机直连云'} · ${item.modelId}`));
      const controls=el('div','model-library-actions');
      const use=el('button','secondary','在手机使用');use.disabled=item.selected===true;
      use.addEventListener('click',async()=>{try{const selected=await call('models.select',{endpoint:item.endpoint,modelId:item.modelId});
        if(!current())return;
        state.model=selected;$('model-label').textContent=selected.displayName||selected.modelId;
        toast('已明确切换为手机直连模型');page('models')}catch(e){if(current())toast(safeError(e),true)}});
      controls.append(use);
      if(item.endpoint.startsWith('https://')){const publish=el('button','secondary',
        savedAccountModelIntent('publish',`${item.endpoint}|${item.modelId}`)?'核对电脑配置':'在电脑使用这个模型');
        publish.addEventListener('click',()=>void publishSavedPhoneModel(item));controls.append(publish)}
      if(!item.selected){const remove=el('button','quiet','删除本机副本');remove.addEventListener('click',async()=>{
        if(remove.dataset.confirm!=='yes'){remove.dataset.confirm='yes';remove.textContent='确认删除本机副本';return}
        try{await call('models.account.removeLocal',{endpoint:item.endpoint,modelId:item.modelId});
          if(!current())return;
          toast('仅移除了这台手机的副本；账户共享配置未改变');page('models')}
        catch(error){if(current())toast(safeError(error),true)}});controls.append(remove)}
      card.append(controls);body.append(card)}
  }).catch(e=>{if(current())body.append(el('p','inline-error',safeError(e)))});
  const endpoint=field('提供方地址（/v1）','url',state.model?.endpoint||'');
  const id=field('模型 ID','text',state.model?.modelId||'');const key=field('API Key（留空保留同一地址已存密钥）','password');
  const form=group('配置自定义模型',[]);form.querySelector('.group-body').append(endpoint.box,id.box,key.box,
    action('保存并选择',async()=>{try{const selected=await call('models.configure',{endpoint:endpoint.input.value,
      modelId:id.input.value,apiKey:key.input.value});key.input.value='';if(!current())return;
      state.model=selected;$('model-label').textContent=selected.displayName||selected.modelId;
      toast('手机模型已保存');page('models')}catch(e){key.input.value='';if(current())toast(safeError(e),true)}}));target.append(form);
  if(state.model?.source==='phone')target.append(group('连接检查',[row('检查当前模型目录','只确认服务可达和模型是否列出，不发送推理消息',async()=>{
    try{const result=await call('models.verifyPhone');toast(result.modelListed?'目录中已列出当前模型；尚未测试推理':'服务可达，但目录未列出当前模型',!result.modelListed)}
    catch(e){toast(safeError(e),true)}})]));
  if(state.loggedIn){const hostGroup=group('电脑模型',[]);const hostBody=hostGroup.querySelector('.group-body');hostBody.append(el('p','muted','正在读取电脑已配置模型…'));target.append(hostGroup);
    call('models.host').then(result=>{if(!current())return;clear(hostBody);
      const models=result.models||[];if(!models.length)hostBody.append(el('p','muted','电脑当前没有可选模型'));
      for(const item of models){hostBody.append(row(`${item.displayName}${item.selected?' · 当前':''}`,
        `${item.sourceKind==='local'?'电脑本机':'电脑云端'} · ${item.configured?'已配置':'未配置'}`,async()=>{
          if(!item.configured){toast('请先在电脑上配置这个模型',true);return}
          try{const verified=await call('models.verifyHost',{profileId:item.profileId});if(!current())return;
            if(verified.available===false){toast('电脑模型暂不可用',true);return}
            const selected=await call('models.selectHost',{profileId:item.profileId});if(!current())return;
            state.model=selected;
            $('model-label').textContent=selected.displayName||selected.profileId;toast('已选择电脑模型');page('models')}
          catch(e){if(current())toast(safeError(e),true)}}))}
    }).catch(e=>{if(current()){clear(hostBody);hostBody.append(el('p','inline-error',safeError(e)))}});
    const accountGroup=group('账户云模型',[]);const accountBody=accountGroup.querySelector('.group-body');
    accountBody.append(el('p','muted','正在读取当前账户的配置…'));target.append(accountGroup);
    const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
    call('models.account.list').then(result=>{if(!modelPageCurrent(owner,epoch,generation))return;
      clear(accountBody);const models=Array.isArray(result?.models)?result.models:[];
      if(!models.length)accountBody.append(el('p','muted','当前账户尚无可取回的云模型。可从手机已保存模型明确上传，或在电脑账户页配置。'));
      for(const item of models){if(typeof item?.accountModelId!=='string'||!Number.isSafeInteger(item.revision))continue;
        const card=el('div','model-library-entry');card.append(el('strong','',item.name||item.modelId),
          el('small','',`${item.modelId} · ${{active:'账户可用',stopped:'已停止使用',pending:'配置中',failed:'配置失败'}[item.status]||'待核对'} · 修订 ${item.revision}`));
        const controls=el('div','model-library-actions');
        if(item.status==='active'){
          const transfer=el('button','secondary','保存到手机');transfer.addEventListener('click',()=>void transferAccountModel(item));
          const test=el('button','quiet',savedAccountModelIntent('test',`${item.accountModelId}:${item.revision}`)
            ?'核对连接检查':'测试连接');test.addEventListener('click',()=>void testAccountModel(item));
          controls.append(transfer,test)
        }
        const conflict=state.accountModelCredentialConflict;
        if(conflict?.owner===state.owner&&conflict.id===`${item.accountModelId}:${item.revision}`){
          card.append(el('p','model-library-warning','手机同一地址已有不同密钥。保留本机配置，或明确替换该地址所有本机模型使用的密钥；当前选择不会自动切换。'));
          const keep=el('button','quiet','保留本机密钥');keep.addEventListener('click',()=>{
            state.accountModelCredentialConflict=null;page('models')});
          const replace=el('button','secondary','替换同地址密钥');replace.addEventListener('click',()=>void transferAccountModel(item,true));
          controls.append(keep,replace)}
        card.append(controls);accountBody.append(card)}
    }).catch(error=>{if(modelPageCurrent(owner,epoch,generation)){
      clear(accountBody);accountBody.append(el('p','inline-error',safeError(error)))}})}
}

function devicesPage(target){target.append(heading('设备','同一账户下登录过的设备会列在这里。'));
  if(!state.loggedIn){target.append(notice('请先登录电脑账户，再查看或移除设备。'));return}
  const summary=notice('正在读取设备…');target.append(summary);const gen=state.generation;
  call('auth.devices').then(result=>{if(state.page!=='devices'||state.generation!==gen)return;summary.remove();
    const rows=(result.devices||[]).map(device=>row(`${device.name}${device.current?' · 当前设备':''}`,
      `${device.revoked?'已移除':'登录有效至 '+timeLabel(device.expiresAt)}`,()=>deviceDetails(device)));
    target.append(group('已登录设备',rows.length?rows:[el('p','muted','没有可用设备')]));
  }).catch(e=>{summary.textContent=safeError(e);summary.className='inline-error'});
}

function deviceDetails(device){const target=$('page-content');clear(target);target.append(heading(device.name));
  target.append(notice(device.current?'这是当前手机的账户会话。':'这是同一账户下的另一台设备。'));
  const name=field('设备名称','text',device.name);const box=group('设备管理',[]);box.querySelector('.group-body').append(name.box);
  const controls=el('div','form-actions');controls.append(action('保存名称',async()=>{try{await call('auth.renameDevice',{deviceId:device.id,name:name.input.value});toast('设备名称已更新');page('devices')}
    catch(e){toast(safeError(e),true)}}));controls.append(action('移除设备',()=>{
    const warning=notice(`移除 ${device.name} 后，该设备需要重新登录。`,'确认移除设备');
    const confirmActions=el('div','form-actions');confirmActions.append(action('保留设备',()=>{warning.remove();confirmActions.remove()},false),
      action('确认移除',async()=>{try{const result=await call('auth.revokeDevice',{deviceId:device.id});if(!result.loggedIn){state.authEpoch++;state.accountModelCredentialConflict=null;state.handoffViews.clear();state.linkedEvents.clear();state.handoffModelNames.clear();state.handoffPickerOpen.clear();state.handoffSelections.clear();state.handoffModelLastCheck=0;clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;state.loggedIn=false;state.connection='local';state.username='';state.owner='';state.conversationId=null;
        state.profile=null;state.model=null;state.backgroundSync='not_scheduled';
        $('model-label').textContent='选择模型';showProfile({displayName:'未登录'});
        try{applyTheme((await uiCore.mobileAppearance()).value)}catch{applyTheme('system')}
        page('connect');await listConversations()}else page('devices');toast('设备已移除')}
        catch(e){toast(safeError(e),true)}}));box.after(warning,confirmActions)
  },false));box.querySelector('.group-body').append(controls);target.append(box);
}

function notificationPage(target){target.append(heading('通知','回复、手机动作与同步问题分别保存记录和控制系统提醒。'));
  if(!state.loggedIn){target.append(notice('登录后可查看当前账户的通知；其它账户的记录不会显示。'));return}
  const loading=notice('正在读取通知设置…');target.append(loading);const gen=state.generation;
  Promise.all([call('notifications.state'),call('notifications.inbox')]).then(([settings,history])=>{
    if(state.page!=='notifications'||state.generation!==gen)return;loading.remove();
    if(!settings.systemAllowed)target.append(notice(settings.needsPermission?'系统通知权限尚未允许；应用内记录仍会保存。':'系统通知已关闭；应用内记录仍会保存。','系统提醒'),
      action('打开通知权限',async()=>{try{await call('notifications.requestPermission');toast('请在系统提示中选择')}
        catch(e){toast(safeError(e),true)}},false));
    const labels=[['reply','回复完成','模型回复完成或未完成'],['action','手机动作结果','打开应用或设置的请求状态'],['sync','同步问题','本机待传记录需要处理']];
    target.append(group('提醒类别',labels.map(([key,title,detail])=>row(`${title} · ${settings.categories?.[key]?'已开启':'已关闭'}`,
      detail,async()=>{try{await call('notifications.set',{category:key,enabled:!settings.categories[key]});page('notifications')}
      catch(e){toast(safeError(e),true)}}))));
    const items=history.items||[];target.append(group('最近记录',items.length?items.map(item=>row(item.title,
      `${item.summary} · ${timeLabel(item.createdAt)}`,()=>{if(item.conversationId)selectConversation(item.conversationId);else page('chat')})):
      [el('p','muted','还没有新的回复或同步提醒')]));
  }).catch(e=>{loading.textContent=safeError(e);loading.className='inline-error'});
}

function accountPage(target){target.append(heading('我的资料'));
  if(!state.loggedIn){target.append(notice('请登录或注册自己的账户后查看资料。旧的未绑定本机记录仍保留在手机，只有明确认领后才会归到某个账户。'),
    action('连接账户',()=>page('connect')));return}
  const loading=notice('正在读取资料…');target.append(loading);const gen=state.generation;
  call('auth.me').then(profile=>{if(state.page!=='account'||state.generation!==gen)return;loading.remove();state.profile=profile;
    if(profile.connectionVerified===false)target.append(notice('电脑暂时不可达，以下是此账户保存在手机上的资料。'));
    const avatar=el('div','profile-large');if(profile.avatar?.dataBase64){const img=el('img');img.src=`data:${profile.avatar.mimeType};base64,${profile.avatar.dataBase64}`;
      img.alt='当前头像';avatar.append(img)}else avatar.textContent=(profile.displayName||profile.username||'我').slice(0,1);
    target.append(avatar);const nickname=field('昵称','text',profile.displayName||profile.username);const groupNode=group('账户资料',[]);
    const body=groupNode.querySelector('.group-body');body.append(nickname.box,el('p','muted',`账户名：${profile.username}`));
    body.append(action('保存昵称',async()=>{try{const updated=await call('auth.profile',{expectedRevision:profile.profileRevision,displayName:nickname.input.value});
      state.profile=updated;showProfile(updated);toast(updated.localCacheSaved===false?'昵称已在电脑保存，本机离线副本未保存':'昵称已更新');page('account')}
      catch(e){toast(safeError(e),true)}}));
    body.append(action('更换头像',async()=>{try{await call('auth.chooseAvatar');toast('请从系统照片中选择头像')}
      catch(e){toast(safeError(e),true)}},false));target.append(groupNode);
    if(profile.avatar)body.append(action('移除头像',async()=>{try{const updated=await call('auth.profile',{expectedRevision:profile.profileRevision,avatar:null});
      state.profile=updated;showProfile(updated);toast('头像已移除');page('account')}catch(e){toast(safeError(e),true)}},false));
    if(state.loggedIn)target.append(group('账户保护',[row('修改密码','修改后其他设备需要重新登录',()=>page('password'))]));
  }).catch(e=>{loading.textContent=safeError(e);loading.className='inline-error'});
}

function passwordPage(target){target.append(heading('修改密码','修改成功后当前手机继续登录，其他设备需要重新登录。'));
  if(!state.loggedIn){target.append(notice('请先登录账户。'));return}
  const current=field('当前密码','password');const next=field('新密码（至少15个字符）','password');const check=field('再次输入新密码','password');
  const box=group('账户密码',[]);box.querySelector('.group-body').append(current.box,next.box,check.box,
    action('保存新密码',async()=>{if(next.input.value!==check.input.value){toast('两次输入的新密码不同',true);return}
      if([ ...next.input.value ].length<15||[ ...next.input.value ].length>128){toast('新密码需为15–128个字符',true);return}
      try{await call('auth.changePassword',{currentPassword:current.input.value,newPassword:next.input.value});
        current.input.value='';next.input.value='';check.input.value='';toast('密码已更新');page('account')}
      catch(e){current.input.value='';next.input.value='';check.input.value='';toast(safeError(e),true)}}));target.append(box)
}

function syncPage(target){target.append(heading('离线与同步'),notice(state.loggedIn?
  '当前账户的手机记录先保存在本机，联网后同步到同一账户。':'请先登录账户。归属不明的旧本机资料会保留，但不会自动交给新账户。'));
  if(!state.loggedIn){target.append(action('连接账户',()=>page('connect')));return}
  const labels={scheduled:'后台同步已安排；具体执行时间由Android决定。',
    not_scheduled:'后台同步未启用；本机记录仍保留，可手动同步。',unknown:'后台调度状态暂无法确认；可先手动同步。'};
  const job=notice(labels[state.backgroundSync]||labels.unknown,'后台同步');target.append(job);
  const jobGeneration=state.generation;call('sync.status').then(result=>{
    if(state.page!=='sync'||state.generation!==jobGeneration)return;
    state.backgroundSync=result.backgroundSync||'unknown';job.replaceChildren(el('strong','','后台同步'),
      el('span','',labels[state.backgroundSync]||labels.unknown));
  }).catch(()=>{if(state.page==='sync'&&state.generation===jobGeneration)
    job.replaceChildren(el('strong','','后台同步'),el('span','',labels.unknown))});
  target.append(action('立即同步',async()=>{try{const result=await call('sync.run');toast(`已同步：上传 ${result.uploaded}，接收 ${result.downloaded}`)}
    catch(e){toast(safeError(e),true)}}));
  const gen=state.generation;call('records.unboundSummary').then(info=>{
    if(state.page!=='sync'||state.generation!==gen||!info.eligible||info.conversationCount<1)return;
    const box=group('旧本机对话',[row(`${info.conversationCount} 个待认领的旧对话`,
      `仅升级前已确认属于 ${state.username} 的本机资料可归入当前账户`,()=>{
        const detail=notice(`将这 ${info.conversationCount} 个旧对话归入账户 ${state.username}。此操作会让它们进入该账户的同步队列。`,'确认归属');
        const confirmActions=el('div','form-actions');confirmActions.append(action('暂不认领',()=>{detail.remove();confirmActions.remove()},false),
          action('确认归入当前账户',async()=>{try{await call('records.claimUnbound',{expectedCount:info.conversationCount,
            confirmAccountName:state.username});toast('旧对话已归入当前账户');page('sync');await listConversations()}
            catch(e){toast(safeError(e),true)}}));box.after(detail,confirmActions)
      })]);target.append(box)
  }).catch(()=>{});
}

function appearancePage(target){target.append(heading('外观','同一套 Weave 组件会跟随选择同步变化。'));
  const options=[['system','跟随系统','随着设备浅色/深色模式切换'],['light','浅色','明亮的 Weave 界面'],['dark','深色','暗处阅读更舒适']];
  target.append(group('主题',options.map(([value,label,detail])=>row(`${label}${state.appearance===value?' · 当前':''}`,detail,async()=>{
    try{const saved=await uiCore.mobileAppearance(value);applyTheme(saved.value);page('appearance')}catch(e){toast(safeError(e),true)}}))));
}

async function updatesPage(target){target.append(heading('界面更新','常规界面可从个人服务端更新；新增原生能力仍需更新应用。'));
  let details;try{details=await call('updates.status')}catch(e){target.append(notice(safeError(e)));return}
  target.append(group('版本',[row('当前界面',details.activeVersion,()=>{}),row('原生应用',details.nativeVersion,()=>{})]));
  const install=group('本设备安装',[]),installBody=install.querySelector('.group-body'),
    downloadUrl='https://www.weftmate.com/downloads/?platform=android',
    link=el('a','native-download-link','在官网查看安卓安装包'),qr=el('img','native-download-qr');
  link.setAttribute('href',downloadUrl);link.setAttribute('aria-label','打开 WeftMate 官网安卓下载页面');
  qr.src='qr/android.svg';qr.alt='WeftMate 官网安卓下载页面二维码';qr.width=168;qr.height=168;
  installBody.append(el('p','muted','当前是 Android 设备。原生更新需要从官网下载安装包并手动覆盖安装。'),link,qr,
    el('p','muted native-download-qr-note','也可以用另一台设备扫描二维码打开同一个安卓下载页面。'));
  target.append(install);
  if(!state.loggedIn){target.append(notice('登录账户后才会检查服务端界面；内置页面仍可打开登录与注册。'),
    action('连接账户',()=>page('connect')));return}
  target.append(group('更新方式',[row(`自动更新界面 · ${details.autoEnabled?'已开启':'已关闭'}`,
    '有草稿或正在回复时先下载，空闲后应用；可随时手动检查',async()=>{
      try{const preference=await call('updates.preference',{autoEnabled:!details.autoEnabled});
        details.autoEnabled=preference.autoEnabled;page('updates')}
      catch(e){toast(safeError(e),true)}})]));
  if(details.releaseNotes)target.append(notice(details.releaseNotes,'新版说明'));
  if(details.stagedVersion)target.append(notice(details.pendingReason==='draft'?'当前账户还有未发送草稿，已暂缓应用新界面。':
    details.pendingReason==='running'?'当前回复仍在进行，完成后再应用新界面。':
    details.pendingReason==='switching'?'正在切换账户，稍后再应用新界面。':
    details.autoEnabled?'新版界面已下载，将在空闲时自动应用。':'新版界面已下载，可手动应用。','待应用更新'));
  const controls=el('div','form-actions');controls.append(action('检查更新',async()=>{try{const result=await call('updates.check');state.ui=result;
    toast(result.stagedVersion?`新界面 ${result.stagedVersion} 已下载`:'已经是当前界面');page('updates')}
    catch(e){toast(safeError(e),true)}}));
  if(details.stagedVersion)controls.append(action('应用新界面',async()=>{try{await call('updates.apply',{hasDraft:!!$('draft').value.trim()});toast('界面已更新')}
    catch(e){toast(safeError(e),true)}},false));target.append(controls);
  if(details.previousAvailable)target.append(group('恢复',[row('退回上一版','已保存的上一个完整界面包',async()=>{
    try{await call('updates.rollback',{hasDraft:!!$('draft').value.trim()})}catch(e){toast(safeError(e),true)}})]));
  if(details.lastError)target.append(el('p','inline-error',/^[A-Z_]+$/.test(details.lastError)?
    safeError(new Error(details.lastError)):details.lastError));
  if(details.lastError==='UI_UPDATE_REJECTED')target.append(action('重新下载这个版本',async()=>{
    try{await call('updates.retryRejected');const result=await call('updates.check');state.ui=result;toast(result.stagedVersion?'新界面已重新下载':'已检查界面版本');page('updates')}
    catch(e){toast(safeError(e),true)}},false));
}

async function phoneAction(kind){if(kind==='settings'){
    try{const result=await call('tools.execute',{name:'open_settings',conversationId:state.conversationId||''});
      selectConversation(result.conversationId);toast(`系统设置：${receiptStatus(result.status)}`);await listConversations();await renderConversation()}
    catch(e){toast(safeError(e),true)}return}
  const target=$('page-content');clear(target);target.append(heading('打开手机应用','从系统可启动应用中选择，不需要填写包名。'));
  const loading=notice('正在读取这台手机的应用…');target.append(loading);
  try{const result=await call('tools.apps');loading.remove();const apps=(result.apps||[]).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
    target.append(group('可启动应用',apps.map(app=>row(app.name,'在这台手机打开',async()=>{
      try{const opened=await call('tools.execute',{name:'open_app',packageName:app.packageName,conversationId:state.conversationId||''});
        selectConversation(opened.conversationId);toast(`${app.name}：${receiptStatus(opened.status)}`);await listConversations();await renderConversation()}
      catch(e){toast(safeError(e),true)}}))));
  }catch(e){loading.textContent=safeError(e);loading.className='inline-error'}
}
