import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repository = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const launcher = join(repository, 'scripts', 'run-personal-host.mjs')

test('real rc.5 keeps a personal-remote preset on a new empty session across restart',
  { timeout: 90_000 }, async () => {
    const parent = mkdtempSync(join(tmpdir(), 'weftmate-personal-preset-'))
    const profile = join(parent, 'profile')
    const processes: ChildProcess[] = []
    const launch = async () => {
      const env = { ...process.env }
      for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY)/.test(key)) delete env[key]
      env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host'
      // This fixture exercises the real runtime API and persistence, not a
      // window. Keep native account bootstrap independent of its CLI shutdown.
      const child = spawn(process.execPath, [launcher, '--headless', '--user-data-dir', profile, '--access-port', '0'],
        { cwd: repository, env, stdio: ['pipe', 'pipe', 'pipe'] })
      processes.push(child)
      let output = ''
      const listeners = new Set<() => void>()
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => {
        output += String(chunk)
        for (const listener of listeners) listener()
      })
      const origin = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`startup timeout: ${output.slice(-500)}`)), 35_000)
        const inspect = () => {
          const match = /personal-host (?:ready|degraded) origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)
          if (!match || !output.includes('personal-access listening')) return
          listeners.delete(inspect); clearTimeout(timer); resolve(match[1])
        }
        listeners.add(inspect); inspect()
        child.once('close', (code) => {
          if (!listeners.has(inspect)) return
          listeners.delete(inspect); clearTimeout(timer); reject(new Error(`exit ${code}: ${output.slice(-800)}`))
        })
      })
      return { child, origin, output: () => output }
    }
    const stop = async (child: ChildProcess) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const done = new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('owned host did not quit')), 15_000)
        child.once('close', (code) => { clearTimeout(timer); resolve(code) })
      })
      child.stdin?.write('q\n')
      assert.equal(await done, 0)
    }
    try {
      const first = await launch()
      const sessionId = `session-${randomUUID()}`
      const created = await fetch(`${first.origin}/weftmate/api/v1/sessions`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, agentPreset: 'personal-remote' }) })
      assert.equal(created.status, 201, JSON.stringify(await created.json()) + first.output().slice(-6000))
      const list = await (await fetch(`${first.origin}/weftmate/api/v1/sessions`)).json()
      assert.equal(list.items.find((item: { sessionId: string }) => item.sessionId === sessionId)?.agentPreset,
        'personal-remote')
      await new Promise((resolve) => setTimeout(resolve, 800)) // rc.5 empty-session persistence is asynchronous.
      await stop(first.child)
      const second = await launch()
      const resumed = await (await fetch(`${second.origin}/weftmate/api/v1/sessions`)).json()
      assert.equal(resumed.items.find((item: { sessionId: string }) => item.sessionId === sessionId)?.agentPreset,
        'personal-remote')
      await stop(second.child)
    } finally {
      for (const child of processes) {
        if (child.exitCode === null && child.signalCode === null) {
          try { await stop(child) } catch { /* preserve fixture if exact owned child cannot stop */ }
        }
      }
      if (processes.every((child) => child.exitCode !== null || child.signalCode !== null) &&
          dirname(realpathSync(parent)) === realpathSync(tmpdir())) rmSync(parent, { recursive: true, force: true })
    }
  })
