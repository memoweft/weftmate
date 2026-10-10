import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../www/',import.meta.url));
const evidence=fileURLToPath(new URL(process.env.WEFTMATE_APPROVAL_EVIDENCE==='1'?
  '../../../tests/evidence/ui-2a/':'../../../.local/ui-2a/',import.meta.url));
const approval={approvalId:'12345678-1234-4234-8234-123456789abc',sessionId:'s1',taskId:'cmd-demo',
  sourceCommandId:'cmd-demo',sourceReceiptId:'rpc:demo.1',turn:1,callId:'call:demo.1',rootCallId:'root:demo.1',
  toolName:'weftmod_script',reason:'运行整理脚本，删除临时目录中的三个合成文件。',riskCategories:['execute','delete'],
  createdAt:'2026-10-08T01:00:00.000Z',status:'pending'};

test('UI-2a 390×844 modes, risk confirmation, settings and three approval decisions',async()=>{
  const server=createServer(async(req,res)=>{try{
    const path=resolve(root,`.${new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname}`);
    if(!path.startsWith(root)){res.writeHead(404).end();return}
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
    res.setHeader('Content-Type',`${mime[extname(path)]||'application/octet-stream'}; charset=utf-8`);res.end(await readFile(path));
  }catch{res.writeHead(404).end()}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));await mkdir(evidence,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const screenshot=async name=>{await page.evaluate(()=>Promise.allSettled(document.getAnimations().map(animation=>animation.finished)));
    await page.screenshot({path:resolve(evidence,name)})};
  try{
    await page.addInitScript(({approval})=>{
      const sessionModes={s1:'auto',s2:'ask'},requests=[];
      window.fixture={sessionModes,defaultMode:'auto',requests,approval:null,history:[],failModeWrite:false};
      window.weftNative={postMessage(json){const request=JSON.parse(json);requests.push(request);let result={},error;
        const {method,params}=request,f=window.fixture;
        if(method==='app.bootstrap')result={loggedIn:false,username:'',owner:'',model:null,busy:false};
        if(method==='settings.appearance')result={value:'light'};
        if(method==='auth.me')result={displayName:'合成测试账户'};
        if(method==='attachments.list')result={attachments:[]};
        if(method==='models.host')result={models:[{profileId:'synthetic',displayName:'合成模型',configured:true}]};
        if(method==='host.business'){
          const defaults=params.path==='/personal/v1/settings/approvals',session=/\/sessions\/([^/]+)\/approval-mode$/.exec(params.path)?.[1];
          if(defaults||session){if(params.method==='PATCH'){
            if(f.failModeWrite)error='HOST_UNAVAILABLE';else if(defaults)f.defaultMode=params.body.mode;else f.sessionModes[session]=params.body.mode}
            result={mode:defaults?f.defaultMode:f.sessionModes[session],allowedCategories:[]}}
          else if(params.path==='/personal/v1/system')result={host:{state:'ready'},model:{state:'ready'},memory:{state:'disabled'},canRestart:false};
        }
        if(method==='shared.approvals.list'){result={approvals:f.approval?[{...f.approval}]:[],nextBefore:null,hasMore:false};if(f.holdApprovalList){f.releaseApprovalList=()=>window.weftNative.onmessage({data:JSON.stringify({id:request.id,ok:true,result})});return}}
        if(method==='shared.approvals.decide'){
          f.approval={...f.approval,status:'answered',decisionOutcome:params.outcome,decisionRequestId:params.requestId,
            ...(params.scope?{decisionScope:params.scope}:{}),answeredAt:'2026-10-08T01:01:00.000Z'};
          result={approval:f.approval,requestId:params.requestId};
          if(f.holdDecision){f.releaseDecision=()=>window.weftNative.onmessage({data:JSON.stringify({id:request.id,ok:true,result})});return}
        }
        if(method==='shared.questions.list')result={questions:[],nextBefore:null,hasMore:false};
        if(method==='shared.tasks.detail')result={taskId:'cmd-demo',sessionId:'s1',source:{commandId:'cmd-demo',kind:'session.message',
          sessionId:'s1',receiptId:'rpc:demo.1'},artifacts:[],control:{state:'active',canStop:false,canSupplement:false}};
        if(method==='shared.sessions.events')result={source:'host',sessionId:params.sessionId,events:f.history,nextSeq:f.history.at(-1)?.seq??-1,hasMore:false,...(f.live?{liveSeq:++f.liveTick,liveEvents:[{seq:2,type:'assistant.live',data:{text:'中文流式正文。'.repeat(f.liveTick),streaming:true,cursor:f.liveTick}}]}:{})};
        if(method==='shared.sessions.list')result={source:'host',hostAvailable:true,sessions:[{sessionId:'s1',title:'整理临时文件',sendAvailable:true,source:'host'},
          {sessionId:'s2',title:'另一个合成对话',sendAvailable:true,source:'host'}]};
        if(method==='shared.outbox.list')result={source:'host',commands:[]};
        if(method==='shared.activity.list')result={activities:[]};
        setTimeout(()=>window.weftNative.onmessage({data:JSON.stringify({id:request.id,ok:!error,result,...(error?{error:{code:error}}:{})})}),0);
      }};
      window.fixture.resetApproval=()=>{window.fixture.approval={...approval}};
    },{approval});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>state.booted);
    const seed=async(sessionId='s1')=>{await page.evaluate(id=>{
      stopSharedPoll();state.loggedIn=true;state.owner='synthetic-ui2a';state.deviceId='phone-synthetic';state.chatSource='host';
      state.sharedSessionId=id;state.conversationId=null;state.generation++;state.sharedHostAvailable=true;
      state.sharedSessions=[{sessionId:id,title:'整理临时文件',sendAvailable:true,source:'host'}];state.sharedEvents=[];
      page('chat');renderSharedConversation();closeToast();
    },sessionId);await page.evaluate(()=>uiCore.retryConnection());};
    const label=page.locator('#approval-mode-label'),menu=page.locator('#approval-mode-popover');
    await seed();await page.waitForFunction(()=>document.getElementById('approval-mode-label').textContent==='自动');
    await page.locator('#approval-mode-button').click();await page.waitForFunction(()=>!approvalModeState.loading);
    assert.equal(await menu.locator('[role="menuitemradio"]').count(),5);
    assert.equal(await menu.locator('[aria-checked="true"]').getAttribute('data-mode'),'auto');
    await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.mode),'ask');
    await page.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'approval-mode-button');
    await page.locator('#approval-mode-button').click();await page.waitForFunction(()=>!approvalModeState.loading);
    await screenshot('01-mode-menu.png');
    await menu.locator('[data-mode="allow-all"]').click();assert.equal(await page.locator('#approval-risk-dialog').isVisible(),true);
    assert.match(await page.locator('#approval-risk-dialog').innerText(),/删除或覆盖文件.*修改系统.*安装软件.*发送或发布.*付款.*无法撤销/s);
    assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.params.method==='PATCH').length),0);
    await screenshot('02-allow-all-risk.png');
    await page.locator('#approval-risk-cancel').click();assert.equal(await label.innerText(),'自动');
    await page.locator('#approval-mode-button').click();await page.waitForFunction(()=>!approvalModeState.loading);
    await menu.locator('[data-mode="allow-all"]').click();await page.locator('#approval-risk-confirm').click();
    await page.waitForFunction(()=>document.getElementById('approval-mode-label').textContent==='全部允许');
    // All five values travel through the contract, and switching conversations reads their own modes.
    for(const [mode,text] of [['ask','每次询问'],['accept-edits','接受修改'],['plan','先出计划'],['auto','自动']]){
      await page.locator('#approval-mode-button').click();await page.waitForFunction(()=>!approvalModeState.loading);
      await menu.locator(`[data-mode="${mode}"]`).click();await page.waitForFunction(value=>document.getElementById('approval-mode-label').textContent===value,text);
      assert.equal(await label.innerText(),text);
    }
    await seed('s2');await page.waitForFunction(()=>document.getElementById('approval-mode-label').textContent==='每次询问');
    await seed('s1');await page.waitForFunction(()=>document.getElementById('approval-mode-label').textContent==='自动');
    await page.locator('#approval-mode-button').click();await page.waitForFunction(()=>!approvalModeState.loading);
    await page.evaluate(()=>fixture.failModeWrite=true);await menu.locator('[data-mode="ask"]').click();
    await page.waitForFunction(()=>!approvalModeState.loading);assert.equal(await page.evaluate(()=>fixture.sessionModes.s1),'auto');
    assert.equal(await label.innerText(),'审批');await page.evaluate(()=>fixture.failModeWrite=false);
    await page.evaluate(()=>page('settings'));await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/^审批 /}).click();const defaults=page.getByRole('button',{name:'设置默认审批模式'});
    await defaults.click();await page.waitForFunction(()=>!approvalModeState.loading);
    await menu.locator('[data-mode="allow-all"]').click();assert.match(await page.locator('#approval-risk-scope').innerText(),/默认模式.*已有对话保持原模式/);
    await page.locator('#approval-risk-cancel').click();await defaults.click();await page.waitForFunction(()=>!approvalModeState.loading);
    await menu.locator('[data-mode="plan"]').click();await page.waitForFunction(()=>fixture.defaultMode==='plan'&&!approvalModeState.loading);
    assert.equal(await page.evaluate(()=>fixture.sessionModes.s1),'auto');
    await page.getByRole('button',{name:'默认审批模式 · 先出计划'}).click();await page.waitForFunction(()=>!approvalModeState.loading);
    assert.equal(await menu.locator('[aria-checked="true"]').getAttribute('data-mode'),'plan');await page.keyboard.press('Escape');
    await page.evaluate(()=>page('chat'));await seed();
    // STREAM-1b: twelve real scheduled reads must preserve menu, risk dialog and IME.
    await page.evaluate(()=>{fixture.live=true;fixture.liveTick=0;fixture.history=[{seq:0,type:'user.message',data:{text:'请持续回复'}},{seq:1,type:'turn.started',data:{}}];state.sharedEvents=fixture.history;state.sharedNextSeq=1;state.sharedRunning=true;uiCore.state.personalCapabilities={replyStreaming:1};renderSharedConversation();scheduleSharedPoll();});
    await page.locator('#approval-mode-button').click();await page.waitForFunction(()=>!approvalModeState.loading);
    const unchangedOption=await menu.locator('[data-mode="allow-all"]').elementHandle();
    await page.waitForTimeout(3100);assert.equal(await menu.isVisible(),true);
    assert.equal(await unchangedOption.evaluate(node=>node.isConnected&&node===document.querySelector('#approval-mode-popover [data-mode="allow-all"]')),true);
    assert.ok(await page.evaluate(()=>fixture.liveTick)>=10,'at least ten live reads');
    await menu.locator('[data-mode="allow-all"]').click();await page.waitForTimeout(3100);
    assert.equal(await page.locator('#approval-risk-cancel').isVisible(),true);await page.locator('#approval-risk-cancel').click();
    await page.locator('#draft').fill('整理资料');await page.locator('#draft').focus();
    const cdp=await page.context().newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'中文输入',selectionStart:4,selectionEnd:4});
    const composing=await page.locator('#draft').evaluate(node=>({value:node.value,start:node.selectionStart,end:node.selectionEnd}));
    await page.waitForTimeout(3100);assert.deepEqual(await page.locator('#draft').evaluate(node=>({value:node.value,start:node.selectionStart,end:node.selectionEnd})),composing);
    assert.equal(await page.locator('#draft').evaluate(node=>node===document.activeElement),true);
    await cdp.send('Input.insertText',{text:'中文输入'});await cdp.detach();
    await page.evaluate(()=>{stopSharedPoll();fixture.live=false;fixture.history=[];state.sharedEvents=[];state.sharedNextSeq=-1;state.sharedRunning=false;$('draft').value='';});
    const showApproval=async()=>{await page.waitForFunction(()=>!state.sharedLoading);await page.evaluate(()=>{
      stopSharedPoll();
      fixture.resetApproval();resetToolApprovals();conversationTasks.entries.clear();
      fixture.history=[{seq:0,type:'user.message',data:{text:'请整理临时文件，运行前让我确认。',receiptId:'rpc:demo.1'}},
        {seq:1,type:'assistant.message',data:{text:'整理脚本已准备好。先确认这次操作的影响范围。'}}];
      state.sharedEvents=fixture.history;renderSharedConversation();
    });await page.evaluate(()=>refreshToolApprovals());await page.evaluate(()=>{$('chat-scroll').scrollTop=0;closeToast()})};
    await showApproval();const card=page.getByRole('region',{name:'待批准操作'});
    await card.getByText('详情',{exact:true}).click();
    assert.match(await card.innerText(),/风险类别：执行脚本、删除文件.*可能无法撤销/s);
    await page.evaluate(()=>Promise.allSettled(document.getAnimations().map(animation=>animation.finished)));
    for(const button of await card.locator('.approval-actions button').all()){const box=await button.boundingBox();assert.ok(box.height>=43.99,JSON.stringify(box))}
    await screenshot('03-three-buttons.png');
    // A same-conversation refresh changes the captured view scope, not the pending native approval.
    await page.evaluate(()=>{state.generation++;renderConversationApprovals();});
    await card.getByRole('button',{name:'批准',exact:true}).click();await page.waitForFunction(()=>fixture.approval.status==='answered');
    await card.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>approvalRecord([...toolApprovals.sessions.get('s1').rows.values()][0])),'已允许 · 运行脚本');
    assert.equal(await card.isVisible(),false);await screenshot('04-resolved-line.png');
    assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.method==='shared.approvals.decide').at(-1).params.scope),'once');
    await showApproval();await card.getByText('详情',{exact:true}).click();await card.getByRole('button',{name:'总是允许此类',exact:true}).click();
    await card.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>approvalRecord([...toolApprovals.sessions.get('s1').rows.values()][0])),'已总是允许此类 · 运行脚本');
    assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.method==='shared.approvals.decide').at(-1).params.scope),'conversation-category');
    await showApproval();await card.getByRole('button',{name:'拒绝',exact:true}).click();
    await card.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>approvalRecord([...toolApprovals.sessions.get('s1').rows.values()][0])),'已拒绝 · 运行脚本');
    assert.equal(await page.evaluate(()=>Object.hasOwn(fixture.requests.filter(r=>r.method==='shared.approvals.decide').at(-1).params,'scope')),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
    await page.evaluate(()=>applyTheme('dark'));await showApproval();await screenshot('05-dark-approval.png');
    // Controlled recovery read arrives between press and release; no timing lottery.
    await showApproval();
    await page.evaluate(()=>{fixture.requests.length=0;fixture.holdApprovalList=true;fixture.approval={...fixture.approval,reason:fixture.approval.reason+' 已核对来源。'};globalThis.raceRead=refreshToolApprovals(undefined,{force:true})});
    await page.waitForFunction(()=>!!fixture.releaseApprovalList);
    const approve=card.getByRole('button',{name:'批准',exact:true}),box=await approve.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.evaluate(async()=>{fixture.holdApprovalList=false;fixture.releaseApprovalList();await raceRead});
    await page.mouse.up();
    await page.waitForFunction(()=>fixture.approval.status==='answered',{},{timeout:2000});
    assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.method==='shared.approvals.decide').length),1);
    await card.waitFor({state:'hidden'});await page.waitForFunction(()=>uiCore.conversationApprovals.operations.size===0);
    // Unchanged data keeps the controls; an old pending read cannot resurrect a decision.
    await showApproval();
    await page.evaluate(async()=>{globalThis.originalApprovalButton=document.querySelector('[data-approval-choice="allowed-once"]');
      await refreshToolApprovals(undefined,{force:true});if(originalApprovalButton!==document.querySelector('[data-approval-choice="allowed-once"]'))throw Error('unchanged approval replaced');
      fixture.requests.length=0;fixture.holdApprovalList=true;fixture.holdDecision=true;globalThis.staleRead=refreshToolApprovals(undefined,{force:true});});
    await page.waitForFunction(()=>!!fixture.releaseApprovalList);
    await card.getByRole('button',{name:'批准',exact:true}).click();
    await page.waitForFunction(()=>!!fixture.releaseDecision);
    assert.equal(await page.evaluate(()=>originalApprovalButton.isConnected&&originalApprovalButton.disabled),true);
    await page.evaluate(()=>{fixture.holdApprovalList=false;fixture.holdDecision=false;fixture.releaseDecision()});
    await page.waitForFunction(()=>uiCore.conversationApprovals.entries.get(fixture.approval.approvalId)?.row.status==='answered');
    await page.evaluate(async()=>{fixture.releaseApprovalList();await staleRead});
    assert.equal(await page.evaluate(()=>uiCore.conversationApprovals.entries.get(fixture.approval.approvalId).row.status),'answered');
    assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.method==='shared.approvals.decide').length),1);
    assert.deepEqual(errors,[]);
  }catch(error){console.log('approval-state',await page.evaluate(()=>({owner:state.owner,page:state.page,generation:state.generation,history:uiCore.state.historyGeneration,connection:uiCore.connectionView(),approval:fixture.approval,requests:fixture.requests.slice(-8).map(r=>({method:r.method,path:r.params?.path})),toast:document.getElementById('toast')?.textContent})));throw error;}finally{await browser.close();await new Promise(done=>server.close(done))}
});
