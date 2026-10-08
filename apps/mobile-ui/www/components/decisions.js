/* Mobile decisions presentation. Shared data and actions are supplied by ui-core. */
const approvalModes=[
  {mode:'auto',label:'自动（推荐）',short:'自动',description:'由 WeftMate 判断，有风险才问你'},
  {mode:'ask',label:'每次询问',short:'每次询问',description:'执行和修改前都先问'},
  {mode:'accept-edits',label:'自动接受文件修改',short:'接受修改',description:'改文件直接做，其他照常询问'},
  {mode:'plan',label:'先出计划',short:'先出计划',description:'先给计划，你确认后再做'},
  {mode:'allow-all',label:'全部允许',short:'全部允许',description:'不再询问，危险操作也会直接执行'}];
const approvalModeState={key:null,mode:null,loading:false,error:'',menu:null,confirmation:null,revision:0};
const approvalRiskNames={delete:'删除文件',overwrite:'覆盖文件',system:'修改系统',install:'安装软件',external:'发送或发布',spend:'付款',execute:'执行脚本'};
function conversationTaskContext(){return uiCore.mobileDecisions.context()}
function conversationTaskCurrent(context){return uiCore.mobileDecisions.current(context)}
function approvalDeviceId(){return uiCore.mobileDecisions.deviceId()}
function approvalContext(sessionId=conversationTaskContext().sessionId,taskId=null){return {...conversationTaskContext(),sessionId,taskId,page:state.page,deviceId:approvalDeviceId()}}
function approvalViewCurrent(context){return uiCore.mobileDecisions.current(context,true)}
function approvalModeContext(defaults=false){return {...conversationTaskContext(),page:state.page,defaults}}
function approvalModeCurrent(context){return uiCore.mobileDecisions.modeCurrent(context)}
function approvalTerminal(row){return row?.status==='resolved'||row?.status==='unavailable'}
function approvalScopeCurrent(context){return uiCore.mobileDecisions.scopeCurrent(context)}
function questionScopeCurrent(context){return uiCore.mobileDecisions.scopeCurrent(context,true)}
function relatedTaskApproval(task,row){return uiCore.mobileDecisions.related(task,row)}
function approvalAttempt(context,row){return uiCore.mobileDecisions.approvalAttempt(context,row)}
function questionAttempt(context,row){return uiCore.mobileDecisions.questionAttempt(context,row)}
function questionDraft(context,row){return uiCore.mobileDecisions.questionDraft(context,row)}
function canonicalQuestionAnswer(answer,questions){return uiCore.mobileDecisions.canonicalAnswer(answer,questions)}
function normalizedApproval(row){return uiCore.validApproval(row,row?.sessionId)?row:null}
function normalizedQuestionBatch(row){return uiCore.validQuestion(row,row?.sessionId)?row:null}
function relatedExecutionSteps(task){return uiCore.relatedExecutionSteps(task)}
function executionProgress(step){return uiCore.executionProgress(step)}
function executionName(step){return uiCore.executionName(step)}
function taskApprovals(task,context){return uiCore.mobileDecisions.rows(context).filter(row=>relatedTaskApproval(task,row))}
function taskQuestions(task,context){return uiCore.mobileDecisions.rows(context,true).filter(row=>relatedTaskApproval(task,row))}
function stopApprovalObservation(){clearTimeout(toolApprovals.pollTimer);toolApprovals.pollTimer=null;toolApprovals.detail=null}
function stopQuestionObservation(){clearTimeout(toolQuestions.pollTimer);toolQuestions.pollTimer=null;toolQuestions.detail=null}
function resetToolApprovals(){stopApprovalObservation();uiCore.mobileDecisions.reset()}
function resetToolQuestions(){stopQuestionObservation();uiCore.mobileDecisions.reset(true)}
async function refreshToolApprovals(context=approvalContext(),{force=false}={}){return uiCore.mobileDecisions.refresh(context,force)}
async function refreshToolQuestions(context=approvalContext(),{force=false}={}){return uiCore.mobileDecisions.refresh(context,force,true)}
async function refreshConversationTasks(){return uiCore.mobileDecisions.refreshTasks()}
async function decideToolApproval(row,outcome,context=approvalContext(),restoreFocus=false,scope=outcome==='allowed-once'?'once':undefined){
  await uiCore.mobileDecisions.submitApproval(context,row,outcome,scope);
  if(restoreFocus&&approvalViewCurrent(context))$('draft').focus({preventScroll:true})}
async function answerToolQuestion(row,answer,context=approvalContext(),restoreFocus=false){
  await uiCore.mobileDecisions.submitQuestion(context,row,answer);
  if(restoreFocus&&approvalViewCurrent(context))$('draft').focus({preventScroll:true})}
function closeApprovalModeMenu({restoreFocus=false}={}){const menu=approvalModeState.menu;approvalModeState.menu=null;
  $('approval-mode-popover').hidden=true;$('approval-mode-button').setAttribute('aria-expanded','false');
  if(restoreFocus)menu?.trigger?.focus({preventScroll:true})}

function closeApprovalRisk({restoreFocus=true}={}){const confirmation=approvalModeState.confirmation;
  approvalModeState.confirmation=null;$('approval-risk-dialog').hidden=true;
  if(restoreFocus&&confirmation&&approvalModeCurrent(confirmation.context))confirmation.trigger?.focus({preventScroll:true})}

function updateApprovalModeButton(){if(state.page!=='chat')return;const context=approvalModeContext(),key=JSON.stringify(context),button=$('approval-mode-button');
  button.disabled=!state.loggedIn||state.transitionPending||state.restorePending;
  if(approvalModeState.key!==key){closeApprovalModeMenu();closeApprovalRisk({restoreFocus:false});
    approvalModeState.key=key;approvalModeState.mode=null;approvalModeState.error='';approvalModeState.loading=false;
    if(context.sessionId&&state.loggedIn&&!state.transitionPending)void loadApprovalMode(context)}
  const mode=approvalModes.find(item=>item.mode===approvalModeState.mode);
  $('approval-mode-label').textContent=mode?.short||'审批';
  button.setAttribute('aria-label',`审批模式${mode?`：${mode.label}`:''}`)}

async function loadApprovalMode(context){const key=JSON.stringify(context),revision=++approvalModeState.revision;approvalModeState.loading=true;
  const current=()=>approvalModeCurrent(context)&&approvalModeState.key===key&&approvalModeState.revision===revision;
  try{const result=await uiCore.mobileDecisions.readMode(context);
    if(!current())return false;
    if(!approvalModes.some(item=>item.mode===result?.mode))throw new Error('APPROVAL_RECEIPT_INVALID');
    approvalModeState.mode=result.mode;approvalModeState.error='';return true
  }catch(e){if(current())approvalModeState.error=safeError(e);return false}
  finally{if(current()){approvalModeState.loading=false;
    if(!context.defaults)updateApprovalModeButton();if(approvalModeState.menu)renderApprovalModeMenu()}}}

function placeApprovalModeMenu(){const menu=approvalModeState.menu;if(menu)globalThis.WeftPopover.position($('approval-mode-popover'),menu.trigger)}

function renderApprovalModeMenu(){const menu=approvalModeState.menu;if(!menu)return;const popup=$('approval-mode-popover');clear(popup);
  popup.append(el('h3','',menu.context.defaults?'新电脑对话的默认模式':'这段对话的审批模式'));
  if(!menu.context.defaults&&!menu.context.sessionId){popup.append(el('p','hint','审批模式用于电脑执行。进入电脑会话或将这段对话交给电脑后，可单独设置。'));
    const settings=el('button','','设置默认模式');settings.addEventListener('click',()=>page('settings'));popup.append(settings);placeApprovalModeMenu();return}
  if(approvalModeState.loading)popup.append(el('p','hint','正在读取…'));
  if(approvalModeState.error){const message=el('p','inline-error',`${approvalModeState.error} · 请重试`);popup.append(message);
    const retry=el('button','','重新读取');retry.addEventListener('click',()=>{void loadApprovalMode(menu.context)});popup.append(retry)}
  for(const item of approvalModes){const button=el('button','approval-mode-option');button.type='button';button.dataset.mode=item.mode;
    button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(approvalModeState.mode===item.mode));
    button.disabled=approvalModeState.loading||!!approvalModeState.error;
    const copy=el('span','approval-mode-copy');copy.append(el('strong','',item.label),el('small','',item.description));
    const check=el('span',approvalModeState.mode===item.mode?'icon icon-check':'mode-check-space');check.setAttribute('aria-hidden','true');
    button.append(copy,check);button.addEventListener('click',()=>chooseApprovalMode(item.mode,menu));popup.append(button)}placeApprovalModeMenu()}

async function openApprovalModes(defaults=false,trigger=$('approval-mode-button')){if(!state.loggedIn||state.transitionPending)return;
  if(approvalModeState.menu){closeApprovalModeMenu({restoreFocus:true});return}
  closeModelMenu();closeAttachmentMenu();const context=approvalModeContext(defaults);
  approvalModeState.key=JSON.stringify(context);approvalModeState.mode=null;approvalModeState.error='';
  approvalModeState.loading=defaults||!!context.sessionId;approvalModeState.menu={context,trigger};
  $('approval-mode-popover').hidden=false;if(!defaults)trigger.setAttribute('aria-expanded','true');renderApprovalModeMenu();
  if(approvalModeState.loading)await loadApprovalMode(context);
  if(approvalModeState.menu?.context===context)$('approval-mode-popover').querySelector('[aria-checked="true"]')?.focus({preventScroll:true})}

function chooseApprovalMode(mode,menu){if(!approvalModeCurrent(menu.context)||approvalModeState.loading)return;
  if(mode==='allow-all'){closeApprovalModeMenu();approvalModeState.confirmation=menu;
    $('approval-risk-scope').textContent=menu.context.defaults?'作为新电脑对话的默认模式；已有对话保持原模式。':'仅应用于这段对话。';
    $('approval-risk-dialog').hidden=false;$('approval-risk-cancel').focus({preventScroll:true});return}
  void saveApprovalMode(mode,menu)}

async function saveApprovalMode(mode,menu){if(!approvalModeCurrent(menu.context))return;
  const revision=++approvalModeState.revision,current=()=>approvalModeCurrent(menu.context)&&approvalModeState.revision===revision;
  approvalModeState.loading=true;closeApprovalRisk({restoreFocus:false});renderApprovalModeMenu();
  try{const result=await uiCore.mobileDecisions.saveMode(menu.context,mode);
    if(!current())return;if(result?.mode!==mode)throw new Error('APPROVAL_RECEIPT_INVALID');
    approvalModeState.mode=mode;closeApprovalModeMenu();menu.trigger.focus({preventScroll:true});
    if(menu.context.defaults){menu.trigger.textContent=`默认审批模式 · ${approvalModes.find(item=>item.mode===mode).label}`;
      toast('默认模式已保存，已有对话保持原模式')}else updateApprovalModeButton()
  }catch(e){if(current()){toast(`${safeError(e)} · 请重新读取模式`,true);closeApprovalModeMenu();
      approvalModeState.mode=null;approvalModeState.error=safeError(e);if(!menu.context.defaults)updateApprovalModeButton()}}
  finally{if(current())approvalModeState.loading=false}}

function approvalOperation(row){return {pwsh:'运行命令',read:'读取文件',write:'写入文件',edit:'修改文件',glob:'查找文件',grep:'搜索内容',
  shell:'运行命令',bash:'运行命令',weftmod:'设备操作',weftmod_script:'运行脚本',job_kill:'停止后台任务'}[row.toolName]||row.toolName}

function approvalRiskCategories(row){return Array.isArray(row.riskCategories)?row.riskCategories.filter(value=>Object.hasOwn(approvalRiskNames,value)):[]}

function approvalRiskCopy(row){const categories=approvalRiskCategories(row);
  const names=categories.map(value=>approvalRiskNames[value]);
  return `${names.length?`风险类别：${names.join('、')}。`:'风险类别：未标明。'}${
    categories.some(value=>['delete','overwrite','external','spend'].includes(value))?'可能无法撤销，请先确认影响范围。':'能否撤销取决于实际操作，请先确认影响范围。'}`}

function approvalRecord(row){const outcome=row.outcome||row.decisionOutcome;
  return `${outcome==='allowed-once'?(row.decisionScope==='conversation-category'?'已总是允许此类':'已允许'):
    outcome==='rejected'?'已拒绝':outcome==='cancelled'?'已取消':'审批已失效'} · ${approvalOperation(row)}`}

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
  const resolving=card.dataset.approvalId&&!card.classList.contains('is-resolved')&&row.status!=='pending';
  const copy=resolving?globalThis.WeftMobileMotion?.snapshot(card):null;
  const entering=!card.dataset.approvalId;card.dataset.signature=signature;clear(card);card.dataset.approvalId=row.approvalId;card.dataset.taskId=row.taskId;
  if(row.status!=='pending'&&!(row.status==='answered'&&cache.error)){
    card.classList.add('is-resolved');const record=el('p','approval-status',approvalRecord(row));record.setAttribute('role','status');
    record.setAttribute('aria-live','polite');record.setAttribute('aria-label',`${approvalRecord(row)}。${approvalMeaning(row,cache,attempt)}`);
    card.append(record);globalThis.WeftMobileMotion?.dismiss(copy,true);if(hadFocus){record.setAttribute('tabindex','-1');record.focus({preventScroll:true})}return}
  if(entering)globalThis.WeftMobileMotion?.reveal(card,'base');
  card.append(el('strong','approval-title',`${row.status==='pending'?'需要审批':'审批记录'} · ${approvalOperation(row)}`));
  if(row.status==='pending'){const presentation=uiCore.approvalPresentation(row),description=el('p','approval-reason',presentation.summary);
    card.append(description);if(presentation.reason)card.append(el('p','approval-risk-copy',presentation.reason));
    const details=el('details','approval-detail'),raw=el('pre','timeline-raw');
    raw.textContent=typeof presentation.raw==='string'?presentation.raw:JSON.stringify(presentation.raw,null,2);
    details.append(el('summary','','详情'),raw);card.append(details);
    void uiCore.readApprovalPresentation(row).then(value=>{if(!approvalViewCurrent(context)||card.dataset.approvalId!==row.approvalId||!card.contains?.(description))return;
      description.textContent=value.summary;raw.textContent=typeof value.raw==='string'?value.raw:JSON.stringify(value.raw,null,2);});}
  if(row.status==='pending')card.append(el('p','approval-risk-copy',approvalRiskCopy(row)));
  card.classList.toggle('is-resolved',approvalTerminal(row));
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
      if(attempt?.unknown)add(attempt.outcome==='allowed-once'?(attempt.scope==='conversation-category'?'重试总是允许此类':'重试允许一次'):'重试拒绝',attempt.outcome,
        restoreFocus=>decideToolApproval(row,attempt.outcome,context,restoreFocus,attempt.scope),attempt.outcome==='allowed-once');
      else{add('允许一次','allowed-once',restoreFocus=>decideToolApproval(row,'allowed-once',context,restoreFocus),true);
        add('总是允许此类','conversation-category',restoreFocus=>decideToolApproval(row,'allowed-once',context,restoreFocus,'conversation-category'));
        controls.children[1].disabled=!approvalRiskCategories(row).length;
        controls.children[1].title=approvalRiskCategories(row).length?'仅允许这段对话后续的同类操作':'这次审批未提供风险类别，可选择允许一次';
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
    const timelineAnchor=[...content.children].find(node=>node.dataset?.timelineApproval===row.approvalId);
    const anchor=timelineAnchor||[...content.children].find(node=>node.dataset?.receiptId===row.sourceReceiptId);if(!anchor)continue;
    visible.add(row.approvalId);let card=[...content.children].find(node=>node.dataset?.approvalId===row.approvalId);
    if(!card)card=el('section','tool-approval conversation-approval');
    let next=anchor.nextSibling;while(next&&(next.dataset?.conversationTask||next.dataset?.approvalId&&next.dataset.approvalId!==row.approvalId))next=next.nextSibling;
    if(timelineAnchor){timelineAnchor.hidden=true;card.dataset.seq=timelineAnchor.dataset.seq;next=timelineAnchor}if(card!==next)content.insertBefore(card,next);fillApprovalCard(card,row,context,cache)}
  for(const node of [...content.children])if(node.dataset?.approvalId&&!visible.has(node.dataset.approvalId))node.remove();
  if(state.scrollPinned)scrollBottom();else if(scroll.scrollTop!==scrollTop)scroll.scrollTop=scrollTop}

function renderApprovalView(context){if(approvalViewCurrent(context))renderConversationApprovals()}

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
        const answer=uiCore.mobileDecisions.chooseOption(context,row,index,option.label,input.checked);if(!answer)return;
        custom.value=answer.custom;for(const other of choices)other.checked=answer.selected.includes(other.value)})}
    const customLabel=el('label','question-custom-label',(question.options||[]).length?'自行填写':'你的回答'),custom=el('textarea','question-custom');
    custom.value=entry.custom;custom.rows=2;custom.dataset.questionIndex=String(index);custom.dataset.questionField='custom';
    custom.setAttribute('aria-label',`${question.header||question.question} · ${(question.options||[]).length?'自行填写':'你的回答'}`);
    custom.addEventListener('input',()=>{if(!editable||!approvalViewCurrent(context))return;
      const answer=uiCore.mobileDecisions.setCustom(context,row,index,custom.value);if(!answer)return;
      for(const input of choices)input.checked=answer.selected.includes(input.value)});
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
  if(controls.children.length)form.append(controls);form.hidden=approvalTerminal(row);card.classList.toggle('is-resolved',form.hidden);card.append(form);
  if(ownsFocus&&focusedField==='custom'){const next=fields.find(input=>input.dataset.questionIndex===focusedIndex);if(next&&!next.disabled&&editable)next.focus({preventScroll:true})}}

function renderConversationQuestions(){const context=approvalContext(),content=$('chat-content');if(!approvalViewCurrent(context)||!questionScopeCurrent(context))return;
  const cache=toolQuestions.sessions.get(context.sessionId);if(!cache)return;const scroll=$('chat-scroll'),scrollTop=scroll.scrollTop,visible=new Set();
  for(const row of [...cache.rows.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.questionRpcId.localeCompare(b.questionRpcId))){
    if(!relatedTaskApproval(conversationTasks.entries.get(row.taskId)?.task,row))continue;
    const questionEvent=(state.chatSource==='phone'?state.linkedEvents.get(context.conversationId)?.events||[]:state.sharedEvents).filter(e=>e.type==='question.asked'&&e.data?.turn===row.turn&&Number.isSafeInteger(row.observedSeq)&&e.seq<=row.observedSeq).sort((a,b)=>b.seq-a.seq)[0];
    const timelineAnchor=questionEvent&&[...content.children].find(node=>node.dataset?.timelineQuestion===questionEvent.data.callId);
    const anchor=timelineAnchor||[...content.children].find(node=>node.dataset?.receiptId===row.sourceReceiptId);if(!anchor)continue;
    visible.add(row.questionRpcId);let card=[...content.children].find(node=>node.dataset?.questionRpcId===row.questionRpcId);
    if(!card)card=el('section','tool-question conversation-question');let next=anchor.nextSibling;
    while(next&&(next.dataset?.conversationTask||next.dataset?.approvalId||next.dataset?.questionRpcId&&next.dataset.questionRpcId!==row.questionRpcId))next=next.nextSibling;
    if(timelineAnchor){timelineAnchor.hidden=true;card.dataset.seq=timelineAnchor.dataset.seq;next=timelineAnchor}if(card!==next)content.insertBefore(card,next);fillQuestionCard(card,row,context,cache)}
  for(const child of [...content.children])if(child.dataset?.questionRpcId&&!visible.has(child.dataset.questionRpcId))child.remove();
  if(state.scrollPinned)scrollBottom();else if(scroll.scrollTop!==scrollTop)scroll.scrollTop=scrollTop}

function renderQuestionView(context){if(approvalViewCurrent(context))renderConversationQuestions()}

function taskReplyProgress(reply){if(reply?.status==='failed'&&reply.endReasonKind==='max-tokens')return '因输出限制结束，尚未确认完整交付';
  return {waiting:'等待模型回复',streaming:'模型正在回复，尚无结束记录',
  completed:reply?.assistantMessages>0?'回复回合已正常结束':'回合已结束，未见最终文字回复',aborted:'回复回合已中断',
  blocked:'模型请求被阻断',failed:'模型回合未完成',unconfirmed:'回复结束状态待核对'}[reply?.status]||'回复结束状态待核对'}

function renderConversationTasks(){const context=conversationTaskContext(),content=$('chat-content');
  renderQueuedTasks();
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
    for(const artifact of artifacts)appendTimelineArtifact(card,artifact,context);
    if(artifacts.length)card.append(el('p','conversation-task-result',verified.length?`${verified.length} 个成果文件已读回核验`:'成果文件仍待核验'));
    const controls=el('div','conversation-task-actions'),detail=el('button','secondary',verified.length?'查看来源与成果':'查看来源与成果');detail.type='button';
    detail.addEventListener('pointerdown',()=>{detail.dataset.restoreFocus=document.activeElement===$('draft')?'1':'0'});
    detail.addEventListener('pointercancel',()=>{delete detail.dataset.restoreFocus});
    detail.addEventListener('click',()=>{const restoreFocus=detail.dataset.restoreFocus==='1';delete detail.dataset.restoreFocus;if(conversationTaskCurrent(context))inlineTaskInfo(entry.taskId,detail)});controls.append(detail);
    if(entry.notice){const retry=el('button','quiet','重新核对进展');retry.type='button';
      retry.addEventListener('click',()=>{if(conversationTaskCurrent(context))void refreshConversationTasks()});controls.append(retry)}card.append(controls)
  }renderConversationApprovals();renderConversationQuestions();if(state.scrollPinned)scrollBottom();else if(scroll.scrollTop!==previousScroll)scroll.scrollTop=previousScroll}
