#!/usr/bin/env node
/**
 * Copy the already verified vendor runtime below a wrapper directory so
 * electron-builder does not discard its root node_modules directory.
 *
 * This script never regenerates vendor/dsh-runtime. Stage 3 builds pass an
 * explicit, isolated --stage-root; the legacy default remains .stage so the
 * existing dist scripts keep working.
 */
import { cp, lstat, mkdir, readdir, realpath, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, copyFile } from 'node:fs/promises'
import { rootCertificates } from 'node:tls'
import { downloadFrp } from './download-frp.mjs'
import { stageRuntimeEntry } from './windows-package-policy.mjs'
import { assertRuntimeIdentity } from './dsh-runtime-identity.mjs'
import { assertRuntimeDestination, assertUnlinkedPath, createRuntimeScratch, retainRuntimeDestination } from './dsh-runtime-storage.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
// Worktrees may share the verified vendor root through a junction. Nested links remain forbidden.

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`)
  return value
}

async function assertNoReparsePoints(root) {
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    // POSIX pnpm shims are symlinks, but installation metadata is excluded
    // from the stage on every platform. Validate the runtime entries we copy.
    if (!stageRuntimeEntry(relative(root, current).split(sep).join('/'))) continue
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) throw new Error(`reparse point is not allowed in the staged vendor source: ${relative(root, current) || '.'}`)
    if (!stat.isDirectory()) continue
    for (const entry of await readdir(current)) pending.push(join(current, entry))
  }
}

export async function stageDshRuntime({ projectRoot = repoRoot, runtimePath = join(projectRoot, 'vendor/dsh-runtime'), stageRoot = join(projectRoot, '.stage'), copy = cp } = {}) {
  const runtime = await realpath(runtimePath)
  stageRoot = resolve(stageRoot)
  const stage = join(stageRoot, 'dsh-runtime')
  if (stageRoot === projectRoot) throw Error(`unsafe stage root: ${stageRoot}`)
  if (!existsSync(join(runtime, 'VENDOR-MANIFEST.json'))) throw Error('missing vendor/dsh-runtime; Stage 3 does not regenerate vendor automatically')
  await assertRuntimeDestination(stage, dirname(runtime))
  await assertRuntimeIdentity(runtime, projectRoot)
  await assertNoReparsePoints(runtime)
  const scratch = await createRuntimeScratch(stageRoot)
  try {
    await copy(runtime, scratch.runtime, {
      recursive: true,
      dereference: false,
      filter: source => stageRuntimeEntry(relative(runtime, source).split(sep).join('/')),
    })
    await scratch.assertOwned(scratch.runtime)
    await assertRuntimeDestination(stage, dirname(runtime))
    await retainRuntimeDestination(stage)
    await rename(scratch.runtime, stage)
  } finally { await scratch.dispose() }
  console.log(`[stage-dsh-runtime] staged verified vendor runtime -> ${stage}`)
}

async function main() {
  const stageRoot = resolve(option('--stage-root', join(repoRoot, '.stage')))
  await stageDshRuntime({ stageRoot })
  if (process.platform === 'win32') {
    const frp = await downloadFrp({ destination: join(repoRoot, '.local', 'frp') })
    const relay = join(stageRoot, 'relay')
    await assertUnlinkedPath(relay)
    await mkdir(relay, { recursive: true })
    await copyFile(join(frp, 'frpc.exe'), join(relay, 'frpc.exe'))
    await writeFile(join(relay, 'transport-ca.pem'), rootCertificates.join('\n') + '\n')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
