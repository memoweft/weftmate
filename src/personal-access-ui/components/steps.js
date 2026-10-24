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
        const english = step.language === 'en';
        const progress = window.WeftTimeline;
        const detail = node('details', 'execution-step'), label = node('summary', '', `${step.summary || (english ? 'Tool execution' : '工具执行')}${step.statusText ? ` · ${step.statusText}` : step.state === 'failed' ? english ? ' · Encountered an issue' : ' · 遇到问题' : step.state === 'cancelled' ? english ? ' · Stopped' : ' · 已停止' : step.state === 'running' && running ? english ? ' · Running' : ' · 运行中' : ''}${step.approvalText ? ` · ${step.approvalText}` : ''}`);
        const arrow = node('span', 'progress-chevron'); arrow.setAttribute('aria-hidden', 'true');
        arrow.append(window.WeftIcons.create('chevron', 16)); label.append(arrow);
        const output = node('div', 'step-detail-content');
        const copy = progress.detailAction(english ? 'Copy step details' : '复制步骤详情','copy',()=>void progress.copyFeedback(copy,()=>
            (options.copyText || (text=>navigator.clipboard.writeText(text)))(globalThis.WeftUiCore.executionDetailText(detail.rawText || '',step.language))));
        const collapse = progress.detailAction(english ? 'Collapse' : '收起','chevron',()=>{detail.open=false;label.focus();});
        const actions = node('div','progress-detail-actions'); actions.append(copy,collapse);
        function paintDetail(raw, truncated = false) {
            output.replaceChildren();
            detail.dataset.truncated = String(truncated);
            let data;
            try { data = JSON.parse(raw); } catch { /* Plain tool output. */ }
            const args = {...globalThis.WeftUiCore.toolArguments(step.arguments),...globalThis.WeftUiCore.toolArguments(data)};
            const command = args.command || args.cmd || args.script;
            if (typeof command === 'string' && /^(shell|bash|pwsh|powershell|exec_command|run_command)$/.test(step.toolName)) {
                const fence = '`'.repeat(Math.max(3,...[...command.matchAll(/`+/g)].map(match=>match[0].length+1)));
                const language = /pwsh|powershell/.test(step.toolName) ? 'powershell' : 'bash';
                const block=WeftContent.create(`${fence}${language}\n$ ${command}\n${fence}`, 'step-command markdown-body', {copy:options.copyText});
                const controls=block.querySelector('.render-code-actions');
                const codeCopy=progress.detailAction(english ? 'Copy command' : '复制命令','copy',()=>void progress.copyFeedback(codeCopy,()=>
                    (options.copyText || (text=>navigator.clipboard.writeText(text)))(block.querySelector('code').textContent)));
                controls.replaceChildren(codeCopy); output.append(block);
                const text = globalThis.WeftUiCore.executionDetailText(raw, step.language);
                const marker = english ? '\n\nOutput\n' : '\n\n输出\n';
                const at = text.indexOf(marker);
                if (at >= 0) output.append(node('pre','timeline-raw step-output',text.slice(at+marker.length)));
                else if (!data) output.append(node('pre','timeline-raw step-output',raw));
            } else output.append(node('pre','timeline-raw',globalThis.WeftUiCore.executionDetailText(raw, step.language)));
            if (truncated) output.append(node('p','muted',english ? '[Content truncated]' : '[内容已截断]'));
        }
        detail.dataset.step = String(step.stepId);
        detail.dataset.state = step.state;
        detail.dataset.detailSeq = String(step.detailRef?.seq ?? '');
        detail.open = step.state === 'failed' && saved?.dataset.state !== 'failed';
        if (saved) {
            detail.open = detail.open || saved.open;
            if (saved.dataset.loaded === 'true' && saved.dataset.detailSeq === detail.dataset.detailSeq) {
                detail.dataset.loaded = 'true';
                detail.rawText = saved.rawText;
                paintDetail(detail.rawText || '',saved.dataset.truncated === 'true');
            }
        }
        copy.type = 'button';
        copy.hidden = true;
        if (detail.dataset.loaded === 'true')
            copy.hidden = false;
        const resources = node('button', 'timeline-action step-resources', english ? 'View sources used' : '查看使用的来源');
        resources.type = 'button';
        resources.addEventListener('click', () => options.openStep?.(step, resources));
        const body = node('div','execution-step-body'); body.append(actions,output);
        if(options.openStep)body.append(resources);
        detail.append(label,body);
        detail.dataset.motion = 'unfold';
        if (detail.dataset.loaded === 'true')
            appendReferences(detail.rawText || output.textContent, body, options);
        detail.addEventListener('toggle', async () => {
            if (!detail.open || detail.dataset.loaded || !step.detailRef)
                return;
            detail.dataset.loaded = 'loading';
            output.textContent = english ? 'Loading…' : '正在读取…';
            try {
                const data = await options.readDetail(step.detailRef.seq);
                if (!detail.isConnected)
                    return;
                detail.rawText = data.text;
                paintDetail(data.text || '',data.truncated);
                copy.hidden = false;
                detail.dataset.loaded = 'true';
                appendReferences(data.text, body, options);
            }
            catch {
                output.textContent = english ? 'Could not load. Collapse and reopen to retry.' : '暂时无法读取，收起后可重试。';
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
