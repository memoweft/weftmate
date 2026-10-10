/* Shared phone offline presentation. Data and transport stay in WeftOffline. */
(() => {
  const element = (tag, text, className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
  const explanation = '电脑离线，只能聊天和用记忆，不能操作电脑';
  globalThis.WeftOfflineView = {
    syncFailure(cause) {
      const code = cause?.code || cause?.message;
      if (['UNAUTHORIZED', 'DEVICE_NOT_TRUSTED', 'OFFLINE_RESET_REQUIRED'].includes(code) || cause?.status === 401)
        return { unreachable: false, clear: true, message: '设备授权已失效，请重新登录并连接电脑。' };
      if (['NETWORK', 'HOST_UNAVAILABLE', 'HOST_OFFLINE'].includes(code))
        return { unreachable: true, message: '电脑暂时无法连接，可打开离线对话。' };
      return { unreachable: false, message: ({ OFFLINE_MODEL_REQUIRED: '请先在电脑配置一个云模型。',
        OFFLINE_CLOUD_REQUIRED: '请先绑定云账户并批准这台设备。',
        FORBIDDEN: '离线副本同步没有权限，请重新连接电脑。',
        INVALID_REQUEST: '离线副本同步未完成，请重新连接电脑。' })[code] || '离线副本同步未完成，请稍后重试。' };
    },
    mount({ core, nativeCall, identity: readIdentity, host, desktop = false, openConversation = () => {} }) {
      if (desktop) return;
      let engine, scope, identity, polling = false, offline = false, selected = null, error = '', showHistory = false;
      const section = element('section', '', 'offline-chat'); section.hidden = true; section.setAttribute('aria-label', '离线对话');
      const header = element('header'), title = element('h1', '离线模式'), mode = element('p', explanation);
      const close = element('button', '返回'), fresh = element('button', '新对话'); close.type = fresh.type = 'button';
      const selector = element('select'); selector.setAttribute('aria-label', '离线对话列表');
      header.append(close, title, fresh, mode, selector);
      const messages = element('div', '', 'offline-messages'); messages.setAttribute('role', 'log'); messages.setAttribute('aria-live', 'polite');
      const form = element('form', '', 'offline-composer'), label = element('label', explanation), input = element('textarea');
      input.rows = 2; input.maxLength = 16384; input.placeholder = '继续聊聊…'; input.setAttribute('aria-label', '离线消息'); label.append(input);
      const status = element('p'); status.setAttribute('role', 'status');
      const send = element('button', '发送'); send.type = 'submit'; form.append(label, status, send); section.append(header, messages, form);
      const launcher = element('button', '离线对话', 'offline-launcher'); launcher.hidden = true; launcher.type = 'button';
      const notice = element('p', '', 'offline-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
      // The conversation's scroll area owns this content. It is never a fixed
      // overlay above approvals, settings, project dialogs or device actions.
      (document.getElementById?.('chat-scroll') || document.body).append(section);
      document.body.append(launcher, notice);
      function paint() {
        const view = engine?.view();
        launcher.hidden = !offline && !view?.conversations.length;
        launcher.textContent = offline ? '离线模式' : view?.turns.length ? '离线对话 · 待同步' : '离线对话 · 已同步';
        // Polling updates availability, never navigation. Only the user's launcher
        // action opens this page, so pending approvals and settings stay usable.
        section.hidden = !(view && showHistory);
        notice.textContent = error; notice.hidden = !error || showHistory;
        title.textContent = offline ? '离线模式' : '离线对话';
        mode.textContent = offline ? explanation : view?.turns.length ? '电脑已上线，正在同步离线对话' : '已同步';
        label.firstChild.textContent = offline ? explanation : '这段对话已同步，可返回电脑对话继续';
        input.disabled = !offline || !view?.ready || view.running;
        send.disabled = input.disabled || !input.value.trim();
        status.textContent = error || (view?.running ? '正在回复…' : view?.turns.length ? '电脑上线后自动同步' : '');
        const options = (view?.conversations || []).map(c => {
          const option = element('option', c.turns[0]?.messages[0]?.text.slice(0, 24) || '新对话'); option.value = c.id; return option;
        });
        for (const recent of view?.snapshot?.recent || []) {
          const option = element('option', '最近对话 · ' + (recent.messages.find(m => m.role === 'user')?.text.slice(0, 20) || '继续聊'));
          option.value = 'recent:' + recent.id; options.push(option);
        }
        selector.replaceChildren(element('option', '新对话'), ...options); selector.options[0].value = ''; selector.value = selected || '';
        const conversation = view?.conversations.find(c => c.id === selected);
        const recent = selected?.startsWith('recent:') ? view?.snapshot?.recent?.find(c => c.id === selected.slice(7)) : null;
        messages.replaceChildren();
        if (!conversation?.turns.length && !recent) messages.append(element('p', '可以继续聊聊。与当前问题相关的记忆会帮助回答。', 'offline-empty'));
        const rows = [...(recent?.messages || conversation?.context || []), ...(conversation?.turns || []).flatMap(t => t.messages)];
        for (const message of rows) {
          const row = element('article', '', `offline-message ${message.role}`);
          const body = globalThis.WeftContent ? WeftContent.create(message.text, 'offline-message-body markdown-body') : element('div', message.text, 'offline-message-body');
          if (!globalThis.WeftContent && message.role === 'assistant' && globalThis.WeftFormat?.render) body.innerHTML = globalThis.WeftFormat.render(message.text);
          row.append(element('span', message.role === 'user' ? '我' : 'WeftMate'), body); messages.append(row);
        }
      }
      async function start(current) {
        const next = JSON.stringify([current.origin, current.ownerId]);
        if (scope === next) { Object.assign(identity, current); return; }
        if (engine) { await engine.clear(); engine.close(); }
        scope = next; identity = current;
        offline = false; showHistory = false; error = '';
        const vault = nativeCall ? WeftOffline.nativeVault(nativeCall) : await WeftOffline.browserVault(scope);
        engine = await WeftOffline.create({ vault, identity, host, control: hostId => core.cloudOfflineStatus(hostId), notify: paint });
        selected = engine.view().conversations.at(-1)?.id || null;
        if (!nativeCall) localStorage.setItem('weftmate-offline-identity', JSON.stringify(current));
      }
      async function tick() {
        if (polling || document.visibilityState === 'hidden') return;
        polling = true;
        try {
          let current = await readIdentity();
          if (!current && !nativeCall) { try { current = JSON.parse(localStorage.getItem('weftmate-offline-identity')); } catch {} }
          if (!current?.ownerId || !current.hostId || !current.deviceId) return;
          await start(current);
          try { if (await engine.sync()) { offline = false; error = ''; } }
          catch (cause) {
            const failure = globalThis.WeftOfflineView.syncFailure(cause);
            // A replica request can time out while the host still serves tasks.
            // Confirm transport loss separately before offering offline mode.
            if ((cause.code || cause.message) === 'NETWORK') {
              try { await core.accessApi('/status'); failure.unreachable = false; failure.message = '离线副本同步未完成，请稍后重试。'; }
              catch (probeError) { Object.assign(failure, globalThis.WeftOfflineView.syncFailure(probeError)); }
            }
            offline = failure.unreachable; error = failure.message;
            if (failure.clear) { showHistory = false; await engine.clear(); }
            else if (offline && engine.view().ready) {
              try { await engine.check(); }
              catch (checkError) { const authorization = globalThis.WeftOfflineView.syncFailure(checkError);
                if (authorization.clear) { offline = false; showHistory = false; }
                error = '暂时无法核对设备授权，请联网后重试。'; }
            } else if (offline) error = '尚未同步离线副本，请在电脑在线时连接一次。';
          }
          paint();
        } finally { polling = false; }
      }
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (!engine || send.disabled) return;
        error = ''; const text = input.value; input.value = ''; paint();
        try { const result = await engine.send(text, selected); selected = result.conversationId; }
        catch (cause) { error = (cause.code || cause.message) === 'OFFLINE_RESET_REQUIRED'
          ? '副本已清理，电脑上线后会重新同步。' : '回复未完成，请检查网络或模型配置后重试。'; }
        paint(); messages.scrollTop = messages.scrollHeight;
      });
      input.addEventListener('input', () => { send.disabled = !input.value.trim() || engine?.view().running; });
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
      selector.addEventListener('change', () => { selected = selector.value || null; paint(); });
      fresh.addEventListener('click', () => { selected = null; paint(); input.focus(); });
      close.addEventListener('click', () => { showHistory = false; paint(); });
      launcher.addEventListener('click', () => { openConversation(); showHistory = true; paint(); section.scrollIntoView?.({ block: 'start' }); input.focus(); });
      document.addEventListener('visibilitychange', () => void tick());
      const timer = setInterval(() => void tick().catch(() => {}), 15000);
      void tick().catch(() => {});
      const originalLogout = core.cloudLogout;
      core.clearOfflineData = async () => {showHistory=false;offline=false;error='';await engine?.clear();paint();};
      if (originalLogout) core.cloudLogout = async (...args) => { showHistory = false; offline = false; error = ''; await engine?.clear(); paint(); if (!nativeCall) localStorage.removeItem('weftmate-offline-identity'); return originalLogout(...args); };
      return { tick, close: () => { clearInterval(timer); engine?.close(); section.remove(); launcher.remove(); notice.remove(); } };
    },
  };
})();
