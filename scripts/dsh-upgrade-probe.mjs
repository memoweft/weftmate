#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadWorkspaceIndex, computeClosure, internalDependencies } from './dsh-vendor-closure.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const unique = (values) => [...new Set(values)].sort()
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
function git(cwd, args, input) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', input, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim())
  return result.stdout.trim()
}

export async function withTarget(repo, ref, inspect) {
  const commit = git(repo, ['rev-parse', '--verify', `${ref}^{commit}`])
  const scratch = await mkdtemp(join(tmpdir(), 'weftmate-dsh-probe-'))
  try {
    const checkout = join(scratch, 'checkout')
    git(scratch, ['clone', '--shared', '--no-checkout', '--', resolve(repo), checkout])
    git(checkout, ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', commit, '--'])
    return await inspect(checkout)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function sourceText(directory) {
  if (!existsSync(directory)) return ''
  const parts = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'lib', 'dsh-upgrade-probe.mjs'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) parts.push(await sourceText(path))
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|css|scss|html|json)$/.test(entry.name)) parts.push(await readFile(path, 'utf8'))
  }
  return parts.join('\n')
}

export function checkReferences(source, frontend, upstream, names) {
  const packages = unique([...source.matchAll(/["'`](@deepseek-ai\/[\w-]+)(?=[/"'`])/g)].map((m) => m[1]))
    .filter((name) => name !== '@deepseek-ai/libreoffice-kit')
  const classes = unique([...frontend.matchAll(/\.([-\w]+)_([a-zA-Z][\w-]*)/g)]
    .filter((m) => !m[0].startsWith('.__') && !m[0].endsWith('__')).map((m) => m[2]))
  const attributes = unique([...frontend.matchAll(/\[(data-[\w-]+)/g)].map((m) => m[1]))
    .filter((name) => !name.startsWith('data-weftmate-'))
  const tokens = new Set(upstream.match(/[\w-]+/g) ?? [])
  return { packages, missingPackages: packages.filter((name) => !names.has(name)), classes, attributes,
    missingClasses: classes.filter((name) => !tokens.has(name)), missingAttributes: attributes.filter((name) => !tokens.has(name)) }
}

export function inspectClosure(index, roots) {
  const reachable = new Set(), missing = new Set(), queue = [...roots]
  while (queue.length) {
    const name = queue.shift()
    if (reachable.has(name) || missing.has(name)) continue
    const entry = index.get(name)
    if (!entry) { missing.add(name); continue }
    reachable.add(name)
    queue.push(...internalDependencies(entry.pkg).map((dependency) => dependency.name))
  }
  let error = null
  try { computeClosure(index, roots) } catch (cause) { error = cause.message }
  return { names: unique(reachable), missing: unique(missing), error }
}
export function compareClosure(baseline, target) {
  return { added: unique(target.filter((name) => !baseline.includes(name))), removed: unique(baseline.filter((name) => !target.includes(name))) }
}
export function compareToolchain(pkg, head, pin) {
  const target = { version: pkg.version, node: pkg.engines?.node, packageManager: pkg.packageManager,
    workspaces: pkg.workspaces, build: pkg.scripts?.build, commit: head }
  const baseline = { version: pin.packageVersion, node: pin.engines?.node, packageManager: pin.packageManager,
    workspaces: pin.workspaces, build: pin.scripts?.build, commit: pin.commit }
  return Object.fromEntries(Object.entries(target).map(([key, value]) => [key, { baseline: baseline[key] ?? null,
    target: value ?? null, status: baseline[key] === undefined ? 'unrecorded' : JSON.stringify(value) === JSON.stringify(baseline[key]) ? 'same' : 'changed' }]))
}

export async function checkPatch(checkout, content) {
  const patch = content.replace(/\r\n/g, '\n')
  // Old paths are required; /dev/null denotes a newly added file.
  const paths = [...patch.matchAll(/^--- (.+)$/gm)].map((m) => m[1].split('\t')[0])
    .map((path) => path.startsWith('"') ? JSON.parse(path) : path).filter((path) => path !== '/dev/null').map((path) => path.replace(/^a\//, ''))
  const missing = paths.filter((path) => !existsSync(join(checkout, path)))
  if (missing.length) return { status: 'missing-target', missing }
  try { git(checkout, ['apply', '--check', '-'], patch); return { status: 'clean' } }
  catch (error) { return { status: 'conflict', error: error.message } }
}

export async function probe(checkout, options = {}) {
  const project = options.projectRoot ?? root
  const pin = await json(join(project, 'tests/contract/dsh-pin.json'))
  const vendorScript = await readFile(join(project, 'scripts/vendor-dsh.mjs'), 'utf8')
  const subset = vendorScript.match(/const LEGACY_SUBSET = \[([\s\S]*?)\n\]/)?.[1]
  if (!subset) throw new Error('Cannot read LEGACY_SUBSET')
  const roots = unique([...subset.matchAll(/\{ name: '([^']+)'/g)].map((m) => m[1]))
  const index = await loadWorkspaceIndex(checkout)
  const closure = inspectClosure(index, roots)
  const manifest = options['baseline-manifest'] ?? join(project, 'vendor/dsh-runtime/VENDOR-MANIFEST.json')
  let baseline, baselineSource, baselineError = null
  if (options['baseline-manifest'] || existsSync(manifest)) {
    baseline = { names: (await json(manifest)).closure.map((entry) => entry.name) }
    baselineSource = 'manifest'
  } else if (options['baseline-checkout']) {
    baseline = inspectClosure(await loadWorkspaceIndex(options['baseline-checkout']), roots)
    baselineSource = 'checkout'
  } else {
    try {
      baseline = await withTarget(options.repo ?? checkout, pin.commit, async (dir) => inspectClosure(await loadWorkspaceIndex(dir), roots))
      baselineSource = 'pin.commit'
    } catch (error) { baselineError = error.message; baseline = { names: roots }; baselineSource = 'LEGACY_SUBSET' }
  }
  const patches = []
  const patchDir = join(project, 'patches/dsh')
  for (const name of (await readdir(patchDir)).filter((name) => name.endsWith('.patch')).sort()) {
    patches.push({ name, ...await checkPatch(checkout, await readFile(join(patchDir, name), 'utf8')) })
  }
  const references = checkReferences(await sourceText(join(project, 'src')) + '\n' + await sourceText(join(project, 'scripts')),
    await sourceText(join(project, 'src/plugins/weftmate-client')),
    await sourceText(join(checkout, 'packages/client')) + '\n' + await sourceText(join(checkout, 'apps')), index)
  return { toolchain: compareToolchain(await json(join(checkout, 'package.json')), git(checkout, ['rev-parse', 'HEAD']), pin),
    patches, references, closure: { ...closure, baselineSource, baselineError, baseline, ...compareClosure(baseline.names, closure.names) } }
}

async function main() {
  const { values } = parseArgs({ options: Object.fromEntries(['checkout', 'target', 'repo', 'baseline-manifest', 'baseline-checkout', 'json']
    .map((key) => [key, { type: key === 'json' ? 'boolean' : 'string' }])) })
  if (Boolean(values.checkout) === Boolean(values.target)) throw new Error('Specify exactly one of --checkout <dir> or --target <ref>')
  const repo = values.repo ?? process.env.WEFTMATE_DSH_CHECKOUT
  if (values.target && !repo) throw new Error('--target requires --repo or WEFTMATE_DSH_CHECKOUT')
  const options = { ...values, repo }
  const report = values.target ? await withTarget(repo, values.target, (dir) => probe(dir, options)) : await probe(resolve(values.checkout), options)
  if (values.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log('DSH upgrade probe (read-only)')
    for (const [section, details] of Object.entries(report)) console.log(`\n${section}:\n${JSON.stringify(details, null, 2)}`)
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
