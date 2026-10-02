// Developer-only real Electron probe. Always use an isolated preview runtime.
import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'

const option = key => process.argv[process.argv.indexOf(key) + 1]
const configuredOrigin = process.env.WEFTMATE_DSH_VIEW_ORIGIN ?? option('--dsh-view-origin')
const configuredOutput = process.env.WEFTMATE_DSH_VIEW_OUTPUT ?? option('--dsh-view-output')
const output = configuredOutput ? resolve(configuredOutput) : null
let configurationError = null
if (!configuredOrigin || !output) configurationError = 'Use WEFTMATE_DSH_VIEW_ORIGIN and WEFTMATE_DSH_VIEW_OUTPUT, or --dsh-view-origin/--dsh-view-output.'
if (output) mkdirSync(join(output, 'electron-profile'), { recursive: true })
// A previous forced/failed probe can leave Chromium's singleton lock behind.
// Keep reports under --output but use a unique disposable profile every run.
if (output) app.setPath('userData', mkdtempSync(join(output, 'electron-profile-')))
async function main() {
  if (configurationError) throw new Error(configurationError)
  await mkdir(output, { recursive: true })
  const [{ DshViewCarrier }, electron] = await Promise.all([
    import('../src/dsh-view-carrier.mjs'),
    import('electron'),
  ])
  if (typeof electron.WebContentsView !== 'function') throw new Error('Electron does not expose WebContentsView')
  const WebContentsView = electron.WebContentsView
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  await win.loadURL('data:text/html,<title>WeftMate conversation seam probe</title>')
  const carrier = new DshViewCarrier({ WebContentsView, ipcMain, parent: win, partition: 'weftmate-seam-probe' })
  const wc = carrier.view.webContents
  const report = { kind: 'real-electron-carrier', checks: {}, limitations: ['Complete V2 geometry is not implemented by this probe.'], errors: [] }
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  async function until(predicate, timeout = 30_000) {
    const start = Date.now()
    while (Date.now() - start < timeout) { if (await predicate()) return; await delay(200) }
    throw new Error('Probe condition timed out')
  }
  const evaluate = code => wc.executeJavaScript(code, true)
  const settleFrames = () => evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
  try {
  await carrier.bind(configuredOrigin)
  await until(() => carrier.state !== null)
  carrier.setBounds({ x: 0, y: 0, width: 1440, height: 900 })
  win.show()
  await settleFrames()
  await carrier.command({ type: 'select-session', sessionId: 'preview-mod-owner' })
  await until(() => carrier.state?.sessionId === 'preview-mod-owner')
  report.checks.sessionSelect = true
  await carrier.command({ type: 'theme', theme: 'dark' })
  await until(() => evaluate("document.body.hasAttribute('data-ds-dark-theme')"))
  await settleFrames()
  report.checks.darkTheme = true
  await delay(1000)
  await writeFile(join(output, 'carrier-dark.png'), (await wc.capturePage()).toPNG())
  await carrier.command({ type: 'theme', theme: 'light' })
  await until(async () => !(await evaluate("document.body.hasAttribute('data-ds-dark-theme')")))
  await settleFrames()
  report.checks.lightTheme = true
  const identity = wc.id
  carrier.setVisible(false)
  carrier.setVisible(true)
  carrier.focus()
  report.checks.sameWebContentsOnHide = wc.id === identity
  report.dom = await evaluate(`({ text: document.body.innerText.slice(-7000), inputs: Array.from(document.querySelectorAll('textarea,input,[contenteditable]')).map(e=>({tag:e.tagName,type:e.type,placeholder:e.getAttribute('placeholder'),role:e.getAttribute('role'),editable:e.getAttribute('contenteditable')})), buttons: Array.from(document.querySelectorAll('button')).map(e=>({text:e.innerText,title:e.title,aria:e.getAttribute('aria-label')})) })`)
  await writeFile(join(output, 'carrier-light.png'), (await wc.capturePage()).toPNG())
  if (process.argv.includes('--hold')) { win.show(); await new Promise(resolve => win.once('closed', resolve)) }
  } catch (error) { report.errors.push(String(error.stack || error)); process.exitCode = 1 }
  finally {
    const destroyed = wc.isDestroyed() ? Promise.resolve() : new Promise(resolve => wc.once('destroyed', resolve))
    carrier.dispose()
    await Promise.race([destroyed, delay(2_000)])
    if (!win.isDestroyed()) {
      const closed = new Promise(resolve => win.once('closed', resolve))
      win.destroy()
      await Promise.race([closed, delay(2_000)])
    }
    report.checks.cleanup = wc.isDestroyed() && ipcMain.listenerCount('wm:chat-carrier:report') === 0
    await writeFile(join(output, 'carrier-report-retry2.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    app.exit(report.errors.length ? 1 : 0)
  }
}

console.log('DSH_VIEW_ELECTRON_PHASE=waiting-for-ready')
const readinessTimer = setTimeout(() => {
  console.error('DSH_VIEW_ELECTRON_FAILED Electron ready event timed out after 15000ms')
  app.exit(1)
}, 15_000)
app.whenReady().then(() => {
  clearTimeout(readinessTimer)
  console.log('DSH_VIEW_ELECTRON_PHASE=ready')
  return main()
}, error => {
  clearTimeout(readinessTimer)
  console.error(String(error?.stack || error))
  app.exit(1)
})
