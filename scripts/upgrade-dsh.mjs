#!/usr/bin/env node
/**
 * Safe DSH upgrade entrypoint.
 *
 * The previous implementation fetched and checked out the ambient shared
 * Harness tree, then wrote the production pin before tests or vendor assembly
 * could fail. This entrypoint accepts only a named, independently pinned
 * candidate. Formal promotion remains a separate reviewed change.
 *
 * Usage: npm run dsh:upgrade -- --candidate alpha2
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const candidates = new Map([
  ['alpha2', 'scripts/build-dsh-alpha2-candidate.mjs'],
])

function fail(message) {
  console.error(`[dsh-upgrade] ${message}`)
  process.exit(1)
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) fail(`${name} 缺少值`)
  return value
}

const candidate = argValue('--candidate')
if (candidate === undefined) {
  fail('正式 pin/vendor 不可由此脚本直接覆盖。使用 --candidate alpha2 建立并验证隔离候选。')
}
const script = candidates.get(candidate)
if (script === undefined) fail(`未知隔离候选：${candidate}`)
if (process.argv.includes('--commit') || process.argv.includes('--version') || process.argv.includes('--skip-vendor')) {
  fail('候选身份由仓库内固定 tag/commit 配置决定；不接受会绕过该配置的 --commit、--version 或 --skip-vendor。')
}

const result = spawnSync(process.execPath, [script], { cwd: repoRoot, stdio: 'inherit', env: process.env })
if (result.status !== 0) fail(`隔离候选 ${candidate} 构建或验证失败（exit ${result.status}）`)
console.log(`[dsh-upgrade] 隔离候选 ${candidate} 已完成；正式 rc5 pin/vendor 未修改。`)
