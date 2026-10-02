import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Candidate configuration contains paths and a credential reference, never a key value.
export function configureMemoWeft(configPath, env) {
  for (const name of ['MEMOWEFT_TESTING', 'MEMOWEFT_TEST_MODEL_RESPONSE', 'MEMOWEFT_API_KEY', 'MEMOWEFT_API_KEY_ENV']) delete env[name]
  env.WEFTMATE_MEMOWEFT_ENABLED = '0'
  if (!configPath) return { enabled: false }
  const path = resolve(configPath)
  let config
  try { config = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('记忆配置文件无法读取或不是有效 JSON。') }
  const keys = ['python', 'pythonPath', 'baseUrl', 'model', 'authRef']
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(key => !keys.includes(key))
    || keys.some(key => typeof config[key] !== 'string' || !config[key].trim())) {
    throw new Error('记忆配置只接受 python、pythonPath、baseUrl、model、authRef；凭据值应保存在应用模型设置中。')
  }
  let url
  try { url = new URL(config.baseUrl) } catch { throw new Error('记忆模型地址无效。') }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash) {
    throw new Error('当前记忆候选只允许本机 HTTP 模型地址，且地址中不能包含凭据或查询参数。')
  }
  const python = resolve(dirname(path), config.python)
  const pythonPath = resolve(dirname(path), config.pythonPath)
  if (!existsSync(python) || !existsSync(resolve(pythonPath, 'memoweft/integrations/dsh_bridge/__main__.py'))) {
    throw new Error('记忆 Python 环境或桥接源码不存在，请检查本机记忆配置。')
  }
  Object.assign(env, {
    WEFTMATE_MEMOWEFT_ENABLED: '1',
    WEFTMATE_MEMOWEFT_PYTHON: python,
    WEFTMATE_MEMOWEFT_PYTHONPATH: pythonPath,
    WEFTMATE_MEMOWEFT_MODEL_TIER: 'local',
    WEFTMATE_MEMOWEFT_AUTH_REF: config.authRef,
    MEMOWEFT_BASE_URL: url.href.replace(/\/$/, ''),
    MEMOWEFT_WORLD_MODEL: config.model,
  })
  return { enabled: true, modelTier: 'local', model: config.model, baseUrl: env.MEMOWEFT_BASE_URL }
}
