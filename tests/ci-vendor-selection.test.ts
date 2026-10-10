import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('CI modes fail loudly without the pin and run complete vendor files without weakening sibling failures', () => {
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
    json('.github/ci-test-exceptions.json', { knownFailures: [], vendorTests: [], unavailableFiles: [], platformTests: [] })
    json('.github/vendor-test-suite.json', { tests: [{ file: 'tests/mixed.test.ts', name: 'vendor protected' }], files: ['tests/vendor-only.test.ts'] })
    json('tests/contract/dsh-pin.json', { commit: 'synthetic-pin' })
    writeFileSync(join(root, 'tests/mixed.test.ts'), `import test from 'node:test';
      test('independent', () => {}); test('vendor protected', () => {});`)
    writeFileSync(join(root, 'tests/vendor-only.test.ts'), `import test from 'node:test';
      test('future vendor regression', () => { throw Error('synthetic product regression'); });`)
    const missing = run('vendor')
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /requires a prebuilt pinned/)
    const known = run('known')
    assert.equal(known.status, 0)
    assert.match(known.stdout, /No known failures remain/)
    const bin = join(root, 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh/lib')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'bin.js'), '// marker')
    json('vendor/dsh-runtime/VENDOR-MANIFEST.json', { dsh: { commit: 'wrong-pin' } })
    assert.match(run('vendor').stderr, /does not match/)
    json('vendor/dsh-runtime/VENDOR-MANIFEST.json', { dsh: { commit: 'synthetic-pin' } })
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
