/* Phone presentation mapping. Native execution identities stay in ui-core/Kotlin. */
(() => {
  const main = () => state.logicalChats && uiCore.inMainChat();
  const nativeSides = selectSharedSession;
  const oldRender = renderSharedConversation, oldLoad = loadSharedHistory, oldOlder = loadOlderHistory;
  const oldSend = send, oldHeader = updatePageHeader, oldDrafts = refreshAttachmentDrafts,oldScroll=handleChatScroll;
  let scrollGestureAt=0;
  for(const name of ['wheel','touchmove'])$('chat-scroll').addEventListener(name,()=>{scrollGestureAt=performance.now();},{passive:true});
  const oldAttachments = uiCore.currentAttachmentDrafts,oldPick=pickAttachment,oldModels=openModels,oldRemove=removeAttachment,oldSelectConversation=selectConversation;
  const ids = {'assistant-title':'header-title','message-text':'draft','session-list':'conversation-list','new-session':'home-new-chat','transcript':'main-chat-transcript'};
  const intro = el('div','main-chat-intro'); intro.id = 'main-chat-intro'; intro.append(el('h1','','今天想聊些什么？'));
  const older = el('button','quiet','加载更早内容'); older.id='main-chat-load-older'; older.type='button'; older.onclick=()=>uiCore.loadOlderLogicalHistory();
  const transcript = el('ol','main-chat-transcript'); transcript.id='main-chat-transcript';
  const notice = el('p','main-chat-notice'); notice.setAttribute('role','status');
  function ensureList() { if(!transcript.isConnected)$('chat-content').replaceChildren(intro,older,notice,transcript); }
  const view = {
    mobile:true,userScrolling:()=>performance.now()-scrollGestureAt<400, byId:id=>id==='chat-intro'?intro:id==='load-older'?older:id==='transcript'?transcript:$(ids[id]||id), element:el,
    toast, readMessageDraft:()=>$('draft').value, closeAttachmentMenu,
    bindMainMessage:(row,event)=>{row.querySelector('.message-tools')?.remove();mobileMessageActions?.bind(row,event,event.sourceRef?.sessionId);},
    historyNotice:text=>{notice.textContent=text;notice.hidden=!text;},
    get conversationScroll(){return ensureConversationScroll();},
    paintHistoryMessages(events,target){for(const event of events){
      const node=messageNode(event.type==='user.message'?'user':'assistant',event.data?.text||'');
      node.classList.add('logical-message');node.dataset.eventId=event.eventId;
      const sessionId=event.sourceRef?.sessionId;
      for(const image of event.data?.images||[]) {
        if(!sessionIdPattern.test(sessionId||'')||!sessionMediaId.test(image.attachmentId||''))continue;
        const imageUrl=window.weftNative?`https://appassets.androidplatform.net/media/session/${sessionId}/${image.attachmentId}`:uiCore.historyImageUrl(sessionId,image.attachmentId);
        const preview=el('button','message-thumbnail'),thumb=el('img');preview.type='button';preview.setAttribute('aria-label',`预览图片 ${image.name||'附件'}`);thumb.src=imageUrl;thumb.alt=image.name||'附件图片';thumb.loading='lazy';thumb.decoding='async';preview.append(thumb);
        preview.onclick=()=>{if(window.weftNative)openImagePreview(imageUrl,image.name||'图片',preview,{owner:state.owner,epoch:state.authEpoch,source:'host',conversationId:uiCore.state.selectedChatId,logicalSource:{sessionId,eventId:event.eventId}},{original:true,attachmentId:image.attachmentId});else window.open(imageUrl,'_blank','noopener');};node.append(preview);
      }
      appendSharedFiles(node,event,event.sourceRef?.sessionId);target.append(node);
    }},
    renderSessions:()=>{ state.sharedSessions=uiCore.state.sessions.filter(row=>row.kind!=='main').map(row=>({...row,source:'host'}));renderConversationList(); },
    paintSelectedSession:id=>{
      state.chatSource='host';state.conversationId=null;state.sharedSessionId=id;state.sharedGeneration++;
      state.sharedRunning=!!uiCore.state.sessions.find(row=>row.sessionId===id)?.running;
      state.sharedPending=null;state.sharedOutboxLoading=false;state.sharedError='';updatePageHeader();
    },
    renderOlderControl:()=>{},renderOptimisticMessages:()=>renderOptimisticMessages(),renderTurnStatus:()=>{},renderTimeline:()=>{},
    renderConversationTasks,renderConversationApprovals,renderConversationQuestions,
    beginOlderHistory:()=>{},restoreOlderHistoryPosition:()=>{},scrollToLatest:()=>scrollBottom(true),
    updateAvailability:updateComposer, openTimelinePreview:(context,path,title)=>openTimelinePreview(context,()=>uiCore.readResource(path),title),
    appendResourceArtifactActions:()=>{},
  };
  const paintNativeSelection=view.paintSelectedSession;
  const presentation=WeftUiComponents.factories.mainChat(uiCore,view);
  Object.assign(view,presentation);
  Object.assign(mobileEffects,presentation,{
    renderMainChat(){if(!state.logicalChats)return;if(main()){state.sharedSessionId=uiCore.state.selectedSessionId;state.sharedRunning=!!uiCore.state.mainChat.running;ensureList();}presentation.renderMainChat();if(main()&&state.scrollPinned&&!uiCore.state.chatWindow.hasNewer)scrollBottom();},
    paintSelectedSession:id=>presentation.paintSelectedSession(id),
    showConversation:()=>{if(main())ensureList();page('chat');scheduleSharedPoll();},closeRail:closeDrawer,
    paintModels:()=>updateComposer(),paintDesktopComposer:()=>{},paintSessionApprovalMode:()=>updateApprovalModeButton(),
    removeResourcePreview:()=>closeResourcePage({restoreFocus:false}),closeResourcePreview:()=>closeResourcePage({restoreFocus:false}),
    closePhoneImagePreview:()=>closeImagePreview({restoreFocus:false}),
    clearHistoryView:()=>{state.sharedEvents=[];$('chat-content').replaceChildren();},
    historyNotice:view.historyNotice,paintCommandOperation:message=>status(message),renderOperation:message=>status(message),
    paintOperation:message=>status(message),setApprovalModeBusy:busy=>{$('approval-mode-button').disabled=busy;},
    paintHistoryMessages:events=>{for(const event of events)trackSharedAcceptedTurn(event);if(state.logicalChats&&!main()){
      state.sharedEvents=[...uiCore.state.historyEvents.values()].sort((a,b)=>a.seq-b.seq);renderSharedConversation();}},
    paintAttachmentStatus:message=>status(message),
    restoreMainNativeRequests:async()=>{if(window.weftNative){const rows=await call('shared.outbox.list');uiCore.restoreMainRequests(rows.commands||[]);}await uiCore.restoreRequests();},
    loadAttachmentHasher:async()=>({hashBlobSha256:async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('')}),
    closeApprovalMenu:closeApprovalModeMenu,renderApprovalMode:updateApprovalModeButton,approvalModeReadFailed:()=>status('审批模式暂时无法读取'),
    selectNativeSideSession:async id=>{
      uiCore.state.selectedSessionId=id;uiCore.state.activeChatSource='desktop';
      if(!state.sharedSessions.some(row=>row.sessionId===id))await uiCore.refreshLogicalSessions();
      nativeSides(id);await uiCore.loadMobileHistory();
    },
    transferNativeAttachments:async(from,to,files)=>{
      if(!window.weftNative){uiCore.state.attachmentDrafts.set(to,files);return;}
      const fromId=from.split('|').at(-1),toId=to.split('|').at(-1);
      await call('attachments.move',{fromConversationId:fromId,conversationId:toId,attachmentIds:files.map(row=>row.attachmentId)});
      attachmentDrafts.set(attachmentKey(toId),files);attachmentDrafts.delete(attachmentKey(fromId));await refreshAttachmentDrafts();
    },
    sendMainNativeMessage:async fields=>{
      if(!window.weftNative)return fields.attachmentIds.length?uiCore.sendDesktopMessageWithAttachments(fields.text,fields.requestId,fields.intent)
        :uiCore.submitCommand('chat.message',{chatId:fields.chatId,text:fields.text,modelProfileId:fields.modelProfileId,mode:fields.intent},null,fields.requestId);
      uiCore.state.submitting=true;uiCore.operation('正在发送…',true,fields.requestId);updateComposer();
      try {
        const result=await call('shared.send',fields);if(!result.command)throw Error('COMMAND_UNCONFIRMED');
        uiCore.updateFromCommand(result.command);
        if(['accepted_by_dsh','observed'].includes(result.command.state)){clearAcceptedHostAttachments(fields.attachmentIds);await refreshAttachmentDrafts();}
        return result.command;
      }finally{uiCore.state.submitting=false;updateComposer();}
    },
  });
  // The shared renderer requires its named draft callback on its own presentation object too.
  view.restoreMainChatDraft=mobileEffects.restoreMainChatDraft;
  uiCore.currentAttachmentDrafts=()=>main()&&window.weftNative?currentAttachments().map(row=>({...row,file:{name:row.name}})):oldAttachments();
  const oldMobileAttachments=uiCore.mobile.currentAttachments;
  uiCore.mobile.currentAttachments=()=>state.logicalChats&&!window.weftNative?oldAttachments().map(row=>({...row,name:row.file.name,kind:row.contentType?.startsWith('image/')?'image':'file'})):oldMobileAttachments();
  const oldSelectedShared=uiCore.mobile.selectedSharedSession;
  uiCore.mobile.selectedSharedSession=()=>main()?{...uiCore.state.mainChat,sessionId:uiCore.state.selectedSessionId}:oldSelectedShared();
  const oldKey=uiCore.mobile.attachmentConversationId;
  uiCore.mobile.attachmentConversationId=()=>main()?uiCore.state.selectedChatId:oldKey();
  const nativeComposer=uiCore.mobile.composerState;
  uiCore.mobile.composerState=text=>{
    if(!main())return nativeComposer(text);
    const running=!!uiCore.state.mainChat.running,available=state.loggedIn&&state.sharedHostAvailable&&uiCore.state.mainChat.sendAvailable;
    const modelReady=uiCore.state.models.some(model=>model.id===uiCore.state.modelProfileId);
    const attachments=currentAttachments().length;state.sharedRunning=running;
    const hasDraft=!!text.trim()||attachments>0;
    try{const key=sharedDraftKey(uiCore.state.selectedChatId);if(text)localStorage.setItem(key,text);else localStorage.removeItem(key);}catch{}
    return {ready:available&&modelReady&&hasDraft&&!uiCore.state.submitting&&!uiCore.state.unresolvedSubmission,sendHidden:running&&!hasDraft,
      draftDisabled:!available,placeholder:running?WeftUiCore.runningPlaceholder(uiCore.composerInputMode(state.sharedSessionId)):'和 WeftMate 聊聊…',
      modelName:uiCore.state.mainChat.modelDisplayName||uiCore.state.models.find(row=>row.id===uiCore.state.modelProfileId)?.name||'选择模型',
      modelLabel:'当前模型',modelDisabled:!!state.sharedSessionId,attachmentsDisabled:!available||!!state.attachmentPick||uiCore.state.submitting,
      voiceDisabled:!available,attachmentItemDisabled:uiCore.state.submitting};
  };
  renderSharedConversation=function(){if(main()){ensureList();mobileEffects.renderMainChat();updateComposer();return;}return oldRender();};
  loadSharedHistory=function(){return main()?uiCore.refreshLogicalHistory():oldLoad();};
  loadOlderHistory=function(){return main()?uiCore.loadOlderLogicalHistory():oldOlder();};
  handleChatScroll=function(){if(main())ensureConversationScroll().scrolled();else oldScroll();};
  send=function(options={}){return main()?uiCore.sendMainDraft($('draft').value,options.intent):state.logicalChats&&!window.weftNative?uiCore.sendDraft($('draft').value,options.intent):oldSend(options);};
  selectSharedSession=function(id){return state.logicalChats?uiCore.selectLogicalSession(id):nativeSides(id);};
  updatePageHeader=function(){oldHeader();if(state.logicalChats&&state.page==='chat'){$('menu-button').hidden=false;$('page-back').hidden=main();}
    if(main()){$('header-title').textContent='WeftMate';$('header-subtitle').textContent='主对话';}};
  refreshAttachmentDrafts=async function(...args){if(state.logicalChats&&!window.weftNative){renderAttachmentDrafts();updateComposer();return true;}return oldDrafts(...args);};
  removeAttachment=async function(id){if(state.logicalChats&&!window.weftNative)return uiCore.removeAttachmentDraft(id);return oldRemove(id);};
  selectConversation=function(id){if(state.logicalChats&&id===null)return uiCore.openSideChat({entry:'composer'}).catch(error=>toast(uiCore.failureMessage(error)));return oldSelectConversation(id);};
  pickAttachment=async function(kind){if(!state.logicalChats||window.weftNative)return oldPick(kind);
    closeAttachmentMenu();const input=el('input');input.type='file';input.multiple=true;input.accept=kind==='file'?'': 'image/*';if(kind==='camera')input.setAttribute('capture','environment');
    input.addEventListener('change',async()=>{await uiCore.addAttachmentFiles([...input.files]);input.remove();renderAttachmentDrafts();updateComposer();});input.addEventListener('cancel',()=>input.remove());input.hidden=true;document.body.append(input);input.click();};
  openModels=async function(){if(!main())return oldModels();if(state.sharedSessionId)return;
    if(state.menu){closeModelMenu();return;}closeAttachmentMenu();state.menu=true;$('model-popover').hidden=false;$('model-button').setAttribute('aria-expanded','true');
    const list=$('model-options');list.replaceChildren();await uiCore.refreshThinkingModels();
    for(const model of uiCore.state.models){const option=el('button','model-option',model.name||model.displayName||model.id);option.type='button';option.setAttribute('role','option');option.setAttribute('aria-selected',String(model.id===uiCore.state.modelProfileId));option.onclick=()=>{uiCore.selectModelProfile(model.id);closeModelMenu();};list.append(option);}placeModelMenu();};
  presentation.mountMainChat();
  $('open-side-chat').hidden=true;
  const sideHeading=$('drawer').querySelector('.rail-side-heading');if(sideHeading)sideHeading.hidden=true;
  const oldRenderMain=mobileEffects.renderMainChat;
  mobileEffects.renderMainChat=()=>{oldRenderMain();$('open-side-chat').hidden=!state.logicalChats;if(sideHeading)sideHeading.hidden=!state.logicalChats;};
  // Touch selection exposes a single row's existing actions. Scrolling cancels a long press.
  let timer,pointerStart,longPressedRow;
  transcript.addEventListener('pointerdown',event=>{const row=event.target.closest('.logical-message,.main-chat-row.message');if(!row||event.target.closest('button,a,summary'))return;
    pointerStart={x:event.clientX,y:event.clientY};longPressedRow=null;timer=setTimeout(()=>{longPressedRow=row;row.classList.add('actions-visible');const menu=row.querySelector('.chat-message-menu');if(menu)menu.open=true;row.querySelector('summary')?.focus({preventScroll:true});},500);});
  transcript.addEventListener('pointermove',event=>{if(pointerStart&&Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>10)clearTimeout(timer);});
  for(const name of ['pointerup','pointercancel'])transcript.addEventListener(name,()=>clearTimeout(timer));
  transcript.addEventListener('click',event=>{if(event.target.closest('button,a,summary,details'))return;const row=event.target.closest('.main-chat-row.message');
    if(longPressedRow===row){longPressedRow=null;return;}
    for(const active of transcript.querySelectorAll('.actions-visible'))if(active!==row)active.classList.remove('actions-visible');row?.classList.toggle('actions-visible');});
  transcript.addEventListener('contextmenu',event=>{const row=event.target.closest('.main-chat-row.message'),menu=row?.querySelector('.chat-message-menu');if(!menu)return;
    event.preventDefault();row.classList.add('actions-visible');menu.open=true;menu.querySelector('summary')?.focus({preventScroll:true});});
  const viewport=()=>{if(main()&&state.scrollPinned)requestAnimationFrame(()=>mobileEffects.scrollToLatest());};
  window.visualViewport?.addEventListener('resize',viewport);
})();
