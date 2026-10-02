import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { findFormalLocalModel, listFormalLocalModels, prepareLocalModelConfig,
  projectOccamyImageInput, readUserModelSwitcherKey, reconcileOccamyImageInput } from '../src/local-model-config.mjs'

test('local model configuration accepts one exact formal catalog id and fixed 8081 endpoint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-local-model-'))
  try {
    writeFileSync(join(root, 'mini.json'), JSON.stringify({ dsh_model_id: 'occamy-miniplus-v21',
      display_name: 'MiniPlus V2.1', context_window: 262144, output_reserve: 16384, ctx_size: 262144 }))
    const formal = await findFormalLocalModel('occamy-miniplus-v21', root)
    assert.deepEqual(formal, { modelId: 'occamy-miniplus-v21', name: 'MiniPlus V2.1',
      contextWindow: 262144, outputReserve: 16384 })
    const prepared = await prepareLocalModelConfig({ modelId: 'occamy-miniplus-v21', catalogDir: root,
      readKey: async () => 'synthetic-secret' })
    assert.deepEqual(prepared, { id: 'personal-local-occamy-miniplus-v21', name: 'MiniPlus V2.1',
      provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8081/v1',
      model: 'occamy-miniplus-v21', contextWindow: 262144, outputReserve: 16384,
      apiKey: 'synthetic-secret' })
    writeFileSync(join(root, 'short.json'), JSON.stringify({ dsh_model_id: 'short-model',
      display_name: 'Short', context_window: 98304, output_reserve: 32768, max_context: 98304 }))
    assert.deepEqual(await findFormalLocalModel('short-model', root), {
      modelId: 'short-model', name: 'Short', contextWindow: 98304, outputReserve: 32768 })
    assert.deepEqual((await listFormalLocalModels(root)).map((item: { modelId: string }) => item.modelId),
      ['occamy-miniplus-v21', 'short-model'])
    await assert.rejects(findFormalLocalModel('../outside', root),
      (error: { code: string }) => error.code === 'LOCAL_MODEL_INVALID')
    writeFileSync(join(root, 'duplicate.json'), JSON.stringify({ dsh_model_id: 'occamy-miniplus-v21',
      context_window: 262144, output_reserve: 16384 }))
    await assert.rejects(findFormalLocalModel('occamy-miniplus-v21', root),
      (error: { code: string }) => error.code === 'LOCAL_MODEL_INVALID')
    await assert.rejects(listFormalLocalModels(root),
      (error: { code: string }) => error.code === 'LOCAL_MODEL_INVALID')
    for (const invalid of [
      { context_window: 98304, output_reserve: 98304 },
      { context_window: 98304, output_reserve: -1 },
      { context_window: 98304, output_reserve: 32768, ctx_size: 131072 },
      { context_window: 2_000_000, output_reserve: 32768 },
    ]) {
      writeFileSync(join(root, 'invalid.json'), JSON.stringify({ dsh_model_id: 'invalid-model', ...invalid }))
      await assert.rejects(findFormalLocalModel('invalid-model', root),
        (error: { code: string }) => error.code === 'LOCAL_MODEL_INVALID')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('User environment key stays out of process arguments and unsafe output is refused', async () => {
  let observedArgs: string[] = []
  const key = await readUserModelSwitcherKey({ systemRoot: 'C:\\Windows',
    exec: async (_file: string, args: string[]) => {
      observedArgs = args
      return { stdout: 'synthetic-key' }
    } })
  assert.equal(key, 'synthetic-key')
  assert.equal(observedArgs.join(' ').includes('synthetic-key'), false)
  await assert.rejects(readUserModelSwitcherKey({ systemRoot: 'C:\\Windows',
    exec: async () => ({ stdout: 'bad\nkey' }) }),
  (error: { code: string }) => error.code === 'LOCAL_MODEL_CREDENTIAL_UNAVAILABLE')
})

test('formal Occamy route gains image input once while preserving provider and other model rows', async () => {
  const route = `weftmate-${createHash('sha256').update('personal-local-occamy-miniplus-v21').digest('hex').slice(0, 24)}`
  const original = { displayName: 'MiniPlus V2.1', apiKeyEnv: `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`,
    api: 'openai-completions', baseURL: 'http://127.0.0.1:8081/v1',
    models: [{ id: 'occamy-miniplus-v21', name: 'MiniPlus V2.1', contextWindow: 262144, maxTokens: 16384 },
      { id: 'unrelated-model', name: 'Keep me', input: ['text'], contextWindow: 8192, maxTokens: 1024 }] }
  const unrelated = { displayName: 'Another provider', models: [{ id: 'untouched' }] }
  const freshProjection = projectOccamyImageInput(original, { route })
  assert.deepEqual(freshProjection.models[0].input, ['text', 'image'])
  assert.equal(Object.hasOwn(original.models[0], 'input'), false, 'fresh rollback projection does not mutate the text-only baseline')
  assert.deepEqual(freshProjection.models[1], original.models[1], 'fresh projection preserves another model row')
  let revision = 7, writes = 0
  let providers: Record<string, any> = { [route]: structuredClone(original), other: structuredClone(unrelated) }
  const client = {
    describeSettings: async () => ({ writable: true, applies: 'live', revision,
      userProviders: structuredClone(providers), baseProviders: {} }),
    mutateSettings: async (ops: any[], expectedRevision: number) => {
      assert.equal(expectedRevision, revision)
      assert.deepEqual(ops.map((item) => item.path), [['providers', route]])
      writes++
      providers[route] = structuredClone(ops[0].value)
      revision++
    },
  }
  assert.equal(await reconcileOccamyImageInput(client, { route }), true)
  assert.deepEqual(providers[route].models[0].input, ['text', 'image'])
  assert.deepEqual(providers[route].models[1], original.models[1])
  assert.deepEqual(providers.other, unrelated)
  assert.equal(await reconcileOccamyImageInput(client, { route }), false, 'existing vision declaration is idempotent')
  assert.equal(writes, 1)
  providers[route] = { ...original, baseURL: 'http://127.0.0.1:9999/v1' }
  await assert.rejects(reconcileOccamyImageInput(client, { route }),
    (error: { code: string }) => error.code === 'MODEL_ROUTE_BLOCKED')
  assert.equal(writes, 1, 'a changed endpoint is never rewritten')
})

test('Occamy input reconciliation fails closed when official settings require restart or route is ambiguous', async () => {
  const route = `weftmate-${createHash('sha256').update('personal-local-occamy-miniplus-v21').digest('hex').slice(0, 24)}`
  const provider = { apiKeyEnv: `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`,
    api: 'openai-completions', baseURL: 'http://127.0.0.1:8081/v1',
    models: [{ id: 'occamy-miniplus-v21', input: ['text'] }] }
  let writes = 0
  const client = { describeSettings: async () => ({ writable: true, applies: 'restart', revision: 1,
    userProviders: { [route]: provider } }), mutateSettings: async () => { writes++ } }
  await assert.rejects(reconcileOccamyImageInput(client, { route }),
    (error: { code: string }) => error.code === 'MODEL_ROUTE_BLOCKED')
  await assert.rejects(reconcileOccamyImageInput(client, { route: 'weftmate-other' }),
    (error: { code: string }) => error.code === 'MODEL_ROUTE_BLOCKED')
  assert.equal(writes, 0)
})
