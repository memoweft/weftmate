/* Reusable accessible settings controls; feature actions remain with their callers. */
(() => {
    function segmented(select) {
        const group = document.createElement('div'); group.className = 'settings-segmented';
        group.setAttribute('role', 'group'); group.setAttribute('aria-label', select.getAttribute('aria-label') || select.closest('label')?.childNodes[0]?.textContent.trim() || '颜色模式');
        select.classList.add('settings-control-source'); select.tabIndex = -1;
        const update = () => { for (const button of group.children) button.setAttribute('aria-pressed', String(button.dataset.value === select.value)); };
        for (const value of ['light', 'dark', 'system']) {
            const option = [...select.options].find(item => item.value === value); if (!option) continue;
            const button = document.createElement('button'); button.type = 'button'; button.textContent = option.textContent; button.dataset.value = value;
            button.addEventListener('click', () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); update(); });
            group.append(button);
        }
        select.after(group); select.addEventListener('change', update); update(); return group;
    }
    function toggle(input) { input.classList.add('settings-switch'); input.setAttribute('role', 'switch'); }
    function row(label, description, control) {
        const line = document.createElement('div'); line.className = 'settings-row';
        const copy = document.createElement('div'), title = document.createElement('label'), help = document.createElement('p');
        title.textContent = label; if (control.id) title.htmlFor = control.id;
        help.textContent = description; help.className = 'muted'; copy.append(title, help); line.append(copy, control); return line;
    }
    const select = source => globalThis.WeftPopover?.bindSettingsSelect(source);
    globalThis.WeftSettingsControls = { segmented, toggle, row, select };
})();
