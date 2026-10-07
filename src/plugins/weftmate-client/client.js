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
    // The parent UI is a classic script, while the frame bridge is an ES module
    // so its message admission rules can be executed directly in Node tests.
    var modFrameBridgePromise = import('/weftmate/mods/bridge.mjs').then(function (module) { return { module: module, error: null } }, function (error) { return { module: null, error: error && error.message ? error.message : '业务界面桥接模块未能加载。' } })
    var modStatePromise = import('/weftmate/mods/state.mjs').then(function (module) { return module }, function () { return null })

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

    // Stage 4B is a projection inside the resident DSH details column. The
    // selected Tool result supplies the durable pointer; this client receives
    // only allowlisted state from a fixed same-origin route.
    var AI_GAME_STATUSES = {
      scheduled: '已计划', running: '执行中', waiting_time: '等待时间', waiting_event: '等待设备事件', recovering: '恢复中', replanning: '重新规划中', paused: '已暂停', user_takeover: '用户接管中', needs_user_input: '等待你的回答',
      succeeded: '已完成', failed: '失败', cancelled: '已取消',
    }
    var aiGameAutoOpened = Object.create(null)
    var aiGameOverview = Object.create(null)

    function installAiGamePanelStyles() {
      if (!document || !document.head || document.getElementById('weftmate-ai-game-panel-style')) return
      var style = document.createElement('style')
      style.id = 'weftmate-ai-game-panel-style'
      style.textContent = [
        '.weftmate-phone-row{display:flex;align-items:center;gap:10px;min-width:0;padding:7px 2px;color:var(--dsw-alias-label-primary)}',
        '.weftmate-phone-row__mark{width:8px;height:8px;flex:none;border-radius:50%;background:var(--dsw-alias-brand-primary)}',
        '.weftmate-phone-row__copy{min-width:0;flex:1}.weftmate-phone-row__title{font-size:13px;font-weight:600;line-height:1.4}',
        '.weftmate-phone-row__status{overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;text-overflow:ellipsis;white-space:nowrap}',
        '.weftmate-phone-row__open,.weftmate-ai-game__action{min-height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:500 12px/1.35 var(--dsw-font-family,system-ui,sans-serif);cursor:pointer}',
        '.weftmate-phone-row__open{padding:4px 9px;flex:none}.weftmate-phone-row__open:hover,.weftmate-ai-game__action:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.weftmate-phone-row__open:focus-visible,.weftmate-ai-game__action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        '.weftmate-ai-game{margin-top:18px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui,sans-serif)}',
        '.weftmate-ai-game__header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 0 14px}.weftmate-ai-game__eyebrow{color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:650;letter-spacing:.1em;text-transform:uppercase}.weftmate-ai-game__heading{margin-top:3px;font-size:15px;font-weight:650;line-height:1.35}',
        '.weftmate-ai-game__badge{flex:none;max-width:46%;padding:3px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1.4;text-align:center}.weftmate-ai-game__badge[data-status="needs_user_input"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
        '.weftmate-ai-game__section{padding:13px 0;border-top:1px solid var(--dsw-alias-border-l2)}.weftmate-ai-game__label{margin-bottom:5px;color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:650;letter-spacing:.06em;text-transform:uppercase}',
        '.weftmate-ai-game__goal{font-size:13px;font-weight:560;line-height:1.55;overflow-wrap:anywhere}.weftmate-ai-game__facts{display:grid;grid-template-columns:minmax(78px,.42fr) minmax(0,1fr);gap:7px 12px;margin:0;font-size:12px;line-height:1.5}.weftmate-ai-game__facts dt{color:var(--dsw-alias-label-tertiary)}.weftmate-ai-game__facts dd{min-width:0;margin:0;overflow-wrap:anywhere}',
        '.weftmate-ai-game__question{padding:12px 0;border-block:1px solid var(--dsw-alias-brand-primary)}.weftmate-ai-game__question p,.weftmate-ai-game__notice p{margin:0;font-size:12px;line-height:1.55;overflow-wrap:anywhere}.weftmate-ai-game__muted{margin-top:5px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}',
        '.weftmate-ai-game__list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.weftmate-ai-game__list li{display:grid;gap:2px;font-size:11px;line-height:1.45;overflow-wrap:anywhere}.weftmate-ai-game__meta{color:var(--dsw-alias-label-tertiary);font-size:10px}',
        '.weftmate-ai-game__actions{display:flex;flex-wrap:wrap;gap:7px;padding:14px 0 2px;border-top:1px solid var(--dsw-alias-border-l2)}.weftmate-ai-game__action{padding:5px 10px}.weftmate-ai-game__notice{padding:12px 0;color:var(--dsw-alias-label-secondary)}.weftmate-ai-game__skeleton{min-height:72px;padding:18px 0;color:var(--dsw-alias-label-secondary);font-size:12px}',
        '@media(max-width:900px){.weftmate-ai-game__facts{grid-template-columns:1fr;gap:2px}.weftmate-ai-game__facts dd{margin-bottom:6px}}',
        '@media(prefers-reduced-motion:reduce){.weftmate-phone-row__open,.weftmate-ai-game__action{transition:none!important;animation:none!important}}',
      ].join('\n')
      document.head.appendChild(style)
    }

    function aiGamePointer(block) {
      if (!block || typeof block !== 'object' || !('kind' in block)) return null
      var meta = block.meta
      if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.toolName !== 'phone_execution'
        || !AI_GAME_STATUSES[meta.status] || !Number.isSafeInteger(meta.eventCursor) || meta.eventCursor < 0) return null
      if (meta.schemaVersion === 1 && meta.kind === 'ai-game-execution'
        && typeof meta.executionId === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(meta.executionId)) return { executionId: meta.executionId, status: meta.status, eventCursor: meta.eventCursor, version: 1 }
      if (meta.schemaVersion === 2 && meta.kind === 'ai-game-task'
        && typeof meta.taskId === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(meta.taskId)) return { executionId: meta.taskId, taskId: meta.taskId, status: meta.status, eventCursor: meta.eventCursor, version: 2 }
      return null
    }

    function safeAiGameSnapshot(value) {
      if (value && typeof value === 'object' && typeof value.taskId === 'string' && AI_GAME_STATUSES[value.status]) {
        var controls = Array.isArray(value.allowedControls) ? value.allowedControls : []
        return { executionId: value.taskId, taskId: value.taskId, currentRevision: Number.isSafeInteger(value.currentRevision) ? value.currentRevision : null, status: value.status, goalSummary: typeof value.goalSummary === 'string' ? value.goalSummary : '', currentStage: typeof value.currentStage === 'string' ? value.currentStage : null,
          progress: { kind: 'unknown', explanation: '当前没有权威数值进度。' }, currentAction: typeof value.currentAction === 'string' ? value.currentAction : null,
          pendingQuestion: value.pendingQuestion && typeof value.pendingQuestion.question === 'string' ? { questionId: String(value.pendingQuestion.questionId || ''), question: value.pendingQuestion.question, whyNeeded: String(value.pendingQuestion.whyNeeded || '') } : null,
          resultSummary: typeof value.resultSummary === 'string' ? value.resultSummary : null, error: value.error && typeof value.error.code === 'string' ? { code: value.error.code } : null,
          evidence: [], eventCursor: Number.isSafeInteger(value.eventCursor) ? value.eventCursor : 0,
          allowedIntents: { pause: controls.indexOf('pause') >= 0 && value.status !== 'paused', cancel: controls.indexOf('cancel') >= 0, resume: controls.indexOf('resume') >= 0, answer: value.status === 'needs_user_input' } }
      }
      if (!value || typeof value !== 'object' || !AI_GAME_STATUSES[value.status]
        || typeof value.executionId !== 'string' || typeof value.goalSummary !== 'string'
        || !value.progress || value.progress.kind !== 'unknown' || !Number.isSafeInteger(value.eventCursor) || value.eventCursor < 0
        || !Array.isArray(value.evidence) || !value.allowedIntents) throw new Error('AI_GAME_PANEL_SCHEMA_REJECTED')
      return {
        executionId: value.executionId, status: value.status, goalSummary: value.goalSummary,
        currentStage: typeof value.currentStage === 'string' ? value.currentStage : null,
        progress: { kind: 'unknown', explanation: typeof value.progress.explanation === 'string' ? value.progress.explanation : '' },
        currentAction: typeof value.currentAction === 'string' ? value.currentAction : null,
        pendingQuestion: value.pendingQuestion && typeof value.pendingQuestion.question === 'string'
          ? { questionId: String(value.pendingQuestion.questionId || ''), question: value.pendingQuestion.question, whyNeeded: String(value.pendingQuestion.whyNeeded || '') }
          : null,
        resultSummary: typeof value.resultSummary === 'string' ? value.resultSummary : null,
        error: value.error && typeof value.error.code === 'string' ? { code: value.error.code } : null,
        evidence: value.evidence.slice(0, 10).map(function (item) {
          return { evidenceId: String(item.evidenceId || ''), contentType: String(item.contentType || 'application/octet-stream'), sizeBytes: Number.isSafeInteger(item.sizeBytes) ? item.sizeBytes : 0, availability: item.availability === 'protected' ? 'protected' : 'unavailable' }
        }),
        eventCursor: value.eventCursor,
        allowedIntents: { cancel: value.allowedIntents.cancel === true, resume: value.allowedIntents.resume === true, answer: value.allowedIntents.answer === true },
      }
    }

    function safeAiGamePanel(value, sessionId) {
      if (!value || value.schemaVersion !== 1 || value.kind !== 'ai-game-panel'
        || value.sessionId !== sessionId || typeof value.hasExecution !== 'boolean') throw new Error('AI_GAME_PANEL_SCHEMA_REJECTED')
      if (!value.hasExecution) return { hasExecution: false, sessionId: sessionId }
      var selectedId = typeof value.selectedExecutionId === 'string' ? value.selectedExecutionId : value.selectedTaskId
      if (typeof selectedId !== 'string' || !Array.isArray(value.history) || !Array.isArray(value.events)) throw new Error('AI_GAME_PANEL_SCHEMA_REJECTED')
      return {
        hasExecution: true, sessionId: sessionId, selectedExecutionId: selectedId, selectedTaskId: typeof value.selectedTaskId === 'string' ? value.selectedTaskId : null,
        availability: value.availability === 'ready' ? 'ready' : 'unavailable',
        snapshot: value.snapshot === null ? null : safeAiGameSnapshot(value.snapshot),
        historyCount: value.history.length,
        events: value.events.slice(-12).filter(function (item) { return item && Number.isSafeInteger(item.cursor) && item.cursor > 0 && typeof item.label === 'string' }).map(function (item) { return { cursor: item.cursor, label: item.label, createdAt: typeof item.createdAt === 'string' ? item.createdAt : null } }),
        nextCursor: Number.isSafeInteger(value.nextCursor) && value.nextCursor >= 0 ? value.nextCursor : 0,
        failure: value.failure && typeof value.failure.code === 'string' ? { code: value.failure.code, message: String(value.failure.message || ''), retryable: value.failure.retryable === true } : null,
        eventsFailure: value.eventsFailure && typeof value.eventsFailure.code === 'string' ? { code: value.eventsFailure.code } : null,
      }
    }

    function fetchAiGamePanel(sessionId, executionId, after, signal) {
      var params = new URLSearchParams({ session_id: sessionId, after: String(after || 0) })
      if (executionId) params.set('execution_id', executionId)
      return fetch('/weftmate/ai-game/panel.json?' + params.toString(), {
        method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: signal, headers: { Accept: 'application/json' },
      }).then(function (response) {
        if (!response.ok) throw new Error('AI_GAME_PANEL_HTTP_' + response.status)
        return response.json()
      }).then(function (value) { return safeAiGamePanel(value, sessionId) })
    }

    function aiGameOverviewFor(sessionId) {
      var cached = aiGameOverview[sessionId]
      if (cached && Date.now() - cached.startedAt < 1200) return cached.promise
      var promise = fetchAiGamePanel(sessionId, null, 0).catch(function () { return null })
      aiGameOverview[sessionId] = { startedAt: Date.now(), promise: promise }
      return promise
    }

    function PhoneExecutionRow(props) {
      var pointer = aiGamePointer(props.block)
      React.useEffect(function () {
        if (!pointer || typeof props.openDetails !== 'function') return
        var key = props.sessionId + '\u0000' + pointer.executionId
        if (aiGameAutoOpened[key]) return
        var active = true
        aiGameOverviewFor(props.sessionId).then(function (overview) {
          if (!active || !overview || overview.selectedExecutionId !== pointer.executionId || aiGameAutoOpened[key]) return
          aiGameAutoOpened[key] = true
          props.openDetails()
        })
        return function () { active = false }
      }, [props.sessionId, pointer && pointer.executionId, props.openDetails])
      var status = pointer ? AI_GAME_STATUSES[pointer.status] : ('kind' in props.block ? '未取得执行指针' : '正在建立执行')
      return React.createElement('div', { className: 'weftmate-phone-row', 'data-weftmate-phone-execution': pointer ? pointer.executionId : 'pending' },
        React.createElement('span', { className: 'weftmate-phone-row__mark', 'aria-hidden': 'true' }),
        React.createElement('div', { className: 'weftmate-phone-row__copy' },
          React.createElement('div', { className: 'weftmate-phone-row__title' }, 'AI-Game 手机执行'),
          React.createElement('div', { className: 'weftmate-phone-row__status' }, status)),
        typeof props.openDetails === 'function' ? React.createElement('button', {
          type: 'button', className: 'weftmate-phone-row__open', onClick: props.openDetails, 'aria-label': '打开 AI-Game 执行详情',
        }, '查看') : null)
    }

    function aiGameTime(value) {
      var date = value ? new Date(value) : null
      return date && !isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
    }

    function aiGameBytes(value) {
      if (!Number.isFinite(value) || value <= 0) return '大小未知'
      if (value < 1024) return value + ' B'
      if (value < 1024 * 1024) return Math.round(value / 1024) + ' KB'
      return (value / (1024 * 1024)).toFixed(1) + ' MB'
    }

    function WeftModExecutionRow(props) {
      var block = props.block || {}, args = {}, result = null
      try { args = JSON.parse(block.argsRaw || block.call && block.call.argsRaw || '{}') } catch (_) {}
      var outputText = (block.content || []).filter(function (item) { return item.type === 'text' }).map(function (item) { return item.text }).join('\n')
      try { result = JSON.parse(outputText) } catch (_) {}
      var failed = block.isError === true || result && result.status === 'failed'
      var labels = { list: '查找脚本', help: '工具说明', save: '保存脚本', read: '读取脚本', run: '运行脚本', history: '执行记录', inspect: '运行结果', control: '控制执行' }
      return React.createElement('div', { className: 'weftmate-phone-row' },
        React.createElement('span', { className: 'weftmate-phone-row__mark', 'aria-hidden': 'true' }),
        React.createElement('div', { className: 'weftmate-phone-row__copy' },
          React.createElement('div', null, 'WeftMod · ' + (labels[args.action] || '脚本操作')),
          failed ? React.createElement('small', { role: 'alert' }, '遇到问题：' + String(result && result.error && result.error.message || outputText).slice(0, 200)) : null),
        React.createElement('button', { type: 'button', className: 'weftmate-phone-row__open', onClick: props.openDetails }, args.action === 'run' ? '查看与停止' : '查看详情'))
    }

    function WeftModExecutionDetails(props) {
      var state = React.useState({ runs: [], error: '' })
      var panel = state[0], setPanel = state[1]
      var refresh = React.useState(0), setRefresh = refresh[1]
      React.useEffect(function () {
        if (props.toolName !== 'weftmod_script') return
        var stopped = false, timer, controller
        function poll() {
          controller = new AbortController()
          fetch('/weftmate/weftmod/panel.json?session_id=' + encodeURIComponent(props.sessionId), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
            .then(function (r) { if (!r.ok) throw new Error('执行状态暂时不可用'); return r.json() })
            .then(function (v) { if (!stopped) setPanel({ runs: v.runs || [], error: '' }) })
            .catch(function (e) { if (!stopped) setPanel(function (old) { return { runs: old.runs, error: e.message } }) })
            .finally(function () { if (!stopped) timer = setTimeout(poll, 1200) })
        }
        poll()
        return function () { stopped = true; clearTimeout(timer); if (controller) controller.abort() }
      }, [props.sessionId, props.toolName, refresh[0]])
      if (props.toolName !== 'weftmod_script') return null
      function control(run, action) {
        fetch('/weftmate/weftmod/control.json', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: props.sessionId, run_id: run.run_id, action: action }) })
          .then(function (r) { return r.json().then(function (v) { if (!r.ok) throw new Error(v.error || '操作失败') }) })
          .then(function () { setRefresh(function (v) { return v + 1 }) })
          .catch(function (e) { setPanel(function (old) { return { runs: old.runs, error: e.message } }) })
      }
      var labels = { running: '正在执行', stopping: '正在停止', paused: '已暂停', cancelled: '已取消', interrupted: '应用重启后已暂停', succeeded: '脚本已执行', failed: '执行遇到问题' }
      return React.createElement('section', { className: 'weftmate-ai-game', 'aria-label': 'WeftMod 执行状态' },
        React.createElement('strong', null, 'WeftMod · 连续任务'),
        panel.error ? React.createElement('p', { role: 'alert' }, panel.error) : null,
        panel.runs.length ? panel.runs.map(function (run) {
          var elapsed = run.elapsed_ms == null ? Date.now() - Date.parse(run.started_at) : run.elapsed_ms
          return React.createElement('div', { key: run.run_id, style: { padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
            React.createElement('div', null, run.script_id + ' · ' + (labels[run.status] || run.status)),
            React.createElement('small', null, (run.reused ? '复用已有脚本' : '首次运行此版本') + ' · ' + Math.max(0, elapsed / 1000).toFixed(1) + ' 秒 · ' + run.tool_calls + ' 次工具调用'),
            run.current_action ? React.createElement('p', null, '当前：' + run.current_action) : null,
            run.error ? React.createElement('p', { role: 'alert' }, typeof run.error === 'string' ? run.error : run.error.message) : null,
            ['running', 'stopping'].indexOf(run.status) >= 0 ? React.createElement('div', { className: 'weftmate-ai-game__actions' },
              React.createElement('button', { type: 'button', disabled: run.status === 'stopping', className: 'weftmate-ai-game__action', onClick: function () { control(run, 'pause') } }, '暂停'),
              React.createElement('button', { type: 'button', disabled: run.status === 'stopping', className: 'weftmate-ai-game__action', onClick: function () { control(run, 'cancel') } }, '取消')) : null,
            ['paused', 'interrupted'].indexOf(run.status) >= 0 ? React.createElement('p', null, '已保留执行记录；让助手检查当前状态后继续。') : null)
        }) : React.createElement('p', null, '脚本开始运行后，这里会显示进度、用时和停止操作。'))
    }

    function AiGameExecutionDetails(props) {
      var pointer = aiGamePointer(props.block)
      var panelState = React.useState(null)
      var panel = panelState[0]
      var setPanel = panelState[1]
      var retryState = React.useState(0)
      var retry = retryState[0]
      var setRetry = retryState[1]
      var visibleState = React.useState(document.visibilityState !== 'hidden')
      var visible = visibleState[0]
      var setVisible = visibleState[1]
      var rootRef = React.useRef(null)
      var cursorRef = React.useRef(0)
      var eventRef = React.useRef(new Map())
      var draft = props.useInput(function (input) { return input.draft })

      React.useEffect(function () {
        var root = rootRef.current
        var inViewport = true
        var update = function () { setVisible(document.visibilityState !== 'hidden' && inViewport) }
        var onVisibility = function () { update() }
        document.addEventListener('visibilitychange', onVisibility)
        var observer = typeof IntersectionObserver === 'function' && root
          ? new IntersectionObserver(function (entries) {
              inViewport = entries.length === 0 || entries[0].isIntersecting
              update()
            })
          : null
        if (observer && root) observer.observe(root)
        update()
        return function () {
          document.removeEventListener('visibilitychange', onVisibility)
          if (observer) observer.disconnect()
        }
      }, [])

      React.useEffect(function () {
        if (!pointer || !visible) return
        var stopped = false
        var timer = null
        var controller = null
        var backoff = 1500
        cursorRef.current = 0
        eventRef.current = new Map()
        var poll = function () {
          if (stopped) return
          controller = new AbortController()
          fetchAiGamePanel(props.sessionId, pointer.executionId, cursorRef.current, controller.signal)
            .then(function (next) {
              if (stopped || next.selectedExecutionId !== pointer.executionId) return
              next.events.forEach(function (event) { eventRef.current.set(event.cursor, event) })
              next.events = Array.from(eventRef.current.values()).sort(function (a, b) { return a.cursor - b.cursor }).slice(-12)
              cursorRef.current = Math.max(cursorRef.current, next.nextCursor, next.snapshot ? next.snapshot.eventCursor : 0)
              setPanel(next)
              backoff = 1500
              var terminal = next.snapshot && ['succeeded', 'failed', 'cancelled'].indexOf(next.snapshot.status) >= 0
              timer = setTimeout(poll, terminal ? 10000 : 1500)
            })
            .catch(function () {
              if (stopped) return
              setPanel(function (prior) {
                return prior ? Object.assign({}, prior, {
                  availability: 'unavailable',
                  failure: { code: 'AI_GAME_PANEL_UNAVAILABLE', message: 'AI-Game 当前不可用；历史 DSH 对话仍可读取。', retryable: true },
                }) : {
                  hasExecution: true,
                  sessionId: props.sessionId,
                  selectedExecutionId: pointer.executionId,
                  availability: 'unavailable',
                  snapshot: null,
                  historyCount: 1,
                  events: [],
                  nextCursor: cursorRef.current,
                  failure: { code: 'AI_GAME_PANEL_UNAVAILABLE', message: 'AI-Game 当前不可用；历史 DSH 对话仍可读取。', retryable: true },
                  eventsFailure: null,
                }
              })
              timer = setTimeout(poll, backoff)
              backoff = Math.min(backoff * 2, 10000)
            })
        }
        poll()
        return function () {
          stopped = true
          if (timer !== null) clearTimeout(timer)
          if (controller) controller.abort()
        }
      }, [props.sessionId, pointer && pointer.executionId, visible, retry])

      var fillComposer = function (instruction) {
        if (!props.inputActions || typeof props.inputActions.setDraft !== 'function') return
        var prefix = draft && draft.trim() ? draft.replace(/\s+$/, '') + '\n\n' : ''
        props.inputActions.setDraft(prefix + instruction)
      }
      if (!pointer) {
        return React.createElement('div', { ref: rootRef, className: 'weftmate-ai-game' },
          React.createElement('div', { className: 'weftmate-ai-game__skeleton', role: 'status' }, '等待 DSH 写入可恢复的 AI-Game 执行指针…'))
      }
      if (!panel) {
        return React.createElement('div', { ref: rootRef, className: 'weftmate-ai-game' },
          React.createElement('div', { className: 'weftmate-ai-game__skeleton', role: 'status' }, '正在读取 AI-Game 权威状态…'))
      }
      var snap = panel.snapshot
      if (!snap) {
        return React.createElement('div', { ref: rootRef, className: 'weftmate-ai-game' },
          React.createElement('div', { className: 'weftmate-ai-game__header' },
            React.createElement('div', null,
              React.createElement('div', { className: 'weftmate-ai-game__eyebrow' }, 'AI-Game execution'),
              React.createElement('div', { className: 'weftmate-ai-game__heading' }, '执行状态暂不可用')),
            React.createElement('span', { className: 'weftmate-ai-game__badge' }, '已断线')),
          React.createElement('div', { className: 'weftmate-ai-game__notice', role: 'status' },
            React.createElement('p', null, panel.failure ? panel.failure.message : 'AI-Game 当前不可用；历史 DSH 对话仍可读取。'),
            React.createElement('div', { className: 'weftmate-ai-game__muted' }, '执行 ID ' + pointer.executionId)),
          React.createElement('div', { className: 'weftmate-ai-game__actions' },
            React.createElement('button', { type: 'button', className: 'weftmate-ai-game__action', onClick: function () { setRetry(function (value) { return value + 1 }) } }, '重新检查连接')))
      }

      var factNodes = []
      ;[
        ['当前阶段', snap.currentStage || '阶段未知'],
        ['真实进度', '进度未知'],
        ['当前动作', snap.currentAction || '暂无可展示动作'],
      ].forEach(function (item, index) {
        factNodes.push(React.createElement('dt', { key: 'dt' + index }, item[0]))
        factNodes.push(React.createElement('dd', { key: 'dd' + index }, item[1]))
      })
      var evidence = snap.evidence.length === 0
        ? React.createElement('div', { className: 'weftmate-ai-game__muted' }, '尚无受保护证据引用')
        : React.createElement('ul', { className: 'weftmate-ai-game__list' }, snap.evidence.map(function (item) {
            return React.createElement('li', { key: item.evidenceId },
              React.createElement('span', null, item.contentType + ' · ' + aiGameBytes(item.sizeBytes)),
              React.createElement('span', { className: 'weftmate-ai-game__meta' }, '受保护引用；此面板不暴露本机路径'))
          }))
      var events = panel.events.length === 0
        ? React.createElement('div', { className: 'weftmate-ai-game__muted' }, '暂无新的阶段变化')
        : React.createElement('ul', { className: 'weftmate-ai-game__list' }, panel.events.map(function (item) {
            return React.createElement('li', { key: item.cursor },
              React.createElement('span', null, item.label),
              React.createElement('span', { className: 'weftmate-ai-game__meta' }, aiGameTime(item.createdAt)))
          }))
      var actions = []
      var versionHint = Number.isSafeInteger(snap.currentRevision) ? ' expected_revision=' + snap.currentRevision + '。' : '请先查看当前任务状态和版本。'
      var directControl = function (action) {
        fetch('/weftmate/ai-game/controls.json', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: props.sessionId, task_id: snap.taskId || snap.executionId, action: action, expected_revision: snap.currentRevision })
        }).then(function (r) { return r.json().then(function (v) { if (!r.ok) throw new Error(v.error && v.error.message || '操作失败'); return v }) })
          .then(function () { setRetry(function (v) { return v + 1 }) })
          .catch(function (error) { window.alert(error.message) })
      }
      if (snap.allowedIntents.pause) actions.push(React.createElement('button', {
        key: 'pause', type: 'button', className: 'weftmate-ai-game__action',
        onClick: function () { directControl('pause') },
      }, '暂停任务'))
      if (snap.allowedIntents.cancel) actions.push(React.createElement('button', {
        key: 'cancel', type: 'button', className: 'weftmate-ai-game__action',
        onClick: function () { directControl('cancel') },
      }, '取消任务'))
      if (snap.allowedIntents.resume) actions.push(React.createElement('button', {
        key: 'resume', type: 'button', className: 'weftmate-ai-game__action',
        onClick: function () { directControl('resume') },
      }, '继续任务'))
      if (snap.allowedIntents.answer && snap.pendingQuestion) actions.push(React.createElement('button', {
        key: 'answer', type: 'button', className: 'weftmate-ai-game__action',
        onClick: function () { fillComposer('关于执行 ' + snap.executionId + ' 的问题 ' + snap.pendingQuestion.questionId + '，我的回答是：') },
      }, '到输入区回答'))

      return React.createElement('div', { ref: rootRef, className: 'weftmate-ai-game', 'data-weftmate-ai-game-status': snap.status },
        React.createElement('div', { className: 'weftmate-ai-game__header' },
          React.createElement('div', null,
            React.createElement('div', { className: 'weftmate-ai-game__eyebrow' }, 'AI-Game execution'),
            React.createElement('div', { className: 'weftmate-ai-game__heading' }, '手机执行任务')),
          React.createElement('span', { className: 'weftmate-ai-game__badge', 'data-status': snap.status, role: 'status' }, AI_GAME_STATUSES[snap.status])),
        React.createElement('section', { className: 'weftmate-ai-game__section', 'aria-label': '执行目标' },
          React.createElement('div', { className: 'weftmate-ai-game__label' }, '目标'),
          React.createElement('div', { className: 'weftmate-ai-game__goal' }, snap.goalSummary),
          panel.historyCount > 1 ? React.createElement('div', { className: 'weftmate-ai-game__muted' }, '本会话另有 ' + (panel.historyCount - 1) + ' 个执行；可从中间对话的对应工具行打开。') : null),
        React.createElement('section', { className: 'weftmate-ai-game__section', 'aria-label': '执行状态' },
          React.createElement('dl', { className: 'weftmate-ai-game__facts' }, factNodes),
          React.createElement('div', { className: 'weftmate-ai-game__muted' }, snap.progress.explanation)),
        snap.pendingQuestion ? React.createElement('section', { className: 'weftmate-ai-game__question', 'aria-label': '待回答问题' },
          React.createElement('div', { className: 'weftmate-ai-game__label' }, '需要你的回答'),
          React.createElement('p', null, snap.pendingQuestion.question),
          snap.pendingQuestion.whyNeeded ? React.createElement('div', { className: 'weftmate-ai-game__muted' }, snap.pendingQuestion.whyNeeded) : null) : null,
        snap.resultSummary || snap.error ? React.createElement('section', { className: 'weftmate-ai-game__section', 'aria-label': snap.error ? '执行错误' : '执行结果' },
          React.createElement('div', { className: 'weftmate-ai-game__label' }, snap.error ? '错误' : '结果'),
          React.createElement('div', { className: 'weftmate-ai-game__goal' }, snap.error ? snap.error.code : snap.resultSummary)) : null,
        React.createElement('section', { className: 'weftmate-ai-game__section', 'aria-label': '最近证据' },
          React.createElement('div', { className: 'weftmate-ai-game__label' }, '最近证据'), evidence),
        React.createElement('section', { className: 'weftmate-ai-game__section', 'aria-label': '阶段变化' },
          React.createElement('div', { className: 'weftmate-ai-game__label' }, '阶段变化'), events),
        panel.eventsFailure ? React.createElement('div', { className: 'weftmate-ai-game__muted', role: 'status' }, '事件续接暂不可用；权威快照仍可读取。') : null,
        actions.length > 0 ? React.createElement('div', { className: 'weftmate-ai-game__actions', 'aria-label': '可用操作' }, actions) : null)
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

    // ── 记忆管理页（MemoWeft dsh_rpc v2：健康/浏览/搜索/导出）──
    var memoryPanelStyle = {
      position: 'absolute', top: '84px', right: '12px', width: '340px', maxHeight: '70vh',
      display: 'flex', flexDirection: 'column', gap: '10px',
      background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
      border: '1.5px solid var(--dsw-alias-brand-primary, var(--dsw-alias-border-l1))',
      borderRadius: '12px', padding: '14px', color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px', boxShadow: '0 8px 30px rgba(0, 0, 0, 0.45)', zIndex: 60, overflow: 'auto',
    }
    var sectionTitleStyle = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '6px' }
    var listItemStyle = { padding: '5px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)', display: 'flex', justifyContent: 'space-between', gap: '8px' }
    var pillStyle = { fontSize: '11px', color: 'var(--dsw-alias-brand-primary)' }

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

    // An enabled startup choice and a ready connection are separate facts.
    // Unknown/missing host fields never mean the user disabled a component.
    function memoryConnectionStatus(host, health) {
      var enabled = host && host.available === true && host.memoweft ? host.memoweft.enabled : undefined
      if (enabled === false) return { label: '本次未启用', ready: false, detail: '本次启动没有启用记忆接入；已有记忆是否存在不由此状态判断。' }
      if (enabled !== true) return { label: '状态未知', ready: false, detail: '尚未读到本次记忆接入选择。' }
      if (health && health.available === false) return { label: '已启用 · 连接不可用', ready: false, detail: '本次已启用记忆接入，但未能读取 MemoWeft 状态。' }
      if (health && health.ready === true) return { label: '已就绪', ready: true, detail: '本次已启用，MemoWeft 连接已就绪。' }
      if (health && health.available === true && health.ready === false) return { label: '已启用 · 尚未就绪', ready: false, detail: '本次已启用记忆接入，MemoWeft 尚未报告就绪。' }
      return { label: '已启用 · 状态未知', ready: false, detail: '本次已启用记忆接入，连接状态尚未确认。' }
    }

    function deriveMemoryUiSummary(host, health, world, jobs, phase) {
      var enabled = host && host.memoweft ? host.memoweft.enabled : undefined
      var cognitions = world && Array.isArray(world.cognitions) ? world.cognitions : []
      var rows = jobs && Array.isArray(jobs.jobs) ? jobs.jobs : []
      var processing = rows.filter(function (job) { return job && job.worker && job.worker.state === 'processing' }).length
      var pending = rows.filter(function (job) { return job && job.worker && ['pending', 'retry'].indexOf(job.worker.state) >= 0 }).length
      if (phase === 'loading') return { state: 'connecting', label: '连接中', detail: '正在读取记忆服务状态。', ready: false, count: null, pending: 0 }
      if (enabled === false) return { state: 'setup', label: '待配置', detail: '本次启动尚未启用记忆接入。', ready: false, count: null, pending: 0 }
      if (phase === 'error' || enabled !== true || (health && health.available === false)) return { state: 'error', label: '不可用', detail: '暂时无法读取记忆服务状态。', ready: false, count: null, pending: 0 }
      if (!health || health.ready !== true) return { state: 'connecting', label: '连接中', detail: '记忆接入已启用，正在等待服务就绪。', ready: false, count: null, pending: 0 }
      if (processing || pending) return { state: 'pending', label: '整理中', detail: processing ? ('正在整理 ' + processing + ' 项原话。') : ('有 ' + pending + ' 项原话等待整理。'), ready: true, count: cognitions.length, pending: processing + pending }
      return { state: 'ready', label: '已连接', detail: cognitions.length ? ('当前理解 ' + cognitions.length + ' 条。') : '当前暂无长期理解。', ready: true, count: cognitions.length, pending: 0 }
    }

    function phoneRuntimeStatus(host) {
      var runtime = host && host.available === true && host.aiGame
      var labels = { not_installed: '未安装', verifying: '正在校验', starting: '启动中', ready: '服务就绪', needs_setup: '需要配置', recovering: '恢复中', unavailable: '不可用', stopping: '正在停止', stopped: '已停止' }
      var label = runtime && labels[runtime.state]
      if (!label) return { label: '状态未知', ready: false, detail: '尚未读到手机组件的实际运行状态。' }
      var detail = runtime.state === 'ready'
        ? '手机服务已就绪；设备连接、授权与任务执行仍需单独确认。'
        : runtime.state === 'not_installed' ? '本机尚未安装可用的手机运行组件。'
          : runtime.state === 'needs_setup' ? '手机运行组件需要配置，当前不能据此判断设备可执行。'
            : '显示本次实际运行状态，服务状态不代表设备任务结果。'
      return { label: label, ready: runtime.state === 'ready', detail: detail }
    }

    function PhoneDeviceSetup() {
      var statePair = React.useState({})
      var state = statePair[0], setState = statePair[1]
      var candidatesPair = React.useState(null)
      var candidates = candidatesPair[0], setCandidates = candidatesPair[1]
      var busyPair = React.useState(false)
      var busy = busyPair[0], setBusy = busyPair[1]
      var errorPair = React.useState('')
      var error = errorPair[0], setError = errorPair[1]
      var operations = React.useRef({})
      function refresh() { return fetchAvailableJson('/weftmate/ai-game/devices.json', setState) }
      React.useEffect(function () {
        refresh()
        var timer = setInterval(refresh, 10000)
        return function () { clearInterval(timer) }
      }, [])
      async function discover() {
        setBusy(true); setError('')
        var result = await fetchAvailableJson('/weftmate/ai-game/devices/discovery.json', setCandidates)
        if (!result.available) setError('设备发现暂不可用，请确认手机服务状态后重试。')
        setBusy(false)
      }
      async function selectDevice(item, existing) {
        setBusy(true); setError('')
        var id = existing ? item.device_profile_id : item.candidate_id
        if (!operations.current[id]) operations.current[id] = 'phone-profile-' + crypto.randomUUID()
        var payload = { idempotency_key: operations.current[id], display_name: item.display_name }
        payload[existing ? 'profile_id' : 'candidate_id'] = id
        try {
          var response = await fetch('/weftmate/ai-game/devices/select.json', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000),
          })
          if (!response.ok) throw new Error('device save failed')
          await refresh()
          setCandidates(null)
        } catch (_) { setError('尚未确认设备保存结果，请刷新设备清单后重试；发现结果过期时请重新发现。') }
        setBusy(false)
      }
      var connectionLabels = { connected: '已连接', disconnected: '未连接', unknown: '状态未知' }
      var profileLabels = { drifted: '设备身份需要重新确认', disabled: '配置已停用' }
      var items = state.available && Array.isArray(state.items) ? state.items : null
      return React.createElement('section', { 'aria-label': '手机测试设备', style: Object.assign({}, sectionBlockStyle, { padding: '14px 16px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '14px' }) },
        React.createElement('div', { style: sectionBlockTitleStyle }, '手机测试设备'),
        React.createElement('div', { style: sectionHintStyle }, '先启动选定的Android模拟器，再发现并设为默认设备。选择设备后，通过对话发起手机任务。'),
        items === null ? React.createElement('div', { role: 'status', style: sectionHintStyle }, '尚未读到设备清单。')
          : items.length === 0 ? React.createElement('div', { role: 'status', style: sectionHintStyle }, '尚未配置默认测试设备。')
            : items.map(function (item) { return React.createElement(Row, { key: item.device_profile_id, label: item.display_name,
                hint: '当前连接：' + (connectionLabels[item.connection_state] || '状态未知')
                  + ' · 默认设备：' + (item.is_default ? '是' : '否')
                  + (profileLabels[item.state] ? ' · ' + profileLabels[item.state] : ''),
                control: item.is_default ? null : React.createElement('button', { style: sectionSmallBtnStyle, disabled: busy, onClick: function () { selectDevice(item, true) } }, '设为默认'),
              }) }),
        React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
          React.createElement('button', { style: sectionSmallBtnStyle, disabled: busy, onClick: discover }, busy ? '处理中…' : '发现设备'),
          React.createElement('button', { style: sectionSmallBtnStyle, disabled: busy, onClick: refresh }, '刷新清单')),
        candidates && candidates.available && Array.isArray(candidates.items)
          ? candidates.items.length === 0 ? React.createElement('div', { role: 'status', style: sectionHintStyle }, items && items.length > 0
              ? '没有发现新设备，已保存设备及连接状态见上方。'
              : '尚未发现可用模拟器，请先启动选定的测试设备。')
            : candidates.items.map(function (item) { return React.createElement(Row, { key: item.candidate_id, label: item.display_name,
                hint: '当前发现：' + (connectionLabels[item.connection_state] || '已连接') + ' · 尚未保存',
                control: React.createElement('button', { style: sectionSmallBtnStyle, disabled: busy, onClick: function () { selectDevice(item, false) } }, '使用这台设备'),
              }) }) : null,
        error ? React.createElement('div', { role: 'status', style: sectionHintStyle }, error) : null)
    }

    function MemoryPanel(props) {
      var searchState = React.useState('')
      var query = searchState[0]
      var setQuery = searchState[1]
      var resultState = React.useState(null)
      var result = resultState[0]
      var setResult = resultState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]

      var actionState = React.useState(null)
      var actionFeedback = actionState[0]
      var setActionFeedback = actionState[1]

      var world = props.world || {}
      var health = props.health || {}
      var cognitions = world.cognitions || []
      var entities = world.entities || []
      var relationships = world.relationships || []
      var events = world.events || []
      var worldAvailable = world.available === true && Array.isArray(world.cognitions)
        && Array.isArray(world.entities) && Array.isArray(world.relationships) && Array.isArray(world.events)

      // A disabled bridge may have no routes at all. A failed health request
      // proves unavailability, not an empty memory store or an active retry.
      if (!props.connection || props.connection.ready !== true) {
        return React.createElement('div', { style: memoryPanelStyle },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            React.createElement('span', { style: brandStyle }, '记忆管理'),
            React.createElement('button', { style: installBtnStyle, onClick: props.onClose }, '关闭'),
          ),
          React.createElement('p', { role: 'status', style: dimStyle }, props.connection ? props.connection.detail : 'MemoWeft 状态未知。'),
        )
      }

      var doSearch = function () {
        if (!query.trim() || busy) return
        setBusy(true)
        fetch('/weftmate/memory/search.json?q=' + encodeURIComponent(query.trim()))
          .then(function (r) { return r.ok ? r.json() : null })
          .then(function (data) { setResult(data); setBusy(false) })
          .catch(function () { setBusy(false) })
      }

      var doExport = function () {
        fetch('/weftmate/memory/export.json', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null })
          .then(function (data) {
            if (!data) return
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            var url = URL.createObjectURL(blob)
            var a = document.createElement('a')
            a.href = url
            a.download = 'weftmate-memory-export.json'
            a.click()
            URL.revokeObjectURL(url)
          })
          .catch(function () { /* 导出失败静默 */ })
      }

      var rows = []
      var groups = [
        { kind: 'cognition', label: '当前理解', items: cognitions },
        { kind: 'entity', label: '相关人物与事物', items: entities },
        { kind: 'relationship', label: '关系', items: relationships },
        { kind: 'event', label: '事件', items: events },
      ]
      groups.forEach(function (group) {
        if (!group.items.length) return
        rows.push(React.createElement('div', { key: group.kind + '-title', style: sectionTitleStyle }, group.label + ' · ' + group.items.length))
        group.items.forEach(function (item) {
          rows.push(React.createElement(MemoryItem, {
            key: group.kind + ':' + item.id, kind: group.kind, item: item,
            revision: world.world_revision,
            subjectId: health.runtime && health.runtime.subject_id,
            onResult: function (message) { setActionFeedback(message); if (props.onRefresh) props.onRefresh() },
          }))
        })
      })
      if (!rows.length) rows.push(React.createElement('p', { key: 'none', style: dimStyle }, '当前没有可使用的理解。原始来源和处理进度可以在下方查看。'))

      var searchBlock = [
        React.createElement('div', { key: 's-title', style: sectionTitleStyle }, '确定性搜索（0 生成调用）'),
        React.createElement('div', { key: 's-row', style: { display: 'flex', gap: '8px' } },
          React.createElement('input', {
            key: 's-input', value: query, style: { flex: 1, background: 'transparent', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', padding: '6px 8px', color: 'inherit' },
            onChange: function (e) { setQuery(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') doSearch() },
            placeholder: '问点什么（如：我喜欢喝什么）',
          }),
          React.createElement('button', { key: 's-btn', style: installBtnStyle, onClick: doSearch }, busy ? '…' : '搜索'),
        ),
      ]
      if (result !== null) {
        var hit = result && typeof result.text === 'string' && result.text.trim()
        searchBlock.push(React.createElement('div', {
          key: 's-result', style: { padding: '8px', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-1)', whiteSpace: 'pre-wrap' },
        }, hit ? result.text : (result && result.count === 0 ? '没有命中的记忆（诚实回答：未找到）' : '查询失败')))
      }

      return React.createElement(
        'div', { style: memoryPanelStyle },
        React.createElement('div', { key: 'h', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('span', { key: 't', style: brandStyle }, '记忆管理'),
          React.createElement('span', { key: 'sub', style: dimStyle }, '本机 · MemoWeft 2.0 · RPC v' + (health.protocolVersion || '?')),
          React.createElement('button', { key: 'x', style: installBtnStyle, onClick: props.onClose }, '×'),
        ),
        actionFeedback ? React.createElement('p', { key: 'feedback', role: 'status', style: { whiteSpace: 'pre-wrap' } }, actionFeedback) : null,
        React.createElement('div', { key: 'list' }, worldAvailable ? rows
          : React.createElement('p', { role: 'status', style: dimStyle }, '记忆内容未读取，当前数量未知。')),
        React.createElement(MemoryAdoptions, { key: 'adoptions' }),
        React.createElement(MemoryInteractions, { key: 'interactions' }),
        React.createElement('details', { key: 'processing' },
          React.createElement('summary', { style: { cursor: 'pointer' } }, '查看原话与处理进度'),
          React.createElement(MemoryProcessing, { health: health }),
        ),
        searchBlock,
        React.createElement('div', { key: 'f', style: { display: 'flex', gap: '8px' } },
          React.createElement('button', { key: 'export', style: installBtnStyle, onClick: doExport }, '导出备份'),
          React.createElement('span', { key: 'note', style: dimStyle }, 'Evidence 与 provenance 一并导出'),
        ),
      )
    }

    function memoryCommandFeedback(data, operation) {
      var receipt = data && data.receipt
      if (!receipt) return { ok: false, text: '没有收到处理回执，结果尚未确认。可以重试同一操作。', uncertain: true }
      if (receipt.result_state === 'revision_conflict') return { ok: false, text: '记忆已发生变化，已刷新列表；请核对后重新操作。' }
      if (receipt.accepted !== true || ['applied', 'no_change'].indexOf(receipt.result_state) === -1) return { ok: false, text: '这次修改未生效，已刷新列表，请核对当前记录。' }
      if (operation === 'mute_world_item') return { ok: true, text: '已设为不再使用：后续记忆召回会排除这条理解。原始记录和操作痕迹保留，并未永久删除。' }
      if (operation === 'retract_world_item') return { ok: true, text: '已撤回这条错误理解，原始来源与撤回记录保留。' }
      return { ok: true, text: '纠正已生效，旧理解已被替代；原始来源与纠正记录保留。' }
    }

    function MemoryItem(props) {
      var detailState = React.useState(null)
      var detail = detailState[0]
      var setDetail = detailState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var editState = React.useState(false)
      var editing = editState[0]
      var setEditing = editState[1]
      var textState = React.useState(String(props.item.content || ''))
      var correction = textState[0]
      var setCorrection = textState[1]
      var request = React.useRef(null)
      var label = String(props.item.content || props.item.canonical_name || '')
      var canCorrect = ['cognition', 'relationship', 'event'].indexOf(props.kind) !== -1
      var loadDetail = function () {
        fetchAvailableJson('/weftmate/memory/provenance.json?object_kind=' + encodeURIComponent(props.kind) + '&item_id=' + encodeURIComponent(props.item.id), setDetail)
      }
      var apply = async function (operation) {
        if (busy) return
        if (!props.subjectId || !Number.isInteger(props.revision)) { props.onResult('记忆状态尚未读取，请稍后重试。'); return }
        if (operation === 'correct_world_item' && !correction.trim()) return
        var payload = operation === 'correct_world_item' ? { correction_text: correction.trim(), allow_cloud_read: false } : {}
        var signature = JSON.stringify([operation, props.kind, props.item.id, payload])
        if (!request.current || request.current.signature !== signature) {
          request.current = { signature: signature, command: {
            schema_version: 1, command_id: crypto.randomUUID(), subject_id: props.subjectId,
            actor: 'weftmate-ui', expected_world_revision: props.revision,
            operation: operation, target_kind: props.kind, target_id: props.item.id,
            payload: payload, submitted_at: new Date().toISOString(),
          } }
        }
        setBusy(true)
        props.onResult('正在提交修改，尚未确认生效…')
        try {
          var response = await fetch('/weftmate/memory/command.json', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ command: request.current.command }), signal: AbortSignal.timeout(10000),
          })
          if (!response.ok) throw new Error('request_failed')
          var result = memoryCommandFeedback(await response.json(), operation)
          if (!result.uncertain) request.current = null
          props.onResult(result.text)
          if (result.ok) setEditing(false)
          loadDetail()
        } catch {
          // Keep the same command identity after an uncertain transport result.
          props.onResult('请求失败或超时，结果尚未确认。请核对刷新后的记录；重试会沿用同一次操作，避免重复修改。')
        } finally { setBusy(false) }
      }
      var sources = detail && detail.available === true && Array.isArray(detail.provenance) ? detail.provenance : null
      return React.createElement('article', { 'aria-label': '记忆：' + label, style: { padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
        React.createElement('p', { style: { margin: '0 0 6px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, label),
        React.createElement('details', { onToggle: function (event) { if (event.currentTarget.open) loadDetail() } },
          React.createElement('summary', { style: { cursor: 'pointer', color: 'var(--dsw-alias-state-business-primary)' } }, '依据与调整'),
          sources === null ? React.createElement('p', { role: 'status', style: dimStyle }, detail ? '依据读取失败，可收起后重新展开。' : '正在读取依据…')
            : sources.length === 0 ? React.createElement('p', { style: dimStyle }, '当前没有可展示的原始依据，不凭空补充。')
              : sources.map(function (source) {
                var evidence = source.evidence
                var readable = evidence && evidence.content_available === true
                return React.createElement('div', { key: source.evidence_id, style: { padding: '6px 0' } },
                  React.createElement('div', { style: dimStyle }, evidence && evidence.source_kind === 'spoken' ? '本人原话' : '有记录的来源'),
                  React.createElement('p', { style: { margin: '4px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, readable ? evidence.raw_content : '这条依据目前不可读取'),
                  evidence && evidence.occurred_at ? React.createElement('div', { style: dimStyle }, new Date(evidence.occurred_at).toLocaleString()) : null,
                )
              }),
          detail && Array.isArray(detail.transition_history) && detail.transition_history.length > 0
            ? React.createElement('p', { style: dimStyle }, '此理解保留了 ' + detail.transition_history.length + ' 条变更记录。') : null,
          canCorrect ? React.createElement('button', { style: sectionSmallBtnStyle, disabled: busy, onClick: function () { setEditing(!editing) } }, editing ? '收起纠正' : '纠正说法') : null,
          editing ? React.createElement('div', { style: { marginTop: '8px' } },
            React.createElement('p', { style: dimStyle }, '写出正确的完整说法。若这条理解根本不成立，可以直接撤回。'),
            React.createElement('textarea', { 'aria-label': '正确的说法', value: correction, maxLength: 4000, rows: 3,
              style: { width: '100%', boxSizing: 'border-box', padding: '8px', background: 'transparent', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px' },
              onChange: function (event) { setCorrection(event.target.value) } }),
            React.createElement('button', { style: sectionSmallBtnStyle, disabled: busy || !correction.trim() || correction.trim() === label.trim(), onClick: function () { apply('correct_world_item') } }, busy ? '提交中…' : '保存纠正'),
            React.createElement('button', { style: sectionSmallBtnStyle, disabled: busy, onClick: function () { apply('retract_world_item') } }, '撤回这条理解'),
          ) : null,
          React.createElement('div', { style: { marginTop: '8px' } },
            React.createElement('button', { style: sectionSmallBtnStyle, disabled: busy, onClick: function () { apply('mute_world_item') } }, '不再使用'),
            React.createElement('p', { style: dimStyle }, '从后续记忆召回中排除；保留原始记录与导出中的状态，不是永久删除。'),
          ),
        ),
      )
    }

    function MemoryAdoptions() {
      var state = React.useState(null)
      var data = state[0]
      var setData = state[1]
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      React.useEffect(function () {
        if (!open) return
        var active = true
        function refresh() { fetchAvailableJson('/weftmate/memory/adoptions.json', function (next) { if (active) setData(next) }) }
        refresh()
        var timer = setInterval(refresh, 5000)
        return function () { active = false; clearInterval(timer) }
      }, [open])
      var entries = data && data.available === true && Array.isArray(data.adoptions) ? data.adoptions : null
      return React.createElement('details', { onToggle: function (event) { setOpen(event.currentTarget.open) } },
        React.createElement('summary', { style: { cursor: 'pointer' } }, '记忆上下文记录'),
        React.createElement('p', { style: dimStyle }, '记录哪些理解加入了会话上下文；不代表模型一定采纳，也不把搜索算成一次使用。'),
        entries === null ? React.createElement('p', { role: 'status', style: dimStyle }, data ? '记录读取失败，将自动重试。' : '正在读取…')
          : entries.length === 0 ? React.createElement('p', { style: dimStyle }, '尚无记忆上下文记录。')
            : entries.slice(-10).reverse().map(function (entry, index) {
              return React.createElement('details', { key: index, style: { margin: '6px 0' } },
                React.createElement('summary', { style: { cursor: 'pointer' } }, new Date(entry.adopted_at).toLocaleString() + ' · ' + entry.selected_item_ids.length + ' 条理解' + (Array.isArray(entry.interaction_ids) && entry.interaction_ids.length ? ' · ' + entry.interaction_ids.length + ' 段讨论' : '')),
                React.createElement('p', { style: { overflowWrap: 'anywhere' } }, '会话：' + entry.session_id),
                React.createElement('p', { style: dimStyle }, '记忆版本：' + entry.world_revision),
                entry.selected_item_ids.map(function (pair) { return React.createElement(MemoryRecordedSource, { key: pair.join(':'), kind: pair[0], id: pair[1] }) }),
                (entry.interaction_ids || []).map(function (id) { return React.createElement(MemoryRecordedInteraction, { key: id, id: id }) }),
              )
            }),
      )
    }

    function MemoryRecordedSource(props) {
      var state = React.useState(null)
      var data = state[0]
      var setData = state[1]
      return React.createElement('div', { style: { margin: '6px 0' } },
        React.createElement('button', { style: sectionSmallBtnStyle, onClick: function () { fetchAvailableJson('/weftmate/memory/provenance.json?object_kind=' + encodeURIComponent(props.kind) + '&item_id=' + encodeURIComponent(props.id), setData) } }, '查看这条依据'),
        data && data.available === false ? React.createElement('p', { role: 'status' }, '依据读取失败。') : null,
        data && Array.isArray(data.provenance) ? data.provenance.map(function (source) {
          return React.createElement('p', { key: source.evidence_id, style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, source.evidence && source.evidence.content_available === true ? source.evidence.raw_content : '这条依据目前不可读取')
        }) : null,
      )
    }

    function InteractionExcerpt(props) {
      var item = props.item
      if (!item || !Array.isArray(item.turns)) return React.createElement('p', { role: 'status', style: dimStyle }, '这段讨论当前不可读取。')
      var dependencyNote = ['stale', 'missing', 'cycle', 'depth_limit', 'node_limit', 'invalid'].indexOf(item.dependency_state) >= 0
        ? '关联记忆已失效；这里只保留历史原文，不再自动召回。'
        : ['legacy_unknown', 'unavailable', 'withheld'].indexOf(item.dependency_state) >= 0
          ? '来源状态未知；这里只保留历史原文，不会自动召回。' : null
      return React.createElement('article', { 'aria-label': '共同讨论片段', style: { margin: '8px 0', padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
        React.createElement('div', { style: dimStyle }, '记录于 ' + new Date(item.created_at).toLocaleString()),
        dependencyNote ? React.createElement('p', { role: 'status', style: dimStyle }, dependencyNote) : null,
        item.turns.map(function (turn, index) {
          var label = turn.role === 'user' ? '你当时说' : turn.role === 'assistant' ? 'AI 当时说' : turn.role === 'tool' ? '工具记录' : '其他来源'
          return React.createElement('div', { key: turn.message_id || index, style: { margin: '8px 0' } },
            React.createElement('div', { style: { fontWeight: 600 } }, label),
            React.createElement('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, turn.content),
          )
        }),
        React.createElement('details', null,
          React.createElement('summary', { style: { cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' } }, '来源信息'),
          React.createElement('p', { style: { overflowWrap: 'anywhere' } }, '原会话：' + item.conversation_id),
          React.createElement('p', { style: { overflowWrap: 'anywhere' } }, '讨论记录：' + item.id),
        ),
      )
    }

    function MemoryInteractions() {
      var queryState = React.useState('')
      var query = queryState[0]
      var setQuery = queryState[1]
      var resultState = React.useState(null)
      var result = resultState[0]
      var setResult = resultState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var requestRef = React.useRef({ generation: 0, controller: null })
      React.useEffect(function () { return function () { requestRef.current.generation += 1; if (requestRef.current.controller) requestRef.current.controller.abort() } }, [])
      var search = async function () {
        if (busy || !query.trim()) return
        var requestedQuery = query.trim()
        var generation = requestRef.current.generation + 1
        requestRef.current.generation = generation
        if (requestRef.current.controller) requestRef.current.controller.abort()
        var controller = new AbortController()
        requestRef.current.controller = controller
        setBusy(true)
        setResult(null)
        try {
          var response = await fetch('/weftmate/memory/interactions.json?q=' + encodeURIComponent(requestedQuery), { cache: 'no-store', signal: controller.signal })
          if (!response.ok) throw new Error('INTERACTION_SEARCH_HTTP_' + response.status)
          var data = await response.json()
          if (requestRef.current.generation === generation && query.trim() === requestedQuery) setResult(Object.assign({}, data, { available: true }))
        } catch (error) {
          if (error && error.name !== 'AbortError' && requestRef.current.generation === generation && query.trim() === requestedQuery) setResult({ ready: false, available: false })
        } finally {
          if (requestRef.current.generation === generation) { requestRef.current.controller = null; setBusy(false) }
        }
      }
      return React.createElement('details', null,
        React.createElement('summary', { style: { cursor: 'pointer' } }, '回顾共同讨论'),
        React.createElement('p', { style: dimStyle }, '按原话关键词查找以前的建议和回应；也可以输入较长的回顾问句。这里不是语义搜索，历史建议不代表你已经同意实施。'),
        React.createElement('div', { style: { display: 'flex', gap: '6px' } },
          React.createElement('input', { 'aria-label': '查找以前的讨论', value: query, placeholder: '例如：上次健康数据的方案',
            style: { flex: 1, minWidth: 0, padding: '7px', background: 'transparent', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px' },
            onChange: function (event) { requestRef.current.generation += 1; if (requestRef.current.controller) requestRef.current.controller.abort(); requestRef.current.controller = null; setQuery(event.target.value); setResult(null); setBusy(false) }, onKeyDown: function (event) { if (event.key === 'Enter') search() } }),
          React.createElement('button', { style: sectionSmallBtnStyle, disabled: busy || !query.trim(), onClick: search }, busy ? '查找中…' : '查找讨论'),
        ),
        result === null ? null : result.available !== true || !Array.isArray(result.items)
          ? React.createElement('p', { role: 'status', style: dimStyle }, '讨论读取失败，尚不能判断是否记得，请重试。')
          : result.items.length === 0 ? React.createElement('p', { role: 'status', style: dimStyle }, '没有找到相关的共同讨论。')
            : result.items.map(function (item) { return React.createElement(InteractionExcerpt, { key: item.id, item: item }) }),
      )
    }

    function MemoryRecordedInteraction(props) {
      var state = React.useState(null)
      var data = state[0]
      var setData = state[1]
      return React.createElement('div', { style: { margin: '6px 0' } },
        React.createElement('button', { style: sectionSmallBtnStyle, onClick: function () { fetchAvailableJson('/weftmate/memory/interactions.json?id=' + encodeURIComponent(props.id), setData) } }, '查看这段讨论'),
        data === null ? null : data.available !== true || !data.item
          ? React.createElement('p', { role: 'status', style: dimStyle }, '这段讨论不可用或读取失败。')
          : React.createElement(InteractionExcerpt, { item: data.item }),
      )
    }

    function memoryJobStatus(job) {
      var terminal = job && job.core_terminal && job.core_terminal.terminal_state
      var state = job && job.worker && job.worker.state
      if (terminal === 'applied' || state === 'applied') return '理解已形成'
      if (terminal === 'clarification_required') return '需要补充说明'
      if (terminal === 'out_of_scope') return '本条未形成长期理解'
      if (terminal === 'no_change' || state === 'no_change') return '已处理 · 无需新增理解'
      if (terminal === 'failed' || state === 'dead') return '处理失败 · 原话保留'
      if (state === 'processing') return '正在处理'
      if (state === 'retry') return '等待重试 · 原话保留'
      if (state === 'pending') return '等待处理'
      return '处理状态未确认'
    }

    function MemoryProcessing(props) {
      var evidenceState = React.useState(null)
      var evidence = evidenceState[0]
      var setEvidence = evidenceState[1]
      var jobsState = React.useState(null)
      var jobs = jobsState[0]
      var setJobs = jobsState[1]
      React.useEffect(function () {
        var active = true
        function refresh() {
          fetchAvailableJson('/weftmate/memory/evidence.json', function (next) { if (active) setEvidence(next) })
          fetchAvailableJson('/weftmate/memory/jobs.json', function (next) { if (active) setJobs(next) })
        }
        refresh()
        var timer = setInterval(refresh, 3000)
        return function () { active = false; clearInterval(timer) }
      }, [])

      var parts = [React.createElement('div', { key: 'title', style: sectionTitleStyle }, '聊天来源与处理')]
      var route = props.health && props.health.runtime
      if (route && route.route_ready === false) {
        parts.push(React.createElement('p', { key: 'route', role: 'status', style: dimStyle }, '记忆模型尚未就绪，原话与待处理任务会保留；请检查本地模型和记忆配置。'))
      }
      var handoff = jobs && jobs.handoff
      if (handoff && (handoff.pending > 0 || handoff.error)) {
        parts.push(React.createElement('p', { key: 'handoff', role: 'status', style: dimStyle }, handoff.error
          ? '聊天交接暂未完成，待交接 ' + handoff.pending + ' 条。请保留当前数据，恢复连接后会重试。'
          : '待交接 ' + handoff.pending + ' 条，尚未确认保存到记忆库。'))
      }
      if (evidence === null || jobs === null) {
        parts.push(React.createElement('p', { key: 'loading', role: 'status', style: dimStyle }, '正在读取来源与处理状态…'))
      } else if (evidence.available !== true || !Array.isArray(evidence.evidence)
        || jobs.available !== true || !Array.isArray(jobs.jobs)) {
        parts.push(React.createElement('p', { key: 'error', role: 'status', style: dimStyle }, '来源或处理状态读取失败，将自动重试；当前数量未知。'))
      } else if (evidence.evidence.length === 0) {
        parts.push(React.createElement('p', { key: 'empty', style: dimStyle }, '本候选尚无已保存的聊天来源。普通聊天完成后会自动交接，无需等到对话压缩。'))
      } else {
        parts.push(React.createElement('p', { key: 'note', style: dimStyle }, '这里显示原话及长期理解的处理结果。“无需新增理解”不等于讨论没保存；用户与AI的对话可在“回顾共同讨论”中核对。纠正和停用仍以当前状态为准。'))
        evidence.evidence.slice(-30).reverse().forEach(function (item) {
          var related = jobs.jobs.filter(function (job) {
            return job.acceptance && Array.isArray(job.acceptance.evidence_ids) && job.acceptance.evidence_ids.indexOf(item.evidence_id) !== -1
          })
          var job = related[related.length - 1]
          var kind = item.source_kind === 'spoken' ? '本人聊天原话' : '来源类型：' + (item.source_kind || '未确认')
          var stamp = item.occurred_at ? new Date(item.occurred_at).toLocaleString() : '时间未确认'
          parts.push(React.createElement('article', { key: item.evidence_id, style: { padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } },
              React.createElement('span', null, '原话已保存'),
              React.createElement('span', { role: 'status', style: pillStyle }, memoryJobStatus(job)),
            ),
            job && job.worker && job.worker.state === 'retry' && job.worker.next_attempt_at
              ? React.createElement('p', { style: dimStyle }, '预计 ' + new Date(job.worker.next_attempt_at).toLocaleTimeString() + ' 再次处理。') : null,
            React.createElement('p', { style: { margin: '6px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, item.content_available === true ? item.raw_content : '此来源当前不可读取'),
            React.createElement('details', null,
              React.createElement('summary', { style: { cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' } }, '查看来源'),
              React.createElement('p', { style: { margin: '6px 0', overflowWrap: 'anywhere' } }, kind + ' · ' + stamp),
              React.createElement('p', { style: { margin: '6px 0', overflowWrap: 'anywhere' } }, '来源记录：' + (item.origin_id || item.evidence_id)),
            ),
          ))
        })
      }
      return React.createElement('section', { 'aria-label': '聊天来源与处理' }, parts)
    }

    // ── R6/R8 设置节 · 官方设置页「WeftMate」节（感知/桌宠/设备配对；胶囊已删，控制面唯一）──
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
      var healthState = React.useState({})
      var health = healthState[0]
      var setHealth = healthState[1]
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
          fetchAvailableJson('/weftmate/memory/health.json', setHealth)
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
      var memory = memoryConnectionStatus(status, health)
      var phone = phoneRuntimeStatus(status)

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
        React.createElement('section', { key: 'plugins', 'aria-label': '记忆与插件', style: Object.assign({}, sectionBlockStyle, { padding: '14px 16px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '14px', background: 'var(--dsw-specific-input-major)' }) },
          React.createElement('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '4px' } }, '记忆与插件'),
          React.createElement('div', { style: sectionHintStyle }, 'WeftMate 统一入口 · MemoWeft 共享长期理解 · WeftMod 可选能力。以下显示本次实际状态。'),
          React.createElement(Row, {
            label: 'MemoWeft · 长期理解',
            hint: memory.detail,
            control: React.createElement('span', { role: 'status', style: Object.assign({}, sectionHintStyle, { color: memory.ready ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)' }) }, memory.label),
          }),
          React.createElement(Row, {
            label: 'WeftMod · 手机',
            hint: phone.detail,
            control: React.createElement('span', { role: 'status', style: Object.assign({}, sectionHintStyle, { color: phone.ready ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)' }) }, phone.label),
          }),
          React.createElement(Row, {
            label: '桌宠 · 可选表现',
            hint: '显示与自由活动沿用现有桌宠设置，下方可调整。',
            control: React.createElement('span', { role: 'status', style: sectionHintStyle }, pet && typeof pet.visible === 'boolean' ? (pet.visible ? '窗口已显示' : '窗口未显示') : '状态未知'),
          }),
          React.createElement('div', { style: Object.assign({}, sectionHintStyle, { marginTop: '9px' }) }, '手机任务按下方选择的默认设备执行，过程和控制入口显示在任务详情中。'),
        ),
        React.createElement(PhoneDeviceSetup, { key: 'phone-device-setup' }),
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

    function modError(error) { return error && error.message ? error.message : String(error || '请求失败') }
    function modStatus(value, update) {
      var labels = { running: '运行中', starting: '正在启动', stopped: '已停止', stopping: '正在停止', idle: '空闲', healthy: '正常', selected: '已选择', failed: '失败', 'needs-review': '需要检查', interrupted: '已中断', completed: '已完成', pending: '等待处理', ready: '正在完成更新' }
      if (value === 'ready') return update && update.requirementId ? '等待专属对话处理' : '可以在专属对话提出修改'
      return labels[value] || value || '未知'
    }
    function shortModId(value) { value = String(value || '无'); return value.length > 18 ? value.slice(0, 8) + '…' + value.slice(-6) : value }

    function modRequest(sessionId, action, data) {
      if (typeof sessionId !== 'string' || !sessionId) return Promise.reject(new Error('请先创建或打开一个正式会话，再管理 Mods。'))
      var body = Object.assign({ session_id: sessionId, action: action }, data || {})
      var encoded = JSON.stringify(body)
      if (new TextEncoder().encode(encoded).byteLength > 64 * 1024) return Promise.reject(new Error('Mod 请求超过 64 KiB 限制。'))
      return fetch('/weftmate/mods/request', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: encoded })
        .then(function (response) { return response.json().catch(function () { return {} }).then(function (value) { if (!response.ok || value.ok === false) throw new Error(typeof value.error === 'string' ? value.error : (value.error && value.error.message || value.message || ('MODS_HTTP_' + response.status))); return value }) })
    }

    function ModBusinessFrame(props) {
      var frameRef = React.useRef(null)
      var bridgeRef = React.useRef(null)
      var loaded = React.useState(null), loadedIdentity = loaded[0], setLoadedIdentity = loaded[1]
      var loadedModule = React.useState(null), bridgeLoad = loadedModule[0], setBridgeLoad = loadedModule[1]
      var handshakeState = React.useState(false), handshaken = handshakeState[0], setHandshaken = handshakeState[1]
      var handshakeRef = React.useRef(false)
      var handshakeTimerRef = React.useRef(null)
      var loadTimerRef = React.useRef(null)
      var frameErrorState = React.useState(''), frameError = frameErrorState[0], setFrameError = frameErrorState[1]
      var retryState = React.useState(0), retryKey = retryState[0], setRetryKey = retryState[1]
      var stable = React.useState(null), stableFrame = stable[0], setStableFrame = stable[1]
      var bridgeModule = bridgeLoad && bridgeLoad.module
      var candidateUi = props.detail && props.detail.ui
      var currentRun = props.detail && props.detail.run || {}
      var runId = currentRun.runId || currentRun.run_id || 'none'
      var runPhase = currentRun.status || 'none'
      var desiredPhase = props.detail && props.detail.project && (props.detail.project.desiredState || props.detail.project.desired_state) || 'none'
      var versionKey = [String(props.projectId || ''), String(props.versionId || ''), candidateUi && candidateUi.frameToken || '', retryKey].join(':')
      React.useEffect(function () {
        if (!candidateUi || typeof candidateUi.assetUrl !== 'string' || typeof candidateUi.frameToken !== 'string') return
        setStableFrame(function (old) { return old && old.versionKey === versionKey ? old : { versionKey: versionKey, ui: candidateUi } })
      }, [versionKey, candidateUi && candidateUi.assetUrl, candidateUi && candidateUi.frameToken])
      var ui = stableFrame && stableFrame.ui
      var frameIdentity = stableFrame && stableFrame.versionKey
      React.useEffect(function () { var alive = true; modFrameBridgePromise.then(function (result) { if (alive) setBridgeLoad(result) }); return function () { alive = false } }, [])
      var frameLoaded = loadedIdentity === frameIdentity
      React.useEffect(function () { handshakeRef.current = false; setLoadedIdentity(null); setHandshaken(false); setFrameError('') }, [frameIdentity])
      React.useEffect(function () { if (!props.enabled || !bridgeModule || !ui || frameLoaded) return undefined; if (loadTimerRef.current) clearTimeout(loadTimerRef.current); loadTimerRef.current = setTimeout(function () { setFrameError('业务界面加载超时，请刷新预览。') }, 8000); return function () { if (loadTimerRef.current) { clearTimeout(loadTimerRef.current); loadTimerRef.current = null } } }, [frameIdentity, props.enabled, bridgeModule, ui && ui.assetUrl, frameLoaded])
      React.useEffect(function () { handshakeRef.current = false; setHandshaken(false); setFrameError(''); if (handshakeTimerRef.current) { clearTimeout(handshakeTimerRef.current); handshakeTimerRef.current = null } }, [props.enabled])
      React.useEffect(function () {
        var frame = frameRef.current, bridge = null
        if (!props.enabled || !bridgeModule || !frame || !ui || !frameLoaded || typeof ui.assetUrl !== 'string' || typeof ui.frameToken !== 'string') return undefined
        function onWindowMessage(event) { if (bridge) bridge.receiveWindowMessage(event) }
        window.addEventListener('message', onWindowMessage)
        function beginHandshake() { if (!frameLoaded || !bridge || !bridge.requestHandshake()) return; if (handshakeTimerRef.current) clearTimeout(handshakeTimerRef.current); handshakeTimerRef.current = setTimeout(function () { if (!handshakeRef.current) setFrameError('业务界面连接超时，请刷新预览。') }, 5000) }
        bridge = bridgeModule.createModFrameBridge({ frame: frame, token: ui.frameToken, onAction: function (message) { return props.invoke(message, ui.frameToken) }, onReady: function () { handshakeRef.current = true; if (handshakeTimerRef.current) { clearTimeout(handshakeTimerRef.current); handshakeTimerRef.current = null } setFrameError(''); setHandshaken(true) } })
        bridgeRef.current = bridge
        beginHandshake()
        return function () { if (handshakeTimerRef.current) { clearTimeout(handshakeTimerRef.current); handshakeTimerRef.current = null } window.removeEventListener('message', onWindowMessage); if (bridge) bridge.dispose(); if (bridgeRef.current === bridge) bridgeRef.current = null }
      }, [bridgeModule, frameLoaded, ui && ui.assetUrl, ui && ui.frameToken, props.projectId, frameIdentity, props.enabled])
      if (!candidateUi || typeof candidateUi.assetUrl !== 'string') return null
      if (!ui || typeof ui.assetUrl !== 'string') return React.createElement('small', { role: 'status' }, '正在加载业务界面…')
      return React.createElement('section', { className: 'preview-card', style: { marginTop: '12px' } }, React.createElement('div', { className: 'preview-bar' }, React.createElement('span', null, !props.enabled ? '已停止' : handshaken ? '实时预览' : '正在连接业务界面…'), React.createElement('span', { className: 'sp' }, React.createElement('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick: function () { setRetryKey(function (value) { return value + 1 }) } }, '刷新预览'))),
      React.createElement('div', { className: 'preview-body' }, bridgeModule ? React.createElement('iframe', { key: frameIdentity, ref: frameRef, title: 'Mod 业务界面', src: ui.assetUrl, sandbox: 'allow-scripts', inert: props.enabled ? undefined : '', tabIndex: props.enabled ? 0 : -1, onLoad: function (event) { if (event.currentTarget !== frameRef.current) return; if (loadTimerRef.current) { clearTimeout(loadTimerRef.current); loadTimerRef.current = null } setLoadedIdentity(frameIdentity) }, onError: function () { if (loadTimerRef.current) clearTimeout(loadTimerRef.current); if (handshakeTimerRef.current) clearTimeout(handshakeTimerRef.current); setFrameError('业务界面加载失败，请刷新预览。') }, style: { width: '100%', minHeight: '260px', border: '0', background: 'white', pointerEvents: props.enabled && frameLoaded && !frameError ? 'auto' : 'none' } }) : React.createElement('small', { role: bridgeLoad && bridgeLoad.error ? 'alert' : 'status' }, bridgeLoad && bridgeLoad.error ? React.createElement(React.Fragment, null, '业务界面桥接加载失败。', React.createElement('button', { className: 'btn btn-sec btn-sm', type: 'button', onClick: function () { window.location.reload() } }, '重新加载页面')) : '正在准备业务界面…'), frameError ? React.createElement('div', { role: 'alert' }, frameError) : null, !props.enabled ? React.createElement('div', { className: 'ro-mask' }, React.createElement('strong', null, '已停止'), React.createElement('p', null, props.canStart ? '启动后可以继续使用。' : '当前不能启动此 Mod。'), props.canStart ? React.createElement('button', { className: 'btn btn-pri btn-sm', type: 'button', onClick: props.onStart }, '启动') : null) : null))
    }

    // Reviewed preparation only; activation waits for the V2 component merge.
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

    function ModsBadge(props) {
      var sessions = props.sessions
      var displayModuleState = React.useState(null), displayModule = displayModuleState[0], setDisplayModule = displayModuleState[1]
      React.useEffect(function () { var alive = true; modStatePromise.then(function (module) { if (alive) setDisplayModule(module) }); return function () { alive = false } }, [])
      function displayState(project, detail) { return displayModule ? displayModule.deriveModState(project, detail).label : '状态读取中' }
      var open = React.useState(false), opened = open[0], setOpened = open[1]
      var state = React.useState({ projects: [], detail: null, loading: false, error: '', notice: '' }), panel = state[0], setPanel = state[1]
      var ownerSessionId = props.useSessions(function (state) { return state.current })
      var returnTargetState = React.useState(null), returnTarget = returnTargetState[0], setReturnTarget = returnTargetState[1]
      React.useEffect(function () {
        var surface = window.weftmateSurface
        if (!surface || typeof surface.onOpenModProject !== 'function') return undefined
        return surface.onOpenModProject(function (target) {
          if (!target || typeof target.sessionId !== 'string' || typeof target.projectId !== 'string') return
          try {
            sessions.open(target.sessionId)
            window.location.hash = '/mods'
            setReturnTarget(target)
            setOpened(true)
          } catch (error) { setPanel(function (old) { return Object.assign({}, old, { error: modError(error) }) }); setOpened(true) }
        })
      }, [sessions])
      React.useEffect(function () {
        if (!returnTarget || returnTarget.sessionId !== ownerSessionId) return undefined
        var alive = true
        modRequest(ownerSessionId, 'detail', { project_id: returnTarget.projectId }).then(function (value) {
          if (alive) { setPanel(function (old) { return Object.assign({}, old, { detail: value, error: '' }) }); setReturnTarget(null) }
        }).catch(function (error) { if (alive) { setPanel(function (old) { return Object.assign({}, old, { error: modError(error) }) }); setReturnTarget(null) } })
        return function () { alive = false }
      }, [returnTarget, ownerSessionId])
      function list() {
        if (!ownerSessionId) { setPanel(function (old) { return Object.assign({}, old, { projects: [], detail: null, error: '请先创建或打开一个正式会话，再管理 Mods。', loading: false }) }); return Promise.resolve() }
        setPanel(function (old) { return Object.assign({}, old, { loading: true, error: '' }) })
        var url = '/weftmate/mods/projects.json?session_id=' + encodeURIComponent(ownerSessionId)
        return fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
          .then(function (response) { if (!response.ok) throw new Error('MODS_LIST_HTTP_' + response.status); return response.json() })
          .then(function (value) { setPanel(function (old) { return Object.assign({}, old, { projects: Array.isArray(value.projects) ? value.projects : [], loading: false, error: '' }) }) })
          .catch(function (error) { setPanel(function (old) { return Object.assign({}, old, { loading: false, error: modError(error) }) }) })
      }
      function detail(projectId) {
        return modRequest(ownerSessionId, 'detail', { project_id: projectId }).then(function (value) { setPanel(function (old) { return Object.assign({}, old, { detail: value, error: '', notice: '' }) }) }).catch(function (error) { setPanel(function (old) { return Object.assign({}, old, { error: modError(error) }) }) })
      }
      function act(action, data, projectId) {
        return modRequest(ownerSessionId, action, data).then(function (value) {
          var labels = { start: '启动请求已提交', stop: '停止请求已提交' }
          setPanel(function (old) { return Object.assign({}, old, { notice: labels[action] || '操作已完成。', error: '' }) })
          return list().then(function () { return projectId ? detail(projectId) : value })
        }).catch(function (error) { setPanel(function (old) { return Object.assign({}, old, { error: modError(error) }) }); throw error })
      }
      React.useEffect(function () {
        setPanel(function (old) {
          var project = old.detail && old.detail.project
          var maintainer = project && (project.maintainerSessionId || project.maintainer_session_id)
          return maintainer === ownerSessionId ? old : Object.assign({}, old, { detail: null })
        })
      }, [ownerSessionId])
      React.useEffect(function () { if (opened) list() }, [opened, ownerSessionId])
      var chosen = panel.detail && panel.detail.project
      var chosenId = chosen && (chosen.projectId || chosen.project_id)
      var versions = panel.detail && Array.isArray(panel.detail.versions) ? panel.detail.versions : []
      var recentError = panel.detail && (panel.detail.recentError || chosen && chosen.error)
      var update = panel.detail && panel.detail.update
      React.useEffect(function () {
        if (!opened || !chosenId) return undefined
        var alive = true, pending = false
        var timer = setInterval(function () {
          if (pending) return
          pending = true
          modRequest(ownerSessionId, 'detail', { project_id: chosenId }).then(function (value) { if (alive) setPanel(function (old) { return Object.assign({}, old, { detail: value }) }) }).catch(function (error) { if (alive) setPanel(function (old) { return Object.assign({}, old, { error: modError(error) }) }) }).finally(function () { pending = false })
        }, 1500)
        return function () { alive = false; clearInterval(timer) }
      }, [opened, chosenId, ownerSessionId])
      return React.createElement('div', { 'aria-label': 'Mods', style: { width: '100%', pointerEvents: 'auto' } },
        React.createElement('button', { type: 'button', onClick: function () { setOpened(!opened) }, style: { display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' } }, React.createElement('strong', null, 'Mods'), React.createElement('small', null, opened ? '收起' : '项目管理')),
        opened ? React.createElement('div', { role: 'dialog', 'aria-label': 'Mods 项目管理', style: { position: 'fixed', zIndex: 2147482500, top: '58px', right: '18px', width: 'min(720px, calc(100vw - 36px))', maxHeight: 'calc(100vh - 76px)', overflow: 'auto', padding: '16px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '14px', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', boxShadow: 'var(--weftmate-surface-shadow)' } },
          React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between' } }, React.createElement('strong', null, 'Mods 项目'), React.createElement('button', { type: 'button', onClick: list, disabled: panel.loading }, panel.loading ? '刷新中…' : '刷新')),
          React.createElement('p', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '直接在本项目专属对话提出修改；这里会显示处理进度和更新后的业务界面。'),
          panel.error ? React.createElement('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', margin: '8px 0' } }, panel.error) : null,
          panel.notice ? React.createElement('div', { role: 'status', style: { margin: '8px 0' } }, panel.notice) : null,
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(180px, .7fr) minmax(300px, 1.3fr)', gap: '14px' } },
            React.createElement('aside', null, panel.projects.length ? panel.projects.map(function (project) { var id = project.projectId || project.project_id; return React.createElement('button', { key: id, type: 'button', onClick: function () { detail(id) }, style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '6px', padding: '8px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: chosenId === id ? 'var(--dsw-specific-sidebar-nav-item-active)' : 'transparent' } }, React.createElement('strong', null, project.name || shortModId(id)), React.createElement('small', { style: { display: 'block' } }, displayState(project))) }) : React.createElement('small', null, '尚无项目。')),
            React.createElement('main', null, chosen ? React.createElement(React.Fragment, null,
              React.createElement('h3', { style: { marginTop: 0 } }, chosen.name || chosenId),
              React.createElement('div', null, '当前状态：', displayState(chosen, panel.detail)),
              React.createElement('div', null, '当前版本：', shortModId(chosen.actualVersionId || chosen.runningVersionId || chosen.selectedVersionId || chosen.activeVersionId || chosen.active_version_id)),
              React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px', margin: '10px 0' } },
                React.createElement('button', { type: 'button', disabled: !panel.detail.controls || !panel.detail.controls.canStart, onClick: function () { act('start', { project_id: chosenId, user_initiated: true }, chosenId).catch(function () {}) } }, '启动'),
                React.createElement('button', { type: 'button', disabled: !panel.detail.controls || !panel.detail.controls.canStop, onClick: function () { act('stop', { project_id: chosenId }, chosenId).catch(function () {}) } }, '停止'),
                window.weftmateSurface && typeof window.weftmateSurface.openModWindow === 'function' ? React.createElement('button', { type: 'button', disabled: !panel.detail.controls || !panel.detail.controls.canInvoke, onClick: function () { window.weftmateSurface.openModWindow(chosenId, ownerSessionId).catch(function (error) { setPanel(function (old) { return Object.assign({}, old, { error: modError(error) }) }) }) } }, '在独立窗口打开') : null,
                React.createElement('button', { type: 'button', onClick: function () { var id = chosen.maintainerSessionId || chosen.maintainer_session_id; if (id && sessions && typeof sessions.open === 'function') Promise.resolve(sessions.open(id)).then(function () { setOpened(false) }).catch(function (error) { setPanel(function (old) { return Object.assign({}, old, { error: modError(error) }) }) }); else setPanel(function (old) { return Object.assign({}, old, { error: '专属对话尚未就绪，请刷新后重试。' }) }) } }, '打开专属对话')),
              update ? React.createElement('section', { style: { margin: '10px 0', padding: '10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px' } },
                React.createElement('strong', null, '处理进度'),
                React.createElement('div', null, modStatus(update.status, update)),
                update.lastError ? React.createElement('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)' } }, String(update.lastError)) : null) : null,
              recentError ? React.createElement('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)' } }, '最近错误：', typeof recentError === 'string' ? recentError : String(recentError.message || recentError.code || '未知')) : null,
              React.createElement(ModBusinessFrame, { detail: panel.detail, projectId: chosenId, versionId: chosen.actualVersionId || chosen.runningVersionId || chosen.selectedVersionId || chosen.activeVersionId || chosen.active_version_id, invoke: function (message, frameToken) { return modRequest(ownerSessionId, 'invoke', { project_id: chosenId, frame_token: frameToken, request: { action: message.action, payload: message.payload } }).then(function (value) { return value.result === undefined ? (value.value === undefined ? value : value.value) : value.result }) } })
            ) : React.createElement('small', null, '从左侧选择项目查看详情。')))
        ) : null)
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
        '.weftmate-v2-rail{position:fixed;top:44px;bottom:30px;left:0;width:60px;padding:10px 0;display:flex;flex-direction:column;align-items:center;gap:4px;border-right:1px solid var(--weftmate-hairline);background:var(--dsw-alias-bg-base);pointer-events:auto}.weftmate-v2-rail button{min-height:36px;border:0;border-radius:8px;background:transparent;color:inherit}.weftmate-v2-rail button[data-on]{background:var(--weftmate-accent-soft);color:var(--weftmate-accent)}.weftmate-v2-rail .rl-item{position:relative;width:48px;padding:7px 0 6px;border-radius:10px;border:none;background:none;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;color:var(--weftmate-ink-3);font-size:11px;transition:background 120ms ease,color 120ms ease}.weftmate-v2-rail .rl-item svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.weftmate-v2-rail .rl-item:hover{background:var(--weftmate-surface-2,rgba(128,128,128,0.1));color:var(--weftmate-ink-1)}.weftmate-v2-rail .rl-item.on{color:var(--weftmate-accent);font-weight:600;background:var(--weftmate-accent-soft)}.weftmate-v2-rail .rl-item .rl-dot{position:absolute;top:6px;right:9px;width:7px;height:7px;border-radius:50%;background:var(--weftmate-accent);box-shadow:0 0 0 2px var(--weftmate-surface)}.weftmate-v2-rail .r-bottom{margin-top:auto;display:flex;flex-direction:column;gap:4px;align-items:center}.weftmate-v2-rail .r-avatar{width:30px;height:30px;border-radius:50%;cursor:pointer;background:linear-gradient(135deg,var(--weftmate-accent),#1a3ec8);display:grid;place-items:center;color:#fff;font-size:11px;font-weight:700}[data-weftmate-v2-sidebar] .oC7kBG_root{box-sizing:border-box!important;width:236px!important;max-width:236px!important;padding:0!important}[data-weftmate-v2-sidebar] .oC7kBG_regionArea{width:236px!important;margin:0!important;padding:0!important}[data-weftmate-v2-sidebar] .weftmate-v2-sessions.sess-col{box-sizing:border-box;position:relative;z-index:20;width:236px;height:100%;flex-shrink:0;background:var(--weftmate-surface);border-right:1px solid var(--weftmate-hairline);display:flex;flex-direction:column;pointer-events:auto}.weftmate-v2-sessions .sdot{width:6px;height:6px;border-radius:50%;background:var(--weftmate-accent);flex:none}.weftmate-v2-sessions .sess-list{min-height:0;overflow:auto}.weftmate-v2-sessions .sess-group{font-size:12px;font-weight:650;color:var(--weftmate-ink-3);letter-spacing:.04em;padding:10px 8px 4px}.weftmate-v2-sessions .sess-node,.weftmate-v2-sessions .sess-item{position:relative;margin-bottom:2px;font-size:13.5px}.weftmate-v2-sessions .sess-node .acts{margin-left:auto;display:flex;gap:2px;opacity:0}.weftmate-v2-sessions .sess-node:hover .acts,.weftmate-v2-sessions .sess-node:focus-within .acts,.weftmate-v2-sessions .sess-node:hover .mini,.weftmate-v2-sessions .sess-node:focus-within .mini,.weftmate-v2-sessions .sess-item:hover .mini,.weftmate-v2-sessions .sess-item:focus-within .mini{opacity:1}.weftmate-v2-sessions .mini{opacity:0;border:0;background:transparent;color:inherit}.weftmate-v2-sessions .sess-item .d{min-width:36px;text-align:right;font-size:11px}.weftmate-v2-sessions .sess-new .btn{width:100%;font-size:13px;font-weight:600;height:32px}.weftmate-v2-sessions .sess-state{width:6px;height:6px;flex:none;border-radius:50%;background:var(--weftmate-accent)}.weftmate-v2-sessions .sess-state.pending{background:var(--weftmate-warn,#b45309)}.weftmate-v2-sessions .sess-state.completed{background:var(--weftmate-ok,#15803d)}.weftmate-v2-sessions .sess-rename{width:100%;min-width:0;font:inherit}.weftmate-v2-sidebar-feedback{padding:5px 8px;color:var(--weftmate-ink-3,#6b7280);font-size:11px}.weftmate-v2-sidebar-feedback.err{color:var(--weftmate-err,#dc2626)}.oC7kBG_logoRow,.oC7kBG_newSession{display:none!important}.oC7kBG_footArea{position:fixed;z-index:30;left:6px;top:var(--weftmate-v2-settings-top);bottom:auto;width:48px;height:0!important;padding:0!important;margin:0!important;overflow:visible!important;border:none!important;pointer-events:none}.oC7kBG_footArea button.ksvqgW_trigger,.oC7kBG_footArea button[aria-haspopup="dialog"]{display:none!important}.ksvqgW_overlay{pointer-events:auto!important}[data-weftmate-v2-sidebar] .oC7kBG_settingsArea .ksvqgW_trigger,[data-weftmate-v2-sidebar] .oC7kBG_settingsArea .ksvqgW_trigger.ksvqgW_rail{border-radius:10px;justify-content:center;flex-direction:column;gap:3px;width:48px;height:auto;margin:0;padding:7px 0 6px;font-size:10px}[data-weftmate-v2-sidebar] .oC7kBG_settingsArea .ksvqgW_trigger svg{width:18px;height:18px}[data-weftmate-v2-sidebar] .oC7kBG_settingsArea .Sf1YKG_triggerLabel{display:none}[data-weftmate-v2-sidebar] .oC7kBG_settingsArea .ksvqgW_trigger::after{content:attr(data-weftmate-settings-label);line-height:1}.weftmate-v2-sessions[data-collapsed] .sess-sub{display:none}[data-weftmate-v2-sidebar] .weftmate-v2-sessions .pin-ic{width:12px;height:12px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8}@media(max-width:980px){.weftmate-v2-sessions{display:none!important}}html[data-weftmate-v2-sessions-hidden] .weftmate-v2-sessions,html[data-weftmate-v2-page="mods"] .weftmate-v2-sessions{display:none!important}html[data-weftmate-v2-page="memory"] .weftmate-v2-sessions,html[data-weftmate-v2-page="settings"] .weftmate-v2-sessions{display:none!important}html[data-weftmate-v2-sessions-hidden] [data-weftmate-v2-sidebar],html[data-weftmate-v2-page="mods"] [data-weftmate-v2-sidebar]{visibility:visible!important;pointer-events:auto!important;overflow:visible!important}html[data-weftmate-v2-page="memory"] [data-weftmate-v2-sidebar],html[data-weftmate-v2-page="settings"] [data-weftmate-v2-sidebar]{visibility:visible!important;pointer-events:auto!important;overflow:visible!important}@media(max-width:980px){[data-weftmate-v2-sidebar]{visibility:visible!important;pointer-events:auto!important;overflow:visible!important}.weftmate-v2-sessions{display:none!important}}',
        '.weftmate-v2-head{position:fixed;top:44px;left:60px;right:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid var(--weftmate-hairline);background:var(--dsw-alias-bg-base);pointer-events:auto}.weftmate-v2-head b{font-size:14px}.weftmate-v2-head .weftmate-v2-chat-title{min-width:0;max-width:clamp(160px,50vw,520px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.weftmate-v2-head .ch-left{display:flex;align-items:center;gap:8px;min-width:0}.weftmate-v2-work{box-sizing:border-box;position:fixed;right:0;top:96px;bottom:30px;width:288px;padding:14px 14px 24px;border-left:1px solid var(--weftmate-hairline);background:var(--weftmate-surface);pointer-events:auto;overflow-y:auto;display:flex;flex-direction:column}.weftmate-v2-work h2{margin:0 0 8px;font-size:12px}.weftmate-v2-work .wc-eyebrow{font-size:12px;font-weight:650;color:var(--weftmate-ink-2);letter-spacing:.06em;padding:2px 2px 8px}.weftmate-v2-work .wc-card .wc-head{display:flex;align-items:center;gap:7px;font-size:13.5px;font-weight:650}.weftmate-v2-work .wc-card .wc-desc{font-size:12.5px;color:var(--weftmate-ink-2);margin-top:4px;line-height:1.55}.weftmate-v2-work .wc-card .wc-foot{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11.5px;color:var(--weftmate-ink-3)}.weftmate-v2-work .wc-row{display:flex;align-items:center;gap:8px;padding:6px 2px;font-size:13px;color:var(--weftmate-ink-2)}.weftmate-v2-work .wc-row .wc-ic{width:24px;height:24px;border-radius:6px;background:var(--weftmate-surface-2);display:grid;place-items:center;font-size:11.5px;flex-shrink:0;color:var(--weftmate-ink-3)}.weftmate-v2-work .wc-row .d{font-size:11px;color:var(--weftmate-ink-3)}.weftmate-v2-work .prog-step{font-size:11.5px}.weftmate-v2-work .wt-item .wt-x{font-size:13px;font-weight:500}.weftmate-v2-work .wt-item .wt-t{font-size:11px;color:var(--weftmate-ink-3)}.weftmate-v2-status{z-index:22;position:fixed;left:0;right:0;bottom:0;height:30px;display:flex;align-items:center;padding:0 14px;border-top:1px solid var(--weftmate-hairline);background:var(--dsw-alias-bg-base);font-size:11px;color:var(--dsw-alias-label-secondary)}.weftmate-v2-status.statusbar{gap:16px;pointer-events:auto}.weftmate-v2-status .st{display:flex;align-items:center;gap:5px;white-space:nowrap;cursor:default}.weftmate-v2-status .st b{color:var(--weftmate-ink-2,var(--dsw-alias-label-primary));font-weight:600}.weftmate-v2-status .dot{width:6px;height:6px;border-radius:50%;background:var(--weftmate-ok,#10b981)}.weftmate-v2-status .right{margin-left:auto;display:flex;gap:16px}',
        '.weftmate-v2-page{position:fixed;z-index:21;inset:44px 0 30px 60px;background:var(--dsw-alias-bg-base);overflow:auto;pointer-events:auto;padding:0;max-width:none!important}.weftmate-v2-page:not(.on){display:none!important}.weftmate-v2-page .page-head{min-height:52px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--weftmate-hairline)}.weftmate-v2-page main{max-width:none;margin:0}.weftmate-v2-page.weftmate-v2-mods{background:var(--weftmate-bg-base)}.weftmate-v2-page.weftmate-v2-mods .page-head{padding:0 22px;background:var(--weftmate-surface)}.weftmate-v2-page.weftmate-v2-mods .mod-grid{padding:0}.weftmate-v2-page.weftmate-v2-mods .preview-card{display:block}.weftmate-v2-page.weftmate-v2-mods .preview-bar{position:relative!important;top:auto!important;margin:0!important;transform:none!important;flex:none!important;height:34px!important;min-height:34px!important;box-sizing:border-box}.weftmate-v2-page.weftmate-v2-mods .preview-body{height:250px!important;overflow:auto}.weftmate-v2-layout-error,.weftmate-v2-sidebar-restore-error{display:none}[data-weftmate-v2-layout="unsupported"] .weftmate-v2-layout-error,[data-weftmate-v2-frame][data-weftmate-v2-sidebar-restore-failed] [data-shell-overlay] .weftmate-v2-sidebar-restore-error{display:block;position:fixed;left:72px;bottom:42px;background:var(--weftmate-err-bg);color:var(--weftmate-err);padding:6px 8px;border-radius:8px;font-size:12px}.weftmate-v2-shell[data-page="mods"] .weftmate-v2-work,.weftmate-v2-shell[data-page="mods"] .weftmate-v2-head,.weftmate-v2-shell[data-page="memory"] .weftmate-v2-work,.weftmate-v2-shell[data-page="memory"] .weftmate-v2-head,.weftmate-v2-shell[data-page="settings"] .weftmate-v2-work,.weftmate-v2-shell[data-page="settings"] .weftmate-v2-head{display:none}',
        '.weftmate-v2-page.weftmate-v2-settings,.weftmate-v2-page.weftmate-v2-memory{background:var(--weftmate-bg-base);display:flex;flex-direction:column}.weftmate-v2-page.weftmate-v2-settings .page-head,.weftmate-v2-page.weftmate-v2-memory .page-head{padding:0 22px;background:var(--weftmate-surface);border-bottom:1px solid var(--weftmate-hairline);min-height:52px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}.weftmate-v2-page .page-scroll{flex:1;overflow-y:auto;padding:22px;min-height:0}.weftmate-v2-page .page-body{max-width:920px;margin:0 auto}.weftmate-v2-page .set-group{background:var(--weftmate-surface);border:1px solid var(--weftmate-hairline);border-radius:12px;overflow:hidden;margin-bottom:14px}.weftmate-v2-page .set-group .sg-title{font-size:11px;font-weight:700;color:var(--weftmate-ink-3);padding:12px 16px 5px;letter-spacing:.06em}.weftmate-v2-page .set-row{display:flex;align-items:center;gap:12px;padding:10px 16px;font-size:12.5px;border-top:1px solid var(--weftmate-hairline);min-height:42px}.weftmate-v2-page .sg-title+.set-row{border-top:none}.weftmate-v2-page .set-row .sr-k{font-weight:500;color:var(--weftmate-ink-1)}.weftmate-v2-page .set-row .sr-d{font-size:11px;color:var(--weftmate-ink-3);margin-top:1px}.weftmate-v2-page .set-row .sr-v{margin-left:auto;font-size:11.5px;color:var(--weftmate-ink-3);text-align:right}.weftmate-v2-page .set-row .sr-act{margin-left:auto;display:flex;gap:8px;align-items:center}.weftmate-v2-page .seg{display:inline-flex;padding:2px;background:var(--weftmate-surface-2,rgba(0,0,0,0.06));border:1px solid var(--weftmate-hairline);border-radius:8px;gap:2px}.weftmate-v2-page .seg button{padding:4px 12px;font-size:11.5px;border:none;background:none;border-radius:6px;color:var(--weftmate-ink-2);cursor:pointer}.weftmate-v2-page .seg button.on{background:var(--weftmate-surface);color:var(--weftmate-ink-1);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.1)}.weftmate-v2-page .toggle{position:relative;width:38px;height:22px;border-radius:11px;background:var(--weftmate-hairline-strong);border:1px solid var(--weftmate-hairline);cursor:pointer;padding:0;transition:background 120ms ease,border-color 120ms ease}.weftmate-v2-page .toggle::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.2);transition:transform 120ms ease}.weftmate-v2-page .toggle.on{background:var(--weftmate-accent);border-color:var(--weftmate-accent)}.weftmate-v2-page .toggle.on::after{transform:translateX(16px)}.weftmate-v2-page .mem-card{background:var(--weftmate-surface);border:1px solid var(--weftmate-hairline);border-radius:12px;padding:13px 15px;margin-bottom:10px}.weftmate-v2-page .mem-card .mc-rel{font-size:12.5px;line-height:1.6;color:var(--weftmate-ink-1)}.weftmate-v2-page .mem-card .mc-src{margin-top:8px;font-size:11px;color:var(--weftmate-ink-3);display:flex;gap:6px;align-items:center;flex-wrap:wrap}.weftmate-v2-page .src-tag{background:var(--weftmate-surface-2,rgba(128,128,128,0.12));border-radius:5px;padding:1px 7px;font-size:10px;color:var(--weftmate-ink-2)}.weftmate-v2-page .mem-chip{cursor:pointer;background:var(--weftmate-accent-soft);color:var(--weftmate-accent);padding:1px 7px;border-radius:5px;font-size:10px}.weftmate-v2-page .eyebrow{font-size:11px;font-weight:600;color:var(--weftmate-ink-3);letter-spacing:.08em;margin:24px 0 10px;display:flex;align-items:center;gap:8px}.weftmate-v2-page .eyebrow:first-child{margin-top:0}.weftmate-v2-page .eyebrow::after{content:"";flex:1;height:1px;background:var(--weftmate-hairline)}.weftmate-v2-settings-tabs{display:flex;gap:6px;align-items:center;padding:3px;background:var(--weftmate-surface-2,rgba(0,0,0,0.04));border:1px solid var(--weftmate-hairline);border-radius:10px}.weftmate-v2-settings-tabs .set-tab{padding:4px 10px;font-size:11.5px;border:none;background:none;border-radius:7px;color:var(--weftmate-ink-2);cursor:pointer;transition:all 120ms ease;white-space:nowrap}.weftmate-v2-settings-tabs .set-tab:hover{color:var(--weftmate-ink-1);background:var(--weftmate-surface)}.weftmate-v2-settings-tabs .set-tab.on{background:var(--weftmate-surface);color:var(--weftmate-accent);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.08)}.weftmate-v2-page .btn{padding:5px 12px;font-size:12px;border-radius:8px;cursor:pointer;border:1px solid var(--weftmate-hairline);background:var(--weftmate-surface);color:var(--weftmate-ink-1);transition:all 120ms ease;display:inline-flex;align-items:center;gap:5px}.weftmate-v2-page .btn:hover{background:var(--weftmate-surface-2,rgba(0,0,0,0.06))}.weftmate-v2-page .btn-primary{background:var(--weftmate-accent);color:#fff;border-color:var(--weftmate-accent)}.weftmate-v2-page .btn-primary:hover{opacity:0.9}.weftmate-v2-page .btn-sec{background:var(--weftmate-accent-soft);color:var(--weftmate-accent);border-color:transparent}.weftmate-v2-page .btn-ghost{background:transparent;border-color:var(--weftmate-hairline);color:var(--weftmate-ink-2)}.weftmate-v2-page .btn-sm{padding:3px 8px;font-size:11px}.weftmate-v2-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--weftmate-hairline)}.ph-panel-title{font-size:14px;font-weight:650;color:var(--weftmate-ink-1)}.ph-panel-desc{font-size:11.5px;color:var(--weftmate-ink-3);margin-top:2px}.ph-panel-act{display:flex;gap:8px;align-items:center}.provider-card,.preset-card{background:var(--weftmate-surface);border:1px solid var(--weftmate-hairline);border-radius:12px;padding:13px 16px;margin-bottom:10px;transition:border-color 120ms ease}.provider-card:hover,.preset-card:hover{border-color:var(--weftmate-accent-soft)}.preset-card.default{border-color:var(--weftmate-accent)}.pc-top,.psc-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.pc-brand,.psc-brand{display:flex;align-items:center;gap:8px}.status-dot{width:8px;height:8px;border-radius:50%;background:var(--weftmate-ink-3)}.status-dot.online{background:#10b981;box-shadow:0 0 6px rgba(16,185,129,0.4)}.provider-title,.preset-title{font-size:13px;font-weight:600;color:var(--weftmate-ink-1)}.protocol-badge{font-size:10.5px;padding:1px 7px;border-radius:5px;background:var(--weftmate-surface-2,rgba(0,0,0,0.06));color:var(--weftmate-ink-2);font-family:monospace}.preset-badge{font-size:10px;padding:1px 6px;border-radius:5px;background:var(--weftmate-accent-soft);color:var(--weftmate-accent);font-weight:600}.pc-actions,.psc-actions{display:flex;gap:6px;align-items:center}.pc-meta{margin-top:6px;font-size:11.5px;color:var(--weftmate-ink-3);display:flex;gap:10px}.pc-url{font-family:monospace}.pc-models{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}.model-tag{font-size:11px;padding:2px 8px;border-radius:6px;background:var(--weftmate-accent-soft);color:var(--weftmate-accent);display:inline-flex;align-items:center;gap:4px}.model-tag .mt-ctx{opacity:0.75;font-size:10px}.psc-desc{margin-top:6px;font-size:12px;color:var(--weftmate-ink-2);line-height:1.5}.psc-footer{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}.psc-tag{font-size:10.5px;padding:2px 7px;border-radius:5px;background:var(--weftmate-surface-2,rgba(0,0,0,0.06));color:var(--weftmate-ink-2)}.psc-tag.sub{background:var(--weftmate-accent-soft);color:var(--weftmate-accent)}.weftmate-v2-form-card{background:var(--weftmate-surface);border:1.5px solid var(--weftmate-accent);border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 4px 14px rgba(46,91,255,0.08)}.fc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--weftmate-hairline)}.fc-title{font-size:13px;font-weight:650;color:var(--weftmate-ink-1)}.fc-row{display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap}.fc-field{flex:1;min-width:200px}.fc-label{display:block;font-size:11px;font-weight:600;color:var(--weftmate-ink-2);margin-bottom:4px}.fc-input,.fc-select,.fc-textarea{width:100%;box-sizing:border-box;padding:6px 10px;font-size:12px;border-radius:7px;border:1px solid var(--weftmate-hairline);background:var(--weftmate-surface-2,rgba(0,0,0,0.03));color:var(--weftmate-ink-1);outline:none;transition:border-color 120ms ease}.fc-input:focus,.fc-select:focus,.fc-textarea:focus{border-color:var(--weftmate-accent)}.fc-subheading{font-size:11px;font-weight:650;color:var(--weftmate-ink-2);margin:10px 0 6px}.fc-model-row{display:flex;gap:8px;align-items:center;margin-bottom:6px}.fc-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;padding-top:10px;border-top:1px solid var(--weftmate-hairline)}.settings-feedback{background:var(--weftmate-accent-soft);color:var(--weftmate-accent);padding:8px 14px;border-radius:8px;font-size:12px;font-weight:500;margin-bottom:14px;display:flex;align-items:center;gap:8px;border:1px solid rgba(46,91,255,0.2)}.weftmate-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:20px}.weftmate-modal-panel{background:var(--weftmate-surface,#fff);border:1px solid var(--weftmate-hairline,rgba(0,0,0,0.1));border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,0.2);width:100%;max-width:620px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden}.wmp-head{padding:14px 18px;border-bottom:1px solid var(--weftmate-hairline);display:flex;align-items:center;justify-content:space-between}.wmp-title{font-size:14px;font-weight:650;color:var(--weftmate-ink-1)}.wmp-body{padding:16px 18px;overflow-y:auto;flex:1;font-size:12.5px;color:var(--weftmate-ink-2)}.wmp-desc{font-size:12px;color:var(--weftmate-ink-3);margin-bottom:12px;line-height:1.5}.wmp-code{background:var(--weftmate-surface-2,rgba(0,0,0,0.04));border:1px solid var(--weftmate-hairline);border-radius:8px;padding:12px;font-family:monospace;font-size:11.5px;line-height:1.55;max-height:360px;overflow:auto;white-space:pre}.wmp-foot{padding:12px 18px;border-top:1px solid var(--weftmate-hairline);display:flex;justify-content:flex-end;gap:8px}.creator-draft-btn{width:100%;box-sizing:border-box;border:1px dashed var(--weftmate-hairline-strong,rgba(0,0,0,0.2));border-radius:12px;height:42px;background:transparent;color:var(--weftmate-ink-2);font-size:13px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all 120ms ease;margin-top:10px}.creator-draft-btn:hover{background:var(--weftmate-surface-2,rgba(0,0,0,0.04));color:var(--weftmate-accent);border-color:var(--weftmate-accent)}.preset-group-heading{font-size:11px;font-weight:700;color:var(--weftmate-ink-3);letter-spacing:.06em;text-transform:uppercase;margin:16px 0 8px;display:flex;align-items:center;gap:6px}',
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
          React.createElement('div', { className: 'greet' }, '晚上好，Yun。'),
          React.createElement('div', { className: 'greet-sub' }, '说句话就开始；做重复的事，就把它做成 Mod。'),
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
        link.id = id; link.rel = 'stylesheet'; link.href = '/weftmate/mods/v2-shell/' + name + '.css'
        document.head.appendChild(link)
      })
    }

    function createModsRequestGuard() {
      var generation = 0, disposed = false, actions = {}, scope = null, reads = {}
      function enter(sessionId, nextScope) { var signature = sessionId + '\u0000' + (nextScope || 'list'); if (signature !== scope) { generation += 1; scope = signature; reads = {} } return { sessionId: sessionId, generation: generation } }
      return {
        begin: enter,
        read: function (sessionId, nextScope, channel) { var token = enter(sessionId, nextScope); channel = channel || 'default'; reads[channel] = (reads[channel] || 0) + 1; token.channel = channel; token.read = reads[channel]; return token },
        current: function (token, sessionId) { return !disposed && token && token.sessionId === sessionId && token.generation === generation && (!token.channel || reads[token.channel] === token.read) },
        beginAction: function (sessionId, projectId) { var key = sessionId + '\u0000' + projectId; if (disposed || actions[key]) return null; var token = { sessionId: sessionId, projectId: projectId, generation: generation, key: key }; actions[key] = token; return token },
        finishAction: function (token, sessionId) { if (token) delete actions[token.key]; return this.current(token, sessionId) },
        dispose: function () { disposed = true; generation += 1; actions = {} },
      }
    }

    function createModsNavigationGuard() {
      var sequence = 0, mounted = true
      return { begin: function (targetSessionId) { sequence += 1; return { sequence: sequence, targetSessionId: targetSessionId } }, current: function (token) { return mounted && token && token.sequence === sequence }, dispose: function () { mounted = false; sequence += 1 } }
    }

    function currentModProject(project, detailValue) {
      var projectId = project && (project.projectId || project.project_id)
      var fresh = detailValue && detailValue.project
      return fresh && (fresh.projectId || fresh.project_id) === projectId ? fresh : project
    }

    function V2ModsWorkspace(props) {
      var sessions = props.sessions
      var sessionState = React.useSyncExternalStore(function (notify) { return sessions.list.subscribe(notify) }, function () { return sessions.list.getSnapshot() })
      var ownerSessionId = sessionState.current
      var ownerRef = React.useRef(ownerSessionId), guardRef = React.useRef(null), navigationRef = React.useRef(null)
      ownerRef.current = ownerSessionId
      if (!guardRef.current) guardRef.current = createModsRequestGuard()
      if (!navigationRef.current) navigationRef.current = createModsNavigationGuard()
      var statePair = React.useState({ sessionId: ownerSessionId, projects: [], details: {}, detail: null, detailProjectId: null, detailSessionId: null, error: '', loading: false, actions: {} }), state = statePair[0], setState = statePair[1]
      var routePair = React.useState(window.location.hash), route = routePair[0], setRoute = routePair[1]
      var displayPair = React.useState(null), display = displayPair[0], setDisplay = displayPair[1]
      React.useEffect(function () { var alive = true; modStatePromise.then(function (value) { if (alive) setDisplay(value) }); return function () { alive = false } }, [])
      React.useEffect(function () { var onHash = function () { setRoute(window.location.hash) }; window.addEventListener('hashchange', onHash); return function () { window.removeEventListener('hashchange', onHash) } }, [])
      React.useEffect(function () { return function () { guardRef.current.dispose(); navigationRef.current.dispose() } }, [])
      var selectedId = /^#\/mod\/([^/]+)$/.exec(route || '')
      selectedId = selectedId ? decodeURIComponent(selectedId[1]) : null
      function current(token) { return guardRef.current.current(token, ownerRef.current) }
      function detail(id, token) { return modRequest(token.sessionId, 'detail', { project_id: id }).then(function (value) { return current(token) ? { value: value } : null }, function (error) { return current(token) ? { error: modError(error) } : null }) }
      function refresh() {
        if (!ownerSessionId) { guardRef.current.begin(null, 'list'); setState({ sessionId: null, projects: [], details: {}, detail: null, error: '请先选择一个正式会话。', loading: false, actions: {} }); return Promise.resolve() }
        var token = guardRef.current.read(ownerSessionId, 'list', 'list')
        setState({ sessionId: ownerSessionId, projects: [], details: {}, detail: null, error: '', loading: true, actions: {} })
        return fetch('/weftmate/mods/projects.json?session_id=' + encodeURIComponent(ownerSessionId), { credentials: 'same-origin', cache: 'no-store' })
          .then(function (response) { if (!response.ok) throw new Error('MODS_LIST_HTTP_' + response.status); return response.json() })
          .then(function (value) {
            var projects = Array.isArray(value.projects) ? value.projects : []
            if (!current(token)) return null
            setState(function (old) { return Object.assign({}, old, { projects: projects, loading: false, error: '' }) })
            var details = {}, next = 0
            function worker() { var project = projects[next++]; if (!project) return Promise.resolve(); var id = project.projectId || project.project_id; return detail(id, guardRef.current.read(ownerSessionId, 'list', 'detail:' + id)).then(function (result) { if (result) details[id] = result; return worker() }) }
            return Promise.all([worker(), worker(), worker(), worker()]).then(function () { if (current(token)) setState(function (old) { return Object.assign({}, old, { details: details }) }) })
          }).catch(function (error) { if (current(token)) setState({ sessionId: ownerSessionId, projects: [], details: {}, detail: null, error: '读取 Mods 失败，请重试。', technicalError: modError(error), loading: false, actions: {} }) })
      }
      React.useEffect(function () { refresh() }, [ownerSessionId])
      React.useEffect(function () { if (!ownerSessionId) return; if (!selectedId) { guardRef.current.begin(ownerSessionId, 'list'); setState(function (old) { return Object.assign({}, old, { detail: null, detailProjectId: null, detailSessionId: null }) }); refresh(); return } setState(function (old) { return Object.assign({}, old, { detail: null, detailProjectId: selectedId, detailSessionId: ownerSessionId, error: '', technicalError: '' }) }); var alive = true; function load() { var token = guardRef.current.read(ownerSessionId, selectedId, 'detail:' + selectedId); detail(selectedId, token).then(function (result) { if (!alive || !result || !current(token)) return; if (result.value) setState(function (old) { return Object.assign({}, old, { detail: result.value, detailProjectId: selectedId, detailSessionId: ownerSessionId, error: '' }) }); else setState(function (old) { return Object.assign({}, old, { detail: null, detailProjectId: selectedId, detailSessionId: ownerSessionId, error: '读取 Mod 状态失败，请重试。', technicalError: result.error }) }) }) } load(); var timer = setInterval(load, 1500); return function () { alive = false; clearInterval(timer) } }, [selectedId, ownerSessionId])
      function derived(project, detailValue) { return display ? display.deriveModState(project, detailValue || {}) : { label: '状态读取中', tone: 'idle' } }
      function choose(id) { window.location.hash = '/mod/' + encodeURIComponent(id) }
      function openMaintainer(project, event) { event.stopPropagation(); var id = project.maintainerSessionId || project.maintainer_session_id; if (!id) { setState(function (old) { return Object.assign({}, old, { error: '此 Mod 尚未提供专属维护会话。' }) }); return } var token = navigationRef.current.begin(id); Promise.resolve(sessions.open(id)).then(function () { if (navigationRef.current.current(token) && ownerRef.current === id) window.location.hash = '/chat' }).catch(function (error) { if (navigationRef.current.current(token)) setState(function (old) { return Object.assign({}, old, { error: '打开专属维护会话失败，请重试。', technicalError: modError(error) }) }) }) }
      function actList(project, action, event) { event.stopPropagation(); var id = project.projectId || project.project_id, entry = state.details[id], controls = entry && entry.value && entry.value.controls; if (!controls || (action === 'start' && !controls.canStart) || (action === 'stop' && !controls.canStop)) return; var token = guardRef.current.beginAction(ownerSessionId, id); if (!token) return; setState(function (old) { var actions = Object.assign({}, old.actions); actions[id] = action; return Object.assign({}, old, { actions: actions }) }); modRequest(ownerSessionId, action, { project_id: id, user_initiated: action === 'start' }).then(function () { return detail(id, token) }).then(function (result) { if (!guardRef.current.finishAction(token, ownerRef.current)) return; setState(function (old) { var details = Object.assign({}, old.details), actions = Object.assign({}, old.actions); delete actions[id]; if (result && result.value) details[id] = result; else details[id] = { error: result && result.error || '动作后状态读取失败' }; return Object.assign({}, old, { details: details, actions: actions, error: result && result.value ? old.error : '读取 Mod 状态失败，请重试。', technicalError: result && result.value ? old.technicalError : result && result.error }) }) }).catch(function (error) { if (!guardRef.current.finishAction(token, ownerRef.current)) return; setState(function (old) { var actions = Object.assign({}, old.actions); delete actions[id]; return Object.assign({}, old, { actions: actions, error: 'Mod 操作失败，请重试。', technicalError: modError(error) }) }) }) }
      if (!selectedId) {
        var cards = state.projects.map(function (project) {
          var id = project.projectId || project.project_id, detailValue = state.details[id] && state.details[id].value, currentProject = currentModProject(project, detailValue), entry = state.details[id], controls = detailValue && detailValue.controls, pending = state.actions[id], view = derived(currentProject, detailValue), version = currentProject.activeVersionId || currentProject.active_version_id
          var status = entry && entry.error ? '状态读取失败' : view.label
          var primary = controls && controls.canStop ? 'stop' : controls && controls.canStart ? 'start' : null
          var reason = entry && entry.error ? '读取 Mod 状态失败，请重试。' : !controls ? '正在读取操作权限。' : primary ? '' : '当前状态不允许启动或停止。'
          return React.createElement('article', { key: id, className: 'mod-card', 'data-project-id': id, role: 'link', tabIndex: 0, onClick: function () { choose(id) }, onKeyDown: function (event) { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(id) } } },
            React.createElement('div', { className: 'mc-top' }, React.createElement('span', { className: 'mc-ic mi-blue' }, '模'), React.createElement('span', { className: 'mc-name' }, currentProject.name || shortModId(id)), version ? React.createElement('span', { className: 'mc-ver' }, shortModId(version)) : null),
            React.createElement('div', { className: 'mc-desc' }, currentProject.description || '未提供说明。'),
            React.createElement('div', { className: 'mc-foot' }, React.createElement('span', { className: 'badge ' + ({ neutral: 'idle', running: 'ok', success: 'ok', warning: 'warn', error: 'err', failed: 'err' }[view.tone] || 'idle') }, React.createElement('span', { className: 'p' }), status), React.createElement('span', { className: 'spacer' }), primary ? React.createElement('button', { className: 'btn btn-sec btn-sm', type: 'button', disabled: !!pending, onClick: function (event) { actList(currentProject, primary, event) } }, pending ? (primary === 'start' ? '启动中' : '停止中') : (primary === 'start' ? '启动' : '停止')) : React.createElement('span', { title: reason, 'aria-label': reason }, '不可操作'), React.createElement('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick: function (event) { openMaintainer(currentProject, event) } }, '修改')))
        })
        var listCurrent = state.sessionId === ownerSessionId
        var listBody = !listCurrent || state.loading ? React.createElement('p', { role: 'status' }, '正在读取已安装 Mods…') : state.error ? React.createElement('div', { role: 'alert' }, React.createElement('p', null, state.error), React.createElement('details', null, React.createElement('summary', null, '技术详情'), React.createElement('pre', null, state.technicalError || '未提供')) , React.createElement('button', { className: 'btn btn-sec btn-sm', type: 'button', onClick: refresh }, '重试')) : cards.length ? React.createElement('div', { className: 'mod-grid' }, cards) : React.createElement('p', { role: 'status' }, '当前会话尚无可管理的 Mod。')
        return React.createElement('main', { className: 'page page-mods on' }, React.createElement('div', { className: 'page-head' }, React.createElement('span', { className: 'ph-title' }, 'Mods'), React.createElement('span', { className: 'ph-sub' }, '管理当前会话可访问的能力'), React.createElement('div', { className: 'ph-act' }, React.createElement('button', { className: 'btn btn-sec btn-sm', type: 'button', disabled: true, 'aria-describedby': 'mod-install-unavailable', title: '推荐目录尚未接入，当前不能安装 Mod。' }, '安装 Mod'), React.createElement('button', { className: 'btn btn-sec btn-sm', type: 'button', onClick: refresh, disabled: state.loading }, state.loading ? '刷新中' : '刷新'))), React.createElement('div', { className: 'page-scroll' }, React.createElement('div', { className: 'page-body wide' }, React.createElement('div', { className: 'eyebrow' }, '已安装'), listBody, React.createElement('div', { className: 'eyebrow' }, '推荐'), React.createElement('p', { id: 'mod-install-unavailable', role: 'status' }, '推荐目录尚未接入；安装功能当前不可用。'))))
      }
      var detailValue = state.detail, project = detailValue && detailValue.project
      if (state.sessionId !== ownerSessionId || state.detailSessionId !== ownerSessionId || state.detailProjectId !== selectedId || !project || (project.projectId || project.project_id) !== selectedId) return React.createElement('main', { className: 'page page-mods on' }, React.createElement('p', { role: state.error ? 'alert' : 'status' }, state.error || '正在读取项目…'))
      var status = derived(project, detailValue), controls = detailValue.controls || {}
      function act(action) { if (!state.detail || state.detailProjectId !== selectedId || state.detailSessionId !== ownerSessionId) return; var token = guardRef.current.beginAction(ownerSessionId, selectedId); if (!token) return; setState(function (old) { var actions = Object.assign({}, old.actions); actions[selectedId] = action; return Object.assign({}, old, { actions: actions }) }); modRequest(ownerSessionId, action, { project_id: selectedId, user_initiated: action === 'start' }).then(function () { return detail(selectedId, token) }).then(function (result) { if (!guardRef.current.finishAction(token, ownerRef.current)) return; setState(function (old) { var actions = Object.assign({}, old.actions); delete actions[selectedId]; if (!result || !result.value) return Object.assign({}, old, { detail: null, actions: actions, error: '读取 Mod 状态失败，请重试。', technicalError: result && result.error }); return Object.assign({}, old, { detail: result.value, actions: actions, error: '' }) }) }).catch(function (error) { if (guardRef.current.finishAction(token, ownerRef.current)) setState(function (old) { var actions = Object.assign({}, old.actions); delete actions[selectedId]; return Object.assign({}, old, { detail: null, actions: actions, error: 'Mod 操作结果未知，请重新读取状态。', technicalError: modError(error) }) }) }) }
      function detailFail(error) { if (ownerRef.current === ownerSessionId) setState(function (old) { return Object.assign({}, old, { error: modError(error) }) }) }
      var detailPending = state.actions[selectedId]
      var primary = controls.canStop ? React.createElement('button', { className: 'btn btn-danger btn-sm', type: 'button', disabled: !!detailPending, onClick: function () { act('stop') } }, detailPending ? '停止中' : '停止') : React.createElement('button', { className: 'btn btn-pri btn-sm', type: 'button', disabled: !controls.canStart || !!detailPending, onClick: function () { act('start') }, title: controls.canStart ? '' : '当前状态不能启动。' }, detailPending ? '启动中' : '启动')
      var actions = React.createElement('div', { className: 'mod-actions' }, primary, React.createElement('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick: function () { var id = project.maintainerSessionId || project.maintainer_session_id; if (!id) { detailFail(new Error('专属对话尚未就绪。')); return } var token = navigationRef.current.begin(id); Promise.resolve(sessions.open(id)).then(function () { if (navigationRef.current.current(token) && ownerRef.current === id) window.location.hash = '/chat' }).catch(detailFail) } }, '修改'), window.weftmateSurface && typeof window.weftmateSurface.openModWindow === 'function' ? React.createElement('button', { className: 'btn btn-sec btn-sm', type: 'button', disabled: !controls.canInvoke, title: controls.canInvoke ? '' : '当前 Mod 未提供可打开的独立窗口。', onClick: function () { window.weftmateSurface.openModWindow(selectedId, ownerSessionId).catch(detailFail) } }, '独立窗口') : React.createElement('button', { className: 'btn btn-sec btn-sm', type: 'button', disabled: true, title: '当前网页环境未提供独立窗口桥接。' }, '独立窗口'))
      var business = React.createElement(ModBusinessFrame, { detail: detailValue, projectId: selectedId, versionId: project.activeVersionId, enabled: controls.canInvoke === true, canStart: controls.canStart === true, onStart: function () { act('start') }, invoke: function (message, token) { return modRequest(ownerSessionId, 'invoke', { project_id: selectedId, frame_token: token, request: { action: message.action, payload: message.payload } }).then(function (value) { return value.result === undefined ? (value.value === undefined ? value : value.value) : value.result }) } })
      var errorView = state.error ? React.createElement('details', { className: 'mod-error' }, React.createElement('summary', null, state.error), React.createElement('pre', null, state.technicalError || '未提供技术详情')) : null
      var manifest = project.manifest || {}, requested = manifest.capabilities && [].concat(manifest.capabilities.required || [], manifest.capabilities.optional || []) || [], grants = Array.isArray(project.host_capability_grants) ? project.host_capability_grants : []
      var permissions = manifest.manifestVersion === 1 ? (requested.length ? requested.map(function (name) { return React.createElement('div', { className: 'set-row', key: name }, React.createElement('span', { className: 'sr-k' }, name), React.createElement('span', { className: 'sr-v' }, grants.indexOf(name) >= 0 ? '宿主已授权' : '未获宿主授权')) }) : React.createElement('p', null, '未声明额外能力。')) : React.createElement('p', null, '旧版兼容 Mod；能力声明不可用。')
      var facts = React.createElement('details', null, React.createElement('summary', null, '运行与版本摘要'), React.createElement('pre', null, JSON.stringify({ run: detailValue.run && detailValue.run.status, update: detailValue.update && detailValue.update.status, versions: Array.isArray(detailValue.versions) ? detailValue.versions.length : 0, recentError: detailValue.recentError || null }, null, 2)))
      var detailTone = status.tone === 'neutral' ? 'idle' : (status.tone || 'idle')
      return React.createElement('main', { className: 'page page-mod-detail on' }, React.createElement('div', { className: 'page-head' }, React.createElement('button', { className: 'backlink', type: 'button', onClick: function () { window.location.hash = '/mods' } }, '← Mods'), React.createElement('span', { className: 'badge ' + detailTone }, React.createElement('span', { className: 'p' }), status.label), React.createElement('div', { className: 'ph-act' }, actions)), React.createElement('div', { className: 'page-scroll' }, React.createElement('div', { className: 'page-body' }, React.createElement('div', { className: 'mod-hero' }, React.createElement('div', { className: 'mh-ic mi-blue' }, '模'), React.createElement('div', null, React.createElement('h2', null, project.name || shortModId(selectedId)), project.activeVersionId ? React.createElement('span', { className: 'mc-ver' }, shortModId(project.activeVersionId)) : null)), errorView, facts, React.createElement('div', { className: 'eyebrow' }, '实时预览'), business, React.createElement('div', { className: 'eyebrow' }, '设置'), React.createElement('div', { className: 'set-group' }, React.createElement('div', { className: 'set-row' }, React.createElement('div', null, React.createElement('div', { className: 'sr-k' }, '随 WeftMate 启动'), React.createElement('div', { className: 'sr-d' }, '当前未接入可写设置。'))), React.createElement('div', { className: 'set-row' }, React.createElement('div', null, React.createElement('div', { className: 'sr-k' }, '后台驻留'), React.createElement('div', { className: 'sr-d' }, '运行状态由当前 Mod 生命周期决定。')))), React.createElement('div', { className: 'eyebrow' }, '权限'), React.createElement('div', { className: 'set-group' }, permissions), React.createElement('div', { className: 'eyebrow' }, '危险区'), React.createElement('div', { className: 'card card-pad' }, React.createElement('span', null, '卸载和撤销接口尚未接入。'), React.createElement('button', { className: 'btn btn-danger btn-sm', type: 'button', disabled: true, title: '当前没有正式卸载或撤销接口。' }, '卸载 Mod')))))
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

    function deriveV2SessionGroups(sessionsState, workspaceState, modProjects) {
      var empty = { ready: false, mods: [], projects: [], recent: [] }
      if (!sessionsState || !workspaceState || sessionsState.phase !== 'ready' || workspaceState.phase !== 'ready') return empty
      var archived = new Set(workspaceState.archivedSessionIds || [])
      var byId = sessionsState.byId || {}, current = sessionsState.current, ids = sessionsState.ids || [], used = new Set()
      function visible(id) { return isSidebarVisibleSession(byId[id], archived, current) && !used.has(id) }
      function take(source) { return source.filter(visible).map(function (id) { used.add(id); return byId[id] }) }
      var all = ids.filter(function (id) { return isSidebarVisibleSession(byId[id], archived, current) })
      var explicitMods = (Array.isArray(modProjects) ? modProjects : []).map(function (project, index) {
        var maintainerSessionId = project && (project.maintainerSessionId || project.maintainer_session_id)
        var projectId = project && (project.projectId || project.project_id || project.id) || String(index)
        return { key: 'mod:' + projectId, projectId: projectId, maintainerSessionId: maintainerSessionId || null, label: project && project.name || '未命名 Mod', sessions: maintainerSessionId ? take([maintainerSessionId]) : [] }
      })
      var fallbackMods = take(all.filter(function (id) { return byId[id].agentPreset === 'mod-maintainer' }))
      // A preset-only session is not evidence of a Mod project.  Keep it in a
      // separate fallback group so the sidebar never pretends it can manage a
      // concrete Mod before the host has bound one.
      if (fallbackMods.length) explicitMods.push({ key: 'mod:fallback', projectId: null, maintainerSessionId: null, label: '维护会话', sessions: fallbackMods })
      var projects = (workspaceState.items || []).filter(function (workspace) {
        return !/[\\/]mod-projects[\\/]projects[\\/]/i.test(workspace && workspace.path || '')
      }).map(function (workspace) { return { workspace: workspace, sessions: take((workspace.sessionIds || []).filter(function (id) { return byId[id] && byId[id].agentPreset !== 'mod-maintainer' })) } })
      var recent = take(all.slice().sort(function (a, b) { return Number(byId[b].updatedAt || 0) - Number(byId[a].updatedAt || 0) }))
      return { ready: true, mods: explicitMods, projects: projects, recent: recent }
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
      var modRelationState = React.useState({ sessionId: null, projects: [], error: '' }), modRelation = modRelationState[0], setModRelation = modRelationState[1]
      React.useEffect(function () {
        var cancelled = false, controller = new AbortController(), sessionId = current
        if (!sessionId) { setModRelation({ sessionId: null, projects: [], error: '' }); return function () { cancelled = true; controller.abort() } }
        var maintenance = byId[sessionId] && byId[sessionId].agentPreset === 'mod-maintainer'
        function loadRelation(initial) { if (initial) setModRelation({ sessionId: sessionId, projects: [], error: '' }); return fetch('/weftmate/mods/projects.json?session_id=' + encodeURIComponent(sessionId), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal })
          .then(function (response) { if (!response.ok) throw new Error('MODS_LIST_HTTP_' + response.status); return response.json() })
          .then(function (value) { if (!cancelled) setModRelation({ sessionId: sessionId, projects: Array.isArray(value.projects) ? value.projects : [], error: '' }) })
          .catch(function (error) { if (!cancelled && error && error.name !== 'AbortError') setModRelation({ sessionId: sessionId, projects: [], error: 'Mod 关系读取失败。' }) })
        }
        loadRelation(true)
        // The host can bind a manually-created maintenance session after the
        // creation receipt.  Refresh only that active preset until navigation
        // tears it down, rather than displaying a made-up project relation.
        var timer = maintenance ? setInterval(function () { loadRelation(false) }, 2000) : null
        return function () { cancelled = true; controller.abort(); if (timer) clearInterval(timer) }
      }, [current, sessionsState && sessionsState.byId && sessionsState.byId[current] && sessionsState.byId[current].agentPreset])
      var projection = deriveV2SessionGroups(sessionsState, workspaceState, modRelation.sessionId === current ? modRelation.projects : [])
      var ready = projection.ready, mods = projection.mods, projects = projection.projects, recent = projection.recent
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
      function startMaintainer() {
        run('正在创建 Mod 开发维护会话…', async function () {
          if (!props.sessions || typeof props.sessions.create !== 'function' || typeof props.sessions.open !== 'function') throw new Error('当前宿主没有可用的 Mod 维护会话入口。')
          var ordinary = (workspaceState.items || []).filter(function (item) { return !isMaintenanceWorkspace(item) })
          var currentWorkspace = ordinary.find(function (item) { return (item.sessionIds || []).indexOf(current) >= 0 })
          var recentWorkspace = ordinary.find(function (item) { return item.workspaceId === workspaceState.recentWorkspaceId })
          var targetWorkspace = currentWorkspace || recentWorkspace
          var options = {}
          // Before the host binds the session to its dedicated Mod workspace,
          // keep it out of another Mod's maintenance directory.  We never
          // create a regular session merely to obtain this workspace id.
          if (!targetWorkspace) throw new Error('请先创建或选择一个普通项目，再开始 Mod 开发维护。')
          options.workspaceId = targetWorkspace.workspaceId
          var api = props.connection && props.connection.api
          if (!api || !api.agentPresets || typeof api.agentPresets.select !== 'function') throw new Error('当前 DSH 连接未提供 Mod 维护预设选择接口。')
          // First use SessionRuntime.create so its list/binding projection is
          // hydrated.  The formal selector is permitted only on that blank
          // session and returns the host-confirmed preset.
          var sessionId = await props.sessions.create(options)
          if (typeof sessionId !== 'string' || !sessionId) throw new Error('维护会话创建未返回有效结果。')
          var selected = dshResultValue(await api.agentPresets.select({ sessionId: sessionId, agentPreset: 'mod-maintainer' }), 'agentPresets.select')
          if (!selected || selected.agentPreset !== 'mod-maintainer') throw new Error('宿主未确认 Mod 开发维护预设。')
          if (typeof props.sessions.noteAgentPreset === 'function') props.sessions.noteAgentPreset(sessionId, selected.agentPreset)
          await props.sessions.open(sessionId)
          await waitForSidebarSnapshot(props.sessions.list, function (state) { var session = state.byId && state.byId[sessionId]; return !!session && session.agentPreset === 'mod-maintainer' })
        }, '已创建 Mod 开发维护会话。')
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
      function modIcon() { return React.createElement('svg', { className: 'node-symbol', viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, React.createElement('rect', { x: 4, y: 4, width: 7, height: 7, rx: 1.5 }), React.createElement('rect', { x: 13, y: 4, width: 7, height: 7, rx: 1.5 }), React.createElement('rect', { x: 4, y: 13, width: 7, height: 7, rx: 1.5 }), React.createElement('rect', { x: 13, y: 13, width: 7, height: 7, rx: 1.5 })) }
      function renderGroup(key, label, members, workspace, kind, modGroup) {
        var closed = collapsed.has(key)
        if (renaming && renaming.kind === 'workspace' && workspace && renaming.id === workspace.workspaceId) return React.createElement('div', { key: key, className: 'sess-node l2' }, renderRename(renaming))
        var workspacePinned = workspace && pinnedWorkspaces.has(workspace.workspaceId)
        var modActions = kind === 'mod' && modGroup && modGroup.projectId ? React.createElement('span', { className: 'acts' }, React.createElement('button', { className: 'mini', type: 'button', title: '进入维护会话', 'aria-label': '进入 Mod 维护会话', disabled: !modGroup.maintainerSessionId || busy, onClick: function (event) { event.preventDefault(); event.stopPropagation(); open(modGroup.maintainerSessionId) }, onKeyDown: function (event) { event.stopPropagation() } }, '↗'), React.createElement('button', { className: 'mini', type: 'button', title: '打开 Mod 管理', 'aria-label': '打开 Mod 管理', onClick: function (event) { event.preventDefault(); event.stopPropagation(); window.location.hash = '/mods' }, onKeyDown: function (event) { event.stopPropagation() } }, '⋯')) : null
        return React.createElement(React.Fragment, { key: key }, React.createElement('div', { className: 'sess-node l2' + (closed ? ' closed' : ''), role: 'button', tabIndex: 0, onClick: function () { toggleCollapsed(key) }, onKeyDown: function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCollapsed(key) } else if (event.key === 'ContextMenu' && workspace) { menuAt(event, { kind: 'workspace', id: workspace.workspaceId, title: workspace.title || workspace.path || workspace.workspaceId }) } }, onContextMenu: workspace ? function (event) { menuAt(event, { kind: 'workspace', id: workspace.workspaceId, title: workspace.title || workspace.path || workspace.workspaceId }) } : undefined }, chevron(closed), workspace ? folderIcon(closed) : kind === 'mod' ? modIcon() : null, React.createElement('span', { className: 't' }, label), workspacePinned ? pinIcon('项目已置顶') : null, workspace ? React.createElement('span', { className: 'acts' }, React.createElement('button', { className: 'mini', type: 'button', title: '在此新建对话', 'aria-label': '在项目中新建会话', onClick: function (event) { event.stopPropagation(); start(workspace.workspaceId) }, onKeyDown: function (event) { event.stopPropagation() } }, '＋'), React.createElement('button', { className: 'mini', type: 'button', 'aria-label': '项目菜单', onClick: function (event) { menuAt(event, { kind: 'workspace', id: workspace.workspaceId, title: workspace.title || workspace.path || workspace.workspaceId }) }, onKeyDown: function (event) { event.stopPropagation() } }, '⋯')) : modActions), React.createElement('div', { className: 'sess-sub' + (closed ? ' hide' : '') }, members.length ? members.slice().sort(function (a, b) { return (pinned.has(b.id) ? 1 : 0) - (pinned.has(a.id) ? 1 : 0) }).map(function (session) { return renderSession(session, workspace && workspace.workspaceId) }) : React.createElement('div', { className: 'sess-empty' }, workspace ? '尚无对话，悬停点 ＋ 新建' : kind === 'mod' && modGroup && modGroup.projectId ? '维护会话尚未就绪，请在 Mods 管理中查看。' : '暂无会话')))
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
      roots.push(renderRoot('mods', 'Mod', mods.length ? mods.map(function (group) { return renderGroup(group.key, group.label, group.sessions, undefined, 'mod', group) }) : React.createElement('div', { className: 'sess-empty' }, '尚无 Mod，点 ＋ 开始维护。'), { title: '创建 Mod 开发维护会话', label: '创建 Mod 开发维护会话', run: startMaintainer }))
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
    function isMaintenanceWorkspace(workspace) { return /[\\/]mod-projects[\\/]projects[\\/]/i.test(workspace && workspace.path || '') }
    function trustedPersonalWorkspacePath(status) {
      var path = status && status.dataDirs && status.dataDirs.workspace
      if (typeof path !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/)/.test(path)) return null
      return path
    }
    async function startWorkspaceSession(workspaces, sessions, explicitWorkspaceId) {
      if (!workspaces || !sessions || typeof workspaces.connectWorkspace !== 'function' || typeof sessions.open !== 'function') throw new Error('当前宿主没有可用的工作区会话接口。')
      var snapshot = workspaces.list && workspaces.list.getSnapshot ? workspaces.list.getSnapshot() : null
      var current = sessions.list && sessions.list.getSnapshot ? sessions.list.getSnapshot().current : null
      var ordinaryItems = snapshot && Array.isArray(snapshot.items) ? snapshot.items.filter(function (item) { return !isMaintenanceWorkspace(item) }) : []
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
      function isManagedMaintainer(preset) { return preset && preset.id === 'mod-maintainer' }
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
        if (!target || target.broken || isManagedMaintainer(target)) { showFeedback('内部 Mod 维护预设不能作为普通对话默认模式。'); return }
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
      var healthState = React.useState({}), health = healthState[0], setHealth = healthState[1]

      React.useEffect(function () {
        pollPerception(setPerception)
        fetchAvailableJson('/weftmate/status.json', setStatus)
        fetchAvailableJson('/weftmate/memory/health.json', setHealth)
        var timer = setInterval(function () {
          pollPerception(setPerception)
          fetchAvailableJson('/weftmate/status.json', setStatus)
          fetchAvailableJson('/weftmate/memory/health.json', setHealth)
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
                  value: (presets.find(function (p) { return p.isDefault && !isManagedMaintainer(p) }) || presets.find(function (p) { return !isManagedMaintainer(p) }) || {}).id || '',
                  disabled: presets.filter(function (p) { return !isManagedMaintainer(p) }).length === 0,
                  onChange: function (e) { setDefaultPreset(e.target.value) }
                },
                  presets.filter(function (p) { return !isManagedMaintainer(p) }).map(function (p) {
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

          React.createElement('div', { className: 'set-group', key: 'mods' },
            React.createElement('div', { className: 'sg-title' }, 'Mods'),
            React.createElement('div', { className: 'set-row' },
              React.createElement('div', null,
                React.createElement('div', { className: 'sr-k' }, '允许 Mod 独立成窗'),
                React.createElement('div', { className: 'sr-d' }, '当前宿主未提供全局开关；请在已选 Mod 的详情中按真实能力打开。')
              ),
              React.createElement('div', { className: 'sr-act' },
                React.createElement('button', {
                  className: 'toggle',
                  type: 'button',
                  'aria-label': '允许 Mod 独立成窗',
                  disabled: true,
                  title: '当前宿主没有独立窗口全局设置接口。'
                })
              )
            ),
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
                    var isMaintainer = isManagedMaintainer(preset)
                    var icon = isSystem ? '⚡' : '✦'
                    return React.createElement('div', { className: 'preset-card' + (preset.isDefault ? ' default' : ''), key: preset.id },
                      React.createElement('div', { className: 'psc-top' },
                        React.createElement('div', { className: 'psc-brand' },
                          React.createElement('span', { className: 'preset-icon' }, icon),
                          React.createElement('span', { className: 'preset-title' }, preset.name),
                          preset.isDefault ? React.createElement('span', { className: 'preset-badge' }, '当前默认') : (isSystem ? React.createElement('span', { className: 'protocol-badge', style: { marginLeft: '6px' } }, 'DSH 内置') : React.createElement('span', { className: 'protocol-badge', style: { marginLeft: '6px' } }, '自定义'))
                        ),
                        React.createElement('div', { className: 'psc-actions' },
                          !preset.isDefault && !isMaintainer ? React.createElement('button', {
                            className: 'btn btn-sec btn-sm',
                            type: 'button',
                            onClick: function () { setDefaultPreset(preset.id) }
                          }, '设为默认') : null,
                          React.createElement('button', {
                            className: 'btn btn-ghost btn-sm',
                            type: 'button',
                            onClick: function () { viewPresetComposition(preset) }
                          }, '查看组装'),
                          !isMaintainer ? React.createElement('button', {
                            className: 'btn btn-ghost btn-sm',
                            type: 'button',
                            onClick: function () { startDuplicatePreset(preset) }
                          }, isSystem ? '复制到本地' : '复制') : null,
                          !isSystem && !isMaintainer ? React.createElement('button', {
                            className: 'btn btn-ghost btn-sm',
                            type: 'button',
                            onClick: function () { openPresetFolder(preset.id) }
                          }, '打开目录') : null,
                          (!preset.isDefault && !isSystem && !isMaintainer) ? React.createElement('button', {
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
                        React.createElement('span', { className: 'psc-tag sub' }, isMaintainer ? '宿主管理 · 仅用于 Mod 维护' : (isSystem ? '只读系统预设' : '本地工程 (.agent-presets/' + preset.id + ')'))
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
                      React.createElement('div', null,
                        React.createElement('div', { className: 'sr-k' }, '允许 Mod 独立成窗'),
                        React.createElement('div', { className: 'sr-d' }, '当前宿主未提供全局开关；请在已选 Mod 的详情中按真实能力打开。')
                      ),
                      React.createElement('div', { className: 'sr-act' },
                        React.createElement('button', {
                          className: 'toggle',
                          type: 'button',
                          'aria-label': '允许 Mod 独立成窗',
                          disabled: true,
                          title: '当前宿主没有独立窗口全局设置接口。'
                        })
                      )
                    ),
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

    function V2MemoryWorkspace(props) {
      var worldState = React.useState({})
      var world = worldState[0], setWorld = worldState[1]
      var worldLoadState = React.useState({ phase: 'loading', error: null })
      var worldLoad = worldLoadState[0], setWorldLoad = worldLoadState[1]
      var healthState = React.useState({ ready: false, protocolVersion: null })
      var health = healthState[0], setHealth = healthState[1]
      var jobsState = React.useState(null)
      var jobs = jobsState[0], setJobs = jobsState[1]
      var hostState = React.useState({})
      var host = hostState[0], setHost = hostState[1]
      var searchState = React.useState(''), search = searchState[0], setSearch = searchState[1]
      var resultState = React.useState(null), result = resultState[0], setResult = resultState[1]
      var busyState = React.useState(false), busy = busyState[0], setBusy = busyState[1]
      var activeProvState = React.useState(null), activeProv = activeProvState[0], setActiveProv = activeProvState[1]
      var actionMsgState = React.useState(''), actionMsg = actionMsgState[0], setActionMsg = actionMsgState[1]
      var editingCogState = React.useState(null), editingCog = editingCogState[0], setEditingCog = editingCogState[1]
      var editTextState = React.useState(''), editText = editTextState[0], setEditText = editTextState[1]
      var editBusyState = React.useState(false), editBusy = editBusyState[0], setEditBusy = editBusyState[1]
      var commandIdsRef = React.useRef({})

      function stableCommandId(key) {
        if (commandIdsRef.current[key]) return commandIdsRef.current[key]
        var id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('wm-command-' + Date.now() + '-' + Math.random().toString(36).slice(2))
        commandIdsRef.current[key] = id
        return id
      }

      function readJsonOrThrow(response, label) {
        if (!response) return Promise.reject(new Error(label + ' 请求失败（网络错误）'))
        return response.json().then(function (data) {
          // Mutations intentionally return a durable receipt even when a
          // revision conflict/rejection uses HTTP 409.  Preserve it so the UI
          // can distinguish a rejected command from a transport failure.
          if (!response.ok && !(data && data.receipt && data.receipt.result_state)) throw new Error(label + ' 请求失败（HTTP ' + response.status + '）')
          return data
        }).catch(function (error) {
          if (error && error.message) throw error
          throw new Error(label + ' 返回了无效数据')
        })
      }

      async function submitMemoryCommand(key, command) {
        var complete = commandIdsRef.current[key]
        if (!complete) {
          var subjectId = world && world.subject_id
          var revision = world && world.world_revision
          if (typeof subjectId !== 'string' || !subjectId || !Number.isInteger(revision)) throw new Error('记忆状态尚未读取，无法提交修改。')
          complete = {
            schema_version: 1,
            command_id: stableCommandId(key),
            subject_id: subjectId,
            actor: 'weftmate-ui',
            expected_world_revision: revision,
            operation: command.operation,
            target_kind: command.target_kind,
            target_id: command.target_id,
            payload: command.payload || {},
            submitted_at: new Date().toISOString()
          }
          commandIdsRef.current[key] = complete
        }
        var response = await fetch('/weftmate/memory/command.json', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: complete })
        })
        var data = await readJsonOrThrow(response, '记忆操作')
        var state = data && data.receipt && data.receipt.result_state
        if (['applied', 'no_change', 'revision_conflict', 'rejected'].indexOf(state) < 0) throw new Error((data && data.error) || '记忆操作没有有效回执')
        delete commandIdsRef.current[key]
        return { data: data, state: state }
      }

      function startEdit(cog) {
        setEditingCog(cog)
        setEditText(cog.content || cog.text || '')
      }

      function cancelEdit() {
        setEditingCog(null)
        setEditText('')
      }

      async function doSaveEdit(cog) {
        if (!cog || !cog.id) return
        var newText = editText.trim()
        if (!newText) {
          alert('修改内容不能为空')
          return
        }
        var oldText = (cog.content || cog.text || '').trim()
        if (newText === oldText) {
          setEditingCog(null)
          return
        }
        setEditBusy(true)
        setActionMsg('正在保存理解修改…')
        try {
          var outcome = await submitMemoryCommand('correct:' + cog.id + ':' + newText, {
            operation: 'correct_world_item', target_kind: 'cognition', target_id: cog.id,
            payload: { correction_text: newText },
            expected_world_revision: (world && typeof world.world_revision === 'number') ? world.world_revision : undefined
          })
          setEditBusy(false)
          if (outcome.state === 'applied') { setActionMsg('理解已更新（已应用）'); setEditingCog(null); refreshWorld() }
          else if (outcome.state === 'no_change') { setActionMsg('理解未变化（无需重复保存）'); setEditingCog(null); refreshWorld() }
          else if (outcome.state === 'revision_conflict') { setActionMsg('保存冲突：请刷新后基于最新内容重试。'); refreshWorld() }
          else setActionMsg('保存被拒绝：' + ((outcome.data.receipt && outcome.data.receipt.reason) || '宿主未接受该修改'))
        } catch (error) {
          setEditBusy(false)
          setActionMsg('保存未确认：' + errorText(error) + '。可重试，系统会复用同一命令标识。')
        }
      }

      function refreshWorld() {
        setWorldLoad({ phase: 'loading', error: null })
        fetch('/weftmate/memory/world.json', { cache: 'no-store' })
          .then(function (response) { return readJsonOrThrow(response, '读取记忆') })
          .then(function (data) { setWorld(data); setWorldLoad({ phase: 'ready', error: null }) })
          .catch(function (error) { setWorld({}); setWorldLoad({ phase: 'error', error: errorText(error) }) })
      }

      React.useEffect(function () {
        refreshWorld()
        fetchAvailableJson('/weftmate/status.json', setHost)
        fetchAvailableJson('/weftmate/memory/health.json', setHealth)
        fetchAvailableJson('/weftmate/memory/jobs.json', setJobs)
        var timer = setInterval(function () {
          refreshWorld()
          fetchAvailableJson('/weftmate/status.json', setHost)
          fetchAvailableJson('/weftmate/memory/health.json', setHealth)
          fetchAvailableJson('/weftmate/memory/jobs.json', setJobs)
        }, 15000)
        if (timer && typeof timer.unref === 'function') timer.unref()
        return function () { clearInterval(timer) }
      }, [])

      var memoryPhase = worldLoad.phase === 'loading' || host.available === undefined || health.available === undefined ? 'loading' : (worldLoad.phase === 'error' || host.available === false || health.available === false ? 'error' : 'ready')
      var connection = deriveMemoryUiSummary(host, health, world, jobs, memoryPhase)

      function doSearch() {
        if (!search.trim() || busy) return
        setBusy(true)
        fetch('/weftmate/memory/search.json?q=' + encodeURIComponent(search.trim()))
          .then(function (response) { return readJsonOrThrow(response, '检索记忆') })
          .then(function (data) { setResult({ data: data, error: null }); setBusy(false) })
          .catch(function (error) { setResult({ data: null, error: errorText(error) }); setBusy(false) })
      }

      function doExport() {
        fetch('/weftmate/memory/export.json', { cache: 'no-store' })
          .then(function (response) { return readJsonOrThrow(response, '导出记忆') })
          .then(function (data) {
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            var url = URL.createObjectURL(blob)
            var a = document.createElement('a')
            a.href = url
            a.download = 'weftmate-memory-export.json'
            a.click()
            URL.revokeObjectURL(url)
          })
          .catch(function (error) { setActionMsg('导出失败：' + errorText(error)) })
      }

      function viewProvenance(cog) {
        if (!cog || !cog.id) return
        fetch('/weftmate/memory/provenance.json?object_kind=cognition&item_id=' + encodeURIComponent(cog.id))
          .then(function (response) { return readJsonOrThrow(response, '读取来源依据') })
          .then(function (data) {
            setActiveProv({ cog: cog, data: data, error: null })
          })
          .catch(function (error) {
            setActiveProv({ cog: cog, data: null, error: errorText(error) })
          })
      }

      async function doRetract(cog) {
        if (!cog || !cog.id) return
        var title = cog.content || cog.text || '此条记忆'
        if (!window.confirm('确定要停用此条认知记忆吗？\n\n「' + title + '」\n\n停用后后续对话将不再自动召回此条目。')) return
        try {
          var outcome = await submitMemoryCommand('retract:' + cog.id, {
            operation: 'retract_world_item', target_kind: 'cognition', target_id: cog.id,
            expected_world_revision: (world && typeof world.world_revision === 'number') ? world.world_revision : undefined
          })
          if (outcome.state === 'applied') { setActionMsg('记忆已停用（已应用）'); refreshWorld() }
          else if (outcome.state === 'no_change') { setActionMsg('记忆原本已停用（无需重复操作）'); refreshWorld() }
          else if (outcome.state === 'revision_conflict') { setActionMsg('停用冲突：请刷新后重试。'); refreshWorld() }
          else setActionMsg('停用被拒绝：' + ((outcome.data.receipt && outcome.data.receipt.reason) || '宿主未接受该操作'))
        } catch (error) {
          setActionMsg('停用未确认：' + errorText(error) + '。可重试，系统会复用同一命令标识。')
        }
      }

      function formatTag(cog) {
        var k = cog.content_type || cog.sourceKind
        if (k === 'preference') return '偏好'
        if (k === 'attribute') return '特征'
        if (k === 'fact') return '事实'
        if (k === 'event') return '经历'
        return k || '理解'
      }

      var cognitions = (world && Array.isArray(world.cognitions)) ? world.cognitions : []
      var entities = (world && Array.isArray(world.entities)) ? world.entities : []
      var relationships = (world && Array.isArray(world.relationships)) ? world.relationships : []
      var events = (world && Array.isArray(world.events)) ? world.events : []
      var isReady = connection.ready === true || (health && health.ready === true)
      var hasRealWorld = cognitions.length > 0 || entities.length > 0
      var jobSummary = (function () {
        var rows = jobs && jobs.available === true && Array.isArray(jobs.jobs) ? jobs.jobs : []
        var pending = rows.filter(function (job) { return job && job.worker && ['pending', 'retry'].indexOf(job.worker.state) >= 0 }).length
        var processing = rows.filter(function (job) { return job && job.worker && job.worker.state === 'processing' }).length
        var failed = rows.filter(function (job) { return job && job.worker && ['dead', 'failed'].indexOf(job.worker.state) >= 0 }).length
        if (processing) return '原话已接收，正在形成长期理解。'
        if (pending) return '原话已接收，等待后台形成长期理解。'
        if (failed) return '部分原话暂未形成理解；原话仍被保留。'
        return ''
      })()

      var filterQuery = search.trim().toLowerCase()
      var displayedCognitions = cognitions.filter(function (cog) {
        if (!filterQuery) return true
        var txt = (cog.content || cog.text || '').toLowerCase()
        var tag = formatTag(cog).toLowerCase()
        return txt.indexOf(filterQuery) >= 0 || tag.indexOf(filterQuery) >= 0
      })

      return React.createElement('div', { className: 'weftmate-v2-page-inner' },
        React.createElement('div', { className: 'page-head' },
          React.createElement('span', { className: 'ph-title' }, '记忆'),
          React.createElement('span', { className: 'ph-sub' }, '这里展示可追溯、可纠正的长期理解与来源 · ' + connection.label + ' · ' + connection.detail),
          React.createElement('div', { className: 'ph-act' },
            React.createElement('input', {
              className: 'input',
              id: 'memSearch',
              style: { width: '200px' },
              value: search,
              placeholder: '检索记忆…',
              'aria-label': '检索记忆',
              onChange: function (e) { var next = e.target.value; setSearch(next); if (!next.trim()) setResult(null) },
              onKeyDown: function (e) { if (e.key === 'Enter') doSearch() }
            }),
            React.createElement('button', { className: 'btn btn-primary btn-sm', type: 'button', disabled: busy || !search.trim(), onClick: doSearch }, busy ? '检索中…' : '检索'),
            React.createElement('button', {
              className: 'btn btn-sec btn-sm',
              id: 'memExportBtn',
              type: 'button',
              onClick: doExport
            }, '导出备份')
          )
        ),
        React.createElement('div', { className: 'page-scroll' },
          React.createElement('div', { className: 'page-body' },
            React.createElement('div', { className: 'sr-d', style: { marginBottom: '10px' } }, '输入后按 Enter 或点击“检索”；页面筛选与后台记忆检索会分别显示结果。'),
            actionMsg ? React.createElement('div', { style: { padding: '8px 16px', background: 'var(--weftmate-accent-soft)', color: 'var(--weftmate-accent)', fontSize: '12px', borderRadius: '8px', marginBottom: '12px' } }, actionMsg) : null,
            result !== null ? React.createElement('div', { className: 'set-group', style: { padding: '12px 16px', marginBottom: '14px' } },
              React.createElement('div', { className: 'sg-title', style: { padding: 0, marginBottom: '6px' } }, '检索结果'),
              React.createElement('div', { style: { fontSize: '13px', color: 'var(--weftmate-ink-1)' } },
                result.error ? ('检索失败：' + result.error) : ((result.data && typeof result.data.text === 'string' && result.data.text.trim()) ? result.data.text : (result.data && result.data.count === 0 ? '没有命中的记忆（未找到）' : '查询已完成'))
              )
            ) : null,
            React.createElement('div', { className: 'set-group', 'aria-label': '记忆历史与处理' },
              React.createElement('div', { className: 'sg-title' }, '历史、来源与处理'),
              React.createElement('div', { className: 'set-row' }, React.createElement(MemoryInteractions)),
              React.createElement('div', { className: 'set-row' }, React.createElement('details', null, React.createElement('summary', { style: { cursor: 'pointer' } }, '来源与处理进度'), React.createElement(MemoryProcessing, { health: health }))),
              React.createElement('div', { className: 'set-row' }, React.createElement(MemoryAdoptions))
            ),
            hasRealWorld ? React.createElement(React.Fragment, null,
              displayedCognitions.length > 0 ? React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'eyebrow' }, '当前理解 · ' + displayedCognitions.length + ' 条'),
                displayedCognitions.map(function (cog, idx) {
                  var isEditing = editingCog && editingCog.id === cog.id
                  return React.createElement('div', { className: 'mem-card', key: 'cog-' + idx },
                    isEditing ? React.createElement('div', { style: { marginBottom: '8px' } },
                      React.createElement('textarea', {
                        className: 'input',
                        style: { width: '100%', minHeight: '64px', fontSize: '13px', lineHeight: 1.5, padding: '8px 10px', resize: 'vertical' },
                        value: editText,
                        disabled: editBusy,
                        placeholder: '直接修改 Agent 对你的这条理解…',
                        'aria-label': '修改记忆理解',
                        onChange: function (e) { setEditText(e.target.value) },
                        onKeyDown: function (e) {
                          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            doSaveEdit(cog)
                          }
                        }
                      }),
                      React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center' } },
                        React.createElement('button', {
                          className: 'btn btn-pri btn-sm',
                          type: 'button',
                          disabled: editBusy || !editText.trim(),
                          onClick: function () { doSaveEdit(cog) }
                        }, editBusy ? '保存中…' : '保存修改'),
                        React.createElement('button', {
                          className: 'btn btn-ghost btn-sm',
                          type: 'button',
                          disabled: editBusy,
                          onClick: cancelEdit
                        }, '取消'),
                        React.createElement('span', { style: { fontSize: '11px', color: 'var(--weftmate-ink-3)', marginLeft: 'auto' } }, 'Ctrl+Enter 保存')
                      )
                    ) : React.createElement('div', { className: 'mc-rel', style: { cursor: 'pointer' }, title: '点击可直接修改此理解', onClick: function () { startEdit(cog) } }, cog.content || cog.text || '（无内容）'),
                    React.createElement('div', { className: 'mc-src' },
                      React.createElement('span', { className: 'src-tag' }, formatTag(cog)),
                      React.createElement('span', null, cog.formed_by === 'stated' ? '对话原话提取' : (cog.time || cog.updated_at || '最近')),
                      !isEditing ? React.createElement('button', {
                        className: 'btn btn-ghost btn-sm',
                        style: { marginLeft: 'auto', padding: '1px 7px', fontSize: '11px', height: '22px', color: 'var(--weftmate-accent)' },
                        type: 'button',
                        onClick: function () { startEdit(cog) }
                      }, '修改') : null,
                      React.createElement('button', {
                        className: 'btn btn-ghost btn-sm',
                        style: { marginLeft: isEditing ? 'auto' : undefined, padding: '1px 7px', fontSize: '11px', height: '22px' },
                        type: 'button',
                        onClick: function () { viewProvenance(cog) }
                      }, '来源依据'),
                      React.createElement('button', {
                        className: 'btn btn-sec btn-sm',
                        style: { padding: '1px 7px', fontSize: '11px', height: '22px', color: 'var(--weftmate-ink-2)' },
                        type: 'button',
                        onClick: function () { doRetract(cog) }
                      }, '停用')
                    )
                  )
                })
              ) : (filterQuery ? React.createElement('div', { className: 'mem-card', role: 'status' }, React.createElement('div', { className: 'mc-rel' }, '当前理解中没有匹配项'), React.createElement('div', { className: 'mc-src' }, '可点击上方“检索”继续查询完整记忆记录。')) : null),
              entities.length > 0 ? React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'eyebrow' }, '相关人物与事物 · ' + entities.length + ' 条'),
                entities.map(function (ent, idx) {
                  return React.createElement('div', { className: 'mem-card', key: 'ent-' + idx },
                    React.createElement('div', { className: 'mc-rel' }, ent.canonical_name || ent.name || '（未命名）'),
                    React.createElement('div', { className: 'mc-src' },
                      React.createElement('span', { className: 'src-tag' }, '实体'),
                      React.createElement('span', null, ent.category || '概念')
                    )
                  )
                })
              ) : null,
              relationships.length > 0 ? React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'eyebrow' }, '关系理解 · ' + relationships.length + ' 条'),
                relationships.map(function (item) { return React.createElement(MemoryItem, { key: item.id, kind: 'relationship', item: item, onRefresh: refreshWorld, onResult: setActionMsg }) })
              ) : null,
              events.length > 0 ? React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'eyebrow' }, '经历与事件 · ' + events.length + ' 条'),
                events.map(function (item) { return React.createElement(MemoryItem, { key: item.id, kind: 'event', item: item, onRefresh: refreshWorld, onResult: setActionMsg }) })
              ) : null
            ) : React.createElement('div', { className: 'mem-card', role: 'status' },
              React.createElement('div', { className: 'mc-rel' }, worldLoad.phase === 'loading' ? '正在读取真实记忆记录…' : (worldLoad.phase === 'error' ? '记忆暂不可用' : '尚无记忆记录')),
              React.createElement('div', { className: 'mc-src' }, worldLoad.phase === 'error' ? ('读取失败：' + worldLoad.error) : (worldLoad.phase === 'ready' ? (jobSummary || '真实存储当前返回 0 条记录。') : ''))
            )
          )
        ),
        activeProv ? React.createElement('div', { className: 'weftmate-modal-overlay', onClick: function () { setActiveProv(null) } },
          React.createElement('div', { className: 'weftmate-modal-panel', style: { maxWidth: '540px' }, onClick: function (e) { e.stopPropagation() } },
            React.createElement('div', { className: 'wmp-head' },
              React.createElement('span', { className: 'wmp-title' }, '记忆来源依据 (Evidence)'),
              React.createElement('button', { className: 'icon-btn', type: 'button', onClick: function () { setActiveProv(null) } }, '✕')
            ),
            React.createElement('div', { className: 'wmp-body' },
              React.createElement('div', { className: 'fc-label', style: { marginBottom: '4px' } }, '沉淀认知'),
              React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '16px', color: 'var(--weftmate-ink-1)' } }, activeProv.cog.content || activeProv.cog.text),
              React.createElement('div', { className: 'fc-label', style: { marginBottom: '6px' } }, '对话原始依据'),
              (activeProv.data && activeProv.data.provenance && activeProv.data.provenance.length > 0)
                ? activeProv.data.provenance.map(function (p, pIdx) {
                    var ev = p.evidence || {}
                    return React.createElement('div', { key: 'ev-' + pIdx, style: { background: 'var(--weftmate-surface-2, rgba(0,0,0,0.03))', border: '1px solid var(--weftmate-hairline)', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px' } },
                      React.createElement('div', { style: { fontSize: '12.5px', lineHeight: 1.55, color: 'var(--weftmate-ink-1)' } }, '“' + (ev.raw_content || ev.summary || '（对话记录）') + '”'),
                      React.createElement('div', { style: { fontSize: '11px', color: 'var(--weftmate-ink-3)', marginTop: '6px', display: 'flex', gap: '8px' } },
                        React.createElement('span', null, '来源: ' + (ev.source_kind === 'spoken' ? '对话' : (ev.source_kind || '对话'))),
                        React.createElement('span', null, '时间: ' + (ev.occurred_at ? new Date(ev.occurred_at).toLocaleString() : ''))
                      )
                    )
                  })
                : React.createElement('div', { style: { fontSize: '12px', color: 'var(--weftmate-ink-3)' } }, activeProv.error ? ('读取来源依据失败：' + activeProv.error) : '暂无原始对话证据记录。')
            ),
            React.createElement('div', { className: 'wmp-foot' },
              React.createElement('button', { className: 'btn btn-sec btn-sm', type: 'button', onClick: function () { setActiveProv(null) } }, '关闭')
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
      var memory = props.memorySummary || { state: 'connecting', label: '连接中', detail: '正在读取记忆服务状态。', count: null }
      var modProjects = Array.isArray(props.modProjects) ? props.modProjects : []
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
        workButton('◇', 'Mods', modProjects.length ? ('当前可访问 ' + modProjects.length + ' 个') : '查看和管理本机会话能力', function () { goto('#/mods') }, 'mods'),
        workButton('记', '记忆', memory.label + ' · ' + memory.detail, function () { goto('#/memory') }, 'memory'),
        React.createElement('div', { className: 'wc-eyebrow' }, '进行中'),
        currentSession ? React.createElement('div', { className: 'wc-card wc-current' },
          React.createElement('div', { className: 'wc-head' }, React.createElement('span', { className: 'wc-title' }, sessionTitle || '当前会话'), React.createElement('span', { className: 'badge ' + (isRunning ? 'warn' : 'idle'), style: { marginLeft: 'auto' } }, isRunning ? '运行中' : '空闲')),
          React.createElement('div', { className: 'wc-desc' }, isRunning ? '当前会话正在处理任务，可在这里停止。' : '当前没有正在运行的任务。'),
          isRunning ? React.createElement('div', { className: 'wc-foot' }, React.createElement('span', null, '等待会话状态回显'), React.createElement('button', { className: 'btn btn-ghost btn-sm', id: 'wcMemoStop', type: 'button', style: { marginLeft: 'auto' }, onClick: stopCurrentTurn }, '停止')) : null
        ) : React.createElement('div', { className: 'wc-empty' }, '选择或新建会话后，这里会显示真实运行状态。'),
        React.createElement('div', { className: 'wc-eyebrow' }, '上下文'),
        React.createElement('button', { className: 'wc-row clickable wc-context', type: 'button', onClick: function () { goto('#/memory') } }, React.createElement('span', { className: 'wc-ic memory-' + memory.state }, '记'), React.createElement('span', { className: 'wc-copy' }, React.createElement('span', { className: 't' }, '长期记忆 · ' + memory.label), React.createElement('span', { className: 'wc-mini' }, memory.detail)), memory.count === null ? null : React.createElement('span', { className: 'd' }, String(memory.count))),
        React.createElement('div', { className: 'wc-eyebrow' }, '可用 Mod'),
        modProjects.length ? modProjects.slice(0, 5).map(function (project, index) { var name = project && project.name || '未命名 Mod'; var state = project && (project.desiredState || project.desired_state || project.status); return workButton('◇', name, state === 'running' ? '正在运行' : '可在 Mods 页查看', function () { goto('#/mods') }, 'mod-' + (project.projectId || project.project_id || index)) }) : React.createElement('div', { className: 'wc-empty' }, '当前会话没有可访问的 Mod。可前往 Mods 页创建或查看。'),
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
        { g: '页面', ic: '◇', t: 'Mods', fn: function () { props.onNavigate('mods') } },
        { g: '页面', ic: '记', t: '记忆', fn: function () { props.onNavigate('memory') } },
        { g: '页面', ic: '设', t: '设置', fn: function () { props.onNavigate('settings') } },
        { g: '页面', ic: '模', t: '设置: 模型服务', fn: function () { props.onNavigate('settings', 'models') } },
        { g: '页面', ic: '预', t: '设置: 智能体预设', fn: function () { props.onNavigate('settings', 'presets') } },
        { g: '操作', ic: '＋', t: '新会话', fn: async function () { await props.startSession(); props.onNavigate('chat') } },
        { g: '操作', ic: '◧', t: '切换会话栏', fn: function () { document.documentElement.toggleAttribute('data-weftmate-v2-sessions-hidden') } },
        { g: '操作', ic: '◨', t: '切换工作台栏', fn: toggleV2Workbench },
        { g: '操作', ic: '窗', t: '选择 Mod 后打开独立窗口', fn: function () { props.onNavigate('mods') } },
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
      var modProjectsState = React.useState([]), modProjects = modProjectsState[0], setModProjects = modProjectsState[1]
      var hostStatusState = React.useState({ phase: 'loading', value: null }), hostStatus = hostStatusState[0], setHostStatus = hostStatusState[1]
      var memoryStatusState = React.useState({ phase: 'loading', health: null, world: null, jobs: null }), memoryStatus = memoryStatusState[0], setMemoryStatus = memoryStatusState[1]

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
        var cancelled = false
        function checkMods() {
          var sid = sessionsState && sessionsState.current
          var url = sid ? ('/weftmate/mods/projects.json?session_id=' + encodeURIComponent(sid)) : '/weftmate/mods/projects.json'
          fetch(url, { credentials: 'same-origin', cache: 'no-store' })
            .then(function (res) { return res.ok ? res.json() : null })
            .then(function (data) {
              if (!cancelled && data && Array.isArray(data.projects)) {
                setModProjects(data.projects)
              }
            })
            .catch(function () { if (!cancelled) setModProjects([]) })
        }
        checkMods()
        var timer = setInterval(checkMods, 10000)
        return function () { cancelled = true; clearInterval(timer) }
      }, [sessionsState && sessionsState.current])

      React.useEffect(function () {
        var cancelled = false
        function get(path) { return fetch(path, { cache: 'no-store' }).then(function (response) { if (!response.ok) throw new Error('memory status unavailable'); return response.json() }) }
        function refreshMemory() {
          Promise.all([get('/weftmate/memory/health.json'), get('/weftmate/memory/world.json'), get('/weftmate/memory/jobs.json')])
            .then(function (values) { if (!cancelled) setMemoryStatus({ phase: 'ready', health: Object.assign({}, values[0], { available: true }), world: Object.assign({}, values[1], { available: true }), jobs: Object.assign({}, values[2], { available: true }) }) })
            .catch(function () { if (!cancelled) setMemoryStatus({ phase: 'error', health: { available: false }, world: null, jobs: null }) })
        }
        refreshMemory()
        var timer = setInterval(refreshMemory, 10000)
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
      var isMods = /^#\/mod/.test(page) || page === '#/mods'
      var isMemory = page === '#/memory'
      var isSettings = /^#\/settings(\/.*)?$/.test(page)
      var settingsSubpage = isSettings ? (page.replace(/^#\/settings\/?/, '') || 'general') : 'general'
      var pageKey = isMods ? 'mods' : (isMemory ? 'memory' : (isSettings ? 'settings' : 'chat'))
      var nonChat = isMods || isMemory || isSettings
      React.useEffect(function () { document.documentElement.setAttribute('data-weftmate-v2-page', pageKey); var columns = Array.prototype.slice.call(document.querySelectorAll('[data-weftmate-v2-center],[data-weftmate-v2-details]')); columns.forEach(function (column) { column.inert = nonChat; column.style.visibility = nonChat ? 'hidden' : '' }); return function () { columns.forEach(function (column) { column.inert = false; column.style.visibility = '' }); document.documentElement.removeAttribute('data-weftmate-v2-page') } }, [pageKey, nonChat])
      React.useEffect(function () { if (pageKey !== 'chat') closeV2WorkbenchDrawer() }, [pageKey])
      React.useEffect(function () { closeV2WorkbenchDrawer() }, [currentSession && currentSession.id])
      React.useEffect(function () { var surface = window.weftmateSurface; if (!surface || typeof surface.onOpenModProject !== 'function') return undefined; return surface.onOpenModProject(function (target) { if (!target || typeof target.projectId !== 'string' || typeof target.sessionId !== 'string') return; Promise.resolve(props.sessions.open(target.sessionId)).finally(function () { window.location.hash = '/mod/' + encodeURIComponent(target.projectId) }) }) }, [props.sessions])
      React.useEffect(function () { var update = function () { setTheme(document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light') }; var observer = new MutationObserver(update); observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] }); return function () { observer.disconnect() } }, [])
      React.useEffect(function () { var bridge = window.weftmateSurface; var title = document.querySelector('.weftmate-v2-shell .titlebar'); if (bridge && title && typeof bridge.syncTheme === 'function') bridge.syncTheme(theme, getComputedStyle(title).backgroundColor).catch(function () {}) }, [theme])
      function choose(next, sub) {
        if (next === 'mods') window.location.hash = '/mods'
        else if (next === 'memory') window.location.hash = '/memory'
        else if (next === 'settings') window.location.hash = '/settings' + (sub ? '/' + sub : '')
        else window.location.hash = '/chat'
      }
      async function newSession() { if (typeof props.startSession !== 'function') throw new Error('当前宿主没有可用的新会话入口。'); return await props.startSession() }
      React.useEffect(function () {
        if (!currentSession || !currentSession.blank || currentSession.agentPreset === 'mod-maintainer') return
        var snapshot = props.workspaces && props.workspaces.list && props.workspaces.list.getSnapshot ? props.workspaces.list.getSnapshot() : null
        var workspace = snapshot && Array.isArray(snapshot.items) ? snapshot.items.find(function (item) { return Array.isArray(item.sessionIds) && item.sessionIds.indexOf(currentSession.id) >= 0 }) : null
        if (!isMaintenanceWorkspace(workspace)) return
        void newSession().catch(function () {})
      }, [currentSession && currentSession.id])
      function icon(kind) {
        var children = kind === 'chat' ? [React.createElement('path', { key: 'p', d: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6z' })] :
          kind === 'mods' ? [React.createElement('rect', { key: 'a', x: 4, y: 4, width: 7, height: 7, rx: 2 }), React.createElement('rect', { key: 'b', x: 13, y: 4, width: 7, height: 7, rx: 2 }), React.createElement('rect', { key: 'c', x: 4, y: 13, width: 7, height: 7, rx: 2 }), React.createElement('rect', { key: 'd', x: 13, y: 13, width: 7, height: 7, rx: 2 })] :
          kind === 'memory' ? [React.createElement('path', { key: 'a', d: 'M12 3l8 4-8 4-8-4 8-4z' }), React.createElement('path', { key: 'b', d: 'M4 11l8 4 8-4' }), React.createElement('path', { key: 'c', d: 'M4 15l8 4 8-4' })] :
          kind === 'theme' ? [React.createElement('path', { key: 'p', d: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4' }), React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 4 })] :
          [React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 3 }), React.createElement('path', { key: 'p', d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1' })];
        return React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }, children)
      }

      var sessionCount = (sessionsState && sessionsState.ids ? sessionsState.ids.length : 0)
      var memoryHost = hostStatus.phase === 'ready' && hostStatus.value ? Object.assign({ available: true }, hostStatus.value) : null
      var memorySummary = deriveMemoryUiSummary(memoryHost, memoryStatus.health, memoryStatus.world, memoryStatus.jobs, hostStatus.phase === 'loading' || memoryStatus.phase === 'loading' ? 'loading' : (hostStatus.phase === 'error' || memoryStatus.phase === 'error' ? 'error' : 'ready'))
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
      var crumbTitle = isMods ? 'Mods' : (isMemory ? '记忆' : (isSettings ? ('设置 · ' + (subpageLabels[settingsSubpage] || '通用与外观')) : '对话'))

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
          React.createElement('button', { className: 'rl-item ' + (pageKey === 'mods' ? 'on' : ''), type: 'button', 'aria-label': 'Mods', onClick: function () { choose('mods') } }, icon('mods'), 'Mods', pageKey === 'mods' ? React.createElement('span', { className: 'rl-dot' }) : null),
          React.createElement('button', { className: 'rl-item ' + (pageKey === 'memory' ? 'on' : ''), type: 'button', 'aria-label': '记忆', onClick: function () { choose('memory') } }, icon('memory'), '记忆', pageKey === 'memory' ? React.createElement('span', { className: 'rl-dot' }) : null),
          React.createElement('button', { className: 'rl-item ' + (pageKey === 'settings' ? 'on' : ''), type: 'button', 'aria-label': '设置', onClick: function () { choose('settings') } }, icon('settings'), '设置', pageKey === 'settings' ? React.createElement('span', { className: 'rl-dot' }) : null),
          React.createElement('div', { className: 'r-bottom' },
            React.createElement('div', { className: 'r-avatar', title: '本地账户' }, 'Y')
          )),
        React.createElement('div', { className: 'weftmate-v2-head chat-head' },
          React.createElement('div', { className: 'ch-left' },
            React.createElement('button', { className: 'icon-btn' + (columnVisibility.sessions ? ' on' : ''), type: 'button', 'aria-label': '会话栏', 'aria-pressed': String(columnVisibility.sessions), 'aria-expanded': String(columnVisibility.sessions), onClick: function () { document.documentElement.toggleAttribute('data-weftmate-v2-sessions-hidden') } }, React.createElement('svg', { viewBox: '0 0 24 24' }, React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), React.createElement('line', { x1: 9.5, y1: 4, x2: 9.5, y2: 20 }))),
            React.createElement('div', { className: 'ch-title' }, pageKey === 'mods' ? 'Mods' : (pageKey === 'memory' ? '记忆' : (pageKey === 'settings' ? '设置' : v2ChatTitle(currentSession)))),
            React.createElement('span', { className: 'ch-sub' }, pageKey === 'mods' ? '管理已安装的能力' : (pageKey === 'memory' ? '查看长期理解、来源与纠正状态' : (pageKey === 'settings' ? '机器本地的，都是你的' : '对话是一切的入口')))),
          React.createElement('div', { className: 'sp' },
            React.createElement('button', { className: 'icon-btn' + (columnVisibility.work ? ' on' : ''), type: 'button', 'aria-label': '工作台栏', 'aria-pressed': String(columnVisibility.work), 'aria-expanded': String(columnVisibility.work), onClick: toggleV2Workbench }, React.createElement('svg', { viewBox: '0 0 24 24' }, React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), React.createElement('line', { x1: 14.5, y1: 4, x2: 14.5, y2: 20 }))))),
        React.createElement(V2Workbench, { currentSession: currentSession, sessions: props.sessions, onNewSession: newSession, onNavigate: choose, memorySummary: memorySummary, modProjects: modProjects, onClose: closeV2WorkbenchDrawer }),
        isMods ? React.createElement('section', { className: 'weftmate-v2-page weftmate-v2-mods on' }, React.createElement(V2ModsWorkspace, { sessions: props.sessions })) : null,
        isMemory ? React.createElement('section', { className: 'weftmate-v2-page weftmate-v2-memory on', id: 'page-memory' }, React.createElement(V2MemoryWorkspace, { onNavigate: choose })) : null,
        isSettings ? React.createElement('section', { className: 'weftmate-v2-page weftmate-v2-settings on', id: 'page-settings' }, React.createElement(V2SettingsWorkspace, { theme: props.theme, connection: props.connection, subpage: settingsSubpage, onNavigate: choose, appVersion: appVersion })) : null,
        React.createElement('footer', { className: 'weftmate-v2-status statusbar', 'aria-label': '状态栏' },
          React.createElement('span', { className: 'st' },
            React.createElement('span', { className: 'dot' }),
            hostStatus.phase === 'ready' ? '宿主已连接' : (hostStatus.phase === 'loading' ? '正在读取宿主状态' : '宿主状态不可用')
          ),
          React.createElement('span', { className: 'st' }, hostStatus.phase === 'ready' && hostStatus.value && hostStatus.value.update ? (hostStatus.value.update.status === 'disabled' ? '更新未启用' : ('更新：' + (hostStatus.value.update.status || '未知'))) : '更新状态未知'),
          React.createElement('button', { className: 'st st-link memory-' + memorySummary.state, type: 'button', onClick: function () { choose('memory') }, title: memorySummary.detail }, '记忆 ', React.createElement('b', null, memorySummary.count === null ? memorySummary.label : (memorySummary.label + ' · ' + memorySummary.count))),
          React.createElement('div', { className: 'right' },
            React.createElement('span', { className: 'st' }, '会话 ', React.createElement('b', null, String(sessionCount))),
            React.createElement('span', { className: 'st' }, 'Mods ', React.createElement('b', { id: 'stMods' }, hostStatus.phase === 'ready' ? String(modProjects.length) : '未知')),
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
        installAiGamePanelStyles()
        installWeftmateV2Style()
        installWeftmateV2ShellStyle()
        installFrozenV2ShellCss()
        ctx.slots.inject('tool.call.toolview', function () {
          return ctx.slots.register({ name: 'tool.call.toolview', key: 'phone_execution' }, PhoneExecutionRow)
        })
        ctx.slots.inject('conversation.details.supplement', function () {
          return ctx.slots.register({ name: 'conversation.details.supplement', key: 'phone_execution' }, AiGameExecutionDetails)
        })
        ctx.slots.inject('conversation.details.supplement', function () {
          return ctx.slots.register({ name: 'conversation.details.supplement', key: 'weftmod_script' }, WeftModExecutionDetails)
        })
        ctx.slots.inject('conversation.input.dock', function () {
          return ctx.slots.register({ name: 'conversation.input.dock', id: 'weftmate-v2-hero', order: -1000 }, V2ConversationHero)
        })
        ctx.slots.inject('conversation.composer.dock', function () {
          return ctx.slots.register({ name: 'conversation.composer.dock', id: 'weftmate-v2-hint', order: -1000 }, V2ComposerHint)
        })
        ctx.slots.inject('tool.call.toolview', function () {
          return ctx.slots.register({ name: 'tool.call.toolview', key: 'weftmod_script' }, WeftModExecutionRow)
        })
        // Project Repair: global emulator settings and task-center entry points
        // are absent until WeftMate owns the AI-GAME lifecycle. A user must
        // never be sent to a product surface that depends on manually starting
        // port 4310. The conversation result/details read seam remains active.
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
