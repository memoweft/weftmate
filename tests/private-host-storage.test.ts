import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { linkSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ensurePrivateDirectory, ensurePrivateFile } from '../src/private-host-storage.mjs'

test('private directory and store file remain protected after repeated checks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-private-storage-'))
  try {
    await ensurePrivateDirectory(root)
    await ensurePrivateDirectory(root)
    const file = join(root, 'store.json')
    writeFileSync(file, '{}')
    await ensurePrivateFile(file)
    await ensurePrivateFile(file)
    assert.equal(readFileSync(file, 'utf8'), '{}')
    if (process.platform === 'win32') {
      const directoryAcl = execFileSync('icacls', [root], { encoding: 'utf8', windowsHide: true })
      const fileAcl = execFileSync('icacls', [file], { encoding: 'utf8', windowsHide: true })
      assert.match(directoryAcl, /\(OI\)\(CI\)\(F\)/)
      assert.match(fileAcl, /\(F\)/)
      assert.doesNotMatch(directoryAcl + fileAcl, /Authenticated Users|BUILTIN\\Users/i)
    } else {
      assert.equal(statSync(root).mode & 0o777, 0o700)
      assert.equal(statSync(file).mode & 0o777, 0o600)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('private storage refuses a link that escapes its named directory', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'weftmate-private-link-'))
  const elsewhere = mkdtempSync(join(tmpdir(), 'weftmate-private-elsewhere-'))
  try {
    const link = join(parent, 'linked')
    try { symlinkSync(elsewhere, link, process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) {
      if (process.platform === 'win32' && (error as { code?: string }).code === 'EPERM') {
        t.diagnostic('junction creation unavailable for this Windows account')
        return
      }
      throw error
    }
    await assert.rejects(ensurePrivateDirectory(link),
      (error: { code?: string }) => error.code === 'PRIVATE_STORAGE_UNAVAILABLE')
  } finally {
    rmSync(parent, { recursive: true, force: true })
    rmSync(elsewhere, { recursive: true, force: true })
  }
})

test('private file verification refuses a hard link to another path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-private-hardlink-'))
  try {
    await ensurePrivateDirectory(root)
    const outside = join(root, 'outside.txt')
    const linked = join(root, 'store.json')
    writeFileSync(outside, 'synthetic')
    linkSync(outside, linked)
    await assert.rejects(ensurePrivateFile(linked),
      (error: { code?: string }) => error.code === 'PRIVATE_STORAGE_UNAVAILABLE')
    assert.equal(readFileSync(outside, 'utf8'), 'synthetic')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
