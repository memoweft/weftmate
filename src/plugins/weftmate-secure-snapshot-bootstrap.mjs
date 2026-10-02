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
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
  || (noOpen !== '0' && noOpen !== '1') || (profilePolicy !== 'alpha2' && profilePolicy !== 'weftmate' && profilePolicy !== 'upstream')) {
  fail('missing launch metadata')
}

const runtimeRequire = createNodeRequire(runtimePackageAnchor)
const importRuntime = async (name) => import(pathToFileURL(runtimeRequire.resolve(name)).href)
let accepted = false
let shutdown
let rootConfig
// This is intentionally a tiny, non-secret failure vocabulary. The parent
// needs to distinguish resolution from tree activation without receiving an
// exception message, composed config, credential ref, or credential value.
let bootStage = 'import'
let bootTimer = setTimeout(() => fail('snapshot frame timed out'), BOOT_TIMEOUT_MS)
bootTimer.unref?.()

const removeRoot = async () => {
  if (rootConfig !== undefined) await rm(rootConfig, { force: true })
}

const bootSnapshot = async (entries) => {
  bootStage = 'import'
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
  bootStage = 'resolution'
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
  if (profilePolicy !== 'alpha2') {
    // rc.5 owns this legacy resolver helper. Keep its known-good boot path
    // byte-for-byte in behavior: alpha.2-only profile services must never be
    // requested from the older vendor closure.
    if (typeof appBoot.healProfilesModuleFallback !== 'function') throw new Error('legacy resolver unavailable')
    appBoot.healProfilesModuleFallback(runtimePackageAnchor)
    const ctx = await boot('dsh', rootConfig, [{ insert: entries }], (hostCtx) => {
      app.current = hostCtx
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
      provideCmdline(hostCtx, { args: ['--port', port], exit: (code) => void requestShutdown(code) })
    })
    app.current = ctx
    return
  }

  // Alpha.2 resolution reads generated profile package metadata and official
  // bundle metadata only. `userLayer: false` keeps the signed IPC snapshot as
  // the sole configuration tree; no mutable profile patch is ever loaded.
  const { loadProfileDirectory, createRuntimeResolution, PluginPackages } = appBoot
  if (typeof loadProfileDirectory !== 'function' || typeof createRuntimeResolution !== 'function' || typeof PluginPackages !== 'function') {
    throw new Error('alpha2 resolution unavailable')
  }
  const resolutionProfile = loadProfileDirectory('dsh', profileDir, runtimePackageAnchor, { userLayer: false })
  const resolution = await createRuntimeResolution({
    installAnchor: runtimePackageAnchor, home: join(profileDir, '..', '..'), profile: resolutionProfile,
  })
  const profileContext = Object.freeze({ name: 'weftmate-alpha2', dir: profileDir, patchPath: rootConfig, installAnchor: runtimePackageAnchor, startedBundles: [], cwd: process.cwd(), home: join(profileDir, '..', '..'), overlays: [], telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED })
  let ready = false
  const readyListeners = new Set()
  const appReady = { onReady(listener) { if (ready) { listener(); return () => {} } readyListeners.add(listener); return () => readyListeners.delete(listener) } }
  bootStage = 'prepare'
  const ctx = await boot('dsh', rootConfig, [{ insert: entries }], async (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide('profileContext', profileContext)
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    await hostCtx.plugin(PluginPackages, { resolution })
    provideCmdline(hostCtx, {
      args: ['--port', port, ...(noOpen === '1' ? ['--no-open'] : [])],
      exit: (code) => void requestShutdown(code), ready: appReady,
    })
    bootStage = 'tree'
  })
  app.current = ctx
  // The official welcome acknowledgement is a single volatile preference.
  // ConfigEditor normally persists it by reconciling profile patches; that
  // cannot replay an IPC-only signed root insert. Admit only this known field
  // as a child-lifetime update, leaving every other settings write on its
  // normal (and secure-candidate guarded) path. This keeps Continue real
  // without making the signed composition mutable or weakening API auth.
  const editor = ctx.get?.('configEditor')
  if (editor?.edit instanceof Function) {
    editor.edit = async (entry, change) => {
      if (entry?.options?.id !== 'ui-settings-general') throw new Error('secure_settings_requires_restart')
      const current = structuredClone(entry.options.config ?? {})
      const next = change(current, {})
      if (next === null || typeof next !== 'object' || Array.isArray(next)
        || Object.keys(next).some(key => key !== 'welcomeNoticeVersion')
        || (next.welcomeNoticeVersion !== undefined && typeof next.welcomeNoticeVersion !== 'string')) {
        throw new Error('secure welcome acknowledgement rejected')
      }
      await entry.update({ config: next })
      const welcomePath = join(profileDir, 'weftmate-alpha2-welcome.json')
      const temporary = `${welcomePath}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, welcomeNoticeVersion: next.welcomeNoticeVersion })}\n`, { mode: 0o600 })
      await rename(temporary, welcomePath)
    }
  }
  ready = true
  for (const listener of [...readyListeners]) listener()
  readyListeners.clear()
}

process.on('message', (frame) => {
  if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) fail('invalid snapshot frame')
  const value = frame
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
    fail(profilePolicy === 'alpha2' ? `boot failed stage=${bootStage}` : 'boot failed')
  })
})
