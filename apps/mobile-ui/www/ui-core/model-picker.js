/* The same model menu is used by the desktop, remote web and phone library. */
(() => {
    const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; };
    const icon = name => globalThis.WeftIcons?.create(name, 18) || node('span');
    const key = (service, model) => `${service.serviceId}/${model.modelId}`;
    function mount({ trigger, popup, view, select, refresh, add, thinking, toggleThinking, toast = () => {} }) {
        let all = false, query = '', busy = false, revision = 0;
        popup.classList.add('wm-model-menu'); popup.setAttribute('role', 'menu'); popup.setAttribute('aria-label', '选择模型');
        trigger.classList.add('wm-model-trigger'); trigger.setAttribute('aria-haspopup', 'menu');
        function close(focus = false) { revision++; globalThis.WeftPopover?.hide(popup); popup.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus(); }
        function render() {
            const state = view(), services = (state.services || []).filter(service => service.models?.some(model => model.enabled !== false));
            const current = state.selected || {}, rows = services.flatMap(service => service.models.filter(model => model.enabled !== false).map(model => ({ service, model })));
            const recent = state.recent || [], chosen = rows.find(row => row.service.serviceId === current.serviceId && row.model.modelId === current.modelId);
            trigger.setAttribute('aria-label', `模型：${chosen?.model.name || state.modelName || '尚未选择'}`);
            popup.replaceChildren();
            if (all) {
                const search = node('input', 'wm-model-search'); search.type = 'search'; search.placeholder = '搜索全部模型'; search.setAttribute('aria-label', '搜索全部模型'); search.value = query;
                search.addEventListener('input', () => { query = search.value; render(); const next = popup.querySelector('input'); next?.focus(); }); popup.append(search);
            }
            const list = node('div', 'wm-model-list');
            let visible = all ? rows.filter(row => `${row.model.name} ${row.model.modelId} ${row.service.name}`.toLowerCase().includes(query.toLowerCase())) : rows;
            if (!all && rows.length > 12) {
                const ranked = [...rows].sort((a, b) => {
                    const score = row => key(row.service, row.model) === key({serviceId:current.serviceId}, current) ? -100 : recent.includes(key(row.service, row.model)) ? recent.indexOf(key(row.service, row.model)) - 50 : row.model.recommended ? -1 : 0;
                    return score(a) - score(b);
                });
                const common = new Set(ranked.slice(0, 8).map(row => key(row.service, row.model)));
                visible = rows.filter(row => common.has(key(row.service, row.model)));
            }
            for (const service of services) {
                const models = visible.filter(row => row.service === service).map(row => row.model);
                if (!models.length) continue;
                if (services.length > 1) list.append(node('div', 'wm-model-group', service.name));
                for (const model of models) {
                    const selected = current.serviceId === service.serviceId && current.modelId === model.modelId;
                    const button = node('button', 'wm-model-item'); button.type = 'button'; button.dataset.modelId = model.modelId; button.dataset.serviceId = service.serviceId;
                    button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(selected)); button.disabled = busy || model.available === false;
                    const text = node('span', 'wm-model-copy'), name = node('span', 'wm-model-name', model.name || model.modelId); text.append(name); name.title=model.name||model.modelId;
                    button.setAttribute('aria-label',model.name||model.modelId);
                    const vision = model.capabilities?.vision ?? model.vision;
                    if (state.requiresVision && vision === false) {const note=node('small','wm-model-note','这个模型看不了本对话里的图片');note.id=`wm-model-vision-${service.serviceId}-${model.modelId}`;button.setAttribute('aria-describedby',note.id);text.append(note);}
                    if (model.available === false && model.reason) text.append(node('small', 'wm-model-note', model.reason));
                    button.append(text); globalThis.WeftModelLabel?.(name,model.name||model.modelId); if (model.hint) button.append(node('small', 'wm-model-note', model.hint));
                    const check = node('span', 'wm-model-check'); if (selected) check.append(icon('allow')); button.append(check);
                    button.addEventListener('click', async () => {
                        if (busy) return; busy = true; const attempt = revision; render();
                        try { const ok = await select({ serviceId: service.serviceId, modelId: model.modelId, profileId: model.profileId }); if (attempt === revision && ok !== false) close(true); }
                        catch { if (attempt === revision) toast('模型暂时没换成功，请稍后再试。'); }
                        finally { busy = false; if (!popup.hidden) render(); }
                    }); list.append(button);
                }
            }
            if (!visible.length) list.append(node('p', 'wm-model-note wm-model-empty', all ? '没有找到这个模型' : state.loading ? '正在读取模型…' : '添加一个模型服务，就可以开始聊天'));
            popup.append(list);
            if (!all && rows.length > 12) {
                const more = node('button', 'wm-model-item', `全部模型（${rows.length}）`); more.type = 'button'; more.setAttribute('role', 'menuitem');
                more.addEventListener('click', () => { all = true; render(); popup.querySelector('input')?.focus(); }); popup.append(more);
            }
            const deep = thinking?.();
            if (deep?.supported === true) {
                const toggle = node('button', 'wm-model-item wm-model-thinking'); toggle.type = 'button'; toggle.setAttribute('role', 'menuitemcheckbox'); toggle.setAttribute('aria-checked', String(deep.enabled === true)); toggle.disabled = busy || deep.busy;
                toggle.append(node('span', '', '深度思考')); const sw = node('span', 'wm-model-switch'); sw.setAttribute('aria-hidden', 'true'); toggle.append(sw);
                toggle.addEventListener('click', async () => { toggle.disabled = true; try { await toggleThinking(!deep.enabled); } catch { toast('深度思考暂时没保存，请重试。'); } if (!popup.hidden) render(); }); popup.append(toggle);
            }
            const footer = node('button', 'wm-model-item wm-model-add'); footer.type = 'button'; footer.setAttribute('role', 'menuitem'); footer.append(icon('plus'), node('span', '', '添加模型服务…'));
            footer.addEventListener('click', () => { close(); add(); }); popup.append(footer);
            globalThis.WeftPopover?.position(popup, trigger);
        }
        async function open() {
            if (trigger.disabled) return;
            if (!popup.hidden) return close(true);
            all = false; query = ''; revision++; popup.hidden = false; trigger.setAttribute('aria-expanded', 'true'); render();
            popup.querySelector('[aria-checked="true"]')?.focus();
            if (!popup.contains(document.activeElement)) popup.querySelector('button:not(:disabled)')?.focus();
            const attempt = revision; Promise.resolve(refresh?.()).then(() => { if (attempt === revision && !popup.hidden) { const focused = document.activeElement; const id = focused?.dataset?.modelId; render(); const target = [...popup.querySelectorAll('button')].find(el => el.dataset.modelId === id); target?.focus(); } }).catch(() => {});
        }
        popup.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target.tagName === 'INPUT') return;
            const items = [...popup.querySelectorAll('button:not(:disabled)')]; if (!items.length) return;
            event.preventDefault(); event.stopPropagation(); const index = items.indexOf(document.activeElement);
            items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        });
        const outside = event => { if (!popup.hidden && !popup.contains(event.target) && !trigger.contains(event.target)) close(); };
        document.addEventListener('click', outside);
        return { open, close, render, dispose() { close(); document.removeEventListener('click', outside); }, update() { const state = view(); const current = (state.services || []).flatMap(s => (s.models || []).map(m => ({s,m}))).find(({s,m}) => s.serviceId === state.selected?.serviceId && m.modelId === state.selected?.modelId); trigger.setAttribute('aria-label', `模型：${current?.m.name || state.modelName || '尚未选择'}`); if (!popup.hidden) render(); } };
    }
    globalThis.WeftModelPicker = { mount };
})();
