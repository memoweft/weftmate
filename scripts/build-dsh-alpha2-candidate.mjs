#!/usr/bin/env node
/** Build and verify only the alpha.2 candidate vendor; production pin/vendor stay untouched. */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const config = JSON.parse(readFileSync(join(repoRoot, 'runtime', 'dsh-candidates', 'dsh-v0.1.7-alpha.2.json'), 'utf8'))
const fromRepo = (value) => resolve(repoRoot, value)
const env = {
  ...process.env,
  WEFTMATE_DSH_PIN_FILE: config.pinPath,
  WEFTMATE_DSH_CHECKOUT: fromRepo(config.checkoutPath),
  WEFTMATE_DSH_RUNTIME_DIR: fromRepo(config.vendorRuntimePath),
  WEFTMATE_DSH_VENDOR_PROFILE: 'alpha2',
}

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, encoding: 'utf8', stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status})`)
}

function buildWeb() {
  const result = spawnSync('pnpm', ['run', 'build:web'], { cwd: fromRepo(config.checkoutPath), env, encoding: 'utf8', stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`candidate native web build failed (exit ${result.status})`)
}

try {
  buildWeb()
  run(['scripts/vendor-dsh.mjs'], 'candidate vendor build')
  run(['scripts/run-dsh-alpha2-candidate.mjs', '--smoke'], 'candidate vendor smoke')
  console.log(`[dsh-alpha2-vendor] verified ${config.packageVersion} at ${fromRepo(config.vendorRuntimePath)}`)
} catch (error) {
  console.error(`[dsh-alpha2-vendor] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
