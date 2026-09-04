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
 * shell.overlay 只剩品牌状态条 + 记忆管理胶囊。
 */
window.__ModuleLoader__.load({
  id: '@weftmate/client',
  factory: function (require) {
    var React = require('react')

    // The DSH client remains the actual UI. This shell layer changes only the
    // product frame around the fixed, official client graph: native chrome,
    // wordmark and sidebar surface. It deliberately owns no DSH data, route,
    // setting, session, tool, approval, or interaction state.
    function installElectronWindowChrome() {
      if (!document || !document.body || document.getElementById('weftmate-electron-drag-region')) return
      var style = document.createElement('style')
      style.id = 'weftmate-electron-window-style'
      style.textContent = [
        'html[data-weftmate-electron-shell] body { box-sizing: border-box; padding-top: 44px !important; background: var(--dsw-alias-bg-base, Canvas); }',
        '#weftmate-electron-drag-region { position: fixed; top: 0; left: 0; right: 0; height: 44px; z-index: 2147483000; display: flex; align-items: center; gap: 9px; padding: 0 18px; box-sizing: border-box; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base, Canvas); color: var(--dsw-alias-label-secondary, currentColor); font-family: var(--dsw-font-family, system-ui, sans-serif); -webkit-app-region: drag; }',
        '#weftmate-electron-drag-region .weftmate-mark { display: inline-grid; place-items: center; width: 20px; height: 20px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; color: var(--dsw-alias-label-primary); font-size: 11px; font-weight: 700; line-height: 1; letter-spacing: -.05em; }',
        '#weftmate-electron-drag-region .weftmate-wordmark { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 650; letter-spacing: -.01em; }',
        '#weftmate-electron-drag-region .weftmate-context { padding-left: 9px; border-left: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 500; letter-spacing: .08em; }',
        'html[data-weftmate-electron-shell] .qfhBTW_frame { background: var(--dsw-alias-bg-base); }',
        'html[data-weftmate-electron-shell] .qfhBTW_sidebarCol { border-right-color: var(--dsw-alias-border-l2); }',
        'html[data-weftmate-electron-shell] .ocUJRa_root { padding-top: 8px; }',
        'html[data-weftmate-electron-shell] .ocUJRa_logoRow { height: 52px; margin-bottom: 4px; padding-left: 4px; }',
        'html[data-weftmate-electron-shell] .ocUJRa_brand { gap: 8px; min-height: 36px; }',
        'html[data-weftmate-electron-shell] .ocUJRa_brand > * { display: none; }',
        'html[data-weftmate-electron-shell] .ocUJRa_brand::before { content: "WeftMate"; color: var(--dsw-alias-label-primary); font: 650 16px/20px var(--dsw-font-family, system-ui, sans-serif); letter-spacing: -.025em; }',
        'html[data-weftmate-electron-shell] .ocUJRa_brand::after { content: "WORKSPACE"; margin-left: 9px; padding-left: 9px; border-left: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font: 500 10px/16px var(--dsw-font-family, system-ui, sans-serif); letter-spacing: .09em; }',
        'html[data-weftmate-electron-shell] .ocUJRa_newSession { border-radius: 8px; box-shadow: none; }',
        'html[data-weftmate-electron-shell] .ocUJRa_newSession:hover { background: var(--dsw-alias-interactive-bg-hover); }',
        'html[data-weftmate-electron-shell] .ocUJRa_regionArea { border-top: 1px solid var(--dsw-alias-border-l2); margin-top: 3px; padding-top: 8px; }',
        'html[data-weftmate-electron-shell] .ocUJRa_footArea { border-top: 1px solid var(--dsw-alias-border-l2); margin-top: 6px; padding-top: 6px; }',
        'html[data-weftmate-electron-shell] .ocUJRa_collapsed .ocUJRa_logoRow { justify-content: flex-start; height: 36px; margin-bottom: 12px; padding: 0; }',
        'html[data-weftmate-electron-shell] .ocUJRa_collapsed .ocUJRa_brand { display: none; }',
        'html[data-weftmate-electron-shell] .ocUJRa_collapsed .ocUJRa_toggle { width: 36px; height: 36px; }',
        'html[data-weftmate-electron-shell] .ocUJRa_collapsed .ocUJRa_railFish { display: none; }',
        'html[data-weftmate-electron-shell] .ocUJRa_collapsed .ocUJRa_toggle .ocUJRa_panelIcon { display: none !important; }',
        'html[data-weftmate-electron-shell] .ocUJRa_collapsed .ocUJRa_toggle::before { content: "W"; display: grid; place-items: center; width: 22px; height: 22px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; color: var(--dsw-alias-label-primary); font: 700 11px/1 var(--dsw-font-family, system-ui, sans-serif); letter-spacing: -.05em; }',
        'html[data-weftmate-electron-shell] .ocUJRa_collapsed .ocUJRa_regionArea, html[data-weftmate-electron-shell] .ocUJRa_collapsed .ocUJRa_footArea { border-top-color: transparent; }',
        '@media (prefers-reduced-motion: reduce) { html[data-weftmate-electron-shell] .qfhBTW_frame, html[data-weftmate-electron-shell] .ocUJRa_fading > * { transition: none !important; animation: none !important; } }',
        'button, input, textarea, select, a, [role="button"], [contenteditable="true"] { -webkit-app-region: no-drag; }',
      ].join('\n')
      document.head.appendChild(style)
      document.documentElement.setAttribute('data-weftmate-electron-shell', '')
      var dragRegion = document.createElement('div')
      dragRegion.id = 'weftmate-electron-drag-region'
      dragRegion.setAttribute('aria-hidden', 'true')
      // This is inert native chrome, not a second navigation or state source.
      dragRegion.innerHTML = '<span class="weftmate-mark">W</span><span class="weftmate-wordmark">WeftMate</span><span class="weftmate-context">WORKSPACE</span>'
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
        'html[data-weftmate-electron-shell] [data-composer-card] textarea { padding-inline: 16px; }',
        'html[data-weftmate-electron-shell] [data-composer-card] button { border-radius: 8px; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-conversation-scroll] { position: relative; justify-content: flex-end; padding-bottom: 12px; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-conversation-scroll]::before { content: "今天想推进什么？"; position: absolute; top: 42%; left: 50%; color: var(--dsw-alias-label-primary); font: 500 clamp(24px, 2.5vw, 34px)/1.25 var(--dsw-font-family, system-ui, sans-serif); letter-spacing: -.03em; transform: translate(-50%, -50%); }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-weftmate-hero-composer] { box-sizing: border-box; position: relative; width: min(var(--dsh-composer-card-max-width), calc(100% - 2 * var(--dsh-composer-side-clearance))); margin: 0 auto; overflow: visible; border: 0; background: transparent; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-weftmate-hero-composer] > div:has(> button[aria-haspopup="menu"][aria-label]) { box-sizing: border-box; position: absolute; z-index: 0; top: -54px; left: 32px; display: flex; align-items: center; gap: 8px; width: calc(100% - 64px); min-height: 48px; margin: 0; padding: 0 16px; border: 0; border-radius: 14px; background: var(--dsw-alias-bg-layer-2, var(--dsw-specific-input-major)); }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-weftmate-hero-composer] button[aria-haspopup="menu"][aria-label] { margin-inline-start: 0; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-weftmate-hero-composer] div:has(> [data-composer-card]) { position: relative; z-index: 1; width: 100% !important; max-width: none !important; padding: 0 !important; }',
        'html[data-weftmate-electron-shell] div[data-phase="hero"] [data-weftmate-hero-composer] [data-composer-card] { width: 100%; max-width: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 18px; background: var(--dsw-specific-input-major); box-shadow: none; }',
        '@media (min-width: 1180px) { html[data-weftmate-electron-shell] div[data-phase="hero"], html[data-weftmate-electron-shell] div[data-phase="active"], html[data-weftmate-electron-shell] div[data-phase="settling"] { --dsh-chat-content-width: 704px; } }',
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
        return { executionId: value.taskId, taskId: value.taskId, status: value.status, goalSummary: typeof value.goalSummary === 'string' ? value.goalSummary : '', currentStage: typeof value.currentStage === 'string' ? value.currentStage : null,
          progress: { kind: 'unknown', explanation: '当前没有权威数值进度。' }, currentAction: typeof value.currentAction === 'string' ? value.currentAction : null,
          pendingQuestion: value.pendingQuestion && typeof value.pendingQuestion.question === 'string' ? { questionId: String(value.pendingQuestion.questionId || ''), question: value.pendingQuestion.question, whyNeeded: String(value.pendingQuestion.whyNeeded || '') } : null,
          resultSummary: typeof value.resultSummary === 'string' ? value.resultSummary : null, error: value.error && typeof value.error.code === 'string' ? { code: value.error.code } : null,
          evidence: [], eventCursor: Number.isSafeInteger(value.eventCursor) ? value.eventCursor : 0,
          allowedIntents: { cancel: controls.indexOf('cancel') >= 0, resume: controls.indexOf('resume') >= 0, answer: value.status === 'needs_user_input' } }
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
      if (snap.allowedIntents.cancel) actions.push(React.createElement('button', {
        key: 'cancel', type: 'button', className: 'weftmate-ai-game__action',
        onClick: function () { fillComposer('请调用 phone_execution 取消执行 ' + snap.executionId + '。') },
      }, '在对话中请求取消'))
      if (snap.allowedIntents.resume) actions.push(React.createElement('button', {
        key: 'resume', type: 'button', className: 'weftmate-ai-game__action',
        onClick: function () { fillComposer('请调用 phone_execution 恢复执行 ' + snap.executionId + '。') },
      }, '在对话中请求恢复'))
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
      padding: '7px 14px',
      borderRadius: '999px',
      background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
      border: '1.5px solid var(--dsw-alias-brand-primary, var(--dsw-alias-border-l1))',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
      lineHeight: '1',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.28)',
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

    function fetchMemoryJson(path, setter) {
      fetch(path, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (data) { if (data && typeof data === 'object') setter(data) })
        .catch(function () { /* 失败保持旧值 */ })
    }

    function MemoryBadge() {
      var worldState = React.useState({ cognitions: [] })
      var world = worldState[0]
      var setWorld = worldState[1]
      var healthState = React.useState({ ready: false, protocolVersion: null })
      var health = healthState[0]
      var setHealth = healthState[1]
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]

      React.useEffect(function () {
        fetchMemoryJson('/weftmate/memory/world.json', setWorld)
        fetchMemoryJson('/weftmate/memory/health.json', setHealth)
        var timer = setInterval(function () { fetchMemoryJson('/weftmate/memory/world.json', setWorld) }, 30_000)
        var healthTimer = setInterval(function () { fetchMemoryJson('/weftmate/memory/health.json', setHealth) }, 10_000)
        return function () { clearInterval(timer); clearInterval(healthTimer) }
      }, [])

      var cognitions = world.cognitions || []
      var entities = world.entities || []
      var relationships = world.relationships || []
      var events = world.events || []
      var protocolLabel = health.protocolVersion ? 'v' + health.protocolVersion : '连接中'
      var label = '记忆 ' + protocolLabel + ' · ' + cognitions.length + ' 条'
      var capsuleStyle = Object.assign({}, baseStyle, { top: '48px', pointerEvents: 'auto', cursor: 'pointer' })
      var capsule = React.createElement(
        'div',
        { key: 'capsule', style: capsuleStyle, title: health.ready ? 'MemoWeft 版本化桥接已就绪' : 'MemoWeft 桥接尚未就绪', onClick: function () { setOpen(!open) } },
        React.createElement('span', { key: 'dot', style: dotStyle(health.ready === true) }),
        React.createElement('span', { key: 'label', style: health.ready ? {} : dimStyle }, label),
      )
      if (!open) return capsule

      return React.createElement('div', { key: 'memory-root' }, capsule, React.createElement(MemoryPanel, {
        world: world,
        health: health,
        onClose: function () { setOpen(false) },
      }))
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

      var world = props.world || {}
      var health = props.health || {}
      var cognitions = world.cognitions || []
      var entities = world.entities || []
      var relationships = world.relationships || []
      var events = world.events || []

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
      rows.push(React.createElement('div', { key: 'cog-title', style: sectionTitleStyle }, '认知 · ' + cognitions.length))
      for (var i = 0; i < cognitions.length; i++) {
        rows.push(React.createElement(
          'div', { key: 'cog' + i, style: listItemStyle },
          React.createElement('span', { key: 't' }, String(cognitions[i].content || '')),
          React.createElement('span', { key: 'c', style: pillStyle }, String(cognitions[i].confidence || '')),
        ))
      }
      rows.push(React.createElement('div', { key: 'ent-title', style: sectionTitleStyle }, '实体 · ' + entities.length))
      for (var j = 0; j < entities.length; j++) {
        rows.push(React.createElement(
          'div', { key: 'ent' + j, style: listItemStyle },
          React.createElement('span', { key: 't' }, String(entities[j].canonical_name || '')),
          React.createElement('span', { key: 'k', style: pillStyle }, String(entities[j].kind || '')),
        ))
      }
      rows.push(React.createElement('div', { key: 'rel-title', style: sectionTitleStyle }, '关系 · ' + relationships.length))
      for (var k = 0; k < relationships.length; k++) {
        rows.push(React.createElement(
          'div', { key: 'rel' + k, style: listItemStyle },
          React.createElement('span', { key: 't' }, String(relationships[k].content || '')),
          React.createElement('span', { key: 'c', style: pillStyle }, String(relationships[k].confidence || '')),
        ))
      }
      rows.push(React.createElement('div', { key: 'ev-title', style: sectionTitleStyle }, '事件 · ' + events.length))
      for (var m = 0; m < events.length; m++) {
        rows.push(React.createElement(
          'div', { key: 'ev' + m, style: listItemStyle },
          React.createElement('span', { key: 't' }, String(events[m].content || '')),
          React.createElement('span', { key: 'c', style: pillStyle }, String(events[m].confidence || '')),
        ))
      }

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
        searchBlock,
        React.createElement('div', { key: 'list', style: { flex: 1, overflow: 'auto' } }, rows),
        React.createElement('div', { key: 'f', style: { display: 'flex', gap: '8px' } },
          React.createElement('button', { key: 'export', style: installBtnStyle, onClick: doExport }, '导出备份'),
          React.createElement('span', { key: 'note', style: dimStyle }, 'Evidence 与 provenance 一并导出'),
        ),
      )
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
    var FALLBACK_DEVICE = { schemaVersion: 1, pairing: null, devices: [] }

    function Toggle(props) {
      return React.createElement('button', {
        key: 'toggle', type: 'button', role: 'switch',
        'aria-checked': props.checked === true,
        title: props.title,
        onClick: function () { props.onChange(props.checked !== true) },
        style: {
          width: '36px', height: '20px', borderRadius: '999px', border: 'none', cursor: 'pointer',
          padding: 0, position: 'relative', flexShrink: 0,
          background: props.checked === true ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
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
      var devices = (state && state.devices) || []
      var leftMs = pairing && typeof pairing.expiresAt === 'number' ? pairing.expiresAt - Date.now() : null
      var copiedState = React.useState(false)
      var copied = copiedState[0]
      var setCopied = copiedState[1]

      var copyToken = function () {
        var text = pairing && typeof pairing.token === 'string' ? pairing.token : ''
        if (!text) return
        var done = function () {
          setCopied(true)
          setTimeout(function () { setCopied(false) }, 1500)
        }
        if (window.navigator && window.navigator.clipboard && typeof window.navigator.clipboard.writeText === 'function') {
          window.navigator.clipboard.writeText(text).then(done).catch(function () { /* 剪贴板被拒：静默 */ })
        } else {
          done() // 无剪贴板 API：仍给反馈，用户可手动选中复制
        }
      }

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
        React.createElement('div', { key: 'title', style: sectionBlockTitleStyle }, '设备配对（R8 · 手机 App）'),
        tokenNode,
        deviceRows,
      )
    }

    function WeftMateSettingsSection() {
      var perceptionState = React.useState(FALLBACK_PERCEPTION)
      var perception = perceptionState[0]
      var setPerception = perceptionState[1]
      var statusState = React.useState(FALLBACK_STATE)
      var status = statusState[0]
      var setStatus = statusState[1]
      var deviceState = React.useState(FALLBACK_DEVICE)
      var device = deviceState[0]
      var setDevice = deviceState[1]
      var localState = React.useState(null)
      var local = localState[0]
      var setLocal = localState[1]

      React.useEffect(function () {
        var poll = function () {
          pollPerception(setPerception)
          pollStatus(setStatus)
          fetch('/weftmate/device/state.json', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null })
            .then(function (next) { if (next && typeof next === 'object') setDevice(next) })
            .catch(function () { /* 失败保持旧值 */ })
        }
        poll()
        var timer = setInterval(poll, 5_000)
        return function () { clearInterval(timer) }
      }, [])

      var cfg = (perception && perception.config) || FALLBACK_PERCEPTION.config
      var sample = perception && perception.sample
      var pet = (status && status.pet) || null

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
            petVisible: pet ? pet.visible : false,
            petFreeActivity: pet ? pet.freeActivity : false,
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
        setLocal(function (prev) {
          var next = Object.assign({}, prev)
          next[key] = value
          return next
        })
        postSeam('/weftmate/pet', action, value)
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
        React.createElement('div', { key: 'pet', style: sectionBlockStyle },
          React.createElement('div', { key: 'title', style: sectionBlockTitleStyle }, '桌面宠物（R6）'),
          React.createElement(Row, {
            key: 'visible',
            label: '显示桌宠窗口',
            control: React.createElement(Toggle, {
              checked: eff('petVisible', pet ? pet.visible : false) === true,
              onChange: function (v) { applyPet('petVisible', 'set-visible', v) },
            }),
            hint: '透明置顶小窗；托盘图标也可唤醒/休息',
          }),
          React.createElement(Row, {
            key: 'free',
            label: '自由活动',
            control: React.createElement(Toggle, {
              checked: eff('petFreeActivity', pet ? pet.freeActivity : false) === true,
              onChange: function (v) { applyPet('petFreeActivity', 'set-free-activity', v) },
            }),
            hint: '允许读取瞬时鼠标位置自主游走、注视、停靠主窗口',
          }),
        ),
        React.createElement(DeviceBlock, { key: 'deviceblock', state: device }),
      )
    }

    return {
      name: 'weftmate-client',
      inject: ['slots', 'connection'],
      apply: function (ctx) {
        installElectronWindowChrome()
        installConversationWorkspaceSurface()
        installAiGamePanelStyles()
        ctx.slots.inject('tool.call.toolview', function () {
          return ctx.slots.register({ name: 'tool.call.toolview', key: 'phone_execution' }, PhoneExecutionRow)
        })
        ctx.slots.inject('conversation.details.supplement', function () {
          return ctx.slots.register({ name: 'conversation.details.supplement', key: 'phone_execution' }, AiGameExecutionDetails)
        })
        // Project Repair: global emulator settings and task-center entry points
        // are absent until WeftMate owns the AI-GAME lifecycle. A user must
        // never be sent to a product surface that depends on manually starting
        // port 4310. The conversation result/details read seam remains active.
        // 声明等待：官方槽位系统要求目标槽已被某个声明者（ui-layout 在 root 的 children 表里
        // 声明 shell.overlay）登记；`slots.inject(key, cb)` 是官方「声明依赖」接缝——声明已存在则
        // 同步注册，否则等声明者的 register 提交后再注册（回调返回注册的 disposer，随声明生命周期回收）。
        // 本行注册进官方 shell.overlay 槽位（list 槽位：additive；inject 面把 hostDescription 源传给组件）。
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'weftmate-status',
            order: 9000,
            inject: function () {
              return { hostDescription: ctx.connection.hostDescription }
            },
          }, WeftMateStatusBadge)
        })
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
        // R7 · 记忆胶囊 + 管理面板（只读 v1）。
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'weftmate-memory',
            order: 8700,
            inject: function () { return {} },
          }, MemoryBadge)
        })
      },
    }
  },
})
