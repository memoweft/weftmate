/* Mobile resources presentation and named ui-core actions. */

function groupTaskActivities(rows){return uiCore.groupTaskActivities(rows)}

function taskControlMeaning(control){if(control?.state==='stop_requested'&&typeof control.stopStatus==='string'){
  if(control.stopStatus==='stopped')return '电脑已核对这件事的实际停止。已执行的步骤与成果会保留。';
  if(control.stopStatus==='completed')return '这件事的回合已不在运行；未确认是停止请求使它结束。核对已执行的步骤与成果后，可写明下一步。';
  if(control.stopStatus==='cancel_requested')return '电脑已对准这件事发起取消，正在等待实际结束记录。';
  if(control.legacyStopIntent&&!control.canResume)return '旧停止记录缺少完整目标快照，结果仍待核对。请查看原会话与成果，稍后刷新任务。';
  if(control.stopStatus==='requested')return '停止请求已记录，正在核对电脑回合；目前还不能确认已停止。';
  return '停止结果仍不明确。请核对原会话与成果，稍后刷新任务；不要重复执行。'}
  if(control?.state==='stop_requested'&&control.reasonCode==='TURN_ENDED_AFTER_STOP_REQUEST'&&
  control.canResume===true)return '上一回合已结束，但尚不能确认是停止请求使它结束。请写明下一步，再恢复这件事。';
  return {active:'事情仍可继续处理；文件完成以电脑读回核验为准。',
  stop_requested:'停止意图已记录，执行端状态仍待核对。',stopped:'执行端停止已核对。',
  uncertain:'事情结果尚不明确，请先核对原会话和成果。'}[control?.state]||'任务控制状态待核对。'}

function inlineTaskInfo(taskId,button){const context=conversationTaskContext(),entry=conversationTasks.entries.get(taskId);
  if(!conversationTaskCurrent(context)||!entry?.task)return;const card=button.closest('.conversation-task, .conversation-approval, .conversation-question')||button.parentNode;
  const existing=card.querySelector('.timeline-task-info');if(existing){existing.remove();return}
  const info=el('section','timeline-task-info'),task=entry.task;info.append(el('p','',task.sourceText||''));
  for(const source of task.sources||[]){const read=el('button','secondary',`查看来源 ${source.relativePath||source.title||'正文'}`);read.type='button';
    read.addEventListener('click',()=>openTimelinePreview(context,()=>uiCore.readResource(uiCore.taskSourcePath(taskId,source.snapshotId)),source.title||source.relativePath||'来源'));info.append(read)}
  for(const artifact of task.artifacts||[])appendTimelineArtifact(info,artifact,context);
  if(task.control?.canStop){const stop=el('button','secondary','请求停止这件事');stop.type='button';
    stop.addEventListener('click',async()=>{if(!conversationTaskCurrent(context)||stop.disabled)return;stop.disabled=true;entry.stopRequestId ||= newSharedRequestId();
      try{await uiCore.stopTask(taskId,entry.stopRequestId);if(conversationTaskCurrent(context)){stop.textContent='停止请求已记录';void refreshConversationTasks()}}
      catch{if(conversationTaskCurrent(context)){stop.disabled=false;stop.textContent='重试停止请求'}}});info.append(stop)}card.append(info)}

function appendTimelineArtifact(parent,artifact,context=conversationTaskContext()){const wrap=el('div','timeline-artifact'),open=el('button','secondary',artifact.fileName||'打开成果'),save=el('button','quiet','保存到手机');
  open.type='button';save.type='button';open.addEventListener('click',()=>openTimelinePreview(context,()=>uiCore.readResource(uiCore.artifactPreviewPath(artifact.artifactId)),artifact.fileName||'成果'));
  save.addEventListener('click',async()=>{try{const result=await call('shared.artifacts.save',{artifactId:artifact.artifactId});if(conversationTaskCurrent(context)){state.artifactSaveRequest=result.requestId;toast('请选择保存位置')}}catch(e){toast(safeError(e),true)}});
  wrap.append(open,el('small','',`${artifact.contentType||'文件'} · ${artifact.size||0} 字节`),save);parent.append(wrap)}

function closeResourcePage({restoreFocus=true}={}){const view=state.resourceView;state.resourceView=null;
  if(!$('resource-page').hidden) { if(globalThis.WeftMobileMotion) WeftMobileMotion.hide($('resource-page'),true); else $('resource-page').hidden=true; }$('chat-page').removeAttribute?.('inert');
  $('main').removeAttribute?.('inert');document.querySelector('.topbar')?.removeAttribute?.('inert');
  if(view){$('chat-scroll').scrollTop=view.scrollTop;state.scrollPinned=view.scrollPinned;
    if(restoreFocus)view.trigger?.focus({preventScroll:true})}}

function showResourcePage(title,context,trigger=document.activeElement){
  const previous=state.resourceView;
  const view={context,trigger:previous?.trigger||trigger,scrollTop:previous?.scrollTop??$('chat-scroll').scrollTop,
    scrollPinned:previous?.scrollPinned??state.scrollPinned};state.resourceView=view;state.scrollPinned=false;
  $('resource-page').hidden=false;$('resource-title').textContent=title;clear($('resource-content'));
  $('resource-content').scrollTop=0;$('main').setAttribute('inert','');document.querySelector('.topbar')?.setAttribute('inert','');
  $('chat-page').setAttribute('inert','');globalThis.WeftMobileMotion?.push($('resource-page'),false,'240ms');$('resource-back').focus({preventScroll:true});return view;
}

function retainTimeline(content){const key=JSON.stringify([state.owner,state.authEpoch,state.chatSource,state.conversationId,state.sharedSessionId]);
  const saved=content.dataset.context===key?[...content.children].filter(node=>node.dataset.timeline):[];content.dataset.context=key;return saved}

async function openTimelinePreview(context,read,title,artifact=null){if(!conversationTaskCurrent(context))return;
  const view=showResourcePage(title,context),target=$('resource-content');
  target.append(el('p','muted','正在读取…'));
  const load=async()=>{try{const data=await read();if(state.resourceView!==view||!conversationTaskCurrent(context))return;
    const text=data.text||data.preview?.text||data.source?.text||'暂时没有可预览内容';clear(target);
    const body=el('div','markdown resource-document');
    if(window.WeftFormat?.render){body.innerHTML=window.WeftFormat.render(text);enhanceMarkdown(body)}else body.textContent=text;
    target.append(body);if(data.truncated||data.source?.truncated)target.append(el('p','muted','内容已截断'));
    if(artifact?.versions?.length){const older=el('details','resource-usage');older.append(el('summary','',`旧版 · ${artifact.versions.length} 个`));
      for(const version of artifact.versions)appendTimelineArtifact(older,version,context);target.append(older)}
    if(artifact){const save=el('button','timeline-action','保存到手机');save.addEventListener('click',async()=>{try{await call('shared.artifacts.save',{artifactId:artifact.artifactId});toast('请选择保存位置')}catch(e){toast(safeError(e),true)}});target.append(save)}
  }catch{if(state.resourceView!==view)return;clear(target);target.append(el('p','inline-error','暂时无法读取，请重试。'));
    const retry=el('button','secondary','重新读取');retry.addEventListener('click',load);target.append(retry)}};await load();
}

function readResourceUse(context,use){uiCore.syncMobileIdentity();return uiCore.readResource(use.path)}

function conversationResources(context){return uiCore.mobileResources(context)}

function openResourceSource(item,context){if(!conversationTaskCurrent(context))return;
  const view=showResourcePage(item.name||item.title||'来源',context),target=$('resource-content');
  const uses=item.uses||[],verb=item.kind==='tool'?'调用':uses.length&&uses.every(use=>use.verb==='写入')?'写入':uses.some(use=>use.verb==='写入')?'使用':'读取';
  target.append(el('h2','',item.name||item.title||'来源'),el('p','muted',`${verb} ${uses.length} 次`));
  if(item.location||item.url)target.append(el('p','resource-location',item.location||item.url));
  for(const use of item.uses||[]){const detail=el('details','resource-usage');detail.append(el('summary','',use.summary||'查看内容'));
    detail.addEventListener('toggle',async()=>{if(!detail.open||detail.dataset.loaded)return;detail.dataset.loaded='loading';
      detail.querySelector('pre')?.remove();const output=el('pre','timeline-raw','正在读取…');detail.append(output);
      try{const data=await readResourceUse(context,use);if(state.resourceView!==view||!conversationTaskCurrent(context))return;
        const text=data.source?.text||data.text||'暂时没有可预览内容';
        if(item.kind==='tool'){const presentation=uiCore.sourcePresentation(item.toolName||item.name,text);
          detail.append(el('p','source-summary',presentation.summary));const raw=el('details','resource-raw');
          raw.append(el('summary','','详情'));output.remove();raw.append(output);detail.append(raw);}
        output.textContent=`${data.source?text:uiCore.executionDetailText(text)}${data.truncated||data.source?.truncated?'\n[内容已截断]':''}`;
        const copy=el('button','timeline-action','复制');copy.addEventListener('click',()=>copyText(output.textContent));detail.append(copy);detail.dataset.loaded='true';
      }catch{if(state.resourceView===view){output.textContent='暂时无法读取，收起后可重试。';delete detail.dataset.loaded}}});target.append(detail)}
}

async function openConversationResources(filter=null){const context=conversationTaskContext();if(!conversationTaskCurrent(context))return;
  const view=showResourcePage('输出与来源',context),target=$('resource-content');target.append(el('p','muted','正在读取…'));
  try{const data=await conversationResources(context);if(state.resourceView!==view||!conversationTaskCurrent(context))return;clear(target);
    if(data.offline)target.append(el('p','muted','离线 · 上次读取的内容'));
    for(const [title,items] of [['输出内容',data.outputs||[]],['来源',(data.sources||[]).filter(item=>!filter||filter(item))]]){
      target.append(el('h2','',title));if(!items.length)target.append(el('p','muted',title==='来源'?'还没有使用的来源':'还没有输出内容'));
      for(const item of items){const button=el('button','resource-row');button.type='button';const artifact=title==='输出内容'?item:null;
        button.append(el('strong','',artifact?.fileName||item.name||item.title||'来源'),el('small','',artifact?`${artifact.contentType||'文件'} · ${attachmentSize(artifact.size||0)}`:`${item.uses?.length||0} 次使用`));
        button.addEventListener('click',()=>artifact?void openTimelinePreview(context,()=>uiCore.readResource(uiCore.artifactPreviewPath(artifact.artifactId)),artifact.fileName||'成果',artifact):openResourceSource(item,context));target.append(button);
        if(artifact){const save=el('button','timeline-action','保存到手机');save.addEventListener('click',async()=>{try{await call('shared.artifacts.save',{artifactId:artifact.artifactId});toast('请选择保存位置')}catch(e){toast(safeError(e),true)}});target.append(save)}}}
  }catch{if(state.resourceView!==view)return;clear(target);target.append(el('p','inline-error','暂时无法读取输出与来源。'));
    const retry=el('button','secondary','重新读取');retry.addEventListener('click',()=>{void openConversationResources(filter)});target.append(retry)}
}

function renderTimeline(events=state.sharedEvents){if(!window.WeftTimeline)return;const context=conversationTaskContext();
  window.WeftTimeline.render(events,$('chat-content'),{tag:'section',mobile:true,artifacts:[...conversationTasks.entries.values()].flatMap(entry=>entry.task?.artifacts||[]),approvals:uiCore.mobileDecisions.rows(approvalContext()),questions:uiCore.mobileDecisions.rows(approvalContext(),true),
    waiting:state.chatSource==='host'&&state.sharedRunning?uiCore.processingStageLabel(state.sharedSessions.find(row=>row.sessionId===context.sessionId)?.processing, state.sharedEvents):'',copyText:text=>call('clipboard.copy',{text}),
    openStep:step=>openConversationResources(item=>item.uses?.some(use=>use.id===`${step.taskId}/${step.stepId}`)),
    openReference:key=>openConversationResources(item=>item.key===key),
    readDetail:seq=>uiCore.readTimelineDetail(context.sessionId,seq),
    fileLabel:artifact=>`${({'text/markdown':'Markdown','text/plain':'文本','application/pdf':'PDF','text/html':'网页'})[artifact.contentType]||'文件'} · ${attachmentSize(artifact.size||0)}`,
    openArtifact:artifact=>openTimelinePreview(context,()=>uiCore.readResource(uiCore.artifactPreviewPath(artifact.artifactId)),artifact.fileName||'成果',artifact),
    downloadArtifact:artifact=>call('shared.artifacts.save',{artifactId:artifact.artifactId})})}

function olderControl(content){if(!state.sharedHasOlder)return;const button=el('button','quiet',state.sharedOlderLoading?'正在读取…':'加载更早内容');button.type='button';button.disabled=state.sharedOlderLoading;
  button.addEventListener('click',()=>{void loadOlderHistory()});content.append(button)}

async function loadOlderHistory(){const context=conversationTaskContext(),scroll=$('chat-scroll'),height=scroll.scrollHeight,top=scroll.scrollTop;
  if(!await uiCore.loadMobileOlderHistory()||!conversationTaskCurrent(context))return;
  state.scrollPinned=false;
  if(context.source==='phone')await renderConversation({silent:true});else renderSharedConversation();
  scroll.scrollTop=top+scroll.scrollHeight-height;
}
