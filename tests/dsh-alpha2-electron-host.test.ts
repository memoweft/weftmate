import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFile = promisify(execFileCallback)

test('alpha2 Electron launcher dry-run validates only the independent vendor and has no side effects', async () => {
  const script = join(process.cwd(), 'scripts', 'start-dsh-alpha2-electron.mjs')
  const result = await execFile(process.execPath, [script, '--dry-run'], { cwd: process.cwd() })
  const report = JSON.parse(result.stdout)
  assert.equal(report.dryRun, true)
  assert.equal(report.sideEffects, false)
  assert.match(report.electron, /node_modules[\\/]electron[\\/]dist/)
  assert.match(report.vendor, /HarnessStores[\\/]dsh-v0\.1\.7-alpha\.2[\\/]vendor/)
})

test('alpha2 Electron launcher rejects a root outside its TEMP or alpha2 HarnessStores boundary', async () => {
  const script = join(process.cwd(), 'scripts', 'start-dsh-alpha2-electron.mjs')
  await assert.rejects(execFile(process.execPath, [script, '--dry-run', '--root=D:\\AIProjects\\WeftMate\\Runtime\\IntegratedDogfood'], { cwd: process.cwd() }))
})

test('alpha2 Electron host is independent from the rc5 main process and owns only candidate runtime services', async () => {
  const main = await readFile(join(process.cwd(), 'src', 'main.mjs'), 'utf8')
  const host = await readFile(join(process.cwd(), 'src', 'alpha2-electron-main.mjs'), 'utf8')
  assert.doesNotMatch(main, /alpha2-candidate/)
  assert.match(host, /WEFTMATE_ALPHA2_ELECTRON_ROOT/)
  assert.match(host, /const homeDir = root/)
  assert.match(host, /model-catalog-count=/)
  assert.match(host, /profilePolicy: 'alpha2'/)
  assert.match(host, /credentialRequestHandler/)
  assert.match(host, /renameSync\(temporary, target\)/)
  assert.match(host, /alpha2 vendor manifest does not match the pinned candidate/)
  assert.match(host, /window-all-closed/)
  assert.match(host, /contextIsolation: true, nodeIntegration: false, sandbox: true/)
  assert.doesNotMatch(host, /ManagedAiGameRuntime|initDevices|initPerception|initUpdater|checkForUpdates/)
})
