#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCandidateVersion, assertIsolatedOutput } from './windows-package-policy.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

function option(name, required = true) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (required && (!value || value.startsWith('--'))) throw new Error(`${name} is required`)
  return value
}

function run(command, args, label, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: false,
    env: buildEnvironment(),
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = capture ? `\n${String(result.stderr || result.stdout).split('\n').slice(-20).join('\n')}` : ''
    throw new Error(`${label} failed with exit ${result.status}${detail}`)
  }
  return capture ? String(result.stdout) : ''
}

function buildEnvironment() {
  const clean = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/(?:API[_-]?KEY|AUTHORIZATION|BEARER|PASSWORD|SECRET|TOKEN|CSC_LINK|CSC_KEY_PASSWORD)/i.test(key)) continue
    clean[key] = value
  }
  clean.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  return clean
}

function digest(file, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(readFileSync(file)).digest(encoding)
}

const version = assertCandidateVersion(option('--version'))
const outputDir = assertIsolatedOutput(repoRoot, option('--output-dir'))
const stageRoot = assertIsolatedOutput(repoRoot, option('--stage-root', false) ?? join(dirname(outputDir), 'staging', version))
const emitFeed = process.argv.includes('--emit-feed')

if (existsSync(outputDir) && (await readdir(outputDir)).length > 0) {
  throw new Error(`candidate output already contains files; choose a new exact directory: ${outputDir}`)
}
await mkdir(outputDir, { recursive: true })
await mkdir(stageRoot, { recursive: true })

console.log(`[stage3-build] candidate ${version}`)
console.log('[stage3-build] verifying the existing vendor runtime; regeneration is intentionally disabled')
run(process.execPath, ['scripts/verify-dsh-vendor.mjs'], 'vendor verification')
run(process.execPath, ['scripts/stage-dsh-runtime.mjs', '--stage-root', stageRoot], 'vendor staging')

const config = {
  ...pkg.build,
  extraMetadata: { version },
  extraResources: [{ from: stageRoot, to: '', filter: ['dsh-runtime/**/*'] }],
  directories: { ...(pkg.build?.directories ?? {}), output: outputDir },
  publish: null,
}
const configPath = join(stageRoot, `electron-builder.${version}.json`)
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

const builderCli = join(repoRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
if (!existsSync(builderCli)) throw new Error('electron-builder is not installed')
run(process.execPath, [builderCli, '--win', '--publish', 'never', '--config', configPath], 'electron-builder')

const installer = join(outputDir, `WeftMate-Setup-${version}.exe`)
const unpacked = join(outputDir, 'win-unpacked')
if (!existsSync(installer) || !existsSync(unpacked)) throw new Error('electron-builder did not produce the expected installer and unpacked tree')

const verificationText = run(process.execPath, [
  'scripts/verify-windows-package.mjs', '--unpacked', unpacked, '--installer', installer,
], 'Windows package verification', { capture: true })
const verification = JSON.parse(verificationText)

let feed = null
if (emitFeed) {
  const feedDir = join(outputDir, 'feed')
  await mkdir(feedDir, { recursive: true })
  const feedInstaller = join(feedDir, basename(installer))
  await import('node:fs/promises').then(({ copyFile }) => copyFile(installer, feedInstaller))
  const sha512 = digest(installer, 'sha512', 'base64')
  const size = (await import('node:fs/promises').then(({ stat }) => stat(installer))).size
  const latest = [
    `version: ${version}`,
    'files:',
    `  - url: ${basename(installer)}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${basename(installer)}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n')
  writeFileSync(join(feedDir, 'latest.yml'), latest, 'utf8')
  feed = { directory: feedDir, latestYml: join(feedDir, 'latest.yml'), signed: false, public: false }
}

const gitHead = run('git', ['rev-parse', 'HEAD'], 'git rev-parse', { capture: true }).trim()
const gitStatus = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], 'git status', { capture: true })
const manifest = {
  schemaVersion: 1,
  buildId: `weftmate-windows-${version}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  version,
  platform: 'win32-x64',
  source: { gitHead, dirty: gitStatus.trim().length > 0 },
  signing: { authenticode: false, releaseBlocker: true },
  publish: { uploaded: false, publicFeed: false },
  installer: verification.installer,
  vendor: verification.vendor,
  closureAudit: verification.boundaries,
  feed,
}
const manifestPath = join(outputDir, `WeftMate-${version}-candidate.json`)
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(JSON.stringify({ ...manifest, manifestPath, installerPath: installer }, null, 2))
