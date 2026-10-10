/* One library presentation for the desktop and mobile web. */
globalThis.WeftLibraryView={mount({target,core,desktop=false,openPreview,copyPath,notice=()=>{}}){
    const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
    const button=(text,action,cls='button quiet small')=>{const el=node('button',cls,text);el.type='button';el.onclick=()=>Promise.resolve(action(el)).catch(error=>notice(core.failureMessage(error)));return el;};
    const kind=item=>/\.pdf$/i.test(item.fileName)?'book':/\.(zip|7z|rar|tar|gz)$/i.test(item.fileName)?'archive':({image:'image',code:'code',spreadsheet:'chart',document:'file',other:'file'})[item.type];
    const icon=item=>WeftIcons.create(kind(item),24);
    const iconButton=(name,id,action,cls='')=>{const el=button('',action,'library-icon '+cls);el.setAttribute('aria-label',name);el.title=name;el.append(WeftIcons.create(id,16));return el;};
    const labels={document:'文档',spreadsheet:'表格',image:'图片',code:'代码',other:'其它'};
    const bytes=size=>size<1024?`${size} 字节`:size<1048576?`${(size/1024).toFixed(1)} KB`:`${(size/1048576).toFixed(1)} MB`;
    target.classList.add('library-page');
    const head=node('div','library-heading'),title=node('h1','','成果库');title.tabIndex=-1;
    const refresh=iconButton('刷新成果库','sync',()=>core.readLibrary());head.append(title,refresh);
    const intro=node('p','library-intro','对话里做好的文件，都在这里。'),toolbar=node('div','library-toolbar');
    const search=node('input','library-search');search.type='search';search.placeholder='搜索文件名';search.setAttribute('aria-label','搜索文件名');
    let searchTimer;search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>void core.setLibraryFilter('search',search.value),200);});
    const filters=node('nav','library-types');filters.setAttribute('aria-label','文件类型');
    for(const [value,label]of [['','全部'],...Object.entries(labels)]){const el=button(label,()=>core.setLibraryFilter('type',value),'library-type');el.dataset.type=value;filters.append(el);}
    function select(label,values,key){const el=node('select','library-select');el.setAttribute('aria-label',label);for(const [value,text]of values){const option=node('option','',text);option.value=value;el.append(option);}el.onchange=()=>void core.setLibraryFilter(key,el.value);return el;}
    const project=select('按项目筛选',[['','全部项目']],'projectId'),time=select('按时间筛选',[['all','全部时间'],['7','最近 7 天'],['30','最近 30 天'],['90','最近 90 天']],'time');
    const views=node('div','library-views');views.setAttribute('role','group');views.setAttribute('aria-label','显示方式');
    for(const [id,label]of [['list','列表视图'],['grid','网格视图']]){const el=iconButton(label,id,()=>{core.library.view=id;render();});el.dataset.view=id;views.append(el);}
    if(!desktop)views.hidden=true;
    toolbar.append(search,project,time,views);
    const status=node('p','library-status');status.setAttribute('role','status');
    const list=node('div','library-list');list.setAttribute('aria-label','成果文件');
    const more=button('加载更多',()=>core.readLibrary(true));target.replaceChildren(head,intro,filters,toolbar,status,list,more);
    globalThis.WeftPopover?.bindSettingsSelect(project);globalThis.WeftPopover?.bindSettingsSelect(time);
    let previewEpoch=0,rowSignature='';
    async function preview(item,trigger){
        const epoch=++previewEpoch,identity=core.state.identityGeneration,generation=core.library.generation;
        const content=openPreview(item,trigger);globalThis.WeftDesktop?.configureLibraryPreview(core.library.items,preview);content.replaceChildren(skeleton());
        try{const data=await core.libraryPreview(item);if(epoch!==previewEpoch||identity!==core.state.identityGeneration||generation!==core.library.generation||!content.isConnected)return;
            content.replaceChildren();const actions=node('div','library-preview-actions');appendActions(actions,item,true);content.append(actions);
            WeftContent.preview(content,data,{name:item.fileName,artifactId:item.id,desktop:false});
        }catch(error){if(epoch===previewEpoch&&content.isConnected)content.replaceChildren(node('p','library-empty','暂时无法读取，请重试。'),button('重新读取',()=>preview(item,trigger)));}
    }
    function entries(item){
        const rows=[];
        if(desktop&&core.state.personalCapabilities.libraryDesktopActions===1)for(const [action,name,id]of [['open','打开','open'],['show','在文件夹中显示','folder']])rows.push({name,icon:id,disabled:!item.exists,description:!item.exists?'已不在原位置，无法打开或定位文件':undefined,action:()=>globalThis.weftmateDesktop.artifact(item.id,`library-${action}`)});
        rows.push({name:'打开来源对话',icon:'chat',action:()=>core.openLibrarySource(item)});
        if(desktop)rows.push({name:'复制路径',icon:'copy',action:async()=>{await copyPath(item.location);notice('路径已复制');}});
        return rows;
    }
    function appendActions(parent,item,previewAction=false){
        if(desktop&&core.state.personalCapabilities.libraryDesktopActions===1){
            const primary=previewAction?button('打开',()=>globalThis.weftmateDesktop.artifact(item.id,'library-open'),'button secondary small'):iconButton(`打开 ${item.fileName}`,'open',()=>globalThis.weftmateDesktop.artifact(item.id,'library-open'),'library-quick-open');
            if(previewAction)primary.prepend(WeftIcons.create('open',16));primary.disabled=!item.exists;primary.title=item.exists?'用默认程序打开':'已不在原位置，无法打开文件';parent.append(primary);
        }
        const menu=iconButton(previewAction?'更多预览操作':`更多操作 ${item.fileName}`,'more',trigger=>WeftPopover.menu(trigger,entries(item),error=>notice(core.failureMessage(error))));
        menu.setAttribute('aria-haspopup','menu');menu.setAttribute('aria-expanded','false');parent.append(menu);
    }
    function skeleton(){const box=node('div','library-skeleton');box.setAttribute('aria-label','正在读取成果');box.setAttribute('role','status');for(let i=0;i<4;i++){const row=node('div','library-skeleton-row');row.append(node('span','library-skeleton-icon'),node('span','library-skeleton-line'));box.append(row);}return box;}
    function empty(message,id='folder',retry=false){const box=node('div','library-empty');box.append(WeftIcons.create(id,24),node('p','',message));if(retry)box.append(button('重试',()=>core.readLibrary(),'button secondary small'));return box;}
    function dateLabel(value){const date=new Date(value),now=new Date();return new Intl.DateTimeFormat('zh-CN',date.toDateString()===now.toDateString()?{hour:'numeric',minute:'2-digit',hourCycle:'h23'}:{month:'long',day:'numeric',...(date.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})}).format(date);}
    function render(){
        const model=core.library;refresh.disabled=model.loading;more.hidden=!model.nextCursor;more.disabled=model.loading;
        status.textContent=model.loading?'正在读取成果…':model.error?'读取失败':`${model.total} 个文件`;list.setAttribute('aria-busy',String(model.loading));
        for(const el of filters.children){el.setAttribute('aria-pressed',String(el.dataset.type===model.type));el.disabled=model.loading;}
        for(const el of views.children)el.setAttribute('aria-pressed',String(el.dataset.view===model.view));
        const projects=JSON.stringify(model.projects);if(project.dataset.items!==projects){project.dataset.items=projects;project.replaceChildren();for(const row of [{id:'',name:'全部项目'},...model.projects]){const option=node('option','',row.name);option.value=row.id;project.append(option);}}
        project.value=model.projectId;time.value=model.time;project.disabled=time.disabled=model.loading;project.dispatchEvent(new Event('weft:sync'));time.dispatchEvent(new Event('weft:sync'));
        list.classList.toggle('is-grid',desktop&&model.view==='grid');const signature=JSON.stringify([model.items,model.view,model.type,model.search,model.projectId,model.time,model.items.length?null:[model.loading,model.error]]);if(signature===rowSignature)return;rowSignature=signature;list.replaceChildren();
        if(!model.items.length){list.append(model.loading?skeleton():model.error?empty(model.error,'warn',true):empty(model.type||model.search||model.projectId||model.time!=='all'?'没有找到符合条件的文件。试试其他筛选或文件名。':'还没有成果。让助手写文档、整理表格或生成图片，完成的文件会出现在这里。'));return;}
        for(const item of model.items){const row=node('article','library-row');row.dataset.libraryId=item.id;row.classList.toggle('is-missing',!item.exists);
            const open=button('',trigger=>preview(item,trigger),'library-file');open.setAttribute('aria-label',`预览 ${item.fileName}`);
            const art=node('span','library-file-icon');art.append(icon(item));
            if(item.type==='image'&&item.exists){const identity=core.state.identityGeneration,generation=model.generation;void core.libraryPreview(item).then(data=>{if(identity!==core.state.identityGeneration||generation!==core.library.generation||!art.isConnected||data.kind!=='image')return;const img=node('img','library-thumbnail');img.alt='';img.src=`data:${data.contentType};base64,${data.data}`;art.replaceChildren(img);}).catch(()=>{});}
            const copy=node('span','library-file-copy');copy.append(node('strong','library-file-name',item.fileName),node('span','library-file-meta',`${/\.pdf$/i.test(item.fileName)?'PDF':/\.(zip|7z|rar|tar|gz)$/i.test(item.fileName)?'压缩包':labels[item.type]} · ${bytes(item.size)}${item.projectName?` · ${item.projectName}`:''}`));
            open.append(art,copy);const info=node('div','library-row-info');const date=node('time','library-date',dateLabel(item.modifiedAt));date.dateTime=item.modifiedAt;date.title=new Date(item.modifiedAt).toLocaleString('zh-CN');info.append(date);
            if(!item.exists){copy.append(node('span','library-missing','已不在原位置'));row.title='文件可能已被移动或删除；仍可查看来源对话和复制原路径。';}
            const actions=node('div','library-row-actions');appendActions(actions,item);row.append(open,info,actions);row.onclick=event=>{if(!event.target.closest('button'))open.click();};list.append(row);
        }
    }
    const autoRefresh=setInterval(()=>{if(target.isConnected&&!target.hidden&&document.visibilityState==='visible')void core.readLibrary();},6000);
    return {render,preview,deactivate(){previewEpoch++;clearTimeout(searchTimer);WeftPopover.closeMenu();},dispose(){previewEpoch++;clearTimeout(searchTimer);clearInterval(autoRefresh);WeftPopover.closeMenu();},focus(){title.focus();}};
}};
