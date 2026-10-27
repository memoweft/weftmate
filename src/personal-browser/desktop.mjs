import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPinnedProxy, canonicalPublicUrl } from './network.mjs';
import { browserExtractScript, browserCaptureSegments, browserCaptureVersion,
  captureText, boundedOutline, boundedLinks } from './index.mjs';

const fault = code => Object.assign(new Error(code), { code });
const sameScope = (tab, scope) => tab.ownerId === scope.ownerId && tab.conversationId === scope.conversationId;

/** The account browser reader and desktop panel share these actual WebContents. */
export class DesktopBrowser extends EventEmitter {
  constructor({ WebContentsView, session, getParent, resolveScope, fallbackReader,
    resolver, connect, syntheticFixture = null }) {
    super();
    Object.assign(this, { WebContentsView, session, getParent, resolveScope, fallbackReader,
      resolver, connect, syntheticFixture });
    this.tabs = new Map(); this.jobs = new Set(); this.closed = false; this.order = 0;
  }

  canonicalUrl(url) { return canonicalPublicUrl(url, this.syntheticFixture); }
  scope(ownerId, id) { return { ownerId, conversationId: this.resolveScope(ownerId, id) }; }
  state(tab) {
    const wc = tab.view?.webContents, live = wc && !wc.isDestroyed();
    const history = live && wc.navigationHistory;
    const previous = history && history.getEntryAtIndex(history.getActiveIndex() - 1);
    return { tabId: tab.id, conversationId: tab.conversationId, registered: tab.registered,
      url: tab.url, title: live ? wc.getTitle() : '', loading: live && wc.isLoading(),
      error: tab.error, canGoBack: !!(previous && previous.url !== 'about:blank'),
      canGoForward: live && wc.navigationHistory.canGoForward(), closed: tab.closed };
  }
  changed(tab) {
    if (!tab.closed) this.paint(tab);
    this.emit('change', { ownerId: tab.ownerId, ...this.state(tab) });
  }
  paint(tab) {
    if (!tab.view || tab.closed) return;
    const parent = tab.parent, wc = parent.webContents;
    const zoom = wc.getZoomFactor();
    const [width, height] = parent.getContentSize();
    const box = tab.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    const x = Math.min(width, Math.max(0, Math.round(box.x * zoom)));
    const y = Math.min(height, Math.max(0, Math.round(box.y * zoom)));
    tab.view.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(box.width * zoom))),
      height: Math.max(0, Math.min(height - y, Math.round(box.height * zoom))) });
    tab.view.setVisible(Boolean(tab.visible && box.width > 0 && box.height > 0 && !tab.error && tab.url));
  }
  hideAll() {
    for (const tab of this.tabs.values()) { tab.visible = false; this.paint(tab); }
  }
  reserve(scope, claimed) {
    const parent = this.getParent();
    if (this.closed || !parent || parent.isDestroyed()) throw fault('BROWSER_UNAVAILABLE');
    const tab = { ...scope, id: `browser-${randomUUID()}`, claimed, parent, view: null,
      registered: false, closed: false, url: '', error: null, generation: 0,
      selected: ++this.order, visible: false, bounds: null, queue: Promise.resolve() };
    // Reserve before any asynchronous registration so immediate Agent requests
    // join the same ready promise rather than creating a second hidden browser.
    this.tabs.set(tab.id, tab);
    tab.ready = this.initialize(tab).catch(async error => {
      await this.remove(tab, false); throw error;
    });
    tab.ready.catch(() => {});
    return tab;
  }
  async initialize(tab) {
    const proxy = createPinnedProxy({ resolver: this.resolver, connect: this.connect,
      syntheticFixture: this.syntheticFixture });
    tab.proxy = proxy;
    const { port } = await proxy.start();
    if (tab.closed) throw fault('BROWSER_CLOSED');
    const partition = 'persist:weftmate-browser-' + createHash('sha256')
      .update(JSON.stringify([tab.ownerId, tab.conversationId, tab.id])).digest('hex');
    const ses = this.session.fromPartition(partition, { cache: false });
    tab.session = ses;
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
      proxyBypassRules: '<-loopback>' });
    if (tab.closed) throw fault('BROWSER_CLOSED');
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event, item) => { event.preventDefault(); item.cancel(); });
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      try {
        if (!/^(about:blank|data:|blob:)/.test(details.url)) this.canonicalUrl(details.url);
        callback({ cancel: false });
      } catch { tab.blocked = true; callback({ cancel: true }); }
    });
    const view = new this.WebContentsView({ webPreferences: { session: ses, nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
      allowRunningInsecureContent: false, spellcheck: false } });
    tab.view = view;
    view.setVisible(false);
    tab.parent.contentView.addChildView(view);
    const wc = view.webContents;
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    wc.setWindowOpenHandler(({ url }) => {
      // Keep link targets in this owned instance; pages never open app windows.
      void this.navigate(tab, url).catch(() => {});
      return { action: 'deny' };
    });
    const checkNavigation = (event, url) => {
      try {
        if (url === 'about:blank' && !tab.registered) return;
        this.canonicalUrl(url);
        if (tab.https && new URL(url).protocol !== 'https:') throw fault('BROWSER_DOWNGRADE_BLOCKED');
      } catch (error) {
        event.preventDefault(); tab.blocked = true; tab.error = error.code;
        this.changed(tab);
      }
    };
    wc.on('will-navigate', checkNavigation);
    wc.on('will-frame-navigate', event => checkNavigation(event, event.url));
    wc.on('will-redirect', (event, url) => checkNavigation(event, url));
    wc.on('will-prevent-unload', event => event.preventDefault());
    wc.on('did-start-navigation', (_event, url, sameDocument, mainFrame) => {
      if (!mainFrame) return;
      if (!sameDocument) {
        tab.generation++; tab.blocked = false; tab.httpStatus = null;
        tab.proxy.resetDocument();
      }
      tab.error = null;
      if (url !== 'about:blank') tab.url = url;
      this.changed(tab);
    });
    wc.on('did-navigate', (_event, url, code) => {
      if (url !== 'about:blank') tab.url = url;
      tab.httpStatus = code;
      if (code >= 400) tab.error = code === 401 || code === 403 ? 'BROWSER_LOGIN_REQUIRED' : 'BROWSER_HTTP_ERROR';
      this.changed(tab);
    });
    wc.on('did-navigate-in-page', (_event, url, mainFrame) => {
      if (mainFrame) { tab.url = url; this.changed(tab); }
    });
    wc.on('did-fail-load', (_event, code, _description, url, mainFrame) => {
      if (!mainFrame || code === -3) return;
      tab.url = url; tab.error = 'BROWSER_NETWORK_ERROR'; this.changed(tab);
    });
    for (const event of ['did-start-loading', 'did-stop-loading', 'page-title-updated']) wc.on(event, () => this.changed(tab));
    wc.on('render-process-gone', () => { tab.error = 'BROWSER_RENDERER_FAILED'; this.changed(tab); });
    wc.once('destroyed', () => { void this.remove(tab, false); });
    tab.onParentClosed = () => { void this.remove(tab); };
    tab.onResize = () => this.paint(tab);
    tab.parent.once('closed', tab.onParentClosed);
    tab.parent.on('resize', tab.onResize);
    tab.parent.webContents.on('zoom-changed', tab.onResize);
    // loadURL resolves only after the actual renderer exists and finished load.
    await wc.loadURL('about:blank');
    if (tab.closed) throw fault('BROWSER_CLOSED');
    tab.registered = true; this.changed(tab);
    return tab;
  }
  selected(scope) {
    return [...this.tabs.values()].filter(tab => sameScope(tab, scope) && !tab.closed)
      .sort((a, b) => b.selected - a.selected)[0];
  }
  async request(ownerId, action, input = {}) {
    if (typeof input.conversationId !== 'string' || input.conversationId.length > 128)
      throw fault('BROWSER_CONVERSATION_UNAVAILABLE');
    const scope = this.scope(ownerId, input.conversationId);
    if (action === 'list') return [...this.tabs.values()].filter(tab => sameScope(tab, scope)).map(tab => this.state(tab));
    if (action === 'create') {
      const unclaimed = [...this.tabs.values()].find(tab => sameScope(tab, scope) && !tab.claimed);
      const tab = unclaimed ?? this.reserve(scope, true);
      tab.claimed = true;
      await tab.ready;
      return this.state(tab);
    }
    const tab = this.tabs.get(input.tabId);
    if (!tab || !sameScope(tab, scope)) throw fault('BROWSER_TAB_UNAVAILABLE');
    if (action === 'close') { await this.remove(tab); return { closed: true }; }
    await tab.ready;
    if (tab.closed) throw fault('BROWSER_CLOSED');
    if (action === 'layout') {
      const box = input.bounds;
      if (box && !['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key]) && Math.abs(box[key]) <= 100_000))
        throw fault('BROWSER_BOUNDS_INVALID');
      tab.bounds = box; tab.visible = input.visible === true;
      if (tab.visible) {
        for (const other of this.tabs.values()) if (other !== tab) { other.visible = false; this.paint(other); }
        tab.selected = ++this.order;
      }
      this.paint(tab);
    } else if (action === 'navigate' || action === 'retry') {
      await this.navigate(tab, action === 'retry' ? tab.url : input.url);
    } else if (action === 'back' || action === 'forward') {
      const history = tab.view.webContents.navigationHistory;
      // Agent navigations have no user gesture. Chromium's goBack may skip
      // those entries; explicit indices preserve the panel's visible history.
      if (action === 'back' && this.state(tab).canGoBack) history.goToIndex(history.getActiveIndex() - 1);
      if (action === 'forward' && history.canGoForward()) history.goToIndex(history.getActiveIndex() + 1);
    } else if (action === 'reload') { await this.navigate(tab, tab.url, true); }
    else if (action !== 'state') throw fault('BROWSER_ACTION_INVALID');
    return this.state(tab);
  }
  navigate(tab, value, reload = false, signal) {
    const operation = async () => {
      await tab.ready;
      if (tab.closed) throw fault('BROWSER_CLOSED');
      if (signal?.aborted) throw fault('BROWSER_CANCELLED');
      try {
        this.canonicalUrl(value);
        tab.url = new URL(value).href; tab.https = new URL(value).protocol === 'https:';
        tab.error = null; tab.blocked = false; tab.proxy.resetDocument();
        this.changed(tab);
        const wc = tab.view.webContents;
        let timer, abort;
        try {
          await Promise.race([wc.loadURL(tab.url, reload ? { extraHeaders: 'pragma: no-cache\n' } : {}),
            new Promise((_, reject) => {
              abort = () => { wc.stop(); reject(fault('BROWSER_CANCELLED')); };
              signal?.addEventListener('abort', abort, { once: true });
              timer = setTimeout(() => { wc.stop(); reject(fault('BROWSER_NETWORK_ERROR')); }, 15_000);
            })]);
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      } catch (error) {
        if (!tab.closed) { tab.error = error.code?.startsWith('BROWSER_') ? error.code : 'BROWSER_NETWORK_ERROR'; this.changed(tab); }
        throw error;
      }
    };
    const result = tab.queue.then(operation);
    tab.queue = result.catch(() => {});
    return result;
  }
  async read(input) {
    if (!this.getParent()) return this.fallbackReader.read(input);
    if (this.jobs.size >= 2) throw fault('BROWSER_BUSY');
    const scope = this.scope(input.ownerId, input.sessionId);
    const tab = this.selected(scope) ?? this.reserve(scope, false);
    const controller = new AbortController();
    const abort = () => { controller.abort(); if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.stop(); };
    input.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15_000);
    const job = { ownerId: input.ownerId, taskId: input.taskId, abort }; this.jobs.add(job);
    try {
      if (input.signal?.aborted) throw fault('BROWSER_CANCELLED');
      const requestedUrl = this.canonicalUrl(input.url);
      await this.navigate(tab, input.url, false, controller.signal);
      await delay(700, null, { signal: controller.signal });
      if (tab.closed) throw fault('BROWSER_CLOSED');
      const wc = tab.view.webContents;
      const generation = tab.generation, before = wc.getURL();
      const extracted = await wc.executeJavaScriptInIsolatedWorld(1001,
        [{ code: browserExtractScript(decodeURIComponent(new URL(input.url).hash.slice(1))) }]);
      if (before !== wc.getURL() || generation !== tab.generation) throw fault('BROWSER_PAGE_CHANGED');
      if (tab.proxy.violation || tab.blocked || tab.error) throw fault(tab.proxy.violation ?? tab.error ?? 'BROWSER_TARGET_BLOCKED');
      if (extracted.needsLogin) throw fault('BROWSER_LOGIN_REQUIRED');
      const finalUrl = this.canonicalUrl(wc.getURL());
      const capture = captureText(extracted.text), capturedText = capture.bytes.toString('utf8');
      if (!capturedText.trim()) throw fault('BROWSER_EMPTY_PAGE');
      const segments = browserCaptureSegments(capture.bytes);
      return { title: Array.from(String(extracted.title)).slice(0, 256).join(''), requestedUrl,
        url: finalUrl, text: segments[0].text, capturedText,
        ...(extracted.capturedFragment ? { capturedFragment: extracted.capturedFragment,
          requestedSectionComplete: !capture.truncated && !extracted.rawTruncated } : {}),
        outline: boundedOutline(extracted.headings), segmentCount: segments.length,
        totalCapturedBytes: capture.bytes.length, versionHash: browserCaptureVersion(finalUrl, capture.bytes),
        captureTruncated: capture.truncated || extracted.rawTruncated || !!extracted.capturedFragment,
        truncated: capture.truncated || extracted.rawTruncated || segments.length > 1,
        links: boundedLinks(extracted.links, this.syntheticFixture), httpStatus: tab.httpStatus ?? 200 };
    } catch (error) { if (controller.signal.aborted) throw fault('BROWSER_CANCELLED'); throw error; }
    finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); this.jobs.delete(job); }
  }
  cancelTask(ownerId, taskId) {
    this.fallbackReader.cancelTask(ownerId, taskId);
    for (const job of this.jobs) if (job.ownerId === ownerId && job.taskId === taskId) job.abort();
  }
  status() { return this.closed ? { available: false } : this.fallbackReader.status(); }
  async remove(tab, wait = true) {
    if (tab.closed) return;
    tab.closed = true; tab.registered = false; this.tabs.delete(tab.id);
    if (wait) await tab.ready.catch(() => {});
    if (tab.view) {
      if (!tab.parent.isDestroyed()) tab.parent.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
    }
    if (tab.onParentClosed) tab.parent.removeListener('closed', tab.onParentClosed);
    if (tab.onResize) {
      tab.parent.removeListener('resize', tab.onResize);
      tab.parent.webContents.removeListener('zoom-changed', tab.onResize);
    }
    await tab.session?.closeAllConnections();
    tab.session?.flushStorageData();
    await tab.proxy?.close();
    this.changed(tab);
  }
  async releaseSession(ownerId, sessionId) {
    if (![...this.tabs.values()].some(tab => tab.ownerId === ownerId)) return;
    const scope = { ownerId, conversationId: this.resolveScope(ownerId, sessionId, true) };
    await Promise.all([...this.tabs.values()].filter(tab => sameScope(tab, scope)).map(tab => this.remove(tab)));
  }
  async releaseAll() { await Promise.all([...this.tabs.values()].map(tab => this.remove(tab))); }
  async close() {
    this.closed = true;
    for (const job of this.jobs) job.abort();
    await this.releaseAll(); await this.fallbackReader.close();
  }
}
