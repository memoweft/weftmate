import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runVendorTests, pinnedBuild } from '../scripts/nightly/vendor-tests.mjs'
import { execFileSync } from 'node:child_process'
import { inspect, report } from '../scripts/nightly/report.mjs'

test('nightly vendor step records passes and failures and makes failed assertions red in the actual report', async () => {
  const out = await mkdtemp(join(tmpdir(), 'weftmate-nightly-vendor-'))
  try {
    const worktree = join(out, 'synthetic-worktree')
    const bin = join(worktree, 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh/lib')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'bin.js'), '// synthetic prebuilt vendor marker')
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
    await assert.rejects(runVendorTests(async (_command: string, _args: string[], options: any) => {
      assert.equal(options.name, 'vendor-assemble')
      throw Error('synthetic missing pinned build')
    }, join(out, 'unbuilt'), out), /missing pinned build/)
  } finally { await rm(out, { recursive: true, force: true }) }
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
