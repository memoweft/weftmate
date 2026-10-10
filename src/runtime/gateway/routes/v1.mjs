import { createDshAgentAdapter, createNativeQuestionSnapshots, questionSourceAsOf } from '../../dsh-adapter/agents.mjs'
import { createDshModelAdapter } from '../../dsh-adapter/models.mjs'
import { createDshPermissionAdapter } from '../../dsh-adapter/permissions.mjs'
import { createDshSessionAdapter, DshAdapterError } from '../../dsh-adapter/sessions.mjs'
import { createDshWorkspaceAdapter } from '../../dsh-adapter/workspace.mjs'
import { createDiagnostics } from '../diagnostics.mjs'
import { gatewayError, writeJson } from '../errors/gateway-error.mjs'
import { beginSse, sseEvent } from '../event-stream/sse.mjs'

const BASE = '/weftmate/api/v1'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

async function readJson(req, limit = 65_536) {
  const chunks = []; let bytes = 0
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw new Error('body-too-large'); chunks.push(chunk) }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function requestAllowed(req) {
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try { return new URL(origin).origin === `http://${req.headers.host}` } catch { return false }
  }
  return LOOPBACK.has(req.socket?.remoteAddress ?? '')
}

function idFor(rawSeq, fallback) { return Number.isInteger(rawSeq) ? `dsh-${rawSeq}` : `gateway-${fallback}` }

/** Accept the product's text convenience payload and the pinned Gateway
 * contract's DSH-style text parts, then collapse both at the renderer boundary.
 * No arbitrary content block is forwarded through this narrow stage-1 surface. */
function promptContent(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) throw new TypeError('invalid prompt content')
  const images = value.filter((part) => part?.type === 'image')
  if (images.length > 4 || value.some((part) => part?.type === 'text'
    ? typeof part.text !== 'string' || part.text.length > 32_000
    : part?.type === 'image' ? !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.mediaType) ||
      typeof part.data !== 'string' || part.data.length > 7_000_000 ||
      (part.name !== undefined && (typeof part.name !== 'string' || part.name.length > 120))
      : true)) throw new TypeError('invalid prompt content')
  if (!images.length) return value.map((part) => part.text).join('')
  return value
}

export function createGatewayV1({ client, readLog, lifecycle, diagnostics: diagnosticsDeps } = {}) {
  if (client === undefined) throw new TypeError('supported DSH client is required')
  const sessions = createDshSessionAdapter(client, { readLog, lifecycle })
  const agents = createDshAgentAdapter(sessions)
  const workspaces = createDshWorkspaceAdapter(client)
  const models = createDshModelAdapter(client)
  const permissions = createDshPermissionAdapter(client)
  const diagnostics = diagnosticsDeps === undefined ? null : createDiagnostics({ client, ...diagnosticsDeps })
  const records = new Map()
  const questions = createNativeQuestionSnapshots({ readSourceAsOf: async (sessionId, observedSeq) =>
    questionSourceAsOf(await sessions.questionHistoryAsOf(sessionId, observedSeq), observedSeq) })
  let questionPump = null
  let capture = null
  const operations = new Set()

  function ensureQuestionPump() {
    if (questionPump) return questionPump.ready
    const controller = new AbortController(), connection = questions.beginConnection()
    let resolveReady, rejectReady, first = true
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    const owned = { controller, connection, ready }
    questionPump = owned
    void (async () => {
      try {
        for await (const frame of agents.openMux(controller.signal)) {
          questions.observe(frame, connection)
          if (first) { first = false; resolveReady() }
        }
        if (first) rejectReady(new Error('native question stream unavailable'))
      } catch (error) { if (first) rejectReady(error) }
      finally {
        questions.connectionLost(connection)
        if (questionPump === owned) questionPump = null
      }
    })()
    ready.catch(() => {})
    return ready
  }

  function record(sessionId) {
    const value = records.get(sessionId)
    if (!value) throw Object.assign(new Error('unknown session'), { code: 'session-not-found' })
    return value
  }
  function emit(sessionId, normalized) {
    const entry = record(sessionId)
    // A mux also carries global/control frames.  Never attach an unscoped raw
    // frame to whichever Gateway session happened to subscribe first.
    if (normalized.sessionId !== sessionId) return
    const event = {
      v: 1, id: idFor(normalized.rawSeq, entry.nextId++), type: normalized.type,
      at: new Date().toISOString(), sessionId, turn: normalized.turn ?? null,
      data: { sessionId, turn: normalized.turn ?? null, ...normalized.data },
      rawType: normalized.rawType,
      ...(Number.isInteger(normalized.rawSeq) ? { rawSeq: normalized.rawSeq } : {}),
      ...(normalized.rawTime !== undefined ? { rawTime: normalized.rawTime } : {}),
    }
    if (entry.events.some((candidate) => candidate.id === event.id)) return
    entry.events.push(event)
    for (const res of entry.listeners) res.write(sseEvent(event))
  }
  async function reconcile(sessionId, raw) {
    const entry = record(sessionId)
    const result = await agents.reconcile(raw, { sessionId, lastSeq: entry.lastSeq, state: entry.state })
    entry.lastSeq = result.lastSeq; entry.state = result.state
    sessions.noteReplayCursor(sessionId, result.lastSeq)
    for (const event of result.events) emit(sessionId, event)
  }
  async function pump(sessionId, signal) {
    try {
      for await (const frame of agents.openMux(signal)) {
        // Only `session/event` envelopes carry a durable log seq.  Control /
        // projection frames borrow the projected event's seq as a watermark;
        // stripping it here keeps that number from ever driving the replay
        // cursor, dedupe keys, or public event ids.
        const payload = frame?.payload
        if (
          payload !== null && typeof payload === 'object'
          && payload.type !== 'session/event' && Number.isInteger(payload.seq)
        ) {
          await reconcile(sessionId, [{ ...frame, payload: { ...payload, seq: undefined } }])
        } else {
          await reconcile(sessionId, [frame])
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        const safe = await gatewayError(error)
        // Safe code only: useful when a pinned runtime closes the mux after a
        // live interaction, without carrying a tool payload or credential to
        // Electron's product surface.
        console.error(`[weftmate] stage-1 mux closed: ${safe.code}`)
        diagnostics?.recordError(safe.code, safe.details?.digest ?? null)
        emit(sessionId, { type: 'error', sessionId, data: safe, rawType: 'gateway/mux' })
        throw error
      }
    }
  }
  async function dispatch(req, res) {
    if (!requestAllowed(req)) return writeJson(res, 403, { error: { code: 'origin-forbidden', message: 'Gateway request failed' } })
    const requestUrl = new URL(req.url ?? '/', 'http://gateway')
    const pathname = decodeURIComponent(requestUrl.pathname)
      const match = /^\/weftmate\/api\/v1\/sessions\/([^/]+)(?:\/(resume|messages|cancel|events|models|approval|history|source|stop-state|rename|fork|memory-cleanup|memory-boundaries|chat-handoff|storage))?$/.exec(pathname)
    const attachmentMatch = /^\/weftmate\/api\/v1\/sessions\/([^/]+)\/attachments\/(sha256:[a-f0-9]{64})$/.exec(pathname)
    const questionMatch = /^\/weftmate\/api\/v1\/sessions\/([^/]+)\/questions(?:\/([0-9a-f-]{36}))?$/i.exec(pathname)
    const workspaceMatch = /^\/weftmate\/api\/v1\/workspaces\/([^/]+)$/.exec(pathname)
    try {
      if (pathname === `${BASE}/sessions` && req.method === 'POST') {
        const payload = await readJson(req); const created = await sessions.create(payload)
        records.set(created.sessionId, { events: [], listeners: new Set(), state: undefined, lastSeq: -1, nextId: 1 })
        emit(created.sessionId, { type: 'session.created', sessionId: created.sessionId, data: { id: created.sessionId }, rawType: 'gateway/create' })
        return writeJson(res, 201, { sessionId: created.sessionId })
      }
      if (pathname === `${BASE}/sessions` && req.method === 'GET') {
        return writeJson(res, 200, { items: await sessions.list() })
      }
      if (pathname === `${BASE}/workspaces` && req.method === 'GET') {
        return writeJson(res, 200, await workspaces.list())
      }
      if (pathname === `${BASE}/workspaces` && req.method === 'POST') {
        const payload = await readJson(req); const result = await workspaces.create(payload)
        return writeJson(res, result.created ? 201 : 200, result)
      }
      if (workspaceMatch && req.method === 'PATCH') {
        const payload = await readJson(req); const result = await workspaces.rename({ workspaceId: workspaceMatch[1], title: payload.title })
        return writeJson(res, 200, result)
      }
      if (workspaceMatch && req.method === 'DELETE') {
        return writeJson(res, 200, await workspaces.remove({ workspaceId: workspaceMatch[1] }))
      }
      if (pathname === `${BASE}/models` && req.method === 'GET') {
        return writeJson(res, 200, await models.catalog())
      }
      if (pathname === `${BASE}/settings/permission` && req.method === 'GET') {
        return writeJson(res, 200, { namespace: await permissions.describe() })
      }
      if (pathname === `${BASE}/settings/permission` && req.method === 'PUT') {
        const payload = await readJson(req); const view = await permissions.update(payload)
        return writeJson(res, 200, { namespace: view })
      }
      // ── P1-05 diagnostics：health 快照 / paths / last errors（红字：只留 code+digest）──
      if (pathname === `${BASE}/diagnostics` && req.method === 'GET') {
        if (diagnostics === null) return writeJson(res, 404, { error: { code: 'not-found', message: 'Gateway request failed' } })
        return writeJson(res, 200, await diagnostics.snapshot())
      }
      if (pathname === `${BASE}/paths` && req.method === 'GET') {
        if (diagnostics === null) return writeJson(res, 404, { error: { code: 'not-found', message: 'Gateway request failed' } })
        return writeJson(res, 200, diagnostics.pathsSnapshot())
      }
      if (pathname === `${BASE}/last-errors` && req.method === 'GET') {
        if (diagnostics === null) return writeJson(res, 404, { error: { code: 'not-found', message: 'Gateway request failed' } })
        return writeJson(res, 200, { items: diagnostics.lastErrorsSnapshot() })
      }
      if (attachmentMatch && req.method === 'GET') {
        const [, sessionId, attachmentId] = attachmentMatch
        record(sessionId)
        return writeJson(res, 200, await sessions.attachment(sessionId, attachmentId))
      }
      if (questionMatch && req.method === 'GET' && !questionMatch[2]) {
        const sessionId = questionMatch[1]
        const item = await sessions.describe(sessionId)
        if (item.sessionId !== sessionId || item.agentPreset !== 'personal-remote') {
          throw Object.assign(new Error('question source unavailable'), { code: 'session-not-found' })
        }
        await ensureQuestionPump()
        return writeJson(res, 200, { questions: await questions.list(sessionId) })
      }
      if (questionMatch && req.method === 'POST' && questionMatch[2]) {
        const sessionId = questionMatch[1], questionRpcId = questionMatch[2], payload = await readJson(req)
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
            Object.keys(payload).join(',') !== 'answer') throw new TypeError('invalid question response body')
        const item = await sessions.describe(sessionId)
        if (item.sessionId !== sessionId || item.agentPreset !== 'personal-remote') {
          throw Object.assign(new Error('question source unavailable'), { code: 'session-not-found' })
        }
        await ensureQuestionPump()
        await questions.list(sessionId)
        if (!questions.pending(sessionId, questionRpcId)) return writeJson(res, 200, { accepted: false, reason: 'not-pending' })
        return writeJson(res, 200, await sessions.respondUserQuestion({ sessionId, questionRpcId, answer: payload.answer }))
      }
      if (!match) return writeJson(res, 404, { error: { code: 'not-found', message: 'Gateway request failed' } })
      const [, sessionId, action] = match
      if (!action && req.method === 'GET') return writeJson(res, 200, await sessions.describe(sessionId))
      if (action === 'chat-handoff' && req.method === 'POST') {
        const body = await readJson(req, 1024 * 1024);
        if (!['state','prepare','install'].includes(body.action)) throw new TypeError('invalid handoff action');
        return writeJson(res, 200, await sessions.chatHandoff(sessionId, body.action, body.handoff));
      }
      if (action === 'stop-state' && req.method === 'GET') {
        const receiptId = requestUrl.searchParams.get('receiptId'), turn = requestUrl.searchParams.get('turn')
        const stopRequestedAt = requestUrl.searchParams.get('stopRequestedAt')
        if (!/^[A-Za-z0-9._:-]{1,160}$/.test(receiptId ?? '') ||
            turn !== null && (!/^\d+$/.test(turn) || !Number.isSafeInteger(Number(turn)) || Number(turn) < 1) ||
            !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(stopRequestedAt ?? '') ||
            !Number.isFinite(Date.parse(stopRequestedAt))) throw new TypeError('invalid stop state identity')
        return writeJson(res, 200, await sessions.taskStopState({ sessionId, receiptId, stopRequestedAt,
          ...(turn === null ? {} : { turn: Number(turn) }) }))
      }
      if (action === 'rename' && req.method === 'POST') {
        const payload = await readJson(req)
        return writeJson(res, 200, await sessions.rename(sessionId, payload.title))
      }
      if (action === 'fork' && req.method === 'POST') {
        const value = await sessions.fork(sessionId, await readJson(req))
        records.set(value.sessionId, { events: [], listeners: new Set(), state: undefined, lastSeq: -1, nextId: 1 })
        return writeJson(res, 201, value)
      }
      if (action === 'memory-boundaries' && req.method === 'GET') return writeJson(res, 200, await sessions.memoryBoundaries(sessionId, Number(requestUrl.searchParams.get('afterSeq') ?? -1)))
      if (action === 'storage' && req.method === 'GET') return writeJson(res, 200, await sessions.storage(sessionId));
      if (action === 'memory-cleanup' && req.method === 'POST') {
        const body = await readJson(req, 1024 * 1024)
        if (typeof body.deleteConversationSnippets !== 'boolean' || !Array.isArray(body.sourceTexts) ||
            body.sourceTexts.some(text => typeof text !== 'string' || !text || text.length > 100000)) throw new TypeError('invalid memory cleanup')
        return writeJson(res, 200, await sessions.cleanupMemory(sessionId, body))
      }
      if (!action && req.method === 'DELETE') {
        const value = await sessions.remove(sessionId)
        records.delete(sessionId)
        return writeJson(res, 200, value)
      }
      if (action === 'source' && req.method === 'GET') {
        const turn = requestUrl.searchParams.get('turn'), receiptId = requestUrl.searchParams.get('receiptId')
        if (turn !== null && (!/^\d+$/.test(turn) || !Number.isSafeInteger(Number(turn)) || Number(turn) < 1) ||
            !/^[A-Za-z0-9._:-]{1,160}$/.test(receiptId ?? '')) throw new TypeError('invalid source identity')
        return writeJson(res, 200, await sessions.sourceEvents(sessionId,
          { receiptId, ...(turn === null ? {} : { turn: Number(turn) }) }))
      }
      if (action === 'history' && req.method === 'GET') {
        if(requestUrl.searchParams.has('waitMs')){
          const ms=Number(requestUrl.searchParams.get('waitMs')),seq=Number(requestUrl.searchParams.get('waitSeq'));
          if(!Number.isInteger(ms)||ms<1||ms>30000||!Number.isInteger(seq)||seq< -1)throw new TypeError('invalid history wait');
          // Validate/read the native session before holding a response.
          const snapshot=await sessions.historyPage(sessionId,{limit:1});
          if((snapshot.liveSeq??snapshot.nextSeq)<=seq&&readLog?.waitForChange){
            const controller=new AbortController(),abort=()=>controller.abort();res.on('close',abort);
            try{await readLog.waitForChange(sessionId,seq,ms,controller.signal);}finally{res.off('close',abort);}
          }
        }
        const afterRaw = requestUrl.searchParams.get('afterSeq')
        const beforeRaw = requestUrl.searchParams.get('beforeSeq')
        const limitRaw = requestUrl.searchParams.get('limit') ?? '50'
        if (afterRaw !== null && !/^-?\d+$/.test(afterRaw) || beforeRaw !== null && !/^\d+$/.test(beforeRaw) || !/^\d+$/.test(limitRaw)) throw new TypeError('invalid history cursor')
        if (requestUrl.searchParams.has('detailSeq')) return writeJson(res, 200,
          await sessions.historyDetail(sessionId, Number(requestUrl.searchParams.get('detailSeq'))))
        return writeJson(res, 200, await sessions.historyPage(sessionId, {
          ...(afterRaw === null ? {} : { afterSeq: Number(afterRaw) }),
          ...(beforeRaw === null ? {} : { beforeSeq: Number(beforeRaw) }), limit: Number(limitRaw), includeThinking: requestUrl.searchParams.get('includeThinking') === 'true' }))
      }
      if (action === 'resume' && req.method === 'POST') {
        const resumed = await sessions.resume(sessionId)
        if (!records.has(sessionId)) records.set(sessionId, { events: [], listeners: new Set(), state: undefined, lastSeq: -1, nextId: 1 })
        await reconcile(sessionId, resumed.events)
        return writeJson(res, 200, { sessionId, lastSeq: record(sessionId).lastSeq })
      }
      if (action === 'messages' && req.method === 'POST') {
        record(sessionId); const payload = await readJson(req, 14 * 1024 * 1024)
        const content = promptContent(payload.content)
        let result
        try { result = await sessions.send(sessionId, content, payload.mode ?? 'queue') }
        catch (error) {
          if (Array.isArray(content) && content.some((part) => part.type === 'image') &&
              error instanceof DshAdapterError && error.operation === 'prompt' &&
              error.code === 'attachment-error') {
            return writeJson(res, 200, { accepted: false, rejected: true, errorCode: 'IMAGE_REJECTED',
              ...(error.reasonCode ? { imageReasonCode: error.reasonCode } : {}) })
          }
          throw error
        }
        return writeJson(res, result.accepted ? 202 : 409, { accepted: result.accepted,
          ...(result.receiptId ? { receiptId: result.receiptId } : {}),
          ...(result.steeredReceiptId ? { steeredReceiptId: result.steeredReceiptId } : {}) })
      }
      if (action === 'cancel' && req.method === 'POST') {
        record(sessionId); const result = await sessions.cancel(sessionId)
        return writeJson(res, result.accepted ? 202 : 409, { accepted: result.accepted })
      }
      if (action === 'approval' && req.method === 'POST') {
        record(sessionId); const payload = await readJson(req)
        return writeJson(res, 200, await sessions.respondApproval({ sessionId, ...payload }))
      }
      if (action === 'models' && req.method === 'GET') {
        // Native session.models uses agentFor(), which resumes cold agents
        // under the API proxy's private handle. Claim our personal lifecycle
        // first so later deletion/forgetting can drain the right disposer.
        return writeJson(res, 200, await sessions.withLifecycle(sessionId, () => models.sessionModels(sessionId)))
      }
      if (action === 'models' && req.method === 'PUT') {
        record(sessionId); const payload = await readJson(req)
        const result = await sessions.withLifecycle(sessionId, () => models.selectSessionModel(sessionId, payload))
        return writeJson(res, 200, result)
      }
      if (action === 'events' && req.method === 'GET') {
        const entry = record(sessionId)
        beginSse(res)
        const lastId = req.headers['last-event-id']; const position = typeof lastId === 'string' ? entry.events.findIndex((event) => event.id === lastId) + 1 : 0
        for (const event of entry.events.slice(position)) res.write(sseEvent(event))
        entry.listeners.add(res)
        // IncomingMessage `close` can fire once its request body is consumed;
        // an SSE subscription is owned by the response socket lifetime.
        const abort = new AbortController(); res.on('close', () => { abort.abort(); entry.listeners.delete(res) })
        void pump(sessionId, abort.signal)
        return
      }
      return writeJson(res, 405, { error: { code: 'method-not-allowed', message: 'Gateway request failed' } })
    } catch (error) {
      const nativeCode = typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(error.code) ? error.code : 'unknown'
      console.error(`[weftmate] gateway ${req.method} failed: ${nativeCode} ${error?.name ?? 'Error'}`)
      if (nativeCode === 'unknown') console.error(String(error?.stack ?? '').split('\n').slice(1, 4).join('\n'))
      const safe = await gatewayError(error)
      diagnostics?.recordError(safe.code, safe.details?.digest ?? null)
      const notFound = error?.code === 'session-not-found' || error?.code === 'workspace-not-found'
      return writeJson(res, notFound ? 404 : 400, { error: safe })
    }
  }
  // Private loopback boundary used only by the host. Keep streams and agents
  // alive; queue new native requests while already admitted writes drain.
  async function handle(req, res) {
    const pathname = new URL(req.url ?? '/', 'http://gateway').pathname
    if (pathname === `${BASE}/backup-pause` || pathname === `${BASE}/backup-resume`) {
      if (req.headers.origin || !LOOPBACK.has(req.socket?.remoteAddress ?? '') || req.method !== 'POST')
        return writeJson(res, 403, { error: { code: 'origin-forbidden' } })
      const body = await readJson(req)
      if (pathname.endsWith('backup-resume')) {
        if (capture?.id === body.id) capture.release()
        return writeJson(res, 200, {})
      }
      if (capture) return writeJson(res, 409, { error: { code: 'busy' } })
      let release
      const ready = new Promise(resolve => { release = resolve })
      const owned = { id: body.id, ready, release: () => { clearTimeout(owned.timer); if (capture === owned) capture = null; release() } }
      capture = owned
      owned.timer = setTimeout(owned.release, Math.max(1, Math.min(2000, body.deadline - Date.now())))
      try {
        await Promise.race([Promise.allSettled([...operations]), ready.then(() => { throw Object.assign(new Error('capture expired'), { code: 'BACKUP_PAUSE_TIMEOUT' }) })])
        await Promise.race([lifecycle.flushIdle(body), ready.then(() => { throw Object.assign(new Error('capture expired'), { code: 'BACKUP_PAUSE_TIMEOUT' }) })])
        if (capture !== owned) throw Object.assign(new Error('capture expired'), { code: 'BACKUP_PAUSE_TIMEOUT' })
        return writeJson(res, 200, { id: owned.id })
      } catch (error) {
        owned.release()
        return writeJson(res, 409, { error: { code: error.code === 'agent-busy' ? 'SESSION_BUSY' : error.code ?? 'STORAGE_UNAVAILABLE' } })
      }
    }
    if (capture) await capture.ready
    const operation = dispatch(req, res)
    operations.add(operation)
    try { return await operation } finally { operations.delete(operation) }
  }
  return { handle, emitForTest: emit, reconcileForTest: reconcile, close() {
    questionPump?.controller.abort(); questionPump = null; questions.close()
  } }
}
