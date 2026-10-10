/* Shared suggestion presentation for Electron, the phone web client and Android's UI package. */
(() => {
    function mount(core, { field, area, card = field?.parentElement, repaint = () => {}, mobile = false } = {}) {
        if (!field || !area || !card) return null;
        const node = (tag, cls, text = '') => { const element = document.createElement(tag); element.className = cls; element.textContent = text; return element; };
        const slot = node('div', 'composer-above-slot'); slot.id = 'composer-above-slot';
        card.before(slot);
        const bar = node('div', 'next-suggestions'); bar.id = 'next-suggestions'; bar.hidden = true;
        bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '下一步建议');
        const label = node('span', 'next-suggestions-label', '建议'), scroller = node('div', 'next-suggestions-scroll');
        const dismiss = node('button', 'next-suggestions-dismiss'); dismiss.type = 'button'; dismiss.title = '收起本次建议'; dismiss.setAttribute('aria-label', '收起本次建议');
        dismiss.append(globalThis.WeftIcons.create('deny', 16)); bar.append(label, scroller, dismiss); slot.append(bar);
        const ghost = node('div', 'composer-completion'); ghost.hidden = true; ghost.setAttribute('aria-hidden', 'true');
        const prefix = node('span', 'composer-completion-prefix'), suffix = node('span', 'composer-completion-text');
        const hint = node('kbd', 'composer-completion-hint', 'Tab'); ghost.append(prefix, suffix, hint); card.append(ghost);
        const announcement = node('span', 'sr-only'); announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite'); area.append(announcement);
        const groups = {
            approval: '#approval-bar', question: '#question-bar',
            connection: '.presence-bar,#connection-status,#connection-banner,#connection-bar,.connection-status-bar,.composer-connection-status,.composer-connection',
            subtasks: '#composer-subtasks'
        };
        let signature = '', announced = '', painting = false, lastGesture = null;
        const visible = element => !element.hidden && !!element.textContent.trim();
        function priority() {
            const value = {};
            for (const [key, selector] of Object.entries(groups)) {
                const rows = [...area.querySelectorAll(selector)].sort((a, b) => Number(b.classList.contains('presence-bar')) - Number(a.classList.contains('presence-bar')));
                let active = false;
                for (const row of rows) { const show = visible(row); row.dataset.composerSuppressed = String(active && show); if (show) active = true; }
                for (const row of rows) { row.dataset.composerAbove = key; if (row.parentElement !== slot) slot.insertBefore(row, bar); }
                value[key] = rows.some(visible);
            }
            value.noModel = field.disabled || !!area.querySelector('.needs-model-hint:not([hidden]),.model-gate:not([hidden]),.model-gate-hint:not([hidden])');
            value.suggestions = !field.value.trim() && core.nextSuggestionsView().suggestions.length > 0;
            const selected = globalThis.WeftUiCore.composerAbovePriority(value);
            slot.dataset.priority = selected; area.dataset.composerAbovePriority = selected;
            return selected;
        }
        function fill(text) {
            core.cancelNextSuggestions(); field.value = text; field.focus({ preventScroll: true }); field.setSelectionRange(text.length, text.length);
            field.dispatchEvent(new Event('input', { bubbles: true })); repaint();
        }
        function acceptCompletion() {
            const value = core.nextSuggestionsView();
            if (ghost.hidden || !value.completion || field.value !== value.draft) return false;
            fill(value.draft + value.completion); return true;
        }
        function positionGhost() {
            if (ghost.hidden) return;
            const style = getComputedStyle(field), box = field.getBoundingClientRect();
            Object.assign(ghost.style, { left: `${field.offsetLeft}px`, top: `${field.offsetTop}px`,
                width: `${box.width}px`, height: `${box.height}px`, padding: style.padding, fontFamily: style.fontFamily, fontSize: style.fontSize,
                fontWeight: style.fontWeight, fontStyle: style.fontStyle, letterSpacing: style.letterSpacing,
                lineHeight: style.lineHeight, textAlign: style.textAlign, borderWidth: style.borderWidth });
            ghost.style.setProperty('--completion-scroll', `${-field.scrollTop}px`);
        }
        function paint() {
            if (painting) return; painting = true;
            try {
                const value = core.nextSuggestionsView(), selected = priority();
                const replies = value.enabled && selected === 'suggestions' && !core.conversationRunning?.(core.state.selectedSessionId);
                if (bar.hidden !== !replies) bar.hidden = !replies;
                bar.inert = !replies;
                const next = JSON.stringify(value.suggestions);
                if (signature !== next) {
                    signature = next; scroller.replaceChildren();
                    value.suggestions.forEach((text, index) => {
                        const chip = node('button', 'next-suggestion-chip', text); chip.type = 'button'; chip.title = text; chip.dataset.suggestionIndex = String(index);
                        chip.setAttribute('aria-label', `${text}，填入输入框`); chip.addEventListener('click', () => fill(text)); scroller.append(chip);
                    });
                }
                scroller.classList.toggle('has-overflow', scroller.scrollWidth > scroller.clientWidth + 1);
                const showCompletion = value.enabled && !['approval', 'question', 'connection'].includes(selected) && !field.disabled &&
                    !!value.completion && field.value === value.draft && field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
                if (ghost.hidden !== !showCompletion) ghost.hidden = !showCompletion;
                if (prefix.textContent !== value.draft) prefix.textContent = value.draft;
                if (suffix.textContent !== value.completion) suffix.textContent = value.completion;
                const hideHint = mobile || matchMedia('(pointer: coarse)').matches;
                if (hint.hidden !== hideHint) hint.hidden = hideHint;
                if (showCompletion && announced !== value.completion) {
                    announced = value.completion; announcement.textContent = `建议：${value.completion}，${hint.hidden ? '点灰字或右滑接受' : '按 Tab 接受'}`;
                } else if (!showCompletion && announcement.textContent) announcement.textContent = '';
                positionGhost();
            } finally { painting = false; }
        }
        function sync() { core.syncNextSuggestions(); paint(); }
        function move(event, fromField = false) {
            if (bar.hidden || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.key) || event.key === 'Tab' && event.shiftKey) return false;
            const chips = [...scroller.querySelectorAll('button')]; if (!chips.length) return false;
            event.preventDefault(); event.stopImmediatePropagation();
            const current = chips.indexOf(document.activeElement), direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
            const index = fromField ? direction < 0 ? chips.length - 1 : 0 : (current + direction + chips.length) % chips.length;
            chips[index].focus({ preventScroll: true }); chips[index].scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true;
        }
        field.addEventListener('input', () => { core.nextSuggestionsInput(field.value); paint(); });
        field.addEventListener('compositionstart', () => core.setSuggestionsComposing(true));
        field.addEventListener('compositionend', () => core.setSuggestionsComposing(false));
        field.addEventListener('keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'Tab' && !event.shiftKey && acceptCompletion()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
            if (event.key === 'Escape' && (!bar.hidden || !ghost.hidden)) { event.preventDefault(); event.stopImmediatePropagation(); core.dismissNextSuggestions(); paint(); return; }
            if (!field.value && move(event, true)) return;
            if (event.key === 'Enter' && !event.shiftKey) core.cancelNextSuggestions();
        }, true);
        bar.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); core.dismissNextSuggestions(); field.focus(); paint(); }
            else move(event);
        });
        dismiss.addEventListener('click', () => { core.dismissNextSuggestions(); field.focus({ preventScroll: true }); paint(); });
        suffix.addEventListener('click', acceptCompletion);
        field.addEventListener('pointerdown', event => { lastGesture = { x: event.clientX, y: event.clientY }; });
        field.addEventListener('pointerup', event => {
            if (lastGesture && event.pointerType === 'touch' && event.clientX - lastGesture.x > 48 && Math.abs(event.clientY - lastGesture.y) < 24) acceptCompletion();
            lastGesture = null;
        });
        field.addEventListener('scroll', positionGhost); field.addEventListener('click', paint); field.addEventListener('keyup', paint);
        // Capture before each action starts. Switching away must abort before awaiting history or model reads.
        for (const name of ['sendDraft', 'sendMainDraft', 'sendPhoneMessage', 'selectSession', 'selectLogicalSession', 'selectMainChat', 'openSideChat', 'startNewConversation', 'startChatConversation', 'clearSession', 'acceptSession']) {
            if (typeof core[name] !== 'function') continue;
            const action = core[name]; core[name] = function (...args) { core.cancelNextSuggestions(); return action.apply(this, args); };
        }
        if (core.mobile) for (const name of ['send', 'sendShared', 'sendLinked']) {
            const action = core.mobile[name]; if (typeof action === 'function') core.mobile[name] = function (...args) { core.cancelNextSuggestions(); return action.apply(this, args); };
        }
        const observer = new MutationObserver(changes => {
            if (changes.some(change => !bar.contains(change.target) && !ghost.contains(change.target) && change.target !== announcement)) sync();
        }); observer.observe(area, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'disabled'], characterData: true });
        const resize = globalThis.ResizeObserver ? new ResizeObserver(positionGhost) : null; resize?.observe(field);
        window.addEventListener('resize', positionGhost);
        document.addEventListener('weft:personalization', sync);
        // Generation completion paints without modifying history or drafting accepted text.
        const previousPaint = core._nextSuggestionsPaint;
        core._nextSuggestionsPaint = () => { previousPaint?.(); paint(); };
        sync();
        return { sync, paint, fill, acceptCompletion, priority, destroy() { observer.disconnect(); resize?.disconnect(); core.cancelNextSuggestions(); } };
    }
    globalThis.WeftNextSuggestionsView = { mount };
})();
