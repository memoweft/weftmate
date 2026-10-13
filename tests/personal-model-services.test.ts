import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { createModelServiceOperations, mergeLegacyModelServices } from '../src/personal-access/model-services.mjs';
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs';
import { createMainChat } from '../src/personal-access/main-chat.mjs';
import { createAccountModelOperations } from '../src/personal-access/account-models.mjs';
import { privateProfileId, publicAccountModel } from '../src/personal-account-models/index.mjs';
import { createCommandOperations } from '../src/personal-access/commands.mjs';
import { modelReasoning, reasoningCapability } from '../src/model-reasoning.mjs';
import { normalizeProductConfig } from '../src/stage2-config.ts';
import { projectOfficialProviderConfig } from '../src/dsh-settings-migration.ts';

const timestamp = '2026-10-13T00:00:00.000Z';
const api = async (origin: string, auth: any, method: string, route: string, body?: any) => {
  const response = await fetch(origin + '/personal/v1' + route, { method, headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
};
async function waitFor(callback: () => Promise<any>, predicate: (value: any) => boolean) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { const value = await callback(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('expected state did not arrive');
}

test('explicit directory reasoning is retained in settings, DSH declarations and the legacy account projection without inferring unknown names', () => {
  const profile = { id: 'directory-declared', name: 'Declared model', provider: 'openai-compatible', baseUrl: 'https://service.example.test/v1', model: 'unknown-chat',
    deepThinking: { supported: true, effort: 'high' } };
  const saved = normalizeProductConfig({ models: { profiles: [profile], activeId: profile.id } }).models.profiles[0];
  assert.deepEqual(saved.deepThinking, { supported: true, effort: 'high' }); assert.equal(reasoningCapability(saved).supported, true);
  const native = projectOfficialProviderConfig({ route: profile.id, displayName: profile.name, baseURL: profile.baseUrl,
    models: [{ id: profile.model, name: profile.name, contextWindow: 8192, maxTokens: 1024, ...modelReasoning(saved) }] });
  assert.equal(native.models[0].reasoningEfforts?.high, 'high'); assert.equal(native.models[0].compat?.thinkingFormat, 'openai');
  const old = publicAccountModel({ accountModelId: 'synthetic-account', revision: 1, runtimeRevision: 1, name: profile.name,
    revisions: { '1': { profileId: profile.id, modelId: profile.model, baseUrl: profile.baseUrl, deepThinking: saved.deepThinking } } }, true);
  assert.equal(old.deepThinking.supported, true);
  assert.equal(reasoningCapability({ baseUrl: profile.baseUrl, model: profile.model }).supported, false, 'absence remains unknown');
  assert.equal(reasoningCapability({ ...saved, deepThinking: { supported: false } }).supported, false, 'explicit unsupported remains unsupported');
});

test('native backend updates only idle routes and the main chat accepts its selected next model', async () => {
  const profiles = [{ id: 'original-model', model: 'chat-one' }, { id: 'next-model', model: 'chat-two' }];
  const current: any = { sessionId: 'session-one', agentPreset: 'personal-remote', running: true };
  let bound = profiles[0].id; const writes: any[] = [];
  const backend = createPersonalAccessBackend({ currentOrigin: () => 'http://runtime.invalid', referenceScan: () => ({ state: 'ready' }),
    profiles: () => profiles, hasCredential: () => true, routeForProfile: (id: string) => ({ provider: id }),
    listSessions: async () => ({ items: [current] }), resolveSession: async () => ({ profile: profiles.find(row => row.id === bound) }),
    ensureKnownSession: async () => {}, bindSession: (_session: string, id: string) => { bound = id; }, queue: (work: any) => work(),
    gateway: async (route: string, options: any) => {
      if (route === '/models') return { groups: profiles.map(row => ({ id: row.id, models: [{ id: row.model }] })) };
      if (!options) return current;
      writes.push({ route, body: JSON.parse(options.body) }); return {};
    } });
  assert.deepEqual(await backend.selectSessionModel({ ownerId: 'owner', sessionId: current.sessionId, modelProfileId: profiles[1].id }), { pending: true });
  assert.equal(writes.length, 0); assert.equal(bound, profiles[0].id);
  current.running = false;
  await backend.selectSessionModel({ ownerId: 'owner', sessionId: current.sessionId, modelProfileId: profiles[1].id });
  assert.equal(bound, profiles[1].id); assert.deepEqual(writes, [{ route: '/sessions/session-one/models', body: { provider: 'next-model', model: 'chat-two' } }]);

  const account: any = { hostId: 'host-one', sessions: { 'session-one': { modelProfileId: profiles[0].id, pendingModelProfileId: profiles[1].id } }, commands: {},
    devices: { 'device-one': { authKind: 'desktop', authEpoch: 0 } }, chatIdentity: { mainChatId: 'chat-main', chats: { 'chat-main': { chatId: 'chat-main', activeSegmentId: 'segment-one' } }, segments: { 'segment-one': { sessionId: 'session-one' } } } };
  const context: any = { accountState: () => account, serial: (work: any) => work(), hostOwner: () => true, modelSelectable: () => true,
    backend: { listModels: async () => profiles }, usage: { assertAllowed: () => {} }, requestIdUsed: () => false, timestamp: Date.now,
    mutate: (_owner: string, update: any) => update(account), schedule: () => {} };
  const mainChat = createMainChat(context);
  const receipt = await mainChat.submit('owner', 'device-one', { requestId: 'send-selected-main', kind: 'chat.message', targetDeviceId: 'host-one', chatId: 'chat-main', modelProfileId: profiles[1].id, text: 'Next model.' }, () => ({ ownerId: 'owner', deviceId: 'device-one' }));
  assert.equal(receipt.state, 'pending'); assert.equal(account.commands[receipt.commandId].payload.modelProfileId, profiles[1].id);
  assert.equal(account.sessions['session-one'].modelProfileId, profiles[0].id, 'main chat acceptance does not change a running response');
});

test('a released main-chat client may echo the running model while the pending next model stays authoritative', async () => {
  const original = 'running-model', selected = 'selected-next-model', modelChecks: string[] = [], usageModels: string[] = [];
  const account: any = { hostId: 'host-one', defaultModelProfileId: selected, sessions: { 'session-one': { modelProfileId: original, pendingModelProfileId: selected } }, commands: {},
    devices: { 'device-old': { authKind: 'desktop', authEpoch: 0 } }, chatIdentity: { mainChatId: 'chat-main', chats: { 'chat-main': { chatId: 'chat-main', activeSegmentId: 'segment-one' } }, segments: { 'segment-one': { sessionId: 'session-one' } } } };
  const context: any = { accountState: () => account, serial: async (work: any) => work(), hostOwner: () => true,
    modelSelectable: (_owner: string, profile: string) => { modelChecks.push(profile); return true; }, backend: { listModels: async () => [{ id: original }, { id: selected }] },
    usage: { assertAllowed: (_owner: string, model: any) => { usageModels.push(model.id); } }, requestIdUsed: () => false, timestamp: Date.now,
    mutate: (_owner: string, update: any) => update(account), schedule: () => {} };
  const main = createMainChat(context), authorize = () => ({ ownerId: 'owner', deviceId: 'device-old' });
  const body = { requestId: 'old-client-message', kind: 'chat.message', targetDeviceId: account.hostId, chatId: 'chat-main', modelProfileId: original, text: 'Old client sends while the old response is running.' };
  const old = await main.submit('owner', 'device-old', body, authorize); assert.equal(old.state, 'pending');
  const modern = await main.submit('owner', 'device-old', { ...body, requestId: 'modern-client-message', modelProfileId: selected }, authorize); assert.equal(modern.state, 'pending');
  assert.deepEqual(modelChecks, [selected, selected]); assert.deepEqual(usageModels, [selected, selected]);
  assert.equal(account.sessions['session-one'].pendingModelProfileId, selected); assert.equal(account.defaultModelProfileId, selected);
  assert.equal(account.commands[old.commandId].payload.modelProfileId, original, 'the original old-client request remains replayable');
  const retry = await main.submit('owner', 'device-old', body, authorize); assert.equal(retry.commandId, old.commandId);
  await assert.rejects(main.submit('owner', 'device-old', { ...body, requestId: 'unrelated-model', modelProfileId: 'different-model' }, authorize), (error: any) => error.code === 'REQUEST_CONFLICT');
});

test('switching after a runtime reload resumes the cold gateway session before selecting its new model', async () => {
  const profiles = [{ id: 'original-model', model: 'chat-one' }, { id: 'next-model', model: 'chat-two' }];
  const current = { sessionId: 'session-cold', agentPreset: 'personal-remote', running: false };
  let gatewayRecord = false, nativeProfileId = profiles[0].id, binding = profiles[0].id;
  const writes: string[] = [];
  const gateway = async (route: string, options?: any) => {
    if (route === '/models') return { groups: profiles.map(row => ({ id: row.id, models: [{ id: row.model }] })) };
    if (!options) return current;
    if (route.endsWith('/resume')) { gatewayRecord = true; writes.push('resume'); return { sessionId: current.sessionId }; }
    if (route.endsWith('/models')) {
      if (!gatewayRecord) throw Object.assign(new Error('gateway record is cold'), { code: 'session-not-found' });
      nativeProfileId = JSON.parse(options.body).provider; writes.push('select'); return {};
    }
    throw new Error('unexpected synthetic route');
  };
  const backend = createPersonalAccessBackend({ currentOrigin: () => 'http://runtime.invalid', referenceScan: () => ({ state: 'ready' }),
    profiles: () => profiles, hasCredential: () => true, routeForProfile: (id: string) => ({ provider: id }),
    listSessions: async () => ({ items: [current] }), resolveSession: async () => ({ profile: profiles.find(row => row.id === nativeProfileId) }),
    ensureKnownSession: async (sessionId: string) => { assert.equal(binding, profiles[0].id); await gateway(`/sessions/${sessionId}/resume`, { method: 'POST', body: '{}' }); },
    bindSession: (_session: string, id: string) => { binding = id; }, queue: (work: any) => work(), gateway });
  await backend.selectSessionModel({ ownerId: 'owner', sessionId: current.sessionId, modelProfileId: profiles[1].id });
  assert.deepEqual(writes, ['resume', 'select']); assert.equal(binding, profiles[1].id); assert.equal(nativeProfileId, profiles[1].id);
});

test('the 500-item legacy projection keeps current, default, background, original and recently used models from a long service catalog', () => {
  const ownerId = 'owner', accountModels: any = {}, catalog: any[] = [], serviceModels: any[] = [];
  for (let index = 0; index < 600; index++) {
    const accountModelId = `account-model-${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
    const profileId = privateProfileId(ownerId, accountModelId, 1), modelId = `chat-${index}`;
    accountModels[accountModelId] = { accountModelId, name: modelId, revision: 1, runtimeRevision: 1, status: 'active',
      revisions: { '1': { profileId, modelId, baseUrl: 'https://service.example.test/v1', ...(index === 598 ? {} : { interfaceType: 'openai-compatible' }) } } };
    catalog.push({ id: profileId, name: modelId, model: modelId, configured: true });
    serviceModels.push({ modelId, profileId, profileIds: [profileId], enabled: true, ...(index === 597 ? { lastUsedAt: timestamp } : {}) });
  }
  const account: any = { accountModels, sessions: { current: { modelProfileId: catalog[599].id } }, defaultModelProfileId: catalog[596].id, backgroundModelProfileId: catalog[595].id,
    modelServices: { service: { status: 'active', models: serviceModels } } };
  const context: any = { accountState: () => account, rootState: { accounts: { owner: account }, executionOwnerId: ownerId, sharedModelProfiles: [] } };
  const result = createAccountModelOperations(context).visibleModels(ownerId, catalog);
  assert.equal(result.length, 500); for (const index of [595,596,597,598,599]) assert.equal(result.some((row: any) => row.id === catalog[index].id), true, String(index));
  assert.equal(account.modelServices.service.models.length, 600, 'the complete service catalog remains searchable');
});

test('registration may ignore its unissued main-chat message but keeps other pending and dispatched commands blocking reload', () => {
  const commands: any = { own: { kind: 'chat.message', state: 'pending', payload: { modelProfileId: 'reserved-profile' } } };
  const operations = createCommandOperations({ rootState: { accounts: { owner: { commands, defaultModelProfileId: 'reserved-profile' } } } });
  assert.equal(operations.hasUnissuedDshCommands(), true);
  assert.equal(operations.hasUnissuedDshCommands({ allowedPendingModelProfileId: 'reserved-profile' }), false);
  commands.other = { kind: 'chat.message', state: 'pending', payload: { modelProfileId: 'other-profile' } };
  assert.equal(operations.hasUnissuedDshCommands({ allowedPendingModelProfileId: 'reserved-profile' }), true);
  delete commands.other; commands.own.state = 'dispatching';
  assert.equal(operations.hasUnissuedDshCommands({ allowedPendingModelProfileId: 'reserved-profile' }), true);
});

test('a non-busy model preparation failure settles the unissued command without inference or private details', async () => {
  const account: any = { defaultModelProfileId: 'reserved-profile', sessions: {}, commands: { 'cmd-pending': { kind: 'chat.message', state: 'pending', payload: { modelProfileId: 'reserved-profile' } } },
    chatIdentity: { mainChatId: 'chat-main', chats: { 'chat-main': { activeSegmentId: null } }, segments: {} } };
  let inference = 0;
  const operations = createCommandOperations({ closing: false, storageFault: false, timestamp: Date.now, accountState: () => account,
    modelServices: { ensureProfile: async () => { throw Object.assign(new Error('private synthetic route detail'), { code: 'BACKEND_UNAVAILABLE' }); } },
    mainChat: { bind: async () => { inference++; } }, serial: async (work: any) => work(), mutate: async (_owner: string, update: any) => update(account) });
  await operations.dispatch('owner', 'cmd-pending'); assert.equal(inference, 0); assert.equal(account.commands['cmd-pending'].state, 'rejected');
  assert.equal(account.commands['cmd-pending'].errorCode, 'BACKEND_UNAVAILABLE'); assert.equal(JSON.stringify(account).includes('private synthetic route detail'), false);
});

test('legacy migration groups exact address and secret, keeps every old reference and is idempotent', () => {
  const first = randomBytes(24).toString('hex'), second = randomBytes(24).toString('hex');
  const profiles = [{ profileId: 'old-flash', modelId: 'mimo-v2.6-flash', baseUrl: 'https://one.example.test/v1/chat/completions', name: 'MiMo', secret: first },
    { profileId: 'old-pro', modelId: 'mimo-v2.6-pro', baseUrl: 'https://one.example.test/v1', name: 'MiMo Pro', secret: first },
    { profileId: 'another-key', modelId: 'other-chat', baseUrl: 'https://one.example.test/v1', name: 'Another', secret: second },
    { profileId: 'another-service', modelId: 'elsewhere', baseUrl: 'https://two.example.test/v1', name: 'Elsewhere', secret: first }];
  const single = mergeLegacyModelServices({}, profiles.slice(0, 1), 'old-flash', timestamp); assert.equal(Object.keys(single).length, 1);
  const merged = mergeLegacyModelServices({}, profiles, 'old-pro', timestamp), rows = Object.values(merged) as any[];
  assert.equal(rows.length, 3); const service = rows.find(row => row.models.length === 2);
  assert.equal(service.selectedModelId, 'mimo-v2.6-pro'); assert.equal(service.models.every((row: any) => row.enabled), true);
  assert.deepEqual(service.models.map((row: any) => row.profileId), ['old-flash', 'old-pro']);
  assert.deepEqual(mergeLegacyModelServices(merged, profiles, 'old-pro', timestamp), merged);
  assert.equal(JSON.stringify(merged).includes(first), false); assert.equal(JSON.stringify(merged).includes(second), false);
});

test('migration leaves the exact old state available after a write failure and keeps a preimage backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'model-migration-failure-'));
  const original = { accounts: { owner: { sessions: {}, commands: {}, defaultModelProfileId: 'old-flash', backgroundModelProfileId: 'old-flash' } } };
  const secret = randomBytes(24).toString('hex'); let failed = true;
  const context: any = { root, rootState: original, timestamp: () => Date.parse(timestamp), accountState: () => original.accounts.owner,
    hostOwner: () => true, serial: (work: any) => work(), accountModelManager: { listProfiles: () => [{ id: 'old-flash', model: 'mimo-v2.6-flash', baseUrl: 'https://service.example.test/v1', name: 'MiMo' }], readSecret: () => secret },
    mutate: (_owner: any, update: any) => { if (failed) throw new Error('injected atomic replacement failure'); update(original.accounts.owner); } };
  try {
    const operations = createModelServiceOperations(context); await operations.migrate('owner');
    assert.equal((original.accounts.owner as any).modelServices, undefined); assert.equal(original.accounts.owner.defaultModelProfileId, 'old-flash');
    const backup = JSON.parse(await readFile(join(root, 'model-services-v1.before.json'), 'utf8')); assert.deepEqual(backup, original);
    failed = false; await operations.migrate('owner'); assert.equal(Object.keys((original.accounts.owner as any).modelServices).length, 1);
    assert.equal(original.accounts.owner.backgroundModelProfileId, 'old-flash');
    const stable = JSON.stringify(original); await operations.migrate('owner'); assert.equal(JSON.stringify(original), stable);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('expired directory returns cached choices immediately and coalesces background refresh; unsupported services retain a manual model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'model-service-refresh-'));
  const secret = randomBytes(24).toString('hex'); let queries = 0, releaseDirectory: (() => void) | undefined;
  const directory = createServer((request, response) => {
    queries++;
    assert.equal(request.headers.authorization === `Bearer ${secret}`, true);
    if (request.url === '/manual/v1/models') { response.writeHead(404); response.end(); return; }
    releaseDirectory = () => { if (response.writableEnded) return; response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'existing-chat', display_name: 'Service supplied label' }] })); };
  });
  await new Promise<void>(resolve => directory.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(directory.address() as any).port}/v1`;
  const services = mergeLegacyModelServices({}, [{ profileId: 'legacy-chat', modelId: 'existing-chat', baseUrl, secret, name: 'Synthetic' }], 'legacy-chat', timestamp);
  const record = Object.values(services)[0] as any; record.catalog = { status: 'available', message: 'Previous directory', checkedAt: new Date(Date.now() - 3_600_001).toISOString() };
  let account: any = { sessions: {}, commands: {}, defaultModelProfileId: 'legacy-chat', modelServices: services };
  const staged = new Map<string, string>();
  const context: any = { root, rootState: { accounts: { owner: account } }, timestamp: Date.now, accountState: () => account, hostOwner: () => true,
    serial: (work: any) => work(), closingSignal: new AbortController().signal, requestIdUsed: () => false,
    mutate: (_owner: any, update: any) => { const next = structuredClone(account); update(next); account = next; context.rootState.accounts.owner = next; },
    accountModelManager: { listProfiles: () => [], readSecret: () => secret, stageSecret: ({ stageRef, apiKey }: any) => staged.set(stageRef, apiKey), readStagedSecret: ({ stageRef }: any) => staged.get(stageRef),
      apply: async ({ targets }: any) => { assert.equal(targets[0].modelId, 'manual-chat'); return { applied: true }; } } };
  const operations = createModelServiceOperations(context);
  try {
    const cached = await operations.list('owner'); assert.equal(cached[0].models[0].name, 'Existing Chat'); assert.equal(cached[0].catalog.message, 'Previous directory');
    await waitFor(async () => queries, value => value === 1);
    const first = operations.refresh('owner', record.serviceId), second = operations.refresh('owner', record.serviceId); assert.equal(first, second);
    releaseDirectory!(); const refreshed = await first; assert.equal(refreshed.catalog.status, 'available'); assert.equal(refreshed.models[0].name, 'Service supplied label');
    await operations.list('owner'); assert.equal(queries, 1, 'fresh cache remains fresh');
    const manual = await operations.configure('owner', { requestId: 'manual-service', name: 'Manual', baseUrl: baseUrl.replace('/v1', '/manual/v1'), apiKey: secret, modelId: 'manual-chat' });
    assert.equal(manual.service.catalog.status, 'unsupported'); assert.equal(manual.service.models[0].modelId, 'manual-chat'); assert.equal(manual.service.selectedModelId, 'manual-chat');
    assert.equal(JSON.stringify(account).includes(secret), false);
  } finally { releaseDirectory?.(); await operations.close(); await new Promise<void>(resolve => directory.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test('service routes discover multiple models, cache directory, hide models, switch next idle message and survive restart with old routes readable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'personal-model-services-'));
  const secret = randomBytes(24).toString('hex'), staged = new Map<string, string>(), credentials = new Map<string, string>();
  const profiles = new Map<string, any>(), sessions = new Map<string, any>();
  const sent: string[] = [], sentThinking: boolean[] = []; let queries = 0, discoveredExtra = false, discoveredBlank = false, installedWithPendingSession: string | null = null, installedWithPendingProfile: string | null = null;
  const directory = createServer((request, response) => {
    queries++; assert.equal(request.url, '/v1/models'); assert.equal(request.headers.authorization === `Bearer ${secret}`, true);
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'mimo-v2.6-flash' }, { id: 'mimo-v2.6-pro', display_name: 'MiMo Pro', supports_reasoning: true }, { id: 'mimo-v2.5-asr' }, ...(discoveredExtra ? [{ id: 'newly-discovered-chat' }] : []), ...(discoveredBlank ? [{ id: 'new-conversation-chat' }] : [])] }));
  });
  await new Promise<void>(resolve => directory.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(directory.address() as any).port}/v1`;
  const manager = { stageSecret: async ({ stageRef, apiKey }: any) => { staged.set(stageRef, apiKey); },
    apply: async ({ target, targets, stageRef, previousProfileId, allowedPendingSessionId, allowedPendingModelProfileId }: any) => {
      if ([...sessions.values()].some(session => session.running)) throw Object.assign(new Error('synthetic runtime busy'), { code: 'ACCOUNT_MODEL_BUSY' });
      if (allowedPendingSessionId) installedWithPendingSession = allowedPendingSessionId;
      if (allowedPendingModelProfileId) installedWithPendingProfile = allowedPendingModelProfileId;
      if (allowedPendingSessionId || allowedPendingModelProfileId) {
        assert.equal(service.hasUnissuedDshCommands(), true, 'the selected next message is still unissued');
        assert.equal(service.hasUnissuedDshCommands({ allowedPendingSessionId, allowedPendingModelProfileId }), false, 'only the matching unissued message is exempt from reload');
      }
      for (const row of targets ?? [target]) { credentials.set(row.profileId, (stageRef ? staged.get(stageRef) : credentials.get(previousProfileId))!); profiles.set(row.profileId, { id: row.profileId, model: row.modelId, name: row.name, baseUrl: row.baseUrl, deepThinking: row.deepThinking }); }
      if (stageRef) staged.delete(stageRef); return { applied: true };
    }, inspect: async () => ({ applied: true }), hasCredential: (id: string) => credentials.has(id), test: async () => ({ configured: true, reachable: true, modelListed: true }),
    disable: async ({ profileIds, stageRefs }: any) => { for (const id of profileIds) credentials.delete(id); for (const ref of stageRefs) staged.delete(ref); return { applied: true }; },
    readSecret: async ({ profileId }: any) => credentials.get(profileId), readStagedSecret: async ({ stageRef }: any) => staged.get(stageRef) };
  const backend = { getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [...profiles.values()].map(row => ({ id: row.id, name: row.name, model: row.model, configured: credentials.has(row.id), deepThinking: reasoningCapability(row) })),
    preflight: async () => ({ ok: true }), createSession: async ({ sessionId, modelProfileId }: any) => { sessions.set(sessionId, { profileId: modelProfileId, running: false }); return { sessionId }; },
    selectSessionModel: async ({ sessionId, modelProfileId }: any) => { const session = sessions.get(sessionId); if (session.running) return { pending: true }; session.profileId = modelProfileId; return { modelProfileId }; },
    sendMessage: async ({ sessionId, deepThinking }: any) => { sent.push(profiles.get(sessions.get(sessionId).profileId).model); sentThinking.push(deepThinking === true); return { accepted: true, receiptId: 'rpc-synthetic' }; },
    cancelSession: async () => ({ accepted: true }), readEvents: async ({ afterSeq = -1 }: any) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    chatRelayState: async () => ({ safe: false, pending: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId) ? { sessionId, agentPreset: 'personal-remote', modelProfileId: sessions.get(sessionId).profileId, running: sessions.get(sessionId).running } : null };
  let service = await createPersonalAccessService({ root, port: 0, backend, accountModelManager: manager });
  try {
    let { origin, hostId } = await service.start(); const grant = await service.issueSetupGrant();
    const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, username: 'Synthetic', password: 'synthetic service account password', deviceName: 'synthetic-host' }) });
    const account = await setup.json(), auth = { origin, cookie: setup.headers.get('set-cookie')!.split(';')[0], 'x-weftmate-csrf': account.csrfToken };
    const check = await api(origin, auth, 'POST', '/model-services/check', { baseUrl, apiKey: secret }); assert.equal(check.status, 200); assert.equal(check.body.models.length, 2);
    const created = await api(origin, auth, 'POST', '/model-services', { requestId: 'service-create', name: 'MiMo', baseUrl, apiKey: secret });
    assert.equal(created.status, 201, JSON.stringify(created.body)); const modelService = created.body.service;
    assert.equal(modelService.models.length, 2); assert.equal(modelService.selectedModelId, 'mimo-v2.6-flash');
    assert.equal(JSON.stringify(created.body).includes(secret), false);
    const route = `/model-services/${modelService.serviceId}`;
    assert.equal((await api(origin, auth, 'GET', '/model-services')).body.services.length, 1);
    assert.equal(queries, 2, 'fresh cached catalog does not issue another request');
    assert.equal((await api(origin, auth, 'GET', '/models')).body.models.length, 2);
    const old = await api(origin, auth, 'GET', '/account/models'); assert.equal(old.body.models.length, 2); assert.equal(old.body.models.every((row: any) => typeof row.accountModelId === 'string' && typeof row.profileId === 'string'), true);
    const flash = modelService.models[0], pro = modelService.models[1];
    const createSession = await api(origin, auth, 'POST', '/commands', { requestId: 'new-session', kind: 'session.create', targetDeviceId: hostId, modelProfileId: flash.profileId }); assert.equal(createSession.status, 202);
    const sessionId = createSession.body.command.sessionId;
    await waitFor(() => api(origin, auth, 'GET', `/commands/${createSession.body.command.commandId}`), value => value.body.command.state === 'accepted_by_dsh');
    sessions.get(sessionId).running = true;
    const selected = await api(origin, auth, 'POST', route + '/select', { modelId: pro.modelId, sessionId }); assert.equal(selected.status, 200); assert.equal(selected.body.profileId, pro.profileId);
    assert.equal(selected.body.models.find((row: any) => row.id === pro.profileId).deepThinking.supported, true, 'declared capability reaches the public model list');
    assert.equal((await api(origin, auth, 'GET', '/account/models')).body.models.find((row: any) => row.profileId === pro.profileId).deepThinking.supported, true);
    const enabledThinking = await api(origin, auth, 'PATCH', `/sessions/${sessionId}/thinking`, { enabled: true });
    assert.equal(enabledThinking.status, 200); assert.equal(enabledThinking.body.supported, true); assert.equal(enabledThinking.body.enabled, true, 'next selected model accepts the thinking toggle before its route switch');
    assert.equal(sessions.get(sessionId).profileId, flash.profileId, 'running response stays on its original model');
    const nextChoice = (await api(origin, auth, 'GET', '/sessions')).body.sessions.find((row: any) => row.sessionId === sessionId);
    assert.equal(nextChoice.modelProfileId, flash.profileId); assert.equal(nextChoice.selectedModelProfileId, pro.profileId);
    const message = await api(origin, auth, 'POST', '/commands', { requestId: 'next-message', kind: 'session.message', targetDeviceId: hostId, sessionId, text: 'Use the newly selected model.' }); assert.equal(message.status, 202, JSON.stringify(message.body));
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(sent.length, 0);
    sessions.get(sessionId).running = false;
    await waitFor(() => api(origin, auth, 'GET', `/commands/${message.body.command.commandId}`), value => value.body.command.state === 'accepted_by_dsh');
    assert.deepEqual(sent, ['mimo-v2.6-pro']);
    assert.equal(sentThinking[0], true, 'the next message receives the declared-model thinking preference');
    sessions.get(sessionId).running = true; discoveredExtra = true;
    const discovery = await api(origin, auth, 'POST', route + '/refresh', {}); assert.equal(discovery.status, 200);
    const extra = discovery.body.service.models.find((row: any) => row.modelId === 'newly-discovered-chat'); assert.equal(extra.profileId, undefined);
    const delayed = await api(origin, auth, 'POST', route + '/select', { modelId: extra.modelId, sessionId }); assert.equal(delayed.status, 200, JSON.stringify(delayed.body));
    assert.equal(delayed.body.service.models.find((row: any) => row.modelId === extra.modelId).pendingInstallation, true);
    assert.equal(delayed.body.models.find((row: any) => row.id === delayed.body.profileId).configured, true, 'stored service key keeps next-message selection usable');
    assert.equal(sessions.get(sessionId).profileId, pro.profileId, 'unregistered discovery still leaves the running model intact');
    const queued = await api(origin, auth, 'POST', '/commands', { requestId: 'discovered-next-message', kind: 'session.message', targetDeviceId: hostId, sessionId, text: 'Use the newly discovered model after this reply.' }); assert.equal(queued.status, 202);
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(sent.length, 1);
    sessions.get(sessionId).running = false;
    await waitFor(() => api(origin, auth, 'GET', `/commands/${queued.body.command.commandId}`), value => value.body.command.state === 'accepted_by_dsh');
    assert.deepEqual(sent, ['mimo-v2.6-pro', extra.modelId]); assert.equal(installedWithPendingSession, sessionId);
    assert.equal((await api(origin, auth, 'GET', route)).body.service.models.find((row: any) => row.modelId === extra.modelId).pendingInstallation, undefined);
    const blankChat = (await api(origin, auth, 'GET', '/chats/main')).body.chat;
    assert.equal(blankChat.activeSessionId, null, 'the main conversation has no execution segment yet');
    sessions.get(sessionId).running = true; discoveredBlank = true;
    const blankDiscovery = await api(origin, auth, 'POST', route + '/refresh', {}); assert.equal(blankDiscovery.status, 200);
    const blankSelection = await api(origin, auth, 'POST', route + '/select', { modelId: 'new-conversation-chat' }); assert.equal(blankSelection.status, 200);
    assert.equal(blankSelection.body.service.models.find((row: any) => row.modelId === 'new-conversation-chat').pendingInstallation, true);
    const sessionCount = sessions.size;
    const blankMessage = await api(origin, auth, 'POST', '/commands', { requestId: 'blank-next-message', kind: 'chat.message', targetDeviceId: hostId,
      chatId: blankChat.chatId, modelProfileId: blankSelection.body.profileId, text: 'Start the new conversation using the selected model.' });
    assert.equal(blankMessage.status, 202, JSON.stringify(blankMessage.body));
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(sessions.size, sessionCount); assert.equal(sent.length, 2, 'other native reply keeps registration and the new conversation waiting');
    sessions.get(sessionId).running = false;
    const blankSent = await waitFor(() => api(origin, auth, 'GET', `/commands/${blankMessage.body.command.commandId}`), value => value.body.command.state === 'accepted_by_dsh');
    assert.equal(sessions.size, sessionCount + 1); assert.equal(sessions.get(blankSent.body.command.sessionId).profileId, blankSelection.body.profileId);
    assert.equal(installedWithPendingProfile, blankSelection.body.profileId); assert.deepEqual(sent, ['mimo-v2.6-pro', extra.modelId, 'new-conversation-chat']);
    assert.equal((await api(origin, auth, 'GET', route)).body.service.models.find((row: any) => row.modelId === 'new-conversation-chat').pendingInstallation, undefined);
    const mainSessionId = blankSent.body.command.sessionId;
    sessions.get(mainSessionId).running = true;
    assert.equal((await api(origin, auth, 'POST', route + '/select', { modelId: pro.modelId, sessionId: mainSessionId })).status, 200);
    const oldClientMessage = await api(origin, auth, 'POST', '/commands', { requestId: 'released-client-next-message', kind: 'chat.message', targetDeviceId: hostId,
      chatId: blankChat.chatId, modelProfileId: blankSelection.body.profileId, text: 'The released client echoes the running model.' });
    assert.equal(oldClientMessage.status, 202, JSON.stringify(oldClientMessage.body));
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(sent.length, 3, 'the old reply still uses its original model');
    sessions.get(mainSessionId).running = false;
    await waitFor(() => api(origin, auth, 'GET', `/commands/${oldClientMessage.body.command.commandId}`), value => value.body.command.state === 'accepted_by_dsh');
    assert.equal(sent.at(-1), pro.modelId, 'the accepted old-client message uses the authoritative pending model');
    await api(origin, auth, 'POST', route + '/select', { modelId: pro.modelId });
    const hidden = await api(origin, auth, 'PATCH', route, { requestId: 'hide-flash', expectedRevision: 1, models: [{ modelId: flash.modelId, enabled: false }] }); assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    assert.equal(hidden.body.service.models[0].enabled, false);
    assert.equal((await api(origin, auth, 'POST', route + '/select', { modelId: flash.modelId })).status, 422);
    assert.equal((await api(origin, auth, 'POST', route + '/refresh', {})).status, 200);
    assert.equal((await api(origin, auth, 'GET', route)).body.service.models[0].enabled, false, 'refresh keeps visibility choices');
    const disk = await readFile(join(root, 'store.json'), 'utf8'); assert.equal(disk.includes(secret), false);
    const stored = JSON.parse(disk), ownerId = Object.keys(stored.accounts)[0]; assert.equal(stored.accounts[ownerId].defaultModelProfileId, pro.profileId);
    assert.equal(stored.accounts[ownerId].sessions[sessionId].modelSelection.originalProfileId, flash.profileId);
    assert.equal(stored.accounts[ownerId].commands[createSession.body.command.commandId].payload.modelProfileId, flash.profileId, 'historical creation identity remains intact');
    await service.close(); service = await createPersonalAccessService({ root, port: 0, backend, accountModelManager: manager }); ({ origin } = await service.start());
    const after = await api(origin, { ...auth, origin }, 'GET', route); assert.equal(after.status, 200); assert.equal(after.body.service.selectedModelId, pro.modelId); assert.equal(after.body.service.models[0].enabled, false);
    assert.equal((await api(origin, { ...auth, origin }, 'GET', '/account/models')).body.models.length, 4);
    const readded = await api(origin, { ...auth, origin }, 'POST', '/model-services', { requestId: 'same-service-again', name: 'MiMo', baseUrl: baseUrl + '/chat/completions', apiKey: secret });
    assert.equal(readded.status, 201); assert.equal(readded.body.service.serviceId, modelService.serviceId);
    assert.equal((await api(origin, { ...auth, origin }, 'GET', '/model-services')).body.services.length, 1, 'same address and same credential reuse the service');
    assert.equal((await api(origin, { ...auth, origin }, 'POST', '/model-services', { requestId: 'same-service-again', name: 'MiMo', baseUrl: baseUrl + '/chat/completions', apiKey: secret })).body.service.serviceId, modelService.serviceId);
    const deleteBody = { requestId: 'remove-service', expectedRevision: readded.body.service.revision };
    assert.equal((await api(origin, { ...auth, origin }, 'DELETE', route, deleteBody)).status, 200);
    assert.equal((await api(origin, { ...auth, origin }, 'DELETE', route, deleteBody)).status, 200);
    assert.equal((await api(origin, { ...auth, origin }, 'GET', '/model-services')).body.services.length, 0, 'removed service is not recreated by migration');
  } finally { await service.close(); await new Promise<void>(resolve => directory.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
