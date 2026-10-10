import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { desktopHtml } from './helpers/desktop-ui-source.mjs'

const repository = fileURLToPath(new URL('../', import.meta.url))
const launcher = join(repository, 'scripts', 'run-personal-host.mjs')
const username = 'synthetic-owner'
const oldPassword = 'synthetic owner password 123'
const newPassword = 'synthetic new password 456'

test('local setup, same-account devices, password rotation and logout work in the real Electron host', { timeout: 150_000 }, async () => {
  const parent = mkdtempSync(join(tmpdir(), 'weftmate-account-electron-'))
  const profile = join(parent, 'profile')
  const processes: ChildProcess[] = []
  const launch = async () => {
    const child = spawn(process.execPath, [launcher, '--user-data-dir', profile, '--access-port', '0'], {
      cwd: repository, stdio: ['pipe', 'pipe', 'pipe'],
    })
    processes.push(child)
    let output = ''
    const listeners = new Set<() => void>()
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => {
      output += String(chunk)
      for (const listener of listeners) listener()
    })
    const waitFor = (pattern: RegExp, from = 0, ms = 40_000) => new Promise<RegExpExecArray>((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`timed out: ${output.slice(-1200)}`)) }, ms)
      const check = () => {
        const match = pattern.exec(output.slice(from))
        if (!match) return
        listeners.delete(check); clearTimeout(timer); resolve(match)
      }
      listeners.add(check); check()
      child.once('close', (code) => {
        if (!listeners.has(check)) return
        listeners.delete(check); clearTimeout(timer); reject(new Error(`launcher exited ${code}: ${output.slice(-1200)}`))
      })
    })
    const match = await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/)
    return { child, origin: match[1], waitFor, output: () => output }
  }
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const closed = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('managed quit timed out')), 15_000)
      child.once('close', (code) => { clearTimeout(timer); resolve(code) })
    })
    child.stdin?.write('q\n')
    assert.equal(await closed, 0)
  }
  const command = async (host: Awaited<ReturnType<typeof launch>>, value: object, pattern: RegExp) => {
    const start = host.output().length
    host.child.stdin?.write(`${JSON.stringify(value)}\n`)
    return host.waitFor(pattern, start)
  }
  const auth = async (origin: string, path: string, options: { method?: string; cookie?: string; csrf?: string; body?: object } = {}) => {
    const headers: Record<string, string> = {}
    if (options.cookie) headers.cookie = options.cookie
    if (options.body) headers['content-type'] = 'application/json'
    if (options.method && options.method !== 'GET') headers.origin = origin
    if (options.csrf) headers['X-WeftMate-CSRF'] = options.csrf
    const response = await fetch(`${origin}/personal/v1/auth${path}`, {
      method: options.method ?? 'GET', headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
    return { status: response.status, body: await response.json(), cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] }
  }
  try {
    const first = await launch()
    const staticPage = await fetch(`${first.origin}/personal/v1/ui`)
    assert.equal(staticPage.status, 200)
    assert.match(staticPage.headers.get('content-security-policy') ?? '', /script-src 'self'/)
    assert.match(await staticPage.text(), /components\/markup.js/)
    assert.match(desktopHtml(), /登录 WeftMate/)
    assert.deepEqual(await auth(first.origin, '/state'), {
      status: 200, body: { configured: false, registrationAvailable: true }, cookie: '',
    })

    const legacyFile = join(profile, 'personal-access', 'tokens', 'legacy.token')
    const enrolled = await command(first, { action: 'device.add', name: 'legacy', tokenOutputFile: legacyFile }, /deviceId=(device-[A-Za-z0-9-]+)/)
    const legacyToken = readFileSync(legacyFile, 'utf8').trim()
    const setup = await command(first, { action: 'account.setup' }, /setupLinkFile=([^\s]+) expiresAt=/)
    const setupLink = JSON.parse(readFileSync(setup[1], 'utf8'))
    const setupUrl = new URL(setupLink.url)
    assert.equal(setupUrl.origin, first.origin)
    const grant = setupUrl.hash.slice('#setup='.length)
    assert.ok(grant)
    assert.equal(first.output().includes(grant), false)
    assert.equal(first.output().includes(oldPassword), false)
    const created = await auth(first.origin, '/setup', { method: 'POST', body: {
      grant, username, password: oldPassword, deviceName: 'browser-a',
    } })
    assert.equal(created.status, 201)
    assert.equal(created.body.account.username, username)
    assert.match(created.cookie, /^wm_personal_session=/)
    assert.ok(created.body.csrfToken)
    assert.equal((await fetch(`${first.origin}/personal/v1/status`, {
      headers: { authorization: `Bearer ${legacyToken}` },
    })).status, 401)
    const meA = await auth(first.origin, '/me', { cookie: created.cookie })
    assert.equal(meA.status, 200)
    assert.equal(meA.body.device.id, created.body.device.id)
    const capabilities = await (await fetch(`${first.origin}/personal/v1/status`, {
      headers: { cookie: created.cookie },
    })).json()
    assert.equal(capabilities.backend.capabilities.chat.available, false, 'blank profile has no usable model yet')
    assert.equal(capabilities.backend.capabilities.desktopOpenApp.available, process.platform === 'win32',
      'the Windows-only Notepad capability must be available on Windows and explicitly unavailable elsewhere')
    assert.deepEqual(capabilities.backend.capabilities.desktopOpenApp.appIds, process.platform === 'win32' ? ['notepad'] : [])
    if (process.platform !== 'win32') assert.equal(capabilities.backend.capabilities.desktopOpenApp.reasonCode, 'CAPABILITY_UNAVAILABLE')

    const second = await auth(first.origin, '/login', { method: 'POST', body: {
      username, password: oldPassword, deviceName: 'browser-b',
    } })
    assert.equal(second.status, 200)
    assert.notEqual(second.body.device.id, created.body.device.id)
    const listed = await auth(first.origin, '/devices', { cookie: created.cookie })
    assert.equal(listed.status, 200)
    assert.equal(listed.body.devices.some((device: { id: string; current: boolean }) => device.id === created.body.device.id && device.current), true)
    assert.equal(listed.body.devices.some((device: { id: string; current: boolean }) => device.id === second.body.device.id && !device.current), true)
    assert.equal(listed.body.devices.some((device: { id: string; revoked: boolean }) => device.id === enrolled[1] && device.revoked), true)

    const revoked = await auth(first.origin, `/devices/${second.body.device.id}`, {
      method: 'DELETE', cookie: created.cookie, csrf: created.body.csrfToken,
    })
    assert.equal(revoked.status, 200)
    assert.equal((await auth(first.origin, '/me', { cookie: second.cookie })).status, 401)
    const changed = await auth(first.origin, '/change-password', { method: 'POST', cookie: created.cookie,
      csrf: created.body.csrfToken, body: { currentPassword: oldPassword, newPassword } })
    assert.equal(changed.status, 200)
    assert.match(changed.cookie, /^wm_personal_session=/)
    assert.equal((await auth(first.origin, '/me', { cookie: created.cookie })).status, 401)
    assert.equal((await auth(first.origin, '/me', { cookie: changed.cookie })).status, 200)
    assert.equal((await auth(first.origin, '/login', { method: 'POST', body: { username, password: oldPassword, deviceName: 'old-password' } })).status, 401)
    const loggedOut = await auth(first.origin, '/logout', { method: 'POST', cookie: changed.cookie, csrf: changed.body.csrfToken })
    assert.equal(loggedOut.status, 200)
    assert.equal((await auth(first.origin, '/me', { cookie: changed.cookie })).status, 401)
    await command(first, { action: 'account.setup' }, /management failed code=ACCOUNT_ALREADY_CONFIGURED/)
    assert.equal(first.output().includes(newPassword), false)
    const stored = readFileSync(join(profile, 'personal-access', 'store.json'), 'utf8')
    assert.equal(stored.includes(oldPassword) || stored.includes(newPassword) || stored.includes(legacyToken), false)
    await stop(first.child)

    const restart = await launch()
    assert.equal((await auth(restart.origin, '/state')).body.configured, true)
    const again = await auth(restart.origin, '/login', { method: 'POST', body: {
      username, password: newPassword, deviceName: 'browser-c',
    } })
    assert.equal(again.status, 200)
    assert.equal((await auth(restart.origin, '/me', { cookie: again.cookie })).status, 200)
    await stop(restart.child)
  } finally {
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) {
        try { await stop(child) } catch { /* Preserve owned fixture if a process cannot stop. */ }
      }
    }
    if (processes.every((child) => child.exitCode !== null || child.signalCode !== null)
      && existsSync(parent) && dirname(realpathSync(parent)) === realpathSync(tmpdir())) {
      rmSync(parent, { recursive: true, force: true })
    }
  }
})
