globalThis.WeftUiComponents.factories.search = (core,ui) => {
  let view;
  const reset=ui.resetIdentityControls;
  async function open(row) {
    if(row.type==='actions') {
      const actions={new:()=>core.startNewConversation(),temporary:()=>core.startNewConversation(false,true),project:()=>ui.editProject(),
        settings:()=>ui.openSettings('general'),memory:()=>core.openMemory(),activity:()=>ui.openActivity(),goals:()=>ui.openGoals(),library:()=>ui.openLibrary(),help:()=>ui.openHelp(),releases:()=>ui.openReleases(),shortcuts:()=>ui.openShortcuts(),
        start:async()=>{const owner=core.state.ownerId,generation=core.state.identityGeneration;await core.startNewConversation();if(owner!==core.state.ownerId||generation!==core.state.identityGeneration)return;ui.byId('message-text').value=row.query;ui.updateAvailability();ui.byId('message-text').focus();await core.sendDraft(row.query);}};
      return actions[row.id]?.();
    }
    if(row.type==='chats')return ui.openActivitySource(row.source,'open_chat');
    if(row.type==='projects'){await core.enterAssistant();WeftDesktop.toggleRail(false);const button=[...ui.byId('session-list').querySelectorAll('.sidebar-project')].find(node=>node.dataset.projectId===row.id)?.querySelector('.sidebar-project-toggle');button?.scrollIntoView({block:'nearest'});button?.focus();if(button?.getAttribute('aria-expanded')==='false')button.click();return;}
    if(row.type==='library'){await ui.openLibrary();return ui.openLibraryItem({...row,fileName:row.title});}
    if(row.type==='schedules'){await ui.openGoals();const tab=document.querySelector('.goals-surface [data-section="schedules"]');tab?.click();const node=[...document.querySelectorAll('.goals-surface .goals-row')].find(node=>node.dataset.goalKey===`${row.sessionId}/${row.id}`);node?.scrollIntoView({block:'center'});if(node){node.tabIndex=-1;node.focus();}return;}
    if(row.type==='memory'){await core.openMemory();return core.openMemoryDetail(row.kind,row.id);}
  }
  function menu(row,trigger){
    const entries=[{name:'打开',icon:'chat',action:()=>view.activate(row)}];
    if(row.type==='chats') {
      entries.push({name:'在侧栏中显示',icon:'sidebar',action:async()=>{core.closeSearch();await core.selectSession(row.sessionId);WeftDesktop.toggleRail(false);ui.byId('session-list').querySelector('.is-current')?.scrollIntoView({block:'nearest'});}});
      if(row.kind!=='main')entries.push({name:row.pinned?'取消置顶':'置顶',icon:'pin',checked:row.pinned,action:async()=>{await core.updateSession(row.sessionId,{pinned:!row.pinned});await core.readSearch();}},
        {name:row.archived?'恢复对话':'归档',icon:'archive',action:async()=>{await core.archiveSession(row.sessionId,!row.archived);await core.readSearch();}});
    }
    if(row.type==='projects'&&ui.canManageProjectFolders())entries.push({name:'项目设置',icon:'settings',action:()=>{core.closeSearch();ui.editProject(row);}});
    if(row.type==='library')entries.push({name:'打开来源对话',icon:'chat',action:async()=>{core.closeSearch();await core.openLibrarySource(row);}});
    if(row.type==='schedules')entries.push({name:row.paused?'恢复':'暂停',icon:'clock',action:async()=>{await core.manageSchedule(row,row.paused?'resume':'pause');await core.readSearch();}});
    WeftPopover.menu(trigger,entries,error=>ui.toast(core.failureMessage(error)));
  }
  return {mountSearch(){
    view=WeftSearchView.mount({core,open,menu,notice:ui.toast});
    const entry=ui.element('button','search-entry');entry.type='button';entry.id='search-entry';entry.setAttribute('aria-label','搜索');entry.setAttribute('aria-haspopup','dialog');entry.append(WeftIcons.create('search',16),ui.element('span','','搜索'),ui.element('kbd','','Ctrl K'));entry.onclick=()=>void core.openSearch();
    ui.byId('session-rail').prepend(entry);
    // Navigation stays in the existing conversation topbar; a second header pushes the composer off screen.
    const select=core.selectSession;core.selectSession=async(...args)=>{const result=await select(...args),row=core.state.sessions.find(row=>row.sessionId===core.state.selectedSessionId);if(row)core.rememberSearch({...row,type:'chats',id:row.chatId??row.sessionId});return result;};
    const main=core.selectMainChat;core.selectMainChat=async(...args)=>{const result=await main(...args);if(core.state.mainChat)core.rememberSearch({...core.state.mainChat,type:'chats',id:core.state.mainChat.chatId});return result;};
  },showSearch:()=>{if(window.matchMedia('(max-width:640px)').matches)ui.closeRail();view?.show();},hideSearch:()=>view?.hide(),renderSearch:()=>view?.render(),selectSearchRow:()=>view?.select(),openSearch:()=>core.openSearch(),
    canCreateSearchProject:()=>ui.canManageProjectFolders(),resetIdentityControls(...args){core.closeSearch();return reset(...args);}};
};
