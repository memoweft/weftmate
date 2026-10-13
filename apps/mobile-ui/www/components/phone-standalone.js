/* The existing phone UI presents account-owned M3 conversations in its main chat. */
(() => {
  let engine, account, cloud, native, sessionKey, memoryModel, progress, poll, archive, handoffNotice=false, nativeError='';
  const data = () => engine?.view() || archive;
  const list = () => (data()?.conversations || []).map(c => ({ id: c.id, createdAt: new Date(c.turns[0]?.timestamp || Date.now()).toISOString(), title: c.turns[0]?.messages[0]?.text.slice(0, 40) || '新对话', source: 'phone' }));
  const nativeCall = (...args) => androidBridge.call(...args);
  const modelView = model => model && { source: 'phone', endpoint: model.baseUrl, modelId: model.modelId, displayName: model.displayName || model.modelId };
  const currentModel = () => native ? state.model && { modelId: state.model.modelId, baseUrl: state.model.endpoint } : memoryModel;
  const sendBlocker = text => !engine ? '正在打开对话，请稍候再发送。'
    : !state.model ? '先在设置里添加一个模型，再开始聊天。'
    : state.modelSwitching ? '正在测试或切换模型，请稍候再发送。'
    : engine.view().running ? '当前回复还在进行，请先停止或等待。'
    : !text.trim() ? '先输入消息。'
    : text.trim().length>16384 ? '消息过长，请缩短后发送。' : '';
  const show = () => {
    if (!engine) return;
    const value = engine.view(); state.busy = value.running;
    state.conversations = value.conversations.map(c => ({ id: c.id, createdAt:new Date(c.turns[0]?.timestamp||Date.now()).toISOString(), title: c.turns[0]?.messages[0]?.text.slice(0, 40) || '新对话', source: 'phone' }));
    if (!state.conversationId && value.running) state.conversationId = value.conversations.at(-1)?.id || null;
    renderConversationList(); if (state.page === 'chat' && state.chatSource === 'phone') render(); updateComposer();
  };
  function render() {
    const content = $('chat-content'); clear(content);
    const conversation = data()?.conversations.find(c => c.id === state.conversationId);
    if (!conversation?.turns.length) { showWelcome(); return; }
    for (const turn of conversation.turns) for (const message of turn.messages) content.append(messageNode(message.role, message.text));
    const last = conversation.turns.at(-1);
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
    finally { show(); }
  }
  async function attachEngine(info, client, adopt = true) {
    native = !!window.weftNative; cloud = client;
    const next = `${info.origin}:${info.accountId}`;
    if (sessionKey !== next) {
      if (engine) { const previous=engine;engine=null;await previous.clear(); previous.close(); }
      sessionKey = next; account = info; memoryModel = null;
      if (native && adopt) await nativeCall('phone.adopt', info);
      const phoneScope={accountId:info.accountId,origin:info.origin};
      const vault = native ? {
        key: () => nativeCall('phone.offline.key'), load: () => nativeCall('phone.offline.load'),
        save: value => nativeCall('phone.offline.save', { value }), clear: () => nativeCall('phone.offline.clear',phoneScope), close() {},
        open: (envelope, identity) => nativeCall('phone.offline.open', { envelope, identity }),
        complete: async (body, _snapshot, signal, onProgress) => {
          if(signal.aborted)throw new DOMException('CANCELLED','AbortError');
          progress = onProgress; const stop = () => void nativeCall('phone.stop'); signal.addEventListener('abort', stop, { once: true });
          try { return await nativeCall('phone.complete', { body }, 180000); }
          finally { progress = null; signal.removeEventListener('abort', stop); }
        },
      } : await WeftOffline.browserVault('phone:' + next);
      const complete = vault.complete.bind(vault);
      vault.complete = (body, snapshot, signal, onProgress) => complete(body, native ? snapshot : { ...snapshot, model: memoryModel }, signal, onProgress);
      engine = await WeftOffline.create({ vault, identity: info, phoneModel: currentModel,
        accountCheck: async () => {
          const directory = await client.authorized('/devices');
          if (!directory.devices.some(d => d.isCurrent && !d.revoked)) { await engine.clear(); throw Error('DEVICE_NOT_TRUSTED'); }
          return directory;
        }, control: id => client.authorized('/hosts/offline/status', { method: 'POST', body: { hostId: id } }),
        host: (path, body) => WeftMobileCloud.core.accessApi(path, { method: 'POST', body, protectedWrite: true }), notify: show });
    }
  }
  async function start(info, client) {
    await attachEngine(info,client);
    const next = `${info.origin}:${info.accountId}`;
    if (native) state.model = (await nativeCall('phone.models.list')).selected;
    else state.model = modelView(memoryModel);
    state.authEpoch++; state.loggedIn = true; state.owner = native ? (await nativeCall('app.bootstrap')).owner : next; state.username = info.email; state.deviceId = info.deviceId;
    state.connection = 'phone'; uiCore.phoneAccountConnection(true); state.transitionPending = false; state.chatSource = 'phone'; state.logicalChats = false;
    state.conversationId = engine.view().conversations.at(-1)?.id || null;
    state.profile = { displayName: info.email, phoneOnly: true };
    uiCore.stopConnection(); document.body.classList.remove('cloud-auth-active'); $('cloud-auth-page').classList.remove('active');
    showProfile(state.profile); page('chat'); show();
    if (native) { await syncAccountAppearance(); await nativeCall('app.ready', { owner: (await nativeCall('app.bootstrap')).owner, hasDraft: false }); }
    clearInterval(poll); poll = setInterval(() => void connect().catch(() => {}), 15000);
  }
  async function connect() {
    if (!state.loggedIn || engine?.view().running || document.visibilityState === 'hidden') return;
    if (!api.active) { if (engine?.view().turns.length) await connected(); return; }
    const directory = await cloud.authorized('/devices');
    if (directory.hosts?.some(h => h.status === 'online' || h.online === true)) await WeftMobileCloud.core.resumePhoneComputer();
  }
  async function connected() {
    if (!engine || !account) return;
    uiCore.phoneAccountConnection(false);
    const identity = await (native ? nativeCall('offline.identity') : WeftMobileCloud.core.cloudOfflineIdentity());
    if (!identity?.hostId || identity.hostId === 'unconnected') return;
    // Keep this account's vault and stable turn IDs while adopting the computer identity.
    Object.assign(account, identity);
    try { do { await engine.sync(); } while (engine.view().turns.length); handoffNotice=false; clearInterval(poll); }
    catch { if(!handoffNotice){handoffNotice=true;toast('手机对话仍在这里，连上电脑后会继续处理。');} }
  }
  async function routeCall(method, p) {
    if(native&&(method.startsWith("voice.")||method.startsWith("diagnostics.")))return nativeCall(method,p);
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
          if(!memoryModel)throw Error('MODEL_NOT_CONFIGURED');
          const response=await fetch(memoryModel.baseUrl+'/chat/completions',{method:'POST',redirect:'error',cache:'no-store',
            headers:{'content-type':'application/json',authorization:`Bearer ${memoryModel.apiKey}`},
            body:JSON.stringify({model:memoryModel.modelId,messages:[{role:'user',content:'只回复 OK'}]})});
          if(!response.ok||!(await response.json()).choices?.[0]?.message?.content)throw Error('MODEL_UNAVAILABLE');
          return {available:true};
        } finally {state.modelSwitching=previous;updateComposer();}
      }
      if (native) return nativeCall('phone.models.' + action, p);
      if (action === 'list') return { models: memoryModel ? [{ ...modelView(memoryModel), selected: true }] : [] };
      if (action === 'configure') {
        const url = new URL(p.endpoint); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('INVALID_REQUEST');
        const apiKey = p.apiKey || (memoryModel?.baseUrl === p.endpoint ? memoryModel.apiKey : '');
        if (!apiKey || !p.modelId) throw Error('MODEL_NOT_CONFIGURED');
        memoryModel = { baseUrl: p.endpoint.replace(/\/$/, ''), modelId: p.modelId, apiKey, displayName: p.displayName || p.modelId }; return modelView(memoryModel);
      }
      if (action === 'remove') { memoryModel = null; state.model = null; return {}; }
      return modelView(memoryModel);
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
        const reason=sendBlocker(action==='send'?String(p.text||''):'重新生成');
        if(reason){nativeError=reason;sent=false;}
        else {
          state.conversationId = p.conversationId || null;
          void run(() => action === 'send' ? engine.send(p.text, state.conversationId) : engine.regenerate(state.conversationId));
        }
      } else if (action === 'stop') engine.stop();
      else if (action !== 'view') throw Error('INVALID_REQUEST');
      const value = engine.view();
      return { ready: true, active: api.active, authBusy, owner: sessionKey, page: state.page, selectedId: state.conversationId,
        running: value.running, sent, modelSwitching:!!state.modelSwitching, conversations: value.conversations, composer: value.nativeComposer || null, drafts: value.nativeDrafts || {}, error: nativeError };
    },
    ensureAccount: async info => {if(sessionKey&&sessionKey!==`${info.origin}:${info.accountId}`)await api.clear();},
    modelCall: (method,p={})=>routeCall(method,p),
    get active() { return state.connection === 'phone' && !!engine; }, get hasData() { return !!data(); }, owns: id => !!data()?.conversations.some(c=>c.id===id), list, start, connected, routeCall, render,
    sendBlocker,
    restoreArchive: async (info, client) => { if (engine) return; try {const identity=window.weftNative?await nativeCall('phone.identity'):info;if(!identity?.accountId)return;await attachEngine(identity,client,false);} catch {} },
    event: value => { if (value.event === 'phone.progress') { progress?.(value.data.text); return true; } return false; },
    send: () => { const text = $('draft').value.trim(), reason=sendBlocker(text); if(reason){toast(reason);updateComposer();return {sent:false,reason};} $('draft').value = ''; return run(() => engine.send(text, state.conversationId)); },
    stop: () => engine?.stop(),
    clear: async () => { clearInterval(poll); const previous = engine, hadArchive = archive; engine = null; archive = null; memoryModel = null; account = null; sessionKey = null; state.model = null; nativeError='';
      uiCore.phoneAccountConnection(false); if (previous) { await previous.clear(); previous.close(); } else if (hadArchive && window.weftNative) await nativeCall('phone.offline.clear'); },
    empty(target, name) {
      const copy = { activity: '助手的回复、提醒和完成的事情会出现在这里。连上电脑后可使用定时任务。',
        health: `这里显示来自 iPhone 或 Apple Watch 的健康数据。接上之后会出现在这里；${window.weftNative?'安卓目前不采集健康数据':'手机网页不直接采集健康数据'}。`,
        goals: '你想长期推进的目标会出现在这里。连上电脑后可添加目标和定时任务。',
        library: '对话中生成的文件和成果会出现在这里。连上电脑后可查看电脑上的成果。',
        memory: '连上电脑后，WeftMate 才会从对话中整理记忆。手机上的对话会保留。' };
      const icon=el('span','empty-state-icon');icon.append(WeftIcons.create({health:'health',activity:'bell',goals:'approval',library:'folder',memory:'memory'}[name]||'device',32));
      target.replaceChildren(heading(mobilePageNames[name] || mobileSettingsRegistry.get(name)?.name || (name==='memory'?'记忆':'设置')), icon,notice(copy[name] || '连上电脑后可用。'), action('怎么连上电脑', () => page('devices'), false));
    },
  };
})();
