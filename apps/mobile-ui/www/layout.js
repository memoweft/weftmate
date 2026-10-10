/* Sole page assembly. Components retain their names when moved. */
const mobileMarkup = String.raw`
  <div id="app">
    <header class="topbar">
      <button id="menu-button" class="icon-button" aria-label="打开导航"><span class="icon icon-menu"></span></button>
      <button id="page-back" class="icon-button" aria-label="返回" hidden><span class="icon icon-back"></span></button>
      <div class="brand"><strong id="header-title">WeftMate</strong><small id="header-subtitle">同一个助手，接着聊。</small></div>
      <button id="conversation-usage" class="header-action" hidden>本对话用量</button>
      <button id="outputs-button" class="header-action" hidden>输出与来源</button>
      <button id="conversation-more" class="icon-button" aria-label="对话操作" aria-haspopup="menu" hidden></button>
      <button id="home-new-chat" class="icon-button" aria-label="新对话" hidden><span class="icon icon-compose"></span></button>
      <button id="header-profile" class="icon-button header-profile" aria-label="个人资料与设置" hidden><span class="avatar">我</span></button>

    </header>
    <div id="drawer-scrim" class="scrim" hidden></div>
    <nav id="drawer" class="drawer" aria-label="主导航" inert>
      <div class="drawer-brand"><span class="logo" aria-label="WeftMate"></span><strong>WeftMate</strong><button id="drawer-close" class="icon-button" aria-label="关闭导航"><span class="icon icon-close"></span></button></div>
      <div class="drawer-new-group">
        <button class="nav-primary" data-action="new-chat"><span class="icon icon-compose"></span>新对话</button>
        <button id="drawer-new-menu" class="icon-button" aria-label="选择新对话类型" aria-haspopup="menu"><span class="icon icon-chevron"></span></button>
        <button data-action="temporary-chat" hidden>临时对话</button>
      </div>
      <input id="conversation-search" class="search" type="search" placeholder="搜索会话" aria-label="搜索会话">
      <div id="conversation-list" class="conversation-list" aria-label="最近对话" aria-live="polite"></div>
      <div class="drawer-section-label drawer-function-label">功能</div>
      <div class="drawer-links">
        <button data-page="memory"><span class="icon icon-memory"></span>记忆</button>
        <button data-page="capabilities"><span class="icon icon-capabilities"></span>能力与扩展</button><button data-page="workspaces"><span class="icon icon-folder"></span>项目与成果</button><button data-page="devices"><span class="icon icon-device"></span>设备</button>
        <button data-page="notifications"><span class="icon icon-bell"></span>通知</button><button data-page="settings"><span class="icon icon-settings"></span>设置</button>
      </div>
      <div id="cloud-device-banner" class="cloud-device-banner" role="status" aria-live="polite" hidden></div>
      <button id="profile-link" class="profile-link"><span class="avatar" id="drawer-avatar">我</span><span><strong id="drawer-name">本机个人空间</strong><small>个人资料与设置</small></span><span class="icon icon-settings"></span></button>
    </nav>
    <div id="cloud-access-banner" class="cloud-access-banner" role="status" aria-live="polite" hidden></div>
    <main id="main">
      <section id="cloud-auth-page" class="page active" aria-label="账号登录">
        <div id="login-view" class="cloud-auth-card"></div>
        <section id="cloud-wait-view" class="cloud-auth-card" hidden>
          <span class="auth-brand" aria-hidden="true"></span>
          <h1 id="cloud-wait-title">在你已登录的设备上允许这台设备</h1>
          <p id="cloud-wait-status" role="status"></p>
          <button id="cloud-wait-retry" class="button primary" type="button">检查批准状态</button>
          <button id="cloud-wait-cancel" class="button quiet" type="button">取消并换账号</button>
        </section>
      </section>
      <section id="cloud-settings-page" class="page"><div id="cloud-settings-view" class="cloud-settings"></div><div id="pending-devices"></div></section>
      <section id="home-page" class="page">
        <div class="home-search"><input id="home-search" class="search" type="search" placeholder="搜索会话" aria-label="搜索所有会话"></div>
        <div id="home-conversations" class="home-conversations conversation-list" aria-label="会话列表"></div>
        <button id="home-settings" class="profile-link"><span class="icon icon-settings"></span><span>设置与账户</span></button>
      </section>
      <section id="chat-page" class="page" aria-label="对话">
        <div id="chat-scroll" class="chat-scroll"><div id="chat-content" class="chat-content"></div></div>
        <button id="jump-latest" class="jump-latest" aria-label="回到底部" hidden>回到底部</button>
        <div id="composer-dock" class="composer-dock">
          <section id="approval-bar" class="approval-bar" aria-label="待批准操作" hidden></section>
          <section id="question-bar" class="approval-bar question-bar" role="region" aria-label="待回答问题" hidden></section>
          <div id="device-line" class="device-line" role="status"></div>
          <details id="queued-tasks" class="queued-tasks" hidden>
            <summary id="queued-count">排队中</summary>
            <div id="queued-cards" aria-label="排队任务"></div>
          </details>
          <div id="composer-subtasks" class="composer-subtasks" hidden></div><div id="chat-status" class="chat-status" role="status"></div>
          <div class="composer-card">
            <textarea id="draft" rows="2" placeholder="和 WeftMate 聊聊…" aria-label="输入消息"></textarea>
            <div id="attachment-drafts" class="attachment-drafts" aria-label="待发送附件" hidden></div>
            <div class="composer-actions">
              <button id="plus-button" class="icon-button" aria-label="添加图片或文件" aria-expanded="false" aria-controls="attachment-popover"><span class="icon icon-plus"></span></button>
              <button id="approval-mode-button" class="approval-mode-button" type="button" aria-label="审批模式" aria-haspopup="menu" aria-expanded="false" aria-controls="approval-mode-popover"><span class="icon icon-shield approval-shield" aria-hidden="true" hidden></span><span id="approval-mode-label">审批</span><span class="icon icon-down" aria-hidden="true"></span></button>
              <span id="thinking-badge" class="thinking-badge" aria-label="已开启深入思考" hidden>深入思考</span><div class="composer-spacer"></div>
              <button type="button" id="context-usage" class="icon-button context-usage" aria-label="背景信息窗口" aria-describedby="context-tooltip"><svg viewBox="0 0 24 24" aria-hidden="true"><circle class="context-track" cx="12" cy="12" r="8"/><circle class="context-fill" cx="12" cy="12" r="8" pathLength="100"/></svg></button>
              <div id="context-tooltip" class="context-tooltip" role="tooltip" hidden><span id="context-tooltip-label"></span><strong id="context-tooltip-detail"></strong></div>
              <button id="model-button" class="model-button" aria-label="选择模型" aria-expanded="false" aria-controls="model-popover"><span id="model-label">选择模型</span><span class="icon icon-down"></span></button>
              <button id="voice-button" class="icon-button" aria-label="语音输入"><span class="icon icon-mic"></span></button>
              <button id="send-button" class="send-button" aria-label="发送"><span class="icon icon-arrow"></span></button>
            </div>
          </div>
          <div id="attachment-pick-status" class="attachment-pick-status" hidden>
            <span id="attachment-pick-label"></span>
            <button id="attachment-pick-cancel" type="button">取消等待</button>
          </div>
        </div>
        <div id="model-popover" class="popover" hidden><h3>选择模型</h3><div id="model-options"></div><button data-page="models">配置自定义模型</button></div>
        <div id="attachment-popover" class="popover attachment-popover" role="menu" aria-label="添加附件" hidden>
          <h3>添加到这条消息</h3>
          <button id="pick-camera" type="button" role="menuitem"><span class="icon icon-camera" aria-hidden="true"></span>相机</button>
          <button id="pick-image" type="button" role="menuitem" aria-label="照片"><span class="icon icon-image" aria-hidden="true"></span>照片<span>从系统相册选择</span></button>
          <button id="pick-file" type="button" role="menuitem"><span class="icon icon-attach" aria-hidden="true"></span>文件<span>从系统文件中选择</span></button>
          <hr id="thinking-separator" class="wm-menu-separator" hidden><button id="pick-thinking" type="button" role="menuitemcheckbox" aria-checked="false" hidden><span class="icon icon-model" aria-hidden="true"></span>深入思考</button><p id="attachment-note" class="attachment-note" hidden>附件会保存到这段电脑会话；普通文件将以文件卡显示。</p>
        </div>
      </section>
      <section id="generic-page" class="page" aria-live="polite"><div id="page-content"></div></section>
    </main>
    <section id="resource-page" class="resource-page" role="dialog" aria-modal="true" aria-labelledby="resource-title" hidden>
      <header class="resource-topbar"><button id="resource-back" class="icon-button" aria-label="返回对话"><span class="icon icon-back"></span></button><strong id="resource-title"></strong></header>
      <div id="resource-content" class="resource-content"></div>
    </section>
    <div id="image-preview" class="image-preview" role="dialog" aria-modal="true" aria-label="图片预览" hidden>
      <div class="image-preview-stage"><img id="image-preview-image" alt=""></div>
      <header class="image-preview-topbar">
        <button id="image-preview-close" class="image-preview-close" type="button" aria-label="关闭图片预览"><span class="icon icon-close" aria-hidden="true"></span></button>
      </header>
      <footer class="image-preview-caption">
        <strong id="image-preview-name"></strong>
        <p id="image-preview-note"></p>
      </footer>
    </div>
    <button id="toast" class="toast" type="button" aria-live="polite" aria-description="轻点关闭" hidden></button>
    <div id="approval-mode-popover" class="popover approval-mode-popover" role="menu" aria-label="审批模式" hidden></div>
    <div id="approval-risk-dialog" class="approval-risk-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-risk-title" hidden>
      <section class="approval-risk-sheet">
        <h2 id="approval-risk-title">允许所有操作？</h2>
        <p>删除或覆盖文件、修改系统、安装软件、发送或发布内容、付款都可能直接执行，不再询问你。部分操作无法撤销。</p>
        <p id="approval-risk-scope"></p>
        <div class="approval-risk-actions"><button id="approval-risk-cancel" class="secondary" type="button">取消</button><button id="approval-risk-confirm" class="primary" type="button">确认全部允许</button></div>
      </section>
    </div>
  </div>
`;
globalThis.WeftMobileLayout = { assemble(document) { document.body.innerHTML = mobileMarkup; } };
WeftMobileLayout.assemble(document);
