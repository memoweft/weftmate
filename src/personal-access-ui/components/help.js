globalThis.WeftUiComponents.factories.help=(core,ui)=>{
  let panel,view,opened=false,notice,kind;
  const chat=()=>ui.byId('conversation-pane');
  function close(){if(!opened)return;opened=false;view?.close();panel.hidden=true;chat().hidden=false;document.body.classList.remove('help-open');ui.paintSelectedSession(core.state.selectedSessionId);}
  function run(action){close();const actions={main:()=>core.selectMainChat(),temporary:()=>core.startNewConversation(false,true),memory:()=>core.openMemory(),goals:()=>ui.openGoals(),devices:()=>ui.openSettings('devices'),approvals:()=>ui.openSettings('approvals'),backups:()=>{if(globalThis.weftmateDesktop)ui.openSettings('backups');else{ui.openSettings('about');ui.toast('备份与恢复请在电脑的设置中打开。');}},about:()=>ui.openSettings('about')};return actions[action]?.();}
  function open(next='help'){document.dispatchEvent(new CustomEvent('weftmate:fixed-page',{detail:'help'}));core.show('assistant');kind=next;opened=true;panel.hidden=false;chat().hidden=true;document.body.classList.add('help-open');panel.dataset.title=next==='help'?'帮助与小技巧':'更新内容';ui.byId('assistant-title').textContent=panel.dataset.title;ui.closeRail();view?.close();view=WeftHelpView.mount({target:panel,core,kind:next,back:close,run});view.focus();}
  const selected=ui.paintSelectedSession,reset=ui.resetIdentityControls,screen=ui.paintScreen;
  return {mountHelp(){panel=ui.element('section','help-surface');panel.hidden=true;panel.setAttribute('aria-label','帮助与更新');chat().after(panel);
    for(const name of ['selectSession','selectMainChat','startNewConversation']){const old=core[name];core[name]=(...args)=>{close();return old(...args);};}
    document.addEventListener('weftmate:fixed-page',event=>{if(event.detail!=='help')close();});
    const learn=ui.element('button','button secondary small','了解更多');learn.type='button';learn.onclick=()=>open('help');ui.byId('chat-intro').append(learn);
    notice=WeftHelpView.notice({target:ui.byId('assistant-view'),core,open:()=>open('releases'),current:()=>core.state.currentView==='assistant'});
  },openHelp:()=>open('help'),openReleases:()=>open('releases'),openShortcuts:()=>WeftHelpView.shortcuts(),
  paintSelectedSession(...args){const result=selected(...args);if(opened){chat().hidden=true;ui.byId('assistant-title').textContent=kind==='help'?'帮助与小技巧':'更新内容';}void notice?.check();return result;},
  paintScreen(...args){if(!['assistant','account','memory'].includes(args[0]))close();const result=screen(...args);void notice?.check();return result;},
  resetIdentityControls(...args){close();notice?.reset();return reset(...args);}};
};
