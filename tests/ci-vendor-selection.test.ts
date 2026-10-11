import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { managedMkdtempSync as mkdtempSync, managedTempRoot as tmpdir } from './helpers/managed-temp.mjs'
import { runtimeIdentity } from '../scripts/dsh-runtime-identity.mjs'
import { join } from 'node:path'
import test from 'node:test'

test('CI modes fail loudly without the pin and run complete vendor files without weakening sibling failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-ci-selector-'))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT // Invoke the CLI as a top-level gate, not this runner's child.
  const json = (file: string, value: unknown) => writeFileSync(join(root, file), JSON.stringify(value))
  const run = (mode: string) => spawnSync(process.execPath, [join(root, '.github/scripts/ci-unit-tests.mjs'), mode,
    '--report', join(root, 'result.json')], { cwd: root, env, encoding: 'utf8' })
  try {
    mkdirSync(join(root, '.github/scripts'), { recursive: true })
    mkdirSync(join(root, 'tests/contract'), { recursive: true })
    writeFileSync(join(root, '.github/scripts/ci-unit-tests.mjs'), readFileSync(new URL('../.github/scripts/ci-unit-tests.mjs', import.meta.url)))
    for (const file of ['scripts/dsh-runtime-identity.mjs','tests/helpers/managed-temp.mjs','tests/helpers/managed-temp.cjs','tests/helpers/managed-test-process.mjs','tests/helpers/process-evidence.mjs']) {
      mkdirSync(join(root,file,'..'),{recursive:true});
      writeFileSync(join(root,file),readFileSync(new URL('../'+file,import.meta.url)));
    }
    // The synthetic suite has no Electron tests; supply its executable dependency.
    mkdirSync(join(root,'node_modules/electron'),{recursive:true});
    writeFileSync(join(root,'node_modules/electron/index.js'),'module.exports=process.execPath;');
    json('.github/ci-test-exceptions.json', { knownFailures: [], vendorTests: [], unavailableFiles: [], platformTests: [] })
    json('.github/vendor-test-suite.json', { tests: [{ file: 'tests/mixed.test.ts', name: 'vendor protected' }], files: ['tests/vendor-only.test.ts'] })
    json('tests/contract/dsh-pin.json', { commit: 'synthetic-pin', packageVersion:'synthetic-version' })
    writeFileSync(join(root, 'tests/mixed.test.ts'), `import test from 'node:test';
      test('independent', () => {}); test('vendor protected', () => {});`)
    writeFileSync(join(root, 'tests/vendor-only.test.ts'), `import { describe, test } from 'node:test';
      describe('vendor suite', () => { test('future vendor regression', () => { throw Error('synthetic product regression'); }); });`)
    const missing = run('vendor')
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /requires vendor\/dsh-runtime/)
    const known = run('known')
    assert.equal(known.status, 0)
    assert.match(known.stdout, /No known failures remain/)
    const bin = join(root, 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh/lib')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'bin.js'), '// marker')
    json('vendor/dsh-runtime/VENDOR-MANIFEST.json', { dsh: { commit: 'wrong-pin' } })
    assert.match(run('vendor').stderr, /运行时过期.*固定提交或补丁内容不匹配/)
    json('vendor/dsh-runtime/VENDOR-MANIFEST.json', { dsh: { commit: 'synthetic-pin', packageVersion:'synthetic-version' }, runtimeIdentity:await runtimeIdentity(root) })
    const required = run('required')
    assert.equal(required.status, 0, required.stderr)
    assert.match(required.stdout, /还有 1 条 vendor 测试/)
    assert.equal(JSON.parse(readFileSync(join(root, 'result.json'), 'utf8')).passed, 1)
    const vendor = run('vendor')
    assert.equal(vendor.status, 1, 'a new sibling vendor failure must block the gate')
    const result = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'))
    assert.deepEqual([result.files, result.passed, result.failed, result.skipped], [2, 2, 1, 0])
    assert.deepEqual(result.failures, ['future vendor regression'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
