/** Windows desktop capability. Task authorization belongs to the calling host. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SCRIPT_PATH = fileURLToPath(new URL('./desktop.ps1', import.meta.url))
const ACTIONS = new Set(['windows', 'inspect', 'screenshot', 'click', 'invoke', 'type', 'keys', 'scroll', 'open'])
const MAX_OUTPUT_BYTES = 48 * 1024 * 1024

function failure(code, message) { return { ok: false, error: { code, message } } }
function abortError() { return new DOMException('Desktop operation cancelled.', 'AbortError') }

/** Exported factory keeps process transport independently testable without operating the desktop. */
export function createDesktopAdapter({
  spawnImpl = spawn,
  platform = process.platform,
  powershellPath = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  scriptPath = SCRIPT_PATH,
  timeoutMs = 45_000,
} = {}) {
  return async function command(input, { signal } = {}) {
    if (signal?.aborted) throw abortError()
    if (platform !== 'win32') return failure('DESKTOP_PLATFORM_UNSUPPORTED', 'Desktop automation currently requires Windows.')
    if (!input || typeof input !== 'object' || Array.isArray(input) || !ACTIONS.has(input.action)) {
      return failure('DESKTOP_INVALID_ACTION', `action must be one of ${[...ACTIONS].join(', ')}.`)
    }
    let request
    try { request = JSON.stringify(input) } catch { return failure('DESKTOP_INVALID_INPUT', 'Input must be JSON serializable.') }
    if (Buffer.byteLength(request, 'utf8') > 2 * 1024 * 1024) return failure('DESKTOP_INPUT_TOO_LARGE', 'Desktop input exceeds 2 MiB.')
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawnImpl(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
          windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch { resolve(failure('DESKTOP_EXECUTOR_UNAVAILABLE', 'Windows PowerShell could not start.')); return }
      const chunks = []
      let bytes = 0
      let diagnostic = ''
      let settled = false
      let stopReason = null
      let killWork = null
      let timer
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
      const finish = async (result) => {
        if (settled) return
        settled = true
        cleanup()
        if (killWork) await killWork
        if (stopReason === 'abort') reject(abortError())
        else resolve(stopReason === 'timeout' ? failure('DESKTOP_TIMEOUT', 'The desktop operation did not finish within its deadline.')
          : stopReason === 'output' ? failure('DESKTOP_OUTPUT_TOO_LARGE', 'Desktop output exceeded its transport limit.') : result)
      }
      // A cancellation owns this one PowerShell PID and its descendants only.
      // Resolve only after the command process closes and taskkill has settled.
      const stop = (reason) => {
        if (settled || stopReason) return
        stopReason = reason
        if (!Number.isSafeInteger(child.pid) || child.pid <= 0) { child.kill?.(); return }
        killWork = new Promise(done => {
          let killer
          try {
            killer = spawnImpl(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true, stdio: 'ignore',
            })
          } catch { child.kill?.(); done(); return }
          const fallback = () => { child.kill?.(); done() }
          killer.once('error', fallback)
          killer.once('close', code => { if (code !== 0) child.kill?.(); done() })
        })
      }
      const onAbort = () => stop('abort')
      child.stdout.on('data', chunk => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_OUTPUT_BYTES) stop('output')
        else chunks.push(Buffer.from(chunk))
      })
      child.stderr.on('data', chunk => { if (diagnostic.length < 2000) diagnostic += String(chunk).slice(0, 2000 - diagnostic.length) })
      child.stdin.on('error', () => { /* close/error below owns the final transport outcome */ })
      child.once('error', () => finish(failure('DESKTOP_EXECUTOR_UNAVAILABLE', 'Windows PowerShell could not start.')))
      child.once('close', code => {
        let result
        try {
          result = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim())
          if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') throw new Error('protocol')
        } catch {
          result = failure('DESKTOP_EXECUTOR_FAILED', `Desktop helper returned no valid result (exit ${code ?? 'unknown'}).${diagnostic ? ' ' + diagnostic.trim().slice(0, 500) : ''}`)
        }
        void finish(result)
      })
      timer = setTimeout(() => stop('timeout'), timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
      child.stdin.end(request)
    })
  }
}

/**
 * Actions: windows, inspect, screenshot, click/invoke, type, keys, scroll, open.
 * window_id is the decimal HWND returned by windows. A selector may contain
 * element_id (UIA runtime id), automation_id, name, and/or control_type; exact
 * multiple matches are rejected. Coordinates are physical screen pixels.
 */
export const desktopCommand = createDesktopAdapter()
