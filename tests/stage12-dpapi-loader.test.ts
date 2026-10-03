import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import test from 'node:test'
import { decryptStage12Dpapi, STAGE12_DPAPI_DECODE_SCRIPT,
  stage12SystemModulePath } from './integration/stage12-dpapi-loader.mjs'

test('the exact Node-spawned encoded PowerShell pipe decodes only a synthetic DPAPI value',
  { skip: process.platform !== 'win32' }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-stage12-dpapi-smoke-'))
    const file = join(root, 'synthetic.dpapi')
    try {
      const script = "Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; $secure=ConvertTo-SecureString 'synthetic-stage12-only' -AsPlainText -Force; " +
        '$cipher=ConvertFrom-SecureString $secure; ' +
        '[System.IO.File]::WriteAllText($env:STAGE12_SYNTHETIC_DPAPI_PATH,$cipher,[System.Text.Encoding]::UTF8)'
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env,
          PSModulePath: stage12SystemModulePath(), STAGE12_SYNTHETIC_DPAPI_PATH: file },
      })
      let createError = ''
      child.stderr.on('data', (part) => { createError += String(part) })
      const exit = await new Promise<number | null>((resolve) => child.once('close', resolve))
      assert.equal(exit, 0, `Synthetic creation stderr: ${createError.slice(0, 2000)}`)
      assert.equal(existsSync(file), true, 'Synthetic cipher file was not created')
      assert.ok(statSync(file).size > 0, 'Synthetic cipher is empty')
      const cipher = readFileSync(file, 'utf8').trim()
      assert.equal(/^[0-9a-f]+$/i.test(cipher), true,
        `Synthetic cipher shape invalid, length=${cipher.length}; stderr=${createError.slice(0, 2000)}`)
      const probe = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from('[Console]::Out.Write([int](Test-Path -LiteralPath $env:WEFTMATE_STAGE12_MIMO_DPAPI_PATH))',
          'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, PSModulePath: stage12SystemModulePath(), WEFTMATE_STAGE12_MIMO_DPAPI_PATH: file } })
      let exists = ''
      probe.stdout.on('data', (part) => { exists += String(part) })
      await new Promise((resolve) => probe.once('close', resolve))
      assert.equal(exists, '1', 'Node-spawned PowerShell did not see the synthetic path')
      const decoded = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(STAGE12_DPAPI_DECODE_SCRIPT, 'utf16le').toString('base64')], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PSModulePath: stage12SystemModulePath(),
          WEFTMATE_STAGE12_MIMO_DPAPI_PATH: file },
      })
      let out = '', err = ''
      decoded.stdout.on('data', (part) => { out += String(part) })
      decoded.stderr.on('data', (part) => { err += String(part) })
      const decodeExit = await new Promise<number | null>((resolve) => decoded.once('close', resolve))
      assert.equal(decodeExit, 0, `Synthetic decode stderr: ${err.slice(0, 800)}`)
      assert.equal(out, 'synthetic-stage12-only', `Synthetic decode stderr: ${err.slice(0, 800)}`)
      assert.equal(await decryptStage12Dpapi(file), 'synthetic-stage12-only')
    } finally {
      if (realpathSync(root).startsWith(realpathSync(tmpdir()) + sep))
        rmSync(root, { recursive: true, force: true })
    }
  })
