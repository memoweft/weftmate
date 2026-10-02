import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

test('upgrade entrypoint cannot mutate the ambient shared DSH checkout or formal pin', async () => {
  const source = await readFile(join(process.cwd(), 'scripts', 'upgrade-dsh.mjs'), 'utf8')
  assert.doesNotMatch(source, /Shared\/Dependencies\/DeepSeekHarness/)
  assert.doesNotMatch(source, /git', \['-C'.*checkout/)
  assert.doesNotMatch(source, /writeFile\(PIN_PATH/)
  assert.doesNotMatch(source, /require\('node:fs'\)/)
  assert.match(source, /--candidate alpha2/)
})
