/* Session-scoped DSH discovery and execution; skills remain native prompt references. */
globalThis.WeftUiCore.factories.slashCommands=(core,effects,environment)=>{
  const scope=()=>`${core.state.ownerId}/${core.state.identityGeneration}/${core.state.activeChatSource}/${core.state.selectedSessionId}/${core.state.newConversationId}`;
  let pending;
  async function ensureSlashSession() {
    if(core.state.selectedSessionId) return core.state.selectedSessionId;
    if(pending) return pending;
    const identity=core.state.identityGeneration,owner=core.state.ownerId,draft=core.state.newConversationId;
    pending=(async()=>{
      if(core.supportsChat?.('sideChats') && core.state.mainChat && core.state.newConversationMode!=='work' && !core.state.newConversationProjectId && !core.state.newConversationTemporary) await core.openSideChat({entry:'composer'});
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
