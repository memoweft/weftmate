/* Shared desktop/phone palette. Navigation remains with the host composition. */
globalThis.WeftSearchView = {
  formatDate(text,timeZone='Asia/Shanghai',now=new Date()) {
    const at=Date.parse(text);if(!Number.isFinite(at)||!String(text).includes('-'))return text;
    const date=new Date(at),parts=value=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value).map(part=>[part.type,part.value]));
    const day=parts(date),today=parts(now),key=value=>`${value.year}-${value.month}-${value.day}`;
    if(key(day)===key(today))return `今天 ${new Intl.DateTimeFormat('zh-CN',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date)}`;
    const previous=new Date(Date.UTC(Number(today.year),Number(today.month)-1,Number(today.day)-1));
    const yesterday={year:String(previous.getUTCFullYear()),month:String(previous.getUTCMonth()+1).padStart(2,'0'),day:String(previous.getUTCDate()).padStart(2,'0')};
    if(key(day)===key(yesterday))return '昨天';
    return `${day.year!==today.year?day.year+'年':''}${Number(day.month)}月${Number(day.day)}日`;
  },mount({core,open,menu,notice,mobile=false}) {
  const el=(tag,cls='',text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
  const icon=name=>globalThis.WeftIcons.create(name,20);
  const dialog=el('dialog','dialog search-palette');dialog.setAttribute('aria-label','搜索');if(mobile)dialog.classList.add('search-fullscreen');
  const header=el('div','search-palette-head'),input=el('input','search-palette-input');input.type='search';input.maxLength=120;input.placeholder='搜索对话、项目、成果…';input.setAttribute('aria-label','搜索内容');
  input.setAttribute('role','combobox');input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls','search-results');input.setAttribute('aria-autocomplete','list');
  const close=el('button','icon-button search-palette-close');close.type='button';close.setAttribute('aria-label','关闭搜索');close.append(icon('deny'));close.onclick=()=>core.closeSearch();header.append(icon('search'),input,close);
  const tabs=el('div','search-palette-types');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','搜索类型');
  for(const type of WeftUiCore.searchTypes){const tab=el('button','search-type filter-chip',type.label);tab.type='button';tab.setAttribute('role','tab');tab.dataset.type=type.id;tab.onclick=()=>void core.typeSearch(type.id);tabs.append(tab);}
  const results=el('div','search-palette-results');results.id='search-results';results.setAttribute('role','listbox');results.setAttribute('aria-label','搜索结果');
  const feedback=el('p','search-palette-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const footer=el('div','search-palette-footer');
  for(const [label,keys] of [['关闭',['Esc']],['切换类型',['←','→']],['上下选择',['↑','↓']],['打开',['↵']],['操作',['Alt','↵']]]){const hint=el('span','search-key-hint',label);for(const key of keys)hint.append(el('kbd','search-key',key));footer.append(hint);}
  dialog.append(header,tabs,feedback,results,footer);document.body.append(dialog);
  let returnFocus,closeTimer,closeGeneration=0,closing;
  function show(){clearTimeout(closeTimer);closeGeneration++;dialog.classList.remove('is-closing');input.value='';returnFocus=document.activeElement;if(!dialog.open)dialog.showModal();input.focus();}
  function hide(){results.replaceChildren();input.value='';if(closing)return closing;if(!dialog.open)return Promise.resolve();const generation=++closeGeneration;dialog.classList.add('is-closing');
    closing=new Promise(resolve=>{const finish=()=>{if(generation===closeGeneration){dialog.close();dialog.classList.remove('is-closing');if(returnFocus?.isConnected&&!document.querySelector('dialog[open]')&&(document.activeElement===document.body||document.activeElement===returnFocus))returnFocus.focus();}closing=null;resolve();};
      if(matchMedia('(prefers-reduced-motion: reduce)').matches)queueMicrotask(finish);else closeTimer=setTimeout(finish,120);});return closing;}
  const highlight=(text,q)=>{const span=el('span');text=String(text??'');if(!q)return Object.assign(span,{textContent:text});const lower=text.toLowerCase(),needle=q.toLowerCase();let position=0,hit;
    while((hit=lower.indexOf(needle,position))>=0){span.append(document.createTextNode(text.slice(position,hit)),el('mark','search-highlight',text.slice(hit,hit+q.length)));position=hit+q.length;}span.append(document.createTextNode(text.slice(position)));return span;};
  const meta=text=>WeftSearchView.formatDate(text,core.state.mainChat?.timeZone||core.state.account?.timeZone||'Asia/Shanghai');
  async function activate(row){const token=`${core.state.identityGeneration}:${core.state.ownerId}`;try{core.rememberSearch(row);await core.closeSearch();if(core.search.open||token!==`${core.state.identityGeneration}:${core.state.ownerId}`)return;await open(row);}
    catch(error){if(token===`${core.state.identityGeneration}:${core.state.ownerId}`)notice(core.failureMessage?.(error)||'暂时无法打开，请重试。');}}
  function rowMenu(row,trigger){menu?.(row,trigger);}
  function select(){const rows=[...results.querySelectorAll('[role=option]')];rows.forEach((node,index)=>{node.setAttribute('aria-selected',String(index===core.search.selected));node.classList.toggle('is-selected',index===core.search.selected);});const current=rows[core.search.selected];if(current){input.setAttribute('aria-activedescendant',current.id);current.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
  function render(){if(!core.search.open)return;const model=core.search;if(input.value!==model.query)input.value=model.query;
    for(const tab of tabs.children){const chosen=tab.dataset.type===model.type;tab.setAttribute('aria-selected',String(chosen));tab.setAttribute('aria-pressed',String(chosen));tab.tabIndex=chosen?0:-1;}
    results.replaceChildren();results.setAttribute('aria-busy',String(model.loading));feedback.textContent='';
    if(model.loading){for(let i=0;i<5;i++){const row=el('div','search-skeleton');row.setAttribute('aria-hidden','true');row.append(el('span','search-skeleton-icon'),el('span','search-skeleton-line'));results.append(row);}feedback.textContent='正在搜索…';return;}
    if(model.error){const error=el('div','search-error');error.setAttribute('role','alert');const retry=el('button','button secondary small','重试');retry.type='button';retry.onclick=()=>void core.readSearch();error.append(el('span','',model.error),retry);results.append(error);}
    if(model.groups.some(group=>group.id==='empty')||!model.groups.some(group=>group.rows.length)&&!model.error){const empty=el('div','search-empty');empty.append(icon('search'),el('strong','','没有找到相关内容'),el('p','muted','试试其他关键词，或从这句话开始新的旁聊。'));results.append(empty);}
    let index=0;
    for(const group of model.groups){if(!group.rows.length)continue;const section=el('div','search-result-group');section.setAttribute('role','group');section.setAttribute('aria-label',group.title||'操作');
      if(group.title)section.append(el('h2','search-group-title',group.title));
      for(const row of group.rows){const option=el('div','search-result-row');option.id=`search-option-${index}`;option.setAttribute('role','option');option.tabIndex=-1;option.dataset.key=row.key;
        const current=index++;option.onclick=()=>void activate(row);option.onpointermove=()=>{if(core.search.selected!==current){core.search.selected=current;select();}};
        const content=el('div','search-result-copy'),title=el('div','search-result-title');title.append(highlight(row.title,model.query.trim()));content.append(title);
        if(row.snippet){const snippet=el('div','search-result-snippet');snippet.append(highlight(row.snippet,model.query.trim()));content.append(snippet);}
        const right=el('span','search-result-meta',(row.snippet?meta(row.at):meta(row.meta))||'');if(row.attention)right.textContent=row.pendingApprovalCount?'待审批':row.pendingQuestionCount?'待回答':'未读';
        option.append(icon(row.icon),content,right);
        const end=el('div','search-result-end');
        if(row.type!=='actions'){const more=el('button','chat-icon-button search-result-more');more.type='button';more.setAttribute('aria-label',`操作 ${row.title}`);more.setAttribute('aria-haspopup','menu');more.append(icon('more'));more.onclick=event=>{event.stopPropagation();rowMenu(row,more);};end.append(more);}
        const enter=el('kbd','search-enter','↵');enter.setAttribute('aria-hidden','true');end.append(enter);option.append(end);section.append(option);
      }
      const available=group.allRows?.length||group.rows.length;
      if(group.cursor||available>group.rows.length){const more=el('button','button quiet small search-more',group.total?`查看全部 ${group.total} 条`:'查看更多');more.type='button';more.disabled=group.busy===true;more.onclick=()=>void core.moreSearch(group.id);section.append(more);}
      if(group.indexState==='building'){const refresh=el('button','button quiet small','旧内容正在建立搜索索引 · 更新结果');refresh.type='button';refresh.onclick=()=>void core.readSearch();section.append(refresh);}
      results.append(section);
    }
    feedback.textContent=`${model.rows.length} 项`;select();
  }
  input.oninput=()=>core.querySearch(input.value);
  dialog.addEventListener('cancel',event=>{event.preventDefault();core.closeSearch();});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)core.closeSearch();}});
  dialog.addEventListener('keydown',event=>{if(event.isComposing||event.target.closest('[role=menu]'))return;
    if(['Escape','ArrowUp','ArrowDown','Home','End','ArrowLeft','ArrowRight'].includes(event.key)&&(!['Home','End'].includes(event.key)||event.target!==input)){event.preventDefault();event.stopPropagation();core.navigateSearch(event.key);}
    if(event.key==='Enter'&&event.target===input){event.preventDefault();const row=core.search.rows[core.search.selected];if(row){if(event.altKey){const target=results.querySelectorAll('[role=option]')[core.search.selected]?.querySelector('.search-result-more');if(target)rowMenu(row,target);}else void activate(row);}}
  });
  return {show,hide,render,select,activate,dialog};
}};
