import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('maintenance orchestration fake processes reject changed PIDs and restore known state',
  { skip: process.platform !== 'win32' }, () => {
    const repository = dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)))
    const script = join(repository, 'scripts', 'archive', 'stage14r3-orchestrate.ps1')
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32',
      'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const output = execFileSync(powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script, '-SelfTest'], {
        windowsHide: true, timeout: 10_000, encoding: 'utf8', maxBuffer: 8 * 1024,
      })
    assert.match(output, /^stage14r3-orchestrate-selftest=passed\s*$/)
  })
