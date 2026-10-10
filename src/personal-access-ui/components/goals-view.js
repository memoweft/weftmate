/* Shared desktop/mobile presentation. No independent task or timer state. */
globalThis.WeftGoalsView={mount({target,core,openSource}){
    const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
    const notice=el('p','goals-notice');notice.setAttribute('role','status');
    const button=(text,action)=>{const n=el('button','button secondary small',text);n.type='button';n.onclick=()=>Promise.resolve(action()).catch(error=>{notice.textContent=core.failureMessage(error);});return n;};
    const head=el('div','goals-heading'),title=el('h1','','目标');title.tabIndex=-1;head.append(title,button('刷新目标',()=>core.readGoals()));
    target.classList.add('goals-page');target.replaceChildren(head,el('p','muted','看看正在做的事，安排之后的事，持续推进想完成的目标。'),notice);
    const sections={};for(const [id,name]of [['tasks','进行中'],['schedules','定时任务'],['goals','长期目标']]){
        const section=el('section','goals-section'),header=el('div','goals-heading'),heading=el('h2','',name),list=el('div','goals-list');section.setAttribute('aria-label',name);header.append(heading);section.append(header,list);target.append(section);sections[id]={section,header,list};
    }
    const recent=el('details','goals-recent'),recentList=el('div','goals-list');recent.append(el('summary','','最近完成 · 保留 7 天'),recentList);sections.tasks.section.append(recent);
    let form=null,signature='';
    const stateNames={running:'进行中',queued:'排队中',approval:'等待审批',question:'等待回答',stopping:'正在停止',unconfirmed:'结果待确认',completed:'已完成',failed:'失败',stopped:'已停止',active:'进行中',paused:'已暂停',blocked:'需要处理',complete:'已完成'};
    function confirmDelete(text,action){
        const dialog=el('dialog','goals-confirm');dialog.setAttribute('aria-label',text);dialog.append(el('h2','',text),el('p','muted','删除后不会再按这个安排运行。已完成的对话记录会保留。'));
        const cancel=button('取消',()=>dialog.close()),remove=button('确认删除',async()=>{await action();dialog.close();});dialog.append(cancel,remove);target.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();cancel.focus();
    }
    function showForm(kind,row){
        form?.remove();form=el('form','goals-form');form.setAttribute('aria-label',kind==='schedule'?(row?'编辑定时任务':'新建定时任务'):'新建长期目标');
        const heading=el('h3','',form.getAttribute('aria-label'));form.append(heading);
        const field=(label,type,value)=>{const wrap=el('label','goals-field'),input=el(type==='select'?'select':type==='textarea'?'textarea':'input');if(input.tagName==='INPUT')input.type=type;input.setAttribute('aria-label',label);input.value=value??'';wrap.append(el('span','',label),input);form.append(wrap);return input;};
        const name=field(kind==='schedule'?'要做什么':'目标标题',kind==='schedule'?'textarea':'text',row?.text);name.required=true;name.maxLength=kind==='schedule'?32000:160;
        const session=field('所属对话','select');
        for(const item of core.goalsPage.sessions.filter(s=>s.taskAvailable!==false)){const opt=el('option','',item.kind==='main'?'WeftMate 主对话':item.temporary||item.hasTemporaryContent?'临时对话':item.title||'旁聊');opt.value=item.sessionId;session.append(opt);}
        session.value=row?.sessionId??core.state.selectedSessionId??session.options[0]?.value??'';session.required=true;session.disabled=!!row;
        if(!session.options.length)form.append(el('p','muted','先开始一个对话，再来关联安排或目标。'));
        let description,mode,repeat,date,time,weekday,monthday,interval;
        if(kind==='schedule'){
            mode=field('到点做什么','select');for(const [value,label]of [['reminder','提醒我'],['task','让助手执行']]){const opt=el('option','',label);opt.value=value;mode.append(opt);}mode.value=row?.kind??'reminder';
            repeat=field('重复','select');for(const [value,label]of [['once','一次性'],['daily','每天'],['weekly','每周'],['monthly','每月'],['interval','固定间隔']]){const opt=el('option','',label);opt.value=value;repeat.append(opt);}repeat.value=row?.repeat?.kind??'daily';
            const zone=row?.timeZone??core.goalsPage.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone;
            const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(row?.nextRunAt?new Date(row.nextRunAt):new Date(Date.now()+3600000)).map(p=>[p.type,p.value]));
            date=field('日期','date',`${parts.year}-${parts.month}-${parts.day}`);time=field('时间','time',row?.repeat?.time.slice(0,5)??`${parts.hour}:${parts.minute}`);time.required=true;
            weekday=field('星期','select');for(const [index,label]of ['日','一','二','三','四','五','六'].entries()){const opt=el('option','',`星期${label}`);opt.value=String(index);weekday.append(opt);}weekday.value=String(row?.repeat?.weekday??1);
            monthday=field('每月几日','number',row?.repeat?.day??1);monthday.min='1';monthday.max='31';interval=field('间隔秒数（至少 300 秒）','number',row?.repeat?.seconds??300);interval.min='300';interval.step='1';
            const toggle=()=>{date.parentElement.hidden=repeat.value!=='once';date.required=repeat.value==='once';weekday.parentElement.hidden=repeat.value!=='weekly';monthday.parentElement.hidden=repeat.value!=='monthly';interval.parentElement.hidden=repeat.value!=='interval';time.parentElement.hidden=repeat.value==='interval';time.required=repeat.value!=='interval';};repeat.onchange=toggle;toggle();
            form.append(el('p','muted',`时间按 ${zone} 安排；每月不存在的日期会跳过，电脑离线时恢复后补送。`));
        }else{description=field('目标说明','textarea');description.maxLength=32000;form.append(el('p','muted','目标关联到一个对话；每个对话同时保留一个目标。执行进展与结果在原对话查看。'));}
        const actions=el('div','goals-actions'),cancel=button('取消',()=>{form?.remove();form=null;}),submit=el('button','button primary','保存');submit.type='submit';actions.append(cancel,submit);form.append(actions);
        let requestId=crypto.randomUUID(),originalBody;
        form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;
            try{const body={requestId,sessionId:session.value};if(kind==='schedule'){Object.assign(body,{text:name.value,kind:mode.value,...(row?{expectedRevision:row.revision}:{})});const value=time.value.length===5?`${time.value}:00`:time.value;if(repeat.value==='interval')body.repeat={kind:'interval',seconds:Number(interval.value)};else if(repeat.value==='once')body.at={date:date.value,time:value};else body.repeat={kind:repeat.value,time:value,...(repeat.value==='weekly'?{weekday:Number(weekday.value)}:repeat.value==='monthly'?{day:Number(monthday.value)}:{})};}
                else Object.assign(body,{title:name.value,description:description.value});
                // A retry after an uncertain write keeps the exact intent and ID.
                if(originalBody&&JSON.stringify(body)!==originalBody){notice.textContent='先重试确认上次保存结果，再修改内容。';return;}originalBody=JSON.stringify(body);
                const result=kind==='schedule'?await core.saveGoalSchedule(body,row):await core.saveLongGoal(body);if(result){form?.remove();form=null;notice.textContent='已保存。';}
            }catch(error){if(['SOURCE_UNAVAILABLE','SESSION_UNAVAILABLE'].includes(error.code)){form?.remove();form=null;notice.textContent='关联内容已清理，请重新新建。';return;}if(error.status&&error.status<500){originalBody=null;requestId=crypto.randomUUID();}notice.textContent=error.code==='GOAL_ALREADY_EXISTS'?'这个对话已有目标，请完成或归档后再新建。':error.status===409?'内容已变化，请刷新后再试。':`${core.failureMessage(error)} 可用原内容重试确认。`;}
            finally{submit.disabled=false;}
        };
        sections[kind==='schedule'?'schedules':'goals'].header.after(form);name.focus();
    }
    const newSchedule=button('新建定时任务',()=>showForm('schedule')),newGoal=button('新建长期目标',()=>showForm('goal'));sections.schedules.header.append(newSchedule);sections.goals.header.append(newGoal);
    const open=row=>openSource(row.source??{sessionId:row.sessionId});
    function taskRow(row){const item=el('article','goals-row');item.setAttribute('aria-label',row.title);item.append(el('h3','',row.title),el('p','goals-meta',`${row.conversationTitle} · ${stateNames[row.status]??'处理中'} · ${row.startedAt?'已运行':'已等待'} ${Math.floor(row.elapsedSeconds/60)} 分 ${row.elapsedSeconds%60} 秒`),el('p','',row.step));
        const actions=el('div','goals-actions');actions.append(button('打开对话与步骤',()=>open(row)));if(row.canStop){const stop=button('停止',()=>core.stopOverviewTask(row));stop.disabled=core.goalsPage.busy.has(row.taskId);actions.append(stop);}item.append(actions);return item;}
    function render(){
        const model=core.goalsPage;newSchedule.disabled=model.loading||core.state.personalCapabilities?.scheduleEditing!==1;newGoal.disabled=model.loading||core.state.personalCapabilities?.goals!==1;const next=JSON.stringify([model.loading,model.tasks,model.recent,model.schedules,model.goals,model.errors,[...model.busy]]);if(signature===next)return;signature=next;
        const focused=document.activeElement,focusedLabel=focused?.textContent,focusedRow=focused?.closest('article')?.getAttribute('aria-label');
        for(const [key,{list}]of Object.entries(sections)){list.replaceChildren();if(model.errors[key]){const error=el('p','muted',model.errors[key]);error.setAttribute('role','alert');list.append(error);continue;}
            const rows=key==='tasks'?model.tasks:model[key];if(!rows.length)list.append(el('p','goals-empty',model.loading?'正在读取…':{tasks:'现在没有进行中的任务。',schedules:'还没有安排。可在这里新建，也可以在对话里说“每天早上 8 点提醒我喝水”。',goals:'还没有长期目标。把想持续推进的事关联到一个对话。'}[key]));
            for(const row of rows){if(key==='tasks'){list.append(taskRow(row));continue;}const item=el('article','goals-row'),actions=el('div','goals-actions');item.setAttribute('aria-label',row.title??row.text);item.append(el('h3','',row.title??row.text));
                if(key==='schedules'){item.append(el('p','goals-meta',core.scheduleDescription(row)),el('p','muted',row.lastRunAt?`上次 ${new Date(row.lastRunAt).toLocaleString('zh-CN',{timeZone:row.timeZone})} · ${{delivered:'提醒已送达',queued:'等待执行',completed:'已完成',failed:'失败',stopped:'已停止'}[row.lastResult?.state]??'打开对话查看结果'}`:'尚未运行'));
                    actions.append(button(row.temporary?'在对话里编辑':'编辑',()=>row.temporary?open(row):showForm('schedule',row)));if(row.state!=='completed')actions.append(button(row.state==='paused'?'恢复':'暂停',async()=>{await core.manageSchedule(row,row.state==='paused'?'resume':'pause');await core.readGoals();}));
                    actions.append(button('立即运行',async()=>{await core.manageSchedule(row,'run');await core.readGoals();}),button('删除',()=>confirmDelete('删除这个定时任务？',async()=>{await core.manageSchedule(row,'delete');await core.readGoals();})));
                }else{item.append(el('p','',row.description),el('p','goals-meta',`${row.conversationTitle??'所属对话'} · ${stateNames[row.phase]??'处理中'} · ${row.progress}${row.scheduleIds?.length?` · 同一对话的 ${row.scheduleIds.length} 个定时任务`:''}`));if(row.phase!=='complete')actions.append(button('完成目标',()=>core.manageLongGoal(row,'complete',crypto.randomUUID())));actions.append(button('归档目标',()=>core.manageLongGoal(row,'archive',crypto.randomUUID())));}
                actions.append(button('打开所属对话',()=>open(row)));item.append(actions);list.append(item);
            }
        }
        recentList.replaceChildren(...model.recent.map(taskRow));if(!model.recent.length)recentList.append(el('p','goals-empty','最近 7 天还没有完成的任务。'));
        if(focusedRow){const article=[...target.querySelectorAll('article')].find(n=>n.getAttribute('aria-label')===focusedRow);[...article?.querySelectorAll('button')??[]].find(n=>n.textContent===focusedLabel)?.focus();}
    }
    return {render,reset(){form?.remove();form=null;signature='';notice.textContent='';render();},focus:()=>title.focus()};
}};
