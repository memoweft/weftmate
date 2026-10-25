/* Shared settings presentation. All reads and writes use the existing feature actions. */
(() => {
  const node = (tag, cls = '', text = '') => { const item = document.createElement(tag); item.className = cls; item.textContent = text; return item; };
  const decorateSelect = (select, label) => { WeftSettingsControls.select(select);const menu=select.nextElementSibling?.nextElementSibling;if(menu?.classList.contains('settings-select-menu')){menu.classList.add('permission-select-menu');menu.dataset.fieldLabel=label;} };
  const values = [['allow','总是允许'],['ask','每次问'],['deny','禁止']];
  globalThis.WeftPermissionRulesView = (core, target, { toast = () => {}, project = null, changed = () => {} } = {}) => {
    const identity = core.state.identityGeneration, generation = target.permissionGeneration = (target.permissionGeneration ?? 0) + 1;
    const current = () => target.isConnected && identity === core.state.identityGeneration && generation === target.permissionGeneration;
    const body = node('div','permission-rules'), notice = node('p','muted'); notice.setAttribute('role','status');
    target.replaceChildren(body); body.append(notice,WeftControls.skeleton({rows:2}));
    let rules = { ...(project?.permissionRules ?? {}) }, saved;
    const defaultValue = type => saved.mode === 'ask' ? 'ask' : saved.mode === 'allow-all' && !type.restricted ? 'allow' : type.default;
    const fail = () => { body.replaceChildren(notice);notice.hidden = false; notice.textContent = '暂时无法读取，点重试再看看。'; const retry = node('button','button secondary small','重试'); retry.type='button'; retry.onclick=load; notice.append(retry); };
    async function load() {
      try { saved = await core.readPermissionRules(); if (!current()) return; draw(); }
      catch { if (current()) fail(); }
    }
    function draw() {
      body.replaceChildren();
      if (!project) rules = { ...saved.rules };
      body.append(node('p','muted',project ? '未单独设置的操作沿用通用设置。' : '选择助手动手前是否询问你。未调整的操作继续沿用现在的做法。'));
      if (!project) {
        const toggle=node('input');toggle.type='checkbox';toggle.id='second-opinion-enabled';toggle.checked=saved.secondOpinionEnabled!==false;
        WeftSettingsControls.toggle(toggle);
        body.append(WeftSettingsControls.row('动手前多看一眼','涉及删除、覆盖、发送等操作时，请另一个模型核对你的要求。仍由你批准。',toggle));
        toggle.addEventListener('change',async()=>{const enabled=toggle.checked;toggle.disabled=true;
          try{const next=await core.saveSecondOpinion(enabled);if(current()){saved=next;toast('已保存');}}
          catch{if(current()){toggle.checked=saved.secondOpinionEnabled!==false;toast('保存未完成，请重试。');}}
          finally{if(current())toggle.disabled=false;}
        });
      }
      for (const type of saved.types) {
        const select = node('select'); select.setAttribute('aria-label', type.label); select.id=`permission-${project?.projectId ?? 'global'}-${type.id}`;
        const options = project ? [['','继承通用设置'],...values] : values;
        for (const [value,label] of options) { if (value === 'allow' && type.restricted) continue; const option=node('option','',label); option.value=value; select.append(option); }
        select.value = rules[type.id] ?? (project ? '' : defaultValue(type));
        const source = node('small','permission-source', rules[type.id] ? project ? '项目单独设置' : '已自定义' : project ? '继承通用设置' : '沿用当前做法');
        const line = WeftSettingsControls.row(type.label, type.description ?? '', select); line.firstElementChild.append(source); body.append(line);
        select.addEventListener('change',async () => {
          const value=select.value;
          if (project) { if (value) rules[type.id]=value; else delete rules[type.id]; source.textContent=value?'项目单独设置':'继承通用设置'; changed({...rules}); return; }
          select.disabled=true;select.dispatchEvent(new Event('weft:sync'));
          try { const next=await core.savePermissionRules({[type.id]:value}); if (!current()) return; saved=next;rules={...next.rules};source.textContent='已自定义';toast('已保存'); }
          catch { if (current()) { select.value=rules[type.id]??defaultValue(type);toast('保存未完成，请重试。'); } }
          finally { if (current()) { select.disabled=false;select.dispatchEvent(new Event('weft:sync')); } }
        });
        decorateSelect(select,type.label);
      }
      if (!project) {
        const reset=node('button','button secondary small','恢复默认');reset.type='button';reset.onclick=async()=>{reset.disabled=true;try{saved=await core.savePermissionRules(Object.fromEntries(Object.keys(rules).filter(type=>saved.types.some(row=>row.id===type)).map(type=>[type,null])));if(current()){draw();toast('已恢复默认');}}catch{if(current()){reset.disabled=false;toast('恢复未完成，请重试。');}}};body.append(reset);
      }
    }
    void load();
  };
  globalThis.WeftExecutionRecordsView = (core, target, { openConversation, current: visible = () => true } = {}) => {
    if(target.executionRecordsView?.identity===core.state.identityGeneration){target.executionRecordsView.resume();return;}
    const identity=core.state.identityGeneration, generation=target.recordGeneration=(target.recordGeneration??0)+1;
    const current=()=>target.isConnected&&identity===core.state.identityGeneration&&generation===target.recordGeneration&&visible();
    const body=node('div','execution-records'), filters=node('div','record-filters'), list=node('div','record-list'), notice=node('p','muted');notice.setAttribute('role','status');
    target.replaceChildren(body);body.append(node('p','muted','查看助手做过的操作与每次审批。点一条回到原对话。'),filters,notice,list);
    const pick=(label,choices)=>{const select=node('select');select.setAttribute('aria-label',label);for(const [value,text]of choices){const option=node('option','',text);option.value=value;select.append(option);}filters.append(select);select.onchange=()=>void load();return select;};
    const type=pick('操作类型',[['','所有操作']]), project=pick('筛选项目',[['','所有项目'],['none','无项目']]), time=pick('记录时间',[['','所有时间'],['today','今天'],['7','最近 7 天'],['30','最近 30 天']]);
    const refresh=node('button','icon-button');refresh.type='button';refresh.setAttribute('aria-label','刷新执行记录');refresh.append(WeftIcons.create('sync',18));refresh.onclick=()=>void load();filters.append(refresh);
    let loaded=false, cursor=null, busy=false, expanded=false;
    const more=node('button','button secondary small','查看更多');more.type='button';more.hidden=true;more.onclick=()=>void load(true);body.append(more);
    const results={allowed:'已允许',rejected:'已拒绝',automatic:'自动允许（按规则）',blocked:'被禁止',pending:'等待审批',unavailable:'已失效'};
    let types=[];
    async function load(append=false) {
      if(!current())return;
      expanded=append;
      const request=body.recordRequest=(body.recordRequest??0)+1, params=new URLSearchParams();
      if(type.value)params.set('type',type.value);if(project.value)params.set('projectId',project.value);
      if(time.value){const date=new Date();if(time.value==='today')date.setHours(0,0,0,0);else date.setDate(date.getDate()-Number(time.value));params.set('since',date.toISOString());}
      if(append&&cursor)params.set('before',cursor);
      busy=true;more.disabled=true;notice.hidden=false;notice.replaceChildren();if(!loaded&&!list.children.length)list.append(WeftControls.skeleton({rows:2}));
      try {
        const [page,settings]=await Promise.all([core.readExecutionRecords(params),loaded?null:core.readPermissionRules()]);
        if(!current()||request!==body.recordRequest)return;
        if(!loaded){types=settings.types;for(const item of types){const option=node('option','',item.label);option.value=item.id;type.append(option);}for(const item of page.projects){const option=node('option','',item.name);option.value=item.projectId;project.append(option);}for(const select of [type,project,time])decorateSelect(select,select.getAttribute('aria-label'));loaded=true;}
        if(!append)list.replaceChildren();
        for(const row of page.items){const button=node('button','record-row');button.type='button';const icon=node('span','record-icon');icon.append(WeftIcons.create(row.result==='blocked'||row.result==='rejected'?'deny':'tool',20));
          const copy=node('span','record-copy'), head=node('strong','',row.types.map(id=>types.find(t=>t.id===id)?.label??id).join(' · ')||'电脑操作');
          copy.append(head,node('span','record-summary',row.summary),node('small','muted',[row.conversationName,row.projectName,core.dateText(row.at)].filter(Boolean).join(' · ')));
          const status=node('span','record-result',results[row.result]??row.result);if(['blocked','rejected'].includes(row.result))status.classList.add('record-warning');
          if(row.executionState==='failed')status.append(node('small','',' · 执行失败'));
          button.append(icon,copy,status);button.onclick=()=>openConversation?.(row);list.append(button);
        }
        cursor=page.nextBefore;more.hidden=!page.hasMore;notice.hidden=!!list.children.length;notice.replaceChildren();
        if(!list.children.length){const icon=node('span','record-empty-icon');icon.append(WeftIcons.create('clock',24));notice.append(icon,node('span','','还没有符合筛选的操作记录。'));const back=node('button','button secondary small','回到对话');back.type='button';back.onclick=()=>openConversation?.(null);notice.append(back);}
      }catch{if(current()&&request===body.recordRequest){if(!loaded)list.replaceChildren();notice.hidden=false;notice.textContent='记录暂时无法读取。';const retry=node('button','button secondary small','重试');retry.onclick=()=>void load();notice.append(retry);}}
      finally{if(current()&&request===body.recordRequest){busy=false;more.disabled=false;}}
    }
    // Changes to approvals and tool receipts also arrive through the existing refresh event.
    let timer;
    function resume(){
      clearInterval(timer);
      timer=setInterval(()=>{if(!current()){clearInterval(timer);return;}if(document.visibilityState!=='hidden'&&!busy&&!expanded)void load();},15000);
      void load();
    }
    target.executionRecordsView={identity,resume};resume();
  };
})();
