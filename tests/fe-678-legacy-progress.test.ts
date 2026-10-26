import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {uiCoreAssets} from '../src/ui-core/manifest.mjs';

// This is the ordinary work-session path (inLogicalTimeline=false), including
// the actual composer, history ingestion, messages, resources and timeline.
test('#678 ordinary work sessions retain each message/process pair', {timeout:30000}, async t=>{
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'chrome'})});
  try {
    const page=await browser.newPage();
    const coreSource=uiCoreAssets.map(name=>readFileSync('src/ui-core/'+name,'utf8')).join('\n;\n');
    const viewSource=['timeline.js','components/steps.js','components/messages.js','components/resources.js','components/shell.js','components/approvals.js'].map(name=>readFileSync('src/personal-access-ui/'+name,'utf8')).join('\n;\n');
    async function setup(creating=false){
      await page.setContent('<div id="chat-scroll"><ol id="transcript"></ol></div><div id="chat-intro"></div><div id="timeline-status"></div><button id="load-older"></button><input id="message-text"><section id="approval-bar" hidden></section><p id="model-hint"></p>');
      await page.evaluate(()=>{const g=globalThis as any;Object.defineProperty(g,"localStorage",{configurable:true,value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});Object.assign(g,{WeftUiComponents:{factories:{}},WeftIcons:{create:()=>document.createElement('span')},WeftControls:{skeleton:()=>{const n=document.createElement('li');n.className='wm-skeleton';return n;}},WeftContent:{closeGallery:()=>{},create:(text:string,cls:string)=>{const n=document.createElement('div');n.className=cls;n.textContent=text;return n;},update:(n:HTMLElement,text:string)=>n.textContent=text,messageCompletionNotice:()=>{}}});});
      await page.addScriptTag({content:coreSource});await page.addScriptTag({content:viewSource});
      await page.evaluate(creating=>{
        const g=globalThis as any,noop=()=>{},ui:any={element:(tag:string,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;},byId:(id:string)=>document.getElementById(id),readMessageDraft:()=>'',toast:noop,renderConversationTasks:noop};
        const effects=new Proxy(ui,{get:(target,key)=>target[key] || noop});let serial=0;
        const core=g.WeftUiCore.create({effects,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},fetch:async()=>{throw Error('no network in this DOM test');}});
        Object.assign(core.state,{ownerId:'synthetic-owner',identityGeneration:1,account:{ownerId:'synthetic-owner'},selectedChatId:null,selectedSessionId:creating?null:'session-work',activeChatSource:'desktop',online:true,
          currentView:'assistant',models:[{id:'synthetic',name:'合成模型',configured:true}],modelProfileId:'synthetic',capabilities:{chat:{available:true}},newConversation:creating,newConversationId:'synthetic-draft',newConversationMode:'work',newConversationApprovalMode:null,
          sessions:[{sessionId:'session-work',mode:'work',sendAvailable:true,running:false}],personalCapabilities:{},personalization:{},tasks:[],csrfToken:'synthetic-csrf'});
        Object.assign(ui,g.WeftUiComponents.factories.messages(core,ui),g.WeftUiComponents.factories.resources(core,ui));
        ui.showConversation=noop;
        ui.renderModelHint=g.WeftUiComponents.factories.shell(core,ui).renderModelHint;
        ui.renderConversationApprovals=g.WeftUiComponents.factories.approvals(core,ui).renderConversationApprovals;
        // These replace I/O only. Session selection, receipt reconciliation,
        // history append and all DOM rendering remain the product functions.
        core.refreshHistory=async(reset=false)=>{if(reset){core.state.historyGeneration++;core.state.historyEvents.clear();core.state.seenSeq.clear();ui.clearHistoryView(true);}return {kind:'unchanged'};};
        core.refreshSessions=async()=>{};core.updateSession=async()=>{};core.refreshApprovalMode=async()=>{};core.refreshConversationTasks=async()=>{};
        core.supportsWorkModes=()=>false;
        const saved=new Map(),commands=new Map(),releases=new Map();
        core.submitCommand=async(kind:string,_body:any,_session:string,id:string)=>new Promise(resolve=>releases.set(id,(command:any)=>{commands.set(id,command);resolve(command);}));
        core.accessApi=async(path:string)=>({command:commands.get(decodeURIComponent(path.split('/').at(-1)))});
        g.f={core,ui,saved,commands,releases,deliveries:[],
          send(text='同文合成消息'){
            const promise=core.sendDraft(text);this.deliveries.push(promise);
            const row=core.optimisticMessages().at(-1);
            if(!row)throw Error('actual send did not create its user');return row.requestId;
          },
          append(seq:number,type:string,data:any){core.appendHistory([{seq,type,data,at:'2026-10-26T01:00:00Z',sessionId:'session-work'}]);},
          ack(id:string,receiptId:string){const command={kind:'session.message',requestId:id,receiptId,sessionId:'session-work',state:'accepted_by_dsh'};commands.set(id,command);core.reconcileOptimistic(command);releases.get(id)?.(command);},
          check(ids:string[],phase:string){
            if(core.inLogicalTimeline())throw Error('this test must exercise ordinary work, not workTimeline');
            const rows=[...document.querySelectorAll('#transcript > li')];
            for(const id of ids){
              const user=rows.find((n:any)=>n.dataset.messageKey===id || n.dataset.optimistic===id);
              const process=rows.filter((n:any)=>n.dataset.timeline===`steps-request:${id}`);
              if(!user || process.length!==1 || rows.indexOf(process[0])!==rows.indexOf(user)+1)throw Error(`${phase}: ${id} lost its own adjacent process; ${rows.map((n:any)=>n.dataset.messageKey || n.dataset.optimistic || n.dataset.timeline || n.dataset.seq)}`);
              const nodes=[process[0],process[0].querySelector('.execution-block'),process[0].querySelector('.execution-block > summary')];
              if(saved.has(id) && nodes.some((n,i)=>n!==saved.get(id)[i]))throw Error(`${phase}: replaced process/details/summary`);
              saved.set(id,nodes);
            }
            if(document.querySelectorAll('#transcript .execution-block').length!==ids.length)throw Error(`${phase}: orphan/duplicate disclosure`);
          }};
      },creating);
    }
    await t.test('sparse native sequence, stop/resend, same-text burst and late HTTP receipt',async()=>{
      await setup();
      await page.evaluate(async()=>{
        const f=(globalThis as any).f;
        const a=f.send();f.check([a],'send A');
        f.append(36,'task.queued',{receiptId:'receipt-a',text:'同文合成消息'});f.check([a],'queued A');
        f.append(37,'turn.started',{turn:2});f.check([a],'start A');
        f.append(39,'task.started',{requestId:a,receiptId:'receipt-a',turn:2,turnTaskId:'turn-2'});f.check([a],'task A');
        f.append(40,'user.message',{receiptId:'receipt-a',text:'同文合成消息'});f.check([a],'user A before HTTP');
        f.ack(a,'receipt-a');await f.deliveries.at(-1);f.check([a],'HTTP A');
        f.append(44,'task.ended',{requestId:a,receiptId:'receipt-a',turn:2,reason:'aborted'});f.append(45,'turn.ended',{turn:2,reason:'aborted'});f.check([a],'stop A');
        const b=f.send();f.check([a,b],'resend B');
        for(const [seq,type,data] of [[46,'task.queued',{receiptId:'receipt-b',text:'同文合成消息'}],[47,'turn.started',{turn:3}],[49,'task.started',{requestId:b,receiptId:'receipt-b',turn:3,turnTaskId:'turn-3'}],[50,'user.message',{receiptId:'receipt-b',text:'同文合成消息'}]] as any){f.append(seq,type,data);f.check([a,b],type+' B');}
        const c=f.send('同文连发');f.ack(c,'receipt-c');await f.deliveries.at(-1);f.check([a,b,c],'C queued while B runs');
        const d=f.send('同文连发');f.check([a,b,c,d],'D queued while B runs');
        f.append(61,'task.queued',{tasks:[{requestId:c,receiptId:'receipt-c',text:'同文连发'},{requestId:d,receiptId:'receipt-d',text:'同文连发'}]});f.check([a,b,c,d],'queued burst');
        f.core.conversationApprovals.entries.set('synthetic-approval',{row:{approvalId:'synthetic-approval',sessionId:'session-work',turn:3,status:'pending'}});
        const bar=document.getElementById('approval-bar');bar.hidden=false;f.ui.renderTimeline();
        if(bar.closest('.timeline-entry')?.getAttribute('data-timeline')!==`steps-request:${b}`)throw Error('queued messages stole the active approval surface');
        f.core.conversationApprovals.entries.clear();bar.hidden=true;
        const disclosure=f.saved.get(b)[1],summary=f.saved.get(b)[2];disclosure.open=true;summary.focus();
        f.append(65,'step.started',{taskId:'turn-3',stepId:'synthetic-read',toolName:'read',state:'running',arguments:{path:'synthetic.txt'}});f.check([a,b,c,d],'B tool');
        const step=disclosure.querySelector('[data-step="synthetic-read"]');if(!step)throw Error('tool detail disappeared');
        f.append(72,'turn.ended',{turn:3,reason:'completed'});f.ack(b,'receipt-b');f.ack(d,'receipt-d');await Promise.all(f.deliveries);f.check([a,b,c,d],'late HTTP acknowledgements');
        f.append(73,'step.completed',{taskId:'turn-3',stepId:'synthetic-read',toolName:'read',state:'completed'});f.check([a,b,c,d],'late owned tool completion');
        if(step!==disclosure.querySelector('[data-step="synthetic-read"]') || !disclosure.open || document.activeElement!==summary)throw Error('tool update lost expansion, detail or focus');
        if(!/已停止/.test(f.saved.get(a)[2].textContent) || /已停止/.test(f.saved.get(b)[2].textContent))throw Error('stop crossed message ownership');
      });
    });
    await t.test('the first work message survives actual session selection and loading clear',async()=>{
      await setup(true);
      await page.evaluate(async()=>{
        const f=(globalThis as any).f,id=f.send('新工作会话的首条合成消息');f.check([id],'draft before session');
        const createId=[...f.releases.keys()][0];f.releases.get(createId)({kind:'session.create',requestId:createId,sessionId:'session-work',state:'accepted_by_dsh'});
        for(let i=0;i<15&&!f.releases.has(id);i++)await Promise.resolve();
        if(f.core.state.newConversation || f.core.state.selectedSessionId!=='session-work' || !f.releases.has(id))throw Error('actual session selection did not finish: '+JSON.stringify({session:f.core.state.selectedSessionId,isNew:f.core.state.newConversation,rows:f.core.optimisticMessages().map(row=>({status:row.status,sessionId:row.sessionId})),releases:[...f.releases.keys()]}));
        f.check([id],'session established before message acceptance');
        f.append(5,'task.queued',{receiptId:'receipt-first',text:'新工作会话的首条合成消息'});f.check([id],'first queued');
        f.append(6,'turn.started',{turn:1});f.append(8,'task.started',{requestId:id,receiptId:'receipt-first',turn:1,turnTaskId:'turn-1'});f.check([id],'first started');
        f.append(9,'user.message',{receiptId:'receipt-first',text:'新工作会话的首条合成消息'});f.check([id],'first echo');
        f.ack(id,'receipt-first');await Promise.all(f.deliveries);f.check([id],'first HTTP receipt');
      });
    });
    await t.test('approval rendering cannot revive a cached running hint from a stale session snapshot',async()=>{
      await setup();
      const result=await page.evaluate(()=>{
        const f=(globalThis as any).f,c=f.core,hint=document.getElementById('model-hint');
        hint.textContent='等待模型回复…';hint.hidden=true;c.state.sessions[0].running=false;c.state.turnStatus='running';
        f.ui.renderConversationApprovals();
        const waiting={hidden:hint.hidden,text:hint.textContent};c.state.models=[];f.ui.renderConversationApprovals();
        return {waiting,configuration:{hidden:hint.hidden,text:hint.textContent}};
      });
      assert.deepEqual(result.waiting,{hidden:true,text:''});assert.equal(result.configuration.hidden,false);assert.match(result.configuration.text,/模型/);
    });
    await t.test('fork constructor queue seeds never become executable pending processes',async()=>{
      await setup();
      await page.evaluate(()=>{
        const f=(globalThis as any).f;
        f.append(4,'task.queued',{inherited:true,tasks:[{receiptId:'inherited-only',text:'不会执行的继承输入'}]});
        if(f.core.messageProcesses(f.core.timelineEventsForContext()).length || document.querySelector('#transcript .execution-block'))throw Error('inherited queue seed became a waiting process');
        const id=f.send('真实的新输入');f.check([id],'send beside inherited queue');
        f.append(10,'task.queued',{requestId:id,receiptId:'real-receipt',text:'真实的新输入'});f.check([id],'real queued is retained');
        f.append(11,'turn.started',{turn:1});f.append(13,'task.started',{requestId:id,receiptId:'real-receipt',turn:1,turnTaskId:'turn-1'});
        f.append(14,'user.message',{receiptId:'real-receipt',text:'真实的新输入'});f.append(18,'turn.ended',{turn:1,reason:'completed'});f.check([id],'real user and terminal are retained');
      });
    });
    await t.test('a rejected send fails in place and actual retry reuses its disclosure',async()=>{
      await setup();
      await page.evaluate(async()=>{
        const f=(globalThis as any).f,id=f.send('发送失败后重试的合成消息');f.check([id],'before rejection');
        const rejection={kind:'session.message',requestId:id,sessionId:'session-work',state:'rejected',errorCode:'MODEL_NOT_CONFIGURED'};
        f.releases.get(id)(rejection);await f.deliveries.at(-1);f.check([id],'rejected without native start');
        const [row,details,summary]=f.saved.get(id);
        if(row.dataset.running!=='false' || !row.classList.contains('has-failure') || !/未.*发送|发送.*失败/.test(summary.textContent) || /等待模型/.test(summary.textContent))throw Error('unaccepted failed submission still waits for the model');
        f.core.state.models=[];f.ui.renderModelHint();
        const hint=document.getElementById('model-hint');
        if(hint.hidden || !/模型/.test(hint.textContent) || /MODEL_NOT_CONFIGURED/.test(hint.textContent+summary.textContent))throw Error('configuration failure did not keep readable model guidance');
        f.core.state.models=[{id:'synthetic',name:'合成模型',configured:true}];
        const retry=f.core.retryOptimistic(id);
        for(let i=0;i<15 && f.core.optimisticMessages()[0].requestId===id;i++)await Promise.resolve();
        const retried=f.core.optimisticMessages()[0];
        if(retried.requestId===id || !f.releases.has(retried.requestId))throw Error('real retry did not dispatch its new safe attempt');
        f.check([id],'retry dispatch keeps original presentation');
        if(row.dataset.running!=='true' || row.classList.contains('has-failure') || /未.*发送|发送.*失败/.test(summary.textContent))throw Error('retry did not clear the failure in place');
        f.ack(retried.requestId,'retry-receipt');await retry;
        f.append(20,'task.queued',{requestId:retried.requestId,receiptId:'retry-receipt',text:retried.text});
        f.append(21,'turn.started',{turn:2});f.append(23,'task.started',{requestId:retried.requestId,receiptId:'retry-receipt',turn:2,turnTaskId:'turn-2'});
        f.append(24,'user.message',{receiptId:'retry-receipt',text:retried.text});f.append(28,'turn.ended',{turn:2,reason:'completed'});f.check([id],'retry completed');
        if(!/已完成/.test(summary.textContent) || details!==row.querySelector('.execution-block'))throw Error('retry lost terminal state or its original details');
      });
    });
    await t.test('uncertain delivery stays unconfirmed and native acceptance takes precedence over a failed local snapshot',async()=>{
      await setup();
      await page.evaluate(async()=>{
        const f=(globalThis as any).f,id=f.send('需要核对发送结果的合成消息');f.check([id],'send before uncertain result');
        f.releases.get(id)({kind:'session.message',requestId:id,sessionId:'session-work',state:'uncertain',receiptId:'uncertain-receipt'});await f.deliveries.at(-1);
        f.check([id],'uncertain result');const [row,,summary]=f.saved.get(id);
        if(row.classList.contains('has-failure') || /等待模型|未能发送/.test(summary.textContent) || !/核对/.test(summary.textContent))throw Error('uncertain delivery was mistaken for a definite failure or model response');
        f.append(30,'task.queued',{requestId:id,receiptId:'uncertain-receipt',text:'需要核对发送结果的合成消息'});f.check([id],'native acceptance after uncertain lookup');
        if(row.dataset.running!=='true' || row.classList.contains('has-failure') || !/等待模型/.test(summary.textContent))throw Error('real native acceptance lost to the local failed snapshot');
        f.append(31,'turn.started',{turn:3});f.append(33,'task.started',{requestId:id,receiptId:'uncertain-receipt',turn:3,turnTaskId:'turn-3'});f.check([id],'native start despite failed local status');
        f.append(34,'user.message',{receiptId:'uncertain-receipt',text:'需要核对发送结果的合成消息'});f.append(38,'turn.ended',{turn:3,reason:'completed'});f.check([id],'uncertain request completed');
        if(!/已完成/.test(summary.textContent))throw Error('uncertain request did not retain its actual native terminal state');
      });
    });
  } finally {await browser.close();}
});



