/* Memory actions keep the shared revision checks, reviewed forget scopes and durable receipts. */
(() => {
  const n=WeftUiCore.nativePresentation,{view,section,text,input,choice,toggle,action,navigate}=n;
  async function prepare(c,p={}) {
    c.prepareMemory();
    if(!c.state.memory || c.state.memory.scope!==c.state.owner)c.state.memory=c.core.mobile.emptyMemoryState(c.state.owner);
    await c.core.mobile.startMemorySnapshot('memory',p.kind||'all',p.query||'');
    return c.state.memory;
  }
  const filterRows=p=>[input('query','关键词',p.query||''),choice('kind','记忆类型',p.kind||'all',Object.entries({all:'全部',cognition:'理解',entity:'人物与事物',relationship:'关系',event:'经历'})),action('筛选','search')];
  const statusRows=m=>[m.error?text(m.error):null,m.receiptMessage?text(m.receiptMessage):null,m.healthStatus?text('记忆状态',({ready:'可以查看记忆',recovering:'正在恢复',degraded:'部分功能暂不可用',disabled:'记忆未启用',unavailable:'记忆暂不可用'}[m.healthStatus.state]||'状态待核对')):null,m.pendingMarker?action('核对处理结果','receipt'):null];
  async function localRead(c,p) {
    const api=c.phone?.hasData?c.phone:c.core,snapshot=c.phone?.memoryReplica||c.core.offlineMemoryReplica?.();
    const from=p.from?new Date(p.from+'T00:00:00').getTime():0,to=p.to?new Date(p.to+'T23:59:59.999').getTime():Infinity;
    if(from>to)throw Error('结束日期需要晚于或等于开始日期。');
    const rows=snapshot?.phoneLocal?api.searchPhoneMemory(p.query||'',from,to):(snapshot?.items||[]).filter(x=>(x.text||'').includes(p.query||''));
    return view('记忆',[
      section('手机上的记忆',[text(snapshot?.phoneLocal?'手机记录明确的事实和偏好，电脑整理完成后接替。':'这是已保存到本机的记忆副本。'),snapshot?.pendingPhoneForget?text('本机已忘掉，连接电脑后继续处理那边的记忆。'):null,snapshot?.phoneMemoryFailures?action('重试整理','retryPhone'):null,input('query','关键词',p.query),input('from','开始日期',p.from),input('to','结束日期',p.to),action('筛选','search')]),
      section('记忆列表',rows.length?rows.flatMap(x=>[text(x.text,x.updatedAt?n.date(x.updatedAt):''),x.producer==='phone'?navigate('查看来源与管理','phoneMemory',{id:x.id}):navigate('查看电脑记忆','memory',{remote:true})]):[text('还没有匹配的记忆。')])]);
  }
  n.register('memory',{
    async read(c,p){if(!p.remote&&(c.phone?.active||['host_offline','network_unavailable','connecting'].includes(c.core.connectionView?.().kind)))return localRead(c,p);
      const m=p.keep?c.state.memory:await prepare(c,p);return view('记忆',[section('',statusRows(m)),section('查找记忆',filterRows(p)),section('记忆列表',m.items.length?m.items.map(x=>navigate(x.text,'memoryItem',{kind:x.kind,id:x.id},(c.memoryKinds[x.kind]||'记忆')+(x.updatedAt?' · '+n.date(x.updatedAt):''))):[text(m.error?'请连接电脑后重试。':'当前没有匹配的记忆。')]),m.hasMore?section('',[action('加载更多','more')]):null]);},
    async act(c,id,p,v){
      if(id==='search')return {effect:{kind:'page',page:'memory',params:{query:v.query||'',kind:v.kind||'all',from:v.from||'',to:v.to||''}}};
      if(id==='more'){await c.core.mobile.loadMemoryMore('memory');p.keep=true;}
      else if(id==='receipt'){await c.core.mobile.reconcileMemoryMarker(c.state.memory.pendingMarker);p.keep=true;}
      else if(id==='retryPhone')await(c.phone?.hasData?c.phone:c.core).retryPhoneMemory();
      return {};
    },
  });
  n.register('phoneMemory',{
    async read(c,p){const api=c.phone?.hasData?c.phone:c.core,scope=api.phoneMemoryScope(p.id);if(!scope)return view('记忆',[section('',[text('这项记忆已更新或移除，请返回列表。')])]);const item=scope.items.find(x=>x.id===p.id)||scope.items[0];return view('记忆详情',[
      section('内容',[text(item?.text||''),text('同一句原话形成的记忆',scope.items.map(x=>x.text).join('\n'))]),
      section('原话与管理',[item?.conversationId?action('查看原话','source',{conversationId:item.conversationId}):null,action('纠正','correct',{item}),action('忘记这句原话形成的记忆','forget',{id:p.id,scope},{danger:true,confirm:'以上同一句原话形成的记忆会一起忘掉，聊天原文保留。'})])]);},
    async act(c,id,p){const api=c.phone?.hasData?c.phone:c.core;if(id==='forget'){await api.forgetPhoneMemory(p.id,p.scope);return {message:'本机已忘掉'};}if(id==='correct')return {effect:{kind:'chat',source:{phoneId:p.item.conversationId},draft:`更正一下：${p.item.text}。现在是：`}};if(id==='source')return {effect:{kind:'chat',source:{phoneId:p.conversationId}}};},
  });
  n.register('memoryItem',{
    async read(c,p){
      let m=c.state.memory;
      if(!m?.detail||m.detail.item?.id!==p.id||m.detail.item?.kind!==p.kind){await prepare(c);await c.core.mobile.openMemoryDetail('memory',{kind:p.kind,id:p.id});m=c.state.memory;}
      const item=m.detail?.item;
      if(!item)return view('记忆详情',[section('',[...statusRows(m),text(m.detailError||'这条记忆暂时无法读取，请返回刷新。')])]);
      return view('记忆详情',[
        section('内容',[text(item.text),...statusRows(m)]),
        section('来源',m.sources.length?m.sources.flatMap(x=>[text(x.rawContent||x.summary||'原话暂时不可读',x.createdAt?n.date(x.createdAt):''),x.sessionId||x.conversationId?action('查看来源对话','source',{source:{sessionId:x.sessionId,phoneId:x.conversationId}}):null,c.core.mobile.memoryActionAllowed('deleteEvidence',x)?navigate('忘记这条来源','memoryForget',{kind:p.kind,id:p.id,evidenceId:x.evidenceId}):null]):[text('当前没有可显示的来源。')]),
        section('管理',[c.core.mobile.memoryActionAllowed('correct')?input('correction','正确的理解',m.correctionDraft||'',{multiline:true}):null,c.core.mobile.memoryActionAllowed('correct')?action('保存纠正','correct',{}, {primary:true}):null,c.core.mobile.memoryActionAllowed('mute')?action('停用这项记忆','mute',{}, {confirm:'保留记忆和来源，但之后不再用于回答。'}):null,c.core.mobile.memoryActionAllowed('deleteItem')?navigate('永久忘记这项记忆','memoryForget',{kind:p.kind,id:p.id}):null])]);
    },
    async act(c,id,p,v){if(id==='source')return {effect:{kind:'chat',source:p.source}};if(id==='correct'||id==='mute'){await c.core.mobile.submitMemoryAction(id,null,v.correction||'');if(c.state.memory.detailError)throw Error(c.state.memory.detailError);return {message:c.state.memory.receiptMessage||'处理结果待核对'};}throw Error('请重新读取记忆。');},
  });
  n.register('memoryForget',{
    async read(c,p){const m=c.state.memory;if(!m?.detail||m.detail.item.id!==p.id)return view('确认遗忘',[section('',[text('这条记忆已经改变，请返回重新读取。')])]);
      const operation=p.evidenceId?'deleteEvidence':'deleteItem';
      if(!m.confirmation||m.confirmation.operation!==operation||m.confirmation.id!==p.evidenceId){m.confirmation={operation,id:p.evidenceId,confirmText:''};await c.core.mobilePreviewMemoryForget(m.confirmation);}
      const s=m.confirmation,preview=s.preview;
      return view('确认遗忘',[section('一起忘掉的内容',preview?[text(`将忘掉 ${preview.itemCount} 项记忆，清除 ${preview.evidenceCount} 条来源。`),...preview.items.map(x=>text(x.text))]:[text(s.previewError||'遗忘范围暂时无法读取，请刷新重试。')]),section('确认',[toggle('snippets','同时删除对话里的这几句原话',s.deleteConversationSnippets,'snippets','默认保留聊天原文；以前的备份不受影响。'),input('confirmation','输入“删除”以确认'),action('确认永久遗忘','forget',{}, {danger:true,enabled:!!preview})])]);
    },
    async act(c,id,p,v){const m=c.state.memory;if(id==='snippets'){if(m.confirmation)m.confirmation.deleteConversationSnippets=p.value;return {};}
      if(v.confirmation!=='删除')throw Error('请输入“删除”以确认。');
      if(!m?.confirmation?.preview)throw Error('请先重新读取遗忘范围。');
      m.confirmation.confirmText=v.confirmation;
      await c.core.mobile.submitMemoryAction(p.evidenceId?'deleteEvidence':'deleteItem',p.evidenceId||null);
      if(m.detailError)throw Error(m.detailError);
      return {message:m.receiptMessage||'处理结果待核对',effect:{kind:'page',page:'memory'}};
    },
  });
})();
