import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';

// Synthetic equivalents of the native queued -> start -> task -> user prefix.
// Exercise the shipped state and DOM renderer, without a runtime or user profile.
test('#678 every message owns one persistent process through native prefixes', {timeout:30000}, async t => {
  const browser = await chromium.launch({headless:true,...(process.env.CI ? {} : {channel:'chrome'})});
  try {
    const page = await browser.newPage({viewport:{width:1200,height:1800}});
    async function setup(work = false) {
      await page.setContent(`<div id="session-rail"><div class="rail-top"></div></div><div class="assistant-topbar"><span id="assistant-title"></span></div><div id="chat-scroll" style="height:1600px;overflow:auto"><ol id="transcript"></ol></div><div id="chat-intro"><h1></h1></div><button id="load-older"></button><button id="jump-latest"></button><input id="message-text"><section id="approval-bar" hidden></section><p id="model-hint"></p>`);
      await page.evaluate(() => {
        const g = globalThis as any;
        Object.assign(g, {WeftUiCore:{factories:{}},WeftUiComponents:{factories:{}},WeftIcons:{create:()=>document.createElement('span')},
          WeftContent:{create:(text:string,cls:string)=>{const n=document.createElement('div');n.className=cls;n.textContent=text;return n;},update:(n:HTMLElement,text:string)=>n.textContent=text,messageCompletionNotice:()=>{}}});
      });
      for (const file of ['ui-core/timeline-model.js','ui-core/chat-window.js','ui-core/composer.js','ui-core/main-chat.js','personal-access-ui/timeline.js','personal-access-ui/components/steps.js','personal-access-ui/components/artifacts.js','personal-access-ui/components/main-chat.js'])
        await page.addScriptTag({path:fileURLToPath(new URL('../src/'+file,import.meta.url))});
      await page.evaluate(work => {
        const g=globalThis as any,noop=()=>{},chat={chatId:'chat',activeSessionId:'session',running:false,sendAvailable:true};
        const core:any={state:{ownerId:'synthetic-owner',identityGeneration:1,selectedChatId:'chat',selectedSessionId:'session',activeChatSource:'desktop',mainChat:chat,
          ...(work?{workTimeline:chat,mainChat:{chatId:"home"}}:{}),sessions:[{sessionId:'session',sendAvailable:true,running:false}],models:[{id:'model'}],modelProfileId:'model',online:true,account:{},capabilities:{chat:{available:true}},personalCapabilities:{chatSend:1},historyEvents:new Map(),tasks:[],attachmentDrafts:new Map(),personalization:{},historyGeneration:0},
          conversationTasks:{entries:new Map()},conversationQuestions:{entries:new Map()},conversationApprovals:{entries:new Map()},
          currentAttachmentDrafts:()=>[],sendBlocker:()=>null,explainSendBlocker:noop,conversationTaskContext:()=>({sessionId:'session'}),relatedExecutionSteps:()=>[],
          updateFromCommand:noop,desktopBlocker:()=>null,readPhoneOutbox:()=>null,readPhoneRecovery:()=>null,operation:noop};
        const ui:any={element:(tag:string,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;},byId:(id:string)=>document.getElementById(id),
          appendSessionStatus:noop,readMessageDraft:()=>'',clearMessageDraft:noop,historyNotice:noop,toast:noop,paintHistoryMessages:(events:any[],list:HTMLElement)=>{for(const e of events){const row=document.createElement('li');row.className='message '+(e.type==='user.message'?'user':'assistant');const text=document.createElement('div');text.className='message-text';text.textContent=e.data.text;row.append(text);list.append(row);}},
          renderOlderControl:noop,updateAvailability:noop,renderSessions:noop,paintSelectedSession:noop,renderOptimisticMessages:noop,renderConversationTasks:noop,renderTurnStatus:noop,beginOlderHistory:noop,restoreOlderHistoryPosition:noop,scrollToLatest:noop,renderTimeline:noop,renderConversationApprovals:noop,renderConversationQuestions:noop};
        Object.assign(core,g.WeftUiCore.factories.composer(core,ui,{crypto}));
        core.sendBlocker=()=>null;
        Object.assign(core,g.WeftUiCore.factories.mainChat(core,ui,{crypto}));
        Object.assign(ui,g.WeftUiComponents.factories.mainChat(core,ui));ui.mountMainChat();
        core.state.chatWindow.timeZone='UTC';
        const saved=new Map();let sequence=0;
        g.f={core,ui,saved,work,events:[],acks:new Map(),
          send(id:string,text='同样的合成消息',at='2026-10-26T12:00:00Z'){
            if(work)core.beginOptimistic({requestId:id,sessionId:'session',text,at});
            else {core.restoreMainRequests([{kind:'chat.message',chatId:'chat',requestId:id,text,at,state:'accepted'}]);}
            ui.renderMainChat();
          },
          append(type:string,data:any,at='2026-10-26T12:00:01Z',sessionId='session'){
            const seq=sequence++,event={seq,eventId:`event-${sessionId}-${seq}`,orderKey:String(seq).padStart(5,'0'),sourceRef:{sessionId,seq},sessionId,at,type,data};
            this.events.push(event);core.state.chatWindow.events.set(event.eventId,event);core.state.chatWindow.expanded.add(g.WeftUiCore.ChatWindow.day(at,'UTC'));
            core.observeOptimistic(this.events);ui.renderMainChat();return event;
          },
          check(ids:string[],phase:string){
            const rows=[...document.querySelectorAll('#transcript > .main-chat-row')];
            for(const id of ids){
              const user=rows.find((r:any)=>r.dataset.eventId===id),process=rows.filter((r:any)=>r.dataset.eventId===`progress:request:${id}`);
              if(!user || process.length!==1)throw Error(`${phase}: ${id} must own one user/process; ${rows.map((r:any)=>r.dataset.eventId)}`);
              if(rows.indexOf(process[0])!==rows.indexOf(user)+1)throw Error(`${phase}: ${id} process must immediately follow its user`);
              const nodes=[process[0],process[0].querySelector('.execution-block'),process[0].querySelector('.execution-block > summary')];
              if(nodes.some(n=>!n))throw Error(`${phase}: ${id} is missing its disclosure`);
              if(saved.has(id) && nodes.some((n,i)=>n!==saved.get(id)[i]))throw Error(`${phase}: ${id} replaced its process/details/summary`);
              saved.set(id,nodes);
            }
            if(document.querySelectorAll('#transcript .execution-block').length!==ids.length)throw Error(`${phase}: orphan/duplicate process`);
          }};
      },work);
    }
    for (const work of [false,true]) await t.test(work?'logical work window prefixes':'daily logical window prefixes',async()=>{
      await setup(work);
      await page.evaluate(()=>{
        const f=(globalThis as any).f;
        f.send('A');f.check(['A'],'send A');
        f.append('task.queued',{requestId:'A',receiptId:'receipt-A',commandId:'command-A',text:'同样的合成消息'});f.check(['A'],'queued A');
        f.append('turn.started',{turn:2});f.check(['A'],'start before task/user');
        f.append('task.started',{requestId:'A',receiptId:'receipt-A',turn:2,turnTaskId:'turn-2'});f.check(['A'],'task A');
        f.append('user.message',{receiptId:'receipt-A',text:'同样的合成消息'});f.check(['A'],'echo A');
        f.append('task.ended',{requestId:'A',receiptId:'receipt-A',turn:2,reason:'aborted'});
        f.append('turn.ended',{turn:2,reason:'aborted'});f.check(['A'],'stop A');
        f.send('B');f.check(['A','B'],'immediate resend B');
        for(const [type,data] of [['task.queued',{requestId:'B',receiptId:'receipt-B',commandId:'command-B',text:'同样的合成消息'}],['turn.started',{turn:3}],['task.started',{requestId:'B',receiptId:'receipt-B',turn:3,turnTaskId:'turn-3'}],['user.message',{receiptId:'receipt-B',text:'同样的合成消息'}]] as any) {
          f.append(type,data);f.check(['A','B'],type+' B before HTTP acknowledgement');
        }
        f.send('C');f.send('D');f.check(['A','B','C','D'],'same-text queued sends');
        f.append('task.queued',{tasks:[{requestId:'C',receiptId:'receipt-C'},{requestId:'D',receiptId:'receipt-D'}]});f.check(['A','B','C','D'],'queue while B active');
        f.core.conversationApprovals.entries.set('synthetic-approval',{row:{approvalId:'synthetic-approval',sessionId:'session',turn:3,status:'pending'}});
        const bar=document.getElementById('approval-bar');bar.hidden=false;f.ui.renderMainChat();
        if(bar.closest('#transcript'))throw Error('approval must remain above the composer');
        f.core.conversationApprovals.entries.clear();bar.hidden=true;
        if(!/已停止/.test(f.saved.get('A')[2].textContent))throw Error('A must stay stopped');
        if(/已停止/.test(f.saved.get('B')[2].textContent))throw Error('B must not inherit stop');
      });
    });
    await t.test('logical process completes above its answer and actual changes follow the answer',async()=>{
      await setup(true);
      const result=await page.evaluate(()=>{
        const f=(globalThis as any).f;
        f.send('changes','修改合成文件');
        f.append('turn.started',{turn:1});f.append('task.started',{requestId:'changes',receiptId:'receipt-changes',turn:1,turnTaskId:'turn-1'});
        f.append('user.message',{receiptId:'receipt-changes',text:'修改合成文件'});
        f.append('step.completed',{taskId:'turn-1',stepId:'edit',toolName:'edit',state:'completed',fileChanges:[{path:'report.md',added:3,removed:2}]});
        f.append('assistant.message',{text:'合成最终回答'});
        f.append('turn.ended',{turn:1,reason:'completed'});
        const answer=document.querySelector('.message.assistant'),changes=document.querySelector('.file-changes'),process=document.querySelector('.execution-block') as HTMLDetailsElement;
        const ordered=!!(changes.compareDocumentPosition(answer)&Node.DOCUMENT_POSITION_PRECEDING);
        f.ui.renderMainChat();
        return {ordered,folded:!process.open,answer:answer.textContent,changes:document.querySelectorAll('.file-changes').length};
      });
      assert.deepEqual(result,{ordered:true,folded:true,answer:'合成最终回答',changes:1});
    });
    await t.test('one process spans midnight and retains DOM when an older page is prepended',async()=>{
      await setup();
      await page.evaluate(()=>{
        const f=(globalThis as any).f;
        f.core.state.chatWindow.expanded.add('2026-10-25');
        f.send('midnight','跨午夜合成消息','2026-10-25T23:59:59Z');f.check(['midnight'],'send before midnight');
        f.append('task.queued',{requestId:'midnight',receiptId:'receipt-midnight'});
        f.append('turn.started',{turn:1});f.check(['midnight'],'start next day');
        f.append('task.started',{requestId:'midnight',receiptId:'receipt-midnight',turn:1,turnTaskId:'turn-1'});
        f.append('user.message',{receiptId:'receipt-midnight',text:'跨午夜合成消息'});f.check(['midnight'],'echo next day');
        f.append('turn.ended',{turn:1,reason:'completed'},'2026-10-27T00:00:01Z');f.check(['midnight'],'end third day');
        const old={seq:0,eventId:'older-event',orderKey:'00000-old',sourceRef:{sessionId:'old-session',seq:0},at:'2026-10-25T12:00:00Z',type:'assistant.message',data:{text:'更早的合成回答'}};
        f.core.state.chatWindow.events.set(old.eventId,old);f.ui.renderMainChat();f.check(['midnight'],'prepend page');
      });
    });
    await t.test('processing text belongs only to the process; configuration hints remain available',async()=>{
      await setup(true);
      const result=await page.evaluate(()=>{
        const c=(globalThis as any).f.core;c.state.turnStatus='running';c.state.sessions[0].running=true;c.state.sessions[0].processing={phase:'waiting-model'};
        const running=c.composerState('');c.state.models=[];const missing=c.composerState('');return {hint:running.hint,missing:missing.hint};
      });
      assert.equal(result.hint,'');assert.match(result.missing,/模型/);
    });
    await t.test('a history fragment gains its receipt and request without replacing the disclosure',async()=>{
      await setup();
      await page.evaluate(()=>{
        const f=(globalThis as any).f;
        f.append('turn.started',{turn:8});
        const original=[...document.querySelectorAll('#transcript .execution-block')];
        if(original.length!==1)throw Error('history fragment must be inspectable');
        const row=original[0].closest('.main-chat-row'),summary=original[0].querySelector('summary');
        f.append('user.message',{receiptId:'history-receipt',text:'合成历史消息'});
        f.core.rememberTurnRequest({requestId:'recovered-request',receiptId:'history-receipt',chatId:'chat',sessionId:'session'});
        f.ui.renderMainChat();
        const after=[...document.querySelectorAll('#transcript .execution-block')];
        if(after.length!==1 || after[0]!==original[0] || after[0].closest('.main-chat-row')!==row || after[0].querySelector('summary')!==summary)
          throw Error('receipt/request recovery replaced or duplicated the mounted history process');
        if(row.previousElementSibling?.textContent!=='合成历史消息')throw Error('history process must join its user anchor');
      });
    });
    await t.test('a user received after an ended turn cannot inherit that stopped process',async()=>{
      await setup();
      await page.evaluate(()=>{
        const f=(globalThis as any).f;
        f.append('turn.started',{turn:9});f.append('user.message',{receiptId:'ended-receipt',text:'旧消息'});
        f.append('turn.ended',{turn:9,reason:'aborted'});
        const original=document.querySelector('#transcript .execution-block');
        f.append('user.message',{receiptId:'next-receipt',text:'新消息'});
        const after=[...document.querySelectorAll('#transcript .execution-block')];
        if(after.length!==2 || after[0]!==original || /已停止/.test(after[1].textContent))throw Error('stop leaked beyond turn end');
      });
    });
    await t.test('a mounted orphan merges a later native request/task association in place',async()=>{
      await setup();
      await page.evaluate(()=>{
        const f=(globalThis as any).f;f.append('turn.started',{turn:10});
        const original=document.querySelector('#transcript .execution-block'),summary=original.querySelector('summary');
        f.append('task.started',{requestId:'late-native-request',receiptId:'late-native-receipt',turn:10,turnTaskId:'turn-10'});
        f.append('user.message',{receiptId:'late-native-receipt',text:'稍后补齐归属的历史消息'});
        const after=[...document.querySelectorAll('#transcript .execution-block')];
        if(after.length!==1 || after[0]!==original || after[0].querySelector('summary')!==summary)throw Error('late native association duplicated or replaced the history orphan');
      });
    });
    await t.test('a partial history page never lends an ended message to another turn fragment',async()=>{
      await setup();
      await page.evaluate(()=>{
        const f=(globalThis as any).f,add=(seq:number,type:string,data:any)=>{
          const e={seq,eventId:`history-${seq}`,orderKey:String(seq).padStart(5,'0'),sessionId:'session',sourceRef:{sessionId:'session',seq},at:'2026-10-26T12:00:00Z',type,data};
          f.core.state.chatWindow.events.set(e.eventId,e);f.core.state.chatWindow.expanded.add('2026-10-26');
        };
        add(10,'turn.started',{turn:1});add(12,'user.message',{receiptId:'old-history',text:'已结束的旧消息'});add(18,'turn.ended',{turn:1,reason:'completed'});
        add(24,'step.started',{taskId:'turn-2',stepId:'history-step',toolName:'read',state:'running'});f.ui.renderMainChat();
        let processes=[...document.querySelectorAll('#transcript .execution-block')];
        if(processes.length!==2 || processes[0].querySelector('[data-step="history-step"]'))throw Error('partial page borrowed the ended message for a different turn');
        const fragment=processes[1],summary=fragment.querySelector('summary');
        add(20,'turn.started',{turn:2});add(22,'user.message',{receiptId:'new-history',text:'补页后的新消息'});f.ui.renderMainChat();
        processes=[...document.querySelectorAll('#transcript .execution-block')];
        if(processes.length!==2 || processes[1]!==fragment || fragment.querySelector('summary')!==summary || fragment.closest('.main-chat-row').previousElementSibling?.textContent!=='补页后的新消息')throw Error('prepending the missing turn/user replaced or detached its process');
      });
    });
    await t.test('logical history excludes only inherited queue seeds, retaining real user history',async()=>{
      await setup();
      await page.evaluate(()=>{
        const f=(globalThis as any).f;
        f.append('task.queued',{inherited:true,receiptId:'old-seed',text:'不应执行的旧输入'});
        if(document.querySelector('#transcript .execution-block') || document.getElementById('transcript').textContent.includes('不应执行的旧输入'))throw Error('logical window revived an inherited queue seed');
        f.append('turn.started',{turn:1});f.append('user.message',{receiptId:'old-seed',text:'应保留的真实历史消息'});f.append('turn.ended',{turn:1,reason:'completed'});
        const processes=document.querySelectorAll('#transcript .execution-block');
        if(processes.length!==1 || !document.getElementById('transcript').textContent.includes('应保留的真实历史消息') || !/已完成/.test(processes[0].querySelector('summary').textContent))throw Error('excluding the queue seed removed real user history');
      });
    });
    await t.test('logical failed delivery updates its original process and sending clears it',async()=>{
      await setup();
      await page.evaluate(async()=>{
        const f=(globalThis as any).f;f.send('logical-rejected');f.check(['logical-rejected'],'initial logical send');
        const local=f.core.optimisticMessages()[0];local.status='sending';
        f.core.accessApi=async()=>({command:{requestId:local.requestId,sessionId:'session',state:'failed'}});
        await f.core.reconcileMainRequests();f.check(['logical-rejected'],'failed logical lookup');
        const [row,,summary]=f.saved.get('logical-rejected');
        if(row.querySelector('.timeline-entry').dataset.running!=='false' || !/未.*发送|发送.*失败/.test(summary.textContent) || /等待模型/.test(summary.textContent))throw Error('failed logical message still waits for the model');
        f.core.accessApi=async()=>({command:{requestId:local.requestId,sessionId:'session',state:'dispatching'}});
        await f.core.reconcileMainRequests();f.check(['logical-rejected'],'logical sending again');
        if(row.querySelector('.timeline-entry').dataset.running!=='true' || /未.*发送|发送.*失败/.test(summary.textContent))throw Error('logical retry retained its terminal failure');
      });
    });
  } finally {await browser.close();}
});


