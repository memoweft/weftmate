/* The existing phone UI presents account-owned M3 conversations in its main chat. */
(() => {
  let engine, account, cloud, native, sessionKey, memoryModel, modelServices, serviceDirectory={services:[],selected:null}, nativeServices=false, phonePicker, progress, poll, archive, handoffNotice=false, nativeError='', memoryTimer;
  const data = () => engine?.view() || archive;
  const list = () => (data()?.conversations || []).map(c => ({ id: c.id, createdAt: new Date(c.turns[0]?.timestamp || Date.now()).toISOString(), title: c.turns[0]?.messages[0]?.text.slice(0, 40) || '新对话', source: 'phone' }));
  const nativeCall = (...args) => androidBridge.call(...args);
  const modelView = model => model && { source: 'phone', endpoint: model.baseUrl, modelId: model.modelId, displayName: model.displayName || model.modelId, serviceId:model.serviceId,interfaceType:model.interfaceType };
  const currentServiceModel = ()=>serviceDirectory.services.find(service=>service.serviceId===serviceDirectory.selected?.serviceId)?.models.find(model=>model.modelId===serviceDirectory.selected?.modelId);
  const currentModel = () => native ? state.model && { modelId: state.model.modelId, baseUrl: state.model.endpoint,serviceId:state.model.serviceId,interfaceType:state.model.interfaceType,deepThinking:currentServiceModel()?.deepThinking } : modelServices?.currentModel() || memoryModel;
  const catalogMessage = status => ({authentication_failed:'这个模型服务的密钥不正确或没有访问权限，请检查密钥。',unsupported:'这个模型服务不提供模型清单，请手填一个型号。',offline:'暂时连不上这个模型服务，已保留原来的模型。也可以手填型号。',failed:'这个模型服务暂时无法返回模型清单，可以稍后重试或手填型号。',invalid:'这个模型服务返回的清单无法读取，请手填一个型号。',not_checked:'还没有查询模型清单。',unchecked:'还没有查询模型清单。'}[status] || '已读取模型清单。');
  function oldDirectory(result){
    const grouped=new Map();
    for(const row of result.models||[]){const serviceId=row.serviceId||row.endpoint;let service=grouped.get(serviceId);
      if(!service){service={serviceId,name:row.serviceName||'模型服务',baseUrl:row.endpoint?.replace(/\/chat\/completions$/,''),endpoint:row.endpoint,interfaceType:'openai-compatible',models:[],catalog:{status:'not_checked'}};grouped.set(serviceId,service);}
      service.models.push({modelId:row.modelId,name:row.displayName||row.modelId,enabled:true});}
    const selected=result.selected||state.model;
    return {services:[...grouped.values()],selected:selected&&{serviceId:selected.serviceId||selected.endpoint,modelId:selected.modelId}};
  }
  async function readServices(){
    if(!native)return modelServices?.view()||serviceDirectory;
    const key=sessionKey,result=await nativeCall('phone.models.list');if(key!==sessionKey)return serviceDirectory;nativeServices=Array.isArray(result.services);
    serviceDirectory=nativeServices?{services:result.services,selected:result.selected&&{serviceId:result.selected.serviceId,modelId:result.selected.modelId}}:oldDirectory(result);
    for(const service of serviceDirectory.services)service.catalog={...service.catalog,message:catalogMessage(service.catalog?.status)};
    return serviceDirectory;
  }
  async function serviceCall(action,params={}){
    if(!native){
      const key=sessionKey,manager=modelServices;
      const result=action==='list'?manager.view():action==='configure'?await manager.configure(params):action==='refresh'?await manager.refresh(params.serviceId,{force:params.force===true}):
        action==='select'?manager.select(params.serviceId,params.modelId):action==='update'?manager.update(params):manager.remove(params.serviceId);
      if(key!==sessionKey||manager!==modelServices)return result;
      if(action==='select')state.model=result;else if(result.model!==undefined)state.model=result.model;
      serviceDirectory=modelServices.view();updateComposer();return result;
    }
    if(action==='list')return readServices();
    if(nativeServices){
      const key=sessionKey;
      const method={configure:'serviceConfigure',refresh:'serviceRefresh',select:'serviceSelect',update:'serviceUpdate',remove:'serviceRemove'}[action];
      const result=await nativeCall('phone.models.'+method,params,45000);
      if(key!==sessionKey)return result;
      if(action==='select')state.model=result;else if(result.model!==undefined)state.model=result.model;
      await readServices();updateComposer();return {...serviceDirectory,model:state.model,service:serviceDirectory.services.find(row=>row.serviceId===(result.serviceId||params.serviceId))};
    }
    // Released shells keep their old configure/select path. They can still use saved models after a UI update.
    if(action==='configure'){
      if(params.interfaceType==='anthropic')throw Object.assign(new Error('NATIVE_MODEL_INTERFACE_UPGRADE_REQUIRED'),{code:'NATIVE_MODEL_INTERFACE_UPGRADE_REQUIRED'});
      if(!params.modelId)throw Object.assign(new Error('NATIVE_SERVICE_UPGRADE_REQUIRED'),{code:'NATIVE_SERVICE_UPGRADE_REQUIRED'});
      state.model=await nativeCall('phone.models.configure',{...params,displayName:params.name||params.modelId});await readServices();
    }else if(action==='select'){
      const service=serviceDirectory.services.find(row=>row.serviceId===params.serviceId);const model=service?.models.find(row=>row.modelId===params.modelId);
      state.model=await nativeCall(model?.discovered?'phone.models.configure':'phone.models.select',{endpoint:service?.endpoint,modelId:params.modelId,displayName:model?.name});await readServices();
    }else if(action==='remove'){
      const service=serviceDirectory.services.find(row=>row.serviceId===params.serviceId);
      for(const model of service?.models||[])if(!model.discovered)await nativeCall('phone.models.remove',{endpoint:service.endpoint,modelId:model.modelId});await readServices();
      state.model=(await nativeCall('phone.models.list')).selected;
    }else if(action==='update'){
      const service=serviceDirectory.services.find(row=>row.serviceId===params.serviceId);
      if(params.modelId){state.model=await nativeCall('phone.models.configure',{endpoint:service.endpoint,modelId:params.modelId});await readServices();}
      if(params.enabledModelIds)for(const model of service.models)model.enabled=params.enabledModelIds.includes(model.modelId);
    }
    if(action==='refresh'||action==='configure'){
      const service=serviceDirectory.services.find(row=>row.serviceId===(params.serviceId||state.model?.endpoint));
      if(service)try{const response=await nativeCall('models.discover');for(const model of response.models||[])if(!service.models.some(row=>row.modelId===model.id))service.models.push({modelId:model.id,name:model.displayName||model.id,enabled:true,discovered:true});service.catalog={status:'available',message:`已找到 ${service.models.length} 个聊天模型。`};}
      catch(error){const status=['401','403','MODEL_AUTH_REJECTED','AUTH_REJECTED'].includes(String(error.code||error.message))?'authentication_failed':'unsupported';service.catalog={status,message:catalogMessage(status)};}
    }
    updateComposer();return {...serviceDirectory,model:state.model};
  }
  async function openModelMenu(){
    if(state.menu&&!$('model-popover').hidden){closeModelMenu();return;}
    closeAttachmentMenu();state.menu=true;
    const trigger=$('model-button'),popup=$('model-popover');
    phonePicker ||= WeftModelPicker.mount({trigger,popup,view:()=>({...serviceDirectory,requiresVision:false,
      recent:serviceDirectory.services.flatMap(service=>service.models.map(model=>({key:`${service.serviceId}/${model.modelId}`,used:model.lastUsedAt||0}))).filter(row=>row.used).sort((a,b)=>b.used-a.used).map(row=>row.key)}),
      select:async item=>{await serviceCall('select',item);state.menu=false;},
      refresh:async()=>{await readServices();await serviceCall('refresh',{force:true});},add:()=>{state.menu=false;page('phoneModels');},
      thinking:()=>currentServiceModel()?.deepThinking,toggleThinking:async enabled=>{if(native)await serviceCall('update',{...serviceDirectory.selected,deepThinkingEnabled:enabled});else{modelServices.setDeepThinking(enabled);serviceDirectory=modelServices.view();}},toast});
    await phonePicker.open();
  }
  const sendBlocker = (text, queue = false) => !engine ? '正在打开对话，请稍候再发送。'
    : !state.model ? '先在设置里添加一个模型，再开始聊天。'
    : state.modelSwitching ? '正在测试或切换模型，请稍候再发送。'
    : engine.view().running && !queue ? '当前回复还在进行，请先停止或等待。'
    : !text.trim() ? '先输入消息。'
    : text.trim().length>16384 ? '消息过长，请缩短后发送。' : '';
  const show = () => {
    if (!engine) return;
    const value = engine.view(), finished=state.busy && !value.running; state.busy = value.running;
    if(finished && api.active){clearTimeout(memoryTimer);const id=value.activeConversationId||state.conversationId;memoryTimer=setTimeout(()=>void engine?.extractMemory(id),20000);}
    state.conversations = value.conversations.map(c => ({ id: c.id, createdAt:new Date(c.turns[0]?.timestamp||Date.now()).toISOString(), title: c.turns[0]?.messages[0]?.text.slice(0, 40) || '新对话', source: 'phone' }));
    if (!state.conversationId && value.running) state.conversationId = value.conversations.at(-1)?.id || null;
    renderConversationList(); if (state.page === 'chat' && state.chatSource === 'phone') render(); updateComposer();
    if(state.page==='memory'&&globalThis.WeftPhone?.memoryPending)$('page-content').phoneMemoryPaint?.();
  };
  function render() {
    const content = $('chat-content'); clear(content);
    const conversation = data()?.conversations.find(c => c.id === state.conversationId);
    if (!conversation?.turns.length) { showWelcome(); return; }
    for (const turn of conversation.turns) {
      for (const message of turn.messages) content.append(messageNode(message.role, message.text));
      if (turn.workRequest?.status === 'pending') {
        const card = document.createElement('section'); card.className = 'work-switch-card'; card.setAttribute('aria-label', '切换到工作');
        const title = document.createElement('h3'); title.textContent = '这件事需要在电脑上做。要切换到工作吗？';
        const hint = document.createElement('p'); hint.textContent = '需要一台在线的电脑。在电脑上安装 WeftMate，用同一账号登录，就能在电脑上做事。';
        const later = document.createElement('button'); later.type = 'button'; later.className = 'button secondary'; later.textContent = '先不用'; later.onclick = () => engine.declineWork(turn.id);
        const actions = document.createElement('div'); actions.className = 'work-switch-actions'; actions.append(later);
        const work = globalThis.WeftMobileCloud?.core;
        if (work?.offlineWorkReady?.()) { const queue = document.createElement('button'); queue.type = 'button'; queue.className = 'button primary'; queue.textContent = '交给电脑，上线后做';
          queue.onclick = () => work.openOfflineWorkMode(turn.workRequest.text); actions.append(queue); }
        card.append(title, hint, actions); content.append(card);
      }
    }
    const last = conversation.turns.at(-1);
    if(conversation.computerSessionId)content.append(el('p','muted','已在电脑上 · 原手机对话仍保留'));
    const more=action('对话操作',()=>WeftPopover.menu(more,[{name:'删除对话',icon:'trash',danger:true,action:()=>{
      const dialog=el('dialog','model-editor-dialog');dialog.setAttribute('aria-label','删除手机对话');const body=el('div','model-editor-body'),footer=el('footer','dialog-footer');
      body.append(el('h2','','删除这段手机对话？'),el('p','',conversation.computerSessionId?'手机原文会删除；电脑从这段对话记住的内容也会忘掉。电脑暂不可达时会在下次连接处理。':'手机原文和相关轻量记忆会删除，这段对话不会交给电脑。'));
      const confirm=action('确认删除',async()=>{confirm.disabled=true;await api.removeConversation(conversation.id);dialog.close();toast('已删除');},false);confirm.classList.add('danger');footer.append(action('保留',()=>dialog.close(),false),confirm);dialog.append(body,footer);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
    }}]),false);more.classList.add('icon-button');more.replaceChildren(WeftIcons.create('more',18));more.setAttribute('aria-label','手机对话的更多操作');content.append(more);
    if (api.active && last?.messages.some(m => m.role === 'assistant') && !engine.view().running && !last.synced) {
      const button = el('button', 'secondary', '重新生成'); button.type = 'button';
      button.onclick = () => void run(() => engine.regenerate(conversation.id)); content.append(button);
    }
    if(!api.active)content.append(action('回到聊天',()=>state.logicalChats?uiCore.selectMainChat():page('home'),false));
    scrollBottom();
  }
  async function run(action) {
    status(''); nativeError='';
    try { const result = await action(); if (result) state.conversationId = result.conversationId; }
    catch (error) { const stopped=error.name==='AbortError'||error.message==='CANCELLED';nativeError=stopped?'已停止，生成的文字已保存。':'回复未完成，已保存生成的文字。请检查网络或模型配置后重试。';status(nativeError,!stopped); }
    finally { show();clearTimeout(memoryTimer);const id=state.conversationId;memoryTimer=setTimeout(()=>void engine?.extractMemory(id),20000);if(!api.active && engine?.view().turns.length)await connected(); }
  }
  async function attachEngine(info, client, adopt = true) {
    native = !!window.weftNative; cloud = client;
    const next = `${info.origin}:${info.accountId}`;
    if (sessionKey !== next) {
      clearTimeout(memoryTimer);
      if (engine) { const previous=engine;engine=null;previous.close(); }
      modelServices?.clear();
      sessionKey = next; account = info; memoryModel = null;modelServices=null;serviceDirectory={services:[],selected:null};nativeServices=false;
      if(!native)modelServices=await WeftPhoneModelServices.create({changed:value=>{if(sessionKey===next)serviceDirectory=value;}});
      if (native && adopt) await nativeCall('phone.adopt', info);
      const phoneScope={accountId:info.accountId,origin:info.origin};
      const vault = native ? {
        key: () => nativeCall('phone.offline.key'), load: () => nativeCall('phone.offline.load'),
        save: value => nativeCall('phone.offline.save', { value }), clear: () => nativeCall('phone.offline.clear',phoneScope), close() {},
        open: (envelope, identity) => nativeCall('phone.offline.open', { envelope, identity }),
        complete: async (body, snapshot, signal, onProgress) => {
          if(signal.aborted)throw new DOMException('CANCELLED','AbortError');
          progress = onProgress; const stop = () => void nativeCall('phone.stop'); signal.addEventListener('abort', stop, { once: true });
          try { return await nativeCall('phone.complete', { body,serviceId:snapshot.model.serviceId }, 180000); }
          finally { progress = null; signal.removeEventListener('abort', stop); }
        },
      } : await WeftOffline.browserVault('phone:' + next);
      const complete = vault.complete.bind(vault);
      vault.complete = async (body, snapshot, signal, onProgress) => {
        if(snapshot.model.deepThinking?.supported===true&&snapshot.model.deepThinking?.enabled===true){
          body={...body};const baseUrl=new URL(snapshot.model.baseUrl);
          if(snapshot.model.interfaceType==='anthropic')body.thinking=snapshot.model.deepThinking.type==='adaptive'?{type:'adaptive'}:{type:'enabled',budget_tokens:2048};
          else if(['api.xiaomimimo.com','api.deepseek.com'].includes(baseUrl.hostname))body.thinking={type:'enabled'};
          else if(baseUrl.hostname==='dashscope.aliyuncs.com')body.enable_thinking=true;
          else body.reasoning_effort='high';
        }
        if(native||snapshot.model.interfaceType!=='anthropic')return complete(body,snapshot,signal,onProgress);
        const system=body.messages.filter(row=>row.role==='system').map(row=>row.content).join('\n\n');
        const response=await fetch(snapshot.model.baseUrl+'/messages',{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json','x-api-key':snapshot.model.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
          body:JSON.stringify({model:body.model,system,messages:body.messages.filter(row=>row.role!=='system'),max_tokens:Math.max(body.max_tokens||4096,body.thinking?.budget_tokens?body.thinking.budget_tokens+1024:0),stream:false,...(body.thinking?{thinking:body.thinking}:{}),
            ...(body.tools?.length?{tools:body.tools.map(row=>({name:row.function.name,description:row.function.description,input_schema:row.function.parameters}))}:{})})});
        if(!response.ok)throw Error('MODEL_UNAVAILABLE');const reply=await response.json();if(reply.stop_reason&&!['end_turn','stop_sequence','tool_use'].includes(reply.stop_reason))throw Error('MODEL_STREAM_INCOMPLETE');const text=reply.content?.filter(row=>row.type==='text').map(row=>row.text).join('')||'';
        const tools=reply.content?.filter(row=>row.type==='tool_use').map(row=>({id:row.id,type:'function',function:{name:row.name,arguments:JSON.stringify(row.input)}}))||[];
        if(!text&&!tools.length)throw Error('MODEL_UNAVAILABLE');if(text)onProgress?.(text);return {choices:[{message:{content:text,...(tools.length?{tool_calls:tools}:{})}}]};
      };
      engine = await WeftOffline.create({ vault, identity: info, phoneModel: currentModel, workRequests: !native,
        accountCheck: async () => {
          if (info.localOnly === true) {
            const current = await nativeCall('phone.identity');
            if (!current.localOnly || current.accountId !== info.accountId || current.origin !== info.origin) throw Error('ACCOUNT_SWITCHED');
            return { devices: [], hosts: [] };
          }
          const directory = await client.authorized('/devices');
          if (!directory.devices.some(d => d.isCurrent && !d.revoked)) { await engine.clear(); throw Error('DEVICE_NOT_TRUSTED'); }
          return directory;
        }, control: id => client.authorized('/hosts/offline/status', { method: 'POST', body: { hostId: id } }),
        hostCapabilities: () => client.config?.capabilities || {},
        host: (path, body) => WeftMobileCloud.core.accessApi(path, { method: 'POST', body, protectedWrite: true }), notify: show });
    }
  }
  async function start(info, client, adopt = true) {
    await attachEngine(info,client,adopt);
    const next = `${info.origin}:${info.accountId}`;
    if (native) state.model = (await nativeCall('phone.models.list')).selected;
    else state.model = modelServices?.selectedView()||modelView(memoryModel);
    await readServices();
    state.authEpoch++; state.loggedIn = true; state.owner = native ? (await nativeCall('app.bootstrap')).owner : next; state.username = info.email; state.deviceId = info.deviceId;
    state.connection = 'phone'; uiCore.phoneAccountConnection(true); state.transitionPending = false; state.chatSource = 'phone'; state.logicalChats = false;
    state.conversationId = engine.view().conversations.at(-1)?.id || null;
    state.profile = { displayName: info.localOnly ? '本机使用' : info.email, phoneOnly: true, localOnly: info.localOnly === true };
    uiCore.stopConnection(); document.body.classList.remove('cloud-auth-active'); $('cloud-auth-page').classList.remove('active');
    showProfile(state.profile); page('chat'); show();
    await uiCore.loadMessageModePreference();
    engine.resumeQueue();
    if (native) { await syncAccountAppearance(); await nativeCall('app.ready', { owner: (await nativeCall('app.bootstrap')).owner, hasDraft: false }); }
    clearInterval(poll); if (!info.localOnly) poll = setInterval(() => void connect().catch(() => {}), 15000);
  }
  async function connect() {
    if (account?.localOnly || !state.loggedIn || engine?.view().running || document.visibilityState === 'hidden') return;
    const directory = await cloud.authorized('/devices');
    if(Array.isArray(directory.hosts)&&!directory.hosts.length&&engine?.view().phoneMemory?.handover){await engine.memoryChange('release-authority');if(!api.active)await start(account,cloud);return;}
    if (!api.active) { if (engine) await connected(); return; }
    if (directory.hosts?.some(h => h.status === 'online' || h.online === true)) await WeftMobileCloud.core.resumePhoneComputer();
  }
  async function connected() {
    if (!engine || !account || account.localOnly) return;
    uiCore.phoneAccountConnection(false);
    const identity = await (native ? nativeCall('offline.identity') : WeftMobileCloud.core.cloudOfflineIdentity());
    if (!identity?.hostId || identity.hostId === 'unconnected') return;
    // Keep this account's vault and stable turn IDs while adopting the computer identity.
    Object.assign(account, identity);
    try { do { if(await engine.sync()===false)break; } while (!engine.view().handover?.awaitingConfirmation&&(engine.view().turns.length||engine.view().forgetConversations.length)); handoffNotice=false;
      if(state.page==='memory')memoryPage($('page-content')); }
    catch { if(!handoffNotice){handoffNotice=true;toast('手机对话仍在这里，连上电脑后会继续处理。');} }
  }
  async function routeCall(method, p) {
    if(native&&(method.startsWith("voice.")||method.startsWith("diagnostics.")||method.startsWith("updates.")))return nativeCall(method,p);
    if (method === 'conversations.list') return { conversations: state.conversations };
    if (method === 'attachments.list') return { attachments: [] };
    if (method === 'app.activity') return {};
    if (method === 'auth.me') return { ...state.profile, loggedIn: true, phoneOnly: true };
    if (method.startsWith('shared.')) return { source: 'host', hostAvailable: false, sessions: [], commands: [], projects: [] };
    const action = { 'models.list': 'list', 'models.configure': 'configure', 'models.select': 'select', 'models.account.removeLocal': 'remove', 'models.verifyPhone': 'test' }[method];
    if (action) {
      if (action === 'test') {
        const previous=state.modelSwitching;state.modelSwitching=true;updateComposer();
        try {
          if(native)return await nativeCall('phone.models.test',p);
          const model=currentModel();if(!model)throw Error('MODEL_NOT_CONFIGURED');
          const anthropic=model.interfaceType==='anthropic';
          const response=await fetch(model.baseUrl+(anthropic?'/messages':'/chat/completions'),{method:'POST',redirect:'error',cache:'no-store',
            headers:anthropic?{'content-type':'application/json','x-api-key':model.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'}:{'content-type':'application/json',authorization:`Bearer ${model.apiKey}`},
            body:JSON.stringify({model:model.modelId,messages:[{role:'user',content:'只回复 OK'}],...(anthropic?{max_tokens:16}:{})})});
          if(!response.ok)throw Error('MODEL_UNAVAILABLE');const reply=await response.json();
          if(anthropic?!reply.content?.some(row=>row.type==='text'&&row.text):!reply.choices?.[0]?.message?.content)throw Error('MODEL_UNAVAILABLE');
          return {available:true};
        } finally {state.modelSwitching=previous;updateComposer();}
      }
      if (native) return nativeCall('phone.models.' + action, p);
      if (action === 'list') return { models: serviceDirectory.services.flatMap(service=>service.models.map(model=>({source:'phone',endpoint:service.baseUrl,serviceId:service.serviceId,modelId:model.modelId,displayName:model.name,selected:serviceDirectory.selected?.serviceId===service.serviceId&&serviceDirectory.selected?.modelId===model.modelId}))),selected:modelServices?.selectedView(),services:serviceDirectory.services };
      if (action === 'configure') {
        if(modelServices){const result=await serviceCall('configure',p);return result.model;}
        const url = new URL(p.endpoint); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('INVALID_REQUEST');
        const apiKey = p.apiKey || (memoryModel?.baseUrl === p.endpoint ? memoryModel.apiKey : '');
        if (!apiKey || !p.modelId) throw Error('MODEL_NOT_CONFIGURED');
        memoryModel = { baseUrl: p.endpoint.replace(/\/$/, ''), modelId: p.modelId, apiKey, displayName: p.displayName || p.modelId }; return modelView(memoryModel);
      }
      if (action === 'remove') { if(modelServices){const service=serviceDirectory.services.find(row=>row.serviceId===p.serviceId||row.baseUrl===p.endpoint);if(service)return serviceCall('remove',{serviceId:service.serviceId});}memoryModel = null; state.model = null; return {}; }
      if(action==='select'&&modelServices){const service=serviceDirectory.services.find(row=>row.serviceId===p.serviceId||row.baseUrl===p.endpoint);return serviceCall('select',{serviceId:service.serviceId,modelId:p.modelId});}
      return modelServices?.selectedView()||modelView(memoryModel);
    }
    throw Error('HOST_UNAVAILABLE');
  }
  const api = globalThis.WeftPhone = {
    // Compose uses the existing account engine as its state service. Secrets and
    // completion transport remain in the phone bridge; this is presentation only.
    presentation: async (action, p = {}) => {
      let sent=true;
      const authBusy=!!globalThis.WeftMobileCloud?.core?.cloudAuthView?.()?.busy;
      if (!state.booted || !state.loggedIn || !engine || !account) return { ready: false, authBusy };
      if (p.owner && p.owner !== sessionKey) throw Error('ACCOUNT_SWITCHED');
      if (action === 'model') state.model = await nativeCall('phone.models.select', p);
      else if (action === 'composer') await engine.saveComposer(p.conversationId || null, p.draft || '');
      else if (action === 'send' || action === 'regenerate') {
        if (!api.active) throw Error('HOST_AVAILABLE');
        const reason=sendBlocker(action==='send'?String(p.text||''):'重新生成', action==='send');
        if(reason){nativeError=reason;sent=false;}
        else {
          state.conversationId = p.conversationId || null;
          if (action === 'send') {
            const receipt = await engine.enqueue(p.text, state.conversationId, uiCore.messageModePreference());
            state.conversationId = receipt.conversationId;
          } else void run(() => engine.regenerate(state.conversationId));
        }
      } else if (action === 'stop') engine.stop();
      else if (action !== 'view') throw Error('INVALID_REQUEST');
      const value = engine.view();
      return { ready: true, active: api.active, authBusy, owner: sessionKey, page: state.page, selectedId: state.conversationId,
        running: value.running, activeConversationId:value.activeConversationId, pendingMessages:value.pendingMessages, messageMode:uiCore.messageModePreference(), sent, modelSwitching:!!state.modelSwitching, conversations: value.conversations, composer: value.nativeComposer || null, drafts: value.nativeDrafts || {}, error: value.queueError || nativeError };
    },
    ensureAccount: async info => {if(sessionKey&&sessionKey!==`${info.origin}:${info.accountId}`)await api.clear();},
    modelCall: (method,p={})=>routeCall(method,p),
    servicesView:()=>serviceDirectory,refreshServices:params=>serviceCall('refresh',params),selectServiceModel:item=>serviceCall('select',item),serviceCall,openModelMenu,catalogMessage,
    get memory(){return engine?.view().phoneMemory;},get handover(){return engine?.view().handover;},
    get memoryPending(){return !!engine?.view().phoneMemory&&!engine.view().phoneMemory.transferred;},
    memoryChange:(...args)=>engine.memoryChange(...args),confirmHandover:async()=>{await engine.memoryChange('confirm-handover');await connected();},
    flushMemory:id=>engine?.extractMemory(id||state.conversationId),
    removeConversation:async id=>{await engine.removeConversation(id);if(state.conversationId===id)selectConversation(null);show();if(!api.active)await connected();},
    get active() { return state.connection === 'phone' && !!engine; }, get hasData() { return !!data(); }, owns: id => !!data()?.conversations.some(c=>c.id===id), list, start, connected, routeCall, render,
    sendBlocker,
    restoreArchive: async (info, client) => { if (engine) return; try {const identity=window.weftNative?await nativeCall('phone.identity'):info;if(!identity?.accountId)return;await attachEngine(identity,client,false);} catch {} },
    event: value => { if (value.event === 'phone.progress') { progress?.(value.data.text); return true; } return false; },
    send: () => { const text = $('draft').value.trim(), reason=sendBlocker(text); if(reason){toast(reason);updateComposer();return {sent:false,reason};} $('draft').value = ''; return run(() => engine.send(text, state.conversationId)); },
    stop: () => engine?.stop(),
    clear: async () => { clearInterval(poll);clearTimeout(memoryTimer); const previous = engine, hadArchive = archive; engine = null; archive = null; modelServices?.clear();modelServices=null;serviceDirectory={services:[],selected:null};nativeServices=false;memoryModel = null; account = null; sessionKey = null; state.model = null; nativeError='';
      uiCore.phoneAccountConnection(false); if (previous) { previous.close(); } else if (hadArchive && window.weftNative) await nativeCall('phone.offline.clear'); },
    empty(target, name) {
      if(name==='memory')return WeftPhoneMemoryView(target);
      const copy = { activity: '助手的回复、提醒和完成的事情会出现在这里。连上电脑后可使用定时任务。',
        health: `这里显示来自 iPhone 或 Apple Watch 的健康数据。接上之后会出现在这里；${window.weftNative?'安卓目前不采集健康数据':'手机网页不直接采集健康数据'}。`,
        goals: '你想长期推进的目标会出现在这里。连上电脑后可添加目标和定时任务。',
        library: '对话中生成的文件和成果会出现在这里。连上电脑后可查看电脑上的成果。',
        memory: '连上电脑后，WeftMate 才会从对话中整理记忆。手机上的对话会保留。' };
      const icon=el('span','empty-state-icon');icon.append(WeftIcons.create({health:'health',activity:'bell',goals:'goal',library:'folder',memory:'memory'}[name]||'device',32));
      target.replaceChildren(heading(mobilePageNames[name] || mobileSettingsRegistry.get(name)?.name || (name==='memory'?'记忆':'设置')), icon,notice(copy[name] || '连上电脑后可用。'), action('怎么连上电脑', () => page('devices'), false));
    },
  };
document.addEventListener('visibilitychange',()=>{clearTimeout(memoryTimer);void engine?.extractMemory(state.conversationId);});
  globalThis.addEventListener?.('pagehide',()=>void engine?.extractMemory(state.conversationId));
})();
