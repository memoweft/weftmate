import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { readCheckoutHead } from './support/checkout.ts'

const SHA = '47f943859bef60e4160492346772ded9b24f765a'
let root = ''

after(async () => { if (root !== '') await rm(root, { recursive: true, force: true }) })

describe('checkout worktree .git pointer provenance', () => {
  test('resolves detached HEAD from a gitdir pointer', async () => {
    root = await mkdtemp(join(tmpdir(), 'weftmate-checkout-pointer-'))
    const checkout = join(root, 'checkout'); const gitdir = join(root, 'metadata', 'worktrees', 'probe')
    await mkdir(gitdir, { recursive: true }); await mkdir(checkout, { recursive: true })
    await writeFile(join(checkout, '.git'), `gitdir: ${gitdir}\n`, 'utf8')
    await writeFile(join(gitdir, 'HEAD'), `${SHA}\n`, 'utf8')
    assert.equal(await readCheckoutHead(checkout), SHA)
  })

  test('resolves symbolic HEAD through relative commondir loose and packed refs', async () => {
    root = await mkdtemp(join(tmpdir(), 'weftmate-checkout-pointer-'))
    const checkout = join(root, 'checkout'); const gitdir = join(root, 'meta', 'worktrees', 'probe'); const common = join(root, 'meta')
    await mkdir(join(common, 'refs', 'heads'), { recursive: true }); await mkdir(checkout, { recursive: true }); await mkdir(gitdir, { recursive: true })
    await writeFile(join(checkout, '.git'), `gitdir: ${gitdir}\n`, 'utf8')
    await writeFile(join(gitdir, 'commondir'), '../..\n', 'utf8')
    await writeFile(join(gitdir, 'HEAD'), 'ref: refs/heads/topic\n', 'utf8')
    await writeFile(join(common, 'refs', 'heads', 'topic'), `${SHA}\n`, 'utf8')
    assert.equal(await readCheckoutHead(checkout), SHA)
    await rm(join(common, 'refs', 'heads', 'topic'))
    await writeFile(join(common, 'packed-refs'), `# pack-refs\n${SHA} refs/heads/topic\n`, 'utf8')
    assert.equal(await readCheckoutHead(checkout), SHA)
  })
})
