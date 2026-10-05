(() => {
  'use strict'

  const OFFICIAL_SITE = 'https://www.weftmate.com/downloads/'
  const WEB_ENTRY = 'https://home.weftmate.com:8443/personal/v1/ui'
  const PLATFORM_IDS = ['macos', 'android', 'windows', 'ios', 'watchos']
  const PLATFORM_OS_NAMES = { macos: 'macOS', android: 'Android', windows: 'Windows', ios: 'iOS', watchos: 'watchOS' }
  const RECOMMENDATION = recommendedPlatform()
  const byId = (id) => document.getElementById(id)
  const tabs = [...document.querySelectorAll('[data-platform]')]
  const state = { platforms: new Map(), selected: null, manifest: null, qrGeneration: 0 }

  function recommendedPlatform() {
    const ua = navigator.userAgent || ''
    const platform = navigator.userAgentData?.platform || navigator.platform || ''
    if (/Android/i.test(ua)) return 'android'
    if (/iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
    if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return 'macos'
    if (/Windows/i.test(platform) || /Windows/i.test(ua)) return 'windows'
    if (/Watch/i.test(ua)) return 'watchos'
    return null
  }

  function safeText(value, max = 300) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  }

  function validateLandingUrl(value, id, siteUrl) {
    if (typeof value !== 'string') return null
    try {
      const url = new URL(value)
      const site = new URL(siteUrl)
      if (url.protocol !== 'https:' || url.origin !== site.origin || url.pathname !== site.pathname ||
          url.hash || url.username || url.password || url.searchParams.size !== 1 ||
          url.searchParams.get('platform') !== id) return null
      return url.href
    } catch { return null }
  }

  function validateQrUrl(value, id) {
    if (value !== `qr/${id}.svg`) return null
    const url = new URL(value, window.location.href)
    const root = new URL('./', window.location.href)
    return url.origin === root.origin && url.pathname === `${root.pathname}qr/${id}.svg` && !url.search && !url.hash
      ? url.href : null
  }

  function validateDownloadUrl(value, sha256) {
    if (typeof value !== 'string' || value.includes('\\') || value.includes('?') || value.includes('#')) return null
    const match = /^files\/([a-f0-9]{64})-([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(value)
    if (!match || match[1] !== sha256 || match[2].includes('..')) return null
    const url = new URL(value, window.location.href)
    const root = new URL('./', window.location.href)
    return url.origin === root.origin && url.pathname.startsWith(`${root.pathname}files/`) && !url.search && !url.hash
      ? url.href : null
  }

  function validateRelease(platform) {
    if (!platform || typeof platform !== 'object' || Array.isArray(platform) ||
        !PLATFORM_IDS.includes(platform.id) || !safeText(platform.name, 40) ||
        !['available', 'unavailable', 'web'].includes(platform.status)) return null
    const landingUrl = validateLandingUrl(platform.landingUrl, platform.id, state.manifest.siteUrl)
    const qrUrl = validateQrUrl(platform.qrUrl, platform.id)
    if (!landingUrl || !qrUrl) return null
    const optionalNotes = platform.notes === undefined ||
      (typeof platform.notes === 'string' && platform.notes.length <= 1000 &&
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(platform.notes))
    if (!optionalNotes) return null

    if (platform.status === 'available') {
      if (typeof platform.version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(platform.version) ||
          typeof platform.build !== 'string' || !/^\d+(?:\.\d+){0,2}$/.test(platform.build) ||
          !['universal', 'x86_64', 'arm64', 'arm64-v8a', 'armeabi-v7a'].includes(platform.architecture) ||
          !Number.isSafeInteger(platform.bytes) || platform.bytes < 1 || platform.bytes > 1024 * 1024 * 1024 ||
          typeof platform.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(platform.sha256)) return null
      const downloadUrl = validateDownloadUrl(platform.downloadUrl, platform.sha256)
      if (!downloadUrl) return null
      return { ...platform, landingUrl, qrUrl, downloadUrl }
    }

    const forbidden = ['version', 'build', 'architecture', 'bytes', 'sha256', 'downloadUrl']
    if (forbidden.some((key) => Object.hasOwn(platform, key))) return null
    if (platform.status === 'web') {
      if (platform.id !== 'windows' || platform.webUrl !== WEB_ENTRY) return null
      return { ...platform, landingUrl, qrUrl, webUrl: WEB_ENTRY }
    }
    if (platform.webUrl !== undefined) return null
    return { ...platform, landingUrl, qrUrl }
  }

  function validateManifest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 ||
        value.siteUrl !== OFFICIAL_SITE || !Array.isArray(value.platforms) || value.platforms.length !== PLATFORM_IDS.length ||
        !safeText(value.generatedAt, 80)) throw new Error('Manifest shape is invalid')
    state.manifest = value
    const platforms = value.platforms.map(validateRelease)
    if (platforms.some((item) => item === null) || new Set(platforms.map((item) => item.id)).size !== PLATFORM_IDS.length ||
        PLATFORM_IDS.some((id) => !platforms.some((item) => item.id === id))) throw new Error('Platform release data is invalid')
    return platforms
  }

  function relativeSize(bytes) {
    const megabytes = bytes / 1_000_000
    return `${megabytes.toFixed(1)} MB`
  }

  function architectureLabel(platform) {
    const labels = {
      macos: { universal: 'Intel / Apple 芯片', x86_64: 'Intel Mac', arm64: 'Apple 芯片' },
      android: { universal: '通用版', arm64: 'ARM64 Android', 'arm64-v8a': 'ARM64 Android', 'armeabi-v7a': '32-bit ARM Android' },
    }
    return labels[platform.id]?.[platform.architecture] || platform.architecture
  }

  function detail(label, value) {
    const wrapper = document.createElement('div')
    wrapper.className = 'detail-item'
    const term = document.createElement('dt')
    term.textContent = label
    const description = document.createElement('dd')
    description.textContent = value
    wrapper.append(term, description)
    return wrapper
  }

  function clearActions() {
    const download = byId('download-action')
    const web = byId('web-action')
    download.hidden = true
    download.removeAttribute('href')
    download.removeAttribute('download')
    web.hidden = true
    web.removeAttribute('href')
    byId('release-details').replaceChildren()
    byId('release-notes').textContent = ''
    byId('release-notes').hidden = true
  }

  function updateLocation(id, push = true) {
    const url = new URL(window.location.href)
    url.searchParams.set('platform', id)
    if (push) history.pushState({ platform: id }, '', url)
    else history.replaceState({ platform: id }, '', url)
  }

  function renderQr(platform) {
    const frame = byId('qr-frame')
    const fallback = byId('qr-unavailable')
    const copy = byId('copy-link')
    const link = byId('landing-link')
    const token = ++state.qrGeneration
    const image = document.createElement('img')
    image.id = 'platform-qr'
    image.width = 192
    image.height = 192
    image.loading = 'eager'
    image.hidden = true
    fallback.hidden = false
    fallback.textContent = '正在读取此平台二维码…'
    image.alt = `WeftMate ${platform.name} 下载页二维码`
    image.onload = () => {
      if (state.qrGeneration !== token || state.selected !== platform.id) return
      image.hidden = false
      fallback.hidden = true
    }
    image.onerror = () => {
      if (state.qrGeneration !== token || state.selected !== platform.id) return
      image.hidden = true
      fallback.textContent = '二维码暂时无法读取，请复制页面链接。'
      fallback.hidden = false
    }
    frame.replaceChildren(image, fallback)
    image.src = platform.qrUrl
    link.href = platform.landingUrl
    link.textContent = platform.landingUrl
    link.hidden = false
    copy.disabled = false
    byId('copy-status').textContent = ''
  }

  function renderPlatform(id) {
    const platform = state.platforms.get(id)
    if (!platform) return
    state.selected = id
    tabs.forEach((tab) => {
      const selected = tab.dataset.platform === id
      const recommended = tab.dataset.platform === RECOMMENDATION
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      tab.setAttribute('aria-label', `${platformName(tab.dataset.platform)}${recommended ? `，识别到 ${PLATFORM_OS_NAMES[tab.dataset.platform]}` : ''}`)
    })

    const stateLabel = platform.status === 'available' ? '可下载'
      : platform.status === 'web' ? '网页版' : '暂未分发'
    byId('platform-state').textContent = stateLabel
    byId('platform-state').dataset.status = platform.status
    byId('selected-platform').textContent = platform.name
    byId('recommendation').textContent = id === RECOMMENDATION ? `识别到 ${PLATFORM_OS_NAMES[id]}` : ''
    byId('recommendation').hidden = id !== RECOMMENDATION
    byId('release-summary').textContent = platform.status === 'available'
      ? '官方下载包已发布。'
      : platform.status === 'web'
        ? 'Windows 可通过现有网页版使用 WeftMate。'
        : `${platform.name} 安装包暂未分发。`
    byId('availability-note').textContent = platform.status === 'available'
      ? '公开安装包可直接下载，无需登录。'
      : platform.status === 'web' ? '打开后可在网页版登录使用。' : '此平台目前没有可下载的安装包。'
    clearActions()
    if (platform.status === 'available') {
      const fileName = platform.downloadUrl.split('/').pop()
      byId('download-action').href = platform.downloadUrl
      byId('download-action').download = fileName
      byId('download-action').textContent = id === 'macos' ? '下载 Mac 安装包'
        : id === 'android' ? '下载 Android 安装包' : `下载 ${platform.name} 安装包`
      byId('download-action').hidden = false
      byId('release-details').append(
        detail('版本', platform.version),
        detail('构建', platform.build),
        detail('架构', architectureLabel(platform)),
        detail('文件大小', relativeSize(platform.bytes)),
      )
      if (platform.notes) {
        byId('release-notes').textContent = platform.notes
        byId('release-notes').hidden = false
      }
    } else if (platform.status === 'web') {
      byId('web-action').href = platform.webUrl
      byId('web-action').hidden = false
      if (platform.notes) {
        byId('release-notes').textContent = platform.notes
        byId('release-notes').hidden = false
      }
    } else if (platform.notes) {
      byId('release-notes').textContent = platform.notes
      byId('release-notes').hidden = false
    }
    renderQr(platform)
  }

  function platformName(id) {
    const platform = state.platforms.get(id)
    return platform?.name || ({ macos: 'Mac', android: 'Android', windows: 'Windows', ios: 'iPhone', watchos: 'Apple Watch' }[id] || id)
  }

  function selectPlatform(id, update = true) {
    if (!state.platforms.has(id)) return
    if (update) updateLocation(id)
    renderPlatform(id)
  }

  async function copyLandingUrl() {
    const platform = state.platforms.get(state.selected)
    if (!platform) return
    try {
      await navigator.clipboard.writeText(platform.landingUrl)
      byId('copy-status').textContent = '已复制平台页面链接。'
    } catch {
      const helper = document.createElement('textarea')
      helper.value = platform.landingUrl
      helper.setAttribute('readonly', '')
      helper.style.position = 'fixed'
      helper.style.opacity = '0'
      document.body.append(helper)
      helper.select()
      const copied = document.execCommand('copy')
      helper.remove()
      byId('copy-status').textContent = copied ? '已复制平台页面链接。' : '复制失败，请长按上方链接复制。'
    }
  }

  function chooseInitialPlatform() {
    const requested = new URL(window.location.href).searchParams.get('platform')
    if (PLATFORM_IDS.includes(requested) && state.platforms.has(requested)) return requested
    if (RECOMMENDATION && state.platforms.has(RECOMMENDATION)) return RECOMMENDATION
    return PLATFORM_IDS.find((id) => state.platforms.has(id))
  }

  async function loadManifest() {
    byId('loading-state').hidden = false
    byId('error-state').hidden = true
    byId('platform-picker').hidden = true
    byId('release-panel').hidden = true
    try {
      const response = await fetch('./releases.json', { cache: 'no-store', credentials: 'omit', mode: 'same-origin' })
      if (!response.ok) throw new Error('Release manifest is unavailable')
      const manifest = await response.json()
      const platforms = validateManifest(manifest)
      state.platforms = new Map(platforms.map((platform) => [platform.id, platform]))
      tabs.forEach((tab) => {
        const id = tab.dataset.platform
        const isRecommended = id === RECOMMENDATION
        tab.disabled = !state.platforms.has(id)
        tab.dataset.recommended = String(isRecommended)
        tab.setAttribute('aria-label', `${platformName(id)}${isRecommended ? `，识别到 ${PLATFORM_OS_NAMES[id]}` : ''}`)
      })
      byId('loading-state').hidden = true
      byId('platform-picker').hidden = false
      const initial = chooseInitialPlatform()
      if (!initial) throw new Error('No platform releases found')
      const requested = new URL(window.location.href).searchParams.get('platform')
      if (requested !== initial) updateLocation(initial, false)
      renderPlatform(initial)
      byId('release-panel').hidden = false
    } catch {
      byId('loading-state').hidden = true
      byId('error-message').textContent = '暂时无法读取官方发布清单，因此现在不能确认各平台的版本和下载状态。请稍后重试。'
      byId('error-state').hidden = false
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectPlatform(tab.dataset.platform))
    tab.addEventListener('keydown', (event) => {
      let next = index
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = tabs.length - 1
      else return
      event.preventDefault()
      tabs[next].focus()
      selectPlatform(tabs[next].dataset.platform)
    })
  })
  byId('copy-link').addEventListener('click', () => { void copyLandingUrl() })
  byId('retry-button').addEventListener('click', () => { void loadManifest() })
  window.addEventListener('popstate', () => {
    const requested = new URL(window.location.href).searchParams.get('platform')
    if (state.platforms.has(requested)) renderPlatform(requested)
  })
  void loadManifest()
})()
