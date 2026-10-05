import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../www/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../www/index.html',import.meta.url),'utf8');
const styles=readFileSync(new URL('../www/styles.css',import.meta.url),'utf8');
const htmlIds=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));

function harness({reduced=false,autoBoot=false,autoResults={},storage={},queueFrames=false,frameMs=1000/60}={}){
  const timers=new Map();let nextTimer=0,now=0;
  const nodes=new Map();
  let domReady;
  class TextNode{
    constructor(data=''){this._data=data;this.parent=null}
    get data(){return this._data}
    set data(value){this._data=value;if(this.parent)this.parent.textContent=value}
    appendData(value){this.data+=value}
  }
  class Node{
    constructor(id=''){this.id=id;this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.style={setProperty(){}};this.attrs={};this.children=[];this.dataset={};this.listeners=new Map();
      this._scrollTop=0;this.scrollWrites=0;this.scrollHistory=[];this.scrollHeight=0;this.clientHeight=0;
      this.classList={values:new Set(),add:v=>this.classList.values.add(v),remove:v=>this.classList.values.delete(v),
        toggle:(v,on)=>{if(on===undefined)on=!this.classList.values.has(v);on?this.classList.values.add(v):this.classList.values.delete(v)},
        contains:v=>this.classList.values.has(v)};}
    get scrollTop(){return this._scrollTop}
    set scrollTop(value){this._scrollTop=value;this.scrollWrites++;this.scrollHistory.push(value)}
    append(...children){for(const child of children)if(child instanceof Node||child instanceof TextNode)child.parent=this;
      this.children.push(...children)}
    get childNodes(){return this.children}
    replaceChildren(...children){this.children=[];this.append(...children)}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this)}
    setAttribute(key,value){this.attrs[key]=value}
    getBoundingClientRect(){return {top:500,height:132}}
    focus(){document.activeElement=this}
    addEventListener(event,handler){this.listeners.set(event,[...(this.listeners.get(event)||[]),handler])}
    fire(event){for(const handler of this.listeners.get(event)||[])handler({target:this})}
    querySelector(selector){if(selector.startsWith('.')&&this.className?.split(' ').includes(selector.slice(1)))return this;
      for(const child of this.children){const found=child.querySelector?.(selector);if(found)return found}return null}
    querySelectorAll(){return []}
  }
  const frames=[];
  const document={activeElement:null,documentElement:new Node('html'),getElementById:id=>{
      if(id==='live-progress')return nodes.get('chat-content')?.children.find(child=>child.id==='live-progress')||null;
      if(!htmlIds.has(id))return null;
      if(!nodes.has(id)){const node=new Node(id);
        if(['toast','attachment-drafts','attachment-popover','model-popover','image-preview'].includes(id))node.hidden=true;nodes.set(id,node)}return nodes.get(id)},
    createElement:()=>new Node(),createTextNode:value=>new TextNode(value),
    addEventListener:(event,handler)=>{if(event==='DOMContentLoaded')domReady=handler},
    querySelectorAll:()=>[],querySelector:()=>new Node()};
  const bridge=[];
  let observed=null;
  class ResizeObserver{observe(node){assert.ok(node instanceof Node);assert.ok(htmlIds.has(node.id));observed=node}}
  const window={innerHeight:700,matchMedia:()=>({matches:reduced,addEventListener(){}}),addEventListener:()=>{},ResizeObserver,
    weftNative:{postMessage(json){const request=JSON.parse(json);bridge.push(request);
      if(autoBoot)queueMicrotask(()=>{
        const results={'app.bootstrap':{loggedIn:false,username:'',owner:'',model:null,busy:false},
          'settings.appearance':{value:'light'},'auth.me':{displayName:'本机个人空间'},...autoResults};
        window.weftNative.onmessage({data:JSON.stringify({id:request.id,ok:true,result:results[request.method]||{}})});
      });
    }}};
  const saved=new Map(Object.entries(storage));
  const localStorage={setItem(key,value){saved.set(key,String(value))},removeItem(key){saved.delete(key)},
    getItem(key){return saved.get(key)??null},key(index){return [...saved.keys()][index]??null},get length(){return saved.size}};
  const context=vm.createContext({document,window,localStorage,URL,
    setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay,due:now+delay});return id},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>{if(queueFrames){frames.push(fn);return frames.length}fn(now);return 0},ResizeObserver,console});
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  const node=id=>document.getElementById(id);
  const flush=async()=>{await Promise.resolve();await Promise.resolve()};
  const reply=(index,result,error)=>{const request=bridge[index];const task=run(`pending.get('${request.id}')`);
    run(`pending.delete('${request.id}')`);timers.delete(task.timer);
    if(error)task.reject(new Error(error));else task.resolve(result)};
  const advance=ms=>{now+=ms;while(true){const due=[...timers].find(([,timer])=>timer.due<=now);if(!due)break;
    timers.delete(due[0]);due[1].fn()}};
  const flushFrame=()=>{now+=frameMs;const callbacks=frames.splice(0);for(const callback of callbacks)callback(now)};
  return {run,node,timers,bridge,flush,reply,advance,frames,flushFrame,document,storage:saved,domReady:()=>domReady(),observed:()=>observed};
}

test('real HTML IDs support bootstrap and ResizeObserver without app.failed',async()=>{
  assert.equal(htmlIds.has('composer-dock'),true);
  const h=harness({autoBoot:true});
  assert.equal(h.node('composer-dock')?.id,'composer-dock');
  assert.equal(h.node('missing-composer'),null);
  h.domReady();
  for(let i=0;i<20&&!h.bridge.some(request=>request.method==='app.ready');i++)await h.flush();
  assert.equal(h.observed(),h.node('composer-dock'));
  assert.equal(h.bridge.some(request=>request.method==='app.ready'),true,JSON.stringify(h.bridge));
  assert.equal(h.bridge.some(request=>request.method==='app.failed'),false);
});

test('bootstrap restores a new-conversation draft before the empty composer can overwrite it',async()=>{
  const text='重启后继续写这条新对话';
  const h=harness({autoBoot:true,storage:{'weftmate-draft:A:new':text},autoResults:{
    'app.bootstrap':{loggedIn:true,username:'Alice',owner:'A',model:null,busy:false},
    'conversations.list':{conversations:[]},
    'shared.sessions.list':{source:'host',hostAvailable:false,sessions:[]},
    'attachments.list':{attachments:[]},
    'auth.me':{displayName:'Alice',connectionVerified:true}
  }});
  h.domReady();
  for(let i=0;i<30&&!h.bridge.some(request=>request.method==='app.ready');i++)await h.flush();
  assert.equal(h.node('draft').value,text);
  assert.equal(h.storage.get('weftmate-draft:A:new'),text);
  assert.equal(h.run('state.conversationId'),null);
});

test('Android updates show the official package link and QR while Back keeps the draft',async()=>{
  const h=harness();h.run(`state.loggedIn=true;state.owner='A';state.page='updates';
    call=async method=>method==='updates.status'?{activeVersion:'0.8.0（内置）',nativeVersion:'0.8.0',autoEnabled:true}:{};
    document.getElementById('draft').value='返回后仍在';updateComposer()`);
  await h.run("updatesPage(document.getElementById('page-content'))");
  const link=h.node('page-content').querySelector('.native-download-link');
  const qr=h.node('page-content').querySelector('.native-download-qr');
  assert.equal(link.attrs.href,'https://www.weftmate.com/downloads/?platform=android');
  assert.equal(qr.src,'qr/android.svg');assert.match(qr.alt,/安卓下载页面二维码/);
  h.run('handleBack()');assert.equal(h.run('state.page'),'chat');
  assert.equal(h.node('draft').value,'返回后仍在');
});

test('error toast is tappable, visibly fades, and reentry cancels an older hide',()=>{
  const h=harness();h.run('toast("第一次失败",true)');
  assert.equal(h.node('toast').hidden,false);assert.equal(h.node('toast').classList.contains('error'),true);
  h.run('closeToast()');assert.equal(h.node('toast').hidden,false);
  assert.equal(h.node('toast').classList.contains('leaving'),true);
  const oldHide=[...h.timers.values()].find(t=>t.delay===420);
  h.run('toast("第二次失败",true)');oldHide.fn();
  assert.equal(h.node('toast').hidden,false);assert.equal(h.node('toast').textContent,'第二次失败');
  h.run('closeToast()');[...h.timers.values()].find(t=>t.delay===420).fn();
  assert.equal(h.node('toast').hidden,true);
  const reduced=harness({reduced:true});reduced.run('toast("失败",true);closeToast()');
  assert.equal([...reduced.timers.values()].some(t=>t.delay===0),true);
});

test('transient chat errors use only the toast while ordinary progress stays inline',()=>{
  const h=harness();h.run('status("正在保存消息…")');
  assert.equal(h.node('chat-status').textContent,'正在保存消息…');
  h.run('status("请先配置手机模型",true)');
  assert.equal(h.node('chat-status').textContent,'');
  assert.equal(h.node('chat-status').classList.contains('error'),false);
  assert.equal(h.node('toast').textContent,'请先配置手机模型');
  assert.equal(h.node('toast').classList.contains('error'),true);
  h.run('closeToast()');
  assert.equal(h.node('toast').classList.contains('leaving'),true);
});

test('attachment draft belongs to account and conversation, and only receipt IDs cross the bridge',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1"');
  const pending=h.run('pickAttachment("image")');
  assert.equal(h.bridge[0].method,'attachments.pick');
  assert.deepEqual(JSON.parse(JSON.stringify(h.bridge[0].params)),{kind:'image',conversationId:'c1',viewGeneration:0});
  h.reply(0,{pending:true,requestId:'pick-1'});await pending;
  h.run('processEvent({event:"attachment.result",data:{requestId:"pick-1",conversationId:"c1",status:"selected",viewGeneration:0}})');
  assert.equal(h.bridge[1].method,'attachments.list');
  h.reply(1,{attachments:[{attachmentId:'attachment-00000000-0000-4000-8000-0000000000a1',kind:'image',name:'图.png'}]});await h.flush();
  assert.equal(h.node('attachment-drafts').hidden,false);
  h.run('state.conversationId="c2";renderAttachmentDrafts()');assert.equal(h.node('attachment-drafts').hidden,true);
  h.run('state.conversationId="c1";state.owner="B";renderAttachmentDrafts()');assert.equal(h.node('attachment-drafts').hidden,true);
  h.run('state.owner="A";renderAttachmentDrafts()');assert.equal(h.node('attachment-drafts').hidden,false);
  const removing=h.run('removeAttachment("attachment-00000000-0000-4000-8000-0000000000a1")');assert.equal(h.bridge[2].method,'attachments.remove');
  h.reply(2,{});await removing;assert.equal(h.node('attachment-drafts').hidden,true);
});

test('unknown native picker leaves text draft and reports failure',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1"');h.node('draft').value='保留内容';
  const pending=h.run('pickAttachment("file")');h.reply(0,null,'METHOD_UNKNOWN');await pending;
  assert.equal(h.node('draft').value,'保留内容');assert.equal(h.node('attachment-drafts').hidden,true);
  assert.match(h.node('toast').textContent,/版本不支持/);
  assert.equal(h.node('chat-status').textContent,'');
});

test('picker event after more than 45 seconds restores draft without a bridge timeout',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1"');
  h.node('draft').value='保留提问';const opening=h.run('pickAttachment("image")');
  h.reply(0,{pending:true,requestId:'slow-pick'});await opening;
  assert.equal(h.node('attachment-pick-status').hidden,false);
  h.advance(46000);await h.flush();
  assert.equal(h.node('attachment-pick-status').hidden,false);
  assert.doesNotMatch(h.node('chat-status').textContent,/超时|不兼容/);
  h.run('processEvent({event:"attachment.result",data:{requestId:"slow-pick",conversationId:"c1",status:"selected",viewGeneration:0}})');
  const listIndex=h.bridge.findIndex(request=>request.method==='attachments.list');
  h.reply(listIndex,{attachments:[{attachmentId:'attachment-00000000-0000-4000-8000-0000000000a2',kind:'image',name:'晚选图片.png'}]});await h.flush();
  assert.equal(h.node('attachment-pick-status').hidden,true);
  assert.equal(h.node('attachment-drafts').hidden,false);
  assert.equal(h.node('draft').value,'保留提问');
});

test('picker cancellation and Back clear waiting without losing text or accepting late results',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1"');
  h.node('draft').value='未发送文字';
  const first=h.run('pickAttachment("file")');h.reply(0,{pending:true,requestId:'cancelled'});await first;
  h.run('pickAttachment("file")');assert.equal(h.bridge.filter(request=>request.method==='attachments.pick').length,1);
  h.run('processEvent({event:"attachment.result",data:{requestId:"cancelled",conversationId:"c1",status:"cancelled",viewGeneration:0}})');
  assert.equal(h.node('attachment-pick-status').hidden,true);assert.equal(h.node('draft').value,'未发送文字');
  const second=h.run('pickAttachment("file")');h.reply(1,{pending:true,requestId:'backed'});await second;
  h.run('handleBack()');assert.equal(h.node('attachment-pick-status').hidden,true);
  h.run('processEvent({event:"attachment.result",data:{requestId:"backed",conversationId:"c1",status:"selected",viewGeneration:0}})');
  assert.equal(h.bridge.some(request=>request.method==='attachments.list'),false);
  assert.equal(h.node('draft').value,'未发送文字');
});

test('failed picker event shows a dismissible error and leaves the message draft',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1"');h.node('draft').value='仍在草稿';
  const opening=h.run('pickAttachment("image")');h.reply(0,{pending:true,requestId:'failed-pick'});await opening;
  h.run('processEvent({event:"attachment.result",data:{requestId:"failed-pick",conversationId:"c1",status:"failed",errorCode:"ATTACHMENT_UNREADABLE",viewGeneration:0}})');
  assert.equal(h.node('attachment-pick-status').hidden,true);
  assert.match(h.node('toast').textContent,/无法读取/);
  assert.equal(h.node('draft').value,'仍在草稿');
  h.run('closeToast()');assert.equal(h.node('toast').classList.contains('leaving'),true);
});

test('account switch rejects late picker event and old picker timeout reports app incompatibility',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1";resetMemoryForAuthBoundary=()=>{}');
  const first=h.run('pickAttachment("image")');h.reply(0,{pending:true,requestId:'old-account'});await first;
  h.run('processEvent({event:"account.transition",data:{pending:true}});state.owner="B";state.transitionPending=false');
  h.run('processEvent({event:"attachment.result",data:{requestId:"old-account",conversationId:"c1",status:"selected",viewGeneration:0}})');
  assert.equal(h.bridge.some(request=>request.method==='attachments.list'),false);
  const legacy=harness();legacy.run('state.loggedIn=true;state.owner="A";state.conversationId="c1"');
  const pending=legacy.run('pickAttachment("image")');legacy.advance(45000);await pending;
  assert.match(legacy.node('toast').textContent,/版本.*不支持/);
  assert.equal(legacy.node('chat-status').textContent,'');
  assert.equal(legacy.node('attachment-pick-status').hidden,true);
});

test('attachment only send does not retry, preserves draft on error, and clears on accepted reply',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1";attachmentDrafts.set(attachmentKey(),[{attachmentId:"a1",kind:"file",name:"a.txt"}]);renderAttachmentDrafts();updateComposer();listConversations=async()=>{};renderConversation=async()=>{};scrollBottom=()=>{}');
  assert.equal(h.node('send-button').disabled,false);
  const first=h.run('send()');h.run('send()');assert.equal(h.bridge.length,1);
  assert.equal(h.bridge[0].method,'chat.send');
  assert.deepEqual(JSON.parse(JSON.stringify(h.bridge[0].params)),{conversationId:'c1',text:'',attachmentIds:['a1']});
  h.reply(0,null,'METHOD_UNKNOWN');await first;
  assert.equal(h.node('attachment-drafts').hidden,false);assert.equal(h.node('send-button').disabled,false);
  const second=h.run('send()');h.reply(1,{conversationId:'c1'});await second;
  assert.equal(h.node('attachment-drafts').hidden,true);assert.equal(h.bridge.filter(x=>x.method==='chat.send').length,2);
});

test('HTTP failure classification is safe and can remain in the conversation',()=>{
  const h=harness();
  assert.match(h.run('turnFailure("MODEL_UPSTREAM_ERROR",400)'),/模型 ID/);
  assert.match(h.run('turnFailure("MODEL_UPSTREAM_ERROR",429)'),/稍后重试/);
  assert.equal(h.run('turnFailure("SECRET_RESPONSE_BODY",null)'),'操作未完成，请稍后重试');
  assert.match(h.run('safeError(new Error("IMAGE_REJECTED"))'),/模型不支持图片.*草稿/);
});

test('restored failed turn keeps a safe reason in its conversation and back closes selection first',async()=>{
  const h=harness();h.run('state.page="chat";state.conversationId="c1";state.loggedIn=true;state.owner="A"');
  h.run('call=async(method)=>method==="attachments.list"?{attachments:[{attachmentId:"attachment-00000000-0000-4000-8000-0000000000a3",kind:"file",name:"saved.txt"}]}:{messages:[{role:"user",text:"你好"}],receipts:[],turnStatus:"failed",turnErrorCode:"MODEL_UPSTREAM_ERROR",upstreamHttpStatus:400}');
  await h.run('renderConversation()');
  await h.flush();
  const card=h.node('chat-content').children.at(-1);
  assert.match(card.children[0].textContent,/模型 ID/);assert.doesNotMatch(card.children[0].textContent,/上游响应体/);
  assert.equal(card.children[1].textContent,'编辑后重试');
  assert.equal(h.node('attachment-drafts').hidden,false);
  h.run('openAttachmentMenu();handleBack()');
  assert.equal(h.run('state.attachmentMenu'),false);
  assert.equal(h.document.activeElement,h.node('plus-button'));
});

test('accepted send followed by upstream failure restores private attachments without resending',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1";attachmentDrafts.set(attachmentKey(),[{attachmentId:"a1",kind:"file",name:"a.txt"}]);renderAttachmentDrafts();updateComposer();listConversations=async()=>{};renderConversation=async()=>{}');
  h.node('draft').value='问题';const accepted=h.run('send()');h.reply(0,{conversationId:'c1'});await accepted;
  assert.equal(h.node('attachment-drafts').hidden,true);
  h.run('processEvent({event:"chat.finished",data:{conversationId:"c1",status:"failed",turnErrorCode:"MODEL_UPSTREAM_ERROR",upstreamHttpStatus:400}})');
  assert.equal(h.bridge[1].method,'attachments.list');
  h.reply(1,{attachments:[{attachmentId:'attachment-00000000-0000-4000-8000-0000000000a1',kind:'file',name:'a.txt'}]});await h.flush();
  assert.equal(h.node('attachment-drafts').hidden,false);
  assert.equal(h.node('send-button').disabled,false);
  assert.match(h.node('toast').textContent,/模型 ID/);
  assert.equal(h.node('chat-status').textContent,'');
  assert.equal(h.bridge.filter(request=>request.method==='chat.send').length,1);
});

test('completed new turn before send reply adopts its conversation and keeps terminal status',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";listConversations=async()=>{};renderConversation=async()=>{}');
  h.node('draft').value='这是什么图片';
  const sending=h.run('send()');
  assert.equal(h.bridge[0].method,'chat.send');
  h.run('processEvent({event:"chat.started",data:{conversationId:"new-1",turnId:"turn-1"}})');
  h.run('processEvent({event:"chat.finished",data:{conversationId:"new-1",turnId:"turn-1",status:"completed"}})');
  assert.equal(h.run('state.conversationId'),'new-1');
  assert.equal(h.node('draft').value,'');
  assert.equal(h.node('chat-status').textContent,'回复已保存');
  h.reply(0,{conversationId:'new-1',turnId:'turn-1'});await sending;
  assert.equal(h.node('chat-status').textContent,'回复已保存');
  assert.equal(h.run('state.busy'),false);
  assert.equal(h.bridge.filter(request=>request.method==='chat.send').length,1);
});

test('send timeout without durable evidence preserves draft and blocks accidental resend',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A"');
  h.node('draft').value='不能重复发送';const sending=h.run('send()');
  h.advance(45000);await sending;
  assert.equal(h.node('draft').value,'不能重复发送');
  assert.match(h.node('chat-status').textContent,/结果待确认/);
  assert.match(h.node('toast').textContent,/结果尚未确认/);
  assert.equal(h.node('send-button').disabled,true);
  await h.run('send()');
  assert.equal(h.bridge.filter(request=>request.method==='chat.send').length,1);
});

test('durable completion before bridge timeout resolves saving status without a second send',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";listConversations=async()=>{};renderConversation=async()=>{}');
  h.node('draft').value='红图';const sending=h.run('send()');
  h.run('processEvent({event:"chat.finished",data:{conversationId:"new-2",turnId:"turn-2",status:"completed"}})');
  h.advance(45000);await sending;
  assert.equal(h.run('state.conversationId'),'new-2');
  assert.equal(h.node('chat-status').textContent,'回复已保存');
  assert.equal(h.node('toast').classList.contains('error'),false);
  assert.equal(h.bridge.filter(request=>request.method==='chat.send').length,1);
});

test('account transition hides the previous account attachment view',()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1";attachmentDrafts.set(attachmentKey(),[{attachmentId:"a1",kind:"file",name:"a.txt"}]);renderAttachmentDrafts();resetMemoryForAuthBoundary=()=>{}');
  assert.equal(h.node('attachment-drafts').hidden,false);
  h.run('processEvent({event:"account.transition",data:{pending:true}})');
  assert.equal(h.node('attachment-drafts').hidden,true);
  h.run('state.owner="B";state.transitionPending=false;renderAttachmentDrafts()');
  assert.equal(h.node('attachment-drafts').hidden,true);
});

test('native draft list restores only the current account and conversation',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1";loadDraft()');
  assert.deepEqual(JSON.parse(JSON.stringify(h.bridge[0].params)),{conversationId:'c1'});
  h.run('state.owner="B";state.authEpoch++;state.conversationId="c2";loadDraft()');
  h.reply(0,{attachments:[{attachmentId:'attachment-00000000-0000-4000-8000-0000000000a4',kind:'image',name:'A.png'}]});await h.flush();
  assert.equal(h.node('attachment-drafts').hidden,true);
  h.reply(1,{attachments:[{attachmentId:'attachment-00000000-0000-4000-8000-0000000000b1',kind:'file',name:'B.txt'}]});await h.flush();
  assert.equal(h.node('attachment-drafts').hidden,false);
  assert.equal(h.run('currentAttachments()[0].attachmentId'),'attachment-00000000-0000-4000-8000-0000000000b1');
  assert.equal(h.run('attachmentDrafts.has("A:c1")'),false);
});

test('late native list cannot revive an attachment removed while it was loading',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="c1";attachmentDrafts.set(attachmentKey(),[{attachmentId:"a1",kind:"file",name:"a.txt"}]);loadDraft()');
  const removing=h.run('removeAttachment("a1")');h.reply(1,{});await removing;
  h.reply(0,{attachments:[{attachmentId:'a1',kind:'file',name:'a.txt'}]});await h.flush();
  assert.equal(h.node('attachment-drafts').hidden,true);
});

test('shared history follows exact session ID across pages and rejects the previous selection',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.sharedHostAvailable=true;state.sharedSessions=[{sessionId:"pc1",title:"电脑甲",sendAvailable:true,source:"host"},{sessionId:"pc2",title:"电脑乙",sendAvailable:false,source:"host"}]');
  h.run('selectSharedSession("pc1")');
  const first=h.bridge.findIndex(request=>request.method==='shared.sessions.events'&&request.params.sessionId==='pc1');
  h.run('selectSharedSession("pc2")');
  const second=h.bridge.findIndex(request=>request.method==='shared.sessions.events'&&request.params.sessionId==='pc2');
  h.reply(first,{source:'host',sessionId:'pc1',events:[{seq:1,type:'user.message',data:{text:'甲的私有内容'}}],nextSeq:1,hasMore:false});
  await h.flush();assert.equal(h.run('state.sharedEvents.length'),0);
  h.reply(second,{source:'host',sessionId:'pc2',events:[{seq:2,type:'user.message',data:{text:'乙的问题'}}],nextSeq:2,hasMore:true});
  await h.flush();
  const next=h.bridge.findIndex(request=>request.method==='shared.sessions.events'&&request.params.sessionId==='pc2'&&request.params.afterSeq===2);
  assert.ok(next>=0);h.reply(next,{source:'host',sessionId:'pc2',events:[{seq:3,type:'assistant.message',data:{text:'乙的回答'}},{seq:4,type:'turn.ended',data:{reason:'completed'}}],nextSeq:4,hasMore:false});
  await h.flush();
  assert.equal(h.run('state.sharedEvents.length'),3);
  assert.equal(h.run('state.sharedNextSeq'),4);
  assert.equal(h.node('draft').disabled,true);
  assert.equal(h.node('model-button').disabled,true);
  assert.equal(h.node('chat-content').children.some(node=>node.textContent==='甲的私有内容'),false);
});

test('shared send keeps phone drafts separate and blocks uncertain duplicate',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.chatSource="host";state.sharedSessionId="pc1";state.sharedHostAvailable=true;state.sharedSessions=[{sessionId:"pc1",title:"电脑",sendAvailable:true,source:"host"}];state.conversationId="phone1";attachmentDrafts.set("A:phone1",[{attachmentId:"local-image",kind:"image",name:"local.png"}])');
  h.node('draft').value='发送到电脑';h.run('updateComposer()');
  assert.equal(h.node('attachment-drafts').hidden,true);
  h.run('openAttachmentMenu()');assert.equal(h.run('state.attachmentMenu'),true);
  assert.equal(h.node('pick-file').hidden,false);assert.equal(h.node('attachment-note').hidden,false);
  h.run('closeAttachmentMenu()');assert.equal(h.bridge.some(request=>request.method==='attachments.pick'),false);
  const sending=h.run('send()');const request=h.bridge.find(item=>item.method==='shared.send');
  assert.ok(request);assert.deepEqual(JSON.parse(JSON.stringify(request.params)),{sessionId:'pc1',text:'发送到电脑',requestId:request.params.requestId});
  assert.match(request.params.requestId,/^ui-[a-z0-9-]+$/);
  h.reply(h.bridge.indexOf(request),{source:'host',sessionId:'pc1',requestId:request.params.requestId,kind:'session.message',state:'uncertain'});
  await sending;await h.run('send()');
  assert.equal(h.bridge.filter(item=>item.method==='shared.send').length,1);
  assert.equal(h.node('draft').value,'发送到电脑');
  assert.equal(h.run('attachmentDrafts.get("A:phone1").length'),1);
  assert.match(h.node('chat-status').textContent,/待核对/);
});

test('host image picker scopes drafts to the exact DSH session and offers file selection',async()=>{
  const h=harness(),id='attachment-00000000-0000-4000-8000-000000000001';
  h.run('state.loggedIn=true;state.owner="A";state.chatSource="host";state.sharedSessionId="session-one";state.sharedSessions=[{sessionId:"session-one",sendAvailable:true,source:"host"},{sessionId:"session-two",sendAvailable:true,source:"host"}]');
  h.run('openAttachmentMenu()');assert.equal(h.node('pick-file').hidden,false);
  assert.equal(h.node('attachment-note').hidden,false);assert.match(html,/普通文件将以文件卡显示/);
  h.run('closeAttachmentMenu()');
  const picking=h.run('pickAttachment("image")');
  assert.deepEqual(JSON.parse(JSON.stringify(h.bridge[0].params)),{kind:'image',conversationId:'session-one',viewGeneration:0});
  h.reply(0,{pending:true,requestId:'host-pick'});await picking;
  h.run('processEvent({event:"attachment.result",data:{requestId:"host-pick",conversationId:"session-one",status:"selected",viewGeneration:0}})');
  assert.equal(h.bridge[1].method,'attachments.list');
  assert.equal(h.bridge[1].params.conversationId,'session-one');
  h.reply(1,{attachments:[{attachmentId:id,kind:'image',name:'电脑.png',thumbnailDataUrl:'data:image/png;base64,AA=='},
    {attachmentId:`sha256:${'f'.repeat(64)}`,kind:'image',name:'已发送历史.png'}]});await h.flush();
  assert.equal(h.node('attachment-drafts').hidden,false);
  assert.equal(h.run('currentAttachments().length'),1,'durable history SHA is never treated as a removable draft');
  assert.equal(h.run('currentAttachments()[0].attachmentId'),id);
  h.run('state.sharedSessionId="session-two";renderAttachmentDrafts()');
  assert.equal(h.node('attachment-drafts').hidden,true);
  h.run('state.sharedSessionId="session-one";state.owner="B";renderAttachmentDrafts()');
  assert.equal(h.node('attachment-drafts').hidden,true);
  h.run('state.owner="A";renderAttachmentDrafts()');
  const removing=h.run(`removeAttachment("${id}")`);
  const remove=h.bridge.find(item=>item.method==='attachments.remove');
  assert.deepEqual(JSON.parse(JSON.stringify(remove.params)),{attachmentId:id,conversationId:'session-one'});
  h.reply(h.bridge.indexOf(remove),{});await removing;
  assert.equal(h.run('currentAttachments().length'),0);
});

test('host file picker keeps one attachment UUID under the selected DSH session',async()=>{
  const h=harness(),id='attachment-00000000-0000-4000-8000-000000000003';
  h.run('state.loggedIn=true;state.owner="A";state.chatSource="host";state.sharedSessionId="session-file";state.sharedSessions=[{sessionId:"session-file",sendAvailable:true,source:"host"}]');
  const picking=h.run('pickAttachment("file")');
  assert.deepEqual(JSON.parse(JSON.stringify(h.bridge[0].params)),
    {kind:'file',conversationId:'session-file',viewGeneration:0});
  h.reply(0,{pending:true,requestId:'host-file-pick'});await picking;
  h.run('processEvent({event:"attachment.result",data:{requestId:"host-file-pick",conversationId:"session-file",status:"selected",viewGeneration:0}})');
  assert.equal(h.bridge[1].method,'attachments.list');
  h.reply(1,{attachments:[{attachmentId:id,kind:'file',name:'资料.csv'}]});await h.flush();
  assert.equal(h.node('attachment-drafts').hidden,false);
  assert.equal(h.run('currentAttachments()[0].attachmentId'),id);
  assert.equal(h.run('currentAttachments()[0].kind'),'file');
});

test('host draft preview uses its session-scoped attachment-UUID original instead of the thumbnail',()=>{
  const h=harness(),sessionId='session-00000000-0000-4000-8000-000000000001',
    attachmentId='attachment-00000000-0000-4000-8000-000000000002',
    previewUrl=`https://appassets.androidplatform.net/media/image/${attachmentId}?conversationId=${sessionId}`,
    displayUrl=`${previewUrl}&variant=display`;
  h.run(`state.loggedIn=true;state.owner="A";state.chatSource="host";state.sharedSessionId="${sessionId}";state.sharedSessions=[{sessionId:"${sessionId}",sendAvailable:true,source:"host"}];attachmentDrafts.set(attachmentKey(),[{attachmentId:"${attachmentId}",kind:"image",name:"蓝色原图.png",thumbnailDataUrl:"data:image/png;base64,AA==",previewUrl:"${previewUrl}",displayUrl:"${displayUrl}"}]);renderAttachmentDrafts()`);
  const trigger=h.node('attachment-drafts').children[0].children.find(node=>node.className==='attachment-preview-trigger');
  assert.equal(trigger.children[0].src,displayUrl);
  trigger.fire('click');
  assert.equal(h.node('image-preview-image').src,previewUrl);
  assert.match(h.node('image-preview-image').alt,/原图/);
  assert.equal(h.node('image-preview-note').textContent,'待发送原图');
  h.run('handleBack()');h.advance(160);
  h.run(`state.sharedSessionId="session-00000000-0000-4000-8000-000000000099"`);
  trigger.fire('click');assert.equal(h.node('image-preview').hidden,true,'another session cannot reopen the draft');
});

test('draft display URL stays inside its owner and conversation and falls back for old data',()=>{
  const h=harness(),conversationId='conversation-00000000-0000-4000-8000-000000000001',
    attachmentId='attachment-00000000-0000-4000-8000-000000000002',
    previewUrl=`https://appassets.androidplatform.net/media/image/${attachmentId}?conversationId=${conversationId}`,
    displayUrl=`${previewUrl}&variant=display`;
  h.run(`state.loggedIn=true;state.owner="A";state.conversationId="${conversationId}";attachmentDrafts.set(attachmentKey(),[
    {attachmentId:"${attachmentId}",kind:"image",name:"大图.png",thumbnailDataUrl:"data:image/png;base64,AA==",previewUrl:"${previewUrl}",displayUrl:"${displayUrl}"}]);renderAttachmentDrafts()`);
  const trigger=h.node('attachment-drafts').children[0].children[0];
  assert.equal(trigger.children[0].src,displayUrl);
  h.run('state.owner="B";renderAttachmentDrafts()');
  assert.equal(h.node('attachment-drafts').hidden,true);
  h.run(`state.owner="A";attachmentDrafts.set(attachmentKey(),[
    {attachmentId:"${attachmentId}",kind:"image",name:"旧图.png",thumbnailDataUrl:"data:image/png;base64,AA==",previewUrl:"${previewUrl}"}]);renderAttachmentDrafts()`);
  assert.equal(h.node('attachment-drafts').children[0].children[0].children[0].src,'data:image/png;base64,AA==');
});

test('host image send uses one request ID and clears image drafts only after acceptance',async()=>{
  const id='attachment-00000000-0000-4000-8000-000000000002',setup=`state.loggedIn=true;state.owner="A";state.chatSource="host";state.sharedSessionId="session-one";state.sharedHostAvailable=true;state.sharedSessions=[{sessionId:"session-one",title:"电脑",sendAvailable:true,source:"host"}];attachmentDrafts.set("A:host:session-one",[{attachmentId:"${id}",kind:"image",name:"蓝图.png"}]);renderAttachmentDrafts();updateComposer()`;
  const uncertain=harness();uncertain.run(setup);
  assert.equal(uncertain.node('send-button').disabled,false,'image-only message can be sent');
  const attempt=uncertain.run('send()');const post=uncertain.bridge.find(item=>item.method==='shared.send');
  assert.deepEqual(JSON.parse(JSON.stringify(post.params)),{sessionId:'session-one',text:'',requestId:post.params.requestId,attachmentIds:[id]});
  uncertain.reply(uncertain.bridge.indexOf(post),{source:'host',sessionId:'session-one',requestId:post.params.requestId,state:'uncertain'});await attempt;
  assert.equal(uncertain.run('currentAttachments().length'),1);
  await uncertain.run('send()');assert.equal(uncertain.bridge.filter(item=>item.method==='shared.send').length,1);
  const checking=uncertain.run('loadSharedOutbox()');const outbox=uncertain.bridge.findIndex(item=>item.method==='shared.outbox.list');
  uncertain.reply(outbox,{source:'host',commands:[{sessionId:'session-one',kind:'session.message',requestId:post.params.requestId,state:'accepted'}]});await checking;
  assert.equal(uncertain.run('currentAttachments().length'),0);
  const rejected=harness();rejected.run(setup);const rejectedSend=rejected.run('send()');const rejectedPost=rejected.bridge.find(item=>item.method==='shared.send');
  rejected.reply(rejected.bridge.indexOf(rejectedPost),{source:'host',sessionId:'session-one',requestId:rejectedPost.params.requestId,state:'rejected',errorCode:'IMAGE_REJECTED'});await rejectedSend;
  assert.equal(rejected.run('currentAttachments().length'),1,'rejected image remains a draft');
});

test('host session waits for native outbox before another image request can be sent',async()=>{
  const h=harness(),id='attachment-00000000-0000-4000-8000-000000000004';
  h.run(`state.loggedIn=true;state.owner="A";state.sharedSessions=[{sessionId:"session-one",title:"电脑",sendAvailable:true,source:"host"}];attachmentDrafts.set("A:host:session-one",[{attachmentId:"${id}",kind:"image",name:"待核对.png"}]);selectSharedSession("session-one")`);
  assert.equal(h.run('state.sharedOutboxLoading'),true);
  assert.equal(h.node('send-button').disabled,true);
  await h.run('send()');assert.equal(h.bridge.some(item=>item.method==='shared.send'),false);
  const outbox=h.bridge.findIndex(item=>item.method==='shared.outbox.list');
  assert.ok(outbox>=0);
  h.reply(outbox,{source:'host',commands:[{sessionId:'session-one',kind:'session.message',requestId:'saved',state:'uncertain'}]});
  await h.flush();
  assert.equal(h.run('state.sharedOutboxLoading'),false);
  assert.equal(h.run('state.sharedPending.requestId'),'saved');
  await h.run('send()');assert.equal(h.bridge.some(item=>item.method==='shared.send'),false);
});

test('shared history previews only the exact session media URL and preserves text-only legacy rows',()=>{
  const h=harness(),id=`sha256:${'c'.repeat(64)}`,
    valid=`https://appassets.androidplatform.net/media/session/session-one/${id}`;
  h.run(`state.loggedIn=true;state.owner="A";state.chatSource="host";state.sharedSessionId="session-one";state.sharedHostAvailable=true;state.sharedSessions=[{sessionId:"session-one",title:"电脑",sendAvailable:true,source:"host"}];state.sharedEvents=[{seq:1,type:"user.message",data:{text:"看这张图",images:[{attachmentId:"${id}",name:"图.png",contentType:"image/png",size:1048576,width:1200,height:2400,previewUrl:"${valid}"},{attachmentId:"${id}",previewUrl:"https://evil.example/media/session/session-one/${id}"}]}},{seq:2,type:"assistant.message",data:{text:"旧文字回复"}}];renderSharedConversation()`);
  const user=h.node('chat-content').children.find(item=>item.className==='message user');
  const gallery=user.children.find(item=>item.className==='message-thumbnails');
  assert.equal(gallery.children.length,1);
  assert.equal(gallery.children[0].children.length,1,'image has no visible filename');
  assert.equal(gallery.children[0].children[0].src,valid);
  assert.equal(gallery.children[0].children[0].loading,'lazy');
  assert.equal(gallery.children[0].children[0].decoding,'async');
  assert.match(user.children.find(item=>item.className==='message-attachment-note').textContent,/1 张历史图片暂无法预览/);
  gallery.children[0].fire('click');assert.equal(h.node('image-preview-image').src,valid);
  h.run('handleBack()');h.advance(160);assert.equal(h.node('image-preview').hidden,true);
  assert.equal(h.run(`safeSessionPreviewUrl("${valid}?token=x","${id}","session-one")`),null);
  assert.equal(h.run(`safeSessionPreviewUrl("${valid.replace('session-one','session-two')}","${id}","session-one")`),null);
  assert.equal(h.run(`safeSessionPreviewUrl("${valid.replace(id,`sha256:${'e'.repeat(64)}`)}","${id}","session-one")`),null);
  assert.match(allText(h.node('chat-content')),/旧文字回复/);
});

test('accepted shared send clears its draft and shared stop uses the selected session',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.chatSource="host";state.sharedSessionId="pc1";state.sharedHostAvailable=true;state.sharedSessions=[{sessionId:"pc1",title:"电脑",sendAvailable:true,running:true,source:"host"}];state.sharedRunning=true;loadSharedHistory=async()=>{}');
  h.node('draft').value='继续这个目标';const sending=h.run('send()');
  const request=h.bridge.find(item=>item.method==='shared.send');
  h.reply(h.bridge.indexOf(request),{source:'host',sessionId:'pc1',requestId:request.params.requestId,kind:'session.message',state:'accepted'});
  await sending;
  assert.equal(h.node('draft').value,'');
  assert.match(h.node('chat-status').textContent,/已受理/);
  const stopping=h.run('stop()');const stopRequest=h.bridge.find(item=>item.method==='shared.stop');
  assert.deepEqual(JSON.parse(JSON.stringify(stopRequest.params)),{sessionId:'pc1',requestId:stopRequest.params.requestId});
  h.reply(h.bridge.indexOf(stopRequest),{source:'host',sessionId:'pc1',requestId:stopRequest.params.requestId,kind:'session.cancel',state:'accepted'});
  await stopping;assert.match(h.node('chat-status').textContent,/停止请求/);
  assert.equal(h.bridge.some(item=>item.method==='chat.stop'),false);
});

test('task stop is separate from chat stop and waits for task control evidence',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="things";state.thingsDetail="task-1"');
  const section=h.run('taskControlGroup("task-1",{state:"active",canSupplement:true,canStop:true,canResume:false},()=>true)');
  assert.match(allText(section),/请求停止这件事/);
  assert.doesNotMatch(allText(section),/恢复这件事/);
  const controls=section.querySelector('.group-body');
  controls.children.find(item=>item.textContent==='请求停止这件事').fire('click');
  const request=h.bridge.find(item=>item.method==='shared.tasks.stop');assert.ok(request);
  assert.equal(request.params.taskId,'task-1');assert.ok(request.params.requestId);
  assert.equal(h.bridge.some(item=>item.method==='shared.stop'),false);
  assert.doesNotMatch(h.node('toast').textContent,/已停止/);
  h.reply(h.bridge.indexOf(request),{task:{taskId:'task-1',control:{state:'stop_requested'}}});await h.flush();
  assert.match(h.node('toast').textContent,/停止意图已记录/);
});

test('task resume requires a new explicit instruction',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="things";state.thingsDetail="task-1"');
  const section=h.run('taskControlGroup("task-1",{state:"stop_requested",reasonCode:"TURN_ENDED_AFTER_STOP_REQUEST",canSupplement:false,canStop:false,canResume:true},()=>true)');
  assert.match(allText(section),/上一回合已结束.*尚不能确认是停止请求.*请写明下一步/);
  assert.doesNotMatch(allText(section),/执行端状态仍待核对/);
  const body=section.querySelector('.group-body');
  const input=body.children.find(item=>item.className==='task-supplement-input');
  const resume=body.children.find(item=>item.textContent==='恢复这件事');
  resume.fire('click');assert.equal(h.bridge.length,0);
  assert.match(h.node('toast').textContent,/先写明/);
  input.value='先核对已有文件，再补上摘要';input.fire('input');
  resume.fire('click');const request=h.bridge.find(item=>item.method==='shared.tasks.resume');
  assert.ok(request);assert.equal(request.params.text,'先核对已有文件，再补上摘要');
});

test('supplement and resume commands stay in their root file task card',()=>{
  const h=harness();h.run('state.sharedSessions=[{sessionId:"pc1",title:"新对话"}]');
  const grouped=h.run(`groupTaskActivities([
    {source:'host',kind:'session.message',commandId:'follow-2',rootTaskId:'root-1',taskAction:'resume',status:'accepted_by_dsh',sessionId:'pc1'},
    {source:'host',kind:'session.message',commandId:'follow-1',rootTaskId:'root-1',taskAction:'supplement',status:'accepted_by_dsh',sessionId:'pc1'},
    {source:'host',kind:'desktop.write_artifact',commandId:'file-1',taskId:'root-1',status:'observed',artifactId:'artifact-1',fileName:'结果.md',verification:{status:'observed'}},
    {source:'host',kind:'session.message',commandId:'root-1',status:'accepted_by_dsh',sessionId:'pc1'}])`);
  assert.equal(grouped.length,1);
  assert.equal(grouped[0].commandId,'root-1');
  assert.equal(h.run('hostActivityTitle(groupTaskActivities([{source:"host",kind:"session.message",commandId:"follow-1",rootTaskId:"root-1",taskAction:"supplement",status:"accepted_by_dsh"},{source:"host",kind:"desktop.write_artifact",commandId:"file-1",taskId:"root-1",status:"observed",artifactId:"artifact-1",fileName:"结果.md",verification:{status:"observed"}}])[0])'),'生成：结果.md');
  assert.match(h.run('taskActivityStatus(groupTaskActivities([{source:"host",kind:"session.message",commandId:"follow-1",rootTaskId:"root-1",taskAction:"supplement",status:"accepted_by_dsh"}])[0])'),/补充已送达.*待核对/);
});

test('older outbox snapshot cannot clear a newly submitted shared request',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.chatSource="host";state.sharedSessionId="pc1";state.sharedSessions=[{sessionId:"pc1",title:"电脑",sendAvailable:true,source:"host"}]');
  const loading=h.run('loadSharedOutbox()');const old=h.bridge.findIndex(item=>item.method==='shared.outbox.list');
  h.node('draft').value='新消息';const sending=h.run('send()');
  const sendRequest=h.bridge.find(item=>item.method==='shared.send');
  h.reply(old,{source:'host',commands:[]});await loading;
  assert.equal(h.run('state.sharedPending.requestId'),sendRequest.params.requestId);
  h.reply(h.bridge.indexOf(sendRequest),{source:'host',sessionId:'pc1',requestId:sendRequest.params.requestId,kind:'session.message',state:'uncertain'});await sending;
  assert.equal(h.run('state.sharedPending.state'),'uncertain');
});

test('account transition invalidates late shared history and clears its selection',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.sharedSessions=[{sessionId:"pc1",title:"电脑",sendAvailable:true,source:"host"}];resetMemoryForAuthBoundary=()=>{}');
  h.run('selectSharedSession("pc1")');const request=h.bridge.findIndex(item=>item.method==='shared.sessions.events');
  h.run('processEvent({event:"account.transition",data:{pending:true}});state.owner="B";state.transitionPending=false');
  h.reply(request,{source:'host',sessionId:'pc1',events:[{seq:1,type:'user.message',data:{text:'A 的内容'}}],nextSeq:1,hasMore:false});await h.flush();
  assert.equal(h.run('state.chatSource'),'phone');assert.equal(h.run('state.sharedSessionId'),null);
  assert.equal(h.run('state.sharedEvents.length'),0);
});

test('switching back to a phone conversation keeps local send on chat.send',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversationId="phone1";state.sharedSessions=[{sessionId:"pc1",title:"电脑",sendAvailable:true,source:"host"}];renderConversation=async()=>{};listConversations=async()=>{}');
  h.run('selectSharedSession("pc1")');
  h.run('selectConversation("phone1")');
  h.node('draft').value='手机消息';const sending=h.run('send()');
  const request=h.bridge.find(item=>item.method==='chat.send');assert.ok(request);
  assert.deepEqual(JSON.parse(JSON.stringify(request.params)),{conversationId:'phone1',text:'手机消息',attachmentIds:[]});
  assert.equal(h.bridge.some(item=>item.method==='shared.send'),false);
  h.reply(h.bridge.indexOf(request),{conversationId:'phone1'});await sending;
  assert.equal(h.run('state.chatSource'),'phone');
});

test('one searchable recent list mixes exact phone and computer IDs with honest model and execution source',()=>{
  assert.equal(html.includes('id="phone-tab"')||html.includes('id="host-tab"'),false);
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.conversations=[{id:"conversation-1",title:"手机照片",createdAt:"2026-09-26T10:00:00Z",modelName:"MiMo"},{id:"conversation-2",title:"外出记录",createdAt:"2026-09-24T10:00:00Z"}];state.sharedSessions=[{sessionId:"session-1",title:"项目分析",createdAt:"2026-09-27T10:00:00Z",sendAvailable:true,source:"host"}];renderConversationList()');
  const rows=h.node('conversation-list').children;
  assert.equal(rows.length,3);
  assert.match(allText(rows[0]),/项目分析.*电脑执行/);
  assert.doesNotMatch(allText(rows[0]),/模型未标记/);
  assert.match(allText(rows[1]),/手机照片.*MiMo.*手机执行/);
  assert.match(allText(rows[2]),/外出记录.*手机执行/);
  assert.doesNotMatch(allText(rows[2]),/模型未标记/);
  rows[0].fire('click');assert.equal(h.run('state.chatSource'),'host');assert.equal(h.run('state.sharedSessionId'),'session-1');
  rows[1].fire('click');assert.equal(h.run('state.chatSource'),'phone');assert.equal(h.run('state.conversationId'),'conversation-1');
  h.node('conversation-list').scrollTop=73;
  h.node('conversation-search').value='MiMo';h.run('renderConversationList()');
  assert.equal(h.node('conversation-list').children.length,1);
  assert.match(allText(h.node('conversation-list').children[0]),/手机照片/);
  assert.equal(h.node('conversation-list').scrollTop,73,'filter preserves the scroll position');
  h.node('conversation-search').value='项目';h.run('renderConversationList()');
  assert.equal(h.node('conversation-list').children.length,1);
  assert.match(allText(h.node('conversation-list').children[0]),/项目分析/);
  h.node('conversation-search').value='不存在';h.run('renderConversationList()');
  assert.match(h.node('conversation-list').children[0].textContent,/没有匹配的对话/);
});

test('late A conversation list cannot replace the unified drawer after switching to B',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";resetMemoryForAuthBoundary=()=>{}');
  const loading=h.run('listConversations()');assert.equal(h.bridge[0].method,'conversations.list');
  h.run('processEvent({event:"account.transition",data:{pending:true}});state.owner="B";state.transitionPending=false;state.conversations=[{id:"conversation-b",title:"B 的对话"}];renderConversationList()');
  h.reply(0,{conversations:[{id:'conversation-a',title:'A 的私有对话'}]});await loading;
  assert.match(allText(h.node('conversation-list')),/B 的对话/);
  assert.doesNotMatch(allText(h.node('conversation-list')),/A 的私有对话/);
});

test('image validation and preview errors describe current limits',()=>{
  const h=harness();
  assert.match(h.run('safeError(new Error("IMAGE_DIMENSIONS_UNSUPPORTED"))'),/无法解码/);
  assert.match(h.run('safeError(new Error("ATTACHMENT_TOO_LARGE"))'),/1 GiB/);
  assert.match(h.run('safeError(new Error("IMAGE_PREVIEW_UNAVAILABLE"))'),/无法生成图片预览/);
});

test('assistant messages and live progress use content alignment without per-message avatars',()=>{
  const h=harness();const message=h.run('messageNode("assistant","回答内容")');
  assert.equal(message.children.some(child=>child.className==='logo'),false);
  assert.equal(message.children[0].className,'message-body');
  assert.equal(message.children[0].children.some(child=>child.className==='message-tools'),true);
  h.run('state.busy=true;renderLiveProgress()');
  const progress=h.node('chat-content').children.at(-1);
  assert.equal(progress.children.some(child=>child.className==='logo'),false);
  assert.equal(progress.children[0].className,'message-body');
});

test('burst streaming renders once per frame without parsing Markdown until the final saved message',async()=>{
  const h=harness({queueFrames:true});
  h.run('state.page="chat";state.chatSource="phone";state.busy=true;state.conversationId="c1";renderCalls=0;markdownCalls=0;const originalProgress=renderLiveProgress;renderLiveProgress=()=>{renderCalls++;return originalProgress()};window.WeftFormat={render:()=>{markdownCalls++;return "<p>saved</p>"}}');
  for(let i=1;i<=100;i++)h.run(`processEvent({event:"chat.progress",data:{conversationId:"c1",text:"${'x'.repeat(i)}"}})`);
  assert.equal(h.frames.length,1);assert.equal(h.run('renderCalls'),0);assert.equal(h.run('markdownCalls'),0);
  h.flushFrame();const progress=h.node('live-progress');
  assert.equal(h.run('renderCalls'),1);assert.equal(h.run('markdownCalls'),0);
  const text=progress.querySelector('.live-progress-text');
  assert.equal(text.textContent.length,0);
  const stableTextNode=text._liveTextNode;
  const lengths=[];for(let i=0;i<8&&h.frames.length;i++){h.flushFrame();lengths.push(text.textContent.length)}
  assert.ok(lengths[0]>0&&lengths[0]<100);
  assert.ok(lengths[1]>lengths[0]&&lengths[1]<100);
  assert.equal(lengths.at(-1),100);
  assert.equal(progress.querySelector('.message-state').textContent,'正在回复…');
  for(let i=101;i<=150;i++)h.run(`processEvent({event:"chat.progress",data:{conversationId:"c1",text:"${'x'.repeat(i)}"}})`);
  h.flushFrame();assert.equal(h.node('live-progress'),progress);
  assert.equal(h.run('renderCalls'),2);assert.equal(text._liveTextNode,stableTextNode);
  for(let i=0;i<8&&h.frames.length;i++)h.flushFrame();
  assert.equal(text.textContent.length,150);
  h.run('state.busy=false;call=async()=>({messages:[{role:"assistant",text:"**saved**"}],receipts:[],turnStatus:"completed"})');
  await h.run('renderConversation()');assert.equal(h.run('markdownCalls'),1);
  assert.equal(h.node('live-progress'),null);
});

test('streaming preserves scroll-back and ignores a queued frame after the turn ends',()=>{
  const h=harness({queueFrames:true,reduced:true});h.run('state.page="chat";state.chatSource="phone";state.busy=true;state.conversationId="c1";state.scrollPinned=false');
  h.node('chat-scroll').scrollTop=270;h.node('chat-scroll').scrollHeight=900;h.node('chat-scroll').clientHeight=200;
  const initialWrites=h.node('chat-scroll').scrollWrites;h.node('jump-latest').hidden=false;
  for(let i=0;i<20;i++)h.run(`processEvent({event:"chat.progress",data:{conversationId:"c1",text:"chunk${i}"}})`);
  h.flushFrame();assert.equal(h.node('chat-scroll').scrollTop,270);
  assert.equal(h.node('chat-scroll').scrollWrites,initialWrites);
  assert.equal(h.node('jump-latest').hidden,false);
  h.run('state.scrollPinned=true;processEvent({event:"chat.phase",data:{conversationId:"c1",phase:"reasoning"}})');
  h.flushFrame();assert.equal(h.node('chat-scroll').scrollTop,700);
  const pinnedWrites=h.node('chat-scroll').scrollWrites;
  h.run('processEvent({event:"chat.phase",data:{conversationId:"c1",phase:"answering"}})');h.flushFrame();
  assert.equal(h.node('chat-scroll').scrollWrites,pinnedWrites);
  h.run('processEvent({event:"chat.progress",data:{conversationId:"c1",text:"last"}})');
  const before=h.node('live-progress').querySelector('.live-progress-text').textContent;
  h.run('state.busy=false;invalidateLiveProgress()');h.flushFrame();
  assert.equal(h.node('live-progress').querySelector('.live-progress-text').textContent,before);
});

test('live follow moves directly to the bottom and never pulls upward as content grows',()=>{
  const h=harness({queueFrames:true});
  h.run('state.page="chat";state.chatSource="phone";state.busy=true;state.conversationId="c1";state.scrollPinned=true');
  const box=h.node('chat-scroll');box.scrollHeight=1000;box.clientHeight=200;box.scrollTop=600;
  h.run('processEvent({event:"chat.progress",data:{conversationId:"c1",text:"A long answer that grows"}})');
  h.flushFrame();assert.equal(box.scrollTop,600);
  h.flushFrame();assert.equal(box.scrollTop,800);
  const first=box.scrollTop;h.run('handleChatScroll()');assert.equal(h.run('state.scrollPinned'),true);
  box.scrollHeight=1100;h.flushFrame();assert.equal(box.scrollTop,900);
  for(let i=0;i<32&&h.frames.length;i++)h.flushFrame();
  assert.equal(box.scrollTop,900);
  assert.ok(box.scrollHistory.every((value,index,history)=>index===0||value>=history[index-1]));
  assert.equal(h.node('live-progress').querySelector('.live-progress-text').textContent,'A long answer that grows');
});

for(const hz of [60,120,180])test(`100 growing snapshots follow monotonically at ${hz}Hz`,()=>{
  const h=harness({queueFrames:true,frameMs:1000/hz});
  h.run('state.page="chat";state.chatSource="phone";state.busy=true;state.conversationId="c1";state.scrollPinned=true');
  const box=h.node('chat-scroll');box.clientHeight=200;box.scrollTop=300;
  Object.defineProperty(box,'scrollHeight',{get:()=>500+Math.floor(
    (h.node('live-progress')?.querySelector('.live-progress-text')?.textContent.length||0)/8)*24});
  let stableNode=null,frameCount=0;
  for(let i=1;i<=100;i++){
    h.run(`processEvent({event:"chat.progress",data:{conversationId:"c1",text:"${'x'.repeat(i*5)}"}})`);
    h.flushFrame();frameCount++;
    const node=h.node('live-progress')?.querySelector('.live-progress-text')?._liveTextNode;
    if(node){if(!stableNode)stableNode=node;else assert.equal(node,stableNode)}
    h.flushFrame();frameCount++;
    assert.ok(box.scrollHistory.every((value,index,history)=>index===0||value>=history[index-1]));
    h.run('handleChatScroll()');assert.equal(h.run('state.scrollPinned'),true);
  }
  for(let i=0;i<20&&h.frames.length;i++){h.flushFrame();frameCount++}
  assert.equal(stableNode.data,'x'.repeat(500));
  assert.equal(box.scrollTop,box.scrollHeight-box.clientHeight);
  assert.ok(box.scrollWrites<=frameCount+1,'at most one scroll write per animation frame');
  box._scrollTop-=1.4;h.run('handleChatScroll()');
  assert.equal(h.run('state.scrollPinned'),true,'a rounded delayed programmatic event stays pinned');
  box.scrollTop=box.scrollHeight-box.clientHeight-30;h.run('handleChatScroll()');
  assert.equal(h.run('state.scrollPinned'),false,'manual scroll-back releases live follow');
  const writes=box.scrollWrites;
  h.run('processEvent({event:"chat.progress",data:{conversationId:"c1",text:"'+ 'x'.repeat(500)+' more"}})');
  for(let i=0;i<20&&h.frames.length;i++)h.flushFrame();
  assert.equal(box.scrollWrites,writes);
  assert.equal(stableNode.data,'x'.repeat(500)+' more');
});

test('manual scroll-back stops live follow but still reveals text, and a stale frame cannot revive it',()=>{
  const h=harness({queueFrames:true});
  h.run('state.page="chat";state.chatSource="phone";state.busy=true;state.conversationId="c1";state.scrollPinned=true');
  const box=h.node('chat-scroll');box.scrollHeight=1200;box.clientHeight=200;box.scrollTop=800;
  h.run('processEvent({event:"chat.progress",data:{conversationId:"c1",text:"first complete thought"}})');
  h.flushFrame();h.flushFrame();
  box.scrollTop=300;h.run('handleChatScroll()');assert.equal(h.run('state.scrollPinned'),false);
  const writes=box.scrollWrites;
  for(let i=0;i<4;i++)h.flushFrame();
  assert.equal(box.scrollWrites,writes);
  assert.equal(h.node('live-progress').querySelector('.live-progress-text').textContent,'first complete thought');
  h.run('processEvent({event:"chat.progress",data:{conversationId:"c1",text:"first complete thought plus more"}})');
  h.flushFrame();h.run('state.owner="other";invalidateLiveProgress()');
  const before=h.node('live-progress').querySelector('.live-progress-text').textContent;
  for(let i=0;i<4;i++)h.flushFrame();
  assert.equal(h.node('live-progress').querySelector('.live-progress-text').textContent,before);
  assert.equal(box.scrollWrites,writes);
});

test('a revised stream snapshot and saved completion show exact final text',async()=>{
  const h=harness({queueFrames:true});
  h.run('state.page="chat";state.chatSource="phone";state.busy=true;state.conversationId="c1"');
  h.run('processEvent({event:"chat.progress",data:{conversationId:"c1",text:"draft wording"}})');
  h.flushFrame();h.flushFrame();
  h.run('processEvent({event:"chat.progress",data:{conversationId:"c1",text:"revised wording"}})');
  h.flushFrame();assert.equal(h.node('live-progress').querySelector('.live-progress-text').textContent,'revised wording');
  h.run('state.busy=false;invalidateLiveProgress();call=async()=>({messages:[{role:"assistant",text:"saved final wording"}],receipts:[],turnStatus:"completed"})');
  await h.run('renderConversation()');
  assert.equal(h.node('live-progress'),null);
  assert.equal(h.node('chat-content').children[0].querySelector('.markdown').textContent,'saved final wording');
});

test('native draft thumbnail opens a full-screen preview and Back restores the same attachment control',()=>{
  const h=harness();const url='data:image/jpeg;base64,AA==';
  h.run(`state.loggedIn=true;state.owner="A";state.conversationId="c1";attachmentDrafts.set(attachmentKey(),[{attachmentId:"a1",kind:"image",name:"sample.jpg",thumbnailDataUrl:"${url}"}]);renderAttachmentDrafts()`);
  const chip=h.node('attachment-drafts').children[0],trigger=chip.children.find(child=>child.className==='attachment-preview-trigger');
  assert.ok(trigger);assert.match(trigger.attrs['aria-label'],/sample.jpg/);
  assert.equal(chip.children.some(child=>child.className==='attachment-kind'||child.className==='attachment-name'),false);
  const remove=chip.children.find(child=>child.className==='attachment-remove');
  assert.ok(remove);assert.equal(remove.textContent,'');assert.match(remove.attrs['aria-label'],/sample.jpg/);
  assert.equal(remove.children[0].className,'icon icon-close');
  assert.match(styles,/\.attachment-image-draft\{[^}]*width:88px;height:88px/);
  assert.match(styles,/\.attachment-thumb\{[^}]*width:100%;height:100%;[^}]*object-fit:cover/);
  assert.match(styles,/\.attachment-image-draft \.attachment-remove\{[^}]*width:44px;height:44px/);
  trigger.fire('click');assert.equal(h.node('image-preview').hidden,false);
  assert.equal(h.node('image-preview-image').src,url);
  assert.equal(h.node('image-preview-name').textContent,'sample.jpg');
  h.run('handleBack()');assert.equal(h.node('image-preview').classList.contains('closing'),true);
  h.advance(160);assert.equal(h.node('image-preview').hidden,true);
  assert.equal(h.document.activeElement,trigger);
  h.run('state.conversationId="c2"');trigger.fire('click');assert.equal(h.node('image-preview').hidden,true);
});

test('image preview closes immediately when reduced motion is requested',()=>{
  const h=harness({reduced:true});const url='data:image/jpeg;base64,AA==';
  h.run(`state.owner="A";state.conversationId="c1";openImagePreview("${url}","sample.jpg",null,{owner:"A",epoch:0,conversationId:"c1"})`);
  assert.equal(h.node('image-preview').hidden,false);
  h.run('handleBack()');assert.equal(h.node('image-preview').hidden,true);
  assert.equal(h.node('image-preview-image').src,'');
});

test('persisted user images render without filename, remain phone-scoped, and close on account change',async()=>{
  const h=harness();const url='data:image/jpeg;base64,AA==';
  h.run(`state.loggedIn=true;state.owner="A";state.page="chat";state.conversationId="c1";
    call=async(method)=>method==="conversations.messages"?{messages:[{id:"m1",role:"user",text:"问题 [本机附件：sample.jpg；跨端暂不可见]",thumbnails:[{attachmentId:"a1",name:"sample.jpg",thumbnailDataUrl:"${url}"},{attachmentId:"bad",name:"bad",thumbnailDataUrl:"javascript:alert(1)"}]}],receipts:[],turnStatus:"completed"}:{attachments:[]}`);
  await h.run('renderConversation()');
  const user=h.node('chat-content').children[0],gallery=user.children.find(child=>child.className==='message-thumbnails');
  assert.ok(gallery);assert.equal(gallery.children.length,1);
  assert.equal(gallery.children[0].children.length,1);
  assert.equal(user.children.some(child=>child.className==='message-attachment-note'),false);
  const preview=gallery.children[0];preview.fire('click');assert.equal(h.node('image-preview').hidden,false);
  h.run('resetMemoryForAuthBoundary=()=>{};processEvent({event:"account.transition",data:{pending:true}})');
  assert.equal(h.node('image-preview').hidden,true);assert.equal(h.node('image-preview-image').src,'');
  assert.equal(h.node('chat-content').children.length,0);
});

test('late phone message projection cannot restore another account thumbnail after switching',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="chat";state.conversationId="c1";resetMemoryForAuthBoundary=()=>{}');
  const loading=h.run('renderConversation()');assert.equal(h.bridge[0].method,'conversations.messages');
  h.run('processEvent({event:"account.transition",data:{pending:true}});state.owner="B";state.transitionPending=false');
  h.reply(0,{messages:[{id:'old',role:'user',text:'A private',thumbnails:[{attachmentId:'a',name:'A.jpg',thumbnailDataUrl:'data:image/jpeg;base64,AA=='}]}],receipts:[],turnStatus:'completed'});
  await loading;
  assert.equal(h.node('chat-content').children.length,0);
  assert.equal(h.node('image-preview').hidden,true);
});

test('phone message keeps real text and file names while omitting image labels and status',()=>{
  const h=harness();const url='data:image/jpeg;base64,AA==';
  const scope='{owner:"A",epoch:0,conversationId:"c1"}';
  const image=h.run(`messageNode("user","What color?\\n[本机附件：sample.png；跨端暂不可见]",[{attachmentId:"a1",name:"sample.png",thumbnailDataUrl:"${url}"}],${scope})`);
  assert.equal(image.textContent,'What color?');
  assert.equal(image.children.some(child=>child.className==='message-native-note'),false);
  assert.equal(image.children.find(child=>child.className==='message-thumbnails').children.length,1);
  assert.equal(image.children.find(child=>child.className==='message-thumbnails').children[0].children.length,1);
  assert.equal(image.children.some(child=>child.className==='message-attachment-note'),false);
  const mixed=h.run(`messageNode("user","Summarize both\\n[本机附件：sample.png、notes.txt；跨端暂不可见]",[{attachmentId:"a1",name:"sample.png",thumbnailDataUrl:"${url}"}],${scope})`);
  assert.equal(mixed.textContent,'Summarize both');
  const note=mixed.children.find(child=>child.className==='message-native-note');
  assert.match(note.textContent,/notes\.txt/);assert.doesNotMatch(note.textContent,/跨端暂不可见/);
  assert.equal(mixed.children.some(child=>child.className==='message-attachment-note'),false);
  const file=h.run('messageNode("user","Read this\\n[本机附件：notes.txt；跨端暂不可见]")');
  assert.match(file.children.find(child=>child.className==='message-native-note').textContent,/notes\.txt/);
});

test('image-only messages show multiple uncropped images in order without a visible caption',()=>{
  const h=harness(),scope='{owner:"A",epoch:0,conversationId:"c1"}';
  const image=h.run(`messageNode("user","[本机附件：first.png、second.png；跨端暂不可见]",[
    {attachmentId:"a1",name:"first.png",thumbnailDataUrl:"data:image/png;base64,AA=="},
    {attachmentId:"a2",name:"second.png",thumbnailDataUrl:"data:image/png;base64,BB=="}],${scope})`);
  const gallery=image.children.find(child=>child.className==='message-thumbnails');
  assert.equal(gallery.children.length,2);
  assert.equal(gallery.children[0].children[0].src,'data:image/png;base64,AA==');
  assert.equal(gallery.children[1].children[0].src,'data:image/png;base64,BB==');
  assert.equal(gallery.children.every(child=>child.children.length===1),true);
  assert.equal(image.children.some(child=>child.className==='message-attachment-note'),false);
  assert.match(styles,/\.message-thumbnail img\{[^}]*height:auto;[^}]*object-fit:contain/);
  assert.match(styles,/\.image-preview-caption\{display:none\}/);
});

test('shared phone image opens its scoped original without visible sync status',()=>{
  const h=harness(),id='attachment-00000000-0000-4000-8000-000000000001',
    conversationId='conversation-00000000-0000-4000-8000-000000000002',
    messageId='message-00000000-0000-4000-8000-000000000003',
    previewUrl=`https://appassets.androidplatform.net/media/image/${id}?conversationId=${conversationId}&messageId=${messageId}`,
    displayUrl=`${previewUrl}&variant=display`;
  h.run(`state.owner="A";state.conversationId="${conversationId}"`);
  const scope=`{owner:"A",epoch:0,conversationId:"${conversationId}"}`;
  const image=h.run(`messageNode("user","照片",[{attachmentId:"${id}",name:"原图.png",thumbnailDataUrl:"data:image/png;base64,AA==",previewUrl:"${previewUrl}",displayUrl:"${displayUrl}",syncStatus:"shared"}],${scope},"${messageId}")`);
  assert.equal(image.children.some(child=>child.className==='message-attachment-note'),false);
  const trigger=image.children.find(child=>child.className==='message-thumbnails').children[0];
  assert.equal(trigger.children[0].src,displayUrl,'chat uses the bounded display image');
  assert.equal(trigger.children[0].loading,'lazy');
  assert.equal(trigger.children[0].decoding,'async');
  trigger.fire('click');assert.equal(h.node('image-preview-image').src,previewUrl);
  assert.match(h.node('image-preview-image').alt,/原图/);
  assert.match(h.node('image-preview-note').textContent,/已与同账户设备共享/);
  const pending=h.run(`messageNode("user","照片",[{attachmentId:"${id}",name:"原图.png",thumbnailDataUrl:"data:image/png;base64,AA==",syncStatus:"pending"}],${scope},"${messageId}")`);
  assert.equal(pending.children.some(child=>child.className==='message-attachment-note'),false);
  assert.equal(pending.children.find(child=>child.className==='message-thumbnails').children[0].children.length,1);
  assert.equal(pending.children.find(child=>child.className==='message-thumbnails').children[0].children[0].src,
    'data:image/png;base64,AA==','older records still show their thumbnail');
});

test('large or unknown original images never decode automatically in the chat timeline',()=>{
  const h=harness(),id='attachment-00000000-0000-4000-8000-000000000001',
    conversationId='conversation-00000000-0000-4000-8000-000000000002',
    messageId='message-00000000-0000-4000-8000-000000000003',
    previewUrl=`https://appassets.androidplatform.net/media/image/${id}?conversationId=${conversationId}&messageId=${messageId}`;
  const scope=`{owner:"A",epoch:0,conversationId:"${conversationId}"}`;
  const unknown=h.run(`messageNode("user","",[{attachmentId:"${id}",name:"未知大小.png",previewUrl:"${previewUrl}"}],${scope},"${messageId}")`);
  assert.equal(unknown.children.find(child=>child.className==='message-thumbnails').children[0].children[0].className,'message-image-placeholder');
  const large=h.run(`messageNode("user","",[{attachmentId:"${id}",name:"大图.png",sizeBytes:1073741824,width:1200,height:2400,previewUrl:"${previewUrl}"}],${scope},"${messageId}")`);
  assert.equal(large.children.find(child=>child.className==='message-thumbnails').children[0].children[0].className,'message-image-placeholder');
  const bounded=h.run(`messageNode("user","",[{attachmentId:"${id}",name:"大图.png",sizeBytes:1073741824,width:1200,height:2400,
    previewUrl:"${previewUrl}",displayUrl:"${previewUrl}&variant=display"}],${scope},"${messageId}")`);
  assert.equal(bounded.children.find(child=>child.className==='message-thumbnails').children[0].children[0].src,
    `${previewUrl}&variant=display`,'1 GiB source uses the bounded display variant');
  assert.equal(h.run('inlineOriginalAllowed({sizeBytes:1048576,width:1200,height:2400})'),true);
  assert.equal(h.run('inlineOriginalAllowed({size:1048576,width:12000,height:24000})'),false);
  assert.equal(h.run('inlineOriginalAllowed({sizeBytes:1073741824,width:1200,height:2400})'),false);
  const host=harness(),hostId=`sha256:${'d'.repeat(64)}`,
    hostUrl=`https://appassets.androidplatform.net/media/session/session-one/${hostId}`;
  host.run(`state.loggedIn=true;state.owner="A";state.chatSource="host";state.sharedSessionId="session-one";state.sharedSessions=[{sessionId:"session-one",sendAvailable:true,source:"host"}];state.sharedEvents=[{seq:1,type:"user.message",data:{text:"",images:[{attachmentId:"${hostId}",contentType:"image/png",size:1073741824,width:1200,height:2400,previewUrl:"${hostUrl}"}]}}];renderSharedConversation()`);
  const hostMessage=host.node('chat-content').children.find(child=>child.className==='message user');
  assert.equal(hostMessage.children.find(child=>child.className==='message-thumbnails').children[0].children[0].className,'message-image-placeholder');
});

test('image preview rejects other hosts, attachment IDs, conversation IDs and unexpected queries',()=>{
  const h=harness(),id='attachment-00000000-0000-4000-8000-000000000001',
    conversationId='conversation-00000000-0000-4000-8000-000000000002',
    messageId='message-00000000-0000-4000-8000-000000000003',
    base=`https://appassets.androidplatform.net/media/image/${id}?conversationId=${conversationId}&messageId=${messageId}`,
    display=`${base}&variant=display`;
  assert.equal(h.run(`safeImagePreviewUrl(${JSON.stringify(base)},${JSON.stringify(id)},${JSON.stringify(conversationId)},${JSON.stringify(messageId)})`),base);
  assert.equal(h.run(`safeImagePreviewUrl(${JSON.stringify(display)},${JSON.stringify(id)},${JSON.stringify(conversationId)},${JSON.stringify(messageId)},true)`),display);
  assert.equal(h.run(`safeImagePreviewUrl(${JSON.stringify(display)},${JSON.stringify(id)},${JSON.stringify(conversationId)},${JSON.stringify(messageId)})`),null,
    'original URL validation rejects the display variant');
  for(const bad of [base.replace('appassets.androidplatform.net','example.com'),
    base.replace(id,'attachment-00000000-0000-4000-8000-000000000099'),
    base.replace(conversationId,'conversation-00000000-0000-4000-8000-000000000099'),
    `${base}&token=secret`,`${base}#fragment`,base.replace('messageId=','other=')]){
    assert.equal(h.run(`safeImagePreviewUrl(${JSON.stringify(bad)},${JSON.stringify(id)},${JSON.stringify(conversationId)},${JSON.stringify(messageId)})`),null);
  }
  for(const bad of [base,`${base}&variant=original`,`${display}&variant=display`,
    `${display}&token=secret`,display.replace('appassets.androidplatform.net','example.com'),
    display.replace(id,'attachment-00000000-0000-4000-8000-000000000099'),
    display.replace(conversationId,'conversation-00000000-0000-4000-8000-000000000099'),
    display.replace(messageId,'message-00000000-0000-4000-8000-000000000099'),`${display}#fragment`]){
    assert.equal(h.run(`safeImagePreviewUrl(${JSON.stringify(bad)},${JSON.stringify(id)},${JSON.stringify(conversationId)},${JSON.stringify(messageId)},true)`),null);
  }
  const scope=`{owner:"A",epoch:0,conversationId:"${conversationId}"}`;
  const fallback=h.run(`messageNode("user","真实问题",[{attachmentId:"${id}",name:"旧图.png",
    thumbnailDataUrl:"data:image/png;base64,AA==",previewUrl:"${base}",
    displayUrl:"${display.replace('variant=display','variant=original')}"}],${scope},"${messageId}")`);
  assert.equal(fallback.textContent,'真实问题');
  assert.equal(fallback.children.find(child=>child.className==='message-thumbnails').children[0].children[0].src,
    'data:image/png;base64,AA==');
});

test('sync completion refreshes only the current phone conversation and drops an A-to-B reply',async()=>{
  const h=harness();
  h.run('state.loggedIn=true;state.owner="A";state.page="chat";state.chatSource="phone";state.conversationId="c1"');
  h.run('processEvent({event:"sync.finished",data:{conversationId:"other",uploaded:1}})');
  h.run('processEvent({event:"sync.finished",data:{conversationId:"c1",uploaded:0}})');
  assert.equal(h.bridge.length,0,'unrelated or empty sync does not reload');
  h.run('processEvent({event:"sync.finished",data:{conversationId:"c1",uploaded:1}})');
  assert.equal(h.bridge[0].method,'conversations.messages');
  h.run('resetMemoryForAuthBoundary=()=>{};processEvent({event:"account.transition",data:{pending:true}});state.owner="B";state.transitionPending=false;state.conversationId="c2"');
  h.reply(0,{messages:[{id:'old',role:'user',text:'A 私有图片'}],receipts:[],turnStatus:'completed'});
  await h.flush();
  assert.equal(h.node('chat-content').children.length,0,'late A projection cannot render for B');
  h.run('processEvent({event:"sync.finished",data:{conversationId:"c1",uploaded:1}})');
  assert.equal(h.bridge.length,1,'old conversation event cannot reload B selection');
  h.run('processEvent({event:"sync.finished",data:{conversationId:"c2",uploaded:1}})');
  assert.equal(h.bridge[1].method,'conversations.messages');
  h.reply(1,{messages:[{id:'new',role:'user',text:'B 的图片'}],receipts:[],turnStatus:'completed'});
  await h.flush();
  assert.equal(h.node('chat-content').children[0].textContent,'B 的图片');
  assert.equal(h.node('toast').hidden,true,'background refresh stays quiet');
});

function allText(node){return [node.textContent,...node.children.flatMap(allText)].join(' ')}
function findNode(node,predicate){if(predicate(node))return node;for(const child of node.children||[]){const match=findNode(child,predicate);if(match)return match}return null}
function countNodes(node,predicate){return Number(predicate(node))+(node.children||[]).reduce((count,child)=>count+countNodes(child,predicate),0)}

test('Things combines source and file receipt, and only a verified file gets save controls',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="things"');
  const grouped=h.run('groupTaskActivities([{source:"host",commandId:"child",taskId:"cmd-1",kind:"desktop.write_artifact",status:"observed",artifactId:"artifact-1",fileName:"stage08-repeat.md",verification:{status:"observed"}}, {source:"host",commandId:"cmd-1",kind:"session.message",status:"accepted_by_dsh",sessionId:"s1"}])');
  assert.equal(grouped.length,1);assert.equal(grouped[0].taskId,'cmd-1');
  assert.equal(h.run('hostActivityTitle(groupTaskActivities([{source:"host",commandId:"child",taskId:"cmd-1",kind:"desktop.write_artifact",status:"observed",artifactId:"artifact-1",fileName:"stage08-repeat.md",verification:{status:"observed"}}])[0])'),'生成：stage08-repeat.md');
  assert.equal(h.run('taskActivityStatus(groupTaskActivities([{source:"host",commandId:"child",taskId:"cmd-1",kind:"desktop.write_artifact",status:"accepted_by_host",artifactId:"artifact-1"}])[0])'),'等待电脑受理 · 文件处理中');
  h.run('showTaskDetail("cmd-1")');
  const artifact={artifactId:'artifact-1',taskId:'cmd-1',kind:'desktop.write_artifact',state:'observed',
    fileName:'结果.md',size:8,sha256:'a'.repeat(64),verification:{status:'observed'},updatedAt:'2026-09-27T10:00:00Z'};
  h.reply(0,{taskId:'cmd-1',sessionId:'s1',source:{commandId:'cmd-1',kind:'session.message',state:'accepted_by_dsh'},artifacts:[artifact],
    supplements:[{commandId:'follow-1',rootTaskId:'cmd-1',taskAction:'supplement',kind:'session.message',state:'accepted_by_dsh',createdAt:'2026-09-27T10:01:00Z'}],
    steps:[{commandId:'step-observed',kind:'desktop.open_app',taskId:'cmd-1',appId:'notepad',state:'observed',verification:{status:'observed',method:'visible_window',observedAt:'2026-09-27T10:02:00Z'}},
      {commandId:'step-uncertain',kind:'desktop.open_app',taskId:'cmd-1',appId:'notepad',state:'uncertain',updatedAt:'2026-09-27T10:03:00Z'}]});await h.flush();
  assert.match(allText(h.node('page-content')),/文件已在电脑核验|电脑已核验/);
  assert.match(allText(h.node('page-content')),/结果.md/);
  assert.match(allText(h.node('page-content')),/保存到手机/);
  assert.match(allText(h.node('page-content')),/事情的停止状态在这里单独记录/);
  const followUp=findNode(h.node('page-content'),node=>node.className==='task-followup');
  assert.ok(followUp);assert.doesNotMatch(followUp.children[0].textContent,/follow-1/);
  assert.match(allText(followUp.children[1]),/查看记录编号.*follow-1/);
  const steps=findNode(h.node('page-content'),node=>node.className==='group'&&allText(node).includes('执行步骤'));
  assert.ok(steps);assert.match(allText(steps),/打开记事本.*电脑窗口已观察.*结果待确认/);
  const stepRows=steps.querySelector('.group-body').children;
  assert.doesNotMatch(stepRows.map(item=>item.children[0].textContent).join(' '),/step-observed|step-uncertain/);
  assert.equal(findNode(h.node('page-content'),node=>node.textContent==='请求停止这件事'),null);
  const saveButton=findNode(h.node('page-content'),node=>node.textContent==='保存到手机');
  assert.ok(saveButton);
  saveButton.fire('click');h.reply(1,{pending:true,requestId:'save-1'});await h.flush();
  h.run('processEvent({event:"artifact.save",data:{requestId:"save-1",status:"saved"}})');
  saveButton.fire('click');h.reply(2,{pending:true,requestId:'save-2'});await h.flush();
  h.run('processEvent({event:"artifact.save",data:{requestId:"save-2",status:"saved"}})');
  assert.equal(countNodes(h.node('page-content'),node=>node.className==='artifact-save-state'),1);
  assert.match(allText(h.node('page-content')),/已保存到手机并核对内容/);
  h.run('showTaskDetail("cmd-2")');
  h.reply(3,{taskId:'cmd-2',source:{commandId:'cmd-2',kind:'session.message',state:'accepted_by_dsh'},artifacts:[
    {...artifact,taskId:'cmd-2',state:'uncertain',verification:null}]});await h.flush();
  assert.doesNotMatch(allText(h.node('page-content')),/保存到手机/);
});

test('host activity detail reads its exact command and distinguishes DSH acceptance from completion',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="things";state.generation=3');
  h.run('showHostCommandDetail({source:"host",commandId:"cmd-1",kind:"session.message",sessionId:"session-1"})');
  assert.deepEqual(JSON.parse(JSON.stringify(h.bridge[0].params)),{taskId:'cmd-1'});
  h.reply(0,{taskId:'cmd-1',sessionId:'session-1',source:{commandId:'cmd-1',kind:'session.message',sessionId:'session-1',state:'accepted_by_dsh',
    createdAt:'2026-09-27T10:00:00Z',updatedAt:'2026-09-27T10:00:02Z'},artifacts:[]});await h.flush();
  const content=allText(h.node('page-content'));
  assert.match(content,/已交给电脑会话/);assert.match(content,/回复是否完成，请查看原会话/);
  const record=findNode(h.node('page-content'),node=>node.className==='group'&&node.children[0]?.textContent==='记录');
  assert.ok(record);
  assert.doesNotMatch(record.querySelector('.group-body').children.filter(node=>node.className==='command-fact')
    .map(node=>node.textContent).join(' '),/cmd-1/);
  assert.match(allText(findNode(record,node=>node.className==='task-record-id')),/查看记录编号.*cmd-1/);
  assert.match(content,/打开原电脑会话/);
  assert.doesNotMatch(content,/已完成回复/);
});

test('stale or revoked host detail does not reveal a command after account change',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="things";state.generation=5');
  h.run('showHostCommandDetail({source:"host",commandId:"cmd-secret",kind:"session.message",sessionId:"s1"})');
  h.run('state.authEpoch++;state.owner="B"');
  h.reply(0,{taskId:'cmd-secret',sessionId:'s1',source:{commandId:'cmd-secret',kind:'session.message',sessionId:'s1',state:'accepted_by_dsh'},artifacts:[]});
  await h.flush();assert.doesNotMatch(allText(h.node('page-content')),/已交给电脑会话|cmd-secret/);
  h.run('state.owner="A";state.page="things";state.generation++');
  h.run('showHostCommandDetail({source:"host",commandId:"gone",kind:"session.message",sessionId:"s1"})');
  h.reply(1,null,'NOT_FOUND');await h.flush();
  assert.match(allText(h.node('page-content')),/无法读取/);
  assert.doesNotMatch(allText(h.node('page-content')),/打开原电脑会话/);
});

test('host command detail links to its exact shared session',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="things";state.sharedSessions=[{sessionId:"session-exact",title:"原会话",sendAvailable:true,source:"host"}]');
  await h.run('openHostCommandSession("session-exact")');
  assert.equal(h.run('state.chatSource'),'host');assert.equal(h.run('state.sharedSessionId'),'session-exact');
  assert.equal(h.bridge.some(item=>item.method==='shared.send'),false);
});

test('manual shared status check reconciles the saved request once and refreshes connectivity',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="chat";state.chatSource="host";state.sharedSessionId="pc1";state.sharedSessions=[{sessionId:"pc1",title:"电脑",sendAvailable:true,source:"host"}];state.sharedPending={requestId:"saved-1",state:"uncertain",text:"离线消息"}');
  h.node('draft').value='离线消息';const checking=h.run('checkSharedPending()');await h.run('checkSharedPending()');
  assert.equal(h.bridge.filter(item=>item.method==='shared.outbox.reconcile').length,1);
  h.reply(0,{source:'host',commands:[{source:'host',sessionId:'pc1',requestId:'saved-1',kind:'session.message',state:'accepted'}]});
  await h.flush();
  const outbox=h.bridge.findIndex(item=>item.method==='shared.outbox.list');
  const sessions=h.bridge.findIndex(item=>item.method==='shared.sessions.list');
  const history=h.bridge.findIndex(item=>item.method==='shared.sessions.events');
  assert.ok(outbox>=0&&sessions>=0&&history>=0);
  h.reply(outbox,{source:'host',commands:[{source:'host',sessionId:'pc1',requestId:'saved-1',kind:'session.message',state:'accepted'}]});
  h.reply(sessions,{source:'host',hostAvailable:true,sessions:[{sessionId:'pc1',title:'电脑',sendAvailable:true,source:'host'}]});
  h.reply(history,{source:'host',sessionId:'pc1',events:[],nextSeq:-1,hasMore:false});
  await checking;
  assert.equal(h.run('state.sharedHostAvailable'),true);
  assert.equal(h.run('state.sharedPending'),null);
  assert.equal(h.node('draft').value,'');
  assert.equal(h.bridge.some(item=>item.method==='shared.send'),false);
});

test('Things list names phone activity and the bound computer conversation truthfully',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="things";state.sharedSessions=[{sessionId:"pc1",title:"原会话",source:"host"}];thingsPage(document.getElementById("page-content"))');
  h.reply(0,{hostAvailable:true,activities:[{source:'phone',conversationId:'phone1',title:'手机提问',status:'completed'},
    {source:'host',commandId:'cmd-1',sessionId:'pc1',kind:'session.message',status:'accepted_by_dsh'}]});await h.flush();
  const content=allText(h.node('page-content'));
  assert.match(content,/手机提问/);assert.match(content,/电脑任务：原会话/);
  assert.match(content,/已交给电脑会话/);assert.match(content,/命令已受理不代表回复或动作已经完成/);
});

test('Things detail shows verified desktop observation and safe rejection reason',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="things"');
  h.run('showHostCommandDetail({source:"host",commandId:"cmd-observed",kind:"desktop.open_app"})');
  h.reply(0,{source:'host',command:{commandId:'cmd-observed',kind:'desktop.open_app',state:'observed',
    createdAt:'2026-09-27T10:00:00Z',updatedAt:'2026-09-27T10:00:02Z',verification:{status:'observed',method:'visible_window',observedAt:'2026-09-27T10:00:02Z'}}});await h.flush();
  assert.match(allText(h.node('page-content')),/已观察到电脑应用窗口|已观察到应用窗口/);
  h.run('showHostCommandDetail({source:"host",commandId:"cmd-rejected",kind:"session.message"})');
  h.reply(1,{taskId:'cmd-rejected',source:{commandId:'cmd-rejected',kind:'session.message',state:'rejected',errorCode:'SESSION_EXPIRED',
    createdAt:'2026-09-27T10:00:00Z',updatedAt:'2026-09-27T10:00:02Z'},artifacts:[]});await h.flush();
  assert.match(allText(h.node('page-content')),/未受理/);
  assert.match(allText(h.node('page-content')),/登录已失效/);
});

test('restart restores only a live owner-scoped shared session',async()=>{
  const h=harness({autoBoot:true,storage:{'weftmate-chat-source:A':JSON.stringify({source:'host',sessionId:'pc-A'})},
    autoResults:{'app.bootstrap':{loggedIn:true,username:'A',owner:'A',model:null,busy:false},
      'conversations.list':{conversations:[{id:'phone-A',title:'手机旧会话'}]},
      'shared.sessions.list':{source:'host',hostAvailable:true,sessions:[{sessionId:'pc-A',title:'电脑原会话',sendAvailable:true,source:'host'}]},
      'shared.sessions.events':{source:'host',sessionId:'pc-A',events:[],nextSeq:-1,hasMore:false},
      'shared.outbox.list':{source:'host',commands:[]},'auth.me':{displayName:'A',connectionVerified:true}}});
  h.domReady();for(let i=0;i<40&&h.run('state.chatSource')!=='host';i++)await h.flush();
  assert.equal(h.run('state.chatSource'),'host');assert.equal(h.run('state.sharedSessionId'),'pc-A');
  assert.equal(h.bridge.some(item=>item.method==='shared.sessions.events'&&item.params.sessionId==='pc-A'),true);
  assert.equal(h.node('header-subtitle').textContent,'同一个助手，接着聊。');
});

test('owner switch and removed shared session fall back without showing old account content',async()=>{
  const stored={'weftmate-chat-source:A':JSON.stringify({source:'host',sessionId:'pc-A'})};
  const switched=harness({autoBoot:true,storage:stored,autoResults:{
    'app.bootstrap':{loggedIn:true,username:'B',owner:'B',model:null,busy:false},
    'conversations.list':{conversations:[]},'attachments.list':{attachments:[]},
    'shared.sessions.list':{source:'host',hostAvailable:true,sessions:[]},'auth.me':{displayName:'B',connectionVerified:true}}});
  switched.domReady();for(let i=0;i<30&&!switched.bridge.some(item=>item.method==='app.ready');i++)await switched.flush();
  assert.equal(switched.run('state.chatSource'),'phone');
  assert.equal(switched.bridge.some(item=>item.method==='shared.sessions.events'&&item.params.sessionId==='pc-A'),false);
  assert.doesNotMatch(allText(switched.node('chat-content')),/电脑原会话/);
  const removed=harness({autoBoot:true,storage:stored,autoResults:{
    'app.bootstrap':{loggedIn:true,username:'A',owner:'A',model:null,busy:false},
    'conversations.list':{conversations:[]},'attachments.list':{attachments:[]},
    'shared.sessions.list':{source:'host',hostAvailable:true,sessions:[]},'auth.me':{displayName:'A',connectionVerified:true}}});
  removed.domReady();for(let i=0;i<40;i++){await removed.flush();
    if(removed.bridge.some(item=>item.method==='shared.sessions.list')&&removed.run('state.restorePending')===false)break}
  assert.equal(removed.run('state.chatSource'),'phone');
  assert.equal(removed.storage.has('weftmate-chat-source:A'),false);
});

test('switching chat source clears transient acceptance and matching turn end clears it',()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.chatSource="host";state.sharedSessionId="pc1";state.sharedSessions=[{sessionId:"pc1",title:"电脑",sendAvailable:true,source:"host"}];status("电脑已受理消息，等待会话记录更新")');
  h.run('waitForSharedTurn("pc1","hello",0);trackSharedAcceptedTurn({seq:1,type:"user.message",data:{text:"hello"}});trackSharedAcceptedTurn({seq:2,type:"turn.ended",data:{reason:"completed"}})');
  assert.equal(h.node('chat-status').textContent,'');
  h.run('status("电脑已受理消息，等待会话记录更新");selectConversation("phone1")');
  assert.equal(h.node('chat-status').textContent,'');
});
