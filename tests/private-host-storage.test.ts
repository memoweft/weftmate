import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { linkSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { durableWrite } from '../src/personal-access/store.mjs'
import { ensurePrivateDirectory, ensurePrivateFile, openPrivateFile, forgetPrivateFile } from '../src/private-host-storage.mjs'

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

async function readAcl(files: string[]) {
  const script = `$ErrorActionPreference='Stop'; Import-Module Microsoft.PowerShell.Security; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; @(foreach ($file in (ConvertFrom-Json $env:HF2_ACL_FILES)) { $acl=Get-Acl -LiteralPath $file; @{ protected=$acl.AreAccessRulesProtected; rules=@($acl.Access | ForEach-Object { @{ currentUser=($_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $sid); type=$_.AccessControlType.ToString(); rights=$_.FileSystemRights.ToString(); inherited=$_.IsInherited; flags=$_.InheritanceFlags.ToString() } }) } }) | ConvertTo-Json -Depth 5 -Compress`
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, env: { ...process.env, PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules'), HF2_ACL_FILES: JSON.stringify(files) } })
  const parsed = JSON.parse(stdout)
  return Array.isArray(parsed) ? parsed : [parsed]
}

test('exclusive tmp and atomic store inherit exactly the original current-user-only Windows ACL', async t => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-private-inheritance-'))
  const tmp = join(root, 'proof.tmp'), file = join(root, 'store.json')
  try {
    await ensurePrivateDirectory(root)
    const handle = await openPrivateFile(tmp)
    await handle.writeFile('synthetic')
    await handle.close()
    await ensurePrivateFile(tmp)
    await durableWrite(file, { synthetic: true })
    await durableWrite(file, { synthetic: 'replacement' })
    if (process.platform === 'win32') {
      const acl = await readAcl([root, tmp, file])
      t.diagnostic(JSON.stringify(acl))
      for (const item of acl) {
        assert.equal(item.rules.length, 1)
        assert.equal(item.rules[0].currentUser, true)
        assert.equal(item.rules[0].type, 'Allow')
        assert.equal(item.rules[0].rights, 'FullControl')
      }
      assert.equal(acl[0].protected, true)
      assert.match(acl[0].rules[0].flags, /ContainerInherit/)
      assert.match(acl[0].rules[0].flags, /ObjectInherit/)
      assert.equal(acl[1].rules[0].inherited, true)
      assert.equal(acl[2].rules[0].inherited, true)
    } else {
      assert.equal(statSync(tmp).mode & 0o777, 0o600)
      assert.equal(statSync(file).mode & 0o777, 0o600)
    }
  } finally { forgetPrivateFile(tmp); rmSync(root, { recursive: true, force: true }) }
})

test('pre-existing files and replacements are tightened instead of trusting directory inheritance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-private-existing-'))
  try {
    const file = join(root, 'legacy.json')
    writeFileSync(file, '{}') // Created under the original broad temp directory ACL.
    await ensurePrivateDirectory(root)
    await ensurePrivateFile(file)
    rmSync(file)
    writeFileSync(file, '{}')
    await ensurePrivateFile(file)
    if (process.platform === 'win32') {
      const [acl] = await readAcl([file])
      assert.equal(acl.protected, true)
      assert.equal(acl.rules.length, 1)
      assert.equal(acl.rules[0].currentUser, true)
    } else assert.equal(statSync(file).mode & 0o777, 0o600)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
