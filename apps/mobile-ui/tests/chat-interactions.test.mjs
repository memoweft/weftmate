import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

import {mobileSource as source,mobileHtml as html} from './load-page.mjs';

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
    get parentNode(){return this.parent}
    closest(selector){return selector.split(',').some(part=>part.trim().startsWith('.')&&this.className?.split(' ').includes(part.trim().slice(1)))?this:this.parent?.closest(selector)||null}
    get childNodes(){return this.children}
    get nextSibling(){return this.parent?.children[this.parent.children.indexOf(this)+1]||null}
    insertBefore(child,next){child.remove();child.parent=this;const index=next?this.children.indexOf(next):-1;
      if(index<0)this.children.push(child);else this.children.splice(index,0,child)}
    replaceChildren(...children){this.children=[];this.append(...children)}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this)}
    setAttribute(key,value){this.attrs[key]=value}
    getBoundingClientRect(){return {top:500,height:132}}
    focus(){document.activeElement=this}
    addEventListener(event,handler){this.listeners.set(event,[...(this.listeners.get(event)||[]),handler])}
    fire(event){for(const handler of this.listeners.get(event)||[])handler({target:this})}
    querySelector(selector){if(selector===this.tagName||selector.startsWith('.')&&this.className?.split(' ').includes(selector.slice(1)))return this;
      for(const child of this.children){const found=child.querySelector?.(selector);if(found)return found}return null}
    querySelectorAll(){return []}
  }
  const frames=[];
  const document={activeElement:null,documentElement:new Node('html'),getElementById:id=>{
      if(id==='live-progress')return nodes.get('chat-content')?.children.find(child=>child.id==='live-progress')||null;
      if(!htmlIds.has(id))return null;
      if(!nodes.has(id)){const node=new Node(id);
        if(['toast','attachment-drafts','attachment-popover','model-popover','image-preview','resource-page'].includes(id))node.hidden=true;nodes.set(id,node)}return nodes.get(id)},
    createElement:tagName=>{const node=new Node();node.tagName=tagName;return node},createTextNode:value=>new TextNode(value),
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
  const context=vm.createContext({document,window,localStorage,URL,AbortSignal,crypto:globalThis.crypto,
    setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay,due:now+delay});return id},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>{if(queueFrames){frames.push(fn);return frames.length}fn(now);return 0},ResizeObserver,console});
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  const node=id=>document.getElementById(id);
  const flush=async()=>{for(let index=0;index<12;index++)await Promise.resolve()};
  const reply=(index,result,error)=>{const request=bridge[index];
    run(`androidBridge.receive({data:${JSON.stringify(JSON.stringify(error?{id:request.id,ok:false,error:{code:error}}:{id:request.id,ok:true,result}))}})`)};
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
  assert.ok(request);assert.deepEqual(JSON.parse(JSON.stringify(request.params)),{sessionId:'pc1',text:'发送到电脑',requestId:request.params.requestId,intent:'queue'});
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
  const pick=h.bridge.findIndex(item=>item.method==='attachments.pick');
  assert.deepEqual(JSON.parse(JSON.stringify(h.bridge[pick].params)),{kind:'image',conversationId:'session-one',viewGeneration:0});
  h.reply(pick,{pending:true,requestId:'host-pick'});await picking;
  h.run('processEvent({event:"attachment.result",data:{requestId:"host-pick",conversationId:"session-one",status:"selected",viewGeneration:0}})');
  const listing=h.bridge.findIndex(item=>item.method==='attachments.list');
  assert.ok(listing>pick);
  assert.equal(h.bridge[listing].params.conversationId,'session-one');
  h.reply(listing,{attachments:[{attachmentId:id,kind:'image',name:'电脑.png',thumbnailDataUrl:'data:image/png;base64,AA=='},
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
  const pick=h.bridge.findIndex(item=>item.method==='attachments.pick');
  assert.deepEqual(JSON.parse(JSON.stringify(h.bridge[pick].params)),
    {kind:'file',conversationId:'session-file',viewGeneration:0});
  h.reply(pick,{pending:true,requestId:'host-file-pick'});await picking;
  h.run('processEvent({event:"attachment.result",data:{requestId:"host-file-pick",conversationId:"session-file",status:"selected",viewGeneration:0}})');
  const listing=h.bridge.findIndex(item=>item.method==='attachments.list');
  assert.ok(listing>pick);
  h.reply(listing,{attachments:[{attachmentId:id,kind:'file',name:'资料.csv'}]});await h.flush();
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
  assert.deepEqual(JSON.parse(JSON.stringify(post.params)),{sessionId:'session-one',text:'',requestId:post.params.requestId,intent:'queue',attachmentIds:[id]});
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





test('supplement and resume commands stay in their root file task card',()=>{
  const h=harness();h.run('state.sharedSessions=[{sessionId:"pc1",title:"新对话"}]');
  const grouped=h.run(`groupTaskActivities([
    {source:'host',kind:'session.message',commandId:'follow-2',rootTaskId:'root-1',taskAction:'resume',status:'accepted_by_dsh',sessionId:'pc1'},
    {source:'host',kind:'session.message',commandId:'follow-1',rootTaskId:'root-1',taskAction:'supplement',status:'accepted_by_dsh',sessionId:'pc1'},
    {source:'host',kind:'desktop.write_artifact',commandId:'file-1',taskId:'root-1',status:'observed',artifactId:'artifact-1',fileName:'结果.md',verification:{status:'observed'}},
    {source:'host',kind:'session.message',commandId:'root-1',status:'accepted_by_dsh',sessionId:'pc1'}])`);
  assert.equal(grouped.length,1);
  assert.equal(grouped[0].commandId,'root-1');
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
  const buttons=node=>[...(node.tagName==='button'?[node]:[]),...node.children.flatMap(buttons)];
  const conversations=()=>buttons(h.node('conversation-list')).filter(node=>node.dataset.sessionId||node.dataset.conversationId);
  const named=name=>conversations().find(node=>allText(node).includes(name));
  assert.equal(conversations().length,3);
  assert.match(allText(named('项目分析')),/项目分析.*电脑执行/);
  assert.match(allText(named('手机照片')),/手机照片.*MiMo.*手机执行/);
  assert.match(allText(named('外出记录')),/外出记录.*手机执行/);
  named('项目分析').fire('click');assert.equal(h.run('state.chatSource'),'host');assert.equal(h.run('state.sharedSessionId'),'session-1');
  named('手机照片').fire('click');assert.equal(h.run('state.chatSource'),'phone');assert.equal(h.run('state.conversationId'),'conversation-1');
  h.node('conversation-list').scrollTop=73;
  h.node('conversation-search').value='MiMo';h.run('renderConversationList()');
  assert.equal(conversations().length,1);assert.ok(named('手机照片'));
  assert.equal(h.node('conversation-list').scrollTop,73,'filter preserves the scroll position');
  h.node('conversation-search').value='项目';h.run('renderConversationList()');
  assert.equal(conversations().length,1);assert.ok(named('项目分析'));
  h.node('conversation-search').value='不存在';h.run('renderConversationList()');
  assert.match(allText(h.node('conversation-list')),/没有匹配的对话/);
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

function syntheticConversationTask(){
  const source={commandId:'root-inline',kind:'session.message',state:'accepted_by_dsh',sessionId:'s1',receiptId:'rpc:root.1'};
  const supplement={commandId:'follow-inline',kind:'session.message',rootTaskId:source.commandId,taskAction:'supplement',
    state:'accepted_by_dsh',sessionId:'s1',receiptId:'rpc:follow.2'};
  const execution={executionId:'exec-one',sourceCommandId:source.commandId,sourceReceiptId:source.receiptId,
    toolName:'pwsh',state:'completed',jobId:'job-one',jobState:'running'};
  const task={taskId:source.commandId,sessionId:'s1',source,sourceText:'相同的目标',artifacts:[],supplements:[supplement],
    control:{state:'active',canStop:true,canSupplement:true},replyEvidence:{status:'completed',assistantMessages:1},
    executionSteps:[execution,{...execution,executionId:'exec-two',toolName:'read',jobId:undefined,jobState:undefined,
      sourceCommandId:supplement.commandId,sourceReceiptId:supplement.receiptId},
      {...execution,executionId:'exec-foreign',toolName:'grep',sourceCommandId:'foreign',sourceReceiptId:source.receiptId}]};
  return {source,task,activity:{source:'host',kind:'session.message',commandId:source.commandId,sessionId:'s1',status:'accepted_by_dsh'}};
}
function syntheticApproval(overrides={}){return {approvalId:'12345678-1234-4234-8234-123456789abc',sessionId:'s1',taskId:'root-inline',
  sourceCommandId:'root-inline',sourceReceiptId:'rpc:root.1',turn:1,callId:'call:root.1',rootCallId:'root:call.1',
  toolName:'pwsh',reason:'需要执行这次命令，等待你的决定。',createdAt:'2026-10-06T13:00:00.000Z',status:'pending',...overrides}}
function prepareApprovalChat(h,{deviceId='phone-a'}={}){prepareSyntheticTaskChat(h);const fixture=syntheticConversationTask();
  h.run(`state.deviceId=${JSON.stringify(deviceId)};conversationTasks.owner=state.owner;conversationTasks.epoch=state.authEpoch;
    conversationTasks.entries.set('root-inline',{taskId:'root-inline',sessionId:'s1',receiptId:'rpc:root.1',task:${JSON.stringify(fixture.task)}});
    renderConversationTasks()`);return fixture}
async function readApprovals(h,rows,context='approvalContext()'){const reading=h.run(`refreshToolApprovals(${context})`);
  const request=h.bridge.findLastIndex(item=>item.method==='shared.approvals.list');
  h.reply(request,{approvals:rows,nextBefore:null,hasMore:false});await reading;return request}
function approvalCard(h){return h.node('chat-content').children.find(node=>node.dataset.approvalId)}
function answeredApproval(row,requestId,outcome){return {...row,status:'answered',decisionRequestId:requestId,decisionOutcome:outcome,
  answeredAt:'2026-10-06T13:01:00.000Z'}}

test('UI-2a category approval preserves scope and original request through timeout and restart',async()=>{
  const h=harness();prepareApprovalChat(h);const row=syntheticApproval({riskCategories:['delete','overwrite']});await readApprovals(h,[row]);
  assert.equal(approvalCard(h).querySelector('.approval-actions').children.length,3);
  assert.equal(approvalCard(h).querySelector('.approval-actions').children[1].disabled,false);
  assert.match(allText(approvalCard(h)),/删除文件、覆盖文件.*可能无法撤销/);
  const deciding=h.run("decideToolApproval([...toolApprovals.sessions.get('s1').rows.values()][0],'allowed-once',approvalContext(),false,'conversation-category')");
  const request=h.bridge.findLastIndex(item=>item.method==='shared.approvals.decide'),params=h.bridge[request].params;
  assert.equal(params.scope,'conversation-category');h.reply(request,null,'TIMEOUT');await h.flush();
  h.reply(h.bridge.findLastIndex(item=>item.method==='shared.approvals.list'),{approvals:[row],nextBefore:null,hasMore:false});await deciding;
  const restored=harness({storage:Object.fromEntries(h.storage)});prepareApprovalChat(restored);await readApprovals(restored,[row]);
  assert.match(allText(approvalCard(restored)),/重试总是允许此类/);
  const retry=restored.run("decideToolApproval([...toolApprovals.sessions.get('s1').rows.values()][0],'allowed-once',approvalContext(),false,'conversation-category')");
  restored.reply(restored.bridge.findLastIndex(item=>item.method==='shared.approvals.list'),{approvals:[row],nextBefore:null,hasMore:false});await restored.flush();
  const repeated=restored.bridge.findLastIndex(item=>item.method==='shared.approvals.decide');assert.deepEqual(restored.bridge[repeated].params,params);
  const answered={...answeredApproval(row,params.requestId,'allowed-once'),decisionScope:'conversation-category'};
  restored.reply(repeated,{approval:answered,requestId:params.requestId});await restored.flush();
  restored.reply(restored.bridge.findLastIndex(item=>item.method==='shared.approvals.list'),{approvals:[answered],nextBefore:null,hasMore:false});await retry;
  assert.equal(allText(approvalCard(restored)).trim(),'已总是允许此类 · 运行命令');
});

test('UI-2a category permission remains unavailable without a server risk category',async()=>{
  const h=harness();prepareApprovalChat(h);await readApprovals(h,[syntheticApproval()]);
  assert.equal(approvalCard(h).querySelector('.approval-actions').children[1].disabled,true);
  await h.run("decideToolApproval([...toolApprovals.sessions.get('s1').rows.values()][0],'allowed-once',approvalContext(),false,'conversation-category')");
  assert.equal(h.bridge.some(item=>item.method==='shared.approvals.decide'),false);
});

test('UI-2a approval mode late reads cannot label another conversation or account',async()=>{
  const h=harness();h.run("state.loggedIn=true;state.owner='A';state.chatSource='host';state.sharedSessionId='s1';updateApprovalModeButton()");
  const first=h.bridge.findLastIndex(item=>item.method==='host.business');
  h.run("state.sharedSessionId='s2';state.generation++;updateApprovalModeButton()");
  const second=h.bridge.findLastIndex(item=>item.method==='host.business');h.reply(first,{mode:'allow-all'});await h.flush();
  assert.equal(h.node('approval-mode-label').textContent,'审批');h.reply(second,{mode:'ask'});await h.flush();
  assert.equal(h.node('approval-mode-label').textContent,'每次询问');
  const opening=h.run('openApprovalModes()'),third=h.bridge.findLastIndex(item=>item.method==='host.business');
  h.run("state.owner='B';state.authEpoch++;updateApprovalModeButton()");h.reply(third,{mode:'allow-all'});await opening;
  assert.equal(h.node('approval-mode-popover').hidden,true);assert.equal(h.node('approval-mode-label').textContent,'审批');
});

test('UI-2a an older mode read cannot overwrite a newly saved mode in the same conversation',async()=>{
  const h=harness();h.run("state.loggedIn=true;state.owner='A';state.chatSource='host';state.sharedSessionId='s1';updateApprovalModeButton()");
  const oldRead=h.bridge.length-1,opening=h.run('openApprovalModes()'),newRead=h.bridge.length-1;
  h.reply(newRead,{mode:'auto'});await opening;
  const saving=h.run("saveApprovalMode('plan',approvalModeState.menu)"),write=h.bridge.length-1;
  h.reply(write,{mode:'plan'});await saving;assert.equal(h.node('approval-mode-label').textContent,'先出计划');
  h.reply(oldRead,{mode:'auto'});await h.flush();assert.equal(h.node('approval-mode-label').textContent,'先出计划');
});
function syntheticQuestionBatch(overrides={}){return {questionRpcId:'52345678-1234-4234-8234-123456789abc',sessionId:'s1',taskId:'root-inline',
  sourceCommandId:'root-inline',sourceReceiptId:'rpc:root.1',turn:1,createdAt:'2026-10-06T14:00:00.000Z',status:'pending',questions:[
    {id:'plan',header:'确认计划',question:'是否按这份计划继续？',detail:'先整理资料，再核对文件内容。',intent:{kind:'plan-review',approve:'同意'},
      options:[{label:'同意',description:'按上面的计划继续'},{label:'调整计划'}]},
    {id:'repeated-id',question:'需要保留哪些成果？',multiSelect:true,options:[{label:'文字记录'},{label:'源文件'}]},
    {id:'repeated-id',question:'补充一个说明'}],...overrides}}
async function readQuestions(h,rows,context='approvalContext()'){const reading=h.run(`refreshToolQuestions(${context})`);
  const request=h.bridge.findLastIndex(item=>item.method==='shared.questions.list');
  h.reply(request,{questions:rows,nextBefore:null,hasMore:false});await reading;return request}
function questionCard(h){return h.node('chat-content').children.find(node=>node.dataset.questionRpcId)}
function answeredQuestion(row,requestId,answer){return {...row,status:'answered',answerRequestId:requestId,answer,
  answeredAt:'2026-10-06T14:01:00.000Z'}}

test('dedicated approvals and questions stay actionable when the general activity index is unavailable',async()=>{
  const h=harness(),fixture=syntheticConversationTask(),approval=syntheticApproval(),question=syntheticQuestionBatch();
  prepareSyntheticTaskChat(h);h.run("state.deviceId='phone-a'");
  const refreshing=h.run('refreshConversationTasks()');
  const activity=h.bridge.findLastIndex(item=>item.method==='activity.list');
  const approvals=h.bridge.findLastIndex(item=>item.method==='shared.approvals.list');
  const questions=h.bridge.findLastIndex(item=>item.method==='shared.questions.list');
  assert.ok(approvals>=0&&questions>=0,'dedicated decision reads start independently of the activity request');
  h.reply(activity,null,'HOST_UNAVAILABLE');await refreshing;
  h.reply(approvals,{approvals:[approval],nextBefore:null,hasMore:false});
  h.reply(questions,{questions:[question],nextBefore:null,hasMore:false});await h.flush();
  const details=h.bridge.map((request,index)=>({request,index})).filter(({request})=>request.method==='shared.tasks.detail');
  assert.ok(details.length>0,'exact source is checked through its dedicated task endpoint');
  for(const {index} of details)h.reply(index,fixture.task);await h.flush();
  assert.match(allText(approvalCard(h)),/允许一次.*拒绝/);
  assert.match(allText(questionCard(h)),/确认计划.*提交回答/);
  assert.equal(h.run("conversationTasks.entries.get('root-inline').notice"),'');
  const deciding=h.run("decideToolApproval([...toolApprovals.sessions.get('s1').rows.values()][0],'allowed-once')");
  const request=h.bridge.findLastIndex(item=>item.method==='shared.approvals.decide');
  assert.ok(request>activity,'a failed activity read does not prevent the verified approval action');
  const requestId=h.bridge[request].params.requestId,answered=answeredApproval(approval,requestId,'allowed-once');
  h.reply(request,{approval:answered,requestId});await h.flush();
  h.reply(h.bridge.findLastIndex(item=>item.method==='shared.approvals.list'),{approvals:[answered],nextBefore:null,hasMore:false});await deciding;
  assert.match(allText(approvalCard(h)),/已允许 · 运行命令/);
});

test('task15-question-client natural single multiple and free answers preserve original position and plan intent without granting a tool permission',async()=>{
  const h=harness();prepareApprovalChat(h);const row=syntheticQuestionBatch();
  await readQuestions(h,[row,syntheticQuestionBatch({questionRpcId:'62345678-1234-4234-8234-123456789abc',sourceReceiptId:'rpc:other.2',
    questions:[{id:'foreign',question:'错误来源不应出现'}]})]);
  const card=questionCard(h),form=card.querySelector('.question-form'),fields=form.children.filter(node=>node.tagName==='fieldset');
  assert.equal(h.node('chat-content').children.filter(node=>node.dataset.questionRpcId).length,1);
  assert.match(allText(card),/确认计划.*是否按这份计划继续.*先整理资料，再核对文件内容.*同意.*按上面的计划继续/);
  assert.doesNotMatch(allText(h.node('chat-content')),/错误来源|永久允许|允许一次/);assert.equal(fields.length,3);
  const selected=fields[0].querySelector('input');assert.equal(selected.type,'radio');selected.checked=true;selected.fire('change');
  const multi=fields[1].children.filter(node=>node.className==='question-option').map(node=>node.querySelector('input'));
  assert.equal(multi.every(input=>input.type==='checkbox'),true);for(const input of multi){input.checked=true;input.fire('change')}
  const mixed=fields[1].querySelector('.question-custom');mixed.value='保留一份简短目录';mixed.fire('input');
  const custom=fields[2].querySelector('.question-custom');custom.value='按这段原话填写';custom.fire('input');
  h.node('draft').value='聊天草稿仍在';h.node('draft').focus();h.run('state.scrollPinned=false');h.node('chat-scroll').scrollTop=163;
  form.fire('submit');const request=h.bridge.findLastIndex(item=>item.method==='shared.questions.answer'),params=h.bridge[request].params;
  assert.deepEqual(Object.keys(params).sort(),['answer','questionRpcId','requestId','sessionId']);assert.equal(params.questionRpcId,row.questionRpcId);
  assert.deepEqual(params.answer,{answers:[{id:'plan',selected:['同意']},{id:'repeated-id',selected:['文字记录','源文件'],custom:'保留一份简短目录'},
    {id:'repeated-id',selected:[],custom:'按这段原话填写'}]});
  assert.equal(h.bridge.some(item=>item.method==='shared.approvals.decide'),false,'plan-review is an information answer');
  const answered=answeredQuestion(row,params.requestId,params.answer);h.reply(request,{question:answered,requestId:params.requestId});await h.flush();
  h.reply(h.bridge.findLastIndex(item=>item.method==='shared.questions.list'),{questions:[answered],nextBefore:null,hasMore:false});await h.flush();
  assert.match(allText(questionCard(h)),/回答已登记，等待执行端确认/);assert.doesNotMatch(allText(questionCard(h)),/已确认接收/);
  await readQuestions(h,[{...answered,status:'resolved',outcome:'answered',resolvedAt:'2026-10-06T14:02:00.000Z',reasonCode:'QUESTION_NOT_PENDING'}]);
  assert.match(allText(questionCard(h)),/这份登记回答是否被接收尚未确认/);
  await readQuestions(h,[{...answered,status:'resolved',outcome:'answered',resolvedAt:'2026-10-06T14:02:00.000Z',answerAcceptedAt:'2026-10-06T14:02:00.000Z'}]);
  assert.match(allText(questionCard(h)),/执行端已确认接收这份回答/);assert.equal(h.node('draft').value,'聊天草稿仍在');assert.equal(h.node('chat-scroll').scrollTop,163);
});

test('task15-question-client original repeated or empty IDs and empty selections remain legal while answer shape follows each original question',()=>{
  const h=harness(),row=syntheticQuestionBatch({questions:[{id:'',question:'单选',options:[{label:''},{label:'原标签'}]},
    {id:'',question:'多选',multiSelect:true,options:[{label:'甲'},{label:'乙'}]}]});
  assert.ok(h.run(`normalizedQuestionBatch(${JSON.stringify(row)})`));
  const check=answer=>h.run(`canonicalQuestionAnswer(${JSON.stringify(answer)},${JSON.stringify(row.questions)})`);
  assert.ok(check({answers:[{id:'',selected:[]},{id:'',selected:[],custom:'说明'}]}));
  assert.ok(check({answers:[{id:'',selected:['']},{id:'',selected:['甲','乙'],custom:'补充'}]}));
  for(const answer of [{answers:[{id:'other',selected:[]},{id:'',selected:[]}]},
    {answers:[{id:'',selected:['原标签'],custom:'不能与单选并存'},{id:'',selected:[]}]},
    {answers:[{id:'',selected:[]},{id:'',selected:['甲','甲']}]},
    {answers:[{id:'',selected:[],custom:'   '},{id:'',selected:[]}]},
    {answers:[{id:'',selected:['被改写的标签']},{id:'',selected:[]}]}])assert.equal(check(answer),null);
});

test('task15-question-client an uncertain source or network result keeps the same batch and can explicitly retry its persisted original answer',async()=>{
  const h=harness();prepareApprovalChat(h);const row=syntheticQuestionBatch({questions:[{id:'question-one',question:'补充说明'}]});await readQuestions(h,[row]);
  const input=questionCard(h).querySelector('.question-custom');input.value='同一份原回答';input.fire('input');
  const answer={answers:[{id:'question-one',selected:[],custom:'同一份原回答'}]},deciding=h.run(`answerToolQuestion([...toolQuestions.sessions.get('s1').rows.values()][0],${JSON.stringify(answer)})`);
  const request=h.bridge.findLastIndex(item=>item.method==='shared.questions.answer'),requestId=h.bridge[request].params.requestId;
  h.reply(request,null,'TOOL_SOURCE_UNAVAILABLE');await h.flush();
  h.reply(h.bridge.findLastIndex(item=>item.method==='shared.questions.list'),{questions:[row],nextBefore:null,hasMore:false});await deciding;
  assert.equal(h.run("toolQuestions.sessions.get('s1').rows.values().next().value.status"),'pending');
  assert.match(allText(questionCard(h)),/上次回答尚未登记.*同一份原回答.*重试原回答/);
  const restored=harness({storage:Object.fromEntries(h.storage)});prepareApprovalChat(restored);await readQuestions(restored,[row]);
  assert.match(allText(questionCard(restored)),/同一份原回答.*重试原回答/);
  const retry=restored.run(`answerToolQuestion([...toolQuestions.sessions.get('s1').rows.values()][0],${JSON.stringify(answer)})`);
  restored.reply(restored.bridge.findLastIndex(item=>item.method==='shared.questions.list'),{questions:[row],nextBefore:null,hasMore:false});await restored.flush();
  const repeated=restored.bridge.findLastIndex(item=>item.method==='shared.questions.answer');assert.equal(restored.bridge[repeated].params.requestId,requestId);
  const answered=answeredQuestion(row,requestId,answer);restored.reply(repeated,{question:answered,requestId});await restored.flush();
  restored.reply(restored.bridge.findLastIndex(item=>item.method==='shared.questions.list'),{questions:[{...answered,status:'resolved',outcome:'answered',
    resolvedAt:'2026-10-06T14:02:00.000Z',answerAcceptedAt:'2026-10-06T14:02:00.000Z'}],nextBefore:null,hasMore:false});await retry;
  assert.equal([...restored.storage.keys()].some(key=>key.startsWith('weftmate-question-request:')),false);
});

test('task15-question-client a replayed answered snapshot cannot downgrade native completion and task cancellation does not submit another answer',async()=>{
  const h=harness();prepareApprovalChat(h);const row=syntheticQuestionBatch({questions:[{id:'q',question:'补充'}]});await readQuestions(h,[row]);
  const answer={answers:[{id:'q',selected:[]}]},deciding=h.run(`answerToolQuestion([...toolQuestions.sessions.get('s1').rows.values()][0],${JSON.stringify(answer)})`);
  const request=h.bridge.findLastIndex(item=>item.method==='shared.questions.answer'),requestId=h.bridge[request].params.requestId;
  const answered=answeredQuestion(row,requestId,answer),final={...answered,status:'resolved',outcome:'answered',
    resolvedAt:'2026-10-06T14:02:00.000Z',answerAcceptedAt:'2026-10-06T14:02:00.000Z'};
  await readQuestions(h,[final]);h.reply(request,{question:answered,requestId});await h.flush();
  assert.match(allText(questionCard(h)),/已确认接收这份回答/);
  h.reply(h.bridge.findLastIndex(item=>item.method==='shared.questions.list'),{questions:[final],nextBefore:null,hasMore:false});await deciding;
  const cancelled=harness();prepareApprovalChat(cancelled);await readQuestions(cancelled,[{...row,status:'resolved',outcome:'cancelled',resolvedAt:'2026-10-06T14:02:00.000Z'}]);
  assert.match(allText(questionCard(cancelled)),/任务已停止，这个问题不再等待回答/);assert.equal(questionCard(cancelled).querySelector('.question-actions'),null);
  assert.equal(cancelled.bridge.some(item=>item.method==='shared.questions.answer'||item.method==='shared.approvals.decide'),false);
});

test('task15-question-client pagination uses the batch UUID and reads an older pending task by its original source identity',async()=>{
  const h=harness(),fixture=prepareApprovalChat(h),row=syntheticQuestionBatch({questions:[{id:'q',question:'说明'}]}),
    older=syntheticQuestionBatch({questionRpcId:'72345678-1234-4234-8234-123456789abc',questions:[{id:'q',question:'另一批说明'}]});
  h.run('conversationTasks.entries.clear()');const reading=h.run('refreshToolQuestions()');
  let request=h.bridge.findLastIndex(item=>item.method==='shared.questions.list');assert.deepEqual(h.bridge[request].params,{sessionId:'s1'});
  h.reply(request,{questions:[row],nextBefore:row.questionRpcId,hasMore:true});await h.flush();
  request=h.bridge.findLastIndex(item=>item.method==='shared.questions.list');assert.deepEqual(h.bridge[request].params,{sessionId:'s1',before:row.questionRpcId});
  h.reply(request,{questions:[older],nextBefore:null,hasMore:false});await h.flush();
  request=h.bridge.findLastIndex(item=>item.method==='shared.tasks.detail');h.reply(request,fixture.task);await reading;
  assert.equal(h.node('chat-content').children.filter(node=>node.dataset.questionRpcId).length,2);
});

test('task15-question-client closing a view preserves question drafts and late account replies cannot display another account answer',async()=>{
  const h=harness();prepareApprovalChat(h);const row=syntheticQuestionBatch({questions:[{id:'q',question:'说明'}]});await readQuestions(h,[row]);
  const custom=questionCard(h).querySelector('.question-custom');custom.value='返回以后继续填写';custom.fire('input');
  custom.focus();await readQuestions(h,[row,syntheticQuestionBatch({questionRpcId:'82345678-1234-4234-8234-123456789abc',questions:[{id:'q',question:'另一批问题'}]})]);
  assert.equal(h.document.activeElement,custom,'a new batch cannot steal focus from the first batch answer');
  h.run("page('settings');page('chat')");assert.equal(questionCard(h).querySelector('.question-custom').value,'返回以后继续填写');
  assert.equal(h.bridge.some(item=>['shared.stop','shared.tasks.stop','shared.questions.answer'].includes(item.method)),false);
  const checking=h.run('refreshToolQuestions()'),request=h.bridge.findLastIndex(item=>item.method==='shared.questions.list');
  h.run("resetMemoryForAuthBoundary=()=>{};processEvent({event:'account.transition',data:{pending:true}});state.owner='B';state.transitionPending=false");
  h.reply(request,{questions:[row],nextBefore:null,hasMore:false});await checking;assert.equal(questionCard(h),undefined);
});



test('task15-question-client native answer uses a dedicated route with requestId and answer under the existing identity guards',()=>{
  const native=readFileSync(new URL('../../android/app/src/main/java/com/memoweft/weftmate/mobile/HybridActivity.kt',import.meta.url),'utf8'),
    network=readFileSync(new URL('../../android/app/src/main/java/com/memoweft/weftmate/mobile/Network.kt',import.meta.url),'utf8');
  const bridge=native.slice(native.indexOf('"shared.approvals.list", "shared.approvals.decide"'),native.indexOf('"shared.sources.detail"'));
  assert.match(bridge,/"shared.questions.list" -> api.questions\(host/);assert.match(bridge,/api.answerQuestion\(host[\s\S]*?getString\("questionRpcId"\)[\s\S]*?getJSONObject\("answer"\)/);
  assert.match(bridge,/epoch != accountEpoch.get\(\)/);assert.match(bridge,/host != requestHost/);assert.equal([...bridge.matchAll(/\n\s+ensureCurrent\(\)/g)].length,2);
  assert.doesNotMatch(bridge,/api\.business/);assert.match(network,/fun answerQuestion\([\s\S]*?questionAnswerPath\(sessionId, questionRpcId, requestId\)\}[\s\S]*?"POST",\s*JSONObject\(\)\.put\("requestId", requestId\)\.put\("answer", answer\), authWriteHeaders\(host\)/);
});

test('task15-approval-client pending approvals follow exact root and supplement receipts without persistent ordinary-chat controls',async()=>{
  const h=harness(),fixture=prepareApprovalChat(h),row=syntheticApproval();
  const supplement=syntheticApproval({approvalId:'22345678-1234-4234-8234-123456789abc',sourceCommandId:'follow-inline',
    sourceReceiptId:'rpc:follow.2',turn:2,callId:'call:follow.2',rootCallId:'root:follow.2',toolName:'write',reason:'保存这次生成的文件。'});
  h.run("state.sharedEvents.push({seq:3,type:'user.message',data:{text:'相同的目标',receiptId:'rpc:follow.2'}});renderSharedConversation()");
  h.run('state.scrollPinned=false');h.node('chat-scroll').scrollTop=151;h.node('draft').value='保留尚未发送的要求';h.node('draft').focus();
  await readApprovals(h,[row,supplement,syntheticApproval({approvalId:'32345678-1234-4234-8234-123456789abc',
    sourceCommandId:'foreign-source',reason:'错误来源不应可审批'}),syntheticApproval({approvalId:'42345678-1234-4234-8234-123456789abc',
    sourceReceiptId:'rpc:other.2',reason:'错误回执不应可审批'})]);
  const cards=h.node('chat-content').children.filter(node=>node.dataset.approvalId);
  assert.equal(cards.length,2);assert.match(allText(cards[0]),/需要审批 · 运行命令.*需要执行这次命令.*允许一次.*拒绝/);
  assert.match(allText(cards[1]),/需要审批 · 写入文件.*保存这次生成的文件/);
  const children=h.node('chat-content').children;
  assert.ok(children.indexOf(cards[0])>children.findIndex(node=>node.dataset.receiptId===fixture.source.receiptId));
  assert.equal(children.indexOf(cards[1]),children.findIndex(node=>node.dataset.receiptId===supplement.sourceReceiptId)+1);
  assert.doesNotMatch(allText(h.node('chat-content')),/错误来源|错误回执|永久允许|长期偏好/);
  assert.equal(h.node('chat-scroll').scrollTop,151);assert.equal(h.node('draft').value,'保留尚未发送的要求');
  assert.equal(h.document.activeElement,h.node('draft'));
  await readApprovals(h,[]);assert.equal(approvalCard(h),undefined,'no approval controls when there is no approval');
});

for(const outcome of ['allowed-once','rejected'])test(`task15-approval-client ${outcome} records the decision once and waits for native processing`,async()=>{
  const h=harness();prepareApprovalChat(h);const row=syntheticApproval();await readApprovals(h,[row]);
  h.node('draft').value='审批期间也保留草稿';h.node('draft').focus();h.run('state.scrollPinned=false');h.node('chat-scroll').scrollTop=143;
  const deciding=h.run(`decideToolApproval([...toolApprovals.sessions.get('s1').rows.values()][0],${JSON.stringify(outcome)},approvalContext(),true)`);
  const request=h.bridge.findLastIndex(item=>item.method==='shared.approvals.decide'),params=h.bridge[request].params;
  assert.deepEqual(Object.keys(params).sort(),outcome==='allowed-once'?['approvalId','outcome','requestId','scope','sessionId']:['approvalId','outcome','requestId','sessionId']);
  if(outcome==='allowed-once')assert.equal(params.scope,'once');
  assert.equal(params.sessionId,row.sessionId);assert.equal(params.approvalId,row.approvalId);assert.equal(params.outcome,outcome);
  assert.equal(approvalCard(h).querySelector('.approval-actions').children.every(button=>button.disabled),true);
  await h.run(`decideToolApproval([...toolApprovals.sessions.get('s1').rows.values()][0],${JSON.stringify(outcome)})`);
  assert.equal(h.bridge.filter(item=>item.method==='shared.approvals.decide').length,1,'rapid repeat cannot submit another decision');
  const answered=answeredApproval(row,params.requestId,outcome);h.reply(request,{approval:answered,requestId:params.requestId});await h.flush();
  const checking=h.bridge.findLastIndex(item=>item.method==='shared.approvals.list');assert.ok(checking>request);
  h.reply(checking,{approvals:[answered],nextBefore:null,hasMore:false});await deciding;
  assert.match(allText(approvalCard(h)),outcome==='allowed-once'?/已允许 · 运行命令/:/已拒绝 · 运行命令/);
  assert.equal(approvalCard(h).querySelector('.approval-actions'),null);
  assert.equal(h.node('draft').value,'审批期间也保留草稿');assert.equal(h.document.activeElement,h.node('draft'));assert.equal(h.node('chat-scroll').scrollTop,143);
  await readApprovals(h,[{...answered,status:'resolved',outcome,resolvedAt:'2026-10-06T13:02:00.000Z'}]);
  assert.match(allText(approvalCard(h)),outcome==='allowed-once'?/已允许 · 运行命令/:/已拒绝 · 运行命令/);
  assert.doesNotMatch(allText(approvalCard(h)),/目标已完成|任务已完成/);
});

test('task15-approval-client an unknown network reply is read back and can retry only its persisted request on the same device',async()=>{
  const h=harness();prepareApprovalChat(h);const row=syntheticApproval();await readApprovals(h,[row]);
  const deciding=h.run("decideToolApproval([...toolApprovals.sessions.get('s1').rows.values()][0],'allowed-once')");
  const request=h.bridge.findLastIndex(item=>item.method==='shared.approvals.decide'),requestId=h.bridge[request].params.requestId;
  h.reply(request,null,'TIMEOUT');await h.flush();const check=h.bridge.findLastIndex(item=>item.method==='shared.approvals.list');
  assert.ok(check>request);h.reply(check,{approvals:[row],nextBefore:null,hasMore:false});await deciding;
  assert.match(allText(approvalCard(h)),/上次决定尚未登记.*重试允许一次.*检查审批状态/);
  assert.equal(approvalCard(h).querySelector('.approval-actions').children.some(button=>button.textContent==='拒绝'),false);
  const saved=Object.fromEntries(h.storage),restarted=harness({storage:saved});prepareApprovalChat(restarted);await readApprovals(restarted,[row]);
  assert.match(allText(approvalCard(restarted)),/重试允许一次/);
  const retry=restarted.run("decideToolApproval([...toolApprovals.sessions.get('s1').rows.values()][0],'allowed-once')");
  restarted.reply(restarted.bridge.findLastIndex(item=>item.method==='shared.approvals.list'),{approvals:[row],nextBefore:null,hasMore:false});await restarted.flush();
  const repeated=restarted.bridge.findLastIndex(item=>item.method==='shared.approvals.decide');assert.equal(restarted.bridge[repeated].params.requestId,requestId);
  const answered=answeredApproval(row,requestId,'allowed-once');restarted.reply(repeated,{approval:answered,requestId});await restarted.flush();
  restarted.reply(restarted.bridge.findLastIndex(item=>item.method==='shared.approvals.list'),
    {approvals:[{...answered,status:'resolved',outcome:'allowed-once',resolvedAt:'2026-10-06T13:02:00.000Z'}],nextBefore:null,hasMore:false});await retry;
  assert.equal([...restarted.storage.keys()].some(key=>key.startsWith('weftmate-approval:')),false);
  const other=harness({storage:saved});prepareApprovalChat(other,{deviceId:'phone-b'});await readApprovals(other,[row]);
  assert.match(allText(approvalCard(other)),/允许一次.*拒绝/);assert.doesNotMatch(allText(approvalCard(other)),/重试允许/);
});

test('task15-approval-client replayed answered receipts cannot regress an already-read resolved or unavailable approval',async()=>{
  for(const terminal of ['resolved','unavailable']){
    const h=harness();prepareApprovalChat(h);const row=syntheticApproval();await readApprovals(h,[row]);
    const deciding=h.run("decideToolApproval([...toolApprovals.sessions.get('s1').rows.values()][0],'rejected')");
    const request=h.bridge.findLastIndex(item=>item.method==='shared.approvals.decide'),requestId=h.bridge[request].params.requestId;
    const answered=answeredApproval(row,requestId,'rejected'),final={...answered,status:terminal,
      outcome:terminal==='resolved'?'rejected':'cancelled',...(terminal==='resolved'?{resolvedAt:'2026-10-06T13:02:00.000Z'}:{})};
    await readApprovals(h,[final]);h.reply(request,{approval:answered,requestId});await h.flush();
    assert.equal(h.run("toolApprovals.sessions.get('s1').rows.values().next().value.status"),terminal);
    h.reply(h.bridge.findLastIndex(item=>item.method==='shared.approvals.list'),{approvals:[final],nextBefore:null,hasMore:false});await deciding;
    assert.equal(approvalCard(h).querySelector('.approval-actions'),null);assert.doesNotMatch(allText(approvalCard(h)),/等待执行端处理/);
  }
});

test('task15-approval-client task cancellation and other invalidation have different messages and no decision buttons',async()=>{
  for(const outcome of ['cancelled','unavailable']){
    const h=harness();prepareApprovalChat(h);await readApprovals(h,[syntheticApproval({status:'unavailable',outcome})]);
    assert.match(allText(approvalCard(h)),outcome==='cancelled'?/已取消 · 运行命令/:/审批已失效 · 运行命令/);
    assert.equal(approvalCard(h).querySelector('.approval-actions'),null);
  }
});

test('task15-approval-client paging omits the first cursor and loads older pending tasks by their exact task identity',async()=>{
  const h=harness(),fixture=prepareApprovalChat(h),first=syntheticApproval(),second=syntheticApproval({approvalId:'22345678-1234-4234-8234-123456789abc',
    callId:'call:root.2',rootCallId:'root:call.2',reason:'另一项独立审批'});
  h.run('conversationTasks.entries.clear()');const reading=h.run('refreshToolApprovals()');
  let request=h.bridge.findLastIndex(item=>item.method==='shared.approvals.list');assert.deepEqual(h.bridge[request].params,{sessionId:'s1'});
  h.reply(request,{approvals:[first],nextBefore:first.approvalId,hasMore:true});await h.flush();
  request=h.bridge.findLastIndex(item=>item.method==='shared.approvals.list');assert.deepEqual(h.bridge[request].params,{sessionId:'s1',before:first.approvalId});
  h.reply(request,{approvals:[second],nextBefore:null,hasMore:false});await h.flush();
  request=h.bridge.findLastIndex(item=>item.method==='shared.tasks.detail');assert.deepEqual(h.bridge[request].params,{taskId:'root-inline'});
  h.reply(request,fixture.task);await reading;
  assert.equal(h.node('chat-content').children.filter(node=>node.dataset.approvalId).length,2);
});

test('task15-approval-client a changed call tuple cannot update a known approval and late account/device/session results stay out of the new view',async()=>{
  const h=harness();prepareApprovalChat(h);const row=syntheticApproval();await readApprovals(h,[row]);
  await readApprovals(h,[{...row,callId:'different-call',reason:'错误替换'}]);
  assert.equal(h.run("toolApprovals.sessions.get('s1').rows.values().next().value.callId"),row.callId);
  assert.doesNotMatch(allText(approvalCard(h)),/错误替换/);assert.match(allText(approvalCard(h)),/审批状态待更新.*检查审批状态/);
  for(const boundary of ['account','device','session']){
    const late=harness();prepareApprovalChat(late);const reading=late.run('refreshToolApprovals()');const request=late.bridge.length-1;
    late.run(boundary==='account'?"resetMemoryForAuthBoundary=()=>{};processEvent({event:'account.transition',data:{pending:true}});state.owner='B';state.transitionPending=false":
      boundary==='device'?"state.deviceId='phone-b';clear(document.getElementById('chat-content'))":
      "state.sharedSessionId='s2';state.generation++;clear(document.getElementById('chat-content'))");
    late.reply(request,{approvals:[row],nextBefore:null,hasMore:false});await reading;
    assert.equal(late.node('chat-content').children.some(node=>node.dataset.approvalId),false,boundary);
  }
});

test('task15-approval-client leaving during a decision retains its marker and returning to the original task reads native processing',async()=>{
  const h=harness();prepareApprovalChat(h);const row=syntheticApproval();await readApprovals(h,[row]);
  const deciding=h.run("decideToolApproval([...toolApprovals.sessions.get('s1').rows.values()][0],'allowed-once')");
  const request=h.bridge.findLastIndex(item=>item.method==='shared.approvals.decide'),requestId=h.bridge[request].params.requestId;
  h.run("state.sharedSessionId='s2';state.generation++;clear(document.getElementById('chat-content'))");
  const answered=answeredApproval(row,requestId,'allowed-once');h.reply(request,{approval:answered,requestId});await deciding;
  assert.equal(h.node('chat-content').children.length,0);assert.equal(h.run("toolApprovals.attempts.values().next().value.busy"),false);
  h.run("state.sharedSessionId='s1';state.generation++;renderSharedConversation()");
  await readApprovals(h,[answered]);assert.match(allText(approvalCard(h)),/已允许 · 运行命令/);
  assert.equal(approvalCard(h).querySelector('.approval-actions'),null);
});



test('task15-approval-client native methods use dedicated authenticated routes and keep both account guards',()=>{
  const native=readFileSync(new URL('../../android/app/src/main/java/com/memoweft/weftmate/mobile/HybridActivity.kt',import.meta.url),'utf8');
  const network=readFileSync(new URL('../../android/app/src/main/java/com/memoweft/weftmate/mobile/Network.kt',import.meta.url),'utf8');
  const bridge=native.slice(native.indexOf('"shared.approvals.list", "shared.approvals.decide"'),native.indexOf('"shared.sources.detail"'));
  assert.match(bridge,/val host = requireHost\(\)/);assert.match(bridge,/val epoch = requestEpoch/);
  assert.match(bridge,/owner\(secrets.host\(\)\) != scope/);assert.match(bridge,/secrets.host\(\) != host/);
  assert.match(bridge,/host != requestHost/);assert.match(native,/val requestEpoch = accountEpoch.get\(\)\s+val requestHost = secrets.host\(\)/);
  assert.match(native,/handle\(method, request.optJSONObject\("params"\) \?: JSONObject\(\), requestEpoch, requestHost\)/);
  assert.equal([...bridge.matchAll(/\n\s+ensureCurrent\(\)/g)].length,2);
  assert.match(bridge,/api\.approvals\(host/);assert.match(bridge,/api\.decideApproval\(host/);assert.doesNotMatch(bridge,/api\.business/);
  assert.match(network,/fun approvals\([\s\S]*?approvalListPath\(sessionId, before, limit\)\}[\s\S]*?"GET"[\s\S]*?"Cookie" to host.cookie/);
  assert.match(network,/fun decideApproval\([\s\S]*?approvalDecisionPath\(sessionId, approvalId, requestId, outcome, scope\)\}[\s\S]*?"POST",\s*JSONObject\(\)\.put\("requestId", requestId\)\.put\("outcome", outcome\)\.apply[\s\S]*?put\("scope", scope\)[\s\S]*?authWriteHeaders\(host\)/);
  assert.match(native,/\.put\("deviceId", host\?\.deviceId/);
});
function prepareSyntheticTaskChat(h){h.run(`state.loggedIn=true;state.owner='A';state.chatSource='host';state.sharedSessionId='s1';
  state.sharedHostAvailable=true;state.sharedSessions=[{sessionId:'s1',title:'合成对话',sendAvailable:true}];
  state.sharedEvents=[{seq:0,type:'user.message',data:{text:'相同的目标',receiptId:'rpc:root.1'}},
    {seq:1,type:'assistant.message',data:{text:'请结合成果核对目标。'}},
    {seq:2,type:'user.message',data:{text:'相同的目标',receiptId:'rpc:other.2'}}];renderSharedConversation()`)}
async function feedSyntheticTask(h,task,activity){const refreshing=h.run('refreshConversationTasks()');
  const activityIndex=h.bridge.findLastIndex(request=>request.method==='activity.list');
  h.reply(activityIndex,{activities:[activity],hostAvailable:true});await h.flush();
  const detailIndex=h.bridge.findLastIndex(request=>request.method==='shared.tasks.detail');
  h.reply(detailIndex,task);await refreshing;return detailIndex}

test('terminal-output-limit mobile history requires the normalized pair and preserves legacy terminal meanings',()=>{
  const cases=[
    {data:{reason:'error',endReasonKind:'max-tokens'},text:'本轮因输出限制结束，可继续对话。'},
    {data:{reason:'error'},text:'电脑回合未完成'},
    {data:{reason:'unknown',endReasonKind:'max-tokens'},text:'电脑回合状态待确认'},
    {data:{},text:'电脑回合状态待确认'},
    {data:{reason:{kind:'max-tokens'}},text:'电脑回合状态待确认'},
    {data:{reason:'completed',endReasonKind:'max-tokens'},text:''},
    {data:{reason:'aborted',endReasonKind:'max-tokens'},text:'电脑回合已停止'},
    {data:{reason:'blocked',endReasonKind:'max-tokens'},text:'电脑回合等待处理'},
  ];
  for(const item of cases){const h=harness();prepareSyntheticTaskChat(h);
    h.run(`state.sharedEvents=[{seq:1,type:'turn.ended',data:${JSON.stringify(item.data)}}];renderSharedConversation()`);
    const text=h.node('chat-content').children.find(node=>node.className==='shared-turn-state')?.textContent||'';
    assert.equal(text,item.text,JSON.stringify(item.data));
  }
});

test('terminal-output-limit mobile keeps an old pure-reply card bound to its source while newer turns clear the timeline',async()=>{
  const h=harness(),fixture=syntheticConversationTask();prepareSyntheticTaskChat(h);
  fixture.task.executionSteps=[];fixture.task.replyEvidence={status:'failed',endReasonKind:'max-tokens',turn:2,
    sourceCommandId:fixture.source.commandId,sourceReceiptId:fixture.source.receiptId,terminalAt:'2026-10-07T00:35:29.769Z'};
  const initial=JSON.stringify(fixture.task);
  h.run(`state.sharedEvents=[state.sharedEvents[0],{seq:1,type:'turn.ended',data:{reason:'error',endReasonKind:'max-tokens',turn:2}}];renderSharedConversation()`);
  await feedSyntheticTask(h,fixture.task,fixture.activity);
  let card=h.node('chat-content').children.find(node=>node.dataset.conversationTask===fixture.task.taskId);
  assert.ok(card);assert.equal(card.children[0].textContent,'回复状态');
  assert.equal(h.node('chat-content').children.indexOf(card),h.node('chat-content').children.findIndex(node=>node.dataset.receiptId===fixture.source.receiptId)+1);
  assert.match(allText(card),/因输出限制结束，尚未确认完整交付/);
  assert.doesNotMatch(allText(card),/工具进展|已正常结束|用户拒绝|费用|没有成果/);
  assert.match(allText(h.node('chat-content')),/本轮因输出限制结束，可继续对话/);
  h.run(`state.sharedSessions[0].running=true;state.sharedEvents.push({seq:2,type:'user.message',data:{text:'相同的目标',receiptId:'rpc:new.3'}},
    {seq:3,type:'turn.started',data:{turn:3}});renderSharedConversation()`);
  card=h.node('chat-content').children.find(node=>node.dataset.conversationTask===fixture.task.taskId);
  assert.match(allText(card),/因输出限制结束，尚未确认完整交付/);
  assert.equal(h.node('chat-content').children.find(node=>node.className==='shared-turn-state').textContent,'正在处理…');
  h.run("state.sharedSessions[0].running=false;state.sharedEvents.push({seq:4,type:'turn.ended',data:{reason:'completed',turn:3}});renderSharedConversation()");
  assert.equal(h.node('chat-content').children.some(node=>node.className==='shared-turn-state'),false);
  h.run("state.sharedEvents.push({seq:5,type:'turn.ended',data:{reason:'error',turn:4}});renderSharedConversation()");
  assert.equal(h.node('chat-content').children.find(node=>node.className==='shared-turn-state').textContent,'电脑回合未完成');
  card=h.node('chat-content').children.find(node=>node.dataset.conversationTask===fixture.task.taskId);
  assert.match(allText(card),/因输出限制结束，尚未确认完整交付/);
  assert.equal(JSON.stringify(fixture.task),initial,'display keeps the old source, turn and terminalAt evidence intact');
});



test('terminal-output-limit mobile session and account boundaries reject late old reasons',async()=>{
  for(const boundary of ['session','account']){const h=harness();prepareSyntheticTaskChat(h);
    h.run(`state.sharedSessions.push({sessionId:'s2',title:'另一段会话',sendAvailable:true});
      state.sharedEvents.push({seq:3,type:'turn.ended',data:{reason:'error',endReasonKind:'max-tokens'}});renderSharedConversation()`);
    assert.match(allText(h.node('chat-content')),/本轮因输出限制结束，可继续对话/);
    const reading=h.run('loadSharedHistory()'),request=h.bridge.findLastIndex(item=>item.method==='shared.sessions.events');
    if(boundary==='session')h.run("selectSharedSession('s2');renderSharedConversation()");
    else h.run(`resetMemoryForAuthBoundary=()=>{};processEvent({event:'account.transition',data:{pending:true}});
      state.owner='B';state.transitionPending=false;state.loggedIn=true;state.chatSource='host';state.sharedSessionId='s2';
      state.sharedSessions=[{sessionId:'s2',title:'B 的会话',sendAvailable:true}];state.page='chat';renderSharedConversation()`);
    h.reply(request,{source:'host',sessionId:'s1',events:[{seq:4,type:'turn.ended',data:{reason:'error',endReasonKind:'max-tokens'}}],nextSeq:4,hasMore:false});
    await reading;
    assert.equal(h.run('state.sharedEvents.length'),0);
    assert.doesNotMatch(allText(h.node('chat-content')),/输出限制/);
  }
});

test('synthetic mobile tool progress follows dotted RPC identity and keeps unrelated execution receipts hidden',async()=>{
  const h=harness(),fixture=syntheticConversationTask();prepareSyntheticTaskChat(h);
  h.run('state.scrollPinned=false');h.node('chat-scroll').scrollTop=180;
  await feedSyntheticTask(h,fixture.task,fixture.activity);
  const children=h.node('chat-content').children,card=children.find(node=>node.dataset.conversationTask);
  assert.ok(card);assert.equal(children.indexOf(card),children.findIndex(node=>node.dataset.receiptId===fixture.source.receiptId)+1);
  assert.match(allText(card),/运行命令 · 后台运行中.*读取文件 · 执行结束.*回复回合已正常结束/);
  assert.doesNotMatch(allText(card),/搜索内容|rpc:|exec-|目标已完成|已核验/);
  assert.equal(h.node('chat-scroll').scrollTop,180,'a tool update preserves manual scroll-back');
  assert.equal(h.bridge.filter(request=>request.method.startsWith('shared.tasks.')&&request.method!=='shared.tasks.detail').length,0);
});

test('synthetic ordinary mobile chat and invalid RPC IDs do not show execution cards',async()=>{
  for(const receiptId of ['rpc:root.1','invalid receipt','x'.repeat(161)]){
    const h=harness(),fixture=syntheticConversationTask();prepareSyntheticTaskChat(h);
    fixture.task.source.receiptId=receiptId;
    fixture.task.executionSteps=receiptId==='rpc:root.1'?[]:[{...fixture.task.executionSteps[0],sourceReceiptId:receiptId}];
    h.run(`state.sharedEvents[0].data.receiptId=${JSON.stringify(receiptId)};renderSharedConversation()`);
    await feedSyntheticTask(h,fixture.task,fixture.activity);
    assert.equal(h.node('chat-content').children.some(node=>node.dataset.conversationTask),false);
  }
});





test('synthetic mobile failed detail stays recoverable, and a late receipt relocates its unchanged failure card',async()=>{
  const h=harness(),fixture=syntheticConversationTask();prepareSyntheticTaskChat(h);
  h.run("state.sharedEvents=[];renderSharedConversation()");
  await feedSyntheticTask(h,fixture.task,fixture.activity);
  assert.equal(h.node('chat-content').children.some(node=>node.dataset.conversationTask),false,'no guessed message anchor before its receipt appears');
  const refreshing=h.run('refreshConversationTasks()');h.reply(h.bridge.length-1,{activities:[fixture.activity],hostAvailable:true});await h.flush();
  h.reply(h.bridge.findLastIndex(item=>item.method==='shared.tasks.detail'),null,'HOST_UNAVAILABLE');await refreshing;
  const card=h.node('chat-content').children.find(node=>node.dataset.conversationTask);assert.match(allText(card),/待更新.*重新核对进展/);
  h.run("state.sharedEvents=[{seq:0,type:'user.message',data:{text:'相同目标',receiptId:'rpc:root.1'}},{seq:1,type:'assistant.message',data:{text:'稍后核对'}}];renderSharedConversation()");
  const rows=h.node('chat-content').children;assert.equal(rows.findIndex(node=>node.dataset.conversationTask),rows.findIndex(node=>node.dataset.receiptId==='rpc:root.1')+1);
  await feedSyntheticTask(h,fixture.task,fixture.activity);
  const offline=h.run('refreshConversationTasks()');h.reply(h.bridge.length-1,{activities:[],hostAvailable:false});await offline;
  const stale=h.node('chat-content').children.find(node=>node.dataset.conversationTask);
  assert.match(allText(stale),/待更新.*电脑暂不可达.*上次记录：运行命令 · 后台运行中/);
  assert.doesNotMatch(allText(stale),/回复回合已正常结束/);
  fixture.task.control={state:'stop_requested',stopStatus:'cancel_requested'};
  fixture.task.executionSteps[0].jobState='stopping';await feedSyntheticTask(h,fixture.task,fixture.activity);
  assert.match(allText(stale),/后台正在停止.*等待实际结束记录/);
  fixture.task.control.stopStatus='stopped';fixture.task.executionSteps[0].jobState='killed';
  await feedSyntheticTask(h,fixture.task,fixture.activity);assert.match(allText(stale),/后台已停止.*实际停止/);
});

test('synthetic late mobile task payload cannot cross account epoch or conversation boundaries',async()=>{
  for(const boundary of ["state.authEpoch++;state.owner='B'","state.sharedSessionId='s2'"]){
    const h=harness(),fixture=syntheticConversationTask();prepareSyntheticTaskChat(h);
    const refreshing=h.run('refreshConversationTasks()');h.reply(h.bridge.length-1,{activities:[fixture.activity],hostAvailable:true});await h.flush();
    const detail=h.bridge.findLastIndex(item=>item.method==='shared.tasks.detail');
    h.run(`${boundary};renderSharedConversation()`);h.reply(detail,fixture.task);await refreshing;
    assert.equal(h.node('chat-content').children.some(node=>node.dataset.conversationTask),false);
  }
});
function findNode(node,predicate){if(predicate(node))return node;for(const child of node.children||[]){const match=findNode(child,predicate);if(match)return match}return null}
function countNodes(node,predicate){return Number(predicate(node))+(node.children||[]).reduce((count,child)=>count+countNodes(child,predicate),0)}









test('manual shared status check reconciles the saved request once and refreshes connectivity',async()=>{
  const h=harness();h.run('state.loggedIn=true;state.owner="A";state.page="chat";state.chatSource="host";state.sharedSessionId="pc1";state.sharedSessions=[{sessionId:"pc1",title:"电脑",sendAvailable:true,source:"host"}];state.sharedPending={requestId:"saved-1",state:"uncertain",text:"离线消息"}');
  h.node('draft').value='离线消息';const checking=h.run('checkSharedPending()');await h.run('checkSharedPending()');
  assert.equal(h.bridge.filter(item=>item.method==='shared.outbox.reconcile').length,1);
  h.reply(h.bridge.findIndex(item=>item.method==='shared.outbox.reconcile'),{source:'host',commands:[{source:'host',sessionId:'pc1',requestId:'saved-1',kind:'session.message',state:'accepted'}]});
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
  assert.equal(h.run('state.page'),'home');
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


test('M1-0 mobile execution is collapsed by default, groups calls once, and ends across a card boundary',()=>{
  const h=harness();prepareSyntheticTaskChat(h);
  h.run(`state.sharedEvents=[
    {seq:1,type:'step.started',at:'2026-10-07T00:00:00Z',data:{taskId:'turn-1',stepId:'s1',summary:'读取文件',state:'running',detailRef:{seq:1}}},
    {seq:2,type:'approval.requested',data:{approvalId:'approval-one',summary:'覆盖报告文件'}},
    {seq:3,type:'step.completed',at:'2026-10-07T00:00:02Z',data:{taskId:'turn-1',stepId:'s1',summary:'读取文件',state:'completed',detailRef:{seq:3}}},
    {seq:4,type:'step.started',data:{taskId:'turn-1',stepId:'s2',summary:'运行命令 npm test',state:'running'}},
    {seq:5,type:'task.ended',data:{taskId:'turn-1'}}];renderSharedConversation()`);
  const blocks=h.node('chat-content').children.filter(node=>node.dataset.timeline?.startsWith('steps-'));
  assert.equal(blocks.length,2);assert.equal(blocks[0].querySelector('details').open,false);
  assert.match(allText(blocks[0]),/执行了 1 步.*用时 2 秒/);assert.match(allText(blocks[1]),/执行了 1 步/);
  assert.equal(h.node('chat-content').children.some(node=>node.dataset.timelineApproval==='approval-one'),true);
  const counts=h.node('chat-content').children.length;h.run('renderTimeline()');assert.equal(h.node('chat-content').children.length,counts);
})

test('M0-3 mobile requests the tail first, prepends older events, and preserves the forward cursor',async()=>{
  const h=harness();prepareSyntheticTaskChat(h);h.run('state.sharedEvents=[];state.sharedNextSeq=-1;state.sharedLoading=false');
  const first=h.run('loadSharedHistory()');let i=h.bridge.findLastIndex(r=>r.method==='shared.sessions.events');
  assert.equal(h.bridge[i].params.afterSeq,undefined);
  h.reply(i,{source:'host',sessionId:'s1',events:[{seq:2400,type:'assistant.message',data:{text:'最新回复'}}],nextSeq:2400,hasMore:false,hasOlder:true,nextBeforeSeq:2400});await first;
  assert.equal(h.run('state.sharedNextSeq'),2400);const older=h.run('loadOlderHistory()');i=h.bridge.findLastIndex(r=>r.method==='shared.sessions.events');
  assert.equal(h.bridge[i].params.beforeSeq,2400);h.reply(i,{source:'host',sessionId:'s1',events:[{seq:2399,type:'assistant.message',data:{text:'较早回复'}}],nextSeq:2400,hasMore:false,hasOlder:false,nextBeforeSeq:2399});await older;
  assert.equal(h.run('state.sharedEvents.map(e=>e.seq).join(",")'),'2399,2400');assert.equal(h.run('state.sharedNextSeq'),2400);
})

test('M1-0 mobile native bridge preserves beforeSeq and accepts the shared timeline event families',()=>{
  const native=readFileSync(new URL('../../android/app/src/main/java/com/memoweft/weftmate/mobile/HybridActivity.kt',import.meta.url),'utf8');
  const store=readFileSync(new URL('../../android/app/src/main/java/com/memoweft/weftmate/mobile/LocalStore.kt',import.meta.url),'utf8');
  assert.match(native,/params.has\("beforeSeq"\)/);assert.match(native,/shared.sessions.eventDetail/);
  for(const type of ['step.started','approval.requested','question.answered','artifact.created','task.ended'])assert.ok(store.includes(type));
  assert.doesNotMatch(html,/things-button|data-page="things"/);
})


test('consecutive steps show readable descriptions before their raw detail',()=>{
  const h=harness();prepareSyntheticTaskChat(h);
  h.run(`state.sharedEvents=[
    {seq:1,type:'step.completed',data:{taskId:'turn-1',stepId:'read-a',toolName:'read',groupHint:'read',summary:'读取文件',state:'completed',detailRef:{seq:1}}},
    {seq:2,type:'step.completed',data:{taskId:'turn-1',stepId:'read-b',toolName:'read_file',groupHint:'read_file',summary:'读取文件',state:'completed',detailRef:{seq:2}}}];renderSharedConversation()`);
  const subgroup=h.node('chat-content').querySelector('.execution-block');assert.ok(subgroup);
  assert.match(allText(subgroup),/执行了 2 步/);assert.equal(subgroup.open,false);
  assert.equal(subgroup.children.filter(node=>node.className==='execution-step').length,2);
})

test('model restart stays pending on mobile through a two-minute native load and is not resubmitted',async()=>{
  const h=harness();
  h.run(`state.page='settings';state.loggedIn=true;state.owner='fixture-owner';document.getElementById('page-content').isConnected=true;void systemStatusSection(document.getElementById('page-content'))`);
  const system={canRestart:true,queue:{},model:{state:'ready',canRestart:true,contextWindow:98304},
    host:{state:'ready',canRestart:true},memory:{state:'disabled',canRestart:false}};
  h.reply(0,system);h.reply(1,{backgroundModelProfileId:null});await h.flush();await h.flush();
  const walk=node=>[node,...node.children.flatMap(child=>child.children?walk(child):[])];
  const target=h.node('page-content');const button=walk(target).find(node=>node.tagName==='button'&&node.textContent==='重启模型服务');
  assert.ok(button);button.fire('click');await h.flush();
  h.advance(120000);await h.flush();
  assert.equal(button.disabled,true);assert.equal(button.textContent,'重启中…');
  assert.equal(h.bridge.filter(row=>row.params.path==='/personal/v1/system/model/restart').length,1);
  h.reply(2,system);await h.flush();await h.flush();
  assert.equal(walk(target).some(node=>node.textContent==='重启未确认，请刷新查看实际状态。'),false);
});
