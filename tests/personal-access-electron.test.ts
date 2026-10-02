import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repository = fileURLToPath(new URL('../', import.meta.url))
const launcher = join(repository, 'scripts', 'run-personal-host.mjs')

test('two local devices use the same attached empty session across a real Electron restart', { timeout: 120_000 }, async () => {
  const parent = mkdtempSync(join(tmpdir(), 'weftmate-access-electron-'))
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
    const waitFor = (pattern: RegExp, from = 0, ms = 35_000) => new Promise<RegExpExecArray>((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`timed out waiting for ${pattern}: ${output.slice(-1500)}`)) }, ms)
      const check = () => {
        const match = pattern.exec(output.slice(from))
        if (!match) return
        listeners.delete(check); clearTimeout(timer); resolve(match)
      }
      listeners.add(check); check()
      child.once('close', (code) => {
        if (!listeners.has(check)) return
        listeners.delete(check); clearTimeout(timer); reject(new Error(`launcher exited ${code}: ${output.slice(-1500)}`))
      })
    })
    const access = await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/)
    const dsh = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
    assert.ok(dsh)
    return { child, access: access[1], dsh: dsh[1], waitFor, output: () => output }
  }
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const closed = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('launcher quit timed out')), 15_000)
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
  try {
    const first = await launch()
    const outside = join(parent, 'outside.token')
    await command(first, { action: 'device.add', name: 'outside', tokenOutputFile: outside }, /management failed code=INVALID_COMMAND/)
    assert.equal(existsSync(outside), false)
    const fileA = join(profile, 'personal-access', 'tokens', 'a.token')
    const fileB = join(profile, 'personal-access', 'tokens', 'b.token')
    const enrolledA = await command(first, { action: 'device.add', name: 'a', tokenOutputFile: fileA }, /deviceId=(device-[A-Za-z0-9-]+)/)
    await command(first, { action: 'device.add', name: 'b', tokenOutputFile: fileB }, /deviceId=(device-[A-Za-z0-9-]+)/)
    assert.equal(first.output().includes(readFileSync(fileA, 'utf8').trim()), false)
    const headersA = { authorization: `Bearer ${readFileSync(fileA, 'utf8').trim()}` }
    const headersB = { authorization: `Bearer ${readFileSync(fileB, 'utf8').trim()}` }
    assert.equal((await fetch(`${first.access}/personal/v1/status`)).status, 401)
    const status = await (await fetch(`${first.access}/personal/v1/status`, { headers: headersB })).json()
    assert.equal(status.backend.runtime, 'ready')
    const unknownModel = await fetch(`${first.access}/personal/v1/commands`, {
      method: 'POST', headers: { ...headersB, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'unknown-model-1', kind: 'session.create', targetDeviceId: status.hostId, modelProfileId: 'absent-model' }),
    })
    assert.equal(unknownModel.status, 422)
    assert.equal((await unknownModel.json()).error.code, 'MODEL_UNAVAILABLE')
    const created = await fetch(`${first.dsh}/weftmate/api/v1/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    assert.equal(created.status, 201)
    const { sessionId } = await created.json()
    await command(first, { action: 'session.attach', sessionId }, /attached sessionId=/)
    const listB = await (await fetch(`${first.access}/personal/v1/sessions`, { headers: headersB })).json()
    assert.equal(listB.sessions.some((session: { sessionId: string }) => session.sessionId === sessionId), true)
    const page = await (await fetch(`${first.access}/personal/v1/sessions/${sessionId}/events?afterSeq=-1&limit=100`, { headers: headersA })).json()
    assert.equal(Array.isArray(page.events), true)
    assert.equal(Number.isSafeInteger(page.nextSeq), true)
    const unknownSessionModel = await fetch(`${first.access}/personal/v1/commands`, {
      method: 'POST', headers: { ...headersB, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'unknown-session-model-1', kind: 'session.message', targetDeviceId: status.hostId,
        sessionId, text: 'synthetic request must be refused', mode: 'queue' }),
    })
    assert.equal(unknownSessionModel.status, 409)
    assert.equal((await unknownSessionModel.json()).error.code, 'SESSION_READ_ONLY')
    await command(first, { action: 'device.revoke', deviceId: enrolledA[1] }, /revoked deviceId=/)
    assert.equal((await fetch(`${first.access}/personal/v1/status`, { headers: headersA })).status, 401)
    assert.equal((await fetch(`${first.access}/personal/v1/status`, { headers: headersB })).status, 200)
    await new Promise((resolve) => setTimeout(resolve, 1_000)) // rc.5 asynchronously persists an empty session.
    await stop(first.child)

    const second = await launch()
    assert.equal((await fetch(`${second.access}/personal/v1/status`, { headers: headersA })).status, 401)
    const resumed = await (await fetch(`${second.access}/personal/v1/sessions`, { headers: headersB })).json()
    assert.equal(resumed.sessions.some((session: { sessionId: string }) => session.sessionId === sessionId), true)
    const after = await (await fetch(`${second.access}/personal/v1/sessions/${sessionId}/events?afterSeq=${page.nextSeq}&limit=100`, { headers: headersB })).json()
    assert.equal(Array.isArray(after.events), true)
    assert.equal(after.nextSeq >= page.nextSeq, true)
    await stop(second.child)
    const state = JSON.parse(readFileSync(join(profile, 'dsh-home', 'weftmate-host-state.json'), 'utf8'))
    assert.deepEqual(state.personalAccess, { enabled: true, state: 'stopped', origin: null })
  } finally {
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) {
        try { await stop(child) } catch { /* Keep the owned profile for diagnosis if the process cannot stop. */ }
      }
    }
    if (processes.every((child) => child.exitCode !== null || child.signalCode !== null)
      && existsSync(parent) && dirname(realpathSync(parent)) === realpathSync(tmpdir())) {
      rmSync(parent, { recursive: true, force: true })
    }
  }
})
