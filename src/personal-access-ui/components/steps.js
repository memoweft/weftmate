/* One execution-step component. Data and references come from ui-core. */
(() => {
    const node = (tag, cls, text) => {
        const n = document.createElement(tag);
        n.className = cls || '';
        if (text)
            n.textContent = text;
        return n;
    };
    function stepCard(step, saved, running, options) {
        const detail = node('details', 'execution-step'), label = node('summary', '', `${step.summary || '工具执行'}${step.state === 'failed' ? ' · 未完成' : step.state === 'running' && running ? ' · 运行中' : ''}`);
        label.prepend(window.WeftIcons.create('chevron', 16), window.WeftIcons.create('terminal', 16));
        const output = node('pre', 'timeline-raw'), copy = node('button', 'timeline-action', '复制');
        detail.dataset.step = String(step.stepId);
        if (saved) {
            detail.open = saved.open;
            if (saved.dataset.loaded === 'true') {
                detail.dataset.loaded = 'true';
                output.textContent = saved.querySelector('pre')?.textContent || '';
            }
        }
        copy.type = 'button';
        copy.hidden = true;
        if (detail.dataset.loaded === 'true')
            copy.hidden = false;
        copy.addEventListener('click', async () => {
            try {
                if (options.copyText)
                    await options.copyText(output.textContent);
                else
                    await navigator.clipboard.writeText(output.textContent);
                copy.textContent = '已复制';
            }
            catch {
                copy.textContent = '复制未完成';
            }
        });
        const resources = node('button', 'timeline-action step-resources', '查看使用的来源');
        resources.type = 'button';
        resources.addEventListener('click', () => options.openStep?.(step, resources));
        detail.append(label, resources, output, copy);
        if (detail.dataset.loaded === 'true')
            appendReferences(output.textContent, detail, options);
        detail.addEventListener('toggle', async () => {
            if (!detail.open || detail.dataset.loaded || !step.detailRef)
                return;
            detail.dataset.loaded = 'loading';
            output.textContent = '正在读取…';
            try {
                const data = await options.readDetail(step.detailRef.seq);
                if (!detail.isConnected)
                    return;
                output.textContent = `${data.text || ''}${data.truncated ? '\n[内容已截断]' : ''}`;
                copy.hidden = false;
                detail.dataset.loaded = 'true';
                appendReferences(data.text, detail, options);
            }
            catch {
                output.textContent = '暂时无法读取，收起后可重试。';
                delete detail.dataset.loaded;
            }
        });
        return detail;
    }
    function appendReferences(text, parent, options) {
        if (!options.openReference)
            return;
        for (const reference of globalThis.WeftUiCore.resourceReferences(text)) {
            const link = node('button', 'timeline-action step-reference', reference.value);
            link.type = 'button';
            link.addEventListener('click', () => options.openReference(reference.key, link));
            parent.append(link);
        }
    }
    globalThis.WeftTimelineCards = { ...globalThis.WeftTimelineCards, step: stepCard };
})();
