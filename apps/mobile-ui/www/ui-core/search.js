/* Account search orchestration. Presentation and navigation are injected effects. */
(() => {
  const types = [{id:'all',label:'全部'},{id:'chats',label:'对话'},{id:'projects',label:'项目'},
    {id:'library',label:'成果'},{id:'schedules',label:'定时任务'},{id:'memory',label:'记忆'}];
  const privateRow = row => row?.temporary || row?.hasTemporaryContent || row?.memoryMode === 'off' || row?.deleted || row?.forgotten;
  const stamp = row => Date.parse(row.at || row.updatedAt || row.createdAt || '') || 0;
  function merge(rows) {
    const unique = new Map();
    for (const row of rows) if (!privateRow(row)) unique.set(row.key,row);
    return [...unique.values()].sort((a,b) => Number(!!b.attention)-Number(!!a.attention) || Number(b.match==='title')-Number(a.match==='title') || stamp(b)-stamp(a) || a.key.localeCompare(b.key));
  }
  globalThis.WeftUiCore.searchTypes = types;
  globalThis.WeftUiCore.mergeSearchRows = merge;
  globalThis.WeftUiCore.factories.search = (core,effects,env) => {
    const model = {open:false,query:'',type:'all',groups:[],rows:[],selected:0,loading:false,error:'',generation:0,expanded:new Set()};
    let timer, identity, recent=[];
    const scope = () => `${core.state.identityGeneration}:${core.state.ownerId}`;
    const emit = () => {model.rows=model.groups.flatMap(group=>group.rows);model.selected=Math.min(model.selected,Math.max(0,model.rows.length-1));effects.renderSearch?.();};
    const key = () => `weftmate-search-recent:${core.state.ownerId}`;
    function sync() {
      core.syncMobileIdentity?.();
      if (identity===scope()) return;
      identity=scope();model.generation++;model.groups=[];model.rows=[];model.query='';model.error='';recent=[];clearTimeout(timer);
      try {recent=JSON.parse(env.storage.getItem(key())||'[]').filter(row=>['chats','projects','library'].includes(row.type)&&typeof row.id==='string');} catch {}
    }
    function rememberSearch(row) {
      sync(); if (!['chats','projects','library'].includes(row.type) || privateRow(row)) return;
      recent=[{type:row.type,id:row.id,at:new Date().toISOString()},...recent.filter(item=>item.type!==row.type||item.id!==row.id)].slice(0,20);
      try {env.storage.setItem(key(),JSON.stringify(recent));} catch {}
    }
    const chatRow = chat => ({...chat,type:'chats',id:chat.chatId??chat.sessionId,key:`chat:${chat.chatId??chat.sessionId}:${chat.eventId??'title'}`,
      title:chat.title||'新旁聊',icon:'chat',sessionId:chat.activeSessionId??chat.sessionId,attention:!model.query.trim()&&(chat.unread===true||chat.pendingApprovalCount>0||chat.pendingQuestionCount>0),
      meta:chat.projectName|| (chat.match==='content' ? chat.at : chat.updatedAt??chat.createdAt),source:{chatId:chat.chatId,chatKind:chat.kind,sessionId:chat.sourceRef?.sessionId??chat.activeSessionId??chat.sessionId,eventId:chat.eventId,seq:chat.sourceRef?.seq}});
    const projectRow = row => ({...row,type:'projects',id:row.projectId,key:`project:${row.projectId}`,title:row.name,icon:'folder',meta:'项目'});
    const libraryRow = row => ({...row,type:'library',key:`library:${row.id}`,title:row.fileName,icon:'file',meta:row.projectName||row.createdAt});
    const scheduleRow = row => ({...row,paused:row.state==='paused',type:'schedules',key:`schedule:${row.sessionId}:${row.id}`,title:row.text||row.title||row.prompt||'定时任务',icon:'clock',meta:row.state==='paused'?'已暂停':row.nextRunAt||row.nextAt||'定时任务'});
    const memoryRow = row => ({...row,type:'memory',key:`memory:${row.kind}:${row.id}`,title:row.text,icon:'memory',meta:core.memoryKinds?.[row.kind]||'记忆'});
    function actions(q='') {
      const definitions = q ? [['start','新建旁聊并用这句话开始','compose']] : [
        ['new','新建旁聊','compose'],['temporary','新建临时对话','chat'],...(!env.mobileState&&(effects.canCreateSearchProject?.()??true)?[['project','新建项目','folder']]:[]),
        ['settings','打开设置','settings'],['memory','打开记忆','memory'],['activity','打开动态','bell'],['goals','打开目标','chart'],['library','打开成果库','folder']];
      return definitions.map(([id,title,icon])=>({id,key:`action:${id}`,type:'actions',title,icon,query:q}));
    }
    async function readSearch() {
      sync();const token=scope(),generation=++model.generation,q=model.query.trim(),type=model.type;
      const valid=()=>model.open&&token===scope()&&generation===model.generation;
      model.loading=true;model.error='';emit();
      const all=type==='all', wants=id=>all||type===id;
      const sources=[
        ['chats',() => core.accessApi(`/chats?${new URLSearchParams({scope:'search',limit:q?'200':'30',...(q?{q}:{})})}`),page=>page.items.map(chatRow)],
        ['projects',()=>core.accessApi('/projects'),page=>(page.projects||[]).filter(row=>!row.revoked&&(!q||row.name.toLowerCase().includes(q.toLowerCase()))).map(projectRow)],
        ['library',()=>core.accessApi(`/library?${new URLSearchParams({limit:'50',...(q?{search:q}:{})})}`),page=>page.items.map(libraryRow)],
        ['schedules',()=>core.accessApi('/schedules'),page=>(page.items||page.schedules||[]).filter(row=>!q||String(row.text||row.title||row.prompt||'').toLowerCase().includes(q.toLowerCase())).map(scheduleRow)],
        ['memory',()=>env.mobileState?core.mobile.searchMemoryPage(q):core.memoryRequest(`/items?${new URLSearchParams({kind:'all',limit:'50',...(q?{query:q}:{})})}`),page=>page.items.map(memoryRow)]
      ].filter(([id])=>q?wants(id):['chats','projects','library'].includes(id)&&wants(id));
      const groups=[],errors=[];
      await Promise.all(sources.map(async([id,read,convert])=>{
        try {const page=await read();if(!valid())return;const rows=merge(convert(page));groups.push({id,title:types.find(t=>t.id===id).label,rows,total:id==='memory'?(page.hasMore?null:rows.length):id==='projects'||id==='schedules'?rows.length:page.total??rows.length,hasMore:page.hasMore,cursor:page.nextCursor,indexState:page.indexState});}
        catch(error){if(!valid())return;errors.push(error);if(!['MEMORY_DISABLED','CAPABILITY_UNAVAILABLE'].includes(error.code))model.error='部分内容暂时无法读取，请重试。';}
      }));
      if(!valid())return;
      groups.sort((a,b)=>types.findIndex(t=>t.id===a.id)-types.findIndex(t=>t.id===b.id));
      if(!q){
        const mixed=groups.flatMap(group=>group.rows),byId=new Map(mixed.map(row=>[`${row.type}:${row.id}`,row]));
        const pending=(core.activity?.items??[]).filter(item=>item.state==='pending'&&!privateRow(item)&&['approval.pending','question.pending'].includes(item.type)).map(item=>{
          const chat=[...(core.state.sessions??[]),core.state.mainChat].filter(Boolean).find(chat=>item.source?.chatId&&chat.chatId===item.source.chatId||item.source?.sessionId&&(chat.sessionId===item.source.sessionId||chat.activeSessionId===item.source.sessionId));
          return chat?{...chatRow(chat),attention:true,pendingApprovalCount:item.type==='approval.pending'?1:0,pendingQuestionCount:item.type==='question.pending'?1:0}:null;}).filter(Boolean);
        const attention=merge([...mixed.filter(row=>row.attention),...pending]);
        const resolved=await Promise.all(recent.slice(0,6).map(async item=>{
          const present=byId.get(`${item.type}:${item.id}`);if(present)return {...present,at:item.at,attention:false};
          try{if(item.type==='chats'){const data=await core.accessApi(`/chats/${encodeURIComponent(item.id)}`);return {...chatRow(data.chat),at:item.at,attention:false};}
            if(item.type==='library'){const data=await core.accessApi(`/library/${encodeURIComponent(item.id)}`);return {...libraryRow(data.item),at:item.at,attention:false};}}catch{}return null;}));
        if(!valid())return;
        const opened=resolved.filter(Boolean),recentRows=merge([...mixed.map(row=>({...row,attention:false})),...opened]);
        model.groups=[...(attention.length?[{id:'attention',title:'需要关注',rows:attention.slice(0,5)}]:[]),{id:'recent',title:'最近使用',rows:recentRows.slice(0,4)}, {id:'actions',title:'操作',rows:actions()}];
      }else model.groups=groups.map(group=>({...group,allRows:group.rows,rows:model.expanded.has(group.id)?group.rows:group.rows.slice(0,3)}));
      if(q&&!model.groups.some(group=>group.rows.length)&&!model.error)model.groups=[{id:'empty',title:'',rows:actions(q)}];
      model.loading=false;model.selected=0;emit();
    }
    function openSearch(){sync();model.open=true;model.query='';model.type='all';model.expanded.clear();model.selected=0;effects.showSearch?.();return readSearch();}
    function closeSearch(){clearTimeout(timer);model.open=false;model.generation++;model.groups=[];model.rows=[];model.loading=false;return effects.hideSearch?.();}
    function querySearch(value){model.query=value.slice(0,120);model.generation++;model.groups=[];model.selected=0;model.expanded.clear();model.loading=true;emit();clearTimeout(timer);timer=setTimeout(()=>void readSearch(),160);}
    function typeSearch(id){if(!types.some(type=>type.id===id))return;clearTimeout(timer);model.type=id;model.selected=0;model.expanded.clear();return readSearch();}
    function navigateSearch(keyName){
      if(keyName==='Escape'){closeSearch();return true;}
      if(['ArrowLeft','ArrowRight'].includes(keyName)){const index=types.findIndex(type=>type.id===model.type);void typeSearch(types[(index+(keyName==='ArrowLeft'?-1:1)+types.length)%types.length].id);return true;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(keyName)){model.selected=keyName==='Home'?0:keyName==='End'?model.rows.length-1:(model.selected+(keyName==='ArrowDown'?1:-1)+model.rows.length)%Math.max(1,model.rows.length);effects.selectSearchRow?.();return true;}
      return false;
    }
    async function moreSearch(id){const group=model.groups.find(group=>group.id===id);if(!group)return;model.expanded.add(id);group.rows=group.allRows??group.rows;emit();
      if(!group.cursor)return;const token=scope(),generation=model.generation,q=model.query.trim();group.busy=true;emit();
      try{const page=await (id==='chats'?core.accessApi(`/chats?${new URLSearchParams({scope:'search',q,limit:'200',cursor:group.cursor})}`):id==='library'?core.accessApi(`/library?${new URLSearchParams({search:q,limit:'50',cursor:group.cursor})}`):env.mobileState?core.mobile.searchMemoryPage(q,group.cursor):core.memoryRequest(`/items?${new URLSearchParams({kind:'all',query:q,limit:'50',after:group.cursor})}`));
        if(!model.open||token!==scope()||generation!==model.generation)return;group.rows=merge([...group.rows,...page.items.map(id==='chats'?chatRow:id==='library'?libraryRow:memoryRow)]);group.allRows=group.rows;group.cursor=page.nextCursor;group.hasMore=page.hasMore;}
      catch{if(token===scope()&&generation===model.generation)model.error='结果已变化，请重新搜索。';}finally{if(token===scope()&&generation===model.generation){group.busy=false;emit();}}}
    return {search:model,openSearch,closeSearch,readSearch,querySearch,typeSearch,navigateSearch,moreSearch,rememberSearch,searchActions:actions};
  };
})();
