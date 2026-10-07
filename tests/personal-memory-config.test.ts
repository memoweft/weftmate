import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadPersonalMemoryConfig } from '../src/personal-memory/config.mjs'

test('account memory config accepts a configured loopback service and a credential reference without storing a key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-memory-config-'))
  const python = join(root, 'python.exe')
  const pythonPath = join(root, 'py')
  const bridge = join(pythonPath, 'memoweft', 'integrations', 'dsh_bridge')
  const file = join(root, 'memory.json')
  try {
    mkdirSync(bridge, { recursive: true })
    writeFileSync(python, '')
    writeFileSync(join(bridge, '__main__.py'), '')
    const value = { python, pythonPath, baseUrl: 'http://127.0.0.1:8081/v1', model: '@current',
      authRef: 'personal-local-occamy-miniplus-v21' }
    writeFileSync(file, JSON.stringify(value))
    assert.equal((await loadPersonalMemoryConfig(file)).model, '@current')
    writeFileSync(file, JSON.stringify({ ...value, baseUrl: 'http://127.0.0.1:18081/v1', authRef: 'private-model-qwen' }))
    assert.equal((await loadPersonalMemoryConfig(file)).authRef, 'private-model-qwen')
    for (const invalid of [
      { ...value, model: 'occamy-miniplus-v21' },
      { ...value, baseUrl: 'https://external.example/v1' },
      { ...value, authRef: '../private-cloud-ref' },
      { ...value, model_api_key: 'must-not-be-copied' },
    ]) {
      writeFileSync(file, JSON.stringify(invalid))
      await assert.rejects(loadPersonalMemoryConfig(file),
        (error: { code: string }) => error.code === 'MEMORY_CONFIGURATION_INVALID')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
