import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { webcrypto } from 'node:crypto'

const candidateRoot = fileURLToPath(new URL('../', import.meta.url))
const source = readFileSync(new URL('../apps/mobile-ui/www/app.js', import.meta.url), 'utf8')
const html = readFileSync(new URL('../apps/mobile-ui/www/index.html', import.meta.url), 'utf8')
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]))
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

class FakeElement {
  id = ''
  tagName: string
  children: FakeElement[] = []
  listeners = new Map<string, Array<(event: any) => unknown>>()
  attributes = new Map<string, string>()
  dataset: Record<string, string> = {}
  style: Record<string, unknown> = { setProperty(name: string, value: string) { this[name] = value } }
  value = ''
  type = ''
  name = ''
  className = ''
  hidden = false
  disabled = false
  selected = false
  maxLength = 0
  scrolledIntoView = 0
  parentNode: FakeElement | null = null
  _text = ''
  classList = {
    add: (...values: string[]) => { this.className = [...new Set(`${this.className} ${values.join(' ')}`.trim().split(/\s+/))].join(' ') },
    remove: (...values: string[]) => { this.className = this.className.split(/\s+/).filter((x) => x && !values.includes(x)).join(' ') },
    toggle: (value: string, force?: boolean) => {
      const present = this.className.split(/\s+/).includes(value)
      const next = force ?? !present
      if (next && !present) this.className = `${this.className} ${value}`.trim()
      if (!next && present) this.className = this.className.split(/\s+/).filter((x) => x !== value).join(' ')
      return next
    },
    contains: (value: string) => this.className.split(/\s+/).includes(value),
  }
  constructor(tagName = 'div', id = '') { this.tagName = tagName.toUpperCase(); this.id = id }
  get childNodes() { return this.children }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join('') }
  set textContent(value: string) { this.replaceChildren(); this._text = String(value ?? '') }
  addEventListener(name: string, listener: (event: any) => unknown) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }
  fire(name: string, extra: Record<string, unknown> = {}) {
    const event = { currentTarget: this, target: this, preventDefault() {}, ...extra }
    for (const listener of this.listeners.get(name) ?? []) listener(event)
  }
  append(...children: FakeElement[]) { for (const child of children) { child.parentNode = this; this.children.push(child) } }
  appendChild(child: FakeElement) { this.append(child); return child }
  replaceChildren(...children: FakeElement[]) { this.children = []; this._text = ''; this.append(...children) }
  insertBefore(child: FakeElement, before: FakeElement | null) {
    child.parentNode = this
    const index = before ? this.children.indexOf(before) : -1
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child)
    return child
  }
  after(...nodes: FakeElement[]) { const p = this.parentNode; if (!p) return; const i = p.children.indexOf(this); p.children.splice(i + 1, 0, ...nodes); for (const n of nodes) n.parentNode = p }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  focus() {}
  blur() {}
  scrollTo() {}
  scrollIntoView() { this.scrolledIntoView++ }
  getBoundingClientRect() { return { top: 500, height: 132 } }
  contains(value: FakeElement) { return value === this || this.children.some((child) => child.contains(value)) }
  querySelector(selector: string): FakeElement | null {
    const matches = (node: FakeElement) => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) :
      selector.startsWith('#') ? node.id === selector.slice(1) : false
    return this.children.find(matches) ?? this.children.map((child) => child.querySelector(selector)).find(Boolean) ?? null
  }
  querySelectorAll() { return [] as FakeElement[] }
}

type MemoryItem = { id: string; kind: string; text: string; currentState: string; lifecycle: object; sourceCount: number; truncated?: boolean }
type DeferredRequest = { owner: string; path: string; resolve: (value: object) => void; reject: (error: Error) => void }

function harness(options: { status?: (owner: string) => object; items?: (owner: string, kind: string, query: string, after: string) => object;
  details?: (owner: string, kind: string, id: string) => object; sources?: (owner: string, kind: string, id: string) => object;
  write?: (owner: string, path: string, method: string, body: any) => object | Promise<object>;
  receipt?: (owner: string, requestId: string) => object | Promise<object>;
  taskDetail?: (owner: string, taskId: string) => object | Promise<object>;
  commandDetail?: (owner: string, commandId: string) => object | Promise<object>;
  projectList?: (owner: string) => object | Promise<object>;
  projectCreate?: (owner: string, params: any) => object | Promise<object>;
  projectReceipt?: (owner: string, requestId: string) => object | Promise<object>;
  projectSessions?: (owner: string) => object | Promise<object>;
  hostModels?: (owner: string) => object | Promise<object>;
  hostTask?: object; hostActivities?: object[];
  deferItemsFor?: string; deferMore?: boolean } = {}) {
  const nodes = new Map<string, FakeElement>()
  const get = (id: string) => { if (!nodes.has(id)) nodes.set(id, new FakeElement('div', id)); return nodes.get(id)! }
  const nav = ['chat', 'things', 'memory', 'capabilities', 'workspaces', 'devices', 'notifications', 'settings', 'connect']
    .map((page) => { const button = new FakeElement('button'); button.dataset.page = page; button.textContent = page; return button })
  const newChat = new FakeElement('button'); newChat.dataset.action = 'new-chat'
  const calls: Array<{ method: string; params: any; owner: string | null }> = []
  const storage = new Map<string, string>()
  let active: 'A' | 'B' | null = 'A'
  let scopes: Record<string, string> = { A: 'scope-A', B: 'scope-B' }
  let rawOwners: Record<string, string> = { A: 'account-A-raw', B: 'account-B-raw' }
  const deferred: DeferredRequest[] = []
  let deferOwner = options.deferItemsFor ?? ''
  let deferMore = options.deferMore ?? false
  const itemsByOwner: Record<string, MemoryItem[]> = {
    A: [{ id: 'memory-A', kind: 'cognition', text: 'A memory private to A', currentState: 'current', lifecycle: { invalidAt: null, archivedAt: null, mutedAt: null }, sourceCount: 1 }],
    B: [{ id: 'memory-B', kind: 'cognition', text: 'B memory private to B', currentState: 'current', lifecycle: { invalidAt: null, archivedAt: null, mutedAt: null }, sourceCount: 1 }],
  }
  const states = new Map<string, object>()
  const businessPaths: Array<{ owner: string | null; path: string; method: string; body?: any }> = []
  const status = options.status ?? ((owner: string) => ({ ownerId: rawOwners[owner], state: 'ready', worldRevision: 10,
    capabilities: { list: true, source: true, inject: true }, pendingBoundaryCount: 0, blockedBoundaryCount: 0, discardedBoundaryCount: 0 }))
  function business(path: string, owner: string, method = 'GET', body?: any) {
    businessPaths.push({ owner, path, method, body })
    if (method !== 'GET') return options.write?.(owner, path, method, body) ?? Promise.reject(new Error('METHOD_NOT_ALLOWED'))
    if (path.startsWith('/personal/v1/memory/commands/by-request/')) {
      const requestId = decodeURIComponent(path.split('/').at(-1)!)
      return options.receipt?.(owner, requestId) ?? Promise.reject(new Error('NOT_FOUND'))
    }
    if (path === '/personal/v1/memory/status') return status(owner)
    if (path.startsWith('/personal/v1/memory/items?')) {
      const url = new URL(path, 'http://fixture.test')
      const kind = url.searchParams.get('kind') ?? 'cognition'
      const query = url.searchParams.get('query') ?? ''
      const after = url.searchParams.get('after') ?? ''
      if ((deferOwner && owner === deferOwner) || (deferMore && after)) return new Promise<object>((resolve, reject) => {
        deferred.push({ owner, path, resolve, reject })
        if (owner === deferOwner) deferOwner = ''
        if (after) deferMore = false
      })
      return options.items?.(owner, kind, query, after) ?? { ownerId: rawOwners[owner], worldRevision: 10, searchScope: 'account_snapshot',
        items: itemsByOwner[owner].filter((item) => item.kind === kind && (!query || item.text.includes(query))), nextCursor: null, hasMore: false }
    }
    const parts = path.split('/').map(decodeURIComponent)
    const kind = parts[5]
    const id = parts[6]
    if (parts.at(-1) === 'sources') return options.sources?.(owner, kind, id) ?? { ownerId: rawOwners[owner], worldRevision: 10, sources: [
      { evidenceId: `evidence-${owner}`, relation: 'support', currentnessState: 'current',
        permissions: { allowLocalRead: true, allowCloudRead: false, allowInference: true },
        summary: 'source summary', rawContent: 'source raw secret', contentAvailable: true, rawContentTruncated: false,
        recordedAt: '2026-09-27T00:00:00Z' },
    ] }
    return options.details?.(owner, kind, id) ?? { ownerId: rawOwners[owner], worldRevision: 10,
      item: itemsByOwner[owner].find((item) => item.id === id) ?? itemsByOwner[owner][0], availableActions: ['deleteEvidence'] }
  }
  const bridge: any = {
    onmessage: null,
    postMessage(raw: string) {
      const request = JSON.parse(raw)
      calls.push({ method: request.method, params: request.params, owner: active })
      const send = (ok: boolean, result: unknown) => bridge.onmessage?.({ data: JSON.stringify(ok
        ? { id: request.id, ok: true, result } : { id: request.id, ok: false, error: { code: String((result as Error)?.message ?? 'OPERATION_FAILED') } }) })
      let result: any
      try {
        const owner = active
        switch (request.method) {
          case 'events.subscribe': result = {}; break
          case 'app.bootstrap': result = { loggedIn: !!owner, username: owner ? `Fixture${owner}` : '', owner: owner ? scopes[owner] : '',
            model: null, busy: false, ui: null, backgroundSync: 'scheduled' }; break
          case 'app.ready': result = {}; break
          case 'conversations.list': result = { conversations: [] }; break
          case 'activity.list': result = { activities: options.hostActivities ?? (options.hostTask ? [options.hostTask] : []), hostAvailable: true }; break
          case 'shared.commands.detail': result = owner && options.commandDetail
            ? options.commandDetail(owner, request.params.commandId) : (() => { throw new Error('NOT_FOUND') })(); break
          case 'shared.commands.byRequest': result = owner && options.projectReceipt
            ? options.projectReceipt(owner, request.params.requestId) : (() => { throw new Error('NOT_FOUND') })(); break
          case 'shared.projects.list': result = owner && options.projectList
            ? options.projectList(owner) : { source: 'host', hostId: 'host-fixture', projects: [], canManage: false }; break
          case 'shared.projects.createSession': result = owner && options.projectCreate
            ? options.projectCreate(owner, request.params) : (() => { throw new Error('OPERATION_FAILED') })(); break
          case 'shared.sessions.list': result = owner && options.projectSessions
            ? options.projectSessions(owner) : { source: 'host', sessions: [], hostAvailable: true }; break
          case 'models.host': result = owner && options.hostModels ? options.hostModels(owner) : { models: [] }; break
          case 'models.verifyHost': result = { available: true }; break
          case 'shared.tasks.detail': result = owner && options.taskDetail
            ? options.taskDetail(owner, request.params.taskId) : (() => { throw new Error('NOT_FOUND') })(); break
          case 'settings.appearance': result = { value: 'light' }; break
          case 'auth.me': result = owner ? { owner: scopes[owner], connectionVerified: true, username: `Fixture${owner}` } : (() => { throw new Error('LOGIN_REQUIRED') })(); break
          case 'auth.logout': active = null; result = {}; break
          case 'auth.login': active = request.params.username.endsWith('B') ? 'B' : 'A'; result = { owner: scopes[active], username: `Fixture${active}`,
            connectionVerified: true, backgroundSync: 'scheduled' }; break
          case 'host.business':
            if (!owner) throw new Error('LOGIN_REQUIRED')
            result = business(request.params.path, owner, request.params.method, request.params.body); break
          case 'app.activity': result = {}; break
          default: result = {}
        }
      } catch (error) { send(false, error); return }
      Promise.resolve(result).then((value) => send(true, value), (error) => send(false, error))
    },
  }
  const document: any = { body: get('body'), documentElement: new FakeElement('html'), activeElement: null,
    visibilityState: 'visible', getElementById: (id: string) => htmlIds.has(id) ? get(id) : null,
    createElement: (tag: string) => new FakeElement(tag),
    querySelector: (selector: string) => selector === '[data-action="new-chat"]' ? newChat : null,
    querySelectorAll: (selector: string) => selector === '[data-page]' ? nav : [],
    addEventListener(name: string, listener: (event?: any) => unknown) { if (name === 'DOMContentLoaded') listener({}) },
  }
  const window: any = { weftNative: bridge, innerHeight: 844, matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, WeftFormat: null }
  const timers: any = { setTimeout: (fn: (...args: any[]) => unknown, delay: number) => { const timer: any = setTimeout(fn, Math.min(delay, 10)); timer.unref?.(); return timer },
    clearTimeout, requestAnimationFrame: (fn: (time: number) => unknown) => { fn(0); return 1 }, localStorage: {
      get length() { return storage.size }, key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    } }
  runInNewContext(source, { document, window, localStorage: timers.localStorage, setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout, requestAnimationFrame: timers.requestAnimationFrame, URLSearchParams,
    console, Intl, Date, Error, Map, Set, Promise, crypto: webcrypto, TextEncoder })
  return { get, nav, calls, businessPaths, deferred, storage, itemsByOwner, setDeferredOwner: (owner: string) => { deferOwner = owner },
    setDeferMore: () => { deferMore = true }, resolveDeferred(index: number, value: object) { deferred[index].resolve(value) },
    rejectDeferred(index: number, code: string) { deferred[index].reject(new Error(code)) },
    setOwner: (owner: 'A' | 'B' | null) => { active = owner }, scopes, rawOwners }
}

function findAll(root: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement[] {
  const out: FakeElement[] = []
  if (predicate(root)) out.push(root)
  for (const child of root.children) out.push(...findAll(child, predicate))
  return out
}
function findButton(root: FakeElement, label: string) {
  return findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent.includes(label))[0]
}
async function waitUntil(predicate: () => boolean, message: string) {
  for (let index = 0; index < 100; index++) { if (predicate()) return; await flush() }
  assert.fail(message)
}
async function openMemory(app: ReturnType<typeof harness>, owner: 'A' | 'B' = 'A') {
  await waitUntil(() => app.calls.some((call) => call.method === 'app.ready'), 'mobile app bootstrap did not finish')
  app.setOwner(owner)
  app.nav.find((button) => button.dataset.page === 'memory')!.fire('click')
  await waitUntil(() => app.businessPaths.some((request) => request.owner === owner && request.path === '/personal/v1/memory/status'), 'memory status was not requested')
}
function switchToConnect(app: ReturnType<typeof harness>) { app.nav.find((button) => button.dataset.page === 'connect')!.fire('click') }
async function logoutAndLoginB(app: ReturnType<typeof harness>) {
  switchToConnect(app)
  const logout = findButton(app.get('page-content'), '退出登录')!
  logout.fire('click')
  await waitUntil(() => findAll(app.get('page-content'), (node) => node.tagName === 'LABEL').some((node) => node.textContent.includes('账户名')), 'login fields were not rendered')
  const labels = findAll(app.get('page-content'), (node) => node.tagName === 'LABEL')
  const user = labels.find((node) => node.textContent.includes('账户名'))!.children.find((node) => node.tagName === 'INPUT')!
  const password = labels.find((node) => node.textContent.includes('密码'))!.children.find((node) => node.tagName === 'INPUT')!
  const device = labels.find((node) => node.textContent.includes('设备名称'))!.children.find((node) => node.tagName === 'INPUT')!
  user.value = 'FixtureB'; password.value = 'synthetic password'; device.value = '合成手机'
  findButton(app.get('page-content'), '登录')!.fire('click')
  await waitUntil(() => app.calls.some((call) => call.method === 'auth.login' && call.params.username === 'FixtureB'), 'B login was not requested')
  await waitUntil(() => app.calls.some((call) => call.method === 'app.ready' && call.params.owner === 'scope-B'), 'B session was not accepted')
}

test('memory status distinguishes ready, degraded, disabled and unavailable; absent capabilities keep actions hidden', async () => {
  for (const scenario of [
    { state: 'ready', worldRevision: 9, caps: { list: true, source: true, inject: true }, expected: '当前账户的记忆快照' },
    { state: 'degraded', worldRevision: 9, caps: { list: true, source: true, inject: false }, expected: '记忆可查看；当前模型记忆注入不可用。' },
    { state: 'disabled', worldRevision: null, caps: { list: false, source: false, inject: false }, expected: '尚未启用' },
    { state: 'unavailable', worldRevision: null, caps: { list: false, source: false, inject: false }, expected: '暂不可用' },
  ]) {
    const app = harness({ status: (owner) => ({ ownerId: appOwner(owner), state: scenario.state,
      worldRevision: scenario.worldRevision, reasonCode: scenario.state === 'degraded' ? 'MEMORY_MODEL_UNAVAILABLE' : null,
      capabilities: scenario.caps, pendingBoundaryCount: 0, blockedBoundaryCount: 0, discardedBoundaryCount: 0 }) })
    await openMemory(app)
    await waitUntil(() => app.get('page-content').textContent.includes(scenario.expected), `status ${scenario.state} was not visible`)
    assert.equal(app.businessPaths.every((request) => request.method === 'GET'), true)
    if (scenario.caps.list) assert.equal(app.businessPaths.some((request) => request.path.startsWith('/personal/v1/memory/items?')), true)
    else assert.equal(app.businessPaths.some((request) => request.path.startsWith('/personal/v1/memory/items?')), false)
    if (scenario.state === 'degraded') assert.equal(app.get('page-content').textContent.includes('B memory private'), false)
  }
})

function appOwner(owner: string) { return owner === 'A' ? 'account-A-raw' : 'account-B-raw' }

test('a delayed A list success after B is displayed cannot replace or append to B', async () => {
  const app = harness({ deferItemsFor: 'A' })
  await openMemory(app, 'A')
  await waitUntil(() => app.deferred.length === 1, 'A list response was not delayed')
  await logoutAndLoginB(app)
  await openMemory(app, 'B')
  await waitUntil(() => app.get('page-content').textContent.includes('B memory private to B'), 'B list was not displayed')
  app.resolveDeferred(0, { ownerId: app.rawOwners.A, worldRevision: 10, searchScope: 'account_snapshot',
    items: app.itemsByOwner.A, nextCursor: null, hasMore: false })
  for (let index = 0; index < 20; index++) await flush()
  assert.match(app.get('page-content').textContent, /B memory private to B/)
  assert.doesNotMatch(app.get('page-content').textContent, /A memory private to A/)
})

test('a delayed A list failure after B is displayed cannot clear B data or show A failure', async () => {
  const app = harness({ deferItemsFor: 'A' })
  await openMemory(app, 'A')
  await waitUntil(() => app.deferred.length === 1, 'A list response was not delayed')
  await logoutAndLoginB(app)
  await openMemory(app, 'B')
  await waitUntil(() => app.get('page-content').textContent.includes('B memory private to B'), 'B list was not displayed')
  app.rejectDeferred(0, 'MEMORY_SEARCH_LIMIT')
  for (let index = 0; index < 20; index++) await flush()
  assert.match(app.get('page-content').textContent, /B memory private to B/)
  assert.doesNotMatch(app.get('page-content').textContent, /超过服务端完整快照上限/)
})

test('first list page establishes its revision, while a changed later page clears the old snapshot', async () => {
  let itemCalls = 0
  const app = harness({ items: (owner, kind, query, after) => {
    itemCalls++
    if (!after) return { ownerId: appOwner(owner), worldRevision: 11, searchScope: 'account_snapshot',
      items: [{ id: 'rev-item', kind, text: `query:${query}`, currentState: 'current', lifecycle: {}, sourceCount: 0 }],
      nextCursor: 'opaque:cursor/+?', hasMore: true }
    return Promise.reject(new Error('MEMORY_REVISION_CHANGED'))
  } })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('query:'), 'first page was not displayed')
  assert.match(app.get('page-content').textContent, /来源 0/)
  const queryInput = findAll(app.get('page-content'), (node) => node.tagName === 'INPUT' && node.type === 'search')[0]
  queryInput.value = '喜欢🌿+台北'; queryInput.fire('input')
  const searchForm = findAll(app.get('page-content'), (node) => node.tagName === 'FORM')[0]
  searchForm.fire('submit')
  await waitUntil(() => itemCalls >= 2, 'Unicode query was not sent')
  const queryPath = app.businessPaths.filter((request) => request.path.startsWith('/personal/v1/memory/items?')).at(-1)!.path
  assert.match(queryPath, /%E5%96%9C%E6%AC%A2/)
  assert.match(queryPath, /%2B/)
  await waitUntil(() => app.get('page-content').textContent.includes('query:喜欢🌿+台北'), 'searched first page was not displayed')
  const more = findButton(app.get('page-content'), '加载更多')!
  more.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('记忆已在电脑上更新'), 'revision conflict was not displayed')
  assert.doesNotMatch(app.get('page-content').textContent, /query:喜欢🌿\+台北/)
})

test('unreadable source content is withheld and labels stay human-readable', async () => {
  const app = harness({ sources: (owner) => ({ ownerId: appOwner(owner), worldRevision: 10, sources: [
    { evidenceId: 'ev-a', relation: 'support', currentnessState: 'current',
      permissions: { allowLocalRead: false, allowCloudRead: false, allowInference: false },
      summary: null, rawContent: 'PRIVATE RAW MUST NOT APPEAR', contentAvailable: false, rawContentTruncated: false,
      recordedAt: '2026-09-27T00:00:00Z' },
  ] }) })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('A memory private to A'), 'memory list was not displayed')
  findButton(app.get('page-content'), 'A memory private to A')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('此来源正文当前不可读取'), 'unreadable source state was not shown')
  const text = app.get('page-content').textContent
  assert.doesNotMatch(text, /PRIVATE RAW MUST NOT APPEAR/)
  assert.doesNotMatch(text, /support|current/)
  assert.match(text, /支持该理解/)
  assert.match(text, /当前来源/)
  assert.match(text, /本机模型未允许/)
  assert.match(text, /不代表设备操作或删除权限/)
  assert.equal(app.businessPaths.every((request) => request.method === 'GET'), true)
})

test('overlong encoded paths and unsupported point-segment IDs fail visibly without dropping cursor or facts', async () => {
  const app = harness({ items: (owner, kind) => ({ ownerId: appOwner(owner), worldRevision: 10, searchScope: 'account_snapshot',
    items: [{ id: '..', kind, text: 'memory with unsupported path id', currentState: 'current', lifecycle: {}, sourceCount: 1 }],
    nextCursor: null, hasMore: false }) })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('memory with unsupported path id'), 'list fact was not shown')
  findButton(app.get('page-content'), 'memory with unsupported path id')!.fire('click')
  assert.match(app.get('page-content').textContent, /当前手机版无法打开这条来源/)
  assert.equal(app.businessPaths.some((request) => /\/\.\.(\/|$)/.test(request.path)), false)
})

test('empty state separates blocked pending sources from previously deleted-source history', async () => {
  const blocked = harness({ status: (owner) => ({ ownerId: appOwner(owner), state: 'degraded', worldRevision: 10,
    reasonCode: 'MEMORY_MODEL_UNAVAILABLE', capabilities: { list: true, source: true, inject: false },
    pendingBoundaryCount: 2, blockedBoundaryCount: 1, discardedBoundaryCount: 0, lastFailureCode: 'BOUNDARY_CONFLICT' }),
    items: (owner, kind) => ({ ownerId: appOwner(owner), worldRevision: 10, searchScope: 'account_snapshot', items: [], nextCursor: null, hasMore: false }) })
  await openMemory(blocked)
  await waitUntil(() => blocked.get('page-content').textContent.includes('来源尚未处理'), 'pending count was not visible')
  assert.match(blocked.get('page-content').textContent, /其中 1 条已暂停自动处理/)
  assert.match(blocked.get('page-content').textContent, /本手机页面不会重试或管理待处理来源/)

  const deletedHistory = harness({ status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: 11,
    capabilities: { list: true, source: true, inject: true }, pendingBoundaryCount: 0, blockedBoundaryCount: 0,
    discardedBoundaryCount: 1, lastFailureCode: 'MEMORY_SOURCE_DELETED' }),
    items: (owner, kind) => ({ ownerId: appOwner(owner), worldRevision: 11, searchScope: 'account_snapshot', items: [], nextCursor: null, hasMore: false }) })
  await openMemory(deletedHistory)
  await waitUntil(() => deletedHistory.get('page-content').textContent.includes('来源已删除'), 'deleted-source history notice was not displayed')
  assert.doesNotMatch(deletedHistory.get('page-content').textContent, /来源尚未处理/)
  assert.match(deletedHistory.get('page-content').textContent, /不表示仍有待处理来源/)
})

test('capability-gated correction and mute use one request ID and refresh detail and sources', async () => {
  let revision = 10; let text = 'A memory private to A'; let mutedAt: string | null = null
  const writes: Array<{ path: string; method: string; body: any }> = []
  const item = () => ({ id: 'memory-A', kind: 'cognition', text, currentState: 'current',
    lifecycle: { invalidAt: null, archivedAt: null, mutedAt }, sourceCount: 1 })
  const app = harness({
    status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: revision,
      capabilities: { list: true, source: true, inject: true, correct: true, mute: true, deleteWorldItem: true, deleteEvidence: true } }),
    items: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, searchScope: 'account_snapshot',
      items: [item()], nextCursor: null, hasMore: false }),
    details: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, item: item(),
      availableActions: { correct: { available: true }, mute: { available: true }, delete: { available: true } } }),
    sources: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, sources: [] }),
    write: (_owner, path, method, body) => { writes.push({ path, method, body });revision++
      if (path.endsWith('/correct')) text = 'Corrected understanding'
      if (path.endsWith('/mute')) mutedAt = '2026-09-27T12:00:00Z'
      return { receipt: { commandId: `cmd-${writes.length}`, requestId: body.requestId, state: 'applied', worldRevision: revision } }
    },
  })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('A memory private to A'), 'initial memory loaded')
  findButton(app.get('page-content'), 'A memory private to A')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '纠正这项理解'), 'correct action available')
  findButton(app.get('page-content'), '纠正这项理解')!.fire('click')
  assert.equal(findAll(app.get('page-content'), (node) => node.classList.contains('memory-confirm-panel'))[0].scrolledIntoView, 1)
  const correction = findAll(app.get('page-content'), (node) => node.tagName === 'TEXTAREA')[0]
  correction.value = 'Corrected understanding'; correction.fire('input')
  findButton(app.get('page-content'), '保存纠正')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('Corrected understanding'), 'corrected detail refreshed')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].method, 'POST')
  assert.match(writes[0].path, /\/items\/cognition\/memory-A\/correct$/)
  assert.equal(writes[0].body.expectedWorldRevision, 10)
  assert.match(writes[0].body.requestId, /^memory-ui-/)
  await waitUntil(() => !!findButton(app.get('page-content'), '停用这项记忆'), 'mute action available')
  findButton(app.get('page-content'), '停用这项记忆')!.fire('click')
  findButton(app.get('page-content'), '确认停用')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('已停用'), 'muted detail refreshed')
  assert.equal(writes.length, 2)
  assert.match(writes[1].path, /\/items\/cognition\/memory-A\/mute$/)
  assert.equal(writes[1].body.expectedWorldRevision, 11)
  assert.notEqual(writes[0].body.requestId, writes[1].body.requestId)
})

test('item deletion requires typing confirmation and reports incomplete storage cleanup honestly', async () => {
  let revision = 10; let deleted = false; const writes: Array<{ path: string; method: string; body: any }> = []
  const item = { id: 'memory-A', kind: 'cognition', text: 'Delete this memory', currentState: 'current', lifecycle: {}, sourceCount: 1 }
  const app = harness({
    status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: revision,
      capabilities: { list: true, source: true, deleteWorldItem: true } }),
    items: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, searchScope: 'account_snapshot',
      items: deleted ? [] : [item], nextCursor: null, hasMore: false }),
    details: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, item,
      availableActions: { delete: { available: true } } }),
    sources: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, sources: [] }),
    write: (_owner, path, method, body) => { writes.push({ path, method, body });deleted = true;revision = 11
      return { receipt: { commandId: 'cmd-delete', requestId: body.requestId, state: 'applied', worldRevision: 11,
        storageCleanup: { state: 'pending', detailCode: 'checkpoint_pending' } } }
    },
  })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('Delete this memory'), 'item loaded')
  findButton(app.get('page-content'), 'Delete this memory')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '永久删除这项记忆'), 'delete action available')
  findButton(app.get('page-content'), '永久删除这项记忆')!.fire('click')
  const confirm = findButton(app.get('page-content'), '确认永久删除记忆')!
  assert.equal(confirm.disabled, true);assert.equal(writes.length, 0)
  assert.match(app.get('page-content').textContent, /原始聊天、会话存档和既有备份仍可能保留/)
  const input = findAll(app.get('page-content'), (node) => node.tagName === 'INPUT' && node.type === 'text')[0]
  input.value = '删除';input.fire('input');assert.equal(confirm.disabled, false);confirm.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('底层清理仍待完成'), 'cleanup boundary visible')
  assert.equal(writes.length, 1);assert.equal(writes[0].method, 'DELETE')
  assert.match(writes[0].path, /\/items\/cognition\/memory-A$/)
  assert.equal(writes[0].body.expectedWorldRevision, 10)
  assert.doesNotMatch(app.get('page-content').textContent, /Delete this memory/)
})

test('source evidence deletion uses the evidence ID and refreshes the source list', async () => {
  let revision = 10;let deleted = false;const writes: Array<{ path: string; method: string; body: any }> = []
  const item = () => ({ id: 'memory-A', kind: 'cognition', text: 'Source-backed memory', currentState: 'current',
    lifecycle: {}, sourceCount: deleted ? 0 : 1 })
  const app = harness({
    status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: revision,
      capabilities: { list: true, source: true, deleteEvidence: true } }),
    items: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, searchScope: 'account_snapshot',
      items: [item()], nextCursor: null, hasMore: false }),
    details: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, item: item(), availableActions: {} }),
    sources: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, sources: deleted ? [] : [
      { evidenceId: 'evidence-A', relation: 'support', currentnessState: 'current', permissions: {}, summary: 'Old source',
        rawContent: 'Old source body', contentAvailable: true }] }),
    write: (_owner, path, method, body) => { writes.push({ path, method, body });deleted = true;revision = 11
      return { receipt: { commandId: 'cmd-evidence', requestId: body.requestId, state: 'applied', worldRevision: 11,
        storageCleanup: { state: 'complete', detailCode: 'current_wal_truncated' } } }
    },
  })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('Source-backed memory'), 'item loaded')
  findButton(app.get('page-content'), 'Source-backed memory')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '删除这条来源'), 'evidence delete available')
  findButton(app.get('page-content'), '删除这条来源')!.fire('click')
  const input = findAll(app.get('page-content'), (node) => node.tagName === 'INPUT' && node.type === 'text')[0]
  input.value = '删除';input.fire('input');findButton(app.get('page-content'), '确认删除这条来源')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('服务端没有返回来源记录'), 'fresh source list rendered')
  assert.equal(writes.length, 1);assert.equal(writes[0].method, 'DELETE')
  assert.match(writes[0].path, /\/evidence\/evidence-A$/)
  assert.doesNotMatch(app.get('page-content').textContent, /Old source body/)
})

test('revision conflict refreshes the changed account snapshot without resubmitting', async () => {
  let revision = 10;let writes = 0
  const app = harness({
    status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: revision,
      capabilities: { list: true, source: true, mute: true } }),
    items: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, searchScope: 'account_snapshot',
      items: [{ id: 'memory-A', kind: 'cognition', text: revision === 10 ? 'Original memory' : 'Changed on desktop',
        currentState: 'current', lifecycle: {}, sourceCount: 0 }], nextCursor: null, hasMore: false }),
    details: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision,
      item: { id: 'memory-A', kind: 'cognition', text: 'Original memory', currentState: 'current', lifecycle: {}, sourceCount: 0 },
      availableActions: { mute: { available: true } } }),
    sources: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, sources: [] }),
    write: (_owner, _path, _method, body) => { writes++;revision = 11
      return { receipt: { commandId: 'cmd-conflict', requestId: body.requestId, state: 'revision_conflict', worldRevision: 11 } }
    },
  })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('Original memory'), 'original memory loaded')
  findButton(app.get('page-content'), 'Original memory')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '停用这项记忆'), 'mute action available')
  findButton(app.get('page-content'), '停用这项记忆')!.fire('click')
  findButton(app.get('page-content'), '确认停用')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('Changed on desktop'), 'fresh snapshot loaded')
  assert.match(app.get('page-content').textContent, /本次未应用/)
  assert.equal(writes, 1)
})

test('timeout checks the same request receipt and never sends a second memory command', async () => {
  let revision = 10;let writes = 0;let requestId = ''
  const app = harness({
    status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: revision,
      capabilities: { list: true, source: true, mute: true } }),
    items: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, searchScope: 'account_snapshot',
      items: [{ id: 'memory-A', kind: 'cognition', text: 'Timeout memory', currentState: 'current',
        lifecycle: { mutedAt: revision === 11 ? '2026-09-27T12:00:00Z' : null }, sourceCount: 0 }], nextCursor: null, hasMore: false }),
    details: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision,
      item: { id: 'memory-A', kind: 'cognition', text: 'Timeout memory', currentState: 'current', lifecycle: {}, sourceCount: 0 },
      availableActions: { mute: { available: true } } }),
    sources: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, sources: [] }),
    write: (_owner, _path, _method, body) => { writes++;requestId = body.requestId;revision = 11
      return Promise.reject(new Error('TIMEOUT')) },
    receipt: (_owner, queriedId) => ({ receipt: { commandId: 'cmd-timeout', requestId: queriedId,
      state: 'applied', worldRevision: 11 } }),
  })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('Timeout memory'), 'memory loaded')
  findButton(app.get('page-content'), 'Timeout memory')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '停用这项记忆'), 'mute action available')
  findButton(app.get('page-content'), '停用这项记忆')!.fire('click')
  findButton(app.get('page-content'), '确认停用')!.fire('click')
  await waitUntil(() => app.businessPaths.some((call) => call.path.endsWith(`/commands/by-request/${requestId}`)), 'receipt lookup sent')
  await waitUntil(() => app.get('page-content').textContent.includes('已停用'), 'applied receipt refreshed memory')
  assert.equal(writes, 1)
  assert.equal(app.businessPaths.filter((call) => call.method === 'POST').length, 1)
  assert.equal(app.storage.has('weftmate-mobile-memory-request:scope-A'), false)
})

test('item and source actions remain hidden when capability or current source state forbids them', async () => {
  const app = harness({
    status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: 10,
      capabilities: { list: true, source: true, correct: false, mute: false, deleteWorldItem: false, deleteEvidence: true } }),
    details: (owner) => ({ ownerId: appOwner(owner), worldRevision: 10, item: app.itemsByOwner[owner][0],
      availableActions: { correct: { available: true }, mute: { available: true }, delete: { available: true } } }),
    sources: (owner) => ({ ownerId: appOwner(owner), worldRevision: 10, sources: [
      { evidenceId: 'gone', relation: 'support', currentnessState: 'evidence_deleted', permissions: {},
        summary: 'already deleted', rawContent: null, contentAvailable: false }] }),
  })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('A memory private to A'), 'memory loaded')
  findButton(app.get('page-content'), 'A memory private to A')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('already deleted'), 'source loaded')
  for (const label of ['纠正这项理解', '停用这项记忆', '永久删除这项记忆', '删除这条来源'])
    assert.equal(findButton(app.get('page-content'), label), undefined)
})

test('unknown receipt keeps the original request marker for manual review without resending', async () => {
  let writes = 0
  const app = harness({
    status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: 10,
      capabilities: { list: true, source: true, mute: true } }),
    details: (owner) => ({ ownerId: appOwner(owner), worldRevision: 10, item: app.itemsByOwner[owner][0],
      availableActions: { mute: { available: true } } }),
    write: () => { writes++;return Promise.reject(new Error('TIMEOUT')) },
    receipt: () => Promise.reject(new Error('NOT_FOUND')),
  })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('A memory private to A'), 'memory loaded')
  findButton(app.get('page-content'), 'A memory private to A')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '停用这项记忆'), 'mute action available')
  findButton(app.get('page-content'), '停用这项记忆')!.fire('click')
  findButton(app.get('page-content'), '确认停用')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('原请求结果仍待确认'), 'uncertain state visible')
  assert.equal(writes, 1)
  assert.equal(app.storage.has('weftmate-mobile-memory-request:scope-A'), true)
  assert.ok(findButton(app.get('page-content'), '核对原请求'))
  assert.equal(findButton(app.get('page-content'), '停用这项记忆'), undefined)
})

test('late A mutation receipt cannot render or refresh A data after B logs in', async () => {
  let resolveA: (value: object) => void = () => {}
  const app = harness({
    status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: 10,
      capabilities: { list: true, source: true, mute: true } }),
    details: (owner) => ({ ownerId: appOwner(owner), worldRevision: 10, item: app.itemsByOwner[owner][0],
      availableActions: { mute: { available: true } } }),
    write: (owner) => owner === 'A' ? new Promise<object>((resolve) => { resolveA = resolve })
      : Promise.reject(new Error('INVALID_REQUEST')),
  })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('A memory private to A'), 'A memory loaded')
  findButton(app.get('page-content'), 'A memory private to A')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '停用这项记忆'), 'A action available')
  findButton(app.get('page-content'), '停用这项记忆')!.fire('click')
  findButton(app.get('page-content'), '确认停用')!.fire('click')
  await waitUntil(() => app.businessPaths.some((call) => call.owner === 'A' && call.method === 'POST'), 'A write started')
  await logoutAndLoginB(app);await openMemory(app, 'B')
  await waitUntil(() => app.get('page-content').textContent.includes('B memory private to B'), 'B memory loaded')
  const marker = JSON.parse(app.storage.get('weftmate-mobile-memory-request:scope-A')!)
  resolveA({ receipt: { commandId: 'cmd-A', requestId: marker.requestId, state: 'applied', worldRevision: 11 } })
  for (let index = 0; index < 20; index++) await flush()
  assert.match(app.get('page-content').textContent, /B memory private to B/)
  assert.doesNotMatch(app.get('page-content').textContent, /A memory private to A|记忆已停用/)
  assert.equal(app.storage.has('weftmate-mobile-memory-request:scope-A'), true)
})

test('correction result belongs to the acted-on item and clears when a different item opens', async () => {
  let revision = 10
  const oldItem = { id: 'purple', kind: 'cognition', text: 'I prefer purple', currentState: 'not_current', lifecycle: {}, sourceCount: 1 }
  const newItem = { id: 'green', kind: 'cognition', text: 'I prefer green', currentState: 'current', lifecycle: {}, sourceCount: 1 }
  const app = harness({
    status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: revision,
      capabilities: { list: true, source: true, correct: true } }),
    items: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, searchScope: 'account_snapshot',
      items: revision === 10 ? [{ ...oldItem, currentState: 'current' }] : [oldItem, newItem], nextCursor: null, hasMore: false }),
    details: (owner, _kind, id) => ({ ownerId: appOwner(owner), worldRevision: revision,
      item: id === 'green' ? newItem : { ...oldItem, currentState: revision === 10 ? 'current' : 'not_current' },
      availableActions: { correct: { available: id !== 'green' && revision === 10 } } }),
    sources: (owner) => ({ ownerId: appOwner(owner), worldRevision: revision, sources: [] }),
    write: (_owner, _path, _method, body) => { revision = 11
      return { receipt: { commandId: 'cmd-correct', requestId: body.requestId, state: 'applied', worldRevision: 11 } }
    },
  })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('I prefer purple'), 'purple item loaded')
  findButton(app.get('page-content'), 'I prefer purple')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '纠正这项理解'), 'correct action available')
  findButton(app.get('page-content'), '纠正这项理解')!.fire('click')
  const correction = findAll(app.get('page-content'), (node) => node.tagName === 'TEXTAREA')[0]
  correction.value = 'I prefer green';correction.fire('input')
  findButton(app.get('page-content'), '保存纠正')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('纠正已应用'), 'old item result visible')
  findButton(app.get('page-content'), '返回记忆列表')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), 'I prefer green'), 'new item listed')
  findButton(app.get('page-content'), 'I prefer green')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('I prefer green'), 'new detail visible')
  assert.doesNotMatch(app.get('page-content').textContent, /纠正已应用/)
})

test('delete conflict copy names source or dependency conflict without guessing another memory', async () => {
  const app = harness({
    status: (owner) => ({ ownerId: appOwner(owner), state: 'ready', worldRevision: 10,
      capabilities: { list: true, source: true, deleteWorldItem: true } }),
    details: (owner) => ({ ownerId: appOwner(owner), worldRevision: 10,
      item: app.itemsByOwner[owner][0],availableActions: { delete: { available: true } } }),
    write: (_owner, _path, _method, body) => ({ receipt: { commandId: 'cmd-reject',requestId: body.requestId,
      state: 'rejected',worldRevision: 10,reasonCode: 'MEMORY_DELETE_CONFLICT' } }),
  })
  await openMemory(app)
  await waitUntil(() => app.get('page-content').textContent.includes('A memory private to A'), 'item loaded')
  findButton(app.get('page-content'), 'A memory private to A')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '永久删除这项记忆'), 'delete available')
  findButton(app.get('page-content'), '永久删除这项记忆')!.fire('click')
  const input = findAll(app.get('page-content'), (node) => node.tagName === 'INPUT' && node.type === 'text')[0]
  input.value = '删除';input.fire('input')
  findButton(app.get('page-content'), '确认永久删除记忆')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('来源或依赖关系存在冲突'), 'conflict shown')
  assert.doesNotMatch(app.get('page-content').textContent, /其他记忆使用/)
})

test('mobile task detail observes exact stop state and ends polling at a proven terminal', async () => {
  let reads = 0
  const source = { commandId: 'task-a', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'session-a' }
  const task = (stopStatus: string, canResume = false) => ({ taskId: 'task-a', sessionId: 'session-a', sourceText: '请整理本周工作，并保留来源。',
    source, artifacts: [], control: { state: 'stop_requested', stopStatus, canStop: false,
      canSupplement: false, canResume, pendingReceipts: canResume ? 0 : 1,
      ...(stopStatus === 'stopped' ? { stopObservedAt: '2026-10-03T10:00:00.000Z' } : {}) } })
  const app = harness({ hostTask: { source: 'host', kind: 'session.message', commandId: 'task-a',
    taskId: 'task-a', sessionId: 'session-a', status: 'accepted_by_dsh', title: '合成任务' },
  taskDetail: () => { reads++; return task(reads === 1 ? 'requested' : reads === 2 ? 'cancel_requested' : 'stopped', reads >= 3) } })
  await waitUntil(() => app.calls.some((call) => call.method === 'app.ready'), 'mobile app did not boot')
  app.nav.find((button) => button.dataset.page === 'things')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '继续电脑会话'), 'host activity did not load')
  findButton(app.get('page-content'), '继续电脑会话')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('目前还不能确认已停止'), 'request state missing')
  await waitUntil(() => app.get('page-content').textContent.includes('实际停止'), 'stopped state missing')
  assert.match(app.get('page-content').textContent, /这件事已停止.*原目标.*请整理本周工作.*停止核对.*恢复这件事/)
  assert.match(app.get('page-content').textContent, /没有可查看的文件成果/)
  assert.doesNotMatch(app.get('page-content').textContent, /已交给电脑会话/)
  const count = reads
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(reads, count, 'polling stops when exact terminal is observed')
  assert.equal(app.calls.some((call) => call.method === 'shared.tasks.stop'), false)
})

test('mobile task detail keeps normal completion and legacy uncertainty distinct', async () => {
  let legacy = false
  const source = { commandId: 'task-a', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'session-a' }
  const app = harness({ hostTask: { source: 'host', kind: 'session.message', commandId: 'task-a',
    taskId: 'task-a', sessionId: 'session-a', status: 'accepted_by_dsh', title: '合成任务' },
  taskDetail: () => ({ taskId: 'task-a', sessionId: 'session-a', source, artifacts: [], control: legacy
    ? { state: 'stop_requested', stopStatus: 'unconfirmed', legacyStopIntent: true,
      canStop: false, canSupplement: false, canResume: false, pendingReceipts: 1 }
    : { state: 'stop_requested', stopStatus: 'completed', canStop: false,
      canSupplement: false, canResume: true, pendingReceipts: 0 } }) })
  await waitUntil(() => app.calls.some((call) => call.method === 'app.ready'), 'mobile app did not boot')
  app.nav.find((button) => button.dataset.page === 'things')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '继续电脑会话'), 'host activity did not load')
  findButton(app.get('page-content'), '继续电脑会话')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('正常结束'), 'completion copy missing')
  assert.match(app.get('page-content').textContent, /没有已证实的中断结果.*恢复这件事/)
  legacy = true
  findButton(app.get('page-content'), '刷新任务')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('旧停止记录'), 'legacy copy missing')
  assert.doesNotMatch(app.get('page-content').textContent, /恢复这件事/)
})

test('mobile late stop observation cannot update a closed detail', async () => {
  let reads = 0
  let resolveLate!: (value: object) => void
  const late = new Promise<object>((resolve) => { resolveLate = resolve })
  const source = { commandId: 'task-a', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'session-a' }
  const detail = (status: string) => ({ taskId: 'task-a', sessionId: 'session-a', source, artifacts: [],
    control: { state: 'stop_requested', stopStatus: status, canStop: false, canSupplement: false,
      canResume: status === 'stopped', pendingReceipts: status === 'stopped' ? 0 : 1 } })
  const app = harness({ hostTask: { source: 'host', kind: 'session.message', commandId: 'task-a',
    taskId: 'task-a', sessionId: 'session-a', status: 'accepted_by_dsh' },
  taskDetail: () => ++reads === 1 ? detail('requested') : late })
  await waitUntil(() => app.calls.some((call) => call.method === 'app.ready'), 'mobile app did not boot')
  app.nav.find((button) => button.dataset.page === 'things')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '继续电脑会话'), 'host activity did not load')
  findButton(app.get('page-content'), '继续电脑会话')!.fire('click')
  await waitUntil(() => reads >= 2, 'stop observation did not start')
  app.nav.find((button) => button.dataset.page === 'connect')!.fire('click')
  resolveLate(detail('stopped'))
  await flush()
  assert.doesNotMatch(app.get('page-content').textContent, /实际停止/)
  const count = reads
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(reads, count)
})

test('mobile fetches bounded root labels without using task detail or repeating a command', async () => {
  const activities = Array.from({ length: 10 }, (_, index) => ({ source: 'host', kind: 'session.message',
    commandId: `task-${index + 1}`, taskId: `task-${index + 1}`, sessionId: 'session-a', status: 'accepted_by_dsh' }))
  const app = harness({ hostActivities: activities, commandDetail: (_owner, commandId) => ({ command: {
    commandId, kind: 'session.message', taskLabel: `目标 ${commandId}`, state: 'accepted_by_dsh' } }) })
  await waitUntil(() => app.calls.some((call) => call.method === 'app.ready'), 'mobile app did not boot')
  app.nav.find((button) => button.dataset.page === 'things')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('目标 task-8'), 'visible labels did not load')
  assert.match(app.get('page-content').textContent, /目标 task-1/)
  assert.doesNotMatch(app.get('page-content').textContent, /目标 task-9|目标 task-10/)
  assert.equal(app.calls.filter((call) => call.method === 'shared.commands.detail').length, 8)
  assert.equal(app.calls.some((call) => call.method === 'shared.tasks.detail'), false)
  assert.equal(app.calls.some((call) => call.method === 'shared.tasks.stop'), false)
})

test('a late task label from account A cannot replace account B title', async () => {
  let resolveA!: (value: object) => void
  const lateA = new Promise<object>((resolve) => { resolveA = resolve })
  const hostTask = { source: 'host', kind: 'session.message', commandId: 'task-same',
    taskId: 'task-same', sessionId: 'session-a', status: 'accepted_by_dsh' }
  const app = harness({ hostTask, commandDetail: (owner, commandId) => owner === 'A' ? lateA : {
    command: { commandId, kind: 'session.message', taskLabel: 'B 的目标', state: 'accepted_by_dsh' } } })
  await waitUntil(() => app.calls.some((call) => call.method === 'app.ready'), 'mobile app did not boot')
  app.nav.find((button) => button.dataset.page === 'things')!.fire('click')
  await waitUntil(() => app.calls.some((call) => call.method === 'shared.commands.detail' && call.owner === 'A'), 'A label request missing')
  await logoutAndLoginB(app)
  app.nav.find((button) => button.dataset.page === 'things')!.fire('click')
  await waitUntil(() => app.get('page-content').textContent.includes('B 的目标'), 'B label missing')
  resolveA({ command: { commandId: 'task-same', kind: 'session.message', taskLabel: 'A 的私人目标' } })
  await flush()
  assert.match(app.get('page-content').textContent, /B 的目标/)
  assert.doesNotMatch(app.get('page-content').textContent, /A 的私人目标/)
})

test('project session saves owner-host choice before POST and selects only the exact bound session', async () => {
  const projectId = 'project-11111111-1111-4111-8111-111111111111'
  const sessionId = 'session-11111111-1111-4111-8111-111111111111'
  let app!: ReturnType<typeof harness>
  let storedAtPost = ''
  const row = { projectId, name: '合成项目', revision: 1, revoked: false,
    createdAt: '2026-10-03T00:00:00.000Z' }
  app = harness({ projectList: () => ({ source: 'host', hostId: 'host-fixture', projects: [row], canManage: false }),
    hostModels: () => ({ models: [{ source: 'host', profileId: 'model-local', displayName: '本地模型',
      sourceKind: 'local', configured: true }] }),
    projectReceipt: () => { throw new Error('NOT_FOUND') },
    projectCreate: (_owner, params) => {
      storedAtPost = app.storage.get('weftmate-project-create:scope-A:host-fixture') ?? ''
      return { source: 'host', command: { commandId: 'cmd-create', kind: 'session.create',
        requestId: params.requestId, projectId, modelProfileId: params.modelProfileId,
        sessionId, state: 'accepted_by_dsh' } }
    },
    projectSessions: () => ({ source: 'host', hostAvailable: true, sessions: [{ source: 'host',
      sessionId, projectId, modelProfileId: 'model-local', sendAvailable: true }] }) })
  await waitUntil(() => app.calls.some((call) => call.method === 'app.ready'), 'mobile app did not boot')
  app.nav.find((button) => button.dataset.page === 'workspaces')!.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '在此项目开始对话'), 'project action missing')
  assert.match(app.get('page-content').textContent, /合成项目.*本地模型.*资料将交给电脑本机模型/)
  findButton(app.get('page-content'), '在此项目开始对话')!.fire('click')
  await waitUntil(() => app.calls.some((call) => call.method === 'shared.projects.createSession'), 'project POST missing')
  assert.match(storedAtPost, /"projectId":"project-1111/)
  const methods = app.calls.map((call) => call.method)
  assert.ok(methods.indexOf('shared.commands.byRequest') < methods.indexOf('shared.projects.createSession'))
  await waitUntil(() => !app.storage.has('weftmate-project-create:scope-A:host-fixture'), 'project intent was not reconciled')
  assert.ok(app.calls.some((call) => call.method === 'shared.sessions.list'))
  assert.equal(app.calls.filter((call) => call.method === 'shared.projects.createSession').length, 1)
})

test('lost project-session POST receipt reuses the saved request before selecting a session', async () => {
  const projectId = 'project-22222222-2222-4222-8222-222222222222'
  const sessionId = 'session-22222222-2222-4222-8222-222222222222'
  let accepted: any = null
  let postCount = 0
  const app = harness({ projectList: () => ({ source: 'host', hostId: 'host-fixture',
    projects: [{ projectId, name: '断线项目', revision: 1, revoked: false }], canManage: false }),
  hostModels: () => ({ models: [{ profileId: 'model-local', displayName: '本地模型',
    sourceKind: 'local', configured: true }] }),
  projectReceipt: () => accepted ? { source: 'host', command: accepted } : (() => { throw new Error('NOT_FOUND') })(),
  projectCreate: (_owner, params) => {
    postCount++
    accepted = { commandId: 'cmd-lost', kind: 'session.create', requestId: params.requestId,
      projectId, modelProfileId: params.modelProfileId, sessionId, state: 'accepted_by_dsh' }
    throw new Error('NETWORK')
  }, projectSessions: () => ({ source: 'host', sessions: [{ source: 'host', sessionId, projectId,
    modelProfileId: 'model-local', sendAvailable: true }] }) })
  await waitUntil(() => app.calls.some((call) => call.method === 'app.ready'), 'mobile app did not boot')
  const workspace = app.nav.find((button) => button.dataset.page === 'workspaces')!
  workspace.fire('click')
  await waitUntil(() => !!findButton(app.get('page-content'), '在此项目开始对话'), 'project action missing')
  findButton(app.get('page-content'), '在此项目开始对话')!.fire('click')
  await waitUntil(() => postCount === 1, 'first project POST missing')
  assert.ok(app.storage.has('weftmate-project-create:scope-A:host-fixture'))
  workspace.fire('click')
  await waitUntil(() => !app.storage.has('weftmate-project-create:scope-A:host-fixture'), 'lost receipt was not reconciled')
  assert.equal(postCount, 1, 'recovery must not create a second session')
  assert.ok(app.calls.filter((call) => call.method === 'shared.commands.byRequest').length >= 2)
})
