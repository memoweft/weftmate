/* One notification settings form for desktop, remote web and Android UI. */
globalThis.WeftNotificationsView = (core,target,device={}) => {
  const controls=globalThis.WeftSettingsControls, identity=core.state.identityGeneration;
  const current=()=>target.isConnected&&identity===core.state.identityGeneration;
  const node=(tag,text='',cls='')=>{const el=document.createElement(tag);el.textContent=text;el.className=cls;return el;};
  const form=node('form','','personalization-form notification-settings'),notice=node('p','正在读取…','muted');notice.setAttribute('role','status');
  const fields=new Map();let ready=false,saved;
  target.replaceChildren(form);form.append(notice);
  const busy=value=>{for(const el of form.querySelectorAll('input,select,button'))el.disabled=value||el.dataset.reserved==='true';};
  const fill=settings=>{for(const [key,el] of fields){if(el.type==='checkbox')el.checked=settings[key];else el.value=String(settings[key]);el.dispatchEvent(new Event('weft:sync'));}};
  async function write(patch){if(!ready||!current())return;busy(true);notice.textContent='正在同步…';
    try{const value=await core.saveNotificationSettings(patch);if(current()){saved=value.settings;fill(saved);notice.textContent='已同步 · 通知规则立即生效';}}
    catch{if(current()){notice.textContent='未能同步，请重试。';fill(saved);}}
    finally{if(current())busy(false);}
  }
  function field(key,label,description,type,options){
    const el=node(type==='select'?'select':'input');el.id='notifications-'+key;el.setAttribute('aria-label',label);
    if(type==='select'){for(const [value,title] of options)el.append(new Option(title,value));}
    else{el.type=type;if(type==='checkbox')controls.toggle(el);}
    form.append(controls.row(label,description,el));fields.set(key,el);
    el.addEventListener('change',()=>{if(el.reportValidity())void write({[key]:type==='checkbox'?el.checked:key==='dailyLimit'?(el.value==='null'?null:Number(el.value)):el.value});});
    if(type==='select')globalThis.WeftPopover?.bindSettingsSelect(el);
    return el;
  }
  const modes=[['sound','通知 + 声音'],['notify','只通知'],['activity','只进动态不通知']];
  for(const [key,label,description] of [
    ['approval','待审批','需要你批准后才能继续的事项，默认重要提醒。'],
    ['question','待回答','需要你补充信息的事项，默认重要提醒。'],
    ['task','任务完成 / 失败','你发起的任务结果不会计入每日主动提醒上限。'],
    ['reminder','提醒与定时任务','按你设定的时间提醒，使用同一套勿扰规则。'],
    ['memory','记忆状态','只在暂停、不可用等异常时提醒，正常更新只进动态。'],
    ['memoryReport','每周记忆小结','每周小结尚未开放，开放后可在这里设置。'],
    ['system','系统','有可用更新时提醒。']]){
      const el=field(key,label,description,'select',modes);if(key==='memoryReport'){el.dataset.reserved='true';el.disabled=true;}
  }
  form.append(node('h2','勿扰时段'));
  field('dndEnabled','启用勿扰','期间通知仍进动态，结束后只给一条汇总，不逐条补响。','checkbox');
  const zone=node('p','','muted');form.append(zone);
  field('dndStart','开始时间','可跨午夜；开始和结束相同时表示全天勿扰。','time');
  field('dndEnd','结束时间','按账户时区计算，结束后恢复提醒。','time');
  field('approvalException','需要我批准的事仍然通知','只放行待审批；待回答和任务结果仍按勿扰规则处理。','checkbox');
  form.append(node('h2','主动提醒与声音'));
  field('dailyLimit','每日主动打扰上限','仅计算助手主动发起的提醒。你发起的任务结果与审批不计入；每天按账户时区重置。','select',[[0,'0 条'],[3,'3 条'],[5,'5 条'],[10,'10 条'],['null','不限']]);
  field('soundEnabled','通知声音','音量随系统。Windows 使用系统通知声音。','checkbox');
  const actions=node('div','','actions'),test=node('button','发送测试通知','button secondary');test.type='button';
  test.onclick=async()=>{busy(true);notice.textContent='正在发送…';try{await core.sendTestNotification();if(current())notice.textContent='测试通知已发送。未出现时，请检查这台设备的系统通知权限。';}catch{if(current())notice.textContent='测试通知未发送，请连接电脑后重试。';}finally{if(current())busy(false);}};
  actions.append(test);form.append(actions);
  const permission=node('p','','muted');form.append(permission);
  if(globalThis.weftmateDesktop?.notificationPermission){
    const check=node('button','检查系统通知权限','button quiet');check.type='button';
    check.onclick=async()=>{try{const value=await globalThis.weftmateDesktop.notificationPermission();if(current())permission.textContent=value.enabled===false?'系统通知已关闭。打开 Windows 设置 → 系统 → 通知，开启通知与 WeftMate。':value.enabled===true?'系统通知已开启。若未出现，请在 Windows 设置 → 系统 → 通知中检查 WeftMate 和系统勿扰。':'请在 Windows 设置 → 系统 → 通知中检查 WeftMate 和系统勿扰。';}catch{if(current())permission.textContent='无法读取系统权限，请在 Windows 设置 → 系统 → 通知中检查 WeftMate。';}};
    const open=node('button','打开 Windows 通知设置','button quiet');open.type='button';open.onclick=()=>globalThis.weftmateDesktop.openNotificationSettings().catch(()=>{permission.textContent='请手动打开 Windows 设置 → 系统 → 通知。';});actions.append(check,open);void check.onclick();
  } else if(device.permissionState){
    permission.textContent='安卓后台通知可能延迟约 15 分钟以上。';
    const allow=node('button','打开通知权限','button quiet');allow.type='button';allow.onclick=()=>device.requestPermission().catch(()=>{if(current())permission.textContent='请在系统设置 → 应用 → WeftMate → 通知中开启。';});actions.append(allow);
    void device.permissionState().then(value=>{if(current())permission.textContent=(value.systemAllowed?'系统通知已开启。':'系统通知已关闭，请在系统设置 → 应用 → WeftMate → 通知中开启。')+'后台通知可能延迟约 15 分钟以上。';}).catch(()=>{});
  } else if(globalThis.weftNative){permission.textContent='安卓：在系统设置 → 应用 → WeftMate → 通知中开启。后台通知可能延迟约 15 分钟以上。';}
  else{permission.textContent='网页中的规则会同步到同一账户。系统通知由连接的 WeftMate 程序或手机应用发送，请在相应设备的系统设置中开启通知。';}
  form.onsubmit=event=>event.preventDefault();busy(true);
  void core.loadNotificationSettings().then(value=>{if(current()){saved=value.settings;fill(saved);zone.textContent=`账户时区：${value.timeZone}`;ready=true;busy(false);notice.textContent='已同步 · 通知规则立即生效';}}).catch(()=>{if(!current())return;notice.textContent='无法读取通知设置，请连接电脑后重试。';const retry=node('button','重试读取','button secondary');retry.type='button';retry.onclick=()=>globalThis.WeftNotificationsView(core,target);form.append(retry);});
};
