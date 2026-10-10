globalThis.WeftUiComponents.factories.library=(core,ui)=>{
    let panel,view,entry,opened=false,sourceAnchor;
    function close(){const wasOpen=opened;sourceAnchor=null;opened=false;if(panel)panel.hidden=true;ui.byId('conversation-pane').hidden=false;document.body.classList.remove('library-open');entry?.setAttribute('aria-current','false');view?.deactivate();if(wasOpen)ui.paintSelectedSession(core.state.selectedSessionId);}
    async function open(){await core.enterAssistant();ui.closeFixedPage?.();opened=true;panel.hidden=false;ui.byId('conversation-pane').hidden=true;document.body.classList.add('library-open');entry.setAttribute('aria-current','page');ui.byId('assistant-title').textContent='成果库';ui.closeRail();await core.readLibrary();view.focus();}
    const timeline=ui.renderTimeline;let eventSignature;
    function focusSource(){if(!sourceAnchor)return;if(core.inMainChat?.()){ui.focusMainEvent?.(sourceAnchor.eventId);return;}
        const row=ui.byId('transcript').querySelector(`[data-seq="${sourceAnchor.seq}"]`);if(row){row.tabIndex=-1;row.scrollIntoView({block:'center'});row.focus();}}
    const selected=ui.paintSelectedSession,reset=ui.resetIdentityControls,availability=ui.updateAvailability;
    return {mountLibrary(){
        const select=core.selectSession;core.selectSession=(...args)=>{close();return select(...args);};
        const main=core.selectMainChat;core.selectMainChat=(...args)=>{close();return main(...args);};
        const activity=ui.openActivity;ui.openActivity=(...args)=>{close();return activity(...args);};
        document.addEventListener('weftmate:fixed-page',event=>{if(event.detail!=='library')close();});
        const nav=ui.fixedPageNavigation();nav.hidden=false;
        entry=ui.element('button','rail-link library-entry');entry.type='button';entry.dataset.fixedPage='library';entry.append(WeftIcons.create('folder',16),ui.element('span','','成果库'));entry.onclick=()=>{document.dispatchEvent(new CustomEvent('weftmate:fixed-page',{detail:'library'}));void open();};nav.append(entry);
        panel=ui.element('section','library-surface');panel.hidden=true;panel.setAttribute('aria-label','成果库');ui.byId('conversation-pane').after(panel);
        view=WeftLibraryView.mount({target:panel,core,desktop:!!globalThis.weftmateDesktop,openPreview:(item,trigger)=>WeftDesktop.openPreview(item.fileName,trigger,`library:${item.id}`).content,copyPath:text=>navigator.clipboard.writeText(text),notice:ui.toast});
    },openLibrary:open,renderLibrary(){if(opened)view?.render();},clearLibraryPreview(){WeftDesktop?.closePreview();},
    async openLibrarySource(source){close();WeftDesktop.closePreview();await ui.openActivitySource(source,'open_chat');
        await Promise.all([core.refreshConversationTasks(),core.refreshConversationApprovals(),core.refreshConversationQuestions()]);
        sourceAnchor=source;focusSource();},
    renderTimeline(...args){const active=document.activeElement,restore=sourceAnchor&&(active===document.body||active?.closest('[data-seq]')?.dataset.seq===String(sourceAnchor.seq));const result=timeline(...args),events=core.timelineEventsForContext?.()??[],next=JSON.stringify(events.filter(event=>event.type==='artifact.created').map(event=>event.seq??event.eventId));if(opened&&next!==eventSignature){eventSignature=next;void core.readLibrary();}if(restore)focusSource();return result;},
    paintSelectedSession(...args){const result=selected(...args);if(opened){ui.byId('conversation-pane').hidden=true;ui.byId('assistant-title').textContent='成果库';}return result;},
    updateAvailability(...args){const result=availability(...args);if(entry)entry.hidden=core.state.personalCapabilities?.library!==1;return result;},
    resetIdentityControls(...args){close();core.resetLibrary();return reset(...args);}};
};
