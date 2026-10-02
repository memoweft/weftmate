import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const script = readFileSync(new URL('../scripts/preview-mod-projects.mjs', import.meta.url), 'utf8')

test('preview keeps keyless default and makes local real-model routing explicit and credential-scoped', () => {
  assert.match(script, /--real-local-model requires --model-config/)
  assert.match(script, /local model baseUrl must be a credential-free loopback HTTP URL/)
  assert.match(script, /api: openai-completions/)
  assert.match(script, /apiKeyEnv:/)
  assert.match(script, /if \(localModel\) previewEnv\[localModel\.apiKeyEnv\] = process\.env\[localModel\.apiKeyEnv\]/)
  assert.doesNotMatch(script, /env: \{ \.\.\.process\.env/)
  assert.match(script, /localModel \? 'preview-local' : 'preview-keyless'/)
  assert.match(script, /join\(home, '\.agent-presets', 'mod-maintainer'\)/)
  assert.match(script, /ctx\.agentPresets\.list\(\)/)
  assert.match(script, /LIVE_PRESET=mod-maintainer/)
  assert.match(script, /agentPreset: 'mod-maintainer'/)
  assert.match(script, /agentPreset\.list/)
  assert.match(script, /session\.create/)
  assert.doesNotMatch(script, /workspaceId: created\.workspace\.workspaceId, cwd: workspace/)
  assert.doesNotMatch(script, /profiles\/preview-mod-projects\/agent-presets/)
})
