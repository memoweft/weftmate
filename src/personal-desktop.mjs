import { captureScreenRegion } from './personal-desktop-capture.mjs';
import { readNotificationPermission } from './personal-update/watchdog-commands.mjs';
import { createHostLog } from './host-log.mjs';
import packageInfo from '../package.json' with { type: 'json' };
import { desktopLoginOptions, macFilePermissionHelp } from './mac-desktop.mjs';
import { quoteWindowsLoginArgs, loginItemEnabled } from './desktop-autostart.mjs';
/** Native shell for the same authenticated /personal/v1 client used remotely. */
import { app, BrowserWindow, ipcMain, Notification, screen, shell, session, nativeTheme, safeStorage, dialog, clipboard, powerMonitor } from 'electron';
import { createComputerUsageSampler } from './computer-usage-sampler.mjs';
import { folderWarning } from './personal-projects/folder-choice.mjs';
import { stat, realpath, readFile } from 'node:fs/promises';
import { hostName } from './host-name.mjs';
import { createHash, X509Certificate, randomUUID } from 'node:crypto';
import { desktopAuthStorage } from './personal-desktop-auth.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createLatestFileWriter } from './latest-file-writer.mjs';
import { join, basename } from 'node:path';
import { validArtifactFileName } from './personal-artifacts/index.mjs';
import { windowIcon, notificationIcon } from './app-icons.mjs';
import { nativeEventNotification } from './personal-access/notification-content.mjs';
import { createWindowsSendTo, windowsApprovalNotification, actOnWindowsApproval } from './windows-system-integration.mjs';
import { nativeWindowRequest } from './personal-desktop-request.mjs';
import { createWindowsDesktopBoundsRestore } from './windows-desktop-bounds.mjs';
import { restoreDesktopBounds } from './desktop-window-bounds.mjs';
export { restoreDesktopBounds } from './desktop-window-bounds.mjs';

export function desktopNotification(event, taskTitle) {
  if (process.platform === 'win32' && event.type === 'approval.requested') {
    const { title, body } = windowsApprovalNotification({ ...event.data, status: 'pending' });
    return { title, body };
  }
  return nativeEventNotification(event, taskTitle);
}

export function desktopNotificationOptions(event, taskTitle) {
  const message = desktopNotification(event, taskTitle);
  return message && { ...message, icon: notificationIcon,
    ...(process.platform === 'win32' && event.type === 'approval.requested' ? { actions: [{ type: 'button', text: '查看' }] } : {}) };
}

export function preparePersonalDesktopWindow() {
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
  const bounds = restoreDesktopBounds(saved, screen.getAllDisplays());
  const win = new BrowserWindow({
    ...bounds, minWidth: 480, minHeight: 520,
    title: 'WeftMate', icon: windowIcon(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI), show: false, backgroundColor: palette().color,
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: palette() } : {}),
    webPreferences: { session: desktopSession, preload: join(import.meta.dirname, 'personal-desktop-preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  const lifecycle = { stopped: false, maximizeOnShow: saved.maximized === true };
  const display = Number.isFinite(bounds.x) ? screen.getDisplayMatching(bounds) : null;
  const restoreJob = Number.isFinite(bounds.x) && process.platform === 'win32' && !Number.isInteger(display.scaleFactor)
    ? createWindowsDesktopBoundsRestore(win, bounds, display)
    : { ready: Promise.resolve(Number.isFinite(bounds.x) && win.setBounds(bounds)), cancel: () => Promise.resolve() };
  const restoreBounds = restoreJob.ready.then(() => true, error => {
    if (!lifecycle.stopped && !win.isDestroyed()) {
      createHostLog(app.getPath('userData')).failure('window-bounds', error);
      win.setBounds(bounds);
    }
    return false;
  });
  const close = () => { lifecycle.stopped = true; return restoreJob.cancel(); };
  win.once('closed', () => { void close().catch(() => {}); });
  return { window: win, stateFile, saved, desktopSession, palette, restoreBounds, lifecycle, close };
}

export function createPersonalDesktop({ computerUsageService, systemManager = null, dataManager = null, libraryDesktopToken = null, origin, setupGrant = null, isQuitting, startInTray = false, onStatus = () => {}, preparedWindow = preparePersonalDesktopWindow() }) {
  const { window: win, stateFile, saved, desktopSession, palette, restoreBounds, lifecycle } = preparedWindow;
  let resolvedPalette = null;

  const uiUrl = new URL('/personal/v1/ui', origin).href;
  let contentOrigin = origin;
  const certificatePins = new Map(), networkRequests = new Map(), peerOrigins = new Set();
  const status = { host: '启动中', model: '未选择' };
  const updateStatus = next => { Object.assign(status, next); onStatus({ ...status }); };
  const trusted = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
    new URL(event.senderFrame.url).origin === origin && ['/personal/v1/ui', '/personal/v1/ui/'].includes(new URL(event.senderFrame.url).pathname);
  desktopSession.webRequest.onBeforeSendHeaders({ urls: [origin + '/personal/v1/*'] }, (details, callback) => {
    const localWindow = nativeWindowRequest(details, win, origin);
    callback({ requestHeaders: { ...details.requestHeaders,
      ...(localWindow ? { Origin: origin, 'X-WeftMate-Desktop': libraryDesktopToken } : {}) } });
  });
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
  const fetchLocal = (path, options = {}) => desktopSession.fetch(new URL(`/personal/v1${path}`, contentOrigin).href, { ...options,
    headers: { ...options.headers, origin: contentOrigin, ...(contentOrigin === origin ? { 'x-weftmate-desktop': libraryDesktopToken } : {}) }, credentials: 'include' });
  const jsonLocal = async path => {
    const response = await fetchLocal(path);
    if (!response.ok) throw new Error('Session unavailable');
    return response.json();
  };
  const diagnosticOwner = async () => {
    const [me, system] = await Promise.all([jsonLocal('/auth/me'), jsonLocal('/system')]);
    if (!systemManager || contentOrigin !== origin || !system.canRestart) throw new Error('LOCAL_HOST_REQUIRED');
    return me.account.ownerId;
  };
  handle('wm:desktop:system-repair', async id => {
    if (!['host', 'memory', 'model', 'relay', 'certificate'].includes(id)) throw new Error('COMPONENT_REPAIR_UNAVAILABLE');
    const ownerId = await diagnosticOwner();
    await systemManager.restart(id, ownerId);
    return systemManager.status(ownerId);
  });
  handle('wm:desktop:system-export', async () => {
    const ownerId = await diagnosticOwner();
    const selection = await dialog.showSaveDialog(win, { title: '保存诊断包',
      defaultPath: `weftmate-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: '诊断压缩包', extensions: ['zip'] }] });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const bundle = await systemManager.export(ownerId);
    await writeFile(selection.filePath, bundle.buffer);
    return { saved: true };
  });
  const dataExports = new Map();
  const dataRequests = new Map();
  handle('wm:desktop:data-status', async id => {
    const owner = dataRequests.get(id); if (!owner || !dataManager) return null;
    const auth = await jsonLocal('/auth/me').catch(()=>null); if (auth?.account?.ownerId && auth.account.ownerId !== owner) return null;
    return dataManager.nativeOperation(owner,id);
  });
  handle('wm:desktop:data-export', async ({id} = {}) => {
    const initial = await jsonLocal('/auth/me'), ownerId = initial.account.ownerId;
    const selected = await dialog.showSaveDialog(win, { title: '导出全部数据', defaultPath: `WeftMate-数据-${new Date().toISOString().slice(0,10)}` });
    if (selected.canceled || !selected.filePath) return { cancelled: true };
    const auth = await jsonLocal('/auth/me'); if (auth.account.ownerId !== ownerId) throw new Error('ACCOUNT_CHANGED');
    const response = await fetchLocal(`/data/${id ? 'confirm' : 'export'}`, { method: 'POST', headers: { origin: contentOrigin, 'content-type':'application/json', 'x-weftmate-csrf':auth.csrfToken, 'x-weftmate-desktop':libraryDesktopToken }, body: JSON.stringify({ ...(id ? {id,confirm:true} : {}), destination:selected.filePath }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error?.code || 'EXPORT_FAILED');
    dataExports.set(result.operation.id,{ownerId,path:selected.filePath}); return result;
  });
  handle('wm:desktop:data-show-export', async ({id}) => {
    const auth = await jsonLocal('/auth/me'), saved = dataExports.get(id), operation = (await jsonLocal('/data/operations')).operation;
    if (!saved || saved.ownerId !== auth.account.ownerId || operation.id !== id || operation.kind !== 'export' || operation.state !== 'completed') throw new Error('EXPORT_UNAVAILABLE');
    shell.showItemInFolder(saved.path); return { shown:true };
  });
  const loginArgs = [
    ...(!app.isPackaged ? [app.getAppPath()] : []), '--personal-host', '--start-in-tray',
    `--user-data-dir=${app.getPath('userData')}`,
    ...process.argv.filter(arg => /^--(?:desktop-config|access-port|workspace-dir|public-origin|personal-memory-config|local-model-config|android-package-path|mobile-ui-dir)=/.test(arg) || arg === '--trust-loopback-proxy'),
  ];
  const loginOptions = desktopLoginOptions({ packaged: app.isPackaged, executable: process.execPath, args: process.platform === 'win32' ? quoteWindowsLoginArgs(loginArgs) : loginArgs, name: packageInfo.desktopIdentity || 'WeftMate' });
  const sendToRegistration = createWindowsSendTo({ appId: packageInfo.desktopAppId || 'com.memoweft.weftmate', executable: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath(), ...loginArgs.slice(1).filter(arg => arg !== '--start-in-tray')] });
  const settings = () => ({ version: packageInfo.version, sendToSupported: process.platform === 'win32', sendToEnabled: sendToRegistration.enabled(), autoStart: loginItemEnabled(app.getLoginItemSettings(loginOptions), loginOptions.name, loginOptions.path),
    autoStartSupported: process.platform === 'win32' || process.platform === 'darwin' });
  handle('wm:desktop:settings', settings);
  handle('wm:desktop:send-to-setting', async enabled => { await jsonLocal('/auth/me'); sendToRegistration.setEnabled(enabled === true); return settings(); });
  handle('wm:desktop:notification-permission', async () => {
    await jsonLocal('/auth/me');
    if(!Notification.isSupported())return {enabled:false};
    if(process.platform!=='win32')return {enabled:null};
    return {enabled:await readNotificationPermission({onFailure:error=>createHostLog(app.getPath('userData')).failure('notification-permission',error)})};
  });
  handle('wm:desktop:notification-settings', async () => {await jsonLocal('/auth/me');if(!['win32','darwin'].includes(process.platform))throw new Error('UNAVAILABLE');await shell.openExternal(process.platform === 'darwin' ? 'x-apple.systempreferences:com.apple.preference.notifications' : 'ms-settings:notifications');return {opened:true};});
  handle('wm:desktop:clipboard-image', async () => {
    await jsonLocal('/auth/me'); const image = clipboard.readImage();
    return image.isEmpty() ? null : {name:'剪贴板图片.png',contentType:'image/png',dataUrl:image.toDataURL()};
  });
  handle('wm:desktop:capture-region', async () => { await jsonLocal('/auth/me'); await ready; return captureScreenRegion(win); });
  const selectedFolders = new Map();
  const pendingSendTo = [];
  const sendTo = paths => {
    if (process.platform !== 'win32') return;
    for (const path of paths) if (!pendingSendTo.includes(path)) pendingSendTo.push(path);
    show();
    if (clientReady) win.webContents.send('wm:desktop:send-to');
  };
  handle('wm:desktop:take-send-to', async () => {
    if (!pendingSendTo.length) return { files: [], folders: [], failed: 0 };
    const auth = await jsonLocal('/auth/me');
    if (contentOrigin !== origin) throw new Error('SEND_TO_LOCAL_HOST_REQUIRED');
    const paths = pendingSendTo.splice(0), files = [], folders = [];
    let failed = 0;
    for (const path of paths) {
      try {
        const info = await stat(path);
        if (info.isDirectory()) { selectedFolders.set(path, auth.account.ownerId); folders.push(path); }
        else if (info.isFile() && info.size > 0 && info.size <= 1024 ** 3 && files.length < 4) {
          files.push({ name: basename(path), bytes: new Uint8Array(await readFile(path)), lastModified: info.mtimeMs });
        } else failed++;
      } catch { failed++; }
    }
    const current = await jsonLocal('/auth/me');
    if (current.account.ownerId !== auth.account.ownerId) { pendingSendTo.unshift(...paths); throw new Error('ACCOUNT_CHANGED'); }
    return { files, folders, failed };
  });
  handle('wm:desktop:project-folder', async () => {
    const initialAuth = await jsonLocal('/auth/me'), initialOwner = initialAuth.ownerId || initialAuth.account?.ownerId;
    if (contentOrigin !== origin) throw new Error('Desktop project registration unavailable');
    const selection = await dialog.showOpenDialog(win, { title: '选择项目文件夹', ...(process.platform === 'darwin' ? { message: '选择要让助手使用的文件夹。访问桌面、文稿或下载时，系统可能询问权限；请按你的意愿选择。' } : {}), properties: ['openDirectory'] });
    const rootPath = selection.canceled ? null : selection.filePaths[0] ?? null;
    if (rootPath) { const auth = await jsonLocal('/auth/me'), owner = auth.ownerId || auth.account?.ownerId;
      if (owner !== initialOwner) throw new Error('PROJECT_NATIVE_SELECTION_REQUIRED');
      selectedFolders.set(rootPath, owner); }
    return rootPath;
  });
  handle('wm:desktop:history-import', async appName => {
    if (contentOrigin !== origin || !['chatgpt', 'claude', 'codex', 'claude-code'].includes(appName)) throw new Error('IMPORT_NATIVE_SELECTION_REQUIRED');
    const initial = await jsonLocal('/auth/me'), owner = initial.account?.ownerId;
    const local = ['codex', 'claude-code'].includes(appName);
    const selection = await dialog.showOpenDialog(win, { title: local ? '选择会话记录目录' : '选择聊天记录导出文件',
      ...(local ? { defaultPath: join(app.getPath('home'), appName === 'codex' ? '.codex' : '.claude', appName === 'codex' ? 'sessions' : 'projects') } : { filters: [{ name: '聊天记录', extensions: ['zip', 'json'] }] }),
      properties: local ? ['openDirectory'] : ['openFile', 'multiSelections'] });
    if (selection.canceled) return null;
    const current = await jsonLocal('/auth/me');
    if (current.account?.ownerId !== owner) throw new Error('ACCOUNT_CHANGED');
    const response = await fetchLocal('/memory/backfill', { method: 'POST', headers: { 'content-type': 'application/json', 'x-weftmate-csrf': current.csrfToken },
      body: JSON.stringify({ action: 'import-preview', app: appName, paths: selection.filePaths }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error?.code ?? body.code ?? 'IMPORT_FORMAT_UNKNOWN');
    if ((await jsonLocal('/auth/me')).account?.ownerId !== owner) throw new Error('ACCOUNT_CHANGED');
    return body;
  });
  const nativeProjects = async () => {
    if (contentOrigin !== origin) throw new Error('Desktop project registration unavailable');
    const response = await fetchLocal('/projects', {headers:{'x-weftmate-desktop':libraryDesktopToken}});
    if (!response.ok) throw new Error('PROJECT_UNAVAILABLE');
    return (await response.json()).projects;
  };
  handle('wm:desktop:project-choice', async rootPath => {
    const auth = await jsonLocal('/auth/me'), owner = auth.ownerId || auth.account?.ownerId;
    if (contentOrigin !== origin || selectedFolders.get(rootPath) !== owner || !selectedFolders.has(rootPath)) throw new Error('PROJECT_NATIVE_SELECTION_REQUIRED');
    let resolved;
    try { resolved = await realpath(rootPath); }
    catch (error) {
      if (process.platform === 'darwin' && ['EACCES', 'EPERM'].includes(error?.code))
        await dialog.showMessageBox(win, { type: 'info', title: '文件夹暂时打不开', message: 'WeftMate 没有权限打开这个文件夹。', detail: macFilePermissionHelp, buttons: ['返回项目'] });
      throw error;
    }
    if (!(await stat(resolved)).isDirectory()) throw new Error('PROJECT_UNSAFE_PATH');
    selectedFolders.set(resolved, owner);
    const projects = await nativeProjects();
    return {rootPath:resolved,name:basename(resolved),warning:folderWarning(resolved),
      project:projects.find(project => project.rootPath?.toLowerCase() === resolved.toLowerCase()) || null};
  });
  handle('wm:desktop:project-create', async fields => {
    const auth = await jsonLocal('/auth/me'), owner = auth.ownerId || auth.account?.ownerId;
    if (contentOrigin !== origin || !selectedFolders.has(fields?.rootPath) || selectedFolders.get(fields.rootPath) !== owner) throw new Error('PROJECT_NATIVE_SELECTION_REQUIRED');
    const response = await fetchLocal('/projects', {method:'POST',headers:{'content-type':'application/json',origin:contentOrigin,
      'x-weftmate-csrf':auth.csrfToken,'x-weftmate-desktop':libraryDesktopToken},body:JSON.stringify(fields)});
    const result = await response.json(); if (!response.ok) {
      if (process.platform === 'darwin' && ['PROJECT_FILE_UNAVAILABLE', 'PROJECT_UNAVAILABLE'].includes(result.error?.code || result.code))
        await dialog.showMessageBox(win, { type: 'info', title: '文件夹暂时打不开', message: '请检查文件夹是否还在，以及是否允许 WeftMate 访问。', detail: macFilePermissionHelp, buttons: ['返回项目'] });
      throw new Error(result.error?.code || result.code || 'PROJECT_UNAVAILABLE');
    }
    return result;
  });
  handle('wm:desktop:project-info', async projectId => (await nativeProjects()).find(row => row.projectId === projectId) || null);
  handle('wm:desktop:project-show', async projectId => {
    const project = (await nativeProjects()).find(row => row.projectId === projectId && !row.revoked);
    if (!project) throw new Error('PROJECT_UNAVAILABLE');
    const error = await shell.openPath(project.rootPath); if (error) throw new Error('PROJECT_UNAVAILABLE');
  });
  // Electron supplies this path from an actual dropped File, never from a text field.
  handle('wm:desktop:project-drop', async rootPath => {
    const auth = await jsonLocal('/auth/me');
    if (contentOrigin !== origin || typeof rootPath !== 'string' || !(await stat(rootPath)).isDirectory()) return null;
    selectedFolders.set(rootPath, auth.ownerId || auth.account?.ownerId); return rootPath;
  });
  const authStore = desktopAuthStorage(join(app.getPath('userData'), 'desktop-auth.enc'), safeStorage);
  handle('wm:desktop:identity', () => ({ deviceName: hostName(), localOrigin: origin,
    clientId: process.env.WEFTMATE_CLOUD_DESKTOP_CLIENT_ID || process.env.WEFTMATE_CLOUD_WEB_CLIENT_ID,
    redirectUri: process.env.WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI }));
  handle('wm:desktop:credentials', (key, value, remove) => authStore.credentials(key, value, remove));
  handle('wm:desktop:cloud-credentials-present', async () => {
    if (contentOrigin !== origin) throw new Error('LOCAL_HOST_REQUIRED');
    const directory = await jsonLocal('/auth/desktop');
    return authStore.cloudCredentialsPresent(directory.accounts.map(account => account.ownerId));
  });
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
    const dataOwner = target.origin === origin && target.pathname.startsWith('/personal/v1/data') && options.method === 'POST' ? (await jsonLocal('/auth/me')).account.ownerId : null;
    try {
      const response = await desktopSession.fetch(target.href, { method: options.method || 'GET', body: options.body,
        headers: { ...options.headers, Origin: target.origin, ...(target.origin === origin ? {'x-weftmate-desktop':libraryDesktopToken} : {}) }, credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal });
      const body = await response.json().catch(() => ({})); if (dataOwner && body.operation?.id) dataRequests.set(body.operation.id,dataOwner);
      return { status: response.status, body, headers: {
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
  handle('wm:desktop:recovery-export', async ({ recoveryCode, ownerId } = {}) => {
    if(typeof ownerId!=='string'||typeof recoveryCode!=='string'||! /^(?:[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{10}-){7}[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$/.test(recoveryCode))throw new Error('Invalid recovery export');
    if((await jsonLocal('/auth/me')).account?.ownerId!==ownerId)throw new Error('Recovery export owner mismatch');
    const selected=await dialog.showSaveDialog(win,{title:'保存恢复码',defaultPath:join(app.getPath('downloads'),'WeftMate-恢复码.txt'),filters:[{name:'文本',extensions:['txt']}]});
    if(selected.canceled||!selected.filePath)return {canceled:true};
    if((await jsonLocal('/auth/me')).account?.ownerId!==ownerId)throw new Error('Recovery export owner mismatch');
    await writeFile(selected.filePath,`WeftMate 恢复码\n${recoveryCode}\n换电脑时要用它；我们没有它的副本，丢了就找不回备份。\n请保存在安全的地方。\n`,{encoding:'utf8',mode:0o600});
    return {exported:true};
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
  let pendingConversation = null, clientReady = false;
  // A failed restore may show the fallback, but may never persist its geometry.
  let boundsRestored = false, activationReady = false, showRequested = false;
  const show = sessionId => {
    if (lifecycle.stopped || win.isDestroyed()) return;
    if (sessionId) pendingConversation = sessionId;
    // All activation paths share this gate. Maximizing before native bounds
    // restore finishes makes Windows remember the constructor's normal size.
    if (!activationReady) { showRequested = true; return; }
    showRequested = false;
    if (lifecycle.maximizeOnShow) { win.maximize(); lifecycle.maximizeOnShow = false; }
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
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
    if (boundsRestored && !win.isDestroyed()) return writeBounds(JSON.stringify({ bounds: win.getNormalBounds(), maximized: lifecycle.maximizeOnShow || win.isMaximized() })).catch(() => {});
  };
  const scheduleSave = () => { if (!boundsRestored) return; clearTimeout(boundsTimer); boundsTimer = setTimeout(save, 200); };
  win.on('close', event => { void save(); if (!isQuitting()) { event.preventDefault(); win.hide(); } });
  win.on('resized', scheduleSave); win.on('moved', scheduleSave);
  // Poll authenticated history in main so hidden windows and other conversations still notify.
  // Watermarks prevent replay of completed historical turns after login/restart.
  const watermarks = new Map(), notifications = new Set(), reminderOnlySessions = new Set();
  const reminderNotificationsFile = join(app.getPath('userData'), 'desktop-reminder-notifications.json');
  const writeReminders = createLatestFileWriter(reminderNotificationsFile);
  let reminderNotified = new Set();
  try { reminderNotified = new Set(JSON.parse(readFileSync(reminderNotificationsFile, 'utf8'))); } catch { /* first use */ }
  let timer, ownerId = null, initialized = false;
  const activityNotifiedFile = join(app.getPath('userData'), 'desktop-activity-notifications.json');
  const writeActivityNotified = createLatestFileWriter(activityNotifiedFile);
  let activityNotified;
  try { activityNotified = new Set(JSON.parse(readFileSync(activityNotifiedFile, 'utf8'))); } catch { activityNotified = new Set(); }
  const activityNotifications = new Map();
  let activityCursor = null;
  async function approvalFor(item) {
    const target = item.actions?.find(action => action.kind === 'respond_approval')?.target;
    if (!target?.approvalId || !target.sessionId) return null;
    const page = await jsonLocal(`/sessions/${encodeURIComponent(target.sessionId)}/approvals`);
    return page.approvals?.find(row => row.approvalId === target.approvalId) || null;
  }
  function bindWindowsApproval(notification, item, original, identity) {
    let acting = false;
    notification.on('action', async (event, legacyIndex) => {
      if (acting) return;
      acting = true;
      const open = () => show({ sessionId: original.sessionId, approvalId: original.approvalId });
      try {
        const me = await jsonLocal('/auth/me');
        if (contentOrigin !== origin || `${me.account?.ownerId}:${me.device?.id}` !== identity) throw new Error('ACCOUNT_CHANGED');
        const result = await actOnWindowsApproval({ index: event.actionIndex ?? legacyIndex, original, open,
          read: () => approvalFor(item), decide: async outcome => {
            const requestId = randomUUID();
            const response = await fetchLocal(`/sessions/${encodeURIComponent(original.sessionId)}/approvals/${encodeURIComponent(original.approvalId)}`, {
              method: 'POST', headers: { origin: contentOrigin, 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken },
              body: JSON.stringify({ requestId, outcome }) });
            const receipt = await response.json();
            if (!response.ok || receipt.requestId !== requestId || receipt.approval?.decisionOutcome !== outcome) throw new Error('APPROVAL_UNCONFIRMED');
          } });
        if (result?.viewed || !result) return;
        notification.close();
        const feedback = new Notification({ title: result.title, body: result.body, icon: notificationIcon, silent: true });
        notifications.add(feedback); feedback.on('click', open); feedback.on('close', () => notifications.delete(feedback)); feedback.show();
        app.emit('weftmate-windows-approval-result', { approvalId: original.approvalId, ...result });
      } catch {
        notification.close();
        const feedback = new Notification({ title: '审批尚未确认', body: '请打开对话核对后重试', icon: notificationIcon, actions: [{ type: 'button', text: '查看' }], silent: true });
        notifications.add(feedback); feedback.on('click', open); feedback.on('action', open); feedback.on('close', () => notifications.delete(feedback)); feedback.show();
      } finally { acting = false; }
    });
  }
  async function pollActivity(me) {
    const page = await jsonLocal(`/activity?filter=unread&limit=200`);
    if (activityCursor) {
      try {
        const delta = await jsonLocal(`/activity/changes?cursor=${encodeURIComponent(activityCursor)}&limit=200`);
        for (const id of delta.removals) { activityNotifications.get(id)?.close(); activityNotifications.delete(id); }
        for (const item of delta.upserts || []) if (item.type === 'approval.pending' && item.state !== 'pending') { activityNotifications.get(item.id)?.close(); activityNotifications.delete(item.id); }
        activityCursor = delta.nextCursor;
      } catch { activityCursor = page.syncCursor; }
    } else activityCursor = page.syncCursor;
    let cursor = null, current = page;
    do {
      for (const item of current.items) {
        const key = `${me.account?.ownerId}:${item.id}`;
        if (activityNotified.has(key) || item.notification.notify === false || item.notification.level === 'silent' || lifecycle.stopped || !Notification.isSupported()) continue;
        const approval = process.platform === 'win32' && item.type === 'approval.pending' && item.state === 'pending' ? await approvalFor(item) : null;
        if (process.platform === 'win32' && item.type === 'approval.pending' && !approval) continue;
        const presentation = approval ? windowsApprovalNotification(approval) : null;
        const notification = new Notification({ title: presentation?.title ?? item.notification.title ?? item.title, body: presentation?.body ?? item.notification.body ?? item.summary,
          ...(presentation ? { actions: presentation.actions } : {}), icon: notificationIcon,
          silent: typeof item.notification.sound === 'boolean' ? !item.notification.sound : item.notification.level !== 'important' });
        if (approval) bindWindowsApproval(notification, item, approval, `${me.account?.ownerId}:${me.device?.id}`);
        notifications.add(notification); activityNotifications.set(item.id, notification);
        notification.on('click', () => show(approval ? { sessionId: approval.sessionId, approvalId: approval.approvalId } : { activityId: item.id, sessionId: item.source.sessionId }));
        notification.on('close', () => { notifications.delete(notification); if (!approval && activityNotifications.get(item.id) === notification) activityNotifications.delete(item.id); });
        const legacyType = { 'reminder.triggered':'assistant.message', 'approval.pending':'approval.requested', 'question.pending':'question.asked', 'task.completed':'turn.ended' }[item.type] ?? item.type;
        const event = { sessionId: item.source.sessionId, type: legacyType, activityType: item.type, activityId: item.id, attentionRevision: item.attentionRevision };
        notification.on('show', () => app.emit('weftmate-desktop-notification-shown', event));
        notification.show(); app.emit('weftmate-desktop-notification', event);
        activityNotified.add(key); await writeActivityNotified(JSON.stringify([...activityNotified]));
      }
      cursor = current.nextCursor;
      if (cursor) current = await jsonLocal(`/activity?filter=unread&limit=200&cursor=${encodeURIComponent(cursor)}`);
    } while (cursor && !lifecycle.stopped);
  }
  async function poll() {
    try {
      const meResponse = await fetchLocal('/auth/me');
      if (meResponse.status === 401) { watermarks.clear(); ownerId = null; initialized = false; updateStatus({ host: '运行中', model: '未登录' }); return; }
      if (!meResponse.ok) throw new Error('Session unavailable');
      const me = await meResponse.json();
      const identity = `${me.account?.ownerId}:${me.device?.id}`;
      if (ownerId !== identity) { ownerId = identity; watermarks.clear(); initialized = false; activityCursor = null; for (const notification of notifications) notification.close(); for (const notification of activityNotifications.values()) notification.close(); activityNotifications.clear(); }
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
            if (!message || lifecycle.stopped || !Notification.isSupported()) continue;
            const notification = new Notification(desktopNotificationOptions(event, row.title));
            notifications.add(notification);
            notification.on('click', () => show(row.sessionId));
            if (process.platform === 'win32' && event.type === 'approval.requested') notification.on('action', () => show(row.sessionId));
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
        } while (!lifecycle.stopped);
      }
      initialized = true;
      const hostStatus = await jsonLocal('/status');
      updateStatus({ host: hostStatus.backend?.runtime === 'ready' ? '运行中' : '暂不可用' });
    } catch { updateStatus({ host: '暂不可用' }); /* Preserve notification watermarks on a transient failure. */ }
    finally { if (!lifecycle.stopped) timer = setTimeout(poll, 2000); }
  }
  void poll();
  const computerUsage = process.platform === 'win32' && computerUsageService ? createComputerUsageSampler({
    powerMonitor, owner: async () => (await jsonLocal('/auth/me').catch(() => null))?.account?.ownerId ?? null,
    policy: owner => computerUsageService.computerUsagePolicy(owner),
    persist: (owner, generation, buckets) => computerUsageService.recordComputerUsage(owner, generation, buckets),
  }) : null;
  if (computerUsage) computerUsageService.setComputerUsageCheckpoint(owner => computerUsage.checkpoint(owner));
  const ready = restoreBounds.then(confirmed => {
    boundsRestored = confirmed; activationReady = true;
    if (showRequested || !confirmed) show();
    if (!lifecycle.stopped && !win.isDestroyed()) return win.loadURL(uiUrl + (setupGrant ? `#setup=${encodeURIComponent(setupGrant)}` : ''));
  }).then(() => { if (!startInTray) show(); });
  return { window: win, show, openSettings() {
    show();
    void ready.then(() => {
      if (!lifecycle.stopped && !win.isDestroyed()) return win.webContents.executeJavaScript("globalThis.WeftSettingsNavigation?.open('general')");
    }).catch(() => {});
  }, sendTo, ready, async close() {
    lifecycle.stopped = true; clearTimeout(timer);
    await preparedWindow.close();
    await computerUsage?.close();
    if (computerUsage) computerUsageService.setComputerUsageCheckpoint(null);
    for (const notification of notifications) notification.close();
    for (const notification of activityNotifications.values()) notification.close(); activityNotifications.clear();
    nativeTheme.removeListener('updated', updatePalette);
    ipcMain.removeHandler('wm:desktop:conversation-export');
    ipcMain.removeHandler('wm:desktop:take-send-to'); ipcMain.removeHandler('wm:desktop:send-to-setting');
    ipcMain.removeHandler('wm:desktop:system-repair');
    ipcMain.removeHandler('wm:desktop:system-export');
    for(const channel of ['wm:desktop:data-export','wm:desktop:data-status','wm:desktop:data-show-export'])ipcMain.removeHandler(channel);
    for (const request of networkRequests.values()) request.abort();
    for (const channel of ['wm:desktop:cloud-credentials-present', 'wm:desktop:open-logs', 'wm:desktop:history-import', 'wm:desktop:recovery-export', 'wm:desktop:memory-export', 'wm:desktop:notification-permission','wm:desktop:notification-settings','wm:desktop:capture-region', 'wm:desktop:clipboard-image', 'wm:desktop:project-choice', 'wm:desktop:project-create', 'wm:desktop:project-info', 'wm:desktop:project-show', 'wm:desktop:project-drop', 'wm:desktop:project-folder', 'wm:desktop:settings', 'wm:desktop:identity', 'wm:desktop:credentials', 'wm:desktop:key', 'wm:desktop:key-reset', 'wm:desktop:proof', 'wm:desktop:connect-host', 'wm:desktop:activate-host', 'wm:desktop:fetch', 'wm:desktop:fetch-abort', 'wm:desktop:clear-sessions', 'wm:desktop:theme', 'wm:desktop:model', 'wm:desktop:auto-start', 'wm:desktop:artifact']) ipcMain.removeHandler(channel);
    await save(); await desktopSession.cookies.flushStore(); desktopSession.flushStorageData();
  } };
}
