/**
 * Electron-main-only lifecycle for the bundled AI-GAME managed runtime.
 *
 * The manager deliberately owns only process integrity and health. DSH keeps
 * the Task/tool state machine, while the AI-GAME child keeps Android runtime
 * state. No credential, PID, port, nonce, or filesystem path is projected by
 * diagnostics or ordinary logs.
 */

import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

export const AI_GAME_RUNTIME_DIRECTORY = 'ai-game-runtime'
export const AI_GAME_MANAGED_ORIGIN_REF = 'WEFTMATE_AI_GAME_MANAGED_ORIGIN'
export const AI_GAME_MANAGED_STATE_REF = 'WEFTMATE_AI_GAME_MANAGED_STATE'
export const AI_GAME_MANAGED_PROTOCOL_VERSION = 1
export const AI_GAME_EXECUTION_API_VERSION = '2.0'
export const AI_GAME_RUNTIME_VERSION = '0.1.0'
export const AI_GAME_SOURCE_REVISION = 'd6a2793f320b41a5500e12a905ce614415fcda53'
export const AI_GAME_ENTRY_SHA256 = 'cc2e11a8fc962c087298f6ca733389bbe350be18b0f92de3093b8a862024144a'
export const AI_GAME_MANIFEST_SHA256 = 'e65e93ded561aa62115c05d8b4cf2aba46e9382cd060b0f471d10f3287643477'
export const AI_GAME_NOTICES_SHA256 = '6f0000424baa84e0d1ace4d57ef9752d9da05171c5df0672ed18d13edcd43e58'
export const AI_GAME_PORT_CANDIDATES = Object.freeze([4310, 4311, 4312, 4313])

const MANIFEST_NAME = 'managed-runtime-manifest.json'
const ENTRY_NAME = 'ai-game-managed-runtime.exe'
const NOTICES_NAME = 'THIRD_PARTY_NOTICES.json'
const EXPECTED_TOP_LEVEL = Object.freeze(['THIRD_PARTY_NOTICES.json', '_internal', ENTRY_NAME, MANIFEST_NAME])
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_READY_BYTES = 8 * 1024
const MAX_HEALTH_BYTES = 64 * 1024
const MAX_RUNTIME_FILES = 4_096
const CLIENT_ID = 'weftmate-harness-v1'
const SHUTDOWN_CLIENT_ID = 'console-v1'
const REQUIRED_V2_CAPABILITIES = Object.freeze([
  'tasks', 'revisions', 'controls', 'answers', 'archive', 'device_profiles',
  'experience', 'emulator_discovery', 'verified_frames',
])
const STATES = new Set([
  'not_installed', 'verifying', 'starting', 'ready', 'needs_setup',
  'recovering', 'unavailable', 'stopping', 'stopped',
])

export class ManagedAiGameRuntimeError extends Error {
  constructor(code, message, { retryable = false, candidateFailure = false } = {}) {
    super(message)
    this.name = 'ManagedAiGameRuntimeError'
    this.code = code
    this.retryable = retryable
    this.candidateFailure = candidateFailure
  }
}

function runtimeError(code, message, options) {
  return new ManagedAiGameRuntimeError(code, message, options)
}

function exactKeys(value, expected) {
  return isRecord(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value)
}

function safeSecret(value) {
  return typeof value === 'string' && value.length >= 32 && value.length <= 512 && !value.includes('\0')
}

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value
  return normalize(resolve(left)) === normalize(resolve(right))
}

function isInside(root, target) {
  const path = relative(root, target)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !resolve(path).startsWith(sep))
}

async function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => { hash.update(chunk) })
    stream.once('error', reject)
    stream.once('end', () => { resolveHash(hash.digest('hex')) })
  })
}

async function readBoundedFile(path, maximum, code) {
  const details = await lstat(path).catch((error) => {
    if (error?.code === 'ENOENT') throw runtimeError(code, 'The managed runtime file is missing.')
    throw runtimeError(code, 'The managed runtime file is unavailable.')
  })
  if (!details.isFile() || details.isSymbolicLink() || details.size < 1 || details.size > maximum) {
    throw runtimeError(code, 'The managed runtime file is invalid.')
  }
  return readFile(path)
}

async function assertPeX64(path) {
  const handle = await open(path, 'r').catch(() => {
    throw runtimeError('runtime_entry_invalid', 'The managed runtime entry is unavailable.')
  })
  try {
    const dos = Buffer.alloc(64)
    const dosRead = await handle.read(dos, 0, dos.length, 0)
    if (dosRead.bytesRead !== dos.length || dos[0] !== 0x4d || dos[1] !== 0x5a) {
      throw runtimeError('runtime_entry_invalid', 'The managed runtime entry is not a Windows executable.')
    }
    const peOffset = dos.readUInt32LE(0x3c)
    if (peOffset < 64 || peOffset > 64 * 1024 * 1024) {
      throw runtimeError('runtime_entry_invalid', 'The managed runtime entry header is invalid.')
    }
    const pe = Buffer.alloc(6)
    const peRead = await handle.read(pe, 0, pe.length, peOffset)
    if (peRead.bytesRead !== pe.length || pe.subarray(0, 4).toString('binary') !== 'PE\0\0'
      || pe.readUInt16LE(4) !== 0x8664) {
      throw runtimeError('runtime_entry_invalid', 'The managed runtime entry architecture is invalid.')
    }
  } finally {
    await handle.close()
  }
}

async function enumerateRuntime(root) {
  const files = []
  const visit = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolutePath = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw runtimeError('runtime_file_invalid', 'The managed runtime contains a linked path.')
      }
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath)
      } else if (entry.isFile()) {
        if (relativePath !== MANIFEST_NAME) files.push(relativePath)
      } else {
        throw runtimeError('runtime_file_invalid', 'The managed runtime contains an unsupported filesystem entry.')
      }
      if (files.length > MAX_RUNTIME_FILES) {
        throw runtimeError('runtime_manifest_invalid', 'The managed runtime file closure is too large.')
      }
    }
  }
  await visit(root)
  return files
}

/**
 * Consumer-side verifier shared by runtime startup and the later package task.
 * It does not trust a source checkout or builder: identity, exact top-level
 * layout, full file closure, hashes, PE architecture, protocol and API are all
 * checked from the staged runtime itself.
 */
export async function verifyManagedAiGameRuntime(runtimeRoot, options = {}) {
  const root = resolve(String(runtimeRoot ?? ''))
  const expected = {
    sourceRevision: options.sourceRevision ?? AI_GAME_SOURCE_REVISION,
    runtimeVersion: options.runtimeVersion ?? AI_GAME_RUNTIME_VERSION,
    protocolVersion: options.protocolVersion ?? AI_GAME_MANAGED_PROTOCOL_VERSION,
    apiVersion: options.apiVersion ?? AI_GAME_EXECUTION_API_VERSION,
    platform: options.platform ?? 'windows',
    architecture: options.architecture ?? 'x64',
    entrySha256: options.entrySha256 ?? AI_GAME_ENTRY_SHA256,
    manifestSha256: options.manifestSha256 ?? AI_GAME_MANIFEST_SHA256,
    noticesSha256: options.noticesSha256 ?? AI_GAME_NOTICES_SHA256,
  }

  const rootDetails = await lstat(root).catch((error) => {
    if (error?.code === 'ENOENT') throw runtimeError('runtime_not_installed', 'The managed runtime is not installed.')
    throw runtimeError('runtime_root_invalid', 'The managed runtime root is unavailable.')
  })
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw runtimeError('runtime_root_invalid', 'The managed runtime root is invalid.')
  }
  const canonicalRoot = await realpath(root).catch(() => {
    throw runtimeError('runtime_root_invalid', 'The managed runtime root is unavailable.')
  })
  if (!samePath(root, canonicalRoot)) {
    throw runtimeError('runtime_root_invalid', 'The managed runtime root cannot be linked.')
  }

  const topLevel = (await readdir(root)).sort()
  if (JSON.stringify(topLevel) !== JSON.stringify([...EXPECTED_TOP_LEVEL].sort())) {
    throw runtimeError('runtime_top_level_invalid', 'The managed runtime top-level layout is invalid.')
  }

  const manifestPath = join(root, MANIFEST_NAME)
  const manifestBytes = await readBoundedFile(manifestPath, MAX_MANIFEST_BYTES, 'runtime_manifest_invalid')
  const manifestDigest = createHash('sha256').update(manifestBytes).digest('hex')
  if (expected.manifestSha256 && manifestDigest !== expected.manifestSha256) {
    throw runtimeError('runtime_manifest_hash_mismatch', 'The managed runtime manifest identity is invalid.')
  }
  let manifest
  try { manifest = JSON.parse(manifestBytes.toString('utf8')) } catch {
    throw runtimeError('runtime_manifest_invalid', 'The managed runtime manifest is invalid JSON.')
  }
  const manifestKeys = [
    'architecture', 'artifact_kind', 'entry', 'execution_api_version', 'files',
    'managed_protocol_version', 'platform', 'schema_version', 'source', 'third_party_notices',
  ]
  if (!exactKeys(manifest, manifestKeys)
    || manifest.schema_version !== 1
    || manifest.artifact_kind !== 'windows_x64_self_contained_managed_runtime'
    || manifest.entry !== ENTRY_NAME
    || manifest.third_party_notices !== NOTICES_NAME
    || manifest.platform !== expected.platform
    || manifest.architecture !== expected.architecture
    || manifest.managed_protocol_version !== expected.protocolVersion
    || manifest.execution_api_version !== expected.apiVersion
    || !exactKeys(manifest.source, ['name', 'revision', 'version'])
    || manifest.source.name !== 'ai-game-console-backend'
    || manifest.source.revision !== expected.sourceRevision
    || manifest.source.version !== expected.runtimeVersion
    || !Array.isArray(manifest.files) || manifest.files.length < 3 || manifest.files.length > MAX_RUNTIME_FILES) {
    throw runtimeError('runtime_incompatible', 'The managed runtime identity is incompatible.')
  }

  const declared = []
  const seen = new Set()
  for (const item of manifest.files) {
    if (!exactKeys(item, ['path', 'sha256', 'size'])
      || typeof item.path !== 'string' || item.path.length < 1 || item.path.length > 512
      || item.path.includes('\\') || item.path.startsWith('/') || item.path.endsWith('/')
      || item.path.split('/').some((part) => part === '' || part === '.' || part === '..')
      || item.path === MANIFEST_NAME || !/^[a-f0-9]{64}$/.test(item.sha256)
      || !Number.isSafeInteger(item.size) || item.size < 0 || seen.has(item.path)) {
      throw runtimeError('runtime_manifest_invalid', 'The managed runtime manifest file closure is invalid.')
    }
    seen.add(item.path)
    declared.push(item.path)
  }
  const sortedDeclared = [...declared].sort()
  if (JSON.stringify(declared) !== JSON.stringify(sortedDeclared)
    || !seen.has(ENTRY_NAME) || !seen.has(NOTICES_NAME)) {
    throw runtimeError('runtime_manifest_invalid', 'The managed runtime manifest file closure is invalid.')
  }

  const actual = await enumerateRuntime(root)
  if (JSON.stringify(actual) !== JSON.stringify(sortedDeclared)) {
    throw runtimeError('runtime_file_closure_mismatch', 'The managed runtime file closure does not match its manifest.')
  }
  for (const item of manifest.files) {
    const path = resolve(root, ...item.path.split('/'))
    if (!isInside(root, path)) {
      throw runtimeError('runtime_file_invalid', 'The managed runtime contains an unsafe file path.')
    }
    const details = await lstat(path).catch(() => {
      throw runtimeError('runtime_file_closure_mismatch', 'A managed runtime file is missing.')
    })
    if (!details.isFile() || details.isSymbolicLink() || details.size !== item.size) {
      throw runtimeError('runtime_file_hash_mismatch', 'A managed runtime file is invalid.')
    }
    const canonical = await realpath(path).catch(() => {
      throw runtimeError('runtime_file_invalid', 'A managed runtime file is unavailable.')
    })
    if (!isInside(canonicalRoot, canonical) || !samePath(path, canonical)) {
      throw runtimeError('runtime_file_invalid', 'The managed runtime contains a linked file.')
    }
    const digest = await sha256File(path)
    if (digest !== item.sha256) {
      throw runtimeError('runtime_file_hash_mismatch', 'A managed runtime file hash is invalid.')
    }
  }

  const entryPath = join(root, ENTRY_NAME)
  const noticesPath = join(root, NOTICES_NAME)
  const [entryDigest, noticesDigest] = await Promise.all([sha256File(entryPath), sha256File(noticesPath)])
  if ((expected.entrySha256 && entryDigest !== expected.entrySha256)
    || (expected.noticesSha256 && noticesDigest !== expected.noticesSha256)) {
    throw runtimeError('runtime_identity_mismatch', 'The managed runtime release identity is invalid.')
  }
  await assertPeX64(entryPath)
  return Object.freeze({
    root, entryPath, runtimeVersion: manifest.source.version,
    apiVersion: manifest.execution_api_version,
    protocolVersion: manifest.managed_protocol_version,
    sourceRevision: manifest.source.revision,
    fileCount: manifest.files.length,
  })
}

function isCredentialLikeEnvironmentName(name) {
  return /(?:^|[_-])(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|CAPABILITY)(?:$|[_-])/i.test(name)
    || name.endsWith('_API_KEY') || name.endsWith('_API_TOKEN') || name.endsWith('_API_SECRET')
    || name.startsWith('WEFTMATE_AI_GAME_')
}

function childEnvironment(source, secrets) {
  const env = { ...source }
  for (const key of Object.keys(env)) {
    if (isCredentialLikeEnvironmentName(key) || secrets.has(env[key])) delete env[key]
  }
  return env
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function delayWith(setTimer, clearTimer, milliseconds) {
  return new Promise((resolveDelay) => {
    const timer = setTimer(resolveDelay, milliseconds)
    timer?.unref?.()
  }).finally(() => { /* the timer has already fired */ })
}

function defaultTerminateProcessTree(child) {
  if (!child || typeof child.pid !== 'number') return Promise.resolve()
  if (process.platform !== 'win32') {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
    return Promise.resolve()
  }
  return new Promise((resolveTermination) => {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true, timeout: 5_000,
    }, () => {
      try { child.kill('SIGKILL') } catch { /* taskkill or process exit already won */ }
      resolveTermination()
    })
  })
}

async function responseBytes(response, maximum) {
  const declared = Number(response?.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maximum) {
    throw runtimeError('health_response_invalid', 'The managed runtime health response is too large.')
  }
  if (response?.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const chunk = Buffer.from(next.value)
      total += chunk.length
      if (total > maximum) {
        try { await reader.cancel() } catch { /* response is already rejected */ }
        throw runtimeError('health_response_invalid', 'The managed runtime health response is too large.')
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, total)
  }
  if (typeof response?.arrayBuffer === 'function') {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maximum) throw runtimeError('health_response_invalid', 'The managed runtime health response is too large.')
    return bytes
  }
  if (typeof response?.text === 'function') {
    const text = await response.text()
    const bytes = Buffer.from(text)
    if (bytes.length > maximum) throw runtimeError('health_response_invalid', 'The managed runtime health response is too large.')
    return bytes
  }
  throw runtimeError('health_response_invalid', 'The managed runtime health response is unavailable.')
}

function validateRootHealth(value, runtimeVersion) {
  if (!isRecord(value) || value.status !== 'ok' || value.service !== 'ai-game-console'
    || value.version !== runtimeVersion || value.database !== 'ready') {
    throw runtimeError('root_health_failed', 'The managed runtime root health contract failed.', { retryable: true })
  }
}

function validateV2Health(value) {
  if (!isRecord(value) || !['ready', 'needs_setup'].includes(value.status)
    || value.version !== AI_GAME_EXECUTION_API_VERSION || !isRecord(value.capabilities)
    || REQUIRED_V2_CAPABILITIES.some((name) => value.capabilities[name] !== true)
    || !isRecord(value.capabilities.android_ui_agent)
    || value.capabilities.android_ui_agent.version !== '1'
    || !Array.isArray(value.setup_reasons) || value.setup_reasons.length > 32
    || value.setup_reasons.some((reason) => typeof reason !== 'string' || reason.length < 1 || reason.length > 128)) {
    throw runtimeError('capability_incompatible', 'The managed runtime V2 capability contract failed.')
  }
  const runner = value.capabilities.android_ui_agent
  if (value.status === 'ready' && (runner.state !== 'ready' || runner.available !== true)) {
    throw runtimeError('capability_incompatible', 'The managed runtime runner readiness is inconsistent.')
  }
  if (value.status === 'needs_setup' && (runner.state !== 'needs_setup' || runner.available !== false)) {
    throw runtimeError('capability_incompatible', 'The managed runtime setup state is inconsistent.')
  }
  return value.status
}

export class ManagedAiGameRuntime {
  #options
  #runtimeRoot
  #state = 'not_installed'
  #reasonCode = 'runtime_not_installed'
  #retryable = false
  #runtimeVersion = null
  #apiVersion = null
  #publicOrigin = null
  #controlOrigin = null
  #shutdownToken = null
  #childRecord = null
  #registered = new Set()
  #generation = 0
  #closed = false
  #startInFlight = null
  #closeInFlight = null
  #recoveryTimer = null
  #recoveryInFlight = null
  #recoveryAttempts = 0

  constructor(options = {}) {
    const isPackaged = options.isPackaged === true
    const runtimeRoot = isPackaged
      ? (typeof options.resourcesPath === 'string' && options.resourcesPath
          ? join(resolve(options.resourcesPath), AI_GAME_RUNTIME_DIRECTORY) : null)
      : (typeof options.runtimeRoot === 'string' && options.runtimeRoot ? resolve(options.runtimeRoot) : null)
    if (typeof options.userDataDir !== 'string' || !options.userDataDir) {
      throw new TypeError('userDataDir must be an explicit absolute path')
    }
    const userDataDir = resolve(options.userDataDir)
    const ports = options.portCandidates ?? AI_GAME_PORT_CANDIDATES
    if (!Array.isArray(ports) || ports.length < 1 || ports.length > 8
      || new Set(ports).size !== ports.length
      || ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)) {
      throw new TypeError('portCandidates must be a small unique loopback port list')
    }
    this.#runtimeRoot = runtimeRoot
    this.#options = {
      isPackaged,
      userDataDir,
      writableRoot: join(userDataDir, 'ai-game'),
      dataDir: join(userDataDir, 'ai-game', 'data'),
      portCandidates: [...ports],
      resolveCredentials: options.resolveCredentials,
      resolveExecution: options.resolveExecution,
      verifyRuntime: options.verifyRuntime ?? verifyManagedAiGameRuntime,
      spawnImpl: options.spawnImpl ?? spawn,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      randomBytesImpl: options.randomBytesImpl ?? randomBytes,
      setTimer: options.setTimeoutImpl ?? setTimeout,
      clearTimer: options.clearTimeoutImpl ?? clearTimeout,
      terminateProcessTree: options.terminateProcessTree ?? defaultTerminateProcessTree,
      readyTimeoutMs: options.readyTimeoutMs ?? 20_000,
      healthTimeoutMs: options.healthTimeoutMs ?? 5_000,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 5_000,
      shutdownExitTimeoutMs: options.shutdownExitTimeoutMs ?? 5_000,
      forceExitTimeoutMs: options.forceExitTimeoutMs ?? 2_000,
      maxRecoveryAttempts: options.maxRecoveryAttempts ?? 2,
      recoveryBackoffMs: options.recoveryBackoffMs ?? [500, 1_500],
      onState: typeof options.onState === 'function' ? options.onState : null,
      environment: options.environment ?? process.env,
    }
  }

  diagnostics() {
    return {
      managed: true,
      state: this.#state,
      reasonCode: this.#reasonCode,
      runtimeVersion: this.#runtimeVersion,
      apiVersion: this.#apiVersion,
      retryable: this.#retryable,
    }
  }

  originForHost() {
    return this.#state === 'ready' ? this.#publicOrigin : null
  }

  start() {
    if (this.#closed) return Promise.resolve(this.diagnostics())
    if (this.#childRecord?.admitted === true && this.#state === 'ready') {
      return Promise.resolve(this.diagnostics())
    }
    if (this.#childRecord?.admitted === true && this.#state === 'needs_setup') {
      this.#startInFlight = this.#refreshNeedsSetup().finally(() => { this.#startInFlight = null })
      return this.#startInFlight
    }
    if (this.#startInFlight) return this.#startInFlight
    if (this.#recoveryInFlight) return this.#recoveryInFlight
    if (this.#recoveryTimer) {
      this.#options.clearTimer(this.#recoveryTimer)
      this.#recoveryTimer = null
    }
    this.#recoveryAttempts = 0
    this.#startInFlight = this.#runStart(false).finally(() => { this.#startInFlight = null })
    return this.#startInFlight
  }

  retry() { return this.start() }

  close() {
    if (this.#closeInFlight) return this.#closeInFlight
    this.#closed = true
    if (this.#recoveryTimer) {
      this.#options.clearTimer(this.#recoveryTimer)
      this.#recoveryTimer = null
    }
    this.#transition('stopping', 'shutdown_requested', false)
    const record = this.#childRecord
    const origin = this.#controlOrigin
    const shutdownToken = this.#shutdownToken
    this.#publicOrigin = null
    this.#controlOrigin = null
    this.#shutdownToken = null
    if (record) {
      record.expectedExit = true
      record.abortController.abort()
    }
    this.#closeInFlight = (async () => {
      if (record && !record.exited) {
        if (record.admitted && origin && shutdownToken) {
          try { await this.#requestShutdown(origin, shutdownToken) } catch { /* bounded fallback below */ }
          await this.#waitForExit(record, this.#options.shutdownExitTimeoutMs)
        }
        if (!record.exited) {
          try { record.child.stdin?.end?.() } catch { /* current child may already be closing */ }
          await this.#waitForExit(record, 500)
        }
        if (!record.exited) await this.#forceTerminate(record)
      }
      // A close racing verification/start may have registered a child after
      // the first snapshot only if it crossed the fence incorrectly. Drain the
      // set as a second bounded integrity guard.
      for (const pending of [...this.#registered]) {
        pending.expectedExit = true
        pending.abortController.abort()
        if (!pending.exited) await this.#forceTerminate(pending)
      }
      const unconfirmed = [...this.#registered].find((pending) => !pending.exited)
      if (unconfirmed) {
        this.#transition('unavailable', 'shutdown_unconfirmed', false)
        throw runtimeError('shutdown_unconfirmed', 'The managed runtime child exit could not be confirmed.')
      }
      this.#childRecord = null
      this.#transition('stopped', 'closed', false)
    })()
    return this.#closeInFlight
  }

  async #runStart(recovery) {
    try {
      await this.#attemptLaunch()
    } catch (error) {
      if (this.#closed) return this.diagnostics()
      const failure = error instanceof ManagedAiGameRuntimeError
        ? error : runtimeError('runtime_unavailable', 'The managed runtime is unavailable.', { retryable: true })
      if (recovery) throw failure
      const state = failure.code === 'runtime_not_installed' ? 'not_installed' : 'unavailable'
      this.#transition(state, failure.code, failure.retryable)
    }
    return this.diagnostics()
  }

  async #attemptLaunch() {
    if (this.#closed) throw runtimeError('closed', 'The managed runtime is closed.')
    if (!this.#runtimeRoot) throw runtimeError('runtime_not_installed', 'The managed runtime is not installed.')
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw runtimeError('runtime_host_incompatible', 'The managed runtime requires Windows x64.')
    }
    if (typeof this.#options.resolveCredentials !== 'function') {
      throw runtimeError('credential_unavailable', 'Managed AI-GAME credentials are unavailable.')
    }
    let credentials
    try { credentials = await this.#options.resolveCredentials() } catch {
      throw runtimeError('credential_unavailable', 'Managed AI-GAME credentials are unavailable.')
    }
    if (!isRecord(credentials) || !safeSecret(credentials.capability)
      || !safeIdentifier(credentials.principalId) || !safeIdentifier(credentials.controllerId)) {
      throw runtimeError('credential_unavailable', 'Managed AI-GAME credentials are unavailable.')
    }
    let execution = null
    try { execution = await this.#options.resolveExecution?.() ?? null }
    catch { throw runtimeError('execution_configuration_unavailable', 'Phone execution configuration is unavailable.', { retryable: true }) }
    // Credential resolution can await protected storage.  Verify the artifact
    // only after it, so no await is left between the final verification result
    // and child spawn. This narrows, but cannot remove, installation-directory
    // races outside this process boundary.
    this.#transition('verifying', 'verification_in_progress', true)
    const verified = await this.#options.verifyRuntime(this.#runtimeRoot)
    if (this.#closed) throw runtimeError('closed', 'The managed runtime is closed.')
    this.#runtimeVersion = verified.runtimeVersion
    this.#apiVersion = verified.apiVersion
    if (verified.protocolVersion !== AI_GAME_MANAGED_PROTOCOL_VERSION
      || verified.apiVersion !== AI_GAME_EXECUTION_API_VERSION) {
      throw runtimeError('runtime_incompatible', 'The managed runtime protocol is incompatible.')
    }
    this.#transition('starting', 'startup_in_progress', true)
    const failures = []
    for (const port of this.#options.portCandidates) {
      if (this.#closed) throw runtimeError('closed', 'The managed runtime is closed.')
      try {
        await this.#spawnCandidate(verified, credentials, port, execution)
        return
      } catch (error) {
        const failure = error instanceof ManagedAiGameRuntimeError
          ? error : runtimeError('child_spawn_failed', 'The managed runtime child failed to start.', { retryable: true, candidateFailure: true })
        failures.push(failure)
        if (!failure.candidateFailure) throw failure
      }
    }
    const codes = new Set(failures.map((failure) => failure.code))
    const code = codes.size === 1 && codes.has('child_spawn_failed')
      ? 'child_spawn_failed'
      : codes.size === 1 && codes.has('ready_timeout')
        ? 'ready_timeout'
        : codes.size === 1 && codes.has('ready_nonce_mismatch')
          ? 'ready_nonce_mismatch'
          : 'port_candidates_exhausted'
    throw runtimeError(code, 'No managed runtime loopback candidate became ready.', { retryable: true })
  }

  async #spawnCandidate(verified, credentials, port, execution) {
    const nonce = this.#randomSecret(24)
    const shutdownToken = this.#randomSecret(32)
    let child
    try {
      child = this.#options.spawnImpl(verified.entryPath, [], {
        cwd: verified.root,
        env: childEnvironment(this.#options.environment, new Set([
          credentials.capability, shutdownToken, nonce, ...(execution ? [execution.model.api_key] : []),
        ])),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      throw runtimeError('child_spawn_failed', 'The managed runtime child could not be spawned.', { retryable: true, candidateFailure: true })
    }
    if (!child?.stdin || !child?.stdout || !child?.stderr || typeof child.once !== 'function') {
      try { child?.kill?.('SIGKILL') } catch { /* malformed child stub */ }
      throw runtimeError('child_spawn_failed', 'The managed runtime child pipes are unavailable.', { retryable: true, candidateFailure: true })
    }

    const record = this.#registerChild(child, nonce, port, credentials)
    this.#childRecord = record
    const frame = {
      protocol_version: AI_GAME_MANAGED_PROTOCOL_VERSION,
      nonce,
      host: '127.0.0.1',
      port,
      writable_root: this.#options.writableRoot,
      data_dir: this.#options.dataDir,
      runtime_mode: 'weftmate-managed-v1',
      capability: credentials.capability,
      shutdown_token: shutdownToken,
      ...(execution ? { execution } : {}),
    }
    const encoded = Buffer.from(`${JSON.stringify(frame)}\n`, 'utf8')
    try {
      if (encoded.length > 16 * 1024) {
        throw runtimeError('startup_frame_invalid', 'The managed runtime startup frame is too large.')
      }
      await new Promise((resolveWrite, rejectWrite) => {
        child.stdin.write(encoded, (error) => { if (error) rejectWrite(error); else resolveWrite() })
      })
    } catch (error) {
      encoded.fill(0)
      record.expectedExit = true
      await this.#stopCandidate(record)
      if (error instanceof ManagedAiGameRuntimeError) throw error
      throw runtimeError('child_spawn_failed', 'The managed runtime startup frame could not be delivered.', { retryable: true, candidateFailure: true })
    }
    encoded.fill(0)

    let ready
    try {
      ready = await this.#awaitReady(record)
    } catch (error) {
      record.expectedExit = true
      await this.#stopCandidate(record)
      throw error
    }
    if (this.#closed || this.#childRecord !== record) {
      record.expectedExit = true
      await this.#stopCandidate(record)
      throw runtimeError('closed', 'The managed runtime is closed.')
    }
    const origin = `http://127.0.0.1:${ready.port}`
    this.#controlOrigin = origin
    this.#shutdownToken = shutdownToken
    try {
      const rootHealth = await this.#fetchJson(`${origin}/health`, {
        method: 'GET', headers: { Accept: 'application/json' },
      }, this.#options.healthTimeoutMs, record.abortController.signal)
      validateRootHealth(rootHealth, verified.runtimeVersion)
      const v2Health = await this.#fetchJson(`${origin}/api/execution/v2/health`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-AI-Game-Client': CLIENT_ID,
          Authorization: `Bearer ${credentials.capability}`,
          'X-AI-Game-Principal-Id': credentials.principalId,
          'X-AI-Game-Controller-Id': credentials.controllerId,
        },
      }, this.#options.healthTimeoutMs, record.abortController.signal)
      const healthState = validateV2Health(v2Health)
      if (this.#closed || this.#childRecord !== record || record.exited) {
        throw runtimeError('closed', 'The managed runtime is closed.')
      }
      record.admitted = true
      if (healthState === 'ready') {
        this.#publicOrigin = origin
        this.#transition('ready', 'ready', false)
      } else {
        this.#publicOrigin = null
        this.#transition('needs_setup', 'executor_needs_setup', true)
      }
    } catch (error) {
      this.#publicOrigin = null
      this.#controlOrigin = null
      this.#shutdownToken = null
      record.expectedExit = true
      await this.#stopCandidate(record)
      if (error instanceof ManagedAiGameRuntimeError) throw error
      throw runtimeError('v2_health_failed', 'The managed runtime authenticated health check failed.', { retryable: true })
    }
  }

  #randomSecret(bytes) {
    const value = this.#options.randomBytesImpl(bytes)
    if (!Buffer.isBuffer(value) || value.length < bytes) {
      throw runtimeError('random_source_unavailable', 'The managed runtime random source is unavailable.')
    }
    return value.toString('base64url')
  }

  #registerChild(child, nonce, port, credentials) {
    const record = {
      child, nonce, port, generation: ++this.#generation, expectedExit: false,
      admitted: false, exited: false, exitCode: null, abortController: new AbortController(),
      credentials, resolveExit: null, exitPromise: null, resolveError: null, errorPromise: null,
    }
    record.exitPromise = new Promise((resolveExit) => { record.resolveExit = resolveExit })
    record.errorPromise = new Promise((resolveError) => { record.resolveError = resolveError })
    this.#registered.add(record)
    let settled = false
    const exited = (code) => {
      if (settled) return
      settled = true
      record.exited = true
      record.exitCode = Number.isInteger(code) ? code : null
      record.abortController.abort()
      this.#registered.delete(record)
      record.resolveExit()
      this.#handleUnexpectedExit(record)
    }
    child.once('exit', exited)
    child.once('close', exited)
    child.once('error', () => { record.resolveError() })
    child.stderr.on?.('data', () => { /* drain without retaining or logging child output */ })
    return record
  }

  async #refreshNeedsSetup() {
    const record = this.#childRecord
    const origin = this.#controlOrigin
    if (!record?.admitted || record.exited || !origin || !record.credentials) {
      this.#transition('unavailable', 'needs_setup_child_missing', true)
      return this.diagnostics()
    }
    try {
      const value = await this.#fetchJson(`${origin}/api/execution/v2/health`, {
        method: 'GET',
        headers: {
          Accept: 'application/json', 'X-AI-Game-Client': CLIENT_ID,
          Authorization: `Bearer ${record.credentials.capability}`,
          'X-AI-Game-Principal-Id': record.credentials.principalId,
          'X-AI-Game-Controller-Id': record.credentials.controllerId,
        },
      }, this.#options.healthTimeoutMs, record.abortController.signal)
      const healthState = validateV2Health(value)
      if (this.#closed || this.#childRecord !== record || record.exited) return this.diagnostics()
      if (healthState === 'ready') {
        this.#publicOrigin = origin
        this.#transition('ready', 'ready', false)
      } else {
        this.#publicOrigin = null
        this.#transition('needs_setup', 'executor_needs_setup', true)
      }
    } catch (error) {
      this.#publicOrigin = null
      this.#transition('unavailable', error?.code ?? 'needs_setup_refresh_failed', true)
    }
    return this.diagnostics()
  }

  #awaitReady(record) {
    return new Promise((resolveReady, rejectReady) => {
      let pending = Buffer.alloc(0)
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        this.#options.clearTimer(timer)
        record.child.stdout.removeListener?.('data', onData)
        if (error) rejectReady(error)
        else resolveReady(value)
      }
      const onData = (chunk) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        pending = Buffer.concat([pending, bytes])
        if (pending.length > MAX_READY_BYTES) {
          finish(runtimeError('ready_invalid', 'The managed runtime ready frame is too large.', { retryable: true, candidateFailure: true }))
          return
        }
        const newline = pending.indexOf(0x0a)
        if (newline < 0) return
        const line = pending.subarray(0, newline).toString('utf8').replace(/\r$/, '')
        const trailing = pending.subarray(newline + 1)
        let decoded
        try { decoded = JSON.parse(line) } catch {
          finish(runtimeError('ready_invalid', 'The managed runtime ready frame is invalid.', { retryable: true, candidateFailure: true }))
          return
        }
        if (trailing.length !== 0 || !exactKeys(decoded, ['type', 'protocol_version', 'nonce', 'host', 'port'])
          || decoded.type !== 'ai_game_managed_ready'
          || decoded.protocol_version !== AI_GAME_MANAGED_PROTOCOL_VERSION
          || decoded.host !== '127.0.0.1' || decoded.port !== record.port) {
          finish(runtimeError('ready_invalid', 'The managed runtime ready frame is invalid.', { retryable: true, candidateFailure: true }))
          return
        }
        if (!safeEqual(decoded.nonce, record.nonce)) {
          finish(runtimeError('ready_nonce_mismatch', 'The managed runtime ready nonce did not match.', { retryable: true, candidateFailure: true }))
          return
        }
        finish(null, decoded)
      }
      record.child.stdout.on('data', onData)
      void record.exitPromise.then(() => {
        finish(runtimeError('child_exited_before_ready', 'The managed runtime child exited before ready.', { retryable: true, candidateFailure: true }))
      })
      void record.errorPromise.then(() => {
        finish(runtimeError('child_spawn_failed', 'The managed runtime child failed during startup.', { retryable: true, candidateFailure: true }))
      })
      const timer = this.#options.setTimer(() => {
        finish(runtimeError('ready_timeout', 'The managed runtime did not become ready in time.', { retryable: true, candidateFailure: true }))
      }, this.#options.readyTimeoutMs)
      timer?.unref?.()
    })
  }

  async #fetchJson(url, init, timeoutMs, parentSignal) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    parentSignal?.addEventListener('abort', abort, { once: true })
    const timeout = this.#options.setTimer(() => controller.abort(), timeoutMs)
    timeout?.unref?.()
    try {
      const response = await this.#options.fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' })
      if (!response || response.status !== 200) {
        throw runtimeError('health_request_failed', 'The managed runtime health endpoint rejected the request.', { retryable: true })
      }
      const contentType = String(response.headers?.get?.('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        throw runtimeError('health_response_invalid', 'The managed runtime health response type is invalid.')
      }
      const bytes = await responseBytes(response, MAX_HEALTH_BYTES)
      try { return JSON.parse(bytes.toString('utf8')) } catch {
        throw runtimeError('health_response_invalid', 'The managed runtime health response is invalid JSON.')
      }
    } catch (error) {
      if (error instanceof ManagedAiGameRuntimeError) throw error
      throw runtimeError('health_request_failed', 'The managed runtime health request failed.', { retryable: true })
    } finally {
      this.#options.clearTimer(timeout)
      parentSignal?.removeEventListener('abort', abort)
    }
  }

  async #requestShutdown(origin, token) {
    const controller = new AbortController()
    const timeout = this.#options.setTimer(() => controller.abort(), this.#options.shutdownTimeoutMs)
    timeout?.unref?.()
    try {
      const response = await this.#options.fetchImpl(`${origin}/api/v1/shutdown`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'X-AI-Game-Client': SHUTDOWN_CLIENT_ID,
          'X-AI-Game-Shutdown-Token': token,
        },
      })
      if (!response || response.status !== 202) throw runtimeError('shutdown_rejected', 'The managed runtime rejected shutdown.')
      const bytes = await responseBytes(response, MAX_HEALTH_BYTES)
      let decoded
      try { decoded = JSON.parse(bytes.toString('utf8')) } catch {
        throw runtimeError('shutdown_rejected', 'The managed runtime shutdown response is invalid.')
      }
      if (!isRecord(decoded) || decoded.status !== 'accepted') {
        throw runtimeError('shutdown_rejected', 'The managed runtime shutdown response is invalid.')
      }
    } finally {
      this.#options.clearTimer(timeout)
    }
  }

  async #stopCandidate(record) {
    if (!record.exited) {
      try { record.child.stdin?.end?.() } catch { /* only the registered child is touched */ }
      await this.#waitForExit(record, 500)
    }
    if (!record.exited) await this.#forceTerminate(record)
    if (this.#childRecord === record) this.#childRecord = null
  }

  async #forceTerminate(record) {
    if (record.exited || !this.#registered.has(record)) return
    await this.#options.terminateProcessTree(record.child)
    await this.#waitForExit(record, this.#options.forceExitTimeoutMs)
    if (!record.exited && this.#registered.has(record)) {
      try { record.child.kill?.('SIGKILL') } catch { /* registered child raced exit */ }
      await this.#waitForExit(record, this.#options.forceExitTimeoutMs)
    }
    return record.exited
  }

  async #waitForExit(record, milliseconds) {
    if (record.exited) return true
    let timer
    const timedOut = new Promise((resolveTimeout) => {
      timer = this.#options.setTimer(() => resolveTimeout(false), milliseconds)
      timer?.unref?.()
    })
    const result = await Promise.race([record.exitPromise.then(() => true), timedOut])
    this.#options.clearTimer(timer)
    return result
  }

  #handleUnexpectedExit(record) {
    if (this.#childRecord !== record) return
    this.#childRecord = null
    if (this.#closed || record.expectedExit || !record.admitted) return
    this.#publicOrigin = null
    this.#controlOrigin = null
    this.#shutdownToken = null
    this.#transition('recovering', 'child_exited', true)
    this.#scheduleRecovery()
  }

  #scheduleRecovery() {
    if (this.#closed || this.#recoveryTimer || this.#recoveryInFlight) return
    if (this.#recoveryAttempts >= this.#options.maxRecoveryAttempts) {
      this.#transition('unavailable', 'recovery_exhausted', true)
      return
    }
    const attempt = this.#recoveryAttempts++
    const delays = this.#options.recoveryBackoffMs
    const backoff = delays[Math.min(attempt, delays.length - 1)] ?? 1_500
    this.#recoveryTimer = this.#options.setTimer(() => {
      this.#recoveryTimer = null
      if (this.#closed) return
      let retry = false
      this.#recoveryInFlight = this.#runStart(true).then(
        (value) => value,
        (error) => {
          if (!this.#closed) {
            this.#transition('recovering', error?.code ?? 'recovery_failed', true)
            retry = true
          }
          return this.diagnostics()
        },
      ).finally(() => {
        this.#recoveryInFlight = null
        if (retry && !this.#closed) this.#scheduleRecovery()
      })
    }, backoff)
    this.#recoveryTimer?.unref?.()
  }

  #transition(state, reasonCode, retryable) {
    if (!STATES.has(state)) throw new TypeError('invalid managed AI-GAME state')
    if (this.#closed && !['stopping', 'stopped', 'unavailable'].includes(state)) return
    this.#state = state
    this.#reasonCode = reasonCode
    this.#retryable = retryable === true
    try { this.#options.onState?.(this.diagnostics()) } catch { /* diagnostics observer is non-authoritative */ }
  }
}
