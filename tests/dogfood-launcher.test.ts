import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const launcher = resolve(repoRoot, 'dogfood', 'run.mjs')
const launcherSource = readFileSync(launcher, 'utf8')

function dryRun(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(process.execPath, [launcher, '--dry-run', ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  })
  const match = /\[dogfood\] CONFIG (.*)/.exec(result.stdout)
  return { ...result, config: match === null ? null : JSON.parse(match[1]) }
}

describe('阶段 0 dogfood 启动器', () => {
  it('默认使用产品自有 vendor，并拒绝个人/shared checkout', () => {
    const defaulted = dryRun([])
    assert.equal(defaulted.status, 0, defaulted.stderr)
    assert.equal(defaulted.config.mode, 'vendor')
    assert.equal(defaulted.config.runtimeEnv.WEFTMATE_DSH_RUNTIME, resolve(repoRoot, 'vendor/dsh-runtime'))
    assert.equal(defaulted.config.runtimeEnv.WEFTMATE_DSH_CHECKOUT, null)
    assert.equal(defaulted.config.port, 'dynamic-loopback')

    const checkout = spawnSync(process.execPath, [launcher, '--dry-run', '--dsh', 'checkout'], { cwd: repoRoot, encoding: 'utf8' })
    assert.equal(checkout.status, 2)
    assert.match(checkout.stderr, /只允许使用产品自有 vendor DSH/)
    assert.doesNotMatch(launcherSource, /Shared[\\\\/]Dependencies[\\\\/]DeepSeekHarness/)
  })

  it('vendor 清掉 ambient checkout，并把用户数据保持在阶段 1 dogfood 隔离目录', () => {
    const result = dryRun(['--dsh=vendor'], {
      ...process.env,
      WEFTMATE_DSH_CHECKOUT: 'Z:\\ambient-checkout',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.config.mode, 'vendor')
    assert.equal(result.config.runtimeEnv.WEFTMATE_DSH_CHECKOUT, null)
    assert.equal(result.config.runtimeEnv.WEFTMATE_DSH_RUNTIME, resolve(repoRoot, 'vendor/dsh-runtime'))
    assert.equal(result.config.userData, resolve(repoRoot, 'dogfood/data/stage-1'))
    assert.equal(result.config.port, 'dynamic-loopback')
    assert.equal(result.config.memoweft, 'disabled')
    assert.equal(result.config.aiGame, 'not-configured')
  })

  it('Windows 支持 q 经 IPC 走应用内退出，且 Electron 不直接读取终端', () => {
    assert.match(launcherSource, /stdio: \['ignore', 'inherit', 'inherit', 'ipc'\]/)
    assert.match(launcherSource, /command === 'q' \|\| command === 'quit'/)
    assert.match(launcherSource, /child\.send\(\{ type: 'weftmate:quit'/)
  })
})
