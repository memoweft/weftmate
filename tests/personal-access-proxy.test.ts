import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const PUBLIC_ORIGIN = 'https://home.weftmate.com:8443'
const PUBLIC_HOST = 'home.weftmate.com:8443'
const PASSWORD = 'synthetic proxy password 123'
const enabled = process.env.WEFTMATE_TLS_PROXY_TEST === '1'

const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [],
  preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }: { sessionId: string }) => ({ sessionId }),
  sendMessage: async () => ({ accepted: false }),
  cancelSession: async () => ({ accepted: false }),
  readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
  describeSession: async () => null,
}

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

function strictProxyRequest(port: number, method: string, pathname: string, options: {
  body?: object; cookie?: string; csrf?: string; origin?: string;
} = {}) {
  return new Promise<{ status: number; body: any; cookie: string | null; verified: boolean }>((resolve, reject) => {
    const content = options.body ? JSON.stringify(options.body) : undefined
    const headers: Record<string, string> = { Host: PUBLIC_HOST }
    if (content) headers['content-type'] = 'application/json'
    if (options.cookie) headers.cookie = options.cookie
    if (options.csrf) headers['X-WeftMate-CSRF'] = options.csrf
    if (options.origin) headers.Origin = options.origin
    const request = httpsRequest(`https://home.weftmate.com:${port}${pathname}`, {
      method, servername: 'home.weftmate.com', rejectUnauthorized: true, headers,
      lookup: (_host, settings: { all?: boolean }, callback: (...args: any[]) => void) => {
        if (settings.all) callback(null, [{ address: '127.0.0.1', family: 4 }])
        else callback(null, '127.0.0.1', 4)
      },
      timeout: 10_000,
    }, (response) => {
      const verified = response.socket.authorized === true
      const parts: Buffer[] = []
      response.on('data', (part) => parts.push(part))
      response.on('end', () => {
        try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(parts).toString('utf8')),
          cookie: response.headers['set-cookie']?.[0] ?? null, verified }) }
        catch (error) { reject(error) }
      })
    })
    request.on('timeout', () => request.destroy(new Error('TLS proxy request timed out')))
    request.on('error', reject)
    request.end(content)
  })
}

test('real local Caddy preserves strict HTTPS owner authentication and keeps setup local',
  { skip: enabled ? false : 'Set WEFTMATE_TLS_PROXY_TEST=1 with explicit Caddy/certificate paths to run this non-default integration test', timeout: 90_000 },
  async () => {
    const caddy = process.env.WEFTMATE_TLS_CADDY_BIN
    const cert = process.env.WEFTMATE_TLS_CERT_PATH
    const key = process.env.WEFTMATE_TLS_KEY_PATH
    assert.ok(caddy && existsSync(caddy), 'explicit Caddy executable is required')
    assert.ok(cert && existsSync(cert), 'explicit public certificate path is required')
    assert.ok(key && existsSync(key), 'explicit private key path is required')
    const root = mkdtempSync(join(tmpdir(), 'weftmate-tls-proxy-'))
    const service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend,
      allowedOrigins: [PUBLIC_ORIGIN], trustedProxy: true })
    let child: ChildProcess | null = null
    try {
      const { origin } = await service.start()
      const upstream = new URL(origin)
      const port = await freePort()
      const config = join(root, 'Caddyfile.test')
      writeFileSync(config, `{
  admin off
  auto_https off
}
https://:${port} {
  bind 127.0.0.1
  tls ${cert} ${key}
  reverse_proxy 127.0.0.1:${upstream.port}
}
`)
      child = spawn(caddy, ['run', '--config', config, '--adapter', 'caddyfile'], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      })
      let caddyOutput = ''
      child.stdout?.on('data', (part) => { caddyOutput += String(part).slice(-500) })
      child.stderr?.on('data', (part) => { caddyOutput += String(part).slice(-500) })
      let ready = false
      for (let attempt = 0; attempt < 40; attempt++) {
        if (child.exitCode !== null) throw new Error(`temporary Caddy exited early (${child.exitCode}): ${caddyOutput.slice(-900)}`)
        try {
          const state = await strictProxyRequest(port, 'GET', '/personal/v1/auth/state')
          assert.equal(state.verified, true, 'TLS certificate validation must remain enabled')
          assert.equal(state.status, 200)
          ready = true
          break
        } catch (error) {
          if (attempt === 39) throw error
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
      assert.equal(ready, true)
      assert.equal((await strictProxyRequest(port, 'GET', '/personal/v1/status')).status, 401)

      const grant = await service.issueSetupGrant()
      const setupBody = { grant: grant.grant, username: 'synthetic-proxy-owner', password: PASSWORD, deviceName: 'local-fixture' }
      const rejectedSetup = await strictProxyRequest(port, 'POST', '/personal/v1/auth/setup', { body: setupBody, origin: PUBLIC_ORIGIN })
      assert.equal(rejectedSetup.status, 403, 'first setup must not be accepted through the proxy')
      const localSetup = await fetch(`${origin}/personal/v1/auth/setup`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(setupBody),
      })
      assert.equal(localSetup.status, 201)
      const login = await strictProxyRequest(port, 'POST', '/personal/v1/auth/login', {
        body: { username: 'synthetic-proxy-owner', password: PASSWORD, deviceName: 'remote-fixture' }, origin: PUBLIC_ORIGIN,
      })
      assert.equal(login.status, 200)
      assert.equal(login.verified, true)
      assert.match(login.cookie ?? '', /^wm_personal_session=/)
      assert.match(login.cookie ?? '', /; Secure(?:;|$)/)
      assert.match(login.cookie ?? '', /; HttpOnly(?:;|$)/)
      const browserCookie = (login.cookie ?? '').split(';')[0]
      const me = await strictProxyRequest(port, 'GET', '/personal/v1/auth/me', { cookie: browserCookie })
      assert.equal(me.status, 200)
      assert.equal(me.body.account.username, 'synthetic-proxy-owner')
      const crossOrigin = await strictProxyRequest(port, 'POST', '/personal/v1/auth/logout', {
        cookie: browserCookie, csrf: login.body.csrfToken, origin: 'https://other.example',
      })
      assert.equal(crossOrigin.status, 403)
      const logout = await strictProxyRequest(port, 'POST', '/personal/v1/auth/logout', {
        cookie: browserCookie, csrf: login.body.csrfToken, origin: PUBLIC_ORIGIN,
      })
      assert.equal(logout.status, 200)
      assert.equal((await strictProxyRequest(port, 'GET', '/personal/v1/auth/me', { cookie: browserCookie })).status, 401)
    } finally {
      try { await service.close() } finally {
        if (child && child.exitCode === null && child.pid) {
          const exited = new Promise<void>((resolve) => child!.once('close', () => resolve()))
          child.kill('SIGTERM')
          const done = await Promise.race([exited.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000))])
          if (!done && child.pid) {
            if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
            else child.kill('SIGKILL')
            await exited
          }
        }
        if (dirname(realpathSync(root)) === realpathSync(tmpdir())) rmSync(root, { recursive: true, force: true })
      }
    }
  })
