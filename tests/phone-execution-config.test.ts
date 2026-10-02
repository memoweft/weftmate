import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { loadPhoneExecutionConfig } from '../src/phone-execution-config.mjs'

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-phone-config-'))
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'phone.local.json')
  const adb = join(root, 'adb.exe')
  await writeFile(adb, 'test fixture only; never executed')
  const config = { enabled: true, adbPath: adb, model: { baseUrl: 'http://127.0.0.1:18080/v1', model: 'local-vision', authRef: 'PHONE_MODEL_KEY' } }
  return { root, path, config, save: (value: unknown) => writeFile(path, JSON.stringify(value)) }
}

test('phone execution is absent or disabled without resolving credentials', async t => {
  const f = await fixture(t)
  const noResolve = () => { throw new Error('must not resolve') }
  assert.equal(await loadPhoneExecutionConfig(null, noResolve), null)
  await f.save({ enabled: false })
  assert.equal(await loadPhoneExecutionConfig(f.path, noResolve), null)
})

test('phone configuration resolves the existing vault reference only when loaded by host', async t => {
  const f = await fixture(t)
  await f.save(f.config)
  const refs: string[] = []
  const result = await loadPhoneExecutionConfig(f.path, (ref: string) => { refs.push(ref); return 'local-model-test-secret' })
  assert.deepEqual(refs, ['PHONE_MODEL_KEY'])
  assert.deepEqual(result, {
    enabled: true, adb_path: f.config.adbPath,
    model: { endpoint: 'http://127.0.0.1:18080/v1', name: 'local-vision', api_key: 'local-model-test-secret' },
  })
  assert.equal(JSON.stringify(f.config).includes('local-model-test-secret'), false)
})

test('invalid phone configuration never resolves credentials or echoes values', async t => {
  const f = await fixture(t)
  for (const bad of [
    { ...f.config, adbPath: 'adb.exe' },
    { ...f.config, adbSerial: 'device; injected-command' },
    { ...f.config, model: { ...f.config.model, baseUrl: 'https://example.com/v1' } },
    { ...f.config, model: { ...f.config.model, baseUrl: 'http://secret@localhost/v1' } },
    { ...f.config, model: { ...f.config.model, apiKey: 'never-echo-this-value' } },
  ]) {
    await f.save(bad)
    await assert.rejects(loadPhoneExecutionConfig(f.path, () => { throw new Error('unexpected credential request') }), error => {
      assert.equal((error as Error).message, 'phone_execution_config_invalid')
      return true
    })
  }
})

test('missing model credential remains a clear host configuration failure', async t => {
  const f = await fixture(t)
  await f.save(f.config)
  await assert.rejects(loadPhoneExecutionConfig(f.path, () => null), /phone_model_credential_unavailable/)
})
