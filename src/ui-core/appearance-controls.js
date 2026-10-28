/* Shared appearance presentation. Callers own device persistence and theme selection. */
(() => {
    const colors = [['neutral', '石墨'], ['blue', '蓝色'], ['green', '松绿'], ['purple', '紫色']];
    const mounted = new Set();
    const node = (tag, cls = '', text = '') => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; };
    function apply(value, theme) {
        const root = document.documentElement;
        root.style.setProperty('--text-size', `var(--wm-font-size-${value.fontSize}, ${value.fontSize}px)`);
        root.dataset.accent = theme === 'dark' ? value.accentDark : value.accentLight;
        root.style.setProperty('--code-size', `var(--wm-font-size-${value.codeFontSize}, ${value.codeFontSize}px)`);
        root.toggleAttribute('data-pointer-cursor',value.pointerCursor===true);
        root.dataset.diffMarkers=value.diffMarkers;
    }
    function mount(target, options) {
        target.classList.add('appearance-page');
        const controls = new Map();
        let motion, reset, motionHelp;
        const sync = () => {
            const value = options.get();
            for (const [key, control] of controls) { control.value = value[key]; control.dispatchEvent(new Event('weft:sync')); }
            for (const button of modes.children) button.setAttribute('aria-pressed', String(button.dataset.value === value.theme));
            if (options.onlyTheme) return;
            motion.checked = !!globalThis.WeftReplyMotion?.reduced;
            reset.disabled = globalThis.WeftReplyMotion?.preference === 'system';
            motionHelp.textContent = reset.disabled ? '跟随系统；手动切换后以你的选择为准。' : '使用你的选择；可恢复跟随系统。';
        };
        async function save(patch) {
            try { await options.set(patch); sync(); }
            catch { sync(); options.toast?.('外观暂时无法保存，请重试。', true); }
        }
        const modes = node('div', 'settings-segmented appearance-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '颜色模式');
        for (const [value, label] of [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']]) {
            const button = node('button', '', label); button.type = 'button'; button.dataset.value = value;
            const preview = node('span', 'appearance-thumbnail'); preview.dataset.mode = value; preview.setAttribute('aria-hidden', 'true');
            preview.innerHTML = '<span class="appearance-mini-rail"><i></i><i></i><i></i></span><span class="appearance-mini-chat"><i></i><i></i><i></i><span></span></span>';
            button.prepend(preview); button.append(globalThis.WeftIcons.create('allow', 16));
            button.addEventListener('click', () => { void save({theme:value}); }); modes.append(button);
        }
        modes.addEventListener('keydown', event => {
            const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']; if (!keys.includes(event.key)) return;
            event.preventDefault(); const buttons = [...modes.children], index = buttons.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
            buttons[next].focus(); buttons[next].click();
        });
        const modeRow = WeftSettingsControls.row('颜色模式', '选择适合当前环境的颜色模式。', modes); modeRow.classList.add('appearance-mode-row'); target.append(modeRow);
        if (options.onlyTheme) { sync(); mounted.add({target,sync,connected:target.isConnected}); return; }
        motion = node('input'); motion.type = 'checkbox'; motion.id = 'appearance-reduced-motion'; motion.setAttribute('aria-label', '减少动态效果'); WeftSettingsControls.toggle(motion);
        const motionTarget = node('label', 'appearance-switch-target'); motionTarget.htmlFor = motion.id; motionTarget.append(motion);
        const motionRow = WeftSettingsControls.row('减少动态效果', '减少动画效果，或跟随系统设置。', motionTarget); motionHelp = motionRow.querySelector('p'); motionRow.querySelector('label').htmlFor = motion.id;
        motionRow.classList.add('appearance-motion-row');
        function saveMotion(value) {try{globalThis.WeftReplyMotion.setPreference(value);}catch{options.toast?.('动态效果偏好未保存，请重试。');}sync();}
        motion.addEventListener('change', () => saveMotion(motion.checked ? 'reduce' : 'full'));
        reset = node('button', 'button quiet appearance-motion-reset', '恢复跟随系统'); reset.type = 'button';
        reset.addEventListener('click', () => saveMotion('system')); motionRow.firstChild.append(reset); target.append(motionRow);
        function select(key, label, help, values) {
            const control = node('select'); control.id = 'appearance-' + key; control.setAttribute('aria-label', label);
            for (const [value, text] of values) { const option = node('option', '', text); option.value = value; control.append(option); }
            controls.set(key, control); target.append(WeftSettingsControls.row(label, help, control));
            control.addEventListener('change', () => { void save({[key]:control.value}); }); WeftSettingsControls.select(control);
        }
        function swatches(key, label, help) {
            const group = node('div', 'appearance-swatches'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
            const update = () => { for (const button of group.children) button.setAttribute('aria-pressed', String(button.dataset.value === options.get()[key])); };
            for (const [value, text] of colors) {
                const button = node('button', 'appearance-swatch'); button.type = 'button'; button.dataset.value = value; button.dataset.palette = key;
                button.setAttribute('aria-label', text); button.title = text; button.append(WeftIcons.create('allow', 18));
                button.onclick = async () => { for (const item of group.children) item.disabled = true; await save({[key]:value}); for (const item of group.children) item.disabled = false; update(); };
                group.append(button);
            }
            // Match the other appearance controls' shared synchronization path.
            group.addEventListener('weft:sync', update); controls.set(key, group);
            target.append(WeftSettingsControls.row(label, help, group));
        }
        swatches('accentLight', '浅色强调色', '浅色模式下的按钮、文字与焦点环。');
        swatches('accentDark', '深色强调色', '深色模式下的按钮、文字与焦点环。');
        select('fontSize', '字号', '调整阅读与输入的文字大小。', [['14','小 · 14'],['15','标准 · 15'],['17','大 · 17'],['19','特大 · 19']]);
        select('codeFontSize', '代码字号', '只改变代码块与行内代码，不改变正文。', [['12','小 · 12'],['13','标准 · 13'],['15','大 · 15'],['17','特大 · 17']]);
        const preview = node('div', 'appearance-code-preview markdown-body'); preview.setAttribute('aria-label', '代码字号预览');
        preview.innerHTML = '<p>正文保持原字号，行内代码 <code>theme.mode</code> 单独调整。</p><div class="render-code"><pre><code>const greeting = "你好，WeftMate";\nconsole.log(greeting);</code></pre></div>';
        target.append(preview); sync(); mounted.add({target, sync, connected:target.isConnected});
    }
    globalThis.addEventListener('weft-reply-motion-change', () => { for (const entry of mounted) {
        // Desktop builds the panel before attaching its settings dialog.
        if (entry.target.isConnected || !entry.connected) { entry.sync(); entry.connected ||= entry.target.isConnected; }
        else mounted.delete(entry);
    } });
    globalThis.WeftAppearanceControls = { apply, mount };
})();
