import test from 'node:test';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../../../../apps/mobile-ui/www/',import.meta.url));
const evidence=resolve('.local/fx20-before');
const approval={approvalId:'12345678-1234-4234-8234-123456789abc',sessionId:'s1',taskId:'cmd-demo',
  sourceCommandId:'cmd-demo',sourceReceiptId:'rpc:demo.1',turn:1,callId:'call:demo.1',rootCallId:'root:demo.1',
  toolName:'weftmod_script',reason:'运行整理脚本，删除临时目录中的三个合成文件。',riskCategories:['execute','delete'],
  createdAt:'2026-10-08T01:00:00.000Z',status:'pending'};

test('UI-2a 390×844 modes, risk confirmation, settings and three approval decisions',async()=>{
  const server=createServer(async(req,res)=>{try{
    const path=resolve(root,`.${new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname}`);
    if(!path.startsWith(root)){res.writeHead(404).end();return}
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
    res.setHeader('Content-Type',`${mime[extname(path)]||'application/octet-stream'}; charset=utf-8`);res.end(path.endsWith('/decisions.js')||path.endsWith('components\\decisions.js')||path.endsWith('components\\question-bar.js') ? execFileSync('git',['show','8df312ccb25215276287fafdbfd8caa9aa7492d1:apps/mobile-ui/www/components/'+path.split(/[\\/]/).at(-1)]) : await readFile(path));
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
        if(method==='shared.sessions.events')result={source:'host',sessionId:params.sessionId,events:f.history,nextSeq:f.history.at(-1)?.seq??-1,hasMore:false};
        if(method==='shared.sessions.list')result={source:'host',hostAvailable:true,sessions:[{sessionId:'s1',title:'整理临时文件',sendAvailable:true,source:'host'},
          {sessionId:'s2',title:'另一个合成对话',sendAvailable:true,source:'host'}]};
        if(method==='shared.outbox.list')result={source:'host',commands:[]};
        if(method==='shared.activity.list')result={activities:[]};
        setTimeout(()=>window.weftNative.onmessage({data:JSON.stringify({id:request.id,ok:!error,result,...(error?{error:{code:error}}:{})})}),0);
      }};
      window.fixture.resetApproval=()=>{window.fixture.approval={...approval}};
    },{approval});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>state.booted);
    const seed=async(sessionId='s1')=>page.evaluate(id=>{
      stopSharedPoll();state.loggedIn=true;state.owner='synthetic-ui2a';state.deviceId='phone-synthetic';state.chatSource='host';
      state.sharedSessionId=id;state.conversationId=null;state.generation++;state.sharedHostAvailable=true;
      state.sharedSessions=[{sessionId:id,title:'整理临时文件',sendAvailable:true,source:'host'}];state.sharedEvents=[];
      page('chat');renderSharedConversation();closeToast();
    },sessionId);
    await seed();
    const showApproval=async()=>{await page.waitForFunction(()=>!state.sharedLoading);await page.evaluate(()=>{
      stopSharedPoll();
      fixture.resetApproval();resetToolApprovals();conversationTasks.entries.clear();
      fixture.history=[{seq:0,type:'user.message',data:{text:'请整理临时文件，运行前让我确认。',receiptId:'rpc:demo.1'}},
        {seq:1,type:'assistant.message',data:{text:'整理脚本已准备好。先确认这次操作的影响范围。'}}];
      state.sharedEvents=fixture.history;renderSharedConversation();
    });await page.evaluate(()=>refreshToolApprovals());await page.evaluate(()=>{$('chat-scroll').scrollTop=0;closeToast()})};
    const card=page.getByRole('region',{name:'待批准操作'});
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
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(done=>server.close(done))}
});
