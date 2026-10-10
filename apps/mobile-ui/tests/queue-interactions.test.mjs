import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

test('UI-3m named controls preserve intent, edit/cancel races and latest output summaries',async()=>{
  const assets=fileURLToPath(new URL('../www/',import.meta.url));
  const server=createServer(async(req,res)=>{try{const file=resolve(assets,'.'+(req.url==='/'?'/index.html':req.url));
    if(!file.startsWith(assets))return res.writeHead(404).end();res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.addInitScript(()=>{
      const fixture=window.fixture={requests:[],mode:'auto',race:false,events:[{seq:1,type:'task.started',data:{taskId:'cmd-root',text:'当前任务'}}],next:2};
      window.weftNative={postMessage(json){const request=JSON.parse(json);fixture.requests.push(request);const {method,params}=request;let result={},error;
        if(method==='app.bootstrap')result={loggedIn:false};
        if(method==='models.host')result={models:[{profileId:'synthetic',displayName:'合成模型',configured:true}]};
        if(method==='settings.appearance')result={value:'light'};
        if(method==='attachments.list')result={attachments:[]};
        if(method==='shared.outbox.list')result={source:'host',commands:[]};
        if(method==='activity.list')result={hostAvailable:true,activities:[]};
        if(method==='shared.sessions.list')result={source:'host',hostAvailable:true,sessions:[{sessionId:'s1',title:'排队验收',running:true,sendAvailable:true,source:'host'}]};
        if(method==='shared.sessions.events')result={source:'host',sessionId:'s1',events:fixture.events.filter(row=>params.afterSeq==null||row.seq>params.afterSeq),nextSeq:fixture.events.at(-1).seq,hasMore:false};
        if(method==='shared.approvals.list')result={approvals:[],hasMore:false};
        if(method==='shared.questions.list')result={questions:[],hasMore:false};
        if(method==='shared.send'){const taskId=`cmd-${fixture.next}`,seq=fixture.next++;
          fixture.events.push({seq,type:params.intent==='steer'?'user.message':'task.queued',data:{taskId,text:params.text,...(params.intent==='steer'?{taskAction:'supplement'}:{})}});
          result={source:'host',sessionId:'s1',requestId:params.requestId,state:'accepted'};}
        if(method==='host.business'){
          if(params.path==='/personal/v1/settings/personalization'){fixture.personalization={...WeftPersonalization.defaults,...fixture.personalization,...params.body};result={settings:fixture.personalization};}
          if(params.path.endsWith('/approval-mode'))result={mode:fixture.mode};
          if(params.path.endsWith('/cancel')){if(fixture.race)error={code:'TASK_NOT_QUEUED',status:409};else{const taskId=params.path.split('/').at(-2);fixture.events.push({seq:fixture.next++,type:'task.ended',data:{taskId,reason:'cancelled'}});}}
          if(params.path.includes('/resources')){if(fixture.offlineResources)error={code:'HOST_UNAVAILABLE',status:503};else result={outputs:[{artifactId:'old',fileName:'报告.md',createdAt:'2026-10-07T00:00:00Z'},{artifactId:'new',fileName:'报告.md',createdAt:'2026-10-08T00:00:00Z'}],sources:[{key:'tool:read',kind:'tool',name:'read_file',uses:[{id:'read',summary:'读取报告',path:'/sessions/s1/events/9/detail'}]}],hasMore:false,nextSeq:9};}
        }
        if(method==='shared.artifacts.preview')result={text:params.artifactId==='new'?'最新报告内容':'旧版报告内容'};
        if(method==='shared.sessions.eventDetail')result={text:JSON.stringify({arguments:{path:'notes.md'},output:'source'})};
        setTimeout(()=>window.weftNative.onmessage({data:JSON.stringify({id:request.id,ok:!error,result,...(error?{error}:{})})}),0);
      }};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>state.booted);
    await page.evaluate(()=>{state.loggedIn=true;state.owner='qa';state.deviceId='qa-phone';state.chatSource='host';state.sharedSessionId='s1';state.sharedHostAvailable=true;state.sharedRunning=true;state.sharedSessions=[{sessionId:'s1',running:true,sendAvailable:true,source:'host'}];state.sharedEvents=fixture.events;state.sharedNextSeq=1;page('chat');renderSharedConversation();});
    const input=page.getByRole('textbox',{name:'输入消息',exact:true}),send=page.getByRole('button',{name:'发送',exact:true});
    async function selectMode(label){
      await page.getByRole('button',{name:'返回',exact:true}).click();
      await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
      await page.getByRole('button',{name:/^助手/}).click();
      const mode=page.getByRole('combobox',{name:'回复进行中时发送的消息',exact:true});await mode.click();await page.getByRole('option',{name:label,exact:true}).click();
      await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'返回',exact:true}).click();
      await page.getByRole('button',{name:'排队验收 正在运行',exact:true}).click();
    }
    await selectMode('引导');await input.fill('补充当前任务');await send.click();
    await page.getByText('已补充到当前任务',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.requests.find(row=>row.method==='shared.send').params.intent),'steer');
    await selectMode('排队');await input.fill('可编辑的目标');await send.click();await page.getByText('1 个排队中',{exact:true}).click();
    const card=page.getByRole('article',{name:'排队任务 可编辑的目标',exact:true});await card.getByRole('button',{name:'编辑后重新排',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('draft').value==='可编辑的目标');assert.equal(await page.evaluate(()=>uiCore.messageModePreference()),'queue');
    await input.fill('竞争开始的目标');await send.click();const racing=page.getByRole('article',{name:'排队任务 竞争开始的目标',exact:true});await racing.waitFor();
    await page.evaluate(()=>fixture.race=true);await racing.getByRole('button',{name:'取消',exact:true}).click();
    await racing.getByRole('status').getByText('已经开始，可以用停止',{exact:true}).waitFor();
    assert.equal(await racing.isVisible(),true);assert.equal(await page.getByRole('button',{name:'停止回复',exact:true}).isVisible(),true);
    await page.getByRole('button',{name:'输出与来源',exact:true}).click();
    await page.getByRole('button',{name:/^报告.md/}).waitFor();assert.equal(await page.getByRole('button',{name:/^报告.md/}).count(),1);await page.getByRole('button',{name:/^报告.md/}).click();
    await page.getByText('最新报告内容',{exact:true}).waitFor();await page.getByText('旧版 · 1 个',{exact:true}).click();await page.getByRole('button',{name:'报告.md',exact:true}).click();await page.getByText('旧版报告内容',{exact:true}).waitFor();
    await page.getByRole('button',{name:'返回对话',exact:true}).click();await page.getByRole('button',{name:'输出与来源',exact:true}).click();await page.getByRole('button',{name:/读取文件/}).click();await page.getByText('读取报告',{exact:true}).click();
    await page.getByText('读取 1 个文件：notes.md',{exact:true}).waitFor();assert.equal(await page.getByText(/"路径"/).isVisible(),false);await page.getByText('详情',{exact:true}).click();assert.equal(await page.getByText(/"路径"/).isVisible(),true);
    await page.getByRole('button',{name:'返回对话',exact:true}).click();
    await page.evaluate(()=>{fixture.offlineResources=true;localStorage.setItem('weftmate-resources:qa:s1',JSON.stringify({outputs:[{artifactId:'old',fileName:'报告.md',createdAt:'2026-10-07T00:00:00Z'},{artifactId:'new',fileName:'报告.md',createdAt:'2026-10-08T00:00:00Z'}],sources:[]}));});
    await page.getByRole('button',{name:'输出与来源',exact:true}).click();await page.getByText('离线 · 上次读取的内容',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/^报告.md/}).count(),1);await page.getByRole('button',{name:/^报告.md/}).click();await page.getByText('最新报告内容',{exact:true}).waitFor();await page.getByText('旧版 · 1 个',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
  }finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
});
