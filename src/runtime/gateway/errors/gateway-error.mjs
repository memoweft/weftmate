import { payloadDigest } from '../../dsh-adapter/sessions.mjs'

export async function gatewayError(error, fallbackCode = 'gateway-error') {
  const code = typeof error?.code === 'string' && /^[a-z0-9-]{1,128}$/.test(error.code) ? error.code : fallbackCode
  const operation = typeof error?.operation === 'string' ? error.operation : null
  const digest = typeof error?.details?.digest === 'string' ? error.details.digest : await payloadDigest({ code, operation })
  return { code, message: 'Gateway request failed', details: { digest } }
}

export function writeJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(`${JSON.stringify(value)}\n`)
}
