/* Reusable accessible settings controls; feature actions remain with their callers. */
(() => {
    const { segmented, toggle, row, select } = globalThis.WeftControls;
    function groupRows(target, title) {
        // Reuse existing rows without rebuilding controls or their event handlers.
        const rows = [...target.children].filter(child => child.classList.contains('settings-row'));
        if (!rows.length) return;
        let section, card, previous;
        for (const row of rows) {
            if (row.previousElementSibling !== previous) {
                section = document.createElement('section'); section.className = 'settings-group';
                const heading = document.createElement('h2'); heading.className = 'settings-group-title'; heading.textContent = title;
                card = document.createElement('div'); card.className = 'settings-group-card'; section.append(heading, card); row.before(section);
            }
            const next = row.nextElementSibling; card.append(row); previous = section;
            if (!next?.classList.contains('settings-row')) previous = null;
        }
    }
    globalThis.WeftSettingsControls = { segmented, toggle, row, select, groupRows };
})();
