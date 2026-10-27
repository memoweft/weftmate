(() => {
  'use strict';
  const node = (tag, cls, text = '') => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; };
  const definition = { title: '浏览器', icon: 'web', create(ctx) {
    const bridge = globalThis.weftmateDesktop;
    const el = node('section', 'browser-panel'); el.setAttribute('aria-label', '浏览器');
    const bar = node('form', 'browser-toolbar'); bar.setAttribute('aria-label', '网页导航');
    const button = (label, icon) => {
      const b = node('button', 'browser-button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
      b.append(WeftIcons.create(icon, 16)); return b;
    };
    const back = button('后退', 'back'), forward = button('前进', 'right'), reload = button('刷新', 'sync');
    const address = node('input', 'browser-address'); address.type = 'text'; address.inputMode = 'url';
    address.setAttribute('aria-label', '网址'); address.placeholder = '输入网址'; address.autocomplete = 'off'; address.spellcheck = false;
    const go = node('button', 'browser-go', '打开'); go.type = 'submit';
    bar.append(back, forward, reload, address, go);
    const title = node('div', 'browser-page-title', '新网页');
    const status = node('div', 'browser-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const viewport = node('div', 'browser-viewport');
    const message = node('div', 'browser-message');
    const explanation = node('p', 'browser-explanation');
    const retry = node('button', 'browser-retry', '重试'); retry.type = 'button';
    message.append(WeftIcons.create('web', 24), explanation, retry); viewport.append(message);
    el.append(bar, title, status, viewport);
    const bindings = new Map();
    let current, shown = false, disposed = false, frame = 0, lastLayout = '', layoutQueue = Promise.resolve();
    const errors = {
      BROWSER_URL_INVALID: '网址格式不对，请输入完整的网页地址。',
      BROWSER_TARGET_BLOCKED: '这个地址暂不支持，请打开公开网页。',
      BROWSER_DOWNGRADE_BLOCKED: '网页跳转到了不安全的地址，请检查网址后重试。',
      BROWSER_LOGIN_REQUIRED: '这个网页需要登录或暂不允许访问。',
      BROWSER_HTTP_ERROR: '网站暂时无法打开，请稍后重试。',
      BROWSER_RENDERER_FAILED: '网页停止响应了，请重试。',
      BROWSER_LOCAL_DESKTOP_REQUIRED: '请在这台电脑的 WeftMate 中打开浏览器。',
      BROWSER_CONVERSATION_UNAVAILABLE: '请先打开一个电脑上的对话。',
      BROWSER_CLOSED: '这个网页已关闭，请重新打开浏览器标签。',
    };
    const errorText = error => Object.entries(errors).find(([code]) => String(error?.message || error).includes(code))?.[1]
      || '网页没打开，请检查网络后重试。';
    function render() {
      const state = current?.state, error = current?.error || state?.error || (state?.closed ? 'BROWSER_CLOSED' : null);
      const desktop = typeof bridge?.browser === 'function';
      const ready = desktop && !!state?.registered && !state.closed;
      back.disabled = !ready || !state.canGoBack; forward.disabled = !ready || !state.canGoForward;
      reload.disabled = !ready || !state.url;
      address.disabled = go.disabled = !ready;
      title.textContent = state?.title || '新网页'; title.title = state?.url || '';
      if (document.activeElement !== address) address.value = state?.url || '';
      status.textContent = error ? '加载失败' : !desktop ? '电脑浏览器' : !ctx.conversationId ? '尚未选择对话'
        : !ready ? '正在准备浏览器…' : state.loading ? '正在加载…' : state.url ? '已打开' : '等待打开网页';
      el.setAttribute('aria-busy', String(desktop && !!ctx.conversationId && (!ready || !!state?.loading) && !error));
      explanation.textContent = !desktop ? '请在电脑上的 WeftMate 中打开网页；手机暂不嵌入浏览器。'
        : !ctx.conversationId ? '先选择一个对话，再打开网页。' : error ? errorText(error)
          : !ready ? '正在准备这个对话的浏览器…' : '输入网址，和助手一起浏览这个网页。';
      message.hidden = !!(ready && state.url && !error);
      retry.hidden = !desktop || !error || state?.closed === true;
      layout();
    }
    function sendLayout(binding, visible, bounds = null) {
      if (!binding?.state?.registered || binding.state.closed) return layoutQueue;
      const input = { conversationId: binding.conversationId, tabId: binding.state.tabId, visible, bounds };
      const key = JSON.stringify(input);
      if (key === lastLayout) return layoutQueue;
      lastLayout = key;
      layoutQueue = layoutQueue.catch(() => {}).then(() => bridge.browser('layout', input)).catch(() => {});
      return layoutQueue;
    }
    function layout() {
      const box = viewport.getBoundingClientRect();
      const covered = [...document.querySelectorAll('dialog[open], [role="dialog"], [role="menu"]')]
        .some(item => !item.hidden && item.getClientRects().length && getComputedStyle(item).visibility !== 'hidden');
      const visible = shown && el.isConnected && el.getClientRects().length > 0 && !covered;
      const x = Math.max(0, box.x), y = Math.max(0, box.y);
      sendLayout(current, !!visible, { x, y, width: Math.max(0, Math.min(innerWidth, box.right) - x),
        height: Math.max(0, Math.min(innerHeight, box.bottom) - y) });
    }
    function tick() { if (!shown || disposed) return; layout(); frame = requestAnimationFrame(tick); }
    async function closeBinding(binding) {
      if (binding.closed || !binding.state?.registered || binding.state.closed) return;
      binding.closed = true;
      await bridge.browser('close', { conversationId: binding.conversationId, tabId: binding.state.tabId }).catch(() => {});
    }
    async function connect() {
      if (!bridge?.browser || !ctx.conversationId || disposed) { render(); return; }
      const key = JSON.stringify([ctx.ownerId, ctx.identityGeneration, ctx.computerId, ctx.conversationId]);
      let binding = bindings.get(key);
      if (!binding) {
        binding = { conversationId: ctx.conversationId, state: null, error: null };
        bindings.set(key, binding);
        binding.ready = bridge.browser('create', { conversationId: binding.conversationId }).then(async state => {
          binding.state = state;
          if (disposed) await closeBinding(binding);
          else if (current === binding) render();
          return state;
        }).catch(error => { binding.error = error; if (current === binding && !disposed) render(); });
      }
      current = binding; render();
      await binding.ready;
    }
    async function command(action, extra = {}) {
      const binding = current;
      if (!binding) return;
      try {
        await binding.ready;
        if (disposed || current !== binding || !binding.state?.registered) return;
        binding.error = null;
        const state = await bridge.browser(action, { conversationId: binding.conversationId, tabId: binding.state.tabId, ...extra });
        binding.state = state;
      } catch (error) { binding.error = error; }
      if (!disposed && current === binding) render();
    }
    bar.onsubmit = event => {
      event.preventDefault();
      const value = address.value.trim();
      if (value) { address.blur(); void command('navigate', { url: /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}` }); }
    };
    address.onfocus = () => address.select();
    back.onclick = () => void command('back'); forward.onclick = () => void command('forward'); reload.onclick = () => void command('reload');
    retry.onclick = () => {
      if (current?.state) { current.error = null; void command('retry'); }
      else { bindings.clear(); current = null; void connect(); }
    };
    const unsubscribe = bridge?.onBrowserState?.(state => {
      for (const binding of bindings.values()) if (binding.state?.tabId === state.tabId) {
        binding.state = state;
        if (binding === current && !disposed) render();
      }
    });
    const resize = new ResizeObserver(layout); resize.observe(viewport);
    const visibility = () => layout(); document.addEventListener('visibilitychange', visibility);
    void connect();
    return { el,
      show() { if (disposed || shown) return; shown = true; render(); tick(); },
      hide() { shown = false; cancelAnimationFrame(frame); return sendLayout(current, false); },
      update(next) { sendLayout(current, false); ctx = next; current = null; lastLayout = ''; void connect(); },
      async dispose() {
        if (disposed) return;
        disposed = true; shown = false; cancelAnimationFrame(frame); resize.disconnect(); unsubscribe?.();
        document.removeEventListener('visibilitychange', visibility);
        await layoutQueue;
        await Promise.all([...bindings.values()].map(async binding => {
          await binding.ready;
          await closeBinding(binding);
        }));
        bindings.clear();
      },
    };
  } };
  // UI-01 supplies the registry. Tests can load this script after their registry
  // and call create(ctx) directly before the workspace shell is merged.
  globalThis.WeftPanels?.register('browser', definition);
})();
