/* Uses the same list, menu and protected-focus dialog family as settings. */
globalThis.WeftPhoneMemoryView = target => {
  const owner=state.owner,epoch=state.authEpoch,current=()=>owner===state.owner&&epoch===state.authEpoch&&target.isConnected;
  const change=async(action,id,text)=>{try{await WeftPhone.memoryChange(action,id,text);}catch(error){if((error.code||error.message)==='MEMORY_HANDOVER_PENDING'){toast('交接已暂停，修改或遗忘尚未完成。已交出的部分请到电脑记忆页核对。');if(current())paint();}throw error;}if(current())paint();};
  function modal(title,build){const dialog=el('dialog','model-editor-dialog');dialog.setAttribute('aria-label',title);
    const head=el('header','dialog-head'),body=el('div','model-editor-body'),footer=el('footer','dialog-footer');
    head.append(el('h2','',title));dialog.append(head,body,footer);
    build(body,footer,dialog);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();return dialog;}
  function edit(item){modal(item?'修改记忆':'添加记忆',(body,footer,dialog)=>{const input=el('textarea','form-input');input.rows=4;input.maxLength=WeftPhoneMemory.limits.text;input.value=item?.text||'';input.setAttribute('aria-label','值得记住的事');
      const field=el('label','field','值得记住的事');field.append(input);
      const feedback=el('p','error');feedback.setAttribute('role','status');body.append(field,feedback);
      const save=action('保存',async()=>{save.disabled=true;try{await change('edit',item?.id,input.value);dialog.close();toast('已保存');}catch(e){feedback.textContent=(e.code||e.message)==='MEMORY_HANDOVER_PENDING'?'交接已暂停，这次修改尚未保存。已交出的部分请到电脑记忆页核对。':e.message==='PHONE_MEMORY_FULL'?'手机记忆已满（200条），先忘掉一些再添加。':'请写一件不超过400字的事，不包含密码、密钥或证件号。';save.disabled=false;}},true);
      footer.append(action('取消',()=>dialog.close(),false),save);input.focus();});}
  function forget(item){modal(item?'忘掉这件事':'忘掉全部手机记忆',(body,footer,dialog)=>{body.append(el('p','',item?'忘掉后，这件事不会从原来源或同样文字自动记回来。对话仍保留。':'只忘掉手机记下的条目，原对话仍保留。'));
      const confirm=action('确认忘掉',async()=>{confirm.disabled=true;try{await change(item?'forget':'forget-all',item?.id);dialog.close();toast('已忘掉');}catch(error){confirm.disabled=false;if((error.code||error.message)!=='MEMORY_HANDOVER_PENDING')throw error;}},false);confirm.classList.add('danger');footer.append(action('保留',()=>dialog.close(),false),confirm);});}
  function paint(){if(!current())return;const memory=WeftPhone.memory;
    if(!memory||memory.transferred){memoryPage(target);return;}
    target.replaceChildren(heading('记忆','这些是手机自己记的。连上电脑后，记忆会交给电脑整理得更完整。'));
    const restriction=WeftPhone.handover?.blockedReason;
    const restrictionText={
      'mixed-source':'同一段原话还支撑着其他记忆，暂时无法完整交接。原对话和未迁移条目仍保留，请等待支持完整交接的更新。',
      'memory-change':'交接已暂停，刚才的修改或遗忘没有完成。已交出的部分请到电脑记忆页核对并处理。',
      'computer-update':'这台电脑需要更新后才能安全接收手机记忆。原对话和条目仍保留，请先更新电脑。',
      'policy-unconfirmed':'电脑尚未确认会保留遗忘结果，交接还未完成。原对话和条目仍保留，请稍后重新连接。'
    }[restriction];
    if(memory.handover)target.append(notice(restrictionText||'正在把原对话交给电脑。确认收到前，这些记忆继续可用。',restrictionText?'交接尚未完成':'正在交给电脑'));
    if(WeftPhone.handover?.awaitingConfirmation){const h=WeftPhone.handover;target.append(notice(`${h.totalTurns}轮对话，约 ${Math.ceil(h.bytes/1024)} KB。交给电脑后会使用电脑的后台模型整理。`,'手机上的对话'));target.append(action('现在交',()=>WeftPhone.confirmHandover(),true),action('稍后',()=>page('chat'),false));}
    const toggle=el('input');toggle.type='checkbox';toggle.id='phone-memory-enabled';toggle.checked=memory.enabled;toggle.disabled=memory.handover;
    toggle.setAttribute('aria-label','在手机上记住我说过的事');WeftSettingsControls.toggle(toggle);
    toggle.addEventListener('change',()=>void change('toggle',null,toggle.checked));
    const switchRow=WeftSettingsControls.row('在手机上记住我说过的事','每段对话会多用一次小的模型请求。',toggle);switchRow.classList.add('phone-memory-switch-row');target.append(switchRow);
    const toolbar=el('div','form-actions'),add=action('添加记忆',()=>edit(),false);add.disabled=memory.handover;toolbar.append(add);
    const more=action('更多记忆操作',()=>WeftPopover.menu(more,[{name:'忘掉全部',icon:'trash',danger:true,disabled:!memory.items.length,action:()=>forget()}]),false);
    more.disabled=memory.handover;more.classList.add('icon-button');more.replaceChildren(WeftIcons.create('more',20));more.setAttribute('aria-label','更多记忆操作');toolbar.append(more);target.append(toolbar);
    if(!memory.items.length){const empty=el('div','empty-state');empty.append(WeftIcons.create('memory',32),el('p','','还没有记下值得记住的事。可以聊聊，也可以手动添加。'));target.append(empty);}
    const list=el('div','memory-list');for(const item of memory.items){const row=el('div','history-import-row'),main=action(item.text,()=>edit(item),false);main.classList.add('history-import-main');main.append(el('small','muted',`${item.pinned?'已置顶 · ':''}${new Date(item.updatedAt).toLocaleDateString('zh-CN')}`));
      const menu=action('更多',()=>WeftPopover.menu(menu,[...(item.conversationId&&WeftPhone.owns(item.conversationId)?[{name:'查看原对话',icon:'chat',action:()=>selectConversation(item.conversationId)}]:[]),{name:item.pinned?'取消置顶':'置顶',icon:'pin',action:()=>change('pin',item.id)},{name:'修改',icon:'edit',action:()=>edit(item)},{name:'忘掉',icon:'trash',danger:true,action:()=>forget(item)}]),false);menu.disabled=memory.handover;menu.classList.add('icon-button');menu.replaceChildren(WeftIcons.create('more',18));menu.setAttribute('aria-label',`记忆的更多操作：${item.text}`);row.append(main,menu);list.append(row);}target.append(list);
  }
  target.phoneMemoryPaint=()=>{if(current()&&state.page==='memory')paint();};
  paint();
  void WeftPhone.flushMemory().then(()=>{if(current()&&state.page==='memory')paint();});
};
