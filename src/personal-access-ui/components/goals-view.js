/* Shared desktop/mobile presentation. No independent task or timer state. */
globalThis.WeftGoalsView={mount({target,core,openSource,toast}){
    const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
    const notify=message=>toast?.(message);
    const notice={set textContent(message){if(message)notify(message);}};
    const button=(text,action,cls='button secondary small')=>{const n=el('button',cls,text);n.type='button';n.onclick=()=>Promise.resolve().then(action).catch(error=>notify(core.failureMessage(error)));return n;};
    const iconButton=(name,icon,action)=>{const n=button('',action,'button quiet small goals-icon');n.setAttribute('aria-label',name);n.title=name;n.append(WeftIcons.create(icon,16));return n;};
    const refresh=iconButton('刷新目标','sync',()=>core.readGoals());
    const head=el('div','goals-heading'),title=el('h1','','目标');title.tabIndex=-1;head.append(title,refresh);
    target.classList.add('goals-page');target.replaceChildren(head,el('p','goals-intro','看看正在做的事，安排之后的事，持续推进想完成的目标。'));
    const sections={};for(const [id,name]of [['tasks','进行中'],['schedules','定时任务'],['goals','长期目标']]){
        const section=el('section','goals-section'),header=el('div','goals-heading'),heading=el('h2','',name),list=el('div','goals-list');section.setAttribute('aria-label',name);header.append(heading);section.append(header,list);target.append(section);sections[id]={section,header,list};
    }
    const recent=el('div','goals-recent'),recentList=el('div','goals-list');recentList.hidden=true;recentList.id=`goals-recent-${crypto.randomUUID()}`;
    const recentToggle=button('最近完成 · 保留 7 天',()=>{recentList.hidden=!recentList.hidden;recentToggle.setAttribute('aria-expanded',String(!recentList.hidden));},'chat-day-toggle goals-collapse');
    recentToggle.prepend(WeftIcons.create('chevron',16));recentToggle.setAttribute('aria-expanded','false');recentToggle.setAttribute('aria-controls',recentList.id);recent.append(recentToggle,recentList);sections.tasks.section.append(recent);
    let form=null,signature='';
    const stateNames={running:'进行中',queued:'排队中',approval:'等待审批',question:'等待回答',stopping:'正在停止',unconfirmed:'结果待确认',completed:'已完成',failed:'失败',stopped:'已停止',active:'进行中',paused:'已暂停',blocked:'需要处理',complete:'已完成'};
    function confirmDelete(text,action){
        const returnFocus=document.activeElement,dialog=el('dialog','dialog confirm-dialog message-action-dialog goals-confirm');dialog.setAttribute('aria-label',text);
        const head=el('div','dialog-head'),body=el('div','dialog-body'),footer=el('div','dialog-footer');head.append(el('h2','',text));body.append(el('p','muted','删除后不会再按这个安排运行。已完成的对话记录会保留。'));
        const cancel=button('取消',()=>dialog.close()),remove=button('确认删除',async()=>{remove.disabled=true;try{await action();dialog.close();notify('定时任务已删除');}finally{remove.disabled=false;}},'button danger');footer.append(cancel,remove);dialog.append(head,body,footer);target.append(dialog);dialog.onclose=()=>{dialog.remove();if(returnFocus?.isConnected)returnFocus.focus();};dialog.onkeydown=e=>{if(e.key==='Escape')e.stopPropagation();};dialog.showModal();cancel.focus();
    }
    // Date and time use the application's shared combobox controls, with no system picker.
    function dateTimeField(label,type,value){
        const wrap=el('div','goals-field'),group=el('div','goals-date-time'),source=el('input');source.type='hidden';source.value=value;wrap.append(el('span','',label),group,source);form.append(wrap);group.setAttribute('role','group');group.setAttribute('aria-label',label);
        const parts=value.split(type==='date'?'-':':'),controls=[];
        const specs=type==='date'?[['年',Math.min(new Date().getFullYear(),Number(parts[0])),Math.max(new Date().getFullYear()+10,Number(parts[0]))],['月',1,12],['日',1,31]]:[['小时',0,23],['分钟',0,59]];
        for(const [i,[name,min,max]]of specs.entries()){
            const select=el('select');select.setAttribute('aria-label',`${label} · ${name}`);if(type==='date'&&i===0)select.dataset.customYear='true';
            for(let n=min;n<=max;n++){const opt=el('option','',type==='date'?`${n}${name}`:String(n).padStart(2,'0'));opt.value=String(n).padStart(i===0&&type==='date'?4:2,'0');select.append(opt);}select.value=parts[i];group.append(select);controls.push(select);
        }
        const sync=()=>{if(type==='date'){const days=new Date(Number(controls[0].value),Number(controls[1].value),0).getDate();for(const opt of controls[2].options)opt.disabled=Number(opt.value)>days;if(Number(controls[2].value)>days)controls[2].value=String(days).padStart(2,'0');controls[2].dispatchEvent(new Event('weft:sync'));}source.value=controls.map(n=>n.value).join(type==='date'?'-':':');};controls.forEach(n=>n.addEventListener('change',sync));sync();return source;
    }
    function showForm(kind,row){
        form?.remove();form=el('form','goals-form');form.setAttribute('aria-label',kind==='schedule'?(row?'编辑定时任务':'新建定时任务'):(row?'目标详情':'新建长期目标'));
        const heading=el('h3','',form.getAttribute('aria-label'));form.append(heading);
        const field=(label,type,value)=>{const wrap=el('label','goals-field'),input=el(type==='select'?'select':type==='textarea'?'textarea':'input');if(input.tagName==='INPUT')input.type=type;input.setAttribute('aria-label',label);input.value=value??'';wrap.append(el('span','',label),input);form.append(wrap);return input;};
        const name=field(kind==='schedule'?'要做什么':'目标标题',kind==='schedule'?'textarea':'text',row?.text??row?.title);name.required=true;name.maxLength=kind==='schedule'?32000:160;
        const session=field('所属对话','select');
        for(const item of core.goalsPage.sessions.filter(s=>s.taskAvailable!==false)){const opt=el('option','',item.kind==='main'?'WeftMate 主对话':item.temporary||item.hasTemporaryContent?'临时对话':item.title||'旁聊');opt.value=item.sessionId;session.append(opt);}
        session.value=row?.sessionId??row?.source?.sessionId??core.state.selectedSessionId??session.options[0]?.value??'';session.required=true;session.disabled=!!row;
        if(!session.options.length)form.append(el('p','muted','先开始一个对话，再来关联安排或目标。'));
        let description,mode,repeat,date,time,weekday,monthday,interval;
        if(kind==='schedule'){
            mode=field('到点做什么','select');for(const [value,label]of [['reminder','提醒我'],['task','让助手执行']]){const opt=el('option','',label);opt.value=value;mode.append(opt);}mode.value=row?.kind??'reminder';
            repeat=field('重复','select');for(const [value,label]of [['once','一次性'],['daily','每天'],['weekly','每周'],['monthly','每月'],['interval','固定间隔']]){const opt=el('option','',label);opt.value=value;repeat.append(opt);}repeat.value=row?.repeat?.kind??'daily';
            const zone=row?.timeZone??core.goalsPage.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone;
            const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(row?.nextRunAt?new Date(row.nextRunAt):new Date(Date.now()+3600000)).map(p=>[p.type,p.value]));
            date=dateTimeField('日期','date',`${parts.year}-${parts.month}-${parts.day}`);time=dateTimeField('时间','time',row?.repeat?.time?.slice(0,5)??`${parts.hour}:${parts.minute}`);time.required=true;
            weekday=field('星期','select');for(const [index,label]of ['日','一','二','三','四','五','六'].entries()){const opt=el('option','',`星期${label}`);opt.value=String(index);weekday.append(opt);}weekday.value=String(row?.repeat?.weekday??1);
            monthday=field('每月几日','number',row?.repeat?.day??1);monthday.min='1';monthday.max='31';interval=field('间隔秒数（至少 300 秒）','number',row?.repeat?.seconds??300);interval.min='300';interval.step='1';
            const toggle=()=>{date.parentElement.hidden=repeat.value!=='once';date.required=repeat.value==='once';weekday.parentElement.hidden=repeat.value!=='weekly';monthday.parentElement.hidden=repeat.value!=='monthly';interval.parentElement.hidden=repeat.value!=='interval';time.parentElement.hidden=repeat.value==='interval';time.required=repeat.value!=='interval';};repeat.onchange=toggle;toggle();
            form.append(el('p','muted',`按${zoneLabel(zone)}安排；每月不存在的日期会跳过，电脑离线时恢复后补送。`));
        }else{description=field('目标说明','textarea',row?.description);name.readOnly=!!row;description.readOnly=!!row;description.maxLength=32000;form.append(el('p','muted','目标关联到一个对话；每个对话同时保留一个目标。执行进展与结果在原对话查看。'));}
        const actions=el('div','goals-actions'),cancel=button('取消',()=>{form?.remove();form=null;}),submit=el('button','button primary','保存');submit.type='submit';submit.hidden=kind==='goal'&&!!row;actions.append(cancel,submit);form.append(actions);
        let requestId=crypto.randomUUID(),originalBody;
        form.onsubmit=async event=>{event.preventDefault();if(kind==='goal'&&row)return;submit.disabled=true;
            try{const body={requestId,sessionId:session.value};if(kind==='schedule'){Object.assign(body,{text:name.value,kind:mode.value,...(row?{expectedRevision:row.revision}:{})});const value=time.value.length===5?`${time.value}:00`:time.value;if(repeat.value==='interval')body.repeat={kind:'interval',seconds:Number(interval.value)};else if(repeat.value==='once')body.at={date:date.value,time:value};else body.repeat={kind:repeat.value,time:value,...(repeat.value==='weekly'?{weekday:Number(weekday.value)}:repeat.value==='monthly'?{day:Number(monthday.value)}:{})};}
                else Object.assign(body,{title:name.value,description:description.value});
                // A retry after an uncertain write keeps the exact intent and ID.
                if(originalBody&&JSON.stringify(body)!==originalBody){notice.textContent='先重试确认上次保存结果，再修改内容。';return;}originalBody=JSON.stringify(body);
                const result=kind==='schedule'?await core.saveGoalSchedule(body,row):await core.saveLongGoal(body);if(result){form?.remove();form=null;notice.textContent='已保存。';}
            }catch(error){if(['SOURCE_UNAVAILABLE','SESSION_UNAVAILABLE'].includes(error.code)){form?.remove();form=null;notice.textContent='关联内容已清理，请重新新建。';return;}if(error.status&&error.status<500){originalBody=null;requestId=crypto.randomUUID();}notice.textContent=error.code==='GOAL_ALREADY_EXISTS'?'这个对话已有目标，请完成或归档后再新建。':error.status===409?'内容已变化，请刷新后再试。':`${core.failureMessage(error)} 可用原内容重试确认。`;}
            finally{submit.disabled=false;}
        };
        sections[kind==='schedule'?'schedules':'goals'].header.after(form);form.querySelectorAll('select').forEach(n=>WeftPopover.bindSettingsSelect(n));name.focus();
    }
    const newSchedule=button('新建定时任务',()=>showForm('schedule'), 'button primary small'),newGoal=button('新建长期目标',()=>showForm('goal'));sections.schedules.header.append(newSchedule);sections.goals.header.append(newGoal);
    const sourceTitle=row=>row.temporary?'临时对话':row.conversationTitle??core.goalsPage.sessions.find(s=>s.sessionId===(row.sessionId??row.source?.sessionId))?.title??'所属对话';
    const open=row=>openSource(row.source??{sessionId:row.sessionId});
    const zoneLabel=zone=>({ 'Asia/Shanghai':'上海时间','Asia/Hong_Kong':'香港时间','Asia/Tokyo':'东京时间','America/New_York':'纽约时间','America/Los_Angeles':'洛杉矶时间','Europe/London':'伦敦时间','Europe/Paris':'巴黎时间','UTC':'协调世界时' }[zone]??`${new Intl.DateTimeFormat('zh-CN',{timeZone:zone,timeZoneName:'longGeneric'}).formatToParts(new Date()).find(p=>p.type==='timeZoneName')?.value??'当地时间'}`);
    function scheduleText(row){
        const zone=row.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone,time=value=>value?`${Number(value.split(':')[0])}:${value.split(':')[1]}`:'';
        const repeat=row.repeat,week=['周日','周一','周二','周三','周四','周五','周六'];
        const frequency=repeat?({daily:`每天 ${time(repeat.time)}`,weekly:`每${week[repeat.weekday]} ${time(repeat.time)}`,monthly:`每月 ${repeat.day} 日 ${time(repeat.time)}`,interval:repeat.seconds%3600===0?`每 ${repeat.seconds/3600} 小时`:repeat.seconds%60===0?`每 ${repeat.seconds/60} 分钟`:`每 ${repeat.seconds} 秒`}[repeat.kind]):'一次性';
        let next='';if(row.nextRunAt&&row.state!=='completed'){
            const date=new Date(row.nextRunAt),now=new Date(),fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}),day=d=>{const p=Object.fromEntries(fmt.formatToParts(d).map(n=>[n.type,n.value]));return Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day));};
            const delta=Math.round((day(date)-day(now))/86400000),weekday=new Intl.DateTimeFormat('zh-CN',{timeZone:zone,weekday:'short'}).format(date),nowDay=new Date(day(now)).getUTCDay(),untilSunday=7-(nowDay||7);
            next=delta===0?'今天':delta===1?'明天':delta>1&&delta<=untilSunday?`本${weekday}`:`${new Intl.DateTimeFormat('zh-CN',{timeZone:zone,month:'long',day:'numeric',...(date.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})}).format(date)}（${weekday}）`;
            if(!repeat||delta===0||delta===1)next+=` ${new Intl.DateTimeFormat('zh-CN',{timeZone:zone,hour:'numeric',minute:'2-digit',hourCycle:'h23'}).format(date)}`;
        }
        return [frequency,row.state==='paused'?'已暂停':row.state==='completed'?'已结束':next?`下次 ${next}`:'',zone!==Intl.DateTimeFormat().resolvedOptions().timeZone?zoneLabel(zone):''].filter(Boolean).join(' · ');
    }
    function menuButton(row,entries){const n=iconButton(`更多操作 ${row.title??row.text}`,'more',()=>WeftPopover.menu(n,entries,message=>notify(core.failureMessage(message))));n.setAttribute('aria-haspopup','menu');n.setAttribute('aria-expanded','false');return n;}
    function contentButton(row,action){const copy=button('',action,'goals-row-content');copy.setAttribute('aria-label',`${row.text?'编辑':'查看'} ${row.title??row.text}`);copy.append(el('h3','',row.title??row.text));return copy;}
    function taskRow(row){
        const item=el('article','goals-row');item.setAttribute('aria-label',row.title);item.dataset.goalKey=row.taskId;
        const copy=contentButton(row,()=>open(row));copy.append(el('span','goals-meta',`${row.conversationTitle} · ${stateNames[row.status]??'处理中'}`),el('span','goals-meta',`${row.startedAt?'已运行':'已等待'} ${Math.floor(row.elapsedSeconds/60)} 分钟`),el('span','goals-step',row.step));
        const actions=el('div','goals-row-actions');if(row.canStop){const stop=button('停止',()=>core.stopOverviewTask(row));stop.disabled=core.goalsPage.busy.has(row.taskId);actions.append(stop);}actions.append(menuButton(row,[{name:'打开对话与步骤',action:()=>open(row)}]));item.append(copy,actions);return item;
    }
    function stateBlock(kind,key,message){
        const block=el('div',`goals-state goals-state-${kind}`);block.setAttribute('role',kind==='error'?'alert':'status');
        if(kind==='loading'){block.setAttribute('aria-label',`正在读取${{tasks:'进行中任务',schedules:'定时任务',goals:'长期目标'}[key]}`);for(let i=0;i<2;i++){const line=el('div','goals-skeleton');line.setAttribute('aria-hidden','true');line.append(el('span'),el('span'));block.append(line);}}
        else{block.append(WeftIcons.create(kind==='error'?'warn':{tasks:'allow',schedules:'clock',goals:'chart'}[key],20),el('strong','',kind==='error'?'暂时无法读取':{tasks:'现在没有进行中的任务',schedules:'安排下一件事',goals:'持续推进想完成的事'}[key]),el('p','goals-meta',message));if(kind==='error')block.append(button('重试',()=>core.readGoals()));}
        return block;
    }
    function render(){
        const model=core.goalsPage;refresh.disabled=model.loading;newSchedule.disabled=core.state.personalCapabilities?.scheduleEditing!==1||!model.sessions.some(s=>s.taskAvailable!==false);newGoal.disabled=core.state.personalCapabilities?.goals!==1||!model.sessions.some(s=>s.taskAvailable!==false);
        const next=JSON.stringify([model.loading,model.tasks,model.recent,model.schedules,model.goals,model.errors,[...model.busy]]);if(signature===next)return;signature=next;
        const focused=document.activeElement,focusedLabel=focused?.getAttribute('aria-label')??focused?.textContent,focusedRow=focused?.closest('article')?.dataset.goalKey;
        for(const [key,{list}]of Object.entries(sections)){
            list.replaceChildren();list.setAttribute('aria-busy',String(model.loading));if(model.errors[key]){list.append(stateBlock('error',key,model.errors[key]));continue;}
            const rows=key==='tasks'?model.tasks:model[key];if(!rows.length)list.append(stateBlock(model.loading?'loading':'empty',key,{tasks:'交代助手做事后，可以在这里查看进展。',schedules:'新建定时任务，也可以在对话里说“每天早上 8 点提醒我喝水”。',goals:'把想持续推进的事关联到一个对话，每次进展都留在原对话。'}[key]));
            for(const row of rows){
                if(key==='tasks'){list.append(taskRow(row));continue;}
                const item=el('article','goals-row'),actions=el('div','goals-row-actions');item.setAttribute('aria-label',row.title??row.text);item.dataset.goalKey=`${row.sessionId??row.source?.sessionId}/${row.id}`;
                const edit=()=>row.temporary?open(row):showForm(key==='schedules'?'schedule':'goal',row),copy=contentButton(row,edit),entries=[];
                if(key==='schedules'){
                    copy.append(el('span','goals-meta',scheduleText(row)),el('span','goals-source',sourceTitle(row)));
                    const state=row.lastResult?.state,status=el('span','goals-result');status.dataset.state=['delivered','completed'].includes(state)?'success':state==='failed'?'failed':'neutral';status.append(el('span','goals-status-dot'),document.createTextNode(!row.lastRunAt?'尚未运行':({delivered:'成功',completed:'成功',failed:'失败',stopped:'已停止',queued:'等待执行'}[state]??'结果待确认')));copy.append(status);
                    if(row.state!=='completed'){
                        const label=el('label','goals-toggle'),toggle=el('input','settings-switch');toggle.type='checkbox';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label',`启用 ${row.text}`);toggle.checked=row.state!=='paused';toggle.disabled=model.busy.has(row.id);label.append(toggle);actions.append(label);toggle.onchange=async()=>{toggle.disabled=true;try{await core.manageSchedule(row,toggle.checked?'resume':'pause');await core.readGoals();}catch(error){toggle.checked=row.state!=='paused';notify(core.failureMessage(error));}finally{toggle.disabled=false;}};
                    }
                    entries.push({name:row.temporary?'在对话里编辑':'编辑',action:edit},{name:'立即运行',action:async()=>{await core.manageSchedule(row,'run');await core.readGoals();}},{name:'打开所属对话',action:()=>open(row)},{name:'删除',danger:true,action:()=>confirmDelete('删除这个定时任务？',async()=>{await core.manageSchedule(row,'delete');await core.readGoals();})});
                }else{
                    if(row.description)copy.append(el('span','goals-step',row.description));copy.append(el('span','goals-meta',`${stateNames[row.phase]??'处理中'} · ${row.progress}${row.scheduleIds?.length?` · ${row.scheduleIds.length} 个定时任务`:''}`),el('span','goals-source',sourceTitle(row)));
                    entries.push({name:'查看目标详情',action:edit});if(row.phase!=='complete')entries.push({name:'完成目标',action:()=>core.manageLongGoal(row,'complete',crypto.randomUUID())});entries.push({name:'打开所属对话',action:()=>open(row)},{name:'归档目标',action:()=>core.manageLongGoal(row,'archive',crypto.randomUUID())});
                }
                actions.append(menuButton(row,entries));item.append(copy,actions);list.append(item);
            }
        }
        recentList.replaceChildren(...model.recent.map(taskRow));if(!model.recent.length)recentList.append(el('p','goals-empty','最近 7 天还没有完成的任务。'));
        if(focusedRow){const article=[...target.querySelectorAll('article')].find(n=>n.dataset.goalKey===focusedRow);[...article?.querySelectorAll('button,input')??[]].find(n=>(n.getAttribute('aria-label')??n.textContent)===focusedLabel)?.focus({preventScroll:true});}
    }
    return {render,reset(){form?.remove();form=null;signature='';WeftPopover.closeMenu();render();},focus:()=>title.focus(),close(){WeftPopover.closeMenu();target.querySelector('dialog')?.close();}};
}};
