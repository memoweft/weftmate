import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runVendorTests, pinnedBuild } from '../scripts/nightly/vendor-tests.mjs'
import { execFileSync } from 'node:child_process'
import { inspect, report } from '../scripts/nightly/report.mjs'
import { runtimeIdentity, assertRuntimeIdentity } from '../scripts/dsh-runtime-identity.mjs'
import { preparePatchedCheckout } from '../scripts/vendor-dsh.mjs'

test('nightly vendor step records passes and failures and makes failed assertions red in the actual report', async () => {
  const out = await mkdtemp(join(tmpdir(), 'weftmate-nightly-vendor-'))
  try {
    const worktree = join(out, 'synthetic-worktree')
    const bin = join(worktree, 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh/lib')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'bin.js'), '// synthetic prebuilt vendor marker')
    await mkdir(join(worktree, 'tests/contract'), { recursive: true })
    const pin = { commit: 'synthetic-commit', packageVersion: 'synthetic-version' }
    await writeFile(join(worktree, 'tests/contract/dsh-pin.json'), JSON.stringify(pin))
    await writeFile(join(worktree, 'vendor/dsh-runtime/VENDOR-MANIFEST.json'), JSON.stringify({ dsh: pin, runtimeIdentity: await runtimeIdentity(worktree) }))
    for (const failed of [0, 2]) {
      const summary = { passed: 110 - failed, failed, skipped: 0, exitCode: failed ? 1 : 0,
        failures: failed ? ['synthetic approval failure', 'synthetic restart failure'] : [] }
      const phase = { name: 'vendor-tests', ...await runVendorTests(async (_command: string, args: string[], options: any) => {
        assert.equal(options.allowFailure, true)
        assert.equal(args[1], 'vendor')
        await writeFile(args[args.indexOf('--report') + 1], JSON.stringify(summary))
        return { code: summary.exitCode }
      }, worktree, out) }
      assert.equal(phase.status, failed ? 'failed' : 'passed')
      assert.deepEqual(phase.tests, summary)
      assert.equal((await inspect([], { phases: [phase] })).alerts.length, failed ? 1 : 0)
      await report(out, { phases: [phase], commit: 'synthetic', startedAt: new Date().toISOString(), cleanup: {} })
      const text = await readFile(join(out, 'nightly-report.md'), 'utf8')
      assert.ok(text.includes(failed ? '🔴 失败：108 通过 / 2 失败' : '🟢 通过：110 通过 / 0 失败'))
      for (const name of summary.failures) assert.ok(text.includes(`- 🔴 ${name}`))
    }
    await assert.rejects(runVendorTests(async () => ({ code: 1 }), worktree, join(out, 'missing')), /未生成测试结果/)
    const unavailable = await runVendorTests(async (_command: string, _args: string[], options: any) => {
      assert.equal(options.name, 'vendor-assemble')
      throw Error('synthetic missing pinned build')
    }, join(out, 'unbuilt'), out)
    assert.equal(unavailable.status,'environment'); assert.match(unavailable.reason,/missing pinned build/)
    assert.equal((await inspect([],{phases:[{name:'vendor-tests',...unavailable}]})).alerts.length,1)
  } finally { await rm(out, { recursive: true, force: true }) }
})

test('runtime identity covers sorted patch names and all bytes; legacy, changed pin and changed patch are stale', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-nightly-identity-'))
  try {
    const runtime = join(root, 'vendor/dsh-runtime')
    await mkdir(join(root, 'tests/contract'), { recursive: true })
    await mkdir(join(root, 'patches/dsh'), { recursive: true })
    await mkdir(join(runtime, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
    await writeFile(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '// complete')
    const pin = { commit: 'a'.repeat(40), packageVersion: '1' }
    await writeFile(join(root, 'tests/contract/dsh-pin.json'), JSON.stringify(pin))
    await writeFile(join(root, 'patches/dsh/b.patch'), 'second\n')
    await writeFile(join(root, 'patches/dsh/a.patch'), 'first\n')
    const identity = await runtimeIdentity(root)
    assert.deepEqual(identity.patches.map((item: any) => item.name), ['a.patch', 'b.patch'])
    await writeFile(join(root, 'patches/dsh/a.patch'), 'first\r\n')
    assert.deepEqual(await runtimeIdentity(root), identity, 'Windows CRLF checkout must share the LF cache identity')
    await writeFile(join(runtime, 'VENDOR-MANIFEST.json'), JSON.stringify({ dsh: pin }))
    await assert.rejects(assertRuntimeIdentity(runtime, root), /运行时过期.*无补丁身份/)
    await writeFile(join(runtime, 'VENDOR-MANIFEST.json'), JSON.stringify({ dsh: pin, runtimeIdentity: identity }))
    assert.deepEqual(await assertRuntimeIdentity(runtime, root), identity)
    await writeFile(join(root, 'patches/dsh/b.patch'), 'second changed\n')
    await assert.rejects(assertRuntimeIdentity(runtime, root), /运行时过期.*补丁内容不匹配/)
    await writeFile(join(root, 'patches/dsh/b.patch'), 'second\n')
    await writeFile(join(root, 'tests/contract/dsh-pin.json'), JSON.stringify({ ...pin, commit: 'b'.repeat(40) }))
    await assert.rejects(assertRuntimeIdentity(runtime, root), /运行时过期/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('nightly rebuilds a present but stale runtime before running vendor tests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-nightly-stale-'))
  try {
    const pin = { commit: 'c'.repeat(40), packageVersion: '1' }
    const runtime = join(root, 'vendor/dsh-runtime')
    await mkdir(join(root, 'tests/contract'), { recursive: true })
    await mkdir(join(runtime, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
    await writeFile(join(root, 'tests/contract/dsh-pin.json'), JSON.stringify(pin))
    await writeFile(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '// stale bin exists')
    await writeFile(join(runtime, 'VENDOR-MANIFEST.json'), JSON.stringify({ dsh: pin }))
    const calls: string[] = []
    const result = await runVendorTests(async (_command: string, args: string[], options: any) => {
      calls.push(options.name)
      if (options.name === 'vendor-assemble') {
        await writeFile(join(runtime, 'VENDOR-MANIFEST.json'), JSON.stringify({ dsh: pin, runtimeIdentity: await runtimeIdentity(root) }))
      } else {
        await writeFile(args[args.indexOf('--report') + 1], JSON.stringify({ passed: 1, failed: 0, skipped: 0, exitCode: 0, failures: [] }))
      }
      return { code: 0 }
    }, root, root)
    assert.deepEqual(calls, ['vendor-assemble', 'vendor-tests'])
    assert.equal(result.status, 'passed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('patch build uses an independent LF clone and does not modify source branch, files or config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-nightly-patched-clone-'))
  try {
    const source = join(root, 'source'), checkout = join(root, 'clone'), project = join(root, 'project')
    await mkdir(source); await mkdir(join(project, 'patches/dsh'), { recursive: true })
    const git = (...args: string[]) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    git('init'); git('config', 'core.autocrlf', 'true')
    await writeFile(join(source, 'fixture'), 'before\n')
    git('add', 'fixture'); git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.test', 'commit', '-m', 'fixture')
    const pin = { commit: git('rev-parse', 'HEAD') }
    await writeFile(join(project, 'patches/dsh/a.patch'), 'diff --git a/fixture b/fixture\r\n--- a/fixture\r\n+++ b/fixture\r\n@@ -1 +1 @@\r\n-before\r\n+after\r\n')
    await writeFile(join(source, 'fixture'), 'owner uncommitted\r\n')
    const before = { branch: git('branch', '--show-current'), status: git('status', '--porcelain'), config: git('config', 'core.autocrlf') }
    preparePatchedCheckout(project, source, checkout, pin, { patches: [{ name: 'a.patch' }] })
    assert.equal(await readFile(join(checkout, 'fixture'), 'utf8'), 'after\n')
    assert.equal(await readFile(join(source, 'fixture'), 'utf8'), 'owner uncommitted\r\n')
    assert.deepEqual({ branch: git('branch', '--show-current'), status: git('status', '--porcelain'), config: git('config', 'core.autocrlf') }, before)
    assert.equal(execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pin.commit)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('nightly finds a compiled pinned linked checkout without resetting the shared checkout', async () => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-nightly-pinned-'))
  try {
    const shared=join(root,'shared'), pinned=join(root,'pinned'), candidate=join(root,'candidate')
    await mkdir(shared); await mkdir(join(candidate,'tests/contract'),{recursive:true})
    const git=(...args:string[])=>execFileSync('git',['-C',shared,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()
    git('init'); await writeFile(join(shared,'fixture'),'pinned'); git('add','fixture')
    git('-c','user.name=Synthetic','-c','user.email=synthetic@example.test','commit','-m','pinned fixture')
    const pin=git('rev-parse','HEAD')
    await writeFile(join(candidate,'tests/contract/dsh-pin.json'),JSON.stringify({commit:pin}))
    await writeFile(join(shared,'fixture'),'other head'); git('add','fixture')
    git('-c','user.name=Synthetic','-c','user.email=synthetic@example.test','commit','-m','other fixture')
    const before=git('rev-parse','HEAD'); git('worktree','add','--detach',pinned,pin)
    assert.equal(await pinnedBuild(candidate,[shared]),undefined)
    await mkdir(join(pinned,'apps/cli/lib'),{recursive:true}); await writeFile(join(pinned,'apps/cli/lib/bin.js'),'// compiled fixture')
    await mkdir(join(pinned,'node_modules/tsx'),{recursive:true})
    assert.equal(await pinnedBuild(candidate,[shared]),pinned.replaceAll('\\','/'))
    assert.equal(git('rev-parse','HEAD'),before)
  } finally { await rm(root,{recursive:true,force:true}) }
})
