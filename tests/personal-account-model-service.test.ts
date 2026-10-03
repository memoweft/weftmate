import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const password = 'synthetic account model password'
async function api(origin: string, auth: Record<string, string>, method: string, route: string, body?: object) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json() }
}
async function settled(origin: string, auth: Record<string, string>, requestId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await api(origin, auth, 'GET', `/personal/v1/account/models/by-request/${requestId}`)
    if (!['pending', 'applying'].includes(value.body.operation.status)) return value.body
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('model operation did not settle')
}

test('owner model revisions, exact private visibility, transfer and stop keep historical identities', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-models-'))
  const staged = new Map<string, string>(), credentials = new Map<string, string>()
  const profiles = new Map<string, any>(), sessions = new Map<string, string>()
  let sentCount = 0
  let secretWait: Promise<void> | null = null
  let enteredSecretRead: (() => void) | null = null
  const manager = {
    stageSecret: async ({ stageRef, apiKey }: any) => { staged.set(stageRef, apiKey) },
    apply: async ({ target, stageRef, previousProfileId }: any) => {
      const key = stageRef ? staged.get(stageRef) : credentials.get(previousProfileId)
      if (!key) throw Object.assign(new Error('missing'), { code: 'ACCOUNT_MODEL_SECRET_REQUIRED', definite: true })
      credentials.set(target.profileId, key)
      profiles.set(target.profileId, { id: target.profileId, name: target.name,
        model: target.modelId, baseUrl: target.baseUrl })
      return { applied: true }
    },
    inspect: async ({ kind, target, profileIds }: any) => ({ applied: kind === 'stop_using' || kind === 'remove'
      ? profileIds.every((id: string) => !credentials.has(id))
      : profiles.get(target.profileId)?.baseUrl === target.baseUrl && credentials.has(target.profileId) }),
    hasCredential: (id: string) => credentials.has(id),
    test: async () => ({ configured: true, reachable: true, modelListed: true }),
    disable: async ({ profileIds }: any) => { for (const id of profileIds) credentials.delete(id)
      return { applied: true } },
    readSecret: async ({ profileId }: any) => {
      enteredSecretRead?.()
      if (secretWait) await secretWait
      return credentials.get(profileId) ?? null
    },
  }
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [...profiles.values()].map((profile) => ({ id: profile.id,
      name: profile.name, model: profile.model, configured: credentials.has(profile.id) })),
    preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId, modelProfileId }: any) => { sessions.set(sessionId, modelProfileId)
      return { sessionId } },
    sendMessage: async () => { sentCount++; return { accepted: true, receiptId: 'rpc-synthetic' } },
    cancelSession: async () => ({ accepted: true }),
    readEvents: async ({ afterSeq }: any) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, agentPreset: 'personal-remote', modelProfileId: sessions.get(sessionId) } : null,
  }
  const service = await createPersonalAccessService({ root, port: 0, backend, accountModelManager: manager })
  try {
    const { origin, hostId } = await service.start()
    const grant = await service.issueSetupGrant()
    const ownerSetup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: 'Owner', password, deviceName: 'Desktop' }) })
    assert.equal(ownerSetup.status, 201)
    const ownerBody = await ownerSetup.json()
    const owner = { origin, cookie: ownerSetup.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': ownerBody.csrfToken }
    const create = await api(origin, owner, 'POST', '/personal/v1/account/models', {
      requestId: 'model-create', name: 'MiMo', baseUrl: 'https://api.example.test/v1/chat/completions',
      modelId: 'mimo-v1', apiKey: 'synthetic-key-one' })
    assert.equal(create.status, 202, JSON.stringify(create.body))
    const created = await settled(origin, owner, 'model-create')
    assert.equal(created.operation.status, 'succeeded', JSON.stringify(created))
    assert.equal(created.model.baseUrl, 'https://api.example.test/v1')
    assert.equal(created.model.revision, 1)
    assert.equal(created.model.configured, true)
    assert.equal(JSON.stringify(created).includes('synthetic-key-one'), false)
    const accountModelId = created.model.accountModelId
    const oldProfileId = created.model.profileId
    assert.equal((await api(origin, owner, 'GET', '/personal/v1/account/models')).body.models.length, 1)
    assert.equal((await api(origin, owner, 'POST', '/personal/v1/account/models', {
      requestId: 'model-create', name: 'MiMo', baseUrl: 'https://api.example.test/v1/chat/completions',
      modelId: 'mimo-v1', apiKey: 'synthetic-key-two' })).status, 409)
    const other = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Other', password, deviceName: 'Other' }) })
    assert.equal(other.status, 201)
    const otherBody = await other.json()
    const otherAuth = { origin, cookie: other.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': otherBody.csrfToken }
    assert.equal((await api(origin, otherAuth, 'GET', `/personal/v1/account/models/${accountModelId}`)).status, 404)
    assert.equal((await api(origin, otherAuth, 'GET', '/personal/v1/models')).body.models.length, 0)
    assert.equal((await api(origin, otherAuth, 'POST', '/personal/v1/commands', {
      requestId: 'other-private-create', kind: 'session.create', targetDeviceId: hostId,
      modelProfileId: oldProfileId })).status, 422)
    const otherCreated = await api(origin, otherAuth, 'POST', '/personal/v1/account/models', {
      requestId: 'other-own-model', name: 'Other private', baseUrl: 'https://api.other.test/v1',
      modelId: 'other-v1', apiKey: 'synthetic-other-key' })
    assert.equal(otherCreated.status, 202)
    const otherPrivate = await settled(origin, otherAuth, 'other-own-model')
    assert.equal(otherPrivate.operation.status, 'succeeded')
    assert.equal((await api(origin, owner, 'GET', `/personal/v1/account/models/${otherPrivate.model.accountModelId}`)).status, 404)
    assert.equal((await api(origin, owner, 'GET', '/personal/v1/models')).body.models
      .some((item: any) => item.id === otherPrivate.model.profileId), false,
    'the legacy host owner cannot see another account private profile')
    assert.equal((await api(origin, owner, 'POST', '/personal/v1/commands', {
      requestId: 'host-owner-other-private', kind: 'session.create', targetDeviceId: hostId,
      modelProfileId: otherPrivate.model.profileId })).status, 422)
    const rename = await api(origin, owner, 'PATCH', `/personal/v1/account/models/${accountModelId}`, {
      requestId: 'model-rename', expectedRevision: 1, name: 'MiMo renamed' })
    assert.equal(rename.status, 202)
    const renamed = await settled(origin, owner, 'model-rename')
    assert.equal(renamed.model.revision, 2)
    assert.equal(renamed.model.profileId, oldProfileId)
    const update = await api(origin, owner, 'PATCH', `/personal/v1/account/models/${accountModelId}`, {
      requestId: 'model-update', expectedRevision: 2, modelId: 'mimo-v2' })
    assert.equal(update.status, 202)
    const updated = await settled(origin, owner, 'model-update')
    assert.equal(updated.model.revision, 3)
    assert.notEqual(updated.model.profileId, oldProfileId)
    assert.equal(credentials.get(updated.model.profileId), 'synthetic-key-one')
    const oldRetry = await api(origin, owner, 'PATCH', `/personal/v1/account/models/${accountModelId}`, {
      requestId: 'model-rename', expectedRevision: 1, name: 'MiMo renamed' })
    assert.equal(oldRetry.status, 200)
    assert.equal(oldRetry.body.operation.resultRevision, 2,
      'the original request remains idempotent after a later model revision')
    assert.equal((await api(origin, owner, 'POST', `/personal/v1/account/models/${accountModelId}/test`, {
      requestId: 'model-test', expectedRevision: 3 })).status, 202)
    assert.equal((await settled(origin, owner, 'model-test')).operation.testResult.modelListed, true)
    assert.equal((await api(origin, owner, 'POST', `/personal/v1/account/models/${accountModelId}/transfer`, {
      requestId: 'transfer-before-native', expectedRevision: 3 })).status, 403)
    assert.equal((await api(origin, owner, 'POST', '/personal/v1/sync/capabilities', {
      sharedConversations: 1, nativeVersionCode: 12 })).status, 200)
    const transfer = await api(origin, owner, 'POST', `/personal/v1/account/models/${accountModelId}/transfer`, {
      requestId: 'transfer-native', expectedRevision: 3 })
    assert.equal(transfer.status, 200)
    assert.equal(transfer.body.apiKey, 'synthetic-key-one')
    const session = await api(origin, owner, 'POST', '/personal/v1/commands', {
      requestId: 'private-before-stop', kind: 'session.create', targetDeviceId: hostId,
      modelProfileId: updated.model.profileId })
    assert.equal(session.status, 202, JSON.stringify(session.body))
    let createdSession: any
    for (let attempt = 0; attempt < 100; attempt++) {
      createdSession = (await api(origin, owner, 'GET',
        `/personal/v1/commands/${session.body.command.commandId}`)).body.command
      if (createdSession.state === 'accepted_by_dsh') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(createdSession.state, 'accepted_by_dsh')
    let releasePreflight!: () => void, enteredPreflight!: () => void
    let releaseCreate!: () => void, enteredCreate!: () => void
    const gate = new Promise<void>((resolve) => { releasePreflight = resolve })
    const entered = new Promise<void>((resolve) => { enteredPreflight = resolve })
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
    const createEntered = new Promise<void>((resolve) => { enteredCreate = resolve })
    let preflights = 0, createPreflights = 0
    backend.preflight = async (command: any) => {
      if (command.kind === 'session.message' && ++preflights === 2) {
        enteredPreflight(); await gate
      }
      if (command.kind === 'session.create' && command.requestId === 'create-delayed-at-preflight' &&
          ++createPreflights === 2) { enteredCreate(); await createGate }
      return { ok: true }
    }
    const waitingCreate = await api(origin, owner, 'POST', '/personal/v1/commands', {
      requestId: 'create-delayed-at-preflight', kind: 'session.create', targetDeviceId: hostId,
      modelProfileId: updated.model.profileId })
    assert.equal(waitingCreate.status, 202)
    await createEntered
    const waiting = await api(origin, owner, 'POST', '/personal/v1/commands', {
      requestId: 'message-delayed-at-preflight', kind: 'session.message', targetDeviceId: hostId,
      sessionId: createdSession.sessionId, text: 'This must not dispatch after stop intent' })
    assert.equal(waiting.status, 202)
    await entered
    let releaseSecret!: () => void
    secretWait = new Promise<void>((resolve) => { releaseSecret = resolve })
    const secretEntered = new Promise<void>((resolve) => { enteredSecretRead = resolve })
    const delayedTransfer = api(origin, owner, 'POST',
      `/personal/v1/account/models/${accountModelId}/transfer`, {
        requestId: 'transfer-delayed-during-stop', expectedRevision: 3 })
    await secretEntered
    assert.equal((await api(origin, owner, 'POST', `/personal/v1/account/models/${accountModelId}/stop-using`, {
      requestId: 'model-stop', expectedRevision: 3 })).status, 202)
    const stopped = await settled(origin, owner, 'model-stop')
    assert.equal(stopped.model.status, 'stopped')
    releaseSecret()
    const lateSecret = await delayedTransfer
    assert.equal(lateSecret.status, 409)
    assert.equal(lateSecret.body.apiKey, undefined)
    secretWait = null
    releasePreflight()
    releaseCreate()
    let rejected: any
    for (let attempt = 0; attempt < 100; attempt++) {
      rejected = (await api(origin, owner, 'GET',
        `/personal/v1/commands/${waiting.body.command.commandId}`)).body.command
      if (rejected.state !== 'pending') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(rejected.state, 'rejected')
    assert.equal(rejected.errorCode, 'MODEL_UNAVAILABLE')
    let rejectedCreate: any
    for (let attempt = 0; attempt < 100; attempt++) {
      rejectedCreate = (await api(origin, owner, 'GET',
        `/personal/v1/commands/${waitingCreate.body.command.commandId}`)).body.command
      if (rejectedCreate.state !== 'pending') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(rejectedCreate.state, 'rejected')
    assert.equal(rejectedCreate.errorCode, 'MODEL_UNAVAILABLE')
    assert.equal(sessions.size, 1, 'a second session is not created after stop intent')
    assert.equal(sentCount, 0, 'a stop accepted during dispatch preflight blocks the final send')
    assert.equal((await api(origin, owner, 'GET',
      `/personal/v1/sessions/${createdSession.sessionId}/events`)).status, 200,
    'the stopped account model does not hide owner-bound historical session reads')
    assert.equal(credentials.has(oldProfileId), false)
    assert.equal((await api(origin, owner, 'GET', '/personal/v1/models')).body.models.length, 0)
    assert.equal((await api(origin, owner, 'DELETE', `/personal/v1/account/models/${accountModelId}`, {
      requestId: 'model-remove', expectedRevision: stopped.model.revision })).status, 202)
    assert.equal((await settled(origin, owner, 'model-remove')).model.status, 'removed')
    assert.equal((await api(origin, owner, 'GET', '/personal/v1/account/models')).body.models.length, 0)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('busy registration keeps its request ID; lost success is reconciled without a second route write', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-account-model-reconcile-'))
  let busy = true, lostReply = false, applies = 0
  const stages = new Map<string, string>(), installed = new Set<string>()
  const manager = {
    stageSecret: async ({ stageRef, apiKey }: any) => { stages.set(stageRef, apiKey) },
    apply: async ({ target, stageRef }: any) => {
      applies++
      if (busy) throw Object.assign(new Error('busy'), { code: 'ACCOUNT_MODEL_BUSY' })
      if (target.modelId === 'bad-model') throw Object.assign(new Error('definite failure'),
        { code: 'ACCOUNT_MODEL_ROUTE_UNCONFIRMED', definite: true })
      assert.ok(stages.has(stageRef))
      installed.add(target.profileId)
      if (lostReply) throw Object.assign(new Error('lost reply'), { code: 'BACKEND_TIMEOUT' })
      return { applied: true }
    },
    inspect: async ({ target }: any) => ({ applied: installed.has(target.profileId),
      clean: !installed.has(target.profileId) }),
    hasCredential: (id: string) => installed.has(id),
    test: async () => ({ configured: true, reachable: true, modelListed: true }),
    disable: async () => ({ applied: true }),
    readSecret: async () => null,
  }
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [], preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId }: any) => ({ sessionId }),
    sendMessage: async () => ({ accepted: true }), cancelSession: async () => ({ accepted: true }),
    readEvents: async ({ afterSeq }: any) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async () => null,
  }
  const service = await createPersonalAccessService({ root, port: 0, backend, accountModelManager: manager })
  let reopened: Awaited<ReturnType<typeof createPersonalAccessService>> | null = null
  try {
    const { origin } = await service.start()
    const grant = await service.issueSetupGrant()
    const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: 'Owner', password, deviceName: 'Desktop' }) })
    assert.equal(setup.status, 201)
    const account = await setup.json()
    const auth = { origin, cookie: setup.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': account.csrfToken }
    const route = '/personal/v1/account/models'
    const one = { requestId: 'busy-create', name: 'Cloud A', baseUrl: 'https://api.example.test/v1',
      modelId: 'a', apiKey: 'synthetic-a' }
    assert.equal((await api(origin, auth, 'POST', route, one)).status, 202)
    for (let attempt = 0; attempt < 40 && applies === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    let pending: any
    for (let attempt = 0; attempt < 50; attempt++) {
      pending = (await api(origin, auth, 'GET', `${route}/by-request/${one.requestId}`)).body
      if (pending.operation.status === 'pending' && pending.operation.reasonCode === 'RUNTIME_BUSY') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(pending.operation.status, 'pending')
    assert.equal(pending.operation.reasonCode, 'RUNTIME_BUSY')
    assert.equal(pending.model.configured, false)
    busy = false
    assert.equal((await settled(origin, auth, one.requestId)).operation.status, 'succeeded')
    lostReply = true
    const two = { requestId: 'lost-create', name: 'Cloud B', baseUrl: 'https://api.example.test/v1',
      modelId: 'b', apiKey: 'synthetic-b' }
    assert.equal((await api(origin, auth, 'POST', route, two)).status, 202)
    for (let attempt = 0; attempt < 80; attempt++) {
      const state = (await api(origin, auth, 'GET', `${route}/by-request/${two.requestId}`)).body
      if (state.operation.status === 'succeeded') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const recovered = (await api(origin, auth, 'GET', `${route}/by-request/${two.requestId}`)).body
    assert.equal(recovered.operation.status, 'succeeded', JSON.stringify(recovered))
    assert.equal(applies, 3, 'busy first + one successful retry + one lost reply, no duplicate route write')
    await service.close()
    const storeFile = join(root, 'store.json')
    const stored = JSON.parse(readFileSync(storeFile, 'utf8'))
    const savedOwner = stored.accounts[account.account.ownerId]
    savedOwner.modelOperations[two.requestId].status = 'applying'
    savedOwner.accountModels[recovered.model.accountModelId].status = 'pending'
    writeFileSync(storeFile, JSON.stringify(stored), 'utf8')
    reopened = await createPersonalAccessService({ root, port: 0, backend, accountModelManager: manager })
    const cold = await reopened.start()
    const resumed = (await api(cold.origin, { ...auth, origin: cold.origin }, 'GET',
      `${route}/by-request/${two.requestId}`)).body
    assert.equal(resumed.operation.status, 'succeeded')
    assert.equal(resumed.model.status, 'active')
    assert.equal(applies, 3, 'restart observes the installed route without replaying the operation')
    const bad = await api(cold.origin, { ...auth, origin: cold.origin }, 'POST', route, {
      requestId: 'failed-create', name: 'Bad', baseUrl: 'https://api.example.test/v1',
      modelId: 'bad-model', apiKey: 'synthetic-bad' })
    assert.equal(bad.status, 202)
    const failed = await settled(cold.origin, { ...auth, origin: cold.origin }, 'failed-create')
    assert.equal(failed.operation.status, 'failed')
    assert.equal(failed.model.status, 'failed')
    const removed = await api(cold.origin, { ...auth, origin: cold.origin }, 'DELETE',
      `${route}/${failed.model.accountModelId}`, {
        requestId: 'remove-failed', expectedRevision: failed.model.revision })
    assert.equal(removed.status, 202)
    assert.equal((await settled(cold.origin, { ...auth, origin: cold.origin }, 'remove-failed')).model.status,
      'removed')
  } finally { await reopened?.close(); await service.close(); rmSync(root, { recursive: true, force: true }) }
})
