import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { servePersonalAccessUi } from '../src/personal-access-ui/index.mjs';
import { handleMobileMemoryPreview } from './mobile-memory-preview.mjs';
import { handleFixtureEvidence } from './mobile-evidence-handler.mjs';

const candidateRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(process.env.WEFTMATE_REPO_ROOT || candidateRoot);
const personalAccessModule = join(repositoryRoot, 'src', 'personal-access', 'index.mjs');
if (!existsSync(personalAccessModule)) throw new Error('Set WEFTMATE_REPO_ROOT to the WeftMate repository when running an isolated candidate.');
const { createPersonalAccessService } = await import(pathToFileURL(personalAccessModule).href);
const runId = `memory-ui-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}-${process.pid}`;
const dataRoot = join(candidateRoot, 'test-data', runId);
await mkdir(dataRoot, { recursive: true });

const sessions = new Map();
const memoryStores = new Map();
const memoryModes = { state: 'ready', searchLimit: false, dropNextReceipt: false,
  serviceUnavailableAfterDispatch: false, nextPreDispatchCode: null,
  deleteCleanup: 'complete', cleanupRetryOutcome: 'complete', capabilities: null, pendingBoundaryCount: 0,
  blockedBoundaryCount: 0, discardedBoundaryCount: 0, lastFailureCode: null, nullWorldRevision: false };
const receipts = new Map();
const backend = {
  async getStatus() {
    return { runtime: 'ready', referenceScan: 'ready', capabilities: {
      chat: { available: true }, desktopOpenApp: { available: true, appIds: ['synthetic-notepad'] },
      naturalLanguageDesktop: { available: false },
    } };
  },
  async listModels() {
    return [{ id: 'fixture-local', name: 'Synthetic fixture · UI only', model: 'fixture-no-inference',
      configured: true, source: 'synthetic-fixture', sourceKind: 'local' }];
  },
  async preflight() { return { ok: true }; },
  async createSession({ sessionId }) { sessions.set(sessionId, []); return { sessionId }; },
  async sendMessage({ sessionId, text }) {
    const events = sessions.get(sessionId) ?? [];
    const seq = events.length + 1;
    events.push({ seq, type: 'user', data: { content: String(text), timestamp: Date.now() } });
    events.push({ seq: seq + 1, type: 'assistant', data: { content: '这是合成界面夹具回复，没有调用模型。', timestamp: Date.now() } });
    sessions.set(sessionId, events);
    return { accepted: true };
  },
  async cancelSession() { return { accepted: true }; },
  async readEvents({ sessionId, afterSeq = 0 }) {
    const events = (sessions.get(sessionId) ?? []).filter((event) => event.seq > afterSeq);
    return { events, nextSeq: events.at(-1)?.seq ?? afterSeq, hasMore: false };
  },
  async describeSession(sessionId) {
    return sessions.has(sessionId) ? { sessionId, title: '合成测试会话', running: false,
      agentPreset: 'personal-shared-chat', modelProfileId: 'fixture-local' } : null;
  },
  async openDesktopApp() { return { accepted: true, synthetic: true }; },
};

const uiHandler = async (request, response) => {
  return servePersonalAccessUi(request, response);
};

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`${JSON.stringify(value)}\n`);
};
const fail = (response, status, code, ownerId = null, receipt = null) => json(response, status,
  { ...(ownerId ? { ownerId } : {}), error: { code }, ...(receipt ? { receipt } : {}) });
async function readBody(request, maxBytes = 32 * 1024) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('fixture body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function capabilities() {
  const enabled = ['ready', 'degraded'].includes(memoryModes.state);
  const configured = memoryModes.capabilities ?? {};
  return Object.fromEntries(['list', 'source', 'correct', 'mute', 'deleteEvidence', 'deleteWorldItem', 'inject']
    .map((key) => [key, enabled && (key !== 'inject' || memoryModes.state === 'ready') && configured[key] !== false]));
}
function visibleItem(item) {
  return { id: item.id, kind: item.kind, text: item.text, currentState: item.currentState,
    createdAt: item.createdAt, updatedAt: item.updatedAt, lifecycle: item.lifecycle,
    sourceCount: item.sourceCount, ...(item.truncated ? { truncated: true } : {}) };
}
function seedMemory(ownerId, label) {
  const now = '2026-09-27T08:00:00.000Z';
  const item = (id, kind, text) => ({ id, kind, text, currentState: 'current', createdAt: now,
    updatedAt: now, lifecycle: { invalidAt: null, archivedAt: null, mutedAt: null }, sourceCount: 1 });
  const items = label === 'A' ? [
    item('memory-a-1', 'cognition', '合成账户A偏好简洁的中文说明。'),
    item('memory-a-shared', 'cognition', '合成共享来源删除冲突示例。'),
    item('memory-a-old', 'cognition', '合成旧来源身份丢失示例。'),
    item('memory-a-entity', 'entity', '合成项目晨星是一项测试资料。'),
    item('memory:a:colon', 'entity', '合成含冒号标识的桌面详情。'),
    item('memory-a-relationship', 'relationship', '合成账户A与晨星项目有关联。'),
    item('memory-a-event', 'event', '合成账户A在测试日期讨论了晨星项目。'),
    { ...item('memory-a-long', 'cognition', '合成长文本的开头片段。'),
      fullText: '合成长文本的开头片段。后半段包含银杏关键词。', truncated: true },
    ...Array.from({ length: 24 }, (_, index) => item(`memory-a-page-${index + 1}`, 'cognition', `合成分页理解 ${String(index + 1).padStart(2, '0')}。`)),
  ] : [
    item('memory-b-1', 'cognition', '合成账户B偏好先看关键结论。'),
    item('memory-b-event', 'event', '合成账户B的独立测试经历。'),
  ];
  const sources = new Map(items.map((entry) => [entry.id, [{
    evidenceId: `evidence-${entry.id}`, relation: 'supports', currentnessState: 'current',
    permissions: { allowLocalRead: true, allowCloudRead: false, allowInference: true },
    contentAvailable: true, rawContentTruncated: false,
    summary: `合成来源：${entry.id}`, rawContent: `合成原文：${entry.text}`, recordedAt: now,
  }]]));
  memoryStores.set(ownerId, { revision: 1, items, sources });
  receipts.set(ownerId, new Map());
}
async function fixtureOwner(request, serviceOrigin) {
  const cookie = request.headers.cookie;
  if (typeof cookie !== 'string') return null;
  const response = await fetch(`${serviceOrigin}/personal/v1/auth/me`, { headers: { cookie }, cache: 'no-store' });
  if (!response.ok) return null;
  const value = await response.json();
  return value?.account?.ownerId && value?.csrfToken ? { ownerId: value.account.ownerId, csrf: value.csrfToken } : null;
}
async function fixtureSession(request) {
  const owner = await fixtureOwner(request, origin);
  if (!owner) return null;
  const response = await fetch(`${origin}/personal/v1/auth/me`, { headers: { cookie: request.headers.cookie }, cache: 'no-store' });
  if (!response.ok) return null;
  const value = await response.json();
  return { ownerId: owner.ownerId, username: value?.account?.username || '合成账户',
    displayName: value?.account?.displayName || value?.account?.username || '合成账户' };
}
async function handleMemory(request, response, url, serviceOrigin) {
  if (!url.pathname.startsWith('/personal/v1/memory')) return false;
  const auth = await fixtureOwner(request, serviceOrigin);
  if (!auth || !memoryStores.has(auth.ownerId)) { fail(response, 401, 'UNAUTHORIZED'); return true; }
  const ownerId = auth.ownerId;
  const store = memoryStores.get(ownerId);
  const caps = capabilities();
  if (request.method !== 'GET' && request.headers['x-weftmate-csrf'] !== auth.csrf) {
    fail(response, 403, 'FORBIDDEN', ownerId); return true;
  }
  const base = '/personal/v1/memory';
  const path = url.pathname.slice(base.length);
  if (path === '/status' && request.method === 'GET') {
    const unavailable = memoryModes.state === 'unavailable';
    const disabled = memoryModes.state === 'disabled';
    json(response, 200, { ownerId, state: memoryModes.state,
      worldRevision: unavailable || disabled || memoryModes.nullWorldRevision ? null : store.revision,
      capabilities: caps, pendingBoundaryCount: unavailable ? null : disabled ? 0 : memoryModes.pendingBoundaryCount,
      blockedBoundaryCount: unavailable ? null : disabled ? 0 : memoryModes.blockedBoundaryCount,
      discardedBoundaryCount: unavailable ? null : disabled ? 0 : memoryModes.discardedBoundaryCount,
      lastFailureCode: unavailable || disabled ? null : memoryModes.lastFailureCode,
      ...(memoryModes.state === 'ready' ? {} : {
        reasonCode: memoryModes.state === 'degraded' ? 'MEMORY_MODEL_UNAVAILABLE'
          : memoryModes.state === 'disabled' ? 'MEMORY_DISABLED' : 'MEMORY_UNAVAILABLE',
      }) });
    return true;
  }
  const retryCleanupMatch = /^\/commands\/by-request\/([A-Za-z0-9_.:-]+)\/retry-cleanup$/.exec(path);
  if (retryCleanupMatch && request.method === 'POST') {
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
      fail(response, 415, 'UNSUPPORTED_MEDIA_TYPE', ownerId); return true;
    }
    let body;
    try { body = await readBody(request, 1024); } catch { fail(response, 400, 'INVALID_REQUEST', ownerId); return true; }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
      fail(response, 400, 'INVALID_REQUEST', ownerId); return true;
    }
    const receipt = receipts.get(ownerId).get(retryCleanupMatch[1]);
    if (!receipt || receipt.state !== 'applied' || receipt.storageCleanup?.state !== 'pending') {
      fail(response, 409, 'MEMORY_CLEANUP_NOT_PENDING', ownerId); return true;
    }
    receipt.storageCleanup = { state: memoryModes.cleanupRetryOutcome, detailCode: 'SYNTHETIC_FIXTURE' };
    receipt.updatedAt = new Date().toISOString();
    json(response, 200, { ownerId, receipt });
    return true;
  }
  if (!['ready', 'degraded'].includes(memoryModes.state)) { fail(response, 503, 'MEMORY_UNAVAILABLE', ownerId); return true; }
  if (path === '/items' && request.method === 'GET') {
    if (!caps.list) { fail(response, 403, 'FORBIDDEN', ownerId); return true; }
    const kind = url.searchParams.get('kind');
    const query = (url.searchParams.get('query') ?? '').normalize('NFKC').toLocaleLowerCase();
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const after = url.searchParams.get('after');
    if (!['cognition', 'entity', 'relationship', 'event'].includes(kind) || query.length > 120
      || !Number.isInteger(limit) || limit < 1 || limit > 50) { fail(response, 400, 'INVALID_REQUEST', ownerId); return true; }
    if (memoryModes.searchLimit) { fail(response, 413, 'MEMORY_SEARCH_LIMIT', ownerId); return true; }
    let index = 0;
    if (after) {
      try {
        const cursor = JSON.parse(Buffer.from(after, 'base64url').toString('utf8'));
        if (cursor.ownerId !== ownerId || cursor.kind !== kind || cursor.query !== query
          || cursor.revision !== store.revision || !Number.isInteger(cursor.index)) throw new Error('stale');
        index = cursor.index;
      } catch { fail(response, 409, 'MEMORY_REVISION_CHANGED', ownerId); return true; }
    }
    const matched = store.items.filter((entry) => entry.kind === kind
      && (!query || (entry.fullText ?? entry.text).normalize('NFKC').toLocaleLowerCase().includes(query)));
    const items = matched.slice(index, index + limit).map(visibleItem);
    const hasMore = index + items.length < matched.length;
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({ ownerId, kind, query,
      revision: store.revision, index: index + items.length })).toString('base64url') : null;
    json(response, 200, { ownerId, items, worldRevision: store.revision, nextCursor, hasMore, searchScope: 'account_snapshot' });
    return true;
  }
  const lookup = /^\/items\/(cognition|entity|relationship|event)\/([^/]+)(?:\/(sources|correct|mute))?$/.exec(path);
  if (lookup) {
    const [, kind, rawId, suffix] = lookup;
    let id;
    try { id = decodeURIComponent(rawId) } catch { fail(response, 400, 'INVALID_REQUEST', ownerId); return true; }
    const item = store.items.find((entry) => entry.kind === kind && entry.id === id);
    if (!item) { fail(response, 404, 'NOT_FOUND', ownerId); return true; }
    if (request.method === 'GET' && !suffix) {
      json(response, 200, { ownerId, item: visibleItem(item), worldRevision: store.revision,
        availableActions: { correct: { available: kind !== 'entity' && caps.correct,
          ...(kind === 'entity' ? { reasonCode: 'MEMORY_ACTION_UNSUPPORTED' } : {}) },
        mute: { available: caps.mute }, delete: { available: caps.deleteWorldItem } } });
      return true;
    }
    if (request.method === 'GET' && suffix === 'sources') {
      if (!caps.source) { fail(response, 403, 'FORBIDDEN', ownerId); return true; }
      json(response, 200, { ownerId, sources: store.sources.get(id) ?? [], worldRevision: store.revision });
      return true;
    }
    if ((request.method === 'POST' && ['correct', 'mute'].includes(suffix))
      || (request.method === 'DELETE' && !suffix)) {
      const operation = suffix || 'delete';
      if (memoryModes.nextPreDispatchCode) {
        const code = memoryModes.nextPreDispatchCode;
        memoryModes.nextPreDispatchCode = null;
        fail(response, code === 'UNAUTHORIZED' ? 401 : code === 'FORBIDDEN' ? 403 : 503, code, ownerId);
        return true;
      }
      if (operation === 'delete' && !caps.deleteWorldItem) { fail(response, 503, 'MEMORY_DELETE_UNAVAILABLE', ownerId); return true; }
      if (operation === 'correct' && (kind === 'entity' || !caps.correct)) { fail(response, 403, 'MEMORY_ACTION_UNSUPPORTED', ownerId); return true; }
      if (operation === 'mute' && !caps.mute) { fail(response, 403, 'MEMORY_ACTION_UNSUPPORTED', ownerId); return true; }
      let body;
      try { body = await readBody(request); } catch { fail(response, 400, 'INVALID_REQUEST', ownerId); return true; }
      if (typeof body?.requestId !== 'string' || !Number.isSafeInteger(body.expectedWorldRevision)
        || (operation === 'correct' && (typeof body.text !== 'string' || !body.text.trim()))) {
        fail(response, 400, 'INVALID_REQUEST', ownerId); return true;
      }
      const prior = receipts.get(ownerId).get(body.requestId);
      if (prior) { json(response, prior.state === 'applied' || prior.state === 'no_change' ? 200 : 409, { ownerId, receipt: prior }); return true; }
      const receipt = { commandId: `command-${randomUUID()}`, requestId: body.requestId,
        state: 'applied', worldRevision: store.revision };
      if (body.expectedWorldRevision !== store.revision) receipt.state = 'revision_conflict';
      else if (operation === 'delete' && id === 'memory-a-shared') { receipt.state = 'rejected'; receipt.reasonCode = 'MEMORY_DELETE_CONFLICT'; }
      else if (operation === 'delete' && id === 'memory-a-old') { receipt.state = 'rejected'; receipt.reasonCode = 'MEMORY_SOURCE_UNRECOVERABLE'; }
      else {
        store.revision++;
        receipt.worldRevision = store.revision;
        if (operation === 'correct') {
          item.text = body.text.trim();
          if (item.fullText) { item.fullText = item.text; item.truncated = false; }
          item.updatedAt = new Date().toISOString();
        }
        if (operation === 'mute') { item.currentState = 'not_current'; item.lifecycle.mutedAt = new Date().toISOString(); }
        if (operation === 'delete') {
          store.items = store.items.filter((entry) => entry !== item);
          store.sources.delete(id);
          receipt.storageCleanup = { state: memoryModes.deleteCleanup, detailCode: 'SYNTHETIC_FIXTURE' };
        }
      }
      receipts.get(ownerId).set(body.requestId, receipt);
      if (memoryModes.dropNextReceipt) { memoryModes.dropNextReceipt = false; response.destroy(); return true; }
      if (memoryModes.serviceUnavailableAfterDispatch) {
        memoryModes.serviceUnavailableAfterDispatch = false;
        fail(response, 503, 'SERVICE_UNAVAILABLE', ownerId);
        return true;
      }
      json(response, receipt.state === 'applied' ? 200 : 409, { ownerId, receipt });
      return true;
    }
  }
  const requestMatch = /^\/commands\/by-request\/([A-Za-z0-9_.:-]+)$/.exec(path);
  if (requestMatch && request.method === 'GET') {
    const receipt = receipts.get(ownerId).get(requestMatch[1]);
    if (!receipt) fail(response, 404, 'NOT_FOUND', ownerId);
    else json(response, 200, { ownerId, receipt });
    return true;
  }
  fail(response, 404, 'NOT_FOUND', ownerId);
  return true;
}

const fakeApk = join(dataRoot, 'android-candidate.apk');
await writeFile(fakeApk, Buffer.from('SYNTHETIC_FIXTURE_NOT_AN_INSTALLABLE_ANDROID_PACKAGE\n'), { flag: 'wx' });
const service = await createPersonalAccessService({ root: join(dataRoot, 'service-data'), port: 0,
  backend, androidPackagePath: fakeApk,
  sharedProfileIsFormal: (profile) => profile.id === 'fixture-local' });
const { origin, hostId } = await service.start();
let browserOrigin = '';
const proxy = createServer(async (request, response) => {
  const browserHost = new URL(browserOrigin).host;
  if (request.headers.host !== browserHost ||
      (request.headers.origin !== undefined && request.headers.origin !== browserOrigin)) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end('fixture origin rejected');
    return;
  }
  if (await uiHandler(request, response)) return;
  const url = new URL(request.url ?? '/', browserOrigin);
  const mobilePreviewHandled = await handleMobileMemoryPreview(request, response, {
    root: join(candidateRoot, 'apps', 'mobile-ui', 'www'),
    origin: browserOrigin,
    resolveSession: fixtureSession,
    readMemory: async (incoming, path) => {
      const captured = { status: 200, body: '' };
      const sink = { writeHead(status) { captured.status = status; return this; },
        end(body) { captured.body = String(body ?? '') } };
      const handled = await handleMemory(incoming, sink, new URL(path, browserOrigin), origin);
      if (!handled) throw new Error('NOT_FOUND');
      const payload = captured.body ? JSON.parse(captured.body) : {};
      if (captured.status >= 400) throw new Error(payload?.error?.code || 'OPERATION_FAILED');
      return payload;
    },
  });
  if (mobilePreviewHandled) return;
  if (await handleFixtureEvidence(request, response, { root: candidateRoot,
    fixtureHost: browserHost, fixtureOrigin: browserOrigin })) return;
  if (url.pathname === '/__fixture/control' && request.method === 'POST') {
    try {
      const value = await readBody(request, 4096);
      if (value && typeof value === 'object') {
        if (['ready', 'degraded', 'disabled', 'unavailable'].includes(value.state)) memoryModes.state = value.state;
        if (typeof value.searchLimit === 'boolean') memoryModes.searchLimit = value.searchLimit;
        if (typeof value.dropNextReceipt === 'boolean') memoryModes.dropNextReceipt = value.dropNextReceipt;
        if (typeof value.serviceUnavailableAfterDispatch === 'boolean') memoryModes.serviceUnavailableAfterDispatch = value.serviceUnavailableAfterDispatch;
        if (typeof value.nullWorldRevision === 'boolean') memoryModes.nullWorldRevision = value.nullWorldRevision;
        if (['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_REQUEST', 'MEMORY_DISABLED', 'MEMORY_UNAVAILABLE',
          'MEMORY_ACTION_UNSUPPORTED', 'MEMORY_DELETE_UNAVAILABLE'].includes(value.nextPreDispatchCode)) {
          memoryModes.nextPreDispatchCode = value.nextPreDispatchCode;
        }
        if (['complete', 'pending'].includes(value.deleteCleanup)) memoryModes.deleteCleanup = value.deleteCleanup;
        if (['complete', 'pending'].includes(value.cleanupRetryOutcome)) memoryModes.cleanupRetryOutcome = value.cleanupRetryOutcome;
        if (value.capabilities && typeof value.capabilities === 'object') memoryModes.capabilities = value.capabilities;
        if (Number.isSafeInteger(value.pendingBoundaryCount) && value.pendingBoundaryCount >= 0) memoryModes.pendingBoundaryCount = value.pendingBoundaryCount;
        if (Number.isSafeInteger(value.blockedBoundaryCount) && value.blockedBoundaryCount >= 0) memoryModes.blockedBoundaryCount = value.blockedBoundaryCount;
        if (Number.isSafeInteger(value.discardedBoundaryCount) && value.discardedBoundaryCount >= 0) memoryModes.discardedBoundaryCount = value.discardedBoundaryCount;
        if (typeof value.lastFailureCode === 'string' || value.lastFailureCode === null) memoryModes.lastFailureCode = value.lastFailureCode;
        if (value.simulateHardDeletedSource === true && memoryModes.pendingBoundaryCount > 0) {
          memoryModes.pendingBoundaryCount--;
          memoryModes.blockedBoundaryCount = Math.max(0, memoryModes.blockedBoundaryCount - 1);
          memoryModes.discardedBoundaryCount++;
          memoryModes.lastFailureCode = 'MEMORY_SOURCE_DELETED';
          if (memoryModes.pendingBoundaryCount === 0) memoryModes.state = 'ready';
        }
      }
      json(response, 200, { fixture: 'synthetic', mode: memoryModes });
    } catch { fail(response, 400, 'INVALID_REQUEST'); }
    return;
  }
  if (await handleMemory(request, response, url, origin)) return;
  if (!url.pathname.startsWith('/personal/v1/') || url.pathname.includes('%') || url.pathname.includes('//')) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end('fixture path not found');
    return;
  }
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string' && !['host', 'connection', 'content-length', 'origin'].includes(name)) headers.set(name, value);
    }
    headers.set('origin', origin);
    const upstream = await fetch(new URL(`${url.pathname}${url.search}`, origin), {
      method: request.method,
      headers,
      ...(request.method === 'GET' || request.method === 'HEAD'
        ? {} : { body: Readable.toWeb(request), duplex: 'half' }),
      redirect: 'manual',
    });
    const forwarded = Object.fromEntries(upstream.headers.entries());
    delete forwarded['content-length'];
    delete forwarded['content-encoding'];
    const setCookies = upstream.headers.getSetCookie?.() ?? [];
    if (setCookies.length) forwarded['set-cookie'] = setCookies;
    response.writeHead(upstream.status, forwarded);
    if (!upstream.body) { response.end(); return; }
    Readable.fromWeb(upstream.body).pipe(response);
  } catch {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end('fixture API unavailable');
  }
});
await new Promise((resolve, reject) => {
  proxy.once('error', reject);
  proxy.listen(0, '127.0.0.2', resolve);
});
browserOrigin = `http://127.0.0.2:${proxy.address().port}`;
const password = 'Synthetic-only-profile-2026!';
const headers = { origin, 'content-type': 'application/json' };
async function post(path, body) {
  const response = await fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`fixture setup failed: ${path} ${response.status}`);
  return { body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
const accountA = await post('/personal/v1/auth/register', {
  username: 'FixtureA', password, deviceName: '合成桌面 A', displayName: '合成账户 A',
});
const accountB = await post('/personal/v1/auth/register', {
  username: 'FixtureB', password, deviceName: '合成桌面 B', displayName: '合成账户 B',
});
const deviceB = await post('/personal/v1/auth/login', {
  username: 'FixtureB', password, deviceName: '合成手机 B',
});
seedMemory(accountA.body.account.ownerId, 'A');
seedMemory(accountB.body.account.ownerId, 'B');

const fixture = { runId, browserOrigin, pageUrl: `${browserOrigin}/personal/v1/ui`, mobilePreviewUrl: `${browserOrigin}/personal/v1/__fixture/mobile/`,
  evidenceUrl: `${browserOrigin}/__fixture/evidence`, hostId,
  warning: 'SYNTHETIC TEST ACCOUNTS AND MEMORY ONLY. No MemoWeft Core, model, production account, or private data.',
  accounts: [
    { label: 'A', username: 'FixtureA', password, cookie: accountA.cookie,
      csrfToken: accountA.body.csrfToken, ownerId: accountA.body.account.ownerId,
      deviceId: accountA.body.device.id },
    { label: 'B', username: 'FixtureB', password, cookie: deviceB.cookie,
      csrfToken: deviceB.body.csrfToken, ownerId: deviceB.body.account.ownerId,
      deviceId: deviceB.body.device.id },
  ],
};
await writeFile(join(dataRoot, 'fixture.json'), JSON.stringify(fixture, null, 2), { flag: 'wx' });
await writeFile(join(dataRoot, 'process.json'), JSON.stringify({ pid: process.pid,
  proxyHost: '127.0.0.2', proxyPort: Number(new URL(browserOrigin).port),
  apiHost: '127.0.0.1', apiPort: Number(new URL(origin).port), startedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...fixture, accounts: fixture.accounts.map(({ cookie, csrfToken, ...account }) => account), dataRoot }, null, 2));
const stop = async () => {
  await new Promise((resolve) => proxy.close(resolve));
  await service.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
await new Promise(() => {});
