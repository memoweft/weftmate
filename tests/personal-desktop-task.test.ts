import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createPersonalDesktopTask } from '../src/personal-desktop-task.mjs'

const notepad = { platform: 'windows', id: 12, owner: { path: 'C:\\Windows\\System32\\notepad.exe' },
  bounds: { x: 100, y: 100, width: 700, height: 500 } }

test('the only desktop action launches the fixed System32 Notepad path and observes a window', async () => {
  let reads = 0
  const spawned: Array<{ file: string, args: string[], options: object }> = []
  const task = createPersonalDesktopTask({ platform: 'win32', systemRoot: 'C:\\Windows',
    checkExecutable: async () => {}, pause: async () => {},
    listWindows: async () => ++reads < 4 ? [] : [notepad],
    spawnProcess: (file: string, args: string[], options: object) => {
      spawned.push({ file, args, options })
      const child = Object.assign(new EventEmitter(), { unref() {} })
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
  })
  assert.deepEqual(await task.open({ appId: 'notepad' }), { accepted: true, observed: true, outcome: 'opened' })
  assert.deepEqual(spawned.map(({ file, args }) => ({ file, args })),
    [{ file: 'C:\\Windows\\System32\\notepad.exe', args: [] }])
  assert.equal((spawned[0].options as { shell: boolean }).shell, false)
  await assert.rejects(task.open({ appId: 'cmd' }), (error: { code: string }) => error.code === 'CAPABILITY_UNAVAILABLE')
})

test('an already visible Notepad is reported without another launch; missing observation stays unconfirmed', async () => {
  let spawns = 0
  const already = createPersonalDesktopTask({ platform: 'win32', systemRoot: 'C:\\Windows',
    checkExecutable: async () => {}, listWindows: async () => [notepad],
    spawnProcess: () => { spawns++; throw new Error('should not spawn') },
  })
  assert.deepEqual(await already.open({ appId: 'notepad' }),
    { accepted: true, observed: true, outcome: 'already_open' })
  assert.equal(spawns, 0)
  const unseen = createPersonalDesktopTask({ platform: 'win32', systemRoot: 'C:\\Windows',
    checkExecutable: async () => {}, listWindows: async () => [], pause: async () => {},
    spawnProcess: () => {
      const child = Object.assign(new EventEmitter(), { unref() {} })
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
  })
  assert.deepEqual(await unseen.open({ appId: 'notepad' }), { accepted: true, observed: false })
  const minimized = createPersonalDesktopTask({ platform: 'win32', systemRoot: 'C:\\Windows',
    checkExecutable: async () => {}, listWindows: async () => [{ ...notepad, bounds: { ...notepad.bounds, x: -32_000 } }],
    pause: async () => {}, spawnProcess: () => {
      const child = Object.assign(new EventEmitter(), { unref() {} })
      queueMicrotask(() => child.emit('spawn'))
      return child
    } })
  assert.deepEqual(await minimized.open({ appId: 'notepad' }), { accepted: true, observed: false })
  const imitation = createPersonalDesktopTask({ platform: 'win32', systemRoot: 'C:\\Windows',
    programFilesRoot: 'C:\\Program Files', checkExecutable: async () => {}, pause: async () => {},
    listWindows: async () => [{ ...notepad, owner: { path: 'C:\\Users\\Public\\notepad.exe' } }],
    spawnProcess: () => {
      const child = Object.assign(new EventEmitter(), { unref() {} })
      queueMicrotask(() => child.emit('spawn'))
      return child
    } })
  assert.deepEqual(await imitation.open({ appId: 'notepad' }), { accepted: true, observed: false })
  const storeApp = createPersonalDesktopTask({ platform: 'win32', systemRoot: 'C:\\Windows',
    programFilesRoot: 'C:\\Program Files', checkExecutable: async () => {},
    listWindows: async () => [{ ...notepad, owner: { path: 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsNotepad_11.2607.14.0_x64__8wekyb3d8bbwe\\Notepad.exe' } }],
    spawnProcess: () => { throw new Error('already open') } })
  assert.deepEqual(await storeApp.open({ appId: 'notepad' }),
    { accepted: true, observed: true, outcome: 'already_open' })
})
