/* Mobile sessions presentation and named ui-core actions. */
function stopSharedPoll(){clearTimeout(state.sharedPollTimer);state.sharedPollTimer=null}

function scheduleSharedPoll(){stopSharedPoll();if(state.chatSource!=='host'||state.page!=='chat'||document.visibilityState==='hidden')return;
  state.sharedPollTimer=setTimeout(async()=>{if(state.chatSource!=='host'||state.page!=='chat')return;
    await Promise.all([loadSharedHistory(),listSharedSessions()]);if(state.chatSource==='host')scheduleSharedPoll()},state.sharedRunning?3000:12000)}

function selectSharedSession(sessionId){if(!state.sharedSessions.some(item=>item.sessionId===sessionId))return;
  const listed=state.sharedSessions.find(item=>item.sessionId===sessionId);
  const linked=state.conversations.find(item=>item.id===listed?.conversationId||item.binding?.sessionId===sessionId||
    state.handoffViews.get(item.id)?.binding?.sessionId===sessionId);
  if(linked){selectConversation(linked.id);return}
  closeImagePreview({restoreFocus:false});invalidateLiveProgress();stopSharedPoll();clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;state.sharedGeneration++;state.chatSource='host';state.restorePending=false;state.sharedSessionId=sessionId;state.scrollPinned=true;
  try{localStorage.setItem(chatSourceKey(),JSON.stringify({source:'host',sessionId}))}catch{}status('');closeToast();
  state.sharedEvents=[];state.sharedNextSeq=-1;state.sharedHasOlder=false;state.sharedNextBeforeSeq=null;state.sharedOlderLoading=false;state.sharedLoading=false;state.sharedRunning=!!selectedSharedSession()?.running;
  state.sharedError='';state.sharedPending=null;state.sharedOutboxLoading=true;state.sharedAwaiting=null;state.sharedChecking=null;
  loadDraft();page('chat');void loadSharedOutbox()}

function sharedViewCurrent(...args){return uiCore.mobile.sharedViewCurrent(...args)}

function trackSharedAcceptedTurn(...args){return uiCore.mobile.trackSharedAcceptedTurn(...args)}

function waitForSharedTurn(...args){return uiCore.mobile.waitForSharedTurn(...args)}

function renderSharedConversation(){if(state.chatSource!=='host'||state.page!=='chat')return;
  uiCore.syncMobileIdentity();
  const scroll=$('chat-scroll'),previousScroll=scroll.scrollTop,content=$('chat-content'),saved=retainTimeline(content);clear(content);
  const session=selectedSharedSession();updatePageHeader();olderControl(content);
  if(state.sharedError)content.append(el('div','shared-notice',state.sharedError));
  else if(!state.sharedHostAvailable)content.append(el('div','shared-notice','电脑暂不可达。已读取的内容仅供查看，新消息可能进入待核对状态。'));
  let lastTurn='',lastEndReasonKind='';for(const event of state.sharedEvents){
    if(event.type==='user.message'||event.type==='assistant.message'){
      const body=event.data?.text,images=event.type==='user.message'&&Array.isArray(event.data?.images)?event.data.images:[],
        originalFiles=event.type==='user.message'&&Array.isArray(event.data?.originalAttachments)?
          event.data.originalAttachments.map(normalizedSharedFile).filter(Boolean):[];
      if(typeof body==='string'&&body||images.length||originalFiles.length){
        const row=messageNode(event.type==='user.message'?'user':'assistant',typeof body==='string'?body:'');
        if(images.length){const gallery=el('div','message-thumbnails');let unavailable=0;
          const scope={owner:state.owner,epoch:state.authEpoch,source:'host',conversationId:state.sharedSessionId};
          for(const image of images){const url=['image/png','image/jpeg','image/webp','image/gif'].includes(image?.contentType)
            ?safeSessionPreviewUrl(image?.previewUrl,image?.attachmentId,state.sharedSessionId):null;
            if(!url){unavailable++;continue}
            const name=String(image.name||'图片').slice(0,120),button=el('button','message-thumbnail');button.type='button';
            button.setAttribute('aria-label',`预览电脑会话图片 ${name}`);
            if(inlineOriginalAllowed(image)){const thumb=el('img');thumb.src=url;thumb.alt='';thumb.loading='lazy';thumb.decoding='async';button.append(thumb)}
            else{const placeholder=el('span','message-image-placeholder');placeholder.setAttribute('aria-hidden','true');button.append(placeholder)}
            button.addEventListener('click',()=>openImagePreview(url,name,button,scope,
              {original:true,note:'这段电脑会话保存的原图',attachmentId:image.attachmentId}));gallery.append(button)}
          if(gallery.children.length){row.classList.add('message-has-images');
            if(!body)row.classList.add('message-image-only');row.append(gallery)}
          if(unavailable)row.append(el('small','message-attachment-note',`${unavailable} 张历史图片暂无法预览`))}
        if(originalFiles.length)appendSharedFiles(row,event,state.sharedSessionId);
        if(event.type==='user.message'&&receiptIdPattern.test(event.data?.receiptId||''))row.dataset.receiptId=event.data.receiptId;
        if(event.type==='user.message'&&uiCore.messageTaskLabel(event))row.append(el('small','message-state',uiCore.messageTaskLabel(event)));
        row.dataset.seq=String(event.seq);content.append(row);
        if(event.data?.truncated)content.append(el('p','message-state','这条电脑消息仅显示前一部分'))}}
    else if(event.type==='turn.started'){lastTurn='running';lastEndReasonKind=''}
    else if(event.type==='turn.ended'){lastTurn=event.data?.reason||'unknown';
      lastEndReasonKind=lastTurn==='error'&&event.data?.endReasonKind==='max-tokens'?'max-tokens':''}
  }
  state.sharedRunning=lastTurn==='running'||!!session?.running;
  if(lastTurn==='running'||state.sharedRunning)content.append(el('p','shared-turn-state','正在处理…'));
  else if(lastTurn&&lastTurn!=='completed')content.append(el('p','shared-turn-state',lastTurn==='error'&&lastEndReasonKind==='max-tokens'
    ?'本轮因输出限制结束，可继续对话。':{
      aborted:'电脑回合已停止',error:'电脑回合未完成',blocked:'电脑回合等待处理',unknown:'电脑回合状态待确认'}[lastTurn]||'电脑回合状态待确认'));
  if(state.sharedPending){const box=el('div','shared-notice',state.sharedPending.state==='uncertain'?
    '发送结果待核对。请求已在手机保留，不会自动生成另一条消息。':'正在提交到电脑会话…');
    if(state.sharedPending.state==='uncertain'){const check=el('button','shared-check',state.sharedChecking?'正在核对…':'检查状态');
      check.disabled=!!state.sharedChecking;check.addEventListener('click',()=>{void checkSharedPending()});box.append(check)}content.append(box)}
  if(!state.sharedEvents.length&&!state.sharedError)content.append(el('p','muted',state.sharedLoading?'正在读取电脑会话…':'这段会话还没有可显示的文字记录'));
  content.append(...saved);renderTimeline();renderConversationTasks();updateComposer();if(state.scrollPinned)scrollBottom();else scroll.scrollTop=previousScroll;}

function loadSharedHistory(){return uiCore.loadMobileHistory()}

function loadSharedOutbox(...args){return uiCore.mobile.loadSharedOutbox(...args)}

function checkSharedPending(...args){return uiCore.mobile.checkSharedPending(...args)}

async function renderConversation({silent=false}={}){if(state.page!=='chat')return;
  const id=state.conversationId,gen=state.generation,owner=state.owner,epoch=state.authEpoch;
  if(state.chatSource==='host'){renderSharedConversation();return}
  if(!id){showWelcome();return}try{const result=await call('conversations.messages',{conversationId:id});
    if(state.page!=='chat'||state.chatSource!=='phone'||state.conversationId!==id||state.generation!==gen||
      state.owner!==owner||state.authEpoch!==epoch||state.transitionPending)return;
    const content=$('chat-content'),saved=retainTimeline(content);clear(content);
    const previewScope={owner:state.owner,epoch:state.authEpoch,conversationId:id};
    const binding=selectedBinding(),view=state.handoffViews.get(id);
    const localByEvent=new Map(result.messages.filter(m=>typeof m.sourceEventId==='string')
      .map(m=>[m.sourceEventId,m]));
    for(const m of result.messages)if(!binding||Number.isSafeInteger(m.serverSeq)&&
      m.serverSeq<=binding.cutoverSyncSeq)content.append(messageNode(m.role,m.text,m.thumbnails,previewScope,m.messageId||m.id));
    if(binding){content.append(el('div','handoff-divider','从这里起，由电脑模型接着处理'));
      const adopted=new Map((Array.isArray(view?.adoptedMessages)?view.adoptedMessages:[])
        .filter(item=>item.state==='accepted_by_dsh'&&typeof item.receiptId==='string'&&
          typeof item.sourceSyncEventId==='string').map(item=>[item.receiptId,item.sourceSyncEventId]));
      const shown=new Set();
      for(const event of state.linkedEvents.get(id)?.events||[]){
        if(event.type==='user.message'){
          const sourceId=adopted.get(event.data?.receiptId),original=localByEvent.get(sourceId);
          if(original){const row=messageNode(original.role,original.text,original.thumbnails,
            previewScope,original.messageId||original.id);row.dataset.receiptId=event.data.receiptId;
            content.append(row);shown.add(sourceId);continue}}
        if(event.type!=='user.message'&&event.type!=='assistant.message')continue;
        const body=event.data?.text;if(typeof body!=='string'||!body.trim())continue;
        const row=messageNode(event.type==='user.message'?'user':'assistant',body);
        if(event.type==='user.message'&&receiptIdPattern.test(event.data?.receiptId||''))row.dataset.receiptId=event.data.receiptId;
        if(event.type==='user.message'&&uiCore.messageTaskLabel(event))row.append(el('small','message-state',uiCore.messageTaskLabel(event)));
        row.dataset.seq=String(event.seq);content.append(row);
      }
      const late=result.messages.filter(m=>Number.isSafeInteger(m.serverSeq)&&
        m.serverSeq>binding.cutoverSyncSeq&&!shown.has(m.sourceEventId)||m.serverSeq==null);
      if(late.length){content.append(el('div','handoff-divider','交接后才同步的手机记录 · 已保留，尚未自动并入电脑上下文'));
        for(const m of late)content.append(messageNode(m.role,m.text,m.thumbnails,previewScope,m.messageId||m.id))}
      const older=state.linkedEvents.get(id);if(older){state.sharedHasOlder=older.hasOlder===true;state.sharedNextBeforeSeq=older.nextBeforeSeq;olderControl(content)}content.append(handoffCard(id));
    }else content.append(handoffCard(id));
    for(const receipt of result.receipts||[]){const card=el('div','receipt');card.append(el('strong','',toolLabel(receipt.toolName)+' · '+receiptStatus(receipt.status)),el('p','',receipt.summary||''));content.append(card)}
    if(result.turnStatus==='running'&&state.busy)renderLiveProgress();
    else if(result.turnStatus==='cancelled'||result.turnStatus==='failed'){
      const failed=result.turnStatus==='failed';const card=el('div',`turn-recovery${failed?' error':''}`);
      card.append(el('p','message-state',failed?
        `本轮未完成 · ${turnFailure(result.turnErrorCode,result.upstreamHttpStatus)}。消息仍保存在手机；附件草稿可在下方移除或手动重试。`:
        '本轮已停止。附件草稿可在下方移除或手动重试。'));
      const retry=el('button','secondary turn-retry','编辑后重试');retry.type='button';retry.addEventListener('click',()=>{
        const draft=$('draft');const prior=[...result.messages].reverse().find(message=>message.role==='user')?.text;
        if(!draft.value.trim()&&prior)draft.value=prior;updateComposer();draft.focus()});card.append(retry);content.append(card);
      refreshAttachmentDrafts();
    }
    if(binding){content.append(...saved);renderTimeline(state.linkedEvents.get(id)?.events||[])}
    renderConversationTasks();
    if(binding)void refreshConversationTasks();
    if(result.turnStatus==='running'&&state.busy){if(state.scrollPinned)scheduleLiveMotion()}
    else scrollBottom();
  }catch(e){if(!silent&&state.owner===owner&&state.authEpoch===epoch&&state.page==='chat'&&
      state.chatSource==='phone'&&state.conversationId===id&&state.generation===gen)status(safeError(e),true)}}

function phaseLabel(value){return {waiting:'等待模型回复…',reasoning:'模型正在思考…',answering:'正在回复…',tool:'正在处理手机动作…'}[value]||'正在回复…'}

function scheduleLiveProgress(){if(liveProgressFrame||state.page!=='chat'||state.chatSource!=='phone'||!state.busy)return;
  const ticket={version:liveProgressVersion,conversationId:state.conversationId,owner:state.owner,
    epoch:state.authEpoch,generation:state.generation};liveProgressFrame=ticket;
  requestAnimationFrame(()=>{if(liveProgressFrame===ticket)liveProgressFrame=null;
    if(ticket.version!==liveProgressVersion||ticket.conversationId!==state.conversationId||
      ticket.owner!==state.owner||ticket.epoch!==state.authEpoch||ticket.generation!==state.generation||
      state.page!=='chat'||state.chatSource!=='phone'||!state.busy)return;
    renderLiveProgress()})}

function scheduleLiveMotion(){if(liveMotionFrame||state.page!=='chat'||state.chatSource!=='phone'||!state.busy)return;
  const ticket={version:liveProgressVersion,conversationId:state.conversationId,owner:state.owner,
    epoch:state.authEpoch,generation:state.generation};liveMotionFrame=ticket;
  requestAnimationFrame(timestamp=>{if(liveMotionFrame===ticket)liveMotionFrame=null;
    if(ticket.version!==liveProgressVersion||ticket.conversationId!==state.conversationId||
      ticket.owner!==state.owner||ticket.epoch!==state.authEpoch||ticket.generation!==state.generation||
      state.page!=='chat'||state.chatSource!=='phone'||!state.busy)return;
    const text=$('live-progress')?.querySelector('.live-progress-text');
    const textNode=text?._liveTextNode,target=state.progressText;
    if(textNode&&target.startsWith(textNode.data)&&textNode.data.length<target.length){
      if(liveRevealStart===null){liveRevealStart=timestamp;liveRevealLength=textNode.data.length}
      const elapsed=Math.max(0,timestamp-liveRevealStart);
      const end=Math.min(target.length,Math.max(textNode.data.length+1,
        liveRevealLength+Math.ceil((target.length-liveRevealLength)*Math.min(1,elapsed/32))));
      textNode.appendData(target.slice(textNode.data.length,end));
      if(end===target.length)liveRevealStart=null}
    else if(textNode&&textNode.data!==target){textNode.data=target;liveRevealStart=null}
    if(state.scrollPinned){const box=$('chat-scroll'),bottom=Math.max(0,box.scrollHeight-box.clientHeight);
      if(bottom>box.scrollTop+1){liveFollowTop=bottom;box.scrollTop=bottom}
      $('jump-latest').hidden=true}
    if(textNode&&textNode.data!==target)scheduleLiveMotion()})}

function renderLiveProgress(){if(state.page!=='chat'||state.chatSource!=='phone'||!state.busy)return;
  const content=$('chat-content');let node=$('live-progress');
  if(!node){node=el('article','message assistant');node.id='live-progress';
    const body=el('div','message-body');body.append(el('div','markdown live-progress-text'),el('p','message-state'));
    node.append(body);content.append(node)}
  const text=node.querySelector('.live-progress-text'),phase=node.querySelector('.message-state');
  if(!text._liveTextNode){text._liveTextNode=document.createTextNode('');text.append(text._liveTextNode)}
  const shown=text._liveTextNode.data,target=state.progressText;
  if(!target.startsWith(shown)||(globalThis.WeftMobileMotion?.reduced()??window.matchMedia('(prefers-reduced-motion: reduce)').matches)){
    if(shown!==target)text._liveTextNode.data=target;liveRevealStart=null}
  else if(shown!==target)scheduleLiveMotion();
  text.hidden=!state.progressText;const label=phaseLabel(state.phase);
  if(phase.textContent!==label)phase.textContent=label;
  if(state.scrollPinned){if((globalThis.WeftMobileMotion?.reduced()??window.matchMedia('(prefers-reduced-motion: reduce)').matches))scrollBottom();
    else scheduleLiveMotion()}}

function toolLabel(name){return {open_settings:'系统设置',open_app:'打开应用',list_launchable_apps:'应用列表'}[name]||'手机动作'}

function applyTheme(value){state.appearance=value;const systemDark=window.weftNative&&typeof state.nativeSystemDark==='boolean'?state.nativeSystemDark:systemThemeMedia.matches;const dark=value==='dark'||value==='system'&&systemDark;
  document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.colorScheme=dark?'dark':'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#262723':'#ffffff')}

function receiptStatus(name){return {dispatched:'已请求，待核对',observed:'已观察到结果',failed:'未完成',uncertain:'结果待确认'}[name]||'状态待确认'}

function listConversations(...args){return uiCore.mobile.listConversations(...args)}

function selectedSharedSession(...args){return uiCore.mobile.selectedSharedSession(...args)}

function selectedBinding(...args){return uiCore.mobile.selectedBinding(...args)}

function matchingOriginalHostModels(original,models){return uiCore.matchingOriginalPhoneModels({originalModel:original},models.map(item=>({...item,id:item.profileId,model:item.modelId}))).map(item=>models.find(model=>model.profileId===item.id))}

function refreshHandoffModelName(...args){return uiCore.mobile.refreshHandoffModelName(...args)}

function scheduleHandoffPoll(conversationId){clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;
  if(state.chatSource!=='phone'||state.page!=='chat'||state.conversationId!==conversationId||
    !state.loggedIn||state.transitionPending||document.visibilityState==='hidden')return;
  state.linkedPollTimer=setTimeout(()=>{void refreshHandoff(conversationId)},12000)}

function refreshHandoff(...args){return uiCore.mobile.refreshHandoff(...args)}

function loadLinkedHistory(...args){return uiCore.mobile.loadLinkedHistory(...args)}

function handoffIntentKey(id){return `weftmate-handoff:${state.owner}:${id}`}

function handoffCard(id){const view=state.handoffViews.get(id),binding=selectedBinding(),card=el('details','handoff-card');
  card.append(el('summary','',binding?'续聊设置':'在电脑继续'));
  if(binding){card.append(el('strong','','这条对话已在电脑继续'));
    const model=state.handoffModelNames.get(binding.modelProfileId)||
      state.sharedSessions.find(item=>item.sessionId===binding.sessionId)?.modelDisplayName;
    card.append(el('p','',`后续由${model||'已选电脑模型'}处理。手机原消息与图片仍在这里。`));
    if(binding.truncated||binding.omittedImages)card.append(el('p','handoff-caveat',
      `交接上下文已保留${binding.historyMessageCount||0}条文字记录${binding.truncated?'，更早内容未全部带入':''}${binding.omittedImages?'；旧图片仍可查看，未作为模型图片带入':''}。`));
    if(state.linkedEvents.get(id)?.tailUnknown)card.append(el('p','handoff-caveat','电脑暂不可达；以下为上次已读取的回复。'));
    if(state.linkedEvents.get(id)?.historyTruncated)card.append(el('p','handoff-caveat','较早的电脑消息尚未缓存在手机；重连后可继续补读。'));
    const tasks=el('button','secondary','查看这条对话的任务与成果');tasks.addEventListener('click',async()=>{
      const owner=state.owner,epoch=state.authEpoch;
      try{const result=await call('activity.list');if(state.owner!==owner||state.authEpoch!==epoch)return;
        const found=groupTaskActivities(result.activities||[]).find(item=>item.source==='host'&&item.conversationId===id);
        if(found)inlineTaskInfo(found.taskId||found.commandId,tasks);else page('chat')
      }catch{page('chat')}});card.append(tasks);
  }else if(view?.status==='creating'||view?.status==='uncertain'){
    card.append(el('strong','','正在核对电脑交接'),el('p','','原请求编号已保留；核对完成前不会再建一段会话。'));
    const retry=el('button','secondary','检查原请求');retry.addEventListener('click',()=>void refreshHandoff(id));card.append(retry);
  }else{
    const original=view?.originalModel;
    card.append(el('strong','','在电脑继续这条对话'),el('p','',original?.displayName
      ? `手机原用：${original.displayName}。请先核对电脑是否有同一模型；旧文字与图片仍保留。`
      : '旧对话没有可核对的原模型身份。不会自动换成另一电脑模型；请明确选择后再继续。'));
    const reason=view?.reasonCode;
    if(reason)card.append(el('p','handoff-caveat',reason==='LOCAL_TURN_RUNNING'?'等手机回复结束并同步后再试。':
      reason==='LOCAL_TURN_UNCONFIRMED'?'手机回合状态待核对，当前不能自动交接。':
        reason==='SOURCE_DEVICE_UPGRADE_REQUIRED'?'请先更新创建这条对话的手机应用。':'先让手机记录和图片完成同步。'));
    const start=el('button','secondary','选择电脑模型');start.disabled=view?.canAdopt!==true;
    start.addEventListener('click',async()=>{const owner=state.owner,epoch=state.authEpoch;
      state.handoffPickerOpen.add(id);
      try{const result=await call('models.host');if(state.owner!==owner||state.authEpoch!==epoch||state.conversationId!==id)return;
        const models=(result?.models||[]).filter(item=>item.configured===true&&typeof item.profileId==='string');
        if(!models.length){status('电脑尚无已配置的可用模型',true);return}
        const picker=el('div','handoff-picker');const label=el('label','','电脑模型');const select=el('select');
        const placeholder=el('option','','请选择电脑模型');placeholder.value='';select.append(placeholder);
        for(const model of models){const option=el('option','',model.displayName||model.profileId);option.value=model.profileId;select.append(option)}
        const matches=matchingOriginalHostModels(original,models);
        let pending;try{pending=JSON.parse(localStorage.getItem(handoffIntentKey(id))||'null')}catch{pending=null}
        const manual=state.handoffSelections.get(id);
        select.value=state.handoffSelections.has(id)
          ? models.some(item=>item.profileId===manual)?manual:''
          : pending?.modelProfileId
            ? models.some(item=>item.profileId===pending.modelProfileId)?pending.modelProfileId:''
            : matches.length===1?matches[0].profileId:'';
        label.append(select);picker.append(label,el('p','handoff-caveat',
          !original?'原模型身份未知，需由你明确选择。手机本机密钥不会迁移。':
            matches.length===1?'已找到与手机原模型可核对的同一配置，优先选中。':
              matches.length>1?'找到多个可核对的同一模型配置，请明确选择。':
                '电脑目录尚无可核对的原模型。此页只列出已配置项；你可先在电脑端核对配置，或明确选择别的模型。'));
        const directory=el('button','secondary','查看已配置电脑模型');directory.addEventListener('click',()=>{
          state.handoffPickerOpen.delete(id);page('models')});picker.append(directory);
        const confirm=el('button','primary','在电脑继续');confirm.disabled=!select.value;
        select.addEventListener('change',()=>{state.handoffSelections.set(id,select.value);confirm.disabled=!select.value});
        confirm.addEventListener('click',async()=>{
          const current=()=>state.owner===owner&&state.authEpoch===epoch&&state.conversationId===id;
          let intent;try{intent=JSON.parse(localStorage.getItem(handoffIntentKey(id))||'null')}catch{intent=null}
          if(intent&&intent.modelProfileId!==select.value){status('原交接请求仍待核对，请保持原模型选择',true);return}
          intent ||= {requestId:crypto.randomUUID(),modelProfileId:select.value};
          try{localStorage.setItem(handoffIntentKey(id),JSON.stringify(intent))}catch{status('无法保存原请求编号，本次没有提交',true);return}
          confirm.disabled=true;status('正在核对原对话交接…');
          try{const accepted=await call('shared.conversations.adopt',{conversationId:id,...intent});if(!current())return;
            if(accepted?.alreadyShared===true)status('这条原对话已接到电脑，已打开现有会话');
            else if(accepted?.status==='uncertain')status('交接结果待核对，已保留原请求编号',true);
            else status('正在接上电脑会话…');
            for(let i=0;i<10&&current();i++){const updated=await refreshHandoff(id);
              if(updated?.status==='active'){localStorage.removeItem(handoffIntentKey(id));
                state.handoffPickerOpen.delete(id);state.handoffSelections.delete(id);
                await listSharedSessions();status('已在原对话接上电脑模型');return}
              await new Promise(resolve=>setTimeout(resolve,400))}
          }catch(error){if(current())status(safeError(error),true)}finally{if(current())confirm.disabled=false}});
        picker.append(confirm);card.append(picker);start.hidden=true;
      }catch(error){if(state.owner===owner&&state.authEpoch===epoch)status(safeError(error),true)}});
    card.append(start)}
  return card}

function listSharedSessions(){uiCore.syncMobileIdentity();return uiCore.listMobileSessions()}

let archivedSessionView=false;
function mobileSessionMenu(session,confirming=false){
  const dialog=el('dialog','session-action-dialog');dialog.setAttribute('aria-label',confirming?'删除对话':'对话操作');
  dialog.append(el('h2','',confirming?'删除对话？':session.title||'新对话'));
  const notice=el('p','message-state');notice.setAttribute('role','alert');
  const close=()=>dialog.close();
  const run=async(button,action)=>{button.disabled=true;notice.textContent='';try{uiCore.syncMobileIdentity();await action();
    await listSharedSessions();if(!state.sharedSessions.some(item=>item.sessionId===state.sharedSessionId))page('home');close();
  }catch(error){notice.textContent=uiCore.sessionLifecycleMessage(error)}finally{button.disabled=false}};
  if(confirming){dialog.append(el('p','','这会永久删除对话、工作目录与经验，无法恢复。运行中的对话会先停止。'));
    const label=el('label','session-forget'),check=el('input');check.type='checkbox';label.append(check,document.createTextNode('同时忘掉从这段对话形成的记忆'));dialog.append(label);
    const remove=el('button','danger','永久删除');remove.type='button';remove.addEventListener('click',()=>{void run(remove,()=>uiCore.deleteSession(session.sessionId,check.checked))});dialog.append(remove);
  }else{const archive=el('button','secondary',session.archived?'恢复对话':'归档对话');archive.type='button';
    archive.addEventListener('click',()=>{void run(archive,()=>uiCore.archiveSession(session.sessionId,!session.archived))});
    const remove=el('button','danger','删除对话');remove.type='button';remove.addEventListener('click',()=>{close();mobileSessionMenu(session,true)});dialog.append(archive,remove)}
  const cancel=el('button','secondary','取消');cancel.type='button';cancel.addEventListener('click',close);dialog.append(notice,cancel);
  dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();globalThis.WeftMobileMotion?.reveal(dialog,'base');cancel.focus();
}
function renderConversationList(){const target=$('conversation-list'),previousScroll=target.scrollTop;clear(target);const filter=$('conversation-search').value.trim().toLocaleLowerCase();
  const toggle=el('button','secondary',archivedSessionView?'返回最近对话':'已归档');toggle.type='button';toggle.addEventListener('click',()=>{archivedSessionView=!archivedSessionView;renderConversationList()});target.append(toggle);
  target.setAttribute('aria-label','最近对话');
  const phone=state.conversations.filter(v=>!archivedSessionView&&typeof v?.id==='string'&&typeof v?.title==='string')
    .map(item=>({source:'phone',id:item.id,title:item.title,createdAt:item.updatedAt||item.createdAt,
      model:item.modelName||item.modelDisplayName||null,record:item}));
  const linkedIds=new Set(phone.map(item=>state.handoffViews.get(item.id)?.binding?.sessionId||
    item.record?.binding?.sessionId).filter(Boolean));
  const host=state.sharedSessions.filter(v=>(v.archived===true)===archivedSessionView&&v?.source==='host'&&typeof v.sessionId==='string'&&
    !linkedIds.has(v.sessionId)&&!phone.some(item=>item.id===v.conversationId))
    .map(item=>({source:'host',id:item.sessionId,title:item.title||'对话',createdAt:item.updatedAt||item.createdAt||item.attachedAt,
      model:item.modelName||item.modelDisplayName||item.modelProfileId||null,record:item}));
  const entries=[...phone,...host].filter(item=>!filter||`${item.title} ${item.model||''} ${item.source==='phone'?'手机':'电脑'}`.toLocaleLowerCase().includes(filter));
  entries.sort((a,b)=>{const at=Date.parse(a.createdAt||'')||0,bt=Date.parse(b.createdAt||'')||0;return bt-at});
  for(const item of entries){const selected=item.source==='phone'?state.chatSource==='phone'&&state.conversationId===item.id:
      state.chatSource==='host'&&state.sharedSessionId===item.id;
    const b=el('button',selected?'active':'');
    if(item.source==='phone')b.dataset.conversationId=item.id;else b.dataset.sessionId=item.id;
    b.append(el('strong','',item.title),
      el('small','',item.source==='phone'&&
        (state.handoffViews.get(item.id)?.status==='active'||item.record?.binding)
        ? '手机起步 · 电脑续聊' : `${item.model?`${item.model} · `:''}${item.source==='phone'?'手机执行':'电脑执行'}`));
    if(item.record.running||item.source==='phone'&&state.conversationId===item.id&&state.busy){const dot=el('span','session-running-dot');dot.setAttribute('aria-label','正在运行');b.children[0].append(dot)}
    let pressTimer=null,longPressed=false;
    if(item.source==='host'){
      b.addEventListener('pointerdown',()=>{longPressed=false;pressTimer=setTimeout(()=>{longPressed=true;mobileSessionMenu(item.record)},500)});
      for(const event of ['pointerup','pointercancel','pointerleave'])b.addEventListener(event,()=>clearTimeout(pressTimer));
      b.addEventListener('contextmenu',event=>{event.preventDefault();clearTimeout(pressTimer);longPressed=true;mobileSessionMenu(item.record)});
    }
    b.addEventListener('click',()=>{if(longPressed){longPressed=false;return}item.source==='phone'?selectConversation(item.id):selectSharedSession(item.id)});
    const row=el('div','session-row');row.append(b);
    if(item.source==='host'){const more=el('button','session-more','更多');more.type='button';more.setAttribute('aria-label',`更多操作 ${item.title}`);more.addEventListener('click',()=>mobileSessionMenu(item.record));row.append(more)}target.append(row)}
  if(!entries.length)target.append(el('p','muted',filter?'没有匹配的对话':state.loggedIn?'还没有对话':'登录后查看对话'));
  target.scrollTop=previousScroll;
  if(state.page==='home')renderHome();
}

function updatePageHeader(){const home=state.page==='home',chat=state.page==='chat';
  $('menu-button').hidden=!home;$('page-back').hidden=home;$('home-new-chat').hidden=!home;
  $('outputs-button').hidden=!chat;
  const title=chat?(state.chatSource==='host'?selectedSharedSession()?.title:state.conversations.find(item=>item.id===state.conversationId)?.title):null;
  $('header-subtitle').hidden=home||chat;
  document.querySelector('.brand strong').textContent=home?'WeftMate':chat?title||'新对话':'WeftMate';
}

function pendingApprovalFor(sessionId){if(toolApprovals.owner!==state.owner||toolApprovals.epoch!==state.authEpoch)return false;
  return [...(toolApprovals.sessions.get(sessionId)?.rows.values()||[])].some(row=>row.status==='pending')}

function renderHome(){const target=$('home-conversations'),top=target.scrollTop;clear(target);
  const filter=$('home-search').value.trim().toLocaleLowerCase(),entries=[],linked=new Set();
  if(state.loggedIn){const toggle=el('button','secondary',archivedSessionView?'返回最近对话':'已归档');toggle.type='button';
    toggle.addEventListener('click',()=>{archivedSessionView=!archivedSessionView;renderConversationList()});target.append(toggle)}
  for(const item of state.conversations){const sessionId=state.handoffViews.get(item.id)?.binding?.sessionId||item.binding?.sessionId;
    if(archivedSessionView)continue;
    if(sessionId)linked.add(sessionId);entries.push({id:item.id,source:'phone',sessionId,title:item.title||'新对话',at:item.updatedAt||item.createdAt,
      running:!!item.running||state.busy&&state.conversationId===item.id||!!state.sharedSessions.find(s=>s.sessionId===sessionId)?.running})}
  for(const item of state.sharedSessions){if((item.archived===true)!==archivedSessionView||linked.has(item.sessionId)||state.conversations.some(c=>c.id===item.conversationId))continue;
    entries.push({id:item.sessionId,sessionId:item.sessionId,source:'host',record:item,title:item.title||'新对话',at:item.updatedAt||item.createdAt||item.attachedAt,running:!!item.running})}
  entries.sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));let lastGroup='';
  for(const item of entries.filter(item=>item.title.toLocaleLowerCase().includes(filter))){
    const date=new Date(item.at),today=new Date(),group=Number.isFinite(date.getTime())?
      date.toDateString()===today.toDateString()?'今天':date.toDateString()===new Date(today.getFullYear(),today.getMonth(),today.getDate()-1).toDateString()?'昨天':'更早':'会话';
    if(group!==lastGroup){target.append(el('h2','home-group',group));lastGroup=group}
    const button=el('button','home-conversation');button.type='button';button.dataset.source=item.source;button.dataset.id=item.id;
    const copy=el('span','home-conversation-copy');copy.append(el('strong','',item.title));
    if(Number.isFinite(date.getTime()))copy.append(el('small','',timeLabel(item.at)));button.append(copy);
    const needsApproval=pendingApprovalFor(item.sessionId);
    if(needsApproval||item.running){const dot=el('span',`session-running-dot${needsApproval?' session-approval-dot':''}`);
      dot.setAttribute('role','img');dot.setAttribute('aria-label',needsApproval?'待审批':'正在运行');button.append(dot)}
    let timer=null,longPressed=false;
    if(item.source==='host'){
      button.addEventListener('pointerdown',()=>{longPressed=false;timer=setTimeout(()=>{longPressed=true;mobileSessionMenu(item.record)},500)});
      for(const event of ['pointerup','pointercancel','pointerleave'])button.addEventListener(event,()=>clearTimeout(timer));
      button.addEventListener('contextmenu',event=>{event.preventDefault();clearTimeout(timer);if(!longPressed){longPressed=true;mobileSessionMenu(item.record)}});
    }
    button.addEventListener('click',()=>{if(longPressed){longPressed=false;return}item.source==='phone'?selectConversation(item.id):selectSharedSession(item.id)});
    const row=el('div','session-row');row.append(button);
    if(item.source==='host'){const more=el('button','session-more','更多');more.type='button';more.setAttribute('aria-label',`更多操作 ${item.title}`);more.addEventListener('click',()=>mobileSessionMenu(item.record));row.append(more)}target.append(row)}
  if(!lastGroup){const empty=el('div','home-empty');empty.append(el('h2','',filter?'没有匹配的会话':state.loggedIn?'开始第一段对话':'欢迎使用 WeftMate'),
    el('p','',filter?'换个关键词试试。':state.loggedIn?'点右上角，聊聊你想做的事。':'登录后，在这里接着聊。'));
    if(!state.loggedIn){const login=el('button','primary','登录或连接');login.addEventListener('click',()=>page('connect'));empty.append(login)}target.append(empty)}target.scrollTop=top;
}

async function refreshHome(){if(state.page!=='home'||!state.loggedIn||document.visibilityState==='hidden')return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
  await Promise.all([listConversations(),listSharedSessions()]);
  if(state.page!=='home'||owner!==state.owner||epoch!==state.authEpoch||generation!==state.generation)return;
  await uiCore.mobileDecisions.refreshHomeApprovals();
  if(state.page!=='home'||owner!==state.owner||epoch!==state.authEpoch||generation!==state.generation)return;
  renderHome();state.homePollTimer=setTimeout(()=>{void refreshHome()},12000);
}
