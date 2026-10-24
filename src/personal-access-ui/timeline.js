/* Desktop timeline renderer. Mobile maintains its own presentation bundle. */
(() => {
  'use strict'
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n }
  // Reasoning belongs to the progress disclosure; answer text stays in the transcript.
  function prepare(events, display = 'collapsed') {
    let taskId;
    return [...events].sort((a,b)=>a.seq-b.seq).flatMap(event => {
      if (event.data?.toolName === '__thinking' && display === 'hidden') return [];
      if (event.type === 'turn.started') taskId = `${event.sourceRef?.sessionId ? event.sourceRef.sessionId + ':' : ''}turn-${event.data?.turn}`;
      if (event.data?.taskId) taskId = event.data.taskId;
      if (event.type !== 'assistant.message' || !event.data?.modelThinking || display === 'hidden') return [event];
      const data = event.data, anchor = event.progressSeq ?? data.streamSeq ?? event.seq;
      const thought = { ...event, seq: anchor - 0.01, type: data.thinkingActive ? 'step.started' : 'step.completed', data: {
        taskId: taskId || `thinking-${anchor}`, stepId: `thinking-${data.streamSeq ?? event.seq}`, toolName: '__thinking',
        state: data.thinkingActive ? 'running' : 'completed', modelThinking: data.modelThinking,
        thinkingMs: data.thinkingMs, thinkingActive: data.thinkingActive,
        summary: data.modelThinking.trim().split(/(?<=[。！？.!?])\s*|\n/)[0],
      } };
      return data.text || data.images?.length ? [thought, event] : [thought];
    });
  }
  function thinking(core, row, event) {
    if (!event.data?.modelThinking) return;
    row.classList.toggle('thinking-only', !event.data.text && !event.data.images?.length);
    row.hidden = row.classList.contains('thinking-only');

  }
  function thinkingCard(step, saved, options) {
    const detail = saved || node('details', 'execution-step model-thinking');
    const fresh = !saved;
    if (fresh) {
      detail.dataset.step = step.stepId;
      const summary = node('summary'), title = node('span', 'thinking-title'), arrow = node('span', 'progress-chevron');
      arrow.append(WeftIcons.create('chevron',16)); summary.append(title,arrow);
      const body = node('div','thinking-body'), actions = node('div','progress-detail-actions');
      const copy = node('button','timeline-action','复制'), collapse = node('button','timeline-action','收起');
      copy.type = collapse.type = 'button'; copy.setAttribute('aria-label','复制思考内容');
      copy.onclick = async () => { try { await (options.copyText || (text=>navigator.clipboard.writeText(text)))(detail.querySelector('p').textContent); copy.textContent='已复制'; } catch { copy.textContent='复制未完成'; } };
      collapse.onclick = () => { detail.open=false; summary.focus(); };
      actions.append(copy,collapse); body.append(actions,node('p')); detail.append(summary,body);
    }
    if (fresh) detail.open = step.thinkingActive && options.thinkingDisplay === 'expanded';
    if (detail.dataset.active === 'true' && !step.thinkingActive) detail.open = false;
    detail.dataset.active = String(!!step.thinkingActive);
    detail.querySelector('.thinking-title').textContent = step.summary;
    detail.querySelector('p').textContent = step.modelThinking;
    return detail;
  }
  function render(events, list, options = {}) {
    list.progressRender = { events, options }
    const renderCurrent = () => { const current = list.progressRender; render(current.events, list, current.options) }
    const { ordered, groups, cards } = globalThis.WeftUiCore.projectTimeline(prepare(events, options.thinkingDisplay), options.approvals || [])
    const existing = new Map([...list.children].filter(n => n.dataset.timeline).map(n => [n.dataset.timeline, n]))
    const seen = new Set()
    const put = (key, seq, build) => {
      seen.add(key); let row = existing.get(key)
      if (!row) { row = node(options.tag || 'li', 'timeline-entry'); row.dataset.timeline = key; existing.set(key, row) }
      const previousSeq = row.dataset.seq
      row.dataset.seq = String(seq); build(row)
      const before = [...list.children].find(n => n !== row && Number(n.dataset.seq) > seq)
      if (before) { if (row.nextElementSibling !== before) list.insertBefore(row, before) }
      else if (!row.parentNode || previousSeq !== String(seq)) list.append(row)
      return row
    }
    const started = ordered.filter(event => event.type === 'turn.started').at(-1)
    const waiting = options.waiting && started && !ordered.some(event => event.seq > started.seq &&
      (event.type.startsWith('step.') || event.type === 'assistant.message' && event.data?.text))
    if (waiting) put('waiting', Math.max(started.seq, ...ordered.filter(event => event.type === 'user.message' && event.seq > started.seq).map(event => event.seq)) + 0.1, row => {
      row.classList.add('inline-waiting'); row.setAttribute('role', 'status')
      let text=row.querySelector('.inline-progress-text'); if(!text){text=node('span','inline-progress-text is-running');row.replaceChildren(text)}
      const seq = Math.max(started.seq, ...ordered.filter(event => event.type === 'user.message' && event.seq > started.seq).map(event => event.seq))
      const language = WeftUiCore.progressLanguage(ordered, {seq,steps:[{sessionId:started.sessionId || started.sourceRef?.sessionId}]})
      const label = WeftUiCore.progressWaitingText(options.waiting, language)
      if(globalThis.WeftReplyMotion) WeftReplyMotion.status(text,label,true); else text.textContent=label
    })
    for (const block of groups) put(`steps-${block.seq}`, WeftUiCore.progressPosition(ordered, block, true), row => {
      block.steps = block.steps.map(step=>globalThis.WeftUiCore.executionPresentation(step,options.executions))
      const expandedForObjects = row.querySelector('details')?.open === true
      const currentForObjects = block.steps.filter(step => step.state === 'running').at(-1)
      row.progressDetails ||= new Map()
      for (const step of block.steps) {
        const seq = step.detailRef?.seq, cached = row.progressDetails.get(seq)
        if (cached && cached !== 'loading') {
          step.summary = block.language === 'en' ? globalThis.WeftUiCore.toolSummary(step.toolName, cached.arguments || step.arguments, block.language) : cached.summary; step.arguments = cached.arguments; step.interrupted = cached.interrupted
        } else if (Number.isSafeInteger(seq) && !cached && options.readDetail && (expandedForObjects || step === currentForObjects || step.state === 'failed')) {
          row.progressDetails.set(seq, 'loading')
          void options.readDetail(seq).then(data => {
            const args = globalThis.WeftUiCore.toolArguments(data.text)
            row.progressDetails.set(seq, Object.keys(args).length ? {summary: globalThis.WeftUiCore.toolSummary(step.toolName, args, block.language), arguments: args, interrupted: globalThis.WeftUiCore.interruptionFromDetail(data.text,step)} : {summary: step.summary})
            if (row.isConnected && row.dataset.signature === signature) { delete row.dataset.signature; renderCurrent() }
          }).catch(() => { row.progressDetails.set(seq, {summary: step.summary}) })
        }
      }
      const previous = row.querySelector('details')
      const stopView = options.stopViews?.[block.taskId]
      const outcome = globalThis.WeftUiCore.turnOutcome(ordered, block.taskId,stopView)
      const terminal = outcome.terminal || stopView?.terminal
      const lastBlock = groups.filter(group=>group.taskId===block.taskId).at(-1) === block
      const displayOutcome = (!lastBlock || options.quietFailure) && ['error','failed','blocked'].includes(outcome.reason) ? {...outcome,reason:'ended'} : outcome
      const tools = block.steps.filter(step=>step.toolName !== '__thinking')
      const thought = block.steps.filter(step=>step.toolName === '__thinking').at(-1)
      const current = block.steps.filter(step=>step.state === 'running').at(-1)
      const view = globalThis.WeftUiCore.progressText(tools, displayOutcome)
      if (current?.toolName === '__thinking' && !terminal) {view.text=current.summary;view.running=true}
      else if (!tools.length && thought) view.text = `思考过程 · ${Number.isFinite(thought.thinkingMs) ? Math.round(thought.thinkingMs/1000)+' 秒' : '用时未记录'}`
      if (stopView && !stopView.terminal) { view.text = `${view.text} · ${WeftUiCore.progressWaitingText(stopView.text, block.language)}`; view.running = true }
      // Keep completed work visible while a real native turn waits for its
      // next model/tool result. The stage comes from host state, not a timer
      // pretending that another tool is still running.
      if (options.waiting && !stopView && !terminal && !view.running && !view.failed &&
          block === groups.at(-1) && started && block.seq > started.seq &&
          block.steps.every(step => globalThis.WeftUiCore.executionState(step) === 'completed')) {
        view.text = WeftUiCore.progressWaitingText(options.waiting, block.language); view.running = true
      }
      const running = view.running
      const elapsed = running ? /\d+ (?:秒|s)$/.exec(options.waiting || '')?.[0] || `${Math.max(0,Math.floor((Date.now()-Date.parse(current?.at || started?.at))/1000)) || 0} ${block.language==='en'?'s':'秒'}` : ''
      if (running) view.text = view.text.replace(/\s*\d+ (?:秒|s)$/, '')
      const signature = JSON.stringify([block, outcome, stopView])
      row.dataset.running = String(running)
      if (row.dataset.signature === signature) {
        // A stage/timer update must not detach a focused or scrolling summary.
        const text = previous?.querySelector('.inline-progress-text')
        if (text) {if(globalThis.WeftReplyMotion)WeftReplyMotion.status(text,view.text,running,block.steps.length <= (globalThis.WeftMotion?.listLimit || 20));else if(text.textContent!==view.text)text.textContent=view.text}
        text?.classList.toggle('is-running', running)
        const timer = previous?.querySelector('.progress-elapsed'); if(timer)timer.textContent=elapsed
        const indicator = previous?.querySelector('.progress-indicator'); if(indicator)indicator.hidden=!running
        previous?.querySelector('summary')?.setAttribute('aria-label', `${view.text}${block.language === 'en' ? previous.open ? ', expanded' : ', collapsed' : previous.open ? '，已展开' : '，已收起'}`)
        return
      }
      row.dataset.signature = signature
      const focused = document.activeElement, focusStep = focused?.closest?.('.execution-step')?.dataset.step
      const hadFocus = row.contains?.(focused)
      const savedSteps = new Map([...row.querySelectorAll('.execution-step')].map(detail => [detail.dataset.step, detail]))
      const newFailure = view.failed && row.dataset.failed !== 'true'; row.dataset.failed = String(!!view.failed)
      const details = previous || node('details', 'execution-block')
      details.dataset.motion = 'enter-rise'
      details.open = newFailure || previous?.open === true
      row.dataset.running = String(running)
      row.classList.toggle('has-failure', !!view.failed)
      const summary = details.querySelector('summary') || node('summary', 'inline-progress-summary')
      summary.setAttribute('role', 'button')
      let indicator = summary.querySelector('.progress-indicator')
      if (!indicator) { indicator=node('span','progress-indicator');indicator.setAttribute('aria-hidden','true');indicator.append(node('i'),node('i'),node('i'));summary.prepend(indicator) }
      indicator.hidden = !running
      const text = summary.querySelector('.inline-progress-text') || node('span', 'inline-progress-text')
      if(globalThis.WeftReplyMotion)WeftReplyMotion.status(text,view.text,running,block.steps.length <= (globalThis.WeftMotion?.listLimit || 20));else text.textContent = view.text
      text.classList.toggle('is-running', running)
      text.setAttribute('aria-live', 'polite')
      if (!text.parentNode) summary.append(text)
      const timer = summary.querySelector('.progress-elapsed') || node('span','progress-elapsed');timer.textContent=elapsed
      if (!timer.parentNode)summary.append(timer)
      if (!summary.querySelector('.progress-chevron')) {
        const arrow = node('span', 'progress-chevron'); arrow.setAttribute('aria-hidden', 'true')
        if (window.WeftIcons) arrow.append(window.WeftIcons.create('chevron', 16))
        summary.append(arrow)
      }
      details.progressAccessibility = () => { summary.setAttribute('aria-expanded', String(details.open)); summary.setAttribute('aria-label', `${text.textContent}${block.language === 'en' ? details.open ? ', expanded' : ', collapsed' : details.open ? '，已展开' : '，已收起'}`) }
      if (!previous) details.addEventListener('toggle', () => { details.progressAccessibility(); if (details.open && details.isConnected) renderCurrent() }); details.progressAccessibility()
      const records = details.querySelector('.execution-records') || node('div', 'execution-records')
      records.dataset.motion = 'unfold'
      if (!summary.parentNode) details.append(summary)
      if (!records.parentNode) details.append(records)
      const savedGroups = new Map([...records.querySelectorAll('[data-step-group]')].map(detail => [detail.dataset.stepGroup, detail.open]))
      records.replaceChildren(...WeftUiCore.groupConsecutiveSteps(block.steps).map(group => {
        const children = group.steps.map(step => step.toolName === '__thinking' ? thinkingCard(step,savedSteps.get(String(step.stepId)),options) : globalThis.WeftTimelineCards.step(globalThis.WeftUiCore.stepPresentation(step,displayOutcome), savedSteps.get(String(step.stepId)), running, options))
        if (children.length === 1) return children[0]
        const detail = node('details', 'execution-step-group'), label = node('summary', '', group.summary)
        detail.dataset.stepGroup = String(group.steps[0].stepId)
        const newFailure = children.some(child => child.dataset.state === 'failed' && savedSteps.get(child.dataset.step)?.dataset.state !== 'failed')
        detail.open = newFailure || (savedGroups.get(detail.dataset.stepGroup) ?? children.some(child => child.open))
        const arrow = node('span', 'progress-chevron'); arrow.setAttribute('aria-hidden', 'true')
        arrow.append(window.WeftIcons.create('chevron', 16)); label.append(arrow)
        const body = node('div','execution-group-records');body.append(...children)
        detail.append(label, body)
        return detail
      }))
      const collapse = previous?.open && !details.open && block.steps.length <= 20 ? globalThis.WeftMotion?.snapshot(previous) : null
      if (!previous) row.replaceChildren(details)
      if (hadFocus) (focusStep ? [...records.querySelectorAll('.execution-step')].find(detail => detail.dataset.step === focusStep)?.querySelector('summary') : summary)?.focus({ preventScroll: true })
      globalThis.WeftMotion?.dismiss(collapse, true)
      if (details.open && block.steps.length <= 20) {
        let index = 0
        for (const step of details.querySelectorAll('.execution-step'))
          if (!savedSteps.has(step.dataset.step)) globalThis.WeftMotion?.reveal(step, 'fast', index++)
      }
    })
    for (const event of cards) {
      if (!/^(question\.|artifact\.|task\.queued)/.test(event.type)) continue
      const family = event.type.split('.')[0], data = { ...event.data, ...(family === 'artifact' ? options.artifacts?.find(artifact => artifact.artifactId === event.data?.artifactId) : {}) }
      const key = family === 'approval' ? data.approvalId : family === 'question' ? data.callId || data.stepId : data.artifactId || event.seq
      if (seen.has(`${family}-${key}`)) continue
      // A resolution updates the original card; it never moves the request.
      const start = ordered.find(e => e.type === `${family}.${family === 'approval' ? 'requested' : 'asked'}` &&
        (family === 'approval' ? e.data?.approvalId : e.data?.callId || e.data?.stepId) === key) || event
      put(`${family}-${key}`, start.seq, row => {
        row.dataset[`timeline${family[0].toUpperCase()}${family.slice(1)}`] = String(key)
        const resolved = ordered.find(e => e.seq > start.seq &&
          (family === 'approval' ? e.type === 'approval.resolved' && e.data?.approvalId === key
            : family === 'question' && e.type === 'question.answered' && (e.data?.callId || e.data?.stepId) === key))
        if (family === 'question') {
          const question = options.questions?.find(question => question.observedSeq === start.seq);
          row.hidden = question ? question.status === 'pending' : !resolved;
          row.className = 'timeline-entry question-record';
          row.replaceChildren();
          if (!row.hidden) row.append(node('span', '', question && globalThis.WeftQuestionBar ? WeftQuestionBar.record(question) : '已回答'));
          return;
        }
        if (family === 'artifact') {
          row.classList.add('artifact-bundle')
          row.artifactStatus ||= new Map()
          const files = (data.artifacts || [data]).map(file => ({...file,...options.artifacts?.find(item => item.artifactId === file.artifactId),...row.artifactStatus.get(file.artifactId)}))
          const outcome = globalThis.WeftUiCore.turnOutcome(ordered,data.taskId || data.completedStep?.taskId)
          if(outcome.terminal && options.readArtifact) for(const file of files) if(!row.artifactStatus.has(file.artifactId)) {
            row.artifactStatus.set(file.artifactId,{})
            void options.readArtifact(file.artifactId).then(result=>{
              if(!row.isConnected || result.item?.exists === undefined)return
              row.artifactStatus.set(file.artifactId,{exists:result.item.exists,...((result.item.location||result.item.path)?{path:result.item.location||result.item.path}:{})})
              delete row.dataset.artifactSignature;renderCurrent()
            }).catch(()=>{})
          }
          const signature = JSON.stringify(files)
          if (row.dataset.artifactSignature === signature) return
          row.dataset.artifactSignature = signature
          const saved = {expanded:row.querySelector('.artifact-summary')?.dataset.expanded === 'true'}
          row.replaceChildren(globalThis.WeftContent.artifactSummary(files,options,saved)); return
        }
        row.replaceChildren(node('strong', '', family === 'approval' ? resolved ? '审批已处理' : '需要审批'
          : family === 'question' ? resolved ? '已回答' : '需要补充信息' : family === 'artifact' ? data.fileName || '成果文件' : '排队中'))
        row.append(node('p', '', ({ 'allowed-once': '已允许本次', rejected: '已拒绝', cancelled: '已取消', unavailable: '已失效' })[resolved?.data?.outcome] || (family === 'question' ? data.questions?.map(q => q.question).join('\n') : '') || data.summary || ''))
      })
    }
    for (const [key, row] of existing) if (!seen.has(key)) row.remove()
  }
  window.WeftTimeline = { render, prepare, thinking }
})()
