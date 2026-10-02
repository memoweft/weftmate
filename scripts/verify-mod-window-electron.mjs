// Isolated native BrowserWindow verification entry. It never loads the user's
// DSH profile or data: a tiny loopback server supplies the same trusted Mod
// wrapper, while the manager receives a deterministic in-memory snapshot.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain } from 'electron'
import { ModWindowManager } from '../src/mod-window-manager.mjs'
import { MOD_WINDOW_CSS, MOD_WINDOW_HTML, MOD_WINDOW_JS } from '../src/plugins/weftmate-client/mod-window/assets.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
app.setPath('userData', mkdtempSync(join(tmpdir(), 'weftmate-mod-window-electron-')))
// The probe deliberately closes and reopens its only view. Keep Electron
// alive during that interval so the lifecycle assertion can finish.
app.on('window-all-closed', () => {})
const servers = []
let manager
const diagnostics = []
const option = key => {
  const index = process.argv.indexOf(key)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return typeof value === 'string' && value.length > 0 && !value.startsWith('--') ? value : undefined
}
const realConfig = {
  origin: process.env.WEFTMATE_MOD_WINDOW_ORIGIN ?? option('--mod-window-origin'),
  session: process.env.WEFTMATE_MOD_WINDOW_SESSION ?? option('--mod-window-session'),
  project: process.env.WEFTMATE_MOD_WINDOW_PROJECT ?? option('--mod-window-project'),
  prepare: process.env.WEFTMATE_MOD_WINDOW_PREPARE === '1' || process.argv.includes('--prepare-real-fixture'),
  output: process.env.WEFTMATE_MOD_WINDOW_OUTPUT ?? option('--mod-window-output'),
}
const bounded = async (label, promise, milliseconds = 15_000) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds) }),
    ])
  } finally { clearTimeout(timer) }
}

function ProbeBrowserWindow(options) {
  const window = new BrowserWindow(options)
  window.webContents.on('did-finish-load', () => diagnostics.push(`did-finish-load:${window.webContents.getURL()}`))
  window.webContents.on('did-fail-load', (_event, code, description, url) => diagnostics.push(`did-fail-load:${code}:${description}:${url}`))
  window.webContents.on('console-message', (_event, level, message) => diagnostics.push(`console:${level}:${message}`))
  return window
}

const snapshot = () => ({
  project: { projectId: 'electron-window-check', name: '隔离窗口检查', activeVersionId: 'version-a', desiredState: 'running', health: 'running' },
  run: { status: 'running' }, update: { status: 'ready', lastError: null }, recentError: null,
  controls: { canStart: false, canStop: true, canInvoke: true, startBlockedReason: 'ALREADY_RUNNING', publishing: false },
  ui: { assetUrl: '/assets/index.html', frameToken: 'isolated-frame-token' },
})

const waitFor = async (label, predicate, milliseconds = 5_000) => {
  const until = Date.now() + milliseconds
  while (Date.now() < until) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`${label} timed out after ${milliseconds}ms`)
}
const waitForFrames = (window, frames = 2) => bounded('compositor frames', window.webContents.executeJavaScript(`new Promise(resolve => { let remaining=${frames}; const next=()=>{ if(--remaining===0) resolve(); else requestAnimationFrame(next) }; requestAnimationFrame(next) })`))

async function startServer() {
  const bridge = await readFile(join(root, 'src', 'plugins', 'weftmate-client', 'mod-projects-client.js'), 'utf8')
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const text = path === '/weftmate/mods/window.html' ? MOD_WINDOW_HTML
      : path === '/weftmate/mods/window.css' ? MOD_WINDOW_CSS
        : path === '/weftmate/mods/window.js' ? MOD_WINDOW_JS
          : path === '/weftmate/mods/bridge.mjs' ? bridge
            : path === '/assets/index.html' ? '<!doctype html><script>let token,port;window.addEventListener("message",event=>{if(event.data?.type==="weftmate-mod-init"){token=event.data.token;parent.postMessage({type:"weftmate-mod-ready",token},"*")}if(event.data?.type==="weftmate-mod-connect"&&event.data.token===token&&event.ports[0]){port=event.ports[0];port.postMessage({type:"weftmate-mod-action",token,requestId:"isolated-probe",action:"probe"})}})</script><main>isolated Mod</main>'
              : null
    if (text === null) { res.writeHead(404); res.end(); return }
    const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') || path.endsWith('.mjs') ? 'text/javascript' : 'text/html'
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' }); res.end(text)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address === 'object')
  servers.push(server)
  return `http://127.0.0.1:${address.port}`
}

function realOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('--origin must be an exact credential-free 127.0.0.1 origin')
  return url.origin
}

async function realRequest(origin, sessionId, action, value = {}) {
  const response = await fetch(new URL('/weftmate/mods/request', origin), { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, action, ...value }) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Mod request ${action} failed`)
  return body
}

async function realSnapshot(origin, projectId, sessionId, frameToken = null) {
  const url = new URL('/weftmate/mods/window/snapshot', origin)
  url.searchParams.set('project_id', projectId); url.searchParams.set('session_id', sessionId)
  if (frameToken) url.searchParams.set('frame_token', frameToken)
  const response = await fetch(url, { headers: { origin } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Mod snapshot failed')
  return body
}

async function prepareRealFixture(origin, sessionId) {
  const directory = await mkdtemp(join(tmpdir(), 'weftmate-mod-window-real-fixture-'))
  const { EXTERNAL_AGENT_TEMPLATE } = await import('../src/runtime/mod-projects/template.mjs')
  for (const [path, content] of Object.entries(EXTERNAL_AGENT_TEMPLATE.files)) {
    const file = join(directory, ...path.split('/'))
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  const imported = await realRequest(origin, sessionId, 'import', { directory, name: '原生窗口隔离验证 Mod' })
  const projectId = imported.project?.projectId
  if (typeof projectId !== 'string') throw new Error('real fixture import did not return a project id')
  const candidate = await realRequest(origin, sessionId, 'candidate', { project_id: projectId })
  await realRequest(origin, sessionId, 'validate', { project_id: projectId, version_id: candidate.versionId })
  await realRequest(origin, sessionId, 'select', { project_id: projectId, version_id: candidate.versionId })
  await realRequest(origin, sessionId, 'start', { project_id: projectId, user_initiated: true })
  return { projectId, directory }
}

async function realMain() {
  const origin = realOrigin(realConfig.origin)
  const sessionId = realConfig.session
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('--origin real mode requires --session')
  const fixture = realConfig.prepare ? await prepareRealFixture(origin, sessionId) : null
  const projectId = fixture?.projectId ?? realConfig.project
  if (typeof projectId !== 'string' || !projectId) throw new Error('real mode requires --project or --prepare-real-fixture')
  const evidenceRoot = realConfig.output ?? join(tmpdir(), 'weftmate-v2-native-20260915', 'mod-window-real')
  await mkdir(evidenceRoot, { recursive: true })
  const checks = { mode: 'real-http', projectId, fixtureDirectory: fixture?.directory ?? null, evidenceRoot }
  const invoked = []
  let theme = 'light'
  try {
    manager = new ModWindowManager({
      BrowserWindow: ProbeBrowserWindow, ipcMain, getOrigin: () => origin,
      getTheme: () => theme,
      fetchSnapshot: ({ frameToken } = {}) => realSnapshot(origin, projectId, sessionId, frameToken),
      invoke: async value => { const result = await realRequest(origin, sessionId, 'invoke', { project_id: projectId, frame_token: value.frameToken, request: value.request }); invoked.push(value); return result },
      control: value => realRequest(origin, sessionId, value.action, { project_id: projectId, user_initiated: value.action === 'start' }),
      preload: join(root, 'src', 'mod-window-preload.cjs'),
    })
    await bounded('real Mod window navigation', manager.open({ projectId, sessionId }))
    let window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith(origin))
    assert.ok(window)
    await waitFor('real sandboxed Mod status invoke', () => invoked.length > 0)
    await waitForFrames(window)
    await writeFile(join(evidenceRoot, 'mod-window-light.png'), (await window.webContents.capturePage()).toPNG())
    const token = invoked[0].frameToken
    await manager.refresh(projectId)
    const afterRefresh = await realSnapshot(origin, projectId, sessionId, token)
    assert.equal(afterRefresh.ui.frameToken, token, 'the active real window must renew the same lease identity')
    const child = window.webContents.mainFrame.frames.find(frame => frame.url.includes('/weftmate/mods/assets/'))
    assert.ok(child, 'the real generated Mod must remain in a sandboxed child frame')
    await bounded('real generated increment click', child.executeJavaScript(`document.querySelector('#increment').click()`))
    await waitFor('real generated increment output', async () => /当前计数：\s*1/.test(await child.executeJavaScript(`document.querySelector('#value').textContent`)))
    await manager.refresh(projectId)
    const second = await bounded('real second wrapper increment', window.webContents.executeJavaScript(`window.weftmateModWindow.invoke({ action: 'increment' })`))
    assert.equal(typeof second?.count, 'number')
    assert.equal(invoked.at(-1)?.frameToken, token, 'a second real request after refresh retains the same frame lease')
    checks.realFrameInvoke = true
    checks.realIncrement = true
    theme = 'dark'; manager.syncTheme()
    await waitFor('real dark theme', async () => (await window.webContents.executeJavaScript(`document.body.classList.contains('dark')`)) === true)
    await waitFor('real dark host bar color', async () => (await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.host-bar')).backgroundColor`)) === 'rgb(22, 26, 34)')
    await waitForFrames(window)
    await writeFile(join(evidenceRoot, 'mod-window-dark.png'), (await window.webContents.capturePage()).toPNG())
    await realRequest(origin, sessionId, 'stop', { project_id: projectId })
    await manager.refresh(projectId)
    assert.equal(await bounded('real stopped overlay', window.webContents.executeJavaScript(`document.querySelector('#cover').classList.contains('show')`)), true)
    await waitForFrames(window)
    await writeFile(join(evidenceRoot, 'mod-window-stopped.png'), (await window.webContents.capturePage()).toPNG())
    await bounded('real restart click', window.webContents.executeJavaScript(`document.querySelector('#start').click()`))
    await waitFor('real restart state', async () => (await window.webContents.executeJavaScript(`document.querySelector('#state').textContent`)) === '运行中')
    checks.realStopRestart = true
    window.close(); await waitFor('real view close', () => window.isDestroyed())
    assert.equal((await realSnapshot(origin, projectId, sessionId)).controls.canInvoke, true)
    await manager.open({ projectId, sessionId })
    window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith(origin)); assert.ok(window)
    checks.realCloseDoesNotStop = true
    await writeFile(join(evidenceRoot, 'mod-window-real-report.json'), JSON.stringify({ checks, invocations: invoked.map(value => ({ projectId: value.projectId, sessionId: value.sessionId, action: value.request?.action, frameTokenBound: typeof value.frameToken === 'string' })), diagnostics }, null, 2))
    console.log('MOD_WINDOW_ELECTRON_REAL_EVIDENCE', JSON.stringify(checks))
    console.log('MOD_WINDOW_ELECTRON_REAL_OK')
  } finally {
    await manager?.dispose?.(); manager = null
    if (fixture) await realRequest(origin, sessionId, 'stop', { project_id: projectId }).catch(() => {})
  }
}

async function main() {
  try {
  let origin = await bounded('isolated loopback server', startServer())
  console.log(`MOD_WINDOW_ELECTRON_PHASE=server-ready origin=${origin}`)
  let current = snapshot()
  let theme = 'light'
  const checks = {}
  const invocations = []
  const returns = []
  manager = new ModWindowManager({
    BrowserWindow: ProbeBrowserWindow,
    ipcMain,
    getOrigin: () => origin,
    getTheme: () => theme,
    fetchSnapshot: async () => current,
    invoke: async value => { invocations.push(value); return { ok: true } },
    control: async () => { current = snapshot(); return { ok: true } },
    onOpenWorkspace: value => returns.push(value),
    preload: join(root, 'src', 'mod-window-preload.cjs'),
  })
  await bounded('independent Mod window navigation', manager.open({ projectId: 'electron-window-check', sessionId: 'electron-session-check' }))
  let window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith(origin))
  assert.ok(window, 'native BrowserWindow must load the exact local wrapper')
  const running = await bounded('running-window DOM inspection', window.webContents.executeJavaScript(`({ bar: document.querySelector('.host-bar').getBoundingClientRect().height, frame: document.querySelector('iframe').getAttribute('sandbox'), state: document.querySelector('#state').textContent })`))
  assert.deepEqual(running, { bar: 36, frame: 'allow-scripts', state: '运行中' })
  checks.runningShell = true
  await waitFor('sandboxed iframe business action', () => invocations.length === 1)
  assert.equal(invocations[0].frameToken, 'isolated-frame-token')
  await manager.refresh('electron-window-check')
  assert.equal(invocations.length, 1, 'a stable lease refresh must not remount the business iframe')
  checks.stableTokenAction = true
  assert.deepEqual(await manager.open({ projectId: 'electron-window-check', sessionId: 'electron-session-check' }), { opened: false, focused: true })
  assert.equal(BrowserWindow.getAllWindows().filter(item => item.webContents.getURL().startsWith(origin)).length, 1)
  checks.oneProjectOneWindow = true
  theme = 'dark'; manager.syncTheme()
  assert.equal(await bounded('dark host bar inspection', window.webContents.executeJavaScript(`document.body.classList.contains('dark')`)), true)
  assert.equal(await bounded('dark host-bar metric', window.webContents.executeJavaScript(`document.querySelector('.host-bar').getBoundingClientRect().height`)), 36)
  checks.darkTheme36px = true
  current = { ...snapshot(), project: { ...snapshot().project, desiredState: 'stopped', health: 'stopped' }, run: { status: 'stopped' }, controls: { canStart: true, canStop: false, canInvoke: false, startBlockedReason: null, publishing: false } }
  await manager.refresh('electron-window-check')
  const stopped = await bounded('stopped-window DOM inspection', window.webContents.executeJavaScript(`({ shown: document.querySelector('#cover').classList.contains('show'), state: document.querySelector('#state').textContent, start: !document.querySelector('#start').hidden })`))
  assert.deepEqual(stopped, { shown: true, state: '已停止', start: true })
  await bounded('renderer restart control', window.webContents.executeJavaScript(`document.querySelector('#start').click()`))
  await waitFor('restart state', async () => (await window.webContents.executeJavaScript(`document.querySelector('#state').textContent`)) === '运行中')
  checks.stopAndRestart = true
  window.close()
  await waitFor('window close', () => window.isDestroyed())
  assert.equal(current.controls.canInvoke, true, 'closing a view must not stop the synthetic Mod runtime')
  await manager.open({ projectId: 'electron-window-check', sessionId: 'electron-session-check' })
  window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith(origin))
  assert.ok(window)
  checks.closeDoesNotStop = true
  const reboundOrigin = await startServer()
  origin = reboundOrigin
  await manager.rebind(reboundOrigin)
  assert.ok(window.webContents.getURL().startsWith(reboundOrigin))
  checks.portRebind = true
  await manager.rebind('http://127.0.0.1:1')
  assert.match(window.webContents.getURL(), /^data:text\/html/)
  await bounded('fallback return control', window.webContents.executeJavaScript(`window.weftmateModWindow.returnWorkspace()`))
  await waitFor('fallback return callback', () => returns.length === 1)
  assert.deepEqual(returns[0], { projectId: 'electron-window-check', sessionId: 'electron-session-check' })
  checks.fallbackReturn = true
  await manager.open({ projectId: 'electron-window-check', sessionId: 'electron-session-check' })
  assert.ok(window.webContents.getURL().startsWith(reboundOrigin))
  await manager.dispose()
  assert.equal(window.isDestroyed(), true)
  checks.exitCleanup = true
  console.log('MOD_WINDOW_ELECTRON_EVIDENCE', JSON.stringify(checks))
  console.log('MOD_WINDOW_ELECTRON_OK')
  } catch (error) {
    console.error('MOD_WINDOW_ELECTRON_FAILED', error instanceof Error ? error.message : String(error), diagnostics.join('\n'))
    process.exitCode = 1
  } finally {
    await manager?.dispose?.()
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
    app.exit(process.exitCode ?? 0)
  }
}

console.log('MOD_WINDOW_ELECTRON_PHASE=waiting-for-ready')
const readinessTimer = setTimeout(() => {
  console.error('MOD_WINDOW_ELECTRON_FAILED Electron ready event timed out after 15000ms')
  app.exit(1)
}, 15_000)
app.whenReady().then(() => {
  clearTimeout(readinessTimer)
  console.log('MOD_WINDOW_ELECTRON_PHASE=ready')
  return realConfig.origin ? realMain().catch(error => { console.error('MOD_WINDOW_ELECTRON_REAL_FAILED', error instanceof Error ? error.message : String(error), diagnostics.join('\n')); process.exitCode = 1 }).finally(() => app.exit(process.exitCode ?? 0)) : main()
}, error => {
  clearTimeout(readinessTimer)
  console.error('MOD_WINDOW_ELECTRON_FAILED', error instanceof Error ? error.message : String(error))
  app.exit(1)
})
