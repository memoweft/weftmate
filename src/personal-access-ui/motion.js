/* Shared desktop motion. Presentation never postpones a feature action or request. */
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set(), owners = new WeakMap(), settlers = new WeakMap(), boundDetails = new WeakSet(), boundDialogs = new WeakSet();
  const pageRects = new WeakMap(), pageVisibility = new WeakMap(), transitionKeys = new WeakMap();
  const listLimit = 20;
  const reduced = () => globalThis.WeftReplyMotion?.reduced ?? preference.matches;
  const paused = () => globalThis.WeftReplyMotion?.paused ?? document.hidden;
  function timing(name = 'base', index = 0) {
    const css = getComputedStyle(document.documentElement);
    const ms = key => { const value = css.getPropertyValue(key).trim(); return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000); };
    return { fill:'both', duration:ms(name.startsWith('dur-') ? `--${name}` : `--wm-duration-${name}`) || ms('--dur-3'),
      easing:css.getPropertyValue('--ease-out').trim() || css.getPropertyValue('--wm-easing-desktop').trim(),
      delay:Math.min(index * ms('--wm-duration-stagger'), ms('--wm-duration-staggerLimit')) };
  }
  function cancel(element) { const animation=owners.get(element);if(animation){settlers.get(animation)?.(true);animation.cancel();} }
  function play(element, frames, name = 'base', index = 0, cleanup) {
    cancel(element);
    if (reduced() || paused() || !element?.isConnected || !element.animate) { cleanup?.(false); return; }
    const animation = element.animate(frames, timing(name, index));
    owners.set(element, animation); active.add(animation);
    let settled = false;
    const done = cancelled => { if (settled) return; settled=true; active.delete(animation);
      if (owners.get(element) === animation) owners.delete(element); cleanup?.(cancelled); };
    settlers.set(animation,done);
    animation.finished.then(() => { done(false); animation.cancel(); }, () => done(true));
    return animation;
  }
  function reveal(element, name = 'base', index = 0) { return play(element,[{opacity:.65},{opacity:1}],name,index); }
  function enter(element, pattern = 'view-enter') {
    if (!element) return;
    element.dataset.motion = pattern;
    if (reduced() || paused()) return;
    // Imperative enter keeps its old replay contract. Automatic page detection
    // only calls this on a real visibility edge, never on a polling repaint.
    for(const animation of element.getAnimations())if(animation.animationName?.startsWith('m-')&&animation.playState==='finished'){
      animation.currentTime=0;animation.play();
    }
  }
  function snapshot(element, rect = element?.getBoundingClientRect(), includeHidden = false) {
    if (reduced() || paused() || !element?.isConnected || element.hidden && !includeHidden || !rect?.width || !rect.height) return;
    const copy = element.cloneNode(true);
    copy.removeAttribute('id'); copy.removeAttribute('popover'); copy.removeAttribute('hidden'); copy.removeAttribute('data-motion');
    for (const node of copy.querySelectorAll('[id]')) node.removeAttribute('id');
    for (const node of copy.querySelectorAll('[data-motion]')) node.removeAttribute('data-motion');
    copy.inert=true;copy.setAttribute('aria-hidden','true');copy.classList.add('motion-copy');
    Object.assign(copy.style,{position:'fixed',inset:'auto',top:`${rect.top}px`,left:`${rect.left}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',animation:'none'});
    document.body.append(copy);
    const source=[element,...element.querySelectorAll('*')], target=[copy,...copy.querySelectorAll('*')];
    source.forEach((node,i)=>{if(node.scrollTop)target[i].scrollTop=node.scrollTop;if(node.scrollLeft)target[i].scrollLeft=node.scrollLeft;
      if(node.matches('input,textarea,select'))target[i].value=node.value;if(node.matches('input'))target[i].checked=node.checked;});
    return copy;
  }
  function dismiss(copy, crop = false) { if(!copy)return;return play(copy,[{opacity:1,transform:'translateY(0)',clipPath:'inset(0)'},{opacity:0,transform:'translateY(-4px)',clipPath:crop?'inset(0 0 100% 0)':'inset(0)'}],'dur-4',0,()=>copy.remove()); }
  function remove(element) {const copy=snapshot(element);element?.remove();return dismiss(copy);}
  function hide(element) {const copy=snapshot(element);if(element)element.hidden=true;return dismiss(copy);}
  function transition(target, update, {key} = {}) {
    const same=key!==undefined&&transitionKeys.get(target)===key;
    const copy=same?null:snapshot(target);const result=update();
    if(key!==undefined)transitionKeys.set(target,key);
    if(!same){dismiss(copy);enter(target);}
    return result;
  }
  let viewTransition;
  const handoffs=new WeakMap();
  function resetIdentity() {
    viewTransition?.transition.skipTransition();viewTransition?.restore();
    for(const target of document.querySelectorAll('[data-motion-pending]')) {
      handoffs.delete(target);delete target.dataset.motionPending;
    }
    for(const copy of document.querySelectorAll('.motion-copy')) {cancel(copy);copy.remove();}
  }
  function handoff(target, operation) {
    const previous=handoffs.get(target);if(previous?.copy)previous.copy.remove();
    const state={copy:snapshot(target)};handoffs.set(target,state);target.dataset.motionPending='true';
    const finish=()=>{if(handoffs.get(target)!==state)return;handoffs.delete(target);delete target.dataset.motionPending;dismiss(state.copy);};
    // Invoke immediately; the promise only owns the outgoing presentation.
    try { return Promise.resolve(operation()).finally(finish); }catch(error){finish();throw error;}
  }
  function swap(target, render, {key} = {}) {
    const same=key!==undefined&&transitionKeys.get(target)===key;
    if(same||reduced()||document.hidden||!document.startViewTransition)return Promise.resolve(transition(target,render,{key}));
    viewTransition?.transition.skipTransition();viewTransition?.restore();
    const previous=target.style.viewTransitionName;target.style.viewTransitionName='weft-surface';
    let result;
    const current=document.startViewTransition(()=>{result=render();if(key!==undefined)transitionKeys.set(target,key);});
    let restored=false;
    const state={transition:current,restore:()=>{if(restored)return;restored=true;target.style.viewTransitionName=previous;if(viewTransition===state)viewTransition=null;}};
    viewTransition=state;
    current.ready.catch(()=>{});
    current.finished.then(state.restore,state.restore);
    return current.updateCallbackDone.then(()=>result);
  }
  const folds=new WeakMap();
  function resize(element, opening, setOpen, name='dur-5') {
    const height=element.hidden?0:element.getBoundingClientRect().height;
    cancel(element);
    const previous={height:element.style.height,overflow:element.style.overflow};
    setOpen(true);element.style.height='auto';
    const full=element.getBoundingClientRect().height;
    const summary=element.tagName==='DETAILS'?element.querySelector(':scope > summary'):null;
    const end=opening?full:summary?summary.getBoundingClientRect().height+parseFloat(getComputedStyle(element).paddingTop)+parseFloat(getComputedStyle(element).paddingBottom):0;
    if(reduced()||paused()){setOpen(opening);folds.delete(element);return;}
    element.style.overflow='clip';element.style.height=`${height}px`;
    folds.set(element,opening);
    return play(element,[{height:`${height}px`},{height:`${end}px`}],name,0,cancelled=>{
      element.style.height=previous.height;element.style.overflow=previous.overflow;
      if(!cancelled){setOpen(opening);folds.delete(element);}
    });
  }
  function visibility(element, visible, {duration='dur-5'} = {}) {
    if(!element || (folds.get(element)??!element.hidden)===visible)return;
    return resize(element,visible,open=>{element.hidden=!open;},duration);
  }
  function details(element) {
    if(!element||boundDetails.has(element))return;const summary=element.querySelector(':scope > summary');if(!summary)return;
    boundDetails.add(element);element.classList.add('motion-details');
    summary.addEventListener('click',event=>{
      if(event.defaultPrevented||event.target.closest('a,button,input,select,textarea'))return;
      event.preventDefault();
      const opening=!(folds.get(element)??element.open);
      summary.setAttribute('aria-expanded',String(opening));
      resize(element,opening,open=>{element.open=open;},element.matches('.execution-block,.execution-step,.execution-step-group')?'dur-1':'dur-5');
    });
    element.addEventListener('toggle',()=>{if(!folds.has(element))summary.setAttribute('aria-expanded',String(element.open));});
  }
  function changed(element,key,name='base') {if(!element||element.dataset.motionKey===key)return;element.dataset.motionKey=key;return reveal(element,name);}
  function menu(element,opening=true) {
    if(!element)return;
    if(!opening){element.inert=true;return play(element,[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(3px) scale(.985)'}],'dur-3',0);}
    element.inert=false;return play(element,[{opacity:.35,transform:'translateY(4px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],'dur-3',0);
  }
  function dialog(element) {
    if(!element||boundDialogs.has(element))return;boundDialogs.add(element);
    const nativeClose=element.close.bind(element);
    element.close=value=>{
      if(!element.open)return;
      const captured=snapshot(element);
      if(captured){
        // A closed <dialog> has browser-owned painting rules. A plain visual
        // surface keeps the complete captured frame while native close fires.
        const copy=document.createElement('div');
        for(const attribute of captured.attributes)if(attribute.name!=='open')copy.setAttribute(attribute.name,attribute.value);
        copy.append(...captured.childNodes);captured.replaceWith(copy);
        copy.inert=true;copy.style.display='block';copy.classList.add('motion-dialog-copy');
        const backdrop=document.createElement('div'),style=getComputedStyle(element,'::backdrop');
        backdrop.className='motion-dialog-backdrop';backdrop.inert=true;backdrop.setAttribute('aria-hidden','true');
        Object.assign(backdrop.style,{background:style.backgroundColor,backdropFilter:style.backdropFilter});copy.before(backdrop);
        play(backdrop,[{opacity:1},{opacity:0}],'dur-4',0,()=>backdrop.remove());
        play(copy,[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(8px) scale(.985)'}],'dur-4',0,()=>copy.remove());
      }
      // Native close and its decision/focus callbacks keep their original timing.
      // Only an inert visual survives; an animation never gates a request.
      nativeClose(value??'');
    };
    element.addEventListener('cancel',event=>{event.preventDefault();element.close();});
  }
  const pages='.activity-surface,.library-surface,.goals-surface,.health-surface,#conversation-pane';
  function rememberPage(page) {if(!page.hidden){const r=page.getBoundingClientRect();if(r.width&&r.height)pageRects.set(page,r);}pageVisibility.set(page,!page.hidden);}
  const resizeObserver=new ResizeObserver(entries=>{for(const {target} of entries)if(!target.hidden)rememberPage(target);});
  function mount(root) {
    for(const detail of [root,...root.querySelectorAll('details')])if(detail.matches('details'))details(detail);
    for(const page of [root,...root.querySelectorAll(pages)])if(page.matches(pages)&&!pageVisibility.has(page)){rememberPage(page);resizeObserver.observe(page);enter(page);}
  }
  function pushBack() {document.body.classList.toggle('motion-modal-open',!!document.querySelector('dialog[open]'));}
  new MutationObserver(records=>{
    const changedPages=new Set();
    for(const record of records){
      if(record.type==='childList')for(const node of record.addedNodes)if(node.nodeType===1&&!node.closest('.motion-copy'))mount(node);
      if(record.type==='attributes'&&record.target.matches(pages))changedPages.add(record.target);
    }
    for(const page of changedPages){const visible=!page.hidden,wasVisible=pageVisibility.get(page);
      if(visible!==wasVisible){if(!visible){const copy=snapshot(page,pageRects.get(page),true);if(copy){copy.classList.add('motion-page-copy');dismiss(copy);}}
        else enter(page);rememberPage(page);}
    }
    pushBack();
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open']});
  mount(document.body);pushBack();
  preference.addEventListener('change',()=>{if(reduced())for(const animation of [...active])animation.finish();});
  addEventListener('weft-reply-motion-change',()=>{for(const a of [...active]){if(reduced())a.finish();else if(paused())a.pause();else a.play();}});
  globalThis.WeftMotion={reveal,enter,snapshot,dismiss,remove,hide,details,changed,cancel,listLimit,transition,swap,handoff,visibility,menu,dialog,resetIdentity,timing,get reduced(){return reduced();}};
})();
