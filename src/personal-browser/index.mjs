import { createHash, randomUUID } from 'node:crypto';
import { createPinnedProxy, canonicalPublicUrl } from './network.mjs';

export const MAX_CAPTURE_BYTES = 256 * 1024;
export const MAX_SEGMENT_BYTES = 8 * 1024;
const CAPTURE_PAYLOAD_LIMIT = MAX_CAPTURE_BYTES - 96; // UTF-8 boundary slack for 32 segments.
const MAX_OUTLINE_BYTES = 2 * 1024;
const MAX_LINKS = 50;
const MAX_LABEL = 160;
const READ_TIMEOUT_MS = 15_000;
const EXTRACT = `(() => {
  const body = document.querySelector('main, article') || document.body;
  const raw = String(body?.innerText || document.body?.innerText || '');
  const links = [];
  const primary = body?.querySelectorAll('a[href]') || [];
  for (const anchor of [...primary, ...document.querySelectorAll('a[href]')]) {
    if (links.length >= 100) break;
    if (!anchor.getClientRects().length) continue;
    const style = getComputedStyle(anchor);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const href = String(anchor.href || '');
    if (href.length > 2048) continue;
    links.push({ url: href, label: String(anchor.innerText || anchor.textContent || '').trim().slice(0, 160) });
  }
  const headings = [...(body?.querySelectorAll('h1,h2,h3,h4') || [])].slice(0, 80)
    .filter((item) => item.getClientRects().length && getComputedStyle(item).display !== 'none')
    .map((item) => String(item.innerText || item.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160))
    .filter(Boolean);
  return { title: String(document.title || '').slice(0, 500), text: raw.slice(0, 262144),
    rawTruncated: raw.length > 262144, needsLogin: !!document.querySelector('input[type=password]'),
    headings, links };
})()`;

function fault(code, details = {}) { return Object.assign(new Error(code), { code, ...details }); }
async function cleanupWithin(work, ms = 6_000) {
  let timer;
  try { await Promise.race([Promise.resolve().then(work),
    new Promise((_, reject) => { timer = setTimeout(() => reject(fault('BROWSER_CLEANUP_FAILED')), ms); })]); }
  finally { clearTimeout(timer); }
}
function utf8Boundary(bytes, start, limit) {
  let end = Math.min(bytes.length, limit);
  while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  return end;
}
export function browserCaptureSegments(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
  if (bytes.length < 1 || bytes.length > MAX_CAPTURE_BYTES ||
      !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) throw fault('BROWSER_CAPTURE_INVALID');
  const segments = [];
  for (let start = 0; start < bytes.length;) {
    const end = utf8Boundary(bytes, start, start + MAX_SEGMENT_BYTES);
    if (end <= start) throw fault('BROWSER_CAPTURE_INVALID');
    segments.push({ text: bytes.subarray(start, end).toString('utf8'),
      byteStart: start, byteEnd: end });
    start = end;
  }
  if (segments.length > 32) throw fault('BROWSER_CAPTURE_INVALID');
  return segments;
}
export function browserCaptureVersion(url, bytes) {
  if (typeof url !== 'string' || !Buffer.isBuffer(bytes) || bytes.length < 1 ||
      bytes.length > MAX_CAPTURE_BYTES) throw fault('BROWSER_CAPTURE_INVALID');
  return createHash('sha256').update('weftmate-browser-capture/v1\0').update(url)
    .update('\0').update(bytes).digest('hex');
}
function captureText(value) {
  const bytes = Buffer.from(typeof value === 'string' ? value : '', 'utf8');
  const end = utf8Boundary(bytes, 0, CAPTURE_PAYLOAD_LIMIT);
  const captured = bytes.subarray(0, end);
  return { bytes: captured, truncated: end < bytes.length };
}
function boundedOutline(value) {
  const lines = Array.isArray(value) ? value.filter((item) => typeof item === 'string')
    .slice(0, 80).map((item) => item.replace(/\s+/g, ' ').trim().slice(0, 160)) : [];
  const bytes = Buffer.from(lines.filter(Boolean).join('\n'), 'utf8');
  return bytes.subarray(0, utf8Boundary(bytes, 0, MAX_OUTLINE_BYTES)).toString('utf8');
}
function boundedLinks(value, syntheticFixture) {
  if (!Array.isArray(value)) return [];
  const links = [], seen = new Set();
  for (const row of value) {
    if (links.length >= MAX_LINKS) break;
    let url;
    try { url = canonicalPublicUrl(row?.url, syntheticFixture); }
    catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    const label = Array.from(String(row?.label ?? '').replace(/\s+/g, ' ').trim()).slice(0, MAX_LABEL).join('');
    links.push({ url, label: label || new URL(url).hostname });
  }
  return links;
}

export function createPersonalBrowserReader({ BrowserWindow, session, resolver, connect,
  syntheticFixture = null } = {}) {
  if (typeof BrowserWindow !== 'function' || typeof session?.fromPartition !== 'function' ||
      (resolver !== undefined && typeof resolver !== 'function') ||
      (connect !== undefined && typeof connect !== 'function') ||
      (syntheticFixture !== null && (typeof syntheticFixture.hostnameSuffix !== 'string' ||
        !/^\.[a-z0-9.-]+\.invalid$/.test(syntheticFixture.hostnameSuffix) ||
        !Number.isInteger(syntheticFixture.allowedPort) || syntheticFixture.allowedPort < 1 ||
        syntheticFixture.allowedPort > 65535 || typeof resolver !== 'function'))) {
    throw fault('BROWSER_UNAVAILABLE');
  }
  const instanceId = randomUUID();
  const slots = [0, 1].map((index) => ({ index, busy: false, session: null, version: 0 }));
  const jobs = new Map();
  let closed = false;
  let quarantinedSessions = 0;
  let sessionsCreated = 0;
  let readsCompleted = 0;
  let lastFailure = null;
  const keyFor = (ownerId, taskId) => `${ownerId}|${taskId}`;
  const abortTask = (ownerId, taskId) => {
    const key = keyFor(ownerId, taskId);
    for (const job of jobs.get(key) ?? []) job.controller.abort();
  };
  return {
    canonicalUrl(input) { return canonicalPublicUrl(input, syntheticFixture); },
    status() { return { available: !closed && quarantinedSessions < 4,
      activeReads: [...jobs.values()].reduce((sum, set) => sum + set.size, 0),
      sessionsCreated, quarantinedSessions, readsCompleted,
      ...(lastFailure ? { lastFailure } : {}) }; },
    cancelTask(ownerId, taskId) { abortTask(ownerId, taskId); },
    async read({ ownerId, taskId, sessionId, receiptId, callId, url, signal }) {
      if (closed) throw fault('BROWSER_UNAVAILABLE');
      if (quarantinedSessions >= 4) throw fault('BROWSER_CLEANUP_FAILED');
      if (![ownerId, taskId, sessionId, receiptId, callId].every((value) =>
        typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value))) throw fault('BROWSER_UNAVAILABLE');
      const requestedUrl = canonicalPublicUrl(url, syntheticFixture);
      const key = keyFor(ownerId, taskId);
      if (signal?.aborted) throw fault('BROWSER_CANCELLED');
      const slot = slots.find((item) => !item.busy);
      if (!slot) throw fault('BROWSER_BUSY');
      slot.busy = true;
      const controller = new AbortController();
      const job = { controller, window: null, proxy: null };
      let finishJob;
      job.finished = new Promise((resolve) => { finishJob = resolve; });
      if (!jobs.has(key)) jobs.set(key, new Set());
      jobs.get(key).add(job);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, READ_TIMEOUT_MS);
      try {
        const proxy = createPinnedProxy({ resolver, connect, syntheticFixture, signal: controller.signal });
        job.proxy = proxy;
        const { port } = await proxy.start();
        if (controller.signal.aborted) throw fault('BROWSER_CANCELLED');
        // Two in-memory slots are reused only after clearing storage and auth
        // while their hidden window is still alive on about:blank.
        const newSession = slot.session === null;
        const ses = slot.session ?? session.fromPartition(
          `weftmate-personal-browser-${instanceId}-${slot.index}-${slot.version}`, { cache: false });
        if (newSession) sessionsCreated++;
        slot.session = ses;
        if (typeof ses.closeAllConnections !== 'function' || typeof ses.setProxy !== 'function' ||
            typeof ses.clearStorageData !== 'function' || typeof ses.clearAuthCache !== 'function') {
          throw fault('BROWSER_UNAVAILABLE');
        }
        await ses.closeAllConnections();
        if (controller.signal.aborted) throw fault('BROWSER_CANCELLED');
        await ses.setProxy({ mode: 'fixed_servers',
          proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
          proxyBypassRules: '<-loopback>' });
        if (controller.signal.aborted) throw fault('BROWSER_CANCELLED');
        ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        ses.setPermissionCheckHandler?.(() => false);
        if (newSession) ses.on('will-download', (event, item) => { event.preventDefault(); item.cancel(); });
        let httpStatus = null;
        let blockedRequest = false;
        ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
          try { canonicalPublicUrl(details.url, syntheticFixture); callback({ cancel: false }); }
          catch { blockedRequest = true; callback({ cancel: true }); }
        });
        ses.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, (details) => {
          if (details.resourceType === 'mainFrame') httpStatus = details.statusCode;
        });
        if (controller.signal.aborted) throw fault('BROWSER_CANCELLED');
        const window = new BrowserWindow({ show: false, width: 1100, height: 900,
          webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true,
            sandbox: true, webSecurity: true, webviewTag: false,
            allowRunningInsecureContent: false, spellcheck: false } });
        job.window = window;
        const contents = window.webContents;
        let navigationGeneration = 0;
        let downgradeBlocked = false;
        const initialHttps = new URL(requestedUrl).protocol === 'https:';
        const checkNavigation = (event, target, isMainFrame = true) => {
          const candidate = typeof target === 'string' ? target : event.url;
          try {
            const checked = canonicalPublicUrl(candidate, syntheticFixture);
            if (isMainFrame && initialHttps && new URL(checked).protocol !== 'https:') {
              downgradeBlocked = true;
              event.preventDefault();
            }
          } catch { blockedRequest = true; event.preventDefault(); }
        };
        contents.setWebRTCIPHandlingPolicy?.('disable_non_proxied_udp');
        contents.setWindowOpenHandler(() => ({ action: 'deny' }));
        contents.on('will-prevent-unload', (event) => event.preventDefault());
        contents.on('will-navigate', (event, target) => checkNavigation(event, target));
        contents.on('will-frame-navigate', (event, target) =>
          checkNavigation(event, target, event.isMainFrame !== false));
        contents.on('will-redirect', (event, target) =>
          checkNavigation(event, target, event.isMainFrame !== false));
        contents.on('did-start-navigation', (event) => {
          if (event?.isMainFrame !== false && event?.isSameDocument !== true) navigationGeneration++;
        });
        contents.on('did-navigate', (_event, _url, code) => {
          if (Number.isInteger(code) && code > 0) httpStatus = code;
        });
        const rendererGone = new Promise((_, reject) => contents.once('render-process-gone',
          () => reject(fault('BROWSER_RENDERER_FAILED'))));
        const abortPromise = new Promise((_, reject) => controller.signal.addEventListener('abort',
          () => reject(fault('BROWSER_CANCELLED')), { once: true }));
        try { await Promise.race([window.loadURL(requestedUrl), rendererGone, abortPromise]); }
        catch (error) { if (controller.signal.aborted) throw fault('BROWSER_CANCELLED');
          if (proxy.violation) throw fault(proxy.violation, { selectedAddress: proxy.selectedAddress });
          throw error?.code === 'BROWSER_RENDERER_FAILED' ? error : fault('BROWSER_NETWORK_ERROR', {
            nativeCode: typeof error?.code === 'string' && /^[A-Z0-9_-]{2,48}$/.test(error.code)
              ? error.code : 'UNKNOWN', selectedAddress: proxy.selectedAddress,
          }); }
        await Promise.race([new Promise((resolve) => setTimeout(resolve, 700)), abortPromise]);
        if (proxy.violation || blockedRequest || downgradeBlocked) {
          throw fault(proxy.violation ?? (downgradeBlocked ? 'BROWSER_DOWNGRADE_BLOCKED' : 'BROWSER_TARGET_BLOCKED'));
        }
        const beforeExtractUrl = canonicalPublicUrl(contents.getURL(), syntheticFixture);
        const beforeExtractGeneration = navigationGeneration;
        if (initialHttps && new URL(beforeExtractUrl).protocol !== 'https:') throw fault('BROWSER_DOWNGRADE_BLOCKED');
        if (httpStatus === 401 || httpStatus === 403) throw fault('BROWSER_LOGIN_REQUIRED', { httpStatus });
        if (httpStatus !== null && (httpStatus < 200 || httpStatus >= 400)) {
          throw fault('BROWSER_HTTP_ERROR', { httpStatus });
        }
        let extracted;
        try { extracted = await Promise.race([contents.executeJavaScriptInIsolatedWorld(1001,
          [{ code: EXTRACT }]), rendererGone, abortPromise]); }
        catch (error) { throw error?.code === 'BROWSER_RENDERER_FAILED' ? error : fault('BROWSER_RENDERER_FAILED'); }
        const finalUrl = canonicalPublicUrl(contents.getURL(), syntheticFixture);
        if (finalUrl !== beforeExtractUrl || navigationGeneration !== beforeExtractGeneration) {
          throw fault('BROWSER_PAGE_CHANGED');
        }
        if (initialHttps && new URL(finalUrl).protocol !== 'https:') throw fault('BROWSER_DOWNGRADE_BLOCKED');
        if (proxy.violation || blockedRequest || downgradeBlocked || controller.signal.aborted) {
          throw fault(proxy.violation ?? (downgradeBlocked ? 'BROWSER_DOWNGRADE_BLOCKED'
            : blockedRequest ? 'BROWSER_TARGET_BLOCKED' : 'BROWSER_CANCELLED'));
        }
        if (!extracted || typeof extracted !== 'object' || extracted.needsLogin === true) {
          throw fault(extracted?.needsLogin ? 'BROWSER_LOGIN_REQUIRED' : 'BROWSER_RENDERER_FAILED');
        }
        const capture = captureText(extracted.text);
        const capturedText = capture.bytes.toString('utf8');
        if (!capturedText.trim()) throw fault('BROWSER_EMPTY_PAGE');
        const segments = browserCaptureSegments(capture.bytes);
        readsCompleted++;
        return { title: Array.from(String(extracted.title ?? '')).slice(0, 256).join(''),
          requestedUrl, url: finalUrl, text: segments[0].text, capturedText,
          outline: boundedOutline(extracted.headings), segmentCount: segments.length,
          totalCapturedBytes: capture.bytes.length,
          versionHash: browserCaptureVersion(finalUrl, capture.bytes),
          captureTruncated: capture.truncated || extracted.rawTruncated === true,
          truncated: capture.truncated || extracted.rawTruncated === true || segments.length > 1,
          links: boundedLinks(extracted.links, syntheticFixture), httpStatus: httpStatus ?? 200 };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        let clean = false;
        const ses = slot.session;
        if (job.window && !job.window.isDestroyed() && ses) {
          try {
            await cleanupWithin(async () => {
              job.window.webContents.stop?.();
              await job.window.loadURL('about:blank');
              await ses.closeAllConnections();
              await ses.clearStorageData();
              await ses.clearAuthCache();
            });
            clean = true;
          } catch { /* Quarantine this partition rather than reuse any residual state. */ }
        }
        if (job.window && !job.window.isDestroyed()) job.window.destroy();
        await job.proxy?.close().catch(() => {});
        if (!clean && slot.session) {
          slot.session = null; slot.version++;
          quarantinedSessions++;
          lastFailure = 'BROWSER_CLEANUP_FAILED';
        }
        const set = jobs.get(key);
        set?.delete(job);
        if (set?.size === 0) jobs.delete(key);
        slot.busy = false;
        finishJob();
      }
    },
    async close() {
      closed = true;
      for (const [, set] of jobs) {
        for (const job of set) job.controller.abort();
      }
      const active = [...jobs.values()].flatMap((set) => [...set]);
      await cleanupWithin(() => Promise.allSettled(active.map((job) => job.finished))).catch(async () => {
        await Promise.allSettled(active.map(async (job) => {
          if (job.window && !job.window.isDestroyed()) job.window.destroy();
          await job.proxy?.close();
        }));
      });
    },
  };
}
