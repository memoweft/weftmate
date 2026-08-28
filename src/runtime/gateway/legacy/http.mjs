/**
 * WeftMate Gateway · legacy seam · HTTP 路由面（P1-02 自 weftmate-host.mjs 原样拆分）。
 *
 * `/weftmate/*` 路由表：状态面 GET + 动作面 POST；其余 404。
 * 路由顺序即原插件内顺序（status → update → perception → pet → device → 404），
 * 迁移期旧端点保持可用，行为逐字节不变。
 */
import { readState } from './state.mjs'
import { writeUpdateRequest } from './update.mjs'
import { readPerception, writePerceptionRequest } from './perception.mjs'
import { writePetRequest } from './pet.mjs'
import { readDeviceState, verifyDeviceToken, writeDeviceRequest } from './device.mjs'

/** POST body 收集（小 JSON，容量上限防滥用）。 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 16_384) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** /weftmate/* 路由：状态面 GET + 动作面 POST；其余 404。 */
export async function serveWeftmate(req, res) {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  if (pathname === '/weftmate/status.json' && (req.method === 'GET' || req.method === 'HEAD')) {
    const body = `${JSON.stringify(readState())}\n`
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(req.method === 'HEAD' ? undefined : body)
    return
  }
  if (pathname === '/weftmate/update' && req.method === 'POST') {
    let payload = null
    try { payload = await readJsonBody(req) } catch { /* 坏 body 走 400 */ }
    const result = payload && typeof payload.action === 'string'
      ? writeUpdateRequest(payload.action)
      : { ok: false, code: 'BAD_REQUEST' }
    res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(`${JSON.stringify(result)}\n`)
    return
  }
  if (pathname === '/weftmate/perception.json' && (req.method === 'GET' || req.method === 'HEAD')) {
    const body = `${JSON.stringify(readPerception())}\n`
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(req.method === 'HEAD' ? undefined : body)
    return
  }
  if (pathname === '/weftmate/perception' && req.method === 'POST') {
    let payload = null
    try { payload = await readJsonBody(req) } catch { /* 坏 body 走 400 */ }
    const result = payload && typeof payload.action === 'string'
      ? writePerceptionRequest(payload.action, payload.value)
      : { ok: false, code: 'BAD_REQUEST' }
    res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(`${JSON.stringify(result)}\n`)
    return
  }
  if (pathname === '/weftmate/pet' && req.method === 'POST') {
    let payload = null
    try { payload = await readJsonBody(req) } catch { /* 坏 body 走 400 */ }
    const result = payload && typeof payload.action === 'string'
      ? writePetRequest(payload.action, payload.value)
      : { ok: false, code: 'BAD_REQUEST' }
    res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(`${JSON.stringify(result)}\n`)
    return
  }
  // ── R8-01 设备面：状态（UI 读 token/设备）+ pair/observation（token 校验先于动作）──
  if (pathname === '/weftmate/device/state.json' && (req.method === 'GET' || req.method === 'HEAD')) {
    const body = `${JSON.stringify(readDeviceState())}\n`
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(req.method === 'HEAD' ? undefined : body)
    return
  }
  if (pathname === '/weftmate/device/v1/pair' && req.method === 'POST') {
    let payload = null
    try { payload = await readJsonBody(req) } catch { /* 坏 body 走 400 */ }
    const tokenError = verifyDeviceToken(payload?.token)
    if (tokenError !== null) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(`${JSON.stringify({ ok: false, code: tokenError })}\n`)
      return
    }
    const name = typeof payload?.deviceName === 'string' ? payload.deviceName.trim().slice(0, 80) : ''
    if (!name) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(`${JSON.stringify({ ok: false, code: 'BAD_DEVICE_NAME' })}\n`)
      return
    }
    const result = writeDeviceRequest('pair', { deviceName: name })
    res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(`${JSON.stringify(result)}\n`)
    return
  }
  if (pathname === '/weftmate/device/v1/observation' && req.method === 'POST') {
    let payload = null
    try { payload = await readJsonBody(req) } catch { /* 坏 body 走 400 */ }
    const tokenError = verifyDeviceToken(payload?.token)
    if (tokenError !== null) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(`${JSON.stringify({ ok: false, code: tokenError })}\n`)
      return
    }
    const name = typeof payload?.deviceName === 'string' ? payload.deviceName.trim().slice(0, 80) : ''
    const state = readDeviceState()
    const paired = (state.devices ?? []).some((device) => device.name === name)
    if (!paired) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(`${JSON.stringify({ ok: false, code: 'UNPAIRED_DEVICE' })}\n`)
      return
    }
    const observations = Array.isArray(payload?.observations) ? payload.observations : []
    const result = writeDeviceRequest('observation', { deviceName: name, observations })
    res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(`${JSON.stringify(result)}\n`)
    return
  }
  res.writeHead(404)
  res.end()
}
