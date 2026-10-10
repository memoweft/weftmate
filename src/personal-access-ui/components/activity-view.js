/* Shared presentation for desktop and the mobile web shell. */
globalThis.WeftActivityView={mount({target,core,mobile=false,timeZone=()=>core.activity.timeZone}){
    const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
    const button=(text,action)=>{const el=node('button','button quiet small',text);el.type='button';el.onclick=()=>Promise.resolve(action()).catch(error=>{notice.textContent=core.failureMessage(error);});return el;};
    target.classList.add('activity-page');
    const head=node('div','activity-heading'),title=node('h1','','动态'),notice=node('p','activity-notice');notice.setAttribute('role','status');
    title.tabIndex=-1;
    const all=button('全部已读',()=>core.markAllActivityRead());head.append(title,all);
    const description=node('p','muted','提醒、任务结果和需要你处理的事项，都在这里。');
    const filters=node('nav','activity-filters');filters.setAttribute('aria-label','筛选动态');
    for(const [id,label]of [['all','全部'],['actionable','待处理'],['task','任务'],['reminder','提醒'],['memory','记忆']]){const el=button(label,()=>core.setActivityFilter(id));el.dataset.filter=id;filters.append(el);}
    const list=node('div','activity-days'),more=button('更多动态',()=>core.readActivity(true));
    target.replaceChildren(head,description,filters,notice,list,more);
    const mounted=new Map();
    function render(){
        const model=core.activity;all.disabled=!model.snapshotCursor||!model.unreadCount||model.loading;
        for(const el of filters.children){el.setAttribute('aria-current',el.dataset.filter===model.filter?'true':'false');el.disabled=model.loading;}
        notice.textContent=model.error|| (model.loading?'正在读取动态…':`${model.unreadCount} 条未读${model.actionableCount?` · ${model.actionableCount} 项待处理`:''}`);
        more.hidden=!model.nextCursor;more.disabled=model.loading;
        if(!model.items.length){mounted.clear();const empty=node('div',model.loading&&mobile?'library-skeleton':'activity-empty');if(mobile){empty.append(WeftIcons.create(model.error?'warn':'bell',24));if(model.loading){empty.setAttribute('role','status');empty.setAttribute('aria-label','正在读取动态');for(let i=0;i<4;i++)empty.append(node('div','library-skeleton-row'));}}
            empty.append(node('p','',model.loading?'正在读取…':model.error?model.error:model.filter==='all'?'还没有动态。设一个提醒，或让助手做件事。':'这里暂时没有相关动态。'));
            if(mobile&&model.error)empty.append(button('重试',()=>core.readActivity()));list.replaceChildren(empty);return;}
        const days=new Map(),formatter=new Intl.DateTimeFormat('zh-CN',{timeZone:timeZone(),year:'numeric',month:'long',day:'numeric'}),clock=new Intl.DateTimeFormat('zh-CN',{timeZone:timeZone(),hour:'2-digit',minute:'2-digit',hour12:false});
        const active=document.activeElement,focusedId=active?.closest('[data-activity-id]')?.dataset.activityId,focusedText=active?.textContent;
        for(const item of model.items){const date=formatter.format(new Date(item.at));if(!days.has(date)){const section=node('section','activity-day');section.append(node('h2','',date));days.set(date,section);}
            let row=mounted.get(item.id);if(!row){row=node('article','activity-row');row.dataset.activityId=item.id;row.tabIndex=-1;mounted.set(item.id,row);}
            const signature=JSON.stringify([item,model.busy.has(item.id)]);
            if(row.dataset.signature!==signature){row.dataset.signature=signature;row.classList.toggle('is-unread',!item.read);
                const heading=node('div','activity-row-heading'),label=node('h3','',item.title),time=node('time','muted',clock.format(new Date(item.at)));time.dateTime=item.at;
                heading.append(label,time);const summary=node('p','activity-summary',item.summary),actions=node('div','activity-actions');
                if(item.type==='approval.pending'&&item.state==='pending'){
                    const action=item.actions.find(a=>a.kind==='respond_approval');if(action){actions.append(button('批准',()=>core.activityAction(item,action,'allowed-once')),button('拒绝',()=>core.activityAction(item,action,'rejected')));}
                }
                for(const action of item.actions.filter(a=>a.kind!=='respond_approval'))actions.append(button(action.label,()=>core.activityAction(item,action)));
                if(!item.read)actions.append(button('标为已读',()=>core.markActivityRead(item)));
                const status=node('span','activity-state',item.state==='pending'?'待处理':item.state==='unavailable'?'已失效':item.type.startsWith('approval.')||item.type.startsWith('question.')?'已完成':'');
                const reason=node('small','muted',({dnd:'因勿扰未提醒',daily_limit:'已达每日主动提醒上限',type_disabled:'已设为只进动态'})[item.notification?.reason]||'');
                if(mobile){
                    const entries=[...actions.children].map(control=>({name:control.textContent,danger:control.textContent==='拒绝',action:()=>control.click(),disabled:model.busy.has(item.id)}));
                    const primary=item.actions.find(action=>['open_chat','answer_question','view_memory','view_settings'].includes(action.kind));
                    const content=button('',()=>primary?core.activityAction(item,primary):core.markActivityRead(item));content.className='activity-row-open';content.setAttribute('aria-label',`打开动态 ${item.title}`);content.append(heading,summary,reason,status);
                    if(!primary&&item.read)content.disabled=true;
                    const more=button('',()=>{});more.className='library-icon';more.setAttribute('aria-label',`更多操作 ${item.title}`);more.append(WeftIcons.create('more',16));more.onclick=()=>WeftPopover.menu(more,entries,error=>{notice.textContent=core.failureMessage(error);});more.disabled=!entries.length||model.busy.has(item.id);more.setAttribute('aria-haspopup','menu');
                    row.replaceChildren(content,more);row.setAttribute('aria-label',`${item.read?'':'未读，'}${item.title}`);
                }
                for(const el of actions.children)el.disabled=model.busy.has(item.id);
                if(!mobile){row.replaceChildren(heading,summary,reason,status,actions);row.setAttribute('aria-label',`${item.read?'':'未读，'}${item.title}`);}
            }
            days.get(date).append(row);
        }
        list.replaceChildren(...days.values());
        for(const [id]of mounted)if(!model.items.some(row=>row.id===id))mounted.delete(id);
        if(focusedId){const row=mounted.get(focusedId);const focus=[...(row?.querySelectorAll('button')??[])].find(el=>el.textContent===focusedText);(focus??row)?.focus({preventScroll:true});}
    }
    return {render,destroy(){mounted.clear();target.replaceChildren();}};
}};
