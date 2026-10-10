import { desktopFeatureSource, desktopHtml, mountDesktopTestTree } from './helpers/desktop-ui-source.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))

test('isolated synthetic memory HTTP contract keeps owners, cursors and receipts separate', { timeout: 30000 }, async () => {
  const repositoryRoot = process.env.WEFTMATE_REPO_ROOT ?? root
  assert.ok(existsSync(join(repositoryRoot, 'src', 'personal-access', 'index.mjs')),
    'Set WEFTMATE_REPO_ROOT when running this isolated candidate; an integrated repository needs no override')
  const child = spawn(process.execPath, [join(root, 'tests', 'tools', 'memory-ui-fixture.mjs')], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, WEFTMATE_REPO_ROOT: repositoryRoot },
  })
  let output = ''
  let errors = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { errors += chunk })
  const started: Promise<any> = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`fixture startup timed out: ${errors}`)), 15000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      try { const value = JSON.parse(output); clearTimeout(timeout); resolve(value) } catch { /* Await complete JSON. */ }
    })
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`fixture exited ${code}: ${errors}`)) })
  })
  try {
    const fixture = await started
    const privateFixture = JSON.parse(await readFile(join(fixture.dataRoot, 'fixture.json'), 'utf8'))
    const [a, b] = privateFixture.accounts
    const request = async (account: any, path: string, options: { method?: string; body?: object } = {}) => {
      const response = await fetch(`${fixture.browserOrigin}/personal/v1/memory${path}`, {
        method: options.method ?? 'GET',
        headers: { cookie: account.cookie, ...(options.body ? { 'content-type': 'application/json', origin: fixture.browserOrigin,
          'x-weftmate-csrf': account.csrfToken } : {}) },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      })
      return { status: response.status, body: await response.json() }
    }
    const statusA = await request(a, '/status')
    const statusB = await request(b, '/status')
    assert.equal(statusA.body.ownerId, a.ownerId)
    assert.equal(statusB.body.ownerId, b.ownerId)
    assert.equal(statusA.body.capabilities.inject, true)
    const first = await request(a, '/items?kind=cognition&limit=20')
    assert.equal(first.status, 200)
    assert.equal(first.body.searchScope, 'account_snapshot')
    assert.equal(first.body.items.length, 20)
    assert.equal(first.body.hasMore, true)
    const fullSearch = await request(a, '/items?kind=cognition&query=%E9%93%B6%E6%9D%8F&limit=20')
    assert.deepEqual(fullSearch.body.items.map((item: any) => item.id), ['memory-a-long'])
    assert.equal(fullSearch.body.items[0].truncated, true)
    assert.equal(fullSearch.body.items[0].text.includes('银杏'), false)
    const bItems = await request(b, '/items?kind=cognition&limit=20')
    assert.deepEqual(bItems.body.items.map((item: any) => item.id), ['memory-b-1'])
    assert.equal((await request(b, '/items/cognition/memory-a-1')).status, 404)
    assert.equal((await request(b, '/items/cognition/memory-a-1/sources')).status, 404)
    const detail = await request(a, '/items/cognition/memory-a-1')
    assert.equal(detail.body.item.text, '合成账户A偏好简洁的中文说明。')
    assert.equal(detail.body.availableActions.correct.available, true)
    const source = await request(a, '/items/cognition/memory-a-1/sources')
    assert.equal(source.body.sources[0].permissions.allowLocalRead, true)
    assert.equal(source.body.sources[0].contentAvailable, true)
    const corrected = await request(a, '/items/cognition/memory-a-1/correct', { method: 'POST', body: {
      requestId: 'correct-a-first', expectedWorldRevision: detail.body.worldRevision, text: '合成账户A的新理解。',
    } })
    assert.equal(corrected.body.receipt.state, 'applied')
    assert.equal(corrected.body.ownerId, a.ownerId)
    const stale = await request(a, `/items?kind=cognition&limit=20&after=${encodeURIComponent(first.body.nextCursor)}`)
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error.code, 'MEMORY_REVISION_CHANGED')
    assert.equal((await request(a, '/commands/by-request/correct-a-first')).body.receipt.state, 'applied')
    assert.equal((await request(b, '/commands/by-request/correct-a-first')).status, 404)
    const entity = await request(a, '/items/entity/memory-a-entity')
    assert.equal(entity.body.availableActions.correct.available, false)
    assert.equal(entity.body.availableActions.correct.reasonCode, 'MEMORY_ACTION_UNSUPPORTED')
    assert.equal((await request(a, '/items/entity/memory:a:colon')).body.item.id, 'memory:a:colon')
    const shared = await request(a, '/items/cognition/memory-a-shared')
    const conflict = await request(a, '/items/cognition/memory-a-shared', { method: 'DELETE', body: {
      requestId: 'delete-shared', expectedWorldRevision: shared.body.worldRevision,
    } })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.receipt.reasonCode, 'MEMORY_DELETE_CONFLICT')
    const old = await request(a, '/items/cognition/memory-a-old')
    const unrecoverable = await request(a, '/items/cognition/memory-a-old', { method: 'DELETE', body: {
      requestId: 'delete-old', expectedWorldRevision: old.body.worldRevision,
    } })
    assert.equal(unrecoverable.body.receipt.reasonCode, 'MEMORY_SOURCE_UNRECOVERABLE')
    const control = async (body: object) => {
      const response = await fetch(`${fixture.browserOrigin}/__fixture/control`, { method: 'POST',
        headers: { origin: fixture.browserOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      assert.equal(response.status, 200)
    }
    await control({ nextPreDispatchCode: 'INVALID_REQUEST' })
    const notSubmitted = await request(a, '/items/cognition/memory-a-1/correct', { method: 'POST', body: {
      requestId: 'pre-dispatch-invalid', expectedWorldRevision: corrected.body.receipt.worldRevision,
      text: '合成重新填写的说明。',
    } })
    assert.equal(notSubmitted.body.error.code, 'INVALID_REQUEST')
    assert.equal((await request(a, '/commands/by-request/pre-dispatch-invalid')).status, 404,
      'pre-dispatch refusal has no command receipt')
    await control({ serviceUnavailableAfterDispatch: true })
    const uncertainService = await request(a, '/items/cognition/memory-a-1/correct', { method: 'POST', body: {
      requestId: 'service-unavailable-after-dispatch', expectedWorldRevision: corrected.body.receipt.worldRevision,
      text: '合成回执丢失后的新理解。',
    } })
    assert.equal(uncertainService.body.error.code, 'SERVICE_UNAVAILABLE')
    assert.equal((await request(a, '/commands/by-request/service-unavailable-after-dispatch')).body.receipt.state, 'applied',
      'SERVICE_UNAVAILABLE requires querying the original request')
    const longDetail = await request(a, '/items/cognition/memory-a-long')
    const longCorrection = await request(a, '/items/cognition/memory-a-long/correct', { method: 'POST', body: {
      requestId: 'correct-long-full-text', expectedWorldRevision: longDetail.body.worldRevision,
      text: '合成替换后的全文。',
    } })
    assert.equal(longCorrection.body.receipt.state, 'applied')
    assert.equal((await request(a, '/items?kind=cognition&query=%E9%93%B6%E6%9D%8F&limit=20')).body.items.length, 0,
      'correct must replace full searchable text, not keep stale hidden content')
    await control({ state: 'degraded', pendingBoundaryCount: 1, blockedBoundaryCount: 1,
      lastFailureCode: 'SYNTHETIC_BLOCKED' })
    const degraded = await request(a, '/status')
    assert.equal(degraded.body.state, 'degraded')
    assert.equal(degraded.body.capabilities.list, true)
    assert.equal(degraded.body.capabilities.inject, false)
    assert.equal(degraded.body.pendingBoundaryCount, 1)
    assert.equal(degraded.body.blockedBoundaryCount, 1)
    await control({ simulateHardDeletedSource: true, searchLimit: true })
    const readyAfterDiscard = await request(a, '/status')
    assert.equal(readyAfterDiscard.body.state, 'ready')
    assert.equal(readyAfterDiscard.body.pendingBoundaryCount, 0)
    assert.equal(readyAfterDiscard.body.blockedBoundaryCount, 0)
    assert.equal(readyAfterDiscard.body.discardedBoundaryCount, 1)
    assert.equal(readyAfterDiscard.body.lastFailureCode, 'MEMORY_SOURCE_DELETED')
    await control({ state: 'disabled' })
    const disabled = await request(a, '/status')
    assert.equal(disabled.body.worldRevision, null)
    assert.equal(disabled.body.pendingBoundaryCount, 0)
    assert.equal(disabled.body.capabilities.list, false)
    await control({ state: 'unavailable' })
    const unavailable = await request(a, '/status')
    assert.equal(unavailable.body.worldRevision, null)
    assert.equal(unavailable.body.pendingBoundaryCount, null)
    await control({ state: 'ready' })
    assert.equal((await request(a, '/items?kind=cognition&limit=20')).body.error.code, 'MEMORY_SEARCH_LIMIT')
    await control({ searchLimit: false, dropNextReceipt: true, deleteCleanup: 'pending' })
    const latest = await request(a, '/items/cognition/memory-a-1')
    await assert.rejects(() => request(a, '/items/cognition/memory-a-1', { method: 'DELETE', body: {
      requestId: 'lost-delete-receipt', expectedWorldRevision: latest.body.worldRevision,
    } }))
    const recovered = await request(a, '/commands/by-request/lost-delete-receipt')
    assert.equal(recovered.body.receipt.state, 'applied')
    assert.deepEqual(recovered.body.receipt.storageCleanup, { state: 'pending', detailCode: 'SYNTHETIC_FIXTURE' })
    assert.equal((await request(a, '/items/cognition/memory-a-1')).status, 404)
    assert.equal((await request(b, '/items/cognition/memory-b-1')).status, 200)
  } finally {
    child.kill('SIGINT')
    await new Promise((resolve) => { if (child.exitCode !== null) resolve(null); else child.once('exit', resolve) })
  }
})

test('memory page keeps scripts external and uses only the candidate static publisher', async () => {
  const html = desktopHtml()
  const publisher = await readFile(join(root, 'src', 'personal-access-ui', 'index.mjs'), 'utf8')
  assert.match(html, /id="rail-memory"/)
  assert.match(html, /id="memory-view"/)
  assert.match(html, /id="memory-detail-dialog"/)
  assert.doesNotMatch(html, /<script(?![^>]*src=)/i)
  assert.match(publisher, /default-src 'none'; script-src 'self'; style-src 'self';/)
  assert.match(publisher, /connect-src 'self'/)
  assert.doesNotMatch(publisher, /script-src[^;]*unsafe-inline/)
})

test('memory view preserves chat draft and discards a successful response for another cookie owner', async () => {
  const source = desktopFeatureSource()
  class Node {
    id: string
    children: Node[] = []
    parentNode: Node | null = null
    get parentElement() { return this.parentNode }
    tagName = 'DIV'
    attributes = new Map<string, string>()
    listeners = new Map<string, Array<(event: any) => void>>()
    hidden = false
    disabled = false
    open = false
    value = ''
    textContent = ''
    className = ''
    dataset: Record<string, string> = {}
    // Mirrors DOMTokenList closely enough for class-driven visibility checks.
    classList = (() => { const names = new Set<string>(); return {
      add: (...values: string[]) => { for (const value of values) names.add(value) },
      remove: (...values: string[]) => { for (const value of values) names.delete(value) },
      toggle: (value: string, force?: boolean) => { const on = force ?? !names.has(value); if (on) names.add(value); else names.delete(value); return on },
      contains: (value: string) => names.has(value) } })()
    constructor(id = '') { this.id = id }
    addEventListener(name: string, fn: (event: any) => void) {
      this.listeners.set(name, [...this.listeners.get(name) ?? [], fn])
    }
    fire(name: string) {
      for (const fn of this.listeners.get(name) ?? []) fn({ currentTarget: this, target: this, preventDefault() {} })
    }
    dispatchEvent(event: Event) { this.fire(event.type); return true }
    append(...nodes: Node[]) { for (const node of nodes) node.parentNode = this; this.children.push(...nodes) }
    prepend(...nodes: Node[]) { for (const node of nodes) node.parentNode = this; this.children.unshift(...nodes) }
    before(...nodes: Node[]) { if (!this.parentNode) return; const at = this.parentNode.children.indexOf(this); for (const node of nodes) node.parentNode = this.parentNode; this.parentNode.children.splice(at, 0, ...nodes) }
    after(...nodes: Node[]) { if (!this.parentNode) return; const at = this.parentNode.children.indexOf(this) + 1; for (const node of nodes) node.parentNode = this.parentNode; this.parentNode.children.splice(at, 0, ...nodes) }
    replaceChildren(...nodes: Node[]) { this.children = nodes }
    cloneNode(deep = false) { const copy = new Node(this.id); copy.tagName=this.tagName;copy.className=this.className;copy.textContent=this.textContent;copy.hidden=this.hidden;copy.disabled=this.disabled;copy.attributes=new Map(this.attributes);copy.dataset={...this.dataset};if(deep)copy.append(...this.children.map(child=>child.cloneNode(true)));return copy }
    setAttribute(name: string, value: string) { this.attributes.set(name, value) }
    getAttribute(name: string) { return this.attributes.get(name) ?? null }
    removeAttribute() {}
    get firstElementChild() { return this.children[0] || null }
    querySelectorAll(selector: string): Node[] { const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]); return selector === '*' ? all : all.filter(child => selector.startsWith('#') ? child.id === selector.slice(1) : child.tagName === selector.toUpperCase()) }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null }
    closest(selector: string): Node | null { for(let parent: Node | null = this; parent; parent = parent.parentNode) if(selector.startsWith('#') ? parent.id === selector.slice(1) : parent.tagName === selector.toUpperCase()) return parent; return null }
    focus() {}
    showModal() { this.open = true }
    close() { this.open = false }
  }
  const nodes = new Map<string, Node>()
  const get = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id)! }
  const descendants = (node: Node): Node[] => node.children.flatMap(child => [child, ...descendants(child)])
  const visibleText = (node: Node): string => [node.textContent, ...node.children.map(visibleText)].join(' ')
  const memoryButton = (text: string) => {
    const matches = descendants(get('memory-list')).filter(node => node.tagName === 'BUTTON' && visibleText(node).includes(text))
    assert.equal(matches.length, 1, `one memory button named ${text}`)
    return matches[0]
  }
  const memoryItem = { id: 'memory-a-1', kind: 'cognition', text: '合成账户A的独立记忆。',
    currentState: 'current', lifecycle: { invalidAt: null, archivedAt: null, mutedAt: null }, sourceCount: 1 }
  ;(memoryItem as any).truncated = true
  ;(memoryItem.lifecycle as any).invalidAt = '2026-09-27T08:00:00.000Z'
  ;(memoryItem.lifecycle as any).archivedAt = '2026-09-27T08:00:00.000Z'
  ;(memoryItem.lifecycle as any).mutedAt = '2026-09-27T08:00:00.000Z'
  const secondItem = { id: 'memory-a-2', kind: 'cognition', text: '合成账户A的第二项记忆。',
    currentState: 'current', lifecycle: { invalidAt: null, archivedAt: null, mutedAt: null }, sourceCount: 1 }
  let memoryItems = [memoryItem, secondItem]
  let memoryOwner = 'owner-a'
  let memoryState = 'ready'
  let memoryRevision = 1
  let pendingBoundaryCount = 0
  let blockedBoundaryCount = 0
  let discardedBoundaryCount = 0
  let lastFailureCode: string | null = null
  let loseNextCorrect = false
  let rejectNextCorrect = false
  let missingNextCorrect = false
  let deferNextCorrect = false
  let finishDelayedCorrect: (() => void) | null = null
  let cleanupReceipt: any = null
  let cleanupReply: 'pending' | 'complete' | 'forbidden' | 'network' = 'pending'
  let retryPostCount = 0
  let retryCoreCount = 0
  let cleanupGetCount = 0
  let requestSequence = 0
  const correctRequestIds: string[] = []
  const requests: string[] = []
  const memorySources = ['current', 'not_current', 'evidence_deleted', 'evidence_local_read_denied',
    'evidence_cloud_read_denied', 'evidence_not_model_readable', 'evidence_missing',
    'evidence_subject_mismatch', 'future_source_state'].map((currentnessState) => ({
      evidenceId: `synthetic-${currentnessState}`, relation: 'supports', currentnessState,
      contentAvailable: currentnessState === 'current', rawContentTruncated: false,
      summary: '合成来源', rawContent: '合成原文',
      permissions: { allowLocalRead: true, allowCloudRead: false, allowInference: true },
    }))
  const response = (body: object, status = 200) => ({ ok: status < 400, status, json: async () => body })
  const fetch = async (url: string, options: any = {}) => {
    requests.push(url)
    if (url.endsWith('/auth/state')) return response({ configured: true })
    if (url.endsWith('/auth/me')) return response({ account: { ownerId: 'owner-a', username: 'FixtureA',
      displayName: '合成账户A', avatar: null, profileRevision: 0 },
    device: { id: 'device-a', name: '合成设备A' }, csrfToken: 'synthetic-csrf' })
    if (url.endsWith('/memory/status')) return response({ ownerId: memoryOwner, state: memoryState,
      worldRevision: memoryRevision, capabilities: { list: true, source: true, correct: true, mute: true,
        deleteWorldItem: true, deleteEvidence: true, inject: memoryState === 'ready' },
      pendingBoundaryCount, blockedBoundaryCount, discardedBoundaryCount, lastFailureCode })
    if (url.endsWith('/memory/items/cognition/memory-a-1/correct') && options.method === 'POST') {
      const body = JSON.parse(options.body)
      correctRequestIds.push(body.requestId)
      if (loseNextCorrect) { loseNextCorrect = false; throw new Error('synthetic response loss') }
      if (rejectNextCorrect) {
        rejectNextCorrect = false
        return response({ ownerId: 'owner-a', error: { code: 'INVALID_REQUEST' } }, 400)
      }
      if (missingNextCorrect) {
        missingNextCorrect = false
        memoryItems = memoryItems.filter((item) => item.id !== 'memory-a-1')
        return response({ ownerId: 'owner-a', error: { code: 'NOT_FOUND' } }, 404)
      }
      if (deferNextCorrect) {
        deferNextCorrect = false
        return new Promise((resolve) => {
          finishDelayedCorrect = () => {
            memoryItem.text = body.text
            memoryRevision++
            resolve(response({ ownerId: 'owner-a', receipt: { commandId: 'synthetic-delayed-command',
              requestId: body.requestId, state: 'applied', worldRevision: memoryRevision } }))
          }
        })
      }
      memoryItem.text = body.text
      memoryRevision++
      return response({ ownerId: 'owner-a', receipt: { commandId: 'synthetic-command', requestId: body.requestId,
        state: 'applied', worldRevision: memoryRevision } })
    }
    if (url.endsWith('/forget-preview')) return response({ ownerId: 'owner-a', worldRevision: memoryRevision, itemCount: 2, evidenceCount: 1, items: [secondItem, { id: 'person', kind: 'entity', itemType: 'person', text: '王小明' }] })
    if (url.endsWith('/memory/items/cognition/memory-a-2') && options.method === 'DELETE') {
      const body = JSON.parse(options.body)
      memoryItems = memoryItems.filter((item) => item.id !== 'memory-a-2')
      memoryRevision++
      cleanupReceipt = { commandId: 'synthetic-delete', requestId: body.requestId,
        state: 'applied', worldRevision: memoryRevision,
        storageCleanup: { state: 'pending', detailCode: 'SYNTHETIC_FIXTURE' } }
      return response({ ownerId: 'owner-a', receipt: cleanupReceipt })
    }
    if (url.includes('/memory/commands/by-request/') && url.endsWith('/retry-cleanup') && options.method === 'POST') {
      retryPostCount++
      assert.equal(options.body, '{}')
      assert.equal(options.headers['X-WeftMate-CSRF'], 'synthetic-csrf')
      if (cleanupReply === 'forbidden') return response({ ownerId: 'owner-a', error: { code: 'FORBIDDEN' } }, 403)
      if (cleanupReply === 'network') throw new Error('synthetic retry response loss')
      retryCoreCount++
      cleanupReceipt.storageCleanup = { state: cleanupReply, detailCode: 'SYNTHETIC_FIXTURE' }
      return response({ ownerId: 'owner-a', receipt: cleanupReceipt })
    }
    if (url.includes('/memory/commands/by-request/') && options.method !== 'POST') {
      cleanupGetCount++
      return response({ ownerId: 'owner-a', receipt: cleanupReceipt })
    }
    if (url.endsWith('/memory/items/cognition/memory-a-1/sources')) return response({ ownerId: memoryOwner,
      worldRevision: memoryRevision, sources: memorySources })
    if (url.endsWith('/memory/items/cognition/memory-a-2/sources')) return response({ ownerId: memoryOwner,
      worldRevision: memoryRevision, sources: [] })
    if (url.endsWith('/memory/items/cognition/memory-a-1')) return response({ ownerId: memoryOwner,
      worldRevision: memoryRevision, item: memoryItem, availableActions: {
        correct: { available: true }, mute: { available: true }, delete: { available: true } } })
    if (url.endsWith('/memory/items/cognition/memory-a-2')) return response({ ownerId: memoryOwner,
      worldRevision: memoryRevision, item: secondItem, availableActions: {
        correct: { available: true }, mute: { available: true }, delete: { available: true } } })
    if (url.includes('/memory/items?')) return response({ ownerId: memoryOwner, items: memoryItems,
      worldRevision: memoryRevision, nextCursor: null, hasMore: false, searchScope: 'account_snapshot' })
    if (url.endsWith('/status')) return response({ ownerId: 'owner-a', hostId: 'host-fixture',
      backend: { capabilities: { chat: { available: false }, desktopOpenApp: { available: false },
        naturalLanguageDesktop: { available: false } } } })
    if (url.endsWith('/models')) return response({ models: [] })
    if (url.endsWith('/sessions')) return response({ sessions: [] })
    if (url.includes('/commands?')) return response({ commands: [], nextBefore: null, hasMore: false })
    return response({ error: { code: 'NOT_FOUND' } }, 404)
  }
  const storage = new Map<string, string>()
  const document = { body: new Node('body'), visibilityState: 'visible',
    getElementById: get, createElement: (tag: string) => { const node = new Node(); node.tagName = tag.toUpperCase(); return node },
    createTextNode: (text: string) => { const node = new Node(); node.textContent = text; return node },
    createElementNS: (_namespace: string, tag: string) => { const node = new Node(); node.tagName = tag.toUpperCase(); return node },
    querySelector: (selector: string) => selector === '.local-badge' ? get('local-badge') : selector === 'section.settings-category[data-category="general"]' ? get('general-panel') : null,
    querySelectorAll: () => [], addEventListener() {} }
  const window = { location: { hash: '', pathname: '/personal/v1/ui', search: '' },
    history: { replaceState() {} }, addEventListener() {}, WeftIcons: null as any }
  mountDesktopTestTree(document, get)
  const context = { document, window, matchMedia: () => ({matches:false,addEventListener(){},removeEventListener(){}}), location: { ...window.location, protocol: 'http:' }, fetch, URL, URLSearchParams, AbortSignal, Intl, Event,
    Option: class extends Node { constructor(text: string, value: string) { super(); this.tagName = 'OPTION'; this.textContent = text; this.value = value } },
    crypto: { randomUUID: () => `synthetic-${++requestSequence}` },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) }, removeItem: (key: string) => { storage.delete(key) } },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, console }
  const icons = await readFile(join(root, 'src', 'personal-access-ui', 'icons.js'), 'utf8')
  runInNewContext(icons + '\nwindow.WeftIcons = globalThis.WeftIcons;', context)
  runInNewContext(source, context)
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  for (let i = 0; i < 20 && get('assistant-view').hidden; i++) await flush()
  assert.equal(get('assistant-view').hidden, false)
  get('message-text').value = '保留的对话草稿'
  get('rail-memory').fire('click')
  for (let i = 0; i < 20 && get('memory-list').children.length === 0; i++) await flush()
  assert.equal(get('memory-list').children.length, 2, JSON.stringify({ requests, status: get('memory-status').textContent }))
  assert.match(visibleText(memoryButton(memoryItem.text)), /仅显示片段/)
  const lifecycle = visibleText(memoryButton(memoryItem.text))
  assert.match(lifecycle, /已失效/)
  assert.match(lifecycle, /已归档/)
  assert.match(lifecycle, /已停用/)
  ;(memoryItem.lifecycle as any).invalidAt = null
  ;(memoryItem.lifecycle as any).archivedAt = null
  ;(memoryItem.lifecycle as any).mutedAt = null
  memoryButton(memoryItem.text).fire('click')
  for (let i = 0; i < 20 && !get('memory-detail-status').textContent.includes('详情与来源已读取'); i++) await flush()
  assert.deepEqual(get('memory-sources').children.map((row) => row.children[0].textContent.split(' · ')[0]), [
    '当前来源', '来源不再支持当前理解', '来源已删除', '来源未允许本机模型读取',
    '来源未允许云端模型读取', '来源当前不可供模型读取', '来源记录未找到', '来源账户不匹配', '来源状态待确认',
  ], 'source status labels must preserve known meanings and reserve confirmation wording for unknown values')
  for (let i = 0; i < 20 && get('memory-correct-action').hidden; i++) await flush()
  get('memory-correct-action').fire('click')
  assert.equal(get('memory-correct-text').value, '', 'correct must not prefill displayed text')
  get('memory-correct-text').value = '合成账户A的新理解。'
  get('memory-correct-text').fire('input')
  get('memory-confirm-action').fire('click')
  for (let i = 0; i < 20 && get('memory-receipt').hidden; i++) await flush()
  assert.equal(get('memory-receipt').hidden, false, JSON.stringify({ requests,
    detailError: get('memory-detail-error').textContent, detailStatus: get('memory-detail-status').textContent,
    status: get('memory-status').textContent }))
  assert.match(get('memory-receipt-text').textContent, /纠正已应用/)
  assert.match(get('memory-receipt-id').textContent, /^memory-/)
  assert.equal(requests.filter((url) => url.endsWith('/memory/items/cognition/memory-a-1/correct')).length, 1)
  for (let i = 0; i < 20 && get('memory-list').children.length !== 2; i++) await flush()
  memoryButton(secondItem.text).fire('click')
  for (let i = 0; i < 20 && get('memory-delete-action').hidden; i++) await flush()
  get('memory-delete-action').fire('click')
  assert.equal(get('memory-confirm-action').disabled, true, 'wait for preview before confirmation')
  for (let i = 0; i < 20 && get('memory-confirm-action').disabled; i++) await flush()
  assert.match(get('memory-forget-scope').children[0].textContent, /2 项记忆/)
  get('memory-confirm-action').fire('click')
  for (let i = 0; i < 20 && !get('memory-receipt-text').textContent.includes('底层清理待完成'); i++) await flush()
  assert.match(get('memory-receipt-text').textContent, /底层清理待完成/)
  assert.equal(get('memory-receipt-check').hidden, false)
  assert.equal(get('memory-receipt-check').textContent, '重试底层清理')
  get('memory-refresh').fire('click')
  for (let i = 0; i < 20 && cleanupGetCount === 0; i++) await flush()
  assert.ok(cleanupGetCount > 0, 'automatic recovery only queried the original receipt')
  assert.equal(retryPostCount, 0, 'refresh must not POST cleanup')
  for (let i = 0; i < 20 && get('memory-list').children.length !== 1; i++) await flush()
  memoryButton(memoryItem.text).fire('click')
  for (let i = 0; i < 20 && get('memory-correct-action').hidden; i++) await flush()
  assert.equal(get('memory-correct-action').hidden, false, 'confirmed cleanup must not lock new actions')
  assert.equal(get('memory-detail-check').textContent, '重试底层清理')
  cleanupReply = 'forbidden'
  get('memory-detail-check').fire('click')
  for (let i = 0; i < 20 && !get('memory-receipt-text').textContent.includes('无权重试'); i++) await flush()
  assert.equal(retryPostCount, 1)
  assert.equal(retryCoreCount, 0, '403 was rejected before cleanup work')
  cleanupReply = 'network'
  get('memory-detail-check').fire('click')
  for (let i = 0; i < 20 && get('memory-receipt-check').textContent !== '核对处理结果'; i++) await flush()
  assert.equal(retryPostCount, 2)
  assert.equal(retryCoreCount, 0)
  assert.equal(get('memory-receipt-check').textContent, '核对处理结果')
  const getsBeforeRetryRecovery = cleanupGetCount
  get('memory-detail-check').fire('click')
  for (let i = 0; i < 20 && cleanupGetCount === getsBeforeRetryRecovery; i++) await flush()
  assert.ok(cleanupGetCount > getsBeforeRetryRecovery)
  assert.equal(retryPostCount, 2, 'uncertain retry is recovered with GET, not another POST')
  for (let i = 0; i < 20 && get('memory-detail-check').textContent !== '重试底层清理'; i++) await flush()
  cleanupReply = 'pending'
  get('memory-detail-check').fire('click')
  for (let i = 0; i < 20 && (retryCoreCount < 1 || !get('memory-receipt-text').textContent.includes('底层清理待完成')); i++) await flush()
  assert.equal(retryCoreCount, 1)
  assert.match(get('memory-receipt-text').textContent, /底层清理待完成/)
  assert.equal(get('memory-receipt-check').textContent, '重试底层清理')
  cleanupReply = 'complete'
  get('memory-detail-check').fire('click')
  for (let i = 0; i < 20 && (retryCoreCount < 2 || !get('memory-receipt-text').textContent.includes('当前存储清理已完成')); i++) await flush()
  assert.equal(retryCoreCount, 2)
  assert.match(get('memory-receipt-text').textContent, /当前存储清理已完成/)
  assert.equal(get('memory-receipt-check').hidden, true)
  deferNextCorrect = true
  get('memory-correct-action').fire('click')
  get('memory-correct-text').value = '合成延迟更正。'
  get('memory-correct-text').fire('input')
  get('memory-confirm-action').fire('click')
  for (let i = 0; i < 20 && !finishDelayedCorrect; i++) await flush()
  assert.ok(finishDelayedCorrect)
  get('memory-detail-close').fire('click')
  memoryButton(memoryItem.text).fire('click')
  for (let i = 0; i < 20 && !get('memory-detail-status').textContent.includes('详情与来源已读取'); i++) await flush()
  finishDelayedCorrect!()
  for (let i = 0; i < 20 && !get('memory-detail-status').textContent.includes('请关闭后重新打开'); i++) await flush()
  assert.equal(get('memory-detail-dialog').open, true, 'late receipt must not close a newer detail')
  assert.match(get('memory-detail-status').textContent, /请关闭后重新打开/)
  assert.equal(get('memory-correct-action').hidden, true)
  get('memory-detail-close').fire('click')
  for (let i = 0; i < 20 && get('memory-list').children.length !== 1; i++) await flush()
  memoryButton(memoryItem.text).fire('click')
  for (let i = 0; i < 20 && get('memory-correct-action').hidden; i++) await flush()
  rejectNextCorrect = true
  get('memory-correct-action').fire('click')
  get('memory-correct-text').value = '合成首次未受理。'
  get('memory-correct-text').fire('input')
  get('memory-confirm-action').fire('click')
  for (let i = 0; i < 20 && !get('memory-detail-status').textContent.includes('本次未提交'); i++) await flush()
  assert.match(get('memory-detail-status').textContent, /本次未提交/)
  assert.equal(get('memory-confirm-action').disabled, false)
  const rejectedId = correctRequestIds.at(-1)
  get('memory-confirm-action').fire('click')
  for (let i = 0; i < 20 && get('memory-receipt-id').textContent === rejectedId; i++) await flush()
  assert.notEqual(correctRequestIds.at(-1), rejectedId, 'explicit resubmit gets a fresh requestId')
  get('memory-detail-close').fire('click')
  for (let i = 0; i < 20 && get('memory-list').children.length !== 1; i++) await flush()
  memoryButton(memoryItem.text).fire('click')
  for (let i = 0; i < 20 && get('memory-correct-action').hidden; i++) await flush()
  missingNextCorrect = true
  get('memory-correct-action').fire('click')
  get('memory-correct-text').value = '合成目标已不存在。'
  get('memory-correct-text').fire('input')
  get('memory-confirm-action').fire('click')
  for (let i = 0; i < 20 && !get('memory-receipt-text').textContent.includes('记忆已不存在'); i++) await flush()
  assert.match(get('memory-receipt-text').textContent, /本次未提交/)
  assert.equal(get('memory-detail-dialog').open, false)
  assert.equal(get('memory-list').children.length, 0)
  assert.equal([...storage.keys()].some((key) => key.startsWith('weftmate:memory-request:')), false,
    '404 mutation was rejected before dispatch and clears only its execution marker')
  memoryItems = [memoryItem]
  get('memory-refresh').fire('click')
  for (let i = 0; i < 20 && get('memory-list').children.length !== 1; i++) await flush()
  memoryButton(memoryItem.text).fire('click')
  for (let i = 0; i < 20 && get('memory-correct-action').hidden; i++) await flush()
  loseNextCorrect = true
  get('memory-correct-action').fire('click')
  get('memory-correct-text').value = '合成结果待确认更正。'
  get('memory-correct-text').fire('input')
  get('memory-confirm-action').fire('click')
  for (let i = 0; i < 20 && !get('memory-receipt-text').textContent.includes('结果待确认'); i++) await flush()
  assert.equal(get('memory-confirm-action').disabled, true)
  assert.equal(get('memory-detail-check').hidden, false)
  assert.match(get('memory-detail-status').textContent, /本次执行结果待确认/)
  assert.match(get('memory-detail-error').textContent, /请点“核对处理结果”查询原请求/)
  const postsBeforeCheck = requests.filter((url) => url.endsWith('/memory/items/cognition/memory-a-1/correct')).length
  get('memory-confirm-action').fire('click')
  get('memory-detail-check').fire('click')
  for (let i = 0; i < 10; i++) await flush()
  assert.equal(requests.filter((url) => url.endsWith('/memory/items/cognition/memory-a-1/correct')).length, postsBeforeCheck)
  assert.equal(requests.some((url) => url.includes('/memory/commands/by-request/')), true)
  assert.equal(get('memory-confirm-action').disabled, true,
    'GET by-request 404 does not prove a mutation was rejected before dispatch')
  get('memory-back').fire('click')
  for (let i = 0; i < 20 && get('assistant-view').hidden; i++) await flush()
  assert.equal(get('message-text').value, '保留的对话草稿')
  get('rail-memory').fire('click')
  for (let i = 0; i < 20 && get('memory-list').children.length === 0; i++) await flush()
  memoryState = 'degraded'
  get('memory-refresh').fire('click')
  for (let i = 0; i < 20 && !get('memory-status').textContent.includes('未用于模型回复'); i++) await flush()
  assert.match(get('memory-status').textContent, /未用于模型回复/)
  assert.equal(get('memory-list').children.length, 1)
  memoryState = 'ready'
  memoryItems = []
  pendingBoundaryCount = 0
  blockedBoundaryCount = 0
  discardedBoundaryCount = 1
  lastFailureCode = 'MEMORY_SOURCE_DELETED'
  get('memory-refresh').fire('click')
  for (let i = 0; i < 20 && !get('memory-status').textContent.includes('为空'); i++) await flush()
  assert.match(get('memory-status').textContent, /为空/)
  assert.doesNotMatch(get('memory-status').textContent, /待处理|最近处理失败/)
  memoryOwner = 'owner-b'
  get('memory-refresh').fire('click')
  for (let i = 0; i < 20 && get('login-view').hidden; i++) await flush()
  assert.equal(get('login-view').hidden, false)
  assert.equal(get('memory-list').children.length, 0)
  assert.equal(requests.some((url) => url.endsWith('/memory/status')), true)
})
