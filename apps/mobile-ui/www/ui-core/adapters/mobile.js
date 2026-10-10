/* Mobile native persistence and recovery. Plain data + named renderer effects. */
globalThis.WeftUiCore.factories.mobile = (core, effects, environment) => {
  if (!environment.mobileState) return {};
  const state = environment.mobileState;
  const MEMORY_KINDS = {all:'全部',cognition:'理解',entity:'人物与对象',relationship:'关系',event:'共同经历'};
  let requestSequence = 0;
  function composerState(text) {
    state.draft = text;
    const key = state.chatSource === 'host' ? sharedDraftKey() : draftKey();
    if (state.loggedIn) try { if(text) environment.storage.setItem(key,text); else environment.storage.removeItem(key); } catch {}
    const linked=!!selectedBinding(), host=state.chatSource==='host'||linked, session=selectedSharedSession();
    const attachments=currentAttachments().length;
    const busy=host?!!state.sharedPending||!!state.linkedPending||state.sharedOutboxLoading||state.busy:state.busy;
    const ready=(!!text.trim()||attachments>0)&&state.loggedIn&&!busy&&!state.modelSwitching&&!state.transitionPending&&
      !state.restorePending&&!core.state.sessionSelecting&&!core.state.sideCreating&&(host?!!session?.sendAvailable:!state.sendUncertain)&&(!linked||attachments===0);
    return {ready, host, busy,
      processingHint:core.executionAccountHint() || (core.state.sessionSelecting?'正在打开对话…':host&&state.sharedRunning?core.processingLabel(session?.processing):''),
      sendHidden:host?state.sharedRunning&&!text.trim()&&!attachments:busy,
      stopHidden:host?!state.sharedRunning:!busy,
      draftDisabled:(core.state.sessionSelecting||core.state.sideCreating)||!state.loggedIn||state.transitionPending||state.restorePending||host&&!session?.sendAvailable,
      placeholder:host?(session?.sendAvailable?session.memoryMode === 'off' ? '这次聊的内容不会形成记忆…' :state.sharedRunning?globalThis.WeftUiCore.runningPlaceholder(core.composerInputMode(state.sharedSessionId)):'继续对话…':'这段会话仅可查看'):state.busy?globalThis.WeftUiCore.runningPlaceholder():'说说你的目标…',
      modelName:host?session?.modelDisplayName||session?.modelName||'当前模型':state.model?.displayName||'选择模型',
      modelLabel:host?'当前模型':'选择模型',
      attachmentsDisabled:(core.state.sessionSelecting||core.state.sideCreating)||!state.loggedIn||state.restorePending||state.transitionPending||!!state.attachmentPick||
        (host?!session?.sendAvailable||!!state.sharedPending||linked:state.busy),
      attachmentItemDisabled:state.busy||state.transitionPending||host&&!!state.sharedPending,
      modelDisabled:host||!state.loggedIn||state.busy||state.modelSwitching||state.transitionPending,
      voiceDisabled:(core.state.sessionSelecting||core.state.sideCreating)||!state.loggedIn||busy||state.modelSwitching||state.transitionPending||state.restorePending||host&&!session?.sendAvailable,
    };
  }
  async function business({path, method='GET', body}) {
    core.syncMobileIdentity();
    try { return await core.requestJson(path, {method, body}); }
    catch (error) { throw Object.assign(new Error(error.code || 'OPERATION_FAILED'), {status:error.status}); }
  }
function draftKey(id=state.conversationId){return `weftmate-draft:${state.owner||'local'}:${id||'new'}`}

function sharedDraftKey(id=state.sharedSessionId){return `weftmate-shared-draft:${state.owner||'local'}:${id||'none'}`}

function attachmentConversationId(){return state.chatSource==='host'?state.sharedSessionId||'':state.conversationId||''}

function attachmentKey(id=attachmentConversationId(),owner=state.owner,source=state.chatSource){return source==='host'
  ?`${owner||'local'}:host:${id||'none'}`:`${owner||'local'}:${id||'new'}`}

function currentAttachments(){return environment.attachmentDrafts.get(attachmentKey())||[]}

function selectionKey(){return `weftmate-selection:${state.owner||'local'}`}

function chatSourceKey(){return `weftmate-chat-source:${state.owner||'local'}`}

function savedSharedSelection(){if(!state.loggedIn||!state.owner)return null;
  try{const value=JSON.parse(environment.storage.getItem(chatSourceKey())||'null');return value?.source==='host'&&
    typeof value.sessionId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value.sessionId)?value.sessionId:null}catch{return null}}

function hasAnyDraft(){if(!state.loggedIn||!state.owner)return false;
  for(const [key,items] of environment.attachmentDrafts)if(key.startsWith(`${state.owner}:`)&&items.length)return true;
  const prefix=`weftmate-draft:${state.owner}:`;try{for(let i=0;i<environment.storage.length;i++){
    const key=environment.storage.key(i);if((key?.startsWith(prefix)||key?.startsWith(`weftmate-shared-draft:${state.owner}:`))&&environment.storage.getItem(key)?.trim())return true}}
  catch{}return false}

function sharedViewCurrent(owner,epoch,generation,sessionId){return state.owner===owner&&state.authEpoch===epoch&&
  state.sharedGeneration===generation&&state.sharedSessionId===sessionId&&
  (state.chatSource==='host'||state.chatSource==='phone'&&selectedBinding()?.sessionId===sessionId)}

function trackSharedAcceptedTurn(event){const wait=state.sharedAwaiting;
  if(!wait||wait.sessionId!==state.sharedSessionId||event.seq<=wait.afterSeq)return;
  if(event.type==='user.message'){
    const visible=typeof event.data?.text==='string'?event.data.text.trim():'',
      images=Array.isArray(event.data?.images)?event.data.images:[];
    if(wait.text?visible===wait.text||event.data.truncated&&wait.text.startsWith(visible):
      wait.attachmentIds.length>0&&wait.attachmentIds.every(id=>images.some(image=>image.attachmentId===id)))wait.seenUser=true}
  else if(event.type==='turn.ended'&&wait.seenUser){state.sharedAwaiting=null;
    if(effects.readChatStatus()==='电脑已受理消息，等待会话记录更新')effects.status('')}}

function waitForSharedTurn(sessionId,text,afterSeq,attachmentIds=[]){state.sharedAwaiting={sessionId,text,afterSeq,attachmentIds,seenUser:false};
  for(const event of state.sharedEvents)trackSharedAcceptedTurn(event)}

function acceptSharedCommand(command){
  if(command?.kind!=='session.message'||command.sessionId!==state.sharedSessionId||
    !['accepted_by_dsh','observed'].includes(command.state))return false;
  const pending=state.sharedPending?.requestId===command.requestId?state.sharedPending:null;
  const row=core.optimisticMessages().find(item=>item.requestId===command.requestId);
  if(!pending&&!row)return false;
  core.reconcileOptimistic(command);
  const text=pending?.text??row?.text,attachments=pending?.attachmentIds??row?.attachmentIds??[];
  if(typeof text==='string'){
    try{if(environment.storage.getItem(sharedDraftKey())?.trim()===text)environment.storage.removeItem(sharedDraftKey())}catch{}
    if(effects.readMessageDraft().trim()===text)effects.clearMessageDraft();
    effects.clearAcceptedHostAttachments(attachments);
    effects.status('电脑已受理消息，等待会话记录更新');
    waitForSharedTurn(command.sessionId,text,pending?.afterSeq??row?.afterSeq??-1,attachments);
  }
  if(pending)state.sharedPending=null;
  core.observeOptimistic(state.sharedEvents);
  return true;
}

async function reconcileSharedDelivery(){
  if(state.chatSource!=='host')return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration,sessionId=state.sharedSessionId;
  const requests=new Set(core.optimisticMessages().filter(row=>row.status!=='accepted').map(row=>row.requestId));
  if(state.sharedPending?.requestId)requests.add(state.sharedPending.requestId);
  for(const requestId of requests){
    try{const result=await core.accessApi(`/commands/by-request/${encodeURIComponent(requestId)}`);
      if(!sharedViewCurrent(owner,epoch,generation,sessionId))return;
      if(result.command?.requestId===requestId)acceptSharedCommand(result.command);
    }catch{} // An unreadable receipt keeps the original request and draft.
  }
}

async function loadSharedOutbox(){if(state.chatSource!=='host')return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration,sessionId=state.sharedSessionId,
    pendingAtStart=state.sharedPending?.requestId||null;
  try{const result=await effects.nativeCall('shared.outbox.list');if(!sharedViewCurrent(owner,epoch,generation,sessionId)||
    (state.sharedPending?.requestId||null)!==pendingAtStart)return;
    for(const item of result?.commands||[])if(item.state==='accepted')acceptSharedCommand(item.command);
    const accepted=(result?.commands||[]).find(item=>item.sessionId===sessionId&&item.kind==='session.message'&&
      (!state.sharedPending||item.requestId===state.sharedPending.requestId)&&item.state==='accepted');
    if(accepted&&state.sharedPending?.text!==undefined){const text=state.sharedPending.text,key=sharedDraftKey(),
      attachmentIds=state.sharedPending.attachmentIds||[];
      try{if(environment.storage.getItem(key)?.trim()===text)environment.storage.removeItem(key)}catch{}
      if(effects.readMessageDraft().trim()===text)effects.clearMessageDraft();effects.status('电脑已受理消息，等待会话记录更新');
      effects.clearAcceptedHostAttachments(attachmentIds);
      waitForSharedTurn(sessionId,text,state.sharedPending.afterSeq??state.sharedNextSeq,attachmentIds)}
    else if(accepted)void effects.refreshAttachmentDrafts();
    const rejected=(result?.commands||[]).find(item=>item.sessionId===sessionId&&item.kind==='session.message'&&
      item.requestId===state.sharedPending?.requestId&&item.state==='rejected');
    if(rejected)effects.status(rejected.errorCode?effects.safeError(new Error(rejected.errorCode)):'电脑未受理这条请求；草稿仍保留',true);
    const pending=(result?.commands||[]).find(item=>item.sessionId===sessionId&&item.kind==='session.message'&&
      ['pending','uncertain'].includes(item.state));
    state.sharedPending=pending?{requestId:pending.requestId,state:'uncertain',text:state.sharedPending?.text,
      attachmentIds:state.sharedPending?.attachmentIds||[],afterSeq:state.sharedPending?.afterSeq}:null;effects.renderSharedConversation();
  }catch{}finally{if(sharedViewCurrent(owner,epoch,generation,sessionId)){
    state.sharedOutboxLoading=false;effects.updateComposer();effects.renderSharedConversation()}}}

async function checkSharedPending(){const pending=state.sharedPending;
  if(state.chatSource!=='host'||!pending||pending.state!=='uncertain'||state.sharedChecking)return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration,sessionId=state.sharedSessionId,
    requestId=pending.requestId;
  state.sharedChecking=requestId;effects.renderSharedConversation();
  try{const result=await effects.nativeCall('shared.outbox.reconcile');
    if(!sharedViewCurrent(owner,epoch,generation,sessionId)||optimistic.status==='accepted')return;
    if(result?.source!=='host'||!Array.isArray(result.commands))throw new Error('COMMAND_RECEIPT_INVALID');
    const outcome=result.commands.find(item=>item.sessionId===sessionId&&item.requestId===requestId);
    if(outcome?.state==='uncertain')effects.status('电脑仍未确认这条请求；原请求会保留，暂不重复发送');
    else if(outcome?.state==='rejected')effects.status(effects.safeError(new Error(outcome.errorCode||'OPERATION_FAILED')),true);
  }catch(e){if(sharedViewCurrent(owner,epoch,generation,sessionId))effects.status(
      e?.message==='TIMEOUT'?'核对超时，原请求仍保留；请稍后重试':effects.safeError(e),e?.message!=='TIMEOUT')}
  finally{if(sharedViewCurrent(owner,epoch,generation,sessionId)){
      await Promise.all([loadSharedOutbox(),effects.listSharedSessions(),effects.loadSharedHistory()]);
      if(state.sharedChecking===requestId)state.sharedChecking=null;
      effects.renderSharedConversation();effects.scheduleSharedPoll()}
    else if(state.sharedChecking===requestId)state.sharedChecking=null}}

async function listConversations(){if(!state.loggedIn){state.conversations=[];effects.renderConversationList();return}
  const owner=state.owner,epoch=state.authEpoch;
  try{const result=await effects.nativeCall('conversations.list');if(owner!==state.owner||epoch!==state.authEpoch||state.transitionPending)return;
    state.conversations=Array.isArray(result?.conversations)?result.conversations:[];effects.renderConversationList()}
  catch(e){if(owner===state.owner&&epoch===state.authEpoch&&!state.transitionPending)effects.toast(effects.safeError(e),true)}}

function selectedSharedSession(){return state.sharedSessions.find(item=>item.sessionId===state.sharedSessionId)||null}

function selectedBinding(){if(state.chatSource!=='phone'||!state.conversationId)return null;
  const view=state.handoffViews.get(state.conversationId),cached=state.conversations.find(item=>item.id===state.conversationId)?.binding;
  const binding=view?.status==='active'?view.binding:cached;
  return binding&&/^session-[0-9a-f-]{36}$/.test(binding.sessionId||'')?binding:null}

function matchingOriginalHostModels(original,models){if(!original||typeof original.modelId!=='string')return [];
  if(typeof original.hostProfileId==='string')return models.filter(item=>
    item.profileId===original.hostProfileId&&item.modelId===original.modelId);
  if(!/^[a-f0-9]{64}$/.test(original.routeFingerprint||''))return [];
  return models.filter(item=>item.modelId===original.modelId&&
    item.routeFingerprint===original.routeFingerprint)}

async function refreshHandoffModelName(binding){if(!binding?.modelProfileId||
  state.handoffModelNames.has(binding.modelProfileId)||Date.now()-state.handoffModelLastCheck<60000)return;
  const owner=state.owner,epoch=state.authEpoch;state.handoffModelLastCheck=Date.now();
  try{const result=await effects.nativeCall('models.host');if(state.owner!==owner||state.authEpoch!==epoch)return;
    for(const item of result.models||[])if(typeof item?.profileId==='string'&&
      typeof item.displayName==='string'&&item.displayName.trim())
      state.handoffModelNames.set(item.profileId,item.displayName.slice(0,100));
    if(state.page==='chat'&&selectedBinding()?.sessionId===binding.sessionId)
      void effects.renderConversation({silent:true})
  }catch{ /* A human-readable generic label remains. */ }}

async function refreshHandoff(conversationId=state.conversationId){if(!state.loggedIn||!conversationId||state.transitionPending)return null;
  const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
  try{const view=await effects.nativeCall('shared.conversations.get',{conversationId});
    if(state.owner!==owner||state.authEpoch!==epoch||state.transitionPending||
      view?.source!=='host'||view.conversationId!==conversationId)return null;
    state.handoffViews.set(conversationId,view);
    if(view.status==='active')state.handoffPickerOpen.delete(conversationId);
    if(view.binding?.sessionId){
      if(state.conversationId===conversationId&&state.chatSource==='phone'){
        state.sharedSessionId=view.binding.sessionId;void effects.listSharedSessions();
        void refreshHandoffModelName(view.binding);void loadLinkedHistory(conversationId)}}
    if(state.conversationId===conversationId&&state.chatSource==='phone'&&state.generation===generation){
      effects.renderConversationList();if(view.status!=='unbound'||!state.handoffPickerOpen.has(conversationId))
        void effects.renderConversation({silent:true});effects.updateComposer()}
    return view
  }catch{return null}finally{if(state.owner===owner&&state.authEpoch===epoch)
    effects.scheduleHandoffPoll(conversationId)}}

async function loadLinkedHistory(conversationId=state.conversationId){const binding=selectedBinding();
  if(!binding||state.linkedLoading)return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.generation,sessionId=binding.sessionId;
  state.linkedLoading=true;let after=state.linkedEvents.get(conversationId)?.nextSeq??-1;const events=[...(state.linkedEvents.get(conversationId)?.events||[])];
  try{for(let pageNo=0;pageNo<20;pageNo++){
      const initial=after===-1;const result=await effects.nativeCall('shared.sessions.events',{sessionId,...(initial?{}:{afterSeq:after})});
      if(state.owner!==owner||state.authEpoch!==epoch||state.generation!==generation||
        state.conversationId!==conversationId||selectedBinding()?.sessionId!==sessionId)return;
      if(result?.sessionId!==sessionId||!Array.isArray(result.events)||!Number.isSafeInteger(result.nextSeq)||
        result.nextSeq<after)throw new Error('COMMAND_RECEIPT_INVALID');
      events.push(...result.events.filter(event=>Number.isSafeInteger(event?.seq)&&
        typeof event.type==='string'));
      if(result.hasMore!==true){state.linkedEvents.set(conversationId,{events,nextSeq:result.nextSeq,hasOlder:result.hasOlder,nextBeforeSeq:result.nextBeforeSeq,cached:result.cached===true,
        tailUnknown:result.tailUnknown===true,historyTruncated:result.historyTruncated===true,
        oldestSeq:result.oldestSeq});break}
      if(result.nextSeq<=after)throw new Error('COMMAND_RECEIPT_INVALID');after=result.nextSeq}
    if(state.conversationId===conversationId&&state.chatSource==='phone')void effects.renderConversation({silent:true})
  }catch{if(state.conversationId===conversationId&&state.chatSource==='phone')effects.status('电脑会话暂时无法更新，已缓存记录仍可查看',true)}
  finally{if(state.owner===owner&&state.authEpoch===epoch){state.linkedLoading=false;
    effects.scheduleHandoffPoll(conversationId)}}}

function acceptSend(attempt,conversationId,turnId){if(state.activeSend!==attempt||!conversationId||
  attempt.owner!==state.owner||attempt.epoch!==state.authEpoch||
  (attempt.conversationId&&attempt.conversationId!==conversationId)||
  (attempt.acceptedId&&attempt.acceptedId!==conversationId)||
  (attempt.turnId&&turnId&&attempt.turnId!==turnId))return false;
  attempt.acceptedId=conversationId;if(turnId)attempt.turnId=turnId;
  if(attempt.adopted)return true;attempt.adopted=true;state.sendUncertain=false;
  environment.attachmentDrafts.delete(attempt.key);effects.markAttachmentRevision(attempt.key);
  try{if(environment.storage.getItem(attempt.draftKey)?.trim()===attempt.text)environment.storage.removeItem(attempt.draftKey)}catch{}
  if((state.conversationId||'')===attempt.conversationId){
    state.conversationId=conversationId;try{environment.storage.setItem(selectionKey(),conversationId)}catch{}
    if(effects.readMessageDraft().trim()===attempt.text)effects.clearMessageDraft();
    effects.renderAttachmentDrafts();effects.updateComposer();
  }return true}

function newSharedRequestId(){return `ui-${Date.now().toString(36)}-${(++requestSequence).toString(36)}-${Math.random().toString(36).slice(2,10)}`}

async function sendShared(options={}){if(core.state.sessionSelecting||core.state.sideCreating)return;core.syncMobileIdentity();const intent=options.intent==='queue'||options.intent==='steer'?options.intent:core.composerInputMode(state.sharedSessionId);const text=(options.retryRow?.text ?? effects.readMessageDraft()).trim(),session=selectedSharedSession();
  const items=[...currentAttachments()];
  if((!text&&!items.length)||!session?.sendAvailable||state.sharedPending||state.sharedOutboxLoading||state.transitionPending)return;
  if(text.length>16384){effects.status('消息过长，请缩短后发送',true);return}
  const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration,sessionId=session.sessionId,
    requestId=options.retryRow?.requestId || newSharedRequestId(),key=sharedDraftKey(),attachmentIds=options.retryRow?.attachmentIds || items.map(item=>item.attachmentId);
  const optimistic=options.retryRow || core.beginOptimistic({sessionId,text,requestId,attachmentIds,afterSeq:state.sharedNextSeq,
    retry:row=>sendShared({retryRow:row,intent:row.intent}),intent});
  optimistic.status='sending';
  const afterSeq=state.sharedNextSeq;state.sharedPending={requestId,state:'submitting',text,attachmentIds,afterSeq,intent};
  effects.updateComposer();effects.status('正在提交到电脑会话…');effects.renderSharedConversation();effects.scrollBottom(true);
  try{const result=await effects.nativeCall('shared.send',{sessionId,text,requestId,intent,...(attachmentIds.length?{attachmentIds}:{})});
    if(!sharedViewCurrent(owner,epoch,generation,sessionId)||optimistic.status==='accepted')return;
    if(result?.source!=='host'||result.sessionId!==sessionId||result.requestId!==requestId)throw new Error('OPERATION_FAILED');
    if(result.command?.requestId===requestId&&acceptSharedCommand(result.command)){void effects.loadSharedHistory();return;}
    if(result.state==='accepted'){
      optimistic.status='accepted';
      void core.accessApi(`/commands/by-request/${encodeURIComponent(requestId)}`).then(found=>{
        if(!sharedViewCurrent(owner,epoch,generation,sessionId))return;
        core.reconcileOptimistic(found.command);core.observeOptimistic(state.sharedEvents);effects.renderSharedConversation();
      }).catch(()=>{});
      state.sharedPending=null;
      try{if(environment.storage.getItem(key)?.trim()===text)environment.storage.removeItem(key)}catch{}
      if(effects.readMessageDraft().trim()===text)effects.clearMessageDraft();
      effects.clearAcceptedHostAttachments(attachmentIds);
      effects.status('电脑已受理消息，等待会话记录更新');waitForSharedTurn(sessionId,text,afterSeq,attachmentIds);void effects.loadSharedHistory();
    }else if(result.state==='uncertain'){optimistic.status='failed';state.sharedPending={requestId,state:'uncertain',text,attachmentIds,afterSeq};
      effects.status('发送结果待核对 · 请求已保留，不会自动重发')}
    else{optimistic.status='failed';state.sharedPending=null;effects.status(effects.safeError(new Error(result.errorCode||'OPERATION_FAILED')),true)}
  }catch(e){if(!sharedViewCurrent(owner,epoch,generation,sessionId)||optimistic.status==='accepted')return;
    optimistic.status='failed';state.sharedPending=e?.message==='TIMEOUT'?{requestId,state:'uncertain',text,attachmentIds,afterSeq}:null;
    if(state.sharedPending)effects.status('发送结果待核对 · 请查看电脑会话或待处理记录');
    else effects.status(effects.safeError(e),true)}
  finally{if(sharedViewCurrent(owner,epoch,generation,sessionId)){effects.updateComposer();effects.renderSharedConversation();effects.scheduleSharedPoll()}}}

async function sendLinked(options={}){if(core.state.sessionSelecting||core.state.sideCreating)return;core.syncMobileIdentity();const intent=options.intent==='queue'||options.intent==='steer'?options.intent:core.composerInputMode(state.sharedSessionId);const binding=selectedBinding(),session=selectedSharedSession(),text=effects.readMessageDraft().trim();
  if(!binding||!session?.sendAvailable||!text||state.linkedPending||currentAttachments().length)return;
  const owner=state.owner,epoch=state.authEpoch,conversationId=state.conversationId,
    sessionId=binding.sessionId,key=`weftmate-linked-send:${owner}:${conversationId}`;
  let marker;try{marker=JSON.parse(environment.storage.getItem(key)||'null')}catch{marker=null}
  if(marker&&(marker.sessionId!==sessionId||marker.text!==text)){effects.status('上一条电脑消息待核对；原草稿仍保留',true);return}
  marker ||= {requestId:newSharedRequestId(),sessionId,text,intent};
  try{environment.storage.setItem(key,JSON.stringify(marker))}catch{effects.status('无法保存发送编号，本次没有提交',true);return}
  state.linkedPending=marker.requestId;effects.updateComposer();
  const current=()=>state.owner===owner&&state.authEpoch===epoch&&state.chatSource==='phone'&&
    state.conversationId===conversationId&&selectedBinding()?.sessionId===sessionId;
  try{const rows=await effects.nativeCall('shared.outbox.list');if(!current())return;
    let found=rows?.commands?.find(item=>item.requestId===marker.requestId&&item.sessionId===sessionId);
    if(!found||found.state==='pending'||found.state==='uncertain'){
      const sent=await effects.nativeCall('shared.send',{sessionId,text:marker.text,requestId:marker.requestId,intent:marker.intent||'queue'});
      if(!current())return;found=sent}
    if(found?.state==='accepted'){
      if(effects.readMessageDraft().trim()===text)effects.clearMessageDraft();
      try{environment.storage.removeItem(key);environment.storage.removeItem(draftKey())}catch{}
      effects.status('电脑已受理，等待真实回复');await Promise.all([refreshHandoff(conversationId),loadLinkedHistory(conversationId)])
    }else effects.status('结果待核对；原请求编号和草稿已保留',true)
  }catch(error){if(current())effects.status(error?.message==='TIMEOUT'?'发送结果待核对；原请求编号已保留':effects.safeError(error),true)}
  finally{if(state.owner===owner&&state.authEpoch===epoch){state.linkedPending=null;effects.updateComposer()}}}

async function send(options={}){if(core.folderMutationPending?.())return;if(state.chatSource==='host')return sendShared(options);
  if(selectedBinding())return sendLinked(options);
  const text=effects.readMessageDraft().trim(),items=[...currentAttachments()];if((!text&&!items.length)||state.busy||state.sendUncertain)return;
  if(text.length>16384){effects.status('消息过长，请缩短后发送',true);return}
  const owner=state.owner,epoch=state.authEpoch,conversationId=state.conversationId||'',attachmentIds=items.map(item=>item.attachmentId);
  const attempt={owner,epoch,conversationId,key:attachmentKey(),draftKey:draftKey(),text,acceptedId:null,turnId:null,adopted:false};
  state.activeSend=attempt;state.lastTerminal=null;state.busy=true;effects.updateComposer();effects.status('消息正在保存…');
  try{const result=await effects.nativeCall('chat.send',{conversationId,text,attachmentIds});
    if(state.activeSend!==attempt||owner!==state.owner||epoch!==state.authEpoch)return;
    if(!result?.conversationId)throw new Error('OPERATION_FAILED');
    if(!acceptSend(attempt,result.conversationId,result.turnId))return;
    const terminal=state.lastTerminal?.conversationId===result.conversationId&&
      (!result.turnId||!state.lastTerminal.turnId||state.lastTerminal.turnId===result.turnId);
    if(!terminal)effects.status('手机模型正在回复…');
    await effects.listConversations();await effects.renderConversation();effects.scrollBottom();
    if(terminal&&['failed','cancelled'].includes(state.lastTerminal.status))effects.refreshAttachmentDrafts();
    if(state.activeSend===attempt)state.activeSend=null;
  }catch(e){if(state.activeSend!==attempt||owner!==state.owner||epoch!==state.authEpoch)return;
    if(attempt.acceptedId){if(state.lastTerminal?.conversationId!==attempt.acceptedId)effects.status('手机模型正在回复…');
      state.activeSend=null;return}
    state.busy=false;state.sendUncertain=e?.message==='TIMEOUT';effects.updateComposer();
    if(state.sendUncertain){effects.toast('发送结果尚未确认，请从会话列表核对；不会自动重发',true);
      effects.status('发送结果待确认 · 请在会话列表核对后继续')}
    else effects.status(effects.safeError(e),true);
    if(!state.sendUncertain)state.activeSend=null}}

async function stop(){if(state.chatSource==='host'||selectedBinding()){
    core.syncMobileIdentity();
    if(core.taskQueue().some(row=>row.state==='running'&&!row.taskId.startsWith('turn-')))return core.stopCurrentTurn();
    if(state.sharedStopping||!selectedSharedSession()?.sendAvailable)return;
    const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration,sessionId=state.sharedSessionId,
      requestId=newSharedRequestId();state.sharedStopping=true;effects.status('正在请求电脑停止…');
    try{const result=await effects.nativeCall('shared.stop',{sessionId,requestId});if(!sharedViewCurrent(owner,epoch,generation,sessionId))return;
      if(result?.source!=='host'||result.sessionId!==sessionId||result.requestId!==requestId)throw new Error('COMMAND_RECEIPT_INVALID');
      effects.status(result.state==='accepted'?'电脑已受理停止请求，等待回合状态':
        result.state==='uncertain'?'停止结果待核对，请查看电脑会话':effects.safeError(new Error(result.errorCode||'OPERATION_FAILED')),
        result.state==='rejected')}
    catch(e){if(sharedViewCurrent(owner,epoch,generation,sessionId))effects.status(e?.message==='TIMEOUT'?'停止结果待核对，请查看电脑会话':effects.safeError(e),e?.message!=='TIMEOUT')}
    finally{state.sharedStopping=false;if(sharedViewCurrent(owner,epoch,generation,sessionId))effects.scheduleSharedPoll()}return}
  try{await effects.nativeCall('chat.stop');effects.status('已请求停止，等待本轮状态')}catch(e){effects.status(effects.safeError(e),true)}}

function emptyMemoryState(scope=''){return {scope,flow:0,view:'list',target:null,kind:'all',totalCount:null,query:'',queryDraft:'',
  statusState:'idle',reasonCode:'',capabilities:{list:false,source:false,inject:null},pendingBoundaryCount:null,blockedBoundaryCount:null,discardedBoundaryCount:null,lastFailureCode:'',
  statusWorldRevision:null,worldRevision:null,detailRevision:null,refreshOnReturn:false,boundOwnerId:null,boundScope:'',
  items:[],nextCursor:null,hasMore:false,loading:false,error:'',selectedItem:null,detail:null,sources:[],
  detailLoading:false,sourcesLoading:false,detailError:'',sourceError:'',confirmation:null,correctionDraft:'',
  activeOperation:null,pendingMarker:null,checkingReceipt:false,receiptMessage:'',receiptRequestId:'',receiptItemId:null,reopenAfterRefresh:null}}

function memoryToken(){const memory=state.memory;return {generation:state.generation,scope:state.owner||'',authEpoch:state.authEpoch,flow:memory?.flow}}

function memoryCurrent(token){return !!token&&state.page==='memory'&&state.generation===token.generation&&
  state.owner===token.scope&&state.authEpoch===token.authEpoch&&state.loggedIn&&!state.transitionPending&&
  state.memory?.scope===token.scope&&state.memory?.flow===token.flow}

function memoryFailureText(error){const code=error?.message||'OPERATION_FAILED';
  if(code==='MEMORY_REVISION_CHANGED')return '记忆已在电脑上更新。为避免显示旧结果，请刷新后重新读取。';
  if(code==='MEMORY_SEARCH_LIMIT')return '该类别的记忆规模超过服务端完整快照上限；服务端没有返回部分数据。请切换类别，或在电脑端查看。';
  if(code==='MEMORY_OWNER_MISMATCH'||code==='ACCOUNT_IDENTITY_MISMATCH')return '账户身份核对失败，记忆内容已清除。请重新检查账户连接。';
  if(code==='MEMORY_CONNECTION_UNVERIFIED')return '电脑尚未在线核对当前账户；为避免显示旧缓存，请连接后重新读取。';
  if(code==='MEMORY_PATH_TOO_LONG')return '搜索词或分页标识超过手机版接口长度限制；请缩短关键词后刷新重试。';
  if(code==='LOGIN_REQUIRED'||code==='UNAUTHORIZED'||code==='AUTH_REQUIRED')return '电脑账户连接已失效，请重新连接后查看记忆。';
  if(code==='MEMORY_INVALID_RESPONSE')return '记忆服务返回了无法识别的数据；请稍后刷新重试。';
  if(code==='MEMORY_ACTION_UNSUPPORTED')return '当前记忆不能执行这项操作；请刷新详情核对可用能力。';
  if(code==='MEMORY_DELETE_UNAVAILABLE')return '当前账户的记忆删除能力暂不可用。';
  if(code==='MEMORY_UNAVAILABLE'||code==='MEMORY_DISABLED')return '记忆服务当前不可用，本次操作未提交。';
  if(code==='MEMORY_REQUEST_CONFLICT')return '请求标识与已保存内容冲突，本次未提交。';
  if(code==='MEMORY_REPLAY_REDACTED')return '旧请求正文已不可重放，本次未提交。';
  if(code==='BUSINESS_RESPONSE_INVALID'||code==='BUSINESS_RESPONSE_TOO_LARGE'||code==='MEMORY_RESPONSE_TOO_LARGE')
    return '服务端返回内容超过手机可安全显示的范围；请在电脑端查看完整记忆与来源。';
  if(code==='NATIVE_UNAVAILABLE'||code==='TIMEOUT'||code==='OPERATION_FAILED')return '电脑记忆服务暂时不可达；手机对话仍可继续。请重新读取。';
  return effects.safeError(error)}

function memoryFail(token,error,target=state.memory?.target,{keepItems=false}={}){
  if(!memoryCurrent(token))return;
  const memory=state.memory;memory.loading=false;memory.statusState='error';memory.error=memoryFailureText(error);
  memory.boundOwnerId=null;memory.boundScope='';memory.worldRevision=null;memory.nextCursor=null;memory.hasMore=false;
  if(!keepItems){memory.items=[];memory.selectedItem=null;memory.detail=null;memory.sources=[];memory.view='list'}
  if(target)effects.renderMemoryList(target)}

function memoryOwnerMatches(value,memory=state.memory){return !!value&&typeof value.ownerId==='string'&&value.ownerId.length>0&&
  !!memory?.boundOwnerId&&value.ownerId===memory.boundOwnerId&&memory.boundScope===memory.scope}

function memoryRevisionMatches(value,memory=state.memory){return Number.isSafeInteger(value?.worldRevision)&&value.worldRevision===memory?.worldRevision}

function memoryPathEncode(value){return encodeURIComponent(value).replace(/%3A/gi,':').replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}

function memoryItemsPath(kind,query,after){try{const params=[`kind=${memoryPathEncode(kind)}`,'limit=20','includeSources=true'];
    if(query)params.push(`query=${memoryPathEncode(query)}`);if(after)params.push(`after=${memoryPathEncode(after)}`);
    const path=`/personal/v1/memory/items?${params.join('&')}`;return path.length<=512?path:null}catch{return null}}

function memoryListAllowed(memory=state.memory){return !!memory?.boundOwnerId&&memory.boundScope===memory.scope&&memory.capabilities.list===true&&
  ['ready','recovering','degraded'].includes(memory.statusState)}

function startMemorySnapshot(target,kind,query){if(!Object.hasOwn(MEMORY_KINDS,kind)){return}
  if(typeof query!=='string'||[...query].length>120){const memory=state.memory;memory.error='搜索内容最多120个字符，请缩短后重试。';memory.loading=false;effects.renderMemoryList(target);return}
  if(state.memory.scope!==(state.owner||''))state.memory=emptyMemoryState(state.owner||'');
  const memory=state.memory;memory.flow++;memory.target=target;memory.view='list';memory.kind=kind;memory.query=query;
  memory.queryDraft=query;memory.statusState='loading';memory.reasonCode='';memory.capabilities={list:false,source:false};
  memory.statusWorldRevision=null;memory.worldRevision=null;memory.detailRevision=null;memory.refreshOnReturn=false;
  memory.boundOwnerId=null;memory.boundScope='';memory.items=[];memory.nextCursor=null;memory.hasMore=false;
  memory.selectedItem=null;memory.detail=null;memory.sources=[];memory.detailLoading=false;memory.sourcesLoading=false;
  memory.detailError='';memory.sourceError='';memory.error='';memory.loading=true;effects.renderMemoryList(target);
  const token=memoryToken();void loadMemorySnapshot(target,token)}

async function loadMemorySnapshot(target,token){try{
    const profile=await effects.nativeCall('auth.me');if(!memoryCurrent(token))return;
    if(profile?.connectionVerified!==true||typeof profile.owner!=='string'||profile.owner!==token.scope){
      memoryFail(token,new Error(profile?.connectionVerified===false?'MEMORY_CONNECTION_UNVERIFIED':'MEMORY_OWNER_MISMATCH'),target);return}
    const statusResult=await business({path:'/personal/v1/memory/status',method:'GET'});
    if(!memoryCurrent(token))return;
    const canList=statusResult&&['ready','recovering','degraded'].includes(statusResult.state)&&statusResult.capabilities?.list===true;
    if(typeof statusResult?.ownerId!=='string'||!statusResult.ownerId||!Object.hasOwn(statusResult,'worldRevision')||
      !(statusResult.worldRevision===null||Number.isSafeInteger(statusResult.worldRevision))||
      (canList&&!Number.isSafeInteger(statusResult.worldRevision))||
      !['ready','recovering','degraded','disabled','unavailable'].includes(statusResult.state)||!statusResult.capabilities||typeof statusResult.capabilities!=='object'){
      throw new Error('MEMORY_INVALID_RESPONSE')}
  const memory=state.memory;memory.healthStatus=statusResult;memory.boundOwnerId=statusResult.ownerId;memory.boundScope=token.scope;
    memory.statusWorldRevision=statusResult.worldRevision;memory.worldRevision=null;memory.statusState=statusResult.state;memory.reasonCode=statusResult.reasonCode||'';
    memory.capabilities={list:statusResult.capabilities.list===true,source:statusResult.capabilities.source===true,
      correct:statusResult.capabilities.correct===true,mute:statusResult.capabilities.mute===true,
      deleteWorldItem:statusResult.capabilities.deleteWorldItem===true,deleteEvidence:statusResult.capabilities.deleteEvidence===true,
      inject:typeof statusResult.capabilities.inject==='boolean'?statusResult.capabilities.inject:null};
    memory.pendingBoundaryCount=Number.isSafeInteger(statusResult.pendingBoundaryCount)&&statusResult.pendingBoundaryCount>=0?
      statusResult.pendingBoundaryCount:null;
    memory.blockedBoundaryCount=Number.isSafeInteger(statusResult.blockedBoundaryCount)&&statusResult.blockedBoundaryCount>=0?
      statusResult.blockedBoundaryCount:null;
    memory.discardedBoundaryCount=Number.isSafeInteger(statusResult.discardedBoundaryCount)&&statusResult.discardedBoundaryCount>=0?
      statusResult.discardedBoundaryCount:null;
    memory.lastFailureCode=typeof statusResult.lastFailureCode==='string'?statusResult.lastFailureCode:'';
    memory.loading=false;
    if(!memoryListAllowed(memory)){effects.renderMemoryList(target);return}
    memory.loading=true;effects.renderMemoryList(target);await loadMemoryItems(target,token,null,false);
  }catch(error){if(!memoryCurrent(token))return;memoryFail(token,error,target)}}

async function loadMemoryItems(target,token,after,append){if(!memoryCurrent(token))return;
  const memory=state.memory;const path=memoryItemsPath(memory.kind,memory.query,after);
  if(!path){memory.loading=false;memory.error=memoryFailureText(new Error('MEMORY_PATH_TOO_LONG'));
    if(!append){memory.items=[];memory.hasMore=false;memory.nextCursor=null}effects.renderMemoryList(target);return}
  memory.loading=true;memory.error='';effects.renderMemoryList(target);
  try{const result=await business({path,method:'GET'});if(!memoryCurrent(token))return;
    if(!memoryOwnerMatches(result,memory))throw new Error('MEMORY_OWNER_MISMATCH');
    if(!Number.isSafeInteger(result.worldRevision))throw new Error('MEMORY_INVALID_RESPONSE');
    if(append&&!memoryRevisionMatches(result,memory))throw new Error('MEMORY_REVISION_CHANGED');
    if(result.searchScope!=='account_snapshot'||!Array.isArray(result.items)||result.items.length>20||typeof result.hasMore!=='boolean'||
      result.items.some(item=>!item||typeof item.id!=='string'||!item.id||!MEMORY_KINDS[item.kind]||item.kind==='all'||memory.kind!=='all'&&item.kind!==memory.kind||typeof item.text!=='string'||
        !Number.isSafeInteger(item.sourceCount)||item.sourceCount<0))
      throw new Error('MEMORY_INVALID_RESPONSE');
    if(result.hasMore&&(typeof result.nextCursor!=='string'||!result.nextCursor))throw new Error('MEMORY_INVALID_RESPONSE');
    if(!append)memory.worldRevision=result.worldRevision;
    const prior=append?memory.items:[];const seen=new Set(prior.map(item=>`${item.kind}:${item.id}`));
    memory.items=[...prior,...result.items.filter(item=>!seen.has(`${item.kind}:${item.id}`))];memory.nextCursor=result.hasMore?result.nextCursor:null;
    if(memory.kind==='all')memory.totalCount=Number.isSafeInteger(result.totalCount)?result.totalCount:null;
    memory.hasMore=result.hasMore;memory.loading=false;memory.error='';effects.renderMemoryList(target);
    if(!append&&memory.reopenAfterRefresh){const {kind,id}=memory.reopenAfterRefresh;
      memory.reopenAfterRefresh=null;const item=memory.items.find(value=>value.kind===kind&&value.id===id);
      if(item)openMemoryDetail(target,item)}
  }catch(error){if(!memoryCurrent(token))return;memoryFail(token,error,target)}}

function loadMemoryMore(target){const memory=state.memory;if(!memory.hasMore||!memory.nextCursor||memory.loading||!memoryListAllowed(memory))return;
  memory.flow++;const token=memoryToken();void loadMemoryItems(target,token,memory.nextCursor,true)}

function memoryPathIdSupported(id){return typeof id==='string'&&id!=='.'&&id!=='..'&&/^[A-Za-z0-9._:-]{1,512}$/.test(id)}

function memoryMarkerKey(){return state.owner?`weftmate-mobile-memory-request:${state.owner}`:null}

function savedMemoryMarker(){const key=memoryMarkerKey();if(!key)return null;
  try{const marker=JSON.parse(environment.storage.getItem(key)||'null');return marker&&
    /^[A-Za-z0-9_.:-]{1,128}$/.test(marker.requestId)&&
    ['correct','mute','deleteItem','deleteEvidence'].includes(marker.operation)&&
    typeof marker.id==='string'&&memoryPathIdSupported(marker.id)?marker:null}catch{return null}}

function persistMemoryMarker(marker){const key=memoryMarkerKey();if(!key)return false;
  try{environment.storage.setItem(key,JSON.stringify(marker));return true}catch{return false}}

function clearMemoryMarker(marker){const key=memoryMarkerKey();if(!key)return;
  try{if(savedMemoryMarker()?.requestId===marker.requestId)environment.storage.removeItem(key)}catch{}}

function newMemoryRequestId(){return `memory-ui-${Date.now().toString(36)}-${(++requestSequence).toString(36)}-${Math.random().toString(36).slice(2,10)}`}

function memoryActionAllowed(operation,source=null){const memory=state.memory,global=memory?.capabilities,detail=memory?.detail;
  if(!memoryListAllowed(memory)||!detail||!Number.isSafeInteger(memory.detailRevision)||
    memory.detailRevision!==memory.worldRevision||memory.activeOperation||memory.pendingMarker||savedMemoryMarker())return false;
  if(operation==='deleteEvidence')return global.deleteEvidence===true&&source&&memoryPathIdSupported(source.evidenceId)&&
    !['evidence_deleted','evidence_missing','evidence_subject_mismatch'].includes(source.currentnessState);
  if(operation==='correct'&&detail.item?.kind==='entity')return false;
  const globalKey=operation==='deleteItem'?'deleteWorldItem':operation,
    detailKey=operation==='deleteItem'?'delete':operation;
  return global[globalKey]===true&&detail.availableActions?.[detailKey]?.available===true}

function openMemoryDetail(target,item){if(!memoryListAllowed()||!item||!Object.hasOwn(MEMORY_KINDS,item.kind))return;
  const memory=state.memory;memory.flow++;memory.view='detail';memory.selectedItem=item;memory.detail=null;memory.sources=[];
  memory.detailLoading=false;memory.sourcesLoading=false;memory.detailError='';memory.sourceError='';memory.confirmation=null;
  if(memory.receiptItemId&&memory.receiptItemId!==item.id&&!memory.pendingMarker){
    memory.receiptMessage='';memory.receiptRequestId='';memory.receiptItemId=null}
  const token=memoryToken();effects.renderMemoryDetail(target,token);
  if(!memoryPathIdSupported(item.id)){memory.detailError='当前手机版无法打开这条来源；记忆仍保留在列表中。';effects.renderMemoryDetail(target,token);return}
  if(memory.capabilities.source)void loadMemoryDetail(target,token,item);else{
    memory.detailError='当前手机版暂不能读取此项的详情与来源。';effects.renderMemoryDetail(target,token)}}

async function loadMemoryDetail(target,token,item){if(!memoryCurrent(token))return;const memory=state.memory;
  memory.detailLoading=true;memory.sourcesLoading=true;effects.renderMemoryDetail(target,token);
  const base=`/personal/v1/memory/items/${memoryPathEncode(item.kind)}/${memoryPathEncode(item.id)}`;
  if(`${base}/sources`.length>512){if(!memoryCurrent(token))return;memory.detailLoading=false;memory.sourcesLoading=false;
    memory.detailError='当前手机版无法打开这条来源：路径超过接口长度限制。';effects.renderMemoryDetail(target,token);return}
  try{const detail=await business({path:base,method:'GET'});if(!memoryCurrent(token))return;
    if(!memoryOwnerMatches(detail,memory))throw new Error('MEMORY_OWNER_MISMATCH');
    if(!Number.isSafeInteger(detail.worldRevision))throw new Error('MEMORY_INVALID_RESPONSE');
    if(!detail.item||detail.item.id!==item.id||detail.item.kind!==item.kind||typeof detail.item.text!=='string'||
      !Number.isSafeInteger(detail.item.sourceCount)||detail.item.sourceCount<0)throw new Error('MEMORY_INVALID_RESPONSE');
    if(detail.worldRevision!==memory.worldRevision){memory.items=[];memory.nextCursor=null;memory.hasMore=false;memory.refreshOnReturn=true}
    memory.worldRevision=detail.worldRevision;memory.detailRevision=detail.worldRevision;
    memory.detail=detail;memory.detailLoading=false;effects.renderMemoryDetail(target,token);
    const sourcePath=`${base}/sources`;const sources=await business({path:sourcePath,method:'GET'});if(!memoryCurrent(token))return;
    if(!memoryOwnerMatches(sources,memory))throw new Error('MEMORY_OWNER_MISMATCH');
    if(sources.worldRevision!==memory.detailRevision)throw new Error('MEMORY_REVISION_CHANGED');
    if(!Array.isArray(sources.sources))throw new Error('MEMORY_INVALID_RESPONSE');
    memory.sources=sources.sources;memory.sourcesLoading=false;memory.sourceError='';effects.renderMemoryDetail(target,token);
  }catch(error){if(!memoryCurrent(token))return;memoryFail(token,error,target)}}

function memoryReceiptMessage(receipt,operation){if(receipt.state==='no_change')return '服务端确认没有发生变更；已重新读取当前记忆。';
  if(operation==='correct')return '纠正已应用；已重新读取当前记忆与来源。';
  if(operation==='mute')return '记忆已停用，不再参与后续召回；原内容和来源仍可查看。';
  if(receipt.storageCleanup?.state==='pending')return '已从当前有效记忆与召回移除；底层清理仍待完成。原聊天、会话存档和既有备份仍可能保留。';
  return '已从当前有效记忆与召回移除；原聊天、会话存档和既有备份仍可能保留。'}

function memoryReceiptRejected(receipt){return ({MEMORY_DELETE_CONFLICT:'来源或依赖关系存在冲突，本次未删除；可查看来源或选择停用。',
  MEMORY_SOURCE_UNRECOVERABLE:'旧来源身份已不可恢复，本次未删除。',
  MEMORY_DELETE_SOURCE_UNKNOWN:'来源身份无法确认，本次未删除。'}[receipt.reasonCode]||
  '服务端拒绝了本次操作；当前记忆已重新读取。')}

function handleMemoryReceipt(receipt,marker,token){if(!memoryCurrent(token)||!receipt||receipt.requestId!==marker.requestId||
  !['applied','no_change','revision_conflict','rejected'].includes(receipt.state)||
  !Number.isSafeInteger(receipt.worldRevision))return false;
  const memory=state.memory;clearMemoryMarker(marker);memory.pendingMarker=null;memory.activeOperation=null;
  memory.checkingReceipt=false;memory.confirmation=null;memory.receiptRequestId=marker.requestId;
  memory.receiptItemId=marker.itemId;
  memory.receiptMessage=receipt.state==='revision_conflict'?
    '记忆已在其他设备更新，本次未应用；已刷新当前列表，请核对后重新提交。':
    receipt.state==='rejected'?memoryReceiptRejected(receipt):memoryReceiptMessage(receipt,marker.operation);
  if(marker.operation==='correct'&&['applied','no_change'].includes(receipt.state))memory.correctionDraft='';
  memory.reopenAfterRefresh=['correct','mute','deleteEvidence'].includes(marker.operation)&&
    receipt.state!=='revision_conflict'&&receipt.state!=='rejected'?{kind:marker.kind,id:marker.itemId}:null;
  memory.items=[];memory.detail=null;memory.sources=[];memory.selectedItem=null;memory.worldRevision=null;
  const target=memory.target,kind=memory.kind,query=memory.query;memory.flow++;memory.view='list';
  startMemorySnapshot(target,kind,query);return true}

async function reconcileMemoryMarker(marker=state.memory?.pendingMarker){const memory=state.memory;
  if(!marker||!memory||memory.checkingReceipt||!memoryCurrent(memoryToken()))return;
  const token=memoryToken();memory.checkingReceipt=true;memory.receiptMessage='正在查询原请求回执…';
  if(memory.view==='detail')effects.renderMemoryDetail(memory.target,token);else effects.renderMemoryList(memory.target);
  try{const result=await business({path:`/personal/v1/memory/commands/by-request/${memoryPathEncode(marker.requestId)}`,method:'GET'});
    if(!memoryCurrent(token))return;
    if(!handleMemoryReceipt(result?.receipt,marker,token)){
      memory.receiptMessage='回执内容无法确认；原请求仍保留，不会自动重发。';
      memory.checkingReceipt=false;if(memory.view==='detail')effects.renderMemoryDetail(memory.target,token);else effects.renderMemoryList(memory.target)}}
  catch{if(!memoryCurrent(token))return;memory.checkingReceipt=false;
    memory.receiptMessage='原请求结果仍待确认。请稍后核对回执；不会自动重发。';
    if(memory.view==='detail')effects.renderMemoryDetail(memory.target,token);else effects.renderMemoryList(memory.target)}}

async function previewMemoryForget(choice){const memory=state.memory,token=memoryToken();
  choice.deleteConversationSnippets=false;choice.preview=null;choice.previewError='';
  const kind=choice.operation==='deleteEvidence'?'evidence':memory.detail.item.kind,
    id=choice.operation==='deleteEvidence'?choice.id:memory.detail.item.id;
  const path=`/personal/v1/memory/${kind==='evidence'?'evidence':`items/${memoryPathEncode(kind)}`}/${memoryPathEncode(id)}/forget-preview`;
  try{const result=await business({path,method:'GET'});
    if(!memoryCurrent(token)||memory.confirmation!==choice)return;
    if(result.worldRevision!==memory.detailRevision)throw {code:'MEMORY_REVISION_CHANGED'};
    choice.preview=result;
  }catch(error){if(!memoryCurrent(token)||memory.confirmation!==choice)return;
    choice.previewError='无法读取遗忘范围，请取消后重新打开。';}
  effects.renderMemoryDetail(memory.target,token)}
core.mobilePreviewMemoryForget=previewMemoryForget;
async function submitMemoryAction(operation,evidenceId=null,correction=''){const memory=state.memory,detail=memory?.detail;
  if(!detail||!memoryCurrent(memoryToken())||!memoryActionAllowed(operation,
    operation==='deleteEvidence'?memory.sources.find(source=>source.evidenceId===evidenceId):null))return;
  const text=correction.trim();if(operation==='correct'&&(!text||text.length>4000)){
    memory.detailError='纠正内容须为 1–4000 个字符。';effects.renderMemoryDetail(memory.target);return}
  if(['deleteItem','deleteEvidence'].includes(operation)&&memory.confirmation?.confirmText?.trim()!=='删除')return;
  if(['deleteItem','deleteEvidence'].includes(operation)&&memory.confirmation?.preview?.worldRevision!==memory.detailRevision)return;
  const deleteConversationSnippets=memory.confirmation?.deleteConversationSnippets===true;
  const requestId=newMemoryRequestId(),kind=detail.item.kind,itemId=detail.item.id,
    id=operation==='deleteEvidence'?evidenceId:itemId,revision=memory.detailRevision;
  if(!Number.isSafeInteger(revision)||!memoryPathIdSupported(id))return;
  const marker={requestId,operation,kind,id,itemId};
  if(!persistMemoryMarker(marker)){memory.detailError='无法保存回执查询标识；本次没有提交。';effects.renderMemoryDetail(memory.target);return}
  memory.pendingMarker=marker;memory.activeOperation=marker;memory.detailError='';memory.confirmation=null;
  memory.receiptItemId=itemId;memory.receiptMessage='正在提交操作并等待回执…';const token=memoryToken();effects.renderMemoryDetail(memory.target,token);
  const base=operation==='deleteEvidence'?`/personal/v1/memory/evidence/${memoryPathEncode(id)}`:
    `/personal/v1/memory/items/${memoryPathEncode(kind)}/${memoryPathEncode(id)}`;
  const path=operation==='correct'?`${base}/correct`:operation==='mute'?`${base}/mute`:base,
    method=['deleteItem','deleteEvidence'].includes(operation)?'DELETE':'POST',
    body={requestId,expectedWorldRevision:revision,...(operation==='correct'?{text}:{}),
      ...(['deleteItem','deleteEvidence'].includes(operation)?{deleteConversationSnippets}:{})};
  try{const result=await business({path,method,body});if(!memoryCurrent(token))return;
    if(!handleMemoryReceipt(result?.receipt,marker,token)){
      memory.activeOperation=null;memory.receiptMessage='回执内容无法确认；原请求仍待核对，不会自动重发。';
      effects.renderMemoryDetail(memory.target,token)}}
  catch(error){if(!memoryCurrent(token))return;memory.activeOperation=null;
    if(['UNAUTHORIZED','FORBIDDEN','INVALID_REQUEST','NOT_FOUND','MEMORY_DISABLED','MEMORY_UNAVAILABLE',
      'MEMORY_ACTION_UNSUPPORTED','MEMORY_DELETE_UNAVAILABLE','MEMORY_REQUEST_CONFLICT','MEMORY_REPLAY_REDACTED'].includes(error?.message)){
      clearMemoryMarker(marker);memory.pendingMarker=null;memory.receiptMessage=memoryFailureText(error);
      if(error?.message==='NOT_FOUND'||error?.message==='MEMORY_REVISION_CHANGED'){
        memory.items=[];memory.detail=null;memory.sources=[];memory.view='list';startMemorySnapshot(memory.target,memory.kind,memory.query)}
      else effects.renderMemoryDetail(memory.target,token);
      return}
    memory.receiptMessage='提交结果待确认，正在查询原请求回执；不会自动重发。';
    effects.renderMemoryDetail(memory.target,token);void reconcileMemoryMarker(marker)}}
  async function retryMemoryFormation(jobId, requestId) {
    const token=memoryToken();
    await business({path:`/personal/v1/memory/formation/${memoryPathEncode(jobId)}/retry`,method:'POST',body:{requestId}});
    if(memoryCurrent(token)) await startMemorySnapshot(state.memory.target,state.memory.kind,state.memory.query);
  }
  return { mobile: { business, retryMemoryFormation, composerState, draftKey, sharedDraftKey, attachmentConversationId, attachmentKey, currentAttachments, selectionKey, chatSourceKey, savedSharedSelection, hasAnyDraft, sharedViewCurrent, trackSharedAcceptedTurn, waitForSharedTurn, acceptSharedCommand, reconcileSharedDelivery, loadSharedOutbox, checkSharedPending, listConversations, selectedSharedSession, selectedBinding, matchingOriginalHostModels, refreshHandoffModelName, refreshHandoff, loadLinkedHistory, acceptSend, newSharedRequestId, sendShared, sendLinked, send, stop, emptyMemoryState, memoryToken, memoryCurrent, memoryFailureText, memoryFail, memoryOwnerMatches, memoryRevisionMatches, memoryPathEncode, memoryItemsPath, memoryListAllowed, startMemorySnapshot, loadMemorySnapshot, loadMemoryItems, loadMemoryMore, memoryPathIdSupported, memoryMarkerKey, savedMemoryMarker, persistMemoryMarker, clearMemoryMarker, newMemoryRequestId, memoryActionAllowed, openMemoryDetail, loadMemoryDetail, memoryReceiptMessage, memoryReceiptRejected, handleMemoryReceipt, reconcileMemoryMarker, submitMemoryAction } };
};
