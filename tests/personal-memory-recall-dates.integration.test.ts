import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs'
import { recallDateCases } from './fixtures/recall-date-contract.ts'

const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE
const skip = !python || !pythonPath ? 'The observed-core job supplies the pinned Python Core' : false
const owner = 'owner-00000000-0000-4000-8000-000000000001'
const occurred = ['2026-01-06T17:48:59', '2026-07-14T18:12:48', '2026-10-16T11:54:54']
const queries = { en: ['Golden Retriever', 'violent video games', 'nature hikes'], zh: ['金毛寻回犬', '暴力电子游戏', '自然徒步'] }

// Run unchanged against the previous official Core archive too: Chinese exact
// strings pass there, while English date/localization assertions reproduce red.
for (const language of ['en', 'zh', undefined] as const) for (const indices of [[0], [1], [2], [0, 1, 2]]) {
  test(`G9 real Core ${language ?? 'missing locale'}: ${indices.length === 1 ? recallDateCases[indices[0]].source : 'three ordered IDs'}`, { skip }, async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'weftmate-real-dates-')))
    const lang = language === 'en' ? 'en' : 'zh'
    // Compact synthetic rows isolate pairing from the Core's unchanged
    // five-item/600-character budget and topic ranking. Full exam turns above
    // are each checked independently, without trimming their source wording.
    const multi = indices.length > 1
    const items = indices.map(i => ({ id: `date-${i}`, text: multi
      ? (lang === 'en' ? `Synthetic recall dates topic ${i}.` : `合成召回日期主题${i}。`)
      : recallDateCases[i][lang], occurred: occurred[i] }))
    const manager = createPersonalMemoryManager({ root, enabled: true, python, pythonPath,
      baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => 'synthetic',
      language: () => language, recallMaxItems: 5, recallMaxChars: 1200,
      rpcFactory: options => new MemoWeftRpc({ ...options, env: { ...options.env,
        MEMOWEFT_TESTING: '1', MEMOWEFT_TEST_MODEL_RESPONSE: '__smart__' } }) })
    try {
      await manager.query(owner, 'query_world', { operation: 'revision' })
      const db = path.join(root, 'accounts', owner, 'memory-home', 'memoweft', 'memoweft.sqlite3')
      const seed = spawnSync(python!, [fileURLToPath(new URL('./fixtures/seed-recall-dates.py', import.meta.url)), db, owner],
        { input: JSON.stringify(items), encoding: 'utf8', windowsHide: true })
      assert.equal(seed.status, 0, seed.stderr)
      const query = multi ? (lang === 'en' ? 'Synthetic recall dates topic' : '合成召回日期主题') : queries[lang][indices[0]]
      const snapshot = await manager.query(owner, 'preview_recall', { query, model_tier: 'local' })
      const pairs = snapshot.preview.selected_item_ids
      assert.equal(pairs.length, items.length)
      const byId = new Map(items.map(item => [item.id, item]))
      const body = (id: string) => {
        const item = byId.get(id)!
        return lang === 'en' ? `[said at: ${item.occurred}] ${item.text}` : item.text
      }
      const header = lang === 'en' ? 'Memory:' : '记忆：'
      assert.equal(snapshot.preview.rendered_recall, pairs.map(([, id]: string[]) => header + body(id)).join('\n'))
      const result = await manager.recall(owner, { query, sessionId: 'synthetic-recall', modelTier: 'local' })
      assert.equal(result.sourceCount, items.length)
      assert.deepEqual(result.memories, pairs.map(([kind, id]: string[]) => ({ kind, id, summary: body(id).trim().slice(0, 240) })))
      assert.equal(result.contextText, pairs.map(([, id]: string[]) => header + body(id)).join('\n\n'))
      if (lang === 'en') assert.doesNotMatch(result.contextText, /\p{Script=Han}|2030-01-01|2038-01-01/u)
    } finally { await manager.close(); await rm(root, { recursive: true, force: true }) }
  })
}
