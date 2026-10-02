/** Minimal, isolated Electron host for the Alpha.2 candidate only. */
import { app, BrowserWindow, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { DshWebRuntime, redactWebToken } from './dsh-web-runtime.ts'

const repository = resolve(import.meta.dirname, '..')
const candidatePath = join(repository, 'runtime', 'dsh-candidates', 'dsh-v0.1.7-alpha.2.json')
const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'))
const pin = JSON.parse(readFileSync(join(repository, candidate.pinPath), 'utf8'))
const rootInput = process.env.WEFTMATE_ALPHA2_ELECTRON_ROOT
if (typeof rootInput !== 'string' || !rootInput) throw new Error('alpha2 electron requires WEFTMATE_ALPHA2_ELECTRON_ROOT')
const root = resolve(rootInput)
const weftMateRoot = resolve(repository, '..')
const integratedDogfood = join(weftMateRoot, 'Runtime', 'IntegratedDogfood')
const harnessStores = join(weftMateRoot, 'Runtime', 'HarnessStores', 'dsh-v0.1.7-alpha.2')
const tempRoot = resolve(tmpdir())
const within = (value, parent) => value === parent || value.startsWith(`${parent}${sep}`)
if (!within(root, tempRoot) && !within(root, harnessStores)) throw new Error('alpha2 electron root must be under TEMP or the alpha2 HarnessStores root')
if (within(root, repository) || within(root, integratedDogfood)) throw new Error('alpha2 electron root must not overlap repository or IntegratedDogfood')
const userData = join(root, 'user-data')
// OwnerDogfood is the candidate's DSH_HOME. Its non-secret offline model
// document lives directly under profiles/weftmate-alpha2, while Electron's
// own browser state and workspace remain separate children.
const homeDir = root
const workspaceDir = join(root, 'workspace')
const vendor = resolve(repository, candidate.vendorRuntimePath)
const manifestPath = join(vendor, 'VENDOR-MANIFEST.json')
if (!existsSync(manifestPath)) throw new Error('alpha2 vendor manifest is missing')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest?.dsh?.packageVersion !== candidate.packageVersion || manifest?.dsh?.commit !== candidate.commit
  || pin.packageVersion !== candidate.packageVersion || pin.commit !== candidate.commit) throw new Error('alpha2 vendor manifest does not match the pinned candidate')

app.setPath('userData', userData)
let window = null
let runtime = null
let closing = false

function credentialFile() { return join(userData, 'alpha2-credentials.enc') }
function readCredentials() {
  const file = credentialFile()
  if (!existsSync(file)) return {}
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
  const value = JSON.parse(safeStorage.decryptString(readFileSync(file)))
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
function writeCredentials(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
  const target = credentialFile()
  const temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 })
  renameSync(temporary, target)
}
const credentialRequestHandler = async ({ operation, ref, value }) => {
  if (typeof ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) throw new Error('invalid credential ref')
  const values = readCredentials()
  if (operation === 'resolve') return typeof values[ref] === 'string' ? { value: values[ref], source: 'alpha2-safe-storage' } : {}
  if (operation === 'describe') return { configured: typeof values[ref] === 'string', writable: true, source: 'alpha2-safe-storage' }
  if (operation === 'set') {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error('invalid credential value')
    values[ref] = value; writeCredentials(values); return { changed: true }
  }
  if (operation === 'unset') { delete values[ref]; writeCredentials(values); return { changed: true } }
  throw new Error('unsupported credential operation')
}

async function start() {
  try {
    await Promise.all([mkdir(userData, { recursive: true }), mkdir(homeDir, { recursive: true }), mkdir(workspaceDir, { recursive: true })])
    runtime = new DshWebRuntime({
      homeDir, workspaceDir, runtimePath: vendor, profileName: candidate.profileName, profilePolicy: 'alpha2',
      credentialRequestHandler, noOpen: true, readyTimeoutMs: 120_000,
      log: line => console.log(`[alpha2-electron] ${redactWebToken(line)}`),
    })
    const origin = await runtime.start()
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('alpha2 runtime produced an untrusted origin')
    window = new BrowserWindow({
      width: 1320, height: 900, minWidth: 920, minHeight: 640, show: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      try { if (new URL(url).origin !== parsed.origin) event.preventDefault() }
      catch { event.preventDefault() }
    })
    await window.loadURL(origin)
    console.log('[alpha2-electron] window-loaded')
    const expectedModels = Number(process.env.WEFTMATE_ALPHA2_ELECTRON_EXPECT_MODELS)
    if (Number.isSafeInteger(expectedModels) && expectedModels >= 0) {
      const handoff = await fetch(origin, { redirect: 'manual' })
      const cookie = handoff.headers.get('set-cookie')?.split(';', 1)[0]
      if (handoff.status !== 303 || !cookie) throw new Error('alpha2 electron model catalog authentication failed')
      const catalog = await fetch(new URL('/api/weftmate/models', origin), { headers: { cookie } })
        .then(async response => ({ status: response.status, body: await response.json().catch(() => null) }))
      const group = catalog.body?.modelCatalog?.groups?.find(item => item?.id === 'dai-models')
      if (catalog.status !== 200 || !Array.isArray(group?.models) || group.models.length !== expectedModels) {
        throw new Error('alpha2 electron model catalog count mismatch')
      }
      console.log(`[alpha2-electron] model-catalog-count=${group.models.length}`)
    }
    const closeAfter = Number(process.env.WEFTMATE_ALPHA2_ELECTRON_TEST_CLOSE_MS)
    if (Number.isSafeInteger(closeAfter) && closeAfter > 0) setTimeout(() => window?.close(), closeAfter).unref?.()
    window.once('closed', () => { void shutdown() })
  } catch (error) {
    await shutdown()
    throw error
  }
}

app.whenReady().then(start).catch(error => { console.error(`[alpha2-electron] ${error instanceof Error ? error.message : String(error)}`); app.exit(1) })
async function shutdown() {
  if (closing) return
  closing = true
  const current = runtime; runtime = null
  await current?.close().catch(() => undefined)
  console.log('[alpha2-electron] runtime-closed')
  app.exit(0)
}
app.on('before-quit', event => {
  if (closing || runtime === null) return
  event.preventDefault()
  void shutdown()
})
app.on('window-all-closed', event => { event.preventDefault(); void shutdown() })
