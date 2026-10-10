import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs'

test('memory shutdown waits for the worker write acknowledgement and confirms the worker exits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-memory-shutdown-'))
  const module = join(root, 'memoweft', 'integrations', 'dsh_bridge'), state = join(root, 'worker-state')
  await mkdir(module, { recursive: true })
  await writeFile(join(module, '__main__.py'), `import sys, json, os, time\nfrom pathlib import Path\nfor line in sys.stdin:\n    frame = json.loads(line)\n    if frame['method'] == 'shutdown':\n        time.sleep(0.15)\n        Path(os.environ['WEFTMATE_MAINT1_STATE']).write_text('drained')\n    frame.update(ok=True, result={'pid': os.getpid()})\n    print(json.dumps(frame), flush=True)\n`)
  const rpc = new MemoWeftRpc({ python: process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON || 'python', pythonPath: root,
    env: { WEFTMATE_MAINT1_STATE: state } })
  try {
    const { pid } = await rpc.request('initialize')
    await rpc.close()
    assert.equal(await readFile(state, 'utf8'), 'drained')
    assert.equal(rpc.child, null)
    assert.throws(() => process.kill(pid, 0), 'the memory worker must have exited')
  } finally { await rpc.close(); await rm(root, { recursive: true, force: true, maxRetries: 5 }) }
})
