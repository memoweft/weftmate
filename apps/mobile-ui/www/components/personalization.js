/* Shared settings view for the desktop, remote browser and Android UI package. */
globalThis.WeftPersonalizationView = (core, target, category, {toast = () => {}} = {}) => {
    const controls = globalThis.WeftSettingsControls, fields = new Map(), texts = new Map();
    const identity = core.state.identityGeneration;
    const current = () => target.isConnected && identity === core.state.identityGeneration;
    const node = (tag, cls = '', text = '') => { const n = document.createElement(tag); n.className = cls; n.textContent = text; return n; };
    const form = node('form', 'personalization-form'), notice = node('p', 'muted', '正在读取…'); notice.setAttribute('role', 'status');
    target.replaceChildren(form); form.append(notice);
    let saved, ready = false;
    const busy = value => { for (const element of form.querySelectorAll('input,textarea,select,button')) element.disabled = value; };
    const report = (value, justSaved = false) => { if (!current()) return; saved = value.settings; notice.textContent = ''; notice.hidden = true; if (justSaved) toast('已同步 · 从下一次回复开始生效'); };
    async function write(patch, extract = false) {
        if (!ready || !current()) return;
        busy(true); notice.hidden = false; notice.textContent = extract ? '正在本机提炼…' : '正在同步…';
        try { const value = await core.savePersonalization(patch, extract); if (current()) { report(value, true); if (extract) { const field = texts.get('writingStyle'); field.value = value.settings.writingStyle; field.updateCount(); fields.get('useWritingStyle').checked = true; } } }
        catch { if (current()) { notice.textContent = '未能同步，修改仍在这里。请重试。'; for (const [key, control] of fields) { if (control.type === 'checkbox') control.checked = saved[key]; else control.value = saved[key]; control.dispatchEvent(new Event('weft:sync')); } } }
        finally { if (current()) busy(false); }
    }
    function text(key, label, description, multiline = false) {
        const field = node(multiline ? 'textarea' : 'input'); field.id = 'personalization-' + key;
        field.setAttribute('aria-label', label); field.maxLength = globalThis.WeftPersonalization.limits[key] * 2;
        if (multiline) field.rows = key === 'fixedInstructions' ? 5 : 3;
        const wrapper = node('div', 'personalization-field'), count = node('small', 'muted');
        count.id = field.id + '-count'; field.setAttribute('aria-describedby', count.id);
        const update = () => { const length = [...field.value].length, limit = globalThis.WeftPersonalization.limits[key]; count.textContent = `${length} / ${limit} 字`; field.setCustomValidity(length > limit ? `最多填写 ${limit} 字。` : ''); };
        field.addEventListener('input', update); wrapper.append(field, count);
        const row = controls.row(label, description, wrapper); row.querySelector('label').htmlFor = field.id; row.classList.add('personalization-text-row');
        form.append(row); texts.set(key, field); field.updateCount = update; return field;
    }
    function select(key, label, description, options) {
        const field = node('select'); field.id = 'personalization-' + key; field.setAttribute('aria-label', label);
        for (const [value, name] of options) field.append(new Option(name, value));
        form.append(controls.row(label, description, field)); fields.set(key, field);
        field.addEventListener('change', () => { void write({ [key]: field.value }); });
        globalThis.WeftPopover?.bindSettingsSelect(field);
    }
    function toggle(key, label, description) {
        const field = node('input'); field.type = 'checkbox'; field.id = 'personalization-' + key; field.setAttribute('aria-label', label); controls.toggle(field);
        form.append(controls.row(label, description, field)); fields.set(key, field);
        field.addEventListener('change', () => { void write({ [key]: field.checked }, key === 'useWritingStyle' && field.checked && !texts.get('writingStyle').value.trim()); });
    }
    if (category === 'personalization') {
        text('preferredName', '怎么称呼你', '名字或昵称，助手会在合适的时候使用。');
        text('bio', '你的简介', '职业、关注点或希望助手了解的背景，可留空。', true);
        select('tone', '回复语气', '选一种常用语气，也可以补充自己的说明。', [['natural', '自然'], ['concise', '简洁'], ['detailed', '详细'], ['formal', '正式'], ['casual', '轻松']]);
        text('toneInstructions', '自定义语气说明', '例如：先给结论，避免客套话。', true);
        text('fixedInstructions', '固定说明', '用于所有对话，包括临时对话。这里的说明不会形成记忆。', true);
        toggle('useWritingStyle', '参考我的写作风格', '在这台电脑上提炼表达习惯，不为此向模型发送消息。临时对话不参与。');
        text('writingStyle', '提炼结果', '这是表达习惯的提示，可编辑或清除；不会保存消息原文。', true);
        const actions = node('div', 'actions');
        const extract = node('button', 'button secondary', '重新提炼'), clear = node('button', 'button quiet', '清除提炼结果');
        extract.type = clear.type = 'button'; extract.addEventListener('click', () => { void write({}, true); });
        clear.addEventListener('click', async () => { await write({ writingStyle: '' }); if (current() && saved.writingStyle === '') { texts.get('writingStyle').value = ''; texts.get('writingStyle').updateCount(); } });
        actions.append(extract, clear); form.append(actions);
        const save = node('button', 'button primary', '保存个性化'); save.type = 'submit'; form.append(save);
    } else {
        toggle('nextSuggestionsEnabled', '下一步建议', '回复结束后给出相关短句，输入时补全后半句。点选或接受只填入输入框，由你决定是否发送。');
        toggle('webSearch', '网页搜索', '允许助手根据问题搜索和读取网页。关闭后，需要最新资料时会说明无法查证。');
        toggle('researchSelfCheck', '成文前核对事实', '查资料成文时，用已读取的原文核对关键结论、适用范围和数字。关闭后仍保留出处与未确认说明。');
        select('verbosity', '回答详细程度', '作为默认偏好，你仍可在对话中要求更短或更详细。', [['short', '简短'], ['medium', '适中'], ['thorough', '详尽']]);
        select('thinkingDisplay', '显示思考过程', '仅对提供思考内容的模型生效，不改变模型的思考能力。', [['collapsed', '折叠'], ['expanded', '展开'], ['hidden', '不显示']]);
        toggle('defaultDeepThinking', '新对话默认深入思考', '只用于支持深入思考的模型；不支持的模型会按普通方式回答。已有对话可在输入区单独设置。');
        select('messageMode', '回复进行中时发送的消息', '排队：等当前回复结束后处理。引导：插入当前回复，调整方向。', [['queue', '排队'], ['steer', '引导']]);
    }
    function fill(settings) {
        for (const [key, control] of fields) { if (control.type === 'checkbox') control.checked = settings[key]; else control.value = settings[key]; control.dispatchEvent(new Event('weft:sync')); }
        for (const [key, control] of texts) { control.value = settings[key]; control.updateCount(); }
    }
    form.addEventListener('submit', event => { event.preventDefault(); if (form.reportValidity()) void write(Object.fromEntries([...texts].map(([key, control]) => [key, control.value]))); });
    busy(true);
    void core.loadPersonalization().then(value => { if (current()) { report(value); fill(value.settings); ready = true; busy(false); } }).catch(() => {
        if (!current()) return; notice.textContent = '暂时无法读取，请连接电脑后重试。';
        const retry = node('button', 'button secondary', '重试读取'); retry.type = 'button'; retry.onclick = () => globalThis.WeftPersonalizationView(core, target, category, {toast}); form.append(retry);
    });
};
globalThis.WeftModelThinking = (core, row, event) => {
    const text = event.data?.modelThinking, display = core.state.personalization?.thinkingDisplay || 'collapsed';
    if (typeof text !== 'string' || !text) return;
    row.classList.toggle('thinking-only',!event.data.text&&!event.data.images?.length);
    const details = document.createElement('details'); details.className = 'model-thinking';
    details.open = display === 'expanded';
    details.hidden = display === 'hidden';
    const summary = document.createElement('summary'); summary.textContent = '思考过程';
    const content = document.createElement('p'); content.textContent = text;
    details.append(summary, content); row.prepend(details);
    if (!globalThis.WeftThinkingListener) {
        globalThis.WeftThinkingListener = true;
        document.addEventListener('weft:personalization', () => {
            const mode = core.state.personalization?.thinkingDisplay || 'collapsed';
            for (const node of document.querySelectorAll('.model-thinking')) { node.hidden = mode === 'hidden'; node.open = mode === 'expanded'; }
        });
    }
};
