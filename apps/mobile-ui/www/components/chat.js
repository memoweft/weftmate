/* Mobile chat presentation and named ui-core actions. */
function draftKey(...args){return uiCore.mobile.draftKey(...args)}

function sharedDraftKey(...args){return uiCore.mobile.sharedDraftKey(...args)}

function attachmentConversationId(...args){return uiCore.mobile.attachmentConversationId(...args)}

function attachmentKey(...args){return uiCore.mobile.attachmentKey(...args)}

function currentAttachments(...args){return uiCore.mobile.currentAttachments(...args)}

function selectionKey(...args){return uiCore.mobile.selectionKey(...args)}

function chatSourceKey(...args){return uiCore.mobile.chatSourceKey(...args)}

function savedSharedSelection(...args){return uiCore.mobile.savedSharedSelection(...args)}

function hasAnyDraft(...args){return uiCore.mobile.hasAnyDraft(...args)}

function reportDraftState(){if(!state.loggedIn||!state.owner)return;clearTimeout(draftReportTimer);
  draftReportTimer=setTimeout(()=>{const hasDraft=hasAnyDraft(),fingerprint=`${state.owner}:${hasDraft}`;
    if(lastReportedDraft===fingerprint)return;lastReportedDraft=fingerprint;
    call('app.activity',{owner:state.owner,hasDraft}).catch(()=>{lastReportedDraft=null})},140)}

function loadDraft(){cancelAttachmentPick();const generation=++attachmentViewGeneration;
  if(state.chatSource==='host'){
    try{$('draft').value=localStorage.getItem(sharedDraftKey())||''}catch{$('draft').value=''}
    renderAttachmentDrafts();updateComposer();refreshAttachmentDrafts(generation);return}
  if(!state.loggedIn){$('draft').value='';renderAttachmentDrafts();updateComposer();return}
  try{$('draft').value=localStorage.getItem(draftKey())||''}catch{$('draft').value=''}renderAttachmentDrafts();updateComposer();
  refreshAttachmentDrafts(generation)}

function markAttachmentRevision(key){attachmentRevisions.set(key,(attachmentRevisions.get(key)||0)+1)}

function safeThumbnailDataUrl(value){return typeof value==='string'&&value.length<20000&&
  /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)?value:null}

function safeImagePreviewUrl(value,attachmentId,conversationId,messageId,display=false){if(typeof value!=='string'||
    !mediaId.test(attachmentId)||!mediaId.test(conversationId)||
    (messageId!==undefined&&!mediaId.test(messageId)))return null;
  try{const url=new URL(value);if(url.origin!=='https://appassets.androidplatform.net'||
      url.username||url.password||url.hash||url.pathname!==`/media/image/${attachmentId}`||
      url.href!==value||url.searchParams.getAll('conversationId').length!==1||
      url.searchParams.get('conversationId')!==conversationId||
      [...url.searchParams.keys()].some(key=>!['conversationId','messageId',...(display?['variant']:[])].includes(key))||
      url.searchParams.getAll('messageId').length>(messageId===undefined?0:1)||
      (messageId!==undefined&&url.searchParams.get('messageId')!==messageId)||
      url.searchParams.getAll('variant').length!==(display?1:0)||
      (display&&url.searchParams.get('variant')!=='display'))return null;
    return value}catch{return null}}

function safeSessionPreviewUrl(value,attachmentId,sessionId){if(typeof value!=='string'||
    !sessionIdPattern.test(sessionId)||!sessionMediaId.test(attachmentId))return null;
  try{const url=new URL(value);return url.origin==='https://appassets.androidplatform.net'&&
      !url.username&&!url.password&&!url.search&&!url.hash&&
      url.pathname===`/media/session/${sessionId}/${attachmentId}`&&url.href===value?value:null}
  catch{return null}}

function inlineOriginalAllowed(image){return Number.isSafeInteger(image?.sizeBytes??image?.size)&&
  (image.sizeBytes??image.size)>0&&(image.sizeBytes??image.size)<=5*1024*1024&&
  Number.isSafeInteger(image.width)&&Number.isSafeInteger(image.height)&&
  image.width>0&&image.height>0&&image.width*image.height<=12*1024*1024}

function normalizedAttachment(item){if(!item||typeof item.attachmentId!=='string'||!item.attachmentId.trim()||
    !['image','file'].includes(item.kind))return null;
  const thumbnail=safeThumbnailDataUrl(item.thumbnailDataUrl);
  return {attachmentId:item.attachmentId,kind:item.kind,name:String(item.name||'未命名附件').slice(0,120),
    ...(thumbnail?{thumbnailDataUrl:thumbnail}:{}),
    ...(typeof item.previewUrl==='string'?{previewUrl:item.previewUrl}:{}),
    ...(typeof item.displayUrl==='string'?{displayUrl:item.displayUrl}:{})}}

async function refreshAttachmentDrafts(generation=attachmentViewGeneration){if(!state.loggedIn||state.transitionPending)return false;
  const owner=state.owner,epoch=state.authEpoch,source=state.chatSource,conversationId=attachmentConversationId(),key=attachmentKey(),
    revision=attachmentRevisions.get(key)||0;
  try{const result=await call('attachments.list',{conversationId});
    if(!Array.isArray(result?.attachments))throw new Error('ATTACHMENT_UNSUPPORTED');
    if(owner!==state.owner||epoch!==state.authEpoch||source!==state.chatSource||generation!==attachmentViewGeneration||
      conversationId!==attachmentConversationId()||revision!==(attachmentRevisions.get(key)||0))return false;
    const list=result.attachments.map(normalizedAttachment).filter(item=>item&&mediaId.test(item.attachmentId));
    attachmentDrafts.set(key,list);renderAttachmentDrafts();updateComposer();return true;
  }catch(e){if(owner!==state.owner||epoch!==state.authEpoch||source!==state.chatSource||generation!==attachmentViewGeneration)return false;
    status(`附件草稿未能恢复 · ${safeError(e)}`,true);return false}}

function selectConversation(id){closeImagePreview({restoreFocus:false});invalidateLiveProgress();stopSharedPoll();clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;state.sharedGeneration++;state.chatSource='phone';state.restorePending=false;state.sharedAwaiting=null;state.scrollPinned=true;
  try{localStorage.removeItem(chatSourceKey())}catch{}status('');closeToast();
  state.activeSend=null;state.sendUncertain=false;state.conversationId=id;try{if(id)localStorage.setItem(selectionKey(),id);else localStorage.removeItem(selectionKey())}catch{}
  closeAttachmentMenu();loadDraft();page('chat');scrollBottom(true);if(id)void refreshHandoff(id)}

function safeError(error) {
  const code = error?.message || error?.code || 'OPERATION_FAILED';
  const names = {NATIVE_UNAVAILABLE:'当前系统网页组件不可用',TIMEOUT:'操作等待超时，请检查连接',LOGIN_REQUIRED:'请先登录电脑账户',
    TURN_RUNNING:'当前回复还在进行，请先停止或等待',MODEL_NOT_CONFIGURED:'请先配置手机模型',SESSION_UNAVAILABLE:'这段对话无法读取',
    MESSAGE_INVALID:'请检查消息内容',UI_UPDATE_UNAVAILABLE:'暂时无法检查界面更新',UI_UPDATE_IN_PROGRESS:'界面更新正在下载，请稍后再看',
    UI_UPDATE_INCOMPATIBLE:'新版界面与当前应用不兼容',NATIVE_UPDATE_REQUIRED:'需要先升级手机应用才能使用新版界面',
    UI_UPDATE_REJECTED:'上次界面未能启动，已保留可用版本；可手动重试',
    UPDATE_DEFERRED:'回复或草稿仍在，稍后再应用更新',VOICE_UNAVAILABLE:'这台手机没有可用的系统语音服务',
    MODEL_STREAM_INCOMPLETE:'模型连接中途结束，本轮未完成',MODEL_UNAVAILABLE:'模型暂不可用，请检查电脑连接和配置',
    MODEL_OUTPUT_LIMIT:'模型达到输出上限，已保留生成的文字；本轮未完整结束',
    MODEL_CONTENT_FILTERED:'模型已停止输出，已保留生成的文字；本轮未完整结束',
    MODEL_FINISH_UNKNOWN:'模型结束状态不明确，已保留生成的文字',
    ACCOUNT_ALREADY_CONFIGURED:'这个账户服务暂不开放注册',ACCOUNT_ALREADY_EXISTS:'这个账户名已有人使用，请换一个名称',
    INVALID_CREDENTIALS:'账户或密码不正确',ACCOUNT_IDENTITY_MISMATCH:'账户身份核对失败，登录未保存',
    AVATAR_INVALID:'图片无法读取，请改选有效的PNG、JPEG或WebP图片',AVATAR_TOO_LARGE:'图片处理后仍过大，请换一张',
    BODY_TOO_LARGE:'图片超过服务端大小限制，请换一张',PHOTO_UNREADABLE:'无法读取所选图片，请重新选择',
    LOGIN_RATE_LIMITED:'登录尝试过多，请稍后再试',UNAUTHORIZED:'登录已失效，请重新登录',FORBIDDEN:'当前设备无权执行此操作',
    INVALID_REQUEST:'请检查填写的账户、密码或设备名称',
    AUTH_IN_PROGRESS:'正在处理账户操作，请稍候',
    ACCOUNT_SWITCHING:'正在切换账户，请稍候',ACCOUNT_SWITCHED:'账户已切换，较早结果未显示',
    DEVICE_LIMIT:'可登录设备已达上限，请先移除旧设备',REQUEST_CONFLICT:'资料已在别处更新，请刷新后重试',
    NOT_FOUND:'这条记录已不可查看，可能已移除或账户权限已变化',
    HOST_UNAVAILABLE:'电脑暂不可达，请稍后核对这段共享会话',SESSION_READ_ONLY:'这段电脑会话仅可查看，无法从手机继续发送',
    COMMAND_RECEIPT_INVALID:'电脑命令回执无法核对，请查看会话状态',
    APPROVAL_NOT_PENDING:'此次审批已被处理或失效，正在重新核对',APPROVAL_RECEIPT_INVALID:'审批回执无法核对，请检查原任务状态',
    QUESTION_NOT_PENDING:'这个问题已被回答或结束，正在重新核对',QUESTION_OUTCOME_UNCONFIRMED:'回答是否被执行端接收仍待核对',
    QUESTION_RECEIPT_INVALID:'问题或回答回执无法核对，请检查原任务状态',QUESTION_ANSWER_INVALID:'请检查各题选择和填写的回答',
    TOOL_SOURCE_UNAVAILABLE:'当前问题的来源暂时无法核对，请稍后检查原任务',
    ARTIFACT_UNVERIFIED:'电脑尚未核验文件，请稍后刷新任务',ARTIFACT_CHANGED:'文件校验不一致，请重新保存',
    TASK_NOT_READY:'任务结果仍待核对，请刷新后再操作',
    ARTIFACT_SAVE_FAILED:'保存后无法核对文件，请选择其他位置重试',ARTIFACT_SAVE_UNAVAILABLE:'无法打开系统保存位置',
    ARTIFACT_SAVE_IN_PROGRESS:'已有文件正在选择保存位置',ARTIFACT_TOO_LARGE:'成果超出手机当前可保存的大小',
    RECEIPT_UNKNOWN:'电脑回执尚不明确，请核对原会话或动作结果',RECEIPT_TIMEOUT:'等待电脑回执超时，实际结果尚不明确',
    DEVICE_REVOKED:'发起命令的设备已移除，命令未继续执行',SESSION_REPLACED:'登录会话已更新，较早命令未继续执行',
    SESSION_EXPIRED:'发起命令时的登录已失效',CAPABILITY_UNAVAILABLE:'电脑当前不具备这项能力',
    ORIGIN_NOT_ALLOWED:'服务地址或访问来源不被接受',STORAGE_UNAVAILABLE:'服务端暂时无法保存，请稍后重试',
    SERVICE_UNAVAILABLE:'个人服务暂不可达，本机记录仍保留',CAPACITY_LIMIT:'同步容量已满，本机记录仍保留',
    OPERATION_FAILED:'操作未完成，请稍后重试',METHOD_UNKNOWN:'当前功能与原生版本不兼容',
    ATTACHMENT_UNSUPPORTED:'当前模型或文件格式暂不支持，请改用图片或纯文本文件',ATTACHMENT_TOO_LARGE:'图片单张最多 1 GiB；请缩小附件后重试',
    ATTACHMENT_UNREADABLE:'无法读取这个附件，请重新选择',ATTACHMENT_EMPTY:'文件是空的，请选择有内容的文件',
    ATTACHMENT_LIMIT:'每条消息最多添加四个附件',ATTACHMENT_STORAGE_LIMIT:'手机附件空间不足，请移除旧附件后重试',
    ATTACHMENT_TYPE_MISMATCH:'文件内容与格式不符，请重新选择',ATTACHMENT_NOT_UTF8:'文本文件编码不受支持，请改用 UTF-8 文本',
    ATTACHMENT_CHANGED:'附件已发生变化，请移除后重新选择',ATTACHMENT_UNAVAILABLE:'附件已不可用，请重新选择',
    ATTACHMENT_PICK_UNAVAILABLE:'无法打开系统文件选择器，请检查手机应用',
    IMAGE_DIMENSIONS_UNSUPPORTED:'图片无法解码，请重新选择有效的图片',
    IMAGE_PREVIEW_UNAVAILABLE:'无法生成图片预览，请换一张图片后重试',
    MODEL_IMAGE_UNSUPPORTED:'当前模型不支持图片输入，请换用支持图片的模型或移除图片',
    HOST_ATTACHMENTS_UNSUPPORTED:'这段电脑会话暂不支持图片发送；原图片草稿仍保留',
    IMAGE_REJECTED:'这段电脑会话的模型不支持图片；图片仍在草稿中，请选择支持图片的电脑会话',
    MODEL_UPSTREAM_ERROR:'模型服务未完成回复，请检查模型配置和连接',
    MODEL_ROUTE_NOT_PORTABLE:'本机地址无法作为账户云模型跨设备共享；若电脑能访问，可在电脑现有模型目录单独配置',
    MODEL_NOT_PORTABLE:'此电脑模型地址无法从手机直连；仍可在电脑会话使用，手机请选择可直接访问的云模型',
    MODEL_RECEIPT_INVALID:'模型配置回执无法核对；原选择与密钥仍保留',
    MODEL_IN_USE:'当前手机模型正在使用；请先明确切换到另一模型再删除',
    MODEL_NOT_FOUND:'这项模型已不可用，请刷新目录',
    MODEL_SECRET_CHANGED:'已存密钥在原请求之后改变，请先核对原编号',
    MODEL_REVISION_CONFLICT:'模型配置已在别处更新，请刷新后核对原请求',
    ACCOUNT_MODEL_SECRET_REQUIRED:'更换服务地址时，请提供新地址的密钥',
    RUNTIME_BUSY:'电脑正在处理现有回合；原配置请求已保留，稍后核对',
    CONVERSATION_SYNC_PENDING:'这条手机消息和图片仍在同步，请稍后核对原对话',
    CONVERSATION_NOT_READY:'手机回合尚未结束或同步，请完成后再转到电脑',
    CONVERSATION_ROUTING_UNCONFIRMED:'这条消息已保存在手机，执行位置待核对；不会自动交给另一个模型',
    CONVERSATION_CONTEXT_UNAVAILABLE:'旧对话资料暂时无法核对，电脑没有开始无上下文的回复',
    LOCAL_TURN_RUNNING:'手机还在回复，请等本轮结束后再接到电脑',
    LOCAL_TURN_UNCONFIRMED:'手机回合状态待核对，按已同步记录交接需明确选择',
    SOURCE_DEVICE_UPGRADE_REQUIRED:'请先更新创建这条对话的手机应用，再接到电脑',
    BINDING_PENDING:'原交接请求仍在处理，请核对原编号',
    BINDING_RECEIPT_INVALID:'交接回执无法核对，原对话和草稿仍保留',
    BROWSER_DNS_TIMEOUT:'网页域名解析超时，本次没有取得可引用的页面正文',
    BROWSER_DOWNGRADE_BLOCKED:'网页从 HTTPS 跳到不安全的 HTTP，已阻止继续读取',
    BROWSER_PAGE_CHANGED:'网页读取时发生跳转或变化，本次正文不能作为来源，请重试',
    BROWSER_CLEANUP_FAILED:'隔离浏览会话清理未能确认，请稍后重新核对网页任务',
  };
  return names[code] || '操作未完成，请稍后重试';
}

function turnFailure(code,httpStatus){const status=Number(httpStatus);
  if(Number.isInteger(status)&&status>=400&&status<=599){
    if(status===401||status===403)return '模型服务拒绝了访问，请检查模型密钥和权限';
    if(status===404)return '模型服务找不到这个模型，请检查模型 ID';
    if(status===429)return '模型服务请求过多，请稍后重试';
    if(status>=500)return '模型服务暂时不可用，请稍后重试';
    return '模型服务拒绝了请求，请检查模型 ID 和配置';
  }
  return safeError(new Error(typeof code==='string'?code:'OPERATION_FAILED'));
}

function el(tag, cls='', text='') {const n=document.createElement(tag); if(cls)n.className=cls;if(text)n.textContent=text;return n}

function logo(){const mark=el('span','logo');mark.setAttribute('aria-label','WeftMate');return mark}

function showProfile(profile){const display=profile?.displayName||profile?.username||'本机个人空间';
  $('drawer-name').textContent=display;const avatar=$('drawer-avatar');clear(avatar);
  if(profile?.avatar?.dataBase64&&['image/png','image/jpeg','image/webp'].includes(profile.avatar.mimeType)){
    const image=el('img');image.alt='';image.src=`data:${profile.avatar.mimeType};base64,${profile.avatar.dataBase64}`;avatar.append(image)}
  else avatar.textContent=display.slice(0,1)||'我';
}

function clear(node){node.replaceChildren()}

function notice(text, strong='') { const n=el('div','notice');if(strong)n.append(el('strong','',strong));n.append(el('span','',text));return n }

function heading(title,description='') {const root=el('div');root.append(el('h1','page-title',title));if(description)root.append(el('p','page-desc',description));return root}

function group(title,rows) {const root=el('section','group');root.append(el('h2','',title));const body=el('div','group-body');for(const r of rows)body.append(r);root.append(body);return root}

function row(title,detail,action) {const button=el('button','row');const left=el('span');left.append(el('strong','',title));if(detail)left.append(el('small','',detail));button.append(left,el('span','row-action','›'));button.addEventListener('click',action);return button}

function field(label,type,value='') {const box=el('label','field');box.append(el('span','',label));const input=el('input');input.type=type;input.value=value;box.append(input);return {box,input}}

function action(label,handler,primary=true){const button=el('button',primary?'primary':'secondary',label);button.addEventListener('click',handler);return button}

function closeToast(){const box=$('toast');clearTimeout(toast.timer);clearTimeout(toast.hideTimer);
  if(box.hidden)return;box.classList.add('leaving');toast.hideTimer=setTimeout(()=>{if(box.classList.contains('leaving'))box.hidden=true},
    window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:420)}

function toast(text,issue=false,undo){const box=$('toast');clearTimeout(toast.timer);clearTimeout(toast.hideTimer);
  box.textContent=text;box.classList.toggle('error',issue);box.classList.remove('leaving');box.hidden=false;
  if(undo){const button=el('button','toast-undo','撤销归档');button.type='button';button.onclick=async event=>{event.stopPropagation();button.disabled=true;try{await undo();closeToast()}catch(error){toast(safeError(error),true)}};box.append(button)}
  toast.timer=setTimeout(closeToast,undo?10000:issue?5200:3500)}

function status(text,issue=false){const line=$('chat-status');line.textContent=issue?'':text;
  line.classList.remove('error');if(issue&&text)toast(text,true)}

function closeImagePreview({restoreFocus=true}={}){globalThis.WeftContent?.closeGallery(restoreFocus);const box=$('image-preview');if(box.hidden)return;
  if(restoreFocus&&box.classList.contains('closing'))return;
  clearTimeout(closeImagePreview.timer);
  const scope=state.previewScope,button=state.previewReturnFocus;
  state.previewScope=null;state.previewReturnFocus=null;
  const finish=()=>{box.hidden=true;box.classList.remove('closing');$('image-preview-image').src='';
    $('image-preview-name').textContent='';if(restoreFocus&&scope?.owner===state.owner&&
      scope.epoch===state.authEpoch&&(scope.source||'phone')===state.chatSource&&
      scope.conversationId===attachmentConversationId())button?.focus?.()};
  if(!restoreFocus||window.matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return}
  box.classList.add('closing');closeImagePreview.timer=setTimeout(finish,160)}

function openImagePreview(url,name,button,scope,{original=false,display=false,note='',attachmentId=null,messageId=undefined,draft=false}={}){
  const source=scope?.source||'phone';
  const logical=scope?.logicalSource,logicalEvent=logical&&uiCore.state.chatWindow?.events.get(logical.eventId);
  if(logical&&(!uiCore.inMainChat?.()||logicalEvent?.sourceRef?.sessionId!==logical.sessionId||scope.conversationId!==uiCore.state.selectedChatId))return;
  const safe=source==='host'?(original||display)?(draft
    ?safeImagePreviewUrl(url,attachmentId,scope.conversationId,undefined,display)
    :safeSessionPreviewUrl(url,attachmentId,logical?.sessionId||scope.conversationId)):safeThumbnailDataUrl(url):
    (original||display)?safeImagePreviewUrl(url,attachmentId,scope?.conversationId,messageId,display):safeThumbnailDataUrl(url);
  if(!safe||!scope||state.page!=='chat'||source!==state.chatSource||state.transitionPending||
    scope.owner!==state.owner||scope.epoch!==state.authEpoch||scope.conversationId!==attachmentConversationId())return;
  closeImagePreview({restoreFocus:false});state.previewScope=scope;state.previewReturnFocus=button;
  if(globalThis.WeftContent){const images=[...(button?.closest('.message-thumbnails,.synced-image-gallery,.message')?.querySelectorAll('img')||[])];const items=images.map(image=>({url:image.src,name:image.alt||name}));const index=images.findIndex(image=>image.parentElement===button);WeftContent.openGallery(items.length?items:[{url:safe,name}],Math.max(0,index),button);return;}
  $('image-preview-name').textContent=name;$('image-preview-image').src=safe;
  $('image-preview-image').alt=`${name} 的${original?'原图':display?'预览图':'缩略图'}`;
  $('image-preview-note').textContent=note|| (original?'原图':'旧图片仅保留缩略图');
  $('image-preview').hidden=false;
  $('image-preview-close').focus()}

function openDrawer(){closeAttachmentMenu();closeModelMenu();state.drawer=true;
  $('drawer').inert=false;$('main').inert=true;if($('mobile-bottom-tabs'))$('mobile-bottom-tabs').inert=true;
  const generation=++drawerFrameGeneration;
  renderConversationList();$('drawer-scrim').hidden=false;
  void listSharedSessions();
  requestAnimationFrame(()=>{if(!state.drawer||generation!==drawerFrameGeneration)return;
    $('drawer').classList.add('open');$('drawer-scrim').classList.add('open')});$('drawer-close').focus()}

function closeDrawer(){const wasOpen=state.drawer;const scrimCopy=wasOpen?globalThis.WeftMobileMotion?.snapshot($('drawer-scrim')):null;const copy=wasOpen?globalThis.WeftMobileMotion?.snapshot($('drawer')):null;state.drawer=false;drawerFrameGeneration++;
  $('drawer').inert=true;$('main').inert=false;if($('mobile-bottom-tabs'))$('mobile-bottom-tabs').inert=false;
  $('drawer').classList.remove('open');$('drawer-scrim').classList.remove('open');
  clearTimeout(closeDrawer.timer);$('drawer-scrim').hidden=true;globalThis.WeftMobileMotion?.dismiss(scrimCopy);globalThis.WeftMobileMotion?.dismiss(copy,false,'drawer')}

function closeModelMenu(){state.menu=false;$('model-popover').hidden=true;$('model-button').setAttribute('aria-expanded','false')}

function closeAttachmentMenu({restoreFocus=false}={}){if(!state.attachmentMenu)return;state.attachmentMenu=false;
  $('attachment-popover').classList.remove('open');$('attachment-popover').hidden=true;
  $('plus-button').setAttribute('aria-expanded','false');if(restoreFocus)$('plus-button').focus()}

function renderAttachmentPickStatus(){const box=$('attachment-pick-status'),pick=state.attachmentPick;
  box.hidden=!pick;if(pick)$('attachment-pick-label').textContent=pick.requestId?
    `正在系统中选择${pick.kind==='file'?'文件':pick.kind==='camera'?'照片':'图片'}，返回后可取消等待。`:'正在打开系统选择器…';
  syncChatInsets()}

function cancelAttachmentPick({announce=false}={}){if(!state.attachmentPick)return;
  state.attachmentPick=null;renderAttachmentPickStatus();updateComposer();
  if(announce)status('已停止等待选择结果，原有消息草稿保留')}

async function openAttachmentMenu(){if(state.chatSource==='host'&&!selectedSharedSession()?.sendAvailable){toast('这段电脑会话仅可查看，无法添加图片',true);return}
  closeApprovalModeMenu();
  if(state.attachmentPick)return;if(state.attachmentMenu){closeAttachmentMenu({restoreFocus:true});return}
  closeModelMenu();state.attachmentMenu=true;const popup=$('attachment-popover');popup.hidden=false;
  $('pick-file').hidden=false;$('attachment-note').hidden=state.chatSource!=='host';
  $('plus-button').setAttribute('aria-expanded','true');requestAnimationFrame(()=>popup.classList.add('open'));placeAttachmentMenu();$('pick-camera').focus();
  const owner=state.owner,epoch=state.authEpoch,sessionId=state.sharedSessionId;
  if(state.chatSource==='host')try{await uiCore.refreshThinkingModels();if(owner!==state.owner||epoch!==state.authEpoch||sessionId!==state.sharedSessionId)return;paintMobileThinking();placeAttachmentMenu()}catch{}
}

function placeAttachmentMenu(){globalThis.WeftPopover.position($('attachment-popover'),$('plus-button'))}

function renderAttachmentDrafts(){const box=$('attachment-drafts');clear(box);const items=state.loggedIn&&!state.transitionPending?currentAttachments():[];
  const scope={owner:state.owner,epoch:state.authEpoch,conversationId:attachmentConversationId(),source:state.chatSource};
  box.hidden=!items.length;for(const item of items){const chip=el('div',`attachment-chip${item.kind==='image'?' attachment-image-draft':''}`);
    const original=item.kind==='image'?safeImagePreviewUrl(item.previewUrl,item.attachmentId,scope.conversationId):null;
    const display=item.kind==='image'?safeImagePreviewUrl(item.displayUrl,item.attachmentId,scope.conversationId,undefined,true):null;
    const thumbnail=safeThumbnailDataUrl(item.thumbnailDataUrl),inline=display||thumbnail;
    if(item.kind==='image'&&(inline||original)){const preview=el('button','attachment-preview-trigger');preview.type='button';
      preview.setAttribute('aria-label',`预览待发送图片 ${item.name}`);
      if(inline){const thumb=el('img','attachment-thumb');thumb.alt='';thumb.src=inline;thumb.loading='lazy';thumb.decoding='async';preview.append(thumb)}
      else{const placeholder=el('span','attachment-image-unavailable');placeholder.setAttribute('aria-hidden','true');preview.append(placeholder)}
      preview.addEventListener('click',()=>openImagePreview(original||display||thumbnail,item.name,preview,scope,
        {original:!!original,display:!original&&!!display,note:original?'待发送原图':'这台手机保存的缩略图',
          attachmentId:item.attachmentId,draft:true}));chip.append(preview)}
    else if(item.kind==='image'){const unavailable=el('div','attachment-image-unavailable');unavailable.setAttribute('role','img');
      unavailable.setAttribute('aria-label',`图片缩略图不可用：${item.name}`);chip.append(unavailable)}
    if(item.kind!=='image')chip.append(el('span','attachment-kind','文件'),el('span','attachment-name',item.name));
    const remove=el('button','attachment-remove',item.kind==='image'?'':'移除');remove.type='button';remove.disabled=state.busy||state.transitionPending;
    remove.setAttribute('aria-label',`移除附件 ${item.name}`);
    if(item.kind==='image'){const icon=el('span','icon icon-close');icon.setAttribute('aria-hidden','true');remove.append(icon)}
    remove.addEventListener('click',()=>removeAttachment(item.attachmentId));chip.append(remove);box.append(chip)}syncChatInsets()}

function clearAcceptedHostAttachments(attachmentIds){if(state.chatSource!=='host'||!attachmentIds.length)return;
  const key=attachmentKey(),remaining=currentAttachments().filter(item=>!attachmentIds.includes(item.attachmentId));
  if(remaining.length)attachmentDrafts.set(key,remaining);else attachmentDrafts.delete(key);
  markAttachmentRevision(key);renderAttachmentDrafts()}

function syncChatInsets(){const height=$('composer-dock').getBoundingClientRect().height;
  if(Number.isFinite(height)&&height>0){const value=`${Math.ceil(height)}px`;
    $('chat-page').style.setProperty('--composer-height',value);document.documentElement.style.setProperty('--composer-height',value)}}

async function pickAttachment(kind){if(state.chatSource==='host'&&!selectedSharedSession()?.sendAvailable){
    toast('这段电脑会话仅可查看，无法添加附件',true);return}
  if(!state.loggedIn||state.transitionPending||state.busy||state.attachmentPick||
    state.chatSource==='host'&&state.sharedPending)return;
  const pick={owner:state.owner,epoch:state.authEpoch,source:state.chatSource,conversationId:attachmentConversationId(),
    viewGeneration:attachmentViewGeneration,kind,requestId:null};
  state.attachmentPick=pick;closeAttachmentMenu();renderAttachmentPickStatus();updateComposer();
  try{const result=await call('attachments.pick',{kind,conversationId:pick.conversationId,viewGeneration:pick.viewGeneration});
    if(state.attachmentPick!==pick)return;
    if(result?.pending!==true||typeof result.requestId!=='string'||!result.requestId.trim())throw new Error('ATTACHMENT_UNSUPPORTED');
    pick.requestId=result.requestId;renderAttachmentPickStatus();
  }catch(e){if(state.attachmentPick!==pick)return;cancelAttachmentPick();
    const message=['METHOD_UNKNOWN','TIMEOUT'].includes(e?.message)?'当前手机应用版本不支持新的附件选择，请升级应用':safeError(e);
    status(message,true)}}

function finishAttachmentPick(data){const pick=state.attachmentPick;if(!pick||!pick.requestId||data?.requestId!==pick.requestId)return;
  if(pick.owner!==state.owner||pick.epoch!==state.authEpoch||pick.source!==state.chatSource||pick.conversationId!==attachmentConversationId()||
    pick.viewGeneration!==attachmentViewGeneration||
    (data.viewGeneration!=null&&data.viewGeneration!==pick.viewGeneration)||data.conversationId!==pick.conversationId){
    cancelAttachmentPick();return}
  cancelAttachmentPick();if(data.status==='selected'){
    status(pick.kind==='file'?'正在读取附件草稿…':'');refreshAttachmentDrafts(pick.viewGeneration).then(restored=>{
      if(restored&&state.owner===pick.owner&&state.authEpoch===pick.epoch&&pick.source===state.chatSource&&
        attachmentViewGeneration===pick.viewGeneration)
        status(currentAttachments().length?(pick.kind==='file'?'附件已加入草稿，确认后可发送':''):
          '没有找到已选附件，请重新选择',!currentAttachments().length)});
  }else if(data.status==='cancelled')status('已取消选择，消息草稿保留');
  else{const message=safeError(new Error(data.errorCode||'OPERATION_FAILED'));status(message,true)}}

async function removeAttachment(attachmentId){if(state.busy||state.transitionPending||state.chatSource==='host'&&state.sharedPending)return;
  const key=attachmentKey(),source=state.chatSource,conversationId=attachmentConversationId(),
    item=currentAttachments().find(v=>v.attachmentId===attachmentId);if(!item)return;
  try{await call('attachments.remove',{attachmentId,...(source==='host'?{conversationId}:{})});
    if(source===state.chatSource&&conversationId===attachmentConversationId())closeImagePreview({restoreFocus:false});
    const list=(attachmentDrafts.get(key)||[]).filter(v=>v.attachmentId!==attachmentId);
    if(list.length)attachmentDrafts.set(key,list);else attachmentDrafts.delete(key);markAttachmentRevision(key);
    if(source===state.chatSource&&conversationId===attachmentConversationId()){
      renderAttachmentDrafts();updateComposer();status(item.kind==='image'?'':'已从草稿移除附件')}}
  catch(e){const message=safeError(e);status(message,true)}}

function placeModelMenu(){globalThis.WeftPopover.position($('model-popover'),$('model-button'))}

function updateComposer(){uiCore.syncMobileIdentity();mobileMessageActions?.refresh();const view=uiCore.mobile.composerState($('draft').value);reportDraftState();
  renderQueuedTasks();
  const button=$('send-button'), stop=view.sendHidden;
  globalThis.WeftMobileMotion?.changed(button,String(stop),'160ms');
  button.hidden=false;button.disabled=stop?!!state.sharedStopping||state.transitionPending:!view.ready;
  button.classList.toggle('ready',stop||view.ready);button.classList.toggle('is-stop',stop);button.dataset.action=stop?'stop':'send';
  button.setAttribute('aria-label',stop?'停止回复':'发送');button.replaceChildren(el('span',`icon icon-${stop?'stop':'send'}`));
  $('draft').disabled=view.draftDisabled;$('draft').placeholder=view.placeholder;
  renderContextUsage();
  paintMobileThinking();
  globalThis.WeftComposerSubtasks?.paint($('composer-subtasks'),globalThis.WeftUiCore.composerSubtasks([...uiCore.state.historyEvents.values()]),{scope:`${state.owner}/${state.authEpoch}/${state.sharedSessionId}`,root:$('chat-content')});
  $('device-line').hidden=!view.processingHint;$('device-line').textContent=view.processingHint||'';$('device-line').setAttribute('role','status');$('model-label').textContent=view.modelName;$('model-button').setAttribute('aria-label',view.modelLabel);
  $('plus-button').disabled=view.attachmentsDisabled;
  for(const button of $('attachment-drafts').querySelectorAll('button'))button.disabled=view.attachmentItemDisabled;
  $('model-button').disabled=view.modelDisabled;$('voice-button').disabled=view.voiceDisabled;
  WeftPopover.modelGate({missing:state.loggedIn && (view.host?uiCore.state.modelsKnown===true&&!uiCore.state.models.some(model=>model.configured!==false&&model.available!==false):!state.model),
    field:$('draft'),send:button,empty:!$('chat-content').querySelector('.message'),content:$('chat-content'),composer:$('composer-dock'),openSettings:()=>page('models')});
  syncChatInsets();updateApprovalModeButton();updatePageHeader();
}

function renderQueuedTasks(){uiCore.syncMobileIdentity();const context=conversationTaskContext(),box=$('queued-tasks'),cards=$('queued-cards');
  const rows=state.page==='chat'&&context.sessionId?uiCore.taskQueue().filter(row=>row.state==='queued'):[];
  const wasHidden=box.hidden,oldCards=new Map([...cards.children].map(card=>[card.dataset.taskId,card]));
  if(!rows.length&&!box.hidden)globalThis.WeftMobileMotion?.dismiss(globalThis.WeftMobileMotion?.snapshot(box),true);
  box.hidden=!rows.length;if(wasHidden&&rows.length&&rows.length<=20)globalThis.WeftMobileMotion?.reveal(box);const signature=JSON.stringify([context,rows]);if(cards.dataset.signature===signature)return;
  if(rows.length&&rows.length<=20)for(const [id,card] of oldCards)if(!rows.some(row=>row.taskId===id))globalThis.WeftMobileMotion?.dismiss(globalThis.WeftMobileMotion?.snapshot(card));
  cards.dataset.signature=signature;clear(cards);$('queued-count').textContent=`${rows.length} 个排队中`;
  for(const row of rows){const card=el('article','queued-task');card.setAttribute('aria-label',`排队任务 ${row.text}`);
    card.append(el('p','queued-text',row.text));const actions=el('div','queued-actions');
    for(const [label,edit] of [['编辑后重新排',true],['取消',false]]){const button=el('button','quiet',label);button.type='button';button.disabled=row.busy;
      button.addEventListener('click',async()=>{if(!conversationTaskCurrent(context))return;
        if(edit){const text=await uiCore.editQueuedTask(row.taskId);if(text!==null&&conversationTaskCurrent(context)){
          $('draft').value=text;uiCore.setMessageMode('queue');$('draft').focus({preventScroll:true});}}
        else await uiCore.cancelQueuedTask(row.taskId);renderQueuedTasks();});actions.append(button)}
    card.dataset.taskId=row.taskId;card.append(actions);if(row.notice){const note=el('p','queued-notice',row.notice);note.setAttribute('role','status');card.append(note)}cards.append(card);if(rows.length<=20&&!oldCards.has(row.taskId))globalThis.WeftMobileMotion?.reveal(card)}
  syncChatInsets();
}

let conversationScroll;
function ensureConversationScroll(){return conversationScroll ||= globalThis.WeftConversationScroll($('chat-scroll'),$('chat-content'),$('jump-latest'),pinned=>state.scrollPinned=pinned)}
function scrollBottom(force=false){const wasPinned=state.scrollPinned,scroll=ensureConversationScroll();
  if(force)scroll.latest();else if(wasPinned)scroll.follow();else scroll.hold()}
function handleChatScroll(){const scroll=ensureConversationScroll();scroll.scrolled();if(!scroll.pinned&&$('chat-scroll').scrollTop<40)void loadOlderHistory()}
function renderContextUsage(){const value=globalThis.WeftUiCore.contextUsageView(selectedSharedSession()?.contextUsage),button=$('context-usage');
  button.setAttribute('aria-label',value.label);button.classList.toggle('is-warning',value.warning);button.classList.toggle('is-indeterminate',value.ratio===null);
  const fill=button.querySelector('.context-fill');if(fill)fill.style.strokeDasharray=`${Math.min(1,Math.max(0,value.ratio||0))*100} 100`;
  $('context-tooltip-label').textContent=value.label;$('context-tooltip-detail').textContent=value.detail;
}

function normalizedMessageThumbnail(item,scope,messageId){if(typeof item?.attachmentId!=='string')return null;
  const previewUrl=safeImagePreviewUrl(item.previewUrl,item.attachmentId,scope?.conversationId,messageId);
  const displayUrl=safeImagePreviewUrl(item.displayUrl,item.attachmentId,scope?.conversationId,messageId,true);
  const thumbnail=safeThumbnailDataUrl(item.thumbnailDataUrl),url=displayUrl||thumbnail||
    (previewUrl&&inlineOriginalAllowed(item)?previewUrl:null);
  if(!url&&!previewUrl)return null;
  return {url,previewUrl,displayUrl,attachmentId:item.attachmentId,
    name:String(item.name||'图片').slice(0,120),syncStatus:item.syncStatus}}

function normalizedSharedFile(item){return uiCore.normalizedOriginalFile(item)}

function attachmentSize(size){return uiCore.originalFileSize(size)}

async function saveSharedFile(sessionId,file,button){if(button.disabled)return;button.disabled=true;
  try{const result=await call('shared.attachments.save',{sessionId,attachmentId:file.attachmentId});
    if(result?.pending!==true)throw new Error('OPERATION_FAILED');toast('请选择保存位置')}
  catch(e){toast(safeError(e),true)}finally{button.disabled=false}}

function appendSharedFiles(row,event,sessionId){const refs=Array.isArray(event.data?.originalAttachments)?event.data.originalAttachments:[];
  const files=refs.map(normalizedSharedFile).filter(Boolean);if(!files.length)return 0;
  const list=el('div','message-thumbnails');
  for(const file of files){const button=el('button','attachment-chip');button.type='button';
    button.setAttribute('aria-label',`保存文件 ${file.name}`);button.append(el('span','attachment-kind','文件'),
      el('span','attachment-name',`${file.name} · ${attachmentSize(file.size)}`));
    button.addEventListener('click',()=>{void saveSharedFile(sessionId,file,button)});list.append(button)}
  row.append(list);return files.length}

function displayedPhoneMessage(text,images){const value=String(text||''),match=/(?:^|\n)\[本机附件：([^\n]*)；跨端暂不可见\]$/.exec(value);
  if(!match)return {body:value,note:''};
  const body=value.slice(0,match.index).trimEnd(),names=match[1];
  if(images.length&&names===images.map(image=>image.name).join('、'))return {body,note:''};
  return {body,note:`旧附件：${names}；部分仅保留名称`}}

function messageNode(role,text,thumbnails=[],scope=null,messageId=null){const item=el('article',`message ${role}`);if(role==='user'){
    const images=(Array.isArray(thumbnails)?thumbnails.slice(0,8):[]).map(image=>
      normalizedMessageThumbnail(image,scope,messageId)).filter(Boolean);
    const display=displayedPhoneMessage(text,images);item.append(globalThis.WeftContent ? WeftContent.create(display.body,'markdown') : el('span','',display.body));
    if(images.length){item.classList.add('message-has-images');if(!display.body&&!display.note)item.classList.add('message-image-only')}
    if(display.note)item.append(el('small','message-native-note',display.note));
    if(images.length&&scope){const gallery=el('div','message-thumbnails');
      for(const image of images){const preview=el('button','message-thumbnail');preview.type='button';
        preview.setAttribute('aria-label',`预览已发送图片 ${image.name}`);
        if(image.url){const thumb=el('img');thumb.src=image.url;thumb.alt='';thumb.loading='lazy';thumb.decoding='async';preview.append(thumb)}
        else{const placeholder=el('span','message-image-placeholder');placeholder.setAttribute('aria-hidden','true');preview.append(placeholder)}
        preview.addEventListener('click',()=>openImagePreview(image.previewUrl||image.displayUrl||image.url,image.name,preview,scope,
          {original:!!image.previewUrl,display:!image.previewUrl&&!!image.displayUrl,
            attachmentId:image.attachmentId,messageId,note:image.syncStatus==='shared'?'原图已与同账户设备共享':
            image.syncStatus==='pending'?'原图正在同步':image.previewUrl?'这台手机保存的原图':'旧图片仅保留缩略图'}));gallery.append(preview)}
      item.append(gallery)}return item}
  const frame=el('div','message-body');const content=globalThis.WeftContent?WeftContent.create(text,'markdown',{copy:copyText,openExternal:url=>{location.href=url}}):el('div','markdown',text);
  frame.append(content);const tools=el('div','message-tools');const copy=el('button','copy-button');copy.append(el('span','icon icon-copy'),el('span','','复制回复'));
  copy.addEventListener('click',()=>copyText(text));tools.append(copy);frame.append(tools);item.append(frame);return item}

function enhanceMarkdown(content){if(globalThis.WeftContent)WeftContent.enhance(content,{copy:copyText,openExternal:url=>{location.href=url}});}

async function copyText(text){try{await call('clipboard.copy',{text});toast('已复制')}catch{toast('复制未完成，请长按选择文字',true)}}

function showWelcome(){const content=$('chat-content');clear(content);const welcome=el('div','welcome');const signature=el('div','welcome-signature');signature.append(logo(),el('span','','你的个人空间'));
  welcome.append(signature,el('h1','','今天想做些什么？'),el('p','',state.loggedIn?
    '说说你的目标，或者记录一个想法。':
    '登录后，聊聊你想做的事。'));
  const connection={local:'连接或创建账户',checking:'已保存登录 · 正在核对连接',connected:'电脑账户已连接',
    offline:'电脑暂不可达 · 本机记录仍可使用',expired:'登录已失效 · 请重新登录'};
  const link=el('button','welcome-bottom',connection[state.connection]||connection.offline);
  link.addEventListener('click',()=>page('connect'));welcome.append(link);content.append(welcome);
}

function timeLabel(value){return uiCore.dateText(value)}

function acceptSend(...args){return uiCore.mobile.acceptSend(...args)}

function newSharedRequestId(...args){return uiCore.mobile.newSharedRequestId(...args)}

function sendShared(...args){return uiCore.mobile.sendShared(...args)}

function sendLinked(...args){return uiCore.mobile.sendLinked(...args)}

function send(...args){return uiCore.mobile.send(...args)}

function stop(...args){return uiCore.mobile.stop(...args)}

async function restoreSharedSelection(sessionId,owner,epoch){await listSharedSessions();
  if(!state.restorePending||state.owner!==owner||state.authEpoch!==epoch||state.page!=='chat')return;
  state.restorePending=false;
  if(state.sharedHostAvailable&&state.sharedSessions.some(item=>item.sessionId===sessionId)){
    selectSharedSession(sessionId);return}
  if(state.sharedHostAvailable)try{localStorage.removeItem(chatSourceKey())}catch{}
  loadDraft();updateComposer();if(state.conversationId)await renderConversation();else showWelcome()}

async function resumeCloudLogin(){
  if(!globalThis.WeftCloudMobile)return;
  await WeftCloudMobile.resume({call,adopt:async account=>{
    state.authEpoch++;state.loggedIn=true;state.connection='connected';state.username=account.username;
    state.owner=account.owner||'';state.deviceId=account.deviceId||'';state.profile=account;state.conversationId=null;
    resetMemoryForAuthBoundary('账户已切换。');showProfile(account);
    const info=await call('app.bootstrap');state.model=info.model?.source?info.model:null;
    state.backgroundSync=account.backgroundSync||'unknown';$('model-label').textContent=state.model?.displayName||'选择模型';
    page('chat');await listConversations();loadDraft();await call('app.ready',{owner:state.owner,hasDraft:hasAnyDraft()});toast('已登录');
  }});
}

function refreshCloudDevices(){const owner=state.owner,epoch=state.authEpoch;
  return globalThis.WeftCloudMobile?.pending({call,loggedIn:state.loggedIn,owner,
    current:value=>value===state.owner&&epoch===state.authEpoch});
}

/* Keep the existing mode value/change contract; use shared menu geometry. */

function paintMobileThinking(){const view=uiCore.thinkingView(),host=state.chatSource==='host';$('thinking-separator').hidden=!host||!view.supported;$('pick-thinking').hidden=!host||!view.supported;$('pick-thinking').setAttribute('aria-checked',String(view.enabled));$('pick-thinking').disabled=view.busy;$('thinking-badge').hidden=!host||!view.supported||!view.enabled;}
