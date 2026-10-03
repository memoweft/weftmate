/** Thin host callbacks for the authenticated personal access service. */
import { discoverOpenAICompatibleModels, openAICompatibleEndpoint } from './openai-compatible-client.ts'
import { modelRouteFingerprint } from './model-route-fingerprint.mjs'
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const fail = (code) => { const error = new Error(code); error.code = code; throw error }

export function createPersonalAccessBackend({ currentOrigin, referenceScan, profiles, hasCredential,
  routeForProfile, listSessions, resolveSession, ensureKnownSession, gateway, queue, bindSession,
  credentialForProfile = null, modelFetch = fetch,
  hostOwnerId = () => null,
  modelAllowed = () => true,
  moduleStatus = () => ({}),
  desktopTask = null, taskStop = null, toolResultProof = null, naturalLanguageDesktopReady = () => false,
  naturalLanguageDesktopVerified = () => false, inferenceVerified = () => false }) {
  const requireRuntime = () => { if (!currentOrigin()) fail('RUNTIME_UNAVAILABLE') }
  const presetForOwner = (ownerId) => {
    const originalOwner = hostOwnerId()
    if (originalOwner === null) return 'personal-remote' // Standalone backend fixtures.
    if (typeof ownerId !== 'string' || !ownerId) fail('SESSION_UNAVAILABLE')
    return ownerId === originalOwner ? 'personal-remote' : 'personal-shared-chat'
  }
  const modelProfile = (id) => {
    const profile = profiles().find((item) => item.id === id)
    if (!profile || !profile.model || !hasCredential(profile)) fail('MODEL_UNAVAILABLE')
    return profile
  }
  const requireModelAllowed = (ownerId, profileId) => {
    if (modelAllowed(ownerId, profileId) !== true) fail('MODEL_UNAVAILABLE')
  }
  const requireCatalogRoute = async (profile) => {
    const route = routeForProfile(profile.id)
    let catalog
    try { catalog = await gateway('/models') } catch { fail('MODEL_UNAVAILABLE') }
    if (!Array.isArray(catalog?.groups) || !catalog.groups.some((group) =>
      group?.id === route.provider && Array.isArray(group.models) &&
      group.models.some((model) => model?.id === profile.model))) fail('MODEL_UNAVAILABLE')
  }
  const requireSession = async (id, ownerId) => {
    if (typeof id !== 'string' || !idPattern.test(id)) fail('SESSION_UNAVAILABLE')
    const listed = await listSessions().catch(() => { fail('SESSION_UNAVAILABLE') })
    const current = listed?.items?.find((item) => item.sessionId === id)
    if (!current) fail('SESSION_UNAVAILABLE')
    if (current.agentPreset !== presetForOwner(ownerId)) fail('SESSION_READ_ONLY')
    try { return await resolveSession(id) }
    catch { fail('SESSION_UNAVAILABLE') }
  }
  return {
    async getStatus() {
      const running = Boolean(currentOrigin())
      let chat = false
      if (running) {
        const candidates = profiles().filter((profile) => profile.model && hasCredential(profile))
        if (candidates.length) {
          try {
            const catalog = await gateway('/models')
            chat = Array.isArray(catalog?.groups) && candidates.some((profile) =>
              catalog.groups.some((group) => group?.id === routeForProfile(profile.id).provider &&
                Array.isArray(group.models) && group.models.some((model) => model?.id === profile.model)))
          } catch { chat = false }
        }
      }
      let desktop = false
      if (running && desktopTask) {
        try { await desktopTask.preflight('notepad'); desktop = true } catch { /* capability unavailable */ }
      }
      return { runtime: running ? 'ready' : 'unavailable', referenceScan: referenceScan().state,
        modules: moduleStatus(),
        capabilities: {
          chat: { available: chat, inferenceVerified: chat && inferenceVerified(),
            ...(!chat ? { reasonCode: running ? 'MODEL_UNAVAILABLE' : 'RUNTIME_UNAVAILABLE' }
              : !inferenceVerified() ? { reasonCode: 'INFERENCE_UNVERIFIED' } : {}) },
          desktopOpenApp: { available: desktop, appIds: desktop ? ['notepad'] : [],
            ...(!desktop ? { reasonCode: 'CAPABILITY_UNAVAILABLE' } : {}) },
          naturalLanguageDesktop: { available: chat && desktop && naturalLanguageDesktopReady(),
            inferenceVerified: naturalLanguageDesktopVerified(),
            ...(!(chat && desktop && naturalLanguageDesktopReady()) ? { reasonCode: 'CAPABILITY_UNAVAILABLE' } : {}) },
        } }
    },
    listModels() { return profiles().map((profile) => ({ id: profile.id, name: profile.name, model: profile.model,
      configured: hasCredential(profile), source: 'host',
      routeFingerprint: (() => { try { return modelRouteFingerprint(
        openAICompatibleEndpoint(profile.baseUrl, 'chat/completions').href, profile.model) }
      catch { return null } })(),
      sourceKind: (() => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.baseUrl).hostname)
        ? 'local' : 'cloud' } catch { return 'cloud' } })() })) },
    async verifyModelProfile(profileId) {
      const profile = modelProfile(profileId)
      if (typeof credentialForProfile !== 'function') fail('MODEL_UNAVAILABLE')
      const apiKey = credentialForProfile(profile)
      if (!apiKey) fail('MODEL_UNAVAILABLE')
      try {
        const models = await discoverOpenAICompatibleModels({ baseUrl: profile.baseUrl, apiKey, fetchImpl: modelFetch })
        return { configured: true, reachable: true, modelListed: models.includes(profile.model), inferenceVerified: false }
      } catch { return { configured: true, reachable: false, modelListed: false, inferenceVerified: false } }
    },
    async modelCompletion({ profileId, body, signal }) {
      const profile = modelProfile(profileId)
      if (body.model !== profile.model || typeof credentialForProfile !== 'function') fail('MODEL_UNAVAILABLE')
      const apiKey = credentialForProfile(profile)
      if (!apiKey) fail('MODEL_UNAVAILABLE')
      return modelFetch(openAICompatibleEndpoint(profile.baseUrl, 'chat/completions'), {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', accept: body.stream ? 'text/event-stream' : 'application/json',
          authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      })
    },
    async preflight(command) {
      requireRuntime()
      const preset = presetForOwner(command?.ownerId)
      if (command?.kind === 'session.create') {
        requireModelAllowed(command.ownerId, command.modelProfileId)
        await requireCatalogRoute(modelProfile(command.modelProfileId))
      }
      else if (command?.kind === 'desktop.open_app') {
        if (preset !== 'personal-remote') fail('CAPABILITY_UNAVAILABLE')
        if (command.appId !== 'notepad' || !desktopTask) fail('CAPABILITY_UNAVAILABLE')
        await desktopTask.preflight(command.appId)
      }
      else if (command?.kind === 'desktop.write_artifact') {
        if (preset !== 'personal-remote') fail('CAPABILITY_UNAVAILABLE')
        await requireSession(command.sessionId, command.ownerId)
      }
      else if (command?.kind === 'session.message') {
        if (command.mode !== undefined && !['queue', 'steer'].includes(command.mode)) fail('INVALID_COMMAND')
        const session = await requireSession(command.sessionId, command.ownerId)
        requireModelAllowed(command.ownerId, session.profile?.id)
        await requireCatalogRoute(session.profile)
        if (command.modelProfileId && session.profile?.id !== command.modelProfileId) fail('MODEL_UNAVAILABLE')
      } else if (command?.kind === 'session.cancel') {
        const listed = await listSessions().catch(() => { fail('SESSION_UNAVAILABLE') })
        if (!listed?.items?.some((item) => item.sessionId === command.sessionId)) fail('SESSION_UNAVAILABLE')
      } else fail('INVALID_COMMAND')
      return { ok: true }
    },
    async createSession({ sessionId, modelProfileId, ownerId }) {
      requireRuntime()
      if (typeof sessionId !== 'string' || !idPattern.test(sessionId)) fail('SESSION_UNAVAILABLE')
      const preset = presetForOwner(ownerId)
      return queue(async () => {
        requireModelAllowed(ownerId, modelProfileId)
        const profile = modelProfile(modelProfileId)
        await requireCatalogRoute(profile)
        const created = await gateway('/sessions', { method: 'POST',
          body: JSON.stringify({ sessionId, agentPreset: preset }) })
        if (created?.sessionId !== sessionId) fail('SESSION_UNAVAILABLE')
        const listed = await listSessions()
        if (!listed?.items?.some((item) => item.sessionId === sessionId && item.agentPreset === preset)) {
          fail('SESSION_READ_ONLY')
        }
        bindSession(sessionId, profile.id)
        const route = routeForProfile(profile.id)
        await gateway(`/sessions/${encodeURIComponent(sessionId)}/models`, { method: 'PUT',
          body: JSON.stringify({ provider: route.provider, model: profile.model,
            ...(profile.reasoningEffort && profile.reasoningEffort !== 'off' ? { reasoningEffort: profile.reasoningEffort } : {}) }) })
        return { sessionId }
      })
    },
    async sendMessage({ sessionId, text, mode = 'queue', ownerId, attachments = [] }) {
      requireRuntime()
      if (typeof text !== 'string' || (!text.trim() && attachments.length === 0) || text.length > 32_000 ||
          !['queue', 'steer'].includes(mode) || !Array.isArray(attachments) || attachments.length > 4 ||
          attachments.some((item) => typeof item?.data !== 'string' || typeof item?.name !== 'string' ||
            !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item?.contentType))) fail('INVALID_COMMAND')
      return queue(async () => {
        const session = await requireSession(sessionId, ownerId)
        requireModelAllowed(ownerId, session.profile?.id)
        await requireCatalogRoute(session.profile)
        try { await ensureKnownSession(sessionId) }
        catch (error) { fail(error?.code === 'session-model-ownership-unknown' ? 'MODEL_ROUTE_BLOCKED' : 'SESSION_UNAVAILABLE') }
        await gateway(`/sessions/${encodeURIComponent(sessionId)}/resume`, { method: 'POST', body: '{}' })
        const content = attachments.length ? [
          ...(text ? [{ type: 'text', text }] : []),
          ...attachments.map((item) => ({ type: 'image', mediaType: item.contentType,
            data: item.data, name: item.name })),
        ] : text
        const result = await gateway(`/sessions/${encodeURIComponent(sessionId)}/messages`, { method: 'POST',
          body: JSON.stringify({ content, mode }) })
        return { accepted: result?.accepted === true,
          ...(result?.rejected === true && result?.errorCode === 'IMAGE_REJECTED'
            ? { rejected: true, errorCode: 'IMAGE_REJECTED',
              ...(typeof result.imageReasonCode === 'string' ? { imageReasonCode: result.imageReasonCode } : {}) } : {}),
          ...(result?.receiptId ? { receiptId: result.receiptId } : {}) }
      })
    },
    async readAttachment({ sessionId, attachmentId, ownerId }) {
      requireRuntime()
      await requireSession(sessionId, ownerId)
      if (typeof attachmentId !== 'string' || !idPattern.test(attachmentId)) fail('INVALID_COMMAND')
      await gateway(`/sessions/${encodeURIComponent(sessionId)}/resume`, { method: 'POST', body: '{}' })
      const result = await gateway(`/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`)
      const ref = result?.attachment
      const data = result?.data
      if (typeof data !== 'string' || data.length > 7_000_000 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(data) ||
          !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(ref?.mediaType)) fail('BACKEND_UNAVAILABLE')
      const bytes = Buffer.from(data, 'base64')
      if (bytes.length < 1 || bytes.length > 5 * 1024 * 1024 || bytes.toString('base64') !== data) fail('BACKEND_UNAVAILABLE')
      return { contentType: ref.mediaType, bytes }
    },
    async cancelSession({ sessionId }) {
      requireRuntime()
      return queue(async () => {
        const listed = await listSessions()
        if (!listed?.items?.some((item) => item.sessionId === sessionId)) fail('SESSION_UNAVAILABLE')
        const result = await gateway(`/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST', body: '{}' })
        return { accepted: result?.accepted === true }
      })
    },
    async stopTask({ sessionId, ownerId, requestId, receiptIds }) {
      requireRuntime()
      if (typeof taskStop !== 'function') fail('CAPABILITY_UNAVAILABLE')
      if (hostOwnerId() !== null && ownerId !== hostOwnerId()) fail('SESSION_READ_ONLY')
      if (typeof requestId !== 'string' || !idPattern.test(requestId) ||
          !Array.isArray(receiptIds) || receiptIds.length < 1 || receiptIds.length > 16 ||
          new Set(receiptIds).size !== receiptIds.length ||
          receiptIds.some((value) => typeof value !== 'string' || !idPattern.test(value))) fail('INVALID_COMMAND')
      await requireSession(sessionId, ownerId)
      const result = await taskStop({ sessionId, requestId, receiptIds })
      if (!Array.isArray(result?.outcomes) || result.outcomes.length !== receiptIds.length ||
          new Set(result.outcomes.map((item) => item?.receiptId)).size !== receiptIds.length ||
          result.outcomes.some((item) => !receiptIds.includes(item?.receiptId) ||
            !['cancel_requested', 'queue_removed', 'unconfirmed'].includes(item?.status))) fail('BACKEND_UNAVAILABLE')
      return result
    },
    async verifyToolResult({ sessionId, turn, readCallId, snapshotId, sourceReceiptId, beforeCallId,
      readTool = 'personal_read_project_file', beforeTool = 'personal_save_document' }) {
      requireRuntime()
      if (typeof toolResultProof !== 'function') return false
      if (typeof sessionId !== 'string' || !idPattern.test(sessionId) ||
          !Number.isSafeInteger(turn) || turn < 1 ||
          [readCallId, sourceReceiptId, beforeCallId].some((id) =>
            typeof id !== 'string' || !idPattern.test(id)) ||
          typeof snapshotId !== 'string' || !idPattern.test(snapshotId) ||
          !['personal_read_project_file', 'personal_browser_open', 'personal_browser_follow'].includes(readTool) ||
          !['personal_save_document', 'personal_browser_follow'].includes(beforeTool) ||
          readCallId === beforeCallId) return false
      try {
        await requireSession(sessionId, hostOwnerId())
        return await toolResultProof({ sessionId, turn, readCallId, snapshotId,
          sourceReceiptId, beforeCallId, readTool, beforeTool }) === true
      } catch { return false }
    },
    async openDesktopApp({ appId, ownerId }) {
      requireRuntime()
      if (presetForOwner(ownerId) !== 'personal-remote') fail('CAPABILITY_UNAVAILABLE')
      if (appId !== 'notepad' || !desktopTask) fail('CAPABILITY_UNAVAILABLE')
      return queue(() => desktopTask.open({ appId }))
    },
    async readEvents({ sessionId, afterSeq = -1, limit = 50 }) {
      requireRuntime()
      if (typeof sessionId !== 'string' || !idPattern.test(sessionId)
        || !Number.isSafeInteger(afterSeq) || afterSeq < -1 || !Number.isInteger(limit) || limit < 1 || limit > 200) fail('INVALID_COMMAND')
      const query = `afterSeq=${afterSeq}&limit=${limit}`
      return gateway(`/sessions/${encodeURIComponent(sessionId)}/history?${query}`)
    },
    async describeSession(sessionId) {
      requireRuntime()
      const listed = await listSessions()
      const item = listed.items.find((row) => row.sessionId === sessionId)
      if (!item) fail('SESSION_UNAVAILABLE')
      let modelProfileId = null
      try { modelProfileId = (await resolveSession(sessionId))?.profile?.id ?? null } catch { /* History may remain readable. */ }
      return { sessionId, title: typeof item.title === 'string' ? item.title : '新对话',
        running: item.running === true, agentPreset: item.agentPreset ?? null,
        modelProfileId }
    },
  }
}
