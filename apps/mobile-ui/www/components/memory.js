function paintChatMemoryAvailability(value) {
  let node=$('chat-memory-notice');
  if(!node){node=el('p','muted');node.id='chat-memory-notice';node.setAttribute('role','status');node.setAttribute('aria-live','polite');$('chat-page').prepend(node)}
  node.hidden=!state.loggedIn||value?.state!=='unavailable';
  node.textContent=node.hidden?'':'记忆暂时不可用，普通对话已保存，恢复后会自动补交。';
}
async function exportMyMemories(format) {
  const owner=state.owner,epoch=state.authEpoch;
  try { const result=await uiCore.mobile.business({path:`/personal/v1/memory/export?format=${format}`,method:'GET'});
    if(owner!==state.owner||epoch!==state.authEpoch)return;
    const url=URL.createObjectURL(new Blob([result.content],{type:`${result.contentType};charset=utf-8`}));
    const link=el('a');link.href=url;link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){if(owner===state.owner&&epoch===state.authEpoch){state.memory.error=memoryFailureText(error);renderMemoryList(memoryTarget)}}
}
/* Mobile memory presentation and named ui-core actions. */
function emptyMemoryState(...args){return uiCore.mobile.emptyMemoryState(...args)}

function resetMemoryForAuthBoundary(message='账户状态已变化，记忆显示已清除。'){
  const scope=state.owner||'';state.memory=emptyMemoryState(scope);
  if(state.page==='memory'){const target=$('page-content');clear(target);target.append(heading('记忆'),notice(message,'账户状态'));
    target.append(action('返回账户连接',()=>page('connect'),false))}
}

function memoryToken(...args){return uiCore.mobile.memoryToken(...args)}

function memoryCurrent(...args){return uiCore.mobile.memoryCurrent(...args)}

function memoryFailureText(...args){return uiCore.mobile.memoryFailureText(...args)}

function memoryFail(...args){return uiCore.mobile.memoryFail(...args)}

function memoryOwnerMatches(...args){return uiCore.mobile.memoryOwnerMatches(...args)}

function memoryRevisionMatches(...args){return uiCore.mobile.memoryRevisionMatches(...args)}

function memoryPathEncode(...args){return uiCore.mobile.memoryPathEncode(...args)}

function memoryItemsPath(...args){return uiCore.mobile.memoryItemsPath(...args)}

function memoryListAllowed(...args){return uiCore.mobile.memoryListAllowed(...args)}

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

function memoryIngestionPanel(target){
  const section=el('section','memory-ingestion'),health=el('p','muted',uiCore.memoryHealthText(state.memory.healthStatus));
  health.id='mobile-memory-health';health.setAttribute('role','status');
  const progress=el('p','muted');progress.id='mobile-memory-progress';progress.setAttribute('role','status');
  const message=el('p','muted'),actions=el('div','form-actions');
  const token=memoryToken();let prepared=null,busy=false,job=state.memory.healthStatus?.backfill;
  const preview=action('整理过去的对话',async()=>{
    preview.disabled=true;message.textContent='正在统计可整理的过去对话…';
    try{const value=await uiCore.mobile.business({path:'/personal/v1/memory/backfill',method:'GET'});if(!memoryCurrent(token))return;
      prepared=value;message.textContent=!value.turnCount?'过去的对话已全部整理，没有需要补的回合。':`可整理 ${value.sessionCount} 个会话、${value.turnCount} 个回合。预计输入约 ${value.estimatedUsage.inputTokens.toLocaleString()}、输出约 ${value.estimatedUsage.outputTokens.toLocaleString()} 个词元；实际用量取决于模型与重试。跳过临时对话、已关闭记忆的对话及已遗忘内容。`;confirm.hidden=!value.turnCount;
    }catch{if(memoryCurrent(token))message.textContent='统计失败，请检查连接后重试。'}finally{preview.disabled=false;}
  },false);
  async function change(body){busy=true;for(const b of [preview,confirm,pause,cancel])b.disabled=true;
    try{await uiCore.mobile.business({path:'/personal/v1/memory/backfill',method:'POST',body});if(!memoryCurrent(token))return;confirm.hidden=true;message.textContent='';}
    catch{if(memoryCurrent(token))message.textContent='操作未确认，请刷新核对进度后重试。';}
    finally{busy=false;for(const b of [preview,confirm,pause,cancel])b.disabled=false;await refresh();}}
  const confirm=action('确认开始整理',()=>{if(prepared)void change({action:'start',previewId:prepared.previewId,confirm:true})},true);confirm.hidden=true;
  const pause=action('暂停整理',()=>{if(job)void change({action:job.state==='paused'?'resume':'pause',jobId:job.id})},false);
  const cancel=action('取消整理',()=>{if(job)void change({action:'cancel',jobId:job.id})},false);
  function paint(value){job=value?.backfill;health.textContent=uiCore.memoryHealthText(value);
    const active=job&&['running','paused'].includes(job.state);preview.disabled=busy||!!active;pause.hidden=cancel.hidden=!active;
    pause.textContent=job?.state==='paused'?'继续整理':'暂停整理';
    progress.textContent=job?`${({running:'正在补整理',paused:'已暂停',cancelled:'已取消',completed:'补交完成'})[job.state]}：已提交 ${job.submittedTurns-job.skippedTurns} / ${job.totalTurns} 回合。${active?'暂停或取消后不再提交后续回合；已提交的回合继续整理。':''}`:'';
  }
  async function refresh(){if(!memoryCurrent(token)||!section.isConnected||busy)return;
    try{const value=await uiCore.mobile.business({path:'/personal/v1/memory/status',method:'GET'});if(memoryCurrent(token)&&section.isConnected){state.memory.healthStatus=value;paint(value)}}catch{if(memoryCurrent(token))health.textContent='记忆状态暂时无法读取，请刷新重试。';}}
  actions.append(preview,confirm,pause,cancel);section.append(health,actions,message,progress);target.append(section);paint(state.memory.healthStatus);
  const poll=async()=>{if(!section.isConnected||!memoryCurrent(token))return;await refresh();setTimeout(poll,3000);};setTimeout(poll,3000);
}

function renderMemoryList(target=memoryTarget){target=memoryTarget;if(!target||state.page!=='memory')return;const memory=state.memory;clear(target);
  target.append(heading('记忆','查看当前账户的理解与来源；整理过去的对话，或在详情中纠正、停用与忘掉。'));
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
  memoryIngestionPanel(target);
  const form=el('form');form.append(search.box,category);
  form.addEventListener('submit',event=>{event.preventDefault();memory.queryDraft=search.input.value;
    const query=search.input.value.trim();if([...query].length>120){memory.error='搜索内容最多120个字符，请缩短后重试。';renderMemoryList(target);return}
    startMemorySnapshot(target,memory.kind,query)});
  const actions=el('div','form-actions');const submit=action('搜索',()=>{},true);submit.type='submit';
  const refresh=action(memory.loading?'正在刷新…':'刷新',()=>startMemorySnapshot(target,memory.kind,memory.query),false);refresh.type='button';refresh.disabled=memory.loading;
  actions.append(submit,refresh);form.append(actions);target.append(form);
  if(memoryListAllowed(memory)){target.append(action('导出我的记忆 · JSON',()=>exportMyMemories('json'),false),action('导出我的记忆 · Markdown',()=>exportMyMemories('markdown'),false))}
  if(memory.pendingBoundaryCount>0)target.append(notice(`有 ${memory.pendingBoundaryCount} 条来源尚未处理${memory.blockedBoundaryCount>0?`，其中 ${memory.blockedBoundaryCount} 条已暂停自动处理`:''}。恢复后会按顺序自动补交。`,'来源待处理'));
  if(memory.lastFailureCode==='MEMORY_SOURCE_DELETED'&&memory.discardedBoundaryCount>0)
    target.append(notice(`${memory.discardedBoundaryCount} 条来源已删除；这不表示仍有待处理来源。`,'来源状态'));
  else if(memory.lastFailureCode&&memory.lastFailureCode!=='MEMORY_SOURCE_DELETED')
    target.append(notice('最近来源处理状态见上方记忆健康；恢复后会按顺序自动补交。','来源状态'));
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

function memoryPage(target){memoryTarget=target;const scope=state.owner||'';if(!state.memory||state.memory.scope!==scope)state.memory=emptyMemoryState(scope);
  const memory=state.memory;memory.target='memory';memory.view='list';memory.flow++;
  memory.pendingMarker=savedMemoryMarker();
  if(!state.loggedIn||!scope||state.transitionPending){renderMemoryList(target);return}
  startMemorySnapshot(target,memory.kind,memory.query);
  if(memory.pendingMarker)void reconcileMemoryMarker(memory.pendingMarker)}

function startMemorySnapshot(target,...args){if(target&&typeof target==='object')memoryTarget=target;return uiCore.mobile.startMemorySnapshot('memory',...args)}

function loadMemorySnapshot(target,...args){if(target&&typeof target==='object')memoryTarget=target;return uiCore.mobile.loadMemorySnapshot('memory',...args)}

function loadMemoryItems(target,...args){if(target&&typeof target==='object')memoryTarget=target;return uiCore.mobile.loadMemoryItems('memory',...args)}

function loadMemoryMore(target,...args){if(target&&typeof target==='object')memoryTarget=target;return uiCore.mobile.loadMemoryMore('memory',...args)}

function memoryPathIdSupported(...args){return uiCore.mobile.memoryPathIdSupported(...args)}

function memoryMarkerKey(...args){return uiCore.mobile.memoryMarkerKey(...args)}

function savedMemoryMarker(...args){return uiCore.mobile.savedMemoryMarker(...args)}

function persistMemoryMarker(...args){return uiCore.mobile.persistMemoryMarker(...args)}

function clearMemoryMarker(...args){return uiCore.mobile.clearMemoryMarker(...args)}

function newMemoryRequestId(...args){return uiCore.mobile.newMemoryRequestId(...args)}

function memoryActionAllowed(...args){return uiCore.mobile.memoryActionAllowed(...args)}

function renderMemoryReceipt(target){const memory=state.memory;if(!memory)return;
  const marker=memory.pendingMarker||savedMemoryMarker();
  if(marker){const box=notice(memory.receiptMessage||'上一条记忆操作结果待确认。原请求已保留，不会自动重复提交。','结果待核对');
    const check=action(memory.checkingReceipt?'正在核对…':'核对原请求',()=>reconcileMemoryMarker(marker),false);
    check.disabled=!!memory.checkingReceipt;box.append(el('p','memory-request-id',`请求编号：${marker.requestId}`),check);target.append(box)}
  else if(memory.receiptMessage&&(memory.view!=='detail'||memory.selectedItem?.id===memory.receiptItemId))
    target.append(notice(memory.receiptMessage,'操作结果'))}

function openMemoryDetail(target,...args){if(target&&typeof target==='object')memoryTarget=target;return uiCore.mobile.openMemoryDetail('memory',...args)}

function renderMemoryDetail(target=memoryTarget,token=memoryToken()){target=memoryTarget;if(!target||!memoryCurrent(token)||state.memory.view!=='detail')return;
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

function loadMemoryDetail(target,...args){if(target&&typeof target==='object')memoryTarget=target;return uiCore.mobile.loadMemoryDetail('memory',...args)}

function openMemoryConfirmation(choice,target,token){if(!memoryCurrent(token)||state.memory.view!=='detail')return;
  state.memory.confirmation=choice;renderMemoryDetail(target,token);
  if(['deleteItem','deleteEvidence'].includes(choice.operation))void uiCore.mobilePreviewMemoryForget(choice);
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
  const box=group(choice.operation==='correct'?'纠正理解':choice.operation==='mute'?'确认停用':'确认忘掉',[]),
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
      `将清除来源“${choice.summary}”及以下记忆，之后的记忆导出不再包含它们。`:
      '将清除来源及以下记忆，之后的记忆导出不再包含它们。'));
    if(choice.operation!=='mute'){
      const preview=choice.preview,scope=el('p','',preview?`将忘掉 ${preview.itemCount} 项记忆，清除 ${preview.evidenceCount} 条来源。以下内容会一起忘掉：`:
        choice.previewError||'正在读取将一起忘掉的记忆…');scope.setAttribute('role','status');body.append(scope);
      if(preview){const list=el('ul','memory-sources');for(const item of preview.items)list.append(el('li','',uiCore.forgetItemSummary(item)));body.append(list)}
      const label=el('label','session-forget'),snippets=el('input');snippets.type='checkbox';snippets.checked=choice.deleteConversationSnippets===true;
      snippets.addEventListener('change',()=>{choice.deleteConversationSnippets=snippets.checked});
      label.append(snippets,document.createTextNode('同时删除对话里含这句话的原话'));body.append(label,
        el('p','muted','默认保留对话原文；勾选后删除对应原生对话片段及个人命令副本。以前的备份仍保留。'));
      const input=field('输入“删除”以确认','text',choice.confirmText||'');input.input.maxLength=2;
      const confirm=action(choice.operation==='deleteEvidence'?'确认删除这条来源':'确认永久删除记忆',
        ()=>submitMemoryAction(choice.operation,choice.id||null),true);
      confirm.disabled=!preview||input.input.value.trim()!=='删除';input.input.addEventListener('input',()=>{
        choice.confirmText=input.input.value;confirm.disabled=!preview||input.input.value.trim()!=='删除'});
      body.append(input.box,confirm);
    }else body.append(action('确认停用',()=>submitMemoryAction('mute'),true))}
  body.append(action('取消',()=>{memory.confirmation=null;renderMemoryDetail(target,token)},false));target.append(box)}

function memoryReceiptMessage(...args){return uiCore.mobile.memoryReceiptMessage(...args)}

function memoryReceiptRejected(...args){return uiCore.mobile.memoryReceiptRejected(...args)}

function handleMemoryReceipt(...args){return uiCore.mobile.handleMemoryReceipt(...args)}

function reconcileMemoryMarker(...args){return uiCore.mobile.reconcileMemoryMarker(...args)}

function submitMemoryAction(...args){return uiCore.mobile.submitMemoryAction(...args)}
