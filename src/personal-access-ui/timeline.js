/* Shared timeline renderer. The mobile bundle carries the same source. */
(() => {
  'use strict'
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n }
  const elapsed = (ms) => ms < 1000 ? '不到 1 秒' : ms < 60000 ? `${Math.round(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.round(ms % 60000 / 1000)} 秒`
  function render(events, list, options = {}) {
    const ordered = [...events].sort((a, b) => a.seq - b.seq), groups = [], steps = new Map()
    let group = null
    for (const raw of ordered) {
      const event = raw.type === 'artifact.created' && raw.data?.completedStep ? { ...raw, type: 'step.completed', data: raw.data.completedStep } : raw
      if (event.type.startsWith('step.')) {
        const data = event.data || {}, key = `${data.taskId}/${data.stepId}`
        let step = steps.get(key)
        if (!step) {
          if (!group || group.taskId !== data.taskId) { group = { seq: event.seq, taskId: data.taskId, steps: [] }; groups.push(group) }
          step = { ...data, at: event.at, endAt: event.type === 'step.completed' ? event.at : null }; group.steps.push(step); steps.set(key, step)
        } else { Object.assign(step, data); if (event.type === 'step.completed') step.endAt = event.at }
        if (raw.type === 'artifact.created') group = null
      } else if (!['turn.started', 'turn.ended', 'task.started', 'task.ended'].includes(event.type)) group = null
    }
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
      const details = node('details', 'execution-block')
      details.open = previous ? wasRunning && !running ? false : running && !wasRunning ? !options.mobile : previous.open : running && !options.mobile
      row.dataset.running = String(running)
      const summary = node('summary', '', `${running ? '正在执行' : '执行了'} ${block.steps.length} 步${!running && Number.isFinite(end - start) ? ` · 用时 ${elapsed(end - start)}` : ''}`)
      details.append(summary)
      const labels = { read: '读取文件', read_file: '读取文件', personal_read_project_file: '读取文件', shell: '运行命令', bash: '运行命令', pwsh: '运行命令', exec_command: '运行命令' }
      const runs = []
      for (const step of block.steps) { const hint = step.groupHint || step.toolName || 'tool'; const kind = labels[hint] || `执行工具 ${hint}`
        const last = runs.at(-1); if (last?.kind === kind) last.steps.push(step); else runs.push({ kind, steps: [step] }) }
      for (const run of runs) {
        let holder = details
        if (run.steps.length > 1) { holder = node('details', 'execution-same-type'); holder.open = running && !options.mobile
          holder.append(node('summary', '', `${run.kind} · ${run.steps.length} 步`)); details.append(holder) }
      for (const step of run.steps) {
        const detail = node('details', 'execution-step'), label = node('summary', '', `${step.summary || '工具执行'}${step.state === 'failed' ? ' · 未完成' : step.state === 'running' && running ? ' · 运行中' : ''}`)
        const output = node('pre', 'timeline-raw'), copy = node('button', 'timeline-action', '复制')
        copy.type = 'button'; copy.hidden = true
        copy.addEventListener('click', async () => { try { if (options.copyText) await options.copyText(output.textContent); else await navigator.clipboard.writeText(output.textContent); copy.textContent = '已复制' } catch { copy.textContent = '复制未完成' } })
        detail.append(label, output, copy)
        detail.addEventListener('toggle', async () => {
          if (!detail.open || detail.dataset.loaded || !step.detailRef) return
          detail.dataset.loaded = 'loading'; output.textContent = '正在读取…'
          try { const data = await options.readDetail(step.detailRef.seq)
            output.textContent = `${data.text || ''}${data.truncated ? '\n[内容已截断]' : ''}`; copy.hidden = false; detail.dataset.loaded = 'true'
          } catch { output.textContent = '暂时无法读取，收起后可重试。'; delete detail.dataset.loaded }
        })
        holder.append(detail)
      }
      }
      row.replaceChildren(details)
    })
    const cards = ordered.flatMap(event => event.type === 'artifact.created' && event.data?.artifacts?.length
      ? event.data.artifacts.map(artifact => ({ ...event, data: { ...event.data, ...artifact } })) : [event])
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
        if (family === 'artifact') {
          row.append(node('p', '', `${data.contentType || '文件'} · ${data.size || 0} 字节`))
          const open = node('button', 'timeline-action', '打开成果'); open.type = 'button'
          open.addEventListener('click', () => options.openArtifact?.(data, open)); row.append(open)
          if (options.downloadArtifact) { const download = node('button', 'timeline-action', '下载'); download.type = 'button'
            download.addEventListener('click', () => options.downloadArtifact(data)); row.append(download) }
        } else row.append(node('p', '', ({ 'allowed-once': '已允许本次', rejected: '已拒绝', cancelled: '已取消', unavailable: '已失效' })[resolved?.data?.outcome] || (family === 'question' ? data.questions?.map(q => q.question).join('\n') : '') || data.summary || ''))
      })
    }
    for (const [key, row] of existing) if (!seen.has(key)) row.remove()
  }
  window.WeftTimeline = { render }
})()
