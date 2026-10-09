/* Desktop presentation only. Feature actions and preferences live in ui-core. */
(() => {
  'use strict'
  const byId = id => document.getElementById(id)
  const node = (tag, cls = '', text = '') => { const n = document.createElement(tag); n.className = cls; n.textContent = text; return n }
  const appearanceStore = globalThis.WeftUiCore.createAppearance(localStorage)
  const defaults = globalThis.WeftUiCore.appearanceDefaults
  let appearance = { ...defaults }, preview = null, returnFocus = null, actions = null, picker = null
  const tabs = new Map()
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  function applyAppearance(value = appearance) {
    appearance = { ...defaults, ...value }
    const root = document.documentElement
    root.dataset.theme = appearance.theme === 'system' ? media?.matches ? 'dark' : 'light' : appearance.theme
    root.style.colorScheme = root.dataset.theme
    root.dataset.accent = appearance.accent
    root.style.setProperty('--text-size', `var(--wm-font-size-${appearance.fontSize}, ${appearance.fontSize}px)`)
    for (const key of Object.keys(defaults)) if (byId(`appearance-${key}`)) byId(`appearance-${key}`).value = appearance[key]
  }
  applyAppearance(appearanceStore.value)
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
        const target = openPreview(link.textContent || '网页', link, `url:${url.href}`, 'webpage')
        const description = node('p', 'muted', '查看网页地址，或让助手读取网页内容。')
        const address = node('input'); address.readOnly = true; address.value = url.href; address.setAttribute('aria-label', '网页地址')
        const copy = node('button', 'button secondary small', '复制地址'); copy.type = 'button'
        copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url.href); copy.textContent = '已复制' } catch { copy.textContent = '请选择地址复制' } })
        target.content.replaceChildren(description, address, copy)
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
    hidePicker(); if (preview) { if (globalThis.WeftMotion) globalThis.WeftMotion.remove(preview.panel); else preview.panel.remove(); } preview = null; tabs.clear()
    document.body.classList.remove('preview-open', 'preview-expanded')
    if (restore && returnFocus?.isConnected) returnFocus.focus()
    returnFocus = null
  }
  function icon(kind) { return window.WeftIcons.create(({ webpage: 'web', collection: 'outputs' })[kind] || kind, 16) }
  function hidePicker() {
    picker?.remove(); picker = null; byId('conversation-resources')?.setAttribute('aria-expanded', 'false')
  }
  async function showPicker(trigger = byId('conversation-resources')) {
    if (picker) { hidePicker(); return }
    const menu = node('div', 'resource-picker'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '输出与来源')
    const close = node('button', 'button quiet small resource-picker-close', '关闭列表'); close.type = 'button'; close.addEventListener('click', hidePicker)
    menu.append(close, node('p', 'muted', '正在读取…')); picker = menu
    globalThis.WeftUiLayout.mountResourcePicker(menu)
    globalThis.WeftPopover?.position(menu, trigger, { side: 'bottom', align: 'end' })
    trigger.setAttribute('aria-expanded', 'true'); close.focus({ preventScroll: true })
    try {
      const items = await actions.resources()
      if (picker !== menu) return
      menu.replaceChildren(close)
      const group = (title, rows, empty) => {
        menu.append(node('h2', '', title))
        if (!rows.length) menu.append(node('p', 'muted resource-empty', empty))
        for (const item of rows) {
          const button = node('button', 'resource-item'); button.type = 'button'; button.dataset.resourceKey = item.key
          button.append(icon(item.kind), node('span', '', item.name)); button.title = item.location || item.url || item.name
          if (item.uses) button.append(node('small', 'muted', usageText(item)))
          button.addEventListener('click', () => { hidePicker(); actions.openResource(item, trigger) }); menu.append(button)
        }
      }
      group('输出内容', items.outputs, '这段对话还没有生成输出内容。')
      group('来源', items.sources.slice(0, 6), '这段对话还没有使用来源。')
      const all = node('button', 'button quiet small resource-all', '查看全部'); all.type = 'button'
      all.addEventListener('click', () => { hidePicker(); openCollection(items, trigger) }); menu.append(all)
    } catch { if (picker === menu) { menu.replaceChildren(close, node('p', 'muted', '暂时无法读取，请关闭后重试。')) } }
  }
  const usageText = item => `${item.kind === 'tool' ? '调用' : item.kind === 'memory' ? '引用' : item.uses.every(use => use.verb === '写入') ? '写入' : item.uses.some(use => use.verb === '写入') ? '使用' : '读取'} ${item.uses.length} 次`
  async function openCollection(items, trigger = document.activeElement) {
    const target = openPreview('输出与来源', trigger, 'collection', 'collection')
    target.content.textContent = '正在读取…'
    try {
      items ||= await actions.resources()
      if (!target.content.isConnected) return
      target.content.replaceChildren()
      for (const [title, rows] of [['输出内容', items.outputs], ['来源', items.sources]]) {
        target.content.append(node('h2', '', title))
        if (!rows.length) target.content.append(node('p', 'muted', title === '来源' ? '这段对话还没有使用来源。' : '这段对话还没有生成输出内容。'))
        for (const item of rows) {
          const button = node('button', 'resource-item'); button.type = 'button'; button.dataset.resourceKey = item.key
          button.append(icon(item.kind), node('span', '', item.name)); button.title = item.location || item.url || item.name
          if (item.uses) button.append(node('small', 'muted', usageText(item)))
          button.addEventListener('click', () => actions.openResource(item, button)); target.content.append(button)
        }
      }
    } catch { if (target.content.isConnected) target.content.textContent = '暂时无法读取，请关闭标签后重试。' }
  }
  function selectTab(key, focus = false) {
    const selected = tabs.get(key); if (!selected || !preview) return
    const opening = preview.panel.hidden, switching = preview.active !== key
    preview.panel.hidden = false; document.body.classList.add('preview-open')
    if (opening) globalThis.WeftMotion?.reveal(preview.panel, '240ms')
    preview.active = key; preview.content = selected.content
    for (const [id, tab] of tabs) {
      tab.content.hidden = id !== key; tab.select.setAttribute('aria-selected', String(id === key)); tab.select.tabIndex = id === key ? 0 : -1
    }
    if (switching) globalThis.WeftMotion?.reveal(selected.content, 'fast')
    if (focus) selected.select.focus({ preventScroll: true })
  }
  function openPreview(title, trigger = document.activeElement, key = title, kind = 'file') {
    hidePicker(); returnFocus = trigger
    if (tabs.has(key)) { selectTab(key, true); return { panel: preview.panel, content: tabs.get(key).content } }
    if (!preview) createPreview()
    const tab = node('div', 'preview-tab'), select = node('button', 'preview-tab-select'), close = node('button', 'preview-tab-close')
    select.type = close.type = 'button'; select.setAttribute('role', 'tab'); select.title = title
    const content = node('div', 'preview-content', '正在读取…'), id = `resource-tab-${crypto.randomUUID()}`
    select.id = id; content.setAttribute('role', 'tabpanel'); content.setAttribute('aria-labelledby', id); content.id = `${id}-content`; select.setAttribute('aria-controls', content.id)
    select.append(icon(kind), node('span', '', title)); close.append(window.WeftIcons.create('deny', 16)); close.setAttribute('aria-label', `关闭标签 ${title}`)
    select.addEventListener('click', () => selectTab(key))
    select.addEventListener('keydown', e => {
      const keys = [...tabs.keys()], index = keys.indexOf(key)
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); selectTab(keys[e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length], true) }
      if (e.key === 'Delete') { e.preventDefault(); close.click() }
    })
    close.addEventListener('click', () => {
      const keys = [...tabs.keys()], index = keys.indexOf(key), active = preview.active === key
      tab.remove(); content.remove(); tabs.delete(key)
      if (!tabs.size) closePreview(); else if (active) selectTab([...tabs.keys()][Math.min(index, tabs.size - 1)], true)
    })
    tab.append(select, close); preview.tablist.append(tab); preview.panel.append(content)
    tabs.set(key, { tab, select, content }); selectTab(key, true)
    return { panel: preview.panel, content }
  }
  function createPreview() {
    const panel = node('aside', 'timeline-preview'); panel.setAttribute('aria-label', '成果与来源预览')
    const resize = node('div', 'preview-resize'); resize.setAttribute('role', 'separator'); resize.setAttribute('aria-orientation', 'vertical'); resize.setAttribute('aria-label', '调整预览宽度'); resize.tabIndex = 0
    const header = node('div', 'preview-heading'), close = node('button', 'button quiet small', '收起'); close.type = 'button'; close.setAttribute('aria-label', '收起右侧面板')
    close.addEventListener('click', () => { if (globalThis.WeftMotion) globalThis.WeftMotion.hide(panel); else panel.hidden = true; document.body.classList.remove('preview-open', 'preview-expanded'); returnFocus?.isConnected && returnFocus.focus() })
    const tablist = node('div', 'preview-tabs'); tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', '输出与来源标签页')
    const add = node('button', 'button quiet small preview-add', '+'); add.type = 'button'; add.append(window.WeftIcons.create('plus', 16)); add.setAttribute('aria-label', '再打开一项'); add.setAttribute('aria-haspopup', 'dialog')
    add.addEventListener('click', () => { void showPicker(add) })
    const expand = node('button', 'button quiet small', '放大'); expand.type = 'button'; expand.setAttribute('aria-label', '放大右侧面板'); expand.setAttribute('aria-pressed', 'false')
    expand.addEventListener('click', () => { const expanded = document.body.classList.toggle('preview-expanded'); expand.textContent = expanded ? '还原' : '放大'; expand.setAttribute('aria-pressed', String(expanded)) })
    header.append(tablist, add, expand, close); panel.append(resize, header)
    globalThis.WeftUiLayout.mountPreview(panel)
    document.body.classList.add('preview-open')
    resize.setAttribute('aria-valuemin', '280'); resize.setAttribute('aria-valuemax', String(Math.round(window.innerWidth * .6)))
    resize.setAttribute('aria-valuenow', String(Math.round(panel.getBoundingClientRect().width)))
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
    preview = { panel, tablist }
    globalThis.WeftMotion?.reveal(panel, '240ms')
  }
  function showImage(url, name, trigger) {
    const panel = openPreview(name, trigger), image = node('img', 'preview-image'); image.src = url; image.alt = name
    panel.content.replaceChildren(image)
  }
  const { sessionGroup, sortSessions } = globalThis.WeftUiCore
  function toggleRail(force) {
    const collapsed = force === undefined ? !document.body.classList.contains('rail-collapsed') : force
    document.body.classList.toggle('rail-collapsed', collapsed)
    byId('rail-open').setAttribute('aria-expanded', String(!collapsed))
    if (collapsed) byId('rail-open').focus()
  }
  function init(callbacks) {
    actions = callbacks
    byId('conversation-resources')?.addEventListener('click', () => { void showPicker() })
    document.addEventListener('click', e => { if (picker && !picker.contains(e.target) && !e.target.closest('#conversation-resources, .preview-add')) hidePicker() })
    for (const key of Object.keys(defaults)) byId(`appearance-${key}`).addEventListener('change', e => {
      appearance[key] = e.target.value; applyAppearance()
      try { appearanceStore.set(appearance) } catch { /* device storage can be unavailable */ }
    })
    byId('session-search').addEventListener('input', actions.renderSessions)
    byId('search-sessions').addEventListener('click', () => { toggleRail(false); byId('session-search').focus() })
    byId('account-menu-trigger').addEventListener('click', () => {
      const menu = byId('account-menu'); menu.hidden = !menu.hidden
      byId('account-menu-trigger').setAttribute('aria-expanded', String(!menu.hidden))
      if (!menu.hidden) { globalThis.WeftPopover?.position(menu, byId('account-menu-trigger')); menu.querySelector('button')?.focus() }
    })
    document.addEventListener('click', e => { if (!byId('account-menu').hidden && !byId('account-menu').parentNode.contains(e.target)) { byId('account-menu').hidden = true; byId('account-menu-trigger').setAttribute('aria-expanded', 'false') } })

    const input = byId('message-text')
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault(); if (!input.disabled) actions.sendDraft(input.value, e.ctrlKey || e.metaKey ? 'queue' : undefined)
      }
    })
    const add = files => { if (!byId('message-attachments').disabled && files.length) actions.addFiles(files) }
    byId('attachment-add').tabIndex = 0
    byId('attachment-add').setAttribute('role', 'button')
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
        if (key === ',') { e.preventDefault(); globalThis.WeftSettingsNavigation?.open('general') }
      } else if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        if (picker) { hidePicker(); byId('conversation-resources').focus() }
        else if (preview && !preview.panel.hidden) closePreview()
        else if (!byId('account-menu').hidden) { byId('account-menu').hidden = true; byId('account-menu-trigger').setAttribute('aria-expanded', 'false'); byId('account-menu-trigger').focus() }
        else actions.stop()
      }
    })
    applyAppearance()
  }
  window.WeftDesktop = { init, markdown, fileLabel, sessionGroup, sortSessions, toggleRail, openPreview, closePreview, showImage, openCollection, usageText, icon }
})()
