/* Readable native destinations for status, synchronization, help and account usage. */
(() => {
  const n=WeftUiCore.nativePresentation,{view,section,text,input,action,toggle,navigate,date}=n;
  n.register('system',{
    async read(c){
      const local=await c.call('diagnostics.status').catch(()=>null);
      let system,problem='';try{system=await c.core.readMobileSystem();}catch{problem='电脑状态暂时无法读取。连接电脑后点刷新，本机记录仍可查看。';}
      const components=system?c.systemComponents(system):[];
      const record=(r)=>r?[text(r.summary||r.label||({ready:'运行正常',error:'记录暂时无法读取',empty:'尚无运行记录'}[r.state]||'运行记录'),r.description||r.message||''),...(r.entries||r.records||[]).map(x=>text(x.title||x.summary||x.message||'运行记录',x.detail||date(x.at)))]:[text('尚无运行记录')];
      return view('系统状态',[
        section('电脑组件',problem?[text(problem)]:components.map(x=>text(x.name+' · '+(x.label||'待确认'),[x.description,x.semanticRecall?.description,x.state==='problem'&&x.nextStep?.label?'请在电脑上'+x.nextStep.label+'。':''].filter(Boolean).join('\n')))),
        system?section('电脑性能',[['startup','启动用时'],['firstToken','最近回复首字（中位）'],['memory','当前内存']].map(([key,label])=>text(label+' · '+c.systemMetric(system.metrics?.[key]),system.metrics?.[key]?.reference||'尚未记录'))):null,
        section('本机运行记录',[...record(local),action('复制诊断摘要','copyDiagnostics'),action('分享运行记录','shareDiagnostics')]),
        system?section('已连接的电脑',record(system.runRecord)):null,
      ]);
    },
    async act(c,id){if(id==='shareDiagnostics')await c.call('diagnostics.share');else if(id==='copyDiagnostics'){const x=await c.call('diagnostics.status');await c.call('clipboard.copy',{text:c.diagnosticSummary(x)});}return {message:'已完成'};},
  });
  n.register('sync',{
    async read(c){const s=await c.call('sync.status');const old=await c.call('records.unboundSummary').catch(()=>({}));return view('离线与同步',[
      section('本机记录',[text('手机记录先保存在本机，联网后同步到同一账户。'),text({scheduled:'后台同步已安排，执行时间由系统决定。',not_scheduled:'后台同步未启用，可以手动同步。',unknown:'后台调度状态暂无法确认。'}[s.backgroundSync]||'可以手动同步。'),action('立即同步','sync',{}, {primary:true})]),
      old.eligible&&old.conversationCount?section('旧本机对话',[text(old.conversationCount+' 个待认领的旧对话'),action('归入当前账户','claim',{count:old.conversationCount},{confirm:'确认这些旧对话属于当前账户？认领后会进入该账户的同步队列。'})]):null]);},
    async act(c,id,p){if(id==='sync'){const s=await c.call('sync.run');return {message:`已同步：上传 ${s.uploaded||0}，接收 ${s.downloaded||0}`};}if(id==='claim')await c.call('records.claimUnbound',{expectedCount:p.count,confirmAccountName:c.state.username});return {message:'已完成'};},
  });
  n.register('updates',{
    async read(c){const s=await c.call('updates.status');return view('检查更新',[
      section('当前版本',[text('原生应用',s.nativeVersion),text('共享逻辑',s.activeVersion||'内置'),text('原生应用通过安装包更新，已保存的数据会保留。'),action('查看安卓安装包','download')]),
      section('共享逻辑更新',[s.sourceAvailable===false?text('连上电脑后可以检查更新。'):toggle('autoEnabled','自动更新',s.autoEnabled,'auto'),s.releaseNotes?text('更新内容',s.releaseNotes):null,s.stagedVersion?text('已下载 '+s.stagedVersion,s.pendingReason==='draft'?'有未发送草稿，暂缓应用。':s.pendingReason==='running'?'当前回复结束后再应用。':'空闲后可以应用。'):null,action('检查更新','check'),s.stagedVersion?action('应用更新','apply'):null,s.previousAvailable?action('退回上一版','rollback',{}, {confirm:'恢复上一版共享逻辑？当前对话和设置保留。'}):null])]);},
    async act(c,id,p){if(id==='download')return {effect:{kind:'external',url:'https://www.weftmate.top/downloads/?platform=android'}};else if(id==='auto')await c.call('updates.preference',{autoEnabled:p.value});else await c.call('updates.'+id,{hasDraft:c.hasDraft()});return {message:'已完成'};},
  });
  n.register('help',{
    async read(c,p){const rows=WeftUiCore.filterHelp(p.query||'');return view('帮助与小技巧',[section('',[input('query','搜索帮助',p.query),action('搜索','search')]),...Object.entries(Object.groupBy(rows,x=>x.group)).map(([group,items])=>section(group,items.flatMap(x=>[text(x.title,x.text),action(x.tryLabel,'try',{target:x.action})])))]);},
    async act(c,id,p,v){if(id==='search')return {effect:{kind:'page',page:'help',params:{query:v.query||''}}};const pages={memory:'memory',approvals:'approvals',devices:'devices',data:'data'};if(pages[p.target])return {effect:{kind:p.target==='devices'?'settings':'page',page:pages[p.target]}};if(p.target==='new')return {effect:{kind:'newChat'}};if(p.target==='temporary')return {effect:{kind:'chat',source:{sessionId:await c.core.createTemporaryConversation()}}};return {effect:{kind:'tab',tab:'goals'}};},
  });
  n.register('releases',{async read(){const rows=WeftUiCore.releaseNotes||[];return view('更新内容',rows.filter(x=>x.audience!=='desktop').map(x=>section(x.version||'最近更新',[text(x.title||'',x.text||x.body||x.summary||''),...['added','changed','fixed'].flatMap(k=>(x[k]||[]).map(t=>text(t)))])));}});
  n.register('legal',{async read(c,p){const kind=p.kind==='privacy'?'privacy':'terms';return view(kind==='terms'?'服务条款':'隐私政策',[section('',[{type:'markdown',text:await c.legal(kind)}])]);}});
  n.register('usage',{
    async read(c,p){const s=await c.core.loadUsage({month:p.month||'',sessionId:p.sessionId||''});if(!s)return view('用量',[section('',[text('用量暂时无法读取，请刷新重试。')])]);const sum=s.summary||{},budget=s.settings||{};const money=c.core.usageMoney;return view('用量',[
      section(sum.month||'本月用量',[text('费用',money(sum.total?.cost||0)),text('输入与输出',`${sum.total?.inputTokens||0} / ${sum.total?.outputTokens||0} token`),text(s.notice||'')]),
      section('查看月份',[input('month','月份',sum.month,{detail:'填写 YYYY-MM'}),action('查看','month')]),
      budget.canManage?section('用量上限',[input('monthlyLimit','月度上限（元）',budget.monthlyLimit,{number:true}),input('temporaryLimit','仅本月临时上限（元）',budget.temporaryLimit,{number:true}),action('保存上限','budget')]):null,
      section('按模型',(s.models||[]).map(x=>text(x.name,money(x.cost||0)))),section('按对话',(s.sessions||[]).map(x=>text(x.name,money(x.cost||0))))]);},
    async act(c,id,p,v){if(id==='month')return {effect:{kind:'page',page:'usage',params:{month:v.month||''}}};if(id==='budget')await c.core.saveUsageSettings(Object.fromEntries(['monthlyLimit','temporaryLimit'].filter(k=>Object.hasOwn(v,k)).map(k=>[k,v[k]===''?null:Number(v[k])])));return {message:'用量上限已保存'};},
  });
  n.register('archived',{
    async read(c){await c.core.refreshSessions();const rows=c.core.sessionList(true);return view('已归档',[section('对话',rows.length?rows.flatMap(x=>[text(x.title||'未命名对话'),action('恢复对话','restore',{sessionId:x.sessionId}),action('删除对话','delete',{sessionId:x.sessionId},{danger:true,confirm:'删除这段已归档对话？已形成的长期记忆会保留。'})]):[text('还没有已归档对话')])]);},
    async act(c,id,p){if(id==='restore')await c.core.archiveSession(p.sessionId,false);else if(id==='delete')await c.core.deleteSession(p.sessionId);return {message:'已完成'};},
  });
  n.register('schedules',{
    async read(c){const s=await c.core.loadSchedules();const rows=s?.schedules||[];return view('提醒与定时任务',[section('安排',rows.length?rows.flatMap(x=>[text(x.title||x.prompt||'提醒',c.core.scheduleDescription(x)),action('查看原对话','source',{sessionId:x.sessionId}),action(x.state==='paused'?'恢复':'暂停','manage',{row:x,operation:x.state==='paused'?'resume':'pause'}),action('删除','manage',{row:x,operation:'delete'},{danger:true,confirm:'删除这项安排？'})]):[text('还没有提醒或定时任务')])]);},
    async act(c,id,p){if(id==='source')return {effect:{kind:'chat',source:p}};await c.core.manageSchedule(p.row,p.operation);return {message:'已完成'};},
  });
})();
