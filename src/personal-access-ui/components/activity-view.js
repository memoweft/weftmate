/* Real layout expansion; callbacks and requests never wait for presentation. */
globalThis.WeftAuxiliaryMotion = {
    expanded: new WeakMap(),
    expand(content, open, trigger) {
        trigger?.setAttribute('aria-expanded', String(open));
        if (globalThis.WeftMotion?.visibility) { globalThis.WeftMotion.visibility(content, open); return; }
        const previous = this.expanded.get(content), from = content.hidden ? 0 : content.getBoundingClientRect().height;
        previous?.cancel(); content.hidden = false; content.inert = !open;
        trigger?.setAttribute('aria-expanded', String(open));
        const settle = () => { content.hidden = !open; content.inert = false; content.style.removeProperty('height'); content.style.removeProperty('overflow'); this.expanded.delete(content); };
        if (globalThis.WeftReplyMotion?.reduced || globalThis.WeftReplyMotion?.paused || matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.hasAttribute('data-motion-full')) { settle(); return; }
        const to = open ? content.scrollHeight : 0, css = getComputedStyle(document.documentElement);
        const duration = parseFloat(css.getPropertyValue(Math.max(from, to) > 400 ? '--dur-5' : '--dur-4'));
        content.style.height = `${to}px`; content.style.overflow = 'clip';
        const animation = content.animate([{height:`${from}px`,opacity:open ? .5 : 1},{height:`${to}px`,opacity:open ? 1 : 0}], {duration,easing:css.getPropertyValue('--ease-out').trim()});
        this.expanded.set(content, animation);
        animation.finished.then(() => { if (this.expanded.get(content) === animation) settle(); }, () => {});
    }
};
/* Shared presentation for desktop and the mobile web shell. */
globalThis.WeftActivityView={mount({target,core,mobile=false,timeZone=()=>core.activity.timeZone}){
    const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
    const button=(text,action)=>{const el=node('button','button quiet small',text);el.type='button';el.onclick=()=>Promise.resolve().then(action).catch(error=>{notice.textContent=core.failureMessage(error);});return el;};
    target.classList.add('activity-page');
    const head=node('div','activity-heading'),title=node('h1','','动态'),notice=node('p','activity-notice');notice.setAttribute('role','status');
    title.tabIndex=-1;
    const all=button('全部已读',()=>core.markAllActivityRead());head.append(title,all);
    const description=node('p','muted','需要你处理的事，和已经完成的结果。');
    const filters=node('nav','activity-filters');filters.setAttribute('aria-label','筛选动态');
    for(const [id,label]of [['all','全部'],['actionable','待处理'],['task','任务'],['reminder','提醒'],['memory','记忆']]){const el=button(label,()=>core.setActivityFilter(id));el.dataset.filter=id;filters.append(el);}
    const list=node('div','activity-days'),more=button('更多动态',()=>core.readActivity(true));
    target.replaceChildren(head,description,filters,notice,list,more);
    const mounted=new Map(),mountedDays=new Map();let renderSignature='';
    function digestContent(item){
        const report=item.memoryDigest,body=node('div','memory-digest');
        const formatter=new Intl.DateTimeFormat('zh-CN',{timeZone:report.timeZone,month:'long',day:'numeric'});
        body.append(node('p','muted',`${formatter.format(new Date(report.from))} — ${formatter.format(new Date(report.to))}`));
        function entries(values,review=false){
            for(const value of values){const line=node('div','digest-memory'),copy=node('div','digest-memory-copy');
                const disabled=['forgotten','unavailable'].includes(value.status),content=button(disabled?value.status==='forgotten'?'已忘掉':value.statusLabel||'当前不可用':value.text,()=>core.activityAction(item,{kind:'memory_item',target:{kind:value.kind,id:value.id}}));
                content.className='digest-memory-open';content.disabled=disabled;content.prepend(WeftIcons.create('memory',16));copy.append(content);
                if(review||['confirmed','corrected'].includes(value.status))copy.append(node('small','muted',value.status==='confirmed'?'已确认，90 天内不再询问':value.status==='corrected'?'已更正':value.reviewReason));
                line.append(copy);
                if(review&&['current','corrected'].includes(value.status)){const confirm=button('还对',()=>core.activityAction(item,{kind:'memory_confirm',target:{kind:value.kind,id:value.id}}));confirm.className='button secondary small';confirm.disabled=core.activity.busy.has(item.id);line.append(confirm);}
                if(!disabled){const more=button('',()=>{});more.className='icon-button digest-more';more.setAttribute('aria-label',`记忆操作 ${value.text}`);more.setAttribute('aria-haspopup','menu');more.append(WeftIcons.create('more',16));
                    more.onclick=()=>WeftPopover.menu(more,[{name:'不对，改一下',icon:'edit',disabled:value.kind==='entity',action:()=>core.activityAction(item,{kind:'memory_item',target:{kind:value.kind,id:value.id}},'correct')},
                        {name:'忘掉',icon:'trash',danger:true,action:()=>core.activityAction(item,{kind:'memory_item',target:{kind:value.kind,id:value.id}},'delete')}],error=>notice.textContent=core.failureMessage(error));
                    more.disabled=core.activity.busy.has(item.id);line.append(more);}
                body.append(line);
            }
        }
        const groups=new Map();for(const value of report.added){if(!groups.has(value.topic))groups.set(value.topic,[]);groups.get(value.topic).push(value);}
        for(const [topic,values]of groups){body.append(node('h4','',topic));entries(values);}
        if(report.moreCount){const more=button(`还有 ${report.moreCount} 条`,()=>core.activityAction(item,{kind:'view_memory',target:{from:report.from,to:report.to}}));more.className='button secondary small';body.append(more);}
        if(report.corrected.length){body.append(node('h4','','这一周更正过的'));entries(report.corrected);}
        if(report.review.length){body.append(node('h4','','这些很久没用到了，还对吗？'));entries(report.review,true);}
        return body;
    }
    function insightContent(item){
        const report=item.weeklyInsight,body=node('div','memory-digest weekly-insight');
        body.append(node('p','weekly-insight-text',report.text));
        const sources=node('div','weekly-insight-sources');
        const invoke=source=>core.activityAction(item,{kind:source.artifactId?'view_library':'open_chat',target:source.artifactId?{id:source.artifactId}:source.source});
        const visible=[...report.sources.filter(source=>!source.artifactId),...report.sources.filter(source=>source.artifactId).slice(0,3)],rest=report.sources.filter(source=>!visible.includes(source));
        for(const source of visible){const control=button(source.title,()=>invoke(source));control.className='button secondary small';control.prepend(WeftIcons.create(source.artifactId?'file':'chat',16));control.disabled=core.activity.busy.has(item.id);sources.append(control);}
        if(rest.length){const more=button(`更多来源（${rest.length}）`,()=>{});more.setAttribute('aria-haspopup','menu');more.disabled=core.activity.busy.has(item.id);more.onclick=()=>WeftPopover.menu(more,rest.map(source=>({name:source.title,icon:source.artifactId?'file':'chat',action:()=>invoke(source)})),error=>notice.textContent=core.failureMessage(error));sources.append(more);}
        body.append(sources);return body;
    }
    function render(){
        const model=core.activity,nextSignature=JSON.stringify([model.items,model.filter,model.loading,model.error,model.unreadCount,model.actionableCount,model.snapshotCursor,model.nextCursor,[...model.busy],timeZone()]);
        if(renderSignature===nextSignature)return;renderSignature=nextSignature;
        all.disabled=!model.snapshotCursor||!model.unreadCount||model.loading;
        for(const el of filters.children){el.setAttribute('aria-current',el.dataset.filter===model.filter?'true':'false');el.disabled=model.loading;}
        notice.textContent=model.error?`${model.error}${model.items.length?' · 仍显示上次的动态':''}`:model.loading&&model.items.length?'正在更新…':model.loading?'':model.actionableCount?`${model.actionableCount} 项待处理${model.unreadCount?` · ${model.unreadCount} 条未读`:''}`:model.unreadCount?`${model.unreadCount} 条未读`:'没有待处理的事';
        more.hidden=!model.nextCursor;more.disabled=model.loading;
        list.setAttribute('aria-busy',String(model.loading));
        if(!model.items.length){mounted.clear();mountedDays.clear();
            if(model.loading){list.replaceChildren(WeftControls.skeleton({rows:4}));return;}
            const empty=node('div','activity-empty');empty.append(node('p','',model.error|| (model.filter==='all'?'还没有动态。设一个提醒，或让助手做件事。':'这里暂时没有相关动态。')));
            if(model.error)empty.append(button('重试',()=>core.readActivity()));list.replaceChildren(empty);return;}
        const days=new Map(),formatter=new Intl.DateTimeFormat('zh-CN',{timeZone:timeZone(),year:'numeric',month:'long',day:'numeric'}),clock=new Intl.DateTimeFormat('zh-CN',{timeZone:timeZone(),hour:'2-digit',minute:'2-digit',hour12:false});
        const active=document.activeElement,focusedId=active?.closest('[data-activity-id]')?.dataset.activityId,focusedText=active?.textContent;
        const dayRows=new Map();
        for(const item of model.items){const date=formatter.format(new Date(item.at));if(!days.has(date)){let section=mountedDays.get(date);if(!section){section=node('section','activity-day');section.append(node('h2','',date));mountedDays.set(date,section);}days.set(date,section);dayRows.set(date,[]);}
            let row=mounted.get(item.id);if(!row){row=node('article','activity-row');row.dataset.activityId=item.id;row.tabIndex=-1;mounted.set(item.id,row);}
            const signature=JSON.stringify([item,model.busy.has(item.id)]);
            if(row.dataset.signature!==signature){row.dataset.signature=signature;row.classList.toggle('is-unread',!item.read);row.classList.toggle('needs-action',item.state==='pending');
                const heading=node('div','activity-row-heading'),label=node('h3','',item.title),time=node('time','muted',clock.format(new Date(item.at)));time.dateTime=item.at;
                if(item.computerName||core.hasMultipleComputers?.())heading.append(node('small','muted',item.computerName||core.computerName(item.source?.hostId||core.currentExecutionComputer())));
                heading.append(label,time);const summary=node('p','activity-summary',item.weeklyInsight?(()=>{const date=new Intl.DateTimeFormat('zh-CN',{timeZone:'UTC',month:'long',day:'numeric'});return `${date.format(new Date(item.weeklyInsight.from+'T00:00:00Z'))} — ${date.format(new Date(Date.parse(item.weeklyInsight.to+'T00:00:00Z')-86400000))}`;})():item.summary),actions=node('div','activity-actions');
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
                if(item.weeklyInsight){row.classList.add("has-memory-digest");row.append(insightContent(item));}
                if(item.memoryDigest){
                    row.classList.add('has-memory-digest');
                    if(!mobile){
                        const header=node('div','digest-report-heading'),open=button('',()=>core.activityAction(item,item.actions[0]));open.className='activity-row-open digest-report-open';open.setAttribute('aria-label',`打开动态 ${item.title}`);heading.prepend(WeftIcons.create('memory',20));open.append(heading,summary);
                        const more=button('',()=>{});more.className='icon-button';more.setAttribute('aria-label',`更多操作 ${item.title}`);more.setAttribute('aria-haspopup','menu');more.append(WeftIcons.create('more',16));more.onclick=()=>WeftPopover.menu(more,[...actions.children].map(control=>({name:control.textContent,action:()=>control.click()})));header.append(open,more);row.replaceChildren(header);
                    }
                    row.append(digestContent(item));
                }
            }
            dayRows.get(date).push(row);
        }
        for(const [date,section]of days)WeftControls.reconcile(section,[section.firstChild,...dayRows.get(date)]);
        WeftControls.reconcile(list,[...days.values()]);
        for(const date of mountedDays.keys())if(!days.has(date))mountedDays.delete(date);
        for(const [id]of mounted)if(!model.items.some(row=>row.id===id))mounted.delete(id);
        if(focusedId){const row=mounted.get(focusedId);const focus=[...(row?.querySelectorAll('button')??[])].find(el=>el.textContent===focusedText);(focus??row)?.focus({preventScroll:true});}
    }
    return {render,destroy(){mounted.clear();mountedDays.clear();target.replaceChildren();}};
}};
