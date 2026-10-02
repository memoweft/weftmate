import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { desktopCommand, createDesktopAdapter } from '../src/runtime/weftmod/desktop.mjs'

function fakeProcess(pid = 81234) {
  const proc: any = new EventEmitter()
  proc.pid = pid
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.stdin = new PassThrough()
  proc.kill = () => { proc.emit('close', 1); return true }
  return proc
}

test('desktop unsupported platforms and unknown actions fail without starting a process', async () => {
  const noSpawn = () => { throw new Error('must not spawn') }
  const other = createDesktopAdapter({ platform: 'linux', spawnImpl: noSpawn })
  assert.equal((await other({ action: 'windows' })).error.code, 'DESKTOP_PLATFORM_UNSUPPORTED')
  const windows = createDesktopAdapter({ platform: 'win32', spawnImpl: noSpawn })
  assert.equal((await windows({ action: 'command', command: 'no' })).error.code, 'DESKTOP_INVALID_ACTION')
})

test('desktop transports literal Unicode and shell metacharacters only through stdin JSON', async () => {
  const proc = fakeProcess()
  const calls: any[] = []
  let body = ''
  proc.stdin.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
  proc.stdin.once('finish', () => {
    proc.stdout.write(JSON.stringify({ ok: true, action: 'type', characters: 21 }))
    proc.emit('close', 0)
  })
  const adapter = createDesktopAdapter({ platform: 'win32', spawnImpl: (...args: any[]) => { calls.push(args); return proc } })
  const input = { action: 'type', window_id: '42', text: '中文 日本語 "quotes" $(Get-Secret); `\n' }
  assert.equal((await adapter(input)).ok, true)
  assert.deepEqual(JSON.parse(body), input)
  assert.equal(calls[0][2].windowsHide, true)
  assert.deepEqual(calls[0][2].stdio, ['pipe', 'pipe', 'pipe'])
  assert.equal(calls[0][1].includes(input.text), false)
  assert.equal(calls[0][1].includes('-Command'), false)
})

test('desktop propagates helper failures and rejects broken output explicitly', async () => {
  for (const [output, expected] of [
    [JSON.stringify({ ok: false, error: { code: 'DESKTOP_CONTROL_NOT_FOUND', message: 'Inspect again.' } }), 'DESKTOP_CONTROL_NOT_FOUND'],
    ['PowerShell startup failed', 'DESKTOP_EXECUTOR_FAILED'],
  ]) {
    const proc = fakeProcess()
    proc.stdin.once('finish', () => { proc.stdout.end(output); proc.emit('close', 1) })
    const adapter = createDesktopAdapter({ platform: 'win32', spawnImpl: () => proc })
    assert.equal((await adapter({ action: 'inspect', window_id: '42' })).error.code, expected)
  }
})

test('desktop cancellation kills only its owned process tree and waits for termination', async () => {
  const proc = fakeProcess(12345)
  const killer = fakeProcess(12346)
  const calls: any[] = []
  const controller = new AbortController()
  const adapter = createDesktopAdapter({ platform: 'win32', spawnImpl: (...args: any[]) => { calls.push(args); return calls.length === 1 ? proc : killer } })
  const task = adapter({ action: 'inspect', window_id: '42' }, { signal: controller.signal })
  let settled = false
  const outcome = assert.rejects(task, { name: 'AbortError' }).then(() => { settled = true })
  controller.abort()
  assert.deepEqual(calls[1][1], ['/PID', '12345', '/T', '/F'])
  assert.equal(calls[1][2].windowsHide, true)
  proc.emit('close', 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  killer.emit('close', 0)
  await outcome
})

test('desktop aborted-before-start launches nothing', async () => {
  const adapter = createDesktopAdapter({ platform: 'win32', spawnImpl: () => { throw new Error('must not spawn') } })
  await assert.rejects(adapter({ action: 'windows' }, { signal: AbortSignal.abort() }), { name: 'AbortError' })
})

test('desktop deadline stops its process and reports timeout', async () => {
  const proc = fakeProcess()
  const killer = fakeProcess()
  let count = 0
  const adapter = createDesktopAdapter({ platform: 'win32', timeoutMs: 10, spawnImpl: () => {
    if (++count === 1) return proc
    queueMicrotask(() => { proc.emit('close', 1); killer.emit('close', 0) })
    return killer
  } })
  assert.equal((await adapter({ action: 'windows' })).error.code, 'DESKTOP_TIMEOUT')
})

test('live Windows: inspect, type, invoke and screenshot only a newly created WinForms fixture', {
  skip: process.platform !== 'win32' || process.env.WEFTMOD_DESKTOP_LIVE !== '1', timeout: 120_000,
}, async t => {
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const title = 'WeftMod fixture ' + randomUUID()
  const source = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FixtureWindow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command); }'
$form=New-Object System.Windows.Forms.Form
$form.Text='${title}'
$form.Width=460; $form.Height=240; $form.StartPosition='CenterScreen'
$field=New-Object System.Windows.Forms.TextBox
$field.Name='TaskText'; $field.AccessibleName='Task input'; $field.Left=24; $field.Top=24; $field.Width=380
$button=New-Object System.Windows.Forms.Button
$button.Name='ApplyButton'; $button.Text='Apply'; $button.Left=24; $button.Top=64
$label=New-Object System.Windows.Forms.Label
$label.Name='ResultLabel'; $label.Text='Waiting'; $label.Left=24; $label.Top=110; $label.Width=380
$field.Add_KeyDown({param($sender,$eventArgs);$label.Text='Key: '+$eventArgs.KeyCode+' '+$eventArgs.Modifiers})
$button.Add_Click({$label.Text='Accepted: '+$field.Text})
$form.Controls.AddRange(@($field,$button,$label))
$form.Add_Shown({[void][FixtureWindow]::ShowWindow($form.Handle,5);[Console]::Out.WriteLine((@{window_id=[string]$form.Handle.ToInt64();process_id=$PID}|ConvertTo-Json -Compress));[Console]::Out.Flush()})
[System.Windows.Forms.Application]::Run($form)
`
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-Sta', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    if (child.exitCode !== null || !child.pid) return
    await new Promise<void>(resolve => {
      const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('close', () => resolve())
      killer.once('error', () => { child.kill(); resolve() })
    })
  })
  let diagnostics = ''
  child.stderr.on('data', chunk => { diagnostics += chunk.toString() })
  const ready: any = await new Promise((resolve, reject) => {
    let output = ''
    const deadline = setTimeout(() => reject(new Error('Fixture did not start: ' + diagnostics)), 15_000)
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('\n')) { clearTimeout(deadline); try { resolve(JSON.parse(output.trim())) } catch (error) { reject(error) } } })
    child.once('error', error => { clearTimeout(deadline); reject(error) })
    child.once('exit', code => { clearTimeout(deadline); reject(new Error(`Fixture exited ${code}: ${diagnostics}`)) })
  })
  const window_id = ready.window_id
  const call = async (action: string, extra: any = {}) => {
    const value = await desktopCommand({ action, window_id, ...extra })
    assert.equal(value.ok, true, JSON.stringify(value))
    return value
  }
  const listing = await desktopCommand({ action: 'windows', process_id: ready.process_id })
  assert.equal(listing.ok, true, JSON.stringify(listing))
  assert.equal(listing.windows.some((item: any) => item.window_id === window_id && item.title === title), true, JSON.stringify({ ready, listing }))
  const first = await call('inspect')
  const field = first.controls.find((item: any) => item.control_type === 'Edit')
  assert.ok(field?.element_id, JSON.stringify(first))
  const selector = { element_id: field.element_id }
  const text = 'WeftMod 中文 日本語 "quotes" $(literal)'
  const typed = await call('type', { selector, text })
  assert.equal(typed.method, 'value_pattern')
  const second = await call('inspect')
  assert.equal(second.controls.find((item: any) => item.element_id === field.element_id)?.value, text)
  await call('invoke', { selector: { name: 'Apply', control_type: 'Button' } })
  const third = await call('inspect')
  assert.equal(third.controls.some((item: any) => item.name === 'Accepted: ' + text), true)
  const capture = await call('screenshot')
  assert.equal(capture.mime_type, 'image/png')
  assert.equal(capture.capture_method, 'print_window')
  const png = Buffer.from(capture.base64, 'base64')
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.equal(png.readUInt32BE(16), capture.width)
  assert.equal(png.readUInt32BE(20), capture.height)
  assert.ok(capture.width > 300 && capture.height > 150)
  await call('keys', { selector, keys: 'CTRL+A' })
  const keyState = await call('inspect')
  assert.equal(keyState.controls.some((item: any) => item.name === 'Key: A Control'), true)
  // This legacy WinForms textbox does not implement Ctrl+A; verify the native
  // chord above, then clear through its real ValuePattern before Unicode input.
  await call('type', { selector, text: '' })
  const replaced = 'Unicode 输入 via keyboard'
  const keyboard = await call('type', { text: replaced })
  assert.equal(keyboard.method, 'unicode_input')
  const keyboardState = await call('inspect')
  assert.equal(keyboardState.controls.find((item: any) => item.element_id === field.element_id)?.value, replaced)
  await call('click', { selector: { name: 'Apply', control_type: 'Button' } })
  const clicked = await call('inspect')
  assert.equal(clicked.controls.some((item: any) => item.name === 'Accepted: ' + replaced), true)
  const stale = await desktopCommand({ action: 'inspect', window_id: '1' })
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'DESKTOP_WINDOW_GONE')
})
