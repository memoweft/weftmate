import { desktopFeatureSource, desktopHtml, mountDesktopTestTree } from './helpers/desktop-ui-source.mjs'
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
const source = desktopFeatureSource()
const executableSource = source.replace("import('./file-sha256.js')",
  'Promise.resolve({ hashBlobSha256: globalThis.__weftmateTestHashBlobSha256 })')
assert.notEqual(executableSource, source, 'the attachment test harness replaces only the browser module loader')
const accountHtml = desktopHtml()
const styles = readFileSync(join(repository, 'src', 'personal-access-ui', 'styles.css'), 'utf8')
// Accessible metadata comes from the assembled production markup, not a DOM position.
const controlMetadata = new Map<string, { role: string; name: string }>()
for (const match of accountHtml.matchAll(/<(input|textarea|select|button)\b([^>]*)>/g)) {
  const [, tag, attributes] = match, id = /\bid="([^"]+)"/.exec(attributes)?.[1]
  if (!id) continue
  const content = tag === 'input' ? '' : accountHtml.slice(match.index! + match[0].length).split(`</${tag}>`)[0]
  const label = new RegExp(String.raw`<label[^>]*for="${id}"[^>]*>([\s\S]*?)<\/label>`).exec(accountHtml)?.[1]
  const name = /\baria-label="([^"]+)"/.exec(attributes)?.[1] || label || content
  controlMetadata.set(id, { role: tag === 'button' ? 'button' : tag === 'select' ? 'combobox' : /type="search"/.test(attributes) ? 'searchbox' : 'textbox', name: name.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() })
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const qrDataDeclaration = source.match(/const publicPlatformQrData = Object\.freeze\((\{[\s\S]*?\n\s*\})\)/)
assert.ok(qrDataDeclaration, 'the standard platform QR assets are kept in the desktop component assets')
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
  tagName: string
  ownerDocument: { body: Element; activeElement: Element } | null = null
  root = false
  children: Element[] = []
  listeners = new Map<string, Array<(event: any) => unknown>>()
  hidden = false
  disabled = false
  checked = false
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
  focusOptions: { preventScroll?: boolean } | undefined
  scrollTop = 0
  decodeHandler: (() => Promise<void>) | null = null
  classList = { add() {}, remove() {}, toggle() {}, contains: (value: string) => this.className.split(/\s+/).includes(value) }
  constructor(id = '', tagName = 'div') { this.id = id; this.tagName = tagName.toUpperCase() }
  addEventListener(name: string, listener: (event: any) => unknown) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }
  fire(name: string, extra: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(name) ?? []) listener({ currentTarget: this, target: this, preventDefault() {}, ...extra })
  }
  dispatchEvent(event: Event) { this.fire(event.type); return true }
  append(...children: Element[]) { for (const child of children) child.parentNode = this; this.children.push(...children) }
  prepend(...children: Element[]) { for (const child of children) child.parentNode = this; this.children.unshift(...children) }
  replaceChildren(...children: Element[]) { for (const child of [...this.children]) child.remove(); this.children = []; this.append(...children) }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  removeAttribute(name: string) { this.attributes.delete(name); if (name === 'src') this.src = '' }
  decode() { return this.decodeHandler ? this.decodeHandler() : Promise.resolve() }
  focus(options?: { preventScroll?: boolean }) {
    if (!this.isConnected) return
    if (this.ownerDocument) { this.ownerDocument.activeElement.focused = false; this.ownerDocument.activeElement = this }
    this.focused = true; this.focusOptions = options
  }
  getBoundingClientRect() { return { left: 16, right: 366, top: 680, bottom: 724 } }
  querySelectorAll(selector = ''): Element[] {
    return this.children.flatMap((child) => [
      ...(matchesTestSelector(child, selector) ? [child] : []), ...child.querySelectorAll(selector),
    ])
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null }
  closest(selector: string): Element | null { return selector.split(',').some(part => matchesTestSelector(this, part.trim())) ? this : this.parentNode?.closest(selector) ?? null }
  contains(node: Element | null): boolean { return !!node && (node === this || this.children.some((child) => child.contains(node))) }
  get isConnected(): boolean { return this.root || this.parentNode?.isConnected === true }
  close() { this.open = false; if (this.ownerDocument && this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body; this.fire('close') }
  showModal() { this.open = true; this.focus() }
  reset() { this.value = '' }
  open = false
  parentNode: Element | null = null
  get parentElement() { return this.parentNode }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null }
  insertBefore(child: Element, next: Element | null) {
    child.remove()
    const index = next ? this.children.indexOf(next) : -1
    child.parentNode = this
    if (index < 0) this.children.push(child)
    else this.children.splice(index, 0, child)
  }
  before(...nodes: Element[]) { for (const node of nodes) this.parentNode?.insertBefore(node, this) }
  after(...nodes: Element[]) { const next = this.nextSibling; for (const node of nodes) this.parentNode?.insertBefore(node, next) }
  remove() {
    if (this.ownerDocument && this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((item) => item !== this)
    this.parentNode = null
  }
}

function matchesTestSelector(node: Element, selector: string) {
  if (selector === 'dialog[open]') return node.tagName === 'DIALOG' && node.open
  if (/^(button|form|pre|a|textarea|img)$/.test(selector)) return node.tagName === selector.toUpperCase()
  if (selector.startsWith('.')) return node.className.split(' ').includes(selector.slice(1))
  if (selector === '[data-conversation-task], [data-conversation-approval], [data-conversation-question]') return !!(node.dataset.conversationTask || node.dataset.conversationApproval || node.dataset.conversationQuestion)
  if (selector === 'details') return node.tagName === 'DETAILS'
  if (selector === 'button.secondary.small') return node.tagName === 'BUTTON' &&
    ['secondary', 'small'].every((name) => node.className.split(' ').includes(name))
  const bare = /^\[data-conversation-(task|approval|question)\]$/.exec(selector)
  if (bare) return !!node.dataset[`conversation${bare[1][0].toUpperCase() + bare[1].slice(1)}`]
  const data = /^\[data-conversation-(task|approval|question)(-action)?="([^"]+)"\]$/.exec(selector)
  return !!data && node.dataset[`conversation${data[1][0].toUpperCase() + data[1].slice(1)}${data[2] ? 'Action' : ''}`] === data[3]
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
    systemRead?: object; restartRead?: (url: string, options: any) => Promise<ReturnType<typeof reply>>;
    abortSignal?: { timeout: (ms: number) => AbortSignal };
    accountModels?: object[]; accountModelWrite?: (url: string, options: any) => object;
    accountModelByRequest?: Record<string, object>;
    syncPost?: 'timeout-no-commit' | 'timeout-committed' | 'conflict'; uuidForSync?: boolean; deviceSuffix?: string;
    configured?: boolean; authenticated?: boolean; setupGrant?: string; statusOffline?: boolean;
    profileAccounts?: Record<string, any>; initialProfileOwner?: string;
    pendingDevices?: Record<string, any[]>;
    taskDetails?: Record<string, object>; sourceDetails?: Record<string, object>;
    artifactPreviews?: Record<string, object | { error: { code: string }; status: number }>;
    deferTaskDetail?: boolean; taskPollTimers?: boolean;
    deferOriginalAttachment?: boolean;
    failOriginalAttachmentOnce?: boolean;
    approvals?: Record<string, any[]>;
    approvalRead?: (url: string, options: any) => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>;
    approvalDecide?: (url: string, options: any) => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>;
    questions?: Record<string, any[]>;
    questionRead?: (url: string, options: any) => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>;
    questionAnswer?: (url: string, options: any) => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>;
  } = {}) {
  const nodes = new Map<string, Element>()
  let focusDocument: { body: Element; activeElement: Element } | null = null
  const get = (id: string) => {
    if (!nodes.has(id)) { const node = new Element(id, id.endsWith('-dialog') ? 'dialog' : 'div');
      node.root = true; node.ownerDocument = focusDocument; nodes.set(id, node) }
    return nodes.get(id)!
  }
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
  let intervalId = 0
  const refreshTicks = new Map<number, () => void>()
  const fetch = (url: string, options: any = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/system') && config.systemRead) return Promise.resolve(reply(config.systemRead))
    if (url.endsWith('/settings/models')) return Promise.resolve(reply({ backgroundModelProfileId: null }))
    if (/\/system\/(model|host|memory)\/restart$/.test(url) && config.restartRead) return config.restartRead(url, options)
    if (url.endsWith('/cloud/devices/pending')) return Promise.resolve(reply({ devices: config.pendingDevices?.[profileOwner] ?? [] }))
    if (/\/cloud\/devices\/[^/]+\/decision$/.test(url) && options.method === 'POST') {
      const id = url.split('/').at(-2)
      const devices = config.pendingDevices?.[profileOwner] ?? []
      const index = devices.findIndex(device => device.id === id)
      if (index >= 0) devices.splice(index, 1)
      return Promise.resolve(reply({ decision: JSON.parse(options.body).decision }))
    }
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
    if (url.endsWith('/status') && config.statusOffline) return Promise.reject(new Error('synthetic status disconnect'))
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
    if (url.endsWith('/settings/personalization')) return Promise.resolve(reply({}));
    if (url.endsWith('/models')) return Promise.resolve(reply({ models: config.modelCatalog ??
      [{ id: 'model-test', name: 'Synthetic', configured: true }] }))
    if (/\/sessions\/[^/]+\/metadata$/.test(url) && options.method === 'PATCH') return Promise.resolve(reply(JSON.parse(options.body)))
    if (url.endsWith('/projects') && options.method !== 'POST') return Promise.resolve(reply({ projects: [], canManage: true }))
    if (url.split('?')[0].endsWith('/sessions')) return Promise.resolve(reply({ sessions: config.sessions ?? [
      { sessionId: 'A', title: 'A', sendAvailable: true, running: aRunning }, { sessionId: 'B', title: 'B', sendAvailable: true },
    ] }))
    if (/\/sessions\/[^/]+\/approvals\//.test(url) && options.method === 'POST') return Promise.resolve(
      config.approvalDecide?.(url, options) ?? reply({ error: { code: 'NOT_FOUND' } }, 404))
    if (/\/sessions\/[^/]+\/approvals\?/.test(url)) {
      if (config.approvalRead) return Promise.resolve(config.approvalRead(url, options))
      const parsed = new URL(url, 'http://local.test'), sessionId = parsed.pathname.split('/').at(-2)!
      const before = parsed.searchParams.get('before'), all = config.approvals?.[sessionId] ?? []
      const start = before ? all.findIndex((row) => row.approvalId === before) + 1 : 0
      const approvals = all.slice(start, start + Number(parsed.searchParams.get('limit') || 50))
      const hasMore = start + approvals.length < all.length
      return Promise.resolve(reply({ approvals: approvals.map((row) => ({ ...row })), nextBefore: hasMore ? approvals.at(-1).approvalId : null, hasMore }))
    }
    if (/\/sessions\/[^/]+\/questions\//.test(url) && options.method === 'POST') return Promise.resolve(
      config.questionAnswer?.(url, options) ?? reply({ error: { code: 'NOT_FOUND' } }, 404))
    if (/\/sessions\/[^/]+\/questions\?/.test(url)) {
      if (config.questionRead) return Promise.resolve(config.questionRead(url, options))
      const parsed = new URL(url, 'http://local.test'), sessionId = parsed.pathname.split('/').at(-2)!
      const before = parsed.searchParams.get('before'), all = config.questions?.[sessionId] ?? []
      const start = before ? all.findIndex((row) => row.questionRpcId === before) + 1 : 0
      const questions = all.slice(start, start + Number(parsed.searchParams.get('limit') || 50))
      const hasMore = start + questions.length < all.length
      return Promise.resolve(reply({ questions: questions.map((row) => ({ ...row })), nextBefore: hasMore ? questions.at(-1).questionRpcId : null, hasMore }))
    }
    if (url.includes('/sessions/') && url.includes('/events?')) {
      const id = url.includes('/sessions/A/') ? 'A' : 'B'
      if (deferHistory) { const wait = deferred<ReturnType<typeof reply>>(); history[id].push(wait); return wait.promise }
      const query = new URL(url, 'http://local.test').searchParams
      const after = query.has('afterSeq') ? Number(query.get('afterSeq')) : null
      const before = query.has('beforeSeq') ? Number(query.get('beforeSeq')) : null
      const rows = id === 'A' ? durableEvents : []
      const limit = config.eventPageSize ?? Number(query.get('limit') || 100)
      const remaining = rows.filter(entry => after !== null ? entry.seq > after : before === null || entry.seq < before)
      const events = after !== null ? remaining.slice(0, limit) : remaining.slice(-limit)
      return Promise.resolve(reply({ events, nextSeq: after !== null ? events.at(-1)?.seq ?? after : rows.at(-1)?.seq ?? -1,
        hasMore: after !== null && remaining.length > events.length, nextBeforeSeq: events[0]?.seq ?? null,
        hasOlder: after === null && remaining.length > events.length, latestSeq: rows.at(-1)?.seq ?? -1 }))
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
  const body = get('body')
  const document = { body, activeElement: body, visibilityState: 'visible', getElementById: get,
    createElementNS: (_namespace: string, tagName: string) => { const node = new Element('', tagName); node.ownerDocument = document; return node },
    createElement: (tagName: string) => { const node = new Element('', tagName); node.ownerDocument = document; return node },
    querySelector: (selector: string): Element | null => {
      if (selector === 'dialog[open]') return [...nodes.values()].find((node) => matchesTestSelector(node, selector)) ?? null
      const task = /^(\[data-conversation-task="[^"]+"\]) button\.secondary\.small$/.exec(selector)
      if (task) return get('transcript').querySelector(task[1])?.querySelector('button.secondary.small') ?? null
      const approval = /^(\[data-conversation-approval="[^"]+"\]) (\[data-conversation-approval-action="[^"]+"\])$/.exec(selector)
      if (approval) return get('transcript').querySelector(approval[1])?.querySelector(approval[2]) ?? null
      const question = /^(\[data-conversation-question="[^"]+"\]) (\[data-conversation-question-action="[^"]+"\])$/.exec(selector)
      if (question) return get('transcript').querySelector(question[1])?.querySelector(question[2]) ?? null
      return get('badge')
    }, querySelectorAll: () => [], addEventListener() {} }
  focusDocument = document
  for (const node of nodes.values()) node.ownerDocument = document
  // Build the static element tree from production markup so component mounting
  // sees real parents without baking layout positions into behavior assertions.
  mountDesktopTestTree(document, get)
  const location = { hash: config.setupGrant ? `#setup=${config.setupGrant}` : '',
    pathname: '/personal/v1/ui', search: '', protocol: 'http:' }
  const window = { location, innerWidth: 1280, innerHeight: 820, history: { replaceState() {} }, addEventListener() {}, WeftIcons: null as any }
  const URLShim = class extends URL {}
  URLShim.createObjectURL = (_file: object) => { const value = `blob:synthetic-${objectUrls.created.length + 1}`; objectUrls.created.push(value); return value }
  URLShim.revokeObjectURL = (value: string) => { objectUrls.revoked.push(value) }
  const context = { document, window, location, fetch, URL: URLShim, localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) }, removeItem: (key: string) => { storage.delete(key) } },
  TextEncoder, TextDecoder, Blob, File, AbortController, DOMException, queueMicrotask, Event,
  Option: class extends Element { constructor(text: string, value: string) { super('', 'option'); this.textContent = text; this.value = value } },
  __weftmateTestHashBlobSha256: hashBlobSha256, crypto: { randomUUID: () => config.uuidForSync
    ? `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}` : `request-${++sequence}` }, AbortSignal: config.abortSignal ?? AbortSignal, Intl, Date, btoa,
   setTimeout: (callback: () => void, delay: number) => {
     const id = ++timerId
     if (config.taskPollTimers && delay === 2_000) taskTimers.set(id, callback)
     return id
   }, clearTimeout(id: number) { taskTimers.delete(id) }, setInterval: (callback: () => void) => { const id=++intervalId;refreshTicks.set(id,callback);return id }, clearInterval(id: number) { refreshTicks.delete(id) } }
  runInNewContext(readFileSync(join(repository, 'src/personal-access-ui/icons.js'), 'utf8') + '\nwindow.WeftIcons = globalThis.WeftIcons;', context)
  runInNewContext(readFileSync(join(repository, 'src/personal-access-ui/timeline.js'), 'utf8'), context)
  runInNewContext(executableSource.replace('    ui.loadAttachmentHasher', '    globalThis.__testCore = core;\n    ui.loadAttachmentHasher'), context)
  const named = (label: string, name: string | RegExp) => typeof name === 'string' ? label === name : name.test(label);
  const dynamicButtons = () => get('session-list').querySelectorAll('button');
  const buttonName = (node: Element) => node.attributes.get('aria-label') || visibleText(node).trim();
  const conversationButtons = () => {
    const names = new Set([...(config.sessions ?? [{title:'A'},{title:'B'}]).map(row=>row.title),
      ...(config.syncEvents ?? []).filter((row:any)=>row.kind==='conversation.created').map((row:any)=>row.payload.title)]);
    return dynamicButtons().filter(node=>names.has(buttonName(node)));
  };
  const getByRole = (role: string, { name }: { name: string | RegExp }) => {
    const matches = [...controlMetadata].filter(([id, control]) => control.role === role && named(get(id).getAttribute('aria-label')||control.name,name)).map(([id])=>get(id));
    if(role==='button')matches.push(...dynamicButtons().filter(node=>named(buttonName(node),name)));
    assert.equal(matches.length, 1, `one ${role} named ${name}`);
    return matches[0];
  }
  return { core: runInNewContext('globalThis.__testCore', context), get, getByRole, conversationButtons, document, requests, storage, history, objectUrls, setDeferHistory: (value: boolean) => { deferHistory = value },
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
    tick: () => { for(const callback of [...refreshTicks.values()])callback() },
    resolvePost: (value: object) => { pendingPost?.resolve(reply(value)); pendingPost = null },
    rejectPost: () => { pendingPost?.reject(new Error('synthetic disconnect')); pendingPost = null } }
}

function visibleText(node: Element): string {
  return [node.textContent, ...node.children.map(visibleText)].join(' ')
}

test('FIX-8 named new conversation and session entries leave phone mode and discard old pagination', async () => {
  const conversationId='conversation-00000000-0000-4000-8000-000000000099';
  const page=harness([],[],false,{syncAvailable:true,syncEvents:[
    {seq:1,conversationId,sourceDeviceId:'device-phone',kind:'conversation.created',payload:{title:'合成手机记录'}},
    {seq:2,conversationId,sourceDeviceId:'device-phone',kind:'message.created',payload:{messageId:'message-00000000-0000-4000-8000-000000000099',role:'user',text:'旧手机文字'}},
  ]});
  for(let n=0;n<20&&page.conversationButtons().length!==3;n++)await flush();
  page.getByRole('button',{name:'合成手机记录'}).fire('click');await flush();
  assert.equal(page.getByRole('textbox',{name:'输入消息'}).placeholder,'补充到这条手机对话');
  Object.assign(page.core.state,{hasOlder:true,nextBeforeSeq:20,olderLoading:true});
  page.getByRole('button',{name:/^新对话/}).fire('click');await flush();
  assert.equal(page.core.state.activeChatSource,'desktop');assert.equal(page.core.state.selectedPhoneConversationId,null);
  assert.equal(page.core.state.selectedSessionId,null);assert.equal(page.core.state.newConversation,true);
  assert.equal(page.getByRole('textbox',{name:'输入消息'}).placeholder,'向 WeftMate 说说你的目标');
  assert.equal(page.get('load-older').hidden,true);assert.equal(page.get('attachment-add').hidden,false);
  page.getByRole('button',{name:'A'}).fire('click');await flush();
  assert.equal(page.get('assistant-title').textContent,'A');assert.equal(page.core.state.selectedSessionId,'A');
  assert.equal(page.core.state.activeChatSource,'desktop');assert.equal(page.core.state.newConversation,false);
});

test('model menu preserves the draft, selects a configured model and opens existing account settings', async () => {
  const page = harness([], [], false, { modelCatalog: [
    { id: 'local-model', name: '本地模型', configured: true },
    { id: 'cloud-model', name: '云端模型', configured: true },
    { id: 'unconfigured', name: '未配置模型', configured: false },
  ] })
  for (let attempt = 0; attempt < 20 && page.get('model-label').textContent !== '本地模型'; attempt++) await flush()
  page.getByRole('textbox', { name: '输入消息' }).value = '继续我的目标'
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
  assert.equal(page.getByRole('textbox', { name: '输入消息' }).value, '继续我的目标')
  assert.equal(page.requests.filter(({ options }) => options.method === 'POST').length, 0)
  page.get('model-trigger').fire('click')
  assert.equal(page.get('model-options').children[1].getAttribute('aria-selected'), 'true')
  page.getByRole('button', { name: '配置模型' }).fire('click')
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
  page.getByRole('textbox', { name: '输入消息' }).value = '请读取标记并保留原件。'
  page.getByRole('textbox', { name: '输入消息' }).fire('input')
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
  page.resolvePost({ command: { ...command, commandId: 'cmd-file-stage15', state: 'accepted_by_dsh' } })
  for (let attempt = 0; attempt < 20 && page.get('attachment-draft-list').children.length; attempt++) await flush()
  assert.equal(page.get('attachment-draft-list').children.length, 0)
  assert.equal(page.getByRole('textbox', { name: '输入消息' }).value, '')
})

test('switching sessions aborts a late original upload and keeps the file only in its original draft', async () => {
  const page = harness([], [], false, { deferOriginalAttachment: true })
  for (let attempt = 0; attempt < 20 && page.get('assistant-view').hidden; attempt++) await flush()
  const file = new File(['scope check'], 'scope.txt', { type: 'text/plain', lastModified: 7 })
  page.get('message-attachments').files = [file]
  page.get('message-attachments').fire('change')
  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 40 && !page.requests.some((request) => request.url.includes('/sync/attachments/')); attempt++) await flush()
  page.getByRole('button',{name:'B'}).fire('click')
  for (let attempt = 0; attempt < 20 && page.get('assistant-title').textContent !== 'B'; attempt++) await flush()
  assert.equal(page.get('attachment-draft-list').children.length, 0)
  assert.equal(page.requests.some((request) => request.url.endsWith('/commands') && request.options.method === 'POST'), false)
  page.getByRole('button',{name:'A'}).fire('click')
  for (let attempt = 0; attempt < 20 && page.get('assistant-title').textContent !== 'A'; attempt++) await flush()
  assert.equal(page.get('attachment-draft-list').children.length, 1)
  // The title updates before async history/draft restoration completes.
  for (let attempt = 0; attempt < 20 && page.get('send-message').disabled; attempt++) await flush()
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
  assert.equal(page.getByRole('button',{name:'停止回复'}).disabled, false, 'a running turn can still be stopped while another POST waits')
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
  void page.core.submitCommand('session.create', {modelProfileId:'local'})
  await flush()
  page.resolvePost({ command })
  tasks.push(command)
  for (let attempt = 0; attempt < 10 && !page.storage.get('weftmate:requests:v1:owner-test')?.includes('cmd-create'); attempt++) await flush()
  assert.equal(page.get('assistant-title').textContent, 'A')
  assert.equal(page.getByRole('button', { name: /新对话/ }).disabled, true, 'pending create cannot be repeated with a new ID')
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
    void page.core.submitCommand('session.create', {modelProfileId:'local'})
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
  for (let attempt = 0; attempt < 10 && page.conversationButtons().length === 0; attempt++) await flush()
  assert.equal(page.conversationButtons().length, 2)
  page.setDeferHistory(true)
  const [a, b] = [page.getByRole('button',{name:'A'}),page.getByRole('button',{name:'B'})]
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















test('synthetic conversation progress attaches to the exact dotted RPC receipt and aggregates only its own tool sources', async () => {
  const source = { commandId: 'root-inline', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A', receiptId: 'rpc:root.1' }
  const follow = { commandId: 'follow-inline', kind: 'session.message', rootTaskId: source.commandId,
    state: 'accepted_by_dsh', taskAction: 'supplement', sessionId: 'A', receiptId: 'rpc:follow.2' }
  const step = { executionId: 'exec-inline-one', toolName: 'pwsh', state: 'completed',
    sourceCommandId: source.commandId, sourceReceiptId: source.receiptId, jobId: 'job-one', jobState: 'running' }
  const task = { taskId: source.commandId, sessionId: 'A', source, artifacts: [], supplements: [follow],
    replyEvidence: { status: 'completed', assistantMessages: 1 }, control: { state: 'active' }, executionSteps: [step,
      { ...step, executionId: 'exec-inline-two', toolName: 'read', jobId: undefined, jobState: undefined,
        sourceCommandId: follow.commandId, sourceReceiptId: follow.receiptId },
      { ...step, executionId: 'exec-foreign', toolName: 'grep', sourceCommandId: 'foreign', sourceReceiptId: source.receiptId }] }
  const page = harness([follow, source], [
    { seq: 0, type: 'user.message', data: { text: '相同的目标', receiptId: source.receiptId } },
    { seq: 1, type: 'assistant.message', data: { text: '先观察结果，再核对你的目标。' } },
    { seq: 2, type: 'user.message', data: { text: '相同的目标', receiptId: 'rpc:other.3' } },
  ], false, { taskDetails: { [source.commandId]: task } })
  await flush()
  page.tick() // The existing refresh reads roots after the command list has loaded.
  for (let i = 0; i < 30 && !page.get('transcript').children.some((row) => row.dataset.conversationTask); i++) await flush()
  const rows = page.get('transcript').children
  const card = rows.find((row) => row.dataset.conversationTask === source.commandId)!
  assert.ok(card)
  assert.equal(rows[0].dataset.receiptId, source.receiptId)
  assert.equal(rows[1], card, 'progress belongs to the exact receipt, even when message text repeats')
  assert.match(visibleText(card), /运行命令 · 后台运行中.*读取文件 · 执行结束/)
  assert.doesNotMatch(visibleText(card), /搜索内容|目标已完成|已核验|rpc:|exec-/)
  assert.equal(page.requests.some((row) => row.url.endsWith('/tasks/follow-inline')), false)
  card.children.at(-1)!.children[0].fire('click')
  await flush()
  assert.ok(card.querySelector('.timeline-task-info'))
  assert.doesNotMatch(accountHtml, /task-detail-dialog|tasks-pane/)
  assert.equal(page.requests.filter((row) => row.options.method === 'POST').length, 0)
})

async function task15NarrowPage(config: NonNullable<Parameters<typeof harness>[3]> = {}) {
  const command = { commandId: 'root-narrow', kind: 'session.message', state: 'accepted_by_dsh',
    sessionId: 'A', receiptId: 'rpc:narrow.1' }
  const task: Record<string, any> = { taskId: command.commandId, sessionId: 'A', source: command, artifacts: [],
    executionSteps: [{ executionId: 'exec-narrow', toolName: 'pwsh', state: 'running',
      sourceCommandId: command.commandId, sourceReceiptId: command.receiptId }],
    control: { state: 'active', canStop: true, canSupplement: true, canResume: false }, replyEvidence: { status: 'streaming' } }
  const taskDetails = { [command.commandId]: task }
  const page = harness([command], [{ seq: 0, type: 'user.message', data: { text: '核对当前目标', receiptId: command.receiptId } }],
    false, { ...config, profileAccounts: profileFixture(), taskDetails })
  await ready(page)
  for (let i = 0; i < 30 && !task15NarrowCard(page); i++) await flush()
  assert.ok(task15NarrowCard(page), 'the receipt-bound progress card exists')
  return { page, task, taskDetails, command }
}

test('ordinary text replies never produce a tool card from running, terminal or source-only metadata', async () => {
  for (const state of ['active', 'completed', 'stopped']) {
    const command = { commandId: `text-${state}`, kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A', receiptId: `rpc:text.${state}` }
    const task = { taskId: command.commandId, sessionId: 'A', source: command, artifacts: [], executionSteps: [],
      sources: [{ kind: 'memory', title: '合成背景记忆' }], control: { state, canStop: state === 'active' },
      replyEvidence: { status: state === 'active' ? 'streaming' : 'completed', assistantMessages: 1 } }
    const page = harness([command], [{ seq: 0, type: 'user.message', data: { text: '你好', receiptId: command.receiptId } },
      { seq: 1, type: 'assistant.message', data: { text: '你好！' } }], state === 'active', { taskDetails: { [command.commandId]: task } })
    await ready(page); for (let i = 0; i < 20; i++) await flush()
    assert.equal(page.get('transcript').children.some(row => row.dataset.conversationTask), false, state)
    assert.match(visibleText(page.get('transcript')), /你好！/)
  }
})

test('orphan stop observation ends its progress without inventing history or hiding a newer unrelated turn', async () => {
  const command = { commandId: 'orphan-root', kind: 'session.message', state: 'accepted_by_dsh',
    sessionId: 'A', receiptId: 'rpc:orphan.1', dshTurn: 1 }
  const task = { taskId: command.commandId, sessionId: 'A', source: command, artifacts: [], executionSteps: [],
    control: { state: 'stop_requested', stopStatus: 'completed', canResume: true }, supplements: [], resumes: [] }
  const events = [
    { seq: 0, type: 'turn.started', data: { turn: 1 } },
    { seq: 1, type: 'user.message', data: { text: '合成遗留停止', receiptId: command.receiptId } },
    { seq: 2, type: 'step.started', data: { taskId: 'turn-1', turn: 1, stepId: 'read-1', toolName: 'read', summary: '读取文件：synthetic.txt' } },
    { seq: 3, type: 'step.completed', data: { taskId: 'turn-1', turn: 1, stepId: 'read-1', toolName: 'read', summary: '读取文件：synthetic.txt', state: 'completed' } },
  ]
  const page = harness([command], events, true, { taskDetails: { [command.commandId]: task } })
  await ready(page)
  for (let i = 0; i < 30 && !page.get('timeline-status').textContent.includes('已结束'); i++) await flush()
  assert.match(page.get('timeline-status').textContent, /^已结束/)
  const progress = page.get('transcript').children.find((row: any) => row.dataset.timeline === 'steps-2')
  assert.ok(progress)
  assert.match(visibleText(progress), /读取了 1 个文件.*已结束/)
  assert.equal(progress.dataset.running, 'false')
  assert.equal(events.some(event => event.type === 'turn.ended'), false)
  events.push({ seq: 4, type: 'turn.started', data: { turn: 2 } },
    { seq: 5, type: 'user.message', data: { text: '新的无关目标', receiptId: 'rpc:other.2' } })
  page.tick()
  for (let i = 0; i < 30 && page.get('timeline-status').textContent.includes('已结束'); i++) await flush()
  assert.equal(page.get('timeline-status').hidden, true, 'old terminal evidence cannot hide the new running turn')
})

function task15NarrowCard(page: ReturnType<typeof harness>) {
  return page.get('transcript').children.find((row) => row.dataset.conversationTask === 'root-narrow')
}

async function task15NarrowClose(page: ReturnType<typeof harness>) {
  const trigger = task15NarrowCard(page)!.querySelector('button.secondary.small')!
  trigger.focus(); trigger.fire('click'); await flush(); trigger.fire('click'); await flush()
  assert.equal(page.document.activeElement, trigger)
}

async function task15NarrowRefresh(page: ReturnType<typeof harness>, task: Record<string, any>) {
  const card = task15NarrowCard(page)!, signature = card.dataset.signature
  task.replyEvidence = { status: 'aborted', assistantMessages: 1 }
  page.tick()
  for (let i = 0; i < 20 && card.dataset.signature === signature; i++) await flush()
  assert.notEqual(card.dataset.signature, signature, 'one background refresh changed the payload signature')
}



test('task15-narrow task refresh respects an input or another button chosen after close', async () => {
  for (const targetId of ['message-text', 'show-account']) {
    const { page, task } = await task15NarrowPage()
    await task15NarrowClose(page)
    const target = page.get(targetId); target.focus()
    await task15NarrowRefresh(page, task)
    assert.equal(page.document.activeElement, target, `refresh keeps the user's focus on ${targetId}`)
  }
})

test('task15-narrow task refresh respects another open dialog', async () => {
  const { page, task } = await task15NarrowPage()
  await task15NarrowClose(page)
  const dialog = page.get('revoke-dialog'); dialog.showModal()
  await task15NarrowRefresh(page, task)
  assert.equal(dialog.open, true)
  assert.equal(page.document.activeElement, dialog, 'an open dialog retains protected focus')
})

test('task15-narrow late task refresh cannot reclaim focus after switching sessions', async () => {
  const { page, task } = await task15NarrowPage()
  await task15NarrowClose(page)
  const oldEntry = page.document.activeElement
  page.deferOneTaskDetail(); page.tick(); await flush()
  page.getByRole('button',{name:'B'}).fire('click'); await flush()
  page.getByRole('textbox', { name: '输入消息' }).focus()
  page.resolveTaskDetail({ ...task, replyEvidence: { status: 'aborted' } }); await flush()
  assert.equal(page.get('assistant-title').textContent, 'B')
  assert.equal(oldEntry.isConnected, false)
  assert.equal(page.document.activeElement, page.getByRole('textbox', { name: '输入消息' }))
  assert.equal(task15NarrowCard(page), undefined)
})

test('task15-narrow late task refresh cannot reclaim focus after switching account identity', async () => {
  const { page, task } = await task15NarrowPage()
  await task15NarrowClose(page)
  const oldEntry = page.document.activeElement
  page.deferOneTaskDetail(); page.tick(); await flush()
  await switchToB(page)
  page.getByRole('textbox', { name: '输入消息' }).focus()
  page.resolveTaskDetail({ ...task, replyEvidence: { status: 'aborted' } }); await flush()
  assert.equal(oldEntry.isConnected, false)
  assert.equal(page.document.activeElement, page.getByRole('textbox', { name: '输入消息' }))
  assert.equal(page.get('account-name').textContent, 'ProfileB')
})

test('task15-narrow late task refresh cannot reclaim focus after switching to the phone source', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000010'
  const { page, task } = await task15NarrowPage({ syncAvailable: true, syncEvents: [
    { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '另一来源' } },
    { seq: 2, conversationId, sourceDeviceId: 'device-phone', kind: 'message.created', payload: {
      messageId: 'message-00000000-0000-4000-8000-000000000011', role: 'user', text: '手机原消息' } },
  ] })
  await task15NarrowClose(page)
  const oldEntry = page.document.activeElement
  page.deferOneTaskDetail(); page.tick(); await flush()
  const phone = page.getByRole('button',{name:'另一来源'})
  assert.ok(phone); phone.fire('click'); await flush()
  page.getByRole('textbox', { name: '输入消息' }).focus()
  page.resolveTaskDetail({ ...task, replyEvidence: { status: 'aborted' } }); await flush()
  assert.match(page.get('assistant-title').textContent, /另一来源/)
  assert.equal(oldEntry.isConnected, false)
  assert.equal(page.document.activeElement, page.getByRole('textbox', { name: '输入消息' }))
  assert.equal(task15NarrowCard(page), undefined)
})

test('synthetic ordinary chat and invalid receipt IDs never acquire a tool progress card', async () => {
  for (const receiptId of ['rpc:plain.1', 'invalid receipt', 'x'.repeat(161)]) {
    const source = { commandId: 'plain', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A', receiptId }
    const executionSteps = receiptId === 'rpc:plain.1' ? [] : [{ executionId: 'execution', toolName: 'pwsh', state: 'completed',
      sourceCommandId: source.commandId, sourceReceiptId: receiptId }]
    const page = harness([source], [{ seq: 0, type: 'user.message', data: { text: '普通对话', receiptId } }], false,
      { taskDetails: { plain: { taskId: 'plain', sessionId: 'A', source, artifacts: [], control: { state: 'active' }, executionSteps } } })
    for (let i = 0; i < 15; i++) await flush()
    assert.equal(page.get('transcript').children.some((row) => row.dataset.conversationTask), false)
  }
})

test('synthetic cached progress becomes visibly stale and a late receipt moves its failure card to the original message', async () => {
  const source = { commandId: 'root-stale', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A', receiptId: 'rpc:stale.1' }
  const events: any[] = [{ seq: 0, type: 'assistant.message', data: { text: '已有回复' } }]
  const taskDetails: Record<string, any> = {}
  const page = harness([source], events, false, { taskDetails })
  for (let i = 0; i < 20 && !page.get('transcript').children.some((row) => row.dataset.conversationTask); i++) await flush()
  assert.equal(page.get('transcript').children.some((row) => row.dataset.conversationTask), false,
    'a failed progress read without any observed tool steps cannot create a tool card')
  events.push({ seq: 1, type: 'user.message', data: { text: '真实目标', receiptId: source.receiptId } },
    { seq: 2, type: 'assistant.message', data: { text: '继续观察' } })
  page.tick(); for (let i = 0; i < 15; i++) await flush()
  assert.equal(page.get('transcript').children.some((row) => row.dataset.conversationTask), false)
  taskDetails[source.commandId] = { taskId: source.commandId, sessionId: 'A', source, artifacts: [],
    control: { state: 'stop_requested', stopStatus: 'cancel_requested' }, replyEvidence: { status: 'streaming' },
    executionSteps: [{ executionId: 'exec-stale', toolName: 'pwsh', state: 'completed', sourceCommandId: source.commandId,
      sourceReceiptId: source.receiptId, jobId: 'job-stale', jobState: 'stopping' }] }
  page.tick(); for (let i = 0; i < 15; i++) await flush()
  const card = page.get('transcript').children.find((row) => row.dataset.conversationTask)!
  const rows = page.get('transcript').children
  assert.equal(rows.indexOf(card), rows.findIndex((row) => row.dataset.receiptId === source.receiptId) + 1)
  assert.match(visibleText(card), /后台正在停止.*等待实际结束记录/)
  assert.doesNotMatch(visibleText(card), /实际停止|待更新/)
  taskDetails[source.commandId].control.stopStatus = 'stopped'
  taskDetails[source.commandId].executionSteps[0].jobState = 'killed'
  page.tick(); for (let i = 0; i < 15; i++) await flush()
  assert.match(visibleText(card), /后台已停止.*实际停止/)
  delete taskDetails[source.commandId]
  page.tick(); for (let i = 0; i < 15; i++) await flush()
  assert.match(visibleText(card), /待更新.*运行命令 · 后台已停止/)
  assert.doesNotMatch(visibleText(card), /电脑已核对这件事的实际停止/)
  assert.equal(page.requests.filter((row) => row.options.method === 'POST').length, 0)
})

test('synthetic late inline task payload is discarded after selecting another conversation', async () => {
  const source = { commandId: 'late-inline', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A', receiptId: 'rpc:late.1' }
  const page = harness([source], [{ seq: 0, type: 'user.message', data: { text: 'A目标', receiptId: source.receiptId } }], false,
    { deferTaskDetail: true })
  for (let i = 0; i < 20 && !page.requests.some((row) => row.url.endsWith('/tasks/late-inline')); i++) await flush()
  page.getByRole('button',{name:'B'}).fire('click'); await flush()
  page.resolveTaskDetail({ taskId: source.commandId, sessionId: 'A', source, artifacts: [], executionSteps: [{ executionId: 'exec-late',
    toolName: 'pwsh', state: 'completed', sourceCommandId: source.commandId, sourceReceiptId: source.receiptId }] })
  await flush()
  assert.equal(page.get('assistant-title').textContent, 'B')
  assert.equal(page.get('transcript').children.some((row) => row.dataset.conversationTask), false)
})



















test('terminal-output-limit desktop history requires the normalized pair and preserves legacy terminal meanings', async () => {
  const cases = [
    { data: { reason: 'error', endReasonKind: 'max-tokens' }, text: '回复达到长度限制。发送“继续”接着处理。' },
    { data: { reason: 'error' }, text: '这次处理未完成。请重试，或到设置检查模型。' },
    { data: { reason: 'unknown', endReasonKind: 'max-tokens' }, text: '本轮结束状态尚不明确，请在电脑核对。' },
    { data: {}, text: '本轮结束状态尚不明确，请在电脑核对。' },
    { data: { reason: { kind: 'max-tokens' } }, text: '本轮结束状态尚不明确，请在电脑核对。' },
    { data: { reason: 'completed', endReasonKind: 'max-tokens' }, text: '' },
    { data: { reason: 'aborted', endReasonKind: 'max-tokens' }, text: '本轮已停止。如需继续，请重新发送。' },
    { data: { reason: 'blocked', endReasonKind: 'max-tokens' }, text: '本轮因执行受限而停止，目标尚未确认完成。' },
  ]
  for (const item of cases) {
    const page = harness([], [{ seq: 1, type: 'turn.ended', data: item.data }], false)
    for (let attempt = 0; attempt < 15; attempt++) await flush()
    assert.equal(page.get('timeline-status').textContent, item.text, JSON.stringify(item.data))
  }
})

test('terminal-output-limit desktop keeps an old pure-reply card bound to its source while newer turns clear the timeline', async () => {
  const source = { commandId: 'root-limit', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'A', receiptId: 'rpc:limit.2' }
  const evidence = { status: 'failed', endReasonKind: 'max-tokens', turn: 2, assistantMessages: 0,
    sourceCommandId: source.commandId, sourceReceiptId: source.receiptId, terminalAt: '2026-10-07T00:35:29.769Z' }
  const task = { taskId: source.commandId, sessionId: 'A', source, artifacts: [], executionSteps: [],
    control: { state: 'active' }, replyEvidence: evidence }
  const initial = JSON.stringify(task)
  const events = [
    { seq: 1, type: 'user.message', data: { text: '核对这份资料', receiptId: source.receiptId } },
    { seq: 2, type: 'turn.ended', data: { reason: 'error', endReasonKind: 'max-tokens', turn: 2 } },
  ]
  const page = harness([source], events, true, { taskDetails: { [source.commandId]: task } })
  await flush()
  page.tick()
  for (let attempt = 0; attempt < 30 && !page.get('transcript').children.some((row) => row.dataset.conversationTask); attempt++) await flush()
  const card = page.get('transcript').children.find((row) => row.dataset.conversationTask === source.commandId)!
  assert.ok(card)
  assert.equal(card.children[0].textContent, '回复状态')
  assert.equal(card.parentNode!.children.indexOf(card), card.parentNode!.children.findIndex((row) => row.dataset.receiptId === source.receiptId) + 1)
  assert.match(visibleText(card), /因输出限制结束，尚未确认完整交付/)
  assert.doesNotMatch(visibleText(card), /工具进展|已正常结束|用户拒绝|费用|没有成果/)
  assert.equal(page.get('timeline-status').textContent, '回复达到长度限制。发送“继续”接着处理。')
  events.push({ seq: 3, type: 'user.message', data: { text: '核对这份资料', receiptId: 'rpc:new.3' } },
    { seq: 4, type: 'turn.started', data: { turn: 3 } })
  page.tick()
  for (let attempt = 0; attempt < 20 && page.get('timeline-status').textContent; attempt++) await flush()
  assert.equal(page.get('timeline-status').textContent, '')
  assert.equal(page.get('timeline-status').hidden, true)
  assert.doesNotMatch(page.get('timeline-status').textContent, /长度限制/)
  assert.match(visibleText(card), /因输出限制结束，尚未确认完整交付/)
  events.push({ seq: 5, type: 'turn.ended', data: { reason: 'completed', turn: 3 } })
  page.tick()
  for (let attempt = 0; attempt < 20 && page.get('timeline-status').textContent; attempt++) await flush()
  assert.equal(page.get('timeline-status').textContent, '')
  events.push({ seq: 6, type: 'turn.ended', data: { reason: 'error', turn: 4 } })
  page.tick()
  for (let attempt = 0; attempt < 20 && !page.get('timeline-status').textContent.includes('运行失败'); attempt++) await flush()
  assert.match(page.get('timeline-status').textContent, /处理未完成/)
  assert.doesNotMatch(page.get('timeline-status').textContent, /长度限制/)
  assert.match(visibleText(card), /因输出限制结束，尚未确认完整交付/)
  assert.equal(JSON.stringify(task), initial, 'display keeps the old source, turn and terminalAt evidence intact')
})



test('terminal-output-limit desktop offline session selection and account reset clear the previous reason', async () => {
  const config = { statusOffline: false }
  const page = harness([], [{ seq: 1, type: 'turn.ended', data: { reason: 'error', endReasonKind: 'max-tokens' } }], false, config)
  for (let attempt = 0; attempt < 20 && !page.get('timeline-status').textContent.includes('长度限制'); attempt++) await flush()
  assert.match(page.get('timeline-status').textContent, /长度限制/)
  config.statusOffline = true
  page.tick()
  for (let attempt = 0; attempt < 20 && page.core.state.online; attempt++) await flush()
  assert.equal(page.core.state.online, false)
  assert.match(page.core.connectionView().description, /正在连接/)
  const [a, b] = [page.getByRole('button',{name:'A'}),page.getByRole('button',{name:'B'})]
  b.fire('click')
  assert.equal(page.get('timeline-status').textContent, '', 'selection clears even when refreshHistory exits before its reset branch')
  config.statusOffline = false
  await page.core.retryConnection()
  for (let attempt = 0; attempt < 20; attempt++) await flush()
  a.fire('click')
  for (let attempt = 0; attempt < 20 && !page.get('timeline-status').textContent.includes('长度限制'); attempt++) await flush()
  assert.match(page.get('timeline-status').textContent, /长度限制/)
  page.get('logout-button').fire('click')
  for (let attempt = 0; attempt < 20 && page.get('timeline-status').textContent; attempt++) await flush()
  assert.equal(page.get('timeline-status').textContent, '')
})

test('durable turn errors remain visible while a later completed turn clears the warning and keeps messages', async () => {
  const events = [
    { seq: 1, type: 'user.message', data: { text: 'hello' } },
    { seq: 2, type: 'turn.started', data: {} },
    { seq: 3, type: 'turn.ended', data: { reason: 'error' } },
  ]
  const page = harness([], events)
  for (let attempt = 0; attempt < 10 && !page.get('timeline-status').textContent.includes('运行失败'); attempt++) await flush()
  assert.match(page.get('timeline-status').textContent, /这次处理未完成/)
  assert.match(page.get('transcript').children.map(visibleText).join(' '), /hello/)
  events.push({ seq: 4, type: 'turn.started', data: {} },
    { seq: 5, type: 'assistant.message', data: { text: 'reply' } },
    { seq: 6, type: 'turn.ended', data: { reason: 'completed' } })
  page.getByRole('button',{name:'A'}).fire('click')
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
  for (let attempt = 0; attempt < 20 && page.conversationButtons().length < 3; attempt++) await flush()
  const rail = page.get('session-list')
  assert.equal(page.conversationButtons().length, 3, 'desktop and phone conversations share one rail')
  assert.match(visibleText(page.getByRole('button',{name:'路上的图片'})), /路上的图片/)
  page.getByRole('button',{name:'路上的图片'}).fire('click')
  assert.equal(page.get('assistant-title').textContent, '路上的图片')
  assert.equal(page.get('conversation-pane').hidden, false)
  assert.equal(page.getByRole('textbox', { name: '输入消息' }).disabled, false)
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
  page.getByRole('button',{name:'A'}).fire('click')
  await flush()
  assert.equal(page.get('assistant-title').textContent, 'A')
  assert.equal(page.getByRole('textbox', { name: '输入消息' }).disabled, false, 'desktop DSH conversation remains sendable')
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
  for (let attempt = 0; attempt < 30 && page.conversationButtons().length !== 2; attempt++) await flush()
  assert.equal(page.conversationButtons().length, 2, 'bound A is represented by the original phone card')
  page.getByRole('button',{name:'同一段对话'}).fire('click')
  for (let attempt = 0; attempt < 30 && !visibleText(page.get('transcript')).includes('电脑基于手机事实回答'); attempt++) await flush()
  const text = visibleText(page.get('transcript'))
  assert.match(text, /手机事实.*本机回应.*电脑基于手机事实回答/)
  assert.equal(text.match(/新的电脑追问/g)?.length, 1)
  assert.equal(page.core.composerState(page.get('message-text').value).sendText, '发送到电脑')
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
    for (let attempt = 0; attempt < 25 && page.conversationButtons().length < 3; attempt++) await flush()
    page.getByRole('button',{name:'模型选择'}).fire('click')
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
      if (url.endsWith('/check')) return { configured: true, reachable: false, modelListed: false, inferenceVerified: false,
        address: 'unreachable', authentication: 'unchecked', catalog: 'unchecked', model: 'unchecked' }
      const model = { accountModelId: 'account-model-one', revision: 1, profileId: 'private-one',
        name: '我的 MiMo', provider: 'openai-compatible', baseUrl: 'http://192.168.1.10:18080/v1', modelTier: 'cloud',
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
  page.get('account-model-base-url').value = 'http://192.168.1.10:18080/v1'
  page.get('account-model-tier').value = 'cloud'
  page.get('account-model-id').value = 'mimo-v2.6-flash'
  page.get('account-model-key').value = 'synthetic-private-key'
  assert.ok(page.get('account-model-form').listeners.get('submit')?.length)
  page.get('account-model-form').fire('submit')
  for (let attempt = 0; attempt < 35 && models.length < 1; attempt++) await flush()
  assert.equal(writes.length, 1, `form=${page.get('account-model-form-status').textContent}; list=${page.get('account-models-status').textContent}; requests=${page.requests.filter((item) => item.url.includes('/account/models')).map((item) => item.url).join(',')}`)
  assert.equal(writes[0].body.apiKey, 'synthetic-private-key')
  assert.equal(writes[0].body.modelTier, 'cloud')
  assert.equal(writes[0].body.baseUrl, 'http://192.168.1.10:18080/v1')
  assert.equal([...page.storage.values()].some((value) => value.includes('synthetic-private-key')), false)
  for (let attempt = 0; attempt < 25 && !visibleText(page.get('account-models-list')).includes('我的 MiMo'); attempt++) await flush()
  assert.match(visibleText(page.get('account-models-list')), /我的 MiMo/)
  const edit = page.get('account-models-list').children.find(item => visibleText(item).includes('我的 MiMo'))!.children[1].children
    .find((item) => item.textContent === '编辑')!
  edit.fire('click')
  assert.equal(page.get('account-model-tier').value, 'cloud', 'editing restores the saved override')
  const test = page.get('account-models-list').children.find(item => visibleText(item).includes('我的 MiMo'))!.children[1].children
    .find((item) => item.textContent === '测试连接')!
  test.fire('click')
  for (let attempt = 0; attempt < 25 && writes.length < 2; attempt++) await flush()
  assert.equal(writes.length, 2)
  assert.equal(writes[1].body.apiKey, undefined)
  for (let attempt = 0; attempt < 25 && !visibleText(page.get('account-models-list')).includes('地址连不上'); attempt++) await flush()
  assert.match(visibleText(page.get('account-models-list')), /地址连不上/)
  assert.equal(writes[1].body.sendTestMessage, false)
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
  for (let attempt = 0; attempt < 20 && page.conversationButtons().length < 3; attempt++) await flush()
  page.getByRole('button',{name:'长图对话'}).fire('click')
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
  const viewer = page.get('body').children.find((child) => child.className.includes('render-gallery'))!
  assert.equal(viewer.open, true)
  assert.equal(viewer.querySelector('img')!.src, url)
  page.getByRole('button',{name:'B'}).fire('click')
  await flush()
  assert.equal(viewer.open, false)
  assert.equal(viewer.querySelector('img')!.src, '')
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
  const viewer = page.get('body').children.find((child) => child.className.includes('render-gallery'))!
  assert.equal(viewer.open, true)
  page.get('logout-button').fire('click')
  for (let attempt = 0; attempt < 20 && viewer.open; attempt++) await flush()
  assert.equal(viewer.open, false)
  assert.equal(viewer.querySelector('img')!.src, '')
  assert.equal(page.get('transcript').children.length, 0)
  gallery.children[0].fire('click')
  assert.equal(viewer.open, false, 'stale image control cannot reopen after account logout')
})

test('desktop appends one user text event to the original phone conversation without invoking a model', async () => {
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000001'
  const page = harness([], [], false, { syncAvailable: true, uuidForSync: true, syncEvents: [
    { seq: 1, conversationId, sourceDeviceId: 'device-phone', kind: 'conversation.created', payload: { title: '同一条对话' } },
  ] })
  for (let attempt = 0; attempt < 20 && page.conversationButtons().length < 3; attempt++) await flush()
  page.getByRole('button',{name:'同一条对话'}).fire('click')
  page.getByRole('textbox', { name: '输入消息' }).value = '电脑补充的文字'
  page.getByRole('textbox', { name: '输入消息' }).fire('input')
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
  for (let attempt = 0; attempt < 20 && page.conversationButtons().length < 3; attempt++) await flush()
  page.getByRole('button',{name:'离线文字'}).fire('click')
  page.getByRole('textbox', { name: '输入消息' }).value = '原文保留'
  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && !page.storage.has('weftmate:phone-sync-outbox:v1:owner-test:device-test'); attempt++) await flush()
  const key = 'weftmate:phone-sync-outbox:v1:owner-test:device-test'
  const pending = JSON.parse(page.storage.get(key)!)
  assert.equal(pending.event.payload.text, '原文保留')
  for (let attempt = 0; attempt < 20 && (page.core.composerState(page.get('message-text').value).sendText !== '核对并重试' ||
    page.get('send-message').disabled); attempt++) await flush()
  assert.equal(page.getByRole('textbox', { name: '输入消息' }).value, '原文保留')
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
  for (let attempt = 0; attempt < 20 && page.conversationButtons().length < 3; attempt++) await flush()
  page.getByRole('button',{name:'已接收的文字'}).fire('click')
  page.getByRole('textbox', { name: '输入消息' }).value = '只保存一次'
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
  for (let attempt = 0; attempt < 20 && page.conversationButtons().length < 3; attempt++) await flush()
  page.getByRole('button',{name:'冲突会话'}).fire('click')
  page.getByRole('textbox', { name: '输入消息' }).value = '冲突时保留'
  page.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && !/编号发生冲突/.test(page.get('model-hint').textContent); attempt++) await flush()
  assert.match(page.get('model-hint').textContent, /编号发生冲突/)
  assert.equal(page.getByRole('textbox', { name: '输入消息' }).value, '冲突时保留')
  const stored = JSON.parse(page.storage.get('weftmate:phone-sync-outbox:v1:owner-test:device-test')!)
  assert.equal(stored.event.payload.text, '冲突时保留')
  assert.equal(page.core.composerState(page.get('message-text').value).sendText, '核对并重试')
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

const approvalFixtureId = '00000000-0000-4000-8000-000000000001'
function task15ApprovalFixture(config: NonNullable<Parameters<typeof harness>[3]> = {}) {
  const source = { commandId: 'root-approval-client', kind: 'session.message', state: 'accepted_by_dsh',
    sessionId: 'A', receiptId: 'rpc:approval.root' }
  const supplement = { commandId: 'follow-approval-client', kind: 'session.message', state: 'accepted_by_dsh',
    sessionId: 'A', rootTaskId: source.commandId, receiptId: 'rpc:approval.follow', taskAction: 'supplement' }
  const task = { taskId: source.commandId, sessionId: 'A', source, supplements: [supplement], artifacts: [],
    control: { state: 'active', canStop: true, canSupplement: true } }
  const approval = { approvalId: approvalFixtureId, sessionId: 'A', taskId: source.commandId,
    sourceCommandId: source.commandId, sourceReceiptId: source.receiptId, turn: 1,
    callId: 'approval-call', rootCallId: 'approval-root-call', toolName: 'weftmod_script',
    reason: '这次脚本会写入隔离目标文件。', createdAt: '2026-10-06T12:00:00.000Z', status: 'pending' }
  const approvals = config.approvals ?? { A: [approval] }
  const page = harness([supplement, source], [
    { seq: 0, type: 'user.message', data: { text: '相同的目标', receiptId: source.receiptId } },
    { seq: 1, type: 'assistant.message', data: { text: '等待本次批准。' } },
    { seq: 2, type: 'user.message', data: { text: '相同的目标', receiptId: supplement.receiptId } },
    { seq: 3, type: 'user.message', data: { text: '相同的目标', receiptId: 'rpc:approval.unrelated' } },
  ], true, { profileAccounts: profileFixture(), taskDetails: { [source.commandId]: task }, ...config, approvals })
  return { page, source, supplement, task, approval, approvals }
}
function approvalCard(page: ReturnType<typeof harness>, approvalId = approvalFixtureId) {
  return page.get('approval-bar').children.find((row) => row.dataset.conversationApproval === approvalId)
}
function approvalAction(page: ReturnType<typeof harness>, action: string, approvalId = approvalFixtureId) {
  return approvalCard(page, approvalId)?.querySelector(`[data-conversation-approval-action="${action}"]`)
}
async function approvalReady(page: ReturnType<typeof harness>) {
  await ready(page)
  for (let i = 0; i < 40 && !approvalCard(page); i++) await flush()
  assert.ok(approvalCard(page))
}
function approvalAnswered(approval: Record<string, any>, requestId: string, outcome = 'allowed-once') {
  return { ...approval, status: 'answered', decisionRequestId: requestId, decisionOutcome: outcome,
    answeredAt: '2026-10-06T12:01:00.000Z' }
}

test('task15-approval-client shows only real receipt-bound requests and distinguishes all receipt stages', async () => {
  const empty = task15ApprovalFixture({ approvals: { A: [] } })
  await ready(empty.page)
  for (let i = 0; i < 15; i++) await flush()
  assert.equal(empty.page.get('transcript').children.some((row) => row.dataset.conversationApproval), false)
  const f = task15ApprovalFixture()
  const answer = approvalAnswered(f.approval, 'other-device-answer', 'rejected')
  f.approvals.A.push(
    { ...answer, approvalId: '00000000-0000-4000-8000-000000000002' },
    { ...approvalAnswered(f.approval, 'native-answer'), approvalId: '00000000-0000-4000-8000-000000000003',
      sourceCommandId: f.supplement.commandId, sourceReceiptId: f.supplement.receiptId, turn: 2,
      status: 'resolved', outcome: 'allowed-once', resolvedAt: '2026-10-06T12:02:00.000Z' },
    { ...f.approval, approvalId: '00000000-0000-4000-8000-000000000004', status: 'unavailable', outcome: 'cancelled' },
    { ...f.approval, approvalId: '00000000-0000-4000-8000-000000000005', status: 'unavailable', outcome: 'unavailable' },
    { ...f.approval, approvalId: '00000000-0000-4000-8000-000000000006', sourceCommandId: 'wrong-command' },
    { ...f.approval, approvalId: '00000000-0000-4000-8000-000000000007', sourceReceiptId: 'rpc:approval.unrelated' },
  )
  await approvalReady(f.page)
  const rows = f.page.get('transcript').children
  const pending = approvalCard(f.page)!
  assert.equal(rows[0].dataset.receiptId, f.source.receiptId)
  assert.equal(approvalAction(f.page, 'allowed-once')?.textContent, '批准')
  assert.equal(approvalAction(f.page, 'rejected')?.textContent, '拒绝')
  const records = f.page.core.conversationApprovals.entries
  assert.equal(records.get('00000000-0000-4000-8000-000000000002').row.decisionOutcome, 'rejected')
  assert.equal(records.get('00000000-0000-4000-8000-000000000003').row.outcome, 'allowed-once')
  assert.equal(records.get('00000000-0000-4000-8000-000000000004').row.outcome, 'cancelled')
  assert.equal(records.get('00000000-0000-4000-8000-000000000005').row.outcome, 'unavailable')
  assert.equal(approvalCard(f.page, '00000000-0000-4000-8000-000000000006'), undefined)
  assert.equal(approvalCard(f.page, '00000000-0000-4000-8000-000000000007'), undefined)
  assert.equal(rows.some(row => row.dataset.conversationApproval), false, 'approvals belong above the input')
  f.page.getByRole('textbox', { name: '输入消息' }).value = '保留草稿'
  f.page.get('chat-scroll').scrollTop = 312
  const detail = approvalAction(f.page, 'parameters')!
  detail.focus(); detail.fire('click')
  detail.fire('click'); await flush()
  assert.equal(f.page.document.activeElement, approvalAction(f.page, 'parameters'))
  assert.equal(f.page.getByRole('textbox', { name: '输入消息' }).value, '保留草稿')
  assert.equal(f.page.get('chat-scroll').scrollTop, 312)
})

test('task15-approval-client retries an uncertain answer with the same request after authoritative reads and preserves terminal state', async () => {
  const firstPost = deferred<ReturnType<typeof reply>>(), secondPost = deferred<ReturnType<typeof reply>>()
  const bodies: any[] = [], storage = new Map<string, string>()
  const config: NonNullable<Parameters<typeof harness>[3]> = { storage,
    approvalDecide: (_url, options) => { bodies.push(JSON.parse(options.body)); return bodies.length === 1 ? firstPost.promise : secondPost.promise } }
  const first = task15ApprovalFixture(config)
  await approvalReady(first.page)
  first.page.getByRole('textbox', { name: '输入消息' }).value = '提交期间继续写草稿'
  first.page.get('chat-scroll').scrollTop = 217
  const allow = approvalAction(first.page, 'allowed-once')!, reject = approvalAction(first.page, 'rejected')!
  allow.focus(); allow.fire('click'); allow.fire('click'); reject.fire('click')
  await flush()
  assert.equal(bodies.length, 1)
  assert.equal(approvalAction(first.page, 'allowed-once')!.disabled, true)
  assert.equal(approvalAction(first.page, 'rejected')!.disabled, true)
  first.page.getByRole('textbox', { name: '输入消息' }).focus()
  firstPost.reject(new Error('synthetic uncertain network'))
  for (let i = 0; i < 25 && approvalAction(first.page, 'allowed-once')?.disabled; i++) await flush()
  assert.match(visibleText(approvalCard(first.page)!), /上次答复尚未确认/)
  assert.equal(approvalAction(first.page, 'rejected')!.disabled, true)
  assert.equal(first.page.document.activeElement, first.page.getByRole('textbox', { name: '输入消息' }))
  assert.equal(first.page.getByRole('textbox', { name: '输入消息' }).value, '提交期间继续写草稿')
  assert.equal(first.page.get('chat-scroll').scrollTop, 217)
  const writes = first.page.requests.filter((row) => row.options.method === 'POST' && row.url.includes('/approvals/'))
  const firstWrite = first.page.requests.indexOf(writes[0])
  assert.ok(first.page.requests.slice(firstWrite + 1).some((row) => row.url.includes('/approvals?')))
  assert.equal(bodies.length, 1, 'the uncertain network result causes a read, never automatic replay')

  const second = task15ApprovalFixture({ ...config, approvals: first.approvals })
  await approvalReady(second.page)
  const beforeRetry = second.page.requests.length
  approvalAction(second.page, 'allowed-once')!.fire('click')
  for (let i = 0; i < 20 && bodies.length !== 2; i++) await flush()
  assert.deepEqual(bodies[1], bodies[0], 'reload retains the exact request ID and original outcome')
  const retryRequests = second.page.requests.slice(beforeRetry)
  assert.ok(retryRequests[0].url.includes('/approvals?'), 'retry rereads the authoritative list before POST')
  assert.ok(retryRequests[1].url.endsWith(`/approvals/${approvalFixtureId}`))
  assert.deepEqual(Object.keys(bodies[1]).sort(), ['outcome', 'requestId'])
  assert.equal(retryRequests[1].options.headers['X-WeftMate-CSRF'], 'csrf-A')
  first.approvals.A[0] = { ...approvalAnswered(first.approval, bodies[1].requestId), status: 'resolved',
    outcome: 'allowed-once', resolvedAt: '2026-10-06T12:02:00.000Z' }
  second.page.tick()
  for (let i = 0; i < 25 && approvalCard(second.page); i++) await flush()
  assert.equal(approvalCard(second.page), undefined)
  assert.equal(second.page.get('approval-bar').hidden, true)
  assert.equal(second.page.core.conversationApprovals.entries.get(approvalFixtureId).row.outcome, 'allowed-once')
  secondPost.resolve(reply({ approval: approvalAnswered(first.approval, bodies[1].requestId), requestId: bodies[1].requestId }))
  for (let i = 0; i < 15; i++) await flush()
  assert.equal(second.page.core.conversationApprovals.entries.get(approvalFixtureId).row.status, 'resolved')
  assert.equal(approvalCard(second.page), undefined)
  assert.equal(approvalAction(second.page, 'allowed-once'), undefined)
})

test('task15-approval-client ignores old list callbacks after switching conversations', async () => {
  const oldRead = deferred<ReturnType<typeof reply>>()
  let hold = false
  const f = task15ApprovalFixture({ approvalRead: (url) => url.includes('/sessions/A/') && hold ? oldRead.promise
    : reply({ approvals: [], nextBefore: null, hasMore: false }) })
  await ready(f.page)
  for (let i = 0; i < 15; i++) await flush()
  hold = true; f.page.tick()
  for (let i = 0; i < 15 && !f.page.requests.at(-1)?.url.includes('/approvals?'); i++) await flush()
  const sessionB = f.page.getByRole('button',{name:'B'})
  sessionB.fire('click')
  await flush()
  oldRead.resolve(reply({ approvals: [f.approval], nextBefore: null, hasMore: false }))
  for (let i = 0; i < 20; i++) await flush()
  assert.equal(f.page.get('assistant-title').textContent, 'B')
  assert.equal(approvalCard(f.page), undefined)
  assert.equal(f.page.requests.filter((row) => row.options.method === 'POST' && row.url.includes('/approvals/')).length, 0)
})

test('task15-approval-client ignores a pending POST and old controls after account and device replacement', async () => {
  const oldPost = deferred<ReturnType<typeof reply>>()
  let body: any
  const f = task15ApprovalFixture({ approvalDecide: (_url, options) => { body = JSON.parse(options.body); return oldPost.promise } })
  await approvalReady(f.page)
  const oldButton = approvalAction(f.page, 'allowed-once')!
  oldButton.fire('click'); await flush()
  f.approvals.A = []
  await switchToB(f.page)
  f.page.getByRole('textbox', { name: '输入消息' }).value = 'B 的新草稿'
  f.page.getByRole('textbox', { name: '输入消息' }).focus()
  oldPost.resolve(reply({ approval: approvalAnswered(f.approval, body.requestId), requestId: body.requestId }))
  for (let i = 0; i < 15; i++) await flush()
  oldButton.fire('click')
  await flush()
  assert.equal(approvalCard(f.page), undefined)
  assert.equal(f.page.getByRole('textbox', { name: '输入消息' }).value, 'B 的新草稿')
  assert.equal(f.page.document.activeElement, f.page.getByRole('textbox', { name: '输入消息' }))
  assert.equal(f.page.requests.filter((row) => row.options.method === 'POST' && row.url.includes('/approvals/')).length, 1)
})

const questionFixtureId = '00000000-0000-4000-8000-000000000011'
function task15QuestionFixture(config: NonNullable<Parameters<typeof harness>[3]> = {}) {
  const source = { commandId: 'root-question-client', kind: 'session.message', state: 'accepted_by_dsh',
    sessionId: 'A', receiptId: 'rpc:question.root' }
  const supplement = { commandId: 'follow-question-client', kind: 'session.message', state: 'accepted_by_dsh',
    sessionId: 'A', rootTaskId: source.commandId, receiptId: 'rpc:question.follow', taskAction: 'supplement' }
  const task = { taskId: source.commandId, sessionId: 'A', source, supplements: [supplement], artifacts: [], control: { state: 'active', canStop: true } }
  const question = { questionRpcId: questionFixtureId, sessionId: 'A', taskId: source.commandId,
    sourceCommandId: supplement.commandId, sourceReceiptId: supplement.receiptId, turn: 2,
    createdAt: '2026-10-06T13:00:00.000Z', status: 'pending', questions: [
      { id: 'single', header: '信息选择', question: '选择报告说明用词。', options: [{ label: '同意' }, { label: '不同意', description: '先修改说明' }] },
      { id: 'multi', question: '选择报告内容。', multiSelect: true, options: [{ label: '来源' }, { label: '步骤' }] },
      { id: 'free', question: '补充备注。' },
      { id: 'single', question: '这个计划如何？', detail: '仅处理合成资料。', options: [{ label: '继续' }, { label: '修改' }],
        intent: { kind: 'plan-review', approve: '继续' } },
    ] }
  const questions = config.questions ?? { A: [question] }
  const page = harness([supplement, source], [
    { seq: 0, type: 'user.message', data: { text: '相同的目标', receiptId: source.receiptId } },
    { seq: 1, type: 'assistant.message', data: { text: '请补充信息。' } },
    { seq: 2, type: 'user.message', data: { text: '相同的目标', receiptId: supplement.receiptId } },
    { seq: 3, type: 'user.message', data: { text: '相同的目标', receiptId: 'rpc:question.unrelated' } },
  ], true, { profileAccounts: profileFixture(), taskDetails: { [source.commandId]: task }, ...config, questions })
  return { page, question, questions, source, supplement }
}
function questionCard(page: ReturnType<typeof harness>, id = questionFixtureId) {
  const bar = page.get('question-bar');
  if (!bar.hidden && bar.dataset.questionId === id && bar.children.length) return bar;
  return page.get('transcript').children.find(row => row.dataset.conversationQuestion === id);
}
function questionControl(page: ReturnType<typeof harness>, role: string, name: string) {
  const all = (node: Element): Element[] => [node, ...node.children.flatMap(all)];
  const matches = all(page.get('question-bar')).filter(node => (node.getAttribute('role') || (node.tagName === 'BUTTON' ? 'button' : node.tagName === 'INPUT' ? 'textbox' : '')) === role && (node.getAttribute('aria-label') || node.textContent) === name);
  assert.equal(matches.length, 1, `one ${role} named ${name}`); return matches[0];
}
function fillQuestionBatch(page: ReturnType<typeof harness>, questions: any[], custom = '合成备注') {
  for (const [index, item] of questions.entries()) {
    if (item.options?.length) questionControl(page, item.multiSelect ? 'button' : 'radio', item.options[0].label).fire('click');
    else { const input = questionControl(page, 'textbox', '你的回答'); input.value = custom; input.fire('input'); }
    if (index < questions.length - 1) questionControl(page, 'button', '下一题').fire('click');
  }
}
async function questionReady(page: ReturnType<typeof harness>) {
  await ready(page); for (let i = 0; i < 40 && !questionCard(page); i++) await flush(); assert.ok(questionCard(page));
}
function questionAnswered(question: Record<string, any>, requestId: string, answer: any) {
  return { ...question, status: 'answered', answerRequestId: requestId, answer, answeredAt: '2026-10-06T13:01:00.000Z' }
}

test('task15-question-client preserves native order, exact labels and drafts through the sequential bar without granting execution', async () => {
  const empty = task15QuestionFixture({ questions: { A: [] } }); await ready(empty.page); for (let i=0;i<15;i++) await flush(); assert.equal(questionCard(empty.page),undefined);
  const post = deferred<ReturnType<typeof reply>>(), bodies: any[] = [];
  const f = task15QuestionFixture({questionAnswer:(_url,options)=>{bodies.push(JSON.parse(options.body));return post.promise}});
  await questionReady(f.page);
  assert.match(visibleText(questionCard(f.page)!), /还有 3 个问题/);
  const first = f.question.questions[0];
  questionControl(f.page,'radio',first.options[0].label).fire('click');
  const other = questionControl(f.page,'textbox','其他回答'); other.value='自定义说明';other.fire('input');
  assert.equal(questionControl(f.page,'radio',first.options[0].label).getAttribute('aria-checked'),'false');
  questionControl(f.page,'radio',first.options[0].label).fire('click');assert.equal(other.value,'');
  questionControl(f.page,'button','下一题').fire('click');
  for(const option of f.question.questions[1].options) questionControl(f.page,'button',option.label).fire('click');
  const mixed=questionControl(f.page,'textbox','其他回答');mixed.value='额外信息';mixed.fire('input');
  questionControl(f.page,'button','下一题').fire('click');
  const free=questionControl(f.page,'textbox','你的回答');free.value='合成备注';free.fire('input');
  questionControl(f.page,'button','下一题').fire('click');questionControl(f.page,'radio',f.question.questions[3].options[0].label).fire('click');
  f.page.get('message-text').value='聊天草稿保留';
  questionControl(f.page,'button','提交回答').fire('click');await flush();
  assert.deepEqual(bodies[0].answer.answers,[{id:first.id,selected:[first.options[0].label]}, {id:f.question.questions[1].id,selected:f.question.questions[1].options.map((row:any)=>row.label),custom:'额外信息'}, {id:f.question.questions[2].id,selected:[],custom:'合成备注'}, {id:f.question.questions[3].id,selected:[f.question.questions[3].options[0].label]}]);
  assert.deepEqual(Object.keys(bodies[0]).sort(),['answer','requestId']);
  assert.equal(f.page.requests.filter(row=>row.options.method==='POST'&&row.url.includes('/approvals/')).length,0);
  f.questions.A[0]=questionAnswered(f.question,bodies[0].requestId,bodies[0].answer);
  post.resolve(reply({requestId:bodies[0].requestId,question:f.questions.A[0]}));for(let i=0;i<15;i++)await flush();
  assert.equal(f.page.get('question-bar').hidden,true);assert.match(visibleText(questionCard(f.page)!),/已回答：/);assert.equal(f.page.get('message-text').value,'聊天草稿保留');
});

test('task15-question-client rereads uncertainty and reuses the exact answer request without losing native acceptance', async () => {
  const first=deferred<ReturnType<typeof reply>>(),second=deferred<ReturnType<typeof reply>>(),bodies:any[]=[],storage=new Map<string,string>();let temporary=false;
  const f=task15QuestionFixture({storage,questionAnswer:(_url,options)=>{bodies.push(JSON.parse(options.body));return bodies.length===1?first.promise:second.promise},questionRead:()=>temporary?reply({error:{code:'RUNTIME_UNAVAILABLE'}},503):reply({questions:f.questions.A,nextBefore:null,hasMore:false})});
  await questionReady(f.page);fillQuestionBatch(f.page,f.question.questions,'网络前的回答');questionControl(f.page,'button','提交回答').fire('click');await flush();
  temporary=true;first.reject(new Error('synthetic uncertain network'));for(let i=0;i<15;i++)await flush();
  assert.match(visibleText(questionCard(f.page)!),/暂时无法核对/);assert.equal(questionControl(f.page,'button','重试原回答').disabled,true);
  temporary=false;questionControl(f.page,'button','重新核对回答').fire('click');for(let i=0;i<15;i++)await flush();questionControl(f.page,'button','重试原回答').fire('click');for(let i=0;i<15&&bodies.length!==2;i++)await flush();
  assert.deepEqual(bodies[1],bodies[0]);
  const accepted={...questionAnswered(f.question,bodies[1].requestId,bodies[1].answer),status:'resolved',outcome:'answered',resolvedAt:'2026-10-06T13:02:00.000Z',answerAcceptedAt:'2026-10-06T13:01:30.000Z'};
  f.questions.A[0]=accepted;f.page.tick();for(let i=0;i<15;i++)await flush();second.resolve(reply({question:questionAnswered(f.question,bodies[1].requestId,bodies[1].answer),requestId:bodies[1].requestId}));for(let i=0;i<15;i++)await flush();
  assert.match(visibleText(questionCard(f.page)!),/已回答：/);assert.equal(f.page.get('question-bar').hidden,true);
});

test('task15-question-client ignores old conversation reads and account-device answer callbacks', async () => {
  const oldRead=deferred<ReturnType<typeof reply>>();let hold=false;
  const reading=task15QuestionFixture({questionRead:url=>hold&&url.includes('/sessions/A/')?oldRead.promise:reply({questions:[],nextBefore:null,hasMore:false})});
  await ready(reading.page);for(let i=0;i<15;i++)await flush();hold=true;reading.page.tick();for(let i=0;i<15;i++)await flush();reading.page.getByRole('button',{name:'B'}).fire('click');oldRead.resolve(reply({questions:[reading.question],nextBefore:null,hasMore:false}));for(let i=0;i<15;i++)await flush();assert.equal(questionCard(reading.page),undefined);
  const post=deferred<ReturnType<typeof reply>>();let body:any;
  const posting=task15QuestionFixture({questionAnswer:(_url,options)=>{body=JSON.parse(options.body);return post.promise}});await questionReady(posting.page);fillQuestionBatch(posting.page,posting.question.questions);
  const oldButton=questionControl(posting.page,'button','提交回答');oldButton.fire('click');await flush();posting.questions.A=[];await switchToB(posting.page);
  posting.page.get('message-text').value='B 的草稿';posting.page.get('message-text').focus();post.resolve(reply({question:questionAnswered(posting.question,body.requestId,body.answer),requestId:body.requestId}));for(let i=0;i<15;i++)await flush();oldButton.fire('click');await flush();
  assert.equal(questionCard(posting.page),undefined);assert.equal(posting.page.get('message-text').value,'B 的草稿');assert.equal(posting.page.document.activeElement,posting.page.get('message-text'));assert.equal(posting.page.requests.filter(row=>row.options.method==='POST'&&row.url.includes('/questions/')).length,1);
});

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
  for (let attempt = 0; attempt < 20 && page.conversationButtons().length < 3; attempt++) await flush()
  page.getByRole('button',{name:'原手机对话'}).fire('click')
  page.getByRole('textbox', { name: '输入消息' }).value = 'A 的待核对文字'
  page.get('message-form').fire('submit')
  const aKey = 'weftmate:phone-sync-outbox:v1:profile-owner-a:profile-device-A'
  for (let attempt = 0; attempt < 20 && !page.storage.has(aKey); attempt++) await flush()
  assert.equal(JSON.parse(page.storage.get(aKey)!).event.payload.text, 'A 的待核对文字')
  await switchToB(page)
  for (let attempt = 0; attempt < 20 && page.conversationButtons().length < 3; attempt++) await flush()
  page.getByRole('button',{name:'原手机对话'}).fire('click')
  assert.equal(page.getByRole('textbox', { name: '输入消息' }).value, '')
  assert.equal(page.core.composerState(page.get('message-text').value).sendText, '同步文字')
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
  for (let attempt = 0; attempt < 20 && first.conversationButtons().length < 3; attempt++) await flush()
  first.getByRole('button',{name:'恢复草稿'}).fire('click')
  first.getByRole('textbox', { name: '输入消息' }).value = '登录前的文字'
  first.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && !storage.has('weftmate:phone-sync-recovery:v1:profile-owner-a'); attempt++) await flush()
  const second = harness([], [], false, { profileAccounts: profileFixture(), syncAvailable: true,
    uuidForSync: true, deviceSuffix: '-renewed', syncEvents: rows, storage })
  await ready(second)
  for (let attempt = 0; attempt < 20 && second.conversationButtons().length < 3; attempt++) await flush()
  second.getByRole('button',{name:'恢复草稿'}).fire('click')
  assert.equal(second.getByRole('textbox', { name: '输入消息' }).value, '登录前的文字')
  assert.equal(second.core.composerState(second.get('message-text').value).sendText, '核对旧请求')
  second.get('message-form').fire('submit')
  for (let attempt = 0; attempt < 20 && storage.has('weftmate:phone-sync-recovery:v1:profile-owner-a'); attempt++) await flush()
  assert.equal(second.getByRole('textbox', { name: '输入消息' }).value, '登录前的文字')
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


test('M0-3 desktop opens latest content, prepends older rows, and polls from the tail watermark', async () => {
  const events = Array.from({ length: 2200 }, (_, seq) => ({ seq, type: 'assistant.message', data: { text: `message ${seq}` } }))
  const app = harness([], events, false, { eventPageSize: 3 })
  for (let i = 0; i < 20; i++) await flush()
  const rows = app.get('transcript').children.filter(n => n.dataset.seq)
  assert.deepEqual(rows.map(n => Number(n.dataset.seq)), [2197,2198,2199])
  assert.equal(app.get('load-older').hidden, false)
  const first = app.requests.find(r => r.url.includes('/events?'))!
  assert.doesNotMatch(first.url, /afterSeq/)
  app.get('load-older').fire('click'); for (let i = 0; i < 8; i++) await flush()
  assert.deepEqual(app.get('transcript').children.filter(n => n.dataset.seq).map(n => Number(n.dataset.seq)), [2194,2195,2196,2197,2198,2199])
  assert.ok(app.requests.some(r => r.url.includes('beforeSeq=2197')))
  events.push({ seq: 2200, type: 'assistant.message', data: { text: 'new response' } }); app.tick()
  for (let i = 0; i < 12; i++) await flush()
  assert.match(visibleText(app.get('transcript')), /new response/)
  assert.ok(app.requests.some(r => r.url.includes('afterSeq=2199')))
})

test('M1-0 inline source, artifact and stop controls use the receipt-bound task without a task page', async () => {
  const source = { commandId: 'inline-task', kind: 'session.message', sessionId: 'A', state: 'accepted_by_dsh', receiptId: 'rpc:inline' }
  const artifact = { taskId: source.commandId, sessionId: 'A', artifactId: 'inline-file', fileName: '报告.md', size: 24, state: 'observed', verification: { status: 'observed', method: 'sha256_readback' } }
  const app = harness([source], [{ seq: 0, type: 'user.message', data: { text: '整理报告', receiptId: source.receiptId } }], false, {
    taskDetails: { [source.commandId]: { taskId: source.commandId, sessionId: 'A', source, sourceText: '整理报告', artifacts: [artifact],
      sources: [{ snapshotId: 'source-inline', relativePath: 'notes.md' }], control: { state: 'active', canStop: true } } },
  })
  for (let i = 0; i < 20; i++) await flush()
  const card = app.get('transcript').children.find(n => n.dataset.conversationTask === source.commandId)!
  assert.ok(card, JSON.stringify({text:visibleText(app.get('transcript')),requests:app.requests.map(r=>r.url)})); assert.match(visibleText(card), /报告.md/)
  card.querySelector('[data-conversation-task-action="detail"]')!.fire('click')
  const info = card.querySelector('.timeline-task-info')!; assert.ok(info)
  assert.match(visibleText(info), /整理报告.*查看来源 notes.md.*请求停止这件事/)
  info.querySelectorAll('button').find(n => n.textContent === '请求停止这件事')!.fire('click')
  await flush(); assert.ok(app.requests.some(r => r.url.endsWith('/tasks/inline-task/stop') && r.options.method === 'POST'))
  assert.doesNotMatch(accountHtml, /tasks-pane|task-detail-dialog|rail-tasks|show-tasks/)
})


test('S1b opening the application shows pending device notice; settings allows or denies with CSRF and clears account data on logout', async () => {
  const pendingDevices = { A: [{ id: 'pending-one', name: 'Synthetic phone', fingerprint: 'synthetic-key', requestedAt: '2026-10-07T00:00:00Z' }], B: [] }
  const page = harness([], [], true, { profileAccounts: {
    A: { ownerId: 'owner-a', username: 'Account A', displayName: 'A', avatar: null, profileRevision: 0 },
    B: { ownerId: 'owner-b', username: 'Account B', displayName: 'B', avatar: null, profileRevision: 0 },
  }, pendingDevices })
  await flush()
  assert.equal(page.get('pending-device-badge').hidden, false)
  assert.equal(page.get('pending-devices').hidden, false)
  assert.equal(page.get('pending-device-list').children.length, 1)
  const allow = page.get('pending-device-list').querySelectorAll('button').find(button => button.textContent === '允许')!
  allow.fire('click')
  await flush()
  const write = page.requests.find(request => request.url.endsWith('/pending-one/decision'))!
  assert.equal(JSON.parse(write.options.body).decision, 'allow')
  assert.equal(write.options.headers['X-WeftMate-CSRF'], 'csrf-A')
  assert.equal(page.get('pending-device-badge').hidden, true)
  pendingDevices.A.push({ id: 'pending-two', name: 'Another phone', fingerprint: 'other-key', requestedAt: '2026-10-07T00:00:00Z' })
  page.get('devices-refresh').fire('click')
  await flush()
  page.get('pending-device-list').querySelectorAll('button').find(button => button.textContent === '拒绝')!.fire('click')
  await flush()
  assert.equal(JSON.parse(page.requests.find(request => request.url.endsWith('/pending-two/decision'))!.options.body).decision, 'deny')
  page.get('logout-button').fire('click')
  await flush()
  assert.equal(page.get('pending-device-list').children.length, 0)
  assert.equal(page.get('pending-device-badge').hidden, true)
})

test('model maintenance keeps the desktop button waiting through a two-minute load and sends one restart', async () => {
  let now = 0;
  const deadlines: Array<{ due: number; controller: AbortController }> = [];
  const restart = deferred<ReturnType<typeof reply>>();
  const system = { canRestart: true, queue: {}, model: { state: 'ready', canRestart: true, contextWindow: 98304 },
    host: { state: 'ready', canRestart: true }, memory: { state: 'disabled', canRestart: false } };
  const page = harness([], [], false, { systemRead: system,
    abortSignal: { timeout(ms) { const controller = new AbortController(); deadlines.push({ due: now + ms, controller }); return controller.signal } },
    restartRead: (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
      restart.promise.then(resolve, reject);
    }) });
  await flush(); page.get('show-account').fire('click'); await flush(); await flush();
  const button = page.get('system-services').children[0].children[1];
  button.fire('click'); await flush();
  now = 120_000; for (const entry of deadlines) if (entry.due <= now) entry.controller.abort();
  await flush(); assert.equal(button.disabled, true); assert.equal(button.textContent, '重启中…');
  assert.equal(page.requests.filter(row => row.url.endsWith('/system/model/restart')).length, 1);
  restart.resolve(reply(system)); await flush(); await flush();
  assert.equal(page.get('system-notice').textContent, '已更新');
  assert.equal(page.get('system-services').children[0].children[1].disabled, false);
});
