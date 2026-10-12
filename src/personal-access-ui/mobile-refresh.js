/* Remote phone presentation. Native desktop windows keep the incumbent layout. */
globalThis.WeftUiComponents.factories.mobileRefresh=(core,ui)=>({mountMobileRefresh(){
    if(globalThis.weftmateDesktop||!globalThis.matchMedia?.('(max-width:600px) and (pointer:coarse)')?.matches)return;
    document.body.classList.add('remote-phone');
    const rail=ui.byId('session-rail'),footer=ui.element('div','remote-drawer-footer'),search=ui.byId('search-entry'),creation=rail.querySelector('.rail-top');
    rail.querySelector('.rail-footer').before(footer);if(search)footer.append(search);if(creation)footer.append(creation);
    const create=ui.byId('new-session');create.setAttribute('aria-label','新建旁聊');create.replaceChildren(WeftIcons.create('compose',20));
    const versionRow=ui.byId('settings-host-version')?.closest('.settings-row');
    if(versionRow){const label=versionRow.querySelector('label'),help=versionRow.querySelector('p');if(label)label.textContent='电脑上的版本';if(help)help.textContent='当前连接电脑上的 WeftMate。';}
    const status=ui.element('small','remote-connection-copy');ui.byId('assistant-title').after(status);
    const paintConnection=ui.paintConnection;
    ui.paintConnection=(...args)=>{const result=paintConnection(...args);const view=core.connectionView();status.textContent=view.kind==='online'?'已连接':view.label;return result;};
    status.textContent=core.connectionView().kind==='online'?'已连接':core.connectionView().label;
    const tabs=ui.element('nav','remote-mobile-tabs');tabs.setAttribute('aria-label','手机主导航');tabs.setAttribute('role','tablist');
    const actions={chat:()=>core.selectMainChat(),activity:()=>ui.openActivity(),goals:()=>ui.openGoals(),library:()=>ui.openLibrary()};
    for(const [id,name,icon] of [['chat','聊天','chat'],['activity','动态','bell'],['goals','目标','approval'],['library','成果库','folder']]){
        const button=ui.element('button','remote-mobile-tab');button.type='button';button.id=`remote-tab-${id}`;button.dataset.tab=id;button.setAttribute('role','tab');button.setAttribute('aria-label',name);
        const panel=id==='chat'?ui.byId('conversation-pane'):document.querySelector(`.${id}-surface`);if(panel){panel.id ||= `remote-panel-${id}`;button.setAttribute('aria-controls',panel.id);}
        button.append(WeftIcons.create(icon,22),ui.element('span','',name));button.onclick=()=>{void actions[id]();};tabs.append(button);
    }
    ui.byId('assistant-view').querySelector('.assistant-main').append(tabs);
    tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...tabs.children],i=buttons.indexOf(document.activeElement),next=buttons[event.key==='Home'?0:event.key==='End'?3:(i+(event.key==='ArrowLeft'?-1:1)+4)%4];next.focus();next.click();});
    let restHeight=innerHeight;
    const sync=()=>{
        const name=document.body.classList.contains('activity-open')?'activity':document.body.classList.contains('goals-open')?'goals':document.body.classList.contains('library-open')?'library':'chat';
        const height=visualViewport?.height||innerHeight,editing=/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
        if(!editing)restHeight=height;
        tabs.hidden=ui.byId('assistant-view').hidden||editing&&height<restHeight-100||name==='chat'&&!core.inMainChat();
        for(const button of tabs.children){const selected=button.dataset.tab===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
    };
    new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
    new MutationObserver(sync).observe(ui.byId('assistant-view'),{attributes:true,attributeFilter:['hidden']});
    const selected=ui.paintSelectedSession;ui.paintSelectedSession=(...args)=>{const result=selected(...args);sync();return result;};
    visualViewport?.addEventListener('resize',sync);document.addEventListener('focusout',()=>requestAnimationFrame(sync));sync();
}});
