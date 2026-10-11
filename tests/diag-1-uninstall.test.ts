import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { uninstallDesktopData } from '../src/desktop-uninstall.mjs'
import { desktopConfigPath, saveDesktopConfig } from '../src/desktop-config.mjs'
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../src/host-mode.mjs'

test('uninstall retains diagnostic logs and native dumps by default and explicit data deletion removes both', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-diag1-uninstall-'))
  const profile = join(root, 'synthetic-profile'), log = join(profile, 'logs', 'host-2026-10-11.jsonl')
  const dump = join(profile, 'Crashpad', 'pending', 'synthetic.dmp'), unrelated = join(root, 'unrelated.txt')
  try {
    await mkdir(join(profile, 'logs'), { recursive: true }); await mkdir(join(profile, 'Crashpad', 'pending'), { recursive: true })
    await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT))
    await writeFile(log, '{"event":"host.start"}\n'); await writeFile(dump, 'synthetic dump fixture'); await writeFile(unrelated, 'unrelated data')
    const config = desktopConfigPath(root)
    saveDesktopConfig(config, { schemaVersion: 1, dataDirectory: profile, accessPort: 0, updates: { channel: 'stable' } })
    await uninstallDesktopData({ appData: root })
    assert.equal(await readFile(log, 'utf8'), '{"event":"host.start"}\n'); assert.equal(await readFile(dump, 'utf8'), 'synthetic dump fixture')
    await uninstallDesktopData({ appData: root, deleteData: true })
    for (const deleted of [profile, join(profile, 'logs'), join(profile, 'Crashpad'), log, dump, config]) await assert.rejects(stat(deleted), { code: 'ENOENT' })
    assert.equal(await readFile(unrelated, 'utf8'), 'unrelated data')
  } finally { await rm(root, { recursive: true, force: true }) }
})
