import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../www/',import.meta.url));
const evidence=fileURLToPath(new URL(process.env.WEFTMATE_UI2_EVIDENCE==='1'?'../../../tests/evidence/ui-2/':'../../../.local/ui-2/',import.meta.url));

test('UI-2 mobile home, themes, progressive detail, full-screen sources, drafts and history',async()=>{
  const server=createServer(async(req,res)=>{try{
    const name=new URL(req.url,'http://localhost').pathname,path=resolve(root,`.${name==='/'?'/index.html':name}`);
    if(!path.startsWith(root)){res.writeHead(404).end();return}
    res.setHeader('Content-Type',`${{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream'}; charset=utf-8`);
    res.end(await readFile(path));
  }catch{res.writeHead(404).end()}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));await mkdir(evidence,{recursive:true});
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const capture=async name=>{await page.evaluate(()=>Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)));await page.screenshot({path:resolve(evidence,name)})};
  try{
    await page.addInitScript(()=>{
      const now='2026-10-08T06:00:00.000Z';
      const step=(seq,state='completed')=>({seq,type:state==='running'?'step.started':'step.completed',at:now,data:{taskId:'turn-1',stepId:'read-1',toolName:'read_file',summary:'读取项目记录 · notes.md',state,detailRef:{seq:3}}});
      const approval={approvalId:'12345678-1234-4234-8234-123456789abc',sessionId:'approve',taskId:'cmd-demo',sourceCommandId:'cmd-demo',
        sourceReceiptId:'rpc:demo.1',turn:1,callId:'call:demo.1',rootCallId:'root:demo.1',toolName:'weftmod_script',
        reason:'整理临时目录，删除三个不再需要的文件。',riskCategories:['execute','delete'],createdAt:now,status:'pending'};
      const artifact={artifactId:'report-new',fileName:'项目进展.md',contentType:'text/markdown',size:128,createdAt:now};
      const source={key:'file:notes.md',kind:'file',name:'notes.md',location:'notes.md',uses:[{id:'turn-1/read-1',callId:'read-1',summary:'读取项目记录 · notes.md',path:'/sessions/report/events/3/detail',seq:3}]};
      window.fixture={requests:[],appearance:'light',failResources:false,failDetail:false,approval,artifact,source,
        sessions:[{sessionId:'report',source:'host',title:'整理项目进展',sendAvailable:true,createdAt:now,modelDisplayName:'当前模型'},
          {sessionId:'running',source:'host',title:'准备下周的安排',sendAvailable:true,running:true,modelDisplayName:'当前模型'},
          {sessionId:'approve',source:'host',title:'整理临时文件',sendAvailable:true,attention:'approval',lastOutcome:null,modelDisplayName:'当前模型'}],
        histories:{report:[{seq:1,type:'user.message',at:now,data:{text:'整理这周的项目进展，写一份简洁的报告。'}},step(3),
          {seq:4,type:'artifact.created',at:now,data:artifact},{seq:5,type:'assistant.message',at:now,data:{text:'# 项目进展\n\n已整理本周的记录。\n\n- 完成手机审批模式\n- 统一会话与来源阅读\n- 下一步：核对跨设备体验\n\n报告已保存，点文件即可查看。'}},
          {seq:6,type:'assistant.message',at:now,data:{text:'## 待核对\n\n保留每项工作的验证结果。\n\n'+Array(12).fill('可在原会话继续补充，相关来源也会保留。').join('\n\n')}}],
          running:[{seq:1,type:'user.message',at:now,data:{text:'帮我安排下周的工作，先整理现有的计划。'}},{seq:2,type:'turn.started',at:now,data:{turn:1}},step(3,'running')],
          approve:[{seq:1,type:'user.message',at:now,data:{text:'整理临时文件，删除之前让我确认。'}},{seq:2,type:'approval.requested',at:now,data:{approvalId:approval.approvalId,taskId:'cmd-demo',summary:approval.reason}},
            {seq:3,type:'assistant.message',at:now,data:{text:'这三个文件已经不再使用。确认后，我会继续整理。'}}]}};
      window.weftNative={postMessage(json){const request=JSON.parse(json),{method,params}=request,f=window.fixture;f.requests.push(request);let result={},error;
        if(method==='app.bootstrap')result={loggedIn:true,username:'界面测试',owner:'synthetic-ui2',deviceId:'synthetic-phone',busy:false,model:{source:'phone',displayName:'合成模型'}};
        if(method==='settings.appearance'){if(params.value)f.appearance=params.value;result={value:f.appearance}}
        if(method==='models.host')result={models:[{profileId:'synthetic',displayName:'合成模型',configured:true}]};
        if(method==='auth.me')result={displayName:'界面测试',connectionVerified:true};
        if(method==='conversations.list')result={conversations:[{id:'phone-local',title:'随手记下的想法',createdAt:now}]};
        if(method==='conversations.messages')result={messages:[{role:'user',text:'记下这个想法。'}],receipts:[]};
        if(method==='shared.sessions.list')result={source:'host',hostAvailable:true,sessions:f.sessions};
        if(method==='attachments.list')result={attachments:[]};
        if(method==='shared.sessions.events'){
          const items=f.histories[params.sessionId]||[];
          result={source:'host',sessionId:params.sessionId,events:params.beforeSeq!=null?[{seq:0,type:'assistant.message',data:{text:'更早的项目记录'}}]:items.filter(e=>params.afterSeq==null||e.seq>params.afterSeq),
            nextSeq:params.beforeSeq!=null?0:items.at(-1)?.seq||-1,hasMore:false,hasOlder:params.beforeSeq==null&&params.sessionId==='report',nextBeforeSeq:params.beforeSeq==null?1:null};
        }
        if(method==='shared.sessions.eventDetail'){if(f.failDetail)error='HOST_UNAVAILABLE';else result={text:JSON.stringify({arguments:{file_path:'notes.md'},output:'本周已经完成两项界面工作。'},null,2)}}
        if(method==='shared.approvals.list')result={approvals:params.sessionId==='approve'?[f.approval]:[],hasMore:false,nextBefore:null};
        if(method==='shared.approvals.decide')result={requestId:params.requestId,approval:f.approval={...f.approval,status:'answered',decisionOutcome:params.outcome,decisionRequestId:params.requestId,decisionScope:params.scope,answeredAt:now}};
        if(method==='shared.questions.list')result={questions:[],hasMore:false,nextBefore:null};
        if(method==='shared.tasks.detail')result={taskId:'cmd-demo',sessionId:'approve',source:{commandId:'cmd-demo',kind:'session.message',sessionId:'approve',receiptId:'rpc:demo.1'},artifacts:[],control:{state:'active',canStop:false,canSupplement:false}};
        if(method==='shared.outbox.list')result={source:'host',commands:[]};
        if(method==='shared.activity.list'||method==='activity.list')result={activities:[]};
        if(method==='shared.artifacts.preview')result={text:'# 项目进展\n\n两项界面工作已完成。\n\n| 工作 | 状态 |\n| --- | --- |\n| 审批模式 | 完成 |\n| 来源阅读 | 完成 |'};
        if(method==='shared.artifacts.save')result={pending:true,requestId:'save-demo'};
        if(method==='host.business'){
          if(params.path.startsWith('/personal/v1/chats?')){
            const query=new URL(params.path,'http://synthetic').searchParams.get('q')||'';
            const items=f.sessions.filter(row=>row.title.includes(query)).map(row=>({...row,chatId:'chat-'+row.sessionId,activeSessionId:row.sessionId,kind:'side',match:'title'}));
            result={items,total:items.length,hasMore:false,nextCursor:null,indexState:'ready'};
          }else if(params.path.includes('/resources')){
            if(f.failResources)error='HOST_UNAVAILABLE';else if(params.path.endsWith('afterSeq=-1'))result={outputs:[f.artifact],sources:[f.source],nextSeq:3,hasMore:true};
            else result={outputs:[f.artifact],sources:[{...f.source,uses:[{id:'turn-2/read-2',callId:'read-2',summary:'核对项目记录 · notes.md',path:'/sessions/report/events/3/detail',seq:3}]}],nextSeq:6,hasMore:false};
          }else if(params.path.endsWith('/approval-mode'))result={mode:'auto',allowedCategories:[]};
          else if(params.path==='/personal/v1/system')result={host:{state:'ready'},model:{state:'ready'},memory:{state:'disabled'},canRestart:false};
        }
        setTimeout(()=>window.weftNative.onmessage({data:JSON.stringify({id:request.id,ok:!error,result,...(error?{error:{code:error}}:{})})}),0);
      }};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>state.booted&&state.page==='home');
    await page.locator('#home-page').getByRole('img',{name:'等你批准',exact:true}).waitFor();
    assert.equal(await page.locator('#home-conversations [aria-label="正在运行"]').count(),1);
    await page.locator('#home-page').getByRole('button',{name:'搜索',exact:true}).click();const search=page.getByRole('combobox',{name:'搜索内容',exact:true});await search.fill('项目');await page.getByRole('tab',{name:'对话',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#search-results').getAttribute('aria-busy')==='false');assert.equal(await page.getByRole('option').count(),1);await search.fill('');await page.getByRole('button',{name:'关闭搜索',exact:true}).click();await page.getByRole('dialog',{name:'搜索',exact:true}).waitFor({state:'hidden'});
    for(const theme of ['light','dark']){
      await page.evaluate(value=>applyTheme(value),theme);await capture(`${theme}-list.png`);
      await page.locator('#home-conversations [data-id="running"]').click();await page.getByText('正在处理…',{exact:true}).waitFor();
      assert.equal(await page.locator('.execution-block').evaluate(n=>n.open),false);await capture(`${theme}-running.png`);
      assert.equal(await page.getByRole('button',{name:'停止回复',exact:true}).isVisible(),true);await page.locator('#page-back').click();
      await page.locator('#home-conversations [data-id="approve"]').click();await page.evaluate(()=>refreshToolApprovals());
      await page.getByRole('button',{name:'批准',exact:true}).waitFor();await capture(`${theme}-approval.png`);await page.locator('#page-back').click();
      await page.locator('#home-conversations [data-id="report"]').click();await page.getByText('报告已保存，点文件即可查看。',{exact:false}).waitFor();
      await page.locator('#draft').fill('稍后补充验收结果');
      await page.locator('.execution-block > summary').click();assert.equal(await page.locator('.execution-step').evaluate(n=>n.open),false);
      assert.equal(await page.locator('.execution-step pre').filter({hasText:'本周已经完成'}).count(),0,'opening the group describes objects without showing step output');
      await capture(`${theme}-steps.png`);
      await page.locator('.execution-step > summary').click();await page.locator('.execution-step pre').filter({hasText:'本周已经完成'}).waitFor();
      await page.evaluate(()=>renderSharedConversation());assert.equal(await page.locator('.execution-step').evaluate(n=>n.open),true);
      await page.locator('.execution-step > summary').click();
      await page.getByRole('button',{name:'打开成果',exact:true}).click();await page.locator('#resource-content table').waitFor();await capture(`${theme}-artifact.png`);
      await page.locator('#resource-back').click();assert.equal(await page.locator('#draft').inputValue(),'稍后补充验收结果');
      await page.locator('#chat-scroll').dispatchEvent('wheel',{deltaY:-900});await page.locator('#chat-scroll').evaluate(n=>n.scrollTop=150);const top=await page.locator('#chat-scroll').evaluate(n=>n.scrollTop);
      await page.locator('#conversation-more').click();await page.getByRole('menuitem',{name:'输出与来源',exact:true}).click();await page.locator('.resource-row').filter({hasText:'notes.md'}).waitFor();
      assert.equal(await page.locator('.resource-row').filter({hasText:'项目进展.md'}).count(),1);
      assert.match(await page.locator('.resource-row').filter({hasText:'notes.md'}).innerText(),/2 次使用/);
      await page.locator('.resource-row').filter({hasText:'notes.md'}).click();assert.match(await page.locator('#resource-content').innerText(),/读取 2 次/);
      assert.equal(await page.locator('.resource-usage pre').count(),0);await capture(`${theme}-source.png`);
      await page.evaluate(()=>fixture.failDetail=true);await page.locator('.resource-usage > summary').first().click();await page.getByText('暂时无法读取，收起后可重试。',{exact:true}).waitFor();
      await page.locator('.resource-usage > summary').first().click();await page.evaluate(()=>fixture.failDetail=false);await page.locator('.resource-usage > summary').first().click();
      await page.locator('.resource-usage pre').filter({hasText:'本周已经完成'}).waitFor();
      await page.keyboard.press('Escape');assert.equal(await page.locator('#resource-page').isVisible(),false);
      assert.equal(await page.locator('#chat-scroll').evaluate(n=>n.scrollTop),top);
      await page.locator('#page-back').click();
    }
    // Restart still lands on the list; selecting the previous conversation restores its own draft.
    await page.reload();await page.waitForFunction(()=>state.booted&&state.page==='home');
    await page.locator('#home-conversations [data-id="report"]').click();assert.equal(await page.locator('#draft').inputValue(),'稍后补充验收结果');
    await page.evaluate(()=>fixture.failResources=true);await page.locator('#conversation-more').click();await page.getByRole('menuitem',{name:'输出与来源',exact:true}).click();await page.getByText('离线 · 上次读取的内容',{exact:true}).waitFor();
    await page.locator('#resource-back').click();
    await page.getByRole('button',{name:'加载更早内容',exact:true}).click();await page.getByText('更早的项目记录',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.requests.some(request=>request.method==='shared.sessions.events'&&request.params.beforeSeq===1)),true);
    // A subsequent composer/history refresh must retain the page that just arrived.
    await page.evaluate(()=>{updateComposer();renderSharedConversation()});
    assert.equal(await page.locator('#chat-content .message[data-seq="0"]').count(),1);
    await page.getByText('更早的项目记录',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>state.sharedNextSeq),6);
    // A smaller visual viewport models the layout response; it does not claim an Android IME test.
    await page.setViewportSize({width:390,height:500});await page.locator('#draft').focus();
    const bounds=await page.locator('#composer-dock').boundingBox();assert.ok(bounds.y+bounds.height<=500);
    await page.setViewportSize({width:320,height:700});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
    await page.setViewportSize({width:844,height:390});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),844);
    await page.setViewportSize({width:390,height:844});await page.locator('#draft').blur();await page.locator('#page-back').click();
    await page.locator('#home-new-chat').click();assert.equal(await page.locator('#draft').inputValue(),'');await page.locator('#draft').fill('新对话草稿');
    await page.locator('#page-back').click();await page.locator('#home-new-chat').click();assert.equal(await page.locator('#draft').inputValue(),'新对话草稿');
    assert.doesNotMatch(await page.locator('#chat-page').innerText(),/电脑共享会话 · 已连接|沿用这段会话在电脑上绑定的模型/);
    await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.evaluate(()=>applyTheme('system'));
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');await page.emulateMedia({colorScheme:'light'});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light',{},{timeout:3000}).catch(async error=>{
      throw new Error(`${error.message} ${JSON.stringify(await page.evaluate(()=>({appearance:state.appearance,theme:document.documentElement.dataset.theme,matches:window.matchMedia('(prefers-color-scheme: dark)').matches})))}, ${errors.join(', ')}`)
    });
    assert.deepEqual(errors,[]);
    await writeFile(resolve(evidence,'verification.json'),JSON.stringify({engine:'Chromium',viewport:{width:390,height:844},synthetic:true,
      checks:['home/search/status','light/dark/system','three approval buttons','steps collapsed/readable/raw/lazy/poll preservation',
        'resources forward pagination/dedup/usage/lazy/retry/offline','artifact Markdown/table','full-screen Back/scroll/draft',
        'restart draft/new draft','older history forward cursor','small viewport composer','320px and landscape'],pageErrors:errors},null,2)+'\n');
  }finally{await browser.close();await new Promise(done=>server.close(done))}
});
