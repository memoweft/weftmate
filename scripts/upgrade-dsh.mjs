#!/usr/bin/env node
/**
 * upgrade-dsh.mjs — DSH 升级流程（只由 owner 触发，docs/REQUIREMENTS.md G-03 / docs/VENDOR-PACKAGING.md §8）。
 *
 * 用法：node scripts/upgrade-dsh.mjs --commit <sha> [--version <ver>] [--skip-vendor]
 *
 * 步骤：
 *   1. checkout 先切到目标 commit（git fetch + checkout，不校验旧 pin——pin 即将更新）；
 *   2. 更新 tests/contract/dsh-pin.json（commit / packageVersion / commitSubject / recordedAt）；
 *   3. 跑契约测试（必须全绿，失败即中止——契约先行的纪律）；
 *   4. 重建 vendor 并验证（vendor:dsh + vendor:verify；--skip-vendor 跳过，仅用于分步执行）。
 */

import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const PIN_PATH = join(repoRoot, 'tests', 'contract', 'dsh-pin.json')

function fail(message) {
  console.error(`[dsh-upgrade] 失败：${message}`)
  process.exit(1)
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) fail(`${name} 缺少值`)
  return value
}

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    const tail = (result.stderr ?? result.stdout ?? '').split('\n').slice(-15).join('\n')
    fail(`${label}（exit ${result.status}）：\n${tail}`)
  }
  return result.stdout.trim()
}

function checkoutCandidates() {
  const fromEnv = process.env.WEFTMATE_DSH_CHECKOUT
  const list = [
    fromEnv === undefined || fromEnv === '' ? undefined : fromEnv,
    'D:/AIProjects/Shared/Dependencies/DeepSeekHarness',
  ]
  return list.filter((candidate) => candidate !== undefined)
}

async function main() {
  const commit = argValue('--commit')
  if (commit === undefined) fail('缺少 --commit <sha>')
  if (!/^[0-9a-f]{7,40}$/.test(commit)) fail(`--commit 不是合法 sha：${commit}`)

  const pin = JSON.parse(await readFile(PIN_PATH, 'utf8'))
  const checkout = checkoutCandidates().find((candidate) => {
    try {
      return JSON.parse(require('node:fs').readFileSync(join(candidate, 'package.json'), 'utf8')).name !== undefined
    } catch {
      return false
    }
  })
  if (checkout === undefined) fail('找不到 DSH checkout（WEFTMATE_DSH_CHECKOUT 或 D:/AIProjects/Shared/Dependencies/DeepSeekHarness）')

  console.log(`[dsh-upgrade] 当前 pin：${pin.packageVersion} @ ${pin.commit.slice(0, 7)}`)
  console.log(`[dsh-upgrade] checkout：${checkout} → ${commit}`)

  console.log('[dsh-upgrade] git fetch + checkout（owner 已确认的升级动作）')
  run('git', ['-C', checkout, 'fetch', 'origin', 'master'], checkout, 'git fetch')
  run('git', ['-C', checkout, 'checkout', commit], checkout, 'git checkout')

  const head = run('git', ['-C', checkout, 'rev-parse', 'HEAD'], checkout, 'git rev-parse')
  if (head !== commit && !head.startsWith(commit)) fail(`checkout 后 HEAD=${head} 与目标 ${commit} 不符`)

  const rootPkg = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'))
  const version = argValue('--version') ?? rootPkg.version ?? pin.packageVersion
  console.log(`[dsh-upgrade] 目标版本：${version}（checkout 根 package.json=${rootPkg.version ?? '?'}）`)

  pin.commit = head
  pin.packageVersion = version
  pin.commitSubject = run('git', ['-C', checkout, 'log', '-1', '--format=%s'], checkout, 'git log')
  pin.recordedAt = new Date().toISOString().slice(0, 10)
  await writeFile(PIN_PATH, JSON.stringify(pin, null, 2) + '\n', 'utf8')
  console.log('[dsh-upgrade] pin 已更新')

  console.log('[dsh-upgrade] 契约测试（失败即中止，先修适配再继续）')
  const contract = spawnSync(process.execPath, ['--test', 'tests/contract/**/*.test.ts'], {
    cwd: repoRoot, encoding: 'utf8', stdio: 'inherit', shell: false,
  })
  if (contract.status !== 0) fail('契约测试未全绿——升级中止，请先修 weftmate 适配（或回退 checkout 与 pin）')

  if (process.argv.includes('--skip-vendor')) {
    console.log('[dsh-upgrade] --skip-vendor：vendor 重建留待下一步手动执行（npm run vendor:dsh && npm run vendor:verify）')
    return
  }

  console.log('[dsh-upgrade] vendor 重建 + 验证')
  const vendor = spawnSync(process.execPath, ['scripts/vendor-dsh.mjs'], { cwd: repoRoot, encoding: 'utf8', stdio: 'inherit' })
  if (vendor.status !== 0) fail('vendor:dsh 失败')
  const verify = spawnSync(process.execPath, ['scripts/verify-dsh-vendor.mjs'], { cwd: repoRoot, encoding: 'utf8', stdio: 'inherit' })
  if (verify.status !== 0) fail('vendor:verify 失败')

  console.log(`[dsh-upgrade] 完成：${version} @ ${head.slice(0, 7)}（契约全绿 + vendor 重建验证通过）`)
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack : String(error))
})
