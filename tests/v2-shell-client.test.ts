import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const skeleton = readFileSync(new URL('../../Design/design-language/skeleton-v2.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const scopedSkeleton = readFileSync(new URL('../src/plugins/weftmate-client/v2-shell/skeleton-v2.scoped.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('V2 shell attaches only to the pinned AppFrame overlay parent and leaves official columns mounted', () => {
  assert.match(client, /function installPinnedDshLayoutAdapter\(layout\)/)
  assert.match(client, /document\.querySelector\('\[data-shell-overlay\]'\)/)
  assert.match(client, /var frame = overlay && overlay\.parentElement/)
  assert.match(client, /frame\.children\.length < 4/)
  assert.match(client, /data-weftmate-v2-layout', 'unsupported'/)
  assert.match(client, /data-weftmate-v2-sidebar/)
  assert.match(client, /data-weftmate-v2-center/)
  assert.match(client, /data-weftmate-v2-details/)
  const adapter = client.slice(client.indexOf('function installPinnedDshLayoutAdapter'), client.indexOf('function installWeftmateV2ShellStyle'))
  assert.match(adapter, /new MutationObserver\(function \(\) \{/)
  assert.match(adapter, /attributeFilter: \['data-sidebar-collapsed'\]/)
  assert.match(adapter, /restoreAttempted/)
  assert.match(adapter, /initialTimer = setTimeout\(restoreWideSidebar, 0\)/)
  assert.match(adapter, /wasWide = false/)
  assert.match(adapter, /if \(wasWide === true\) return/)
  assert.match(adapter, /data-weftmate-v2-sidebar-restore-failed/)
  assert.match(adapter, /window\.addEventListener\('resize', restoreWideSidebar\)/)
  assert.doesNotMatch(adapter, /appendChild\(sidebar|appendChild\(center|appendChild\(details/)
})

test('V2 shell uses the frozen product dimensions and bounded responsive concession', () => {
  assert.match(client, /height:44px/)
  assert.match(client, /width:60px/)
  assert.match(client, /height:52px/)
  assert.match(client, /width:236px/)
  assert.match(client, /width:288px/)
  assert.match(client, /--dsh-chat-content-width:760px/)
  assert.match(client, /height:30px/)
  assert.match(client, /inset:44px 0 30px 60px/)
  assert.match(client, /\[data-weftmate-v2-sidebar\],\[data-weftmate-v2-center\],\[data-weftmate-v2-details\]/)
  assert.match(client, /column\.inert = nonChat/)
  assert.doesNotMatch(client, /frame\.inert = nonChat/)
  assert.match(client, /@media\(max-width:1240px\)/)
  assert.match(client, /@media\(max-width:980px\)/)
  assert.match(client, /\[data-weftmate-v2-frame\]:not\(\[data-details-collapsed\]\) \[data-shell-overlay\] \.weftmate-v2-work\{display:none\}/)
  assert.doesNotMatch(client, /\[data-weftmate-v2-frame\]:not\(\[data-details-collapsed\]\)~\[data-shell-overlay\]/)
  assert.match(main, /const TITLE_BAR_OVERLAY_HEIGHT = 44;/)
})

test('compact workbench uses an explicit drawer state while wide layout keeps its column state', () => {
  function root(initial: string[] = []) {
    const attributes = new Set(initial)
    return {
      hasAttribute(name: string) { return attributes.has(name) },
      toggleAttribute(name: string) { if (attributes.has(name)) { attributes.delete(name); return false } attributes.add(name); return true },
      removeAttribute(name: string) { attributes.delete(name) },
    }
  }
  const source = client.slice(client.indexOf('function v2WorkbenchVisible('), client.indexOf('function useV2ColumnVisibility('))
  const compactRoot = root()
  const compactWindow = { innerWidth: 687 }
  const helpers = new Function('document', 'window', `${source}; return { v2WorkbenchVisible, toggleV2Workbench, closeV2WorkbenchDrawer }`)(
    { documentElement: compactRoot }, compactWindow,
  ) as { v2WorkbenchVisible: (root: any, frame: any, width: number) => boolean, toggleV2Workbench: () => void, closeV2WorkbenchDrawer: () => void }
  const closedFrame = root(['data-details-collapsed'])
  assert.equal(helpers.v2WorkbenchVisible(compactRoot, closedFrame, 687), false)
  helpers.toggleV2Workbench()
  assert.equal(helpers.v2WorkbenchVisible(compactRoot, closedFrame, 687), true, '687px CSS viewport click opens the workbench drawer')
  helpers.toggleV2Workbench()
  assert.equal(helpers.v2WorkbenchVisible(compactRoot, closedFrame, 687), false, 'a second click closes it')
  helpers.toggleV2Workbench(); helpers.closeV2WorkbenchDrawer()
  assert.equal(helpers.v2WorkbenchVisible(compactRoot, closedFrame, 687), false, 'route/session cleanup closes the compact drawer')
  compactWindow.innerWidth = 1024
  helpers.toggleV2Workbench()
  assert.equal(helpers.v2WorkbenchVisible(compactRoot, closedFrame, 1024), true, '1024px also uses the same drawer state')
  helpers.closeV2WorkbenchDrawer()
  compactWindow.innerWidth = 1280
  assert.equal(helpers.v2WorkbenchVisible(compactRoot, closedFrame, 1280), true, 'wide layout is visible unless the user explicitly hides it')
  helpers.toggleV2Workbench()
  assert.equal(helpers.v2WorkbenchVisible(compactRoot, closedFrame, 1280), false, 'wide toggle still uses its persistent column state')
  assert.equal(helpers.v2WorkbenchVisible(compactRoot, root(), 1280), false, 'official details retains its exclusive right column')
  assert.match(client, /@media\(max-width:1240px\).*data-weftmate-v2-work-drawer-open.*width:min\(288px,calc\(100vw - 60px\)\)/)
  assert.match(client, /aria-label': '关闭工作台栏'/)
  assert.match(client, /React\.useEffect\(function \(\) \{ if \(pageKey !== 'chat'\) closeV2WorkbenchDrawer\(\) \}, \[pageKey\]\)/)
  assert.match(client, /React\.useEffect\(function \(\) \{ closeV2WorkbenchDrawer\(\) \}, \[currentSession && currentSession\.id\]\)/)
})

function createAdapterHarness(width: number, toggle: () => void) {
  function element(initial: string[] = []) {
    const attributes = new Map(initial.map((name) => [name, '']))
    return {
      hasAttribute(name: string) { return attributes.has(name) },
      getAttribute(name: string) { return attributes.has(name) ? attributes.get(name)! : null },
      setAttribute(name: string, value = '') { attributes.set(name, value) },
      removeAttribute(name: string) { attributes.delete(name) },
    }
  }
  const frameAttributes = element(['data-sidebar-collapsed'])
  const sidebar = Object.assign(element(), { firstElementChild: element() })
  const frame = {
    ...frameAttributes,
    children: [sidebar, element(), element(), element()],
  }
  const overlay = { parentElement: frame }
  const root = element()
  const listeners = new Map<string, () => void>()
  let observer: { callback: () => void; disconnected: boolean } | undefined
  class FakeMutationObserver {
    callback: () => void
    disconnected = false
    constructor(callback: () => void) { this.callback = callback; observer = this }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  const fakeWindow = {
    innerWidth: width,
    addEventListener(name: string, callback: () => void) { listeners.set(name, callback) },
    removeEventListener(name: string) { listeners.delete(name) },
  }
  const source = client.slice(client.indexOf('function installPinnedDshLayoutAdapter'), client.indexOf('function installWeftmateV2ShellStyle'))
  const install = new Function('document', 'window', 'MutationObserver', 'setTimeout', 'clearTimeout', `${source}; return installPinnedDshLayoutAdapter`)(
    { querySelector(selector: string) { return selector === '[data-shell-overlay]' ? overlay : null }, documentElement: root },
    fakeWindow,
    FakeMutationObserver,
    (callback: () => void) => { callback(); return 1 },
    () => {},
  ) as (layout: { toggleSidebar: () => void }) => () => void
  return { frame, root, fakeWindow, listeners, observer: () => observer, install: () => install({ toggleSidebar: toggle }) }
}

test('V2 sidebar correction fixes an initially collapsed wide frame once, preserves later manual choice, and cleans up', () => {
  let toggles = 0
  let harness!: ReturnType<typeof createAdapterHarness>
  harness = createAdapterHarness(1200, () => { toggles += 1; harness.frame.removeAttribute('data-sidebar-collapsed') })
  const dispose = harness.install()
  assert.equal(toggles, 1, 'an initially collapsed wide frame gets one corrective toggle')
  assert.equal(harness.frame.hasAttribute('data-weftmate-v2-frame'), true)

  harness.frame.setAttribute('data-sidebar-collapsed')
  harness.observer()!.callback()
  harness.listeners.get('resize')!()
  assert.equal(toggles, 1, 'observer and unchanged-wide resize cannot override a later manual toggle')

  harness.fakeWindow.innerWidth = 940
  harness.listeners.get('resize')!()
  harness.fakeWindow.innerWidth = 1200
  harness.listeners.get('resize')!()
  assert.equal(toggles, 2, 'a later narrow-to-wide entry gets one fresh correction')
  dispose()
  assert.equal(harness.observer()!.disconnected, true)
  assert.equal(harness.listeners.has('resize'), false)
  assert.equal(harness.frame.hasAttribute('data-weftmate-v2-frame'), false)
  assert.equal(harness.frame.children[0].hasAttribute('data-weftmate-v2-sidebar'), false)
  assert.equal(harness.frame.children[0].firstElementChild.hasAttribute('data-weftmate-v2-sidebar-content'), false)
  assert.equal(harness.root.hasAttribute('data-weftmate-v2-layout'), false)
})

test('V2 shell column controls report the effective manual, responsive, and details-seat visibility', () => {
  assert.match(client, /function useV2ColumnVisibility\(\)/)
  assert.match(client, /window\.innerWidth > 980/)
  assert.match(client, /if \(width <= 1240\) return root\.hasAttribute\('data-weftmate-v2-work-drawer-open'\)/)
  assert.match(client, /!frame\.hasAttribute\('data-details-collapsed'\)/)
  assert.match(client, /var frame = document\.querySelector\('\[data-weftmate-v2-frame\]'\) \|\| overlay && overlay\.parentElement/)
  assert.match(client, /attributeFilter: \['data-weftmate-v2-sessions-hidden', 'data-weftmate-v2-work-hidden', 'data-weftmate-v2-work-drawer-open', 'data-weftmate-v2-frame', 'data-details-collapsed'\]/)
  assert.match(client, /'aria-pressed': String\(columnVisibility\.sessions\)/)
  assert.match(client, /'aria-expanded': String\(columnVisibility\.sessions\)/)
  assert.match(client, /'aria-pressed': String\(columnVisibility\.work\)/)
  assert.match(client, /'aria-expanded': String\(columnVisibility\.work\)/)
  assert.match(client, /'icon-btn' \+ \(columnVisibility\.sessions \? ' on' : ''\)/)
  assert.match(client, /'icon-btn' \+ \(columnVisibility\.work \? ' on' : ''\)/)
})

test('Mods request guard rejects stale async responses, duplicate project actions, and post-unmount updates', async () => {
  const source = client.slice(client.indexOf('function createModsRequestGuard'), client.indexOf('function V2ModsWorkspace'))
  const createGuard = new Function(`${source}; return createModsRequestGuard`)() as () => {
    begin(sessionId: string, scope?: string): { sessionId: string, generation: number }
    read(sessionId: string, scope: string, channel: string): { sessionId: string, generation: number, channel: string, read: number }
    current(token: { sessionId: string, generation: number }, sessionId: string): boolean
    beginAction(sessionId: string, projectId: string): { sessionId: string, projectId: string, generation: number, key: string } | null
    finishAction(token: { sessionId: string, projectId: string, generation: number, key: string }, sessionId: string): boolean
    dispose(): void
  }
  const guard = createGuard()
  const oldList = guard.read('session-a', 'list', 'list')
  const currentList = guard.read('session-b', 'list', 'list')
  assert.equal(guard.current(oldList, 'session-b'), false, 'a delayed list/detail response cannot update after session switch')
  assert.equal(guard.current(currentList, 'session-b'), true)
  const action = guard.beginAction('session-b', 'project-1')
  assert.ok(action)
  assert.equal(guard.beginAction('session-b', 'project-1'), null, 'a pending start/stop rejects duplicate requests for the same project')
  const readOne = guard.read('session-b', 'list', 'detail:project-1')
  const readTwo = guard.read('session-b', 'list', 'detail:project-1')
  assert.equal(guard.current(readOne, 'session-b'), false, 'read1 cannot overwrite read2 in the same scope and channel')
  assert.equal(guard.current(readTwo, 'session-b'), true)
  assert.equal(guard.finishAction(action, 'session-b'), true, 'repeated same-scope polling or refresh cannot invalidate a pending action')
  const changedOwnerAction = guard.beginAction('session-b', 'project-1')!
  let release!: () => void
  const delayedFailure = new Promise<void>((resolve) => { release = resolve })
  const lateResult = delayedFailure.then(() => guard.finishAction(changedOwnerAction, 'session-a'))
  release()
  assert.equal(await lateResult, false, 'a delayed action failure cannot update after ownership changes')
  const detailRead = guard.read('session-b', 'project-1', 'detail:project-1')
  const routeAction = guard.beginAction('session-b', 'project-2')!
  guard.begin('session-b', 'list')
  assert.equal(guard.current(detailRead, 'session-b'), false, 'returning to list invalidates a detail read')
  assert.equal(guard.finishAction(routeAction, 'session-b'), false, 'returning to list rejects a detail-scope action response')
  guard.dispose()
  assert.equal(guard.current(currentList, 'session-b'), false, 'unmount invalidates in-flight responses')
})

test('Mods maintainer navigation permits only the intended session arrival while mounted', () => {
  const source = client.slice(client.indexOf('function createModsNavigationGuard'), client.indexOf('function currentModProject'))
  const createNavigationGuard = new Function(`${source}; return createModsNavigationGuard`)() as () => { begin(target: string): { sequence: number, targetSessionId: string }, current(token: { sequence: number, targetSessionId: string }): boolean, dispose(): void }
  const guard = createNavigationGuard()
  const normal = guard.begin('maintainer')
  assert.equal(guard.current(normal), true, 'from owner to target maintainer remains eligible')
  const laterUserChoice = guard.begin('other')
  assert.equal(guard.current(normal), false, 'a later navigation invalidates the old completion')
  assert.equal(guard.current(laterUserChoice), true)
  guard.dispose()
  assert.equal(guard.current(laterUserChoice), false, 'unmount prevents a delayed sessions.open completion from navigating')
})

test('Mods card state takes the same-id detail receipt over stale list state after an action', () => {
  const source = client.slice(client.indexOf('function currentModProject'), client.indexOf('function V2ModsWorkspace'))
  const currentProject = new Function(`${source}; return currentModProject`)() as (project: object, detail: object) => { health: string, desiredState: string }
  const staleList = { projectId: 'project-1', health: 'stopped', desiredState: 'stopped' }
  const actionReceipt = { project: { projectId: 'project-1', health: 'running', desiredState: 'running' }, controls: { canStart: false, canStop: true } }
  assert.deepEqual(currentProject(staleList, actionReceipt), actionReceipt.project, 'the post-action detail receipt is the card rendering source')
  assert.equal(currentProject(staleList, { project: { projectId: 'other', health: 'running' } }), staleList, 'a mismatched detail cannot overwrite another card')
})

test('V2 shell exposes Chat and real Mods without replacing official conversation behavior or inventing a settings opener', () => {
  assert.match(client, /function WeftMateV2Shell\(props\)/)
  assert.match(client, /choose\('chat'\)/)
  assert.match(client, /choose\('mods'\)/)
  assert.match(client, /ctx\.slots\.inject\('sidebar\.workspaces'/)
  assert.match(client, /name: 'sidebar\.workspaces', id: 'weftmate-v2-sessions', priority: -100/)
  assert.match(client, /\.oC7kBG_footArea\{position:fixed;z-index:30;left:6px;top:var\(--weftmate-v2-settings-top\);bottom:auto;width:48px/)
  assert.match(client, /\.oC7kBG_logoRow,\.oC7kBG_newSession\{display:none!important\}/)
  assert.match(client, /\[data-weftmate-v2-sidebar\] \.oC7kBG_settingsArea \.ksvqgW_trigger,\[data-weftmate-v2-sidebar\] \.oC7kBG_settingsArea \.ksvqgW_trigger\.ksvqgW_rail\{border-radius:10px;justify-content:center;flex-direction:column;gap:3px;width:48px/)
  assert.match(client, /\.ksvqgW_trigger::after\{content:attr\(data-weftmate-settings-label\);line-height:1\}/)
  assert.match(client, /html\[data-weftmate-v2-page="mods"\] \.weftmate-v2-sessions\{display:none!important\}/)
  assert.match(client, /\[data-weftmate-v2-sidebar\] \.oC7kBG_root\{box-sizing:border-box!important;width:236px!important;max-width:236px!important;padding:0!important\}/)
  assert.match(client, /\[data-weftmate-v2-sidebar\] \.oC7kBG_regionArea\{width:236px!important;margin:0!important;padding:0!important\}/)
  assert.match(client, /\[data-weftmate-v2-sidebar\] \.weftmate-v2-sessions\.sess-col\{box-sizing:border-box;position:relative;z-index:20;width:236px;height:100%;flex-shrink:0;background:var\(--weftmate-surface\);border-right:1px solid var\(--weftmate-hairline\)/)
  assert.match(client, /\.weftmate-v2-sessions \.sess-node:hover \.mini,\.weftmate-v2-sessions \.sess-node:focus-within \.mini/)
  assert.doesNotMatch(client, /function openOfficialSettings\(\)/)
  assert.doesNotMatch(client, /会话列表正在接入正式工作区视图/)
  assert.match(client, /function V2ModsWorkspace\(props\)/)
  assert.match(client, /React\.useSyncExternalStore/)
  assert.match(client, /window\.location\.hash = '\/mod\/'/)
  assert.match(client, /React\.createElement\(ModBusinessFrame/)
  assert.match(client, /id: 'weftmate-v2-shell'/)
  assert.match(client, /installWeftmateV2Style\(\)/)
  assert.match(client, /installWeftmateV2ShellStyle\(\)/)
  assert.match(client.slice(client.indexOf('function WeftMateV2Shell'), client.indexOf('\n    return {\n      name:')), /setModProjects\(data\.projects\)/)
  assert.match(client, /modProjects: modProjects/)
})

test('V2 session sidebar projects only ready, non-archived top-level sessions once', () => {
  const source = client.slice(client.indexOf('function isSidebarVisibleSession'), client.indexOf('function V2SessionSidebar'))
  const derive = new Function(`${source}; return deriveV2SessionGroups`)() as (sessions: object, workspaces: object) => {
    ready: boolean
    mods: Array<{ key: string, label: string, sessions: Array<{ id: string }> }>
    projects: Array<{ workspace: { workspaceId: string }, sessions: Array<{ id: string }> }>
    recent: Array<{ id: string }>
  }
  const sessions = {
    phase: 'ready', current: 'blank-current',
    ids: ['mod', 'project', 'recent', 'archived', 'child', 'blank-current', 'blank-other'],
    byId: {
      mod: { id: 'mod', displayTitle: '真实维护会话', agentPreset: 'mod-maintainer', running: true, blank: false, updatedAt: 3 },
      project: { id: 'project', displayTitle: '项目会话', running: false, blank: false, updatedAt: 2 },
      recent: { id: 'recent', displayTitle: '最近会话', running: false, blank: false, updatedAt: 4 },
      archived: { id: 'archived', displayTitle: '归档', running: false, blank: false, updatedAt: 9 },
      child: { id: 'child', displayTitle: '子代理', origin: 'subagent', running: true, blank: false, updatedAt: 8 },
      'blank-current': { id: 'blank-current', displayTitle: '新会话', running: false, blank: true, updatedAt: 1 },
      'blank-other': { id: 'blank-other', displayTitle: '隐藏空会话', running: false, blank: true, updatedAt: 10 },
    },
  }
  const result = derive(sessions, { phase: 'ready', archivedSessionIds: ['archived'], items: [{ workspaceId: 'workspace-a', title: '项目 A', sessionIds: ['project', 'mod'] }] }, [{ projectId: 'mod-project', name: '真实 Mod', maintainerSessionId: 'mod' }])
  assert.equal(result.ready, true)
  assert.deepEqual(result.mods.map((group) => [group.label, group.sessions.map((session) => session.id)]), [['真实 Mod', ['mod']]], 'explicit project relation names the Mod node and wins over workspace membership')
  assert.deepEqual(result.projects[0].sessions.map((session) => session.id), ['project'], 'a Mod session is not duplicated under a project')
  assert.deepEqual(result.recent.map((session) => session.id), ['recent', 'blank-current'], 'recent receives only remaining visible sessions in newest-first order')
  assert.equal(new Set([...result.mods.flatMap((group) => group.sessions), ...result.projects[0].sessions, ...result.recent].map((session) => session.id)).size, 4)
  const groupedOnly = derive({ ...sessions, current: 'project', ids: ['mod', 'project'] }, { phase: 'ready', archivedSessionIds: [], items: [{ workspaceId: 'workspace-a', title: '项目 A', sessionIds: ['project'] }] }, [{ projectId: 'mod-project', name: '真实 Mod', maintainerSessionId: 'mod' }])
  assert.deepEqual(groupedOnly.recent, [], 'all project/Mod sessions leave no redundant global 最近 group')
  assert.equal(derive({ ...sessions, phase: 'pending' }, { phase: 'ready', archivedSessionIds: [], items: [] }, []).ready, false, 'partial baselines never render an empty tree as authoritative')
})

test('Scoped skeleton mechanically extends the existing shell scope to the real sidebar root without changing its body', () => {
  assert.match(scopedSkeleton, /^@scope \(.weftmate-v2-shell, .weftmate-v2-sessions\) \{\n/)
  const centralStart = scopedSkeleton.indexOf('\n/* Central official DSH column:')
  assert.ok(centralStart > 0)
  const scopedOnly = scopedSkeleton.slice(0, centralStart)
  const unwrapped = scopedOnly.replace(/^@scope \(.weftmate-v2-shell, .weftmate-v2-sessions\) \{\n/, '').replace(/\n\}\s*$/, '')
  assert.equal(createHash('sha256').update(unwrapped).digest('hex'), '4bf34e4dd87fdd44ef31dbf9c0f5410b09fb04946ecb8d1afbdb9665cd281bcc', 'dropping the wrapper leaves the established scoped body byte-for-byte unchanged')
  assert.match(scopedSkeleton.slice(centralStart), /\[data-weftmate-v2-center\]\{/)
  assert.match(scopedSkeleton.slice(centralStart), /body:not\(\[data-ds-dark-theme\]\) \[data-weftmate-v2-center\]/)
})

test('V2 session sidebar keeps the formal action boundary and disabled unavailable actions visible', () => {
  const sidebar = client.slice(client.indexOf('function V2SessionSidebar'), client.indexOf('function WeftMateV2Shell'))
  assert.match(sidebar, /props\.workspaces\.archiveSession\(id\)/)
  assert.match(sidebar, /props\.workspaces\.insertSessionBefore\(workspaceId, id, beforeId\)/)
  assert.match(sidebar, /props\.workspaces\.rename\(workspaceId, clean\)/)
  assert.match(sidebar, /props\.sessions\.binding\(id\)/)
  assert.match(sidebar, /await binding\.session\.rename\(clean\)/)
  assert.match(sidebar, /!result \|\| !result\.ok/)
  assert.match(sidebar, /当前没有正式删除会话或取消归档接口/)
  assert.match(sidebar, /当前没有将会话加入或移出项目的正式接口/)
  assert.match(client, /weftmate-v2-session-sidebar/)
  assert.match(sidebar, /\/weftmate\/mods\/projects\.json\?session_id=/)
  assert.match(sidebar, /modRelation\.sessionId === current \? modRelation\.projects : \[\]/)
  assert.match(sidebar, /cancelled = true; controller\.abort\(\)/)
  assert.match(client, /project && \(project\.maintainerSessionId \|\| project\.maintainer_session_id\)/)
  assert.match(sidebar, /'data-theme': sidebarTheme/)
  assert.match(sidebar, /document\.body\.hasAttribute\('data-ds-dark-theme'\) \? 'dark' : 'light'/)
  assert.match(sidebar, /function toggleWorkspacePin\(id\)/)
  assert.match(sidebar, /pinnedWorkspaces\.has\(target\.id\) \? '取消置顶项目' : '置顶项目'/)
  assert.match(sidebar, /pinnedWorkspaces\.has\(b\.workspace\.workspaceId\)/)
  assert.match(sidebar, /function pinIcon\(label\).*M12 16v5/)
  assert.match(sidebar, /function folderIcon\(closed\)/)
  assert.match(sidebar, /function modIcon\(\)/)
  assert.match(client, /pinnedWorkspaces: value && Array\.isArray\(value\.pinnedWorkspaces\)/)
})

test('V2 session sidebar keeps project and Mod quick entries on empty roots and uses only formal host operations', () => {
  const sidebar = client.slice(client.indexOf('function V2SessionSidebar'), client.indexOf('function WeftMateV2Shell'))
  assert.match(sidebar, /roots\.push\(renderRoot\('projects', '项目'/, 'the project root remains available without an existing workspace')
  assert.match(sidebar, /roots\.push\(renderRoot\('mods', 'Mod'/, 'the Mod root remains available without an existing Mod')
  assert.match(sidebar, /props\.workspaces\.listDirectory\(path\)/, 'project creation uses the formal browse directory flow available to browser and desktop hosts')
  assert.match(sidebar, /props\.workspaces\.create\(\{ path: path \}\)/, 'project registration uses the formal workspace create operation')
  assert.match(sidebar, /props\.startSession\(workspace\.workspaceId\)/, 'a created project opens through the existing workspace session route')
  assert.match(sidebar, /options\.workspaceId = targetWorkspace\.workspaceId/, 'a new maintainer avoids inheriting another Mod maintenance directory')
  assert.match(sidebar, /var sessionId = await props\.sessions\.create\(options\)/, 'the Mod quick entry first uses the formal runtime create so the new session is hydrated')
  assert.match(sidebar, /api\.agentPresets\.select\(\{ sessionId: sessionId, agentPreset: 'mod-maintainer' \}\)/, 'the host selects the preset through the official blank-session selection flow')
  assert.match(sidebar, /props\.sessions\.noteAgentPreset\(sessionId, selected\.agentPreset\)/, 'the local projection changes only after the host accepts the preset selection receipt')
  assert.match(sidebar, /session\.agentPreset === 'mod-maintainer'/, 'the maintenance creation waits for the projected preset receipt')
  assert.match(sidebar, /setInterval\(function \(\) \{ loadRelation\(false\) \}, 2000\)/, 'the active maintenance session refreshes actual host binding after creation')
  assert.match(client, /projectId: projectId, maintainerSessionId: maintainerSessionId \|\| null/, 'a concrete Mod relation retains its durable ids for actions')
  assert.match(sidebar, /window\.location\.hash = '\/mods'/, 'a concrete Mod action opens its existing management page')
  assert.match(client, /mod:fallback.*projectId: null/, 'preset-only sessions remain a fallback group and do not masquerade as a Mod project')
})

test('V2 session sidebar action gate rejects two create clicks in one render turn and releases after completion', () => {
  const source = client.slice(client.indexOf('function createSidebarActionGate'), client.indexOf('function downloadSessionLog'))
  const gate = new Function(`${source}; return createSidebarActionGate`)()() as { begin(): boolean, finish(): void, pending(): boolean }
  let creates = 0
  const startMaintainer = () => { if (!gate.begin()) return; creates += 1 }
  startMaintainer(); startMaintainer()
  assert.equal(creates, 1, 'two synchronous clicks issue only one maintenance create request')
  assert.equal(gate.pending(), true)
  gate.finish()
  startMaintainer()
  assert.equal(creates, 2, 'a later click is accepted after the first request settles')
})

test('V2 session content shadows the official workspace region while the official sidebar keeps settings/footer ownership in either region load order', async () => {
  const { SlotCore } = await import(new URL('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js', import.meta.url).href)
  const sidebarChildren = {
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
    'sidebar.settings': { kind: 'single', scope: 'root' },
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
  }
  for (const v2First of [false, true]) {
    const slots = new SlotCore()
    slots.register({ name: 'root', children: { sidebar: { kind: 'single', scope: 'root' } } }, null)
    slots.register({ name: 'sidebar', priority: 0, children: sidebarChildren }, 'official-sidebar')
    const registerV2 = () => slots.register({ name: 'sidebar.workspaces', id: 'weftmate-v2-sessions', priority: -100 }, 'weftmate-session-tree')
    const registerOfficialWorkspace = () => slots.register({ name: 'sidebar.workspaces', priority: 0, children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } } }, 'official-workspace-browser')
    if (v2First) { registerV2(); registerOfficialWorkspace() } else { registerOfficialWorkspace(); registerV2() }
    slots.register({ name: 'sidebar.settings', priority: 0 }, 'official-settings-trigger')
    slots.register({ name: 'sidebar.footer.action', id: 'official-footer-action', priority: 0 }, 'official-footer-action')
    assert.deepEqual(slots.entriesOfSlot('sidebar').map((entry: { component: string }) => entry.component), ['official-sidebar'])
    assert.deepEqual(slots.entriesOfSlot('sidebar.workspaces').map((entry: { component: string }) => entry.component), ['weftmate-session-tree'])
    assert.deepEqual(slots.entriesOfSlot('sidebar.settings').map((entry: { component: string }) => entry.component), ['official-settings-trigger'])
    assert.deepEqual(slots.entriesOfSlot('sidebar.footer.action').map((entry: { component: string }) => entry.component), ['official-footer-action'])
  }
  assert.doesNotMatch(client, /name: 'sidebar', id: 'weftmate-v2-sessions', priority: -100, children/)
})

test('V2 session menu reuses the frozen Kimi ctx-menu structure and values', () => {
  const sidebar = client.slice(client.indexOf('function V2SessionSidebar'), client.indexOf('function WeftMateV2Shell'))
  assert.match(sidebar, /className: 'ctx-menu open'/)
  assert.match(sidebar, /className: 'ctx-item'/)
  assert.match(sidebar, /className: 'ctx-sep'/)
  assert.match(sidebar, /roots\.push\(renderRoot\('projects', '项目'/)
  assert.match(sidebar, /roots\.push\(renderRoot\('mods', 'Mod'/)
  assert.match(sidebar, /if \(recent\.length\) roots\.push\(renderGroup\('recent', '最近', recent\)\)/)
  assert.doesNotMatch(sidebar, /renderGroup\('recent', '最近', recent\)\)\), feedback/)
  assert.match(sidebar, /React\.createElement\('svg', \{ className: 'chev'/)
  assert.doesNotMatch(client, /\.sess-menu\{position:fixed;z-index:2147482000;min-width:164px/)
  assert.match(skeleton, /\.ctx-menu\{position:fixed;z-index:150;min-width:200px;padding:5px/)
  assert.match(skeleton, /border-radius:12px/)
  assert.match(skeleton, /box-shadow:var\(--weftmate-shadow-3\)/)
})

test('V2 session sidebar waits for a formal snapshot echo and surfaces a missing echo as failure', async () => {
  const source = client.slice(client.indexOf('function waitForSidebarSnapshot'), client.indexOf('function V2SessionSidebar'))
  let timeout: (() => void) | undefined
  const wait = new Function('setTimeout', 'clearTimeout', `${source}; return waitForSidebarSnapshot`)(
    (callback: () => void) => { timeout = callback; return 1 },
    () => {},
  ) as (store: { getSnapshot(): unknown, subscribe(listener: () => void): () => void }, accepted: (snapshot: unknown) => boolean) => Promise<void>
  let snapshot = { title: 'before' }
  let listener: (() => void) | undefined
  let unsubscribed = false
  const store = { getSnapshot: () => snapshot, subscribe(next: () => void) { listener = next; return () => { unsubscribed = true } } }
  const accepted = wait(store, (value) => (value as { title: string }).title === 'after')
  snapshot = { title: 'after' }; listener!()
  await accepted
  assert.equal(unsubscribed, true, 'a confirmed snapshot echo releases the subscription')

  const noEcho = wait({ getSnapshot: () => ({ title: 'before' }), subscribe: () => () => {} }, () => false)
  timeout!()
  await assert.rejects(noEcho, /正式列表尚未回显/)
})

test('V2 settings rail position follows the actual Mods item bottom plus the rail gap', () => {
  const shell = client.slice(client.indexOf('function WeftMateV2Shell'), client.indexOf('\n    return {\n      name:'))
  assert.match(shell, /function syncSettingsRailPosition\(\)/)
  assert.match(shell, /rail\.querySelectorAll\('\.rl-item'\)/)
  assert.match(shell, /var gap = Math\.max\(0, second\.top - first\.bottom\)/)
  assert.match(shell, /second\.bottom \+ gap/)
  assert.match(shell, /--weftmate-v2-settings-top/)
})

test('V2 settings rail adapter labels the real trigger through collapsed DOM replacement and disconnects cleanly', () => {
  const source = client.slice(client.indexOf('function installSettingsRailTriggerAdapter'), client.indexOf('// This is a projection only'))
  const attributes = new Map<string, string>()
  const trigger = {
    textContent: '',
    getAttribute(name: string) { return attributes.get(name) ?? null },
    setAttribute(name: string, value: string) { attributes.set(name, value) },
  }
  const seat = { querySelector(selector: string) { return selector === 'button' ? trigger : null } }
  const sidebar = { querySelector(selector: string) { return selector === '.oC7kBG_settingsArea' ? seat : null } }
  let observer: { callback: () => void, disconnected: boolean } | undefined
  class FakeMutationObserver {
    callback: () => void
    disconnected = false
    constructor(callback: () => void) { this.callback = callback; observer = this }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  const install = new Function('document', 'MutationObserver', `${source}; return installSettingsRailTriggerAdapter`)({ querySelector: () => sidebar }, FakeMutationObserver) as () => () => void
  const dispose = install()
  assert.equal(trigger.getAttribute('aria-label'), '设置')
  assert.equal(trigger.getAttribute('title'), '设置')
  assert.equal(trigger.getAttribute('data-weftmate-settings-label'), '设置')
  trigger.textContent = '设置'; observer!.callback()
  assert.equal(trigger.getAttribute('aria-label'), '设置', 'a replacement observation keeps the real trigger named')
  dispose()
  assert.equal(observer!.disconnected, true)
})

test('V2 central hero appears only for a blank plain session and chips write the real draft without submitting', () => {
  const source = client.slice(client.indexOf('function V2ConversationHero'), client.indexOf('function installFrozenV2ShellCss', client.indexOf('function V2ConversationHero')))
  const React = { Fragment: Symbol('fragment'), createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) { return { type, props: props ?? {}, children } } }
  const Hero = new Function('React', `${source}; return V2ConversationHero`)(React) as (props: any) => any
  assert.equal(Hero({ session: { blank: false }, input: { phase: 'plain', draft: '' }, inputActions: { setDraft() {} } }), null)
  assert.equal(Hero({ session: { blank: true }, input: { phase: 'submitting', draft: '' }, inputActions: { setDraft() {} } }), null)
  const writes: string[] = []
  const tree = Hero({ session: { blank: true }, input: { phase: 'plain', draft: '' }, inputActions: { setDraft(value: string) { writes.push(value) } } })
  const chips = tree.children[0].children[2].children[0]
  chips[0].props.onClick()
  assert.deepEqual(writes, ['帮我收藏一个链接'])
  const existing = Hero({ session: { blank: true }, input: { phase: 'plain', draft: '已有草稿' }, inputActions: { setDraft(value: string) { writes.push(value) } } })
  existing.children[0].children[2].children[0][1].props.onClick()
  assert.equal(writes[1], '已有草稿\n做一个桌面宠物', 'chip appends to an existing official draft instead of replacing or submitting it')
  const whitespace = Hero({ session: { blank: true }, input: { phase: 'plain', draft: '   ' }, inputActions: { setDraft(value: string) { writes.push(value) } } })
  whitespace.children[0].children[2].children[0][2].props.onClick()
  assert.equal(writes[2], '   整理本周记忆', 'whitespace-only official drafts are preserved')
  assert.equal(tree.children[1].children[0], 'Enter 发送 · Shift+Enter 换行', 'blank hero carries the real read-only composer hint')
  assert.doesNotMatch(source, /submit\(/)
})

test('V2 central hero adds only the input dock entry and leaves the default conversation children active', async () => {
  const { SlotCore } = await import(new URL('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js', import.meta.url).href)
  const slots = new SlotCore()
  slots.register({ name: 'root', children: { conversation: { kind: 'single', scope: 'root' } } }, null)
  slots.register({ name: 'conversation', children: { 'conversation.session': { kind: 'single', scope: 'session' }, 'conversation.composer': { kind: 'chain', scope: 'session' }, 'conversation.input.dock': { kind: 'list', scope: 'session' }, 'conversation.composer.dock': { kind: 'list', scope: 'session' } } }, 'official-conversation')
  slots.register({ name: 'conversation.session' }, 'official-session')
  slots.register({ name: 'conversation.composer', select: () => null }, 'official-composer')
  slots.register({ name: 'conversation.input.dock', id: 'stats', order: 0 }, 'official-stats')
  slots.register({ name: 'conversation.input.dock', id: 'weftmate-v2-hero', order: -1000 }, 'weftmate-hero')
  slots.register({ name: 'conversation.composer.dock', id: 'stats', order: 0 }, 'official-composer-stats')
  slots.register({ name: 'conversation.composer.dock', id: 'weftmate-v2-hint', order: -1000 }, 'weftmate-hint')
  assert.deepEqual(slots.entriesOfSlot('conversation.input.dock').map((entry: { component: string }) => entry.component), ['weftmate-hero', 'official-stats'])
  assert.equal(slots.entriesOfSlot('conversation.session')[0].component, 'official-session')
  assert.equal(slots.entriesOfSlot('conversation.composer')[0].component, 'official-composer')
  assert.deepEqual(slots.entriesOfSlot('conversation.composer.dock').map((entry: { component: string }) => entry.component), ['weftmate-hint', 'official-composer-stats'])
  assert.match(client, /ctx\.slots\.inject\('conversation\.input\.dock'/)
  assert.match(client, /name: 'conversation\.input\.dock', id: 'weftmate-v2-hero', order: -1000/)
  assert.match(client, /name: 'conversation\.composer\.dock', id: 'weftmate-v2-hint', order: -1000/)
})

test('V2 chat head uses the real session title while the official header retains actionable tools and view tabs', () => {
  const titleSource = client.slice(client.indexOf('function v2ChatTitle'), client.indexOf('function WeftMateV2Shell'))
  const title = new Function(`${titleSource}; return v2ChatTitle`)() as (session?: { blank?: boolean, displayTitle?: string, title?: string }) => string
  assert.equal(title(), '新的对话')
  assert.equal(title({ blank: true, displayTitle: '临时标题' }), '新的对话')
  assert.equal(title({ displayTitle: '真实会话标题' }), '真实会话标题')
  assert.equal(title({ title: '后备标题' }), '后备标题')
  const shell = client.slice(client.indexOf('function WeftMateV2Shell'), client.indexOf('\n    return {\n      name:'))
  assert.match(shell, /v2ChatTitle\(currentSession\)/)
  assert.match(client, /\._0_p9YG_crumbs>\._0_p9YG_crumbCurrent:only-child,\[data-weftmate-v2-center\] \._0_p9YG_crumbSeg:has\(\._0_p9YG_crumb:disabled\)\{display:none\}/)
  assert.match(client, /\[data-weftmate-v2-center\] \._0_p9YG_headerActions,\[data-weftmate-v2-center\] \._0_p9YG_tabs,\[data-weftmate-v2-center\] \._0_p9YG_headerUtilities/)
  assert.match(client, /\._0_p9YG_headerActions,\[data-weftmate-v2-center\] \._0_p9YG_tabs/)
  assert.match(client, /\._0_p9YG_titleRow,\[data-weftmate-v2-center\] \._0_p9YG_titleCluster\{display:contents\}/)
  assert.match(client, /\[data-weftmate-v2-center\] \._0_p9YG_header\._0_p9YG_headerHidden/)
  assert.match(client, /_0_p9YG_headerUtilities\{display:none!important\}/)
})

test('Mods list keeps the frozen page geometry and exposes only contract-backed controls', () => {
  const workspace = client.slice(client.indexOf('function V2ModsWorkspace'), client.indexOf('function useV2ColumnVisibility'))
  assert.match(workspace, /Promise\.all\(\[worker\(\), worker\(\), worker\(\), worker\(\)\]\)/)
  assert.match(workspace, /entry && entry\.value && entry\.value\.controls/)
  assert.match(workspace, /className: 'mc-top'/)
  assert.match(workspace, /role: 'link', tabIndex: 0/)
  assert.match(workspace, /event\.stopPropagation\(\)/)
  assert.match(workspace, /推荐目录尚未接入；安装功能当前不可用。/)
  assert.match(workspace, /disabled: true, 'aria-describedby': 'mod-install-unavailable'/)
  assert.match(client, /\.weftmate-v2-page\.weftmate-v2-mods \.page-head\{padding:0 22px;background:var\(--weftmate-surface\)\}/)
  assert.match(client, /\.weftmate-v2-page\.weftmate-v2-mods \.mod-grid\{padding:0\}/)
})

test('V2 settings accepts only formal DSH envelopes and never fabricates a local revision', () => {
  const source = client.slice(client.indexOf('function dshResultValue'), client.indexOf('function errorText'))
  const unwrap = new Function(`${source}; return dshResultValue`)() as (response: unknown, operation: string) => unknown
  assert.deepEqual(unwrap({ result: { ok: true, value: { namespaces: [] } } }, 'settings.describe'), { namespaces: [] })
  assert.throws(() => unwrap({ result: { ok: false, error: { message: 'revision conflict' } } }, 'settings.mutate'), /revision conflict/)
  assert.throws(() => unwrap({ namespaces: [] }, 'settings.describe'), /invalid response/)
  assert.match(client, /op: 'unset', path: \['providers', id\]/)
  assert.doesNotMatch(client, /setSettingsRev\(function \(r\) \{ return r \+ 1 \}\)/)
})

test('V2 memory keeps a conflict receipt at HTTP 409 and reuses a stable command id for retry', async () => {
  const readerSource = client.slice(client.indexOf('function readJsonOrThrow'), client.indexOf('async function submitMemoryCommand'))
  const read = new Function(`${readerSource}; return readJsonOrThrow`)() as (response: any, label: string) => Promise<any>
  const receipt = { receipt: { result_state: 'revision_conflict' } }
  assert.deepEqual(await read({ ok: false, status: 409, json: async () => receipt }, '记忆操作'), receipt)
  await assert.rejects(read({ ok: false, status: 500, json: async () => ({ error: 'bad' }) }, '记忆操作'), /HTTP 500/)
  assert.match(client, /command_id: stableCommandId\(key\)/)
  assert.match(client, /\['applied', 'no_change', 'revision_conflict', 'rejected'\]/)
})

test('V2 settings persists only the local column view preference and disables host settings without a write API', () => {
  const settings = client.slice(client.indexOf('function V2SettingsWorkspace'), client.indexOf('function V2MemoryWorkspace'))
  assert.match(settings, /localStorage\.getItem\('weftmate\.v2\.columns\.expanded'\)/)
  assert.match(settings, /localStorage\.setItem\('weftmate\.v2\.columns\.expanded', String\(next\)\)/)
  assert.match(settings, /当前宿主没有独立窗口全局设置接口/)
  assert.match(settings, /当前宿主没有权限确认全局设置接口/)
  assert.match(settings, /当前宿主没有自动更新策略设置接口/)
  assert.doesNotMatch(settings, /setSeparateWindow|setConfirmPerm|setAutoUpdate/)
})

test('V2 workbench stops a real bound session and command palette awaits session opening', () => {
  const workbench = client.slice(client.indexOf('function V2Workbench'), client.indexOf('function V2CommandPalette'))
  const command = client.slice(client.indexOf('function V2CommandPalette'), client.indexOf('function WeftMateV2Shell'))
  assert.match(workbench, /props\.sessions\.binding\(currentSession\.id\)/)
  assert.match(workbench, /await binding\.session\.cancel\(\)/)
  assert.match(workbench, /if \(!isRunning && feedback\.indexOf\('已请求停止'\) === 0\) setFeedback\('已停止'\)/)
  assert.match(workbench, /setFeedback\(''\).*currentSession && currentSession\.id/s)
  for (const heading of ['从这里开始', '进行中', '上下文', '可用 Mod']) assert.match(workbench, new RegExp(heading))
  assert.match(workbench, /props\.onNewSession\(\)/)
  assert.match(workbench, /var modProjects = Array\.isArray\(props\.modProjects\)/)
  assert.match(workbench, /memory\.label \+ ' · ' \+ memory\.detail/)
  assert.doesNotMatch(workbench, /会话标识：|currentSession\.id\) :/)
  assert.doesNotMatch(workbench, /本周书单|8\.1k 安装|5\.6k 安装|默认四步/)
  assert.match(command, /fn: async function \(\) \{\s*await props\.sessions\.open\(session\.id\)/)
  assert.match(command, /setCommandError\('无法打开会话：' \+ errorText\(error\)\)/)
  assert.match(client, /Ctrl\+K \/ ⌘K/)
})

test('V2 memory has one Weave entry and settings renders the host product version', () => {
  const apply = client.slice(client.indexOf('apply: function (ctx)'), client.indexOf('\n      },\n    }', client.indexOf('apply: function (ctx)')))
  const settings = client.slice(client.indexOf('function V2SettingsWorkspace'), client.indexOf('function V2MemoryWorkspace'))
  assert.doesNotMatch(apply, /id: 'weftmate-memory'/)
  assert.match(client, /aria-label': '记忆'.*choose\('memory'\)/s)
  assert.equal((client.match(/等待宿主状态返回产品版本/g) || []).length, 0)
  assert.match(settings, /props\.appVersion \|\| '暂不可用'/)
  assert.match(client, /appVersion: appVersion/)
  for (const label of ['回顾共同讨论', '来源与处理进度', '记忆上下文记录', '当前理解中没有匹配项']) assert.match(client, new RegExp(label))
  assert.match(client, /关联记忆已失效；这里只保留历史原文，不再自动召回/)
  assert.match(client, /if \(!next\.trim\(\)\) setResult\(null\)/)
  const interactions = client.slice(client.indexOf('function MemoryInteractions'), client.indexOf('function MemoryRecordedInteraction'))
  assert.match(interactions, /requestRef\.current\.generation \+= 1/)
  assert.match(interactions, /requestRef\.current\.controller\.abort\(\)/)
  assert.match(interactions, /setQuery\(event\.target\.value\); setResult\(null\); setBusy\(false\)/)
  assert.match(interactions, /requestRef\.current\.generation === generation/)
})

test('new-session helper creates or reuses the trusted personal workspace, preserves explicit projects, and exposes failures', async () => {
  const source = client.slice(client.indexOf('var personalWorkspaceStarts = new WeakMap()'), client.indexOf('function V2SettingsWorkspace'))
  const start = new Function('fetch', 'AbortSignal', `${source}; return startWorkspaceSession`)(
    async () => ({ ok: true, json: async () => ({ dataDirs: { workspace: 'D:/isolated/user-workspace' } }) }),
    { timeout: () => undefined },
  ) as (workspaces: any, sessions: any, workspaceId?: string) => Promise<string>
  const items: any[] = []
  let recentWorkspaceId: string | undefined
  let creates = 0; const opened: string[] = []
  const sessions = { list: { getSnapshot: () => ({ current: undefined }) }, async open(id: string) { opened.push(id) } }
  const workspaces = {
    list: { getSnapshot: () => ({ items, recentWorkspaceId }) },
    async create(input: { path: string }) { const prior = items.find(item => item.path === input.path); if (prior) return prior; creates += 1; assert.deepEqual(input, { path: 'D:/isolated/user-workspace' }); const workspace = { workspaceId: 'personal', path: input.path, sessionIds: [] }; items.push(workspace); return workspace },
    async connectWorkspace(id: string) { return `blank-${id}` },
  }
  const [first, second] = await Promise.all([start(workspaces, sessions), start(workspaces, sessions)])
  assert.equal(first, 'blank-personal'); assert.equal(second, 'blank-personal'); assert.equal(creates, 1); assert.deepEqual(opened, ['blank-personal'], 'duplicate clicks share one creation and one open')
  await start(workspaces, sessions, 'project-a')
  assert.equal(creates, 1); assert.equal(opened.at(-1), 'blank-project-a', 'an explicit project remains the target')
  items.push({ workspaceId: 'maintenance', path: 'D:/dsh-home/mod-projects/projects/mod-1/workspace', sessionIds: ['maintainer'] }); recentWorkspaceId = 'maintenance'
  await start(workspaces, sessions)
  assert.equal(opened.at(-1), 'blank-personal', 'implicit new chat never inherits the most recent Mod maintenance workspace')
  const rejected = new Function('fetch', 'AbortSignal', `${source}; return startWorkspaceSession`)(async () => ({ ok: true, json: async () => ({ dataDirs: { workspace: null } }) }), { timeout: () => undefined })
  await assert.rejects(rejected({ list: { getSnapshot: () => ({ items: [], recentWorkspaceId: undefined }) }, create: workspaces.create, connectWorkspace: workspaces.connectWorkspace }, sessions), /个人工作区位置/)
})

test('new provider form keeps a stable key while its editable route id changes and names keyboard fields', () => {
  const form = client.slice(client.indexOf('function renderProviderForm'), client.indexOf('var presetsState'))
  assert.match(form, /var formId = item\.isNew \? 'provider-form-new'/)
  assert.match(form, /key: formId/)
  for (const label of ['提供方标识', '显示名称', 'API 地址', 'API 密钥', '模型标识', '上下文窗口']) assert.match(form, new RegExp("aria-label': '" + label + "'"))
  assert.match(form, /htmlFor: formId \+ '-id'/)
})
