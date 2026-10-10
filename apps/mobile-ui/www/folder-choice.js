/* Shared project-folder controls for desktop, remote web and the Android UI bundle. */
(() => {
  function create(core, {form, tools, toast, readDraft, mobile = false, onboarding = false}) {
    const native = globalThis.weftmateDesktop;
    let popup, card, busy = false, tooltipScope = '', lastScope;const folderDetails=new Map();
    const node = (tag, cls, text) => {const value=document.createElement(tag);value.className=cls||'';if(text)value.textContent=text;return value;};
    const button = (label, icon, action) => {const value=node('button','folder-pill');value.type='button';value.setAttribute('aria-label',label);value.title=label;value.append(WeftIcons.create(icon,16),node('span','',label));value.onclick=action;return value;};
    const row=node('div','folder-start');row.setAttribute('aria-label','工作文件夹');
    const location=button('这台电脑','desktop',()=>menu(location,[{name:location.querySelector('span').textContent,icon:'desktop',checked:true,description:'更多电脑以后支持'}]));
    const choose=button('选择文件夹','folder',()=>open(choose));
    const add=button('添加文件夹','folder',()=>pick());add.classList.add('folder-add');add.append(WeftIcons.create('plus',12));add.querySelector('span').classList.add('sr-only');
    row.append(location,choose,add);form.after(row);
    const current=button('文件夹','folder',()=>currentMenu());current.classList.add('folder-current');const attachment=tools.querySelector('#attachment-add, #plus-button');if(attachment)attachment.after(current);else tools.append(current);
    const hint=node('div','folder-first-hint');hint.setAttribute('role','status');hint.append(node('span','','选一个文件夹，助手就能在里面读写文件'));
    const dismiss=button('关闭提示','deny',()=>{core.dismissFolderHint();paint();});dismiss.className='folder-dismiss';dismiss.querySelector('span').classList.add('sr-only');hint.append(dismiss);row.after(hint);
    const scope=()=>`${core.state.ownerId}/${core.state.identityGeneration}/${core.state.selectedSessionId}/${core.state.newConversationId}/${core.state.selectedChatId}`;
    const blocked=()=>busy||core.folderChoiceBusy?.()||core.state.online===false;
    const projectNow=()=>onboarding?core.defaultFolderProject():core.currentFolderProject();
    const permission=project=>project.permission==='write'?'可读写':'只读';
    const error=err=>err?.code==='SESSION_BUSY'?'请等当前操作结束后再换文件夹':core.failureMessage?.(err)||'文件夹未选择，请重试';
    function menu(trigger, entries) {popup?.close(false);popup=WeftPopover.openMenu(trigger,entries,{label:trigger.getAttribute('aria-label')});}
    async function select(project) {try{if(onboarding)core.rememberFolder(project?.projectId||null);else await core.chooseFolderProject(project);paint();return true;}catch(err){toast(error(err));return false;}}
    async function open(trigger=choose) {
      if(blocked())return;
      const token=scope();
      menu(trigger,[{name:'正在读取文件夹…',icon:'folder',disabled:true}]);
      try {
        await core.refreshSessionProjects(); if(token!==scope())return;
        const all=(core.state.projects||[]).filter(project=>!project.revoked),pref=core.folderPreference();
        const ordered=native?[(pref.recent||[]).map(id=>all.find(row=>row.projectId===id)).filter(Boolean),all].flat().filter((row,index,array)=>array.findIndex(value=>value.projectId===row.projectId)===index).slice(0,5):all;
        const selected=projectNow();
        const entries=ordered.map(project=>({name:project.name,icon:'folder',description:[project.pathHint,permission(project)].filter(Boolean).join(' · '),checked:selected?.projectId===project.projectId,action:()=>select(project)}));
        if(!entries.length)entries.push({name:core.state.projectsError?'文件夹暂时无法读取，请重试':'还没有项目文件夹',icon:core.state.projectsError?'warn':'folder',disabled:true});
        if(core.state.projectsError)entries.push({name:'重新读取',icon:'refresh',action:()=>open(trigger)});
        entries.push({separator:true});
        if(native?.pickProjectFolder)entries.push({name:'选择其它文件夹…',icon:'folder',action:()=>pick()});
        else entries.push({name:'新文件夹请在电脑上添加',icon:'desktop',disabled:true});
        entries.push({name:'不使用文件夹',icon:'deny',checked:!selected,action:()=>select(null)});
        menu(trigger,entries);
      } catch(err) {if(token===scope())menu(trigger,[{name:'文件夹暂时无法读取',icon:'warn',disabled:true},{name:'重试',icon:'refresh',action:()=>open(trigger)}]);}
    }
    async function picked(path, token) {
      if(!path||token!==scope())return;
      const choice=await native.inspectProjectFolder(path);if(token!==scope())return;
      if(choice.project)return select(choice.project);
      confirm(choice,token);
    }
    async function pick() {
      if(blocked()||!native?.pickProjectFolder)return;
      const token=scope();busy=true;paint();
      try {const path=await native.pickProjectFolder();busy=false;if(token===scope())await picked(path,token);}catch(err){if(token===scope())toast('文件夹未选择，请重试');}finally{busy=false;paint();}
    }
    function confirm(choice,token) {
      card?.remove();card=node('section','folder-confirm card');card.setAttribute('aria-label','在文件夹里工作');card.dataset.scope=token;
      card.append(node('strong','',choice.name),node('p','folder-path',choice.rootPath));
      if(choice.warning){const warning=node('p','folder-warning',choice.warning);warning.setAttribute('role','alert');card.append(warning);}
      const formCard=node('form'),name=node('input');name.value=choice.name;name.maxLength=80;name.required=true;name.setAttribute('aria-label','名称');
      const label=node('label','project-field','名称');label.append(name);formCard.append(label);
      const access=node('select');access.setAttribute('aria-label','文件权限');access.append(new Option('只读','read-only'),new Option('可读写','write'));access.value='read-only';
      const accessLabel=node('label','project-field','文件权限');accessLabel.append(access);formCard.append(accessLabel,node('p','field-help','写入仍按审批设置逐次批准。'));
      const status=node('p','form-error');status.setAttribute('role','alert');
      const actions=node('div','dialog-footer');const cancel=button('取消','deny',()=>{card?.remove();card=null;choose.focus();});cancel.className='button secondary';
      const save=button('在这个文件夹里工作','folder',()=>{});save.className='button primary';save.type='submit';actions.append(cancel,save);formCard.append(status,actions);card.append(formCard);form.before(card);WeftPopover.bindSettingsSelect(access);
      formCard.onsubmit=async event=>{event.preventDefault();if(token!==scope()||blocked())return;busy=true;save.disabled=cancel.disabled=true;paint();
        try{const result=await native.createFolderProject({requestId:card.dataset.requestId||=crypto.randomUUID(),name:name.value.trim(),rootPath:choice.rootPath,permission:access.value});
          if(token!==scope())return;await core.refreshSessionProjects();busy=false;if(await select(result.project)){card?.remove();card=null;}else{status.textContent='项目已创建，对话尚未移入，请重试';save.disabled=cancel.disabled=false;}}
        catch(err){if(token===scope()){status.textContent='未完成，请核对文件夹和名称后重试';save.disabled=cancel.disabled=false;}}finally{busy=false;paint();}};
      name.focus();
    }
    function currentMenu() {
      const project=projectNow();if(!project||blocked())return;
      const entries=[];
      if(native?.showProjectFolder)entries.push({name:'在文件夹中显示',icon:'folder-open',action:async()=>{try{await native.showProjectFolder(project.projectId);}catch{toast('文件夹无法打开，请重试');}}});
      if(core.state.projectCanManage)entries.push({name:'更改权限',icon:'approval',children:async()=>['read-only','write'].map(value=>({name:value==='write'?'可读写':'只读',icon:value==='write'?'edit':'approval',checked:project.permission===value,action:async()=>{try{await core.saveProject(project,{permission:value});paint();}catch(err){toast(error(err));}}}))});
      entries.push({name:'换一个文件夹',icon:'folder',action:()=>open(current)},{name:'移出项目',icon:'deny',action:()=>select(null)});menu(current,entries);
    }
    function paint() {
      if(lastScope!==scope()){popup?.close(false);lastScope=scope();}
      const project=projectNow(),isMain=(core.isMainChat?.() || core.inMainChat?.());
      const events=isMain?core.state.chatWindow?.events:core.state.historyEvents;
      const hasUser=events&&[...events.values()].some(event=>event.type==='user.message'||event.role==='user');
      const empty=onboarding||!isMain&&(core.state.newConversation||!!core.state.selectedSessionId&&!hasUser)&&!core.state.submitting;
      row.hidden=!empty;current.hidden=onboarding||!project||empty||isMain;hint.hidden=!empty||!!project||(core.state.projects||[]).length>0||core.folderPreference().hintSeen===true;
      choose.querySelector('span').textContent=project?.name||'选择文件夹';current.querySelector('span').textContent=project?.name||'文件夹';
      current.setAttribute('aria-label',project?`文件夹 ${project.name}`:'文件夹');choose.setAttribute('aria-label',project?`选择文件夹，当前 ${project.name}`:'选择文件夹');
      for(const control of [choose,add,current])control.disabled=blocked();
      add.disabled=blocked()||!native?.pickProjectFolder;if(!native)add.title='新文件夹请在电脑上添加';
      if(!native){const host=core.state.cachedDevices?.find(row=>row.id===core.state.hostId);location.querySelector('span').textContent=`${core.state.hostName||host?.name||'电脑'} · ${core.state.online===false?'离线':'在线'}`;location.setAttribute('aria-label',location.querySelector('span').textContent);location.title=location.querySelector('span').textContent;}
      if(project){current.title=`${folderDetails.get(project.projectId)||project.pathHint||project.name} · ${permission(project)}`;
        if(native?.projectFolderInfo&&tooltipScope!==project.projectId){tooltipScope=project.projectId;const token=scope();void native.projectFolderInfo(project.projectId).then(value=>{if(token===scope()&&value){folderDetails.set(project.projectId,value.rootPath);current.title=`${value.rootPath} · ${permission(project)}`;}}).catch(()=>{});}}
      if(card&&card.dataset.scope!==scope()){card.remove();card=null;}
    }
    async function drop(event) {
      if(!native?.droppedProjectFolder||blocked())return false;
      const files=[...(event.dataTransfer?.files||[])],token=scope();
      if(!files.length)return false;
      try{
        const result=await core.partitionFolderDrop(files,file=>native.droppedProjectFolder(file));
        if(token!==scope())return false;
        if(result.files.length)core.addAttachmentFiles(result.files);
        if(result.folders.length>1)toast('先选择第一个文件夹，其余文件夹可稍后添加');
        if(result.folders.length)await picked(result.folders[0].path,token);
        return result.folders.length>0;
      }catch{if(token===scope())toast('文件夹未添加，请使用选择文件夹重试');return false;}
    }
    const pane=form.closest('#conversation-pane')||form.parentElement;
    pane.addEventListener('drop',event=>{if(native&&event.dataTransfer?.files?.length){event.preventDefault();event.stopImmediatePropagation();void drop(event);}},true);
    pane.addEventListener('dragover',event=>{if(native&&[...event.dataTransfer?.items||[]].some(item=>item.kind==='file'))event.preventDefault();});
    return {paint,open,pick,select, confirm, row, current};
  }
  globalThis.WeftFolderChoice={create};
})();
