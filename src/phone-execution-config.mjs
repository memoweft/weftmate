import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) }
function keys(value, allowed) { return object(value) && Object.keys(value).every(key => allowed.includes(key)) }
function fail() { throw new Error('phone_execution_config_invalid') }

/** Local candidate settings contain a credential reference, never a key value. */
export async function loadPhoneExecutionConfig(path, resolveCredential) {
  if (!path) return null
  let value
  try {
    const bytes = await readFile(path)
    if (bytes.length > 16 * 1024) fail()
    value = JSON.parse(bytes.toString('utf8'))
  } catch { fail() }
  if (!keys(value, ['enabled', 'adbPath', 'adbSerial', 'model']) || typeof value.enabled !== 'boolean') fail()
  if (!value.enabled) return null
  if (typeof value.adbPath !== 'string' || !isAbsolute(value.adbPath)
    || basename(value.adbPath).toLowerCase() !== 'adb.exe') fail()
  if (!await stat(value.adbPath).then(entry => entry.isFile()).catch(() => false)) fail()
  if (value.adbSerial !== undefined && (typeof value.adbSerial !== 'string'
    || !/^[A-Za-z0-9_.:\[\]-]{1,128}$/.test(value.adbSerial))) fail()
  const model = value.model
  if (!keys(model, ['baseUrl', 'model', 'authRef']) || typeof model.baseUrl !== 'string'
    || typeof model.model !== 'string' || !model.model.trim() || model.model.length > 256
    || /[\x00-\x1f]/.test(model.model)
    || typeof model.authRef !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,159}$/.test(model.authRef)) fail()
  let url
  try { url = new URL(model.baseUrl) } catch { fail() }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash) fail()
  let key
  try { key = await resolveCredential(model.authRef) } catch { throw new Error('phone_model_credential_unavailable') }
  if (typeof key !== 'string' || !key || key.length > 4096 || /[\x00-\x1f]/.test(key)) {
    throw new Error('phone_model_credential_unavailable')
  }
  return {
    enabled: true,
    adb_path: value.adbPath,
    ...(value.adbSerial ? { adb_serial: value.adbSerial } : {}),
    model: { endpoint: url.href.replace(/\/$/, ''), name: model.model.trim(), api_key: key },
  }
}
