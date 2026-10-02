import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { ALPHA2_NATIVE_FRONTEND_FILES, alpha2LocalPatch } from '../scripts/vendor-dsh.mjs'

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (result.status !== 0 && !(args.includes('--no-index') && result.status === 1)) {
    throw new Error(result.stderr || `git failed: ${args.join(' ')}`)
  }
  return result.stdout
}

test('alpha2 localPatch covers tracked and untracked native frontend files', async () => {
  const checkout = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-patch-'))
  const previous = process.env.WEFTMATE_DSH_VENDOR_PROFILE
  try {
    git(checkout, ['init', '-q'])
    git(checkout, ['config', 'user.email', 'test@example.invalid'])
    git(checkout, ['config', 'user.name', 'WeftMate Test'])
    for (const file of ALPHA2_NATIVE_FRONTEND_FILES.filter((entry) => !entry.endsWith('.css'))) {
      const path = join(checkout, file)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, 'official base\n', 'utf8')
    }
    git(checkout, ['add', '.'])
    git(checkout, ['commit', '-qm', 'official base'])
    for (const file of ALPHA2_NATIVE_FRONTEND_FILES.filter((entry) => !entry.endsWith('.css'))) {
      await writeFile(join(checkout, file), 'WeftMate alpha2 patch\n', 'utf8')
    }
    for (const file of ALPHA2_NATIVE_FRONTEND_FILES.filter((entry) => entry.endsWith('.css'))) {
      const path = join(checkout, file)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, `/* ${file} */\n.weftmate-v2-shell { color: red; }\n`, 'utf8')
    }
    process.env.WEFTMATE_DSH_VENDOR_PROFILE = 'alpha2'
    const patch = alpha2LocalPatch(checkout, { commit: 'official-base-commit' })
    assert.deepEqual(patch?.files, [...ALPHA2_NATIVE_FRONTEND_FILES].sort())
    assert.equal(patch?.officialBaseCommit, 'official-base-commit')
    const css = git(checkout, ['diff', '--no-index', '--binary', '--', '/dev/null', ALPHA2_NATIVE_FRONTEND_FILES.find((entry) => entry.endsWith('skeleton-v2.scoped.css'))!])
    assert.match(css, /skeleton-v2\.scoped\.css/)
    assert.ok(patch?.sha256)
    const digestInput = [...ALPHA2_NATIVE_FRONTEND_FILES].sort().map((file) => {
      if (!file.endsWith('.css')) return git(checkout, ['diff', 'HEAD', '--binary', '--', file])
      return git(checkout, ['diff', '--no-index', '--binary', '--', '/dev/null', file])
    }).join('')
    assert.equal(patch?.sha256, createHash('sha256').update(digestInput).digest('hex'))
  } finally {
    if (previous === undefined) delete process.env.WEFTMATE_DSH_VENDOR_PROFILE
    else process.env.WEFTMATE_DSH_VENDOR_PROFILE = previous
    await rm(checkout, { recursive: true, force: true })
  }
})

test('alpha2 localPatch rejects a changed file outside the declared manifest', async () => {
  const checkout = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-patch-extra-'))
  const previous = process.env.WEFTMATE_DSH_VENDOR_PROFILE
  try {
    git(checkout, ['init', '-q'])
    git(checkout, ['config', 'user.email', 'test@example.invalid'])
    git(checkout, ['config', 'user.name', 'WeftMate Test'])
    for (const file of ALPHA2_NATIVE_FRONTEND_FILES.filter((entry) => !entry.endsWith('.css'))) {
      const path = join(checkout, file)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, 'official base\n', 'utf8')
    }
    git(checkout, ['add', '.'])
    git(checkout, ['commit', '-qm', 'official base'])
    for (const file of ALPHA2_NATIVE_FRONTEND_FILES.filter((entry) => !entry.endsWith('.css'))) {
      await writeFile(join(checkout, file), 'WeftMate alpha2 patch\n', 'utf8')
    }
    for (const file of ALPHA2_NATIVE_FRONTEND_FILES.filter((entry) => entry.endsWith('.css'))) {
      const path = join(checkout, file)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, 'css\n', 'utf8')
    }
    await writeFile(join(checkout, 'packages', 'unexpected.ts'), 'must fail closed\n', 'utf8')
    process.env.WEFTMATE_DSH_VENDOR_PROFILE = 'alpha2'
    assert.throws(() => alpha2LocalPatch(checkout, { commit: 'official-base-commit' }), /exactly the declared native frontend patch files/)
  } finally {
    if (previous === undefined) delete process.env.WEFTMATE_DSH_VENDOR_PROFILE
    else process.env.WEFTMATE_DSH_VENDOR_PROFILE = previous
    await rm(checkout, { recursive: true, force: true })
  }
})
