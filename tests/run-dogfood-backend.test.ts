import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repository = fileURLToPath(new URL('../', import.meta.url))
const launcher = join(repository, 'scripts', 'run-dogfood-backend.mjs')
const source = readFileSync(launcher, 'utf8').replace(/\r\n/g, '\n')

function dryRun(args: string[]) {
  return spawnSync(process.execPath, [launcher, ...args, '--dry-run'], {
    cwd: repository,
    encoding: 'utf8',
  })
}

test('backend dogfood launcher forwards a spaced isolated root to the existing launcher without a child Node process', () => {
  const root = join(tmpdir(), 'weftmate backend dogfood spaced root')
  const result = dryRun(['--root', root])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"--user-data-dir","[^"]*weftmate backend dogfood spaced root"/)
  assert.match(source, /await import\(pathToFileURL\(dogfoodScript\)\.href\)/)
  assert.match(source, /process\.argv = \[process\.execPath, dogfoodScript, \.\.\.dogfoodArgs\]/)
  assert.doesNotMatch(source, /spawn\(process\.execPath/)
  assert.doesNotMatch(source, /child\.kill|process\.stdin\.on/)
  assert.doesNotMatch(source, /childEnv|Object\.assign\(process\.env/)
})

test('backend dogfood launcher rejects unknown arguments before loading dogfood/run', () => {
  const result = dryRun(['--root', join(tmpdir(), 'weftmate-backend-root'), '--not-real'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unknown arguments: --not-real/)
  assert.doesNotMatch(result.stdout, /\[dogfood\] CONFIG/)
})

test('backend dogfood launcher preserves the secure memory-config reference argument in dry-run output', () => {
  const result = dryRun(['--root', join(tmpdir(), 'weftmate-backend-root'), '--memory-config', join(repository, 'dogfood', 'memoweft-config.mjs')])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /memory=configured-by-reference/)
  assert.match(result.stdout, /--memoweft-config/)
  assert.doesNotMatch(result.stdout, /API_KEY=|model_api_key/i)
})
