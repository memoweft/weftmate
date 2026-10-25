/* Reusable accessible settings controls; feature actions remain with their callers. */
(() => {
    const { segmented, toggle, row, select } = globalThis.WeftControls;
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
    globalThis.WeftSettingsControls = { segmented, toggle, row, select, groupRows };
})();
