import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { Transform } from 'node:stream'

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection'])
const filtered = (headers) => Object.fromEntries(Object.entries(headers)
  .filter(([name]) => !HOP.has(name.toLowerCase())))

/** An opaque, loopback-only HTTP byte relay. It never parses either body. */
export async function createPersonalModelObservationProxy({ targetOrigin, recorder, runId,
  maxSockets = 8 } = {}) {
  const target = new URL(targetOrigin)
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' ||
      target.username || target.password || target.pathname !== '/' || target.search || target.hash ||
      !Number.isInteger(maxSockets) || maxSockets < 1 || maxSockets > 32 ||
      typeof recorder?.record !== 'function') throw new TypeError('invalid observation proxy configuration')
  const prefix = `/observe-${randomUUID()}`
  const clients = new Set()
  const upstreams = new Set()
  const active = new Map()
  let closed = false
  const record = (event, row = {}) => { recorder.record({ event, runId, ...row }) }
  const server = createServer((incoming, outgoing) => {
    if (closed) { outgoing.writeHead(503); outgoing.end(); return }
    const path = incoming.url?.slice(prefix.length)
    const kind = incoming.method === 'POST' && path === '/v1/chat/completions' ? 'chat'
      : incoming.method === 'GET' && path === '/v1/models' ? 'models' : null
    if (!incoming.url?.startsWith(`${prefix}/`) || !kind) {
      outgoing.writeHead(404); outgoing.end(); return
    }
    const requestId = randomUUID()
    const row = { requestId, kind }
    for (const other of active.values()) record('wire-ambiguous', other)
    if (active.size) record('wire-ambiguous', row)
    active.set(requestId, row)
    record('wire-arrival', row)
    let finished = false
    let upstreamResponse = null
    let responseEnded = false
    let inboundBytes = 0
    let outboundBytes = 0
    const end = (event) => {
      if (finished) return
      finished = true
      active.delete(requestId)
      record(event, { ...row, bytes: outboundBytes })
    }
    const upstream = httpRequest(new URL(path, target), {
      method: incoming.method,
      headers: { ...filtered(incoming.headers), host: target.host },
      agent: false,
    })
    upstreams.add(upstream)
    upstream.once('close', () => upstreams.delete(upstream))
    upstream.once('finish', () => record('wire-request-flushed', { ...row, bytes: inboundBytes }))
    upstream.once('response', (response) => {
      upstreamResponse = response
      record('wire-headers', { ...row, status: response.statusCode })
      outgoing.writeHead(response.statusCode ?? 502, filtered(response.headers))
      const meter = new Transform({ transform(chunk, _encoding, callback) {
        outboundBytes += chunk.length
        if (outboundBytes === chunk.length) record('wire-first-byte', { ...row, bytes: outboundBytes })
        callback(null, chunk)
      } })
      response.once('end', () => { responseEnded = true; end('wire-end') })
      response.once('aborted', () => { end('wire-cancel'); upstream.destroy(); outgoing.destroy() })
      response.once('error', () => { end('wire-error'); upstream.destroy(); outgoing.destroy() })
      response.pipe(meter).pipe(outgoing)
    })
    upstream.once('error', () => {
      end(closed || incoming.aborted ? 'wire-cancel' : 'wire-error')
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end()
    })
    // `IncomingMessage.close` also fires after a normal request upload. Only
    // `aborted` or an unfinished downstream response is a cancellation.
    incoming.once('aborted', () => { end('wire-cancel'); upstream.destroy(); outgoing.destroy() })
    outgoing.once('close', () => {
      if (!responseEnded && !finished) { end('wire-cancel'); upstreamResponse?.destroy(); upstream.destroy() }
    })
    const requestMeter = new Transform({ transform(chunk, _encoding, callback) {
      inboundBytes += chunk.length
      callback(null, chunk)
    } })
    incoming.pipe(requestMeter).pipe(upstream)
  })
  server.on('connection', (socket) => {
    if (closed || clients.size >= maxSockets) { socket.destroy(); return }
    clients.add(socket)
    socket.once('close', () => clients.delete(socket))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  return { baseUrl: `http://127.0.0.1:${address.port}${prefix}/v1`,
    status() { return { closed, active: active.size, clients: clients.size, upstreams: upstreams.size } },
    async close() {
      if (closed) return
      closed = true
      for (const row of active.values()) record('wire-cancel', row)
      active.clear()
      for (const upstream of upstreams) upstream.destroy()
      for (const client of clients) client.destroy()
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.() })
      recorder.close?.()
    } }
}
