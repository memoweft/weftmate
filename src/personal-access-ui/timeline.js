/* Desktop timeline renderer. Mobile maintains its own presentation bundle. */
(() => {
  'use strict'
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n }
  const elapsed = (ms) => ms < 1000 ? '不到 1 秒' : ms < 60000 ? `${Math.round(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.round(ms % 60000 / 1000)} 秒`
  function render(events, list, options = {}) {
    const { ordered, groups, cards } = globalThis.WeftUiCore.projectTimeline(events)
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
    for (const block of groups) put(`steps-${block.seq}`, block.seq, row => {
      const previous = row.querySelector('details'), wasRunning = row.dataset.running === 'true'
      const terminal = ordered.some(e => (e.type === 'task.ended' && e.data?.taskId === block.taskId) ||
        e.type === 'turn.ended' && block.taskId === `turn-${e.data?.turn}`)
      const running = !terminal && block.steps.some(s => s.state === 'running')
      const start = Math.min(...block.steps.map(s => Date.parse(s.at)).filter(Number.isFinite))
      const end = Math.max(...block.steps.map(s => Date.parse(s.endAt || s.at)).filter(Number.isFinite))
      const signature = JSON.stringify([block, terminal, running])
      if (row.dataset.signature === signature) return
      row.dataset.signature = signature
      const savedSteps = new Map([...row.querySelectorAll('.execution-step')].map(detail => [detail.dataset.step, detail]))
      const details = node('details', 'execution-block')
      details.open = previous ? wasRunning && !running ? false : running && !wasRunning ? !options.mobile : previous.open : running && !options.mobile
      row.dataset.running = String(running)
      const summary = node('summary', '', `${running ? '正在执行' : '执行了'} ${block.steps.length} 步${!running && Number.isFinite(end - start) ? ` · 用时 ${elapsed(end - start)}` : ''}`)
      summary.prepend(window.WeftIcons.create('chevron', 16))
      details.append(summary)
      for (const step of block.steps) details.append(globalThis.WeftTimelineCards.step(step, savedSteps.get(String(step.stepId)), running, options))
      const collapse = previous?.open && !details.open && block.steps.length <= 20 ? globalThis.WeftMotion?.snapshot(previous) : null
      row.replaceChildren(details)
      globalThis.WeftMotion?.details(details)
      globalThis.WeftMotion?.dismiss(collapse, true)
      if (details.open && block.steps.length <= 20) {
        let index = 0
        for (const step of details.querySelectorAll('.execution-step'))
          if (!savedSteps.has(step.dataset.step)) globalThis.WeftMotion?.reveal(step, 'fast', index++)
      }
    })
    for (const event of cards) {
      if (!/^(approval\.|question\.|artifact\.|task\.queued)/.test(event.type)) continue
      const data = event.data || {}, family = event.type.split('.')[0]
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
