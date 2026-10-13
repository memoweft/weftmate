/* Phone presentation only. The remote-phone breakpoint and all shared actions stay unchanged. */
(() => {
    const isPhone = () => !globalThis.weftmateDesktop && globalThis.matchMedia?.('(max-width:600px) and (pointer:coarse)').matches === true;
    function placeDecision(ui, bar) {
        if (!isPhone() || !bar) return;
        const scroll = ui.byId('chat-scroll');
        let flow = scroll.querySelector('.phone-decision-flow');
        if (!flow) {
            flow = ui.element('div', 'phone-decision-flow');
            ui.byId('transcript').after(flow);
        }
        if (bar.parentElement !== flow) flow.append(bar);
        bar.classList.add('phone-decision-card');
    }
    function mount(core, ui) {
        if (!isPhone()) return;
        document.body.classList.add('phone-unified');
        const form = ui.byId('message-form'), field = ui.byId('message-text');
        const send = ui.byId('send-message'), voice = ui.byId('voice-input');
        const area = form.parentElement, scroll = ui.byId('chat-scroll');
        let restHeight = globalThis.visualViewport?.height || innerHeight;
        let keyboardWasOpen = false;
        const syncBadges = () => {
            for (const [id,count,dot] of [['activity',core.activity?.unreadCount || 0,false],['chat',core.state.mainChat?.unread ? 1 : 0,true]]) {
                const tab = ui.byId(`remote-tab-${id}`); if (!tab) continue;
                let badge = tab.querySelector('.remote-tab-badge');
                if (!count) { badge?.remove(); tab.removeAttribute('aria-description'); continue; }
                if (!badge) { badge = ui.element('span','remote-tab-badge'); badge.setAttribute('aria-hidden','true'); tab.append(badge); }
                badge.classList.toggle('is-dot',dot); badge.textContent = dot ? '' : count > 99 ? '99+' : String(count);
                tab.setAttribute('aria-description',dot ? '有未读消息' : `${count} 条未读`);
            }
        };
        const syncComposer = () => {
            const drafts = core.currentAttachmentDrafts();
            const viewportHeight = globalThis.visualViewport?.height || innerHeight;
            const editing = document.activeElement === field;
            if (!editing) restHeight = Math.max(restHeight, viewportHeight);
            const keyboardOpen = editing && viewportHeight < restHeight - 100;
            // Mobile keyboards can close while the textarea keeps focus.
            if (keyboardWasOpen && !keyboardOpen && !field.value.trim() && !drafts.length) field.blur();
            keyboardWasOpen = keyboardOpen;
            const expanded = form.contains(document.activeElement) || !!field.value.trim() || drafts.length > 0 || !!ui.voiceInput;
            form.classList.toggle('phone-composer-expanded', expanded);
            form.classList.toggle('phone-composer-attachments', drafts.length > 0);
            const value = core.composerState(field.value);
            const hasContent = !!field.value.trim() || drafts.length > 0;
            const hasVoice = !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
            const action = value.running ? 'stop' : !hasContent && hasVoice ? 'voice' : 'send';
            const label = action === 'stop' ? '停止回复' : action === 'voice' ? ui.voiceInput ? '停止语音输入' : '语音输入' : '发送';
            send.type = action === 'voice' ? 'button' : 'submit';
            send.dataset.action = action;
            send.classList.toggle('is-stop', action === 'stop');
            send.classList.toggle('is-recording', action === 'voice' && !!ui.voiceInput);
            send.disabled = action === 'stop' ? value.cancelDisabled : action === 'voice' ? value.voiceDisabled : value.sendDisabled;
            send.setAttribute('aria-label', label); send.title = label;
            send.replaceChildren(WeftIcons.create(action === 'voice' ? 'mic' : action, 20));
            // The empty composer has one microphone, in the main action position.
            voice.hidden = !hasContent || value.running || !hasVoice;
            if (expanded) WeftPopover.autosize(field);
            else { field.style.height = ''; field.style.overflowY = ''; }
            ui.conversationScroll?.changed();
            syncBadges();
        };
        ui.syncPhoneComposer = syncComposer;
        const update = ui.updateAvailability;
        ui.updateAvailability = (...args) => { const result = update(...args); syncComposer(); return result; };
        field.addEventListener('focus', syncComposer);
        field.addEventListener('blur', () => requestAnimationFrame(syncComposer));
        form.addEventListener('focusin', () => requestAnimationFrame(syncComposer));
        form.addEventListener('focusout', () => requestAnimationFrame(syncComposer));
        send.addEventListener('click', event => {
            if (send.dataset.action !== 'voice') return;
            event.preventDefault(); ui.startVoiceInput(); syncComposer();
        });
        const clear = ui.clearMessageDraft;
        ui.clearMessageDraft = (...args) => { const result = clear(...args); syncComposer(); return result; };
        const jump = ui.element('button', 'phone-pending-entry button secondary small', '有一项等你决定');
        jump.id = 'phone-pending-decision'; jump.type = 'button'; jump.hidden = true;
        area.prepend(jump);
        const pending = () => [...scroll.querySelectorAll('[data-phone-pending="true"]')].filter(card => !card.hidden);
        const syncDecisions = () => {
            const bounds = scroll.getBoundingClientRect();
            const outside = pending().filter(card => { const rect = card.getBoundingClientRect(); return rect.bottom <= bounds.top || rect.top >= bounds.bottom; });
            jump.hidden = outside.length === 0;
            jump.textContent = outside.length > 1 ? `有 ${outside.length} 项等你决定` : '有一项等你决定';
            jump.phoneTarget = outside[0];
            if(pending().some(card=>{const rect=card.getBoundingClientRect();return rect.bottom>bounds.top&&rect.top<bounds.bottom;}))ui.byId('jump-latest').hidden=true;
        };
        ui.syncPhoneDecisions = syncDecisions;
        jump.addEventListener('click', () => {
            const target = jump.phoneTarget; if (!target?.isConnected) return;
            ui.conversationScroll?.hold();
            const bounds = scroll.getBoundingClientRect(), rect = target.getBoundingClientRect();
            scroll.scrollTo({top:scroll.scrollTop + rect.top - bounds.top - 16, behavior:'instant'});
            syncDecisions();
            target.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
        });
        scroll.addEventListener('scroll', syncDecisions, {passive:true});
        new MutationObserver(() => requestAnimationFrame(syncDecisions)).observe(scroll, {subtree:true, childList:true, attributes:true, attributeFilter:['hidden','data-phone-pending']});
        if (globalThis.ResizeObserver) new ResizeObserver(() => {
            // Keep the floating latest control away from card actions at the end.
            const latest = ui.byId('jump-latest');
            latest.style.bottom = `${area.offsetHeight + 12}px`;
            requestAnimationFrame(syncDecisions);
        }).observe(area);
        globalThis.visualViewport?.addEventListener('resize', () => { syncComposer(); syncDecisions(); });
        for (const name of ['renderActivity','renderActivityBadge','mountMobileRefresh']) {
            const original = ui[name]; if (typeof original === 'function') ui[name] = (...args) => { const result = original(...args); syncBadges(); return result; };
        }
        placeDecision(ui, ui.byId('approval-bar')); placeDecision(ui, ui.byId('question-bar'));
        syncComposer(); syncDecisions();
    }
    globalThis.WeftPhoneUnify = {isPhone, mount, placeDecision};
})();
