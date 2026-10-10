/** DshWebRuntime 阶段 0 生命周期回归：用隔离 fake CLI 覆盖真实 ChildProcess 边界。 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'

let root: string

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'weftmate-dsh-runtime-lifecycle-'))
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

const fakeCli = `
const { spawn } = require('node:child_process')
const { writeFileSync, renameSync } = require('node:fs')
const mode = process.env.WEFTMATE_TEST_MODE || 'ready'
if (process.env.WEFTMATE_TEST_ROOT_PID) writeFileSync(process.env.WEFTMATE_TEST_ROOT_PID, String(process.pid))
const envOutput = process.env.WEFTMATE_TEST_ENV_OUTPUT
const observed = {
  inheritedKey: process.env.WEFTMATE_LLM_KEY_FAKE ?? null,
  inheritedToken: process.env.WEFTMATE_TEST_GITHUB_TOKEN ?? null,
  inheritedPassword: process.env.WEFTMATE_TEST_PASSWORD ?? null,
  inheritedSigningKey: process.env.WEFTMATE_TEST_SIGNING_KEY ?? null,
  inheritedOrdinary: process.env.WEFTMATE_TEST_ORDINARY ?? null,
}
// The parent polls this file concurrently with IPC updates. Publish a complete
// snapshot so a reader cannot observe the truncate-before-write interval.
const saveObserved = () => {
  if (!envOutput) return
  writeFileSync(envOutput + '.tmp', JSON.stringify(observed))
  renameSync(envOutput + '.tmp', envOutput)
}
saveObserved()
if (mode === 'descendant' || mode === 'dispose-ack') {
  const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  if (process.env.WEFTMATE_TEST_DESCENDANT_PID) writeFileSync(process.env.WEFTMATE_TEST_DESCENDANT_PID, String(descendant.pid))
}
if (mode === 'dispose-ack') process.on('message', (frame) => {
  if (frame.protocol !== 'weftmate.runtime-shutdown.v1' || frame.action !== 'dispose') return
  setTimeout(() => {
    writeFileSync(process.env.WEFTMATE_TEST_SHUTDOWN_FILE, 'drained')
    process.send({ protocol: 'weftmate.runtime-shutdown.v1', action: 'disposed' })
  }, 150)
})
const delay = mode === 'starting' ? 10_000 : 0
setTimeout(() => {
  console.log('dsh web: http://127.0.0.1:43123')
  if (mode === 'ready-exit') setTimeout(() => process.exit(0), 35)
}, delay)
if (mode === 'credential-ipc') {
  process.on('message', (message) => {
    observed.response = message
    saveObserved()
  })
  setTimeout(() => {
    process.send?.({ protocol: 'weftmate.credentials.v1', id: 'fake-request-1', operation: 'resolve', ref: 'WEFTMATE_LLM_KEY_FAKE' })
  }, 20)
}
if (mode !== 'ready-exit') setInterval(() => {}, 1000)
`

async function makeCheckout(name: string): Promise<string> {
  const checkout = join(root, name)
  const bin = join(checkout, 'apps', 'cli', 'lib', 'bin.js')
  await mkdir(join(checkout, 'apps', 'cli', 'lib'), { recursive: true })
  await mkdir(join(checkout, 'vendor', 'group', 'lib'), { recursive: true })
  await writeFile(bin, fakeCli, 'utf8')
  await writeFile(join(checkout, 'vendor', 'group', 'lib', 'index.js'), 'module.exports = {}\n', 'utf8')
  return checkout
}

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) return (await readFile(path, 'utf8')).trim()
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function waitForCredentialResponse(path: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
      if (parsed.response !== undefined) return parsed
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for credential response ${path}`)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function runtime(checkoutPath: string, env: NodeJS.ProcessEnv): DshWebRuntime {
  return new DshWebRuntime({
    checkoutPath,
    homeDir: join(root, `home-${Math.random().toString(16).slice(2)}`),
    workspaceDir: join(root, `workspace-${Math.random().toString(16).slice(2)}`),
    readyTimeoutMs: 15_000,
    credentialEnv: () => env,
  })
}

describe('DshWebRuntime lifecycle fences（阶段 0）', () => {
  test('Windows shutdown drains native persistence before collecting root and descendant', { skip: process.platform !== 'win32' }, async () => {
    const checkout = await makeCheckout('dispose-ack')
    const rootFile = join(root, 'dispose-root.pid'), descendantFile = join(root, 'dispose-descendant.pid'), shutdownFile = join(root, 'dispose.state')
    const web = runtime(checkout, { WEFTMATE_TEST_MODE: 'dispose-ack', WEFTMATE_TEST_ROOT_PID: rootFile,
      WEFTMATE_TEST_DESCENDANT_PID: descendantFile, WEFTMATE_TEST_SHUTDOWN_FILE: shutdownFile })
    try {
      await web.start()
      // Fake CLI has no package closure; designate this exact owned carrier
      // as the secure-bootstrap child to exercise the production handshake.
      ;(web as any).secureChildren.add((web as any).child)
      const rootPid = Number(await waitForFile(rootFile)), descendantPid = Number(await waitForFile(descendantFile))
      await web.close()
      assert.equal(await readFile(shutdownFile, 'utf8'), 'drained')
      assert.equal(isAlive(rootPid), false)
      assert.equal(isAlive(descendantPid), false)
    } finally { await web.close() }
  })
  test('显式 checkoutPath/runtimePath 压过环境变量', async () => {
    const checkout = await makeCheckout('explicit-checkout')
    const vendor = join(root, 'explicit-vendor')
    const vendorBin = join(vendor, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await mkdir(join(vendor, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
    await writeFile(vendorBin, fakeCli, 'utf8')

    const oldCheckout = process.env.WEFTMATE_DSH_CHECKOUT
    const oldRuntime = process.env.WEFTMATE_DSH_RUNTIME
    process.env.WEFTMATE_DSH_CHECKOUT = join(root, 'environment-must-not-win')
    process.env.WEFTMATE_DSH_RUNTIME = join(root, 'environment-must-not-win')
    try {
      const checkoutRuntime = new DshWebRuntime({
        checkoutPath: checkout,
        // 空字符串也是明确 runtimePath：它不得被 shell 遗留的 runtime env 覆盖。
        runtimePath: '',
        homeDir: join(root, 'checkout-home'),
        workspaceDir: join(root, 'checkout-workspace'),
        credentialEnv: () => ({ WEFTMATE_TEST_MODE: 'ready' }),
      })
      // 显式 checkout 同时要压过 checkout env；显式 runtime 则选择其 vendor 路径。
      assert.equal(checkoutRuntime.form(), 'checkout')
      assert.equal(await checkoutRuntime.start(), 'http://127.0.0.1:43123')
      await checkoutRuntime.close()

      const vendorRuntime = new DshWebRuntime({
        checkoutPath: join(root, 'unused-explicit-checkout'),
        runtimePath: vendor,
        homeDir: join(root, 'vendor-home'),
        workspaceDir: join(root, 'vendor-workspace'),
        credentialEnv: () => ({ WEFTMATE_TEST_MODE: 'ready' }),
      })
      assert.equal(vendorRuntime.form(), 'vendor')
      assert.equal(await vendorRuntime.start(), 'http://127.0.0.1:43123')
      await vendorRuntime.close()
    } finally {
      if (oldCheckout === undefined) delete process.env.WEFTMATE_DSH_CHECKOUT
      else process.env.WEFTMATE_DSH_CHECKOUT = oldCheckout
      if (oldRuntime === undefined) delete process.env.WEFTMATE_DSH_RUNTIME
      else process.env.WEFTMATE_DSH_RUNTIME = oldRuntime
    }
  })

  test('start-close race：启动中 child 被关闭，start 明确 reject，且 close 可并发复用', async () => {
    const checkout = await makeCheckout('starting-race')
    const rootPidFile = join(root, 'starting-root.pid')
    const web = runtime(checkout, {
      WEFTMATE_TEST_MODE: 'starting',
      WEFTMATE_TEST_ROOT_PID: rootPidFile,
    })
    const start = web.start()
    const rootPid = Number(await waitForFile(rootPidFile))
    const closeA = web.close()
    const closeB = web.close()
    assert.strictEqual(closeA, closeB)
    await closeA
    await assert.rejects(start, /DshWebRuntime is closed/)
    assert.equal(web.isRunning(), false)
    assert.equal(isAlive(rootPid), false)
  })

  test('checkout 缺 vendor/group 编译入口时 fail closed，且不 spawn', async () => {
    const checkout = join(root, 'missing-group-entry')
    const bin = join(checkout, 'apps', 'cli', 'lib', 'bin.js')
    const rootPidFile = join(root, 'missing-group-root.pid')
    await mkdir(join(checkout, 'apps', 'cli', 'lib'), { recursive: true })
    await writeFile(bin, fakeCli, 'utf8')
    const web = runtime(checkout, { WEFTMATE_TEST_ROOT_PID: rootPidFile })

    await assert.rejects(
      web.start(),
      /pin 可能匹配，但 checkout 编译产物不完整；需 Harness 所有者提供已构建 checkout/,
    )
    assert.equal(existsSync(rootPidFile), false)
    await web.close()
  })

  test('checkout 缺 CLI 编译入口时直接归为外部预检阻断，不重试或建议跨项目构建', async t => {
    const checkout = join(root, 'missing-cli-checkout')
    const web = runtime(checkout, { WEFTMATE_TEST_MODE: 'ready' })
    const preflight = t.mock.method(web as any, 'preflightThenSpawn')
    await assert.rejects(
      web.start(),
      /checkout 编译产物不完整[\s\S]*需 Harness 所有者提供已构建 checkout/,
    )
    assert.equal(preflight.mock.callCount(), 1, '不可恢复的 checkout preflight 不应做三次重试')
    await web.close()
  })

  test('ready child 与 descendant 都随 close 退出，且迟到 close 事件不触发 respawn', async () => {
    const checkout = await makeCheckout('descendant-tree')
    const rootPidFile = join(root, 'tree-root.pid')
    const descendantPidFile = join(root, 'tree-descendant.pid')
    const web = runtime(checkout, {
      WEFTMATE_TEST_MODE: 'descendant',
      WEFTMATE_TEST_ROOT_PID: rootPidFile,
      WEFTMATE_TEST_DESCENDANT_PID: descendantPidFile,
    })
    assert.equal(await web.start(), 'http://127.0.0.1:43123')
    const rootPid = Number(await waitForFile(rootPidFile))
    const descendantPid = Number(await waitForFile(descendantPidFile))
    assert.equal(isAlive(rootPid), true)
    assert.equal(isAlive(descendantPid), true)
    await web.close()
    // taskkill /T /F 的契约是整个 root tree；后续一小段时间也不得被 on-close 复活。
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    assert.equal(isAlive(rootPid), false)
    assert.equal(isAlive(descendantPid), false)
    assert.equal(web.origin(), null)
    assert.equal(web.isRunning(), false)
  })

  test('secure credential preflight runs again before a crash respawn publishes a new origin', async () => {
    const checkout = await makeCheckout('secure-preflight-respawn')
    const previousMode = process.env.WEFTMATE_TEST_MODE
    process.env.WEFTMATE_TEST_MODE = 'ready-exit'
    let denyRespawn = false
    const origins: Array<string | null> = []
    const logs: string[] = []
    const web = new DshWebRuntime({
      checkoutPath: checkout,
      homeDir: join(root, 'secure-preflight-respawn-home'),
      workspaceDir: join(root, 'secure-preflight-respawn-workspace'),
      credentialRequestHandler: async () => ({}),
      testOnlySecureCompositionPreflight: async () => {
        if (denyRespawn) throw new Error('isolated credentials alias')
      },
      log: (line) => logs.push(line),
      readyTimeoutMs: 15_000,
    })
    web.onOrigin = (origin) => origins.push(origin)
    try {
      assert.equal(await web.start(), 'http://127.0.0.1:43123')
      denyRespawn = true
      for (let attempt = 0; attempt < 150 && !logs.some((line) => line.includes('重拉失败')); attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      }
      assert.equal(origins.includes(null), true, 'ready child exit must revoke the old origin')
      assert.equal(origins.some((origin) => origin !== null), false, 'failed respawn must not publish a new origin')
      assert.equal(web.isRunning(), false, 'failed preflight must not spawn a second web child')
      assert.equal(logs.some((line) => line.includes('重拉失败')), true)
    } finally {
      await web.close()
      if (previousMode === undefined) delete process.env.WEFTMATE_TEST_MODE
      else process.env.WEFTMATE_TEST_MODE = previousMode
    }
  })

  test('never inherits an ambient WEFTMATE_LLM_KEY ref when main injects no credential for it', async () => {
    const checkout = await makeCheckout('ambient-route-key')
    const output = join(root, 'ambient-route-key.json')
    const previous = process.env.WEFTMATE_LLM_KEY_FAKE
    process.env.WEFTMATE_LLM_KEY_FAKE = 'ambient-test-only-key'
    try {
      const web = runtime(checkout, { WEFTMATE_TEST_MODE: 'ready', WEFTMATE_TEST_ENV_OUTPUT: output })
      await web.start()
      assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
        inheritedKey: null,
        inheritedToken: null,
        inheritedPassword: null,
        inheritedSigningKey: null,
        inheritedOrdinary: null,
      })
      await web.close()
    } finally {
      if (previous === undefined) delete process.env.WEFTMATE_LLM_KEY_FAKE
      else process.env.WEFTMATE_LLM_KEY_FAKE = previous
    }
  })

  test('credential IPC：关联请求仅走专用 stdio，handler 存值而 child 环境不含 legacy key', async () => {
    const checkout = await makeCheckout('credential-ipc')
    const output = join(root, 'credential-ipc.json')
    const seen: Array<{ id: string, operation: string, ref: string, value?: string }> = []
    let legacyCredentialEnvCalls = 0
    const oldMode = process.env.WEFTMATE_TEST_MODE
    const oldOutput = process.env.WEFTMATE_TEST_ENV_OUTPUT
    process.env.WEFTMATE_TEST_MODE = 'credential-ipc'
    process.env.WEFTMATE_TEST_ENV_OUTPUT = output
    const web = new DshWebRuntime({
      checkoutPath: checkout,
      homeDir: join(root, 'credential-ipc-home'),
      workspaceDir: join(root, 'credential-ipc-workspace'),
      readyTimeoutMs: 15_000,
      credentialEnv: () => {
        legacyCredentialEnvCalls += 1
        return { WEFTMATE_LLM_KEY_FAKE: 'test-only-secret-must-not-be-env' }
      },
      credentialRequestHandler: async (request) => {
        seen.push({ ...request })
        return { value: 'test-only-secret-from-main', source: 'safe-storage' }
      },
      testOnlySecureCompositionPreflight: async () => {},
    })
    try {
      await web.start()
      const observed = await waitForCredentialResponse(output) as {
        inheritedKey: string | null
        response?: { ok?: boolean, result?: { value?: string, source?: string } }
      }
      assert.equal(observed.inheritedKey, null)
      assert.equal(legacyCredentialEnvCalls, 0, '安全 IPC 接通后不得读取 legacy credentialEnv')
      assert.deepEqual(seen, [{ id: 'fake-request-1', operation: 'resolve', ref: 'WEFTMATE_LLM_KEY_FAKE' }])
      assert.equal(observed.response?.ok, true)
      assert.equal(observed.response?.result?.value, 'test-only-secret-from-main')
      assert.equal(observed.response?.result?.source, 'safe-storage')
    } finally {
      await web.close()
      if (oldMode === undefined) delete process.env.WEFTMATE_TEST_MODE
      else process.env.WEFTMATE_TEST_MODE = oldMode
      if (oldOutput === undefined) delete process.env.WEFTMATE_TEST_ENV_OUTPUT
      else process.env.WEFTMATE_TEST_ENV_OUTPUT = oldOutput
    }
  })

  test('credential IPC：安全桥清洗所有常见密钥类 ambient env，但保留普通运行环境', async () => {
    const checkout = await makeCheckout('credential-ipc-ambient-scrub')
    const output = join(root, 'credential-ipc-ambient-scrub.json')
    const names = [
      'WEFTMATE_TEST_GITHUB_TOKEN',
      'WEFTMATE_TEST_PASSWORD',
      'WEFTMATE_TEST_SIGNING_KEY',
      'WEFTMATE_TEST_ORDINARY',
      'WEFTMATE_TEST_ENV_OUTPUT',
    ] as const
    const previous = new Map(names.map((name) => [name, process.env[name]]))
    process.env.WEFTMATE_TEST_GITHUB_TOKEN = 'test-only-token'
    process.env.WEFTMATE_TEST_PASSWORD = 'test-only-password'
    process.env.WEFTMATE_TEST_SIGNING_KEY = 'test-only-signing-key'
    process.env.WEFTMATE_TEST_ORDINARY = 'ordinary-value'
    process.env.WEFTMATE_TEST_ENV_OUTPUT = output
    const web = new DshWebRuntime({
      checkoutPath: checkout,
      homeDir: join(root, 'credential-ipc-ambient-scrub-home'),
      workspaceDir: join(root, 'credential-ipc-ambient-scrub-workspace'),
      readyTimeoutMs: 15_000,
      credentialEnv: () => ({ WEFTMATE_LLM_KEY_FAKE: 'legacy-must-not-run' }),
      credentialRequestHandler: async () => ({}),
      testOnlySecureCompositionPreflight: async () => {},
    })
    try {
      await web.start()
      assert.deepEqual(JSON.parse(await waitForFile(output)), {
        inheritedKey: null,
        inheritedToken: null,
        inheritedPassword: null,
        inheritedSigningKey: null,
        inheritedOrdinary: 'ordinary-value',
      })
    } finally {
      await web.close()
      for (const name of names) {
        const value = previous.get(name)
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  test('credential IPC：同步抛错的 handler 也只返回受控 failed', async () => {
    const checkout = await makeCheckout('credential-ipc-sync-throw')
    const output = join(root, 'credential-ipc-sync-throw.json')
    const oldMode = process.env.WEFTMATE_TEST_MODE
    const oldOutput = process.env.WEFTMATE_TEST_ENV_OUTPUT
    process.env.WEFTMATE_TEST_MODE = 'credential-ipc'
    process.env.WEFTMATE_TEST_ENV_OUTPUT = output
    const web = new DshWebRuntime({
      checkoutPath: checkout,
      homeDir: join(root, 'credential-ipc-sync-throw-home'),
      workspaceDir: join(root, 'credential-ipc-sync-throw-workspace'),
      readyTimeoutMs: 15_000,
      credentialEnv: () => ({}),
      credentialRequestHandler: () => { throw new Error('must not escape') },
      testOnlySecureCompositionPreflight: async () => {},
    })
    try {
      await web.start()
      const observed = await waitForCredentialResponse(output) as { response?: { ok?: boolean, error?: string } }
      assert.equal(observed.response?.ok, false)
      assert.equal(observed.response?.error, 'failed')
    } finally {
      await web.close()
      if (oldMode === undefined) delete process.env.WEFTMATE_TEST_MODE
      else process.env.WEFTMATE_TEST_MODE = oldMode
      if (oldOutput === undefined) delete process.env.WEFTMATE_TEST_ENV_OUTPUT
      else process.env.WEFTMATE_TEST_ENV_OUTPUT = oldOutput
    }
  })

  test('credential IPC：main handler 超时 fail-closed，close 不等待悬挂 handler', async () => {
    const checkout = await makeCheckout('credential-ipc-timeout')
    const output = join(root, 'credential-ipc-timeout.json')
    const oldMode = process.env.WEFTMATE_TEST_MODE
    const oldOutput = process.env.WEFTMATE_TEST_ENV_OUTPUT
    process.env.WEFTMATE_TEST_MODE = 'credential-ipc'
    process.env.WEFTMATE_TEST_ENV_OUTPUT = output
    const web = new DshWebRuntime({
      checkoutPath: checkout,
      homeDir: join(root, 'credential-ipc-timeout-home'),
      workspaceDir: join(root, 'credential-ipc-timeout-workspace'),
      readyTimeoutMs: 15_000,
      credentialEnv: () => ({}),
      credentialRequestTimeoutMs: 25,
      credentialRequestHandler: async () => new Promise(() => {}),
      testOnlySecureCompositionPreflight: async () => {},
    })
    try {
      await web.start()
      const observed = await waitForCredentialResponse(output) as { response?: { ok?: boolean, error?: string } }
      assert.equal(observed.response?.ok, false)
      assert.equal(observed.response?.error, 'timeout')
    } finally {
      await web.close()
      if (oldMode === undefined) delete process.env.WEFTMATE_TEST_MODE
      else process.env.WEFTMATE_TEST_MODE = oldMode
      if (oldOutput === undefined) delete process.env.WEFTMATE_TEST_ENV_OUTPUT
      else process.env.WEFTMATE_TEST_ENV_OUTPUT = oldOutput
    }
  })
})
