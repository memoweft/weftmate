'use strict';
// Local, synthetic interaction model. No network, account storage or platform permissions.
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => (window.WEFT_ICONS[name] || window.WEFT_ICONS.info).replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
const ib = (name,label,attrs) => `<button class="icon-button" aria-label="${label}" ${attrs}>${icon(name)}</button>`;
const button = (label,attrs='',kind='') => `<button class="button ${kind}" ${attrs}>${label}</button>`;
const row = (name,title,detail='',attrs='',value='') => `<button class="list-row" ${attrs}>${icon(name)}<span class="row-copy"><strong>${title}</strong>${detail?`<small>${detail}</small>`:''}</span>${value?`<span class="value">${value}</span>`:''}${icon('right').replace('<svg ','<svg class="chevron" ')}</button>`;
const toggle = (title,detail='',on=true,key=title) => `<div class="list-row"><span class="row-copy"><strong>${title}</strong>${detail?`<small>${detail}</small>`:''}</span><button class="switch" role="switch" aria-label="${title}" aria-checked="${on}" data-toggle="${key}"></button></div>`;
const section = (title,content) => `<h3 class="section-title">${title}</h3><div class="group">${content}</div>`;
const field = (name,placeholder='',value='',type='text') => `<label class="field"><span>${name}</span><input type="${type}" aria-label="${name}" placeholder="${placeholder}" value="${value}" ${type==='password'?'autocomplete="off"':''}></label>`;
const segment = (items,kind,selected=0) => `<div class="segment" aria-label="${kind}">${items.map((s,i)=>`<button data-segment="${kind}" aria-pressed="${i===selected}">${s}</button>`).join('')}</div>`;
const title = (text,sub='') => `<div class="page-title"><h2>${text}</h2>${sub?`<p>${sub}</p>`:''}</div>`;
const linkRow = (name,text,route,sub='',value='') => row(name,text,sub,`data-go="${route}"`,value);
const note = text => `<p class="note">${text}</p>`;
const S = {tab:'chat', stacks:{chat:['chat'],activity:['activity'],health:['health']},state:'normal',model:'账户云模型',streaming:false,follow:true,queue:[],metric:'sleep',memoryKind:'偏好',fileType:'文档',forgotten:false,goalPaused:false,goalState:'active',temporary:false,conversation:'WeftMate',mode:'chat',replyCounter:0,overlay:null,theme:'light',authPurpose:'login',reminderID:null,reminders:[{id:1,text:'带水出门',date:'2026-10-28T09:00',complete:false},{id:2,text:'把借来的书带上',date:'2026-10-31T09:15',complete:false}]};
const cache = new Map();
Object.assign(S,{metricDays:7,healthCloud:false,mutedIDs:new Set(),memoryID:'preference',sourceMemory:'preference',forgottenIDs:new Set(),serviceDeleted:false,scheduleDeleted:false,healthDeleted:false,selectedDay:0,pendingDecision:null});
let current=null, restoreFocus=null, streamHandle=0, toastTimer=0, transitionTimer=0, sheetName=null;
const rootTitles={chat:'WeftMate',activity:'动态',health:'健康'};
const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion==='true';
const ms=name=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--'+name));
function currentRoute(){return S.stacks[S.tab].at(-1);}
function hydrate(root=document){$$('[data-icon]',root).forEach(e=>e.innerHTML=icon(e.dataset.icon));}
function navbar(id){
  const root=['chat','activity','health'].includes(id), auth=AUTH_ROUTES.includes(id);
  const left=root?ib('sidebar','打开侧栏','data-action="drawer"'):ib('back','返回','data-action="back"');
  const label=id==='chat'?S.conversation:CATALOG[id];
  const subtitle=id==='chat'?`<small>${S.temporary?'临时对话 · 不形成记忆':S.state==='offline'?'电脑离线 · 手机自己答':S.mode==='work'?'工作 · 已连接示例电脑':'对话 · 手机随时可以聊'}</small>`:'';
  const action=auth?'':id==='health'?ib('settings','健康数据设置','data-go="health-settings"'):id==='chat'?ib('compose','新建对话','data-sheet="new-chat"'):ib('more','页面选项','data-action="page-options"');
  return `<header class="navbar">${left}<div class="nav-title">${escapeHTML(label)}${subtitle}</div>${ib(S.theme==='light'?'moon':'sun','切换深浅色','data-action="theme"')}${action}</header>`;
}
function composer(){return `<div class="composer"><div class="composer-context"><button data-sheet="mode">${S.mode==='work'?'工作 · 示例电脑 / 周末计划':'对话'} ${icon('chevron').replace('<svg ','<svg style="display:inline;width:10px;height:10px" ')}</button><button data-sheet="sync">${S.state==='offline'?'2 条原话等待交给电脑':'电脑已收到原话'}</button></div><div class="composer-box"><div class="attachment-chip" hidden></div><textarea aria-label="消息" placeholder="接着聊，或者交代一件事…" rows="1"></textarea><div class="composer-tools">${ib('plus','添加附件','data-sheet="attachments"')}<button class="model-button" data-sheet="models"><span>${S.model}</span>${icon('chevron')}</button>${ib('mic','语音输入','data-sheet="voice"')}<button class="icon-button send-button" aria-label="发送消息" data-action="send">${icon('send')}</button></div></div></div>`;}
function emptyState(id){
  if(!['activity','health','goals','library','memory','conversations'].includes(id)) return null;
  if(id==='health' && S.healthDeleted)return `<div class="empty">${icon('health')}<h3>摘要已删除，读取已停止</h3><p>本机摘要已清理；远端删除等待回执。「健康」中的原始记录保留。</p>${button('重新选择读取项目','data-sheet="health-permission"','outline')}</div>`;
  const nouns={activity:['bell','还没有动态','任务进展、提醒和每周回顾会出现在这里。'],health:['health','先接上健康数据','只读取你选择的项目。没有测量的地方留空。'],goals:['goal','给一件事留个位置','在对话里说说想长期做的事，也可以先设一个手机提醒。'],library:['outputs','成果会留在这里','对话里产生的文档、表格和图片，可以在这里再次找到。'],memory:['bookmark','还没有同步的记忆','连上电脑后会同步它整理好的记忆；现在也可以继续聊天。'],conversations:['chat','从一句话开始','在这里新建一段对话。']};
  const n=nouns[id];
  if(S.state==='loading') return `<div aria-busy="true" aria-label="正在读取" class="loading-bars">${Array.from({length:9},()=>'<span class="pulse"></span>').join('')}</div>`;
  if(S.state==='error') return `<div class="empty">${icon('offline')}<h3>这次没能读到${CATALOG[id]}</h3><p>已有内容会保留，可以重新读取。</p>${button('重试','data-action="retry-page"','primary')}</div>`;
  if(S.state==='empty') return `<div class="empty">${icon(n[0])}<h3>${n[1]}</h3><p>${n[2]}</p>${button(id==='health'?'选择读取项目':id==='goals'?'新建提醒':'去聊天',id==='health'?'data-sheet="health-permission"':id==='goals'?'data-sheet="reminder"':'data-tab="chat"','primary')}</div>`;
  return null;
}
function mount(id){
  if(cache.has(id)) return cache.get(id);
  const el=document.createElement('section');el.className='page';el.dataset.page=id;el.setAttribute('aria-label',CATALOG[id]);
  const placeholder=emptyState(id);
  el.innerHTML=navbar(id)+`<div class="page-content ${id==='chat'?'chat-content':''}" tabindex="-1">${placeholder || PAGES[id]()}</div>`+(id==='chat'?composer()+`<button class="new-content" data-action="follow" hidden>回到最新回复 ${icon('chevron').replace('<svg ','<svg style="display:inline;width:12px;height:12px" ')}</button>`:'');
  $('#stage').append(el);cache.set(id,el);
  const scroller=$('.page-content',el);
  if($('.page-title',el))el.classList.add('large-title-page');
  scroller.addEventListener('wheel',e=>{if(id==='chat' && e.deltaY<0) {S.follow=false;updateFollow();}},{passive:true});
  scroller.addEventListener('touchmove',()=>{if(id==='chat'){S.follow=false;updateFollow();}},{passive:true});
  scroller.addEventListener('scroll',()=>{el.classList.toggle('title-scrolled',scroller.scrollTop>44);if(id==='chat' && scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<IOS_MOTION['follow-threshold']){S.follow=true;updateFollow();}},{passive:true});
  hydrate(el);return el;
}
function show(id,kind='push'){
  if(!CATALOG[id]) throw new Error('Unknown prototype route: '+id);
  clearTimeout(transitionTimer);
  $$('.page').forEach(e=>{e.classList.remove('enter','leaving','pop-enter','pop-leave','tab-enter');if(e!==current){e.setAttribute('aria-hidden','true');e.inert=true;}});
  const old=current, next=mount(id);
  if(old && old!==next){old.setAttribute('aria-hidden','true');old.inert=true;old.classList.add(kind==='back'?'pop-leave':'leaving');}
  next.setAttribute('aria-hidden','false');next.inert=false;current=next;
  if(old!==next && kind!=='instant')next.classList.add(kind==='back'?'pop-enter':kind==='tab'?'tab-enter':'enter');
  transitionTimer=setTimeout(()=>{if(old && old!==next)old.classList.remove('leaving','pop-leave');next.classList.remove('enter','pop-enter','tab-enter');},reduceMotion()?1:ms('dur-3'));
  $('#phone').classList.toggle('auth-mode',AUTH_ROUTES.includes(id));
  $$('.tabs button').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===S.tab?'page':'false'));
  $('#scene').value=id;document.title=CATALOG[id]+' · WeftMate 原型';
  if(kind!=='instant') $('.page-content',next).focus({preventScroll:true});
}
function go(id,{direct=false}={}){
  closeOverlay(true);
  if(!direct && ['chat','activity','health'].includes(id)){S.tab=id;S.stacks[id]=[id];show(id,'tab');return;}
  if(direct){S.tab=['activity','health'].includes(id)?id:'chat';S.stacks[S.tab]=id===S.tab?[id]:[S.tab,id];}
  else if(id!==currentRoute())S.stacks[S.tab].push(id);
  show(id,direct?'instant':'push');
}
function back(){if(S.overlay){closeOverlay();return;}const stack=S.stacks[S.tab];if(stack.length>1){stack.pop();show(stack.at(-1),'back');}else if(AUTH_ROUTES.includes(currentRoute()))go('chat',{direct:true});else openDrawer();}
function switchTab(tab){closeOverlay(true);if(S.tab===tab && S.stacks[tab].length>1){S.stacks[tab]=[tab];}S.tab=tab;show(currentRoute(),'tab');}
function refresh(id=currentRoute()){const old=cache.get(id);if(old){if(old===current)current=null;old.remove();cache.delete(id);}show(id,'instant');}
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,2800);}
function drawerContent(){return `<div class="drawer-top"><strong>WeftMate</strong>${ib('deny','收起侧栏','data-action="close-drawer"')}</div><button class="search-field" style="width:100%" data-go="search">${icon('search')}<span class="muted">搜索对话与内容</span></button><div class="drawer-scroll"><button class="drawer-row" data-sheet="new-chat">${icon('compose')}新建对话</button><h3 class="drawer-section">你的对话</h3><button class="drawer-row active" data-action="main-chat">${icon('chat')}主对话<small>正在查看</small></button><button class="drawer-row" data-go="conversations">${icon('list')}全部对话<small>12</small></button><div class="drawer-recent"><button class="drawer-row" data-conversation="周末的散步计划">周末的散步计划</button><button class="drawer-row" data-conversation="把书房整理一下">把书房整理一下<small>待批准</small></button><button class="drawer-row" data-conversation="读书时记下的想法">读书时记下的想法</button></div><h3 class="drawer-section">长期留下来的</h3><button class="drawer-row" data-go="goals">${icon('goal')}目标与提醒<small>3</small></button><button class="drawer-row" data-go="library">${icon('outputs')}成果库</button><button class="drawer-row" data-go="memory">${icon('bookmark')}记忆</button><h3 class="drawer-section">工作空间</h3><button class="drawer-row" data-go="projects">${icon('folder')}项目<small>示例电脑</small></button></div><div class="drawer-footer"><button class="account" data-go="account"><span class="avatar">林</span><span>示例账号<small>个人空间</small></span></button>${ib('settings','设置','data-go="settings"')}</div>`;}
function setInert(value){$('#stage').inert=value;$('.tabs').inert=value;}
function openDrawer(){closeOverlay(true);restoreFocus=document.activeElement;$('#drawer').innerHTML=drawerContent();S.overlay='drawer';setInert(true);$('#drawer-layer').hidden=false;requestAnimationFrame(()=>{$('#drawer-layer').classList.add('open');$('#drawer').focus({preventScroll:true});});}
function closeOverlay(immediate=false){
  if(!S.overlay)return;
  const layer=$('#'+S.overlay+'-layer');layer.classList.remove('open');
  S.overlay=null;sheetName=null;setInert(false);
  const hide=()=>{if(!layer.classList.contains('open'))layer.hidden=true;};
  if(immediate)hide();else setTimeout(hide,reduceMotion()?1:ms('dur-4'));
  if(restoreFocus?.isConnected && !restoreFocus.closest('[aria-hidden=true]'))restoreFocus.focus({preventScroll:true});
}
function openSheet(name){
  closeOverlay(true);restoreFocus=document.activeElement;sheetName=name;S.overlay='sheet';
  const spec=SHEETS[name]();$('#sheet').innerHTML=`<button class="sheet-grip" aria-label="向下拖动关闭弹层"></button><div class="sheet-heading"><h2 id="sheet-title">${spec[0]}</h2>${ib('deny','关闭弹层','data-action="close-sheet"')}</div><div class="sheet-content">${spec[1]}</div>`;
  $('#sheet-layer').hidden=false;setInert(true);requestAnimationFrame(()=>{$('#sheet-layer').classList.add('open');$('#sheet').focus({preventScroll:true});});
}
function updateFollow(){const page=cache.get('chat');if(page)$('.new-content',page).hidden=S.follow;}
function motionProgress(progress){let low=0,high=1;for(let i=0;i<14;i++){const t=(low+high)/2;const x=3*(1-t)*(1-t)*t*.16+3*(1-t)*t*t*.3+t*t*t;if(x<progress)low=t;else high=t;}const t=(low+high)/2;return 1-Math.pow(1-t,3);}
function follow(){const page=cache.get('chat');if(!page)return;S.follow=true;const content=$('.page-content',page),start=content.scrollTop,target=content.scrollHeight-content.clientHeight,time=performance.now();S.followAnimating=true;function frame(now){if(!S.follow){S.followAnimating=false;return;}const p=reduceMotion()?1:Math.min(1,(now-time)/ms('dur-3'));content.scrollTop=start+(target-start)*motionProgress(p);if(p<1)requestAnimationFrame(frame);else S.followAnimating=false;}requestAnimationFrame(frame);updateFollow();}
function finishStream(stopped=false){
  cancelAnimationFrame(streamHandle);S.streaming=false;
  const page=cache.get('chat');if(!page)return;
  const out=$('.streaming',page);if(out)out.classList.remove('streaming');
  const send=$('[data-action="send"]',page);send.innerHTML=icon('send');send.setAttribute('aria-label','发送消息');
  const process=$('[data-stream-status]',page);if(process)process.textContent=stopped?'已停止 · 保留已收到的文字':'已完成 · 可以接着聊';
  if(out)out.setAttribute('aria-busy','false');
  const turn=out?.closest('.stream-turn');if(turn && !$('.process-detail',turn).hidden)handleAction('process',$('.process',turn));
}
function startStream(text='再帮我把这个上午安排得松一点。'){
  closeOverlay(true);if(S.streaming){S.queue.push(text);toast('已排队，当前回复结束后再发送');return;}
  if(currentRoute()!=='chat'){S.tab='chat';S.stacks.chat=['chat'];show('chat','tab');}
  const page=cache.get('chat'), content=$('.page-content',page);S.streaming=true;S.follow=true;
  $('.chat-error',page)?.remove();
  const turn=document.createElement('div');turn.className='stream-turn';
  turn.innerHTML=`<div class="user-message row-enter">${escapeHTML(text)}</div><button class="process" data-action="process" aria-expanded="true">${icon('allow')}<span data-stream-status>正在整理回答</span>${icon('chevron')}</button><div class="process-detail">理解你的安排 → 整理一个留有余地的上午<br>这是原型演示，不执行电脑任务。</div><div class="answer streaming" aria-label="正在回复" aria-busy="true"></div>`;
  content.append(turn);const output=$('.answer',turn),send=$('[data-action="send"]',page);send.innerHTML=icon('stop');send.setAttribute('aria-label','停止回复');
  const reply='可以，少安排一点，反而更容易出门。\n\n九点半左右出发，不赶最早的那一班。到了公园，先沿湖走一小圈；看到喜欢的位置就坐一会儿。\n\n不用给步数设目标，也不必一定走完整条路线。带水、穿舒服的鞋就够了。\n\n十一点前后找个地方吃点东西，再慢慢回家。剩下的时间，留给当时的心情。\n\n如果临时下雨，就把散步换成在家读几页书。这个上午的重点，是放松下来。';
  const chars=[...new Intl.Segmenter('zh-CN',{granularity:'grapheme'}).segment(reply)].map(x=>x.segment);let index=0,last=performance.now();output.style.whiteSpace='pre-wrap';
  function tick(now){if(!S.streaming)return;const count=Math.min(IOS_MOTION['stream-max-batch'],Math.floor((now-last)/IOS_MOTION['stream-ms-per-grapheme']));if(count>0){const chunk=chars.slice(index,index+count).join('');const span=document.createElement('span');span.className='stream-tail';span.textContent=chunk;output.append(span);index+=count;last=now;if(S.follow && !S.followAnimating)content.scrollTop=content.scrollHeight;}
    if(index>=chars.length){finishStream();turn.insertAdjacentHTML('beforeend',`<div class="answer-actions">${ib('copy','复制回复','data-action="copy"')}${ib('sync','重新生成','data-action="stream"')}<small>刚刚</small></div>`);if(S.queue.length){const next=S.queue.shift();setTimeout(()=>startStream(next),ms('dur-3'));}return;}streamHandle=requestAnimationFrame(tick);}
  streamHandle=requestAnimationFrame(tick);follow();
}
function theme(mode){S.theme=mode || (S.theme==='light'?'dark':'light');document.documentElement.dataset.theme=S.theme;$$('[data-action="theme"]').forEach(b=>{if(b.classList.contains('icon-button'))b.innerHTML=icon(S.theme==='light'?'moon':'sun');});}
function removeRow(el,message){const target=el.closest('.queue-row,.memory-item,.activity-row,.goal-block,.list-row');if(target){target.classList.add('row-exit');setTimeout(()=>target.remove(),reduceMotion()?1:ms('dur-2'));}toast(message);}
document.addEventListener('click',e=>{
  const el=e.target.closest('button,a');if(!el || el.disabled)return;
  if(el.dataset.reminder){S.reminderID=Number(el.dataset.reminder);openSheet('reminder-actions');return;}
  if(el.dataset.memory){S.memoryID=el.dataset.memory;S.memoryKind=({preference:'偏好',fact:'事实',review:'待核对'})[S.memoryID];cache.get('memory-detail')?.remove();cache.delete('memory-detail');go('memory-detail');return;}
  if(el.dataset.source){S.sourceMemory=el.dataset.source;cache.get('history')?.remove();cache.delete('history');go('history');return;}
  if(el.dataset.go==='library-detail' && el.closest('[data-file-type]')){S.fileType=el.closest('[data-file-type]').dataset.fileType;cache.get('library-detail')?.remove();cache.delete('library-detail');}
  if(el.dataset.go==='memory-detail' && el.dataset.kind){S.memoryKind=el.dataset.kind;cache.get('memory-detail')?.remove();cache.delete('memory-detail');}
  if(el.dataset.go){go(el.dataset.go);return;}
  if(el.dataset.tab){switchTab(el.dataset.tab);return;}
  if(el.dataset.sheet){openSheet(el.dataset.sheet);return;}
  if(el.dataset.metric){S.metric=el.dataset.metric;cache.get('health-detail')?.remove();cache.delete('health-detail');go('health-detail');return;}
  if(el.dataset.conversation){S.conversation=el.dataset.conversation;S.tab='chat';S.stacks.chat=['chat'];cache.get('chat')?.remove();cache.delete('chat');current=null;go('chat',{direct:true});return;}
  if(el.dataset.model){S.model=el.dataset.model;$$('.model-button span').forEach(v=>v.textContent=S.model);closeOverlay();toast('已选择 '+S.model);return;}
  if(el.dataset.toggle){const on=el.getAttribute('aria-checked')!=='true';el.setAttribute('aria-checked',String(on));if(el.dataset.toggle==='reduce-motion')document.documentElement.dataset.reduceMotion=String(on);if(el.dataset.toggle==='health-cloud' && on){el.setAttribute('aria-checked','false');openSheet('health-cloud');}return;}
  if(el.dataset.segment){$$('button',el.parentElement).forEach(b=>b.setAttribute('aria-pressed',String(b===el)));applySegment(el.dataset.segment,el.textContent);return;}
  if(el.dataset.fill){go('chat');const input=$('textarea',cache.get('chat'));input.value=el.dataset.fill;input.focus();return;}
  if(el.dataset.feedback){toast(el.dataset.feedback);return;}
  handleAction(el.dataset.action,el);
});
function handleAction(action,el){switch(action){
  case 'theme':theme();break;
  case 'back':back();break;
  case 'drawer':openDrawer();break;
  case 'close-drawer':case 'close-sheet':closeOverlay();break;
  case 'page-options':openSheet(currentRoute()==='memory-detail'?'memory-actions':currentRoute()==='goal-detail'?'goal-actions':currentRoute()==='library-detail'?'file-actions':'page-options');break;
  case 'main-chat':S.conversation='WeftMate';S.tab='chat';S.stacks.chat=['chat'];closeOverlay(true);show('chat','tab');break;
  case 'stream':case 'retry-reply':startStream();break;
  case 'send':{const ta=$('textarea',cache.get('chat'));if(S.streaming && !ta.value.trim()){finishStream(true);break;}if(!ta.value.trim()){toast('先写一句话，或添加一个附件');break;}const value=ta.value;ta.value='';startStream(value);break;}
  case 'process':{const detail=el.nextElementSibling,opening=detail.hidden;el.setAttribute('aria-expanded',String(opening));if(opening)detail.hidden=false;const height=detail.scrollHeight;detail.style.overflow='hidden';detail.getAnimations().forEach(a=>a.cancel());const animation=detail.animate(opening?[{height:'0px',opacity:0},{height:height+'px',opacity:1}]:[{height:height+'px',opacity:1},{height:'0px',opacity:0}],{duration:reduceMotion()?1:ms('dur-2'),easing:'cubic-bezier(.4,0,.2,1)'});animation.onfinish=()=>{if(!opening)detail.hidden=true;detail.style.overflow='';};break;}
  case 'follow':follow();break;
  case 'copy':{const turn=el.closest('.stream-turn')||el.closest('.page-content');const answer=$('.answer',turn);if(answer){const range=document.createRange();range.selectNodeContents(answer);getSelection().removeAllRanges();getSelection().addRange(range);toast('已选中这条回答正文，可使用浏览器复制');}}break;
  case 'retry-page':S.state='normal';$('#state').value='normal';refresh();toast('已重新读取示例内容');break;
  case 'mark-read':$$('.unread',current).forEach(n=>n.classList.remove('unread'));el.textContent='已全部读过';$('.badge').hidden=true;toast('动态已标为已读');break;
  case 'approve':case 'reject':closeOverlay();$('.badge').hidden=true;toast(action==='approve'?'已允许这一次，示例任务继续':'已拒绝，示例任务停止');break;
  case 'answer-question':{const choices=$$('input:checked',$('#sheet')).map(n=>n.value);if(!choices.length){toast('先选择一个答案');break;}closeOverlay();toast('已提交：'+choices.join('、'));break;}
  case 'add-attachment':{closeOverlay();const p=cache.get('chat')||mount('chat');const chip=$('.attachment-chip',p);chip.hidden=false;chip.innerHTML=icon('file')+'散步路线.txt'+ib('deny','移除附件','data-action="remove-attachment"');toast('已添加示例文件');break;}
  case 'remove-attachment':el.closest('.attachment-chip').hidden=true;break;
  case 'voice-done':closeOverlay();switchTab('chat');$('textarea',cache.get('chat')).value='明天早上提醒我带水出门。';toast('语音已转成草稿，确认后发送');break;
  case 'queue-add':S.queue.push('再给我一个雨天的备选。');openSheet('queue');break;
  case 'queue-remove':S.queue.splice(Number(el.dataset.index),1);removeRow(el,'已撤回排队消息');break;
  case 'queue-edit':{const index=Number(el.dataset.index);closeOverlay();$('textarea',cache.get('chat')).value=S.queue.splice(index,1)[0];toast('已放回输入框修改');break;}
  case 'temporary':S.temporary=true;closeOverlay();refresh('chat');toast('已开临时对话');break;
  case 'new-chat':S.conversation='新对话';S.mode='chat';S.temporary=false;closeOverlay(true);S.tab='chat';S.stacks.chat=['chat'];refresh('chat');$('.page-content',current).innerHTML=`<div class="empty">${icon('chat')}<h2>今天想聊什么？</h2><p>接着一个想法，或者从一件小事开始。</p></div>`;break;
  case 'start-work':closeOverlay(true);S.mode='work';S.conversation='整理周末计划';S.tab='chat';S.stacks.chat=['chat'];refresh('chat');toast('已绑定示例电脑与项目');break;
  case 'set-expiry':S.temporary=true;closeOverlay();toast('自动删除：'+el.textContent.trim());break;
  case 'rename':{const val=$('input',$('#sheet')).value.trim();if(!val){toast('写一个对话名称');break;}S.conversation=val;closeOverlay();if(cache.has('chat'))$('.nav-title',cache.get('chat')).childNodes[0].textContent=val;toast('已重命名');break;}
  case 'archive':closeOverlay();toast('已归档 · 可在设置中恢复');break;
  case 'restore':removeRow(el,'已恢复到对话列表');break;
  case 'confirm-delete':closeOverlay();toast('示例对话已删除');go('conversations');break;
  case 'forget':{S.forgottenIDs.add(S.memoryID);S.forgotten=S.forgottenIDs.has('preference');closeOverlay(true);for(const id of ['memory','memory-detail','search','history','resources']){cache.get(id)?.remove();cache.delete(id);}$$(`[data-memory-source="${S.memoryID}"]`).forEach(n=>{n.replaceWith(Object.assign(document.createElement('p'),{className:'note',textContent:'这条来源已随记忆清理。'}));});current=null;go('memory');toast('已忘掉示例记忆及所列来源');break;}
  case 'correct-memory':closeOverlay();toast('已提交示例纠正，等待电脑处理');break;
  case 'mute-memory':if(S.mutedIDs.has(S.memoryID))S.mutedIDs.delete(S.memoryID);else S.mutedIDs.add(S.memoryID);closeOverlay(true);refresh('memory-detail');toast(S.mutedIDs.has(S.memoryID)?'已停用这条示例记忆':'已重新启用这条示例记忆');break;
  case 'pause-goal':S.goalPaused=!S.goalPaused;closeOverlay();refresh('goal-detail');break;
  case 'complete-goal':case 'archive-goal':S.goalState=action==='complete-goal'?'complete':'archived';closeOverlay(true);go('goals');refresh('goals');toast(action==='complete-goal'?'目标已标为完成':'目标已移出列表，来源对话保留');break;
  case 'reminder-new':S.reminderID=null;openSheet('reminder');break;
  case 'reminder-save':{const input=$('input[aria-label="提醒内容"]',$('#sheet'));if(!input.value.trim()){toast('写下要提醒的事');break;}const value={id:S.reminderID??Date.now(),text:input.value,date:$('input[type=datetime-local]',$('#sheet')).value,complete:false};const index=S.reminders.findIndex(r=>r.id===S.reminderID);if(index<0)S.reminders.unshift(value);else S.reminders[index]=value;closeOverlay(true);go('reminders');refresh('reminders');$('.reminder-list .list-row',current)?.classList.add('row-enter');toast(index<0?'已添加示例提醒':'已修改示例提醒');break;}
  case 'reminder-delete':case 'reminder-complete':{const item=S.reminders.find(r=>r.id===S.reminderID);if(action==='reminder-delete')S.reminders=S.reminders.filter(r=>r.id!==S.reminderID);else if(item)item.complete=true;closeOverlay(true);go('reminders');refresh('reminders');toast(action==='reminder-delete'?'示例提醒已删除':'示例提醒已完成');break;}
  case 'login-code':{const email=$('input[type=email]',current);if(email && !email.validity.valid){email.reportValidity();break;}if(email && !email.value){toast('先填写邮箱');break;}S.authPurpose=currentRoute();go('verify');break;}
  case 'verify':{const input=$('input',current);if(!/^\d{6}$/.test(input.value)){toast('请输入 6 位数字，示例可填任意六位数');break;}go(S.authPurpose==='recovery'?'change-password':'pairing');break;}
  case 'pair-scan':go('pair-confirm');break;
  case 'pair-confirm':go('devices');toast('示例电脑已配对');break;
  case 'pair-manual':{const inputs=$$('input',$('#sheet'));if(inputs.some(i=>!i.value.trim())){toast('填入示例地址和配对码');break;}closeOverlay(true);go('pair-confirm');break;}
  case 'health-authorize':closeOverlay();S.healthDeleted=false;S.state='normal';$('#state').value='normal';go('health');refresh('health');toast('这里演示选择后的布局；真机由系统请求读取权限');break;
  case 'health-cloud-confirm':S.healthCloud=true;closeOverlay();$$('[data-toggle="health-cloud"]').forEach(n=>n.setAttribute('aria-checked','true'));toast('已允许每日摘要用于云模型；设备指标仍不进云');break;
  case 'health-delete':S.healthDeleted=true;closeOverlay(true);cache.get('health-settings')?.remove();cache.delete('health-settings');go('health');refresh('health');toast('本机摘要已清理；远端删除等待确认');break;
  case 'delete-service':S.serviceDeleted=true;closeOverlay(true);go('models');refresh('models');toast('示例服务已移除');break;
  case 'delete-schedule':S.scheduleDeleted=true;closeOverlay(true);go('schedules');refresh('schedules');toast('示例定时任务已移除');break;
  case 'save-form':{const id=currentRoute();if(id==='change-password'){const values=$$('input',current).map(n=>n.value);if(values[1].length<8 || values[1]!==values[2]){toast('新密码至少 8 位，并且两次输入一致');break;}if(S.authPurpose==='recovery'){go('login');S.authPurpose='login';toast('示例密码已重设，可以重新登录');break;}}if(id==='change-email'){const email=$('input[type=email]',current);if(!email.value || !email.reportValidity() || !/^\d{6}$/.test($$('input',current)[1].value)){toast('请填写有效邮箱与 6 位验证码');break;}}toast('已保存到本次原型预览');break;}
  case 'forget-account':closeOverlay();go('login');toast('示例账号已退出');break;
  case 'logout':openSheet('logout');break;
  case 'large-type':$('#phone').classList.toggle('enlarge');toast('已切换大字号预览');break;
  case 'state-offline':S.state='offline';$('#state').value='offline';go('chat');refresh('chat');break;
  case 'date-jump':closeOverlay(true);go('history');break;
  case 'chart-point':{const series=metricSeries();const point=series[Math.floor(series.length*.65)];$('#chart-selection',current).textContent=`${point.date} · ${formatMetric(point.value)} · 示例测量`;break;}
  case 'show-error':{const box=$('.form-feedback',current);box.innerHTML='<p class="inline-error">这次没连上服务。检查地址和密钥后重试。</p>'+button('重试','data-action="retry-service"','outline');break;}
  case 'retry-service':$('.form-feedback',current).innerHTML='<p class="note success">示例连接成功，已读到 2 个模型。</p>';break;
  case 'remove-device':closeOverlay();toast('已移除示例设备授权');break;
  case 'resend-code':{el.disabled=true;const deadline=Date.now()+60000;el.textContent='60 秒后可重发';const timer=setInterval(()=>{if(!el.isConnected){clearInterval(timer);return;}const remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));el.textContent=remaining?remaining+' 秒后可重发':'重新发送验证码';if(!remaining){clearInterval(timer);el.disabled=false;}},1000);toast('验证码发送成功的示例状态');break;}
  case 'schedule-pause':el.textContent=el.textContent==='暂停'?'恢复':'暂停';toast(el.textContent==='恢复'?'定时任务已暂停':'定时任务已恢复');break;
  case 'offline-work':closeOverlay();toast('已加密暂存示例任务，电脑上线后处理');break;
  case 'download':{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['合成示例：周末散步计划\n09:30 出发\n11:00 自由返程'],{type:'text/plain;charset=utf-8'}));a.download='周末计划-示例.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('已下载合成示例文件');break;}
  default:if(action)throw new Error('Unhandled action: '+action);
}}
function applySegment(kind,text){
  if(kind==='外观'){theme(text==='深色'?'dark':text==='浅色'?'light':matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');return;}
  if(kind==='动态范围'){$$('.activity-row',current).forEach((r,i)=>r.hidden=(text==='待处理'&&i!==0)||(text==='未读'&&i>1));return;}
  if(kind==='成果类型'){$$('[data-file-type]',current).forEach(r=>r.hidden=text!=='全部' && r.dataset.fileType!==text);return;}
  if(kind==='记忆类别'){$$('.memory-item',current).forEach(r=>r.hidden=text!=='全部' && r.dataset.kind!==text);return;}
  if(kind==='对话模式'){$$('[data-chat-kind]',current).forEach(r=>r.hidden=text!=='全部'&&r.dataset.chatKind!==text);return;}
  if(kind==='趋势范围'){S.metricDays=parseInt(text);$('#chart-range',current).textContent=text+'内的每日测量';const chart=$('.chart-container',current);if(chart){chart.innerHTML=metricChart();$('#chart-selection',current).textContent='点图表查看某一天';}return;}
  if(kind==='登录方式'){$('.password-login',current).hidden=text==='验证码';return;}
  toast('已选择：'+text);
}
document.addEventListener('input',e=>{
  if(e.target.matches('[data-search]')){const q=e.target.value.trim();const scope=e.target.dataset.search;const rows=$$(scope==='settings'?'.list-row':scope==='memory'?'.memory-item':scope==='library'?'[data-file-type]':'.search-result',current);rows.forEach(r=>r.hidden=!r.textContent.includes(q));const empty=$('.search-empty',current);if(empty)empty.hidden=rows.some(r=>!r.hidden);}
  if(e.target.matches('.composer textarea')){e.target.style.height='44px';e.target.style.height=Math.min(132,e.target.scrollHeight)+'px';const send=$('[data-action=send]',current);send.setAttribute('aria-label',S.streaming && e.target.value.trim()?'排队发送':S.streaming?'停止回复':'发送消息');send.innerHTML=icon(S.streaming && !e.target.value.trim()?'stop':'send');}
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();S.overlay?closeOverlay():back();}
  if(e.key==='Enter' && (e.ctrlKey||e.metaKey) && e.target.matches('.composer textarea')){e.preventDefault();handleAction('send');}
  if(e.key==='Tab' && S.overlay){const panel=$('#'+S.overlay),focusable=$$('button:not(:disabled),input,textarea,select,a',panel).filter(n=>!n.hidden&&n.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}}
});
// A gesture follows the finger. Only the leading edge owns navigation gestures.
let drag=null;
document.addEventListener('pointerdown',e=>{
  if(!e.target.closest('#phone') || e.button!==0)return;
  const phone=$('#phone').getBoundingClientRect(),x=e.clientX-phone.left;
  let kind=null;if(e.target.closest('.sheet-grip'))kind='sheet';else if(S.overlay==='drawer')kind='drawer';else if(!S.overlay && x<IOS_MOTION['edge-width'])kind=S.stacks[S.tab].length>1?'back':'open';
  if(kind)drag={kind,x:e.clientX,y:e.clientY,dx:0,dy:0,target:e.target,active:false};
});
document.addEventListener('pointermove',e=>{
  if(!drag)return;drag.dx=e.clientX-drag.x;drag.dy=e.clientY-drag.y;
  if(!drag.active && Math.max(Math.abs(drag.dx),Math.abs(drag.dy))>8){if(drag.kind!=='sheet' && Math.abs(drag.dy)>Math.abs(drag.dx)){drag=null;return;}drag.active=true;drag.target.setPointerCapture?.(e.pointerId);if(drag.kind==='open')openDrawer();}
  if(!drag.active)return;
  const n=drag.kind==='sheet'?$('#sheet'):drag.kind==='back'?current:$('#drawer');n.classList.add('dragging');
  if(drag.kind==='sheet')n.style.transform=`translateY(${Math.max(0,drag.dy)}px)`;
  else if(drag.kind==='back')n.style.transform=`translateX(${Math.max(0,drag.dx)}px)`;
  else if(drag.kind==='open')n.style.transform=`translateX(${Math.min(0,drag.dx-328)}px)`;
  else n.style.transform=`translateX(${Math.min(0,drag.dx)}px)`;
  e.preventDefault();
},{passive:false});
function endDrag(cancel=false){if(!drag)return;const d=drag;drag=null;if(!d.active)return;const n=d.kind==='sheet'?$('#sheet'):d.kind==='back'?current:$('#drawer');n.classList.remove('dragging');n.style.transform='';if(cancel){if(d.kind==='open')closeOverlay();return;}const distance=IOS_MOTION['gesture-commit'];if(d.kind==='sheet'&&d.dy>distance || d.kind==='drawer'&&d.dx< -distance || d.kind==='open'&&d.dx<distance)closeOverlay();if(d.kind==='back'&&d.dx>distance)back();}
document.addEventListener('pointerup',()=>endDrag());document.addEventListener('pointercancel',()=>endDrag(true));
document.addEventListener('DOMContentLoaded',()=>{
  $('#scene').innerHTML=Object.entries(CATALOG).map(([key,name])=>`<option value="${key}">${name}</option>`).join('');
  $('#scene').addEventListener('change',e=>go(e.target.value,{direct:true}));
  $('#state').addEventListener('change',e=>{finishStream(true);S.state=e.target.value;const id=currentRoute();cache.forEach(n=>n.remove());cache.clear();current=null;show(id,'instant');});
  hydrate();const params=new URLSearchParams(location.search);if(params.get('theme')==='dark')theme('dark');
  if(params.get('state')){S.state=params.get('state');$('#state').value=S.state;}
  go(params.get('page') in CATALOG?params.get('page'):'chat',{direct:true});
  if(params.get('sheet') in SHEETS)openSheet(params.get('sheet'));
  if(params.get('drawer')==='1')openDrawer();
  // Public fixture index for repeatable capture; all navigation remains available through UI.
  window.prototypeFixtures={pages:Object.keys(CATALOG),sheets:Object.keys(SHEETS)};
});
