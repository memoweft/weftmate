/* Desktop timeline renderer. Mobile maintains its own presentation bundle. */
(() => {
  'use strict'
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n }
  function render(events, list, options = {}) {
    list.progressRender = { events, options }
    const renderCurrent = () => { const current = list.progressRender; render(current.events, list, current.options) }
    const { ordered, groups, cards } = globalThis.WeftUiCore.projectTimeline(events, options.approvals || [])
    const existing = new Map([...list.children].filter(n => n.dataset.timeline).map(n => [n.dataset.timeline, n]))
    const seen = new Set()
    const put = (key, seq, build) => {
      seen.add(key); let row = existing.get(key)
      if (!row) { row = node(options.tag || 'li', 'timeline-entry'); row.dataset.timeline = key; existing.set(key, row) }
      row.dataset.seq = String(seq); build(row)
      const before = [...list.children].find(n => n !== row && Number(n.dataset.seq) > seq)
      if (before) list.insertBefore(row, before); else if (!row.parentNode) list.append(row)
      return row
    }
    const started = ordered.filter(event => event.type === 'turn.started').at(-1)
    const waiting = options.waiting && started && !ordered.some(event => event.seq > started.seq &&
      (event.type.startsWith('step.') || event.type === 'assistant.message' && event.data?.text))
    if (waiting) put('waiting', Math.max(started.seq, ...ordered.filter(event => event.type === 'user.message' && event.seq > started.seq).map(event => event.seq)) + 0.1, row => {
      row.classList.add('inline-waiting'); row.setAttribute('role', 'status')
      if (row.textContent !== options.waiting) row.replaceChildren(node('span', 'inline-progress-text is-running', options.waiting))
    })
    for (const block of groups) put(`steps-${block.seq}`, block.seq, row => {
      const expandedForObjects = row.querySelector('details')?.open === true
      const currentForObjects = block.steps.filter(step => step.state === 'running').at(-1)
      row.progressDetails ||= new Map()
      for (const step of block.steps) {
        const seq = step.detailRef?.seq, cached = row.progressDetails.get(seq)
        if (cached && cached !== 'loading') {
          step.summary = cached.summary; step.arguments = cached.arguments
        } else if (Number.isSafeInteger(seq) && !cached && options.readDetail && (expandedForObjects || step === currentForObjects)) {
          row.progressDetails.set(seq, 'loading')
          void options.readDetail(seq).then(data => {
            const args = globalThis.WeftUiCore.toolArguments(data.text)
            row.progressDetails.set(seq, Object.keys(args).length ? {summary: globalThis.WeftUiCore.toolSummary(step.toolName, args), arguments: args} : {summary: step.summary})
            if (row.isConnected && row.dataset.signature === signature) { delete row.dataset.signature; renderCurrent() }
          }).catch(() => { row.progressDetails.set(seq, {summary: step.summary}) })
        }
      }
      const previous = row.querySelector('details')
      const terminal = ordered.some(e => (e.type === 'task.ended' && e.data?.taskId === block.taskId) ||
        e.type === 'turn.ended' && block.taskId === `turn-${e.data?.turn}`)
      const view = globalThis.WeftUiCore.progressText(block.steps, terminal)
      // Keep completed work visible while a real native turn waits for its
      // next model/tool result. The stage comes from host state, not a timer
      // pretending that another tool is still running.
      if (options.waiting && !terminal && !view.running && !view.failed &&
          block === groups.at(-1) && started && block.seq > started.seq &&
          !block.steps.some(step => globalThis.WeftUiCore.executionState(step) === 'cancelled')) {
        view.text += ` · ${options.waiting}`; view.running = true
      }
      const running = view.running
      const signature = JSON.stringify([block, terminal, view])
      if (row.dataset.signature === signature) return
      row.dataset.signature = signature
      const focused = document.activeElement, focusStep = focused?.closest?.('.execution-step')?.dataset.step
      const hadFocus = row.contains?.(focused)
      const savedSteps = new Map([...row.querySelectorAll('.execution-step')].map(detail => [detail.dataset.step, detail]))
      const newFailure = block.steps.some(step => step.state === 'failed' && savedSteps.get(String(step.stepId))?.dataset.state !== 'failed')
      const details = node('details', 'execution-block')
      details.open = newFailure || previous?.open === true
      row.dataset.running = String(running)
      row.classList.toggle('has-failure', !!view.failed)
      const summary = node('summary', 'inline-progress-summary')
      summary.setAttribute('role', 'button')
      const text = node('span', 'inline-progress-text', view.text)
      text.classList.toggle('is-running', running)
      text.setAttribute('aria-live', 'polite')
      summary.append(text)
      const arrow = node('span', 'progress-chevron'); arrow.setAttribute('aria-hidden', 'true')
      if (window.WeftIcons) arrow.append(window.WeftIcons.create('chevron', 16))
      summary.append(arrow)
      const accessibility = () => { summary.setAttribute('aria-expanded', String(details.open)); summary.setAttribute('aria-label', `${view.text}，${details.open ? '已展开' : '已收起'}`) }
      details.addEventListener('toggle', () => { accessibility(); if (details.open && details.isConnected) renderCurrent() }); accessibility()
      const records = node('div', 'execution-records')
      details.append(summary, records)
      for (const step of block.steps) records.append(globalThis.WeftTimelineCards.step(step, savedSteps.get(String(step.stepId)), running, options))
      const collapse = previous?.open && !details.open && block.steps.length <= 20 ? globalThis.WeftMotion?.snapshot(previous) : null
      row.replaceChildren(details)
      if (hadFocus) (focusStep ? [...records.querySelectorAll('.execution-step')].find(detail => detail.dataset.step === focusStep)?.querySelector('summary') : summary)?.focus({ preventScroll: true })
      globalThis.WeftMotion?.details(details)
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
        row.replaceChildren(node('strong', '', family === 'approval' ? resolved ? '审批已处理' : '需要审批'
          : family === 'question' ? resolved ? '已回答' : '需要补充信息' : family === 'artifact' ? data.fileName || '成果文件' : '排队中'))
        if (family === 'artifact') globalThis.WeftTimelineCards.artifact(row, data, options)
        else row.append(node('p', '', ({ 'allowed-once': '已允许本次', rejected: '已拒绝', cancelled: '已取消', unavailable: '已失效' })[resolved?.data?.outcome] || (family === 'question' ? data.questions?.map(q => q.question).join('\n') : '') || data.summary || ''))
      })
    }
    for (const [key, row] of existing) if (!seen.has(key)) row.remove()
  }
  window.WeftTimeline = { render }
})()
