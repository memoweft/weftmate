import assert from 'node:assert/strict'
import { linkSync, mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { inspectProjectRoot, listProjectFiles, readProjectFile } from '../src/personal-projects/index.mjs'

test('Windows project reader holds exact root and reads bounded UTF-8 source', { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'weft-project-reader-'))
  assert.ok(resolve(root).startsWith(resolve(tmpdir())))
  try {
    mkdirSync(join(root, 'notes'))
    writeFileSync(join(root, 'notes', 'one.md'), '# One\nSecond line\n', 'utf8')
    const project = await inspectProjectRoot(root)
    const listing = await listProjectFiles(project)
    assert.equal(listing.files.length, 1, JSON.stringify({ project, listing }))
    assert.equal(listing.files[0].relativePath, 'notes\\one.md')
    const read = await readProjectFile(project, listing.files[0])
    assert.equal(read.text, '# One\nSecond line\n')
    assert.equal(read.lineStart, 1)
    assert.match(read.fileSha256, /^[a-f0-9]{64}$/)
    mkdirSync(join(root, '中文目录'))
    writeFileSync(join(root, '中文目录', '资料.md'), '来源行：中文内容\n'.repeat(7_000), 'utf8')
    const chinese = await inspectProjectRoot(join(root, '中文目录'))
    const chineseList = await listProjectFiles(chinese)
    assert.equal(chineseList.files[0].relativePath, '资料.md')
    const chinesePage = await readProjectFile(chinese, chineseList.files[0])
    assert.match(chinesePage.text, /来源行：中文内容/)
    assert.ok(Buffer.byteLength(chinesePage.text, 'utf8') <= 32 * 1024)
    assert.equal(chinesePage.hasMore, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Windows project reader rejects changed roots, changed files, links, ADS and bad UTF-8',
  { skip: process.platform !== 'win32' }, async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'weft-project-unsafe-'))
  assert.ok(resolve(workspace).startsWith(resolve(tmpdir())))
  const root = join(workspace, 'project')
  try {
    mkdirSync(root)
    writeFileSync(join(root, 'change.md'), 'original\n', 'utf8')
    writeFileSync(join(root, 'bad.txt'), Buffer.from([0xc3, 0x28]))
    writeFileSync(join(root, 'too-long.md'), 'x'.repeat(32 * 1024 + 1), 'utf8')
    writeFileSync(join(root, 'linked.md'), 'hardlink', 'utf8')
    linkSync(join(root, 'linked.md'), join(root, 'linked-copy.md'))
    const project = await inspectProjectRoot(root)
    const listing = await listProjectFiles(project)
    assert.equal(listing.files.some((file) => file.relativePath.startsWith('linked')), false)
    const changed = listing.files.find((file) => file.relativePath === 'change.md')!
    writeFileSync(join(root, 'change.md'), 'now changed and longer\n', 'utf8')
    await assert.rejects(readProjectFile(project, changed),
      (error: { code?: string }) => error.code === 'PROJECT_FILE_CHANGED')
    await assert.rejects(readProjectFile(project, listing.files.find((file) => file.relativePath === 'bad.txt')!),
      (error: { code?: string }) => error.code === 'PROJECT_INVALID_UTF8')
    await assert.rejects(readProjectFile(project, listing.files.find((file) => file.relativePath === 'too-long.md')!),
      (error: { code?: string }) => error.code === 'PROJECT_LINE_TOO_LONG')
    await assert.rejects(readProjectFile(project, { ...changed, relativePath: 'change.md:secret' }),
      (error: { code?: string }) => error.code === 'PROJECT_UNSAFE_PATH')
    mkdirSync(join(workspace, 'outside'))
    writeFileSync(join(workspace, 'outside', 'private.md'), 'outside', 'utf8')
    symlinkSync(join(workspace, 'outside'), join(root, 'shortcut'), 'junction')
    const withJunction = await listProjectFiles(project)
    assert.equal(withJunction.files.some((file) => file.relativePath.includes('private.md')), false)
    assert.ok(withJunction.skippedCount >= 1)
    renameSync(root, join(workspace, 'old-project'))
    mkdirSync(root)
    writeFileSync(join(root, 'change.md'), 'replacement', 'utf8')
    await assert.rejects(listProjectFiles(project),
      (error: { code?: string }) => error.code === 'PROJECT_ROOT_CHANGED')
  } finally { rmSync(workspace, { recursive: true, force: true }) }
})
