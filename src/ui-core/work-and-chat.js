/* Product modes share the existing sessions, projects and native approvals. */
globalThis.WeftUiCore.conversationMode = row => row?.phoneHistory ? 'chat' : row?.mode || (row?.projectId || row?.workspaceKind === 'browser' ? 'work' : 'chat');
globalThis.WeftUiCore.factories.workAndChat = (core, effects, environment) => {
  const mode = globalThis.WeftUiCore.conversationMode;
  const originalState = core.composerState, newConversation = core.startNewConversation;
  const send = core.sendDraft;
  const clear = core.clearSession;
  const selectSession = core.selectSession, selectLogical = core.selectLogicalSession, selectMain = core.selectMainChat, selectPhone = core.selectPhoneConversation;
  const enabled = () => core.state.personalCapabilities?.workAndChat === 1;
  let preferenceOwner, sidebarMode;
  function sidebarConversationMode() {
    const owner = core.state.cloudAuth?.sub || core.state.cloudAuth?.accountId || core.state.ownerId || '';
    if (preferenceOwner !== owner || !sidebarMode) {
      preferenceOwner = owner;
      try { sidebarMode = environment.storage?.getItem(`weftmate-conversation-mode:${owner}`); } catch {}
      sidebarMode = sidebarMode === 'work' ? 'work' : 'chat';
    }
    return sidebarMode;
  }
  function chooseSidebarMode(value) {
    sidebarConversationMode(); sidebarMode = value === 'work' ? 'work' : 'chat';
    try { environment.storage?.setItem(`weftmate-conversation-mode:${preferenceOwner}`, sidebarMode); } catch {}
    effects.renderSessions?.(); effects.paintWorkMode?.();
  }
  function currentMode() {
    if (core.state.activeChatSource === 'phone') return 'chat';
    if (core.state.newConversation) return core.state.newConversationMode || 'chat';
    return mode(core.state.sessions.find(row => row.sessionId === core.state.selectedSessionId) ||
      (core.state.selectedChatId === core.state.mainChat?.chatId ? core.state.mainChat : null));
  }
  function workComputers() {
    if (core.state.computers?.length) return core.state.computers;
    if (!core.state.hostId || core.state.hostId === 'unconnected' || core.state.cloudAuth?.cloudOnly) return [];
    return [{ hostId: core.state.hostId, name: core.state.hostName || core.computerName?.(core.state.hostId) || '这台电脑', online: core.state.online !== false }];
  }
  async function startNewWork(hostId, project, { restore = false } = {}) {
    if (core.state.submitting || core.state.unresolvedSubmission) return;
    if (!restore) abandonFollow();
    core.rememberConversationDraft?.();
    if (hostId) {
      await core.selectExecutionComputer?.(hostId);
      if (hostId !== (core.currentExecutionComputer?.() || core.state.hostId)) throw { code: 'TARGET_UNAVAILABLE' };
    }
    core.state.selectedChatId = null; core.state.workTimeline = null;
    await newConversation(true, false, { restore });
    core.state.newConversationMode = 'work';
    chooseSidebarMode('work');
    core.state.newConversationProjectId = project?.projectId || null;
    core.state.workDraftHostId = hostId || core.currentExecutionComputer?.() || core.state.hostId;
    effects.paintSelectedSession?.(null); effects.updateAvailability(); effects.paintWorkMode?.();
  }
  async function startSidebarConversation({ restore = false } = {}) {
    return enabled() && sidebarConversationMode() === 'work' ? startNewWork(undefined, undefined, { restore }) : core.startNewConversation(false, false, { restore });
  }
  async function chooseWorkComputer(id) {
    if (!workComputers().find(row => row.hostId === id)?.online) throw { code: 'COMPUTER_OFFLINE' };
    const draft = effects.readMessageDraft();
    await startNewWork(id); effects.restoreMainChatDraft?.(draft);
  }
  const transfers = new Map();
  let navigationGeneration=0;
  function abandonFollow() { navigationGeneration++; transfers.clear(); }
  const navigationContext=context=>({...context,navigation:context.navigation??navigationGeneration});
  const contextKeys=['ownerId','identity','deviceId','source','sessionId','conversationId'];
  const sameContext = context => (context.navigation===undefined || context.navigation===navigationGeneration) && contextKeys.every(key => core.approvalContext()[key] === context[key]);
  const transferKey = (context, id) => JSON.stringify([...contextKeys.map(key=>context[key]),context.navigation??navigationGeneration,id]);
  const paintTransfers = () => effects.paintWorkMode?.();
  function workHandoffs() {
    if (!enabled() || core.state.newConversation || core.state.activeChatSource !== 'desktop') return [];
    return (core.state.sessions.find(row=>row.sessionId===core.state.selectedSessionId)?.workHandoffs || []).map(row=>({
      ...row, ...(row.stage==='ready' ? {} : transfers.get(transferKey(core.approvalContext(),row.approvalId))) }));
  }
  async function refreshWorkHandoffs(context=core.approvalContext()) {
    context=navigationContext(context);
    if (!sameContext(context)) return;
    const chatId=context.conversationId || core.state.chats?.find(row=>row.activeSessionId===context.sessionId)?.chatId
      || (await core.accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/chat`)).chatId;
    if (!sameContext(context)) return;
    const {chat}=await core.accessApi(`/chats/${encodeURIComponent(chatId)}`);
    if (!sameContext(context)) return;
    if (chat.activeSessionId!==context.sessionId) throw {code:'SOURCE_UNAVAILABLE'};
    const value=Array.isArray(chat.workHandoffs)?chat.workHandoffs:[];
    const selected=core.state.sessions.find(row=>row.sessionId===context.sessionId);
    if (selected) selected.workHandoffs=value;
    else core.state.sessions.push({...chat,sessionId:context.sessionId,workHandoffs:value});
    paintTransfers(); return workHandoffs();
  }
  async function followWork(context, approvalId, draft) {
    for (let attempt=0; attempt<20 && sameContext(context); attempt++) {
      await refreshWorkHandoffs(context);
      if (!sameContext(context)) return;
      const transfer=workHandoffs().find(row=>row.approvalId===approvalId);
      paintTransfers();
      if (transfer?.stage==='ready' && transfer.workExists) {
        await core.refreshSessions();
        if (sameContext(context) && effects.readMessageDraft?.()===draft && workHandoffs()[0]?.approvalId===approvalId)
          await core.selectSession(transfer.workActiveSessionId || transfer.workSessionId);
        return;
      }
      if (!transfer || ['failed','uncertain'].includes(transfer.stage)) return;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
  }
  async function transferWork(context, id, submit) {
    context=navigationContext(context);
    if (!sameContext(context)) return;
    const key=transferKey(context,id);
    if (transfers.get(key)?.busy) return;
    const draft=effects.readMessageDraft?.();
    const operation={busy:true,notice:''};transfers.set(key,operation); paintTransfers();
    try { await submit(); if (sameContext(context)) await followWork(context,id,draft); }
    catch (cause) {
      if (!sameContext(context)) return;
      operation.busy=false;operation.notice=core.failureMessage(cause);
      await refreshWorkHandoffs(context).catch(()=>{});
      if (sameContext(context)) effects.toast?.(core.failureMessage(cause));
    } finally {
      if (transfers.get(key)===operation && (operation.busy || !sameContext(context))) transfers.delete(key);
      if (sameContext(context)) paintTransfers();
    }
  }
  async function switchConversationWork(context, row, projectId) {
    context=navigationContext(context);
    return transferWork(context,row.approvalId,async()=>{
      const result=await core.submitApproval(context,row,'allowed-once','once',{workProjectId:projectId});
      if (!result?.approval?.workSessionId && sameContext(context)) {
        await refreshWorkHandoffs(context);
        if (sameContext(context) && !workHandoffs().some(item=>item.approvalId===row.approvalId)) throw {code:'REQUEST_FAILED'};
      }
    });
  }
  async function resumeWorkHandoff(row) {
    const context=navigationContext(core.approvalContext());
    return transferWork(context,row.approvalId,async()=>{
      await refreshWorkHandoffs(context);
      if (!sameContext(context)) return;
      const current=workHandoffs().find(item=>item.approvalId===row.approvalId && item.direction==='outgoing');
      if (!current || ['failed','uncertain'].includes(current.stage)) throw {code:'SOURCE_UNAVAILABLE'};
      if (current.stage==='ready') return;
      await core.accessApi(`/sessions/${encodeURIComponent(current.sourceSessionId)}/approvals/${encodeURIComponent(current.approvalId)}`,{
        method:'POST',protectedWrite:true,body:{requestId:current.decisionRequestId,outcome:'allowed-once',workProjectId:current.workProjectId}});
    });
  }
  async function openWorkHandoff(row) {
    const context=navigationContext(core.approvalContext()); await refreshWorkHandoffs(context);
    if (!sameContext(context)) return;
    const current=workHandoffs().find(item=>item.approvalId===row.approvalId && item.direction===row.direction);
    if (!current || current.direction==='outgoing' && !current.workExists) throw {code:'SOURCE_UNAVAILABLE'};
    await core.refreshSessions();
    if (sameContext(context)) await core.selectSession(current.direction==='incoming'?(current.sourceActiveSessionId || current.sourceSessionId):(current.workActiveSessionId || current.workSessionId));
  }
  core.composerState = (...args) => {
    const state = originalState(...args);
    if (enabled() && currentMode() === 'work' && (!core.currentFolderProject?.() ||
        !workComputers().some(row => row.hostId === ((core.state.newConversation ? core.state.workDraftHostId : null) || core.currentExecutionComputer?.() || core.state.hostId) && row.online)))
      return { ...state, sendDisabled: true, messageDisabled: true, voiceDisabled: true, placeholder: '先选择电脑和文件夹' };
    return state;
  };
  core.startNewConversation = async (...args) => {
    if (!args[2]?.restore) abandonFollow();
    core.rememberConversationDraft?.();
    core.state.newConversationMode = 'chat';
    if (enabled()) { core.state.selectedChatId = null; core.state.workTimeline = null; chooseSidebarMode('chat'); return newConversation(true, args[1], args[2]); }
    return newConversation(...args);
  };
  if (selectSession) core.selectSession = async (id, ...args) => {
    if (!args[0]?.restore) abandonFollow();
    if (core.state.activeChatSource === 'desktop' && core.state.selectedSessionId === id && !core.state.newConversation) { effects.showConversation({ restore: args[0]?.restore }); if (!args[0]?.restore) effects.closeRail(); return; }
    const result = await selectSession(id, ...args);
    if (enabled() && core.state.selectedSessionId === id) chooseSidebarMode(currentMode()); return result; };
  if (selectMain) core.selectMainChat = async (...args) => {
    if (!args[1]?.restore) abandonFollow();
    if (!args[0] && core.state.activeChatSource === 'desktop' && core.state.mainChat && core.state.selectedChatId === core.state.mainChat.chatId && !core.state.newConversation) { effects.showConversation({ restore: args[1]?.restore }); if (!args[1]?.restore) effects.closeRail(); return; }
    const result = await selectMain(...args);
    if (enabled() && core.state.selectedChatId === core.state.mainChat?.chatId) chooseSidebarMode(currentMode()); return result; };
  if (selectLogical) core.selectLogicalSession = (id, options={}) => {if(!options.restore)abandonFollow();return selectLogical(id,options);};
  if (selectPhone) core.selectPhoneConversation = (...args) => { abandonFollow();const result = selectPhone(...args); if (enabled()) chooseSidebarMode('chat'); return result; };
  core.sendDraft = (...args) => {
    if (enabled() && currentMode() === 'work' && !core.currentFolderProject?.()) return effects.toast('先选择项目或文件夹，再开始工作。');
    return send(...args);
  };
  core.clearSession = (...args) => { abandonFollow();core.state.workTimeline = null; core.state.workDraftHostId = null; core.state.workProjectSelecting=null; core.state.newConversationMode = 'chat'; return clear(...args); };
  return { supportsWorkModes: enabled, currentConversationMode: currentMode, sidebarConversationMode, chooseSidebarMode, startSidebarConversation, workComputers, startNewWork, chooseWorkComputer,
    switchConversationWork, workHandoffs, refreshWorkHandoffs, resumeWorkHandoff, openWorkHandoff, conversationMode: mode };
};
