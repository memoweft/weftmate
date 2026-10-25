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
        const english = step.language === 'en', progress = window.WeftTimeline;
        const detail = saved || node('details', 'execution-step');
        detail.stepModel = step; detail.stepOptions = options;
        if (!saved) {
            const label=node('summary'), state=node('span','step-state'), title=node('span','step-title'), time=node('time','step-time');
            state.setAttribute('aria-hidden','true');
            const arrow=node('span','progress-chevron');arrow.setAttribute('aria-hidden','true');arrow.append(WeftIcons.create('chevron',16));
            label.append(state,title,time,arrow);
            const body=node('div','execution-step-body'), output=node('div','step-detail-content'), actions=node('div','progress-detail-actions');
            const copy=progress.detailAction(english?'Copy step details':'复制步骤详情','copy',()=>void progress.copyFeedback(copy,()=>
                (detail.stepOptions.copyText || (text=>navigator.clipboard.writeText(text)))(WeftUiCore.executionDetailText(detail.rawText || '',detail.stepModel.language))));
            const collapse=progress.detailAction(english?'Collapse':'收起','chevron',()=>{detail.open=false;label.focus();});
            copy.hidden=true;actions.append(copy,collapse);body.append(actions,output);detail.append(label,body);
            const resources=node('button','timeline-action step-resources',english?'View sources used':'查看使用的来源');resources.type='button';
            resources.addEventListener('click',()=>detail.stepOptions.openStep?.(detail.stepModel,resources));body.append(resources);
            detail.paintDetail = (raw, truncated=false) => {
                const step=detail.stepModel,options=detail.stepOptions;
                output.replaceChildren();detail.dataset.truncated=String(truncated);
                let data;try{data=JSON.parse(raw)}catch{}
                const args={...WeftUiCore.toolArguments(step.arguments),...WeftUiCore.toolArguments(data)},command=args.command || args.cmd || args.script;
                if(typeof command==='string' && /^(shell|bash|pwsh|powershell|exec_command|run_command)$/.test(step.toolName)) {
                    const fence='`'.repeat(Math.max(3,...[...command.matchAll(/`+/g)].map(match=>match[0].length+1)));
                    const language=/pwsh|powershell/.test(step.toolName)?'powershell':'bash';
                    const block=WeftContent.create(`${fence}${language}\n$ ${command}\n${fence}`,'step-command markdown-body',{copy:options.copyText});
                    const codeCopy=progress.detailAction(english?'Copy command':'复制命令','copy',()=>void progress.copyFeedback(codeCopy,()=>
                        (detail.stepOptions.copyText || (text=>navigator.clipboard.writeText(text)))(block.querySelector('code').textContent)));
                    block.querySelector('.render-code-actions').replaceChildren(codeCopy);output.append(block);
                    const text=WeftUiCore.executionDetailText(raw,step.language),marker=english?'\n\nOutput\n':'\n\n输出\n',at=text.indexOf(marker);
                    if(at>=0)output.append(node('pre','timeline-raw step-output',text.slice(at+marker.length)));
                    else if(!data)output.append(node('pre','timeline-raw step-output',raw));
                } else output.append(node('pre','timeline-raw',WeftUiCore.executionDetailText(raw,step.language)));
                if(truncated)output.append(node('p','muted',english?'[Content truncated]':'[内容已截断]'));
                for(const ref of body.querySelectorAll('.step-reference'))ref.remove();appendReferences(raw,body,options);
            };
            detail.loadDetail = async () => {
                const step=detail.stepModel,seq=String(step.detailRef?.seq ?? '');
                if(!detail.open || detail.dataset.loaded || !step.detailRef || !detail.stepOptions.readDetail)return;
                detail.dataset.loaded='loading';output.textContent=english?'Loading…':'正在读取…';
                try {
                    const data=await detail.stepOptions.readDetail(step.detailRef.seq);
                    if(!detail.isConnected || detail.dataset.detailSeq!==seq)return;
                    detail.rawText=data.text;detail.paintDetail(data.text || '',data.truncated);copy.hidden=false;detail.dataset.loaded='true';
                } catch {
                    if(detail.dataset.detailSeq!==seq)return;
                    output.textContent=english?'Could not load. Collapse and reopen to retry.':'暂时无法读取，收起后可重试。';delete detail.dataset.loaded;
                }
            };
            detail.addEventListener('toggle',()=>void detail.loadDetail());
        }
        const seq=String(step.detailRef?.seq ?? '');
        if(saved && detail.dataset.detailSeq!==seq) {
            delete detail.dataset.loaded;detail.rawText='';detail.querySelector('.step-detail-content').replaceChildren();
            detail.querySelector('.progress-detail-actions > button').hidden=true;
        }
        detail.querySelector('.step-resources').hidden=!options.openStep;
        const state=step.state==='running'&&!running?'completed':step.state;
        if(state==='failed' && detail.dataset.state!=='failed')detail.open=true;
        detail.dataset.step=String(step.stepId);detail.dataset.state=state;detail.dataset.detailSeq=seq;detail.dataset.motion='unfold';
        const title=`${step.summary || (english?'Tool execution':'工具执行')}${step.statusText?` · ${step.statusText}`:state==='failed'?english?' · Encountered an issue':' · 遇到问题':state==='cancelled'?english?' · Stopped':' · 已停止':state==='running'?english?' · Running':' · 运行中':''}${step.approvalText?` · ${step.approvalText}`:''}`;
        const titleNode=detail.querySelector('.step-title');if(titleNode.textContent!==title)titleNode.textContent=title;
        const at=new Date(step.at),ms=Date.parse(step.endAt)-Date.parse(step.at),time=detail.querySelector('time');
        const recorded=Number.isFinite(at.getTime());
        const stamp=recorded?new Intl.DateTimeFormat(english?'en-GB':'zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(at):english?'Time unavailable':'时间未记录';
        const duration=step.startRecorded!==false&&Number.isFinite(ms)&&ms>=0?`${Math.round(ms/100)/10} ${english?'s':'秒'}`:'';
        time.textContent=duration || (recorded?new Intl.DateTimeFormat(english?'en-GB':'zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(at):'');
        if(recorded)time.dateTime=at.toISOString();
        detail.querySelector('summary').title=[stamp,duration].filter(Boolean).join(' · ');
        detail.querySelector('summary').setAttribute('aria-description',[stamp,duration].filter(Boolean).join(' · '));
        // The common shell takes over measured transitions when available.
        if(globalThis.WeftMotion?.visibility)WeftMotion.details(detail);
        if(detail.open)void detail.loadDetail();
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
