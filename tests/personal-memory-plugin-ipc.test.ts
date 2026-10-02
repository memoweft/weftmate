import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import test from 'node:test'
import { uniqueSessionOwner } from '../src/personal-access/index.mjs'
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs'
import { memorySessionPolicy } from '../src/personal-memory/policy.mjs'

const ownerA = 'owner-00000000-0000-4000-8000-000000000001'
const ownerB = 'owner-00000000-0000-4000-8000-000000000002'
const formal = 'personal-local-occamy-miniplus-v21'

test('forked plugin hook callbacks use owner-bound IPC and replace stale account memory', async () => {
  const accounts = {
    [ownerA]: { sessions: { 'session-a': { origin: 'shared-chat', modelProfileId: formal },
      'session-empty': { origin: 'shared-chat', modelProfileId: formal },
      'session-ambiguous': { origin: 'shared-chat', modelProfileId: formal } } },
    [ownerB]: { sessions: { 'session-b': { origin: 'shared-chat', modelProfileId: formal },
      'session-ambiguous': { origin: 'shared-chat', modelProfileId: formal },
      'session-cloud': { origin: 'shared-chat', modelProfileId: formal } } },
  }
  const child = fork(new URL('fixtures/personal-memory-plugin-child.mjs', import.meta.url), [], {
    env: { ...process.env, WEFTMATE_PERSONAL_MEMORY_ENABLED: '1' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  })
  let ingested = 0, recalls = 0, aRecalls = 0
  const result = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('plugin IPC test timeout')), 12_000)
    child.on('message', (message: any) => {
      if (message?.type === 'ready') { child.send({ type: 'run' }); return }
      if (message?.type === 'result' || message?.type === 'failed') {
        clearTimeout(timer)
        if (message.type === 'failed') reject(new Error('forked plugin hook failed'))
        else resolve(message)
        return
      }
      if (message?.protocol !== 'weftmate.personal-memory.v1') return
      const respond = (ok: boolean, value: object) => child.send({ protocol: message.protocol,
        id: message.id, ok, ...(ok ? { result: value } : { error: { code: 'MEMORY_OWNER_UNAVAILABLE' } }) })
      const binding = uniqueSessionOwner(accounts, message.sessionId)
      if (!binding) { respond(false, {}); return }
      const selected = { profile: { id: formal,
        baseUrl: message.sessionId === 'session-cloud' ? 'https://cloud.example/v1'
          : 'http://127.0.0.1:8081/v1' } }
      const policy = memorySessionPolicy({ binding,
        described: { agentPreset: 'personal-shared-chat' }, selected,
        access: { canUseModelProfile: (ownerId: string, id: string) =>
          [ownerA, ownerB].includes(ownerId) && id === formal,
        isFormalLocalProfile: (id: string) => id === formal } })
      if (message.action === 'ingest') {
        assert.equal(policy.allowed, true)
        assert.equal(binding.ownerId, ownerA)
        assertOwnerBoundBoundary(message.sessionId, message.boundary)
        ingested++
        respond(true, { state: 'accepted' })
        return
      }
      if (!policy.allowed) { respond(true, { state: 'withheld', reasonCode: policy.reasonCode }); return }
      recalls++
      if (message.sessionId === 'session-empty') {
        respond(true, { state: 'ready', contextText: '' })
        return
      }
      if (binding.ownerId === ownerA) {
        aRecalls++
        if (aRecalls === 2) respond(true, { state: 'withheld', reasonCode: 'MEMORY_UNAVAILABLE' })
        else respond(true, { state: 'ready', contextText: aRecalls === 1
          ? 'A_ONLY_SYNTHETIC_MEMORY' : 'A_UPDATED_SYNTHETIC_MEMORY' })
      } else respond(true, { state: 'ready', contextText: 'B_ONLY_SYNTHETIC_MEMORY' })
    })
    child.once('error', reject)
    child.once('exit', (code) => { if (code !== 0) reject(new Error(`plugin child exited ${code}`)) })
  })
  try {
    const value = await result
    assert.equal(value.a.text, 'A_ONLY_SYNTHETIC_MEMORY')
    for (const entry of [value.a, value.aUpdated, value.b]) {
      assert.match(entry.last.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      assert.equal(entry.last.role, 'user')
      assert.deepEqual(entry.last.source, { kind: 'plugin', plugin: 'weftmate-personal-memory' })
      assert.equal(entry.last.frozen, true)
      assert.equal(entry.last.sourceFrozen, true)
    }
    assert.equal(value.aWithheld.text, null)
    assert.equal(value.aWithheld.count, 0, 'withheld recall removes the earlier same-turn snapshot')
    assert.equal(value.aUpdated.text, 'A_UPDATED_SYNTHETIC_MEMORY')
    assert.equal(value.aUpdated.count, 1, 'a repeated pre-step replaces the prior memory snapshot')
    assert.equal(value.empty.count, 0, 'a first step with no stored memory adds no synthetic user message')
    assert.equal(value.empty.stale, false)
    assert.equal(value.b.text, 'B_ONLY_SYNTHETIC_MEMORY')
    assert.equal(value.ambiguous.count, 0)
    assert.equal(value.cloud.count, 0)
    assert.equal(value.noClaim.count, 0)
    assert.equal(value.noClaim.stale, false,
      'an unclaimed step strips stale plugin context without requesting recall')
    assert.equal([value.a, value.aWithheld, value.aUpdated, value.empty, value.b,
      value.ambiguous, value.cloud, value.noClaim].some((entry) => entry.stale), false)
    assert.equal(recalls, 5)
    assert.equal(ingested, 1)
  } finally { child.kill() }
})
