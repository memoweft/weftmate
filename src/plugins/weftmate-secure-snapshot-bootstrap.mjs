/**
 * Secure DSH snapshot bootstrap.
 *
 * This file is copied into the generated WeftMate profile and is only invoked
 * by DshWebRuntime when the Electron safeStorage credential bridge is active.
 * The parent has already asked the exact pinned CLI to compose the profile,
 * validated that composition, and sends the resulting entry tree once over the
 * inherited Node IPC fd.  We deliberately do not read profile/home patch files
 * and deliberately do not install `watchUserPatches`: runtime configuration is
 * the checked snapshot, not a mutable file.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire as createNodeRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROTOCOL = 'weftmate.secure-snapshot.v1'
const MAX_FRAME_BYTES = 512 * 1024
const BOOT_TIMEOUT_MS = 10_000
const credentialLikeName = /(?:^|[_-])(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(?:$|[_-])/i

const fail = (message) => {
  process.stderr.write(`dsh secure snapshot bootstrap: ${message}\n`)
  process.exitCode = 1
  process.exit(1)
}

const scrubCredentialEnvironment = () => {
  for (const name of Object.keys(process.env)) {
    if (credentialLikeName.test(name) || name.endsWith('_API_KEY') || name.endsWith('_API_TOKEN')
      || name.endsWith('_API_SECRET') || name.startsWith('WEFTMATE_LLM_KEY_')) delete process.env[name]
  }
}

const isCredentialName = (name) => credentialLikeName.test(name) || name.endsWith('_API_KEY')
  || name.endsWith('_API_TOKEN') || name.endsWith('_API_SECRET') || name.startsWith('WEFTMATE_LLM_KEY_')

const sameDigest = (entries) => createHash('sha256').update(JSON.stringify(entries)).digest('hex')

const runtimePackageAnchor = process.env.WEFTMATE_SECURE_BOOTSTRAP_PACKAGE_ANCHOR
const profileDir = process.env.WEFTMATE_SECURE_BOOTSTRAP_PROFILE_DIR
const expectedNonce = process.env.WEFTMATE_SECURE_BOOTSTRAP_NONCE
const expectedDigest = process.env.WEFTMATE_SECURE_BOOTSTRAP_DIGEST
const port = process.env.WEFTMATE_SECURE_BOOTSTRAP_PORT
const noOpen = process.env.WEFTMATE_SECURE_BOOTSTRAP_NO_OPEN
const profilePolicy = process.env.WEFTMATE_SECURE_BOOTSTRAP_PROFILE_POLICY
if (typeof runtimePackageAnchor !== 'string' || typeof profileDir !== 'string'
  || typeof expectedNonce !== 'string' || typeof expectedDigest !== 'string' || typeof port !== 'string'
  || (noOpen !== '0' && noOpen !== '1') || (profilePolicy !== 'weftmate' && profilePolicy !== 'upstream')) {
  fail('missing launch metadata')
}

const runtimeRequire = createNodeRequire(runtimePackageAnchor)
const importRuntime = async (name) => import(pathToFileURL(runtimeRequire.resolve(name)).href)
let accepted = false
let shutdown
let rootConfig
let bootTimer = setTimeout(() => fail('snapshot frame timed out'), BOOT_TIMEOUT_MS)
bootTimer.unref?.()

const removeRoot = async () => {
  if (rootConfig !== undefined) await rm(rootConfig, { force: true })
}

const bootSnapshot = async (entries) => {
  const [appBoot, launchEnvironment, cmdline] = await Promise.all([
    importRuntime('@deepseek-ai/dsh-app-boot'),
    importRuntime('@deepseek-ai/dsh-launch-environment'),
    importRuntime('@deepseek-ai/dsh-cmdline'),
  ])
  const { boot, installFailLoud, loadLayeredEnv } = appBoot
  const { DSH_LAUNCH_ENVIRONMENT_KEY } = launchEnvironment
  const { provideCmdline } = cmdline

  // Keep the official layered non-credential environment behaviour, but make
  // every credential-like variable unreachable both from process.env and from
  // the launch-environment service. This prevents a project/home `.env` from
  // bypassing Electron's safeStorage bridge.
  const layered = loadLayeredEnv('dsh', process.cwd())
  scrubCredentialEnvironment()
  const environment = Object.freeze({
    get(name) { return isCredentialName(name) ? undefined : layered.get(name) },
    getFrom(name, sources) { return isCredentialName(name) ? undefined : layered.getFrom(name, sources) },
  })

  // The leaf lives directly in the profile directory: relative entries such
  // as `./plugins/weftmate-credentials.mjs` therefore resolve exactly as they
  // do through the official profile root. Its randomized name prevents any
  // loader write-back from becoming a stable user configuration file.
  rootConfig = join(profileDir, `.weftmate-secure-snapshot-${randomBytes(16).toString('hex')}.yml`)
  await mkdir(profileDir, { recursive: true })
  await writeFile(rootConfig, '[]\n', 'utf8')
  const app = { current: undefined }
  let shutdownPromise
  const requestShutdown = (code) => {
    if (shutdownPromise !== undefined) return shutdownPromise
    shutdownPromise = Promise.resolve().then(async () => {
      await app.current?.fiber.dispose()
      await removeRoot()
      process.exitCode = code
    }).catch(() => {
      process.exitCode = code || 1
    })
    return shutdownPromise
  }
  shutdown = requestShutdown
  process.once('SIGTERM', () => { void requestShutdown(0) })
  process.once('SIGINT', () => { void requestShutdown(130) })
  process.once('disconnect', () => { void requestShutdown(0) })
  installFailLoud('dsh', process, async () => { await requestShutdown(1) })
  if (typeof appBoot.healProfilesModuleFallback !== 'function') throw new Error('legacy resolver unavailable')
  appBoot.healProfilesModuleFallback(runtimePackageAnchor)
  const ctx = await boot('dsh', rootConfig, [{ insert: entries }], (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    provideCmdline(hostCtx, { args: ['--port', port], exit: (code) => void requestShutdown(code) })
  })
  app.current = ctx

}

process.on('message', (frame) => {
  if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) fail('invalid snapshot frame')
  const value = frame
  if (value.protocol === 'weftmate.runtime-shutdown.v1' && value.action === 'dispose') {
    // Keep the IPC carrier alive until the parent has collected the complete
    // process tree. Native disposal first drains the DSH persistence queues.
    void shutdown?.(0).then(() => {
      if (process.connected) process.send?.({ protocol: 'weftmate.runtime-shutdown.v1', action: 'disposed' })
    })
    return
  }
  // The official credentials provider shares this Node IPC channel. Its
  // parent responses are intentionally ignored here; only our own protocol is
  // a bootstrap frame, and exactly one such frame is accepted.
  if (value.protocol !== PROTOCOL) return
  if (accepted) fail('second snapshot frame rejected')
  accepted = true
  clearTimeout(bootTimer)
  bootTimer = undefined
  if (value.nonce !== expectedNonce || value.digest !== expectedDigest || !Array.isArray(value.entries)) {
    fail('invalid snapshot frame')
  }
  let encoded
  try { encoded = JSON.stringify(value.entries) } catch { fail('invalid snapshot frame') }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_FRAME_BYTES || sameDigest(value.entries) !== expectedDigest) {
    fail('invalid snapshot frame')
  }
  void bootSnapshot(value.entries).catch(async () => {
    await removeRoot()
    fail('boot failed')
  })
})
