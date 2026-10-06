import assert from 'node:assert/strict'
import { Blob, File } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { hashBlobSha256 } from '../src/personal-access-ui/file-sha256.js'

const repository = fileURLToPath(new URL('../', import.meta.url))
const source = readFileSync(join(repository, 'src', 'personal-access-ui', 'app.js'), 'utf8')
const executableSource = source.replace("import('./file-sha256.js')",
  'Promise.resolve({ hashBlobSha256: globalThis.__weftmateTestHashBlobSha256 })')
assert.notEqual(executableSource, source, 'the attachment test harness replaces only the browser module loader')
const accountHtml = readFileSync(join(repository, 'src', 'personal-access-ui', 'index.html'), 'utf8')
const styles = readFileSync(join(repository, 'src', 'personal-access-ui', 'styles.css'), 'utf8')
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const qrDataDeclaration = source.match(/const publicPlatformQrData = Object\.freeze\((\{[\s\S]*?\n  \})\)/)
assert.ok(qrDataDeclaration, 'the standard platform QR assets are embedded in app.js')
const publicPlatformQrData = runInNewContext(`(${qrDataDeclaration[1]})`) as Record<string, string>

function officialQrSvg(platform: string) {
  const dataUri = publicPlatformQrData[platform]
  assert.ok(dataUri?.startsWith('data:image/svg+xml;base64,'), `${platform} QR uses an allowed local data URI`)
  const svg = Buffer.from(dataUri.slice('data:image/svg+xml;base64,'.length), 'base64')
  const officialSha = {
    android: 'ed0e258be84b46edb51e9f07956189c07d7ac23986019fe7631f6eaa7543d3cd',
    macos: '8a5d544f1709db4500aea92a825ee86c6504b015df040838b5db8c790d420b7b',
    ios: '7c174fbc316e28934c8ecbc86804f65199f0eb71a976840038d6f61d714c33cb',
    watchos: '490c8d6894403ec3718d3f06f5284de389a9d9912a94cc14a0d46d38f0440fe4',
  }[platform]
  assert.equal(createHash('sha256').update(svg).digest('hex'), officialSha,
    `${platform} QR embeds the exact standard SVG bytes`)
  assert.match(svg.toString('utf8'), new RegExp(`<desc>https://www\\.weftmate\\.com/downloads/\\?platform=${platform}</desc>`))
  return dataUri
}

class Element {
  id: string
  children: Element[] = []
  listeners = new Map<string, Array<(event: any) => unknown>>()
  hidden = false
  disabled = false
  value = ''
  textContent = ''
  type = ''
  className = ''
  style = { right: '', maxHeight: '' }
  dataset: Record<string, string> = {}
  attributes = new Map<string, string>()
  files: any[] = []
  src = ''
  focused = false
  decodeHandler: (() => Promise<void>) | null = null
  classList = { add() {}, remove() {}, toggle() {} }
  constructor(id = '') { this.id = id }
  addEventListener(name: string, listener: (event: any) => unknown) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }
  fire(name: string, extra: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(name) ?? []) listener({ currentTarget: this, target: this, preventDefault() {}, ...extra })
  }
  append(...children: Element[]) { this.children.push(...children) }
  replaceChildren(...children: Element[]) { this.children = children }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  removeAttribute(name: string) { this.attributes.delete(name); if (name === 'src') this.src = '' }
  decode() { return this.decodeHandler ? this.decodeHandler() : Promise.resolve() }
  focus() { this.focused = true }
  getBoundingClientRect() { return { left: 16, right: 366, top: 680, bottom: 724 } }
  querySelectorAll() { return [] }
  close() { this.open = false }
  showModal() { this.open = true }
  reset() { this.value = '' }
  open = false
}

const reply = (body: object, status = 200) => ({ ok: status < 400, status, json: async () => body })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function harness(commands: object[] = [], durableEvents: Array<{ seq: number; type: string; data: object }> = [], aRunning = true,
  config: { markers?: object[]; byRequest?: Record<string, object>; storage?: Map<string, string>;
    sessions?: Array<{ sessionId: string; title: string; sendAvailable: boolean; running?: boolean }>;
    eventPageSize?: number; syncAvailable?: boolean; syncEvents?: object[]; downloadAvailable?: boolean;
    conversationViews?: Record<string, object>;
    modelCatalog?: object[];
    accountModels?: object[]; accountModelWrite?: (url: string, options: any) => object;
    accountModelByRequest?: Record<string, object>;
    syncPost?: 'timeout-no-commit' | 'timeout-committed' | 'conflict'; uuidForSync?: boolean; deviceSuffix?: string;
    configured?: boolean; authenticated?: boolean; setupGrant?: string;
    profileAccounts?: Record<string, any>; initialProfileOwner?: string;
    taskDetails?: Record<string, object>; sourceDetails?: Record<string, object>;
    artifactPreviews?: Record<string, object | { error: { code: string }; status: number }>;
    deferTaskDetail?: boolean; taskPollTimers?: boolean;
    deferOriginalAttachment?: boolean;
    failOriginalAttachmentOnce?: boolean;
  } = {}) {
  const nodes = new Map<string, Element>()
  const get = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id)! }
  const storage = config.storage ?? new Map<string, string>()
  if (config.markers) storage.set('weftmate:requests:v1:owner-test', JSON.stringify(config.markers))
  const requests: Array<{ url: string; options: any }> = []
  const history: Record<string, Array<ReturnType<typeof deferred<ReturnType<typeof reply>>>>> = { A: [], B: [] }
  let deferHistory = false
  let pendingPost: ReturnType<typeof deferred<ReturnType<typeof reply>>> | null = null
  let pendingProfilePatch: ReturnType<typeof deferred<ReturnType<typeof reply>>> | null = null
  let deferredMe: ReturnType<typeof deferred<ReturnType<typeof reply>>> | null = null
  let deferredDevices: ReturnType<typeof deferred<ReturnType<typeof reply>>> | null = null
  let deferNextMe = false
  let deferNextDevices = false
  let deferredTaskDetail: ReturnType<typeof deferred<ReturnType<typeof reply>>> | null = null
  let deferredOriginalAttachment: ReturnType<typeof deferred<ReturnType<typeof reply>>> | null = null
  let deferNextTaskDetail = false
  const taskTimers = new Map<number, () => void>()
  let timerId = 0
  let profileOwner = config.initialProfileOwner ?? 'A'
  const profileAccounts = config.profileAccounts ?? {
    A: { username: 'ProfileA', ownerId: 'profile-owner-a', displayName: '合成账户 A', avatar: null, profileRevision: 0 },
    B: { username: 'ProfileB', ownerId: 'profile-owner-b', displayName: '合成账户 B', avatar: null, profileRevision: 0 },
  }
  const profileDevice = (owner: string) => ({ id: `profile-device-${owner}${config.deviceSuffix ?? ''}`, name: `合成设备 ${owner}`, expiresAt: '2026-10-26T00:00:00.000Z' })
  const objectUrls = { created: [] as string[], revoked: [] as string[] }
  let sequence = 0
  let syncPosts = 0
  let originalAttachmentAttempts = 0
  const synchronized = [...(config.syncEvents ?? [])] as any[]
  let refreshTick = () => {}
  const fetch = (url: string, options: any = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/auth/state')) return Promise.resolve(reply({
      configured: config.configured ?? true, registrationAvailable: true }))
    if (url.endsWith('/auth/me') && config.authenticated === false) return Promise.resolve(reply({ error: { code: 'UNAUTHORIZED' } }, 401))
    if (url.endsWith('/auth/me') && config.profileAccounts) {
      if (deferNextMe) { deferNextMe = false; deferredMe = deferred<ReturnType<typeof reply>>(); return deferredMe.promise }
      return Promise.resolve(reply({ account: { ...profileAccounts[profileOwner] }, device: profileDevice(profileOwner), csrfToken: `csrf-${profileOwner}` }))
    }
    if (url.endsWith('/auth/login') && options.method === 'POST' && config.profileAccounts) {
      const username = JSON.parse(options.body).username
      profileOwner = username === profileAccounts.B.username ? 'B' : 'A'
      return Promise.resolve(reply({ account: { ...profileAccounts[profileOwner] }, device: profileDevice(profileOwner), csrfToken: `csrf-${profileOwner}` }))
    }
    if (url.endsWith('/auth/logout') && options.method === 'POST') return Promise.resolve(reply({ ok: true }))
    if (url.endsWith('/auth/devices') && config.profileAccounts) {
      if (deferNextDevices) { deferNextDevices = false; deferredDevices = deferred<ReturnType<typeof reply>>(); return deferredDevices.promise }
      return Promise.resolve(reply({ devices: [
        { id: `profile-device-${profileOwner}`, name: `合成设备 ${profileOwner}`, createdAt: '2026-09-26T00:00:00.000Z', revoked: false, current: true },
        ...(profileOwner === 'A' ? [{ id: 'profile-old-device-a', name: 'A的旧设备', createdAt: '2026-09-25T00:00:00.000Z', revoked: false, current: false }] : []),
      ] }))
    }
    if (url.endsWith('/auth/change-password') && options.method === 'POST' && config.profileAccounts) {
      return Promise.resolve(reply({ account: { ...profileAccounts[profileOwner] },
        device: profileDevice(profileOwner), csrfToken: `csrf-${profileOwner}-changed` }))
    }
    if (url.endsWith('/auth/profile') && options.method === 'PATCH' && config.profileAccounts) {
      if (pendingProfilePatch) return pendingProfilePatch.promise
      const body = JSON.parse(options.body)
      const account = profileAccounts[profileOwner]
      if (body.expectedRevision !== account.profileRevision) return Promise.resolve(reply({ error: { code: 'REQUEST_CONFLICT' } }, 409))
      Object.assign(account, Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'expectedRevision')))
      account.profileRevision++
      return Promise.resolve(reply({ account: { ...account } }))
    }
    if (url.endsWith('/auth/register') && options.method === 'POST') return Promise.resolve(reply({
      account: { username: 'Friend', ownerId: 'owner-friend' },
      device: { id: 'device-friend', name: 'Browser', expiresAt: '2026-10-26T00:00:00.000Z' },
      csrfToken: 'synthetic-csrf',
    }, 201))
    if (url.endsWith('/auth/setup') && options.method === 'POST') return Promise.resolve(reply({
      account: { username: 'Original', ownerId: 'owner-original' },
      device: { id: 'device-original', name: 'Local PC', expiresAt: '2026-10-26T00:00:00.000Z' },
      csrfToken: 'synthetic-csrf',
    }, 201))
    if (url.endsWith('/auth/me')) return Promise.resolve(reply({ account: { username: 'Synthetic' },
      device: { id: 'device-test', name: 'Browser', expiresAt: '2026-10-26T00:00:00.000Z' }, csrfToken: 'synthetic-csrf' }))
    if (url.endsWith('/auth/devices')) return Promise.resolve(reply({ devices: [
      { id: 'device-phone', name: '合成手机', createdAt: '2026-09-26T00:00:00.000Z', revoked: false },
    ] }))
    if (url.endsWith('/status')) return Promise.resolve(reply({ ownerId: config.profileAccounts ? profileAccounts[profileOwner].ownerId : 'owner-test', hostId: 'host-test',
      ...(config.syncAvailable ? { sync: { available: true } } : {}),
      ...(config.downloadAvailable ? { downloads: { android: true } } : {}),
      backend: { capabilities: { chat: { available: true }, desktopOpenApp: { available: true, appIds: ['notepad'] }, naturalLanguageDesktop: { available: false } } } }))
    if (url.includes('/sync/conversations/') && url.endsWith('/shared') && options.method !== 'POST') {
      const conversationId = decodeURIComponent(url.split('/').at(-2)!)
      return Promise.resolve(config.conversationViews?.[conversationId]
        ? reply(config.conversationViews[conversationId]) : reply({ error: { code: 'NOT_FOUND' } }, 404))
    }
    if (url.endsWith('/sync/events') && options.method === 'POST') {
      syncPosts++
      const event = JSON.parse(options.body).events[0]
      const stored = synchronized.find((row) => row.eventId === event.eventId)
      if (config.syncPost === 'conflict') return Promise.resolve(reply({ error: { code: 'REQUEST_CONFLICT' } }, 409))
      if (!stored && !(config.syncPost === 'timeout-no-commit' && syncPosts === 1)) synchronized.push({
        ...event, seq: synchronized.length + 1, sourceDeviceId: config.profileAccounts
          ? `profile-device-${profileOwner}${config.deviceSuffix ?? ''}` : 'device-test',
      })
      if (config.syncPost?.startsWith('timeout-') && syncPosts === 1) return Promise.reject(new Error('synthetic timeout'))
      const accepted = synchronized.find((row) => row.eventId === event.eventId)
      return Promise.resolve(reply({ accepted: [{ eventId: event.eventId, seq: accepted.seq,
        duplicate: !!stored }], lastSeq: synchronized.length }))
    }
    if (url.includes('/sync/events?')) {
      const afterSeq = Number(new URL(url, 'http://local.test').searchParams.get('afterSeq') ?? '0')
      const remaining = synchronized.filter((row: any) => row.seq > afterSeq)
      const events = remaining.slice(0, 200)
      return Promise.resolve(reply({ events, nextSeq: (events.at(-1) as any)?.seq ?? afterSeq,
        hasMore: remaining.length > events.length }))
    }
    if (url.endsWith('/account/models') && options.method === 'POST') return Promise.resolve(reply(
      config.accountModelWrite?.(url, options) ?? { error: { code: 'NOT_FOUND' } },
      config.accountModelWrite ? 200 : 404))
    if (url.endsWith('/account/models')) return Promise.resolve(reply({ models: config.accountModels ?? [], canManage: true }))
    if (url.includes('/account/models/by-request/')) {
      const requestId = url.split('/').at(-1)!
      return Promise.resolve(config.accountModelByRequest?.[requestId]
        ? reply(config.accountModelByRequest[requestId]) : reply({ error: { code: 'NOT_FOUND' } }, 404))
    }
    if (url.includes('/account/models/') && options.method && options.method !== 'GET')
      return Promise.resolve(reply(config.accountModelWrite?.(url, options) ?? { error: { code: 'NOT_FOUND' } },
        config.accountModelWrite ? 200 : 404))
    if (url.endsWith('/models')) return Promise.resolve(reply({ models: config.modelCatalog ??
      [{ id: 'model-test', name: 'Synthetic', configured: true }] }))
    if (url.endsWith('/sessions')) return Promise.resolve(reply({ sessions: config.sessions ?? [
      { sessionId: 'A', title: 'A', sendAvailable: true, running: aRunning }, { sessionId: 'B', title: 'B', sendAvailable: true },
    ] }))
    if (url.includes('/sessions/') && url.includes('/events?')) {
      const id = url.includes('/sessions/A/') ? 'A' : 'B'
      if (deferHistory) { const wait = deferred<ReturnType<typeof reply>>(); history[id].push(wait); return wait.promise }
      const afterSeq = Number(new URL(url, 'http://local.test').searchParams.get('afterSeq') ?? '-1')
      const remaining = id === 'A' ? durableEvents.filter((entry) => entry.seq > afterSeq) : []
      const events = remaining.slice(0, config.eventPageSize ?? remaining.length)
      return Promise.resolve(reply({ events, nextSeq: events.at(-1)?.seq ?? afterSeq, hasMore: remaining.length > events.length }))
    }
    if (url.includes('/sync/attachments/') && options.method === 'PUT') {
      originalAttachmentAttempts++
      const parsed = new URL(url, 'http://local.test')
      const attachmentId = decodeURIComponent(parsed.pathname.split('/').at(-1)!)
      const body = options.body as Blob
      const response = reply({ attachment: { attachmentId, name: parsed.searchParams.get('name'),
        contentType: options.headers['content-type'], size: body.size, sha256: options.headers['x-weftmate-sha256'] } }, 201)
      if (config.deferOriginalAttachment) {
        deferredOriginalAttachment = deferred<ReturnType<typeof reply>>()
        options.signal?.addEventListener('abort', () => deferredOriginalAttachment?.reject(new DOMException('aborted', 'AbortError')), { once: true })
        return deferredOriginalAttachment.promise
      }
      if (config.failOriginalAttachmentOnce && originalAttachmentAttempts === 1) {
        return Promise.resolve(reply({ error: { code: 'STORAGE_UNAVAILABLE' } }, 503))
      }
      return Promise.resolve(response)
    }
    if (/\/sessions\/[^/]+\/attachments\//.test(url) && options.method === 'PUT') {
      const parsed = new URL(url, 'http://local.test')
      const attachmentId = decodeURIComponent(parsed.pathname.split('/').at(-1)!)
      const body = options.body as Blob
      return Promise.resolve(reply({ attachment: { attachmentId, name: parsed.searchParams.get('name'),
        contentType: options.headers['content-type'], size: body.size, sha256: options.headers['x-weftmate-sha256'] } }, 201))
    }
    if (url.includes('/commands?')) return Promise.resolve(reply({ commands, nextBefore: null, hasMore: false }))
    if (url.includes('/tasks/') && options.method === 'POST') {
      const taskId = url.split('/').at(-2)!
      const task = config.taskDetails?.[taskId]
      return Promise.resolve(task ? reply({ task }, 202) : reply({ error: { code: 'NOT_FOUND' } }, 404))
    }
    if (url.includes('/tasks/') && url.includes('/sources/')) {
      const snapshotId = url.split('/').at(-1)!
      return Promise.resolve(config.sourceDetails?.[snapshotId]
        ? reply({ source: config.sourceDetails[snapshotId] }) : reply({ error: { code: 'NOT_FOUND' } }, 404))
    }
    if (url.includes('/tasks/')) {
      if (config.deferTaskDetail || deferNextTaskDetail) {
        deferNextTaskDetail = false
        deferredTaskDetail = deferred<ReturnType<typeof reply>>()
        return deferredTaskDetail.promise
      }
      const taskId = url.split('/').at(-1)!
      return Promise.resolve(config.taskDetails?.[taskId]
        ? reply(config.taskDetails[taskId]) : reply({ error: { code: 'NOT_FOUND' } }, 404))
    }
    if (url.includes('/artifacts/') && url.endsWith('/preview')) {
      const artifactId = url.split('/').at(-2)!
      const result = config.artifactPreviews?.[artifactId]
      return Promise.resolve(result ? reply(result, 'status' in result ? result.status : 200)
        : reply({ error: { code: 'NOT_FOUND' } }, 404))
    }
    if (url.includes('/commands/by-request/')) {
      const requestId = url.split('/').at(-1)!
      return Promise.resolve(config.byRequest?.[requestId]
        ? reply({ command: config.byRequest[requestId] }) : reply({ error: { code: 'NOT_FOUND' } }, 404))
    }
    if (url.endsWith('/commands') && options.method === 'POST') {
      if (!pendingPost) pendingPost = deferred<ReturnType<typeof reply>>()
      return pendingPost.promise
    }
    throw new Error(`unexpected test URL ${url}`)
  }
  const document = { body: get('body'), visibilityState: 'visible', getElementById: get,
    createElement: () => new Element(), querySelector: () => get('badge'), querySelectorAll: () => [], addEventListener() {} }
  const location = { hash: config.setupGrant ? `#setup=${config.setupGrant}` : '',
    pathname: '/personal/v1/ui', search: '', protocol: 'http:' }
  const window = { location, innerWidth: 1280, innerHeight: 820, history: { replaceState() {} }, addEventListener() {} }
  const URLShim = class extends URL {}
  URLShim.createObjectURL = (_file: object) => { const value = `blob:synthetic-${objectUrls.created.length + 1}`; objectUrls.created.push(value); return value }
  URLShim.revokeObjectURL = (value: string) => { objectUrls.revoked.push(value) }
  const context = { document, window, location, fetch, URL: URLShim, localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) }, removeItem: (key: string) => { storage.delete(key) } },
  TextEncoder, TextDecoder, Blob, File, AbortController, DOMException,
  __weftmateTestHashBlobSha256: hashBlobSha256, crypto: { randomUUID: () => config.uuidForSync
    ? `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}` : `request-${++sequence}` }, AbortSignal, Intl, Date, btoa,
   setTimeout: (callback: () => void, delay: number) => {
     const id = ++timerId
     if (config.taskPollTimers && delay === 2_000) taskTimers.set(id, callback)
     return id
   }, clearTimeout(id: number) { taskTimers.delete(id) }, setInterval: (callback: () => void) => { refreshTick = callback; return 1 }, clearInterval() {} }
  runInNewContext(executableSource, context)
  return { get, requests, storage, history, objectUrls, setDeferHistory: (value: boolean) => { deferHistory = value },
    deferMe: () => { deferNextMe = true }, resolveMe: (value: object, status = 200) => { deferredMe?.resolve(reply(value, status)); deferredMe = null },
    deferDevices: () => { deferNextDevices = true }, resolveDevices: (value: object) => { deferredDevices?.resolve(reply(value)); deferredDevices = null },
    resolveTaskDetail: (value: object, status = 200) => { deferredTaskDetail?.resolve(reply(value, status)); deferredTaskDetail = null },
     deferOneTaskDetail: () => { deferNextTaskDetail = true },
     runTaskTimer: () => { const next = taskTimers.entries().next().value; if (!next) return false; taskTimers.delete(next[0]); next[1](); return true },
     pendingTaskTimers: () => taskTimers.size,
    deferProfilePatch: () => { pendingProfilePatch = deferred<ReturnType<typeof reply>>() },
    resolveProfilePatch: (value: object, status = 200) => { pendingProfilePatch?.resolve(reply(value, status)); pendingProfilePatch = null },
    resolveOriginalAttachment: (value: object, status = 201) => {
      deferredOriginalAttachment?.resolve(reply(value, status)); deferredOriginalAttachment = null
    },
    profileAccounts,
    tick: () => refreshTick(),
    resolvePost: (value: object) => { pendingPost?.resolve(reply(value)); pendingPost = null },
    rejectPost: () => { pendingPost?.reject(new Error('synthetic disconnect')); pendingPost = null } }
}

function visibleText(node: Element): string {
  return [node.textContent, ...node.children.map(visibleText)].join(' ')
}

test('model menu preserves the draft, selects a configured model and opens existing account settings', async () => {
  const page = harness([], [], false, { modelCatalog: [
    { id: 'local-model', name: '本地模型', configured: true },
    { id: 'cloud-model', name: '云端模型', configured: true },
    { id: 'unconfigured', name: '未配置模型', configured: false },
  ] })
  for (let attempt = 0; attempt < 20 && page.get('model-label').textContent !== '本地模型'; attempt++) await flush()
  page.get('message-text').value = '继续我的目标'
  page.get('model-trigger').fire('click')
  const choices = page.get('model-options').children
  assert.equal(choices.length, 2)
  assert.equal(choices[0].getAttribute('aria-selected'), 'true')
  assert.equal(choices[0].focused, true)
  choices[1].fire('click')
  assert.equal(page.get('model-select').value, 'cloud-model')
  assert.equal(page.get('model-label').textContent, '云端模型')
  assert.equal(page.get('model-popover').hidden, true)
  assert.equal(page.get('model-trigger').getAttribute('aria-expanded'), 'false')
  assert.equal(page.get('message-text').value, '继续我的目标')
  assert.equal(page.requests.filter(({ options }) => options.method === 'POST').length, 0)
  page.get('model-trigger').fire('click')
  assert.equal(page.get('model-options').children[1].getAttribute('aria-selected'), 'true')
  page.get('model-configure').fire('click')
  await flush()
  assert.equal(page.get('account-view').hidden, false)
  assert.equal(page.get('model-popover').hidden, true)
})

test('desktop file composer streams a file over 2 MiB, retries the same tuple, and stages only bounded UTF-8', async () => {
  class StreamingOnlyFile extends File {
    arrayBuffer(): Promise<ArrayBuffer> { throw new Error('whole-file arrayBuffer must not be used') }
  }
  const prefix = Buffer.from('row,value\n终端标记,WINDOWS_ATTACHMENT_OK\n', 'utf8')
  const bytes = Buffer.concat([prefix, Buffer.alloc(2 * 1024 * 1024 + 8192 - prefix.length, 0x61)])
  const file = new StreamingOnlyFile([bytes], 'stage15-windows-large.csv',
    { type: 'text/csv', lastModified: 1_780_000_000_000 })
  const expectedSha = createHash('sha256').update(bytes).digest('hex')
  const page = harness([], [], false, { failOriginalAttachmentOnce: true })
  for (let attempt = 0; attempt < 20 && page.get('assistant-view').hidden; attempt++) await flush()
  assert.equal(page.get('assistant-title').textContent, 'A')
  page.get('message-attachments').files = [file]
  page.get('message-attachments').fire('change')
  assert.equal(page.get('attachment-draft-list').children.length, 1)
  page.get('message-text').value = '请读取标记并保留原件。'
  page.get('message-text').fire('input')
  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 100 && !page.get('attachment-status').textContent.includes('可重试'); attempt++) await flush()
  assert.match(page.get('attachment-status').textContent, /仍保留，可重试/)
  assert.equal(page.requests.filter((request) => request.url.includes('/sync/attachments/') && request.options.method === 'PUT').length, 1,
    page.get('attachment-status').textContent)
  assert.equal(page.requests.some((request) => request.url.endsWith('/commands') && request.options.method === 'POST'), false)

  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 100 && !page.requests.some((request) => request.url.endsWith('/commands') && request.options.method === 'POST'); attempt++) await flush()
  const originals = page.requests.filter((request) => request.url.includes('/sync/attachments/') && request.options.method === 'PUT')
  assert.equal(originals.length, 2)
  assert.equal(originals[0].url, originals[1].url, 'retry keeps the exact owner/session/message/attachment tuple')
  assert.equal(originals[1].options.body, file, 'the original File is passed directly to fetch')
  assert.equal(originals[1].options.headers['x-weftmate-sha256'], expectedSha)
  const staged = page.requests.filter((request) => /\/sessions\/A\/attachments\//.test(request.url) && request.options.method === 'PUT')
  assert.equal(staged.length, 1)
  assert.ok(staged[0].options.body instanceof Blob)
  assert.ok(staged[0].options.body.size <= 16 * 1024)
  assert.equal(Buffer.from(await staged[0].options.body.arrayBuffer()).includes(Buffer.from('WINDOWS_ATTACHMENT_OK')), true)
  const commandRequest = page.requests.find((request) => request.url.endsWith('/commands') && request.options.method === 'POST')!
  const command = JSON.parse(commandRequest.options.body)
  const originalUrl = new URL(originals[1].url, 'http://local.test')
  const stagedUrl = new URL(staged[0].url, 'http://local.test')
  assert.equal(command.requestId, stagedUrl.searchParams.get('requestId'))
  assert.equal(command.attachmentMessageId, originalUrl.searchParams.get('messageId'))
  assert.equal(command.originalAttachments[0].size, file.size)
  assert.equal(command.originalAttachments[0].sha256, expectedSha)
  assert.ok(command.attachments[0].size <= 16 * 1024)
  page.resolvePost({ command: { ...command, commandId: 'cmd-file-stage15', state: 'pending' } })
  for (let attempt = 0; attempt < 20 && page.get('attachment-draft-list').children.length; attempt++) await flush()
  assert.equal(page.get('attachment-draft-list').children.length, 0)
  assert.equal(page.get('message-text').value, '')
})

test('switching sessions aborts a late original upload and keeps the file only in its original draft', async () => {
  const page = harness([], [], false, { deferOriginalAttachment: true })
  for (let attempt = 0; attempt < 20 && page.get('assistant-view').hidden; attempt++) await flush()
  const file = new File(['scope check'], 'scope.txt', { type: 'text/plain', lastModified: 7 })
  page.get('message-attachments').files = [file]
  page.get('message-attachments').fire('change')
  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 40 && !page.requests.some((request) => request.url.includes('/sync/attachments/')); attempt++) await flush()
  const sessionButtons = page.get('session-list').children.map((item) => item.children[0])
  sessionButtons[1].fire('click')
  for (let attempt = 0; attempt < 20 && page.get('assistant-title').textContent !== 'B'; attempt++) await flush()
  assert.equal(page.get('attachment-draft-list').children.length, 0)
  assert.equal(page.requests.some((request) => request.url.endsWith('/commands') && request.options.method === 'POST'), false)
  sessionButtons[0].fire('click')
  for (let attempt = 0; attempt < 20 && page.get('assistant-title').textContent !== 'A'; attempt++) await flush()
  assert.equal(page.get('attachment-draft-list').children.length, 1)
  assert.equal(page.get('send-message').disabled, false)
})

test('public browser can register a separate account without a local setup grant', async () => {
  const page = harness([], [], false, { configured: true, authenticated: false })
  for (let attempt = 0; attempt < 10 && page.get('login-view').hidden; attempt++) await flush()
  assert.equal(page.get('login-view').hidden, false)
  page.get('login-to-register').fire('click')
  assert.equal(page.get('setup-view').hidden, false)
  assert.match(page.get('setup-intro').textContent, /分别保存/)
  page.get('setup-name').value = 'Friend'
  page.get('setup-device').value = 'Friend browser'
  page.get('setup-password').value = 'synthetic friendship password 123'
  page.get('setup-confirm').value = 'synthetic friendship password 123'
  page.get('setup-form').fire('submit')
  for (let attempt = 0; attempt < 10 && !page.requests.some((request) => request.url.endsWith('/auth/register')); attempt++) await flush()
  const registration = page.requests.find((request) => request.url.endsWith('/auth/register'))!
  assert.equal(registration.options.method, 'POST')
  const sent = JSON.parse(registration.options.body)
  assert.deepEqual(Object.keys(sent).sort(), ['deviceName', 'password', 'username'])
  assert.equal(sent.username, 'Friend')
  for (let attempt = 0; attempt < 10 && page.get('assistant-view').hidden; attempt++) await flush()
  assert.equal(page.get('assistant-view').hidden, false)
  assert.equal(page.get('setup-password').value, '')
})

test('local owner setup link still claims its original data when another account cookie exists', async () => {
  const grant = 'A'.repeat(48)
  const page = harness([], [], false, { configured: true, authenticated: true, setupGrant: grant })
  for (let attempt = 0; attempt < 10 && page.get('setup-view').hidden; attempt++) await flush()
  assert.equal(page.get('setup-view').hidden, false)
  assert.equal(page.requests.filter((request) => request.url.endsWith('/auth/me')).length, 0)
  assert.match(page.get('setup-intro').textContent, /旧会话与资料仍归原账户/)
  page.get('setup-name').value = 'Original'
  page.get('setup-device').value = 'Local PC'
  page.get('setup-password').value = 'synthetic original password 123'
  page.get('setup-confirm').value = 'synthetic original password 123'
  page.get('setup-form').fire('submit')
  for (let attempt = 0; attempt < 10 && !page.requests.some((request) => request.url.endsWith('/auth/setup')); attempt++) await flush()
  const sent = JSON.parse(page.requests.find((request) => request.url.endsWith('/auth/setup'))!.options.body)
  assert.equal(sent.grant, grant)
  assert.equal(page.requests.some((request) => request.url.endsWith('/auth/register')), false)
})

test('a double click during an unresolved POST issues only one desktop command and stores IDs only', async () => {
  const page = harness()
  for (let attempt = 0; attempt < 10 && page.get('assistant-view').hidden; attempt++) await flush()
  assert.equal(page.get('open-notepad').disabled, false)
  page.get('open-notepad').fire('click')
  page.get('open-notepad').fire('click')
  await flush()
  const posts = page.requests.filter((request) => request.url.endsWith('/commands') && request.options.method === 'POST')
  assert.equal(posts.length, 1)
  assert.equal(page.get('open-notepad').disabled, true)
  assert.equal(page.get('cancel-turn').disabled, false, 'a running turn can still be stopped while another POST waits')
  const stored = [...page.storage.values()].join('\n')
  assert.match(stored, /request-1/)
  assert.doesNotMatch(stored, /notepad|synthetic-csrf|password|text/)
  page.resolvePost({ command: { commandId: 'cmd-test', requestId: 'request-1', kind: 'desktop.open_app', state: 'pending' } })
  await flush()
})

test('lost POST receipt queries the original request ID and never sends a second action automatically', async () => {
  const page = harness()
  for (let attempt = 0; attempt < 10 && page.get('assistant-view').hidden; attempt++) await flush()
  page.get('open-notepad').fire('click')
  await flush()
  page.rejectPost()
  for (let attempt = 0; attempt < 10 && !page.requests.some((request) => request.url.includes('/commands/by-request/')); attempt++) await flush()
  assert.equal(page.requests.filter((request) => request.url.endsWith('/commands') && request.options.method === 'POST').length, 1)
  assert.equal(page.requests.filter((request) => request.url.includes('/commands/by-request/')).length, 1)
  assert.match(page.get('operation-status').textContent, /不会自动再次发送|不会自动重复发送/)
  assert.equal(page.get('open-notepad').disabled, true)
  page.get('open-notepad').fire('click')
  assert.equal(page.requests.filter((request) => request.url.endsWith('/commands') && request.options.method === 'POST').length, 1)
})

test('an older accepted receipt cannot unlock a later missing receipt, and acknowledgement survives polling', async () => {
  const page = harness([], [], true, {
    markers: [
      { requestId: 'missing-message', kind: 'session.message', sessionId: 'A' },
      // An earlier accepted request can be last in storage after a prior receipt refresh.
      { requestId: 'accepted-message', kind: 'session.message', sessionId: 'A' },
    ],
    byRequest: {
      'accepted-message': { commandId: 'cmd-accepted', requestId: 'accepted-message', kind: 'session.message',
        sessionId: 'A', state: 'accepted_by_dsh' },
    },
  })
  for (let attempt = 0; attempt < 10 && !page.requests.some((request) => request.url.endsWith('/commands/by-request/accepted-message')); attempt++) await flush()
  await flush()
  assert.equal(page.get('open-notepad').disabled, true)
  assert.match(page.get('operation-status').textContent, /待核对|不会自动重复发送/)
  assert.deepEqual(JSON.parse(page.storage.get('weftmate:requests:v1:owner-test')!),
    [{ requestId: 'missing-message', kind: 'session.message', sessionId: 'A' }])
  page.tick()
  for (let attempt = 0; attempt < 10 && page.requests.filter((request) => request.url.includes('/commands/by-request/missing-message')).length < 2; attempt++) await flush()
  assert.equal(page.get('open-notepad').disabled, true)
  assert.equal(page.requests.filter((request) => request.url.endsWith('/commands') && request.options.method === 'POST').length, 0)
  page.get('reset-operation').fire('click')
  assert.equal(page.get('open-notepad').disabled, false)
  assert.deepEqual(JSON.parse(page.storage.get('weftmate:requests:v1:owner-test')!), [])
  const lookupsBefore = page.requests.filter((request) => request.url.includes('/commands/by-request/')).length
  page.tick()
  await flush()
  assert.equal(page.get('open-notepad').disabled, false)
  assert.equal(page.requests.filter((request) => request.url.includes('/commands/by-request/')).length, lookupsBefore)
})

test('a durable pending desktop action stays locked across reload; unconfirmed action needs explicit review', async () => {
  const command = { commandId: 'cmd-desktop', requestId: 'request-desktop', kind: 'desktop.open_app',
    appId: 'notepad', state: 'pending', createdAt: '2026-09-26T00:00:00.000Z' }
  const tasks = [command]
  const first = harness(tasks)
  for (let attempt = 0; attempt < 10 && first.get('task-list').children.length === 0; attempt++) await flush()
  assert.equal(first.get('open-notepad').textContent, '查看原事情')
  first.get('open-notepad').fire('click')
  await flush()
  assert.equal(first.get('tasks-pane').hidden, false)
  assert.equal(first.requests.filter((request) => request.url.endsWith('/commands') && request.options.method === 'POST').length, 0)
  assert.doesNotMatch(visibleText(first.get('task-list')), /允许再次发起/, 'pending work cannot be acknowledged early')

  command.state = 'accepted_by_host'
  first.tick()
  for (let attempt = 0; attempt < 10 && !visibleText(first.get('task-list')).includes('允许再次发起'); attempt++) await flush()
  assert.equal(first.get('open-notepad').textContent, '查看原事情')
  const acknowledge = first.get('task-list').children[0].children.find((item) => item.textContent.includes('允许再次发起'))!
  acknowledge.fire('click')
  assert.equal(first.get('open-notepad').textContent, '打开记事本')
  assert.equal(first.get('open-notepad').disabled, false)
  assert.match(first.storage.get('weftmate:desktop-ack:v1:owner-test')!, /cmd-desktop/)

  const restored = harness(tasks, [], true, { storage: first.storage })
  for (let attempt = 0; attempt < 10 && restored.get('task-list').children.length === 0; attempt++) await flush()
  assert.equal(restored.get('open-notepad').textContent, '打开记事本', 'explicit review survives refresh')
  assert.equal(restored.get('open-notepad').disabled, false)
})

test('a pending desktop receipt outside the first task page remains locked by its saved ID', async () => {
  const first = harness()
  for (let attempt = 0; attempt < 10 && first.get('assistant-view').hidden; attempt++) await flush()
  first.get('open-notepad').fire('click')
  await flush()
  const command = { commandId: 'cmd-hidden', requestId: 'request-1', kind: 'desktop.open_app',
    appId: 'notepad', state: 'pending' }
  first.resolvePost({ command })
  for (let attempt = 0; attempt < 10 && first.get('open-notepad').textContent !== '查看原事情'; attempt++) await flush()
  assert.equal(first.get('open-notepad').textContent, '查看原事情')
  assert.match(first.storage.get('weftmate:requests:v1:owner-test')!, /cmd-hidden/)

  const restored = harness([], [], true, { storage: first.storage, byRequest: { 'request-1': command } })
  for (let attempt = 0; attempt < 10 && !restored.requests.some((request) => request.url.endsWith('/commands/by-request/request-1')); attempt++) await flush()
  assert.equal(restored.get('open-notepad').textContent, '查看原事情')
  restored.get('open-notepad').fire('click')
  await flush()
  assert.equal(restored.requests.filter((request) => request.url.endsWith('/commands') && request.options.method === 'POST').length, 0)
})

test('a delayed create keeps the old conversation until acceptance and then selects the new session', async () => {
  const sessions = [{ sessionId: 'A', title: 'A', sendAvailable: true }, { sessionId: 'B', title: 'B', sendAvailable: true }]
  const command = { commandId: 'cmd-create', requestId: 'request-1', kind: 'session.create',
    sessionId: 'C', state: 'pending' }
  const tasks: object[] = []
  const page = harness(tasks, [], true, { sessions, byRequest: { 'request-1': command } })
  for (let attempt = 0; attempt < 10 && page.get('assistant-title').textContent !== 'A'; attempt++) await flush()
  page.get('new-session').fire('click')
  await flush()
  page.resolvePost({ command })
  tasks.push(command)
  for (let attempt = 0; attempt < 10 && !page.storage.get('weftmate:requests:v1:owner-test')?.includes('cmd-create'); attempt++) await flush()
  assert.equal(page.get('assistant-title').textContent, 'A')
  assert.equal(page.get('new-session').disabled, true, 'pending create cannot be repeated with a new ID')
  assert.equal(page.get('reset-operation').hidden, true, 'pending work cannot be acknowledged as uncertain')
  assert.match(page.storage.get('weftmate:requests:v1:owner-test')!, /cmd-create/)

  command.state = 'accepted_by_dsh'
  sessions.push({ sessionId: 'C', title: 'C', sendAvailable: true })
  page.tick()
  for (let attempt = 0; attempt < 15 && page.get('assistant-title').textContent !== 'C'; attempt++) await flush()
  assert.equal(page.get('assistant-title').textContent, 'C')
  assert.equal(page.storage.get('weftmate:last-session:v1:owner-test'), 'C')
  assert.deepEqual(JSON.parse(page.storage.get('weftmate:requests:v1:owner-test')!), [])
  assert.equal(page.requests.filter((request) => request.url.endsWith('/commands') && request.options.method === 'POST').length, 1)
})

test('a delayed create failure updates its real receipt without clearing the selected conversation', async () => {
  for (const finalState of ['uncertain', 'rejected']) {
    const sessions = [{ sessionId: 'A', title: 'A', sendAvailable: true }]
    const command = { commandId: 'cmd-create', requestId: 'request-1', kind: 'session.create',
      sessionId: 'C', state: 'pending' }
    const tasks: object[] = []
    const page = harness(tasks, [], true, { sessions, byRequest: { 'request-1': command } })
    for (let attempt = 0; attempt < 10 && page.get('assistant-title').textContent !== 'A'; attempt++) await flush()
    page.get('new-session').fire('click')
    await flush()
    page.resolvePost({ command })
    tasks.push(command)
    for (let attempt = 0; attempt < 10 && !page.storage.get('weftmate:requests:v1:owner-test')?.includes('cmd-create'); attempt++) await flush()
    command.state = finalState
    page.tick()
    const expected = finalState === 'uncertain' ? '结果待确认' : '请求未执行'
    for (let attempt = 0; attempt < 15 && !page.get('operation-status').textContent.includes(expected); attempt++) await flush()
    assert.match(page.get('operation-status').textContent, new RegExp(expected))
    assert.equal(page.get('assistant-title').textContent, 'A')
    assert.equal(page.storage.get('weftmate:last-session:v1:owner-test'), 'A')
    assert.equal(page.get('reset-operation').hidden, finalState !== 'uncertain')
    assert.equal(JSON.parse(page.storage.get('weftmate:requests:v1:owner-test')!).length,
      finalState === 'uncertain' ? 1 : 0)
  }
})

test('A to B to A discards old history responses even when the session ID matches again', async () => {
  const page = harness()
  for (let attempt = 0; attempt < 10 && page.get('session-list').children.length === 0; attempt++) await flush()
  assert.equal(page.get('session-list').children.length, 2)
  page.setDeferHistory(true)
  const [a, b] = page.get('session-list').children.map((item) => item.children[0])
  a.fire('click') // A1
  b.fire('click') // B1
  a.fire('click') // A2
  assert.equal(page.history.A.length, 2)
  assert.equal(page.history.B.length, 1)
  page.history.A[1].resolve(reply({ events: [{ seq: 9, type: 'assistant.message', data: { text: 'fresh A' } }], nextSeq: 9, hasMore: false }))
  await flush()
  page.history.B[0].resolve(reply({ events: [{ seq: 8, type: 'assistant.message', data: { text: 'stale B' } }], nextSeq: 8, hasMore: false }))
  page.history.A[0].resolve(reply({ events: [{ seq: 7, type: 'assistant.message', data: { text: 'stale A' } }], nextSeq: 7, hasMore: false }))
  await flush()
  const transcript = page.get('transcript').children.map((row) => row.children.map((child) => child.textContent).join(' ')).join(' ')
  assert.match(transcript, /fresh A/)
  assert.doesNotMatch(transcript, /stale A|stale B/)
})

test('desktop task wording requires visible-window verification before claiming success', async () => {
  const page = harness([
    { commandId: 'cmd-pending', requestId: 'request-pending', kind: 'desktop.open_app', state: 'accepted_by_host',
      verification: { status: 'unconfirmed', method: 'visible_window' } },
    { commandId: 'cmd-done', requestId: 'request-done', kind: 'desktop.open_app', state: 'observed',
      verification: { status: 'observed', method: 'visible_window', outcome: 'opened', observedAt: '2026-09-26T00:00:00.000Z' } },
    { commandId: 'cmd-uncertain', requestId: 'request-uncertain', kind: 'desktop.open_app', state: 'uncertain' },
  ])
  for (let attempt = 0; attempt < 10 && page.get('task-list').children.length < 3; attempt++) await flush()
  const [pending, done, uncertain] = page.get('task-list').children.map(visibleText)
  assert.match(pending, /窗口尚未核验/)
  assert.doesNotMatch(pending, /已打开并核验/)
  assert.match(done, /记事本窗口已打开并核验/)
  assert.match(uncertain, /不会自动重复执行/)
})

test('accepted DSH receipts show delivery or creation without claiming work is still running', async () => {
  const page = harness([
    { commandId: 'cmd-create', requestId: 'request-create', kind: 'session.create', state: 'accepted_by_dsh', sessionId: 'A' },
    { commandId: 'cmd-message', requestId: 'request-message', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A' },
    { commandId: 'cmd-cancel', requestId: 'request-cancel', kind: 'session.cancel', state: 'accepted_by_dsh', sessionId: 'A' },
    { commandId: 'cmd-desktop', requestId: 'request-desktop', kind: 'desktop.open_app', appId: 'notepad', state: 'accepted_by_host' },
  ])
  for (let attempt = 0; attempt < 10 && page.get('task-list').children.length < 4; attempt++) await flush()
  const [created, delivered, stopped, desktop] = page.get('task-list').children.map(visibleText)
  assert.match(created, /已创建.*新对话已创建/)
  assert.match(delivered, /已送达.*消息已送达，回复见原会话/)
  assert.match(stopped, /已受理.*停止请求已受理，实际状态见会话/)
  assert.doesNotMatch([created, delivered, stopped].join(' '), /进行中|等待会话中的实际结果/)
  assert.match(desktop, /进行中.*窗口尚未核验/)
})

test('file task groups source and verified child, shows the original goal and checked preview', async () => {
  const source = { commandId: 'cmd-source', requestId: 'source-request', kind: 'session.message',
    state: 'accepted_by_dsh', sessionId: 'A' }
  const artifact = { commandId: 'cmd-file', requestId: 'file-request', kind: 'desktop.write_artifact',
    taskId: 'cmd-source', artifactId: 'artifact-one', fileName: '周计划.md', size: 22, sessionId: 'A',
    state: 'observed', verification: { status: 'observed', method: 'sha256_readback' } }
  const page = harness([artifact, source], [], true, {
    taskDetails: { 'cmd-source': { taskId: 'cmd-source', sessionId: 'A', source, sourceText: '请在电脑生成周计划', artifacts: [artifact],
      replyEvidence: { status: 'streaming', turn: 1, assistantChunks: 7, textChunks: 5,
        reasoningChunks: 2, assistantMessages: 0, toolSaveObserved: true } } },
    artifactPreviews: { 'artifact-one': { artifact, text: '# 周计划\n已完成。' } },
  })
  for (let attempt = 0; attempt < 15 && page.get('task-list').children.length !== 1; attempt++) await flush()
  assert.equal(page.get('task-list').children.length, 1)
  assert.match(visibleText(page.get('task-list')), /周计划\.md.*文件已核验/)
  assert.doesNotMatch(visibleText(page.get('task-list')), /仅已送达.*已核验/)
  const details = page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!
  details.fire('click')
  for (let attempt = 0; attempt < 15 && page.get('task-preview-text').hidden; attempt++) await flush()
  assert.equal(page.get('task-detail-source').textContent, '请在电脑生成周计划')
  assert.match(page.get('task-detail-verification').textContent, /读回核验/)
  assert.match(page.get('task-detail-reply').textContent, /正在生成.*尚未见到结束记录/)
  assert.equal(page.get('task-preview-text').textContent, '# 周计划\n已完成。')
  assert.match(visibleText(page.get('task-preview-status')), /下载文件/)
})

test('desktop groups only read browser segments and keeps reply state separate from file status', async () => {
  const parentId = `source-${'a'.repeat(48)}`, segmentId = `source-${'b'.repeat(48)}`
  const versionHash = 'c'.repeat(64), text = '后续段的实际正文'
  const common = { kind: 'webpage', title: '长页面', url: 'https://public.example/long',
    requestedUrl: 'https://public.example/long', readAt: '2026-10-04T00:00:00Z',
    truncated: true, links: [], versionHash, segmentCount: 4, totalCapturedBytes: 22_000,
    captureTruncated: false }
  const parent = { ...common, snapshotId: parentId, segmentIndex: 0, byteStart: 0,
    byteEnd: 10, contentSha256: sha('开头已读正文'), cited: false }
  const segment = { ...common, snapshotId: segmentId, parentSnapshotId: parentId,
    segmentIndex: 2, byteStart: 16_384, byteEnd: 16_384 + Buffer.byteLength(text),
    contentSha256: sha(text), cited: true }
  const source = { commandId: 'cmd-source', requestId: 'browser-request', kind: 'session.message',
    state: 'accepted_by_dsh', sessionId: 'A' }
  const page = harness([source], [], true, { taskDetails: { 'cmd-source': {
    taskId: 'cmd-source', sessionId: 'A', source, artifacts: [], sources: [parent, segment],
    workspace: { kind: 'browser' }, replyEvidence: { status: 'unconfirmed', turn: null,
      assistantChunks: 0, textChunks: 0, reasoningChunks: 0,
      assistantMessages: 0, toolSaveObserved: false } } },
  sourceDetails: { [segmentId]: { ...segment, text } } })
  for (let attempt = 0; attempt < 15 && page.get('task-list').children.length === 0; attempt++) await flush()
  page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!.fire('click')
  for (let attempt = 0; attempt < 20 && !visibleText(page.get('task-detail-sources')).includes('已读 2/4 段'); attempt++) await flush()
  assert.match(visibleText(page.get('task-detail-sources')), /已读 2\/4 段.*第 1\/4 段.*第 3\/4 段/s)
  assert.match(page.get('task-detail-reply').textContent, /是否结束尚无法核对/)
  const rows = page.get('task-detail-sources').children
  rows.at(-1)!.children.find((item) => item.textContent === '查看读取正文')!.fire('click')
  for (let attempt = 0; attempt < 20 && !page.get('task-source-preview').textContent.includes(text); attempt++) await flush()
  assert.equal(page.get('task-source-preview').textContent, text,
    `status=${page.get('task-source-preview-status').textContent}; requests=${page.requests.filter((item) => item.url.includes('/sources/')).map((item) => item.url).join(',')}`)
})

test('file task detail handles missing task and tampered file without claiming completion', async () => {
  const artifact = { commandId: 'cmd-file', requestId: 'file-request', kind: 'desktop.write_artifact',
    taskId: 'cmd-source', artifactId: 'artifact-one', fileName: '说明.txt', size: 4, sessionId: 'A',
    state: 'observed', verification: { status: 'observed', method: 'sha256_readback' } }
  const page = harness([artifact], [], true, { taskDetails: {
    'cmd-source': { taskId: 'cmd-source', sessionId: 'A', source: { state: 'accepted_by_dsh' }, artifacts: [artifact] },
  }, artifactPreviews: { 'artifact-one': { status: 409, error: { code: 'ARTIFACT_UNVERIFIED' } } } })
  for (let attempt = 0; attempt < 15 && page.get('task-list').children.length === 0; attempt++) await flush()
  page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!.fire('click')
  for (let attempt = 0; attempt < 15 && !/校验失败/.test(page.get('task-preview-status').textContent); attempt++) await flush()
  assert.match(page.get('task-detail-source').textContent, /回到会话查看/)
  assert.match(page.get('task-preview-status').textContent, /校验失败/)
  assert.equal(page.get('task-preview-text').hidden, true)
  assert.doesNotMatch(visibleText(page.get('task-preview-status')), /下载文件/)
})

test('task controls follow server affordances and send a scoped stop intent', async () => {
  const source = { commandId: 'cmd-source', requestId: 'request-source', kind: 'session.message',
    state: 'accepted_by_dsh', sessionId: 'A' }
  const detail = { taskId: 'cmd-source', sessionId: 'A', source, sourceText: '生成文件', artifacts: [],
    control: { state: 'active', canSupplement: true, canStop: true, canResume: false } }
  const page = harness([source], [], true, { taskDetails: { 'cmd-source': detail } })
  for (let attempt = 0; attempt < 15 && page.get('task-list').children.length === 0; attempt++) await flush()
  const details = page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!
  details.fire('click')
  for (let attempt = 0; attempt < 15 && page.get('task-detail-control').children.length === 0; attempt++) await flush()
  const control = page.get('task-detail-control').children[0]
  assert.match(visibleText(control), /任务可继续处理/)
  assert.doesNotMatch(visibleText(control), /恢复这件事/)
  const stop = control.children.find((item) => item.textContent === '请求停止这件事')!
  stop.fire('click')
  for (let attempt = 0; attempt < 15 && !page.requests.some((item) => item.url.endsWith('/tasks/cmd-source/stop')); attempt++) await flush()
  const request = page.requests.find((item) => item.url.endsWith('/tasks/cmd-source/stop'))!
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.headers['X-WeftMate-CSRF'], 'synthetic-csrf')
  assert.ok(JSON.parse(request.options.body).requestId)
  assert.doesNotMatch(visibleText(control), /执行端停止已核对/)
})

test('generic tool records show execution state without claiming goal verification', async () => {
  const source = { commandId: 'cmd-generic', requestId: 'request-generic', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A' }
  const execution = { executionId: 'execution-one', sourceCommandId: source.commandId, sourceReceiptId: 'receipt-one',
    toolName: 'pwsh', state: 'completed', startedAt: '2026-10-06T06:00:00Z', finishedAt: '2026-10-06T06:00:01Z' }
  const page = harness([source], [], false, { taskDetails: { 'cmd-generic': {
    taskId: source.commandId, sessionId: 'A', source, sourceText: '处理我的目标', artifacts: [],
    replyEvidence: { status: 'completed', assistantMessages: 1 },
    executionSteps: [execution, { ...execution, executionId: 'execution-two', jobId: 'job-one', jobState: 'running' },
      { ...execution, executionId: 'invalid-step', toolName: '错误步骤', state: 'verified' }],
  } } })
  for (let attempt = 0; attempt < 20 && !page.get('task-list').children.length; attempt++) await flush()
  page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!.fire('click')
  for (let attempt = 0; attempt < 20 && !visibleText(page.get('task-detail-control')).includes('执行结束'); attempt++) await flush()
  assert.match(visibleText(page.get('task-detail-control')), /执行记录.*运行命令 · 执行结束/)
  assert.match(visibleText(page.get('task-detail-control')), /运行命令 · 后台运行中/)
  assert.doesNotMatch(visibleText(page.get('task-detail-control')), /已核验|错误步骤/)
  assert.equal(page.get('task-detail-verification').textContent, '')
})

test('supplement and resume commands remain under the root file task card', async () => {
  const source = { commandId: 'root-task', requestId: 'root-request', kind: 'session.message',
    state: 'accepted_by_dsh', sessionId: 'A' }
  const file = { commandId: 'file-command', requestId: 'file-request', kind: 'desktop.write_artifact',
    taskId: 'root-task', artifactId: 'artifact-one', fileName: '结果.md', state: 'observed',
    verification: { status: 'observed', method: 'sha256_readback' } }
  const supplement = { commandId: 'follow-one', requestId: 'follow-request', kind: 'session.message',
    rootTaskId: 'root-task', taskAction: 'supplement', state: 'accepted_by_dsh', sessionId: 'A' }
  const resume = { commandId: 'follow-two', requestId: 'resume-request', kind: 'session.message',
    rootTaskId: 'root-task', taskAction: 'resume', state: 'accepted_by_dsh', sessionId: 'A' }
  const page = harness([resume, supplement, file, source], [], true, { taskDetails: {
    'root-task': { taskId: 'root-task', sessionId: 'A', source, artifacts: [file],
      supplements: [supplement], resumes: [resume], control: { state: 'active',
        canSupplement: true, canStop: true, canResume: false } },
  } })
  for (let attempt = 0; attempt < 15 && page.get('task-list').children.length !== 1; attempt++) await flush()
  assert.equal(page.get('task-list').children.length, 1)
  assert.match(visibleText(page.get('task-list')), /结果\.md.*后续要求 2 条/)
  const details = page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!
  details.fire('click')
  for (let attempt = 0; attempt < 15 && page.get('task-detail-control').children.length < 2; attempt++) await flush()
  assert.equal(page.requests.some((item) => item.url.endsWith('/tasks/follow-two')), false)
  const followSection = page.get('task-detail-control').children[1]
  const rows = followSection.children.filter((item) => item.className === 'task-followup')
  assert.equal(rows.length, 2)
  assert.doesNotMatch(rows.map((item) => item.children[0].textContent).join(' '), /follow-one|follow-two/)
  assert.match(visibleText(followSection), /查看记录编号.*follow-one/)
  assert.match(visibleText(followSection), /查看记录编号.*follow-two/)
})

test('desktop task cards use bounded goal labels to distinguish the same session', async () => {
  const first = { commandId: 'root-one', requestId: 'request-one', kind: 'session.message',
    state: 'accepted_by_dsh', sessionId: 'A', taskLabel: '整理本周工作并标注来源' }
  const second = { commandId: 'root-two', requestId: 'request-two', kind: 'session.message',
    state: 'accepted_by_dsh', sessionId: 'A', taskLabel: '检查另一份清单' }
  const page = harness([first, second], [], true)
  for (let i = 0; i < 15 && page.get('task-list').children.length < 2; i++) await flush()
  const list = visibleText(page.get('task-list'))
  assert.match(list, /整理本周工作并标注来源/)
  assert.match(list, /检查另一份清单/)
  assert.doesNotMatch(list, /root-one|root-two/)
})

test('observed prior turn offers resume without claiming the stop caused it', async () => {
  const source = { commandId: 'root-task', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A' }
  const page = harness([source], [], true, { taskDetails: { 'root-task': {
    taskId: 'root-task', sessionId: 'A', source, artifacts: [], control: { state: 'stop_requested',
      reasonCode: 'TURN_ENDED_AFTER_STOP_REQUEST', canSupplement: false, canStop: false, canResume: true },
  } } })
  for (let attempt = 0; attempt < 15 && page.get('task-list').children.length === 0; attempt++) await flush()
  page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!.fire('click')
  for (let attempt = 0; attempt < 15 && page.get('task-detail-control').children.length === 0; attempt++) await flush()
  const control = visibleText(page.get('task-detail-control'))
  assert.match(control, /上一回合已结束.*尚不能确认是停止请求.*请写明下一步/)
  assert.doesNotMatch(control, /仍在等待执行端状态核对/)
  assert.match(control, /恢复这件事/)
})

test('task stop observation shows request, cancel request, and proven terminal without another POST', async () => {
  const source = { commandId: 'root-task', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A' }
  const taskDetails: Record<string, any> = { 'root-task': {
    taskId: 'root-task', sessionId: 'A', source, artifacts: [], control: {
      state: 'stop_requested', stopStatus: 'requested', pendingReceipts: 1,
      canSupplement: false, canStop: false, canResume: false },
  } }
  const page = harness([source], [], true, { taskDetails, taskPollTimers: true })
  for (let i = 0; i < 15 && page.get('task-list').children.length === 0; i++) await flush()
  page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!.fire('click')
  for (let i = 0; i < 15 && page.get('task-detail-control').children.length === 0; i++) await flush()
  assert.match(visibleText(page.get('task-detail-control')), /目前还不能确认已停止/)
  assert.equal(page.pendingTaskTimers(), 1)
  taskDetails['root-task'] = { ...taskDetails['root-task'], control: {
    state: 'stop_requested', stopStatus: 'cancel_requested', pendingReceipts: 1,
    canSupplement: false, canStop: false, canResume: false } }
  page.runTaskTimer(); await flush()
  assert.match(visibleText(page.get('task-detail-control')), /发起取消.*等待实际结束记录/)
  assert.equal(page.pendingTaskTimers(), 1)
  taskDetails['root-task'] = { ...taskDetails['root-task'], control: {
    state: 'stop_requested', stopStatus: 'stopped', pendingReceipts: 0,
    stopObservedAt: '2026-10-03T10:00:00.000Z', canSupplement: false, canStop: false, canResume: true } }
  page.runTaskTimer(); await flush()
  assert.match(visibleText(page.get('task-detail-control')), /实际停止.*停止核对.*恢复这件事/)
  assert.match(page.get('task-detail-verification').textContent, /这件事已停止/)
  assert.doesNotMatch(page.get('task-detail-verification').textContent, /原消息已送达/)
  assert.equal(page.pendingTaskTimers(), 0)
  assert.equal(page.requests.filter((item) => item.url.endsWith('/tasks/root-task/stop')).length, 0)
  assert.equal(page.requests.filter((item) => item.url.endsWith('/tasks/root-task')).length, 3)
})

test('task stop observation is bounded and ignores a late result after close or account switch', async () => {
  const source = { commandId: 'root-task', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A' }
  const taskDetails: Record<string, any> = { 'root-task': {
    taskId: 'root-task', sessionId: 'A', source, artifacts: [], control: {
      state: 'stop_requested', stopStatus: 'unconfirmed', pendingReceipts: 1,
      canSupplement: false, canStop: false, canResume: false },
  } }
  const page = harness([source], [], true, { taskDetails, taskPollTimers: true, profileAccounts: profileFixture() })
  await ready(page)
  for (let i = 0; i < 15 && page.get('task-list').children.length === 0; i++) await flush()
  page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!.fire('click')
  for (let i = 0; i < 15 && page.pendingTaskTimers() === 0; i++) await flush()
  for (let i = 0; i < 8; i++) { assert.equal(page.runTaskTimer(), true); await flush() }
  assert.equal(page.pendingTaskTimers(), 0)
  assert.match(visibleText(page.get('task-detail-control')), /自动核对已暂停/)
  page.get('task-detail-refresh').fire('click')
  for (let i = 0; i < 15 && page.pendingTaskTimers() === 0; i++) await flush()
  page.deferOneTaskDetail()
  page.runTaskTimer(); await flush()
  await switchToB(page)
  page.resolveTaskDetail({ ...taskDetails['root-task'], control: { state: 'stop_requested', stopStatus: 'stopped', canResume: true } })
  await flush()
  assert.equal(page.get('task-detail-dialog').open, false)
  assert.doesNotMatch(visibleText(page.get('task-detail-control')), /实际停止/)
  assert.equal(page.pendingTaskTimers(), 0)
})

test('normal completion and legacy stop keep honest copy and explicit resume', async () => {
  const source = { commandId: 'root-task', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A' }
  const taskDetails: Record<string, any> = { 'root-task': {
    taskId: 'root-task', sessionId: 'A', source, artifacts: [], control: {
      state: 'stop_requested', stopStatus: 'completed', canResume: true, canStop: false, canSupplement: false },
  } }
  const page = harness([source], [], true, { taskDetails })
  for (let i = 0; i < 15 && page.get('task-list').children.length === 0; i++) await flush()
  page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!.fire('click')
  for (let i = 0; i < 15 && page.get('task-detail-control').children.length === 0; i++) await flush()
  assert.match(visibleText(page.get('task-detail-control')), /正常结束.*没有已证实的中断结果.*恢复这件事/)
  taskDetails['root-task'] = { ...taskDetails['root-task'], control: {
    state: 'stop_requested', stopStatus: 'unconfirmed', legacyStopIntent: true, pendingReceipts: 1,
    canResume: false, canStop: false, canSupplement: false } }
  page.get('task-detail-refresh').fire('click')
  await flush()
  assert.match(visibleText(page.get('task-detail-control')), /旧停止记录.*结果仍待核对/)
  assert.doesNotMatch(visibleText(page.get('task-detail-control')), /恢复这件事/)
})

test('task detail shows model desktop steps with evidence-bound status and hidden IDs', async () => {
  const source = { commandId: 'root-task', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A' }
  const steps = [
    { commandId: 'step-observed', kind: 'desktop.open_app', appId: 'notepad', state: 'observed',
      verification: { status: 'observed', method: 'visible_window', observedAt: '2026-09-28T00:00:00Z' } },
    { commandId: 'step-pending', kind: 'desktop.open_app', appId: 'notepad', state: 'pending', createdAt: '2026-09-28T00:01:00Z' },
    { commandId: 'step-uncertain', kind: 'desktop.open_app', appId: 'notepad', state: 'uncertain', updatedAt: '2026-09-28T00:02:00Z' },
  ]
  const page = harness([source], [], true, { taskDetails: { 'root-task': {
    taskId: 'root-task', sessionId: 'A', source, artifacts: [], steps,
  } } })
  for (let attempt = 0; attempt < 15 && page.get('task-list').children.length === 0; attempt++) await flush()
  page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!.fire('click')
  for (let attempt = 0; attempt < 15 && page.get('task-detail-control').children.length === 0; attempt++) await flush()
  const section = page.get('task-detail-control').children[0]
  assert.match(visibleText(section), /执行步骤.*打开记事本.*电脑窗口已观察.*等待电脑受理.*结果待确认/)
  const mainCopy = section.children.filter((item) => item.className === 'task-followup')
    .map((item) => item.children[0].textContent).join(' ')
  assert.doesNotMatch(mainCopy, /step-observed|step-pending|step-uncertain/)
  assert.match(visibleText(section), /查看记录编号.*step-observed/)
})

test('a late task detail from account A cannot appear after account B signs in', async () => {
  const artifact = { commandId: 'cmd-file', requestId: 'file-request', kind: 'desktop.write_artifact',
    taskId: 'cmd-source', artifactId: 'artifact-one', fileName: 'A私有.txt', size: 4, sessionId: 'A',
    state: 'observed', verification: { status: 'observed', method: 'sha256_readback' } }
  const page = harness([artifact], [], true, { profileAccounts: profileFixture(), deferTaskDetail: true })
  await ready(page)
  for (let attempt = 0; attempt < 15 && page.get('task-list').children.length === 0; attempt++) await flush()
  page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!.fire('click')
  await flush()
  await switchToB(page)
  page.resolveTaskDetail({ taskId: 'cmd-source', sessionId: 'A', sourceText: 'A 的私人目标', artifacts: [artifact] })
  for (let attempt = 0; attempt < 10; attempt++) await flush()
  assert.equal(page.get('task-detail-dialog').open, false)
  assert.doesNotMatch(page.get('task-detail-source').textContent, /A 的私人目标/)
})

test('stale task list cannot open a task missing from the current account', async () => {
  const page = harness([{ commandId: 'cmd-file', requestId: 'file-request', kind: 'desktop.write_artifact',
    taskId: 'cmd-source', artifactId: 'artifact-one', fileName: '旧成果.md', state: 'observed',
    verification: { status: 'observed', method: 'sha256_readback' } }])
  for (let attempt = 0; attempt < 15 && page.get('task-list').children.length === 0; attempt++) await flush()
  page.get('task-list').children[0].children.find((item) => item.textContent === '查看事情与成果')!.fire('click')
  for (let attempt = 0; attempt < 15 && !/找不到/.test(page.get('task-detail-status').textContent); attempt++) await flush()
  assert.match(page.get('task-detail-status').textContent, /当前账户找不到/)
  assert.equal(page.get('task-detail-body').hidden, true)
})

test('durable turn errors remain visible while a later completed turn clears the warning and keeps messages', async () => {
  const events = [
    { seq: 1, type: 'user.message', data: { text: 'hello' } },
    { seq: 2, type: 'turn.started', data: {} },
    { seq: 3, type: 'turn.ended', data: { reason: 'error' } },
  ]
  const page = harness([], events)
  for (let attempt = 0; attempt < 10 && !page.get('timeline-status').textContent.includes('运行失败'); attempt++) await flush()
  assert.match(page.get('timeline-status').textContent, /本轮运行失败/)
  assert.match(page.get('transcript').children.map(visibleText).join(' '), /hello/)
  events.push({ seq: 4, type: 'turn.started', data: {} },
    { seq: 5, type: 'assistant.message', data: { text: 'reply' } },
    { seq: 6, type: 'turn.ended', data: { reason: 'completed' } })
  page.get('session-list').children[0].children[0].fire('click')
  for (let attempt = 0; attempt < 10 && page.get('transcript').children.length < 2; attempt++) await flush()
  assert.equal(page.get('timeline-status').textContent, '')
  assert.match(page.get('transcript').children.map(visibleText).join(' '), /hello.*reply/)
})

test('a persisted start without an ending record does not claim work is still running after the host says idle', async () => {
  const page = harness([], [{ seq: 1, type: 'turn.started', data: {} }], false)
  for (let attempt = 0; attempt < 10 && !page.get('timeline-status').textContent; attempt++) await flush()
  assert.match(page.get('timeline-status').textContent, /尚无结束记录/)
  assert.doesNotMatch(page.get('timeline-status').textContent, /正在处理/)
})

test('history polling catches up across pages and shows a persisted user abort only after reaching the tail', async () => {
  const events = [{ seq: 1, type: 'turn.started', data: {} }]
  const page = harness([], events, false, { eventPageSize: 1 })
  for (let attempt = 0; attempt < 10 && !page.get('timeline-status').textContent.includes('尚无结束记录'); attempt++) await flush()
  assert.match(page.get('timeline-status').textContent, /尚无结束记录/)
  for (let seq = 2; seq <= 8; seq++) events.push({ seq, type: 'assistant.delta', data: { text: 'ignored' } })
  events.push({ seq: 9, type: 'turn.ended', data: { reason: 'aborted' } })
  page.tick()
  for (let attempt = 0; attempt < 15 && !page.get('timeline-status').textContent.includes('历史仍在补读'); attempt++) await flush()
  assert.match(page.get('timeline-status').textContent, /历史仍在补读/)
  assert.doesNotMatch(page.get('timeline-status').textContent, /尚无结束记录/)
  page.tick()
  for (let attempt = 0; attempt < 15 && !page.get('timeline-status').textContent.includes('本轮已停止'); attempt++) await flush()
  assert.match(page.get('timeline-status').textContent, /本轮已停止/)
})

test('new sync records render as read-only phone sources while an older host keeps its normal chat', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000001'
  const rows = [
    { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '路上的记录' } },
    { seq: 2, conversationId, sourceDeviceId: 'device-phone', kind: 'message.created',
      payload: { role: 'user', text: '手机离线写下的内容' } },
    { seq: 3, conversationId, sourceDeviceId: 'device-phone', kind: 'turn.finished', payload: { status: 'interrupted' } },
    { seq: 4, conversationId, sourceDeviceId: 'device-phone', kind: 'tool.receipt',
      payload: { status: 'dispatched', summary: '设置页打开请求已发出' } },
  ]
  const page = harness([], [], true, { syncAvailable: true, syncEvents: rows, downloadAvailable: true })
  for (let attempt = 0; attempt < 10 && page.get('assistant-view').hidden; attempt++) await flush()
  await flush()
  assert.equal(page.get('show-phone').hidden, true, 'unified rail is the main chat entry')
  page.get('show-phone').fire('click')
  for (let attempt = 0; attempt < 10 && !/合成手机/.test(visibleText(page.get('phone-conversations'))); attempt++) await flush()
  assert.equal(page.get('phone-pane').hidden, false)
  assert.match(visibleText(page.get('phone-conversations')), /路上的记录.*合成手机/)
  const history = visibleText(page.get('phone-history'))
  assert.match(history, /合成手机.*手机离线写下的内容/)
  assert.match(history, /中断/)
  assert.match(history, /已派发，结果待核对/)
  assert.equal(page.requests.filter((request) => request.url.endsWith('/commands') && request.options.method === 'POST').length, 0)
  page.get('phone-back').fire('click')
  assert.equal(page.get('conversation-pane').hidden, false)

  const older = harness()
  for (let attempt = 0; attempt < 10 && older.get('assistant-view').hidden; attempt++) await flush()
  assert.equal(older.get('show-phone').hidden, true)
  assert.equal(older.requests.some((request) => request.url.includes('/sync/events')), false)
  assert.equal(older.get('conversation-pane').hidden, false)
})

test('main chat rail opens the same phone MiMo conversation and its authenticated original image', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000001'
  const attachmentId = 'attachment-00000000-0000-4000-8000-000000000002'
  const rows = [
    { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '路上的图片' } },
    { seq: 2, conversationId, sourceDeviceId: 'device-phone', kind: 'message.created', payload: {
      messageId: 'message-00000000-0000-4000-8000-000000000003', role: 'user', text: '看看这张图',
      attachments: [{ attachmentId, name: '风景.png', contentType: 'image/png', size: 20, sha256: 'a'.repeat(64) }],
    } },
    { seq: 3, conversationId, sourceDeviceId: 'device-phone', kind: 'message.created', payload: {
      messageId: 'message-00000000-0000-4000-8000-000000000004', role: 'assistant', text: '看到山了',
    } },
    { seq: 4, conversationId, sourceDeviceId: 'device-phone', kind: 'message.created', payload: {
      messageId: 'message-00000000-0000-4000-8000-000000000005', role: 'user',
      text: '旧图\n[本机附件：早期照片.jpg；跨端暂不可见]',
    } },
  ]
  const page = harness([], [], false, { syncAvailable: true, syncEvents: rows })
  for (let attempt = 0; attempt < 20 && page.get('session-list').children.length < 3; attempt++) await flush()
  const rail = page.get('session-list')
  assert.equal(rail.children.length, 3, 'desktop and phone conversations share one rail')
  assert.match(visibleText(rail.children[2]), /路上的图片.*手机 · MiMo/)
  rail.children[2].children[0].fire('click')
  assert.equal(page.get('assistant-title').textContent, '路上的图片')
  assert.equal(page.get('conversation-pane').hidden, false)
  assert.equal(page.get('message-text').disabled, false)
  assert.equal(page.get('model-hint').textContent, '')
  assert.equal(page.get('model-hint').hidden, true, 'routine chat does not show implementation guidance')
  assert.match(visibleText(page.get('transcript')), /看看这张图.*看到山了.*旧图/)
  assert.doesNotMatch(visibleText(page.get('transcript')), /跨端暂不可见/)
  assert.doesNotMatch(visibleText(page.get('transcript')), /风景\.png|早期照片\.jpg|原图未包含/)
  const thumbnail = page.get('transcript').children[0].children.find((child) => child.className === 'synced-image-gallery')!
  const image = thumbnail.children[0].children[0]
  assert.equal(image.src, `/personal/v1/sync/attachments/${attachmentId}?variant=display`)
  assert.equal(image.loading, 'lazy')
  assert.equal(image.decoding, 'async')
  thumbnail.children[0].fire('click')
  const preview = page.get('body').children.find((child) => child.id === 'phone-image-preview')!
  assert.equal(preview.hidden, false)
  assert.equal(preview.children[0].src, `/personal/v1/sync/attachments/${attachmentId}`)
  assert.equal(preview.children.length, 2, 'full-screen viewer has only image and close control')
  preview.children[1].fire('click')
  assert.equal(preview.hidden, true)
  assert.equal(thumbnail.children[0].focused, true, 'close returns focus to the image trigger')
  thumbnail.children[0].focused = false
  thumbnail.children[0].fire('click')
  preview.fire('cancel')
  assert.equal(preview.hidden, true, 'Escape closes the native dialog')
  assert.equal(thumbnail.children[0].focused, true, 'Escape returns focus to the trigger')
  rail.children[0].children[0].fire('click')
  await flush()
  assert.equal(page.get('assistant-title').textContent, 'A')
  assert.equal(page.get('message-text').disabled, false, 'desktop DSH conversation remains sendable')
})

test('bound phone conversation keeps one rail card and exact receipt renders its adopted user once', async () => {
  const conversationId = 'conversation-11111111-1111-4111-8111-111111111111'
  const adoptedId = 'event-22222222-2222-4222-8222-222222222222'
  const rows = [
    { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '同一段对话' } },
    { seq: 2, conversationId, sourceDeviceId: 'device-phone', kind: 'message.created', payload: {
      messageId: 'message-33333333-3333-4333-8333-333333333333', role: 'user', text: '手机事实' } },
    { seq: 3, conversationId, sourceDeviceId: 'device-phone', kind: 'message.created', payload: {
      messageId: 'message-44444444-4444-4444-8444-444444444444', role: 'assistant', text: '本机回应' } },
    { seq: 4, eventId: adoptedId, conversationId, sourceDeviceId: 'device-phone', kind: 'message.created', payload: {
      messageId: 'message-55555555-5555-4555-8555-555555555555', role: 'user', text: '新的电脑追问' } },
  ]
  const view = { source: 'host', hostId: 'host-test', conversationId, status: 'active', canAdopt: false,
    binding: { sessionId: 'A', modelProfileId: 'model-test', cutoverSyncSeq: 3,
      historyMessageCount: 3, truncated: false, omittedImages: 0 },
    adoptedMessages: [{ sourceSyncEventId: adoptedId, receiptId: 'rpc-exact', state: 'accepted_by_dsh' }] }
  const history = [{ seq: 10, type: 'user.message', data: { text: '新的电脑追问', receiptId: 'rpc-exact' } },
    { seq: 11, type: 'assistant.message', data: { text: '电脑基于手机事实回答' } }]
  const page = harness([], history, false, { syncAvailable: true, syncEvents: rows,
    conversationViews: { [conversationId]: view } })
  for (let attempt = 0; attempt < 30 && page.get('session-list').children.length !== 2; attempt++) await flush()
  assert.equal(page.get('session-list').children.length, 2, 'bound A is represented by the original phone card')
  page.get('session-list').children[1].children[0].fire('click')
  for (let attempt = 0; attempt < 30 && !visibleText(page.get('transcript')).includes('电脑基于手机事实回答'); attempt++) await flush()
  const text = visibleText(page.get('transcript'))
  assert.match(text, /手机事实.*本机回应.*电脑基于手机事实回答/)
  assert.equal(text.match(/新的电脑追问/g)?.length, 1)
  assert.equal(page.get('send-message').textContent, '发送到电脑')
})

test('phone handoff prefers only one exact original route and never defaults to unrelated Qwen', async () => {
  const conversationId = 'conversation-66666666-6666-4666-8666-666666666666'
  const events = [{ seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created',
    payload: { title: '模型选择' } }, { seq: 2, conversationId, sourceDeviceId: 'device-phone',
    kind: 'message.created', payload: { messageId: 'message-77777777-7777-4777-8777-777777777777',
      role: 'user', text: '原目标' } }]
  const fingerprint = 'a'.repeat(64)
  const catalog = [
    { id: 'qwen', name: 'Qwen', model: 'qwen', routeFingerprint: 'b'.repeat(64), configured: true },
    { id: 'mimo', name: 'MiMo', model: 'mimo-v2.6-flash', routeFingerprint: fingerprint, configured: true },
  ]
  const view = (originalModel: object | null) => ({ source: 'host', hostId: 'host-test', conversationId,
    status: 'unbound', canAdopt: true, syncThroughSeq: 2, originalModel })
  async function opened(originalModel: object | null) {
    const page = harness([], [], false, { syncAvailable: true, syncEvents: events,
      modelCatalog: catalog, conversationViews: { [conversationId]: view(originalModel) } })
    for (let attempt = 0; attempt < 25 && page.get('session-list').children.length < 3; attempt++) await flush()
    page.get('session-list').children[2].children[0].fire('click')
    for (let attempt = 0; attempt < 25 && !visibleText(page.get('transcript')).includes('刷新电脑模型目录'); attempt++) await flush()
    const controls = page.get('transcript').children.at(-1)!
    const select = controls.children.find((item) => item.textContent === '电脑模型')?.children[0]
    assert.ok(select)
    return { page, select, controls }
  }
  const exact = await opened({ modelId: 'mimo-v2.6-flash', displayName: 'MiMo', routeFingerprint: fingerprint })
  assert.equal(exact.select.value, 'mimo')
  const sameHost = await opened({ modelId: 'qwen', displayName: 'Qwen', routeFingerprint: null,
    hostProfileId: 'qwen' })
  assert.equal(sameHost.select.value, 'qwen', 'exact prior host profile remains valid without a local URL hash')
  const unknown = await opened(null)
  assert.equal(unknown.select.value, '')
  assert.match(visibleText(unknown.controls), /旧记录没有可核对的原模型身份/)
  const missing = await opened({ modelId: 'mimo-v2.6-flash', displayName: 'MiMo',
    routeFingerprint: 'c'.repeat(64) })
  assert.equal(missing.select.value, '')
  assert.match(visibleText(missing.controls), /尚无可核对的同一配置/)
  catalog.push({ id: 'mimo-second', name: 'MiMo second route', model: 'mimo-v2.6-flash',
    routeFingerprint: fingerprint, configured: true })
  const multiple = await opened({ modelId: 'mimo-v2.6-flash', displayName: 'MiMo',
    routeFingerprint: fingerprint })
  assert.equal(multiple.select.value, '', 'multiple exact routes require a deliberate selection')
})

test('desktop account model form sends a typed secret once and recovers only public operation fields', async () => {
  const models: any[] = []
  const receipts: Record<string, object> = {}
  const writes: Array<{ url: string; body: any }> = []
  const page = harness([], [], false, { accountModels: models, accountModelByRequest: receipts,
    accountModelWrite: (url, options) => {
      const body = JSON.parse(options.body)
      writes.push({ url, body })
      const model = { accountModelId: 'account-model-one', revision: 1, profileId: 'private-one',
        name: '我的 MiMo', provider: 'openai-compatible', baseUrl: 'https://api.xiaomimimo.com/v1',
        modelId: 'mimo-v2.6-flash', routeFingerprint: 'a'.repeat(64), configured: true,
        status: 'active', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }
      if (url.endsWith('/account/models')) models.push(model)
      const result = { operation: { requestId: body.requestId,
        kind: url.endsWith('/test') ? 'test' : 'create', accountModelId: model.accountModelId,
        status: 'succeeded', resultRevision: 1,
        ...(url.endsWith('/test') ? { testResult: { configured: true, reachable: false, modelListed: false } } : {}) }, model }
      receipts[body.requestId] = result
      return result
    } })
  for (let attempt = 0; attempt < 15 && page.get('assistant-view').hidden; attempt++) await flush()
  page.get('rail-account').fire('click')
  for (let attempt = 0; attempt < 30 &&
      !page.get('account-models-status').textContent.includes('可把手机已保存'); attempt++) await flush()
  assert.equal(page.get('account-model-form').hidden, false)
  page.get('account-model-name').value = '我的 MiMo'
  page.get('account-model-base-url').value = 'https://api.xiaomimimo.com/v1'
  page.get('account-model-id').value = 'mimo-v2.6-flash'
  page.get('account-model-key').value = 'synthetic-private-key'
  assert.ok(page.get('account-model-form').listeners.get('submit')?.length)
  page.get('account-model-form').fire('submit')
  for (let attempt = 0; attempt < 35 && models.length < 1; attempt++) await flush()
  assert.equal(writes.length, 1, `form=${page.get('account-model-form-status').textContent}; list=${page.get('account-models-status').textContent}; requests=${page.requests.filter((item) => item.url.includes('/account/models')).map((item) => item.url).join(',')}`)
  assert.equal(writes[0].body.apiKey, 'synthetic-private-key')
  assert.equal([...page.storage.values()].some((value) => value.includes('synthetic-private-key')), false)
  for (let attempt = 0; attempt < 25 && !visibleText(page.get('account-models-list')).includes('我的 MiMo'); attempt++) await flush()
  assert.match(visibleText(page.get('account-models-list')), /我的 MiMo/)
  const test = page.get('account-models-list').children[0].children[1].children
    .find((item) => item.textContent === '测试连接')!
  test.fire('click')
  for (let attempt = 0; attempt < 25 && writes.length < 2; attempt++) await flush()
  assert.equal(writes.length, 2)
  assert.equal(writes[1].body.apiKey, undefined)
  assert.match(page.get('account-models-status').textContent, /尚未发送推理消息/)
  assert.match(page.get('account-models-status').textContent, /未通过/)
})

test('phone image timeline bounds large originals and recovers small images without display sidecars', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000011'
  const smallId = 'attachment-00000000-0000-4000-8000-000000000012'
  const largeId = 'attachment-00000000-0000-4000-8000-000000000013'
  const rows = [
    { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '长图对话' } },
    { seq: 2, conversationId, sourceDeviceId: 'device-phone', kind: 'message.created', payload: {
      messageId: 'message-00000000-0000-4000-8000-000000000014', role: 'user',
      text: '看这张\n[本机附件：旧图.png、notes.txt；跨端暂不可见]',
      attachments: [{ attachmentId: smallId, name: '旧图.png', contentType: 'image/png', size: 2 * 1024 * 1024 }],
    } },
    { seq: 3, conversationId, sourceDeviceId: 'device-phone', kind: 'message.created', payload: {
      messageId: 'message-00000000-0000-4000-8000-000000000015', role: 'user', text: '',
      attachments: [{ attachmentId: largeId, name: '长截图.png', contentType: 'image/png', size: 1024 * 1024 * 1024 }],
    } },
  ]
  const page = harness([], [], false, { syncAvailable: true, syncEvents: rows })
  for (let attempt = 0; attempt < 20 && page.get('session-list').children.length < 3; attempt++) await flush()
  page.get('session-list').children.at(-1)!.children[0].fire('click')
  const messages = page.get('transcript').children
  assert.match(visibleText(messages[0]), /看这张.*notes\.txt/)
  assert.doesNotMatch(visibleText(messages[0]), /旧图\.png|跨端暂不可见/)
  const small = messages[0].children.find((child) => child.className === 'synced-image-gallery')!.children[0]
  assert.equal(small.children[0].src, `/personal/v1/sync/attachments/${smallId}?variant=display`)
  small.children[0].fire('error')
  assert.equal(small.children[0].src, `/personal/v1/sync/attachments/${smallId}`,
    'old small image falls back only after display sidecar fails')
  const large = messages[1].children.find((child) => child.className === 'synced-image-gallery')!.children[0]
  assert.equal(large.children[0].src, `/personal/v1/sync/attachments/${largeId}?variant=display`)
  large.fire('click')
  const preview = page.get('body').children.find((child) => child.id === 'phone-image-preview')!
  assert.equal(preview.children[0].src, `/personal/v1/sync/attachments/${largeId}?variant=display`,
    'large source never loads automatically or in full-screen preview')
  preview.children[1].fire('click')
  assert.match(styles, /\.message\.user\.message-image-only \{[^}]*background: transparent;/)
})

test('DSH history renders image-only and mixed user turns from owner-scoped GET, then closes on session switch', async () => {
  const durableId = `sha256:${'a'.repeat(64)}`
  const events = [
    { seq: 1, type: 'user.message', data: { images: [{ attachmentId: durableId,
      contentType: 'image/png', size: 20, width: 256, height: 256, name: '蓝色.png' }] } },
    { seq: 2, type: 'user.message', data: { text: '这是第二张', images: [{ attachmentId: durableId,
      contentType: 'image/png', size: 20, width: 256, height: 256 }] } },
    { seq: 3, type: 'user.message', data: { text: '旧文字', images: [
      { attachmentId: 'sha256:NOT-HEX', contentType: 'image/png' },
      { attachmentId: durableId, contentType: 'image/png', sessionId: 'B' },
    ] } },
  ]
  const page = harness([], events, false)
  for (let attempt = 0; attempt < 20 && page.get('transcript').children.length < 3; attempt++) await flush()
  const rows = page.get('transcript').children
  assert.equal(rows.length, 3, 'image-only user message is visible')
  const firstGallery = rows[0].children.find((child) => child.className === 'synced-image-gallery')!
  assert.equal(firstGallery.children.length, 1)
  const url = `/personal/v1/sessions/A/attachments/${durableId}`
  assert.equal(firstGallery.children[0].children[0].src, url)
  assert.equal(firstGallery.children[0].children[0].decoding, 'async')
  assert.match(styles, /\.synced-image img \{[^}]*height: auto; object-fit: contain;/)
  assert.match(visibleText(rows[1]), /这是第二张/)
  assert.equal(rows[1].children.find((child) => child.className === 'synced-image-gallery')!.children.length, 1)
  assert.equal(rows[2].children.some((child) => child.className === 'synced-image-gallery'), false)
  assert.match(visibleText(rows[2]), /2 张历史图片暂无法查看/)
  assert.doesNotMatch(visibleText(page.get('transcript')), /data:image|base64/)
  firstGallery.children[0].fire('click')
  const viewer = page.get('body').children.find((child) => child.id === 'phone-image-preview')!
  assert.equal(viewer.hidden, false)
  assert.equal(viewer.children[0].src, url)
  page.get('session-list').children[1].children[0].fire('click')
  await flush()
  assert.equal(viewer.hidden, true)
  assert.equal(viewer.children[0].src, '')
  assert.equal(firstGallery.children[0].focused, false, 'session switch does not restore focus to a stale card')
})

test('desktop history offers a generic original download only for unstaged large images', async () => {
  const durableId = `sha256:${'c'.repeat(64)}`
  const smallOriginalId = 'attachment-00000000-0000-4000-8000-000000000063'
  const largeOriginalId = 'attachment-00000000-0000-4000-8000-000000000064'
  const small = { attachmentId: smallOriginalId, name: 'small-preview.png', contentType: 'image/png',
    size: 20, sha256: 'd'.repeat(64) }
  const large = { attachmentId: largeOriginalId, name: 'large-private-name.png', contentType: 'image/png',
    size: 6 * 1024 * 1024, sha256: 'e'.repeat(64) }
  const events = [
    { seq: 1, type: 'user.message', data: { text: '仅保留大图原件', originalAttachments: [large],
      unpreviewedOriginalImageIds: [largeOriginalId] } },
    { seq: 2, type: 'user.message', data: { text: '小图预览和大图原件', images: [{ attachmentId: durableId,
      contentType: 'image/png', size: small.size }], originalAttachments: [small, large],
      unpreviewedOriginalImageIds: [largeOriginalId] } },
  ]
  const page = harness([], events, false)
  for (let attempt = 0; attempt < 20 && page.get('transcript').children.length < 2; attempt++) await flush()
  const rows = page.get('transcript').children
  const largeOnly = rows[0].children.find((child) => child.className === 'synced-image-original-list')!
  assert.equal(largeOnly.children.length, 1)
  const largeLink = largeOnly.children[0] as any
  assert.equal(largeLink.href, `/personal/v1/sync/attachments/${largeOriginalId}`)
  assert.equal(largeLink.attributes.get('download'), large.name)
  assert.match(visibleText(largeLink), /下载图片原件.*6\.0 MB/)
  assert.doesNotMatch(visibleText(largeLink), /large-private-name/)
  assert.equal(rows[0].children.some((child) => child.className === 'synced-image-gallery'), false)

  const gallery = rows[1].children.find((child) => child.className === 'synced-image-gallery')!
  assert.equal(gallery.children.length, 1, 'the staged small image remains the normal inline preview')
  assert.equal(gallery.children[0].children[0].src, `/personal/v1/sessions/A/attachments/${durableId}`)
  const mixedOriginals = rows[1].children.find((child) => child.className === 'synced-image-original-list')!
  assert.equal(mixedOriginals.children.length, 1, 'the small staged UUID is not duplicated as an original download')
  assert.equal((mixedOriginals.children[0] as any).href, `/personal/v1/sync/attachments/${largeOriginalId}`)
  assert.doesNotMatch(visibleText(rows[1]), /small-preview\.png|large-private-name\.png/,
    'normal previews keep their filename-free presentation and the large fallback stays generic')
})

test('account logout clears an open DSH image viewer and its conversation cards', async () => {
  const durableId = `sha256:${'b'.repeat(64)}`
  const page = harness([], [{ seq: 1, type: 'user.message', data: { images: [{ attachmentId: durableId,
    contentType: 'image/png', size: 20, width: 256, height: 256 }] } }], false)
  for (let attempt = 0; attempt < 20 && !page.get('transcript').children.length; attempt++) await flush()
  const gallery = page.get('transcript').children[0].children.find((child) => child.className === 'synced-image-gallery')!
  gallery.children[0].fire('click')
  const viewer = page.get('body').children.find((child) => child.id === 'phone-image-preview')!
  assert.equal(viewer.hidden, false)
  page.get('logout-button').fire('click')
  for (let attempt = 0; attempt < 20 && !viewer.hidden; attempt++) await flush()
  assert.equal(viewer.hidden, true)
  assert.equal(viewer.children[0].src, '')
  assert.equal(page.get('transcript').children.length, 0)
  gallery.children[0].fire('click')
  assert.equal(viewer.hidden, true, 'stale image control cannot reopen after account logout')
})

test('desktop appends one user text event to the original phone conversation without invoking a model', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000001'
  const page = harness([], [], false, { syncAvailable: true, uuidForSync: true, syncEvents: [
    { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '同一条对话' } },
  ] })
  for (let attempt = 0; attempt < 20 && page.get('session-list').children.length < 3; attempt++) await flush()
  page.get('session-list').children[2].children[0].fire('click')
  page.get('message-text').value = '电脑补充的文字'
  page.get('message-text').fire('input')
  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && !/电脑补充的文字/.test(visibleText(page.get('transcript'))); attempt++) await flush()
  const posts = page.requests.filter((request) => request.url.endsWith('/sync/events') && request.options.method === 'POST')
  assert.equal(posts.length, 1)
  const sent = JSON.parse(posts[0].options.body).events[0]
  assert.equal(sent.conversationId, conversationId)
  assert.equal(sent.kind, 'message.created')
  assert.equal(sent.payload.role, 'user')
  assert.equal(sent.payload.text, '电脑补充的文字')
  assert.equal(visibleText(page.get('transcript')).match(/电脑补充的文字/g)?.length, 1)
  assert.match(visibleText(page.get('transcript')), /你 · 电脑同步/)
  assert.match(page.get('model-hint').textContent, /电脑没有运行模型/)
  assert.equal(page.requests.some((request) => request.url.endsWith('/commands') && request.options.method === 'POST'), false)
  assert.equal(page.storage.has('weftmate:phone-sync-outbox:v1:owner-test:device-test'), false)
})

test('timeout keeps exact phone event and draft; retry reconciles then posts the same IDs once', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000001'
  const page = harness([], [], false, { syncAvailable: true, uuidForSync: true, syncPost: 'timeout-no-commit', syncEvents: [
    { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '离线文字' } },
  ] })
  for (let attempt = 0; attempt < 20 && page.get('session-list').children.length < 3; attempt++) await flush()
  page.get('session-list').children[2].children[0].fire('click')
  page.get('message-text').value = '原文保留'
  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && !page.storage.has('weftmate:phone-sync-outbox:v1:owner-test:device-test'); attempt++) await flush()
  const key = 'weftmate:phone-sync-outbox:v1:owner-test:device-test'
  const pending = JSON.parse(page.storage.get(key)!)
  assert.equal(pending.event.payload.text, '原文保留')
  for (let attempt = 0; attempt < 20 && (page.get('send-message').textContent !== '核对并重试' ||
    page.get('send-message').disabled); attempt++) await flush()
  assert.equal(page.get('message-text').value, '原文保留')
  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && page.storage.has(key); attempt++) await flush()
  const posts = page.requests.filter((request) => request.url.endsWith('/sync/events') && request.options.method === 'POST')
  assert.equal(posts.length, 2)
  assert.deepEqual(JSON.parse(posts[0].options.body), JSON.parse(posts[1].options.body))
  assert.equal(page.storage.has(key), false)
  assert.equal(visibleText(page.get('transcript')).match(/原文保留/g)?.length, 1)
})

test('lost receipt after server commit reconciles the same event without a second POST', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000001'
  const page = harness([], [], false, { syncAvailable: true, uuidForSync: true, syncPost: 'timeout-committed', syncEvents: [
    { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '已接收的文字' } },
  ] })
  for (let attempt = 0; attempt < 20 && page.get('session-list').children.length < 3; attempt++) await flush()
  page.get('session-list').children[2].children[0].fire('click')
  page.get('message-text').value = '只保存一次'
  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && !/只保存一次/.test(visibleText(page.get('transcript'))); attempt++) await flush()
  assert.equal(page.requests.filter((request) => request.url.endsWith('/sync/events') && request.options.method === 'POST').length, 1)
  assert.equal(visibleText(page.get('transcript')).match(/只保存一次/g)?.length, 1)
  assert.equal(page.storage.has('weftmate:phone-sync-outbox:v1:owner-test:device-test'), false)
})

test('409 keeps the original phone draft and exact event for explicit review', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000001'
  const page = harness([], [], false, { syncAvailable: true, uuidForSync: true, syncPost: 'conflict', syncEvents: [
    { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '冲突会话' } },
  ] })
  for (let attempt = 0; attempt < 20 && page.get('session-list').children.length < 3; attempt++) await flush()
  page.get('session-list').children[2].children[0].fire('click')
  page.get('message-text').value = '冲突时保留'
  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && !/编号发生冲突/.test(page.get('model-hint').textContent); attempt++) await flush()
  assert.match(page.get('model-hint').textContent, /编号发生冲突/)
  assert.equal(page.get('message-text').value, '冲突时保留')
  const stored = JSON.parse(page.storage.get('weftmate:phone-sync-outbox:v1:owner-test:device-test')!)
  assert.equal(stored.event.payload.text, '冲突时保留')
  assert.equal(page.get('send-message').textContent, '核对并重试')
  assert.equal(visibleText(page.get('transcript')).includes('冲突时保留'), false)
})

test('default phone conversation titles use a short first-user summary while custom titles stay intact', async () => {
  const sourceDeviceId = 'device-phone'
  const first = 'conversation-00000000-0000-4000-8000-000000000001'
  const second = 'conversation-00000000-0000-4000-8000-000000000002'
  const third = 'conversation-00000000-0000-4000-8000-000000000003'
  const rows = [
    { seq: 1, conversationId: first, sourceDeviceId, kind: 'conversation.created', payload: { title: '新对话' } },
    { seq: 2, conversationId: first, sourceDeviceId, kind: 'message.created',
      payload: { role: 'user', text: '  打开手机设置并\n查看蓝牙状态  ' } },
    { seq: 3, conversationId: second, sourceDeviceId, kind: 'conversation.created', payload: { title: '旅行笔记' } },
    { seq: 4, conversationId: second, sourceDeviceId, kind: 'message.created',
      payload: { role: 'user', text: '这句不应覆盖自定义标题' } },
    { seq: 5, conversationId: third, sourceDeviceId, kind: 'message.created',
      payload: { role: 'user', text: '第三段手机本地记录，稍后再同步' } },
  ]
  const page = harness([], [], true, { syncAvailable: true, syncEvents: rows })
  for (let attempt = 0; attempt < 10 && page.get('assistant-view').hidden; attempt++) await flush()
  page.get('show-phone').fire('click')
  for (let attempt = 0; attempt < 10 && page.get('phone-conversations').children.length < 3; attempt++) await flush()
  const titles = page.get('phone-conversations').children.map((row) => row.children[0].children[0].textContent)
  assert.deepEqual(titles, ['打开手机设置并 查看蓝牙状态', '旅行笔记', '第三段手机本地记录，稍后再同步'])
  assert.equal(rows[0].payload.title, '新对话', 'display fallback leaves the synchronized event unchanged')
})

const profileFixture = () => ({
  A: { username: 'ProfileA', ownerId: 'profile-owner-a', displayName: '合成账户 A', avatar: null, profileRevision: 0 },
  B: { username: 'ProfileB', ownerId: 'profile-owner-b', displayName: '合成账户 B', avatar: null, profileRevision: 0 },
})

async function ready(page: ReturnType<typeof harness>) {
  for (let attempt = 0; attempt < 30 && page.get('assistant-view').hidden; attempt++) await flush()
  assert.equal(page.get('assistant-view').hidden, false)
}

async function openAccount(page: ReturnType<typeof harness>) {
  page.get('show-account').fire('click')
  for (let attempt = 0; attempt < 30 && page.get('profile-display-name').value === ''; attempt++) await flush()
  assert.equal(page.get('account-view').hidden, false)
}

test('account offers the official installer page and selected platform QR with graceful recovery', async () => {
  const page = harness([], [], false, { profileAccounts: profileFixture(), downloadAvailable: true })
  await ready(page)
  await openAccount(page)

  assert.match(accountHtml, /href="https:\/\/www\.weftmate\.com\/downloads\/"[^>]*>前往官网获取安装包/)
  assert.doesNotMatch(accountHtml, /id="(?:android-download|mac-download)"/)
  assert.equal(page.get('other-device-platform').value, 'android')
  assert.equal(page.get('other-device-qr').src, officialQrSvg('android'))
  assert.equal(page.get('other-device-platform-link').attributes.get('href'),
    'https://www.weftmate.com/downloads/?platform=android')
  assert.equal(page.requests.some((request) => request.url.endsWith('/native/manifest') ||
    request.url.endsWith('/downloads/android')), false)

  page.get('other-device-platform').value = 'macos'
  page.get('other-device-platform').fire('change')
  assert.equal(page.get('other-device-qr').src, officialQrSvg('macos'))
  assert.equal(page.get('other-device-platform-link').attributes.get('href'),
    'https://www.weftmate.com/downloads/?platform=macos')

  page.get('other-device-platform').value = 'ios'
  page.get('other-device-platform').fire('change')
  assert.equal(page.get('other-device-platform-status').textContent, 'iPhone安装方式准备中，可扫码查看官网信息。')
  assert.equal(page.get('other-device-qr').src, officialQrSvg('ios'))

  page.get('other-device-qr').fire('error')
  assert.equal(page.get('other-device-qr').hidden, true)
  assert.equal(page.get('other-device-qr-status').hidden, false)
  assert.equal(page.get('other-device-platform-link').attributes.get('href'),
    'https://www.weftmate.com/downloads/?platform=ios')

  page.get('other-device-platform').value = 'windows'
  page.get('other-device-platform').fire('change')
  assert.equal(page.get('other-device-platform-link').hidden, true)
  assert.equal(page.get('other-device-qr').hidden, true)
  assert.equal(page.get('other-device-platform-status').textContent, 'Windows 请使用网页版，前往官网查看。')

  page.get('other-device-platform').value = 'watchos'
  page.get('other-device-platform').fire('change')
  assert.equal(page.get('other-device-qr').src, officialQrSvg('watchos'))
  assert.equal(page.get('other-device-qr').hidden, false, 'selecting another target restores the QR display')
  page.get('other-device-install').open = true
  page.get('account-back').fire('click')
  assert.equal(page.get('other-device-platform').value, 'android', 'leaving account resets the selected target')
  assert.equal(page.get('other-device-install').open, false, 'leaving account closes the expanded QR area')
  await openAccount(page)
  page.get('other-device-platform').value = 'watchos'
  page.get('other-device-platform').fire('change')
  page.get('other-device-install').open = true
  page.get('logout-button').fire('click')
  for (let attempt = 0; attempt < 10 && page.get('account-view').hidden === false; attempt++) await flush()
  assert.equal(page.get('other-device-platform').value, 'android', 'logout resets the selected target')
  assert.equal(page.get('other-device-install').open, false, 'logout closes the expanded QR area')
})

async function switchToB(page: ReturnType<typeof harness>) {
  page.get('logout-button').fire('click')
  for (let attempt = 0; attempt < 30 && page.get('login-view').hidden; attempt++) await flush()
  assert.equal(page.get('login-view').hidden, false)
  page.get('login-name').value = 'ProfileB'
  page.get('login-password').value = 'synthetic password'
  page.get('login-device').value = '合成设备 B'
  page.get('login-form').fire('submit')
  await ready(page)
}

test('A pending phone text stays under A device key after B signs in', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000001'
  const page = harness([], [], false, { profileAccounts: profileFixture(), syncAvailable: true,
    uuidForSync: true, syncPost: 'timeout-no-commit', syncEvents: [
      { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '原手机对话' } },
    ] })
  await ready(page)
  for (let attempt = 0; attempt < 20 && page.get('session-list').children.length < 3; attempt++) await flush()
  page.get('session-list').children[2].children[0].fire('click')
  page.get('message-text').value = 'A 的待核对文字'
  page.get('message-form').fire('submit')
  const aKey = 'weftmate:phone-sync-outbox:v1:profile-owner-a:profile-device-A'
  for (let attempt = 0; attempt < 20 && !page.storage.has(aKey); attempt++) await flush()
  assert.equal(JSON.parse(page.storage.get(aKey)!).event.payload.text, 'A 的待核对文字')
  await switchToB(page)
  for (let attempt = 0; attempt < 20 && page.get('session-list').children.length < 3; attempt++) await flush()
  page.get('session-list').children[2].children[0].fire('click')
  assert.equal(page.get('message-text').value, '')
  assert.equal(page.get('send-message').textContent, '同步文字')
  assert.doesNotMatch(page.get('model-hint').textContent, /待核对/)
  assert.equal(page.storage.has(aKey), true)
  assert.equal(page.storage.has('weftmate:phone-sync-outbox:v1:profile-owner-b:profile-device-B'), false)
})

test('same owner on a new device recovers old text by checking the server before allowing a new send', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000001'
  const rows = [{ seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '恢复草稿' } }]
  const storage = new Map<string, string>()
  const first = harness([], [], false, { profileAccounts: profileFixture(), syncAvailable: true,
    uuidForSync: true, syncPost: 'timeout-no-commit', syncEvents: rows, storage })
  await ready(first)
  for (let attempt = 0; attempt < 20 && first.get('session-list').children.length < 3; attempt++) await flush()
  first.get('session-list').children[2].children[0].fire('click')
  first.get('message-text').value = '登录前的文字'
  first.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && !storage.has('weftmate:phone-sync-recovery:v1:profile-owner-a'); attempt++) await flush()
  const second = harness([], [], false, { profileAccounts: profileFixture(), syncAvailable: true,
    uuidForSync: true, deviceSuffix: '-renewed', syncEvents: rows, storage })
  await ready(second)
  for (let attempt = 0; attempt < 20 && second.get('session-list').children.length < 3; attempt++) await flush()
  second.get('session-list').children[2].children[0].fire('click')
  assert.equal(second.get('message-text').value, '登录前的文字')
  assert.equal(second.get('send-message').textContent, '核对旧请求')
  second.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && storage.has('weftmate:phone-sync-recovery:v1:profile-owner-a'); attempt++) await flush()
  assert.equal(second.get('message-text').value, '登录前的文字')
  assert.match(second.get('model-hint').textContent, /草稿已恢复/)
  assert.equal(second.requests.some((request) => request.url.endsWith('/sync/events') && request.options.method === 'POST'), false)
})

test('profile nickname uses revision, 409 refresh keeps the draft and updates the unedited avatar', async () => {
  const profiles = profileFixture()
  const page = harness([], [], false, { profileAccounts: profiles })
  await ready(page)
  await openAccount(page)
  page.get('profile-display-name').value = 'A的新昵称'
  page.get('profile-display-name').fire('input')
  profiles.A.avatar = { mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' }
  profiles.A.profileRevision++
  page.get('profile-form').fire('submit')
  for (let attempt = 0; attempt < 30 && page.get('profile-reload').hidden; attempt++) await flush()
  assert.equal(page.get('profile-reload').hidden, false, 'stale expectedRevision must expose conflict recovery')
  assert.equal(page.get('profile-display-name').value, 'A的新昵称')
  page.get('profile-reload').fire('click')
  for (let attempt = 0; attempt < 30 && !page.get('profile-error').hidden; attempt++) await flush()
  assert.equal(page.get('profile-display-name').value, 'A的新昵称', 'edited nickname remains a draft')
  assert.equal(page.get('profile-avatar-image').hidden, false, 'unedited avatar follows the latest server value')
  page.get('profile-form').fire('submit')
  await flush()
  const update = page.requests.filter((request) => request.url.endsWith('/auth/profile')).at(-1)!
  assert.equal(JSON.parse(update.options.body).expectedRevision, 1)
  assert.equal(JSON.parse(update.options.body).displayName, 'A的新昵称')
  assert.equal(Object.hasOwn(JSON.parse(update.options.body), 'avatar'), false)
})

test('late account fetch and avatar decode from A cannot change B after logout and switch', async () => {
  const profiles = profileFixture()
  const page = harness([], [], false, { profileAccounts: profiles })
  await ready(page)
  page.deferMe()
  page.get('show-account').fire('click')
  await flush()
  const waitingMe = page.requests.filter((request) => request.url.endsWith('/auth/me')).length
  assert.ok(waitingMe >= 2, 'A account view should have a pending profile read')
  const image = page.get('profile-avatar-image')
  const decode = deferred<void>()
  image.decodeHandler = () => decode.promise
  const bytes = Uint8Array.from(readFileSync(new URL('./fixtures/personal-access-profile/synthetic-avatar.png', import.meta.url)))
  const file = { type: 'image/png', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }
  page.get('profile-avatar-file').files = [file]
  page.get('profile-avatar-file').fire('change')
  for (let attempt = 0; attempt < 20 && page.objectUrls.created.length === 0; attempt++) await flush()
  assert.equal(page.objectUrls.created.length, 1, 'A avatar decoding should be pending')
  const oldAvatarUrl = page.objectUrls.created[0]
  await switchToB(page)
  await openAccount(page)
  assert.equal(page.get('profile-display-name').value, '合成账户 B')
  assert.equal(page.get('device-list').children.some((item) => item.dataset.deviceId === 'profile-old-device-a'), false)
  page.resolveMe({ error: { code: 'UNAUTHORIZED' } }, 401)
  decode.resolve()
  for (let attempt = 0; attempt < 20; attempt++) await flush()
  assert.equal(page.get('account-view').hidden, false, 'late A 401 must not log B out')
  assert.equal(page.get('profile-display-name').value, '合成账户 B')
  assert.equal(page.get('profile-avatar-image').hidden, true)
  assert.equal(page.get('profile-avatar-image').src, '')
  assert.equal(page.objectUrls.revoked.includes(oldAvatarUrl), true)
})

test('leaving and reopening the profile while save waits releases busy state and ignores the old response', async () => {
  const profiles = profileFixture()
  const page = harness([], [], false, { profileAccounts: profiles })
  await ready(page)
  await openAccount(page)
  page.get('profile-display-name').value = 'A的旧提交'
  page.get('profile-display-name').fire('input')
  page.deferProfilePatch()
  page.get('profile-form').fire('submit')
  await flush()
  assert.equal(page.get('profile-save').disabled, true)
  page.get('account-back').fire('click')
  await ready(page)
  await openAccount(page)
  page.get('profile-display-name').value = 'A的新草稿'
  page.get('profile-display-name').fire('input')
  assert.equal(page.get('profile-save').disabled, false, 'a later visit can start a fresh save')
  page.resolveProfilePatch({ account: { ...profiles.A, displayName: 'A的旧提交', profileRevision: 1 } })
  for (let attempt = 0; attempt < 20; attempt++) await flush()
  assert.equal(page.get('profile-display-name').value, 'A的新草稿')
  assert.equal(page.get('profile-save').disabled, false)
})

test('a password-change finally from A cannot clear B password fields after account switch', async () => {
  const profiles = profileFixture()
  const page = harness([], [], false, { profileAccounts: profiles })
  await ready(page)
  await openAccount(page)
  page.get('password-open').fire('click')
  page.get('current-password').value = 'synthetic old password'
  page.get('new-password').value = 'synthetic new password A'
  page.get('new-confirm').value = 'synthetic new password A'
  page.deferDevices()
  page.get('password-form').fire('submit')
  for (let attempt = 0; attempt < 20 && page.requests.filter((request) => request.url.endsWith('/auth/devices')).length < 2; attempt++) await flush()
  assert.equal(page.requests.filter((request) => request.url.endsWith('/auth/devices')).length, 2,
    'A password change should be waiting on its follow-up device refresh')
  await switchToB(page)
  await openAccount(page)
  page.get('password-open').fire('click')
  page.get('current-password').value = 'synthetic B current password'
  page.get('new-password').value = 'synthetic B new password'
  page.get('new-confirm').value = 'synthetic B new password'
  page.resolveDevices({ devices: [
    { id: 'profile-device-A', name: 'A device', createdAt: '2026-09-26T00:00:00.000Z', revoked: false },
  ] })
  for (let attempt = 0; attempt < 20; attempt++) await flush()
  assert.equal(page.get('current-password').value, 'synthetic B current password')
  assert.equal(page.get('new-password').value, 'synthetic B new password')
  assert.equal(page.get('new-confirm').value, 'synthetic B new password')
})
