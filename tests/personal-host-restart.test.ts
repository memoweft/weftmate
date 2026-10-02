import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../src/host-mode.mjs'
import { assertSessionReferenceScanReady } from '../src/stage2-session-guards.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))
const electron = createRequire(import.meta.url)('electron') as string

test('empty no-model session survives personal-host restart with a visible failed reference scan', { timeout: 120_000 }, async () => {
  const profile = mkdtempSync(join(tmpdir(), 'weftmate-host-restart-'))
  const owned: ChildProcess[] = []
  writeFileSync(join(profile, PERSONAL_HOST_MARKER), `${JSON.stringify(PERSONAL_HOST_MARKER_CONTENT)}\n`)
  const launch = () => {
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_')) delete env[key]
    delete env.ELECTRON_RUN_AS_NODE
    Object.assign(env, { WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1', WEFTMATE_MEMOWEFT_ENABLED: '0' })
    const child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host'], {
      cwd: repository, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    owned.push(child)
    return new Promise<{ child: ChildProcess; origin: string; output: () => string }>((resolve, reject) => {
      let output = ''
      let settled = false
      const finishError = (error: Error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error) }
      const timer = setTimeout(() => finishError(new Error(`personal-host startup timed out: ${output.slice(-1500)}`)), 45_000)
      const consume = (chunk: Buffer) => {
        output += chunk.toString()
        if (settled) return
        const match = /personal-host (?:ready|degraded) origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)
        if (!match) return
        settled = true
        clearTimeout(timer)
        resolve({ child, origin: match[1], output: () => output })
      }
      child.stdout?.on('data', consume)
      child.stderr?.on('data', consume)
      child.once('error', finishError)
      child.once('close', (code) => finishError(new Error(`personal-host exited before ready (${code}): ${output.slice(-1500)}`)))
    })
  }
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('personal-host managed shutdown timed out')), 15_000)
      child.once('close', (code) => { clearTimeout(timer); resolve(code) })
    })
    child.send?.({ type: 'weftmate:quit', source: 'personal-host-restart-test' })
    assert.equal(await exited, 0)
  }
  try {
    const first = await launch()
    assert.equal(first.output().includes(`DSH_HOME = ${join(profile, 'dsh-home')}`), true)
    const created = await fetch(new URL('/weftmate/api/v1/sessions', first.origin), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    assert.equal(created.status, 201)
    const { sessionId } = await created.json() as { sessionId: string }
    assert.match(sessionId, /^session-/)
    const firstListed = await fetch(new URL('/weftmate/api/v1/sessions', first.origin))
    assert.equal(firstListed.status, 200)
    const firstRows = await firstListed.json() as { items: Array<{ sessionId: string }> }
    assert.equal(firstRows.items.some((item) => item.sessionId === sessionId), true)
    // This DSH pin can return 201 before an empty session is durable. Give its
    // asynchronous store a bounded settle period; restart is the durability proof.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await stop(first.child)

    const second = await launch()
    assert.equal(second.output().includes(`DSH_HOME = ${join(profile, 'dsh-home')}`), true)
    const state = JSON.parse(readFileSync(join(profile, 'dsh-home', 'weftmate-host-state.json'), 'utf8'))
    assert.equal(state.runtime.state, 'listening')
    assert.equal(state.runtime.origin, second.origin)

    const listed = await fetch(new URL('/weftmate/api/v1/sessions', second.origin))
    assert.equal(listed.status, 200)
    const rows = await listed.json() as { items: Array<{ sessionId: string }> }
    assert.equal(rows.items.some((item) => item.sessionId === sessionId), true, JSON.stringify({ rows, state, output: second.output() }))
    assert.deepEqual(state.referenceScan, { state: 'failed', modelRouteChangesBlocked: true })
    assert.throws(() => assertSessionReferenceScanReady({ state: state.referenceScan.state, error: null }), /暂不能修改或删除模型/)
    assert.match(second.output(), /personal-host degraded origin=/)
    const resumed = await fetch(new URL(`/weftmate/api/v1/sessions/${encodeURIComponent(sessionId)}/resume`, second.origin), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    assert.equal(resumed.ok, true)
    await stop(second.child)
    const stopped = JSON.parse(readFileSync(join(profile, 'dsh-home', 'weftmate-host-state.json'), 'utf8'))
    assert.deepEqual(stopped.runtime, { state: 'stopped', origin: null })
  } finally {
    for (const child of owned) {
      if (child.exitCode === null && child.signalCode === null) {
        try { await stop(child) } catch { /* Test failure is reported above; preserve evidence if shutdown failed. */ }
      }
    }
    if (owned.every((child) => child.exitCode !== null || child.signalCode !== null)
      && dirname(realpathSync(profile)) === realpathSync(tmpdir())) {
      rmSync(profile, { recursive: true, force: true })
    }
  }
})
