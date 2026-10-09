/* Shared phone offline presentation. Data and transport stay in WeftOffline. */
(() => {
  const element = (tag, text, className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
  const explanation = '电脑离线，只能聊天和用记忆，不能操作电脑';
  globalThis.WeftOfflineView = {
    mount({ core, nativeCall, identity: readIdentity, host, desktop = false }) {
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
      document.body.append(section, launcher);
      function paint() {
        const view = engine?.view();
        launcher.hidden = !view?.ready && !view?.conversations.length;
        launcher.textContent = offline ? '离线模式' : view?.turns.length ? '离线对话 · 待同步' : '离线对话 · 已同步';
        section.hidden = !(view && (offline || showHistory));
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
          const body = element('div', message.text, 'offline-message-body');
          if (message.role === 'assistant' && globalThis.WeftFormat?.render) body.innerHTML = globalThis.WeftFormat.render(message.text);
          row.append(element('span', message.role === 'user' ? '我' : 'WeftMate'), body); messages.append(row);
        }
      }
      async function start(current) {
        const next = JSON.stringify([current.origin, current.ownerId]);
        if (scope === next) { Object.assign(identity, current); return; }
        if (engine) { await engine.clear(); engine.close(); }
        scope = next; identity = current;
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
            if (['UNAUTHORIZED', 'DEVICE_NOT_TRUSTED'].includes(cause.code || cause.message)) { await engine.clear(); return; }
            if (engine.view().ready) {
              try { await engine.check(); offline = true; error = ''; }
              catch { offline = true; error = '暂时无法核对设备授权，请联网后重试。'; }
            } else if (['OFFLINE_MODEL_REQUIRED', 'OFFLINE_CLOUD_REQUIRED'].includes(cause.code || cause.message)) {
              error = (cause.code || cause.message) === 'OFFLINE_MODEL_REQUIRED' ? '请先在电脑配置一个云模型。' : '请先绑定云账户并批准这台设备。';
            } else { offline = true; error = '尚未同步离线副本，请在电脑在线时连接一次。'; }
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
      close.addEventListener('click', () => { showHistory = false; section.hidden = true; });
      launcher.addEventListener('click', () => { showHistory = true; paint(); input.focus(); });
      document.addEventListener('visibilitychange', () => void tick());
      const timer = setInterval(() => void tick().catch(() => {}), 15000);
      void tick().catch(() => {});
      const originalLogout = core.cloudLogout;
      if (originalLogout) core.cloudLogout = async (...args) => { await engine?.clear(); if (!nativeCall) localStorage.removeItem('weftmate-offline-identity'); return originalLogout(...args); };
      return { tick, close: () => { clearInterval(timer); engine?.close(); section.remove(); launcher.remove(); } };
    },
  };
})();
