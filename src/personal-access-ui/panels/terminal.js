(() => {
  'use strict';
  const base = '/personal/v1';
  let assets;
  // xterm creates only its own measured grid/theme styles through this document.
  // Give those elements the host's per-response style nonce; keep the page CSP.
  const terminalDocument = new Proxy(document, { get(target, key) {
    if (key === 'createElement') return (tag, ...args) => {
      const element = target.createElement(tag, ...args);
      if (tag.toLowerCase() === 'style') element.nonce = document.querySelector('meta[name="weft-style-nonce"]')?.content || '';
      return element;
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  function loadAssets() {
    return assets ||= (async () => {
      for (const name of ['vendor/terminal/xterm.css', 'panels/terminal.css']) {
        if (document.querySelector(`link[data-terminal-asset="${name}"]`)) continue;
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = `${base}/ui/${name}`;
        link.dataset.terminalAsset = name; document.head.append(link);
      }
      for (const name of ['xterm.js', 'addon-fit.js']) await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = `${base}/ui/vendor/terminal/${name}`;
        script.onload = resolve; script.onerror = reject; document.head.append(script);
      });
    })().catch(error => { assets = null; throw error; });
  }
  async function auth() {
    const response = await fetch(`${base}/auth/me`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('UNAUTHORIZED');
    return response.json();
  }
  async function request(path, method, body, ownerId) {
    const me = await auth();
    if (ownerId && me.account.ownerId !== ownerId) throw new Error('UNAUTHORIZED');
    const response = await fetch(`${base}${path}`, { method, credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.code || 'BACKEND_UNAVAILABLE');
    return result;
  }
  function create(initialContext) {
    let ctx = initialContext, active, disposed = false, generation = 0;
    const identity = [ctx.ownerId, ctx.identityGeneration];
    const tabId = ctx.tabId || `tab-${crypto.randomUUID()}`, sessions = new Map();
    const el = document.createElement('section'); el.className = 'terminal-panel'; el.setAttribute('aria-label', '交互终端');
    const host = document.createElement('div'); host.className = 'terminal-sessions'; el.append(host);
    const empty = document.createElement('p'); empty.className = 'terminal-directory'; host.append(empty);
    function makeSession(key, context) {
      const wrap = document.createElement('div'); wrap.className = 'terminal-session';
      const toolbar = document.createElement('div'); toolbar.className = 'terminal-toolbar';
      const status = document.createElement('span'); status.className = 'terminal-status'; status.setAttribute('role', 'status'); status.textContent = '正在打开终端…';
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'terminal-retry'; retry.textContent = '重试'; retry.hidden = true;
      toolbar.append(status, retry);
      const directory = document.createElement('p'); directory.className = 'terminal-directory'; directory.textContent = context.mode === 'work' ? '工作目录：正在确认…' : '用户主目录：正在确认…';
      const screen = document.createElement('div'); screen.className = 'terminal-screen';
      wrap.append(toolbar, directory, screen); host.append(wrap);
      const s = { key, wrap, status, retry, directory, screen, cursor: 0, reconnects: 0, closed: false, ready: false,
        context, attempt: 0, id: null, terminal: null, socket: null, timer: null };
      sessions.set(key, s);
      retry.addEventListener('click', async () => {
        retry.hidden = true;
        if (s.exited) {
          try { await request(`/terminals/${s.id}`, 'DELETE', undefined, identity[0]); }
          catch { status.textContent = '旧终端未能关闭，请重试。'; retry.hidden = false; return; }
          s.id = null; s.creation = null; s.cursor = 0; s.exited = false; s.attempt++; s.terminal.reset();
        }
        s.reconnects = 0; void connect(s);
      });
      return s;
    }
    function theme(s) {
      if (!s?.terminal) return;
      const style = getComputedStyle(el), color = name => style.getPropertyValue(name).trim();
      const palette = ['--surface', '--danger', '--success', '--warning', '--brand', '--syntax-number', '--syntax-string', '--ink'];
      const names = ['black','red','green','yellow','blue','magenta','cyan','white'];
      const ansi = Object.fromEntries(names.flatMap((name, i) => [[name, color(palette[i])], [`bright${name[0].toUpperCase()}${name.slice(1)}`, color(palette[i])]]));
      s.terminal.options.theme = { ...ansi, background: color('--surface'), foreground: color('--ink'),
        cursor: color('--ink'), cursorAccent: color('--surface'), selectionBackground: color('--accent-soft') };
    }
    function fit(s) {
      if (!s?.ready || active !== s || el.hidden || !el.isConnected || !s.screen.clientWidth || !s.screen.clientHeight) return;
      s.fit.fit();
    }
    function send(s, message) { if (s.ready && s.socket?.readyState === WebSocket.OPEN) s.socket.send(JSON.stringify(message)); }
    async function connect(s) {
      if (s.closed || disposed || s.connecting) return;
      const requestGeneration = generation;
      clearTimeout(s.timer); s.connecting = true; s.ready = false; s.status.textContent = s.id ? '正在重新连接…' : '正在打开终端…';
      try {
        await loadAssets();
        if (s.closed || disposed) return;
        if (!s.terminal) {
          s.terminal = new Terminal({ cursorBlink: true, fontFamily: getComputedStyle(el).getPropertyValue('--wm-font-family-mono-desktop').trim(), fontSize: 12,
            documentOverride: terminalDocument, scrollback: 10000, allowProposedApi: false, disableStdin: true });
          s.fit = new FitAddon.FitAddon(); s.terminal.loadAddon(s.fit); s.terminal.open(s.screen); theme(s);
          s.terminal.onData(data => send(s, { type: 'input', data }));
          s.terminal.onResize(({ cols, rows }) => send(s, { type: 'resize', cols, rows }));
        }
        if (!s.id) {
          s.creation = request('/terminals', 'POST', { conversationId: s.context.conversationId,
            tabId: `${tabId}-${s.attempt}`, ...(s.context.computerId ? { computerId: s.context.computerId } : {}),
            cols: s.terminal.cols, rows: s.terminal.rows }, identity[0]);
          const result = await s.creation;
          s.id = result.terminalId; s.releaseToken = result.releaseToken; s.cwd = result.cwd;
          if (requestGeneration === generation && active === s) { s.directory.textContent = `起始目录：${result.cwd}`; s.directory.title = result.cwd; }
          if (s.closed || disposed) return;
        }
        const me = await auth();
        if (identity[0] && me.account.ownerId !== identity[0]) throw new Error('UNAUTHORIZED');
        if (s.closed || disposed) return;
        const url = new URL(`${base}/terminals/${s.id}/connect`, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(url); s.socket = ws;
        s.terminal.options.disableStdin = true;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'resume', after: s.cursor, csrfToken: me.csrfToken }));
        ws.onmessage = event => {
          if (s.closed || disposed || s.socket !== ws) return;
          const message = JSON.parse(event.data);
          if (message.type === 'output' && message.seq > s.cursor) { s.terminal.write(message.data); s.cursor = message.seq; }
          if (message.type === 'gap') { s.terminal.reset(); s.terminal.writeln('较早的输出已超出保留范围，以下为最近的内容。'); }
          if (message.type === 'ready') {
            if (active === s && s.cwd) { s.directory.textContent = `起始目录：${s.cwd}`; s.directory.title = s.cwd; }
            s.ready = true; s.reconnects = 0; s.connecting = false; s.exited = message.state === 'exited';
            s.terminal.resize(message.cols, message.rows);
            s.terminal.options.disableStdin = s.exited;
            s.status.textContent = s.exited ? `终端已结束（${message.exitCode}）` : '已连接';
            s.retry.textContent = s.exited ? '重新打开' : '重试'; s.retry.hidden = !s.exited;
            s.terminal.write('', () => { fit(s); if (active === s && !el.hidden) s.terminal.focus(); });
          }
          if (message.type === 'exit') {
            s.exited = true; s.terminal.options.disableStdin = true; s.status.textContent = `终端已结束（${message.exitCode}）`;
            s.retry.textContent = '重新打开'; s.retry.hidden = false;
          }
          if (message.type === 'closed') { s.exited = true; ws.close(); }
        };
        ws.onclose = event => {
          if (s.closed || disposed || s.socket !== ws) return;
          s.ready = false; s.connecting = false; s.terminal.options.disableStdin = true;
          if (s.exited) return;
          if (event.code === 1008) { s.status.textContent = '登录已失效或连接被拒绝，请重新登录后重试。'; s.retry.hidden = false; return; }
          reconnect(s);
        };
        ws.onerror = () => {}; // close handles retry, keeping one reconnect timer.
      } catch (error) {
        s.connecting = false;
        if (s.closed || disposed) return;
        s.status.textContent = error.message === 'PROJECT_NOT_SELECTED' ? '工作目录不可用，请为此对话选择文件夹后重试。' : '终端连接失败，请重试。';
        s.retry.hidden = false;
      } finally { if (s.closed || disposed) s.connecting = false; }
    }
    function reconnect(s) {
      if (s.reconnects >= 8) { s.status.textContent = '连接已断开，点击重试可接回原终端。'; s.retry.hidden = false; return; }
      s.status.textContent = '连接已断开，正在接回原终端…';
      s.timer = setTimeout(() => void connect(s), Math.min(500 * 2 ** s.reconnects++, 10000));
    }
    function select(context) {
      if (disposed) return;
      generation++;
      if (identity[0] !== context.ownerId || identity[1] !== context.identityGeneration) { void dispose(); return; }
      ctx = context;
      if (active) active.wrap.hidden = true;
      active = null;
      const unavailable = !ctx.conversationId || /^(draft:|phone:)/.test(ctx.conversationId);
      empty.hidden = !unavailable;
      if (unavailable) { empty.textContent = ctx.conversationId?.startsWith('draft:') ? '先发送一条消息保存这个对话，再打开终端。' : '请选择电脑上的对话，再打开终端。'; return; }
      const key = `${ctx.computerId || ''}:${ctx.conversationId}`;
      active = sessions.get(key) || makeSession(key, ctx); active.wrap.hidden = false;
      active.context = ctx;
      if (active.cwd) { active.directory.textContent = `起始目录：${active.cwd}`; active.directory.title = active.cwd; }
      if (!active.id && !active.connecting) void connect(active);
      theme(active); fit(active);
    }
    let resizeTimer;
    const resize = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => fit(active), 80); }); resize.observe(el);
    const appearance = new MutationObserver(() => { for (const s of sessions.values()) theme(s); });
    appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    select(ctx);
    async function dispose() {
      if (disposed) return;
      disposed = true; generation++; clearTimeout(resizeTimer); resize.disconnect(); appearance.disconnect();
      el.remove();
      await Promise.all([...sessions.values()].map(async s => {
        s.closed = true; clearTimeout(s.timer); s.terminal?.dispose();
        // Finish an in-flight creation so its release proof is never lost.
        const created = await s.creation?.catch(() => null);
        const id = s.id || created?.terminalId, token = s.releaseToken || created?.releaseToken;
        if (id && token) {
          const released = await fetch(`${base}/terminals/${id}/release`, { method:'POST', credentials:'same-origin', keepalive:true,
            headers:{'content-type':'application/json'}, body:JSON.stringify({releaseToken:token}) });
          if (!released.ok) throw new Error('TERMINAL_RELEASE_FAILED');
        }
        s.socket?.close();
      }));
    }
    return { el,
      show() { el.hidden = false; theme(active); fit(active); active?.terminal?.focus(); },
      hide() { el.hidden = true; },
      update: select,
      dispose,
    };
  }
  const panel = { title: '终端', icon: 'terminal', create };
  globalThis.WeftTerminalPanel = panel;
  globalThis.WeftPanels?.register('terminal', panel);
})();
