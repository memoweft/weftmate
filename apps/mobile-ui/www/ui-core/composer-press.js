/* Keep a composer gesture intact until the browser has dispatched its click. */
globalThis.WeftComposerPress = {
    paintHeld(input, core, draft) {
        let strip=this.heldStrips?.get(input);
        if (!draft) {if (strip) {strip.remove();this.heldStrips.delete(input);} return;}
        if (!input.parentElement) return;
        if (!strip) {
            strip=document.createElement('div');strip.dataset.heldDraft='';strip.className='attachment-status';
            const note=document.createElement('span');note.setAttribute('role','status');
            const take=document.createElement('button');take.type='button';take.className='button quiet small';take.textContent='取回草稿';
            take.onclick=()=>core.reclaimDraft(strip.dataset.heldDraft);
            strip.append(note,take);input.before(strip);
            (this.heldStrips ||= new WeakMap()).set(input,strip);
        }
        strip.dataset.heldDraft=draft.requestId;
        const summary=[draft.text,...draft.files].filter(Boolean).join(' · ');
        const label=(draft.waiting?'等发送：':'未发送，草稿已保留：')+summary.slice(0,64);
        if (strip.firstChild.textContent!==label) strip.firstChild.textContent=label;
        strip.lastChild.disabled=!!input.value || !!core.currentAttachmentDrafts().length || !!core.state.attachmentUpload || !!core.state.sideCreating || !!core.state.sessionSelecting;
        strip.lastChild.title=strip.lastChild.disabled?'当前草稿腾空后可以取回':'取回到当前输入框，不会自动发送';
    },
    mount(button, repaint) {
        let pointer = null, releaseTimer;
        const release = () => {
            clearTimeout(releaseTimer);
            if (pointer === null) return;
            pointer = null;
            repaint();
        };
        button.addEventListener('pointerdown', event => {
            if (button.disabled || pointer !== null) return;
            pointer = event.pointerId;
            // Retain textarea focus and its keyboard throughout a touch/mouse tap.
            // Keyboard activation keeps normal focus and submit behavior.
            event.preventDefault();
        });
        document.addEventListener('pointerup', event => {
            if (event.pointerId === pointer && !button.contains(event.target)) release();
        }, true);
        // The default submit runs after click listeners. Repainting on pointerup
        // (or in a microtask inside click) can still remove its activation target.
        button.addEventListener('click', () => { if (pointer !== null) releaseTimer = setTimeout(release, 0); });
        button.addEventListener('contextmenu', release);
        document.addEventListener('pointercancel', event => {
            if (event.pointerId === pointer) release();
        }, true);
        globalThis.addEventListener?.('blur', release);
        return { get active() { return pointer !== null; } };
    },
};
