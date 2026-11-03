globalThis.weftmateSurface?.onNotice?.(async notice => { await globalThis.WeftDialogs.inform(notice.title, notice.message); globalThis.weftmateSurface.closeNotice(notice.id); });
/**
 * WeftMate 客户端插件（R3-01/R3-02），浏览器 half，手写 classic script（无构建步骤）。
 *
 * 载入：modules node half 服务本文件于 `/plugins/@weftmate/client/client.js`（cache-control: no-cache），
 * 以外部 classic script 注入；脚本唯一职责是向 window.__ModuleLoader__ 注册 factory。
 * factory 在 materialize 时收到同步 require，返回 cordis 客户端插件对象 { name, inject, apply }。
 *
 * Slot 选择依据（以 DSH checkout 源码为准）：
 * - `shell.overlay`（packages/client/ui-layout/src/client/index.ts SlotMap 声明 + AppFrame.tsx renderSlot）
 *   是「frame-wide floating layer」的 list 槽位：additive（新 id 追加而非替换）、root 作用域、无 owner props。
 *   官方注释明确「a badge ... a status pill all belong here」——与本插件的「品牌标识 + 托盘联动状态条」吻合。
 *
 * R3-02 接缝（main ↔ 宿主插件 ↔ 本 UI）：
 * - 状态面：轮询 `GET /weftmate/status.json`（宿主插件实时读 main 写的状态文件；10s 一次），
 *   展示真实版本、托盘常驻、更新态（disabled/checking/available/downloaded/error）。
 * - 动作面：更新已下载时胶囊出现「重启安装」按钮（此时才恢复 pointer-events），
 *   `POST /weftmate/update {action:'install'}`；「检查更新」留 R3-03 设置卡（本胶囊保持最小）。
 * - 连接态：继续从官方 connection.hostDescription 可观察源读「运行时已连接」真值。
 *
 * 开关面（R6/R8 收口）：感知/桌宠浮动胶囊已删，全部开关并入官方设置页
 * `settings.section` 槽位的「WeftMate」节（感知/桌宠/设备配对块）；
 * 记忆状态统一进入 Weave 导航、状态栏、右工作台和记忆整页，不再注册旧浮动胶囊。
 */
window.__ModuleLoader__.load({
  id: '@weftmate/client',
  factory: function (require) {
    var React = require('react')

    // The DSH client remains the actual UI. This shell layer changes only the
    // product frame around the fixed, official client graph: native chrome,
    // wordmark and sidebar surface. It deliberately owns no DSH data, route,
    // setting, session, tool, approval, or interaction state.
    // SidebarRoot oC7kBG_* and AppFrame -w4i8q_* below are mapped from the
    // current embedded vendor assets; recheck them when updating that runtime.
    function installElectronWindowChrome() {
      if (window.weftmateConversation) return // The carrier owns its native frame.
      if (!document || !document.body || document.getElementById('weftmate-electron-drag-region')) return
      var style = document.createElement('style')
      style.id = 'weftmate-electron-window-style'
      style.textContent = [
        // A3 colours apply only when DSH has selected its light theme. The
        // existing theme setting and dark palette keep their own authority.
        'html[data-weftmate-electron-shell] body { --weftmate-surface-shadow: var(--dsw-shadow-lv2); }',
        'html[data-weftmate-electron-shell] body:not([data-ds-dark-theme]) { --dsw-alias-bg-base: #f9fbff; --dsw-alias-label-primary: #17243f; --dsw-alias-label-secondary: #52637d; --dsw-alias-label-tertiary: #6a7b94; --dsw-alias-label-caption: #8795aa; --dsw-alias-border-l1: #e8eef7; --dsw-alias-border-l2: #dce5f2; --dsw-alias-border-l2-darkmode-thin: #dce5f2; --dsw-alias-border-l3: #b8cceb; --dsw-alias-state-business-primary: #2469ed; --dsw-alias-button-info-fill: #2469ed; --dsw-alias-button-info-hover: #1759d7; --dsw-specific-sidebar-fill: #f5f8fd; --dsw-specific-sidebar-nav-item-active: #e6efff; --dsw-specific-sidebar-nav-item-hover: #edf3fc; --dsw-specific-bubble: #e7f0ff; --dsw-specific-input-major: #ffffff; --weftmate-surface-shadow: 0 10px 28px rgba(45, 73, 115, .08), 0 2px 5px rgba(45, 73, 115, .04), inset 0 0 0 5px rgba(246, 249, 255, .8); }',
        'html[data-weftmate-electron-shell] body { box-sizing: border-box; padding-top: 44px !important; background: var(--dsw-alias-bg-base, Canvas); }',
        '#weftmate-electron-drag-region { position: fixed; top: 0; left: 0; right: 0; height: 44px; z-index: 2147483000; display: flex; align-items: center; gap: 9px; padding: 0 18px; box-sizing: border-box; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base, Canvas); color: var(--dsw-alias-label-secondary, currentColor); font-family: var(--dsw-font-family, system-ui, sans-serif); -webkit-app-region: drag; }',
        '#weftmate-electron-drag-region .weftmate-mark { display: inline-grid; place-items: center; width: 22px; height: 22px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l3); border-radius: 7px; color: var(--dsw-alias-state-business-primary); font-size: 12px; font-weight: 700; line-height: 1; letter-spacing: -.05em; }',
        '#weftmate-electron-drag-region .weftmate-wordmark { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 650; letter-spacing: -.01em; }',
        'html[data-weftmate-electron-shell] .-w4i8q_frame { background: var(--dsw-alias-bg-base); }',
        'html[data-weftmate-electron-shell] .-w4i8q_sidebarCol { border-right-color: var(--dsw-alias-border-l2); }',
        'html[data-weftmate-electron-shell] .oC7kBG_root { padding-top: 8px; }',
        'html[data-weftmate-electron-shell] .oC7kBG_logoRow { height: 52px; margin-bottom: 4px; padding-left: 4px; }',
        'html[data-weftmate-electron-shell] .oC7kBG_brand { gap: 8px; min-height: 36px; }',
        'html[data-weftmate-electron-shell] .oC7kBG_brand > * { display: none; }',
        'html[data-weftmate-electron-shell] .oC7kBG_brand::before { content: "WeftMate"; color: var(--dsw-alias-label-primary); font: 650 16px/20px var(--dsw-font-family, system-ui, sans-serif); letter-spacing: -.025em; }',
        'html[data-weftmate-electron-shell] .oC7kBG_newSession { border-radius: 11px; border-color: var(--dsw-alias-border-l3); color: var(--dsw-alias-state-business-primary); box-shadow: 0 2px 6px color-mix(in srgb, var(--dsw-alias-border-l2) 25%, transparent); }',
        'html[data-weftmate-electron-shell] .oC7kBG_newSession:hover { background: var(--dsw-alias-interactive-bg-hover); }',
        'html[data-weftmate-electron-shell] .oC7kBG_regionArea { border-top: 1px solid var(--dsw-alias-border-l2); margin-top: 3px; padding-top: 8px; }',
        'html[data-weftmate-electron-shell] .oC7kBG_footArea { border-top: 1px solid var(--dsw-alias-border-l2); margin-top: 6px; padding-top: 6px; }',
        'html[data-weftmate-electron-shell] .oC7kBG_collapsed .oC7kBG_logoRow { justify-content: flex-start; height: 36px; margin-bottom: 12px; padding: 0; }',
        'html[data-weftmate-electron-shell] .oC7kBG_collapsed .oC7kBG_brand { display: none; }',
        'html[data-weftmate-electron-shell] .oC7kBG_collapsed .oC7kBG_toggle { width: 36px; height: 36px; }',
        'html[data-weftmate-electron-shell] .oC7kBG_collapsed .oC7kBG_railFish { display: none; }',
        'html[data-weftmate-electron-shell] .oC7kBG_collapsed .oC7kBG_toggle::before { content: "W"; display: grid; place-items: center; width: 24px; height: 24px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l3); border-radius: 7px; color: var(--dsw-alias-state-business-primary); font: 700 13px/1 var(--dsw-font-family, system-ui, sans-serif); letter-spacing: -.05em; }',
        'html[data-weftmate-electron-shell] .oC7kBG_collapsed .oC7kBG_toggle:hover::before { display: none; }',
        'html[data-weftmate-electron-shell] .oC7kBG_collapsed .oC7kBG_newSession { box-shadow: none; }',
        'html[data-weftmate-electron-shell] .oC7kBG_collapsed .oC7kBG_regionArea, html[data-weftmate-electron-shell] .oC7kBG_collapsed .oC7kBG_footArea { border-top-color: transparent; }',
        '@media (prefers-reduced-motion: reduce) { html[data-weftmate-electron-shell] .-w4i8q_frame, html[data-weftmate-electron-shell] .oC7kBG_fading > * { transition: none !important; animation: none !important; } }',
        'button, input, textarea, select, a, [role="button"], [contenteditable="true"] { -webkit-app-region: no-drag; }',
      ].join('\n')
      document.head.appendChild(style)
      document.documentElement.setAttribute('data-weftmate-electron-shell', '')
      var dragRegion = document.createElement('div')
      dragRegion.id = 'weftmate-electron-drag-region'
      dragRegion.setAttribute('aria-hidden', 'true')
      // This is inert native chrome, not a second navigation or state source.
      dragRegion.innerHTML = '<span class="weftmate-mark">W</span><span class="weftmate-wordmark">WeftMate</span>'
      document.body.appendChild(dragRegion)

      var lastThemeSignature = null
      var syncTheme = function () {
        var theme = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
        // Read the exact strip colour rather than the browser's default body
        // colour. This keeps Windows chrome continuous with the visible DSH
        // surface even when the document body itself is transparent.
        var color = window.getComputedStyle(dragRegion).backgroundColor
        var signature = theme + '\u0000' + color
        if (signature === lastThemeSignature) return
        lastThemeSignature = signature
        var bridge = window.weftmateSurface
        if (bridge && typeof bridge.syncTheme === 'function') {
          Promise.resolve(bridge.syncTheme(theme, color)).catch(function () { /* Electron may be closing */ })
        }
      }
      syncTheme()
      new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
    }

    // This is intentionally a stylesheet-only treatment of DSH's documented
    // conversation structure.  The attributes below are supplied by the
    // official ConversationRoot, ChatView, ApprovalPanel, and InputBar; no
    // session, message, approval, input, model, or streaming state is read or
    // recreated by WeftMate.
    function installConversationWorkspaceSurface() {
      if (!document || !document.head || document.getElementById('weftmate-conversation-surface-style')) return
      var style = document.createElement('style')
      style.id = 'weftmate-conversation-surface-style'
      style.textContent = [
        'html[data-weftmate-electron-shell] div[data-phase="hero"], html[data-weftmate-electron-shell] div[data-phase="active"], html[data-weftmate-electron-shell] div[data-phase="settling"] { --dsh-chat-content-width: 680px; --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 24px); --dsh-composer-side-clearance: clamp(20px, 5vw, 72px); --dsh-composer-dock-inset: 12px; }',
        'html[data-weftmate-electron-shell] div[data-phase] > header { padding: 14px clamp(20px, 3vw, 36px) 0; }',
        'html[data-weftmate-electron-shell] div[data-phase="active"] > header { border-bottom-color: var(--dsw-alias-border-l2); }',
        'html[data-weftmate-electron-shell] [data-conversation-scroll] { scrollbar-gutter: stable both-edges; }',
        'html[data-weftmate-electron-shell] [data-conversation-scroll] [data-chat-flow-kind] { padding-block: 2px; }',
        'html[data-weftmate-electron-shell] [data-chat-flow-kind="command"], html[data-weftmate-electron-shell] [data-chat-flow-kind="model-retry"], html[data-weftmate-electron-shell] [data-chat-flow-kind="turn-error"], html[data-weftmate-electron-shell] [data-chat-flow-kind="turn-max-tokens"] { border-block: 1px solid var(--dsw-alias-border-l2); padding-block: 8px; }',
        'html[data-weftmate-electron-shell] [data-chat-flow-kind="user"] [data-time-hover-root] { margin-block: 2px; }',
        'html[data-weftmate-electron-shell] [data-chat-flow-kind="user"] [data-time-hover-root] > div > div { border-radius: 14px; }',
        'html[data-weftmate-electron-shell] [data-approval-key] { padding: 10px clamp(20px, 5vw, 72px) 14px; }',
        'html[data-weftmate-electron-shell] [data-approval-key] > div { border-radius: 12px; box-shadow: none; }',
        'html[data-weftmate-electron-shell] div[data-phase="active"] [data-composer-seat], html[data-weftmate-electron-shell] div[data-phase="settling"] [data-composer-seat] { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 10px; }',
        'html[data-weftmate-electron-shell] [data-composer-card] { border-color: var(--dsw-alias-border-l2); border-radius: 14px; box-shadow: none; transition: border-color 120ms ease, background-color 120ms ease; }',
        'html[data-weftmate-electron-shell] [data-composer-card]:focus-within { border-color: var(--dsw-alias-border-l3); }',
        'html[data-weftmate-electron-shell] [data-composer-card]:has(textarea[aria-haspopup="menu"]) { border-color: var(--dsw-alias-border-l2); }',
        'html[data-weftmate-electron-shell] [data-composer-card]:has(textarea[aria-haspopup="menu"])::after { display: none; }',
        'html[data-weftmate-electron-shell] [data-composer-card] textarea, html[data-weftmate-electron-shell] [data-input-backdrop], html[data-weftmate-electron-shell] [data-input-mirror] { padding: 4px 18px 0; }',
        'html[data-weftmate-electron-shell] [data-composer-card] button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 3px; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-conversation-scroll] { position: relative; justify-content: flex-end; padding-bottom: 12px; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-conversation-scroll]::before { content: "今天想聊些什么？"; position: absolute; top: 42%; left: 50%; width: calc(100% - 48px); color: var(--dsw-alias-label-primary); font: 500 clamp(23px, 2.5vw, 32px)/1.4 var(--dsw-font-family, system-ui, sans-serif); letter-spacing: -.02em; text-align: center; transform: translate(-50%, -50%); pointer-events: none; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-weftmate-hero-composer] { box-sizing: border-box; position: relative; gap: 0; width: min(var(--dsh-composer-card-max-width), calc(100% - 2 * var(--dsh-composer-side-clearance))); margin: 0 auto; padding-bottom: 12px; overflow: visible; border: 0; background: transparent; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-weftmate-hero-composer] > div:has(> button[aria-haspopup="menu"][aria-label]) { box-sizing: border-box; position: relative; z-index: 0; display: flex; align-items: center; gap: 8px; min-height: 48px; margin: 0 20px -10px; padding: 8px 14px 18px; border: 1px solid var(--dsw-alias-border-l2); border-bottom: 0; border-radius: 14px 14px 0 0; background: var(--dsw-specific-sidebar-fill); }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-weftmate-hero-composer] button[aria-haspopup="menu"][aria-label] { margin-inline-start: 0; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-weftmate-hero-composer] div:has(> [data-composer-card]) { position: relative; z-index: 1; width: 100% !important; max-width: none !important; padding: 0 !important; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-weftmate-hero-composer] [data-composer-card] { width: 100%; max-width: none; }',
        '@media (min-width: 1180px) { html[data-weftmate-electron-shell] div[data-phase="hero"], html[data-weftmate-electron-shell] div[data-phase="active"], html[data-weftmate-electron-shell] div[data-phase="settling"] { --dsh-chat-content-width: 680px; } }',
        '@media (max-height: 520px) { html[data-weftmate-electron-shell] div[data-phase="hero"] [data-conversation-scroll]::before { display: none; } }',
        '@media (prefers-reduced-motion: reduce) { html[data-weftmate-electron-shell] [data-chat-flow-kind] *, html[data-weftmate-electron-shell] [data-approval-key], html[data-weftmate-electron-shell] [data-composer-card] { transition: none !important; animation: none !important; } }',
      ].join('\n')
      document.head.appendChild(style)
    }


    /** 状态接口失败/首次加载时的回退（与宿主插件 fallbackState 同形状语义）。 */
    var FALLBACK_STATE = {
      app: { name: 'WeftMate', version: 'dev' },
      tray: { resident: false },
      dataDirs: null,
      update: { enabled: false, status: 'disabled', version: null, error: null },
    }

    var baseStyle = {
      position: 'absolute',
      top: '12px',
      right: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 12px',
      borderRadius: '999px',
      background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
      border: '1px solid var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '12px',
      fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)',
      lineHeight: '1.35',
      boxShadow: '0 2px 10px rgba(45, 73, 115, 0.06)',
    }
    var brandStyle = { color: 'var(--dsw-alias-brand-primary)', fontWeight: 600 }
    var dimStyle = { color: 'var(--dsw-alias-label-secondary)' }
    var separatorStyle = { width: '1px', height: '10px', background: 'var(--dsw-alias-border-l2)' }
    var dotStyle = function (connected) {
      return {
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: connected ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)',
      }
    }
    var installBtnStyle = {
      pointerEvents: 'auto',
      cursor: 'pointer',
      border: '1px solid var(--dsw-alias-brand-primary)',
      background: 'var(--dsw-alias-brand-primary)',
      color: '#fff',
      borderRadius: '999px',
      padding: '3px 10px',
      fontSize: '11px',
      lineHeight: '1.2',
    }

    function pollStatus(setState) {
      fetch('/weftmate/status.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (state) { if (state && typeof state === 'object') setState(state) })
        .catch(function () { /* 网络抖动保持旧值 */ })
    }

    function pollPerception(setState) {
      fetch('/weftmate/perception.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (perception) { if (perception && typeof perception === 'object') setState(perception) })
        .catch(function () { /* 网络抖动保持旧值 */ })
    }

    /** 设置节动作面：确定性 set-* 动作 + value；失败静默（轮询以真值纠正）。 */
    function postSeam(path, action, value) {
      fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: action, value: value }),
      }).catch(function () { /* 请求失败保持旧值 */ })
    }

    var FALLBACK_PERCEPTION = {
      config: {
        enabled: false,
        capture: 'app_title',
        clipboard: false,
        inject: { enabled: false, intervalMs: 60_000 },
        mobile: false,
      },
      sample: null,
    }

    /** 品牌 + 托盘联动状态条（纯指示；仅「重启安装」可点）。 */
    function WeftMateStatusBadge(props) {
      var source = props.hostDescription
      var descState = React.useState(function () { return source.getSnapshot() })
      var desc = descState[0]
      var setDesc = descState[1]

      var statusState = React.useState(FALLBACK_STATE)
      var status = statusState[0]
      var setStatus = statusState[1]

      React.useEffect(function () {
        var update = function () { setDesc(source.getSnapshot()) }
        var unsubscribe = source.subscribe(update)
        update()
        return unsubscribe
      }, [source])

      React.useEffect(function () {
        pollStatus(setStatus)
        var timer = setInterval(function () { pollStatus(setStatus) }, 10_000)
        return function () { clearInterval(timer) }
      }, [])

      var connected = desc !== undefined && desc !== null
      var version = status.app && typeof status.app.version === 'string' ? status.app.version : '0.0.0'
      var trayResident = status.tray && status.tray.resident === true
      var update = status.update || FALLBACK_STATE.update
      var updateReady = update.status === 'downloaded'
      var updateBusy = update.status === 'checking' || update.status === 'available'
      var updateFailed = update.status === 'error'

      var children = [
        React.createElement('span', { key: 'brand', style: brandStyle }, 'WeftMate'),
        React.createElement('span', { key: 'version', style: dimStyle }, 'v' + version),
        React.createElement('span', { key: 'sep1', style: separatorStyle }),
        React.createElement('span', { key: 'dot', style: dotStyle(connected) }),
        React.createElement(
          'span',
          { key: 'conn', style: dimStyle },
          connected ? '运行时已连接' : '连接中…',
        ),
        React.createElement('span', { key: 'sep2', style: separatorStyle }),
        React.createElement('span', { key: 'tray', style: dimStyle }, trayResident ? '托盘常驻' : '托盘未就绪'),
      ]
      if (updateReady) {
        children.push(React.createElement('span', { key: 'sep3', style: separatorStyle }))
        children.push(React.createElement(
          'button',
          {
            key: 'install',
            style: installBtnStyle,
            onClick: function () {
              fetch('/weftmate/update', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'install' }),
              }).catch(function () { /* 请求失败保持旧值 */ })
            },
          },
          '重启安装 v' + (update.version || ''),
        ))
      } else if (updateBusy) {
        children.push(React.createElement('span', { key: 'sep3', style: separatorStyle }))
        children.push(React.createElement('span', { key: 'upd', style: dimStyle }, '更新下载中…'))
      } else if (updateFailed) {
        children.push(React.createElement('span', { key: 'sep3', style: separatorStyle }))
        children.push(React.createElement('span', { key: 'upd', style: dimStyle }, '更新出错'))
      }

      var containerStyle = Object.assign({}, baseStyle)
      if (!updateReady) {
        containerStyle.pointerEvents = 'none'
        containerStyle.userSelect = 'none'
      }
      var title = 'WeftMate 托盘联动状态条'
      if (status.dataDirs && typeof status.dataDirs.workspace === 'string') {
        title += ' · 工作区 ' + status.dataDirs.workspace
      }
      return React.createElement('div', { style: containerStyle, title: title }, children)
    }


    function fetchAvailableJson(path, setter) {
      return fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (data) {
          var next = data && typeof data === 'object' && !Array.isArray(data)
            ? Object.assign({}, data, { available: true })
            : { ready: false, available: false }
          setter(next)
          return next
        })
        .catch(function () {
          var next = { ready: false, available: false }
          setter(next)
          return next
        })
    }

    var sectionBlockStyle = { marginBottom: '20px' }
    var sectionBlockTitleStyle = {
      fontSize: '12px', color: 'var(--dsw-alias-label-secondary)',
      marginBottom: '8px', letterSpacing: '0.4px',
    }
    var sectionRowStyle = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
      padding: '7px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)',
    }
    var sectionRowLabelStyle = { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' }
    var sectionHintStyle = {
      fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginTop: '2px', lineHeight: '1.5',
    }
    var sectionSmallBtnStyle = {
      cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent',
      color: 'var(--dsw-alias-label-primary)', borderRadius: '6px', padding: '3px 10px',
      fontSize: '12px', lineHeight: '1.4',
    }
    var FALLBACK_DEVICE = {}

    function Toggle(props) {
      return React.createElement('button', {
        key: 'toggle', type: 'button', role: 'switch',
        'aria-checked': props.checked === true,
        'aria-label': props.label,
        disabled: props.disabled === true,
        title: props.title,
        onClick: function () { if (!props.disabled) props.onChange(props.checked !== true) },
        style: {
          width: '36px', height: '20px', borderRadius: '999px', border: 'none', cursor: props.disabled ? 'wait' : 'pointer',
          opacity: props.disabled ? 0.55 : 1,
          padding: 0, position: 'relative', flexShrink: 0,
          background: props.checked === true ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)',
          transition: 'background 0.15s ease',
        },
      }, React.createElement('span', {
        key: 'knob', style: {
          position: 'absolute', top: '2px', left: props.checked === true ? '18px' : '2px',
          width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)', transition: 'left 0.15s ease',
        },
      }))
    }

    function Row(props) {
      return React.createElement('div', { key: 'row', style: sectionRowStyle },
        React.createElement('div', { key: 'text', style: { minWidth: 0 } },
          React.createElement('div', { key: 'label', style: sectionRowLabelStyle }, props.label),
          props.hint ? React.createElement('div', { key: 'hint', style: sectionHintStyle }, props.hint) : null,
        ),
        React.createElement('div', { key: 'control' }, props.control),
      )
    }

    function CaptureSeg(props) {
      var options = [
        { value: 'app_title', label: '应用+标题' },
        { value: 'app_only', label: '仅应用' },
      ]
      var buttons = options.map(function (opt) {
        var active = props.value === opt.value
        return React.createElement('button', {
          key: opt.value, type: 'button',
          onClick: function () { if (!active) props.onChange(opt.value) },
          style: {
            border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', cursor: 'pointer',
            background: active ? 'var(--dsw-alias-brand-primary)' : 'transparent',
            color: active ? '#fff' : 'var(--dsw-alias-label-primary)',
            padding: '4px 10px', fontSize: '12px', lineHeight: '1.4',
          },
        }, opt.label)
      })
      return React.createElement('div', { key: 'seg', style: { display: 'flex', gap: '6px' } }, buttons)
    }

    function fmtDeviceTime(iso) {
      if (!iso) return '—'
      var d = new Date(iso)
      return isNaN(d.getTime()) ? String(iso) : d.toLocaleString()
    }

    function fmtTokenLeft(ms) {
      if (typeof ms !== 'number' || ms <= 0) return '已过期（自动轮换）'
      var total = Math.floor(ms / 1000)
      var m = Math.floor(total / 60)
      var s = total % 60
      return m + ' 分 ' + (s < 10 ? '0' : '') + s + ' 秒'
    }

    function DeviceBlock(props) {
      var state = props.state
      var pairing = state && state.pairing
      var devices = state && Array.isArray(state.devices) ? state.devices : null
      var known = !!(state && state.available === true && devices && ((pairing && typeof pairing.token === 'string' && pairing.token.length > 0) || devices.length > 0))
      var leftMs = pairing && typeof pairing.expiresAt === 'number' ? pairing.expiresAt - Date.now() : null
      var copiedState = React.useState(false)
      var copied = copiedState[0]
      var setCopied = copiedState[1]
      var copyErrorState = React.useState(null)
      var copyError = copyErrorState[0]
      var setCopyError = copyErrorState[1]

      var copyToken = function () {
        var text = pairing && typeof pairing.token === 'string' ? pairing.token : ''
        if (!text) return
        setCopyError(null)
        var done = function () {
          setCopied(true)
          setTimeout(function () { setCopied(false) }, 1500)
        }
        if (window.navigator && window.navigator.clipboard && typeof window.navigator.clipboard.writeText === 'function') {
          window.navigator.clipboard.writeText(text).then(done).catch(function () { setCopyError('复制失败，请手动选中配对码复制。') })
        } else {
          setCopyError('此环境无法访问剪贴板，请手动选中配对码复制。')
        }
      }

      if (!known) return React.createElement('div', { key: 'device', style: sectionBlockStyle },
        React.createElement('div', { style: sectionBlockTitleStyle }, '设备配对'),
        React.createElement('p', { role: 'status', style: sectionHintStyle }, state && state.available === false
          ? '设备状态读取失败，已配对设备未知。'
          : '设备服务尚未提供配对状态，已配对设备未知。'),
      )

      var tokenNode = pairing && typeof pairing.token === 'string'
        ? React.createElement('div', { key: 'token', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '6px 0' } },
            React.createElement('code', {
              key: 't',
              style: {
                fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px',
                background: 'var(--dsw-alias-bg-layer-1)', padding: '6px 8px', borderRadius: '6px',
                wordBreak: 'break-all', color: 'var(--dsw-alias-label-primary)',
              },
            }, pairing.token),
            React.createElement('button', { key: 'c', type: 'button', style: sectionSmallBtnStyle, onClick: copyToken }, copied ? '已复制' : '复制'),
            React.createElement('span', { key: 'x', style: sectionHintStyle }, leftMs === null ? '' : '有效期 ' + fmtTokenLeft(leftMs)),
          )
        : React.createElement('div', { key: 'no-token', style: sectionHintStyle }, '运行时未生成配对 token（重启 WeftMate 后生成）')

      var deviceRows = devices.length === 0
        ? [React.createElement('div', { key: 'empty', style: sectionHintStyle }, '暂无已配对设备——手机 App 输入上方 token 完成配对（token 10 分钟有效，可配多台）')]
        : devices.map(function (d, i) {
            return React.createElement('div', { key: 'd' + i, style: sectionRowStyle },
              React.createElement('span', { key: 'n' }, String(d.name || '未命名设备')),
              React.createElement('span', { key: 't', style: sectionHintStyle }, '最近 ' + fmtDeviceTime(d.lastSeenAt)),
            )
          })

      return React.createElement('div', { key: 'device', style: sectionBlockStyle },
        React.createElement('div', { key: 'title', style: sectionBlockTitleStyle }, '设备配对'),
        tokenNode,
        copyError ? React.createElement('div', { role: 'alert', style: sectionHintStyle }, copyError) : null,
        deviceRows,
      )
    }

    function WeftMateSettingsSection() {
      var perceptionState = React.useState(FALLBACK_PERCEPTION)
      var perception = perceptionState[0]
      var setPerception = perceptionState[1]
      var statusState = React.useState({})
      var status = statusState[0]
      var setStatus = statusState[1]
      var deviceState = React.useState(FALLBACK_DEVICE)
      var device = deviceState[0]
      var setDevice = deviceState[1]
      var localState = React.useState(null)
      var local = localState[0]
      var setLocal = localState[1]
      var petPendingState = React.useState(null)
      var petPending = petPendingState[0]
      var setPetPending = petPendingState[1]
      var petFeedbackState = React.useState(null)
      var petFeedback = petFeedbackState[0]
      var setPetFeedback = petFeedbackState[1]

      React.useEffect(function () {
        var poll = function () {
          pollPerception(setPerception)
          fetchAvailableJson('/weftmate/status.json', setStatus)
          // fetch('/weftmate/device/state.json', { cache: 'no-store' })
          fetchAvailableJson('/weftmate/device/state.json', setDevice)
        }
        poll()
        var timer = setInterval(poll, 5_000)
        return function () { clearInterval(timer) }
      }, [])

      var cfg = (perception && perception.config) || FALLBACK_PERCEPTION.config
      var sample = perception && perception.sample
      var pet = (status && status.pet) || null

      // The existing pet endpoint only accepts a request; main consumes it
      // later. Do not flip the switch until the polled host reports the result.
      React.useEffect(function () {
        if (!petPending || petPending.phase !== 'waiting') return
        if (pet && pet[petPending.property] === petPending.value) {
          setPetPending(null)
          setPetFeedback({ error: false, text: '已更新，当前桌宠状态已确认。' })
        }
      }, [status, petPending])
      React.useEffect(function () {
        if (!petPending || petPending.phase !== 'waiting') return
        var timer = setTimeout(function () {
          setPetPending(null)
          setPetFeedback({ error: true, text: '请求已提交，但尚未确认生效。请查看当前状态后重试。' })
        }, Math.max(0, petPending.deadline - Date.now()))
        return function () { clearTimeout(timer) }
      }, [petPending])

      // 乐观覆盖：点击立即生效；轮询追上真值后自动清掉对应键（值相同即不闪烁）。
      React.useEffect(function () {
        setLocal(function (prev) {
          if (!prev) return null
          var truth = {
            enabled: cfg.enabled,
            capture: cfg.capture,
            clipboard: cfg.clipboard,
            inject: cfg.inject.enabled,
            mobile: cfg.mobile,
          }
          var next = null
          for (var key in prev) {
            if (prev[key] !== truth[key]) {
              next = next || {}
              next[key] = prev[key]
            }
          }
          return next
        })
      }, [perception, status])

      var eff = function (key, base) {
        return local && local[key] !== undefined ? local[key] : base
      }
      var applyPerception = function (key, action, value) {
        setLocal(function (prev) {
          var next = Object.assign({}, prev)
          next[key] = value
          return next
        })
        postSeam('/weftmate/perception', action, value)
      }
      var applyPet = function (key, action, value) {
        // postSeam('/weftmate/pet', action, value)
        if (petPending) return
        var property = key === 'petVisible' ? 'visible' : 'freeActivity'
        if (!pet || typeof pet[property] !== 'boolean') return
        setPetFeedback(null)
        setPetPending({ property: property, value: value, phase: 'sending' })
        fetch('/weftmate/pet', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: action, value: value }), signal: AbortSignal.timeout(6000),
        }).then(function (response) {
          if (!response.ok) throw new Error('request rejected')
          return response.json()
        }).then(function (result) {
          if (!result || result.ok !== true) throw new Error('request not accepted')
          setPetPending({ property: property, value: value, phase: 'waiting', deadline: Date.now() + 15000 })
          fetchAvailableJson('/weftmate/status.json', setStatus)
        }).catch(function () {
          setPetPending(null)
          setPetFeedback({ error: true, text: '操作未确认成功，请求失败或超时；开关仍以实际状态为准。' })
        })
      }

      var sampleLine = '总开关关闭——不开不采（opt-in）'
      if (cfg.enabled === true) {
        if (!sample) {
          sampleLine = '开启中…（等待首个采样，每 5 秒一次）'
        } else {
          var parts = []
          if (sample.activeWindow) {
            parts.push('窗口 ' + sample.activeWindow.app + (sample.activeWindow.title ? ' — ' + sample.activeWindow.title : ''))
          }
          parts.push('空闲 ' + Math.floor(Math.max(0, Number(sample.idleSeconds) || 0) / 60) + ' 分钟')
          if (sample.locked) parts.push('已锁屏')
          if (sample.mobile && typeof sample.mobile.content === 'string' && sample.mobile.content) {
            parts.push('手机[' + (sample.mobile.deviceName || '未知') + '] ' + sample.mobile.content.slice(0, 40))
          }
          if (sample.clipboardText) parts.push('剪贴板有内容（仅界面可见）')
          sampleLine = parts.join(' · ')
        }
      }
      var intervalMinutes = Math.max(1, Math.round((Number(cfg.inject.intervalMs) || 60_000) / 60_000))

      return React.createElement('div', {
        key: 'weftmate-settings',
        style: { padding: '4px 2px', color: 'var(--dsw-alias-label-primary)' },
      },
        React.createElement('div', { key: 'pet', style: sectionBlockStyle },
          React.createElement('div', { key: 'title', style: sectionBlockTitleStyle }, '桌宠控制'),
          React.createElement(Row, {
            key: 'visible', label: '显示桌宠窗口',
            control: pet && typeof pet.visible === 'boolean' ? React.createElement(Toggle, {
              label: '显示桌宠窗口', checked: pet.visible, disabled: petPending !== null,
              onChange: function (v) { applyPet('petVisible', 'set-visible', v) },
            }) : React.createElement('span', { role: 'status', style: sectionHintStyle }, '状态未知'),
            hint: '透明置顶小窗；托盘图标也可唤醒或休息。',
          }),
          React.createElement(Row, {
            key: 'free', label: '自由活动',
            control: pet && typeof pet.freeActivity === 'boolean' ? React.createElement(Toggle, {
              label: '自由活动', checked: pet.freeActivity, disabled: petPending !== null,
              onChange: function (v) { applyPet('petFreeActivity', 'set-free-activity', v) },
            }) : React.createElement('span', { role: 'status', style: sectionHintStyle }, '状态未知'),
            hint: '允许读取瞬时鼠标位置自主游走、注视、停靠主窗口。',
          }),
          petPending ? React.createElement('div', { role: 'status', style: sectionHintStyle }, petPending.phase === 'sending' ? '正在提交桌宠请求…' : '请求已提交，等待实际状态确认…') : null,
          petFeedback ? React.createElement('div', { role: petFeedback.error ? 'alert' : 'status', style: Object.assign({}, sectionHintStyle, { color: petFeedback.error ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)' }) }, petFeedback.text) : null,
        ),
        React.createElement('div', { key: 'perception', style: sectionBlockStyle },
          React.createElement('div', { key: 'title', style: sectionBlockTitleStyle }, '桌面感知（R6 · opt-in）'),
          React.createElement(Row, {
            key: 'enabled',
            label: '桌面感知',
            control: React.createElement(Toggle, {
              checked: eff('enabled', cfg.enabled) === true,
              onChange: function (v) { applyPerception('enabled', 'set-enabled', v) },
            }),
            hint: '开启后才采样窗口/空闲/锁屏；窗口标题截断 300 字符',
          }),
          React.createElement(Row, {
            key: 'capture',
            label: '采集内容',
            control: React.createElement(CaptureSeg, {
              value: eff('capture', cfg.capture),
              onChange: function (v) { applyPerception('capture', 'set-capture', v) },
            }),
            hint: '仅应用 = 不采窗口标题，更省隐私',
          }),
          React.createElement(Row, {
            key: 'clipboard',
            label: '剪贴板感知',
            control: React.createElement(Toggle, {
              checked: eff('clipboard', cfg.clipboard) === true,
              onChange: function (v) { applyPerception('clipboard', 'set-clipboard', v) },
            }),
            hint: '额外敏感，需单独开启；内容仅界面可见、永不注入模型（截断 500 字符）',
          }),
          React.createElement(Row, {
            key: 'inject',
            label: '模型注入',
            control: React.createElement(Toggle, {
              checked: eff('inject', cfg.inject.enabled) === true,
              onChange: function (v) { applyPerception('inject', 'set-inject', v) },
            }),
            hint: '把感知快照追加进模型上下文（每回合至多一次）；最小间隔 ' + intervalMinutes + ' 分钟',
          }),
          React.createElement(Row, {
            key: 'mobile',
            label: '手机感知源（R8）',
            control: React.createElement(Toggle, {
              checked: eff('mobile', cfg.mobile) === true,
              onChange: function (v) { applyPerception('mobile', 'set-mobile', v) },
            }),
            hint: '配对手机上报的观察进感知面；关闭时观察直接丢弃（不开不收）',
          }),
          React.createElement('div', { key: 'sample', style: Object.assign({}, sectionHintStyle, { marginTop: '8px' }) }, '当前：' + sampleLine),
        ),
        React.createElement(DeviceBlock, { key: 'deviceblock', state: device }),
      )
    }

    function installWeftmateV2Style() {
      if (!document || !document.head || document.getElementById('weftmate-v2-style')) return
      var style = document.createElement('style')
      style.id = 'weftmate-v2-style'
      style.textContent = [
        ':root {',
        // 深色（墨夜，默认）。品牌主色由珊瑚切换为织蓝
        '  --weftmate-accent: #6B8CFF;',
        '  --weftmate-accent-active: #8FA8FF;',
        '  --weftmate-accent-soft: rgba(107,140,255,0.09);',
        '  --weftmate-accent-wash: rgba(107,140,255,0.16);',
        '  --weftmate-ok: #4ADE80;',
        '  --weftmate-ok-bg: rgba(74,222,128,0.12);',
        '  --weftmate-warn: #FBBF24;',
        '  --weftmate-warn-bg: rgba(251,191,36,0.12);',
        '  --weftmate-err: #F87171;',
        '  --weftmate-err-bg: rgba(248,113,113,0.12);',
        '  --weftmate-info: #38BDF8;',
        '  --weftmate-info-bg: rgba(56,189,248,0.12);',
        // v2 idle 语义：映射原型 --ink-2（深 #A6AEBC / 浅 #565F6E），modStateColor idle 分支随之落入 v2，函数本体不动
        '  --weftmate-neutral: #A6AEBC;',
        '  --weftmate-hairline: #242B37;',
        '  --weftmate-hairline-strong: #333B4A;',
        // 浮层唯一允许的三级阴影，照抄原型 --shadow-3
        '  --weftmate-shadow-3: 0 8px 16px rgba(0,0,0,0.45), 0 24px 64px rgba(0,0,0,0.55);',
        // 雾玻璃配方（深浅统一一套，仅换三个值）
        '  --weftmate-glass-bg: rgba(22,26,34,0.82);',
        '  --weftmate-glass-border: rgba(255,255,255,0.09);',
        '  --weftmate-glass-blur: saturate(1.5) blur(18px);',
        // 旧名显式绑定新配方：旧消费方零改动换肤（浅色由不起雾改为起雾，属有意变更）
        '  --weftmate-panel-bg: var(--weftmate-glass-bg);',
        '  --weftmate-panel-border: var(--weftmate-glass-border);',
        '  --weftmate-panel-blur: var(--weftmate-glass-blur);',
        // 动效（MOD_FRAMEWORK_V2 §5 L1：缓动两条、120/200ms）
        '  --weftmate-t-fast: 120ms;',
        '  --weftmate-t-med: 200ms;',
        '  --weftmate-ease-out: cubic-bezier(0.22,1,0.36,1);',
        '  --weftmate-ease-io: cubic-bezier(0.45,0,0.15,1);',
        '}',
        'body:not([data-ds-dark-theme]) {',
        // 浅色（纸白）
        '  --weftmate-accent: #2E5BFF;',
        '  --weftmate-accent-active: #1F49D6;',
        '  --weftmate-accent-soft: #F3F6FF;',
        '  --weftmate-accent-wash: #E9EFFF;',
        '  --weftmate-ok: #15803D;',
        '  --weftmate-ok-bg: #E4F5EA;',
        '  --weftmate-warn: #B45309;',
        '  --weftmate-warn-bg: #FDF1E0;',
        '  --weftmate-err: #DC2626;',
        '  --weftmate-err-bg: #FDECEC;',
        '  --weftmate-info: #0369A1;',
        '  --weftmate-info-bg: #E5F1FB;',
        '  --weftmate-neutral: #565F6E;',
        '  --weftmate-hairline: #E6E9EF;',
        '  --weftmate-hairline-strong: #D3D9E3;',
        '  --weftmate-shadow-3: 0 8px 16px rgba(24,27,33,0.10), 0 24px 64px rgba(24,27,33,0.14);',
        '  --weftmate-glass-bg: rgba(255,255,255,0.82);',
        '  --weftmate-glass-border: rgba(24,27,33,0.08);',
        '}',
        // Resolve aliases on the themed element, after legacy light-body aliases.
        'body, body:not([data-ds-dark-theme]) { --weftmate-panel-bg: var(--weftmate-glass-bg); --weftmate-panel-border: var(--weftmate-glass-border); --weftmate-panel-blur: var(--weftmate-glass-blur); }',
        // 玻璃消费写法（输入条 / ⌘K / Toast 通用）：必须带 -webkit- 前缀；浮层唯一允许的三级阴影
        '.weftmate-glass { background: var(--weftmate-glass-bg); border: 1px solid var(--weftmate-glass-border); backdrop-filter: var(--weftmate-glass-blur); -webkit-backdrop-filter: var(--weftmate-glass-blur); box-shadow: var(--weftmate-shadow-3); }',
        // 降级一：不支持 backdrop-filter 时玻璃转实色（alpha 0.96），功能不受损
        '@supports not (backdrop-filter: blur(1px)) {',
        '  :root { --weftmate-glass-bg: rgba(22,26,34,0.96); --weftmate-glass-blur: none; }',
        '  body:not([data-ds-dark-theme]) { --weftmate-glass-bg: rgba(255,255,255,0.96); }',
        '}',
        // 降级二：系统「减少透明」时同样回退实色（系统联动须实测，不凭媒体查询文本宣称通过）
        '@media (prefers-reduced-transparency: reduce) {',
        '  :root { --weftmate-glass-bg: rgba(22,26,34,0.96); --weftmate-glass-blur: none; }',
        '  body:not([data-ds-dark-theme]) { --weftmate-glass-bg: rgba(255,255,255,0.96); }',
        '}',
      ].join('\n')
      document.head.appendChild(style)
    }

    // V2 shell: it owns only the product frame and page visibility.  The
    // official DSH sidebar/conversation/details nodes stay mounted below it.
    // A missing pinned frame is a visible compatibility failure, never a DOM
    // scavenger that repeatedly moves official content.
    function installPinnedDshLayoutAdapter(layout) {
      var overlay = document.querySelector('[data-shell-overlay]')
      var frame = overlay && overlay.parentElement
      if (!frame || frame.children.length < 4) {
        document.documentElement.setAttribute('data-weftmate-v2-layout', 'unsupported')
        return false
      }
      var children = Array.prototype.slice.call(frame.children)
      var sidebar = children[0], center = children[1], details = children[2]
      if (!sidebar || !center || !details || overlay.parentElement !== frame) {
        document.documentElement.setAttribute('data-weftmate-v2-layout', 'unsupported')
        return false
      }
      var writtenAttributes = []
      function rememberAttribute(node, name) { writtenAttributes.push({ node: node, name: name, value: node.getAttribute(name) }) }
      rememberAttribute(frame, 'data-weftmate-v2-frame')
      rememberAttribute(sidebar, 'data-weftmate-v2-sidebar')
      rememberAttribute(center, 'data-weftmate-v2-center')
      rememberAttribute(details, 'data-weftmate-v2-details')
      rememberAttribute(document.documentElement, 'data-weftmate-v2-layout')
      if (sidebar.firstElementChild) rememberAttribute(sidebar.firstElementChild, 'data-weftmate-v2-sidebar-content')
      frame.setAttribute('data-weftmate-v2-frame', '')
      sidebar.setAttribute('data-weftmate-v2-sidebar', '')
      if (sidebar.firstElementChild) sidebar.firstElementChild.setAttribute('data-weftmate-v2-sidebar-content', '')
      center.setAttribute('data-weftmate-v2-center', '')
      details.setAttribute('data-weftmate-v2-details', '')
      document.documentElement.setAttribute('data-weftmate-v2-layout', 'ready')
      // A wide viewport gets one corrective toggle only.  Attribute mutations
      // caused by that toggle must not turn into a second attempt loop.
      var stopped = false, timer = null, initialTimer = null, wasWide = false, restoreAttempted = false
      function restoreWideSidebar() {
        var wide = window.innerWidth > 980
        if (stopped) return
        if (!wide) {
          wasWide = false; restoreAttempted = false
          clearTimeout(timer); frame.removeAttribute('data-weftmate-v2-sidebar-restore-failed')
          return
        }
        if (wasWide === true) return
        wasWide = true; restoreAttempted = false
        if (!frame.hasAttribute('data-sidebar-collapsed')) {
          frame.removeAttribute('data-weftmate-v2-sidebar-restore-failed')
          return
        }
        if (restoreAttempted || !layout || typeof layout.toggleSidebar !== 'function') return
        restoreAttempted = true
        try { layout.toggleSidebar() } catch (_) { frame.setAttribute('data-weftmate-v2-sidebar-restore-failed', ''); return }
        clearTimeout(timer); timer = setTimeout(function () {
          if (!frame.hasAttribute('data-sidebar-collapsed')) frame.removeAttribute('data-weftmate-v2-sidebar-restore-failed')
          else frame.setAttribute('data-weftmate-v2-sidebar-restore-failed', '')
        }, 250)
      }
      var observer = new MutationObserver(function () {
        // Observe the one correction's confirmation only; a user's official
        // sidebar toggle at a stable wide width remains their choice.
        if (restoreAttempted && !frame.hasAttribute('data-sidebar-collapsed')) frame.removeAttribute('data-weftmate-v2-sidebar-restore-failed')
      })
      observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
      window.addEventListener('resize', restoreWideSidebar)
      initialTimer = setTimeout(restoreWideSidebar, 0)
      return function () {
        stopped = true; clearTimeout(initialTimer); clearTimeout(timer); observer.disconnect(); window.removeEventListener('resize', restoreWideSidebar)
        writtenAttributes.forEach(function (entry) { if (entry.value === null) entry.node.removeAttribute(entry.name); else entry.node.setAttribute(entry.name, entry.value) })
      }
    }

    function installWeftmateV2ShellStyle() {
      if (!document || !document.head || document.getElementById('weftmate-v2-shell-style')) return
      var style = document.createElement('style')
      style.id = 'weftmate-v2-shell-style'
      style.textContent = [
        '#weftmate-electron-drag-region{display:none!important}.weftmate-v2-shell.app{background:transparent!important}',
        '[data-weftmate-v2-frame]{--v2-side:296px;--v2-details:0px;--v2-work-inset:288px;position:fixed!important;top:96px!important;right:0!important;bottom:30px!important;left:0!important;width:auto!important;height:auto!important;padding:0!important;box-sizing:border-box!important;transform:none!important;contain:none!important;grid-template-columns:var(--v2-side) minmax(0,1fr) var(--v2-details)!important}',
        '[data-weftmate-v2-frame] div[data-phase="active"],[data-weftmate-v2-frame] div[data-phase="hero"],[data-weftmate-v2-frame] div[data-phase="settling"]{--dsh-chat-content-width:760px!important}',
        '[data-weftmate-v2-sidebar]{box-sizing:border-box!important;padding-left:60px!important}[data-weftmate-v2-sidebar]>*{width:100%!important;max-width:100%!important}[data-weftmate-v2-sidebar],[data-weftmate-v2-center],[data-weftmate-v2-details]{min-width:0;min-height:0}',
        '[data-weftmate-v2-center]{box-sizing:border-box;padding-right:var(--v2-work-inset)}[data-weftmate-v2-frame]:not([data-details-collapsed]){--v2-details:288px;--v2-work-inset:0px}[data-weftmate-v2-frame]:not([data-details-collapsed]) [data-shell-overlay] .weftmate-v2-work{display:none}',
        '[data-weftmate-v2-center]{position:relative}',
        '[data-weftmate-v2-center]>*{min-width:0}',
        '.weftmate-v2-shell{pointer-events:none;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:19;overflow:hidden;font-family:"MiSans","PingFang SC",system-ui,sans-serif;color:var(--weftmate-ink-1,var(--dsw-alias-label-primary))}',
        '.weftmate-v2-shell button,.weftmate-v2-shell .tb-search,.weftmate-v2-shell .overlay,.weftmate-v2-shell .cmdk{pointer-events:auto;font:inherit}',
        '.weftmate-v2-shell .overlay{z-index:200}',
        '.weftmate-v2-title{height:44px;position:absolute;inset:0 0 auto;display:flex;align-items:center;gap:9px;padding:0 16px;border-bottom:1px solid var(--weftmate-hairline);background:var(--dsw-alias-bg-base);-webkit-app-region:drag}',
        '.weftmate-v2-title>*{ -webkit-app-region:no-drag}.weftmate-v2-mark{display:grid;place-items:center;width:24px;height:24px;border:1px solid var(--weftmate-hairline-strong);border-radius:8px;color:var(--weftmate-accent);font-weight:800}.weftmate-v2-word{font-size:15px;font-weight:750}',
        '.weftmate-v2-title .tb-right{margin-left:auto;display:flex;align-items:center;gap:8px}',
        '.weftmate-v2-rail{position:fixed;top:44px;bottom:30px;left:0;width:60px;padding:10px 0;display:flex;flex-direction:column;align-items:center;gap:4px;border-right:1px solid var(--weftmate-hairline);background:var(--dsw-alias-bg-base);pointer-events:auto}.weftmate-v2-rail button{min-height:36px;border:0;border-radius:8px;background:transparent;color:inherit}.weftmate-v2-rail button[data-on]{background:var(--weftmate-accent-soft);color:var(--weftmate-accent)}.weftmate-v2-rail .rl-item{position:relative;width:48px;padding:7px 0 6px;border-radius:10px;border:none;background:none;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;color:var(--weftmate-ink-3);font-size:11px;transition:background 120ms ease,color 120ms ease}.weftmate-v2-rail .rl-item svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.weftmate-v2-rail .rl-item:hover{background:var(--weftmate-surface-2,rgba(128,128,128,0.1));color:var(--weftmate-ink-1)}.weftmate-v2-rail .rl-item.on{color:var(--weftmate-accent);font-weight:600;background:var(--weftmate-accent-soft)}.weftmate-v2-rail .rl-item .rl-dot{position:absolute;top:6px;right:9px;width:7px;height:7px;border-radius:50%;background:var(--weftmate-accent);box-shadow:0 0 0 2px var(--weftmate-surface)}.weftmate-v2-rail .r-bottom{margin-top:auto;display:flex;flex-direction:column;gap:4px;align-items:center}.weftmate-v2-rail .r-avatar{width:30px;height:30px;border-radius:50%;cursor:pointer;background:linear-gradient(135deg,var(--weftmate-accent),#1a3ec8);display:grid;place-items:center;color:#fff;font-size:11px;font-weight:700}[data-weftmate-v2-sidebar] .oC7kBG_root{box-sizing:border-box!important;width:236px!important;max-width:236px!important;padding:0!important}[data-weftmate-v2-sidebar] .oC7kBG_regionArea{width:236px!important;margin:0!important;padding:0!important}[data-weftmate-v2-sidebar] .weftmate-v2-sessions.sess-col{box-sizing:border-box;position:relative;z-index:20;width:236px;height:100%;flex-shrink:0;background:var(--weftmate-surface);border-right:1px solid var(--weftmate-hairline);display:flex;flex-direction:column;pointer-events:auto}.weftmate-v2-sessions .sdot{width:6px;height:6px;border-radius:50%;background:var(--weftmate-accent);flex:none}.weftmate-v2-sessions .sess-list{min-height:0;overflow:auto}.weftmate-v2-sessions .sess-group{font-size:12px;font-weight:650;color:var(--weftmate-ink-3);letter-spacing:.04em;padding:10px 8px 4px}.weftmate-v2-sessions .sess-node,.weftmate-v2-sessions .sess-item{position:relative;margin-bottom:2px;font-size:13.5px}.weftmate-v2-sessions .sess-node .acts{margin-left:auto;display:flex;gap:2px;opacity:0}.weftmate-v2-sessions .sess-node:hover .acts,.weftmate-v2-sessions .sess-node:focus-within .acts,.weftmate-v2-sessions .sess-node:hover .mini,.weftmate-v2-sessions .sess-node:focus-within .mini,.weftmate-v2-sessions .sess-item:hover .mini,.weftmate-v2-sessions .sess-item:focus-within .mini{opacity:1}.weftmate-v2-sessions .mini{opacity:0;border:0;background:transparent;color:inherit}.weftmate-v2-sessions .sess-item .d{min-width:36px;text-align:right;font-size:11px}.weftmate-v2-sessions .sess-new .btn{width:100%;font-size:13px;font-weight:600;height:32px}.weftmate-v2-sessions .sess-state{width:6px;height:6px;flex:none;border-radius:50%;background:var(--weftmate-accent)}.weftmate-v2-sessions .sess-state.pending{background:var(--weftmate-warn,#b45309)}.weftmate-v2-sessions .sess-state.completed{background:var(--weftmate-ok,#15803d)}.weftmate-v2-sessions .sess-rename{width:100%;min-width:0;font:inherit}.weftmate-v2-sidebar-feedback{padding:5px 8px;color:var(--weftmate-ink-3,#6b7280);font-size:11px}.weftmate-v2-sidebar-feedback.err{color:var(--weftmate-err,#dc2626)}.oC7kBG_logoRow,.oC7kBG_newSession{display:none!important}.oC7kBG_footArea{position:fixed;z-index:30;left:6px;top:var(--weftmate-v2-settings-top);bottom:auto;width:48px;height:0!important;padding:0!important;margin:0!important;overflow:visible!important;border:none!important;pointer-events:none}.oC7kBG_footArea button.ksvqgW_trigger,.oC7kBG_footArea button[aria-haspopup="dialog"]{display:none!important}.ksvqgW_overlay{pointer-events:auto!important}[data-weftmate-v2-sidebar] .oC7kBG_settingsArea .ksvqgW_trigger,[data-weftmate-v2-sidebar] .oC7kBG_settingsArea .ksvqgW_trigger.ksvqgW_rail{border-radius:10px;justify-content:center;flex-direction:column;gap:3px;width:48px;height:auto;margin:0;padding:7px 0 6px;font-size:10px}[data-weftmate-v2-sidebar] .oC7kBG_settingsArea .ksvqgW_trigger svg{width:18px;height:18px}[data-weftmate-v2-sidebar] .oC7kBG_settingsArea .Sf1YKG_triggerLabel{display:none}[data-weftmate-v2-sidebar] .oC7kBG_settingsArea .ksvqgW_trigger::after{content:attr(data-weftmate-settings-label);line-height:1}.weftmate-v2-sessions[data-collapsed] .sess-sub{display:none}[data-weftmate-v2-sidebar] .weftmate-v2-sessions .pin-ic{width:12px;height:12px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8}@media(max-width:980px){.weftmate-v2-sessions{display:none!important}}html[data-weftmate-v2-sessions-hidden] .weftmate-v2-sessions{display:none!important}html[data-weftmate-v2-page="settings"] .weftmate-v2-sessions{display:none!important}html[data-weftmate-v2-sessions-hidden] [data-weftmate-v2-sidebar]{visibility:visible!important;pointer-events:auto!important;overflow:visible!important}html[data-weftmate-v2-page="settings"] [data-weftmate-v2-sidebar]{visibility:visible!important;pointer-events:auto!important;overflow:visible!important}@media(max-width:980px){[data-weftmate-v2-sidebar]{visibility:visible!important;pointer-events:auto!important;overflow:visible!important}.weftmate-v2-sessions{display:none!important}}',
        '.weftmate-v2-head{position:fixed;top:44px;left:60px;right:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid var(--weftmate-hairline);background:var(--dsw-alias-bg-base);pointer-events:auto}.weftmate-v2-head b{font-size:14px}.weftmate-v2-head .weftmate-v2-chat-title{min-width:0;max-width:clamp(160px,50vw,520px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.weftmate-v2-head .ch-left{display:flex;align-items:center;gap:8px;min-width:0}.weftmate-v2-work{box-sizing:border-box;position:fixed;right:0;top:96px;bottom:30px;width:288px;padding:14px 14px 24px;border-left:1px solid var(--weftmate-hairline);background:var(--weftmate-surface);pointer-events:auto;overflow-y:auto;display:flex;flex-direction:column}.weftmate-v2-work h2{margin:0 0 8px;font-size:12px}.weftmate-v2-work .wc-eyebrow{font-size:12px;font-weight:650;color:var(--weftmate-ink-2);letter-spacing:.06em;padding:2px 2px 8px}.weftmate-v2-work .wc-card .wc-head{display:flex;align-items:center;gap:7px;font-size:13.5px;font-weight:650}.weftmate-v2-work .wc-card .wc-desc{font-size:12.5px;color:var(--weftmate-ink-2);margin-top:4px;line-height:1.55}.weftmate-v2-work .wc-card .wc-foot{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11.5px;color:var(--weftmate-ink-3)}.weftmate-v2-work .wc-row{display:flex;align-items:center;gap:8px;padding:6px 2px;font-size:13px;color:var(--weftmate-ink-2)}.weftmate-v2-work .wc-row .wc-ic{width:24px;height:24px;border-radius:6px;background:var(--weftmate-surface-2);display:grid;place-items:center;font-size:11.5px;flex-shrink:0;color:var(--weftmate-ink-3)}.weftmate-v2-work .wc-row .d{font-size:11px;color:var(--weftmate-ink-3)}.weftmate-v2-work .prog-step{font-size:11.5px}.weftmate-v2-work .wt-item .wt-x{font-size:13px;font-weight:500}.weftmate-v2-work .wt-item .wt-t{font-size:11px;color:var(--weftmate-ink-3)}.weftmate-v2-status{z-index:22;position:fixed;left:0;right:0;bottom:0;height:30px;display:flex;align-items:center;padding:0 14px;border-top:1px solid var(--weftmate-hairline);background:var(--dsw-alias-bg-base);font-size:11px;color:var(--dsw-alias-label-secondary)}.weftmate-v2-status.statusbar{gap:16px;pointer-events:auto}.weftmate-v2-status .st{display:flex;align-items:center;gap:5px;white-space:nowrap;cursor:default}.weftmate-v2-status .st b{color:var(--weftmate-ink-2,var(--dsw-alias-label-primary));font-weight:600}.weftmate-v2-status .dot{width:6px;height:6px;border-radius:50%;background:var(--weftmate-ok,#10b981)}.weftmate-v2-status .right{margin-left:auto;display:flex;gap:16px}',
        '.weftmate-v2-page{position:fixed;z-index:21;inset:44px 0 30px 60px;background:var(--dsw-alias-bg-base);overflow:auto;pointer-events:auto;padding:0;max-width:none!important}.weftmate-v2-page:not(.on){display:none!important}.weftmate-v2-page .page-head{min-height:52px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--weftmate-hairline)}.weftmate-v2-page main{max-width:none;margin:0}.weftmate-v2-layout-error,.weftmate-v2-sidebar-restore-error{display:none}[data-weftmate-v2-layout="unsupported"] .weftmate-v2-layout-error,[data-weftmate-v2-frame][data-weftmate-v2-sidebar-restore-failed] [data-shell-overlay] .weftmate-v2-sidebar-restore-error{display:block;position:fixed;left:72px;bottom:42px;background:var(--weftmate-err-bg);color:var(--weftmate-err);padding:6px 8px;border-radius:8px;font-size:12px}.weftmate-v2-shell[data-page="settings"] .weftmate-v2-work,.weftmate-v2-shell[data-page="settings"] .weftmate-v2-head{display:none}',
        '.weftmate-v2-page.weftmate-v2-settings{background:var(--weftmate-bg-base);display:flex;flex-direction:column}.weftmate-v2-page.weftmate-v2-settings .page-head{padding:0 22px;background:var(--weftmate-surface);border-bottom:1px solid var(--weftmate-hairline);min-height:52px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}.weftmate-v2-page .page-scroll{flex:1;overflow-y:auto;padding:22px;min-height:0}.weftmate-v2-page .page-body{max-width:920px;margin:0 auto}.weftmate-v2-page .set-group{background:var(--weftmate-surface);border:1px solid var(--weftmate-hairline);border-radius:12px;overflow:hidden;margin-bottom:14px}.weftmate-v2-page .set-group .sg-title{font-size:11px;font-weight:700;color:var(--weftmate-ink-3);padding:12px 16px 5px;letter-spacing:.06em}.weftmate-v2-page .set-row{display:flex;align-items:center;gap:12px;padding:10px 16px;font-size:12.5px;border-top:1px solid var(--weftmate-hairline);min-height:42px}.weftmate-v2-page .sg-title+.set-row{border-top:none}.weftmate-v2-page .set-row .sr-k{font-weight:500;color:var(--weftmate-ink-1)}.weftmate-v2-page .set-row .sr-d{font-size:11px;color:var(--weftmate-ink-3);margin-top:1px}.weftmate-v2-page .set-row .sr-v{margin-left:auto;font-size:11.5px;color:var(--weftmate-ink-3);text-align:right}.weftmate-v2-page .set-row .sr-act{margin-left:auto;display:flex;gap:8px;align-items:center}.weftmate-v2-page .seg{display:inline-flex;padding:2px;background:var(--weftmate-surface-2,rgba(0,0,0,0.06));border:1px solid var(--weftmate-hairline);border-radius:8px;gap:2px}.weftmate-v2-page .seg button{padding:4px 12px;font-size:11.5px;border:none;background:none;border-radius:6px;color:var(--weftmate-ink-2);cursor:pointer}.weftmate-v2-page .seg button.on{background:var(--weftmate-surface);color:var(--weftmate-ink-1);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.1)}.weftmate-v2-page .toggle{position:relative;width:38px;height:22px;border-radius:11px;background:var(--weftmate-hairline-strong);border:1px solid var(--weftmate-hairline);cursor:pointer;padding:0;transition:background 120ms ease,border-color 120ms ease}.weftmate-v2-page .toggle::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.2);transition:transform 120ms ease}.weftmate-v2-page .toggle.on{background:var(--weftmate-accent);border-color:var(--weftmate-accent)}.weftmate-v2-page .toggle.on::after{transform:translateX(16px)}.weftmate-v2-page .mem-card{background:var(--weftmate-surface);border:1px solid var(--weftmate-hairline);border-radius:12px;padding:13px 15px;margin-bottom:10px}.weftmate-v2-page .mem-card .mc-rel{font-size:12.5px;line-height:1.6;color:var(--weftmate-ink-1)}.weftmate-v2-page .mem-card .mc-src{margin-top:8px;font-size:11px;color:var(--weftmate-ink-3);display:flex;gap:6px;align-items:center;flex-wrap:wrap}.weftmate-v2-page .src-tag{background:var(--weftmate-surface-2,rgba(128,128,128,0.12));border-radius:5px;padding:1px 7px;font-size:10px;color:var(--weftmate-ink-2)}.weftmate-v2-page .mem-chip{cursor:pointer;background:var(--weftmate-accent-soft);color:var(--weftmate-accent);padding:1px 7px;border-radius:5px;font-size:10px}.weftmate-v2-page .eyebrow{font-size:11px;font-weight:600;color:var(--weftmate-ink-3);letter-spacing:.08em;margin:24px 0 10px;display:flex;align-items:center;gap:8px}.weftmate-v2-page .eyebrow:first-child{margin-top:0}.weftmate-v2-page .eyebrow::after{content:"";flex:1;height:1px;background:var(--weftmate-hairline)}.weftmate-v2-settings-tabs{display:flex;gap:6px;align-items:center;padding:3px;background:var(--weftmate-surface-2,rgba(0,0,0,0.04));border:1px solid var(--weftmate-hairline);border-radius:10px}.weftmate-v2-settings-tabs .set-tab{padding:4px 10px;font-size:11.5px;border:none;background:none;border-radius:7px;color:var(--weftmate-ink-2);cursor:pointer;transition:all 120ms ease;white-space:nowrap}.weftmate-v2-settings-tabs .set-tab:hover{color:var(--weftmate-ink-1);background:var(--weftmate-surface)}.weftmate-v2-settings-tabs .set-tab.on{background:var(--weftmate-surface);color:var(--weftmate-accent);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.08)}.weftmate-v2-page .btn{padding:5px 12px;font-size:12px;border-radius:8px;cursor:pointer;border:1px solid var(--weftmate-hairline);background:var(--weftmate-surface);color:var(--weftmate-ink-1);transition:all 120ms ease;display:inline-flex;align-items:center;gap:5px}.weftmate-v2-page .btn:hover{background:var(--weftmate-surface-2,rgba(0,0,0,0.06))}.weftmate-v2-page .btn-primary{background:var(--weftmate-accent);color:#fff;border-color:var(--weftmate-accent)}.weftmate-v2-page .btn-primary:hover{opacity:0.9}.weftmate-v2-page .btn-sec{background:var(--weftmate-accent-soft);color:var(--weftmate-accent);border-color:transparent}.weftmate-v2-page .btn-ghost{background:transparent;border-color:var(--weftmate-hairline);color:var(--weftmate-ink-2)}.weftmate-v2-page .btn-sm{padding:3px 8px;font-size:11px}.weftmate-v2-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--weftmate-hairline)}.ph-panel-title{font-size:14px;font-weight:650;color:var(--weftmate-ink-1)}.ph-panel-desc{font-size:11.5px;color:var(--weftmate-ink-3);margin-top:2px}.ph-panel-act{display:flex;gap:8px;align-items:center}.provider-card,.preset-card{background:var(--weftmate-surface);border:1px solid var(--weftmate-hairline);border-radius:12px;padding:13px 16px;margin-bottom:10px;transition:border-color 120ms ease}.provider-card:hover,.preset-card:hover{border-color:var(--weftmate-accent-soft)}.preset-card.default{border-color:var(--weftmate-accent)}.pc-top,.psc-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.pc-brand,.psc-brand{display:flex;align-items:center;gap:8px}.status-dot{width:8px;height:8px;border-radius:50%;background:var(--weftmate-ink-3)}.status-dot.online{background:#10b981;box-shadow:0 0 6px rgba(16,185,129,0.4)}.provider-title,.preset-title{font-size:13px;font-weight:600;color:var(--weftmate-ink-1)}.protocol-badge{font-size:10.5px;padding:1px 7px;border-radius:5px;background:var(--weftmate-surface-2,rgba(0,0,0,0.06));color:var(--weftmate-ink-2);font-family:monospace}.preset-badge{font-size:10px;padding:1px 6px;border-radius:5px;background:var(--weftmate-accent-soft);color:var(--weftmate-accent);font-weight:600}.pc-actions,.psc-actions{display:flex;gap:6px;align-items:center}.pc-meta{margin-top:6px;font-size:11.5px;color:var(--weftmate-ink-3);display:flex;gap:10px}.pc-url{font-family:monospace}.pc-models{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}.model-tag{font-size:11px;padding:2px 8px;border-radius:6px;background:var(--weftmate-accent-soft);color:var(--weftmate-accent);display:inline-flex;align-items:center;gap:4px}.model-tag .mt-ctx{opacity:0.75;font-size:10px}.psc-desc{margin-top:6px;font-size:12px;color:var(--weftmate-ink-2);line-height:1.5}.psc-footer{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}.psc-tag{font-size:10.5px;padding:2px 7px;border-radius:5px;background:var(--weftmate-surface-2,rgba(0,0,0,0.06));color:var(--weftmate-ink-2)}.psc-tag.sub{background:var(--weftmate-accent-soft);color:var(--weftmate-accent)}.weftmate-v2-form-card{background:var(--weftmate-surface);border:1.5px solid var(--weftmate-accent);border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 4px 14px rgba(46,91,255,0.08)}.fc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--weftmate-hairline)}.fc-title{font-size:13px;font-weight:650;color:var(--weftmate-ink-1)}.fc-row{display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap}.fc-field{flex:1;min-width:200px}.fc-label{display:block;font-size:11px;font-weight:600;color:var(--weftmate-ink-2);margin-bottom:4px}.fc-input,.fc-select,.fc-textarea{width:100%;box-sizing:border-box;padding:6px 10px;font-size:12px;border-radius:7px;border:1px solid var(--weftmate-hairline);background:var(--weftmate-surface-2,rgba(0,0,0,0.03));color:var(--weftmate-ink-1);outline:none;transition:border-color 120ms ease}.fc-input:focus,.fc-select:focus,.fc-textarea:focus{border-color:var(--weftmate-accent)}.fc-subheading{font-size:11px;font-weight:650;color:var(--weftmate-ink-2);margin:10px 0 6px}.fc-model-row{display:flex;gap:8px;align-items:center;margin-bottom:6px}.fc-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;padding-top:10px;border-top:1px solid var(--weftmate-hairline)}.settings-feedback{background:var(--weftmate-accent-soft);color:var(--weftmate-accent);padding:8px 14px;border-radius:8px;font-size:12px;font-weight:500;margin-bottom:14px;display:flex;align-items:center;gap:8px;border:1px solid rgba(46,91,255,0.2)}.weftmate-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:20px}.weftmate-modal-panel{background:var(--weftmate-surface,#fff);border:1px solid var(--weftmate-hairline,rgba(0,0,0,0.1));border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,0.2);width:100%;max-width:620px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden}.wmp-head{padding:14px 18px;border-bottom:1px solid var(--weftmate-hairline);display:flex;align-items:center;justify-content:space-between}.wmp-title{font-size:14px;font-weight:650;color:var(--weftmate-ink-1)}.wmp-body{padding:16px 18px;overflow-y:auto;flex:1;font-size:12.5px;color:var(--weftmate-ink-2)}.wmp-desc{font-size:12px;color:var(--weftmate-ink-3);margin-bottom:12px;line-height:1.5}.wmp-code{background:var(--weftmate-surface-2,rgba(0,0,0,0.04));border:1px solid var(--weftmate-hairline);border-radius:8px;padding:12px;font-family:monospace;font-size:11.5px;line-height:1.55;max-height:360px;overflow:auto;white-space:pre}.wmp-foot{padding:12px 18px;border-top:1px solid var(--weftmate-hairline);display:flex;justify-content:flex-end;gap:8px}.creator-draft-btn{width:100%;box-sizing:border-box;border:1px dashed var(--weftmate-hairline-strong,rgba(0,0,0,0.2));border-radius:12px;height:42px;background:transparent;color:var(--weftmate-ink-2);font-size:13px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all 120ms ease;margin-top:10px}.creator-draft-btn:hover{background:var(--weftmate-surface-2,rgba(0,0,0,0.04));color:var(--weftmate-accent);border-color:var(--weftmate-accent)}.preset-group-heading{font-size:11px;font-weight:700;color:var(--weftmate-ink-3);letter-spacing:.06em;text-transform:uppercase;margin:16px 0 8px;display:flex;align-items:center;gap:6px}',
        '.weftmate-v2-sessions .sess-node,.weftmate-v2-sessions .sess-item{display:flex;align-items:center;gap:7px;min-width:0;padding:6px 8px;border-radius:8px;color:var(--weftmate-ink-2);cursor:pointer}.weftmate-v2-sessions .sess-node:hover,.weftmate-v2-sessions .sess-item:hover{background:var(--weftmate-surface-2);color:var(--weftmate-ink-1)}.weftmate-v2-sessions .sess-item.on{background:var(--weftmate-accent-soft);color:var(--weftmate-accent);font-weight:600}.weftmate-v2-sessions .sess-node .t,.weftmate-v2-sessions .sess-item .t{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.weftmate-v2-sessions .sess-sub>.sess-node.l2{padding-left:14px}.weftmate-v2-sessions .sess-sub .sess-sub>.sess-item{padding-left:30px}.weftmate-v2-sessions .sess-empty{padding:7px 10px 9px 30px;color:var(--weftmate-ink-3);font-size:11px}.weftmate-v2-sessions .sess-empty-global{padding:18px 12px;text-align:center}.weftmate-v2-work .wc-drawer-head{display:none;align-items:center;justify-content:space-between;padding:0 0 10px;margin-bottom:4px;border-bottom:1px solid var(--weftmate-hairline);font-size:12px;font-weight:650}.weftmate-v2-work .wc-drawer-close{border:0;background:transparent;color:var(--weftmate-ink-2);cursor:pointer;padding:3px 5px;border-radius:6px}.weftmate-v2-work .wc-drawer-close:hover{background:var(--weftmate-surface-2);color:var(--weftmate-ink-1)}.weftmate-v2-work .wc-eyebrow:not(:first-child){margin-top:18px}.weftmate-v2-work .wc-action,.weftmate-v2-work .wc-context{width:100%;border:0;background:transparent;text-align:left;border-radius:8px;cursor:pointer}.weftmate-v2-work .wc-action:hover,.weftmate-v2-work .wc-context:hover{background:var(--weftmate-surface-2)}.weftmate-v2-work .wc-copy{display:flex;flex:1;min-width:0;flex-direction:column}.weftmate-v2-work .wc-copy .t,.weftmate-v2-work .wc-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.weftmate-v2-work .wc-mini{font-size:10.5px;color:var(--weftmate-ink-3);line-height:1.35;margin-top:1px}.weftmate-v2-work .wc-go{color:var(--weftmate-ink-3);font-size:17px}.weftmate-v2-work .wc-empty{padding:13px 12px;border:1px dashed var(--weftmate-hairline);border-radius:10px;color:var(--weftmate-ink-3);font-size:11.5px;line-height:1.5}.weftmate-v2-status .st-link{border:0;background:transparent;color:inherit;padding:0;cursor:pointer}.weftmate-v2-status .st-link:hover b{color:var(--weftmate-accent)}',
        '@media(max-width:1240px){[data-weftmate-v2-frame]{--v2-work-inset:0px}.weftmate-v2-work{display:none}html[data-weftmate-v2-work-drawer-open] .weftmate-v2-work{display:flex;z-index:40;width:min(288px,calc(100vw - 60px));box-shadow:-10px 0 28px rgba(23,36,63,.16)}html[data-weftmate-v2-work-drawer-open] .weftmate-v2-work .wc-drawer-head{display:flex}}@media(max-width:980px){[data-weftmate-v2-frame]{--v2-side:60px}.weftmate-v2-head,.weftmate-v2-page{left:60px}[data-weftmate-v2-sidebar]{visibility:hidden!important;pointer-events:none!important}.weftmate-v2-rail{display:flex}}',
        'html[data-weftmate-v2-sessions-hidden] [data-weftmate-v2-frame]{--v2-side:60px}html[data-weftmate-v2-sessions-hidden] [data-weftmate-v2-sidebar]{visibility:hidden!important;pointer-events:none!important}html[data-weftmate-v2-work-hidden] [data-weftmate-v2-frame]{--v2-work-inset:0px}html[data-weftmate-v2-work-hidden] .weftmate-v2-work{display:none}',
      ].join('\n')
      document.head.appendChild(style)
    }

    // Fixed-version central presentation only.  The official conversation and
    // InputBar keep ownership of the message stream, draft, attachments, and
    // submit choreography; these selectors only map their rendered surface to
    // the accepted V2 dimensions.
    function installV2CentralConversationStyle() {
      if (!document || !document.head || document.getElementById('weftmate-v2-central-style')) return
      var style = document.createElement('style')
      style.id = 'weftmate-v2-central-style'
      style.textContent = [
        '[data-weftmate-v2-center] div[data-phase]{--dsh-chat-content-width:760px!important;--dsh-composer-card-max-width:760px!important;--dsh-composer-side-clearance:0px!important}',
        '[data-weftmate-v2-center] [data-conversation-scroll]{min-height:0;background:var(--weftmate-bg-base)}',
        '[data-weftmate-v2-center] [data-chat-flow]{box-sizing:border-box;max-width:760px!important;margin:0 auto;padding:20px 20px 10px;gap:14px}',
        '[data-weftmate-v2-center] [data-chat-flow-kind="user"] ._9tYwcG_bubble{max-width:78%;background:var(--weftmate-accent);color:#fff;padding:8px 14px;border-radius:14px 14px 4px 14px;font-size:14px!important;line-height:1.55!important}',
        '[data-weftmate-v2-center] [data-chat-flow-kind="assistant-step"]>div{max-width:100%;font-size:14px!important;line-height:1.62!important;color:var(--weftmate-ink-1)}',
        '[data-weftmate-v2-center] .myYWpG_root{font-size:14px!important;line-height:1.62!important}',
        '[data-weftmate-v2-center] .myYWpG_root p,[data-weftmate-v2-center] [data-chat-flow-kind="assistant-step"] p{font-size:14px!important;line-height:1.62!important;margin:0 0 8px!important}',
        '[data-weftmate-v2-center] .myYWpG_root p:last-child{margin-bottom:0!important}',
        '[data-weftmate-v2-center] .myYWpG_body{gap:8px!important}',
        '[data-weftmate-v2-center] .myYWpG_root ul,[data-weftmate-v2-center] .myYWpG_root ol{margin:4px 0 8px 18px!important;padding:0!important;font-size:14px!important;line-height:1.6!important}',
        '[data-weftmate-v2-center] .myYWpG_root li{margin-bottom:2px!important;font-size:14px!important;line-height:1.6!important}',
        '[data-weftmate-v2-center] .myYWpG_root h1{font-size:18px!important;line-height:1.4!important;margin:12px 0 6px!important}',
        '[data-weftmate-v2-center] .myYWpG_root h2{font-size:16px!important;line-height:1.4!important;margin:10px 0 5px!important}',
        '[data-weftmate-v2-center] .myYWpG_root h3{font-size:14.5px!important;line-height:1.4!important;margin:8px 0 4px!important}',
        '[data-weftmate-v2-center] .myYWpG_root pre{margin:8px 0!important;padding:10px 12px!important;border-radius:10px!important;font-size:12.5px!important;line-height:1.5!important}',
        '[data-weftmate-v2-center] .myYWpG_root code:not(pre code){font-size:12.5px!important;padding:2px 5px!important;border-radius:4px!important}',
        '[data-weftmate-v2-center] [data-variant="think"],[data-weftmate-v2-center] [data-chat-flow-kind="thought"],[data-weftmate-v2-center] ._4Q3JqA_root{font-size:12px!important;line-height:1.5!important;padding:6px 10px!important}',
        '[data-weftmate-v2-center] ._0_p9YG_header{box-sizing:border-box;min-height:36px;height:36px;padding:4px 24px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--weftmate-hairline);background:var(--weftmate-surface)}[data-weftmate-v2-center] ._0_p9YG_header:after{display:none}',
        '[data-weftmate-v2-center] ._0_p9YG_header._0_p9YG_headerHidden,[data-weftmate-v2-center] ._0_p9YG_header:not(:has(._0_p9YG_crumbs button:not(:disabled))){display:none!important}',
        '[data-weftmate-v2-center] ._0_p9YG_titleRow,[data-weftmate-v2-center] ._0_p9YG_titleCluster{display:contents}',
        '[data-weftmate-v2-center] ._0_p9YG_crumbs>._0_p9YG_crumbCurrent:only-child,[data-weftmate-v2-center] ._0_p9YG_crumbSeg:has(._0_p9YG_crumb:disabled){display:none}[data-weftmate-v2-center] ._0_p9YG_crumbs:not(:has(button:not(:disabled))){display:none}',
        '[data-weftmate-v2-center] ._0_p9YG_headerActions,[data-weftmate-v2-center] ._0_p9YG_tabs,[data-weftmate-v2-center] ._0_p9YG_headerUtilities{display:none!important}',
        '[data-weftmate-v2-center] [data-composer-seat]{box-sizing:border-box;padding:12px 24px 14px;background:linear-gradient(to top,var(--weftmate-bg-base) 62%,transparent)}',
        '[data-weftmate-v2-center] .JxB0ia_root{padding:0!important}',
        '[data-weftmate-v2-center] [data-composer-card]{box-sizing:border-box;width:100%;max-width:760px!important;background:var(--weftmate-glass-bg);border:1px solid var(--weftmate-glass-border);border-radius:var(--weftmate-r-panel);backdrop-filter:var(--weftmate-glass-blur);-webkit-backdrop-filter:var(--weftmate-glass-blur);box-shadow:var(--weftmate-shadow-2);padding:12px 14px;gap:0;font-size:14px;line-height:1.55}',
        '[data-weftmate-v2-center] [data-composer-card]:focus-within{border-color:var(--weftmate-brand-500)}',
        '[data-weftmate-v2-center] [data-input-scroll],[data-weftmate-v2-center] [data-input-scroll]>div,[data-weftmate-v2-center] [data-input-mirror]{min-height:44px;max-height:calc(var(--dsh-composer-text-max-height) + 8px)}',
        '[data-weftmate-v2-center] div[data-phase="hero"] .JxB0ia_mirror{min-height:44px!important}',
        '[data-weftmate-v2-center] [data-composer-card] textarea,[data-weftmate-v2-center] [data-input-backdrop],[data-weftmate-v2-center] [data-input-mirror]{padding:0;font-family:var(--weftmate-font-sans);font-size:14px;line-height:1.55}',
        '[data-weftmate-v2-center] .JxB0ia_row{margin-top:8px;padding:0;gap:6px}',
        '[data-weftmate-v2-center] .JxB0ia_primary{width:30px;height:30px;border-radius:9px;background:var(--weftmate-accent);transform:none}',
        '[data-weftmate-v2-center] .JxB0ia_primary:hover:not(:disabled){background:var(--weftmate-accent-active)}',
        '[data-weftmate-v2-center] div[data-phase="hero"] [data-conversation-scroll]{display:flex;flex-direction:column;min-height:0}[data-weftmate-v2-center] div[data-phase="hero"] [data-conversation-scroll]::before{display:none!important}',
        '[data-weftmate-v2-center] div[data-phase="hero"] [data-composer-seat]{flex:1;min-height:0;display:flex;flex-direction:column}',
        '[data-weftmate-v2-center] div[data-phase="hero"] .JxB0ia_root{flex:0;justify-content:flex-end}[data-weftmate-v2-center] div[data-phase="hero"] [data-weftmate-hero-composer]{position:static!important;transform:none!important;display:flex;flex-direction:column;justify-content:center;flex:1;width:min(760px,100%)!important;height:100%;margin:0 auto!important;padding:0!important}[data-weftmate-v2-center] ._0_p9YG_heroGlow{display:none!important}',
        '.weftmate-v2-conversation-hero{box-sizing:border-box;order:-1;flex:1;width:100%;max-width:760px;margin:0;padding:6vh 24px 10px}',
        '.weftmate-v2-conversation-hero .greet{font-size:26px;font-weight:800;letter-spacing:-.01em}.weftmate-v2-conversation-hero .greet-sub{font-size:12.5px;color:var(--weftmate-ink-3);margin-top:6px}.weftmate-v2-conversation-hero .quick-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.weftmate-v2-conversation-hero .qchip{font:inherit;font-size:12px;color:var(--weftmate-ink-2);background:var(--weftmate-surface);border:1px solid var(--weftmate-hairline);border-radius:var(--weftmate-r-pill);padding:6px 14px;cursor:pointer}.weftmate-v2-conversation-hero .qchip:hover{border-color:var(--weftmate-brand-500);color:var(--weftmate-accent-active);background:var(--weftmate-accent-soft)}',
        '.weftmate-v2-hero-hint{order:1;max-width:760px;margin:0 auto;padding-top:8px;color:var(--weftmate-ink-3);font-size:11px;line-height:1.55;text-align:center}',
        '.weftmate-v2-composer-hint{max-width:760px;margin:0 auto;padding-top:8px;color:var(--weftmate-ink-3);font-size:11px;line-height:1.55;text-align:center}',
      ].join('\n')
      document.head.appendChild(style)
    }

    function V2ConversationHero(props) {
      if (!props.session || props.session.blank !== true || !props.input || props.input.phase !== 'plain' || !props.inputActions) return null
      var chips = ['帮我收藏一个链接', '做一个桌面宠物', '整理本周记忆', '你是什么模型？']
      function putDraft(text) {
        var draft = props.input.draft || ''
        props.inputActions.setDraft(draft.length ? draft + (/[\s\n]$/.test(draft) ? '' : '\n') + text : text)
      }
      function openCmdk() {
        if (typeof window.weftmateOpenCmdk === 'function') window.weftmateOpenCmdk()
      }
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'weftmate-v2-conversation-hero chat-hero' },
          React.createElement('div', { className: 'greet' }, '晚上好。'),
          React.createElement('div', { className: 'greet-sub' }, '说句话，开始新的对话。'),
          React.createElement('div', { className: 'quick-chips' }, chips.map(function (text) { return React.createElement('button', { key: text, className: 'qchip', type: 'button', onClick: function () { putDraft(text) } }, text) }))
        ),
        React.createElement('div', { className: 'weftmate-v2-hero-hint chat-hint' },
          'Enter 发送 · Shift+Enter 换行',
          ' · ',
          React.createElement('b', { id: 'hintCmdk', role: 'button', tabIndex: 0, style: { cursor: 'pointer' }, onClick: openCmdk, onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCmdk() } } }, 'Ctrl+K / ⌘K 命令面板')
        )
      )
    }

    function V2ComposerHint(props) {
      if (!props.session) return null
      function openCmdk() {
        if (typeof window.weftmateOpenCmdk === 'function') window.weftmateOpenCmdk()
      }
      return React.createElement('div', { className: 'weftmate-v2-composer-hint chat-hint' },
        'Enter 发送 · Shift+Enter 换行',
        ' · ',
        React.createElement('b', { id: 'hintCmdk', role: 'button', tabIndex: 0, style: { cursor: 'pointer' }, onClick: openCmdk, onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCmdk() } } }, 'Ctrl+K / ⌘K 命令面板')
      )
    }

    function v2ChatTitle(session) {
      if (!session || session.blank) return '新的对话'
      return session.displayTitle || session.title || '新的对话'
    }

    function installFrozenV2ShellCss() {
      if (!document || !document.head) return
      ;['skeleton', 'pages'].forEach(function (name) {
        var id = 'weftmate-v2-' + name + '-css'
        if (document.getElementById(id)) return
        var link = document.createElement('link')
        link.id = id; link.rel = 'stylesheet'; link.href = '/weftmate/shell/' + name + '.css'
        document.head.appendChild(link)
      })
    }

    function v2WorkbenchVisible(root, frame, width) {
      var detailsOpen = !!frame && !frame.hasAttribute('data-details-collapsed')
      if (detailsOpen) return false
      if (width <= 1240) return root.hasAttribute('data-weftmate-v2-work-drawer-open')
      return !root.hasAttribute('data-weftmate-v2-work-hidden')
    }

    function toggleV2Workbench() {
      var root = document.documentElement
      if (window.innerWidth <= 1240) root.toggleAttribute('data-weftmate-v2-work-drawer-open')
      else root.toggleAttribute('data-weftmate-v2-work-hidden')
    }

    function closeV2WorkbenchDrawer() {
      document.documentElement.removeAttribute('data-weftmate-v2-work-drawer-open')
    }

    function useV2ColumnVisibility() {
      function read() {
        var root = document.documentElement
        var overlay = document.querySelector('[data-shell-overlay]')
        var frame = document.querySelector('[data-weftmate-v2-frame]') || overlay && overlay.parentElement
        var sessions = window.innerWidth > 980 && !root.hasAttribute('data-weftmate-v2-sessions-hidden')
        var work = v2WorkbenchVisible(root, frame, window.innerWidth)
        return { sessions: sessions, work: work }
      }
      var state = React.useState(read), visibility = state[0], setVisibility = state[1]
      React.useEffect(function () {
        var root = document.documentElement
        var frame = document.querySelector('[data-weftmate-v2-frame]')
        var update = function () { setVisibility(read()) }
        var rootObserver = new MutationObserver(update)
        rootObserver.observe(root, { attributes: true, subtree: true, attributeFilter: ['data-weftmate-v2-sessions-hidden', 'data-weftmate-v2-work-hidden', 'data-weftmate-v2-work-drawer-open', 'data-weftmate-v2-frame', 'data-details-collapsed'] })
        var frameObserver = frame ? new MutationObserver(update) : null
        if (frameObserver) frameObserver.observe(frame, { attributes: true, attributeFilter: ['data-details-collapsed'] })
        window.addEventListener('resize', update)
        update()
        return function () { rootObserver.disconnect(); if (frameObserver) frameObserver.disconnect(); window.removeEventListener('resize', update) }
      }, [])
      return visibility
    }

    function installSettingsRailTriggerAdapter() {
      var sidebar = document.querySelector('[data-weftmate-v2-sidebar]')
      if (!sidebar) return function () {}
      var apply = function () {
        var seat = sidebar.querySelector('.oC7kBG_settingsArea')
        var trigger = seat && seat.querySelector('button')
        if (!trigger) return
        var label = trigger.getAttribute('data-weftmate-settings-label') || trigger.textContent.trim() || '设置'
        trigger.setAttribute('data-weftmate-settings-label', label)
        trigger.setAttribute('aria-label', label)
        trigger.setAttribute('title', label)
      }
      apply()
      var observer = new MutationObserver(apply)
      observer.observe(sidebar, { childList: true, subtree: true })
      return function () { observer.disconnect() }
    }

    // This is a projection only.  Host list/workspace snapshots remain the
    // durable authority; the small preference payload stores no session data.
    function readSidebarPreferences() {
      try {
        var raw = window.localStorage.getItem('weftmate-v2-session-sidebar')
        var value = raw && JSON.parse(raw)
        return { pinned: value && Array.isArray(value.pinned) ? value.pinned : [], pinnedWorkspaces: value && Array.isArray(value.pinnedWorkspaces) ? value.pinnedWorkspaces : [], collapsed: value && Array.isArray(value.collapsed) ? value.collapsed : [] }
      } catch (_) { return { pinned: [], pinnedWorkspaces: [], collapsed: [] } }
    }

    function saveSidebarPreferences(pinned, collapsed, pinnedWorkspaces) {
      try { window.localStorage.setItem('weftmate-v2-session-sidebar', JSON.stringify({ pinned: Array.from(pinned), pinnedWorkspaces: Array.from(pinnedWorkspaces), collapsed: Array.from(collapsed) })) } catch (_) {}
    }

    function sidebarTime(updatedAt) {
      if (!updatedAt) return ''
      var date = new Date(updatedAt)
      if (isNaN(date.getTime())) return ''
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    function isSidebarVisibleSession(session, archived, current) {
      return !!session && session.origin !== 'subagent' && !archived.has(session.id) && (!session.blank || session.id === current)
    }

    function deriveV2SessionGroups(sessionsState, workspaceState) {
      var empty = { ready: false, projects: [], recent: [] }
      if (!sessionsState || !workspaceState || sessionsState.phase !== 'ready' || workspaceState.phase !== 'ready') return empty
      var archived = new Set(workspaceState.archivedSessionIds || [])
      var byId = sessionsState.byId || {}, current = sessionsState.current, ids = sessionsState.ids || [], used = new Set()
      function visible(id) { return isSidebarVisibleSession(byId[id], archived, current) && !used.has(id) }
      function take(source) { return source.filter(visible).map(function (id) { used.add(id); return byId[id] }) }
      var all = ids.filter(function (id) { return isSidebarVisibleSession(byId[id], archived, current) })
      var projects = (workspaceState.items || []).map(function (workspace) {
        return { workspace: workspace, sessions: take(workspace.sessionIds || []) }
      })
      var recent = take(all.slice().sort(function (a, b) { return Number(byId[b].updatedAt || 0) - Number(byId[a].updatedAt || 0) }))
      return { ready: true, projects: projects, recent: recent }
    }

    function waitForSidebarSnapshot(store, accepted) {
      return new Promise(function (resolve, reject) {
        var settled = false, unsubscribe = function () {}, timer
        function finish(error) { if (settled) return; settled = true; clearTimeout(timer); unsubscribe(); error ? reject(error) : resolve() }
        function inspect() { try { if (accepted(store.getSnapshot())) finish() } catch (error) { finish(error) } }
        unsubscribe = store.subscribe(inspect)
        inspect()
        timer = setTimeout(function () { finish(new Error('服务已返回，但正式列表尚未回显；未将操作标记为成功。')) }, 4000)
      })
    }

    // React state is committed after an event handler returns.  Sidebar actions
    // also need a synchronous latch so two clicks in the same turn cannot send
    // two host create requests before `busy` is rendered.
    function createSidebarActionGate() {
      var pending = false
      return { begin: function () { if (pending) return false; pending = true; return true }, finish: function () { pending = false }, pending: function () { return pending } }
    }

    function downloadSessionLog(sessionId) {
      if (!sessionId) return
      var url = new URL('/api/session.export', window.location.origin)
      url.searchParams.set('sessionId', sessionId)
      url.searchParams.set('includeDescendants', 'true')
      var filename = 'dsh-session-' + String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_') + '.zip'
      var anchor = document.createElement('a')
      anchor.href = url.toString()
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
    }

    function V2SessionSidebar(props) {
      var sessionsState = React.useSyncExternalStore(function (notify) { return props.sessions.list.subscribe(notify) }, function () { return props.sessions.list.getSnapshot() })
      var workspaceState = React.useSyncExternalStore(function (notify) { return props.workspaces.list.subscribe(notify) }, function () { return props.workspaces.list.getSnapshot() })
      var prefState = React.useState(readSidebarPreferences), preferences = prefState[0], setPreferences = prefState[1]
      var menuState = React.useState(null), menu = menuState[0], setMenu = menuState[1]
      var renameState = React.useState(null), renaming = renameState[0], setRenaming = renameState[1]
      var feedbackState = React.useState(''), feedback = feedbackState[0], setFeedback = feedbackState[1]
      var busyState = React.useState(false), busy = busyState[0], setBusy = busyState[1]
      var actionGateRef = React.useRef(null)
      if (!actionGateRef.current) actionGateRef.current = createSidebarActionGate()
      var projectCreateState = React.useState(false), projectCreateOpen = projectCreateState[0], setProjectCreateOpen = projectCreateState[1]
      var projectPathState = React.useState(''), projectPath = projectPathState[0], setProjectPath = projectPathState[1]
      var directoryState = React.useState({ loading: false, listing: null, error: '' }), directory = directoryState[0], setDirectory = directoryState[1]
      var current = sessionsState && sessionsState.current
      var sidebarThemeState = React.useState(document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'), sidebarTheme = sidebarThemeState[0], setSidebarTheme = sidebarThemeState[1]
      React.useEffect(function () { var update = function () { setSidebarTheme(document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light') }; var observer = new MutationObserver(update); observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] }); return function () { observer.disconnect() } }, [])
      var projection = deriveV2SessionGroups(sessionsState, workspaceState)
      var ready = projection.ready, projects = projection.projects, recent = projection.recent
      var archived = new Set(workspaceState && workspaceState.archivedSessionIds || [])
      var byId = sessionsState && sessionsState.byId || {}
      var pinned = new Set(preferences.pinned.filter(function (id) { return !!byId[id] && isSidebarVisibleSession(byId[id], archived, current) }))
      var pinnedWorkspaces = new Set(preferences.pinnedWorkspaces.filter(function (id) { return projects.some(function (group) { return group.workspace.workspaceId === id }) }))
      var collapsed = new Set(preferences.collapsed)
      function updatePreferences(nextPinned, nextCollapsed, nextPinnedWorkspaces) { saveSidebarPreferences(nextPinned, nextCollapsed, nextPinnedWorkspaces); setPreferences({ pinned: Array.from(nextPinned), pinnedWorkspaces: Array.from(nextPinnedWorkspaces), collapsed: Array.from(nextCollapsed) }) }
      function toggleCollapsed(key) { var next = new Set(collapsed); next.has(key) ? next.delete(key) : next.add(key); updatePreferences(pinned, next, pinnedWorkspaces) }
      function togglePin(id) { var next = new Set(pinned); next.has(id) ? next.delete(id) : next.add(id); updatePreferences(next, collapsed, pinnedWorkspaces) }
      function toggleWorkspacePin(id) { var next = new Set(pinnedWorkspaces); next.has(id) ? next.delete(id) : next.add(id); updatePreferences(pinned, collapsed, next) }
      function closeMenu() { setMenu(null) }
      React.useEffect(function () {
        var escape = function (event) { if (event.key === 'Escape') { closeMenu(); setRenaming(null) } }
        document.addEventListener('keydown', escape)
        return function () { document.removeEventListener('keydown', escape) }
      }, [])
      function run(label, operation, successLabel) {
        if (!actionGateRef.current.begin()) return
        setBusy(true); setFeedback('')
        Promise.resolve().then(operation).then(function () { setFeedback(successLabel === undefined ? label : successLabel) }, function (error) { setFeedback((error && error.message) || '操作未完成，请检查连接后重试。') }).finally(function () { actionGateRef.current.finish(); setBusy(false) })
      }
      function open(id) { if (id && id !== current) { try { props.sessions.open(id) } catch (error) { setFeedback((error && error.message) || '无法打开该会话。') } } }
      function start(workspaceId) { run('正在准备个人工作区并创建新会话…', function () { return props.startSession(workspaceId) }, '') }
      function browseProjectDirectory(path) {
        if (!actionGateRef.current.begin()) return
        setBusy(true); setDirectory({ loading: true, listing: null, error: '' })
        Promise.resolve().then(function () {
          if (!props.workspaces || typeof props.workspaces.listDirectory !== 'function') throw new Error('当前宿主没有可用的目录浏览入口。')
          return props.workspaces.listDirectory(path)
        }).then(function (listing) {
          if (!listing || typeof listing.path !== 'string' || !Array.isArray(listing.entries)) throw new Error('目录浏览未返回有效结果。')
          setDirectory({ loading: false, listing: listing, error: '' })
        }, function (error) {
          var message = (error && error.message) || '目录读取失败，请重试。'
          setDirectory({ loading: false, listing: null, error: message }); setFeedback(message)
        }).finally(function () { actionGateRef.current.finish(); setBusy(false) })
      }
      function openProjectCreate() { setProjectPath(''); setDirectory({ loading: false, listing: null, error: '' }); setProjectCreateOpen(true); setFeedback(''); browseProjectDirectory() }
      function pickProjectDirectory() {
        browseProjectDirectory(projectPath || undefined)
      }
      function createProjectWorkspace() {
        var path = String(projectPath || '').trim()
        if (!path) { setFeedback('请先选择项目目录。'); return }
        run('正在创建项目…', async function () {
          if (!props.workspaces || typeof props.workspaces.create !== 'function') throw new Error('当前宿主不能创建项目。')
          var workspace = await props.workspaces.create({ path: path })
          if (!workspace || typeof workspace.workspaceId !== 'string') throw new Error('项目创建未返回有效结果。')
          await waitForSidebarSnapshot(props.workspaces.list, function (state) { return (state.items || []).some(function (item) { return item.workspaceId === workspace.workspaceId }) })
          setProjectCreateOpen(false)
          return props.startSession(workspace.workspaceId)
        }, '已创建项目并打开新会话。')
      }
      function renameSession(id, title) {
        var clean = String(title || '').trim(); if (!clean) { setRenaming(null); return }
        run('已重命名。', async function () { var binding = props.sessions.binding(id); if (!binding || !binding.session) throw new Error('会话已不可用，未提交重命名。'); var result = await binding.session.rename(clean); if (!result || !result.ok) throw new Error(result && result.error && result.error.message || '重命名被服务拒绝。'); await waitForSidebarSnapshot(props.sessions.list, function (state) { var session = state.byId && state.byId[id]; return !!session && (session.title === clean || session.displayTitle === clean) }) })
        setRenaming(null)
      }
      function renameWorkspace(workspaceId, title) {
        var clean = String(title || '').trim(); if (!clean) { setRenaming(null); return }
        run('项目已重命名。', async function () { await props.workspaces.rename(workspaceId, clean); await waitForSidebarSnapshot(props.workspaces.list, function (state) { return (state.items || []).some(function (item) { return item.workspaceId === workspaceId && item.title === clean }) }) })
        setRenaming(null)
      }
      function archive(id) { run('已归档。', async function () { await props.workspaces.archiveSession(id); await waitForSidebarSnapshot(props.workspaces.list, function (state) { return (state.archivedSessionIds || []).indexOf(id) >= 0 }) }) }
      function moveToProjectTop(workspaceId, id) { var workspace = (workspaceState.items || []).find(function (item) { return item.workspaceId === workspaceId }); var beforeId = workspace && (workspace.sessionIds || []).find(function (candidate) { return candidate !== id }); run('已移到项目顶部。', async function () { await props.workspaces.insertSessionBefore(workspaceId, id, beforeId); await waitForSidebarSnapshot(props.workspaces.list, function (state) { var item = (state.items || []).find(function (candidate) { return candidate.workspaceId === workspaceId }); return !!item && item.sessionIds && item.sessionIds[0] === id }) }) }
      function beginRename(kind, id, title) { closeMenu(); setRenaming({ kind: kind, id: id, value: title }) }
      function menuAt(event, target) { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, target: target }) }
      function renderRename(rename) {
        return React.createElement('input', { className: 'input sess-rename', autoFocus: true, defaultValue: rename.value, 'aria-label': '重命名', onClick: function (event) { event.stopPropagation() }, onKeyDown: function (event) { if (event.key === 'Enter') { event.preventDefault(); rename.kind === 'session' ? renameSession(rename.id, event.currentTarget.value) : renameWorkspace(rename.id, event.currentTarget.value) } else if (event.key === 'Escape') { event.preventDefault(); setRenaming(null) } }, onBlur: function (event) { rename.kind === 'session' ? renameSession(rename.id, event.currentTarget.value) : renameWorkspace(rename.id, event.currentTarget.value) } })
      }
      function renderSession(session, workspaceId) {
        var id = session.id, state = session.pendingInteraction ? 'pending' : session.running ? 'running' : session.completed ? 'completed' : ''
        var title = session.displayTitle || session.title || id
        if (renaming && renaming.kind === 'session' && renaming.id === id) return React.createElement('div', { key: id, className: 'sess-item on' }, renderRename(renaming))
        return React.createElement('div', { key: id, className: 'sess-item' + (id === current ? ' on' : ''), role: 'button', tabIndex: 0, onClick: function () { open(id) }, onKeyDown: function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(id) } else if (event.key === 'ContextMenu') { menuAt(event, { kind: 'session', id: id, title: title, workspaceId: workspaceId }) } }, onContextMenu: function (event) { menuAt(event, { kind: 'session', id: id, title: title, workspaceId: workspaceId }) } }, pinned.has(id) ? pinIcon('已置顶') : null, React.createElement('span', { className: 't' }, title), state ? React.createElement('span', { className: 'sess-state ' + state, 'aria-label': state === 'pending' ? '等待回答' : state === 'running' ? '运行中' : '已完成' }) : null, React.createElement('span', { className: 'd' }, sidebarTime(session.updatedAt)), React.createElement('button', { className: 'mini', type: 'button', 'aria-label': '会话菜单', onClick: function (event) { menuAt(event, { kind: 'session', id: id, title: title, workspaceId: workspaceId }) } }, '⋯'))
      }
      function pinIcon(label) { return React.createElement('svg', { className: 'pin-ic', viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-label': label }, React.createElement('path', { d: 'M9 4h6l-1 7 3 3v2H7v-2l3-3-1-7z' }), React.createElement('path', { d: 'M12 16v5' })) }
      function chevron(closed) { return React.createElement('svg', { className: 'chev', viewBox: '0 0 24 24', 'aria-hidden': 'true', style: closed ? { transform: 'rotate(-90deg)' } : undefined }, React.createElement('path', { d: 'M6 9l6 6 6-6' })) }
      function folderIcon(closed) { return React.createElement('svg', { className: 'node-symbol', viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, closed ? React.createElement('path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' }) : [React.createElement('path', { key: 'a', d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2H3V7z' }), React.createElement('path', { key: 'b', d: 'M3 11h18l-2 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8z' })]) }
      function renderGroup(key, label, members, workspace) {
        var closed = collapsed.has(key)
        if (renaming && renaming.kind === 'workspace' && workspace && renaming.id === workspace.workspaceId) return React.createElement('div', { key: key, className: 'sess-node l2' }, renderRename(renaming))
        var workspacePinned = workspace && pinnedWorkspaces.has(workspace.workspaceId)
        return React.createElement(React.Fragment, { key: key }, React.createElement('div', { className: 'sess-node l2' + (closed ? ' closed' : ''), role: 'button', tabIndex: 0, onClick: function () { toggleCollapsed(key) }, onKeyDown: function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCollapsed(key) } else if (event.key === 'ContextMenu' && workspace) { menuAt(event, { kind: 'workspace', id: workspace.workspaceId, title: workspace.title || workspace.path || workspace.workspaceId }) } }, onContextMenu: workspace ? function (event) { menuAt(event, { kind: 'workspace', id: workspace.workspaceId, title: workspace.title || workspace.path || workspace.workspaceId }) } : undefined }, chevron(closed), workspace ? folderIcon(closed) : null, React.createElement('span', { className: 't' }, label), workspacePinned ? pinIcon('项目已置顶') : null, workspace ? React.createElement('span', { className: 'acts' }, React.createElement('button', { className: 'mini', type: 'button', title: '在此新建对话', 'aria-label': '在项目中新建会话', onClick: function (event) { event.stopPropagation(); start(workspace.workspaceId) }, onKeyDown: function (event) { event.stopPropagation() } }, '＋'), React.createElement('button', { className: 'mini', type: 'button', 'aria-label': '项目菜单', onClick: function (event) { menuAt(event, { kind: 'workspace', id: workspace.workspaceId, title: workspace.title || workspace.path || workspace.workspaceId }) }, onKeyDown: function (event) { event.stopPropagation() } }, '⋯')) : null), React.createElement('div', { className: 'sess-sub' + (closed ? ' hide' : '') }, members.length ? members.slice().sort(function (a, b) { return (pinned.has(b.id) ? 1 : 0) - (pinned.has(a.id) ? 1 : 0) }).map(function (session) { return renderSession(session, workspace && workspace.workspaceId) }) : React.createElement('div', { className: 'sess-empty' }, workspace ? '尚无对话，悬停点 ＋ 新建' : '暂无会话')))
      }
      function renderRoot(key, label, children, action) { var closed = collapsed.has(key); return React.createElement(React.Fragment, { key: key }, React.createElement('div', { className: 'sess-node' + (closed ? ' closed' : ''), role: 'button', tabIndex: 0, onClick: function () { toggleCollapsed(key) }, onKeyDown: function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCollapsed(key) } } }, chevron(closed), React.createElement('span', { className: 't' }, label), action ? React.createElement('span', { className: 'acts' }, React.createElement('button', { className: 'mini', type: 'button', title: action.title, 'aria-label': action.label, disabled: busy || !ready, onClick: function (event) { event.preventDefault(); event.stopPropagation(); action.run() }, onKeyDown: function (event) { event.stopPropagation() } }, '＋')) : null), React.createElement('div', { className: 'sess-sub' + (closed ? ' hide' : '') }, children)) }
      function renderMenu() {
        if (!menu) return null
        var target = menu.target
        var style = { left: Math.max(8, Math.min(menu.x, window.innerWidth - 210)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 220)) }
        function item(label, select, unavailable, danger, hint) { return React.createElement('div', { className: 'ctx-item' + (danger ? ' danger' : ''), role: 'menuitem', tabIndex: unavailable ? -1 : 0, 'aria-disabled': unavailable ? 'true' : undefined, title: unavailable || hint || undefined, onClick: unavailable ? undefined : select, onKeyDown: unavailable ? undefined : function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } } }, label) }
        function separator() { return React.createElement('div', { className: 'ctx-sep', role: 'separator' }) }
        if (target.kind === 'workspace') return React.createElement('div', { className: 'ctx-menu open', role: 'menu', style: style }, item(pinnedWorkspaces.has(target.id) ? '取消置顶项目' : '置顶项目', function () { closeMenu(); toggleWorkspacePin(target.id) }, null, false, '本机视图偏好，不会同步到项目或会话。'), item('重命名项目', function () { beginRename('workspace', target.id, target.title) }), item('在项目中新建会话', function () { closeMenu(); start(target.id) }), separator(), item('归档项目（暂无正式接口）', null, '当前没有正式项目归档接口。'))
        return React.createElement('div', { className: 'ctx-menu open', role: 'menu', style: style }, item(pinned.has(target.id) ? '取消置顶' : '置顶', function () { closeMenu(); togglePin(target.id) }, null, false, '本机视图偏好，不会同步到会话或消息。'), item('重命名', function () { beginRename('session', target.id, target.title) }), target.workspaceId ? item('移到项目顶部', function () { closeMenu(); moveToProjectTop(target.workspaceId, target.id) }) : item('移动到项目（暂无正式接口）', null, '当前没有将会话加入或移出项目的正式接口。'), item('下载对话记录', function () { closeMenu(); downloadSessionLog(target.id) }), separator(), item('归档', function () { closeMenu(); archive(target.id) }), item('删除（暂无正式接口）', null, '当前没有正式删除会话或取消归档接口。', true))
      }
      var roots = []
      roots.push(renderRoot('projects', '项目', projects.length ? projects.slice().sort(function (a, b) { return (pinnedWorkspaces.has(b.workspace.workspaceId) ? 1 : 0) - (pinnedWorkspaces.has(a.workspace.workspaceId) ? 1 : 0) }).map(function (group) { return renderGroup('workspace:' + group.workspace.workspaceId, group.workspace.title || group.workspace.path || group.workspace.workspaceId, group.sessions, group.workspace) }) : React.createElement('div', { className: 'sess-empty' }, '尚无项目，点 ＋ 新建。'), { title: '新建项目', label: '新建项目', run: openProjectCreate }))
      if (recent.length) roots.push(renderGroup('recent', '最近', recent))
      if (!roots.length) roots.push(React.createElement('div', { key: 'empty', className: 'sess-empty sess-empty-global' }, '还没有可显示的会话，点击上方按钮开始。'))
      var directoryEntries = directory.listing && directory.listing.entries || []
      var projectDirectoryList = React.createElement('div', { style: { maxHeight: '180px', overflow: 'auto', marginTop: '10px', border: '1px solid var(--weftmate-hairline)', borderRadius: '8px' } }, directoryEntries.map(function (entry) {
        return React.createElement('button', { key: entry.path, className: 'btn btn-ghost', type: 'button', style: { display: 'block', width: '100%', textAlign: 'left' }, onClick: function () { setProjectPath(entry.path); browseProjectDirectory(entry.path) } }, '📁 ', entry.name || entry.path)
      }), directory.error ? React.createElement('div', { role: 'alert', style: { padding: '8px' } }, directory.error) : null)
      var projectCreateForm = React.createElement('form', { style: { width: 'min(520px, 100%)', padding: '18px', borderRadius: '12px', background: 'var(--weftmate-surface)', color: 'inherit', border: '1px solid var(--weftmate-hairline)', boxShadow: 'var(--weftmate-shadow-3)' }, onClick: function (event) { event.stopPropagation() }, onSubmit: function (event) { event.preventDefault(); createProjectWorkspace() } },
        React.createElement('strong', null, '新建项目'),
        React.createElement('p', { style: { margin: '8px 0', fontSize: '12px' } }, '选择项目文件夹，在这里集中管理相关对话。'),
        React.createElement('input', { className: 'input', value: projectPath, placeholder: directory.listing ? directory.listing.path : '输入或选择项目目录', 'aria-label': '项目目录', onChange: function (event) { setProjectPath(event.target.value) }, style: { width: '100%', boxSizing: 'border-box' } }),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' } }, React.createElement('button', { className: 'btn btn-sec', type: 'button', disabled: busy, onClick: pickProjectDirectory }, directory.loading ? '读取中…' : '浏览目录')),
        projectDirectoryList,
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' } }, React.createElement('button', { className: 'btn btn-sec', type: 'button', disabled: busy, onClick: function () { setProjectCreateOpen(false) } }, '取消'), React.createElement('button', { className: 'btn btn-pri', type: 'submit', disabled: busy || !projectPath }, busy ? '创建中…' : '创建项目')))
      var projectCreateDialog = projectCreateOpen ? React.createElement('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '新建项目', style: { position: 'fixed', zIndex: 2147482501, inset: 0, display: 'grid', placeItems: 'center', padding: '20px', background: 'rgba(15, 23, 42, .28)' }, onClick: function () { if (!busy) setProjectCreateOpen(false) } }, projectCreateForm) : null
      return React.createElement('aside', { className: 'weftmate-v2-sessions sess-col', 'data-theme': sidebarTheme, 'aria-label': '会话栏', onClick: function (event) { if (!event.target.closest('.ctx-menu')) closeMenu() } }, React.createElement('div', { className: 'sess-new' }, React.createElement('button', { className: 'btn btn-sec', type: 'button', disabled: busy || !ready, title: ready ? undefined : '会话与项目列表尚未就绪。', onClick: function () { start() } }, '＋ 新会话')), React.createElement('div', { className: 'sess-list' }, !ready ? React.createElement('div', { className: 'sess-empty' }, '正在读取会话与项目…') : React.createElement(React.Fragment, null, roots)), feedback ? React.createElement('div', { className: 'weftmate-v2-sidebar-feedback' + (/失败|错误|超时|未完成|拒绝|不可用/.test(feedback) ? ' err' : ''), role: 'status' }, feedback) : null, renderMenu(), projectCreateDialog)
    }

    // DSH client APIs return a carrier envelope.  Do not treat a transport
    // response as an accepted setting change: all state comes from
    // response.result.value after the host has accepted the request.
    function dshResultValue(response, operation) {
      var result = response && response.result
      if (!result || typeof result.ok !== 'boolean') throw new Error(operation + ' returned an invalid response')
      if (result.ok !== true) {
        var detail = result.error && (result.error.message || result.error.code)
        throw new Error(detail || (operation + ' was rejected by DSH'))
      }
      return result.value
    }

    function errorText(error) {
      return error && error.message ? error.message : String(error || '请求失败')
    }

    var personalWorkspaceStarts = new WeakMap()
    function trustedPersonalWorkspacePath(status) {
      var path = status && status.dataDirs && status.dataDirs.workspace
      if (typeof path !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/)/.test(path)) return null
      return path
    }
    async function startWorkspaceSession(workspaces, sessions, explicitWorkspaceId) {
      if (!workspaces || !sessions || typeof workspaces.connectWorkspace !== 'function' || typeof sessions.open !== 'function') throw new Error('当前宿主没有可用的工作区会话接口。')
      var snapshot = workspaces.list && workspaces.list.getSnapshot ? workspaces.list.getSnapshot() : null
      var current = sessions.list && sessions.list.getSnapshot ? sessions.list.getSnapshot().current : null
      var ordinaryItems = snapshot && Array.isArray(snapshot.items) ? snapshot.items : []
      var currentWorkspaceId = current ? (ordinaryItems.find(function (item) { return Array.isArray(item.sessionIds) && item.sessionIds.indexOf(current) >= 0 }) || {}).workspaceId : null
      var recentWorkspaceId = snapshot && ordinaryItems.some(function (item) { return item.workspaceId === snapshot.recentWorkspaceId }) ? snapshot.recentWorkspaceId : null
      var target = explicitWorkspaceId || currentWorkspaceId || recentWorkspaceId
      if (target) { var existingSession = await workspaces.connectWorkspace(target); await sessions.open(existingSession); return existingSession }
      var pending = personalWorkspaceStarts.get(workspaces)
      if (pending) return pending
      pending = (async function () {
        var response = await fetch('/weftmate/status.json', { cache: 'no-store', signal: AbortSignal.timeout(6000) })
        if (!response.ok) throw new Error('无法读取宿主个人工作区位置，请稍后重试或先选择工作区。')
        var path = trustedPersonalWorkspacePath(await response.json())
        if (!path) throw new Error('宿主没有提供个人工作区位置，请先选择工作区。')
        if (typeof workspaces.create !== 'function') throw new Error('当前宿主不能注册个人工作区，请先选择工作区。')
        var workspace = await workspaces.create({ path: path })
        if (!workspace || typeof workspace.workspaceId !== 'string') throw new Error('个人工作区注册未返回有效结果。')
        var sessionId = await workspaces.connectWorkspace(workspace.workspaceId)
        await sessions.open(sessionId)
        return sessionId
      })().finally(function () { personalWorkspaceStarts.delete(workspaces) })
      personalWorkspaceStarts.set(workspaces, pending)
      return pending
    }

    function V2SettingsWorkspace(props) {
      var currentDark = typeof document !== 'undefined' && document.body && document.body.hasAttribute ? document.body.hasAttribute('data-ds-dark-theme') : false
      var themeState = React.useState(currentDark ? 'dark' : 'light'), theme = themeState[0], setTheme = themeState[1]
      React.useEffect(function () {
        var update = function () { setTheme(document.body && document.body.hasAttribute && document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light') }
        if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
          var observer = new MutationObserver(update)
          observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
          return function () { observer.disconnect() }
        }
      }, [])

      function switchTheme(nextTheme) {
        if (props.theme && props.theme.setTheme) {
          props.theme.setTheme(nextTheme)
        }
        setTheme(nextTheme)
      }

      var sub = (props && props.subpage) || (typeof window !== 'undefined' && window.location && window.location.hash && window.location.hash.indexOf('#/settings/') === 0 ? window.location.hash.replace('#/settings/', '') : '')
      var tabState = React.useState(sub || ''), activeTab = tabState[0], setActiveTab = tabState[1]
      React.useEffect(function () {
        if (props && props.subpage && props.subpage !== activeTab) {
          setActiveTab(props.subpage)
        }
      }, [props && props.subpage])

      function switchTab(nextTab) {
        setActiveTab(nextTab)
        if (props.onNavigate) {
          props.onNavigate('settings', nextTab)
        } else if (typeof window !== 'undefined' && window.location) {
          window.location.hash = '/settings/' + nextTab
        }
      }

      var feedbackState = React.useState(''), feedbackMsg = feedbackState[0], setFeedbackMsg = feedbackState[1]
      function showFeedback(msg) {
        setFeedbackMsg(msg)
        setTimeout(function () { setFeedbackMsg('') }, 4000)
      }

      var providersState = React.useState([]), providers = providersState[0], setProviders = providersState[1]
      var editingProviderState = React.useState(null), editingProvider = editingProviderState[0], setEditingProvider = editingProviderState[1]
      var settingsRevState = React.useState(0), settingsRev = settingsRevState[0], setSettingsRev = settingsRevState[1]
      var settingsLoadState = React.useState({ phase: 'loading', error: null }), settingsLoad = settingsLoadState[0], setSettingsLoad = settingsLoadState[1]

      // Settings may contain provider fields that this compact form does not
      // edit (for example timeoutMs). Keep that configuration private to the
      // edit state and write it back with the fields the form owns. Credentials
      // deliberately remain outside settings and only cross the secure IPC.
      function isProviderSecretField(key) {
        return /^(?:api[_-]?key|key|token|access[_-]?token|authorization|password)$/i.test(key)
      }

      function copySafeProviderConfig(value) {
        if (Array.isArray(value)) return value.map(copySafeProviderConfig)
        if (!value || typeof value !== 'object') return value
        var copy = {}
        Object.keys(value).forEach(function (key) {
          if (!isProviderSecretField(key)) copy[key] = copySafeProviderConfig(value[key])
        })
        return copy
      }

      function providerSaveValue(item, keyRef) {
        var value = Object.assign({}, copySafeProviderConfig(item.originalConfig), {
          displayName: item.displayName,
          api: item.api || 'openai-completions',
          baseURL: item.baseURL,
          models: item.models
        })
        if (keyRef) value.apiKeyEnv = keyRef
        return value
      }

      function reloadProviders() {
        var api = props && props.connection && props.connection.api
        if (!api || !api.settings || typeof api.settings.describe !== 'function') {
          setProviders([])
          setSettingsLoad({ phase: 'unavailable', error: '当前 DSH 连接未提供模型设置接口。' })
          return Promise.resolve()
        }
        setSettingsLoad({ phase: 'loading', error: null })
        return api.settings.describe({}).then(function (response) {
          var snapshot = dshResultValue(response, 'settings.describe')
          if (!snapshot || !Array.isArray(snapshot.namespaces)) throw new Error('settings.describe 未返回命名空间数据')
          var ns = snapshot.namespaces.find(function (n) { return n && n.ns === 'llm-pi-ai' })
          if (!ns || typeof ns.revision !== 'number') throw new Error('当前 DSH 未提供可写的 llm-pi-ai 设置命名空间')
          var baseP = (ns.base && ns.base.providers) || {}
          var userP = (ns.user && ns.user.providers) || {}
          var valueP = (ns.value && ns.value.providers) || {}
          var list = Object.keys(Object.assign({}, baseP, userP, valueP)).map(function (id) {
            var provider = valueP[id] || userP[id] || baseP[id]
            var originalConfig = copySafeProviderConfig(provider)
            return provider ? {
              id: id,
              displayName: provider.displayName || id,
              api: provider.api || 'openai-completions',
              baseURL: provider.baseURL || '',
              apiKeyEnv: provider.apiKeyEnv || '',
              apiKey: '',
              online: null,
              models: Array.isArray(provider.models) ? provider.models : [],
              originalConfig: originalConfig
            } : null
          }).filter(Boolean)
          setSettingsRev(ns.revision)
          setProviders(list)
          setSettingsLoad({ phase: 'ready', error: null })
        }).catch(function (error) {
          setProviders([])
          setSettingsLoad({ phase: 'error', error: errorText(error) })
        })
      }

      React.useEffect(function () {
        reloadProviders()
      }, [props && props.connection])

      function startAddProvider(isCustom) {
        setEditingProvider({
          isNew: true,
          id: isCustom ? 'custom-' + Math.random().toString(36).slice(2, 6) : 'provider-' + Math.random().toString(36).slice(2, 6),
          displayName: isCustom ? '自定义模型服务' : '新模型提供商',
          api: 'openai-completions',
          baseURL: 'http://127.0.0.1:8080/v1',
          apiKeyEnv: '',
          apiKey: '',
          models: [{ id: 'qwen-model', name: 'qwen-model', contextWindow: 32768 }]
        })
      }

      function validProviderId(value) { return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) }
      function derivedCredentialRef(id) { return id.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/_+$/g, '') + '_API_KEY' }

      async function saveProvider() {
        if (!editingProvider) return
        var id = (editingProvider.id || '').trim()
        var name = (editingProvider.displayName || '').trim()
        if (!validProviderId(id) || !name) {
          showFeedback('提供方标识须以小写字母开头，只能使用小写字母、数字和连字符。')
          return
        }
        var item = Object.assign({}, editingProvider, {
          displayName: name,
          online: null,
          models: (editingProvider.models && editingProvider.models.length) ? editingProvider.models : [{ id: 'default-model', name: 'default-model', contextWindow: 32768 }]
        })
        delete item.isNew
        var api = props && props.connection && props.connection.api
        if (!api || !api.settings || typeof api.settings.mutate !== 'function') {
          showFeedback('当前 DSH 不支持保存模型设置；未修改本地列表。')
          return
        }
        var keyRef = (item.apiKeyEnv || '').trim() || (item.apiKey ? derivedCredentialRef(id) : '')
        var val = providerSaveValue(item, keyRef)
        try {
          dshResultValue(await api.settings.mutate({
            ns: 'llm-pi-ai',
            expectedRevision: settingsRev,
            ops: [{ op: 'set', path: ['providers', id], value: val }]
          }), 'settings.mutate')
        } catch (error) {
          showFeedback('模型配置未保存：' + errorText(error))
          return
        }
        var credentialFailure = null
        if (item.apiKey) {
          if (!keyRef || !api.credentials || typeof api.credentials.set !== 'function') credentialFailure = '模型配置已保存，但 API Key 未保存；可重试保存该密钥。'
          else {
            try { dshResultValue(await api.credentials.set({ ref: keyRef, value: item.apiKey }), 'credentials.set') }
            catch (error) { credentialFailure = '模型配置已保存，但 API Key 未保存：' + errorText(error); return showFeedback(credentialFailure) }
          }
        }
        setEditingProvider(null)
        await reloadProviders()
        showFeedback(credentialFailure || ('模型提供方「' + name + '」已保存；已从 DSH 重新读取。'))
      }

      async function deleteProvider(id) {
        var api = props && props.connection && props.connection.api
        if (!api || !api.settings || typeof api.settings.mutate !== 'function') {
          showFeedback('当前 DSH 不支持删除模型配置。')
          return
        }
        try {
          dshResultValue(await api.settings.mutate({
            ns: 'llm-pi-ai',
            expectedRevision: settingsRev,
            ops: [{ op: 'unset', path: ['providers', id] }]
          }), 'settings.mutate')
          await reloadProviders()
          showFeedback('已删除模型提供方，并已从 DSH 重新读取。')
        } catch (error) {
          showFeedback('删除模型提供方失败：' + errorText(error))
        }
      }

      function renderProviderForm(item) {
        var formId = item.isNew ? 'provider-form-new' : ('provider-form-' + item.id)
        return React.createElement('div', { className: 'weftmate-v2-form-card', key: formId },
          React.createElement('div', { className: 'fc-head' },
            React.createElement('span', { className: 'fc-title' }, item.isNew ? '添加模型提供商' : ('编辑提供方: ' + item.displayName)),
            React.createElement('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick: function () { setEditingProvider(null) } }, '✕')
          ),
          React.createElement('div', { className: 'fc-body' },
            React.createElement('div', { className: 'fc-row' },
              React.createElement('div', { className: 'fc-field' },
                React.createElement('label', { className: 'fc-label', htmlFor: formId + '-id' }, '提供方标识 (ID)'),
                React.createElement('input', {
                  className: 'fc-input',
                  id: formId + '-id', 'aria-label': '提供方标识',
                  type: 'text',
                  value: item.id,
                  disabled: !item.isNew,
                  placeholder: '例如: qwen, ollama',
                  onChange: function (e) { var v = e.target.value; setEditingProvider(function (p) { return Object.assign({}, p, { id: v }) }) }
                })
              ),
              React.createElement('div', { className: 'fc-field' },
                React.createElement('label', { className: 'fc-label', htmlFor: formId + '-name' }, '显示名称'),
                React.createElement('input', {
                  className: 'fc-input',
                  id: formId + '-name', 'aria-label': '显示名称',
                  type: 'text',
                  value: item.displayName,
                  placeholder: '例如: Local preview model, Qwen 27B',
                  onChange: function (e) { var v = e.target.value; setEditingProvider(function (p) { return Object.assign({}, p, { displayName: v }) }) }
                })
              )
            ),
            React.createElement('div', { className: 'fc-row' },
              React.createElement('div', { className: 'fc-field' },
                React.createElement('label', { className: 'fc-label' }, 'API 协议'),
                React.createElement('select', {
                  className: 'fc-select',
                  value: item.api || 'openai-completions',
                  onChange: function (e) { var v = e.target.value; setEditingProvider(function (p) { return Object.assign({}, p, { api: v }) }) }
                },
                  React.createElement('option', { value: 'openai-completions' }, 'OpenAI 兼容协议 (openai-completions)'),
                  React.createElement('option', { value: 'anthropic' }, 'Anthropic Messages 协议'),
                  React.createElement('option', { value: 'ollama' }, 'Ollama 本地服务协议')
                )
              ),
              React.createElement('div', { className: 'fc-field' },
                React.createElement('label', { className: 'fc-label', htmlFor: formId + '-url' }, 'API 地址 (Base URL)'),
                React.createElement('input', {
                  className: 'fc-input',
                  id: formId + '-url', 'aria-label': 'API 地址',
                  type: 'text',
                  value: item.baseURL,
                  placeholder: 'http://127.0.0.1:8080/v1',
                  onChange: function (e) { var v = e.target.value; setEditingProvider(function (p) { return Object.assign({}, p, { baseURL: v }) }) }
                })
              )
            ),
            React.createElement('div', { className: 'fc-row' },
              React.createElement('div', { className: 'fc-field', style: { width: '100%' } },
                React.createElement('label', { className: 'fc-label', htmlFor: formId + '-key' }, 'API 密钥 (API Key)'),
                React.createElement('input', {
                  className: 'fc-input',
                  id: formId + '-key', 'aria-label': 'API 密钥',
                  type: 'password',
                  value: item.apiKey || '',
                  placeholder: item.isNew ? '输入 API Key（本地私有模型可留空）' : '已配置（如需更换请输入新 Key，留空保持不变）',
                  onChange: function (e) { var v = e.target.value; setEditingProvider(function (p) { return Object.assign({}, p, { apiKey: v }) }) }
                })
              )
            ),
            React.createElement('div', { className: 'fc-subheading' }, '包含的模型列表'),
            React.createElement('p', { className: 'fc-label' }, '优先使用服务实际上下文；无法读取时使用下方配置。请填写服务的实际窗口，未填写时按 32768 处理。'),
            React.createElement('div', { className: 'fc-models-list' },
              (item.models || []).map(function (m, mIdx) {
                return React.createElement('div', { className: 'fc-model-row', key: mIdx },
                  React.createElement('input', {
                    className: 'fc-input',
                    id: formId + '-model-' + mIdx, 'aria-label': '模型标识',
                    type: 'text',
                    placeholder: '模型 ID (例如 qwen3.8-27b)',
                    value: m.id,
                    onChange: function (e) {
                      var v = e.target.value
                      setEditingProvider(function (p) {
                        var nextM = p.models.slice()
                        nextM[mIdx] = Object.assign({}, nextM[mIdx], { id: v, name: v })
                        return Object.assign({}, p, { models: nextM })
                      })
                    }
                  }),
                  React.createElement('input', {
                    className: 'fc-input',
                    id: formId + '-context-' + mIdx, 'aria-label': '上下文窗口',
                    style: { width: '120px' },
                    type: 'number',
                    placeholder: '32768',
                    value: m.contextWindow || 32768,
                    onChange: function (e) {
                      var v = parseInt(e.target.value, 10) || 32768
                      setEditingProvider(function (p) {
                        var nextM = p.models.slice()
                        nextM[mIdx] = Object.assign({}, nextM[mIdx], { contextWindow: v })
                        return Object.assign({}, p, { models: nextM })
                      })
                    }
                  }),
                  React.createElement('button', {
                    className: 'btn btn-ghost btn-sm',
                    type: 'button',
                    onClick: function () {
                      setEditingProvider(function (p) {
                        var nextM = p.models.filter(function (_, i) { return i !== mIdx })
                        return Object.assign({}, p, { models: nextM })
                      })
                    }
                  }, '删除')
                )
              }),
              React.createElement('button', {
                className: 'btn btn-ghost btn-sm',
                type: 'button',
                style: { marginTop: '6px' },
                onClick: function () {
                  setEditingProvider(function (p) {
                    return Object.assign({}, p, { models: (p.models || []).concat([{ id: '', name: '', contextWindow: 32768 }]) })
                  })
                }
              }, '＋ 添加模型行')
            )
          ),
          React.createElement('div', { className: 'fc-foot' },
            React.createElement('button', { className: 'btn btn-primary btn-sm', type: 'button', onClick: saveProvider }, '保存配置'),
            React.createElement('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick: function () { setEditingProvider(null) } }, '取消')
          )
        )
      }

      var presetsState = React.useState([]), presets = presetsState[0], setPresets = presetsState[1]
      var presetLoadState = React.useState({ phase: 'loading', error: null, authorable: false, hasDocument: false })
      var presetLoad = presetLoadState[0], setPresetLoad = presetLoadState[1]
      var viewingCompositionState = React.useState(null), viewingComposition = viewingCompositionState[0], setViewingComposition = viewingCompositionState[1]
      var duplicatingPresetState = React.useState(null), duplicatingPreset = duplicatingPresetState[0], setDuplicatingPreset = duplicatingPresetState[1]
      var deletingPresetState = React.useState(null), deletingPreset = deletingPresetState[0], setDeletingPreset = deletingPresetState[1]
      var revealedPathsState = React.useState({}), revealedPaths = revealedPathsState[0], setRevealedPaths = revealedPathsState[1]

      function reloadPresets() {
        var api = props && props.connection && props.connection.api
        if (!api || !api.agentPresets || typeof api.agentPresets.list !== 'function') {
          setPresets([])
          setPresetLoad({ phase: 'unavailable', error: '当前 DSH 未提供预设管理接口。', authorable: false, hasDocument: false })
          return Promise.resolve()
        }
        setPresetLoad({ phase: 'loading', error: null, authorable: false, hasDocument: false })
        return api.agentPresets.list({}).then(function (response) {
          var value = dshResultValue(response, 'agentPreset.list')
          if (!value || !Array.isArray(value.presets)) throw new Error('agentPreset.list 未返回预设列表')
          setPresets(value.presets.map(function (item) {
            return { id: item.id, name: item.name || item.id, description: item.description || '', trust: item.trust, isDefault: item.isDefault === true, broken: item.broken }
          }))
          setPresetLoad({ phase: value.presets.length ? 'ready' : 'empty', error: null, authorable: value.authorable === true, hasDocument: value.hasDocument === true })
        }).catch(function (error) {
          setPresets([])
          setPresetLoad({ phase: 'error', error: errorText(error), authorable: false, hasDocument: false })
        })
      }

      React.useEffect(function () {
        reloadPresets()
      }, [props && props.connection])

      function viewPresetComposition(preset) {
        var api = props && props.connection && props.connection.api
        if (!api || !api.agentPresets || typeof api.agentPresets.read !== 'function') { showFeedback('当前 DSH 不支持读取预设内容。'); return }
        api.agentPresets.read({ agentPreset: preset.id }).then(function (response) {
          var value = dshResultValue(response, 'agentPreset.read')
          if (!value || typeof value.content !== 'string') throw new Error('预设未返回可读取内容')
          setViewingComposition({ id: preset.id, title: value.name || preset.name, content: value.content })
        }).catch(function (error) { showFeedback('读取预设失败：' + errorText(error)) })
      }

      function startDuplicatePreset(preset) {
        setDuplicatingPreset({
          from: preset.id,
          fromTitle: preset.name,
          id: preset.id + '-copy',
          name: preset.name + ' 副本',
          error: null,
          saving: false
        })
      }

      async function confirmDuplicate() {
        if (!duplicatingPreset || duplicatingPreset.saving) return
        var draftId = (duplicatingPreset.id || '').trim().toLowerCase()
        var draftName = (duplicatingPreset.name || '').trim() || draftId
        if (!draftId) {
          setDuplicatingPreset(function (p) { return Object.assign({}, p, { error: '请填写标识符。' }) })
          return
        }
        if (!/^[a-z0-9][a-z0-9-]*$/.test(draftId)) {
          setDuplicatingPreset(function (p) { return Object.assign({}, p, { error: '只能使用小写字母、数字与连字符，且以字母或数字开头。' }) })
          return
        }
        if (presets.some(function (p) { return p.id === draftId })) {
          setDuplicatingPreset(function (p) { return Object.assign({}, p, { error: '该标识符已被占用。' }) })
          return
        }
        setDuplicatingPreset(function (p) { return Object.assign({}, p, { saving: true, error: null }) })
        var fromId = duplicatingPreset.from
        var api = props && props.connection && props.connection.api
        if (!presetLoad.authorable || !api || !api.agentPresets || typeof api.agentPresets.copy !== 'function') {
          setDuplicatingPreset(function (p) { return Object.assign({}, p, { saving: false, error: '当前 DSH 不允许创建预设。' }) })
          return
        }
        try {
          var value = dshResultValue(await api.agentPresets.copy({ from: fromId, agentPreset: draftId, name: draftName }), 'agentPreset.copy')
          var createdId = value && value.agentPreset ? value.agentPreset : draftId
          setDuplicatingPreset(null)
          await reloadPresets()
          showFeedback('预设已复制；列表已从 DSH 重新读取。组装内容只能在宿主打开的预设目录中编辑。')
          if (typeof api.agentPresets.openDocument === 'function') openPresetFolder(createdId)
        } catch (error) {
          setDuplicatingPreset(function (p) { return Object.assign({}, p, { saving: false, error: errorText(error) }) })
        }
      }

      function openPresetFolder(id) {
        var api = props && props.connection && props.connection.api
        if (api && api.agentPresets && typeof api.agentPresets.openDocument === 'function') {
          api.agentPresets.openDocument({ agentPreset: id }).then(function (res) {
            var val = dshResultValue(res, 'agentPreset.openDocument')
            if (val && val.opened) {
              showFeedback('已在文件管理器中打开预设目录')
            } else if (val && val.path) {
              setRevealedPaths(function (prev) { var n = Object.assign({}, prev); n[id] = val.path; return n })
              showFeedback('预设路径: ' + val.path)
            } else {
              showFeedback('已请求打开预设目录')
            }
          }).catch(function (error) {
            showFeedback('无法打开预设目录：' + errorText(error))
          })
        } else {
          showFeedback('当前环境不支持直接唤起桌面文件管理器')
        }
      }

      async function confirmDeletePreset() {
        if (!deletingPreset) return
        var id = deletingPreset.id
        var name = deletingPreset.name
        var api = props && props.connection && props.connection.api
        if (!api || !api.agentPresets || typeof api.agentPresets.remove !== 'function') { showFeedback('当前 DSH 不支持删除预设。'); return }
        try {
          dshResultValue(await api.agentPresets.remove({ agentPreset: id }), 'agentPreset.remove')
          setDeletingPreset(null)
          await reloadPresets()
          showFeedback('预设「' + name + '」已删除；列表已从 DSH 重新读取。')
        } catch (error) { showFeedback('删除预设失败：' + errorText(error)) }
      }

      function startCreatorDraft() {
        if (props.startSession) {
          props.startSession()
          showFeedback('已创建普通新会话。当前宿主没有“以指定预设新建会话”的正式接口，请在预设列表复制后打开目录编辑。')
        } else {
          showFeedback('当前不能新建会话；请先复制已有预设并在目录中编辑。')
        }
      }

      function startAddPreset() {
        var source = presets.find(function (p) { return !p.broken })
        if (!source) { showFeedback(presetLoad.phase === 'loading' ? '正在读取预设列表。' : '没有可复制的正式预设。'); return }
        startDuplicatePreset(source)
      }

      async function setDefaultPreset(id) {
        var target = presets.find(function (p) { return p.id === id })
        var api = props && props.connection && props.connection.api
        if (!target || target.broken) { showFeedback('此预设不可用。'); return }
        if (!api || !api.settings || typeof api.settings.update !== 'function') { showFeedback('当前 DSH 不支持设置默认预设。'); return }
        try {
          dshResultValue(await api.settings.update({ ns: 'agent-presets', patch: { default: id } }), 'settings.update')
          await reloadPresets()
          showFeedback('已将「' + target.name + '」设为默认；列表已从 DSH 重新读取。')
        } catch (error) { showFeedback('设置默认预设失败：' + errorText(error)) }
      }

      function duplicatePreset(preset) {
        startDuplicatePreset(preset)
      }

      var expandColumnsState = React.useState(function () {
        try {
          var stored = window.localStorage && window.localStorage.getItem('weftmate.v2.columns.expanded')
          if (stored === 'true' || stored === 'false') return stored === 'true'
        } catch (_) {}
        return typeof document !== 'undefined' && document.documentElement && !document.documentElement.hasAttribute('data-weftmate-v2-sessions-hidden') && !document.documentElement.hasAttribute('data-weftmate-v2-work-hidden')
      }), expandColumns = expandColumnsState[0], setExpandColumns = expandColumnsState[1]

      React.useEffect(function () {
        if (typeof document === 'undefined' || !document.documentElement) return
        if (expandColumns) {
          document.documentElement.removeAttribute('data-weftmate-v2-sessions-hidden')
          document.documentElement.removeAttribute('data-weftmate-v2-work-hidden')
        } else {
          document.documentElement.setAttribute('data-weftmate-v2-sessions-hidden', '')
          document.documentElement.setAttribute('data-weftmate-v2-work-hidden', '')
        }
      }, [expandColumns])

      function toggleExpandColumns() {
        var next = !expandColumns
        setExpandColumns(next)
        try { window.localStorage.setItem('weftmate.v2.columns.expanded', String(next)) } catch (_) {}
        if (typeof document !== 'undefined' && document.documentElement) {
          if (next) {
            document.documentElement.removeAttribute('data-weftmate-v2-sessions-hidden')
            document.documentElement.removeAttribute('data-weftmate-v2-work-hidden')
          } else {
            document.documentElement.setAttribute('data-weftmate-v2-sessions-hidden', '')
            document.documentElement.setAttribute('data-weftmate-v2-work-hidden', '')
          }
        }
      }

      var perceptionState = React.useState(FALLBACK_PERCEPTION), perception = perceptionState[0], setPerception = perceptionState[1]
      var statusState = React.useState({}), status = statusState[0], setStatus = statusState[1]

      React.useEffect(function () {
        pollPerception(setPerception)
        fetchAvailableJson('/weftmate/status.json', setStatus)
        var timer = setInterval(function () {
          pollPerception(setPerception)
          fetchAvailableJson('/weftmate/status.json', setStatus)
        }, 10000)
        if (timer && typeof timer.unref === 'function') timer.unref()
        return function () { clearInterval(timer) }
      }, [])

      var cfg = (perception && perception.config) || FALLBACK_PERCEPTION.config
      var perceptionEnabled = cfg.enabled
      var clipboardEnabled = cfg.clipboard
      var injectEnabled = cfg.inject && cfg.inject.enabled

      function togglePerception() {
        var next = !perceptionEnabled
        postSeam('/weftmate/perception', 'toggle', next)
        setPerception(function (prev) {
          var n = Object.assign({}, prev)
          n.config = Object.assign({}, n.config, { enabled: next })
          return n
        })
      }

      function toggleClipboard() {
        var next = !clipboardEnabled
        postSeam('/weftmate/perception', 'clipboard', next)
        setPerception(function (prev) {
          var n = Object.assign({}, prev)
          n.config = Object.assign({}, n.config, { clipboard: next })
          return n
        })
      }

      function toggleInject() {
        var next = !injectEnabled
        postSeam('/weftmate/perception', 'inject', next)
        setPerception(function (prev) {
          var n = Object.assign({}, prev)
          n.config = Object.assign({}, n.config, { inject: Object.assign({}, n.config && n.config.inject, { enabled: next }) })
          return n
        })
      }

      var checkUpdateState = React.useState('检查更新'), checkUpdateText = checkUpdateState[0], setCheckUpdateText = checkUpdateState[1]
      function handleCheckUpdate() {
        setCheckUpdateText('正在检查…')
        fetch('/weftmate/update', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'check' })
        }).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        }).then(function (result) {
          if (!result || result.ok !== true) throw new Error((result && (result.error || result.code)) || '宿主未接受请求')
          setCheckUpdateText('已请求检查；等待宿主状态回写')
          fetchAvailableJson('/weftmate/status.json', setStatus)
        }).catch(function (error) {
          setCheckUpdateText('检查更新不可用：' + errorText(error))
        })
      }

      var subTitles = {
        general: '通用偏好与界面外观',
        models: '大模型提供商与 API 端点配置',
        presets: '智能体工作人设、提示词与模式',
        plugins: '插件管理与运行权限偏好',
        perception: '桌面感知、剪贴板与设备协同',
        about: '系统运行时状态与版本信息'
      }

      function renderOverview() {
        return [
          React.createElement('div', { className: 'set-group', key: 'appearance' },
            React.createElement('div', { className: 'sg-title' }, '外观'),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '主题'),
                React.createElement('div', { className: 'sr-d' }, '墨夜为默认深色，纸白为浅色')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('div', { className: 'seg' },
                  React.createElement('button', {
                    className: theme === 'dark' ? 'on' : '',
                    type: 'button',
                    'data-theme-seg': 'dark',
                    onClick: function () { switchTheme('dark') }
                  }, '墨夜'),
                  React.createElement('button', {
                    className: theme === 'light' ? 'on' : '',
                    type: 'button',
                    'data-theme-seg': 'light',
                    onClick: function () { switchTheme('light') }
                  }, '纸白')
                )
              )
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null, React.createElement('div', { className: 'sr-k' }, '强调色')),
              React.createElement('div', { className: 'sr-v' }, '织蓝 #2E5BFF')
            )
          ),

          React.createElement('div', { className: 'set-group', key: 'dialog' },
            React.createElement('div', { className: 'sg-title' }, '对话'),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '默认智能体模式'),
                React.createElement('div', { className: 'sr-d' }, '新建会话时默认使用的 Agent 预设')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('select', {
                  className: 'fc-select',
                  style: { minWidth: '180px' },
                  value: (presets.find(function (p) { return p.isDefault }) || presets[0] || {}).id || '',
                  disabled: presets.length === 0,
                  onChange: function (e) { setDefaultPreset(e.target.value) }
                },
                  presets.map(function (p) {
                    return React.createElement('option', { value: p.id, key: p.id }, p.name)
                  })
                ),
                React.createElement('button', {
                  className: 'btn btn-ghost btn-sm',
                  type: 'button',
                  onClick: function () { switchTab('presets') }
                }, '管理')
              )
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null, React.createElement('div', { className: 'sr-k' }, '上下文窗口')),
              React.createElement('div', { className: 'sr-v' }, '当前会话未报告模型上下文；请在模型设置中查看已选模型。')
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '模型服务配置'),
                React.createElement('div', { className: 'sr-d' }, '添加或修改模型提供方、配置 API 密钥与端点')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'btn btn-sec btn-sm',
                  id: 'cfgModelsBtn',
                  type: 'button',
                  onClick: function () { switchTab('models') }
                }, '修改模型 / 添加提供方')
              )
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, 'Agent 模式与预设'),
                React.createElement('div', { className: 'sr-d' }, '创建新模式、编辑系统提示词与专属工具绑定')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'btn btn-sec btn-sm',
                  id: 'cfgPresetsBtn',
                  type: 'button',
                  onClick: function () { switchTab('presets') }
                }, '创建模式 / 编辑预设')
              )
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '新会话默认展开两栏'),
                React.createElement('div', { className: 'sr-d' }, '本机默认显示会话栏与工作台栏；此视图偏好仅保存在当前设备。')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'toggle' + (expandColumns ? ' on' : ''),
                  type: 'button',
                  'aria-label': '新会话默认展开两栏',
                  onClick: toggleExpandColumns
                })
              )
            )
          ),

          React.createElement('div', { className: 'set-group', key: 'plugins' },
            React.createElement('div', { className: 'sg-title' }, '插件'),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '插件与扩展'),
                React.createElement('div', { className: 'sr-d' }, '查看与配置已启用的宿主插件')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'btn btn-sec btn-sm',
                  id: 'cfgPluginsBtn',
                  type: 'button',
                  onClick: function () { switchTab('plugins') }
                }, '管理插件')
              )
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null, React.createElement('div', { className: 'sr-k' }, '自动更新'), React.createElement('div', { className: 'sr-d' }, '当前只支持手动检查更新；自动更新策略未由宿主暴露。')),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'toggle',
                  type: 'button',
                  'aria-label': '自动更新',
                  disabled: true,
                  title: '当前宿主没有自动更新策略设置接口。'
                })
              )
            )
          ),

          React.createElement('div', { className: 'set-group', key: 'perception' },
            React.createElement('div', { className: 'sg-title' }, '桌面感知与设备'),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '桌面环境感知'),
                React.createElement('div', { className: 'sr-d' }, '捕获前台窗口标题与桌面事件以辅助任务')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'toggle' + (perceptionEnabled ? ' on' : ''),
                  type: 'button',
                  'aria-label': '桌面环境感知',
                  onClick: togglePerception
                })
              )
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '剪贴板监听'),
                React.createElement('div', { className: 'sr-d' }, '在经授权时读取剪贴板以提供快捷处理')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'toggle' + (clipboardEnabled ? ' on' : ''),
                  type: 'button',
                  'aria-label': '剪贴板监听',
                  onClick: toggleClipboard
                })
              )
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '上下文注入'),
                React.createElement('div', { className: 'sr-d' }, '向对话上下文传递系统与环境信息')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'toggle' + (injectEnabled ? ' on' : ''),
                  type: 'button',
                  'aria-label': '上下文注入',
                  onClick: toggleInject
                })
              )
            )
          ),

          React.createElement('div', { className: 'set-group', key: 'about' },
            React.createElement('div', { className: 'sg-title' }, '关于'),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, 'WeftMate'),
                React.createElement('div', { className: 'sr-d' }, '设计语言 v2 · 织语 Weave 体系')
              ),
              React.createElement('div', { className: 'sr-v' }, props.appVersion || '暂不可用')
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '运行时状态'),
                React.createElement('div', { className: 'sr-d' }, 'DSH 内嵌引擎 + 本地模型通信')
              ),
              React.createElement('div', { className: 'sr-v' }, '模型连通性尚未探测')
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '底层宿主设置'),
                React.createElement('div', { className: 'sr-d' }, '查看宿主底层配置')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'btn btn-sec btn-sm',
                  id: 'openDshSettingsBtn',
                  type: 'button',
                  onClick: function () { switchTab('models') }
                }, '查看模型配置')
              )
            ),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null, React.createElement('div', { className: 'sr-k' }, '检查更新')),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'btn btn-ghost btn-sm',
                  id: 'updBtn',
                  type: 'button',
                  onClick: handleCheckUpdate
                }, checkUpdateText)
              )
            )
          )
        ]
      }

      return React.createElement('div', { className: 'weftmate-v2-page-inner' },
        React.createElement('div', { className: 'page-head' },
          React.createElement('span', { className: 'ph-title' }, '设置'),
          React.createElement('span', { className: 'ph-sub' }, '机器本地的，都是你的'),
          React.createElement('div', { className: 'weftmate-v2-settings-tabs' },
            React.createElement('button', {
              className: 'set-tab' + ((activeTab === 'general' || !activeTab) ? ' on' : ''),
              type: 'button',
              'data-setting-tab': 'general',
              onClick: function () { switchTab('general') }
            }, '通用与外观'),
            React.createElement('button', {
              className: 'set-tab' + (activeTab === 'models' ? ' on' : ''),
              type: 'button',
              'data-setting-tab': 'models',
              onClick: function () { switchTab('models') }
            }, '模型服务'),
            React.createElement('button', {
              className: 'set-tab' + (activeTab === 'presets' || activeTab === 'agent-presets' ? ' on' : ''),
              type: 'button',
              'data-setting-tab': 'presets',
              onClick: function () { switchTab('presets') }
            }, '智能体预设'),
            React.createElement('button', {
              className: 'set-tab' + (activeTab === 'plugins' ? ' on' : ''),
              type: 'button',
              'data-setting-tab': 'plugins',
              onClick: function () { switchTab('plugins') }
            }, '插件扩展'),
            React.createElement('button', {
              className: 'set-tab' + (activeTab === 'perception' || activeTab === 'weftmate' ? ' on' : ''),
              type: 'button',
              'data-setting-tab': 'perception',
              onClick: function () { switchTab('perception') }
            }, '桌面感知与设备'),
            React.createElement('button', {
              className: 'set-tab' + (activeTab === 'about' ? ' on' : ''),
              type: 'button',
              'data-setting-tab': 'about',
              onClick: function () { switchTab('about') }
            }, '关于')
          )
        ),
        React.createElement('div', { className: 'page-scroll' },
          (function () {
            // TAB: MODELS
            var panelContent = activeTab === 'models' ? React.createElement('div', { className: 'weftmate-v2-models-panel', 'data-setting-panel': 'models' },
              React.createElement('div', { className: 'weftmate-v2-panel-head' },
                React.createElement('div', null,
                  React.createElement('div', { className: 'ph-panel-title' }, '模型服务管理'),
                  React.createElement('div', { className: 'ph-panel-desc' }, '已配置 ' + providers.length + ' 个模型提供商 · 本地优先')
                ),
                React.createElement('div', { className: 'ph-panel-act' },
                  React.createElement('button', {
                    className: 'btn btn-sec btn-sm',
                    id: 'cfgModelsBtn',
                    type: 'button',
                    onClick: function () { startAddProvider(true) }
                  }, '＋ 添加自定义提供方'),
                  React.createElement('button', {
                    className: 'btn btn-ghost btn-sm',
                    type: 'button',
                    onClick: function () { startAddProvider(false) }
                  }, '＋ 添加提供方')
                )
              ),

              editingProvider && editingProvider.isNew ? renderProviderForm(editingProvider) : null,

              React.createElement('div', { className: 'weftmate-v2-providers-list' },
                providers.map(function (prov) {
                  if (editingProvider && !editingProvider.isNew && editingProvider.id === prov.id) {
                    return renderProviderForm(editingProvider)
                  }
                  return React.createElement('div', { className: 'provider-card', key: prov.id },
                    React.createElement('div', { className: 'pc-top' },
                      React.createElement('div', { className: 'pc-brand' },
                        React.createElement('span', { className: 'status-dot', title: '已配置，尚未探测连通性' }),
                        React.createElement('span', { className: 'provider-title' }, prov.displayName),
                        React.createElement('span', { className: 'protocol-badge' }, prov.api)
                      ),
                      React.createElement('div', { className: 'pc-actions' },
                        React.createElement('button', {
                          className: 'btn btn-ghost btn-sm',
                          type: 'button',
                          onClick: function () { setEditingProvider(JSON.parse(JSON.stringify(prov))) }
                        }, '编辑'),
                        React.createElement('button', {
                          className: 'btn btn-ghost btn-sm',
                          style: { color: 'var(--weftmate-danger, #ef4444)' },
                          type: 'button',
                          onClick: function () { deleteProvider(prov.id) }
                        }, '删除')
                      )
                    ),
                    React.createElement('div', { className: 'pc-meta' },
                      React.createElement('span', { className: 'pc-url' }, prov.baseURL),
                      prov.apiKeyEnv ? React.createElement('span', { className: 'pc-key-badge' }, '🔑 ' + prov.apiKeyEnv) : null
                    ),
                    React.createElement('div', { className: 'pc-models' },
                      (prov.models || []).map(function (m, idx) {
                        return React.createElement('span', { className: 'model-tag', key: idx },
                          m.id,
                          m.contextWindow ? React.createElement('span', { className: 'mt-ctx' }, ' (' + (Math.round(m.contextWindow / 1024)) + 'k)') : null
                        )
                      })
                    )
                  )
                })
              )
            ) : (
              activeTab === 'presets' || activeTab === 'agent-presets' ? React.createElement('div', { className: 'weftmate-v2-presets-panel', 'data-setting-panel': 'presets' },
                React.createElement('div', { className: 'weftmate-v2-panel-head' },
                  React.createElement('div', null,
                    React.createElement('div', { className: 'ph-panel-title' }, '智能体预设与模式'),
                    React.createElement('div', { className: 'ph-panel-desc' }, 'DSH 官方 Cordis 插件链组合 · 内置受保护只读，自定义目录化管理')
                  ),
                  React.createElement('div', { className: 'ph-panel-act' },
                    React.createElement('button', {
                      className: 'btn btn-sec btn-sm',
                      id: 'cfgPresetsBtn',
                      type: 'button',
                      onClick: startAddPreset
                    }, '＋ 创建新模式')
                  )
                ),

                React.createElement('div', { className: 'weftmate-v2-presets-list' },
                  presets.map(function (preset) {
                    var isSystem = preset.trust === 'system'
                    var icon = isSystem ? '⚡' : '✦'
                    return React.createElement('div', { className: 'preset-card' + (preset.isDefault ? ' default' : ''), key: preset.id },
                      React.createElement('div', { className: 'psc-top' },
                        React.createElement('div', { className: 'psc-brand' },
                          React.createElement('span', { className: 'preset-icon' }, icon),
                          React.createElement('span', { className: 'preset-title' }, preset.name),
                          preset.isDefault ? React.createElement('span', { className: 'preset-badge' }, '当前默认') : (isSystem ? React.createElement('span', { className: 'protocol-badge', style: { marginLeft: '6px' } }, 'DSH 内置') : React.createElement('span', { className: 'protocol-badge', style: { marginLeft: '6px' } }, '自定义'))
                        ),
                        React.createElement('div', { className: 'psc-actions' },
                          !preset.isDefault ? React.createElement('button', {
                            className: 'btn btn-sec btn-sm',
                            type: 'button',
                            onClick: function () { setDefaultPreset(preset.id) }
                          }, '设为默认') : null,
                          React.createElement('button', {
                            className: 'btn btn-ghost btn-sm',
                            type: 'button',
                            onClick: function () { viewPresetComposition(preset) }
                          }, '查看组装'),
                          React.createElement('button', {
                            className: 'btn btn-ghost btn-sm',
                            type: 'button',
                            onClick: function () { startDuplicatePreset(preset) }
                          }, isSystem ? '复制到本地' : '复制'),
                          !isSystem ? React.createElement('button', {
                            className: 'btn btn-ghost btn-sm',
                            type: 'button',
                            onClick: function () { openPresetFolder(preset.id) }
                          }, '打开目录') : null,
                          (!preset.isDefault && !isSystem) ? React.createElement('button', {
                            className: 'btn btn-ghost btn-sm',
                            style: { color: 'var(--weftmate-danger, #ef4444)' },
                            type: 'button',
                            onClick: function () { setDeletingPreset(preset) }
                          }, '删除') : null
                        )
                      ),
                      React.createElement('div', { className: 'psc-desc' }, preset.description),
                      revealedPaths[preset.id] ? React.createElement('div', {
                        className: 'psc-revealed-path',
                        style: { fontSize: '11px', color: 'var(--weftmate-text-muted, #888)', fontFamily: 'monospace', marginTop: '6px', wordBreak: 'break-all' }
                      }, '📁 本地工程目录: ' + revealedPaths[preset.id]) : null,
                      React.createElement('div', { className: 'psc-footer' },
                        React.createElement('span', { className: 'psc-tag' }, '标识: ' + preset.id),
                        React.createElement('span', { className: 'psc-tag sub' }, isSystem ? '只读系统预设' : '本地工程 (.agent-presets/' + preset.id + ')')
                      )
                    )
                  })
                ),

                React.createElement('div', {
                  className: 'creator-draft-card',
                  style: { marginTop: '20px', padding: '16px 20px', background: 'rgba(255, 255, 255, 0.03)', border: '1px dashed var(--weftmate-border, rgba(255, 255, 255, 0.15))', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }
                },
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontWeight: 600, fontSize: '14px', marginBottom: '4px' } }, '想定制自己的专属 Agent 预设？'),
                    React.createElement('div', { style: { fontSize: '12px', color: 'var(--weftmate-text-muted, #888)' } }, 'DSH 预设由 Cordis 插件管道工程定义。利用内置「创造模式」，可通过对话与大模型协作自动组装并生成自定义预设。')
                  ),
                  React.createElement('button', {
                    className: 'btn btn-pri btn-sm creator-draft-btn',
                    type: 'button',
                    style: { whiteSpace: 'nowrap' },
                    onClick: startCreatorDraft
                  }, '用「创造模式」创作自定义预设 ✦')
                )
              ) : (
                activeTab === 'plugins' ? React.createElement('div', { className: 'weftmate-v2-plugins-panel', 'data-setting-panel': 'plugins' },
                  React.createElement('div', { className: 'weftmate-v2-panel-head' },
                    React.createElement('div', null,
                      React.createElement('div', { className: 'ph-panel-title' }, '插件与扩展'),
                      React.createElement('div', { className: 'ph-panel-desc' }, '管理已安装的前端插件与运行权限偏好')
                    ),
                    React.createElement('div', { className: 'ph-panel-act' },
                      React.createElement('button', {
                        className: 'btn btn-sec btn-sm',
                        id: 'cfgPluginsBtn',
                        type: 'button',
                        onClick: function () { showFeedback('已刷新插件清单') }
                      }, '管理插件')
                    )
                  ),
                  React.createElement('div', { className: 'set-group' },
                    React.createElement('div', { className: 'sg-title' }, '核心插件'),
                    React.createElement('div', { className: 'set-row' },
                      React.createElement('div', null,
                        React.createElement('div', { className: 'sr-k' }, '@weftmate/client'),
                        React.createElement('div', { className: 'sr-d' }, 'WeftMate V2 现代化工作台与会话扩展')
                      ),
                      React.createElement('div', { className: 'sr-v' }, '核心已启用')
                    ),
                    React.createElement('div', { className: 'set-row' },
                      React.createElement('div', null,
                        React.createElement('div', { className: 'sr-k' }, '@deepseek-ai/dsh-client-ui-settings'),
                        React.createElement('div', { className: 'sr-d' }, '底层宿主设置与模型接口')
                      ),
                      React.createElement('div', { className: 'sr-v' }, '已挂载')
                    )
                  ),
                  React.createElement('div', { className: 'set-group' },
                    React.createElement('div', { className: 'sg-title' }, '运行偏好'),
                    React.createElement('div', { className: 'set-row' },
                      React.createElement('div', null, React.createElement('div', { className: 'sr-k' }, '安装前确认权限'), React.createElement('div', { className: 'sr-d' }, '当前宿主未暴露可持久化的权限确认设置。')),
                      React.createElement('div', { className: 'sr-act' },
                        React.createElement('button', {
                          className: 'toggle',
                          type: 'button',
                          'aria-label': '安装前确认权限',
                          disabled: true,
                          title: '当前宿主没有权限确认全局设置接口。'
                        })
                      )
                    ),
                    React.createElement('div', { className: 'set-row' },
                      React.createElement('div', null, React.createElement('div', { className: 'sr-k' }, '自动更新'), React.createElement('div', { className: 'sr-d' }, '当前只支持手动检查更新；自动更新策略未由宿主暴露。')),
                      React.createElement('div', { className: 'sr-act' },
                        React.createElement('button', {
                          className: 'toggle',
                          type: 'button',
                          'aria-label': '自动更新',
                          disabled: true,
                          title: '当前宿主没有自动更新策略设置接口。'
                        })
                      )
                    )
                  )
                ) : (
                  activeTab === 'perception' || activeTab === 'weftmate' ? React.createElement('div', { className: 'weftmate-v2-perception-panel', 'data-setting-panel': 'perception' },
                    React.createElement('div', { className: 'weftmate-v2-panel-head' },
                      React.createElement('div', null,
                        React.createElement('div', { className: 'ph-panel-title' }, '桌面感知与设备协同'),
                        React.createElement('div', { className: 'ph-panel-desc' }, '配置本地环境捕获与跨端设备协作能力')
                      )
                    ),
                    React.createElement('div', { className: 'set-group' },
                      React.createElement('div', { className: 'sg-title' }, '环境感知'),
                      React.createElement('div', { className: 'set-row' },
                        React.createElement('div', null,
                          React.createElement('div', { className: 'sr-k' }, '桌面环境感知'),
                          React.createElement('div', { className: 'sr-d' }, '捕获前台窗口标题与桌面事件以辅助任务')
                        ),
                        React.createElement('div', { className: 'sr-act' },
                          React.createElement('button', {
                            className: 'toggle' + (perceptionEnabled ? ' on' : ''),
                            type: 'button',
                            'aria-label': '桌面环境感知',
                            onClick: togglePerception
                          })
                        )
                      ),
                      React.createElement('div', { className: 'set-row' },
                        React.createElement('div', null,
                          React.createElement('div', { className: 'sr-k' }, '剪贴板监听'),
                          React.createElement('div', { className: 'sr-d' }, '在经授权时读取剪贴板以提供快捷处理')
                        ),
                        React.createElement('div', { className: 'sr-act' },
                          React.createElement('button', {
                            className: 'toggle' + (clipboardEnabled ? ' on' : ''),
                            type: 'button',
                            'aria-label': '剪贴板监听',
                            onClick: toggleClipboard
                          })
                        )
                      ),
                      React.createElement('div', { className: 'set-row' },
                        React.createElement('div', null,
                          React.createElement('div', { className: 'sr-k' }, '上下文注入'),
                          React.createElement('div', { className: 'sr-d' }, '向对话上下文传递系统与环境信息')
                        ),
                        React.createElement('div', { className: 'sr-act' },
                          React.createElement('button', {
                            className: 'toggle' + (injectEnabled ? ' on' : ''),
                            type: 'button',
                            'aria-label': '上下文注入',
                            onClick: toggleInject
                          })
                        )
                      )
                    ),
                    React.createElement('div', { className: 'set-group' },
                      React.createElement('div', { className: 'sg-title' }, '设备协作'),
                      React.createElement('div', { className: 'set-row' },
                        React.createElement('div', null,
                          React.createElement('div', { className: 'sr-k' }, '移动端投屏与设备流'),
                          React.createElement('div', { className: 'sr-d' }, '连接安卓或局域网设备协同操作')
                        ),
                        React.createElement('div', { className: 'sr-v' }, '待命就绪')
                      )
                    )
                  ) : (
                    activeTab === 'about' ? React.createElement('div', { className: 'weftmate-v2-about-panel', 'data-setting-panel': 'about' },
                      React.createElement('div', { className: 'weftmate-v2-panel-head' },
                        React.createElement('div', null,
                          React.createElement('div', { className: 'ph-panel-title' }, '关于 WeftMate'),
                          React.createElement('div', { className: 'ph-panel-desc' }, '机器本地的，都是你的')
                        )
                      ),
                      React.createElement('div', { className: 'set-group' },
                        React.createElement('div', { className: 'sg-title' }, '版本信息'),
                        React.createElement('div', { className: 'set-row' },
                          React.createElement('div', null,
                            React.createElement('div', { className: 'sr-k' }, 'WeftMate'),
                            React.createElement('div', { className: 'sr-d' }, '设计语言 v2 · 织语 Weave 体系')
                          ),
                          React.createElement('div', { className: 'sr-v' }, props.appVersion || '暂不可用')
                        ),
                        React.createElement('div', { className: 'set-row' },
                          React.createElement('div', null,
                            React.createElement('div', { className: 'sr-k' }, '运行时状态'),
                            React.createElement('div', { className: 'sr-d' }, 'DSH 内嵌引擎 + 本地模型通信')
                          ),
                          React.createElement('div', { className: 'sr-v' }, '模型连通性尚未探测')
                        ),
                        React.createElement('div', { className: 'set-row' },
                          React.createElement('div', null, React.createElement('div', { className: 'sr-k' }, '检查更新')),
                          React.createElement('div', { className: 'sr-act' },
                            React.createElement('button', {
                              className: 'btn btn-ghost btn-sm',
                              id: 'updBtn',
                              type: 'button',
                              onClick: handleCheckUpdate
                            }, checkUpdateText)
                          )
                        )
                      )
                    ) : (
                      activeTab === 'general' ? React.createElement('div', { className: 'weftmate-v2-general-panel', 'data-setting-panel': 'general' }, renderOverview()) : renderOverview()
                    )
                  )
                )
              )
            )

            var bodyItems = []
            if (feedbackMsg) {
              bodyItems.push(React.createElement('div', { className: 'settings-feedback', role: 'status' }, '✓ ' + feedbackMsg))
            }
            if (Array.isArray(panelContent)) {
              bodyItems = bodyItems.concat(panelContent)
            } else {
              bodyItems.push(panelContent)
            }
            return React.createElement('div', { className: 'page-body' }, bodyItems)
          })()
        ),
        viewingComposition ? React.createElement('div', {
          className: 'weftmate-modal-overlay',
          onClick: function () { setViewingComposition(null) }
        },
          React.createElement('div', {
            className: 'weftmate-modal-panel',
            onClick: function (e) { e.stopPropagation() }
          },
            React.createElement('div', { className: 'wmp-head' },
              React.createElement('div', null,
                React.createElement('div', { className: 'wmp-title' }, '预设组装配置 · ' + viewingComposition.title),
                React.createElement('div', { className: 'wmp-sub' }, 'DSH 官方 Cordis 管道工程 · agent.cordis.yml')
              ),
              React.createElement('button', {
                className: 'btn btn-ghost btn-sm',
                type: 'button',
                onClick: function () { setViewingComposition(null) }
              }, '✕')
            ),
            React.createElement('div', { className: 'wmp-body' },
              React.createElement('div', { className: 'wmp-desc' },
                '此预设基于 Cordis 微内核架构构建，声明了该模式加载的插件链、工具集与会话运行时服务。内置预设受系统保护只读；复制到本地后可自由修改。'
              ),
              React.createElement('pre', { className: 'wmp-code' },
                React.createElement('code', null, viewingComposition.content)
              )
            ),
            React.createElement('div', { className: 'wmp-foot' },
              React.createElement('button', {
                className: 'btn btn-sec btn-sm',
                type: 'button',
                onClick: function () {
                  var current = presets.find(function (p) { return p.id === viewingComposition.id }) || { id: viewingComposition.id, name: viewingComposition.title }
                  setViewingComposition(null)
                  startDuplicatePreset(current)
                }
              }, '复制到本地预设'),
              React.createElement('button', {
                className: 'btn btn-ghost btn-sm',
                type: 'button',
                onClick: function () { setViewingComposition(null) }
              }, '关闭')
            )
          )
        ) : null,

        duplicatingPreset ? React.createElement('div', {
          className: 'weftmate-modal-overlay',
          onClick: function () { if (!duplicatingPreset.saving) setDuplicatingPreset(null) }
        },
          React.createElement('div', {
            className: 'weftmate-modal-panel',
            onClick: function (e) { e.stopPropagation() }
          },
            React.createElement('div', { className: 'wmp-head' },
              React.createElement('div', null,
                React.createElement('div', { className: 'wmp-title' }, '复制预设到本地'),
                React.createElement('div', { className: 'wmp-sub' }, '源预设: ' + duplicatingPreset.fromTitle + ' (' + duplicatingPreset.from + ')')
              ),
              React.createElement('button', {
                className: 'btn btn-ghost btn-sm',
                type: 'button',
                onClick: function () { if (!duplicatingPreset.saving) setDuplicatingPreset(null) }
              }, '✕')
            ),
            React.createElement('div', { className: 'wmp-body' },
              React.createElement('div', { className: 'wmp-desc' },
                '将在用户目录的 .agent-presets/ 下创建专属的 Cordis 组装工程，包含独立的 agent.cordis.yml 与 preset.yml 配置文件。'
              ),
              duplicatingPreset.error ? React.createElement('div', {
                className: 'wmp-error',
                style: { color: 'var(--weftmate-danger, #ef4444)', fontSize: '13px', marginBottom: '12px' }
              }, '⚠ ' + duplicatingPreset.error) : null,
              React.createElement('div', { className: 'fc-field' },
                React.createElement('label', { className: 'fc-label' }, '预设唯一标识符 (ID) *'),
                React.createElement('input', {
                  className: 'fc-input',
                  type: 'text',
                  placeholder: '例: my-assistant',
                  value: duplicatingPreset.id || '',
                  disabled: duplicatingPreset.saving,
                  onChange: function (e) {
                    var val = e.target.value
                    setDuplicatingPreset(function (p) { return Object.assign({}, p, { id: val, error: null }) })
                  }
                }),
                React.createElement('span', { className: 'fc-hint' }, '仅限小写字母、数字及连字符，对应目录名 .agent-presets/<id>/')
              ),
              React.createElement('div', { className: 'fc-field' },
                React.createElement('label', { className: 'fc-label' }, '显示名称 *'),
                React.createElement('input', {
                  className: 'fc-input',
                  type: 'text',
                  placeholder: '例: 我的专属助手',
                  value: duplicatingPreset.name || '',
                  disabled: duplicatingPreset.saving,
                  onChange: function (e) {
                    var val = e.target.value
                    setDuplicatingPreset(function (p) { return Object.assign({}, p, { name: val }) })
                  }
                })
              )
            ),
            React.createElement('div', { className: 'wmp-foot' },
              React.createElement('button', {
                className: 'btn btn-ghost btn-sm',
                type: 'button',
                disabled: duplicatingPreset.saving,
                onClick: function () { setDuplicatingPreset(null) }
              }, '取消'),
              React.createElement('button', {
                className: 'btn btn-pri btn-sm',
                type: 'button',
                disabled: duplicatingPreset.saving,
                onClick: confirmDuplicate
              }, duplicatingPreset.saving ? '创建中...' : '确认复制并创建目录')
            )
          )
        ) : null,

        deletingPreset ? React.createElement('div', {
          className: 'weftmate-modal-overlay',
          onClick: function () { setDeletingPreset(null) }
        },
          React.createElement('div', {
            className: 'weftmate-modal-panel',
            style: { maxWidth: '440px' },
            onClick: function (e) { e.stopPropagation() }
          },
            React.createElement('div', { className: 'wmp-head' },
              React.createElement('div', { className: 'wmp-title' }, '确认删除预设？'),
              React.createElement('button', {
                className: 'btn btn-ghost btn-sm',
                type: 'button',
                onClick: function () { setDeletingPreset(null) }
              }, '✕')
            ),
            React.createElement('div', { className: 'wmp-body' },
              React.createElement('div', { className: 'wmp-desc' },
                '确定要删除自定义预设「' + deletingPreset.name + '」(' + deletingPreset.id + ') 吗？本地对应目录将被移除，此操作不可撤销。'
              )
            ),
            React.createElement('div', { className: 'wmp-foot' },
              React.createElement('button', {
                className: 'btn btn-ghost btn-sm',
                type: 'button',
                onClick: function () { setDeletingPreset(null) }
              }, '取消'),
              React.createElement('button', {
                className: 'btn btn-pri btn-sm',
                style: { background: 'var(--weftmate-danger, #ef4444)', borderColor: 'var(--weftmate-danger, #ef4444)' },
                type: 'button',
                onClick: confirmDeletePreset
              }, '确认删除')
            )
          )
        ) : null
      )
    }

    function V2Workbench(props) {
      var currentSession = props.currentSession
      function goto(hash) { window.location.hash = hash }
      var isRunning = currentSession && (currentSession.running || (currentSession.status && currentSession.status !== 'idle'))
      var sessionTitle = currentSession ? (currentSession.displayTitle || currentSession.title || '') : ''
      var feedbackState = React.useState(''), feedback = feedbackState[0], setFeedback = feedbackState[1]
      React.useEffect(function () { setFeedback('') }, [currentSession && currentSession.id])
      React.useEffect(function () { if (!isRunning && feedback.indexOf('已请求停止') === 0) setFeedback('已停止') }, [isRunning, feedback])

      async function stopCurrentTurn(event) {
        if (event) event.stopPropagation()
        if (!currentSession || !props.sessions || typeof props.sessions.binding !== 'function') { setFeedback('当前会话尚未就绪，无法停止。'); return }
        try {
          var binding = props.sessions.binding(currentSession.id)
          if (!binding || !binding.session || typeof binding.session.cancel !== 'function') throw new Error('当前会话没有可用的停止接口')
          var result = await binding.session.cancel()
          if (!result || result.ok !== true) throw new Error(result && result.error && result.error.message || '停止请求被拒绝')
          setFeedback('已请求停止；等待会话状态回显。')
        } catch (error) { setFeedback('停止失败：' + errorText(error)) }
      }

      function startConversation() {
        if (typeof props.onNewSession !== 'function') { setFeedback('当前宿主没有可用的新会话入口。'); return }
        Promise.resolve(props.onNewSession()).then(function () { goto('#/chat') }, function (error) { setFeedback('新会话未创建：' + errorText(error)) })
      }

      function workButton(icon, title, detail, action, key) {
        return React.createElement('button', { key: key, className: 'wc-row clickable wc-action', type: 'button', onClick: action }, React.createElement('span', { className: 'wc-ic' }, icon), React.createElement('span', { className: 'wc-copy' }, React.createElement('span', { className: 't' }, title), detail ? React.createElement('span', { className: 'wc-mini' }, detail) : null), React.createElement('span', { className: 'wc-go', 'aria-hidden': 'true' }, '›'))
      }

      // The workbench is a projection of the current session. It never
      // invents a workflow, memory count, file, timestamp, or recommendation.
      return React.createElement('aside', { className: 'weftmate-v2-work work-col', id: 'workCol', 'aria-label': '工作台栏' },
        React.createElement('div', { className: 'wc-drawer-head' }, React.createElement('span', null, '工作台'), React.createElement('button', { className: 'wc-drawer-close', type: 'button', 'aria-label': '关闭工作台栏', onClick: props.onClose }, '关闭')),
        React.createElement('div', { className: 'wc-eyebrow' }, '从这里开始'),
        workButton('＋', '新会话', '开始一段新的对话', startConversation, 'new'),
        React.createElement('div', { className: 'wc-eyebrow' }, '进行中'),
        currentSession ? React.createElement('div', { className: 'wc-card wc-current' },
          React.createElement('div', { className: 'wc-head' }, React.createElement('span', { className: 'wc-title' }, sessionTitle || '当前会话'), React.createElement('span', { className: 'badge ' + (isRunning ? 'warn' : 'idle'), style: { marginLeft: 'auto' } }, isRunning ? '运行中' : '空闲')),
          React.createElement('div', { className: 'wc-desc' }, isRunning ? '当前会话正在处理任务，可在这里停止。' : '当前没有正在运行的任务。'),
          isRunning ? React.createElement('div', { className: 'wc-foot' }, React.createElement('span', null, '等待会话状态回显'), React.createElement('button', { className: 'btn btn-ghost btn-sm', id: 'wcMemoStop', type: 'button', style: { marginLeft: 'auto' }, onClick: stopCurrentTurn }, '停止')) : null
        ) : React.createElement('div', { className: 'wc-empty' }, '选择或新建会话后，这里会显示真实运行状态。'),
        feedback ? React.createElement('div', { className: 'weftmate-v2-sidebar-feedback', role: 'status' }, feedback) : null
      )

    }

    function V2CommandPalette(props) {
      var queryState = React.useState(''), query = queryState[0], setQuery = queryState[1]
      var selectedIndexState = React.useState(0), selectedIndex = selectedIndexState[0], setSelectedIndex = selectedIndexState[1]
      var commandErrorState = React.useState(''), commandError = commandErrorState[0], setCommandError = commandErrorState[1]
      var inputRef = React.useRef(null)

      React.useEffect(function () {
        if (props.open) {
          setQuery('')
          setSelectedIndex(0)
          setCommandError('')
          setTimeout(function () { if (inputRef.current) inputRef.current.focus() }, 30)
        }
      }, [props.open])

      var sessionsList = []
      if (props.sessions && props.sessions.list) {
        var snapshot = props.sessions.list.getSnapshot()
        if (snapshot && snapshot.byId && snapshot.ids) {
          sessionsList = snapshot.ids.map(function (id) { return snapshot.byId[id] }).filter(Boolean)
        }
      }

      var items = [
        { g: '页面', ic: '话', t: '回到对话', fn: function () { props.onNavigate('chat') } },
        { g: '页面', ic: '设', t: '设置', fn: function () { props.onNavigate('settings') } },
        { g: '页面', ic: '模', t: '设置: 模型服务', fn: function () { props.onNavigate('settings', 'models') } },
        { g: '页面', ic: '预', t: '设置: 智能体预设', fn: function () { props.onNavigate('settings', 'presets') } },
        { g: '操作', ic: '＋', t: '新会话', fn: async function () { await props.startSession(); props.onNavigate('chat') } },
        { g: '操作', ic: '◧', t: '切换会话栏', fn: function () { document.documentElement.toggleAttribute('data-weftmate-v2-sessions-hidden') } },
        { g: '操作', ic: '◨', t: '切换工作台栏', fn: toggleV2Workbench },
        { g: '操作', ic: '半', t: '切换主题（墨夜 / 纸白）', fn: function () {
          var currentDark = document.body.hasAttribute('data-ds-dark-theme')
          props.theme && props.theme.setTheme && props.theme.setTheme(currentDark ? 'light' : 'dark')
        } },
      ]

      sessionsList.forEach(function (session) {
        var title = session.displayTitle || session.title || ('会话 ' + session.id)
        items.push({
          g: '会话',
          ic: '会',
          t: title,
          fn: async function () {
            await props.sessions.open(session.id)
            props.onNavigate('chat')
          }
        })
      })

      var cleanQuery = query.trim().toLowerCase()
      var filtered = items.filter(function (c) {
        if (!cleanQuery) {
          if (c.g === '会话') {
            var sessionIdx = items.filter(function (x) { return x.g === '会话' }).indexOf(c)
            return sessionIdx < 5
          }
          return true
        }
        return c.t.toLowerCase().indexOf(cleanQuery) >= 0 || c.g.toLowerCase().indexOf(cleanQuery) >= 0
      })

      async function runIndex(i) {
        var c = filtered[i]
        if (!c) return
        try {
          await c.fn()
          props.onClose()
        } catch (error) {
          setCommandError('无法打开会话：' + errorText(error))
        }
      }

      function handleKeyDown(e) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex(function (prev) { return Math.min(filtered.length - 1, prev + 1) })
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex(function (prev) { return Math.max(0, prev - 1) })
        } else if (e.key === 'Enter') {
          e.preventDefault()
          runIndex(selectedIndex)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          props.onClose()
        }
      }

      var lastGroup = ''
      var listElements = []
      if (filtered.length === 0) {
        listElements.push(React.createElement('div', { key: 'empty', style: { padding: '20px', textAlign: 'center', fontSize: '12px', color: 'var(--weftmate-ink-3)' } }, '没有匹配的命令'))
      } else {
        filtered.forEach(function (c, i) {
          if (c.g !== lastGroup) {
            listElements.push(React.createElement('div', { key: 'grp-' + c.g + '-' + i, className: 'cmdk-group' }, c.g))
            lastGroup = c.g
          }
          listElements.push(
            React.createElement('div', {
              key: 'item-' + i,
              className: 'cmdk-item' + (i === selectedIndex ? ' sel' : ''),
              'data-i': String(i),
              role: 'option',
              'aria-selected': String(i === selectedIndex),
            onClick: function () { runIndex(i).catch(function () {}) }
            },
              React.createElement('span', { className: 'ci-ic' }, c.ic),
              c.t
            )
          )
        })
      }

      return React.createElement('div', {
        className: 'overlay' + (props.open ? ' open' : ''),
        id: 'cmdkOverlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '命令面板',
        onClick: function (e) {
          if (e.target.id === 'cmdkOverlay' || (e.target.classList && e.target.classList.contains('overlay'))) {
            props.onClose()
          }
        }
      },
        React.createElement('div', { className: 'cmdk' },
          React.createElement('input', {
            className: 'cmdk-input',
            id: 'cmdkInput',
            ref: inputRef,
            value: query,
            placeholder: '输入命令或搜索…',
            'aria-label': '输入命令或搜索',
            onChange: function (e) { setQuery(e.target.value); setSelectedIndex(0) },
            onKeyDown: handleKeyDown
          }),
          React.createElement('div', { className: 'cmdk-list', id: 'cmdkList' }, listElements),
          commandError ? React.createElement('div', { role: 'status', className: 'cmdk-foot' }, commandError) : null,
          React.createElement('div', { className: 'cmdk-foot' },
            React.createElement('span', null, React.createElement('b', null, '↑↓'), ' 移动'),
            React.createElement('span', null, React.createElement('b', null, 'Enter'), ' 执行'),
            React.createElement('span', null, React.createElement('b', null, 'Esc'), ' 关闭')
          )
        )
      )
    }

    function WeftMateV2Shell(props) {
      var pageState = React.useState(window.location.hash || '#/chat'), page = pageState[0], setPage = pageState[1]
      var sessionsState = React.useSyncExternalStore(function (notify) { return props.sessions.list.subscribe(notify) }, function () { return props.sessions.list.getSnapshot() })
      var currentSession = sessionsState.current && sessionsState.byId ? sessionsState.byId[sessionsState.current] : null
      var themeState = React.useState(document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'), theme = themeState[0], setTheme = themeState[1]
      var cmdkOpenState = React.useState(false), cmdkOpen = cmdkOpenState[0], setCmdkOpen = cmdkOpenState[1]
      var hostStatusState = React.useState({ phase: 'loading', value: null }), hostStatus = hostStatusState[0], setHostStatus = hostStatusState[1]

      function getClockString() {
        var d = new Date()
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
      }
      var clockState = React.useState(getClockString), clock = clockState[0], setClock = clockState[1]

      React.useEffect(function () {
        var timer = setInterval(function () { setClock(getClockString()) }, 1000)
        return function () { clearInterval(timer) }
      }, [])

      React.useEffect(function () {
        var cancelled = false
        function refreshHost() {
          fetch('/weftmate/status.json', { cache: 'no-store' })
            .then(function (response) { if (!response.ok) throw new Error('status unavailable'); return response.json() })
            .then(function (value) { if (!cancelled) setHostStatus({ phase: 'ready', value: value }) })
            .catch(function () { if (!cancelled) setHostStatus({ phase: 'error', value: null }) })
        }
        refreshHost()
        var timer = setInterval(refreshHost, 10000)
        return function () { cancelled = true; clearInterval(timer) }
      }, [])


      React.useEffect(function () {
        window.weftmateOpenCmdk = function () { setCmdkOpen(true) }
        return function () { delete window.weftmateOpenCmdk }
      }, [])

      React.useEffect(function () {
        var onKeyDown = function (e) {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault()
            setCmdkOpen(function (prev) { return !prev })
          } else if (e.key === 'Escape' && cmdkOpen) {
            setCmdkOpen(false)
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return function () { window.removeEventListener('keydown', onKeyDown) }
      }, [cmdkOpen])

      React.useEffect(function () { return installPinnedDshLayoutAdapter(props.layout) }, [])
      React.useEffect(function () {
        var timer
        function syncSettingsRailPosition() {
          var rail = document.querySelector('.weftmate-v2-rail')
          var items = rail && rail.querySelectorAll('.rl-item')
          if (!items || items.length < 2) return
          var first = items[0].getBoundingClientRect(), second = items[1].getBoundingClientRect()
          var gap = Math.max(0, second.top - first.bottom)
          document.documentElement.style.setProperty('--weftmate-v2-settings-top', (second.bottom + gap) + 'px')
        }
        timer = setTimeout(syncSettingsRailPosition, 0)
        window.addEventListener('resize', syncSettingsRailPosition)
        return function () { clearTimeout(timer); window.removeEventListener('resize', syncSettingsRailPosition); document.documentElement.style.removeProperty('--weftmate-v2-settings-top') }
      }, [])
      React.useEffect(function () { return installSettingsRailTriggerAdapter() }, [])
      var columnVisibility = useV2ColumnVisibility()
      React.useEffect(function () { var onHash = function () { setPage(window.location.hash || '#/chat') }; window.addEventListener('hashchange', onHash); return function () { window.removeEventListener('hashchange', onHash) } }, [])
      var isSettings = /^#\/settings(\/.*)?$/.test(page)
      var settingsSubpage = isSettings ? (page.replace(/^#\/settings\/?/, '') || 'general') : 'general'
      var pageKey = isSettings ? 'settings' : 'chat'
      var nonChat = isSettings
      React.useEffect(function () { document.documentElement.setAttribute('data-weftmate-v2-page', pageKey); var columns = Array.prototype.slice.call(document.querySelectorAll('[data-weftmate-v2-center],[data-weftmate-v2-details]')); columns.forEach(function (column) { column.inert = nonChat; column.style.visibility = nonChat ? 'hidden' : '' }); return function () { columns.forEach(function (column) { column.inert = false; column.style.visibility = '' }); document.documentElement.removeAttribute('data-weftmate-v2-page') } }, [pageKey, nonChat])
      React.useEffect(function () { if (pageKey !== 'chat') closeV2WorkbenchDrawer() }, [pageKey])
      React.useEffect(function () { closeV2WorkbenchDrawer() }, [currentSession && currentSession.id])
      React.useEffect(function () { var update = function () { setTheme(document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light') }; var observer = new MutationObserver(update); observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] }); return function () { observer.disconnect() } }, [])
      React.useEffect(function () { var bridge = window.weftmateSurface; var title = document.querySelector('.weftmate-v2-shell .titlebar'); if (bridge && title && typeof bridge.syncTheme === 'function') bridge.syncTheme(theme, getComputedStyle(title).backgroundColor).catch(function () {}) }, [theme])
      function choose(next, sub) {
        if (next === 'settings') window.location.hash = '/settings' + (sub ? '/' + sub : '')
        else window.location.hash = '/chat'
      }
      async function newSession() { if (typeof props.startSession !== 'function') throw new Error('当前宿主没有可用的新会话入口。'); return await props.startSession() }
      function icon(kind) {
        var children = kind === 'chat' ? [React.createElement('path', { key: 'p', d: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6z' })] :
          kind === 'theme' ? [React.createElement('path', { key: 'p', d: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4' }), React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 4 })] :
          [React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 3 }), React.createElement('path', { key: 'p', d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1' })];
        return React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }, children)
      }

      var sessionCount = (sessionsState && sessionsState.ids ? sessionsState.ids.length : 0)
      var appVersion = hostStatus.phase === 'ready' && hostStatus.value && hostStatus.value.app && typeof hostStatus.value.app.version === 'string' && hostStatus.value.app.version ? hostStatus.value.app.version : null
      var subpageLabels = {
        general: '通用与外观',
        models: '模型服务',
        presets: '智能体预设',
        'agent-presets': '智能体预设',
        plugins: '插件扩展',
        perception: '桌面感知与设备',
        weftmate: '桌面感知与设备',
        about: '关于'
      }
      var crumbTitle = isSettings ? ('设置 · ' + (subpageLabels[settingsSubpage] || '通用与外观')) : '对话'

      return React.createElement('div', { className: 'weftmate-v2-shell app', 'data-theme': theme, 'data-page': pageKey, 'aria-label': 'WeftMate V2 shell' },
        React.createElement('header', { className: 'weftmate-v2-title titlebar' },
          React.createElement('span', { className: 'tb-logo' }, '纬'),
          React.createElement('b', { className: 'tb-name' }, 'WeftMate'),
          React.createElement('span', { className: 'tb-sep' }, '·'),
          React.createElement('span', { className: 'tb-crumb' }, crumbTitle),
          React.createElement('div', {
            className: 'tb-search',
            id: 'tbSearch',
            role: 'button',
            tabIndex: 0,
            'aria-label': '搜索或下命令',
            onClick: function () { setCmdkOpen(true) },
            onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCmdkOpen(true) } }
          },
            React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' },
              React.createElement('circle', { cx: 11, cy: 11, r: 7 }),
              React.createElement('path', { d: 'M20 20l-3.5-3.5' })
            ),
            '搜索或下命令…',
            React.createElement('kbd', null, 'Ctrl+K / ⌘K')
          ),
          React.createElement('div', { className: 'tb-right' },
            React.createElement('button', { className: 'icon-btn', type: 'button', 'aria-label': '切换主题', onClick: function () { props.theme && props.theme.setTheme && props.theme.setTheme(theme === 'dark' ? 'light' : 'dark') } }, icon('theme'))
          )
        ),
        React.createElement('nav', { className: 'weftmate-v2-rail rail', 'aria-label': 'WeftMate 导航' },
          React.createElement('button', { className: 'rl-item ' + (pageKey === 'chat' ? 'on' : ''), type: 'button', 'aria-label': '对话', onClick: function () { choose('chat') } }, icon('chat'), '对话', pageKey === 'chat' ? React.createElement('span', { className: 'rl-dot' }) : null),
          React.createElement('button', { className: 'rl-item ' + (pageKey === 'settings' ? 'on' : ''), type: 'button', 'aria-label': '设置', onClick: function () { choose('settings') } }, icon('settings'), '设置', pageKey === 'settings' ? React.createElement('span', { className: 'rl-dot' }) : null),
          React.createElement('div', { className: 'r-bottom' },
            React.createElement('div', { className: 'r-avatar', title: '本地账户' }, 'Y')
          )),
        React.createElement('div', { className: 'weftmate-v2-head chat-head' },
          React.createElement('div', { className: 'ch-left' },
            React.createElement('button', { className: 'icon-btn' + (columnVisibility.sessions ? ' on' : ''), type: 'button', 'aria-label': '会话栏', 'aria-pressed': String(columnVisibility.sessions), 'aria-expanded': String(columnVisibility.sessions), onClick: function () { document.documentElement.toggleAttribute('data-weftmate-v2-sessions-hidden') } }, React.createElement('svg', { viewBox: '0 0 24 24' }, React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), React.createElement('line', { x1: 9.5, y1: 4, x2: 9.5, y2: 20 }))),
            React.createElement('div', { className: 'ch-title' }, pageKey === 'settings' ? '设置' : v2ChatTitle(currentSession)),
            React.createElement('span', { className: 'ch-sub' }, pageKey === 'settings' ? '机器本地的，都是你的' : '对话是一切的入口')),
          React.createElement('div', { className: 'sp' },
            React.createElement('button', { className: 'icon-btn' + (columnVisibility.work ? ' on' : ''), type: 'button', 'aria-label': '工作台栏', 'aria-pressed': String(columnVisibility.work), 'aria-expanded': String(columnVisibility.work), onClick: toggleV2Workbench }, React.createElement('svg', { viewBox: '0 0 24 24' }, React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), React.createElement('line', { x1: 14.5, y1: 4, x2: 14.5, y2: 20 }))))),
        React.createElement(V2Workbench, { currentSession: currentSession, sessions: props.sessions, onNewSession: newSession, onNavigate: choose, onClose: closeV2WorkbenchDrawer }),
        isSettings ? React.createElement('section', { className: 'weftmate-v2-page weftmate-v2-settings on', id: 'page-settings' }, React.createElement(V2SettingsWorkspace, { theme: props.theme, connection: props.connection, subpage: settingsSubpage, onNavigate: choose, appVersion: appVersion })) : null,
        React.createElement('footer', { className: 'weftmate-v2-status statusbar', 'aria-label': '状态栏' },
          React.createElement('span', { className: 'st' },
            React.createElement('span', { className: 'dot' }),
            hostStatus.phase === 'ready' ? '宿主已连接' : (hostStatus.phase === 'loading' ? '正在读取宿主状态' : '宿主状态不可用')
          ),
          React.createElement('span', { className: 'st' }, hostStatus.phase === 'ready' && hostStatus.value && hostStatus.value.update ? (hostStatus.value.update.status === 'disabled' ? '更新未启用' : ('更新：' + (hostStatus.value.update.status || '未知'))) : '更新状态未知'),
          React.createElement('div', { className: 'right' },
            React.createElement('span', { className: 'st' }, '会话 ', React.createElement('b', null, String(sessionCount))),
            React.createElement('span', { className: 'st', id: 'stClock' }, clock)
          )
        ),
        React.createElement(V2CommandPalette, {
          open: cmdkOpen,
          onClose: function () { setCmdkOpen(false) },
          sessions: props.sessions,
          workspaces: props.workspaces,
          theme: props.theme,
          startSession: newSession,
          onNavigate: choose
        }),
        React.createElement('div', { className: 'weftmate-v2-layout-error', role: 'status' }, 'V2 布局接缝未匹配，已保留官方布局。'),
        React.createElement('div', { className: 'weftmate-v2-sidebar-restore-error', role: 'status' }, '会话栏未能在宽窗口恢复；可用官方会话栏按钮手动打开。'))
    }

    return {
      name: 'weftmate-client',
      inject: ['slots', 'connection', 'sessions', 'workspaces', 'theme', 'layout'],
      apply: function (ctx) {
        if (window.weftmateConversation) ctx.effect(function () {
          var bridge = window.weftmateConversation
          var report = function () { bridge.reportState(ctx.sessions.list.getSnapshot().current, ctx.theme.getTheme().active.colorScheme) }
          var unsubscribe = ctx.sessions.list.subscribe(report)
          var offTheme = ctx.on('theme/change', report)
          var offCommand = bridge.onCommand(function (command) {
            try {
              if (command.type === 'select-session') ctx.sessions.open(command.sessionId)
              else if (command.type === 'theme' && ['light', 'dark', 'system'].indexOf(command.theme) >= 0) ctx.theme.setTheme(command.theme)
              else throw new Error('Unsupported carrier command')
              report()
              bridge.reply(command.id, true)
            } catch (error) { bridge.reply(command.id, false, String(error && error.message || error)) }
          })
          report()
          return function () { unsubscribe(); offTheme(); offCommand() }
        })
        installElectronWindowChrome()
        installConversationWorkspaceSurface()
        installV2CentralConversationStyle()
        installWeftmateV2Style()
        installWeftmateV2ShellStyle()
        installFrozenV2ShellCss()
        ctx.slots.inject('conversation.input.dock', function () {
          return ctx.slots.register({ name: 'conversation.input.dock', id: 'weftmate-v2-hero', order: -1000 }, V2ConversationHero)
        })
        ctx.slots.inject('conversation.composer.dock', function () {
          return ctx.slots.register({ name: 'conversation.composer.dock', id: 'weftmate-v2-hint', order: -1000 }, V2ComposerHint)
        })
        // 声明等待：官方槽位系统要求目标槽已被某个声明者（ui-layout 在 root 的 children 表里
        // 声明 shell.overlay）登记；`slots.inject(key, cb)` 是官方「声明依赖」接缝——声明已存在则
        // 同步注册，否则等声明者的 register 提交后再注册（回调返回注册的 disposer，随声明生命周期回收）。
        // 本行注册进官方 shell.overlay 槽位（list 槽位：additive；inject 面把 hostDescription 源传给组件）。
        // R6/R8 开关面收口：感知/桌宠胶囊已删，全部开关进官方设置页「WeftMate」节
        // （settings.section 由 ui-settings-general 在占据 sidebar.settings 时声明；
        // slots.inject 声明依赖接缝——声明就绪后注册，节内块：桌面感知/桌面宠物/设备配对）。
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'weftmate',
            order: 5000,
            label: 'WeftMate',
            inject: function () { return {} },
          }, WeftMateSettingsSection)
        })
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'weftmate-v2-shell',
            order: 9100,
            inject: function () { return { sessions: ctx.sessions, workspaces: ctx.workspaces, layout: ctx.layout, theme: ctx.theme, connection: ctx.connection, startSession: function (workspaceId) { return startWorkspaceSession(ctx.workspaces, ctx.sessions, workspaceId) } } },
          }, WeftMateV2Shell)
        })
        ctx.slots.inject('sidebar.workspaces', function () {
          return ctx.slots.register({ name: 'sidebar.workspaces', id: 'weftmate-v2-sessions', priority: -100, inject: function () { return { sessions: ctx.sessions, workspaces: ctx.workspaces, connection: ctx.connection, startSession: function (workspaceId) { return startWorkspaceSession(ctx.workspaces, ctx.sessions, workspaceId) } } } }, V2SessionSidebar)
        })
      },
    }
  },
})
