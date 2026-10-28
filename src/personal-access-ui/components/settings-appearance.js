/* Device-local appearance controls. All choices apply immediately through the caller. */
(() => {
    const colors = [['neutral', '石墨'], ['blue', '蓝色'], ['green', '松绿'], ['purple', '紫色']];
    const fonts = [['system','系统'],['serif','衬线'],['mono','等宽']];
    const families = {system:'var(--wm-font-family-body)',serif:'Georgia, "Noto Serif CJK SC", "SimSun", serif',mono:'var(--wm-font-family-mono)'};
    const mounted = new Set();
    const node = (tag, cls = '', text = '') => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; };
    function apply(value, theme) {
        const root = document.documentElement, suffix = theme === 'dark' ? 'Dark' : 'Light';
        root.style.setProperty('--text-size', `${value.fontSize}px`);
        root.style.setProperty('--ui-size', `${value.uiFontSize || 14}px`);
        root.style.setProperty('--code-size', `${value.codeFontSize}px`);
        root.style.fontSize = `${value.uiFontSize || 14}px`;
        root.style.fontFamily = families[value.separateModes ? value['font' + suffix] : value.font] || families.system;
        root.dataset.accent = value.separateModes === false ? value.accent : value['accent' + suffix];
        const preset = value.separateModes ? value['themePreset' + suffix] : value.themePreset;
        const background = value['background' + suffix] || (preset === 'paper' ? (theme === 'dark' ? '#242424' : '#f6f1e7') : '');
        const foreground = value['foreground' + suffix];
        for (const [key, setting] of [['--appearance-background',background],['--appearance-foreground',foreground]]) {
            if (setting) root.style.setProperty(key, setting); else root.style.removeProperty(key);
        }
        for (const key of ['--canvas','--surface','--surface-soft','--ink','--ink-secondary','--ink-muted','--line','--appearance-secondary','--appearance-muted','--appearance-line']) root.style.removeProperty(key);
        if (background) {
            root.style.setProperty('--canvas', background);
            root.style.setProperty('--surface', `color-mix(in srgb, var(--ink) 3%, ${background})`);
            root.style.setProperty('--surface-soft', `color-mix(in srgb, var(--ink) 7%, ${background})`);
        }
        if (foreground) root.style.setProperty('--ink', foreground);
        if (foreground || value.contrast !== '60') {
            const contrast = Number(value.contrast ?? 60);
            root.style.setProperty('--ink-secondary', `color-mix(in srgb, var(--ink) ${65 + contrast * .2}%, var(--canvas))`);
            root.style.setProperty('--ink-muted', `color-mix(in srgb, var(--ink) ${60 + contrast * .2}%, var(--canvas))`);
            root.style.setProperty('--line', `color-mix(in srgb, var(--ink) ${10 + contrast * .2}%, var(--canvas))`);
            for (const [alias,key] of [['secondary','ink-secondary'],['muted','ink-muted'],['line','line']]) root.style.setProperty('--appearance-'+alias,root.style.getPropertyValue('--'+key));
        }
        root.toggleAttribute('data-translucent-sidebar', value.translucentSidebar === true);
        root.toggleAttribute('data-page-full-width', value.fullWidth === true);
        root.toggleAttribute('data-pointer-cursor', value.pointerCursor === true);
        root.dataset.diffStyle = value.diffStyle;
        globalThis.dispatchEvent(new CustomEvent('weftmate:appearance', {detail:{...value}}));
        for (const entry of mounted) if (entry.target.isConnected) entry.sync();
    }
    function mount(target, options) {
        target.classList.add('appearance-page');
        const controls = new Map(); let motion;
        const currentMode = () => document.documentElement.dataset.theme === 'dark' ? 'Dark' : 'Light';
        const sync = () => {
            const value = options.get();
            for (const [key, control] of controls) {
                const setting = control.dataset.modeKey ? value[key + currentMode()] : value[key];
                if (control.type === 'checkbox') control.checked = setting === true;
                else control.value = setting || (control.dataset.colorToken ? getComputedStyle(document.documentElement).getPropertyValue(control.dataset.colorToken).trim() : '');
                control.dispatchEvent(new Event('weft:sync'));
            }
            for (const button of modes.children) button.setAttribute('aria-pressed', String(button.dataset.value === value.theme));
            if (motion) { motion.value=globalThis.WeftReplyMotion?.preference || 'system'; motion.dispatchEvent(new Event('weft:sync')); }
        };
        async function save(patch) {
            const value = options.get();
            if (patch.separateModes === false) for (const key of ['themePreset','accent','font','background','foreground']) {
                const active = value[key + currentMode()] ?? value[key];
                Object.assign(patch, {[key + 'Light']:active,[key + 'Dark']:active,...(['themePreset','accent','font'].includes(key)?{[key]:active}:{})});
            }
            if (!value.separateModes) for (const key of ['background','foreground']) if (patch[key + currentMode()] !== undefined) {
                Object.assign(patch, {[key+'Light']:patch[key+currentMode()],[key+'Dark']:patch[key+currentMode()]});
            }
            try { await options.set(patch); sync(); }
            catch { sync(); options.toast?.('外观暂时无法保存，请重试。', true); }
        }
        function group(parent, title) {
            const section = node('section', 'settings-group'), card = node('div', 'settings-group-card');
            if (title) section.append(node('h2', 'settings-group-title', title));
            section.append(card); parent.append(section); return card;
        }
        const visual = group(target, '视觉风格');
        const modes = node('div', 'settings-segmented appearance-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '颜色模式');
        for (const [value, label] of [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']]) {
            const button = node('button', '', label); button.type = 'button'; button.dataset.value = value;
            const preview = node('span', 'appearance-thumbnail'); preview.dataset.mode = value; preview.setAttribute('aria-hidden', 'true');
            preview.innerHTML = '<span class="appearance-mini-rail"><i></i><i></i><i></i></span><span class="appearance-mini-chat"><i></i><i></i><i></i><span></span></span>';
            button.prepend(preview); button.append(globalThis.WeftIcons.create('allow', 16));
            button.addEventListener('click', () => { void save({theme:value}); }); modes.append(button);
        }
        modes.addEventListener('keydown', event => {
            if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
            event.preventDefault(); const buttons = [...modes.children], index = buttons.indexOf(document.activeElement);
            const next = buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length];
            next.focus(); next.click();
        });
        const modeRow = WeftSettingsControls.row('模式', '', modes); modeRow.classList.add('appearance-mode-row'); visual.append(modeRow);
        if (options.onlyTheme) { sync(); mounted.add({target,sync}); return; }
        const advanced = node('details', 'appearance-advanced'); advanced.append(node('summary', '', '更多显示偏好'));
        const palette = group(advanced, '配色与字体');
        function select(parent, key, label, help, values, perMode = false) {
            const control = node('select'); control.id = 'appearance-' + key; control.setAttribute('aria-label', label);
            for (const [value, text] of values) { const option = node('option', '', text); option.value = value; control.append(option); }
            if (perMode) control.dataset.modeKey = 'true';
            controls.set(key, control); parent.append(WeftSettingsControls.row(label, help, control));
            control.addEventListener('change', () => {
                const value = options.get(), patch = {[perMode ? key + currentMode() : key]:control.value};
                if (perMode && !value.separateModes) Object.assign(patch, {[key]:control.value,[key+'Light']:control.value,[key+'Dark']:control.value});
                void save(patch);
            }); WeftSettingsControls.select(control);
        }
        select(palette, 'themePreset', '主题', '', [['default','WeftMate'],['paper','纸张']], true);
        select(palette, 'accent', '强调色', '', colors, true);
        function color(key, label, token) {
            const wrap = node('div', 'appearance-color'), swatch = node('input'), field = node('input');
            swatch.type = 'color'; swatch.setAttribute('aria-label', label + '选择'); swatch.tabIndex = -1;
            field.type = 'text'; field.setAttribute('aria-label', label + '值'); field.maxLength = 7; field.pattern = '#[0-9a-fA-F]{6}';
            field.dataset.modeKey = swatch.dataset.modeKey = 'true'; field.dataset.colorToken = swatch.dataset.colorToken = token;
            // Use the resolved canvas/text color, even when a preset has no custom override.
            const update = () => { const style = getComputedStyle(document.documentElement), resolved = key === 'background' ? style.backgroundColor : style.color;
                const parts = resolved.match(/\d+/g); const fallback = parts ? '#' + parts.slice(0,3).map(n=>Number(n).toString(16).padStart(2,'0')).join('') : '#ffffff';
                const value = options.get()[key + currentMode()] || fallback; field.value = swatch.value = value; };
            controls.set(key, field); field.addEventListener('weft:sync', update);
            const change = source => { if (!source.reportValidity()) return; void save({[key + currentMode()]:source.value.toLowerCase()}); };
            field.addEventListener('change', () => change(field)); swatch.addEventListener('change', () => change(swatch));
            wrap.append(swatch,field); palette.append(WeftSettingsControls.row(label, '', wrap));
        }
        color('background','背景色','--canvas'); color('foreground','前景色','--ink');
        select(palette, 'font', '字体', '', fonts, true);
        const sizes = group(target, '交互与阅读');
        const pointer = node('input'); pointer.type = 'checkbox'; pointer.id = 'appearance-pointerCursor'; pointer.setAttribute('aria-label','使用指针光标');
        controls.set('pointerCursor',pointer); WeftSettingsControls.toggle(pointer);
        pointer.onchange = () => void save({pointerCursor:pointer.checked});
        sizes.append(WeftSettingsControls.row('使用指针光标','悬停在可点击的控件上时显示手形指针。',pointer));
        function choice(label,values,onChange) {
            const wrap=node('div','appearance-choice'),source=node('select');source.setAttribute('aria-label',label);
            for(const [value,text]of values)source.append(new Option(text,value));
            wrap.append(source);WeftSettingsControls.segmented(source);source.onchange=()=>onChange(source.value);
            return {wrap,source};
        }
        const motionChoice = choice('减少动态效果', [['system','系统'],['reduce','开启'],['full','关闭']], value => {
            try { globalThis.WeftReplyMotion.setPreference(value); }
            catch { options.toast?.('动态效果偏好未保存，请重试。'); }
            sync();
        });
        motion=motionChoice.source;
        sizes.append(WeftSettingsControls.row('减少动态效果','减少动画效果，或跟随系统设置。',motionChoice.wrap));
        for (const [key,label,help] of [['uiFontSize','界面字号','调整菜单、设置与控件的文字大小。'],['fontSize','内容字号','调整对话正文与输入文字大小。'],['codeFontSize','代码字号','调整代码块与行内代码。']]) {
            const wrap = node('div','appearance-number'), input = node('input'); input.type = 'number'; input.min = '10'; input.max = '24'; input.step = '1'; input.id = 'appearance-' + key; input.setAttribute('aria-label',label);
            controls.set(key,input);
            input.addEventListener('blur',()=>{
                const raw = input.value.trim(), number = Number(raw);
                const size = raw && Number.isFinite(number) ? Math.min(24,Math.max(10,Math.round(number))) : Number(WeftUiCore.appearanceDefaults[key]);
                input.value=String(size); if(input.value!==options.get()[key])void save({[key]:input.value});
            });
            input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}});
            wrap.append(input,node('span','muted','px')); sizes.append(WeftSettingsControls.row(label,help,wrap));
        }
        const diff = choice('差异标记', [['color','颜色'],['symbols','+/−']], value => void save({diffStyle:value}));
        controls.set('diffStyle',diff.source);
        sizes.append(WeftSettingsControls.row('差异标记','审查改动时使用颜色，或为增删行显示 + 和 −。',diff.wrap));
        target.append(advanced);WeftSettingsControls.details(advanced);
        const behavior = group(advanced, '显示偏好');
        function toggle(key,label,help) { const input=node('input');input.type='checkbox';input.id='appearance-'+key;input.setAttribute('aria-label',label);WeftSettingsControls.toggle(input);controls.set(key,input);input.onchange=()=>void save({[key]:input.checked});behavior.append(WeftSettingsControls.row(label,help,input)); }
        toggle('separateModes','分别设置浅色和深色','分别保留各自的强调色、背景、前景与字体。');
        const wrap = node('div','appearance-range'), range=node('input'), output=node('output'); range.type='range';range.min='0';range.max='100';range.setAttribute('aria-label','对比度'); controls.set('contrast',range); range.addEventListener('weft:sync',()=>output.value=range.value);range.oninput=()=>{output.value=range.value;void save({contrast:range.value});};wrap.append(range,output);behavior.append(WeftSettingsControls.row('对比度','调整说明文字和分隔线的清晰度。',wrap));
        toggle('translucentSidebar','半透明侧边栏','让侧边栏透出一层柔和的背景。');
        toggle('fullWidth','页面全宽显示','让对话内容使用可用的页面宽度。');
        const preview=node('div','appearance-code-preview markdown-body');preview.setAttribute('aria-label','代码字号预览');preview.innerHTML='<p>正文与代码分别设置，行内代码 <code>theme.mode</code>。</p><div class="render-code"><pre><code>const greeting = "你好，WeftMate";</code></pre></div>';advanced.append(preview);
        sync(); mounted.add({target,sync});
    }
    globalThis.addEventListener('weft-reply-motion-change', () => { for (const entry of mounted) { if (entry.target.isConnected) entry.sync(); else mounted.delete(entry); } });
    globalThis.WeftDesktopAppearanceControls = { apply, mount };
})();
