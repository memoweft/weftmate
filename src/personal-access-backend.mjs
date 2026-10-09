/** Thin host callbacks for the authenticated personal access service. */
import { checkModelConnection, canonicalProviderModelId } from './model-connection-check.mjs'
import { discoverOpenAICompatibleModels, openAICompatibleEndpoint } from './openai-compatible-client.ts'
import { modelTierFor } from './model-tier.ts'
import { modelRouteFingerprint } from './model-route-fingerprint.mjs'
import { reasoningCapability } from './model-reasoning.mjs'
import path from 'node:path'
import { mkdir, rm, cp, access } from 'node:fs/promises'
import { sessionWorkspace } from './personal-access/session-workspace.mjs'
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const fail = (code) => { const error = new Error(code); error.code = code; throw error }

export function createPersonalAccessBackend({ currentOrigin, referenceScan, profiles, hasCredential,
  routeForProfile, listSessions, resolveSession, ensureKnownSession, gateway, queue, bindSession,
  credentialForProfile = null, modelFetch = fetch, processingStatus = async () => null,
  prepareModelReasoning = null,
  reasoningSettings = null,
  hostOwnerId = () => null, getRuntimeId = () => null,
  ownerForSession = () => null,
  modelAllowed = () => true,
  moduleStatus = () => ({}),
  desktopTask = null, taskStop = null, toolResultProof = null, replyEvidence = null,
  sessionWorkspaceRoot = null,
  naturalLanguageDesktopReady = () => false,
  naturalLanguageDesktopVerified = () => false, inferenceVerified = () => false }) {
  const requireRuntime = () => { if (!currentOrigin()) fail('RUNTIME_UNAVAILABLE') }
  const captureQuestionRuntime = () => {
    const runtimeId = getRuntimeId(), origin = currentOrigin();
    if (!origin || typeof runtimeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runtimeId)) fail('RUNTIME_UNAVAILABLE');
    return { runtimeId, origin };
  }
  const requireQuestionRuntime = snapshot => {
    if (getRuntimeId() !== snapshot.runtimeId || currentOrigin() !== snapshot.origin) fail('RUNTIME_UNAVAILABLE');
  }
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
  const requireModelAllowed = (ownerId, profileId, usage = 'bound') => {
    if (modelAllowed(ownerId, profileId, usage) !== true) fail('MODEL_UNAVAILABLE')
  }
  const requireCatalogRoute = async (profile) => {
    const route = routeForProfile(profile.id)
    let catalog
    try { catalog = await gateway('/models') } catch { fail('MODEL_UNAVAILABLE') }
    const found = Array.isArray(catalog?.groups) && catalog.groups.find((group) =>
      group?.id === route.provider && Array.isArray(group.models) &&
      group.models.some((model) => model?.id === profile.model))?.models.find(model => model.id === profile.model)
    if (!found) fail('MODEL_UNAVAILABLE')
    return found
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
  const describeItem = async (item, sessionSnapshot) => {
    const sessionId = item.sessionId
    let modelProfileId = null
    try { modelProfileId = (await resolveSession(sessionId, sessionSnapshot))?.profile?.id ?? null } catch { /* History may remain readable. */ }
    return { sessionId, title: typeof item.title === 'string' ? item.title : '新对话',
      running: item.running === true, agentPreset: item.agentPreset ?? null,
      modelProfileId, ...(item.contextUsage ? {contextUsage: item.contextUsage} : {}),
      ...(item.running === true ? { processing: await processingStatus(sessionId) } : {}) }
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
    listModels() {
      const project = (settings = {}) => {
      const capability = profile => {
        const model = settings[routeForProfile?.(profile.id)?.provider]?.models?.find(row => row.id === profile.model);
        return model?.reasoningEfforts !== undefined ? {supported:!!model.reasoningEfforts?.high,
          ...(model.reasoningEfforts?.high ? {effort:'high'} : {})} : reasoningCapability(profile);
      };
      return profiles().map((profile) => ({ id: profile.id, name: profile.name, model: profile.model,
      configured: hasCredential(profile), source: 'host', deepThinking: capability(profile),
      routeFingerprint: (() => { try { return modelRouteFingerprint(
        openAICompatibleEndpoint(profile.baseUrl, 'chat/completions').href, profile.model) }
      catch { return null } })(),
      modelTier: profile.modelTier ?? 'auto', sourceKind: modelTierFor(profile),
      location: modelTierFor(profile) === 'cloud' ? 'cloud' : ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(profile.baseUrl).hostname) ? 'computer' : 'lan' })) };
      return reasoningSettings && currentOrigin() ? Promise.resolve().then(reasoningSettings).then(project, () => project()) : project();
    },
    async verifyModelProfile(profileId, ownerId) {
      requireModelAllowed(ownerId, profileId, 'new')
      const profile = modelProfile(profileId)
      if (typeof credentialForProfile !== 'function') fail('MODEL_UNAVAILABLE')
      const apiKey = credentialForProfile(profile)
      if (!apiKey) fail('MODEL_UNAVAILABLE')
      return checkModelConnection({ baseUrl: profile.baseUrl, modelId: profile.model, apiKey, fetchImpl: modelFetch })
    },
    async modelCompletion({ profileId, body, signal, ownerId }) {
      requireModelAllowed(ownerId, profileId, 'new')
      const profile = modelProfile(profileId)
      if (body.model !== profile.model || typeof credentialForProfile !== 'function') fail('MODEL_UNAVAILABLE')
      const apiKey = credentialForProfile(profile)
      if (!apiKey) fail('MODEL_UNAVAILABLE')
      requireModelAllowed(ownerId, profileId, 'new')
      return modelFetch(openAICompatibleEndpoint(profile.baseUrl, 'chat/completions'), {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', accept: body.stream ? 'text/event-stream' : 'application/json',
          authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ ...body, model: canonicalProviderModelId(profile.baseUrl, body.model) }),
      })
    },
    async preflight(command) {
      requireRuntime()
      const preset = presetForOwner(command?.ownerId)
      if (command?.kind === 'session.create') {
        requireModelAllowed(command.ownerId, command.modelProfileId, 'new')
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
    async createSession({ sessionId, modelProfileId, ownerId, project, title, workspaceChatId }) {
      requireRuntime()
      if (typeof sessionId !== 'string' || !idPattern.test(sessionId)) fail('SESSION_UNAVAILABLE')
      const preset = presetForOwner(ownerId)
      return queue(async () => {
        requireModelAllowed(ownerId, modelProfileId, 'new')
        const profile = modelProfile(modelProfileId)
        await requireCatalogRoute(profile)
        const cwd = project?.rootPath ?? (sessionWorkspaceRoot
          ? sessionWorkspace(sessionWorkspaceRoot, ownerId ?? 'fixture', workspaceChatId ?? sessionId) : undefined)
        if (cwd && !project) await mkdir(cwd, { recursive: true, mode: 0o700 })
        const exists = workspaceChatId && (await listSessions()).items?.some(item => item.sessionId === sessionId);
        const created = exists ? { sessionId } : await gateway('/sessions', { method: 'POST',
          body: JSON.stringify({ sessionId, agentPreset: preset, ...(cwd ? { cwd } : {}) }) })
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
        if (title) await gateway(`/sessions/${encodeURIComponent(sessionId)}/rename`, { method: 'POST', body: JSON.stringify({ title }) })
        return { sessionId }
      })
    },
    async renameSession({ sessionId, ownerId, title }) {
      await requireSession(sessionId, ownerId)
      return gateway(`/sessions/${encodeURIComponent(sessionId)}/rename`, { method: 'POST', body: JSON.stringify({ title }) })
    },
    async chatRelayState({ sessionId, ownerId }) {
      await requireSession(sessionId, ownerId);
      return gateway(`/sessions/${encodeURIComponent(sessionId)}/chat-handoff`, { method: 'POST', body: JSON.stringify({ action: 'state' }) });
    },
    async prepareChatHandoff({ sessionId, ownerId }) {
      await requireSession(sessionId, ownerId);
      return gateway(`/sessions/${encodeURIComponent(sessionId)}/chat-handoff`, { method: 'POST', body: JSON.stringify({ action: 'prepare' }) });
    },
    async installChatHandoff({ sessionId, ownerId, handoff }) {
      await requireSession(sessionId, ownerId);
      return gateway(`/sessions/${encodeURIComponent(sessionId)}/chat-handoff`, { method: 'POST', body: JSON.stringify({ action: 'install', handoff }) });
    },
    async forkSession({ sessionId, ownerId, childId, modelProfileId, title: sourceTitle, beforeSeq }) {
      requireRuntime()
      const source = await requireSession(sessionId, ownerId)
      const profile = modelProfile(modelProfileId ?? source.profile.id)
      requireModelAllowed(ownerId, profile.id, 'new')
      const cwd = sessionWorkspace(sessionWorkspaceRoot, ownerId ?? 'fixture', childId)
      const sourceCwd = sessionWorkspace(sessionWorkspaceRoot, ownerId ?? 'fixture', sessionId)
      await mkdir(cwd, { recursive: true, mode: 0o700 })
      try {
        try { await access(sourceCwd); await cp(sourceCwd, cwd, { recursive: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
        const result = await gateway(`/sessions/${encodeURIComponent(sessionId)}/fork`, { method: 'POST', body: JSON.stringify({ sessionId: childId, cwd, copyWorkspace: false, ...(beforeSeq !== undefined ? { beforeSeq } : {}) }) })
        if (result.sessionId !== childId) fail('SESSION_UNAVAILABLE')
        bindSession(childId, profile.id)
        const route = routeForProfile(profile.id)
        await gateway(`/sessions/${encodeURIComponent(childId)}/models`, { method: 'PUT', body: JSON.stringify({ provider: route.provider, model: profile.model }) })
        const title = `${(sourceTitle || (await this.describeSession(sessionId)).title).slice(0, 252)}（分叉）`
        const accepted = await gateway(`/sessions/${encodeURIComponent(childId)}/rename`, { method: 'POST', body: JSON.stringify({ title }) })
        return { ...result, title: accepted.title, modelProfileId: profile.id }
      } catch (error) {
        await gateway(`/sessions/${encodeURIComponent(childId)}`, { method: 'DELETE', body: '{}' }).catch(() => {})
        await rm(cwd, { recursive: true, force: true }); throw error
      }
    },
    async cleanupMemoryCopies({ sessionId, sourceTexts = [], deleteConversationSnippets = false }) {
      requireRuntime()
      const listed = await listSessions()
      if (!listed?.items?.some(item => item.sessionId === sessionId)) return { cleaned: true }
      return gateway(`/sessions/${encodeURIComponent(sessionId)}/memory-cleanup`, { method: 'POST',
        body: JSON.stringify({ sourceTexts, deleteConversationSnippets }) })
    },
    async deleteSession({ sessionId, ownerId }) {
      requireRuntime()
      const listed = await listSessions()
      if (listed?.items?.some(item => item.sessionId === sessionId)) {
        // A cold session can be listed/restored without an owned AgentHandle.
        // Resume through DSH so deletion can drain its native disposer.
        await gateway(`/sessions/${encodeURIComponent(sessionId)}/resume`, { method: 'POST', body: '{}' })
        const result = await gateway(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', body: '{}' })
        if (result?.deleted !== true) fail('SESSION_UNAVAILABLE')
      }
      if (sessionWorkspaceRoot) await rm(sessionWorkspace(sessionWorkspaceRoot, ownerId ?? 'fixture', sessionId), { recursive: true, force: true })
      // Older releases used a session-only directory. It is owned by this exact
      // UUID session, and is never a project or a user-selected working folder.
      if (sessionWorkspaceRoot && /^session-[A-Za-z0-9_-]+$/.test(sessionId))
        await rm(path.join(sessionWorkspaceRoot, sessionId), { recursive: true, force: true })
      return { deleted: true }
    },
    async schedules({ sessionId, ownerId, action, id }) {
      requireRuntime()
      await requireSession(sessionId, ownerId)
      const response = await fetch(new URL(`/weftmate/schedules/${encodeURIComponent(sessionId)}`, currentOrigin()), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, id }) })
      const value = await response.json()
      if (!response.ok) throw Object.assign(new Error(value.error ?? 'BACKEND_UNAVAILABLE'), { code: value.error, status: response.status })
      return value
    },
    async restoreSchedules(sessionIds) {
      if (!sessionIds.length) return
      requireRuntime()
      const response = await fetch(new URL('/weftmate/schedules/restore', currentOrigin()), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionIds }) })
      if (!response.ok) fail('BACKEND_UNAVAILABLE')
    },
    async sendMessage({ sessionId, text, mode = 'queue', ownerId, attachments = [], deepThinking }) {
      requireRuntime()
      if (typeof text !== 'string' || (!text.trim() && attachments.length === 0) || text.length > 32_000 ||
          !['queue', 'steer'].includes(mode) || !Array.isArray(attachments) || attachments.length > 4 ||
          attachments.some((item) => typeof item?.data !== 'string' || typeof item?.name !== 'string' ||
            !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item?.contentType))) fail('INVALID_COMMAND')
      return queue(async () => {
        const session = await requireSession(sessionId, ownerId)
        requireModelAllowed(ownerId, session.profile?.id)
        const nativeModel = await requireCatalogRoute(session.profile)
        try { await ensureKnownSession(sessionId) }
        catch (error) { fail(error?.code === 'session-model-ownership-unknown' ? 'MODEL_ROUTE_BLOCKED' : 'SESSION_UNAVAILABLE') }
        requireModelAllowed(ownerId, session.profile?.id)
        await gateway(`/sessions/${encodeURIComponent(sessionId)}/resume`, { method: 'POST', body: '{}' })
        if (deepThinking === true && (reasoningCapability(session.profile).supported || nativeModel?.reasoning?.efforts?.some(row => row.id === 'high'))) {
          if (prepareModelReasoning && !await prepareModelReasoning(session.profile)) fail('MODEL_UNAVAILABLE');
        }
        const content = attachments.length ? [
          ...(text ? [{ type: 'text', text }] : []),
          ...attachments.map((item) => ({ type: 'image', mediaType: item.contentType,
            data: item.data, name: item.name })),
        ] : text
        requireModelAllowed(ownerId, session.profile?.id)
        const result = await gateway(`/sessions/${encodeURIComponent(sessionId)}/messages`, { method: 'POST',
          body: JSON.stringify({ content, mode }) })
        return { accepted: result?.accepted === true,
          ...(result?.rejected === true && result?.errorCode === 'IMAGE_REJECTED'
            ? { rejected: true, errorCode: 'IMAGE_REJECTED',
              ...(typeof result.imageReasonCode === 'string' ? { imageReasonCode: result.imageReasonCode } : {}) } : {}),
          ...(result?.receiptId ? { receiptId: result.receiptId } : {}),
          ...(result?.steeredReceiptId ? { steeredReceiptId: result.steeredReceiptId } : {}) }
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
    async stopTask({ sessionId, ownerId, requestId, receiptIds, queuedOnly }) {
      requireRuntime()
      if (typeof taskStop !== 'function') fail('CAPABILITY_UNAVAILABLE')
      if (hostOwnerId() !== null && ownerId !== hostOwnerId()) fail('SESSION_READ_ONLY')
      if (typeof requestId !== 'string' || !idPattern.test(requestId) ||
          !Array.isArray(receiptIds) || receiptIds.length < 1 || receiptIds.length > 16 ||
          new Set(receiptIds).size !== receiptIds.length ||
          receiptIds.some((value) => typeof value !== 'string' || !idPattern.test(value))) fail('INVALID_COMMAND')
      await requireSession(sessionId, ownerId)
      const result = await taskStop({ sessionId, requestId, receiptIds, ...(queuedOnly ? { queuedOnly: true } : {}) })
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
          !['personal_read_project_file', 'personal_browser_open', 'personal_browser_follow',
            'personal_browser_read_segment'].includes(readTool) ||
          !['personal_save_document', 'personal_browser_follow',
            'personal_browser_read_segment'].includes(beforeTool) ||
          readCallId === beforeCallId) return false
      try {
        await requireSession(sessionId, hostOwnerId())
        return await toolResultProof({ sessionId, turn, readCallId, snapshotId,
          sourceReceiptId, beforeCallId, readTool, beforeTool }) === true
      } catch { return false }
    },
    async listUserQuestions({ sessionId, ownerId, modelProfileId }) {
      const runtime = captureQuestionRuntime();
      if (hostOwnerId() !== null && ownerId !== hostOwnerId()) fail('SESSION_READ_ONLY');
      const session = await requireSession(sessionId, ownerId);
      requireQuestionRuntime(runtime);
      requireModelAllowed(ownerId, session.profile?.id);
      if (modelProfileId !== undefined && session.profile?.id !== modelProfileId) fail('MODEL_UNAVAILABLE');
      const page = await gateway(`/sessions/${encodeURIComponent(sessionId)}/questions`);
      requireQuestionRuntime(runtime);
      if (!Array.isArray(page?.questions)) fail('BACKEND_UNAVAILABLE');
      return { runtimeId: runtime.runtimeId, questions: page.questions };
    },
    async respondUserQuestion({ ownerId, runtimeId, sessionId, questionRpcId, answer, modelProfileId }) {
      const runtime = captureQuestionRuntime();
      if (runtimeId !== runtime.runtimeId) fail('RUNTIME_UNAVAILABLE');
      if (hostOwnerId() !== null && ownerId !== hostOwnerId()) fail('SESSION_READ_ONLY');
      if (typeof questionRpcId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(questionRpcId) ||
          !answer || !Array.isArray(answer.answers)) fail('INVALID_COMMAND');
      const session = await requireSession(sessionId, ownerId);
      requireQuestionRuntime(runtime);
      requireModelAllowed(ownerId, session.profile?.id);
      if (modelProfileId !== undefined && session.profile?.id !== modelProfileId) fail('MODEL_UNAVAILABLE');
      const result = await gateway(`/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionRpcId)}`, {
        method: 'POST', body: JSON.stringify({ answer }),
      });
      requireQuestionRuntime(runtime);
      if (result?.accepted === true) return { accepted: true };
      if (result?.accepted === false && ['not-pending', 'bad-response'].includes(result.reason)) return { accepted: false, reason: result.reason };
      fail('BACKEND_UNAVAILABLE');
    },
    async getTaskReplyEvidence({ sessionId, rootTaskId, receiptId, turn, ownerId }) {
      const unknown = { status: 'unconfirmed', turn: null, assistantChunks: 0,
        textChunks: 0, reasoningChunks: 0, assistantMessages: 0, toolSaveObserved: false }
      if (typeof replyEvidence !== 'function' || typeof sessionId !== 'string' ||
          !idPattern.test(sessionId) || typeof rootTaskId !== 'string' ||
          !idPattern.test(rootTaskId) || typeof receiptId !== 'string' ||
          !idPattern.test(receiptId) || typeof ownerId !== 'string' ||
          ownerForSession(sessionId) !== ownerId) return unknown
      try {
        const listed = await listSessions()
        if (!Array.isArray(listed?.items) || !listed.items.some((item) =>
          item?.sessionId === sessionId && item.agentPreset === presetForOwner(ownerId))) return unknown
        return await replyEvidence({ sessionId, receiptId, ...(turn === undefined ? {} : { turn }) }) ?? unknown
      } catch { return unknown }
    },
    async getTaskStopState({ sessionId, receiptId, turn, stopRequestedAt, ownerId }) {
      requireRuntime()
      if (typeof sessionId !== 'string' || !idPattern.test(sessionId) ||
          typeof receiptId !== 'string' || !idPattern.test(receiptId) ||
          turn !== undefined && (!Number.isSafeInteger(turn) || turn < 1) ||
          typeof stopRequestedAt !== 'string' || !Number.isFinite(Date.parse(stopRequestedAt))) fail('INVALID_COMMAND')
      if (hostOwnerId() !== null && (ownerId !== hostOwnerId() || ownerForSession(sessionId) !== ownerId)) fail('SESSION_READ_ONLY')
      // Unlike requireSession, this read must reach DSH when the historical
      // session itself is missing. Stored owner binding still fences it.
      const runtimeId = getRuntimeId(), origin = currentOrigin()
      const result = await gateway(`/sessions/${encodeURIComponent(sessionId)}/stop-state?receiptId=${encodeURIComponent(receiptId)}&stopRequestedAt=${encodeURIComponent(stopRequestedAt)}${turn === undefined ? '' : `&turn=${turn}`}`)
      if (getRuntimeId() !== runtimeId || currentOrigin() !== origin) fail('RUNTIME_UNAVAILABLE')
      return result
    },
    async openDesktopApp({ appId, ownerId }) {
      requireRuntime()
      if (presetForOwner(ownerId) !== 'personal-remote') fail('CAPABILITY_UNAVAILABLE')
      if (appId !== 'notepad' || !desktopTask) fail('CAPABILITY_UNAVAILABLE')
      return queue(() => desktopTask.open({ appId }))
    },
    async readSourceEvents({ sessionId, receiptId, turn, ownerId }) {
      requireRuntime()
      if (!idPattern.test(sessionId) || !idPattern.test(receiptId) ||
          turn !== undefined && (!Number.isSafeInteger(turn) || turn < 1)) fail('INVALID_COMMAND')
      const listed = await listSessions()
      if (!listed?.items?.some(item => item.sessionId === sessionId && item.agentPreset === presetForOwner(ownerId)) ||
          hostOwnerId() !== null && ownerForSession(sessionId) !== ownerId) fail('SESSION_UNAVAILABLE')
      return gateway(`/sessions/${encodeURIComponent(sessionId)}/source?receiptId=${encodeURIComponent(receiptId)}${turn === undefined ? '' : `&turn=${turn}`}`)
    },
    async readEvents({ sessionId, afterSeq, beforeSeq, limit = 50 }) {
      requireRuntime()
      if (typeof sessionId !== 'string' || !idPattern.test(sessionId)
        || afterSeq !== undefined && (!Number.isSafeInteger(afterSeq) || afterSeq < -1)
        || beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq < 0)
        || afterSeq !== undefined && beforeSeq !== undefined || !Number.isInteger(limit) || limit < 1 || limit > 200) fail('INVALID_COMMAND')
      const query = `limit=${limit}${afterSeq === undefined ? '' : `&afterSeq=${afterSeq}`}${beforeSeq === undefined ? '' : `&beforeSeq=${beforeSeq}`}`
      return gateway(`/sessions/${encodeURIComponent(sessionId)}/history?${query}`)
    },
    async readEventDetail({ sessionId, seq }) {
      requireRuntime()
      if (!idPattern.test(sessionId) || !Number.isSafeInteger(seq) || seq < 0) fail('INVALID_COMMAND')
      return gateway(`/sessions/${encodeURIComponent(sessionId)}/history?detailSeq=${seq}`)
    },
    async describeSession(sessionId) {
      requireRuntime()
      const listed = await listSessions()
      const item = listed.items.find((row) => row.sessionId === sessionId)
      if (!item) fail('SESSION_UNAVAILABLE')
      return describeItem(item, listed)
    },
    async describeSessions(sessionIds) {
      requireRuntime()
      const listed = await listSessions(), requested = new Set(sessionIds)
      return Promise.all(listed.items.filter(item => requested.has(item.sessionId)).map(item => describeItem(item, listed)))
    },
  }
}
