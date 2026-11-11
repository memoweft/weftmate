/* Native capability, storage and offline screens consume existing named core operations. */
(() => {
  const n=WeftUiCore.nativePresentation,{view,section,text,input,action,toggle,choice,navigate,date}=n;
  n.register('data',{
    async read(c){const s=await c.core.readData(),op=s.operation;return view('数据与存储',[
      section('账户数据',[text('总占用',c.core.dataSize(s.statistics?.totalBytes)),...(s.statistics?.categories||[]).flatMap(x=>[text(x.name+' · '+c.core.dataSize(x.bytes),x.description),s.canManage&&x.cleanable?action('清理'+x.name,'clean',{category:x.id},{confirm:x.pureCache?'清理这类可再生成的缓存？':'清理'+x.name+'？这类内容将无法恢复。'}):null])]),
      op?section('正在处理',[text(op.title||'数据操作',op.message||op.state),op.canCancel?action('取消操作','cancel',{id:op.id}):null]):null,
      section('管理',[action('重新统计','scan'),action('导出全部数据','export'),action('清理这台手机的缓存','local',{}, {confirm:'清除当前账户在手机上的缓存？电脑保存的原始数据会保留。'})]),
      s.canManage?section('删除账户数据',[text('请先导出需要保留的数据，再输入当前账户名。'),input('accountName','当前账户名'),action('删除本账户的全部数据','delete',{kind:'delete'},{danger:true,confirm:'永久删除当前账户的对话、记忆和文件？此操作无法撤销。'})]):null]);},
    async act(c,id,p,v){if(id==='scan')await c.core.scanData();else if(id==='clean')await c.core.cleanData(p.category,true);else if(id==='cancel')await c.core.cancelData(p.id);else if(id==='export')await c.core.exportAllData(undefined,false);else if(id==='local')await c.core.clearLocalData();else if(id==='delete'){
      const s=await c.core.readData();if(v.accountName!==s.accountName)throw Error('账户名不匹配，请核对后重试。');
      const result=await c.core.deleteAllData(p.kind,v.accountName);if(result.operation?.state==='pending_confirmation')return {message:'请求已送到电脑，请在电脑上核对并确认。'};
    }return {message:'操作已提交，请刷新核对结果'};},
  });
  n.register('connectors',{
    async read(c){const s=await c.core.readConnectors();let catalog={};if(c.core.state.selectedSessionId)catalog=await c.core.accessApi(`/sessions/${encodeURIComponent(c.core.state.selectedSessionId)}/slash-commands`).catch(()=>({}));return view('能力',[
      section('连接器',(s.connectors||[]).length?s.connectors.flatMap(x=>[navigate(x.name,'connector',{id:x.id},x.message||`${x.activeToolCount} / ${x.totalToolCount} 个工具可用`),toggle(x.id,'启用'+x.name,x.enabled,'toggle')]):[text('还没有添加连接器','可在电脑上配置连接器，手机会使用同一账户的配置。')]),
      section('当前对话的工具与技能',[...(catalog.tools||[]).map(x=>text(x.name,x.description)),...(catalog.items||[]).map(x=>text((x.kind==='command'?'/':'')+x.name,x.description)),...(!catalog.tools?.length&&!catalog.items?.length?[text('打开一段电脑对话后查看可用能力')]:[])]),
      section('资料与模型',[navigate('资料访问','resources'),action('管理模型服务','models')])]);},
    async act(c,id,p){if(id==='models')return {effect:{kind:'settings',page:'models'}};await c.core.changeConnector({action:'toggle',id:p.key,enabled:p.value});return {message:'已保存'};},
  });
  n.register('connector',{async read(c,p){const s=await c.core.readConnectors(),x=s.connectors?.find(x=>x.id===p.id);return view(x?.name||'连接器',[section('工具与规则',x?[text(x.message||`${x.activeToolCount} / ${x.totalToolCount} 个工具可用`),...(x.credentials||[]).map(x=>text(x.label||x.name,x.last4?'已保存 · '+x.last4:'已安全保存')),...(x.tools||[]).map(t=>text(t.displayName||t.rawName,(t.description||'')+'\n'+({allow:'允许',ask:'每次询问',deny:'禁止'}[t.rule]||'使用默认规则')))]:[text('这项连接器已经移除，请返回刷新。')])]);}});
  n.register('executionRecords',{
    async read(c,p){const params=new URLSearchParams();if(p.before)params.set('before',p.before);if(p.type)params.set('type',p.type);if(p.projectId)params.set('projectId',p.projectId);if(p.since)params.set('since',p.since);const [s,rules]=await Promise.all([c.core.readExecutionRecords(params),c.core.readPermissionRules()]);return view('执行记录',[
      section('筛选',[choice('type','操作类型',p.type||'',[['','全部'],...(rules.types||[]).map(x=>[x.id,x.label])]),choice('projectId','项目',p.projectId||'',[['','全部'],['none','无项目'],...(s.projects||[]).map(x=>[x.projectId,x.name])]),action('应用筛选','filter')]),
      section('记录',(s.items||[]).length?s.items.map(x=>navigate(x.summary||'电脑操作','executionRecord',{row:x},[x.conversationName,x.projectName,date(x.at)].filter(Boolean).join(' · '))):[text('还没有符合筛选的操作记录')]),
      s.hasMore?section('',[navigate('更早的记录','executionRecords',{...p,before:s.nextBefore})]):null]);},
    async act(c,id,p,v){return {effect:{kind:'page',page:'executionRecords',params:{type:v.type,projectId:v.projectId}}};},
  });
  n.register('executionRecord',{
    async read(c,p){const x=p.row;return view('操作详情',[section('',[text(x.summary),text({allowed:'已允许',rejected:'已拒绝',automatic:'按规则自动允许',blocked:'被禁止',pending:'等待审批',unavailable:'已失效'}[x.result]||'结果待核对',date(x.at)),text(x.conversationName||'原对话',x.projectName||''),action('回到原对话','source',{source:x})])]);},
    async act(c,id,p){return {effect:{kind:'chat',source:p.source}};},
  });
  const models=async c=>(await c.call('models.host')).models?.filter(x=>x.configured===true)||[];
  n.register('resources',{
    async read(c){c.prepareSettings('workspaces');const [s,b,m]=await Promise.all([c.call('shared.projects.list'),c.core.readBrowserWorkspace(),models(c)]);const saved=c.core.mobileSettings.savedProjectIntent(s.hostId);return view('资料访问',[
      section('已登记项目',s.projects?.length?s.projects.map(x=>navigate(x.name,'project',{project:x,hostId:s.hostId},x.revoked?'已撤销 · 历史成果仍可查看':'电脑登记的资料目录')):[text('还没有登记项目','请先在电脑账户页登记资料目录。')]),
      section('网页资料',[text(b.available?'电脑可以读取公共网页':'电脑网页阅读暂不可用'),b.available?navigate('开始网页任务','browserTask',{hostId:b.hostId}):null]),
      saved?section('待核对的项目请求',[navigate('继续核对原请求','project',{hostId:s.hostId,project:s.projects.find(x=>x.projectId===saved.projectId)})]):null]);},
  });
  n.register('project',{
    async read(c,p){if(!p.project||p.project.revoked)return view('项目对话',[section('',[text('这个项目已移除或撤销，请返回资料访问重新选择。')])]);const m=await models(c);return view(p.project.name,[section('使用的模型',[text('本项目中实际读取的资料会交给所选模型。'),choice('modelProfileId','电脑模型',c.core.mobileSettings.savedProjectIntent(p.hostId)?.modelProfileId||m[0]?.profileId,m.map(x=>[x.profileId,x.displayName])),action('在此项目开始对话','start',{}, {primary:true})])]);},
    async act(c,id,p,v){c.prepareSettings('workspaces');const snapshot=await c.call('shared.projects.list'),project=snapshot.projects?.find(x=>x.projectId===p.project?.projectId);if(!project||project.revoked||snapshot.hostId!==p.hostId)throw Error('项目或连接的电脑已改变，请返回资料访问重新选择。');const api=c.core.mobileSettings,prior=api.savedProjectIntent(p.hostId);if(prior&&(prior.projectId!==project.projectId||prior.modelProfileId!==v.modelProfileId))throw Error('上次请求仍待核对，请恢复原项目和模型。');const verified=await c.call('models.verifyHost',{profileId:v.modelProfileId});if(!verified.available)throw Error('所选电脑模型当前不可用，请稍后重试。');const intent=prior||{owner:c.state.owner,hostId:p.hostId,projectId:project.projectId,modelProfileId:v.modelProfileId,requestId:crypto.randomUUID()};localStorage.setItem(api.projectIntentKey(p.hostId),JSON.stringify(intent));const message=document.createElement('p');await api.resolveProjectSessionIntent(intent,message);if(api.savedProjectIntent(p.hostId))throw Error(message.textContent||'请求仍待核对，请稍后重试。');return {effect:{kind:'chat',source:{sessionId:c.state.sharedSessionId}}};},
  });
  n.register('browserTask',{
    async read(c,p){const s=c.core.mobileSettings.savedBrowserIntent(p.hostId),m=await models(c);return view('网页资料任务',[section('',[input('urls','公共网页链接（每行一个，1–5 条）',s?.urls?.join('\n')||'',{multiline:true}),input('goal','希望整理什么',s?.goal||'',{multiline:true}),choice('modelProfileId','电脑模型',s?.modelProfileId||m[0]?.profileId,m.map(x=>[x.profileId,x.displayName])),text('所列网页中实际读取的正文会发送给所选模型。'),action('开始网页任务','start',{}, {primary:true})])]);},
    async act(c,id,p,v){c.prepareSettings('workspaces');const urls=String(v.urls||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),goal=String(v.goal||'').trim();if(!goal||goal.length>6000||/https?:\/\//i.test(goal)||urls.length<1||urls.length>5||urls.some(x=>{try{const u=new URL(x);return !['http:','https:'].includes(u.protocol)||u.username||u.password||new TextEncoder().encode(x).length>2048}catch{return true}})||new TextEncoder().encode(`${goal}\n\n网页链接：\n${urls.join('\n')}`).length>8192)throw Error('请填写目标和 1–5 条完整公共链接，链接不要包含账户或密码。');const api=c.core.mobileSettings,prior=api.savedBrowserIntent(p.hostId);if(prior&&(prior.goal!==goal||JSON.stringify(prior.urls)!==JSON.stringify(urls)||prior.modelProfileId!==v.modelProfileId))throw Error('原网页任务仍待核对，请恢复原内容。');const intent=prior||{owner:c.state.owner,hostId:p.hostId,modelProfileId:v.modelProfileId,goal,urls,sessionRequestId:crypto.randomUUID(),messageRequestId:crypto.randomUUID()};localStorage.setItem(api.browserIntentKey(p.hostId),JSON.stringify(intent));const message=document.createElement('p');await api.resolveBrowserIntent(intent,message);if(api.savedBrowserIntent(p.hostId))throw Error(message.textContent||'原请求仍待核对。');return {effect:{kind:'chat',source:{sessionId:c.state.sharedSessionId}}};},
  });
  n.register('cloudModels',{
    async read(c){c.prepareSettings('models');const s=await c.call('models.account.list');return view('账户云模型',[section('账户配置',s.models?.length?s.models.flatMap(x=>[text(x.name||x.modelId,`${x.modelId} · ${{active:'账户可用',stopped:'已停用',pending:'配置中',failed:'配置失败'}[x.status]||'待核对'}`),x.status==='active'?action('保存到手机','transfer',{row:x}):null,x.status==='active'?action('测试连接','test',{row:x}):null]):[text('账户还没有可取回的云模型')])]);},
    async act(c,id,p){c.prepareSettings('models');const api=c.core.mobileSettings;const result=id==='transfer'?await api.transferAccountModel(p.row):await api.testAccountModel(p.row);const conflict=c.state.accountModelCredentialConflict;if(conflict?.owner===c.state.owner)return {effect:{kind:'page',page:'modelConflict',params:{row:conflict.item}}};if(result?.error)throw Error(result.message);return {message:result?.message||'账户已切换，请重新打开。'};},
  });
  n.register('modelConflict',{
    async read(c,p){return view('模型密钥冲突',[section('',[text('这台手机的同一模型已有不同密钥。'),action('保留手机原密钥','keep'),action('使用账户中的密钥','replace',{}, {confirm:'覆盖手机上这个模型的密钥？当前选用模型保持不变。'})])]);},
    async act(c,id,p){if(id==='replace'){const result=await c.core.mobileSettings.transferAccountModel(p.row,true);if(result?.error)throw Error(result.message);}else c.state.accountModelCredentialConflict=null;return {effect:{kind:'page',page:'cloudModels'}};},
  });
  n.register('offlineWork',{
    async read(c,p){const api=c.offline();await api?.refresh().catch(()=>{});const s=api?.view()||{},hosts=c.accountCore.cloudAuthView().hosts||[];return view('交给电脑，上线后做',[
      section('新任务',[text('先记下要做的事，电脑上线后会接收。'),input('text','任务内容',p.text||'',{multiline:true}),choice('hostId','交给哪台电脑',p.hostId||s.hostId,hosts.length?hosts.map(x=>[x.hostId,x.name||'这台电脑']):[[s.hostId,'已连接的电脑']]),action('记下来','submit',{}, {primary:true,enabled:s.taskReady===true})]),
      section('已记录任务',(s.tasks||[]).length?s.tasks.flatMap(x=>[text(x.text,{waiting:'等待电脑上线',claimed:'电脑正在接收',received:'电脑已接收',running:'执行中',completed:'已完成',cancelled:'已取消',failed:'未完成',sending:'提交结果待核对'}[x.state]||'状态待核对'),x.state==='sending'?action('核对原请求','retry',{id:x.id}):null,['waiting','claimed'].includes(x.state)?action('取消任务','cancel',{id:x.id},{confirm:'取消这项尚未由电脑接收的任务？'}):null,x.sessionId?action('打开电脑对话','source',{source:x}):null]):[text('还没有离线任务')])]);},
    async act(c,id,p,v){const api=c.offline();if(!api)throw Error('请先连接电脑，准备离线副本。');if(id==='source')return {effect:{kind:'chat',source:p.source}};if(id==='submit')await api.submit(v.text,v.hostId,p.conversationId);else await api[id](p.id);return {message:'已提交，请核对任务状态',resetValues:true};},
  });
})();
