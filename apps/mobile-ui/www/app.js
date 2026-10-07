const $ = id => document.getElementById(id);
const state = { page:'chat', conversationId:null, conversations:[], model:null, busy:false, modelSwitching:false, transitionPending:false,
  phase:'idle', progressText:'', loggedIn:false, connection:'local',backgroundSync:'unknown',authEpoch:0,booted:false,
  username:'', owner:'', deviceId:'', ui:null, draft:'', models:[], menu:false, attachmentMenu:false, attachmentPick:null, previewScope:null, previewReturnFocus:null, drawer:false, scrollPinned:true, generation:0,memory:null,lastTerminal:null,sendUncertain:false,
  chatSource:'phone',thingsDetail:null,taskControlAttempt:null,taskControlDrafts:new Map(),taskControlPollTimer:null,taskControlPollGeneration:0,taskControlPollCount:0,taskControlPollStartedAt:0,taskLabels:new Map(),taskLabelOwner:null,taskLabelEpoch:-1,restorePending:false,sharedSessionId:null,sharedSessions:[],sharedHostAvailable:false,sharedEvents:[],sharedNextSeq:-1,
  sharedRunning:false,sharedError:'',sharedPending:null,sharedOutboxLoading:false,sharedAwaiting:null,sharedChecking:null,sharedStopping:false,sharedGeneration:0,sharedLoading:false,sharedPollTimer:null };
const pending = new Map();
const attachmentDrafts = new Map();
const attachmentRevisions = new Map();
let attachmentViewGeneration = 0;
let sequence = 0;
let activeSend = null;
let liveProgressFrame = null, liveProgressVersion = 0;
let liveMotionFrame = null, liveFollowTop = null, liveRevealStart = null, liveRevealLength = 0;
let drawerFrameGeneration = 0;
function invalidateLiveProgress(){liveProgressVersion++;liveProgressFrame=null;liveMotionFrame=null;
  liveFollowTop=null;liveRevealStart=null;liveRevealLength=0}
let draftReportTimer = null, lastReportedDraft = null;
state.handoffViews=new Map();state.linkedEvents=new Map();state.linkedLoading=false;state.linkedPending=null;
state.linkedPollTimer=null;
state.handoffModelNames=new Map();state.handoffModelLastCheck=0;
state.handoffPickerOpen=new Set();state.handoffSelections=new Map();
state.accountModelCredentialConflict=null;
const conversationTasks={owner:null,epoch:-1,entries:new Map(),inFlight:null};
const toolApprovals={owner:null,epoch:-1,deviceId:null,sessions:new Map(),attempts:new Map(),inFlight:new Map(),detail:null,pollTimer:null};
const toolQuestions={owner:null,epoch:-1,deviceId:null,sessions:new Map(),attempts:new Map(),drafts:new Map(),inFlight:new Map(),detail:null,pollTimer:null};
state.taskReturn=null;state.chatRestore=null;
function draftKey(id=state.conversationId){return `weftmate-draft:${state.owner||'local'}:${id||'new'}`}
function sharedDraftKey(id=state.sharedSessionId){return `weftmate-shared-draft:${state.owner||'local'}:${id||'none'}`}
function attachmentConversationId(){return state.chatSource==='host'?state.sharedSessionId||'':state.conversationId||''}
function attachmentKey(id=attachmentConversationId(),owner=state.owner,source=state.chatSource){return source==='host'
  ?`${owner||'local'}:host:${id||'none'}`:`${owner||'local'}:${id||'new'}`}
function currentAttachments(){return attachmentDrafts.get(attachmentKey())||[]}
function selectionKey(){return `weftmate-selection:${state.owner||'local'}`}
function chatSourceKey(){return `weftmate-chat-source:${state.owner||'local'}`}
function savedSharedSelection(){if(!state.loggedIn||!state.owner)return null;
  try{const value=JSON.parse(localStorage.getItem(chatSourceKey())||'null');return value?.source==='host'&&
    typeof value.sessionId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value.sessionId)?value.sessionId:null}catch{return null}}
function hasAnyDraft(){if(!state.loggedIn||!state.owner)return false;
  for(const [key,items] of attachmentDrafts)if(key.startsWith(`${state.owner}:`)&&items.length)return true;
  const prefix=`weftmate-draft:${state.owner}:`;try{for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if((key?.startsWith(prefix)||key?.startsWith(`weftmate-shared-draft:${state.owner}:`))&&localStorage.getItem(key)?.trim())return true}}
  catch{}return false}
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
const mediaId=/^(?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
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
const sessionMediaId=/^sha256:[a-f0-9]{64}$/;
const sessionIdPattern=/^[A-Za-z0-9_-]{1,128}$/;
const receiptIdPattern=/^[A-Za-z0-9._:-]{1,160}$/;
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
  activeSend=null;state.sendUncertain=false;state.conversationId=id;try{if(id)localStorage.setItem(selectionKey(),id);else localStorage.removeItem(selectionKey())}catch{}
  closeAttachmentMenu();loadDraft();page('chat');if(id)void refreshHandoff(id)}
function call(method, params={}) {
  if (!window.weftNative?.postMessage) return Promise.reject(new Error('NATIVE_UNAVAILABLE'));
  const id = `r${++sequence}`;
  return new Promise((resolve,reject)=>{
    const timer = setTimeout(()=>{pending.delete(id);reject(new Error('TIMEOUT'))},45000);
    pending.set(id,{resolve,reject,timer});
    window.weftNative.postMessage(JSON.stringify({id,method,params}));
  });
}
function safeError(error) {
  const code = error?.message || 'OPERATION_FAILED';
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
function toast(text,issue=false){const box=$('toast');clearTimeout(toast.timer);clearTimeout(toast.hideTimer);
  box.textContent=text;box.classList.toggle('error',issue);box.classList.remove('leaving');box.hidden=false;
  toast.timer=setTimeout(closeToast,issue?5200:3500)}
function status(text,issue=false){const line=$('chat-status');line.textContent=issue?'':text;
  line.classList.remove('error');if(issue&&text)toast(text,true)}
function closeImagePreview({restoreFocus=true}={}){const box=$('image-preview');if(box.hidden)return;
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
  const safe=source==='host'?(original||display)?(draft
    ?safeImagePreviewUrl(url,attachmentId,scope.conversationId,undefined,display)
    :safeSessionPreviewUrl(url,attachmentId,scope.conversationId)):safeThumbnailDataUrl(url):
    (original||display)?safeImagePreviewUrl(url,attachmentId,scope?.conversationId,messageId,display):safeThumbnailDataUrl(url);
  if(!safe||!scope||state.page!=='chat'||source!==state.chatSource||state.transitionPending||
    scope.owner!==state.owner||scope.epoch!==state.authEpoch||scope.conversationId!==attachmentConversationId())return;
  closeImagePreview({restoreFocus:false});state.previewScope=scope;state.previewReturnFocus=button;
  $('image-preview-name').textContent=name;$('image-preview-image').src=safe;
  $('image-preview-image').alt=`${name} 的${original?'原图':display?'预览图':'缩略图'}`;
  $('image-preview-note').textContent=note|| (original?'原图':'旧图片仅保留缩略图');
  $('image-preview').hidden=false;
  $('image-preview-close').focus()}
function openDrawer(){closeAttachmentMenu();closeModelMenu();state.drawer=true;
  const generation=++drawerFrameGeneration;
  renderConversationList();$('drawer-scrim').hidden=false;
  void listSharedSessions();
  requestAnimationFrame(()=>{if(!state.drawer||generation!==drawerFrameGeneration)return;
    $('drawer').classList.add('open');$('drawer-scrim').classList.add('open')});$('drawer-close').focus()}
function closeDrawer(){state.drawer=false;drawerFrameGeneration++;
  $('drawer').classList.remove('open');$('drawer-scrim').classList.remove('open');
  clearTimeout(closeDrawer.timer);closeDrawer.timer=setTimeout(()=>{if(!state.drawer)$('drawer-scrim').hidden=true},
    window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:300)}
function closeModelMenu(){state.menu=false;$('model-popover').hidden=true;$('model-button').setAttribute('aria-expanded','false')}
function closeAttachmentMenu({restoreFocus=false}={}){if(!state.attachmentMenu)return;state.attachmentMenu=false;
  $('attachment-popover').classList.remove('open');$('attachment-popover').hidden=true;
  $('plus-button').setAttribute('aria-expanded','false');if(restoreFocus)$('plus-button').focus()}
function renderAttachmentPickStatus(){const box=$('attachment-pick-status'),pick=state.attachmentPick;
  box.hidden=!pick;if(pick)$('attachment-pick-label').textContent=pick.requestId?
    `正在系统中选择${pick.kind==='image'?'图片':'文件'}，返回后可取消等待。`:'正在打开系统选择器…';
  syncChatInsets()}
function cancelAttachmentPick({announce=false}={}){if(!state.attachmentPick)return;
  state.attachmentPick=null;renderAttachmentPickStatus();updateComposer();
  if(announce)status('已停止等待选择结果，原有消息草稿保留')}
function openAttachmentMenu(){if(state.chatSource==='host'&&!selectedSharedSession()?.sendAvailable){toast('这段电脑会话仅可查看，无法添加图片',true);return}
  if(state.attachmentPick)return;if(state.attachmentMenu){closeAttachmentMenu({restoreFocus:true});return}
  closeModelMenu();state.attachmentMenu=true;const popup=$('attachment-popover');popup.hidden=false;
  $('pick-file').hidden=false;$('attachment-note').hidden=state.chatSource!=='host';
  $('plus-button').setAttribute('aria-expanded','true');requestAnimationFrame(()=>popup.classList.add('open'));placeAttachmentMenu();$('pick-image').focus()}
function placeAttachmentMenu(){const top=$('plus-button').getBoundingClientRect().top;
  const popup=$('attachment-popover');popup.style.bottom=`${Math.max(100,window.innerHeight-top+8)}px`;
  popup.style.maxHeight=`${Math.max(150,top-20)}px`}
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
    status(pick.kind==='image'?'':'正在读取附件草稿…');refreshAttachmentDrafts(pick.viewGeneration).then(restored=>{
      if(restored&&state.owner===pick.owner&&state.authEpoch===pick.epoch&&pick.source===state.chatSource&&
        attachmentViewGeneration===pick.viewGeneration)
        status(currentAttachments().length?(pick.kind==='image'?'':'附件已加入草稿，确认后可发送'):
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
function placeModelMenu(){const top=$('model-button').getBoundingClientRect().top;const popup=$('model-popover');
  popup.style.bottom=`${Math.max(110,window.innerHeight-top+8)}px`;
  popup.style.maxHeight=`${Math.min(300,Math.max(160,top-24),Math.floor(window.innerHeight*.46))}px`}
function page(name){
  if(name!=='things'&&name!=='chat'){state.taskReturn=null;state.chatRestore=null}
  stopTaskControlObservation();stopApprovalObservation();stopQuestionObservation();const previousPage=state.page;closeDrawer();closeModelMenu();closeAttachmentMenu();if(name!=='chat'){
    closeImagePreview({restoreFocus:false});invalidateLiveProgress();cancelAttachmentPick();stopSharedPoll();if(state.restorePending){state.restorePending=false;loadDraft();updateComposer()}}state.page=name;state.generation++;
  $('chat-page').classList.toggle('active',name==='chat');$('generic-page').classList.toggle('active',name!=='chat');
  $('header-subtitle').textContent=name==='chat'?'同一个助手，接着聊。':{
    things:'正在做的事',memory:'记忆',capabilities:'能力与扩展',workspaces:'项目与成果',devices:'设备',notifications:'通知',settings:'设置',
    account:'我的资料',password:'修改密码',models:'对话模型',sync:'离线与同步',appearance:'外观',updates:'更新',connect:'连接电脑'
  }[name]||name;
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('current',b.dataset.page===name));
  if(name==='chat'){
    if(state.chatSource==='host'){renderSharedConversation();loadSharedHistory();scheduleSharedPoll()}
    else{if(previousPage!=='chat')refreshAttachmentDrafts();renderConversation()}return}renderPage(name);
}
function updateComposer(){const text=$('draft').value;state.draft=text;const key=state.chatSource==='host'?sharedDraftKey():draftKey();
  if(state.loggedIn)try{if(text)localStorage.setItem(key,text);else localStorage.removeItem(key)}catch{}
  reportDraftState();
  const linked=!!selectedBinding(),host=state.chatSource==='host'||linked,
    session=selectedSharedSession(),busy=host?!!state.sharedPending||!!state.linkedPending||state.sharedOutboxLoading||state.busy:state.busy;
  const ready=(!!text.trim()||currentAttachments().length>0)&&state.loggedIn&&!busy&&!state.modelSwitching&&!state.transitionPending&&
    !state.restorePending&&(host?!!session?.sendAvailable:!state.sendUncertain)&&
    (!linked||currentAttachments().length===0);$('send-button').disabled=!ready;
  $('send-button').classList.toggle('ready',ready);$('send-button').hidden=host?false:busy;
  $('stop-button').hidden=host?!state.sharedRunning:!busy;
  $('draft').disabled=!state.loggedIn||state.transitionPending||state.restorePending||host&&!session?.sendAvailable;
  $('draft').placeholder=host?(session?.sendAvailable?'继续这段电脑会话…':'这段电脑会话仅可查看'):'和 WeftMate 聊聊…';
  $('device-line').textContent=host?`${linked?'原对话 · 电脑续聊':'电脑共享会话'} · ${state.sharedHostAvailable?'已连接':'离线记录'}`:'执行于这台手机';
  $('model-label').textContent=host?'沿用电脑会话模型':state.model?.displayName||'选择模型';
  $('model-button').setAttribute('aria-label',host?'沿用电脑会话绑定的模型':'选择模型');
  $('plus-button').disabled=!state.loggedIn||state.restorePending||state.transitionPending||!!state.attachmentPick||
    (host?!session?.sendAvailable||!!state.sharedPending||linked:state.busy);
  for(const button of $('attachment-drafts').querySelectorAll('button'))button.disabled=state.busy||state.transitionPending||
    host&&!!state.sharedPending;
  $('model-button').disabled=host||!state.loggedIn||state.busy||state.modelSwitching||state.transitionPending;
  $('voice-button').disabled=!state.loggedIn||busy||state.modelSwitching||state.transitionPending||state.restorePending||host&&!session?.sendAvailable;
  syncChatInsets();
}
function scrollBottom(force=false){if(!force&&!state.scrollPinned)return;
  const box=$('chat-scroll'),bottom=Math.max(0,(Number.isFinite(box.scrollHeight)?box.scrollHeight:0)-
    (Number.isFinite(box.clientHeight)?box.clientHeight:0));
  if(state.busy&&state.scrollPinned)liveFollowTop=bottom;
  if(!Number.isFinite(box.scrollTop)||Math.abs(box.scrollTop-bottom)>1)box.scrollTop=bottom;
  $('jump-latest').hidden=true}
function handleChatScroll(){const box=$('chat-scroll');
  if(state.busy&&state.scrollPinned&&liveFollowTop!==null){
    if(Math.abs(box.scrollTop-liveFollowTop)<=2)return;
    if(box.scrollTop<liveFollowTop-2){state.scrollPinned=false;liveFollowTop=null;
      $('jump-latest').hidden=false;return}}
  state.scrollPinned=box.scrollHeight-box.scrollTop-box.clientHeight<80;
  if(!state.scrollPinned)liveFollowTop=null;$('jump-latest').hidden=state.scrollPinned}
function normalizedMessageThumbnail(item,scope,messageId){if(typeof item?.attachmentId!=='string')return null;
  const previewUrl=safeImagePreviewUrl(item.previewUrl,item.attachmentId,scope?.conversationId,messageId);
  const displayUrl=safeImagePreviewUrl(item.displayUrl,item.attachmentId,scope?.conversationId,messageId,true);
  const thumbnail=safeThumbnailDataUrl(item.thumbnailDataUrl),url=displayUrl||thumbnail||
    (previewUrl&&inlineOriginalAllowed(item)?previewUrl:null);
  if(!url&&!previewUrl)return null;
  return {url,previewUrl,displayUrl,attachmentId:item.attachmentId,
    name:String(item.name||'图片').slice(0,120),syncStatus:item.syncStatus}}
function normalizedSharedFile(item){if(!item||typeof item.attachmentId!=='string'||!mediaId.test(item.attachmentId)||
    typeof item.name!=='string'||!item.name.trim()||item.name.length>128||/[\x00-\x1f\\/]/.test(item.name)||
    typeof item.contentType!=='string'||!/^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,63}$/.test(item.contentType)||
    ['image/png','image/jpeg','image/webp','image/gif'].includes(item.contentType)||
    !Number.isSafeInteger(item.size)||item.size<1||item.size>1024*1024*1024||
    typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256))return null;
  return {attachmentId:item.attachmentId,name:item.name,contentType:item.contentType,size:item.size,sha256:item.sha256}}
function attachmentSize(size){if(size>=1024*1024*1024)return `${(size/1024/1024/1024).toFixed(1)} GB`;
  if(size>=1024*1024)return `${(size/1024/1024).toFixed(size>=10*1024*1024?0:1)} MB`;
  if(size>=1024)return `${Math.ceil(size/1024)} KB`;return `${size} B`}
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
    const display=displayedPhoneMessage(text,images);item.textContent=display.body;
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
  const frame=el('div','message-body');const content=el('div','markdown');
  if(window.WeftFormat?.render){content.innerHTML=window.WeftFormat.render(text);enhanceMarkdown(content)}else content.textContent=text;
  frame.append(content);const tools=el('div','message-tools');const copy=el('button','copy-button');copy.append(el('span','icon icon-copy'),el('span','','复制回复'));
  copy.addEventListener('click',()=>copyText(text));tools.append(copy);frame.append(tools);item.append(frame);return item}
function enhanceMarkdown(content){for(const pre of content.querySelectorAll('pre')){const code=pre.querySelector('code');if(!code)continue;
    const wrapper=el('div','code-block');const top=el('div','code-head');const language=([...code.classList].find(v=>v.startsWith('language-'))||'').replace('language-','')||'代码';
    top.append(el('span','',language));const button=el('button','copy-button');button.append(el('span','icon icon-copy'),el('span','','复制代码'));
    button.addEventListener('click',()=>copyText(code.textContent));top.append(button);pre.parentNode.insertBefore(wrapper,pre);wrapper.append(top,pre)}
  for(const link of content.querySelectorAll('a')){link.target='_blank';link.rel='noopener noreferrer';}
}
async function copyText(text){try{await call('clipboard.copy',{text});toast('已复制')}catch{toast('复制未完成，请长按选择文字',true)}}
function showWelcome(){const content=$('chat-content');clear(content);const welcome=el('div','welcome');const signature=el('div','welcome-signature');signature.append(logo(),el('span','','你的个人空间'));
  welcome.append(signature,el('h1','','今天想做些什么？'),el('p','',state.loggedIn?
    '可以从一句话开始。记录会保存在这台手机，联网后再同步到你的账户。':
    '登录或注册后开始使用。已登录过的账户即使暂时离线，也能继续本机对话。'));
  const connection={local:'连接或创建账户',checking:'已保存登录 · 正在核对连接',connected:'电脑账户已连接',
    offline:'电脑暂不可达 · 本机记录仍可使用',expired:'登录已失效 · 请重新登录'};
  const link=el('button','welcome-bottom',connection[state.connection]||connection.offline);
  link.addEventListener('click',()=>page('connect'));welcome.append(link);content.append(welcome);
}
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
  state.sharedEvents=[];state.sharedNextSeq=-1;state.sharedLoading=false;state.sharedRunning=!!selectedSharedSession()?.running;
  state.sharedError='';state.sharedPending=null;state.sharedOutboxLoading=true;state.sharedAwaiting=null;state.sharedChecking=null;
  loadDraft();page('chat');void loadSharedOutbox()}
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
    if($('chat-status').textContent==='电脑已受理消息，等待会话记录更新')status('')}}
function waitForSharedTurn(sessionId,text,afterSeq,attachmentIds=[]){state.sharedAwaiting={sessionId,text,afterSeq,attachmentIds,seenUser:false};
  for(const event of state.sharedEvents)trackSharedAcceptedTurn(event)}
function renderSharedConversation(){if(state.chatSource!=='host'||state.page!=='chat')return;
  const scroll=$('chat-scroll'),previousScroll=scroll.scrollTop,content=$('chat-content');clear(content);
  const session=selectedSharedSession(),heading=el('div','shared-heading');
  heading.append(el('strong','',session?.title||'电脑共享会话'),el('small','',session?.sendAvailable?'沿用这段会话在电脑上绑定的模型':'这段电脑会话仅可查看'));
  content.append(heading);
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
        content.append(row);
        if(event.data?.truncated)content.append(el('p','message-state','这条电脑消息仅显示前一部分'))}}
    else if(event.type==='turn.started'){lastTurn='running';lastEndReasonKind=''}
    else if(event.type==='turn.ended'){lastTurn=event.data?.reason||'unknown';
      lastEndReasonKind=lastTurn==='error'&&event.data?.endReasonKind==='max-tokens'?'max-tokens':''}
  }
  state.sharedRunning=lastTurn==='running'||!!session?.running;
  if(lastTurn==='running'||state.sharedRunning)content.append(el('p','shared-turn-state','电脑正在处理这段会话…'));
  else if(lastTurn&&lastTurn!=='completed')content.append(el('p','shared-turn-state',lastTurn==='error'&&lastEndReasonKind==='max-tokens'
    ?'本轮因输出限制结束，可继续对话。':{
      aborted:'电脑回合已停止',error:'电脑回合未完成',blocked:'电脑回合等待处理',unknown:'电脑回合状态待确认'}[lastTurn]||'电脑回合状态待确认'));
  if(state.sharedPending){const box=el('div','shared-notice',state.sharedPending.state==='uncertain'?
    '发送结果待核对。请求已在手机保留，不会自动生成另一条消息。':'正在提交到电脑会话…');
    if(state.sharedPending.state==='uncertain'){const check=el('button','shared-check',state.sharedChecking?'正在核对…':'检查状态');
      check.disabled=!!state.sharedChecking;check.addEventListener('click',()=>{void checkSharedPending()});box.append(check)}content.append(box)}
  if(!state.sharedEvents.length&&!state.sharedError)content.append(el('p','muted',state.sharedLoading?'正在读取电脑会话…':'这段会话还没有可显示的文字记录'));
  renderConversationTasks();updateComposer();if(state.scrollPinned)scrollBottom();else scroll.scrollTop=previousScroll;restoreTaskChat()}
async function loadSharedHistory(){if(state.chatSource!=='host'||!state.sharedSessionId||state.sharedLoading||document.visibilityState==='hidden')return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration,sessionId=state.sharedSessionId;
  state.sharedLoading=true;try{let after=state.sharedNextSeq,more=true;
    while(more){const result=await call('shared.sessions.events',{sessionId,afterSeq:after});
      if(!sharedViewCurrent(owner,epoch,generation,sessionId))return;
      if(result?.source!=='host'||result.sessionId!==sessionId||!Array.isArray(result.events)||!Number.isSafeInteger(result.nextSeq))
        throw new Error('OPERATION_FAILED');
      const next=result.nextSeq;if(next<after||result.hasMore&&next<=after)throw new Error('OPERATION_FAILED');
      for(const event of result.events)if(Number.isSafeInteger(event?.seq)&&event.seq>after&&
        ['user.message','assistant.message','turn.started','turn.ended'].includes(event.type)){
          state.sharedEvents.push(event);trackSharedAcceptedTurn(event)}
      state.sharedEvents.sort((a,b)=>a.seq-b.seq);after=next;state.sharedNextSeq=next;more=result.hasMore===true;
    }
    state.sharedError='';state.sharedLoading=false;renderSharedConversation();void refreshConversationTasks();
  }catch(e){if(sharedViewCurrent(owner,epoch,generation,sessionId)){
      state.sharedError='电脑会话暂时无法更新，已读取的内容仍可查看';
      for(const entry of conversationTasks.entries.values())if(entry.sessionId===sessionId)entry.notice='连接中断，执行进展待更新。重连后可重新核对。';
      renderSharedConversation()}}
  finally{if(sharedViewCurrent(owner,epoch,generation,sessionId))state.sharedLoading=false}}
async function loadSharedOutbox(){if(state.chatSource!=='host')return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration,sessionId=state.sharedSessionId,
    pendingAtStart=state.sharedPending?.requestId||null;
  try{const result=await call('shared.outbox.list');if(!sharedViewCurrent(owner,epoch,generation,sessionId)||
    (state.sharedPending?.requestId||null)!==pendingAtStart)return;
    const accepted=(result?.commands||[]).find(item=>item.sessionId===sessionId&&item.kind==='session.message'&&
      (!state.sharedPending||item.requestId===state.sharedPending.requestId)&&item.state==='accepted');
    if(accepted&&state.sharedPending?.text!==undefined){const text=state.sharedPending.text,key=sharedDraftKey(),
      attachmentIds=state.sharedPending.attachmentIds||[];
      try{if(localStorage.getItem(key)?.trim()===text)localStorage.removeItem(key)}catch{}
      if($('draft').value.trim()===text)$('draft').value='';status('电脑已受理消息，等待会话记录更新');
      clearAcceptedHostAttachments(attachmentIds);
      waitForSharedTurn(sessionId,text,state.sharedPending.afterSeq??state.sharedNextSeq,attachmentIds)}
    else if(accepted)void refreshAttachmentDrafts();
    const rejected=(result?.commands||[]).find(item=>item.sessionId===sessionId&&item.kind==='session.message'&&
      item.requestId===state.sharedPending?.requestId&&item.state==='rejected');
    if(rejected)status(rejected.errorCode?safeError(new Error(rejected.errorCode)):'电脑未受理这条请求；草稿仍保留',true);
    const pending=(result?.commands||[]).find(item=>item.sessionId===sessionId&&item.kind==='session.message'&&
      ['pending','uncertain'].includes(item.state));
    state.sharedPending=pending?{requestId:pending.requestId,state:'uncertain',text:state.sharedPending?.text,
      attachmentIds:state.sharedPending?.attachmentIds||[],afterSeq:state.sharedPending?.afterSeq}:null;renderSharedConversation();
  }catch{}finally{if(sharedViewCurrent(owner,epoch,generation,sessionId)){
    state.sharedOutboxLoading=false;updateComposer();renderSharedConversation()}}}
async function checkSharedPending(){const pending=state.sharedPending;
  if(state.chatSource!=='host'||!pending||pending.state!=='uncertain'||state.sharedChecking)return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration,sessionId=state.sharedSessionId,
    requestId=pending.requestId;
  state.sharedChecking=requestId;renderSharedConversation();
  try{const result=await call('shared.outbox.reconcile');
    if(!sharedViewCurrent(owner,epoch,generation,sessionId))return;
    if(result?.source!=='host'||!Array.isArray(result.commands))throw new Error('COMMAND_RECEIPT_INVALID');
    const outcome=result.commands.find(item=>item.sessionId===sessionId&&item.requestId===requestId);
    if(outcome?.state==='uncertain')status('电脑仍未确认这条请求；原请求会保留，暂不重复发送');
    else if(outcome?.state==='rejected')status(safeError(new Error(outcome.errorCode||'OPERATION_FAILED')),true);
  }catch(e){if(sharedViewCurrent(owner,epoch,generation,sessionId))status(
      e?.message==='TIMEOUT'?'核对超时，原请求仍保留；请稍后重试':safeError(e),e?.message!=='TIMEOUT')}
  finally{if(sharedViewCurrent(owner,epoch,generation,sessionId)){
      await Promise.all([loadSharedOutbox(),listSharedSessions(),loadSharedHistory()]);
      if(state.sharedChecking===requestId)state.sharedChecking=null;
      renderSharedConversation();scheduleSharedPoll()}
    else if(state.sharedChecking===requestId)state.sharedChecking=null}}
async function renderConversation({silent=false}={}){if(state.page!=='chat')return;
  const id=state.conversationId,gen=state.generation,owner=state.owner,epoch=state.authEpoch;
  if(state.chatSource==='host'){renderSharedConversation();return}
  if(!id){showWelcome();return}try{const result=await call('conversations.messages',{conversationId:id});
    if(state.page!=='chat'||state.chatSource!=='phone'||state.conversationId!==id||state.generation!==gen||
      state.owner!==owner||state.authEpoch!==epoch||state.transitionPending)return;
    const content=$('chat-content');clear(content);
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
        content.append(row);
      }
      const late=result.messages.filter(m=>Number.isSafeInteger(m.serverSeq)&&
        m.serverSeq>binding.cutoverSyncSeq&&!shown.has(m.sourceEventId)||m.serverSeq==null);
      if(late.length){content.append(el('div','handoff-divider','交接后才同步的手机记录 · 已保留，尚未自动并入电脑上下文'));
        for(const m of late)content.append(messageNode(m.role,m.text,m.thumbnails,previewScope,m.messageId||m.id))}
      content.append(handoffCard(id));
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
    renderConversationTasks();
    if(binding)void refreshConversationTasks();
    if(result.turnStatus==='running'&&state.busy){if(state.scrollPinned)scheduleLiveMotion()}
    else scrollBottom();restoreTaskChat();
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
  if(!target.startsWith(shown)||window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    if(shown!==target)text._liveTextNode.data=target;liveRevealStart=null}
  else if(shown!==target)scheduleLiveMotion();
  text.hidden=!state.progressText;const label=phaseLabel(state.phase);
  if(phase.textContent!==label)phase.textContent=label;
  if(state.scrollPinned){if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)scrollBottom();
    else scheduleLiveMotion()}}
function toolLabel(name){return {open_settings:'系统设置',open_app:'打开应用',list_launchable_apps:'应用列表'}[name]||'手机动作'}
function applyTheme(value){state.appearance=value;const dark=value==='dark'||value==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.colorScheme=dark?'dark':'light'}
function receiptStatus(name){return {dispatched:'已请求，待核对',observed:'已观察到结果',failed:'未完成',uncertain:'结果待确认'}[name]||'状态待确认'}
async function listConversations(){if(!state.loggedIn){state.conversations=[];renderConversationList();return}
  const owner=state.owner,epoch=state.authEpoch;
  try{const result=await call('conversations.list');if(owner!==state.owner||epoch!==state.authEpoch||state.transitionPending)return;
    state.conversations=Array.isArray(result?.conversations)?result.conversations:[];renderConversationList()}
  catch(e){if(owner===state.owner&&epoch===state.authEpoch&&!state.transitionPending)toast(safeError(e),true)}}
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
  try{const result=await call('models.host');if(state.owner!==owner||state.authEpoch!==epoch)return;
    for(const item of result.models||[])if(typeof item?.profileId==='string'&&
      typeof item.displayName==='string'&&item.displayName.trim())
      state.handoffModelNames.set(item.profileId,item.displayName.slice(0,100));
    if(state.page==='chat'&&selectedBinding()?.sessionId===binding.sessionId)
      void renderConversation({silent:true})
  }catch{ /* A human-readable generic label remains. */ }}
function scheduleHandoffPoll(conversationId){clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;
  if(state.chatSource!=='phone'||state.page!=='chat'||state.conversationId!==conversationId||
    !state.loggedIn||state.transitionPending||document.visibilityState==='hidden')return;
  state.linkedPollTimer=setTimeout(()=>{void refreshHandoff(conversationId)},12000)}
async function refreshHandoff(conversationId=state.conversationId){if(!state.loggedIn||!conversationId||state.transitionPending)return null;
  const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
  try{const view=await call('shared.conversations.get',{conversationId});
    if(state.owner!==owner||state.authEpoch!==epoch||state.transitionPending||
      view?.source!=='host'||view.conversationId!==conversationId)return null;
    state.handoffViews.set(conversationId,view);
    if(view.status==='active')state.handoffPickerOpen.delete(conversationId);
    if(view.binding?.sessionId){
      if(state.conversationId===conversationId&&state.chatSource==='phone'){
        state.sharedSessionId=view.binding.sessionId;void listSharedSessions();
        void refreshHandoffModelName(view.binding);void loadLinkedHistory(conversationId)}}
    if(state.conversationId===conversationId&&state.chatSource==='phone'&&state.generation===generation){
      renderConversationList();if(view.status!=='unbound'||!state.handoffPickerOpen.has(conversationId))
        void renderConversation({silent:true});updateComposer()}
    return view
  }catch{return null}finally{if(state.owner===owner&&state.authEpoch===epoch)
    scheduleHandoffPoll(conversationId)}}
async function loadLinkedHistory(conversationId=state.conversationId){const binding=selectedBinding();
  if(!binding||state.linkedLoading)return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.generation,sessionId=binding.sessionId;
  state.linkedLoading=true;let after=-1;const events=[];
  try{for(let pageNo=0;pageNo<20;pageNo++){
      const result=await call('shared.sessions.events',{sessionId,afterSeq:after});
      if(state.owner!==owner||state.authEpoch!==epoch||state.generation!==generation||
        state.conversationId!==conversationId||selectedBinding()?.sessionId!==sessionId)return;
      if(result?.sessionId!==sessionId||!Array.isArray(result.events)||!Number.isSafeInteger(result.nextSeq)||
        result.nextSeq<after)throw new Error('COMMAND_RECEIPT_INVALID');
      events.push(...result.events.filter(event=>Number.isSafeInteger(event?.seq)&&
        ['user.message','assistant.message','turn.started','turn.ended'].includes(event.type)));
      if(result.hasMore!==true){state.linkedEvents.set(conversationId,{events,cached:result.cached===true,
        tailUnknown:result.tailUnknown===true,historyTruncated:result.historyTruncated===true,
        oldestSeq:result.oldestSeq});break}
      if(result.nextSeq<=after)throw new Error('COMMAND_RECEIPT_INVALID');after=result.nextSeq}
    if(state.conversationId===conversationId&&state.chatSource==='phone')void renderConversation({silent:true})
  }catch{if(state.conversationId===conversationId&&state.chatSource==='phone')status('电脑会话暂时无法更新，已缓存记录仍可查看',true)}
  finally{if(state.owner===owner&&state.authEpoch===epoch){state.linkedLoading=false;
    scheduleHandoffPoll(conversationId)}}}
function handoffIntentKey(id){return `weftmate-handoff:${state.owner}:${id}`}
function handoffCard(id){const view=state.handoffViews.get(id),binding=selectedBinding(),card=el('section','handoff-card');
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
        if(found)showHostCommandDetail(found);else page('things')
      }catch{page('things')}});card.append(tasks);
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
async function listSharedSessions(){if(!state.loggedIn||state.transitionPending)return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration;
  try{const result=await call('shared.sessions.list');if(owner!==state.owner||epoch!==state.authEpoch||generation!==state.sharedGeneration)return;
    if(result?.source!=='host'||!Array.isArray(result.sessions))throw new Error('OPERATION_FAILED');
    state.sharedSessions=result.sessions.filter(item=>item?.source==='host'&&typeof item.sessionId==='string'&&item.sessionId);
    state.sharedHostAvailable=result.hostAvailable===true;renderConversationList();
    if(state.chatSource==='host'){state.sharedRunning=!!selectedSharedSession()?.running;updateComposer();renderSharedConversation()}
    else if(selectedBinding()){state.sharedRunning=!!selectedSharedSession()?.running;
      updateComposer();if(state.page==='chat')void renderConversation({silent:true})}
  }catch(e){if(owner!==state.owner||epoch!==state.authEpoch||generation!==state.sharedGeneration)return;
    state.sharedHostAvailable=false;renderConversationList();if(state.chatSource==='host'){
      state.sharedError='电脑暂不可达，已显示上次读取的内容';updateComposer();renderSharedConversation()}
    else if(selectedBinding()){updateComposer();if(state.page==='chat')void renderConversation({silent:true})}}}
function renderConversationList(){const target=$('conversation-list'),previousScroll=target.scrollTop;clear(target);const filter=$('conversation-search').value.trim().toLocaleLowerCase();
  target.setAttribute('aria-label','最近对话');
  const phone=state.conversations.filter(v=>typeof v?.id==='string'&&typeof v?.title==='string')
    .map(item=>({source:'phone',id:item.id,title:item.title,createdAt:item.updatedAt||item.createdAt,
      model:item.modelName||item.modelDisplayName||null,record:item}));
  const linkedIds=new Set(phone.map(item=>state.handoffViews.get(item.id)?.binding?.sessionId||
    item.record?.binding?.sessionId).filter(Boolean));
  const host=state.sharedSessions.filter(v=>v?.source==='host'&&typeof v.sessionId==='string'&&
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
    b.addEventListener('click',()=>item.source==='phone'?selectConversation(item.id):selectSharedSession(item.id));target.append(b)}
  if(!entries.length)target.append(el('p','muted',filter?'没有匹配的对话':state.loggedIn?'还没有对话':'登录后查看对话'));
  target.scrollTop=previousScroll;
}
function timeLabel(value){const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d):'本机记录'}
function acceptSend(attempt,conversationId,turnId){if(activeSend!==attempt||!conversationId||
  attempt.owner!==state.owner||attempt.epoch!==state.authEpoch||
  (attempt.conversationId&&attempt.conversationId!==conversationId)||
  (attempt.acceptedId&&attempt.acceptedId!==conversationId)||
  (attempt.turnId&&turnId&&attempt.turnId!==turnId))return false;
  attempt.acceptedId=conversationId;if(turnId)attempt.turnId=turnId;
  if(attempt.adopted)return true;attempt.adopted=true;state.sendUncertain=false;
  attachmentDrafts.delete(attempt.key);markAttachmentRevision(attempt.key);
  try{if(localStorage.getItem(attempt.draftKey)?.trim()===attempt.text)localStorage.removeItem(attempt.draftKey)}catch{}
  if((state.conversationId||'')===attempt.conversationId){
    state.conversationId=conversationId;try{localStorage.setItem(selectionKey(),conversationId)}catch{}
    if($('draft').value.trim()===attempt.text)$('draft').value='';
    renderAttachmentDrafts();updateComposer();
  }return true}
function newSharedRequestId(){return `ui-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2,10)}`}
async function sendShared(){const text=$('draft').value.trim(),session=selectedSharedSession();
  const items=[...currentAttachments()];
  if((!text&&!items.length)||!session?.sendAvailable||state.sharedPending||state.sharedOutboxLoading||state.transitionPending)return;
  if(text.length>16384){status('消息过长，请缩短后发送',true);return}
  const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration,sessionId=session.sessionId,
    requestId=newSharedRequestId(),key=sharedDraftKey(),attachmentIds=items.map(item=>item.attachmentId);
  const afterSeq=state.sharedNextSeq;state.sharedPending={requestId,state:'submitting',text,attachmentIds,afterSeq};
  updateComposer();status('正在提交到电脑会话…');renderSharedConversation();
  try{const result=await call('shared.send',{sessionId,text,requestId,...(attachmentIds.length?{attachmentIds}:{})});
    if(!sharedViewCurrent(owner,epoch,generation,sessionId))return;
    if(result?.source!=='host'||result.sessionId!==sessionId||result.requestId!==requestId)throw new Error('OPERATION_FAILED');
    if(result.state==='accepted'){
      state.sharedPending=null;
      try{if(localStorage.getItem(key)?.trim()===text)localStorage.removeItem(key)}catch{}
      if($('draft').value.trim()===text)$('draft').value='';
      clearAcceptedHostAttachments(attachmentIds);
      status('电脑已受理消息，等待会话记录更新');waitForSharedTurn(sessionId,text,afterSeq,attachmentIds);void loadSharedHistory();
    }else if(result.state==='uncertain'){state.sharedPending={requestId,state:'uncertain',text,attachmentIds,afterSeq};
      status('发送结果待核对 · 请求已保留，不会自动重发')}
    else{state.sharedPending=null;status(safeError(new Error(result.errorCode||'OPERATION_FAILED')),true)}
  }catch(e){if(!sharedViewCurrent(owner,epoch,generation,sessionId))return;
    state.sharedPending=e?.message==='TIMEOUT'?{requestId,state:'uncertain',text,attachmentIds,afterSeq}:null;
    if(state.sharedPending)status('发送结果待核对 · 请查看电脑会话或待处理记录');
    else status(safeError(e),true)}
  finally{if(sharedViewCurrent(owner,epoch,generation,sessionId)){updateComposer();renderSharedConversation();scheduleSharedPoll()}}}
async function sendLinked(){const binding=selectedBinding(),session=selectedSharedSession(),text=$('draft').value.trim();
  if(!binding||!session?.sendAvailable||!text||state.linkedPending||currentAttachments().length)return;
  const owner=state.owner,epoch=state.authEpoch,conversationId=state.conversationId,
    sessionId=binding.sessionId,key=`weftmate-linked-send:${owner}:${conversationId}`;
  let marker;try{marker=JSON.parse(localStorage.getItem(key)||'null')}catch{marker=null}
  if(marker&&(marker.sessionId!==sessionId||marker.text!==text)){status('上一条电脑消息待核对；原草稿仍保留',true);return}
  marker ||= {requestId:newSharedRequestId(),sessionId,text};
  try{localStorage.setItem(key,JSON.stringify(marker))}catch{status('无法保存发送编号，本次没有提交',true);return}
  state.linkedPending=marker.requestId;updateComposer();
  const current=()=>state.owner===owner&&state.authEpoch===epoch&&state.chatSource==='phone'&&
    state.conversationId===conversationId&&selectedBinding()?.sessionId===sessionId;
  try{const rows=await call('shared.outbox.list');if(!current())return;
    let found=rows?.commands?.find(item=>item.requestId===marker.requestId&&item.sessionId===sessionId);
    if(!found||found.state==='pending'||found.state==='uncertain'){
      const sent=await call('shared.send',{sessionId,text:marker.text,requestId:marker.requestId});
      if(!current())return;found=sent}
    if(found?.state==='accepted'){
      if($('draft').value.trim()===text)$('draft').value='';
      try{localStorage.removeItem(key);localStorage.removeItem(draftKey())}catch{}
      status('电脑已受理，等待真实回复');await Promise.all([refreshHandoff(conversationId),loadLinkedHistory(conversationId)])
    }else status('结果待核对；原请求编号和草稿已保留',true)
  }catch(error){if(current())status(error?.message==='TIMEOUT'?'发送结果待核对；原请求编号已保留':safeError(error),true)}
  finally{if(state.owner===owner&&state.authEpoch===epoch){state.linkedPending=null;updateComposer()}}}
async function send(){if(state.chatSource==='host')return sendShared();
  if(selectedBinding())return sendLinked();
  const text=$('draft').value.trim(),items=[...currentAttachments()];if((!text&&!items.length)||state.busy||state.sendUncertain)return;
  if(text.length>16384){status('消息过长，请缩短后发送',true);return}
  const owner=state.owner,epoch=state.authEpoch,conversationId=state.conversationId||'',attachmentIds=items.map(item=>item.attachmentId);
  const attempt={owner,epoch,conversationId,key:attachmentKey(),draftKey:draftKey(),text,acceptedId:null,turnId:null,adopted:false};
  activeSend=attempt;state.lastTerminal=null;state.busy=true;updateComposer();status('消息正在保存…');
  try{const result=await call('chat.send',{conversationId,text,attachmentIds});
    if(activeSend!==attempt||owner!==state.owner||epoch!==state.authEpoch)return;
    if(!result?.conversationId)throw new Error('OPERATION_FAILED');
    if(!acceptSend(attempt,result.conversationId,result.turnId))return;
    const terminal=state.lastTerminal?.conversationId===result.conversationId&&
      (!result.turnId||!state.lastTerminal.turnId||state.lastTerminal.turnId===result.turnId);
    if(!terminal)status('手机模型正在回复…');
    await listConversations();await renderConversation();scrollBottom();
    if(terminal&&['failed','cancelled'].includes(state.lastTerminal.status))refreshAttachmentDrafts();
    if(activeSend===attempt)activeSend=null;
  }catch(e){if(activeSend!==attempt||owner!==state.owner||epoch!==state.authEpoch)return;
    if(attempt.acceptedId){if(state.lastTerminal?.conversationId!==attempt.acceptedId)status('手机模型正在回复…');
      activeSend=null;return}
    state.busy=false;state.sendUncertain=e?.message==='TIMEOUT';updateComposer();
    if(state.sendUncertain){toast('发送结果尚未确认，请从会话列表核对；不会自动重发',true);
      status('发送结果待确认 · 请在会话列表核对后继续')}
    else status(safeError(e),true);
    if(!state.sendUncertain)activeSend=null}}
async function stop(){if(state.chatSource==='host'||selectedBinding()){
    if(state.sharedStopping||!selectedSharedSession()?.sendAvailable)return;
    const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration,sessionId=state.sharedSessionId,
      requestId=newSharedRequestId();state.sharedStopping=true;status('正在请求电脑停止…');
    try{const result=await call('shared.stop',{sessionId,requestId});if(!sharedViewCurrent(owner,epoch,generation,sessionId))return;
      if(result?.source!=='host'||result.sessionId!==sessionId||result.requestId!==requestId)throw new Error('COMMAND_RECEIPT_INVALID');
      status(result.state==='accepted'?'电脑已受理停止请求，等待回合状态':
        result.state==='uncertain'?'停止结果待核对，请查看电脑会话':safeError(new Error(result.errorCode||'OPERATION_FAILED')),
        result.state==='rejected')}
    catch(e){if(sharedViewCurrent(owner,epoch,generation,sessionId))status(e?.message==='TIMEOUT'?'停止结果待核对，请查看电脑会话':safeError(e),e?.message!=='TIMEOUT')}
    finally{state.sharedStopping=false;if(sharedViewCurrent(owner,epoch,generation,sessionId))scheduleSharedPoll()}return}
  try{await call('chat.stop');status('已请求停止，等待本轮状态')}catch(e){status(safeError(e),true)}}
function processEvent(message){const {event,data}=message;if(event==='chat.started'){
    invalidateLiveProgress();
    if(activeSend)acceptSend(activeSend,data.conversationId,data.turnId);
    state.busy=true;state.phase='waiting';state.progressText='';updateComposer();
    if(state.chatSource==='phone'&&state.conversationId===data.conversationId)status('手机模型正在回复…');
    if(state.page==='chat'&&state.chatSource==='phone')renderConversation()}
  if(event==='attachment.result')finishAttachmentPick(data);
  if(event==='sync.finished'&&Number.isSafeInteger(data?.uploaded)&&data.uploaded>0&&
      state.loggedIn&&!state.transitionPending&&state.page==='chat'&&state.chatSource==='phone'&&
      data.conversationId===state.conversationId&&!state.handoffPickerOpen.has(state.conversationId))
    void renderConversation({silent:true});
  if(event==='account.transition'){
    if(data.pending){resetToolApprovals();resetToolQuestions();conversationTasks.entries.clear();conversationTasks.inFlight=null;state.taskReturn=null;state.chatRestore=null}
    if(data.pending){closeImagePreview({restoreFocus:false});invalidateLiveProgress();stopSharedPoll();clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;state.handoffViews.clear();state.linkedEvents.clear();state.handoffModelNames.clear();state.handoffPickerOpen.clear();state.handoffSelections.clear();state.accountModelCredentialConflict=null;state.handoffModelLastCheck=0;state.linkedPending=null;state.sharedGeneration++;state.chatSource='phone';state.thingsDetail=null;state.taskControlAttempt=null;state.taskControlDrafts.clear();state.restorePending=false;state.sharedSessionId=null;state.sharedLoading=false;
      state.sharedSessions=[];state.sharedEvents=[];state.sharedPending=null;state.sharedOutboxLoading=false;state.sharedAwaiting=null;state.sharedChecking=null;state.sharedHostAvailable=false;
      state.conversations=[];state.artifactSaveRequest=null;state.artifactSaveLabel=null;renderConversationList();clear($('chat-content'));
      activeSend=null;state.sendUncertain=false;state.authEpoch++;state.transitionPending=true;state.busy=false;state.models=[];closeModelMenu();closeAttachmentMenu();cancelAttachmentPick();resetMemoryForAuthBoundary('正在切换账户，已清除上一个账户的记忆显示。');
      state.progressText='';state.phase='idle';
      status('正在切换账户并停止原回合…');renderAttachmentDrafts()}
    else{state.transitionPending=!!data.oldTurnPending;if(state.transitionPending)status('等待原回合安全结束…')}
    updateComposer();
  }
  if(event==='account.retired'){invalidateLiveProgress();state.transitionPending=false;state.busy=false;updateComposer();
    if(state.page==='chat')renderConversation();}
  if(event==='chat.delegated'&&data?.conversationId===state.conversationId&&state.chatSource==='phone'){
    state.busy=false;invalidateLiveProgress();state.phase='idle';
    status(data.state==='accepted'?'电脑已受理，正在等待真实回复':'电脑送达待核对，原请求编号已保留');
    void listConversations();void listSharedSessions();void refreshHandoff(data.conversationId);
    updateComposer();return}
  if(event==='chat.phase'&&data.conversationId===state.conversationId){state.phase=data.phase;scheduleLiveProgress()}
  if(event==='chat.progress'&&data.conversationId===state.conversationId){state.progressText=data.text||'';state.phase='answering';scheduleLiveProgress()}
  if(event==='chat.finished'){if(activeSend)acceptSend(activeSend,data.conversationId,data.turnId);
    invalidateLiveProgress();
    const current=state.chatSource==='phone'&&data.conversationId===state.conversationId;
    state.lastTerminal={conversationId:data.conversationId,turnId:data.turnId,status:data.status};
    if(current&&data.errorCode==='CONVERSATION_ROUTING_UNCONFIRMED'&&
      typeof data.retryText==='string'&&!$('draft').value.trim())$('draft').value=data.retryText;
    state.busy=false;state.phase='idle';state.progressText='';updateComposer();if(current){
      if(data.status==='completed')status('回复已保存');
      else if(data.status==='cancelled')status('本轮已停止');
      else{const message=data.errorCode==='CONVERSATION_ROUTING_UNCONFIRMED'
        ? '原目标已保存在手机，执行位置待核对；草稿已保留，重新发送会成为新消息。'
        : `回复未完成 · ${turnFailure(data.turnErrorCode||data.errorCode,data.upstreamHttpStatus)}`;status(message,true)}
      if(state.page==='chat')renderConversation();
      if(data.status==='failed'||data.status==='cancelled')refreshAttachmentDrafts()}listConversations()}
  if(event==='tool.receipt'){status(`${toolLabel(data.toolName)} · ${receiptStatus(data.status)}`);if(state.page==='chat')renderConversation()}
  if(event==='shared.outbox.reconciled'&&state.chatSource==='host'){void loadSharedOutbox();void loadSharedHistory()}
  if(event==='attachment.save'){
    if(data?.status==='saved')toast('文件已保存');
    else if(data?.status==='failed')toast(safeError({message:data.code||'OPERATION_FAILED'}),true)}
  if(event==='profile.photo'){
    if(data.status==='saved'){state.profile=data.profile;showProfile(data.profile);
      toast(data.profile?.localCacheSaved===false?'头像已在电脑保存，本机离线副本未保存':'头像已保存');
      if(state.page==='account')page('account')}
    else if(data.status==='failed')toast(safeError(new Error(data.code||'PHOTO_UNREADABLE')),true);
  }
  if(event==='artifact.save'&&state.artifactSaveRequest===data?.requestId){
    state.artifactSaveRequest=null;
    if(data.status==='saved')toast('文件已保存到手机，并已核对内容');
    else if(data.status==='cancelled')toast('已取消保存');
    else toast(safeError(new Error(data.code||'ARTIFACT_SAVE_FAILED')),true);
    const label=state.artifactSaveLabel;state.artifactSaveLabel=null;if(label)label.textContent=data.status==='saved'?'已保存到手机并核对内容':
      data.status==='cancelled'?'已取消保存':'保存未完成，请重试';
  }
  if(event==='notifications.permission'&&state.page==='notifications')page('notifications');
  if(event==='theme.system'&&state.appearance==='system'){
    document.documentElement.dataset.theme=data.dark?'dark':'light';document.documentElement.style.colorScheme=data.dark?'dark':'light';
  }
  if(event==='navigation.conversation'&&data.conversationId)selectConversation(data.conversationId);
  if(event==='notification.otherAccount')toast('这条提醒属于另一账户，请切回对应账户查看');
  if(event==='update.staged')toast('新界面已准备好，可在设置中应用');
  if(event==='update.applied')toast('新界面已应用，正在重新打开');
  if(event==='voice.result'){
    if(data.outcome==='text'&&state.page==='chat'&&state.generation===data.viewGeneration&&
      (state.chatSource==='host'?'':state.conversationId||'')===data.conversationId&&
      !(state.chatSource==='host'?state.sharedRunning:state.busy)){
      const draft=$('draft');draft.value=draft.value.trim()?`${draft.value.trimEnd()} ${data.text}`:data.text;
      updateComposer();draft.focus();status('语音文字已填入草稿，请确认后发送');
    }else if(data.outcome==='cancelled')status('已取消语音输入');
    else if(data.outcome==='empty')status('没有识别到文字');
    else if(data.outcome==='stale')toast('较早的语音结果未写入当前对话');
  }
}
async function restoreSharedSelection(sessionId,owner,epoch){await listSharedSessions();
  if(!state.restorePending||state.owner!==owner||state.authEpoch!==epoch||state.page!=='chat')return;
  state.restorePending=false;
  if(state.sharedHostAvailable&&state.sharedSessions.some(item=>item.sessionId===sessionId)){
    selectSharedSession(sessionId);return}
  if(state.sharedHostAvailable)try{localStorage.removeItem(chatSourceKey())}catch{}
  loadDraft();updateComposer();if(state.conversationId)await renderConversation();else showWelcome()}
async function boot(){
  if(!window.weftNative){status('当前网页环境没有原生能力，请在 WeftMate 应用中打开',true);return}
  window.weftNative.onmessage=event=>{let message;try{message=JSON.parse(event.data)}catch{return}
    if(message.id&&pending.has(message.id)){const task=pending.get(message.id);pending.delete(message.id);clearTimeout(task.timer);message.ok?task.resolve(message.result):task.reject(new Error(message.error?.code||'OPERATION_FAILED'))}
    else if(message.event)processEvent(message)};
  try{await call('events.subscribe');const info=await call('app.bootstrap');
    state.loggedIn=info.loggedIn;state.username=info.username;state.owner=info.owner;state.deviceId=info.deviceId||'';state.model=info.model;
    state.busy=info.busy;state.ui=info.ui;state.backgroundSync=info.backgroundSync||'unknown';
    state.connection=info.loggedIn?'checking':'local';
    showProfile({displayName:info.username||'本机个人空间'});
    // Restore the selected phone/new or host session before updateComposer can persist the
    // initially empty textarea. Otherwise a restart deletes the saved `owner:new` draft.
    $('model-label').textContent=info.model?.displayName||'选择模型';await listConversations();
    try{state.conversationId=info.launchConversationId||localStorage.getItem(selectionKey())||state.conversations[0]?.id||null}
    catch{state.conversationId=info.launchConversationId||state.conversations[0]?.id||null}
    if(!state.conversations.some(item=>item.id===state.conversationId))state.conversationId=null;
    const previousHost=info.launchConversationId?null:savedSharedSelection();
    if(info.launchConversationId)try{localStorage.removeItem(chatSourceKey())}catch{}
    if(previousHost){state.restorePending=true;$('draft').value='';updateComposer();
      const content=$('chat-content');clear(content);content.append(notice('正在核对上次电脑会话…'));
      void restoreSharedSelection(previousHost,state.owner,state.authEpoch)}
    else{loadDraft();if(state.conversationId){await renderConversation();void refreshHandoff(state.conversationId)}else showWelcome();void listSharedSessions()}
    try{applyTheme((await call('settings.appearance')).value)}catch{applyTheme('system')}
    await call('app.ready',{owner:state.owner||'',hasDraft:hasAnyDraft()});state.booted=true;
    if(info.notificationOtherAccount)toast('这条提醒属于另一账户，请切回对应账户查看');
    {const owner=state.owner,authEpoch=state.authEpoch;
      call('auth.me').then(profile=>{if(state.authEpoch!==authEpoch||state.owner!==owner)return;
        state.profile=profile;state.connection=profile.connectionVerified?'connected':'offline';
      if(!state.loggedIn)state.connection='local';showProfile(profile);
      if(state.page==='chat'&&state.chatSource==='phone'&&!state.restorePending&&!state.conversationId)showWelcome()}).catch(error=>{if(state.authEpoch!==authEpoch||state.owner!==owner)return;
        state.connection=state.loggedIn?(error.message==='UNAUTHORIZED'||error.message==='AUTH_REQUIRED'?'expired':'offline'):'local';
        if(state.page==='chat'&&state.chatSource==='phone'&&!state.restorePending&&!state.conversationId)showWelcome()});}
  }catch(e){status(safeError(e),true);reportBootFailure()}
}
function reportBootFailure(){if(state.booted)return;try{window.weftNative?.postMessage(JSON.stringify({
  id:`fail${++sequence}`,method:'app.failed',params:{}}))}catch{}}
window.addEventListener('error',reportBootFailure);
window.addEventListener('unhandledrejection',reportBootFailure);

async function openModels(){
  if(state.busy)return;
  if(state.menu){closeModelMenu();return}
  closeAttachmentMenu();
  state.menu=true;state.directoryError=false;$('model-popover').hidden=false;$('model-button').setAttribute('aria-expanded','true');
  placeModelMenu();
  const list=$('model-options');clear(list);list.append(el('p','muted','正在读取已保存模型…'));
  try{const result=await call('models.list');if(!state.menu)return;state.models=result.models||[];renderModels();
    if(result.selected?.source==='phone'){try{const found=await call('models.discover');if(!state.menu)return;
      const ids=new Set(state.models.map(v=>`${v.endpoint}|${v.modelId}`));for(const item of found.models||[]){const key=`${result.selected.endpoint}|${item.id}`;
        if(!ids.has(key)){state.models.push({source:'phone',endpoint:result.selected.endpoint,modelId:item.id,displayName:item.displayName,selected:false,discovered:true});ids.add(key)}
        else{const saved=state.models.find(v=>`${v.endpoint}|${v.modelId}`===key);saved.displayName=item.displayName||saved.displayName;saved.discovered=true}}
      renderModels();}catch{if(state.menu){state.directoryError=true;renderModels()}}}
    if(state.loggedIn){try{const host=await call('models.host');if(!state.menu)return;
      state.models.push(...(host.models||[]).filter(item=>item.configured));renderModels()}
      catch{if(state.menu)list.append(el('p','muted','电脑模型暂不可用'))}}
  }catch(e){list.replaceChildren(el('p','muted',safeError(e)))}
}
function renderModels(){const list=$('model-options');clear(list);if(!state.models.length)list.append(el('p','muted','先在设置中配置一个手机模型'));
  for(const item of state.models){const button=el('button',item.selected?'selected':'');const title=el('span','',item.displayName||item.modelId||item.profileId);
    const left=el('span','model-option-main');left.append(title);
    const subtitle=item.source==='host'?`电脑 · ${item.sourceKind==='local'?'本机模型':'云模型'}`:
      (item.displayName&&item.displayName!==item.modelId?item.modelId:'');
    if(subtitle)left.append(el('small','',subtitle));button.append(left);
    if(item.selected)button.append(el('span','icon icon-check'));
    button.setAttribute('aria-label',`${item.displayName||item.modelId||item.profileId}${item.selected?'，已选择':''}`);
    button.addEventListener('click',async()=>{closeModelMenu();state.modelSwitching=true;updateComposer();
      status(item.source==='host'?'正在核对电脑模型…':'正在保存模型选择…');
      try{const method=item.source==='host'?'models.selectHost':item.discovered?'models.chooseDiscovered':'models.select';
      const selected=await call(method,item.source==='host'?{profileId:item.profileId}:item.discovered?{modelId:item.modelId}:{endpoint:item.endpoint,modelId:item.modelId});
      state.model=selected;$('model-label').textContent=selected.displayName||selected.modelId;status(`已选择 ${selected.displayName||selected.modelId}`)}
      catch(e){status(safeError(e),true)}finally{state.modelSwitching=false;updateComposer()}});
    list.append(button)}
  if(state.directoryError){const note=el('button','hint','当前目录暂不可用 · 点此重试');note.addEventListener('click',()=>{closeModelMenu();openModels()});list.append(note)}
  const manage=el('button','hint','管理手机与账户模型');manage.addEventListener('click',()=>{
    closeModelMenu();page('models')});list.append(manage)
}
function renderPage(name){const target=$('page-content');clear(target);switch(name){
  case 'things':return thingsPage(target);
  case 'memory':return memoryPage(target);
  case 'capabilities':return capabilitiesPage(target);
  case 'devices':return devicesPage(target);
  case 'workspaces':return workspacesPage(target);
  case 'notifications':return notificationPage(target);
  case 'account':return accountPage(target);
  case 'password':return passwordPage(target);
  case 'connect':return connectPage(target);
  case 'models':return modelsPage(target);
  case 'sync':return syncPage(target);
  case 'appearance':return appearancePage(target);
  case 'updates':return updatesPage(target);
  default:return settingsPage(target);
}}
function subNotice(title,text){const target=$('page-content');clear(target);target.append(heading(title),notice(text,'尚未接入'))}
function connectionLabel(){return {connected:'电脑连接正常',checking:'已保存登录，待核对',offline:'电脑暂不可达，可离线使用',
  expired:'登录已失效，请重新登录',local:'未登录'}[state.connection]||'连接状态待确认'}
function settingsPage(target){target.append(heading('设置'),group('个人空间',[
  row('我的资料',state.loggedIn?`${state.username} · ${connectionLabel()}`:'未登录',()=>page('account')),
  row('电脑账户与连接',state.loggedIn?connectionLabel():'可以登录或注册',()=>page('connect')),
  row('设备',state.loggedIn?'查看或移除已登录设备':'登录后可管理设备',()=>page('devices'))]),
  group('使用偏好',[row('对话模型',state.model?.displayName||'尚未配置手机模型',()=>page('models')),
    row('外观','跟随系统、浅色或深色',()=>page('appearance')),
    row('通知','回复、动作和同步状态',()=>page('notifications')),
    row('离线与同步',state.loggedIn?'当前账户的记录与状态':'登录后查看本机与同步状态',()=>page('sync'))]),
  group('应用',[row('界面更新',state.ui?.activeVersion||'内置页面',()=>page('updates')),
    row('原生兼容界面','仅供排查当前系统网页组件',()=>call('compat.openNative').catch(e=>toast(safeError(e),true)))]));
}
const MEMORY_KINDS={cognition:'理解',entity:'人物与对象',relationship:'关系',event:'共同经历'};
function emptyMemoryState(scope=''){return {scope,flow:0,view:'list',target:null,kind:'cognition',query:'',queryDraft:'',
  statusState:'idle',reasonCode:'',capabilities:{list:false,source:false,inject:null},pendingBoundaryCount:null,blockedBoundaryCount:null,discardedBoundaryCount:null,lastFailureCode:'',
  statusWorldRevision:null,worldRevision:null,detailRevision:null,refreshOnReturn:false,boundOwnerId:null,boundScope:'',
  items:[],nextCursor:null,hasMore:false,loading:false,error:'',selectedItem:null,detail:null,sources:[],
  detailLoading:false,sourcesLoading:false,detailError:'',sourceError:'',confirmation:null,correctionDraft:'',
  activeOperation:null,pendingMarker:null,checkingReceipt:false,receiptMessage:'',receiptRequestId:'',receiptItemId:null,reopenAfterRefresh:null}}
function resetMemoryForAuthBoundary(message='账户状态已变化，记忆显示已清除。'){
  const scope=state.owner||'';state.memory=emptyMemoryState(scope);
  if(state.page==='memory'){const target=$('page-content');clear(target);target.append(heading('记忆'),notice(message,'账户状态'));
    target.append(action('返回账户连接',()=>page('connect'),false))}
}
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
  return safeError(error)}
function memoryFail(token,error,target=state.memory?.target,{keepItems=false}={}){
  if(!memoryCurrent(token))return;
  const memory=state.memory;memory.loading=false;memory.statusState='error';memory.error=memoryFailureText(error);
  memory.boundOwnerId=null;memory.boundScope='';memory.worldRevision=null;memory.nextCursor=null;memory.hasMore=false;
  if(!keepItems){memory.items=[];memory.selectedItem=null;memory.detail=null;memory.sources=[];memory.view='list'}
  if(target)renderMemoryList(target)}
function memoryOwnerMatches(value,memory=state.memory){return !!value&&typeof value.ownerId==='string'&&value.ownerId.length>0&&
  !!memory?.boundOwnerId&&value.ownerId===memory.boundOwnerId&&memory.boundScope===memory.scope}
function memoryRevisionMatches(value,memory=state.memory){return Number.isSafeInteger(value?.worldRevision)&&value.worldRevision===memory?.worldRevision}
function memoryPathEncode(value){return encodeURIComponent(value).replace(/%3A/gi,':').replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}
function memoryItemsPath(kind,query,after){try{const params=[`kind=${memoryPathEncode(kind)}`,'limit=20'];
    if(query)params.push(`query=${memoryPathEncode(query)}`);if(after)params.push(`after=${memoryPathEncode(after)}`);
    const path=`/personal/v1/memory/items?${params.join('&')}`;return path.length<=512?path:null}catch{return null}}
function memoryListAllowed(memory=state.memory){return !!memory?.boundOwnerId&&memory.boundScope===memory.scope&&memory.capabilities.list===true&&
  ['ready','degraded'].includes(memory.statusState)}
function memoryStatusText(memory=state.memory){if(state.transitionPending)return '正在切换账户；旧账户的记忆已清除。';
  if(!state.loggedIn||!state.owner)return '请先连接个人账户，才能查看该账户的记忆。';
  if(memory?.loading)return memory.boundOwnerId?'正在读取当前账户的记忆列表…':'正在核对账户并读取记忆状态…';
  if(memory?.error)return memory.error;
  if(memory?.statusState==='disabled')return '当前账户尚未启用记忆服务。';
  if(memory?.statusState==='unavailable')return '当前账户的记忆服务暂不可用。';
  if(memory?.statusState==='degraded'&&memory.capabilities.inject===false)return '记忆可查看；当前模型记忆注入不可用。';
  if(memory?.statusState==='degraded')return '记忆服务部分可用；请留意服务端提供的状态说明。';
  if(memory?.statusState==='ready')return '显示当前账户的记忆快照；可用操作以当前服务能力与单条记忆状态为准。';
  if(memory?.statusState==='error')return memory.error||'记忆读取失败，请重试。';
  return '记忆状态尚未读取。'}
function memoryLifecycle(item){const lifecycle=item?.lifecycle&&typeof item.lifecycle==='object'?item.lifecycle:{};const values=[];
  if(lifecycle.invalidAt)values.push(`已失效 · ${timeLabel(lifecycle.invalidAt)}`);
  if(lifecycle.archivedAt)values.push(`已归档 · ${timeLabel(lifecycle.archivedAt)}`);
  if(lifecycle.mutedAt)values.push(`已停用 · ${timeLabel(lifecycle.mutedAt)}`);
  if(!values.length)values.push(item?.currentState==='current'?'当前有效':'非当前；服务未提供具体生命周期原因');return values}
function memoryRelationLabel(value){return ({support:'支持该理解',supports:'支持该理解',alias:'别名来源',corrects:'用于修正',retracts:'撤回'}[value]||'来源关系未分类')}
function memoryCurrentnessLabel(value){return ({current:'当前来源',not_current:'来源不再支持当前理解',evidence_deleted:'来源已删除',
  evidence_local_read_denied:'来源未允许本机模型读取',evidence_cloud_read_denied:'来源未允许云端模型读取',
  evidence_not_model_readable:'来源当前不可供模型读取',evidence_missing:'来源记录未找到',evidence_subject_mismatch:'来源账户不匹配'}[value]||'来源状态未说明')}
function renderMemoryList(target=state.memory?.target){if(!target||state.page!=='memory')return;const memory=state.memory;clear(target);
  target.append(heading('记忆','查看当前账户的理解与来源；可用时在详情中纠正、停用或删除。手机对话的自动记忆接入仍待验证。'));
  target.append(notice(memoryStatusText(),memory.error?'读取状态':''));
  renderMemoryReceipt(target);
  if(!state.loggedIn||!state.owner){target.append(action('连接个人账户',()=>page('connect')));return}
  if(state.transitionPending){target.append(action('返回账户连接',()=>page('connect'),false));return}
  if(!memoryListAllowed(memory)){target.append(action(memory.error?'重新读取':'刷新记忆状态',()=>startMemorySnapshot(target,memory.kind,memory.query),false));return}
  const select=el('select');select.setAttribute('aria-label','记忆类别');
  for(const [kind,label] of Object.entries(MEMORY_KINDS)){const option=el('option','',label);option.value=kind;option.selected=memory.kind===kind;select.append(option)}
  select.value=memory.kind;select.disabled=memory.loading;
  select.addEventListener('change',()=>{const kind=select.value;if(!Object.hasOwn(MEMORY_KINDS,kind))return;
    startMemorySnapshot(target,kind,memory.queryDraft.trim())});
  const search=field('在当前类别的全部账户记忆中搜索','search',memory.queryDraft);search.input.maxLength=120;
  search.input.setAttribute('aria-label','搜索当前类别的全部账户记忆');search.input.disabled=memory.loading;
  search.input.addEventListener('input',()=>{memory.queryDraft=search.input.value});
  const category=el('label','field');category.append(el('span','','记忆类别'),select);
  const form=el('form');form.append(search.box,category);
  form.addEventListener('submit',event=>{event.preventDefault();memory.queryDraft=search.input.value;
    const query=search.input.value.trim();if([...query].length>120){memory.error='搜索内容最多120个字符，请缩短后重试。';renderMemoryList(target);return}
    startMemorySnapshot(target,memory.kind,query)});
  const actions=el('div','form-actions');const submit=action('搜索',()=>{},true);submit.type='submit';
  const refresh=action(memory.loading?'正在刷新…':'刷新',()=>startMemorySnapshot(target,memory.kind,memory.query),false);refresh.type='button';refresh.disabled=memory.loading;
  actions.append(submit,refresh);form.append(actions);target.append(form);
  if(memory.pendingBoundaryCount>0)target.append(notice(`有 ${memory.pendingBoundaryCount} 条来源尚未处理${memory.blockedBoundaryCount>0?`，其中 ${memory.blockedBoundaryCount} 条已暂停自动处理`:''}。本手机页面不会重试或管理待处理来源。`,'来源待处理'));
  if(memory.lastFailureCode==='MEMORY_SOURCE_DELETED'&&memory.discardedBoundaryCount>0)
    target.append(notice(`${memory.discardedBoundaryCount} 条来源已删除；这不表示仍有待处理来源。`,'来源状态'));
  else if(memory.lastFailureCode&&memory.lastFailureCode!=='MEMORY_SOURCE_DELETED')
    target.append(notice('最近来源处理状态需要在电脑端查看；本手机页面不会重试或管理待处理来源。','来源状态'));
  if(memory.loading&&memory.items.length)target.append(notice('正在读取同一记忆快照的下一页…'));
  if(!memory.items.length){if(memory.loading)target.append(el('p','muted','正在读取完整的账户记忆快照…'));
    else if(!memory.error&&memory.statusState!=='error'){
      target.append(el('p','muted',memory.query?'没有匹配的记忆。试试缩短关键词或更换类别。':
        memory.pendingBoundaryCount?'当前还没有已形成的记忆。':'当前账户还没有可显示的记忆。'));
    }}
  else target.append(group('记忆列表',memory.items.map(item=>row(`${item.truncated===true?'记忆片段 · ':''}${item.text}`,`${memoryLifecycle(item).join(' · ')} · 来源 ${item.sourceCount}`,
    ()=>openMemoryDetail(target,item)))));
  if(memory.hasMore){const more=action(memory.loading?'正在读取…':'加载更多',()=>loadMemoryMore(target),false);more.disabled=memory.loading;target.append(more)}
}
function memoryPage(target){const scope=state.owner||'';if(!state.memory||state.memory.scope!==scope)state.memory=emptyMemoryState(scope);
  const memory=state.memory;memory.target=target;memory.view='list';memory.flow++;
  memory.pendingMarker=savedMemoryMarker();
  if(!state.loggedIn||!scope||state.transitionPending){renderMemoryList(target);return}
  startMemorySnapshot(target,memory.kind,memory.query);
  if(memory.pendingMarker)void reconcileMemoryMarker(memory.pendingMarker)}
function startMemorySnapshot(target,kind,query){if(!Object.hasOwn(MEMORY_KINDS,kind)){return}
  if(typeof query!=='string'||[...query].length>120){const memory=state.memory;memory.error='搜索内容最多120个字符，请缩短后重试。';memory.loading=false;renderMemoryList(target);return}
  if(state.memory.scope!==(state.owner||''))state.memory=emptyMemoryState(state.owner||'');
  const memory=state.memory;memory.flow++;memory.target=target;memory.view='list';memory.kind=kind;memory.query=query;
  memory.queryDraft=query;memory.statusState='loading';memory.reasonCode='';memory.capabilities={list:false,source:false};
  memory.statusWorldRevision=null;memory.worldRevision=null;memory.detailRevision=null;memory.refreshOnReturn=false;
  memory.boundOwnerId=null;memory.boundScope='';memory.items=[];memory.nextCursor=null;memory.hasMore=false;
  memory.selectedItem=null;memory.detail=null;memory.sources=[];memory.detailLoading=false;memory.sourcesLoading=false;
  memory.detailError='';memory.sourceError='';memory.error='';memory.loading=true;renderMemoryList(target);
  const token=memoryToken();void loadMemorySnapshot(target,token)}
async function loadMemorySnapshot(target,token){try{
    const profile=await call('auth.me');if(!memoryCurrent(token))return;
    if(profile?.connectionVerified!==true||typeof profile.owner!=='string'||profile.owner!==token.scope){
      memoryFail(token,new Error(profile?.connectionVerified===false?'MEMORY_CONNECTION_UNVERIFIED':'MEMORY_OWNER_MISMATCH'),target);return}
    const statusResult=await call('host.business',{path:'/personal/v1/memory/status',method:'GET'});
    if(!memoryCurrent(token))return;
    const canList=statusResult&&['ready','degraded'].includes(statusResult.state)&&statusResult.capabilities?.list===true;
    if(typeof statusResult?.ownerId!=='string'||!statusResult.ownerId||!Object.hasOwn(statusResult,'worldRevision')||
      !(statusResult.worldRevision===null||Number.isSafeInteger(statusResult.worldRevision))||
      (canList&&!Number.isSafeInteger(statusResult.worldRevision))||
      !['ready','degraded','disabled','unavailable'].includes(statusResult.state)||!statusResult.capabilities||typeof statusResult.capabilities!=='object'){
      throw new Error('MEMORY_INVALID_RESPONSE')}
  const memory=state.memory;memory.boundOwnerId=statusResult.ownerId;memory.boundScope=token.scope;
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
    if(!memoryListAllowed(memory)){renderMemoryList(target);return}
    memory.loading=true;renderMemoryList(target);await loadMemoryItems(target,token,null,false);
  }catch(error){if(!memoryCurrent(token))return;memoryFail(token,error,target)}}
async function loadMemoryItems(target,token,after,append){if(!memoryCurrent(token))return;
  const memory=state.memory;const path=memoryItemsPath(memory.kind,memory.query,after);
  if(!path){memory.loading=false;memory.error=memoryFailureText(new Error('MEMORY_PATH_TOO_LONG'));
    if(!append){memory.items=[];memory.hasMore=false;memory.nextCursor=null}renderMemoryList(target);return}
  memory.loading=true;memory.error='';renderMemoryList(target);
  try{const result=await call('host.business',{path,method:'GET'});if(!memoryCurrent(token))return;
    if(!memoryOwnerMatches(result,memory))throw new Error('MEMORY_OWNER_MISMATCH');
    if(!Number.isSafeInteger(result.worldRevision))throw new Error('MEMORY_INVALID_RESPONSE');
    if(append&&!memoryRevisionMatches(result,memory))throw new Error('MEMORY_REVISION_CHANGED');
    if(result.searchScope!=='account_snapshot'||!Array.isArray(result.items)||result.items.length>20||typeof result.hasMore!=='boolean'||
      result.items.some(item=>!item||typeof item.id!=='string'||!item.id||item.kind!==memory.kind||typeof item.text!=='string'||
        !Number.isSafeInteger(item.sourceCount)||item.sourceCount<0))
      throw new Error('MEMORY_INVALID_RESPONSE');
    if(result.hasMore&&(typeof result.nextCursor!=='string'||!result.nextCursor))throw new Error('MEMORY_INVALID_RESPONSE');
    if(!append)memory.worldRevision=result.worldRevision;
    const prior=append?memory.items:[];const seen=new Set(prior.map(item=>item.id));
    memory.items=[...prior,...result.items.filter(item=>!seen.has(item.id))];memory.nextCursor=result.hasMore?result.nextCursor:null;
    memory.hasMore=result.hasMore;memory.loading=false;memory.error='';renderMemoryList(target);
    if(!append&&memory.reopenAfterRefresh){const {kind,id}=memory.reopenAfterRefresh;
      memory.reopenAfterRefresh=null;const item=memory.items.find(value=>value.kind===kind&&value.id===id);
      if(item)openMemoryDetail(target,item)}
  }catch(error){if(!memoryCurrent(token))return;memoryFail(token,error,target)}}
function loadMemoryMore(target){const memory=state.memory;if(!memory.hasMore||!memory.nextCursor||memory.loading||!memoryListAllowed(memory))return;
  memory.flow++;const token=memoryToken();void loadMemoryItems(target,token,memory.nextCursor,true)}
function memoryPathIdSupported(id){return typeof id==='string'&&id!=='.'&&id!=='..'&&/^[A-Za-z0-9._:-]{1,512}$/.test(id)}
function memoryMarkerKey(){return state.owner?`weftmate-mobile-memory-request:${state.owner}`:null}
function savedMemoryMarker(){const key=memoryMarkerKey();if(!key)return null;
  try{const marker=JSON.parse(localStorage.getItem(key)||'null');return marker&&
    /^[A-Za-z0-9_.:-]{1,128}$/.test(marker.requestId)&&
    ['correct','mute','deleteItem','deleteEvidence'].includes(marker.operation)&&
    typeof marker.id==='string'&&memoryPathIdSupported(marker.id)?marker:null}catch{return null}}
function persistMemoryMarker(marker){const key=memoryMarkerKey();if(!key)return false;
  try{localStorage.setItem(key,JSON.stringify(marker));return true}catch{return false}}
function clearMemoryMarker(marker){const key=memoryMarkerKey();if(!key)return;
  try{if(savedMemoryMarker()?.requestId===marker.requestId)localStorage.removeItem(key)}catch{}}
function newMemoryRequestId(){return `memory-ui-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2,10)}`}
function memoryActionAllowed(operation,source=null){const memory=state.memory,global=memory?.capabilities,detail=memory?.detail;
  if(!memoryListAllowed(memory)||!detail||!Number.isSafeInteger(memory.detailRevision)||
    memory.detailRevision!==memory.worldRevision||memory.activeOperation||memory.pendingMarker||savedMemoryMarker())return false;
  if(operation==='deleteEvidence')return global.deleteEvidence===true&&source&&memoryPathIdSupported(source.evidenceId)&&
    !['evidence_deleted','evidence_missing','evidence_subject_mismatch'].includes(source.currentnessState);
  if(operation==='correct'&&detail.item?.kind==='entity')return false;
  const globalKey=operation==='deleteItem'?'deleteWorldItem':operation,
    detailKey=operation==='deleteItem'?'delete':operation;
  return global[globalKey]===true&&detail.availableActions?.[detailKey]?.available===true}
function renderMemoryReceipt(target){const memory=state.memory;if(!memory)return;
  const marker=memory.pendingMarker||savedMemoryMarker();
  if(marker){const box=notice(memory.receiptMessage||'上一条记忆操作结果待确认。原请求已保留，不会自动重复提交。','结果待核对');
    const check=action(memory.checkingReceipt?'正在核对…':'核对原请求',()=>reconcileMemoryMarker(marker),false);
    check.disabled=!!memory.checkingReceipt;box.append(el('p','memory-request-id',`请求编号：${marker.requestId}`),check);target.append(box)}
  else if(memory.receiptMessage&&(memory.view!=='detail'||memory.selectedItem?.id===memory.receiptItemId))
    target.append(notice(memory.receiptMessage,'操作结果'))}
function openMemoryDetail(target,item){if(!memoryListAllowed()||!item||!Object.hasOwn(MEMORY_KINDS,item.kind))return;
  const memory=state.memory;memory.flow++;memory.view='detail';memory.selectedItem=item;memory.detail=null;memory.sources=[];
  memory.detailLoading=false;memory.sourcesLoading=false;memory.detailError='';memory.sourceError='';memory.confirmation=null;
  if(memory.receiptItemId&&memory.receiptItemId!==item.id&&!memory.pendingMarker){
    memory.receiptMessage='';memory.receiptRequestId='';memory.receiptItemId=null}
  const token=memoryToken();renderMemoryDetail(target,token);
  if(!memoryPathIdSupported(item.id)){memory.detailError='当前手机版无法打开这条来源；记忆仍保留在列表中。';renderMemoryDetail(target,token);return}
  if(memory.capabilities.source)void loadMemoryDetail(target,token,item);else{
    memory.detailError='当前手机版暂不能读取此项的详情与来源。';renderMemoryDetail(target,token)}}
function renderMemoryDetail(target=state.memory?.target,token=memoryToken()){if(!target||!memoryCurrent(token)||state.memory.view!=='detail')return;
  const memory=state.memory;const selected=memory.detail?.item||memory.selectedItem;clear(target);
  target.append(heading(MEMORY_KINDS[selected?.kind]||'记忆详情'),action('返回记忆列表',()=>{
    if(!memoryCurrent(token))return;if(memory.refreshOnReturn){const kind=memory.kind,query=memory.query;startMemorySnapshot(target,kind,query);return}
    memory.flow++;memory.view='list';renderMemoryList(target)},false));
  renderMemoryReceipt(target);
  if(selected){const body=typeof selected.text==='string'?selected.text:'该条记忆没有可显示的正文。';
    target.append(group('记忆内容',[...(selected.truncated===true?[el('p','muted','当前显示的是记忆片段。')]:[]),el('p','',body),...memoryLifecycle(selected).map(label=>el('p','muted',label)),
      el('p','muted',`${Number.isSafeInteger(selected.sourceCount)?selected.sourceCount:0} 条来源 · ${selected.createdAt?timeLabel(selected.createdAt):'创建时间未提供'}`)]))}
  if(memory.detailLoading)target.append(notice('正在读取记忆详情…'));
  if(memory.detailError)target.append(el('p','inline-error',memory.detailError));
  if(memory.sourcesLoading)target.append(notice('正在读取来源…'));
  if(memory.sourceError)target.append(el('p','inline-error',memory.sourceError));
  if(!memory.sourcesLoading&&!memory.sourceError&&memory.sources.length){const sourceGroup=group('来源与读取状态',[]);const box=sourceGroup.querySelector('.group-body');
    for(const source of memory.sources){const entry=el('div','');const relation=typeof source.relation==='string'?source.relation:'来源';
      entry.append(el('strong','',`${memoryRelationLabel(relation)} · ${memoryCurrentnessLabel(source.currentnessState)}`));
      if(typeof source.recordedAt==='string')entry.append(el('p','muted',`记录于 ${timeLabel(source.recordedAt)}`));
      const permissions=source.permissions&&typeof source.permissions==='object'?source.permissions:{};
      entry.append(el('p','muted',`记忆内容的模型目的地：本机模型${permissions.allowLocalRead===true?'允许':'未允许'} · 云端模型${permissions.allowCloudRead===true?'允许':'未允许'} · 记忆推理${permissions.allowInference===true?'允许':'未允许'}`));
      entry.append(el('p','muted','这些权限只描述记忆内容的模型读取用途，不代表设备操作或删除权限。'));
      if(source.summary!==null&&typeof source.summary==='string')entry.append(el('p','muted',`摘要：${source.summary}`));
      if(source.contentAvailable===true&&typeof source.rawContent==='string'){
        if(source.rawContentTruncated===true)entry.append(el('p','muted','以下原文已由服务端截断。'));
        entry.append(el('p','',source.rawContent));
      }else if(source.contentAvailable===false)entry.append(el('p','muted','此来源正文当前不可读取。'));
      else if(source.summary===null||typeof source.summary!=='string')entry.append(el('p','muted','服务端没有提供可读取的正文或摘要。'));
      if(memoryActionAllowed('deleteEvidence',source))entry.append(action('删除这条来源',()=>{
        openMemoryConfirmation({operation:'deleteEvidence',id:source.evidenceId,
          summary:source.summary||'这条来源',confirmText:''},target,token)},false));
      box.append(entry)}target.append(sourceGroup)}
  else if(!memory.sourcesLoading&&!memory.sourceError&&memory.detail&&!memory.sources.length)target.append(el('p','muted','服务端没有返回来源记录。'));
  renderMemoryActions(target,token)}
async function loadMemoryDetail(target,token,item){if(!memoryCurrent(token))return;const memory=state.memory;
  memory.detailLoading=true;memory.sourcesLoading=true;renderMemoryDetail(target,token);
  const base=`/personal/v1/memory/items/${memoryPathEncode(item.kind)}/${memoryPathEncode(item.id)}`;
  if(`${base}/sources`.length>512){if(!memoryCurrent(token))return;memory.detailLoading=false;memory.sourcesLoading=false;
    memory.detailError='当前手机版无法打开这条来源：路径超过接口长度限制。';renderMemoryDetail(target,token);return}
  try{const detail=await call('host.business',{path:base,method:'GET'});if(!memoryCurrent(token))return;
    if(!memoryOwnerMatches(detail,memory))throw new Error('MEMORY_OWNER_MISMATCH');
    if(!Number.isSafeInteger(detail.worldRevision))throw new Error('MEMORY_INVALID_RESPONSE');
    if(!detail.item||detail.item.id!==item.id||detail.item.kind!==item.kind||typeof detail.item.text!=='string'||
      !Number.isSafeInteger(detail.item.sourceCount)||detail.item.sourceCount<0)throw new Error('MEMORY_INVALID_RESPONSE');
    if(detail.worldRevision!==memory.worldRevision){memory.items=[];memory.nextCursor=null;memory.hasMore=false;memory.refreshOnReturn=true}
    memory.worldRevision=detail.worldRevision;memory.detailRevision=detail.worldRevision;
    memory.detail=detail;memory.detailLoading=false;renderMemoryDetail(target,token);
    const sourcePath=`${base}/sources`;const sources=await call('host.business',{path:sourcePath,method:'GET'});if(!memoryCurrent(token))return;
    if(!memoryOwnerMatches(sources,memory))throw new Error('MEMORY_OWNER_MISMATCH');
    if(sources.worldRevision!==memory.detailRevision)throw new Error('MEMORY_REVISION_CHANGED');
    if(!Array.isArray(sources.sources))throw new Error('MEMORY_INVALID_RESPONSE');
    memory.sources=sources.sources;memory.sourcesLoading=false;memory.sourceError='';renderMemoryDetail(target,token);
  }catch(error){if(!memoryCurrent(token))return;memoryFail(token,error,target)}}
function openMemoryConfirmation(choice,target,token){if(!memoryCurrent(token)||state.memory.view!=='detail')return;
  state.memory.confirmation=choice;renderMemoryDetail(target,token);
  requestAnimationFrame(()=>{if(memoryCurrent(token)&&state.memory.confirmation===choice)
    target.querySelector('.memory-confirm-panel')?.scrollIntoView?.({
      behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})})}
function renderMemoryActions(target,token){const memory=state.memory,detail=memory.detail;
  if(!detail||!memoryCurrent(token)||memory.view!=='detail')return;
  const buttons=[];
  if(memoryActionAllowed('correct'))buttons.push(action('纠正这项理解',()=>
    openMemoryConfirmation({operation:'correct'},target,token),false));
  if(memoryActionAllowed('mute'))buttons.push(action('停用这项记忆',()=>
    openMemoryConfirmation({operation:'mute'},target,token),false));
  if(memoryActionAllowed('deleteItem'))buttons.push(action('永久删除这项记忆',()=>
    openMemoryConfirmation({operation:'deleteItem',confirmText:''},target,token),false));
  if(buttons.length)target.append(group('管理这项记忆',buttons));
  const choice=memory.confirmation;if(!choice)return;
  const box=group(choice.operation==='correct'?'纠正理解':choice.operation==='mute'?'确认停用':'确认删除',[]),
    body=box.querySelector('.group-body');
  box.classList.add('memory-confirm-panel');
  if(choice.operation==='correct'){
    body.append(el('p','muted','写下新的理解；保存后旧理解会退出当前召回，来源与修订记录仍可查询。'));
    const input=el('textarea','memory-correction');input.maxLength=4000;input.placeholder='输入正确的理解';
    input.value=memory.correctionDraft;input.addEventListener('input',()=>{memory.correctionDraft=input.value});body.append(input,
      action('保存纠正',()=>submitMemoryAction('correct',null,input.value),true));
  }else{
    body.append(el('p','memory-consequence',choice.operation==='mute'?
      '停用后，记忆和来源仍可查看，但不再参与后续召回。':choice.operation==='deleteEvidence'?
      `将删除来源“${choice.summary}”的有效正文与关联引用；原始聊天、会话存档和既有备份仍可能保留。共享来源可能使删除被拒绝。`:
      '将从当前有效记忆与召回移除这项记忆；原始聊天、会话存档和既有备份仍可能保留。共享或不明来源可能使删除被拒绝。'));
    if(choice.operation!=='mute'){
      const input=field('输入“删除”以确认','text',choice.confirmText||'');input.input.maxLength=2;
      const confirm=action(choice.operation==='deleteEvidence'?'确认删除这条来源':'确认永久删除记忆',
        ()=>submitMemoryAction(choice.operation,choice.id||null),true);
      confirm.disabled=input.input.value.trim()!=='删除';input.input.addEventListener('input',()=>{
        choice.confirmText=input.input.value;confirm.disabled=input.input.value.trim()!=='删除'});
      body.append(input.box,confirm);
    }else body.append(action('确认停用',()=>submitMemoryAction('mute'),true))}
  body.append(action('取消',()=>{memory.confirmation=null;renderMemoryDetail(target,token)},false));target.append(box)}
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
  if(memory.view==='detail')renderMemoryDetail(memory.target,token);else renderMemoryList(memory.target);
  try{const result=await call('host.business',{path:`/personal/v1/memory/commands/by-request/${memoryPathEncode(marker.requestId)}`,method:'GET'});
    if(!memoryCurrent(token))return;
    if(!handleMemoryReceipt(result?.receipt,marker,token)){
      memory.receiptMessage='回执内容无法确认；原请求仍保留，不会自动重发。';
      memory.checkingReceipt=false;if(memory.view==='detail')renderMemoryDetail(memory.target,token);else renderMemoryList(memory.target)}}
  catch{if(!memoryCurrent(token))return;memory.checkingReceipt=false;
    memory.receiptMessage='原请求结果仍待确认。请稍后核对回执；不会自动重发。';
    if(memory.view==='detail')renderMemoryDetail(memory.target,token);else renderMemoryList(memory.target)}}
async function submitMemoryAction(operation,evidenceId=null,correction=''){const memory=state.memory,detail=memory?.detail;
  if(!detail||!memoryCurrent(memoryToken())||!memoryActionAllowed(operation,
    operation==='deleteEvidence'?memory.sources.find(source=>source.evidenceId===evidenceId):null))return;
  const text=correction.trim();if(operation==='correct'&&(!text||text.length>4000)){
    memory.detailError='纠正内容须为 1–4000 个字符。';renderMemoryDetail(memory.target);return}
  if(['deleteItem','deleteEvidence'].includes(operation)&&memory.confirmation?.confirmText?.trim()!=='删除')return;
  const requestId=newMemoryRequestId(),kind=detail.item.kind,itemId=detail.item.id,
    id=operation==='deleteEvidence'?evidenceId:itemId,revision=memory.detailRevision;
  if(!Number.isSafeInteger(revision)||!memoryPathIdSupported(id))return;
  const marker={requestId,operation,kind,id,itemId};
  if(!persistMemoryMarker(marker)){memory.detailError='无法保存回执查询标识；本次没有提交。';renderMemoryDetail(memory.target);return}
  memory.pendingMarker=marker;memory.activeOperation=marker;memory.detailError='';memory.confirmation=null;
  memory.receiptItemId=itemId;memory.receiptMessage='正在提交操作并等待回执…';const token=memoryToken();renderMemoryDetail(memory.target,token);
  const base=operation==='deleteEvidence'?`/personal/v1/memory/evidence/${memoryPathEncode(id)}`:
    `/personal/v1/memory/items/${memoryPathEncode(kind)}/${memoryPathEncode(id)}`;
  const path=operation==='correct'?`${base}/correct`:operation==='mute'?`${base}/mute`:base,
    method=['deleteItem','deleteEvidence'].includes(operation)?'DELETE':'POST',
    body={requestId,expectedWorldRevision:revision,...(operation==='correct'?{text}:{})};
  try{const result=await call('host.business',{path,method,body});if(!memoryCurrent(token))return;
    if(!handleMemoryReceipt(result?.receipt,marker,token)){
      memory.activeOperation=null;memory.receiptMessage='回执内容无法确认；原请求仍待核对，不会自动重发。';
      renderMemoryDetail(memory.target,token)}}
  catch(error){if(!memoryCurrent(token))return;memory.activeOperation=null;
    if(['UNAUTHORIZED','FORBIDDEN','INVALID_REQUEST','NOT_FOUND','MEMORY_DISABLED','MEMORY_UNAVAILABLE',
      'MEMORY_ACTION_UNSUPPORTED','MEMORY_DELETE_UNAVAILABLE','MEMORY_REQUEST_CONFLICT','MEMORY_REPLAY_REDACTED'].includes(error?.message)){
      clearMemoryMarker(marker);memory.pendingMarker=null;memory.receiptMessage=memoryFailureText(error);
      if(error?.message==='NOT_FOUND'||error?.message==='MEMORY_REVISION_CHANGED'){
        memory.items=[];memory.detail=null;memory.sources=[];memory.view='list';startMemorySnapshot(memory.target,memory.kind,memory.query)}
      else renderMemoryDetail(memory.target,token);
      return}
    memory.receiptMessage='提交结果待确认，正在查询原请求回执；不会自动重发。';
    renderMemoryDetail(memory.target,token);void reconcileMemoryMarker(marker)}}
function capabilitiesPage(target){target.append(heading('能力与扩展','手机能执行的动作与电脑已有组件清楚分开。'),
  group('这台手机',[row('打开应用','选择系统列出的可启动应用',()=>state.loggedIn?phoneAction('apps'):page('connect')),
    row('打开系统设置','向 Android 请求打开设置，结果保留在原对话',()=>state.loggedIn?phoneAction('settings'):page('connect'))]));
  const section=group('电脑组件',[]);const body=section.querySelector('.group-body');body.append(el('p','muted','正在读取连接状态…'));target.append(section);
  if(!state.loggedIn){body.textContent='连接个人账户后可查看电脑组件状态。';return}
  const gen=state.generation;call('host.modules').then(modules=>{if(state.page!=='capabilities'||state.generation!==gen)return;clear(body);
    for(const [key,title,description] of [['mods','Mod 与能力','发现、配置和复用业务能力'],
      ['capabilities','设备执行','跨端动作与可用能力'],['memory','记忆','查看理解与来源'],
      ['workspaces','项目与成果','电脑文件与任务结果']]){
      const status=moduleLabel(modules[key]);body.append(row(title,`${description} · ${status}`,()=>capabilityDetail(key,title,status)))}
  }).catch(()=>{body.textContent='电脑暂时不可达；手机动作仍可使用。'});
}
function moduleLabel(value){return {connected:'已连接',disabled:'未启用',unknown:'状态待确认'}[value]||'状态待确认'}
function capabilityDetail(key,title,status){const target=$('page-content');clear(target);target.append(heading(title));
  target.append(notice(status==='已连接'?'电脑组件已连接，手机操作入口与业务数据仍按实际服务逐项开放。':
    status==='未启用'?'此组件尚未启用；不会在手机上显示虚构操作。':'当前还无法确认服务状态。',status));
  if(key==='memory')target.append(action('查看记忆页面',()=>page('memory'),false));
  if(key==='workspaces')target.append(action('查看项目与成果',()=>page('workspaces'),false));
  if(key==='mods')target.append(group('目录与详情',[row('已安装能力','接通 Mod 目录后在这里查看版本、设置和权限',()=>subNotice('Mod 目录','当前没有可展示的已安装列表'))]));
}
const projectIdPattern=/^project-[A-Za-z0-9-]{1,128}$/;
const profileIdPattern=/^[A-Za-z0-9._-]{1,128}$/;
const hostIdPattern=/^[A-Za-z0-9_-]{1,128}$/;
function projectIntentKey(hostId){return `weftmate-project-create:${state.owner}:${hostId}`}
function savedProjectIntent(hostId){try{const value=JSON.parse(localStorage.getItem(projectIntentKey(hostId))||'null');
  return value?.owner===state.owner&&value.hostId===hostId&&projectIdPattern.test(value.projectId||'')&&
    profileIdPattern.test(value.modelProfileId||'')&&/^[0-9a-f-]{36}$/.test(value.requestId||'')?value:null}catch{return null}}
function projectIntentCurrent(owner,epoch,generation){return state.loggedIn&&state.owner===owner&&
  state.authEpoch===epoch&&state.page==='workspaces'&&state.generation===generation&&!state.transitionPending}
function browserIntentKey(hostId){return `weftmate-browser-create:${state.owner}:${hostId}`}
function savedBrowserIntent(hostId){try{const value=JSON.parse(localStorage.getItem(browserIntentKey(hostId))||'null');
  return value?.owner===state.owner&&value.hostId===hostId&&profileIdPattern.test(value.modelProfileId||'')&&
    /^[0-9a-f-]{36}$/.test(value.sessionRequestId||'')&&/^[0-9a-f-]{36}$/.test(value.messageRequestId||'')&&
    typeof value.goal==='string'&&value.goal.length>0&&value.goal.length<=6000&&
    Array.isArray(value.urls)&&value.urls.length>=1&&value.urls.length<=5&&
    value.urls.every(url=>typeof url==='string'&&url.length<=2048)?value:null}catch{return null}}
async function resolveBrowserIntent(intent,message){const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
  const current=()=>projectIntentCurrent(owner,epoch,generation),sameOwner=()=>state.owner===owner&&
    state.authEpoch===epoch&&!state.transitionPending;
  if(!current())return;message.textContent='正在核对原网页会话请求…';
  let command=null;
  try{command=(await call('shared.commands.byRequest',{requestId:intent.sessionRequestId}))?.command||null}
  catch(error){if(!current())return;if(error?.message!=='NOT_FOUND'){
    message.textContent='暂时无法核对原网页会话，原选择和编号已保留。';return}}
  if(!command){try{const result=await call('host.business',{path:'/personal/v1/workspaces/browser/sessions',
      method:'POST',body:{requestId:intent.sessionRequestId,modelProfileId:intent.modelProfileId}});
      if(!current())return;command=result?.command||null}
    catch{if(current())message.textContent='网页会话送达状态不明；重连后先查原编号，不会重复创建。';return}}
  if(command?.kind!=='session.create'||command.requestId!==intent.sessionRequestId||
    command.workspaceKind!=='browser'||!sessionIdPattern.test(command.sessionId||'')){
    if(current())message.textContent='网页会话回执与原选择不一致，编号已保留供核对。';return}
  for(let attempt=0;attempt<5&&current()&&['pending','dispatching'].includes(command.state);attempt++){
    await new Promise(resolve=>setTimeout(resolve,800));if(!current())return;
    try{command=(await call('shared.commands.byRequest',{requestId:intent.sessionRequestId}))?.command||command}
    catch{break}}
  if(command.state!=='accepted_by_dsh'){
    if(current())message.textContent='电脑尚未确认网页会话；原选择与请求编号已保留。';return}
  let session=null;
  try{const listed=await call('shared.sessions.list');if(!current())return;
    if(listed?.source!=='host'||!Array.isArray(listed.sessions))throw new Error('SESSION_UNAVAILABLE');
    session=listed.sessions.find(item=>item.sessionId===command.sessionId&&item.workspaceKind==='browser'&&
      item.modelProfileId===intent.modelProfileId)||null;
    if(!session){message.textContent='网页会话已受理，正在等待准确会话绑定进入列表。';return}
    state.sharedSessions=listed.sessions.filter(item=>item?.source==='host'&&typeof item.sessionId==='string');
    selectSharedSession(command.sessionId)
  }catch{if(current())message.textContent='网页会话列表暂不可核对；原编号仍保留。';return}
  if(!sameOwner())return;
  const text=`${intent.goal}\n\n网页链接：\n${intent.urls.join('\n')}`;
  let sent=null;
  try{sent=(await call('shared.commands.byRequest',{requestId:intent.messageRequestId}))?.command||null}
  catch(error){if(!sameOwner())return;if(error?.message!=='NOT_FOUND'){
    status('网页目标状态待核对，原消息编号仍保留');return}}
  if(!sent){try{const result=await call('shared.send',{sessionId:command.sessionId,
      text,requestId:intent.messageRequestId});if(!sameOwner())return;
      if(result?.source!=='host'||result.sessionId!==command.sessionId||
        result.requestId!==intent.messageRequestId){status('网页目标回执不完整，原编号已保留');return}
      if(result.state==='accepted'){
        localStorage.removeItem(browserIntentKey(intent.hostId));
        status('网页目标已送达电脑会话，正在等待实际阅读结果');void loadSharedHistory();return}
      status('网页目标送达结果待核对；原编号已保留，不会自动重复发送');return}
    catch{if(sameOwner())status('网页目标送达状态不明；原编号已保留，重连后先查询');return}}
  if(sent.requestId===intent.messageRequestId&&sent.sessionId===command.sessionId&&
      sent.kind==='session.message'&&sent.state==='accepted_by_dsh'){
    localStorage.removeItem(browserIntentKey(intent.hostId));
    status('网页目标已在原电脑会话受理');void loadSharedHistory();return}
  status('网页目标尚未确认受理；原消息编号仍保留')
}
async function resolveProjectSessionIntent(intent,message){
  const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
  const current=()=>projectIntentCurrent(owner,epoch,generation);
  if(!current())return;
  message.textContent='正在核对上次项目会话请求…';
  let command=null;
  try{const result=await call('shared.commands.byRequest',{requestId:intent.requestId});
    if(!current())return;command=result?.command||null}
  catch(error){if(!current())return;if(!['NOT_FOUND','SESSION_UNAVAILABLE'].includes(error?.message)){
    message.textContent='当前无法核对原请求。项目与模型选择已保留，重连后再试。';return}}
  if(!command){try{const result=await call('shared.projects.createSession',{projectId:intent.projectId,
      modelProfileId:intent.modelProfileId,requestId:intent.requestId});
      if(!current())return;command=result?.command||null;
      if(result?.source!=='host'||command?.requestId!==intent.requestId)throw new Error('COMMAND_RECEIPT_INVALID')}
    catch(error){if(current())message.textContent='送达状态尚不明确。保留原请求编号；重连后会先查询再重试。';return}}
  if(command.kind!=='session.create'||command.requestId!==intent.requestId||
    command.projectId!==intent.projectId||!sessionIdPattern.test(command.sessionId||'')){
    if(current())message.textContent='会话回执与原选择不一致，已保留请求供核对。';return}
  if(['pending','dispatching'].includes(command.state)){
    for(let attempt=0;attempt<5&&current()&&['pending','dispatching'].includes(command.state);attempt++){
      await new Promise(resolve=>setTimeout(resolve,800));
      if(!current())return;
      try{command=(await call('shared.commands.byRequest',{requestId:intent.requestId}))?.command||command}
      catch{break}}
    if(['pending','dispatching'].includes(command.state)){
      if(current())message.textContent='电脑已记录请求，正在创建会话；稍后可用同一选择继续核对。';return}}
  if(command.state!=='accepted_by_dsh'){
    if(current())message.textContent='电脑尚未确认会话创建；原选择和编号仍保留。';return}
  try{const result=await call('shared.sessions.list');if(!current())return;
    if(result?.source!=='host'||!Array.isArray(result.sessions))throw new Error('SESSION_UNAVAILABLE');
    const exact=result.sessions.find(item=>item.sessionId===command.sessionId&&item.projectId===intent.projectId&&
      item.modelProfileId===intent.modelProfileId);
    if(!exact){message.textContent='会话已受理，正在等待项目绑定出现在列表；原编号已保留。';return}
    state.sharedSessions=result.sessions.filter(item=>item?.source==='host'&&typeof item.sessionId==='string');
    localStorage.removeItem(projectIntentKey(intent.hostId));
    selectSharedSession(command.sessionId);
    toast('项目会话已打开，可在原对话发送摘要目标。')
  }catch(error){if(current())message.textContent='会话列表暂时不可核对；原选择和编号已保留。'}
}
function workspacesPage(target){target.append(heading('项目与成果'));
  if(!state.loggedIn){target.append(notice('请先连接自己的电脑账户。项目目录只能由原电脑账户登记。'),
    action('连接账户',()=>page('connect')));return}
  const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
  const current=()=>projectIntentCurrent(owner,epoch,generation);
  const statusNode=el('p','workspace-status','正在读取账户项目与电脑模型…');target.append(statusNode);
  const projectGroup=group('已登记项目',[]),projectBody=projectGroup.querySelector('.group-body');
  const modelGroup=group('使用的模型',[]),modelBody=modelGroup.querySelector('.group-body');
  const browserGroup=group('网页资料',[]),browserBody=browserGroup.querySelector('.group-body');
  target.append(browserGroup,projectGroup,modelGroup);
  void Promise.allSettled([call('shared.projects.list'),call('models.host'),
    call('host.business',{path:'/personal/v1/workspaces/browser',method:'GET'})])
    .then(([projectResult,modelResult,browserResult])=>{
    if(!current())return;
    const candidate=projectResult.status==='fulfilled'?projectResult.value:null;
    const listed=candidate?.source==='host'&&hostIdPattern.test(candidate.hostId||'')&&
      Array.isArray(candidate.projects)?candidate:null;
    const catalog=modelResult.status==='fulfilled'?modelResult.value:null;
    const browser=browserResult.status==='fulfilled'?browserResult.value:null;
    const browserError=browserResult.status==='rejected'?browserResult.reason:null;
    clear(projectBody);clear(modelBody);clear(browserBody);
    const projects=listed?listed.projects.filter(item=>projectIdPattern.test(item?.projectId||'')&&
      typeof item.name==='string'):[],models=(Array.isArray(catalog?.models)?catalog.models:[]).filter(item=>item?.configured===true&&
      profileIdPattern.test(item.profileId||'')&&typeof item.displayName==='string');
    const intent=listed?savedProjectIntent(listed.hostId):null;
    let selectedProject=projects.find(item=>item.projectId===intent?.projectId&&!item.revoked)||
      projects.find(item=>!item.revoked)||null;
    let selectedModel=models.find(item=>item.profileId===intent?.modelProfileId)||models[0]||null;
    if(!listed)projectBody.append(notice(projectResult.status==='rejected'&&projectResult.reason?.message==='NOT_FOUND'?
      '当前电脑服务还没有项目目录入口；网页资料仍可单独使用。':'项目列表暂时无法核对；网页资料仍可单独使用。'));
    else if(!projects.length){projectBody.append(notice('此账户还没有登记项目。请先在电脑账户页的“项目与成果”选择资料目录。'))}
    else for(const item of projects){const button=row(item.name,
      item.revoked?'已撤销 · 历史成果仍可查看':'电脑登记',()=>{
        if(item.revoked)return;selectedProject=item;renderSelection()});button.disabled=item.revoked;
      button.dataset.projectId=item.projectId;projectBody.append(button)}
    modelGroup.hidden=!listed||!selectedProject;
    const select=el('select','workspace-model-select');select.setAttribute('aria-label','项目资料使用的电脑模型');
    if(!models.length){select.append(el('option','','电脑没有已配置模型'));select.disabled=true;
      modelBody.append(notice('请先在电脑设置中配置模型；项目目录登记不会自动选择资料目的地。'))}
    else {for(const item of models){const option=el('option','',`${item.displayName} · ${item.sourceKind==='local'?'电脑本机':'电脑云端'}`);
        option.value=item.profileId;select.append(option)}
      select.value=selectedModel.profileId;select.addEventListener('change',()=>{
        selectedModel=models.find(item=>item.profileId===select.value)||null;renderSelection()});modelBody.append(select)}
    const disclosure=el('p','workspace-disclosure'),send=action('在此项目开始对话',async()=>{
      if(!current()||!selectedProject||!selectedModel)return;
      statusNode.hidden=false;
      const prior=savedProjectIntent(listed.hostId);
      if(prior&&(prior.projectId!==selectedProject.projectId||prior.modelProfileId!==selectedModel.profileId)){
        statusNode.textContent='上一次项目会话仍待核对。请先恢复原选择，避免重复创建。';return}
      const next=prior||{owner,hostId:listed.hostId,projectId:selectedProject.projectId,
        modelProfileId:selectedModel.profileId,requestId:crypto.randomUUID()};
      try{const verified=await call('models.verifyHost',{profileId:next.modelProfileId});
        if(!current())return;
        if(verified?.available!==true){statusNode.textContent='所选电脑模型当前不可用。请选择其他已配置模型或稍后重试。';return}}
      catch{if(current())statusNode.textContent='暂时无法核对所选模型，请检查电脑连接后重试。';return}
      try{localStorage.setItem(projectIntentKey(listed.hostId),JSON.stringify(next))}
      catch{statusNode.textContent='无法安全保存请求编号，暂不能创建会话。';return}
      send.disabled=true;
      try{await resolveProjectSessionIntent(next,statusNode)}finally{if(current())send.disabled=false}
    });
    modelBody.append(disclosure,send);
    function renderSelection(){for(const button of projectBody.querySelectorAll('[data-project-id]')){
        button.classList.toggle('is-selected',button.dataset.projectId===selectedProject?.projectId)}
      disclosure.textContent=selectedProject&&selectedModel?`“${selectedProject.name}”中实际读取的资料将交给${
        selectedModel.sourceKind==='local'?'电脑本机':'电脑云端'}模型“${selectedModel.displayName}”。仅当前项目的已读正文进入该会话。`:
        '选择一个未撤销项目和已配置模型后，才能开始项目对话。';
      send.disabled=!selectedProject||!selectedModel}
    renderSelection();
    if(browser?.available!==true||!hostIdPattern.test(browser?.hostId||'')||
      browser.workspaceKind!=='browser'||listed&&browser.hostId!==listed.hostId){
      const missing=browserError?.message==='NOT_FOUND'||browserError?.status===404;
      browserBody.append(notice(missing?'当前电脑服务还没有网页资料入口；已有项目和聊天仍可使用。':
        browserError?'网页阅读暂时无法连接，请稍后刷新；原请求会保留。':
          '网页阅读目前不可用，请检查电脑连接与账户权限。'))}
    else{const priorBrowser=savedBrowserIntent(browser.hostId);
      const urlBox=el('label','field'),urlInput=el('textarea');urlInput.rows=3;
      urlInput.value=priorBrowser?.urls.join('\n')||'';
      urlInput.placeholder='https://example.org/article';
      urlBox.append(el('span','','公共网页链接（每行一个，1–5条）'),urlInput);
      const goalBox=el('label','field'),goalInput=el('textarea');goalInput.rows=3;
      goalInput.maxLength=6000;goalInput.value=priorBrowser?.goal||'';
      goalInput.placeholder='例如：比较两篇文章的主要观点并保存摘要';
      goalBox.append(el('span','','希望整理什么'),goalInput);
      const browserModel=el('select','workspace-model-select');browserModel.setAttribute('aria-label','网页资料使用的电脑模型');
      for(const item of models){const option=el('option','',`${item.displayName} · ${item.sourceKind==='local'?'电脑本机':'电脑云端'}`);
        option.value=item.profileId;browserModel.append(option)}
      browserModel.value=models.some(item=>item.profileId===priorBrowser?.modelProfileId)?priorBrowser.modelProfileId:
        models[0]?.profileId||'';
      browserModel.disabled=!models.length;
      const disclosureWeb=el('p','workspace-disclosure'),webStatus=el('p','workspace-status',
        priorBrowser?'发现上次未确认的网页任务，正在按原编号核对。':'');
      webStatus.hidden=!webStatus.textContent;
      const start=action('开始网页任务',async()=>{
        if(!current())return;
        webStatus.hidden=false;
        const profile=models.find(item=>item.profileId===browserModel.value);
        const goal=goalInput.value.trim(),urls=urlInput.value.split(/\r?\n/u).map(value=>value.trim()).filter(Boolean);
        if(!profile||!goal||goal.length>6000||/https?:\/\//iu.test(goal)||urls.length<1||urls.length>5){
          webStatus.textContent='请填写目标和1–5条单独列出的公共链接；目标文字中不要重复贴链接。';return}
        if(urls.some(value=>{try{const parsed=new URL(value);return !['http:','https:'].includes(parsed.protocol)||
            parsed.username||parsed.password||new TextEncoder().encode(value).length>2048}
          catch{return true}})){
          webStatus.textContent='链接须是完整的公共 HTTP/HTTPS 地址，且不能包含账号密码。';return}
        const composed=`${goal}\n\n网页链接：\n${urls.join('\n')}`;
        if(new TextEncoder().encode(composed).length>8192){webStatus.textContent='目标与链接合计过长，请缩短后重试。';return}
        const previous=savedBrowserIntent(browser.hostId);
        if(previous&&(previous.modelProfileId!==profile.profileId||previous.goal!==goal||
            JSON.stringify(previous.urls)!==JSON.stringify(urls))){
          webStatus.textContent='上一项网页任务仍待核对，请先按原选择恢复，避免重复派发。';return}
        const intent=previous||{owner,hostId:browser.hostId,modelProfileId:profile.profileId,goal,urls,
          sessionRequestId:crypto.randomUUID(),messageRequestId:crypto.randomUUID()};
        try{const check=await call('models.verifyHost',{profileId:intent.modelProfileId});if(!current())return;
          if(check?.available!==true){webStatus.textContent='所选电脑模型当前不可用，请核对后再试。';return}}
        catch{if(current())webStatus.textContent='暂时无法核对所选模型；请检查连接后重试。';return}
        try{localStorage.setItem(browserIntentKey(browser.hostId),JSON.stringify(intent))}
        catch{webStatus.textContent='无法安全保存任务编号，暂不能发送。';return}
        start.disabled=true;
        try{await resolveBrowserIntent(intent,webStatus)}finally{if(current())start.disabled=false}
      });
      const updateWebDisclosure=()=>{const selected=models.find(item=>item.profileId===browserModel.value);
        disclosureWeb.textContent=selected?`实际读取的公共网页正文将交给${
          selected.sourceKind==='local'?'电脑本机':'电脑云端'}模型“${selected.displayName}”。链接会由电脑逐一核对。`:
          '请先在电脑配置可用模型，再发起网页任务。';start.disabled=!selected};
      browserModel.addEventListener('change',updateWebDisclosure);
      browserBody.append(urlBox,goalBox,browserModel,disclosureWeb,start,webStatus);
      updateWebDisclosure();
      if(priorBrowser)void resolveBrowserIntent(priorBrowser,webStatus)
    }
    statusNode.textContent=!listed?projectResult.status==='rejected'&&projectResult.reason?.message==='NOT_FOUND'?
      '项目目录入口尚未接入；网页资料可独立使用。':'项目列表暂时无法读取；网页资料可独立使用。':
      intent?'发现上次未完成的会话请求，正在用原编号核对。':
        projects.length>0&&!selectedProject?'项目均已撤销；请在电脑重新登记。':'';
    statusNode.hidden=!statusNode.textContent;
    if(intent)void resolveProjectSessionIntent(intent,statusNode)
  }).catch(error=>{if(!current())return;statusNode.textContent=['NOT_FOUND','OPERATION_FAILED'].includes(error?.message)?
    '当前电脑服务还没有项目目录入口，原有聊天和历史仍可使用。':'电脑暂时不可达；原项目会话请求会保留，重连后继续核对。';
    clear(projectBody);clear(modelBody)})
}
function connectPage(target){target.append(heading('电脑账户与连接','手机离线时仍可使用本机对话；连接后可同步记录和管理设备。'));
  if(state.loggedIn){target.append(notice(`当前账户：${state.username}。${connectionLabel()}。`,
    state.connection==='connected'?'连接正常':'登录已保存'),group('连接操作',[
    row('检查账户','核对当前会话是否仍有效',async()=>{
      const epoch=state.authEpoch,owner=state.owner;
      try{
        const profile=await call('auth.me');
        if(epoch!==state.authEpoch||owner!==state.owner)return;
        state.profile=profile;
        state.connection=profile.connectionVerified?'connected':'offline';
        showProfile(profile);
        if(state.page==='connect'||state.page==='settings')page(state.page);
        else if(state.page==='chat'&&!state.conversationId)showWelcome();
        toast(profile.connectionVerified?'账户连接正常':'电脑暂不可达，正在使用当前账户的本机资料',!profile.connectionVerified);
      }catch(error){
        if(epoch!==state.authEpoch||owner!==state.owner)return;
        state.connection=error.message==='UNAUTHORIZED'||error.message==='AUTH_REQUIRED'?'expired':'offline';
        if(state.page==='connect'||state.page==='settings')page(state.page);
        else if(state.page==='chat'&&!state.conversationId)showWelcome();
        toast(state.connection==='expired'?'登录已失效，请重新登录':'电脑暂不可达，本机资料仍保留',true);
      }
    }),
     row('退出登录','本机对话保留；当前设备的服务器会话将撤销',async()=>{try{await call('auth.logout');state.authEpoch++;state.accountModelCredentialConflict=null;state.handoffViews.clear();state.linkedEvents.clear();state.handoffModelNames.clear();state.handoffPickerOpen.clear();state.handoffSelections.clear();state.handoffModelLastCheck=0;clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;state.loggedIn=false;state.connection='local';state.username='';state.owner='';state.profile=null;state.model=null;state.conversationId=null;
       resetMemoryForAuthBoundary('已退出电脑账户；记忆内容已清除。');
      state.backgroundSync='not_scheduled';
      $('model-label').textContent='选择模型';try{applyTheme((await call('settings.appearance')).value)}catch{applyTheme('system')}
      showProfile({displayName:'未登录'});page('connect');await listConversations();loadDraft()}catch(e){toast(safeError(e),true)}})]));return}
  const origin=field('个人服务地址','url','https://home.weftmate.com:8443');const user=field('账户名（3–64个字符）','text');
  const password=field('密码（注册时15–128个字符）','password');
  const device=field('设备名称','text','这台手机');const display=field('昵称（首次注册时可填）','text');
  const root=group('连接个人账户',[]);const body=root.querySelector('.group-body');body.append(origin.box,user.box,password.box,device.box,display.box);
  const result=el('div','muted','先检查服务连接。已有账户可登录，也可以注册自己的账户。');body.append(result);
  const buttons=el('div','form-actions');let authenticating=false,probeEpoch=0;const login=action('登录',async()=>authenticate('auth.login'));
  const register=action('注册新账户',async()=>authenticate('auth.register'),false);register.hidden=true;
  async function authenticate(method){if(authenticating)return;
    if(method==='auth.register'&&[...password.input.value].length<15||
      method==='auth.register'&&[...password.input.value].length>128){result.textContent='注册密码需为15–128个字符，可使用密码短语。';result.className='inline-error';return}
    authenticating=true;login.disabled=true;register.disabled=true;probe.disabled=true;
    result.textContent=method==='auth.register'?'正在注册账户…':'正在登录…';result.className='muted';
    try{const account=await call(method,{origin:origin.input.value,username:user.input.value,
      password:password.input.value,deviceName:device.input.value,displayName:display.input.value});password.input.value='';
      state.authEpoch++;state.accountModelCredentialConflict=null;state.handoffViews.clear();state.linkedEvents.clear();state.handoffModelNames.clear();state.handoffPickerOpen.clear();state.handoffSelections.clear();state.handoffModelLastCheck=0;clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;state.loggedIn=true;state.connection=account.connectionVerified?'connected':'checking';state.username=account.username;state.owner=account.owner||'';state.deviceId=account.deviceId||account.device?.id||'';state.profile=account;state.conversationId=null;
      resetMemoryForAuthBoundary('账户已切换。请重新读取新账户的记忆。');
      const current=await call('app.bootstrap');state.model=current.model?.source?current.model:null;
      state.backgroundSync=account.backgroundSync||current.backgroundSync||'unknown';
      $('model-label').textContent=state.model?.displayName||'选择模型';
      try{applyTheme((await call('settings.appearance')).value)}catch{applyTheme('system')}
      showProfile(account);
      page('connect');await listConversations();loadDraft();
      await call('app.ready',{owner:state.owner,hasDraft:hasAnyDraft()});
      let outcome=account.connectionVerified?(method==='auth.register'?'账户已建立':'已登录账户'):
        '登录已保存，连接待核对';
      if(state.backgroundSync==='not_scheduled')outcome+='；后台同步未启用，仍可手动同步';
      else if(state.backgroundSync==='unknown')outcome+='；后台同步状态待确认';
      toast(outcome,state.backgroundSync!=='scheduled')}
    catch(e){password.input.value='';result.textContent=safeError(e);result.className='inline-error'}
    finally{authenticating=false;login.disabled=false;register.disabled=false;probe.disabled=false}}
  buttons.append(login,register);body.append(buttons);target.append(root);
  const probe=action('检查服务连接',async()=>{const current=++probeEpoch,originValue=origin.input.value;
    result.textContent='正在检查连接…';result.className='muted';try{const service=await call('auth.state',{origin:originValue});
    if(current!==probeEpoch||origin.input.value!==originValue||authenticating)return;
    if(service.configured){result.textContent=service.registrationAvailable?'可登录现有账户，也可注册新账户。':'服务已有账户，请登录。';
      login.hidden=false;register.hidden=!service.registrationAvailable}
    else{result.textContent=service.registrationAvailable?'此服务尚无账户，可以注册自己的账户。':'服务当前不开放注册。';
      login.hidden=true;register.hidden=!service.registrationAvailable}}
    catch(e){if(current!==probeEpoch||authenticating)return;result.textContent=safeError(e);result.className='inline-error';login.hidden=true;register.hidden=true}},false);
  root.querySelector('.group-body').insertBefore(probe,result);
}
function accountModelIntentKey(kind,id){return `weftmate-account-model:${kind}:${state.owner}:${id}`}
function savedAccountModelIntent(kind,id){try{const value=JSON.parse(localStorage.getItem(accountModelIntentKey(kind,id))||'null');
  return value?.owner===state.owner&&/^[0-9a-f-]{36}$/.test(value.requestId||'')?value:null}catch{return null}}
function clearAccountModelIntent(kind,id,requestId){if(savedAccountModelIntent(kind,id)?.requestId===requestId)
  try{localStorage.removeItem(accountModelIntentKey(kind,id))}catch{}}
function modelPageCurrent(owner,epoch,generation){return state.page==='models'&&state.owner===owner&&
  state.authEpoch===epoch&&state.generation===generation&&!state.transitionPending}
async function publishSavedPhoneModel(item){const owner=state.owner,epoch=state.authEpoch,generation=state.generation,
  id=`${item.endpoint}|${item.modelId}`,current=()=>modelPageCurrent(owner,epoch,generation);
  let marker=savedAccountModelIntent('publish',id);
  if(marker&&(marker.endpoint!==item.endpoint||marker.modelId!==item.modelId)){
    toast('原上传请求仍待核对；请保持原手机模型',true);return}
  marker ||= {owner,requestId:crypto.randomUUID(),endpoint:item.endpoint,modelId:item.modelId};
  try{localStorage.setItem(accountModelIntentKey('publish',id),JSON.stringify(marker))}
  catch{toast('无法保存上传编号，本次没有提交',true);return}
  try{const result=await call('models.account.publishSaved',{endpoint:item.endpoint,
    modelId:item.modelId,requestId:marker.requestId});if(!current())return;
    const operation=result?.operation;
    if(operation?.requestId!==marker.requestId){toast('上传回执无法核对；原编号已保留',true);return}
    if(operation.status==='succeeded'){
      clearAccountModelIntent('publish',id,marker.requestId);
      toast('原手机模型已保存到当前电脑账户；已有会话目的地保持不变');page('models')
    }else if(operation.status==='failed'){
      clearAccountModelIntent('publish',id,marker.requestId);
      toast(safeError({message:operation.errorCode||operation.reasonCode||'OPERATION_FAILED'}),true)
    }else toast('电脑仍在处理原模型配置，请稍后用同编号核对',true)
  }catch(error){if(current())toast(error?.message==='TIMEOUT'
    ? '上传结果待核对；原请求编号已保留，不会换模型':safeError(error),true)}}
async function transferAccountModel(item,replaceExistingKey=false){const owner=state.owner,epoch=state.authEpoch,
  generation=state.generation,current=()=>modelPageCurrent(owner,epoch,generation),
  id=`${item.accountModelId}:${item.revision}`;
  let marker=replaceExistingKey?null:savedAccountModelIntent('transfer',id);
  if(marker&&(marker.accountModelId!==item.accountModelId||marker.expectedRevision!==item.revision)){
    toast('原下载请求仍待核对，请保持原配置修订',true);return}
  marker ||= {owner,requestId:crypto.randomUUID(),accountModelId:item.accountModelId,
    expectedRevision:item.revision};
  try{localStorage.setItem(accountModelIntentKey('transfer',id),JSON.stringify(marker))}
  catch{toast('无法保存取回编号，本次没有提交',true);return}
  try{const result=await call('models.account.transfer',{accountModelId:item.accountModelId,
    expectedRevision:item.revision,requestId:marker.requestId,replaceExistingKey});if(!current())return;
    if(result?.requestId!==marker.requestId){toast('取回回执无法核对；原编号已保留',true);return}
    if(result.status==='credential_conflict'){
      clearAccountModelIntent('transfer',id,marker.requestId);
      state.accountModelCredentialConflict={owner,id,item};
      toast('手机同一地址已有不同密钥，原配置与当前模型未改变',true);page('models');return}
    if(result.status==='saved'){
      clearAccountModelIntent('transfer',id,marker.requestId);
      state.accountModelCredentialConflict=null;
      toast('已加密存到手机。要改为手机直连，请在本机模型列表明确选择');page('models')
    }else toast('取回结果待核对，原手机配置保持不变',true)
  }catch(error){if(current())toast(safeError(error),true)}}
async function testAccountModel(item){const owner=state.owner,epoch=state.authEpoch,
  generation=state.generation,current=()=>modelPageCurrent(owner,epoch,generation),
  id=`${item.accountModelId}:${item.revision}`;
  let marker=savedAccountModelIntent('test',id);
  marker ||= {owner,requestId:crypto.randomUUID(),accountModelId:item.accountModelId,
    expectedRevision:item.revision};
  try{localStorage.setItem(accountModelIntentKey('test',id),JSON.stringify(marker))}
  catch{toast('无法保存测试编号，本次没有提交',true);return}
  try{let result;try{result=await call('models.account.byRequest',{requestId:marker.requestId})}
    catch(error){if(error?.message!=='NOT_FOUND')throw error}
    if(!current())return;
    result ||= await call('models.account.test',{accountModelId:item.accountModelId,
      expectedRevision:item.revision,requestId:marker.requestId});
    if(!current())return;
    if(result?.operation?.requestId!==marker.requestId||result.operation.kind!=='test')
      throw new Error('MODEL_RECEIPT_INVALID');
    if(result.operation.status==='succeeded'){
      clearAccountModelIntent('test',id,marker.requestId);
      const checked=result.operation.testResult;
      const passed=checked?.configured===true&&checked.reachable===true&&checked.modelListed===true;
      toast(passed?'目录与鉴权已核对；尚未发送推理消息':
        '连接检查已完成，但目录、鉴权或模型列表未通过；尚未发送推理消息',!passed)
    }else if(result.operation.status==='failed'){
      clearAccountModelIntent('test',id,marker.requestId);
      toast(safeError({message:result.operation.errorCode||result.operation.reasonCode||'OPERATION_FAILED'}),true)
    }else toast('连接检查仍在处理，原测试编号已保留',true)
  }catch(error){if(current())toast(safeError(error),true)}}
function modelsPage(target){target.append(heading('对话模型','手机直连模型与电脑模型分开列出；密钥不会出现在账户模型目录中。'));
  if(!state.loggedIn){target.append(notice('请登录或注册账户后选择模型。原有未绑定的模型配置会原样保留，不会自动交给新账户。'),
    action('连接账户',()=>page('connect')));return}
  const pageOwner=state.owner,pageEpoch=state.authEpoch,pageGeneration=state.generation;
  const current=()=>modelPageCurrent(pageOwner,pageEpoch,pageGeneration);
  const list=group('手机已保存模型',[]);target.append(list);const body=list.querySelector('.group-body');
  call('models.list').then(result=>{if(!current())return;clear(body);
    if(!result.models?.length)body.append(el('p','muted','尚未保存手机模型'));
    for(const item of result.models){const card=el('div','model-library-entry');
      card.append(el('strong','',`${item.displayName||item.modelId}${item.selected?' · 当前':''}`),
        el('small','',`${item.endpoint.startsWith('http://')?'本地服务':'手机直连云'} · ${item.modelId}`));
      const controls=el('div','model-library-actions');
      const use=el('button','secondary','在手机使用');use.disabled=item.selected===true;
      use.addEventListener('click',async()=>{try{const selected=await call('models.select',{endpoint:item.endpoint,modelId:item.modelId});
        if(!current())return;
        state.model=selected;$('model-label').textContent=selected.displayName||selected.modelId;
        toast('已明确切换为手机直连模型');page('models')}catch(e){if(current())toast(safeError(e),true)}});
      controls.append(use);
      if(item.endpoint.startsWith('https://')){const publish=el('button','secondary',
        savedAccountModelIntent('publish',`${item.endpoint}|${item.modelId}`)?'核对电脑配置':'在电脑使用这个模型');
        publish.addEventListener('click',()=>void publishSavedPhoneModel(item));controls.append(publish)}
      if(!item.selected){const remove=el('button','quiet','删除本机副本');remove.addEventListener('click',async()=>{
        if(remove.dataset.confirm!=='yes'){remove.dataset.confirm='yes';remove.textContent='确认删除本机副本';return}
        try{await call('models.account.removeLocal',{endpoint:item.endpoint,modelId:item.modelId});
          if(!current())return;
          toast('仅移除了这台手机的副本；账户共享配置未改变');page('models')}
        catch(error){if(current())toast(safeError(error),true)}});controls.append(remove)}
      card.append(controls);body.append(card)}
  }).catch(e=>{if(current())body.append(el('p','inline-error',safeError(e)))});
  const endpoint=field('提供方地址（/v1）','url',state.model?.endpoint||'');
  const id=field('模型 ID','text',state.model?.modelId||'');const key=field('API Key（留空保留同一地址已存密钥）','password');
  const form=group('配置自定义模型',[]);form.querySelector('.group-body').append(endpoint.box,id.box,key.box,
    action('保存并选择',async()=>{try{const selected=await call('models.configure',{endpoint:endpoint.input.value,
      modelId:id.input.value,apiKey:key.input.value});key.input.value='';if(!current())return;
      state.model=selected;$('model-label').textContent=selected.displayName||selected.modelId;
      toast('手机模型已保存');page('models')}catch(e){key.input.value='';if(current())toast(safeError(e),true)}}));target.append(form);
  if(state.model?.source==='phone')target.append(group('连接检查',[row('检查当前模型目录','只确认服务可达和模型是否列出，不发送推理消息',async()=>{
    try{const result=await call('models.verifyPhone');toast(result.modelListed?'目录中已列出当前模型；尚未测试推理':'服务可达，但目录未列出当前模型',!result.modelListed)}
    catch(e){toast(safeError(e),true)}})]));
  if(state.loggedIn){const hostGroup=group('电脑模型',[]);const hostBody=hostGroup.querySelector('.group-body');hostBody.append(el('p','muted','正在读取电脑已配置模型…'));target.append(hostGroup);
    call('models.host').then(result=>{if(!current())return;clear(hostBody);
      const models=result.models||[];if(!models.length)hostBody.append(el('p','muted','电脑当前没有可选模型'));
      for(const item of models){hostBody.append(row(`${item.displayName}${item.selected?' · 当前':''}`,
        `${item.sourceKind==='local'?'电脑本机':'电脑云端'} · ${item.configured?'已配置':'未配置'}`,async()=>{
          if(!item.configured){toast('请先在电脑上配置这个模型',true);return}
          try{const verified=await call('models.verifyHost',{profileId:item.profileId});if(!current())return;
            if(verified.available===false){toast('电脑模型暂不可用',true);return}
            const selected=await call('models.selectHost',{profileId:item.profileId});if(!current())return;
            state.model=selected;
            $('model-label').textContent=selected.displayName||selected.profileId;toast('已选择电脑模型');page('models')}
          catch(e){if(current())toast(safeError(e),true)}}))}
    }).catch(e=>{if(current()){clear(hostBody);hostBody.append(el('p','inline-error',safeError(e)))}});
    const accountGroup=group('账户云模型',[]);const accountBody=accountGroup.querySelector('.group-body');
    accountBody.append(el('p','muted','正在读取当前账户的配置…'));target.append(accountGroup);
    const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
    call('models.account.list').then(result=>{if(!modelPageCurrent(owner,epoch,generation))return;
      clear(accountBody);const models=Array.isArray(result?.models)?result.models:[];
      if(!models.length)accountBody.append(el('p','muted','当前账户尚无可取回的云模型。可从手机已保存模型明确上传，或在电脑账户页配置。'));
      for(const item of models){if(typeof item?.accountModelId!=='string'||!Number.isSafeInteger(item.revision))continue;
        const card=el('div','model-library-entry');card.append(el('strong','',item.name||item.modelId),
          el('small','',`${item.modelId} · ${{active:'账户可用',stopped:'已停止使用',pending:'配置中',failed:'配置失败'}[item.status]||'待核对'} · 修订 ${item.revision}`));
        const controls=el('div','model-library-actions');
        if(item.status==='active'){
          const transfer=el('button','secondary','保存到手机');transfer.addEventListener('click',()=>void transferAccountModel(item));
          const test=el('button','quiet',savedAccountModelIntent('test',`${item.accountModelId}:${item.revision}`)
            ?'核对连接检查':'测试连接');test.addEventListener('click',()=>void testAccountModel(item));
          controls.append(transfer,test)
        }
        const conflict=state.accountModelCredentialConflict;
        if(conflict?.owner===state.owner&&conflict.id===`${item.accountModelId}:${item.revision}`){
          card.append(el('p','model-library-warning','手机同一地址已有不同密钥。保留本机配置，或明确替换该地址所有本机模型使用的密钥；当前选择不会自动切换。'));
          const keep=el('button','quiet','保留本机密钥');keep.addEventListener('click',()=>{
            state.accountModelCredentialConflict=null;page('models')});
          const replace=el('button','secondary','替换同地址密钥');replace.addEventListener('click',()=>void transferAccountModel(item,true));
          controls.append(keep,replace)}
        card.append(controls);accountBody.append(card)}
    }).catch(error=>{if(modelPageCurrent(owner,epoch,generation)){
      clear(accountBody);accountBody.append(el('p','inline-error',safeError(error)))}})}
}
function thingsPage(target){stopTaskControlObservation();state.thingsDetail=null;state.taskReturn=null;
  if(state.taskLabelOwner!==state.owner||state.taskLabelEpoch!==state.authEpoch){
    state.taskLabels.clear();state.taskLabelOwner=state.owner;state.taskLabelEpoch=state.authEpoch}
  target.append(heading('正在做的事','这里汇总手机回合与电脑命令。命令已受理不代表回复或动作已经完成。'));
  if(!state.loggedIn){target.append(notice('请登录自己的账户后查看任务与手机回合。其他账户的记录不会在这里显示。'));return}
  if(state.busy)target.append(group('进行中',[row('手机模型正在回复','可以返回对话停止',()=>page('chat'))]));
  const loading=notice('正在读取手机与电脑的活动…');target.append(loading);
  const gen=state.generation,owner=state.owner,epoch=state.authEpoch;
  call('activity.list').then(result=>{if(state.page!=='things'||state.generation!==gen||
    state.owner!==owner||state.authEpoch!==epoch||state.thingsDetail)return;loading.remove();
    const activities=groupTaskActivities(result.activities||[]);if(!activities.length)target.append(notice('当前没有可显示的活动。手机回合与电脑任务会按当前账户分别记录。'));
    else {const entries=activities.map(item=>({item,button:row(item.source==='host'?hostActivityTitle(item):item.title,
      `${item.source==='host'?'电脑':'手机'} · ${item.source==='host'?taskActivityStatus(item):activityStatus(item.status)}${item.summary?' · '+item.summary:''}`,
      ()=>{if(item.source==='phone'&&item.conversationId)selectConversation(item.conversationId);
        else if(item.source==='host'&&item.commandId)showHostCommandDetail(item);
        else toast('这条活动没有可读取的详情',true)})}));
      target.append(group('最近活动',entries.map(entry=>entry.button)));
      void loadVisibleTaskLabels(entries,target,gen,owner,epoch)}
    if(state.loggedIn&&!result.hostAvailable)target.append(notice('电脑活动暂时无法读取；手机记录仍可查看。'));
  }).catch(e=>{if(state.page!=='things'||state.generation!==gen||state.owner!==owner||state.authEpoch!==epoch||state.thingsDetail)return;
    loading.textContent=safeError(e);loading.className='inline-error'});
}
function verifiedArtifact(item){return item?.kind==='desktop.write_artifact'&&item.status==='observed'&&
  item.verification?.status==='observed'&&!!item.artifactId}
function groupTaskActivities(activities){const byTask=new Map(),result=[];
  for(const item of activities){if(item.source!=='host'||!item.taskId&&item.kind!=='session.message'){result.push(item);continue}
    const taskId=item.rootTaskId||item.taskId||item.commandId;if(!taskId)continue;
    let task=byTask.get(taskId);if(!task){task={source:'host',kind:'session.message',commandId:taskId,taskId,
      sessionId:item.sessionId,conversationId:item.conversationId,status:'pending',children:[]};byTask.set(taskId,task);result.push(task)}
    if(item.kind==='session.message'&&!item.rootTaskId){task.status=item.status;task.sessionId=item.sessionId||task.sessionId}
    else task.children.push(item);
  }return result}
function taskActivityStatus(item){if(item.kind!=='session.message')return hostCommandStatus(item.status);
  const followUp=item.children?.find(child=>child.kind==='session.message'&&child.rootTaskId&&
    ['supplement','resume'].includes(child.taskAction));
  if(followUp)return `${followUp.taskAction==='resume'?'恢复要求':'补充'}${hostCommandStatus(followUp.status)==='已交给电脑会话'?'已送达':' · '+hostCommandStatus(followUp.status)} · 结果待核对`;
  if(item.children?.some(verifiedArtifact))return '文件已在电脑核验';
  if(item.children?.some(child=>child.kind==='desktop.write_artifact'&&child.status==='uncertain'))return '文件结果待确认';
  if(item.children?.some(child=>child.kind==='desktop.write_artifact'&&child.status==='rejected'))return '文件未完成';
  return `${hostCommandStatus(item.status)}${item.children?.some(child=>child.kind==='desktop.write_artifact')?' · 文件处理中':''}`}
function activityStatus(value){return {running:'正在回复',completed:'已结束',cancelled:'已停止',failed:'未完成',interrupted:'中断',
  pending:'待处理',dispatching:'执行中',accepted_by_dsh:'已受理',observed:'已观察',uncertain:'结果待确认',rejected:'已拒绝',tool:'手机动作'}[value]||'状态待确认'}
function hostActionLabel(kind){return {'desktop.open_app':'打开电脑应用','desktop.write_artifact':'生成文件','session.create':'新建电脑会话','session.message':'继续电脑会话','session.cancel':'停止电脑会话'}[kind]||'电脑命令'}
function hostActivityTitle(item){const session=state.sharedSessions.find(row=>row.sessionId===item.sessionId);
  const file=item.kind==='session.message'&&item.children?.find(child=>verifiedArtifact(child)&&
    typeof child.fileName==='string'&&child.fileName.trim());
  if(file)return `生成：${file.fileName.trim()}`;
  const label=item.kind==='session.message'&&state.taskLabels.get(item.taskId||item.commandId);
  if(label)return `电脑任务：${label}`;
  return item.kind==='session.message'&&session?.title?`电脑任务：${session.title}`:hostActionLabel(item.kind)}
 async function loadVisibleTaskLabels(entries,target,generation,owner,epoch){
   const current=()=>state.page==='things'&&!state.thingsDetail&&state.generation===generation&&
     state.owner===owner&&state.authEpoch===epoch&&state.taskLabelOwner===owner&&state.taskLabelEpoch===epoch;
   const candidates=entries.filter(({item})=>item.source==='host'&&item.kind==='session.message'&&
     sessionIdPattern.test(item.taskId||item.commandId||'')&&!item.children?.some(verifiedArtifact)&&
     !state.taskLabels.has(item.taskId||item.commandId)).slice(0,8);
   let next=0;
   const worker=async()=>{while(current()&&next<candidates.length){const entry=candidates[next++];
     const taskId=entry.item.taskId||entry.item.commandId;
     try{const result=await call('shared.commands.detail',{commandId:taskId});
       if(!current())return;
       const command=result?.command;
       if(command?.commandId!==taskId||command.kind!=='session.message'||command.rootTaskId||
         typeof command.taskLabel!=='string'||!command.taskLabel.trim()||command.taskLabel.length>100)continue;
       state.taskLabels.set(taskId,command.taskLabel);
       if(target.contains(entry.button))entry.button.children[0].children[0].textContent=hostActivityTitle(entry.item)
     }catch{ /* The existing title remains usable when a label is unavailable. */ }
   }};
   await Promise.all([worker(),worker()])}
function hostCommandStatus(value){return {pending:'等待电脑受理',dispatching:'正在派发',accepted_by_dsh:'已交给电脑会话',
  accepted_by_host:'电脑已受理',observed:'已观察到结果',uncertain:'结果待确认',rejected:'未受理'}[value]||'状态待确认'}
function commandTime(value){const date=new Date(value);return Number.isFinite(date.getTime())?
  new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(date):'时间待确认'}
function hostCommandMeaning(command){if(command.state==='accepted_by_dsh')return command.kind==='session.cancel'?
  '停止命令已交给电脑会话。回合是否停止，请查看原会话记录。':command.kind==='session.create'?
  '新建会话请求已由电脑受理；是否可续聊，请查看会话列表。':
  '命令已交给电脑会话。回复是否完成，请查看原会话记录。';
  if(command.state==='accepted_by_host')return '电脑已受理请求，实际结果仍待核对。';
  if(command.state==='observed')return command.verification?.status==='observed'?
    '已观察到电脑应用窗口。':'已收到观察回执；请结合原会话核对结果。';
  if(command.state==='uncertain')return '结果尚不明确；先核对电脑状态，避免重复提交。';
  if(command.state==='rejected')return '电脑未受理这条命令。';
  return {pending:'命令等待电脑受理。',dispatching:'命令正在派发到电脑。'}[command.state]||'命令状态等待核对。'}
async function openHostCommandSession(sessionId){if(!sessionId)return;
  const owner=state.owner,epoch=state.authEpoch,gen=state.generation;
  if(!state.sharedSessions.some(item=>item.sessionId===sessionId))await listSharedSessions();
  if(state.page!=='things'||state.owner!==owner||state.authEpoch!==epoch||state.generation!==gen)return;
  if(!state.sharedSessions.some(item=>item.sessionId===sessionId)){toast('原电脑会话当前不可访问，请检查连接或账户权限',true);return}
  selectSharedSession(sessionId)}
function artifactSize(value){return Number.isSafeInteger(value)&&value>=0?
  value<1024?`${value} 字节`:`${(value/1024).toFixed(1)} KiB`:'大小待确认'}
function taskControlMeaning(control){if(control?.state==='stop_requested'&&typeof control.stopStatus==='string'){
  if(control.stopStatus==='stopped')return '电脑已核对这件事的实际停止。已执行的步骤与成果会保留。';
  if(control.stopStatus==='completed')return '这件事的回合已正常结束；停止请求没有已证实的中断结果。核对成果后可写明下一步。';
  if(control.stopStatus==='cancel_requested')return '电脑已对准这件事发起取消，正在等待实际结束记录。';
  if(control.legacyStopIntent&&!control.canResume)return '旧停止记录缺少完整目标快照，结果仍待核对。请查看原会话与成果，稍后刷新任务。';
  if(control.stopStatus==='requested')return '停止请求已记录，正在核对电脑回合；目前还不能确认已停止。';
  return '停止结果仍不明确。请核对原会话与成果，稍后刷新任务；不要重复执行。'}
  if(control?.state==='stop_requested'&&control.reasonCode==='TURN_ENDED_AFTER_STOP_REQUEST'&&
  control.canResume===true)return '上一回合已结束，但尚不能确认是停止请求使它结束。请写明下一步，再恢复这件事。';
  return {active:'事情仍可继续处理；文件完成以电脑读回核验为准。',
  stop_requested:'停止意图已记录，执行端状态仍待核对。',stopped:'执行端停止已核对。',
  uncertain:'事情结果尚不明确，请先核对原会话和成果。'}[control?.state]||'任务控制状态待核对。'}
function taskStepStatus(step){if(step.state==='observed')return step.verification?.status==='observed'&&
  step.verification?.method==='visible_window'?'电脑窗口已观察':'动作状态已更新，窗口仍待核对';
  return {pending:'等待电脑受理',dispatching:'正在派发',accepted_by_host:'电脑已受理，窗口待核对',
    uncertain:'结果待确认',rejected:'未执行'}[step.state]||'状态待确认'}
function conversationTaskContext(){const conversationId=state.chatSource==='phone'?state.conversationId:null;
  return {owner:state.owner,epoch:state.authEpoch,generation:state.generation,source:state.chatSource,
    conversationId,sessionId:conversationId?selectedBinding()?.sessionId:state.sharedSessionId}}
function conversationTaskCurrent(context){const current=conversationTaskContext();return state.loggedIn&&!state.transitionPending&&
  state.page==='chat'&&context.owner===current.owner&&context.epoch===current.epoch&&context.generation===current.generation&&
  context.source===current.source&&context.sessionId===current.sessionId&&context.conversationId===current.conversationId}
const approvalIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const approvalRequestPattern=/^[A-Za-z0-9_.:-]{1,128}$/;
function approvalDeviceId(){return state.deviceId||state.profile?.device?.id||''}
function approvalContext(sessionId=conversationTaskContext().sessionId,taskId=null){return {
  ...conversationTaskContext(),sessionId,taskId,page:state.page,deviceId:approvalDeviceId()}}
function approvalViewCurrent(context){return state.loggedIn&&!state.transitionPending&&state.owner===context.owner&&
  state.authEpoch===context.epoch&&approvalDeviceId()===context.deviceId&&state.generation===context.generation&&
  state.page===context.page&&(context.page==='chat'?conversationTaskCurrent(context):
    context.page==='things'&&state.thingsDetail===context.taskId)}
function stopApprovalObservation(){clearTimeout(toolApprovals.pollTimer);toolApprovals.pollTimer=null;toolApprovals.detail=null}
function resetToolApprovals(){stopApprovalObservation();toolApprovals.owner=null;toolApprovals.epoch=-1;toolApprovals.deviceId=null;
  toolApprovals.sessions.clear();toolApprovals.attempts.clear();toolApprovals.inFlight.clear()}
function approvalScopeCurrent(context){return toolApprovals.owner===context.owner&&toolApprovals.epoch===context.epoch&&
  toolApprovals.deviceId===context.deviceId}
function approvalCache(context){if(!approvalScopeCurrent(context)){resetToolApprovals();
    toolApprovals.owner=context.owner;toolApprovals.epoch=context.epoch;toolApprovals.deviceId=context.deviceId}
  let cache=toolApprovals.sessions.get(context.sessionId);if(!cache){cache={rows:new Map(),loaded:false,error:''};
    toolApprovals.sessions.set(context.sessionId,cache)}return cache}
function normalizedApproval(item){if(!item||!approvalIdPattern.test(item.approvalId||'')||
    ![item.sessionId,item.taskId,item.sourceCommandId].every(id=>sessionIdPattern.test(id||''))||
    !receiptIdPattern.test(item.sourceReceiptId||'')||!approvalRequestPattern.test(item.callId||'')||
    !approvalRequestPattern.test(item.rootCallId||'')||!Number.isSafeInteger(item.turn)||item.turn<1||
    typeof item.toolName!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(item.toolName)||
    typeof item.reason!=='string'||item.reason.length>1000||typeof item.createdAt!=='string'||
    !Number.isFinite(Date.parse(item.createdAt))||!['pending','answered','resolved','unavailable'].includes(item.status))return null;
  const decision=['allowed-once','rejected'].includes(item.decisionOutcome)&&approvalRequestPattern.test(item.decisionRequestId||'')&&
    typeof item.answeredAt==='string'&&Number.isFinite(Date.parse(item.answeredAt));
  if(item.status==='pending'&&(item.decisionOutcome!==undefined||item.decisionRequestId!==undefined||item.answeredAt!==undefined||
      item.outcome!==undefined||item.resolvedAt!==undefined)||item.status==='answered'&&(!decision||item.outcome!==undefined||item.resolvedAt!==undefined)||
    item.status==='resolved'&&(!['allowed-once','rejected','cancelled','unavailable'].includes(item.outcome)||
      typeof item.resolvedAt!=='string'||!Number.isFinite(Date.parse(item.resolvedAt))||
      ['allowed-once','rejected'].includes(item.outcome)&&(!decision||item.decisionOutcome!==item.outcome))||
    item.status==='unavailable'&&!['cancelled','unavailable'].includes(item.outcome))return null;
  const fields=['approvalId','sessionId','taskId','sourceCommandId','sourceReceiptId','turn','callId','rootCallId',
    'toolName','reason','createdAt','status','decisionOutcome','decisionRequestId','answeredAt','outcome','resolvedAt'];
  return Object.fromEntries(fields.filter(key=>item[key]!==undefined).map(key=>[key,item[key]]))}
function approvalIdentity(row){return JSON.stringify([row.approvalId,row.sessionId,row.taskId,row.sourceCommandId,
  row.sourceReceiptId,row.turn,row.callId,row.rootCallId,row.toolName,row.createdAt])}
function approvalTerminal(row){return row?.status==='resolved'||row?.status==='unavailable'}
function mergedApproval(previous,row){if(!previous)return row;
  if(approvalIdentity(previous)!==approvalIdentity(row))throw new Error('APPROVAL_RECEIPT_INVALID');
  return approvalTerminal(previous)||previous.status==='answered'&&row.status==='pending'?previous:row}
function approvalMarkerKey(context,row){return `weftmate-approval:${context.owner}:${context.deviceId}:${row.sessionId}:${row.approvalId}`}
function approvalAttempt(context,row){const key=`${row.sessionId}/${row.approvalId}`;
  let attempt=toolApprovals.attempts.get(key);if(attempt)return attempt.identity===approvalIdentity(row)?attempt:null;
  try{const saved=JSON.parse(localStorage.getItem(approvalMarkerKey(context,row))||'null');
    if(saved?.identity===approvalIdentity(row)&&approvalRequestPattern.test(saved.requestId||'')&&
      ['allowed-once','rejected'].includes(saved.outcome)){
      attempt={...saved,unknown:true,checked:false,busy:false};toolApprovals.attempts.set(key,attempt);return attempt}}
  catch{}return null}
function saveApprovalAttempt(context,row,attempt){try{localStorage.setItem(approvalMarkerKey(context,row),JSON.stringify({
  identity:attempt.identity,requestId:attempt.requestId,outcome:attempt.outcome}))}catch{}}
function clearApprovalAttempt(context,row){toolApprovals.attempts.delete(`${row.sessionId}/${row.approvalId}`);
  try{localStorage.removeItem(approvalMarkerKey(context,row))}catch{}}
function relatedTaskApproval(task,row){if(task?.taskId!==row.taskId||task.sessionId!==row.sessionId||
    task.source?.commandId!==task.taskId||task.source.kind!=='session.message'||task.source.rootTaskId||
    task.source.sessionId!==task.sessionId)return false;
  const commands=[task.source,...(Array.isArray(task.supplements)?task.supplements:[]),...(Array.isArray(task.resumes)?task.resumes:[])];
  return commands.some(command=>command?.kind==='session.message'&&command.sessionId===row.sessionId&&
    (command.commandId===task.taskId&&!command.rootTaskId||command.rootTaskId===task.taskId)&&
    command.commandId===row.sourceCommandId&&command.receiptId===row.sourceReceiptId)}
function taskApprovals(task,context){if(!approvalScopeCurrent(context))return [];
  return [...(toolApprovals.sessions.get(context.sessionId)?.rows.values()||[])].filter(row=>relatedTaskApproval(task,row))}
function approvalOperation(row){return {pwsh:'运行命令',read:'读取文件',write:'写入文件',edit:'修改文件',glob:'查找文件',grep:'搜索内容',
  weftmod:'设备操作',weftmod_script:'运行脚本',job_kill:'停止后台任务'}[row.toolName]||row.toolName}
function approvalMeaning(row,cache,attempt){if(attempt?.busy)return '正在提交决定并核对审批状态…';
  if(row.status==='pending')return cache.error?'连接中断，审批状态待更新。请先检查状态。':attempt?.unknown?
    attempt.checked?'上次决定尚未登记，可以重试同一请求。':'上次决定的回执尚不明确，请先检查状态。':'等待你决定是否执行这项操作。';
  if(row.status==='answered')return `已登记“${row.decisionOutcome==='allowed-once'?'允许本次':'拒绝'}”，等待执行端处理。${cache.error?' 连接中断，处理状态待更新。':''}`;
  if(row.outcome==='cancelled')return '任务已停止，此次审批不再可用。';
  if(row.outcome==='unavailable')return '此次审批已失效，请核对原任务。';
  return row.outcome==='allowed-once'?'执行端已处理本次允许；任务结果仍以执行记录为准。':'执行端已处理本次拒绝。'}
function fillApprovalCard(card,row,context,cache){const attempt=approvalAttempt(context,row);
  const signature=JSON.stringify([row,cache.error,attempt?.busy,attempt?.unknown,attempt?.checked]);if(card.dataset.signature===signature)return;
  const focused=document.activeElement,focusChoice=focused?.dataset?.approvalChoice;
  const hadFocus=focusChoice&&focused.parent===card.querySelector('.approval-actions')||focused?.closest?.('.tool-approval')===card;
  card.dataset.signature=signature;clear(card);card.dataset.approvalId=row.approvalId;card.dataset.taskId=row.taskId;
  card.append(el('strong','approval-title',`${row.status==='pending'?'需要审批':'审批记录'} · ${approvalOperation(row)}`));
  if(row.reason)card.append(el('p','approval-reason',row.reason));
  const message=el('p','approval-status',approvalMeaning(row,cache,attempt));message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  card.append(message);
  if(row.status==='pending'||row.status==='answered'&&cache.error){const controls=el('div','approval-actions');
    const add=(label,choice,handler,primary=false)=>{const button=el('button',primary?'primary':'secondary',label);button.type='button';
      button.dataset.approvalChoice=choice;button.disabled=!!attempt?.busy;
      button.addEventListener('pointerdown',()=>{button.dataset.restoreFocus=document.activeElement===$('draft')?'1':'0'});
      button.addEventListener('pointercancel',()=>{delete button.dataset.restoreFocus});
      button.addEventListener('click',()=>{const restoreFocus=button.dataset.restoreFocus==='1';delete button.dataset.restoreFocus;
        if(approvalViewCurrent(context))void handler(restoreFocus)});controls.append(button)};
    if(row.status==='pending'&&!cache.error&&(!attempt?.unknown||attempt.checked)){
      if(attempt?.unknown)add(attempt.outcome==='allowed-once'?'重试允许本次':'重试拒绝',attempt.outcome,
        restoreFocus=>decideToolApproval(row,attempt.outcome,context,restoreFocus),attempt.outcome==='allowed-once');
      else{add('允许本次','allowed-once',restoreFocus=>decideToolApproval(row,'allowed-once',context,restoreFocus),true);
        add('拒绝','rejected',restoreFocus=>decideToolApproval(row,'rejected',context,restoreFocus))}}
    if(cache.error||attempt?.unknown)add('检查审批状态','check',()=>refreshToolApprovals(context,{force:true}));
    card.append(controls);
    if(hadFocus){const next=[...controls.children].find(button=>button.dataset.approvalChoice===focusChoice);next?.focus({preventScroll:true})}}
  else if(hadFocus){message.setAttribute('tabindex','-1');message.focus({preventScroll:true})}}
function renderConversationApprovals(){const context=approvalContext(),content=$('chat-content');
  if(!approvalViewCurrent(context)||!approvalScopeCurrent(context))return;
  const cache=toolApprovals.sessions.get(context.sessionId);if(!cache)return;
  const scroll=$('chat-scroll'),scrollTop=scroll.scrollTop,visible=new Set();
  for(const row of [...cache.rows.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.approvalId.localeCompare(b.approvalId))){
    const task=conversationTasks.entries.get(row.taskId)?.task;
    if(!relatedTaskApproval(task,row))continue;
    const anchor=[...content.children].find(node=>node.dataset?.receiptId===row.sourceReceiptId);if(!anchor)continue;
    visible.add(row.approvalId);let card=[...content.children].find(node=>node.dataset?.approvalId===row.approvalId);
    if(!card)card=el('section','tool-approval conversation-approval');
    let next=anchor.nextSibling;while(next&&(next.dataset?.conversationTask||next.dataset?.approvalId&&next.dataset.approvalId!==row.approvalId))next=next.nextSibling;
    if(card!==next)content.insertBefore(card,next);fillApprovalCard(card,row,context,cache)}
  for(const node of [...content.children])if(node.dataset?.approvalId&&!visible.has(node.dataset.approvalId))node.remove();
  if(state.scrollPinned)scrollBottom();else if(scroll.scrollTop!==scrollTop)scroll.scrollTop=scrollTop}
function renderApprovalView(context){if(!approvalViewCurrent(context))return;
  if(context.page==='chat'){renderConversationApprovals();return}
  const detail=toolApprovals.detail;if(!detail||detail.context!==context)return;
  const cache=toolApprovals.sessions.get(context.sessionId),rows=taskApprovals(detail.task,context);detail.section.hidden=!rows.length;
  const body=detail.section.querySelector('.group-body');
  for(const child of [...body.children])if(!rows.some(row=>row.approvalId===child.dataset?.approvalId))child.remove();
  for(const row of rows){let card=[...body.children].find(node=>node.dataset?.approvalId===row.approvalId);
    if(!card){card=el('section','tool-approval task-approval');body.append(card)}fillApprovalCard(card,row,context,cache)}}
function scheduleApprovalObservation(context){clearTimeout(toolApprovals.pollTimer);toolApprovals.pollTimer=null;
  if(context.page!=='things'||!approvalViewCurrent(context)||document.visibilityState==='hidden'||
    !taskApprovals(toolApprovals.detail?.task,context).some(row=>['pending','answered'].includes(row.status)))return;
  toolApprovals.pollTimer=setTimeout(()=>{toolApprovals.pollTimer=null;if(approvalViewCurrent(context))void refreshToolApprovals(context)},3000)}
async function refreshToolApprovals(context=approvalContext(),{force=false}={}){
  if(!approvalViewCurrent(context)||!sessionIdPattern.test(context.sessionId||''))return false;
  const cache=approvalCache(context),key=JSON.stringify(context),prior=toolApprovals.inFlight.get(key);
  if(prior){if(!force)return prior.promise;await prior.promise;if(!approvalViewCurrent(context))return false}
  const run=async()=>{try{let before,more=true;const rows=new Map(),cursors=new Set();
      while(more){const result=await call('shared.approvals.list',{sessionId:context.sessionId,...(before?{before}:{})});
        if(!approvalViewCurrent(context))return false;
        if(!Array.isArray(result?.approvals)||typeof result.hasMore!=='boolean'||result.approvals.length>50||
          result.hasMore&&(!approvalIdPattern.test(result.nextBefore||'')||!result.approvals.length||
            result.nextBefore!==result.approvals.at(-1)?.approvalId||cursors.has(result.nextBefore))||
          !result.hasMore&&result.nextBefore!==null)throw new Error('APPROVAL_RECEIPT_INVALID');
        for(const item of result.approvals){const row=normalizedApproval(item);if(!row||row.sessionId!==context.sessionId||rows.has(row.approvalId))
            throw new Error('APPROVAL_RECEIPT_INVALID');rows.set(row.approvalId,row)}
        more=result.hasMore;before=result.nextBefore;if(more)cursors.add(before)}
      const next=new Map([...rows].map(([id,row])=>[id,mergedApproval(cache.rows.get(id),row)]));
      cache.rows=next;cache.loaded=true;cache.error='';
      for(const row of next.values()){const attempt=approvalAttempt(context,row);
        if(row.status==='pending'){if(attempt)attempt.checked=true}else clearApprovalAttempt(context,row)}
      if(context.page==='chat'){
        for(const taskId of new Set([...next.values()].filter(row=>['pending','answered'].includes(row.status)).map(row=>row.taskId))){
          if(conversationTasks.entries.get(taskId)?.task)continue;
          const task=await call('shared.tasks.detail',{taskId});if(!approvalViewCurrent(context))return false;
          if(task?.taskId!==taskId||task.sessionId!==context.sessionId||task.source?.commandId!==taskId||
            task.source.kind!=='session.message'||task.source.rootTaskId||task.source.sessionId!==context.sessionId||
            task.conversationId&&task.conversationId!==context.conversationId)throw new Error('APPROVAL_RECEIPT_INVALID');
          conversationTasks.owner=context.owner;conversationTasks.epoch=context.epoch;
          conversationTasks.entries.set(taskId,{taskId,sessionId:context.sessionId,conversationId:task.conversationId,
            receiptId:task.source.receiptId,task,notice:''})}}
      renderApprovalView(context);return true
    }catch(e){if(approvalViewCurrent(context)){cache.error=safeError(e);renderApprovalView(context)}return false}
    finally{if(approvalViewCurrent(context))scheduleApprovalObservation(context)}};
  const promise=run();toolApprovals.inFlight.set(key,{promise});try{return await promise}
  finally{if(toolApprovals.inFlight.get(key)?.promise===promise)toolApprovals.inFlight.delete(key)}}
async function decideToolApproval(row,outcome,context=approvalContext(),restoreFocus=false){
  if(!approvalViewCurrent(context)||!approvalScopeCurrent(context)||!['allowed-once','rejected'].includes(outcome))return;
  const cache=toolApprovals.sessions.get(row.sessionId),current=cache?.rows.get(row.approvalId);
  if(!current||approvalIdentity(current)!==approvalIdentity(row)||current.status!=='pending'||cache.error)return;
  let attempt=approvalAttempt(context,row);if(attempt?.busy)return;
  if(attempt?.unknown&&(!attempt.checked||attempt.outcome!==outcome)){void refreshToolApprovals(context,{force:true});return}
  attempt ||= {identity:approvalIdentity(row),requestId:newSharedRequestId(),outcome};
  attempt.busy=true;attempt.unknown=true;attempt.checked=false;toolApprovals.attempts.set(`${row.sessionId}/${row.approvalId}`,attempt);
  saveApprovalAttempt(context,row,attempt);renderApprovalView(context);
  try{const result=await call('shared.approvals.decide',{sessionId:row.sessionId,approvalId:row.approvalId,
      requestId:attempt.requestId,outcome:attempt.outcome});if(!approvalViewCurrent(context))return;
    const received=normalizedApproval(result?.approval);
    if(result?.requestId!==attempt.requestId||!received||approvalIdentity(received)!==approvalIdentity(row)||
      received.status!=='answered'||received.decisionRequestId!==attempt.requestId||received.decisionOutcome!==attempt.outcome)
      throw new Error('APPROVAL_RECEIPT_INVALID');
    cache.rows.set(row.approvalId,mergedApproval(cache.rows.get(row.approvalId),received));renderApprovalView(context)
  }catch(e){if(!approvalViewCurrent(context))return;toast(e?.message==='TIMEOUT'||e?.message==='RECEIPT_TIMEOUT'?
      '决定回执尚不明确，正在检查审批状态':safeError(e),true)}
  finally{if(approvalViewCurrent(context)){await refreshToolApprovals(context,{force:true});attempt.busy=false;renderApprovalView(context);
      if(restoreFocus&&context.page==='chat')$('draft').focus({preventScroll:true})}else attempt.busy=false}}
function stopQuestionObservation(){clearTimeout(toolQuestions.pollTimer);toolQuestions.pollTimer=null;toolQuestions.detail=null}
function resetToolQuestions(){stopQuestionObservation();toolQuestions.owner=null;toolQuestions.epoch=-1;toolQuestions.deviceId=null;
  toolQuestions.sessions.clear();toolQuestions.attempts.clear();toolQuestions.drafts.clear();toolQuestions.inFlight.clear()}
function questionScopeCurrent(context){return toolQuestions.owner===context.owner&&toolQuestions.epoch===context.epoch&&toolQuestions.deviceId===context.deviceId}
function questionCache(context){if(!questionScopeCurrent(context)){resetToolQuestions();toolQuestions.owner=context.owner;
    toolQuestions.epoch=context.epoch;toolQuestions.deviceId=context.deviceId}
  let cache=toolQuestions.sessions.get(context.sessionId);if(!cache){cache={rows:new Map(),error:''};toolQuestions.sessions.set(context.sessionId,cache)}return cache}
function canonicalQuestionAnswer(answer,questions){if(!answer||!Array.isArray(answer.answers)||answer.answers.length!==questions.length)return null;
  const answers=[];for(let i=0;i<questions.length;i++){const item=answer.answers[i],question=questions[i];
    if(!item||item.id!==question.id||!Array.isArray(item.selected)||item.selected.some(label=>typeof label!=='string')||
      new Set(item.selected).size!==item.selected.length||item.selected.some(label=>!(question.options||[]).some(option=>option.label===label))||
      item.custom!==undefined&&(typeof item.custom!=='string'||!item.custom.trim())||
      question.multiSelect!==true&&(item.selected.length>1||item.custom!==undefined&&item.selected.length>0))return null;
    answers.push({id:question.id,selected:[...item.selected],...(item.custom!==undefined?{custom:item.custom}:{})})}
  return {answers}}
function normalizedQuestionBatch(item){if(!item||!approvalIdPattern.test(item.questionRpcId||'')||
    ![item.sessionId,item.taskId,item.sourceCommandId].every(id=>sessionIdPattern.test(id||''))||
    !receiptIdPattern.test(item.sourceReceiptId||'')||!Number.isSafeInteger(item.turn)||item.turn<1||
    typeof item.createdAt!=='string'||!Number.isFinite(Date.parse(item.createdAt))||
    !['pending','answered','resolved','unavailable'].includes(item.status)||!Array.isArray(item.questions)||!item.questions.length)return null;
  const questions=[];for(const q of item.questions){if(!q||typeof q.id!=='string'||typeof q.question!=='string'||
      ['header','detail'].some(key=>q[key]!==undefined&&typeof q[key]!=='string')||q.multiSelect!==undefined&&typeof q.multiSelect!=='boolean'||
      q.options!==undefined&&(!Array.isArray(q.options)||q.options.some(option=>!option||typeof option.label!=='string'||
        option.description!==undefined&&typeof option.description!=='string'))||q.intent!==undefined&&(!q.intent||q.intent.kind!=='plan-review'||
        typeof q.intent.approve!=='string'||q.detail===undefined||!(q.options||[]).some(option=>option.label===q.intent.approve)))return null;
    questions.push({id:q.id,question:q.question,...(q.header!==undefined?{header:q.header}:{}),...(q.detail!==undefined?{detail:q.detail}:{}),
      ...(q.options!==undefined?{options:q.options.map(option=>({label:option.label,...(option.description!==undefined?{description:option.description}:{})}))}:{}),
      ...(q.multiSelect!==undefined?{multiSelect:q.multiSelect}:{}),...(q.intent!==undefined?{intent:{kind:q.intent.kind,approve:q.intent.approve}}:{})})}
  const hasAnswer=[item.answer,item.answerRequestId,item.answeredAt].some(value=>value!==undefined),answer=hasAnswer?canonicalQuestionAnswer(item.answer,questions):null;
  if(hasAnswer&&(!answer||!approvalRequestPattern.test(item.answerRequestId||'')||typeof item.answeredAt!=='string'||!Number.isFinite(Date.parse(item.answeredAt)))||
    item.status==='pending'&&hasAnswer||item.status==='answered'&&!hasAnswer||
    item.status==='resolved'&&(!['answered','cancelled'].includes(item.outcome)||typeof item.resolvedAt!=='string'||!Number.isFinite(Date.parse(item.resolvedAt)))||
    item.status==='unavailable'&&(typeof item.reasonCode!=='string'||typeof item.unavailableAt!=='string'||!Number.isFinite(Date.parse(item.unavailableAt)))||
    item.answerAcceptedAt!==undefined&&(!answer||typeof item.answerAcceptedAt!=='string'||!Number.isFinite(Date.parse(item.answerAcceptedAt))))return null;
  const fields=['questionRpcId','sessionId','taskId','sourceCommandId','sourceReceiptId','turn','createdAt','status','answerRequestId',
    'answeredAt','outcome','resolvedAt','answerAcceptedAt','reasonCode','unavailableAt'];
  return {...Object.fromEntries(fields.filter(key=>item[key]!==undefined).map(key=>[key,item[key]])),questions,...(answer?{answer}:{})}}
function questionIdentity(row){return JSON.stringify([row.questionRpcId,row.sessionId,row.taskId,row.sourceCommandId,row.sourceReceiptId,row.turn,row.questions,row.createdAt])}
function mergedQuestion(previous,row,{receipt=false}={}){if(!previous)return row;
  if(questionIdentity(previous)!==questionIdentity(row))throw new Error('QUESTION_RECEIPT_INVALID');
  if(receipt&&approvalTerminal(previous)||previous.status==='resolved'&&row.status!=='resolved'||
    previous.status==='unavailable'&&['pending','answered'].includes(row.status)||previous.status==='answered'&&row.status==='pending'||
    previous.answerAcceptedAt&&!row.answerAcceptedAt)return previous;return row}
function questionStorageKey(context,row,kind){return `weftmate-question-${kind}:${context.owner}:${context.deviceId}:${row.sessionId}:${row.questionRpcId}`}
function questionAttempt(context,row){const key=`${row.sessionId}/${row.questionRpcId}`;let attempt=toolQuestions.attempts.get(key);
  if(attempt)return attempt.identity===questionIdentity(row)?attempt:null;
  try{const saved=JSON.parse(localStorage.getItem(questionStorageKey(context,row,'request'))||'null');
    if(saved?.identity===questionIdentity(row)&&approvalRequestPattern.test(saved.requestId||'')&&canonicalQuestionAnswer(saved.answer,row.questions)){
      attempt={...saved,unknown:true,checked:false,busy:false};toolQuestions.attempts.set(key,attempt);return attempt}}
  catch{}return null}
function saveQuestionAttempt(context,row,attempt){try{localStorage.setItem(questionStorageKey(context,row,'request'),JSON.stringify({
  identity:attempt.identity,requestId:attempt.requestId,answer:attempt.answer}))}catch{}}
function clearQuestionAttempt(context,row){toolQuestions.attempts.delete(`${row.sessionId}/${row.questionRpcId}`);
  try{localStorage.removeItem(questionStorageKey(context,row,'request'))}catch{}}
function questionDraft(context,row){const key=`${row.sessionId}/${row.questionRpcId}`;let draft=toolQuestions.drafts.get(key);
  if(draft?.identity===questionIdentity(row))return draft;
  try{const saved=JSON.parse(localStorage.getItem(questionStorageKey(context,row,'draft'))||'null');
    if(saved?.identity===questionIdentity(row)&&Array.isArray(saved.answers)&&saved.answers.length===row.questions.length&&
      saved.answers.every((answer,index)=>answer?.id===row.questions[index].id&&Array.isArray(answer.selected)&&
        answer.selected.every(label=>typeof label==='string')&&typeof answer.custom==='string'))draft=saved}catch{}
  draft ||= {identity:questionIdentity(row),answers:row.questions.map(q=>({id:q.id,selected:[],custom:''}))};
  toolQuestions.drafts.set(key,draft);return draft}
function saveQuestionDraft(context,row,draft){try{localStorage.setItem(questionStorageKey(context,row,'draft'),JSON.stringify(draft))}catch{}}
function taskQuestions(task,context){if(!questionScopeCurrent(context))return [];
  return [...(toolQuestions.sessions.get(context.sessionId)?.rows.values()||[])].filter(row=>relatedTaskApproval(task,row))}
function questionMeaning(row,cache,attempt){if(attempt?.busy)return '正在提交回答并核对接收状态…';
  if(row.answerAcceptedAt)return '执行端已确认接收这份回答。';
  if(row.status==='pending')return cache.error?'当前问题状态暂时无法核对，填写内容仍保留。请先检查状态。':attempt?.unknown?
    attempt.checked?'上次回答尚未登记，可以重试原回答。':'上次回答回执尚不明确，请先检查状态。':'请按问题选择或填写回答。';
  if(row.status==='answered')return `回答已登记，等待执行端确认。${cache.error?' 当前连接中断，可稍后检查状态。':''}`;
  if(row.status==='resolved')return row.outcome==='cancelled'?'任务已停止，这个问题不再等待回答。':
    row.answer?'问题已在执行端回答；这份登记回答是否被接收尚未确认。':'问题已在执行端回答。';
  return '这个问题当前已失效，原任务记录仍可查看。'}
function fillQuestionCard(card,row,context,cache){const attempt=questionAttempt(context,row),draft=questionDraft(context,row);
  const signature=JSON.stringify([row,cache.error,attempt?.busy,attempt?.unknown,attempt?.checked]);if(card.dataset.signature===signature)return;
  const focused=document.activeElement,focusedIndex=focused?.dataset?.questionIndex,focusedField=focused?.dataset?.questionField;
  let focusedParent=focused;while(focusedParent&&focusedParent!==card)focusedParent=focusedParent.parentElement||focusedParent.parent;
  const ownsFocus=focusedParent===card;
  card.dataset.signature=signature;clear(card);card.dataset.questionRpcId=row.questionRpcId;card.dataset.taskId=row.taskId;
  card.append(el('strong','question-title',row.status==='pending'?'需要你的回答':'问题与回答'));
  const message=el('p','question-status',questionMeaning(row,cache,attempt));message.setAttribute('role','status');message.setAttribute('aria-live','polite');card.append(message);
  const form=el('form','question-form'),editable=row.status==='pending'&&!attempt?.unknown&&!attempt?.busy&&!cache.error;
  const shownAnswer=row.answer||attempt?.answer,fields=[];
  row.questions.forEach((question,index)=>{const field=el('fieldset','question-field');field.disabled=!editable;
    field.append(el('legend','',question.header||question.question));
    if(question.header&&question.header!==question.question)field.append(el('p','question-copy',question.question));
    if(question.detail!==undefined){const detail=el('details','question-detail'),summary=el('summary','',question.intent?.kind==='plan-review'?'查看计划':'查看补充说明');
      detail.append(summary,el('div','question-detail-text',question.detail));field.append(detail)}
    if(row.status!=='pending'||attempt?.unknown){const answer=shownAnswer?.answers[index];
      if(answer){for(const label of answer.selected)field.append(el('p','question-answer',label));
        if(answer.custom!==undefined)field.append(el('p','question-answer',answer.custom));
        if(!answer.selected.length&&answer.custom===undefined)field.append(el('p','question-answer','未作选择'))}
      else field.append(el('p','question-answer','此入口未登记回答'));form.append(field);return}
    const entry=draft.answers[index],choices=[];
    for(const option of question.options||[]){const label=el('label','question-option'),input=el('input');input.type=question.multiSelect===true?'checkbox':'radio';
      input.name=`question-${context.page}-${row.questionRpcId}-${index}`;input.value=option.label;input.checked=entry.selected.includes(option.label);
      input.dataset.questionIndex=String(index);input.dataset.questionField='choice';const text=el('span','question-option-copy');text.append(el('span','',option.label));
      if(option.description!==undefined)text.append(el('small','',option.description));label.append(input,text);field.append(label);choices.push(input);
      input.addEventListener('change',()=>{if(!editable||!approvalViewCurrent(context))return;
        if(question.multiSelect===true){const selected=new Set(entry.selected);input.checked?selected.add(option.label):selected.delete(option.label);entry.selected=[...selected]}
        else if(input.checked){entry.selected=[option.label];entry.custom='';custom.value='';for(const other of choices)other.checked=other.value===option.label}
        saveQuestionDraft(context,row,draft)})}
    const customLabel=el('label','question-custom-label',(question.options||[]).length?'自行填写':'你的回答'),custom=el('textarea','question-custom');
    custom.value=entry.custom;custom.rows=2;custom.dataset.questionIndex=String(index);custom.dataset.questionField='custom';
    custom.setAttribute('aria-label',`${question.header||question.question} · ${(question.options||[]).length?'自行填写':'你的回答'}`);
    custom.addEventListener('input',()=>{if(!editable||!approvalViewCurrent(context))return;entry.custom=custom.value;
      if(question.multiSelect!==true&&custom.value.length){entry.selected=[];for(const input of choices)input.checked=false}saveQuestionDraft(context,row,draft)});
    customLabel.append(custom);field.append(customLabel);fields.push(custom);form.append(field)});
  const error=el('p','question-error');error.hidden=true;error.setAttribute('role','alert');form.append(error);
  const controls=el('div','question-actions');
  if(row.status==='pending'&&(editable||attempt?.unknown&&attempt.checked&&!cache.error)){
    const submit=el('button','primary',attempt?.unknown?'重试原回答':'提交回答');submit.type='submit';submit.disabled=!!attempt?.busy;
    submit.addEventListener('pointerdown',()=>{submit.dataset.restoreFocus=document.activeElement===$('draft')?'1':'0'});
    submit.addEventListener('pointercancel',()=>{delete submit.dataset.restoreFocus});controls.append(submit);
    form.addEventListener('submit',event=>{event.preventDefault?.();if(!approvalViewCurrent(context)||attempt?.busy)return;
      const answer=attempt?.unknown?attempt.answer:canonicalQuestionAnswer({answers:draft.answers.map(item=>({id:item.id,selected:[...item.selected],
        ...(item.custom.length?{custom:item.custom}:{})}))},row.questions);
      if(!answer){error.hidden=false;error.textContent=safeError(new Error('QUESTION_ANSWER_INVALID'));return}
      const restoreFocus=submit.dataset.restoreFocus==='1';delete submit.dataset.restoreFocus;void answerToolQuestion(row,answer,context,restoreFocus)})}
  if(cache.error||attempt?.unknown||row.status==='answered'){
    const check=el('button','secondary','检查问题状态');check.type='button';check.disabled=!!attempt?.busy;
    check.addEventListener('click',()=>{if(approvalViewCurrent(context))void refreshToolQuestions(context,{force:true})});controls.append(check)}
  if(controls.children.length)form.append(controls);card.append(form);
  if(ownsFocus&&focusedField==='custom'){const next=fields.find(input=>input.dataset.questionIndex===focusedIndex);if(next&&!next.disabled&&editable)next.focus({preventScroll:true})}}
function renderConversationQuestions(){const context=approvalContext(),content=$('chat-content');if(!approvalViewCurrent(context)||!questionScopeCurrent(context))return;
  const cache=toolQuestions.sessions.get(context.sessionId);if(!cache)return;const scroll=$('chat-scroll'),scrollTop=scroll.scrollTop,visible=new Set();
  for(const row of [...cache.rows.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.questionRpcId.localeCompare(b.questionRpcId))){
    if(!relatedTaskApproval(conversationTasks.entries.get(row.taskId)?.task,row))continue;
    const anchor=[...content.children].find(node=>node.dataset?.receiptId===row.sourceReceiptId);if(!anchor)continue;
    visible.add(row.questionRpcId);let card=[...content.children].find(node=>node.dataset?.questionRpcId===row.questionRpcId);
    if(!card)card=el('section','tool-question conversation-question');let next=anchor.nextSibling;
    while(next&&(next.dataset?.conversationTask||next.dataset?.approvalId||next.dataset?.questionRpcId&&next.dataset.questionRpcId!==row.questionRpcId))next=next.nextSibling;
    if(card!==next)content.insertBefore(card,next);fillQuestionCard(card,row,context,cache)}
  for(const child of [...content.children])if(child.dataset?.questionRpcId&&!visible.has(child.dataset.questionRpcId))child.remove();
  if(state.scrollPinned)scrollBottom();else if(scroll.scrollTop!==scrollTop)scroll.scrollTop=scrollTop}
function renderQuestionView(context){if(!approvalViewCurrent(context))return;if(context.page==='chat'){renderConversationQuestions();return}
  const detail=toolQuestions.detail;if(!detail||detail.context!==context)return;const cache=toolQuestions.sessions.get(context.sessionId),rows=taskQuestions(detail.task,context);
  detail.section.hidden=!rows.length;const body=detail.section.querySelector('.group-body');
  for(const child of [...body.children])if(!rows.some(row=>row.questionRpcId===child.dataset?.questionRpcId))child.remove();
  for(const row of rows){let card=[...body.children].find(node=>node.dataset?.questionRpcId===row.questionRpcId);
    if(!card){card=el('section','tool-question task-question');body.append(card)}fillQuestionCard(card,row,context,cache)}}
function scheduleQuestionObservation(context){clearTimeout(toolQuestions.pollTimer);toolQuestions.pollTimer=null;
  if(context.page!=='things'||!approvalViewCurrent(context)||document.visibilityState==='hidden'||
    !taskQuestions(toolQuestions.detail?.task,context).some(row=>['pending','answered'].includes(row.status)))return;
  toolQuestions.pollTimer=setTimeout(()=>{toolQuestions.pollTimer=null;if(approvalViewCurrent(context))void refreshToolQuestions(context)},3000)}
async function refreshToolQuestions(context=approvalContext(),{force=false}={}){
  if(!approvalViewCurrent(context)||!sessionIdPattern.test(context.sessionId||''))return false;
  const cache=questionCache(context),key=JSON.stringify(context),prior=toolQuestions.inFlight.get(key);
  if(prior){if(!force)return prior.promise;await prior.promise;if(!approvalViewCurrent(context))return false}
  const run=async()=>{try{let before,more=true;const rows=new Map(),cursors=new Set();
      while(more){const result=await call('shared.questions.list',{sessionId:context.sessionId,...(before?{before}:{})});if(!approvalViewCurrent(context))return false;
        if(!Array.isArray(result?.questions)||typeof result.hasMore!=='boolean'||result.questions.length>50||
          result.hasMore&&(!approvalIdPattern.test(result.nextBefore||'')||!result.questions.length||result.nextBefore!==result.questions.at(-1)?.questionRpcId||cursors.has(result.nextBefore))||
          !result.hasMore&&result.nextBefore!==null)throw new Error('QUESTION_RECEIPT_INVALID');
        for(const item of result.questions){const row=normalizedQuestionBatch(item);if(!row||row.sessionId!==context.sessionId||rows.has(row.questionRpcId))
            throw new Error('QUESTION_RECEIPT_INVALID');rows.set(row.questionRpcId,row)}more=result.hasMore;before=result.nextBefore;if(more)cursors.add(before)}
      cache.rows=new Map([...rows].map(([id,row])=>[id,mergedQuestion(cache.rows.get(id),row)]));cache.error='';
      for(const row of cache.rows.values()){const attempt=questionAttempt(context,row);
        if(row.status==='pending'){if(attempt)attempt.checked=true}else clearQuestionAttempt(context,row)}
      if(context.page==='chat')for(const taskId of new Set([...cache.rows.values()].filter(row=>['pending','answered'].includes(row.status)).map(row=>row.taskId))){
        if(conversationTasks.entries.get(taskId)?.task)continue;const task=await call('shared.tasks.detail',{taskId});if(!approvalViewCurrent(context))return false;
        if(task?.taskId!==taskId||task.sessionId!==context.sessionId||task.source?.commandId!==taskId||task.source.kind!=='session.message'||
          task.source.rootTaskId||task.source.sessionId!==context.sessionId||task.conversationId&&task.conversationId!==context.conversationId)throw new Error('QUESTION_RECEIPT_INVALID');
        conversationTasks.owner=context.owner;conversationTasks.epoch=context.epoch;conversationTasks.entries.set(taskId,{taskId,sessionId:context.sessionId,
          conversationId:task.conversationId,receiptId:task.source.receiptId,task,notice:''})}
      renderQuestionView(context);return true
    }catch(e){if(approvalViewCurrent(context)){cache.error=safeError(e);renderQuestionView(context)}return false}
    finally{if(approvalViewCurrent(context))scheduleQuestionObservation(context)}};
  const promise=run();toolQuestions.inFlight.set(key,{promise});try{return await promise}
  finally{if(toolQuestions.inFlight.get(key)?.promise===promise)toolQuestions.inFlight.delete(key)}}
async function answerToolQuestion(row,answer,context=approvalContext(),restoreFocus=false){
  if(!approvalViewCurrent(context)||!questionScopeCurrent(context))return;const cache=toolQuestions.sessions.get(row.sessionId),current=cache?.rows.get(row.questionRpcId);
  if(!current||questionIdentity(current)!==questionIdentity(row)||current.status!=='pending'||cache.error)return;
  const canonical=canonicalQuestionAnswer(answer,row.questions);if(!canonical){toast(safeError(new Error('QUESTION_ANSWER_INVALID')),true);return}
  let attempt=questionAttempt(context,row);if(attempt?.busy)return;
  if(attempt?.unknown&&(!attempt.checked||JSON.stringify(attempt.answer)!==JSON.stringify(canonical))){void refreshToolQuestions(context,{force:true});return}
  attempt ||= {identity:questionIdentity(row),requestId:newSharedRequestId(),answer:canonical};attempt.busy=true;attempt.unknown=true;attempt.checked=false;
  toolQuestions.attempts.set(`${row.sessionId}/${row.questionRpcId}`,attempt);saveQuestionAttempt(context,row,attempt);renderQuestionView(context);
  try{const result=await call('shared.questions.answer',{sessionId:row.sessionId,questionRpcId:row.questionRpcId,requestId:attempt.requestId,answer:attempt.answer});
    if(!approvalViewCurrent(context))return;const received=normalizedQuestionBatch(result?.question);
    if(result?.requestId!==attempt.requestId||!received||questionIdentity(received)!==questionIdentity(row)||received.status!=='answered'||
      received.answerRequestId!==attempt.requestId||JSON.stringify(received.answer)!==JSON.stringify(attempt.answer))throw new Error('QUESTION_RECEIPT_INVALID');
    cache.rows.set(row.questionRpcId,mergedQuestion(cache.rows.get(row.questionRpcId),received,{receipt:true}));renderQuestionView(context)
  }catch(e){if(approvalViewCurrent(context))toast(['TIMEOUT','RECEIPT_TIMEOUT'].includes(e?.message)?'回答回执尚不明确，正在检查问题状态':
      e?.message==='INVALID_REQUEST'?safeError(new Error('QUESTION_ANSWER_INVALID')):safeError(e),true)}
  finally{if(approvalViewCurrent(context)){await refreshToolQuestions(context,{force:true});attempt.busy=false;renderQuestionView(context);
      if(restoreFocus&&context.page==='chat')$('draft').focus({preventScroll:true})}else attempt.busy=false}}
function relatedExecutionSteps(task){const commands=[task.source,...(Array.isArray(task.supplements)?task.supplements:[]),
  ...(Array.isArray(task.resumes)?task.resumes:[])].filter(command=>command?.kind==='session.message'&&
  command.sessionId===task.sessionId&&(command.commandId===task.taskId&&!command.rootTaskId||command.rootTaskId===task.taskId));
  return (Array.isArray(task.executionSteps)?task.executionSteps:[]).filter(step=>step&&typeof step.executionId==='string'&&
    step.executionId.length>0&&step.executionId.length<=256&&typeof step.toolName==='string'&&
    /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(step.toolName)&&['running','completed','failed','cancelled','uncertain'].includes(step.state)&&
    commands.some(command=>command.commandId===step.sourceCommandId&&receiptIdPattern.test(command.receiptId||'')&&
      command.receiptId===step.sourceReceiptId))}
function executionProgress(step){const jobs={running:'后台运行中',stopping:'后台正在停止',completed:'后台已结束',killed:'后台已停止',
  failed:'后台未完成',uncertain:'后台状态待确认',unconfirmed:'后台状态待确认'};
  return Object.hasOwn(jobs,step.jobState)?jobs[step.jobState]:step.jobId?'后台状态待确认':
    {running:'正在执行',completed:'执行结束',failed:'未完成',cancelled:'已停止',uncertain:'待确认'}[step.state]}
function executionName(step){return {pwsh:'运行命令',read:'读取文件',write:'写入文件',edit:'修改文件',glob:'查找文件',grep:'搜索内容',
  weftmod:'设备操作',weftmod_script:'运行脚本',job_output:'读取后台输出',job_list:'查看后台任务',job_kill:'停止后台任务'}[step.toolName]||'工具操作'}
function taskReplyProgress(reply){if(reply?.status==='failed'&&reply.endReasonKind==='max-tokens')return '因输出限制结束，尚未确认完整交付';
  return {waiting:'等待模型回复',streaming:'模型正在回复，尚无结束记录',
  completed:reply?.assistantMessages>0?'回复回合已正常结束':'回合已结束，未见最终文字回复',aborted:'回复回合已中断',
  blocked:'模型请求被阻断',failed:'模型回合未完成',unconfirmed:'回复结束状态待核对'}[reply?.status]||'回复结束状态待核对'}
function renderConversationTasks(){const context=conversationTaskContext(),content=$('chat-content');
  if(state.page!=='chat'||!context.sessionId||conversationTasks.owner!==context.owner||conversationTasks.epoch!==context.epoch)return;
  const scroll=$('chat-scroll'),previousScroll=scroll.scrollTop;
  for(const entry of conversationTasks.entries.values()){
    if(entry.sessionId!==context.sessionId||entry.conversationId&&entry.conversationId!==context.conversationId)continue;
    const task=entry.task,steps=task?relatedExecutionSteps(task):[],control=task?.control;
    const artifacts=(Array.isArray(task?.artifacts)?task.artifacts:[]).filter(item=>item?.taskId===entry.taskId&&
      item.sessionId===context.sessionId&&sessionIdPattern.test(item.artifactId||''));
    const outputLimited=task?.replyEvidence?.status==='failed'&&task.replyEvidence.endReasonKind==='max-tokens';
    let card=[...content.children].find(node=>node.dataset?.conversationTask===entry.taskId);
    if(!entry.notice&&!steps.length&&!artifacts.length&&(!control||control.state==='active')&&!outputLimited){card?.remove();continue}
    const receiptId=task?.source?.receiptId||entry.receiptId,anchor=[...content.children].find(node=>node.dataset?.receiptId===receiptId);
    if(!anchor&&!entry.notice)continue;
    if(card&&anchor&&anchor.nextSibling!==card)content.insertBefore(card,anchor.nextSibling);
    const signature=JSON.stringify([task,entry.notice]);if(card?.dataset.signature===signature)continue;
    if(!card){card=el('section','conversation-task');card.dataset.conversationTask=entry.taskId;
      if(anchor)content.insertBefore(card,anchor.nextSibling);else content.append(card)}
    const expanded=card.querySelector('details')?.open===true;card.dataset.signature=signature;clear(card);
    card.append(el('strong','conversation-task-title',entry.notice?'工具进展 · 待更新':
      outputLimited&&!steps.length&&!artifacts.length?'回复状态':'工具进展'));
    if(entry.notice)card.append(el('p','conversation-task-notice',entry.notice));
    if(steps.length){const records=el('ul','conversation-task-steps');
      for(const step of steps.slice(-3))records.append(el('li','',`${entry.notice?'上次记录：':''}${executionName(step)} · ${executionProgress(step)}`));card.append(records);
      if(steps.length>3){const details=el('details','conversation-task-more');details.open=expanded;
        details.append(el('summary','',`查看全部 ${steps.length} 条执行记录`));
        for(const step of steps)details.append(el('p','',`${executionName(step)} · ${executionProgress(step)}`));card.append(details)}}
    if(!entry.notice&&control&&control.state!=='active')card.append(el('p','conversation-task-state',taskControlMeaning(control)));
    if(!entry.notice&&task?.replyEvidence)card.append(el('p','conversation-task-reply',taskReplyProgress(task.replyEvidence)));
    const verified=artifacts.filter(item=>item.state==='observed'&&item.verification?.status==='observed'&&item.verification?.method==='sha256_readback');
    if(artifacts.length)card.append(el('p','conversation-task-result',verified.length?`${verified.length} 个成果文件已读回核验`:'成果文件仍待核验'));
    const controls=el('div','conversation-task-actions'),detail=el('button','secondary',verified.length?'查看成果与详情':'查看事情详情');detail.type='button';
    detail.addEventListener('pointerdown',()=>{detail.dataset.restoreFocus=document.activeElement===$('draft')?'1':'0'});
    detail.addEventListener('pointercancel',()=>{delete detail.dataset.restoreFocus});
    detail.addEventListener('click',()=>{const restoreFocus=detail.dataset.restoreFocus==='1';delete detail.dataset.restoreFocus;if(conversationTaskCurrent(context))openConversationTaskDetail(entry.taskId,restoreFocus)});controls.append(detail);
    if(entry.notice){const retry=el('button','quiet','重新核对进展');retry.type='button';
      retry.addEventListener('click',()=>{if(conversationTaskCurrent(context))void refreshConversationTasks()});controls.append(retry)}card.append(controls)
  }renderConversationApprovals();renderConversationQuestions();if(state.scrollPinned)scrollBottom();else if(scroll.scrollTop!==previousScroll)scroll.scrollTop=previousScroll}
async function refreshConversationTasks(){const context=conversationTaskContext();
  if(!conversationTaskCurrent(context)||!sessionIdPattern.test(context.sessionId||''))return;
  if(conversationTasks.owner!==context.owner||conversationTasks.epoch!==context.epoch){conversationTasks.entries.clear();
    conversationTasks.owner=context.owner;conversationTasks.epoch=context.epoch}
  void refreshToolApprovals();
  void refreshToolQuestions();
  const key=JSON.stringify(context);if(conversationTasks.inFlight?.key===key)return conversationTasks.inFlight.promise;
  const run=async()=>{let roots;
    try{const result=await call('activity.list');if(!conversationTaskCurrent(context))return;
      if(!Array.isArray(result?.activities))throw new Error('COMMAND_RECEIPT_INVALID');
      if(result.hostAvailable===false)throw new Error('HOST_UNAVAILABLE');
      roots=groupTaskActivities(result.activities).filter(item=>item.source==='host'&&item.kind==='session.message'&&
        item.sessionId===context.sessionId&&sessionIdPattern.test(item.taskId||item.commandId||'')&&
        (!item.conversationId||item.conversationId===context.conversationId)).slice(0,8)
    }catch{if(!conversationTaskCurrent(context))return;
      for(const entry of conversationTasks.entries.values())if(entry.sessionId===context.sessionId)
        entry.notice='电脑暂不可达，执行进展待更新。重连后可重新核对。';
      renderConversationTasks();return}
    let next=0;const worker=async()=>{while(conversationTaskCurrent(context)&&next<roots.length){const root=roots[next++],taskId=root.taskId||root.commandId;
      const entry={...conversationTasks.entries.get(taskId),taskId,sessionId:context.sessionId,conversationId:root.conversationId,notice:''};
      try{const task=await call('shared.tasks.detail',{taskId});if(!conversationTaskCurrent(context))return;
        if(task?.taskId!==taskId||task.sessionId!==context.sessionId||task.source?.commandId!==taskId||
          task.source.kind!=='session.message'||task.source.rootTaskId||task.source.sessionId!==context.sessionId||
          !Array.isArray(task.artifacts)||task.conversationId&&task.conversationId!==context.conversationId)throw new Error('COMMAND_RECEIPT_INVALID');
        entry.task=task;entry.receiptId=task.source.receiptId
      }catch{if(!conversationTaskCurrent(context))return;entry.notice='执行进展暂时无法读取，已有记录待更新。请重新核对。'}
      conversationTasks.entries.set(taskId,entry);renderConversationTasks()}};await Promise.all([worker(),worker()])};
  const promise=run();conversationTasks.inFlight={key,promise};try{await promise}finally{
    if(conversationTasks.inFlight?.promise===promise)conversationTasks.inFlight=null}}
function openConversationTaskDetail(taskId,focusIntent){const context=conversationTaskContext();if(!conversationTaskCurrent(context))return;
  const snapshot={...context,scrollTop:$('chat-scroll').scrollTop,pinned:state.scrollPinned,focus:focusIntent===undefined?document.activeElement===$('draft'):focusIntent};
  updateComposer();page('things');state.taskReturn=snapshot;showTaskDetail(taskId)}
function returnFromTaskDetail(){const snapshot=state.taskReturn,current=conversationTaskContext();state.taskReturn=null;
  if(!snapshot||snapshot.owner!==current.owner||snapshot.epoch!==current.epoch||snapshot.source!==current.source||
    snapshot.sessionId!==current.sessionId||snapshot.conversationId!==current.conversationId){page('things');return}
  state.scrollPinned=snapshot.pinned;state.chatRestore=snapshot;page('chat')}
function restoreTaskChat(){const snapshot=state.chatRestore;if(!snapshot)return;const current=conversationTaskContext();
  if(snapshot.owner!==current.owner||snapshot.epoch!==current.epoch||snapshot.source!==current.source||
    snapshot.sessionId!==current.sessionId||snapshot.conversationId!==current.conversationId){state.chatRestore=null;return}
  state.chatRestore=null;state.scrollPinned=snapshot.pinned;$('chat-scroll').scrollTop=snapshot.scrollTop;
  if(snapshot.focus)$('draft').focus({preventScroll:true})}
function taskControlGroup(taskId,control,current){const section=group('补充与控制',[]),body=section.querySelector('.group-body');
  body.append(el('p','task-control-state',taskControlMeaning(control)));
  if(control?.stopRequestedAt)body.append(el('p','command-fact',`停止意图：${commandTime(control.stopRequestedAt)}`));
  if(control?.stopStatus==='stopped'&&control.stopObservedAt)body.append(el('p','command-fact',`停止核对：${commandTime(control.stopObservedAt)}`));
  else if(control?.stoppedAt)body.append(el('p','command-fact',`停止核对：${commandTime(control.stoppedAt)}`));
  if(control?.state==='stop_requested'&&Number.isSafeInteger(control.pendingReceipts)&&control.pendingReceipts>0)
    body.append(el('p','command-fact','仍有回合或执行结果待核对。'));
  const attempt=state.taskControlAttempt;
  if(attempt?.taskId===taskId&&attempt.owner===state.owner&&attempt.epoch===state.authEpoch&&attempt.unknown){
    body.append(notice('上次操作回执尚不明确。请先刷新任务；重试会沿用同一请求编号。'));
    body.append(action('重试同一请求',()=>submitTaskControl(taskId,attempt.action,attempt.text,current,null,section),false));
    return section}
  if(control?.canSupplement===true){const input=el('textarea','task-supplement-input');input.placeholder='补充这件事需要的信息或调整';
    input.setAttribute('aria-label','补充任务要求');input.maxLength=8192;
    const draftKey=`${state.owner}:${taskId}`;input.value=state.taskControlDrafts.get(draftKey)||'';
    input.addEventListener('input',()=>state.taskControlDrafts.set(draftKey,input.value));
    body.append(input,action('提交补充',()=>submitTaskControl(taskId,'supplement',input.value,current,input,section),false))}
  if(control?.canStop===true)body.append(action('请求停止这件事',()=>submitTaskControl(taskId,'stop',null,current,null,section),false));
  if(control?.canResume===true){const input=el('textarea','task-supplement-input');
    input.placeholder='说明恢复后要做什么，例如先核对现有文件再继续修改';
    input.setAttribute('aria-label','恢复任务后的明确要求');input.maxLength=8192;
    const draftKey=`${state.owner}:${taskId}:resume`;input.value=state.taskControlDrafts.get(draftKey)||'';
    input.addEventListener('input',()=>state.taskControlDrafts.set(draftKey,input.value));
    body.append(input,action('恢复这件事',()=>submitTaskControl(taskId,'resume',input.value,current,input,section),false))}
  return section}
async function submitTaskControl(taskId,action,text,current,input,section){if(!current())return;
  const value=typeof text==='string'?text.trim():null;
  if((action==='supplement'||action==='resume')&&!value){toast(action==='resume'?'请先写明恢复后要做什么':'先填写补充内容',true);return}
  if(value&&value.length>8192){toast('内容过长，请缩短后重试',true);return}
  const owner=state.owner,epoch=state.authEpoch,existing=state.taskControlAttempt;
  if(existing?.busy)return;
  if(existing?.unknown&&(existing.taskId!==taskId||existing.owner!==owner||existing.epoch!==epoch||
    existing.action!==action||existing.text!==value)){toast('先核对上一项操作结果',true);return}
  const attempt=existing?.unknown?existing:{taskId,owner,epoch,action,text:value,requestId:newSharedRequestId()};
  attempt.busy=true;attempt.unknown=false;state.taskControlAttempt=attempt;
  for(const control of section?.querySelectorAll?.('button,textarea')||[])control.disabled=true;
  toast('请求正在提交；结果以任务记录为准');
  try{const result=await call(`shared.tasks.${action}`,{taskId,requestId:attempt.requestId,...(value?{text:value}:{})});
    if(!current()||state.taskControlAttempt!==attempt)return;
    if(result?.task?.taskId!==taskId||!result.task.control)throw new Error('COMMAND_RECEIPT_INVALID');
    state.taskControlAttempt=null;if(action==='supplement')state.taskControlDrafts.delete(`${owner}:${taskId}`);
    if(action==='resume')state.taskControlDrafts.delete(`${owner}:${taskId}:resume`);
    if(input)input.value='';
    toast(action==='stop'?'停止意图已记录，正在核对执行端状态':'请求已记录，正在核对任务状态');
    showTaskDetail(taskId)
  }catch(e){if(!current()||state.taskControlAttempt!==attempt)return;
    attempt.unknown=e?.message==='TIMEOUT'||e?.message==='RECEIPT_TIMEOUT';
    toast(attempt.unknown?'操作结果待核对；刷新任务或重试同一请求':safeError(e),true);
    if(attempt.unknown&&section){const body=section.querySelector('.group-body');
      body.append(notice('回执尚不明确，请先刷新任务；重试会沿用同一请求编号。'),
        action('重试同一请求',()=>submitTaskControl(taskId,action,value,current,null,section),false))}
  }finally{attempt.busy=false;if(!attempt.unknown&&current())for(const control of section?.querySelectorAll?.('button,textarea')||[])control.disabled=false}}
 function stopTaskControlObservation(){clearTimeout(state.taskControlPollTimer);state.taskControlPollTimer=null;state.taskControlPollGeneration++}
 function scheduleTaskControlObservation(taskId,control,current,statusNode,pollGeneration){
   clearTimeout(state.taskControlPollTimer);state.taskControlPollTimer=null;
   if(control?.state!=='stop_requested'||typeof control.stopStatus!=='string'||control.canResume===true||
     ['stopped','completed'].includes(control.stopStatus)||state.taskControlAttempt?.unknown)return;
   if(state.taskControlPollCount>=8||Date.now()-state.taskControlPollStartedAt>=20000){
     statusNode.textContent+=' 自动核对已暂停，可点“刷新任务”。';return}
   state.taskControlPollTimer=setTimeout(async()=>{state.taskControlPollTimer=null;
     if(!current()||state.taskControlPollGeneration!==pollGeneration)return;
     state.taskControlPollCount++;
     try{const task=await call('shared.tasks.detail',{taskId});
       if(!current()||state.taskControlPollGeneration!==pollGeneration)return;
       if(task?.taskId!==taskId||!task.control)throw new Error('COMMAND_RECEIPT_INVALID');
       if(task.control.canResume===true||['stopped','completed'].includes(task.control.stopStatus)||task.control.state!=='stop_requested'){
         showTaskDetail(taskId);return}
       statusNode.textContent=taskControlMeaning(task.control);
       scheduleTaskControlObservation(taskId,task.control,current,statusNode,pollGeneration);
     }catch(e){if(current()&&state.taskControlPollGeneration===pollGeneration)
       statusNode.textContent='暂时无法连接电脑核对停止结果。可点“刷新任务”；原请求编号会保留。'}
   },2000)}
 function showTaskDetail(taskId){if(!taskId||state.page!=='things')return;
   stopTaskControlObservation();stopApprovalObservation();stopQuestionObservation();state.taskControlPollCount=0;state.taskControlPollStartedAt=Date.now();
   const pollGeneration=state.taskControlPollGeneration;
  state.thingsDetail=taskId;const target=$('page-content');clear(target);
  const back=()=>returnFromTaskDetail(),backLabel=state.taskReturn?'返回对话':'返回最近活动';
  target.append(action(backLabel,back,false),heading('电脑任务','正在核对任务与文件成果…'));
  const owner=state.owner,epoch=state.authEpoch,gen=state.generation;
  const current=()=>state.page==='things'&&state.thingsDetail===taskId&&state.owner===owner&&
    state.authEpoch===epoch&&state.generation===gen;
  call('shared.tasks.detail',{taskId}).then(task=>{
    if(!current())return;
    if(task?.taskId!==taskId||task.source?.commandId!==taskId||!Array.isArray(task.artifacts))
      throw new Error('COMMAND_RECEIPT_INVALID');
    clear(target);target.append(action(backLabel,back,false),
      heading('电脑任务','同一会话中的要求、执行与成果。'));
    const source=task.source,artifacts=task.artifacts;
    const inline=conversationTasks.entries.get(taskId);if(inline&&inline.sessionId===task.sessionId&&
      (!inline.receiptId||inline.receiptId===source.receiptId))conversationTasks.entries.set(taskId,{...inline,task,notice:''});
    const verified=artifacts.filter(item=>item.state==='observed'&&item.verification?.status==='observed'&&
      item.artifactId&&item.sha256&&Number.isSafeInteger(item.size));
    const uncertain=artifacts.some(item=>item.state==='uncertain');
    const rejected=artifacts.some(item=>item.state==='rejected');
    const summary=group('任务进度',[]),body=summary.querySelector('.group-body');
    const stopStatus=task.control?.state==='stop_requested'?task.control.stopStatus:null;
    body.append(el('p','command-status',stopStatus==='stopped'?'这件事已停止':
      stopStatus==='completed'?'回合已正常结束':stopStatus?'停止状态待核对':
      verified.length?`${verified.length} 个文件已在电脑核验`:
      uncertain?'文件结果待确认':rejected?'文件生成未完成':hostCommandStatus(source.state)));
    body.append(el('p','command-explanation',stopStatus==='stopped'?
      '电脑已核对这件事的实际停止。已经完成的步骤与文件会保留。':
      stopStatus==='completed'?'电脑回合已正常结束；停止请求没有已证实的中断结果。':
      stopStatus?taskControlMeaning(task.control):verified.length?
      '电脑已经重新读取文件并核对大小和 SHA-256。保存到手机后还会再次核对。':
      uncertain?'电脑尚不能确定文件是否写成。请查看原会话，避免重复执行。':
      rejected?'电脑未能完成文件生成；原会话保留具体回复。':hostCommandMeaning(source)));
    const reply=task.replyEvidence;
    const replyLabel=reply?.status==='waiting'?'电脑会话正在等待模型输出':
      reply?.status==='streaming'?'模型正在生成回复，尚未见到结束记录':
      reply?.status==='completed'?reply.assistantMessages>0?'回复回合已正常结束':'回合已结束，但未见最终文字回复':
      reply?.status==='aborted'?'回复回合已中断':
      reply?.status==='blocked'?'模型请求被阻断':
      reply?.status==='failed'?reply.endReasonKind==='max-tokens'?'因输出限制结束，尚未确认完整交付':'模型回合未完成':'回复是否结束尚无法核对';
    body.append(el('p','command-fact',`回复：${replyLabel}。`));
    body.append(el('p','command-fact','聊天中的“停止”只停止当前回复；事情的停止状态在这里单独记录。'));
    if(source.errorCode)body.append(el('p','command-error',safeError(new Error(source.errorCode))));
    target.append(summary);
    const approvalSection=group('操作审批',[]),approvalView=approvalContext(task.sessionId,taskId);
    approvalSection.hidden=true;approvalCache(approvalView);
    toolApprovals.detail={context:approvalView,task,section:approvalSection};target.append(approvalSection);
    renderApprovalView(approvalView);void refreshToolApprovals(approvalView);
    const questionSection=group('需要你的回答',[]),questionView=approvalContext(task.sessionId,taskId);
    questionSection.hidden=true;questionCache(questionView);
    toolQuestions.detail={context:questionView,task,section:questionSection};target.append(questionSection);
    renderQuestionView(questionView);void refreshToolQuestions(questionView);
    if(typeof task.sourceText==='string'&&task.sourceText.trim()){
      const goal=group('原目标',[]);goal.querySelector('.group-body').append(el('p','task-source-text',task.sourceText));
      target.append(goal)}
     if(task.control&&typeof task.control.state==='string'){
       const controls=taskControlGroup(taskId,task.control,current);target.append(controls);
       scheduleTaskControlObservation(taskId,task.control,current,controls.querySelector('.task-control-state'),pollGeneration)}
    const followUps=[...(Array.isArray(task.supplements)?task.supplements:[]),
      ...(Array.isArray(task.resumes)?task.resumes:[])]
      .filter(item=>item?.rootTaskId===taskId&&sessionIdPattern.test(item.commandId||''))
      .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    if(followUps.length){const updates=group('后续要求',[]),updatesBody=updates.querySelector('.group-body');
      for(const item of followUps){const entry=el('div','task-followup');
        entry.append(el('p','command-fact',`${item.taskAction==='resume'?'恢复':'补充'} · ${hostCommandStatus(item.state)} · ${commandTime(item.createdAt)}`));
        const detail=el('details','task-record-id');detail.append(el('summary','','查看记录编号'),el('code','',item.commandId));
        entry.append(detail);updatesBody.append(entry)}
      target.append(updates)}
    const steps=(Array.isArray(task.steps)?task.steps:[]).filter(item=>item?.kind==='desktop.open_app'&&
      sessionIdPattern.test(item.commandId||'')&&(item.taskId===undefined||item.taskId===taskId));
    if(steps.length){const section=group('执行步骤',[]),stepsBody=section.querySelector('.group-body');
      for(const item of steps){const entry=el('div','task-followup');
        const at=item.verification?.status==='observed'&&item.verification?.observedAt||item.updatedAt||item.createdAt;
        entry.append(el('p','command-fact',`${item.appId==='notepad'?'打开记事本':'打开电脑应用'} · ${taskStepStatus(item)} · ${commandTime(at)}`));
        const detail=el('details','task-record-id');detail.append(el('summary','','查看记录编号'),el('code','',item.commandId));
        entry.append(detail);stepsBody.append(entry)}
      target.append(section)}
    const executionLabels={running:'正在执行',completed:'执行结束',failed:'未完成',cancelled:'已停止',uncertain:'待确认'};
    const jobLabels={running:'后台运行中',stopping:'后台正在停止',completed:'后台已结束',killed:'后台已停止',failed:'后台未完成',
      uncertain:'后台状态待确认',unconfirmed:'后台状态待确认'};
    const toolNames={pwsh:'运行命令',read:'读取文件',write:'写入文件',edit:'修改文件',glob:'查找文件',grep:'搜索内容',
      weftmod:'设备操作',weftmod_script:'运行脚本',job_output:'读取后台输出',job_list:'查看后台任务',job_kill:'停止后台任务'};
    const executions=(Array.isArray(task.executionSteps)?task.executionSteps:[]).filter(item=>item&&
      typeof item.executionId==='string'&&item.executionId.length>0&&item.executionId.length<=256&&
      typeof item.sourceCommandId==='string'&&typeof item.sourceReceiptId==='string'&&
      typeof item.toolName==='string'&&item.toolName.length>0&&item.toolName.length<=128&&Object.hasOwn(executionLabels,item.state));
    if(executions.length){const section=group('执行记录',[]),body=section.querySelector('.group-body');
      for(const item of executions){const entry=el('div','task-followup');
        const status=Object.hasOwn(jobLabels,item.jobState)?jobLabels[item.jobState]:item.jobId?'后台状态待确认':executionLabels[item.state];
        entry.append(el('p','command-fact',`${Object.hasOwn(toolNames,item.toolName)?toolNames[item.toolName]:item.toolName} · ${status} · ${commandTime(item.jobObservedAt||item.finishedAt||item.updatedAt||item.startedAt)}`));
        body.append(entry)}target.append(section)}
    const taskSources=(Array.isArray(task.sources)?task.sources:[]).filter(item=>item?.kind==='webpage'?
      /^source-[a-f0-9]{48}$/.test(item.snapshotId||'')&&typeof item.title==='string'&&
      typeof item.url==='string'&&/^[a-f0-9]{64}$/.test(item.contentSha256||'')&&
      (item.versionHash===undefined||/^[a-f0-9]{64}$/.test(item.versionHash)&&
        Number.isSafeInteger(item.segmentIndex)&&item.segmentIndex>=0&&
        Number.isSafeInteger(item.segmentCount)&&item.segmentCount>=1&&item.segmentCount<=32&&
        item.segmentIndex<item.segmentCount&&Number.isSafeInteger(item.byteStart)&&item.byteStart>=0&&
        Number.isSafeInteger(item.byteEnd)&&item.byteEnd>item.byteStart&&
        item.byteEnd-item.byteStart<=8192&&Number.isSafeInteger(item.totalCapturedBytes)&&
        item.totalCapturedBytes<=256*1024&&typeof item.captureTruncated==='boolean'&&
        (item.outline===undefined||typeof item.outline==='string'&&
          new TextEncoder().encode(item.outline).length<=2048)):
      /^source-[a-f0-9]{48}$/.test(item?.snapshotId||'')&&typeof item.relativePath==='string'&&
      Number.isSafeInteger(item.lineStart)&&Number.isSafeInteger(item.lineEnd)&&
      /^[a-f0-9]{64}$/.test(item.fileSha256||''));
    if(task.project||task.workspace?.kind==='browser'||taskSources.length){const sourceGroup=group('读取的来源',[]),sourceBody=sourceGroup.querySelector('.group-body');
      sourceBody.append(el('p','muted',task.project?`项目：${task.project.name}${task.project.revoked?' · 已撤销；历史来源仍保留':''}`:
        task.workspace?.kind==='browser'?'公共网页实际渲染并读取时保存的正文与链接。':'这些是任务读取时保存的资料版本。'));
      if(!taskSources.length)sourceBody.append(el('p','muted',task.workspace?.kind==='browser'?
        '尚无已核验的网页来源；未读页面不能作为摘要依据。':'尚无已核验的读取来源；不能把未读内容当作摘要依据。'));
      const captureGroups=new Map();for(const source of taskSources)if(source.kind==='webpage'&&/^[a-f0-9]{64}$/.test(source.versionHash||'')){
        const root=source.parentSnapshotId||source.snapshotId;if(!captureGroups.has(root))captureGroups.set(root,[]);
        captureGroups.get(root).push(source)}
      const ordered=[...taskSources].sort((a,b)=>(a.parentSnapshotId||a.snapshotId).localeCompare(b.parentSnapshotId||b.snapshotId)||
        (a.segmentIndex??0)-(b.segmentIndex??0));let shownGroup=null;
      for(const source of ordered){const wrap=el('div','project-source-entry'),web=source.kind==='webpage';
        const root=source.parentSnapshotId||source.snapshotId;
        if(web&&captureGroups.has(root)&&shownGroup!==root){const siblings=captureGroups.get(root),readCount=new Set(siblings.map(x=>x.segmentIndex)).size;
          sourceBody.append(el('p','artifact-name',`${source.title||source.url} · 已读 ${readCount}/${source.segmentCount} 段${
            source.captureTruncated?' · 本次捕获未覆盖全文':readCount<source.segmentCount?' · 还有未读段':' · 已读完本次捕获'}`));shownGroup=root}
        wrap.append(el('p','artifact-name',web&&source.versionHash?`第 ${source.segmentIndex+1}/${source.segmentCount} 段`:web?source.title||source.url:source.relativePath),
          el('p','artifact-meta',web?`${source.url} · ${commandTime(source.readAt)}${source.versionHash?
            ` · 已读字节 ${source.byteStart+1}–${source.byteEnd}`:source.truncated?' · 只读到部分正文':''} · ${
            source.cited?'已用于成果':'已读取，未被成果引用'}`:
            `第 ${source.lineStart}–${source.lineEnd} 行 · ${commandTime(source.readAt)} · ${
              source.cited?'已用于成果':'已读取，未被成果引用'}`));
        const preview=el('div','artifact-preview');preview.hidden=true;
        const detail=el('details','task-record-id');detail.append(el('summary','',web?'查看网页来源与内容版本':'查看文件版本与来源编号'),
          el('code','',web?`本段 SHA-256 ${source.contentSha256}${source.versionHash?
            `\n捕获版本 SHA-256 ${source.versionHash}\n本段字节 ${source.byteStart}–${source.byteEnd}（结束位置不含）${source.outline?`\n页面标题目录\n${source.outline}`:''}`:''}\n请求 ${source.requestedUrl}\n来源 ${source.snapshotId}\n已观察链接 ${source.links?.length??0} 条`:
            `SHA-256 ${source.fileSha256}\n来源 ${source.snapshotId}`));
        wrap.append(action('查看来源正文',async()=>{
          preview.hidden=false;preview.textContent='正在读取来源正文…';
          try{const result=await call('shared.sources.detail',{taskId,snapshotId:source.snapshotId});
            if(!current())return;
            const actual=result?.source,same=web?actual?.kind==='webpage'&&actual.url===source.url&&
              actual.contentSha256===source.contentSha256&&actual.truncated===source.truncated&&
              (!source.versionHash||actual.versionHash===source.versionHash&&
                actual.segmentIndex===source.segmentIndex&&actual.byteStart===source.byteStart&&
                actual.byteEnd===source.byteEnd):
              actual?.fileSha256===source.fileSha256&&actual.lineStart===source.lineStart&&actual.lineEnd===source.lineEnd;
            if(actual?.snapshotId!==source.snapshotId||!same||typeof actual.text!=='string'||
              new TextEncoder().encode(actual.text).length>32*1024)throw new Error('SOURCE_INVALID');
            preview.textContent=actual.text;
          }catch(e){if(current())preview.textContent=['NOT_FOUND','UNAUTHORIZED'].includes(e?.message)?
            '当前账户无法读取这份来源。':`来源正文未能核对：${safeError(e)}`}
        },false),preview,detail);sourceBody.append(wrap)}
      target.append(sourceGroup)}
    if(artifacts.length){const fileGroup=group('成果文件',[]),fileBody=fileGroup.querySelector('.group-body');
      for(const item of artifacts){const wrap=el('div','artifact-entry');
        wrap.append(el('p','artifact-name',item.fileName||'未命名文件'),
          el('p','artifact-meta',`${artifactSize(item.size)} · ${item.state==='observed'&&item.verification?.status==='observed'?'电脑已核验':
            item.state==='uncertain'?'结果待确认':item.state==='rejected'?'生成失败':'等待电脑核验'}`));
        if(item.state==='observed'&&item.verification?.status==='observed'&&item.artifactId){
          const preview=el('div','artifact-preview');preview.hidden=true;
          let saveStatus=null;
          wrap.append(action('查看内容',async()=>{
            preview.hidden=false;preview.textContent='正在读取内容…';try{const result=await call('shared.artifacts.preview',{artifactId:item.artifactId});
              if(!current())return;
              if(result?.artifact?.artifactId!==item.artifactId||result.artifact?.sha256!==item.sha256||
                result.artifact?.size!==item.size||typeof result.text!=='string')throw new Error('ARTIFACT_CHANGED');
              preview.textContent=result.text;
            }catch(e){if(current())preview.textContent=safeError(e)}}),preview,
            action('保存到手机',async()=>{
              try{const result=await call('shared.artifacts.save',{artifactId:item.artifactId});if(!current())return;
                state.artifactSaveRequest=result.requestId;
                if(!saveStatus){saveStatus=el('p','artifact-save-state');wrap.append(saveStatus)}
                saveStatus.textContent='请选择保存位置；保存后会核对文件内容。';
                state.artifactSaveLabel=saveStatus;
              }catch(e){if(current())toast(safeError(e),true)}
            }));
        }wrap.append(el('p','command-fact',`更新：${commandTime(item.updatedAt)}`));fileBody.append(wrap)}
      target.append(fileGroup)
    }else target.append(notice('这件事目前没有可查看的文件成果。回复与执行过程可在原电脑会话查看。'));
    const facts=group('记录',[]),factsBody=facts.querySelector('.group-body');
    factsBody.append(el('p','command-fact',`发往电脑：${commandTime(source.createdAt)}`),
      el('p','command-fact',`最近更新：${commandTime(source.updatedAt)}`));
    const rootId=el('details','task-record-id');
    rootId.append(el('summary','','查看记录编号'),el('code','',taskId));
    factsBody.append(rootId);
    target.append(facts);
    if(task.sessionId)target.append(action('打开原电脑会话',()=>openHostCommandSession(task.sessionId),false));
    target.append(action('刷新任务',()=>showTaskDetail(taskId),false));
  }).catch(e=>{if(!current())return;clear(target);target.append(action(backLabel,back,false),
    heading('电脑任务'),notice(['NOT_FOUND','UNAUTHORIZED','FORBIDDEN'].includes(e?.message)?
      '这项任务当前账户无法读取。请检查登录和电脑连接。':safeError(e),'详情不可用'))})
}
function showHostCommandDetail(item){if(item.kind==='session.message'||item.taskId)return showTaskDetail(item.taskId||item.commandId);
  const commandId=item.commandId;if(!commandId||state.page!=='things')return;
  state.thingsDetail=commandId;const target=$('page-content');clear(target);
  const back=action('返回最近活动',()=>page('things'),false);back.classList.add('things-back');target.append(back,
    heading(hostActionLabel(item.kind),'电脑命令的受理与实际结果分别记录。'));
  const loading=notice('正在读取电脑命令详情…');target.append(loading);
  const owner=state.owner,epoch=state.authEpoch,gen=state.generation;
  call('shared.commands.detail',{commandId}).then(result=>{
    if(state.page!=='things'||state.thingsDetail!==commandId||state.owner!==owner||state.authEpoch!==epoch||state.generation!==gen)return;
    const command=result?.command;
    if(result?.source!=='host'||command?.commandId!==commandId||
      (item.sessionId&&command.sessionId!==item.sessionId))throw new Error('COMMAND_RECEIPT_INVALID');
    clear(target);target.append(action('返回最近活动',()=>page('things'),false),heading(hostActionLabel(command.kind),
      '这条命令的状态来自当前账户的电脑记录。'));
    const summary=group('命令状态',[]),body=summary.querySelector('.group-body');
    body.append(el('p','command-status',hostCommandStatus(command.state)),
      el('p','command-explanation',hostCommandMeaning(command)));
    if(command.errorCode)body.append(el('p','command-error',safeError(new Error(command.errorCode))));
    target.append(summary);
    const facts=group('记录',[]),factsBody=facts.querySelector('.group-body');
    factsBody.append(el('p','command-fact',`命令编号：${command.commandId}`),
      el('p','command-fact',`类型：${hostActionLabel(command.kind)}`),
      el('p','command-fact',`创建：${commandTime(command.createdAt)}`),
      el('p','command-fact',`更新：${commandTime(command.updatedAt)}`));
    if(command.verification){factsBody.append(el('p','command-fact',`核验：${command.verification.status==='observed'?'已观察到应用窗口':'尚未确认应用窗口'}`));
      if(command.verification.observedAt)factsBody.append(el('p','command-fact',`观察时间：${commandTime(command.verification.observedAt)}`))}
    target.append(facts);
    if(command.sessionId)target.append(action('打开原电脑会话',()=>openHostCommandSession(command.sessionId),false));
  }).catch(e=>{if(state.page!=='things'||state.thingsDetail!==commandId||state.owner!==owner||state.authEpoch!==epoch||state.generation!==gen)return;
    clear(target);target.append(action('返回最近活动',()=>page('things'),false),
      heading('电脑命令'),notice(['NOT_FOUND','UNAUTHORIZED','FORBIDDEN'].includes(e?.message)?
        '这条命令目前无法读取。它可能已移除，或当前账户已无权查看。':safeError(e),'详情不可用'))});
}
function devicesPage(target){target.append(heading('设备','同一账户下登录过的设备会列在这里。'));
  if(!state.loggedIn){target.append(notice('请先登录电脑账户，再查看或移除设备。'));return}
  const summary=notice('正在读取设备…');target.append(summary);const gen=state.generation;
  call('auth.devices').then(result=>{if(state.page!=='devices'||state.generation!==gen)return;summary.remove();
    const rows=(result.devices||[]).map(device=>row(`${device.name}${device.current?' · 当前设备':''}`,
      `${device.revoked?'已移除':'登录有效至 '+timeLabel(device.expiresAt)}`,()=>deviceDetails(device)));
    target.append(group('已登录设备',rows.length?rows:[el('p','muted','没有可用设备')]));
  }).catch(e=>{summary.textContent=safeError(e);summary.className='inline-error'});
}
function deviceDetails(device){const target=$('page-content');clear(target);target.append(heading(device.name));
  target.append(notice(device.current?'这是当前手机的账户会话。':'这是同一账户下的另一台设备。'));
  const name=field('设备名称','text',device.name);const box=group('设备管理',[]);box.querySelector('.group-body').append(name.box);
  const controls=el('div','form-actions');controls.append(action('保存名称',async()=>{try{await call('auth.renameDevice',{deviceId:device.id,name:name.input.value});toast('设备名称已更新');page('devices')}
    catch(e){toast(safeError(e),true)}}));controls.append(action('移除设备',()=>{
    const warning=notice(`移除 ${device.name} 后，该设备需要重新登录。`,'确认移除设备');
    const confirmActions=el('div','form-actions');confirmActions.append(action('保留设备',()=>{warning.remove();confirmActions.remove()},false),
      action('确认移除',async()=>{try{const result=await call('auth.revokeDevice',{deviceId:device.id});if(!result.loggedIn){state.authEpoch++;state.accountModelCredentialConflict=null;state.handoffViews.clear();state.linkedEvents.clear();state.handoffModelNames.clear();state.handoffPickerOpen.clear();state.handoffSelections.clear();state.handoffModelLastCheck=0;clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;state.loggedIn=false;state.connection='local';state.username='';state.owner='';state.conversationId=null;
        state.profile=null;state.model=null;state.backgroundSync='not_scheduled';
        $('model-label').textContent='选择模型';showProfile({displayName:'未登录'});
        try{applyTheme((await call('settings.appearance')).value)}catch{applyTheme('system')}
        page('connect');await listConversations()}else page('devices');toast('设备已移除')}
        catch(e){toast(safeError(e),true)}}));box.after(warning,confirmActions)
  },false));box.querySelector('.group-body').append(controls);target.append(box);
}
function notificationPage(target){target.append(heading('通知','回复、手机动作与同步问题分别保存记录和控制系统提醒。'));
  if(!state.loggedIn){target.append(notice('登录后可查看当前账户的通知；其它账户的记录不会显示。'));return}
  const loading=notice('正在读取通知设置…');target.append(loading);const gen=state.generation;
  Promise.all([call('notifications.state'),call('notifications.inbox')]).then(([settings,history])=>{
    if(state.page!=='notifications'||state.generation!==gen)return;loading.remove();
    if(!settings.systemAllowed)target.append(notice(settings.needsPermission?'系统通知权限尚未允许；应用内记录仍会保存。':'系统通知已关闭；应用内记录仍会保存。','系统提醒'),
      action('打开通知权限',async()=>{try{await call('notifications.requestPermission');toast('请在系统提示中选择')}
        catch(e){toast(safeError(e),true)}},false));
    const labels=[['reply','回复完成','模型回复完成或未完成'],['action','手机动作结果','打开应用或设置的请求状态'],['sync','同步问题','本机待传记录需要处理']];
    target.append(group('提醒类别',labels.map(([key,title,detail])=>row(`${title} · ${settings.categories?.[key]?'已开启':'已关闭'}`,
      detail,async()=>{try{await call('notifications.set',{category:key,enabled:!settings.categories[key]});page('notifications')}
      catch(e){toast(safeError(e),true)}}))));
    const items=history.items||[];target.append(group('最近记录',items.length?items.map(item=>row(item.title,
      `${item.summary} · ${timeLabel(item.createdAt)}`,()=>{if(item.conversationId)selectConversation(item.conversationId);else page('things')})):
      [el('p','muted','还没有新的回复或同步提醒')]));
  }).catch(e=>{loading.textContent=safeError(e);loading.className='inline-error'});
}
function accountPage(target){target.append(heading('我的资料'));
  if(!state.loggedIn){target.append(notice('请登录或注册自己的账户后查看资料。旧的未绑定本机记录仍保留在手机，只有明确认领后才会归到某个账户。'),
    action('连接账户',()=>page('connect')));return}
  const loading=notice('正在读取资料…');target.append(loading);const gen=state.generation;
  call('auth.me').then(profile=>{if(state.page!=='account'||state.generation!==gen)return;loading.remove();state.profile=profile;
    if(profile.connectionVerified===false)target.append(notice('电脑暂时不可达，以下是此账户保存在手机上的资料。'));
    const avatar=el('div','profile-large');if(profile.avatar?.dataBase64){const img=el('img');img.src=`data:${profile.avatar.mimeType};base64,${profile.avatar.dataBase64}`;
      img.alt='当前头像';avatar.append(img)}else avatar.textContent=(profile.displayName||profile.username||'我').slice(0,1);
    target.append(avatar);const nickname=field('昵称','text',profile.displayName||profile.username);const groupNode=group('账户资料',[]);
    const body=groupNode.querySelector('.group-body');body.append(nickname.box,el('p','muted',`账户名：${profile.username}`));
    body.append(action('保存昵称',async()=>{try{const updated=await call('auth.profile',{expectedRevision:profile.profileRevision,displayName:nickname.input.value});
      state.profile=updated;showProfile(updated);toast(updated.localCacheSaved===false?'昵称已在电脑保存，本机离线副本未保存':'昵称已更新');page('account')}
      catch(e){toast(safeError(e),true)}}));
    body.append(action('更换头像',async()=>{try{await call('auth.chooseAvatar');toast('请从系统照片中选择头像')}
      catch(e){toast(safeError(e),true)}},false));target.append(groupNode);
    if(profile.avatar)body.append(action('移除头像',async()=>{try{const updated=await call('auth.profile',{expectedRevision:profile.profileRevision,avatar:null});
      state.profile=updated;showProfile(updated);toast('头像已移除');page('account')}catch(e){toast(safeError(e),true)}},false));
    if(state.loggedIn)target.append(group('账户保护',[row('修改密码','修改后其他设备需要重新登录',()=>page('password'))]));
  }).catch(e=>{loading.textContent=safeError(e);loading.className='inline-error'});
}
function passwordPage(target){target.append(heading('修改密码','修改成功后当前手机继续登录，其他设备需要重新登录。'));
  if(!state.loggedIn){target.append(notice('请先登录账户。'));return}
  const current=field('当前密码','password');const next=field('新密码（至少15个字符）','password');const check=field('再次输入新密码','password');
  const box=group('账户密码',[]);box.querySelector('.group-body').append(current.box,next.box,check.box,
    action('保存新密码',async()=>{if(next.input.value!==check.input.value){toast('两次输入的新密码不同',true);return}
      if([ ...next.input.value ].length<15||[ ...next.input.value ].length>128){toast('新密码需为15–128个字符',true);return}
      try{await call('auth.changePassword',{currentPassword:current.input.value,newPassword:next.input.value});
        current.input.value='';next.input.value='';check.input.value='';toast('密码已更新');page('account')}
      catch(e){current.input.value='';next.input.value='';check.input.value='';toast(safeError(e),true)}}));target.append(box)
}
function syncPage(target){target.append(heading('离线与同步'),notice(state.loggedIn?
  '当前账户的手机记录先保存在本机，联网后同步到同一账户。':'请先登录账户。归属不明的旧本机资料会保留，但不会自动交给新账户。'));
  if(!state.loggedIn){target.append(action('连接账户',()=>page('connect')));return}
  const labels={scheduled:'后台同步已安排；具体执行时间由Android决定。',
    not_scheduled:'后台同步未启用；本机记录仍保留，可手动同步。',unknown:'后台调度状态暂无法确认；可先手动同步。'};
  const job=notice(labels[state.backgroundSync]||labels.unknown,'后台同步');target.append(job);
  const jobGeneration=state.generation;call('sync.status').then(result=>{
    if(state.page!=='sync'||state.generation!==jobGeneration)return;
    state.backgroundSync=result.backgroundSync||'unknown';job.replaceChildren(el('strong','','后台同步'),
      el('span','',labels[state.backgroundSync]||labels.unknown));
  }).catch(()=>{if(state.page==='sync'&&state.generation===jobGeneration)
    job.replaceChildren(el('strong','','后台同步'),el('span','',labels.unknown))});
  target.append(action('立即同步',async()=>{try{const result=await call('sync.run');toast(`已同步：上传 ${result.uploaded}，接收 ${result.downloaded}`)}
    catch(e){toast(safeError(e),true)}}));
  const gen=state.generation;call('records.unboundSummary').then(info=>{
    if(state.page!=='sync'||state.generation!==gen||!info.eligible||info.conversationCount<1)return;
    const box=group('旧本机对话',[row(`${info.conversationCount} 个待认领的旧对话`,
      `仅升级前已确认属于 ${state.username} 的本机资料可归入当前账户`,()=>{
        const detail=notice(`将这 ${info.conversationCount} 个旧对话归入账户 ${state.username}。此操作会让它们进入该账户的同步队列。`,'确认归属');
        const confirmActions=el('div','form-actions');confirmActions.append(action('暂不认领',()=>{detail.remove();confirmActions.remove()},false),
          action('确认归入当前账户',async()=>{try{await call('records.claimUnbound',{expectedCount:info.conversationCount,
            confirmAccountName:state.username});toast('旧对话已归入当前账户');page('sync');await listConversations()}
            catch(e){toast(safeError(e),true)}}));box.after(detail,confirmActions)
      })]);target.append(box)
  }).catch(()=>{});
}
function appearancePage(target){target.append(heading('外观','同一套 Weave 组件会跟随选择同步变化。'));
  const options=[['system','跟随系统','随着设备浅色/深色模式切换'],['light','浅色','明亮的 Weave 界面'],['dark','深色','暗处阅读更舒适']];
  target.append(group('主题',options.map(([value,label,detail])=>row(`${label}${state.appearance===value?' · 当前':''}`,detail,async()=>{
    try{const saved=await call('settings.appearance',{value});applyTheme(saved.value);page('appearance')}catch(e){toast(safeError(e),true)}}))));
}
async function updatesPage(target){target.append(heading('界面更新','常规界面可从个人服务端更新；新增原生能力仍需更新应用。'));
  let details;try{details=await call('updates.status')}catch(e){target.append(notice(safeError(e)));return}
  target.append(group('版本',[row('当前界面',details.activeVersion,()=>{}),row('原生应用',details.nativeVersion,()=>{})]));
  const install=group('本设备安装',[]),installBody=install.querySelector('.group-body'),
    downloadUrl='https://www.weftmate.com/downloads/?platform=android',
    link=el('a','native-download-link','在官网查看安卓安装包'),qr=el('img','native-download-qr');
  link.setAttribute('href',downloadUrl);link.setAttribute('aria-label','打开 WeftMate 官网安卓下载页面');
  qr.src='qr/android.svg';qr.alt='WeftMate 官网安卓下载页面二维码';qr.width=168;qr.height=168;
  installBody.append(el('p','muted','当前是 Android 设备。原生更新需要从官网下载安装包并手动覆盖安装。'),link,qr,
    el('p','muted native-download-qr-note','也可以用另一台设备扫描二维码打开同一个安卓下载页面。'));
  target.append(install);
  if(!state.loggedIn){target.append(notice('登录账户后才会检查服务端界面；内置页面仍可打开登录与注册。'),
    action('连接账户',()=>page('connect')));return}
  target.append(group('更新方式',[row(`自动更新界面 · ${details.autoEnabled?'已开启':'已关闭'}`,
    '有草稿或正在回复时先下载，空闲后应用；可随时手动检查',async()=>{
      try{const preference=await call('updates.preference',{autoEnabled:!details.autoEnabled});
        details.autoEnabled=preference.autoEnabled;page('updates')}
      catch(e){toast(safeError(e),true)}})]));
  if(details.releaseNotes)target.append(notice(details.releaseNotes,'新版说明'));
  if(details.stagedVersion)target.append(notice(details.pendingReason==='draft'?'当前账户还有未发送草稿，已暂缓应用新界面。':
    details.pendingReason==='running'?'当前回复仍在进行，完成后再应用新界面。':
    details.pendingReason==='switching'?'正在切换账户，稍后再应用新界面。':
    details.autoEnabled?'新版界面已下载，将在空闲时自动应用。':'新版界面已下载，可手动应用。','待应用更新'));
  const controls=el('div','form-actions');controls.append(action('检查更新',async()=>{try{const result=await call('updates.check');state.ui=result;
    toast(result.stagedVersion?`新界面 ${result.stagedVersion} 已下载`:'已经是当前界面');page('updates')}
    catch(e){toast(safeError(e),true)}}));
  if(details.stagedVersion)controls.append(action('应用新界面',async()=>{try{await call('updates.apply',{hasDraft:!!$('draft').value.trim()});toast('界面已更新')}
    catch(e){toast(safeError(e),true)}},false));target.append(controls);
  if(details.previousAvailable)target.append(group('恢复',[row('退回上一版','已保存的上一个完整界面包',async()=>{
    try{await call('updates.rollback',{hasDraft:!!$('draft').value.trim()})}catch(e){toast(safeError(e),true)}})]));
  if(details.lastError)target.append(el('p','inline-error',/^[A-Z_]+$/.test(details.lastError)?
    safeError(new Error(details.lastError)):details.lastError));
  if(details.lastError==='UI_UPDATE_REJECTED')target.append(action('重新下载这个版本',async()=>{
    try{await call('updates.retryRejected');const result=await call('updates.check');state.ui=result;toast(result.stagedVersion?'新界面已重新下载':'已检查界面版本');page('updates')}
    catch(e){toast(safeError(e),true)}},false));
}
async function phoneAction(kind){if(kind==='settings'){
    try{const result=await call('tools.execute',{name:'open_settings',conversationId:state.conversationId||''});
      selectConversation(result.conversationId);toast(`系统设置：${receiptStatus(result.status)}`);await listConversations();await renderConversation()}
    catch(e){toast(safeError(e),true)}return}
  const target=$('page-content');clear(target);target.append(heading('打开手机应用','从系统可启动应用中选择，不需要填写包名。'));
  const loading=notice('正在读取这台手机的应用…');target.append(loading);
  try{const result=await call('tools.apps');loading.remove();const apps=(result.apps||[]).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
    target.append(group('可启动应用',apps.map(app=>row(app.name,'在这台手机打开',async()=>{
      try{const opened=await call('tools.execute',{name:'open_app',packageName:app.packageName,conversationId:state.conversationId||''});
        selectConversation(opened.conversationId);toast(`${app.name}：${receiptStatus(opened.status)}`);await listConversations();await renderConversation()}
      catch(e){toast(safeError(e),true)}}))));
  }catch(e){loading.textContent=safeError(e);loading.className='inline-error'}
}
function handleBack(){if(!$('image-preview').hidden){closeImagePreview();return}
  if(state.attachmentMenu){closeAttachmentMenu({restoreFocus:true});return}if(state.attachmentPick){cancelAttachmentPick({announce:true});return}if(state.menu){closeModelMenu();$('model-button').focus();return}
  if(state.drawer){closeDrawer();$('menu-button').focus();return}if(state.page==='things'&&state.thingsDetail){returnFromTaskDetail();return}
  if(state.page!=='chat'){page('chat');return}if(document.activeElement===$('draft'))$('draft').blur()}
document.addEventListener('DOMContentLoaded',()=>{
  $('menu-button').addEventListener('click',openDrawer);$('drawer-close').addEventListener('click',closeDrawer);$('drawer-scrim').addEventListener('click',closeDrawer);
  $('things-button').addEventListener('click',()=>page('things'));$('profile-link').addEventListener('click',()=>page('settings'));
  document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>page(button.dataset.page)));
  document.querySelector('[data-action="new-chat"]').addEventListener('click',()=>selectConversation(null));
  $('conversation-search').addEventListener('input',renderConversationList);
  $('draft').addEventListener('input',updateComposer);$('send-button').addEventListener('click',send);$('stop-button').addEventListener('click',stop);
  $('model-button').addEventListener('click',openModels);$('plus-button').addEventListener('click',openAttachmentMenu);
  $('pick-image').addEventListener('click',()=>pickAttachment('image'));$('pick-file').addEventListener('click',()=>pickAttachment('file'));
  $('attachment-pick-cancel').addEventListener('click',()=>cancelAttachmentPick({announce:true}));
  $('image-preview-close').addEventListener('click',()=>closeImagePreview());
  $('image-preview').addEventListener('click',event=>{if(event.target===$('image-preview')||event.target.classList?.contains('image-preview-stage'))closeImagePreview()});
  $('toast').addEventListener('click',closeToast);
  $('voice-button').addEventListener('click',async()=>{try{await call('voice.start',{conversationId:state.chatSource==='host'?'':state.conversationId||'',viewGeneration:state.generation});
      status('等待系统语音输入；识别结果只会填入草稿')}catch(e){status(safeError(e),true)}});
  $('jump-latest').addEventListener('click',()=>{state.scrollPinned=true;scrollBottom(true)});
  $('chat-scroll').addEventListener('scroll',handleChatScroll);
  document.addEventListener('click',event=>{if(state.menu&&!$('model-popover').contains(event.target)&&!$('model-button').contains(event.target))closeModelMenu();
    if(state.attachmentMenu&&!$('attachment-popover').contains(event.target)&&!$('plus-button').contains(event.target))closeAttachmentMenu()});
  window.addEventListener('weft-back',handleBack);window.addEventListener('keydown',event=>{if(event.key==='Escape')handleBack()});
  window.addEventListener('resize',()=>{if(state.menu)placeModelMenu();if(state.attachmentMenu)placeAttachmentMenu();syncChatInsets()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){stopSharedPoll();
      clearTimeout(toolApprovals.pollTimer);toolApprovals.pollTimer=null;clearTimeout(toolQuestions.pollTimer);toolQuestions.pollTimer=null}
    else if(state.chatSource==='host'&&state.page==='chat'){void loadSharedHistory();scheduleSharedPoll()}
    else{if(toolApprovals.detail&&approvalViewCurrent(toolApprovals.detail.context))void refreshToolApprovals(toolApprovals.detail.context);
      if(toolQuestions.detail&&approvalViewCurrent(toolQuestions.detail.context))void refreshToolQuestions(toolQuestions.detail.context)}});
  if(window.ResizeObserver)new ResizeObserver(syncChatInsets).observe($('composer-dock'));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.appearance==='system')applyTheme('system')});
  boot();
});
