import { randomUUID } from 'node:crypto'

const errorCodes = {
  'session/agent-busy': 'agent-busy',
  'session/writer-held': 'session-conflict',
  'session/attachment-invalid': 'attachment-error',
  'gateway/cancelled': 'cancelled',
  'gateway/internal': 'internal',
}

function failure(error) {
  return { result: { ok: false, error: {
    code: errorCodes[error?.code] ?? error?.code?.replaceAll('/', '-') ?? 'internal',
    message: error?.message ?? 'DSH request failed',
    details: error?.details ?? {},
  } } }
}

async function response(action) {
  try { return { result: { ok: true, value: await action() } } }
  catch (error) { return failure(error) }
}

function namespaceView(view) {
  if (!['agent-presets', 'agent-preset-registry'].includes(view.ns)) return view
  const result = { ...view }
  for (const layer of ['value', 'base', 'user']) {
    const value = view[layer]
    if (value && ('selectedDefault' in value || 'default' in value)) {
      const selected = Object.hasOwn(value, 'selectedDefault') ? value.selectedDefault : value.default
      result[layer] = { ...value, selectedDefault: selected, default: selected }
    }
  }
  return result
}

/** Adapt the composed Typert runtime to the existing in-process client contract. */
export function createTypertAdapterClient(ctx) {
  const gateway = ctx.typertGateway ?? ctx.get?.('typertGateway')
  if (typeof gateway?.invoke !== 'function') throw new TypeError('DSH typertGateway is required')
  const lifetime = new AbortController()
  const peer = ctx.connection?.createPeer({ principal: { kind: 'owner' }, interactions: 'answer' })
    ?? { id: randomUUID(), ctx, principal: { kind: 'owner' }, interactions: 'answer', signal: lifetime.signal }
  const invoke = (namespace, method, args = {}, signal) => gateway.invoke({ namespace, method, args, peer, signal })
  const call = (namespace, method, request = {}) => response(() => invoke(namespace, method, { request }))
  const attachments = new Map()
  const pending = new Map()
  const asked = new Map()
  const resolvedApprovals = new Set()
  const mux = new Set()
  const host = new Set()
  const disposers = []
  const publish = (subscribers, frame) => { for (const subscriber of subscribers) subscriber.push(frame) }
  const on = (name, listener, options) => {
    const dispose = ctx.on?.(name, listener, options)
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  function remember(sessionId, records) {
    for (const record of records) {
      const event = record.event ?? record
      if (!['user/message', 'assistant/message'].includes(event.type)) continue
      for (const part of (event.data?.message ?? event.data)?.content ?? []) {
        const ref = part?.attachment
        if (part.type === 'image' && ref?.attachmentId && ref.mediaType && ref.bytes > 0 && ref.width > 0 && ref.height > 0) {
          if (!attachments.has(sessionId)) attachments.set(sessionId, new Map())
          attachments.get(sessionId).set(ref.attachmentId, ref)
        }
      }
    }
  }
  async function history({ sessionId, beforeSeq, maxMessages }, signal) {
    const page = await invoke('session', 'events', { request: {
      address: { kind: 'session', sessionId },
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      ...(maxMessages === undefined ? {} : { maxMessages }),
    } }, signal)
    remember(sessionId, page.records)
    return { events: page.records, hasMore: page.hasMore, cursor: page.cursor }
  }
  function settled(rpcId, outcome) {
    const entry = pending.get(rpcId)
    if (!entry) return
    pending.delete(rpcId)
    entry.request.signal?.removeEventListener('abort', entry.abort)
    publish(mux, { rpcId, payload: { type: `${entry.kind}/resolved`, sessionId: entry.sessionId,
      ...(entry.kind === 'approval' ? { approvalId: entry.approvalId, outcome }
        : { questionRpcId: rpcId, outcome: outcome === undefined ? 'cancelled' : 'answered' }) } })
    if (entry.kind === 'approval') resolvedApprovals.add(`${entry.sessionId}:${entry.approvalId}`)
    entry.resolve(outcome)
  }
  on('session/event', (session, event) => {
    const sessionId = session.id
    remember(sessionId, [event])
    publish(mux, { payload: { type: 'session/event', sessionId, event } })
    if (event.type === 'approval/asked') {
      if (!asked.has(sessionId)) asked.set(sessionId, new Map())
      asked.get(sessionId).set(event.data.id, event.data)
    }
    if (event.type === 'approval/decided') {
      asked.get(sessionId)?.delete(event.data.id)
      const match = [...pending].find(([, entry]) => entry.sessionId === sessionId && entry.approvalId === event.data.id)
      if (match) settled(match[0], event.data.outcome)
      else if (!resolvedApprovals.delete(`${sessionId}:${event.data.id}`)) {
        publish(mux, { payload: { type: 'approval/resolved', sessionId, approvalId: event.data.id, outcome: event.data.outcome } })
      }
    }
  })
  for (const [eventName, kind] of [['approval/request', 'approval'], ['user-questions/request', 'question']]) {
    on(eventName, (request, next) => {
      const session = request.agent?.session
      if (!session || mux.size === 0 || request.signal?.aborted) return next()
      const rpcId = randomUUID(), sessionId = session.id
      const audit = kind === 'approval' ? [...(asked.get(sessionId)?.values() ?? [])].findLast(item =>
        item.toolName === request.toolName && item.callId === request.callId) : undefined
      const approvalId = audit?.id ?? rpcId
      const payload = { type: `${kind}/requested`, sessionId,
        ...(kind === 'approval' ? { approvalId, toolName: request.toolName, reason: request.reason, callId: request.callId }
          : { questions: request.questions }) }
      return new Promise(resolve => {
        const abort = () => settled(rpcId, kind === 'approval' ? 'cancelled' : undefined)
        pending.set(rpcId, { kind, sessionId, approvalId, request, resolve, abort, payload })
        request.signal?.addEventListener('abort', abort, { once: true })
        publish(mux, { rpcId, payload })
      })
    }, { prepend: true })
  }
  for (const [event, type, project] of [
    ['api-session/added', 'host/session-added', summary => ({ sessionId: summary.sessionId, summary })],
    ['api-session/removed', 'host/session-removed', sessionId => ({ sessionId })],
    ['api-session/status', 'host/session-status', (sessionId, running) => ({ sessionId, running })],
    ['api-session/activity', 'host/session-activity', (sessionId, updatedAt) => ({ sessionId, updatedAt })],
    ['api-session/error', 'host/agent-error', (sessionId, message) => ({ sessionId, message })],
  ]) on(event, (...args) => publish(host, { payload: { type, ...project(...args) } }))

  function subscribe(subscribers, signal, baseline) {
    const queue = []
    const subscribed = new Set()
    const replay = baseline ? [...pending] : []
    const readSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
    let wake, closed = false
    const subscriber = { push(frame) {
      if (closed) return
      const payload = frame.payload
      if (payload.type === 'session/event' && !subscribed.has(payload.sessionId)) {
        subscribed.add(payload.sessionId)
        queue.push({ payload: { type: 'session/subscribed', sessionId: payload.sessionId, lastSeq: payload.event.seq - 1 } })
      }
      queue.push(frame); wake?.()
    } }
    const close = () => {
      if (closed) return
      closed = true
      subscribers.delete(subscriber)
      signal?.removeEventListener('abort', close)
      lifetime.signal.removeEventListener('abort', close)
      if (subscribers === mux && mux.size === 0) {
        for (const [rpcId, entry] of pending) settled(rpcId, entry.kind === 'approval' ? 'unavailable' : undefined)
      }
      wake?.()
    }
    subscribers.add(subscriber)
    signal?.addEventListener('abort', close, { once: true })
    lifetime.signal.addEventListener('abort', close, { once: true })
    if (signal?.aborted || lifetime.signal.aborted) close()
    const iterator = (async function* () {
      try {
        if (closed) return
        if (baseline) {
          const { items } = await invoke('session', 'list', { _request: {} }, readSignal)
          for (const item of items) {
            const sessionId = item.sessionId
            if (subscribed.has(sessionId)) continue
            const live = ctx.sessions?.get(sessionId)
            const lastSeq = live ? live.events.at(-1)?.seq ?? -1 : (await history({ sessionId, maxMessages: 1 }, readSignal)).cursor
            if (closed) return
            if (subscribed.has(sessionId)) continue
            subscribed.add(sessionId)
            yield { payload: { type: 'session/subscribed', sessionId, lastSeq } }
          }
          for (const [rpcId, entry] of replay) if (pending.has(rpcId)) yield { rpcId, payload: entry.payload }
        }
        while (!closed) {
          if (queue.length) yield queue.shift()
          else await new Promise(resolve => { wake = resolve })
        }
      } finally { close() }
    })()
    return { [Symbol.asyncIterator]() { return this }, next: () => iterator.next(),
      return() { close(); return iterator.return() } }
  }
  ctx.effect?.(() => () => {
    lifetime.abort()
    for (const dispose of disposers) dispose()
    attachments.clear()
    return peer.dispose?.()
  }, 'weftmate Typert adapter')

  let registryOnly
  async function describeSettings() {
    const value = await invoke('settings', 'describe')
    registryOnly = value.namespaces.some(item => item.ns === 'agent-preset-registry') &&
      !value.namespaces.some(item => item.ns === 'agent-presets')
    const namespaces = value.namespaces.map(namespaceView)
    if (registryOnly) namespaces.push({ ...namespaces.find(item => item.ns === 'agent-preset-registry'), ns: 'agent-presets' })
    return { ...value, namespaces }
  }
  const settings = { describe: () => response(describeSettings) }
  for (const [method, field] of [['update', 'patch'], ['replace', 'section'], ['mutate', 'ops']]) {
    settings[method] = request => response(async () => {
      let ns = request.ns, input = request[field]
      if (['agent-presets', 'agent-preset-registry'].includes(ns)) {
        if (registryOnly === undefined) await describeSettings()
        if (registryOnly) {
          ns = 'agent-preset-registry'
          if (field === 'ops') input = input.map(op => ({ ...op, path: op.path.map((part, index) => index === 0 && part === 'default' ? 'selectedDefault' : part) }))
          else if (Object.hasOwn(input, 'default')) {
            const { default: selectedDefault, ...rest } = input
            input = { ...rest, selectedDefault }
          }
        }
      }
      return namespaceView(await invoke('settings', method, { ns, [field]: input,
        ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }) }))
    })
  }
  const sessions = {
    list: (request = {}) => response(async () => {
      const value = await invoke('session', 'list', { _request: request })
      return { ...value, items: value.items.map(item => ({ ...item,
        title: item.title ?? item.projections?.values?.title ?? '新对话' })) }
    }),
    history: request => response(() => history(request)),
    prompt: async request => {
      const requestId = request.requestId ?? randomUUID()
      return { ...await call('session', 'prompt', { ...request, requestId }), rpcId: requestId }
    },
    attachment: ({ sessionId, attachmentId }) => response(async () => {
      remember(sessionId, ctx.sessions?.get(sessionId)?.events ?? [])
      let beforeSeq
      while (!attachments.get(sessionId)?.has(attachmentId)) {
        const page = await history({ sessionId, beforeSeq })
        if (!page.hasMore) break
        const earliest = Math.min(...page.events.map(record => record.event.seq))
        if (!Number.isFinite(earliest) || beforeSeq !== undefined && earliest >= beforeSeq) break
        beforeSeq = earliest
      }
      const attachment = attachments.get(sessionId)?.get(attachmentId)
      if (!attachment) throw { code: 'session/attachment-invalid', details: { reason: 'INVALID_IMAGE' } }
      return invoke('session', 'attachment', { request: { sessionId, attachment } })
    }),
    models: ({ sessionId }) => response(async () => {
      const catalog = await invoke('session', 'modelCatalog')
      const resolved = await ctx.sessionController?.resolveAgent(sessionId)
      if (resolved?.error) throw resolved.error
      const agent = resolved?.agent ?? resolved ?? ctx.agents?.get(sessionId)
      const current = await agent?.model?.current() ?? catalog.default
      return { current, routable: catalog.groups.some(group => group.id === current?.provider && group.models.some(model => model.id === current.model)),
        groups: catalog.groups, failures: catalog.failures }
    }),
  }
  for (const method of ['create', 'rename', 'cancel', 'selectModel']) sessions[method] = request => call('session', method, request)
  const workspace = {
    list: () => response(async () => {
      const registry = ctx.workspaceRegistry
      let value
      if (registry) value = { items: await registry.list(), archivedSessionIds: registry.archivedSessionIds, pinnedSessionIds: registry.pinnedSessionIds }
      else {
        const control = new AbortController()
        const stream = await gateway.stream({ namespace: 'workspace', method: 'follow', args: {}, peer, signal: control.signal })
        const iterator = stream[Symbol.asyncIterator]()
        try { value = (await iterator.next()).value?.value }
        finally { control.abort(); await iterator.return?.() }
      }
      return { items: value.items.map(ws => ({ workspaceId: ws.id ?? ws.workspaceId, path: ws.path, title: ws.title,
        sessionIds: [...ws.sessionIds], createdAt: ws.createdAt, updatedAt: ws.updatedAt })),
      archivedSessionIds: [...(value.archivedSessionIds ?? [])], pinnedSessionIds: [...(value.pinnedSessionIds ?? [])] }
    }),
  }
  for (const method of ['create', 'rename', 'delete']) workspace[method] = request => call('workspace', method, request)
  return {
    sessions, workspace, settings,
    llm: { models: () => response(() => invoke('session', 'modelCatalog')) },
    skills: { list: request => call('skills', 'list', request) },
    host: {},
    events: { mux: (_request, signal) => subscribe(mux, signal, true), host: (_request, signal) => subscribe(host, signal, false) },
    async respond({ type, rpcId, result } = {}) {
      const entry = pending.get(rpcId)
      if (!entry) return { accepted: false, reason: 'not-pending' }
      const value = result?.value
      if (type !== 'client-response' || result?.ok !== true || value?.sessionId !== entry.sessionId ||
        (entry.kind === 'approval' ? value.approvalId !== entry.approvalId || !['allowed-once', 'rejected'].includes(value.outcome)
          : !validAnswer(value.answer, entry.request.questions))) return { accepted: false, reason: 'bad-response' }
      settled(rpcId, entry.kind === 'approval' ? value.outcome : value.answer)
      return { accepted: true }
    },
  }
}

function validAnswer(answer, questions) {
  if (!answer || !Array.isArray(answer.answers) || Object.keys(answer).some(key => key !== 'answers')) return false
  const ids = new Set()
  return answer.answers.length === questions.length && answer.answers.every(item => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || !questions.some(question => question.id === item.id) ||
      !Array.isArray(item.selected) || !item.selected.every(value => typeof value === 'string') ||
      item.custom !== undefined && typeof item.custom !== 'string' ||
      Object.keys(item).some(key => !['id', 'selected', 'custom'].includes(key))) return false
    ids.add(item.id)
    return true
  })
}
