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
        const detail = node('details', 'execution-step'), label = node('summary', '', `${step.summary || '工具执行'}${step.state === 'failed' ? ' · 失败' : step.state === 'cancelled' ? ' · 已停止' : step.state === 'running' && running ? ' · 运行中' : ''}${step.approvalText ? ` · ${step.approvalText}` : ''}`);
        const arrow = node('span', 'progress-chevron'); arrow.setAttribute('aria-hidden', 'true');
        arrow.append(window.WeftIcons.create('chevron', 16)); label.append(arrow);
        const output = node('pre', 'timeline-raw'), copy = node('button', 'timeline-action', '复制');
        detail.dataset.step = String(step.stepId);
        detail.dataset.state = step.state;
        detail.dataset.detailSeq = String(step.detailRef?.seq ?? '');
        detail.open = step.state === 'failed' && saved?.dataset.state !== 'failed';
        if (saved) {
            detail.open = detail.open || saved.open;
            if (saved.dataset.loaded === 'true' && saved.dataset.detailSeq === detail.dataset.detailSeq) {
                detail.dataset.loaded = 'true';
                output.textContent = saved.querySelector('pre')?.textContent || '';
                detail.rawText = saved.rawText;
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
        globalThis.WeftMotion?.details(detail);
        if (detail.dataset.loaded === 'true')
            appendReferences(detail.rawText || output.textContent, detail, options);
        detail.addEventListener('toggle', async () => {
            if (!detail.open || detail.dataset.loaded || !step.detailRef)
                return;
            detail.dataset.loaded = 'loading';
            output.textContent = '正在读取…';
            try {
                const data = await options.readDetail(step.detailRef.seq);
                if (!detail.isConnected)
                    return;
                output.textContent = `${globalThis.WeftUiCore.executionDetailText(data.text || '')}${data.truncated ? '\n[内容已截断]' : ''}`;
                detail.rawText = data.text;
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
