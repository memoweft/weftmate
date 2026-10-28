/* Small presentation helpers. Transport always targets the computer in the panel context. */
(() => {
  const node = (tag, cls = '', text = '') => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; };
  const button = (label, action, cls = 'button quiet small') => { const el = node('button', cls, label); el.type = 'button'; el.onclick = action; return el; };
  // workDir is asynchronously resolved display metadata. The host authorizes
  // every read/write against sessionId + projectId, including remote computers.
  const key = ctx => JSON.stringify([ctx.ownerId, ctx.identityGeneration, ctx.conversationId, ctx.sessionId, ctx.computerId, ctx.projectId, ctx.mode]);
  const ready = ctx => ctx.mode === 'work' && !!ctx.sessionId && !!ctx.projectId;
  const contextHelp = ctx => ctx.mode === 'work' && ctx.projectId && !ctx.sessionId
    ? '先在这个工作目录开始一段对话，再查看文件。' : '先在工作模式里选一个工作目录。';
  const messages = {
    PROJECT_NOT_SELECTED: '先在工作模式里选一个工作目录。', PROJECT_REVOKED: '目录授权已改变，请重新选择工作目录。',
    WORKSPACE_NOT_GIT: '这个工作目录不是 Git 仓库。', WORKSPACE_GIT_UNAVAILABLE: '这台电脑还不能读取 Git，请安装 Git 后重试。',
    WORKSPACE_FILE_CHANGED: '文件已有新版本。草稿已保留，请查看新版本后再保存。', WORKSPACE_READ_ONLY: '这个目录只读，请在目录设置里开启读写后重试。',
    WORKSPACE_UNSAFE_PATH: '这个文件不在可访问的工作目录内。', COMPUTER_OFFLINE: '电脑暂时不在线，连接后可重试。',
    NOT_FOUND: '文件或对话已不在原位置，请刷新。', UNAUTHORIZED: '登录已过期，请重新登录。',
  };
  function message(error) { return messages[error?.code] || '暂时无法读取或保存，请重试。'; }
  function empty(el, copy = '先在工作模式里选一个工作目录。') { el.replaceChildren(node('p', 'workspace-empty', copy)); }
  const request = (ctx, action, body) => WeftPanels.services.workspaceRequest(ctx, action, body);
  function preview(el, data, name) {
    el.replaceChildren();
    if (data.kind === 'unsupported') {
      el.append(node('p', 'workspace-empty', data.reason === 'too-large' ? '文件较大，请在电脑上打开。' : '这个类型暂不支持预览。'));
      el.append(node('p', 'muted', `${data.contentType || '文件'} · ${data.size ?? 0} 字节`)); return;
    }
    WeftContent.preview(el, { ...data, data: data.base64 ?? data.data }, { name });
  }
  globalThis.WeftWorkspacePanel = { node, button, key, ready, contextHelp, message, empty, request, preview };
})();
