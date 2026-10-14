import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { describe, before, after } from 'node:test'
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs'

describe('memory shutdown with a prepared worker', () => {
 let root: string, state: string, rpc: MemoWeftRpc
 before(async () => {
  root = await mkdtemp(join(tmpdir(), 'weftmate-memory-shutdown-'))
  const module = join(root, 'memoweft', 'integrations', 'dsh_bridge')
  state = join(root, 'worker-state')
  await mkdir(module, { recursive: true })
  // Real installed Core is a regular package; a namespace-only fixture loses
  // import precedence to it, even with PYTHONPATH. Seal this owned substitute.
  for (const directory of [join(root, 'memoweft'), join(root, 'memoweft', 'integrations'), module])
    await writeFile(join(directory, '__init__.py'), '')
  await writeFile(join(module, '__main__.py'), `import sys, json, os, time\nfrom pathlib import Path\nprint(json.dumps({'fixture_ready': True}), flush=True)\nfor line in sys.stdin:\n    frame = json.loads(line)\n    if frame['method'] == 'shutdown':\n        time.sleep(0.15)\n        Path(os.environ['WEFTMATE_MAINT1_STATE']).write_text('drained')\n    frame.update(ok=True, result={'pid': os.getpid()})\n    print(json.dumps(frame), flush=True)\n`)
  rpc = new MemoWeftRpc({ python: process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON || 'python', pythonPath: root,
    env: { WEFTMATE_MAINT1_STATE: state } })
  const started = performance.now()
  rpc.start()
  const child = rpc.child!
  await new Promise<void>((resolve, reject) => {
    let buffer = ''
    const finish = (error?: Error) => {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.off('error', onError)
      child.off('close', onClose)
      error ? reject(error) : resolve()
    }
    const onData = (part: string) => {
      buffer += part
      if (buffer.includes('"fixture_ready": true')) finish()
    }
    const onError = () => finish(new Error('method=fixture_ready phase=preparation.spawn failed'))
    const onClose = () => finish(new Error('method=fixture_ready phase=preparation.worker-exit'))
    const timer = setTimeout(() => finish(new Error('method=fixture_ready phase=preparation.ready timeout')), 60_000)
    child.stdout.on('data', onData)
    child.once('error', onError)
    child.once('close', onClose)
  })
  console.log(JSON.stringify({ phase: 'preparation.worker-ready', milliseconds: performance.now() - started }))
 })
 after(async () => {
  await rpc?.close()
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 5 })
 })
 test('memory shutdown waits for the worker write acknowledgement and confirms the worker exits', async () => {
  let phase = 'measurement.initialize'
  try {
    // Keep the original 15s initialize and 3s shutdown request deadlines.
    const { pid } = await rpc.request('initialize')
    phase = 'measurement.close'
    await rpc.close()
    phase = 'assertion.write-and-exit'
    assert.equal(await readFile(state, 'utf8'), 'drained')
    assert.equal(rpc.child, null)
    assert.throws(() => process.kill(pid, 0), 'the memory worker must have exited')
  } catch (error) {
    error.message += ` (testPhase=${phase})`
    throw error
  }
 })
})

test('memory RPC timeout identifies the request and response phase without private parameters', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const rpc = new MemoWeftRpc({ python: 'unused-fixture', pythonPath: 'unused-fixture' })
  // No process or wall clock is involved; the worker deliberately sends no frame.
  rpc.child = { stdin: { write() {} } } as any
  const pending = rpc.request('initialize', { privateText: 'must-not-appear' }, 1_000)
  const checked = assert.rejects(pending, error => {
    assert.equal(error.code, 'MEMORY_TIMEOUT')
    assert.equal(error.requestMethod, 'initialize')
    assert.equal(error.requestPhase, 'awaiting-worker-response')
    assert.match(error.message, /method=initialize, phase=awaiting-worker-response/)
    assert.ok(!error.message.includes('must-not-appear'))
    return true
  })
  t.mock.timers.tick(1_000)
  await checked
  assert.equal(rpc.pending.size, 0)
  rpc.child = null
  await rpc.close()
})
