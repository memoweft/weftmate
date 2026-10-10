// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Real account ledger plus isolated MemoWeft Core recall for a bound private cloud revision. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { memoryRecallDestination } from '../../src/personal-memory/policy.mjs';
import { MemoWeftRpc } from '../../src/personal-memory/rpc.mjs';
import { boundaryForCompletedTurn } from '../../src/plugins/weftmate-personal-memory.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_REAL_PRIVATE_CLOUD_MEMORY_E2E !== '1') {
  throw new Error('Set WEFTMATE_REAL_PRIVATE_CLOUD_MEMORY_E2E=1 for this model-free Core acceptance.');
}
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
if (!existsSync(python)) throw new Error('MemoWeft Core Python runtime is unavailable');
const evidenceRoot = 'D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/Stage15-WindowsAndroid-20261005/Memory';
mkdirSync(evidenceRoot, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'weftmate-private-cloud-memory-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const password = 'synthetic private cloud memory password';
const staged = new Map(), credentials = new Map(), profiles = new Map(), sessions = new Map();
let legacyOwnerId = null;
const accountModelManager = {
  stageSecret: async ({ stageRef, apiKey }) => { staged.set(stageRef, apiKey); },
  apply: async ({ target, stageRef, previousProfileId }) => {
    const secret = stageRef ? staged.get(stageRef) : credentials.get(previousProfileId);
    if (!secret) throw Object.assign(new Error('missing secret'),
      { code: 'ACCOUNT_MODEL_SECRET_REQUIRED', definite: true });
    credentials.set(target.profileId, secret);
    profiles.set(target.profileId, { id: target.profileId, name: target.name,
      baseUrl: target.baseUrl, model: target.modelId });
    return { applied: true };
  },
  inspect: async ({ kind, target, profileIds }) => ({ applied: ['stop_using', 'remove'].includes(kind)
    ? profileIds.every((id) => !credentials.has(id)) : credentials.has(target.profileId) }),
  hasCredential: (profileId) => credentials.has(profileId),
  test: async () => ({ configured: true, reachable: true, modelListed: true }),
  disable: async ({ profileIds }) => {
    for (const profileId of profileIds) credentials.delete(profileId);
    return { applied: true };
  },
  readSecret: async ({ profileId }) => credentials.get(profileId) ?? null,
};
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [...profiles.values()].map((profile) => ({ ...profile,
    configured: credentials.has(profile.id) })),
  preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId, modelProfileId, ownerId }) => {
    sessions.set(sessionId, { modelProfileId, ownerId }); return { sessionId };
  },
  sendMessage: async () => ({ accepted: true, receiptId: 'synthetic-private-cloud-memory' }),
  cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
  describeSession: async (sessionId) => {
    const row = sessions.get(sessionId);
    return row ? { sessionId, modelProfileId: row.modelProfileId,
      agentPreset: row.ownerId === legacyOwnerId ? 'personal-remote' : 'personal-shared-chat' } : null;
  },
};
const service = await createPersonalAccessService({ root: join(root, 'access'), port: 0,
  backend, accountModelManager });
const memory = createPersonalMemoryManager({ root: join(root, 'memory'), enabled: true,
  python, pythonPath, baseUrl: 'http://127.0.0.1:8081/v1', model: '@current',
  credential: () => 'synthetic-no-network', rpcFactory: (options) => new MemoWeftRpc({ ...options,
    env: { ...options.env, MEMOWEFT_TESTING: '1', MEMOWEFT_TEST_MODEL_RESPONSE: '__smart__' } }) });

async function api(origin, auth, method, route, body) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
async function settled(origin, auth, requestId) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await api(origin, auth, 'GET', `/personal/v1/account/models/by-request/${requestId}`);
    if (!['pending', 'applying'].includes(value.body.operation.status)) return value.body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('account model operation did not settle');
}
async function acceptedCommand(origin, auth, commandId) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await api(origin, auth, 'GET', `/personal/v1/commands/${commandId}`);
    if (!['pending', 'dispatching'].includes(value.body.command.state)) return value.body.command;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('session command did not settle');
}
async function waitForWorld(ownerId, marker) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const world = await memory.query(ownerId, 'query_world', { operation: 'list',
      object_kind: 'cognition', include_history: true });
    if (world.items?.some((item) => item.value?.content?.includes(marker))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('isolated Core worker did not form the synthetic record');
}

const evidence = { startedAt: new Date().toISOString(), result: 'failed',
  fixture: 'synthetic; MEMOWEFT_TESTING=1; no paid or public model request', checks: {} };
try {
  const { origin, hostId } = await service.start();
  const grant = await service.issueSetupGrant();
  const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({
      grant: grant.grant, username: 'CloudMemoryA', password, deviceName: 'Desktop A' }) });
  assert.equal(setup.status, 201);
  const setupBody = await setup.json();
  legacyOwnerId = setupBody.account.ownerId;
  const authA = { origin, cookie: setup.headers.get('set-cookie').split(';')[0],
    'x-weftmate-csrf': setupBody.csrfToken };
  const registerB = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({
      username: 'CloudMemoryB', password, deviceName: 'Desktop B' }) });
  assert.equal(registerB.status, 201);
  const bodyB = await registerB.json();
  const ownerB = bodyB.account.ownerId;

  const create = await api(origin, authA, 'POST', '/personal/v1/account/models', {
    requestId: 'cloud-memory-model-create', name: 'Synthetic MiMo private',
    baseUrl: 'https://api.xiaomimimo.com/v1/chat/completions', modelId: 'mimo-v1',
    apiKey: 'synthetic-private-key' });
  assert.equal(create.status, 202, JSON.stringify(create.body));
  const created = await settled(origin, authA, 'cloud-memory-model-create');
  assert.equal(created.operation.status, 'succeeded');
  const oldProfileId = created.model.profileId;
  const createSession = await api(origin, authA, 'POST', '/personal/v1/commands', {
    requestId: 'cloud-memory-old-session', kind: 'session.create', targetDeviceId: hostId,
    modelProfileId: oldProfileId });
  assert.equal(createSession.status, 202, JSON.stringify(createSession.body));
  const session = await acceptedCommand(origin, authA, createSession.body.command.commandId);
  assert.equal(session.state, 'accepted_by_dsh');

  const update = await api(origin, authA, 'PATCH',
    `/personal/v1/account/models/${created.model.accountModelId}`, {
      requestId: 'cloud-memory-model-update', expectedRevision: 1, modelId: 'mimo-v2' });
  assert.equal(update.status, 202, JSON.stringify(update.body));
  const updated = await settled(origin, authA, 'cloud-memory-model-update');
  assert.equal(updated.operation.status, 'succeeded');
  assert.notEqual(updated.model.profileId, oldProfileId);

  const binding = service.ownerForSession(session.sessionId);
  assert.equal(binding.ownerId, legacyOwnerId);
  assert.equal(binding.modelProfileId, oldProfileId);
  const oldProfile = profiles.get(oldProfileId);
  const access = { ...service, privateAccountModelProof: (ownerId, profileId) => {
    const proof = service.privateAccountModelProof(ownerId, profileId);
    return proof && accountModelManager.hasCredential(profileId)
      ? { ...proof, credential: true } : null;
  } };
  const described = { agentPreset: binding.origin === 'personal-remote'
    ? 'personal-remote' : 'personal-shared-chat' };
  const destination = memoryRecallDestination({ binding, described,
    boundProfileId: oldProfileId, profiles: [oldProfile, profiles.get(updated.model.profileId)],
    access, hasCredential: (profile) => accountModelManager.hasCredential(profile.id) });
  assert.deepEqual(destination, { allowed: true, ownerId: legacyOwnerId });
  assert.equal(service.privateAccountModelProof(ownerB, oldProfileId), null);

  const marker = `合成私有云召回-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: 'cloud-memory-user', source: { kind: 'user' },
      content: [{ type: 'text', text: `我的专属标记是${marker}` }] } },
    { seq: 3, type: 'assistant/message', data: { message: { id: 'cloud-memory-assistant',
      content: [{ type: 'text', text: '已记录合成标记' }] } } },
    { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
  ];
  const boundary = boundaryForCompletedTurn({ id: session.sessionId,
    header: { agentPreset: described.agentPreset }, events }, events.at(-1));
  assert.equal((await memory.ingest(destination.ownerId, boundary)).state, 'accepted');
  await waitForWorld(destination.ownerId, marker);
  const recalled = await memory.recall(destination.ownerId,
    { query: '我的专属标记是什么？', sessionId: session.sessionId });
  const foreign = await memory.recall(ownerB,
    { query: '我的专属标记是什么？', sessionId: 'session-foreign-cloud-memory' });
  assert.equal(recalled.state, 'ready');
  assert.match(recalled.contextText, new RegExp(marker));
  assert.equal(foreign.state, 'ready');
  assert.equal(foreign.contextText.includes(marker), false);

  const stop = await api(origin, authA, 'POST',
    `/personal/v1/account/models/${created.model.accountModelId}/stop-using`, {
      requestId: 'cloud-memory-model-stop', expectedRevision: updated.model.revision });
  assert.equal(stop.status, 202);
  const stopped = await settled(origin, authA, 'cloud-memory-model-stop');
  assert.equal(stopped.model.status, 'stopped');
  const revoked = memoryRecallDestination({ binding, described, boundProfileId: oldProfileId,
    profiles: [oldProfile], access, hasCredential: (profile) => accountModelManager.hasCredential(profile.id) });
  assert.deepEqual(revoked, { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' });

  evidence.result = 'passed';
  evidence.checks = { actualLedgerOldRevisionProof: true, settingsProfileHadStoredFingerprint: false,
    ownerCloudDestinationAllowed: destination.allowed, ownerRecallState: recalled.state,
    ownerContextContainedMarker: recalled.contextText.includes(marker), foreignLedgerProofRejected: true,
    foreignContextContainedMarker: foreign.contextText.includes(marker), revokedDestinationBlocked: !revoked.allowed,
    markerHash: createHash('sha256').update(marker).digest('hex') };
  console.log('[personal-memory-private-cloud-recall] actual old ledger revision allowed; owner Core context nonempty; foreign owner empty; stopped route blocked');
} catch (error) {
  evidence.failure = { name: error?.name ?? 'Error', message: String(error?.message ?? error) };
  throw error;
} finally {
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(evidenceRoot, 'private-cloud-recall-core.json'),
    `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  await memory.close().catch(() => {});
  await service.close().catch(() => {});
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
  rmSync(root, { recursive: true, force: true });
}
