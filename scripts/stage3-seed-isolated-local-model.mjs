#!/usr/bin/env electron
/**
 * Stage 3 packaged QA helper.
 *
 * It is intentionally outside electron-builder's files allow-list. The live
 * local-model credential exists only in the helper/Electron process and the
 * target safeStorage ciphertext; stdout contains structural proof only.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { app, safeStorage } from 'electron'

const execFileAsync = promisify(execFile)
const profileId = 'stage3-local-qwen'
const baseUrl = 'http://127.0.0.1:8080/v1'

function option(name) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? '' : process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error('isolated userData is required')
  return value
}

function assertIsolatedUserData(value) {
  const target = resolve(value)
  if (!/[\\/]WeftMate[\\/]Runtime[\\/]Stage3[\\/]data[\\/][^\\/]+$/i.test(target)) {
    throw new Error('userData is outside the Stage 3 isolated data root')
  }
  return target
}

function assertIsolatedResultFile(value) {
  const target = resolve(value)
  if (!/[\\/]WeftMate[\\/]Runtime[\\/]Stage3[\\/]evidence[\\/][^\\/]+[\\/][^\\/]+\.json$/i.test(target)) {
    throw new Error('result file is outside the Stage 3 isolated evidence root')
  }
  return target
}

async function readCurrentLocalServiceKey() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$items = @(Get-CimInstance Win32_Process -Filter \"Name = 'llama-server.exe'\" | Where-Object { $_.CommandLine -match '--api[-_]key' })",
    'if ($items.Count -ne 1) { exit 41 }',
    "$match = [regex]::Match($items[0].CommandLine, '(?i)--api[-_]key\\s+(?:\\\"(?<key>[^\\\"]+)\\\"|(?<key>[^\\s]+))')",
    'if (!$match.Success) { exit 42 }',
    "[Console]::Out.Write($match.Groups['key'].Value)",
  ].join('; ')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    maxBuffer: 8 * 1024,
    timeout: 10_000,
  })
  const key = String(stdout).trim()
  if (!key || key.length > 4096) throw new Error('local credential unavailable')
  return key
}

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error('local model request failed')
  return response.json()
}

const userData = assertIsolatedUserData(option('--user-data-dir'))
const resultFile = assertIsolatedResultFile(option('--result-file'))
app.setPath('userData', userData)
writeFileSync(resultFile, `${JSON.stringify({ seeded: false, phase: 'electron-started' }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })

async function run() {
  let exitCode = 0
  try {
  writeFileSync(resultFile, `${JSON.stringify({ seeded: false, phase: 'electron-ready' }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
  const apiKey = await readCurrentLocalServiceKey()
  const authorization = { authorization: `Bearer ${apiKey}` }
  const models = await fetchJson(`${baseUrl}/models`, { headers: authorization })
  const ids = Array.isArray(models?.data)
    ? models.data.map((item) => typeof item?.id === 'string' ? item.id.trim() : '').filter(Boolean)
    : []
  const model = ids.includes('qwen3.8-27b-u') ? 'qwen3.8-27b-u' : ids.length === 1 ? ids[0] : ''
  if (!model) throw new Error('local model identity is ambiguous')
  const completion = await fetchJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with exactly LOCAL_STAGE3_OK' }], temperature: 0, max_tokens: 64 }),
  })
  const choice = completion?.choices?.[0]
  if (choice?.finish_reason !== 'stop' || !String(choice?.message?.content ?? '').includes('LOCAL_STAGE3_OK')) {
    throw new Error('local model completion did not finish cleanly')
  }

  const configStore = await import('../src/config-store.ts')
  const settings = await import('../src/settings.ts')
  configStore.saveCredential(profileId, apiKey)
  settings.upsertModelProfile({
    id: profileId,
    name: '本机 Qwen',
    provider: 'openai-compatible',
    baseUrl,
    model,
    reasoningEffort: 'off',
  })
  settings.setActiveModelProfile(profileId)
  if (configStore.getCredential(profileId) !== apiKey) throw new Error('safeStorage round trip failed')
    writeFileSync(resultFile, `${JSON.stringify({ seeded: true, safeStorage: true, modelCompletion: 'stop', profileId, model }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    exitCode = 1
    writeFileSync(resultFile, `${JSON.stringify({ seeded: false, error: 'isolated local-model QA failed' }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  } finally {
    app.exit(exitCode)
  }
}

app.whenReady().then(run).catch(() => {
  writeFileSync(resultFile, `${JSON.stringify({ seeded: false, error: 'isolated local-model QA failed' }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  app.exit(1)
})
