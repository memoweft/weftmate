/* Reusable accessible settings controls; feature actions remain with their callers. */
(() => {
    const { segmented, toggle, row, select } = globalThis.WeftControls;
    const disclosures = new WeakSet();
    const disclosureAnimations = new Set();
    const reduced = () => globalThis.WeftReplyMotion?.reduced ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const settleDisclosures = () => { if(reduced())for(const animation of disclosureAnimations)animation.finish(); };
    addEventListener('weft-reply-motion-change',settleDisclosures);
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',settleDisclosures);
    function timing(token = '--dur-4') {
        const css = getComputedStyle(document.documentElement), value = css.getPropertyValue(token).trim();
        return { duration: parseFloat(value) * (value.endsWith('ms') ? 1 : 1000), easing: css.getPropertyValue('--ease-out').trim() };
    }
    // expand: animate the real disclosure height while keeping its controls mounted.
    function details(element) {
        if (globalThis.WeftMotion?.visibility) { globalThis.WeftMotion.details(element); return; }
        if (disclosures.has(element)) return;
        const summary = element.querySelector(':scope > summary');
        if (!summary) return;
        disclosures.add(element);
        let animation, expanded = element.open;
        summary.addEventListener('click', event => {
            if (event.defaultPrevented || event.target.closest('a,button,input,select')) return;
            event.preventDefault();
            const from = element.getBoundingClientRect().height;
            animation?.cancel(); expanded = !expanded;
            element.open = expanded;
            const to = element.getBoundingClientRect().height;
            summary.setAttribute('aria-expanded', String(expanded));
            if (reduced() || !element.animate || from === to) return;
            element.open = true;
            animation = element.animate([{height:from+'px',overflow:'clip'},{height:to+'px',overflow:'clip'}], timing('--dur-5'));
            const running = animation;
            disclosureAnimations.add(running);
            running.finished.then(() => { disclosureAnimations.delete(running);if (animation === running) { element.open = expanded; animation = null; } }, () => {disclosureAnimations.delete(running);});
        });
        element.addEventListener('toggle', () => { if (!animation) { expanded = element.open; summary.setAttribute('aria-expanded',String(expanded)); } });
    }
    function groupRows(target, title = '') {
        // Move live controls, never clone them. Existing subsection headings become
        // group titles; an unlabelled run inherits the page heading without repeating it.
        let card, heading;
        for (const child of [...target.children]) {
            if (child.matches('h2,h3') && !child.classList.contains('settings-group-title')) {
                heading = child; card = null; continue;
            }
            if (!child.classList.contains('settings-row')) { card = null; heading = null; continue; }
            if (!card) {
                const label = heading?.textContent.trim() || '';
                const section = globalThis.WeftControls.group(label === title ? '' : label);
                (heading || child).before(section);
                heading?.remove(); heading = null;
                card = section.querySelector('.settings-group-card');
            }
            card.append(child);
        }
    }
    globalThis.WeftSettingsControls = { segmented, toggle, row, select, groupRows, details, timing, reduced };
})();
