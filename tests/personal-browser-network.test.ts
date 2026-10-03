import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer, request } from 'node:http'
import { connect as connectSocket, createServer as createTcpServer } from 'node:net'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { canonicalPublicUrl, createPinnedProxy, isPublicAddress } from '../src/personal-browser/network.mjs'
import { resolveViaCloudflareDoh } from '../src/personal-browser/doh.mjs'

const synthetic = (port: number) => ({ hostnameSuffix: '.weftmate.invalid', allowedPort: port })

test('public target parser and IP classifier deny local, reserved and rebinding forms', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '192.0.0.8', '192.0.2.2', '203.0.113.10', '::1', 'fc00::1', '2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, address)
  }
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('192.0.32.8'), true)
  assert.equal(isPublicAddress('192.0.33.8'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
  for (const url of ['http://127.0.0.1/', 'http://0x7f000001/', 'http://localhost/', 'http://intranet/',
    'http://secret.local/', 'file:///C:/secret.txt', 'http://user:pass@example.com/',
    'http://public.example.com:18186/']) {
    assert.throws(() => canonicalPublicUrl(url))
  }
  assert.equal(canonicalPublicUrl('https://www.openai.com/docs#intro'), 'https://www.openai.com/docs')
})

test('late DNS after proxy close cannot open a new upstream connection', async () => {
  let hits = 0
  const fixture = createServer((_request, response) => { hits++; response.end('unexpected') })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const fixturePort = (fixture.address() as any).port as number
  let release!: (value: object[]) => void
  const dns = new Promise<object[]>((resolve) => { release = resolve })
  let started!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  const proxy = createPinnedProxy({ syntheticFixture: synthetic(fixturePort),
    resolver: () => { started(); return dns } })
  const { port } = await proxy.start()
  const pending = new Promise<void>((resolve) => {
    const req = request({ hostname: '127.0.0.1', port,
      path: `http://owned.weftmate.invalid:${fixturePort}/late`, method: 'GET' }, (response) => {
      response.resume(); response.on('end', resolve)
    })
    req.on('error', () => resolve()); req.end()
  })
  await entered
  const closing = proxy.close()
  release([{ address: '127.0.0.1', family: 4 }])
  await Promise.all([closing, pending])
  assert.equal(hits, 0)
  await new Promise<void>((resolve) => fixture.close(() => resolve()))
})

test('closing during system Fake-IP resolution prevents starting the DoH fallback', async () => {
  let release!: (value: object[]) => void
  const pendingDns = new Promise<object[]>((resolve) => { release = resolve })
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  let dohCalls = 0
  const proxy = createPinnedProxy({ resolver: () => { entered(); return pendingDns },
    dohResolver: async () => { dohCalls++; return [{ address: '104.18.16.205', family: 4 }] } })
  const { port } = await proxy.start()
  const pendingRequest = new Promise<void>((resolve) => {
    const req = request({ hostname: '127.0.0.1', port,
      path: 'http://www.electronjs.org/docs/latest/api/session', method: 'GET' }, (response) => {
      response.resume(); response.on('end', resolve)
    })
    req.on('error', () => resolve()); req.end()
  })
  await started
  const closing = proxy.close()
  release([{ address: '198.18.0.146', family: 4 }])
  await Promise.all([closing, pendingRequest])
  assert.equal(dohCalls, 0)
})

test('idle proxy clients are bounded before they send a request', async () => {
  const proxy = createPinnedProxy()
  const { port } = await proxy.start()
  const clients = Array.from({ length: 24 }, () => {
    const socket = connectSocket({ host: '127.0.0.1', port })
    socket.on('error', () => {})
    return socket
  })
  try {
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(proxy.violation, 'BROWSER_NETWORK_LIMIT')
  } finally {
    for (const socket of clients) socket.destroy()
    await proxy.close()
  }
})

test('HTTPS CONNECT uses the reviewed address through the tunnel without a direct fallback', async () => {
  const fixture = createTcpServer((socket) => socket.on('data', (bytes) => socket.write(bytes.toString() === 'ping' ? 'pong' : 'unexpected')))
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const fixturePort = (fixture.address() as any).port as number
  const targets: object[] = []
  const proxy = createPinnedProxy({ resolver: async () => [{ address: '8.8.8.8', family: 4 }],
    connect: (options: object) => { targets.push(options)
      return connectSocket({ host: '127.0.0.1', port: fixturePort }) } })
  const { port } = await proxy.start()
  const client = connectSocket({ host: '127.0.0.1', port })
  let received = ''
  try {
    await new Promise<void>((resolve, reject) => {
      client.on('data', (chunk) => {
        received += chunk.toString()
        if (received.includes('200 Connection Established') && !received.includes('pong')) client.write('ping')
        if (received.includes('pong')) resolve()
      })
      client.once('error', reject)
      client.once('connect', () => client.write('CONNECT public-domain.com:443 HTTP/1.1\r\nHost: public-domain.com:443\r\n\r\n'))
    })
    assert.deepEqual(targets, [{ host: '8.8.8.8', family: 4, port: 443 }])
    assert.equal(proxy.violation, null)
  } finally {
    client.destroy(); await proxy.close(); await new Promise<void>((resolve) => fixture.close(() => resolve()))
  }
})

test('Fake-IP answers alone use fixed DoH then connect to the reviewed public address', async () => {
  const fixture = createTcpServer((socket) => socket.on('data', (bytes) => socket.write(bytes.toString() === 'ping' ? 'pong' : 'unexpected')))
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const fixturePort = (fixture.address() as any).port as number
  const dohCalls: string[] = [], targets: object[] = []
  const proxy = createPinnedProxy({ resolver: async () => [{ address: '198.18.0.146', family: 4 }],
    dohResolver: async (hostname: string) => { dohCalls.push(hostname)
      return [{ address: '104.18.16.205', family: 4 }] },
    connect: (options: object) => { targets.push(options)
      return connectSocket({ host: '127.0.0.1', port: fixturePort }) } })
  const { port } = await proxy.start()
  const client = connectSocket({ host: '127.0.0.1', port })
  let received = ''
  try {
    await new Promise<void>((resolve, reject) => {
      client.on('data', (chunk) => {
        received += chunk.toString()
        if (received.includes('200 Connection Established') && !received.includes('pong')) client.write('ping')
        if (received.includes('pong')) resolve()
      })
      client.once('error', reject)
      client.once('connect', () => client.write('CONNECT www.electronjs.org:443 HTTP/1.1\r\nHost: www.electronjs.org:443\r\n\r\n'))
    })
    assert.deepEqual(dohCalls, ['www.electronjs.org'])
    assert.deepEqual(targets, [{ host: '104.18.16.205', family: 4, port: 443 }])
    assert.equal(proxy.selectedAddress, '104.18.16.205')
  } finally { client.destroy(); await proxy.close(); await new Promise<void>((resolve) => fixture.close(() => resolve())) }
})

test('mixed Fake-IP/private answers never invoke DoH fallback', async () => {
  let dohCalls = 0
  const proxy = createPinnedProxy({ resolver: async () => [
    { address: '198.18.0.146', family: 4 }, { address: '127.0.0.1', family: 4 }],
  dohResolver: async () => { dohCalls++; return [{ address: '104.18.16.205', family: 4 }] } })
  const { port } = await proxy.start()
  try {
    const response = await new Promise<number>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port,
        path: 'http://www.electronjs.org/docs/latest/api/session', method: 'GET' },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)) })
      req.on('error', reject); req.end()
    })
    assert.equal(response, 403)
    assert.equal(dohCalls, 0)
  } finally { await proxy.close() }
})

test('DoH JSON accepts only matching public A/AAAA answers within 64KiB', async () => {
  const reply = (type: number, answers: object[], extra: object = {}) => JSON.stringify({
    Status: 0, TC: false, Question: [{ name: 'www.electronjs.org', type }], Answer: answers, ...extra,
  })
  const mock = (provide: (options: any) => { status?: number; body: string; contentType?: string }) =>
    (options: any, callback: (response: any) => void) => {
      assert.equal(options.hostname, '1.1.1.1')
      assert.equal(options.port, 443)
      assert.equal(options.servername, 'cloudflare-dns.com')
      assert.equal(options.headers.host, 'cloudflare-dns.com')
      assert.equal(options.headers.accept, 'application/dns-json')
      assert.equal(options.rejectUnauthorized, true)
      assert.equal(options.agent, false)
      assert.equal(typeof options.checkServerIdentity, 'function')
      const req: any = new EventEmitter()
      req.end = () => queueMicrotask(() => {
        const value = provide(options)
        const response: any = new PassThrough()
        response.statusCode = value.status ?? 200
        response.headers = { 'content-type': value.contentType ?? 'application/dns-json' }
        callback(response)
        response.end(value.body)
      })
      req.destroy = (error: Error) => req.emit('error', error)
      return req
    }
  const publicRequest = mock((options) => options.path.endsWith('type=A')
    ? { body: reply(1, [{ type: 5, name: 'www.electronjs.org', data: 'edge.cdn.example' },
      { type: 1, name: 'edge.cdn.example', data: '104.18.16.205' }]) }
    : { body: reply(28, [{ type: 28, name: 'www.electronjs.org', data: '2606:4700::1111' }]) })
  assert.deepEqual(await resolveViaCloudflareDoh('www.electronjs.org', { requestImpl: publicRequest }), [
    { address: '104.18.16.205', family: 4 }, { address: '2606:4700::1111', family: 6 },
  ])
  for (const bad of [
    mock((options) => ({ body: reply(options.path.endsWith('type=A') ? 1 : 28,
      [{ type: 1, name: 'www.electronjs.org', data: '127.0.0.1' }]) })),
    mock((options) => ({ body: reply(options.path.endsWith('type=A') ? 1 : 28,
      [{ type: 1, name: 'unrelated.example', data: '104.18.16.205' }]) })),
    mock((options) => ({ body: reply(options.path.endsWith('type=A') ? 1 : 28,
      [{ type: 1, name: 'www.electronjs.org', data: '104.18.16.205' }],
      { Question: [{ name: 'other.example', type: options.path.endsWith('type=A') ? 1 : 28 }] }) })),
    mock((options) => ({ body: reply(options.path.endsWith('type=A') ? 1 : 28,
      [{ type: 1, name: 'www.electronjs.org', data: '104.18.16.205' }]) + ' '.repeat(40_000) })),
    mock(() => ({ status: 302, body: '{}' })),
  ]) {
    await assert.rejects(resolveViaCloudflareDoh('www.electronjs.org', { requestImpl: bad }),
      (error: { code?: string }) => ['BROWSER_DNS_ERROR', 'BROWSER_TARGET_BLOCKED'].includes(error.code ?? ''))
  }
})

test('pinned proxy reaches only the reviewed synthetic host and refuses mixed DNS answers', async () => {
  const fixture = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end(`fixture:${request.headers.host}`)
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const fixturePort = (fixture.address() as any).port as number
  const resolverCalls: string[] = []
  const proxy = createPinnedProxy({ syntheticFixture: synthetic(fixturePort),
    resolver: async (hostname: string) => {
      resolverCalls.push(hostname)
      return hostname === 'owned.weftmate.invalid'
        ? [{ address: '127.0.0.1', family: 4 }]
        : [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]
    } })
  const { port } = await proxy.start()
  const through = (url: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: url, method: 'GET' }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode!, body }))
    })
    req.on('error', reject); req.end()
  })
  try {
    const allowed = await through(`http://owned.weftmate.invalid:${fixturePort}/page`)
    assert.equal(allowed.status, 200)
    assert.match(allowed.body, /owned\.weftmate\.invalid/)
    const blocked = await through('http://rebind.public-domain.com/')
    assert.equal(blocked.status, 403)
    assert.equal(proxy.violation, 'BROWSER_TARGET_BLOCKED')
    assert.deepEqual(resolverCalls, ['owned.weftmate.invalid', 'rebind.public-domain.com'])
    assert.equal((await through('http://127.0.0.1/')).status, 403)
  } finally { await proxy.close(); await new Promise<void>((resolve) => fixture.close(() => resolve())) }
})
