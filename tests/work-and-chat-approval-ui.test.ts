import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

test('MODE-1 pending work card remains actionable after visiting a conversation with no approvals',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<button id="other">打开另一段对话</button><button id="back">返回待处理对话</button><section id="approval-bar"></section><p id="model-hint"></p><textarea id="message-text"></textarea>');
    await page.evaluate(()=>{(globalThis as any).WeftUiComponents={factories:{}};});
    for(const file of ['icons.js','components/work-and-chat.js','components/approvals.js'])await page.addScriptTag({path:new URL('../src/personal-access-ui/'+file,import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
    await page.evaluate(()=>{
      const g:any=globalThis,row={approvalId:'approval-1',sessionId:'session-a',taskId:'task-1',status:'pending',intent:'work-switch',createdAt:'2026-10-14T00:00:00Z'};
      const state={selectedSessionId:'session-a',hostId:'computer-a',sessions:[],projects:[{projectId:'project-a',name:'合成文件夹'}],computers:[{hostId:'computer-a',name:'合成电脑',online:true}]};
      const decisions:any[]=[];
      const core:any={state,conversationApprovals:{entries:new Map([[row.approvalId,{row,authoritative:true}]]),operations:new Map()},conversationTasks:{entries:new Map()},
        approvalContext:()=>({ownerId:'synthetic-owner',sessionId:state.selectedSessionId}),approvalContextCurrent:()=>true,approvalSource:()=>true,approvalMarker:()=>null,
        currentFolderProject:()=>null,defaultFolderProject:()=>null,currentExecutionComputer:()=>state.hostId,workComputers:()=>state.computers,
        submitApproval:(_context:any,approval:any,outcome:string)=>{decisions.push({approvalId:approval.approvalId,outcome});core.conversationApprovals.entries.clear();ui.renderConversationApprovals();}};
      const ui:any={byId:(id:string)=>document.getElementById(id),element:(tag:string,cls='',text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;},renderTimeline(){}};
      Object.assign(ui,g.WeftUiComponents.factories.workAndChat(core,ui),g.WeftUiComponents.factories.approvals(core,ui));
      document.getElementById('other')!.onclick=()=>{state.selectedSessionId='session-b';ui.renderConversationApprovals();};
      document.getElementById('back')!.onclick=()=>{state.selectedSessionId='session-a';ui.renderConversationApprovals();};
      g.decisions=decisions;ui.renderConversationApprovals();
    });
    assert.equal(await page.locator('.work-switch-card').count(),1);
    await page.getByRole('button',{name:'打开另一段对话',exact:true}).click();assert.equal(await page.locator('.work-switch-card').count(),0);
    await page.getByRole('button',{name:'返回待处理对话',exact:true}).click();
    assert.equal(await page.locator('.work-switch-card').count(),1,'returning rebuilds the pending card');
    assert.equal(await page.getByRole('button',{name:'切换到工作',exact:true}).isEnabled(),true);
    await page.getByRole('button',{name:'先不用',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).decisions),[{approvalId:'approval-1',outcome:'rejected'}]);
    assert.equal(await page.locator('.work-switch-card').count(),0);
  }finally{await browser.close();}
});

test('composer work toolbar hides redundant local computer selector and collapses once a project is selected in an active conversation',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(`
      <aside id="session-rail"><div id="rail-brand-row"><div id="rail-brand-actions"></div></div><div class="rail-top"><button id="new-session"><span class="rail-new-label"></span></button><button class="search-entry"></button></div><a id="rail-memory"></a></aside>
      <main><header><h2 id="assistant-title"></h2></header><section id="chat-intro"><h1></h1></section><form id="message-form"><textarea id="message-text"></textarea><div class="composer-actions"><div id="approval-picker"></div><div id="model-picker"></div></div></form></main>
    `);
    await page.evaluate(()=>{(globalThis as any).WeftUiComponents={factories:{}};});
    for(const file of ['icons.js','components/work-and-chat.js'])await page.addScriptTag({path:new URL('../src/personal-access-ui/'+file,import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
    const inspect=async()=>page.evaluate(()=>{
      const fold=document.querySelector('.work-mode-fold') as HTMLElement;
      const buttons=[...document.querySelectorAll('.work-mode-toolbar button')] as HTMLButtonElement[];
      return {
        open:fold.classList.contains('is-open'),
        inert:fold.inert,
        computerHidden:buttons[0].hidden,
        folderHidden:buttons[1].hidden,
        folderLabel:buttons[1].dataset.label,
        hint:(document.querySelector('.work-mode-toolbar .work-mode-hint') as HTMLElement)?.textContent,
      };
    });
    await page.evaluate(()=>{
      const g:any=globalThis;
      const state:any={newConversation:false,hostId:'host-a',hostName:'DESKTOP-LOCAL',online:true,activeChatSource:'desktop',
        computers:[{hostId:'host-a',displayName:'DESKTOP-LOCAL',online:true}],
        project:{projectId:'p1',name:'红果',permission:'write',rootPath:'C:\\work\\hongguo'}};
      const core:any={state,supportsWorkModes:()=>true,currentConversationMode:()=>'work',
        currentFolderProject:()=>state.project,currentExecutionComputer:()=>state.hostId,
        workComputers:()=>state.computers,workHandoffs:()=>[]};
      const ui:any={byId:(id:string)=>document.getElementById(id),
        bindWorkspaceInfo(){}, updateAvailability(){}, paintSelectedSession(){},
        element:(tag:string,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;}};
      Object.assign(ui,g.WeftUiComponents.factories.workAndChat(core,ui));
      ui.mountWorkMode(); ui.paintWorkMode();
      g._state=state; g._paint=()=>ui.paintWorkMode();
    });
    // 1. Existing conversation with selected project & online computer -> collapsed
    assert.deepEqual(await inspect().then(r=>({open:r.open,inert:r.inert})),{open:false,inert:true});
    // 2. New work draft with single computer -> open, computer hidden, folder visible
    await page.evaluate(()=>{const g:any=globalThis;g._state.newConversation=true;g._state.project=null;g._paint();});
    let r=await inspect();
    assert.equal(r.open,true); assert.equal(r.inert,false); assert.equal(r.computerHidden,true); assert.equal(r.folderHidden,false); assert.equal(r.hint,'先选文件夹');
    // 3. New work draft with multiple computers -> open, computer visible
    await page.evaluate(()=>{const g:any=globalThis;g._state.computers.push({hostId:'host-b',displayName:'REMOTE-PC',online:true});g._paint();});
    r=await inspect();
    assert.equal(r.open,true); assert.equal(r.computerHidden,false); assert.equal(r.folderHidden,false);
    // 4. Existing conversation when computer goes offline -> opens to surface offline status, computer button stays hidden
    await page.evaluate(()=>{const g:any=globalThis;g._state.newConversation=false;g._state.project={projectId:'p1',name:'红果',permission:'write'};g._state.computers.forEach((c:any)=>c.online=false);g._paint();});
    r=await inspect();
    assert.equal(r.open,true); assert.equal(r.computerHidden,true); assert.equal(r.hint,'电脑不在线');
  }finally{await browser.close();}
});
