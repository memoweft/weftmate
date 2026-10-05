import assert from 'node:assert/strict'
import test from 'node:test'
import { uniqueSessionOwner } from '../src/personal-access/index.mjs'
import { modelRouteFingerprint } from '../src/model-route-fingerprint.mjs'
import { openAICompatibleEndpoint } from '../src/openai-compatible-client.ts'
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs'
import { memoryRecallDestination, memorySessionPolicy } from '../src/personal-memory/policy.mjs'
import { boundaryForCompletedTurn, stripPreviousPersonalMemoryMessages,
  userForPreStep, userForTurn } from '../src/plugins/weftmate-personal-memory.mjs'

const ownerA = 'owner-00000000-0000-4000-8000-000000000001'
const ownerB = 'owner-00000000-0000-4000-8000-000000000002'
const sessionId = 'session-synthetic'
const events = [
  { seq: 1, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, type: 'user/message', data: { id: 'user-one', source: { kind: 'user' },
    content: [{ type: 'text', text: '合成用户原话' }] } },
  { seq: 3, type: 'assistant/message', data: { message: { id: 'assistant-one',
    content: [{ type: 'text', text: '合成答复' }] } } },
  { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
]

test('only a uniquely bound DSH session may select an owner memory process', () => {
  const one = { [ownerA]: { sessions: { [sessionId]: { origin: 'personal-remote', modelProfileId: 'formal-local' } } },
    [ownerB]: { sessions: {} } }
  assert.equal(uniqueSessionOwner(one, sessionId)?.ownerId, ownerA)
  assert.equal(uniqueSessionOwner(one, 'missing'), null)
  one[ownerB].sessions[sessionId] = { origin: 'shared-chat', modelProfileId: 'formal-local' }
  let invoked = 0
  const binding = uniqueSessionOwner(one, sessionId)
  if (binding) invoked++
  assert.equal(binding, null, 'two accounts using the same ID must never choose the first owner')
  assert.equal(invoked, 0, 'an ambiguous ID must not dispatch recall or ingest')
})

test('the host rejects a boundary whose session identity differs from the authenticated DSH session', () => {
  const session = { id: sessionId, header: { agentPreset: 'personal-remote' }, events }
  const boundary = boundaryForCompletedTurn(session, events.at(-1))
  assert.ok(boundary)
  assert.equal(assertOwnerBoundBoundary(sessionId, boundary), boundary)
  assert.throws(() => assertOwnerBoundBoundary('session-other', boundary),
    (error: { code: string }) => error.code === 'MEMORY_BOUNDARY_INVALID')
  assert.throws(() => assertOwnerBoundBoundary(sessionId, { ...boundary, result_session_id: 'session-other' }),
    (error: { code: string }) => error.code === 'MEMORY_BOUNDARY_INVALID')
  assert.throws(() => assertOwnerBoundBoundary(sessionId, { ...boundary,
    source_messages: [{ ...boundary.source_messages[0], role: 'tool' }] }),
  (error: { code: string }) => error.code === 'MEMORY_BOUNDARY_INVALID')
})

test('pre-step query uses a durable real user message and local owner model route only', () => {
  const session = { id: sessionId, header: { agentPreset: 'personal-shared-chat' }, events: [
    events[0], events[1],
    { seq: 3, type: 'user/message', data: { id: 'plugin-injected', source: { kind: 'plugin' },
      content: [{ type: 'text', text: '另一个账号的模型注入' }] } },
  ] }
  assert.equal(userForTurn(session, 1)?.text, '合成用户原话')
  assert.equal(userForTurn(session, 2), null)
  session.events.push({ seq: 4, type: 'turn/start', data: { turn: 2 } } as any,
    { seq: 5, type: 'user/message', data: { id: 'later-user', source: { kind: 'user' },
      content: [{ type: 'text', text: '后一轮用户原话' }] } } as any)
  assert.equal(userForTurn(session, 1)?.text, '合成用户原话',
    'a delayed pre-step must never pick a later turn user message')
  const beforeAppend = { id: sessionId, header: { agentPreset: 'personal-shared-chat' },
    events: [{ seq: 1, type: 'turn/start', data: { turn: 1 } }] }
  assert.equal(userForTurn(beforeAppend, 1), null)
  assert.equal(userForPreStep(beforeAppend, 1, [{ id: 'claimed-real-user', source: { kind: 'user' },
    content: [{ type: 'text', text: '首步尚未写入session的真实用户输入' }] }])?.text,
  '首步尚未写入session的真实用户输入')
  assert.equal(userForPreStep(beforeAppend, 1, [
    { source: { kind: 'plugin', plugin: 'weftmate-personal-memory' },
      content: [{ type: 'text', text: '旧插件消息' }] },
    { source: { kind: 'assistant' }, content: [{ type: 'text', text: '旧助手消息' }] },
  ]), null, 'plugin and assistant claims cannot become an owner-memory recall query')
  const binding = { ownerId: ownerB, origin: 'shared-chat', modelProfileId: 'personal-local-occamy-miniplus-v21' }
  const described = { agentPreset: 'personal-shared-chat' }
  const access = { canUseModelProfile: (ownerId: string, id: string) => ownerId === ownerB && id === binding.modelProfileId,
    isFormalLocalProfile: (id: string) => id === binding.modelProfileId }
  const allowed = memorySessionPolicy({ binding, described,
    selected: { profile: { id: binding.modelProfileId, baseUrl: 'http://127.0.0.1:8081/v1' } }, access })
  assert.equal(allowed.allowed, true)
  assert.equal(allowed.ownerId, ownerB)
  const cloud = memorySessionPolicy({ binding, described,
    selected: { profile: { id: binding.modelProfileId, baseUrl: 'https://cloud.example/v1' } }, access })
  assert.deepEqual(cloud, { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' })
  assert.deepEqual(memorySessionPolicy({ binding: null, described, access }),
    { allowed: false, reasonCode: 'MEMORY_OWNER_UNAVAILABLE' })
  const currentMessages = stripPreviousPersonalMemoryMessages([
    { source: { kind: 'user' }, content: 'current user' },
    { source: { kind: 'plugin', plugin: 'weftmate-personal-memory' }, content: 'stale A memory' },
    { source: { kind: 'plugin', plugin: 'another-plugin' }, content: 'other context' },
  ])
  assert.equal(currentMessages.length, 2)
  assert.equal(JSON.stringify(currentMessages).includes('stale A memory'), false,
    'a failed later recall must not retain an earlier personal memory snapshot')
})

test('active pre-step resolves A and B from durable local bindings without a DSH callback', async () => {
  const formal = 'personal-local-qwen3.8-27b-ablated-q5-96k'
  const accounts = {
    [ownerA]: { sessions: { 'session-a': { origin: 'shared-chat', modelProfileId: formal },
      'session-ambiguous': { origin: 'shared-chat', modelProfileId: formal } } },
    [ownerB]: { sessions: { 'session-b': { origin: 'shared-chat', modelProfileId: formal },
      'session-ambiguous': { origin: 'shared-chat', modelProfileId: formal } } },
  }
  const described = { agentPreset: 'personal-shared-chat' }
  const local = { id: formal, baseUrl: 'http://127.0.0.1:8081/v1' }
  const access = { canUseModelProfile: (ownerId: string, id: string) =>
    [ownerA, ownerB].includes(ownerId) && id === formal,
    isFormalLocalProfile: (id: string) => id === formal }
  const preStep = async (id: string, profiles = [local], boundProfileId: string | null = formal,
    hasCredential = () => true) => Promise.resolve().then(() => memoryRecallDestination({
      binding: uniqueSessionOwner(accounts, id), described, boundProfileId, profiles,
      access, hasCredential,
    }))
  assert.deepEqual(await preStep('session-a'), { allowed: true, ownerId: ownerA })
  assert.deepEqual(await preStep('session-b'), { allowed: true, ownerId: ownerB })
  assert.deepEqual(await preStep('session-ambiguous'),
    { allowed: false, reasonCode: 'MEMORY_OWNER_UNAVAILABLE' })
  assert.deepEqual(await preStep('session-a', [{ ...local, baseUrl: 'https://cloud.example/v1' }]),
    { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' })
  assert.deepEqual(await preStep('session-a', [local], null),
    { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' })
  assert.deepEqual(await preStep('session-a', [local], formal, () => false),
    { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' })
  assert.deepEqual(await preStep('session-a', [local, local]),
    { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' })
})

test('private cloud recall requires the exact owner ledger route and credential', () => {
  const profile = { id: 'private-model-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-flash' }
  const fingerprint = modelRouteFingerprint(
    openAICompatibleEndpoint(profile.baseUrl, 'chat/completions').href, profile.model)
  assert.match(fingerprint!, /^[a-f0-9]{64}$/)
  const binding = { ownerId: ownerA, origin: 'shared-chat', modelProfileId: profile.id }
  const described = { agentPreset: 'personal-shared-chat' }
  const proof = { active: true, profileId: profile.id, baseUrl: profile.baseUrl,
    modelId: profile.model, routeFingerprint: fingerprint, credential: true }
  const access = { canUseModelProfile: (ownerId: string, id: string) =>
    ownerId === ownerA && id === profile.id,
  privateAccountModelProof: (ownerId: string, id: string) =>
    ownerId === ownerA && id === profile.id ? proof : null }
  assert.deepEqual(memoryRecallDestination({ binding, described, boundProfileId: profile.id,
    profiles: [profile], access, hasCredential: () => true }),
  { allowed: true, ownerId: ownerA },
  'the settings profile has no stored fingerprint; policy must derive it from its canonical wire route')
  assert.deepEqual(memorySessionPolicy({ binding: { ...binding, ownerId: ownerB }, described,
    selected: { profile }, access }),
  { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' }, 'a foreign owner has no ledger proof')
  assert.deepEqual(memorySessionPolicy({ binding: { ...binding, modelProfileId: 'shared-cloud' }, described,
    selected: { profile: { ...profile, id: 'shared-cloud' } }, access: {
      canUseModelProfile: () => true, privateAccountModelProof: () => null } }),
  { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' }, 'a global cloud route is never private')
  for (const badProof of [
    { ...proof, baseUrl: 'https://api.other-provider.com/v1' },
    { ...proof, modelId: 'other-model' },
    { ...proof, routeFingerprint: '0'.repeat(64) },
    { ...proof, credential: false },
  ]) {
    assert.deepEqual(memorySessionPolicy({ binding, described, selected: { profile }, access: {
      canUseModelProfile: () => true, privateAccountModelProof: () => badProof } }),
    { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' })
  }
  assert.deepEqual(memoryRecallDestination({ binding, described, boundProfileId: profile.id,
    profiles: [profile], access, hasCredential: () => false }),
  { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' }, 'the host vault credential is mandatory')
})

test('an immutable old private revision remains recallable until the account model is revoked', () => {
  const oldProfile = { id: 'private-model-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v1' }
  const currentProfile = { id: 'private-model-cccccccccccccccccccccccccccccccccccccccc',
    baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2' }
  const oldProof = { active: true, profileId: oldProfile.id, baseUrl: oldProfile.baseUrl,
    modelId: oldProfile.model, routeFingerprint: modelRouteFingerprint(
      openAICompatibleEndpoint(oldProfile.baseUrl, 'chat/completions').href, oldProfile.model), credential: true }
  const binding = { ownerId: ownerA, origin: 'personal-remote', modelProfileId: oldProfile.id }
  const described = { agentPreset: 'personal-remote' }
  const activeLedger = { canUseModelProfile: (_ownerId: string, id: string) =>
    [oldProfile.id, currentProfile.id].includes(id),
  privateAccountModelProof: (_ownerId: string, id: string) => id === oldProfile.id ? oldProof : null }
  assert.deepEqual(memoryRecallDestination({ binding, described, boundProfileId: oldProfile.id,
    profiles: [oldProfile, currentProfile], access: activeLedger, hasCredential: () => true }),
  { allowed: true, ownerId: ownerA }, 'changing the account current pointer must not redirect an old session')
  assert.deepEqual(memoryRecallDestination({ binding, described, boundProfileId: currentProfile.id,
    profiles: [oldProfile, currentProfile], access: activeLedger, hasCredential: () => true }),
  { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' }, 'the session binding is immutable')
  assert.deepEqual(memoryRecallDestination({ binding, described, boundProfileId: oldProfile.id,
    profiles: [oldProfile], access: { canUseModelProfile: () => false,
      privateAccountModelProof: () => null }, hasCredential: () => true }),
  { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' }, 'a stopped or removed ledger route is unavailable')
})
