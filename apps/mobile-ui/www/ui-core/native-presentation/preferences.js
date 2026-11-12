/* Account preference forms share the same validation, storage and synchronization as the other clients. */
(() => {
  const n=WeftUiCore.nativePresentation, {view,section,text,input,toggle,choice,action}=n;
  const pair=(...values)=>values.map(x=>Array.isArray(x)?x:[x,x]);
  const preferenceAct=async(c,id,p,v)=>{
    if(id==='save')await c.core.savePersonalization(v);
    else if(id==='set')await c.core.savePersonalization({[p.key]:p.value});
    else if(id==='extract')await c.core.savePersonalization({},true);
    else if(id==='clearStyle')await c.core.savePersonalization({writingStyle:''});
    else throw Error('请重新打开设置。');
    return {message:'已保存'};
  };
  n.register('personalization',{
    async read(c){const value=await c.core.loadPersonalization(),s=WeftPersonalization.settings(value?.settings);
      return view('个性化',[
        section('关于你',[input('preferredName','怎么称呼你',s.preferredName),input('bio','你的简介',s.bio,{multiline:true})]),
        section('回复方式',[choice('tone','回复语气',s.tone,pair(['natural','自然、亲切'],['concise','简洁、直接'],['detailed','详细、耐心'],['formal','正式、严谨'],['casual','轻松、随和']),'set'),input('toneInstructions','自定义语气说明',s.toneInstructions,{multiline:true}),input('fixedInstructions','固定说明',s.fixedInstructions,{multiline:true})]),
        section('写作风格',[toggle('useWritingStyle','参考我的写作风格',s.useWritingStyle,'set'),input('writingStyle','提炼结果',s.writingStyle,{multiline:true}),action('重新提炼','extract'),action('清除提炼结果','clearStyle',{}, {confirm:'清除已提炼的写作风格？你的对话会保留。'})]),
        section('',[action('保存个性化','save',{}, {primary:true}),!value?.synced&&value?.synced!==undefined?text('已保存在本机，连接电脑后自动同步。'):null])]);
    },act:preferenceAct,
  });
  n.register('assistant',{
    async read(c){const s=WeftPersonalization.settings((await c.core.loadPersonalization())?.settings);
      return view('助手',[
        section('输入与建议',[toggle('nextSuggestionsEnabled','下一步建议',s.nextSuggestionsEnabled,'set','回复结束后给出相关短句，点一下填进输入框。'),toggle('inlineCompletionEnabled','输入时补全',s.inlineCompletionEnabled,'set','输入时建议后半句；可以按 Tab 接受。')]),
        section('回答与思考',[toggle('webSearch','网页搜索',s.webSearch,'set','允许搜索和读取网页。'),toggle('researchSelfCheck','成文前核对事实',s.researchSelfCheck,'set','用已经读取的原文核对关键结论和数字。'),choice('verbosity','回答详细程度',s.verbosity,pair(['short','简短'],['medium','适中'],['thorough','详尽']),'set'),choice('thinkingDisplay','显示思考过程',s.thinkingDisplay,pair(['collapsed','折叠'],['expanded','展开'],['hidden','不显示']),'set'),toggle('defaultDeepThinking','新对话默认深入思考',s.defaultDeepThinking,'set','仅对支持深入思考的模型生效。')]),
        section('回复进行中',[choice('messageMode','回复进行中时发送的消息',s.messageMode,pair(['queue','排队'],['steer','引导']),'set','排队会等当前回复结束；引导会调整当前回复的方向。')])]);
    },act:preferenceAct,
  });
  async function notifications(c,review){
    const value=await c.core.loadNotificationSettings(),s=value.settings||{};
    const modes=pair(['sound','通知 + 声音'],['notify','只通知'],['activity','只进动态']);
    if(review){const h=(await c.core.loadHealthSettings()).settings||{};
      return view('回顾与健康',[
        section('回顾与洞察',[toggle('reviewEnabled','回顾与洞察',s.reviewEnabled,'notification','每天在电脑整理使用摘要。'),toggle('computerUsageEnabled','记录电脑使用时段',s.computerUsageEnabled,'notification','只记录什么时候在用。'),choice('reviewRetentionDays','回顾保留多久',s.reviewRetentionDays,[7,30,90,180,365].map(x=>[x,x+' 天']),'notification'),action('清空回顾','clearReview',{}, {danger:true,confirm:'删除已保存的摘要和周回顾？对话、成果和记忆保留。'})]),
        section('健康数据',[toggle('modelInsightsEnabled','用模型解读',h.modelInsightsEnabled,'health','把每日汇总数字发送给你设置的模型。'),toggle('itemAnalysisEnabled','各项分析',h.itemAnalysisEnabled,'health','展开时才分析这一项。'),choice('sleepTargetMinutes','睡眠目标',h.sleepTargetMinutes,[360,390,420,450,480,510,540].map(x=>[x,x/60+' 小时']),'health'),choice('retentionDays','健康数据保留多久',h.retentionDays,[[90,'90 天'],[180,'180 天'],[400,'400 天'],[null,'一直']],'health'),action('清空健康数据','clearHealth',{}, {danger:true,confirm:'删除电脑保存的健康记录和解读？使用回顾、对话和记忆保留。'})])]);
    }
    const permission=await c.call('notifications.state');
    return view('通知',[
      section('通知类型',pair(['approval','待审批'],['question','待回答'],['task','任务完成 / 失败'],['reminder','提醒与定时任务'],['memory','记忆状态'],['memoryReport','每周记忆小结'],['system','系统']).map(([key,label])=>choice(key,label,s[key],modes,'notification'))),
      section('勿扰与声音',[toggle('soundEnabled','通知声音',s.soundEnabled,'notification'),toggle('dndEnabled','启用勿扰',s.dndEnabled,'notification'),input('dndStart','开始时间',s.dndStart),input('dndEnd','结束时间',s.dndEnd),toggle('approvalException','需要我批准的事仍然通知',s.approvalException,'notification'),choice('dailyLimit','每日主动提醒上限',s.dailyLimit,[[0,'不主动提醒'],[3,'3 次'],[5,'5 次'],[10,'10 次'],[null,'不限']],'notification'),action('保存勿扰时间','quiet')]),
      section('记忆周报',[toggle('memoryDigestEnabled','每周生成记忆周报',s.memoryDigestEnabled,'notification'),choice('memoryDigestWeekday','每周哪一天',s.memoryDigestWeekday,['日','一','二','三','四','五','六'].map((x,i)=>[i,'周'+x]),'notification'),input('memoryDigestTime','生成时间',s.memoryDigestTime),action('保存周报时间','digestTime')]),
      section('这台手机',[text(permission.systemAllowed?'系统通知已开启':'系统通知已关闭','系统结束进程后，通知可能延迟；仍可在动态查看。'),...(permission.channels||[]).map(x=>text(x.name,x.enabled?'已开启':'已关闭')),action('申请通知权限','permission'),action('打开系统通知设置','notificationSettings'),action('打开电池设置','batterySettings'),action('发送测试通知','test')])]);
  }
  const notificationAct=async(c,id,p,v)=>{
    if(id==='notification')await c.core.saveNotificationSettings({[p.key]:p.value});
    else if(id==='health')await c.core.saveHealthSettings({[p.key]:p.value});
    else if(id==='quiet')await c.core.saveNotificationSettings({dndStart:v.dndStart,dndEnd:v.dndEnd});
    else if(id==='digestTime')await c.core.saveNotificationSettings({memoryDigestTime:v.memoryDigestTime});
    else if(id==='clearReview')await c.core.saveNotificationSettings({reviewClear:true});
    else if(id==='clearHealth')await c.core.saveHealthSettings({clear:true});
    else if(id==='test')await c.core.sendTestNotification();
    else if(id==='permission')await c.call('notifications.requestPermission');
    else if(id==='notificationSettings')await c.call('notifications.openSettings');
    else if(id==='batterySettings')await c.call('notifications.openBatterySettings');
    else throw Error('请重新打开通知设置。');
    return {message:'已完成'};
  };
  n.register('notifications',{read:c=>notifications(c,false),act:notificationAct});
  n.register('reviewHealth',{read:c=>notifications(c,true),act:notificationAct});
  n.register('approvals',{
    async read(c){const s=await c.core.readPermissionRules();return view('权限',[
      section('操作规则',(s.types||[]).map(t=>choice(t.id,t.label,s.rules?.[t.id]||(s.mode==='ask'?'ask':s.mode==='allow-all'&&!t.restricted?'allow':t.default)||'ask',(t.options||['allow','ask','deny']).map(x=>typeof x==='string'?[x,{allow:'允许',ask:'询问',deny:'禁止'}[x]||x]:[x.id||x.value,x.label]),'rule',t.description||''))),
      section('动手前核对',[toggle('secondOpinionEnabled','动手前多看一眼',s.secondOpinionEnabled,'secondOpinion'),action('恢复默认','reset',{}, {confirm:'恢复默认操作权限？'})])]);},
    async act(c,id,p){if(id==='rule')await c.core.savePermissionRules({[p.key]:p.value});else if(id==='secondOpinion')await c.core.saveSecondOpinion(p.value);else if(id==='reset'){const s=await c.core.readPermissionRules();await c.core.savePermissionRules(Object.fromEntries((s.types||[]).map(t=>[t.id,null])));}return {message:'权限已保存'};},
  });
  n.register('appearance',{
    async read(c){const s=c.appearance();const colors=pair(['neutral','中性'],['blue','蓝色'],['green','绿色'],['purple','紫色']);return view('外观',[
      section('强调色',[choice('accentLight','浅色强调色',s.accentLight,colors,'appearance'),choice('accentDark','深色强调色',s.accentDark,colors,'appearance')])]);},
    async act(c,id,p,v){await c.setAppearance(id==='colors'?v:{[p.key]:p.value});return {message:'外观已保存'};},
  });
})();
