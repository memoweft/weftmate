/* One library presentation for the desktop and mobile web. */
globalThis.WeftLibraryView={mount({target,core,desktop=false,openPreview,copyPath,notice=()=>{}}){
    const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
    const button=(text,action,cls='button quiet small')=>{const el=node('button',cls,text);el.type='button';el.onclick=()=>Promise.resolve(action(el)).catch(error=>notice(core.failureMessage(error)));return el;};
    const icon=type=>WeftIcons.create(({image:'image',code:'code',spreadsheet:'chart',document:'file',other:'file'})[type],24);
    const labels={document:'文档',spreadsheet:'表格',image:'图片',code:'代码',other:'其它'};
    const bytes=size=>size<1024?`${size} B`:size<1048576?`${(size/1024).toFixed(1)} KB`:`${(size/1048576).toFixed(1)} MB`;
    target.classList.add('library-page');
    const head=node('div','library-heading'),title=node('h1','','成果库');title.tabIndex=-1;
    const refresh=button('刷新',()=>core.readLibrary());head.append(title,refresh);
    const intro=node('p','library-intro','对话里做好的文件，都在这里。'),toolbar=node('div','library-toolbar');
    const search=node('input','library-search');search.type='search';search.placeholder='搜索文件名';search.setAttribute('aria-label','搜索文件名');
    let searchTimer;search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>void core.setLibraryFilter('search',search.value),200);});
    const filters=node('nav','library-types');filters.setAttribute('aria-label','文件类型');
    for(const [value,label]of [['','全部'],...Object.entries(labels)]){const el=button(label,()=>core.setLibraryFilter('type',value));el.dataset.type=value;filters.append(el);}
    function select(label,values,key){const el=node('select','library-select');el.setAttribute('aria-label',label);for(const [value,text]of values){const option=node('option','',text);option.value=value;el.append(option);}el.onchange=()=>void core.setLibraryFilter(key,el.value);return el;}
    const project=select('按项目筛选',[['','全部项目']],'projectId'),time=select('按时间筛选',[['all','全部时间'],['7','最近 7 天'],['30','最近 30 天'],['90','最近 90 天']],'time');
    const views=node('div','library-views');views.setAttribute('role','group');views.setAttribute('aria-label','显示方式');
    for(const [id,label]of [['list','列表视图'],['grid','网格视图']]){const el=button(label,()=>{core.library.view=id;render();});el.dataset.view=id;views.append(el);}
    if(!desktop)views.hidden=true;
    toolbar.append(search,project,time,views);
    const status=node('p','library-status');status.setAttribute('role','status');
    const list=node('div','library-list');list.setAttribute('aria-label','成果文件');
    const more=button('加载更多',()=>core.readLibrary(true));target.replaceChildren(head,intro,filters,toolbar,status,list,more);
    globalThis.WeftPopover?.bindSettingsSelect(project);globalThis.WeftPopover?.bindSettingsSelect(time);
    let previewEpoch=0;
    async function preview(item,trigger){
        const epoch=++previewEpoch,identity=core.state.identityGeneration,generation=core.library.generation;
        const content=openPreview(item,trigger);content.textContent='正在读取…';
        try{const data=await core.libraryPreview(item);if(epoch!==previewEpoch||identity!==core.state.identityGeneration||generation!==core.library.generation||!content.isConnected)return;
            content.replaceChildren();const actions=node('div','library-preview-actions');appendActions(actions,item);content.append(actions);
            if(data.kind==='image'){const image=node('img','preview-image');image.alt=item.fileName;image.src=`data:${data.contentType};base64,${data.data}`;content.append(image);}
            else if(data.kind==='pdf'){const frame=node('iframe','library-pdf');frame.title=`预览 ${item.fileName}`;const blob=new Blob([Uint8Array.from(atob(data.data),c=>c.charCodeAt(0))],{type:'application/pdf'}),url=URL.createObjectURL(blob);frame.src=url+'#toolbar=0&navpanes=0&scrollbar=0&view=FitH';content.append(frame);const observer=new MutationObserver(()=>{if(!frame.isConnected){URL.revokeObjectURL(url);observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});}
            else if(data.kind==='markdown'){const body=node('div','markdown-body');if(globalThis.WeftFormat?.render)body.innerHTML=WeftFormat.render(data.text);else body.textContent=data.text;content.append(body);}
            else if(data.text!==undefined){const pre=node('pre','library-text'),code=node('code','',data.text);pre.append(code);content.append(pre);}
            else content.append(node('p','library-empty',data.kind==='missing'?'已不在原位置。文件可能已被移动或删除。':data.reason==='too_large'?'文件较大，请用电脑上的程序打开。':'这个文件暂时无法预览，可在电脑上打开。'));
        }catch(error){if(epoch===previewEpoch&&content.isConnected)content.replaceChildren(node('p','library-empty','暂时无法读取，请重试。'),button('重新读取',()=>preview(item,trigger)));}
    }
    function appendActions(parent,item){
        if(desktop&&core.state.personalCapabilities.libraryDesktopActions===1){for(const [action,label]of [['open','打开'],['show','在文件夹中显示']]){const el=button(label,()=>globalThis.weftmateDesktop.artifact(item.id,`library-${action}`));el.disabled=!item.exists;parent.append(el);}}
        parent.append(button('打开来源对话',()=>core.openLibrarySource(item)));
        if(desktop)parent.append(button('复制路径',async()=>{await copyPath(item.location);notice('路径已复制');}));
    }
    function render(){
        const model=core.library;refresh.disabled=model.loading;more.hidden=!model.nextCursor;more.disabled=model.loading;
        status.textContent=model.error|| (model.loading?'正在读取成果…':`${model.total} 个文件`);
        for(const el of filters.children){el.setAttribute('aria-pressed',String(el.dataset.type===model.type));el.disabled=model.loading;}
        for(const el of views.children)el.setAttribute('aria-pressed',String(el.dataset.view===model.view));
        const projects=JSON.stringify(model.projects);if(project.dataset.items!==projects){project.dataset.items=projects;project.replaceChildren();for(const row of [{id:'',name:'全部项目'},...model.projects]){const option=node('option','',row.name);option.value=row.id;project.append(option);}}
        project.value=model.projectId;time.value=model.time;project.disabled=time.disabled=model.loading;
        list.classList.toggle('is-grid',desktop&&model.view==='grid');list.replaceChildren();
        if(!model.items.length){list.append(node('div','library-empty',model.loading?'正在读取…':model.error?'成果暂时无法读取。点击刷新重试。':model.type||model.search||model.projectId||model.time!=='all'?'没有找到符合条件的文件。试试其他筛选或文件名。':'还没有成果。请在对话里让助手写文档、整理表格或生成图片，完成的文件会出现在这里。'));return;}
        for(const item of model.items){const row=node('article','library-row');row.dataset.libraryId=item.id;
            const open=button('',trigger=>preview(item,trigger),'library-file');open.setAttribute('aria-label',`预览 ${item.fileName}`);
            const art=node('span','library-file-icon');art.append(icon(item.type));
            if(item.type==='image'&&item.exists){const identity=core.state.identityGeneration,generation=model.generation;void core.libraryPreview(item).then(data=>{if(identity!==core.state.identityGeneration||generation!==core.library.generation||!art.isConnected||data.kind!=='image')return;const img=node('img','library-thumbnail');img.alt='';img.src=`data:${data.contentType};base64,${data.data}`;art.replaceChildren(img);}).catch(()=>{});}
            const copy=node('span','library-file-copy');copy.append(node('strong','library-file-name',item.fileName),node('span','library-file-meta',`${labels[item.type]} · ${bytes(item.size)}${item.projectName?` · ${item.projectName}`:''}`));
            open.append(art,copy);const info=node('div','library-row-info');const date=node('time','library-date',new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(new Date(item.modifiedAt)));date.dateTime=item.modifiedAt;date.title=new Date(item.modifiedAt).toLocaleString('zh-CN');info.append(date);
            if(!item.exists)info.append(node('span','library-missing','已不在原位置'));
            const actions=node('div','library-row-actions');appendActions(actions,item);row.append(open,info,actions);list.append(row);
        }
    }
    return {render,preview,dispose(){previewEpoch++;clearTimeout(searchTimer);},focus(){title.focus();}};
}};
