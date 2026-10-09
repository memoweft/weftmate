/** Presentation helper shared by the desktop and mobile scroll surfaces. */
globalThis.WeftConversationScroll = (box, content, button, onPinned = () => {}) => {
    let pinned = true, pending = false, lastTop = box.scrollTop, followingTop = null, newContent = false;
    let togglePinned = false;
    const gap = () => box.scrollHeight - box.clientHeight - box.scrollTop;
    const paint = () => {
        button.hidden = pinned;
        button.textContent = newContent ? '有新内容 · 回到底部' : '回到底部';
        button.setAttribute('aria-label', '回到底部');
        onPinned(pinned);
    };
    const follow = () => {
        if (pinned) {
            followingTop = Math.max(0, box.scrollHeight - box.clientHeight);
            if (Math.abs(box.scrollTop-followingTop)>1) box.scrollTop = followingTop;
            lastTop = box.scrollTop; newContent = false;
        }
        paint();
    };
    const changed = () => {
        if (!pinned) newContent = true;
        if (pending) return;
        pending = true; requestAnimationFrame(() => { pending = false; follow(); });
    };
    const scrolled = () => {
        const top = box.scrollTop;
        if (followingTop !== null && Math.abs(top - followingTop) <= 1) followingTop = null;
        else if (top < lastTop - 1 && gap() > 48) { pinned = false; followingTop = null; }
        else if (gap() <= 48) { pinned = true; newContent = false; }
        lastTop = top; paint();
    };
    box.addEventListener('scroll', scrolled, {passive:true});
    box.addEventListener('wheel', event => {
        if (event.deltaY < 0 && gap() - event.deltaY > 48) { pinned = false; followingTop = null; paint(); }
    }, {passive:true});
    const latest = () => { pinned = true; newContent = false; follow(); };
    button.addEventListener('click', latest);
    if (globalThis.MutationObserver) new MutationObserver(changed).observe(content, {subtree:true, childList:true, characterData:true});
    if (globalThis.ResizeObserver) {
        const resize = new ResizeObserver(changed); resize.observe(content); resize.observe(box);
    }
    content.addEventListener('load', changed, true);
    const beforeToggle = event => { if (event.target.closest?.('summary')) togglePinned=pinned; };
    content.addEventListener('pointerdown', beforeToggle, true);
    content.addEventListener('keydown', event=>{if(['Enter',' '].includes(event.key))beforeToggle(event)}, true);
    content.addEventListener('toggle', () => { if(togglePinned) {togglePinned=false;latest();} else changed(); }, true);
    paint();
    return {latest, changed, follow, scrolled, hold() {pinned=false; followingTop=null; paint();}, get pinned() {return pinned;}};
};
