/* Shared reading pages; actions are supplied by each platform's existing navigation. */
globalThis.WeftHelpView={mount({target,core,kind,back,run,mobile=false}){
  const el=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,action,cls='button secondary small')=>{const n=el('button',cls,text);n.type='button';n.onclick=action;return n;};
  const title=kind==='help'?'帮助与小技巧':'更新内容';target.classList.add('help-page');target.replaceChildren();
  const head=el('div','help-heading'),heading=el('h1','',title);heading.tabIndex=-1;
  if(back&&!mobile){const b=button('',back,'icon-button help-back');b.setAttribute('aria-label','返回对话');b.append(WeftIcons.create('back',20));head.append(b);}head.append(heading);target.append(head);
  let alive=true;
  const content=el('div','help-content');
  function empty(text,action,label){content.replaceChildren();const box=el('div','help-empty');box.append(WeftIcons.create('info',32),el('p','',text));if(action)box.append(button(label,action));content.append(box);}
  if(kind==='help'){
    target.append(el('p','help-intro','找到一个小技巧，马上试试。'));
    const search=el('input','help-search');search.type='search';search.placeholder='搜索帮助，如“记忆”或“离线”';search.setAttribute('aria-label','搜索帮助');target.append(search,content);
    const count=el('p','help-result-count');count.setAttribute('role','status');target.append(count);
    function render(){content.replaceChildren();const rows=core.filterHelp(search.value);count.textContent=search.value?`${rows.length} 条小技巧`:'';
      if(!rows.length){empty('没有找到相关小技巧，试试更短的关键词。',()=>{search.value='';render();search.focus();},'清除搜索');return;}
      let group,section;for(const row of rows){if(group!==row.group){group=row.group;section=el('section','help-topic-group');section.append(el('h2','',group));content.append(section);}
        const article=el('article','help-topic');article.append(el('h3','',row.title),el('p','',row.text));
        if(row.action)article.append(button(row.tryLabel,()=>run(row.action)));section.append(article);}}
    search.addEventListener('input',render);render();
  }else{
    target.append(el('p','help-intro','每次更新，让日常使用更顺手。'),content);
    async function read(){content.replaceChildren();content.setAttribute('aria-busy','true');for(let i=0;i<3;i++)content.append(el('div','help-skeleton search-skeleton-line'));let current;
      try{current=await core.currentRelease();}catch{if(alive){content.setAttribute('aria-busy','false');empty('版本信息暂时无法读取，请重试。',read,'重试');}return;}
      if(!alive)return;content.setAttribute('aria-busy','false');content.replaceChildren();
      const audience=current.audience||(mobile?'mobile':'desktop'),notes=WeftUiCore.releaseNotes.filter(row=>row.audience===audience);
      const known=notes.find(row=>row.version===current.version);const rows=[...(known?[known]:current.version?[{version:current.version,date:null,added:[],improved:[],fixed:[]}]:[]),...notes.filter(row=>row!==known)];
      if(!rows.length){empty('还没有更新内容。下一次更新后，可以来这里看看。',()=>run('about'),'查看版本');return;}
      for(const [index,row]of rows.entries()){
        const article=el('article','release-entry'),top=el('div','release-heading'),body=el('div','release-body');
        const toggle=button(row.version,()=>{body.hidden=!body.hidden;toggle.setAttribute('aria-expanded',String(!body.hidden));},'release-toggle');toggle.append(WeftIcons.create('chevron',16));toggle.setAttribute('aria-expanded',String(index===0));
        body.id=`release-${row.version.replaceAll('.','-')}`;toggle.setAttribute('aria-controls',body.id);body.hidden=index!==0;top.append(toggle);
        if(row.version===current.version)toggle.append(el('span','release-current','当前版本'));if(row.date){const d=row.date.split('-');toggle.append(el('time','release-date',`${Number(d[0])} 年 ${Number(d[1])} 月 ${Number(d[2])} 日`));}
        for(const [key,label]of [['added','新增'],['improved','改进'],['fixed','修复']])if(row[key].length){const section=el('section');section.append(el('h3','',label));const list=el('ul');for(const text of row[key])list.append(el('li','',text));section.append(list);body.append(section);}
        if(!body.children.length)body.append(el('p','help-intro','这次更新的说明还在准备中。你仍然可以查看下方的近期更新。'));
        article.append(top,body);content.append(article);}
    }void read();
  }
  return {focus:()=>heading.focus(),close:()=>{alive=false;}};
},shortcuts(){
  const el=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const previous=document.activeElement,dialog=el('dialog','dialog search-palette shortcuts-panel');dialog.setAttribute('aria-label','快捷键一览');
  const header=el('div','dialog-head'),heading=el('h2','','快捷键一览'),close=el('button','icon-button search-palette-close');close.type='button';close.setAttribute('aria-label','关闭快捷键');close.append(WeftIcons.create('deny',20));close.onclick=()=>dialog.close();header.append(heading,close);
  const body=el('div','dialog-body shortcuts-body');let group,section;for(const row of WeftShortcuts.rows){if(group!==row.group){group=row.group;section=el('section');section.append(el('h3','',group));body.append(section);}const line=el('div','shortcut-row');line.dataset.shortcutId=row.id;line.append(el('span','',row.label));const keys=el('span','shortcut-keys');for(const key of row.keys)keys.append(el('kbd','search-key',key));line.append(keys);section.append(line);}
  dialog.append(header,body);document.body.append(dialog);dialog.onclose=()=>{dialog.remove();if(previous?.isConnected)previous.focus();};dialog.onkeydown=e=>{if(e.key==='Escape')e.stopPropagation();};dialog.showModal();close.focus();return dialog;
},notice({target,core,open,current=()=>true}){
  let generation=0,lastScope,notice;
  const identity=()=>core.releaseIdentity?.()||core.state;
  async function check(){const value=identity(),owner=value.ownerId;if(!owner||!current()){notice?.remove();lastScope=null;return;}const scope=`${owner}:${value.identityGeneration}`;if(lastScope===scope)return;lastScope=scope;const token=++generation;
    try{let release=await core.currentRelease();const latest=identity();if(token!==generation||scope!==`${latest.ownerId}:${latest.identityGeneration}`||!current())return;
      if(release.pending){lastScope=null;return;}const changes=(release.versions?.length?release.versions:[release]).filter(row=>core.observeRelease(row.version,row.layer));if(!changes.length)return;release=changes.find(row=>row.layer==='ui'||row.layer==='mobile-ui')||changes[0];notice?.remove();notice=document.createElement('aside');notice.className='release-notice';notice.setAttribute('aria-label','已更新');notice.setAttribute('role','status');
      const link=document.createElement('button');link.className='release-notice-link';link.type='button';link.textContent=`已更新到 ${release.version} · 看看有什么新东西`;link.onclick=()=>{notice.remove();open();};
      const close=document.createElement('button');close.className='icon-button';close.type='button';close.setAttribute('aria-label','关闭更新提示');close.append(WeftIcons.create('deny',16));close.onclick=()=>notice.remove();notice.append(link,close);target.append(notice);
    }catch{lastScope=null;}}
  return {check,reset(){generation++;lastScope=null;notice?.remove();}};
}};
