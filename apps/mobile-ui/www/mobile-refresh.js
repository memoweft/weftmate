/* Phone presentation only; all navigation and settings actions remain existing. */
(() => {
  const drawer=$('drawer'),primary=el('div','drawer-primary'),main=drawer.querySelector('.rail-main-chat');
  drawer.querySelector('.drawer-brand').after(primary);
  if(main)primary.append(main);
  for(const [id,name,icon] of [['activity','动态','bell'],['health','健康','health'],['goals','目标','goal'],['library','成果库','folder']]){
    const button=el('button','',name);button.type='button';button.dataset.mobilePage=id;button.prepend(WeftIcons.create(icon,20));
    button.onclick=()=>{closeDrawer();void selectMobileTab(id);};primary.append(button);
  }
  const footer=el('div','drawer-footer'),creation=drawer.querySelector('.drawer-new-group'),search=$('mobile-search-entry');
  drawer.querySelector('.profile-link').before(footer);if(search)footer.append(search);if(creation)footer.append(creation);
  document.addEventListener('DOMContentLoaded',()=>{if($('mobile-search-entry'))footer.prepend($('mobile-search-entry'));});
  const scroll=el('div','drawer-scroll');drawer.querySelector('.drawer-brand').after(scroll);
  for(const child of [...drawer.children])if(child!==scroll&&!child.classList.contains('drawer-brand')&&child!==footer&&child!==$('profile-link')&&child!==$('cloud-device-banner'))scroll.append(child);
  const create=creation?.querySelector('[data-action="new-chat"]');
  if(create){create.setAttribute('aria-label','新建旁聊');create.replaceChildren(WeftIcons.create('compose',20));}
  const originalSync=syncMobileTabs;
  syncMobileTabs=function(){originalSync();for(const button of primary.querySelectorAll('button')){
    const active=button===main?state.page==='chat'&&(!state.logicalChats||uiCore.inMainChat()):state.page===button.dataset.mobilePage;
    button.classList.toggle('current',active);button.setAttribute('aria-current',active?'page':'false');
  }};
  syncMobileTabs();
  // Decorate the existing modal family once, without replacing its close/confirm actions.
  function decorate(dialog){
    if(dialog.classList.contains('mobile-sheet')||dialog.classList.contains('is-phone')||dialog.classList.contains('phone-file-page')||!dialog.querySelector('h2'))return;
    dialog.classList.add('mobile-sheet');
    const close=el('button','mobile-sheet-close');close.type='button';close.setAttribute('aria-label','关闭面板');close.append(WeftIcons.create('close',20));
    close.replaceChildren(el('span','icon icon-close'));close.onclick=()=>dialog.close();dialog.append(close);
  }
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){
    if(node.nodeType!==1)continue;if(node.matches('dialog'))decorate(node);for(const dialog of node.querySelectorAll('dialog'))decorate(dialog);
  }}).observe(document.body,{childList:true,subtree:true});
})();
