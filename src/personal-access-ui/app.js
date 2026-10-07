(() => {
  'use strict'

  const authBase = '/personal/v1/auth'
  const accessBase = '/personal/v1'
  const receiptIdPattern = /^[A-Za-z0-9._:-]{1,160}$/
  const views = ['loading', 'owner', 'setup', 'login', 'cloud-wait', 'assistant', 'memory', 'account']
  const byId = (id) => document.getElementById(id)
  const state = { csrfToken: null, account: null, device: null, setupGrant: null, revokeId: null, toastTimer: null,
    ownerId: null, hostId: null, online: false, capabilities: null, models: [], modelProfileId: null,
    sessions: [], selectedSessionId: null, activeChatSource: 'desktop', afterSeq: -1, seenSeq: new Set(), tasks: [], nextBefore: null,
    unresolvedSubmission: false, unresolvedRequests: new Set(), reviewableRequests: new Set(), reviewRequestId: null,
    acknowledgedDesktop: new Set(),
    syncAvailable: false, phonePane: false, phoneEvents: [], phoneAfterSeq: 0, phoneHasMore: true,
    phoneLoading: false, selectedPhoneConversationId: null, phoneDeviceNames: new Map(),
    phoneSending: false, phoneSendNotice: '', phoneDrafts: new Map(), desktopDraft: '',
    refreshTimer: null, refreshing: false,
    submitting: false, cancelSubmitting: false, lastSubmissionMs: 0,
    historyEvents: new Map(), nextBeforeSeq: null, hasOlder: false, olderLoading: false, historyGeneration: 0, historyInFlight: null, historyHasMore: false, turnStatus: null, turnEndReasonKind: null,
    identityGeneration: 0, accountViewGeneration: 0, currentView: null,
    attachmentDrafts: new Map(), attachmentGroups: new Map(), attachmentAttempts: new Map(),
    attachmentUpload: null, attachmentHasher: null, attachmentStatus: '',
    avatarGeneration: 0, avatarSelectionGeneration: 0,
    profileDraftAvatar: undefined, profileConflict: false, profileSaving: false, profileOperationGeneration: 0, profileDraftGeneration: 0,
    avatarChecking: false, avatarObjectUrl: null,
    profileFetchGeneration: 0, deviceFetchGeneration: 0, pendingDeviceFetchGeneration: 0, deviceEditing: null, deviceNotice: '', cachedDevices: [] }
  state.projects = []
  state.projectCanManage = false
  state.projectPending = null
  state.projectFetchGeneration = 0
  state.accountModels = []
  state.accountModelsCanManage = false
  state.accountModelFetchGeneration = 0
  state.accountModelEditing = null
  state.accountModelBusy = false
  state.browserHostId = null
  state.browserAvailable = false
  state.browserFetchGeneration = 0
  state.phoneBindings = new Map()
  state.phoneHostEvents = new Map()
  state.phoneHistoryCursors = new Map()
  state.phoneHandoffBusy = false
  state.phoneHandoffSelections = new Map()
  const memory = { viewGeneration: 0, entryGeneration: 0, queryGeneration: 0, selectedGeneration: 0, operationGeneration: 0,
    status: null, items: [], revision: null, cursor: null, hasMore: false, query: '', kind: 'cognition',
    selected: null, sources: [], mode: 'detail', drafts: new Map(), activeOperation: null,
    unresolvedMarker: null, cleanupMarker: null, cleanupRetrying: false, receiptNotice: null }
  let phonePreview = null
  const conversationTasks = { ownerId: null, identity: -1, generation: 0, entries: new Map(), inFlight: null }
  const conversationApprovals = { scope: null, entries: new Map(), reads: new Map(), operations: new Map(), readGeneration: 0 }
  const conversationQuestions = { scope: null, entries: new Map(), reads: new Map(), operations: new Map(), drafts: new Map(), readGeneration: 0 }
  let voiceInput = null

  function closeModelMenu(restoreFocus = false) {
    byId('model-popover').hidden = true
    byId('model-trigger').setAttribute('aria-expanded', 'false')
    if (restoreFocus) byId('model-trigger').focus()
  }
  function openModelMenu() {
    const trigger = byId('model-trigger')
    if (trigger.disabled) return
    if (!byId('model-popover').hidden) { closeModelMenu(true); return }
    const list = byId('model-options')
    list.replaceChildren()
    for (const model of state.models) {
      const selected = model.id === state.modelProfileId
      const option = element('button', `model-option${selected ? ' is-selected' : ''}`)
      option.type = 'button'
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', String(selected))
      option.tabIndex = selected ? 0 : -1
      const icon = element('span', 'model-option-icon')
      icon.setAttribute('aria-hidden', 'true')
      const check = element('span', 'model-option-check')
      check.setAttribute('aria-hidden', 'true')
      option.append(icon, element('span', 'model-option-name', model.name), check)
      option.addEventListener('click', () => {
        if (byId('model-trigger').disabled || !state.models.some((item) => item.id === model.id)) return
        state.modelProfileId = model.id
        byId('model-select').value = model.id
        closeModelMenu(true)
        updateAvailability()
      })
      list.append(option)
    }
    const popup = byId('model-popover')
    popup.hidden = false
    popup.style.right = '0px'
    const availableHeight = trigger.getBoundingClientRect().top - byId('conversation-pane').getBoundingClientRect().top - 12
    popup.style.maxHeight = `${Math.max(96, Math.min(460, window.innerHeight * .58, availableHeight))}px`
    const bounds = popup.getBoundingClientRect()
    if (bounds.left < 16) popup.style.right = `${bounds.left - 16}px`
    else if (bounds.right > window.innerWidth - 16) popup.style.right = `${bounds.right - window.innerWidth + 16}px`
    trigger.setAttribute('aria-expanded', 'true')
    const selected = [...list.children].find((item) => item.getAttribute('aria-selected') === 'true')
    const focusTarget = selected || list.children[0]
    focusTarget?.focus()
  }
  function stopVoiceInput() {
    if (voiceInput) { const input = voiceInput; voiceInput = null; input.abort() }
    byId('voice-input').classList.remove('is-recording')
    byId('voice-input').setAttribute('aria-pressed', 'false')
    byId('voice-input').setAttribute('aria-label', '语音输入')
  }
  function startVoiceInput() {
    if (voiceInput) { stopVoiceInput(); return }
    if (byId('message-text').disabled) return
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) { toast('当前浏览器不支持语音输入'); return }
    const generation = state.identityGeneration, session = state.selectedSessionId
    const source = state.activeChatSource, conversation = state.selectedPhoneConversationId
    const input = new Recognition()
    voiceInput = input
    input.lang = 'zh-CN'
    input.interimResults = false
    input.onresult = (event) => {
      if (voiceInput !== input || generation !== state.identityGeneration || session !== state.selectedSessionId ||
        source !== state.activeChatSource || conversation !== state.selectedPhoneConversationId) return
      const text = [...event.results].map((result) => result[0]?.transcript || '').join('')
      if (text) {
        const draft = byId('message-text').value
        byId('message-text').value = `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${text}`
        updateAvailability()
      }
    }
    input.onerror = (event) => {
      if (voiceInput === input && event.error !== 'aborted') toast(event.error === 'not-allowed' ? '请允许浏览器使用麦克风后重试' : '语音输入未完成，请重试')
    }
    input.onend = () => { if (voiceInput === input) { voiceInput = null; stopVoiceInput(); byId('message-text').focus() } }
    byId('voice-input').classList.add('is-recording')
    byId('voice-input').setAttribute('aria-pressed', 'true')
    byId('voice-input').setAttribute('aria-label', '停止语音输入')
    try { input.start() } catch { stopVoiceInput(); toast('无法开始语音输入，请重试') }
  }

  function takeSetupGrant() {
    const hash = window.location.hash
    let grant = null
    if (hash.startsWith('#setup=')) {
      try { grant = decodeURIComponent(hash.slice(7)) } catch { /* Invalid grant remains unusable. */ }
    }
    if (hash.startsWith('#setup=')) window.history.replaceState(null, '', window.location.pathname + window.location.search)
    return grant && /^[A-Za-z0-9_-]{16,256}$/.test(grant) ? grant : null
  }
  state.setupGrant = takeSetupGrant()

  function show(view) {
    if (view !== state.currentView) window.WeftDesktop?.closePreview(false)
    byId('account-menu').hidden = true
    closeModelMenu()
    if (view !== 'assistant') stopVoiceInput()
    if (view !== 'assistant' && state.currentView === 'assistant') cancelAttachmentUpload()
    if (state.currentView === 'memory' && view !== 'memory') {
      memory.viewGeneration++
      closeMemoryDetail()
    }
    if (view === 'memory' && state.currentView !== 'memory') memory.viewGeneration++
    if (state.currentView === 'account' && view !== 'account') {
      cloudUi?.stopPairing()
      resetOtherDeviceInstall()
      state.profileOperationGeneration++
      state.profileSaving = false
      state.avatarSelectionGeneration++
      state.avatarChecking = false
      releaseAvatarUrl()
    }
    if (state.currentView !== view) { state.currentView = view; state.accountViewGeneration++; state.avatarGeneration++ }
    for (const name of views) byId(`${name}-view`).hidden = name !== view
    document.body.classList.toggle('assistant-active', view === 'assistant')
  }
  function errorAt(id, message) {
    const element = byId(id)
    element.textContent = message
    element.hidden = !message
  }
  function toast(message) {
    const element = byId('toast')
    element.textContent = message
    element.hidden = false
    if (state.toastTimer) clearTimeout(state.toastTimer)
    state.toastTimer = setTimeout(() => { element.hidden = true; element.textContent = '' }, 5000)
  }
  function clearPasswords(...ids) {
    for (const id of ids) {
      const input = byId(id)
      input.value = ''
      input.type = 'password'
      const reveal = document.querySelector(`.reveal[data-target="${id}"]`)
      if (reveal) { reveal.textContent = '显示'; reveal.setAttribute('aria-label', '显示密码') }
    }
  }
  function clearSession() {
    cloudUi?.cancel()
    document.querySelector('.timeline-preview')?.remove()
    cancelAttachmentUpload()
    stopAssistantRefresh()
    conversationTasks.generation++
    conversationTasks.entries.clear()
    conversationTasks.inFlight = null
    resetConversationApprovals()
    resetConversationQuestions()
    resetMemoryIdentity()
    state.identityGeneration++
    state.avatarGeneration++
    state.avatarSelectionGeneration++
    state.deviceFetchGeneration++
    state.profileFetchGeneration++
    state.profileDraftAvatar = undefined
    state.profileDraftGeneration++
    state.profileConflict = false
    state.profileSaving = false
    state.profileOperationGeneration++
    state.avatarChecking = false
    releaseAvatarUrl()
    state.deviceEditing = null
    state.deviceNotice = ''
    state.cachedDevices = []
    byId('pending-device-list').replaceChildren()
    byId('pending-devices').hidden = true
    byId('pending-device-badge').hidden = true
    byId('profile-display-name').value = ''
    byId('profile-avatar-file').value = ''
    byId('profile-avatar-image').removeAttribute?.('src')
    byId('profile-avatar-image').hidden = true
    byId('profile-avatar-placeholder').hidden = false
    byId('profile-avatar-status').textContent = '支持 PNG、JPEG 或 WebP，最多 128 KiB。选择后先预览，再保存。'
    byId('profile-status').textContent = ''
    errorAt('profile-error', '')
    errorAt('revoke-error', '')
    byId('profile-reload').hidden = true
    byId('logout-button').disabled = false
    setBusy(byId('password-form'), false)
    byId('revoke-confirm').disabled = false
    state.csrfToken = null
    state.account = null
    state.device = null
    byId('account-name').textContent = ''
    byId('rail-account-name').textContent = '我的账户'
    byId('rail-avatar-image').removeAttribute('src'); byId('rail-avatar-image').hidden = true
    byId('rail-avatar-initial').textContent = 'W'; byId('rail-avatar-initial').hidden = false
    byId('session-search').value = ''
    byId('device-list').replaceChildren()
    if (byId('password-dialog').open) byId('password-dialog').close()
    if (byId('revoke-dialog').open) byId('revoke-dialog').close()
    state.revokeId = null
    state.ownerId = null
    state.unresolvedRequests.clear()
    state.reviewableRequests.clear()
    state.reviewRequestId = null
    state.acknowledgedDesktop.clear()
    state.syncAvailable = false
    state.phonePane = false
    state.phoneEvents = []
    state.phoneAfterSeq = 0
    state.phoneHasMore = true
    state.phoneLoading = false
    state.selectedPhoneConversationId = null
    state.activeChatSource = 'desktop'
    state.phoneSending = false
    state.phoneSendNotice = ''
    state.phoneDrafts.clear()
    state.phoneBindings.clear()
    state.phoneHostEvents.clear()
    state.phoneHistoryCursors.clear()
    state.phoneHandoffBusy = false
    state.phoneHandoffSelections.clear()
    state.accountModels = []
    state.accountModelsCanManage = false
    state.accountModelFetchGeneration++
    state.accountModelEditing = null
    state.accountModelBusy = false
    byId('account-model-section').hidden = true
    state.desktopDraft = ''
    state.attachmentDrafts.clear()
    state.attachmentGroups.clear()
    state.attachmentAttempts.clear()
    state.attachmentStatus = ''
    closePhoneImagePreview()
    state.phoneDeviceNames.clear()
    state.hostId = null
    state.online = false
    state.submitting = false
    state.cancelSubmitting = false
    state.capabilities = null
    state.sessions = []
    state.models = []
    state.tasks = []
    state.projects = []
    state.projectCanManage = false
    state.projectPending = null
    state.projectFetchGeneration++
    state.browserHostId = null
    state.browserAvailable = false
    state.browserFetchGeneration++
    state.selectedSessionId = null
    state.afterSeq = -1
    state.historyGeneration++
    state.historyInFlight = null
    state.historyHasMore = false
    state.turnStatus = null
    state.turnEndReasonKind = null
    state.seenSeq.clear()
    byId('timeline-status').textContent = ''
    byId('transcript').replaceChildren()
    byId('session-list').replaceChildren()
    byId('assistant-title').textContent = '新对话'
    byId('projects-list').replaceChildren()
    byId('project-register-form').hidden = true
    byId('browser-workspace-form').hidden = true
    byId('phone-conversations').replaceChildren()
    byId('phone-history').replaceChildren()
    byId('phone-pane').hidden = true
    resetOtherDeviceInstall()
    byId('message-text').value = ''
    byId('message-attachments').value = ''
    renderAttachmentDrafts()
    operation('')
  }
  function setBusy(form, busy) {
    for (const control of form.querySelectorAll('input, button')) control.disabled = busy
  }
  function failureMessage(error, context) {
    switch (error?.code) {
      case 'INVALID_CREDENTIALS': return '账户名或密码不正确。'
      case 'LOGIN_RATE_LIMITED': return '登录尝试过于频繁，请稍后再试。'
      case 'INVALID_SETUP_GRANT': return '设置链接已失效，请在这台电脑上重新发起设置。'
      case 'ACCOUNT_ALREADY_CONFIGURED': return '账户已设置，请直接登录。'
      case 'ACCOUNT_ALREADY_EXISTS': return '这个账户名已经有人使用，请换一个名称或直接登录。'
      case 'FORBIDDEN': return '当前登录没有执行这项操作的权限。'
      case 'UNAUTHORIZED': return '登录已失效，请重新登录。'
      case 'BROWSER_DNS_TIMEOUT': return '网页域名解析超时，本次没有取得可引用的页面正文。'
      case 'BROWSER_DOWNGRADE_BLOCKED': return '网页从 HTTPS 跳到不安全的 HTTP，已阻止继续读取。'
      case 'BROWSER_PAGE_CHANGED': return '网页读取时发生跳转或变化，本次正文不能作为来源，请重试。'
      case 'BROWSER_CLEANUP_FAILED': return '隔离浏览会话清理未能确认，请稍后重新核对网页任务。'
      default: return context === 'network' ? '暂时无法连接宿主，请稍后重试。' : '操作未完成，请重试。'
    }
  }
  async function requestJson(url, { method = 'GET', body, protectedWrite = false } = {}) {
    const headers = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (protectedWrite) {
      if (!state.csrfToken) throw { code: 'UNAUTHORIZED' }
      headers['X-WeftMate-CSRF'] = state.csrfToken
    }
    let response
    try {
      response = await fetch(url, {
        method, headers, credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch { throw { code: 'NETWORK' } }
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw { code: payload?.error?.code || 'REQUEST_FAILED', status: response.status }
    return payload
  }
  const api = (path, options) => requestJson(`${authBase}${path}`, options)
  async function accessApi(path, options) {
    const identityAtStart = state.csrfToken
    try {
      const value = await requestJson(`${accessBase}${path}`, options)
      if (state.csrfToken === identityAtStart && identityAtStart) setOnline(true)
      return value
    } catch (error) {
      if (error.code === 'NETWORK' && state.csrfToken === identityAtStart) setOnline(false)
      if (error.code === 'UNAUTHORIZED' && state.csrfToken === identityAtStart) sessionExpired()
      throw error
    }
  }
  function acceptSession(payload) {
    if (typeof payload?.account?.username !== 'string' || typeof payload?.device?.id !== 'string'
      || typeof payload?.csrfToken !== 'string' || !payload.csrfToken) throw { code: 'REQUEST_FAILED' }
    state.identityGeneration++
    resetConversationApprovals()
    resetConversationQuestions()
    resetMemoryIdentity()
    state.avatarGeneration++
    state.avatarSelectionGeneration++
    state.deviceFetchGeneration++
    state.profileFetchGeneration++
    state.profileOperationGeneration++
    state.profileSaving = false
    state.avatarChecking = false
    releaseAvatarUrl()
    state.profileDraftAvatar = undefined
    state.profileDraftGeneration++
    state.profileConflict = false
    state.deviceEditing = null
    state.account = payload.account
    state.device = payload.device
    state.csrfToken = payload.csrfToken
    void refreshPendingDevices()
    byId('account-name').textContent = payload.account.username
    const name = payload.account.displayName || payload.account.username
    byId('rail-account-name').textContent = name
    byId('rail-avatar-initial').textContent = Array.from(name)[0] || 'W'
    const avatar = payload.account.avatar, image = byId('rail-avatar-image')
    image.hidden = !avatar; byId('rail-avatar-initial').hidden = !!avatar
    if (avatar) image.src = `data:${avatar.mimeType};base64,${avatar.dataBase64}`
    else image.removeAttribute('src')
    if (state.currentView === 'account') resetProfileDraft()
  }
  function accountToken() {
    return { generation: state.identityGeneration, view: state.accountViewGeneration,
      ownerId: state.account?.ownerId, deviceId: state.device?.id, csrf: state.csrfToken }
  }
  function accountCurrent(token) {
    return state.currentView === 'account' && token.generation === state.identityGeneration
      && token.view === state.accountViewGeneration && token.ownerId === state.account?.ownerId
      && token.deviceId === state.device?.id && token.csrf === state.csrfToken
  }
  function accountIdentityCurrent(token) {
    return token.generation === state.identityGeneration && token.ownerId === state.account?.ownerId
      && token.deviceId === state.device?.id && token.csrf === state.csrfToken
  }
  const publicPlatformQrData = Object.freeze({
    android: "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MSA0MSIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJhbmRyb2lkIGRvd25sb2FkIFFSIGNvZGUiIHNoYXBlLXJlbmRlcmluZz0iY3Jpc3BFZGdlcyI+PHRpdGxlPldlZnRNYXRlIGFuZHJvaWQgZG93bmxvYWQgcGFnZTwvdGl0bGU+PGRlc2M+aHR0cHM6Ly93d3cud2VmdG1hdGUuY29tL2Rvd25sb2Fkcy8/cGxhdGZvcm09YW5kcm9pZDwvZGVzYz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMCwwaDQxdjQxSDB6Ii8+PHBhdGggZmlsbD0iIzExMSIgZD0iTTQsNGgxdjFoLTF6TTUsNGgxdjFoLTF6TTYsNGgxdjFoLTF6TTcsNGgxdjFoLTF6TTgsNGgxdjFoLTF6TTksNGgxdjFoLTF6TTEwLDRoMXYxaC0xek0xMyw0aDF2MWgtMXpNMTQsNGgxdjFoLTF6TTE1LDRoMXYxaC0xek0xNiw0aDF2MWgtMXpNMTcsNGgxdjFoLTF6TTIwLDRoMXYxaC0xek0yMSw0aDF2MWgtMXpNMjIsNGgxdjFoLTF6TTIzLDRoMXYxaC0xek0yNCw0aDF2MWgtMXpNMjcsNGgxdjFoLTF6TTMwLDRoMXYxaC0xek0zMSw0aDF2MWgtMXpNMzIsNGgxdjFoLTF6TTMzLDRoMXYxaC0xek0zNCw0aDF2MWgtMXpNMzUsNGgxdjFoLTF6TTM2LDRoMXYxaC0xek00LDVoMXYxaC0xek0xMCw1aDF2MWgtMXpNMTMsNWgxdjFoLTF6TTE0LDVoMXYxaC0xek0xNSw1aDF2MWgtMXpNMTcsNWgxdjFoLTF6TTE4LDVoMXYxaC0xek0xOSw1aDF2MWgtMXpNMjEsNWgxdjFoLTF6TTI1LDVoMXYxaC0xek0yNiw1aDF2MWgtMXpNMzAsNWgxdjFoLTF6TTM2LDVoMXYxaC0xek00LDZoMXYxaC0xek02LDZoMXYxaC0xek03LDZoMXYxaC0xek04LDZoMXYxaC0xek0xMCw2aDF2MWgtMXpNMTIsNmgxdjFoLTF6TTE1LDZoMXYxaC0xek0xNiw2aDF2MWgtMXpNMTcsNmgxdjFoLTF6TTIwLDZoMXYxaC0xek0yMSw2aDF2MWgtMXpNMjIsNmgxdjFoLTF6TTIzLDZoMXYxaC0xek0yNCw2aDF2MWgtMXpNMjUsNmgxdjFoLTF6TTI2LDZoMXYxaC0xek0yNyw2aDF2MWgtMXpNMzAsNmgxdjFoLTF6TTMyLDZoMXYxaC0xek0zMyw2aDF2MWgtMXpNMzQsNmgxdjFoLTF6TTM2LDZoMXYxaC0xek00LDdoMXYxaC0xek02LDdoMXYxaC0xek03LDdoMXYxaC0xek04LDdoMXYxaC0xek0xMCw3aDF2MWgtMXpNMTIsN2gxdjFoLTF6TTEzLDdoMXYxaC0xek0xNCw3aDF2MWgtMXpNMTYsN2gxdjFoLTF6TTE4LDdoMXYxaC0xek0yMCw3aDF2MWgtMXpNMjMsN2gxdjFoLTF6TTI2LDdoMXYxaC0xek0zMCw3aDF2MWgtMXpNMzIsN2gxdjFoLTF6TTMzLDdoMXYxaC0xek0zNCw3aDF2MWgtMXpNMzYsN2gxdjFoLTF6TTQsOGgxdjFoLTF6TTYsOGgxdjFoLTF6TTcsOGgxdjFoLTF6TTgsOGgxdjFoLTF6TTEwLDhoMXYxaC0xek0xMiw4aDF2MWgtMXpNMTUsOGgxdjFoLTF6TTE2LDhoMXYxaC0xek0xNyw4aDF2MWgtMXpNMTksOGgxdjFoLTF6TTIyLDhoMXYxaC0xek0yNSw4aDF2MWgtMXpNMjcsOGgxdjFoLTF6TTI4LDhoMXYxaC0xek0zMCw4aDF2MWgtMXpNMzIsOGgxdjFoLTF6TTMzLDhoMXYxaC0xek0zNCw4aDF2MWgtMXpNMzYsOGgxdjFoLTF6TTQsOWgxdjFoLTF6TTEwLDloMXYxaC0xek0xMiw5aDF2MWgtMXpNMTYsOWgxdjFoLTF6TTE4LDloMXYxaC0xek0xOSw5aDF2MWgtMXpNMjAsOWgxdjFoLTF6TTIxLDloMXYxaC0xek0yMiw5aDF2MWgtMXpNMjUsOWgxdjFoLTF6TTI2LDloMXYxaC0xek0zMCw5aDF2MWgtMXpNMzYsOWgxdjFoLTF6TTQsMTBoMXYxaC0xek01LDEwaDF2MWgtMXpNNiwxMGgxdjFoLTF6TTcsMTBoMXYxaC0xek04LDEwaDF2MWgtMXpNOSwxMGgxdjFoLTF6TTEwLDEwaDF2MWgtMXpNMTIsMTBoMXYxaC0xek0xNCwxMGgxdjFoLTF6TTE2LDEwaDF2MWgtMXpNMTgsMTBoMXYxaC0xek0yMCwxMGgxdjFoLTF6TTIyLDEwaDF2MWgtMXpNMjQsMTBoMXYxaC0xek0yNiwxMGgxdjFoLTF6TTI4LDEwaDF2MWgtMXpNMzAsMTBoMXYxaC0xek0zMSwxMGgxdjFoLTF6TTMyLDEwaDF2MWgtMXpNMzMsMTBoMXYxaC0xek0zNCwxMGgxdjFoLTF6TTM1LDEwaDF2MWgtMXpNMzYsMTBoMXYxaC0xek0xMiwxMWgxdjFoLTF6TTEzLDExaDF2MWgtMXpNMTQsMTFoMXYxaC0xek0xNSwxMWgxdjFoLTF6TTE5LDExaDF2MWgtMXpNMjQsMTFoMXYxaC0xek0yNSwxMWgxdjFoLTF6TTI2LDExaDF2MWgtMXpNNCwxMmgxdjFoLTF6TTYsMTJoMXYxaC0xek03LDEyaDF2MWgtMXpNOCwxMmgxdjFoLTF6TTksMTJoMXYxaC0xek0xMCwxMmgxdjFoLTF6TTE1LDEyaDF2MWgtMXpNMTcsMTJoMXYxaC0xek0xOCwxMmgxdjFoLTF6TTE5LDEyaDF2MWgtMXpNMjEsMTJoMXYxaC0xek0yNiwxMmgxdjFoLTF6TTI3LDEyaDF2MWgtMXpNMzAsMTJoMXYxaC0xek0zMSwxMmgxdjFoLTF6TTMyLDEyaDF2MWgtMXpNMzMsMTJoMXYxaC0xek0zNCwxMmgxdjFoLTF6TTQsMTNoMXYxaC0xek03LDEzaDF2MWgtMXpNOCwxM2gxdjFoLTF6TTExLDEzaDF2MWgtMXpNMTMsMTNoMXYxaC0xek0xNSwxM2gxdjFoLTF6TTE2LDEzaDF2MWgtMXpNMjAsMTNoMXYxaC0xek0yMiwxM2gxdjFoLTF6TTIzLDEzaDF2MWgtMXpNMjUsMTNoMXYxaC0xek0yNywxM2gxdjFoLTF6TTMwLDEzaDF2MWgtMXpNMzEsMTNoMXYxaC0xek0zMywxM2gxdjFoLTF6TTM0LDEzaDF2MWgtMXpNMzUsMTNoMXYxaC0xek0zNiwxM2gxdjFoLTF6TTQsMTRoMXYxaC0xek01LDE0aDF2MWgtMXpNMTAsMTRoMXYxaC0xek0xMiwxNGgxdjFoLTF6TTEzLDE0aDF2MWgtMXpNMTQsMTRoMXYxaC0xek0xNSwxNGgxdjFoLTF6TTE5LDE0aDF2MWgtMXpNMjAsMTRoMXYxaC0xek0yMiwxNGgxdjFoLTF6TTI0LDE0aDF2MWgtMXpNMjUsMTRoMXYxaC0xek0yOCwxNGgxdjFoLTF6TTMyLDE0aDF2MWgtMXpNMzQsMTRoMXYxaC0xek0zNSwxNGgxdjFoLTF6TTYsMTVoMXYxaC0xek03LDE1aDF2MWgtMXpNMTQsMTVoMXYxaC0xek0xOCwxNWgxdjFoLTF6TTIwLDE1aDF2MWgtMXpNMjQsMTVoMXYxaC0xek0yNSwxNWgxdjFoLTF6TTI2LDE1aDF2MWgtMXpNMjcsMTVoMXYxaC0xek0yOSwxNWgxdjFoLTF6TTMyLDE1aDF2MWgtMXpNMzMsMTVoMXYxaC0xek0zNCwxNWgxdjFoLTF6TTQsMTZoMXYxaC0xek01LDE2aDF2MWgtMXpNNiwxNmgxdjFoLTF6TTcsMTZoMXYxaC0xek04LDE2aDF2MWgtMXpNMTAsMTZoMXYxaC0xek0xMywxNmgxdjFoLTF6TTE0LDE2aDF2MWgtMXpNMTksMTZoMXYxaC0xek0yMiwxNmgxdjFoLTF6TTI2LDE2aDF2MWgtMXpNMjcsMTZoMXYxaC0xek0yOCwxNmgxdjFoLTF6TTI5LDE2aDF2MWgtMXpNMzEsMTZoMXYxaC0xek0zMiwxNmgxdjFoLTF6TTMzLDE2aDF2MWgtMXpNMzUsMTZoMXYxaC0xek02LDE3aDF2MWgtMXpNNywxN2gxdjFoLTF6TTExLDE3aDF2MWgtMXpNMTIsMTdoMXYxaC0xek0xNCwxN2gxdjFoLTF6TTE2LDE3aDF2MWgtMXpNMTcsMTdoMXYxaC0xek0xOCwxN2gxdjFoLTF6TTE5LDE3aDF2MWgtMXpNMjAsMTdoMXYxaC0xek0yMSwxN2gxdjFoLTF6TTIzLDE3aDF2MWgtMXpNMjQsMTdoMXYxaC0xek0yNSwxN2gxdjFoLTF6TTI3LDE3aDF2MWgtMXpNMjksMTdoMXYxaC0xek0zMCwxN2gxdjFoLTF6TTM0LDE3aDF2MWgtMXpNMzUsMTdoMXYxaC0xek0zNiwxN2gxdjFoLTF6TTcsMThoMXYxaC0xek0xMCwxOGgxdjFoLTF6TTEyLDE4aDF2MWgtMXpNMTUsMThoMXYxaC0xek0xNiwxOGgxdjFoLTF6TTE4LDE4aDF2MWgtMXpNMjEsMThoMXYxaC0xek0yNCwxOGgxdjFoLTF6TTI2LDE4aDF2MWgtMXpNMjgsMThoMXYxaC0xek0yOSwxOGgxdjFoLTF6TTMwLDE4aDF2MWgtMXpNMzEsMThoMXYxaC0xek0zMywxOGgxdjFoLTF6TTM1LDE4aDF2MWgtMXpNNiwxOWgxdjFoLTF6TTcsMTloMXYxaC0xek04LDE5aDF2MWgtMXpNOSwxOWgxdjFoLTF6TTExLDE5aDF2MWgtMXpNMTIsMTloMXYxaC0xek0xNCwxOWgxdjFoLTF6TTE1LDE5aDF2MWgtMXpNMTcsMTloMXYxaC0xek0yMCwxOWgxdjFoLTF6TTI1LDE5aDF2MWgtMXpNMjcsMTloMXYxaC0xek0yOCwxOWgxdjFoLTF6TTI5LDE5aDF2MWgtMXpNMzAsMTloMXYxaC0xek0zMiwxOWgxdjFoLTF6TTM0LDE5aDF2MWgtMXpNNCwyMGgxdjFoLTF6TTYsMjBoMXYxaC0xek0xMCwyMGgxdjFoLTF6TTE0LDIwaDF2MWgtMXpNMTcsMjBoMXYxaC0xek0xOCwyMGgxdjFoLTF6TTIwLDIwaDF2MWgtMXpNMjEsMjBoMXYxaC0xek0yMywyMGgxdjFoLTF6TTI2LDIwaDF2MWgtMXpNMjgsMjBoMXYxaC0xek0yOSwyMGgxdjFoLTF6TTMxLDIwaDF2MWgtMXpNMzIsMjBoMXYxaC0xek0zNiwyMGgxdjFoLTF6TTQsMjFoMXYxaC0xek03LDIxaDF2MWgtMXpNOSwyMWgxdjFoLTF6TTEyLDIxaDF2MWgtMXpNMTMsMjFoMXYxaC0xek0xNCwyMWgxdjFoLTF6TTIwLDIxaDF2MWgtMXpNMjEsMjFoMXYxaC0xek0yMiwyMWgxdjFoLTF6TTIzLDIxaDF2MWgtMXpNMjQsMjFoMXYxaC0xek0yNiwyMWgxdjFoLTF6TTI3LDIxaDF2MWgtMXpNMjgsMjFoMXYxaC0xek0yOSwyMWgxdjFoLTF6TTMwLDIxaDF2MWgtMXpNMzEsMjFoMXYxaC0xek0zMywyMWgxdjFoLTF6TTM0LDIxaDF2MWgtMXpNMzYsMjFoMXYxaC0xek02LDIyaDF2MWgtMXpNOSwyMmgxdjFoLTF6TTEwLDIyaDF2MWgtMXpNMTYsMjJoMXYxaC0xek0xOSwyMmgxdjFoLTF6TTIwLDIyaDF2MWgtMXpNMjEsMjJoMXYxaC0xek0yNiwyMmgxdjFoLTF6TTI5LDIyaDF2MWgtMXpNMzEsMjJoMXYxaC0xek0zMiwyMmgxdjFoLTF6TTM0LDIyaDF2MWgtMXpNMzUsMjJoMXYxaC0xek00LDIzaDF2MWgtMXpNNywyM2gxdjFoLTF6TTExLDIzaDF2MWgtMXpNMTIsMjNoMXYxaC0xek0xNSwyM2gxdjFoLTF6TTE4LDIzaDF2MWgtMXpNMjAsMjNoMXYxaC0xek0yMSwyM2gxdjFoLTF6TTIyLDIzaDF2MWgtMXpNMjQsMjNoMXYxaC0xek0yNSwyM2gxdjFoLTF6TTI3LDIzaDF2MWgtMXpNMzEsMjNoMXYxaC0xek0zMiwyM2gxdjFoLTF6TTMzLDIzaDF2MWgtMXpNMzQsMjNoMXYxaC0xek0zNSwyM2gxdjFoLTF6TTQsMjRoMXYxaC0xek05LDI0aDF2MWgtMXpNMTAsMjRoMXYxaC0xek0xMiwyNGgxdjFoLTF6TTEzLDI0aDF2MWgtMXpNMTQsMjRoMXYxaC0xek0xNywyNGgxdjFoLTF6TTE4LDI0aDF2MWgtMXpNMjAsMjRoMXYxaC0xek0yNiwyNGgxdjFoLTF6TTI5LDI0aDF2MWgtMXpNMzEsMjRoMXYxaC0xek0zMiwyNGgxdjFoLTF6TTMzLDI0aDF2MWgtMXpNNCwyNWgxdjFoLTF6TTcsMjVoMXYxaC0xek0xNiwyNWgxdjFoLTF6TTE5LDI1aDF2MWgtMXpNMjEsMjVoMXYxaC0xek0yMiwyNWgxdjFoLTF6TTIzLDI1aDF2MWgtMXpNMjQsMjVoMXYxaC0xek0yNSwyNWgxdjFoLTF6TTI3LDI1aDF2MWgtMXpNMzAsMjVoMXYxaC0xek0zMywyNWgxdjFoLTF6TTM2LDI1aDF2MWgtMXpNNCwyNmgxdjFoLTF6TTYsMjZoMXYxaC0xek03LDI2aDF2MWgtMXpNOSwyNmgxdjFoLTF6TTEwLDI2aDF2MWgtMXpNMTEsMjZoMXYxaC0xek0xMywyNmgxdjFoLTF6TTE0LDI2aDF2MWgtMXpNMTYsMjZoMXYxaC0xek0xOCwyNmgxdjFoLTF6TTE5LDI2aDF2MWgtMXpNMjAsMjZoMXYxaC0xek0yNCwyNmgxdjFoLTF6TTI1LDI2aDF2MWgtMXpNMjYsMjZoMXYxaC0xek0yOSwyNmgxdjFoLTF6TTMxLDI2aDF2MWgtMXpNMzMsMjZoMXYxaC0xek0zNSwyNmgxdjFoLTF6TTQsMjdoMXYxaC0xek02LDI3aDF2MWgtMXpNOCwyN2gxdjFoLTF6TTExLDI3aDF2MWgtMXpNMTIsMjdoMXYxaC0xek0xMywyN2gxdjFoLTF6TTE2LDI3aDF2MWgtMXpNMTgsMjdoMXYxaC0xek0xOSwyN2gxdjFoLTF6TTIzLDI3aDF2MWgtMXpNMjQsMjdoMXYxaC0xek0yNSwyN2gxdjFoLTF6TTI3LDI3aDF2MWgtMXpNMjksMjdoMXYxaC0xek0zMCwyN2gxdjFoLTF6TTMxLDI3aDF2MWgtMXpNMzQsMjdoMXYxaC0xek00LDI4aDF2MWgtMXpNNiwyOGgxdjFoLTF6TTcsMjhoMXYxaC0xek04LDI4aDF2MWgtMXpNMTAsMjhoMXYxaC0xek0xMiwyOGgxdjFoLTF6TTEzLDI4aDF2MWgtMXpNMTQsMjhoMXYxaC0xek0xNywyOGgxdjFoLTF6TTE4LDI4aDF2MWgtMXpNMTksMjhoMXYxaC0xek0yMSwyOGgxdjFoLTF6TTIyLDI4aDF2MWgtMXpNMjMsMjhoMXYxaC0xek0yNCwyOGgxdjFoLTF6TTI2LDI4aDF2MWgtMXpNMjcsMjhoMXYxaC0xek0yOCwyOGgxdjFoLTF6TTI5LDI4aDF2MWgtMXpNMzAsMjhoMXYxaC0xek0zMSwyOGgxdjFoLTF6TTMyLDI4aDF2MWgtMXpNMzMsMjhoMXYxaC0xek0zNSwyOGgxdjFoLTF6TTEyLDI5aDF2MWgtMXpNMTMsMjloMXYxaC0xek0xNCwyOWgxdjFoLTF6TTE1LDI5aDF2MWgtMXpNMTgsMjloMXYxaC0xek0yMCwyOWgxdjFoLTF6TTIyLDI5aDF2MWgtMXpNMjMsMjloMXYxaC0xek0yNCwyOWgxdjFoLTF6TTI1LDI5aDF2MWgtMXpNMjcsMjloMXYxaC0xek0yOCwyOWgxdjFoLTF6TTMyLDI5aDF2MWgtMXpNMzQsMjloMXYxaC0xek0zNiwyOWgxdjFoLTF6TTQsMzBoMXYxaC0xek01LDMwaDF2MWgtMXpNNiwzMGgxdjFoLTF6TTcsMzBoMXYxaC0xek04LDMwaDF2MWgtMXpNOSwzMGgxdjFoLTF6TTEwLDMwaDF2MWgtMXpNMTMsMzBoMXYxaC0xek0xNCwzMGgxdjFoLTF6TTE1LDMwaDF2MWgtMXpNMTYsMzBoMXYxaC0xek0xNywzMGgxdjFoLTF6TTE5LDMwaDF2MWgtMXpNMjIsMzBoMXYxaC0xek0yNCwzMGgxdjFoLTF6TTI1LDMwaDF2MWgtMXpNMjYsMzBoMXYxaC0xek0yNywzMGgxdjFoLTF6TTI4LDMwaDF2MWgtMXpNMzAsMzBoMXYxaC0xek0zMiwzMGgxdjFoLTF6TTM0LDMwaDF2MWgtMXpNMzUsMzBoMXYxaC0xek00LDMxaDF2MWgtMXpNMTAsMzFoMXYxaC0xek0xMiwzMWgxdjFoLTF6TTEzLDMxaDF2MWgtMXpNMTQsMzFoMXYxaC0xek0xOSwzMWgxdjFoLTF6TTIwLDMxaDF2MWgtMXpNMjUsMzFoMXYxaC0xek0yNywzMWgxdjFoLTF6TTI4LDMxaDF2MWgtMXpNMzIsMzFoMXYxaC0xek0zMywzMWgxdjFoLTF6TTM0LDMxaDF2MWgtMXpNMzUsMzFoMXYxaC0xek0zNiwzMWgxdjFoLTF6TTQsMzJoMXYxaC0xek02LDMyaDF2MWgtMXpNNywzMmgxdjFoLTF6TTgsMzJoMXYxaC0xek0xMCwzMmgxdjFoLTF6TTEyLDMyaDF2MWgtMXpNMTMsMzJoMXYxaC0xek0xNCwzMmgxdjFoLTF6TTE1LDMyaDF2MWgtMXpNMTYsMzJoMXYxaC0xek0xNywzMmgxdjFoLTF6TTE4LDMyaDF2MWgtMXpNMTksMzJoMXYxaC0xek0yMiwzMmgxdjFoLTF6TTI2LDMyaDF2MWgtMXpNMjgsMzJoMXYxaC0xek0yOSwzMmgxdjFoLTF6TTMwLDMyaDF2MWgtMXpNMzEsMzJoMXYxaC0xek0zMiwzMmgxdjFoLTF6TTMzLDMyaDF2MWgtMXpNMzUsMzJoMXYxaC0xek0zNiwzMmgxdjFoLTF6TTQsMzNoMXYxaC0xek02LDMzaDF2MWgtMXpNNywzM2gxdjFoLTF6TTgsMzNoMXYxaC0xek0xMCwzM2gxdjFoLTF6TTEyLDMzaDF2MWgtMXpNMTMsMzNoMXYxaC0xek0xNSwzM2gxdjFoLTF6TTE2LDMzaDF2MWgtMXpNMTgsMzNoMXYxaC0xek0xOSwzM2gxdjFoLTF6TTIwLDMzaDF2MWgtMXpNMjEsMzNoMXYxaC0xek0yMywzM2gxdjFoLTF6TTI0LDMzaDF2MWgtMXpNMjYsMzNoMXYxaC0xek0yNywzM2gxdjFoLTF6TTI5LDMzaDF2MWgtMXpNMzIsMzNoMXYxaC0xek0zMywzM2gxdjFoLTF6TTM1LDMzaDF2MWgtMXpNMzYsMzNoMXYxaC0xek00LDM0aDF2MWgtMXpNNiwzNGgxdjFoLTF6TTcsMzRoMXYxaC0xek04LDM0aDF2MWgtMXpNMTAsMzRoMXYxaC0xek0xMiwzNGgxdjFoLTF6TTE3LDM0aDF2MWgtMXpNMjEsMzRoMXYxaC0xek0yNSwzNGgxdjFoLTF6TTI2LDM0aDF2MWgtMXpNMjcsMzRoMXYxaC0xek0yOCwzNGgxdjFoLTF6TTI5LDM0aDF2MWgtMXpNMzAsMzRoMXYxaC0xek0zMSwzNGgxdjFoLTF6TTMzLDM0aDF2MWgtMXpNNCwzNWgxdjFoLTF6TTEwLDM1aDF2MWgtMXpNMTQsMzVoMXYxaC0xek0xOCwzNWgxdjFoLTF6TTIwLDM1aDF2MWgtMXpNMjMsMzVoMXYxaC0xek0yNSwzNWgxdjFoLTF6TTI2LDM1aDF2MWgtMXpNMjksMzVoMXYxaC0xek0zMiwzNWgxdjFoLTF6TTMzLDM1aDF2MWgtMXpNMzQsMzVoMXYxaC0xek00LDM2aDF2MWgtMXpNNSwzNmgxdjFoLTF6TTYsMzZoMXYxaC0xek03LDM2aDF2MWgtMXpNOCwzNmgxdjFoLTF6TTksMzZoMXYxaC0xek0xMCwzNmgxdjFoLTF6TTEyLDM2aDF2MWgtMXpNMTMsMzZoMXYxaC0xek0xNSwzNmgxdjFoLTF6TTE3LDM2aDF2MWgtMXpNMjEsMzZoMXYxaC0xek0yNiwzNmgxdjFoLTF6TTI3LDM2aDF2MWgtMXpNMjgsMzZoMXYxaC0xek0zMCwzNmgxdjFoLTF6TTMxLDM2aDF2MWgtMXpNMzMsMzZoMXYxaC0xek0zNSwzNmgxdjFoLTF6Ii8+PC9zdmc+Cg==",
    macos: "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MSA0MSIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJtYWNvcyBkb3dubG9hZCBRUiBjb2RlIiBzaGFwZS1yZW5kZXJpbmc9ImNyaXNwRWRnZXMiPjx0aXRsZT5XZWZ0TWF0ZSBtYWNvcyBkb3dubG9hZCBwYWdlPC90aXRsZT48ZGVzYz5odHRwczovL3d3dy53ZWZ0bWF0ZS5jb20vZG93bmxvYWRzLz9wbGF0Zm9ybT1tYWNvczwvZGVzYz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMCwwaDQxdjQxSDB6Ii8+PHBhdGggZmlsbD0iIzExMSIgZD0iTTQsNGgxdjFoLTF6TTUsNGgxdjFoLTF6TTYsNGgxdjFoLTF6TTcsNGgxdjFoLTF6TTgsNGgxdjFoLTF6TTksNGgxdjFoLTF6TTEwLDRoMXYxaC0xek0xNCw0aDF2MWgtMXpNMTYsNGgxdjFoLTF6TTE3LDRoMXYxaC0xek0yMCw0aDF2MWgtMXpNMjEsNGgxdjFoLTF6TTIyLDRoMXYxaC0xek0yMyw0aDF2MWgtMXpNMjQsNGgxdjFoLTF6TTI3LDRoMXYxaC0xek0zMCw0aDF2MWgtMXpNMzEsNGgxdjFoLTF6TTMyLDRoMXYxaC0xek0zMyw0aDF2MWgtMXpNMzQsNGgxdjFoLTF6TTM1LDRoMXYxaC0xek0zNiw0aDF2MWgtMXpNNCw1aDF2MWgtMXpNMTAsNWgxdjFoLTF6TTEzLDVoMXYxaC0xek0xNCw1aDF2MWgtMXpNMTcsNWgxdjFoLTF6TTE4LDVoMXYxaC0xek0xOSw1aDF2MWgtMXpNMjEsNWgxdjFoLTF6TTI1LDVoMXYxaC0xek0yNiw1aDF2MWgtMXpNMzAsNWgxdjFoLTF6TTM2LDVoMXYxaC0xek00LDZoMXYxaC0xek02LDZoMXYxaC0xek03LDZoMXYxaC0xek04LDZoMXYxaC0xek0xMCw2aDF2MWgtMXpNMTIsNmgxdjFoLTF6TTEzLDZoMXYxaC0xek0xNCw2aDF2MWgtMXpNMTUsNmgxdjFoLTF6TTE2LDZoMXYxaC0xek0xNyw2aDF2MWgtMXpNMjAsNmgxdjFoLTF6TTIxLDZoMXYxaC0xek0yMiw2aDF2MWgtMXpNMjMsNmgxdjFoLTF6TTI0LDZoMXYxaC0xek0yNSw2aDF2MWgtMXpNMjYsNmgxdjFoLTF6TTI3LDZoMXYxaC0xek0zMCw2aDF2MWgtMXpNMzIsNmgxdjFoLTF6TTMzLDZoMXYxaC0xek0zNCw2aDF2MWgtMXpNMzYsNmgxdjFoLTF6TTQsN2gxdjFoLTF6TTYsN2gxdjFoLTF6TTcsN2gxdjFoLTF6TTgsN2gxdjFoLTF6TTEwLDdoMXYxaC0xek0xMiw3aDF2MWgtMXpNMTMsN2gxdjFoLTF6TTE0LDdoMXYxaC0xek0xNiw3aDF2MWgtMXpNMTgsN2gxdjFoLTF6TTIwLDdoMXYxaC0xek0yMyw3aDF2MWgtMXpNMjQsN2gxdjFoLTF6TTI2LDdoMXYxaC0xek0zMCw3aDF2MWgtMXpNMzIsN2gxdjFoLTF6TTMzLDdoMXYxaC0xek0zNCw3aDF2MWgtMXpNMzYsN2gxdjFoLTF6TTQsOGgxdjFoLTF6TTYsOGgxdjFoLTF6TTcsOGgxdjFoLTF6TTgsOGgxdjFoLTF6TTEwLDhoMXYxaC0xek0xMiw4aDF2MWgtMXpNMTQsOGgxdjFoLTF6TTE3LDhoMXYxaC0xek0xOSw4aDF2MWgtMXpNMjIsOGgxdjFoLTF6TTI1LDhoMXYxaC0xek0yNyw4aDF2MWgtMXpNMjgsOGgxdjFoLTF6TTMwLDhoMXYxaC0xek0zMiw4aDF2MWgtMXpNMzMsOGgxdjFoLTF6TTM0LDhoMXYxaC0xek0zNiw4aDF2MWgtMXpNNCw5aDF2MWgtMXpNMTAsOWgxdjFoLTF6TTEyLDloMXYxaC0xek0xMyw5aDF2MWgtMXpNMTQsOWgxdjFoLTF6TTE4LDloMXYxaC0xek0xOSw5aDF2MWgtMXpNMjAsOWgxdjFoLTF6TTIxLDloMXYxaC0xek0yMiw5aDF2MWgtMXpNMjQsOWgxdjFoLTF6TTI1LDloMXYxaC0xek0yNiw5aDF2MWgtMXpNMzAsOWgxdjFoLTF6TTM2LDloMXYxaC0xek00LDEwaDF2MWgtMXpNNSwxMGgxdjFoLTF6TTYsMTBoMXYxaC0xek03LDEwaDF2MWgtMXpNOCwxMGgxdjFoLTF6TTksMTBoMXYxaC0xek0xMCwxMGgxdjFoLTF6TTEyLDEwaDF2MWgtMXpNMTQsMTBoMXYxaC0xek0xNiwxMGgxdjFoLTF6TTE4LDEwaDF2MWgtMXpNMjAsMTBoMXYxaC0xek0yMiwxMGgxdjFoLTF6TTI0LDEwaDF2MWgtMXpNMjYsMTBoMXYxaC0xek0yOCwxMGgxdjFoLTF6TTMwLDEwaDF2MWgtMXpNMzEsMTBoMXYxaC0xek0zMiwxMGgxdjFoLTF6TTMzLDEwaDF2MWgtMXpNMzQsMTBoMXYxaC0xek0zNSwxMGgxdjFoLTF6TTM2LDEwaDF2MWgtMXpNMTIsMTFoMXYxaC0xek0xNCwxMWgxdjFoLTF6TTE2LDExaDF2MWgtMXpNMTksMTFoMXYxaC0xek0yNSwxMWgxdjFoLTF6TTI2LDExaDF2MWgtMXpNNCwxMmgxdjFoLTF6TTYsMTJoMXYxaC0xek03LDEyaDF2MWgtMXpNOCwxMmgxdjFoLTF6TTksMTJoMXYxaC0xek0xMCwxMmgxdjFoLTF6TTEzLDEyaDF2MWgtMXpNMTQsMTJoMXYxaC0xek0xNSwxMmgxdjFoLTF6TTE2LDEyaDF2MWgtMXpNMTcsMTJoMXYxaC0xek0xOCwxMmgxdjFoLTF6TTE5LDEyaDF2MWgtMXpNMjEsMTJoMXYxaC0xek0yNiwxMmgxdjFoLTF6TTI3LDEyaDF2MWgtMXpNMzAsMTJoMXYxaC0xek0zMSwxMmgxdjFoLTF6TTMyLDEyaDF2MWgtMXpNMzMsMTJoMXYxaC0xek0zNCwxMmgxdjFoLTF6TTUsMTNoMXYxaC0xek03LDEzaDF2MWgtMXpNMTEsMTNoMXYxaC0xek0xMiwxM2gxdjFoLTF6TTEzLDEzaDF2MWgtMXpNMTUsMTNoMXYxaC0xek0xNiwxM2gxdjFoLTF6TTIwLDEzaDF2MWgtMXpNMjIsMTNoMXYxaC0xek0yMywxM2gxdjFoLTF6TTI3LDEzaDF2MWgtMXpNMzAsMTNoMXYxaC0xek0zMSwxM2gxdjFoLTF6TTMzLDEzaDF2MWgtMXpNMzQsMTNoMXYxaC0xek0zNSwxM2gxdjFoLTF6TTM2LDEzaDF2MWgtMXpNNSwxNGgxdjFoLTF6TTksMTRoMXYxaC0xek0xMCwxNGgxdjFoLTF6TTE1LDE0aDF2MWgtMXpNMTksMTRoMXYxaC0xek0yMCwxNGgxdjFoLTF6TTIyLDE0aDF2MWgtMXpNMjQsMTRoMXYxaC0xek0yNSwxNGgxdjFoLTF6TTI2LDE0aDF2MWgtMXpNMjgsMTRoMXYxaC0xek0zMiwxNGgxdjFoLTF6TTM0LDE0aDF2MWgtMXpNMzUsMTRoMXYxaC0xek00LDE1aDF2MWgtMXpNNSwxNWgxdjFoLTF6TTcsMTVoMXYxaC0xek04LDE1aDF2MWgtMXpNMTEsMTVoMXYxaC0xek0xMiwxNWgxdjFoLTF6TTE1LDE1aDF2MWgtMXpNMTgsMTVoMXYxaC0xek0yMCwxNWgxdjFoLTF6TTI0LDE1aDF2MWgtMXpNMjUsMTVoMXYxaC0xek0yNiwxNWgxdjFoLTF6TTI3LDE1aDF2MWgtMXpNMjksMTVoMXYxaC0xek0zMiwxNWgxdjFoLTF6TTMzLDE1aDF2MWgtMXpNMzQsMTVoMXYxaC0xek05LDE2aDF2MWgtMXpNMTAsMTZoMXYxaC0xek0xMSwxNmgxdjFoLTF6TTEyLDE2aDF2MWgtMXpNMTQsMTZoMXYxaC0xek0xNSwxNmgxdjFoLTF6TTE5LDE2aDF2MWgtMXpNMjIsMTZoMXYxaC0xek0yNiwxNmgxdjFoLTF6TTI3LDE2aDF2MWgtMXpNMjgsMTZoMXYxaC0xek0yOSwxNmgxdjFoLTF6TTMxLDE2aDF2MWgtMXpNMzIsMTZoMXYxaC0xek0zMywxNmgxdjFoLTF6TTM1LDE2aDF2MWgtMXpNNCwxN2gxdjFoLTF6TTUsMTdoMXYxaC0xek03LDE3aDF2MWgtMXpNOCwxN2gxdjFoLTF6TTEyLDE3aDF2MWgtMXpNMTMsMTdoMXYxaC0xek0xNCwxN2gxdjFoLTF6TTE1LDE3aDF2MWgtMXpNMTYsMTdoMXYxaC0xek0xNywxN2gxdjFoLTF6TTE4LDE3aDF2MWgtMXpNMTksMTdoMXYxaC0xek0yMCwxN2gxdjFoLTF6TTIxLDE3aDF2MWgtMXpNMjQsMTdoMXYxaC0xek0yNSwxN2gxdjFoLTF6TTI3LDE3aDF2MWgtMXpNMjksMTdoMXYxaC0xek0zMCwxN2gxdjFoLTF6TTM0LDE3aDF2MWgtMXpNMzUsMTdoMXYxaC0xek0zNiwxN2gxdjFoLTF6TTgsMThoMXYxaC0xek0xMCwxOGgxdjFoLTF6TTExLDE4aDF2MWgtMXpNMTMsMThoMXYxaC0xek0xNywxOGgxdjFoLTF6TTIxLDE4aDF2MWgtMXpNMjMsMThoMXYxaC0xek0yNiwxOGgxdjFoLTF6TTI4LDE4aDF2MWgtMXpNMjksMThoMXYxaC0xek0zMCwxOGgxdjFoLTF6TTMxLDE4aDF2MWgtMXpNMzMsMThoMXYxaC0xek0zNSwxOGgxdjFoLTF6TTYsMTloMXYxaC0xek04LDE5aDF2MWgtMXpNOSwxOWgxdjFoLTF6TTExLDE5aDF2MWgtMXpNMTYsMTloMXYxaC0xek0xNywxOWgxdjFoLTF6TTIwLDE5aDF2MWgtMXpNMjMsMTloMXYxaC0xek0yNCwxOWgxdjFoLTF6TTI1LDE5aDF2MWgtMXpNMjcsMTloMXYxaC0xek0yOCwxOWgxdjFoLTF6TTI5LDE5aDF2MWgtMXpNMzAsMTloMXYxaC0xek0zMiwxOWgxdjFoLTF6TTM0LDE5aDF2MWgtMXpNNCwyMGgxdjFoLTF6TTUsMjBoMXYxaC0xek02LDIwaDF2MWgtMXpNOSwyMGgxdjFoLTF6TTEwLDIwaDF2MWgtMXpNMTEsMjBoMXYxaC0xek0xMiwyMGgxdjFoLTF6TTEzLDIwaDF2MWgtMXpNMTcsMjBoMXYxaC0xek0yMCwyMGgxdjFoLTF6TTIxLDIwaDF2MWgtMXpNMjMsMjBoMXYxaC0xek0yNiwyMGgxdjFoLTF6TTI4LDIwaDF2MWgtMXpNMjksMjBoMXYxaC0xek0zMSwyMGgxdjFoLTF6TTMyLDIwaDF2MWgtMXpNMzYsMjBoMXYxaC0xek00LDIxaDF2MWgtMXpNMTIsMjFoMXYxaC0xek0xNCwyMWgxdjFoLTF6TTE2LDIxaDF2MWgtMXpNMTcsMjFoMXYxaC0xek0yMCwyMWgxdjFoLTF6TTIxLDIxaDF2MWgtMXpNMjIsMjFoMXYxaC0xek0yMywyMWgxdjFoLTF6TTI0LDIxaDF2MWgtMXpNMjUsMjFoMXYxaC0xek0yNiwyMWgxdjFoLTF6TTI3LDIxaDF2MWgtMXpNMjgsMjFoMXYxaC0xek0yOSwyMWgxdjFoLTF6TTMwLDIxaDF2MWgtMXpNMzEsMjFoMXYxaC0xek0zMywyMWgxdjFoLTF6TTM0LDIxaDF2MWgtMXpNMzYsMjFoMXYxaC0xek00LDIyaDF2MWgtMXpNNiwyMmgxdjFoLTF6TTcsMjJoMXYxaC0xek05LDIyaDF2MWgtMXpNMTAsMjJoMXYxaC0xek0xNCwyMmgxdjFoLTF6TTE1LDIyaDF2MWgtMXpNMTgsMjJoMXYxaC0xek0xOSwyMmgxdjFoLTF6TTIwLDIyaDF2MWgtMXpNMjEsMjJoMXYxaC0xek0yNSwyMmgxdjFoLTF6TTI5LDIyaDF2MWgtMXpNMzEsMjJoMXYxaC0xek0zMiwyMmgxdjFoLTF6TTM0LDIyaDF2MWgtMXpNMzUsMjJoMXYxaC0xek01LDIzaDF2MWgtMXpNNiwyM2gxdjFoLTF6TTcsMjNoMXYxaC0xek0xMSwyM2gxdjFoLTF6TTEyLDIzaDF2MWgtMXpNMTUsMjNoMXYxaC0xek0xNywyM2gxdjFoLTF6TTE4LDIzaDF2MWgtMXpNMjAsMjNoMXYxaC0xek0yMSwyM2gxdjFoLTF6TTIyLDIzaDF2MWgtMXpNMjQsMjNoMXYxaC0xek0yNSwyM2gxdjFoLTF6TTI2LDIzaDF2MWgtMXpNMjcsMjNoMXYxaC0xek0zMSwyM2gxdjFoLTF6TTMyLDIzaDF2MWgtMXpNMzMsMjNoMXYxaC0xek0zNCwyM2gxdjFoLTF6TTM1LDIzaDF2MWgtMXpNNCwyNGgxdjFoLTF6TTgsMjRoMXYxaC0xek05LDI0aDF2MWgtMXpNMTAsMjRoMXYxaC0xek0xNCwyNGgxdjFoLTF6TTE1LDI0aDF2MWgtMXpNMTcsMjRoMXYxaC0xek0yMCwyNGgxdjFoLTF6TTI2LDI0aDF2MWgtMXpNMjksMjRoMXYxaC0xek0zMSwyNGgxdjFoLTF6TTMyLDI0aDF2MWgtMXpNMzMsMjRoMXYxaC0xek00LDI1aDF2MWgtMXpNNSwyNWgxdjFoLTF6TTYsMjVoMXYxaC0xek04LDI1aDF2MWgtMXpNOSwyNWgxdjFoLTF6TTEzLDI1aDF2MWgtMXpNMTUsMjVoMXYxaC0xek0xNiwyNWgxdjFoLTF6TTE5LDI1aDF2MWgtMXpNMjEsMjVoMXYxaC0xek0yMiwyNWgxdjFoLTF6TTI1LDI1aDF2MWgtMXpNMjcsMjVoMXYxaC0xek0zMCwyNWgxdjFoLTF6TTMzLDI1aDF2MWgtMXpNMzYsMjVoMXYxaC0xek00LDI2aDF2MWgtMXpNNywyNmgxdjFoLTF6TTksMjZoMXYxaC0xek0xMCwyNmgxdjFoLTF6TTEzLDI2aDF2MWgtMXpNMTQsMjZoMXYxaC0xek0xNywyNmgxdjFoLTF6TTE4LDI2aDF2MWgtMXpNMTksMjZoMXYxaC0xek0yMCwyNmgxdjFoLTF6TTI0LDI2aDF2MWgtMXpNMjUsMjZoMXYxaC0xek0yNiwyNmgxdjFoLTF6TTI5LDI2aDF2MWgtMXpNMzEsMjZoMXYxaC0xek0zMywyNmgxdjFoLTF6TTM1LDI2aDF2MWgtMXpNNCwyN2gxdjFoLTF6TTgsMjdoMXYxaC0xek0xMywyN2gxdjFoLTF6TTE0LDI3aDF2MWgtMXpNMTksMjdoMXYxaC0xek0yMywyN2gxdjFoLTF6TTI1LDI3aDF2MWgtMXpNMjcsMjdoMXYxaC0xek0yOSwyN2gxdjFoLTF6TTMwLDI3aDF2MWgtMXpNMzEsMjdoMXYxaC0xek0zNCwyN2gxdjFoLTF6TTM2LDI3aDF2MWgtMXpNNCwyOGgxdjFoLTF6TTYsMjhoMXYxaC0xek03LDI4aDF2MWgtMXpNOCwyOGgxdjFoLTF6TTEwLDI4aDF2MWgtMXpNMTIsMjhoMXYxaC0xek0xNSwyOGgxdjFoLTF6TTE2LDI4aDF2MWgtMXpNMTksMjhoMXYxaC0xek0yMSwyOGgxdjFoLTF6TTIyLDI4aDF2MWgtMXpNMjQsMjhoMXYxaC0xek0yNiwyOGgxdjFoLTF6TTI3LDI4aDF2MWgtMXpNMjgsMjhoMXYxaC0xek0yOSwyOGgxdjFoLTF6TTMwLDI4aDF2MWgtMXpNMzEsMjhoMXYxaC0xek0zMiwyOGgxdjFoLTF6TTMzLDI4aDF2MWgtMXpNMTIsMjloMXYxaC0xek0xMywyOWgxdjFoLTF6TTE1LDI5aDF2MWgtMXpNMTcsMjloMXYxaC0xek0xOCwyOWgxdjFoLTF6TTIwLDI5aDF2MWgtMXpNMjIsMjloMXYxaC0xek0yMywyOWgxdjFoLTF6TTI0LDI5aDF2MWgtMXpNMjUsMjloMXYxaC0xek0yNywyOWgxdjFoLTF6TTI4LDI5aDF2MWgtMXpNMzIsMjloMXYxaC0xek0zNCwyOWgxdjFoLTF6TTM2LDI5aDF2MWgtMXpNNCwzMGgxdjFoLTF6TTUsMzBoMXYxaC0xek02LDMwaDF2MWgtMXpNNywzMGgxdjFoLTF6TTgsMzBoMXYxaC0xek05LDMwaDF2MWgtMXpNMTAsMzBoMXYxaC0xek0xMywzMGgxdjFoLTF6TTE2LDMwaDF2MWgtMXpNMTcsMzBoMXYxaC0xek0xOCwzMGgxdjFoLTF6TTE5LDMwaDF2MWgtMXpNMjIsMzBoMXYxaC0xek0yNCwzMGgxdjFoLTF6TTI3LDMwaDF2MWgtMXpNMjgsMzBoMXYxaC0xek0zMCwzMGgxdjFoLTF6TTMyLDMwaDF2MWgtMXpNMzQsMzBoMXYxaC0xek0zNSwzMGgxdjFoLTF6TTQsMzFoMXYxaC0xek0xMCwzMWgxdjFoLTF6TTEyLDMxaDF2MWgtMXpNMTQsMzFoMXYxaC0xek0xNSwzMWgxdjFoLTF6TTE2LDMxaDF2MWgtMXpNMTcsMzFoMXYxaC0xek0xOSwzMWgxdjFoLTF6TTIwLDMxaDF2MWgtMXpNMjUsMzFoMXYxaC0xek0yNiwzMWgxdjFoLTF6TTI3LDMxaDF2MWgtMXpNMjgsMzFoMXYxaC0xek0zMiwzMWgxdjFoLTF6TTMzLDMxaDF2MWgtMXpNMzQsMzFoMXYxaC0xek0zNSwzMWgxdjFoLTF6TTM2LDMxaDF2MWgtMXpNNCwzMmgxdjFoLTF6TTYsMzJoMXYxaC0xek03LDMyaDF2MWgtMXpNOCwzMmgxdjFoLTF6TTEwLDMyaDF2MWgtMXpNMTIsMzJoMXYxaC0xek0xMywzMmgxdjFoLTF6TTE0LDMyaDF2MWgtMXpNMTUsMzJoMXYxaC0xek0xNiwzMmgxdjFoLTF6TTE4LDMyaDF2MWgtMXpNMTksMzJoMXYxaC0xek0yMiwzMmgxdjFoLTF6TTI0LDMyaDF2MWgtMXpNMjYsMzJoMXYxaC0xek0yOCwzMmgxdjFoLTF6TTI5LDMyaDF2MWgtMXpNMzAsMzJoMXYxaC0xek0zMSwzMmgxdjFoLTF6TTMyLDMyaDF2MWgtMXpNMzMsMzJoMXYxaC0xek0zNSwzMmgxdjFoLTF6TTM2LDMyaDF2MWgtMXpNNCwzM2gxdjFoLTF6TTYsMzNoMXYxaC0xek03LDMzaDF2MWgtMXpNOCwzM2gxdjFoLTF6TTEwLDMzaDF2MWgtMXpNMTIsMzNoMXYxaC0xek0xMywzM2gxdjFoLTF6TTE0LDMzaDF2MWgtMXpNMTUsMzNoMXYxaC0xek0xNiwzM2gxdjFoLTF6TTE3LDMzaDF2MWgtMXpNMTksMzNoMXYxaC0xek0yMCwzM2gxdjFoLTF6TTIxLDMzaDF2MWgtMXpNMjMsMzNoMXYxaC0xek0yNCwzM2gxdjFoLTF6TTI3LDMzaDF2MWgtMXpNMjksMzNoMXYxaC0xek0zMiwzM2gxdjFoLTF6TTMzLDMzaDF2MWgtMXpNMzUsMzNoMXYxaC0xek0zNiwzM2gxdjFoLTF6TTQsMzRoMXYxaC0xek02LDM0aDF2MWgtMXpNNywzNGgxdjFoLTF6TTgsMzRoMXYxaC0xek0xMCwzNGgxdjFoLTF6TTEyLDM0aDF2MWgtMXpNMTMsMzRoMXYxaC0xek0xNywzNGgxdjFoLTF6TTE4LDM0aDF2MWgtMXpNMjEsMzRoMXYxaC0xek0yNCwzNGgxdjFoLTF6TTI1LDM0aDF2MWgtMXpNMjYsMzRoMXYxaC0xek0yNywzNGgxdjFoLTF6TTI4LDM0aDF2MWgtMXpNMjksMzRoMXYxaC0xek0zMCwzNGgxdjFoLTF6TTMxLDM0aDF2MWgtMXpNMzMsMzRoMXYxaC0xek00LDM1aDF2MWgtMXpNMTAsMzVoMXYxaC0xek0xMywzNWgxdjFoLTF6TTE0LDM1aDF2MWgtMXpNMTYsMzVoMXYxaC0xek0xNywzNWgxdjFoLTF6TTE4LDM1aDF2MWgtMXpNMjAsMzVoMXYxaC0xek0yMywzNWgxdjFoLTF6TTI0LDM1aDF2MWgtMXpNMjUsMzVoMXYxaC0xek0yNiwzNWgxdjFoLTF6TTI5LDM1aDF2MWgtMXpNMzIsMzVoMXYxaC0xek0zMywzNWgxdjFoLTF6TTM0LDM1aDF2MWgtMXpNNCwzNmgxdjFoLTF6TTUsMzZoMXYxaC0xek02LDM2aDF2MWgtMXpNNywzNmgxdjFoLTF6TTgsMzZoMXYxaC0xek05LDM2aDF2MWgtMXpNMTAsMzZoMXYxaC0xek0xMiwzNmgxdjFoLTF6TTEzLDM2aDF2MWgtMXpNMTQsMzZoMXYxaC0xek0xNSwzNmgxdjFoLTF6TTE4LDM2aDF2MWgtMXpNMjEsMzZoMXYxaC0xek0yMywzNmgxdjFoLTF6TTI2LDM2aDF2MWgtMXpNMjcsMzZoMXYxaC0xek0yOCwzNmgxdjFoLTF6TTMwLDM2aDF2MWgtMXpNMzEsMzZoMXYxaC0xek0zMywzNmgxdjFoLTF6TTM1LDM2aDF2MWgtMXoiLz48L3N2Zz4K",
    ios: "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MSA0MSIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJpb3MgZG93bmxvYWQgUVIgY29kZSIgc2hhcGUtcmVuZGVyaW5nPSJjcmlzcEVkZ2VzIj48dGl0bGU+V2VmdE1hdGUgaW9zIGRvd25sb2FkIHBhZ2U8L3RpdGxlPjxkZXNjPmh0dHBzOi8vd3d3LndlZnRtYXRlLmNvbS9kb3dubG9hZHMvP3BsYXRmb3JtPWlvczwvZGVzYz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMCwwaDQxdjQxSDB6Ii8+PHBhdGggZmlsbD0iIzExMSIgZD0iTTQsNGgxdjFoLTF6TTUsNGgxdjFoLTF6TTYsNGgxdjFoLTF6TTcsNGgxdjFoLTF6TTgsNGgxdjFoLTF6TTksNGgxdjFoLTF6TTEwLDRoMXYxaC0xek0xMyw0aDF2MWgtMXpNMTQsNGgxdjFoLTF6TTE1LDRoMXYxaC0xek0xNyw0aDF2MWgtMXpNMjAsNGgxdjFoLTF6TTIxLDRoMXYxaC0xek0yMiw0aDF2MWgtMXpNMjMsNGgxdjFoLTF6TTI0LDRoMXYxaC0xek0yNyw0aDF2MWgtMXpNMzAsNGgxdjFoLTF6TTMxLDRoMXYxaC0xek0zMiw0aDF2MWgtMXpNMzMsNGgxdjFoLTF6TTM0LDRoMXYxaC0xek0zNSw0aDF2MWgtMXpNMzYsNGgxdjFoLTF6TTQsNWgxdjFoLTF6TTEwLDVoMXYxaC0xek0xNCw1aDF2MWgtMXpNMTcsNWgxdjFoLTF6TTE4LDVoMXYxaC0xek0xOSw1aDF2MWgtMXpNMjEsNWgxdjFoLTF6TTI1LDVoMXYxaC0xek0yNiw1aDF2MWgtMXpNMzAsNWgxdjFoLTF6TTM2LDVoMXYxaC0xek00LDZoMXYxaC0xek02LDZoMXYxaC0xek03LDZoMXYxaC0xek04LDZoMXYxaC0xek0xMCw2aDF2MWgtMXpNMTIsNmgxdjFoLTF6TTEzLDZoMXYxaC0xek0xNSw2aDF2MWgtMXpNMTYsNmgxdjFoLTF6TTE3LDZoMXYxaC0xek0yMCw2aDF2MWgtMXpNMjEsNmgxdjFoLTF6TTIyLDZoMXYxaC0xek0yMyw2aDF2MWgtMXpNMjQsNmgxdjFoLTF6TTI1LDZoMXYxaC0xek0yNiw2aDF2MWgtMXpNMjcsNmgxdjFoLTF6TTMwLDZoMXYxaC0xek0zMiw2aDF2MWgtMXpNMzMsNmgxdjFoLTF6TTM0LDZoMXYxaC0xek0zNiw2aDF2MWgtMXpNNCw3aDF2MWgtMXpNNiw3aDF2MWgtMXpNNyw3aDF2MWgtMXpNOCw3aDF2MWgtMXpNMTAsN2gxdjFoLTF6TTEyLDdoMXYxaC0xek0xNiw3aDF2MWgtMXpNMTgsN2gxdjFoLTF6TTIwLDdoMXYxaC0xek0yMyw3aDF2MWgtMXpNMjQsN2gxdjFoLTF6TTI2LDdoMXYxaC0xek0zMCw3aDF2MWgtMXpNMzIsN2gxdjFoLTF6TTMzLDdoMXYxaC0xek0zNCw3aDF2MWgtMXpNMzYsN2gxdjFoLTF6TTQsOGgxdjFoLTF6TTYsOGgxdjFoLTF6TTcsOGgxdjFoLTF6TTgsOGgxdjFoLTF6TTEwLDhoMXYxaC0xek0xMiw4aDF2MWgtMXpNMTMsOGgxdjFoLTF6TTE0LDhoMXYxaC0xek0xNiw4aDF2MWgtMXpNMTcsOGgxdjFoLTF6TTE5LDhoMXYxaC0xek0yMiw4aDF2MWgtMXpNMjUsOGgxdjFoLTF6TTI3LDhoMXYxaC0xek0yOCw4aDF2MWgtMXpNMzAsOGgxdjFoLTF6TTMyLDhoMXYxaC0xek0zMyw4aDF2MWgtMXpNMzQsOGgxdjFoLTF6TTM2LDhoMXYxaC0xek00LDloMXYxaC0xek0xMCw5aDF2MWgtMXpNMTIsOWgxdjFoLTF6TTEzLDloMXYxaC0xek0xNiw5aDF2MWgtMXpNMTgsOWgxdjFoLTF6TTE5LDloMXYxaC0xek0yMCw5aDF2MWgtMXpNMjEsOWgxdjFoLTF6TTIyLDloMXYxaC0xek0yNCw5aDF2MWgtMXpNMjUsOWgxdjFoLTF6TTI2LDloMXYxaC0xek0zMCw5aDF2MWgtMXpNMzYsOWgxdjFoLTF6TTQsMTBoMXYxaC0xek01LDEwaDF2MWgtMXpNNiwxMGgxdjFoLTF6TTcsMTBoMXYxaC0xek04LDEwaDF2MWgtMXpNOSwxMGgxdjFoLTF6TTEwLDEwaDF2MWgtMXpNMTIsMTBoMXYxaC0xek0xNCwxMGgxdjFoLTF6TTE2LDEwaDF2MWgtMXpNMTgsMTBoMXYxaC0xek0yMCwxMGgxdjFoLTF6TTIyLDEwaDF2MWgtMXpNMjQsMTBoMXYxaC0xek0yNiwxMGgxdjFoLTF6TTI4LDEwaDF2MWgtMXpNMzAsMTBoMXYxaC0xek0zMSwxMGgxdjFoLTF6TTMyLDEwaDF2MWgtMXpNMzMsMTBoMXYxaC0xek0zNCwxMGgxdjFoLTF6TTM1LDEwaDF2MWgtMXpNMzYsMTBoMXYxaC0xek0xMiwxMWgxdjFoLTF6TTE2LDExaDF2MWgtMXpNMTksMTFoMXYxaC0xek0yNSwxMWgxdjFoLTF6TTI2LDExaDF2MWgtMXpNNCwxMmgxdjFoLTF6TTYsMTJoMXYxaC0xek03LDEyaDF2MWgtMXpNOCwxMmgxdjFoLTF6TTksMTJoMXYxaC0xek0xMCwxMmgxdjFoLTF6TTEzLDEyaDF2MWgtMXpNMTQsMTJoMXYxaC0xek0xNiwxMmgxdjFoLTF6TTE3LDEyaDF2MWgtMXpNMTgsMTJoMXYxaC0xek0xOSwxMmgxdjFoLTF6TTIxLDEyaDF2MWgtMXpNMjYsMTJoMXYxaC0xek0yNywxMmgxdjFoLTF6TTMwLDEyaDF2MWgtMXpNMzEsMTJoMXYxaC0xek0zMiwxMmgxdjFoLTF6TTMzLDEyaDF2MWgtMXpNMzQsMTJoMXYxaC0xek01LDEzaDF2MWgtMXpNOCwxM2gxdjFoLTF6TTksMTNoMXYxaC0xek0xNCwxM2gxdjFoLTF6TTE1LDEzaDF2MWgtMXpNMjAsMTNoMXYxaC0xek0yMiwxM2gxdjFoLTF6TTIzLDEzaDF2MWgtMXpNMjcsMTNoMXYxaC0xek0zMCwxM2gxdjFoLTF6TTMxLDEzaDF2MWgtMXpNMzMsMTNoMXYxaC0xek0zNCwxM2gxdjFoLTF6TTM1LDEzaDF2MWgtMXpNMzYsMTNoMXYxaC0xek00LDE0aDF2MWgtMXpNNywxNGgxdjFoLTF6TTgsMTRoMXYxaC0xek05LDE0aDF2MWgtMXpNMTAsMTRoMXYxaC0xek0xNSwxNGgxdjFoLTF6TTE2LDE0aDF2MWgtMXpNMTksMTRoMXYxaC0xek0yMCwxNGgxdjFoLTF6TTIyLDE0aDF2MWgtMXpNMjQsMTRoMXYxaC0xek0yNSwxNGgxdjFoLTF6TTI4LDE0aDF2MWgtMXpNMzIsMTRoMXYxaC0xek0zNCwxNGgxdjFoLTF6TTM1LDE0aDF2MWgtMXpNNCwxNWgxdjFoLTF6TTUsMTVoMXYxaC0xek03LDE1aDF2MWgtMXpNOCwxNWgxdjFoLTF6TTksMTVoMXYxaC0xek0xMiwxNWgxdjFoLTF6TTE0LDE1aDF2MWgtMXpNMTUsMTVoMXYxaC0xek0xOCwxNWgxdjFoLTF6TTIwLDE1aDF2MWgtMXpNMjQsMTVoMXYxaC0xek0yNSwxNWgxdjFoLTF6TTI2LDE1aDF2MWgtMXpNMjcsMTVoMXYxaC0xek0yOSwxNWgxdjFoLTF6TTMyLDE1aDF2MWgtMXpNMzMsMTVoMXYxaC0xek0zNCwxNWgxdjFoLTF6TTUsMTZoMXYxaC0xek02LDE2aDF2MWgtMXpNOCwxNmgxdjFoLTF6TTksMTZoMXYxaC0xek0xMCwxNmgxdjFoLTF6TTE5LDE2aDF2MWgtMXpNMjIsMTZoMXYxaC0xek0yNiwxNmgxdjFoLTF6TTI3LDE2aDF2MWgtMXpNMjgsMTZoMXYxaC0xek0yOSwxNmgxdjFoLTF6TTMxLDE2aDF2MWgtMXpNMzIsMTZoMXYxaC0xek0zMywxNmgxdjFoLTF6TTM1LDE2aDF2MWgtMXpNNCwxN2gxdjFoLTF6TTYsMTdoMXYxaC0xek04LDE3aDF2MWgtMXpNMTYsMTdoMXYxaC0xek0xOCwxN2gxdjFoLTF6TTE5LDE3aDF2MWgtMXpNMjAsMTdoMXYxaC0xek0yMSwxN2gxdjFoLTF6TTI0LDE3aDF2MWgtMXpNMjUsMTdoMXYxaC0xek0yNywxN2gxdjFoLTF6TTI5LDE3aDF2MWgtMXpNMzAsMTdoMXYxaC0xek0zNCwxN2gxdjFoLTF6TTM1LDE3aDF2MWgtMXpNMzYsMTdoMXYxaC0xek00LDE4aDF2MWgtMXpNNSwxOGgxdjFoLTF6TTksMThoMXYxaC0xek0xMCwxOGgxdjFoLTF6TTEyLDE4aDF2MWgtMXpNMTMsMThoMXYxaC0xek0xNSwxOGgxdjFoLTF6TTE2LDE4aDF2MWgtMXpNMTcsMThoMXYxaC0xek0xOCwxOGgxdjFoLTF6TTIxLDE4aDF2MWgtMXpNMjMsMThoMXYxaC0xek0yNiwxOGgxdjFoLTF6TTI4LDE4aDF2MWgtMXpNMjksMThoMXYxaC0xek0zMCwxOGgxdjFoLTF6TTMxLDE4aDF2MWgtMXpNMzMsMThoMXYxaC0xek0zNSwxOGgxdjFoLTF6TTQsMTloMXYxaC0xek01LDE5aDF2MWgtMXpNNiwxOWgxdjFoLTF6TTgsMTloMXYxaC0xek05LDE5aDF2MWgtMXpNMTIsMTloMXYxaC0xek0xMywxOWgxdjFoLTF6TTE0LDE5aDF2MWgtMXpNMTUsMTloMXYxaC0xek0xNiwxOWgxdjFoLTF6TTE3LDE5aDF2MWgtMXpNMTgsMTloMXYxaC0xek0yMCwxOWgxdjFoLTF6TTIzLDE5aDF2MWgtMXpNMjQsMTloMXYxaC0xek0yNSwxOWgxdjFoLTF6TTI3LDE5aDF2MWgtMXpNMjgsMTloMXYxaC0xek0yOSwxOWgxdjFoLTF6TTMwLDE5aDF2MWgtMXpNMzIsMTloMXYxaC0xek0zNCwxOWgxdjFoLTF6TTQsMjBoMXYxaC0xek02LDIwaDF2MWgtMXpNNywyMGgxdjFoLTF6TTgsMjBoMXYxaC0xek05LDIwaDF2MWgtMXpNMTAsMjBoMXYxaC0xek0xMiwyMGgxdjFoLTF6TTEzLDIwaDF2MWgtMXpNMTgsMjBoMXYxaC0xek0yMCwyMGgxdjFoLTF6TTIxLDIwaDF2MWgtMXpNMjMsMjBoMXYxaC0xek0yNiwyMGgxdjFoLTF6TTI4LDIwaDF2MWgtMXpNMjksMjBoMXYxaC0xek0zMSwyMGgxdjFoLTF6TTMyLDIwaDF2MWgtMXpNMzYsMjBoMXYxaC0xek02LDIxaDF2MWgtMXpNNywyMWgxdjFoLTF6TTgsMjFoMXYxaC0xek05LDIxaDF2MWgtMXpNMTgsMjFoMXYxaC0xek0yMCwyMWgxdjFoLTF6TTIxLDIxaDF2MWgtMXpNMjIsMjFoMXYxaC0xek0yMywyMWgxdjFoLTF6TTI0LDIxaDF2MWgtMXpNMjYsMjFoMXYxaC0xek0yNywyMWgxdjFoLTF6TTI4LDIxaDF2MWgtMXpNMjksMjFoMXYxaC0xek0zMCwyMWgxdjFoLTF6TTMxLDIxaDF2MWgtMXpNMzMsMjFoMXYxaC0xek0zNCwyMWgxdjFoLTF6TTM2LDIxaDF2MWgtMXpNNSwyMmgxdjFoLTF6TTYsMjJoMXYxaC0xek03LDIyaDF2MWgtMXpNOCwyMmgxdjFoLTF6TTksMjJoMXYxaC0xek0xMCwyMmgxdjFoLTF6TTEyLDIyaDF2MWgtMXpNMTMsMjJoMXYxaC0xek0xNSwyMmgxdjFoLTF6TTE2LDIyaDF2MWgtMXpNMTcsMjJoMXYxaC0xek0xOCwyMmgxdjFoLTF6TTE5LDIyaDF2MWgtMXpNMjAsMjJoMXYxaC0xek0yMSwyMmgxdjFoLTF6TTI2LDIyaDF2MWgtMXpNMjksMjJoMXYxaC0xek0zMSwyMmgxdjFoLTF6TTMyLDIyaDF2MWgtMXpNMzQsMjJoMXYxaC0xek0zNSwyMmgxdjFoLTF6TTQsMjNoMXYxaC0xek05LDIzaDF2MWgtMXpNMTMsMjNoMXYxaC0xek0xNCwyM2gxdjFoLTF6TTE2LDIzaDF2MWgtMXpNMTgsMjNoMXYxaC0xek0yMCwyM2gxdjFoLTF6TTIxLDIzaDF2MWgtMXpNMjIsMjNoMXYxaC0xek0yNCwyM2gxdjFoLTF6TTI1LDIzaDF2MWgtMXpNMjYsMjNoMXYxaC0xek0yNywyM2gxdjFoLTF6TTMxLDIzaDF2MWgtMXpNMzIsMjNoMXYxaC0xek0zMywyM2gxdjFoLTF6TTM0LDIzaDF2MWgtMXpNMzUsMjNoMXYxaC0xek01LDI0aDF2MWgtMXpNNiwyNGgxdjFoLTF6TTcsMjRoMXYxaC0xek0xMCwyNGgxdjFoLTF6TTExLDI0aDF2MWgtMXpNMTMsMjRoMXYxaC0xek0xNCwyNGgxdjFoLTF6TTE1LDI0aDF2MWgtMXpNMTYsMjRoMXYxaC0xek0xNywyNGgxdjFoLTF6TTE4LDI0aDF2MWgtMXpNMjAsMjRoMXYxaC0xek0yNCwyNGgxdjFoLTF6TTI2LDI0aDF2MWgtMXpNMjksMjRoMXYxaC0xek0zMSwyNGgxdjFoLTF6TTMyLDI0aDF2MWgtMXpNMzMsMjRoMXYxaC0xek00LDI1aDF2MWgtMXpNNSwyNWgxdjFoLTF6TTYsMjVoMXYxaC0xek0xNCwyNWgxdjFoLTF6TTE1LDI1aDF2MWgtMXpNMTYsMjVoMXYxaC0xek0xOCwyNWgxdjFoLTF6TTE5LDI1aDF2MWgtMXpNMjEsMjVoMXYxaC0xek0yMiwyNWgxdjFoLTF6TTI1LDI1aDF2MWgtMXpNMjYsMjVoMXYxaC0xek0yNywyNWgxdjFoLTF6TTMwLDI1aDF2MWgtMXpNMzMsMjVoMXYxaC0xek0zNiwyNWgxdjFoLTF6TTQsMjZoMXYxaC0xek03LDI2aDF2MWgtMXpNOSwyNmgxdjFoLTF6TTEwLDI2aDF2MWgtMXpNMTEsMjZoMXYxaC0xek0xMywyNmgxdjFoLTF6TTE0LDI2aDF2MWgtMXpNMTUsMjZoMXYxaC0xek0xNiwyNmgxdjFoLTF6TTE3LDI2aDF2MWgtMXpNMTgsMjZoMXYxaC0xek0xOSwyNmgxdjFoLTF6TTIwLDI2aDF2MWgtMXpNMjQsMjZoMXYxaC0xek0yNSwyNmgxdjFoLTF6TTI2LDI2aDF2MWgtMXpNMjksMjZoMXYxaC0xek0zMSwyNmgxdjFoLTF6TTMzLDI2aDF2MWgtMXpNMzUsMjZoMXYxaC0xek00LDI3aDF2MWgtMXpNNywyN2gxdjFoLTF6TTExLDI3aDF2MWgtMXpNMTIsMjdoMXYxaC0xek0xMywyN2gxdjFoLTF6TTE0LDI3aDF2MWgtMXpNMTUsMjdoMXYxaC0xek0xNiwyN2gxdjFoLTF6TTE4LDI3aDF2MWgtMXpNMTksMjdoMXYxaC0xek0yNSwyN2gxdjFoLTF6TTI3LDI3aDF2MWgtMXpNMjksMjdoMXYxaC0xek0zMCwyN2gxdjFoLTF6TTMxLDI3aDF2MWgtMXpNMzQsMjdoMXYxaC0xek00LDI4aDF2MWgtMXpNNiwyOGgxdjFoLTF6TTEwLDI4aDF2MWgtMXpNMTEsMjhoMXYxaC0xek0xMywyOGgxdjFoLTF6TTE0LDI4aDF2MWgtMXpNMTUsMjhoMXYxaC0xek0xNywyOGgxdjFoLTF6TTE5LDI4aDF2MWgtMXpNMjEsMjhoMXYxaC0xek0yMiwyOGgxdjFoLTF6TTI0LDI4aDF2MWgtMXpNMjYsMjhoMXYxaC0xek0yNywyOGgxdjFoLTF6TTI4LDI4aDF2MWgtMXpNMjksMjhoMXYxaC0xek0zMCwyOGgxdjFoLTF6TTMxLDI4aDF2MWgtMXpNMzIsMjhoMXYxaC0xek0zMywyOGgxdjFoLTF6TTEyLDI5aDF2MWgtMXpNMTMsMjloMXYxaC0xek0xNiwyOWgxdjFoLTF6TTE3LDI5aDF2MWgtMXpNMTgsMjloMXYxaC0xek0yMCwyOWgxdjFoLTF6TTIyLDI5aDF2MWgtMXpNMjMsMjloMXYxaC0xek0yNCwyOWgxdjFoLTF6TTI1LDI5aDF2MWgtMXpNMjcsMjloMXYxaC0xek0yOCwyOWgxdjFoLTF6TTMyLDI5aDF2MWgtMXpNMzQsMjloMXYxaC0xek0zNiwyOWgxdjFoLTF6TTQsMzBoMXYxaC0xek01LDMwaDF2MWgtMXpNNiwzMGgxdjFoLTF6TTcsMzBoMXYxaC0xek04LDMwaDF2MWgtMXpNOSwzMGgxdjFoLTF6TTEwLDMwaDF2MWgtMXpNMTMsMzBoMXYxaC0xek0xNiwzMGgxdjFoLTF6TTE3LDMwaDF2MWgtMXpNMTgsMzBoMXYxaC0xek0xOSwzMGgxdjFoLTF6TTIyLDMwaDF2MWgtMXpNMjQsMzBoMXYxaC0xek0yNywzMGgxdjFoLTF6TTI4LDMwaDF2MWgtMXpNMzAsMzBoMXYxaC0xek0zMiwzMGgxdjFoLTF6TTM0LDMwaDF2MWgtMXpNMzUsMzBoMXYxaC0xek00LDMxaDF2MWgtMXpNMTAsMzFoMXYxaC0xek0xMiwzMWgxdjFoLTF6TTEzLDMxaDF2MWgtMXpNMTQsMzFoMXYxaC0xek0xNiwzMWgxdjFoLTF6TTE3LDMxaDF2MWgtMXpNMTksMzFoMXYxaC0xek0yMCwzMWgxdjFoLTF6TTI1LDMxaDF2MWgtMXpNMjYsMzFoMXYxaC0xek0yNywzMWgxdjFoLTF6TTI4LDMxaDF2MWgtMXpNMzIsMzFoMXYxaC0xek0zMywzMWgxdjFoLTF6TTM0LDMxaDF2MWgtMXpNMzUsMzFoMXYxaC0xek0zNiwzMWgxdjFoLTF6TTQsMzJoMXYxaC0xek02LDMyaDF2MWgtMXpNNywzMmgxdjFoLTF6TTgsMzJoMXYxaC0xek0xMCwzMmgxdjFoLTF6TTEyLDMyaDF2MWgtMXpNMTMsMzJoMXYxaC0xek0xNSwzMmgxdjFoLTF6TTE4LDMyaDF2MWgtMXpNMTksMzJoMXYxaC0xek0yMiwzMmgxdjFoLTF6TTI1LDMyaDF2MWgtMXpNMjgsMzJoMXYxaC0xek0yOSwzMmgxdjFoLTF6TTMwLDMyaDF2MWgtMXpNMzEsMzJoMXYxaC0xek0zMiwzMmgxdjFoLTF6TTMzLDMyaDF2MWgtMXpNMzUsMzJoMXYxaC0xek0zNiwzMmgxdjFoLTF6TTQsMzNoMXYxaC0xek02LDMzaDF2MWgtMXpNNywzM2gxdjFoLTF6TTgsMzNoMXYxaC0xek0xMCwzM2gxdjFoLTF6TTEyLDMzaDF2MWgtMXpNMTQsMzNoMXYxaC0xek0xOSwzM2gxdjFoLTF6TTIwLDMzaDF2MWgtMXpNMjEsMzNoMXYxaC0xek0yNCwzM2gxdjFoLTF6TTI3LDMzaDF2MWgtMXpNMjksMzNoMXYxaC0xek0zMiwzM2gxdjFoLTF6TTMzLDMzaDF2MWgtMXpNMzUsMzNoMXYxaC0xek0zNiwzM2gxdjFoLTF6TTQsMzRoMXYxaC0xek02LDM0aDF2MWgtMXpNNywzNGgxdjFoLTF6TTgsMzRoMXYxaC0xek0xMCwzNGgxdjFoLTF6TTEyLDM0aDF2MWgtMXpNMTQsMzRoMXYxaC0xek0xNSwzNGgxdjFoLTF6TTE2LDM0aDF2MWgtMXpNMTgsMzRoMXYxaC0xek0yMSwzNGgxdjFoLTF6TTIzLDM0aDF2MWgtMXpNMjUsMzRoMXYxaC0xek0yNiwzNGgxdjFoLTF6TTI3LDM0aDF2MWgtMXpNMjgsMzRoMXYxaC0xek0yOSwzNGgxdjFoLTF6TTMwLDM0aDF2MWgtMXpNMzEsMzRoMXYxaC0xek0zMywzNGgxdjFoLTF6TTQsMzVoMXYxaC0xek0xMCwzNWgxdjFoLTF6TTE0LDM1aDF2MWgtMXpNMTUsMzVoMXYxaC0xek0xNywzNWgxdjFoLTF6TTIwLDM1aDF2MWgtMXpNMjMsMzVoMXYxaC0xek0yNCwzNWgxdjFoLTF6TTI1LDM1aDF2MWgtMXpNMjYsMzVoMXYxaC0xek0yOSwzNWgxdjFoLTF6TTMyLDM1aDF2MWgtMXpNMzMsMzVoMXYxaC0xek0zNCwzNWgxdjFoLTF6TTQsMzZoMXYxaC0xek01LDM2aDF2MWgtMXpNNiwzNmgxdjFoLTF6TTcsMzZoMXYxaC0xek04LDM2aDF2MWgtMXpNOSwzNmgxdjFoLTF6TTEwLDM2aDF2MWgtMXpNMTIsMzZoMXYxaC0xek0xNSwzNmgxdjFoLTF6TTE2LDM2aDF2MWgtMXpNMTgsMzZoMXYxaC0xek0yMSwzNmgxdjFoLTF6TTIzLDM2aDF2MWgtMXpNMjYsMzZoMXYxaC0xek0yNywzNmgxdjFoLTF6TTI4LDM2aDF2MWgtMXpNMzAsMzZoMXYxaC0xek0zMSwzNmgxdjFoLTF6TTMzLDM2aDF2MWgtMXpNMzUsMzZoMXYxaC0xeiIvPjwvc3ZnPgo=",
    watchos: "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MSA0MSIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJ3YXRjaG9zIGRvd25sb2FkIFFSIGNvZGUiIHNoYXBlLXJlbmRlcmluZz0iY3Jpc3BFZGdlcyI+PHRpdGxlPldlZnRNYXRlIHdhdGNob3MgZG93bmxvYWQgcGFnZTwvdGl0bGU+PGRlc2M+aHR0cHM6Ly93d3cud2VmdG1hdGUuY29tL2Rvd25sb2Fkcy8/cGxhdGZvcm09d2F0Y2hvczwvZGVzYz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMCwwaDQxdjQxSDB6Ii8+PHBhdGggZmlsbD0iIzExMSIgZD0iTTQsNGgxdjFoLTF6TTUsNGgxdjFoLTF6TTYsNGgxdjFoLTF6TTcsNGgxdjFoLTF6TTgsNGgxdjFoLTF6TTksNGgxdjFoLTF6TTEwLDRoMXYxaC0xek0xNCw0aDF2MWgtMXpNMTUsNGgxdjFoLTF6TTE2LDRoMXYxaC0xek0xNyw0aDF2MWgtMXpNMjAsNGgxdjFoLTF6TTIxLDRoMXYxaC0xek0yMiw0aDF2MWgtMXpNMjMsNGgxdjFoLTF6TTI0LDRoMXYxaC0xek0yNyw0aDF2MWgtMXpNMzAsNGgxdjFoLTF6TTMxLDRoMXYxaC0xek0zMiw0aDF2MWgtMXpNMzMsNGgxdjFoLTF6TTM0LDRoMXYxaC0xek0zNSw0aDF2MWgtMXpNMzYsNGgxdjFoLTF6TTQsNWgxdjFoLTF6TTEwLDVoMXYxaC0xek0xNSw1aDF2MWgtMXpNMTcsNWgxdjFoLTF6TTE4LDVoMXYxaC0xek0xOSw1aDF2MWgtMXpNMjEsNWgxdjFoLTF6TTI1LDVoMXYxaC0xek0yNiw1aDF2MWgtMXpNMzAsNWgxdjFoLTF6TTM2LDVoMXYxaC0xek00LDZoMXYxaC0xek02LDZoMXYxaC0xek03LDZoMXYxaC0xek04LDZoMXYxaC0xek0xMCw2aDF2MWgtMXpNMTIsNmgxdjFoLTF6TTE1LDZoMXYxaC0xek0xNiw2aDF2MWgtMXpNMTcsNmgxdjFoLTF6TTIwLDZoMXYxaC0xek0yMSw2aDF2MWgtMXpNMjIsNmgxdjFoLTF6TTIzLDZoMXYxaC0xek0yNCw2aDF2MWgtMXpNMjUsNmgxdjFoLTF6TTI2LDZoMXYxaC0xek0yNyw2aDF2MWgtMXpNMzAsNmgxdjFoLTF6TTMyLDZoMXYxaC0xek0zMyw2aDF2MWgtMXpNMzQsNmgxdjFoLTF6TTM2LDZoMXYxaC0xek00LDdoMXYxaC0xek02LDdoMXYxaC0xek03LDdoMXYxaC0xek04LDdoMXYxaC0xek0xMCw3aDF2MWgtMXpNMTIsN2gxdjFoLTF6TTE4LDdoMXYxaC0xek0yMCw3aDF2MWgtMXpNMjMsN2gxdjFoLTF6TTI2LDdoMXYxaC0xek0zMCw3aDF2MWgtMXpNMzIsN2gxdjFoLTF6TTMzLDdoMXYxaC0xek0zNCw3aDF2MWgtMXpNMzYsN2gxdjFoLTF6TTQsOGgxdjFoLTF6TTYsOGgxdjFoLTF6TTcsOGgxdjFoLTF6TTgsOGgxdjFoLTF6TTEwLDhoMXYxaC0xek0xMiw4aDF2MWgtMXpNMTQsOGgxdjFoLTF6TTE1LDhoMXYxaC0xek0xNiw4aDF2MWgtMXpNMTcsOGgxdjFoLTF6TTE5LDhoMXYxaC0xek0yMiw4aDF2MWgtMXpNMjUsOGgxdjFoLTF6TTI2LDhoMXYxaC0xek0yNyw4aDF2MWgtMXpNMjgsOGgxdjFoLTF6TTMwLDhoMXYxaC0xek0zMiw4aDF2MWgtMXpNMzMsOGgxdjFoLTF6TTM0LDhoMXYxaC0xek0zNiw4aDF2MWgtMXpNNCw5aDF2MWgtMXpNMTAsOWgxdjFoLTF6TTEyLDloMXYxaC0xek0xNSw5aDF2MWgtMXpNMTgsOWgxdjFoLTF6TTE5LDloMXYxaC0xek0yMCw5aDF2MWgtMXpNMjEsOWgxdjFoLTF6TTIyLDloMXYxaC0xek0yNCw5aDF2MWgtMXpNMjUsOWgxdjFoLTF6TTI2LDloMXYxaC0xek0zMCw5aDF2MWgtMXpNMzYsOWgxdjFoLTF6TTQsMTBoMXYxaC0xek01LDEwaDF2MWgtMXpNNiwxMGgxdjFoLTF6TTcsMTBoMXYxaC0xek04LDEwaDF2MWgtMXpNOSwxMGgxdjFoLTF6TTEwLDEwaDF2MWgtMXpNMTIsMTBoMXYxaC0xek0xNCwxMGgxdjFoLTF6TTE2LDEwaDF2MWgtMXpNMTgsMTBoMXYxaC0xek0yMCwxMGgxdjFoLTF6TTIyLDEwaDF2MWgtMXpNMjQsMTBoMXYxaC0xek0yNiwxMGgxdjFoLTF6TTI4LDEwaDF2MWgtMXpNMzAsMTBoMXYxaC0xek0zMSwxMGgxdjFoLTF6TTMyLDEwaDF2MWgtMXpNMzMsMTBoMXYxaC0xek0zNCwxMGgxdjFoLTF6TTM1LDEwaDF2MWgtMXpNMzYsMTBoMXYxaC0xek0xMiwxMWgxdjFoLTF6TTEzLDExaDF2MWgtMXpNMTQsMTFoMXYxaC0xek0xNSwxMWgxdjFoLTF6TTE5LDExaDF2MWgtMXpNMjMsMTFoMXYxaC0xek0yNSwxMWgxdjFoLTF6TTI2LDExaDF2MWgtMXpNNCwxMmgxdjFoLTF6TTYsMTJoMXYxaC0xek03LDEyaDF2MWgtMXpNOCwxMmgxdjFoLTF6TTksMTJoMXYxaC0xek0xMCwxMmgxdjFoLTF6TTE3LDEyaDF2MWgtMXpNMTgsMTJoMXYxaC0xek0xOSwxMmgxdjFoLTF6TTIxLDEyaDF2MWgtMXpNMjYsMTJoMXYxaC0xek0yNywxMmgxdjFoLTF6TTMwLDEyaDF2MWgtMXpNMzEsMTJoMXYxaC0xek0zMiwxMmgxdjFoLTF6TTMzLDEyaDF2MWgtMXpNMzQsMTJoMXYxaC0xek03LDEzaDF2MWgtMXpNOCwxM2gxdjFoLTF6TTExLDEzaDF2MWgtMXpNMTMsMTNoMXYxaC0xek0xNSwxM2gxdjFoLTF6TTE2LDEzaDF2MWgtMXpNMjAsMTNoMXYxaC0xek0yMiwxM2gxdjFoLTF6TTIzLDEzaDF2MWgtMXpNMjUsMTNoMXYxaC0xek0yNywxM2gxdjFoLTF6TTMwLDEzaDF2MWgtMXpNMzEsMTNoMXYxaC0xek0zMywxM2gxdjFoLTF6TTM0LDEzaDF2MWgtMXpNMzUsMTNoMXYxaC0xek0zNiwxM2gxdjFoLTF6TTgsMTRoMXYxaC0xek05LDE0aDF2MWgtMXpNMTAsMTRoMXYxaC0xek0xMiwxNGgxdjFoLTF6TTE0LDE0aDF2MWgtMXpNMTUsMTRoMXYxaC0xek0xOSwxNGgxdjFoLTF6TTIwLDE0aDF2MWgtMXpNMjIsMTRoMXYxaC0xek0yNCwxNGgxdjFoLTF6TTI2LDE0aDF2MWgtMXpNMjgsMTRoMXYxaC0xek0zMiwxNGgxdjFoLTF6TTM0LDE0aDF2MWgtMXpNMzUsMTRoMXYxaC0xek00LDE1aDF2MWgtMXpNNSwxNWgxdjFoLTF6TTYsMTVoMXYxaC0xek03LDE1aDF2MWgtMXpNMTMsMTVoMXYxaC0xek0xOCwxNWgxdjFoLTF6TTIwLDE1aDF2MWgtMXpNMjQsMTVoMXYxaC0xek0yNSwxNWgxdjFoLTF6TTI2LDE1aDF2MWgtMXpNMjcsMTVoMXYxaC0xek0yOSwxNWgxdjFoLTF6TTMyLDE1aDF2MWgtMXpNMzMsMTVoMXYxaC0xek0zNCwxNWgxdjFoLTF6TTQsMTZoMXYxaC0xek02LDE2aDF2MWgtMXpNOSwxNmgxdjFoLTF6TTEwLDE2aDF2MWgtMXpNMTIsMTZoMXYxaC0xek0xOSwxNmgxdjFoLTF6TTIyLDE2aDF2MWgtMXpNMjQsMTZoMXYxaC0xek0yNiwxNmgxdjFoLTF6TTI3LDE2aDF2MWgtMXpNMjgsMTZoMXYxaC0xek0yOSwxNmgxdjFoLTF6TTMxLDE2aDF2MWgtMXpNMzIsMTZoMXYxaC0xek0zMywxNmgxdjFoLTF6TTM1LDE2aDF2MWgtMXpNNiwxN2gxdjFoLTF6TTksMTdoMXYxaC0xek0xMiwxN2gxdjFoLTF6TTE3LDE3aDF2MWgtMXpNMTgsMTdoMXYxaC0xek0xOSwxN2gxdjFoLTF6TTIwLDE3aDF2MWgtMXpNMjEsMTdoMXYxaC0xek0yMywxN2gxdjFoLTF6TTI0LDE3aDF2MWgtMXpNMjUsMTdoMXYxaC0xek0yNywxN2gxdjFoLTF6TTI5LDE3aDF2MWgtMXpNMzAsMTdoMXYxaC0xek0zNCwxN2gxdjFoLTF6TTM1LDE3aDF2MWgtMXpNMzYsMTdoMXYxaC0xek0xMCwxOGgxdjFoLTF6TTExLDE4aDF2MWgtMXpNMTIsMThoMXYxaC0xek0xNiwxOGgxdjFoLTF6TTE4LDE4aDF2MWgtMXpNMjEsMThoMXYxaC0xek0yNCwxOGgxdjFoLTF6TTI2LDE4aDF2MWgtMXpNMjgsMThoMXYxaC0xek0yOSwxOGgxdjFoLTF6TTMwLDE4aDF2MWgtMXpNMzEsMThoMXYxaC0xek0zMywxOGgxdjFoLTF6TTM1LDE4aDF2MWgtMXpNNiwxOWgxdjFoLTF6TTgsMTloMXYxaC0xek05LDE5aDF2MWgtMXpNMTEsMTloMXYxaC0xek0xMiwxOWgxdjFoLTF6TTE0LDE5aDF2MWgtMXpNMTYsMTloMXYxaC0xek0xNywxOWgxdjFoLTF6TTIwLDE5aDF2MWgtMXpNMjMsMTloMXYxaC0xek0yNCwxOWgxdjFoLTF6TTI1LDE5aDF2MWgtMXpNMjcsMTloMXYxaC0xek0yOCwxOWgxdjFoLTF6TTI5LDE5aDF2MWgtMXpNMzAsMTloMXYxaC0xek0zMiwxOWgxdjFoLTF6TTM0LDE5aDF2MWgtMXpNNCwyMGgxdjFoLTF6TTYsMjBoMXYxaC0xek0xMCwyMGgxdjFoLTF6TTExLDIwaDF2MWgtMXpNMTQsMjBoMXYxaC0xek0xNywyMGgxdjFoLTF6TTE4LDIwaDF2MWgtMXpNMjAsMjBoMXYxaC0xek0yMSwyMGgxdjFoLTF6TTIzLDIwaDF2MWgtMXpNMjYsMjBoMXYxaC0xek0yOCwyMGgxdjFoLTF6TTI5LDIwaDF2MWgtMXpNMzEsMjBoMXYxaC0xek0zMiwyMGgxdjFoLTF6TTM2LDIwaDF2MWgtMXpNNCwyMWgxdjFoLTF6TTcsMjFoMXYxaC0xek05LDIxaDF2MWgtMXpNMTIsMjFoMXYxaC0xek0xMywyMWgxdjFoLTF6TTE0LDIxaDF2MWgtMXpNMjAsMjFoMXYxaC0xek0yMSwyMWgxdjFoLTF6TTIyLDIxaDF2MWgtMXpNMjMsMjFoMXYxaC0xek0yNCwyMWgxdjFoLTF6TTI1LDIxaDF2MWgtMXpNMjYsMjFoMXYxaC0xek0yNywyMWgxdjFoLTF6TTI4LDIxaDF2MWgtMXpNMjksMjFoMXYxaC0xek0zMCwyMWgxdjFoLTF6TTMxLDIxaDF2MWgtMXpNMzMsMjFoMXYxaC0xek0zNCwyMWgxdjFoLTF6TTM2LDIxaDF2MWgtMXpNNCwyMmgxdjFoLTF6TTUsMjJoMXYxaC0xek02LDIyaDF2MWgtMXpNMTAsMjJoMXYxaC0xek0xNiwyMmgxdjFoLTF6TTE3LDIyaDF2MWgtMXpNMTgsMjJoMXYxaC0xek0xOSwyMmgxdjFoLTF6TTIwLDIyaDF2MWgtMXpNMjEsMjJoMXYxaC0xek0yNSwyMmgxdjFoLTF6TTI5LDIyaDF2MWgtMXpNMzEsMjJoMXYxaC0xek0zMiwyMmgxdjFoLTF6TTM0LDIyaDF2MWgtMXpNMzUsMjJoMXYxaC0xek00LDIzaDF2MWgtMXpNNywyM2gxdjFoLTF6TTgsMjNoMXYxaC0xek0xMSwyM2gxdjFoLTF6TTEyLDIzaDF2MWgtMXpNMTQsMjNoMXYxaC0xek0xNSwyM2gxdjFoLTF6TTE3LDIzaDF2MWgtMXpNMTgsMjNoMXYxaC0xek0yMCwyM2gxdjFoLTF6TTIxLDIzaDF2MWgtMXpNMjIsMjNoMXYxaC0xek0yNCwyM2gxdjFoLTF6TTI1LDIzaDF2MWgtMXpNMjYsMjNoMXYxaC0xek0yNywyM2gxdjFoLTF6TTMxLDIzaDF2MWgtMXpNMzIsMjNoMXYxaC0xek0zMywyM2gxdjFoLTF6TTM0LDIzaDF2MWgtMXpNMzUsMjNoMXYxaC0xek03LDI0aDF2MWgtMXpNOCwyNGgxdjFoLTF6TTEwLDI0aDF2MWgtMXpNMTYsMjRoMXYxaC0xek0xNywyNGgxdjFoLTF6TTIwLDI0aDF2MWgtMXpNMjYsMjRoMXYxaC0xek0yOSwyNGgxdjFoLTF6TTMxLDI0aDF2MWgtMXpNMzIsMjRoMXYxaC0xek0zMywyNGgxdjFoLTF6TTQsMjVoMXYxaC0xek02LDI1aDF2MWgtMXpNNywyNWgxdjFoLTF6TTksMjVoMXYxaC0xek0xMSwyNWgxdjFoLTF6TTE0LDI1aDF2MWgtMXpNMTYsMjVoMXYxaC0xek0xOCwyNWgxdjFoLTF6TTE5LDI1aDF2MWgtMXpNMjEsMjVoMXYxaC0xek0yMiwyNWgxdjFoLTF6TTIzLDI1aDF2MWgtMXpNMjQsMjVoMXYxaC0xek0yNSwyNWgxdjFoLTF6TTI2LDI1aDF2MWgtMXpNMjcsMjVoMXYxaC0xek0zMCwyNWgxdjFoLTF6TTMzLDI1aDF2MWgtMXpNMzYsMjVoMXYxaC0xek00LDI2aDF2MWgtMXpNOSwyNmgxdjFoLTF6TTEwLDI2aDF2MWgtMXpNMTEsMjZoMXYxaC0xek0xMiwyNmgxdjFoLTF6TTEzLDI2aDF2MWgtMXpNMTQsMjZoMXYxaC0xek0xNSwyNmgxdjFoLTF6TTE2LDI2aDF2MWgtMXpNMTgsMjZoMXYxaC0xek0xOSwyNmgxdjFoLTF6TTIwLDI2aDF2MWgtMXpNMjUsMjZoMXYxaC0xek0yNiwyNmgxdjFoLTF6TTI5LDI2aDF2MWgtMXpNMzEsMjZoMXYxaC0xek0zMywyNmgxdjFoLTF6TTM1LDI2aDF2MWgtMXpNNCwyN2gxdjFoLTF6TTYsMjdoMXYxaC0xek03LDI3aDF2MWgtMXpNOCwyN2gxdjFoLTF6TTExLDI3aDF2MWgtMXpNMTMsMjdoMXYxaC0xek0xNSwyN2gxdjFoLTF6TTE4LDI3aDF2MWgtMXpNMTksMjdoMXYxaC0xek0yNSwyN2gxdjFoLTF6TTI3LDI3aDF2MWgtMXpNMjksMjdoMXYxaC0xek0zMCwyN2gxdjFoLTF6TTMxLDI3aDF2MWgtMXpNMzQsMjdoMXYxaC0xek00LDI4aDF2MWgtMXpNNywyOGgxdjFoLTF6TTgsMjhoMXYxaC0xek0xMCwyOGgxdjFoLTF6TTExLDI4aDF2MWgtMXpNMTIsMjhoMXYxaC0xek0xMywyOGgxdjFoLTF6TTE0LDI4aDF2MWgtMXpNMTUsMjhoMXYxaC0xek0xNywyOGgxdjFoLTF6TTE4LDI4aDF2MWgtMXpNMTksMjhoMXYxaC0xek0yMSwyOGgxdjFoLTF6TTIyLDI4aDF2MWgtMXpNMjMsMjhoMXYxaC0xek0yNCwyOGgxdjFoLTF6TTI2LDI4aDF2MWgtMXpNMjcsMjhoMXYxaC0xek0yOCwyOGgxdjFoLTF6TTI5LDI4aDF2MWgtMXpNMzAsMjhoMXYxaC0xek0zMSwyOGgxdjFoLTF6TTMyLDI4aDF2MWgtMXpNMzMsMjhoMXYxaC0xek0zNSwyOGgxdjFoLTF6TTEyLDI5aDF2MWgtMXpNMTQsMjloMXYxaC0xek0xNSwyOWgxdjFoLTF6TTE4LDI5aDF2MWgtMXpNMjAsMjloMXYxaC0xek0yMiwyOWgxdjFoLTF6TTIzLDI5aDF2MWgtMXpNMjQsMjloMXYxaC0xek0yNSwyOWgxdjFoLTF6TTI3LDI5aDF2MWgtMXpNMjgsMjloMXYxaC0xek0zMiwyOWgxdjFoLTF6TTM0LDI5aDF2MWgtMXpNMzYsMjloMXYxaC0xek00LDMwaDF2MWgtMXpNNSwzMGgxdjFoLTF6TTYsMzBoMXYxaC0xek03LDMwaDF2MWgtMXpNOCwzMGgxdjFoLTF6TTksMzBoMXYxaC0xek0xMCwzMGgxdjFoLTF6TTE1LDMwaDF2MWgtMXpNMTYsMzBoMXYxaC0xek0xOCwzMGgxdjFoLTF6TTE5LDMwaDF2MWgtMXpNMjIsMzBoMXYxaC0xek0yNCwzMGgxdjFoLTF6TTI1LDMwaDF2MWgtMXpNMjYsMzBoMXYxaC0xek0yNywzMGgxdjFoLTF6TTI4LDMwaDF2MWgtMXpNMzAsMzBoMXYxaC0xek0zMiwzMGgxdjFoLTF6TTM0LDMwaDF2MWgtMXpNMzUsMzBoMXYxaC0xek00LDMxaDF2MWgtMXpNMTAsMzFoMXYxaC0xek0xMiwzMWgxdjFoLTF6TTE0LDMxaDF2MWgtMXpNMTgsMzFoMXYxaC0xek0xOSwzMWgxdjFoLTF6TTIwLDMxaDF2MWgtMXpNMjUsMzFoMXYxaC0xek0yNywzMWgxdjFoLTF6TTI4LDMxaDF2MWgtMXpNMzIsMzFoMXYxaC0xek0zMywzMWgxdjFoLTF6TTM0LDMxaDF2MWgtMXpNMzUsMzFoMXYxaC0xek0zNiwzMWgxdjFoLTF6TTQsMzJoMXYxaC0xek02LDMyaDF2MWgtMXpNNywzMmgxdjFoLTF6TTgsMzJoMXYxaC0xek0xMCwzMmgxdjFoLTF6TTEyLDMyaDF2MWgtMXpNMTUsMzJoMXYxaC0xek0xNiwzMmgxdjFoLTF6TTE3LDMyaDF2MWgtMXpNMTksMzJoMXYxaC0xek0yMiwzMmgxdjFoLTF6TTI2LDMyaDF2MWgtMXpNMjgsMzJoMXYxaC0xek0yOSwzMmgxdjFoLTF6TTMwLDMyaDF2MWgtMXpNMzEsMzJoMXYxaC0xek0zMiwzMmgxdjFoLTF6TTMzLDMyaDF2MWgtMXpNMzUsMzJoMXYxaC0xek0zNiwzMmgxdjFoLTF6TTQsMzNoMXYxaC0xek02LDMzaDF2MWgtMXpNNywzM2gxdjFoLTF6TTgsMzNoMXYxaC0xek0xMCwzM2gxdjFoLTF6TTEyLDMzaDF2MWgtMXpNMTMsMzNoMXYxaC0xek0xNCwzM2gxdjFoLTF6TTE1LDMzaDF2MWgtMXpNMTksMzNoMXYxaC0xek0yMCwzM2gxdjFoLTF6TTIxLDMzaDF2MWgtMXpNMjMsMzNoMXYxaC0xek0yNCwzM2gxdjFoLTF6TTI3LDMzaDF2MWgtMXpNMjksMzNoMXYxaC0xek0zMiwzM2gxdjFoLTF6TTMzLDMzaDF2MWgtMXpNMzUsMzNoMXYxaC0xek0zNiwzM2gxdjFoLTF6TTQsMzRoMXYxaC0xek02LDM0aDF2MWgtMXpNNywzNGgxdjFoLTF6TTgsMzRoMXYxaC0xek0xMCwzNGgxdjFoLTF6TTEyLDM0aDF2MWgtMXpNMTcsMzRoMXYxaC0xek0yMSwzNGgxdjFoLTF6TTI0LDM0aDF2MWgtMXpNMjUsMzRoMXYxaC0xek0yNiwzNGgxdjFoLTF6TTI3LDM0aDF2MWgtMXpNMjgsMzRoMXYxaC0xek0yOSwzNGgxdjFoLTF6TTMwLDM0aDF2MWgtMXpNMzEsMzRoMXYxaC0xek0zMywzNGgxdjFoLTF6TTQsMzVoMXYxaC0xek0xMCwzNWgxdjFoLTF6TTE0LDM1aDF2MWgtMXpNMTUsMzVoMXYxaC0xek0xOCwzNWgxdjFoLTF6TTIwLDM1aDF2MWgtMXpNMjMsMzVoMXYxaC0xek0yNSwzNWgxdjFoLTF6TTI2LDM1aDF2MWgtMXpNMjksMzVoMXYxaC0xek0zMiwzNWgxdjFoLTF6TTMzLDM1aDF2MWgtMXpNMzQsMzVoMXYxaC0xek00LDM2aDF2MWgtMXpNNSwzNmgxdjFoLTF6TTYsMzZoMXYxaC0xek03LDM2aDF2MWgtMXpNOCwzNmgxdjFoLTF6TTksMzZoMXYxaC0xek0xMCwzNmgxdjFoLTF6TTEyLDM2aDF2MWgtMXpNMTMsMzZoMXYxaC0xek0xNywzNmgxdjFoLTF6TTIxLDM2aDF2MWgtMXpNMjYsMzZoMXYxaC0xek0yNywzNmgxdjFoLTF6TTI4LDM2aDF2MWgtMXpNMzAsMzZoMXYxaC0xek0zMSwzNmgxdjFoLTF6TTMzLDM2aDF2MWgtMXpNMzUsMzZoMXYxaC0xeiIvPjwvc3ZnPgo="
  })
  const installPlatforms = {
    android: { name: '安卓', qr: 'android' },
    macos: { name: 'Mac', qr: 'macos' },
    ios: { name: 'iPhone', qr: 'ios', preparing: true },
    watchos: { name: 'Apple Watch', qr: 'watchos', preparing: true },
    windows: { name: 'Windows 网页版' },
  }
  function updateOtherDeviceInstall() {
    const platformId = byId('other-device-platform').value
    const platform = installPlatforms[platformId] || installPlatforms.android
    const link = byId('other-device-platform-link')
    const image = byId('other-device-qr')
    const qrStatus = byId('other-device-qr-status')
    const platformStatus = byId('other-device-platform-status')
    qrStatus.hidden = true
    platformStatus.hidden = !platform.preparing && platformId !== 'windows'
    platformStatus.textContent = platform.preparing ? `${platform.name}安装方式准备中，可扫码查看官网信息。`
      : platformId === 'windows' ? 'Windows 请使用网页版，前往官网查看。' : ''
    if (!platform.qr) {
      link.hidden = true
      image.hidden = true
      link.setAttribute('href', 'https://www.weftmate.com/downloads/')
      link.setAttribute('aria-label', '打开官网查看 Windows 网页版')
      return
    }
    link.hidden = false
    image.hidden = false
    link.setAttribute('href', `https://www.weftmate.com/downloads/?platform=${platform.qr}`)
    link.setAttribute('aria-label', `打开${platform.name}下载页面`)
    image.alt = `${platform.name}下载页面二维码`
    image.src = publicPlatformQrData[platform.qr]
  }
  function resetOtherDeviceInstall() {
    const details = byId('other-device-install')
    if (details.open) details.open = false
    byId('other-device-platform').value = 'android'
    updateOtherDeviceInstall()
  }
  byId('other-device-platform').addEventListener('change', updateOtherDeviceInstall)
  byId('other-device-qr').addEventListener('error', () => {
    byId('other-device-qr').hidden = true
    byId('other-device-qr-status').hidden = false
  })
  function sessionExpired() {
    clearSession()
    show('login')
    toast('登录已失效，请重新登录。')
  }
  function formatDate(value) {
    if (typeof value !== 'string') return '未记录'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '未记录' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }
  function element(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  function profileName() { return state.account?.displayName ?? state.account?.username ?? '' }
  function profileDirty() {
    return byId('profile-display-name').value !== profileName() || state.profileDraftAvatar !== undefined
  }
  function profileControls() {
    byId('profile-save').disabled = state.profileSaving || state.avatarChecking || state.profileConflict || !profileDirty()
    byId('profile-cancel').disabled = state.profileSaving || (!profileDirty() && !state.avatarChecking)
    byId('profile-display-name').disabled = state.profileSaving
    byId('profile-avatar-file').disabled = state.profileSaving
    byId('profile-avatar-remove').disabled = state.profileSaving || !(state.profileDraftAvatar === undefined ? state.account?.avatar : state.profileDraftAvatar)
  }
  function releaseAvatarUrl() {
    if (state.avatarObjectUrl) URL.revokeObjectURL(state.avatarObjectUrl)
    state.avatarObjectUrl = null
  }
  function avatarSignature(bytes, mimeType) {
    const png = bytes.length >= 16 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    const jpeg = bytes.length >= 16 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217
    const webp = bytes.length >= 16 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
    return mimeType === 'image/png' && png || mimeType === 'image/jpeg' && jpeg || mimeType === 'image/webp' && webp
  }
  async function paintAvatar(avatar, token, file = null) {
    const generation = ++state.avatarGeneration
    const current = () => accountCurrent(token) && generation === state.avatarGeneration
    const image = byId('profile-avatar-image')
    const placeholder = byId('profile-avatar-placeholder')
    releaseAvatarUrl()
    image.removeAttribute?.('src')
    image.hidden = true
    placeholder.hidden = false
    if (!current()) return false
    if (!avatar) {
      placeholder.textContent = Array.from(byId('profile-display-name').value.trim() || state.account?.username || '?')[0] || '?'
      return true
    }
    try {
      const url = file ? URL.createObjectURL(file) : `data:${avatar.mimeType};base64,${avatar.dataBase64}`
      if (file) state.avatarObjectUrl = url
      image.src = url
      if (typeof image.decode === 'function') await image.decode()
      else await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true })
        image.addEventListener('error', reject, { once: true })
      })
      if (!current()) return false
      image.hidden = false
      placeholder.hidden = true
      return true
    } catch {
      if (current()) {
        byId('profile-avatar-status').textContent = '头像无法预览，请重新选择有效图片。'
        releaseAvatarUrl()
        image.removeAttribute?.('src')
      }
      return false
    }
  }
  function resetProfileDraft() {
    state.profileDraftGeneration++
    state.avatarSelectionGeneration++
    state.avatarChecking = false
    state.profileDraftAvatar = undefined
    state.profileConflict = false
    byId('profile-display-name').value = profileName()
    byId('profile-avatar-file').value = ''
    byId('profile-avatar-status').textContent = state.account?.avatar ? '当前头像。选择新图片或移除后再保存。' : '未设置头像。支持 PNG、JPEG 或 WebP，最多 128 KiB。'
    byId('profile-reload').hidden = true
    errorAt('profile-error', '')
    byId('profile-status').textContent = ''
    if (state.currentView === 'account') void paintAvatar(state.account?.avatar ?? null, accountToken())
    profileControls()
  }
  async function refreshProfile({ preserveDraft = false } = {}) {
    const token = accountToken()
    const draftGeneration = state.profileDraftGeneration
    const fetchGeneration = ++state.profileFetchGeneration
    if (!accountCurrent(token)) return
    if (!preserveDraft && (profileDirty() || state.avatarChecking)) return
    byId('profile-status').textContent = '正在读取资料…'
    try {
      const payload = await api('/me')
      if (!accountCurrent(token) || fetchGeneration !== state.profileFetchGeneration) return
      if (draftGeneration !== state.profileDraftGeneration) {
        byId('profile-status').textContent = preserveDraft
          ? '读取期间草稿发生变化，本次结果未应用。请重新读取最新资料。'
          : '当前草稿已保留，保存时会检查资料版本。'
        return
      }
      if (payload?.account?.ownerId !== state.account?.ownerId || payload?.device?.id !== state.device?.id
        || !Number.isSafeInteger(payload.account.profileRevision)) throw { code: 'REQUEST_FAILED' }
      if (!preserveDraft && (profileDirty() || state.avatarChecking)) {
        byId('profile-status').textContent = '资料读取已完成；当前输入仍保留，保存时会检查资料版本。'
        return
      }
      const nameWasChanged = byId('profile-display-name').value !== profileName()
      const avatarWasChanged = state.profileDraftAvatar !== undefined || state.avatarChecking
      state.account = payload.account
      if (preserveDraft) {
        if (!nameWasChanged) byId('profile-display-name').value = profileName()
        if (!avatarWasChanged) {
          byId('profile-avatar-status').textContent = state.account.avatar ? '已更新为账户当前头像。' : '账户当前未设置头像。'
          void paintAvatar(state.account.avatar ?? null, token)
        }
        state.profileConflict = false
        byId('profile-reload').hidden = true
        errorAt('profile-error', '')
        byId('profile-status').textContent = '已读取最新资料；未修改的字段已更新。请核对保留的草稿，再明确保存。'
        profileControls()
      } else resetProfileDraft()
    } catch (error) {
      if (!accountCurrent(token) || fetchGeneration !== state.profileFetchGeneration) return
      if (error.code === 'UNAUTHORIZED') return sessionExpired()
      byId('profile-status').textContent = ''
      byId('profile-reload').hidden = false
      errorAt('profile-error', '资料暂时无法读取，请稍后重试。当前输入仍保留。')
    }
  }
  function renderDevices(devices) {
    const list = byId('device-list')
    list.replaceChildren()
    if (!devices.length) {
      list.append(element('li', 'device-item muted', '没有可显示的设备记录。'))
      return
    }
    for (const device of devices) {
      const item = element('li', 'device-item')
      if (typeof device.id === 'string') item.dataset.deviceId = device.id
      const content = element('div', 'device-content')
      const title = element('div', 'device-title')
      title.append(element('strong', '', typeof device.name === 'string' ? device.name : '未命名设备'))
      if (device.current === true) title.append(element('span', 'badge', '当前设备'))
      if (device.revoked === true) title.append(element('span', 'badge revoked', '已撤销'))
      const meta = element('div', 'device-meta')
      meta.append(element('span', '', `加入于 ${formatDate(device.createdAt)}`))
      if (device.lastSeenAt) meta.append(element('span', '', `最近使用 ${formatDate(device.lastSeenAt)}`))
      meta.append(element('span', '', `会话有效期至 ${formatDate(device.expiresAt)}`))
      content.append(title, meta)
      const editing = state.deviceEditing?.id === device.id ? state.deviceEditing : null
      if (editing) {
        const form = element('form', 'device-edit')
        const input = element('input')
        input.type = 'text'
        input.maxLength = 128
        input.value = editing.draft
        input.setAttribute('aria-label', `修改${device.name || '未命名设备'}的名称`)
        const save = element('button', 'button primary small', '保存名称')
        save.type = 'submit'
        save.disabled = editing.busy
        const cancel = element('button', 'button quiet small', '取消')
        cancel.type = 'button'
        cancel.disabled = editing.busy
        const feedback = element('p', `device-feedback${editing.error ? ' is-error' : ''}`, editing.error || (editing.busy ? '正在保存设备名称…' : '修改只影响这台设备的显示名称。'))
        feedback.setAttribute('role', editing.error ? 'alert' : 'status')
        input.disabled = editing.busy
        input.addEventListener('input', () => { editing.draft = input.value; editing.error = ''; feedback.textContent = '修改只影响这台设备的显示名称。'; feedback.className = 'device-feedback' })
        cancel.addEventListener('click', () => { state.deviceEditing = null; renderDevices(state.cachedDevices) })
        form.addEventListener('submit', async (event) => {
          event.preventDefault()
          if (editing.busy) return
          const name = input.value.trim()
          if (!name || name.length > 128) { editing.error = '设备名称须为 1–128 个字符。'; feedback.textContent = editing.error; feedback.className = 'device-feedback is-error'; return }
          const token = accountToken()
          editing.busy = true
          input.disabled = save.disabled = cancel.disabled = true
          feedback.textContent = '正在保存设备名称…'
          try {
            const result = await api(`/devices/${encodeURIComponent(device.id)}`, { method: 'PATCH', protectedWrite: true, body: { name } })
            if (!accountCurrent(token) || state.deviceEditing !== editing) return
            if (result?.device?.id !== device.id || result.device.name !== name) throw { code: 'REQUEST_FAILED' }
            state.deviceEditing = null
            state.deviceNotice = '设备名称已保存。'
            await refreshDevices()
          } catch (error) {
            if (!accountCurrent(token) || state.deviceEditing !== editing) return
            if (error.code === 'UNAUTHORIZED') return sessionExpired()
            editing.error = error.code === 'NOT_FOUND' ? '设备已不在当前账户中，请取消后刷新列表。' : '设备名称未确认保存，请检查连接并重试。'
            feedback.textContent = editing.error
            feedback.className = 'device-feedback is-error'
          } finally {
            if (accountCurrent(token) && state.deviceEditing === editing) {
              editing.busy = false
              input.disabled = save.disabled = cancel.disabled = false
            }
          }
        })
        form.append(input, save, cancel, feedback)
        content.append(form)
      }
      item.append(content)
      if (device.revoked !== true && typeof device.id === 'string' && !editing) {
        const actions = element('div', 'device-actions')
        const rename = element('button', 'button secondary small', '改名')
        rename.type = 'button'
        rename.addEventListener('click', () => {
          state.deviceEditing = { id: device.id, draft: typeof device.name === 'string' ? device.name : '', error: '', busy: false }
          renderDevices(state.cachedDevices)
          byId('device-list').querySelector?.(`[data-device-id="${device.id}"] input`)?.focus()
        })
        actions.append(rename)
      if (device.current !== true && device.revoked !== true && typeof device.id === 'string') {
        const button = element('button', 'button secondary small', '撤销')
        button.type = 'button'
        button.addEventListener('click', () => {
          state.revokeId = device.id
          errorAt('revoke-error', '')
          byId('revoke-description').textContent = `确定撤销“${device.name || '未命名设备'}”吗？`
          byId('revoke-dialog').showModal()
        })
        actions.append(button)
      }
        item.append(actions)
      }
      list.append(item)
    }
  }
  async function refreshDevices() {
    void refreshPendingDevices()
    const loading = byId('devices-loading')
    const token = accountToken()
    if (!accountCurrent(token)) return
    if (state.deviceEditing) {
      loading.hidden = false
      loading.textContent = '请先保存或取消设备名称修改，再刷新列表。'
      return
    }
    const generation = ++state.deviceFetchGeneration
    loading.hidden = false
    loading.textContent = '正在读取设备…'
    try {
      const payload = await api('/devices')
      if (!accountCurrent(token) || generation !== state.deviceFetchGeneration) return
      if (!Array.isArray(payload.devices)) throw { code: 'REQUEST_FAILED' }
      if (state.deviceEditing) {
        loading.textContent = '设备记录已读取；请先保存或取消当前改名，再刷新列表。'
        return
      }
      state.cachedDevices = payload.devices
      renderDevices(payload.devices)
      loading.hidden = !state.deviceNotice
      if (state.deviceNotice) { loading.textContent = state.deviceNotice; state.deviceNotice = '' }
    } catch (error) {
      if (!accountCurrent(token) || generation !== state.deviceFetchGeneration) return
      if (error.code === 'UNAUTHORIZED') return sessionExpired()
      loading.textContent = state.deviceNotice ? `${state.deviceNotice}但列表暂时无法刷新，请稍后重试。` : '设备记录暂时无法读取。请点击刷新重试。'
      state.deviceNotice = ''
    }
  }

  async function refreshPendingDevices() {
    const generation = state.identityGeneration
    const ownerId = state.account?.ownerId
    if (!state.csrfToken || !ownerId) return
    const fetchGeneration = ++state.pendingDeviceFetchGeneration
    const current = () => state.identityGeneration === generation && state.account?.ownerId === ownerId
      && state.pendingDeviceFetchGeneration === fetchGeneration
    try {
      const payload = await accessApi('/cloud/devices/pending')
      if (!current() || !Array.isArray(payload.devices)) return
      const list = byId('pending-device-list')
      list.replaceChildren()
      byId('pending-devices').hidden = payload.devices.length === 0
      byId('pending-device-badge').hidden = payload.devices.length === 0
      errorAt('pending-device-error', '')
      for (const device of payload.devices) {
        const item = element('li', 'device-item')
        const content = element('div', 'device-content')
        content.append(element('strong', '', device.name || '新设备'),
          element('p', 'device-meta', `请求于 ${formatDate(device.requestedAt)}`),
          element('code', 'device-meta', device.fingerprint))
        const actions = element('div', 'actions')
        for (const [decision, label] of [['allow', '允许'], ['deny', '拒绝']]) {
          const button = element('button', decision === 'allow' ? 'button primary small' : 'button secondary small', label)
          button.type = 'button'
          button.addEventListener('click', async () => {
            for (const control of actions.children) control.disabled = true
            try {
              await accessApi(`/cloud/devices/${encodeURIComponent(device.id)}/decision`, { method: 'POST', protectedWrite: true, body: { decision } })
              if (current()) await refreshPendingDevices()
            } catch (error) {
              if (!current()) return
              errorAt('pending-device-error', failureMessage(error))
              for (const control of actions.children) control.disabled = false
            }
          })
          actions.append(button)
        }
        item.append(content, actions)
        list.append(item)
      }
    } catch (error) {
      if (!current() || error.code === 'NOT_FOUND') return
      errorAt('pending-device-error', '待批准设备暂时无法读取，请点击刷新重试。')
    }
  }

  function accountModelMarkerKey() { return `weftmate:account-model-operation:${state.ownerId || 'none'}` }
  function savedAccountModelMarker() {
    try {
      const value = JSON.parse(localStorage.getItem(accountModelMarkerKey()) || 'null')
      return value?.ownerId === state.ownerId && value?.hostId === state.hostId &&
        /^[0-9a-f-]{36}$/.test(value.requestId || '') &&
        ['create', 'update', 'test', 'stop_using', 'remove'].includes(value.kind) ? value : null
    } catch { return null }
  }
  function storeAccountModelMarker(marker) {
    try { localStorage.setItem(accountModelMarkerKey(), JSON.stringify(marker)); return true }
    catch { return false }
  }
  function forgetAccountModelMarker(requestId) {
    if (savedAccountModelMarker()?.requestId === requestId)
      try { localStorage.removeItem(accountModelMarkerKey()) } catch { /* Pending state stays visible. */ }
  }
  function accountModelStatus(text, error = false) {
    const node = byId('account-models-status')
    node.textContent = text
    node.classList.toggle('form-error', error)
  }
  async function accountModelReceipt(marker, token) {
    try {
      const result = await accessApi(`/account/models/by-request/${encodeURIComponent(marker.requestId)}`)
      if (!accountCurrent(token)) return null
      const operation = result?.operation
      if (operation?.requestId !== marker.requestId || operation.kind !== marker.kind)
        throw { code: 'MODEL_RECEIPT_INVALID' }
      if (operation.status === 'succeeded') {
        forgetAccountModelMarker(marker.requestId)
        const checked = operation.testResult
        accountModelStatus(operation.kind === 'test'
          ? (checked?.configured === true && checked.reachable === true && checked.modelListed === true
            ? '目录与鉴权已核对；尚未发送推理消息。'
            : '连接检查已完成，但目录、鉴权或模型列表未通过；尚未发送推理消息。')
          : operation.kind === 'stop_using'
            ? '已停止使用；原会话记录与绑定仍保留，后续新发送需要另选可用模型。'
            : operation.kind === 'remove'
              ? '已移除账户配置；手机另存的副本保持不变。'
              : '账户模型配置已保存；已有会话模型绑定保持不变。',
          operation.kind === 'test' && !(checked?.configured === true && checked.reachable === true && checked.modelListed === true))
        void refreshAccountModels(true); void refreshModels()
      } else if (operation.status === 'failed') {
        forgetAccountModelMarker(marker.requestId)
        accountModelStatus('这次模型操作未完成；原有配置仍可查看。', true)
      } else accountModelStatus(operation.reasonCode === 'RUNTIME_BUSY'
        ? '电脑正在处理其他回合；原模型请求已保存，稍后用同编号核对。'
        : '模型操作仍在处理；原请求编号已保存，不会再次创建。')
      return result
    } catch (error) {
      if (accountCurrent(token)) accountModelStatus(error.code === 'NOT_FOUND'
        ? '电脑尚未找到原请求；原编号已保存。请核对输入后再明确重试。'
        : '原请求暂时无法核对，配置与密钥输入仍保留在本页。', true)
      return null
    }
  }
  function renderAccountModels() {
    const list = byId('account-models-list')
    list.replaceChildren()
    const marker = savedAccountModelMarker()
    const form = byId('account-model-form')
    form.hidden = !state.accountModelsCanManage
    if (!state.accountModels.length) {
      list.append(element('li', 'muted', '当前账户尚无已配置的电脑模型。手机原模型不会自动上传。'))
    }
    for (const model of state.accountModels) {
      const row = element('li', 'project-row')
      const main = element('div', 'project-row-main')
      main.append(element('strong', '', model.name || model.modelId),
        element('small', '', `${model.modelId} · ${{ active: '可用', stopped: '已停止使用', pending: '配置中', failed: '配置失败' }[model.status] || '待核对'} · 修订 ${model.revision}`))
      const actions = element('div', 'actions')
      const edit = element('button', 'button quiet small', '编辑')
      edit.disabled = state.accountModelBusy || !!marker || model.status !== 'active'
      edit.addEventListener('click', () => {
        state.accountModelEditing = { id: model.accountModelId, revision: model.revision }
        byId('account-model-name').value = model.name || ''
        byId('account-model-base-url').value = model.baseUrl || ''
        byId('account-model-id').value = model.modelId || ''
        byId('account-model-tier').value = model.modelTier || 'auto'
        byId('account-model-key').value = ''
        byId('account-model-submit').textContent = '保存修改'
        byId('account-model-cancel').hidden = false
        byId('account-model-form-status').textContent = '留空密钥表示沿用原地址已保存的密钥；换地址需输入新地址的密钥。'
        byId('account-model-name').focus()
      })
      actions.append(edit)
      if (model.status === 'active') {
        const test = element('button', 'button secondary small', '测试连接')
        test.disabled = state.accountModelBusy || !!marker
        test.addEventListener('click', () => { void submitAccountModelControl(model, 'test') })
        const stop = element('button', 'button quiet small', '停止使用')
        stop.disabled = state.accountModelBusy || !!marker
        stop.addEventListener('click', () => {
          if (stop.dataset.confirm !== 'yes') {
            stop.dataset.confirm = 'yes'; stop.textContent = '确认停止'; return
          }
          void submitAccountModelControl(model, 'stop_using')
        })
        actions.append(test, stop)
      } else if (model.status === 'stopped' || model.status === 'failed') {
        const remove = element('button', 'button danger small', '移除配置')
        remove.disabled = state.accountModelBusy || !!marker
        remove.addEventListener('click', () => {
          if (remove.dataset.confirm !== 'yes') {
            remove.dataset.confirm = 'yes'; remove.textContent = '确认移除'; return
          }
          void submitAccountModelControl(model, 'remove')
        })
        actions.append(remove)
      }
      row.append(main, actions)
      list.append(row)
    }
  }
  async function refreshAccountModels(preserveStatus = false) {
    const token = accountToken()
    if (!accountCurrent(token)) return
    const generation = ++state.accountModelFetchGeneration
    if (!preserveStatus) accountModelStatus('正在读取当前账户的电脑模型…')
    try {
      const result = await accessApi('/account/models')
      if (!accountCurrent(token) || generation !== state.accountModelFetchGeneration) return
      if (!Array.isArray(result.models)) throw { code: 'MODEL_RECEIPT_INVALID' }
      byId('account-model-section').hidden = false
      state.accountModels = result.models.filter((item) =>
        typeof item?.accountModelId === 'string' && Number.isSafeInteger(item.revision) &&
        typeof item.name === 'string' && typeof item.modelId === 'string')
      state.accountModelsCanManage = result.canManage === true
      renderAccountModels()
      const marker = savedAccountModelMarker()
      if (marker) void accountModelReceipt(marker, token)
      else if (!preserveStatus) accountModelStatus(state.accountModels.length
        ? '测试连接只核目录和鉴权；配置变化不会改变已有会话的模型。'
        : '可把手机已保存的云模型从手机明确上传，或在此新增账户配置。')
    } catch (error) {
      if (accountCurrent(token) && error.code === 'NOT_FOUND') byId('account-model-section').hidden = true
      if (accountCurrent(token) && generation === state.accountModelFetchGeneration)
        accountModelStatus(error.code === 'NOT_FOUND' ? '当前电脑尚未接入账户模型配置。'
          : '账户模型目录暂时无法读取；已有聊天与草稿保持原样。', true)
    }
  }
  async function submitAccountModelControl(model, kind) {
    const token = accountToken()
    if (!accountCurrent(token) || state.accountModelBusy) return
    const prior = savedAccountModelMarker()
    if (prior && (prior.kind !== kind || prior.accountModelId !== model.accountModelId)) {
      accountModelStatus('上一项模型操作仍待核对；先刷新原请求状态。', true); return
    }
    const marker = prior || { ownerId: state.ownerId, hostId: state.hostId,
      requestId: crypto.randomUUID(), kind, accountModelId: model.accountModelId,
      expectedRevision: model.revision }
    if (!storeAccountModelMarker(marker)) {
      accountModelStatus('无法保存请求编号，本次没有提交。', true); return
    }
    const path = `/account/models/${encodeURIComponent(model.accountModelId)}${kind === 'test' ? '/test'
      : kind === 'stop_using' ? '/stop-using' : ''}`
    state.accountModelBusy = true; renderAccountModels()
    try {
      const previous = await accountModelReceipt(marker, token)
      if (!accountCurrent(token) || previous?.operation) return
      const sent = await accessApi(path, { method: kind === 'remove' ? 'DELETE' : 'POST',
        protectedWrite: true, body: { requestId: marker.requestId,
          expectedRevision: marker.expectedRevision } })
      if (!accountCurrent(token)) return
      if (sent?.operation?.requestId !== marker.requestId) throw { code: 'MODEL_RECEIPT_INVALID' }
      await accountModelReceipt(marker, token)
    } catch (error) {
      if (accountCurrent(token)) accountModelStatus('结果待核对，原请求编号已保留；不会重复提交。', true)
    } finally {
      if (accountCurrent(token)) { state.accountModelBusy = false; renderAccountModels() }
    }
  }

  function renderProjects() {
    const list = byId('projects-list')
    list.replaceChildren()
    byId('project-register-form').hidden = !state.projectCanManage
    if (!state.projects.length) {
      byId('projects-status').textContent = state.projectCanManage
        ? '还没有登记项目。选择一个你愿意让这台电脑读取的资料目录。'
        : '当前账户没有可用项目。请在原电脑账户中登记资料目录。'
      return
    }
    byId('projects-status').textContent = ''
    for (const project of state.projects) {
      if (!/^project-[A-Za-z0-9-]{1,128}$/.test(project?.projectId ?? '')) continue
      const row = element('li', 'project-row')
      const title = element('div', 'project-row-main')
      title.append(element('strong', '', project.name || '未命名项目'),
        element('small', '', project.revoked ? '已撤销 · 历史来源与成果仍可查看'
          : `可读取 · 修订 ${project.revision}`))
      row.append(title)
      if (state.projectCanManage && !project.revoked) {
        const revoke = element('button', 'button quiet small', '撤销')
        revoke.type = 'button'
        revoke.addEventListener('click', () => {
          if (revoke.dataset.confirm !== 'yes') {
            revoke.dataset.confirm = 'yes'; revoke.textContent = '确认撤销'; return
          }
          const token = accountToken()
          revoke.disabled = true
          const requestId = crypto.randomUUID()
          void accessApi(`/projects/${encodeURIComponent(project.projectId)}/revoke`, {
            method: 'POST', protectedWrite: true, body: { requestId },
          }).then(() => { if (accountCurrent(token)) void refreshProjects() }, (error) => {
            if (!accountCurrent(token)) return
            revoke.disabled = false
            revoke.dataset.confirm = ''
            revoke.textContent = '撤销'
            byId('projects-status').textContent = error.code === 'NETWORK'
              ? '撤销结果尚未确认，请刷新项目列表核对。' : '撤销未完成，请刷新后重试。'
          })
        })
        row.append(revoke)
      }
      list.append(row)
    }
  }

  async function refreshProjects() {
    const token = accountToken()
    if (!accountCurrent(token)) return
    const generation = ++state.projectFetchGeneration
    byId('projects-status').textContent = '正在读取项目…'
    try {
      const payload = await accessApi('/projects')
      if (!accountCurrent(token) || generation !== state.projectFetchGeneration) return
      if (!Array.isArray(payload?.projects) || typeof payload.canManage !== 'boolean') throw { code: 'REQUEST_FAILED' }
      state.projects = payload.projects
      state.projectCanManage = payload.canManage
      renderProjects()
    } catch (error) {
      if (!accountCurrent(token) || generation !== state.projectFetchGeneration) return
      state.projects = []
      state.projectCanManage = false
      byId('projects-list').replaceChildren()
      byId('project-register-form').hidden = true
      byId('projects-status').textContent = error.status === 404
        ? '当前电脑服务还没有项目目录功能；原有聊天与历史仍可使用。'
        : error.code === 'NETWORK' ? '电脑暂时不可达，重连后可刷新项目。' : '项目暂时无法读取，请刷新重试。'
    }
  }

  const browserRequestId = /^[0-9a-f-]{36}$/
  const browserModelId = /^[A-Za-z0-9._-]{1,128}$/
  function browserIntentKey(ownerId = state.ownerId, hostId = state.browserHostId) {
    return `weftmate-browser-intent:${ownerId}:${hostId}`
  }
  function savedBrowserIntent(ownerId = state.ownerId, hostId = state.browserHostId) {
    if (!ownerId || !hostId) return null
    try {
      const value = JSON.parse(localStorage.getItem(browserIntentKey(ownerId, hostId)) || 'null')
      return value?.ownerId === ownerId && value.hostId === hostId &&
        browserModelId.test(value.modelProfileId ?? '') &&
        browserRequestId.test(value.sessionRequestId ?? '') && browserRequestId.test(value.messageRequestId ?? '') &&
        typeof value.goal === 'string' && value.goal.length > 0 && value.goal.length <= 6000 &&
        Array.isArray(value.urls) && value.urls.length >= 1 && value.urls.length <= 5 &&
        value.urls.every((url) => typeof url === 'string' && url.length <= 2048) ? value : null
    } catch { return null }
  }
  function renderBrowserModels() {
    const select = byId('browser-model-select')
    const previous = select.value || savedBrowserIntent()?.modelProfileId || state.modelProfileId
    select.replaceChildren()
    for (const model of state.models) {
      const option = element('option', '', `${model.name} · ${model.sourceKind === 'local' ? '电脑本机' : '电脑云端'}`)
      option.value = model.id
      select.append(option)
    }
    select.value = state.models.some((item) => item.id === previous) ? previous : state.models[0]?.id || ''
    select.disabled = !state.models.length || !state.browserAvailable
    const selected = state.models.find((item) => item.id === select.value)
    byId('browser-destination').textContent = selected
      ? `网页实际读取的正文将交给${selected.sourceKind === 'local' ? '电脑本机' : '电脑云端'}模型“${selected.name}”。`
      : '电脑尚无已配置模型，网页任务暂不能开始。'
    byId('browser-workspace-form').querySelector('button[type="submit"]').disabled = !selected || !state.browserAvailable
  }
  async function refreshBrowserWorkspace() {
    const token = accountToken()
    if (!accountCurrent(token)) return
    const generation = ++state.browserFetchGeneration
    const status = byId('browser-workspace-status')
    status.textContent = '正在核对网页阅读能力…'
    try {
      const payload = await accessApi('/workspaces/browser')
      if (!accountCurrent(token) || generation !== state.browserFetchGeneration) return
      if (payload?.workspaceKind !== 'browser' || typeof payload.available !== 'boolean' ||
          typeof payload.hostId !== 'string' || payload.hostId !== state.hostId) throw { code: 'REQUEST_FAILED' }
      state.browserHostId = payload.hostId
      state.browserAvailable = payload.available
      byId('browser-workspace-form').hidden = !payload.available
      if (!payload.available) { status.textContent = '当前账户或电脑暂不能发起网页阅读；原有任务仍可查看。'; return }
      const prior = savedBrowserIntent()
      if (prior) {
        byId('browser-url-list').value = prior.urls.join('\n')
        byId('browser-goal').value = prior.goal
      }
      renderBrowserModels()
      status.textContent = prior ? '发现上次未确认的网页任务，正在用原编号核对。' : ''
      status.hidden = !status.textContent
      if (prior) void reconcileBrowserIntent(prior, status)
    } catch (error) {
      if (!accountCurrent(token) || generation !== state.browserFetchGeneration) return
      state.browserAvailable = false
      byId('browser-workspace-form').hidden = true
      status.hidden = false
      status.textContent = error.status === 404 ? '当前电脑服务还没有网页资料入口；原有项目和聊天仍可使用。'
        : error.code === 'NETWORK' ? '电脑暂时不可达，重连后可核对原网页任务。' : '网页阅读状态暂不可核对。'
    }
  }

  async function reconcileBrowserIntent(intent, status) {
    const token = accountToken()
    const current = () => accountCurrent(token) && state.browserHostId === intent.hostId
    if (!current()) return
    status.hidden = false
    status.textContent = '正在按原编号核对网页会话…'
    let command = null
    try { command = (await accessApi(`/commands/by-request/${encodeURIComponent(intent.sessionRequestId)}`))?.command || null }
    catch (error) {
      if (!current()) return
      if (error.code !== 'NOT_FOUND') { status.textContent = '暂时无法核对原会话请求；选择和编号已保留。'; return }
    }
    if (!command) {
      try {
        command = (await accessApi('/workspaces/browser/sessions', { method: 'POST', protectedWrite: true,
          body: { requestId: intent.sessionRequestId, modelProfileId: intent.modelProfileId } }))?.command || null
      } catch { if (current()) status.textContent = '会话送达状态不明；原编号已保留，不会另建会话。'; return }
    }
    if (!current()) return
    if (command?.kind !== 'session.create' || command.requestId !== intent.sessionRequestId ||
        command.workspaceKind !== 'browser' || !sessionIdPattern.test(command.sessionId ?? '')) {
      status.textContent = '网页会话回执与原选择不一致，已保留请求供核对。'; return
    }
    for (let attempt = 0; attempt < 5 && current() && ['pending', 'dispatching'].includes(command.state); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 800))
      if (!current()) return
      try { command = (await accessApi(`/commands/by-request/${encodeURIComponent(intent.sessionRequestId)}`))?.command || command }
      catch { break }
    }
    if (command.state !== 'accepted_by_dsh') { status.textContent = '电脑尚未确认网页会话，原编号仍保留。'; return }
    let sessions
    try { sessions = (await accessApi('/sessions'))?.sessions }
    catch { if (current()) status.textContent = '网页会话列表暂不可核对，原编号仍保留。'; return }
    if (!current()) return
    if (!Array.isArray(sessions) || !sessions.some((item) => item.sessionId === command.sessionId &&
        item.workspaceKind === 'browser' && item.modelProfileId === intent.modelProfileId)) {
      status.textContent = '网页会话已受理，等待准确绑定进入列表。'; return
    }
    state.sessions = sessions
    const text = `${intent.goal}\n\n网页链接：\n${intent.urls.join('\n')}`
    let message = null
    try { message = (await accessApi(`/commands/by-request/${encodeURIComponent(intent.messageRequestId)}`))?.command || null }
    catch (error) { if (error.code !== 'NOT_FOUND') {
      if (current()) status.textContent = '网页目标状态暂无法核对，原编号仍保留。'; return
    } }
    if (!current()) return
    if (!message) {
      try { message = (await accessApi('/commands', { method: 'POST', protectedWrite: true,
        body: { requestId: intent.messageRequestId, kind: 'session.message',
          targetDeviceId: intent.hostId, sessionId: command.sessionId, text, mode: 'queue' } }))?.command || null }
      catch { if (current()) status.textContent = '网页目标送达状态不明；原消息编号已保留。'; return }
    }
    if (!current()) return
    if (message?.kind !== 'session.message' || message.requestId !== intent.messageRequestId ||
        message.sessionId !== command.sessionId || message.workspaceKind !== 'browser') {
      status.textContent = '网页目标回执与原选择不一致，编号已保留。'; return
    }
    if (message.state !== 'accepted_by_dsh') {
      status.textContent = '电脑已记录网页目标，正在派发；可按原编号重新核对。'; return
    }
    try { localStorage.removeItem(browserIntentKey(intent.ownerId, intent.hostId)) } catch { /* same request remains safe */ }
    await enterAssistant()
    if (state.ownerId === intent.ownerId && state.sessions.some((item) => item.sessionId === command.sessionId)) {
      await selectSession(command.sessionId)
      toast('网页目标已送达原会话；请在事情中查看实际阅读与来源。')
    }
  }

  const memoryBase = `${accessBase}/memory`
  const memoryKinds = { cognition: '理解', entity: '人物与事物', relationship: '关系', event: '经历' }
  const memoryPreDispatchCodes = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_REQUEST', 'NOT_FOUND', 'MEMORY_DISABLED',
    'MEMORY_UNAVAILABLE', 'MEMORY_ACTION_UNSUPPORTED', 'MEMORY_DELETE_UNAVAILABLE'])
  const memoryItemId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
  const memoryPathId = (id) => typeof id === 'string' && memoryItemId.test(id) ? id : null
  function memoryIdentity() {
    return { generation: state.identityGeneration, ownerId: state.account?.ownerId,
      deviceId: state.device?.id, csrf: state.csrfToken, view: memory.viewGeneration }
  }
  function memoryIdentityCurrent(token) {
    return token.generation === state.identityGeneration && token.ownerId === state.account?.ownerId
      && token.deviceId === state.device?.id && token.csrf === state.csrfToken && !!token.csrf
  }
  function memoryViewCurrent(token) {
    return memoryIdentityCurrent(token) && state.currentView === 'memory' && token.view === memory.viewGeneration
  }
  function memoryStatus(message, error = false) {
    const node = byId('memory-status')
    const degraded = memory.status?.state === 'degraded'
    const modelNote = degraded && memory.status?.capabilities?.inject === false
      ? (memory.status?.reasonCode === 'MEMORY_MODEL_UNAVAILABLE'
        ? '模型路线暂不可用，当前记忆未用于模型回复。 ' : '当前记忆未用于模型回复。 ')
      : ''
    const processingNote = memory.status?.blockedBoundaryCount > 0
      ? '部分来源已阻断，当前不会自动重试。 '
      : memory.status?.pendingBoundaryCount > 0 ? '有来源待处理。 ' : ''
    node.textContent = `${modelNote}${processingNote}${message}`
    node.classList.toggle('is-error', error)
  }
  function detailStatus(message, error = false) {
    const node = byId('memory-detail-status')
    node.textContent = message
    node.classList.toggle('is-error', error)
  }
  function detailError(message) { errorAt('memory-detail-error', message) }
  function showMemoryReceipt(message, requestId, action = 'none') {
    memory.receiptNotice = { message, requestId, action }
    byId('memory-receipt-text').textContent = message
    byId('memory-receipt-id').textContent = requestId
    byId('memory-receipt-check').hidden = action === 'none'
    byId('memory-receipt-check').textContent = action === 'retry-cleanup' ? '重试底层清理' : '核对处理结果'
    byId('memory-receipt').hidden = false
  }
  function resetMemoryIdentity() {
    memory.viewGeneration++
    memory.entryGeneration++
    memory.queryGeneration++
    memory.selectedGeneration++
    memory.operationGeneration++
    memory.status = null
    memory.items = []
    memory.revision = null
    memory.cursor = null
    memory.hasMore = false
    memory.query = ''
    memory.kind = 'cognition'
    memory.selected = null
    memory.sources = []
    memory.mode = 'detail'
    memory.drafts.clear()
    memory.activeOperation = null
    memory.unresolvedMarker = null
    memory.cleanupMarker = null
    memory.cleanupRetrying = false
    memory.receiptNotice = null
    byId('memory-kind').value = 'cognition'
    byId('memory-query').value = ''
    byId('memory-list').replaceChildren()
    byId('memory-more').hidden = true
    byId('memory-receipt').hidden = true
    byId('memory-detail-text').textContent = ''
    byId('memory-sources').replaceChildren()
    byId('memory-correct-text').value = ''
    detailError('')
    detailStatus('')
    memoryStatus('登录后可查看当前账户的记忆。')
    if (byId('memory-detail-dialog').open) byId('memory-detail-dialog').close()
  }
  async function memoryRequest(path, { method = 'GET', body } = {}) {
    const identity = memoryIdentity()
    const headers = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (method !== 'GET') {
      if (!state.csrfToken) throw { code: 'UNAUTHORIZED', status: 401 }
      headers['X-WeftMate-CSRF'] = state.csrfToken
    }
    let response
    try {
      response = await fetch(`${memoryBase}${path}`, { method, headers, credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.timeout(15_000), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    } catch { throw { code: 'NETWORK', status: 0 } }
    const payload = await response.json().catch(() => ({}))
    if (!memoryIdentityCurrent(identity)) throw { code: 'STALE_MEMORY_RESPONSE', status: 0 }
    if ((response.ok || Object.hasOwn(payload, 'ownerId')) && payload.ownerId !== identity.ownerId) {
      clearSession()
      show('login')
      toast('登录账户已在其他页面改变，请重新登录核对账户。')
      throw { code: 'MEMORY_OWNER_MISMATCH', status: 401 }
    }
    if (!response.ok) throw { code: payload?.error?.code ?? 'REQUEST_FAILED', status: response.status, payload }
    return payload
  }
  function memoryFailure(error) {
    if (error?.status === 403 || error?.code === 'FORBIDDEN') return '当前账户没有查看这项记忆的权限。'
    if (error?.code === 'MEMORY_SEARCH_LIMIT') return '当前账户记忆超过搜索上限，未返回局部结果。请稍后再试。'
    if (error?.code === 'MEMORY_REVISION_CHANGED') return '记忆已变更，旧页已清除。保留了搜索条件，请重新查询。'
    if (error?.code === 'NETWORK') return '连接中断，记忆状态暂时无法确认。请重试。'
    return '记忆暂时无法读取。请检查连接并重试。'
  }
  function invalidateMemorySnapshot(message, error = true) {
    closeMemoryDetail()
    memory.items = []
    memory.revision = null
    memory.cursor = null
    memory.hasMore = false
    byId('memory-list').replaceChildren()
    byId('memory-more').hidden = true
    memoryStatus(message, error)
  }
  function memoryLifecycle(item) {
    const life = item?.lifecycle ?? {}
    const labels = []
    if (life.invalidAt) labels.push('已失效')
    if (life.archivedAt) labels.push('已归档')
    if (life.mutedAt) labels.push('已停用，不参与召回')
    if (labels.length) return labels.join(' · ')
    return item?.currentState === 'current' ? '当前有效' : '状态待确认'
  }
  function renderMemoryItems() {
    const list = byId('memory-list')
    list.replaceChildren()
    for (const item of memory.items) {
      const row = element('li', 'memory-item')
      const button = element('button', 'memory-item-button')
      button.type = 'button'
      button.append(element('span', 'memory-item-text', typeof item.text === 'string'
        ? `${item.text}${item.truncated === true ? '\n（仅显示片段）' : ''}` : '内容暂不可用'))
      button.append(element('span', 'memory-item-meta', `${memoryKinds[item.kind] ?? '记忆'} · ${memoryLifecycle(item)}${item.updatedAt ? ` · 更新于 ${formatDate(item.updatedAt)}` : ''}`))
      if (!memoryPathId(item.id)) {
        button.disabled = true
        button.append(element('span', 'memory-item-meta', '此标识无法安全打开详情，暂可在列表查看。'))
      } else button.addEventListener('click', () => { void openMemoryDetail(item.kind, item.id) })
      row.append(button)
      list.append(row)
    }
    byId('memory-more').hidden = !memory.hasMore
  }
  async function refreshMemoryStatus() {
    const token = memoryIdentity()
    if (!memoryViewCurrent(token)) return false
    memoryStatus('正在检查记忆服务…')
    try {
      const payload = await memoryRequest('/status')
      if (!memoryViewCurrent(token)) return false
      if (!['ready', 'degraded', 'disabled', 'unavailable'].includes(payload?.state) || !payload?.capabilities) throw { code: 'REQUEST_FAILED' }
      memory.status = payload
      if (!['ready', 'degraded'].includes(payload.state) || payload.capabilities.list !== true) {
        invalidateMemorySnapshot(payload.state === 'disabled' ? '记忆尚未接入当前宿主。'
          : ['ready', 'degraded'].includes(payload.state) ? '当前账户没有记忆列表权限。' : '记忆服务暂时不可用，请稍后刷新。', payload.state !== 'disabled')
        return false
      }
      return true
    } catch (error) {
      if (!memoryViewCurrent(token)) return false
      if (error.code === 'UNAUTHORIZED' || error.status === 401) { sessionExpired(); return false }
      memory.status = null
      invalidateMemorySnapshot(memoryFailure(error))
      return false
    }
  }
  async function loadMemoryPage({ more = false } = {}) {
    const token = memoryIdentity()
    if (!memoryViewCurrent(token) || !['ready', 'degraded'].includes(memory.status?.state) || memory.status.capabilities.list !== true) return
    const queryGeneration = more ? memory.queryGeneration : ++memory.queryGeneration
    const kind = memory.kind
    const query = memory.query
    const after = more ? memory.cursor : null
    if (more && (!memory.hasMore || !after)) return
    if (!more) { memory.items = []; memory.cursor = null; memory.hasMore = false; byId('memory-list').replaceChildren(); byId('memory-more').hidden = true }
    memoryStatus(more ? '正在读取更多记忆…' : '正在读取记忆…')
    byId('memory-more').disabled = true
    try {
      const params = new URLSearchParams({ kind, limit: '20' })
      if (query) params.set('query', query)
      if (after) params.set('after', after)
      const page = await memoryRequest(`/items?${params}`)
      if (!memoryViewCurrent(token) || queryGeneration !== memory.queryGeneration) return
      if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.worldRevision)
        || page.searchScope !== 'account_snapshot' || typeof page.hasMore !== 'boolean'
        || (page.hasMore && (typeof page.nextCursor !== 'string' || !page.nextCursor))
        || (more && memory.revision !== page.worldRevision)
        || page.items.some((item) => item?.kind !== kind || typeof item.id !== 'string')) throw { code: 'MEMORY_REVISION_CHANGED' }
      memory.items = more ? [...memory.items, ...page.items] : page.items
      memory.revision = page.worldRevision
      memory.cursor = page.nextCursor ?? null
      memory.hasMore = page.hasMore
      renderMemoryItems()
      memoryStatus(memory.items.length ? `已读取${memoryKinds[kind]}。${memory.hasMore ? '可继续读取更多。' : ''}`
        : query ? '当前类型没有匹配的已形成记忆。'
          : memory.status?.pendingBoundaryCount > 0
            ? '尚无已形成记忆；有待处理来源。'
            : '当前账户的这一类记忆为空。')
    } catch (error) {
      if (!memoryViewCurrent(token) || queryGeneration !== memory.queryGeneration) return
      if (error.code === 'UNAUTHORIZED' || error.status === 401) return sessionExpired()
      invalidateMemorySnapshot(memoryFailure(error))
    } finally { if (memoryViewCurrent(token) && queryGeneration === memory.queryGeneration) byId('memory-more').disabled = false }
  }
  function memoryActionAllowed(action) {
    const global = memory.status?.capabilities
    const selected = memory.selected
    if (!selected || selected.stale || !['ready', 'degraded'].includes(memory.status?.state)
      || memory.activeOperation || memory.unresolvedMarker) return false
    if (action === 'correct' && selected.kind === 'entity') return false
    const globalKey = action === 'delete' ? 'deleteWorldItem' : action
    return global?.[globalKey] === true && selected.availableActions?.[action]?.available === true
  }
  function renderMemorySources(sources) {
    const list = byId('memory-sources')
    list.replaceChildren()
    if (!sources.length) { byId('memory-sources-status').textContent = '当前没有可展示的来源。'; return }
    byId('memory-sources-status').textContent = ''
    const currentnessLabels = new Map([
      ['current', '当前来源'],
      ['not_current', '来源不再支持当前理解'],
      ['evidence_deleted', '来源已删除'],
      ['evidence_local_read_denied', '来源未允许本机模型读取'],
      ['evidence_cloud_read_denied', '来源未允许云端模型读取'],
      ['evidence_not_model_readable', '来源当前不可供模型读取'],
      ['evidence_missing', '来源记录未找到'],
      ['evidence_subject_mismatch', '来源账户不匹配'],
    ])
    for (const source of sources) {
      const row = element('li', 'memory-source')
      const currentness = currentnessLabels.get(source.currentnessState) ?? '来源状态待确认'
      const meta = element('p', 'memory-source-meta', `${currentness}${source.recordedAt ? ` · 记录于 ${formatDate(source.recordedAt)}` : ''}`)
      const summary = element('p', 'memory-source-summary', typeof source.summary === 'string' && source.summary.trim()
        ? source.summary : source.contentAvailable === false ? '此来源当前不可读。' : '摘要当前不可用。')
      const raw = element('p', 'memory-source-raw', source.contentAvailable === true && typeof source.rawContent === 'string'
        ? `${source.rawContent}${source.rawContentTruncated === true ? '\n（仅显示可读片段）' : ''}` : '原文当前不可用。')
      row.append(meta, summary, raw)
      list.append(row)
    }
  }
  function renderMemoryMode() {
    const mode = memory.mode
    byId('memory-detail-body').hidden = false
    byId('memory-correct-panel').hidden = mode !== 'correct'
    byId('memory-confirm-panel').hidden = !['mute', 'delete'].includes(mode)
    byId('memory-detail-back').hidden = mode === 'detail'
    byId('memory-detail-check').hidden = !memory.unresolvedMarker && !memory.cleanupMarker
    byId('memory-detail-check').textContent = memory.cleanupMarker?.cleanupState === 'pending'
      && memory.cleanupMarker?.retryUnknown !== true
      && !memory.unresolvedMarker ? '重试底层清理' : '核对处理结果'
    byId('memory-detail-check').disabled = memory.cleanupRetrying
    byId('memory-correct-action').hidden = mode !== 'detail' || !memoryActionAllowed('correct')
    byId('memory-mute-action').hidden = mode !== 'detail' || !memoryActionAllowed('mute')
    byId('memory-delete-action').hidden = mode !== 'detail' || !memoryActionAllowed('delete')
    byId('memory-confirm-action').hidden = mode === 'detail'
    byId('memory-delete-boundary').hidden = mode !== 'delete'
    if (mode === 'correct') {
      byId('memory-confirm-action').textContent = '保存纠正'
      byId('memory-correct-text').value = memory.drafts.get(`${memory.selected.kind}|${memory.selected.id}`) ?? ''
    } else if (mode === 'mute') {
      byId('memory-confirm-action').textContent = '确认停用'
      byId('memory-confirm-copy').textContent = '停用后仍可查看记忆和来源，但不再用于后续召回。'
    } else if (mode === 'delete') {
      byId('memory-confirm-action').textContent = '确认删除'
      byId('memory-confirm-copy').textContent = '请确认删除这项当前账户记忆。共享或不明来源可能使删除被拒绝；停用可单独选择。'
    }
    byId('memory-confirm-action').disabled = !!memory.activeOperation || !!memory.unresolvedMarker || !!memory.selected?.stale
  }
  function closeMemoryDetail() {
    memory.selectedGeneration++
    memory.selected = null
    memory.sources = []
    memory.mode = 'detail'
    byId('memory-detail-text').textContent = ''
    byId('memory-detail-meta').textContent = ''
    byId('memory-sources').replaceChildren()
    byId('memory-correct-text').value = ''
    detailError('')
    detailStatus('')
    if (byId('memory-detail-dialog').open) byId('memory-detail-dialog').close()
  }
  async function openMemoryDetail(kind, id) {
    const token = memoryIdentity()
    if (!memoryViewCurrent(token) || !memoryKinds[kind] || !memoryPathId(id)) return
    const selectedGeneration = ++memory.selectedGeneration
    memory.selected = null
    memory.sources = []
    memory.mode = 'detail'
    byId('memory-detail-title').textContent = `${memoryKinds[kind]}详情`
    byId('memory-detail-text').textContent = ''
    byId('memory-detail-meta').textContent = ''
    byId('memory-sources').replaceChildren()
    byId('memory-sources-status').textContent = ''
    detailError('')
    detailStatus('正在读取记忆详情…')
    renderMemoryMode()
    if (!byId('memory-detail-dialog').open) byId('memory-detail-dialog').showModal()
    try {
      const result = await memoryRequest(`/items/${kind}/${memoryPathId(id)}`)
      if (!memoryViewCurrent(token) || selectedGeneration !== memory.selectedGeneration) return
      if (result?.item?.id !== id || result.item.kind !== kind || !Number.isSafeInteger(result.worldRevision)) throw { code: 'REQUEST_FAILED' }
      memory.selected = { kind, id, item: result.item, worldRevision: result.worldRevision, availableActions: result.availableActions ?? {} }
      byId('memory-detail-text').textContent = typeof result.item.text === 'string'
        ? `${result.item.text}${result.item.truncated === true ? '\n（仅显示片段）' : ''}` : '内容当前不可用。'
      byId('memory-detail-meta').textContent = `${memoryLifecycle(result.item)}${result.item.updatedAt ? ` · 更新于 ${formatDate(result.item.updatedAt)}` : ''}`
      detailStatus('正在读取来源…')
      renderMemoryMode()
      const sourceResult = await memoryRequest(`/items/${kind}/${memoryPathId(id)}/sources`)
      if (!memoryViewCurrent(token) || selectedGeneration !== memory.selectedGeneration) return
      if (!Array.isArray(sourceResult?.sources) || sourceResult.worldRevision !== result.worldRevision) throw { code: 'MEMORY_REVISION_CHANGED' }
      memory.sources = sourceResult.sources
      renderMemorySources(memory.sources)
      detailStatus('详情与来源已读取。')
    } catch (error) {
      if (!memoryViewCurrent(token) || selectedGeneration !== memory.selectedGeneration) return
      if (error.code === 'UNAUTHORIZED' || error.status === 401) return sessionExpired()
      invalidateMemorySnapshot(memoryFailure(error))
    }
  }
  function memoryMarkerKey(ownerId = state.account?.ownerId, hostId = state.hostId) {
    return typeof ownerId === 'string' && ownerId && typeof hostId === 'string' && hostId
      ? `weftmate:memory-request:v1:${hostId}:${ownerId}` : null
  }
  function persistMemoryMarker(marker, key) {
    if (!key) return false
    try { localStorage.setItem(key, JSON.stringify(marker)); return true } catch { return false }
  }
  function clearMemoryMarker(key) {
    if (!key) return
    try { localStorage.removeItem(key) } catch { /* Best effort; a later lookup is safe. */ }
  }
  function storedMemoryMarker(key) {
    if (!key) return null
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null')
      return value && /^[A-Za-z0-9_.:-]{1,128}$/.test(value.requestId)
        && memoryKinds[value.kind] && typeof value.id === 'string' && value.id.length > 0
        && ['correct', 'mute', 'delete'].includes(value.operation) ? value : null
    } catch { return null }
  }
  function memoryCleanupKey(ownerId = state.account?.ownerId, hostId = state.hostId) {
    return typeof ownerId === 'string' && ownerId && typeof hostId === 'string' && hostId
      ? `weftmate:memory-cleanup:v1:${hostId}:${ownerId}` : null
  }
  function storedCleanupMarkers(key) {
    if (!key) return []
    try {
      const values = JSON.parse(localStorage.getItem(key) || '[]')
      return Array.isArray(values) ? values.filter((value) => value && value.operation === 'delete'
        && /^[A-Za-z0-9_.:-]{1,128}$/.test(value.requestId) && typeof value.id === 'string'
        && memoryKinds[value.kind]).slice(-100) : []
    } catch { return [] }
  }
  function setCleanupMarker(marker, key) {
    if (!key) return
    try {
      const values = storedCleanupMarkers(key).filter((value) => value.requestId !== marker.requestId)
      values.push(marker)
      localStorage.setItem(key, JSON.stringify(values.slice(-100)))
    } catch { /* Current tab can still query the receipt. */ }
  }
  function clearCleanupMarker(requestId, key) {
    if (!key) return
    try { localStorage.setItem(key, JSON.stringify(storedCleanupMarkers(key).filter((value) => value.requestId !== requestId))) }
    catch { /* Best effort. */ }
  }
  function memoryReceiptMessage(receipt, operation) {
    if (receipt.state === 'no_change') return '宿主确认没有发生变更。'
    if (operation === 'correct') return '纠正已应用，当前记忆已更新。'
    if (operation === 'mute') return '记忆已停用，不再参与后续召回；原内容和来源仍可查看。'
    if (receipt.storageCleanup?.state === 'pending') return '已从当前有效记忆与召回移除，底层清理待完成。可稍后查询回执。'
    if (receipt.storageCleanup?.state === 'complete') return '已从当前有效记忆与召回移除，当前存储清理已完成。原聊天、会话存档、过去备份和文件系统快照仍保留。'
    return '已从当前有效记忆与召回移除，底层清理状态待确认；原聊天、会话存档、过去备份和文件系统快照仍保留。'
  }
  function staleMemoryProjection(marker) {
    memory.items = []
    memory.revision = null
    memory.cursor = null
    memory.hasMore = false
    byId('memory-list').replaceChildren()
    byId('memory-more').hidden = true
    if (memory.selected && memory.selected.kind === marker.kind && memory.selected.id === marker.id
      && memory.selectedGeneration === marker.selectedGeneration) closeMemoryDetail()
    else if (memory.selected) {
      memory.selected.stale = true
      detailStatus('记忆已变更；当前详情请关闭后重新打开，暂不可继续操作。')
      renderMemoryMode()
    }
  }
  function applyMemoryReceipt(receipt, marker, key, token) {
    if (!receipt || !['applied', 'no_change', 'revision_conflict', 'rejected'].includes(receipt.state)
      || receipt.requestId !== marker.requestId) return false
    const needsCleanupCheck = marker.operation === 'delete' && receipt.state === 'applied'
      && receipt.storageCleanup?.state !== 'complete'
    const cleanupState = receipt.storageCleanup?.state === 'pending' ? 'pending' : 'unknown'
    const cleanupMarker = needsCleanupCheck ? { ...marker, cleanupOnly: true, cleanupState, retryUnknown: false } : null
    const cleanupKey = memoryCleanupKey(token.ownerId, marker.hostId ?? state.hostId)
    if (!marker.cleanupOnly && storedMemoryMarker(key)?.requestId === marker.requestId) clearMemoryMarker(key)
    if (cleanupMarker) setCleanupMarker(cleanupMarker, cleanupKey)
    else clearCleanupMarker(marker.requestId, cleanupKey)
    if (!memoryIdentityCurrent(token)) return true
    if (memory.unresolvedMarker?.requestId === marker.requestId) memory.unresolvedMarker = null
    memory.cleanupMarker = cleanupMarker
    if (receipt.state === 'applied' || receipt.state === 'no_change') {
      showMemoryReceipt(memoryReceiptMessage(receipt, marker.operation), marker.requestId,
        cleanupMarker ? cleanupMarker.cleanupState === 'pending' ? 'retry-cleanup' : 'check' : 'none')
      if (marker.operation === 'correct') memory.drafts.delete(`${marker.kind}|${marker.id}`)
      if (!marker.cleanupOnly) staleMemoryProjection(marker)
      if (!marker.cleanupOnly && memoryViewCurrent(token)) {
        void refreshMemoryStatus().then((ready) => { if (ready && memoryViewCurrent(token)) void loadMemoryPage() })
      }
      return true
    }
    if (!memoryViewCurrent(token)) return true
    if (receipt.state === 'revision_conflict') {
      staleMemoryProjection(marker)
      memoryStatus('记忆在操作前发生变化，旧页已清除；请重新查询，未自动重试。', true)
      showMemoryReceipt('记忆版本已变化，本次未应用；纠正草稿仍保留。请重新查询后明确提交。', marker.requestId)
      return true
    }
    const code = receipt.reasonCode
    const message = code === 'MEMORY_DELETE_CONFLICT'
      ? '来源仍被其他记忆使用，本次未删除。可查看来源或选择停用。'
      : code === 'MEMORY_SOURCE_UNRECOVERABLE'
        ? '旧来源身份已不可恢复，本次未删除；需要单独处理旧资料。'
        : '宿主拒绝了本次操作，记忆未确认更改。请核对状态后重试。'
    showMemoryReceipt(message, marker.requestId)
    if (memory.selected && memory.selected.kind === marker.kind && memory.selected.id === marker.id
      && memory.selectedGeneration === marker.selectedGeneration) detailError(message)
    return true
  }
  async function recoverMemoryReceipt() {
    const token = memoryIdentity()
    const key = memoryMarkerKey()
    const unknown = storedMemoryMarker(key) ?? memory.unresolvedMarker
    const cleanup = storedCleanupMarkers(memoryCleanupKey()).at(0) ?? memory.cleanupMarker
    const marker = unknown ?? cleanup
    if (!memoryViewCurrent(token) || !marker || memory.activeOperation) return
    memory.unresolvedMarker = unknown ?? null
    memory.cleanupMarker = cleanup ?? null
    showMemoryReceipt(marker.cleanupOnly ? '逻辑删除已确认，正在核对底层清理回执…'
      : '上次操作的结果待确认，正在查询持久回执…', marker.requestId,
    marker.cleanupOnly && marker.cleanupState === 'pending' && marker.retryUnknown !== true ? 'retry-cleanup' : 'check')
    try {
      const result = await memoryRequest(`/commands/by-request/${encodeURIComponent(marker.requestId)}`)
      if (!memoryIdentityCurrent(token)) return
      if (!applyMemoryReceipt(result?.receipt, marker, key, token) && memoryViewCurrent(token)) {
        showMemoryReceipt(marker.cleanupOnly ? '逻辑删除已确认，但底层清理回执仍无法确认。'
          : '仍无法确认上次操作的结果。不会自动重发，请稍后查询。', marker.requestId,
        marker.cleanupOnly && marker.cleanupState === 'pending' && marker.retryUnknown !== true ? 'retry-cleanup' : 'check')
      }
    } catch (error) {
      if (!memoryViewCurrent(token)) return
      if (error.code === 'UNAUTHORIZED' || error.status === 401) return sessionExpired()
      showMemoryReceipt(marker.cleanupOnly ? '逻辑删除已确认，底层清理状态暂无法查询。'
        : '上次操作的结果待确认。不会自动重发；请稍后查询回执。', marker.requestId,
      marker.cleanupOnly && marker.cleanupState === 'pending' && marker.retryUnknown !== true ? 'retry-cleanup' : 'check')
    } finally { if (memoryViewCurrent(token)) renderMemoryMode() }
  }
  async function retryMemoryCleanup() {
    const token = memoryIdentity()
    if (!memoryViewCurrent(token) || memory.cleanupRetrying || memory.activeOperation) return
    const cleanupKey = memoryCleanupKey()
    const displayedId = byId('memory-receipt-id').textContent
    const marker = storedCleanupMarkers(cleanupKey).find((entry) => entry.requestId === displayedId)
      ?? memory.cleanupMarker
    if (!marker?.cleanupOnly || marker.operation !== 'delete' || marker.cleanupState !== 'pending'
      || marker.retryUnknown === true) {
      void recoverMemoryReceipt()
      return
    }
    memory.cleanupRetrying = true
    byId('memory-receipt-check').disabled = true
    byId('memory-detail-check').disabled = true
    showMemoryReceipt('正在请求底层清理并等待结果…', marker.requestId, 'retry-cleanup')
    byId('memory-receipt-check').disabled = true
    try {
      const result = await memoryRequest(`/commands/by-request/${encodeURIComponent(marker.requestId)}/retry-cleanup`,
        { method: 'POST', body: {} })
      if (!memoryIdentityCurrent(token)) return
      if (!(result?.receipt?.state === 'applied' && applyMemoryReceipt(result.receipt, marker,
        memoryMarkerKey(token.ownerId, marker.hostId), token))
        && memoryViewCurrent(token)) {
        const uncertain = { ...marker, retryUnknown: true }
        setCleanupMarker(uncertain, cleanupKey)
        memory.cleanupMarker = uncertain
        showMemoryReceipt('本次清理结果暂无法确认。请先核对原回执；不会自动再次重试。',
          marker.requestId, 'check')
      }
    } catch (error) {
      if (!memoryIdentityCurrent(token)) return
      if (error?.payload?.receipt?.state === 'applied'
        && applyMemoryReceipt(error.payload.receipt, marker, memoryMarkerKey(token.ownerId, marker.hostId), token)) return
      if (error.code === 'UNAUTHORIZED' || error.status === 401) return sessionExpired()
      if (memoryViewCurrent(token)) {
        const refused = error.code === 'FORBIDDEN' || error.status === 403
        if (!refused) {
          const uncertain = { ...marker, retryUnknown: true }
          setCleanupMarker(uncertain, cleanupKey)
          memory.cleanupMarker = uncertain
        }
        const message = refused
          ? '当前账户无权重试底层清理，本次未执行；请核对权限后再决定。'
          : '本次清理结果待确认。请先核对原回执；不会自动再次重试。'
        showMemoryReceipt(message, marker.requestId, refused ? 'retry-cleanup' : 'check')
      }
    } finally {
      if (memoryIdentityCurrent(token)) {
        memory.cleanupRetrying = false
        if (memoryViewCurrent(token)) {
          byId('memory-receipt-check').disabled = false
          renderMemoryMode()
        }
      }
    }
  }
  function handleMemoryReceiptAction() {
    const unknown = storedMemoryMarker(memoryMarkerKey()) ?? memory.unresolvedMarker
    if (unknown) { void recoverMemoryReceipt(); return }
    const cleanup = storedCleanupMarkers(memoryCleanupKey()).find((entry) =>
      entry.requestId === byId('memory-receipt-id').textContent) ?? memory.cleanupMarker
    if (cleanup?.cleanupOnly && cleanup.cleanupState === 'pending' && cleanup.retryUnknown !== true) void retryMemoryCleanup()
    else void recoverMemoryReceipt()
  }
  async function submitMemoryAction() {
    const selected = memory.selected
    const operation = memory.mode
    const token = memoryIdentity()
    if (!memoryViewCurrent(token) || !selected || !['correct', 'mute', 'delete'].includes(operation)
      || !memoryActionAllowed(operation)) return
    const selectedGeneration = memory.selectedGeneration
    let textValue = null
    if (operation === 'correct') {
      textValue = byId('memory-correct-text').value.trim()
      if (!textValue || textValue.length > 4000) return detailError('纠正内容须为 1–4000 个字符。')
      memory.drafts.set(`${selected.kind}|${selected.id}`, textValue)
    }
    const requestId = `memory-${typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
    const marker = { requestId, kind: selected.kind, id: selected.id, operation, selectedGeneration, hostId: state.hostId }
    const key = memoryMarkerKey(token.ownerId, state.hostId)
    const existing = storedMemoryMarker(key)
    if (existing) {
      memory.unresolvedMarker = existing
      return detailError('当前账户有一条待核对操作。请刷新查询原回执后再提交新操作。')
    }
    if (!persistMemoryMarker(marker, key)) return detailError('暂时无法保存回执查询标识；为避免结果不明，本次没有提交。')
    memory.activeOperation = marker
    const operationGeneration = ++memory.operationGeneration
    byId('memory-confirm-action').disabled = true
    detailError('')
    detailStatus('正在提交并等待处理结果…')
    const path = `/items/${selected.kind}/${memoryPathId(selected.id)}/${operation}`
    const body = { requestId, expectedWorldRevision: selected.worldRevision, ...(operation === 'correct' ? { text: textValue } : {}) }
    try {
      const result = await memoryRequest(operation === 'delete'
        ? `/items/${selected.kind}/${memoryPathId(selected.id)}` : path,
      { method: operation === 'delete' ? 'DELETE' : 'POST', body })
      if (!memoryIdentityCurrent(token) || operationGeneration !== memory.operationGeneration) return
      if (!applyMemoryReceipt(result?.receipt, marker, key, token) && memoryViewCurrent(token)) {
        memory.unresolvedMarker = marker
        showMemoryReceipt('回执内容无法确认，原请求仍待核对；不会自动重发。', marker.requestId, 'check')
        detailStatus('本次执行结果待确认。')
        detailError('请点“核对处理结果”查询原请求，不会自动重发。')
      }
    } catch (error) {
      if (!memoryIdentityCurrent(token) || operationGeneration !== memory.operationGeneration) return
      const receipt = error?.payload?.receipt
      if (applyMemoryReceipt(receipt, marker, key, token)) return
      if (memoryPreDispatchCodes.has(error.code)) {
        clearMemoryMarker(key)
        memory.unresolvedMarker = null
        if (error.code === 'UNAUTHORIZED') return sessionExpired()
        if (memoryViewCurrent(token)) {
          if (error.code === 'NOT_FOUND') {
            staleMemoryProjection(marker)
            memoryStatus('这条记忆已不在当前账户的有效库中，旧列表已清除；请刷新查询。', true)
            showMemoryReceipt('记忆已不存在，本次未提交。请刷新列表后重新核对。', marker.requestId)
            return
          }
          const message = error.code === 'INVALID_REQUEST' ? '请求内容未通过检查，本次未提交。请核对更正说明后重新提交。'
            : error.code === 'MEMORY_DELETE_UNAVAILABLE' ? '删除能力暂不可用，本次未提交。'
              : '当前账户或记忆能力不允许这项操作，本次未提交。请刷新状态后核对。'
          detailStatus('本次未提交。')
          showMemoryReceipt(message, marker.requestId)
          detailError(message)
        }
      } else if (error.code === 'MEMORY_REQUEST_CONFLICT' || error.code === 'MEMORY_REPLAY_REDACTED') {
        clearMemoryMarker(key)
        memory.unresolvedMarker = null
        if (memoryViewCurrent(token)) {
          const message = error.code === 'MEMORY_REQUEST_CONFLICT'
            ? '原请求标识与已保存内容冲突，本次未提交。请重新核对后再决定。'
            : '旧请求正文已不可重放，本次未提交。请重新核对后再决定。'
          detailStatus('本次未提交。')
          showMemoryReceipt(message, marker.requestId)
          detailError(message)
          if (memory.selected) memory.selected.stale = true
        }
      } else {
        memory.unresolvedMarker = marker
        if (memoryViewCurrent(token)) {
          showMemoryReceipt('结果待确认，原请求已保留；不会自动重发。', marker.requestId, 'check')
          detailStatus('本次执行结果待确认。')
          detailError('请点“核对处理结果”查询原请求，不会自动重发。')
        }
      }
    } finally {
      if (memoryIdentityCurrent(token) && operationGeneration === memory.operationGeneration) {
        if (memory.activeOperation === marker) memory.activeOperation = null
        if (memoryViewCurrent(token) && selectedGeneration === memory.selectedGeneration) {
          byId('memory-confirm-action').disabled = false
          renderMemoryMode()
        }
      }
    }
  }

  const markerId = /^[A-Za-z0-9_.:-]{1,128}$/
  const sessionIdPattern = /^[A-Za-z0-9_-]{1,128}$/
  const syncIdPattern = /^(?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
  const originalAttachmentBytes = 1024 * 1024 * 1024
  const sharedImageBytes = 5 * 1024 * 1024
  const sharedMessageBytes = 10 * 1024 * 1024
  const sharedTextBytes = 16 * 1024
  const attachmentImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  const attachmentTextTypes = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/x-ndjson'])
  const attachmentTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/
  function attachmentDraftKey(sessionId = state.selectedSessionId) {
    return state.ownerId && sessionId ? `${state.ownerId}|${sessionId}` : null
  }
  function currentAttachmentDrafts() {
    const key = attachmentDraftKey()
    return key ? state.attachmentDrafts.get(key) ?? [] : []
  }
  function attachmentScope(sessionId = state.selectedSessionId) {
    return { generation: state.identityGeneration, ownerId: state.ownerId, deviceId: state.device?.id,
      csrf: state.csrfToken, sessionId, view: state.currentView }
  }
  function attachmentScopeCurrent(scope) {
    return scope.generation === state.identityGeneration && scope.ownerId === state.ownerId &&
      scope.deviceId === state.device?.id && scope.csrf === state.csrfToken && !!scope.csrf &&
      scope.sessionId === state.selectedSessionId && state.activeChatSource === 'desktop' &&
      scope.view === 'assistant' && state.currentView === 'assistant'
  }
  function attachmentMime(file) {
    const supplied = String(file?.type || '').trim().toLowerCase()
    if (attachmentTypePattern.test(supplied)) return supplied
    const extension = String(file?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
    return ({ txt: 'text/plain', text: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
      csv: 'text/csv', json: 'application/json', ndjson: 'application/x-ndjson', jsonl: 'application/x-ndjson',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
      pdf: 'application/pdf' })[extension] || 'application/octet-stream'
  }
  function validAttachmentName(value) {
    return typeof value === 'string' && value === value.trim() && value.length > 0 &&
      Array.from(value).length <= 128 && !/[\\/\x00-\x1f\x7f]/.test(value) && !['.', '..'].includes(value)
  }
  function attachmentHint(item) {
    if (attachmentTextTypes.has(item.contentType)) return '原件可下载 · 最多 16 KB 内容供模型读取'
    if (attachmentImageTypes.has(item.contentType) && item.file.size <= sharedImageBytes) return '原图可下载 · 图片会发送给模型'
    if (attachmentImageTypes.has(item.contentType)) return '原图可下载 · 超过模型图片大小限制'
    if (item.contentType === 'application/pdf') return '原件可下载 · 当前不读取 PDF 内容'
    return '原件可下载 · 当前类型不读取内容'
  }
  function setAttachmentStatus(message) {
    state.attachmentStatus = message
    const status = byId('attachment-status')
    status.textContent = message
    status.hidden = !message
  }
  function renderAttachmentDrafts() {
    const drafts = state.activeChatSource === 'desktop' ? currentAttachmentDrafts() : []
    const root = byId('composer-attachments')
    const list = byId('attachment-draft-list')
    list.replaceChildren()
    for (const item of drafts) {
      const row = element('div', 'attachment-draft')
      const copy = element('span', 'attachment-draft-copy')
      copy.append(element('strong', '', item.file.name),
        element('small', '', `${originalFileSize(item.file.size)} · ${attachmentHint(item)}`))
      const remove = element('button', 'attachment-remove', '移除')
      remove.type = 'button'
      remove.disabled = !!state.attachmentUpload
      remove.setAttribute('aria-label', `移除文件 ${item.file.name}`)
      remove.addEventListener('click', () => removeAttachmentDraft(item.attachmentId))
      row.append(copy, remove)
      list.append(row)
    }
    root.hidden = drafts.length === 0 && !state.attachmentStatus
    setAttachmentStatus(state.attachmentStatus)
  }
  function invalidateAttachmentAttempt(key = attachmentDraftKey()) {
    if (key) state.attachmentAttempts.delete(key)
  }
  function removeAttachmentDraft(attachmentId) {
    if (state.attachmentUpload) return
    const key = attachmentDraftKey()
    if (!key) return
    const remaining = currentAttachmentDrafts().filter((item) => item.attachmentId !== attachmentId)
    if (remaining.length) state.attachmentDrafts.set(key, remaining)
    else {
      state.attachmentDrafts.delete(key)
      state.attachmentGroups.delete(key)
    }
    invalidateAttachmentAttempt(key)
    state.attachmentStatus = ''
    renderAttachmentDrafts()
    updateAvailability()
  }
  function cancelAttachmentUpload(announce = false) {
    const upload = state.attachmentUpload
    if (!upload) return
    upload.controller.abort()
    state.attachmentUpload = null
    if (announce && attachmentScopeCurrent(upload.scope)) setAttachmentStatus('已取消上传，所选文件仍保留，可重新发送。')
    renderAttachmentDrafts()
    updateAvailability()
  }
  async function attachmentHasher() {
    if (!state.attachmentHasher) state.attachmentHasher = import('./file-sha256.js').then((module) => {
      if (typeof module.hashBlobSha256 !== 'function') throw new Error('FILE_HASH_UNAVAILABLE')
      return module.hashBlobSha256
    })
    return state.attachmentHasher
  }
  async function uploadAttachmentBlob(path, blob, contentType, sha256, scope, signal) {
    if (!attachmentScopeCurrent(scope)) throw new DOMException('Upload cancelled', 'AbortError')
    let response
    try {
      response = await fetch(`${accessBase}${path}`, { method: 'PUT', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { 'content-type': contentType, 'x-weftmate-sha256': sha256, 'X-WeftMate-CSRF': scope.csrf }, body: blob })
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') throw new DOMException('Upload cancelled', 'AbortError')
      throw { code: 'NETWORK' }
    }
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = { code: payload?.error?.code || 'REQUEST_FAILED', status: response.status }
      if (error.code === 'UNAUTHORIZED' && attachmentScopeCurrent(scope)) sessionExpired()
      throw error
    }
    if (!attachmentScopeCurrent(scope)) throw new DOMException('Upload cancelled', 'AbortError')
    setOnline(true)
    return payload?.attachment
  }
  function exactAttachmentMeta(value, expected) {
    return value && value.attachmentId === expected.attachmentId && value.name === expected.file.name &&
      value.contentType === expected.contentType && value.size === expected.size && value.sha256 === expected.sha256
      ? { attachmentId: value.attachmentId, name: value.name, contentType: value.contentType,
        size: value.size, sha256: value.sha256 } : null
  }
  async function textStageBlob(file, maximum, signal) {
    const limit = Math.min(file.size, maximum)
    if (limit < 1) return null
    const probe = new Uint8Array(await file.slice(0, Math.min(file.size, limit + 3)).arrayBuffer())
    if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')
    for (let end = Math.min(limit, probe.length); end >= Math.max(0, Math.min(limit, probe.length) - 3); end--) {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(probe.subarray(0, end))
        if (!text || text.includes('\u0000')) return null
        return new Blob([probe.subarray(0, end)], { type: attachmentMime(file) })
      } catch { /* Try the previous UTF-8 boundary. */ }
    }
    return null
  }
  function attachmentAttempt(key, text, drafts) {
    const signature = JSON.stringify([text, ...drafts.map((item) => [item.attachmentId, item.file.name,
      item.file.size, item.file.lastModified, item.contentType])])
    const old = state.attachmentAttempts.get(key)
    if (old?.signature === signature) return old
    const attempt = { signature, requestId: `attachment-send-${crypto.randomUUID()}`, text }
    state.attachmentAttempts.set(key, attempt)
    return attempt
  }
  function finishAttachmentCommand(command) {
    if (command?.kind !== 'session.message' || typeof command.requestId !== 'string') return
    for (const [key, attempt] of state.attachmentAttempts) {
      if (attempt.requestId !== command.requestId) continue
      state.attachmentAttempts.delete(key)
      state.attachmentDrafts.delete(key)
      state.attachmentGroups.delete(key)
      if (key === attachmentDraftKey(command.sessionId)) {
        if (byId('message-text').value === attempt.text) byId('message-text').value = ''
        state.attachmentStatus = ''
        renderAttachmentDrafts()
        updateAvailability()
      }
      break
    }
  }
  async function sendDesktopMessageWithAttachments(text) {
    const sessionId = state.selectedSessionId
    const key = attachmentDraftKey(sessionId)
    const drafts = key ? [...currentAttachmentDrafts()] : []
    if (!key || drafts.length < 1 || drafts.length > 4 || state.attachmentUpload) return null
    const scope = attachmentScope(sessionId)
    const controller = new AbortController()
    const attempt = attachmentAttempt(key, text, drafts)
    const messageId = state.attachmentGroups.get(key) || `message-${crypto.randomUUID()}`
    state.attachmentGroups.set(key, messageId)
    const upload = { controller, scope, key, requestId: attempt.requestId }
    state.attachmentUpload = upload
    setAttachmentStatus('正在核对文件并保存原件…')
    renderAttachmentDrafts()
    updateAvailability()
    try {
      const hashBlob = await attachmentHasher()
      const originals = []
      let completedBytes = 0
      const totalBytes = drafts.reduce((sum, item) => sum + item.file.size, 0)
      for (const item of drafts) {
        if (!attachmentScopeCurrent(scope) || controller.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')
        item.sha256 ||= await hashBlob(item.file, { signal: controller.signal, onProgress: (done) => {
          if (attachmentScopeCurrent(scope)) setAttachmentStatus(`正在核对文件 ${originalFileSize(completedBytes + done)} / ${originalFileSize(totalBytes)}`)
        } })
        const expected = { ...item, size: item.file.size }
        setAttachmentStatus(`正在保存原件 ${originals.length + 1} / ${drafts.length}…`)
        const uploaded = await uploadAttachmentBlob(`/sync/attachments/${encodeURIComponent(item.attachmentId)}` +
          `?conversationId=${encodeURIComponent(sessionId)}&messageId=${encodeURIComponent(messageId)}` +
          `&name=${encodeURIComponent(item.file.name)}`, item.file, item.contentType, item.sha256, scope, controller.signal)
        const exact = exactAttachmentMeta(uploaded, expected)
        if (!exact) throw { code: 'REQUEST_FAILED' }
        originals.push(exact)
        completedBytes += item.file.size
      }
      const staged = []
      let stagedBytes = 0
      let stagedTextBytes = 0
      for (const item of drafts) {
        let blob = null
        if (attachmentImageTypes.has(item.contentType) && item.file.size <= sharedImageBytes &&
          stagedBytes + item.file.size <= sharedMessageBytes) blob = item.file
        else if (attachmentTextTypes.has(item.contentType) && stagedTextBytes < sharedTextBytes) {
          blob = await textStageBlob(item.file, sharedTextBytes - stagedTextBytes, controller.signal)
        }
        if (!blob || staged.length >= 4 || stagedBytes + blob.size > sharedMessageBytes) continue
        const stagedHash = blob === item.file ? item.sha256 : await hashBlob(blob, { signal: controller.signal })
        const expected = { ...item, size: blob.size, sha256: stagedHash }
        setAttachmentStatus(`正在准备模型可读内容 ${staged.length + 1} / ${drafts.length}…`)
        const uploaded = await uploadAttachmentBlob(`/sessions/${encodeURIComponent(sessionId)}/attachments/` +
          `${encodeURIComponent(item.attachmentId)}?requestId=${encodeURIComponent(attempt.requestId)}` +
          `&name=${encodeURIComponent(item.file.name)}`, blob, item.contentType, stagedHash, scope, controller.signal)
        const exact = exactAttachmentMeta(uploaded, expected)
        if (!exact) throw { code: 'REQUEST_FAILED' }
        staged.push(exact)
        stagedBytes += blob.size
        if (attachmentTextTypes.has(item.contentType)) stagedTextBytes += blob.size
      }
      if (!attachmentScopeCurrent(scope)) throw new DOMException('Upload cancelled', 'AbortError')
      state.attachmentUpload = null
      setAttachmentStatus('原件已保存，正在发送消息…')
      updateAvailability()
      return await submitCommand('session.message', { sessionId, text, mode: composerInputMode(sessionId),
        ...(staged.length ? { attachments: staged } : {}), attachmentMessageId: messageId,
        originalAttachments: originals }, sessionId, attempt.requestId)
    } catch (error) {
      if (attachmentScopeCurrent(scope)) {
        if (error?.name === 'AbortError') setAttachmentStatus('已取消上传，所选文件仍保留，可重新发送。')
        else setAttachmentStatus(error?.code === 'BODY_TOO_LARGE' ? '文件超过可保存大小，请移除后重试。'
          : error?.code === 'CAPACITY_LIMIT' ? '附件存储空间不足，所选文件仍保留。'
            : error?.code === 'INVALID_REQUEST' ? '文件内容或名称未通过检查，请移除后重新选择。'
              : '文件发送未完成，所选文件仍保留，可重试。')
      }
      return null
    } finally {
      if (state.attachmentUpload === upload) state.attachmentUpload = null
      if (attachmentScopeCurrent(scope)) {
        renderAttachmentDrafts()
        updateAvailability()
      }
    }
  }
  function phoneOutboxKey() { return state.ownerId && state.device?.id
    ? `weftmate:phone-sync-outbox:v1:${state.ownerId}:${state.device.id}` : null }
  function phoneSequenceKey() { return state.ownerId && state.device?.id
    ? `weftmate:phone-sync-seq:v1:${state.ownerId}:${state.device.id}` : null }
  function phoneRecoveryKey() { return state.ownerId ? `weftmate:phone-sync-recovery:v1:${state.ownerId}` : null }
  function readPhoneRecovery() {
    try {
      const row = JSON.parse(localStorage.getItem(phoneRecoveryKey()) || 'null')
      return row?.ownerId === state.ownerId && sessionIdPattern.test(row.deviceId) &&
        syncIdPattern.test(row.event?.eventId) && syncIdPattern.test(row.event?.conversationId) &&
        typeof row.event?.payload?.text === 'string' ? row : null
    } catch { return null }
  }
  function readPhoneOutbox() {
    const key = phoneOutboxKey()
    if (!key) return null
    try {
      const row = JSON.parse(localStorage.getItem(key) || 'null')
      const event = row?.event
      return row?.ownerId === state.ownerId && row?.deviceId === state.device.id &&
        syncIdPattern.test(event?.eventId) && syncIdPattern.test(event?.conversationId) &&
        syncIdPattern.test(event?.payload?.messageId) && event.kind === 'message.created' &&
        event.payload.role === 'user' && typeof event.payload.text === 'string' &&
        event.payload.text.trim() && Number.isSafeInteger(event.clientSeq) && event.clientSeq > 0
        ? row : null
    } catch { return null }
  }
  function writePhoneOutbox(row) {
    const key = phoneOutboxKey()
    if (!key) return false
    try {
      localStorage.setItem(key, JSON.stringify(row))
      localStorage.setItem(phoneRecoveryKey(), JSON.stringify(row))
      return true
    } catch {
      try { localStorage.removeItem(key) } catch { /* Retain any already durable record. */ }
      return false
    }
  }
  function clearPhoneOutbox() {
    const key = phoneOutboxKey()
    if (!key) return
    try { localStorage.removeItem(key) } catch { /* A later reconciliation can still clear the receipt. */ }
    if (readPhoneRecovery()?.deviceId === state.device?.id) {
      try { localStorage.removeItem(phoneRecoveryKey()) } catch { /* no further send while outbox remains */ }
    }
  }
  function nextPhoneClientSeq() {
    let saved = 0
    try { saved = Number(localStorage.getItem(phoneSequenceKey()) || '0') } catch { /* use server events */ }
    const server = state.phoneEvents.filter((event) => event.sourceDeviceId === state.device?.id)
      .reduce((maximum, event) => Math.max(maximum, Number.isSafeInteger(event.clientSeq) ? event.clientSeq : 0), 0)
    const next = Math.max(Number.isSafeInteger(saved) && saved > 0 ? saved : 0, server,
      Number.isSafeInteger(Date.now()) ? Date.now() - 1 : 0) + 1
    return Number.isSafeInteger(next) ? next : null
  }
  function rememberPhoneClientSeq(value) {
    try { localStorage.setItem(phoneSequenceKey(), String(value)) } catch { /* receipt remains in the outbox */ }
  }
  function markerKey() { return state.ownerId ? `weftmate:requests:v1:${state.ownerId}` : null }
  function sessionKey() { return state.ownerId ? `weftmate:last-session:v1:${state.ownerId}` : null }
  function desktopAckKey() { return state.ownerId ? `weftmate:desktop-ack:v1:${state.ownerId}` : null }
  function readDesktopAcknowledgements() {
    try {
      const value = JSON.parse(localStorage.getItem(desktopAckKey()) || '[]')
      return Array.isArray(value) ? value.filter((id) => typeof id === 'string' && sessionIdPattern.test(id)).slice(-5000) : []
    } catch { return [] }
  }
  function acknowledgeDesktop(command) {
    if (command.kind !== 'desktop.open_app' || !['accepted_by_host', 'uncertain'].includes(command.state)) return
    state.acknowledgedDesktop.add(command.commandId)
    try { localStorage.setItem(desktopAckKey(), JSON.stringify([...state.acknowledgedDesktop].slice(-5000))) }
    catch { /* In private browsing the current page still records the acknowledgement. */ }
    forgetMarker(command.requestId)
    operation('已记录你的核对，可重新发起记事本动作。', false, command.requestId)
    renderConversationTasks()
    updateAvailability()
  }
  function readMarkers() {
    const key = markerKey()
    if (!key) return []
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]')
      return Array.isArray(value) ? value.filter((row) => typeof row?.requestId === 'string' && markerId.test(row.requestId) &&
        ['session.create', 'session.message', 'session.cancel', 'desktop.open_app'].includes(row?.kind) &&
        (row.sessionId === undefined || sessionIdPattern.test(row.sessionId)) &&
        (row.commandId === undefined || sessionIdPattern.test(row.commandId)))
        .slice(-30) : []
    } catch { return [] }
  }
  function writeMarkers(rows) {
    const key = markerKey()
    if (!key) return
    try { localStorage.setItem(key, JSON.stringify(rows.slice(-30))) } catch { /* Private browsing can refuse storage. */ }
  }
  function rememberMarker(row) {
    const rows = readMarkers().filter((item) => item.requestId !== row.requestId)
    rows.push({ requestId: row.requestId, kind: row.kind,
      ...(row.commandId ? { commandId: row.commandId } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}) })
    writeMarkers(rows)
  }
  function forgetMarker(requestId) { writeMarkers(readMarkers().filter((row) => row.requestId !== requestId)) }
  function desktopBlocker() {
    const active = (command) => command?.kind === 'desktop.open_app' && command.appId === 'notepad' &&
      ['pending', 'dispatching', 'accepted_by_host', 'uncertain'].includes(command.state) &&
      !state.acknowledgedDesktop.has(command.commandId)
    const task = state.tasks.find(active)
    if (task) return task
    return readMarkers().find((marker) => marker.kind === 'desktop.open_app' && marker.commandId &&
      !state.acknowledgedDesktop.has(marker.commandId)) ?? null
  }
  function setOnline(online) {
    state.online = online
    const badge = document.querySelector('.local-badge')
    badge.hidden = true
    byId('assistant-connection').hidden = true
    byId('connection-copy').textContent = online ? '已连接' : '连接中断，可稍后重试。'
    const banner = byId('connection-banner')
    banner.hidden = online
    banner.classList.toggle('is-offline', !online)
    banner.textContent = online ? '' : '连接中断，正在重试…'
    updateAvailability()
  }
  function operation(message, locked = false, requestId = null, reviewable = locked) {
    if (requestId) {
      if (locked) {
        state.unresolvedRequests.add(requestId)
        if (reviewable) {
          state.reviewableRequests.add(requestId)
          state.reviewRequestId = requestId
        } else state.reviewableRequests.delete(requestId)
      } else {
        state.unresolvedRequests.delete(requestId)
        state.reviewableRequests.delete(requestId)
      }
      if (!state.reviewableRequests.has(state.reviewRequestId)) {
        state.reviewRequestId = [...state.reviewableRequests].at(-1) ?? null
      }
    }
    state.unresolvedSubmission = state.unresolvedRequests.size > 0
    const output = byId('operation-status')
    const visibleMessage = state.unresolvedSubmission && !locked
      ? state.reviewableRequests.size ? '仍有请求结果待核对；不会自动重复发送。请查看事情记录后确认。'
        : '仍有请求正在处理；会继续核对原请求。' : message
    output.hidden = !visibleMessage
    output.textContent = visibleMessage || ''
    byId('reset-operation').hidden = state.reviewableRequests.size === 0
    updateAvailability()
  }
  function updateAvailability() {
    byId('show-phone').hidden = true
    byId('rail-phone').hidden = true
    const phoneChat = state.activeChatSource === 'phone'
    byId('chat-intro').hidden = phoneChat || byId('transcript').children.length > 0
    const pendingPhone = phoneChat ? readPhoneOutbox() : null
    const recovery = phoneChat && !pendingPhone ? readPhoneRecovery() : null
    const pendingHere = pendingPhone?.event.conversationId === state.selectedPhoneConversationId
    const recoveryHere = recovery?.event.conversationId === state.selectedPhoneConversationId
    const bound = phoneChat ? phoneBinding() : null
    const boundSession = bound && state.sessions.find((item) => item.sessionId === bound.sessionId)
    const phoneReady = state.online && !!state.ownerId && !!state.selectedPhoneConversationId && !state.phoneSending &&
      (bound ? boundSession?.sendAvailable === true : state.syncAvailable && !!state.device?.id)
    const chat = state.online && state.capabilities?.chat?.available === true
    const model = state.models.some((item) => item.id === state.modelProfileId)
    const selected = state.sessions.find((item) => item.sessionId === state.selectedSessionId)
    const canSendHere = selected?.sendAvailable === true
    const attachmentCount = phoneChat ? 0 : currentAttachmentDrafts().length
    const attachmentBusy = !!state.attachmentUpload
    byId('new-session').disabled = !chat || !model || state.submitting || attachmentBusy || state.unresolvedSubmission
    byId('model-select').disabled = phoneChat || !chat || !state.models.length
    byId('model-trigger').disabled = byId('model-select').disabled
    byId('model-label').textContent = state.models.find((item) => item.id === state.modelProfileId)?.name || '选择模型'
    if (byId('model-trigger').disabled) closeModelMenu()
    byId('message-text').disabled = phoneChat ? !phoneReady || !!pendingPhone || !!recovery
      : !chat || !model || !canSendHere || attachmentBusy
    byId('voice-input').disabled = byId('message-text').disabled || state.submitting || state.phoneSending
    byId('send-message').disabled = phoneChat ? !phoneReady || (!!pendingPhone && !pendingHere) ||
      (!!recovery && !recoveryHere) || (!pendingPhone && !recovery && !byId('message-text').value.trim())
      : !chat || !model || !canSendHere || state.submitting || attachmentBusy ||
      (!byId('message-text').value.trim() && attachmentCount === 0) || state.unresolvedSubmission
    byId('send-message').textContent = phoneChat ? bound ? '发送到电脑'
      : recoveryHere && !pendingPhone ? '核对旧请求'
        : pendingHere ? '核对并重试' : '同步文字' : '发送'
    byId('message-attachments').disabled = phoneChat || !chat || !model || !canSendHere ||
      state.submitting || attachmentBusy || state.unresolvedSubmission || attachmentCount >= 4
    byId('attachment-add').hidden = phoneChat
    byId('attachment-add').classList.toggle('is-disabled', byId('message-attachments').disabled)
    byId('attachment-add').setAttribute('aria-disabled', String(byId('message-attachments').disabled))
    byId('attachment-cancel').hidden = !attachmentBusy
    byId('attachment-cancel').disabled = !attachmentBusy
    const blockedDesktop = desktopBlocker()
    byId('open-notepad').textContent = blockedDesktop ? '查看原事情' : '打开记事本'
    byId('open-notepad').disabled = blockedDesktop ? false : !state.online ||
      state.capabilities?.desktopOpenApp?.available !== true ||
      !state.capabilities.desktopOpenApp.appIds?.includes('notepad') || state.submitting || state.unresolvedSubmission
    byId('cancel-turn').hidden = phoneChat || !selected?.running
    byId('cancel-turn').disabled = !state.online || !selected?.running || state.cancelSubmitting
    const running = (phoneChat ? boundSession : selected)?.running === true
    byId('message-mode').hidden = !running
    const send = byId('send-message')
    send.classList.toggle('is-stop', running)
    send.dataset.action = running ? 'stop' : 'send'
    send.setAttribute('aria-label', running ? '停止' : '发送')
    send.title = running ? '停止 · Esc' : '发送 · Enter'
    if (running) { send.textContent = '停止'; send.disabled = !state.online || state.cancelSubmitting }
    const hint = byId('model-hint')
    if (phoneChat && bound) hint.textContent = state.phoneSendNotice || ''
    else if (phoneChat) hint.textContent = pendingPhone && !pendingHere
      ? '另一条手机对话有未确认的同步请求。请先切回原对话核对。'
      : pendingHere ? state.phoneSendNotice || '这条文字的同步结果待核对。重试会沿用同一个消息编号。'
        : recovery && !recoveryHere ? '旧设备有未确认文字，请先切回原手机对话核对。'
          : recoveryHere ? '重新登录后保留了旧文字。先核对服务器是否已接收，再决定是否重新同步。'
        : state.phoneSendNotice || ''
    else if (!state.online) hint.textContent = '等待重新连接电脑。'
    else if (selected && !canSendHere) hint.textContent = '旧会话历史可读；要继续聊天或在对话中执行，请新建受限远端会话。'
    else if (!chat || !model) hint.textContent = '电脑尚无可用模型。历史可阅读，聊天请先在电脑设置中配置模型。'
    else hint.textContent = ''
    hint.hidden = !hint.textContent
  }
  async function refreshStatus() {
    let payload
    try { payload = await accessApi('/status') }
    catch (error) { if (error.code !== 'UNAUTHORIZED') setOnline(false); throw error }
    if (typeof payload.ownerId !== 'string' || typeof payload.hostId !== 'string') throw { code: 'REQUEST_FAILED' }
    if (state.ownerId !== payload.ownerId) {
      state.ownerId = payload.ownerId
      state.unresolvedRequests = new Set(readMarkers().filter((marker) =>
        marker.kind !== 'desktop.open_app' || !marker.commandId).map((marker) => marker.requestId))
      state.reviewableRequests.clear()
      state.reviewRequestId = null
      state.acknowledgedDesktop = new Set(readDesktopAcknowledgements())
      state.unresolvedSubmission = state.unresolvedRequests.size > 0
      if (state.unresolvedSubmission) operation('正在核对上次请求。')
    }
    state.hostId = payload.hostId
    state.capabilities = payload.backend?.capabilities ?? null
    state.syncAvailable = payload.sync?.available === true
    if (!state.syncAvailable && state.phonePane) showConversation()
    updateAvailability()
  }
  async function refreshModels() {
    const payload = await accessApi('/models')
    state.models = Array.isArray(payload.models) ? payload.models.filter((item) => item?.configured === true &&
      typeof item.id === 'string' && typeof item.name === 'string') : []
    const select = byId('model-select')
    const previous = state.modelProfileId
    select.replaceChildren()
    if (state.models.length === 0) {
      select.append(element('option', '', '没有可用模型'))
      state.modelProfileId = null
    } else {
      for (const model of state.models) {
        const option = element('option', '', model.name)
        option.value = model.id
        select.append(option)
      }
      state.modelProfileId = state.models.some((item) => item.id === previous) ? previous : state.models[0].id
      select.value = state.modelProfileId
    }
    updateAvailability()
    if (state.currentView === 'account' && state.browserAvailable) renderBrowserModels()
  }
  function renderSessions() {
    const list = byId('session-list')
    list.replaceChildren()
    const phone = phoneConversations()
    const linkedSessionIds = new Set(phone.map((record) => phoneBinding(record.id)?.sessionId).filter(Boolean))
    if (!state.sessions.length && !phone.length) { byId('sessions-status').textContent = '还没有会话。'; return }
    byId('sessions-status').textContent = ''
    const query = (byId('session-search').value || '').normalize('NFKC').trim().toLocaleLowerCase()
    let currentGroup = null, matches = 0
    for (const session of window.WeftDesktop?.sortSessions(state.sessions) || state.sessions) {
      if (!sessionIdPattern.test(session.sessionId) || linkedSessionIds.has(session.sessionId)) continue
      const title = typeof session.title === 'string' && session.title ? session.title : '新对话'
      if (query && !title.normalize('NFKC').toLocaleLowerCase().includes(query)) continue
      const group = window.WeftDesktop?.sessionGroup(session) || '会话'
      if (window.WeftDesktop && group !== currentGroup) { list.append(element('li', 'session-group', group)); currentGroup = group }
      matches++
      const row = element('li')
      const button = element('button', state.activeChatSource === 'desktop' &&
        session.sessionId === state.selectedSessionId ? 'is-current' : '')
      button.type = 'button'
      const label = element('span', 'session-title')
      label.append(element('span', 'session-title-text', title)); button.append(label)
      if (session.running) { const dot = element('span', 'session-running-dot'); dot.setAttribute('aria-label', '正在运行'); button.children[0].append(dot) }
      if ([...conversationApprovals.entries.values()].some(entry => entry.row.sessionId === session.sessionId && entry.row.status === 'pending')) {
        const dot = element('span', 'session-pending-dot'); dot.setAttribute('aria-label', '等待审批'); label.append(dot)
      }
      button.addEventListener('click', () => { void selectSession(session.sessionId) })
      row.append(button)
      list.append(row)
    }
    for (const record of phone) {
      if (query && !phoneDisplayTitle(record).normalize('NFKC').toLocaleLowerCase().includes(query)) continue
      matches++
      const row = element('li')
      const button = element('button', state.activeChatSource === 'phone' &&
        record.id === state.selectedPhoneConversationId ? 'is-current' : '')
      button.type = 'button'
      button.append(element('span', 'session-title', phoneDisplayTitle(record)))
      button.addEventListener('click', () => { selectPhoneConversation(record.id) })
      row.append(button)
      list.append(row)
    }
    byId('sessions-status').textContent = matches ? '' : '没有找到会话。'
  }
  async function refreshSessions() {
    const payload = await accessApi('/sessions')
    state.sessions = Array.isArray(payload.sessions) ? payload.sessions : []
    if (!state.selectedSessionId && state.sessions.length && state.ownerId) {
      let saved = null
      try { saved = localStorage.getItem(sessionKey()) } catch { /* no preference storage */ }
      const chosen = state.sessions.find((item) => item.sessionId === saved) ?? state.sessions[0]
      if (chosen?.sessionId) await selectSession(chosen.sessionId)
    } else renderSessions()
    if (state.turnStatus === 'running') renderTurnStatus()
    updateAvailability()
  }
  function normalizedOriginalAttachment(item) {
    if (!item || typeof item.attachmentId !== 'string' || !syncIdPattern.test(item.attachmentId)
      || typeof item.name !== 'string' || item.name !== item.name.trim() || !item.name ||
      Array.from(item.name).length > 128 || /[\x00-\x1f\x7f\\/]/.test(item.name) || ['.', '..'].includes(item.name)
      || typeof item.contentType !== 'string' || item.contentType.length > 127 ||
      !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(item.contentType)
      || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 1024 * 1024 * 1024
      || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) return null
    return { attachmentId: item.attachmentId, name: item.name, contentType: item.contentType,
      size: item.size, sha256: item.sha256 }
  }
  function normalizedOriginalFile(item) {
    const attachment = normalizedOriginalAttachment(item)
    return attachment && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(attachment.contentType)
      ? attachment : null
  }
  function originalFileSize(size) {
    if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`
    if (size >= 1024) return `${Math.ceil(size / 1024)} KB`
    return `${size} B`
  }
  function appendOriginalFiles(row, event) {
    const files = (Array.isArray(event.data?.originalAttachments) ? event.data.originalAttachments : [])
      .map(normalizedOriginalFile).filter(Boolean)
    if (!files.length) return 0
    const list = element('div', 'synced-file-list')
    for (const file of files) {
      const link = element('a', 'synced-file')
      link.href = `${accessBase}/sync/attachments/${encodeURIComponent(file.attachmentId)}`
      link.setAttribute('download', file.name)
      link.setAttribute('aria-label', `下载文件 ${file.name}`)
      link.append(element('strong', '', file.name), element('small', '', originalFileSize(file.size)),
        element('span', '', '下载'))
      list.append(link)
    }
    row.append(list)
    return files.length
  }
  function unpreviewedOriginalImages(event) {
    const ids = Array.isArray(event.data?.unpreviewedOriginalImageIds)
      ? [...new Set(event.data.unpreviewedOriginalImageIds.filter((id) => typeof id === 'string' && syncIdPattern.test(id)))].slice(0, 4)
      : []
    if (!ids.length) return []
    const originals = new Map((Array.isArray(event.data?.originalAttachments) ? event.data.originalAttachments : [])
      .map(normalizedOriginalAttachment).filter((item) => item &&
        ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.contentType))
      .map((item) => [item.attachmentId, item]))
    return ids.map((id) => originals.get(id)).filter(Boolean)
  }
  function appendUnpreviewedOriginalImages(row, images) {
    if (!images.length) return 0
    const list = element('div', 'synced-image-original-list')
    for (const image of images) {
      const link = element('a', 'synced-image-original')
      link.href = `${accessBase}/sync/attachments/${encodeURIComponent(image.attachmentId)}`
      link.setAttribute('download', image.name)
      link.setAttribute('aria-label', `下载图片原件，${originalFileSize(image.size)}`)
      link.append(element('strong', '', '下载图片原件'), element('small', '', originalFileSize(image.size)))
      list.append(link)
    }
    row.append(list)
    return images.length
  }
  function appendHistory(events) {
    const list = byId('transcript')
    const sessionId = state.selectedSessionId
    for (const event of events) {
      if (!Number.isSafeInteger(event?.seq) || state.seenSeq.has(event.seq)) continue
      if (typeof event.sessionId === 'string' && event.sessionId !== sessionId) continue
      state.seenSeq.add(event.seq)
      state.historyEvents.set(event.seq, event)
      if (event.type === 'turn.started') { state.turnStatus = 'running'; state.turnEndReasonKind = null; continue }
      if (event.type === 'turn.ended') {
        state.turnStatus = ['completed', 'aborted', 'error', 'blocked'].includes(event.data?.reason) ? event.data.reason : 'unknown'
        state.turnEndReasonKind = state.turnStatus === 'error' && event.data?.endReasonKind === 'max-tokens' ? 'max-tokens' : null
        continue
      }
      if (!['user.message', 'assistant.message'].includes(event.type)) continue
      const images = event.type === 'user.message' && Array.isArray(event.data?.images) ? event.data.images : []
      const files = event.type === 'user.message' && Array.isArray(event.data?.originalAttachments)
        ? event.data.originalAttachments.map(normalizedOriginalFile).filter(Boolean) : []
      const originalImages = event.type === 'user.message' ? unpreviewedOriginalImages(event) : []
      if (typeof event.data?.text !== 'string' && images.length === 0 && files.length === 0 && originalImages.length === 0) continue
      const row = element('li', `message ${event.type === 'user.message' ? 'user' : 'assistant'}`)
      if (event.type === 'user.message' && receiptIdPattern.test(event.data?.receiptId || '')) row.dataset.receiptId = event.data.receiptId
      row.dataset.seq = String(event.seq)
      if (typeof event.data?.text === 'string' && event.data.text) row.append(event.type === 'assistant.message' && window.WeftDesktop
        ? window.WeftDesktop.markdown(event.data.text, 'message-text markdown-body') : element('span', 'message-text', event.data.text))
      if (images.length) {
        const gallery = element('div', 'synced-image-gallery')
        const previewScope = { ownerId: state.ownerId, identityGeneration: state.identityGeneration,
          source: 'desktop', conversationId: sessionId }
        let unavailable = 0
        for (const image of images) {
          if (!sessionIdPattern.test(sessionId) || !/^sha256:[a-f0-9]{64}$/.test(image?.attachmentId) ||
              !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image?.contentType) ||
              !Number.isSafeInteger(image?.size) || image.size < 1 || image.size > 5 * 1024 * 1024 ||
              image?.sessionId !== undefined && image.sessionId !== sessionId) { unavailable++; continue }
          const name = typeof image.name === 'string' && image.name.trim() ? image.name.slice(0, 128) : '图片'
          const url = `${accessBase}/sessions/${sessionId}/attachments/${image.attachmentId}`
          const button = element('button', 'synced-image')
          button.type = 'button'
          button.setAttribute('aria-label', `查看原图 ${name}`)
          const thumb = element('img')
          thumb.src = url
          thumb.alt = ''
          thumb.loading = 'lazy'
          thumb.decoding = 'async'
          button.append(thumb)
          button.addEventListener('click', () => openPhoneImagePreview(url, name, button, previewScope))
          gallery.append(button)
        }
        if (gallery.children.length) {
          row.classList.add('message-has-images')
          if (!event.data?.text) row.classList.add('message-image-only')
          row.append(gallery)
        }
        if (unavailable) row.append(element('small', 'truncated', `${unavailable} 张历史图片暂无法查看。`))
      }
      if (files.length) appendOriginalFiles(row, event)
      if (originalImages.length) appendUnpreviewedOriginalImages(row, originalImages)
      if (event.data.truncated === true) row.append(element('span', 'truncated', '这条记录已截断，可在电脑查看完整来源。'))
      const next = [...list.children].find(n => Number(n.dataset.seq) > event.seq)
      if (next) list.insertBefore(row, next); else list.append(row)
    }
    const terminal = [...state.historyEvents.values()].filter(e => ['turn.started', 'turn.ended'].includes(e.type)).sort((a,b) => a.seq-b.seq).at(-1)
    if (terminal) { state.turnStatus = terminal.type === 'turn.started' ? 'running' : ['completed', 'aborted', 'error', 'blocked'].includes(terminal.data?.reason) ? terminal.data.reason : 'unknown'; state.turnEndReasonKind = state.turnStatus === 'error' && terminal.data?.endReasonKind === 'max-tokens' ? 'max-tokens' : null }
    renderTimeline()
    renderTurnStatus()
    renderConversationTasks()
  }
  function renderTurnStatus() {
    if (state.activeChatSource === 'phone') return
    const status = byId('timeline-status')
    const isRunning = state.turnStatus === 'running' && state.sessions.find(item => item.sessionId === state.selectedSessionId)?.running === true
    status.classList.toggle('is-running', isRunning)
    if (state.historyHasMore) {
      status.textContent = '正在补读会话历史，尚未核对到本轮结束。'
      return
    }
    switch (state.turnStatus) {
      case 'running': {
        if (!isRunning) { status.textContent = '这轮对话尚无结束记录。请核对结果后继续。'; break }
        const events = [...state.historyEvents.values()].sort((a, b) => a.seq - b.seq)
        const started = events.filter(e => e.type === 'turn.started').at(-1)
        const elapsed = Date.now() - Date.parse(started?.at)
        const duration = Number.isFinite(elapsed) && elapsed >= 0 ? ` ${Math.floor(elapsed / 60000)}分${Math.floor(elapsed % 60000 / 1000)}秒` : ''
        const steps = new Map()
        for (const event of events) {
          const data = event.type.startsWith('step.') ? event.data : event.data?.completedStep
          if (data?.stepId && (!started || event.seq > started.seq)) steps.set(data.stepId, data)
        }
        const currentStep = [...steps.values()].filter(step => step.state === 'running').at(-1)
        status.textContent = `正在处理…${duration}${currentStep?.summary ? ` · ${currentStep.summary}` : ''}`
        break
      }
      case 'aborted': status.textContent = '本轮已停止。如需继续，请重新发送。'; break
      case 'blocked': status.textContent = '本轮因执行受限而停止，目标尚未确认完成。'; break
      case 'error': status.textContent = state.turnEndReasonKind === 'max-tokens'
        ? '回复达到长度限制。发送“继续”接着处理。' : '这次处理未完成。请重试，或到设置检查模型。'; break
      case 'unknown': status.textContent = '本轮结束状态尚不明确，请在电脑核对。'; break
      default: status.textContent = ''
    }
  }
  async function refreshHistory(reset = false) {
    const sessionId = state.selectedSessionId
    if (state.activeChatSource !== 'desktop' || !sessionId || !state.online) return
    if (reset) {
      state.historyGeneration++
      state.afterSeq = -1
      state.historyHasMore = false
      state.seenSeq.clear()
      state.historyEvents.clear()
      state.nextBeforeSeq = null; state.hasOlder = false; state.olderLoading = false
      state.turnStatus = null
      state.turnEndReasonKind = null
      byId('transcript').replaceChildren()
      renderTurnStatus()
    }
    const generation = state.historyGeneration
    const ownerId = state.ownerId
    if (!reset && state.historyInFlight?.generation === generation) return state.historyInFlight.promise
    const stillCurrent = () => state.activeChatSource === 'desktop' && state.historyGeneration === generation && state.ownerId === ownerId &&
      state.selectedSessionId === sessionId && !!state.csrfToken
    const run = async () => {
      const status = byId('timeline-status')
      try {
        const maxPages = reset ? 10 : 5
        for (let pageNo = 0; pageNo < maxPages; pageNo++) {
          const cursor = state.afterSeq
          const page = await accessApi(`/sessions/${encodeURIComponent(sessionId)}/events?${reset && pageNo === 0 ? '' : `afterSeq=${cursor}&`}limit=100`)
          if (!stillCurrent()) return
          if (!Array.isArray(page.events) || !Number.isSafeInteger(page.nextSeq) || page.nextSeq < cursor) throw { code: 'REQUEST_FAILED' }
          state.historyHasMore = page.hasMore === true
          if (reset && pageNo === 0) { state.nextBeforeSeq = page.nextBeforeSeq; state.hasOlder = page.hasOlder === true; renderOlderControl() }
          appendHistory(page.events)
          state.afterSeq = page.nextSeq
          if (!page.hasMore) { renderTurnStatus(); break }
          if (pageNo === maxPages - 1) status.textContent = '历史仍在补读，当前只显示已读取的一部分。'
        }
      } catch (error) {
        if (!stillCurrent()) return
        if (error.code === 'NETWORK') status.textContent = '连接中断，稍后将从原位置续读。'
        else if (error.code !== 'UNAUTHORIZED') status.textContent = '历史暂时无法读取，请稍后重试。'
      }
    }
    const promise = run()
    state.historyInFlight = { generation, promise }
    try { await promise } finally {
      if (state.historyInFlight?.promise === promise) state.historyInFlight = null
    }
  }
  function renderOlderControl() {
    const button = byId('load-older'); button.hidden = !state.hasOlder
    button.disabled = state.olderLoading; button.textContent = state.olderLoading ? '正在读取…' : '加载更早内容'
  }
  async function loadOlderHistory() {
    if (!state.hasOlder || state.olderLoading) return
    const context = conversationTaskContext(), generation = state.historyGeneration, scroll = byId('chat-scroll')
    const top = scroll.scrollTop, height = scroll.scrollHeight; state.olderLoading = true; renderOlderControl()
    try { const page = await accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/events?beforeSeq=${state.nextBeforeSeq}&limit=100`)
      if (!conversationTaskCurrent(context) || generation !== state.historyGeneration) return
      state.nextBeforeSeq = page.nextBeforeSeq; state.hasOlder = page.hasOlder === true
      if (context.source === 'phone') {
        const merged = new Map((state.phoneHostEvents.get(context.conversationId) || []).map(e => [e.seq, e])); for (const e of page.events) merged.set(e.seq,e)
        state.phoneHostEvents.set(context.conversationId, [...merged.values()].sort((a,b) => a.seq-b.seq));
        const cursor = state.phoneHistoryCursors.get(context.conversationId); if (cursor) { cursor.nextBeforeSeq = page.nextBeforeSeq; cursor.hasOlder = page.hasOlder }
        renderSelectedPhoneConversation()
      } else appendHistory(page.events)
      renderOlderControl(); scroll.scrollTop = top + scroll.scrollHeight - height
      void refreshConversationTasks()
    } catch { if (conversationTaskCurrent(context)) byId('timeline-status').textContent = '更早内容暂时无法读取，请重试。' }
    finally { if (generation === state.historyGeneration) { state.olderLoading = false; renderOlderControl() } }
  }
  async function selectSession(sessionId) {
    if (!sessionIdPattern.test(sessionId)) return
    window.WeftDesktop?.closePreview(false)
    const linked = phoneConversations().find((record) => phoneBinding(record.id)?.sessionId === sessionId)
    if (linked) { selectPhoneConversation(linked.id); return }
    const fromPhone = state.activeChatSource === 'phone'
    if (state.selectedSessionId !== sessionId) cancelAttachmentUpload()
    if (fromPhone && state.selectedPhoneConversationId && !readPhoneOutbox())
      state.phoneDrafts.set(state.selectedPhoneConversationId, byId('message-text').value)
    state.activeChatSource = 'desktop'
    byId('conversation-pane').classList.remove('is-phone')
    if (fromPhone) byId('message-text').value = state.desktopDraft
    byId('message-text').placeholder = '向 WeftMate 说说你的目标'
    state.selectedSessionId = sessionId
    state.turnStatus = null
    state.turnEndReasonKind = null
    byId('timeline-status').textContent = ''
    state.attachmentStatus = ''
    renderAttachmentDrafts()
    closePhoneImagePreview()
    byId('chat-intro').hidden = false
    byId('desktop-action').hidden = true
    const selected = state.sessions.find((item) => item.sessionId === sessionId)
    byId('assistant-title').textContent = selected?.title || '新对话'
    renderSessions()
    showConversation()
    closeRail()
    if (state.ownerId) { try { localStorage.setItem(sessionKey(), sessionId) } catch { /* optional preference */ } }
    document.querySelector('.timeline-preview')?.remove()
    await refreshHistory(true)
    byId('chat-scroll').scrollTop = byId('chat-scroll').scrollHeight
    void refreshConversationTasks()
    updateAvailability()
  }
  function commandTitle(command) {
    if (command.kind === 'desktop.write_artifact') return command.fileName || '电脑生成的文件'
    if (command.kind === 'desktop.open_app') return '在电脑打开记事本'
    if (command.kind === 'session.create') return '新建对话'
    if (command.kind === 'session.message') return !command.rootTaskId && typeof command.taskLabel === 'string' && command.taskLabel
      ? command.taskLabel : '发送消息'
    if (command.kind === 'session.cancel') return '请求停止回复'
    return '请求'
  }
  function commandStatus(command) {
    if (command.kind === 'desktop.write_artifact') {
      return command.state === 'observed' && command.verification?.status === 'observed' &&
        command.verification?.method === 'sha256_readback' ? '文件已由电脑写入并读回核验。'
        : command.state === 'rejected' ? '文件未生成。' : '文件尚未完成读回核验。'
    }
    switch (command.state) {
      case 'pending': return '请求已记录，等待派发。'
      case 'dispatching': return '正在交给电脑执行。'
      case 'accepted_by_dsh':
        if (command.kind === 'session.create') return '新对话已创建。'
        if (command.kind === 'session.message') return '消息已送达，回复见原会话。'
        if (command.kind === 'session.cancel') return '停止请求已受理，实际状态见会话。'
        return '请求已受理。'
      case 'accepted_by_host': return '电脑已接收启动请求，窗口尚未核验。'
      case 'observed':
        if (command.kind === 'desktop.open_app') {
          if (command.verification?.status === 'observed' && command.verification?.method === 'visible_window') {
            return command.verification.outcome === 'already_open'
              ? '记事本已在电脑上打开，窗口已核验。' : '记事本窗口已打开并核验。'
          }
          return '动作状态已更新，窗口仍待核对。'
        }
        return '已从原会话观察到结果。'
      case 'uncertain': return '结果待确认。请先查看原会话或电脑，不会自动重复执行。'
      case 'rejected':
        if (command.errorCode === 'SESSION_READ_ONLY') return '旧会话只供阅读；请新建受限远端会话后继续。'
        if (command.errorCode === 'MODEL_UNAVAILABLE') return '电脑没有可用模型，请先在电脑设置中配置。'
        if (command.errorCode === 'RUNTIME_UNAVAILABLE') return '电脑运行时不可用，请稍后再试。'
        if (command.errorCode === 'CAPABILITY_UNAVAILABLE') return '这项电脑能力目前不可用。'
        return '请求未执行，请核对电脑状态。'
      default: return '正在核对请求状态。'
    }
  }
  function taskReplyText(evidence) {
    switch (evidence?.status) {
      case 'waiting': return '回复：电脑会话正在等待模型输出。'
      case 'streaming': return `回复：模型正在生成${evidence.lastChunkAt ? `，最近输出于 ${formatDate(evidence.lastChunkAt)}` : ''}；尚未见到结束记录。`
      case 'completed': return evidence.assistantMessages > 0
        ? '回复：电脑会话已正常结束。' : '回复：回合已结束，但没有已核对的最终文字回复。'
      case 'aborted': return '回复：回合已中断；已核验的文件仍可查看。'
      case 'blocked': return '回复：模型请求被阻断，尚无正常结束记录。'
      case 'failed': return evidence.endReasonKind === 'max-tokens'
        ? '回复：因输出限制结束，尚未确认完整交付。' : '回复：模型回合未完成；请查看原会话的错误。'
      default: return '回复：是否结束尚无法核对；请勿把已核验文件当作回复完成。'
    }
  }
  function conversationTaskContext() {
    const conversationId = state.activeChatSource === 'phone' ? state.selectedPhoneConversationId : null
    const sessionId = conversationId ? phoneBinding(conversationId)?.sessionId : state.selectedSessionId
    return { sessionId, conversationId, source: state.activeChatSource,
      ownerId: state.ownerId, identity: state.identityGeneration, history: state.historyGeneration }
  }
  function conversationTaskCurrent(context) {
    const current = conversationTaskContext()
    return state.currentView === 'assistant' && !!state.csrfToken && context.ownerId === current.ownerId &&
      context.identity === current.identity && context.sessionId === current.sessionId &&
      context.conversationId === current.conversationId && context.source === current.source && context.history === current.history
  }
  function relatedExecutionSteps(payload) {
    const commands = [payload.source, ...(Array.isArray(payload.supplements) ? payload.supplements : []),
      ...(Array.isArray(payload.resumes) ? payload.resumes : [])].filter((row) => row?.kind === 'session.message' &&
      row.sessionId === payload.sessionId && (row.commandId === payload.taskId && !row.rootTaskId || row.rootTaskId === payload.taskId))
    return (Array.isArray(payload.executionSteps) ? payload.executionSteps : []).filter((row) => row &&
      typeof row.executionId === 'string' && row.executionId.length > 0 && row.executionId.length <= 256 &&
      typeof row.toolName === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(row.toolName) &&
      ['running', 'completed', 'failed', 'cancelled', 'uncertain'].includes(row.state) &&
      commands.some((command) => command.commandId === row.sourceCommandId &&
        receiptIdPattern.test(command.receiptId || '') && command.receiptId === row.sourceReceiptId))
  }
  function executionProgress(row) {
    const jobs = { running: '后台运行中', stopping: '后台正在停止', completed: '后台已结束', killed: '后台已停止',
      failed: '后台未完成', uncertain: '后台状态待确认', unconfirmed: '后台状态待确认' }
    return Object.hasOwn(jobs, row.jobState) ? jobs[row.jobState] : row.jobId ? '后台状态待确认'
      : { running: '正在执行', completed: '执行结束', failed: '未完成', cancelled: '已停止', uncertain: '待确认' }[row.state]
  }
  function executionName(row) {
    return { pwsh: '运行命令', read: '读取文件', write: '写入文件', edit: '修改文件', glob: '查找文件', grep: '搜索内容',
      weftmod: '设备操作', weftmod_script: '运行脚本', job_output: '读取后台输出', job_list: '查看后台任务', job_kill: '停止后台任务' }[row.toolName] || '工具操作'
  }
  const approvalIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  const approvalRequestPattern = /^[A-Za-z0-9_.:-]{1,128}$/
  const approvalIdentityFields = ['approvalId', 'sessionId', 'taskId', 'sourceCommandId', 'sourceReceiptId',
    'turn', 'callId', 'rootCallId', 'toolName', 'createdAt']
  function resetConversationApprovals() {
    conversationApprovals.scope = null
    conversationApprovals.entries.clear()
    conversationApprovals.reads.clear()
    conversationApprovals.operations.clear()
    conversationApprovals.readGeneration++
  }
  function approvalContext() { return { ...conversationTaskContext(), deviceId: state.device?.id } }
  function approvalContextCurrent(context) {
    return conversationTaskCurrent(context) && context.deviceId === state.device?.id
  }
  function approvalIdentity(row) { return Object.fromEntries(approvalIdentityFields.map((field) => [field, row[field]])) }
  function sameApproval(left, right) {
    return approvalIdentityFields.every((field) => left?.[field] === right?.[field])
  }
  function validApproval(row, sessionId) {
    const time = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
    if (!row || !approvalIdentityFields.every((field) => field === 'turn' || typeof row[field] === 'string') ||
        !approvalIdPattern.test(row.approvalId || '') || row.sessionId !== sessionId ||
        !sessionIdPattern.test(row.taskId || '') || !sessionIdPattern.test(row.sourceCommandId || '') ||
        !receiptIdPattern.test(row.sourceReceiptId || '') || !Number.isSafeInteger(row.turn) || row.turn < 1 ||
        !approvalRequestPattern.test(row.callId || '') || !approvalRequestPattern.test(row.rootCallId || '') ||
        typeof row.toolName !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(row.toolName) ||
        typeof row.reason !== 'string' || row.reason.length > 1000 || !time(row.createdAt) ||
        !['pending', 'answered', 'resolved', 'unavailable'].includes(row.status)) return false
    const hasDecision = [row.decisionOutcome, row.decisionRequestId, row.answeredAt].some((value) => value !== undefined)
    if (hasDecision && (!['allowed-once', 'rejected'].includes(row.decisionOutcome) ||
        !approvalRequestPattern.test(row.decisionRequestId || '') || !time(row.answeredAt))) return false
    if (row.status === 'pending') return !hasDecision && row.outcome === undefined && row.resolvedAt === undefined
    if (row.status === 'answered') return hasDecision && row.outcome === undefined && row.resolvedAt === undefined
    if (row.status === 'unavailable') return ['cancelled', 'unavailable'].includes(row.outcome)
    return ['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(row.outcome) && time(row.resolvedAt) &&
      (!['allowed-once', 'rejected'].includes(row.outcome) || hasDecision && row.decisionOutcome === row.outcome)
  }
  function approvalMarkerKey(context) { return `weftmate:approval-decisions:v1:${context.ownerId}:${context.deviceId}` }
  function approvalMarkers(context) {
    try {
      const rows = JSON.parse(localStorage.getItem(approvalMarkerKey(context)) || '[]')
      return Array.isArray(rows) ? rows.filter((row) => row && approvalIdPattern.test(row.approvalId || '') &&
        sessionIdPattern.test(row.sessionId || '') && sessionIdPattern.test(row.taskId || '') &&
        sessionIdPattern.test(row.sourceCommandId || '') && receiptIdPattern.test(row.sourceReceiptId || '') &&
        Number.isSafeInteger(row.turn) && row.turn > 0 && approvalRequestPattern.test(row.callId || '') &&
        approvalRequestPattern.test(row.rootCallId || '') && approvalRequestPattern.test(row.requestId || '') &&
        ['allowed-once', 'rejected'].includes(row.outcome)) : []
    } catch { return [] }
  }
  function approvalMarker(context, row) { return approvalMarkers(context).find((marker) => sameApproval(marker, row)) }
  function saveApprovalMarker(context, marker) {
    const rows = approvalMarkers(context).filter((row) => row.approvalId !== marker.approvalId)
    localStorage.setItem(approvalMarkerKey(context), JSON.stringify([...rows, marker]))
  }
  function clearApprovalMarker(context, approvalId) {
    try { localStorage.setItem(approvalMarkerKey(context), JSON.stringify(approvalMarkers(context)
      .filter((row) => row.approvalId !== approvalId))) } catch { /* The authoritative record still prevents a new answer. */ }
  }
  function approvalSource(row, fresh = false) {
    const entry = conversationTasks.entries.get(row.taskId), payload = entry?.payload
    if (!payload || fresh && entry.notice || payload.taskId !== row.taskId || payload.sessionId !== row.sessionId ||
        payload.source?.commandId !== row.taskId || payload.source.kind !== 'session.message' || payload.source.rootTaskId) return null
    return [payload.source, ...(Array.isArray(payload.supplements) ? payload.supplements : []),
      ...(Array.isArray(payload.resumes) ? payload.resumes : [])].find((command) => command?.kind === 'session.message' &&
      command.sessionId === row.sessionId && command.commandId === row.sourceCommandId &&
      command.receiptId === row.sourceReceiptId && (command.commandId === row.taskId && !command.rootTaskId ||
        command.rootTaskId === row.taskId) && (!Number.isSafeInteger(command.dshTurn) || command.dshTurn === row.turn)) || null
  }
  function mergeApproval(entry, row) {
    if (entry && !sameApproval(entry.row, row)) return { ...entry, authoritative: false,
      notice: '审批来源已变化，无法继续答复。请重新核对原对话。' }
    const rank = { pending: 0, answered: 1, resolved: 2, unavailable: 2 }
    return { ...entry, row: entry && rank[entry.row.status] > rank[row.status] ? entry.row : row,
      authoritative: true, notice: '' }
  }
  async function refreshConversationApprovals(context = approvalContext(), force = false) {
    if (!approvalContextCurrent(context) || !sessionIdPattern.test(context.sessionId || '')) return false
    const scope = JSON.stringify([context.ownerId, context.identity, context.deviceId])
    if (conversationApprovals.scope !== scope) { resetConversationApprovals(); conversationApprovals.scope = scope }
    const key = JSON.stringify(context), prior = conversationApprovals.reads.get(key)
    if (!force && prior) return prior.promise
    const generation = ++conversationApprovals.readGeneration
    const run = async () => {
      const rows = new Map(), cursors = new Set()
      let before = null
      try {
        do {
          const page = await accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/approvals?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`)
          if (!approvalContextCurrent(context) || conversationApprovals.reads.get(key)?.generation !== generation) return false
          if (!Array.isArray(page?.approvals) || typeof page.hasMore !== 'boolean' ||
              page.hasMore && (!approvalIdPattern.test(page.nextBefore || '') || cursors.has(page.nextBefore) || !page.approvals.length) ||
              !page.hasMore && page.nextBefore !== null) throw { code: 'REQUEST_FAILED' }
          for (const row of page.approvals) if (validApproval(row, context.sessionId)) {
            if (rows.has(row.approvalId)) throw { code: 'REQUEST_FAILED' }
            rows.set(row.approvalId, row)
          }
          before = page.hasMore ? page.nextBefore : null
          if (before) cursors.add(before)
        } while (before)
        for (const [id, entry] of conversationApprovals.entries) if (entry.row.sessionId === context.sessionId && !rows.has(id)) {
          entry.authoritative = false; entry.notice = '这条审批暂时无法核对，请重新核对原对话。'
        }
        for (const [id, row] of rows) {
          const entry = mergeApproval(conversationApprovals.entries.get(id), row)
          conversationApprovals.entries.set(id, entry)
          if (entry.authoritative && row.status !== 'pending') clearApprovalMarker(context, id)
        }
        renderConversationApprovals()
        return true
      } catch (error) {
        if (!approvalContextCurrent(context) || conversationApprovals.reads.get(key)?.generation !== generation) return false
        for (const entry of conversationApprovals.entries.values()) if (entry.row.sessionId === context.sessionId) {
          entry.authoritative = false
          entry.notice = error.code === 'NETWORK' ? '连接中断，审批状态待核对。重连后请重新核对答复。'
            : '审批状态暂时无法读取，请重新核对答复。'
        }
        renderConversationApprovals()
        return false
      }
    }
    const promise = run()
    conversationApprovals.reads.set(key, { generation, promise })
    try { return await promise } finally {
      if (conversationApprovals.reads.get(key)?.promise === promise) conversationApprovals.reads.delete(key)
    }
  }
  function approvalStatusText(row) {
    if (row.status === 'pending') return '等待你决定是否允许这次操作。'
    if (row.status === 'answered') return row.decisionOutcome === 'allowed-once'
      ? '允许本次的决定已登记，正在等待执行端确认。' : '拒绝的决定已登记，正在等待执行端确认。'
    if (row.status === 'unavailable') return row.outcome === 'cancelled'
      ? '本次审批已随停止请求取消；任务停止结果见原对话。' : '本次审批已失效，无法继续答复。请查看原对话。'
    return { 'allowed-once': '执行端已确认允许本次。任务结果请继续查看原对话。',
      rejected: '执行端已确认拒绝。请在原对话查看后续结果。', cancelled: '执行端已确认审批取消。任务进展见原对话。',
      unavailable: '执行端已确认审批失效。请查看原对话。' }[row.outcome]
  }
  function renderConversationApprovals() {
    const context = approvalContext(), list = byId('transcript')
    if (!approvalContextCurrent(context)) return
    const scroll = byId('chat-scroll'), top = scroll.scrollTop
    const reading = [...list.children].find((node) => node.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top)
    const readingTop = reading?.getBoundingClientRect().top
    const visible = new Set()
    for (const entry of conversationApprovals.entries.values()) {
      const row = entry.row
      if (row.sessionId !== context.sessionId || !approvalSource(row)) continue
      const timelineAnchor = [...list.children].find(node => node.dataset?.timelineApproval === row.approvalId)
      const anchor = timelineAnchor || [...list.children].find((node) => node.dataset?.receiptId === row.sourceReceiptId)
      if (!anchor) continue
      visible.add(row.approvalId)
      const marker = approvalMarker(context, row), operation = conversationApprovals.operations.get(row.approvalId)
      const sourceNotice = conversationTasks.entries.get(row.taskId)?.notice || ''
      const signature = JSON.stringify([row, entry.notice, sourceNotice, entry.authoritative, marker, operation?.requestId])
      const scope = JSON.stringify(context)
      let card = [...list.children].find((node) => node.dataset?.conversationApproval === row.approvalId)
      if (timelineAnchor) { timelineAnchor.hidden = true; if (card) { card.dataset.seq = timelineAnchor.dataset.seq; list.insertBefore(card, timelineAnchor) } }
      if (card?.dataset.signature === signature && card.dataset.scope === scope) continue
      const active = document.activeElement, focusAction = card?.dataset.scope === scope && card.contains(active) &&
        !document.querySelector('dialog[open]') ? active.dataset?.conversationApprovalAction : null
      if (!card) {
        card = element('li', 'conversation-task conversation-approval')
        card.dataset.conversationApproval = row.approvalId
        let next = anchor.nextSibling
        while (next?.dataset?.conversationTask || next?.dataset?.conversationApproval && next.dataset.sourceReceiptId === row.sourceReceiptId) next = next.nextSibling
        list.insertBefore(card, next)
      }
      if (timelineAnchor) { card.dataset.seq = timelineAnchor.dataset.seq; list.insertBefore(card, timelineAnchor) }
      card.dataset.sourceReceiptId = row.sourceReceiptId
      card.dataset.signature = signature; card.dataset.scope = scope
      card.replaceChildren()
      card.append(element('strong', 'conversation-task-title', `${executionName(row)} · ${row.status === 'pending' ? '需要你批准' : '审批回执'}`))
      card.classList.toggle('is-resolved', row.status !== 'pending')
      const reason = element('p', 'conversation-approval-reason', row.reason.trim() || '执行端请求你批准这次操作。'); reason.hidden = row.status !== 'pending'; card.append(reason)
      const notice = entry.notice || (sourceNotice ? '原任务暂时无法核对，请重新核对答复。' : '')
      const status = element('p', 'conversation-approval-status', row.status === 'pending' && operation ? '正在提交本次决定…'
        : notice || (row.status === 'pending' && marker ? '上次答复结果尚未确认。已核对仍在等待，可用原答复重试。' : approvalStatusText(row)))
      status.setAttribute('role', 'status'); status.tabIndex = -1; status.dataset.conversationApprovalAction = 'status'
      card.append(status)
      const actions = element('div', 'conversation-task-actions')
      if (row.status === 'pending') for (const outcome of ['allowed-once', 'rejected']) {
        const button = element('button', `button ${outcome === 'allowed-once' ? 'primary' : 'secondary'} small`, outcome === 'allowed-once' ? '允许本次' : '拒绝')
        button.type = 'button'; button.dataset.conversationApprovalAction = outcome
        button.disabled = !!operation || !entry.authoritative || !!notice || !!marker && marker.outcome !== outcome
        button.addEventListener('click', () => { if (approvalContextCurrent(context)) void submitApproval(context, row, outcome) })
        actions.append(button)
      }
      if (notice || marker || row.status === 'answered') {
        const check = element('button', 'button secondary small', '重新核对答复')
        check.type = 'button'; check.dataset.conversationApprovalAction = 'check'; check.disabled = !!operation
        check.addEventListener('click', () => { if (approvalContextCurrent(context)) {
          if (sourceNotice) void refreshConversationTasks()
          else void refreshConversationApprovals(context, true)
        } })
        actions.append(check)
      }
      const detail = element('button', 'button secondary small', '查看来源与成果')
      detail.type = 'button'; detail.dataset.conversationApprovalAction = 'detail'
      detail.addEventListener('click', () => inlineTaskInfo(row.taskId, detail))
      actions.hidden = ['resolved', 'unavailable'].includes(row.status)
      card.classList.toggle('is-resolved', ['resolved', 'unavailable'].includes(row.status))
      actions.append(detail); card.append(actions)
      if (focusAction && !document.querySelector('dialog[open]') &&
          (document.activeElement === active || document.activeElement === document.body)) {
        const replacement = card.querySelector(`[data-conversation-approval-action="${focusAction}"]`)
        ;(replacement && !replacement.disabled ? replacement : status).focus({ preventScroll: true })
      }
    }
    for (const card of [...list.children]) if (card.dataset?.conversationApproval && !visible.has(card.dataset.conversationApproval)) card.remove()
    if (reading?.isConnected && Number.isFinite(readingTop) && Number.isFinite(scroll.scrollTop))
      scroll.scrollTop += reading.getBoundingClientRect().top - readingTop
    else if (Number.isFinite(top)) scroll.scrollTop = top
  }
  async function submitApproval(context, original, outcome) {
    const id = original.approvalId
    if (!approvalContextCurrent(context) || conversationApprovals.operations.has(id)) return
    let entry = conversationApprovals.entries.get(id)
    if (!entry?.authoritative || entry.notice || entry.row.status !== 'pending' || !sameApproval(entry.row, original) || !approvalSource(entry.row, true)) return
    let marker = approvalMarker(context, original)
    if (marker && marker.outcome !== outcome) return
    const operation = marker || { ...approvalIdentity(original), requestId: crypto.randomUUID(), outcome }
    try { saveApprovalMarker(context, operation) } catch {
      entry.notice = '无法保留本次答复，请稍后重试。'; renderConversationApprovals(); return
    }
    conversationApprovals.operations.set(id, operation)
    renderConversationApprovals()
    try {
      if (marker) {
        if (!await refreshConversationApprovals(context, true) || !approvalContextCurrent(context)) return
        entry = conversationApprovals.entries.get(id)
        if (!entry?.authoritative || entry.notice || entry.row.status !== 'pending' || !sameApproval(entry.row, original) || !approvalSource(entry.row, true)) return
      }
      const receipt = await accessApi(`/sessions/${encodeURIComponent(original.sessionId)}/approvals/${encodeURIComponent(id)}`,
        { method: 'POST', protectedWrite: true, body: { requestId: operation.requestId, outcome: operation.outcome } })
      if (!approvalContextCurrent(context) || conversationApprovals.operations.get(id) !== operation) return
      if (receipt?.requestId !== operation.requestId || !validApproval(receipt.approval, original.sessionId) ||
          !sameApproval(receipt.approval, original) || receipt.approval.status !== 'answered' ||
          receipt.approval.decisionRequestId !== operation.requestId || receipt.approval.decisionOutcome !== operation.outcome) throw { code: 'REQUEST_FAILED' }
      conversationApprovals.entries.set(id, mergeApproval(conversationApprovals.entries.get(id), receipt.approval))
      renderConversationApprovals()
      await refreshConversationApprovals(context, true)
    } catch (error) {
      if (!approvalContextCurrent(context) || conversationApprovals.operations.get(id) !== operation) return
      entry = conversationApprovals.entries.get(id)
      if (entry) { entry.authoritative = false; entry.notice = error.status === 409
        ? '审批已变化，正在重新核对答复。' : '答复结果尚未确认，正在读取实际审批状态。' }
      renderConversationApprovals()
      await refreshConversationApprovals(context, true)
    } finally {
      if (conversationApprovals.operations.get(id) === operation) conversationApprovals.operations.delete(id)
      if (approvalContextCurrent(context)) renderConversationApprovals()
    }
  }
  const questionIdentityFields = ['questionRpcId', 'sessionId', 'taskId', 'sourceCommandId', 'sourceReceiptId', 'turn', 'createdAt']
  function resetConversationQuestions() {
    conversationQuestions.scope = null; conversationQuestions.entries.clear(); conversationQuestions.reads.clear()
    conversationQuestions.operations.clear(); conversationQuestions.drafts.clear(); conversationQuestions.readGeneration++
  }
  function questionIdentity(row) { return { ...Object.fromEntries(questionIdentityFields.map((field) => [field, row[field]])), questions: row.questions } }
  function sameQuestion(left, right) {
    return questionIdentityFields.every((field) => left?.[field] === right?.[field]) && JSON.stringify(left?.questions) === JSON.stringify(right?.questions)
  }
  function validQuestionItems(questions) {
    return Array.isArray(questions) && questions.length > 0 && questions.every((question) => question &&
      typeof question.id === 'string' && typeof question.question === 'string' &&
      ['header', 'detail'].every((field) => question[field] === undefined || typeof question[field] === 'string') &&
      (question.multiSelect === undefined || typeof question.multiSelect === 'boolean') &&
      (question.options === undefined || Array.isArray(question.options) && question.options.every((option) => option &&
        typeof option.label === 'string' && (option.description === undefined || typeof option.description === 'string'))) &&
      (question.intent === undefined || question.intent?.kind === 'plan-review' && typeof question.intent.approve === 'string' &&
        typeof question.detail === 'string' && question.options?.some((option) => option.label === question.intent.approve)))
  }
  function validQuestionAnswer(answer, questions) {
    return !!answer && Object.keys(answer).length === 1 && Array.isArray(answer.answers) && answer.answers.length === questions.length &&
      answer.answers.every((item, index) => item && Object.keys(item).every((key) => ['id', 'selected', 'custom'].includes(key)) &&
        item.id === questions[index].id && Array.isArray(item.selected) && item.selected.every((label) => typeof label === 'string' &&
          (questions[index].options || []).some((option) => option.label === label)) && new Set(item.selected).size === item.selected.length &&
        (item.custom === undefined || typeof item.custom === 'string' && !!item.custom.trim()) &&
        (questions[index].multiSelect === true || item.selected.length <= 1 && (item.custom === undefined || item.selected.length === 0)))
  }
  function validQuestion(row, sessionId) {
    const time = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
    if (!row || !questionIdentityFields.every((field) => field === 'turn' || typeof row[field] === 'string') ||
        !approvalIdPattern.test(row.questionRpcId) || row.sessionId !== sessionId || !sessionIdPattern.test(row.taskId) ||
        !sessionIdPattern.test(row.sourceCommandId) || !receiptIdPattern.test(row.sourceReceiptId) ||
        !Number.isSafeInteger(row.turn) || row.turn < 1 || !time(row.createdAt) || !validQuestionItems(row.questions) ||
        !['pending', 'answered', 'resolved', 'unavailable'].includes(row.status)) return false
    const hasAnswer = [row.answer, row.answerRequestId, row.answeredAt].some((value) => value !== undefined)
    if (hasAnswer && (!approvalRequestPattern.test(row.answerRequestId || '') || !time(row.answeredAt) ||
        !validQuestionAnswer(row.answer, row.questions))) return false
    if (row.answerAcceptedAt !== undefined && (!hasAnswer || !time(row.answerAcceptedAt))) return false
    if (row.status === 'pending') return !hasAnswer && row.answerAcceptedAt === undefined && row.outcome === undefined && row.resolvedAt === undefined
    if (row.status === 'answered') return hasAnswer && row.outcome === undefined && row.resolvedAt === undefined
    if (row.status === 'unavailable') return typeof row.reasonCode === 'string' && time(row.unavailableAt)
    return ['answered', 'cancelled'].includes(row.outcome) && time(row.resolvedAt)
  }
  function questionMarkerKey(context) { return `weftmate:question-answers:v1:${context.ownerId}:${context.deviceId}` }
  function questionMarkers(context) {
    try {
      const rows = JSON.parse(localStorage.getItem(questionMarkerKey(context)) || '[]')
      return Array.isArray(rows) ? rows.filter((row) => row && approvalIdPattern.test(row.questionRpcId || '') &&
        approvalRequestPattern.test(row.requestId || '') && validQuestionItems(row.questions) && validQuestionAnswer(row.answer, row.questions)) : []
    } catch { return [] }
  }
  function questionMarker(context, row) { return questionMarkers(context).find((marker) => marker.questionRpcId === row.questionRpcId) }
  function saveQuestionMarker(context, marker) {
    localStorage.setItem(questionMarkerKey(context), JSON.stringify([...questionMarkers(context)
      .filter((row) => row.questionRpcId !== marker.questionRpcId), marker]))
  }
  function clearQuestionMarker(context, id) {
    try { localStorage.setItem(questionMarkerKey(context), JSON.stringify(questionMarkers(context).filter((row) => row.questionRpcId !== id))) } catch { /* GET remains authoritative. */ }
  }
  function questionDraft(context, row) {
    const key = JSON.stringify([context.ownerId, context.deviceId, row.questionRpcId])
    let draft = conversationQuestions.drafts.get(key)
    if (!draft || !sameQuestion(draft, row)) {
      const marker = questionMarker(context, row), answer = marker && sameQuestion(marker, row) ? marker.answer : row.answer
      draft = { ...questionIdentity(row), answers: row.questions.map((question, index) => ({ id: question.id,
        selected: [...(answer?.answers[index]?.selected || [])], custom: answer?.answers[index]?.custom || '' })) }
      conversationQuestions.drafts.set(key, draft)
    }
    return draft
  }
  function mergeQuestion(entry, row) {
    if (entry && !sameQuestion(entry.row, row)) return { ...entry, authoritative: false, notice: '问题来源已变化，请重新核对原对话。' }
    const rank = { pending: 0, answered: 1, resolved: 2, unavailable: 2 }
    let next = entry && rank[entry.row.status] > rank[row.status] ? entry.row : row
    if (entry?.row.answerAcceptedAt && !next.answerAcceptedAt && next.answerRequestId === entry.row.answerRequestId &&
        JSON.stringify(next.answer) === JSON.stringify(entry.row.answer)) next = { ...next, answerAcceptedAt: entry.row.answerAcceptedAt }
    return { ...entry, row: next, authoritative: true, notice: '', validation: '' }
  }
  async function refreshConversationQuestions(context = approvalContext(), force = false) {
    if (!approvalContextCurrent(context) || !sessionIdPattern.test(context.sessionId || '')) return false
    const scope = JSON.stringify([context.ownerId, context.identity, context.deviceId])
    if (conversationQuestions.scope !== scope) { resetConversationQuestions(); conversationQuestions.scope = scope }
    const key = JSON.stringify(context), prior = conversationQuestions.reads.get(key)
    if (!force && prior) return prior.promise
    const generation = ++conversationQuestions.readGeneration
    const run = async () => {
      const rows = new Map(), cursors = new Set()
      let before = null
      try {
        do {
          const page = await accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/questions?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`)
          if (!approvalContextCurrent(context) || conversationQuestions.reads.get(key)?.generation !== generation) return false
          if (!Array.isArray(page?.questions) || typeof page.hasMore !== 'boolean' ||
              page.hasMore && (!approvalIdPattern.test(page.nextBefore || '') || cursors.has(page.nextBefore) || !page.questions.length) ||
              !page.hasMore && page.nextBefore !== null) throw { code: 'REQUEST_FAILED' }
          for (const row of page.questions) if (validQuestion(row, context.sessionId)) {
            if (rows.has(row.questionRpcId)) throw { code: 'REQUEST_FAILED' }
            rows.set(row.questionRpcId, row)
          }
          before = page.hasMore ? page.nextBefore : null
          if (before) cursors.add(before)
        } while (before)
        for (const [id, entry] of conversationQuestions.entries) if (entry.row.sessionId === context.sessionId && !rows.has(id)) {
          entry.authoritative = false; entry.notice = '这批问题暂时无法核对，已填写内容保留。请重新核对。'
        }
        for (const [id, row] of rows) {
          const entry = mergeQuestion(conversationQuestions.entries.get(id), row)
          conversationQuestions.entries.set(id, entry)
          if (entry.authoritative && row.status !== 'pending') clearQuestionMarker(context, id)
        }
        renderConversationQuestions(); return true
      } catch (error) {
        if (!approvalContextCurrent(context) || conversationQuestions.reads.get(key)?.generation !== generation) return false
        for (const entry of conversationQuestions.entries.values()) if (entry.row.sessionId === context.sessionId) {
          entry.authoritative = false; entry.notice = '信息问题暂时无法核对，已填写内容保留。连接恢复后请重新核对。'
        }
        renderConversationQuestions(); return false
      }
    }
    const promise = run(); conversationQuestions.reads.set(key, { generation, promise })
    try { return await promise } finally { if (conversationQuestions.reads.get(key)?.promise === promise) conversationQuestions.reads.delete(key) }
  }
  function questionStatusText(row) {
    if (row.status === 'unavailable') return row.answerAcceptedAt
      ? '执行端曾确认接收本入口回答，但本次信息问题现已失效。任务进展请查看原对话。'
      : '本次信息问题已失效，不能再提交。任务进展请查看原对话。'
    if (row.status === 'resolved' && row.outcome === 'cancelled') return row.answerAcceptedAt
      ? '执行端曾确认接收本入口回答，随后确认本次信息问题取消。任务进展见原对话。'
      : '执行端已确认本次信息问题取消。任务进展见原对话。'
    if (row.answerAcceptedAt) return '执行端已确认接收本入口提交的回答。任务结果请继续查看原对话。'
    if (row.status === 'pending') return '请补充这次任务需要的信息。'
    if (row.status === 'answered') return '回答已登记，正在等待执行端确认接收。'
    return '原生问答已结束，尚未确认采用本入口回答。任务结果见原对话。'
  }
  function renderConversationQuestions() {
    const context = approvalContext(), list = byId('transcript')
    if (!approvalContextCurrent(context)) return
    const scroll = byId('chat-scroll'), top = scroll.scrollTop
    const reading = [...list.children].find((node) => node.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top)
    const readingTop = reading?.getBoundingClientRect().top, visible = new Set()
    for (const entry of conversationQuestions.entries.values()) {
      const row = entry.row
      if (row.sessionId !== context.sessionId || !approvalSource(row)) continue
      const questionEvent = [...(state.activeChatSource === 'phone' ? state.phoneHostEvents.get(context.conversationId) || [] : state.historyEvents.values())]
        .filter(e => e.type === 'question.asked' && e.data?.turn === row.turn && Number.isSafeInteger(row.observedSeq) && e.seq <= row.observedSeq).sort((a,b) => b.seq-a.seq)[0]
      const timelineAnchor = questionEvent && [...list.children].find(node => node.dataset?.timelineQuestion === questionEvent.data.callId)
      const anchor = timelineAnchor || [...list.children].find((node) => node.dataset?.receiptId === row.sourceReceiptId)
      if (!anchor) continue
      visible.add(row.questionRpcId)
      const marker = questionMarker(context, row), operation = conversationQuestions.operations.get(row.questionRpcId)
      const sourceNotice = conversationTasks.entries.get(row.taskId)?.notice || ''
      const notice = entry.notice || (sourceNotice ? '原任务暂时无法核对，已填写内容保留。请重新核对。' : '') ||
        (marker && !sameQuestion(marker, row) ? '问题内容已变化，无法重发原回答。请重新核对原对话。' : '')
      const signature = JSON.stringify([row, notice, entry.authoritative, entry.validation, marker, operation?.requestId])
      const scope = JSON.stringify(context)
      let card = [...list.children].find((node) => node.dataset?.conversationQuestion === row.questionRpcId)
      if (timelineAnchor) { timelineAnchor.hidden = true; if (card) { card.dataset.seq = timelineAnchor.dataset.seq; list.insertBefore(card, timelineAnchor) } }
      if (card?.dataset.signature === signature && card.dataset.scope === scope) continue
      const active = document.activeElement, focusAction = card?.dataset.scope === scope && card.contains(active) &&
        !document.querySelector('dialog[open]') ? active.dataset?.conversationQuestionAction : null
      const selection = focusAction?.startsWith('custom-') ? [active.selectionStart, active.selectionEnd] : null
      if (!card) {
        card = element('li', 'conversation-task conversation-question'); card.dataset.conversationQuestion = row.questionRpcId
        let next = anchor.nextSibling
        while (next?.dataset?.conversationTask || (next?.dataset?.conversationApproval || next?.dataset?.conversationQuestion) &&
          next.dataset.sourceReceiptId === row.sourceReceiptId) next = next.nextSibling
        list.insertBefore(card, next)
      }
      if (timelineAnchor) { card.dataset.seq = timelineAnchor.dataset.seq; list.insertBefore(card, timelineAnchor) }
      card.dataset.sourceReceiptId = row.sourceReceiptId; card.dataset.signature = signature; card.dataset.scope = scope
      card.replaceChildren(); card.append(element('strong', 'conversation-task-title', row.status === 'pending' ? '需要补充信息' : '信息回答回执'))
      const status = element('p', 'conversation-question-status', row.status === 'pending' && operation ? '正在提交本次回答…'
        : notice || entry.validation || (row.status === 'pending' && marker ? '上次回答结果尚未确认。已核对仍在等待，可重试原回答。' : questionStatusText(row)))
      status.setAttribute('role', 'status'); status.tabIndex = -1; status.dataset.conversationQuestionAction = 'status'; card.append(status)
      const draft = questionDraft(context, row), answer = row.status === 'pending' ? draft : row.answer
      const locked = row.status !== 'pending' || !!operation || !!marker || !entry.authoritative || !!notice
      const form = element('form', 'conversation-question-form')
      row.questions.forEach((question, index) => {
        const item = element('fieldset', 'question-item'), controls = [], customLabel = element('label', 'question-custom')
        item.append(element('legend', '', question.header || question.question || '补充信息'))
        if (question.header && question.question) item.append(element('p', 'question-text', question.question))
        if (question.detail) item.append(element('p', 'question-detail', question.detail))
        for (const [optionIndex, option] of (question.options || []).entries()) {
          const label = element('label', 'question-option'), input = element('input')
          input.type = question.multiSelect === true ? 'checkbox' : 'radio'; input.name = `question-${row.questionRpcId}-${index}`
          input.checked = !!answer?.answers[index]?.selected?.includes(option.label); input.disabled = locked
          input.dataset.conversationQuestionAction = `option-${index}-${optionIndex}`
          const text = element('span', 'question-option-text', option.label || '空白选项')
          if (option.description) text.append(element('small', '', option.description))
          input.addEventListener('change', () => {
            if (!approvalContextCurrent(context) || locked || conversationQuestions.operations.has(row.questionRpcId) || questionMarker(context, row)) return
            const selected = new Set(draft.answers[index].selected)
            if (question.multiSelect === true) { if (input.checked) selected.add(option.label); else selected.delete(option.label) }
            else { selected.clear(); if (input.checked) selected.add(option.label); draft.answers[index].custom = ''; custom.value = '' }
            draft.answers[index].selected = (question.options || []).map((option) => option.label).filter((label, i, labels) => selected.has(label) && labels.indexOf(label) === i)
            for (const control of controls) control.input.checked = selected.has(control.label)
          })
          controls.push({ input, label: option.label }); label.append(input, text); item.append(label)
        }
        customLabel.append(element('span', '', question.options?.length ? question.multiSelect === true ? '补充说明（可选）' : '填写其他回答' : '你的回答'))
        const custom = element('textarea'); custom.rows = 3; custom.value = answer?.answers[index]?.custom || ''; custom.disabled = locked
        custom.dataset.conversationQuestionAction = `custom-${index}`
        custom.addEventListener('input', () => {
          if (!approvalContextCurrent(context) || locked || conversationQuestions.operations.has(row.questionRpcId) || questionMarker(context, row)) return
          draft.answers[index].custom = custom.value
          if (question.multiSelect !== true && custom.value.trim()) {
            draft.answers[index].selected = []; for (const control of controls) control.input.checked = false
          }
        })
        customLabel.append(custom); item.append(customLabel); form.append(item)
      })
      const actions = element('div', 'conversation-task-actions')
      if (row.status === 'pending') {
        const submit = element('button', 'button small', marker ? '重试原回答' : '提交回答')
        submit.type = 'submit'; submit.dataset.conversationQuestionAction = 'submit'
        submit.disabled = !!operation || !entry.authoritative || !!notice
        actions.append(submit)
      }
      if (notice || marker || row.status === 'answered') {
        const check = element('button', 'button secondary small', '重新核对回答'); check.type = 'button'; check.disabled = !!operation
        check.dataset.conversationQuestionAction = 'check'
        check.addEventListener('click', () => { if (approvalContextCurrent(context)) {
          if (sourceNotice) void refreshConversationTasks(); else void refreshConversationQuestions(context, true)
        } }); actions.append(check)
      }
      const detail = element('button', 'button secondary small', '查看来源与成果'); detail.type = 'button'
      detail.dataset.conversationQuestionAction = 'detail'
      detail.addEventListener('click', () => inlineTaskInfo(row.taskId, detail)); actions.append(detail); form.append(actions); form.hidden = ['resolved', 'unavailable'].includes(row.status); card.classList.toggle('is-resolved', form.hidden); card.append(form)
      form.addEventListener('submit', (event) => { event.preventDefault(); if (approvalContextCurrent(context)) void submitQuestion(context, row) })
      if (focusAction && !document.querySelector('dialog[open]') && (document.activeElement === active || document.activeElement === document.body)) {
        const replacement = card.querySelector(`[data-conversation-question-action="${focusAction}"]`)
        const target = replacement && !replacement.disabled ? replacement : status; target.focus({ preventScroll: true })
        if (target === replacement && selection && Number.isInteger(selection[0])) replacement.setSelectionRange?.(...selection)
      }
    }
    for (const card of [...list.children]) if (card.dataset?.conversationQuestion && !visible.has(card.dataset.conversationQuestion)) card.remove()
    if (reading?.isConnected && Number.isFinite(readingTop) && Number.isFinite(scroll.scrollTop)) scroll.scrollTop += reading.getBoundingClientRect().top - readingTop
    else if (Number.isFinite(top)) scroll.scrollTop = top
  }
  async function submitQuestion(context, original) {
    const id = original.questionRpcId
    if (!approvalContextCurrent(context) || conversationQuestions.operations.has(id)) return
    let entry = conversationQuestions.entries.get(id)
    if (!entry?.authoritative || entry.notice || entry.row.status !== 'pending' || !sameQuestion(entry.row, original) || !approvalSource(entry.row, true)) return
    const marker = questionMarker(context, original), draft = questionDraft(context, original)
    if (marker && !sameQuestion(marker, original)) return
    const answer = marker?.answer || { answers: draft.answers.map((item) => ({ id: item.id, selected: [...item.selected], ...(item.custom.trim() ? { custom: item.custom } : {}) })) }
    if (!validQuestionAnswer(answer, original.questions)) { entry.validation = '请核对每题的选择与填写内容，再提交回答。'; renderConversationQuestions(); return }
    const operation = marker || { ...questionIdentity(original), requestId: crypto.randomUUID(), answer }
    try { saveQuestionMarker(context, operation) } catch { entry.notice = '无法保留本次回答，请稍后重试。'; renderConversationQuestions(); return }
    conversationQuestions.operations.set(id, operation); renderConversationQuestions()
    try {
      if (marker) {
        if (!await refreshConversationQuestions(context, true) || !approvalContextCurrent(context)) return
        entry = conversationQuestions.entries.get(id)
        if (!entry?.authoritative || entry.notice || entry.row.status !== 'pending' || !sameQuestion(entry.row, original) || !approvalSource(entry.row, true)) return
      }
      const receipt = await accessApi(`/sessions/${encodeURIComponent(original.sessionId)}/questions/${encodeURIComponent(id)}`,
        { method: 'POST', protectedWrite: true, body: { requestId: operation.requestId, answer: operation.answer } })
      if (!approvalContextCurrent(context) || conversationQuestions.operations.get(id) !== operation) return
      if (receipt?.requestId !== operation.requestId || !validQuestion(receipt.question, original.sessionId) || !sameQuestion(receipt.question, original) ||
          receipt.question.status !== 'answered' || receipt.question.answerRequestId !== operation.requestId ||
          JSON.stringify(receipt.question.answer) !== JSON.stringify(operation.answer)) throw { code: 'REQUEST_FAILED' }
      conversationQuestions.entries.set(id, mergeQuestion(conversationQuestions.entries.get(id), receipt.question)); renderConversationQuestions()
      await refreshConversationQuestions(context, true)
    } catch (error) {
      if (!approvalContextCurrent(context) || conversationQuestions.operations.get(id) !== operation) return
      entry = conversationQuestions.entries.get(id)
      if (entry) { entry.authoritative = false; entry.notice = '回答结果尚未确认，正在读取实际问题状态。' }
      renderConversationQuestions(); await refreshConversationQuestions(context, true)
    } finally {
      if (conversationQuestions.operations.get(id) === operation) conversationQuestions.operations.delete(id)
      if (approvalContextCurrent(context)) renderConversationQuestions()
    }
  }
  function renderDesktopActionReview() {
    const list = byId('transcript')
    for (const node of [...list.children]) if (node.dataset?.commandReview) node.remove()
    const command = desktopBlocker()
    if (!command || state.activeChatSource !== 'desktop') return
    const row = element('li', 'conversation-task'); row.dataset.commandReview = command.commandId
    row.append(element('p', '', commandStatus(command)))
    if (command.kind === 'desktop.open_app' && ['accepted_by_host', 'uncertain'].includes(command.state)) {
      const acknowledge = element('button', 'button quiet small', '已在电脑核对，允许再次发起'); acknowledge.type = 'button'
      acknowledge.addEventListener('click', () => acknowledgeDesktop(command)); row.append(acknowledge)
    }
    list.append(row)
  }
  function renderConversationTasks() {
    renderDesktopActionReview()
    const context = conversationTaskContext(), list = byId('transcript')
    if (!context.sessionId || conversationTasks.ownerId !== context.ownerId || conversationTasks.identity !== context.identity) return
    for (const entry of conversationTasks.entries.values()) {
      if (entry.sessionId !== context.sessionId || entry.conversationId && entry.conversationId !== context.conversationId) continue
      const payload = entry.payload, steps = payload ? relatedExecutionSteps(payload) : []
      const artifacts = (Array.isArray(payload?.artifacts) ? payload.artifacts : []).filter((row) =>
        row?.taskId === entry.taskId && row.sessionId === context.sessionId && sessionIdPattern.test(row.artifactId || ''))
      const control = payload?.control
      const outputLimited = payload?.replyEvidence?.status === 'failed' && payload.replyEvidence.endReasonKind === 'max-tokens'
      const turn = payload?.source?.dshTurn ?? payload?.replyEvidence?.turn
      const hasTimeline = Number.isSafeInteger(turn) && timelineEventsForContext(context).some(e => e.type.startsWith('step.') && e.data?.taskId === `turn-${turn}`)
      const visible = entry.notice || !hasTimeline && steps.length || artifacts.length || payload?.sources?.length || control?.canStop || control && control.state !== 'active' || outputLimited
      let card = [...list.children].find((row) => row.dataset?.conversationTask === entry.taskId)
      if (!visible) { card?.remove(); continue }
      const receiptId = payload?.source?.receiptId || entry.receiptId
      const anchor = [...list.children].find((row) => row.dataset?.receiptId === receiptId)
      if (!anchor && !entry.notice) continue
      if (card && anchor && anchor.nextSibling !== card) list.insertBefore(card, anchor.nextSibling)
      const signature = JSON.stringify([payload, entry.notice])
      const scope = JSON.stringify([context.ownerId, context.identity, context.source, context.sessionId,
        context.conversationId, entry.taskId])
      if (card?.dataset.signature === signature && card.dataset.scope === scope) continue
      const active = document.activeElement
      const focusAction = card?.dataset.scope === scope && conversationTaskCurrent(context) &&
        card.contains(active) && !document.querySelector('dialog[open]')
        ? active.dataset?.conversationTaskAction : null
      if (!card) {
        card = element('li', 'conversation-task')
        card.dataset.conversationTask = entry.taskId
        if (anchor) list.insertBefore(card, anchor.nextSibling)
        else list.append(card)
      }
      const expanded = card.querySelector?.('details')?.open === true
      card.dataset.signature = signature
      card.dataset.scope = scope
      card.classList.toggle('has-timeline', hasTimeline && !entry.notice && !outputLimited && control?.state === 'active')
      card.replaceChildren()
      card.append(element('strong', 'conversation-task-title', entry.notice ? '工具进展 · 待更新'
        : outputLimited && !steps.length && !artifacts.length ? '回复状态' : '工具进展'))
      if (entry.notice) card.append(element('p', 'conversation-task-notice', entry.notice))
      if (steps.length && !hasTimeline) {
        const latest = steps.slice(-3), records = element('ul', 'conversation-task-steps')
        for (const step of latest) records.append(element('li', '', `${entry.notice ? '上次记录：' : ''}${executionName(step)} · ${executionProgress(step)}`))
        card.append(records)
        if (steps.length > 3) {
          const details = element('details', 'conversation-task-more')
          details.open = expanded
          const summary = element('summary', '', `查看全部 ${steps.length} 条执行记录`)
          summary.dataset.conversationTaskAction = 'more'
          details.append(summary)
          for (const step of steps) details.append(element('p', '', `${executionName(step)} · ${executionProgress(step)}`))
          card.append(details)
        }
      }
      if (!entry.notice && control && control.state !== 'active') card.append(element('p', 'conversation-task-state', taskControlStatus(control)))
      if (!entry.notice && payload?.replyEvidence) card.append(element('p', 'conversation-task-reply', taskReplyText(payload.replyEvidence)))
      const verified = artifacts.filter((row) => row.state === 'observed' && row.verification?.status === 'observed' &&
        row.verification?.method === 'sha256_readback')
      for (const artifact of artifacts) appendTimelineArtifact(card, artifact, context)
      if (artifacts.length) card.append(element('p', 'conversation-task-result', verified.length
        ? `${verified.length} 个成果文件已读回核验` : '成果文件仍待核验'))
      const actions = element('div', 'conversation-task-actions')
      const detail = element('button', 'button secondary small', verified.length ? '查看来源与成果' : '查看来源与成果')
      detail.type = 'button'
      detail.dataset.conversationTaskAction = 'detail'
      detail.addEventListener('click', () => inlineTaskInfo(entry.taskId, detail))
      actions.append(detail)
      if (entry.notice) {
        const retry = element('button', 'button secondary small', '重新核对进展')
        retry.type = 'button'
        retry.dataset.conversationTaskAction = 'retry'
        retry.addEventListener('click', () => { if (conversationTaskCurrent(context)) void refreshConversationTasks() })
        actions.append(retry)
      }
      card.append(actions)
      if (['detail', 'retry', 'more'].includes(focusAction) && conversationTaskCurrent(context) &&
          card.dataset.scope === scope && !document.querySelector('dialog[open]') &&
          (document.activeElement === active || document.activeElement === document.body)) {
        const replacement = card.querySelector(`[data-conversation-task-action="${focusAction}"]`)
        if (replacement?.isConnected && !replacement.disabled && !replacement.hidden) replacement.focus({ preventScroll: true })
      }
    }
    renderConversationApprovals()
    renderConversationQuestions()
  }
  async function refreshConversationTasks() {
    const context = conversationTaskContext()
    if (!conversationTaskCurrent(context) || !sessionIdPattern.test(context.sessionId || '')) return
    if (conversationTasks.ownerId !== context.ownerId || conversationTasks.identity !== context.identity) {
      conversationTasks.entries.clear()
      conversationTasks.ownerId = context.ownerId
      conversationTasks.identity = context.identity
    }
    const key = JSON.stringify(context)
    if (conversationTasks.inFlight?.key === key) return conversationTasks.inFlight.promise
    const roots = state.tasks.filter((row) => row?.kind === 'session.message' && !row.rootTaskId &&
      row.sessionId === context.sessionId && sessionIdPattern.test(row.commandId || '') &&
      (!row.conversationId || row.conversationId === context.conversationId)).slice(0, 8)
    const run = async () => {
      await refreshConversationApprovals({ ...context, deviceId: state.device?.id })
      await refreshConversationQuestions({ ...context, deviceId: state.device?.id })
      if (!conversationTaskCurrent(context)) return
      const receipts = new Set([...byId('transcript').children].map((row) => row.dataset?.receiptId).filter(Boolean))
      for (const entry of conversationApprovals.entries.values()) if (entry.row.sessionId === context.sessionId &&
          (receipts.has(entry.row.sourceReceiptId) || timelineEventsForContext(context).some(e => entry.row.approvalId && e.data?.approvalId === entry.row.approvalId || entry.row.callId && e.data?.callId === entry.row.callId || e.type === 'question.asked' && e.data?.turn === entry.row.turn)) && !roots.some((row) => row.commandId === entry.row.taskId)) {
        roots.push({ commandId: entry.row.taskId, sessionId: context.sessionId,
          ...(context.conversationId ? { conversationId: context.conversationId } : {}) })
      }
      for (const entry of conversationQuestions.entries.values()) if (entry.row.sessionId === context.sessionId &&
          (receipts.has(entry.row.sourceReceiptId) || timelineEventsForContext(context).some(e => entry.row.approvalId && e.data?.approvalId === entry.row.approvalId || entry.row.callId && e.data?.callId === entry.row.callId || e.type === 'question.asked' && e.data?.turn === entry.row.turn)) && !roots.some((row) => row.commandId === entry.row.taskId)) {
        roots.push({ commandId: entry.row.taskId, sessionId: context.sessionId,
          ...(context.conversationId ? { conversationId: context.conversationId } : {}) })
      }
      let next = 0
      const worker = async () => {
        while (conversationTaskCurrent(context) && next < roots.length) {
          const command = roots[next++], taskId = command.commandId
          const previous = conversationTasks.entries.get(taskId)
          const entry = { ...previous, taskId, sessionId: context.sessionId, conversationId: command.conversationId,
            receiptId: command.receiptId, notice: '' }
          try {
            const payload = await accessApi(`/tasks/${encodeURIComponent(taskId)}`)
            if (!conversationTaskCurrent(context)) return
            if (payload?.taskId !== taskId || payload.sessionId !== context.sessionId ||
                payload.source?.commandId !== taskId || payload.source.kind !== 'session.message' || payload.source.rootTaskId ||
                payload.source.sessionId !== context.sessionId || !Array.isArray(payload.artifacts) ||
                command.receiptId && payload.source.receiptId !== command.receiptId ||
                payload.conversationId && payload.conversationId !== context.conversationId) throw { code: 'REQUEST_FAILED' }
            entry.payload = payload
          } catch (error) {
            if (!conversationTaskCurrent(context) || error.code === 'UNAUTHORIZED') return
            entry.notice = error.code === 'NETWORK' ? '连接中断，执行进展待更新。重连后可重新核对。'
              : '执行进展暂时无法读取，已有记录待更新。请重新核对。'
          }
          conversationTasks.entries.set(taskId, entry)
          renderConversationTasks()
        }
      }
      await Promise.all([worker(), worker()])
    }
    const promise = run()
    conversationTasks.inFlight = { key, promise }
    try { await promise } finally { if (conversationTasks.inFlight?.promise === promise) conversationTasks.inFlight = null }
  }
  function taskControlStatus(control) {
    if (control?.state === 'stop_requested' && typeof control.stopStatus === 'string') {
      if (control.stopStatus === 'stopped') return '电脑已核对这件事的实际停止。已执行的步骤与成果会保留。'
      if (control.stopStatus === 'completed') return '这件事的回合已正常结束；停止请求没有已证实的中断结果。核对成果后可写明下一步。'
      if (control.stopStatus === 'cancel_requested') return '电脑已对准这件事发起取消，正在等待实际结束记录。'
      if (control.legacyStopIntent && !control.canResume) return '旧停止记录缺少完整目标快照，结果仍待核对。请查看原会话与成果，稍后重新核对。'
      if (control.stopStatus === 'requested') return '停止请求已记录，正在核对电脑回合；目前还不能确认已停止。'
      return '停止结果仍不明确。请核对原会话与成果，稍后重新核对；不要重复执行。'
    }
    switch (control?.state) {
      case 'active': return '任务可继续处理；文件是否完成仍以读回核验为准。'
      case 'stop_requested': return control.reasonCode === 'TURN_ENDED_AFTER_STOP_REQUEST' && control.canResume === true
        ? '上一回合已结束，但尚不能确认是停止请求使它结束。请写明下一步，再恢复这件事。'
        : '停止意图已记录，仍在等待执行端状态核对；请勿把它当作已经停止。'
      case 'stopped': return control.stoppedAt ? `执行端停止已核对：${formatDate(control.stoppedAt)}` : '执行端停止已核对。'
      case 'uncertain': return '任务结果尚不明确。请先核对电脑会话和成果，再决定是否恢复。'
      default: return '任务控制状态待核对。'
    }
  }
  function taskControlError(error) {
    if (error.code === 'TASK_NOT_READY' || error.status === 409) return '任务状态已变化或结果仍待核对，请重新核对后再操作。'
    if (error.code === 'NETWORK') return '连接中断，操作结果待核对；请重新打开任务查看记录。'
    if (error.status === 403 || error.status === 404) return '当前账户或设备无法操作这件事。'
    return '操作尚未确认，请重新核对任务记录。'
  }
  function inlineTaskInfo(taskId, button) {
    const context = conversationTaskContext(), entry = conversationTasks.entries.get(taskId)
    if (!conversationTaskCurrent(context) || !entry?.payload) return
    const card = button.closest('[data-conversation-task], [data-conversation-approval], [data-conversation-question]') || button.parentNode
    const existing = card.querySelector('.timeline-task-info')
    if (existing) { existing.remove(); return }
    const payload = entry.payload, info = element('section', 'timeline-task-info')
    info.append(element('p', '', payload.sourceText || payload.source?.taskLabel || ''))
    for (const source of payload.sources || []) {
      const read = element('button', 'button quiet small', `查看来源 ${source.relativePath || source.fileName || source.title || source.snapshotId}`)
      read.type = 'button'; read.addEventListener('click', () => { void openTimelinePreview(context,
        `/tasks/${encodeURIComponent(taskId)}/sources/${encodeURIComponent(source.snapshotId)}`, source.fileName || source.title || '读取的来源') })
      info.append(read)
    }
    for (const artifact of payload.artifacts || []) appendTimelineArtifact(info, artifact, context)
    if (payload.control?.canStop) {
      const stop = element('button', 'button secondary small', '请求停止这件事'); stop.type = 'button'
      stop.addEventListener('click', async () => {
        if (!conversationTaskCurrent(context) || stop.disabled) return
        stop.disabled = true; entry.stopRequestId ||= crypto.randomUUID()
        try { await accessApi(`/tasks/${encodeURIComponent(taskId)}/stop`, { method: 'POST', body: JSON.stringify({ requestId: entry.stopRequestId }) })
          if (conversationTaskCurrent(context)) { stop.textContent = '停止请求已记录'; void refreshConversationTasks() }
        } catch { if (conversationTaskCurrent(context)) { stop.textContent = '重试停止请求'; stop.disabled = false } }
      }); info.append(stop)
    }
    card.append(info)
  }
  function appendTimelineArtifact(parent, artifact, context = conversationTaskContext()) {
    const line = element('div', 'timeline-artifact'), open = element('button', 'button secondary small', artifact.fileName || '打开成果')
    open.type = 'button'; open.addEventListener('click', () => { void openTimelinePreview(context,
      `/artifacts/${encodeURIComponent(artifact.artifactId)}/preview`, artifact.fileName || '成果文件') })
    const download = element('a', 'button quiet small', '下载'); download.href = `${accessBase}/artifacts/${encodeURIComponent(artifact.artifactId)}/download`; download.download = artifact.fileName || '成果文件'
    line.append(open, element('small', '', window.WeftDesktop?.fileLabel(artifact) || `文件 · ${artifact.size || 0} 字节`), download); parent.append(line)
  }
  async function openTimelinePreview(context, path, title) {
    if (!conversationTaskCurrent(context)) return
    if (window.WeftDesktop) {
      const preview = window.WeftDesktop.openPreview(title)
      try { const data = await accessApi(path)
        if (!conversationTaskCurrent(context) || !preview.panel.isConnected) return
        const text = data.text || data.preview?.text || data.source?.text || '暂时没有可预览内容'
        preview.content.replaceChildren(window.WeftDesktop.markdown(text))
      } catch { if (preview.panel.isConnected) preview.content.textContent = '暂时无法读取。关闭后重试。' }
      return
    }
    document.querySelector('.timeline-preview')?.remove()
    const panel = element('aside', 'timeline-preview'), close = element('button', 'button quiet small', '关闭预览'), text = element('pre', 'timeline-raw', '正在读取…')
    close.type = 'button'; close.addEventListener('click', () => panel.remove())
    panel.append(close, element('h2', '', title), text); byId('conversation-pane').append(panel)
    try { const data = await accessApi(path)
      if (!conversationTaskCurrent(context) || !panel.isConnected) { panel.remove(); return }
      text.textContent = data.text || data.preview?.text || data.source?.text || '暂时没有可预览内容'
    } catch { if (panel.isConnected) text.textContent = '暂时无法读取，请关闭后重试。' }
  }
  function timelineEventsForContext(context = conversationTaskContext()) { return context.source === 'phone' ? state.phoneHostEvents.get(context.conversationId) || [] : [...state.historyEvents.values()] }
  function renderTimeline(events = timelineEventsForContext()) {
    if (!window.WeftTimeline) return
    const context = conversationTaskContext(), sessionId = context.sessionId
    window.WeftTimeline.render(events, byId('transcript'), {
      fileLabel: window.WeftDesktop?.fileLabel,
      mobile: window.matchMedia?.('(max-width: 640px)').matches === true,
      readDetail: seq => accessApi(`/sessions/${encodeURIComponent(sessionId)}/events/${seq}/detail`),
      openArtifact: artifact => openTimelinePreview(context, `/artifacts/${encodeURIComponent(artifact.artifactId)}/preview`, artifact.fileName || '成果文件'),
      downloadArtifact: artifact => { const link = element('a'); link.href = `${accessBase}/artifacts/${encodeURIComponent(artifact.artifactId)}/download`; link.download = artifact.fileName || '成果文件'; link.click() },
    })
  }
  async function refreshTasks(append = false) {
    const identity = state.identityGeneration
    const ownerId = state.ownerId
    try {
      const before = append && state.nextBefore ? `&before=${encodeURIComponent(state.nextBefore)}` : ''
      const payload = await accessApi(`/commands?limit=50${before}`)
      if (identity !== state.identityGeneration || ownerId !== state.ownerId) return
      if (!Array.isArray(payload.commands)) throw { code: 'REQUEST_FAILED' }
      state.tasks = append ? [...state.tasks, ...payload.commands.filter((item) =>
        !state.tasks.some((previous) => previous.commandId === item.commandId))] : payload.commands
      state.nextBefore = typeof payload.nextBefore === 'string' ? payload.nextBefore : null
      renderConversationTasks()
      for (const marker of readMarkers()) {
        const found = state.tasks.find((item) => item.requestId === marker.requestId)
        if (found) updateFromCommand(found)
      }
      updateAvailability()
      await conversationTasks.inFlight?.promise
      if (identity === state.identityGeneration && ownerId === state.ownerId) void refreshConversationTasks()
    } catch (error) {
      if (identity !== state.identityGeneration || ownerId !== state.ownerId) return
      if (error.code === 'UNAUTHORIZED') return
      byId('timeline-status').textContent = error.code === 'NETWORK'
        ? '连接中断，重连后会查询原有事情记录。' : '事情记录暂时无法读取，请点击刷新。'
    }
  }
  function updateFromCommand(command) {
    finishAttachmentCommand(command)
    if (!command || typeof command.requestId !== 'string') return
    const marker = readMarkers().find((item) => item.requestId === command.requestId)
    if (!marker) return
    const pending = ['pending', 'dispatching'].includes(command.state)
    const activeDesktop = command.kind === 'desktop.open_app' &&
      ['pending', 'dispatching', 'accepted_by_host', 'uncertain'].includes(command.state) &&
      !state.acknowledgedDesktop.has(command.commandId)
    if (pending || activeDesktop || command.state === 'uncertain') {
      rememberMarker({ ...marker, commandId: command.commandId, sessionId: command.sessionId ?? marker.sessionId })
    } else {
      // Keep pending work until the later durable receipt can be observed after refresh or restart.
      forgetMarker(command.requestId)
    }
    const locked = command.kind !== 'desktop.open_app' && (pending || command.state === 'uncertain')
    operation(command.state === 'accepted_by_dsh' && ['session.create', 'session.message'].includes(command.kind) ? '' : commandStatus(command), locked, command.requestId, command.state === 'uncertain')
    if (command.kind === 'session.create' && command.state === 'accepted_by_dsh' && command.sessionId) {
      void refreshSessions().then(() => selectSession(command.sessionId))
    }
  }
  async function lookupRequest(marker) {
    try {
      const payload = await accessApi(`/commands/by-request/${encodeURIComponent(marker.requestId)}`)
      if (!readMarkers().some((row) => row.requestId === marker.requestId)) return
      if (payload.command) {
        updateFromCommand(payload.command)
        if (!state.tasks.some((item) => item.commandId === payload.command.commandId)) {
          state.tasks.unshift(payload.command)
          renderConversationTasks()
        }
      }
    } catch (error) {
      if (!readMarkers().some((row) => row.requestId === marker.requestId)) return
      if (error.code === 'NOT_FOUND') operation('上次请求尚无宿主记录；不会自动再次发送。请核对后重新输入。', true, marker.requestId)
      else if (error.code === 'NETWORK') operation('连接中断，请重连后查询原请求，不会自动重复发送。', true, marker.requestId)
    }
  }
  async function restoreRequests() {
    for (const marker of readMarkers()) await lookupRequest(marker)
  }
  async function submitCommand(kind, fields = {}, sessionId = null, fixedRequestId = null) {
    if (!state.online || !state.hostId) { setOnline(false); return }
    const cancelling = kind === 'session.cancel'
    if (cancelling) {
      if (state.cancelSubmitting) return null
      state.cancelSubmitting = true
    } else {
      if (state.submitting || state.unresolvedSubmission || Date.now() - state.lastSubmissionMs < 800) return null
      state.submitting = true
      state.lastSubmissionMs = Date.now()
    }
    updateAvailability()
    try {
      const requestId = fixedRequestId || crypto.randomUUID()
      const marker = { requestId, kind, ...(sessionId ? { sessionId } : {}) }
      rememberMarker(marker) // Durable ID before the network request; body stays in memory.
      operation('正在提交请求。')
      try {
        const payload = await accessApi('/commands', { method: 'POST', protectedWrite: true,
          body: { requestId, kind, targetDeviceId: state.hostId, ...fields } })
        if (!payload.command) throw { code: 'REQUEST_FAILED' }
        updateFromCommand(payload.command)
        await refreshTasks()
        return payload.command
      } catch (error) {
        if (error.code === 'NETWORK' || error.code === 'REQUEST_FAILED') {
          operation('送达状态尚未确认，正在查询原请求；不会自动重复发送。', true, requestId)
          await lookupRequest(marker)
        } else if (error.code !== 'UNAUTHORIZED') {
          forgetMarker(requestId)
          operation(error.code === 'MODEL_UNAVAILABLE' ? '电脑尚无可用模型，消息未发送。'
            : error.code === 'SESSION_READ_ONLY' ? '旧会话只供阅读，请新建受限远端会话。'
              : error.code === 'CAPABILITY_UNAVAILABLE' ? '这项电脑能力目前不可用，请稍后再试。'
                : '请求未受理，请检查状态后重试。', false, requestId)
        }
        return null
      }
    } finally {
      if (cancelling) state.cancelSubmitting = false
      else state.submitting = false
      updateAvailability()
    }
  }
  function showConversation() {
    state.phonePane = false
    byId('conversation-pane').hidden = false
    byId('phone-pane').hidden = true
    closeRail()
    if (state.activeChatSource === 'phone') renderSelectedPhoneConversation()
  }
  function phoneSource(deviceId) {
    return state.phoneDeviceNames.get(deviceId) ?? '同步设备（名称未读取）'
  }
  function phoneDisplayTitle(record) {
    if (!['新对话', '手机对话'].includes(record.title.trim())) return record.title
    const first = record.events.find((event) => event.kind === 'message.created' &&
      event.payload?.role === 'user' && typeof event.payload.text === 'string')
    const summary = first?.payload.text.replace(/\s+/gu, ' ').trim()
    if (!summary) return record.title
    const characters = Array.from(summary)
    return characters.slice(0, 26).join('') + (characters.length > 26 ? '…' : '')
  }
  function phoneConversations() {
    const conversations = new Map()
    for (const event of [...state.phoneEvents].sort((a, b) => a.seq - b.seq)) {
      if (typeof event?.conversationId !== 'string' || !syncIdPattern.test(event.conversationId)) continue
      if (!conversations.has(event.conversationId)) conversations.set(event.conversationId,
        { id: event.conversationId, title: '手机对话', sources: new Set(), events: [] })
      const record = conversations.get(event.conversationId)
      if (event.kind === 'conversation.created' && typeof event.payload?.title === 'string') record.title = event.payload.title
      record.sources.add(event.sourceDeviceId)
      record.events.push(event)
    }
    return [...conversations.values()]
  }
  function phoneBinding(conversationId = state.selectedPhoneConversationId) {
    const view = state.phoneBindings.get(conversationId)
    return view?.status === 'active' && sessionIdPattern.test(view.binding?.sessionId || '')
      ? view.binding : null
  }
  function matchingOriginalPhoneModels(view, models) {
    const original = view?.originalModel
    if (!original || typeof original.modelId !== 'string') return []
    if (typeof original.hostProfileId === 'string') return models.filter((model) =>
      model.id === original.hostProfileId && model.model === original.modelId)
    if (typeof original.routeFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(original.routeFingerprint)) return []
    return models.filter((model) => model.model === original.modelId &&
      model.routeFingerprint === original.routeFingerprint)
  }
  async function refreshPhoneBinding(conversationId) {
    if (!state.online || !state.syncAvailable || !syncIdPattern.test(conversationId)) return null
    const owner = state.ownerId, generation = state.identityGeneration
    try {
      const view = await requestJson(`${accessBase}/sync/conversations/${encodeURIComponent(conversationId)}/shared`)
      if (state.ownerId !== owner || state.identityGeneration !== generation ||
          view?.conversationId !== conversationId || view?.hostId !== state.hostId || view?.source !== 'host') return null
      state.phoneBindings.set(conversationId, view)
      renderSessions()
      if (state.activeChatSource === 'desktop' && state.selectedSessionId === view.binding?.sessionId &&
          view.status === 'active') selectPhoneConversation(conversationId)
      if (state.activeChatSource === 'phone' && state.selectedPhoneConversationId === conversationId) {
        updateAvailability()
        renderSelectedPhoneConversation()
        if (phoneBinding(conversationId)) void refreshPhoneHostEvents(conversationId)
      }
      return view
    } catch { return null }
  }
  async function refreshPhoneHostEvents(conversationId) {
    const binding = phoneBinding(conversationId)
    if (!binding || !state.online) return
    const owner = state.ownerId, generation = state.identityGeneration, sessionId = binding.sessionId
    const events = [...(state.phoneHostEvents.get(conversationId) || [])]
    let afterSeq = state.phoneHistoryCursors.get(conversationId)?.nextSeq ?? -1
    try {
      for (let pageNo = 0; pageNo < 20; pageNo++) {
        const page = await accessApi(`/sessions/${encodeURIComponent(sessionId)}/events?${afterSeq === -1 ? '' : `afterSeq=${afterSeq}&`}limit=100`)
        if (state.ownerId !== owner || state.identityGeneration !== generation ||
            phoneBinding(conversationId)?.sessionId !== sessionId || !Array.isArray(page?.events) ||
            !Number.isSafeInteger(page.nextSeq) || page.nextSeq < afterSeq) return
        events.push(...page.events.filter((event) => Number.isSafeInteger(event?.seq) &&
          typeof event.type === 'string'))
        const cursor = state.phoneHistoryCursors.get(conversationId) || {}
        if (afterSeq === -1) { cursor.nextBeforeSeq = page.nextBeforeSeq; cursor.hasOlder = page.hasOlder === true }
        cursor.nextSeq = page.nextSeq; state.phoneHistoryCursors.set(conversationId, cursor)
        if (page.hasMore !== true) break
        if (page.nextSeq <= afterSeq) return
        afterSeq = page.nextSeq
      }
      state.phoneHostEvents.set(conversationId, events)
      if (state.activeChatSource === 'phone' && state.selectedPhoneConversationId === conversationId)
        renderSelectedPhoneConversation()
    } catch { /* The verified phone history remains visible. */ }
  }
  async function findPhoneSyncEvent(outbox, current) {
    let afterSeq = 0
    for (let pageNo = 0; pageNo < 101; pageNo++) {
      const page = await accessApi(`/sync/events?afterSeq=${afterSeq}&limit=200`)
      if (!current()) return null
      if (!Array.isArray(page.events) || !Number.isSafeInteger(page.nextSeq) ||
          page.nextSeq < afterSeq || typeof page.hasMore !== 'boolean') throw { code: 'REQUEST_FAILED' }
      const found = page.events.find((row) => row.eventId === outbox.event.eventId)
      if (found) {
        const expected = outbox.event
        if (found.sourceDeviceId !== outbox.deviceId || found.conversationId !== expected.conversationId ||
            found.clientSeq !== expected.clientSeq || found.kind !== expected.kind ||
            found.occurredAt !== expected.occurredAt || JSON.stringify(found.payload) !== JSON.stringify(expected.payload)) {
          throw { code: 'REQUEST_CONFLICT' }
        }
        return found
      }
      if (!page.hasMore) return null
      if (page.nextSeq === afterSeq) throw { code: 'REQUEST_FAILED' }
      afterSeq = page.nextSeq
    }
    throw { code: 'CAPACITY_LIMIT' }
  }
  function completePhoneSend(outbox, row) {
    if (!state.phoneEvents.some((event) => event.eventId === row.eventId)) {
      state.phoneEvents.push(row)
      state.phoneEvents.sort((a, b) => a.seq - b.seq)
    }
    rememberPhoneClientSeq(outbox.event.clientSeq)
    clearPhoneOutbox()
    state.phoneDrafts.delete(outbox.event.conversationId)
    if (state.activeChatSource === 'phone' && state.selectedPhoneConversationId === outbox.event.conversationId) {
      if (byId('message-text').value === outbox.event.payload.text) byId('message-text').value = ''
      state.phoneSendNotice = '文字已同步到原手机对话。MiMo 回复需在手机端继续，电脑没有运行模型。'
      renderSelectedPhoneConversation()
    }
    renderSessions()
    updateAvailability()
  }
  async function sendPhoneMessage() {
    const bound = phoneBinding()
    if (bound) {
      if (state.phoneSending || !state.online ||
          state.sessions.find((item) => item.sessionId === bound.sessionId)?.sendAvailable !== true) return
      const conversationId = state.selectedPhoneConversationId, text = byId('message-text').value.trim(),
        owner = state.ownerId, generation = state.identityGeneration
      if (!text) return
      state.phoneSending = true
      updateAvailability()
      try {
        const command = await submitCommand('session.message',
          { sessionId: bound.sessionId, text, mode: composerInputMode(bound.sessionId) }, bound.sessionId)
        if (state.ownerId !== owner || state.identityGeneration !== generation ||
            state.selectedPhoneConversationId !== conversationId || state.activeChatSource !== 'phone') return
        if (command?.state === 'accepted_by_dsh') {
          state.phoneDrafts.delete(conversationId)
          if (byId('message-text').value.trim() === text) byId('message-text').value = ''
          state.phoneSendNotice = '电脑已受理，正在等待真实会话记录。'
          await Promise.all([refreshPhoneBinding(conversationId), refreshPhoneHostEvents(conversationId)])
        } else state.phoneSendNotice = '结果待核对。原请求编号和草稿已保留。'
      } finally { if (state.ownerId === owner && state.identityGeneration === generation) {
        state.phoneSending = false; updateAvailability() } }
      return
    }
    if (state.phoneSending || state.activeChatSource !== 'phone' || !state.online || !state.syncAvailable ||
        !state.ownerId || !state.device?.id || !syncIdPattern.test(state.selectedPhoneConversationId)) return
    const ownerId = state.ownerId, deviceId = state.device.id, generation = state.identityGeneration,
      conversationId = state.selectedPhoneConversationId
    const current = () => state.ownerId === ownerId && state.device?.id === deviceId &&
      state.identityGeneration === generation && state.activeChatSource === 'phone' &&
      state.selectedPhoneConversationId === conversationId && !!state.csrfToken
    let outbox = readPhoneOutbox()
    if (outbox && outbox.event.conversationId !== conversationId) return
    const recovery = !outbox ? readPhoneRecovery() : null
    if (recovery) {
      if (recovery.event.conversationId !== conversationId) return
      state.phoneSending = true
      updateAvailability()
      try {
        const saved = await findPhoneSyncEvent(recovery, current)
        if (!current()) return
        if (saved && !state.phoneEvents.some((event) => event.eventId === saved.eventId)) {
          state.phoneEvents.push(saved)
          state.phoneEvents.sort((a, b) => a.seq - b.seq)
        }
        try {
          localStorage.removeItem(`weftmate:phone-sync-outbox:v1:${ownerId}:${recovery.deviceId}`)
          localStorage.removeItem(phoneRecoveryKey())
        } catch { /* A later check may still see the old record. */ }
        if (saved) {
          byId('message-text').value = ''
          state.phoneSendNotice = '旧文字已在原对话中找到，没有再次发送。MiMo 回复需在手机端继续。'
          renderSelectedPhoneConversation()
        } else {
          state.phoneDrafts.set(conversationId, recovery.event.payload.text)
          byId('message-text').value = recovery.event.payload.text
          state.phoneSendNotice = '未找到旧文字，草稿已恢复。确认内容后可用新设备会话同步。'
        }
      } catch {
        if (current()) state.phoneSendNotice = '旧请求暂时无法核对。原文仍保留，请重连后重试。'
      } finally {
        if (state.ownerId === ownerId && state.device?.id === deviceId && state.identityGeneration === generation) {
          state.phoneSending = false
          if (current()) updateAvailability()
        }
      }
      return
    }
    const wasPending = !!outbox
    if (!outbox) {
      const text = byId('message-text').value.trim()
      const clientSeq = nextPhoneClientSeq()
      const eventId = `event-${crypto.randomUUID()}`, messageId = `message-${crypto.randomUUID()}`
      if (!text || text.length > 8192 || !clientSeq || !syncIdPattern.test(eventId) ||
          !syncIdPattern.test(messageId)) return
      outbox = { ownerId, deviceId, event: { eventId, conversationId, clientSeq,
        kind: 'message.created', occurredAt: new Date().toISOString(),
        payload: { messageId, role: 'user', text } } }
      if (!writePhoneOutbox(outbox)) {
        state.phoneSendNotice = '浏览器未能保存待发送文字。本次没有提交，请检查浏览器存储后重试。'
        updateAvailability()
        return
      }
    }
    state.phoneSending = true
    state.phoneSendNotice = '正在核对并同步这条文字…'
    updateAvailability()
    try {
      if (wasPending) {
        const existing = await findPhoneSyncEvent(outbox, current)
        if (!current()) return
        if (existing) return completePhoneSend(outbox, existing)
      }
      const result = await accessApi('/sync/events', { method: 'POST', protectedWrite: true,
        body: { events: [outbox.event] } })
      if (!current()) return
      const receipt = result?.accepted?.find((item) => item.eventId === outbox.event.eventId)
      if (!Number.isSafeInteger(receipt?.seq) || receipt.seq < 1) throw { code: 'REQUEST_FAILED' }
      const saved = await findPhoneSyncEvent(outbox, current)
      if (!current()) return
      if (!saved) throw { code: 'REQUEST_FAILED' }
      completePhoneSend(outbox, saved)
    } catch (error) {
      if (!current()) return
      if (['NETWORK', 'REQUEST_CONFLICT', 'REQUEST_FAILED'].includes(error?.code)) {
        try {
          const saved = await findPhoneSyncEvent(outbox, current)
          if (!current()) return
          if (saved) return completePhoneSend(outbox, saved)
        } catch { /* Keep the exact event for the next explicit reconciliation. */ }
      }
      state.phoneSendNotice = error?.code === 'UNAUTHORIZED' ? '登录已失效。重新登录后请核对这条文字。'
        : error?.code === 'REQUEST_CONFLICT' ? '同步编号发生冲突，原文已保留。请重新登录以生成新设备会话，先核对旧消息再发送。'
          : '同步结果未确认。文字已保留；重连后点“核对并重试”，不会生成第二条消息。'
    } finally {
      if (state.ownerId === ownerId && state.device?.id === deviceId && state.identityGeneration === generation) {
        state.phoneSending = false
        if (current()) updateAvailability()
      }
    }
  }
  function closePhoneImagePreview() {
    if (!phonePreview) return
    const button = phonePreview.returnFocus
    const scope = phonePreview.scope
    phonePreview.returnFocus = null
    phonePreview.scope = null
    if (phonePreview.dialog.open) phonePreview.dialog.close()
    phonePreview.dialog.hidden = true
    phonePreview.image.removeAttribute('src')
    phonePreview.image.alt = ''
    if (button && button.isConnected !== false && scope?.ownerId === state.ownerId &&
        scope.identityGeneration === state.identityGeneration &&
        scope.source === state.activeChatSource && scope.conversationId ===
          (scope.source === 'phone' ? state.selectedPhoneConversationId : state.selectedSessionId)) button.focus()
  }
  function ensurePhoneImagePreview() {
    if (phonePreview) return phonePreview
    const dialog = element('dialog', 'phone-image-preview')
    dialog.id = 'phone-image-preview'
    dialog.hidden = true
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-label', '图片预览')
    const image = element('img')
    const close = element('button', 'phone-image-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', '关闭图片预览')
    close.addEventListener('click', closePhoneImagePreview)
    dialog.append(image, close)
    dialog.addEventListener('click', (event) => { if (event.target === dialog) closePhoneImagePreview() })
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closePhoneImagePreview() })
    dialog.addEventListener('close', closePhoneImagePreview)
    document.body.append(dialog)
    phonePreview = { dialog, image, close, returnFocus: null, scope: null }
    return phonePreview
  }
  function openPhoneImagePreview(url, name, button, scope) {
    if (!scope || scope.ownerId !== state.ownerId || scope.identityGeneration !== state.identityGeneration ||
        scope.source !== state.activeChatSource || scope.conversationId !==
          (scope.source === 'phone' ? state.selectedPhoneConversationId : state.selectedSessionId)) return
    if (window.WeftDesktop) { window.WeftDesktop.showImage(url, name, button); return }
    const preview = ensurePhoneImagePreview()
    preview.returnFocus = button
    preview.scope = scope
    preview.image.src = url
    preview.image.alt = name
    preview.dialog.hidden = false
    preview.dialog.showModal()
    preview.close.focus()
  }
  function phoneMessageText(value) {
    const text = typeof value === 'string' ? value : ''
    const marker = /(?:^|\n)\[本机附件：([^\n]*)；跨端暂不可见\]$/.exec(text)
    return marker ? { text: text.slice(0, marker.index).trimEnd(), legacy: marker[1] } : { text, legacy: null }
  }
  function legacyFileNames(value) {
    return typeof value === 'string' ? value.split('、').map((name) => name.trim()).filter((name) =>
      name && !/\.(?:png|jpe?g|webp|gif)$/i.test(name)).join('、') : ''
  }
  function phoneHandoffKey(conversationId) {
    return `weftmate:phone-handoff:v1:${state.ownerId}:${conversationId}`
  }
  async function adoptPhoneConversation(conversationId, modelProfileId) {
    if (state.phoneHandoffBusy || !state.online || !syncIdPattern.test(conversationId) ||
        !state.models.some((model) => model.id === modelProfileId)) return
    const view = state.phoneBindings.get(conversationId)
    if (!view || view.status === 'active' || view.canAdopt !== true ||
        !Number.isSafeInteger(view.syncThroughSeq)) return
    const owner = state.ownerId, generation = state.identityGeneration
    const key = phoneHandoffKey(conversationId)
    let intent
    try { intent = JSON.parse(localStorage.getItem(key) || 'null') } catch { intent = null }
    if (intent && (intent.modelProfileId !== modelProfileId ||
        intent.expectedSyncSeq !== view.syncThroughSeq || !/^[0-9a-f-]{36}$/.test(intent.requestId || ''))) {
      state.phoneSendNotice = '原交接请求仍待核对，请保持原模型选择并重试。'
      renderSelectedPhoneConversation()
      return
    }
    intent ||= { requestId: crypto.randomUUID(), modelProfileId, expectedSyncSeq: view.syncThroughSeq }
    try { localStorage.setItem(key, JSON.stringify(intent)) }
    catch { state.phoneSendNotice = '无法保存交接编号。本次没有提交，请检查浏览器存储。'; renderSelectedPhoneConversation(); return }
    state.phoneHandoffBusy = true
    renderSelectedPhoneConversation()
    const current = () => state.ownerId === owner && state.identityGeneration === generation &&
      state.selectedPhoneConversationId === conversationId
    try {
      let command = null
      try {
        const prior = await accessApi(`/commands/by-request/${encodeURIComponent(intent.requestId)}`)
        command = prior.command
      } catch (error) { if (error?.code !== 'NOT_FOUND') throw error }
      if (!current()) return
      if (!command) {
        const result = await accessApi(`/sync/conversations/${encodeURIComponent(conversationId)}/shared`, {
          method: 'POST', protectedWrite: true, body: intent })
        command = result.command
      }
      if (!current() || command?.requestId !== intent.requestId || command?.kind !== 'session.create')
        throw { code: 'REQUEST_FAILED' }
      state.phoneSendNotice = '电脑正在接上原对话，完成后可在这里继续发送。'
      for (let attempt = 0; attempt < 10 && current(); attempt++) {
        const latest = await refreshPhoneBinding(conversationId)
        if (latest?.status === 'active' && latest.binding?.sessionId === command.sessionId) {
          localStorage.removeItem(key)
          state.phoneSendNotice = '已接上电脑模型。原手机记录和图片仍在这条对话里。'
          await refreshSessions()
          await refreshPhoneHostEvents(conversationId)
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    } catch (error) {
      const existing = current() ? await refreshPhoneBinding(conversationId) : null
      if (current() && existing?.status === 'active') {
        if (existing.binding?.modelProfileId === modelProfileId) {
          localStorage.removeItem(key)
          state.phoneSendNotice = '这条原对话已有电脑接续，已显示现有会话。'
        } else state.phoneSendNotice = '这条对话已绑定另一台电脑模型；请查看原交接。'
      } else if (current()) state.phoneSendNotice = error?.code === 'LOCAL_TURN_RUNNING'
        ? '手机仍在回复，等这轮结束并同步后再接到电脑。'
        : error?.code === 'LOCAL_TURN_UNCONFIRMED'
          ? '手机回合状态待核对；只能按已同步的记录明确交接。'
          : error?.code === 'SOURCE_DEVICE_UPGRADE_REQUIRED'
            ? '请先更新创建这条对话的手机应用，再从原对话接到电脑。'
          : '交接结果待核对。原编号已保留，不会另建会话。'
    } finally {
      if (state.ownerId === owner && state.identityGeneration === generation) {
        state.phoneHandoffBusy = false
        if (current()) renderSelectedPhoneConversation()
      }
    }
  }
  function phoneHandoffControls(list, record, view) {
    const row = element('li', 'phone-handoff')
    const binding = phoneBinding(record.id)
    if (binding) {
      const model = state.models.find((item) => item.id === binding.modelProfileId)
      row.append(element('strong', '', '这条对话已在电脑继续'),
        element('span', '', `当前由${model?.name || '所选电脑模型'}处理。此前手机文字与图片保留在下方。`))
      const linkedTask = state.tasks.find((item) => item?.conversationId === record.id &&
        sessionIdPattern.test(item.taskId || item.commandId || ''))
      if (linkedTask) {
        const task = element('button', '', '查看这段的事情与成果')
        row.append(task)
      }
    } else if (view?.status === 'creating' || view?.status === 'uncertain') {
      row.append(element('strong', '', '正在核对电脑交接'),
        element('span', '', '保留原请求编号，核对完成前不会创建第二段会话。'))
      const check = element('button', '', '检查状态')
      check.addEventListener('click', () => { void refreshPhoneBinding(record.id) })
      row.append(check)
    } else if (view?.canAdopt === true && state.models.length) {
      row.append(element('strong', '', '在电脑继续这条对话'))
      const original = view.originalModel
      const matches = matchingOriginalPhoneModels(view, state.models)
      const modelLabel = typeof original?.displayName === 'string' ? original.displayName : '原手机模型'
      row.append(element('span', '', !original
        ? '旧记录没有可核对的原模型身份。请在下方明确选择已配置的电脑模型；手机消息与图片仍保留。'
        : matches.length === 1
          ? `手机原用：${modelLabel}。已找到同一电脑配置并优先选中；手机消息与图片仍保留。`
          : matches.length > 1
            ? `手机原用：${modelLabel}。找到多个可核对的相同配置，请明确选其中一个。`
            : `手机原用：${modelLabel}。电脑模型目录尚无可核对的同一配置；此页不能添加模型密钥。请先在电脑主程序核对配置，再刷新目录，或明确选择另一模型。`))
      const label = element('label', '', '电脑模型')
      const select = element('select')
      const placeholder = element('option', '', '请选择电脑模型')
      placeholder.value = ''
      select.append(placeholder)
      for (const model of state.models) {
        const option = element('option', '', model.name)
        option.value = model.id
        select.append(option)
      }
      let pending
      try { pending = JSON.parse(localStorage.getItem(phoneHandoffKey(record.id)) || 'null') }
      catch { pending = null }
      const manual = state.phoneHandoffSelections.get(record.id)
      select.value = state.phoneHandoffSelections.has(record.id)
        ? state.models.some((model) => model.id === manual) ? manual : ''
        : pending?.modelProfileId
          ? state.models.some((model) => model.id === pending.modelProfileId) ? pending.modelProfileId : ''
          : matches.length === 1 ? matches[0].id : ''
      label.append(select)
      const start = element('button', '', state.phoneHandoffBusy ? '正在核对…' : '在电脑继续')
      start.disabled = state.phoneHandoffBusy || !select.value
      select.addEventListener('change', () => {
        state.phoneHandoffSelections.set(record.id, select.value)
        start.disabled = state.phoneHandoffBusy || !select.value
      })
      start.addEventListener('click', () => { void adoptPhoneConversation(record.id, select.value) })
      const refresh = element('button', 'secondary', '刷新电脑模型目录')
      refresh.addEventListener('click', () => { void refreshModels().then(() => refreshPhoneBinding(record.id)) })
      row.append(label, start, refresh)
    } else {
      row.append(element('strong', '', view?.canAdopt === true ? '电脑模型尚未配置' : '手机记录暂未准备好交接'), element('span', '',
        view?.reasonCode === 'LOCAL_TURN_RUNNING' ? '等手机回复结束并同步后再试。'
          : view?.reasonCode === 'LOCAL_TURN_UNCONFIRMED' ? '手机回合状态待核对；原消息仍保留。'
            : view?.reasonCode === 'SOURCE_DEVICE_UPGRADE_REQUIRED' ? '请先更新创建这条对话的手机应用。'
            : view?.canAdopt === true ? `手机原用${view.originalModel?.displayName ? ` ${view.originalModel.displayName}` : '的模型'}；电脑目录没有已配置的可选模型。此页不能添加模型密钥，配置完成后刷新目录。`
              : state.online ? '请先完成同步并配置可用的电脑模型。' : '重连电脑后可核对交接状态。'))
      if (view?.canAdopt === true) {
        const refresh = element('button', 'secondary', '刷新电脑模型目录')
        refresh.addEventListener('click', () => { void refreshModels().then(() => refreshPhoneBinding(record.id)) })
        row.append(refresh)
      }
    }
    list.append(row)
  }
  function renderSelectedPhoneConversation() {
    if (state.activeChatSource !== 'phone' || state.phonePane) return
    const record = phoneConversations().find((item) => item.id === state.selectedPhoneConversationId)
    if (!record) { byId('transcript').replaceChildren(); byId('timeline-status').textContent = '这条手机对话尚未同步完成。'; return }
    byId('assistant-title').textContent = phoneDisplayTitle(record)
    const list = byId('transcript')
    list.replaceChildren()
    const previewScope = { ownerId: state.ownerId, identityGeneration: state.identityGeneration,
      source: 'phone', conversationId: state.selectedPhoneConversationId }
    const view = state.phoneBindings.get(record.id)
      const appendPhoneMessage = (event, receiptId = null) => {
      if (event.kind !== 'message.created' || !['user', 'assistant'].includes(event.payload?.role)) return
      const row = element('li', `message ${event.payload.role}`)
      if (event.payload.role === 'user' && receiptIdPattern.test(receiptId || '')) row.dataset.receiptId = receiptId
      row.dataset.seq = String(event.seq)
      row.append(element('span', 'message-label', event.payload.role === 'user'
        ? event.sourceDeviceId === state.device?.id ? '你 · 电脑同步' : '你 · 手机 MiMo'
        : 'WeftMate · 手机 MiMo'))
      const display = phoneMessageText(event.payload.text)
      if (display.text) row.append(event.payload.role === 'assistant' && window.WeftDesktop
        ? window.WeftDesktop.markdown(display.text, 'message-text markdown-body') : element('span', 'message-text', display.text))
      const attachments = Array.isArray(event.payload.attachments) ? event.payload.attachments : []
      const gallery = element('div', 'synced-image-gallery')
      for (const attachment of attachments) {
        if (!syncIdPattern.test(attachment?.attachmentId) ||
            !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(attachment?.contentType)) continue
        const name = typeof attachment.name === 'string' ? attachment.name.slice(0, 128) : '图片'
        const url = `${accessBase}/sync/attachments/${attachment.attachmentId}`
        const displayUrl = `${url}?variant=display`
        const safeSize = Number.isSafeInteger(attachment.size) && attachment.size > 0 ? attachment.size : null
        const smallLegacy = safeSize !== null && safeSize <= 5 * 1024 * 1024
        const safeOriginal = safeSize !== null && safeSize <= 20 * 1024 * 1024
        const button = element('button', 'synced-image')
        button.type = 'button'
        button.setAttribute('aria-label', `查看图片 ${name}`)
        const image = element('img')
        image.src = displayUrl
        image.alt = ''
        image.loading = 'lazy'
        image.decoding = 'async'
        image.addEventListener('error', () => {
          if (smallLegacy && image.src === displayUrl) { image.src = url; return }
          image.hidden = true
          button.classList.add('is-unavailable')
          button.disabled = true
        })
        button.append(image)
        button.addEventListener('click', () => openPhoneImagePreview(safeOriginal ? url : displayUrl, name, button, previewScope))
        gallery.append(button)
      }
      if (gallery.children.length) {
        row.classList.add('message-has-images')
        if (!display.text && !legacyFileNames(display.legacy)) row.classList.add('message-image-only')
        row.append(gallery)
      }
      const files = legacyFileNames(display.legacy)
      if (files) row.append(element('small', 'truncated', `旧附件：${files}。`))
      list.append(row)
    }
    const binding = phoneBinding(record.id)
    if (!binding) {
      for (const event of record.events) appendPhoneMessage(event)
    } else {
      const cutover = binding.cutoverSyncSeq
      for (const event of record.events) if (event.seq <= cutover) appendPhoneMessage(event)
      const section = element('li', 'phone-handoff-divider', '从这里起，由电脑模型接着处理')
      list.append(section)
      const adopted = new Map((Array.isArray(view?.adoptedMessages) ? view.adoptedMessages : [])
        .filter((item) => item?.state === 'accepted_by_dsh' &&
          typeof item.receiptId === 'string' && syncIdPattern.test(item.sourceSyncEventId || ''))
        .map((item) => [item.receiptId, item.sourceSyncEventId]))
      const shownSync = new Set()
      for (const event of state.phoneHostEvents.get(record.id) || []) {
        if (event.type === 'user.message') {
          const exactId = adopted.get(event.data?.receiptId)
          const original = exactId && record.events.find((item) => item.eventId === exactId)
          if (original) { appendPhoneMessage(original, event.data?.receiptId); shownSync.add(exactId); continue }
        }
        if (!['user.message', 'assistant.message'].includes(event.type)) continue
        const text = typeof event.data?.text === 'string' ? event.data.text : ''
        const images = Array.isArray(event.data?.images) ? event.data.images : []
        if (!text && !images.length) continue
        const row = element('li', `message ${event.type === 'user.message' ? 'user' : 'assistant'}`)
        if (event.type === 'user.message' && receiptIdPattern.test(event.data?.receiptId || '')) row.dataset.receiptId = event.data.receiptId
        row.dataset.seq = String(event.seq)
      row.append(element('span', 'message-label', event.type === 'user.message'
          ? '你 · 电脑续聊' : 'WeftMate · 电脑模型'))
        if (text) row.append(event.type === 'assistant.message' && window.WeftDesktop
          ? window.WeftDesktop.markdown(text, 'message-text markdown-body') : element('span', 'message-text', text))
        for (const image of images) {
          const url = /^sha256:[a-f0-9]{64}$/.test(image?.attachmentId || '') &&
            ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image?.contentType)
            ? `${accessBase}/sessions/${encodeURIComponent(binding.sessionId)}/attachments/${encodeURIComponent(image.attachmentId)}` : null
          if (!url) continue
          const button = element('button', 'synced-image', '查看电脑会话图片')
          button.addEventListener('click', () => openPhoneImagePreview(url, image.name || '电脑会话图片', button, previewScope))
          row.append(button)
        }
        list.append(row)
      }
      const late = record.events.filter((event) => event.seq > cutover &&
        event.kind === 'message.created' && !shownSync.has(event.eventId))
      if (late.length) list.append(element('li', 'phone-handoff-divider', '交接后才同步的手机记录 · 已保留，尚未自动并入电脑上下文'))
      for (const event of late) appendPhoneMessage(event)
    }
    phoneHandoffControls(list, record, view)
    if (binding) { const cursor = state.phoneHistoryCursors.get(record.id); state.hasOlder = cursor?.hasOlder === true; state.nextBeforeSeq = cursor?.nextBeforeSeq; renderOlderControl(); renderTimeline(state.phoneHostEvents.get(record.id) || []) }
    renderConversationTasks()
    void refreshConversationTasks()
    byId('timeline-status').textContent = state.phoneHasMore ? '仍有手机同步记录未读完，连接后会继续读取。' : ''
    updateAvailability()
  }
  function selectPhoneConversation(conversationId) {
    window.WeftDesktop?.closePreview(false)
    if (!syncIdPattern.test(conversationId) || !phoneConversations().some((item) => item.id === conversationId)) return
    if (state.activeChatSource === 'desktop') {
      state.desktopDraft = byId('message-text').value
      cancelAttachmentUpload()
    }
    else if (state.selectedPhoneConversationId && !readPhoneOutbox())
      state.phoneDrafts.set(state.selectedPhoneConversationId, byId('message-text').value)
    state.activeChatSource = 'phone'
    state.turnStatus = null
    state.turnEndReasonKind = null
    state.selectedPhoneConversationId = conversationId
    state.phoneSendNotice = ''
    const pending = readPhoneOutbox()
    const recovery = !pending ? readPhoneRecovery() : null
    byId('message-text').value = pending?.event.conversationId === conversationId
      ? pending.event.payload.text : recovery?.event.conversationId === conversationId
        ? recovery.event.payload.text : state.phoneDrafts.get(conversationId) || ''
    byId('message-text').placeholder = '补充到这条手机对话'
    state.attachmentStatus = ''
    renderAttachmentDrafts()
    byId('conversation-pane').classList.add('is-phone')
    state.historyGeneration++
    closePhoneImagePreview()
    byId('chat-intro').hidden = true
    byId('desktop-action').hidden = true
    showConversation()
    renderSessions()
    closeRail()
    void refreshPhoneBinding(conversationId)
  }
  function renderPhoneRecords() {
    const records = phoneConversations()
    if (!records.some((record) => record.id === state.selectedPhoneConversationId)) {
      state.selectedPhoneConversationId = records[0]?.id ?? null
    }
    const list = byId('phone-conversations')
    list.replaceChildren()
    for (const record of records) {
      const item = element('li')
      const button = element('button', record.id === state.selectedPhoneConversationId ? 'is-current' : '')
      button.type = 'button'
      button.append(element('strong', '', phoneDisplayTitle(record)), element('small', '',
        [...record.sources].map(phoneSource).join('、')))
      button.addEventListener('click', () => { state.selectedPhoneConversationId = record.id; renderPhoneRecords() })
      item.append(button)
      list.append(item)
    }
    const history = byId('phone-history')
    history.replaceChildren()
    const selected = records.find((record) => record.id === state.selectedPhoneConversationId)
    for (const event of selected?.events ?? []) {
      const source = phoneSource(event.sourceDeviceId)
      let label, content
      if (event.kind === 'message.created' && typeof event.payload?.text === 'string') {
        label = event.payload.role === 'assistant' ? `${source} · 手机助手` : `${source} · 你`
        content = event.payload.text
      } else if (event.kind === 'turn.finished') {
        label = `${source} · 本地回合`
        content = ({ completed: '已结束', cancelled: '已取消', failed: '失败', interrupted: '中断' })[event.payload?.status]
      } else if (event.kind === 'tool.receipt') {
        label = `${source} · 手机工具回执`
        const status = ({ dispatched: '已派发，结果待核对', observed: '已观察到结果', failed: '失败',
          uncertain: '结果待确认' })[event.payload?.status]
        content = status ? `${status}。${event.payload.summary ?? ''}` : null
      }
      if (!content) continue
      const row = element('li', 'message')
      row.dataset.seq = String(event.seq)
      row.append(element('span', 'message-label', label), element('span', 'message-text', content))
      history.append(row)
    }
    byId('phone-status').textContent = records.length ? '' : '还没有来自手机的同步记录。'
    byId('phone-more').hidden = !state.phoneHasMore
  }
  async function refreshPhoneRecords(reset = false) {
    if (!state.syncAvailable || state.phoneLoading) return
    if (reset) { state.phoneEvents = []; state.phoneAfterSeq = 0; state.phoneHasMore = true }
    const owner = state.ownerId, identity = state.csrfToken
    state.phoneLoading = true
    try {
      let shouldRead = true
      for (let pageNo = 0; pageNo < 5 && shouldRead; pageNo++) {
        const page = await accessApi(`/sync/events?afterSeq=${state.phoneAfterSeq}&limit=100`)
        if (state.ownerId !== owner || state.csrfToken !== identity) return
        if (!Array.isArray(page.events) || !Number.isSafeInteger(page.nextSeq) ||
            page.nextSeq < state.phoneAfterSeq || typeof page.hasMore !== 'boolean') throw { code: 'REQUEST_FAILED' }
        let previous = state.phoneAfterSeq
        for (const event of page.events) {
          if (!Number.isSafeInteger(event?.seq) || event.seq <= previous || event.seq > page.nextSeq) throw { code: 'REQUEST_FAILED' }
          previous = event.seq
          if (!state.phoneEvents.some((known) => known.seq === event.seq)) state.phoneEvents.push(event)
        }
        if (page.hasMore && page.nextSeq === state.phoneAfterSeq) throw { code: 'REQUEST_FAILED' }
        state.phoneAfterSeq = page.nextSeq
        state.phoneHasMore = page.hasMore
        shouldRead = page.hasMore
      }
      renderPhoneRecords()
      renderSessions()
      if (state.activeChatSource === 'phone') renderSelectedPhoneConversation()
      const candidates = phoneConversations().slice(0, 30).map((record) => record.id)
      void Promise.allSettled(candidates.map((id) => refreshPhoneBinding(id)))
      if (state.phoneHasMore) byId('phone-status').textContent = '还有同步记录未读完，可继续读取。'
    } catch (error) {
      if (error.code !== 'UNAUTHORIZED') byId('phone-status').textContent =
        error.code === 'NETWORK' ? '连接中断，重连后从原位置补读手机记录。' : '手机记录暂时无法读取，请刷新重试。'
    } finally { state.phoneLoading = false }
  }
  async function showPhonePane() {
    if (!state.syncAvailable) return
    state.phonePane = true
    byId('conversation-pane').hidden = true
    byId('phone-pane').hidden = false
    byId('assistant-title').textContent = '手机来源'
    closeRail()
    try {
      const payload = await api('/devices')
      if (Array.isArray(payload.devices)) state.phoneDeviceNames = new Map(payload.devices
        .filter((device) => typeof device?.id === 'string' && typeof device.name === 'string')
        .map((device) => [device.id, device.name]))
    } catch { /* The source ID remains bound on the server if names are temporarily unavailable. */ }
    renderPhoneRecords()
    await refreshPhoneRecords()
  }
  function closeRail() {
    byId('session-rail').classList.remove('is-open')
    byId('rail-backdrop').hidden = true
    byId('rail-open').setAttribute('aria-expanded', 'false')
  }
  function startAssistantRefresh() {
    stopAssistantRefresh()
    state.refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') void refreshAssistant() }, 6_000)
  }
  function stopAssistantRefresh() { if (state.refreshTimer) clearInterval(state.refreshTimer); state.refreshTimer = null }
  async function refreshAssistant() {
    if (state.refreshing || !state.csrfToken) return
    state.refreshing = true
    try {
      await refreshStatus()
      await refreshModels()
      await refreshSessions()
      await refreshTasks()
      await refreshHistory()
      if (state.syncAvailable) await refreshPhoneRecords()
      await refreshConversationTasks()
      await restoreRequests()
    } catch (error) {
      if (error.code === 'NETWORK') {
        for (const entry of conversationTasks.entries.values()) entry.notice = '连接中断，执行进展待更新。重连后可重新核对。'
        renderConversationTasks()
      } else if (error.code !== 'UNAUTHORIZED') toast('部分状态暂时无法读取，稍后会重试。')
    }
    finally { state.refreshing = false }
  }
  async function enterAssistant() {
    show('assistant')
    closeRail()
    await refreshAssistant()
    startAssistantRefresh()
  }
  async function load() {
    show('loading')
    try {
      const accountState = await api('/state')
      if (state.setupGrant) { clearSession(); showRegistration(); return }
      try {
        acceptSession(await api('/me'))
        await enterAssistant()
      } catch (error) {
        if (error.code === 'UNAUTHORIZED') {
          clearSession()
          if (state.setupGrant || accountState.configured !== true) showRegistration()
          else show('login')
        }
        else throw error
      }
    } catch (error) {
      show('owner')
      errorAt('setup-error', '')
      toast(failureMessage(error, 'network'))
    }
  }

  function showRegistration() {
    byId('setup-title').textContent = state.setupGrant ? '设置这台电脑的原账户' : '注册新账户'
    byId('setup-intro').textContent = state.setupGrant
      ? '这份本机设置链接只可使用一次。旧会话与资料仍归原账户。'
      : '每个人使用自己的账户和设备，资料与对话分别保存。'
    show('setup')
  }

  byId('owner-refresh').addEventListener('click', load)
  byId('setup-to-login').addEventListener('click', () => show('login'))
  byId('login-to-register').addEventListener('click', showRegistration)
  byId('setup-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    errorAt('setup-error', '')
    const username = byId('setup-name').value.trim()
    const deviceName = byId('setup-device').value.trim()
    const password = byId('setup-password').value
    const confirmation = byId('setup-confirm').value
    if (!username || !deviceName) return errorAt('setup-error', '请填写账户名和设备名称。')
    const normalizedName = username.normalize('NFKC')
    if (Array.from(normalizedName).length < 3 || Array.from(normalizedName).length > 64 || !/^[\p{L}\p{N}_.-]+$/u.test(normalizedName)) {
      return errorAt('setup-error', '账户名须为 3–64 个文字、数字、下划线、点或短横线。')
    }
    if (Array.from(password).length < 15 || Array.from(password).length > 128) return errorAt('setup-error', '密码须为 15–128 个字符。')
    if (password !== confirmation) return errorAt('setup-error', '两次输入的密码不一致。')
    setBusy(form, true)
    try {
      const ownerSetup = !!state.setupGrant
      acceptSession(await api(ownerSetup ? '/setup' : '/register', { method: 'POST',
        body: ownerSetup ? { grant: state.setupGrant, username, password, deviceName }
          : { username, password, deviceName } }))
      state.setupGrant = null
      toast(ownerSetup ? '原账户已设置。' : '账户已注册。')
      await enterAssistant()
    } catch (error) {
      if (error.code === 'INVALID_SETUP_GRANT' || error.code === 'ACCOUNT_ALREADY_CONFIGURED') {
        state.setupGrant = null
        if (error.code === 'ACCOUNT_ALREADY_CONFIGURED') show('login')
        else showRegistration()
      }
      errorAt('setup-error', failureMessage(error))
      toast(failureMessage(error))
    } finally {
      clearPasswords('setup-password', 'setup-confirm')
      setBusy(form, false)
    }
  })
  byId('login-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    errorAt('login-error', '')
    const username = byId('login-name').value.trim()
    const password = byId('login-password').value
    const deviceName = byId('login-device').value.trim()
    if (!username || !password || !deviceName) return errorAt('login-error', '请填写账户名、密码和设备名称。')
    setBusy(form, true)
    try {
      acceptSession(await api('/login', { method: 'POST', body: { username, password, deviceName } }))
      toast('已登录。')
      await enterAssistant()
    } catch (error) { errorAt('login-error', failureMessage(error)) }
    finally { clearPasswords('login-password'); setBusy(form, false) }
  })
  byId('profile-display-name').addEventListener('input', () => {
    state.profileDraftGeneration++
    byId('profile-status').textContent = ''
    errorAt('profile-error', '')
    profileControls()
  })
  byId('profile-avatar-file').addEventListener('change', async (event) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    const token = accountToken()
    const selection = ++state.avatarSelectionGeneration
    state.profileDraftGeneration++
    state.avatarGeneration++
    releaseAvatarUrl()
    byId('profile-avatar-image').removeAttribute?.('src')
    byId('profile-avatar-image').hidden = true
    byId('profile-avatar-placeholder').hidden = false
    state.avatarChecking = true
    state.profileDraftAvatar = undefined
    profileControls()
    byId('profile-status').textContent = ''
    byId('profile-avatar-status').textContent = '正在检查并预览头像…'
    errorAt('profile-error', '')
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('头像仅支持 PNG、JPEG 或 WebP。')
      if (file.size < 16 || file.size > 128 * 1024) throw new Error('头像不能超过 128 KiB，且须为有效图片。')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!accountCurrent(token) || selection !== state.avatarSelectionGeneration) return
      if (!avatarSignature(bytes, file.type)) throw new Error('图片格式与文件内容不符，请选择有效图片。')
      let binary = ''
      for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
      const avatar = { mimeType: file.type, dataBase64: btoa(binary) }
      if (!accountCurrent(token) || selection !== state.avatarSelectionGeneration) return
      const previewed = await paintAvatar(avatar, token, file)
      if (!accountCurrent(token) || selection !== state.avatarSelectionGeneration) return
      if (!previewed) throw new Error('图片无法解码，请重新选择有效图片。')
      state.profileDraftAvatar = avatar
      byId('profile-avatar-status').textContent = '新头像待保存。'
    } catch (error) {
      if (!accountCurrent(token) || selection !== state.avatarSelectionGeneration) return
      byId('profile-avatar-status').textContent = error.message || '无法读取这张图片，请重新选择。'
      byId('profile-avatar-file').value = ''
      void paintAvatar(state.account?.avatar ?? null, token)
    } finally {
      if (accountCurrent(token) && selection === state.avatarSelectionGeneration) {
        state.avatarChecking = false
        profileControls()
      }
    }
  })
  byId('profile-avatar-remove').addEventListener('click', () => {
    if (state.currentView !== 'account') return
    if (!(state.profileDraftAvatar === undefined ? state.account?.avatar : state.profileDraftAvatar)) return
    state.avatarSelectionGeneration++
    state.profileDraftGeneration++
    state.avatarChecking = false
    state.profileDraftAvatar = null
    byId('profile-status').textContent = ''
    byId('profile-avatar-file').value = ''
    byId('profile-avatar-status').textContent = '头像将在保存后移除。'
    errorAt('profile-error', '')
    void paintAvatar(null, accountToken())
    profileControls()
  })
  byId('profile-cancel').addEventListener('click', () => {
    if (state.currentView !== 'account') return
    resetProfileDraft()
    byId('profile-status').textContent = '已取消未保存的修改。'
  })
  byId('profile-reload').addEventListener('click', () => { void refreshProfile({ preserveDraft: true }) })
  byId('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    if (state.profileSaving || state.avatarChecking || state.profileConflict || !profileDirty()) return
    const token = accountToken()
    const operation = ++state.profileOperationGeneration
    const name = byId('profile-display-name').value.normalize('NFKC').trim()
    if (!name || Array.from(name).length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
      return errorAt('profile-error', '昵称须为 1–64 个字符，不能包含控制字符。')
    }
    const revision = state.account?.profileRevision
    if (!Number.isSafeInteger(revision)) return errorAt('profile-error', '资料版本不可用，请读取最新资料后重试。')
    const body = { expectedRevision: revision }
    if (name !== profileName()) body.displayName = name
    if (state.profileDraftAvatar !== undefined) body.avatar = state.profileDraftAvatar
    if (!Object.hasOwn(body, 'displayName') && !Object.hasOwn(body, 'avatar')) return resetProfileDraft()
    state.profileSaving = true
    profileControls()
    errorAt('profile-error', '')
    byId('profile-status').textContent = '正在保存资料…'
    try {
      const result = await api('/profile', { method: 'PATCH', protectedWrite: true, body })
      if (!accountCurrent(token)) return
      if (result?.account?.profileRevision !== revision + 1) throw { code: 'REQUEST_FAILED' }
      const readback = await api('/me')
      if (!accountCurrent(token)) return
      if (readback?.account?.ownerId !== token.ownerId || readback?.device?.id !== token.deviceId
        || readback.account.profileRevision !== revision + 1) throw { code: 'REQUEST_FAILED' }
      if (Object.hasOwn(body, 'displayName') && readback.account.displayName !== name) throw { code: 'REQUEST_FAILED' }
      if (Object.hasOwn(body, 'avatar')) {
        const currentAvatar = readback.account.avatar
        if (body.avatar === null ? currentAvatar !== null
          : currentAvatar?.mimeType !== body.avatar.mimeType || currentAvatar?.dataBase64 !== body.avatar.dataBase64) {
          throw { code: 'REQUEST_FAILED' }
        }
      }
      state.account = readback.account
      state.profileDraftAvatar = undefined
      resetProfileDraft()
      byId('profile-status').textContent = '资料已保存，并从账户重新读取确认。'
    } catch (error) {
      if (!accountCurrent(token)) return
      byId('profile-status').textContent = ''
      if (error.code === 'UNAUTHORIZED') return sessionExpired()
      if (error.code === 'REQUEST_CONFLICT' || error.status === 409) {
        state.profileConflict = true
        byId('profile-reload').hidden = false
        errorAt('profile-error', '资料已被其他设备修改。当前草稿已保留；请读取最新资料并核对，再决定是否保存。')
      } else errorAt('profile-error', '资料未确认保存。请读取最新资料核对后再试，当前草稿已保留。')
    } finally {
      if (accountCurrent(token) && operation === state.profileOperationGeneration) { state.profileSaving = false; profileControls() }
    }
  })
  byId('devices-refresh').addEventListener('click', refreshDevices)
  byId('projects-refresh').addEventListener('click', () => { void refreshProjects() })
  byId('browser-workspace-refresh').addEventListener('click', () => { void refreshBrowserWorkspace() })
  byId('browser-model-select').addEventListener('change', renderBrowserModels)
  byId('browser-workspace-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!state.browserAvailable || !state.browserHostId) return
    const token = accountToken(), status = byId('browser-workspace-status')
    status.hidden = false
    const goal = byId('browser-goal').value.trim()
    const urls = byId('browser-url-list').value.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
    const modelProfileId = byId('browser-model-select').value
    if (!goal || goal.length > 6000 || /https?:\/\//iu.test(goal) || urls.length < 1 || urls.length > 5 ||
        !state.models.some((item) => item.id === modelProfileId)) {
      status.textContent = '请填写目标和1–5条单独列出的公共链接；目标中不要重复贴链接。'; return
    }
    if (urls.some((value) => { try { const parsed = new URL(value); return !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username || parsed.password || new TextEncoder().encode(value).length > 2048 } catch { return true } })) {
      status.textContent = '链接须是完整的公共 HTTP/HTTPS 地址，且不能包含账号密码。'; return
    }
    if (new TextEncoder().encode(`${goal}\n\n网页链接：\n${urls.join('\n')}`).length > 8192) {
      status.textContent = '目标和链接合计过长，请缩短后重试。'; return
    }
    const previous = savedBrowserIntent()
    if (previous && (previous.goal !== goal || previous.modelProfileId !== modelProfileId ||
        JSON.stringify(previous.urls) !== JSON.stringify(urls))) {
      status.textContent = '上一项网页任务仍待核对，请保留原目标与模型，避免重复派发。'; return
    }
    const intent = previous || { ownerId: state.ownerId, hostId: state.browserHostId,
      goal, urls, modelProfileId, sessionRequestId: crypto.randomUUID(), messageRequestId: crypto.randomUUID() }
    try { localStorage.setItem(browserIntentKey(), JSON.stringify(intent)) }
    catch { status.textContent = '无法安全保存请求编号，暂不能发送。'; return }
    const button = byId('browser-workspace-form').querySelector('button[type="submit"]')
    button.disabled = true
    try { if (accountCurrent(token)) await reconcileBrowserIntent(intent, status) }
    finally { if (accountCurrent(token)) button.disabled = false }
  })
  byId('project-register-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!state.projectCanManage) return
    const token = accountToken()
    const name = byId('project-name').value.trim().normalize('NFC')
    const rootPath = byId('project-root').value.trim()
    const status = byId('project-register-status')
    if (!name || !rootPath) { status.textContent = '请填写项目名称和电脑资料目录。'; return }
    const pending = state.projectPending?.name === name && state.projectPending?.rootPath === rootPath
      ? state.projectPending : { name, rootPath, requestId: crypto.randomUUID() }
    state.projectPending = pending
    const button = byId('project-register-form').querySelector('button[type="submit"]')
    button.disabled = true
    status.textContent = '正在登记并核对目录…'
    try {
      const payload = await accessApi('/projects', { method: 'POST', protectedWrite: true,
        body: { requestId: pending.requestId, name, rootPath } })
      if (!accountCurrent(token) || state.projectPending !== pending) return
      if (!payload?.project?.projectId) throw { code: 'REQUEST_FAILED' }
      state.projectPending = null
      byId('project-name').value = ''
      byId('project-root').value = ''
      status.textContent = '项目已登记。手机同账户现在可以选择它。'
      void refreshProjects()
    } catch (error) {
      if (!accountCurrent(token) || state.projectPending !== pending) return
      if (error.code !== 'NETWORK') state.projectPending = null
      status.textContent = error.code === 'NETWORK'
        ? '送达结果不明。草稿与请求编号已保留；可用原信息重试或先刷新项目核对。'
        : error.code === 'PROJECT_UNSAFE_PATH' || error.code === 'PROJECT_ROOT_CHANGED'
          ? '目录无法安全读取，请选择普通本地资料目录后重试。'
          : error.code === 'FORBIDDEN' ? '只有原电脑账户可以登记目录。'
            : '登记未完成，请检查目录并重试。'
    } finally { if (accountCurrent(token)) button.disabled = false }
  })
  byId('account-models-refresh').addEventListener('click', () => { void refreshAccountModels() })
  byId('account-model-cancel').addEventListener('click', () => {
    state.accountModelEditing = null
    byId('account-model-form').reset()
    byId('account-model-submit').textContent = '保存到电脑账户'
    byId('account-model-cancel').hidden = true
    byId('account-model-form-status').textContent = ''
  })
  byId('account-model-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const token = accountToken()
    const error = byId('account-model-form-status')
    if (!accountCurrent(token) || !state.accountModelsCanManage || state.accountModelBusy) {
      error.textContent = '账户状态正在变化；请核对后重试。'; return
    }
    const name = byId('account-model-name').value.trim().normalize('NFC')
    const baseUrl = byId('account-model-base-url').value.trim()
    const modelId = byId('account-model-id').value.trim()
    const modelTier = byId('account-model-tier').value
    const apiKey = byId('account-model-key').value
    if (!name || !/^[A-Za-z0-9._:/-]{1,128}$/.test(modelId) || !baseUrl) {
      error.textContent = '请填写名称、提供方地址和有效模型 ID。'; return
    }
    let route
    try { route = new URL(baseUrl) } catch { error.textContent = '请输入完整的模型服务地址。'; return }
    if (!['http:', 'https:'].includes(route.protocol) || route.username || route.password || route.search || route.hash ||
        !route.pathname.replace(/\/+$/, '').endsWith('/v1')) {
      error.textContent = '请输入 HTTPS 或本机/局域网 HTTP 的 /v1 地址，不能包含账号、参数或片段。'; return
    }
    const editing = state.accountModelEditing
    const priorModel = editing && state.accountModels.find((item) => item.accountModelId === editing.id)
    if (editing && (!priorModel || priorModel.revision !== editing.revision)) {
      error.textContent = '配置修订已变化，请先刷新目录，表单内容仍保留。'; return
    }
    if ((!editing || priorModel?.baseUrl !== baseUrl) && !apiKey) {
      error.textContent = '新建或更换服务地址时，请输入该地址的密钥。'; return
    }
    const kind = editing ? 'update' : 'create'
    const existing = savedAccountModelMarker()
    if (existing && (existing.kind !== kind || existing.accountModelId !== (editing?.id ?? undefined) ||
        existing.name !== name || existing.baseUrl !== baseUrl || existing.modelId !== modelId ||
        (existing.modelTier ?? 'auto') !== modelTier ||
        existing.expectedRevision !== (editing?.revision ?? undefined))) {
      error.textContent = '上一项账户模型操作仍待核对；请保持原输入并刷新请求状态。'; return
    }
    const marker = existing || { ownerId: state.ownerId, hostId: state.hostId,
      requestId: crypto.randomUUID(), kind, ...(editing ? { accountModelId: editing.id,
        expectedRevision: editing.revision } : {}), name, baseUrl, modelId, modelTier }
    if (!storeAccountModelMarker(marker)) {
      error.textContent = '无法保存请求编号，本次没有提交。'; return
    }
    state.accountModelBusy = true
    byId('account-model-submit').disabled = true
    error.textContent = '正在核对原请求并保存配置…'
    try {
      const known = await accountModelReceipt(marker, token)
      if (!accountCurrent(token)) return
      if (!known?.operation) {
        const body = { requestId: marker.requestId, ...(editing ? { expectedRevision: editing.revision } : {}),
          name, baseUrl, modelId, ...(marker.modelTier !== undefined ? { modelTier } : {}), ...(apiKey ? { apiKey } : {}) }
        const result = await accessApi(editing
          ? `/account/models/${encodeURIComponent(editing.id)}` : '/account/models', {
          method: editing ? 'PATCH' : 'POST', protectedWrite: true, body })
        if (!accountCurrent(token) || result?.operation?.requestId !== marker.requestId)
          throw { code: 'MODEL_RECEIPT_INVALID' }
      }
      const settled = await accountModelReceipt(marker, token)
      if (!accountCurrent(token)) return
      if (settled?.operation?.status === 'succeeded') {
        byId('account-model-form').reset()
        state.accountModelEditing = null
        byId('account-model-submit').textContent = '保存到电脑账户'
        byId('account-model-cancel').hidden = true
        error.textContent = '配置已保存。测试连接需单独点击；尚未发送推理消息。'
      } else error.textContent = '请求正在核对，原编号和输入仍保留。'
    } catch (failure) {
      if (accountCurrent(token)) error.textContent = failure.code === 'NETWORK'
        ? '送达结果不明，原请求编号与输入仍保留；请刷新核对。'
        : failure.code === 'REQUEST_CONFLICT' ? '原请求内容或配置修订不同；请先核对原操作。'
          : '配置未完成；密钥仍留在本页输入框中供你核对。'
    } finally {
      if (accountCurrent(token)) { state.accountModelBusy = false; byId('account-model-submit').disabled = false;
        renderAccountModels() }
    }
  })
  byId('account-back').addEventListener('click', () => { resetProfileDraft(); state.deviceEditing = null; void enterAssistant() })
  function openAccount() {
    stopAssistantRefresh(); closeRail(); show('account')
    state.deviceEditing = null
    resetProfileDraft()
    void cloudUi?.refreshBinding()
    void refreshProfile()
    void refreshDevices()
    resetOtherDeviceInstall()
    void refreshAccountModels()
    void refreshProjects()
    void refreshModels()
    void refreshBrowserWorkspace()
  }
  byId('rail-account').addEventListener('click', openAccount)
  byId('show-account').addEventListener('click', openAccount)
  async function openMemory() {
    if (state.currentView === 'memory') { memory.viewGeneration++; closeMemoryDetail() }
    memory.queryGeneration++
    const entryGeneration = ++memory.entryGeneration
    stopAssistantRefresh()
    closeRail()
    show('memory')
    const token = memoryIdentity()
    memory.kind = byId('memory-kind').value
    memory.query = byId('memory-query').value.trim().normalize('NFKC')
    invalidateMemorySnapshot('正在读取记忆…', false)
    if (!state.hostId) {
      try {
        const host = await accessApi('/status')
        if (!memoryViewCurrent(token) || entryGeneration !== memory.entryGeneration) return
        if (host?.ownerId !== token.ownerId || typeof host.hostId !== 'string') {
          clearSession(); show('login'); toast('账户身份已变化，请重新登录核对。'); return
        }
        state.hostId = host.hostId
      } catch (error) {
        if (!memoryViewCurrent(token)) return
        invalidateMemorySnapshot('暂时无法确认宿主身份，管理操作不可用。请重试。')
        return
      }
    }
    const initialQueryGeneration = memory.queryGeneration
    const ready = await refreshMemoryStatus()
    if (!memoryViewCurrent(token) || entryGeneration !== memory.entryGeneration) return
    if (ready && initialQueryGeneration === memory.queryGeneration) await loadMemoryPage()
    if (!memoryViewCurrent(token) || entryGeneration !== memory.entryGeneration) return
    await recoverMemoryReceipt()
  }
  byId('rail-memory').addEventListener('click', () => { void openMemory() })
  byId('memory-back').addEventListener('click', () => { closeMemoryDetail(); void enterAssistant() })
  byId('memory-search-form').addEventListener('submit', (event) => {
    event.preventDefault()
    const kind = byId('memory-kind').value
    const query = byId('memory-query').value.trim().normalize('NFKC')
    if (!memoryKinds[kind] || query.length > 120) return memoryStatus('请输入不超过 120 个字符的关键词。', true)
    memory.kind = kind
    memory.query = query
    void loadMemoryPage()
  })
  byId('memory-kind').addEventListener('change', () => {
    memory.kind = byId('memory-kind').value
    memory.query = byId('memory-query').value.trim().normalize('NFKC')
    if (memoryKinds[memory.kind] && memory.query.length <= 120) void loadMemoryPage()
  })
  byId('memory-refresh').addEventListener('click', () => { void openMemory() })
  byId('memory-more').addEventListener('click', () => { void loadMemoryPage({ more: true }) })
  byId('memory-receipt-check').addEventListener('click', handleMemoryReceiptAction)
  byId('memory-detail-close').addEventListener('click', closeMemoryDetail)
  byId('memory-detail-dialog').addEventListener('close', () => { if (memory.selected) closeMemoryDetail() })
  byId('memory-detail-back').addEventListener('click', () => { memory.mode = 'detail'; detailError(''); renderMemoryMode() })
  byId('memory-detail-check').addEventListener('click', handleMemoryReceiptAction)
  byId('memory-correct-action').addEventListener('click', () => {
    if (!memoryActionAllowed('correct')) return
    memory.mode = 'correct'; detailError(''); renderMemoryMode(); byId('memory-correct-text').focus()
  })
  byId('memory-mute-action').addEventListener('click', () => {
    if (!memoryActionAllowed('mute')) return
    memory.mode = 'mute'; detailError(''); renderMemoryMode()
  })
  byId('memory-delete-action').addEventListener('click', () => {
    if (!memoryActionAllowed('delete')) return
    memory.mode = 'delete'; detailError(''); renderMemoryMode()
  })
  byId('memory-correct-text').addEventListener('input', () => {
    if (!memory.selected) return
    memory.drafts.set(`${memory.selected.kind}|${memory.selected.id}`, byId('memory-correct-text').value)
    detailError('')
  })
  byId('memory-confirm-action').addEventListener('click', () => { void submitMemoryAction() })
  byId('rail-open').addEventListener('click', () => {
    if (window.WeftDesktop && !window.matchMedia?.('(max-width: 640px)').matches) { window.WeftDesktop.toggleRail(); return }
    window.WeftDesktop?.toggleRail(false)
    byId('session-rail').classList.add('is-open')
    byId('rail-backdrop').hidden = false
    byId('rail-open').setAttribute('aria-expanded', 'true')
  })
  byId('load-older').addEventListener('click', () => { void loadOlderHistory() })
  byId('chat-scroll').addEventListener('scroll', () => { if (byId('chat-scroll').scrollTop < 40) void loadOlderHistory() })
  byId('rail-close').addEventListener('click', () => { closeRail(); window.WeftDesktop?.toggleRail(true) })
  byId('rail-backdrop').addEventListener('click', closeRail)
  byId('show-phone').addEventListener('click', () => { void showPhonePane() })
  byId('rail-phone').addEventListener('click', () => { void showPhonePane() })
  byId('phone-back').addEventListener('click', () => showConversation())
  byId('phone-refresh').addEventListener('click', () => { void refreshPhoneRecords() })
  byId('phone-more').addEventListener('click', () => { void refreshPhoneRecords() })
  byId('model-select').addEventListener('change', (event) => { state.modelProfileId = event.target.value; updateAvailability() })
  byId('model-trigger').addEventListener('click', openModelMenu)
  byId('model-trigger').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (byId('model-popover').hidden) openModelMenu() }
  })
  byId('model-options').addEventListener('keydown', (event) => {
    const options = [...byId('model-options').children], index = options.indexOf(event.target)
    if (event.key === 'Escape') { event.preventDefault(); closeModelMenu(true); return }
    if (!options.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
    options[next].focus()
  })
  byId('model-configure').addEventListener('click', () => { closeModelMenu(); openAccount() })
  byId('voice-input').addEventListener('click', startVoiceInput)
  window.addEventListener('resize', () => closeModelMenu())
  document.addEventListener('click', (event) => {
    if (!byId('model-popover').hidden && !byId('model-picker').contains(event.target)) closeModelMenu()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !byId('model-popover').hidden) { event.preventDefault(); closeModelMenu(true) }
  })
  byId('message-text').addEventListener('input', updateAvailability)
  function addAttachmentFiles(selected) {
    const key = attachmentDraftKey()
    if (!key || state.activeChatSource !== 'desktop' || state.attachmentUpload || selected.length === 0) return
    const drafts = [...currentAttachmentDrafts()]
    let rejected = 0
    for (const file of selected) {
      if (drafts.length >= 4 || !(file instanceof Blob) || !validAttachmentName(file.name) ||
        !Number.isSafeInteger(file.size) || file.size < 1 || file.size > originalAttachmentBytes) {
        rejected++
        continue
      }
      const contentType = attachmentMime(file)
      const duplicate = drafts.some((item) => item.file.name === file.name && item.file.size === file.size &&
        item.file.lastModified === file.lastModified && item.contentType === contentType)
      if (duplicate) { rejected++; continue }
      drafts.push({ attachmentId: `attachment-${crypto.randomUUID()}`, file, contentType, sha256: null })
    }
    if (drafts.length) state.attachmentDrafts.set(key, drafts)
    invalidateAttachmentAttempt(key)
    state.attachmentStatus = rejected ? '部分文件未添加：每次最多 4 个，单个须为 1 B–1 GiB，名称不能含路径字符。' : ''
    renderAttachmentDrafts()
    updateAvailability()
  }
  byId('message-attachments').addEventListener('change', (event) => {
    const input = event.currentTarget, selected = [...(input.files || [])]
    input.value = ''; addAttachmentFiles(selected)
  })
  byId('attachment-cancel').addEventListener('click', () => cancelAttachmentUpload(true))
  byId('new-session').addEventListener('click', async () => {
    if (!state.modelProfileId || state.capabilities?.chat?.available !== true) return
    closeRail()
    await submitCommand('session.create', { modelProfileId: state.modelProfileId })
  })
  function composerInputMode(sessionId) {
    return state.sessions.find(item => item.sessionId === sessionId)?.running ? byId('message-mode').value || 'steer' : 'queue'
  }
  async function sendDraft() {
    if (state.activeChatSource === 'phone') return sendPhoneMessage()
    const text = byId('message-text').value
    const attachments = currentAttachmentDrafts()
    if ((!text.trim() && attachments.length === 0) || !state.selectedSessionId || state.unresolvedSubmission ||
      state.capabilities?.chat?.available !== true ||
      state.sessions.find((item) => item.sessionId === state.selectedSessionId)?.sendAvailable !== true) return
    if (attachments.length) return sendDesktopMessageWithAttachments(text)
    const sent = await submitCommand('session.message', { sessionId: state.selectedSessionId, text,
      mode: composerInputMode(state.selectedSessionId) }, state.selectedSessionId)
    if (sent) { byId('message-text').value = ''; updateAvailability() }
  }
  byId('message-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    if (event.submitter?.id === 'send-message' && byId('send-message').dataset.action === 'stop') return stopCurrentTurn()
    return sendDraft()
  })
  async function stopCurrentTurn() {
    const session = state.activeChatSource === 'phone' ? phoneBinding()?.sessionId : state.selectedSessionId
    if (session && state.sessions.find(item => item.sessionId === session)?.running && !state.cancelSubmitting)
      await submitCommand('session.cancel', { sessionId: session }, session)
  }
  byId('cancel-turn').addEventListener('click', stopCurrentTurn)
  window.WeftDesktop?.init({ renderSessions, openAccount, sendDraft, addFiles: addAttachmentFiles,
    stop: stopCurrentTurn, isAssistant: () => state.currentView === 'assistant' })
  if (window.WeftDesktop) setInterval(() => { if (state.currentView === 'assistant' && state.turnStatus === 'running') renderTurnStatus() }, 1000)
  byId('open-notepad').addEventListener('click', async () => {
    const blocker = desktopBlocker()
    if (blocker) {
      showConversation()
      if (blocker.commandId && !state.tasks.some((item) => item.commandId === blocker.commandId)) {
        try {
          const payload = await accessApi(`/commands/${encodeURIComponent(blocker.commandId)}`)
          if (payload.command) { state.tasks.unshift(payload.command); renderConversationTasks(); updateAvailability() }
        } catch { /* The task pane can still show its cached record or refresh state. */ }
      }
      return
    }
    if (state.capabilities?.desktopOpenApp?.available !== true ||
      !state.capabilities.desktopOpenApp.appIds?.includes('notepad')) return
    await submitCommand('desktop.open_app', { appId: 'notepad' })
  })
  byId('reset-operation').addEventListener('click', () => {
    const requestId = state.reviewRequestId
    if (!requestId) return
    if (requestId) forgetMarker(requestId)
    byId('message-text').value = ''
    operation('请先核对原请求，再重新输入你的目标。', false, requestId)
    updateAvailability()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !byId('assistant-view').hidden) void refreshAssistant()
    else if (document.visibilityState === 'visible' && !byId('memory-view').hidden) void openMemory()
  })
  window.addEventListener('online', () => { if (!byId('assistant-view').hidden) void refreshAssistant() })
  window.addEventListener('online', () => { if (!byId('memory-view').hidden) void openMemory() })
  byId('logout-button').addEventListener('click', async () => {
    const button = byId('logout-button')
    const token = accountToken()
    button.disabled = true
    try {
      await api('/logout', { method: 'POST', protectedWrite: true })
      if (!accountIdentityCurrent(token)) return
      clearSession()
      show('login')
      toast('已退出当前设备。')
    } catch (error) {
      if (!accountIdentityCurrent(token)) return
      if (error.code === 'UNAUTHORIZED') sessionExpired()
      else toast(failureMessage(error))
    } finally { button.disabled = false }
  })
  byId('password-open').addEventListener('click', () => byId('password-dialog').showModal())
  byId('password-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const token = accountToken()
    let completionToken = null
    errorAt('password-error', '')
    const currentPassword = byId('current-password').value
    const newPassword = byId('new-password').value
    const confirmation = byId('new-confirm').value
    if (Array.from(newPassword).length < 15 || Array.from(newPassword).length > 128) return errorAt('password-error', '新密码须为 15–128 个字符。')
    if (newPassword !== confirmation) return errorAt('password-error', '两次输入的新密码不一致。')
    if (!currentPassword) return errorAt('password-error', '请输入当前密码。')
    setBusy(form, true)
    try {
      const changed = await api('/change-password', { method: 'POST', protectedWrite: true, body: { currentPassword, newPassword } })
      if (!accountIdentityCurrent(token)) return
      acceptSession(changed)
      completionToken = accountToken()
      byId('password-dialog').close()
      toast('密码已修改，其他设备需要重新登录。')
      await refreshDevices()
    } catch (error) {
      if (!accountIdentityCurrent(token)) return
      if (error.code === 'UNAUTHORIZED') sessionExpired()
      else errorAt('password-error', failureMessage(error))
    } finally { if (accountIdentityCurrent(completionToken ?? token)) { clearPasswords('current-password', 'new-password', 'new-confirm'); setBusy(form, false) } }
  })
  byId('revoke-confirm').addEventListener('click', async () => {
    if (!state.revokeId) return
    const button = byId('revoke-confirm')
    const token = accountToken()
    const revokeId = state.revokeId
    button.disabled = true
    errorAt('revoke-error', '')
    try {
      const result = await api(`/devices/${encodeURIComponent(revokeId)}`, { method: 'DELETE', protectedWrite: true })
      if (!accountCurrent(token) || state.revokeId !== revokeId) return
      if (result?.revoked !== true) throw { code: 'REQUEST_FAILED' }
      byId('revoke-dialog').close()
      state.revokeId = null
      state.deviceNotice = '设备撤销已收到宿主回执。'
      await refreshDevices()
    } catch (error) {
      if (!accountCurrent(token) || state.revokeId !== revokeId) return
      if (error.code === 'UNAUTHORIZED') sessionExpired()
      else errorAt('revoke-error', '撤销未确认成功，请检查连接后重试。')
    } finally { button.disabled = false }
  })
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => byId(button.dataset.close).close())
  byId('password-dialog').addEventListener('close', () => clearPasswords('current-password', 'new-password', 'new-confirm'))
  for (const button of document.querySelectorAll('.reveal')) button.addEventListener('click', () => {
    const input = byId(button.dataset.target)
    const revealed = input.type === 'password'
    input.type = revealed ? 'text' : 'password'
    button.textContent = revealed ? '隐藏' : '显示'
    button.setAttribute('aria-label', revealed ? '隐藏密码' : '显示密码')
  })
  window.addEventListener('hashchange', () => {
    const grant = takeSetupGrant()
    if (grant) { state.setupGrant = grant; void load() }
  })
  const cloudUi = globalThis.WeftCloudUi?.create({ acceptSession, enterAssistant, openAccount, show, accessApi, toast })
  if (cloudUi) void cloudUi.boot().then(handled => { if (!handled) void load() })
  else void load()
  setInterval(() => { if (state.account && document.visibilityState === 'visible') void refreshPendingDevices() }, 15000)
})()
