import assert from 'node:assert/strict'
import test from 'node:test'
import { createAlpha2Mods } from '../src/plugins/weftmate-alpha2-mods.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('disabled alpha2 MemoWeft close guards child spawn and cleans credential-like child env keys', async () => {
  const source = await readFile(new URL('../src/plugins/weftmate-alpha2-memoweft.mjs', import.meta.url), 'utf8')
  assert.match(source, /if \(this\.child\) \{ try \{ await this\.call\('shutdown'\)/)
  assert.match(source, /(?:KEY\|TOKEN\|SECRET\|PASSWORD)/)
})

test('alpha2 Mod maintainer rejects dangerous default and requires workspace-write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-mod-safe-'))
  try {
    const calls: unknown[] = []
    const bridge = {
      createWorkspace: async () => ({ workspace: { workspaceId: 'w-1' } }),
      create: async (request: unknown) => ({ sessionId: (request as { sessionId: string }).sessionId }),
      list: async () => ({ items: [] }),
      permissionCatalog: async () => ({ defaultPreset: 'danger-full-access', options: [{ value: 'danger-full-access' }] }),
      setPermissionPreset: async (...args: unknown[]) => { calls.push(args); return { accepted: true, preset: 'workspace-write' } },
    }
    const mods = createAlpha2Mods({ bridge, inspectSession: async (id: string) => ({ meta: { agentPreset: 'mod-maintainer', id } }), root })
    await assert.rejects(mods.api.create('safe fixture'), /workspace_write_preset_unavailable/)
    assert.equal(calls.length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
