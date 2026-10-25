/* One notification settings form for desktop, remote web and Android UI. */
globalThis.WeftNotificationsView = (core,target,device={}) => {
  const review=device.section==='reviewHealth';
  const controls=globalThis.WeftSettingsControls, identity=core.state.identityGeneration;
  const current=()=>target.isConnected&&identity===core.state.identityGeneration;
  const node=(tag,text='',cls='')=>{const el=document.createElement(tag);el.textContent=text;el.className=cls;return el;};
  const form=node('form','','personalization-form notification-settings'),notice=node('div','','muted');notice.setAttribute('role','status');
  const fields=new Map(),healthFields=new Map();let ready=false,saved,localDelivery=false,healthReady=false,healthSaved,healthNotice;
  target.replaceChildren(form);form.append(notice);notice.append(WeftControls.skeleton({rows:1,compact:true}));
  const busy=value=>{for(const el of form.querySelectorAll('input,select,button'))el.disabled=value||el.dataset.reserved==='true';};
  const fill=settings=>{for(const [key,el] of fields){if(el.type==='checkbox')el.checked=settings[key];else el.value=String(settings[key]);el.dispatchEvent(new Event('weft:sync'));}};
  async function write(patch){if(!ready||!current())return;busy(true);notice.textContent='正在同步…';
    try{const value=await core.saveNotificationSettings(patch);if(current()){saved=value.settings;fill(saved);notice.textContent='';device.toast?.('通知规则已保存。');}return true;}
    catch{if(current()){notice.textContent='未能同步，请重试。';fill(saved);}return false;}
    finally{if(current())busy(false);}
  }
  const fillHealth=settings=>{for(const [key,el]of healthFields){if(el.type==='checkbox')el.checked=settings[key];else{const value=String(settings[key]);if(key==='sleepTargetMinutes'&&![...el.options].some(o=>o.value===value)){const minutes=settings[key];el.append(new Option(`${Math.floor(minutes/60)} 小时${minutes%60?` ${minutes%60} 分钟`:''}`,value));}el.value=value;}el.dispatchEvent(new Event('weft:sync'));}};
  async function writeHealth(patch){if(!healthReady||!current())return false;busy(true);healthNotice.textContent='正在保存…';try{const value=await core.saveHealthSettings(patch);if(current()){healthSaved=value.settings;fillHealth(healthSaved);healthNotice.textContent='';device.toast?.(patch.clear?'健康数据已清空。':'健康设置已保存。');}return true;}catch{if(current()){healthNotice.textContent='未能保存，请重试。';fillHealth(healthSaved);}return false;}finally{if(current())busy(false);}}
  function field(key,label,description,type,options,health=false){
    const el=node(type==='select'?'select':'input');el.id=(health?'health-':'notifications-')+key;el.setAttribute('aria-label',label);if(health)el.dataset.reserved='true';
    if(type==='select'){el.dataset.checkSelection='true';for(const [value,title] of options)el.append(new Option(title,value));}
    else{el.type=type;if(type==='checkbox')controls.toggle(el);}
    form.append(controls.row(label,description,el));(health?healthFields:fields).set(key,el);
    el.addEventListener('change',()=>{if(el.reportValidity())void (health?writeHealth:write)({[key]:type==='checkbox'?el.checked:['memoryDigestWeekday','reviewRetentionDays','sleepTargetMinutes'].includes(key)?Number(el.value):['dailyLimit','retentionDays'].includes(key)?(el.value==='null'?null:Number(el.value)):el.value});});
    if(type==='select')globalThis.WeftPopover?.bindSettingsSelect(el);
    return el;
  }
  if(!review){
  const modes=[['sound','通知 + 声音'],['notify','只通知'],['activity','只进动态不通知']];
  for(const [key,label,description] of [
    ['approval','待审批','需要你批准后才能继续的事项，默认重要提醒。'],
    ['question','待回答','需要你补充信息的事项，默认重要提醒。'],
    ['task','任务完成 / 失败','你发起的任务结果不会计入每日主动提醒上限。'],
    ['reminder','提醒与定时任务','按你设定的时间提醒，使用同一套勿扰规则。'],
    ['memory','记忆状态','只在暂停、不可用等异常时提醒，正常更新只进动态。'],
    ['memoryReport','每周记忆小结','通知只提示周报已生成，具体内容在动态里查看。'],
    ['system','系统','有可用更新时提醒。']]){
      field(key,label,description,'select',modes);
  }
  }
  if(review){
  form.append(node('h2','回顾与洞察'));
  field('reviewEnabled','回顾与洞察','每天在这台电脑整理使用摘要；每周在动态里回顾，聊天时可接续最近的事情。','checkbox');
  field('computerUsageEnabled','记录这台电脑的使用时段','只记什么时候在用，不记在用什么。','checkbox');
  field('reviewRetentionDays','保留多久','只保存在这台电脑，清空后不再用于聊天背景。','select',[[7,'7 天'],[30,'30 天'],[90,'90 天'],[180,'180 天'],[365,'365 天']]);
  const clear=node('button','清空回顾','button secondary');clear.type='button';
  clear.onclick=()=>{const focus=document.activeElement,box=node('dialog','',core.android?.call?'session-action-dialog data-dialog review-clear-dialog':'dialog confirm-dialog data-dialog review-clear-dialog');box.setAttribute('aria-label','清空回顾与洞察');box.append(node('h2','清空回顾与洞察'),node('p','删除已保存的摘要和周回顾，之后从明天重新开始整理。对话、成果和记忆会保留。'));
    const cancel=node('button','取消','button secondary'),confirm=node('button','确认清空','button danger');cancel.type=confirm.type='button';cancel.onclick=()=>box.close();confirm.onclick=async()=>{box.close();if(await write({reviewClear:true}))device.toast?.('回顾已清空。');};const actions=node('div','','actions');actions.append(cancel,confirm);box.append(actions);box.addEventListener('close',()=>{box.remove();focus?.focus();});document.body.append(box);globalThis.WeftPopover?.bindSettings(box);box.showModal();cancel.focus();};
  form.append(controls.row('已保存的回顾','清空后，助手不再引用这些摘要。',clear));
  form.append(node('h2','健康数据'));
  healthNotice=node('div','','muted');healthNotice.setAttribute('role','status');form.append(healthNotice);healthNotice.append(WeftControls.skeleton({rows:1,compact:true}));
  field('modelInsightsEnabled','用模型解读','会把每天的汇总数字发给你设置的模型，不发明细。','checkbox',undefined,true);
  field('itemAnalysisEnabled','各项 AI 分析','展开时才分析这一项；会把每天的汇总数字发给你设置的模型，不发明细。','checkbox',undefined,true);
  field('sleepTargetMinutes','睡眠目标','用来比较自己的睡眠时长。','select',[[360,'6 小时'],[390,'6.5 小时'],[420,'7 小时'],[450,'7.5 小时'],[480,'8 小时'],[510,'8.5 小时'],[540,'9 小时']],true);
  field('retentionDays','健康数据保留多久','只保存在这台电脑，独立于使用回顾。','select',[[90,'90 天'],[180,'180 天'],[400,'400 天'],['null','一直']],true);
  const healthClear=node('button','清空健康数据','button secondary');healthClear.type='button';healthClear.dataset.reserved='true';
  healthClear.onclick=()=>{const focus=document.activeElement,box=node('dialog','',core.android?.call?'session-action-dialog data-dialog review-clear-dialog':'dialog confirm-dialog data-dialog review-clear-dialog');box.setAttribute('aria-label','清空健康数据');box.append(node('h2','清空健康数据'),node('p','删除这台电脑上保存的健康记录和解读。使用回顾、对话和记忆会保留。'));const cancel=node('button','取消','button secondary'),confirm=node('button','确认清空','button danger');cancel.type=confirm.type='button';cancel.onclick=()=>box.close();confirm.onclick=async()=>{box.close();await writeHealth({clear:true});};const actions=node('div','','actions');actions.append(cancel,confirm);box.append(actions);box.addEventListener('close',()=>{box.remove();focus?.focus();});document.body.append(box);globalThis.WeftPopover?.bindSettings(box);box.showModal();cancel.focus();};
  form.append(controls.row('已保存的健康数据','清空后，助手不再引用这些健康记录。',healthClear));
  async function loadHealth(){try{const value=await core.loadHealthSettings();if(!current())return;healthSaved=value.settings;fillHealth(healthSaved);const item=healthFields.get('itemAnalysisEnabled');if(!Object.hasOwn(healthSaved,'itemAnalysisEnabled')){item.closest?.('.settings-row')?.remove();item.disabled=true;healthFields.delete('itemAnalysisEnabled');}healthReady=true;for(const el of [...healthFields.values(),healthClear]){el.dataset.reserved='false';el.disabled=false;}healthNotice.textContent='';}catch{if(!current())return;healthNotice.textContent='无法读取健康设置，请连接电脑后重试。';const retry=node('button','重试健康设置','button secondary');retry.type='button';retry.onclick=()=>{retry.remove();void loadHealth();};healthNotice.append(retry);}}
  void loadHealth();
  }
  let zone;
  if(!review){
  form.append(node('h2','记忆周报'));
  field('memoryDigestEnabled','每周生成记忆周报','这一周有新记忆或变更时，在动态里整理一次。','checkbox');
  field('memoryDigestWeekday','每周哪一天','按账户时区；关机错过后，下次启动补发最近一周。','select',[[1,'星期一'],[2,'星期二'],[3,'星期三'],[4,'星期四'],[5,'星期五'],[6,'星期六'],[0,'星期日']]);
  field('memoryDigestTime','生成时间','默认星期日晚上 21:00；不调用模型整理周报。','time');
  form.append(node('h2','勿扰时段'));
  field('dndEnabled','启用勿扰','期间通知仍进动态，结束后只给一条汇总，不逐条补响。','checkbox');
  zone=node('p','','muted');form.append(zone);
  field('dndStart','开始时间','可跨午夜；开始和结束相同时表示全天勿扰。','time');
  field('dndEnd','结束时间','按账户时区计算，结束后恢复提醒。','time');
  field('approvalException','需要我批准的事仍然通知','只放行待审批；待回答和任务结果仍按勿扰规则处理。','checkbox');
  form.append(node('h2','主动提醒与声音'));
  field('dailyLimit','每日主动打扰上限','仅计算助手主动发起的提醒。你发起的任务结果与审批不计入；每天按账户时区重置。','select',[[0,'0 条'],[3,'3 条'],[5,'5 条'],[10,'10 条'],['null','不限']]);
  field('soundEnabled','通知声音','音量随系统。使用这台设备的系统通知声音。','checkbox');
  const actions=node('div','','actions'),test=node('button','发送测试通知','button secondary');test.type='button';
  test.onclick=async()=>{busy(true);notice.textContent='正在发送…';try{await core.sendTestNotification();if(device.poll&&localDelivery)await device.poll();if(current())notice.textContent='测试通知已发送。未出现时，请检查这台设备的系统通知权限。';}catch{if(current())notice.textContent='测试通知未发送，请连接电脑后重试。';}finally{if(current())busy(false);}};
  actions.append(test);form.append(actions);
  const permission=node('p','','muted');form.append(permission);
  if(globalThis.weftmateDesktop?.notificationPermission){
    const check=node('button','检查系统通知权限','button secondary');check.type='button';
    check.onclick=async()=>{try{const value=await globalThis.weftmateDesktop.notificationPermission();if(current())permission.textContent=value.enabled===false?'系统通知已关闭。打开 Windows 设置 → 系统 → 通知，开启通知与 WeftMate。':value.enabled===true?'系统通知已开启。若未出现，请在 Windows 设置 → 系统 → 通知中检查 WeftMate 和系统勿扰。':'请在 Windows 设置 → 系统 → 通知中检查 WeftMate 和系统勿扰。';}catch{if(current())permission.textContent='无法读取系统权限，请在 Windows 设置 → 系统 → 通知中检查 WeftMate。';}};
    const open=node('button','打开 Windows 通知设置','button secondary');open.type='button';open.onclick=()=>globalThis.weftmateDesktop.openNotificationSettings().catch(()=>{permission.textContent='请手动打开 Windows 设置 → 系统 → 通知。';});actions.append(check,open);void check.onclick();
  } else if(device.permissionState){
    form.append(node('h2','这台设备'),permission,actions);
    const channels=node('div');form.append(channels);
    const background=node('p','进程被系统结束后会尽力补发，可能延迟约 15 分钟以上，不保证及时。','muted');form.append(background);
    const check=node('button','检查系统通知状态','button secondary');check.type='button';
    check.onclick=async()=>{permission.textContent='正在检查系统通知…';try{const value=await device.permissionState();if(!current())return;localDelivery=value.activityDeliveryVersion===1;
      permission.textContent=value.systemAllowed?'系统通知已开启。':'系统通知已关闭。在系统设置 → 应用 → WeftMate → 通知中开启。拒绝权限后仍可在动态查看。';
      channels.replaceChildren();const groups=new Map();for(const channel of value.channels??[]){const [name,mode]=channel.name.split(' · ');const list=groups.get(name)??[];list.push(`${mode}：${channel.enabled?'已开启':'系统已关闭'}`);groups.set(name,list);}for(const [name,list]of groups){const spacer=node('span');spacer.hidden=true;channels.append(controls.row(name,list.join(' · '),spacer));}
      background.textContent=(value.backgroundRestricted?'系统限制了后台运行。':'')+'进程被系统结束后会尽力补发，可能延迟约 15 分钟以上，不保证及时。'+(value.batteryOptimized?'电池优化可能进一步延迟通知，可在应用系统设置中查看后台限制。':'');
    }catch{if(current())permission.textContent='无法读取系统通知状态，请在系统设置 → 应用 → WeftMate → 通知中检查。';}};
    const allow=node('button','开启通知权限','button secondary');allow.type='button';allow.onclick=()=>device.requestPermission().catch(()=>{if(current())permission.textContent='请在系统设置 → 应用 → WeftMate → 通知中开启。';});actions.append(check,allow);
    if(device.openSettings){const open=node('button','打开系统通知设置','button secondary');open.type='button';open.onclick=()=>device.openSettings().catch(()=>{permission.textContent='请在系统设置 → 应用 → WeftMate → 通知中开启。';});actions.append(open);}
    if(device.openBatterySettings){const battery=node('button','查看后台运行设置','button secondary notification-settings-link');battery.type='button';battery.append(WeftIcons.create('right',16));battery.onclick=()=>device.openBatterySettings().catch(()=>{background.textContent='请在系统设置 → 应用 → WeftMate 中查看后台运行限制。';});form.append(battery);}
    void check.onclick();
  } else if(globalThis.weftNative){permission.textContent='安卓：在系统设置 → 应用 → WeftMate → 通知中开启。后台通知可能延迟约 15 分钟以上。';}
  else{permission.textContent='网页中的规则会同步到同一账户。系统通知由连接的 WeftMate 程序或手机应用发送，请在相应设备的系统设置中开启通知。';}
  }
  form.onsubmit=event=>event.preventDefault();busy(true);
  void core.loadNotificationSettings().then(value=>{if(current()){saved=value.settings;fill(saved);if(!review)zone.textContent='按账户时区安排勿扰时段。';ready=true;busy(false);notice.textContent='';}}).catch(()=>{if(!current())return;notice.textContent='无法读取通知设置，请连接电脑后重试。';const retry=node('button','重试读取','button secondary');retry.type='button';retry.onclick=()=>globalThis.WeftNotificationsView(core,target,device);form.append(retry);});
};
