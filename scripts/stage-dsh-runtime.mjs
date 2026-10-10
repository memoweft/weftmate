#!/usr/bin/env node
/**
 * Copy the already verified vendor runtime below a wrapper directory so
 * electron-builder does not discard its root node_modules directory.
 *
 * This script never regenerates vendor/dsh-runtime. Stage 3 builds pass an
 * explicit, isolated --stage-root; the legacy default remains .stage so the
 * existing dist scripts keep working.
 */
import { cp, lstat, mkdir, readdir, rm, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, copyFile } from 'node:fs/promises'
import { rootCertificates } from 'node:tls'
import { downloadFrp } from './download-frp.mjs'
import { stageRuntimeEntry } from './windows-package-policy.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
// Worktrees may share the verified vendor root through a junction. Nested links remain forbidden.
const runtime = await realpath(join(repoRoot, 'vendor', 'dsh-runtime'))

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`)
  return value
}

function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function assertNoReparsePoints(root) {
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) throw new Error(`reparse point is not allowed in the staged vendor source: ${relative(root, current) || '.'}`)
    if (!stat.isDirectory()) continue
    for (const entry of await readdir(current)) pending.push(join(current, entry))
  }
}

const requestedRoot = option('--stage-root', join(repoRoot, '.stage'))
const stageRoot = resolve(requestedRoot)
const stage = join(stageRoot, 'dsh-runtime')

if (!existsSync(join(runtime, 'VENDOR-MANIFEST.json'))) {
  console.error('[stage-dsh-runtime] missing vendor/dsh-runtime; Stage 3 does not regenerate vendor automatically')
  process.exit(1)
}
if (stageRoot === repoRoot || !isInside(dirname(stageRoot), stageRoot) || !isInside(stageRoot, stage)) {
  console.error(`[stage-dsh-runtime] unsafe stage root: ${stageRoot}`)
  process.exit(1)
}

await assertNoReparsePoints(runtime)
await mkdir(stageRoot, { recursive: true })
// Delete only the exact runtime child below the already validated stage root.
await rm(stage, { recursive: true, force: true })
await cp(runtime, stage, {
  recursive: true,
  dereference: false,
  filter: (source) => {
    const rel = relative(runtime, source).split(sep).join('/')
    return stageRuntimeEntry(rel)
  },
})
console.log(`[stage-dsh-runtime] staged verified vendor runtime -> ${stage}`)
if (process.platform === 'win32') {
  const frp = await downloadFrp({ destination: join(repoRoot, '.local', 'frp') })
  const relay = join(stageRoot, 'relay'); await mkdir(relay, { recursive: true })
  await copyFile(join(frp, 'frpc.exe'), join(relay, 'frpc.exe'))
  await writeFile(join(relay, 'transport-ca.pem'), rootCertificates.join('\n') + '\n')
}
