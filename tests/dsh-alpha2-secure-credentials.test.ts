/** Real isolated secure-snapshot smoke: no user DSH_HOME or model service participates. */
import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFile = promisify(execFileCallback)

test('alpha2 secure snapshot uses IPC for a synthetic set/resolve/unset and keeps it out of visible diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-secure-credential-'))
  try {
    const result = await execFile(process.execPath, ['scripts/run-dsh-alpha2-candidate.mjs', '--smoke', '--credential-smoke'], {
      cwd: process.cwd(), timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        WEFTMATE_DSH_ALPHA2_HOME: join(root, 'dsh-home'),
        WEFTMATE_DSH_ALPHA2_WORKSPACE: join(root, 'workspace'),
      },
    })
    const output = `${result.stdout}\n${result.stderr}`
    assert.match(output, /credential smoke passed: set\/resolve\/unset via Alpha2 IPC/)
    assert.doesNotMatch(output, /synthetic-value/)
    assert.doesNotMatch(output, /synthetic-env-secret/)
    assert.doesNotMatch(output, /opening the default browser/)
    assert.doesNotMatch(output, /boot failed stage=/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
