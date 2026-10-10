/* Shared visual feedback. Content and accessible live regions update immediately. */
(() => {
  const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const root = document.documentElement, active = new Set(), owners = new WeakMap(), states = new WeakMap();
  let preference = 'system', nativeReduced = globalThis.weftReducedMotion === true, nativeHidden = false;
  const paused = () => document.hidden || nativeHidden;
  try { preference = localStorage.getItem('weftmate.reply-motion.v1') || 'system'; } catch {}
  const reduced = () => preference === 'reduce' || preference === 'system' && (media?.matches || nativeReduced);
  // Motion tokens are shared constants. Read once before updates, avoiding a style
  // flush between replacing the newest paragraph and measuring the finished frame.
  const tokenStyle=getComputedStyle(root), durations=new Map();
  for(const name of ['replyFragment','replyChange','replyScroll','working']) {const value=tokenStyle.getPropertyValue(`--wm-duration-${name}`).trim();durations.set(name,parseFloat(value)*(value.endsWith('ms')?1:1000));}
  const easing=tokenStyle.getPropertyValue('--wm-easing-desktop').trim();
  const milliseconds = name => durations.get(name);
  function play(element, frames, name, cleanup) {
    owners.get(element)?.cancel();
    if (reduced() || paused() || !element?.isConnected || !element.animate) { cleanup?.(); return; }
    const animation = element.animate(frames, { duration: milliseconds(name), easing });
    active.add(animation); owners.set(element, animation);
    const done = () => { active.delete(animation); if (owners.get(element) === animation) owners.delete(element); cleanup?.(); };
    animation.finished.then(done, done); return animation;
  }
  function reveal(element, kind = 'fragment') {
    if (!element) return;
    return play(element, [{opacity:.72, transform:kind === 'send' ? 'translateY(var(--wm-space-8))' : kind === 'arrival' ? 'translateY(var(--wm-space-2))' : 'none'}, {opacity:1, transform:'none'}], kind === 'fragment' ? 'replyFragment' : 'replyChange');
  }
  const visible = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) entry.target.classList.toggle('reply-offscreen', !entry.isIntersecting);
  }) : null;
  function status(element, text, running = false, transition = true) {
    if (!element) return;
    const saved = states.get(element), changed = saved && saved.text !== text;
    // Keep only the most recent transition. Never queue or defer visible text.
    if (changed) { owners.get(element)?.cancel(); element.querySelector('.reply-status-out')?.remove(); }
    if (!saved || saved.text !== text || element.firstChild?.nodeType !== 3 || element.firstChild.data !== text) element.textContent = text;
    states.set(element, {text}); element.classList.add('reply-status'); element.classList.toggle('reply-working', running);
    let sheen = element.querySelector('.reply-sheen');
    if (running && !sheen) { sheen = document.createElement('span'); sheen.className = 'reply-sheen'; sheen.setAttribute('aria-hidden','true'); element.append(sheen); }
    if (sheen) { if (sheen._replyText !== text) { sheen._replyText=text;sheen.replaceChildren(...Array.from({length:5},(_,index)=>{const part=document.createElement('span');part.className='reply-sheen-part';part.textContent=text;part.style.setProperty('--reply-phase',`${index*25}%`);part.style.setProperty('--reply-offset',String(index/5));return part;})); } if (!running) sheen.remove(); }
    visible?.observe(element);
    if (changed && transition && !reduced() && !paused()) {
      const copy = document.createElement('span'); copy.className = 'reply-status-out'; copy.textContent = saved.text; copy.setAttribute('aria-hidden','true');
      element.append(copy);
      play(copy, [{opacity:.55,transform:'none'},{opacity:0,transform:'translateY(calc(-1 * var(--wm-space-2)))'}], 'replyChange', () => copy.remove());
      play(element, [{opacity:.72,transform:'translateY(var(--wm-space-2))'},{opacity:1,transform:'none'}], 'replyChange');
    }
  }
  // Animate only appended text, retaining markup, syntax colors and native selection.
  // Wrappers have no font, spacing or display changes, so height measurements stay stable.
  function fragment(element, previousText = '') {
    if (!element || reduced() || paused()) return;
    const text = element.textContent;
    if (previousText && !text.startsWith(previousText)) { reveal(element); return; }
    let offset = previousText.length;
    if (element.tagName === 'CODE' && offset) offset = text.lastIndexOf('\n', offset - 1) + 1;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), leaves = [];
    while (walker.nextNode()) leaves.push(walker.currentNode);
    for (const leaf of leaves) {
      if (offset >= leaf.length) { offset -= leaf.length; continue; }
      const tail = offset ? leaf.splitText(offset) : leaf; offset = 0;
      if (!tail.data) continue;
      const span = document.createElement('span'); span.className = 'reply-fragment'; tail.replaceWith(span); span.append(tail);
      play(span, [{opacity:.72},{opacity:1}], 'replyFragment', () => { if (span.parentNode) span.replaceWith(...span.childNodes); });
    }
  }
  function indicator(content, running) {
    if (!content) return;
    let dot = content.querySelector(':scope > .reply-indicator');
    if (!running || reduced()) {
      if (dot) { dot.remove(); if (!reduced() && !paused()) { const copy = dot.cloneNode(); copy.classList.add('reply-indicator-exit'); content.append(copy); play(copy,[{opacity:.6},{opacity:0}], 'replyFragment',()=>copy.remove()); } }
      content.classList.remove('reply-streaming'); return;
    }
    content.classList.add('reply-streaming');
    if (!dot) { dot = document.createElement('span'); dot.className = 'reply-indicator'; dot.setAttribute('aria-hidden','true'); content.append(dot); visible?.observe(dot); }
    requestAnimationFrame(() => { if (!dot.isConnected) return; const tail = node => { if(node.nodeType===3)return node.data.trim()?node:null;if(node.matches?.('.reply-indicator,.render-code-head,.render-code-fold,.render-table-actions,.render-status,.reply-sheen'))return null;for(let index=node.childNodes.length-1;index>=0;index--){const found=tail(node.childNodes[index]);if(found)return found;}return null; }; const last=tail(content); if(!last)return; const range=document.createRange();range.setStart(last,last.length);range.collapse(true);const end=range.getBoundingClientRect(),box=content.getBoundingClientRect();const left=`${end.left-box.left}px`,top=`${end.bottom-box.top-4}px`;if(dot.style.left!==left)dot.style.left=left;if(dot.style.top!==top)dot.style.top=top; });
  }
  function sync() {
    root.toggleAttribute('data-reduced-motion', !!reduced()); root.toggleAttribute('data-motion-full', preference === 'full'); root.toggleAttribute('data-motion-paused', paused());
    if (reduced()) { for (const animation of [...active]) animation.cancel(); document.querySelectorAll('.reply-indicator').forEach(dot => dot.remove()); }
    if (!reduced()) { for (const animation of active) { if (paused()) animation.pause(); else animation.play(); } for(const content of document.querySelectorAll('.reply-streaming')) indicator(content,true); }
    globalThis.dispatchEvent(new CustomEvent('weft-reply-motion-change'));
  }
  function setVisibility(hidden) { nativeHidden=hidden === true;sync(); }
  function setPreference(value) {
    preference = ['system','reduce','full'].includes(value) ? value : 'system';
    try { localStorage.setItem('weftmate.reply-motion.v1', preference); } catch {}
    sync();
  }
  function preferenceControl() {
    const select=document.createElement('select'); select.className='reply-motion-select'; select.setAttribute('aria-label','减少动态效果');
    for(const [value,label] of [['system','跟随系统'],['reduce','开启']]) {const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
    select.value=preference;select.addEventListener('change',()=>setPreference(select.value));return select;
  }
  globalThis.WeftReplyMotion = {status,reveal,fragment,indicator,setPreference,setVisibility,preferenceControl,milliseconds,get preference(){return preference},get paused(){return !!paused()},get reduced(){return !!reduced()}};
  media?.addEventListener('change', sync); document.addEventListener('visibilitychange', sync);
  globalThis.addEventListener('weft-motion-preference', event => {nativeReduced=event.detail?.reducedMotion === true;sync();}); sync();
  // Existing application status surfaces share feedback without changing aria-live.
  const selector = '.inline-progress-text, [role="status"], [role="alert"], .message-state, .shared-turn-state, .render-status, p.muted';
  const inspect = element => {
    if (!element?.matches?.(selector) || element.closest('.reply-status-out,.reply-sheen') || element.closest('.message-text,.markdown-body,.markdown') && !element.matches('.render-status')) return;
    const text = [...element.childNodes].filter(n => !n.classList?.contains('reply-status-out') && !n.classList?.contains('reply-sheen')).map(n => n.textContent).join('');
    if (!text || element.children.length && !element.classList.contains('reply-status')) return;
    const running = !element.matches('[role="alert"],.form-error') && (element.classList.contains('is-running') || /^(正在|图表正在)|正在重试/.test(text));
    if (running || states.has(element)) status(element,text,running);
    else if (element.matches('[role="alert"],.message-state') && states.get(element)?.text !== text) { states.set(element,{text}); reveal(element); }
  };
  if (typeof MutationObserver === 'function') new MutationObserver(records => {
    const pending = new Set();
    for (const record of records) {
      if (record.target.parentElement?.closest('.reply-status-out,.reply-sheen,.reply-fragment')) continue;
      const target = record.target.nodeType === 3 ? record.target.parentElement : record.target;
      if (target?.matches?.(selector)) pending.add(target);
      for (const node of record.removedNodes) if (node.nodeType === 1 && !node.isConnected && visible) {
        if(node.matches('.reply-status,.reply-indicator')) visible.unobserve(node);
        for(const target of node.querySelectorAll('.reply-status,.reply-indicator')) visible.unobserve(target);
      }
      for (const node of record.addedNodes) if (node.nodeType === 1 && !node.matches('.reply-status-out,.reply-sheen,.reply-indicator,.reply-fragment')) {
        if (node.matches(selector)) pending.add(node);
        for (const status of node.querySelectorAll(selector)) pending.add(status);
      }
    }
    for (const element of pending) inspect(element);
  }).observe(document.body || root, {subtree:true,childList:true,characterData:true});
})();
