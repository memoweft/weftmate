globalThis.WeftUiComponents.factories.activity=(core,ui)=>{
    let panel,view,entry,opened=false,preparing=false;
    const chat=()=>ui.byId('conversation-pane');
    const badge=()=>{if(!entry)return;entry.hidden=core.state.personalCapabilities?.activity!==1;entry.setAttribute('aria-label',`动态${core.activity.unreadCount?`，${core.activity.unreadCount} 条未读`:''}`);entry.querySelector('.activity-count').textContent=core.activity.unreadCount?String(core.activity.unreadCount):'';};
    function close(){const wasOpen=opened;opened=false;if(panel)panel.hidden=true;chat().hidden=false;document.body.classList.remove('activity-open');entry?.setAttribute('aria-current','false');if(wasOpen)ui.paintSelectedSession(core.state.selectedSessionId);}
    async function open(id){document.dispatchEvent(new CustomEvent('weftmate:fixed-page',{detail:'activity'}));core.show('assistant');opened=true;panel.hidden=false;chat().hidden=true;document.body.classList.add('activity-open');entry.setAttribute('aria-current','page');ui.byId('assistant-title').textContent='动态';ui.closeRail();
        if(id){await core.setActivityFilter('all');while(opened&&!core.activity.items.some(row=>row.id===id)&&core.activity.nextCursor)await core.readActivity(true);
            const row=panel.querySelector(`[data-activity-id="${CSS.escape(id)}"]`);row?.scrollIntoView({block:'center'});row?.focus();
            const item=core.activity.items.find(row=>row.id===id);if(item&&!item.read)await core.markActivityRead(item);else if(!item)ui.toast('这条动态已经清理。');
        }else{await core.readActivity();panel.querySelector('h1').focus();}}
    const selected=ui.paintSelectedSession;
    const reset=ui.resetIdentityControls;
    return {mountActivity(){
        const select=core.selectSession;core.selectSession=(...args)=>{if(!preparing)close();return select(...args);};
        const selectMain=core.selectMainChat;core.selectMainChat=(...args)=>{if(!preparing)close();return selectMain(...args);};
        const nav=ui.fixedPageNavigation();nav.hidden=false;
        entry=ui.element('button','rail-link activity-entry');entry.type='button';entry.append(WeftIcons.create('bell',16),ui.element('span','','动态'),ui.element('span','activity-count'));entry.onclick=()=>void open();nav.append(entry);
        panel=ui.element('section','activity-surface');panel.hidden=true;panel.setAttribute('aria-label','动态');chat().after(panel);
        view=WeftActivityView.mount({target:panel,core});badge();
        document.addEventListener('weftmate:fixed-page',event=>{if(event.detail!=='activity')close();});
        document.addEventListener('weftmate:activity',event=>void open(event.detail));
    },closeFixedPage:close,openActivity:open,renderActivity(){badge();if(opened)view?.render();},renderActivityBadge:badge,activityVisible:()=>opened,
    async prepareActivityApproval(target){preparing=true;try{await core.selectSession(target.sessionId);}finally{preparing=false;}},
    async openActivitySource(target,kind){close();if(core.state.currentView!=='assistant')await core.enterAssistant();if(target.chatId&&core.readChat){const chat=(await core.readChat(target.chatId)).chat;if(chat.kind==='main')await core.selectMainChat(target.eventId);else await core.selectSession(target.sessionId??chat.activeSessionId);}else await core.selectSession(target.sessionId);
        if(!core.inMainChat?.()&&Number.isSafeInteger(target.seq)){while(core.state.hasOlder&&!core.state.historyEvents.has(target.seq))await core.loadOlderHistory();const row=ui.byId('transcript').querySelector(`[data-detail-seq="${target.seq}"], [data-seq="${target.seq}"]`);if(row){row.tabIndex=-1;row.scrollIntoView({block:'center'});row.focus();}}
        if(target.eventId&&core.inMainChat?.())ui.focusMainEvent?.(target.eventId);
        if(Number.isSafeInteger(target.seq)){const step=ui.byId('transcript').querySelector(`[data-detail-seq="${target.seq}"]`)??(target.stepId?[...ui.byId('transcript').querySelectorAll(`[data-step="${CSS.escape(target.stepId)}"]`)].find(node=>Number(node.dataset.detailSeq)>=target.seq):null);if(step){for(let node=step;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;step.scrollIntoView({block:'center'});step.querySelector('summary')?.focus();}}if(kind==='answer_question')ui.byId('question-bar')?.querySelector('input,button')?.focus();},
    openActivityMemory:()=>{close();return core.openMemory();},
    openActivitySettings:async()=>{close();await core.openAccount();ui.openSettings('about');},
    paintSelectedSession(...args){const result=selected(...args);if(opened){chat().hidden=true;ui.byId('assistant-title').textContent='动态';}return result;},
    resetIdentityControls(...args){close();core.resetActivity();return reset(...args);}};
};
