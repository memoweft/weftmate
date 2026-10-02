import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureMemoWeft } from '../dogfood/memoweft-config.mjs'

function config(baseUrl: string, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'weftmate-memory-config-'))
  mkdirSync(join(dir, 'src/memoweft/integrations/dsh_bridge'), { recursive: true })
  writeFileSync(join(dir, 'python.exe'), '')
  writeFileSync(join(dir, 'src/memoweft/integrations/dsh_bridge/__main__.py'), '')
  const path = join(dir, 'config.json')
  writeFileSync(path, JSON.stringify({ python: 'python.exe', pythonPath: 'src', baseUrl, model: 'local-model', authRef: 'LOCAL_MODEL_REF', ...extra }))
  return path
}

test('明确本地配置仅传凭据引用，并移除测试注入', () => {
  const env: Record<string, string> = { MEMOWEFT_TESTING: '1', MEMOWEFT_TEST_MODEL_RESPONSE: '__smart__' }
  const result = configureMemoWeft(config('http://127.0.0.1:18080/v1'), env)
  assert.equal(result.enabled, true)
  assert.equal(env.WEFTMATE_MEMOWEFT_AUTH_REF, 'LOCAL_MODEL_REF')
  assert.equal(env.WEFTMATE_MEMOWEFT_MODEL_TIER, 'local')
  assert.equal(env.MEMOWEFT_TEST_MODEL_RESPONSE, undefined)
  assert.equal(env.MEMOWEFT_API_KEY, undefined)
})

test('follow-current 保留本地路由、凭据引用和别名原样传给 MemoWeft', () => {
  const env: Record<string, string> = {}
  const result = configureMemoWeft(config('http://127.0.0.1:18080/v1', { model: '@current' }), env)
  assert.equal(result.enabled, true)
  assert.equal(result.model, '@current')
  assert.equal(result.baseUrl, 'http://127.0.0.1:18080/v1')
  assert.equal(env.MEMOWEFT_WORLD_MODEL, '@current')
  assert.equal(env.MEMOWEFT_BASE_URL, 'http://127.0.0.1:18080/v1')
  assert.equal(env.WEFTMATE_MEMOWEFT_AUTH_REF, 'LOCAL_MODEL_REF')
  assert.equal(env.MEMOWEFT_API_KEY, undefined)
  assert.equal(env.MEMOWEFT_API_KEY_ENV, undefined)
})

test('拒绝外部地址与明文密钥配置；错误不包含值', () => {
  assert.throws(() => configureMemoWeft(config('https://api.example.com/v1'), {}), /只允许本机/)
  assert.throws(() => configureMemoWeft(config('http://secret@127.0.0.1:18080/v1'), {}), /只允许本机/)
  try { configureMemoWeft(config('http://127.0.0.1:18080/v1', { apiKey: 'do-not-print-this' }), {}) } catch (error) {
    assert.doesNotMatch(String(error), /do-not-print-this/)
    return
  }
  assert.fail('plaintext credential configuration must be rejected')
})

test('没有明确配置时仍保持记忆关闭', () => {
  const env: Record<string, string> = { WEFTMATE_MEMOWEFT_ENABLED: '1' }
  assert.equal(configureMemoWeft(null, env).enabled, false)
  assert.equal(env.WEFTMATE_MEMOWEFT_ENABLED, '0')
})
