globalThis.WeftUiComponents.factories.health=(core,ui)=>{
  let panel,entry,view,opened=false,timer;const chat=()=>ui.byId('conversation-pane');
  function close(){if(!opened)return;const was=opened;opened=false;if(panel)panel.hidden=true;chat().hidden=false;document.body.classList.remove('health-open');entry?.setAttribute('aria-current','false');clearInterval(timer);timer=null;if(was)ui.paintSelectedSession(core.state.selectedSessionId);}
  async function open(){if(opened){ui.closeRail();return;}document.dispatchEvent(new CustomEvent('weftmate:fixed-page',{detail:'health'}));core.show('assistant');opened=true;panel.hidden=false;chat().hidden=true;document.body.classList.add('health-open');entry.setAttribute('aria-current','page');ui.byId('assistant-title').textContent='健康';ui.closeRail();view.render();await core.readHealth();view.focus();clearInterval(timer);timer=setInterval(()=>{if(opened&&document.visibilityState==='visible'&&core.foreground())void core.readHealth();},core.polling.overview);}
  const selected=ui.paintSelectedSession,reset=ui.resetIdentityControls,timeline=ui.renderTimeline,closeFixed=ui.closeFixedPage;let signature;
  return {mountHealth(){
    const select=core.selectSession;core.selectSession=(...args)=>{close();return select(...args);};const main=core.selectMainChat;core.selectMainChat=(...args)=>{close();return main(...args);};
    entry=ui.element('button','rail-link health-entry');entry.type='button';entry.dataset.fixedPage='health';entry.append(WeftIcons.create('health',16),ui.element('span','','健康'));entry.onclick=()=>void open();const nav=ui.fixedPageNavigation();nav.insertBefore(entry,nav.querySelector('.goals-entry'));
    panel=ui.element('section','health-surface');panel.hidden=true;panel.setAttribute('aria-label','健康');chat().after(panel);view=WeftHealthView.mount({target:panel,core,toast:ui.toast});
    document.addEventListener('weftmate:fixed-page',event=>{if(event.detail!=='health')close();});
  },closeFixedPage(){close();closeFixed?.();},openHealth:open,healthNotice:ui.toast,renderHealth(){if(opened)view?.render();},
  quoteHealth(text){close();const draft=ui.readMessageDraft();ui.restoreMainChatDraft(`${draft?draft+'\n\n':''}${text}`);ui.byId('message-text').focus();},
  renderTimeline(...args){const result=timeline(...args),last=core.timelineEventsForContext?.().at(-1),next=JSON.stringify([last?.seq,last?.type]);if(opened&&signature!==next){signature=next;void core.readHealth();}return result;},
  paintSelectedSession(...args){const result=selected(...args);if(opened){chat().hidden=true;ui.byId('assistant-title').textContent='健康';}return result;},
  resetIdentityControls(...args){close();core.resetHealth();view?.reset();return reset(...args);}};
};
