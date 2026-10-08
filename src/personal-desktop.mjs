/** Native shell for the same authenticated /personal/v1 client used remotely. */
import { app, BrowserWindow, ipcMain, Notification, screen, shell, session, nativeTheme, safeStorage } from 'electron';
import { hostname } from 'node:os';
import { createHash, X509Certificate } from 'node:crypto';
import { desktopAuthStorage } from './personal-desktop-auth.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validArtifactFileName } from './personal-artifacts/index.mjs';
import { windowIcon, notificationIcon } from './app-icons.mjs';

export function desktopNotification(event) {
  if (event.type === 'approval.requested') return { title: '需要审批', body: '打开对话查看并决定是否允许。' };
  if (event.type === 'question.asked') return { title: '需要回答', body: '打开对话补充信息。' };
  if (event.type === 'turn.ended' && event.data?.reason === 'completed') return { title: '任务完成', body: '打开对话查看结果。' };
  return null;
}

export function restoreDesktopBounds(saved, displays) {
  const bounds = saved?.bounds;
  if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) ||
      bounds.width < 760 || bounds.height < 520) return { width: 1200, height: 800 };
  const display = displays.find(({ workArea: area }) => bounds.x + bounds.width > area.x &&
    bounds.y + bounds.height > area.y && bounds.x < area.x + area.width && bounds.y < area.y + area.height);
  if (!display) return { width: 1200, height: 800 };
  const area = display.workArea;
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  return { width, height, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) };
}

export function createPersonalDesktop({ origin, setupGrant = null, isQuitting, startInTray = false, onStatus = () => {} }) {
  const stateFile = join(app.getPath('userData'), 'desktop-window.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* first launch */ }
  const desktopSession = session.fromPartition('persist:weftmate-desktop');
  const palette = () => nativeTheme.shouldUseDarkColors
    ? { color: '#202020', symbolColor: '#ffffff', height: 44 }
    : { color: '#faf9f6', symbolColor: '#202020', height: 44 };
  let resolvedPalette = null;
  const bounds = restoreDesktopBounds(saved, screen.getAllDisplays());
  const win = new BrowserWindow({
    ...bounds, minWidth: 760, minHeight: 520,
    title: 'WeftMate', icon: windowIcon(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI), show: false, backgroundColor: palette().color,
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: palette() } : {}),
    webPreferences: { session: desktopSession, preload: join(import.meta.dirname, 'personal-desktop-preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  // On Windows at fractional DPI, constructor dimensions can include a different frame inset.
  if (Number.isFinite(bounds.x)) win.setBounds(bounds);
  const uiUrl = new URL('/personal/v1/ui', origin).href;
  let activeOrigin = origin;
  let certificateVerifier = null;
  const status = { host: '启动中', model: '未选择' };
  const updateStatus = next => { Object.assign(status, next); onStatus({ ...status }); };
  const trusted = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
    new URL(event.senderFrame.url).origin === activeOrigin && ['/personal/v1/ui', '/personal/v1/ui/'].includes(new URL(event.senderFrame.url).pathname);
  const handle = (channel, callback) => ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Desktop bridge unavailable');
    return callback(...args);
  });
  const fetchLocal = path => desktopSession.fetch(new URL(`/personal/v1${path}`, activeOrigin).href, { credentials: 'include' });
  const jsonLocal = async path => {
    const response = await fetchLocal(path);
    if (!response.ok) throw new Error('Session unavailable');
    return response.json();
  };
  const loginArgs = [
    ...(!app.isPackaged ? [app.getAppPath()] : []), '--personal-host', '--start-in-tray',
    `--user-data-dir=${app.getPath('userData')}`,
    ...process.argv.filter(arg => /^--(?:access-port|workspace-dir|public-origin|personal-memory-config|local-model-config|android-package-path|mobile-ui-dir)=/.test(arg) || arg === '--trust-loopback-proxy'),
  ];
  const loginOptions = { path: process.execPath, args: loginArgs };
  const settings = () => ({ autoStart: app.getLoginItemSettings(loginOptions).openAtLogin,
    autoStartSupported: process.platform === 'win32' || process.platform === 'darwin' });
  handle('wm:desktop:settings', settings);
  const authStore = desktopAuthStorage(join(app.getPath('userData'), 'desktop-auth.enc'), safeStorage);
  handle('wm:desktop:identity', () => ({ deviceName: hostname(), localOrigin: origin }));
  handle('wm:desktop:credentials', (key, value, remove) => authStore.credentials(key, value, remove));
  handle('wm:desktop:key', scope => authStore.key(scope));
  handle('wm:desktop:proof', (scope, input) => authStore.sign(scope, input));
  handle('wm:desktop:key-reset', scope => authStore.resetKey(scope));
  handle('wm:desktop:connect-host', async ({ hostId, baseUrl } = {}) => {
    const trustedHost = authStore.credentials('trusted-host:' + hostId);
    const target = new URL(baseUrl);
    if (!trustedHost || target.protocol !== 'https:' || target.username || target.password || target.search || target.hash ||
      ![trustedHost.origin, trustedHost.relay?.baseUrl].includes(target.origin)) throw new Error('HOST_TRUST_INVALID');
    // Standard certificate validation runs first; a manually delivered pin adds
    // possession of the specific installation TLS key on top of it.
    const previousOrigin = activeOrigin, previousVerifier = certificateVerifier;
    certificateVerifier = (request, done) => {
      if (request.hostname !== target.hostname) { done(-3); return; }
      try {
        const pin = createHash('sha256').update(new X509Certificate(request.certificate.data).publicKey.export({ type: 'spki', format: 'der' })).digest('base64url');
        done(request.verificationResult === 'net::OK' && pin === trustedHost.tlsSpki ? 0 : -2);
      } catch { done(-2); }
    };
    desktopSession.setCertificateVerifyProc(certificateVerifier);
    activeOrigin = target.origin;
    try { await win.loadURL(new URL('/personal/v1/ui', activeOrigin).href); }
    catch (error) {
      activeOrigin = previousOrigin; certificateVerifier = previousVerifier;
      desktopSession.setCertificateVerifyProc(previousVerifier);
      await win.loadURL(new URL('/personal/v1/ui', activeOrigin).href); throw error;
    }
    return { connected: true };
  });
  handle('wm:desktop:model', name => { if (typeof name === 'string') updateStatus({ model: name }); });
  handle('wm:desktop:theme', ({ color, symbolColor } = {}) => {
    if (process.platform === 'win32') { win.setTitleBarOverlay({ color, symbolColor, height: 44 }); resolvedPalette = { color, symbolColor, height: 44 }; }
  });
  handle('wm:desktop:auto-start', enabled => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid startup setting');
    app.setLoginItemSettings({ ...loginOptions, openAtLogin: enabled });
    return settings();
  });
  handle('wm:desktop:artifact', async ({ artifactId, action } = {}) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(artifactId) || !['open', 'show'].includes(action)) throw new Error('Invalid artifact');
    // Authorization and checksum verification remain in the existing artifact download route.
    // The renderer passes an ID, never an arbitrary filesystem path or URL.
    const response = await fetchLocal(`/artifacts/${artifactId}/download`);
    if (!response.ok) throw new Error('Artifact unavailable');
    const disposition = response.headers.get('content-disposition') || '';
    const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const fileName = encodedName ? decodeURIComponent(encodedName) : /filename="([^"]+)"/.exec(disposition)?.[1];
    if (!validArtifactFileName(fileName)) throw new Error('Invalid artifact name');
    const directory = join(app.getPath('userData'), 'desktop-artifacts', artifactId);
    mkdirSync(directory, { recursive: true });
    const file = join(directory, fileName);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    if (action === 'show') shell.showItemInFolder(file);
    else { const error = await shell.openPath(file); if (error) throw new Error('Default application unavailable'); }
    return { opened: true };
  });
  let pendingConversation = null, clientReady = false, maximizeOnShow = saved.maximized === true;
  const show = sessionId => {
    if (win.isDestroyed()) return;
    if (maximizeOnShow) { win.maximize(); maximizeOnShow = false; }
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    if (sessionId) pendingConversation = sessionId;
    if (pendingConversation && clientReady) {
      win.webContents.send('wm:desktop:conversation', pendingConversation);
      pendingConversation = null;
    }
  };
  win.webContents.on('did-start-loading', () => { clientReady = false; });
  win.webContents.on('did-finish-load', () => { clientReady = true; if (pendingConversation) show(); });
  win.webContents.on('page-title-updated', event => { event.preventDefault(); win.setTitle('WeftMate'); });
  win.webContents.on('will-navigate', (event, url) => { if (url !== new URL('/personal/v1/ui', activeOrigin).href) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const updatePalette = () => {
    if (!win.isDestroyed() && process.platform === 'win32') {
      win.setTitleBarOverlay(resolvedPalette ?? palette());
      win.setIcon(windowIcon(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI));
    }
  };
  nativeTheme.on('updated', updatePalette);
  const save = () => {
    if (!win.isDestroyed()) writeFileSync(stateFile, JSON.stringify({ bounds: win.getNormalBounds(), maximized: maximizeOnShow || win.isMaximized() }));
  };
  win.on('close', event => { save(); if (!isQuitting()) { event.preventDefault(); win.hide(); } });
  win.on('resized', save); win.on('moved', save);
  // Poll authenticated history in main so hidden windows and other conversations still notify.
  // Watermarks prevent replay of completed historical turns after login/restart.
  const watermarks = new Map(), notifications = new Set();
  let timer, stopped = false, ownerId = null, initialized = false;
  async function poll() {
    try {
      const meResponse = await fetchLocal('/auth/me');
      if (meResponse.status === 401) { watermarks.clear(); ownerId = null; initialized = false; updateStatus({ host: '运行中', model: '未登录' }); return; }
      if (!meResponse.ok) throw new Error('Session unavailable');
      const me = await meResponse.json();
      const identity = `${me.account?.ownerId}:${me.device?.id}`;
      if (ownerId !== identity) { ownerId = identity; watermarks.clear(); initialized = false; }
      const { sessions = [] } = await jsonLocal('/sessions');
      for (const row of sessions) {
        const last = watermarks.get(row.sessionId);
        let cursor = last ?? -1;
        do {
          const page = await jsonLocal(`/sessions/${encodeURIComponent(row.sessionId)}/events?afterSeq=${cursor}&limit=200`);
          for (const event of page.events || []) {
            const message = (last !== undefined || initialized) && desktopNotification(event);
            if (!message || stopped || !Notification.isSupported()) continue;
            const notification = new Notification({ ...message, icon: notificationIcon, title: `WeftMate · ${message.title}` });
            notifications.add(notification);
            notification.on('click', () => show(row.sessionId));
            notification.on('close', () => notifications.delete(notification));
            notification.on('show', () => app.emit('weftmate-desktop-notification-shown', { sessionId: row.sessionId, type: event.type }));
            notification.show();
            // Native event for integration tests/diagnostics; no conversation content.
            app.emit('weftmate-desktop-notification', { sessionId: row.sessionId, type: event.type });
          }
          if (!Number.isSafeInteger(page.nextSeq) || page.nextSeq <= cursor) break;
          cursor = page.nextSeq; watermarks.set(row.sessionId, cursor);
          if (!page.hasMore) break;
        } while (!stopped);
      }
      initialized = true;
      const hostStatus = await jsonLocal('/status');
      updateStatus({ host: hostStatus.backend?.runtime === 'ready' ? '运行中' : '暂不可用' });
    } catch { updateStatus({ host: '暂不可用' }); /* Preserve notification watermarks on a transient failure. */ }
    finally { if (!stopped) timer = setTimeout(poll, 2000); }
  }
  void poll();
  const ready = win.loadURL(uiUrl + (setupGrant ? `#setup=${encodeURIComponent(setupGrant)}` : '')).then(() => { if (!startInTray) show(); });
  return { window: win, show, ready, async close() {
    stopped = true; clearTimeout(timer);
    for (const notification of notifications) notification.close();
    nativeTheme.removeListener('updated', updatePalette);
    for (const channel of ['wm:desktop:settings', 'wm:desktop:identity', 'wm:desktop:credentials', 'wm:desktop:key', 'wm:desktop:key-reset', 'wm:desktop:proof', 'wm:desktop:connect-host', 'wm:desktop:theme', 'wm:desktop:model', 'wm:desktop:auto-start', 'wm:desktop:artifact']) ipcMain.removeHandler(channel);
    save(); await desktopSession.cookies.flushStore(); desktopSession.flushStorageData();
  } };
}
