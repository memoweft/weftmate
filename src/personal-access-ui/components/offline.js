/* Shared phone offline presentation. Data and transport stay in WeftOffline. */
(() => {
  const element = (tag, text, className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
  const explanation = '电脑离线，可以继续聊，也可以记下要做的事，等电脑上线后去做';
  globalThis.WeftOfflineView = {
    syncFailure(cause) {
      const code = cause?.code || cause?.message;
      if (['UNAUTHORIZED', 'DEVICE_NOT_TRUSTED', 'OFFLINE_RESET_REQUIRED'].includes(code) || cause?.status === 401)
        return { unreachable: false, clear: true, message: '设备授权已失效，请重新登录并连接电脑。' };
      if (['NETWORK', 'HOST_UNAVAILABLE', 'HOST_OFFLINE'].includes(code))
        return { unreachable: true, message: '电脑暂时无法连接，可打开离线对话。' };
      return { unreachable: false, message: ({ OFFLINE_MODEL_REQUIRED: '请先在电脑配置一个云模型。',
        OFFLINE_CLOUD_REQUIRED: '请先绑定云账户并批准这台设备。',
        FORBIDDEN: '离线副本同步没有权限，请重新连接电脑。',
        INVALID_REQUEST: '离线副本同步未完成，请重新连接电脑。' })[code] || '离线副本同步未完成，请稍后重试。' };
    },
    mount({ core, goalsCore=core, nativeCall, nativeTaskVault = false, identity: readIdentity, host, desktop = false, openConversation = () => {}, onMemoryReplicaChanged = () => {} }) {
      if (desktop) return;
      let engine, scope, identity, polling = false, offline = false, selected = null, error = '', showHistory = false, taskMode=false;
      goalsCore.offlineMemoryReplica = () => identity?.ownerId === core.state.ownerId ? engine?.view().snapshot ?? null : null;
      let memoryReplica;
      const section = element('section', '', 'offline-chat'); section.hidden = true; section.setAttribute('aria-label', '离线对话');
      const header = element('header'), title = element('h1', '离线模式'), mode = element('p', explanation);
      const close = element('button', '返回'), fresh = element('button', '新对话'); close.type = fresh.type = 'button';
      const selector = element('select'); selector.setAttribute('aria-label', '离线对话列表');
      const referencePicker=element('div','','offline-reference');referencePicker.append(selector);
      header.append(close, title, fresh, mode, referencePicker);
      const messages = element('div', '', 'offline-messages'); messages.setAttribute('role', 'log'); messages.setAttribute('aria-live', 'polite');
      const form = element('form', '', 'offline-composer'), label = element('label', explanation), input = element('textarea');
      input.rows = 2; input.maxLength = 16384; input.placeholder = '继续聊聊…'; input.setAttribute('aria-label', '离线消息'); label.append(input);
      const status = element('p'); status.setAttribute('role', 'status');
      const send = element('button', '发送'); send.type = 'submit'; form.append(label, status, send); section.append(header, messages, form);
      const more=element('button','','composer-icon');more.type='button';more.setAttribute('aria-label','更多发送方式');more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded','false');
      if(globalThis.WeftIcons)more.append(WeftIcons.create('plus',16));else more.textContent='+';
      form.append(more);
      let targetHostId;
      more.addEventListener('click',()=>{
        const targets=engine?.view().targets||[],hosts=core.state?.cloudAuth?.hosts||[];
        const choices=(hosts.length>1?hosts:targets.map(target=>({hostId:target.control.hostId,name:hosts.find(h=>h.hostId===target.control.hostId)?.name||'这台电脑'}))).slice().sort((a,b)=>Number(b.hostId===targetHostId)-Number(a.hostId===targetHostId));
        const entries=choices.length>1?choices.map(target=>({name:`交给${target.displayName||target.name||'这台电脑'}，上线后做`,checked:taskMode&&targetHostId===target.hostId,disabled:!targets.some(t=>t.control.hostId===target.hostId),...(!targets.some(t=>t.control.hostId===target.hostId)?{description:'先在线连接这台电脑一次'}:{}),action:()=>{targetHostId=target.hostId;if(targetHostId!==identity.hostId)selected=null;taskMode=true;paint();input.focus();}})):[{name:'交给电脑，上线后做',checked:taskMode,disabled:!engine?.view().taskReady,action:()=>{targetHostId=identity.hostId;taskMode=true;paint();input.focus();}}];
        WeftPopover.menu(more,[{name:'继续聊聊',checked:!taskMode,disabled:engine?.view().chatReady===false,action:()=>{taskMode=false;paint();}},...(engine?.view().taskReady?entries:[])]);
      });
      const launcher = element('button', '离线对话', 'offline-launcher'); launcher.hidden = true; launcher.type = 'button';
      const notice = element('p', '', 'offline-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
      // The conversation's scroll area owns this content. It is never a fixed
      // overlay above approvals, settings, project dialogs or device actions.
      (document.getElementById?.('chat-scroll') || document.body).append(section);
      document.body.append(launcher);
      (document.getElementById?.('chat-scroll') || document.body).append(notice);
      function paint() {
        const view = engine?.view();
        const replica=goalsCore.offlineMemoryReplica();
        if(replica!==memoryReplica){memoryReplica=replica;onMemoryReplicaChanged();}
        if(!view?.taskReady)taskMode=false;
        const scrollTop=messages.scrollTop||0,atBottom=messages.scrollHeight-messages.clientHeight-scrollTop<8;
        if (core.connectionView) {const kind=core.connectionView().kind;offline=kind==='host_offline'||kind==='connecting'&&offline;}
        launcher.hidden = core.connectionView ? true : !offline && !view?.conversations.length;
        launcher.textContent = offline ? '离线模式' : view?.turns.length ? '离线对话 · 待同步' : '离线对话 · 已同步';
        // Polling updates availability, never navigation. Only the user's launcher
        // action opens this page, so pending approvals and settings stay usable.
        section.hidden = !(view && showHistory);
        document.body.classList?.toggle?.('offline-history-open',!section.hidden);
        const idleCloudSetup = error === WeftOfflineView.syncFailure({code:'OFFLINE_CLOUD_REQUIRED'}).message && !view?.turns.length && !view?.tasks?.length;
        notice.textContent = error; notice.hidden = !error || idleCloudSetup || showHistory || !!core.connectionView && core.connectionView().kind !== 'online';
        title.textContent = offline ? '离线模式' : '离线对话';
        mode.textContent = offline ? view?.taskReady?(view.chatReady?explanation:'电脑离线，可以先记下要做的事，等电脑上线后去做。'):'电脑离线，可以继续聊天和使用记忆。' : view?.turns.length ? '电脑已上线，正在同步离线对话' : '已同步';
        if(taskMode&&!offline)mode.textContent='先记下要做的事，电脑收到后会去做。';
        label.firstChild.textContent = taskMode?'要交代什么？':offline?'继续聊聊':'电脑已上线，可返回原对话查看进展';
        input.placeholder=taskMode?'等电脑上线后，要去做什么？':'继续聊聊…';
        input.disabled = !offline&&!taskMode || !(taskMode?view?.taskReady:view?.chatReady??view?.ready) || view.running;
        send.disabled = input.disabled || !input.value.trim();
        if(taskMode&&input.value.length>8192)send.disabled=true;
        more.disabled=!!view?.running||!view?.ready;more.hidden=!view?.ready;
        send.textContent=taskMode?'记下来':'发送';input.maxLength=taskMode?8192:16384;
        status.textContent = error || (view?.running ? '正在回复…' : view?.turns.length ? '电脑上线后自动同步' : '');
        if(taskMode&&!error)status.textContent=view?.taskSending?'正在记下来…':'记下来，等电脑上线后去做';
        if(taskMode&&input.value.length>8192)status.textContent='这件事太长了，请缩短到 8,192 字以内。';
        const options = (view?.conversations || []).map(c => {
          const option = element('option', c.turns[0]?.messages[0]?.text.slice(0, 24) || '新对话'); option.value = c.id; return option;
        });
        for (const recent of view?.snapshot?.recent || []) {
          const option = element('option', '最近对话 · ' + (recent.messages.find(m => m.role === 'user')?.text.slice(0, 20) || '继续聊'));
          option.value = 'recent:' + recent.id; options.push(option);
        }
        for(const reference of view?.taskReady?view.snapshot.taskReferences||[]:[]){if(view.snapshot.recent?.some(c=>c.id===reference.id))continue;const option=element('option','电脑对话 · '+reference.title);option.value='recent:'+reference.id;options.push(option);}
        selector.replaceChildren(element('option', '新对话'), ...options); selector.options[0].value = ''; selector.value = selected || '';
        referencePicker.hidden=taskMode&&targetHostId!==identity.hostId;
        const conversation = view?.conversations.find(c => c.id === selected);
        const recent = selected?.startsWith('recent:') ? view?.snapshot?.recent?.find(c => c.id === selected.slice(7)) : null;
        messages.replaceChildren();
        if (!conversation?.turns.length && !recent) messages.append(element('p',view?.chatReady?'可以继续聊聊。与当前问题相关的记忆会帮助回答。':'先告诉我要做什么，电脑上线后会去做。','offline-empty'));
        const rows = [...(recent?.messages || conversation?.context || []), ...(conversation?.turns || []).flatMap(t => t.messages)];
        const renderedTasks=new Set(),taskNames={sending:'还没确认记下，请重试',waiting:'排队中，等电脑上线',claimed:'排队中，等电脑上线',received:'已交给电脑，等待开始',started:'电脑已开始',completed:'做完了',failed:'没做成',expired:'过期了，没做',canceled:'已取消'};
        function cancellation(row,task){
          if(!['waiting','claimed'].includes(task.state))return;
          const cancel=element('button','取消这件事');cancel.type='button';
          cancel.onclick=()=>WeftPopover.menu(cancel,[{name:'确认取消',action:async()=>{
            try{await goalsCore.cancelOfflineTask(task.id);error='';}catch(cause){error=cause.userMessage||'取消未完成，请检查网络后重试。';}paint();
          }}]);row.append(cancel);
        }
        for (const message of rows) {
          if(typeof message.text!=='string'||!message.text.trim())continue;
          const row = element('article', '', `offline-message ${message.role}`);
          const body = globalThis.WeftContent ? WeftContent.create(message.text, 'offline-message-body markdown-body') : element('div', message.text, 'offline-message-body');
          if (!globalThis.WeftContent && message.role === 'assistant' && globalThis.WeftFormat?.render) body.innerHTML = globalThis.WeftFormat.render(message.text);
          row.append(element('span', message.role === 'user' ? '我' : 'WeftMate'), body);
          const task=message.offlineTaskId&&view?.tasks?.find(t=>t.id===message.offlineTaskId);if(task){renderedTasks.add(task.id);row.append(element('p',taskNames[task.state]||'正在确认','offline-task-state'));cancellation(row,task);}
          messages.append(row);
        }
        for(const task of view?.tasks||[]){
          if(task.conversationId!==(selected||'tasks')||renderedTasks.has(task.id))continue;
          const row=element('article','','offline-message user'),body=element('div',task.text,'offline-message-body');
          row.append(element('span','我'),body,element('p',task.state==='sending'&&view?.taskSending?'正在记下来…':taskNames[task.state]||'正在确认','offline-task-state'));
          if(task.state==='sending'){const retry=element('button','重试');retry.type='button';retry.disabled=view?.taskSending;retry.onclick=async()=>{retry.disabled=true;try{await engine.retryTask(task.id);}catch{error='还没确认记下，请稍后重试。';paint();}finally{retry.disabled=false;}};row.append(retry);}
          cancellation(row,task);
          messages.append(row);
        }
        for (const turn of conversation?.turns || []) if (turn.workRequest?.status === 'pending') {
          const card = element('section', '', 'work-switch-card'); card.setAttribute('aria-label', '切换到工作');
          card.append(element('h3', '这件事需要在电脑上做。要切换到工作吗？'), element('p', '需要一台在线的电脑', 'muted'));
          const actions = element('div', '', 'work-switch-actions');
          const later = element('button', '先不用', 'button secondary'); later.type = 'button'; later.onclick = () => engine.declineWork(turn.id);
          actions.append(later);
          if (view.taskReady) { const queue = element('button', '交给电脑，上线后做', 'button primary'); queue.type = 'button';
            queue.onclick = () => { taskMode = true; input.value = turn.workRequest.text; paint(); input.focus(); }; actions.append(queue); }
          card.append(actions); messages.append(card);
        }
        messages.scrollTop=atBottom?messages.scrollHeight:scrollTop;
      }
      async function start(current) {
        const next = JSON.stringify([current.origin, current.ownerId]);
        if (scope === next) { Object.assign(identity, current); return; }
        if (engine) { if(identity?.hostId===current.hostId&&identity?.ownerId!==current.ownerId)await engine.clear();engine.close(); }
        scope = next; identity = current;
        offline = false; showHistory = false; error = '';
        const vault = nativeCall ? WeftOffline.nativeVault(nativeCall, { tasks: nativeTaskVault }) : await WeftOffline.browserVault(scope);
        engine = await WeftOffline.create({ vault, identity, host, workRequests: !nativeCall, control: hostId => core.cloudOfflineStatus(hostId),
          tasks:core.cloudOfflineTasks,taskDevice:core.cloudOfflineTaskDevice,notify:()=>{paint();goalsCore.offlineTasksChanged?.();} });
        targetHostId=engine.view().tasks.at(-1)?.hostId||current.hostId;
        if(engine.view().taskReady&&!engine.view().chatReady)taskMode=true;
        goalsCore.offlineTasksView=()=>engine?.view().taskReady?engine.view().tasks:[];
        goalsCore.refreshOfflineTasks=()=>engine?.refreshTasks();
        goalsCore.cancelOfflineTask=async id=>{try{return await engine?.cancelTask(id);}catch(cause){if(cause.code==='TASK_ALREADY_RECEIVED'){await engine?.refreshTasks();throw Object.assign(new Error('电脑已接收这件事，请打开原对话后停止。'),{code:'TASK_ALREADY_RECEIVED',userMessage:'电脑已接收这件事，请打开原对话后停止。'});}throw cause;}};
        goalsCore.openOfflineTask=task=>{selected=task.conversationId==='tasks'?null:task.conversationId;open();};
        selected = engine.view().conversations.at(-1)?.id || null;
        if (!nativeCall) localStorage.setItem('weftmate-offline-identity', JSON.stringify(current));
      }
      async function tick() {
        if (core.state?.cloudAuth?.cloudOnly || polling || document.visibilityState === 'hidden' || !core.foreground()) return;
        polling = true;
        try {
          const connectedIdentity = await readIdentity();
          let current = connectedIdentity;
          if (!current && !nativeCall) { try { current = JSON.parse(localStorage.getItem('weftmate-offline-identity')); } catch {} }
          if (!current?.ownerId || !current.hostId || current.hostId === 'unconnected' || !current.deviceId) return;
          await start(current);
          // A cached identity permits cloud-only use while host login restores.
          // Sending a replica request before that login would turn a transient
          // missing host Cookie into an irreversible deletion of accepted tasks.
          try { const wasOffline=offline;if (connectedIdentity ? await engine.sync() : (await engine.check(),false)) { offline = false; error = '';if(engine.view().taskReady&&!engine.view().chatReady){taskMode=true;targetHostId||=identity.hostId;} if(wasOffline&&core.connectionView&&!engine.view().running&&!engine.view().turns.length)showHistory=false; } }
          catch (cause) {
            const failure = globalThis.WeftOfflineView.syncFailure(cause);
            // A replica request can time out while the host still serves tasks.
            // Confirm transport loss separately before offering offline mode.
            if ((cause.code || cause.message) === 'NETWORK') {
              try { await core.accessApi('/status'); failure.unreachable = false; failure.message = '离线副本同步未完成，请稍后重试。'; }
              catch (probeError) { Object.assign(failure, globalThis.WeftOfflineView.syncFailure(probeError)); }
            }
            offline = core.connectionView ? core.connectionView().kind === 'host_offline'||core.connectionView().kind==='connecting'&&offline : failure.unreachable; error = failure.message;
            if (failure.clear) { showHistory = false; await engine.clear(); }
            else if (offline && engine.view().ready) {
              try { await engine.check();error=''; }
              catch (checkError) { const authorization = globalThis.WeftOfflineView.syncFailure(checkError);
                if (authorization.clear) { offline = false; showHistory = false; }
                error = '暂时无法核对设备授权，请联网后重试。'; }
            } else if (offline) error = '尚未同步离线副本，请在电脑在线时连接一次。';
          }
          await engine.refreshTasks?.().catch(()=>{});
          paint();
        } finally { polling = false; }
      }
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (!engine || send.disabled) return;
        error = ''; const text = input.value; input.value = ''; paint();
        try { if(taskMode){await engine.submitTask(text,selected,targetHostId);taskMode=false;}else{const result = await engine.send(text, selected); selected = result.conversationId;} }
        catch (cause) { error = (cause.code || cause.message) === 'OFFLINE_RESET_REQUIRED'
          ? '内容已清理，电脑上线后会重新读取。' : taskMode?'还没确认记下，请检查网络后重试。':'回复未完成，请检查网络或模型配置后重试。'; }
        paint(); messages.scrollTop = messages.scrollHeight;
      });
      input.addEventListener('input', () => { send.disabled = !input.value.trim() || engine?.view().running || taskMode&&input.value.length>8192;if(taskMode)status.textContent=input.value.length>8192?'这件事太长了，请缩短到 8,192 字以内。':'记下来，等电脑上线后去做'; });
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
      selector.addEventListener('change', () => { selected = selector.value || null; paint(); });
      fresh.addEventListener('click', () => { selected = null; paint(); input.focus(); });
      close.addEventListener('click', () => { showHistory = false; paint(); });
      const open = () => { if(typeof CustomEvent==='function')document.dispatchEvent?.(new CustomEvent('weftmate:fixed-page',{detail:'chat'}));openConversation(); showHistory = true; paint(); section.scrollIntoView?.({ block: 'start' }); input.focus(); };
      launcher.addEventListener('click', open);
      core.openOfflineMode = open;
      core.offlineWorkReady = () => engine?.view().taskReady === true;
      core.openOfflineWorkMode = text => { if (!core.offlineWorkReady()) return;taskMode=true;input.value=text;open();paint(); };
      core.offlineConnectionRestored = tick;
      const unsubscribe = core.observeConnection?.(value => {if(value.kind==='online'&&offline)showHistory=false;paint();if(value.kind==='online')void tick().catch(()=>{});});
      for(const name of ['selectSession','selectMainChat'])if(core[name]){const original=core[name];core[name]=(...args)=>{showHistory=false;paint();return original(...args);};}
      document.addEventListener('visibilitychange', () => void tick());
      const timer = setInterval(() => void tick().catch(() => {}), 15000);
      void tick().catch(() => {});
      const originalLogout = core.cloudLogout;
      core.clearOfflineData = async () => {showHistory=false;offline=false;error='';await engine?.clear();paint();};
      if (originalLogout) core.cloudLogout = async (...args) => { showHistory = false; offline = false; error = ''; await engine?.clearTasks(); paint(); if (!nativeCall) localStorage.removeItem('weftmate-offline-identity'); return originalLogout(...args); };
      return { tick, close: () => { unsubscribe?.();clearInterval(timer); engine?.close(); section.remove(); launcher.remove(); notice.remove(); document.body.classList?.remove?.('offline-history-open'); } };
    },
  };
})();
