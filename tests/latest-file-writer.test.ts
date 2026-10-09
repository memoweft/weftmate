import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createLatestFileWriter } from '../src/latest-file-writer.mjs'

test('async snapshots coalesce concurrent writes and preserve the last complete value', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-latest-writer-'))
  try {
    const file = join(root, 'state.json'), write = createLatestFileWriter(file)
    await Promise.all(Array.from({ length: 1000 }, (_, n) => write(JSON.stringify({ n }))))
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { n: 999 })
    const before = await stat(file)
    await write(JSON.stringify({ n: 999 }))
    assert.equal((await stat(file)).mtimeMs, before.mtimeMs)
    await write(JSON.stringify({ n: 1000 }))
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { n: 1000 })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('async snapshots recover after a failed write without losing subsequent updates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-latest-retry-'))
  try {
    const file = join(root, 'child', 'state.json'), write = createLatestFileWriter(file)
    await assert.rejects(write('failed'))
    await mkdir(join(root, 'child'))
    await write('recovered')
    assert.equal(await readFile(file, 'utf8'), 'recovered')
  } finally { await rm(root, { recursive: true, force: true }) }
})
