import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { checkPatch, checkReferences, compareClosure, compareToolchain, inspectClosure, withTarget } from '../scripts/dsh-upgrade-probe.mjs'
import { loadWorkspaceIndex } from '../scripts/dsh-vendor-closure.mjs'

test('read-only upgrade probe with a local git fixture', async (t) => {
  const repo = await mkdtemp(join(tmpdir(), 'dsh-probe-test-'))
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.error?.message ?? result.stderr)
    return result.stdout
  }
  const put = async (path: string, text: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true })
    await writeFile(join(repo, path), text)
  }
  try {
    await put('package.json', JSON.stringify({ version: '2', engines: { node: '>=24' }, packageManager: 'pnpm@11', workspaces: ['apps/*'], scripts: { build: 'build' } }))
    await put('apps/root/package.json', JSON.stringify({ name: '@deepseek-ai/root', dependencies: { '@deepseek-ai/new': '*', '@deepseek-ai/missing': '*' } }))
    await put('packages/client/new/package.json', JSON.stringify({ name: '@deepseek-ai/new' }))
    await put('file.txt', 'before\n')
    git('init'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture')
    const head = git('rev-parse', 'HEAD').trim(), status = git('status', '--porcelain')
    await t.test('patch clean / conflict / missing-target, including CRLF and additions', async () => {
      const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n'
      assert.equal((await checkPatch(repo, patch.replaceAll('\n', '\r\n'))).status, 'clean')
      assert.equal((await checkPatch(repo, patch.replace('-before', '-wrong'))).status, 'conflict')
      assert.equal((await checkPatch(repo, patch.replaceAll('file.txt', 'absent.txt'))).status, 'missing-target')
      assert.equal((await checkPatch(repo, 'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n')).status, 'clean')
      assert.equal(await readFile(join(repo, 'file.txt'), 'utf8'), 'before\n')
      assert.equal(existsSync(join(repo, 'new.txt')), false)
    })
    await t.test('workspace dependencies, source selectors, and reachable closure differences', async () => {
      const index = await loadWorkspaceIndex(repo)
      const refs = checkReferences("'@deepseek-ai/root/sub' `@deepseek-ai/gone` '@deepseek-ai/libreoffice-kit'", '.-w4i8q_frame .oC7kBG_removed [data-layout] [data-gone] [data-weftmate-own]', '.frame {} data-layout', index)
      assert.deepEqual(refs.missingPackages, ['@deepseek-ai/gone'])
      assert.deepEqual(refs.missingClasses, ['removed'])
      assert.deepEqual(refs.missingAttributes, ['data-gone'])
      const selectors = checkReferences('', 'window.__ModuleLoader__ .__DSH_BOOT__ .hash_identifier__ .-w4i8q_frame .oC7kBG_root ._0_p9YG_header', '', index)
      assert.deepEqual(selectors.missingClasses, ['frame', 'header', 'root'])
      const closure = inspectClosure(index, ['@deepseek-ai/root', '@deepseek-ai/absent-root'])
      assert.deepEqual(closure.missing, ['@deepseek-ai/absent-root', '@deepseek-ai/missing'])
      assert.ok(closure.error)
      assert.deepEqual(compareClosure(['@deepseek-ai/root', '@deepseek-ai/old'], closure.names), { added: ['@deepseek-ai/new'], removed: ['@deepseek-ai/old'] })
      const comparison = compareToolchain(JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')), head, { packageVersion: '1', commit: head })
      assert.equal(comparison.version.status, 'changed'); assert.equal(comparison.commit.status, 'same'); assert.equal(comparison.node.status, 'unrecorded')
    })
    await t.test('remote ref resolves in the source repository before cloning', async () => {
      const remote = git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit-tree', 'HEAD^{tree}', '-p', head, '-m', 'remote next').trim()
      git('update-ref', 'refs/heads/next', head)
      git('update-ref', 'refs/remotes/origin/next', remote)
      await withTarget(repo, 'origin/next', async (dir: string) => {
        assert.equal(git('-C', dir, 'rev-parse', 'HEAD').trim(), remote)
        assert.notEqual(remote, head)
      })
    })
    await t.test('--target CLI and cleanup on success and failure', async () => {
      const before = await readdir(tmpdir())
      const result = spawnSync(process.execPath, ['scripts/dsh-upgrade-probe.mjs', '--target', head, '--repo', repo, '--baseline-checkout', repo, '--json'], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(JSON.parse(result.stdout).toolchain.commit.target, head)
      let temporary = ''
      await assert.rejects(withTarget(repo, head, async (dir: string) => { temporary = dir; throw new Error('inspection failed') }), /inspection failed/)
      assert.equal(existsSync(temporary), false)
      await assert.rejects(withTarget(repo, 'nonexistent-ref', async () => null))
      assert.deepEqual((await readdir(tmpdir())).filter((name) => name.startsWith('weftmate-dsh-probe-') && !before.includes(name)), [])
      assert.equal(git('rev-parse', 'HEAD').trim(), head)
      assert.equal(git('status', '--porcelain'), status)
    })
  } finally { await rm(repo, { recursive: true, force: true }) }
})
