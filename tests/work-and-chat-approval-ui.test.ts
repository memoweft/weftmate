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
