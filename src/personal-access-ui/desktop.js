/* Desktop presentation only. Feature actions and preferences live in ui-core. */
(() => {
  'use strict'
  const byId = id => document.getElementById(id)
  const node = (tag, cls = '', text = '') => { const n = document.createElement(tag); n.className = cls; n.textContent = text; return n }
  const appearanceStore = globalThis.WeftUiCore.createAppearance(localStorage)
  const defaults = globalThis.WeftUiCore.appearanceDefaults
  let appearance = { ...defaults }, preview = null, returnFocus = null, actions = null, picker = null
  const tabs = new Map(), registry = new Map()
  let preferredWidth = 380
  try { const saved = Number(localStorage.getItem('weftmate-panel-width')); if (Number.isFinite(saved) && saved >= 300) preferredWidth = saved } catch { /* Optional device preference. */ }
  let context = { conversationId: null, mode: 'chat', computerId: null, workDir: null }, contextKey = '', lastSide = 'left'
  const compact = () => window.innerWidth <= 1100
  function lifecycle(tab, method, value) { tab?.instance?.[method](value) }
  function hidePreview(restore = true) {
    hidePicker()
    if (!preview || preview.panel.hidden) return
    lifecycle(tabs.get(preview.active), 'hide')
    preview.panel.hidden = true
    document.querySelector('.assistant-main').inert = false
    document.body.classList.remove('preview-open', 'preview-expanded')
    preview.expand.setAttribute('aria-pressed','false');preview.expand.setAttribute('aria-label','放大右侧面板');preview.expand.title='放大右侧面板';preview.expand.replaceChildren(icon('expand'))
    byId('workspace-panels')?.setAttribute('aria-expanded', 'false')
    if (restore) (returnFocus?.isConnected && returnFocus.getClientRects().length ? returnFocus : byId('workspace-panels'))?.focus({ preventScroll: true })
  }
  function updateContext(next) {
    const key = JSON.stringify([next.ownerId, next.identityGeneration, next.conversationId, next.sessionId, next.mode, next.computerId, next.projectId, next.workDir])
    if (key === contextKey) return
    const identityChanged = contextKey && (context.ownerId !== next.ownerId || context.identityGeneration !== next.identityGeneration)
    hidePicker(); context = { ...next }; contextKey = key
    if (identityChanged) { closePreview(false); return }
    // Resource snapshots belong to the old conversation. Registered panels keep
    // their instances and invalidate their own requests in update(ctx).
    for (const [id, tab] of [...tabs]) {
      if (tab.resource) closeTab(id, false)
      else lifecycle(tab, 'update', { ...context, tabId: id })
    }
    if (preview) renderLauncher()
  }
  function register(kind, definition) {
    registry.set(kind, definition)
    if (preview) renderLauncher()
  }
  function panelMenu(trigger) {
    WeftPopover.openMenu(trigger, [...registry].map(([kind, entry]) => ({ name: entry.title, icon: entry.icon, action: () => openPanel(kind, trigger) })), { label: '打开面板' })
  }
  function renderLauncher() {
    if (!preview) return
    preview.launcher.hidden = tabs.size > 0
    preview.launcher.replaceChildren(node('h2', '', '工作面板'))
    for (const [kind, entry] of registry) {
      const button = node('button', 'panel-launcher-item'); button.type = 'button'; button.dataset.panelKind = kind
      button.append(icon(entry.icon), node('span', '', entry.title))
      const binding = globalThis.WeftShortcuts?.rows.find(row => row.id === `panel-${kind}`)
      if (binding) button.append(node('kbd', '', binding.keys.join(' ')))
      button.onclick = () => openPanel(kind, button); preview.launcher.append(button)
    }
  }
  function showPanels(trigger = document.activeElement, notify = true) {
    if (!preview?.panel.contains(trigger)) returnFocus = trigger; lastSide = 'right'
    if (!preview) createPreview()
    if (compact()) toggleRail(true)
    const opening = preview.panel.hidden
    preview.panel.hidden = false; document.body.classList.add('preview-open')
    document.querySelector('.assistant-main').inert = window.innerWidth <= 720 || document.body.classList.contains('preview-expanded')
    byId('workspace-panels')?.setAttribute('aria-expanded', 'true')
    if (opening) globalThis.WeftMotion?.reveal(preview.panel, 'slow')
    if (opening && notify) lifecycle(tabs.get(preview.active), 'show')
    renderLauncher()
    if (!tabs.size) preview.launcher.querySelector('button')?.focus({ preventScroll: true })
  }
  function openPanel(kind, trigger = document.activeElement, options = {}) {
    const entry = registry.get(kind), key = options.key || kind
    if (!entry) return
    if (!preview?.panel.contains(trigger)) returnFocus = trigger
    if (tabs.has(key)) { selectTab(key, true); return tabs.get(key).instance }
    const instance = entry.create({ ...context, tabId: key })
    addTab(options.title || entry.title, key, entry.icon, instance)
    return instance
  }
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  const railMedia = window.matchMedia?.('(max-width: 640px)')
  function applyAppearance(value = appearance) {
    appearance = { ...defaults, ...value }
    const root = document.documentElement
    root.dataset.theme = appearance.theme === 'system' ? media?.matches ? 'dark' : 'light' : appearance.theme
    root.style.colorScheme = root.dataset.theme
    globalThis.WeftDesktopAppearanceControls.apply(appearance, root.dataset.theme)
    globalThis.WeftSystemBars?.sync()
    root.style.setProperty('--text-size', `var(--wm-font-size-${appearance.fontSize}, ${appearance.fontSize}px)`)
  }
  applyAppearance(appearanceStore.value)
  media?.addEventListener?.('change', () => { if (appearance.theme === 'system') applyAppearance() })
  function markdown(text, cls = 'markdown-body', options = {}) { return globalThis.WeftContent.create(text, cls, options) }
  function fileLabel(file) {
    const ext = (file.fileName || '').split('.').pop().toLowerCase()
    const mime = (file.contentType || '').split(';')[0]
    const type = ({ md: 'Markdown', markdown: 'Markdown', txt: '文本', csv: '表格', json: 'JSON', html: '网页', png: '图片', jpg: '图片', jpeg: '图片', webp: '图片' })[ext]
      || ({ 'text/markdown': 'Markdown', 'text/plain': '文本', 'text/csv': '表格', 'application/json': 'JSON' })[mime] || '文件'
    const size = Number.isFinite(file.size) ? file.size < 1024 ? `${file.size} 字节` : file.size < 1048576 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1048576).toFixed(1)} MB` : ''
    return `${type}${size ? ` · ${size}` : ''}`
  }
  function closePreview(restore = true) {
    hidePreview(restore)
    for (const tab of tabs.values()) lifecycle(tab, 'dispose')
    tabs.clear(); preview?.panel.remove(); preview = null; returnFocus = null
  }
  function icon(kind) { return window.WeftIcons.create(({ webpage: 'web', collection: 'outputs' })[kind] || kind, 16) }
  let pickerTrigger;
  function hidePicker(restoreFocus = false) {
    if(picker)globalThis.WeftMotion?WeftMotion.remove(picker):picker.remove(); picker = null; pickerTrigger?.setAttribute('aria-expanded','false');
    if(restoreFocus&&pickerTrigger?.isConnected)pickerTrigger.focus({preventScroll:true});pickerTrigger=null;
    byId('conversation-resources')?.setAttribute('aria-expanded', 'false')
  }
  async function showPicker(trigger = byId('conversation-resources')) {
    if (document.body.classList.contains('library-open') && preview?.libraryItems) {
      WeftPopover.menu(trigger, preview.libraryItems.map(item => ({name:item.fileName,icon:'file',action:()=>preview.libraryOpen(item,trigger)}))); return
    }
    if (picker) { hidePicker(); return }
    const menu = node('div', 'resource-picker'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '输出与来源')
    const close = node('button', 'button quiet small resource-picker-close', '关闭列表'); close.type = 'button'; close.addEventListener('click',()=>hidePicker(true))
    menu.append(close, WeftControls.skeleton({rows:3})); picker = menu; pickerTrigger=trigger
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
    const wasVisible = !preview.panel.hidden, previous = tabs.get(preview.active)
    if (previous !== selected && wasVisible) lifecycle(previous, 'hide')
    showPanels(returnFocus, false)
    preview.active = key; preview.content = selected.content
    for (const [id, tab] of tabs) {
      tab.content.hidden = id !== key; tab.select.setAttribute('aria-selected', String(id === key)); tab.select.tabIndex = id === key ? 0 : -1
    }
    if (previous !== selected || !wasVisible) lifecycle(selected, 'show')
    if (previous !== selected) globalThis.WeftMotion?.reveal(selected.content, 'base')
    selected.select.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (focus) selected.select.focus({ preventScroll: true })
  }
  function closeTab(key, focus = true) {
    const item = tabs.get(key); if (!item) return
    const keys = [...tabs.keys()], index = keys.indexOf(key), active = preview.active === key, visible = !preview.panel.hidden
    if (active && visible) lifecycle(item, 'hide')
    lifecycle(item, 'dispose'); item.tab.remove(); item.content.remove(); tabs.delete(key)
    if (active) {
      preview.active = null
      if (tabs.size) {
        const next = [...tabs.keys()][Math.min(index, tabs.size - 1)]
        if (visible) selectTab(next, focus)
        else { preview.active = next; const tab = tabs.get(next); tab.content.hidden = false; tab.select.setAttribute('aria-selected', 'true'); tab.select.tabIndex = 0 }
      }
    }
    renderLauncher()
    if (!tabs.size && visible && focus) preview.launcher.querySelector('button')?.focus()
  }
  function addTab(title, key, kind, instance, resource = false) {
    if (!preview) createPreview()
    const tab = node('div', 'preview-tab'), select = node('button', 'preview-tab-select'), close = node('button', 'preview-tab-close')
    select.type = close.type = 'button'; select.setAttribute('role', 'tab'); select.title = title
    const content = node('div', 'preview-content'), id = `resource-tab-${crypto.randomUUID()}`
    select.id = id; content.setAttribute('role', 'tabpanel'); content.setAttribute('aria-labelledby', id); content.id = `${id}-content`; select.setAttribute('aria-controls', content.id)
    select.append(icon(kind), node('span', '', title)); close.append(window.WeftIcons.create('deny', 16)); close.setAttribute('aria-label', `关闭标签 ${title}`)
    select.onclick = () => selectTab(key)
    select.onkeydown = e => {
      const keys = [...tabs.keys()], index = keys.indexOf(key)
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); selectTab(keys[e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length], true) }
      if (e.key === 'Delete') { e.preventDefault(); closeTab(key) }
    }
    close.onclick = () => closeTab(key)
    if (instance) content.append(instance.el)
    tab.append(select, close); preview.tablist.append(tab); preview.panel.append(content)
    tabs.set(key, { tab, select, content, instance, resource }); selectTab(key, true)
    return { panel: preview.panel, content }
  }
  function openPreview(title, trigger = document.activeElement, key = title, kind = 'file') {
    hidePicker(); if (!preview?.panel.contains(trigger)) returnFocus = trigger
    if (tabs.has(key)) { selectTab(key, true); return { panel: preview.panel, content: tabs.get(key).content } }
    return addTab(title, key, kind, null, true)
  }
  function createPreview() {
    const panel = node('aside', 'timeline-preview'); panel.setAttribute('aria-label', '工作面板'); panel.hidden = true
    const resize = node('div', 'preview-resize'); resize.setAttribute('role', 'separator'); resize.setAttribute('aria-orientation', 'vertical'); resize.setAttribute('aria-label', '调整预览宽度'); resize.tabIndex = 0
    const header = node('div', 'preview-heading'), tablist = node('div', 'preview-tabs'); tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', '工作面板标签页')
    const control = (name, glyph, run, cls = '') => { const b = node('button', `library-icon ${cls}`); b.type = 'button'; b.title = name; b.setAttribute('aria-label', name); b.append(icon(glyph)); b.onclick = run; return b }
    const close = control('收起右侧面板', 'sidebar', () => hidePreview())
    const add = control('再打开一项', 'plus', () => panelMenu(add), 'preview-add'); add.setAttribute('aria-haspopup', 'menu')
    const expand = control('放大右侧面板', 'expand', () => {
      const expanded = document.body.classList.toggle('preview-expanded')
      document.querySelector('.assistant-main').inert = expanded || window.innerWidth <= 720
      expand.replaceChildren(icon(expanded ? 'collapse' : 'expand')); expand.setAttribute('aria-pressed', String(expanded)); expand.setAttribute('aria-label', expanded ? '还原右侧面板' : '放大右侧面板')
      expand.title = expand.getAttribute('aria-label')
    }); expand.setAttribute('aria-pressed', 'false')
    const overflow = control('更多面板标签', 'chevron', () => WeftPopover.openMenu(overflow, [...tabs].map(([key, tab]) => ({ name: tab.select.textContent, icon: 'file', action: () => selectTab(key, true) })), { label: '面板标签' }))
    overflow.setAttribute('aria-haspopup', 'menu')
    const launcher = node('div', 'panel-launcher'); header.append(tablist, overflow, add, expand, close); panel.append(resize, header, launcher)
    globalThis.WeftUiLayout.mountPreview(panel)
    preview = { panel, tablist, launcher, expand }
    const maximum = () => Math.max(300, window.innerWidth - (compact() || document.body.classList.contains('rail-collapsed') ? 0 : byId('session-rail').getBoundingClientRect().width) - 420)
    let max = maximum(), frame = null, pendingWidth = preferredWidth
    const width = value => {
      const next = Math.max(300, Math.min(value, max))
      panel.style.width = `${next}px`; resize.setAttribute('aria-valuemin', '300'); resize.setAttribute('aria-valuemax', String(Math.round(max))); resize.setAttribute('aria-valuenow', String(Math.round(next)))
      return next
    }
    const persist = () => { preferredWidth = parseFloat(panel.style.width); try { localStorage.setItem('weftmate-panel-width', String(preferredWidth)) } catch { /* Optional device preference. */ } }
    preview.setWidth = () => { max = maximum(); width(preferredWidth) }; preview.setWidth()
    resize.addEventListener('pointerdown', e => {
      resize.setPointerCapture(e.pointerId); e.preventDefault(); max = maximum(); document.body.classList.add('panel-resizing')
      const move = event => {
        pendingWidth = window.innerWidth - event.clientX
        if (frame === null) frame = requestAnimationFrame(() => { frame = null; width(pendingWidth) })
      }
      const end = () => {
        if (frame !== null) { cancelAnimationFrame(frame); frame = null; width(pendingWidth) }
        persist(); document.body.classList.remove('panel-resizing')
        resize.removeEventListener('pointermove', move); resize.removeEventListener('pointerup', end); resize.removeEventListener('pointercancel', end); resize.removeEventListener('lostpointercapture', end)
      }
      resize.addEventListener('pointermove', move); resize.addEventListener('pointerup', end); resize.addEventListener('pointercancel', end); resize.addEventListener('lostpointercapture', end)
    })
    resize.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); max = maximum(); width(e.key === 'Home' ? 300 : e.key === 'End' ? max : parseFloat(panel.style.width) + (e.key === 'ArrowLeft' ? 32 : -32)); persist() } })
    renderLauncher()
  }
  function showImage(url, name, trigger) {
    const panel = openPreview(name, trigger), image = node('img', 'preview-image'); image.src = url; image.alt = name
    panel.content.replaceChildren(image)
  }
  const { sessionGroup, sortSessions } = globalThis.WeftUiCore
  function syncRailState(collapsed, narrow = !!railMedia?.matches) {
    const rail = byId('session-rail')
    document.body.classList.toggle('rail-collapsed', collapsed)
    rail.inert = collapsed
    rail.setAttribute('aria-hidden', String(collapsed))
    byId('rail-backdrop').hidden = !narrow || collapsed
    byId('rail-open').setAttribute('aria-expanded', String(!collapsed))
    if (collapsed && rail.contains(document.activeElement)) byId('rail-open').focus()
  }
  function toggleRail(force) {
    const narrow = !!railMedia?.matches
    const collapsed = force === undefined ? narrow ? byId('session-rail').classList.contains('is-open') : !document.body.classList.contains('rail-collapsed') : force
    byId('session-rail').classList.toggle('is-open', narrow && !collapsed)
    if (!collapsed) { lastSide = 'left'; if (compact()) hidePreview(false) }
    syncRailState(collapsed, narrow)
    preview?.setWidth()
    if (collapsed) byId('rail-open').focus()
  }
  function init(callbacks) {
    actions = callbacks
    const panelButton = byId('workspace-panels')
    panelButton.onclick = () => preview && !preview.panel.hidden ? hidePreview() : showPanels(panelButton)
    window.addEventListener('resize', () => {
      if (compact() && preview && !preview.panel.hidden) { if (lastSide === 'right') toggleRail(true); else hidePreview(false) }
      if (preview) { preview.setWidth(); document.querySelector('.assistant-main').inert = !preview.panel.hidden && (window.innerWidth <= 720 || document.body.classList.contains('preview-expanded')) }
    })
    const rail = byId('session-rail')
    let wasNarrow = !!railMedia?.matches
    const syncCurrentRail = () => {
      const narrow = !!railMedia?.matches
      const collapsed = narrow ? !rail.classList.contains('is-open') : document.body.classList.contains('rail-collapsed')
      syncRailState(collapsed, narrow)
    }
    syncCurrentRail()
    railMedia?.addEventListener('change', event => {
      const collapsed = wasNarrow ? !rail.classList.contains('is-open') : document.body.classList.contains('rail-collapsed')
      wasNarrow = event.matches
      rail.classList.toggle('is-open', wasNarrow && !collapsed)
      syncRailState(collapsed, wasNarrow)
    })
    // Existing navigation closes the drawer by removing is-open. Keep that
    // path's accessibility state aligned without changing feature handlers.
    new MutationObserver(syncCurrentRail).observe(rail, {attributes:true,attributeFilter:['class']})
    byId('conversation-resources')?.addEventListener('click', () => { void showPicker() })
    document.addEventListener('click', e => { if (picker && !picker.contains(e.target) && !e.target.closest('#conversation-resources, .preview-add')) hidePicker() })
    byId('account-menu-trigger').addEventListener('click', () => {
      const menu = byId('account-menu'); if(menu.hidden)menu.hidden=false;else WeftPopover.hide(menu)
      byId('account-menu-trigger').setAttribute('aria-expanded', String(!menu.hidden))
      if (!menu.hidden) { globalThis.WeftPopover?.position(menu, byId('account-menu-trigger')); menu.querySelector('button')?.focus() }
    })
    document.addEventListener('click', e => { if (!byId('account-menu').hidden && !byId('account-menu').parentNode.contains(e.target)) { WeftPopover.hide(byId('account-menu')); byId('account-menu-trigger').setAttribute('aria-expanded', 'false') } })

    const input = byId('message-text')
    input.addEventListener('keydown', e => {
      WeftShortcuts.dispatch(e,{send:()=>{if(!input.disabled)actions.sendDraft(input.value)},queue:()=>{if(!input.disabled)actions.sendDraft(input.value,'queue')},newline:()=>false})
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
      WeftShortcuts.dispatch(e,{panels:()=>preview&&!preview.panel.hidden?hidePreview():showPanels(),...Object.fromEntries([...registry.keys()].map(kind=>[`panel-${kind}`,()=>openPanel(kind)])),new:()=>byId('new-session').click(),search:()=>actions.openSearch?.(),sidebar:()=>toggleRail(),settings:()=>globalThis.WeftSettingsNavigation?.open('general'),
        shortcuts:()=>{if(!globalThis.weftmateDesktop&&matchMedia('(max-width:720px)').matches)return false;actions.openShortcuts?.()},escape:()=>{
        if(e.defaultPrevented)return false
        if (picker) { hidePicker(true) }
        else if (preview && !preview.panel.hidden) hidePreview()
        else if (!byId('account-menu').hidden) { WeftPopover.hide(byId('account-menu')); byId('account-menu-trigger').setAttribute('aria-expanded', 'false'); byId('account-menu-trigger').focus() }
        else actions.stop()
      }})
    })
    applyAppearance()
  }
  globalThis.WeftPanels = { register, open: openPanel, show: showPanels, hide: hidePreview, close: closeTab, update: updateContext, reset: () => closePreview(false), get context() { return { ...context } }, get entries() { return [...registry].map(([kind, entry]) => ({ kind, title: entry.title, icon: entry.icon })) }, services: {} }
  window.WeftDesktop = { configureLibraryPreview(items,open) { if(preview) { preview.libraryItems=items;preview.libraryOpen=open; } }, getAppearance: () => appearanceStore.value, setAppearance(patch) { applyAppearance(appearanceStore.set({ ...appearance, ...patch })); }, init, markdown, fileLabel, sessionGroup, sortSessions, toggleRail, showResources:showPicker, openPreview, closePreview, showImage, openCollection, usageText, icon }
})()
