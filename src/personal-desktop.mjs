import { captureScreenRegion } from './personal-desktop-capture.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import packageInfo from '../package.json' with { type: 'json' };
import { quoteWindowsLoginArgs, loginItemEnabled } from './desktop-autostart.mjs';
/** Native shell for the same authenticated /personal/v1 client used remotely. */
import { app, BrowserWindow, ipcMain, Notification, screen, shell, session, nativeTheme, safeStorage, dialog, clipboard } from 'electron';
import { hostname } from 'node:os';
import { createHash, X509Certificate } from 'node:crypto';
import { desktopAuthStorage } from './personal-desktop-auth.mjs';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createLatestFileWriter } from './latest-file-writer.mjs';
import { join } from 'node:path';
import { validArtifactFileName } from './personal-artifacts/index.mjs';
import { windowIcon, notificationIcon } from './app-icons.mjs';
import { nativeEventNotification } from './personal-access/notification-content.mjs';

export function desktopNotification(event, taskTitle) {
  return nativeEventNotification(event, taskTitle);
}

export function desktopNotificationOptions(event, taskTitle) {
  const message = desktopNotification(event, taskTitle);
  return message && { ...message, icon: notificationIcon };
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

export function createPersonalDesktop({ libraryDesktopToken = null, origin, setupGrant = null, isQuitting, startInTray = false, onStatus = () => {} }) {
  const stateFile = join(app.getPath('userData'), 'desktop-window.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* first launch */ }
  const desktopSession = session.fromPartition('persist:weftmate-desktop');
  const tokenCss = readFileSync(new URL('./personal-access-ui/tokens.css', import.meta.url), 'utf8');
  const tokenValues = name => [...tokenCss.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))].map(match => match[1]);
  const palette = () => {
    const index = nativeTheme.shouldUseDarkColors ? 1 : 0;
    return { color: tokenValues('--canvas')[index], symbolColor: tokenValues('--ink')[index], height: 44 };
  };
  let resolvedPalette = null;
  const bounds = restoreDesktopBounds(saved, screen.getAllDisplays());
  const win = new BrowserWindow({
    ...bounds, minWidth: 480, minHeight: 520,
    title: 'WeftMate', icon: windowIcon(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI), show: false, backgroundColor: palette().color,
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: palette() } : {}),
    webPreferences: { session: desktopSession, preload: join(import.meta.dirname, 'personal-desktop-preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  // On Windows at fractional DPI, constructor dimensions can include a different frame inset.
  if (Number.isFinite(bounds.x)) win.setBounds(bounds);
  const uiUrl = new URL('/personal/v1/ui', origin).href;
  let contentOrigin = origin;
  const certificatePins = new Map(), networkRequests = new Map(), peerOrigins = new Set();
  const status = { host: '启动中', model: '未选择' };
  const updateStatus = next => { Object.assign(status, next); onStatus({ ...status }); };
  const trusted = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
    new URL(event.senderFrame.url).origin === origin && ['/personal/v1/ui', '/personal/v1/ui/'].includes(new URL(event.senderFrame.url).pathname);
  const handle = (channel, callback) => ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Desktop bridge unavailable');
    return callback(...args);
  });
  handle('wm:desktop:open-logs', async () => {
    await jsonLocal('/auth/me');
    const directory = join(app.getPath('userData'), 'logs'); mkdirSync(directory, { recursive: true });
    const error = await shell.openPath(directory); if (error) throw new Error('LOG_FOLDER_UNAVAILABLE');
    return { opened: true };
  });
  const fetchLocal = (path, options = {}) => desktopSession.fetch(new URL(`/personal/v1${path}`, contentOrigin).href, { ...options, credentials: 'include' });
  const jsonLocal = async path => {
    const response = await fetchLocal(path);
    if (!response.ok) throw new Error('Session unavailable');
    return response.json();
  };
  const loginArgs = [
    ...(!app.isPackaged ? [app.getAppPath()] : []), '--personal-host', '--start-in-tray',
    `--user-data-dir=${app.getPath('userData')}`,
    ...process.argv.filter(arg => /^--(?:desktop-config|access-port|workspace-dir|public-origin|personal-memory-config|local-model-config|android-package-path|mobile-ui-dir)=/.test(arg) || arg === '--trust-loopback-proxy'),
  ];
  const loginOptions = { path: process.execPath, args: process.platform === 'win32' ? quoteWindowsLoginArgs(loginArgs) : loginArgs, name: packageInfo.desktopIdentity || 'WeftMate' };
  const settings = () => ({ version: packageInfo.version, autoStart: loginItemEnabled(app.getLoginItemSettings(loginOptions), loginOptions.name, loginOptions.path),
    autoStartSupported: process.platform === 'win32' || process.platform === 'darwin' });
  handle('wm:desktop:settings', settings);
  handle('wm:desktop:notification-permission', async () => {
    await jsonLocal('/auth/me');
    if(!Notification.isSupported())return {enabled:false};
    if(process.platform!=='win32')return {enabled:null};
    try{
      const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',
        "$globalEnabled=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications' -Name ToastEnabled -ErrorAction SilentlyContinue).ToastEnabled; $appEnabled=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\com.memoweft.weftmate' -Name Enabled -ErrorAction SilentlyContinue).Enabled; if($globalEnabled -eq 0 -or $appEnabled -eq 0){'disabled'}elseif($globalEnabled -eq 1){'enabled'}else{'unknown'}"],{windowsHide:true});
      return {enabled:stdout.trim()==='disabled'?false:stdout.trim()==='enabled'?true:null};
    }catch{return {enabled:null};}
  });
  handle('wm:desktop:notification-settings', async () => {await jsonLocal('/auth/me');if(process.platform!=='win32')throw new Error('UNAVAILABLE');await shell.openExternal('ms-settings:notifications');return {opened:true};});
  handle('wm:desktop:clipboard-image', async () => {
    await jsonLocal('/auth/me'); const image = clipboard.readImage();
    return image.isEmpty() ? null : {name:'剪贴板图片.png',contentType:'image/png',dataUrl:image.toDataURL()};
  });
  handle('wm:desktop:capture-region', async () => { await jsonLocal('/auth/me'); return captureScreenRegion(win); });
  handle('wm:desktop:project-folder', async () => {
    await jsonLocal('/auth/me');
    if (contentOrigin !== origin) throw new Error('Desktop project registration unavailable');
    const selection = await dialog.showOpenDialog(win, { title: '选择项目文件夹', properties: ['openDirectory'] });
    return selection.canceled ? null : selection.filePaths[0] ?? null;
  });
  const authStore = desktopAuthStorage(join(app.getPath('userData'), 'desktop-auth.enc'), safeStorage);
  handle('wm:desktop:identity', () => ({ deviceName: hostname(), localOrigin: origin,
    clientId: process.env.WEFTMATE_CLOUD_DESKTOP_CLIENT_ID || process.env.WEFTMATE_CLOUD_WEB_CLIENT_ID,
    redirectUri: process.env.WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI }));
  handle('wm:desktop:credentials', (key, value, remove) => authStore.credentials(key, value, remove));
  handle('wm:desktop:key', scope => authStore.key(scope));
  handle('wm:desktop:proof', (scope, input) => authStore.sign(scope, input));
  handle('wm:desktop:key-reset', scope => authStore.resetKey(scope));
  desktopSession.setCertificateVerifyProc((request, done) => {
    const expected = certificatePins.get(request.hostname);
    if (!expected) { done(-3); return; }
    try {
      const pin = createHash('sha256').update(new X509Certificate(request.certificate.data).publicKey.export({ type: 'spki', format: 'der' })).digest('base64url');
      done(request.verificationResult === 'net::OK' && pin === expected ? 0 : -2);
    } catch { done(-2); }
  });
  handle('wm:desktop:connect-host', async ({ hostId, baseUrl } = {}) => {
    const trustedHost = authStore.credentials('trusted-host:' + hostId);
    const target = new URL(baseUrl);
    if (!trustedHost || target.protocol !== 'https:' || target.username || target.password || target.search || target.hash ||
      ![trustedHost.origin, trustedHost.relay?.baseUrl].includes(target.origin)) throw new Error('HOST_TRUST_INVALID');
    // Keep the packaged UI and its credential bridge local. Only authenticated
    // data requests go to the selected, manually pinned installation.
    certificatePins.set(target.hostname, trustedHost.tlsSpki);
    peerOrigins.add(target.origin);
    return { hostId, baseUrl: target.origin };
  });
  handle('wm:desktop:activate-host', ({ baseUrl } = {}) => {
    const target = new URL(baseUrl);
    if (target.origin !== origin && !peerOrigins.has(target.origin)) throw new Error('HOST_TRUST_INVALID');
    contentOrigin = target.origin;
  });
  handle('wm:desktop:fetch', async (url, options = {}, requestId) => {
    const target = new URL(url);
    const cloudOrigin = process.env.WEFTMATE_CLOUD_ISSUER ? new URL(process.env.WEFTMATE_CLOUD_ISSUER).origin : null;
    if (![origin, cloudOrigin].includes(target.origin) && !peerOrigins.has(target.origin) || target.username || target.password ||
      !target.pathname.startsWith('/personal/v1/')) throw new Error('Native request unavailable');
    const controller = new AbortController(); networkRequests.set(requestId, controller);
    const timeout = setTimeout(() => controller.abort(), 360000);
    try {
      const response = await desktopSession.fetch(target.href, { method: options.method || 'GET', body: options.body,
        headers: { ...options.headers, Origin: target.origin }, credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal });
      return { status: response.status, body: await response.json().catch(() => ({})), headers: {
        'retry-after': response.headers.get('Retry-After'), 'dpop-nonce': response.headers.get('DPoP-Nonce') } };
    } finally { clearTimeout(timeout); networkRequests.delete(requestId); }
  });
  handle('wm:desktop:fetch-abort', requestId => networkRequests.get(requestId)?.abort());
  handle('wm:desktop:clear-sessions', async () => {
    for (const request of networkRequests.values()) request.abort();
    for (const cookie of await desktopSession.cookies.get({ name: 'wm_personal_session' })) {
      await desktopSession.cookies.remove(`${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path}`, cookie.name);
    }
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
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(artifactId) || !['open', 'show', 'library-open', 'library-show'].includes(action)) throw new Error('Invalid artifact');
    if (action.startsWith('library-')) {
      const auth = await jsonLocal('/auth/me');
      const response = await fetchLocal(`/library/${artifactId}/${action.slice(8)}`, { method: 'POST', headers: { 'content-type': 'application/json', origin:contentOrigin, 'x-weftmate-csrf': auth.csrfToken, 'x-weftmate-desktop': libraryDesktopToken }, body: '{}' });
      if (!response.ok) throw new Error('Artifact unavailable');
      return response.json();
    }
    // Authorization and checksum verification remain in the existing artifact download route.
    // The renderer passes an ID, never an arbitrary filesystem path or URL.
    const response = await fetchLocal(`/artifacts/${artifactId}/download`);
    if (!response.ok) throw new Error('Artifact unavailable');
    const disposition = response.headers.get('content-disposition') || '';
    const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const fileName = encodedName ? decodeURIComponent(encodedName) : /filename="([^"]+)"/.exec(disposition)?.[1];
    if (!validArtifactFileName(fileName)) throw new Error('Invalid artifact name');
    const directory = join(app.getPath('userData'), 'desktop-artifacts', artifactId);
    await mkdir(directory, { recursive: true });
    const file = join(directory, fileName);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
    if (action === 'show') shell.showItemInFolder(file);
    else { const error = await shell.openPath(file); if (error) throw new Error('Default application unavailable'); }
    return { opened: true };
  });
  handle('wm:desktop:conversation-export', async ({ contentType, bytes, ownerId } = {}) => {
    if (!['text/markdown', 'image/png'].includes(contentType) || typeof ownerId !== 'string' ||
        !(bytes instanceof Uint8Array)) throw new Error('Invalid conversation export');
    if ((await jsonLocal('/auth/me')).account?.ownerId !== ownerId) throw new Error('Conversation export owner mismatch');
    const extension = contentType === 'image/png' ? 'png' : 'md';
    const selected = await dialog.showSaveDialog(win, { title: '导出对话', defaultPath: join(app.getPath('downloads'), `WeftMate-对话.${extension}`),
      filters: [{ name: extension === 'png' ? 'PNG' : 'Markdown', extensions: [extension] }] });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    if ((await jsonLocal('/auth/me')).account?.ownerId !== ownerId) throw new Error('Conversation export owner mismatch');
    await writeFile(selected.filePath, bytes, { mode: 0o600 });
    return { exported: true };
  });
  handle('wm:desktop:memory-export', async ({ format, ownerId } = {}) => {
    if (!['json', 'markdown'].includes(format) || typeof ownerId !== 'string') throw new Error('Invalid memory export');
    const filename = format === 'json' ? 'weftmate-memory.json' : 'weftmate-memory.md';
    const selected = await dialog.showSaveDialog(win, { title: '导出我的记忆', defaultPath: join(app.getPath('downloads'), filename),
      filters: [{ name: format === 'json' ? 'JSON' : 'Markdown', extensions: [format === 'json' ? 'json' : 'md'] }] });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    // Fetch after the dialog closes: changing accounts or forgetting a memory
    // while choosing a destination cannot save an older captured export.
    const response = await fetchLocal(`/memory/export?format=${format}`);
    if (!response.ok) throw new Error('Memory export unavailable');
    const exported = await response.json();
    if (exported.ownerId !== ownerId || exported.format !== format || typeof exported.content !== 'string')
      throw new Error('Memory export owner mismatch');
    await writeFile(selected.filePath, exported.content, { encoding: 'utf8', mode: 0o600 });
    return { exported: true };
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
  const publishVisibility = () => { if (!win.isDestroyed()) win.webContents.send('wm:desktop:visibility', win.isMinimized() || !win.isVisible()); };
  for (const event of ['minimize', 'restore', 'hide', 'show']) win.on(event, publishVisibility);
  win.webContents.on('did-finish-load', publishVisibility);
  win.webContents.on('page-title-updated', event => { event.preventDefault(); win.setTitle('WeftMate'); });
  win.webContents.on('will-navigate', (event, url) => { if (url !== uiUrl) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(({url}) => {
    try { const target = new URL(url); if (['http:', 'https:'].includes(target.protocol) && !target.username && !target.password) void shell.openExternal(target.href); } catch {}
    return { action: 'deny' };
  });
  const updatePalette = () => {
    if (!win.isDestroyed() && process.platform === 'win32') {
      win.setTitleBarOverlay(resolvedPalette ?? palette());
      win.setIcon(windowIcon(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI));
    }
  };
  nativeTheme.on('updated', updatePalette);
  const writeBounds = createLatestFileWriter(stateFile);
  let boundsTimer;
  const save = () => {
    clearTimeout(boundsTimer);
    if (!win.isDestroyed()) return writeBounds(JSON.stringify({ bounds: win.getNormalBounds(), maximized: maximizeOnShow || win.isMaximized() })).catch(() => {});
  };
  const scheduleSave = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(save, 200); };
  win.on('close', event => { void save(); if (!isQuitting()) { event.preventDefault(); win.hide(); } });
  win.on('resized', scheduleSave); win.on('moved', scheduleSave);
  // Poll authenticated history in main so hidden windows and other conversations still notify.
  // Watermarks prevent replay of completed historical turns after login/restart.
  const watermarks = new Map(), notifications = new Set(), reminderOnlySessions = new Set();
  const reminderNotificationsFile = join(app.getPath('userData'), 'desktop-reminder-notifications.json');
  const writeReminders = createLatestFileWriter(reminderNotificationsFile);
  let reminderNotified = new Set();
  try { reminderNotified = new Set(JSON.parse(readFileSync(reminderNotificationsFile, 'utf8'))); } catch { /* first use */ }
  let timer, stopped = false, ownerId = null, initialized = false;
  const activityNotifiedFile = join(app.getPath('userData'), 'desktop-activity-notifications.json');
  const writeActivityNotified = createLatestFileWriter(activityNotifiedFile);
  let activityNotified;
  try { activityNotified = new Set(JSON.parse(readFileSync(activityNotifiedFile, 'utf8'))); } catch { activityNotified = new Set(); }
  const activityNotifications = new Map();
  let activityCursor = null;
  async function pollActivity(me) {
    const page = await jsonLocal(`/activity?filter=unread&limit=200`);
    if (activityCursor) {
      try {
        const delta = await jsonLocal(`/activity/changes?cursor=${encodeURIComponent(activityCursor)}&limit=200`);
        for (const id of delta.removals) { activityNotifications.get(id)?.close(); activityNotifications.delete(id); }
        activityCursor = delta.nextCursor;
      } catch { activityCursor = page.syncCursor; }
    } else activityCursor = page.syncCursor;
    let cursor = null, current = page;
    do {
      for (const item of current.items) {
        const key = `${me.account?.ownerId}:${item.id}`;
        if (activityNotified.has(key) || item.notification.notify === false || item.notification.level === 'silent' || stopped || !Notification.isSupported()) continue;
        const notification = new Notification({ title: item.notification.title ?? item.title, body: item.notification.body ?? item.summary, icon: notificationIcon,
          silent: typeof item.notification.sound === 'boolean' ? !item.notification.sound : item.notification.level !== 'important' });
        notifications.add(notification); activityNotifications.set(item.id, notification);
        notification.on('click', () => show({ activityId: item.id, sessionId: item.source.sessionId }));
        notification.on('close', () => { notifications.delete(notification); if (activityNotifications.get(item.id) === notification) activityNotifications.delete(item.id); });
        const legacyType = { 'reminder.triggered':'assistant.message', 'approval.pending':'approval.requested', 'question.pending':'question.asked', 'task.completed':'turn.ended' }[item.type] ?? item.type;
        const event = { sessionId: item.source.sessionId, type: legacyType, activityType: item.type, activityId: item.id, attentionRevision: item.attentionRevision };
        notification.on('show', () => app.emit('weftmate-desktop-notification-shown', event));
        notification.show(); app.emit('weftmate-desktop-notification', event);
        activityNotified.add(key); await writeActivityNotified(JSON.stringify([...activityNotified]));
      }
      cursor = current.nextCursor;
      if (cursor) current = await jsonLocal(`/activity?filter=unread&limit=200&cursor=${encodeURIComponent(cursor)}`);
    } while (cursor && !stopped);
  }
  async function poll() {
    try {
      const meResponse = await fetchLocal('/auth/me');
      if (meResponse.status === 401) { watermarks.clear(); ownerId = null; initialized = false; updateStatus({ host: '运行中', model: '未登录' }); return; }
      if (!meResponse.ok) throw new Error('Session unavailable');
      const me = await meResponse.json();
      const identity = `${me.account?.ownerId}:${me.device?.id}`;
      if (ownerId !== identity) { ownerId = identity; watermarks.clear(); initialized = false; activityCursor = null; for (const notification of notifications) notification.close(); }
      const capabilityStatus = await jsonLocal('/status');
      if (capabilityStatus.personalCapabilities?.activityNotification === 1) {
        await pollActivity(me);
        updateStatus({ host: capabilityStatus.backend?.runtime === 'ready' ? '运行中' : '暂不可用' });
        return;
      }
      const { sessions = [] } = await jsonLocal('/sessions');
      for (const row of sessions) {
        const last = watermarks.get(row.sessionId);
        let cursor = last ?? -1;
        do {
          const page = await jsonLocal(`/sessions/${encodeURIComponent(row.sessionId)}/events?afterSeq=${cursor}&limit=200`);
          for (const event of page.events || []) {
            if (event.type === 'assistant.message' && event.data?.reminder) reminderOnlySessions.add(row.sessionId);
            else if (['user.message', 'step.started', 'assistant.message'].includes(event.type)) reminderOnlySessions.delete(row.sessionId);
            if (event.type === 'turn.ended' && reminderOnlySessions.delete(row.sessionId)) continue;
            const reminderKey = `${me.account?.ownerId}:${row.sessionId}:${event.seq}`;
            const reminder = event.type === 'assistant.message' && event.data?.reminder;
            if (reminder && reminderNotified.has(reminderKey)) continue;
            const message = (reminder || last !== undefined || initialized) && desktopNotification(event, row.title);
            if (!message || stopped || !Notification.isSupported()) continue;
            const notification = new Notification(desktopNotificationOptions(event, row.title));
            notifications.add(notification);
            notification.on('click', () => show(row.sessionId));
            notification.on('close', () => notifications.delete(notification));
            notification.on('show', () => app.emit('weftmate-desktop-notification-shown', { sessionId: row.sessionId, type: event.type }));
            notification.show();
            if (reminder) {
              reminderNotified.add(reminderKey);
              await writeReminders(JSON.stringify([...reminderNotified]));
            }
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
    ipcMain.removeHandler('wm:desktop:conversation-export');
    for (const request of networkRequests.values()) request.abort();
    for (const channel of ['wm:desktop:notification-permission','wm:desktop:notification-settings','wm:desktop:capture-region', 'wm:desktop:clipboard-image', 'wm:desktop:project-folder', 'wm:desktop:settings', 'wm:desktop:identity', 'wm:desktop:credentials', 'wm:desktop:key', 'wm:desktop:key-reset', 'wm:desktop:proof', 'wm:desktop:connect-host', 'wm:desktop:activate-host', 'wm:desktop:fetch', 'wm:desktop:fetch-abort', 'wm:desktop:clear-sessions', 'wm:desktop:theme', 'wm:desktop:model', 'wm:desktop:auto-start', 'wm:desktop:artifact']) ipcMain.removeHandler(channel);
    await save(); await desktopSession.cookies.flushStore(); desktopSession.flushStorageData();
  } };
}
