globalThis.WeftUiComponents.factories.goals=(core,ui)=>{
    let panel,entry,view,opened=false,timer;
    const chat=()=>ui.byId('conversation-pane');
    function close(){opened=false;if(panel)panel.hidden=true;chat().hidden=false;document.body.classList.remove('goals-open');entry?.setAttribute('aria-current','false');clearInterval(timer);timer=null;}
    async function open(){document.dispatchEvent(new CustomEvent('weftmate:fixed-page',{detail:'goals'}));core.show('assistant');opened=true;panel.hidden=false;chat().hidden=true;document.body.classList.add('goals-open');entry.setAttribute('aria-current','page');ui.closeRail();await core.readGoals();view.focus();clearInterval(timer);timer=setInterval(()=>{if(opened&&document.visibilityState==='visible')void core.readGoals();},6000);}
    const selected=ui.paintSelectedSession,reset=ui.resetIdentityControls;
    return {mountGoals(){
        const select=core.selectSession;core.selectSession=(...args)=>{close();return select(...args);};const main=core.selectMainChat;core.selectMainChat=(...args)=>{close();return main(...args);};
        entry=ui.element('button','rail-link goals-entry');entry.type='button';entry.append(WeftIcons.create('chart',16),ui.element('span','','目标'));entry.onclick=()=>void open();ui.fixedPageNavigation().append(entry);
        panel=ui.element('section','goals-surface');panel.hidden=true;panel.setAttribute('aria-label','目标');chat().after(panel);view=WeftGoalsView.mount({target:panel,core,openSource:target=>{close();return ui.openActivitySource(target,'open_chat');}});
        document.addEventListener('weftmate:fixed-page',event=>{if(event.detail!=='goals')close();});
    },openGoals:open,resetGoalsView:()=>view?.reset(),renderGoals(){if(entry)entry.hidden=core.state.personalCapabilities?.taskOverview!==1;if(opened)view?.render();},
    paintSelectedSession(...args){const result=selected(...args);if(opened)chat().hidden=true;return result;},
    resetIdentityControls(...args){close();core.resetGoals();return reset(...args);}};
};
