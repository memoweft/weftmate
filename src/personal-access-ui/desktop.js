/* Desktop presentation only. All writes remain in app.js and /personal/v1. */
(() => {
  'use strict'
  const byId = id => document.getElementById(id)
  const node = (tag, cls = '', text = '') => { const n = document.createElement(tag); n.className = cls; n.textContent = text; return n }
  const appearanceKey = 'weftmate.desktop.appearance.v1'
  const defaults = { theme: 'system', accent: 'neutral', fontSize: '15' }
  let appearance = { ...defaults }, preview = null, returnFocus = null, actions = null
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  function applyAppearance(value = appearance) {
    appearance = { ...defaults, ...value }
    const root = document.documentElement
    root.dataset.theme = appearance.theme === 'system' ? media?.matches ? 'dark' : 'light' : appearance.theme
    root.dataset.accent = appearance.accent
    root.style.setProperty('--text-size', `${appearance.fontSize}px`)
    for (const key of Object.keys(defaults)) if (byId(`appearance-${key}`)) byId(`appearance-${key}`).value = appearance[key]
  }
  try { applyAppearance(JSON.parse(localStorage.getItem(appearanceKey) || 'null') || defaults) } catch { applyAppearance(defaults) }
  media?.addEventListener?.('change', () => { if (appearance.theme === 'system') applyAppearance() })
  function markdown(text, cls = 'markdown-body') {
    const content = node('div', cls)
    if (window.WeftFormat?.render) content.innerHTML = window.WeftFormat.render(text)
    else content.textContent = text
    // Keep links and images in the workspace; never open a separate window.
    for (const link of content.querySelectorAll('a')) {
      link.removeAttribute('target')
      link.addEventListener('click', e => {
        e.preventDefault()
        let url
        try { url = new URL(link.getAttribute('href'), location.href) } catch { return }
        if (!['https:', 'http:'].includes(url.protocol)) return
        openPreview(link.textContent || '网页', link)
        const description = node('p', 'muted', '查看网页地址，或让助手读取网页内容。')
        const address = node('input'); address.readOnly = true; address.value = url.href; address.setAttribute('aria-label', '网页地址')
        const copy = node('button', 'button secondary small', '复制地址'); copy.type = 'button'
        copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url.href); copy.textContent = '已复制' } catch { copy.textContent = '请选择地址复制' } })
        preview.content.replaceChildren(description, address, copy)
      })
    }
    for (const image of content.querySelectorAll('img')) {
      image.addEventListener('click', () => showImage(image.src, image.alt || '图片', image))
    }
    for (const pre of content.querySelectorAll('pre')) {
      const copy = node('button', 'code-copy', '复制'); copy.type = 'button'
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || ''); copy.textContent = '已复制' } catch { copy.textContent = '请选择文字复制' } })
      pre.append(copy)
    }
    return content
  }
  function fileLabel(file) {
    const ext = (file.fileName || '').split('.').pop().toLowerCase()
    const mime = (file.contentType || '').split(';')[0]
    const type = ({ md: 'Markdown', markdown: 'Markdown', txt: '文本', csv: '表格', json: 'JSON', html: '网页', png: '图片', jpg: '图片', jpeg: '图片', webp: '图片' })[ext]
      || ({ 'text/markdown': 'Markdown', 'text/plain': '文本', 'text/csv': '表格', 'application/json': 'JSON' })[mime] || '文件'
    const size = Number.isFinite(file.size) ? file.size < 1024 ? `${file.size} 字节` : file.size < 1048576 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1048576).toFixed(1)} MB` : ''
    return `${type}${size ? ` · ${size}` : ''}`
  }
  function closePreview(restore = true) {
    preview?.panel.remove(); preview = null
    document.body.classList.remove('preview-open')
    if (restore && returnFocus?.isConnected) returnFocus.focus()
    returnFocus = null
  }
  function openPreview(title, trigger = document.activeElement) {
    closePreview(false); returnFocus = trigger
    const panel = node('aside', 'timeline-preview'); panel.setAttribute('aria-label', '成果与来源预览')
    const resize = node('div', 'preview-resize'); resize.setAttribute('role', 'separator'); resize.setAttribute('aria-orientation', 'vertical'); resize.setAttribute('aria-label', '调整预览宽度'); resize.tabIndex = 0
    const header = node('div', 'preview-heading'), close = node('button', 'button quiet small', '关闭预览'); close.type = 'button'
    close.addEventListener('click', () => closePreview())
    const heading = node('h2', '', title), content = node('div', 'preview-content', '正在读取…')
    header.append(heading, close); panel.append(resize, header, content)
    byId('assistant-view').querySelector('.assistant-shell').append(panel)
    document.body.classList.add('preview-open')
    const width = value => {
      const next = Math.max(280, Math.min(value, window.innerWidth * .6))
      panel.style.width = `${next}px`; resize.setAttribute('aria-valuenow', String(Math.round(next)))
    }
    resize.addEventListener('pointerdown', e => {
      resize.setPointerCapture(e.pointerId); e.preventDefault()
      const move = event => width(window.innerWidth - event.clientX)
      const end = () => { resize.removeEventListener('pointermove', move); resize.removeEventListener('pointerup', end); resize.removeEventListener('pointercancel', end) }
      resize.addEventListener('pointermove', move); resize.addEventListener('pointerup', end); resize.addEventListener('pointercancel', end)
    })
    resize.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); width(panel.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 32 : -32)) } })
    close.focus({ preventScroll: true })
    preview = { panel, content }
    return preview
  }
  function showImage(url, name, trigger) {
    const panel = openPreview(name, trigger), image = node('img', 'preview-image'); image.src = url; image.alt = name
    panel.content.replaceChildren(image)
  }
  function sessionGroup(session, now = new Date()) {
    const stamp = session.updatedAt || session.lastMessageAt || session.createdAt
    if (!stamp || !Number.isFinite(Date.parse(stamp))) return '会话'
    const date = new Date(stamp), today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const days = Math.round((today - day) / 86400000)
    return days <= 0 ? '今天' : days === 1 ? '昨天' : days < 7 ? '7 天内' : '更早'
  }
  function sortSessions(sessions) {
    return [...sessions].sort((a, b) => (Date.parse(b.updatedAt || b.lastMessageAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.lastMessageAt || a.createdAt) || 0))
  }
  function toggleRail(force) {
    const collapsed = force === undefined ? !document.body.classList.contains('rail-collapsed') : force
    document.body.classList.toggle('rail-collapsed', collapsed)
    byId('rail-open').setAttribute('aria-expanded', String(!collapsed))
    if (collapsed) byId('rail-open').focus()
  }
  function init(callbacks) {
    actions = callbacks
    for (const key of Object.keys(defaults)) byId(`appearance-${key}`).addEventListener('change', e => {
      appearance[key] = e.target.value; applyAppearance()
      try { localStorage.setItem(appearanceKey, JSON.stringify(appearance)) } catch { /* device storage can be unavailable */ }
    })
    byId('session-search').addEventListener('input', actions.renderSessions)
    byId('search-sessions').addEventListener('click', () => { toggleRail(false); byId('session-search').focus() })
    byId('account-menu-trigger').addEventListener('click', () => {
      const menu = byId('account-menu'); menu.hidden = !menu.hidden
      byId('account-menu-trigger').setAttribute('aria-expanded', String(!menu.hidden))
      if (!menu.hidden) menu.querySelector('button')?.focus()
    })
    document.addEventListener('click', e => { if (!byId('account-menu').hidden && !byId('account-menu').parentNode.contains(e.target)) { byId('account-menu').hidden = true; byId('account-menu-trigger').setAttribute('aria-expanded', 'false') } })
    byId('rail-devices').addEventListener('click', () => { actions.openAccount(); byId('devices-refresh').scrollIntoView({ block: 'center' }) })
    const input = byId('message-text')
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault(); if (!input.disabled) actions.sendDraft()
      }
    })
    const add = files => { if (!byId('message-attachments').disabled && files.length) actions.addFiles(files) }
    byId('attachment-add').tabIndex = 0
    byId('attachment-add').setAttribute('role', 'button')
    byId('attachment-add').addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); if (!byId('message-attachments').disabled) byId('message-attachments').click() } })
    input.addEventListener('paste', e => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); add(files) } })
    const form = byId('message-form')
    form.addEventListener('dragover', e => { e.preventDefault(); form.classList.add('is-dragging') })
    form.addEventListener('dragleave', () => form.classList.remove('is-dragging'))
    form.addEventListener('drop', e => { e.preventDefault(); form.classList.remove('is-dragging'); add([...(e.dataTransfer?.files || [])]) })
    document.addEventListener('keydown', e => {
      if (!actions.isAssistant() || e.isComposing || document.querySelector('dialog[open]')) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'n') { e.preventDefault(); byId('new-session').click() }
        if (key === 'k') { e.preventDefault(); toggleRail(false); byId('session-search').focus(); byId('session-search').select() }
        if (key === 'b') { e.preventDefault(); toggleRail() }
      } else if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        if (preview) closePreview()
        else if (!byId('account-menu').hidden) { byId('account-menu').hidden = true; byId('account-menu-trigger').setAttribute('aria-expanded', 'false'); byId('account-menu-trigger').focus() }
        else actions.stop()
      }
    })
    applyAppearance()
  }
  window.WeftDesktop = { init, markdown, fileLabel, sessionGroup, sortSessions, toggleRail, openPreview, closePreview, showImage }
})()
