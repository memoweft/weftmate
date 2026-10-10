/** Presentation helper shared by the desktop and mobile scroll surfaces. */
globalThis.WeftConversationScroll = (box, content, button, onPinned = () => {}) => {
    let pinned = true, pending = false, followingTop = null, newContent = false;
    let togglePinned = false;
    let scrollbarDrag=false,lastTop=box.scrollTop;
    let moving = null, frame = null;
    const stop = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; moving = null; };
    const reduced = () => globalThis.WeftReplyMotion?.reduced ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
    const gap = () => box.scrollHeight - box.clientHeight - box.scrollTop;
    const paint = () => {
        button.hidden = pinned;
        button.textContent = newContent ? '有新内容 · 回到底部' : '回到底部';
        button.setAttribute('aria-label', '回到底部');
        onPinned(pinned);
    };
    const follow = (smooth = false) => {
        if (pinned) {
            followingTop = Math.max(0, box.scrollHeight - box.clientHeight);
            if (!smooth || reduced() || (globalThis.WeftReplyMotion?.paused ?? document.hidden)) { stop(); if (Math.abs(box.scrollTop-followingTop)>1) box.scrollTop = followingTop; }
            else if (Math.abs(box.scrollTop-followingTop)>1) {
                if (!moving) { const css=getComputedStyle(document.documentElement); const curve=css.getPropertyValue('--wm-easing-desktop').match(/[\d.]+/g)?.map(Number); moving={from:box.scrollTop, started:performance.now(), duration:globalThis.WeftReplyMotion?.milliseconds('replyScroll') || 160, curve}; }
                if (frame === null) {
                    const tick = time => {
                        frame = null; if (!pinned || !moving) return;
                        const fraction = Math.min(1, (time-moving.started)/moving.duration);
                        const bezier=(t,a,b)=>3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t;
                        let eased=fraction; if(moving.curve?.length===4){let low=0,high=1;for(let index=0;index<12;index++){const mid=(low+high)/2;if(bezier(mid,moving.curve[0],moving.curve[2])<fraction)low=mid;else high=mid;}eased=bezier((low+high)/2,moving.curve[1],moving.curve[3]);}
                        box.scrollTop = moving.from + (followingTop-moving.from)*eased;
                        if (fraction < 1) frame=requestAnimationFrame(tick); else stop();
                    };
                    frame=requestAnimationFrame(tick);
                }
            }
            newContent = false;
        }
        paint();
    };
    const changed = () => {
        if (!pinned) newContent = true;
        if (pending) return;
        pending = true; requestAnimationFrame(() => { pending = false; follow(true); });
    };
    const scrolled = () => {
        const top = box.scrollTop;
        if(scrollbarDrag&&top<lastTop-1&&gap()>48){stop();pinned=false;followingTop=null;}
        if (followingTop !== null && Math.abs(top - followingTop) <= 1) { if (!moving) followingTop = null; }
        else if (gap() <= 48) { pinned = true; newContent = false; }
        // Layout clamping (keyboard, composer/approval resize, virtual rows) can
        // reduce scrollTop without user intent. Only input handlers unpin.
        lastTop=top;paint();
    };
    box.addEventListener('pointerdown',event=>{const gutter=box.offsetWidth-box.clientWidth;scrollbarDrag=event.pointerType!=='touch'&&gutter>0&&event.clientX>=box.getBoundingClientRect().right-gutter;lastTop=box.scrollTop;});
    const endScrollbarDrag=()=>{scrollbarDrag=false;};
    globalThis.addEventListener?.('pointerup',endScrollbarDrag);
    globalThis.addEventListener?.('pointercancel',endScrollbarDrag);
    box.addEventListener('scroll', scrolled, {passive:true});
    box.addEventListener('wheel', event => {
        if (event.deltaY < 0 && gap() - event.deltaY > 48) { stop(); pinned = false; followingTop = null; paint(); }
    }, {passive:true});
    let touchY = null;
    box.addEventListener('touchstart', event => {touchY=event.touches[0]?.clientY;}, {passive:true});
    box.addEventListener('touchmove', event => {const y=event.touches[0]?.clientY;if(touchY!==null && y>touchY && gap()+y-touchY>48){stop();pinned=false;followingTop=null;paint();}touchY=y;}, {passive:true});
    box.addEventListener('keydown', event => {if(['ArrowUp','PageUp','Home'].includes(event.key) && !event.target.closest?.('input,textarea,[contenteditable=true]')){stop();pinned=false;followingTop=null;paint();}});
    globalThis.addEventListener?.('weft-reply-motion-change', () => {if((globalThis.WeftReplyMotion?.paused ?? document.hidden) || reduced()) {stop();if(pinned)follow();}});
    const latest = () => { pinned = true; newContent = false; follow(); };
    button.addEventListener('click', latest);
    if (globalThis.MutationObserver) new MutationObserver(changed).observe(content, {subtree:true, childList:true, characterData:true});
    if (globalThis.ResizeObserver) {
        const resize = new ResizeObserver(changed); resize.observe(content); resize.observe(box);
    }
    globalThis.visualViewport?.addEventListener('resize', changed);
    globalThis.addEventListener?.('resize', changed);
    content.addEventListener('load', changed, true);
    const beforeToggle = event => { if (event.target.closest?.('summary')) togglePinned=pinned; };
    content.addEventListener('pointerdown', beforeToggle, true);
    content.addEventListener('keydown', event=>{if(['Enter',' '].includes(event.key))beforeToggle(event)}, true);
    content.addEventListener('toggle', () => { if(togglePinned) {togglePinned=false;latest();} else changed(); }, true);
    paint();
    return {latest, changed, follow, scrolled, hold() {stop();pinned=false; followingTop=null; paint();}, get pinned() {return pinned;}};
};
