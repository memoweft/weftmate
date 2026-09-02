import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

describe('AI-Game installation owner persistence', () => {
  test('loads both host-only owner ids before generating and never exports them through env or logs', async () => {
    const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
    const start = source.indexOf("const AI_GAME_PRINCIPAL_REF = 'WEFTMATE_AI_GAME_PRINCIPAL_ID'")
    const end = source.indexOf('let aiGameDevelopmentOrigin', start)
    assert.ok(start >= 0 && end > start)
    const block = source.slice(start, end)
    assert.match(block, /AI_GAME_CONTROLLER_REF = 'WEFTMATE_AI_GAME_CONTROLLER_ID'/)
    assert.ok(block.indexOf('getCredential?.(ref)') < block.indexOf('randomUUID()'))
    assert.match(block, /\[AI_GAME_PRINCIPAL_REF, 'principal'\]/)
    assert.match(block, /\[AI_GAME_CONTROLLER_REF, 'controller'\]/)
    assert.match(block, /saveCredential\?\.\(\s*ref,/)
    assert.doesNotMatch(block, /process\.env\[[^\]]*(?:PRINCIPAL|CONTROLLER)|process\.env\.WEFTMATE_AI_GAME_(?:PRINCIPAL|CONTROLLER)/)
    assert.doesNotMatch(block, /console\.(?:log|warn|error)\([^\n]*(?:existingId|principal_|controller_)/)
  })
})
