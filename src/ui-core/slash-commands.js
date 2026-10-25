/* Session-scoped DSH discovery and execution; skills remain native prompt references. */
globalThis.WeftUiCore.factories.slashCommands=(core,effects,environment)=>{
  const scope=()=>`${core.state.ownerId}/${core.state.identityGeneration}/${core.state.selectedSessionId}/${core.state.newConversationId}`;
  let pending;
  async function ensureSlashSession() {
    if(core.state.selectedSessionId) return core.state.selectedSessionId;
    if(pending) return pending;
    const identity=core.state.identityGeneration,owner=core.state.ownerId,draft=core.state.newConversationId;
    pending=(async()=>{
      if(core.supportsChat?.('sideChats') && core.state.mainChat && core.state.newConversationMode!=='work' && !core.state.newConversationProjectId) await core.openSideChat({entry:'composer',...(core.state.newConversationTemporary?{temporary:true}:{})});
      else {
        let result;
        const requestId=environment.crypto.randomUUID();
        core.creatingOptimisticSession=true;
        try {
          result=await core.submitCommand('session.create',{modelProfileId:core.state.modelProfileId,...(core.state.newConversationTemporary?{temporary:true}:{})},null,requestId);
          for(let n=0;n<180 && ['pending','dispatching','preflight'].includes(result?.state);n++) {
            await new Promise(resolve=>setTimeout(resolve,250));
            if(identity!==core.state.identityGeneration || owner!==core.state.ownerId || draft!==core.state.newConversationId || core.state.selectedSessionId)return null;
            result=(await core.accessApi(`/commands/by-request/${encodeURIComponent(requestId)}`)).command;
            core.updateFromCommand(result);
          }
        }
        finally {core.creatingOptimisticSession=false}
        if(identity!==core.state.identityGeneration || owner!==core.state.ownerId || draft!==core.state.newConversationId) return null;
        if(result?.state!=='accepted_by_dsh' || !result.sessionId) throw {code:'BACKEND_UNAVAILABLE'};
        if(core.state.newConversationProjectId) await core.updateSession(result.sessionId,{projectId:core.state.newConversationProjectId});
        await core.refreshSessions();
        if(identity!==core.state.identityGeneration || owner!==core.state.ownerId || draft!==core.state.newConversationId || core.state.selectedSessionId)return null;
        const text=effects.readMessageDraft(),oldKey=core.attachmentDraftKey(),attachments=core.state.attachmentDrafts.get(oldKey);
        await core.selectSession(result.sessionId);
        if(identity!==core.state.identityGeneration || owner!==core.state.ownerId || core.state.selectedSessionId!==result.sessionId)return null;
        if(attachments){const newKey=core.attachmentDraftKey();core.state.attachmentDrafts.set(newKey,attachments);if(newKey!==oldKey)core.state.attachmentDrafts.delete(oldKey);effects.renderAttachmentDrafts?.()}
        effects.restoreMainChatDraft?.(text);
      }
      if(identity!==core.state.identityGeneration || owner!==core.state.ownerId) return null;
      return core.state.selectedSessionId;
    })().finally(()=>{pending=null});
    return pending;
  }
  async function listSlashCommands() {
    if(core.state.activeChatSource==='phone') return {items:[],scope:scope()};
    const sessionId=await ensureSlashSession();
    if(!sessionId)return {items:[]};
    const token=scope(),catalog=await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/slash-commands`);
    if(token!==scope())throw {code:"STALE_CONTEXT"};
    return {...catalog,scope:token};
  }
  async function runSlashCommand(line) {
    const sessionId=await ensureSlashSession(),token=scope();
    if(!sessionId)return;
    const result=await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/slash-commands`,{method:'POST',protectedWrite:true,body:{line},timeoutMs:125000});
    if(token!==scope())return;
    if(result.result?.kind==='error') {effects.toast(result.result.text || '命令没有执行，请重试。');return false;}
    if(effects.readMessageDraft()?.trim()===line.trim())effects.clearMessageDraft();
    effects.toast(result.result?.text || '命令已执行');
    await core.refreshSessions();await core.refreshHistory();return true;
  }
  const send=core.sendDraft;
  core.sendDraft=async(text=effects.readMessageDraft(),...args)=>{
    const name=/^\/([a-z][a-z0-9_-]*)(?:\s|$)/.exec(text)?.[1];
    if(name){
      try {
        const identity=core.state.identityGeneration,owner=core.state.ownerId,catalog=await listSlashCommands();
        if(identity!==core.state.identityGeneration || owner!==core.state.ownerId || catalog.scope!==scope())return;
        if(catalog.items.some(item=>item.kind==='command' && item.name===name))return runSlashCommand(text);
      } catch(error){effects.toast(core.failureMessage(error));return;}
    }
    return send(text,...args);
  };
  return {ensureSlashSession,listSlashCommands,runSlashCommand};
};

globalThis.WeftSlashMenu={mount(core,{field,anchor=field,toast,repaint}) {
  let popup,items=[],selected=0,generation=0,dismissed='',busy=false,catalogScope='';
  const scope=()=>`${core.state.ownerId}/${core.state.identityGeneration}/${core.state.selectedSessionId}/${core.state.newConversationId}`;
  const close=()=>{popup?.close(false);popup=null;field.removeAttribute('aria-activedescendant')};
  const active=()=>{const buttons=[...(popup?.menu.querySelectorAll('button')||[])];buttons.forEach((button,i)=>{button.dataset.active=String(i===selected);button.id=`slash-option-${i}`});field.setAttribute('aria-activedescendant',`slash-option-${selected}`);buttons[selected]?.scrollIntoView({block:'nearest'})};
  const descriptions={compact:'压缩较早的对话，保留当前进展',goal:'查看或设置当前目标',feedback:'向运行时提交反馈'};
  const pick=async item=>{
    close();dismissed='';
    const args=/^\/\S+\s([\s\S]*)$/.exec(field.value)?.[1] || '';
    field.value=`/${item.name}${args?' '+args:' '}`;field.dispatchEvent(new Event('input',{bubbles:true}));
    dismissed=field.value;
    close();field.focus();repaint?.();
    if(item.kind==='command' && (!item.input || args.trim())) {
      try {await core.runSlashCommand(field.value.trimEnd());repaint?.()}catch(error){toast(core.failureMessage(error))}
    }
  };
  function show(query) {
    const name=query.slice(1).split(/\s/)[0].toLocaleLowerCase();
    const matches=items.filter(item=>`${item.name} ${item.description}`.toLocaleLowerCase().includes(name));
    close();selected=Math.min(selected,Math.max(0,matches.length-1));
    popup=WeftPopover.openMenu(field,matches.length?matches.map(item=>({name:`/${item.name}`,description:(descriptions[item.name] || item.description)+(item.input?` · ${item.input.hint}`:''),action:()=>pick(item)})):[{name:'没有匹配的命令或技能',disabled:true}],{label:'命令和技能',onClose:()=>{popup=null;field.removeAttribute('aria-activedescendant')}});
    popup.menu.classList.add('slash-command-menu');popup.menu.dataset.motion='enter-rise';
    popup.menu.style.width=`${Math.max(260,anchor.getBoundingClientRect().width)}px`;
    WeftPopover.position(popup.menu,anchor,{side:'top'});field.focus({preventScroll:true});active();
    popup.matches=matches;
  }
  async function update() {
    if(catalogScope && catalogScope!==scope()){items=[];catalogScope='';close()}
    const query=field.value;
    if(!query.startsWith('/') || query.includes('\n') || query===dismissed || field.disabled){close();return}
    if(/\s/.test(query)){close();return}
    if(items.length){show(query);return}
    if(busy)return;busy=true;const token=scope(),run=++generation;
    try {const catalog=await core.listSlashCommands();if(run!==generation || catalog.scope!==scope())return;items=catalog.items || [];catalogScope=catalog.scope;previous=scope();if(field.value.startsWith('/') && field.value!==dismissed)show(field.value)}
    catch(error){toast(core.failureMessage(error));close()}
    finally{busy=false}
  }
  field.addEventListener('input',()=>{dismissed='';selected=0;void update()});
  field.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(busy && ['Escape','Enter'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape'){generation++;dismissed=field.value;close()}return}
    if(!popup)return;
    if(['ArrowUp','ArrowDown','Enter','Escape','Tab'].includes(event.key)){
      if(event.key!=='Tab')event.preventDefault();event.stopImmediatePropagation();
      if(event.key==='Escape'||event.key==='Tab'){dismissed=field.value;close();return}
      if(event.key==='Enter'){const item=popup.matches[selected];if(item)void pick(item);return}
      selected=(selected+(event.key==='ArrowDown'?1:-1)+popup.matches.length)%Math.max(1,popup.matches.length);active();
    }
  },true);
  let previous=scope();
  const sync=()=>{if(previous!==scope()){previous=scope();items=[];catalogScope='';close()}};
  document.addEventListener('weft:identity',sync);
  field.addEventListener('focus',()=>{sync();if(!popup)void update()});
  return {close,sync};
}};
